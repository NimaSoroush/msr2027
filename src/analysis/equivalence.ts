/**
 * Equivalence analysis: paired TOST with a cluster-robust standard error, a repository-clustered
 * bootstrap, total-variation distance between activation distributions, exact McNemar, the C0/C0b
 * noise floor, and Holm correction.
 *
 * No statistics package exists in this project, so the Student-t quantile is computed here from the
 * incomplete beta function. Everything is deterministic: the bootstrap is seeded, so a reported
 * interval can be reproduced from the same values and clusters.
 */
import { mulberry32 } from "../prs/sample.ts";

export type TostResult = {
  estimate: number;
  ci90: [number, number];
  pLower: number;
  pUpper: number;
  equivalent: boolean;
};

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Continued fraction for the incomplete beta function (Numerical Recipes `betacf`). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront = Math.log(1) - (lgamma(a + b) - lgamma(a) - lgamma(b)) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lnFront);
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Lanczos log-gamma, accurate enough for the degrees of freedom used here. */
function lgamma(z: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Upper tail of Student-t: P(T > t) for t >= 0. */
export function tUpperTail(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  if (t <= 0) return 1 - tUpperTail(-t, df);
  return 0.5 * incompleteBeta(df / 2, 0.5, df / (df + t * t));
}

/** Two-sided critical value: t such that P(|T| > t) = 1 - level. Bisection, deterministic. */
export function tQuantile(level: number, df: number): number {
  if (df <= 0) throw new Error("tQuantile needs positive degrees of freedom");
  const target = (1 - level) / 2;
  let lo = 0;
  let hi = 1;
  while (tUpperTail(hi, df) > target) {
    hi *= 2;
    if (hi > 1e6) throw new Error("tQuantile did not bracket the tail");
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tUpperTail(mid, df) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Paired TOST. `clusters` groups the differences by repository; when given, the standard error is the
 * cluster-robust CR0 form with G/(G-1) correction and the t quantile uses G-1 df, because PRs inside
 * one repo are not independent draws.
 */
export function tost(p: { diffs: number[]; clusters?: string[]; margin: number; alpha?: number }): TostResult {
  const { diffs, clusters, margin, alpha = 0.05 } = p;
  if (diffs.length === 0) throw new Error("tost needs at least one paired difference");
  if (!(margin > 0)) throw new Error("tost needs a positive margin");
  if (clusters && clusters.length !== diffs.length) throw new Error("one cluster label per difference is required");
  const n = diffs.length;
  const estimate = mean(diffs);

  let se: number;
  let df: number;
  if (clusters) {
    const groups = new Map<string, number[]>();
    diffs.forEach((d, i) => {
      const key = clusters[i];
      const g = groups.get(key);
      if (g) g.push(d);
      else groups.set(key, [d]);
    });
    const G = groups.size;
    if (G < 2) throw new Error("cluster-robust standard error needs at least two clusters");
    let acc = 0;
    for (const g of groups.values()) {
      const within = g.reduce((s, d) => s + d, 0);
      acc += (within - g.length * estimate) ** 2;
    }
    se = Math.sqrt((G / (G - 1)) * acc) / n;
    df = G - 1;
  } else {
    const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - estimate) ** 2, 0) / (n - 1));
    se = sd / Math.sqrt(n);
    df = n - 1;
  }

  // Variance computed from a constant vector can come out at ~1e-17 rather than exactly 0, so the
  // guard is scale-aware: a standard error this small carries no information about the margin.
  const scale = Math.max(1, Math.abs(estimate), margin);
  if (!Number.isFinite(se) || se <= 1e-12 * scale) {
    console.warn(
      `tost: degenerate standard error (se=${se}) with estimate ${estimate}; refusing to declare equivalence`,
    );
    return { estimate, ci90: [estimate, estimate], pLower: 1, pUpper: 1, equivalent: false };
  }

  const q = tQuantile(0.9, df);
  const ci90: [number, number] = [estimate - q * se, estimate + q * se];
  const pLower = tUpperTail((estimate + margin) / se, df);
  const pUpper = tUpperTail((margin - estimate) / se, df);
  return { estimate, ci90, pLower, pUpper, equivalent: pLower < alpha && pUpper < alpha };
}

/** Percentile bootstrap over whole clusters; `n` resamples, seeded so the interval is reproducible. */
export function clusterBootstrap(p: {
  values: number[];
  clusters: string[];
  n?: number;
  seed?: number;
}): [number, number] {
  const { values, clusters, n = 2000, seed = 20261223 } = p;
  if (values.length === 0) throw new Error("clusterBootstrap needs at least one value");
  if (clusters.length !== values.length) throw new Error("one cluster label per value is required");
  const groups = new Map<string, number[]>();
  values.forEach((v, i) => {
    const key = clusters[i];
    const g = groups.get(key);
    if (g) g.push(v);
    else groups.set(key, [v]);
  });
  const keys = [...groups.keys()];
  if (keys.length < 2) throw new Error("clusterBootstrap needs at least two clusters");
  const rng = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < n; r++) {
    let sum = 0;
    let count = 0;
    for (let k = 0; k < keys.length; k++) {
      const g = groups.get(keys[Math.floor(rng() * keys.length)])!;
      for (const v of g) {
        sum += v;
        count++;
      }
    }
    means.push(sum / count);
  }
  means.sort((a, b) => a - b);
  const at = (q: number): number => means[Math.min(means.length - 1, Math.max(0, Math.floor(q * means.length)))];
  return [at(0.05), at(0.95)];
}

/** Total variation distance between two distributions over skill ids; missing keys count as 0. */
export function totalVariation(a: Map<string, number>, b: Map<string, number>): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let d = 0;
  for (const k of keys) d += Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0));
  return d / 2;
}

/** Two-sided exact McNemar p-value on the discordant pairs `b` and `c`. */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let tail = 0;
  let logChoose = 0; // log C(n, 0)
  for (let i = 0; i <= k; i++) {
    if (i > 0) logChoose += Math.log(n - i + 1) - Math.log(i);
    tail += Math.exp(logChoose - n * Math.log(2));
  }
  return Math.min(1, 2 * tail);
}

/** The C0/C0b control pair: how far two no-treatment runs drift from each other. */
export function noiseFloor(pairs: { c0: number; c0b: number }[]): { meanDiff: number; flipRate: number } {
  if (pairs.length === 0) throw new Error("noiseFloor needs at least one pair");
  const meanDiff = pairs.reduce((s, p) => s + Math.abs(p.c0 - p.c0b), 0) / pairs.length;
  const flipRate = pairs.filter((p) => p.c0 !== p.c0b).length / pairs.length;
  return { meanDiff, flipRate };
}

/** Holm step-down adjusted p-values, in the input order. */
export function holm(pValues: number[]): number[] {
  if (pValues.length === 0) throw new Error("holm needs at least one p-value");
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(m);
  let running = 0;
  order.forEach(({ p, i }, rank) => {
    running = Math.max(running, Math.min(1, p * (m - rank)));
    adjusted[i] = running;
  });
  return adjusted;
}
