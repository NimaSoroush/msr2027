/**
 * Step 5 of Task 7: one pilot PR, fetched and materialised under all five H1 conditions.
 *
 * Run: CAVEMAN_BIN=... CAVEMAN_TAG=... CAVEMAN_SHA256=... node scripts/material-smoke.ts [repo#pr]
 *
 * The point is not that files exist, but that the surfaces which must not move do not: the
 * description, frontmatter and structure hashes have to be identical across every condition, and
 * the C0 tree has to be the release's bytes with no compressor call.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openRelease } from "../src/db/sqlite.ts";
import { loadSkills } from "../src/material/skills.ts";
import { GitHubClient, screenPrBody } from "../src/material/github.ts";
import { CONDITIONS, materialise } from "../src/material/workdir.ts";
import { cavemanCompressor, destructiveCompressor, identityCompressor } from "../src/compress/index.ts";
import { achievedRatio } from "../src/tokens.ts";

process.loadEnvFile(".env");
const token = process.env.GITHUB_TOKEN?.trim();
if (!token) {
  console.error("GITHUB_TOKEN missing from .env");
  process.exit(2);
}

const arg = process.argv[2];
const pool = readFileSync("data/prs_v1/sample.jsonl", "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { repo: string; prNumber: number; role: string });

const pick = arg
  ? (() => {
      const [repo, n] = arg.split("#");
      return { repo, prNumber: Number(n), role: "pilot" };
    })()
  : pool.find((p) => p.role === "pilot")!;

const cavermanPin = {
  bin: process.env.CAVEMAN_BIN ?? "caveman-engine",
  tag: process.env.CAVEMAN_TAG ?? "unpinned",
  sha256: process.env.CAVEMAN_SHA256 ?? "",
};

const gh = new GitHubClient({ token });
const meta = await gh.pr(pick.repo, pick.prNumber);
const screen = screenPrBody({ title: meta.title, body: meta.body });

const db = openRelease();
const skills = await loadSkills(db, pick.repo, { allowUndescribed: true });

const root = join("/tmp", "msr2027-material", `${pick.repo.replace("/", "__")}-${pick.prNumber}`);
const tarball = join(root, "base.tar.gz");
await gh.treeTarball(pick.repo, meta.baseSha, tarball);

const caveman = cavemanCompressor({ ...cavermanPin, mode: "spawn" });
const destructive = destructiveCompressor();
const identity = identityCompressor();

const results: Record<string, unknown> = {};
for (const condition of CONDITIONS) {
  const compress = condition === "C4" ? destructive : condition === "C0" ? identity : caveman;
  try {
    const m = await materialise({
      dir: join(root, condition),
      tarball,
      skills,
      condition,
      compress,
    });
    const ratios = Object.values(m.ratios).sort((a, b) => a - b);
    results[condition] = {
      written: m.written.length,
      memory: m.memory,
      hashes: m.hashes,
      ratio: {
        median: ratios[Math.floor(ratios.length / 2)] ?? 1,
        min: ratios[0] ?? 1,
      },
    };
  } catch (error) {
    // A contract violation is a result, not a crash: it says this PR cannot be replayed under
    // this condition, and the other conditions still have to be materialised and reported.
    results[condition] = { error: (error as Error).message };
  }
}

const materialised = CONDITIONS.filter((c) => "hashes" in (results[c] as object));
const base = results.C0 as { hashes?: Record<string, string> };
const same = base.hashes
  ? materialised.every((c) => {
      const h = (results[c] as { hashes: Record<string, string> }).hashes;
      return Object.keys(base.hashes!).every((k) => h[k] === base.hashes![k]);
    })
  : false;

const summary = {
  generated: new Date().toISOString(),
  pr: { repo: pick.repo, prNumber: pick.prNumber, baseSha: meta.baseSha },
  screen,
  skills: skills.length,
  conditions: results,
  invariantHashesIdentical: same,
};
writeFileSync("analysis/material_smoke.json", `${JSON.stringify(summary, null, 2)}\n`);

console.log(`${pick.repo}#${pick.prNumber} base ${meta.baseSha.slice(0, 8)} — screen ${screen.passes ? "passes" : `fails (${screen.reason})`}`);
console.log(`skills ${skills.length}; tarball ${tarball}`);
for (const condition of CONDITIONS) {
  const r = results[condition] as
    | { written: number; memory: string[]; ratio: { median: number; min: number } }
    | { error: string };
  if ("error" in r) {
    console.log(`${condition}: BLOCKED — ${r.error.slice(0, 220)}`);
  } else {
    console.log(
      `${condition}: ${r.written} skills, ${r.memory.length} memory, median ratio ${r.ratio.median.toFixed(3)}, min ${r.ratio.min.toFixed(3)}`,
    );
  }
}
console.log(`description/frontmatter/structure hashes identical across materialised conditions: ${same} (${materialised.join(",")})`);
if (base.hashes) console.log(`C0 description hash ${base.hashes.description.slice(0, 12)}`);
void achievedRatio;
