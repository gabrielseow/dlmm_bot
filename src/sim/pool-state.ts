// Construct and hydrate a PoolState. Hydration from chain uses the
// `@meteora-ag/dlmm` SDK so bin amounts and parameters come from the same
// source as the swap math we'll later call.

import BN from 'bn.js';
import type DLMM from '@meteora-ag/dlmm';
import { isSupportLimitOrder, getQPriceFromId } from '@meteora-ag/dlmm';
import type {
  BinState,
  PoolMeta,
  PoolState,
  SParameters,
  VParameters,
} from './types.js';

export function emptyVParameters(): VParameters {
  return {
    volatilityAccumulator: 0,
    volatilityReference: 0,
    indexReference: 0,
    padding: [0, 0, 0, 0],
    lastUpdateTimestamp: new BN(0),
    padding1: [0, 0, 0, 0, 0, 0, 0, 0],
  };
}

export function newPoolState(
  meta: PoolMeta,
  activeId: number,
  sParameters: SParameters,
  vParameters: VParameters = emptyVParameters(),
): PoolState {
  return {
    meta,
    activeId,
    sParameters,
    vParameters,
    bins: new Map(),
    lastSlot: 0n,
    lastBlockTime: 0,
  };
}

// Build a BinState from an SDK BinLiquidity (field-name remap from the
// SDK's xAmount/yAmount/supply to our amountX/amountY/liquiditySupply).
// `price` is computed from binId + binStep via getQPriceFromId because
// the on-chain swap math reads bin.price (BinLiquidity exposes a string
// representation, not the Q64.64 BN form the swap helper needs).
export function binStateFromBinLiquidity(
  b: {
    binId: number;
    xAmount: BN;
    yAmount: BN;
    supply: BN;
    feeAmountXPerTokenStored: BN;
    feeAmountYPerTokenStored: BN;
  },
  binStep: number,
): BinState {
  return {
    binId: b.binId,
    amountX: b.xAmount,
    amountY: b.yAmount,
    liquiditySupply: b.supply,
    price: getQPriceFromId(new BN(b.binId), new BN(binStep)),
    feeAmountXPerTokenStored: b.feeAmountXPerTokenStored,
    feeAmountYPerTokenStored: b.feeAmountYPerTokenStored,
    ...zeroLimitOrderBinFields(),
  };
}

// Load a window of bins from chain into a fresh PoolState.
export async function primeFromChain(
  dlmmPool: DLMM,
  lowerBinId: number,
  upperBinId: number,
): Promise<PoolState> {
  const lbPair = dlmmPool.lbPair;
  const meta: PoolMeta = {
    address: dlmmPool.pubkey.toBase58(),
    tokenXMint: lbPair.tokenXMint.toBase58(),
    tokenYMint: lbPair.tokenYMint.toBase58(),
    decimalsX: dlmmPool.tokenX.mint.decimals,
    decimalsY: dlmmPool.tokenY.mint.decimals,
    binStep: lbPair.binStep,
    supportLimitOrder: isSupportLimitOrder(lbPair),
  };

  const { activeBin, bins } = await dlmmPool.getBinsBetweenLowerAndUpperBound(
    lowerBinId,
    upperBinId,
  );

  // lbPair.parameters / lbPair.vParameters already match the SDK structural
  // SParameters/VParameters types — assign directly.
  const state = newPoolState(meta, activeBin, lbPair.parameters, lbPair.vParameters);
  for (const b of bins) {
    state.bins.set(b.binId, binStateFromBinLiquidity(b, meta.binStep));
  }
  return state;
}

// Construct an empty bin (used as the lazy-load default for bins not yet
// seen on chain). `price` matches the on-chain Q64.64 representation.
export function emptyBin(binId: number, binStep: number): BinState {
  return {
    binId,
    amountX: new BN(0),
    amountY: new BN(0),
    price: getQPriceFromId(new BN(binId), new BN(binStep)),
    liquiditySupply: new BN(0),
    feeAmountXPerTokenStored: new BN(0),
    feeAmountYPerTokenStored: new BN(0),
    ...zeroLimitOrderBinFields(),
  };
}

export function getOrCreateBin(state: PoolState, binId: number): BinState {
  const existing = state.bins.get(binId);
  if (existing !== undefined) return existing;
  const created = emptyBin(binId, state.meta.binStep);
  state.bins.set(binId, created);
  return created;
}

// Default-zero limit-order / padding fields. We pass supportLimitOrder=false
// to the SDK so these stay zero, but the SDK Bin type requires them.
export function zeroLimitOrderBinFields(): Pick<
  BinState,
  | 'fulfilledOrderAmountX'
  | 'fulfilledOrderAmountY'
  | 'limitOrderFeeAskSide'
  | 'limitOrderFeeBidSide'
  | 'openOrderAmount'
  | 'totalProcessingOrderAmount'
  | 'processedOrderRemainingAmount'
  | 'orderAge'
  | 'limitOrderAskSide'
  | 'padding1'
> {
  return {
    fulfilledOrderAmountX: new BN(0),
    fulfilledOrderAmountY: new BN(0),
    limitOrderFeeAskSide: new BN(0),
    limitOrderFeeBidSide: new BN(0),
    openOrderAmount: new BN(0),
    totalProcessingOrderAmount: new BN(0),
    processedOrderRemainingAmount: new BN(0),
    orderAge: 0,
    limitOrderAskSide: 0,
    padding1: [0, 0, 0],
  };
}
