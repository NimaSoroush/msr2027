import { Chat2DbMcp, assertReleaseIdentity } from "../src/chat2db/client.ts";

const db = new Chat2DbMcp();

await assertReleaseIdentity(db);

const count = await db.query("SELECT COUNT(*) AS n FROM artifacts");
const tables = await db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");

console.log("artifacts:", count.rows[0]?.[0]);
console.log("tables:", tables.rows.map((r) => r[0]).join(", "));
console.log("identity: ok (GitSkills v1.0)");
