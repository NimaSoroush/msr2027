import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONDITIONS, H1_CONDITIONS, type Condition } from "../material/workdir.ts";
import { hashString, type SampledPr } from "../prs/sample.ts";
import type { Harness, Transcript } from "./types.ts";

export { CONDITIONS, H1_CONDITIONS };
export type { Condition };

export const DEFAULT_SEED = 20261223;
export const DEFAULT_C4_SUBSET = 40;
export const DEFAULT_H2_SUBSET = 80;

/** H2 is a routing comparison, so it runs the two ends of the body contrast, not every arm. */
export const H2_CONDITIONS: readonly Condition[] = Object.freeze(["C0", "C1"]);

export type ReplayPlan = {
  replayId: string;
  repo: string;
  prNumber: number;
  stratum: string;
  role: SampledPr["role"];
  condition: Condition;
  harness: Harness;
};

const ids = (s: SampledPr): string => `${s.repo}#${s.prNumber}`;

/**
 * Build the replay grid.
 *
 * Every analysis PR gets the five description-only arms. C4 is a positive control and is spent on a
 * separate 40-PR subset rather than on all 200; H2 is spent on 80 PRs and only on C0/C1. Pilot PRs
 * get the five H1 arms and nothing else, so they exercise the pipeline without entering the
 * analysis grid.
 *
 * Order within a PR is by a hash of (seed, PR, harness, condition): the sequence is reproducible
 * from the seed but does not put C0 first every time, which would let a cache or a warm session
 * favour the baseline.
 */
export function planReplays(p: {
  sample: SampledPr[];
  seed?: number;
  c4Subset?: number;
  h2Subset?: number;
}): ReplayPlan[] {
  const seed = p.seed ?? DEFAULT_SEED;
  const c4Subset = p.c4Subset ?? DEFAULT_C4_SUBSET;
  const h2Subset = p.h2Subset ?? DEFAULT_H2_SUBSET;

  const analysis = p.sample.filter((s) => s.role === "analysis");
  const subsetKey = (s: SampledPr): number => hashString(`${seed}:${ids(s)}`);
  const ordered = [...analysis].sort((a, b) => subsetKey(a) - subsetKey(b));
  const c4Ids = new Set(ordered.slice(0, c4Subset).map(ids));
  const h2Ids = new Set(ordered.slice(0, h2Subset).map(ids));

  const orderKey = (id: string, harness: Harness, condition: Condition): number =>
    hashString(`${seed}:${id}:${harness}:${condition}`);

  const plan: ReplayPlan[] = [];
  for (const pr of p.sample) {
    const id = ids(pr);
    const arms: { harness: Harness; condition: Condition }[] = H1_CONDITIONS.map((condition) => ({
      harness: "H1" as const,
      condition,
    }));

    if (pr.role === "analysis") {
      if (c4Ids.has(id)) arms.push({ harness: "H1", condition: "C4" });
      if (h2Ids.has(id)) {
        for (const condition of H2_CONDITIONS) arms.push({ harness: "H2", condition });
      }
    }

    arms.sort((a, b) => orderKey(id, a.harness, a.condition) - orderKey(id, b.harness, b.condition));

    for (const arm of arms) {
      plan.push({
        replayId: `${id}:${arm.condition}:${arm.harness}`,
        repo: pr.repo,
        prNumber: pr.prNumber,
        stratum: pr.stratum,
        role: pr.role,
        condition: arm.condition,
        harness: arm.harness,
      });
    }
  }
  return plan;
}

export class PreregMissing extends Error {}
export class CostExceeded extends Error {}

const REQUIRED = ["hypotheses", "primary", "margin", "alpha", "n", "seed", "exclusions", "frozen", "sha256"] as const;

/**
 * Refuse to run without a frozen plan.
 *
 * Required fields are checked one by one so the error names what is absent. The file's own hash is
 * checked against a `.sha256` sidecar when one exists; editing the plan after the freeze then fails
 * loudly instead of changing the analysis quietly. The real prereg ships with that sidecar and its
 * hash is also recorded in `REPRODUCE.md`.
 */
export function assertPrereg(path: string): void {
  if (!existsSync(path)) throw new PreregMissing(`prereg not found: ${path}`);
  const text = readFileSync(path, "utf8");

  let plan: Record<string, unknown>;
  try {
    plan = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`prereg is not valid JSON: ${path}`);
  }

  const missing = REQUIRED.filter((key) => !(key in plan));
  if (missing.length) throw new Error(`prereg is missing ${missing.join(", ")}`);
  if (plan.frozen !== true) throw new Error("prereg is not frozen");
  if (typeof plan.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(plan.sha256)) {
    throw new Error("prereg sha256 must be 64 lowercase hex characters");
  }

  const sidecar = `${path}.sha256`;
  if (existsSync(sidecar)) {
    const expected = readFileSync(sidecar, "utf8").trim();
    const actual = createHash("sha256").update(text).digest("hex");
    if (expected !== actual) {
      throw new Error(`prereg hash mismatch: expected ${expected.slice(0, 12)}…, file is ${actual.slice(0, 12)}…`);
    }
  }
}

export type PlanSummary = {
  ran: number;
  skipped: number;
  usd: number;
  terminations: Record<string, number>;
};

/**
 * Execute a plan.
 *
 * `run` is called once per replay and must build a fresh model client and workdir; no message
 * history crosses replays. `runPlan` owns what it can enforce cheaply — the prereg gate, resume by
 * replay id, the USD ceiling, and abort-on-invariant-mismatch — and refuses to skip a broken replay
 * quietly.
 */
export async function runPlan(p: {
  plan: ReplayPlan[];
  prereg: string;
  jsonl: string;
  root: string;
  budgetUsd: number;
  price: { inputPerMTok: number; outputPerMTok: number };
  run(r: ReplayPlan, dir: string): Promise<Transcript>;
  invariants?(r: ReplayPlan, t: Transcript): string[];
}): Promise<PlanSummary> {
  assertPrereg(p.prereg);
  mkdirSync(dirname(p.jsonl), { recursive: true });

  const done = new Set<string>();
  if (existsSync(p.jsonl)) {
    for (const line of readFileSync(p.jsonl, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as { replayId?: string };
        if (record.replayId) done.add(record.replayId);
      } catch {
        // A torn last line from a killed process is expected; the replay it belongs to is simply
        // not marked done and will run again.
      }
    }
  }

  const summary: PlanSummary = { ran: 0, skipped: 0, usd: 0, terminations: {} };

  for (const replay of p.plan) {
    if (done.has(replay.replayId)) {
      summary.skipped++;
      continue;
    }

    const dir = join(p.root, replay.replayId.replace(/[^A-Za-z0-9._-]/g, "_"));
    mkdirSync(dir, { recursive: true });

    const transcript = await p.run(replay, dir);
    const usd =
      (transcript.tokens.in / 1_000_000) * p.price.inputPerMTok +
      (transcript.tokens.out / 1_000_000) * p.price.outputPerMTok;
    summary.usd += usd;
    summary.ran++;
    summary.terminations[transcript.termination] = (summary.terminations[transcript.termination] ?? 0) + 1;

    appendFileSync(
      join(p.jsonl),
      `${JSON.stringify({
        replayId: replay.replayId,
        condition: replay.condition,
        harness: replay.harness,
        termination: transcript.termination,
        tokensIn: transcript.tokens.in,
        tokensOut: transcript.tokens.out,
        usd,
      })}\n`,
    );

    const violations = p.invariants?.(replay, transcript) ?? [];
    if (violations.length) {
      throw new Error(`invariant mismatch for ${replay.replayId}: ${violations.join("; ")}`);
    }

    if (summary.usd > p.budgetUsd) {
      throw new CostExceeded(`spent $${summary.usd.toFixed(4)} > ceiling $${p.budgetUsd.toFixed(2)}`);
    }
  }

  return summary;
}
