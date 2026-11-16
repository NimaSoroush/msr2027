/**
 * One work directory per (PR, condition): the base tree, the skills as the release records them,
 * and the condition's transformation applied to exactly the surfaces it names.
 *
 * Manifestation happens here rather than during the replay so that every invariant that must not
 * move — description, frontmatter, catalog structure — is checked before a paid run can start.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { checkContract } from "../compress/contract.ts";
import type { Compressor } from "../compress/caveman.ts";
import { achievedRatio } from "../tokens.ts";
import { discoverMemoryFiles } from "./github.ts";
import { invariantHashes, splitSkill, type Skill } from "./skills.ts";

/** The six arms of the grid. C0b is the harness-neutrality arm, not a seventh treatment. */
export type Condition = "C0" | "C0b" | "C1" | "C2" | "C3" | "C4";

/** The five arms H1 compares; C0b exists only to measure replay noise. */
export const H1_CONDITIONS: readonly Condition[] = Object.freeze(["C0", "C1", "C2", "C3", "C4"]);

export type Materialised = {
  written: string[];
  /** Achieved ratio per relative path; untouched files are recorded as 1 rather than omitted. */
  ratios: Record<string, number>;
  hashes: ReturnType<typeof invariantHashes>;
  /** Memory files found in the base tree and written under this condition. */
  memory: string[];
};

const safeRelative = (path: string): string => {
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) throw new Error(`absolute path in material: ${path}`);
  const normalised = path.split(sep).join("/");
  if (normalised.split("/").includes("..")) throw new Error(`path escapes the workdir: ${path}`);
  return normalised;
};

const compose = (frontmatter: string, body: string): string => `---\n${frontmatter}\n---\n${body}`;

const walk = (root: string, dir = root): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      out.push(...walk(root, full));
    } else if (entry.isFile()) {
      out.push(relative(root, full).split(sep).join("/"));
    }
  }
  return out;
};

const extract = (tarball: string, dir: string): void => {
  const result = spawnSync("tar", ["-xzf", tarball, "-C", dir, "--strip-components=1"], {
    encoding: "utf8",
  });
  if (result.error) throw new Error(`cannot run tar: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`tar failed on ${tarball}: ${result.stderr.trim()}`);
};

const violationText = (path: string, violations: string[]): string =>
  `${path}: preservation contract violated — ${violations.join("; ")}`;

/**
 * Build the tree for one condition.
 *
 * - C0: release bytes, no compressor call.
 * - C0b: the whole file through the identity compressor, proving the code path is neutral.
 * - C1 / C3: skill bodies compressed, frontmatter untouched.
 * - C2: skills untouched; memory files compressed.
 * - C4: skill bodies cut destructively, frontmatter untouched (the control must still be a skill).
 */
export async function materialise(p: {
  dir: string;
  tarball: string;
  skills: Skill[];
  condition: Condition;
  compress: Compressor;
}): Promise<Materialised> {
  rmSync(p.dir, { recursive: true, force: true });
  mkdirSync(p.dir, { recursive: true });
  if (p.tarball) extract(p.tarball, p.dir);

  const written: string[] = [];
  const ratios: Record<string, number> = {};
  const writtenSkills: Skill[] = [];

  for (const skill of p.skills) {
    const rel = safeRelative(skill.path);
    const original = skill.original ?? compose(skill.frontmatter, skill.body);

    let text: string;
    if (p.condition === "C0" || p.condition === "C2") {
      text = original;
    } else if (p.condition === "C0b") {
      text = await p.compress.compress(original);
    } else {
      const body = await p.compress.compress(skill.body);
      text = compose(skill.frontmatter, body);
    }

    const split = splitSkill(text);
    if (split.frontmatter !== skill.frontmatter) {
      throw new Error(`${rel}: frontmatter changed under ${p.condition}; refusing to write it`);
    }
    // C4 is expected to violate preservation — that is what makes it a sensitivity probe.
    if (p.condition !== "C4") {
      const check = checkContract({ original, compressed: text });
      if (!check.ok) throw new Error(violationText(rel, check.violations));
    }

    const dest = join(p.dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    written.push(rel);
    ratios[rel] = achievedRatio(original, text);
    writtenSkills.push({ ...skill, ...split, original: text });
  }

  const memory: string[] = [];
  if (p.condition === "C2" || p.condition === "C3") {
    const candidates = discoverMemoryFiles(walk(p.dir));
    for (const rel of candidates) {
      const dest = join(p.dir, rel);
      const original = readFileSync(dest, "utf8");
      const text = await p.compress.compress(original);
      const check = checkContract({ original, compressed: text });
      if (!check.ok) throw new Error(violationText(rel, check.violations));
      writeFileSync(dest, text);
      memory.push(rel);
      ratios[rel] = achievedRatio(original, text);
    }
  }

  return { written, ratios, hashes: invariantHashes(writtenSkills), memory };
}
