// Domain types for the DLMM pair discovery & screening feature (data-model.md).
// These are the in-process types for src/discovery/. Numeric API fields that are
// null/undefined/NaN are preserved as `null` ("missing"), never coerced to 0, so
// the pure core can apply FR-007 (missing fee/volume) correctly.

/** Keys of the API's TimeWindowData (FR-006). `5m` is excluded — not a TimeWindowData key. */
export type MeasurementWindow = '30m' | '1h' | '2h' | '4h' | '12h' | '24h';

/** Selectable ranking signal (FR-004). */
export type Indicator = 'fee_to_tvl' | 'volume_to_tvl';

/** Target network — unambiguous at runtime (Principle V). */
export type Network = 'mainnet' | 'devnet';

/** Why a pool was excluded from ranking (first failing rule, deterministic order). */
export type IneligibilityReason =
  | 'missing_or_zero_tvl'
  | 'missing_fee_data'
  | 'missing_volume_data'
  | 'below_min_tvl'
  | 'below_min_volume'
  | 'blacklisted';

export const MEASUREMENT_WINDOWS: readonly MeasurementWindow[] = [
  '30m',
  '1h',
  '2h',
  '4h',
  '12h',
  '24h',
];

export const INDICATORS: readonly Indicator[] = ['fee_to_tvl', 'volume_to_tvl'];

export const NETWORKS: readonly Network[] = ['mainnet', 'devnet'];

/** Identity of one side of a pair. */
export interface TokenInfo {
  symbol: string;
  address: string;
  decimals: number;
}

/**
 * Per-window numeric data (fees, volume, fee/TVL ratio). Each window value is a
 * finite number or `null` when the API value is missing/NaN (preserved, never 0).
 */
export type WindowValues = Record<MeasurementWindow, number | null>;

/** Normalized projection of one API pool row — the only data crossing the I/O edge. */
export interface PoolRow {
  address: string;
  name: string;
  tokenX: TokenInfo;
  tokenY: TokenInfo;
  binStep: number;
  baseFeePct: number;
  /** USD TVL; `null` when missing/NaN. */
  tvl: number | null;
  fees: WindowValues;
  volume: WindowValues;
  /** API-provided fee/TVL ratio — diagnostic cross-check only (Decision 2). */
  apiFeeTvlRatio: WindowValues;
  /** Pool creation time (unix seconds). */
  createdAt: number;
  isBlacklisted: boolean;
}

/** Operator-controlled configuration governing one run (config.ts). */
export interface ScreeningCriteria {
  window: MeasurementWindow;
  indicator: Indicator;
  minTvl: number;
  minVolume: number;
  topN: number | null;
  sortDirection: 'desc' | 'asc';
  network: Network;
  baseUrl: string;
  output: string | null;
  newPoolMaxAgeSec: number;
}

/** An eligible pool, enriched with computed indicators and its rank. */
export interface CandidatePair {
  rank: number;
  address: string;
  name: string;
  pair: { tokenX: TokenInfo; tokenY: TokenInfo };
  binStep: number;
  tvl: number;
  fees: number;
  volume: number;
  window: MeasurementWindow;
  /** `fees / tvl` — always a finite real number (SC-003). */
  feeToTvl: number;
  /** `volume / tvl` — always a finite real number (SC-003). */
  volumeToTvl: number;
  /** The selected indicator's value — the sort key. */
  rankingScore: number;
  isNewPool: boolean;
}

/** A pool excluded from ranking, retained with a reason (not silently dropped). */
export interface IneligiblePool {
  address: string;
  name: string;
  reason: IneligibilityReason;
  /** Observed TVL (null if missing) for traceability. */
  tvl: number | null;
}

/** The timestamped, ordered output of one run (contracts/screening-result.schema.json). */
export interface ScreeningResult {
  generatedAt: string;
  criteria: ScreeningCriteria;
  poolUniverseCount: number;
  candidates: CandidatePair[];
  ineligible: IneligiblePool[];
  /** Only ever emitted on a full, successful scan (FR-012). */
  status: 'complete';
}
