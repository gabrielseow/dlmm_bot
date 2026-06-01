# Implementation Plan: DLMM Position Simulator

**Branch**: `002-dlmm-position-simulator` | **Date**: 2026-06-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-dlmm-position-simulator/spec.md`

## Summary

Part 2 of the DLMM liquidity-provision pipeline: a **read-only position
simulator** that models owning a single Meteora DLMM liquidity position. The
operator opens a position (deposit + price/bin range + liquidity-distribution
shape), lets it **accrue** fees over a measurement window, **claims** fees,
**marks** its value, and **closes** it. The correctness-critical output is the
**fees earned**, reported alongside position value, impermanent loss, and net
PnL — and **verifiable** against both historical and live real-position data.

Technical approach (mirrors Part 1's seams): a **pure, deterministic financial
core** (`src/simulator/`) does all bin math, fee attribution, valuation, IL/PnL,
and the position lifecycle state machine — no I/O, no clock, no RNG. A thin **I/O
edge** uses the pinned `openapi-fetch` Meteora client (`src/meteora.ts`) to fetch
the window's price path (`/pools/{address}/ohlcv`), pool-level volume/fees
(`/pools/{address}/volume/history`), pool config, and — for verification — real
position ground truth (`/positions/{pool_address}/pnl`,
`/positions/{address}/historical`). The fee model attributes a position's fees
from aggregated volume/price data via an **injected pool-liquidity-share
function**, and every result carries an explicit **fidelity note** stating the
granularity it was computed at (FR-015). A CLI entrypoint wires config → fetch →
simulate → (verify) → structured JSON output. No signing, no on-chain mutation.

## Technical Context

**Language/Version**: TypeScript 6.x on Node.js (ESM, `"type": "module"`,
`verbatimModuleSyntax` + `isolatedModules`, explicit `.js` import specifiers) —
identical to Part 1.

**Primary Dependencies**: `openapi-fetch` (typed Meteora client via
`src/generated/meteora-api.d.ts`) for all market/historical/verification data.
The core (bin math, fees, valuation, lifecycle) has **no runtime dependencies**.
`@meteora-ag/dlmm` + `@solana/web3.js` (already in `package.json`) are used
**only** at an optional, injected read-only edge for an on-chain per-bin
liquidity snapshot used to sharpen the fee-share estimate and live verification;
the default path is API-only and the SDK edge is behind an interface so the core
and the historical path never import it.

**Storage**: Stateless. `SimulationResult` written to stdout and/or a JSON file
passed via config; no database.

**Testing**: Node built-in test runner (`node:test`) executed through `tsx`
(`node --import tsx --test tests/unit/*.test.ts`). Zero new test dependencies,
consistent with Part 1 and Principle IV.

**Target Platform**: Local CLI / programmatic invocation on Node.js (operator's
machine). Single technical operator; no multi-tenant, auth, or UI.

**Project Type**: Single project (CLI + library core). Extends the existing
`src/` layout with a new `src/simulator/` package.

**Performance Goals**: A single-position simulation over a window completes in a
few seconds; the dominant cost is the per-pool OHLCV + volume/history fetch
(a handful of API calls). Core computation over a window of buckets is
sub-second. Respect the Meteora API **30 QPS** limit (no parallel fan-out
beyond that).

**Constraints**: Read-only — never sign/submit/mutate on-chain state (FR-012,
Principle III). Deterministic — identical inputs yield identical fee/value/PnL
(FR-011/SC-006). No infinite/NaN/negative-fee outputs; degenerate inputs are
rejected or yield zero (FR-003/SC-005). Fail-distinct — "could not compute/
verify" is never presented as a complete/verified figure (FR-010/SC-008). All
operational parameters from config/invocation, not literals (FR-014).

**Scale/Scope**: Solana Meteora DLMM pools only. One position lifecycle per run
(rebalancing = close-then-reopen). A window is typically tens–hundreds of
time buckets (e.g. hourly candles over days/weeks).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Type Safety Is Non-Negotiable | Compiles under `strict` + `noUncheckedIndexedAccess`; no `any`/unchecked `as` in business logic; `npm run typecheck` passes. | ✅ PASS — pure-TS core; API rows typed via generated types; any boundary narrowing is documented at the edge. |
| II. External API Contracts Are Pinned & Verified | Meteora data consumed only through the typed `src/meteora.ts` client; no direct/untyped `fetch`; `check:api` available. | ✅ PASS — new endpoints (`/ohlcv`, `/volume/history`, `/positions/{pool}/pnl`, `/positions/{addr}/historical`) all called via `meteoraApi.GET(...)`. |
| III. Simulate Before Execute (Capital Safety) | No path signs/submits/mutates on-chain state; live execution requires explicit opt-in. | ✅ PASS — this feature **is** the simulation layer the constitution mandates; strictly read-only. The optional SDK/RPC edge performs reads only (bin snapshot, observed fees); no wallet, no signing imports. |
| IV. Deterministic, Testable Financial Core | Fee/PnL/bin/valuation math is pure, deterministic, I/O-isolated, unit-tested for normal/boundary/degenerate inputs. | ✅ PASS — `bins.ts`, `fees.ts`, `valuation.ts`, `position.ts`, `verify.ts` are pure; window data + share fn are injected; `node:test` covers out-of-range, zero deposit, inverted range, zero volume, claim-with-nothing, closed-position ops, tolerance breach. |
| V. Configuration & Secrets Hygiene | Pool, position params, window, network, endpoint, tolerance, RPC URL from config/env, not literals; no secrets committed; network unambiguous. | ✅ PASS — `config.ts` is the single parameter source; read API is unauthenticated; optional `SIM_RPC_URL` from env; default network explicit. |

**Result**: All gates pass. No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-dlmm-position-simulator/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── simulator-cli.md              # CLI invocation + config + exit-code contract
│   ├── simulation-result.schema.json # SimulationResult output schema (FR-013)
│   └── verification-outcome.schema.json # VerificationOutcome schema (FR-008/009)
├── checklists/          # (if present)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── meteora.ts                  # EXISTING typed Meteora API client (I/O edge)
├── generated/
│   └── meteora-api.d.ts        # EXISTING generated types (pinned spec)
├── discovery/                  # EXISTING — Part 1 (pair discovery; consumed as candidate source)
└── simulator/                  # NEW — Part 2
    ├── config.ts               # Load + validate SimulationConfig from env/invocation (FR-014)
    ├── types.ts                # PoolState, Position, Operation, WindowTimeline, SimulationResult, VerificationOutcome, FidelityNote
    ├── bins.ts                 # PURE: priceToBinId/binIdToPrice (bin_step), rangeToBins, distributeLiquidity(shape) → per-bin liquidity (FR-001)
    ├── fees.ts                 # PURE: attributeFees(timeline, positionBins, shareFn, feeRate) → per-bin fee breakdown (FR-002, FR-003)
    ├── valuation.ts            # PURE: positionValue(price), holdValue, impermanentLoss, netPnl (FR-007)
    ├── position.ts             # PURE: lifecycle state machine open/accrue/claim/mark/close + operation log; invariant earned = realized + unclaimed (FR-004, FR-005, FR-006)
    ├── simulate.ts             # PURE: orchestrate ops over a WindowTimeline → SimulationResult (FR-011, FR-013, FR-015)
    ├── verify.ts               # PURE: compare(simulated, observed, tolerance) → VerificationOutcome (FR-008, FR-009, FR-010)
    ├── fetch-window.ts         # I/O edge: pool detail + /ohlcv + /volume/history → WindowTimeline (the only API importer for sim inputs)
    ├── fetch-observed.ts       # I/O edge: /positions/{pool}/pnl + /positions/{addr}/historical → ObservedPosition (verification ground truth)
    ├── bin-liquidity.ts        # OPTIONAL read-only edge: DLMM SDK snapshot → pool per-bin liquidity (sharpens shareFn); behind PoolLiquiditySource interface
    ├── format.ts               # Serialize SimulationResult to JSON + human summary (FR-013)
    └── cli.ts                  # Wires config → fetch → simulate → (verify) → format; exit codes (SC-001, SC-008)

tests/
└── unit/
    ├── bins.test.ts            # price↔bin round-trip, range, shape distribution sums to deposit, inverted/empty range
    ├── fees.test.ts            # in/out-of-range attribution, zero volume, share weighting (US1 #2), determinism
    ├── valuation.test.ts       # IL zero when price flat, value at ending price, net PnL = fees − IL
    ├── position.test.ts        # claim resets unclaimed & realizes; closed-position ops rejected; earned = realized + unclaimed invariant (SC-009)
    └── verify.test.ts          # within-tolerance pass, breach surfaced, could-not-verify on missing data
```

**Structure Decision**: Single project extending the existing `src/`, exactly
mirroring Part 1's layering. A new `src/simulator/` package isolates the feature.
The **pure financial core** (`bins.ts`, `fees.ts`, `valuation.ts`, `position.ts`,
`simulate.ts`, `verify.ts`) is fully separated from the **I/O edges**
(`fetch-window.ts`, `fetch-observed.ts`, `bin-liquidity.ts` — the only modules
importing `meteora.ts` / the SDK) and from the **CLI shell** (`cli.ts`). The
pool-liquidity-share input the fee model needs is an **injected function**
(`PoolLiquiditySource`) so the core stays pure and testable and the SDK/RPC
dependency is optional. Tests target the pure core under `tests/unit/`. A
`simulate` script will be added to `package.json` (`tsx src/simulator/cli.ts`)
so the operator runs it in one command with no code changes (SC-001, FR-013).

## Complexity Tracking

> No constitution violations. No entries.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
