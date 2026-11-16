import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** One parsed `execute_sql` response. `rows` is what arrived, `declaredRows` what the server said exists. */
export type SqlResult = {
  columns: string[];
  rows: string[][];
  rowCount: number;
  /** `rows:` in the envelope: min(result size, requested pageSize). Not a delivery promise. */
  declaredRows: number;
  hasNextPage: boolean;
  durationMs: number;
  /** Rows the server elided behind `... N more rows not shown.`; the text always caps at 50. */
  omittedRows?: number;
};

/** Raised when a response delivered fewer rows than it declared — the silent 50-row truncation. */
export class PageLossError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageLossError";
  }
}

/** Raised when the datasource is not the pinned GitSkills release. */
export class WrongDatasourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrongDatasourceError";
  }
}

export type ParseOptions = {
  /** Used by `queryAll` on a whole-table read: a short page is a bug, not a page. */
  requireComplete?: boolean;
};

const ARTIFACT_COUNT = 3_797_117;
const MAX_PAGE_SIZE = 500;
const DELIVERY_CAP = 50;
const MAX_ROWS = 2_000_000;
const REQUIRED_TABLES = ["artifacts", "artifact_siblings"];

/** `\t` escape used inside a cell, distinct from the tab that separates cells. */
function unescapeCell(cell: string): string {
  return cell.replace(/\\t/g, "\t");
}

/**
 * The live server returns the prose as an inner string: separators arrive as
 * `\n` / `\t` escapes rather than bytes, while a tab inside a cell is `\\t`.
 * Rewrite one level only, so downstream splitting still sees separators.
 */
function decodeEscapedEnvelope(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    const third = body[i + 2];
    if (next === "\\") {
      if (third === "t" || third === "n") {
        // `\\t` / `\\n`: a literal tab or newline inside a cell — keep it escaped for the cell level.
        out += `\\${third}`;
        i += 2;
      } else {
        out += "\\";
        i += 1;
      }
      continue;
    }
    if (next === "n") {
      out += "\n";
      i += 1;
      continue;
    }
    if (next === "t") {
      out += "\t";
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Metadata fields arrive in one tab- or newline-separated block, sometimes packed into one cell. */
function metaField(meta: string, field: string): string | null {
  const m = new RegExp(`${field}:\\s*([^,\\t\\n]+)`, "i").exec(meta);
  return m ? m[1].trim() : null;
}

/**
 * Parse the prose `execute_sql` result: a quoted envelope, a metadata block, a
 * `sqlResult.rowNumber` marker cell, then the header and data rows.
 */
export function parseExecuteSqlText(text: string, opts: ParseOptions = {}): SqlResult {
  let body = text.trim();
  if (body.startsWith('"')) body = body.slice(1);
  if (body.endsWith('"')) body = body.slice(0, -1);
  body = body.replace(/\r\n/g, "\n");
  if (!body.includes("\n") && body.includes("\\n")) body = decodeEscapedEnvelope(body);

  const lines = body.split("\n");

  // A failed statement still arrives as `ok: true` with the error as prose.
  if (!body.includes("success:")) {
    throw new Error(`execute_sql failed: ${body.slice(0, 300)}`);
  }

  // Metadata lives above the row-number marker; a data cell may legitimately contain "rows:".
  const markerIdx = lines.findIndex((l) => l.includes("rowNumber"));
  const meta = (markerIdx === -1 ? lines.slice(0, 12) : lines.slice(0, markerIdx + 1)).join("\n");

  const success = metaField(meta, "success");
  const durationMs = Number(metaField(meta, "durationMs") ?? 0);
  const declaredRows = Number((metaField(meta, "rows") ?? "0").replace(/[^0-9]/g, ""));
  const hasNextPage = (metaField(meta, "hasNextPage") ?? "false").toLowerCase() === "true";

  if (!success || success.toLowerCase() !== "true") {
    throw new Error(`execute_sql did not report success (${success ?? "no success field"})`);
  }
  let columns: string[] | null = null;
  let dropRowNumber = false;
  let dataStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    const marker = cells.findIndex((c) => c.includes("rowNumber"));
    if (marker === -1) continue;

    dropRowNumber = true;
    const trailing = cells
      .slice(marker + 1)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (trailing.length > 0) {
      // Header shares the marker's line: "...rowNumber : no message.\tname\tpath"
      columns = trailing;
      dataStart = i + 1;
    } else {
      // Marker sits alone; the header is the next tab-separated line and leads with it too.
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].includes("\t")) continue;
        columns = lines[j]
          .split("\t")
          .slice(1)
          .map((c) => c.trim());
        dataStart = j + 1;
        break;
      }
    }
    break;
  }

  if (!columns) {
    const h = lines.findIndex((l) => l.includes("\t"));
    if (h !== -1) {
      columns = lines[h].split("\t").map((c) => c.trim());
      dataStart = h + 1;
    }
  }

  const rows: string[][] = [];
  let omittedRows = 0;
  if (columns && dataStart !== -1) {
    for (let i = dataStart; i < lines.length; i++) {
      const line = lines[i];
      if (line.length === 0) continue;
      const footer = /^\.\.\. (\d+) more rows not shown\.?$/.exec(line.trim());
      if (footer) {
        omittedRows = Number(footer[1]);
        continue;
      }
      const cells = line.split("\t").map(unescapeCell);
      if (dropRowNumber) cells.shift();
      if (cells.length === 0) continue;
      rows.push(cells);
    }
  }

  const result: SqlResult = {
    columns: columns ?? [],
    rows,
    rowCount: rows.length,
    declaredRows,
    hasNextPage,
    durationMs,
    omittedRows,
  };

  // Envelope drift: the declared size must be exactly delivered + elided.
  if (declaredRows !== rows.length + omittedRows) {
    throw new PageLossError(
      `page loss: declared ${declaredRows} rows, parsed ${rows.length} plus ${omittedRows} omitted`,
    );
  }

  if (opts.requireComplete && omittedRows > 0) {
    throw new PageLossError(
      `page loss: declared ${declaredRows} rows, parsed ${rows.length} (${omittedRows} not shown)`,
    );
  }

  return result;
}

export type Chat2DbConfig = {
  datasourceId: number;
  databaseName: string;
  edition: string;
  binary: string;
  pageSize: number;
};

export type QueryOptions = {
  pageSize?: number;
  requireComplete?: boolean;
};

/** Thin client over `chat2db mcp call execute_sql`. All skill-database access goes through here. */
export class Chat2DbMcp {
  readonly config: Chat2DbConfig;
  private readonly cache = new Map<string, SqlResult>();

  constructor(config: Partial<Chat2DbConfig> = {}) {
    const datasourceId = config.datasourceId ?? Number(process.env.CHAT2DB_DATASOURCE_ID);
    if (!Number.isFinite(datasourceId) || datasourceId === 0) {
      throw new Error("CHAT2DB_DATASOURCE_ID is not set; it is machine-local and never committed");
    }
    this.config = {
      datasourceId,
      databaseName: config.databaseName ?? "main",
      edition: config.edition ?? "community",
      binary: config.binary ?? "chat2db",
      pageSize: config.pageSize ?? 200,
    };
  }

  /** Run one statement and parse the prose envelope. Cached by SQL text, never by page. */
  async query(sql: string, opts: QueryOptions = {}): Promise<SqlResult> {
    const cached = this.cache.get(sql);
    if (cached) return cached;

    const pageSize = opts.pageSize ?? this.config.pageSize;
    const args = [
      "mcp",
      "call",
      "execute_sql",
      "--args-json",
      JSON.stringify({
        sql,
        dataSourceId: this.config.datasourceId,
        databaseName: this.config.databaseName,
        pageSize,
      }),
      "--edition",
      this.config.edition,
      "--json",
    ];

    let stdout: string;
    try {
      stdout = (await execFileAsync(this.config.binary, args, { maxBuffer: 64 * 1024 * 1024 })).stdout;
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`chat2db mcp call failed: ${(e.stderr || e.message || "").slice(0, 400)}`);
    }

    let envelope: {
      ok?: boolean;
      error?: { code?: string; message?: string };
      data?: { result?: { content?: { text?: string }[]; isError?: boolean } };
    };
    try {
      envelope = JSON.parse(stdout);
    } catch {
      throw new Error(`chat2db mcp call returned non-JSON: ${stdout.slice(0, 200)}`);
    }

    if (envelope.ok === false) {
      throw new Error(`chat2db mcp call error: ${envelope.error?.code ?? "unknown"}`);
    }
    const payload = envelope.data?.result;
    if (!payload || payload.isError) {
      throw new Error("chat2db mcp call reported isError on execute_sql");
    }
    const text = payload.content?.[0]?.text;
    if (typeof text !== "string") {
      throw new Error("chat2db mcp call returned no text content");
    }

    const parsed = parseExecuteSqlText(text, { requireComplete: opts.requireComplete });
    this.cache.set(sql, parsed);
    return parsed;
  }

  /**
   * Read a whole result set. The transport caps every response at `pageSize`
   * (default 200, max 500) and reports the *delivered* count in `rows:`, so the
   * declared size is not a total and `hasNextPage` only means "this page was
   * full". Paginate explicitly and stop on a short page; a short page that still
   * claims `hasNextPage` is an inconsistency, not an ending.
   *
   * The SQL must carry its own ORDER BY (the release is ingestion-ordered), or
   * paging over it is not stable.
   */
  async queryAll(sql: string, opts: QueryOptions = {}): Promise<SqlResult> {
    const base = sql.trim().replace(/[;\s]+$/, "");

    // Probe with the largest allowed page: `rows:` then reports the true size (capped at 500),
    // even though only the first 50 rows arrive. This is the only truthful total signal.
    const probe = await this.query(base, { pageSize: MAX_PAGE_SIZE, requireComplete: false });
    const declared = probe.declaredRows;
    // A probe below the cap reports the exact total. At the cap the total is "at least 500",
    // so fall back to paging until a short or empty page ends the result.
    const exactTotal = declared < MAX_PAGE_SIZE ? declared : null;

    if (probe.rows.length >= declared) {
      return { ...probe, hasNextPage: false, omittedRows: 0 };
    }

    const rows: string[][] = [];
    for (let offset = 0; ; offset += DELIVERY_CAP) {
      const page = await this.query(`SELECT * FROM (${base}) LIMIT ${DELIVERY_CAP} OFFSET ${offset}`, {
        pageSize: DELIVERY_CAP,
      });
      if (page.rows.length === 0) break;
      if (exactTotal !== null) {
        const expected = Math.min(DELIVERY_CAP, exactTotal - offset);
        if (page.rows.length !== expected) {
          throw new PageLossError(
            `page loss at offset ${offset}: expected ${expected} rows, got ${page.rows.length} (declared ${exactTotal})`,
          );
        }
      }
      rows.push(...page.rows);
      if (rows.length >= MAX_ROWS) {
        throw new PageLossError(`refusing to page past ${MAX_ROWS} rows; narrow the query`);
      }
      if (page.rows.length < DELIVERY_CAP) break;
      if (exactTotal !== null && rows.length >= exactTotal) break;
    }

    if (exactTotal !== null && rows.length !== exactTotal) {
      throw new PageLossError(`page loss: declared ${exactTotal} rows, assembled ${rows.length}`);
    }

    return { ...probe, rows, rowCount: rows.length, declaredRows: rows.length, hasNextPage: false, omittedRows: 0 };
  }
}

/** Confirm the datasource really is the pinned GitSkills v1.0 release before any count is trusted. */
export async function assertReleaseIdentity(
  runner: { query(sql: string): Promise<SqlResult> },
  expectedArtifacts: number = ARTIFACT_COUNT,
): Promise<void> {
  const count = await runner.query("SELECT COUNT(*) AS n FROM artifacts");
  const n = Number(count.rows[0]?.[0]);
  if (n !== expectedArtifacts) {
    throw new WrongDatasourceError(
      `wrong datasource: expected the GitSkills release with ${expectedArtifacts} artifacts, found ${n}`,
    );
  }

  const tables = await runner.query("SELECT name FROM sqlite_master WHERE type='table'");
  const names = new Set(tables.rows.map((r) => r[0]));
  const missing = REQUIRED_TABLES.filter((t) => !names.has(t));
  if (missing.length > 0) {
    throw new WrongDatasourceError(`wrong datasource: missing table(s) ${missing.join(", ")}`);
  }
}
