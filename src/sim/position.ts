// Position lifecycle: open, deposit (extend with more bin shares),
// withdraw (proportional or full), claim accrued fees.
//
// Liquidity bookkeeping mirrors the on-chain DLMM: each bin holds a total
// `liquiditySupply` and each LP owns a `share` of it. Bin reserves and
// supply move atomically on deposit/withdraw. Fees due to share owners are
// settled before every share change via `settleBinShare`.

import BN from 'bn.js';
import type {
  BinState,
  PoolState,
  PositionBinShare,
  PositionEvent,
  SimulatedPosition,
} from './types.js';
import { getOrCreateBin } from './pool-state.js';
import { settleBinShare } from './trade-applier.js';

export interface BinDeposit {
  binId: number;
  amountX: BN;
  amountY: BN;
}

function emptyBinShare(binId: number, bin: BinState): PositionBinShare {
  return {
    binId,
    share: new BN(0),
    feeDebtX: bin.feeAmountXPerTokenStored,
    feeDebtY: bin.feeAmountYPerTokenStored,
    accruedFeeX: new BN(0),
    accruedFeeY: new BN(0),
  };
}

function emptyTotals(): SimulatedPosition['totals'] {
  return {
    accruedFeeX: new BN(0),
    accruedFeeY: new BN(0),
    claimedFeeX: new BN(0),
    claimedFeeY: new BN(0),
    initialDepositX: new BN(0),
    initialDepositY: new BN(0),
  };
}

// Compute the share contribution of a deposit into a single bin. We use a
// simple linear pricing model: 1 unit of either token deposited adds 1
// unit of share. This matches the DLMM "liquidity supply" definition for
// the simulator's purposes; the on-chain program uses a more nuanced
// Q64.64 formulation that mixes amountX and amountY at the bin price, but
// since LPs always sum to the bin's `liquiditySupply` and we track shares
// as a fraction of that supply, the simulator's per-share fee math holds
// regardless of the absolute scaling.
function depositSharesForBin(d: BinDeposit): BN {
  return d.amountX.add(d.amountY);
}

export interface OpenPositionParams {
  id: string;
  pool: PoolState;
  ownerLabel: string;
  lowerBinId: number;
  upperBinId: number;
  deposits: BinDeposit[];
  slot: bigint;
  blockTime: number;
  initialUsdValue?: number;
}

export function openPosition(p: OpenPositionParams): SimulatedPosition {
  if (p.upperBinId < p.lowerBinId) {
    throw new Error(
      `upperBinId ${p.upperBinId} < lowerBinId ${p.lowerBinId}`,
    );
  }
  for (const d of p.deposits) {
    if (d.binId < p.lowerBinId || d.binId > p.upperBinId) {
      throw new Error(
        `deposit binId ${d.binId} outside [${p.lowerBinId}, ${p.upperBinId}]`,
      );
    }
  }

  const position: SimulatedPosition = {
    id: p.id,
    pool: p.pool.meta.address,
    ownerLabel: p.ownerLabel,
    lowerBinId: p.lowerBinId,
    upperBinId: p.upperBinId,
    shares: new Map(),
    totals: { ...emptyTotals(), ...(p.initialUsdValue !== undefined ? { initialUsdValue: p.initialUsdValue } : {}) },
    createdAtSlot: p.slot,
    events: [],
  };

  applyDeposit(p.pool, position, p.deposits, p.slot, p.blockTime, /*initial*/ true);
  return position;
}

export function deposit(
  pool: PoolState,
  position: SimulatedPosition,
  deposits: BinDeposit[],
  slot: bigint,
  blockTime: number,
): void {
  applyDeposit(pool, position, deposits, slot, blockTime, /*initial*/ false);
}

function applyDeposit(
  pool: PoolState,
  position: SimulatedPosition,
  deposits: BinDeposit[],
  slot: bigint,
  blockTime: number,
  initial: boolean,
): void {
  let totalX = new BN(0);
  let totalY = new BN(0);
  for (const d of deposits) {
    const bin = getOrCreateBin(pool, d.binId);
    let share = position.shares.get(d.binId);
    if (share === undefined) {
      share = emptyBinShare(d.binId, bin);
      position.shares.set(d.binId, share);
    } else {
      settleBinShare(bin, share, position);
    }
    const newShares = depositSharesForBin(d);
    share.share = share.share.add(newShares);
    bin.liquiditySupply = bin.liquiditySupply.add(newShares);
    bin.amountX = bin.amountX.add(d.amountX);
    bin.amountY = bin.amountY.add(d.amountY);
    totalX = totalX.add(d.amountX);
    totalY = totalY.add(d.amountY);
  }
  if (initial) {
    position.totals.initialDepositX = position.totals.initialDepositX.add(totalX);
    position.totals.initialDepositY = position.totals.initialDepositY.add(totalY);
  }
  const ev: PositionEvent = {
    kind: initial ? 'open' : 'deposit',
    slot,
    blockTime,
    amountX: totalX,
    amountY: totalY,
  };
  position.events.push(ev);
}

// Withdraw a fraction of each bin share. fraction = numerator/denominator
// (BN to avoid floating-point drift). Withdraws the proportional share of
// bin reserves at the time of withdrawal.
export function withdraw(
  pool: PoolState,
  position: SimulatedPosition,
  numerator: BN,
  denominator: BN,
  slot: bigint,
  blockTime: number,
): { amountX: BN; amountY: BN } {
  if (denominator.isZero() || numerator.isNeg() || denominator.isNeg()) {
    throw new Error('invalid withdraw fraction');
  }
  let totalX = new BN(0);
  let totalY = new BN(0);
  for (const share of position.shares.values()) {
    const bin = pool.bins.get(share.binId);
    if (bin === undefined) continue;
    settleBinShare(bin, share, position);
    if (share.share.isZero() || bin.liquiditySupply.isZero()) continue;
    const removed = share.share.mul(numerator).div(denominator);
    if (removed.isZero()) continue;
    // Withdraw a proportional slice of the bin's reserves.
    const xOut = bin.amountX.mul(removed).div(bin.liquiditySupply);
    const yOut = bin.amountY.mul(removed).div(bin.liquiditySupply);
    bin.amountX = bin.amountX.sub(xOut);
    bin.amountY = bin.amountY.sub(yOut);
    bin.liquiditySupply = bin.liquiditySupply.sub(removed);
    share.share = share.share.sub(removed);
    totalX = totalX.add(xOut);
    totalY = totalY.add(yOut);
  }
  position.events.push({
    kind: 'withdraw',
    slot,
    blockTime,
    amountX: totalX,
    amountY: totalY,
  });
  return { amountX: totalX, amountY: totalY };
}

// Claim all currently-accrued fees. Updates totals.claimedFee*, zeroes the
// per-bin accrued, and emits a 'claim' event. Does NOT touch bin
// liquidity; fees are paid out of bin reserves in the on-chain program,
// but they were already subtracted from reserves at the time the swap
// touched the bin (i.e. the LP fee is "earmarked" in the bin's reserves
// for the LPs and accumulates against per-share). For the simulator's
// accounting purposes we treat claim as a bookkeeping event.
export function claim(
  pool: PoolState,
  position: SimulatedPosition,
  slot: bigint,
  blockTime: number,
): { feeX: BN; feeY: BN } {
  let feeX = new BN(0);
  let feeY = new BN(0);
  for (const share of position.shares.values()) {
    const bin = pool.bins.get(share.binId);
    if (bin === undefined) continue;
    settleBinShare(bin, share, position);
    feeX = feeX.add(share.accruedFeeX);
    feeY = feeY.add(share.accruedFeeY);
    share.accruedFeeX = new BN(0);
    share.accruedFeeY = new BN(0);
  }
  position.totals.accruedFeeX = new BN(0);
  position.totals.accruedFeeY = new BN(0);
  position.totals.claimedFeeX = position.totals.claimedFeeX.add(feeX);
  position.totals.claimedFeeY = position.totals.claimedFeeY.add(feeY);
  position.events.push({
    kind: 'claim',
    slot,
    blockTime,
    amountX: new BN(0),
    amountY: new BN(0),
    feeX,
    feeY,
  });
  return { feeX, feeY };
}

export function totalShares(position: SimulatedPosition): BN {
  let total = new BN(0);
  for (const s of position.shares.values()) total = total.add(s.share);
  return total;
}
