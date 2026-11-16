import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkContract } from "../src/compress/contract.ts";
import {
  CavemanUnavailable,
  cavemanCompressor,
  destructiveCompressor,
  identityCompressor,
} from "../src/compress/index.ts";

const SKILL =
  "---\nname: deploy\ndescription: Ship the app.\n---\n# Deploy\nWe really love deploys and we think you will too, because deploys are fun and fast and nice.\n## Steps\n- run `make deploy PROD=1` in `infra/`\n```bash\nmake deploy PROD=1 --verbose\n```\n| flag | meaning |\n|---|---|\n| PROD | production |\n\nYou MUST never skip the health check.\n";

describe("contract", () => {
  it("accepts an untouched file but flags it", () => {
    const c = checkContract({ original: SKILL, compressed: SKILL });
    expect(c.ok).toBe(true);
    expect(c.untouched).toBe(true);
    expect(c.ratio).toBe(1);
  });

  it("rejects a changed description", () => {
    const c = checkContract({ original: SKILL, compressed: SKILL.replace("Ship the app.", "Ship app.") });
    expect(c.ok).toBe(false);
    expect(c.violations.join()).toMatch(/frontmatter|description/);
  });

  it("rejects a changed code fence", () => {
    const c = checkContract({ original: SKILL, compressed: SKILL.replace("--verbose", "--quiet") });
    expect(c.ok).toBe(false);
    expect(c.violations.join()).toMatch(/fence|code/);
  });

  it("rejects a dropped identifier or negated constraint", () => {
    expect(checkContract({ original: SKILL, compressed: SKILL.replace("infra/", "the dir") }).ok).toBe(false);
    expect(checkContract({ original: SKILL, compressed: SKILL.replace("MUST never", "should") }).ok).toBe(false);
  });

  it("rejects a mangled table or heading", () => {
    expect(
      checkContract({ original: SKILL, compressed: SKILL.replace("| PROD | production |", "| PROD | prod |") }).ok,
    ).toBe(false);
    expect(checkContract({ original: SKILL, compressed: SKILL.replace("# Deploy", "Deploy") }).ok).toBe(false);
  });

  it("rejects a deleted list item whose lead word survives elsewhere", () => {
    // The old check compared lead tokens as a set: "run" survives in the other bullet and in prose,
    // so a whole instruction could disappear. Items are compared by their full text, with counts.
    const original = "# Checks\n- run the tests\n- run the linter\nProse about how to run things.\n";
    const c = checkContract({ original, compressed: "# Checks\n- run the tests\nProse about how to run things.\n" });
    expect(c.ok).toBe(false);
    expect(c.violations.join()).toMatch(/list item/);
  });

  it("rejects a deleted emphasis-only instruction line", () => {
    const original = "# Rules\n**Never skip the health check.**\nThe health check matters, so never skip it.\n";
    const c = checkContract({
      original,
      compressed: "# Rules\nThe health check matters, so never skip it.\n",
    });
    expect(c.ok).toBe(false);
    expect(c.violations.join()).toMatch(/emphasis/);
  });

  it("still allows prose to be rewritten when lists and emphasis survive", () => {
    const original = "# Rules\n**Never skip the health check.**\n- run the tests\nWe really love long prose about deploys.\n";
    const compressed = "# Rules\n**Never skip the health check.**\n- run the tests\nDeploys.\n";
    expect(checkContract({ original, compressed }).ok).toBe(true);
  });

  it("names every surface it checks, and reports a real ratio", () => {
    const compressed = SKILL.replace(/\nWe really love[\s\S]*?nice\./, "\nDeploys are fine.");
    const c = checkContract({ original: SKILL, compressed });
    expect(c.ratio).toBeLessThan(1);
    // Prose may be cut; the constraint and the table survive, so this one is only flagged for size.
    expect(c.violations.join()).not.toMatch(/constraint|table/);
  });
});

describe("destructive control", () => {
  it("lands near the requested keep ratio", async () => {
    const out = await destructiveCompressor({ keepRatio: 0.3 }).compress(SKILL);
    const c = checkContract({ original: SKILL, compressed: out });
    expect(c.ratio).toBeLessThan(0.6);
    expect(c.ok).toBe(false); // by construction: it violates preservation
  });

  it("is deterministic", async () => {
    const d = destructiveCompressor();
    expect(await d.compress(SKILL)).toBe(await d.compress(SKILL));
  });

  it("identity is a no-op", async () => {
    expect(await identityCompressor().compress(SKILL)).toBe(SKILL);
  });
});

describe("caveman adapter", () => {
  const stub = (body: string): { bin: string; sha256: string } => {
    const dir = mkdtempSync(join(tmpdir(), "caveman-stub-"));
    const bin = join(dir, "caveman-engine");
    const source = `#!/bin/sh\n${body}\n`;
    writeFileSync(bin, source);
    chmodSync(bin, 0o755);
    const sha256 = createHash("sha256").update(source).digest("hex");
    return { bin, sha256 };
  };

  it("passes bytes through the pinned binary and records the tag", async () => {
    const { bin, sha256 } = stub('tr -d "aeiou"');
    const c = cavemanCompressor({ bin, mode: "spawn", pin: { tag: "v0.1.0", sha256 } });
    expect(c.version).toBe("v0.1.0");
    expect(await c.compress("hello world")).toBe("hll wrld");
  });

  it("refuses a binary whose hash does not match the pin", async () => {
    const { bin } = stub("cat");
    const c = cavemanCompressor({ bin, mode: "spawn", pin: { tag: "v0.1.0", sha256: "0".repeat(64) } });
    await expect(c.compress("x")).rejects.toBeInstanceOf(CavemanUnavailable);
    await expect(c.compress("x")).rejects.toThrow(/sha256|pin/);
  });

  it("refuses a missing binary instead of substituting one", async () => {
    const c = cavemanCompressor({ bin: "/nonexistent/caveman-engine", mode: "spawn" });
    await expect(c.compress("x")).rejects.toBeInstanceOf(CavemanUnavailable);
    await expect(c.compress("x")).rejects.toThrow(/caveman-engine/);
  });

  it("refuses library mode rather than pretending to load a library", async () => {
    const c = cavemanCompressor({ mode: "library" });
    await expect(c.compress("x")).rejects.toBeInstanceOf(CavemanUnavailable);
  });

  it("reports a non-zero exit as a failure, not as untouched output", async () => {
    const { bin, sha256 } = stub('echo "gate failed" >&2; exit 3');
    const c = cavemanCompressor({ bin, mode: "spawn", pin: { tag: "v0.1.0", sha256 } });
    await expect(c.compress("x")).rejects.toThrow(/exit 3/);
  });
});
