---
description: "Task list for DLMM Pair Discovery & Screening"
---

# Tasks: DLMM Pair Discovery & Screening

**Input**: Design documents from `/specs/001-dlmm-pair-discovery/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Unit tests for the pure financial core are INCLUDED — mandated by
Constitution Principle IV (Deterministic, Testable Financial Core) and enumerated
in plan.md (`tests/unit/indicators.test.ts`, `tests/unit/screen.test.ts`). Tests
target only the pure core; the I/O edge and CLI shell are validated via quickstart.

**Organization**: Tasks are grouped by user story to enable independent
implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in every task

## Path Conventions

Single project extending the existing `src/`. New feature code lives in
`src/discovery/`; pure-core unit tests in `tests/unit/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project scaffolding so the feature is runnable in one command (SC-001)

- [X] T001 Create the feature directory structure: `src/discovery/` and `tests/unit/` at repository root
- [X] T002 [P] Add `"screen": "tsx src/discovery/cli.ts"` and `"test": "node --import tsx --test tests/unit/*.test.ts"` scripts to `package.json` (replace the placeholder `test` script)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Domain types, configuration, and the I/O edge that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 [P] Define domain types and enumerations in `src/discovery/types.ts`: `MeasurementWindow`, `Indicator`, `Network`, `IneligibilityReason`, plus `PoolRow`, `ScreeningCriteria`, `CandidatePair`, `IneligiblePool`, `ScreeningResult` per data-model.md (numeric API fields preserved as "missing" when null/NaN, never coerced to 0)
- [X] T004 Implement configuration loader/validator in `src/discovery/config.ts`: read `SCREEN_WINDOW`, `SCREEN_INDICATOR`, `SCREEN_MIN_TVL`, `SCREEN_MIN_VOLUME`, `SCREEN_TOP_N`, `SCREEN_SORT`, `SCREEN_NETWORK`, `METEORA_BASE_URL`, `SCREEN_OUTPUT`, `SCREEN_NEW_POOL_MAX_AGE_SEC` with documented defaults; reject unknown enum / negative threshold / malformed number → produce a `ScreeningCriteria` or a validation error mapped to exit code 2 (FR-011, contracts/screener-cli.md)
- [X] T005 Implement the I/O edge in `src/discovery/fetch-pools.ts`: paginate `meteoraApi.GET('/pools', …)` via `page`/`page_size` (≤1000) until `current_page >= pages`, normalize each row to `PoolRow[]` (preserving missing numerics), and fail-closed by throwing on any page error or incomplete pagination — never return a partial universe as complete (FR-001, FR-012, Decision 1, Decision 6). This is the ONLY discovery module importing `src/meteora.ts`

**Checkpoint**: Foundation ready — types, config, and a fail-closed pool fetch exist; user story work can begin

---

## Phase 3: User Story 1 - Rank pools by fee-to-TVL (Priority: P1) 🎯 MVP

**Goal**: Scan the DLMM pool universe and emit pools ranked by descending
fee-to-TVL (the selected indicator), each row showing pair, TVL, window fees, and
the computed ratio.

**Independent Test**: Run `npm run screen` against the current pool universe and
confirm it returns pools ordered by descending fee-to-TVL, each with its computed
ratio, TVL, fees, and measurement window visible; spot-check that ratios are
correct and ordering is right, with no code changes to run it.

### Tests for User Story 1 ⚠️

> Write these FIRST and ensure they FAIL before implementing the core.

- [X] T006 [P] [US1] Unit tests for indicators in `tests/unit/indicators.test.ts`: `feeToTvl`/`volumeToTvl` on normal inputs match `fees/tvl` to full precision (SC-004); zero/missing/NaN TVL never yields `Infinity`/`NaN` (SC-003); `selectWindow` extracts the correct `TimeWindowData` key and reports missing fee/volume as missing (FR-006, FR-007)
- [X] T007 [P] [US1] Unit tests for ranking in `tests/unit/screen.test.ts`: descending order by selected indicator; equal-ratio pools tie-break by `tvl` desc then `address` asc (Decision 5); zero/missing-TVL and missing fee/volume pools are routed to `ineligible` with the correct `IneligibilityReason`, never into `candidates` (FR-003, FR-006, FR-007)

### Implementation for User Story 1

- [X] T008 [US1] Implement the pure indicator functions in `src/discovery/indicators.ts`: `selectWindow(data, window)`, `feeToTvl(fees, tvl)`, `volumeToTvl(volume, tvl)` — guards run before division so results are always finite real numbers (FR-002, FR-006, FR-007, Decision 2)
- [X] T009 [US1] Implement eligibility + ranking in `src/discovery/screen.ts`: classify each `PoolRow` as eligible or `IneligiblePool` (missing/zero TVL, missing fee/volume), compute `CandidatePair` fields incl. `rankingScore` from `criteria.indicator` and `isNewPool` from `createdAt`/`newPoolMaxAgeSec`, then `rank()` with the deterministic comparator (selected indicator + tie-breaks) and assign 1-based `rank` (FR-003, FR-004, FR-006, FR-007, FR-009, Decision 5)
- [X] T010 [US1] Implement output formatting in `src/discovery/format.ts`: render a ranked human table to **stderr** (rank, pair, bin step, TVL, window fees, window volume, fee-to-TVL, volume-to-TVL, `NEW`/`*` marker) and serialize the ranked `candidates` as JSON (FR-008, contracts/screener-cli.md)
- [X] T011 [US1] Implement the CLI entrypoint in `src/discovery/cli.ts`: wire config → fetch-pools → screen → format; JSON to stdout (or `SCREEN_OUTPUT` later), table to stderr; exit `0` on a complete scan, `2` on invalid config (before any fetch), `3` on data-source failure with no result emitted (SC-001, SC-007, SC-008, contracts/screener-cli.md)

**Checkpoint**: `npm run screen` produces a correct descending fee-to-TVL ranking — MVP is independently functional and testable

---

## Phase 4: User Story 2 - Filter out noise with configurable thresholds (Priority: P2)

**Goal**: Exclude dust/illiquid pools via configurable minimum TVL and minimum
volume so the ranking surfaces realistically investable pairs.

**Independent Test**: Set `SCREEN_MIN_TVL` and `SCREEN_MIN_VOLUME`, run the
screener, and confirm every candidate satisfies all thresholds and every
sub-threshold pool is absent from `candidates` (appears under `ineligible` with a
reason).

### Tests for User Story 2 ⚠️

- [X] T012 [P] [US2] Unit tests for threshold exclusion in `tests/unit/screen.test.ts` (append): pools with `tvl < minTvl` get reason `below_min_tvl`; pools with `volume[window] < minVolume` get reason `below_min_volume`; no sub-threshold pool ever appears in `candidates` (SC-002); changing a threshold value changes the candidate set (SC-006)

### Implementation for User Story 2

- [X] T013 [US2] Add `applyThresholds()` to `src/discovery/screen.ts` and invoke it in the eligibility pass: exclude any pool failing `minTvl` or `minVolume`, recording the first failing `IneligibilityReason` in deterministic order, so the threshold check is enforced before ranking (FR-005, SC-002)

**Checkpoint**: Thresholds from config are enforced — US1 ranking now filtered; both stories work independently

---

## Phase 5: User Story 3 - Produce a consumable, repeatable candidate list (Priority: P3)

**Goal**: Deliver the screening result as a structured, schema-conformant,
machine-readable artifact that is deterministic across runs and writable to a file
for hand-off to Part 2.

**Independent Test**: Run the screener and confirm it emits a structured result
where each entry includes pair identity, pool id, TVL, fees, volume, window, and
computed indicators; run it twice on unchanged data and confirm identical
`candidates`/`ineligible` sets and ordering (only `generatedAt` differs).

### Tests for User Story 3 ⚠️

- [X] T014 [P] [US3] Determinism unit test in `tests/unit/screen.test.ts` (append): screening the same `PoolRow[]` twice yields byte-identical `candidates` and `ineligible` arrays (same set, same order) ignoring `generatedAt` (FR-009, SC-005)

### Implementation for User Story 3

- [X] T015 [US3] Assemble the full `ScreeningResult` envelope in `src/discovery/screen.ts`/`format.ts`: `generatedAt` (ISO 8601 UTC), `criteria` (exact params used), `poolUniverseCount`, ranked `candidates` (capped at `topN` when set), `ineligible` with reasons, and `status: "complete"` emitted only on a full successful scan (FR-008, FR-012, data-model.md)
- [X] T016 [US3] Implement `SCREEN_OUTPUT` file writing in `src/discovery/cli.ts`/`format.ts`: write the JSON `ScreeningResult` to the configured path when set, otherwise stdout, keeping stdout clean for piping (FR-008, contracts/screener-cli.md)
- [X] T017 [US3] Validate the emitted JSON against `specs/001-dlmm-pair-discovery/contracts/screening-result.schema.json` (spot-check a real run's output conforms to the schema) (FR-008)

**Checkpoint**: All user stories independently functional; output is structured, deterministic, and file-exportable

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verification and hygiene spanning all stories

- [X] T018 [P] Run `npm run typecheck` and `npm run check:api` and resolve any failures (Constitution Principles I & II)
- [X] T019 [P] Run the full unit suite `npm run test` and confirm all pure-core tests pass (Principle IV)
- [X] T020 Execute the quickstart.md validation checklist (SC-001 through SC-008), including the bad-`METEORA_BASE_URL` fail-closed check (exit 3, no JSON) and the deterministic double-run check
- [X] T021 [P] Document the `screen` command and its env-var surface in the project README (or `specs/001-dlmm-pair-discovery/quickstart.md` cross-link)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3–5)**: All depend on Foundational completion
  - US1 (P1) is the MVP and should be completed first
  - US2 (P2) and US3 (P3) build on the US1 core but are independently testable
- **Polish (Phase 6)**: Depends on the desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. Delivers the ranked list (MVP).
- **US2 (P2)**: Depends on Foundational; extends `screen.ts` eligibility with
  threshold enforcement. Independently testable; does not require US3.
- **US3 (P3)**: Depends on Foundational; formalizes the `ScreeningResult`
  envelope, file output, and determinism around the US1 ranking. Independently
  testable; does not require US2.

### Within Each User Story

- Tests (T006/T007, T012, T014) are written FIRST and must FAIL before implementation
- `indicators.ts` (T008) before `screen.ts` ranking (T009)
- `screen.ts` core before `format.ts` (T010) before `cli.ts` (T011)
- US2's `applyThresholds` (T013) and US3's envelope (T015) modify `screen.ts` — sequence them after T009

### Parallel Opportunities

- T002 (Setup) is independent and `[P]`
- Foundational: T003 (types) is `[P]`; T004 (config) and T005 (fetch) can proceed once types exist
- US1 tests T006 and T007 target different files and run in parallel `[P]`
- Across stories, the test-authoring tasks (T006/T007, T012, T014) are `[P]` relative to each other once Foundational is done
- Polish T018, T019, T021 are `[P]`

---

## Parallel Example: User Story 1

```bash
# Author the failing core tests together (different files):
Task: "Unit tests for indicators in tests/unit/indicators.test.ts"   # T006
Task: "Unit tests for ranking in tests/unit/screen.test.ts"          # T007

# Then implement the pure core in dependency order:
#   indicators.ts (T008) → screen.ts (T009) → format.ts (T010) → cli.ts (T011)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1 (write failing tests → implement core → CLI)
4. **STOP and VALIDATE**: `npm run screen` returns a correct descending
   fee-to-TVL ranking; `npm run test` passes
5. Demo the MVP — an operator can already make informed manual LP decisions

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → ranked list (MVP) → validate → demo
3. US2 → threshold filtering → validate → demo
4. US3 → structured, deterministic, exportable result → validate → demo
5. Polish → typecheck, full suite, quickstart validation

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps each task to its user story for traceability
- US2 (T013) and US3 (T015) both edit `src/discovery/screen.ts` — do not run them
  in parallel with each other
- Verify the failing tests before implementing the corresponding core
- Read-only throughout: no signing, no wallet, no on-chain mutation (FR-010)
- Commit after each task or logical group
