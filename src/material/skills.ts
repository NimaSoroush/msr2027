import { createHash } from "node:crypto";
import { SQL } from "../db/queries.ts";
import { PageLossError, type SqlResult } from "../db/types.ts";

export type Skill = {
  skillId: string;
  repo: string;
  path: string;
  name: string;
  description: string;
  /** The YAML block exactly as stored, delimiters excluded. */
  frontmatter: string;
  /** Everything after the frontmatter — the text compression is allowed to change. */
  body: string;
};

/** The subset of either transport `loadSkills` needs; both accept the params argument. */
export type SqlRunner = {
  queryAll(sql: string, opts?: { pageSize?: number }, params?: string[]): Promise<SqlResult>;
};

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
};

/**
 * Split a skill file into its two surfaces. A missing frontmatter block is not an error: the
 * body is then the whole file, and the caller decides whether that is usable material.
 */
export function splitSkill(text: string): {
  frontmatter: string;
  body: string;
  name: string;
  description: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
  if (!match) return { frontmatter: "", body: text, name: "", description: "" };

  const frontmatter = match[1];
  let name = "";
  let description = "";
  for (const line of frontmatter.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[1] === "name") name = unquote(kv[2]);
    else if (kv[1] === "description") description = unquote(kv[2]);
  }

  return { frontmatter, body: text.slice(match[0].length), name, description };
}

/** A description the catalogs can use: not absent, not blank. */
const usable = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "null") return null;
  return trimmed;
};

/** The literal `null` is a transport artifact, never a real description; it stays an error. */
const isCorrupt = (value: string | null | undefined): boolean =>
  typeof value === "string" && value.trim().toLowerCase() === "null";

/**
 * Every text-bearing skill of one repo, body intact.
 *
 * This uses the direct read, which returns all rows: the release has repos with hundreds of
 * skills (293 in the largest), and a transport that quietly caps at 50 would hand the study a
 * truncated catalog that still looks complete.
 */
export async function loadSkills(
  runner: SqlRunner,
  repo: string,
  opts: { allowUndescribed?: boolean } = {},
): Promise<Skill[]> {
  const result = await runner.queryAll(SQL.skillsForRepo(), undefined, [repo]);

  if (result.hasNextPage && result.rows.length < result.declaredRows) {
    throw new PageLossError(
      `${repo}: got ${result.rows.length} of ${result.declaredRows} skill rows; refusing a partial catalog`,
    );
  }

  const index = (column: string): number => {
    const i = result.columns.indexOf(column);
    if (i < 0) throw new Error(`${repo}: query result is missing the '${column}' column`);
    return i;
  };
  const [iRepo, iPath, iName, iDescription, iContent] = [
    index("repo_full_name"),
    index("path"),
    index("name"),
    index("description"),
    index("content"),
  ];

  return result.rows.map((row) => {
    const path = row[iPath] ?? "";
    const content = row[iContent] ?? "";
    const split = splitSkill(content);

    // The column is authoritative; the frontmatter is the fallback, because the release stores
    // both and a NULL column next to a described file is a parsing gap, not missing material.
    const description = usable(row[iDescription]) ?? usable(split.description);
    if (isCorrupt(row[iDescription])) {
      throw new Error(
        `${repo}:${path} carries the literal string "null" as its description; that is a transport artifact, not material`,
      );
    }
    if (!description && !opts.allowUndescribed) {
      throw new Error(
        `${repo}:${path} has no usable description (column ${JSON.stringify(row[iDescription])}); refusing it as catalog material`,
      );
    }

    const repoName = row[iRepo] ?? repo;
    return {
      skillId: `${repoName}:${path}`,
      repo: repoName,
      path,
      name: usable(row[iName]) ?? split.name,
      description: description ?? "",
      frontmatter: split.frontmatter,
      body: split.body,
    };
  });
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

const byPath = (a: Skill, b: Skill): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Three hashes a compressed replay has to reproduce exactly.
 *
 * Order is fixed by sorting on path, and the body is deliberately excluded: compression changes
 * bodies, which is the whole experiment. If any of these three moves, the replay changed
 * something it was supposed to preserve — a different skill set, a rewritten trigger
 * description, or a reshaped catalog.
 */
export function invariantHashes(skills: Skill[]): {
  description: string;
  frontmatter: string;
  structure: string;
} {
  const sorted = [...skills].sort(byPath);
  return {
    description: sha(sorted.map((s) => s.description).join("\u0000")),
    frontmatter: sha(sorted.map((s) => s.frontmatter).join("\u0000")),
    structure: sha(sorted.map((s) => `${s.path}\u0000${s.name}`).join("\u0000")),
  };
}
