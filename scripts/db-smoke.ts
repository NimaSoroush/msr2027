import { assertReleaseIdentity } from "../src/chat2db/client.ts";
import { RELEASE_COUNTS, releaseCounts } from "../src/db/release.ts";
import { openRelease } from "../src/db/sqlite.ts";

const db = openRelease();

await assertReleaseIdentity(db);

const counts = releaseCounts(db);
const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");

// The pinned counts are the release's identity: a silent change here invalidates every derived number.
for (const [key, expected] of Object.entries(RELEASE_COUNTS)) {
  const actual = counts[key as keyof typeof counts];
  if (actual !== expected) {
    throw new Error(`release drift: ${key} is ${actual}, pinned at ${expected}`);
  }
}

console.log("artifacts:", counts.occurrences);
console.log("text-bearing:", counts.textBearing);
console.log("non-blank:", counts.nonBlank);
console.log("fetch-flagged:", counts.fetched);
console.log("tables:", tables.rows.map((r) => r[0]).join(", "));
console.log("identity: ok (GitSkills v1.0)");
console.log("read-only:", db.readOnly);

db.close();
