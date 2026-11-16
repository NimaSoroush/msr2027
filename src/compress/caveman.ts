import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type Compressor = {
  id: string;
  version: string;
  compress(text: string): Promise<string>;
};

/**
 * Raised when the pinned compressor cannot be used exactly as pinned.
 *
 * There is deliberately no fallback. A stand-in that produces different bytes would not fail
 * loudly — it would produce a full grid whose treatment arm is not the treatment the paper
 * describes, which is worse than an empty result.
 */
export class CavemanUnavailable extends Error {
  // Plain fields, not constructor parameter properties: scripts run under `node`'s type
  // stripping, which refuses them while vitest silently accepts them.
  subject: string;
  reason: string;

  constructor(subject: string, reason: string) {
    super(`${subject}: ${reason}`);
    this.name = "CavemanUnavailable";
    this.subject = subject;
    this.reason = reason;
  }
}

const sha256OfFile = (path: string): string => {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch (error) {
    throw new CavemanUnavailable(
      path,
      `cannot read the pinned binary (${(error as Error).message}); a replay may not run with it stubbed`,
    );
  }
};

const run = (bin: string, text: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, ["compress"], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(
        new CavemanUnavailable(
          bin,
          error.code === "ENOENT"
            ? "not found; supply the release binary and its sha256"
            : `failed to start (${error.message})`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code !== 0) {
        // A non-zero exit is a failure, not "untouched output": Engine returns the original
        // bytes on the success path, so an error path must never be read as a valid result.
        reject(new Error(`caveman-engine exit ${code}: ${Buffer.concat(err).toString("utf8").trim()}`));
        return;
      }
      resolve(Buffer.concat(out).toString("utf8"));
    });

    child.stdin.end(text, "utf8");
  });

/**
 * The treatment arm: the pinned Caveman Engine CLI.
 *
 * Engine supplies transformed bytes and nothing else. Every ratio is counted with the study's own
 * tokenizer, its recovery handles are unused (the pre-compression bytes are already retained), and
 * original-byte output is a legitimate result recorded as `untouched` — a gate that refused the
 * transform is not an error and must not be retried into one.
 */
export function cavemanCompressor(p: {
  bin?: string;
  mode: "spawn" | "library";
  pin?: { tag: string; sha256: string };
}): Compressor {
  const bin = p.bin ?? "caveman-engine";
  return {
    id: "caveman",
    version: p.pin?.tag ?? "unpinned",
    async compress(text: string): Promise<string> {
      if (p.mode === "library") {
        throw new CavemanUnavailable(
          bin,
          "library mode requested, but the pinned release ships a CLI only; use mode \"spawn\"",
        );
      }
      const actual = sha256OfFile(bin);
      if (p.pin && actual.toLowerCase() !== p.pin.sha256.toLowerCase()) {
        throw new CavemanUnavailable(
          bin,
          `sha256 ${actual} does not match the pin ${p.pin.sha256} for ${p.pin.tag}; refusing a different build`,
        );
      }
      return run(bin, text);
    },
  };
}
