import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activationDistribution, buildGold, exportLabelsCsv, extractOutcomes } from "../src/analysis/outcomes.ts";
import type { Transcript } from "../src/replay/types.ts";

const files = [
  { repo: "o/a", prNumber: 1, filePath: "src/a.ts", changeStatus: "modified", isCode: true },
  { repo: "o/a", prNumber: 1, filePath: "docs/x.md", changeStatus: "modified", isCode: false },
];
const pr = {
  repo: "o/a",
  prNumber: 1,
  stratum: "s",
  skillCountQuartile: 1,
  sizeBucket: "m",
  role: "pilot" as const,
};

describe("buildGold", () => {
  it("derives required calls from the PR's own files, not from the transcript", () => {
    const g = buildGold({ pr, files, neededSkillId: "o/a:1" });
    expect(g.requiredCalls.map((c) => c.target).sort()).toEqual(["docs/x.md", "o/a:1", "src/a.ts"]);
  });

  it("ignores deleted files", () => {
    const g = buildGold({
      pr,
      files: [...files, { repo: "o/a", prNumber: 1, filePath: "old.ts", changeStatus: "removed", isCode: true }],
      neededSkillId: "o/a:1",
    });
    expect(g.requiredCalls.map((c) => c.target)).not.toContain("old.ts");
  });

  it("ignores files belonging to another PR", () => {
    const g = buildGold({
      pr,
      files: [...files, { repo: "o/a", prNumber: 2, filePath: "other.ts", changeStatus: "added", isCode: true }],
      neededSkillId: "o/a:1",
    });
    expect(g.requiredCalls.map((c) => c.target)).not.toContain("other.ts");
  });
});

describe("extractOutcomes", () => {
  const t: Transcript = {
    pr: { repo: "o/a", prNumber: 1 },
    harness: "H1",
    condition: "C1",
    turns: 4,
    termination: "final",
    toolCalls: [
      { turn: 0, name: "load_skill", args: { name: "o/a:1" }, executed: false },
      { turn: 1, name: "read_file", args: { path: "src/a.ts" }, executed: false },
    ],
    activations: [{ turn: 0, skillId: "o/a:1" }],
    tokens: { in: 900, out: 90 },
    ratios: { "1/SKILL.md": 0.67 },
  };
  const gold = buildGold({ pr, files, neededSkillId: "o/a:1" });

  it("scores full recall when every required call happened", () => {
    const full = [...t.toolCalls, { turn: 2, name: "read_file", args: { path: "docs/x.md" }, executed: true }];
    expect(extractOutcomes({ ...t, toolCalls: full }, gold).recall).toBe(1);
  });

  it("scores partial recall", () => {
    expect(extractOutcomes({ ...t, toolCalls: t.toolCalls.slice(0, 2) }, gold).recall).toBeCloseTo(2 / 3, 5);
  });

  it("is 0, not NaN, when nothing was called", () => {
    expect(extractOutcomes({ ...t, toolCalls: [] }, gold).recall).toBe(0);
  });

  it("matches a skill loaded by catalog name", () => {
    const named: Transcript = { ...t, toolCalls: [{ turn: 0, name: "load_skill", args: { name: "Deploy" }, executed: true }] };
    const g = buildGold({ pr, files, neededSkillId: "o/a:1", neededSkillName: "Deploy" });
    expect(extractOutcomes(named, g).hits).toBe(1);
  });

  it("normalises ./ and doubled slashes in read paths", () => {
    const sloppy: Transcript = { ...t, toolCalls: [{ turn: 0, name: "read_file", args: { path: "./src//a.ts" }, executed: true }] };
    expect(extractOutcomes(sloppy, gold).hits).toBe(1);
  });

  it("derives the replay id from the transcript, not from the caller", () => {
    expect(extractOutcomes(t, gold).replayId).toBe("o/a#1:C1:H1");
  });

  it("reports the mean achieved ratio, and 1 when nothing was compressed", () => {
    expect(extractOutcomes(t, gold).ratioMean).toBeCloseTo(0.67, 2);
    expect(extractOutcomes({ ...t, ratios: undefined }, gold).ratioMean).toBe(1);
  });
});

describe("activationDistribution", () => {
  it("renormalises over the skills actually seen", () => {
    const os = [
      { replayId: "a", prId: "p", harness: "H1" as const, condition: "C0" as const, recall: 1, hits: 2, required: 2, activatedSkillIds: ["x", "x"], tokensIn: 1, tokensOut: 1, ratioMean: 1 },
      { replayId: "b", prId: "p", harness: "H1" as const, condition: "C0" as const, recall: 1, hits: 2, required: 2, activatedSkillIds: ["y"], tokensIn: 1, tokensOut: 1, ratioMean: 1 },
    ];
    const d = activationDistribution(os);
    expect(d.get("x")).toBeCloseTo(2 / 3, 5);
    expect(d.get("y")).toBeCloseTo(1 / 3, 5);
  });

  it("is empty when nothing was activated", () => {
    expect(activationDistribution([]).size).toBe(0);
  });
});

describe("exportLabelsCsv", () => {
  it("writes the header and leaves the needed_skill column empty", () => {
    const path = join(mkdtempSync(join(tmpdir(), "labels-")), "labels.csv");
    exportLabelsCsv([buildGold({ pr, files, neededSkillId: "o/a:1", neededSkillName: "Deploy, v2" })], path);
    const [header, row] = readFileSync(path, "utf8").trim().split("\n");
    expect(header).toBe("pr_id,repo,pr_number,needed_skill,needed_skill_name,required_calls");
    expect(row.startsWith("o/a#1,o/a,1,,")).toBe(true);
    expect(row).toContain('"Deploy, v2"');
  });
});
