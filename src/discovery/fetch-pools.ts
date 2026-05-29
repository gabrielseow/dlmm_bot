// I/O edge: the ONLY discovery module that imports the Meteora client.
// Paginates GET /pools, normalizes each raw row into a PoolRow (preserving
// missing numerics as null, never 0), and fails closed (FR-001, FR-012,
// Decision 1, Decision 6): any page error or incomplete pagination throws —
// a partial universe is never returned as if it were complete.

import { createMeteoraClient } from '../meteora.js';
import {
  MEASUREMENT_WINDOWS,
  type PoolRow,
  type ScreeningCriteria,
  type TokenInfo,
  type WindowValues,
} from './types.js';

/** Thrown on any data-source failure or incomplete scan. The CLI maps this to exit code 3. */
export class DataSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataSourceError';
  }
}

/** Max page size supported by GET /pools. */
const PAGE_SIZE = 1000;

/** Hard ceiling on pages fetched — guards against a runaway/inconsistent API. */
const MAX_PAGES = 10_000;

/**
 * Per-request timeout. Pagination is sequential (one request in flight), so this
 * is well within Meteora's 30 QPS limit. A stalled connection aborts here and
 * fails closed rather than hanging the scan indefinitely (SC-007/SC-008).
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** A finite number passes through; anything else (null/undefined/NaN/±Inf) becomes null ("missing"). */
function toFiniteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A finite number passes through; otherwise 0 — for non-financial structural fields. */
function toNumberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

type RawTimeWindow = Record<string, unknown> | null | undefined;

function normalizeWindow(data: RawTimeWindow): WindowValues {
  const source = (data ?? {}) as Record<string, unknown>;
  const result = {} as WindowValues;
  for (const key of MEASUREMENT_WINDOWS) {
    result[key] = toFiniteOrNull(source[key]);
  }
  return result;
}

type RawTokenMetrics = { symbol?: unknown; address?: unknown; decimals?: unknown } | undefined;

function normalizeToken(token: RawTokenMetrics): TokenInfo {
  return {
    symbol: typeof token?.symbol === 'string' ? token.symbol : '',
    address: typeof token?.address === 'string' ? token.address : '',
    decimals: toNumberOrZero(token?.decimals),
  };
}

/** Type of one element of the GET /pools response `data` array. */
type RawPool = {
  address: string;
  name: string;
  token_x: RawTokenMetrics;
  token_y: RawTokenMetrics;
  pool_config: { bin_step?: unknown; base_fee_pct?: unknown };
  tvl: unknown;
  fees: RawTimeWindow;
  volume: RawTimeWindow;
  fee_tvl_ratio: RawTimeWindow;
  created_at: unknown;
  is_blacklisted: unknown;
};

function normalizePool(raw: RawPool): PoolRow {
  return {
    address: raw.address,
    name: raw.name,
    tokenX: normalizeToken(raw.token_x),
    tokenY: normalizeToken(raw.token_y),
    binStep: toNumberOrZero(raw.pool_config?.bin_step),
    baseFeePct: toNumberOrZero(raw.pool_config?.base_fee_pct),
    tvl: toFiniteOrNull(raw.tvl),
    fees: normalizeWindow(raw.fees),
    volume: normalizeWindow(raw.volume),
    apiFeeTvlRatio: normalizeWindow(raw.fee_tvl_ratio),
    createdAt: toNumberOrZero(raw.created_at),
    isBlacklisted: raw.is_blacklisted === true,
  };
}

/**
 * Fetch the complete pool universe as normalized PoolRow[]. Throws DataSourceError
 * on any page error or if pagination cannot complete — never returns a partial set.
 */
export async function fetchPools(criteria: ScreeningCriteria): Promise<PoolRow[]> {
  const client = createMeteoraClient(criteria.baseUrl);
  const rows: PoolRow[] = [];

  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    if (page > MAX_PAGES) {
      throw new DataSourceError(
        `Pagination exceeded the safety limit of ${MAX_PAGES} pages; aborting incomplete scan.`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let result;
    try {
      result = await client.GET('/pools', {
        params: { query: { page, page_size: PAGE_SIZE } },
        signal: controller.signal,
      });
    } catch (cause) {
      const detail = controller.signal.aborted
        ? `timed out after ${REQUEST_TIMEOUT_MS} ms`
        : cause instanceof Error
          ? cause.message
          : String(cause);
      throw new DataSourceError(`Request for page ${page} failed: ${detail}`);
    } finally {
      clearTimeout(timer);
    }

    const { data, error, response } = result;
    if (error !== undefined || data === undefined) {
      throw new DataSourceError(
        `GET /pools page ${page} returned HTTP ${response?.status ?? 'unknown'}; aborting (no partial result).`,
      );
    }

    for (const raw of data.data) {
      rows.push(normalizePool(raw as RawPool));
    }

    totalPages = Number.isInteger(data.pages) && data.pages > 0 ? data.pages : 1;

    // Fail-closed completeness guard: the page we asked for must be the page we got.
    if (data.current_page !== page) {
      throw new DataSourceError(
        `Pagination inconsistency: requested page ${page} but received page ${data.current_page}; aborting incomplete scan.`,
      );
    }

    if (data.current_page >= totalPages) break;
    page += 1;
  }

  return rows;
}
