import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Validates the judge's per-batch outputs against the batches it was given:
// valid JSON, one row per PR in the batch's order, ids that exist in that PR's candidate list.
const dir = process.argv[2] ?? "data/labels_v1/judge";
const out = process.argv[3] ?? "data/labels_v1/judge_labels.json";

type Batch = {
  batch: number;
  prs: { pr_id: string; candidates: { id: string }[] }[];
};
type Row = { pr_id: string; needed_skill_ids: string[] };

const problems: string[] = [];
const labels: { pr_id: string; repo: string; pr_number: number; needed_skill_ids: string[]; source: string }[] = [];

const batches = readdirSync(dir).filter((f) => /^batch-\d+\.json$/.test(f)).sort();
for (const file of batches) {
  const n = file.match(/\d+/)![0];
  const batch = JSON.parse(readFileSync(join(dir, file), "utf8")) as Batch;
  const outPath = join(dir, `out-${n}.json`);
  let rows: Row[];
  try {
    rows = JSON.parse(readFileSync(outPath, "utf8")) as Row[];
  } catch {
    problems.push(`batch ${n}: no readable ${`out-${n}.json`}`);
    continue;
  }
  if (!Array.isArray(rows)) {
    problems.push(`batch ${n}: output is not an array`);
    continue;
  }
  if (rows.length !== batch.prs.length) {
    problems.push(`batch ${n}: ${rows.length} rows for ${batch.prs.length} PRs`);
  }
  batch.prs.forEach((pr, i) => {
    const row = rows[i];
    if (!row || row.pr_id !== pr.pr_id) {
      problems.push(`batch ${n} row ${i}: expected ${pr.pr_id}, got ${row?.pr_id ?? "nothing"}`);
      return;
    }
    const allowed = new Set(pr.candidates.map((c) => c.id));
    const ids = Array.isArray(row.needed_skill_ids) ? row.needed_skill_ids : [];
    for (const id of ids) {
      if (!allowed.has(id)) problems.push(`batch ${n} ${pr.pr_id}: invented id ${id}`);
    }
    const dupes = ids.filter((id, k) => ids.indexOf(id) !== k);
    if (dupes.length > 0) problems.push(`batch ${n} ${pr.pr_id}: duplicate ids ${dupes.join(", ")}`);
    const [repo, number] = pr.pr_id.split("#");
    labels.push({ pr_id: pr.pr_id, repo, pr_number: Number(number), needed_skill_ids: ids, source: `out-${n}.json` });
  });
}

const seen = new Set(labels.map((l) => l.pr_id));
console.log(`judge outputs: ${batches.length} batches, ${labels.length} labelled PRs, ${seen.size} unique`);
if (problems.length > 0) {
  for (const p of problems.slice(0, 20)) console.log(`  problem: ${p}`);
  console.log(`  ${problems.length} problems`);
  process.exit(1);
}
writeFileSync(out, JSON.stringify({ judge: "freebuff-cli/gpt-6-luna", labels }, null, 1) + "\n");
const nonEmpty = labels.filter((l) => l.needed_skill_ids.length > 0);
const sizes = new Map<number, number>();
for (const l of labels) sizes.set(l.needed_skill_ids.length, (sizes.get(l.needed_skill_ids.length) ?? 0) + 1);
const distribution = [...sizes.entries()].sort((a, b) => a[0] - b[0]);
const neededTotal = labels.reduce((n, l) => n + l.needed_skill_ids.length, 0);
console.log(`wrote ${out}: ${nonEmpty.length} PRs with at least one needed skill, ${labels.length - nonEmpty.length} with none`);
console.log(`needed skill instances: ${neededTotal}; set sizes: ${distribution.map(([k, v]) => `${k}=${v}`).join(" ")}`);
