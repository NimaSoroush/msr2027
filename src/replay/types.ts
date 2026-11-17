/**
 * Vocabulary shared by the replay loop and, from Task 9 on, the harness catalogs.
 *
 * `Harness` and `Catalog` live here rather than in `harness.ts` so Task 8's tools can be typed
 * without reaching forward into a module that does not exist yet; `harness.ts` builds these.
 */
import type { Condition } from "../material/workdir.ts";

export type Harness = "H1" | "H2";

export type Catalog = {
  harness: Harness;
  skills: { skillId: string; name: string; description: string; body: string }[];
  render(): string;
};

export type ModelClient = {
  call(p: {
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
  }): Promise<{ text: string; tokensIn: number; tokensOut: number }>;
};

export type Activation = { skillId: string; turn: number };

export type ToolCall = {
  name: string;
  args: Record<string, unknown>;
  turn: number;
  executed: boolean;
};

export type Termination = "final" | "turn_budget" | "token_budget";

export type Transcript = {
  pr: { repo: string; prNumber: number };
  condition: Condition;
  harness: Harness;
  turns: number;
  toolCalls: ToolCall[];
  activations: Activation[];
  termination: Termination;
  finalText?: string;
  tokens: { in: number; out: number };
};
