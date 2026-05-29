# Implementation Plan: DLMM Pair Discovery & Screening

**Branch**: `001-dlmm-pair-discovery` | **Date**: 2026-05-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-dlmm-pair-discovery/spec.md`

## Summary

Part 1 of the DLMM liquidity-provision pipeline: a **read-only** screener that
retrieves the universe of Meteora DLMM pools, computes fee-efficiency indicators
(primarily **fee-to-TVL**, plus volume-to-TVL) over a configurable measurement
window, filters out dust/illiquid pools via configurable thresholds, and emits a
**deterministic, ranked, machine-readable candidate list** for hand-off to Part 2.

Technical approach: a thin I/O edge (the pinned `openapi-fetch` Meteora client in
`src/meteora.ts`) fetches raw pool rows; a **pure, deterministic financial core**
(`src/discovery/`) computes indicators, applies eligibility rules, and ranks. A
small CLI entrypoint wires config → fetch → core → structured output. All money
math lives in pure functions with `node:test` unit tests covering normal,
boundary, and degenerate inputs. No signing, no on-chain mutation, no wallet.

## Technical Context

**Language/Version**: TypeScript 6.x on Node.js (ESM, `"type": "module"`,
`verbatimModuleSyntax` + `isolatedModules`, explicit `.js` import specifiers)

**Primary Dependencies**: `openapi-fetch` (typed Meteora client via
`src/generated/meteora-api.d.ts`). No new runtime dependencies. Discovery does
**not** use `@solana/web3.js`, `@meteora-ag/dlmm`, or `@coral-xyz/anchor` — those
are execution-path libraries and discovery is read-only over the HTTP API.

**Storage**: Stateless. Output written to stdout and/or a JSON file passed via
config; no database.

**Testing**: Node built-in test runner (`node:test`) executed through `tsx`
(`node --import tsx --test`). Zero new dependencies, consistent with the
constitution's small-testable-core posture (Principle IV).

**Target Platform**: Local CLI / programmatic invocation on Node.js (operator's
machine). Single technical operator; no multi-tenant, auth, or UI.

**Project Type**: Single project (CLI + library core). Extends the existing
`src/` layout.

**Performance Goals**: Full scan of the current pool universe completes within
**60 s** under normal Meteora API availability (SC-007). The dominant cost is
paginated network fetch; core computation over the full universe is sub-second.

**Constraints**: Read-only (FR-010); deterministic output (FR-009); no
infinite/NaN indicators (FR-006/SC-003); fail-closed on data-source errors
(FR-012/SC-008) — never present stale/partial data as a complete ranking. All
operational parameters from config, not literals (FR-011).

**Scale/Scope**: Solana Meteora DLMM pools only. Pool universe is on the order of
hundreds–low thousands of pools; the API supports `page_size` up to 1000.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Type Safety Is Non-Negotiable | Code compiles under `strict` + `noUncheckedIndexedAccess`; no `any`/unchecked `as` in business logic; `npm run typecheck` passes. | ✅ PASS — pure-TS core, raw API rows typed via generated types; any boundary narrowing is documented. |
| II. External API Contracts Are Pinned & Verified | Meteora data consumed only through the typed `src/meteora.ts` client (generated from pinned `spec/meteora-api.json`); no direct/untyped `fetch`; `check:api` available. | ✅ PASS — discovery reuses `meteoraApi.GET('/pools', …)`; no new untyped calls. |
| III. Simulate Before Execute (Capital Safety) | No path that signs/submits/mutates on-chain state; live execution requires explicit opt-in. | ✅ PASS — discovery is strictly read-only (FR-010); no wallet, no signing imports. |
| IV. Deterministic, Testable Financial Core | Fee/ratio math is pure, deterministic, I/O-isolated, with unit tests for normal/boundary/degenerate inputs. | ✅ PASS — indicators + eligibility + ranking are pure functions in `src/discovery/`; `node:test` covers zero/missing TVL, dust, ties, missing fee/volume. |
| V. Configuration & Secrets Hygiene | Thresholds, indicator, window, network, endpoint from config/env, not literals; no secrets committed. | ✅ PASS — config module is the single source of parameters; the read API needs no credentials. |

**Result**: All gates pass. No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-dlmm-pair-discovery/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── screener-cli.md       # CLI invocation + exit-code contract
│   └── screening-result.schema.json  # Output JSON schema (FR-008)
├── checklists/
│   └── requirements.md  # (pre-existing)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── meteora.ts                  # EXISTING typed Meteora API client (I/O edge)
├── generated/
│   └── meteora-api.d.ts        # EXISTING generated types (pinned spec)
├── index.ts                    # EXISTING scratch entry (left as-is for now)
└── discovery/                  # NEW — Part 1
    ├── config.ts               # Load + validate ScreeningCriteria from env/defaults (FR-011)
    ├── types.ts                # PoolRow, CandidatePair, ScreeningResult, indicator/window enums
    ├── fetch-pools.ts          # I/O edge: paginate /pools via meteoraApi → PoolRow[] (FR-001, FR-012)
    ├── indicators.ts           # PURE: feeToTvl(), volumeToTvl(), selectWindow() (FR-002, FR-004, FR-006/007)
    ├── screen.ts               # PURE: applyThresholds() + rank() → ScreeningResult (FR-003, FR-005, FR-009)
    ├── format.ts               # Serialize ScreeningResult to JSON + human table (FR-008)
    └── cli.ts                  # Wires config → fetch → screen → format; exit codes (FR-013, SC-008)

tests/
└── unit/
    ├── indicators.test.ts      # zero/missing TVL, NaN/Inf guard, window selection
    └── screen.test.ts          # threshold exclusion, descending rank, tie-break, determinism
```

**Structure Decision**: Single project extending the existing `src/`. A new
`src/discovery/` package isolates the feature. The **pure financial core**
(`indicators.ts`, `screen.ts`) is fully separated from the **I/O edge**
(`fetch-pools.ts`, which is the only module importing `meteora.ts`) and from the
**CLI shell** (`cli.ts`). Tests target the pure core under `tests/unit/`. A
`screen` script will be added to `package.json` (`tsx src/discovery/cli.ts`) so
the operator runs it in one command with no code changes (SC-001, FR-013).

## Complexity Tracking

> No constitution violations. No entries.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
