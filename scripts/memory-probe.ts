/**
 * Step 5b of Task 6: does the treatment arm do anything to memory files?
 *
 * Run: GITHUB_TOKEN=... CAVEMAN_BIN=... CAVEMAN_TAG=... CAVEMAN_SHA256=... node scripts/memory-probe.ts
 *
 * Task 7 will read these files at each PR's base commit. This probe reads them at the default
 * branch instead, which is cheaper and answers the only question that blocks the design: would C2
 * (and C3's memory half) differ from C0 at all? Same pinned binary, same preservation contract as
 * the skill probe, so the two are directly comparable.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { cavemanCompressor, checkContract } from "../src/compress/index.ts";

process.loadEnvFile(".env");
const token = process.env.GITHUB_TOKEN?.trim();
if (!token) {
  console.error("GITHUB_TOKEN missing from .env; the probe needs it for repo metadata");
  process.exit(2);
}

const POOL = "analysis/prs_pool.json";
const OUT = "analysis/memory_probe.json";
/** Pinned in the spec (§7.2): discovery is a fixed list, never a heuristic. */
const PATHS = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
  "MEMORY.md",
  "docs/conventions.md",
];
const MAX_BYTES = 1 << 20;

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

const headers = {
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "user-agent": "msr2027-memory-probe",
};

type Repo = { repo: string };
const pool = JSON.parse(readFileSync(POOL, "utf8")) as { repos: Repo[] };

type Row = {
  repo: string;
  path: string;
  bytes: number;
  contentType: string;
  ratio: number;
  untouched: boolean;
  ok: boolean;
  violations: string[];
};

const rows: Row[] = [];
const errors: string[] = [];
const missing: string[] = [];

const raw = async (repo: string, branch: string, path: string): Promise<string | null> => {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${path}`, {
    headers: { "user-agent": "msr2027-memory-probe" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${repo}/${path}: HTTP ${res.status}`);
  const text = await res.text();
  return text;
};

const defaultBranch = async (repo: string): Promise<string> => {
  const res = await fetch(`https://api.github.com/repos/${repo}`, { headers });
  if (!res.ok) throw new Error(`${repo}: metadata HTTP ${res.status}`);
  const body = (await res.json()) as { default_branch?: string };
  return body.default_branch ?? "main";
};

const compressor = cavemanCompressor({ bin, mode: "spawn", pin: { tag, sha256: actualSha } });

const probe = async (repo: string): Promise<void> => {
  let branch: string;
  try {
    branch = await defaultBranch(repo);
  } catch (error) {
    errors.push((error as Error).message);
    return;
  }
  for (const path of PATHS) {
    let text: string | null;
    try {
      text = await raw(repo, branch, path);
    } catch (error) {
      errors.push((error as Error).message);
      continue;
    }
    if (text === null) {
      missing.push(`${repo}/${path}`);
      continue;
    }
    if (Buffer.byteLength(text) > MAX_BYTES) {
      errors.push(`${repo}/${path}: ${Buffer.byteLength(text)} bytes exceeds probe cap`);
      continue;
    }
    try {
      const { output, report } = await compressor.compressWithReport(text);
      const check = checkContract({ original: text, compressed: output });
      rows.push({
        repo,
        path,
        bytes: Buffer.byteLength(text),
        contentType: report.content_type ?? "?",
        ratio: check.ratio,
        untouched: check.untouched,
        ok: check.ok,
        violations: check.violations,
      });
    } catch (error) {
      errors.push(`${repo}/${path}: ${(error as Error).message}`);
    }
  }
};

// Six at a time: 223 repos x 6 paths stays inside the authenticated rate limit without hammering.
const queue = pool.repos.map((r) => r.repo);
let done = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let repo = queue.shift(); repo; repo = queue.shift()) {
      await probe(repo);
      done += 1;
      if (done % 25 === 0) console.error(`probed ${done}/${pool.repos.length} repos`);
    }
  }),
);

const quantile = (p: number): number => {
  if (rows.length === 0) return 1;
  const sorted = rows.map((r) => r.ratio).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};
const byPath: Record<string, number> = {};
const byType: Record<string, number> = {};
const bySurface: Record<string, number> = {};
let belowFloor = 0;
for (const r of rows) {
  byPath[r.path] = (byPath[r.path] ?? 0) + 1;
  byType[r.contentType] = (byType[r.contentType] ?? 0) + 1;
  for (const v of r.violations) bySurface[v.split(":")[0]] = (bySurface[v.split(":")[0]] ?? 0) + 1;
  if (r.bytes < 1600) belowFloor += 1;
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
  method: {
    commits: "default branch, not PR base commits — Task 7 re-derives at the base commit",
    discovery: PATHS,
    repos: pool.repos.length,
  },
  outcome: {
    files: rows.length,
    reposWithMemory: new Set(rows.map((r) => r.repo)).size,
    untouched: rows.filter((r) => r.untouched).length,
    untouchedShare: rows.length ? rows.filter((r) => r.untouched).length / rows.length : 1,
    contractOk: rows.filter((r) => r.ok).length,
    medianRatio: quantile(0.5),
    p10Ratio: quantile(0.1),
    p90Ratio: quantile(0.9),
    below1600Bytes: belowFloor,
    reducedBelow90pct: rows.filter((r) => r.ratio < 0.9).length,
    bytesTotal: rows.reduce((n, r) => n + r.bytes, 0),
  },
  byPath,
  contentTypes: byType,
  violationsBySurface: bySurface,
  missingCount: missing.length,
  errors: errors.slice(0, 20),
  rows,
};

writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);

const o = summary.outcome;
console.log(`memory files ${rows.length} across ${o.reposWithMemory}/${pool.repos.length} repos (${o.bytesTotal} bytes)`);
console.log(`untouched ${o.untouched}/${rows.length} (${(o.untouchedShare * 100).toFixed(1)}%)`);
console.log(`median ratio ${o.medianRatio.toFixed(3)} (p10 ${o.p10Ratio.toFixed(3)}, p90 ${o.p90Ratio.toFixed(3)})`);
console.log(`below 1600 bytes: ${o.below1600Bytes}; reduced below 90%: ${o.reducedBelow90pct}; contract ok: ${o.contractOk}`);
console.log(`by path: ${JSON.stringify(byPath)}`);
console.log(`content types: ${JSON.stringify(byType)}`);
console.log(`errors: ${errors.length}${errors.length ? ` (first: ${errors[0]})` : ""}`);
