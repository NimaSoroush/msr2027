import { describe, it, expect, vi } from "vitest";
import {
  tost,
  clusterBootstrap,
  totalVariation,
  mcnemarExact,
  noiseFloor,
  holm,
} from "../src/analysis/equivalence.ts";

describe("tost", () => {
  it("declares equivalence for a null difference at n=200", () => {
    const diffs = Array.from({ length: 200 }, (_, i) => (i % 5 === 0 ? 0.1 : i % 7 === 0 ? -0.1 : 0));
    const r = tost({ diffs, margin: 0.1 });
    expect(r.equivalent).toBe(true);
    expect(r.ci90[0]).toBeGreaterThan(-0.11);
  });

  it("fails equivalence for a systematic drop", () => {
    const diffs = Array.from({ length: 200 }, () => -0.15);
    expect(tost({ diffs, margin: 0.1 }).equivalent).toBe(false);
  });

  it("is not equivalent when the CI is too wide", () => {
    const diffs = Array.from({ length: 8 }, (_, i) => (i % 2 ? 0.4 : -0.4));
    expect(tost({ diffs, margin: 0.1 }).equivalent).toBe(false);
  });

  it("refuses to call a zero-variance shift equivalent", () => {
    const diffs = Array.from({ length: 200 }, () => 0.09);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(tost({ diffs, margin: 0.1 }).equivalent).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("widens the interval for clustered data", () => {
    // 20 clusters of 10 identical diffs: the naive SE sees 200 independent points and is far too small.
    const diffs: number[] = [];
    const clusters: string[] = [];
    for (let g = 0; g < 20; g++) {
      for (let i = 0; i < 10; i++) {
        diffs.push(g % 2 === 0 ? 0.08 : -0.08);
        clusters.push(`repo-${g}`);
      }
    }
    const naive = tost({ diffs, margin: 0.1 });
    const clustered = tost({ diffs, clusters, margin: 0.1 });
    expect(clustered.ci90[1] - clustered.ci90[0]).toBeGreaterThan(naive.ci90[1] - naive.ci90[0]);
  });

  it("rejects an empty difference vector instead of returning a verdict", () => {
    expect(() => tost({ diffs: [], margin: 0.1 })).toThrow();
  });
});

describe("clusterBootstrap", () => {
  it("is deterministic under a seed and brackets the mean", () => {
    const values = [0.1, -0.2, 0.3, 0.0, 0.5, -0.1, 0.2, 0.05];
    const clusters = ["a", "a", "b", "b", "c", "c", "d", "d"];
    const one = clusterBootstrap({ values, clusters, n: 500, seed: 7 });
    const two = clusterBootstrap({ values, clusters, n: 500, seed: 7 });
    expect(one).toEqual(two);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(one[0]).toBeLessThanOrEqual(mean);
    expect(one[1]).toBeGreaterThanOrEqual(mean);
  });

  it("is wider with few clusters than with many", () => {
    const few = clusterBootstrap({
      values: [0.0, 0.0, 0.4, 0.4, 0.1, 0.1],
      clusters: ["a", "a", "b", "b", "c", "c"],
      n: 400,
      seed: 3,
    });
    const many = clusterBootstrap({
      values: Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.05 : 0.1)),
      clusters: Array.from({ length: 40 }, (_, i) => `c${i}`),
      n: 400,
      seed: 3,
    });
    expect(few[1] - few[0]).toBeGreaterThan(many[1] - many[0]);
  });

  it("requires one cluster label per value", () => {
    expect(() => clusterBootstrap({ values: [1, 2], clusters: ["a"] })).toThrow();
  });
});

describe("totalVariation", () => {
  it("is 0 for identical distributions and 1 for disjoint", () => {
    const a = new Map([["x", 1]]);
    expect(totalVariation(a, new Map([["x", 1]]))).toBe(0);
    expect(totalVariation(a, new Map([["y", 1]]))).toBe(1);
  });

  it("is symmetric", () => {
    const a = new Map([["x", 0.7], ["y", 0.3]]);
    const b = new Map([["x", 0.5], ["y", 0.5]]);
    expect(totalVariation(a, b)).toBeCloseTo(totalVariation(b, a), 9);
  });

  it("is 0.1 for a distribution moved by 5 points each way", () => {
    const a = new Map([["x", 0.4], ["y", 0.6]]);
    const b = new Map([["x", 0.5], ["y", 0.5]]);
    expect(totalVariation(a, b)).toBeCloseTo(0.1, 9);
  });
});

describe("mcnemarExact", () => {
  it("is 1 for symmetric discordance", () => {
    expect(mcnemarExact(10, 10)).toBe(1);
  });
  it("is small for a lopsided control", () => {
    expect(mcnemarExact(0, 20)).toBeLessThan(0.001);
  });
  it("is 1 when nothing is discordant", () => {
    expect(mcnemarExact(0, 0)).toBe(1);
  });
  it("is symmetric in its arguments", () => {
    expect(mcnemarExact(3, 17)).toBeCloseTo(mcnemarExact(17, 3), 12);
  });
});

describe("noiseFloor", () => {
  it("reports the mean absolute difference and flip rate", () => {
    const r = noiseFloor([{ c0: 1, c0b: 1 }, { c0: 1, c0b: 0 }, { c0: 0.5, c0b: 0.5 }]);
    expect(r.meanDiff).toBeCloseTo(1 / 3, 5);
    expect(r.flipRate).toBeCloseTo(1 / 3, 5);
  });

  it("is zero when the two control arms agree", () => {
    const r = noiseFloor([{ c0: 0.2, c0b: 0.2 }, { c0: 1, c0b: 1 }]);
    expect(r.meanDiff).toBe(0);
    expect(r.flipRate).toBe(0);
  });

  it("rejects an empty set of pairs", () => {
    expect(() => noiseFloor([])).toThrow();
  });
});

describe("holm", () => {
  it("is monotone", () => {
    const out = holm([0.01, 0.04, 0.03]);
    expect(out[0]).toBeCloseTo(0.03, 9);
    expect(Math.max(...out)).toBeLessThanOrEqual(1);
  });

  it("never lowers a p-value", () => {
    const p = [0.001, 0.2, 0.05, 0.9];
    const out = holm(p);
    p.forEach((v, i) => expect(out[i]).toBeGreaterThanOrEqual(v));
  });

  it("leaves a single p-value unchanged", () => {
    expect(holm([0.04])[0]).toBeCloseTo(0.04, 12);
  });

  it("rejects an empty list", () => {
    expect(() => holm([])).toThrow();
  });
});

// Step 5: the test must be powered to the margin it is judged against.
describe("sensitivity", () => {
  // Half the PRs move by 2 pp, half by 0: the mean shift is pp with a standard deviation of pp.
  const shift = (pp: number, n = 200): number[] =>
    Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 2 * pp : 0));

  it("calls a 5 pp shift equivalent and a 12 pp shift not equivalent", () => {
    const small = shift(0.05);
    const large = shift(0.12);
    expect(tost({ diffs: small, margin: 0.1 }).equivalent).toBe(true);
    expect(tost({ diffs: large, margin: 0.1 }).equivalent).toBe(false);
  });
});
