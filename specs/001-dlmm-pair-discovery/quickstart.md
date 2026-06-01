# Quickstart: DLMM Pair Discovery & Screening

Run the read-only screener and get a ranked, fee-efficient DLMM candidate list.

## Prerequisites

- Node.js + the repo dependencies installed (`npm install`).
- Network access to the Meteora API (`https://dlmm.datapi.meteora.ag`). The
  screener is **read-only** — no wallet, key, or signing is involved.

## 1. Run with defaults (fee-to-TVL, trailing 24h)

```bash
npm run screen
```

- Prints a ranked **JSON** `ScreeningResult` to stdout.
- Prints a human-readable ranked **table** to stderr.
- Default ranking: `fee_to_tvl` over the `24h` window, descending, no thresholds.

> **Piping stdout?** Run `npm run --silent screen > out.json` so npm's run banner
> stays off stdout, or use `SCREEN_OUTPUT=<path>` (section 4) for clean file output.

## 2. Filter out dust and pick a window (US2 / FR-005)

```bash
SCREEN_MIN_TVL=10000 SCREEN_MIN_VOLUME=50000 SCREEN_WINDOW=1h npm run screen
```

Every returned candidate satisfies `tvl >= 10000` **and** `volume[1h] >= 50000`.
Sub-threshold pools appear under `ineligible` with a reason — never in
`candidates` (SC-002).

## 3. Switch the ranking indicator (FR-004)

```bash
SCREEN_INDICATOR=volume_to_tvl SCREEN_TOP_N=20 npm run screen
```

Ranks by volume-to-TVL and returns the top 20.

## 4. Save the candidate list for hand-off to Part 2 (US3 / FR-008)

```bash
SCREEN_OUTPUT=./out/candidates.json npm run screen
```

Writes a structured `ScreeningResult` (see
[`contracts/screening-result.schema.json`](./contracts/screening-result.schema.json))
to the file. The same inputs always produce the same `candidates`/`ineligible`
arrays (determinism, SC-005) — only `generatedAt` changes.

## 5. Interpret exit codes (fail-closed; SC-008)

| Exit | Meaning | Action |
|------|---------|--------|
| `0` | Full scan completed; valid result emitted (may be empty). | Use the JSON. |
| `2` | Invalid configuration. | Fix the env var named in the error. |
| `3` | Data source unavailable / incomplete scan. | **No** result was emitted — retry; do not trust any prior partial output. |

## Validation checklist (maps to Success Criteria)

- [ ] **SC-001**: `npm run screen` yields a ranked list in one command, no code edits.
- [ ] **SC-002**: With thresholds set, no candidate is below any threshold.
- [ ] **SC-003**: No `feeToTvl`/`volumeToTvl` is `Infinity`/`NaN`; zero/missing-TVL
      pools appear only under `ineligible`.
- [ ] **SC-004**: Spot-check a row: `feeToTvl == fees / tvl` to full precision.
- [ ] **SC-005**: Run twice on unchanged data → identical `candidates` ordering.
- [ ] **SC-006**: Change `SCREEN_MIN_TVL` or `SCREEN_INDICATOR` → result changes,
      no code edit.
- [ ] **SC-007**: Full scan completes within 60 s under normal API availability.
- [ ] **SC-008**: Simulate an unreachable endpoint (`METEORA_BASE_URL` to a bad
      host) → exit `3`, no candidate list printed.

## Running the unit tests (financial core; Principle IV)

```bash
node --import tsx --test tests/unit/*.test.ts
```

Covers normal, boundary, and degenerate inputs: zero/missing TVL, missing
fee/volume data, dust pools, tie-breaking, and determinism.
