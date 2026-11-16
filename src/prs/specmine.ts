import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";

export type PrRow = {
  tool: string;
  repo: string;
  prNumber: number;
  title: string;
  mergedAt: string;
  baseBranch: string;
  nFiles: number;
  nCodeFiles: number;
  touchesCode: boolean;
  additions: number;
  deletions: number;
};

export type PrFileRow = {
  repo: string;
  prNumber: number;
  filePath: string;
  changeStatus: string;
  isCode: boolean;
};

/**
 * RFC 4180, enough of it for this data: doubled quotes inside a quoted field, commas and
 * newlines preserved inside quotes, CRLF stripped by the caller.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

/** Columns are found by name, so a reordered release fails loudly instead of shifting values. */
function requireColumns(header: string[], required: string[], path: string): Map<string, number> {
  const index = new Map(header.map((name, i) => [name, i]));
  const missing = required.filter((name) => !index.has(name));
  if (missing.length > 0) {
    throw new Error(`${path}: missing column(s) ${missing.join(", ")}; header is ${header.join(",")}`);
  }
  return index;
}

async function* lines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path).pipe(createGunzip());
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let first = true;
  for await (const raw of rl) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (first) {
      first = false;
      if (line.trim() === "") continue;
    }
    yield line;
  }
}

const PR_REQUIRED = [
  "tool",
  "repo_name",
  "pr_number",
  "title",
  "is_merged",
  "merged_at",
  "base_branch",
  "n_files",
  "n_code_files",
  "touches_code",
  "additions",
  "deletions",
];

const PR_FILE_REQUIRED = [
  "repo_name",
  "pr_number",
  "file_path",
  "change_status",
  "is_code",
];

const num = (value: string | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export async function* streamPullRequests(path: string): AsyncGenerator<PrRow> {
  let index: Map<string, number> | undefined;
  for await (const line of lines(path)) {
    const cells = splitCsvLine(line);
    if (!index) {
      index = requireColumns(cells, PR_REQUIRED, path);
      continue;
    }
    if (cells.length === 1 && cells[0] === "") continue;
    const at = (name: string) => cells[index!.get(name)!];
    if (at("is_merged") !== "1") continue;
    yield {
      tool: at("tool"),
      repo: at("repo_name"),
      prNumber: num(at("pr_number")),
      title: at("title"),
      mergedAt: at("merged_at"),
      baseBranch: at("base_branch"),
      nFiles: num(at("n_files")),
      nCodeFiles: num(at("n_code_files")),
      touchesCode: at("touches_code") === "1",
      additions: num(at("additions")),
      deletions: num(at("deletions")),
    };
  }
  if (!index) throw new Error(`${path}: empty input, no header`);
}

export async function* streamPrFiles(path: string): AsyncGenerator<PrFileRow> {
  let index: Map<string, number> | undefined;
  for await (const line of lines(path)) {
    const cells = splitCsvLine(line);
    if (!index) {
      index = requireColumns(cells, PR_FILE_REQUIRED, path);
      continue;
    }
    if (cells.length === 1 && cells[0] === "") continue;
    const at = (name: string) => cells[index!.get(name)!];
    yield {
      repo: at("repo_name"),
      prNumber: num(at("pr_number")),
      filePath: at("file_path"),
      changeStatus: at("change_status"),
      isCode: at("is_code") === "1",
    };
  }
  if (!index) throw new Error(`${path}: empty input, no header`);
}

/** Grouped by `${repo}#${prNumber}`, filtered before allocation so a large release stays cheap. */
export async function readAllPrFiles(
  path: string,
  filter: (r: PrFileRow) => boolean,
): Promise<Map<string, PrFileRow[]>> {
  const out = new Map<string, PrFileRow[]>();
  for await (const row of streamPrFiles(path)) {
    if (!filter(row)) continue;
    const key = `${row.repo}#${row.prNumber}`;
    const bucket = out.get(key);
    if (bucket) bucket.push(row);
    else out.set(key, [row]);
  }
  return out;
}
