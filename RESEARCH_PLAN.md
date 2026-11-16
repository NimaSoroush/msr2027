> **Superseded as the design of record by
> [`docs/superpowers/specs/2026-11-13-skillmd-compression-design.md`](docs/superpowers/specs/2026-11-13-skillmd-compression-design.md).**
> Kept for the pilot tables and the working schedule; the spec governs.

# Context compression of `SKILL.md` — MSR 2027 Mining Challenge research plan

Target: **MSR 2027 Mining Challenge** (Dublin, 26–27 Apr 2027), GitSkills dataset.
Hard constraints from the CFP: **4 pages + 1 page of references**, IEEE conference format,
double-anonymous, an ethics section before the conclusion, explicit dataset version citation.
Dates (AoE): **abstract 18 Dec 2026**, **paper 23 Dec 2026**, notification 19 Jan 2027,
camera-ready 26 Jan 2027.

---

## 1. The question, and why the dataset is the right instrument

Prompts get compressed to save money: routers and proxies rewrite eligible text (LLMLingua-style
token pruning, summarisation, "telegraphic"/caveman rewriting) before the model sees it. Skills are
now the largest body of *natural-language instructions* an agent loads on purpose, and they are the
one artefact where compression can break two different mechanisms at once:

* the **description** is the string the agent matches a task against — compress it and routing changes;
* the **body** is the procedure the agent follows — compress it and execution changes.

Neither failure is observable in code, and neither is verifiable by a compiler. That makes
"what does compression cost in capability?" an empirical question about a population nobody has
measured. GitSkills is the only corpus that can answer it at scale, because it has the description
and the body for 1.88M distinct skills, the copy structure that tells us which skills actually reach
agents, and commit histories that show which skills are maintained.

**Contribution claim for the paper (one sentence):** *compression is not a free knob on agent
context: at realistic ratios it preserves most routing but degrades it measurably and
non-uniformly, the loss is predictable from cheap corpus features, and the population exposure is
concentrated in a few hundred widely copied skills.*

Three things reviewers will look for, and where this design answers them:

| Reviewer question | Where it is answered |
|---|---|
| Is this only possible with this dataset? | §3 population exposure, §7 corpus-scale proxy metric |
| Is the causal claim credible? | §5 pre-registered 2×2 channel × treatment experiment, paired design |
| Can I rerun it? | §8 frozen benchmark JSONL, deterministic compressor, prompts, seeds, Zenodo DOI |

---

## 2. Related work to position against (already on disk in `research papers/`)

* **LLMLingua / LLMLingua-2** (EMNLP 2023, Findings ACL 2024) — token-level pruning, up to 20×
  with small average drops on QA/summarisation; the drop is task-dependent, worst on reasoning.
* **Information preservation in prompt compression** (Findings EMNLP 2025) — compression can drop
  key entities and grounding even when aggregate scores look stable. This is the mechanism our
  identifier-loss metric measures on real instructions.
* **Prompt compression in the wild** (ECIR 2026) — real latency/cost trade-off; compression
  overhead can cancel the savings outside a narrow operating window.
* **CAVEWOMAN** (arXiv 2606.24083) — input-side linguistic compression is a *lose-lose*: cost rises
  (~1.15× mean) while accuracy falls, because models compensate with longer answers. Directly
  relevant: our T1 treatment is exactly this style applied to instructions, and we must measure
  *realized* cost, not file size.
* **Style-Compress** (Findings EMNLP 2024) — style of the compressed text matters more than ratio.

Gap: all of the above compress *task prompts or documents*. None studies compression of
**reusable, machine-selected instructions** where the compressed text also has to keep working as a
router key, and none is measured on a population of real artefacts.

---

## 3. Data: what I verified in the local 44 GB release

`agent_skills_release.db` (GitSkills v1.0, July 2026, DOI 10.5281/zenodo.21875637). Tables:
`artifacts`, `repos`, `artifact_siblings`, `mining_runs`.

| Quantity | Value (measured, `analysis/pilot2.log`) |
|---|---|
| `SKILL.md` occurrences | 3,797,117 |
| occurrences with full text (`content_fetched=1`, one representative per content) | 1,880,348 (49.5%) |
| distinct contents (`dedup_primary=1`) | 1,877,981 |
| body size | median 4,606 chars (~1.2k tok); p90 14,833; p99 41,095; 8.5% > 16k chars |
| total body text | 13.08 GB ≈ **3.27B tokens** if every distinct skill were loaded once |
| description ("router string") | median **207 chars**; p90 499; only 4.5% the size of the body |
| bundled payload | 682,934 skills have siblings; mean 466 KB when present; 214,680 bundle scripts |
| candidate set per repo | median 2 skills; p90 12; p99 63; 31,059 repos ≥ 10; 3,468 ≥ 50; 193 ≥ 500 |
| reuse | 50.5% of occurrences are verbatim copies; 20.7% of contents are copied >1×; top 1% of contents = **25.9% of all occurrences** |
| maintenance | 458,548 skills have commit history; 33.7% edited ≥2× |

Two numbers carry the motivation: the router string is ~4.5% of the artefact but decides
*everything* about whether the skill is used, and a few hundred contents account for a quarter of
all deployments, so compression exposure is extremely concentrated.

Field names used: `artifacts(repo_full_name, path, filename, location_class, file_sha, content,
content_fetched, frontmatter_valid, name, description, body_chars, commit_count, sibling_count,
sibling_bytes, has_scripts, has_references, dedup_primary, first_commit_at, last_commit_at,
first_commit_author_type, last_commit_author_type, first_commit_message, last_commit_message)`.

Sampling caveat found the hard way: rows are ordered by ingestion, so `ORDER BY rowid LIMIT n`
returns one region of the corpus. Use a stride over `rowid` (or over repos) — the pilot's first
sample was 100% small skills until this was fixed.

---

## 4. Research questions

* **RQ1 (population).** How much of a skill is compressible, and what does compression remove?
  Descriptive at 1.88M scale: token savings per treatment, share of text that is prose vs.
  constraints vs. code, identifier density in descriptions and bodies.
* **RQ2 (routing).** Does compressing the *description* change which skill an agent selects, and how
  does loss scale with ratio and with candidate-set size?
* **RQ3 (execution).** Does compressing the *body* change whether the agent completes the task
  correctly, and are constraint/security lines disproportionately lost?
* **RQ4 (prediction).** Can routing loss be predicted from corpus features alone (identifier recall,
  description–body term overlap, constraint density), so the 1.88M population can be screened
  without model calls?

Each maps to a challenge-suggested direction: RQ1/RQ2 to "software metrics for natural-language
instructions" and "which properties of the description are associated with reuse", RQ3 to
"maintenance and trust", RQ4 to the metrics direction. Using the description/body split, copy
counts, and commit history means three tables, not one — challenge reviewers notice this.

---

## 5. Experiment design (the causal core)

**2 × 4 design: channel × treatment.**

Channels: `description only`, `body only`, `both`, and a no-compression control.
Treatments:

* **T0 identity** — byte-identical control.
* **T1 telegraphic** — deterministic rule-based rewriting: drop function words, articles, copulas,
  filler, decorations; keep nouns, verbs, identifiers, numbers. Fully reproducible, no model in the
  loop (pilot: 27–32% token reduction).
* **T2 structure-preserving** — delete prose examples and motivational text, keep headings, lists,
  code fences, and every line matching a constraint/command pattern (pilot: ~41% reduction if
  applied aggressively; tune to ~2×).
* **T3 lossy model compression** — LLMLingua-2 (or a fixed summariser) at 2× and 4×, i.e. what a
  real proxy does.
* **T4 compression-as-a-skill** — a `SKILL.md` that instructs telegraphic output style, loaded
  alongside the task skill. This is the "caveman response skill" condition and must be reported
  separately: it compresses the *output* channel, not the instruction.

**Material.** `analysis/build_routing_bench.py` freezes candidate sets from real repositories
(8–40 skills each, descriptions ≥ 80 chars, gold skill's name absent from every competitor) into
`bench_v1.jsonl`. Target 200 repos × 1 query + 50 designed negatives (queries with no correct
skill, to measure false activation). Task statements are generated from the gold description with
the skill name removed, then **human-validated on 100 items by two annotators (report Cohen's κ)**;
items failing validation are dropped, not repaired.

**Models.** Three: one frontier API model, one mid-tier API model, one open-weight model (fixed
version strings, temperature 0, 3 seeds). Every treatment sees byte-identical candidate order.

**Metrics.**
*Routing:* top-1 accuracy, macro-F1 over the selected set, false-activation rate on negatives,
abstention calibration (ECE).
*Execution:* task pass rate on executable checks for 60 tasks, constraint-violation count against a
rubric (must/never/security lines), realized cost.
*Cost:* total tokens in **and** out, including retries and recovery reads — never file size alone
(the CAVEWOMAN failure mode).

**Analysis.** Paired comparisons per item (McNemar for accuracy); mixed-effects logistic regression
with random intercepts for task and model, treatment × channel interaction as the headline term;
report risk differences with 95% CIs and per-model breakdowns. Pre-register the primary outcome
(top-1 routing accuracy, description channel, T1 at ~2×) before running the grid.

**Power.** 200 paired items detects a 6–7 pp paired shift at 80% power (α=0.05); 200 × 4 channels ×
4 treatments × 3 models × 3 seeds ≈ 28,800 calls for routing, which is affordable at mid-tier
pricing. Execution study is deliberately small (60 tasks) and reported as a secondary result.

---

## 6. Pilot results (already measured — these go in the paper as motivation, not as findings)

| Measure (n=2,892 distinct skills, whole-corpus stride sample) | mean | median | p90 |
|---|---|---|---|
| token reduction, telegraphic rewrite | 31.6% | 27.4% | 52.0% |
| token reduction, structure-only | 40.6% | 39.5% | 70.1% |
| intra-file repeated-line share | 11.0% | 8.4% | 27.2% |
| code-block char share | 20.1% | 12.7% | 55.8% |
| description terms present in body | 65.7% | 66.7% | 100% |
| lines that are operational/constraint | 10.0% | 8.5% | 20.3% |
| description token reduction, telegraphic | 18.8% | 14.7% | 27.7% |
| **named identifiers lost from description** | **4.4%** | 0% | — |

Read: roughly a third of a skill's tokens are droppable without touching code or constraints, and
compression of the router string is cheap in tokens (19%) but already deletes named identifiers in
some skills — the exact failure mode the EMNLP 2025 information-preservation work predicts. The
paper's job is to turn that into an effect size on routing, not to assume it.

---

## 7. RQ4: the corpus-scale payoff

Define **Router Compression Safety (RCS)** per skill from corpus text only:
identifier recall under treatment, trigger-phrase recall (n-grams unique to that description within
its candidate set), description–body overlap, constraint density. Fit its relationship to measured
routing drop on the 200-item benchmark (report Spearman ρ and calibration), then apply it to all
1.88M distinct skills and report population exposure, weighted by copy count.

That yields the sentence only this dataset can support: *"under 2× telegraphic compression, X% of
skills lose at least one named identifier from their router string; these skills account for Y% of
all deployed occurrences because the most-copied skills are the most identifier-dense."* Verify the
direction of that last clause before claiming it — that is a real hypothesis, not a result.

---

## 8. Reproducibility and open science (required for the best-paper award)

Ship: `pilot2.py`, `build_routing_bench.py`, the compressor with unit tests, `bench_v1.jsonl`
(+ sha256), task paraphrases and prompts, model version strings, seeds, raw model outputs, the
derived feature tables, and a `REPRODUCE.md` with the exact commands and expected runtimes.

* Deposit code + derived data on **Zenodo privately before submission** (≤50 GB, so derived tables
  and benchmark only — not the 44 GB SQLite), then make public on acceptance for a DOI.
* Double-blind: anonymise the GitHub mirror via `anonymous.4open.science`, third-person self-cites,
  strip author names from notebook metadata and commit authors.
* Cite GitSkills exactly as in the CFP and state "v1.0, July 2026 snapshot, DOI
  10.5281/zenodo.21875637".

---

## 9. Threats to validity (write these as a paragraph, not a list)

Snapshot bias (July 2026 corpus; format is 9 months old, so trends are early); construct validity of
chars/4 token estimates (validate against a real tokenizer on 1,000 skills and report the error);
paraphrased task statements are not real user requests (mitigate with human validation and by
reporting results on validated-only items); single-turn routing does not capture multi-turn
re-selection; model non-determinism (3 seeds, temperature 0, report variance); the rule-based
compressor is one stylometric family, not "compression" in general (that is why T3 exists);
ecological validity of our candidate sets (8–40 skills) versus very large catalogs (193 repos have
≥500 skills — report separately, do not extrapolate).

Ethics: public repositories only; no PII beyond public GitHub handles; do not execute bundled
scripts; respect `repo_license_spdx_id` when quoting skill text in the paper (quote sparingly);
aggregate reporting only, no deanonymisation; note that skills can carry injection/security payloads
and that our analysis reads them as text only.

---

## 10. Paper skeleton, 4 pages

| Page | Content |
|---|---|
| 1 | Problem, two mechanisms (router vs body), motivation table (3.27B tokens, 50.5% copies, 207-char router), RQs, contribution bullets |
| 2 | Data + verified release stats; treatment definitions with worked before/after example; benchmark construction; pre-registered primary outcome |
| 3 | RQ1 corpus results; RQ2 routing results (main table + interaction plot); RQ3 execution results; cost results including compensation |
| 4 | RQ4 safety metric + population exposure; implications for proxy/tool builders (compress bodies, protect descriptions; never compress constraint lines); threats; ethics; conclusion |
| +1 | References (LLMLingua ×2, information preservation, ECIR latency, CAVEWOMAN, Style-Compress, GitSkills, SpecMine if combined, prompt-compression survey) |

A 4-page challenge paper has room for ~2 tables and 1 figure. Make that figure the channel ×
treatment routing-loss plot; put corpus distributions in the motivation table.

---

## 11. Five-week schedule (from 13 Nov 2026)

| Week | Deliverable |
|---|---|
| **W1 · 13–20 Nov** | Freeze `bench_v1.jsonl` (200 repos + 50 negatives); generate task paraphrases; two annotators label 100; tokenizer validation; pre-register primary outcome in the repo |
| **W2 · 21–30 Nov** | Run routing grid (3 models × 4 treatments × 3 channels × 3 seeds); build RCS features for 1.88M skills; write RQ1 + RQ2 results |
| **W3 · 1–8 Dec** | Execution study (60 tasks, executable checks, constraint rubric); mixed-effects analysis; all figures |
| **W4 · 9–17 Dec** | Draft 4 pages; internal red-team review against §12; ethics + threats; **submit abstract 18 Dec** |
| **W5 · 18–23 Dec** | Reproducibility package + Zenodo deposit; anonymise; format check (IEEE 10 pt, 4+1 pages); submit 23 Dec |

---

## 12. Definition of done — what "successful at MSR 2027" means concretely

1. A claim that is falsifiable and was pre-registered, with effect sizes and CIs (not just p-values).
2. At least one result that **contradicts intuition** (e.g. "router compression is cheap in tokens
   and expensive in accuracy, but only above 2× and only for identifier-dense skills") — challenge
   reviewers reward that over a descriptive census.
3. Three tables used, dataset version cited, release statistics reported from the actual file.
4. Reproducibility package with a DOI and a `REPRODUCE.md`, plus 1,000-word-equivalent budget of
   compute documented — this is the gate for the best-paper award.
5. Ethics section before the conclusion, 4-page limit met exactly, fully anonymous.
6. Presentation story: one number (the 207-char router carrying the decision), one plot (loss by
   channel and ratio), one recommendation for tool builders.

## 13. Known risks

* **Null result risk.** If T1 at 2× loses <2 pp routing accuracy, that is still publishable *and*
  more useful than a scare story — reframe as "compression is safe for bodies, unsafe for
  descriptions at high ratios", and let RQ4's population exposure carry the paper.
* **Benchmark too easy.** If all treatments score >95% top-1, harden by adding sibling skills with
  near-duplicate descriptions (the corpus has 1,877,981 contents and heavy template reuse — mine
  near-duplicates deliberately) and by growing candidate sets to 25/50.
* **API budget.** Cap the grid; drop the third seed for the frontier model first, never the
  treatments.
* **Timeline.** Abstract 18 Dec is the real gate; the abstract can be written from the pilot.
