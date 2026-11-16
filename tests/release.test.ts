import { describe, expect, it } from "vitest";
import { FETCHED, NON_BLANK, releaseCounts, TEXT_BEARING } from "../src/db/release.ts";
import { SqliteDb } from "../src/db/sqlite.ts";

/** A fixture reproducing the three cases that made the spec's count ambiguous. */
function fixture(): SqliteDb {
  const db = new SqliteDb({ path: ":memory:", readOnly: false });
  db.all("CREATE TABLE artifacts (path TEXT, content TEXT, content_fetched INTEGER)");
  const insert = "INSERT INTO artifacts (path, content, content_fetched) VALUES (?, ?, ?)";
  db.all(insert, ["null-body", null, 1]); // fetched, no body — the 19 rows
  db.all(insert, ["empty-string", "", 1]);
  db.all(insert, ["whitespace", "  \n\t ", 1]); // the one blank body
  db.all(insert, ["real", "---\nname: x\n---\ntext\n", 1]);
  db.all(insert, ["not-fetched", null, 0]);
  return db;
}

describe("text-bearing vocabulary", () => {
  it("counts a body only when content exists and is not empty", () => {
    const db = fixture();
    // "empty-string" is length 0; the fetch flag alone does not make a body.
    expect(db.scalar(`SELECT COUNT(*) FROM artifacts WHERE ${TEXT_BEARING}`)).toBe(2);
  });

  it("excludes a whitespace-only body from non-blank, tabs and newlines included", () => {
    const db = fixture();
    expect(db.scalar(`SELECT COUNT(*) FROM artifacts WHERE ${NON_BLANK}`)).toBe(1);
  });

  it("treats a fetch flag as status, not as content", () => {
    const db = fixture();
    expect(db.scalar(`SELECT COUNT(*) FROM artifacts WHERE ${FETCHED}`)).toBe(4);
    expect(db.scalar(`SELECT COUNT(*) FROM artifacts WHERE ${FETCHED} AND content IS NULL`)).toBe(1);
  });

  it("reports the four counts in one pass", () => {
    expect(releaseCounts(fixture())).toEqual({
      occurrences: 5,
      textBearing: 2,
      nonBlank: 1,
      fetched: 4,
    });
  });
});
