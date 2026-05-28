// applyTrade — pure mutation of a PoolState by a single normalized SwapTrade.
// Uses the SDK's swap math (swapExactInQuoteAtBin) and vParameters update
// helpers so the simulator never re-derives the on-chain formulas.
//
// Position fees are NOT credited here; positions settle lazily on read via
// settlePosition(). This keeps the hot path O(bins-touched) regardless of
// how many positions overlap the swap range.

import BN from 'bn.js';
import DLMM, { swapExactInQuoteAtBin } from '@meteora-ag/dlmm';
import type {
  BinState,
  PoolState,
  PositionBinShare,
  SimulatedPosition,
  SwapTrade,
} from './types.js';
import { getOrCreateBin } from './pool-state.js';

// Q64 shift constant for per-share fee accumulator math, mirroring the
// on-chain `feeAmountXPerTokenStored` Q64.64 representation.
const Q64 = new BN(1).shln(64);

export interface ApplyTradeResult {
  startBinId: number;
  endBinId: number;
  binsTouched: number;
  totalFee: BN;
  totalProtocolFee: BN;
  totalAmountIn: BN;
  totalAmountOut: BN;
}

// Mirror of SDK getFeeMode but reading directly from PoolMeta.collectFeeMode
// (so we don't need to drag an LbPair object through the simulator).
// 0 = InputOnly, 1 = OnlyY.
function resolveFeeMode(
  collectFeeMode: number,
  swapForY: boolean,
  override?: boolean,
): { feeOnInput: boolean; feeOnTokenX: boolean } {
  let feeOnInput: boolean;
  let feeOnTokenX: boolean;
  switch (collectFeeMode) {
    case 0:
      feeOnInput = true;
      feeOnTokenX = swapForY;
      break;
    case 1:
      feeOnInput = !swapForY;
      feeOnTokenX = false;
      break;
    default:
      throw new Error(`Invalid collectFeeMode ${collectFeeMode}`);
  }
  // Swap2Evt explicitly tells us feeOnInput; if provided it overrides any
  // ambiguity (some pools may shift modes on upgrade).
  if (override !== undefined && override !== feeOnInput) {
    feeOnInput = override;
  }
  return { feeOnInput, feeOnTokenX };
}

export function applyTrade(
  pool: PoolState,
  trade: SwapTrade,
): ApplyTradeResult {
  if (trade.pool !== pool.meta.address) {
    throw new Error(
      `trade.pool ${trade.pool} != poolState ${pool.meta.address}`,
    );
  }

  // Update reference parameters before walking bins, exactly as the on-chain
  // program does at the start of a swap (decay vs reset based on
  // filter/decay periods).
  DLMM.updateReference(
    pool.activeId,
    pool.vParameters,
    pool.sParameters,
    trade.blockTime,
  );

  const { feeOnInput, feeOnTokenX } = resolveFeeMode(
    (pool.sParameters as { collectFeeMode: number }).collectFeeMode,
    trade.swapForY,
    trade.feeOnInput,
  );

  let cursor = pool.activeId;
  let remainingIn = trade.amountIn.clone();
  let totalAmountIn = new BN(0);
  let totalAmountOut = new BN(0);
  let totalFee = new BN(0);
  let totalProtocolFee = new BN(0);
  let binsTouched = 0;

  // Hard cap to prevent runaway on pathological inputs. A normal cross-bin
  // swap traverses far fewer bins than this.
  const MAX_BINS = 10_000;

  while (!remainingIn.isZero() && binsTouched < MAX_BINS) {
    // Recompute the volatility accumulator at the *current* cursor before
    // the per-bin quote, matching the on-chain swap loop.
    DLMM.updateVolatilityAccumulator(
      pool.vParameters,
      pool.sParameters,
      cursor,
    );

    const bin = getOrCreateBin(pool, cursor);
    const { amountIn, amountOut, fee, protocolFee } = swapExactInQuoteAtBin(
      bin,
      pool.meta.binStep,
      pool.sParameters,
      pool.vParameters,
      remainingIn,
      trade.swapForY,
      pool.meta.supportLimitOrder,
      feeOnInput,
    );

    if (amountIn.isZero() && amountOut.isZero()) {
      // Bin had no available liquidity in this direction — step to the next.
      cursor += trade.swapForY ? -1 : 1;
      binsTouched++;
      continue;
    }

    // Reserve update:
    //   - LP fee (`fee`) stays in the bin's reserves (and is what we credit
    //     per-share below); protocolFee leaves the pool.
    //   - When feeOnInput=true:  fee/protocolFee are taken from the *input* token.
    //     Bin input += amountIn (gross trader input), then bin input -= protocolFee.
    //     Bin output -= amountOut (trader receives exactly amountOut).
    //   - When feeOnInput=false: fee/protocolFee are taken from the *output* token.
    //     Bin input += amountIn (full).
    //     Bin output -= (amountOut + protocolFee). Trader gets amountOut.
    if (trade.swapForY) {
      if (feeOnInput) {
        bin.amountX = bin.amountX.add(amountIn).sub(protocolFee);
        bin.amountY = bin.amountY.sub(amountOut);
      } else {
        bin.amountX = bin.amountX.add(amountIn);
        bin.amountY = bin.amountY.sub(amountOut).sub(protocolFee);
      }
    } else {
      if (feeOnInput) {
        bin.amountY = bin.amountY.add(amountIn).sub(protocolFee);
        bin.amountX = bin.amountX.sub(amountOut);
      } else {
        bin.amountY = bin.amountY.add(amountIn);
        bin.amountX = bin.amountX.sub(amountOut).sub(protocolFee);
      }
    }

    // Distribute LP-side fee across this bin's liquidity supply via the Q64
    // per-share accumulator. If the bin has no supply, fees still leave as
    // protocolFee but the LP portion has nobody to accrue to.
    if (!fee.isZero() && !bin.liquiditySupply.isZero()) {
      const delta = fee.mul(Q64).div(bin.liquiditySupply);
      if (feeOnTokenX) {
        bin.feeAmountXPerTokenStored = bin.feeAmountXPerTokenStored.add(delta);
      } else {
        bin.feeAmountYPerTokenStored = bin.feeAmountYPerTokenStored.add(delta);
      }
    }

    totalAmountIn = totalAmountIn.add(amountIn);
    totalAmountOut = totalAmountOut.add(amountOut);
    totalFee = totalFee.add(fee);
    totalProtocolFee = totalProtocolFee.add(protocolFee);
    remainingIn = remainingIn.sub(amountIn);
    binsTouched++;

    if (remainingIn.isZero()) break;

    // Move to the next bin in the swap direction.
    cursor += trade.swapForY ? -1 : 1;
  }

  pool.activeId = cursor;
  pool.lastSlot = trade.slot;
  pool.lastBlockTime = trade.blockTime;

  return {
    startBinId: trade.startBinId,
    endBinId: cursor,
    binsTouched,
    totalFee,
    totalProtocolFee,
    totalAmountIn,
    totalAmountOut,
  };
}

// Settle a position's accrued fees against current bin accumulators. Cheap;
// safe to call repeatedly. Call before any liquidity change so the user's
// share transitions are accounted for at the right per-share level.
export function settlePosition(
  pool: PoolState,
  position: SimulatedPosition,
): void {
  for (const share of position.shares.values()) {
    const bin = pool.bins.get(share.binId);
    if (bin === undefined) continue;
    settleBinShare(bin, share, position);
  }
}

export function settleBinShare(
  bin: BinState,
  share: PositionBinShare,
  position: SimulatedPosition,
): void {
  if (share.share.isZero()) {
    share.feeDebtX = bin.feeAmountXPerTokenStored;
    share.feeDebtY = bin.feeAmountYPerTokenStored;
    return;
  }
  const dx = bin.feeAmountXPerTokenStored.sub(share.feeDebtX);
  const dy = bin.feeAmountYPerTokenStored.sub(share.feeDebtY);
  if (!dx.isZero()) {
    const earnedX = share.share.mul(dx).div(Q64);
    share.accruedFeeX = share.accruedFeeX.add(earnedX);
    position.totals.accruedFeeX = position.totals.accruedFeeX.add(earnedX);
  }
  if (!dy.isZero()) {
    const earnedY = share.share.mul(dy).div(Q64);
    share.accruedFeeY = share.accruedFeeY.add(earnedY);
    position.totals.accruedFeeY = position.totals.accruedFeeY.add(earnedY);
  }
  share.feeDebtX = bin.feeAmountXPerTokenStored;
  share.feeDebtY = bin.feeAmountYPerTokenStored;
}

export { Q64 };
