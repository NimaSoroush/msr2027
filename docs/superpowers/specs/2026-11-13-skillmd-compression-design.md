# Compressed Instructions, Intact Descriptions — Project Spec (MSR 2027 Registered Reports)

**Status:** **approved 2026-11-14** · **Revision:** 7 (rev. 4 pinned the model; rev. 5 settled the compressor, the USD ceiling, the label provenance and the replay count; rev. 6 moved skill-database access to a read-only SQLite reader, §13.11, and pinned the text-bearing count, §13.12; rev. 7 restricts the sampling frame to code-changing PRs, §8.3 and §13.14) · **Date:** 2026-11-13
**Track:** MSR 2027 **Registered Reports**, Stage 1 (EMSE, in conjunction with MSR)
**Study type:** **Confirmatory — equivalence test** (see §8.1; the abstract's "Exploratory" label is a miscategorisation, §12)
**Implementation plan:** `docs/superpowers/plans/2026-11-14-activation-study.md` (18 tasks, Task 1b included; Stage 1 = Tasks 1–13).

**Source of truth for the study design:** `abstract.md` (project root).

---

## 1. Intent and the why

Context-compression tools are adopted to cut agent cost. Caveman's `/caveman-compress` rewrites skill
bodies and memory files into telegraphic prose while preserving code, identifiers and YAML frontmatter,
reporting roughly a third off input tokens. Compression of *agent control contexts* is known to become
unreliable at aggressive ratios, but that evidence comes from constructed control contexts compressed
to 35–50% of their tokens, not from real repositories at the ratios shipping tools actually achieve.
Whether compression changes what agents **invoke** remains unmeasured.

The gap is sharpened by where caveman sits. CompressAgent reports 92.7% success at 75% retained
context against a 93.8% baseline, then divergence between methods by 50% and collapse by 35%
(19.9% for generic rewriting). A ~33% token cut leaves **~67% retained** — inside the region the prior
work calls "close to baseline" but below the ratios it actually certified. So the honest question is
not "does compression hurt agents" but **"is activation preserved at the ratio real tools use?"** —
an equivalence question with a margin, not a "does it work" question.

Skills make this measurable in a way generic prompts do not: they have a **description** the agent
routes on and a **body** it then follows, so the body channel can be compressed while the router stays
byte-identical. That invariance is the study's outcome-neutral anchor: any change in activation cannot
be blamed on a corrupted description.

**One sentence:** replay real merged pull requests as agent tasks, with and without `/caveman-compress`
applied to skill bodies and memory files, and test — within each pull request — whether skill
activation and tool invocation stay within a pre-specified equivalence margin.

## 2. Success criteria

1. **In-Principle Acceptance (IPA)** at MSR 2027 Registered Reports Stage 1 (Feb 2027).
2. A **Stage 2 full paper at EMSE** (due 30 Sep 2027) that follows the accepted protocol, with all
   deviations documented in their own section.
3. **Actionable for tool builders**: a measured statement of what compression may touch and what it may
   not, at the ratio such tools use, with the activation cost and the token saving on the same page.

Note: RR reports are **not published in the MSR proceedings**; accepted reports are presented at MSR.

## 3. Goals

- G1: A replay harness that executes a real merged PR as an agent task and records, with provenance,
  every skill activation and tool invocation.
- G2: An equivalence test of tool-call recall under body compression (primary), with a pre-specified
  margin, under two routing harnesses.
- G3: An equivalence test of routing/activation under memory-file compression when several skills
  compete.
- G4: A **positive control** that proves the pipeline can detect activation loss at all — RR reviewers
  require outcome-neutral tests, not just a null result.
- G5: A Stage 1 artifact: harness, pilot, power analysis, prompts, model versions, analysis code.

## 4. Non-goals

- Not a benchmark of compression algorithms; the intervention is `/caveman-compress`, with one
  reference comparison so the result is not a single-vendor claim.
- Not a code-correctness study. Whether the agent's patch passes the PR's tests is exploratory only.
- Not a security analysis of skill payloads.
- Not a claim about ratios outside the measured band (≈65–70% retained). Extrapolation to 35% is
  explicitly out of scope.

## 5. Anti-goals

- Running each condition once: without a baseline replicate the noise floor is unknown, and a null is
  indistinguishable from a broken pipeline.
- No positive control: an equivalence claim with no demonstrated sensitivity is unfalsifiable.
- A revised margin, sample or outcome after seeing results — the RR protocol forbids it, and deviations
  must be documented.
- Reporting token savings without activation cost, or activation cost without savings.
- Any synthetic skill or invented task standing in for a real PR.
- Claiming equivalence tighter than the margin actually powered.

## 6. Constraints (from the MSR 2027 RR call)

| Constraint | Value |
|---|---|
| Page limit | **6 pages + 1 page of references**, strict; IEEE 10pt conference (`\documentclass[10pt,conference]{IEEEtran}`) |
| Format | PDF via HotCRP `msr2027-registered-reports.hotcrp.com`; spacing/font deviations risk desk rejection |
| Anonymity | Author Guide asks for Authors at this stage and states single-anonymous review — **not** double-blind (§13.6) |
| Structured abstract | ~200 words, Background / Objective / Method |
| Required sections | Title, Authors, Abstract, Introduction, Hypotheses (confirmatory), Variables with operationalisation, Datasets & sample, Execution Plan |
| Review | 4 PC members; criteria include feasibility, power analysis, replication detail, and **pre-specified outcome-neutral tests** (positive controls, quality checks) |
| Outcomes | In-Principle Acceptance / Continuity Acceptance / Rejection |
| Power convention | TOST, two one-sided tests at α = 0.05 (a 90% CI inside ±Δ), 80% target; n = (z₀.₉₅ + z₀.₉₀)²·p_disc/Δ² |
| Dates (AoE) | abstract **13 Nov 2026** · initial report **20 Nov 2026** · reviews 23 Dec · response + revised report (≤12 pp + 1 ref) 15 Jan 2027 · Stage 1 notification **4 Feb 2027** · preprint with DOI by 28 Feb · full paper to EMSE by **30 Sep 2027** |
| Datasets | GitSkills v1.0 (July 2026, DOI 10.5281/zenodo.21875637) for skills; SpecMine v1.0 (July 2026, DOI 10.5281/zenodo.22102779) for the merged-PR layer |
| Language | TypeScript on Node 24; `vitest` |
| Skill metadata access | Read-only SQLite on the release file (`node:sqlite`, `readOnly` + `PRAGMA query_only`); Chat2DB MCP retained only as a count oracle (amendment 2026-11-16, §13.12) |
| PR access | SpecMine `pull_requests.csv.gz` + `pr_files.csv.gz`; repository material via GitHub REST (BYOD, allowed) |
| Deviations | must be documented in a dedicated Stage 2 section |

### 6.1 Verified feasibility

| Quantity | Measured |
|---|---|
| SpecMine merged PRs / repos | 5,992 / 581 |
| SpecMine PR repos also carrying GitSkills skills | **306** |
| merged PRs in those repos | **4,486** (3,579 touch code) |
| repos with ≥2 skills ("several compete") | **223**, holding **3,566** merged PRs; the sampling frame is the **2,338** that change code and do not add or edit a `SKILL.md`, in 208 of those repos |
| skills per repo there | median 4, p90 24, max 293 |
| GitSkills corpus | 3,797,117 occurrences; **1,880,329 text-bearing** (`content IS NOT NULL`), of which **1,880,327 non-blank**; 1,877,981 distinct. The old 1,880,348 counted `content_fetched = 1`, a fetch flag: 19 of those rows hold no content and no parsed frontmatter (e.g. `kasuboski/pig:test_data/skills/empty-skill/SKILL.md`), so it is a pipeline status, not a text count (§13.12) |
| Chat2DB MCP (oracle only) | Prose transport rewrites text: newlines arrive as literal `\n` (187 of 200 characters differ on a real skill body) and `NULL` renders like the string `NULL`; also ≤50 rows of text per call whatever `pageSize` says, `rows:` is `min(result, pageSize)`, elision announced by a `... N more rows not shown.` footer. Fit only for cross-checking counts |

## 7. Prior work and positioning (verified against the sources)

| Work | What it establishes | How this study differs |
|---|---|---|
| **CompressAgent** — *Control Under Compression: Reliability Frontiers for Tool-Using Agents*, Hou & Yang, arXiv 2608.01056 (Aug 2026) | Environment-verified benchmark, 9 control contexts, 3 task families, 3 Qwen models, 15,525 runs. At 75% retained context generic rewriting scores 92.7% and section-based 92.4% vs a 93.8% baseline; methods diverge by 50% (37.8% vs 67.9%) and collapse at 35% (19.9%). LLMLingua preserved 0/9 preregistered identifiers at every budget. | Real repositories, third-party skills, session replay; outcome is **activation**, not task success; ratio is the one a shipping tool achieves (~67% retained: between the certified 75% and the divergent 50%). |
| **SkillRouter** — *Skill Routing for LLM Agents at Scale*, arXiv 2603.22455 | Removing the body drops Hit@1 by **31.4–44.0 pp** across sparse, dense and reranked retrievers; the effect survives length control. Bodies carry routing signal. | We do not assume descriptions freeze routing: selection is measured under **both** a description-only and a full-text harness (§8.4). |
| **SkillReducer** — arXiv 2603.29919 (Gao et al.) | 48% description / 39% body compression on 600 skills, +2.8% functional quality, 100% routing preservation among non-obsolete skills with restore machinery; 26.4% of 55,315 skills lack a description, >60% of bodies non-actionable. | SkillReducer compresses *and repairs* (selective restore); caveman compresses without restore, and we measure activation rather than functional quality. |
| **JetBrains caveman evaluation** (reported 2026; not independently verified here) | 86 SkillsBench tasks, 82 paired, forced activation: 8.5% output savings against a 65% claim, quality flat (sign test p = 0.82). | That tested the response skill, not `/caveman-compress`, and did not measure activation. It motivates the equivalence framing and a margin that is not absurdly tight. |

Two corrections this table forces on the abstract's positioning notes:
- SkillRouter's gap is **31.4–44.0 percentage points of Hit@1**, not "31–44% accuracy".
- CompressAgent's 19.9% is specific to **generic rewriting at 35% retained**; section-based methods hold
  47.0% at the same budget. The paper must not imply "all compression collapses at 35%".

## 8. Design

### 8.1 Study type and hypotheses

Classified **confirmatory**: the hypothesis is fixed in advance and the analysis is an equivalence test
with a pre-specified margin. (The abstract's "Exploratory" label conflicts with this; see §12.)

- **H1 (primary, equivalence).** Under the description-only harness, tool-call recall for the needed
  skill with bodies compressed (C1) is equivalent to the uncompressed baseline (C0) within
  **Δ = 10 percentage points**.
- **H2 (equivalence).** With memory files compressed (C2), the activated-skill distribution is
  equivalent to C0 within a total-variation distance of **0.10**, when ≥2 skills compete.
- **H3 (positive control, superiority).** A destructive compression (C4, body reduced to ~30% of
  tokens with no preservation rules) **reduces** tool-call recall relative to C0. If H3 does not hold,
  the pipeline cannot detect activation loss and H1/H2 are reported as inconclusive, not as equivalence.

Rationale for Δ = 10 pp: it is the smallest margin that is both practically meaningful for a cost tool
(losing one tool call in ten is where a proxy should warn rather than stay silent) and affordable at the
available sample (§8.6). A 5 pp margin is explicitly out of scope.

### 8.2 Conditions

| Id | Compressed material | Role |
|---|---|---|
| C0 | none | baseline |
| C0b | none | baseline replicate — **noise floor** |
| C1 | skill bodies | H1 |
| C2 | memory/convention files | H2 |
| C3 | both | deployment case |
| C4 | skill bodies, destructively (~30% retained, no preservation rules) | H3 positive control |

Invariants, hash-checked per replay: every `description` byte-identical; YAML frontmatter identical;
paths and names identical; in C0/C0b/C2 no body byte differs. A replay failing an invariant is
discarded and counted.

**Measured 2026-11-16, before any replay: the compressor returned every skill unchanged.** On 200 skills drawn one
per pool repo, the pinned Engine build (tag v4.1.0) returned the original bytes unchanged for **200 of
200** files — strict byte equality, re-checked outside the harness with `cmp`, zero non-zero exits, zero
contract violations, `tokens_before == tokens_after` on every file. Two gates explain it: files below
1,600 bytes are never attempted (20 of the 200), and above that its heading test (≤8 words, no `.`/`!`/`?`)
keeps every short bullet or command section, after which it emits nothing rather than a file it did not
shrink. The binary does transform other material — a 40-paragraph prose file fell 16.5% by dropping whole
sections, a repeated-row file 87.5% — so "no effect" here is a limit of the material, not a dead binary.

Over that per-repo sample **C1 is byte-identical to C0**. Re-running the probe over **every** pool skill
(3,150, Task 7 Step 5b) corrects the size of the arm: **3,135 (99.5%) come back untouched, 15 are changed,
and 14 of those 15 violate the preservation contract** — code fences 9, list items 6, identifiers 4, inline
code 3, emphasis lines 3 — leaving one clean compression (`drn/dots:agents/skills/cross-agent/SKILL.md`,
0.991). H1's contrast is therefore small but not null, and nearly every instance of the treatment is one
the gate disqualifies. That has a sampling consequence that must be settled before Stage 2: any PR whose
base tree contains one of those 14 skills cannot be materialised under C1 or C3, so dropping such PRs
would bias the grid and replaying them would violate the contract.

The memory half was then probed the same way at default branches (`analysis/memory_probe.json`): 365 files
across 201 of 223 pool repos, 117 below the byte floor, and **247 of the 248 attempted came back
byte-identical**. One did not — `deckgl-fiber-renderer/fiber.gl/AGENTS.md`, 9,845 bytes, 9.4% smaller with 28
lines replaced by 10 elision markers, deleting imperative bullets and bold section intros. The contract as
first written **passed that file with no violations** — a false negative, because its list check compared
the set of first words of items rather than the items, so entries led by a recurring word vanished unseen.
It was tightened (Task 6 Step 5c): full item texts as a multiset, plus emphasis-only lines, and the same
pair now fails with `emphasis line missing: ["Don't assume. Don't hide confusion. Surface tradeoffs.", …]`
and `list item missing: ["State your assumptions explicitly. If uncertain, ask.", …]`. C2 is thus near-null
by frequency but not null by construction, and its one observed action is exactly the failure the contract
exists to catch.

Choosing a different Engine tag, a forced content type or a different compression granularity is **open**
and blocks Stage 2; it is recorded here so it cannot be settled after activations are seen, and "no effect"
is never to be reported as preservation. One follow-up is required before a replay: rerun this probe on
base-commit memory files (Task 7), since default-branch content is not what a PR saw.

Preservation contract for C1/C3, **enforced by the study rather than assumed of the tool**: fenced code,
inline code, identifiers (paths, commands, versions, snake_case, ALL-CAPS tokens), headings, lists (each
item compared by its full text, counted, not by its first word), emphasis-only lines, tables and
frontmatter must survive; only prose may be rewritten. Engine's compressors are lossy by
design (§13.9), so `contract.ts` checks every surface after the transform and a violation voids the
replay — the vendor promises pass-through when a gate fails, not preservation. Achieved ratio is recorded
per file; files with <10% reduction are flagged so "no effect" cannot be an artifact of "no compression".

### 8.3 Datasets and sample

Skills: GitSkills v1.0 `artifacts` rows for the repository at the PR's base commit. PRs: SpecMine v1.0
merged PRs in the 306 intersecting repos, restricted to the **223 repos with ≥2 skills** so every PR
can exercise H2 (3,566 merged PRs), and within it to the **2,338 that change code and do not add or edit
a `SKILL.md`**, in 208 of those repos. Both restrictions are **eligibility rules on the sampling frame**,
not exclusions applied after the draw: documentation-only PRs sit at the bottom of the size distribution
(median 7 changed files against 27), so sampling both would make the size strata partly a code/not-code
control; and a PR that edits a `SKILL.md` asks the agent to change the very artifact whose body the
catalog displays, so the treatment would alter its own target. Neither costs power — 200 of 2,338 is an
8.6% draw from a pool still 11.7× the requirement. The 808 documentation-only pool PRs and the 420 code
PRs that add or edit a `SKILL.md` are counted and reported, never sampled. Sample **200 PRs**, stratified
by repo skill-count quartile and PR size, seeded `20261223`, with a **20% oversample** for material
failures. Pilot PRs (§8.7) are drawn from the complement and are **disjoint** from the analysis sample.

**Needed-skill labels.** Every analysis PR needs the id of the skill its task calls for, because that id
is part of the gold set. An **LLM judge from a different model family than the study model** labels each
PR from title and body (never the diff, never the condition); a **20–30 PR human-labelled calibration
set** validates the judge, and the agreement is reported with the disagreements listed. The judge ran on
**GPT-6 Luna** (OpenAI) through the Freebuff CLI, which needs no API key; the instruction text and all 20
batches are hashed in `analysis/judge_manifest.json`, and the labels are in `analysis/judge_labels.json`.
Because the judge chooses only among the candidate skills shown to it, **candidate recall is 100% by
construction and is never reported as a finding**: the labels say which candidate a PR needs, not whether
extraction missed a skill. Of the 200 PRs, 75 need at least one skill (83 instances; 0/1/2 skills for
125/67/8 PRs), which is the base rate the activation outcome inherits.

**Mechanical cross-checks, reported but never gating (settled 2026-11-17).** Two mechanical signals are
computed for every PR and reported beside the judge; neither excludes a PR, because disagreement must be
visible rather than filtered. The first — the skill whose recorded `artifacts.path` intersects the PR's
`pr_files` — **cannot speak on this frame**: it fires for **0 of the 200** analysis PRs, because its pool
hits were the `SKILL.md`-editing PRs now outside the frame, so it is reported as availability (0/200),
not as concordance. The second — a skill whose body names a file the PR changed — fires for **32 of 200
(16.0%)** and is used as the sensitivity subset where judge and mechanical labels can be compared. The
primary outcome therefore rests on the judge plus the 20–30 PR human calibration set, and the earlier
plan to let the mechanical rule gate labels is withdrawn: at 385 of 3,566 pool PRs (11%) availability it
would have removed ~89% of the sample for silence rather than disagreement. The `SKILL.md` question is
settled the other way — as the frame rule above — because it is a property of the task, not of a label:
31 of the old 200-PR draw edited a skill file, and a frame-level re-draw with the same seed keeps n at
200 without replacements.

Exclusions, pre-specified: base commit unfetchable; no skill body in the repo; the judge produced no
usable needed-skill label after one retry; the PR body fails the reproducibility screen (§8.5 step 2);
invariant failure. Each is counted and reported; nothing is dropped silently. A replay that exhausts its
turn or token budget is **not** an exclusion: it stays in the outcome set with its termination reason and
is handled by the sensitivity analysis in §8.6, because a compressed arm may exhaust budgets at a
different rate and dropping those replays would bias the contrast.

### 8.4 Harnesses

- **H1 harness — description-only routing.** The agent sees each skill as `name` + `description`; the
  body is returned only by `load_skill(name)`.
- **H2 harness — full-text routing.** The agent sees the full skill text in the catalog.

The harness labels H1 and H2 are unrelated to the hypotheses H1–H3 of §8.1; where §8.5 writes
"H1 × {…}" it means the *description-only harness* running those conditions.

SkillRouter's result makes this a necessity rather than a nicety: bodies carry routing signal, so a
description-only harness and a full-text harness can disagree about which skill wins. H1 is the primary
harness; H2 runs on an 80-PR subset for the routing comparison.

### 8.5 Execution plan (Stage 1 → Stage 2)

1. **Material.** `pulls/{n}` → `base.sha`; fetch the tree tarball; materialise in a throwaway dir;
   install skills from GitSkills rows; discover memory files from a pinned list (`CLAUDE.md`,
   `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md`, `MEMORY.md`, `docs/conventions.md`,
   `docs/STYLE.md`) plus any file the repo itself names as such.
2. **Task.** PR title + body as the request; no diff, no PR file list, no branch name. The diff is
   withheld because it is the **answer key**, not because it is unavailable — Gate 3's gold set is exactly
   `pr_files`, so diff text would turn the measure into transcription. Context the body leaves out comes
   from the materialised base tree: the agent can list, read, search and record commands, which is how it
   discovers what exists and what is missing. A body that names the work in prose ("add a null check in
   `src/parse.ts`") is normal and desirable; verbatim patch content, a file list or a branch name is not.
   **Reproducibility screen, applied at fetch, before the sample is frozen:** the body must state what was observed and what was
   expected, and must not quote the patch. Bodies that fail it are excluded before any replay and counted
   as their own exclusion class (§8.3), so no condition ever sees a PR the others do not.
3. **Tool surface.** `list_dir`, `read_file`, `write_file`, `search`, `record_command` (records; only a
   read-only allowlist — `ls`, `cat`, `head`, `tail`, `grep`, `git status` — actually executes), and
   `load_skill`.
4. **Budgets.** 25 model turns and a fixed token ceiling per replay; hitting either is a recorded
   termination reason, and such a replay stays in the outcome set rather than being excluded (§8.6).
5. **Order.** Conditions in seeded random order per PR, each in a fresh session.
6. **Recording.** Transcript, model version, parameters, all tool calls with arguments, activations with
   turn index, tokens, achieved ratios, invariant hashes, timings.
7. **Replays per PR.** Description-only harness × {C0, C0b, C1, C2, C3} = 5 on every analysis PR;
   full-text harness × {C0, C1} = 2 on the 80-PR subset; C4 on a 40-PR subset = 1.
   Total = 200×5 + 80×2 + 40 = **1,200 replays**. (An earlier draft quoted 1,440, which only holds if the
   full-text harness runs on all 200 PRs; §8.4 puts it on 80.)

### 8.6 Analysis plan and power

- **Outcome definition.** Recall is scored against a transcript-independent gold set: the required calls are
  `load_skill(neededSkill)` plus `read_file` for every file the PR added or modified, taken from `pr_files`.
  The definition is frozen in `prereg/activation-plan.json` before any analysis replay.
- **Budget exhaustion.** A replay that hits the 25-turn or token ceiling stays in the outcome set with its
  termination reason recorded; H1 is reported with and without those replays, so equivalence cannot rest on
  which arm ran out of room.
- **Primary (H1).** Paired within-PR difference in tool-call recall, C1 vs C0. Equivalence by **TOST**
  with two one-sided tests at α = 0.05 each — equivalently, a 90% CI that must lie inside ±10 pp;
  report that CI against the margin. Cluster bootstrap by repository (10,000 resamples) for the CI.
- **Noise floor.** C0 vs C0b gives the stochastic band; if its recall difference or flip rate exceeds
  the margin's half-width, H1 is reported for stable-baseline PRs only, and that restriction is stated.
- **H2.** Total-variation distance between activation distributions, C2 vs C0, with C0↔C0b as the null;
  equivalence if the upper CI bound ≤ 0.10.
- **H3.** One-sided McNemar / paired bootstrap on C4 vs C0, α = 0.05. Sensitivity requirement: the
  control must show a drop larger than the noise floor.
- **Power (computed, not asserted).** Paired binary outcomes at 20% discordance; TOST with two
  one-sided tests at α = 0.05 and 80% power, i.e. `n = (z₀.₉₅ + z₀.₉₀)² · p_disc / Δ²`. With p_disc =
  0.20 this gives **n ≈ 172 pairs** for Δ = 10 pp (8.56 × 0.20 / 0.01 = 171.3). At n = 200 the
  non-centrality is Δ/SE = 3.16 and power is **0.87**. Δ = 7.5 pp needs ~305 pairs; Δ = 5 pp needs
  ~686 — out of budget, hence out of scope. (Recomputed numerically; an earlier draft quoted 157 from
  applying a two-sided z to a one-sided TOST, which understates n by ~15%.)
- **Multiplicity.** One primary (H1); H2 and H3 are secondary with Holm correction across two tests.
- **Deviations.** Every departure from this plan is logged with date, reason and effect, for the Stage 2
  deviations section.

### 8.7 Stage 1 pilot (due 20 Nov 2026)

15 PRs, disjoint from the analysis sample, × 5 H1 conditions = 75 replays. Purpose: show the harness
runs end to end, report achieved compression ratios, invariant pass rate, median tokens and wall time,
and calibrate the turn budget. Pilot data are **not** used for hypothesis testing and are reported as
feasibility only — pre-registered as such to avoid peeking.

### 8.8 Manipulation and quality checks (RR "outcome-neutral tests")

1. Description hash equality: 100% required, else the replay is invalid.
2. Achieved compression ratio per file, with the <10% flag.
3. C0↔C0b noise floor, reported before any treatment contrast.
4. Positive control C4 (§8.1 H3) — sensitivity demonstration.
5. Validity bridge: 15 PRs replayed through Claude Code headless, comparing activation sets against the
   custom harness; divergence reported, not hidden.
6. Blinded re-coding of 50 transcripts for tool-call recall by an **LLM judge from a different model family
   than the study model**, blind to condition, with prompt, snapshot and decoding pinned and hashed in the
   prereg; agreement with the automated extractor and every disagreement are reported.

## 9. Deliverables and file layout

```
abstract.md                              structured Stage 1 abstract (~200 words)
docs/superpowers/specs/2026-11-13-skillmd-compression-design.md   this spec
docs/superpowers/plans/2026-11-14-activation-study.md             the plan (18 tasks, Task 1b included)
src/types.ts                         shared plain-object types every layer speaks
src/db/{types,sqlite,release,queries}.ts  read-only node:sqlite reader (the extraction path), shared result types,
                                     pinned text-bearing counts, SQL builders + SQL-hash cache
src/chat2db/client.ts                Chat2DB MCP oracle and prose parser (count cross-check only)
src/tokens.ts                        pinned js-tiktoken tokenizer, achieved ratios
src/prs/{specmine,corpus,sample}.ts  gzip CSV streaming, repo intersection, seeded sample
src/material/{skills,github,workdir}.ts  skills + invariants, PR/body/`base.sha` + tarball, per-condition workdir
src/compress/{index,caveman,destructive,contract}.ts  identity, Engine CLI adapter, C4, preservation checks
src/replay/{tools,harness,agent,transcript,plan}.ts  tool surface, catalogs, loop, JSONL, grid + prereg guard
src/analysis/{outcomes,labels,equivalence}.ts  recall/activation/cost, label export, TOST/bootstrap/TV
prereg/activation-plan.json          frozen hypotheses, margin, sample, exclusions, analysis; runner refuses otherwise
data/prs_v1/{sample.jsonl,screened_out.jsonl}  frozen sample + screening exclusions (gitignored)
analysis/transcripts/                replays (gitignored; deposited by hash + redistributable subset)
analysis/run_manifest.json           counts, model snapshot, engine pin, achieved ratios
paper/main.tex                       6-page IEEEtran RR report skeleton
REPRODUCE.md                         commands, runtimes, model versions, expected outputs
```

## 10. Ethics, licensing, reproducibility

Public repositories only; GitHub API within terms; no PII beyond public handles; **no execution of
repository code** — commands are recorded and only a read-only allowlist runs, which also removes the
prompt-injection path through a skill's bundled scripts. Quotes are license-aware
(`repo_license_spdx_id`). Transcripts are released as hashes plus a redistributable subset; full traces
are available to reviewers via the anonymised artifact.

Pre-registration: the accepted Stage 1 report **is** the preregistration. A machine-readable mirror
(`prereg/activation-plan.json`: hypotheses, margin, sample, exclusions, analysis) is committed and
hashed before any analysis-sample replay; the runner refuses to execute without it. The accepted report
is posted to a preprint server with a DOI **before 28 Feb 2027**, as required.

Artifact: harness, PR sample IDs, compression adapters and their achieved ratios, prompts, seeds, model
versions, analysis code, `REPRODUCE.md`. `.mcp.json` and the GitHub token are never shipped.

## 11. Risks

- **H3 fails.** If the destructive control does not degrade recall, the pipeline is not sensitive; the
  paper must say so and treat H1/H2 as inconclusive. This is pre-committed, not decided later.
- **Noise swamps the margin.** If C0↔C0b exceeds the margin's half-width on many PRs, H1 moves to
  stable-baseline PRs and the restriction is reported.
- **Margin too wide to be interesting.** 10 pp is defensible but not impressive; reviewers may ask for
  5 pp. The power table (§8.6) is the answer: 5 pp needs ~686 pairs, which the budget cannot buy. State
  the trade-off openly rather than hide it.
- **Material loss.** Deleted repos, force-pushes; mitigated by a 20% oversample and counted exclusions.
- **Compressor drift.** Engine is a moving target: pin the release tag and sha256, record per-file
  transform hashes and the `detect` verdict, and keep the pre-compression bytes so any transform can be
  audited after the fact.
- **Ecological gap.** The harness is a simulation; the 15-PR bridge measures the gap.
- **Timeline.** 7 days to the initial report. The Stage 1 deliverable is the protocol plus a 75-replay
  pilot; the 1,200-replay grid happens **after** IPA, which is the point of RR.

## 12. Corrections required outside this spec

1. **`abstract.md` says "Exploratory, framed as an equivalence test".** Equivalence with a fixed margin
   and a pre-specified analysis is a **confirmatory** hypothesis; the RR call treats the two categories
   differently, and an exploratory registration cannot pre-specify an equivalence bound. Recommend
   changing the header to *Confirmatory (equivalence)*.
2. **"SkillRouter … loses 31–44% accuracy"** → it is **31.4–44.0 pp of Hit@1** when the body is removed.
   Percentage versus percentage points matters here.
3. **"CompressAgent … collapsing by 35% (19.9%)"** → 19.9% is generic rewriting at 35% retained;
   section-based methods reach 47.0% at the same budget. Say "generic rewriting".
4. **Word count 228** against the RR guideline of "~200 words"; trim before 20 Nov.

## 13. Decisions

1. *My call:* confirmatory equivalence framing, Δ = 10 pp, 200 PRs, **1,200 replays** (200×5 + 80×2 + 40).
2. *My call:* six conditions including C0b (noise floor) and C4 (positive control) — both are what RR
   reviewers ask for.
3. *My call:* H1 is the description-only harness; H2 (full-text) on 80 PRs, because SkillRouter shows
   bodies carry routing signal.
4. *My call:* shell commands recorded, not executed (ethics and prompt-injection safety).
5. *My call:* pilot PRs disjoint from the analysis sample, reported as feasibility only.
6. *Settled (2026-11-16):* **anonymity** — single-anonymous, as the Author Guide's wording in §6 states.
   The old spec's double-blind assumption is dropped and the report names its authors at this stage.
7. *Settled (2026-11-16):* **model** — **DeepSeek V4.1 Flash** anchors the study. The exact snapshot id is
   recorded in `run_manifest.json` and quoted in the report, and that model's price sheet supplies the
   per-replay cost estimate. A single model anchors every replay, so no cross-model comparison is claimed.
8. *Settled (2026-11-16):* **GitHub token** for public read — supplied, verified against both required
   endpoints (PR metadata with `body` and `base.sha`; base-commit tarball), held in `.env`, which is
   gitignored. No decision remains open before the pilot.
9. *Settled (2026-11-16):* **`/caveman-compress` access** — the **Caveman Engine CLI** (`caveman-engine`,
   Apache-2.0, local, no account), pinned by release tag and sha256. Engine supplies transformed bytes only:
   every ratio is counted with the study's `js-tiktoken` tokenizer, not Engine's `o200k_base` counts or its
   `caveman stats` deltas. Original-byte output is a valid result and is recorded as `untouched`, not as an
   error; the recovery handles Engine offers are unused because the study retains the pre-compression bytes.
10. *Settled (2026-11-16):* **second rater** — an LLM judge from a different model family than the study
    model re-codes the 50 blinded transcripts (§8.8) and labels the needed skill for every analysis PR
    (§8.3). A **20–30 PR human-labelled calibration set** (2–3 hours) validates the judge, and the
    agreement is reported rather than assumed.
11. *Settled (2026-11-16):* **skill-database access** — a **read-only `node:sqlite` connection to the
    release file** replaces the earlier "Chat2DB MCP only" rule. The MCP prose transport rewrites skill
    text (newlines become literal `\n`; 187 of 200 characters differ on a sampled body) and cannot
    distinguish `NULL` from the string `NULL`, which is disqualifying when skill text is the dependent
    variable. Chat2DB is kept as an independent count oracle, never as a source of text. This amends §6
    (amendment recorded as rev. 6);
    no measurement or hypothesis changes, because the transport was plumbing and never a condition.
12. *Settled (2026-11-16):* **text-bearing definition** — *text-bearing* means `content IS NOT NULL`
    (**1,880,329** occurrences), *non-blank* adds a whitespace trim over space, tab, CR and LF
    (**1,880,327**), and `content_fetched = 1` (**1,880,348**) is a fetch flag, never a text count: 19 of
    those rows carry the flag with no content. Code: `src/db/release.ts`, pinned to the release and
    asserted in `tests/release.test.ts`. The earlier 1,880,348 in §6 came from the fetch flag.
13. *Settled (2026-11-16):* **USD ceiling** — explicit and set high, raised only after the pilot reports the
    measured per-replay cost. No uncapped run: the abort-before-ceiling guardrail is itself part of what the
    pilot verifies, and a ceiling is also what makes the Stage 1 cost-per-replay figure reportable.
14. *Settled (2026-11-17):* **sampling frame** — the sample is drawn from the **2,338 code-changing
    merged PRs that do not add or edit a `SKILL.md`**, in 208 of the 223 pool repos, not from all 3,566
    (§8.3). Both restrictions are eligibility on the frame, applied before strata are built, so the size
    buckets cannot conflate documentation work with small code changes (median 7 changed files against
    27) and no task asks the agent to rewrite the artifact under test. No power cost: 8.6% draw from a
    frame 11.7× the requirement. The 808 documentation-only PRs and the 420 `SKILL.md`-editing code PRs
    are counted and reported, never sampled.
15. *Settled (2026-11-17):* **needed-skill labels** — the LLM judge is primary, with a 20–30 PR human
    calibration set; the mechanical path-intersection rule is **not** a gate and is reported as
    availability only (0/200 on the drawn frame), and the body-reference rule (32/200, 16.0%) is the
    sensitivity subset for judge–mechanical concordance. No PR is excluded for disagreement.
