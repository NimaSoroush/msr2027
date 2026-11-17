/**
 * Build the judge's input: one row per (analysis PR, candidate skill), with the label columns empty
 * and the two mechanical signals recorded.
 *
 * The mechanical columns are context, never answers — spec §8.3 decision 15 makes the LLM judge
 * primary and forbids excluding a PR for disagreement. A judge that saw them could be anchored by
 * the exact-path rule, so they stay in a separate file (`analysis/mechanical_labels.json`) and out
 * of the CSV the judge reads.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { bodyPathLabels, mechanicalLabels } from "../src/analysis/labels.ts";
import type { SampledPr } from "../src/prs/sample.ts";

const SAMPLE = "data/prs_v1/sample.jsonl";
const SPECMINE = "specmine-zenodo/specmine.sqlite";
const RELEASE = "agent_skills_release.db";
const OUT_DIR = "data/labels_v1";

type SkillRow = { skillId: string; name: string; path: string; body: string | null };

const csv = (value: string | number): string => {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const sample: SampledPr[] = readFileSync(SAMPLE, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as SampledPr)
  .filter((pr) => pr.role === "analysis");

const specmine = new DatabaseSync(SPECMINE, { readOnly: true });
const release = new DatabaseSync(RELEASE, { readOnly: true });

const filesFor = new Map<string, { repo: string; prNumber: number; filePath: string; changeStatus: string; isCode: boolean }[]>();
const skillsFor = new Map<string, SkillRow[]>();

for (const repo of new Set(sample.map((pr) => pr.repo))) {
  const rows = release
    .prepare(
      "select path, name, content from artifacts where repo_full_name = ? and content is not null and trim(content) <> ''",
    )
    .all(repo) as { path: string; name: string | null; content: string }[];
  skillsFor.set(
    repo,
    rows.map((r) => ({
      skillId: `${repo}:${r.path}`,
      name: r.name ?? r.path,
      path: r.path,
      body: r.content,
    })),
  );
}

for (const pr of sample) {
  const rows = specmine
    .prepare("select file_path, change_status, is_code from pr_files where repo_name = ? and pr_number = ?")
    .all(pr.repo, pr.prNumber) as { file_path: string; change_status: string; is_code: number }[];
  filesFor.set(
    `${pr.repo}#${pr.prNumber}`,
    rows.map((r) => ({
      repo: pr.repo,
      prNumber: pr.prNumber,
      filePath: r.file_path,
      changeStatus: r.change_status,
      isCode: r.is_code === 1,
    })),
  );
}

mkdirSync(OUT_DIR, { recursive: true });

const header = ["pr_id", "repo", "pr_number", "skill_id", "skill_name", "skill_path", "judge_needed", "human_needed"];
const rows: string[] = [header.join(",")];
const mechanical: {
  prId: string;
  candidates: number;
  exact: string[];
  body: string[];
}[] = [];

for (const pr of [...sample].sort((a, b) => a.repo.localeCompare(b.repo) || a.prNumber - b.prNumber)) {
  const prId = `${pr.repo}#${pr.prNumber}`;
  const files = filesFor.get(prId) ?? [];
  const skills = skillsFor.get(pr.repo) ?? [];

  const exact = mechanicalLabels({ pr, files, skills });
  const body = bodyPathLabels({ pr, files, skills });
  mechanical.push({ prId, candidates: skills.length, exact, body });

  for (const skill of skills) {
    rows.push(
      [prId, pr.repo, pr.prNumber, skill.skillId, skill.name, skill.path, "", ""].map(csv).join(","),
    );
  }
}

writeFileSync(`${OUT_DIR}/candidates.csv`, `${rows.join("\n")}\n`);

const withExact = mechanical.filter((m) => m.exact.length > 0).length;
const withBody = mechanical.filter((m) => m.body.length > 0).length;
const candidateCounts = mechanical.map((m) => m.candidates).sort((a, b) => a - b);
const median = candidateCounts[Math.floor(candidateCounts.length / 2)] ?? 0;

writeFileSync(
  "analysis/mechanical_labels.json",
  `${JSON.stringify(
    {
      generatedFrom: { sample: SAMPLE, specmine: SPECMINE, release: RELEASE },
      analysisPrs: mechanical.length,
      candidatesPerPr: { median, min: candidateCounts[0] ?? 0, max: candidateCounts.at(-1) ?? 0 },
      exactPath: {
        rule: "skill whose recorded artifacts.path is a file the PR touched",
        prsWithCandidate: withExact,
        rate: withExact / mechanical.length,
        comparable: false,
        note: "reported as availability only; cannot gate (spec §8.3 decision 15)",
      },
      bodyPath: {
        rule: "skill whose body names a file the PR touched",
        prsWithCandidate: withBody,
        rate: withBody / mechanical.length,
        comparable: true,
        note: "sensitivity subset for judge concordance",
      },
      perPr: mechanical,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `analysis ${mechanical.length} PRs; candidates median ${median}, max ${candidateCounts.at(-1) ?? 0}; exact ${withExact}, body ${withBody}; wrote ${OUT_DIR}/candidates.csv (${rows.length - 1} rows)`,
);
