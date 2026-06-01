// PURE valuation, impermanent loss & net PnL (FR-007, Decision 6). Reuses the
// same bin geometry as the fee model so value and fees stay mutually consistent.
//
// Token Y is the numeraire (price P = token_y per token_x). A bin spanning
// [pa, pb] holding liquidity L holds, at price P (sqrt s clamped to [√pa, √pb]):
//   amountX = L · (√pb − s) / (s · √pb)      (all X when P ≤ pa — bin above price)
//   amountY = L · (s − √pa)                  (all Y when P ≥ pb — bin below price)
// matching "bins below the active price hold token Y, above hold token X".
//
// The position's per-bin USD weight (from distributeLiquidity) is converted to a
// liquidity L calibrated so each bin's value at the OPEN price equals that
// weight; the deposit's token composition is then the position's composition at
// open. This makes impermanent loss exactly zero when the price is unchanged
// (SC, US4 #2), with USD figures anchored on token Y's USD price.

import { binIdToPrice } from './bins.js';
import type { BinLiquidity, TokenAmounts, Valuation } from './types.js';

/** Per-unit-liquidity token amounts for a bin [pa, pb] at price `price`. */
function perLiquidityAmounts(
  price: number,
  pa: number,
  pb: number,
): { ax: number; ay: number } {
  const sa = Math.sqrt(pa);
  const sb = Math.sqrt(pb);
  const s = Math.min(Math.max(Math.sqrt(price), sa), sb);
  const ax = s > 0 && sb > 0 ? (sb - s) / (s * sb) : 0;
  const ay = s - sa;
  return { ax: Number.isFinite(ax) && ax > 0 ? ax : 0, ay: Number.isFinite(ay) && ay > 0 ? ay : 0 };
}

export interface ValuationInput {
  /** Per-bin USD weights from distributeLiquidity (the `liquidity` field). */
  binLiquidity: BinLiquidity[];
  binStep: number;
  /** Price the position was opened at (token Y per token X). */
  openPrice: number;
  /** Price the position is valued/closed at. */
  markPrice: number;
  /** Token X USD price (diagnostic only; Y is the numeraire). */
  priceXUsd: number;
  /** Token Y USD price — the USD anchor. */
  priceYUsd: number;
  /** Earned fees in USD (from the FeeBreakdown). */
  earnedFeesUsd: number;
}

export interface ValuationResult {
  valuation: Valuation;
  /** Token amounts the position returns when closed at the marking price. */
  returnedAmounts: TokenAmounts;
}

/**
 * Compute position value, hold value, impermanent loss and net PnL at the
 * marking price. Deterministic and guarded against degenerate inputs (no
 * Infinity/NaN; flat price ⇒ IL = 0).
 */
export function computeValuation(input: ValuationInput): ValuationResult {
  const { binLiquidity, binStep, openPrice, markPrice, priceYUsd, earnedFeesUsd } = input;
  const py = Number.isFinite(priceYUsd) && priceYUsd > 0 ? priceYUsd : 1;

  // Calibrate per-bin liquidity L so each bin's value-in-Y at openPrice equals
  // its USD weight expressed in Y units.
  interface Calibrated {
    L: number;
    pa: number;
    pb: number;
  }
  const bins: Calibrated[] = [];
  let openX = 0;
  let openY = 0;
  for (const b of binLiquidity) {
    const pa = binIdToPrice(b.binId, binStep);
    const pb = binIdToPrice(b.binId + 1, binStep);
    const open = perLiquidityAmounts(openPrice, pa, pb);
    const valueYPerL = open.ax * openPrice + open.ay;
    const weightY = (Number.isFinite(b.liquidity) && b.liquidity > 0 ? b.liquidity : 0) / py;
    const L = valueYPerL > 0 ? weightY / valueYPerL : 0;
    bins.push({ L, pa, pb });
    openX += L * open.ax;
    openY += L * open.ay;
  }

  // Position composition + value at the marking price.
  let markX = 0;
  let markY = 0;
  for (const b of bins) {
    const m = perLiquidityAmounts(markPrice, b.pa, b.pb);
    markX += b.L * m.ax;
    markY += b.L * m.ay;
  }

  const positionValueY = markX * markPrice + markY;
  const positionValueUsd = positionValueY * py;
  const holdValueY = openX * markPrice + openY;
  const holdValueUsd = holdValueY * py;
  const impermanentLossUsd = holdValueUsd - positionValueUsd;
  const netPnlUsd = earnedFeesUsd - impermanentLossUsd;

  const valuation: Valuation = {
    markPrice,
    positionValueUsd,
    holdValueUsd,
    impermanentLossUsd,
    earnedFeesUsd,
    netPnlUsd,
  };

  const returnedAmounts: TokenAmounts = { x: markX, y: markY, usd: positionValueUsd };

  return { valuation, returnedAmounts };
}
