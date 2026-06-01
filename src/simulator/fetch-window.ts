// I/O edge: the only module that imports the Meteora client for simulation
// inputs (FR-010, Decision 1). Fetches pool detail + OHLCV (price path) +
// volume/history (per-bucket volume & fees), aligns them by timestamp into a
// WindowTimeline, and maps each candle's [low, high] to the bin span the price
// traversed. Coverage gaps set `complete = false` so the orchestrator can fail
// distinct from a legitimate zero (FR-010, SC-008). Requests are sequential —
// three calls, well within Meteora's 30 QPS limit (no parallel fan-out).

import { createMeteoraClient } from '../meteora.js';
import { priceToBinId } from './bins.js';
import type {
  PoolState,
  SimulationConfig,
  TokenRef,
  WindowBucket,
  WindowTimeline,
} from './types.js';

/** Thrown on any data-source failure. The CLI maps this to exit code 3. */
export class DataSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataSourceError';
  }
}

/** Per-request timeout — a stalled connection fails closed rather than hanging. */
const REQUEST_TIMEOUT_MS = 30_000;

function toFinite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

interface RawTokenMetrics {
  address?: unknown;
  symbol?: unknown;
  decimals?: unknown;
  price?: unknown;
}

function toTokenRef(token: RawTokenMetrics | undefined): TokenRef {
  return {
    address: typeof token?.address === 'string' ? token.address : '',
    symbol: typeof token?.symbol === 'string' ? token.symbol : '',
    decimals: toFinite(token?.decimals),
    priceUsd: toFinite(token?.price),
  };
}

/** Run a single GET with a timeout, mapping any failure to DataSourceError. */
async function getWithTimeout<T>(
  label: string,
  call: (signal: AbortSignal) => Promise<{ data?: T; error?: unknown; response?: Response }>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const { data, error, response } = await call(controller.signal);
    if (error !== undefined || data === undefined) {
      throw new DataSourceError(
        `${label} returned HTTP ${response?.status ?? 'unknown'}; aborting (no partial result).`,
      );
    }
    return data;
  } catch (cause) {
    if (cause instanceof DataSourceError) throw cause;
    const detail = controller.signal.aborted
      ? `timed out after ${REQUEST_TIMEOUT_MS} ms`
      : cause instanceof Error
        ? cause.message
        : String(cause);
    throw new DataSourceError(`${label} failed: ${detail}`);
  } finally {
    clearTimeout(timer);
  }
}

export interface WindowFetchResult {
  pool: PoolState;
  timeline: WindowTimeline;
}

/**
 * Fetch and align the simulation window. Returns the pool state and the
 * materialized timeline. Throws DataSourceError on any fetch failure or when the
 * pool geometry cannot be built.
 */
export async function fetchWindow(config: SimulationConfig): Promise<WindowFetchResult> {
  const client = createMeteoraClient(config.baseUrl);

  // 1. Pool detail — anchors bin geometry, token refs and TVL.
  const poolData = await getWithTimeout('GET /pools/{address}', (signal) =>
    client.GET('/pools/{address}', {
      params: { path: { address: config.pool } },
      signal,
    }),
  );

  const binStep = toFinite(poolData.pool_config?.bin_step);
  const currentPrice = toFinite(poolData.current_price);
  if (!(binStep > 0) || !(currentPrice > 0)) {
    throw new DataSourceError(
      `Pool ${config.pool} is missing geometry (bin_step=${binStep}, current_price=${currentPrice}); cannot build bins.`,
    );
  }

  const pool: PoolState = {
    address: poolData.address,
    name: poolData.name,
    binStep,
    baseFeePct: toFinite(poolData.pool_config?.base_fee_pct),
    dynamicFeePct: toFinite(poolData.dynamic_fee_pct),
    collectFeeMode: toFinite(poolData.pool_config?.collect_fee_mode),
    currentPrice,
    currentActiveBinId: priceToBinId(currentPrice, binStep),
    tvlUsd: toFinite(poolData.tvl),
    tokenX: toTokenRef(poolData.token_x as RawTokenMetrics),
    tokenY: toTokenRef(poolData.token_y as RawTokenMetrics),
  };

  // 2. Price path (OHLCV) and 3. per-bucket volume/fees — sequential (30 QPS).
  const query: { timeframe: string; start_time?: number; end_time?: number } = {
    timeframe: config.timeframe,
  };
  if (config.start !== null) query.start_time = config.start;
  if (config.end !== null) query.end_time = config.end;

  const ohlcv = await getWithTimeout('GET /pools/{address}/ohlcv', (signal) =>
    client.GET('/pools/{address}/ohlcv', {
      params: { path: { address: config.pool }, query },
      signal,
    }),
  );

  const volume = await getWithTimeout('GET /pools/{address}/volume/history', (signal) =>
    client.GET('/pools/{address}/volume/history', {
      params: {
        path: { address: config.pool },
        query: { ...query, timeframe: config.timeframe },
      },
      signal,
    }),
  );

  // Index volume buckets by timestamp for alignment.
  const volumeByTs = new Map<number, { volume: number; fees: number }>();
  for (const v of volume.data) {
    volumeByTs.set(v.timestamp, { volume: toFinite(v.volume), fees: toFinite(v.fees) });
  }

  const candles = [...ohlcv.data].sort((a, b) => a.timestamp - b.timestamp);
  const buckets: WindowBucket[] = [];
  let coverageGap = false;

  for (const c of candles) {
    const low = toFinite(c.low);
    const high = toFinite(c.high);
    if (!(low > 0) || !(high > 0)) {
      coverageGap = true;
      continue;
    }
    const vol = volumeByTs.get(c.timestamp);
    if (vol === undefined) coverageGap = true;

    buckets.push({
      timestamp: c.timestamp,
      open: toFinite(c.open),
      high,
      low,
      close: toFinite(c.close),
      volumeUsd: vol !== undefined ? vol.volume : 0,
      feesUsd: vol !== undefined ? vol.fees : null,
      activeBinLow: priceToBinId(low, binStep),
      activeBinHigh: priceToBinId(high, binStep),
    });
  }

  const start = toFinite(ohlcv.start_time, config.start ?? (buckets[0]?.timestamp ?? 0));
  const end = toFinite(ohlcv.end_time, config.end ?? (buckets[buckets.length - 1]?.timestamp ?? 0));
  const complete = buckets.length > 0 && !coverageGap;

  const timeline: WindowTimeline = {
    start,
    end,
    timeframe: config.timeframe,
    buckets,
    complete,
  };

  return { pool, timeline };
}
