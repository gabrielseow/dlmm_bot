# dlmm_bot

Tooling for a DLMM (Meteora) liquidity-provision pipeline.

## Pair Discovery & Screening (Part 1)

A **read-only** screener that retrieves the universe of Meteora DLMM pools,
computes fee-efficiency indicators (fee-to-TVL, volume-to-TVL) over a configurable
window, filters out dust/illiquid pools, and emits a deterministic, ranked,
machine-readable candidate list. No wallet, signing, or on-chain mutation.

### Run

```bash
npm run screen
```

- **stdout**: a JSON `ScreeningResult`
  ([schema](specs/001-dlmm-pair-discovery/contracts/screening-result.schema.json)).
- **stderr**: a human-readable ranked table.

> **Piping the JSON?** Use `npm run --silent screen > out.json` so npm's own
> run banner doesn't land on stdout. For hand-off, prefer `SCREEN_OUTPUT=<path>`,
> which writes clean JSON straight to a file regardless of `--silent`.

### Configuration (environment variables)

| Variable | Allowed values | Default | Meaning |
|----------|----------------|---------|---------|
| `SCREEN_WINDOW` | `30m` `1h` `2h` `4h` `12h` `24h` | `24h` | Measurement window |
| `SCREEN_INDICATOR` | `fee_to_tvl` `volume_to_tvl` | `fee_to_tvl` | Ranking signal |
| `SCREEN_MIN_TVL` | number ≥ 0 (USD) | `0` | Minimum TVL threshold |
| `SCREEN_MIN_VOLUME` | number ≥ 0 (USD) | `0` | Minimum window-volume threshold |
| `SCREEN_TOP_N` | integer > 0 | (all) | Cap on returned candidates |
| `SCREEN_SORT` | `desc` `asc` | `desc` | Sort direction |
| `SCREEN_NETWORK` | `mainnet` `devnet` | `mainnet` | Target network |
| `METEORA_BASE_URL` | URL | pinned default | Data-source endpoint |
| `SCREEN_OUTPUT` | file path | (stdout) | Write JSON to a file instead of stdout |
| `SCREEN_NEW_POOL_MAX_AGE_SEC` | integer > 0 | `86400` | Age under which a pool is flagged `NEW*` |

Invalid configuration (unknown enum, negative threshold, malformed number) aborts
**before any network call**.

### Exit codes (fail-closed)

| Code | Meaning |
|------|---------|
| `0` | Full scan completed; valid result emitted (may have empty `candidates`). |
| `2` | Invalid configuration — no fetch attempted, no result. |
| `3` | Data-source failure / incomplete scan — **no** result emitted. |

A legitimately empty result (exit `0`, `candidates: []`) is distinct from a
data-source failure (exit `3`, no JSON). Treat any non-zero exit as "no valid
ranking produced".

### Examples

```bash
# Filter dust, pick a window
SCREEN_MIN_TVL=10000 SCREEN_MIN_VOLUME=50000 SCREEN_WINDOW=1h npm run screen

# Rank by volume-to-TVL, top 20
SCREEN_INDICATOR=volume_to_tvl SCREEN_TOP_N=20 npm run screen

# Save a clean candidate list for hand-off
SCREEN_OUTPUT=./out/candidates.json npm run screen
```

See [`specs/001-dlmm-pair-discovery/quickstart.md`](specs/001-dlmm-pair-discovery/quickstart.md)
for the full walkthrough and success-criteria checklist.

### Tests

```bash
npm test          # pure financial-core unit tests (node:test via tsx)
npm run typecheck # strict TypeScript
npm run check:api # verify the pinned Meteora spec matches remote
```

> Note: the Meteora API enforces a **30 QPS** limit. The screener paginates
> sequentially (one request in flight), well within that ceiling.
