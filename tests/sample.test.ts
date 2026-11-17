import { describe, expect, it } from "vitest";
import { drawSample, hashString, mulberry32 } from "../src/prs/sample.ts";

const prs = Array.from({ length: 40 }, (_, i) => ({
  tool: "k",
  repo: i % 2 ? "o/a" : "o/b",
  prNumber: i + 1,
  title: "t",
  mergedAt: "",
  baseBranch: "main",
  nFiles: 1 + (i % 5),
  nCodeFiles: 1,
  touchesCode: true,
  additions: 10 * (i % 7),
  deletions: i % 3,
}));

const repos = [
  { repo: "o/a", nPrs: 20, nCodePrs: 20, nSkills: 3, nTextSkills: 3 },
  { repo: "o/b", nPrs: 20, nCodePrs: 20, nSkills: 40, nTextSkills: 40 },
];

describe("sample", () => {
  it("is deterministic for a seed", () => {
    expect(drawSample({ repos, prs, seed: 20261223, n: 10 }).sample).toEqual(
      drawSample({ repos, prs, seed: 20261223, n: 10 }).sample,
    );
  });

  it("changes with the seed", () => {
    const a = drawSample({ repos, prs, seed: 20261223, n: 10 })
      .sample.map((s) => s.prNumber)
      .join();
    const b = drawSample({ repos, prs, seed: 7, n: 10 })
      .sample.map((s) => s.prNumber)
      .join();
    expect(a).not.toBe(b);
  });

  it("never repeats a PR", () => {
    const s = drawSample({ repos, prs, seed: 1, n: 30 }).sample;
    expect(new Set(s.map((x) => `${x.repo}#${x.prNumber}`)).size).toBe(s.length);
  });

  it("keeps the pilot disjoint from the analysis sample", () => {
    const { sample } = drawSample({ repos, prs, seed: 20261223, n: 20, nPilot: 5, oversamplePct: 20 });
    const key = (x: { repo: string; prNumber: number }) => `${x.repo}#${x.prNumber}`;
    const analysis = new Set(sample.filter((x) => x.role !== "pilot").map(key));
    for (const p of sample.filter((x) => x.role === "pilot")) expect(analysis.has(key(p))).toBe(false);
  });

  it("reserves the requested oversample", () => {
    const { sample } = drawSample({ repos, prs, seed: 20261223, n: 20, oversamplePct: 20 });
    expect(sample.filter((x) => x.role === "oversample").length).toBe(4);
  });

  it("hashes the sample bytes stably", () => {
    expect(drawSample({ repos, prs, seed: 20261223, n: 10 }).manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("removes excluded PRs from the frame before drawing", () => {
    const excluded = new Set([`${prs[0].repo}:${prs[0].prNumber}`, `${prs[1].repo}:${prs[1].prNumber}`]);
    const { sample, manifest } = drawSample({ repos, prs, seed: 1, n: 30, exclude: excluded });
    expect(manifest.poolSize).toBe(prs.length - 2);
    expect(manifest.excludedFromFrame).toBe(2);
    for (const s of sample) expect(excluded.has(`${s.repo}:${s.prNumber}`)).toBe(false);
  });

  it("never draws a documentation-only PR", () => {
    const mixed = [...prs, ...prs.map((p) => ({ ...p, prNumber: p.prNumber + 100, touchesCode: false }))];
    const { sample, manifest } = drawSample({ repos, prs: mixed, seed: 1, n: 40 });
    const docsOnly = new Set(mixed.filter((p) => !p.touchesCode).map((p) => `${p.repo}#${p.prNumber}`));
    for (const s of sample) expect(docsOnly.has(`${s.repo}#${s.prNumber}`)).toBe(false);
    expect(manifest.poolSize).toBe(prs.length);
  });
});

describe("prng", () => {
  it("repeats the same stream for the same seed and differs for another", () => {
    const take = (seed: number) => {
      const next = mulberry32(seed);
      return Array.from({ length: 4 }, () => next());
    };
    const a = take(42);
    expect(a).toEqual(take(42));
    expect(a).not.toEqual(take(43));
    for (const x of a) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("hashes the same string to the same 32-bit value", () => {
    expect(hashString("o/a:7")).toBe(hashString("o/a:7"));
    expect(hashString("o/a:7")).not.toBe(hashString("o/a:8"));
    expect(hashString("o/a:7")).toBeGreaterThanOrEqual(0);
    expect(hashString("o/a:7")).toBeLessThan(2 ** 32);
  });
});
