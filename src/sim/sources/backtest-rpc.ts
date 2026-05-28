// Backtest trade source: paginate getSignaturesForAddress for a pool,
// fetch each transaction's logs, decode every Swap / Swap2Evt event via
// anchor's EventParser, and normalise into SwapTrade objects.
//
// Phase B status: implemented to spec but NOT yet exercised against a
// paid RPC in CI; the cross-check gate in §Verification.2 of the plan
// requires a real RPC URL and a real position to validate against.

import type BN from 'bn.js';
import { BorshCoder, EventParser } from '@coral-xyz/anchor';
import { Connection, PublicKey, type ConfirmedSignatureInfo } from '@solana/web3.js';
import { IDL, LBCLMM_PROGRAM_IDS } from '@meteora-ag/dlmm';
import type { TradeSource } from '../trade-source.js';
import type { SwapTrade } from '../types.js';

export interface BacktestSourceOptions {
  connection: Connection;
  pool: string;
  // Slot bounds inclusive. If omitted, source walks back from `latest` until
  // it has exhausted signatures (bounded by maxSignatures as a safety net).
  fromSlot?: bigint;
  toSlot?: bigint;
  // Hard cap on signatures fetched, regardless of slot bounds.
  maxSignatures?: number;
  // Page size for getSignaturesForAddress; the RPC max is 1000.
  pageSize?: number;
  // Optional progress hook called once per page fetched.
  onPage?: (info: { sigs: number; oldestSlot: bigint }) => void;
}

interface DecodedEvent {
  name: string;
  data: Record<string, unknown>;
}

function buildEventParser(): EventParser {
  const programId = new PublicKey(LBCLMM_PROGRAM_IDS['mainnet-beta']);
  // BorshCoder's first param is typed as Idl; the SDK exports IDL as a
  // const object literal that satisfies that shape.
  const coder = new BorshCoder(IDL as unknown as ConstructorParameters<typeof BorshCoder>[0]);
  return new EventParser(programId, coder);
}

function eventToSwapTrade(
  e: DecodedEvent,
  pool: string,
  slot: bigint,
  blockTime: number,
  sig: string,
  ixIndex: number,
): SwapTrade | null {
  if (e.name === 'Swap') {
    const d = e.data as {
      lbPair: PublicKey;
      startBinId: number;
      endBinId: number;
      amountIn: BN;
      amountOut: BN;
      swapForY: boolean;
      fee: BN;
      protocolFee: BN;
    };
    if (d.lbPair.toBase58() !== pool) return null;
    return {
      pool,
      slot,
      blockTime,
      sig,
      ixIndex,
      swapForY: d.swapForY,
      amountIn: d.amountIn,
      amountOut: d.amountOut,
      fee: d.fee,
      protocolFee: d.protocolFee,
      startBinId: d.startBinId,
      endBinId: d.endBinId,
    };
  }
  if (e.name === 'Swap2Evt') {
    const d = e.data as {
      lbPair: PublicKey;
      startBinId: number;
      endBinId: number;
      amountIn: BN;
      amountOut: BN;
      swapForY: boolean;
      mmFee: BN;
      protocolFee: BN;
      feesOnInput: boolean;
    };
    if (d.lbPair.toBase58() !== pool) return null;
    return {
      pool,
      slot,
      blockTime,
      sig,
      ixIndex,
      swapForY: d.swapForY,
      amountIn: d.amountIn,
      amountOut: d.amountOut,
      fee: d.mmFee,
      protocolFee: d.protocolFee,
      startBinId: d.startBinId,
      endBinId: d.endBinId,
      feeOnInput: d.feesOnInput,
    };
  }
  return null;
}

// Fetch signatures from newest to oldest, page by page. Returns when
// either slot bound is exceeded or maxSignatures is hit.
async function* paginateSignatures(
  conn: Connection,
  poolPk: PublicKey,
  opts: BacktestSourceOptions,
): AsyncGenerator<ConfirmedSignatureInfo[]> {
  const limit = Math.min(opts.pageSize ?? 1000, 1000);
  const maxSigs = opts.maxSignatures ?? Number.POSITIVE_INFINITY;
  let fetched = 0;
  let before: string | undefined;
  while (fetched < maxSigs) {
    const page = await conn.getSignaturesForAddress(poolPk, {
      before,
      limit,
    });
    if (page.length === 0) return;
    if (opts.toSlot !== undefined && BigInt(page[0]!.slot) > opts.toSlot) {
      // Drop entries above toSlot.
      const filtered = page.filter((p) => BigInt(p.slot) <= opts.toSlot!);
      if (filtered.length > 0) yield filtered;
    } else {
      yield page;
    }
    fetched += page.length;
    const oldest = page[page.length - 1]!;
    before = oldest.signature;
    if (opts.fromSlot !== undefined && BigInt(oldest.slot) < opts.fromSlot) return;
    opts.onPage?.({ sigs: fetched, oldestSlot: BigInt(oldest.slot) });
    if (page.length < limit) return;
  }
}

export function backtestSource(opts: BacktestSourceOptions): TradeSource {
  const poolPk = new PublicKey(opts.pool);
  const parser = buildEventParser();

  async function* iter(): AsyncIterable<SwapTrade> {
    // Buffer the pages and emit in chronological (slot-ascending) order
    // by reversing each page and emitting in reverse-pagination order.
    // getSignaturesForAddress returns newest-first; we collect into an
    // array of pages then iterate from the last page (oldest) forward.
    const pages: ConfirmedSignatureInfo[][] = [];
    for await (const page of paginateSignatures(conn(), poolPk, opts)) {
      pages.push(page);
    }
    for (let p = pages.length - 1; p >= 0; p--) {
      const page = pages[p]!;
      // Within a page newest-first → walk in reverse for chronological order.
      for (let i = page.length - 1; i >= 0; i--) {
        const sig = page[i]!;
        if (sig.err) continue;
        const slot = BigInt(sig.slot);
        if (opts.fromSlot !== undefined && slot < opts.fromSlot) continue;
        if (opts.toSlot !== undefined && slot > opts.toSlot) continue;
        const tx = await conn().getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });
        const logs = tx?.meta?.logMessages;
        if (!logs || logs.length === 0) continue;
        const blockTime = tx.blockTime ?? Math.floor(Date.now() / 1000);
        let ix = 0;
        for (const ev of parser.parseLogs(logs, /*errorOnDecodeFailure*/ false)) {
          const trade = eventToSwapTrade(
            ev as DecodedEvent,
            opts.pool,
            slot,
            blockTime,
            sig.signature,
            ix++,
          );
          if (trade !== null) yield trade;
        }
      }
    }
  }
  // Reuse the supplied connection rather than reopening it.
  function conn(): Connection {
    return opts.connection;
  }

  return {
    trades(): AsyncIterable<SwapTrade> {
      return iter();
    },
  };
}
