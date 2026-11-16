# Abstract — MSR 2027 Registered Reports

**Title:** Compressed Instructions, Intact Descriptions: Skill Activation Under Caveman-Style Compression
**Track:** MSR 2027 Registered Reports (Stage 1 abstract, 13 Nov 2026)
**Type:** Exploratory, framed as an equivalence test
**Compressor:** caveman (`/caveman-compress`), bodies and ambient files only; skill descriptions untouched
**Word count:** 228

**Background/Context.** Context-compression tools are widely adopted to cut agent cost. Caveman's
`/caveman-compress` rewrites skill bodies and memory files into telegraphic prose, preserving code,
identifiers and YAML frontmatter, and reports roughly a third off input tokens on its own fixtures.
Elsewhere, compressing agent instructions is known to break tool use at aggressive ratios, but that
evidence comes from constructed control contexts compressed to 35–50% of their tokens, not from real
repositories at the ratios such tools achieve. Whether it changes what agents invoke remains
unmeasured.

**Objective/Aim.** We investigate whether enabling caveman-compress changes skill and tool activation
in real repositories: which skills load, and whether the tools they name are still called.
Descriptions stay byte-identical, isolating the body channel; because prior work shows bodies also
contribute to routing, we measure selection both from descriptions alone and from full skill text. As
existing evidence suggests effects at realistic ratios are small, we frame the study as an equivalence
test with a pre-specified margin.

**Method.** Skills come from the July 2026 GitSkills release (3.8M `SKILL.md` occurrences across 282K
public repositories); merged pull requests come from the July 2026 SpecMine corpus, restricted to
repositories that also carry skills in GitSkills and where several skills compete. Each is replayed as
an agent task uncompressed, recording skill loads and tool calls, then replayed with caveman-compress
applied to skill bodies and memory files. Activation is compared within pull request.

---

## Positioning notes (not part of the submitted abstract)

- **CompressAgent** ("Control Under Compression", arXiv 2608.01056) compresses agent control contexts
  on constructed benchmarks: reliable to 75% retained context, collapsing by 35% (19.9% success vs
  93.8% baseline), with failures surfacing as tool-execution errors. This study differs on setting
  (real repositories, replayed PRs), artefact (third-party skills with a description/body split), and
  outcome (activation rather than task success).
- **SkillRouter** (Zheng et al., 2026) finds name-plus-description routing loses 31–44% accuracy
  against full skill text, so bodies carry routing signal. This is why the design measures selection
  under both description-only and full-text harnesses instead of assuming descriptions freeze routing.
- **JetBrains' caveman evaluation** (86 SkillsBench tasks, 82 paired, forced activation) measured 8.5%
  output savings against a 65% claim, with quality statistically flat (sign test p = 0.82). It tested
  the response skill, not `/caveman-compress`, and did not measure activation — hence the equivalence
  framing and the pre-specified margin.
- **SkillReducer** (arXiv 2603.29919) compresses skill descriptions and bodies with structure-aware
  methods; general-purpose user-installed compression remains a distinct treatment.
