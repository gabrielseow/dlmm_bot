# Feature Specification: DLMM Position Simulator

**Feature Branch**: `002-dlmm-position-simulator`

**Created**: 2026-06-01

**Status**: Draft

**Input**: User description: "I want to build a simulator to simulate ownership of a DLMM pool. The simulator should allow operations like opening a position, closing a position, claiming fees and any that you see fit. The simulator should also accurately simulate the fees earned from a position and should be verifiable with live data and historical data."

## Overview

This feature is **Part 2 of the four-part DLMM liquidity-provision pipeline**.
Part 1 (`001-dlmm-pair-discovery`) surfaces and ranks candidate pairs by
fee-efficiency. This part answers the next question: *if I had supplied liquidity
to this pool, what would actually have happened to my position?*

The deliverable is a **DLMM position simulator** — a model of owning a single
liquidity position in a Meteora DLMM pool. The operator can **open** a position
(choosing a price/bin range, a deposit, and a liquidity-distribution shape),
let the position **accrue fees** as the pool is traded, **claim** earned fees,
**mark** the position's current value, and **close** it. The simulator's primary,
correctness-critical output is the **fees earned** by the position; alongside
fees it reports the position's **value and impermanent loss**, yielding a **net
PnL**.

Crucially, the simulator must be **verifiable**. Its fee (and value) outputs must
be reconcilable both against **historical data** (replay a past period and compare
the simulated result to what the data source attributes to comparable real
liquidity) and against **live data** (reconcile a simulated position against a
real position observed on-chain / via the data source over a recent window). A
simulator whose numbers cannot be checked against reality is worthless for the
capital decisions this pipeline exists to make.

Consistent with the project constitution (Principle III — Simulate Before
Execute), the simulator is **read-only**: it models outcomes and never signs,
submits, or mutates on-chain state.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Simulate fees earned by a position over a window (Priority: P1)

As a liquidity-provider operator, I want to define a hypothetical position in a
DLMM pool (a deposit over a chosen price/bin range with a chosen liquidity shape)
and have the simulator tell me the fees that position would have earned over a
measurement window, so that I can judge whether supplying liquidity to that pool
is worthwhile.

**Why this priority**: This is the core of the entire feature and the minimum
viable product. Fee earnings are the reason an LP supplies liquidity at all, and
they are exactly what Part 1's ranking is a proxy for. Without an accurate
per-position fee number, nothing else in this part (valuation, PnL, verification)
has anything to attach to.

**Independent Test**: Define a position (pool, bin range, deposit, shape) and a
historical window, run the simulator, and confirm it reports the fees that
position accrued over the window, broken down so the figure is traceable (e.g.
the swap volume routed through the bins the position covered and the position's
share of liquidity in those bins). Can be validated by spot-checking the fee
math against the underlying volume/liquidity inputs with no code changes.

**Acceptance Scenarios**:

1. **Given** a pool, a deposit, a bin range, and a liquidity shape, **When** the
   operator runs the simulator over a defined window, **Then** the system reports
   the total fees the position earned over that window in interpretable units.
2. **Given** two positions in the same pool over the same window that differ only
   in bin range, **When** both are simulated, **Then** the position whose range
   captured more of the traded price action reports proportionally higher fees.
3. **Given** a completed simulation, **When** the operator inspects the fee
   figure, **Then** the inputs that produced it (per-bin liquidity share and the
   volume routed through those bins over the window) are visible and traceable.

---

### User Story 2 - Verify simulated fees against historical and live reality (Priority: P1)

As an operator, I want to reconcile the simulator's fee output against real data —
both by replaying a historical period and by comparing to a real position over a
recent live window — so that I can trust the simulator before I act on its
numbers.

**Why this priority**: The user requirement is explicit that fees must be
"verifiable with live data and historical data." An unverifiable simulator cannot
be trusted with capital decisions, which makes verification co-equal P1 with the
core simulation itself: a fee number I cannot check is no better than a guess.

**Independent Test**: Pick a real, observable position (or a documented liquidity
configuration) and a window for which real fee data exists; run the simulator
over the same inputs; confirm the simulated fees match the observed fees within a
documented tolerance, and that the comparison (simulated vs observed, absolute and
relative difference) is reported.

**Acceptance Scenarios**:

1. **Given** a historical window and a liquidity configuration for which the data
   source attributes real fees, **When** the operator runs the simulator over that
   window and requests verification, **Then** the system reports the simulated
   fees, the observed/attributed fees, and the difference between them.
2. **Given** a real position observable over a recent live window, **When** the
   operator reconciles it against a simulated position with the same parameters,
   **Then** the simulated and observed fees agree within the documented accuracy
   tolerance, or the discrepancy is reported rather than hidden.
3. **Given** the data needed for verification is missing or incomplete for the
   requested window, **When** verification is attempted, **Then** the system
   reports that verification could not be performed rather than silently passing.

---

### User Story 3 - Full position lifecycle: open, claim, mark, close (Priority: P2)

As an operator, I want to drive a position through its lifecycle operations — open
it, claim accrued fees, mark its current value, and close it — so that I can model
the complete experience of owning the position and not just a single fee snapshot.

**Why this priority**: Fee accrual (P1) is the core value, but a usable simulator
must let the operator perform the operations that change a position's state.
Claiming and closing determine when fees are realized and when the deposit is
withdrawn (at a possibly different token composition than deposited), which is
what connects raw fees to a realized result. It is P2 because the P1 fee model is
the prerequisite that these operations act upon.

**Independent Test**: Open a position, advance the simulation through a window so
fees accrue, claim the fees, then close the position; confirm each operation
updates the position's state coherently (claimed fees realized and accrued-balance
reset; close returns the underlying token amounts at the ending price and ends the
position) and that the sequence is reported as an auditable history of operations.

**Acceptance Scenarios**:

1. **Given** an open position with accrued fees, **When** the operator claims fees,
   **Then** the accrued (unclaimed) fee balance resets to zero and the same amount
   is recorded as realized/claimed.
2. **Given** an open position, **When** the operator closes it, **Then** the
   simulator reports the token amounts returned at the closing price and marks the
   position closed; no further fees accrue to it.
3. **Given** a sequence of operations on a position, **When** the operator reviews
   the run, **Then** an ordered, timestamped history of every operation
   (open/accrue/claim/close) and the resulting position state is available.

---

### User Story 4 - Net PnL: value and impermanent loss (Priority: P3)

As an operator, I want the simulator to report the position's current value and
its impermanent loss relative to simply holding the deposited tokens, combined
with earned fees into a net PnL, so that I can see whether the fees actually
compensated for the cost of providing liquidity.

**Why this priority**: Fees in isolation overstate LP returns because they ignore
impermanent loss; the decision-relevant number is fees net of IL. This is P3
because it builds on the P1 fee output and P2 lifecycle, and the fee figure (the
explicit user requirement) remains independently usable without it.

**Independent Test**: Simulate a position across a window in which the pool price
moves, and confirm the simulator reports (a) earned fees, (b) the position's value
at the ending price, (c) the value of the originally deposited tokens if simply
held, (d) the impermanent loss as the difference, and (e) net PnL combining fees
and IL — with each component traceable.

**Acceptance Scenarios**:

1. **Given** a position simulated across a price move, **When** the operator
   requests PnL, **Then** the system reports earned fees, position value at the
   ending price, the hold-value of the original deposit, the impermanent loss, and
   the net PnL (fees minus IL).
2. **Given** a window over which the pool price does not move, **When** PnL is
   computed, **Then** the reported impermanent loss is zero and net PnL equals
   earned fees.

---

### Edge Cases

- **Price fully outside the position's range**: When the active price moves above
  or below the position's bin range, the position earns no new fees (its liquidity
  is one-sided and not being traded against); the simulator must reflect zero fee
  accrual for that period rather than continuing to accrue.
- **Empty or zero deposit / degenerate range**: A position with zero deposit, an
  empty bin range, or an inverted range must be rejected or reported as earning
  nothing, never producing an infinite, NaN, or negative-fee result.
- **No trading activity in the window**: A window with zero swap volume through the
  position's bins yields zero fees (not an error and not a divide-by-zero).
- **Missing or partial historical data**: When the data source lacks the volume /
  liquidity / price detail needed for the requested window, the simulator must
  distinguish "no fees earned" from "could not be computed" and must not present a
  partially-computed figure as complete.
- **Claiming with nothing accrued**: Claiming fees when none have accrued is a
  no-op that leaves balances unchanged rather than an error.
- **Operations on a closed position**: Attempting to accrue, claim against, or
  re-close an already-closed position is rejected with a clear error.
- **Verification tolerance breach**: When simulated fees diverge from observed
  reality beyond the documented tolerance, the simulator surfaces the discrepancy
  (magnitude and direction) rather than reporting success.
- **Coarse data granularity**: When only aggregated (not per-swap) historical data
  is available, the simulator must state the fidelity limitation tied to that
  granularity rather than implying per-swap precision it cannot deliver.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow an operator to open a simulated position in a
  specified DLMM pool by specifying a deposit, a price/bin range, and a
  liquidity-distribution shape (at minimum a uniform/"spot" shape; additional
  shapes such as curve and bid-ask MAY be supported and, where supported, MUST be
  selectable via configuration).
- **FR-002**: System MUST simulate the fees a position earns over a measurement
  window as a function of the position's share of liquidity in each covered bin and
  the swap volume routed through those bins over the window.
- **FR-003**: System MUST attribute fees only to periods and bins in which the
  position actually held active (traded-against) liquidity, accruing zero fees when
  the active price is outside the position's range.
- **FR-004**: System MUST support the position lifecycle operations open, accrue
  (advance over a window), claim fees, mark/value, and close; additional modeling
  operations MAY be added where they aid simulation fidelity.
- **FR-005**: On claim, the System MUST move the position's accrued unclaimed fees
  to a realized/claimed balance and reset the unclaimed balance, leaving total
  earned fees (realized + unclaimed) consistent across the operation.
- **FR-006**: On close, the System MUST report the underlying token amounts the
  position would return at the closing price and MUST mark the position closed so
  no further fees accrue to it.
- **FR-007**: System MUST report, in addition to earned fees, the position's value
  at the marking price, the hold-value of the originally deposited tokens, the
  impermanent loss between them, and a net PnL combining fees and impermanent loss.
- **FR-008**: System MUST support verifying simulated fees against **historical**
  data by replaying a past window and comparing the simulated result to the fees
  the data source attributes to a comparable real liquidity configuration,
  reporting both figures and their absolute and relative difference.
- **FR-009**: System MUST support verifying simulated fees against **live** data by
  reconciling a simulated position against a real, observable position over a recent
  window, reporting agreement within a documented tolerance or the discrepancy.
- **FR-010**: System MUST distinguish "could not compute / verify" (missing or
  insufficient data) from a legitimately zero result, and MUST NOT present a
  partial or unverifiable figure as a complete or verified one.
- **FR-011**: Fee, value, and PnL computations MUST be deterministic: identical
  inputs (pool state, position parameters, and window data) yield identical outputs
  across runs.
- **FR-012**: System MUST be read-only with respect to on-chain state — it MUST
  NOT sign, submit, or mutate any transaction or position on-chain as part of
  simulation or verification.
- **FR-013**: System MUST produce a structured, machine-readable simulation result
  capturing the position parameters, the operation history, the per-component fee /
  value / PnL figures, the data window used, and any verification outcome, suitable
  for review and for hand-off to later pipeline parts.
- **FR-014**: System MUST source all operational parameters — pool selection,
  position parameters, measurement window, network selection, data-source endpoint,
  and verification tolerance — from configuration or invocation inputs rather than
  hard-coded literals.
- **FR-015**: System MUST report the fidelity/limitations of a simulation tied to
  the granularity of the data used (e.g. per-swap vs aggregated), so the operator
  can judge how much to trust a given result.

### Key Entities *(include if feature involves data)*

- **Pool State**: The DLMM pool's relevant state over the window — its bin
  configuration (bin step / fee parameters), the active bin / price path, and the
  per-bin liquidity and swap-volume information needed to attribute fees.
- **Position**: A simulated liquidity position. Key attributes: the pool, the
  deposited token amounts, the bin range, the liquidity-distribution shape, the
  resulting per-bin liquidity, accrued (unclaimed) fees, realized (claimed) fees,
  and lifecycle status (open/closed).
- **Operation**: A single lifecycle action applied to a position
  (open / accrue / claim / mark / close), with its timestamp, inputs, and the
  resulting position state — collectively forming the position's auditable history.
- **Simulation Result**: The output of a run — the position parameters, the
  operation history, earned/claimed fees, position value, impermanent loss, net
  PnL, the data window, and the fidelity note.
- **Verification Outcome**: The comparison of a simulated figure against observed
  reality (historical or live) — the simulated value, the observed value, the
  absolute and relative difference, the tolerance applied, and a pass/fail/
  could-not-verify status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can define a position and obtain its simulated fees over
  a chosen window in a single command, with no code changes required.
- **SC-002**: Simulated fees for a position match an independent manual calculation
  from the same per-bin liquidity-share and routed-volume inputs with 0
  discrepancies on a sample of positions.
- **SC-003**: For a historical window with available real fee data, simulated
  cumulative fees reconcile against the observed/attributed fees within the
  documented accuracy tolerance for at least 90% of sampled position
  configurations.
- **SC-004**: For at least one real position reconciled over a recent live window,
  the simulated fees agree with the observed fees within the documented tolerance,
  or the discrepancy is explicitly reported.
- **SC-005**: 0 simulation results contain an infinite, NaN, or negative-fee value;
  every degenerate input (zero deposit, empty/inverted range, zero volume) yields a
  zero or rejected result rather than a crash.
- **SC-006**: Two consecutive runs over identical inputs produce identical fee,
  value, and PnL figures (deterministic).
- **SC-007**: For every simulation result, an operator can trace each reported
  figure (fees, value, IL, net PnL) back to the inputs that produced it without
  reading source code.
- **SC-008**: When required data is missing, 100% of affected runs report
  "could not compute/verify" rather than emitting a partial figure presented as
  complete.
- **SC-009**: The position lifecycle is consistent — across any open→accrue→claim→
  close sequence, total earned fees equal realized plus unclaimed fees at every
  step (no fees created or lost by an operation).

## Assumptions

- **Pipeline position**: This is Part 2 (simulation/backtesting) forward-referenced
  by the `001-dlmm-pair-discovery` spec. Candidate pools come from Part 1; strategy
  derivation (Part 3) and live execution (Part 4) remain out of scope here.
- **Output scope (confirmed)**: The simulator reports **fees plus net PnL** — fees
  are the primary, independently verifiable output, and position value /
  impermanent loss are reported so the operator sees fees net of IL.
- **Position scope (confirmed)**: The simulator models a **single position
  lifecycle** at a time (open → accrue → claim → mark → close) with a configurable
  liquidity-distribution shape over a bin range. Rebalancing is expressed as a
  close-then-reopen sequence; automated multi-position strategy logic is deferred
  to Part 3.
- **Data source**: DLMM pool data (bins, liquidity, volume, price, and real fee
  figures used for verification) is sourced through the project's designated
  channels — the pinned Meteora API typed client for market/historical data and,
  for live reconciliation against a real position, the project's Meteora/Solana
  read interfaces. Achievable accuracy is bounded by the granularity those sources
  expose (e.g. aggregated vs per-swap).
- **Domain/chain**: Solana Meteora DLMM pools only, consistent with the existing
  codebase and constitution. No other chains or AMM types.
- **Verification tolerance**: A configurable accuracy tolerance defines "match" for
  verification; its exact default is set during planning based on observed
  data-source granularity, not fixed in this spec.
- **Read-only**: The simulator never opens, closes, or claims a real on-chain
  position and never signs transactions; "open/close/claim" here are simulated
  operations on modeled state (constitution Principle III).
- **Operator audience**: A single technical operator running the tool locally
  (CLI / programmatic invocation); no multi-tenant, authentication, or UI.

## Out of Scope (covered by later pipeline parts or other features)

- **Automated strategy logic** (auto-recenter, dynamic rebalancing rules,
  multi-position portfolio management) — Part 3 (strategy derivation).
- **Live execution** — signing/submitting real open/close/claim transactions —
  Part 4, which will begin human-in-the-loop.
- **Pair discovery/screening** — already delivered in `001-dlmm-pair-discovery`;
  this feature consumes its candidates rather than re-deriving them.
- **Tax, accounting, or reporting** outputs beyond the structured simulation result.
