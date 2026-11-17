import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { PoolRepo } from "../src/prs/corpus.ts";
import { drawSample } from "../src/prs/sample.ts";
import { streamPrFiles, streamPullRequests } from "../src/prs/specmine.ts";

const pool = JSON.parse(readFileSync("analysis/prs_pool.json", "utf8")) as {
  repos: PoolRepo[];
  counts: { mergedPrs: number; prRepos: number; overlapRepos: number; prsInOverlap: number; prsTouchingCode: number; poolRepos: number; poolPrs: number };
};
const poolRepos = new Set(pool.repos.map((r) => r.repo));
const ADDS_OR_EDITS = new Set(["added", "modified", "renamed", "changed"]);

const prs = [];
for await (const pr of streamPullRequests("specmine-zenodo/data_csv/pull_requests.csv.gz")) {
  if (poolRepos.has(pr.repo)) prs.push(pr);
}

// Eligibility rule 2 (spec §8.3): a PR that adds or edits a SKILL.md asks the agent to change the
// very artifact whose body the catalog shows, so it cannot enter the frame. Applied before the
// draw, not as an exclusion after it.
const skillEdits = new Set<string>();
for await (const file of streamPrFiles("specmine-zenodo/data_csv/pr_files.csv.gz")) {
  if (!poolRepos.has(file.repo)) continue;
  if (!ADDS_OR_EDITS.has(file.changeStatus)) continue;
  if (!/(^|\/)SKILL\.md$/i.test(file.filePath)) continue;
  skillEdits.add(`${file.repo}:${file.prNumber}`);
}
const poolSkillEditPrs = skillEdits.size;

const { sample, manifest } = drawSample({
  repos: pool.repos,
  prs,
  seed: 20261223,
  n: 200,
  oversamplePct: 20,
  nPilot: 15,
  exclude: skillEdits,
});

// The frame is enforced by the sampler; assert it here too, because a frame leak would be silent
// in every downstream count.
const drawn = new Set(sample.map((s) => `${s.repo}#${s.prNumber}`));
const leaked = prs.filter((pr) => !pr.touchesCode && drawn.has(`${pr.repo}#${pr.prNumber}`));
if (leaked.length > 0) throw new Error(`${leaked.length} documentation-only PR(s) drew into the sample`);
const skillEditLeak = sample.filter((s) => skillEdits.has(`${s.repo}:${s.prNumber}`));
if (skillEditLeak.length > 0) throw new Error(`${skillEditLeak.length} SKILL.md-editing PR(s) drew into the sample`);

const role = (r: "analysis" | "oversample" | "pilot") => sample.filter((s) => s.role === r).length;
const reposDrawn = (r: "analysis" | "oversample" | "pilot") =>
  new Set(sample.filter((s) => s.role === r).map((s) => s.repo)).size;

const ineligible = prs.length - manifest.poolSize;
const frameRepos = pool.repos.filter((r) => r.nCodePrs > 0);

mkdirSync("data/prs_v1", { recursive: true });
writeFileSync("data/prs_v1/sample.jsonl", sample.map((s) => JSON.stringify(s)).join("\n") + "\n");
writeFileSync(
  "data/sample_manifest.json",
  JSON.stringify(
    {
      ...manifest,
      seed: manifest.seed,
      roles: { analysis: role("analysis"), oversample: role("oversample"), pilot: role("pilot") },
      reposDrawn: {
        analysis: reposDrawn("analysis"),
        oversample: reposDrawn("oversample"),
        pilot: reposDrawn("pilot"),
      },
      eligibility: {
        populationPrs: pool.counts.poolPrs,
        skillEditingPrsRemoved: poolSkillEditPrs,
        excludedFromFrame: manifest.excludedFromFrame,
        populationRepos: pool.counts.poolRepos,
        eligiblePrs: manifest.poolSize,
        eligibleRepos: frameRepos.length,
        ineligibleDocOnlyPrs: ineligible,
        poolReposWithoutCodePr: pool.repos.length - frameRepos.length,
      },
      source: {
        pool: "analysis/prs_pool.json",
        prs: "specmine-zenodo/data_csv/pull_requests.csv.gz",
      },
    },
    null,
    2,
  ) + "\n",
);

console.log(`pool ${prs.length} merged PRs in ${pool.repos.length} repos`);
console.log(`frame ${manifest.poolSize} code-changing PRs in ${frameRepos.length} repos; ${ineligible} documentation-only PRs ineligible`);
console.log(`${poolSkillEditPrs} code PRs add or edit a SKILL.md and are outside the frame`);
console.log(`drew analysis ${role("analysis")} (${reposDrawn("analysis")} repos), oversample ${role("oversample")} (${reposDrawn("oversample")} repos), pilot ${role("pilot")} (${reposDrawn("pilot")} repos)`);
console.log(`strata (analysis): ${JSON.stringify(manifest.strata)}`);
console.log(`sha256 ${manifest.sha256}`);
console.log("wrote data/prs_v1/sample.jsonl and data/sample_manifest.json");
