import type { Condition } from "../material/workdir.ts";
import type { SampledPr } from "../prs/sample.ts";
import { buildTools, type ToolDef } from "./tools.ts";
import { Recorder } from "./transcript.ts";
import type { Activation, Catalog, Harness, ModelClient, Termination, ToolCall, Transcript } from "./types.ts";

export type ReplayAction = { tool: string; args: Record<string, unknown> } | { final: string };

export type Budgets = { maxTurns: number; maxTokens: number };

const SYSTEM = [
  "You are working on a repository checked out in the current directory.",
  "Each turn, reply with exactly one JSON object and nothing else.",
  'To use a tool: {"tool": "<name>", "args": {...}}.',
  'To finish: {"final": "<one-paragraph summary of what you changed and why>"}.',
].join("\n");

/** The model may wrap its JSON in a fence; tolerate that and nothing more exotic. */
export function parseAction(text: string): ReplayAction | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.final === "string") return { final: obj.final };
  if (typeof obj.tool === "string") {
    const args = obj.args && typeof obj.args === "object" && !Array.isArray(obj.args)
      ? (obj.args as Record<string, unknown>)
      : {};
    return { tool: obj.tool, args };
  }
  return null;
}

function renderTools(tools: ToolDef[]): string {
  return tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}

/**
 * One replay: a model, a workdir, a condition-labelled catalog, and two hard budgets.
 *
 * The loop never trusts the model to stop. It appends every turn to the recorder before the next
 * model call, so a crash costs the turn in flight; and it refuses to run a tool the surface did not
 * build.
 */
export async function runReplay(p: {
  pr: SampledPr;
  condition: Condition;
  harness: Harness;
  model: ModelClient;
  root: string;
  recorder: Recorder;
  budgets: Budgets;
  catalog: Catalog;
  /** The task prompt; Task 9 builds it from the PR title/body plus the catalog. */
  task?: string;
}): Promise<Transcript> {
  const toolCalls: ToolCall[] = [];
  const activations: Activation[] = [];
  let turn = 0;

  const tools = buildTools({
    root: p.root,
    catalog: p.catalog,
    onActivate: (skillId, at) => activations.push({ skillId, turn: at }),
    now: () => turn,
  });
  const byName = new Map(tools.map((t) => [t.name, t]));

  const system = [SYSTEM, `Tools:\n${renderTools(tools)}`, p.catalog.render()].join("\n\n");
  const messages: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: p.task ?? "Begin the task." },
  ];

  const replayId = `${p.pr.repo}#${p.pr.prNumber}:${p.condition}:${p.harness}`;
  const base = {
    replayId,
    pr: p.pr.repo,
    prNumber: p.pr.prNumber,
    condition: p.condition,
    harness: p.harness,
  };
  const tokens = { in: 0, out: 0 };

  let termination: Termination = "turn_budget";
  let finalText: string | undefined;

  for (; turn < p.budgets.maxTurns; turn++) {
    const reply = await p.model.call({ system, messages });
    tokens.in += reply.tokensIn;
    tokens.out += reply.tokensOut;

    if (tokens.in + tokens.out > p.budgets.maxTokens) {
      p.recorder.append({ ...base, turn, kind: "budget", termination: "token_budget", tokensIn: reply.tokensIn, tokensOut: reply.tokensOut });
      termination = "token_budget";
      turn++;
      break;
    }

    const action = parseAction(reply.text);
    messages.push({ role: "assistant", content: reply.text });

    if (!action) {
      p.recorder.append({ ...base, turn, kind: "parse_error", text: reply.text.slice(0, 500), tokensIn: reply.tokensIn, tokensOut: reply.tokensOut });
      messages.push({ role: "user", content: "Your reply was not a JSON action. Reply with one JSON object." });
      continue;
    }

    if ("final" in action) {
      finalText = action.final;
      termination = "final";
      p.recorder.append({ ...base, turn, kind: "final", text: action.final, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut });
      turn++;
      break;
    }

    const tool = byName.get(action.tool);
    if (!tool) {
      p.recorder.append({ ...base, turn, kind: "parse_error", text: `unknown tool ${action.tool}`, tokensIn: reply.tokensIn, tokensOut: reply.tokensOut });
      messages.push({ role: "user", content: `There is no tool named ${action.tool}.` });
      continue;
    }

    const result = await tool.run(action.args);
    toolCalls.push({ name: tool.name, args: action.args, turn, executed: result.executed });
    p.recorder.append({
      ...base,
      turn,
      kind: "tool",
      tool: tool.name,
      args: action.args,
      executed: result.executed,
      skillId: activations.at(-1)?.turn === turn ? activations.at(-1)!.skillId : undefined,
      tokensIn: reply.tokensIn,
      tokensOut: reply.tokensOut,
    });
    messages.push({ role: "user", content: result.content });
  }

  return { pr: p.pr, condition: p.condition, harness: p.harness, turns: turn, toolCalls, activations, termination, finalText, tokens };
}
