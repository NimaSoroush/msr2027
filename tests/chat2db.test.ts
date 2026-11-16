import { describe, it, expect } from "vitest";
import { parseExecuteSqlText, Chat2DbMcp, assertReleaseIdentity, WrongDatasourceError, PageLossError } from "../src/chat2db/client.ts";

/**
 * Stand-in for the measured transport behaviour: `rows:` is min(result, pageSize),
 * the text never carries more than 50 rows, and the rest is elided behind a footer.
 */
class FakePages extends Chat2DbMcp {
  calls = 0;
  constructor(
    private readonly source: string[][],
    private readonly truncatePageAt?: number,
  ) {
    super({ datasourceId: 1 });
  }
  override async query(sql: string) {
    this.calls += 1;
    const offset = Number(/OFFSET (\d+)/.exec(sql)?.[1] ?? 0);
    const limitMatch = /LIMIT (\d+)/.exec(sql);
    const remaining = this.source.length - offset;
    const declared = limitMatch ? Math.min(Number(limitMatch[1]), remaining) : remaining;
    const delivered = Math.min(50, declared, this.truncatePageAt ?? Infinity);
    const rows = this.source.slice(offset, offset + delivered);
    return {
      columns: ["v"],
      rows,
      rowCount: rows.length,
      declaredRows: limitMatch ? rows.length : declared,
      hasNextPage: remaining > declared,
      durationMs: 1,
      omittedRows: limitMatch ? 0 : Math.max(0, declared - rows.length),
    };
  }
}

const REAL = `"## Result 1\tsuccess: true\tsqlType: SELECT\tdurationMs: 4\tdescription: sqlResult.success : no message.\trows: 3, hasNextPage: true\tsqlResult.rowNumber : no message.\trepo_full_name\tpath\tbody_chars\n1\twilliamfiset/algorithms\t.gemini/SKILL.md\t19\n2\tlvisei/web-developer-resources\tvue/skill.md\t5\n3\tPhongFeng/FFramework\tTools/ReadMe/Skill.md\t10"`;

describe("parseExecuteSqlText", () => {
  it("drops the quoted envelope and the row-number column", () => {
    const r = parseExecuteSqlText(REAL);
    expect(r.columns).toEqual(["repo_full_name", "path", "body_chars"]);
    expect(r.rows[0]).toEqual(["williamfiset/algorithms", ".gemini/SKILL.md", "19"]);
  });
  it("reports declared size and page state separately", () => {
    const r = parseExecuteSqlText(REAL);
    expect(r.rows.length).toBe(3);
    expect(r.declaredRows).toBe(3);
    expect(r.hasNextPage).toBe(true);
    expect(r.durationMs).toBe(4);
  });
  it("throws on a non-successful result", () => {
    expect(() => parseExecuteSqlText(`"## Result 1\nsuccess: false\n"`)).toThrow(/success/);
  });
  it("keeps tabs inside a cell that contains an escaped separator", () => {
    const t = `"## Result 1\nsuccess: true\ndurationMs: 1\nrows: 1, hasNextPage: false\nsqlResult.rowNumber : no message.\ta\tb\n1\tx\\ty\tz"`;
    expect(parseExecuteSqlText(t).rows[0]).toEqual(["x\ty", "z"]);
  });
});

// Captured live from `chat2db mcp call execute_sql`: the envelope escapes its own separators.
const LIVE = `"## Result 1\\nsuccess: true\\nsqlType: SELECT\\ndurationMs: 117\\ndescription: sqlResult.success : no message.\\nrows: 2, hasNextPage: false\\nsqlResult.rowNumber : no message.\\ta\\tb\\n1\\taa\\tb\\n2\\tcc\\td"`;

describe("the live escaped envelope", () => {
  it("parses rows and columns, not one long metadata cell", () => {
    const r = parseExecuteSqlText(LIVE);
    expect(r.columns).toEqual(["a", "b"]);
    expect(r.rows).toEqual([["aa", "b"], ["cc", "d"]]);
    expect(r.declaredRows).toBe(2);
    expect(r.hasNextPage).toBe(false);
    expect(r.durationMs).toBe(117);
    expect(r.omittedRows).toBe(0);
  });

  it("reads the elision footer as metadata, not as a data row", () => {
    // Shape captured live: 50 rows of text, then "... N more rows not shown."
    const truncated = `"## Result 1\\nsuccess: true\\ndurationMs: 0\\nrows: 3, hasNextPage: false\\nsqlResult.rowNumber : no message.\\tpath\\n1\\ta/SKILL.md\\n2\\tb/SKILL.md\\n... 1 more rows not shown."`;
    const r = parseExecuteSqlText(truncated);
    expect(r.rows).toEqual([["a/SKILL.md"], ["b/SKILL.md"]]);
    expect(r.omittedRows).toBe(1);
    expect(r.declaredRows).toBe(3);
  });

  it("throws when declared size does not equal delivered plus elided", () => {
    const drift = `"## Result 1\\nsuccess: true\\ndurationMs: 0\\nrows: 9, hasNextPage: false\\nsqlResult.rowNumber : no message.\\tpath\\n1\\ta"`;
    expect(() => parseExecuteSqlText(drift)).toThrow(/declared 9/);
  });
});

describe("Chat2DbMcp.queryAll paging", () => {
  const grid = (n: number) => Array.from({ length: n }, (_, i) => [String(i)]);

  it("assembles all 137 rows although the transport delivers 50 per call", async () => {
    const db = new FakePages(grid(137));
    const all = await db.queryAll("SELECT v FROM t ORDER BY v");
    expect(all.rows.length).toBe(137);
    expect(all.rows[49]).toEqual(["49"]);
    expect(all.rows[136]).toEqual(["136"]);
    expect(new Set(all.rows.map((r) => r[0])).size).toBe(137);
    expect(all.hasNextPage).toBe(false);
  });

  it("stops exactly on a multiple of the delivery cap", async () => {
    const db = new FakePages(grid(100));
    const all = await db.queryAll("SELECT v FROM t ORDER BY v");
    expect(all.rows.length).toBe(100);
    expect(db.calls).toBe(3); // probe + 2 pages
  });

  it("refuses a page that arrives short of the total", async () => {
    const db = new FakePages(grid(137), 20);
    await expect(db.queryAll("SELECT v FROM t ORDER BY v")).rejects.toBeInstanceOf(PageLossError);
  });

  it("pages past the probe cap when the total is unknown", async () => {
    const db = new FakePages(grid(600));
    const all = await db.queryAll("SELECT v FROM t ORDER BY v");
    expect(all.rows.length).toBe(600);
    expect(all.rows[599]).toEqual(["599"]);
  });
});

describe("Chat2DbMcp.queryAll", () => {
  it("refuses to accept a page shorter than the declared row count", () => {
    // declared 306, delivered 50 — the exact bug that made an earlier count wrong
    const short = `"## Result 1\nsuccess: true\ndurationMs: 1\nrows: 306, hasNextPage: true\nsqlResult.rowNumber : no message.\trepo\n1\ta/b"`;
    expect(() => parseExecuteSqlText(short, { requireComplete: true })).toThrow(/declared 306/);
  });
});

describe("assertReleaseIdentity", () => {
  const ok = (sql: string) =>
    sql.includes("COUNT(*)")
      ? { columns: ["n"], rows: [["3797117"]], rowCount: 1, declaredRows: 1, hasNextPage: false, durationMs: 1 }
      : { columns: ["name"], rows: [["artifacts"], ["artifact_siblings"]], rowCount: 2, declaredRows: 2, hasNextPage: false, durationMs: 1 };
  it("accepts the release", async () => {
    await expect(assertReleaseIdentity({ query: async (s) => ok(s) })).resolves.toBeUndefined();
  });
  it("rejects another database", async () => {
    await expect(assertReleaseIdentity({ query: async () => ({ columns: ["n"], rows: [["12"]], rowCount: 1, declaredRows: 1, hasNextPage: false, durationMs: 1 }) }))
      .rejects.toBeInstanceOf(WrongDatasourceError);
  });
});
