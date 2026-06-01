# Phase 1 Data Model: DLMM Position Simulator

Domain entities for `src/simulator/types.ts`, derived from the spec's Key
Entities and the resolved research decisions. All money/amount fields are typed
explicitly; where a value can be absent, it is `T | null` (never silently `0`)
so "missing" is distinguishable from "zero" (FR-010). Token amounts are kept in
both raw (token base units, integer string) and decimal/USD forms where the
source provides them. The core treats these as plain immutable values; no class
hierarchy.

## Conventions

- **Determinism**: every entity is a plain serializable value; no `Date.now()`,
  no randomness. Timestamps are unix seconds carried from inputs.
- **Bin geometry**: `binId` is an integer; `price(binId) = (1 + binStep/10_000)^binId`.
- **Fidelity**: any computed figure that depends on an estimated share or
  bucketed data carries enough provenance to populate `FidelityNote`.

## Entity: PoolState

The pool's window-relevant state (spec: *Pool State*). Sourced from
`GET /pools/{address}` + the time-series endpoints.

| Field | Type | Notes |
|-------|------|-------|
| `address` | `string` | Base58 pool address (config `SIM_POOL`). |
| `name` | `string` | Pair name (e.g. `SOL-USDC`). |
| `binStep` | `number` | Int, from `pool_config.bin_step`; defines bin geometry. |
| `baseFeePct` | `number` | From `pool_config.base_fee_pct` (fraction or %, normalized on ingest). |
| `dynamicFeePct` | `number` | `dynamic_fee_pct`; effective fee rate when present. |
| `collectFeeMode` | `number` | `pool_config.collect_fee_mode`. |
| `tokenX` / `tokenY` | `TokenRef` | `{ address, symbol, decimals, priceUsd }` from `token_x`/`token_y`. |
| `currentPrice` | `number` | `current_price` (token_y per token_x). |
| `currentActiveBinId` | `number` | Derived from `currentPrice` via `priceToBinId`. |
| `tvlUsd` | `number` | `tvl`; used by the Tier-A liquidity-share estimate. |

**Validation**: `binStep > 0`; `tokenX.decimals`/`tokenY.decimals` ≥ 0;
`currentPrice > 0`. A missing `pool_config` or `current_price` → fail-distinct
(cannot build geometry).

## Entity: WindowTimeline

The materialized, aligned price-and-fee path over the simulation window — the
sole time-varying input to the pure fee model (research Decisions 2–3).

| Field | Type | Notes |
|-------|------|-------|
| `start` / `end` | `number` | Unix seconds (config `SIM_START`/`SIM_END`). |
| `timeframe` | `TimeFrame` | One of `5m 30m 1h 2h 4h 12h 24h` (config `SIM_TIMEFRAME`). |
| `buckets` | `WindowBucket[]` | One per candle/volume bucket, time-ordered. |
| `complete` | `boolean` | `false` if OHLCV/volume coverage has gaps for `[start,end]`. |

### WindowBucket

| Field | Type | Notes |
|-------|------|-------|
| `timestamp` | `number` | Bucket start, unix seconds. |
| `open`/`high`/`low`/`close` | `number` | OHLCV price (token_y per token_x). |
| `volumeUsd` | `number` | `volume/history.volume` for the bucket. |
| `feesUsd` | `number \| null` | `volume/history.fees`; `null` if the source omits it (then derive from `volume × feeRate`, flagged). |
| `activeBinLow`/`activeBinHigh` | `number` | Bin ids for `low`/`high` (the traversed span). |

**Validation**: prices `> 0`; `low ≤ open,close ≤ high`; buckets strictly
increasing in `timestamp`. Empty `buckets` over a non-empty window with no data →
`complete = false` (could-not-compute, not zero fees).

## Entity: Position

A simulated liquidity position (spec: *Position*).

| Field | Type | Notes |
|-------|------|-------|
| `pool` | `string` | Pool address. |
| `status` | `"open" \| "closed"` | Lifecycle status. |
| `binLower` / `binUpper` | `number` | Inclusive bin range `[L,U]`, `L ≤ U`. |
| `shape` | `"spot" \| "curve" \| "bid_ask"` | Liquidity-distribution shape (FR-001). |
| `deposit` | `TokenAmounts` | Originally deposited `{ x, y }` in token units + USD at open. |
| `binLiquidity` | `BinLiquidity[]` | Per-bin liquidity `L(bin)` from `distributeLiquidity(shape, deposit)`. |
| `unclaimedFees` | `TokenAmounts` | Accrued, not-yet-claimed fees. |
| `realizedFees` | `TokenAmounts` | Claimed fees. |
| `openedAt` / `closedAt` | `number \| null` | Unix seconds. |

**Derived invariant**: `earnedFees = realizedFees + unclaimedFees` holds after
every operation (SC-009).

**Validation (open)**: deposit `> 0` in at least one token; `binLower ≤ binUpper`;
range non-empty. Zero deposit / inverted / empty range → **rejected at open**
(FR-001, SC-005), never an `Infinity`/`NaN` downstream.

### BinLiquidity

| Field | Type | Notes |
|-------|------|-------|
| `binId` | `number` | Bin id. |
| `liquidity` | `number` | Position's liquidity units `Lpos(bin)` (shape-distributed). |
| `amountX` / `amountY` | `number` | Token composition this bin holds at its price. |

## Entity: Operation

A single lifecycle action and its resulting state (spec: *Operation*); the
ordered list is the auditable history (US3 #3).

| Field | Type | Notes |
|-------|------|-------|
| `seq` | `number` | 0-based order index. |
| `type` | `"open" \| "accrue" \| "claim" \| "mark" \| "close"` | Action. |
| `at` | `number` | Unix seconds (input-driven, deterministic). |
| `inputs` | object | Action-specific (e.g. accrue: window slice; mark: price). |
| `result` | object | Action effect (e.g. accrue: fees added; claim: amount realized; close: returned token amounts). |
| `stateAfter` | `PositionSnapshot` | `{ status, unclaimedFees, realizedFees, earnedFees }` post-op. |

## Entity: FeeBreakdown

The traceable decomposition behind the fee figure (US1 #3, SC-007). Output of
`attributeFees`.

| Field | Type | Notes |
|-------|------|-------|
| `totalFees` | `TokenAmounts` | Position fees over the window. |
| `perBin` | `BinFeeContribution[]` | `{ binId, routedVolumeUsd, liquidityShare, feesUsd }`. |
| `bucketsCounted` | `number` | Buckets where the active bin overlapped `[L,U]`. |
| `bucketsOutOfRange` | `number` | Buckets fully outside `[L,U]` (zero contribution, FR-003). |

## Entity: Valuation

Output of `valuation.ts` (FR-007, US4).

| Field | Type | Notes |
|-------|------|-------|
| `markPrice` | `number` | Price the position is valued at. |
| `positionValueUsd` | `number` | Value of current token composition at `markPrice`. |
| `holdValueUsd` | `number` | Value of the original deposit held instead. |
| `impermanentLossUsd` | `number` | `holdValue − positionValue` (≥ 0 typical; 0 if price flat). |
| `earnedFeesUsd` | `number` | From `FeeBreakdown.totalFees` in USD. |
| `netPnlUsd` | `number` | `earnedFees − impermanentLoss`. |

## Entity: FidelityNote

States how much to trust a result (FR-015). Always present on a result.

| Field | Type | Notes |
|-------|------|-------|
| `priceGranularity` | `TimeFrame` | Bucket size of the price path. |
| `volumeBasis` | `"reported_fees" \| "volume_times_rate"` | Whether `feesUsd` came from the source or was derived. |
| `liquiditySource` | `"aggregated" \| "snapshot"` | Tier A or B (research Decision 4). |
| `liquidityCaveat` | `string` | Human note, e.g. "current bin snapshot applied to historical window". |
| `complete` | `boolean` | Mirrors `WindowTimeline.complete`. |

## Entity: ObservedPosition

Verification ground truth from `GET /positions/{pool}/pnl` (+ historical events).

| Field | Type | Notes |
|-------|------|-------|
| `positionAddress` | `string` | From `PositionPnLData.positionAddress`. |
| `binLower` / `binUpper` | `number` | `lowerBinId` / `upperBinId`. |
| `openedAt` / `closedAt` | `number \| null` | `createdAt` / `closedAt`. |
| `observedFeesUsd` | `number \| null` | From `allTimeFees.total`; `null` ⇒ could-not-verify. |
| `depositX` / `depositY` | `number \| null` | Reconstructed from `add` events (`/positions/{addr}/historical`). |
| `isClosed` | `boolean` | `PositionPnLData.isClosed`. |

## Entity: VerificationOutcome

Comparison of simulated vs observed (spec: *Verification Outcome*; FR-008/009/010).

| Field | Type | Notes |
|-------|------|-------|
| `mode` | `"historical" \| "live"` | Which reconciliation was run. |
| `simulatedFeesUsd` | `number` | Simulator's figure for the matched config. |
| `observedFeesUsd` | `number \| null` | Ground-truth figure; `null` ⇒ `could_not_verify`. |
| `absDiffUsd` | `number \| null` | `\|simulated − observed\|`. |
| `relDiff` | `number \| null` | `absDiff / max(observed, ε)`. |
| `tolerance` | `number` | Applied relative tolerance (`SIM_TOLERANCE`). |
| `status` | `"pass" \| "fail" \| "could_not_verify"` | `pass` iff `relDiff ≤ tolerance`; `could_not_verify` if `observed` is null/missing data. |
| `note` | `string` | Direction/magnitude of any breach (US2). |

## Entity: SimulationResult (top-level output, FR-013)

The structured, machine-readable run output handed to later pipeline parts.

| Field | Type | Notes |
|-------|------|-------|
| `schemaVersion` | `string` | e.g. `"1.0.0"`. |
| `generatedAt` | `number` | Unix seconds (CLI shell, not core). |
| `config` | object | Echo of resolved `SimulationConfig` (pool, range, shape, deposit, window, tolerance, network, liquiditySource). |
| `pool` | `PoolState` | Pool state used. |
| `window` | `{ start, end, timeframe, bucketCount, complete }` | Window summary. |
| `position` | `Position` | Final position (with per-bin liquidity). |
| `operations` | `Operation[]` | Ordered lifecycle history. |
| `fees` | `FeeBreakdown` | Traceable fee decomposition. |
| `valuation` | `Valuation \| null` | PnL block (null if not requested). |
| `verification` | `VerificationOutcome \| null` | Present when verification was requested. |
| `fidelity` | `FidelityNote` | How to trust the figures. |
| `status` | `"ok" \| "could_not_compute"` | `could_not_compute` ⇒ figures are absent/partial by design (FR-010). |

## Shared value types

- `TokenRef = { address: string; symbol: string; decimals: number; priceUsd: number }`
- `TokenAmounts = { x: number; y: number; usd: number }` (decimal token units + USD)
- `PoolLiquiditySource = (binId: number, ctx: { pool: PoolState; window: WindowTimeline }) => number`
  — injected; returns `Lpool(bin)` (the share denominator). Tier A = TVL-spread
  estimate; Tier B = SDK bin-snapshot lookup. Keeps `fees.ts` pure.

## State transitions (Position lifecycle)

```
            open
              │   (validate deposit>0, L≤U; reject otherwise)
              ▼
          ┌────────┐  accrue(windowSlice)   ┌────────┐
          │  open  │ ─────────────────────▶ │  open  │  (unclaimedFees += accrued)
          │        │  claim                 │        │  (realized += unclaimed; unclaimed = 0; no-op if 0)
          │        │  mark(price)           │        │  (read-only valuation)
          └────────┘                        └────────┘
              │ close
              ▼
          ┌────────┐
          │ closed │  accrue/claim/close → rejected error (edge case)
          └────────┘
```

Conservation: at every transition `earnedFees = realizedFees + unclaimedFees`
(SC-009). `close` records returned token amounts at the closing price and sets
`status = closed`, `closedAt`.
