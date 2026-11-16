> **SUPERSEDED — do not execute.** This plan implements the pre-abstract design (a router-prompt
> experiment with 200 frozen candidate sets). The spec was revised to a **PR-replay activation study**
> and then retargeted to MSR 2027 Registered Reports; the current plan is
> `docs/superpowers/plans/2026-11-14-activation-study.md`. Kept for reference only: the Cohen's κ
> implementation, and the compressor and statistics sketches, carry over in revised form.

# Context Compression of `SKILL.md` — Implementation Plan (superseded)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the TypeScript pipeline behind the MSR 2027 challenge paper: a Chat2DB MCP client, deterministic compressors, a routing benchmark frozen from real skills, the routing/retention experiment harness, the cluster-robust analysis, and the sampled population exposure estimate.

**Architecture:** Five layers, one direction of dependency. `chat2db` owns all database access (MCP subprocess + text-result parser + cache) and is the only layer that knows the release exists. `compress` holds pure text transforms. `bench` composes SQL and freezes material (frames, candidates, tasks, annotations). `experiment` renders prompts, calls selectors, runs the grid, and analyses. `rcs` and `retention` score real skills with the same compressors. Every cross-layer value is a plain object whose keys are named in the task's **Interfaces** block.

**Tech Stack:** Node 24 (native TypeScript type stripping, no build step), `vitest`, `js-tiktoken` (`cl100k_base`), `openai`; LaTeX `IEEEtran` for the paper.

**Spec:** `docs/superpowers/specs/2026-11-13-skillmd-compression-design.md`

## Global Constraints

- **All database access goes through Chat2DB MCP.** No SQLite driver, no `node:sqlite`, no reading the `.db` file. Datasource `@localhost` (id `1794342162040999`, machine-local, never hard-coded in shipped code — read from `CHAT2DB_DATASOURCE_ID`), database `main`.
- Dataset is **GitSkills v1.0, July 2026 snapshot, DOI 10.5281/zenodo.21875637**; every derived artifact records `gitskills-v1.0-jul2026`.
- **Real skills only.** No synthetic or invented skill text anywhere in analysis or evaluation; tests may use short literal strings, but every benchmark candidate, task and retention item comes from the release and is traceable by `repo_full_name` + `path`.
- MCP facts that are load-bearing: `execute_sql` returns **prose text, not JSON**; `pageSize` caps at **500**; `hasNextPage` must be handled explicitly; a full-table aggregate costs ~57 s, so expensive queries are cached.
- Never `ORDER BY rowid LIMIT n` for sampling; push `ROW_NUMBER() OVER (...)` or `rowid % k` into SQL.
- Determinism: seeds exactly **17, 23, 41**; sampling seed **20261223**; selector temperature **0.0**; a treatment must be byte-identical for identical input.
- Token accounting uses one pinned tokenizer (`js-tiktoken`, `cl100k_base`); ratios are on tokens, never bytes or characters.
- No third-party repository code is ever executed — the design has no execution study.
- No PII beyond public GitHub handles; no deanonymisation; `.mcp.json` (MCP token) is never read, logged or shipped.
- The routing grid **refuses to run without** `prereg/primary-outcome.json`, and the primary outcome is not a flag.
- TypeScript is run directly by Node 24 (`node script.ts`); no bundler, no `ts-node`. `strict` is on.

## Review Focus

Failure modes the spec implies but no task's happy path exercises, each pinned by a test in the task that owns the code:

1. **MCP text envelope drift** — a quoted string, a prefixed row-number column, and a `hasNextPage: true` page must not silently yield a short or shifted table (Task 1).
2. **Frontmatter-only or empty body** — real skills can have a description and no procedure; compressors return unchanged non-empty text and never throw (Task 3, Task 4).
3. **Negations and constraint modals** — `must`, `never`, `not`, `only` are function words; a naive stopword filter deletes them and silently changes behaviour (Task 3).
4. **Non-ASCII skill text** — the corpus is multilingual; tokenizer and line operations must not corrupt CJK or accented text (Task 2, Task 3).
5. **Duplicate candidate names and descriptions** — 50.5% of occurrences are verbatim copies, so a candidate set can legitimately contain identical text; indices must be unique and stable across treatments (Task 10).
6. **NULL description or body** — excluded at query time and never rendered as the string `"None"`/`"null"` (Task 6, Task 10).

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Node 24, strict TS, vitest |
| `src/chat2db/client.ts` | MCP subprocess transport, text parser, identity guard |
| `src/chat2db/queries.ts` | SQL builders, on-disk cache |
| `src/tokens.ts` | pinned tokenizer, ratios |
| `src/compress/telegraphic.ts` | T1 |
| `src/compress/structure.ts` | T2 + dev-split tuning |
| `src/compress/lossy.ts` | T3 pinned-prompt adapter |
| `src/bench/frame.ts` | repo frame + candidate loading (real skills) |
| `src/bench/freeze.ts` | benchmark JSONL + manifest |
| `src/bench/tasks.ts` | task generation + leakage filters |
| `src/bench/annotate.ts` | annotation CSV + Cohen's κ |
| `src/experiment/render.ts` | prompt rendering, channels, reply parsing |
| `src/experiment/select.ts` | fake + OpenAI selectors |
| `src/experiment/grid.ts` | runner, prereg guard, resume, cost cap |
| `src/experiment/analysis.ts` | metrics, McNemar, risk differences, IRLS |
| `src/retention/judge.ts` | requirement extraction + judge (RQ3) |
| `src/rcs/score.ts` | RCS features |
| `src/rcs/population.ts` | stratified sample + weighted exposure |
| `scripts/make-artifact.ts` | deposit bundle + manifest |
| `paper/main.tex` | IEEEtran skeleton |

---

### Task 1: Chat2DB MCP client

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/chat2db/client.ts`
- Test: `tests/chat2db.test.ts`

**Interfaces:**
- Produces: `type SqlResult = { columns: string[]; rows: string[][]; rowCount: number; hasNextPage: boolean; durationMs: number }`; `parseExecuteSqlText(text: string): SqlResult`; `class Chat2DbMcp { constructor(cfg: { dataSourceId: number; databaseName?: string; edition?: "community" }) ; query(sql: string, opts?: { pageSize?: number }): Promise<SqlResult> }`; `assertReleaseIdentity(runner: { query(sql: string): Promise<SqlResult> }): Promise<void>` throwing `WrongDatasourceError`.

- [ ] **Step 1: Scaffold the project**

```bash
npm init -y >/dev/null
npm i -D vitest typescript @types/node
npm i js-tiktoken openai
```
`package.json` scripts: `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`. `tsconfig.json`: `target ES2022`, `module NodeNext`, `moduleResolution NodeNext`, `strict true`, `allowImportingTsExtensions true`, `noEmit true`, include `src`, `tests`, `scripts`.

- [ ] **Step 2: Write the failing tests** (fixture is a real captured MCP response)

```ts
import { describe, it, expect } from "vitest";
import { parseExecuteSqlText, Chat2DbMcp, assertReleaseIdentity, WrongDatasourceError } from "../src/chat2db/client.ts";

const REAL = `"## Result 1\nsuccess: true\nsqlType: SELECT\ndurationMs: 4\ndescription: sqlResult.success : no message.\nrows: 3, hasNextPage: true\nsqlResult.rowNumber : no message.\trepo_full_name\tpath\tbody_chars\n1\twilliamfiset/algorithms\t.gemini/SKILL.md\t19\n2\tlvisei/web-developer-resources\tvue/skill.md\t5\n3\tPhongFeng/FFramework\tTools/ReadMe/Skill.md\t10"`;

describe("parseExecuteSqlText", () => {
  it("drops the quoted envelope and the row-number column", () => {
    const r = parseExecuteSqlText(REAL);
    expect(r.columns).toEqual(["repo_full_name", "path", "body_chars"]);
    expect(r.rows[0]).toEqual(["williamfiset/algorithms", ".gemini/SKILL.md", "19"]);
  });
  it("reports the page state", () => {
    const r = parseExecuteSqlText(REAL);
    expect(r.rowCount).toBe(3);
    expect(r.hasNextPage).toBe(true);
    expect(r.durationMs).toBe(4);
  });
  it("throws on a non-successful result", () => {
    expect(() => parseExecuteSqlText(`"## Result 1\nsuccess: false\n"`)).toThrow(/success/);
  });
});

describe("assertReleaseIdentity", () => {
  it("accepts the release", async () => {
    const runner = { query: async (sql: string) =>
      sql.includes("COUNT(*)") ? { columns: ["n"], rows: [["3797117"]], rowCount: 1, hasNextPage: false, durationMs: 1 }
      : { columns: ["name"], rows: [["artifacts"], ["repos"], ["artifact_siblings"], ["mining_runs"]], rowCount: 4, hasNextPage: false, durationMs: 1 } };
    await expect(assertReleaseIdentity(runner)).resolves.toBeUndefined();
  });
  it("rejects another database", async () => {
    const runner = { query: async () => ({ columns: ["n"], rows: [["12"]], rowCount: 1, hasNextPage: false, durationMs: 1 }) };
    await expect(assertReleaseIdentity(runner)).rejects.toBeInstanceOf(WrongDatasourceError);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/chat2db.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

`parseExecuteSqlText` strips a surrounding pair of quotes, splits on `\n`, requires `success: true`, reads `rows: N, hasNextPage: (true|false)` and `durationMs:`, then takes the first line containing a tab as the header; if its first cell includes `rowNumber` it is dropped along with the first cell of every data row. `Chat2DbMcp.query` spawns `chat2db mcp call execute_sql --args-json <json> --edition community --json` with `execFile`, parses the envelope, takes `data.result.content[0].text`, and feeds it to the parser; a non-zero exit or `ok: false` throws with the envelope's `error.code`. `context` (extensions) is used because `path` is the primary key of a skill row.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/chat2db.test.ts` — Expected: 5 passed. Then a live smoke check: `node -e` calling `new Chat2DbMcp({dataSourceId:Number(process.env.CHAT2DB_DATASOURCE_ID)})` and printing `SELECT COUNT(*) FROM artifacts` row.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/chat2db/client.ts tests/chat2db.test.ts
git commit -m "feat: Chat2DB MCP client with strict result parsing"
```

---

### Task 2: Token accounting

**Files:**
- Create: `src/tokens.ts`
- Test: `tests/tokens.test.ts`

**Interfaces:**
- Produces: `tokenCount(text: string): number`; `achievedRatio(original: string, compressed: string): number`; `reductionPct(original: string, compressed: string): number`; const `ENCODING = "cl100k_base"`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { tokenCount, achievedRatio, reductionPct } from "../src/tokens.ts";

describe("tokens", () => {
  it("counts empty as zero", () => { expect(tokenCount("")).toBe(0); });
  it("uses the pinned encoding", () => { expect(tokenCount("hello world")).toBe(2); });
  it("computes a ratio", () => { expect(achievedRatio("a b c d e", "a b c")).toBeCloseTo(0.6, 2); });
  it("treats an empty original as ratio 1", () => { expect(achievedRatio("", "")).toBe(1); });
  it("reports reduction as the complement", () => { expect(reductionPct("a b c d", "a b")).toBeCloseTo(50, 1); });
  it("survives non-ASCII", () => { expect(tokenCount("日本語のスキル手順")).toBeGreaterThan(0); });
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run tests/tokens.test.ts` → FAIL.

- [ ] **Step 3: Implement** `getEncoding(ENCODING)` cached once; ratios from token counts; `reductionPct` returns `100 * (1 - achievedRatio)`.

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run tests/tokens.test.ts` → 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/tokens.ts tests/tokens.test.ts
git commit -m "feat: pinned token accounting"
```

---

### Task 3: T1 telegraphic compressor

**Files:**
- Create: `src/compress/telegraphic.ts`
- Test: `tests/telegraphic.test.ts`

**Interfaces:**
- Produces: `compressTelegraphic(text: string): string`; `STOPWORDS: ReadonlySet<string>`; `PROTECTED = new Set(["must","never","always","not","only","no"])`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { compressTelegraphic } from "../src/compress/telegraphic.ts";

describe("T1 telegraphic", () => {
  it("drops articles and copulas", () => {
    expect(compressTelegraphic("The agent should always run the tests.")).toBe("agent always run tests.");
  });
  it("protects constraint modals", () => {
    expect(compressTelegraphic("You must never delete the lock file.")).toBe("must never delete lock file.");
  });
  it("keeps frontmatter verbatim", () => {
    const out = compressTelegraphic("---\nname: x\ndescription: y\n---\nThe body is short.\n");
    expect(out.startsWith("---\nname: x\ndescription: y\n---\n")).toBe(true);
    expect(out).toContain("body short.");
  });
  it("keeps code fences verbatim", () => {
    expect(compressTelegraphic("Intro text here.\n```\nnpm install -D typescript\n```\n")).toContain("npm install -D typescript");
  });
  it("keeps identifiers", () => {
    expect(compressTelegraphic("Run `npm run build` in src/app.ts.")).toBe("Run `npm run build` src/app.ts.");
  });
  it("returns frontmatter-only text unchanged", () => {
    const src = "---\nname: x\ndescription: y\n---\n";
    expect(compressTelegraphic(src)).toBe(src);
  });
  it("does not corrupt non-ASCII", () => {
    expect(compressTelegraphic("これは 手順 です。")).toBe("これは 手順 です。");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run tests/telegraphic.test.ts` → FAIL.

- [ ] **Step 3: Implement** Split into lines and track two states: inside YAML frontmatter, inside a fenced block. In either state emit the line unchanged. Otherwise split on whitespace, drop a token only if `STOPWORDS.has(lower)`, not `PROTECTED.has(lower)`, and it does not match `/[A-Za-z0-9_][\w./-]*[\d_./-][\w./-]*|`[^`]*`/`. Re-join with one space, keep blank lines and the trailing newline.

- [ ] **Step 4: Run tests to verify they pass** — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/compress/telegraphic.ts tests/telegraphic.test.ts
git commit -m "feat: telegraphic compressor preserving negations and identifiers"
```

---

### Task 4: T2 structure-preserving compressor and dev-split tuning

**Files:**
- Create: `src/compress/structure.ts`
- Test: `tests/structure.test.ts`

**Interfaces:**
- Produces: `compressStructure(text: string, minKeep?: number): string`; `tuneStructure(skills: string[], targetRatio?: number, grid?: number[]): { minKeep: number; achievedRatio: number; nSkills: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { compressStructure, tuneStructure } from "../src/compress/structure.ts";

const SRC = "# Deploy\nWe really love deploys and we think you will too, because deploys are fun.\n## Steps\n- run `make deploy`\n- check the dashboard\n```bash\nmake deploy PROD=1\n```\n";

describe("T2 structure", () => {
  it("keeps headings, list items and code", () => {
    const out = compressStructure(SRC, 0);
    expect(out).toContain("# Deploy");
    expect(out).toContain("- run `make deploy`");
    expect(out).toContain("make deploy PROD=1");
  });
  it("drops prose", () => { expect(compressStructure(SRC, 0)).not.toContain("really love deploys"); });
  it("honours the floor", () => { expect(compressStructure(SRC, 1)).toContain("really love deploys"); });
  it("returns empty input unchanged", () => { expect(compressStructure("")).toBe(""); });
  it("tunes deterministically", () => {
    const a = tuneStructure([SRC, SRC.replace("Deploy", "Build")], 2);
    const b = tuneStructure([SRC, SRC.replace("Deploy", "Build")], 2);
    expect(a).toEqual(b);
    expect([0.2, 0.3, 0.4, 0.5, 0.6, 0.8]).toContain(a.minKeep);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** Keep a line when it is a heading, list item, table row, fence delimiter/inside a fence, or matches `/\b(run|execute|install|must|never|always|do not|warning|required)\b/i`. If kept characters / original characters < `minKeep`, return the original. `tuneStructure` scores each grid point with `achievedRatio` and returns the one whose mean log-ratio is closest to `log(target)`, ties to the larger `minKeep`.

- [ ] **Step 4: Run tests to verify they pass** — 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/compress/structure.ts tests/structure.test.ts
git commit -m "feat: structure-preserving compressor with dev-split tuning"
```

---

### Task 5: Query layer with cache

**Files:**
- Create: `src/chat2db/queries.ts`
- Test: `tests/queries.test.ts`

**Interfaces:**
- Consumes: `Chat2DbMcp.query`.
- Produces: `const SQL = { countArtifacts, tableList, repoFrame(p: {minSkills:number; maxSkills:number; stride:number; limit:number}): string, candidatesForRepo(repo: string): string, bodyStats, copyDistribution }`; `cachedQuery<T>(runner, sql: string, cacheDir: string, map: (r: SqlResult) => T): Promise<T>`; `assertNoPageLoss(result: SqlResult): void` throwing `PageLossError`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { SQL, cachedQuery, assertNoPageLoss, PageLossError } from "../src/chat2db/queries.ts";

const ok = { columns: ["a"], rows: [["1"]], rowCount: 1, hasNextPage: false, durationMs: 1 };

describe("queries", () => {
  it("escapes repo names and never interpolates non-integers into limits", () => {
    expect(SQL.repoFrame({ minSkills: 8, maxSkills: 40, stride: 7, limit: 200 })).toMatch(/ROW_NUMBER\(\) OVER/);
    expect(SQL.candidatesForRepo("o'repo/x")).toContain("o''repo/x");
  });
  it("throws when a page is truncated", () => {
    expect(() => assertNoPageLoss({ ...ok, hasNextPage: true })).toThrow(PageLossError);
  });
  it("caches a result and does not re-query", async () => {
    let calls = 0;
    const runner = { query: async () => { calls++; return ok; } };
    const dir = mkdtempSync("/tmp/q-");
    await cachedQuery(runner, "SELECT 1", dir, (r) => r.rows.length);
    await cachedQuery(runner, "SELECT 1", dir, (r) => r.rows.length);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** `repoFrame` uses a `WITH base AS (... GROUP BY repo_full_name HAVING n BETWEEN ...) , ranked AS (SELECT ..., ROW_NUMBER() OVER (ORDER BY repo_full_name) rn FROM base) SELECT ... WHERE rn % stride = 0 ORDER BY repo_full_name LIMIT n`, with all numeric parameters validated as safe integers. `cachedQuery` hashes the SQL with `createHash("sha256")` into `<cacheDir>/<hash>.json` and re-reads it; it calls `assertNoPageLoss` on live results so a truncated page cannot be cached silently.

- [ ] **Step 4: Run tests to verify they pass** — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/chat2db/queries.ts tests/queries.test.ts
git commit -m "feat: cached SQL layer with page-loss guard"
```

---

### Task 6: Frame and candidate loading from real skills

**Files:**
- Create: `src/bench/frame.ts`
- Test: `tests/frame.test.ts`

**Interfaces:**
- Produces: `buildFrame(runner, opts: { minSkills?: number; maxSkills?: number; stride?: number; limit?: number; devSplit?: number }): Promise<{ evalRepos: {repo: string; n: number}[]; devRepos: {repo: string; n: number}[] }>`; `loadCandidates(runner, repo: string): Promise<Candidate[]>` where `Candidate = { skillId: string; name: string; description: string; body: string; bodyChars: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { buildFrame, loadCandidates } from "../src/bench/frame.ts";

const frameRows = { columns: ["repo_full_name", "n"], rows: [["a/1", "9"], ["a/2", "12"], ["a/3", "8"], ["a/4", "30"]], rowCount: 4, hasNextPage: false, durationMs: 1 };
const runner = { query: async () => frameRows };

describe("frame", () => {
  it("holds out the first devSplit repos and never overlaps", async () => {
    const f = await buildFrame(runner, { devSplit: 2 });
    expect(f.devRepos.map((r) => r.repo)).toEqual(["a/1", "a/2"]);
    expect(f.evalRepos.map((r) => r.repo)).toEqual(["a/3", "a/4"]);
  });
  it("rejects null descriptions instead of rendering them", async () => {
    const bad = { columns: ["skill_id", "name", "description"], rows: [["p", "n", "null"]], rowCount: 1, hasNextPage: false, durationMs: 1 };
    await expect(loadCandidates({ query: async () => bad }, "a/1")).rejects.toThrow(/description/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** `buildFrame` runs `SQL.repoFrame`, deterministically splits the ordered list (`slice(0, devSplit)` to dev), and returns both. `loadCandidates` runs `SQL.candidatesForRepo`, throws if any description is empty or the literal `"null"`/`"None"`, and truncates body to 24 000 chars.

- [ ] **Step 4: Run tests to verify they pass** — 2 passed.

- [ ] **Step 5: Run it against the release once and record the outcome**

Run: `CHAT2DB_DATASOURCE_ID=1794342162040999 node scripts/frame-smoke.ts` (a three-line entrypoint printing the first five eval repos).
Expected: real `owner/repo` names, `n` between 8 and 40, and 40 dev repos held out.

- [ ] **Step 6: Commit**

```bash
git add src/bench/frame.ts tests/frame.test.ts scripts/frame-smoke.ts
git commit -m "feat: repo frame and candidate loading over real skills"
```

---

### Task 7: Freeze the benchmark

**Files:**
- Create: `src/bench/freeze.ts`, `scripts/freeze.ts`
- Test: `tests/freeze.test.ts`

**Interfaces:**
- Consumes: `loadCandidates`.
- Produces: `freezeBenchmark(p: { runner: SqlRunner; repos: { repo: string; n: number }[]; outPath: string; seed?: number }): Promise<Manifest>` where `Manifest = { path: string; sha256: string; nRepos: number; nQueries: number; toolVersion: string; dataset: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { freezeBenchmark } from "../src/bench/freeze.ts";

const rows = { columns: ["skill_id", "name", "description", "body"], rowCount: 3, hasNextPage: false, durationMs: 1,
  rows: [["p0", "s0", "Alpha skill.", "b0"], ["p1", "s1", "Beta skill.", "b1"], ["p2", "s2", "Gamma skill.", "b2"]] };
const runner = { query: async () => rows };

describe("freeze", () => {
  it("writes one record per repo with an empty task slot", async () => {
    const dir = await import("node:fs/promises").then((fs) => fs.mkdtemp("/tmp/fz-"));
    const m = await freezeBenchmark({ runner, repos: [{ repo: "a/1", n: 3 }], outPath: `${dir}/bench.jsonl` });
    expect(m.nRepos).toBe(1);
    const rec = JSON.parse((await import("node:fs")).readFileSync(`${dir}/bench.jsonl`, "utf8").trim());
    expect(rec.candidates.length).toBe(3);
    expect(rec.queries[0].taskText).toBe("");
  });
  it("hashes the bytes stably", async () => {
    const dir = await import("node:fs/promises").then((fs) => fs.mkdtemp("/tmp/fz-"));
    const a = await freezeBenchmark({ runner, repos: [{ repo: "a/1", n: 3 }], outPath: `${dir}/a.jsonl` });
    const b = await freezeBenchmark({ runner, repos: [{ repo: "a/1", n: 3 }], outPath: `${dir}/b.jsonl` });
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** One record per repo: `{ repo, nCandidates, candidates, queries: [{ qid: `${repo}#${skillId}`, goldSkillId, goldName, taskText: "", taskSource: "gold_description", validated: false }] }`. Gold chosen by `mulberry32(seed + hashString(repo) % 10000)`; skip repos whose gold name appears in a competitor's name or description. Write JSONL with `\n`, hash the bytes with `sha256`, write `<stem>.manifest.json` excluding timestamps from the hash input.

- [ ] **Step 4: Run tests to verify they pass** — 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/bench/freeze.ts scripts/freeze.ts tests/freeze.test.ts
git commit -m "feat: frozen benchmark with content-addressed manifest"
```

---

### Task 8: Task generation and leakage filters

**Files:**
- Create: `src/bench/tasks.ts`
- Test: `tests/tasks.test.ts`

**Interfaces:**
- Produces: `makeTask(gold: Candidate, llm: (prompt: string) => Promise<string>): Promise<string>`; `checkLeakage(task: string, gold: Candidate, candidates: Candidate[], n?: number): { nameLeak: boolean; triggerLeak: boolean; discriminative: boolean; goldOverlap: number; maxOtherOverlap: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { makeTask, checkLeakage } from "../src/bench/tasks.ts";

const gold = { skillId: "a/x", name: "pdf-forms", description: 'Fill PDF forms. Triggers on "fill pdf", "acroform".', body: "", bodyChars: 0 };
const other = { skillId: "a/y", name: "csv-clean", description: "Clean CSV files before import.", body: "", bodyChars: 0 };

describe("tasks", () => {
  it("flags a leaked name and rejects it", () => {
    const r = checkLeakage("Use pdf-forms to fill the form.", gold, [gold, other]);
    expect(r.nameLeak).toBe(true);
    expect(r.discriminative).toBe(false);
  });
  it("accepts a clean paraphrase", () => {
    const r = checkLeakage("A recruiter sent a scanned job application and needs the fields completed.", gold, [gold, other]);
    expect(r.nameLeak).toBe(false);
    expect(r.discriminative).toBe(true);
  });
  it("flags a trigger phrase", () => {
    expect(checkLeakage("Please fill pdf the document.", gold, [gold, other]).triggerLeak).toBe(true);
  });
  it("calls the model once", async () => {
    let calls = 0;
    const out = await makeTask(gold, async () => { calls++; return "Complete the form fields."; });
    expect(out).toBe("Complete the form fields.");
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** `makeTask` sends the real gold description through a fixed prompt asking for a first-person request that never names a tool. `checkLeakage` lowercases; `nameLeak` on gold name presence; `triggerLeak` on any quoted phrase present; overlap = fraction of the task's `n`-grams appearing in the description; `discriminative` is `goldOverlap > maxOtherOverlap`.

- [ ] **Step 4: Run tests to verify they pass** — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/bench/tasks.ts tests/tasks.test.ts
git commit -m "feat: task generation with leakage filters"
```

---

### Task 9: Annotation round-trip and kappa

**Files:**
- Create: `src/bench/annotate.ts`
- Test: `tests/annotate.test.ts`

**Interfaces:**
- Produces: `cohensKappa(a: number[], b: number[]): number`; `loadAnnotationCsv(text: string): { qid: string; annotatorA: number; annotatorB: number }[]`; `acceptItems(rows, minAgreementRatio?: number): typeof rows`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { cohensKappa, loadAnnotationCsv, acceptItems } from "../src/bench/annotate.ts";

describe("annotate", () => {
  it("is 1 for perfect agreement", () => { expect(cohensKappa([1, 1, 0, 0], [1, 1, 0, 0])).toBe(1); });
  it("matches the known value", () => { expect(cohensKappa([1, 1, 0, 0], [1, 1, 0, 1])).toBeCloseTo(0.5, 9); });
  it("requires both annotator columns", () => {
    expect(() => loadAnnotationCsv("qid,annotator_a\nq1,1\n")).toThrow(/annotator_b/);
  });
  it("keeps only agreed items", () => {
    const rows = loadAnnotationCsv("qid,annotator_a,annotator_b\nq1,1,1\nq2,1,0\n");
    expect(acceptItems(rows).map((r) => r.qid)).toEqual(["q1"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** Standard 2×2 κ with `1` when `p_e === 1`; a minimal CSV splitter that validates both headers and throws naming the missing column; `acceptItems` keeps rows where both labels are `1`.

- [ ] **Step 4: Run tests to verify they pass** — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/bench/annotate.ts tests/annotate.test.ts
git commit -m "feat: annotation round-trip with Cohen's kappa"
```

---

### Task 10: Prompt rendering and reply parsing

**Files:**
- Create: `src/experiment/render.ts`
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: `Candidate` from Task 6.
- Produces: `CHANNELS = ["control","description","body","both"] as const`; `type Channel = typeof CHANNELS[number]`; `type Selection = { selected: number[]; abstain: boolean }`; `renderPrompt(p: { candidates: Candidate[]; task: string; channel: Channel; compress?: (t: string) => string; extraSkill?: string }): string`; `parseSelection(reply: string, nCandidates: number): Selection`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { renderPrompt, parseSelection } from "../src/experiment/render.ts";

const cands = [
  { skillId: "a/1", name: "dup", description: "Same text.", body: "B1", bodyChars: 2 },
  { skillId: "a/2", name: "dup", description: "Same text.", body: "B2", bodyChars: 2 },
];

describe("render", () => {
  it("compresses every candidate", () => {
    const seen: string[] = [];
    const out = renderPrompt({ candidates: cands, task: "do it", channel: "description", compress: (t) => { seen.push(t); return t.toUpperCase(); } });
    expect(seen.length).toBe(2);
    expect(out.split("SAME TEXT.").length - 1).toBe(2);
  });
  it("ignores the compressor on control", () => {
    expect(renderPrompt({ candidates: cands, task: "do it", channel: "control" }))
      .toBe(renderPrompt({ candidates: cands, task: "do it", channel: "control", compress: (t) => t.toUpperCase() }));
  });
  it("gives duplicate names unique indices", () => {
    const out = renderPrompt({ candidates: cands, task: "do it", channel: "control" });
    expect(out).toContain("[0]");
    expect(out).toContain("[1]");
  });
  it("does not index the extra skill", () => {
    const out = renderPrompt({ candidates: cands, task: "do it", channel: "control", extraSkill: "Answer telegraphically." });
    expect(out).toContain("Answer telegraphically.");
    expect(out).not.toContain("[2]");
  });
  it("rejects unknown channels", () => {
    // @ts-expect-error deliberate bad channel
    expect(() => renderPrompt({ candidates: cands, task: "t", channel: "everything" })).toThrow();
  });
  it("parses a valid reply", () => {
    expect(parseSelection('{"selected":[1],"abstain":false}', 2)).toEqual({ selected: [1], abstain: false });
  });
  it("rejects out-of-range indices", () => {
    expect(() => parseSelection('{"selected":[9],"abstain":false}', 2)).toThrow();
  });
  it("rejects prose", () => {
    expect(() => parseSelection("I would pick the second one.", 2)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** Fixed preamble, optional `extraSkill` block, then `[i] name: …` with `description:` and/or `body:` per channel, then the task and the JSON contract. `control` ignores `compress`. `parseSelection` strips fences, `JSON.parse`, validates shape and bounds.

- [ ] **Step 4: Run tests to verify they pass** — 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/experiment/render.ts tests/render.test.ts
git commit -m "feat: channel-aware rendering and strict reply parsing"
```

---

### Task 11: Selectors, treatments and the grid runner

**Files:**
- Create: `src/experiment/select.ts`, `src/experiment/grid.ts`, `src/compress/lossy.ts`, `prereg/primary-outcome.json`
- Test: `tests/grid.test.ts`

**Interfaces:**
- Produces: `type Selector = { name: string; select(prompt: string): Promise<Record<string, unknown>> }` returning `{ selected, abstain, raw, tokensIn, tokensOut, latencyMs }`; `class FakeSelector implements Selector { constructor(replies: Record<string,string>, tokensIn?: number) }`; `class OpenAiSelector implements Selector`; `TREATMENTS: Record<"control"|"telegraphic"|"structure"|"lossy-2x"|"lossy-4x", (t: string) => string>`; `runGrid(p): Promise<GridSummary>`; `class PreregMissing extends Error`, `class CostExceeded extends Error`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { FakeSelector } from "../src/experiment/select.ts";
import { runGrid, PreregMissing, CostExceeded, TREATMENTS } from "../src/experiment/grid.ts";

const rec = { repo: "a/one", nCandidates: 2,
  candidates: [{ skillId: "s0", name: "n0", description: "d0", body: "b0", bodyChars: 2 },
               { skillId: "s1", name: "n1", description: "d1", body: "b1", bodyChars: 2 }],
  queries: [{ qid: "q", goldSkillId: "s0", goldName: "n0", taskText: "t", taskSource: "gold_description", validated: true }] };

const setup = () => {
  const dir = mkdtempSync("/tmp/grid-");
  writeFileSync(`${dir}/b.jsonl`, JSON.stringify(rec) + "\n");
  writeFileSync(`${dir}/prereg.json`, JSON.stringify({ primary: "top1", channel: "description", treatment: "telegraphic", ratio: 2, frozen: true }));
  return dir;
};
const sel = new FakeSelector({ s0: '{"selected":[0],"abstain":false}' });

describe("grid", () => {
  it("requires prereg", async () => {
    const dir = setup();
    await expect(runGrid({ benchPath: `${dir}/b.jsonl`, outPath: `${dir}/o.jsonl`, selectors: [sel],
      treatments: ["control"], channels: ["control"], preregPath: `${dir}/nope.json`, maxUsd: 1 })).rejects.toBeInstanceOf(PreregMissing);
  });
  it("writes one row per cell and refuses unknown treatments", async () => {
    const dir = setup();
    const out = `${dir}/o.jsonl`;
    const s = await runGrid({ benchPath: `${dir}/b.jsonl`, outPath: out, selectors: [sel],
      treatments: ["control", "telegraphic"], channels: ["control", "description"], preregPath: `${dir}/prereg.json`, maxUsd: 1 });
    expect(s.rows).toBe(4);
    await expect(runGrid({ benchPath: `${dir}/b.jsonl`, outPath: `${dir}/x.jsonl`, selectors: [sel],
      treatments: ["typo"], channels: ["control"], preregPath: `${dir}/prereg.json`, maxUsd: 1 })).rejects.toThrow(/typo/);
  });
  it("resumes without duplicating", async () => {
    const dir = setup(); const out = `${dir}/o.jsonl`;
    const args = { benchPath: `${dir}/b.jsonl`, outPath: out, selectors: [sel], treatments: ["control"] as const,
      channels: ["control"] as const, preregPath: `${dir}/prereg.json`, maxUsd: 1 };
    await runGrid({ ...args, treatments: [...args.treatments], channels: [...args.channels] });
    await runGrid({ ...args, treatments: [...args.treatments], channels: [...args.channels] });
    expect(readFileSync(out, "utf8").trim().split("\n").length).toBe(1);
  });
  it("raises on the cost cap", async () => {
    const dir = setup();
    const expensive = new FakeSelector({ s0: '{"selected":[0],"abstain":false}' }, 1_000_000);
    await expect(runGrid({ benchPath: `${dir}/b.jsonl`, outPath: `${dir}/o.jsonl`, selectors: [expensive],
      treatments: ["control"], channels: ["control"], preregPath: `${dir}/prereg.json`, maxUsd: 0.01 })).rejects.toBeInstanceOf(CostExceeded);
  });
  it("registers exactly the five treatments", () => {
    expect(Object.keys(TREATMENTS).sort()).toEqual(["control", "lossy-2x", "lossy-4x", "structure", "telegraphic"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** `lossy.ts` exports `makeLossy(ratio: number, llm: (p: string) => Promise<string>)` returning a compressor with a pinned prompt (target words = tokens/ratio/0.75) and a fixed fallback that returns the input unchanged if the reply is empty. `runGrid` validates prereg (`frozen === true`), resolves each treatment through `TREATMENTS` (unknown name throws with the name), resumes from existing `(qid,treatment,channel,model,seed)` keys, renders, selects, records `correct` from `selected[0]` against the gold index, and accumulates cost from a pinned price table, throwing `CostExceeded` before a call would cross `maxUsd`.

- [ ] **Step 4: Run tests to verify they pass** — 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/experiment/select.ts src/experiment/grid.ts src/compress/lossy.ts prereg/primary-outcome.json tests/grid.test.ts
git commit -m "feat: grid runner with prereg guard, five treatments and cost cap"
```

---

### Task 12: Metrics and cluster-robust analysis

**Files:**
- Create: `src/experiment/analysis.ts`
- Test: `tests/analysis.test.ts`

**Interfaces:**
- Produces: `top1Accuracy(rows): number`; `falseActivationRate(rows): number`; `ece(rows, bins?): number`; `mcnemarExact(b: number, c: number): { p: number; n: number }`; `riskDifferenceCi(aSuccess, aN, bSuccess, bN, alpha?): { rd: number; lo: number; hi: number }`; `fitLogitClustered(rows, opts: { outcome: string; predictors: string[]; cluster: string }): { params: Record<string, number>; se: Record<string, number>; z: Record<string, number>; nObs: number; nClusters: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { top1Accuracy, falseActivationRate, ece, mcnemarExact, riskDifferenceCi, fitLogitClustered } from "../src/experiment/analysis.ts";

describe("analysis", () => {
  it("computes accuracy and false activation", () => {
    const rows = [{ correct: true, abstain: false, confidence: 1, isNegative: false, repo: "r" },
                  { correct: false, abstain: false, confidence: 1, isNegative: true, repo: "r" }];
    expect(top1Accuracy(rows)).toBe(0.5);
    expect(falseActivationRate(rows)).toBe(1);
  });
  it("computes ECE", () => {
    expect(ece([{ correct: true, confidence: 1 }, { correct: false, confidence: 1 }])).toBeGreaterThan(0.4);
  });
  it("matches the exact McNemar p", () => {
    expect(mcnemarExact(10, 0).p).toBeCloseTo(0.001953125, 6);
    expect(mcnemarExact(0, 0).p).toBe(1);
  });
  it("brackets the risk difference", () => {
    const r = riskDifferenceCi(20, 100, 30, 100);
    expect(r.rd).toBeCloseTo(-0.1, 9);
    expect(r.lo).toBeLessThan(r.rd);
    expect(r.hi).toBeGreaterThan(r.rd);
  });
  it("recovers a planted treatment effect with clustered SEs", () => {
    let s = 17; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const rows: any[] = [];
    for (let task = 0; task < 50; task++) for (let rep = 0; rep < 12; rep++) {
      const tr = rep % 2;
      rows.push({ repo: `r${task % 5}`, treatment: tr ? "t1" : "control", correct: rnd() < 0.35 + 0.25 * tr });
    }
    const fit = fitLogitClustered(rows, { outcome: "correct", predictors: ["treatment"], cluster: "repo" });
    expect(fit.params.treatment).toBeGreaterThan(0.3);
    expect(fit.z.treatment).toBeGreaterThan(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** `mcnemarExact` two-sided exact binomial on `min(b,c)` of `b+c` at 0.5, capped at 1. `riskDifferenceCi` uses the Newcombe hybrid score interval. `fitLogitClustered` does IRLS Newton–Raphson on a design matrix with an intercept, one-hot predictors, and `V = (X'WX)^-1 (Σ_g X_g'W_g r_g r_g' W_g X_g) (X'WX)^-1` with the `G/(G-1)` small-sample factor; it throws `SeparatedDataError` when a coefficient diverges beyond ±20.

- [ ] **Step 4: Run tests to verify they pass** — 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/experiment/analysis.ts tests/analysis.test.ts
git commit -m "feat: metrics, exact McNemar, risk differences and clustered IRLS"
```

---

### Task 13: Requirement retention on real skills (RQ3)

**Files:**
- Create: `src/retention/judge.ts`
- Test: `tests/retention.test.ts`

**Interfaces:**
- Consumes: `compressTelegraphic`, `compressStructure`.
- Produces: `extractRequirements(body: string): string[]`; `judgeRetention(p: { requirements: string[]; compressed: string; llm: (prompt: string) => Promise<string> }): Promise<{ kept: number; total: number }>`; `constraintLineRetention(original: string, compressed: string): { kept: number; total: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { extractRequirements, judgeRetention, constraintLineRetention } from "../src/retention/judge.ts";

const BODY = "# Setup\nInstall the CLI first.\n- You must never commit secrets.\n- Run `npm ci` before tests.\nRemember to update the changelog.\n";

describe("retention", () => {
  it("extracts constraint and command lines only", () => {
    const r = extractRequirements(BODY);
    expect(r).toContain("- You must never commit secrets.");
    expect(r).toContain("- Run `npm ci` before tests.");
    expect(r.some((x) => x.includes("changelog"))).toBe(false);
  });
  it("counts constraint lines that survive compression", () => {
    const r = constraintLineRetention(BODY, BODY.replace("Install the CLI first.\n", ""));
    expect(r.total).toBe(2);
    expect(r.kept).toBe(2);
  });
  it("asks the judge once per requirement", async () => {
    let calls = 0;
    const r = await judgeRetention({ requirements: ["a", "b"], compressed: "x", llm: async () => { calls++; return "YES"; } });
    expect(calls).toBe(2);
    expect(r).toEqual({ kept: 2, total: 2 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** `extractRequirements` keeps lines matching the constraint/command pattern, trimmed and deduplicated in order. `constraintLineRetention` matches by identifier recall: a line is kept when every backticked/identifier token in it appears in the compressed text and the line's first four content words appear contiguously. `judgeRetention` sends one pinned prompt per requirement and counts `YES` replies; an unparsable reply counts as not kept and is logged.

- [ ] **Step 4: Run tests to verify they pass** — 3 passed.

- [ ] **Step 5: Run the retention pass on 120 real skills**

Run: `CHAT2DB_DATASOURCE_ID=… node scripts/retention.ts --limit 120 --out analysis/retention_v1.jsonl`
Expected: 120 records, each with `repo`, `path`, per-treatment `{kept,total}` and the achieved ratio; no synthetic text.

- [ ] **Step 6: Commit**

```bash
git add src/retention/judge.ts tests/retention.test.ts scripts/retention.ts
git commit -m "feat: requirement retention judged on real skills"
```

---

### Task 14: Router Compression Safety and sampled exposure

**Files:**
- Create: `src/rcs/score.ts`, `src/rcs/population.ts`
- Test: `tests/rcs.test.ts`

**Interfaces:**
- Consumes: `compressTelegraphic`, `tokenCount`, `SQL`.
- Produces: `rcsFeatures(skill: Candidate, compress?: (t: string) => string): { identifierRecall: number; triggerRecall: number; descBodyOverlap: number; constraintDensity: number; rcs: number }`; `sampleSkills(runner, p: { stride: number; limit: number }): Promise<Candidate[]>`; `scoreSample(skills: Candidate[], p: { compressorVersion: string }): RcsRow[]` writing no files itself.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { rcsFeatures, scoreSample } from "../src/rcs/score.ts";

const skill = { skillId: "a/1", name: "pdf-forms", description: 'Fill PDF forms. Triggers on "fill pdf".',
  body: "# Steps\nRun `pdftk in.pdf fill_form out.pdf` and never skip validation.", bodyChars: 70 };

describe("rcs", () => {
  it("has the five keys and is bounded", () => {
    const f = rcsFeatures(skill);
    expect(Object.keys(f).sort()).toEqual(["constraintDensity", "descBodyOverlap", "identifierRecall", "rcs", "triggerRecall"]);
    expect(f.rcs).toBeGreaterThanOrEqual(0);
    expect(f.rcs).toBeLessThanOrEqual(1);
  });
  it("gives full recall with no identifiers to lose", () => {
    expect(rcsFeatures({ ...skill, description: "Do the thing." }).identifierRecall).toBe(1);
  });
  it("gives zero recall when everything is dropped", () => {
    const f = rcsFeatures(skill, () => "x");
    expect(f.identifierRecall).toBe(0);
    expect(f.triggerRecall).toBe(0);
  });
  it("stamps the compressor version on every row", () => {
    const rows = scoreSample([skill], { compressorVersion: "t1-1.0" });
    expect(rows[0].compressorVersion).toBe("t1-1.0");
    expect(rows[0].sampleWeight).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** Identifiers are backticked spans, paths, dotted filenames, ALL-CAPS tokens and snake_case tokens; `identifierRecall` is the fraction still present after compressing the **description**; `triggerRecall` uses the description's quoted phrases; `descBodyOverlap` is the fraction of description content words in the body; `constraintDensity` is the share of body lines matching the constraint pattern; `rcs` is the unweighted mean. `sampleSkills` runs `SQL.sampleByRowidModulo` and pages explicitly, asserting `hasNextPage` is false at the end; `scoreSample` attaches `sampleWeight` from the stride.

- [ ] **Step 4: Run tests to verify they pass** — 4 passed.

- [ ] **Step 5: Run the sample once**

Run: `CHAT2DB_DATASOURCE_ID=… node scripts/rcs-sample.ts --stride 947 --out analysis/rcs_sample.csv`
Expected: ~4 000 rows with a `copy_count` join, and a printed weighted estimate with a 95% CI. Report the row count and the CI in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src/rcs/score.ts src/rcs/population.ts tests/rcs.test.ts scripts/rcs-sample.ts analysis/rcs_sample.csv
git commit -m "feat: RCS features and weighted population exposure"
```

---

### Task 15: Deposit bundle and paper skeleton

**Files:**
- Create: `scripts/make-artifact.ts`, `paper/main.tex`, `REPRODUCE.md`
- Test: `tests/artifact.test.ts`

**Interfaces:**
- Produces: `buildBundle(p: { root: string; out: string; include: string[]; exclude: string[] }): { out: string; nFiles: number; manifestPath: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { buildBundle } from "../scripts/make-artifact.ts";

describe("artifact", () => {
  it("excludes databases and includes derived data", () => {
    const root = mkdtempSync("/tmp/art-");
    mkdirSync(`${root}/analysis`, { recursive: true });
    writeFileSync(`${root}/analysis/meta.db`, "x");
    writeFileSync(`${root}/analysis/bench_v1.jsonl`, "{}\n");
    const out = `${root}/bundle`;
    const r = buildBundle({ root, out, include: ["analysis"], exclude: ["*.db", ".mcp.json"] });
    expect(existsSync(`${out}/analysis/bench_v1.jsonl`)).toBe(true);
    expect(existsSync(`${out}/analysis/meta.db`)).toBe(false);
    expect(r.nFiles).toBe(1);
  });
  it("writes a sorted manifest", () => {
    const root = mkdtempSync("/tmp/art-");
    mkdirSync(`${root}/a`); writeFileSync(`${root}/a/f.txt`, "hi");
    const r = buildBundle({ root, out: `${root}/b`, include: ["a"], exclude: [] });
    expect(r.manifestPath.endsWith("MANIFEST.sha256")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL.

- [ ] **Step 3: Implement** Recursive copy honouring `include`/`exclude` globs, always excluding `*.db`, `*.db-wal`, `*.db-shm`, `.git`, `node_modules`, `.mcp.json`, and files over 5 MB not explicitly included; write `MANIFEST.sha256` sorted by path. `paper/main.tex` is IEEEtran `conference` with the six headings from spec §10, a `table*` stub for motivation numbers and a `figure` placeholder for the channel × treatment plot. `REPRODUCE.md` lists the commands in task order with expected runtimes and the observed row counts.

- [ ] **Step 4: Run tests to verify they pass** — 2 passed; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/make-artifact.ts paper/main.tex REPRODUCE.md tests/artifact.test.ts
git commit -m "feat: deposit bundle builder and IEEEtran skeleton"
```

---

## Self-Review

**Spec coverage.** §8.1 RQ1→Tasks 2–5, RQ2→Tasks 10–11, RQ3→Task 13, RQ4→Task 14; §8.2 T0/T1/T2→Tasks 3–4 + Task 11 registry, T3→Task 11 `lossy.ts`, T4→`extraSkill` in Task 10; §8.3 benchmark→Tasks 5–9; §8.4 protocol→Task 10; §8.5 retention→Task 13; §8.6 models/metrics→Tasks 11–12; §8.7 population→Task 14; §10 artifact→Task 15. Gaps found and closed: the spec's SQL-backed sampling had no owner, so Task 5 owns `SQL.repoFrame`/`sampleByRowidModulo` and the page-loss guard; the dev split had no owner, so Task 6 splits it out and Task 7 never sees dev repos.

**Type consistency.** `Candidate` (Task 6) is the single skill shape used by Task 7, 8, 10, 13, 14. `SqlResult` (Task 1) is the only DB shape; nothing downstream touches raw text envelopes. Benchmark records use `taskText`/`goldSkillId`; grid rows use `qid/treatment/channel/model/seed/correct`. Treatment keys are exactly the five in `TREATMENTS`; T4 is `extraSkill`, never a sixth key.

**Proportion.** Fifteen tasks, each one test cycle and one commit. Test literals are short; nothing carries an implementation body the tests already determine except the statistics and the parser, which are genuinely non-obvious algorithms.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-13-skillmd-compression.md`.

**Recommended: Native** — the fifteen tasks share one evolving contract (`Candidate`, `SqlResult`, `qid`), and cross-task drift is the main risk a single implementer avoids. A fresh reviewer checks the branch at the end.
