<!--
SYNC IMPACT REPORT
==================
Version change: (template, unversioned) → 1.0.0
Bump rationale: Initial ratification — all placeholder tokens replaced with concrete,
project-specific principles. First adopted version.

Modified principles: N/A (initial adoption)
  - [PRINCIPLE_1_NAME] → I. Type Safety Is Non-Negotiable
  - [PRINCIPLE_2_NAME] → II. External API Contracts Are Pinned & Verified
  - [PRINCIPLE_3_NAME] → III. Simulate Before Execute (Capital Safety)
  - [PRINCIPLE_4_NAME] → IV. Deterministic, Testable Financial Core
  - [PRINCIPLE_5_NAME] → V. Configuration & Secrets Hygiene

Added sections:
  - Technology & Domain Constraints (was [SECTION_2_NAME])
  - Development Workflow & Quality Gates (was [SECTION_3_NAME])

Removed sections: None

Templates requiring updates:
  - .specify/templates/plan-template.md          ✅ reviewed — generic "Constitution Check"
    gate references the constitution dynamically; no edit needed.
  - .specify/templates/spec-template.md          ✅ reviewed — no mandatory-section conflict.
  - .specify/templates/tasks-template.md         ✅ reviewed — Principle IV's test mandate is
    scoped to financial-core logic; template's "tests OPTIONAL" note remains valid for the
    rest, so no edit needed.
  - .specify/templates/checklist-template.md     ✅ reviewed — no conflict.
  - .claude/skills/speckit-*/SKILL.md (commands) ✅ reviewed — no outdated agent-name
    references requiring genericization.

Follow-up TODOs: None — no placeholders deferred.
-->

# DLMM Bot Constitution

## Core Principles

### I. Type Safety Is Non-Negotiable

The codebase MUST compile under TypeScript `strict` mode (including
`noUncheckedIndexedAccess`) with zero type errors. The `any` type and unchecked
type assertions (`as`) are prohibited in business logic except at clearly
documented external boundaries, and each such use MUST carry a comment stating
why it is safe. `npm run typecheck` MUST pass before any change is merged.

**Rationale**: This bot computes and moves real on-chain capital. A runtime type
surprise in fee, price, or position math can translate directly into lost funds;
the compiler is the cheapest place to catch those errors.

### II. External API Contracts Are Pinned & Verified

The Meteora API surface MUST be consumed through generated types
(`src/generated/`) produced from the pinned OpenAPI spec in `spec/`. Generated
files MUST NOT be hand-edited. The pinned spec is updated only via the
`update:api` workflow, and `check:api` MUST be run to detect drift before relying
on remote behaviour. Direct, untyped `fetch` calls to the Meteora API are
prohibited; use the typed client in `src/meteora.ts`.

**Rationale**: Silent upstream API drift is the most likely way trading logic
breaks without a code change. Pinning + drift detection makes every contract
change explicit and reviewable.

### III. Simulate Before Execute (Capital Safety)

Any code path that can sign, submit, or otherwise mutate on-chain state MUST
default to read-only / dry-run behaviour. Executing a live transaction (and
selecting mainnet over devnet) MUST require an explicit, intentional opt-in —
never a default, never an implicit fallback. New position or trading strategies
MUST be modelled by the simulator and produce expected outcomes before any
live-execution path is wired in.

**Rationale**: The cost of an accidental live transaction is irreversible loss of
real capital. Defaults must fail safe toward "do nothing".

### IV. Deterministic, Testable Financial Core

Financial calculations — fees, APR, PnL, bin/liquidity math, position simulation —
MUST be implemented as pure, deterministic functions isolated from I/O (RPC,
network, wallet, clock). This core logic MUST have unit tests covering normal,
boundary, and degenerate inputs. Network/RPC access lives at the edges and is
injected, never embedded inside calculation functions.

**Rationale**: Money math must be verifiable offline and reproducibly. Coupling it
to live RPC makes it untestable and non-deterministic, which is unacceptable for
correctness-critical financial code.

### V. Configuration & Secrets Hygiene

Private keys, wallet seeds, and credentials MUST NEVER be committed to the
repository or hard-coded in source. RPC endpoints, wallet references, pool
addresses, and network selection (mainnet/devnet) MUST come from configuration or
environment, not magic literals scattered through the code. The active network
MUST be unambiguous at runtime.

**Rationale**: A leaked key is an immediate, total loss of the associated funds,
and ambiguous network configuration is a direct route to executing on the wrong
chain with real money.

## Technology & Domain Constraints

- **Language/runtime**: TypeScript on Node.js, ES modules (`"type": "module"`),
  `verbatimModuleSyntax` and `isolatedModules` enabled. New code MUST follow ESM
  import conventions already in use (e.g. explicit `.js` import specifiers).
- **Core dependencies**: `@meteora-ag/dlmm`, `@solana/web3.js`,
  `@coral-xyz/anchor`, `openapi-fetch`. Adding a new runtime dependency that
  overlaps an existing one MUST be justified against Principle IV (a small,
  testable core) before adoption.
- **Build/typecheck**: `npm run build` (which runs `tsc --noEmit` then bundles)
  and `npm run typecheck` are the authoritative build gates.
- **Domain**: This is a Solana DLMM (Dynamic Liquidity Market Maker) bot. All
  on-chain assumptions (bin math, decimals, slippage) MUST be treated as
  correctness-critical, not cosmetic.

## Development Workflow & Quality Gates

- Every change MUST pass `npm run typecheck` before merge (Principle I).
- Changes touching the Meteora API client MUST run `npm run check:api`; if drift
  is reported, resolve it via `update:api` + `gen:api` in a dedicated, reviewable
  change (Principle II).
- Changes to financial-core logic MUST include or update unit tests (Principle IV).
- Live-execution / signing paths MUST be reviewed against Principle III before
  merge, with explicit confirmation that safe defaults are preserved.
- Feature work follows the Spec Kit flow: specify → clarify (as needed) → plan →
  tasks → implement, with the Constitution Check gate in the plan honoured.

## Governance

This constitution supersedes ad-hoc practices for the DLMM Bot project. When a
practice and this document conflict, this document wins.

- **Amendments**: Proposed via a change to this file that states the rationale and
  the new version. An amendment is adopted when merged to the main branch.
- **Versioning**: Semantic versioning of the constitution itself —
  - MAJOR: backward-incompatible governance changes or removal/redefinition of a
    principle.
  - MINOR: a new principle or section, or materially expanded mandatory guidance.
  - PATCH: clarifications and wording fixes that do not change obligations.
- **Compliance**: Every plan's Constitution Check gate and every code review MUST
  verify adherence to the principles above. Deviations MUST be justified in the
  plan's Complexity Tracking section or the change is not approved.
- **Runtime guidance**: Agent and contributor runtime guidance lives in
  `CLAUDE.md` and the current feature plan; those documents MUST NOT contradict
  this constitution.

**Version**: 1.0.0 | **Ratified**: 2026-05-29 | **Last Amended**: 2026-05-29
