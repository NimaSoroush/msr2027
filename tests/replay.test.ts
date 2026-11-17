import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildTools, READ_ONLY_ALLOWLIST } from "../src/replay/tools.ts";
import { runReplay } from "../src/replay/agent.ts";

const root = mkdtempSync("/tmp/replay-");
mkdirSync(join(root, "src"), { recursive: true });
writeFileSync(join(root, "src", "a.ts"), "export const x = 1;\n");

const catalog = { harness: "H1" as const, skills: [{ skillId: "o/a:p", name: "s", description: "d", body: "# Body\n" }], render: () => "catalog" };

describe("tools", () => {
  it("never executes a command outside the allowlist", async () => {
    const activated: string[] = [];
    const tools = buildTools({ root, catalog, onActivate: (id) => activated.push(id) });
    const record = tools.find((t) => t.name === "record_command")!;
    const out = await record.run({ command: "rm -rf /" });
    expect(out.executed).toBe(false);
    const ok = await record.run({ command: "ls" });
    expect(ok.executed).toBe(true);
  });
  it("records activation in the description-only harness", async () => {
    const activated: string[] = [];
    const tools = buildTools({ root, catalog, onActivate: (id) => activated.push(id) });
    await tools.find((t) => t.name === "load_skill")!.run({ name: "s" });
    expect(activated).toEqual(["o/a:p"]);
  });
  it("refuses to read outside the workdir", async () => {
    const tools = buildTools({ root, catalog, onActivate: () => {} });
    const out = await tools.find((t) => t.name === "read_file")!.run({ path: "../../etc/passwd" });
    expect(out.content).toMatch(/outside/);
  });
  it("has a read-only allowlist", () => {
    expect(READ_ONLY_ALLOWLIST).toEqual(expect.arrayContaining(["ls", "cat", "head", "tail", "grep", "git status"]));
    expect(READ_ONLY_ALLOWLIST).not.toContain("rm");
  });
});

describe("runReplay", () => {
  const model = (script: string[]) => {
    let i = 0;
    return { call: async () => ({ text: script[Math.min(i++, script.length - 1)], tokensIn: 100, tokensOut: 10 }) };
  };
  it("stops at the turn budget and records the reason", async () => {
    const t = await runReplay({
      pr: { repo: "o/a", prNumber: 1, stratum: "s", skillCountQuartile: 1, sizeBucket: "m", role: "pilot" },
      condition: "C0", harness: "H1", model: model(['{"tool":"list_dir","args":{}}']), root, catalog,
      recorder: { append: () => {} } as never, budgets: { maxTurns: 3, maxTokens: 100000 },
    });
    expect(t.termination).toBe("turn_budget");
    expect(t.turns).toBe(3);
  });
  it("records tool calls and activations with turn indices", async () => {
    const script = ['{"tool":"load_skill","args":{"name":"s"}}', '{"final":"done"}'];
    const t = await runReplay({
      pr: { repo: "o/a", prNumber: 1, stratum: "s", skillCountQuartile: 1, sizeBucket: "m", role: "pilot" },
      condition: "C1", harness: "H1", model: model(script), root, catalog,
      recorder: { append: () => {} } as never, budgets: { maxTurns: 10, maxTokens: 100000 },
    });
    expect(t.termination).toBe("final");
    expect(t.toolCalls[0]).toMatchObject({ name: "load_skill", turn: 0 });
    expect(t.activations[0]).toMatchObject({ skillId: "o/a:p", turn: 0 });
  });
});
