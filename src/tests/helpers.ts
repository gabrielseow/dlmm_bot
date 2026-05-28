// Test helpers: build a synthetic PoolState without hitting chain.

import BN from 'bn.js';
import { getQPriceFromId } from '@meteora-ag/dlmm';
import {
  newPoolState,
  emptyVParameters,
  zeroLimitOrderBinFields,
} from '../sim/pool-state.js';
import type {
  BinState,
  PoolMeta,
  PoolState,
  SParameters,
} from '../sim/types.js';

// Parameters tuned to a low-volatility stableswap pool (e.g. USDC/USDT 1bps).
export function defaultSParameters(collectFeeMode = 0): SParameters {
  return {
    baseFactor: 10000,
    filterPeriod: 30,
    decayPeriod: 600,
    reductionFactor: 5000,
    variableFeeControl: 40000,
    maxVolatilityAccumulator: 350000,
    minBinId: -443636,
    maxBinId: 443636,
    protocolShare: 500,        // 5% of LP fee
    baseFeePowerFactor: 0,
    functionType: 0,
    collectFeeMode,
    padding: [0, 0, 0],
  };
}

export interface BuildPoolOpts {
  address?: string;
  binStep?: number;
  activeId?: number;
  supportLimitOrder?: boolean;
  collectFeeMode?: number;
  sParameters?: SParameters;
}

export function buildPool(opts: BuildPoolOpts = {}): PoolState {
  const sParameters =
    opts.sParameters ?? defaultSParameters(opts.collectFeeMode ?? 0);
  const meta: PoolMeta = {
    address: opts.address ?? 'TestPool11111111111111111111111111111111111',
    tokenXMint: 'TokenX111111111111111111111111111111111111',
    tokenYMint: 'TokenY111111111111111111111111111111111111',
    decimalsX: 6,
    decimalsY: 6,
    binStep: opts.binStep ?? 1,
    supportLimitOrder: opts.supportLimitOrder ?? false,
  };
  return newPoolState(meta, opts.activeId ?? 0, sParameters, emptyVParameters());
}

export function setBin(
  pool: PoolState,
  binId: number,
  amountX: bigint,
  amountY: bigint,
  liquiditySupply: bigint,
): BinState {
  const bin: BinState = {
    binId,
    amountX: new BN(amountX.toString()),
    amountY: new BN(amountY.toString()),
    price: getQPriceFromId(new BN(binId), new BN(pool.meta.binStep)),
    liquiditySupply: new BN(liquiditySupply.toString()),
    feeAmountXPerTokenStored: new BN(0),
    feeAmountYPerTokenStored: new BN(0),
    ...zeroLimitOrderBinFields(),
  };
  pool.bins.set(binId, bin);
  return bin;
}

export function bn(x: bigint | number | string): BN {
  return new BN(x.toString());
}
