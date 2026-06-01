// CLI entrypoint (FR-013, SC-001, SC-008, contracts/simulator-cli.md). Wires
// config → fetch-window → simulate → format and enforces the fail-closed
// exit-code contract:
//   0  simulation completed; status `ok` (includes a fail/could_not_verify
//      verification outcome — surfacing the figure IS the success condition)
//   2  invalid configuration — aborted before any network call, no result
//   3  data-source failure, or the run produced status `could_not_compute`
//      (missing OHLCV/volume coverage) — distinct from a legitimate zero
//
// The machine-readable JSON goes to stdout (or SIM_OUTPUT); the human summary
// goes to stderr so stdout stays clean for piping.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  SnapshotError,
  createAggregatedSource,
  createSnapshotSource,
  fetchBinSnapshot,
} from './bin-liquidity.js';
import { rangeToBins } from './bins.js';
import { ConfigError, loadConfig } from './config.js';
import { fetchObserved } from './fetch-observed.js';
import { fetchWindow } from './fetch-window.js';
import { renderSummary, toJson } from './format.js';
import { simulate, withVerification } from './simulate.js';
import { compare } from './verify.js';
import type {
  ObservedPosition,
  PoolLiquiditySource,
  PoolState,
  SimulationConfig,
  TokenAmounts,
} from './types.js';

/** Resolve the deposit into a self-consistent TokenAmounts using pool prices. */
function resolveDeposit(config: SimulationConfig, pool: PoolState): TokenAmounts {
  const px = pool.tokenX.priceUsd;
  const py = pool.tokenY.priceUsd;
  if (config.depositUsd !== null) {
    const half = config.depositUsd / 2;
    return {
      x: px > 0 ? half / px : 0,
      y: py > 0 ? half / py : 0,
      usd: config.depositUsd,
    };
  }
  const x = config.depositX ?? 0;
  const y = config.depositY ?? 0;
  return { x, y, usd: x * px + y * py };
}

/** Resolve the inclusive bin range from config (bin range wins over price range). */
function resolveBinRange(config: SimulationConfig, pool: PoolState): [number, number] {
  if (config.binLower !== null && config.binUpper !== null) {
    return [config.binLower, config.binUpper];
  }
  // Validation guarantees a price range is present when no bin range is given.
  return rangeToBins(config.rangeLower as number, config.rangeUpper as number, pool.binStep);
}

/**
 * When verifying against a real position, prefer its reconstructed deposit so we
 * simulate the same capital; otherwise fall back to the configured deposit.
 */
function depositFromObserved(
  observed: ObservedPosition,
  pool: PoolState,
  fallback: TokenAmounts,
): TokenAmounts {
  const x = observed.depositX ?? 0;
  const y = observed.depositY ?? 0;
  const usd = observed.depositUsd ?? x * pool.tokenX.priceUsd + y * pool.tokenY.priceUsd;
  return usd > 0 ? { x, y, usd } : fallback;
}

async function main(): Promise<number> {
  // 1. Configuration — validated before any network call (exit 2 on failure).
  let config: SimulationConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`Configuration error: ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  // 2. Verification ground truth (best-effort). A failure here degrades to
  //    could_not_verify (exit 0) — it never aborts the run. When a real position
  //    is found, the simulation window is matched to its [createdAt, closedAt].
  let observed: ObservedPosition | null = null;
  if (config.verifyUser !== null) {
    observed = await fetchObserved(config);
  }
  const effectiveConfig: SimulationConfig =
    observed !== null
      ? {
          ...config,
          start: observed.openedAt ?? config.start,
          end: observed.closedAt ?? config.end,
        }
      : config;

  // 3. Fetch + align the window — fail-closed (exit 3).
  let fetched;
  try {
    fetched = await fetchWindow(effectiveConfig);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Data-source failure: ${detail}\nNo result emitted.\n`);
    return 3;
  }
  const { pool, timeline } = fetched;

  // 4. Resolve deposit + range, build the pool-liquidity-share function. When
  //    verifying, match the observed position's range and reconstructed deposit.
  const configDeposit = resolveDeposit(config, pool);
  const deposit = observed !== null ? depositFromObserved(observed, pool, configDeposit) : configDeposit;
  const [binLower, binUpper] =
    observed !== null ? [observed.binLower, observed.binUpper] : resolveBinRange(config, pool);

  let shareFn: PoolLiquiditySource;
  let liquidityCaveat: string;
  if (config.liquiditySource === 'snapshot') {
    try {
      const reserves = await fetchBinSnapshot(config.rpcUrl as string, config.pool, pool);
      shareFn = createSnapshotSource(reserves);
      liquidityCaveat =
        'Per-bin liquidity from a current on-chain snapshot applied to the window.';
    } catch (error) {
      const detail = error instanceof SnapshotError ? error.message : String(error);
      process.stderr.write(`Data-source failure: ${detail}\nNo result emitted.\n`);
      return 3;
    }
  } else {
    shareFn = createAggregatedSource();
    liquidityCaveat =
      'Share estimated from aggregate pool TVL spread across the active span, not per-bin reserves.';
  }

  // 5. Simulate (pure). feeRate is used only when a bucket lacks reported fees.
  const feeRate = pool.dynamicFeePct > 0 ? pool.dynamicFeePct / 100 : pool.baseFeePct / 100;
  let result = simulate({
    config,
    pool,
    timeline,
    binLower,
    binUpper,
    shape: config.shape,
    deposit,
    shareFn,
    liquiditySource: config.liquiditySource,
    liquidityCaveat,
    feeRate: Number.isFinite(feeRate) && feeRate > 0 ? feeRate : 0,
    network: config.network,
    generatedAt: Math.floor(Date.now() / 1000),
  });

  // 6. Verification: reconcile simulated vs observed fees when requested. A
  //    fail / could_not_verify still exits 0 — surfacing the figure IS success.
  if (config.verifyUser !== null) {
    const mode = observed !== null && observed.isClosed ? 'historical' : 'live';
    const outcome = compare(
      result.fees.totalFees.usd,
      observed?.observedFeesUsd ?? null,
      config.tolerance,
      mode,
      observed,
    );
    result = withVerification(result, outcome);
  }

  // 7. Human summary → stderr (keeps stdout clean for piping the JSON).
  process.stderr.write(`${renderSummary(result)}\n`);

  // 8. Machine-readable JSON → file or stdout.
  const json = toJson(result);
  if (config.output !== null) {
    const dir = dirname(config.output);
    if (dir && dir !== '.') await mkdir(dir, { recursive: true });
    await writeFile(config.output, `${json}\n`, 'utf8');
    process.stderr.write(`Wrote SimulationResult to ${config.output}\n`);
  } else {
    process.stdout.write(`${json}\n`);
  }

  // 9. Exit code: could_not_compute is fail-distinct (exit 3); ok is 0.
  return result.status === 'could_not_compute' ? 3 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unexpected error: ${detail}\n`);
    process.exitCode = 1;
  });
