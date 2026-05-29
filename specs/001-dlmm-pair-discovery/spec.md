# Feature Specification: DLMM Pair Discovery & Screening

**Feature Branch**: `001-dlmm-pair-discovery`

**Created**: 2026-05-29

**Status**: Draft

**Input**: User description: "Identify potential DLMM cryptocurrency pairs through indicators like fee to TVL ratio."

## Overview

This feature is **Part 1 of a four-part DLMM liquidity-provision pipeline**. The
governing thesis: crypto is an illiquid market that generates large amounts of
trading fees, and a liquidity provider can capture outsized returns by supplying
DLMM liquidity to pairs that earn **high fees relative to their Total Value
Locked (TVL)**.

This spec covers **only Part 1: discovery / screening** — surfacing and ranking
candidate DLMM pairs by fee-efficiency indicators (primarily the fee-to-TVL
ratio). It is the input funnel for the later parts (simulation/backtesting,
strategy derivation, live execution), which are intentionally **out of scope
here** and will be specified separately.

Discovery is inherently **read-only**: it observes market data and produces a
ranked candidate list. It never signs or submits a transaction.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rank pools by fee-to-TVL (Priority: P1)

As a liquidity-provider operator, I want to scan the available DLMM pools and see
them ranked by their fee-to-TVL ratio, so that I can immediately identify which
pairs are earning the most fees relative to the capital locked in them.

**Why this priority**: This is the core thesis of the entire project and the
minimum viable product. Without a ranked fee-efficiency view there is no
discovery funnel and nothing for later parts to consume. Delivered alone, it
already lets an operator make informed manual LP decisions.

**Independent Test**: Run the screener against the current set of DLMM pools and
confirm it returns a list of pairs ordered by descending fee-to-TVL ratio, each
row showing the pair, its TVL, its fees over the measurement window, and the
computed ratio. Can be validated by spot-checking that the ratios are correctly
computed and that ordering is correct, with no code changes required to run it.

**Acceptance Scenarios**:

1. **Given** a set of DLMM pools with known TVL and fee figures, **When** the
   operator runs the screener, **Then** the system returns those pools ordered
   from highest to lowest fee-to-TVL ratio, each with its computed ratio shown.
2. **Given** two pools earning identical fees but with different TVL, **When** the
   screener runs, **Then** the pool with the lower TVL ranks higher (higher
   fee-to-TVL efficiency).
3. **Given** the screener has produced a ranking, **When** the operator inspects
   any row, **Then** the underlying TVL, fee figure, and measurement window used
   for that pool's ratio are visible and traceable.

---

### User Story 2 - Filter out noise with configurable thresholds (Priority: P2)

As an operator, I want to exclude dust and illiquid pools by setting minimum
thresholds (e.g. minimum TVL, minimum trading volume), so that the ranking
surfaces realistically investable pairs instead of tiny pools whose fee-to-TVL
ratio is statistically meaningless.

**Why this priority**: A raw fee-to-TVL ranking is dominated by near-zero-TVL
pools where a single small trade produces an enormous ratio. Without filtering,
the P1 ranking is misleading and unusable in practice. This makes the discovery
output trustworthy.

**Independent Test**: Configure a minimum TVL and minimum volume threshold, run
the screener, and confirm that every returned candidate satisfies all configured
thresholds and that pools below any threshold are absent from the results.

**Acceptance Scenarios**:

1. **Given** a configured minimum TVL, **When** the screener runs, **Then** no
   pool with TVL below that threshold appears in the results.
2. **Given** a configured minimum trading-volume threshold, **When** the screener
   runs, **Then** no pool below that volume threshold appears in the results.
3. **Given** the operator changes a threshold value in configuration, **When**
   they re-run the screener, **Then** the candidate set reflects the new
   threshold without any code change.

---

### User Story 3 - Produce a consumable, repeatable candidate list (Priority: P3)

As an operator (and as the future simulation/backtesting component), I want the
screening result delivered as a structured, machine-readable candidate list, so
that the output can be reviewed by a human and later fed directly into Part 2
without re-deriving it.

**Why this priority**: Discovery only has value if its output can be acted upon.
A structured, repeatable result is what connects Part 1 to the rest of the
pipeline. It is lower priority than P1/P2 because the ranking itself is the core
value; serialization/export is the hand-off mechanism around it.

**Independent Test**: Run the screener and confirm it emits a structured result
containing each candidate's identity and computed metrics, and that running it
twice against unchanged inputs yields the same candidate set and ordering.

**Acceptance Scenarios**:

1. **Given** a completed screening run, **When** the operator requests the output,
   **Then** the system produces a structured list where each entry includes the
   pair identity, pool identifier, TVL, fees, volume, and computed indicators.
2. **Given** unchanged input data, **When** the screener is run twice, **Then**
   both runs produce identical candidate sets and identical ordering
   (deterministic output).

---

### Edge Cases

- **Zero or missing TVL**: A pool reporting zero (or absent) TVL must not cause a
  divide-by-zero or produce an infinite/NaN ratio; such pools are excluded from
  the ranking and flagged as ineligible rather than silently dropped.
- **Missing fee or volume data**: Pools with absent fee or volume figures for the
  measurement window are treated as ineligible, not as zero, so they neither
  crash the run nor masquerade as legitimately zero-earning pools.
- **Dust pools with extreme ratios**: A very-low-TVL pool whose single trade
  yields an enormous fee-to-TVL ratio must be removed by the minimum-TVL/volume
  filters (P2) rather than topping the ranking.
- **Duplicate pairs across configurations**: The same token pair may exist as
  multiple pools (e.g. different bin steps / fee tiers); each pool is ranked on
  its own merits and the output makes the distinction clear rather than collapsing
  them.
- **Newly created pools**: Pools too new to have a full measurement window of fee
  data are flagged so the operator can judge whether the ratio is meaningful.
- **Large pool universe**: The screener completes a full scan even when the number
  of pools is large, without partial/truncated results being presented as
  complete.
- **Upstream data unavailable**: If the market-data source is unreachable or
  returns an error, the screener reports the failure clearly and does not emit a
  stale or empty ranking as if it were a valid result.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST retrieve the universe of available DLMM pools together
  with each pool's TVL, fee, and trading-volume figures from the project's
  designated market-data source.
- **FR-002**: System MUST compute a fee-to-TVL ratio for each eligible pool over a
  defined measurement window.
- **FR-003**: System MUST rank eligible pools by the fee-to-TVL ratio in
  descending order by default.
- **FR-004**: System MUST support additional fee-efficiency indicators alongside
  fee-to-TVL (at minimum, volume-to-TVL), and allow the ranking indicator to be
  selected via configuration.
- **FR-005**: System MUST allow operators to configure minimum eligibility
  thresholds (at minimum: minimum TVL and minimum trading volume) and MUST exclude
  any pool failing any configured threshold from the results.
- **FR-006**: System MUST exclude pools with zero or missing TVL from ratio
  computation and ranking, flagging them as ineligible rather than producing an
  infinite, NaN, or silently-dropped result.
- **FR-007**: System MUST treat pools with missing fee or volume data for the
  measurement window as ineligible rather than as zero.
- **FR-008**: System MUST produce a structured, machine-readable candidate list in
  which each entry exposes the pair identity, pool identifier, TVL, fee figure,
  trading volume, the measurement window, and all computed indicators.
- **FR-009**: System MUST produce deterministic output: identical input data yields
  an identical candidate set and ordering across runs.
- **FR-010**: System MUST be read-only and MUST NOT sign, submit, or otherwise
  mutate any on-chain state as part of discovery.
- **FR-011**: System MUST source all operational parameters — thresholds, selected
  indicator, measurement window, network selection, and the data source endpoint —
  from configuration rather than hard-coded literals.
- **FR-012**: System MUST clearly distinguish a failed or incomplete data
  retrieval from a legitimately empty result, and MUST NOT present stale or partial
  data as a complete ranking.
- **FR-013**: System MUST be re-runnable on demand without code changes so the
  operator can refresh the ranking as market conditions change.

### Key Entities *(include if feature involves data)*

- **DLMM Pool**: A single liquidity pool for a token pair. Key attributes: pool
  identifier, the two tokens of the pair, fee-tier / bin configuration, current
  TVL, fees earned over the measurement window, and trading volume over the
  window.
- **Screening Criteria**: The operator-controlled configuration governing a run:
  minimum TVL, minimum volume (and any other thresholds), the selected ranking
  indicator, the measurement window, and sort order.
- **Candidate Pair**: A pool that passed all eligibility thresholds, enriched with
  its computed indicators (fee-to-TVL ratio, volume-to-TVL, etc.) and its rank
  within the result set.
- **Screening Result**: The output of a single run — the timestamped, ordered
  collection of Candidate Pairs plus the criteria used to produce it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can obtain a fee-to-TVL-ranked candidate list of the
  current DLMM pool universe in a single command, with no code changes required.
- **SC-002**: 100% of returned candidates satisfy every configured eligibility
  threshold (no sub-threshold pool ever appears in results).
- **SC-003**: 0 results contain an infinite, NaN, or undefined indicator value;
  every pool with zero/missing TVL is excluded or explicitly flagged ineligible.
- **SC-004**: Computed fee-to-TVL ratios match an independent manual calculation on
  a sample of pools with 0 discrepancies.
- **SC-005**: Two consecutive runs over unchanged input data produce identical
  candidate sets and ordering (deterministic).
- **SC-006**: An operator can change a threshold or the ranking indicator via
  configuration and see the result change accordingly on the next run, without
  editing code.
- **SC-007**: A full scan of the current pool universe completes within 60 seconds
  under normal data-source availability.
- **SC-008**: When the data source is unavailable, the run reports the failure and
  produces no candidate list (rather than an empty or stale one that could be
  mistaken for a valid result).

## Assumptions

- **Market-data source**: Per the project constitution, DLMM pool data (TVL, fees,
  volume) is sourced through the pinned **Meteora API** typed client. The
  indicators in scope are limited to those derivable from the fields that source
  exposes.
- **Domain/chain**: Targets Solana DLMM pools (Meteora), consistent with the
  existing codebase and constitution. No other chains or AMM types are in scope.
- **Measurement window**: A rolling recent window (e.g. trailing 24 hours) is used
  for fees and volume by default; the exact window is configurable and the
  available granularity is bounded by what the data source provides.
- **Primary indicator**: Fee-to-TVL ratio is the primary ranking signal;
  volume-to-TVL is provided as a secondary indicator. Additional indicators may be
  added later but are not required for this feature.
- **Operator audience**: The consumer is a single technical operator running the
  tool locally (CLI / programmatic invocation), not a multi-tenant or
  authenticated end-user product. Authentication, user accounts, and UI dashboards
  are out of scope.
- **No execution**: Discovery never opens, closes, or simulates positions and
  never signs transactions; it only reads and ranks.

## Out of Scope (covered by later pipeline parts)

- **Part 2 — Simulation & backtesting** of DLMM actions (adding/closing positions)
  and strategies (bid-ask, single-sided). Forward note: historical data for
  backtesting is intended to come from the **Meteora API**.
- **Part 3 — Strategy derivation** from backtesting / live-testing results.
- **Part 4 — Live execution** of strategies. Forward note: execution will begin
  **human-in-the-loop** (each live action explicitly approved for verification),
  with the longer-term goal of running **fully autonomously** once validated.

These are listed only to frame where the discovery output feeds; none of them
impose requirements on this feature.
