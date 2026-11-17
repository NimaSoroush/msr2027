import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Condition } from "../material/workdir.ts";
import type { Harness, Termination } from "./types.ts";

/**
 * One line per turn. The loop appends before asking the model again, so a killed process costs the
 * turn in flight, not the replay — and the file stays readable while the replay is still running.
 */
export type ReplayRecord = {
  replayId: string;
  pr: string;
  prNumber: number;
  condition: Condition;
  harness: Harness;
  turn: number;
  kind: "tool" | "final" | "parse_error" | "budget";
  tool?: string;
  args?: Record<string, unknown>;
  executed?: boolean;
  skillId?: string;
  text?: string;
  tokensIn?: number;
  tokensOut?: number;
  termination?: Termination;
};

export class Recorder {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  append(record: ReplayRecord): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`);
  }
}
