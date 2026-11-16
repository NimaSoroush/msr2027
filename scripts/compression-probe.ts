/**
 * Step 5 of Task 6: what the treatment arm actually does to the study's material.
 *
 * Run: CAVEMAN_BIN=... CAVEMAN_TAG=... CAVEMAN_SHA256=... node scripts/compression-probe.ts [--limit N] [--repos]
 *
 * The question is not "how small is the output" but "did anything happen at all". Engine passes
 * the original bytes through whenever its gates decline, so a high untouched share means the
 * treatment arm is the control arm with extra steps — a finding that has to be reported as
 * "no compression happened", never as preservation.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { openRelease } from "../src/db/sqlite.ts";
import { loadSkills } from "../src/material/skills.ts";
import { cavemanCompressor, checkContract } from "../src/compress/index.ts";

const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit") + 1] ?? 200);
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "analysis/compression_probe.json";
const perRepo = args.includes("--repos") ? Number.MAX_SAFE_INTEGER : 1;

const bin = process.env.CAVEMAN_BIN ?? "caveman-engine";
const tag = process.env.CAVEMAN_TAG ?? "unpinned";
const sha256 = process.env.CAVEMAN_SHA256 ?? "";

if (!existsSync(bin)) {
  console.error(`no binary at ${bin}; export CAVEMAN_BIN (see getcaveman.dev/docs/engine/cli)`);
  process.exit(2);
}
const actualSha = createHash("sha256").update(readFileSync(bin)).digest("hex");
if (sha256 && actualSha !== sha256) {
  console.error(`binary sha256 ${actualSha} does not match CAVEMAN_SHA256 ${sha256}`);
  process.exit(2);
}

const pool = JSON.parse(readFileSync("analysis/prs_pool.json", "utf8")) as { repos: { repo: string }[] };
const db = openRelease();
const compressor = cavemanCompressor({ bin, mode: "spawn", pin: { tag, sha256: actualSha } });

type Row = {
  skillId: string;
  contentType: string;
  ratio: number;
  untouched: boolean;
  ok: boolean;
  violations: number;
  surfaces: string[];
};

const rows: Row[] = [];
const errors: string[] = [];

for (const { repo } of pool.repos) {
  let skills;
  try {
    skills = await loadSkills(db, repo, { allowUndescribed: true });
  } catch (error) {
    errors.push(`${repo}: ${(error as Error).message}`);
    continue;
  }
  for (const skill of skills.slice(0, perRepo)) {
    const text = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n${skill.body}`;
    try {
      const { output, report } = await compressor.compressWithReport(text);
      const check = checkContract({ original: text, compressed: output });
      rows.push({
        skillId: skill.skillId,
        contentType: report.content_type ?? "?",
        ratio: check.ratio,
        untouched: check.untouched,
        ok: check.ok,
        violations: check.violations.length,
        surfaces: check.violations.map((v) => v.split(/[:]/)[0]),
      });
    } catch (error) {
      errors.push(`${skill.skillId}: ${(error as Error).message}`);
    }
    if (rows.length >= limit) break;
  }
  if (rows.length >= limit) break;
}

const quantile = (p: number): number => {
  if (rows.length === 0) return 1;
  const sorted = rows.map((r) => r.ratio).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};
const byType: Record<string, number> = {};
const bySurface: Record<string, number> = {};
for (const r of rows) {
  byType[r.contentType] = (byType[r.contentType] ?? 0) + 1;
  for (const s of r.surfaces) bySurface[s] = (bySurface[s] ?? 0) + 1;
}

const summary = {
  generated: new Date().toISOString(),
  compressor: {
    id: "caveman",
    tag,
    sha256: actualSha,
    bin,
    note: "built from source; Engine reports version \"dev\" unless ldflags are set",
  },
  sample: {
    skills: rows.length,
    repos: new Set(rows.map((r) => r.skillId.split(":")[0])).size,
    limit,
    perRepo,
  },
  outcome: {
    untouched: rows.filter((r) => r.untouched).length,
    untouchedShare: rows.length ? rows.filter((r) => r.untouched).length / rows.length : 1,
    contractOk: rows.filter((r) => r.ok).length,
    medianRatio: quantile(0.5),
    p10Ratio: quantile(0.1),
    p90Ratio: quantile(0.9),
    reducedBelow90pct: rows.filter((r) => r.ratio < 0.9).length,
  },
  contentTypes: byType,
  violationsBySurface: bySurface,
  errors: errors.slice(0, 20),
  rows,
};

writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);

const o = summary.outcome;
console.log(`skills ${o.untouched}/${rows.length} untouched (${(o.untouchedShare * 100).toFixed(1)}%)`);
console.log(`median ratio ${o.medianRatio.toFixed(3)} (p10 ${o.p10Ratio.toFixed(3)}, p90 ${o.p90Ratio.toFixed(3)})`);
console.log(`reduced below 90%: ${o.reducedBelow90pct}; contract ok: ${o.contractOk}`);
console.log(`content types: ${JSON.stringify(byType)}`);
if (o.untouchedShare > 0.1) {
  console.log("VERDICT: no compression happened on most files — not preservation, and the arm is not a treatment.");
}
