/**
 * Gold sets and outcomes.
 *
 * `buildGold` is the study's load-bearing definition, so nothing in it may come from a transcript:
 * required calls are derived from the PR's own `pr_files` rows plus the labelled needed skill. If
 * any part of the gold set were read back out of what an agent did, recall could be inflated by the
 * treatment and the contrast would collapse.
 */
import { writeFileSync } from "node:fs";
import type { Condition } from "../material/workdir.ts";
import type { SampledPr } from "../prs/sample.ts";
import type { PrFileRow } from "../prs/specmine.ts";
import type { Harness, Transcript } from "../replay/types.ts";

export type RequiredCall = { name: "load_skill" | "read_file"; target: string };

export type Gold = {
  prId: string;
  neededSkillId: string;
  /** The skill's catalog name, so `load_skill` by name scores the same as by id. */
  neededSkillName?: string;
  requiredCalls: RequiredCall[];
};

export type Outcome = {
  replayId: string;
  prId: string;
  harness: Harness;
  condition: Condition;
  recall: number;
  hits: number;
  required: number;
  activatedSkillIds: string[];
  tokensIn: number;
  tokensOut: number;
  ratioMean: number;
};

/** A rename shows up under its new path, so it is a file the task must touch; a removal is not. */
const TOUCHED = new Set(["added", "modified", "renamed", "changed"]);

const prId = (p: { repo: string; prNumber: number }): string => `${p.repo}#${p.prNumber}`;

export function buildGold(p: {
  pr: SampledPr;
  files: PrFileRow[];
  neededSkillId: string;
  neededSkillName?: string;
}): Gold {
  const paths = new Set(
    p.files
      .filter((f) => f.repo === p.pr.repo && f.prNumber === p.pr.prNumber && TOUCHED.has(f.changeStatus))
      .map((f) => normalisePath(f.filePath)),
  );

  const calls: RequiredCall[] = [
    { name: "load_skill", target: p.neededSkillId },
    ...[...paths].map((target): RequiredCall => ({ name: "read_file", target })),
  ];
  const requiredCalls = calls.sort((a, b) =>
    a.name === b.name ? a.target.localeCompare(b.target) : a.name.localeCompare(b.name),
  );

  return {
    prId: prId(p.pr),
    neededSkillId: p.neededSkillId,
    ...(p.neededSkillName ? { neededSkillName: p.neededSkillName } : {}),
    requiredCalls,
  };
}

/** `./src/a.ts`, `/src/a.ts` and `src//a.ts` are one path; the model has no reason to know that. */
export function normalisePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "").replace(/\/{2,}/g, "/");
}

function matches(call: { name: string; args: Record<string, unknown> }, required: RequiredCall, gold: Gold): boolean {
  if (call.name !== required.name) return false;
  if (required.name === "load_skill") {
    const name = String(call.args.name ?? "").trim();
    return (
      name === required.target ||
      name === gold.neededSkillId ||
      (gold.neededSkillName !== undefined && name === gold.neededSkillName)
    );
  }
  const path = String(call.args.path ?? "").trim();
  return normalisePath(path) === required.target;
}

/**
 * The plan calls `ratioMean` token-weighted, but the transcript carries no per-file token counts —
 * only the achieved ratio per surface — so this is the plain mean over the surfaces the condition
 * materialised, and 1 when there are none (C0/C0b, and any replay not attached to a materialisation).
 */
export function extractOutcomes(t: Transcript, g: Gold): Outcome {
  const hits = g.requiredCalls.filter((r) => t.toolCalls.some((c) => matches(c, r, g))).length;
  const ratios = Object.values(t.ratios ?? {});
  const ratioMean = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1;

  return {
    replayId: `${g.prId}:${t.condition}:${t.harness}`,
    prId: g.prId,
    harness: t.harness,
    condition: t.condition,
    recall: g.requiredCalls.length ? hits / g.requiredCalls.length : 0,
    hits,
    required: g.requiredCalls.length,
    activatedSkillIds: t.activations.map((a) => a.skillId),
    tokensIn: t.tokens.in,
    tokensOut: t.tokens.out,
    ratioMean,
  };
}

/**
 * Share of activations per skill. Renormalised over the skills this set of replays actually
 * activated, so skills the catalog never offered do not occupy mass and the shares sum to 1.
 */
export function activationDistribution(outcomes: Outcome[]): Map<string, number> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const o of outcomes) {
    for (const id of o.activatedSkillIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      total++;
    }
  }
  const out = new Map<string, number>();
  if (!total) return out;
  for (const [id, n] of counts) out.set(id, n / total);
  return out;
}

const csvField = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * One row per analysis PR, with the judge/human columns empty. Kept deliberately dumb: it is the
 * judge's input file, so it must not pre-fill anything that could look like a label.
 */
export function exportLabelsCsv(golds: Gold[], outPath: string): void {
  const header = ["pr_id", "repo", "pr_number", "needed_skill", "needed_skill_name", "required_calls"];
  const rows = [...golds]
    .sort((a, b) => a.prId.localeCompare(b.prId))
    .map((g) => {
      const [repo, number] = g.prId.split("#");
      return [
        g.prId,
        repo,
        number,
        "",
        g.neededSkillName ?? "",
        g.requiredCalls.map((c) => `${c.name}:${c.target}`).join(";"),
      ]
        .map(csvField)
        .join(",");
    });
  writeFileSync(outPath, `${[header.join(","), ...rows].join("\n")}\n`);
}
