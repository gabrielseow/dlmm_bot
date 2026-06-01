// Domain types for the DLMM position simulator (data-model.md).
// The pure financial core operates exclusively on these plain, serializable,
// immutable values — no classes, no clock, no I/O. Where a value can be absent
// it is `T | null` (never silently 0) so "missing" stays distinguishable from
// "zero" (FR-010). These types are the contract the I/O edges normalize into
// and the format/CLI layers serialize out of.

/** Liquidity-distribution shape across the position's bins (FR-001). */
export type Shape = 'spot' | 'curve' | 'bid_ask';

/** OHLCV / volume bucket size — the API's TimeFrame set. */
export type TimeFrame = '5m' | '30m' | '1h' | '2h' | '4h' | '12h' | '24h';

/** Target network — unambiguous at runtime (Principle V). */
export type Network = 'mainnet' | 'devnet';

/** Pool per-bin liquidity tier driving the share denominator (Decision 4). */
export type LiquiditySource = 'aggregated' | 'snapshot';

export const SHAPES: readonly Shape[] = ['spot', 'curve', 'bid_ask'];

export const TIMEFRAMES: readonly TimeFrame[] = [
  '5m',
  '30m',
  '1h',
  '2h',
  '4h',
  '12h',
  '24h',
];

export const NETWORKS: readonly Network[] = ['mainnet', 'devnet'];

export const LIQUIDITY_SOURCES: readonly LiquiditySource[] = ['aggregated', 'snapshot'];

/** Identity + USD price of one side of a pair. */
export interface TokenRef {
  address: string;
  symbol: string;
  decimals: number;
  priceUsd: number;
}

/** A pair of token amounts in decimal display units plus their combined USD value. */
export interface TokenAmounts {
  x: number;
  y: number;
  usd: number;
}

/** Zero amount constant — the additive identity used throughout the core. */
export const ZERO_AMOUNTS: TokenAmounts = { x: 0, y: 0, usd: 0 };

/**
 * The pool's window-relevant state (data-model: PoolState). Sourced from
 * GET /pools/{address} + the time-series endpoints.
 */
export interface PoolState {
  address: string;
  name: string;
  binStep: number;
  baseFeePct: number;
  dynamicFeePct: number;
  collectFeeMode: number;
  currentPrice: number;
  currentActiveBinId: number;
  tvlUsd: number;
  tokenX: TokenRef;
  tokenY: TokenRef;
}

/** One candle/volume bucket of the materialized window timeline. */
export interface WindowBucket {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number;
  /** Pool fees for the bucket from the source; null when the source omits it. */
  feesUsd: number | null;
  /** Bin ids spanned by the bucket's [low, high] price range (the traversed span). */
  activeBinLow: number;
  activeBinHigh: number;
}

/**
 * The materialized, aligned price-and-fee path over the simulation window — the
 * sole time-varying input to the pure fee model (Decisions 2–3).
 */
export interface WindowTimeline {
  start: number;
  end: number;
  timeframe: TimeFrame;
  buckets: WindowBucket[];
  /** false when OHLCV/volume coverage has gaps for [start, end] (FR-010). */
  complete: boolean;
}

/** Position liquidity (and token composition) at one bin. */
export interface BinLiquidity {
  binId: number;
  liquidity: number;
  amountX: number;
  amountY: number;
}

/** A simulated liquidity position (data-model: Position). Immutable value. */
export interface Position {
  pool: string;
  status: 'open' | 'closed';
  binLower: number;
  binUpper: number;
  shape: Shape;
  deposit: TokenAmounts;
  binLiquidity: BinLiquidity[];
  unclaimedFees: TokenAmounts;
  realizedFees: TokenAmounts;
  openedAt: number | null;
  closedAt: number | null;
}

/** Post-operation snapshot; earnedFees = realizedFees + unclaimedFees (SC-009). */
export interface PositionSnapshot {
  status: 'open' | 'closed';
  unclaimedFees: TokenAmounts;
  realizedFees: TokenAmounts;
  earnedFees: TokenAmounts;
}

export type OperationType = 'open' | 'accrue' | 'claim' | 'mark' | 'close';

/** A single lifecycle action and its resulting state — the auditable history (US3 #3). */
export interface Operation {
  seq: number;
  type: OperationType;
  at: number;
  inputs?: Record<string, unknown>;
  result?: Record<string, unknown>;
  stateAfter: PositionSnapshot;
}

/** Per-bin contribution behind the total fee figure (US1 #3, SC-007). */
export interface BinFeeContribution {
  binId: number;
  routedVolumeUsd: number;
  liquidityShare: number;
  feesUsd: number;
}

/** Traceable decomposition of the position's fees — output of attributeFees. */
export interface FeeBreakdown {
  totalFees: TokenAmounts;
  perBin: BinFeeContribution[];
  /** Buckets whose active span overlapped [L, U]. */
  bucketsCounted: number;
  /** Buckets fully outside [L, U] (zero contribution, FR-003). */
  bucketsOutOfRange: number;
}

/** Position value, hold value, IL and net PnL — output of valuation.ts (FR-007). */
export interface Valuation {
  markPrice: number;
  positionValueUsd: number;
  holdValueUsd: number;
  impermanentLossUsd: number;
  earnedFeesUsd: number;
  netPnlUsd: number;
}

/** States how much to trust a result (FR-015). Always present on a result. */
export interface FidelityNote {
  priceGranularity: TimeFrame;
  volumeBasis: 'reported_fees' | 'volume_times_rate';
  liquiditySource: LiquiditySource;
  liquidityCaveat: string;
  complete: boolean;
}

/** Verification ground truth from GET /positions/{pool}/pnl (+ historical events). */
export interface ObservedPosition {
  positionAddress: string;
  binLower: number;
  binUpper: number;
  openedAt: number | null;
  closedAt: number | null;
  /** From allTimeFees.total; null ⇒ could-not-verify. */
  observedFeesUsd: number | null;
  /** Reconstructed from `add` events; null when unavailable. */
  depositX: number | null;
  depositY: number | null;
  depositUsd: number | null;
  isClosed: boolean;
}

export type VerificationMode = 'historical' | 'live';
export type VerificationStatus = 'pass' | 'fail' | 'could_not_verify';

/** Comparison of simulated vs observed fees (FR-008/009/010). */
export interface VerificationOutcome {
  mode: VerificationMode;
  simulatedFeesUsd: number;
  observedFeesUsd: number | null;
  absDiffUsd: number | null;
  relDiff: number | null;
  tolerance: number;
  status: VerificationStatus;
  note: string;
  position?: {
    positionAddress: string;
    binLower: number;
    binUpper: number;
    openedAt: number | null;
    closedAt: number | null;
    isClosed: boolean;
  } | null;
}

/** Operator-controlled configuration governing one run (config.ts, FR-014). */
export interface SimulationConfig {
  pool: string;
  /** Exactly one deposit form is supplied; the others are null. */
  depositX: number | null;
  depositY: number | null;
  depositUsd: number | null;
  /** Price range (null when a bin range is supplied instead). */
  rangeLower: number | null;
  rangeUpper: number | null;
  /** Bin range (overrides the price range when supplied). */
  binLower: number | null;
  binUpper: number | null;
  shape: Shape;
  timeframe: TimeFrame;
  start: number | null;
  end: number | null;
  liquiditySource: LiquiditySource;
  tolerance: number;
  verifyUser: string | null;
  verifyPosition: string | null;
  baseUrl: string;
  rpcUrl: string | null;
  network: Network;
  output: string | null;
}

/**
 * The injected share denominator (data-model: PoolLiquiditySource). Returns
 * Lpool(bin) — the competing liquidity in a bin — keeping fees.ts pure. Tier A
 * spreads pool TVL; Tier B reads an on-chain bin snapshot (Decision 4).
 */
export type PoolLiquiditySource = (
  binId: number,
  ctx: { pool: PoolState; window: WindowTimeline },
) => number;

/** Window summary embedded in the result. */
export interface WindowSummary {
  start: number;
  end: number;
  timeframe: TimeFrame;
  bucketCount: number;
  complete: boolean;
}

/** The structured, machine-readable run output handed to later pipeline parts (FR-013). */
export interface SimulationResult {
  schemaVersion: string;
  generatedAt: number;
  config: {
    pool: string;
    shape: Shape;
    timeframe: TimeFrame;
    tolerance: number;
    liquiditySource: LiquiditySource;
    network: Network;
    [key: string]: unknown;
  };
  pool: PoolState;
  window: WindowSummary;
  position: Position;
  operations: Operation[];
  fees: FeeBreakdown;
  valuation: Valuation | null;
  verification: VerificationOutcome | null;
  fidelity: FidelityNote;
  status: 'ok' | 'could_not_compute';
}
