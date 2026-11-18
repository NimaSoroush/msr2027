/**
 * Task 13 Step 1: the pilot grid, exercised offline.
 *
 * `--dry-run` runs the 15 pilot PRs through all five H1 conditions with a **scripted model**, so the
 * plan, the material layer, the recorder and the outcome extraction are tested as a whole without
 * a single paid call. It asserts what the plan asks for — every planned replay id is either recorded
 * or excluded with a reason — and writes `analysis/pilot_dryrun.json` as the evidence.
 *
 * There is no live mode. The study model (DeepSeek V4.1 Flash) is not reachable from this project:
 * the only subscription here is Freebuff's interactive CLI, which is an agent, not a per-turn JSON
 * model with token accounting. A live path that stubbed the model would produce a full grid whose
 * treatment arm is not the treatment the paper describes, so the script refuses instead of guessing.
 *
 * Run: node scripts/pilot.ts --dry-run [--limit N] [--pr owner/repo#123]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openRelease } from "../src/db/sqlite.ts";
import { loadSkills, splitSkill, type Skill } from "../src/material/skills.ts";
import { GitHubClient, type PrMeta } from "../src/material/github.ts";
import { H1_CONDITIONS, materialise, type Condition } from "../src/material/workdir.ts";
import { cavemanCompressor, destructiveCompressor, identityCompressor } from "../src/compress/index.ts";
import type { Compressor } from "../src/compress/caveman.ts";
import { buildCatalog, renderTaskPrompt } from "../src/replay/harness.ts";
import { runReplay } from "../src/replay/agent.ts";
import { Recorder } from "../src/replay/transcript.ts";
import { planReplays, type ReplayPlan } from "../src/replay/plan.ts";
import { buildGold, extractOutcomes, type Gold, type Outcome } from "../src/analysis/outcomes.ts";
import { bodyPathLabels } from "../src/analysis/labels.ts";
import type { ModelClient } from "../src/replay/types.ts";
import type { SampledPr } from "../src/prs/sample.ts";
import type { PrFileRow } from "../src/prs/specmine.ts";

const SAMPLE = "data/prs_v1/sample.jsonl";
const SPECMINE = "specmine-zenodo/specmine.sqlite";
const OUT = "analysis/pilot_dryrun.json";
const JSONL = "analysis/pilot_dryrun.jsonl";

type Args = { dryRun: boolean; limit?: number; pr?: string; maxTurns: number; root: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, maxTurns: 25, root: "/tmp/msr2027-pilot" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--limit") args.limit = Number(argv[++i]);
    else if (flag === "--pr") args.pr = argv[++i];
    else if (flag === "--max-turns") args.maxTurns = Number(argv[++i]);
    else if (flag === "--root") args.root = argv[++i];
    else throw new Error(`unknown argument: ${flag}`);
  }
  return args;
}

const median = (xs: number[]): number => {
  if (!xs.length) return 1;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * The scripted model. It plays a deliberate arc — load the needed skill, read every file the gold
 * set names (until the turn budget runs out), then finish — so the recorder sees every tool kind and
 * the extractor has something to score. Its token counts are zero, because no model was called: a
 * dry run must not be able to produce a cost number.
 */
function scriptedModel(gold: Gold): ModelClient {
  const paths = gold.requiredCalls.filter((c) => c.name === "read_file").map((c) => c.target);
  let turn = 0;
  return {
    async call() {
      const at = turn++;
      if (at === 0) {
        return {
          text: JSON.stringify({
            tool: "load_skill",
            args: { name: gold.neededSkillName ?? gold.neededSkillId },
          }),
          tokensIn: 0,
          tokensOut: 0,
        };
      }
      if (at <= paths.length) {
        return {
          text: JSON.stringify({ tool: "read_file", args: { path: paths[at - 1] } }),
          tokensIn: 0,
          tokensOut: 0,
        };
      }
      return {
        text: JSON.stringify({
          final: `Read the needed skill and ${Math.min(paths.length, at - 1)} of ${paths.length} changed files.`,
        }),
        tokensIn: 0,
        tokensOut: 0,
      };
    },
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.dryRun) {
  console.error(
    "No live mode: the study model is not reachable from this project (see the header). " +
      "Run with --dry-run to exercise the grid.",
  );
  process.exit(2);
}

process.loadEnvFile(".env");
const token = process.env.GITHUB_TOKEN?.trim();
if (!token) {
  console.error("GITHUB_TOKEN missing from .env; the dry run needs PR text for the task prompt");
  process.exit(2);
}

const bin = process.env.CAVEMAN_BIN ?? "/tmp/caveman-engine";
if (!existsSync(bin)) {
  console.error(`no Caveman Engine binary at ${bin}; export CAVEMAN_BIN (the dry run still materialises)`);
  process.exit(2);
}

const sample = readFileSync(SAMPLE, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as SampledPr);

let pilots = sample.filter((s) => s.role === "pilot");
if (args.pr) {
  const [repo, n] = args.pr.split("#");
  pilots = pilots.filter((p) => p.repo === repo && p.prNumber === Number(n));
}
if (args.limit) pilots = pilots.slice(0, args.limit);

const plan = planReplays({ sample: pilots });
const plannedIds = plan.map((r) => r.replayId);
const duplicates = plannedIds.filter((id, i) => plannedIds.indexOf(id) !== i);

const release = openRelease();
const specmine = new DatabaseSync(SPECMINE, { readOnly: true });
const gh = new GitHubClient({ token });

const skillsFor = new Map<string, Skill[]>();
for (const repo of new Set(pilots.map((p) => p.repo))) {
  skillsFor.set(repo, await loadSkills(release, repo, { allowUndescribed: true }));
}

const filesFor = (pr: SampledPr): PrFileRow[] =>
  (
    specmine
      .prepare("select file_path, change_status, is_code from pr_files where repo_name = ? and pr_number = ?")
      .all(pr.repo, pr.prNumber) as { file_path: string; change_status: string; is_code: number }[]
  ).map((r) => ({
    repo: pr.repo,
    prNumber: pr.prNumber,
    filePath: r.file_path,
    changeStatus: r.change_status,
    isCode: r.is_code === 1,
  }));

/**
 * Gold for the pilot. The pilot has no judge labels — the judge scored the 200 analysis PRs — so the
 * needed skill here comes from the body-path rule, and is a fixture for exercising the extractor
 * rather than a label. Pilot outcomes are never reported as a study result (Task 13 Step 4).
 */
function pilotGold(pr: SampledPr, skills: Skill[], files: PrFileRow[]): Gold | null {
  if (!skills.length) return null;
  const bodyHits = bodyPathLabels({ pr, files, skills });
  const needed = skills.find((s) => s.skillId === bodyHits[0]) ?? [...skills].sort((a, b) => a.path.localeCompare(b.path))[0];
  return buildGold({ pr, files, neededSkillId: needed.skillId, neededSkillName: needed.name });
}

const metaFor = new Map<string, PrMeta>();
const textFailures = new Map<string, string>();
for (const pr of pilots) {
  const id = `${pr.repo}#${pr.prNumber}`;
  try {
    metaFor.set(id, await gh.pr(pr.repo, pr.prNumber));
  } catch (error) {
    textFailures.set(id, (error as Error).message);
  }
}

// The pin must match the bytes actually used. When no independent sha256 is supplied the digest is
// computed from the binary and recorded, so the summary says which build produced the ratios
// instead of implying a pin nobody checked.
const binSha = createHash("sha256").update(readFileSync(bin)).digest("hex");
const pinnedSha = process.env.CAVEMAN_SHA256?.trim() || binSha;
const caveman = cavemanCompressor({
  bin,
  mode: "spawn",
  pin: { tag: process.env.CAVEMAN_TAG ?? "v4.1.0", sha256: pinnedSha },
});
const compressors: Record<Condition, Compressor> = {
  C0: identityCompressor(),
  C0b: caveman,
  C1: caveman,
  C2: caveman,
  C3: caveman,
  C4: destructiveCompressor(),
};

// The recorder is append-only by design; the dry run starts from an empty file so a rerun's ids
// cannot be satisfied by the previous run's lines.
rmSync(JSONL, { force: true });
const recorder = new Recorder(JSONL);
const outcomes: Outcome[] = [];
const exclusions: { replayId: string; reason: string }[] = [];
const ratioByCondition = new Map<Condition, number[]>();
const invariantChecks: { prId: string; materialised: Condition[]; identical: boolean }[] = [];
const terminationCounts: Record<string, number> = {};

for (const pr of pilots) {
  const prId = `${pr.repo}#${pr.prNumber}`;
  const files = filesFor(pr);
  const skills = skillsFor.get(pr.repo) ?? [];
  const gold = pilotGold(pr, skills, files);
  const meta = metaFor.get(prId);

  if (!gold) {
    for (const r of plan.filter((x) => x.repo === pr.repo && x.prNumber === pr.prNumber)) {
      exclusions.push({ replayId: r.replayId, reason: "repo has no skill text in the release" });
    }
    continue;
  }
  if (!meta) {
    for (const r of plan.filter((x) => x.repo === pr.repo && x.prNumber === pr.prNumber)) {
      exclusions.push({ replayId: r.replayId, reason: `PR text unavailable: ${textFailures.get(prId) ?? "unknown"}` });
    }
    continue;
  }

  const localHashes = new Map<Condition, Record<string, string>>();

  for (const replay of plan.filter((r) => r.repo === pr.repo && r.prNumber === pr.prNumber)) {
    const dir = join(args.root, replay.replayId.replace(/[^A-Za-z0-9._-]/g, "_"));
    let materialised;
    try {
      // No tarball: the dry run has no network-free way to fetch 15 base trees, so the tree is the
      // gold paths as stubs. Material-level facts (skills, ratios, hashes) are real; the tree is not.
      materialised = await materialise({
        dir,
        tarball: "",
        skills,
        condition: replay.condition,
        compress: compressors[replay.condition],
      });
    } catch (error) {
      exclusions.push({ replayId: replay.replayId, reason: (error as Error).message });
      continue;
    }

    for (const call of gold.requiredCalls) {
      if (call.name !== "read_file") continue;
      const dest = join(dir, call.target);
      if (existsSync(dest)) continue;
      mkdirSync(join(dest, ".."), { recursive: true });
      writeFileSync(dest, `// dry-run stub for ${call.target}\n`);
    }

    localHashes.set(replay.condition, materialised.hashes as unknown as Record<string, string>);
    const bucket = ratioByCondition.get(replay.condition) ?? [];
    bucket.push(...Object.values(materialised.ratios));
    ratioByCondition.set(replay.condition, bucket);

    // The catalog is rebuilt from the materialised files, so H2 would show compressed bodies; H1
    // intentionally shows only names and descriptions and is therefore identical across conditions.
    const onDisk: Skill[] = skills.map((skill) => {
      const split = splitSkill(readFileSync(join(dir, skill.path), "utf8"));
      return { ...skill, frontmatter: split.frontmatter, body: split.body };
    });
    const catalog = buildCatalog({ harness: replay.harness, skills: onDisk, condition: replay.condition });

    const transcript = await runReplay({
      pr,
      condition: replay.condition,
      harness: replay.harness,
      model: scriptedModel(gold),
      root: dir,
      recorder,
      budgets: { maxTurns: args.maxTurns, maxTokens: 200_000 },
      catalog,
      task: renderTaskPrompt({ prTitle: meta.title, prBody: meta.body, catalogText: catalog.render() }),
    });
    transcript.ratios = materialised.ratios;

    terminationCounts[transcript.termination] = (terminationCounts[transcript.termination] ?? 0) + 1;
    outcomes.push(extractOutcomes(transcript, gold));
  }

  if (localHashes.size >= 2) {
    const [first, ...rest] = [...localHashes.values()];
    const identical = rest.every((h) => Object.keys(first).every((k) => h[k] === first[k]));
    invariantChecks.push({ prId, materialised: [...localHashes.keys()], identical });
  }
  console.log(`${prId}: ${plan.filter((r) => r.repo === pr.repo && r.prNumber === pr.prNumber).length} arms planned`);
}

const completedIds = outcomes.map((o) => o.replayId);
const excludedIds = new Set(exclusions.map((e) => e.replayId));
const unknownOutcomes = completedIds.filter((id) => !plannedIds.includes(id));
const unaccounted = plannedIds.filter((id) => !completedIds.includes(id) && !excludedIds.has(id));
const recordedIds = new Set(
  readFileSync(JSONL, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { replayId: string }).replayId),
);
const missingFromJsonl = plannedIds.filter((id) => !recordedIds.has(id) && !excludedIds.has(id));

const summary = {
  generated: new Date().toISOString(),
  mode: "dry-run",
  scriptedModel: true,
  tokens: null as null | { note: string },
  planned: plannedIds.length,
  completed: completedIds.length,
  excluded: exclusions.length,
  exclusions,
  duplicates,
  unknownOutcomes,
  unaccounted,
  missingFromJsonl,
  terminationCounts,
  grid: Object.fromEntries(H1_CONDITIONS.map((c) => [c, completedIds.filter((id) => id.includes(`:${c}:`)).length])),
  materialRatios: Object.fromEntries(
    [...ratioByCondition.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([condition, ratios]) => {
        const sorted = [...ratios].sort((a, b) => a - b);
        const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 1;
        return [
          condition,
          {
            surfaces: ratios.length,
            median: Number(median(ratios).toFixed(4)),
            mean: Number((ratios.reduce((s, r) => s + r, 0) / Math.max(1, ratios.length)).toFixed(4)),
            p10: Number(at(0.1).toFixed(4)),
            p90: Number(at(0.9).toFixed(4)),
            min: Number((sorted[0] ?? 1).toFixed(4)),
            untouched: ratios.filter((r) => r === 1).length,
            belowOne: ratios.filter((r) => r < 1).length,
            aboveOne: ratios.filter((r) => r > 1).length,
          },
        ];
      }),
  ),
  invariantHashes: {
    prs: invariantChecks.length,
    identical: invariantChecks.filter((c) => c.identical).length,
    disagreements: invariantChecks.filter((c) => !c.identical),
  },
  recall: {
    mean: outcomes.length ? outcomes.reduce((s, o) => s + o.recall, 0) / outcomes.length : null,
    note: "scripted model; not a study outcome",
  },
  compressor: {
    id: caveman.id,
    tag: process.env.CAVEMAN_TAG ?? "v4.1.0",
    sha256: pinnedSha,
    sha256Source: process.env.CAVEMAN_SHA256?.trim() ? "supplied" : "computed from the binary",
  },
  baseTree: "stub files for the gold paths; skills from the release; no GitHub tarball",
  note: "Pilot data are not used for hypothesis testing (Task 13 Step 4). This file proves the grid runs.",
};
summary.tokens = { note: "no model was called; token and cost fields are zero by construction" };

mkdirSync("analysis", { recursive: true });
writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);

console.log(
  `planned ${summary.planned}, completed ${summary.completed}, excluded ${summary.excluded}; ` +
    `duplicates ${duplicates.length}, unaccounted ${unaccounted.length}, unknown ${unknownOutcomes.length}`,
);
console.log(`terminations ${JSON.stringify(terminationCounts)}`);
for (const [condition, r] of Object.entries(summary.materialRatios)) {
  console.log(`${condition}: ${r.surfaces} surfaces, median ${r.median}, untouched ${r.untouched}`);
}
console.log(`invariant hashes identical in ${summary.invariantHashes.identical}/${summary.invariantHashes.prs} PRs`);

const failed =
  duplicates.length > 0 ||
  unknownOutcomes.length > 0 ||
  unaccounted.length > 0 ||
  missingFromJsonl.length > 0 ||
  summary.invariantHashes.disagreements.length > 0;
if (failed) process.exit(1);
