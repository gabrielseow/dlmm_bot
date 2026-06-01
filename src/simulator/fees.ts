// PURE fee attribution (FR-002, FR-003, Decision 2). The position's fees are a
// double sum over the window's time buckets and over the bins it covers:
//
//   positionFees = Σ_buckets Σ_{bin ∈ activeBins(bucket) ∩ [L,U]}
//                     bucketFees · volumeShareOfBin(bin) · liquidityShare(bin)
//
// where activeBins(bucket) is the bin span the price traversed in the bucket
// ([low, high] mapped to bin ids), volumeShareOfBin spreads the bucket's volume
// uniformly across that span (Decision 3), and liquidityShare(bin) =
// Lpos(bin) / (Lpos(bin) + Lpool(bin)) with Lpool injected via PoolLiquiditySource.
//
// No I/O, no clock, no RNG. Every division is guarded so no Infinity/NaN/negative
// fee can be produced; buckets fully outside [L,U] contribute zero (FR-003, SC-005).

import type {
  BinFeeContribution,
  BinLiquidity,
  FeeBreakdown,
  PoolLiquiditySource,
  PoolState,
  TokenAmounts,
  WindowTimeline,
} from './types.js';
import { ZERO_AMOUNTS } from './types.js';

/** Per-bin running accumulator while attributing fees. */
interface BinAccum {
  binId: number;
  routedVolumeUsd: number;
  liquidityShare: number;
  feesUsd: number;
}

/** A finite, non-negative number passes through; anything else becomes 0. */
function safeNonNeg(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Split a USD fee figure into a self-consistent TokenAmounts. The figure of
 * record is `usd`; the token split is a neutral 50/50-by-value prior (fees
 * accrue in both tokens over two-directional volume and the aggregated source
 * does not expose the per-swap direction — Decision 3 / FR-015). The split
 * always satisfies x·priceX + y·priceY = usd, so downstream conservation holds.
 */
function usdToAmounts(usd: number, pool: PoolState): TokenAmounts {
  const safeUsd = safeNonNeg(usd);
  if (safeUsd === 0) return { ...ZERO_AMOUNTS };
  const px = pool.tokenX.priceUsd;
  const py = pool.tokenY.priceUsd;
  const half = safeUsd / 2;
  const x = px > 0 ? half / px : 0;
  const y = py > 0 ? half / py : 0;
  return { x, y, usd: safeUsd };
}

/**
 * Attribute a position's fees over the window. `feeRate` (a fraction, e.g.
 * 0.002 for 0.2%) is applied to bucket volume only when the bucket's reported
 * fees are missing (`feesUsd === null`); the basis is surfaced in the fidelity
 * note by the orchestrator.
 */
export function attributeFees(
  pool: PoolState,
  timeline: WindowTimeline,
  positionBins: BinLiquidity[],
  shareFn: PoolLiquiditySource,
  feeRate: number,
): FeeBreakdown {
  // Position liquidity by bin, and the covered inclusive range [L, U].
  const posLiquidity = new Map<number, number>();
  let lower = Number.POSITIVE_INFINITY;
  let upper = Number.NEGATIVE_INFINITY;
  for (const b of positionBins) {
    posLiquidity.set(b.binId, safeNonNeg(b.liquidity));
    if (b.binId < lower) lower = b.binId;
    if (b.binId > upper) upper = b.binId;
  }

  const accum = new Map<number, BinAccum>();
  let bucketsCounted = 0;
  let bucketsOutOfRange = 0;

  // No covered bins ⇒ nothing can be earned (degenerate position).
  if (positionBins.length === 0) {
    return {
      totalFees: { ...ZERO_AMOUNTS },
      perBin: [],
      bucketsCounted: 0,
      bucketsOutOfRange: timeline.buckets.length,
    };
  }

  for (const bucket of timeline.buckets) {
    const spanLow = Math.min(bucket.activeBinLow, bucket.activeBinHigh);
    const spanHigh = Math.max(bucket.activeBinLow, bucket.activeBinHigh);
    const spanCount = spanHigh - spanLow + 1;
    if (!(spanCount > 0)) {
      bucketsOutOfRange += 1;
      continue;
    }

    // Overlap of the traversed span with the position's range.
    const lo = Math.max(spanLow, lower);
    const hi = Math.min(spanHigh, upper);
    if (lo > hi) {
      bucketsOutOfRange += 1;
      continue;
    }

    const bucketFees = bucket.feesUsd !== null ? bucket.feesUsd : bucket.volumeUsd * feeRate;
    const volumePerBin = safeNonNeg(bucket.volumeUsd) / spanCount;
    const feesPerBin = safeNonNeg(bucketFees) / spanCount;

    let countedAnyBin = false;
    for (let binId = lo; binId <= hi; binId += 1) {
      const lpos = posLiquidity.get(binId);
      if (lpos === undefined) continue; // bin not part of the position
      const lpool = safeNonNeg(shareFn(binId, { pool, window: timeline }));
      const denom = lpos + lpool;
      const share = denom > 0 ? lpos / denom : 0;
      const feeContribution = feesPerBin * share;

      const entry = accum.get(binId) ?? {
        binId,
        routedVolumeUsd: 0,
        liquidityShare: share,
        feesUsd: 0,
      };
      entry.routedVolumeUsd += volumePerBin;
      entry.liquidityShare = share; // constant per bin given a bucket-independent shareFn
      entry.feesUsd += safeNonNeg(feeContribution);
      accum.set(binId, entry);
      countedAnyBin = true;
    }

    if (countedAnyBin) bucketsCounted += 1;
    else bucketsOutOfRange += 1;
  }

  const perBin: BinFeeContribution[] = [...accum.values()]
    .sort((a, b) => a.binId - b.binId)
    .map((e) => ({
      binId: e.binId,
      routedVolumeUsd: e.routedVolumeUsd,
      liquidityShare: e.liquidityShare,
      feesUsd: e.feesUsd,
    }));

  const totalUsd = perBin.reduce((s, b) => s + b.feesUsd, 0);

  return {
    totalFees: usdToAmounts(totalUsd, pool),
    perBin,
    bucketsCounted,
    bucketsOutOfRange,
  };
}
