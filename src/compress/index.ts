export { checkContract, PROTECTED_SURFACES } from "./contract.ts";
export type { ContractCheck } from "./contract.ts";
export { CavemanUnavailable, cavemanCompressor } from "./caveman.ts";
export type { Compressor } from "./caveman.ts";
export { destructiveCompressor } from "./destructive.ts";

import type { Compressor } from "./caveman.ts";

/**
 * Pass-through arm. It runs a replay through the same code path as a real treatment, which is what
 * makes C0b evidence that the harness itself is neutral rather than a second experiment.
 */
export function identityCompressor(): Compressor {
  return { id: "identity", version: "1", compress: async (text: string) => text };
}
