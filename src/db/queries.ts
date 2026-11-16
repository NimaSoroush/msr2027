import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { NON_BLANK, TEXT_BEARING } from "./release.ts";
import type { SqliteDb } from "./sqlite.ts";

/**
 * The release's own aggregate, written once and shared.
 *
 * Both the skill counts and the per-repo material read through `TEXT_BEARING`, so the two
 * questions cannot drift apart into "rows exist" versus "rows have text".
 */
export const SQL = {
  skillCountsByRepo: () =>
    `SELECT repo_full_name AS repo, COUNT(*) AS nSkills, SUM(${TEXT_BEARING}) AS nTextSkills,
            SUM(${NON_BLANK}) AS nNonBlank
       FROM artifacts
      GROUP BY repo_full_name
      ORDER BY repo_full_name`,
  skillsForRepo: () =>
    `SELECT repo_full_name, path, name, description, content
       FROM artifacts
      WHERE repo_full_name = ? AND ${TEXT_BEARING}
      ORDER BY path`,
} as const;

export type RepoSkillCount = { repo: string; nSkills: number; nTextSkills: number; nNonBlank: number };

const CACHE_DIR = "analysis/cache";

/**
 * The repo aggregate scans the whole 41 GB release, so it is computed once and cached under the
 * hash of the SQL. The cache records the database it came from: the same SQL against a different
 * release is a different answer, and reusing it silently would be worse than not caching at all.
 */
export function repoSkillCounts(db: SqliteDb, cacheDir = CACHE_DIR): RepoSkillCount[] {
  const sql = SQL.skillCountsByRepo();
  const key = createHash("sha256").update(sql).digest("hex");
  const file = `${cacheDir}/${key}.json`;

  if (existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, "utf8")) as { dbPath: string; rows: RepoSkillCount[] };
    if (cached.dbPath === db.path) return cached.rows;
  }

  const rows = db.all<RepoSkillCount>(sql);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, JSON.stringify({ sql, dbPath: db.path, rows }, null, 0) + "\n");
  return rows;
}
