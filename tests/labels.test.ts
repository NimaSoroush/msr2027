import { describe, expect, it } from "vitest";
import { bodyPathLabels, cohensKappa, concordance, mechanicalLabels } from "../src/analysis/labels.ts";

const pr = { repo: "o/a", prNumber: 1 };
const files = [
  { repo: "o/a", prNumber: 1, filePath: "src/a.ts", changeStatus: "modified", isCode: true },
  { repo: "o/a", prNumber: 1, filePath: "docs/x.md", changeStatus: "added", isCode: false },
  { repo: "o/a", prNumber: 1, filePath: "gone.ts", changeStatus: "removed", isCode: true },
];

describe("mechanicalLabels", () => {
  it("returns skills whose recorded path the PR touched, whatever the extension", () => {
    const out = mechanicalLabels({
      pr,
      files,
      skills: [
        { skillId: "s1", path: "src/a.ts" },
        { skillId: "s2", path: "docs/x.md" },
        { skillId: "s3", path: "gone.ts" },
        { skillId: "s4", path: "elsewhere.ts" },
      ],
    });
    expect(out).toEqual(["s1", "s2"]);
  });

  it("is empty when no skill path is in the PR — the normal case on this frame", () => {
    expect(mechanicalLabels({ pr, files, skills: [{ skillId: "s", path: "agent/SKILL.md" }] })).toEqual([]);
  });
});

describe("bodyPathLabels", () => {
  it("finds a skill whose body names a touched file", () => {
    const out = bodyPathLabels({
      pr,
      files,
      skills: [
        { skillId: "s1", body: "Run `src/a.ts` before deploying." },
        { skillId: "s2", body: "Run `yarn test`." },
        { skillId: "s3", body: null },
      ],
    });
    expect(out).toEqual(["s1"]);
  });

  it("does not match a longer token or a URL", () => {
    const out = bodyPathLabels({
      pr,
      files,
      skills: [
        { skillId: "s1", body: "see foo/src/a.tsx and https://example.com/docs/x.md" },
      ],
    });
    expect(out).toEqual([]);
  });
});

describe("cohensKappa", () => {
  it("is 1 for perfect agreement", () => {
    expect(cohensKappa(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
  });

  it("is -1 when the raters never agree on a balanced pair of categories", () => {
    // Both raters pick a and b equally often, and never agree.
    expect(cohensKappa(["a", "b", "a", "b"], ["b", "a", "b", "a"])).toBeCloseTo(-1, 9);
  });

  it("is 1, not NaN, when both used one identical category", () => {
    expect(cohensKappa(["x", "x"], ["x", "x"])).toBe(1);
  });

  it("rejects unpaired labels", () => {
    expect(() => cohensKappa(["a"], ["a", "b"])).toThrow(/paired/);
  });
});

describe("concordance", () => {
  it("counts silence as not comparable, not as disagreement", () => {
    const c = concordance([
      { prId: "p1", judge: "s1", mechanical: ["s1"] },
      { prId: "p2", judge: "s1", mechanical: [] },
      { prId: "p3", judge: "s1", mechanical: ["s2"] },
    ]);
    expect(c.comparable).toBe(2);
    expect(c.agree).toBe(1);
    expect(c.rate).toBe(0.5);
    expect(c.disagreements.map((d) => d.prId)).toEqual(["p3"]);
  });
});
