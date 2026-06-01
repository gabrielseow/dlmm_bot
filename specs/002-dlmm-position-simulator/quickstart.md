# Quickstart: DLMM Position Simulator

Part 2 of the DLMM pipeline. Models owning one Meteora DLMM liquidity position and
reports **fees earned** (the correctness-critical output) plus value, impermanent
loss, and net PnL — verifiable against historical and live real-position data.
Read-only: it never signs, submits, or mutates on-chain state.

## Prerequisites

- Node.js with the repo's toolchain installed (`npm install` already run for Part 1).
- A candidate pool address (e.g. from Part 1's screener output).
- Network access to the Meteora API (`METEORA_BASE_URL`, default pinned in
  `src/meteora.ts`). The read API is unauthenticated.
- Optional (Tier-B `snapshot` liquidity source / live on-chain cross-check): a
  Solana RPC URL in `SIM_RPC_URL`.

## 1. Simulate fees over a window (US1 — the MVP)

```bash
SIM_POOL=<poolAddress> \
SIM_DEPOSIT_USD=1000 \
SIM_RANGE_LOWER=140 SIM_RANGE_UPPER=160 \
SIM_SHAPE=spot \
SIM_TIMEFRAME=1h \
SIM_START=1748736000 SIM_END=1748822400 \
npm run simulate
```

Prints a `SimulationResult` JSON (and a human summary to stderr) reporting the
position's fees over the window, with a per-bin breakdown — `routedVolumeUsd`,
`liquidityShare`, and `feesUsd` per bin — so every figure traces back to the
volume routed through the position's bins and its liquidity share (US1 #3, SC-007).

**Expectations / acceptance:**
- Two positions identical except range: the one whose range captured more of the
  traded price action reports proportionally higher fees (US1 #2).
- Window with zero volume, or price entirely outside `[lower, upper]`: fees are
  `0` (not an error, not NaN) — FR-003, edge cases.
- Zero deposit, inverted/empty range: rejected at config validation (exit `2`).

## 2. Verify against historical / live reality (US2)

```bash
SIM_POOL=<poolAddress> \
SIM_VERIFY_USER=<walletAddress> \
SIM_VERIFY_POSITION=<positionAddress> \
SIM_TOLERANCE=0.10 \
npm run simulate
```

The simulator pulls the real position's ground truth from
`/positions/{pool}/pnl` (and reconstructs its deposit/window from
`/positions/{address}/historical`), runs itself over the same pool, range,
deposit, and window, and emits a `verification` block: `simulatedFeesUsd`,
`observedFeesUsd`, `absDiffUsd`, `relDiff`, `tolerance`, and `status`
(`pass` | `fail` | `could_not_verify`).

**Expectations / acceptance:**
- Within tolerance → `pass`; beyond tolerance → `fail` with the magnitude and
  direction in `note` (never hidden) — US2 #2.
- Missing OHLCV/volume coverage or no observed fee figure → `could_not_verify`,
  **not** a silent pass (FR-010, SC-008) — US2 #3.
- A verification `fail`/`could_not_verify` still exits `0` — reporting the
  discrepancy *is* the success condition. Only inability to compute the figure at
  all (missing window data) exits `3`.

## 3. Full lifecycle: open → accrue → claim → mark → close (US3)

The default run drives the position through its lifecycle and records an ordered,
timestamped `operations[]` history. Each entry carries `stateAfter` with
`unclaimedFees`, `realizedFees`, and `earnedFees`. Invariant held at every step:
`earnedFees = realizedFees + unclaimedFees` (SC-009).

**Expectations / acceptance:**
- `claim` moves unclaimed → realized and zeroes unclaimed; claiming with nothing
  accrued is a no-op.
- `close` reports returned token amounts at the closing price and marks the
  position closed; subsequent `accrue`/`claim`/`close` are rejected.

## 4. Net PnL: value & impermanent loss (US4)

When valuation is requested, the result's `valuation` block reports `earnedFeesUsd`,
`positionValueUsd` at the marking price, `holdValueUsd` of the original deposit,
`impermanentLossUsd`, and `netPnlUsd = earnedFees − IL`.

**Expectations / acceptance:**
- Price unchanged over the window → `impermanentLossUsd = 0` and
  `netPnlUsd = earnedFeesUsd` (US4 #2).

## Fidelity — how much to trust a result (FR-015)

Every result carries a `fidelity` note: the price `priceGranularity` (bucket
size), the `volumeBasis` (reported fees vs `volume × rate`), and the
`liquiditySource` (`aggregated` TVL estimate vs on-chain `snapshot`) with a
`liquidityCaveat`. The default `aggregated` tier estimates the per-bin liquidity
share from pool TVL and spreads bucket volume uniformly across the bins the price
traversed — honest but coarse. Tighten `SIM_TOLERANCE` only when using a
higher-fidelity source.

## Determinism

Two consecutive runs over identical inputs produce identical fee, value, and PnL
figures (FR-011, SC-006). All calculation functions are pure; window data and the
pool-liquidity-share function are injected at the edges.

## Run the tests

```bash
npm test    # node --import tsx --test tests/unit/*.test.ts
```

Covers the pure core: bin geometry round-trips and shape distribution, in/out-of-
range fee attribution and zero-volume handling, valuation/IL/net-PnL, the
lifecycle conservation invariant, and verification pass / breach / could-not-verify.
