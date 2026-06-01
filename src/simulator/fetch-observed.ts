// I/O edge: verification ground truth (Decision 1/7). Fetches a real position's
// PnL (GET /positions/{pool_address}/pnl) and its historical events
// (GET /positions/{address}/historical), reducing them to an ObservedPosition.
//
// This is the VERIFICATION edge, distinct from the simulation-input edge: a
// failure here must NOT abort the run. The simulation still succeeded; we simply
// cannot reconcile it, so we degrade to `observedFeesUsd = null` (→ could_not_verify,
// exit 0), never a silent pass and never exit 3 (FR-010, SC-008). Requests are
// sequential (30 QPS).

import { createMeteoraClient } from '../meteora.js';
import type { ObservedPosition, SimulationConfig } from './types.js';

const REQUEST_TIMEOUT_MS = 30_000;

function toFiniteOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

interface PnlRow {
  positionAddress: string;
  lowerBinId: number;
  upperBinId: number;
  createdAt?: number | null;
  closedAt?: number | null;
  isClosed: boolean;
  allTimeFees: { total: { usd: string } };
}

/**
 * Fetch the observed position to reconcile against. Returns null when no matching
 * position is found or any fetch fails — the caller then reports could_not_verify.
 * `observedFeesUsd` is null when the fee figure itself is missing.
 */
export async function fetchObserved(config: SimulationConfig): Promise<ObservedPosition | null> {
  if (config.verifyUser === null) return null;
  const client = createMeteoraClient(config.baseUrl);

  let row: PnlRow | undefined;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const { data, error } = await client.GET('/positions/{pool_address}/pnl', {
        params: {
          path: { pool_address: config.pool },
          query: { user: config.verifyUser },
        },
        signal: controller.signal,
      });
      if (error !== undefined || data === undefined) return null;
      const positions = (data.positions ?? []) as unknown as PnlRow[];
      row =
        config.verifyPosition !== null
          ? positions.find((p) => p.positionAddress === config.verifyPosition)
          : positions[0];
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }

  if (row === undefined) return null;

  const observedFeesUsd = toFiniteOrNull(row.allTimeFees?.total?.usd);

  // Reconstruct the deposit from `add` events (best-effort; null on failure).
  let depositX: number | null = null;
  let depositY: number | null = null;
  let depositUsd: number | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const { data, error } = await client.GET('/positions/{address}/historical', {
        params: {
          path: { address: row.positionAddress },
          query: { event_type: 'add' },
        },
        signal: controller.signal,
      });
      if (error === undefined && data !== undefined) {
        let sx = 0;
        let sy = 0;
        let su = 0;
        let any = false;
        for (const e of data.events ?? []) {
          if (e.eventType !== 'add') continue;
          any = true;
          sx += toFiniteOrNull(e.amountX) ?? 0;
          sy += toFiniteOrNull(e.amountY) ?? 0;
          su += toFiniteOrNull(e.totalUsd) ?? 0;
        }
        if (any) {
          depositX = sx;
          depositY = sy;
          depositUsd = su;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Deposit reconstruction is best-effort; leave as null.
  }

  return {
    positionAddress: row.positionAddress,
    binLower: row.lowerBinId,
    binUpper: row.upperBinId,
    openedAt: row.createdAt ?? null,
    closedAt: row.closedAt ?? null,
    observedFeesUsd,
    depositX,
    depositY,
    depositUsd,
    isClosed: row.isClosed === true,
  };
}
