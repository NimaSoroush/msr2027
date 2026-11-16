import { existsSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { QueryOptions, SqlResult } from "./types.ts";

/**
 * Read-only reader for the GitSkills release, the study's extraction path.
 *
 * The release is a plain SQLite file, so there is no reason to route skill text through a
 * prose transport: values arrive exactly as stored, `null` stays `null`, a literal `\n`
 * stays a literal backslash-n, and nothing is capped at 50 rows.
 */
export type SqliteConfig = {
  /** Defaults to `RELEASE_DB`, then `agent_skills_release.db` in the working directory. */
  path?: string;
  /** Default true: the release is evidence, never a scratch space. */
  readOnly?: boolean;
  /** Refuse an accidental full-table materialisation. */
  maxRows?: number;
};

const DEFAULT_PATH = "agent_skills_release.db";
const DEFAULT_MAX_ROWS = 2_000_000;

/** Map one stored value to text without inventing anything: `null` is not the string "NULL". */
function toCell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  return String(value);
}

export class SqliteDb {
  readonly path: string;
  readonly readOnly: boolean;
  readonly #db: DatabaseSync;
  readonly #maxRows: number;

  constructor(config: SqliteConfig = {}) {
    this.path = config.path ?? process.env.RELEASE_DB ?? DEFAULT_PATH;
    this.readOnly = config.readOnly ?? true;
    this.#maxRows = config.maxRows ?? DEFAULT_MAX_ROWS;

    const inMemory = this.path.startsWith(":");
    // A reader must not quietly create an empty database where the release should be.
    if (this.readOnly && !inMemory && !existsSync(this.path)) {
      throw new Error(`release database not found at ${this.path}; set RELEASE_DB to point at it`);
    }

    this.#db = new DatabaseSync(this.path, { readOnly: this.readOnly });
    if (this.readOnly) this.#db.exec("PRAGMA query_only = 1");
  }

  /** One statement, cells as text, `null` preserved. Bind values rather than interpolating. */
  async query(sql: string, params: SQLInputValue[] = []): Promise<SqlResult> {
    const started = performance.now();
    const statement = this.#db.prepare(sql);
    const columns = statement.columns().map((c) => c.name);
    statement.setReturnArrays(true);
    const raw = statement.all(...params) as unknown as unknown[][];
    this.#guard(raw.length, sql);

    const rows = raw.map((row) => row.map(toCell));
    return {
      columns,
      rows,
      rowCount: rows.length,
      declaredRows: rows.length,
      hasNextPage: false,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
      omittedRows: 0,
    };
  }

  /** A direct read does not page: it returns every row or throws. Same name as the MCP client's. */
  async queryAll(sql: string, _opts: QueryOptions = {}): Promise<SqlResult> {
    return this.query(sql);
  }

  /** Typed extraction: exact values, objects keyed by column, no text conversion. */
  all<T = Record<string, unknown>>(sql: string, params: SQLInputValue[] = []): T[] {
    const rows = this.#db.prepare(sql).all(...params) as T[];
    this.#guard(rows.length, sql);
    return rows;
  }

  /** First column of the first row, exact. */
  scalar<T = string | number | null>(sql: string, params: SQLInputValue[] = []): T | null {
    const statement = this.#db.prepare(sql);
    statement.setReturnArrays(true);
    const row = statement.get(...params) as unknown[] | undefined;
    return (row?.[0] ?? null) as T | null;
  }

  close(): void {
    this.#db.close();
  }

  #guard(count: number, sql: string): void {
    if (count > this.#maxRows) {
      throw new Error(
        `refusing ${count} rows (max ${this.#maxRows}); add a LIMIT to: ${sql.slice(0, 80)}`,
      );
    }
  }
}

/** Open the pinned release read-only. */
export function openRelease(config?: SqliteConfig): SqliteDb {
  return new SqliteDb(config);
}
