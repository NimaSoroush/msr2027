/**
 * Label agreement and the mechanical cross-checks.
 *
 * Per spec §8.3 (decisions 14–15), the LLM judge is the primary label and neither mechanical signal
 * may exclude a PR: the exact-path rule cannot speak on this frame, and the body-reference rule is a
 * sensitivity subset. These functions therefore return *candidates* and *agreement*, never a filter.
 */
import type { PrFileRow } from "../prs/specmine.ts";
import { normalisePath } from "./outcomes.ts";

const TOUCHED = new Set(["added", "modified", "renamed", "changed"]);

const touchedPaths = (p: { repo: string; prNumber: number }, files: PrFileRow[]): Set<string> =>
  new Set(
    files
      .filter((f) => f.repo === p.repo && f.prNumber === p.prNumber && TOUCHED.has(f.changeStatus))
      .map((f) => normalisePath(f.filePath)),
  );

/** Skills whose recorded path is one of the files the PR touched. Usually empty on this frame. */
export function mechanicalLabels(p: {
  pr: { repo: string; prNumber: number };
  files: PrFileRow[];
  skills: { skillId: string; path: string }[];
}): string[] {
  const touched = touchedPaths(p.pr, p.files);
  return [...new Set(p.skills.filter((s) => touched.has(normalisePath(s.path))).map((s) => s.skillId))].sort();
}

/**
 * Repo-relative paths that look like file references. Deliberately conservative: a bare `src/a.ts`
 * or `docs/x.md`, not a URL and not a directory. The lookarounds keep it from matching inside a
 * longer token such as `foo/src/a.tsx`.
 */
const PATH_TOKEN = /(?<![\w./-])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,6})(?![\w/-])/g;

/** Skills whose body names a file the PR touched — the 15.5% concordance subset. */
export function bodyPathLabels(p: {
  pr: { repo: string; prNumber: number };
  files: PrFileRow[];
  skills: { skillId: string; body: string | null }[];
}): string[] {
  const touched = touchedPaths(p.pr, p.files);
  const hits: string[] = [];
  for (const s of p.skills) {
    if (!s.body) continue;
    const refs = [...s.body.matchAll(PATH_TOKEN)].map((m) => normalisePath(m[1]));
    if (refs.some((r) => touched.has(r))) hits.push(s.skillId);
  }
  return [...new Set(hits)].sort();
}

/**
 * Cohen's κ over nominal labels, with `"(none)"` as just another category. When both raters used a
 * single identical category, chance agreement is 1 and κ is undefined; this returns 1 for that case
 * and 0 otherwise rather than NaN, because a NaN would silently vanish from an agreement table.
 */
export function cohensKappa(a: string[], b: string[]): number {
  if (a.length !== b.length) throw new Error(`kappa needs paired labels: ${a.length} vs ${b.length}`);
  const n = a.length;
  if (!n) return 1;

  let agree = 0;
  const left = new Map<string, number>();
  const right = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) agree++;
    left.set(a[i], (left.get(a[i]) ?? 0) + 1);
    right.set(b[i], (right.get(b[i]) ?? 0) + 1);
  }

  const po = agree / n;
  let pe = 0;
  for (const [label, count] of left) pe += (count / n) * ((right.get(label) ?? 0) / n);
  if (pe === 1) return po === 1 ? 1 : 0;
  return (po - pe) / (1 - pe);
}

export type Concordance = {
  /** PRs where both signals named at least one skill. */
  comparable: number;
  /** Of those, PRs where the judge's skill is among the mechanical candidates. */
  agree: number;
  rate: number;
  disagreements: { prId: string; judge: string; mechanical: string[] }[];
};

/**
 * Compare judge labels against a mechanical signal without dropping anything. `mechanical` is a
 * candidate set, so agreement means the judge's id is in it; a PR with no mechanical candidate is
 * *not comparable* rather than a disagreement, which is what keeps the exact-path rule's silence
 * from being reported as error.
 */
export function concordance(
  pairs: { prId: string; judge: string; mechanical: string[] }[],
): Concordance {
  const comparable = pairs.filter((p) => p.mechanical.length > 0);
  const agree = comparable.filter((p) => p.mechanical.includes(p.judge));
  return {
    comparable: comparable.length,
    agree: agree.length,
    rate: comparable.length ? agree.length / comparable.length : 0,
    disagreements: comparable
      .filter((p) => !p.mechanical.includes(p.judge))
      .map((p) => ({ prId: p.prId, judge: p.judge, mechanical: p.mechanical })),
  };
}
