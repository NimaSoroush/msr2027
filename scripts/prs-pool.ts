import { writeFileSync } from "node:fs";
import { openRelease } from "../src/db/sqlite.ts";
import { NON_BLANK, TEXT_BEARING } from "../src/db/release.ts";
import { buildPool } from "../src/prs/corpus.ts";
import { streamPullRequests, type PrRow } from "../src/prs/specmine.ts";

const CSV = "specmine-zenodo/data_csv";
const OUT = "analysis/prs_pool.json";

/** From the feasibility work (RESEARCH_PLAN.md); the join must reproduce these or it is wrong. */
const EXPECTED = {
  mergedPrs: 5_992,
  prRepos: 581,
  overlapRepos: 306,
  prsInOverlap: 4_486,
  prsTouchingCode: 3_579,
  poolRepos: 223,
  poolPrs: 3_566,
} as const;

const db = openRelease();
const started = Date.now();

const prs: PrRow[] = [];
for await (const row of streamPullRequests(`${CSV}/pull_requests.csv.gz`)) prs.push(row);

const prRepos = new Set(prs.map((pr) => pr.repo));

// One index scan of distinct repo names, then per-repo counts: a `lower()` join would scan the
// whole 41 GB table once per repo, which is the one thing this script must never do.
const dbRepos = new Map<string, string>();
for (const row of db.all<{ repo: string }>("SELECT DISTINCT repo_full_name AS repo FROM artifacts")) {
  dbRepos.set(row.repo.toLowerCase(), row.repo);
}

const countStmt = `
  SELECT COUNT(*) AS nSkills, SUM(${TEXT_BEARING}) AS nTextSkills, SUM(${NON_BLANK}) AS nNonBlank
  FROM artifacts WHERE repo_full_name = ?
`;
const skillCounts = new Map<string, { nSkills: number; nTextSkills: number }>();
const prsByRepo = new Map<string, PrRow[]>();
for (const pr of prs) {
  const bucket = prsByRepo.get(pr.repo);
  if (bucket) bucket.push(pr);
  else prsByRepo.set(pr.repo, [pr]);
}

const overlap: PrRow[] = [];
for (const [repo, repoPrs] of prsByRepo) {
  const exact = dbRepos.get(repo.toLowerCase());
  if (!exact) continue;
  const row = db.all<{ nSkills: number; nTextSkills: number }>(countStmt, [exact])[0];
  skillCounts.set(repo, { nSkills: row.nSkills, nTextSkills: row.nTextSkills });
  overlap.push(...repoPrs);
}

const { repos, excluded } = buildPool({ prs: overlap, skillCounts });
const prsTouchingCode = overlap.filter((pr) => pr.touchesCode).length;
const poolPrs = repos.reduce((sum, r) => sum + r.nPrs, 0);
const poolCodePrs = repos.reduce((sum, r) => sum + r.nCodePrs, 0);
const poolReposWithCode = repos.filter((r) => r.nCodePrs > 0).length;

const actual = {
  mergedPrs: prs.length,
  prRepos: prRepos.size,
  overlapRepos: skillCounts.size,
  prsInOverlap: overlap.length,
  prsTouchingCode,
  poolRepos: repos.length,
  poolPrs,
};

console.log("\nReconciliation against the feasibility numbers:");
let mismatches = 0;
for (const [key, expected] of Object.entries(EXPECTED)) {
  const got = actual[key as keyof typeof actual];
  const ok = got === expected;
  if (!ok) mismatches++;
  console.log(`  ${ok ? "ok  " : "DIFF"}  ${key.padEnd(16)} expected ${String(expected).padStart(6)}  got ${String(got).padStart(6)}  ${got - expected >= 0 ? "+" : ""}${got - expected}`);
}
console.log(`  excluded by reason: ${JSON.stringify(excluded)}`);
console.log(`  pool repos with a code-touching PR: ${poolReposWithCode}, holding ${poolCodePrs} such PRs`);
console.log(`  case-insensitive repo matches: ${skillCounts.size} of ${prRepos.size} PR repos in GitSkills`);
console.log(`  elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);

writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: `${CSV}/pull_requests.csv.gz`,
      counts: actual,
      expected: EXPECTED,
      excluded,
      poolReposWithCode,
      poolCodePrs,
      repos,
    },
    null,
    2,
  ) + "\n",
);

console.log(`\nwrote ${OUT} (${repos.length} pool repos)`);
db.close();
if (mismatches > 0) {
  console.error(`\n${mismatches} number(s) differ from the feasibility work: the join key is suspect, not the earlier measurement.`);
  process.exitCode = 1;
}
