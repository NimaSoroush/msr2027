/**
 * The negative control: cut text hard and break whatever structure is in the way.
 *
 * This is not a compression method under test. It exists so that a run which finds no effect
 * after C4 has a known answer — the contract must flag it, and the replay must lose activations
 * that the caveman arm keeps. If C4 lands in the middle of the caveman distribution, the design
 * cannot distinguish a preservation failure from an ineffective transform.
 */
export function destructiveCompressor(p: { keepRatio?: number } = {}): {
  id: string;
  version: string;
  compress(text: string): Promise<string>;
} {
  const keepRatio = p.keepRatio ?? 0.3;
  if (!(keepRatio > 0 && keepRatio <= 1)) throw new Error(`keepRatio must be in (0, 1], got ${keepRatio}`);

  return {
    id: "destructive",
    version: `keep=${keepRatio}`,
    async compress(text: string): Promise<string> {
      const lines = text.split("\n");
      const target = Math.max(1, Math.min(lines.length, Math.round(keepRatio * lines.length)));
      const out: string[] = [];

      // Even spacing over the line index, so the damage is spread across the file instead of
      // truncating the tail: truncation would remove whole sections and make the control
      // trivially detectable rather than plausibly harmful.
      for (let i = 0; i < target; i++) {
        out.push(lines[Math.floor((i * lines.length) / target)]);
      }
      return out.join("\n");
    },
  };
}
