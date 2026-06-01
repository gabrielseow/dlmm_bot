---
description: "Task list for DLMM Position Simulator implementation"
---

# Tasks: DLMM Position Simulator

**Input**: Design documents from `/specs/002-dlmm-position-simulator/`

**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: Test tasks ARE included. Plan.md and Constitution Principle IV ("Deterministic, Testable Financial Core") explicitly mandate unit-testing the pure core for normal/boundary/degenerate inputs, and plan.md names the specific test files. They are therefore part of the deliverable, not optional.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1–US4)
- Exact file paths are included in every task

## Path Conventions

Single project extending the existing `src/` layout. New code lives in `src/simulator/`; pure-core tests live in `tests/unit/`. The pure financial core (`bins`, `fees`, `valuation`, `position`, `simulate`, `verify`) never imports the I/O edges (`fetch-window`, `fetch-observed`, `bin-liquidity`) or the CLI shell (`cli`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project scaffolding and one-command invocation per SC-001/FR-014.

- [ ] T001 Create the `src/simulator/` package directory and add a `"simulate": "tsx src/simulator/cli.ts"` script to `package.json` (mirrors the existing `"screen"` script).
- [ ] T002 [P] Confirm the pinned generated types in `src/generated/meteora-api.d.ts` cover the new endpoints (`/pools/{address}/ohlcv`, `/pools/{address}/volume/history`, `/positions/{pool_address}/pnl`, `/positions/{address}/historical`) by running `npm run check:api`; reconcile the pinned spec via `npm run update:api` if any are missing (Principle II).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared domain types, pure bin geometry, and config validation that every user story builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 [P] Define all domain entity types in `src/simulator/types.ts` per data-model.md: `PoolState`, `TokenRef`, `WindowTimeline`/`WindowBucket`, `Position`/`BinLiquidity`, `Operation`/`PositionSnapshot`, `FeeBreakdown`/`BinFeeContribution`, `Valuation`, `FidelityNote`, `ObservedPosition`, `VerificationOutcome`, `SimulationResult`, and the shared value types `TokenAmounts` and the injected `PoolLiquiditySource` signature. Use `T | null` for absent-vs-zero fields (FR-010).
- [ ] T004 [P] Implement the pure bin-geometry primitives in `src/simulator/bins.ts`: `priceToBinId(price, binStep)` = `floor(ln(price)/ln(1+binStep/10_000))`, `binIdToPrice(binId, binStep)`, `rangeToBins(priceRange, binStep)` → `[L,U]`, and `distributeLiquidity(shape, deposit, [L,U], binStep)` → `BinLiquidity[]` (at minimum `spot`/uniform; `curve`/`bid_ask` where supported) — FR-001, Decision 3. No I/O, no clock, no RNG.
- [ ] T005 Implement `SimulationConfig` load + validation in `src/simulator/config.ts` reading all `SIM_*`/`METEORA_BASE_URL` env vars from the CLI contract, with the contract's validation rules (require `SIM_POOL`; exactly one deposit form, all amounts `> 0`; `lower < upper` / `binLower ≤ binUpper`; allowed `SIM_SHAPE`/`SIM_TIMEFRAME`; `SIM_START < SIM_END`; `SIM_TOLERANCE ≥ 0`; `snapshot` requires `SIM_RPC_URL`; `SIM_VERIFY_*` requires `SIM_VERIFY_USER`). Surface failures as a distinct invalid-config error (exit 2). Depends on T003, T004.
- [ ] T006 [P] Unit tests for bin geometry in `tests/unit/bins.test.ts`: price↔bin round-trip, `rangeToBins`, shape distribution sums to the deposit, and inverted/empty range handling (SC-005). Depends on T004.

**Checkpoint**: Types, geometry, and config validation ready — user stories can begin.

---

## Phase 3: User Story 1 - Simulate fees earned over a window (Priority: P1) 🎯 MVP

**Goal**: Define a hypothetical position (pool, range, deposit, shape) and report the fees it would have earned over a window, broken down per-bin so the figure is traceable.

**Independent Test**: Run `npm run simulate` with `SIM_POOL`, deposit, range, shape, and a window; confirm it emits a `SimulationResult` whose `fees.perBin` (`routedVolumeUsd`, `liquidityShare`, `feesUsd`) traces the total fee figure to the volume routed through the covered bins and the position's liquidity share (US1 #1/#3). A narrower range capturing more price action reports proportionally higher fees (US1 #2); zero volume / out-of-range yields `0` not NaN (FR-003).

### Implementation for User Story 1

- [ ] T007 [P] [US1] Implement the pure fee model in `src/simulator/fees.ts`: `attributeFees(timeline, positionBins, shareFn, feeRate)` summing `Σ_buckets Σ_{bin ∈ activeBins(bucket)∩[L,U]} bucketFees · volumeShareOfBin · liquidityShare` → `FeeBreakdown` with per-bin contributions, `bucketsCounted`/`bucketsOutOfRange`. Guard all divisions so no `Infinity`/`NaN`/negative fee can result; out-of-range buckets contribute zero (FR-002, FR-003, Decision 2, SC-005). Depends on T003, T004.
- [ ] T008 [P] [US1] Implement the injected `PoolLiquiditySource` in `src/simulator/bin-liquidity.ts`: Tier A `aggregated` (default, API-only — spread pool `tvl` across the active span / operator-supplied total) and optional Tier B `snapshot` (read-only `@meteora-ag/dlmm` per-bin reserves via `SIM_RPC_URL`) behind the `PoolLiquiditySource` interface so `fees.ts` stays pure (Decision 4). Depends on T003.
- [ ] T009 [US1] Implement the `open` and `accrue` lifecycle transitions in `src/simulator/position.ts` as pure functions over an immutable `Position`, each appending an `Operation` log entry; validate at `open` (deposit `> 0`, `L ≤ U`, non-empty range → reject otherwise) and accumulate `unclaimedFees` on `accrue` (FR-001, FR-004, Decision 5). Depends on T003, T004.
- [ ] T010 [US1] Implement the window I/O edge in `src/simulator/fetch-window.ts`: via `src/meteora.ts`, fetch `GET /pools/{address}` (geometry/config/tokens/tvl), `GET /pools/{address}/ohlcv`, and `GET /pools/{address}/volume/history`, aligning them into a `WindowTimeline` (`buckets[]` with active-bin span from `[low,high]`, `complete` flag). Set `complete=false` on coverage gaps (FR-010). Depends on T003. Respect the 30 QPS limit (no parallel fan-out).
- [ ] T011 [US1] Implement the pure orchestrator in `src/simulator/simulate.ts`: open → accrue over the `WindowTimeline` → assemble a `SimulationResult` (`fees` FeeBreakdown, `position`, `operations`, `window`, `pool`, `config` echo, `status`) and populate the `FidelityNote` (`priceGranularity`, `volumeBasis`, `liquiditySource`, `liquidityCaveat`, `complete`). Deterministic — no clock/RNG (FR-011, FR-013, FR-015, SC-006). Depends on T007, T008, T009.
- [ ] T012 [US1] Implement `src/simulator/format.ts`: serialize a `SimulationResult` to JSON conforming to `contracts/simulation-result.schema.json` and render a concise human summary (fees, fidelity) to stderr (FR-013).
- [ ] T013 [US1] Implement `src/simulator/cli.ts` wiring `config → fetch-window → simulate → format`, writing JSON to `SIM_OUTPUT` or stdout, with exit codes 0 (`ok`), 2 (invalid config), 3 (`could_not_compute` / data-source failure) per the CLI contract (SC-001, SC-008). Depends on T005, T010, T011, T012.
- [ ] T014 [P] [US1] Unit tests for the fee model in `tests/unit/fees.test.ts`: in-range vs out-of-range attribution (FR-003), zero-volume window → zero fees, per-bin share weighting so a range capturing more price action earns more (US1 #2), and determinism over identical inputs (SC-006). Depends on T007.

**Checkpoint**: MVP complete — an operator can simulate and trace a position's fees in one command.

---

## Phase 4: User Story 2 - Verify simulated fees against historical and live reality (Priority: P1)

**Goal**: Reconcile the simulator's fee output against real positions — historical replay and recent live windows — reporting simulated vs observed fees, their absolute/relative difference, and a pass/fail/could-not-verify status.

**Independent Test**: With `SIM_VERIFY_USER`/`SIM_VERIFY_POSITION` and a tolerance set, run the simulator over a real position's pool/range/deposit/window; confirm the `verification` block reports `simulatedFeesUsd`, `observedFeesUsd`, `absDiffUsd`, `relDiff`, `tolerance`, and `status` — `pass` within tolerance, `fail` with magnitude/direction beyond it, and `could_not_verify` (never a silent pass) when observed data is missing (US2, FR-008/009/010, SC-008).

### Implementation for User Story 2

- [ ] T015 [P] [US2] Implement the pure comparison in `src/simulator/verify.ts`: `compare(simulatedFeesUsd, observedFeesUsd, tolerance, mode)` → `VerificationOutcome` (`absDiffUsd`, `relDiff = absDiff/max(observed,ε)`, `status` = `pass` iff `relDiff ≤ tolerance`, `fail` beyond, `could_not_verify` when `observedFeesUsd` is null), with a `note` capturing breach direction/magnitude (FR-008/009/010, Decision 7). Conforms to `contracts/verification-outcome.schema.json`. Depends on T003.
- [ ] T016 [US2] Implement the observed-position I/O edge in `src/simulator/fetch-observed.ts`: via `src/meteora.ts`, fetch `GET /positions/{pool_address}/pnl` (`allTimeFees`, `lowerBinId`/`upperBinId`, `createdAt`/`closedAt`, `isClosed`) and `GET /positions/{address}/historical` (reconstruct deposit from `add` events) → `ObservedPosition`; `observedFeesUsd = null` when unavailable (Decision 1/7). Depends on T003.
- [ ] T017 [US2] Wire verification into `src/simulator/simulate.ts` and `src/simulator/cli.ts`: when `SIM_VERIFY_*` is set, derive the matched pool/range/deposit/`[createdAt,closedAt]` window from the `ObservedPosition` (historical mode) or recent window (live, `status=open`), run the simulation, attach the `VerificationOutcome`; a `fail`/`could_not_verify` still exits 0 (US2 #2/#3, CLI contract). Depends on T013, T015, T016.
- [ ] T018 [P] [US2] Unit tests for verification in `tests/unit/verify.test.ts`: within-tolerance `pass`, beyond-tolerance `fail` surfaced with direction, and `could_not_verify` on missing observed data (FR-010, SC-008). Depends on T015.

**Checkpoint**: Fee figures are now reconcilable against real data — both P1 stories functional.

---

## Phase 5: User Story 3 - Full position lifecycle: open, claim, mark, close (Priority: P2)

**Goal**: Drive a position through open → accrue → claim → mark → close, conserving fees at every step and recording an ordered, timestamped operation history.

**Independent Test**: Run a lifecycle so fees accrue, claim them, mark, then close; confirm `claim` moves unclaimed → realized and zeroes unclaimed (no-op when nothing accrued), `close` reports returned token amounts at the closing price and rejects subsequent ops, and `operations[]` is an ordered history where `earnedFees = realizedFees + unclaimedFees` holds at every `stateAfter` (US3, FR-005/006, SC-009).

### Implementation for User Story 3

- [ ] T019 [US3] Add the `claim`, `mark`, and `close` transitions to `src/simulator/position.ts`: `claim` moves `unclaimedFees → realizedFees` and zeroes unclaimed (no-op when zero); `mark(price)` is read-only valuation; `close` records returned token amounts at the closing price and sets `status=closed`/`closedAt`; `accrue`/`claim`/`close` on a closed position are rejected with a clear error. Enforce `earnedFees = realizedFees + unclaimedFees` after every op (FR-005/006, SC-009, Decision 5). Depends on T009.
- [ ] T020 [US3] Extend `src/simulator/simulate.ts` to drive the full open→accrue→claim→mark→close sequence and emit the complete ordered `operations[]` history with per-op `stateAfter` snapshots (US3 #3, FR-013). Depends on T011, T019.
- [ ] T021 [US3] Extend `src/simulator/format.ts` to render the operation history (timestamped open/accrue/claim/mark/close with resulting balances) in the JSON output and human summary (US3 #3). Depends on T012, T020.
- [ ] T022 [P] [US3] Unit tests for the lifecycle in `tests/unit/position.test.ts`: claim resets unclaimed and realizes the amount, claim-with-nothing is a no-op, closed-position ops are rejected, and the `earnedFees = realizedFees + unclaimedFees` invariant holds across an open→accrue→claim→close sequence (SC-009). Depends on T019.

**Checkpoint**: The complete, auditable position lifecycle is modeled.

---

## Phase 6: User Story 4 - Net PnL: value and impermanent loss (Priority: P3)

**Goal**: Report position value at the marking price, the hold-value of the original deposit, impermanent loss, and a net PnL combining fees and IL.

**Independent Test**: Simulate across a price move and confirm the `valuation` block reports `earnedFeesUsd`, `positionValueUsd`, `holdValueUsd`, `impermanentLossUsd`, and `netPnlUsd = earnedFees − IL`, each traceable; a flat-price window yields `impermanentLossUsd = 0` and `netPnlUsd = earnedFeesUsd` (US4, FR-007).

### Implementation for User Story 4

- [ ] T023 [P] [US4] Implement the pure valuation in `src/simulator/valuation.ts`: `positionValue(price)` from per-bin liquidity (bins below active = token_y, above = token_x, active mixed), `holdValue(price)` of the original deposit, `impermanentLossUsd = holdValue − positionValue` (0 when price flat), `netPnlUsd = earnedFeesUsd − impermanentLossUsd`, reusing `bins.ts` geometry (FR-007, Decision 6). Depends on T003, T004.
- [ ] T024 [US4] Wire the `Valuation` block into `src/simulator/simulate.ts` (attach when valuation is requested) and render it in `src/simulator/format.ts` (FR-007, FR-013). Depends on T011, T012, T023.
- [ ] T025 [P] [US4] Unit tests for valuation in `tests/unit/valuation.test.ts`: IL is zero when price is flat, position value matches the composition at the ending price, and `netPnl = fees − IL` (US4 #1/#2). Depends on T023.

**Checkpoint**: All four user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verification of the whole, type safety, and docs across all stories.

- [ ] T026 [P] Run `npm run typecheck` and resolve any `strict`/`noUncheckedIndexedAccess` violations across `src/simulator/` (Principle I — no `any`/unchecked `as` in business logic).
- [ ] T027 Run `npm test` and validate all `quickstart.md` scenarios (US1–US4) end-to-end against a real pool, confirming exit codes 0/2/3 behave per the CLI contract (SC-001, SC-005, SC-008).
- [ ] T028 [P] Add a short `src/simulator/` usage note to the repo README/docs covering the `simulate` script, the `SIM_*` config surface, and the fidelity tiers (FR-014, FR-015).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phases 3–6)**: All depend on Foundational. US1 (MVP) first; US2 reuses US1's `simulate`/`cli`; US3 extends `position`/`simulate`/`format`; US4 extends `simulate`/`format`. Priority order: P1 (US1, US2) → P2 (US3) → P3 (US4).
- **Polish (Phase 7)**: Depends on all desired stories being complete.

### User Story Dependencies

- **US1 (P1)**: Foundation only. The MVP; independently testable.
- **US2 (P1)**: Foundation + US1's `simulate.ts`/`cli.ts` (T013) to attach a verification outcome to a run; `verify.ts` and `fetch-observed.ts` are independent and can start once Foundation is done.
- **US3 (P2)**: Foundation + US1's `position.ts` (T009) and `simulate.ts`/`format.ts`; otherwise independent of US2.
- **US4 (P3)**: Foundation + US1's `simulate.ts`/`format.ts`; independent of US2/US3.

### Within Each User Story

- Pure-core modules (fees, verify, valuation, position) before the orchestrator (`simulate.ts`).
- I/O edges (fetch-window, fetch-observed, bin-liquidity) are independent of the pure core and can be built in parallel with it.
- `cli.ts` last (wires everything). Tests can be written against their target module as soon as it exists.

### Parallel Opportunities

- T002 in Setup is `[P]`.
- Foundational: T003, T004, and T006 are `[P]` (T005 depends on T003+T004).
- US1: T007 (fees), T008 (bin-liquidity), and T014 (fees tests, after T007) are `[P]`; T009/T010 touch separate files and can also run alongside.
- US2: T015 (verify) and T016 (fetch-observed) are `[P]`; T018 after T015.
- US3: T022 after T019; T019→T020→T021 are sequential (shared files).
- US4: T023 and T025 (after T023) are `[P]`.
- Once Foundation completes, US1 / US2's pure+edge modules / US3 / US4 cores can be developed by different people in parallel, integrating at `simulate.ts`/`cli.ts`.

---

## Parallel Example: User Story 1

```bash
# After Foundational (T003–T006), launch US1's independent modules together:
Task: "Implement fee model in src/simulator/fees.ts"            # T007
Task: "Implement PoolLiquiditySource in src/simulator/bin-liquidity.ts"  # T008
Task: "Implement window I/O edge in src/simulator/fetch-window.ts"       # T010
# Then, once fees.ts exists:
Task: "Unit tests for fee model in tests/unit/fees.test.ts"     # T014
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1.
4. **STOP and VALIDATE**: simulate a position, spot-check `fees.perBin` against volume/share inputs (SC-002/SC-007), confirm zero-volume/out-of-range → 0 and degenerate inputs are rejected (SC-005).
5. This is a shippable MVP: traceable simulated fees in one command.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → simulate & trace fees (MVP).
3. US2 → reconcile against real positions (trust the number).
4. US3 → full auditable lifecycle.
5. US4 → fees net of impermanent loss.

Each story adds value without breaking the previous; the pure core stays I/O-isolated and deterministic throughout (Principle IV, FR-011).

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- `[Story]` label maps each task to its user story; Setup/Foundational/Polish carry no story label by design.
- Tests target the pure core under `tests/unit/` (`node:test` via `tsx`, no new deps) per Principle IV.
- The pure core never imports the I/O edges or the SDK; the share denominator is injected via `PoolLiquiditySource`.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
