import type { SqliteDb } from "./sqlite.ts";

/**
 * Pinned vocabulary for "how much skill text does the release hold".
 *
 * The release carries 3,797,117 artifact occurrences. Three different questions can be
 * asked of them, and the protocol must not let one stand in for another:
 *
 *   text-bearing   `content IS NOT NULL`          — a body exists (1,880,329)
 *   non-blank      plus a whitespace trim         — a body with something in it (1,880,327)
 *   fetched        `content_fetched = 1`          — pipeline status, not content (1,880,348)
 *
 * Two bodies are whitespace only (spaces, tabs or newlines), so `non-blank` sits two below
 * `text-bearing`. The 19-row difference between `fetched` and `text-bearing` is real: those rows are
 * flagged as fetched but hold `content IS NULL` and have no parsed frontmatter, e.g.
 * `kasuboski/pig:test_data/skills/empty-skill/SKILL.md`. Counting fetch flags as text
 * would inflate the corpus by 19 occurrences and would count a nonexistent body as material.
 */
export const TEXT_BEARING = "content IS NOT NULL AND length(content) > 0";
/** `trim()` alone strips spaces only, so the character set is explicit: space, tab, CR, LF. */
export const NON_BLANK =
  "content IS NOT NULL AND length(trim(content, ' ' || char(9) || char(10) || char(13))) > 0";
export const FETCHED = "content_fetched = 1";

/** Measured 2026-11-16 against the pinned release; every derived artifact is checked against it. */
export const RELEASE_COUNTS = {
  occurrences: 3_797_117,
  textBearing: 1_880_329,
  nonBlank: 1_880_327,
  fetched: 1_880_348,
} as const;

export type ReleaseCounts = {
  occurrences: number;
  textBearing: number;
  nonBlank: number;
  fetched: number;
};

/** All four counts in one pass, so a single scan answers the whole question. */
export function releaseCounts(db: SqliteDb): ReleaseCounts {
  const row = db.all<Record<string, number>>(`
    SELECT
      COUNT(*) AS occurrences,
      SUM(${TEXT_BEARING}) AS textBearing,
      SUM(${NON_BLANK}) AS nonBlank,
      SUM(${FETCHED}) AS fetched
    FROM artifacts
  `)[0];

  return {
    occurrences: row.occurrences,
    textBearing: row.textBearing,
    nonBlank: row.nonBlank,
    fetched: row.fetched,
  };
}
