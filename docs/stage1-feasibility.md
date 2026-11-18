# Stage 1 feasibility: 75-replay pilot

Status: **the dry run ran; the live run has not.** Everything below is measured on real material —
skills from the release, the pinned Caveman Engine, the real preservation contract — with a
**scripted model** in place of the study model. No token, cost or wall-time figure exists yet, and
none is estimated here.

Evidence file: `analysis/pilot_dryrun.json` (build of 2026-11-18); transcripts in
`analysis/pilot_dryrun.jsonl` (gitignored).

## What the dry run exercises

`node scripts/pilot.ts --dry-run` builds the Stage 1 grid from the frozen sample, materialises every
arm, replays it with a model that loads the needed skill, reads the files the gold set names, and
finishes, then extracts outcomes. It proves the plan, the material layer, the recorder and the
extractor agree on one grid. It does not test a model.

The base tree for each arm is the gold paths as stubs rather than a GitHub tarball: fetching 15 base
trees is a network cost the dry run does not need, and the facts this run is meant to establish
(skills, ratios, hashes, recorder, extraction) do not depend on the tree.

## The grid

| | count |
| --- | ---: |
| planned (15 PRs × 5 H1 arms) | 75 |
| recorded | 67 |
| excluded with a reason | 8 |
| duplicate ids | 0 |
| unaccounted ids | 0 |

Both exclusions are material facts, not script failures:

| excluded | arms | reason |
| --- | ---: | --- |
| `LIDR-academy/AI4Devs-LTI-extended#15` | 5 | GitHub returns **404** for the PR; it cannot be replayed |
| `elastic/terraform-provider-elasticstack#2165` | 3 (C0b, C1, C3) | preservation contract violated: a code fence in `.agents/skills/pr-monitoring-loop/SKILL.md` changes |

The first is the same repository as the judge sample's 404 (`…#18`), so at least one PR in the frozen
200 no longer resolves on GitHub. The second is the protocol blocker already open from Task 7: a base
tree containing a skill the contract rejects cannot be materialised under C1/C3, and the sample
contains such a repo. **A 75/75 grid is therefore not achievable on this sample** without a
pre-registered exclusion rule; the honest figure is 67 recorded with two named reasons.

## Achieved compression ratio

Ratios are per materialised surface, measured with the pinned tokenizer. `untouched` means the
compressor returned the original bytes.

| condition | surfaces | median | mean | p10 | p90 | untouched |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C0 (release bytes) | 112 | 1.000 | 1.000 | 1.000 | 1.000 | 112 |
| C0b (whole file, identity path) | 104 | 1.000 | 1.000 | 1.000 | 1.000 | 104 |
| C1 (bodies) | 104 | 1.000 | 1.000 | 1.000 | 1.000 | 104 |
| C2 (memory files) | 112 | 1.000 | 1.000 | 1.000 | 1.000 | 112 |
| C3 (bodies + memory) | 104 | 1.000 | 1.000 | 1.000 | 1.000 | 104 |

**The compressor is a no-op on this material.** Every one of the 104 pilot skill bodies came back
byte-identical under C1: no surface shrank, none grew. The only observable effect on pilot material
was the *single* file it did change — elastic's `pr-monitoring-loop/SKILL.md` — and that change broke
a code fence, which is why those three arms are excluded rather than replayed.

This agrees with the earlier probe over the wider corpus (`analysis/compression_probe.json`: 200/200
skills untouched), so it is not a pilot-sample accident. It has two consequences:

1. **The treatment arm is the control.** Under H1 only names and descriptions are visible, so a C0
   replay and a C1 replay of the same PR see byte-identical catalogs and identical task text. H1 as
   pre-registered cannot detect an effect, because there is no manipulation to detect. This is the
   plan's "unfalsifiable null" risk arriving early and from the other side: not a blind instrument,
   but an identity treatment.
2. **"≈67% retained" is not what this pipeline achieves.** The design premise came from prior work;
   on this material the measured retained fraction is **1.000**, i.e. no token cut at all. Any
   claim of the form "≈33% fewer tokens" must be restated as measured, and the measured value is
   zero.

## Invariants

Across the 14 PRs with at least two materialised arms, the description, frontmatter and structure
hashes were identical in **14/14**. Per-replay, C0 produces the release bytes and C0b passes the
whole file through the compressor's identity path.

## A material defect this run found and fixed

The first dry run reported 20 surfaces at C1 with a ratio **above** 1 (up to 1.067). That was not the
compressor: `materialise` rejoined every skill as `---\n<frontmatter>\n---\n<body>`, so a skill with
no frontmatter — which is body-only in the release — acquired a fabricated empty YAML block. It
changed bytes the experiment claims to preserve and inflated the measured text. Fixed in
`src/material/workdir.ts` with a regression test (`tests/material.test.ts`: a body-only skill must
come out byte-identical and report ratio 1). After the fix, C1 is 104/104 untouched.

Worth stating plainly: had this shipped, every C1 replay would have carried an 8-byte header the
release does not have, and the achieved-ratio table would have shown a small expansion that the
compressor never produced.

## What did not run, and why

Step 2 (live run) requires DeepSeek V4.1 Flash at temperature 0.0 with per-call token accounting. The
project has no route to it: there is no API key by decision (2026-11-16, "$0 spent; Freebuff
subscription only"), and the Freebuff CLI is an interactive agent — it has no headless mode and
cannot be driven turn-by-turn as a JSON model that reports input/output tokens. The judge round solved
a comparable problem over a pty because the judge only needs one prompt and one answer per item; a
replay needs a multi-turn loop with exact token counts, which that route cannot supply.

So Step 2 has **no numbers**, and Step 3 (turn-budget calibration from p95) has nothing to calibrate
against. The dry run's termination histogram (40 `turn_budget`, 27 `final`) reflects the scripted
model's read-every-file script and a 25-turn budget, not model behaviour, and must not be read as a
calibration.

## Pilot data are not hypothesis tests

Nothing in this report is used for hypothesis testing. The grid is an instrument check, the ratios
are a property of the compressor on this material, and the scripted model's mean recall (0.766) is an
artefact of the script, not a measurement of any condition. The Stage 1 paper may cite the achieved
ratio and the exclusion counts as feasibility evidence; it may not cite a treatment effect.

## What has to be decided before Stage 2

1. **Model access.** Either a paid DeepSeek key (contradicting the $0 constraint) or a different
   decision about how the study model is reached. Without it, Stage 2's 1,200 replays cannot run.
2. **The treatment itself.** With a no-op compressor, H1/H2 measure nothing even with full model
   access. Either the arm changes (a compressor that actually reduces tokens, or a harness whose
   treatment is visible under H1) or the hypotheses are restated. This is a protocol decision, not an
   implementation one, and it belongs in the deviation log with a date.
