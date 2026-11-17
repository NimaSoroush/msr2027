import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planReplays, assertPrereg, runPlan, CostExceeded, PreregMissing } from "../src/replay/plan.ts";
import type { Transcript } from "../src/replay/types.ts";

const sample = [
  { repo: "o/a", prNumber: 1, stratum: "s", skillCountQuartile: 1, sizeBucket: "m", role: "analysis" as const },
  { repo: "o/a", prNumber: 2, stratum: "s", skillCountQuartile: 1, sizeBucket: "m", role: "pilot" as const },
];

describe("planReplays", () => {
  it("gives each analysis PR five H1 replays plus two H2", () => {
    const plan = planReplays({ sample, c4Subset: 1, h2Subset: 1 });
    const forPr = plan.filter((r) => r.prNumber === 1);
    // C4 is description-only too, so it counts as H1 work but is not one of the five arms.
    expect(forPr.filter((r) => r.harness === "H1" && r.condition !== "C4").length).toBe(5);
    expect(forPr.filter((r) => r.condition === "C4").length).toBe(1);
    expect(forPr.filter((r) => r.harness === "H2").length).toBe(2);
  });
  it("never plans an analysis condition for a pilot PR", () => {
    const plan = planReplays({ sample, c4Subset: 1, h2Subset: 1 });
    const pilot = plan.filter((r) => r.prNumber === 2);
    expect(pilot.every((r) => r.harness === "H1")).toBe(true);
    expect(pilot.length).toBe(5);
  });
  it("orders conditions deterministically per PR", () => {
    const a = planReplays({ sample, seed: 20261223, c4Subset: 1, h2Subset: 1 }).map((r) => `${r.prNumber}:${r.condition}`).join();
    const b = planReplays({ sample, seed: 20261223, c4Subset: 1, h2Subset: 1 }).map((r) => `${r.prNumber}:${r.condition}`).join();
    expect(a).toBe(b);
  });
  it("sizes the full grid at 1,200 replays", () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ repo: "o/a", prNumber: i, stratum: "s", skillCountQuartile: 1, sizeBucket: "m", role: "analysis" as const }));
    // 200 × 5 description-only + 80 × 2 full-text + 40 destructive
    expect(planReplays({ sample: full, c4Subset: 40, h2Subset: 80, seed: 20261223 }).length).toBe(1200);
  });
});

describe("runPlan", () => {
  const frozen = () => {
    const dir = mkdtempSync("/tmp/run-");
    const path = join(dir, "prereg.json");
    const p = { hypotheses: ["H1"], primary: "recall", margin: 0.1, alpha: 0.05, n: 200, seed: 20261223, exclusions: [], frozen: true, sha256: "0".repeat(64) };
    writeFileSync(path, JSON.stringify(p));
    return path;
  };
  const transcript = (id: string): Transcript => ({
    pr: { repo: "o/a", prNumber: 1 }, condition: "C0", harness: "H1", turns: 1,
    toolCalls: [], activations: [], termination: "final", tokens: { in: 1_000_000, out: 0 },
  });
  const plan = planReplays({ sample, c4Subset: 0, h2Subset: 0 });

  it("resumes from the JSONL by replay id", async () => {
    const dir = mkdtempSync("/tmp/run-");
    const jsonl = join(dir, "out.jsonl");
    writeFileSync(jsonl, `${JSON.stringify({ replayId: plan[0].replayId })}\n`);
    const called: string[] = [];
    const summary = await runPlan({
      plan, prereg: frozen(), jsonl, root: dir, budgetUsd: 100,
      price: { inputPerMTok: 1, outputPerMTok: 0 },
      async run(r) {
        called.push(r.replayId);
        return transcript(r.replayId);
      },
    });
    expect(summary.skipped).toBe(1);
    expect(called).not.toContain(plan[0].replayId);
    expect(called.length).toBe(plan.length - 1);
  });

  it("stops at the USD ceiling and keeps the record", async () => {
    const dir = mkdtempSync("/tmp/run-");
    const jsonl = join(dir, "out.jsonl");
    await expect(
      runPlan({
        plan, prereg: frozen(), jsonl, root: dir, budgetUsd: 1,
        price: { inputPerMTok: 10, outputPerMTok: 0 },
        async run(r) { return transcript(r.replayId); },
      }),
    ).rejects.toThrow(CostExceeded);
    expect(readFileSync(jsonl, "utf8").trim().split("\n").length).toBe(1);
  });

  it("aborts on an invariant mismatch instead of skipping the replay", async () => {
    const dir = mkdtempSync("/tmp/run-");
    let calls = 0;
    await expect(
      runPlan({
        plan, prereg: frozen(), jsonl: join(dir, "out.jsonl"), root: dir, budgetUsd: 100,
        price: { inputPerMTok: 0, outputPerMTok: 0 },
        async run(r) { calls++; return transcript(r.replayId); },
        invariants: () => ["description hash moved"],
      }),
    ).rejects.toThrow(/invariant mismatch/);
    expect(calls).toBe(1);
  });
});

describe("assertPrereg", () => {
  it("throws when the plan is absent", () => {
    expect(() => assertPrereg("/tmp/definitely-missing.json")).toThrow(PreregMissing);
  });
  it("throws when the margin is missing", () => {
    const dir = mkdtempSync("/tmp/pre-");
    writeFileSync(join(dir, "p.json"), JSON.stringify({ primary: "recall" }));
    expect(() => assertPrereg(join(dir, "p.json"))).toThrow(/margin/);
  });
  it("accepts the frozen plan", () => {
    const dir = mkdtempSync("/tmp/pre-");
    const p = { hypotheses: ["H1"], primary: "recall", margin: 0.10, alpha: 0.05, n: 200, seed: 20261223, exclusions: [], frozen: true, sha256: "0".repeat(64) };
    writeFileSync(join(dir, "p.json"), JSON.stringify(p));
    expect(() => assertPrereg(join(dir, "p.json"))).not.toThrow();
  });
});
