import { createHash } from "node:crypto";
import type { PoolRepo } from "./corpus.ts";
import type { PrRow } from "./specmine.ts";

export type SampledPr = {
  repo: string;
  prNumber: number;
  stratum: string;
  skillCountQuartile: number;
  sizeBucket: string;
  role: "analysis" | "oversample" | "pilot";
};

export type SampleManifest = {
  seed: number;
  n: number;
  poolSize: number;
  strata: Record<string, number>;
  sha256: string;
  /** Code-changing PRs removed by the SKILL.md eligibility rule, before the draw. */
  excludedFromFrame: number;
};

type Candidate = {
  pr: PrRow;
  stratum: string;
  skillCountQuartile: number;
  sizeBucket: string;
  rank: number;
};

/** mulberry32: small, seedable, and identical across platforms — the manifest depends on it. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over UTF-16 code units: no locale, no history, so a PR's rank depends only on its key. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= s.charCodeAt(i) >>> 8;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const cuts = (values: number[]): number[] => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 0, 0];
  return [0.25, 0.5, 0.75].map((p) => sorted[Math.floor(p * (sorted.length - 1))]);
};

const bucketOf = (c: number[], value: number): number => 1 + c.filter((cut) => value > cut).length;

const QUARTILE_LABEL = ["q1", "q2", "q3", "q4"] as const;

/**
 * Take `k` candidates in proportion to stratum size, largest-remainder rounding so the total is
 * exactly `k`. Groups keep their ranked order, so which member of a stratum is chosen is still
 * governed by the seed.
 */
function takeStratified(candidates: Candidate[], k: number): Candidate[] {
  if (k <= 0 || candidates.length === 0) return [];
  if (k >= candidates.length) return [...candidates];

  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const g = groups.get(c.stratum);
    if (g) g.push(c);
    else groups.set(c.stratum, [c]);
  }

  const total = candidates.length;
  const names = [...groups.keys()].sort();
  const exact = names.map((name) => (k * groups.get(name)!.length) / total);
  const quota = exact.map((x) => Math.floor(x));
  let left = k - quota.reduce((a, b) => a + b, 0);
  const order = names
    .map((_, i) => i)
    .sort((a, b) => exact[b] - quota[b] - (exact[a] - quota[a]) || names[a].localeCompare(names[b]));
  for (let i = 0; left > 0; i = (i + 1) % order.length) {
    const idx = order[i];
    if (quota[idx] < groups.get(names[idx])!.length) {
      quota[idx]++;
      left--;
    }
  }

  const out: Candidate[] = [];
  for (const [i, name] of names.entries()) out.push(...groups.get(name)!.slice(0, quota[i]));
  return out;
}

export function drawSample(p: {
  repos: PoolRepo[];
  prs: PrRow[];
  seed?: number;
  n?: number;
  oversamplePct?: number;
  nPilot?: number;
  /** Frame eligibility: PRs whose id (`repo:prNumber`) is in this set are never drawn. */
  exclude?: ReadonlySet<string>;
}): { sample: SampledPr[]; manifest: SampleManifest } {
  const seed = p.seed ?? 20261223;
  const n = p.n ?? 200;
  const oversamplePct = p.oversamplePct ?? 20;
  const nPilot = p.nPilot ?? 15;

  // The frame is the code-changing pool (spec §8.3): documentation-only PRs are counted elsewhere,
  // never drawn, and `poolSize` reports the frame so the manifest cannot be read as the population.
  // `exclude` carries the second eligibility rule — PRs that edit a SKILL.md — so it removes them
  // from the frame *before* the draw rather than after it, which would silently shrink n.
  const codePrs = p.prs.filter((pr) => pr.touchesCode);
  const eligible = codePrs.filter((pr) => !(p.exclude?.has(`${pr.repo}:${pr.prNumber}`) ?? false));
  const frameRepos = new Set(eligible.map((pr) => pr.repo));
  const skillCuts = cuts(p.repos.filter((r) => frameRepos.has(r.repo)).map((r) => r.nTextSkills));
  const sizeCuts = cuts(eligible.map((pr) => pr.nFiles + pr.nCodeFiles));
  const skillByRepo = new Map(p.repos.map((r) => [r.repo, r.nTextSkills]));

  const rng = mulberry32(seed);
  const offset = Math.floor(rng() * 2 ** 32);

  const ranked: Candidate[] = eligible
    .map((pr) => {
      const skillCountQuartile = bucketOf(skillCuts, skillByRepo.get(pr.repo) ?? 0);
      const sizeBucket = QUARTILE_LABEL[bucketOf(sizeCuts, pr.nFiles + pr.nCodeFiles) - 1];
      return {
        pr,
        skillCountQuartile,
        sizeBucket,
        stratum: `${skillCountQuartile}:${sizeBucket}`,
        rank: (hashString(`${pr.repo}:${pr.prNumber}`) ^ offset) >>> 0,
      };
    })
    .sort((a, b) => a.rank - b.rank || `${a.pr.repo}:${a.pr.prNumber}`.localeCompare(`${b.pr.repo}:${b.pr.prNumber}`));

  // Pilot first, from the complement, and removed before the analysis draw: disjointness is
  // structural, not a post-hoc check.
  const pilot = ranked.slice(0, Math.min(nPilot, ranked.length));
  const pilotKeys = new Set(pilot.map((c) => `${c.pr.repo}:${c.pr.prNumber}`));
  let rest = ranked.filter((c) => !pilotKeys.has(`${c.pr.repo}:${c.pr.prNumber}`));

  const analysis = takeStratified(rest, n);
  const analysisKeys = new Set(analysis.map((c) => `${c.pr.repo}:${c.pr.prNumber}`));
  rest = rest.filter((c) => !analysisKeys.has(`${c.pr.repo}:${c.pr.prNumber}`));
  const oversample = takeStratified(rest, Math.round((n * oversamplePct) / 100));

  const toRow = (c: Candidate, role: SampledPr["role"]): SampledPr => ({
    repo: c.pr.repo,
    prNumber: c.pr.prNumber,
    stratum: c.stratum,
    skillCountQuartile: c.skillCountQuartile,
    sizeBucket: c.sizeBucket,
    role,
  });
  const sample = [
    ...pilot.map((c) => toRow(c, "pilot")),
    ...analysis.map((c) => toRow(c, "analysis")),
    ...oversample.map((c) => toRow(c, "oversample")),
  ];

  const strata: Record<string, number> = {};
  for (const c of analysis) strata[c.stratum] = (strata[c.stratum] ?? 0) + 1;

  const payload = { seed, n, oversamplePct, nPilot, poolSize: eligible.length, strata, sample };
  const sha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  return {
    sample,
    manifest: {
      seed,
      n,
      poolSize: eligible.length,
      strata,
      sha256,
      excludedFromFrame: codePrs.length - eligible.length,
    },
  };
}
