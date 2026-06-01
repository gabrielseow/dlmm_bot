# Contract: Simulator CLI

The operator-facing interface for Part 2. Invoked in one command with no code
changes (SC-001, FR-014). All parameters come from environment variables;
`config.ts` is the single source of truth and validates them before any I/O.

## Invocation

```bash
npm run simulate        # tsx src/simulator/cli.ts
```

(`simulate` script to be added to `package.json`.)

## Configuration (environment variables)

| Variable | Required | Default | Meaning |
|----------|----------|---------|---------|
| `SIM_POOL` | yes | — | Base58 pool address to simulate. |
| `SIM_DEPOSIT_X` | one of X/Y or USD | — | Deposited token-X amount (decimal). |
| `SIM_DEPOSIT_Y` | one of X/Y or USD | — | Deposited token-Y amount (decimal). |
| `SIM_DEPOSIT_USD` | one of X/Y or USD | — | Total deposit in USD (split per shape/range). |
| `SIM_RANGE_LOWER` | with `_UPPER` | — | Lower price bound of the range. |
| `SIM_RANGE_UPPER` | with `_LOWER` | — | Upper price bound of the range. |
| `SIM_BIN_LOWER` | alt to price range | — | Lower bin id (overrides price range). |
| `SIM_BIN_UPPER` | alt to price range | — | Upper bin id. |
| `SIM_SHAPE` | no | `spot` | `spot` \| `curve` \| `bid_ask`. |
| `SIM_TIMEFRAME` | no | `1h` | `5m`\|`30m`\|`1h`\|`2h`\|`4h`\|`12h`\|`24h`. |
| `SIM_START` | no | inferred | Window start, unix seconds. |
| `SIM_END` | no | now | Window end, unix seconds. |
| `SIM_LIQUIDITY_SOURCE` | no | `aggregated` | `aggregated` (TVL estimate) \| `snapshot` (on-chain bins). |
| `SIM_TOLERANCE` | no | `0.10` | Relative tolerance for verification (10%). |
| `SIM_VERIFY_USER` | no | — | Wallet for verification ground truth. |
| `SIM_VERIFY_POSITION` | no | — | Specific position address to reconcile against. |
| `METEORA_BASE_URL` | no | pinned base in `meteora.ts` | API endpoint. |
| `SIM_RPC_URL` | snapshot tier only | — | Solana RPC for on-chain bin snapshot. |
| `SIM_NETWORK` | no | `mainnet` | Network selection (unambiguous, Principle V). |
| `SIM_OUTPUT` | no | stdout | File path for the JSON result. |

### Validation rules (fail before I/O, exit 2)

- `SIM_POOL` present and non-empty.
- Exactly one deposit form supplied and all amounts `> 0` (zero deposit → reject, SC-005).
- Range valid: `lower < upper` (price) or `binLower ≤ binUpper`; inverted/empty → reject.
- `SIM_SHAPE` / `SIM_TIMEFRAME` in the allowed sets.
- `SIM_START < SIM_END` when both given.
- `SIM_TOLERANCE` ≥ 0.
- `SIM_LIQUIDITY_SOURCE=snapshot` requires `SIM_RPC_URL`.
- Verification (`SIM_VERIFY_*`) requires `SIM_VERIFY_USER`.

## Output

A single `SimulationResult` JSON object (see
`simulation-result.schema.json`) to `SIM_OUTPUT` or stdout, plus a concise
human-readable summary to stderr (fees, value, IL, net PnL, fidelity, and
verification status when run). The machine-readable JSON is the contract for
hand-off to later pipeline parts (FR-013).

## Exit codes

| Code | Condition |
|------|-----------|
| `0` | Simulation completed; `status` is `ok`. Includes a `fail`/`could_not_verify` verification outcome (the run succeeded; the *figure* is reported, never hidden). |
| `2` | Invalid configuration (validation rules above) — no I/O attempted. |
| `3` | Data-source failure or insufficient data: the run produced `status = could_not_compute` (missing OHLCV/volume coverage). Distinct from a legitimate zero-fee result, which exits `0` (FR-010, SC-008). |

Rationale: mirrors Part 1's fail-distinct, fail-closed exit policy. A verification
breach is **not** a non-zero exit — surfacing the discrepancy *is* the success
condition (US2 #2/#3); only an inability to compute the figure at all is `3`.
