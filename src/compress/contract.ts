import { splitSkill } from "../material/skills.ts";
import { achievedRatio } from "../tokens.ts";

/** Everything compression must leave alone. Order is the order violations are reported in. */
export const PROTECTED_SURFACES = [
  "frontmatter",
  "code fences",
  "inline code",
  "identifiers",
  "headings",
  "emphasis lines",
  "list items",
  "table rows",
  "constraints",
] as const;

export type ContractCheck = {
  ok: boolean;
  violations: string[];
  ratio: number;
  untouched: boolean;
};

const fences = (text: string): string[] => {
  const out: string[] = [];
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) out.push(m[1].trim());
  return out;
};

const inlineCode = (text: string): string[] => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());

/**
 * Tokens that name something concrete: anything carrying a digit, `_`, `.`, `/` or `-`, plus
 * ALL-CAPS words. Prose words are deliberately excluded — they can be shortened — but `PROD=1`,
 * `infra/`, `--verbose` and `MUST` cannot, because a compressed skill that loses them is a
 * different instruction even when it reads like the same one.
 */
const identifiers = (text: string): string[] => {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b[A-Za-z0-9][\w./-]*/g)) {
    const token = m[0].replace(/[./-]+$/, "");
    if (!token) continue;
    if (/[0-9_./-]/.test(token) || /^[A-Z][A-Z0-9_]{2,}$/.test(token)) out.add(token);
  }
  return [...out];
};

const headings = (text: string): string[] =>
  [...text.matchAll(/^#{1,6}[ \t]+(.+)$/gm)].map((m) => m[1].trim());

/**
 * An item is its full text, not its first word. Comparing lead tokens as a set let a whole
 * instruction disappear whenever some other bullet or a prose sentence reused that word.
 */
const listItems = (text: string): string[] =>
  [...text.matchAll(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(.+)$/gm)].map((m) => m[1].replace(/\s+/g, " ").trim());

/**
 * A line that is nothing but bold/underscored emphasis is an instruction in this corpus
 * ("**Never skip the health check.**"), not prose, so losing it changes the document.
 */
const emphasisLines = (text: string): string[] =>
  [...text.matchAll(/^[ \t]*(\*\*|__)(.+?)\1[ \t]*$/gm)].map((m) => m[2].replace(/\s+/g, " ").trim());

const tableRows = (text: string): string[] =>
  [...text.matchAll(/^[ \t]*\|.*\|[ \t]*$/gm)].map((m) => m[0].trim());

const MODAL = /\b(must|never|always|only|no|not)\b/gi;
const constraints = (text: string): string[] => [...new Set([...text.matchAll(MODAL)].map((m) => m[1].toLowerCase()))];

const missing = (before: string[], after: string[]): string[] => {
  const kept = new Set(after);
  return before.filter((v) => !kept.has(v));
};

/**
 * Multiset variant: deleting one of two identical items must fail, so a count has to fall rather
 * than the value merely being present somewhere.
 */
const missingCounted = (before: string[], after: string[]): string[] => {
  const remaining = new Map<string, number>();
  for (const v of after) remaining.set(v, (remaining.get(v) ?? 0) + 1);
  return before.filter((v) => {
    const n = remaining.get(v) ?? 0;
    if (n === 0) return true;
    remaining.set(v, n - 1);
    return false;
  });
};

/**
 * Compare a compressed file against its original surface by surface.
 *
 * The vendor promises pass-through when a gate fails, not preservation, so a green gate is not
 * evidence that the text survived. This check is the study's own reading of the same bytes, and a
 * single violation voids the replay rather than being averaged into an outcome.
 */
export function checkContract(p: { original: string; compressed: string }): ContractCheck {
  const violations: string[] = [];
  const a = splitSkill(p.original);
  const b = splitSkill(p.compressed);

  if (a.frontmatter !== b.frontmatter) {
    violations.push(
      a.description !== b.description
        ? `frontmatter description changed: ${JSON.stringify(a.description)} -> ${JSON.stringify(b.description)}`
        : "frontmatter is not byte-identical",
    );
  }

  const fenceLoss = missing(fences(a.body), fences(b.body));
  if (fenceLoss.length) violations.push(`code fence contents changed: ${JSON.stringify(fenceLoss.slice(0, 3))}`);

  const inlineLoss = missing(inlineCode(a.body), inlineCode(b.body));
  if (inlineLoss.length) violations.push(`inline code span missing: ${JSON.stringify(inlineLoss.slice(0, 3))}`);

  const idLoss = missing(identifiers(a.body), identifiers(b.body));
  if (idLoss.length) violations.push(`identifier removed: ${JSON.stringify(idLoss.slice(0, 5))}`);

  const headingLoss = missing(headings(a.body), headings(b.body));
  if (headingLoss.length) violations.push(`heading changed: ${JSON.stringify(headingLoss.slice(0, 3))}`);

  const emphasisLoss = missingCounted(emphasisLines(a.body), emphasisLines(b.body));
  if (emphasisLoss.length) violations.push(`emphasis line missing: ${JSON.stringify(emphasisLoss.slice(0, 3))}`);

  const itemLoss = missingCounted(listItems(a.body), listItems(b.body));
  if (itemLoss.length) violations.push(`list item missing: ${JSON.stringify(itemLoss.slice(0, 3))}`);

  const rowLoss = missing(tableRows(a.body), tableRows(b.body));
  if (rowLoss.length) violations.push(`table row changed: ${JSON.stringify(rowLoss.slice(0, 3))}`);

  const modalLoss = missing(constraints(a.body), constraints(b.body));
  if (modalLoss.length) violations.push(`constraint word removed: ${modalLoss.join(", ")}`);

  return {
    ok: violations.length === 0,
    violations,
    ratio: achievedRatio(p.original, p.compressed),
    untouched: p.original === p.compressed,
  };
}
