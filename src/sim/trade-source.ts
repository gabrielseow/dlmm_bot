// TradeSource abstracts where SwapTrade events come from: replayed from
// historical RPC for backtest, streamed from log subscription for live
// (Phase D).

import type { SwapTrade } from './types.js';

export interface TradeSource {
  /**
   * Async iterator over swap events in chronological order. Iterators are
   * expected to be single-use; create a fresh source for each backtest run.
   */
  trades(): AsyncIterable<SwapTrade>;
}
