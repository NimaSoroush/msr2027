import { getEncoding } from "js-tiktoken";

/**
 * The encoding is pinned, not chosen per run: every ratio in the paper is a token ratio in
 * `cl100k_base`, so a different tokenizer would make the reported achieved ratio incomparable
 * with the pilot and with the readme of the compressor.
 */
export const ENCODING = "cl100k_base";

let cached: ReturnType<typeof getEncoding> | undefined;

/** Loading the ranks costs a few milliseconds; the grid calls this hundreds of thousands of times. */
function encoding(): ReturnType<typeof getEncoding> {
  cached ??= getEncoding(ENCODING);
  return cached;
}

export function tokenCount(text: string): number {
  if (text === "") return 0;
  return encoding().encode(text).length;
}

/** Compressed tokens per original token: 1 means nothing was gained, 0.3 means 70% removed. */
export function achievedRatio(original: string, compressed: string): number {
  const before = tokenCount(original);
  if (before === 0) return 1;
  return tokenCount(compressed) / before;
}

/** The complement, in percent, because the paper and the compressor both report reductions. */
export function reductionPct(original: string, compressed: string): number {
  return (1 - achievedRatio(original, compressed)) * 100;
}
