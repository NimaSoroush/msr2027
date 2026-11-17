import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { Catalog } from "./types.ts";

const run = promisify(execFile);

/**
 * Commands the agent may actually run. Everything else is still recorded, because a replay's
 * command history is an outcome — it just never executes. Entries are prefixes, so `git status`
 * allows `git status --short` but not `git push`.
 *
 * Deliberately absent: `find` (`-exec` runs anything), and `git log`/`git diff`/`git show`, which
 * honour repo-local `textconv` and external-diff configuration and so can execute repository code.
 */
export const READ_ONLY_ALLOWLIST: readonly string[] = Object.freeze([
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "git status",
]);

const MAX_READ_BYTES = 64 * 1024;
const MAX_OUTPUT_CHARS = 8_000;
const MAX_SEARCH_HITS = 200;

export type ToolDef = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<{ content: string; executed: boolean }>;
};

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

function inside(root: string, p: string): string | null {
  const full = resolve(root, p);
  if (full === root || full.startsWith(root + sep)) return full;
  return null;
}

function readInside(root: string, p: string): { full: string } | { error: string } {
  const full = inside(root, p);
  if (!full) return { error: `refused: ${p} is outside the workdir` };
  try {
    // Compare realpaths on both sides: on macOS /tmp is itself a symlink, so comparing a resolved
    // file against the unresolved root rejects every legitimate read.
    const realRoot = realpathSync(root);
    const real = realpathSync(full);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) {
      return { error: `refused: ${p} resolves outside the workdir` };
    }
    return { full: real };
  } catch {
    return { error: `no such file: ${p}` };
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function clip(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… truncated at ${MAX_OUTPUT_CHARS} characters`
    : text;
}

const COMMAND_TIMEOUT_MS = 10_000;

async function runAllowed(command: string, cwd: string): Promise<{ content: string; executed: boolean }> {
  const words = command.trim().split(/\s+/).filter(Boolean);
  const entry = READ_ONLY_ALLOWLIST.filter((candidate) => {
    const prefix = candidate.split(" ");
    return prefix.every((word, i) => words[i] === word);
  }).sort((a, b) => b.length - a.length)[0];

  if (!entry) {
    return {
      content: `recorded but not executed: \`${command}\` is not in the read-only allowlist`,
      executed: false,
    };
  }

  // `cat /etc/passwd` and `cat ../../secrets` are read-only and still escapes from the workdir.
  const escaped = words.find((w) => w.startsWith("/") || w.split(/[=\/]/).includes(".."));
  if (escaped) {
    return {
      content: `recorded but not executed: \`${escaped}\` points outside the workdir`,
      executed: false,
    };
  }

  const argv = entry.split(" ");
  const args = [...argv.slice(1), ...words.slice(argv.length)];
  // Repository config can name helpers for fsmonitor and paging; do not let `git status` reach them.
  const finalArgs = argv[0] === "git"
    ? ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.pager=cat", ...args]
    : args;
  try {
    const { stdout, stderr } = await run(argv[0], finalArgs, {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      shell: false,
    });
    return { content: clip([stdout, stderr].filter(Boolean).join("\n") || "(no output)"), executed: true };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return {
      content: clip(`command failed: ${e.stderr || e.message || "unknown error"}`),
      executed: true,
    };
  }
}

export function buildTools(p: {
  root: string;
  catalog: Catalog;
  onActivate(skillId: string, turn: number): void;
  /** The replay's current turn. Optional so the tools stay usable on their own. */
  now?: () => number;
}): ToolDef[] {
  const { root, catalog, onActivate } = p;
  const now = p.now ?? (() => 0);

  return [
    {
      name: "list_dir",
      description: "List the entries of a directory in the repository. Defaults to the repository root.",
      schema: schema({ path: { type: "string" } }),
      async run(args) {
        const rel = typeof args.path === "string" ? args.path : "";
        const target = inside(root, rel);
        if (!target) return { content: `refused: ${rel} is outside the workdir`, executed: false };
        try {
          const entries = readdirSync(target, { withFileTypes: true })
            .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
            .sort();
          return { content: entries.join("\n") || "(empty)", executed: true };
        } catch {
          return { content: `no such directory: ${rel}`, executed: false };
        }
      },
    },
    {
      name: "read_file",
      description: "Read a text file from the repository.",
      schema: schema({ path: { type: "string" } }, ["path"]),
      async run(args) {
        const rel = String(args.path ?? "");
        const found = readInside(root, rel);
        if ("error" in found) return { content: found.error, executed: false };
        const buf = readFileSync(found.full);
        const text = buf.subarray(0, MAX_READ_BYTES).toString("utf8");
        return {
          content: clip(buf.length > MAX_READ_BYTES ? `${text}\n… file truncated` : text),
          executed: true,
        };
      },
    },
    {
      name: "write_file",
      description: "Write a text file in the repository, creating parent directories as needed.",
      schema: schema({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
      async run(args) {
        const rel = String(args.path ?? "");
        const full = inside(root, rel);
        if (!full) return { content: `refused: ${rel} is outside the workdir`, executed: false };
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, String(args.content ?? ""));
        return { content: `wrote ${rel}`, executed: true };
      },
    },
    {
      name: "search",
      description: "Search file contents with a regular expression. Returns path:line: text.",
      schema: schema({ pattern: { type: "string" }, path: { type: "string" } }, ["pattern"]),
      async run(args) {
        const rel = typeof args.path === "string" ? args.path : "";
        const base = inside(root, rel);
        if (!base) return { content: `refused: ${rel} is outside the workdir`, executed: false };
        let re: RegExp;
        try {
          re = new RegExp(String(args.pattern ?? ""));
        } catch {
          return { content: "invalid regular expression", executed: false };
        }
        const hits: string[] = [];
        for (const file of walk(base)) {
          if (hits.length >= MAX_SEARCH_HITS) break;
          let text: string;
          try {
            const buf = readFileSync(file);
            if (buf.includes(0)) continue;
            text = buf.toString("utf8");
          } catch {
            continue;
          }
          text.split("\n").forEach((line, i) => {
            if (hits.length < MAX_SEARCH_HITS && re.test(line)) {
              hits.push(`${relative(root, file)}:${i + 1}: ${line.trim().slice(0, 200)}`);
            }
          });
        }
        return { content: hits.join("\n") || "(no matches)", executed: true };
      },
    },
    {
      name: "record_command",
      description:
        "Run a read-only shell command in the repository. Only commands on the allowlist execute; others are recorded as attempted and return executed: false.",
      schema: schema({ command: { type: "string" } }, ["command"]),
      async run(args) {
        return runAllowed(String(args.command ?? ""), root);
      },
    },
    {
      name: "load_skill",
      description:
        "Load the full instructions of one skill from the catalog. In the description-only harness this is the only way to see a skill's body.",
      schema: schema({ name: { type: "string" } }, ["name"]),
      async run(args) {
        const name = String(args.name ?? "");
        const skill =
          catalog.skills.find((s) => s.name === name) ?? catalog.skills.find((s) => s.skillId === name);
        if (!skill) return { content: `no skill named ${name}`, executed: false };
        onActivate(skill.skillId, now());
        return { content: skill.body, executed: true };
      },
    },
  ];
}
