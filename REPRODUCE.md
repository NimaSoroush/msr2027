# Reproduce

## Frozen preregistration

`prereg/activation-plan.json` fixes the hypotheses, margin (Δ = 0.10), α = 0.05, n = 200, seed
`20261223`, the grid (200 × 5 + 80 × 2 + 40 = 1,200 replays), the frame (2,338 code PRs that do not
add or edit a `SKILL.md`), the label rule (LLM judge primary, mechanical signals never gate), the
exclusion list, and the recall definition. The runner refuses to start without it (`assertPrereg`).

- self-hash: `6391538bcf7e5da5f1c75134fa7603a0117a17de8cc67721e7b5b62639b7afcd`
- file hash (sidecar `prereg/activation-plan.json.sha256`):
  `0f11f0c4b0c1ce9a487909cbec3da55811bdf3195944cfd3157e1fd3c7dc9395` — verify with
  `shasum -a 256 prereg/activation-plan.json`
- self-hash rule: SHA-256 of the file's bytes with the `sha256` value replaced by 64 zeros; the
  sidecar is the SHA-256 of the file as committed. Editing the plan after the freeze fails both
  checks.

## Compressor probes

Both need the pinned binary: `CAVEMAN_BIN=/tmp/caveman-engine CAVEMAN_TAG=v4.1.0
CAVEMAN_SHA256=23d1ffaedc849cd7035d6e2659fdb49f60d919027b8f0061379c697b6a5c25c2`.

```
node scripts/compression-probe.ts --repos --limit 5000 --out analysis/compression_all_skills.json
node scripts/memory-probe.ts
```

The first writes the all-skills measurement (3,135/3,150 untouched, 15 changed, 14 contract
violations); the second writes `analysis/memory_probe.json`.

## Smoke checks

```
node scripts/material-smoke.ts "timcsy/ai-api#1"   # needs GITHUB_TOKEN in .env
node scripts/replay-smoke.ts
```

## Tests

```
npx vitest run
npx tsc --noEmit
```
