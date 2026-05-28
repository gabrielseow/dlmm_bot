// Shared types for the position simulator.
//
// Field names on BinState mirror the SDK `Bin` IDL one-for-one so a
// BinState can be passed directly into `swapExactInQuoteAtBin` without
// an adapter. sParameters/vParameters are re-exported SDK types so we
// never drift from the IDL the swap math reads.

import type BN from 'bn.js';
import type {
  sParameters as SdkSParameters,
  vParameters as SdkVParameters,
} from '@meteora-ag/dlmm';

export type SParameters = SdkSParameters;
export type VParameters = SdkVParameters;

export interface PoolMeta {
  address: string;
  tokenXMint: string;
  tokenYMint: string;
  decimalsX: number;
  decimalsY: number;
  binStep: number;
  supportLimitOrder: boolean;
}

// Mirrors the SDK `Bin` IDL one-for-one (passed directly into the swap
// math). Limit-order fields default to zero; we run with
// supportLimitOrder=false in Phase A.
export interface BinState {
  binId: number;
  amountX: BN;
  amountY: BN;
  price: BN;
  liquiditySupply: BN;
  fulfilledOrderAmountX: BN;
  fulfilledOrderAmountY: BN;
  limitOrderFeeAskSide: BN;
  limitOrderFeeBidSide: BN;
  feeAmountXPerTokenStored: BN;
  feeAmountYPerTokenStored: BN;
  openOrderAmount: BN;
  totalProcessingOrderAmount: BN;
  processedOrderRemainingAmount: BN;
  orderAge: number;
  limitOrderAskSide: number;
  padding1: number[];
}

export interface PoolState {
  meta: PoolMeta;
  activeId: number;
  // SDK-shaped sParameters/vParameters. Mutated in place by the SDK's
  // updateVolatilityAccumulator / updateReference helpers each swap.
  sParameters: SParameters;
  vParameters: VParameters;
  bins: Map<number, BinState>;
  lastSlot: bigint;
  lastBlockTime: number;
}

export interface PositionBinShare {
  binId: number;
  share: BN;                  // user's slice of bin.liquiditySupply
  feeDebtX: BN;               // snapshot of feeAmountXPerTokenStored at last settle
  feeDebtY: BN;
  accruedFeeX: BN;            // settled fees not yet claimed
  accruedFeeY: BN;
}

export type PositionEventKind =
  | 'open'
  | 'deposit'
  | 'withdraw'
  | 'claim'
  | 'close';

export interface PositionEvent {
  kind: PositionEventKind;
  slot: bigint;
  blockTime: number;
  amountX: BN;
  amountY: BN;
  feeX?: BN;
  feeY?: BN;
}

export interface SimulatedPosition {
  id: string;
  pool: string;
  ownerLabel: string;
  lowerBinId: number;
  upperBinId: number;
  shares: Map<number, PositionBinShare>;
  totals: {
    accruedFeeX: BN;
    accruedFeeY: BN;
    claimedFeeX: BN;
    claimedFeeY: BN;
    initialDepositX: BN;
    initialDepositY: BN;
    initialUsdValue?: number;
  };
  createdAtSlot: bigint;
  events: PositionEvent[];
}

// Normalised on-chain swap. Built by trade sources from Swap/Swap2Evt logs.
export interface SwapTrade {
  pool: string;
  slot: bigint;
  blockTime: number;
  sig: string;
  // Index of the swap within its transaction (a Jupiter route can emit
  // multiple Swap events; intra-tx order matters).
  ixIndex: number;
  swapForY: boolean;          // X -> Y if true, else Y -> X
  amountIn: BN;
  amountOut: BN;
  fee: BN;                    // total LP-side fee (incl. protocol share)
  protocolFee: BN;
  startBinId: number;
  endBinId: number;
  // Present on Swap2Evt; undefined on legacy Swap (caller resolves via getFeeMode).
  feeOnInput?: boolean;
}
