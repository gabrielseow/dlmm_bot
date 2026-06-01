// PURE orchestrator (FR-011, FR-013, FR-015, SC-006). Drives the position
// lifecycle over a materialized WindowTimeline and assembles the SimulationResult
// — entirely deterministic: no clock, no RNG, no I/O. The window data, the
// pool-liquidity-share function, and the `generatedAt` timestamp are all injected
// by the caller, so identical inputs always yield an identical result.
//
// T011 (US1) implements open → accrue → assemble with a per-window FidelityNote.
// The full open→accrue→claim→mark→close history is layered on in T020 (US3) and
// the valuation block in T024 (US4).

import { distributeLiquidity } from './bins.js';
import { attributeFees } from './fees.js';
import { accrue, claim, close, mark, openPosition } from './position.js';
import { computeValuation } from './valuation.js';
import type {
  FeeBreakdown,
  FidelityNote,
  LiquiditySource,
  Network,
  Operation,
  PoolLiquiditySource,
  PoolState,
  Position,
  Shape,
  SimulationConfig,
  SimulationResult,
  TimeFrame,
  TokenAmounts,
  VerificationOutcome,
  WindowSummary,
  WindowTimeline,
} from './types.js';

const SCHEMA_VERSION = '1.0.0';

export interface SimulateParams {
  config: SimulationConfig;
  pool: PoolState;
  timeline: WindowTimeline;
  binLower: number;
  binUpper: number;
  shape: Shape;
  deposit: TokenAmounts;
  shareFn: PoolLiquiditySource;
  liquiditySource: LiquiditySource;
  liquidityCaveat: string;
  /** Fee fraction used only when a bucket's reported fees are missing. */
  feeRate: number;
  network: Network;
  /** Unix seconds supplied by the CLI shell (keeps the core clock-free). */
  generatedAt: number;
}

/** Does every covered bucket carry source-reported fees, or did we derive any? */
function deriveVolumeBasis(timeline: WindowTimeline): 'reported_fees' | 'volume_times_rate' {
  for (const b of timeline.buckets) {
    if (b.feesUsd === null) return 'volume_times_rate';
  }
  return 'reported_fees';
}

function buildFidelity(
  timeline: WindowTimeline,
  liquiditySource: LiquiditySource,
  liquidityCaveat: string,
): FidelityNote {
  return {
    priceGranularity: timeline.timeframe as TimeFrame,
    volumeBasis: deriveVolumeBasis(timeline),
    liquiditySource,
    liquidityCaveat,
    complete: timeline.complete,
  };
}

function buildConfigEcho(params: SimulateParams): SimulationResult['config'] {
  const { config, binLower, binUpper, deposit, liquiditySource, network } = params;
  return {
    pool: config.pool,
    shape: config.shape,
    timeframe: config.timeframe,
    tolerance: config.tolerance,
    liquiditySource,
    network,
    binLower,
    binUpper,
    deposit,
    window: { start: config.start, end: config.end },
  };
}

/**
 * Run a single-position simulation. Returns a complete SimulationResult. When
 * the window has no usable coverage the result's `status` is `could_not_compute`
 * and the figures are the (zero) best-effort values — never presented as a
 * verified complete figure (FR-010, SC-008).
 */
export function simulate(params: SimulateParams): SimulationResult {
  const { pool, timeline, binLower, binUpper, shape, deposit, shareFn, feeRate } = params;

  // Distribute the deposit across the bin range and open the position.
  const binLiquidity = distributeLiquidity(shape, deposit.usd, [binLower, binUpper], pool.binStep);
  const openedAt = timeline.start;
  const opened = openPosition({
    pool: pool.address,
    binLower,
    binUpper,
    shape,
    deposit,
    binLiquidity,
    openedAt,
  });

  // Attribute fees over the window, then accrue them onto the position.
  const fees: FeeBreakdown = attributeFees(pool, timeline, binLiquidity, shareFn, feeRate);
  const accrued = accrue(opened.position, fees.totalFees, timeline.end, 1);

  // Value the position at the window's opening and closing prices.
  const firstBucket = timeline.buckets[0];
  const lastBucket = timeline.buckets[timeline.buckets.length - 1];
  const openPrice = firstBucket !== undefined && firstBucket.open > 0 ? firstBucket.open : pool.currentPrice;
  const markPrice = lastBucket !== undefined && lastBucket.close > 0 ? lastBucket.close : pool.currentPrice;
  const { valuation, returnedAmounts } = computeValuation({
    binLiquidity,
    binStep: pool.binStep,
    openPrice,
    markPrice,
    priceXUsd: pool.tokenX.priceUsd,
    priceYUsd: pool.tokenY.priceUsd,
    earnedFeesUsd: fees.totalFees.usd,
  });

  // Drive the full lifecycle: open → accrue → claim → mark → close (US3).
  const claimed = claim(accrued.position, timeline.end, 2);
  const marked = mark(claimed.position, markPrice, timeline.end, 3, valuation.positionValueUsd);
  const closed = close(marked.position, returnedAmounts, timeline.end, 4);

  const operations: Operation[] = [
    opened.operation,
    accrued.operation,
    claimed.operation,
    marked.operation,
    closed.operation,
  ];
  const position: Position = closed.position;

  const window: WindowSummary = {
    start: timeline.start,
    end: timeline.end,
    timeframe: timeline.timeframe,
    bucketCount: timeline.buckets.length,
    complete: timeline.complete,
  };

  const status: SimulationResult['status'] =
    timeline.complete && timeline.buckets.length > 0 ? 'ok' : 'could_not_compute';

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: params.generatedAt,
    config: buildConfigEcho(params),
    pool,
    window,
    position,
    operations,
    fees,
    valuation,
    verification: null,
    fidelity: buildFidelity(timeline, params.liquiditySource, params.liquidityCaveat),
    status,
  };
}

/** Attach a verification outcome to a result (pure; returns a new object). */
export function withVerification(
  result: SimulationResult,
  verification: VerificationOutcome,
): SimulationResult {
  return { ...result, verification };
}
