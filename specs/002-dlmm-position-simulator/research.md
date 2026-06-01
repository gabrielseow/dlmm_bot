# Phase 0 Research: DLMM Position Simulator

All Technical Context items resolved; no NEEDS CLARIFICATION remain. The spec,
constitution, existing Part 1 codebase, and the pinned Meteora OpenAPI spec
(`spec/meteora-api.json` → `src/generated/meteora-api.d.ts`) determine the
choices below. The central question this part must answer — *how do we attribute
a single position's fees from the data the API actually exposes, and how do we
prove the number is right?* — is resolved in Decisions 2–4 and 7.

## Decision 1 — Data sources & endpoints (all via the pinned typed client)

- **Decision**: Source every input through `meteoraApi.GET(...)`:
  - `GET /pools/{address}` → `PoolResponse`: `current_price`, `pool_config`
    (`bin_step`, `base_fee_pct`, `max_fee_pct`, `protocol_fee_pct`,
    `collect_fee_mode`), `dynamic_fee_pct`, `tvl`, `token_x`/`token_y`
    (decimals, price), `token_x_amount`/`token_y_amount`. Anchors the pool's bin
    geometry and current state.
  - `GET /pools/{address}/ohlcv?timeframe&start_time&end_time` →
    `TimeseriesResponse_OHLCVResponse`: the **price path** (open/high/low/close
    per bucket). Drives which bin is active over the window.
  - `GET /pools/{address}/volume/history?timeframe&start_time&end_time` →
    `TimeseriesResponse_VolumeHistoryResponse`: per-bucket `volume`, `fees`,
    `protocol_fees`. The **total pool fees per bucket** the position competes
    for.
  - `GET /positions/{pool_address}/pnl?user&status` →
    `GetPoolPositionPnLResponse` (`PositionPnLData[]`): real positions'
    `allTimeFees`, `lowerBinId`, `upperBinId`, `allTimeDeposits`,
    `createdAt`/`closedAt`, `pnlUsd` — the **verification ground truth**.
  - `GET /positions/{address}/historical` → `PositionEvent[]`
    (`add`/`remove`/`claim_fee`/`claim_reward`, amounts, `blockTime`) — used to
    reconstruct a real position's deposit and window for verification.
- **Rationale**: One typed client, honoring Principle II (no untyped `fetch`).
  These endpoints jointly supply price path + pool fees (to simulate) and real
  position fees (to verify). Both `/ohlcv` and `/volume/history` accept the same
  `timeframe` + `[start_time, end_time]` range, so the simulation window maps
  directly onto API queries.
- **Alternatives considered**:
  - *Per-pool windowed `fees`/`volume` `TimeWindowData` only* (`30m`…`24h`):
    rejected as the fee driver — fixed trailing windows can't be aligned to an
    arbitrary historical `[start, end]`; the time-series endpoints can.
  - *Reconstruct swaps from raw chain history*: rejected — far heavier, needs an
    indexer, and the API already aggregates volume/fees per bucket.

## Decision 2 — Fee model: per-bucket, per-bin attribution

- **Decision**: Model the position's fees as a sum over the window's time
  buckets and over the bins the position covers:

  ```
  positionFees = Σ_buckets Σ_{bin ∈ activeBins(bucket) ∩ [L,U]}
                    bucketFees(bucket) · volumeShareOfBin(bin, bucket)
                                       · liquidityShare(position, bin, bucket)
  ```

  - `[L,U]` = the position's bin range, from `rangeToBins(priceRange, bin_step)`.
  - `activeBins(bucket)` = the bins the price traversed within the bucket,
    derived from the OHLCV `[low, high]` mapped to bin ids (a single bin when the
    bucket's price is flat; a contiguous span when it moved).
  - `bucketFees` = `volume/history.fees` for that bucket (already
    fee-rate-applied by the source); when only `volume` is trusted, fall back to
    `volume · feeRate` using `pool_config` (documented in the fidelity note).
  - `volumeShareOfBin` distributes the bucket's traded volume across the bins it
    traversed (uniform across the traversed span by default — see Decision 3).
  - `liquidityShare(position, bin)` = `Lpos(bin) / (Lpos(bin) + Lpool(bin))` —
    the position's fraction of liquidity in that bin (Decision 4).
- **Rationale**: This is the literal DLMM fee mechanic (only the active bin earns,
  pro-rata by in-bin liquidity), expressed at the granularity the API exposes
  (buckets, not individual swaps). Encodes FR-002 (fees as a function of in-bin
  liquidity share × routed volume) and FR-003 (zero accrual when the active bin
  is outside `[L,U]`). It is a pure function of injected window data and a share
  function, satisfying Principle IV.
- **Alternatives considered**:
  - *Pool-level proportional split* (positionFees = poolFees × positionTVL /
    poolTVL): rejected — ignores bin range entirely, so US1 #2 (narrower range
    capturing more price action earns proportionally more) cannot hold and FR-003
    is violated.

## Decision 3 — Price path & active-bin derivation from OHLCV

- **Decision**: Convert prices to bin ids with the DLMM geometric law
  `binId = floor( ln(price) / ln(1 + bin_step/10_000) )` and its inverse
  `price(binId) = (1 + bin_step/10_000)^binId`, implemented as pure functions in
  `bins.ts`. Per bucket, derive the traversed bin span from `[low, high]`; treat
  the bucket's volume as spread uniformly across that span (the default
  `volumeShareOfBin`). A bucket whose entire `[low,high]` lies outside `[L,U]`
  contributes zero to the position.
- **Rationale**: OHLCV is the only historical price signal the API gives; `[low,
  high]` bounds the bins that could have been active during the bucket. Uniform
  spread within the traversed span is the maximum-entropy assumption absent
  per-swap data — and is exactly the kind of granularity limitation FR-015 and
  the "coarse data granularity" edge case require us to **state**, not hide.
- **Alternatives considered**:
  - *Use only `close`* (single active bin per bucket): rejected — understates
    fees for positions straddling intra-bucket movement; `[low,high]` is strictly
    more faithful and still available.
  - *Sub-bucket interpolation / synthetic swap reconstruction*: rejected for now —
    invents precision the data can't support; revisit only if per-swap data
    becomes available.

## Decision 4 — Pool per-bin liquidity (the share denominator) & fidelity tiers

- **Decision**: `liquidityShare` needs `Lpool(bin)` — the competing liquidity in
  each bin — which the **API does not expose historically**. Make it an
  **injected `PoolLiquiditySource`** with two tiers, both surfaced in the result's
  fidelity note:
  - **Tier A — `aggregated` (default, API-only)**: estimate `Lpool(bin)` by
    spreading the pool's current `tvl` across an assumed active span (uniform by
    default), or accept an operator-supplied assumed total. Lowest fidelity;
    flagged as "share estimated from aggregate TVL, not per-bin reserves."
  - **Tier B — `snapshot` (optional, on-chain)**: read **current** per-bin
    reserves via `@meteora-ag/dlmm` (read-only RPC) and use them as `Lpool(bin)`.
    Higher fidelity for recent/live windows; flagged as "current bin snapshot
    applied to a historical window" when the window is not recent.
  - For **verification against a known real position**, the position's own
    `allTimeFees` is the ground truth (Decision 7); the share assumption is what
    we are testing, so verification reports the residual rather than assuming the
    share is correct.
- **Rationale**: This is the irreducible data gap, and the constitution's answer
  is honesty about fidelity (FR-015, FR-010, SC-008): the share function is a
  documented, swappable seam, and every result states which tier produced it.
  Keeping it injected keeps `fees.ts` pure and testable with deterministic stub
  shares.
- **Alternatives considered**:
  - *Hard-code a competing-liquidity assumption inside the fee math*: rejected —
    buries a critical modeling assumption, breaks Principle IV's I/O isolation,
    and prevents stating fidelity per run.
  - *Block until exact historical per-bin liquidity exists*: rejected — it isn't
    available from the pinned API; the tiered + flagged approach ships a usable,
    honest tool now.

## Decision 5 — Position lifecycle as a pure state machine

- **Decision**: `position.ts` models `open → (accrue | claim | mark)* → close` as
  pure transitions over an immutable `Position` value, each returning a new state
  plus an appended `Operation` log entry. Invariants enforced in code and tests:
  `earnedFees = realizedFees + unclaimedFees` after every op (SC-009); `claim`
  moves `unclaimed → realized` and zeroes unclaimed (FR-005); `claim` with zero
  accrued is a no-op (edge case); `close` reports token amounts at the closing
  price and marks closed; `accrue`/`claim`/`close` on a closed position is
  rejected with a clear error (edge case); `mark` is read-only valuation.
- **Rationale**: Directly satisfies FR-004/005/006 and SC-009, and the pure,
  log-appending design yields the auditable, ordered operation history US3 #3
  requires — all without I/O.
- **Alternatives considered**: *Mutable position object*: rejected — harder to
  test for the conservation invariant and to reproduce deterministically.

## Decision 6 — Valuation, impermanent loss & net PnL

- **Decision**: In `valuation.ts` (pure): `positionValue(price)` = the token_x /
  token_y amounts the position's per-bin liquidity implies at the marking price
  (CLMM bin composition: bins below active price are all token_y, above are all
  token_x, the active bin is mixed), valued via token USD prices.
  `holdValue` = value of the originally deposited amounts at the marking price.
  `impermanentLoss = holdValue − positionValue`; `netPnl = earnedFees −
  impermanentLoss`. IL is exactly zero when price is unchanged (SC, US4 #2).
- **Rationale**: Encodes FR-007 and US4 with each component traceable; pure and
  deterministic. Reuses the same `bins.ts` geometry as the fee model so value and
  fees are mutually consistent.
- **Alternatives considered**: *Take `pnlUsd`/`UnrealizedPnL` straight from the
  API*: rejected as the simulator's own output — that is observed data for
  *verification*, not a substitute for the modeled value we must be able to trace.

## Decision 7 — Verification: historical & live reconciliation

- **Decision**: `verify.ts` (pure) compares a simulated fee figure to an observed
  one and returns a `VerificationOutcome` (`simulated`, `observed`, `absDiff`,
  `relDiff`, `tolerance`, `status` ∈ `pass | fail | could_not_verify`).
  - **Historical**: pick a real position from `GET /positions/{pool}/pnl` (with a
    `createdAt`/`closedAt` window and `lowerBinId`/`upperBinId`); reconstruct its
    deposit from `/positions/{addr}/historical` `add` events; run the simulator
    over the same pool, range, deposit, and `[createdAt, closedAt]` window;
    compare simulated fees to `allTimeFees`.
  - **Live**: same endpoint with `status=open` over a recent window; compare to
    the real position's accrued/claimed fees to date (optionally cross-checked
    against an on-chain read via the SDK).
  - **Could-not-verify**: if OHLCV/volume buckets are missing for the window, or
    no observed fee figure is available, return `could_not_verify` — never a
    silent `pass` (FR-010, SC-008, US2 #3).
- **Rationale**: Directly satisfies FR-008/009/010 and SC-003/004; isolating the
  comparison as a pure function makes pass/fail/could-not-verify deterministic and
  unit-testable.
- **Alternatives considered**: *Reconcile only at the pool aggregate level*:
  rejected — doesn't exercise the per-position model the spec demands verifying.

## Decision 8 — Verification tolerance default

- **Decision**: A single configurable relative tolerance `SIM_TOLERANCE`,
  **default `0.10` (10%)**, defines "match". Documented as reflecting Tier-A
  aggregated-data fidelity (bucket-level volume, uniform intra-bucket spread,
  TVL-based share); operators verifying against a Tier-B snapshot or per-position
  ground truth may tighten it.
- **Rationale**: The spec defers the exact default to planning, bounded by source
  granularity (Assumptions). Bucketed volume + an estimated share cannot justify a
  tight tolerance; 10% is a defensible, configurable starting point that SC-003's
  "≥90% of sampled configs within tolerance" can be measured against and tuned.
- **Alternatives considered**: *Fixed tight tolerance (e.g. 1%)*: rejected —
  guarantees spurious failures given aggregated inputs and would mask the real
  fidelity story.

## Decision 9 — Determinism, degenerate inputs & fail-distinct

- **Decision**: The core takes fully-materialized window data and a share function
  as inputs; no clock, RNG, or network inside calculations (FR-011/SC-006).
  Guards run before any division so no `Infinity`/`NaN`/negative fee can be
  produced (SC-005); zero deposit, empty/inverted range, and zero-volume windows
  yield a zero or rejected result, never a crash. Missing window data aborts with
  a "could not compute" result distinct from a legitimate zero (FR-010/SC-008),
  matching Part 1's fail-closed posture.
- **Rationale**: Encodes the spec's Edge Cases and SC-005/006/008 as core
  contract, tested directly under `tests/unit/`.
- **Alternatives considered**: *Best-effort partial figures*: rejected — same
  reason as Part 1; an operator must never act on a partial figure believed
  complete.

## Decision 10 — Testing toolchain & config surface

- **Decision**: Reuse Part 1's stack: `node:test` + `node:assert` via `tsx`
  (`npm test`), no new dependencies. `config.ts` reads env with documented
  defaults: `SIM_POOL` (address, required), `SIM_DEPOSIT_X`/`SIM_DEPOSIT_Y` (or
  `SIM_DEPOSIT_USD`), `SIM_RANGE_LOWER`/`SIM_RANGE_UPPER` (prices) or
  `SIM_BIN_LOWER`/`SIM_BIN_UPPER`, `SIM_SHAPE` (`spot`|`curve`|`bid_ask`, default
  `spot`), `SIM_TIMEFRAME` (default `1h`), `SIM_START`/`SIM_END` (unix seconds),
  `SIM_TOLERANCE` (default `0.10`), `SIM_LIQUIDITY_SOURCE` (`aggregated`|
  `snapshot`, default `aggregated`), `SIM_VERIFY_USER` + `SIM_VERIFY_POSITION`
  (optional verification), `METEORA_BASE_URL`, `SIM_RPC_URL` (optional, snapshot
  tier only), `SIM_NETWORK` (default `mainnet`), `SIM_OUTPUT` (file path; stdout
  if unset). Validation rejects inverted ranges, non-positive deposits, unknown
  shapes/timeframes, and `start ≥ end`.
- **Rationale**: FR-014 (all params from config), SC-001 (one command, no code
  changes), Principle V (network unambiguous, endpoint configurable, no secrets —
  read API is unauthenticated; RPC URL from env). Mirrors Part 1's `config.ts`
  for consistency.
- **Alternatives considered**: *CLI flags*: viable later; env + defaults is the
  minimal surface meeting every requirement now, consistent with Part 1.
