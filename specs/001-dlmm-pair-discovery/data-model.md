# Phase 1 Data Model: DLMM Pair Discovery & Screening

Derived from the spec's Key Entities and the pinned Meteora types
(`src/generated/meteora-api.d.ts`). These are the in-process domain types for
`src/discovery/`; field formats trace to `PaginationResponse_PoolResponse.data[]`.

## Enumerations

```text
MeasurementWindow = "30m" | "1h" | "2h" | "4h" | "12h" | "24h"   # keys of TimeWindowData
Indicator         = "fee_to_tvl" | "volume_to_tvl"               # FR-004 selectable ranking signal
Network           = "mainnet" | "devnet"                          # Principle V (unambiguous)
IneligibilityReason = "missing_or_zero_tvl" | "missing_fee_data"
                    | "missing_volume_data" | "below_min_tvl"
                    | "below_min_volume" | "blacklisted"
```

## Entity: PoolRow  *(raw, from I/O edge — fetch-pools.ts)*

A normalized projection of one API pool row; the only data crossing from the
network edge into the pure core. Numeric API fields are `Format: double`.

| Field | Type | Source | Notes |
|-------|------|--------|-------|
| `address` | string | `data[].address` | Pool identifier (Solana pubkey). Unique key. |
| `name` | string | `data[].name` | e.g. `"USDC-USDT"`. |
| `tokenX` | `{ symbol, address, decimals }` | `data[].token_x` | from `TokenMetrics`. |
| `tokenY` | `{ symbol, address, decimals }` | `data[].token_y` | from `TokenMetrics`. |
| `binStep` | number | `data[].pool_config.bin_step` | distinguishes same-pair pools. |
| `baseFeePct` | number | `data[].pool_config.base_fee_pct` | fee tier. |
| `tvl` | number | `data[].tvl` | USD Total Value Locked. |
| `fees` | `TimeWindowData` | `data[].fees` | USD fees per window. |
| `volume` | `TimeWindowData` | `data[].volume` | USD volume per window. |
| `apiFeeTvlRatio` | `TimeWindowData` | `data[].fee_tvl_ratio` | diagnostic cross-check only. |
| `createdAt` | number (unix s) | `data[].created_at` | for newly-created-pool flag. |
| `isBlacklisted` | boolean | `data[].is_blacklisted` | eligibility input. |

**Validation at the edge**: a field that is `null`/`undefined`/`NaN` is preserved
as "missing" (not coerced to 0) so the pure core can apply FR-007 correctly.

## Entity: ScreeningCriteria  *(config — config.ts)*

The operator-controlled configuration governing one run (spec: Screening Criteria).

| Field | Type | Default | Rule |
|-------|------|---------|------|
| `window` | MeasurementWindow | `"24h"` | must be a valid window key (else error). |
| `indicator` | Indicator | `"fee_to_tvl"` | ranking signal (FR-003/FR-004). |
| `minTvl` | number ≥ 0 | `0` | exclude `tvl < minTvl` (FR-005). |
| `minVolume` | number ≥ 0 | `0` | exclude `volume[window] < minVolume` (FR-005). |
| `topN` | number > 0 \| null | `null` | optional cap on candidates returned. |
| `sortDirection` | `"desc"` \| `"asc"` | `"desc"` | default descending (FR-003). |
| `network` | Network | `"mainnet"` | Principle V — unambiguous at runtime. |
| `baseUrl` | string | client default | data-source endpoint (FR-011). |
| `output` | string \| null | `null` (stdout) | JSON output path. |
| `newPoolMaxAgeSec` | number | `86400` | younger ⇒ flag `isNewPool` (Edge Cases). |

**Validation**: unknown window/indicator/network → reject; negative thresholds →
reject. Validation failure aborts before any fetch (fail-closed).

## Entity: CandidatePair  *(computed, pure — screen.ts)*

A pool that passed all eligibility thresholds, enriched with computed indicators
and its rank.

| Field | Type | Derivation |
|-------|------|------------|
| `rank` | number (1-based) | position after deterministic sort. |
| `address` | string | from PoolRow. |
| `name` | string | from PoolRow. |
| `pair` | `{ tokenX, tokenY }` | symbols + mints from PoolRow. |
| `binStep` | number | from PoolRow. |
| `tvl` | number | from PoolRow. |
| `fees` | number | `PoolRow.fees[window]`. |
| `volume` | number | `PoolRow.volume[window]`. |
| `window` | MeasurementWindow | echoed from criteria. |
| `feeToTvl` | number (finite) | `fees / tvl` — guaranteed finite (Decision 4). |
| `volumeToTvl` | number (finite) | `volume / tvl`. |
| `rankingScore` | number | the selected indicator's value (sort key). |
| `isNewPool` | boolean | `now - createdAt < newPoolMaxAgeSec`. |

**Invariant**: `feeToTvl` and `volumeToTvl` are always finite real numbers
(never `Infinity`/`NaN`) — enforced because zero/missing-TVL pools never become
CandidatePairs (they are routed to `ineligible`). Satisfies SC-003.

## Entity: IneligiblePool  *(computed, pure)*

| Field | Type | Notes |
|-------|------|-------|
| `address` | string | from PoolRow. |
| `name` | string | from PoolRow. |
| `reason` | IneligibilityReason | first failing rule (deterministic order). |
| `tvl` | number \| null | observed value (null if missing) for traceability. |

## Entity: ScreeningResult  *(output — the run artifact)*

The timestamped, ordered output of one run plus the criteria used (spec:
Screening Result). Serialized per `contracts/screening-result.schema.json`.

| Field | Type | Notes |
|-------|------|-------|
| `generatedAt` | string (ISO 8601 UTC) | run timestamp. Excluded from determinism comparison of the candidate *set/order*. |
| `criteria` | ScreeningCriteria | exact parameters used (traceability, US1 #3). |
| `poolUniverseCount` | number | total pools fetched (completeness check). |
| `candidates` | CandidatePair[] | ranked, length ≤ `topN` if set. |
| `ineligible` | IneligiblePool[] | excluded pools + reasons (not silently dropped). |
| `status` | `"complete"` | only emitted on a full, successful scan (FR-012). |

> A failed/incomplete data retrieval emits **no** ScreeningResult at all; the CLI
> exits non-zero (SC-008). There is no `"partial"` status by design.

## Relationships & Lifecycle

```text
ScreeningCriteria ──drives──▶ fetch-pools ──▶ PoolRow[] (universe)
                                                  │
                          indicators + eligibility (pure)
                                                  ├──▶ CandidatePair[]  (eligible, ranked)
                                                  └──▶ IneligiblePool[] (excluded + reason)
                                                  │
                                            ScreeningResult ──▶ format ──▶ JSON file / stdout / table
```

State transition for a pool within a run:
`fetched → (eligibility check) → eligible→ranked  |  ineligible→reasoned`.
No persisted state; each run is independent and idempotent over fixed input
(determinism, FR-009).
