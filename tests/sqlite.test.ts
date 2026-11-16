import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SqliteDb, openRelease } from "../src/db/sqlite.ts";

const scratch = mkdtempSync(join(tmpdir(), "release-db-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A throwaway database shaped like the release, so the suite never needs the 41 GB file. */
function fixture(): SqliteDb {
  const db = new SqliteDb({ path: ":memory:", readOnly: false });
  db.all("CREATE TABLE artifacts (repo_full_name TEXT, path TEXT, content TEXT)");
  return db;
}

describe("SqliteDb.query", () => {
  it("keeps null, empty string and the literal text NULL distinct", async () => {
    const db = fixture();
    const insert = "INSERT INTO artifacts (path, content) VALUES (?, ?)";
    db.all(insert, ["a", null]);
    db.all(insert, ["b", ""]);
    db.all(insert, ["c", "NULL"]);

    const r = await db.query("SELECT path, content FROM artifacts ORDER BY path");
    expect(r.rows).toEqual([
      ["a", null],
      ["b", ""],
      ["c", "NULL"],
    ]);
  });

  it("does not confuse a real newline with a literal backslash-n", async () => {
    const db = fixture();
    const insert = "INSERT INTO artifacts (path, content) VALUES (?, ?)";
    db.all(insert, ["real", "a\nb"]);
    db.all(insert, ["literal", "a\\nb"]);

    const rows = db.all<{ path: string; content: string }>(
      "SELECT path, content FROM artifacts ORDER BY path",
    );
    expect(rows[1].content).toBe("a\nb");
    expect(rows[0].content).toBe("a\\nb");
    expect(rows[0].content).not.toBe(rows[1].content);
  });

  it("returns a skill body byte-exact, tabs and all", async () => {
    const db = fixture();
    const body = "---\nname: x\ndescription: y\n---\n\n\tcode\there\n";
    db.all("INSERT INTO artifacts (path, content) VALUES (?, ?)", ["s", body]);

    const r = await db.query("SELECT content FROM artifacts");
    expect(r.rows[0][0]).toBe(body);
    expect(Buffer.from(r.rows[0][0] as string).length).toBe(Buffer.from(body).length);
  });

  it("binds parameters instead of interpolating, so quotes survive", async () => {
    const db = fixture();
    const hostile = "o'brien'; DROP TABLE artifacts; --";
    db.all("INSERT INTO artifacts (path, content) VALUES (?, ?)", ["h", hostile]);

    const r = await db.query("SELECT content FROM artifacts WHERE path = ?", ["h"]);
    expect(r.rows[0][0]).toBe(hostile);
    expect(db.scalar("SELECT COUNT(*) FROM artifacts")).toBe(1);
  });

  it("reports columns and counts without a page concept", async () => {
    const db = fixture();
    db.all("INSERT INTO artifacts (path, content) VALUES ('a', 'x')");

    const r = await db.query("SELECT path, content FROM artifacts");
    expect(r.columns).toEqual(["path", "content"]);
    expect(r.rowCount).toBe(1);
    expect(r.declaredRows).toBe(1);
    expect(r.hasNextPage).toBe(false);
    expect(r.omittedRows).toBe(0);
    expect(typeof r.durationMs).toBe("number");
  });

  it("surfaces a SQL error rather than an empty result", async () => {
    const db = fixture();
    await expect(db.query("SELECT nope FROM artifacts")).rejects.toThrow(/no such column/);
  });
});

describe("SqliteDb.queryAll", () => {
  it("returns 137 rows in one call, where the MCP transport capped at 50", async () => {
    const db = fixture();
    const insert = db.all("SELECT 1"); // warm the statement cache
    expect(insert.length).toBe(1);
    db.all(
      "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 137) " +
        "INSERT INTO artifacts (path, content) SELECT 'p' || n, 'c' || n FROM seq",
    );

    const all = await db.queryAll("SELECT path FROM artifacts ORDER BY path");
    expect(all.rows.length).toBe(137);
    expect(new Set(all.rows.map((r) => r[0])).size).toBe(137);
    expect(all.rows[136]).toEqual(["p99"]);
  });

  it("refuses a read above maxRows instead of exhausting memory", async () => {
    const db = new SqliteDb({ path: ":memory:", readOnly: false, maxRows: 5 });
    db.all("CREATE TABLE artifacts (path TEXT)");
    db.all(
      "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 50) " +
        "INSERT INTO artifacts (path) SELECT 'p' || n FROM seq",
    );

    await expect(db.query("SELECT path FROM artifacts")).rejects.toThrow(/refusing 50 rows/);
  });
});

describe("SqliteDb read-only mode", () => {
  it("refuses writes to the release file at the engine level", async () => {
    const path = join(scratch, "release.db");
    const writer = new SqliteDb({ path, readOnly: false });
    writer.all("CREATE TABLE artifacts (path TEXT)");
    writer.all("INSERT INTO artifacts (path) VALUES ('kept')");
    writer.close();

    const reader = new SqliteDb({ path });
    expect(await reader.scalar("SELECT COUNT(*) FROM artifacts")).toBe(1);
    await expect(reader.query("DELETE FROM artifacts")).rejects.toThrow(/readonly|read-only/i);
    expect(await reader.scalar("SELECT COUNT(*) FROM artifacts")).toBe(1);
    reader.close();
  });

  it("names the missing file instead of failing inside SQLite", () => {
    expect(() => openRelease({ path: join(scratch, "absent.db") })).toThrow(/set RELEASE_DB/);
  });
});
