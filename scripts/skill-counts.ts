import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { repoSkillCounts, SQL } from "../src/db/queries.ts";
import { openRelease } from "../src/db/sqlite.ts";
import { RELEASE_COUNTS } from "../src/db/release.ts";
import { loadSkills } from "../src/material/skills.ts";

const db = openRelease();
const started = Date.now();
const rows = repoSkillCounts(db);
const elapsedMs = Date.now() - started;

const totals = rows.reduce(
  (acc, r) => ({
    skills: acc.skills + r.nSkills,
    textSkills: acc.textSkills + r.nTextSkills,
    nonBlank: acc.nonBlank + r.nNonBlank,
  }),
  { skills: 0, textSkills: 0, nonBlank: 0 },
);
const eligible = rows.filter((r) => r.nTextSkills >= 2);

// Coverage of the actual study material, when the pool is present: how many pool skills can be
// described at all, and how many repos that leaves untouched. Task 9 decides what to do with the
// undescribed ones; this records the size of the question instead of letting strict loading hide it.
let material: Record<string, number> | undefined;
if (existsSync("analysis/prs_pool.json")) {
  const pool = JSON.parse(readFileSync("analysis/prs_pool.json", "utf8")) as { repos: { repo: string }[] };
  let skills = 0;
  let undescribed = 0;
  let cleanRepos = 0;
  for (const { repo } of pool.repos) {
    const loaded = await loadSkills(db, repo, { allowUndescribed: true });
    const missing = loaded.filter((s) => s.description === "").length;
    skills += loaded.length;
    undescribed += missing;
    if (missing === 0 && loaded.length > 0) cleanRepos++;
  }
  material = { poolRepos: pool.repos.length, skills, undescribed, cleanRepos };
}

// Only the release-wide pinned counts belong here. "Repos with >=2 text-bearing skills" is 129,013
// across the release but 306 inside the PR overlap, so that 306 is a join result (Task 3), not an
// aggregate this script can assert.
writeFileSync(
  "analysis/skill_counts.json",
  JSON.stringify(
    {
      sql: SQL.skillCountsByRepo(),
      dbPath: db.path,
      repos: rows.length,
      reposWithText: rows.filter((r) => r.nTextSkills > 0).length,
      reposWithTwoTextSkills: eligible.length,
      totals,
      expected: {
        textBearing: RELEASE_COUNTS.textBearing,
        nonBlank: RELEASE_COUNTS.nonBlank,
      },
      elapsedMs,
      material,
      rows: "per-repo counts in analysis/cache/<sha256(sql)>.json (15-20 MB, derived)",
    },
    null,
    2,
  ) + "\n",
);

console.log(`scanned ${rows.length} repos in ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(1)} s)`);
console.log(`text-bearing skills ${totals.textSkills} (expected ${RELEASE_COUNTS.textBearing})`);
console.log(`non-blank skills ${totals.nonBlank} (expected ${RELEASE_COUNTS.nonBlank})`);
console.log(`repos with text ${rows.filter((r) => r.nTextSkills > 0).length}; with >=2 ${eligible.length}`);
if (material) {
  console.log(
    `pool material: ${material.skills} skills in ${material.poolRepos} repos, ${material.undescribed} undescribed, ${material.cleanRepos} repos fully described`,
  );
}
console.log("wrote analysis/skill_counts.json");

const failed: string[] = [];
if (totals.textSkills !== RELEASE_COUNTS.textBearing) failed.push(`textBearing ${totals.textSkills}`);
if (totals.nonBlank !== RELEASE_COUNTS.nonBlank) failed.push(`nonBlank ${totals.nonBlank}`);
if (failed.length > 0) {
  console.error(`MISMATCH against the pinned release: ${failed.join(", ")}`);
  process.exit(1);
}
