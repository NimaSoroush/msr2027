import { readFileSync, writeFileSync } from "node:fs";

// Builds the human calibration sheet: a stratified 25-PR subset of the judge's labels, with the
// same title/body/candidates the judge saw and an empty column for the human label.
const labelsPath = process.argv[2] ?? "data/labels_v1/judge_labels.json";
const textPath = process.argv[3] ?? "data/labels_v1/pr_text.jsonl";
const outPath = process.argv[4] ?? "data/labels_v1/calibration.csv";

type Label = { pr_id: string; needed_skill_ids: string[] };
type Text = { prId: string; title: string; body: string };
type Batch = { prs: { pr_id: string; candidates: { id: string; name: string; path: string }[] }[] };

const labels = (JSON.parse(readFileSync(labelsPath, "utf8")) as { labels: Label[] }).labels;
const text = new Map<string, Text>();
for (const line of readFileSync(textPath, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const t = JSON.parse(line) as Text;
  text.set(t.prId, t);
}
const candidates = new Map<string, Batch["prs"][number]["candidates"]>();
for (let n = 1; n <= 20; n++) {
  const batch = JSON.parse(readFileSync(`data/labels_v1/judge/batch-${String(n).padStart(2, "0")}.json`, "utf8")) as Batch;
  for (const pr of batch.prs) candidates.set(pr.pr_id, pr.candidates);
}

// Deterministic pick: sort by pr_id, take every k-th PR from each stratum so both the empty and the
// non-empty groups are represented in proportion, and never fewer than 8 non-empty PRs.
const pick = (rows: Label[], want: number): Label[] => {
  const sorted = [...rows].sort((a, b) => a.pr_id.localeCompare(b.pr_id));
  const step = Math.max(1, Math.floor(sorted.length / want));
  const out: Label[] = [];
  for (let i = 0; i < sorted.length && out.length < want; i += step) out.push(sorted[i]);
  return out;
};
const empty = labels.filter((l) => l.needed_skill_ids.length === 0);
const filled = labels.filter((l) => l.needed_skill_ids.length > 0);
const chosen = [...pick(empty, 15), ...pick(filled, 10)].sort((a, b) => a.pr_id.localeCompare(b.pr_id));

const esc = (s: string): string => `"${s.replace(/"/g, '""').replace(/\s+/g, " ").slice(0, 1200)}"`;
const header = "pr_id,title,body,candidate_skills,judge_needed_skill_ids,human_needed_skill_ids";
const rows = chosen.map((l) => {
  const t = text.get(l.pr_id);
  const cands = (candidates.get(l.pr_id) ?? []).map((c) => c.id).join(" ");
  return [esc(l.pr_id), esc(t?.title ?? ""), esc(t?.body ?? ""), esc(cands), esc(l.needed_skill_ids.join(" ")), ""].join(",");
});
writeFileSync(outPath, [header, ...rows].join("\n") + "\n");
console.log(`calibration: ${chosen.length} PRs (${chosen.filter((c) => c.needed_skill_ids.length === 0).length} empty, ${chosen.filter((c) => c.needed_skill_ids.length > 0).length} non-empty) -> ${outPath}`);
