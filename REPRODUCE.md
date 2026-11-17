# Reproduce

## Frozen preregistration

`prereg/activation-plan.json` fixes the hypotheses, margin (Δ = 0.10), α = 0.05, n = 200, seed
`20261223`, the grid (200 × 5 + 80 × 2 + 40 = 1,200 replays), the exclusion list, and the recall
definition. The runner refuses to start without it (`assertPrereg`).

- self-hash: `dd63fd9b2fc5d0b34cacdc116500478a1a243869b2abe28644cda1733e8b73f1`
- file hash (sidecar `prereg/activation-plan.json.sha256`):
  `a9309b7caa486fb439ec15b3f7cefb23caec3d62f79619e7328c3a259044178a` — verify with
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
