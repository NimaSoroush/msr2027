import { assertReleaseIdentity } from "../src/chat2db/client.ts";
import { openRelease } from "../src/db/sqlite.ts";

const db = openRelease();

await assertReleaseIdentity(db);

const count = await db.query("SELECT COUNT(*) AS n FROM artifacts");
const withText = await db.query(
  "SELECT COUNT(*) AS n FROM artifacts WHERE content IS NOT NULL AND content <> ''",
);
const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");

console.log("artifacts:", count.rows[0]?.[0]);
console.log("with text:", withText.rows[0]?.[0]);
console.log("tables:", tables.rows.map((r) => r[0]).join(", "));
console.log("identity: ok (GitSkills v1.0)");
console.log("read-only:", db.readOnly);

db.close();
