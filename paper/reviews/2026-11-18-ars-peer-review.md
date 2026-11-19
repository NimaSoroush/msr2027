# Peer Review — "When Context Shrink, Do Skills Still Fire?"

**Skill**: `academic-paper-reviewer` v1.11.1 (plugin `academic-research-skills` v3.24.3)
**Mode**: `full` (5 seats + editorial synthesis)
**Manuscript**: `paper/main.tex` (6 pp. body + references on p. 6, IEEEtran conference, MSR 2027 RR Stage 1)
**Venue standard applied**: MSR 2027 Registered Reports, Stage 1 (CFP: relevance, importance of RQs, plausibility of hypotheses, soundness/feasibility of method incl. power analysis, replicability, pre-specified outcome-neutral tests) — supplied with the request as the reviewer-facing criteria
**Review date**: 2026-11-18

## Execution provenance (read this before relying on the disagreement structure)

- **Calibration status: `NOT_CALIBRATED`.** No `PROFILE_MEASURED` target profile exists for this venue/design; the verdicts below are criterion-anchored judgements, not a calibrated score.
- **Panel execution**: five seats were executed as role-separated passes (Journal-Fit, Methodology, Domain, Perspective, Devil's Advocate) plus a synthesis. Role separation is **not** a claim of independent error processes: all five passes ran inside one model session. Correlated blind spots between seats are therefore possible and the consensus below should not be read as five independent confirmations.
- **Why in-session**: the `academic-paper-reviewer` skill was run as a headless Claude Code call (`claude -p`), which failed with `API Error: Connection refused` — `~/.claude/settings.json` points Claude Code at a local gateway (`ANTHROPIC_BASE_URL=http://localhost:20128`) that is not listening. The skill's own protocol, agent cards and rubric files were read and applied manually instead. Re-run with `claude -p "/ars-review …"` once that gateway is up if you want the skill's multi-agent dispatch.

---

## 0. Desk-check gate (before reviewing)

| Item | Result | Evidence |
|---|---|---|
| Page budget (6 body + 1 refs) | **PASS** | PDF builds 6 pages; references begin and end on p. 6 |
| Format (IEEEtran 10pt conference, two-column) | **PASS** | `\documentclass[10pt,conference]{IEEEtran}`, no compsoc options |
| Required sections | **PASS** | structured abstract (180 w), Introduction, Hypotheses, Variables + operationalisation (Table I), Datasets/frame/power, Execution Plan, Analysis Plan, Outcome-neutral checks, Threats, Ethics, Deviations |
| Single-anonymous author block | **PASS** | name shown, no anonymity violation |
| Build cleanliness | **PASS** | 0 errors, 0 overfull boxes, 0 unresolved refs/cites (both tectonic and Overleaf builds) |
| **Placeholder text in the PDF** | **FAIL (blocking, trivial)** | `TODO: affiliation`, `TODO: city, country`, `TODO: email` print on p. 1 |
| **Uncited references** | **FAIL (blocking, trivial)** | `llmlingua`, `inozemtseva`, `gousios`, `ernst` are in the bibliography but never `\cite`d (10 cited keys, 14 bibitems) |
| Title register | **Concern** | "When Context **Shrink**" is ungrammatical; "Shrinks" is the standard form. Not a desk-reject, but it is the first line the editor reads |

Two of these are two-minute fixes and cost you a first impression. Fix them before anything else in this report.

---

## 1. Journal-Fit Reviewer (seat 1)

**Recommendation: Minor Revision.** **Confidence (self-reported scope): 4/5.**

| Criterion (CFP) | Judgement | Evidence anchor | Rationale | Uncertainty | Decision-bearing? |
|---|---|---|---|---|---|
| Relevance to MSR | `EXCEEDS` | §I contributions; §V frame built from two mined releases; §VI replay harness | The unit is a mined artefact, the population is a corpus release, and the artefact the study protects is one the community publishes. That is MSR's centre of gravity, not an ML-venue cast | none material | no (positive) |
| Importance of RQs | `MEETS` | §III "is activation preserved at the ratio real tools actually achieve?"; H1–H3 | The question is operational (a proxy is deployed and may silently break selection), and the equivalence framing is the right shape for it | Importance is contingent on compression actually being adopted at ~0.65 retained; §I asserts adoption from vendor claims and one independent evaluation, not from measured deployment | partly |
| Plausibility of hypotheses | `MEETS` | H1/H2/H3 + Rationale ¶¶1–3; margin justification | The hypotheses are directional where they can be (H3) and bounded where they must be (H1/H2), and the margin is *chosen* with an explicit cost narrative rather than inherited. Registering the H3-conditional ("if C4 does not degrade recall, H1 and H2 are reported as inconclusive, never as equivalence") is exactly the discipline the call asks for | none material | no (positive) |
| Pre-specified outcome-neutral tests | `EXCEEDS` | §VII: description-hash equality, achieved-ratio distribution, C0/C0b noise floor, C4 sensitivity, 15-PR client bridge, blinded re-coding of 50 transcripts, plus a manipulation check at 0.70 | Six checks plus a manipulation check, each with a pre-committed consequence. This is stronger than the call requires | the C4 control's own sensitivity is unquantified (§2, M3) | yes — see M3 |
| Replicability | `PARTLY_MEETS` | §VI Treatment (4-step pruner), §VI Preservation contract, `REPRODUCE.md`, prereg hash sidecar | The pruner, contract, grid and analysis are specified well enough to reimplement; the frozen plan is hash-pinned and the sidecar currently matches | The frozen prereg does **not** yet encode the amended treatment (no pruner/r=0.65 field), so the artifact does not match the report it claims to be (§4, P2) | yes |
| Writing & structure | `MEETS` | whole ms | Dense but load-bearing; little throat-clearing. Two register slips: the title, and §I's "16.5% / 87.5%" example pair, which reads as an aside to reviewers rather than as part of the argument | — | no |

**Summary.** This is a well-aimed MSR submission. The frame, the artefact population and the deployment question are native to the venue, and the pre-specification discipline is above the median RR Stage 1. My reservation is not about fit; it is that the primary estimand may not measure what H1 claims (§2, M1) and the pre-registration artifact does not yet match the report (§4).

---

## 2. Methodology Reviewer (Peer Reviewer 1)

**Recommendation: Major Revision.** **Confidence: 4/5.**

### Criterion-bound judgements

| Criterion | Judgement | Evidence anchor | Rationale | Decision-bearing? |
|---|---|---|---|---|
| Hypothesis–design alignment | `DOES_NOT_MEET` | §IV Recall definition vs §V Power | The power analysis is the paired-**binary** formula with discordance $p_{\text{disc}}$; the outcome defined in §IV is a **share** $\text{hits}/|\text{gold}|$ over a gold set that includes every changed file. These are different estimands. See M1 — this is the central problem | yes |
| Statistical reporting completeness | `PARTLY_MEETS` | §V Power; §VII; §VIII | Effect sizes, CIs, clustering, multiplicity and the achieved-power promise are all specified. But three numbers do not reconcile (M2), and H3 has no power statement at all (M3) | yes |
| Sampling | `MEETS` | §V frame + Table II; seed; strata; oversample | Two eligibility rules applied before the draw, no post-hoc exclusions, pilot drawn first and removed, manifest hash identical on rerun, concentration disclosed and handled by clustered intervals | no (positive) |
| Measurement validity | `PARTLY_MEETS` | §IV gold set; §V labels | The gold set is transcript-independent, which is the right call. But it mixes activation with file reads (M1), and the needed-skill label is judge-only with 0/200 mechanical concordance (M4) | yes |
| Manipulation integrity | `EXCEEDS` | §VI Preservation contract incl. the list-check false negative; §VII manipulation check at 0.70; §VI identifier retention measured not enforced | The contract's history — a first-word list check that passed a file dropping three bullets, now a multiset of full item texts — is reported rather than buried, and the "contract holds by construction for C1–C3, so C4 exercises its detection power" admission is exactly right | no (positive) |
| Reproducibility of the analysis | `PARTLY_MEETS` | §VI Recording; §IX clustering | Cluster bootstrap by repository at 10,000 resamples with one primary test and Holm over two secondaries is appropriate and specific. The screen-timing contradiction (M5) threatens the frozen sample | yes |

### M1 (decision-bearing, primary). The primary outcome cannot detect total activation loss at the registered margin.

§IV defines, per PR, gold $=\{\texttt{load\_skill}(s^\star)\}\cup\{\texttt{read\_file}(f): f\in\mathrm{changed}(i)\}$, and recall $=\text{hits}/|\text{gold}|$. So the activation event contributes **one** element to a gold set of size $1+|\mathrm{changed}(i)|$. §V quotes a median of 27 changed files for code PRs (audit item 9 notes that this figure has no committed artifact — but it is the paper's own number, so the dilution should be computed against it). At 27, the skill call is $1/28 \approx 3.6\%$ of the gold set, and the weight falls further as PR size grows, so the dilution is worst precisely for the large PRs that dominate the eligible frame.

Consequence: if **every** replay failed to load the needed skill, mean recall would fall by roughly 3.6 pp — well inside the $\pm 10$ pp equivalence margin. The design as written would therefore report **equivalence** in the presence of complete activation failure, which is precisely the outcome H1 is supposed to exclude. The sensitivity analysis on the 75 labelled PRs (§IX) does not repair this: within those PRs the skill call is still $1/(1+M)$, so it changes which PRs are in the average, not the weight of the activation event in it.

The power analysis is the tell. $n=(z_{.95}+z_{.90})^2p_{\text{disc}}/\Delta^2$ is the formula for a paired **binary** outcome. It is the correct formula if the estimand were "did the replay call $\texttt{load\_skill}(s^\star)$" — a per-PR hit rate. The paper appears to have powered the binary activation outcome and then defined the outcome as a diluted share. Fix one, not both:

- **(a) Preferred, cheapest:** make the primary outcome the binary activation hit on the labelled PRs, $P(\texttt{load\_skill}(s^\star))$, with $\Delta=0.10$; keep the composite recall as a secondary deployment-facing measure. The existing power calculation then becomes correct as written, and the margin becomes meaningful again.
- **(b) Alternatively:** keep composite recall but justify the margin at that scale (a 3.6 pp activation effect is invisible at 10 pp) — which would mean a margin near 0.02 and $n$ in the thousands, i.e. out of budget. Say so rather than let the reader discover it.

Either way, **state the activation event's weight in the gold set explicitly** (mean $1/(1+M)$ over the 200 PRs) in §IV. A reviewer who computes it and finds it unaddressed will not trust the rest.

### M2 (decision-bearing). The power paragraph does not reconcile with itself.

Using the paper's own formula with $p_{\text{disc}}=0.20,\ \Delta=0.10$:

- $(z_{.95}+z_{.90})^2\cdot 0.2/0.01 = 8.5645\times 20 = 171.3 \Rightarrow 172$. Because $z_{.90}=1.2816$ is the $1-\beta$ quantile for **90%** power, 172 is a **90%**-power number, not 80%.
- At **80%** power ($z_{.80}=0.8416$): $(1.6449+0.8416)^2\times 20 = 123.6 \Rightarrow 124$.
- At $n=200$ under the stated formula the rejection-side power is $\Phi(3.163-1.645)=\Phi(1.518)\approx 0.94$, not the 0.87 claimed.

So §V currently contains three mutually inconsistent statements ("80% power", "172 pairs", "0.87 at n=200"). Pick one convention, show the arithmetic, and give the achieved power at $n=200$ from the same formula. On a review criterion that names the power analysis explicitly, this is the kind of item that converts a "yes" into a "revise".

### M3 (decision-bearing). H3 — the hypothesis that makes H1 falsifiable — has no power statement.

H3 runs on 40 PRs (Table IV). It is the sensitivity demonstration on which the interpretation of H1/H2 depends ("if C4 does not degrade recall, H1 and H2 are reported as inconclusive"). No margin, no assumed effect size, no power figure is given for it. State the smallest degradation C4 must produce for the 40-PR test to detect it at $\alpha=0.05$ with 80% power, and say what happens if the true effect is smaller — currently that event is indistinguishable from "the instrument is blind", which is the failure mode §VII says it exists to rule out.

### M4 (major). The needed-skill label is a single-judge measure with no validating concordance.

§V is candid that the mechanical path rule fires 0/200 (so it is "availability, not concordance") and that the body-path rule fires 32/200 (16.0%). That candour is good, but the consequence is that the primary outcome's non-empty component rests on one LLM judge whose error is unmeasured on this material — the promised 20–30 PR human calibration set is described in the future tense, and no agreement figure exists yet. Because the judge's errors and the treatment's effect both appear as "the needed skill was not loaded", this is a confound in the *outcome measure*, not merely a labelling nuisance.

Minimum fix for Stage 1: commit to the calibration set running **before** the grid (not after), state the statistic (Cohen's $\kappa$ or raw agreement on the needed-skill set), and state the pre-committed consequence if agreement is below a floor (for example: H1 reported on body-path-confirmed PRs only, with that subset's size disclosed). Right now the label is the weakest link in an otherwise well-instrumented chain.

### M5 (major). The reproducibility screen is described as running "before the sample is frozen", but the sample is already frozen.

§VI: "A reproducibility screen runs at fetch, before the sample is frozen." §V: the manifest is already frozen and hashed (`ca528b40…`), with 200 analysis PRs. If the screen removes PRs from those 200, the frozen sample changes and the pre-registration no longer describes the analysed sample; if it runs earlier in the *next* draw, say so. This needs one sentence either way, plus the pre-committed rule for what replaces an excluded PR (the 40-PR oversample, presumably — say it).

### M6 (minor but checkable). Three headline numbers do not match the committed artifacts.

See §6. Each is a one-line correction, but two of them (memory probe, repository concentration) are repeated in the abstract-adjacent prose and will be read as the paper's honesty about its own material.

---

## 3. Domain Reviewer (Peer Reviewer 2 — LLM agents / SE mining)

**Recommendation: Minor Revision.** **Confidence: 4/5.**

| Criterion | Judgement | Evidence anchor | Rationale |
|---|---|---|---|
| Literature integration | `MEETS` | §II | The relevant strands are present and *used*: prompt compression (survey, LLMLingua), agent-context compression (CompressAgent, Beyond Token Savings, implicit-compression-for-SE), skill-specific work (SkillRouter, SkillReducer, skill reusability). The correction that CompressAgent's 19.9% is specific to generic rewriting at 35% — with section-based methods at 47.0% — is the mark of a paper that read its sources rather than its abstracts |
| Positioning / gap | `MEETS` | §I "simultaneously a retrieval key and a procedure"; §II closing ¶ | The gap claim is narrow enough to be defensible: nobody compresses third-party instructions that must keep working as a router key, and nobody measures activation on real artefacts |
| Evidence sufficiency for cited claims | `PARTLY_MEETS` | §II ¶1 last sentence; §I "16.5% / 87.5%" | **D1** (below): one empirical claim in §II has no citation. **D2**: the prose/repeated-row shrink figures appear only in the internal plan, not in any committed analysis artifact |
| Domain-appropriate framing | `EXCEEDS` | §I §§"What we measured before registering" | The no-op finding is handled as a *design* consequence, not swept up. For a domain reviewer this is the most credible page in the paper: it says the tool the authors intended to study does nothing on this material, shows the census, and changes the treatment rather than the story |

**D1 (major, trivial to fix).** §II ¶1: "An independent evaluation of the 'caveman' response skill on 86 tasks reports 8.5% output savings against a 65% claim with quality statistically flat ($p=0.82$), and did not test the compression tool or measure activation." No citation. This is a specific, load-bearing empirical claim (it is the paper's only evidence that the vendor's number is unreliable in practice). Add the reference, or cut the sentence — it currently reads as hearsay.

**D2 (minor).** §I and §VIII cite 16.5% (long prose) and 87.5% (repeated-row) shrink from a probe. Those numbers exist in `docs/superpowers/plans/…-activation-study.md` (a prose note) but in no committed JSON. Either add the probe artifact or soften to "the binary does shrink other shapes of material (probe in the artifact)".

**D3 (minor, framing).** The design deliberately holds descriptions byte-identical, which answers a narrower question than the motivation implies: §I's opening pitch is that deployed proxies rewrite "eligible text" including frontmatter/descriptions, while H1 tests prose-only body compression with descriptions frozen. That is a *good* design choice (it separates routing from execution) but the abstract's "Compression tools are adopted … Whether compression changes which skills an agent invokes has not been measured" invites the reader to expect the deployed case. One clause in §I — "we hold descriptions fixed to isolate body effects; description compression is out of scope here" — would pre-empt the objection, and you already say the equivalent in §VI.

---

## 4. Perspective Reviewer (Peer Reviewer 3 — open science / reproducibility)

**Recommendation: Minor Revision.** **Confidence: 3/5** (artifact inspection was partial: the release databases themselves are not in the repository).

| Criterion | Judgement | Evidence anchor | Rationale |
|---|---|---|---|
| Artifact completeness | `PARTLY_MEETS` | repo tree; `REPRODUCE.md`; `prereg/` | Harness, material layer, contract and analysis code are implemented and tested (158 tests); the frozen prereg and sidecar exist and the sidecar currently matches the JSON (self-hash `387179fa…`). That is well above average for Stage 1 |
| Pre-registration ↔ report agreement | `DOES_NOT_MEET` | `prereg/activation-plan.json` | **P2**: the frozen plan contains no `treatment`/compressor field, so the amended pruner at $r=0.65$ is not in the machine-readable plan. §X promises a re-freeze "before any analysis replay"; at submission the artifact therefore does not yet match the report that says "the accepted version of this report *is* the pre-registration" |
| Data provenance traceability | `PARTLY_MEETS` | `analysis/*.json`, `data/sample_manifest.json`, `data/labels_v1/judge/batch-*.json` | Most numbers trace cleanly. Two do not trace, and one aggregation file is stale or partial (**P1**, §6) — a reviewer who opens `analysis/judge_labels.json` sees 0/200 PRs needing a skill, which contradicts the paper |
| Independent re-run feasibility | `PARTLY_MEETS` | §V "every count we report uses the pinned predicates in code, and the tests assert the release has not drifted" | Good claim, but the reviewer cannot act on it: the GitSkills/SpecMine SQLite releases and the GitHub cache are needed, and there is no container or fixture that reproduces the mining counts from a cold start. For a paper whose contribution includes the frame, make the frame reproducible in one command (even a 200-PR fixture plus expected counts) |

**P2 — detail.** `prereg/activation-plan.json` keys are `study, frozen_at, hypotheses, primary, primary_contrast, margin, alpha, n, seed, model, harness, grid, recall_definition, exclusions, not_exclusions, analysis, hash_rule, frozen, sha256, frame, labels` — no treatment description. The report says the treatment *is* the design quantity (§I) and that the prereg is re-frozen to match (§X). Re-freezing also changes the self-hash embedded in the JSON (`hash_rule`) and the quoted hashes in `REPRODUCE.md`, so this is a 20-minute mechanical job that materially strengthens the submission. Do it before uploading, not after.

---

## 5. Devil's Advocate (seat 5)

**Recommendation: Major Revision.** **Confidence: 4/5.**

The strongest case against this paper is not that it is wrong. It is that it may be **uninformative in the direction it claims to inform**, in four separable ways. Answer them in the text; each has a cheap pre-emptive answer.

1. **The margin is wider than the effect it is meant to catch.** (M1.) Under the registered gold set, total activation failure moves composite recall by ~3.6 pp. An equivalence verdict at $\pm10$ pp is then nearly guaranteed by construction. *Answer:* switch the primary estimand to the binary activation hit (M1a) — the power analysis already assumes it, so the fix is a definitional correction rather than new machinery.

2. **"Compression is safe at 65%" may not be the claim the experiment can support.** C1–C3 are one deterministic pruner — a stylometric family that deletes whole prose paragraphs. A null result licenses "this pruner at this ratio is safe on this material", not "compression at 0.65 is safe". §VI says so ("one stylometric family, not 'compression' in general; that is what C4 is for"), but C4 is a *destructive* control, not a second compressor: it demonstrates sensitivity, not generality. *Answer:* one sentence in §IX stating that the claim is pruner-specific, and that a second, non-pruner compressor is out of scope by budget — or add a cheap third arm (e.g. a paragraph-summarising compressor at the same ratio on a 40-PR subset) and call it exploratory.

3. **The judge is inside the outcome.** (M4.) If the judge mislabels, recall falls; if the pruner deletes the sentence that helps the agent choose, recall falls. Both are "the needed skill was not loaded". Without concordance evidence the two are indistinguishable, and H3 (destructive) does not separate them because it operates through the same label. *Answer:* run the 20–30 PR human calibration before the grid and report agreement; pre-commit the fallback subset.

4. **H2 may have very little to measure.** H2 needs PRs "where at least two skills compete". The frame guarantees ≥2 text-bearing skills per **repository** (§V), not per PR, and the paper never states how many of the 200 PRs actually have ≥2 candidates. If that number is 30, H2's TV-distance test is decorative and its 0.10 bound is unpowered. *Answer:* report the distribution of candidate-set size across the 200 PRs from the material layer you already have (this is a one-hour query) and adjust H2's status from "secondary confirmatory" to "secondary, exercised on $n_{\text{compete}}$" with that $n$ stated.

Secondary objections worth a line each: (a) temperature 0.0 plus one pinned snapshot means the study measures one model's behaviour, and §IX limits the claim accordingly — fine, but the abstract should not say "compression changes which skills an agent invokes" in general; (b) 40/67 pilot arms ended on the turn budget (`analysis/pilot_dryrun.json: terminationCounts`), a feasibility datum the paper does not report, and budget exhaustion is unevenly distributed across arms by construction; (c) the C0/C0b noise-floor rule ("if its difference exceeds half the margin, restrict to stable-baseline PRs") has no stated effect on $n$, so the reader cannot tell whether H1 would then be powered at all.

**Strongest counter-argument, stated fairly:** this report is more rigorous than most Stage 1 submissions in this area — it registers the instrument, measures the manipulation, defines a contract with a documented false-negative, and pre-commits the interpretation of a failed control. The objections above are about *sharpness of the estimand*, not about competence, and all are fixable in text plus one query.

---

## 6. Factual consistency audit (numbers vs. committed artifacts)

I checked every quantitative claim in `main.tex` against the JSON/doc it should come from. **Verified as matching:** 3,797,117 / 1,880,329 / 1,880,327 / 282,200 (`analysis/skill_counts.json: totals`, which is the pinned SQL result, not a prose note); median body 4,606 (`analysis/pilot2_summary.json`); 5,992 / 581 / 306 / 4,486 / 223 / 3,566 / 2,338 / 208 / 15 (`analysis/prs_pool.json: counts`, `data/sample_manifest.json: eligibility`, and the plan's reconciliation note "all seven reconcile exactly"); 16 strata and 200-40-15 roles and 71-28-14 repos (`data/sample_manifest.json`, `data/prs_v1/sample.jsonl`); 8.6% draw and 11.7× arithmetic; 3,150 / 3,135 / 99.5% / 15 changed / 14 violating with the 9-6-4-3-3 surface breakdown (`analysis/compression_all_skills.json`); 67/75 pilot arms, 8 exclusions split 5 (404) + 3 (contract), 14/14 invariant hashes, 104–112 surfaces at ratio 1.000, scripted recall 0.766 (`analysis/pilot_dryrun.json`); 75/200 PRs needing a skill, 83 instances, 125/67/8 split (`data/labels_v1/judge/batch-*.json`, 40 files); 0/200 exact-path and 32/200 = 16.0% body-path (`analysis/mechanical_labels.json`); 1,200 replays = 200×5 + 80×2 + 40.

**Mismatches — fix these before submission:**

| # | Claim in paper | Artifact says | Where | Severity |
|---|---|---|---|---|
| 1 | "247 of the 248 it attempted came back byte-identical"; Table III "memory files attempted / untouched **248 / 247**" (§I, §VII, §X) | `files: 365`, `untouched: 364`, `untouchedShare: 0.9973`, `reposWithMemory: 201`, `missingCount: 967`, `below1600Bytes: 117` | `analysis/memory_probe.json: outcome` | **High** — headline number, repeated 4×, off by 47% in $n$; 364/365 (99.7%) is the correct pair |
| 2 | "one repository supplies **23** of the 200 PRs" (§V) | 29 (`elastic/terraform-provider-elasticstack`), then 15 (`alfredoperez/speckit-companion`); 29 repos contribute ≥2 PRs | `data/prs_v1/sample.jsonl` (role=analysis) | **High** — understates concentration you are already disclosing; the stale 23 comes from the plan note, which predates the final draw |
| 3 | "all 16 cells populated, **6–17** PRs each" (§V, and the plan) | min **5** (`"1:q2": 5`), max 17 | `data/sample_manifest.json: strata` | Medium — say 5–17 |
| 4 | `analysis/judge_labels.json` is the file the analysis would read, yet all 200 `needed_skill_ids` are `[]` (source field: `out-01.json`) | batch files give 75 needing ≥1, 83 instances | `analysis/judge_labels.json` vs `data/labels_v1/judge/batch-*.json` | **High (artifact)** — the paper is right, its aggregate artifact is stale/partial; regenerate it before an artifact reviewer opens it |
| 5 | Frame says "808 documentation-only" and "420 `SKILL.md`-editing code PRs" (§V, Table II) | `ineligibleDocOnlyPrs: 1228`, `skillEditingPrsRemoved: 469`, `excludedFromFrame: 420` — and 3,566−2,338 = 1,228 | `data/sample_manifest.json: eligibility` | Medium — the paper matches the spec; the manifest's field semantics are wrong (1,228 is the total ineligible, not doc-only). Rename the field or explain the arithmetic in the manifest |
| 6 | "$n\approx172$ … at $n=200$ … power is 0.87" under "80% power" (§V) | 172 is the 90%-power figure; 80% gives ~124; the formula at $n=200$ gives ≈0.94 | §V arithmetic (M2) | **High** — internal inconsistency on a named review criterion |
| 7 | 4 bibitems never cited (`llmlingua`, `inozemtseva`, `gousios`, `ernst`) | 10 cited keys, 14 bibitems | `paper/main.tex` | Medium — IEEE style; also wastes a third of a page you may want for text |
| 8 | "the 21 repositories with 500 or more skills are reported separately" (§IX) | no committed artifact contains this count; not reproducible from the repo | — | Low–Medium — either add the query/artifact or drop the specific number |
| 9 | "documentation-only PRs … (median 7 changed files against 27)" (§V); "1,877,981 distinct" and "13.08 GB ≈ 3.27B tokens" (§I) | no committed artifact carries changed-file counts; `analysis/skill_counts.json` has repository and skill totals but no distinct-skill count; 13.08 GB and 3.27B exist only in `RESEARCH_PLAN.md` | — | Low — prose-anchored numbers. Either commit the query outputs or mark them as release-report figures. The 27 matters most, because §2/M1's dilution argument depends on it |

---

## 7. Editorial decision

**Decision: Major Revision — repairable before the deadline; three items would flip it to Accept.**

Per the decision standards used here, a decision-bearing failure is not cancelled by strengths elsewhere, and the panel is not unanimous (Journal-Fit: minor, Domain: minor, Perspective: minor, Methodology: major, Devil's Advocate: major). The majority-minority split is real and I am not averaging it away: fit, domain and open-science readiness are in good shape, and the objections are concentrated in **estimand sharpness** (M1, M3) and **artifact↔report agreement** (M2, P1, P2, §6 items 1–5). All of those are text and one-query fixes, not new data collection — which is why this is a Major Revision that is achievable in two days rather than a Reject.

**What would make me recommend Accept on resubmission:** (i) primary estimand and power analysis consistent (M1 + M2), (ii) H3 power statement and H2's exercised $n$ stated (M3 + Devil's-Advocate 4), (iii) prereg re-frozen to include the $r=0.65$ pruner with updated hashes (P2), (iv) the nine audit items in §6 corrected, (v) placeholders and uncited references gone.

---

## 8. Revision roadmap, ordered by expected acceptance gain per remaining day

| Rank | Change | Effort | Why it moves the decision |
|---|---|---|---|
| 1 | Make the primary outcome the **binary activation hit** on labelled PRs (or justify $\Delta$ at composite scale), and state $1/(1+M)$ weighting explicitly | 2–4 h (mostly rewriting §III/§IV/§V and re-deriving $n$) | Removes the one objection that could sink the submission outright: as written, the study can return "equivalence" after total activation failure |
| 2 | Reconcile the power paragraph: one convention, arithmetic shown, achieved power at $n=200$ from that same formula | 30 min | The CFP names the power analysis; an internal inconsistency there is read as inattention |
| 3 | Re-freeze `prereg/activation-plan.json` with the pruner at $r=0.65$; regenerate the self-hash and sidecar; update the hashes quoted in `REPRODUCE.md` | 30 min (mechanical; I can do it) | Closes the "artifact does not match the report that claims to *be* the prereg" gap — cheap, and reviewers do check |
| 4 | Fix the audit items (§6), especially memory 365/364, 29 PRs from one repo, strata 5–17 | 1–2 h | Credibility: two of these are numbers a reviewer can check in ten seconds against your own artifact |
| 5 | Add H3 power statement (minimum detectable degradation at 40 PRs) | 30 min | The positive control is the linchpin of the equivalence claim; right now its sensitivity is asserted |
| 6 | Report the distribution of candidate-set size over the 200 PRs and H2's exercised $n$ | 1 h query + 2 sentences | Turns H2 from an unpowered second hypothesis into a bounded one |
| 7 | Commit the judge calibration set to run before the grid, with statistic and fallback rule | 45 min of text (run it later) | Removes the "judge error ≡ activation loss" confound |
| 8 | Fix the reproducibility-screen/frozen-sample contradiction; name the replacement rule | 20 min | Small, but it touches the sample's integrity on its face |
| 9 | Add the missing citation for the 86-task caveman evaluation; cite or cut the four uncited bibitems | 20 min | Cheap desk-check hygiene; also frees space |
| 10 | Fix title grammar ("Shrinks"), fill author affiliation/email, add the description-fixed clause in §I | 10 min | First impression; the placeholders are currently printed in the PDF |

---

## 9. One-paragraph summary for the author

You have a submission that a Stage 1 panel will take seriously: the population is mined, the frame is reported in full, the manipulation is specified to reimplementation detail, the contract's own false negative is documented, and the interpretation of a failed positive control is pre-committed. What will cost you a decision is not sloppiness but a gap between the estimand and the power analysis: the registered gold set gives the activation event ~3.6% weight, so a $\pm10$ pp equivalence verdict is nearly guaranteed even if every skill load vanished — and the $n=172$ power calculation is the formula for the binary activation outcome you did not register as primary. Fix the estimand, reconcile the power paragraph, re-freeze the plan with the pruner, and correct the nine checkable numbers; the rest is polish.
