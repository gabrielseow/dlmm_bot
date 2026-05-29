# Contract: Screener CLI

The discovery feature exposes one operator-facing interface: a CLI command that
runs a full screening pass and emits a `ScreeningResult`. This is the contract
that satisfies SC-001 (one command, no code changes) and FR-013 (re-runnable).

## Invocation

```bash
npm run screen
```

`screen` maps to `tsx src/discovery/cli.ts`. The command takes **no positional
arguments**; all parameters come from configuration (FR-011).

## Configuration (environment variables)

| Variable | Allowed values | Default | Maps to |
|----------|----------------|---------|---------|
| `SCREEN_WINDOW` | `30m` `1h` `2h` `4h` `12h` `24h` | `24h` | `criteria.window` |
| `SCREEN_INDICATOR` | `fee_to_tvl` `volume_to_tvl` | `fee_to_tvl` | `criteria.indicator` |
| `SCREEN_MIN_TVL` | number ≥ 0 (USD) | `0` | `criteria.minTvl` |
| `SCREEN_MIN_VOLUME` | number ≥ 0 (USD) | `0` | `criteria.minVolume` |
| `SCREEN_TOP_N` | integer > 0 | (unset = all) | `criteria.topN` |
| `SCREEN_SORT` | `desc` `asc` | `desc` | `criteria.sortDirection` |
| `SCREEN_NETWORK` | `mainnet` `devnet` | `mainnet` | `criteria.network` |
| `METEORA_BASE_URL` | URL | client default | `criteria.baseUrl` |
| `SCREEN_OUTPUT` | file path | (unset = stdout) | `criteria.output` |
| `SCREEN_NEW_POOL_MAX_AGE_SEC` | integer > 0 | `86400` | `criteria.newPoolMaxAgeSec` |

Invalid configuration (unknown enum, negative threshold, malformed number) MUST
cause the command to **abort before any network call** with a clear message and
exit code `2`.

## Output

- **Primary**: a JSON document conforming to
  [`screening-result.schema.json`](./screening-result.schema.json), written to
  `SCREEN_OUTPUT` if set, otherwise to **stdout**.
- **Secondary (human)**: a ranked table printed to **stderr** (so stdout stays
  clean for piping the JSON), showing rank, pair, bin step, TVL, fees(window),
  volume(window), fee-to-TVL, volume-to-TVL, and a `NEW`/`*` marker for newly
  created pools.

## Exit codes (fail-closed; FR-012 / SC-008)

| Code | Meaning |
|------|---------|
| `0` | Full scan completed; a valid `ScreeningResult` (possibly with empty `candidates`) was emitted. `status:"complete"`. |
| `2` | Invalid configuration — no fetch attempted, no result emitted. |
| `3` | Data-source failure or incomplete pagination — **no** result emitted; stale/partial data is never printed as complete. |

A legitimately empty result (`candidates: []`, `status:"complete"`, exit `0`) is
distinct from a data-source failure (exit `3`, no JSON document). Consumers MUST
treat any non-zero exit as "no valid ranking produced".

## Determinism guarantee (FR-009 / SC-005)

Given identical upstream data, two runs produce byte-identical `candidates` and
`ineligible` arrays (same set, same order). Only `generatedAt` differs; consumers
comparing runs MUST ignore `generatedAt`.
