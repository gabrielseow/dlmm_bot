// PURE bin geometry for DLMM pools (FR-001, Decision 3). No I/O, no clock, no
// RNG — every function is a deterministic value transform. The DLMM geometric
// price law is price(binId) = (1 + binStep/10_000)^binId, so a bin id is the
// log of the price in that base.

import type { BinLiquidity, Shape } from './types.js';

/** The geometric base for a pool: 1 + binStep/10_000. */
function binBase(binStep: number): number {
  return 1 + binStep / 10_000;
}

/**
 * binId = floor( ln(price) / ln(1 + binStep/10_000) ). Returns NaN-free results
 * only for finite price > 0 and binStep > 0; callers guard inputs upstream
 * (config + PoolState validation).
 */
export function priceToBinId(price: number, binStep: number): number {
  return Math.floor(Math.log(price) / Math.log(binBase(binStep)));
}

/** price(binId) = (1 + binStep/10_000)^binId. Inverse of priceToBinId (to a bin). */
export function binIdToPrice(binId: number, binStep: number): number {
  return Math.pow(binBase(binStep), binId);
}

/**
 * Map an inclusive price range [lower, upper] to an inclusive bin range [L, U].
 * lower maps to its containing bin (floor); upper likewise. L ≤ U always holds
 * for a well-ordered range; an inverted range yields L > U which the caller
 * rejects (config validation, SC-005).
 */
export function rangeToBins(
  priceLower: number,
  priceUpper: number,
  binStep: number,
): [number, number] {
  const lo = priceToBinId(priceLower, binStep);
  const hi = priceToBinId(priceUpper, binStep);
  return lo <= hi ? [lo, hi] : [hi, lo];
}

/** The raw, unnormalized shape weight for a bin at index `i` of `n` bins. */
function shapeWeight(shape: Shape, i: number, n: number): number {
  if (n <= 1) return 1;
  switch (shape) {
    case 'spot':
      // Uniform across the range.
      return 1;
    case 'curve': {
      // Concentrated toward the centre (triangular). Peak at the midpoint.
      const mid = (n - 1) / 2;
      const dist = Math.abs(i - mid);
      return mid === 0 ? 1 : 1 - dist / (mid + 1);
    }
    case 'bid_ask': {
      // Concentrated toward the edges (inverse of curve).
      const mid = (n - 1) / 2;
      const dist = Math.abs(i - mid);
      return mid === 0 ? 1 : dist / mid + 1 / (mid + 1);
    }
  }
}

/**
 * Distribute a deposit across the inclusive bin range [L, U] according to a
 * shape, returning per-bin liquidity that sums (in USD-equivalent liquidity
 * units) to the deposit total. We model `liquidity` as the deposit-USD weight
 * placed at each bin; the token composition (amountX/amountY) at each bin is
 * left to valuation, which knows the marking price. An empty/inverted range
 * yields an empty array — callers reject that at open (FR-001, SC-005).
 */
export function distributeLiquidity(
  shape: Shape,
  depositUsd: number,
  range: [number, number],
  _binStep: number,
): BinLiquidity[] {
  const [lower, upper] = range;
  if (upper < lower) return [];
  if (!(depositUsd > 0)) {
    // Degenerate deposit: place zero liquidity at each bin rather than NaN.
    const bins: BinLiquidity[] = [];
    for (let binId = lower; binId <= upper; binId += 1) {
      bins.push({ binId, liquidity: 0, amountX: 0, amountY: 0 });
    }
    return bins;
  }

  const n = upper - lower + 1;
  const weights: number[] = [];
  let weightSum = 0;
  for (let i = 0; i < n; i += 1) {
    const w = shapeWeight(shape, i, n);
    weights.push(w);
    weightSum += w;
  }
  // weightSum is > 0 by construction (each weight ≥ a positive floor for n ≥ 1).
  const safeSum = weightSum > 0 ? weightSum : n;

  const bins: BinLiquidity[] = [];
  for (let i = 0; i < n; i += 1) {
    const weight = weights[i] ?? 0;
    const liquidity = (depositUsd * weight) / safeSum;
    bins.push({ binId: lower + i, liquidity, amountX: 0, amountY: 0 });
  }
  return bins;
}
