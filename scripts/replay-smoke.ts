/**
 * Step 5 of Task 8: one offline replay, no API and no network.
 *
 * The point is the instrument: a `rm` must land in the JSONL with `executed: false` and the target
 * file must still exist afterwards. If the file is gone, the allowlist is cosmetic.
 *
 * Run: node scripts/replay-smoke.ts
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runReplay } from "../src/replay/agent.ts";
import { READ_ONLY_ALLOWLIST } from "../src/replay/tools.ts";
import { Recorder } from "../src/replay/transcript.ts";
import type { Catalog, ModelClient } from "../src/replay/types.ts";

const root = mkdtempSync("/tmp/replay-smoke-");
mkdirSync(join(root, "src"), { recursive: true });
writeFileSync(join(root, "src", "a.ts"), "export const x = 1;\n");
writeFileSync(join(root, "notes.txt"), "must survive the replay\n");

const catalog: Catalog = {
  harness: "H1",
  skills: [{ skillId: "o/a:fix", name: "fix", description: "fix things", body: "# Fix\nRead before writing.\n" }],
  render: () => "Available skills:\n- fix: fix things",
};

const script = [
  '{"tool":"read_file","args":{"path":"src/a.ts"}}',
  '{"tool":"record_command","args":{"command":"rm notes.txt"}}',
  '{"tool":"record_command","args":{"command":"cat /etc/passwd"}}',
  '{"tool":"record_command","args":{"command":"ls"}}',
  '{"final":"Nothing needed changing."}',
];

let i = 0;
const model: ModelClient = {
  async call() {
    const text = script[Math.min(i++, script.length - 1)];
    return { text, tokensIn: 120, tokensOut: 12 };
  },
};

// The recorder is append-only on purpose; the smoke starts it from empty so reruns are comparable.
const recorderPath = "analysis/replay_smoke.jsonl";
rmSync(recorderPath, { force: true });
const recorder = new Recorder(recorderPath);
const transcript = await runReplay({
  pr: { repo: "o/a", prNumber: 1, stratum: "s", skillCountQuartile: 1, sizeBucket: "m", role: "pilot" },
  condition: "C1",
  harness: "H1",
  model,
  root,
  recorder,
  catalog,
  budgets: { maxTurns: 8, maxTokens: 50_000 },
});

const lines = readFileSync(recorder.path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const blocked = lines.filter((l) => l.kind === "tool" && l.tool === "record_command" && l.executed === false);
const read = transcript.toolCalls.find((c) => c.name === "read_file");
const survived = existsSync(join(root, "notes.txt"));

console.log(`root ${root}`);
console.log(`termination ${transcript.termination} after ${transcript.turns} turns, ${transcript.toolCalls.length} tool calls`);
console.log(`records ${lines.length}; blocked ${blocked.map((b) => JSON.stringify(b.args?.command)).join(", ") || "NONE"}`);
console.log(`read_file executed: ${read?.executed}; notes.txt survived: ${survived}`);

// The JSONL itself is scratch (`analysis/*.jsonl` is ignored); this summary is the committed evidence.
writeFileSync(
  join("analysis", "replay_smoke.json"),
  `${JSON.stringify(
    {
      generated: new Date().toISOString(),
      termination: transcript.termination,
      turns: transcript.turns,
      toolCalls: transcript.toolCalls.length,
      records: lines.length,
      blockedCommands: blocked.map((b) => b.args?.command),
      readFileExecuted: read?.executed ?? false,
      blockedFileSurvived: survived,
      allowlist: READ_ONLY_ALLOWLIST,
    },
    null,
    2,
  )}\n`,
);

if (blocked.length !== 2 || !survived || !read?.executed) process.exit(1);
