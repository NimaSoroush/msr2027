# Reproduce

## Frozen preregistration

`prereg/activation-plan.json` fixes the hypotheses, margin (Δ = 0.10), α = 0.05, n = 200, seed
`20261223`, the grid (200 × 5 + 80 × 2 + 40 = 1,200 replays), the frame (2,338 code PRs that do not
add or edit a `SKILL.md`), the label rule (LLM judge primary, mechanical signals never gate), the
exclusion list, and the recall definition. The runner refuses to start without it (`assertPrereg`).

- self-hash: `d1ed0fbdb35bcc5b5288f41b02ed5ebd027866855743b32f199bb095af667cb4`
- file hash (sidecar `prereg/activation-plan.json.sha256`):
  `387179fa5862667aed1ec02e998d092d99724b3a9e2a4506125a9b4567a8b2e6` — verify with
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
