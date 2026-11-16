import { describe, expect, it } from "vitest";
import { ENCODING, achievedRatio, reductionPct, tokenCount } from "../src/tokens.ts";

describe("tokens", () => {
  it("pins cl100k_base, the encoding every reported ratio is computed in", () => {
    expect(ENCODING).toBe("cl100k_base");
  });

  it("counts empty as zero", () => {
    expect(tokenCount("")).toBe(0);
  });

  it("uses cl100k_base", () => {
    expect(tokenCount("hello world")).toBe(2);
  });

  it("computes a ratio", () => {
    expect(achievedRatio("a b c d e", "a b c")).toBeCloseTo(0.6, 2);
  });

  it("treats empty original as ratio 1", () => {
    expect(achievedRatio("", "")).toBe(1);
  });

  it("reports the complement as reduction", () => {
    expect(reductionPct("a b c d", "a b")).toBeCloseTo(50, 1);
  });

  it("survives non-ASCII", () => {
    expect(tokenCount("日本語のスキル手順")).toBeGreaterThan(0);
  });

  it("never returns a negative ratio", () => {
    expect(achievedRatio("a", "a b c d")).toBeGreaterThan(0);
  });
});
