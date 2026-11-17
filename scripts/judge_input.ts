/**
 * Build the judge's task files: PR title + body + that repo's candidate skills, batched, with the
 * instruction text hashed. The judge runs in a Freebuff CLI session, which has no API mode, so the
 * prompt tells the agent to read these files and write one JSON file per batch.
 *
 * Fetch is cached in data/labels_v1/pr_text.jsonl so a re-run does not re-hit GitHub.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

process.loadEnvFile(".env");

const SAMPLE = "data/prs_v1/sample.jsonl";
const CANDIDATES = "data/labels_v1/candidates.csv";
const CACHE = "data/labels_v1/pr_text.jsonl";
const OUT = "data/labels_v1/judge";
const BATCH = 10;
const BODY_CHARS = 2500;

type Pr = { repo: string; prNumber: number; role: string };
type Text = { prId: string; title: string; body: string; status?: string };

const sample = readFileSync(SAMPLE, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Pr)
  .filter((pr) => pr.role === "analysis");

const cache = new Map<string, Text>();
if (existsSync(CACHE)) {
  for (const line of readFileSync(CACHE, "utf8").split("\n").filter(Boolean)) {
    const row = JSON.parse(line) as Text;
    cache.set(row.prId, row);
  }
}

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN missing");

const specmine = new DatabaseSync("specmine-zenodo/specmine.sqlite", { readOnly: true });
const titleFor = (repo: string, prNumber: number) =>
  (specmine.prepare("select title from pull_requests where repo_name = ? and pr_number = ?").get(repo, prNumber) as { title: string } | undefined)?.title ?? "";

const unavailable: string[] = [];
const todo = sample.filter((pr) => !cache.has(`${pr.repo}#${pr.prNumber}`));
for (let i = 0; i < todo.length; i += 8) {
  await Promise.all(
    todo.slice(i, i + 8).map(async (pr) => {
      const prId = `${pr.repo}#${pr.prNumber}`;
      const res = await fetch(`https://api.github.com/repos/${pr.repo}/pulls/${pr.prNumber}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (!res.ok) {
        // A deleted or renamed PR still has its SpecMine title; the judge then works title-only, flagged.
        unavailable.push(`${prId} (HTTP ${res.status})`);
        cache.set(prId, { prId, title: titleFor(pr.repo, pr.prNumber), body: "", status: `github-${res.status}` });
        return;
      }
      const data = (await res.json()) as { title: string; body: string | null };
      cache.set(prId, { prId, title: data.title, body: data.body ?? "" });
    }),
  );
}

if (todo.length > 0) {
  writeFileSync(
    CACHE,
    `${[...cache.values()].map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
}

const skillsByPr = new Map<string, { id: string; name: string; path: string }[]>();
for (const line of readFileSync(CANDIDATES, "utf8").split("\n").slice(1).filter(Boolean)) {
  const [prId, , , skillId, name, path] = line.split(",");
  const list = skillsByPr.get(prId) ?? [];
  list.push({ id: skillId, name, path });
  skillsByPr.set(prId, list);
}

const ordered = [...sample].sort((a, b) => a.repo.localeCompare(b.repo) || a.prNumber - b.prNumber);
mkdirSync(OUT, { recursive: true });

const instruction = `# Judge task: which skills does each pull request need?

You are labelling pull requests for a study of whether coding agents load repository skills at the
right moment. For each PR you get its title, its description, and the skills that exist in that
repository. Decide which of those skills a developer would need **in order to do the task described
in the PR**.

Rules:
- Judge only from the title and description. You do not have the diff. Do not guess from filenames
  mentioned in a skill; ask what the task needs.
- Pick the smallest set that covers the task. A PR that renames a config key needs the skill that
  documents that config, not every skill in the repo. Most PRs need zero, one or two skills; a list
  of seven is almost always wrong unless the PR rewrites every workflow in the repository.
- A candidate under \`examples/\` or a demo directory is needed only if the PR changes that example.
- Use the exact \`skill_id\` strings from the candidate list. Never invent one.
- If no candidate skill is needed, return an empty array. That is a legitimate answer and is
  expected for many PRs.
- Do not read or modify any other file in the repository.

Output: for each batch file \`batch-NN.json\` write \`out-NN.json\` next to it, containing a JSON
array with one object per PR, in the same order:
\`\`\`json
[{"pr_id": "owner/repo#123", "needed_skill_ids": ["owner/repo:path/to/SKILL.md"]}]
\`\`\`
Write valid JSON only, no prose around it. Process every batch, then reply DONE.
`;

const manifestBatches: { file: string; out: string; prs: string[]; sha256: string }[] = [];

for (let start = 0, index = 1; start < ordered.length; start += BATCH, index += 1) {
  const name = `batch-${String(index).padStart(2, "0")}`;
  const slice = ordered.slice(start, start + BATCH);
  const body = {
    instruction: "Judge each PR below. Return the JSON array described in INSTRUCTIONS.md.",
    prs: slice.map((pr) => {
      const prId = `${pr.repo}#${pr.prNumber}`;
      const text = cache.get(prId);
      return {
        pr_id: prId,
        ...(text?.status ? { text_status: text.status } : {}),
        title: text?.title ?? "",
        body: (text?.body ?? "").slice(0, BODY_CHARS),
        body_truncated: (text?.body ?? "").length > BODY_CHARS,
        candidates: skillsByPr.get(prId) ?? [],
      };
    }),
  };
  const text = `${JSON.stringify(body, null, 2)}\n`;
  writeFileSync(`${OUT}/${name}.json`, text);
  manifestBatches.push({
    file: `${name}.json`,
    out: `${name.replace("batch", "out")}.json`,
    prs: slice.map((pr) => `${pr.repo}#${pr.prNumber}`),
    sha256: createHash("sha256").update(text).digest("hex"),
  });
}

writeFileSync(`${OUT}/INSTRUCTIONS.md`, instruction);

const manifest = {
  judge: {
    channel: "freebuff CLI 0.2.36, interactive session driven over a pty",
    model: "GPT-6 Luna (OpenAI family; study model is DeepSeek V4.1 Flash)",
    reasoning: "high (model default)",
    dataNote: "Freebuff marks this model 'may use data for AI training'",
    promptSha256: createHash("sha256").update(instruction).digest("hex"),
    inputFields: ["title", "body (first 6000 chars)", "candidate skills (id, name, path)"],
    excludedFields: ["diff", "condition", "transcript", "mechanical labels"],
    batchSize: BATCH,
    bodyChars: BODY_CHARS,
  },
  batches: manifestBatches,
};

writeFileSync("analysis/judge_manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `judge input: ${ordered.length} PRs in ${manifestBatches.length} batches; cached text ${cache.size}; prompt ${manifest.judge.promptSha256.slice(0, 12)}`,
);
if (unavailable.length > 0) console.log(`unavailable on GitHub (title-only): ${unavailable.length}\n  ${unavailable.join("\n  ")}`);
