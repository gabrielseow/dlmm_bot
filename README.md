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

## Position Simulator (Part 2)

A **read-only** simulator that models owning one Meteora DLMM liquidity position:
open a position (deposit + price/bin range + liquidity shape), accrue fees over a
window, claim, mark, and close — then report **fees earned** (the correctness-
critical output, traced per-bin) alongside position value, impermanent loss, and
net PnL. The fee figure is **verifiable** against real historical/live positions.
No wallet, signing, or on-chain mutation. The pure financial core
(`bins`, `fees`, `valuation`, `position`, `simulate`, `verify`) is deterministic
and I/O-isolated; the share denominator is injected, so identical inputs always
yield identical figures.

### Run

```bash
npm run simulate
```

- **stdout** (or `SIM_OUTPUT=<path>`): a JSON `SimulationResult`
  ([schema](specs/002-dlmm-position-simulator/contracts/simulation-result.schema.json)).
- **stderr**: a concise human summary (fees, valuation, lifecycle, fidelity).

### Configuration (environment variables)

| Variable | Required | Default | Meaning |
|----------|----------|---------|---------|
| `SIM_POOL` | yes | — | Base58 pool address to simulate |
| `SIM_DEPOSIT_USD` | one deposit form | — | Total deposit in USD… |
| `SIM_DEPOSIT_X` / `SIM_DEPOSIT_Y` | …or token amounts | — | Deposited token amounts (decimal) |
| `SIM_RANGE_LOWER` / `SIM_RANGE_UPPER` | a range form | — | Price bounds… |
| `SIM_BIN_LOWER` / `SIM_BIN_UPPER` | …or bin ids | — | Bin-id bounds (override prices) |
| `SIM_SHAPE` | no | `spot` | `spot` \| `curve` \| `bid_ask` |
| `SIM_TIMEFRAME` | no | `1h` | `5m` `30m` `1h` `2h` `4h` `12h` `24h` |
| `SIM_START` / `SIM_END` | no | inferred | Window bounds (unix seconds) |
| `SIM_LIQUIDITY_SOURCE` | no | `aggregated` | `aggregated` (TVL estimate) \| `snapshot` (on-chain) |
| `SIM_TOLERANCE` | no | `0.10` | Relative tolerance for verification |
| `SIM_VERIFY_USER` / `SIM_VERIFY_POSITION` | no | — | Reconcile against a real position |
| `SIM_RPC_URL` | snapshot only | — | Solana RPC for the on-chain bin snapshot |
| `METEORA_BASE_URL` | no | pinned | API endpoint |
| `SIM_NETWORK` | no | `mainnet` | Network selection |
| `SIM_OUTPUT` | no | stdout | File path for the JSON result |

### Exit codes (fail-closed)

| Code | Meaning |
|------|---------|
| `0` | Simulation completed (`status: ok`). A `fail`/`could_not_verify` verification **still** exits 0 — surfacing the figure is the success condition. |
| `2` | Invalid configuration — no fetch attempted, no result. |
| `3` | Data-source failure, or `status: could_not_compute` (missing window coverage) — distinct from a legitimate zero-fee result. |

### Fidelity tiers

Every result carries a `fidelity` note. The default **`aggregated`** tier
estimates each bin's liquidity share from pool TVL and spreads bucket volume
uniformly across the bins the price traversed — honest but coarse. The optional
**`snapshot`** tier (`SIM_LIQUIDITY_SOURCE=snapshot` + `SIM_RPC_URL`) reads
current on-chain per-bin reserves for higher fidelity. Tighten `SIM_TOLERANCE`
only when using a higher-fidelity source.

### Examples

```bash
# Simulate fees over a window (US1 — the MVP)
SIM_POOL=<pool> SIM_DEPOSIT_USD=1000 SIM_RANGE_LOWER=140 SIM_RANGE_UPPER=160 \
  SIM_TIMEFRAME=1h npm run simulate

# Verify against a real position (US2)
SIM_POOL=<pool> SIM_VERIFY_USER=<wallet> SIM_VERIFY_POSITION=<position> \
  SIM_TOLERANCE=0.10 npm run simulate
```

See [`specs/002-dlmm-position-simulator/quickstart.md`](specs/002-dlmm-position-simulator/quickstart.md)
for the full walkthrough and the fee-attribution model.

### Tests

```bash
npm test          # pure financial-core unit tests (node:test via tsx)
npm run typecheck # strict TypeScript
npm run check:api # verify the pinned Meteora spec matches remote
```

> Note: the Meteora API enforces a **30 QPS** limit. The screener paginates
> sequentially (one request in flight), well within that ceiling.
