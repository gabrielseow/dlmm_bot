// Pool per-bin liquidity — the share denominator Lpool(bin) the fee model needs
// (Decision 4). This is the seam where the irreducible data gap lives, exposed
// as an injected PoolLiquiditySource so fees.ts stays pure and every result can
// state which tier produced it (FR-015, FR-010, SC-008).
//
//   Tier A — `aggregated` (default, API-only): spread the pool's current TVL
//            (in liquidity-equivalent USD units) uniformly across the bins the
//            price traversed over the window. Lowest fidelity.
//   Tier B — `snapshot` (optional, on-chain): use current per-bin reserves read
//            read-only via @meteora-ag/dlmm as Lpool(bin). Higher fidelity for
//            recent/live windows.
//
// The SDK/RPC import lives behind an async edge (fetchBinSnapshot); the default
// path never loads it, keeping the core dependency-free.

import type { PoolLiquiditySource, PoolState, WindowTimeline } from './types.js';

/** Thrown when the optional on-chain snapshot edge fails. CLI maps to exit 3. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** Count the distinct bins the price traversed across the whole window. */
function distinctActiveBinCount(window: WindowTimeline): number {
  const seen = new Set<number>();
  for (const b of window.buckets) {
    const lo = Math.min(b.activeBinLow, b.activeBinHigh);
    const hi = Math.max(b.activeBinLow, b.activeBinHigh);
    for (let id = lo; id <= hi; id += 1) seen.add(id);
  }
  return seen.size;
}

/**
 * Tier A: spread current pool TVL uniformly across the window's active bins.
 * The per-bin estimate is memoized per window so repeated lookups are O(1).
 * Returns 0 when TVL is missing or no active span is known (the caller's share
 * then collapses to 1·Lpos/Lpos = 0/0 → guarded to 0 in fees.ts).
 */
export function createAggregatedSource(): PoolLiquiditySource {
  const cache = new WeakMap<WindowTimeline, number>();
  return (_binId: number, ctx: { pool: PoolState; window: WindowTimeline }): number => {
    let perBin = cache.get(ctx.window);
    if (perBin === undefined) {
      const binCount = distinctActiveBinCount(ctx.window);
      const tvl = Number.isFinite(ctx.pool.tvlUsd) && ctx.pool.tvlUsd > 0 ? ctx.pool.tvlUsd : 0;
      perBin = binCount > 0 ? tvl / binCount : 0;
      cache.set(ctx.window, perBin);
    }
    return perBin;
  };
}

/**
 * Tier B: build a synchronous PoolLiquiditySource from a pre-fetched per-bin
 * reserves map (USD-equivalent). Bins missing from the snapshot fall back to the
 * aggregated estimate so the share never silently collapses to zero.
 */
export function createSnapshotSource(reservesUsd: Map<number, number>): PoolLiquiditySource {
  const aggregated = createAggregatedSource();
  return (binId: number, ctx: { pool: PoolState; window: WindowTimeline }): number => {
    const reserve = reservesUsd.get(binId);
    if (reserve !== undefined && Number.isFinite(reserve) && reserve >= 0) return reserve;
    return aggregated(binId, ctx);
  };
}

/**
 * I/O edge: read current per-bin reserves for a pool via the DLMM SDK (read-only
 * RPC). Returns a Map<binId, reserveUsd>. The SDK is imported dynamically so the
 * default aggregated path never pulls in @meteora-ag/dlmm / @solana/web3.js.
 * Throws SnapshotError on any RPC/SDK failure (fail-closed).
 */
export async function fetchBinSnapshot(
  rpcUrl: string,
  poolAddress: string,
  pool: PoolState,
): Promise<Map<number, number>> {
  try {
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const dlmmModule = await import('@meteora-ag/dlmm');
    const DLMM = (dlmmModule as { default?: unknown }).default ?? dlmmModule;

    const connection = new Connection(rpcUrl, 'confirmed');
    const poolKey = new PublicKey(poolAddress);
    // The SDK's create() signature is the documented entrypoint; narrow at the edge.
    const create = (DLMM as { create?: unknown }).create;
    if (typeof create !== 'function') {
      throw new SnapshotError('@meteora-ag/dlmm: create() entrypoint not found.');
    }
    const instance = await (create as (c: unknown, k: unknown) => Promise<unknown>)(
      connection,
      poolKey,
    );

    const getBins = (instance as { getBinsAroundActiveBin?: unknown }).getBinsAroundActiveBin;
    if (typeof getBins !== 'function') {
      throw new SnapshotError('@meteora-ag/dlmm: per-bin reserve accessor not found.');
    }
    // Read a wide span around the active bin (read-only).
    const result = (await (getBins as (a: number, b: number) => Promise<unknown>).call(
      instance,
      500,
      500,
    )) as { bins?: Array<{ binId?: number; xAmount?: unknown; yAmount?: unknown }> };

    const px = pool.tokenX.priceUsd;
    const py = pool.tokenY.priceUsd;
    const dx = pool.tokenX.decimals;
    const dy = pool.tokenY.decimals;
    const reserves = new Map<number, number>();
    for (const bin of result.bins ?? []) {
      if (typeof bin.binId !== 'number') continue;
      const xRaw = Number(bin.xAmount ?? 0) / 10 ** dx;
      const yRaw = Number(bin.yAmount ?? 0) / 10 ** dy;
      const usd = (Number.isFinite(xRaw) ? xRaw : 0) * px + (Number.isFinite(yRaw) ? yRaw : 0) * py;
      reserves.set(bin.binId, Number.isFinite(usd) && usd >= 0 ? usd : 0);
    }
    return reserves;
  } catch (cause) {
    if (cause instanceof SnapshotError) throw cause;
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new SnapshotError(`On-chain bin snapshot failed: ${detail}`);
  }
}
