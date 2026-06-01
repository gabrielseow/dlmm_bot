# Phase 0 Research: DLMM Pair Discovery & Screening

All Technical Context items resolved; no NEEDS CLARIFICATION remain. The spec,
constitution, existing codebase, and pinned Meteora OpenAPI spec
(`spec/meteora-api.json` → `src/generated/meteora-api.d.ts`) fully determine the
choices below.

## Decision 1 — Data source & endpoint: `GET /pools` (paginated)

- **Decision**: Source the pool universe through the existing typed client
  `meteoraApi.GET('/pools', …)`. Paginate using `page` / `page_size` (max 1000)
  until `current_page >= pages`. Each row (`PaginationResponse_PoolResponse.data[]`)
  exposes everything the spec needs: `address`, `name`, `token_x`/`token_y`
  (`TokenMetrics`), `tvl`, `fees` / `volume` / `fee_tvl_ratio` as `TimeWindowData`
  (`30m` `1h` `2h` `4h` `12h` `24h`), `pool_config` (`bin_step`, `base_fee_pct`),
  `created_at`, and `is_blacklisted`.
- **Rationale**: Single endpoint returns all required fields; honors Constitution
  Principle II (pinned, typed client; no untyped `fetch`). `/pools/{address}` is
  reserved for spot-checks/verification, not bulk scan.
- **Alternatives considered**:
  - *On-chain via `@meteora-ag/dlmm`*: rejected — far slower, requires RPC, and
    duplicates data the API already aggregates; against the read-only/60s goal.
  - *`/pools/groups`*: rejected — collapses same-pair pools, conflicting with the
    edge case requiring each pool ranked on its own merits (spec Edge Cases).

## Decision 2 — Compute indicators in our own pure core (don't trust API ratio)

- **Decision**: Treat the API's `fees[window]`, `volume[window]`, `tvl` as raw
  inputs and compute `feeToTvl = fees[window] / tvl` and
  `volumeToTvl = volume[window] / tvl` ourselves in `indicators.ts`. The API's
  `fee_tvl_ratio` field is retained only as a cross-check/diagnostic.
- **Rationale**: FR-002 mandates the system compute the ratio; SC-004 requires it
  to match an independent manual calculation with zero discrepancy. Owning the
  math makes it a pure, unit-tested function (Principle IV) and keeps determinism
  under our control rather than depending on opaque server rounding.
- **Alternatives considered**: *Sort/filter entirely server-side via `sort_by` /
  `filter_by`*: rejected as the source of truth — server ordering is convenient
  but not verifiable offline and not guaranteed deterministic across calls. We MAY
  pass a server-side `filter_by` (e.g. `is_blacklisted=false`) as a cheap
  pre-filter, but the authoritative eligibility + ranking happen in our core.

## Decision 3 — Measurement window: configurable, default `24h`

- **Decision**: `ScreeningCriteria.window` is one of the API's supported windows
  (`30m` `1h` `2h` `4h` `12h` `24h`); default `24h`. The selected window indexes
  into `fees`/`volume` `TimeWindowData`.
- **Rationale**: Matches spec Assumptions (trailing 24h default, configurable,
  bounded by source granularity). Note `5m` appears in the sort-param docs but is
  **not** a key on `TimeWindowData`, so it is excluded from the allowed set.
- **Alternatives considered**: *Custom windows via `/volume/history` or `/ohlcv`*:
  deferred — adds per-pool calls (breaks the 60s budget) and is unnecessary for P1.

## Decision 4 — Eligibility & degenerate-input rules (pure)

- **Decision**: A pool is **ineligible** (excluded, with a recorded reason) if:
  `tvl` is missing/≤0 (FR-006); `fees[window]` or `volume[window]` is
  missing/`null`/`NaN` (FR-007, distinct from a legitimate `0`); or it fails any
  configured threshold (FR-005). Indicator functions never return `Infinity`/`NaN`:
  guards run before division. Ineligible pools are reported in a separate
  `ineligible` collection with reasons rather than silently dropped.
- **Rationale**: Directly encodes spec Edge Cases and SC-002/SC-003. Keeping
  reasons preserves traceability (US1 acceptance #3).
- **Alternatives considered**: *Silent drop of bad rows*: rejected — violates the
  "flagged, not silently dropped" requirement and hides data-quality issues.

## Decision 5 — Determinism & tie-breaking

- **Decision**: Rank by selected indicator descending; break ties by a stable
  secondary key (`tvl` desc, then `address` asc) so equal-ratio pools always order
  identically. Sorting is a total order over a fully-materialized array — no
  reliance on input/network order.
- **Rationale**: FR-009 / SC-005 require identical sets and ordering across runs.
  A pure comparator over all fetched rows guarantees this; the float ratio alone
  could tie, so the deterministic secondary keys are required.
- **Alternatives considered**: *Trust array order from the API*: rejected — order
  is not contractually stable.

## Decision 6 — Fail-closed on data-source failure

- **Decision**: If any page fetch errors or pagination cannot complete, the run
  aborts with a non-zero exit code and a clear message, emitting **no** candidate
  list. Partial pages are never serialized as a complete result.
- **Rationale**: FR-012 / SC-008 — a failed retrieval must be unmistakably
  distinct from a legitimately empty result.
- **Alternatives considered**: *Best-effort partial results*: rejected — risks an
  operator acting on a truncated ranking believed complete.

## Decision 7 — Testing toolchain: `node:test` via `tsx`

- **Decision**: Unit tests use Node's built-in `node:test` + `node:assert`, run
  with `node --import tsx --test tests/unit/*.test.ts`. No new dependencies (`tsx`
  is already used by `npm run dev`).
- **Rationale**: Operator-confirmed. Satisfies Principle IV's test mandate with
  zero added toolchain surface, honoring the constitution's dependency discipline.
- **Alternatives considered**: *Vitest/Jest*: rejected for P1 — heavier dep tree;
  no snapshot/watch needs that `node:test` can't cover for a pure numeric core.

## Decision 8 — Configuration surface

- **Decision**: `config.ts` reads from environment variables with documented
  defaults: `SCREEN_WINDOW` (default `24h`), `SCREEN_INDICATOR`
  (`fee_to_tvl`|`volume_to_tvl`, default `fee_to_tvl`), `SCREEN_MIN_TVL`,
  `SCREEN_MIN_VOLUME`, `SCREEN_TOP_N` (optional cap), `METEORA_BASE_URL`
  (defaults to the pinned base in `meteora.ts`), `SCREEN_NETWORK` (default
  `mainnet`), `SCREEN_OUTPUT` (file path; stdout if unset). Validation rejects
  unknown windows/indicators and negative thresholds.
- **Rationale**: FR-011 (all params from config), FR-013/SC-006 (re-run + change
  thresholds with no code edit), Principle V (network unambiguous; endpoint
  configurable; no secrets — the read API is unauthenticated).
- **Alternatives considered**: *CLI flags*: viable later, but env + defaults is the
  minimal config surface that meets every requirement now; flags can layer on.
