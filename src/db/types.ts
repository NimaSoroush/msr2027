/**
 * Shared shape for anything that reads the GitSkills release, whichever transport does it.
 * `rows` keeps `null` as `null` so a missing value never passes for the string "NULL".
 */
export type SqlResult = {
  columns: string[];
  rows: (string | null)[][];
  rowCount: number;
  /** What the source claims exists. For a direct read this equals `rowCount`. */
  declaredRows: number;
  hasNextPage: boolean;
  durationMs: number;
  /** Rows elided by a transport that truncates (Chat2DB only); always 0 for a direct read. */
  omittedRows?: number;
};

/** Raised when a response delivered fewer rows than it declared — silent truncation. */
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

export type QueryOptions = {
  /** Chat2DB's page size; ignored by the direct transport, which does not page. */
  pageSize?: number;
  /** Chat2DB: a short page is a bug, not a page. */
  requireComplete?: boolean;
};

/** GitSkills v1.0 as shipped: the number every derived artifact is checked against. */
export const ARTIFACT_COUNT = 3_797_117;

export const REQUIRED_TABLES = ["artifacts", "artifact_siblings"];
