// CLI: replay historical swaps for a pool, run them through a simulated
// position, print fee/IL accounting.
//
// Phase B status: end-to-end wiring is here, but it has not yet been
// exercised against a paid RPC. To actually run, export RPC_URL=<your-rpc>
// then `npm run sim:backtest -- --pool <addr> --window <slots>`.

import DLMM from '@meteora-ag/dlmm';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { connection } from '../rpc.js';
import { primeFromChain } from '../sim/pool-state.js';
import { applyTrade, settlePosition } from '../sim/trade-applier.js';
import { openPosition } from '../sim/position.js';
import { backtestSource } from '../sim/sources/backtest-rpc.js';
import type { BinDeposit } from '../sim/position.js';

interface Args {
  pool: string;
  fromSlot?: bigint;
  toSlot?: bigint;
  rangeBins: number;
  depositX: bigint;
  depositY: bigint;
  maxSignatures: number;
}

function parseArgs(argv: string[]): Args {
  const map: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k && k.startsWith('--') && v !== undefined) map[k.slice(2)] = v;
  }
  if (!map.pool) {
    throw new Error('--pool <address> is required');
  }
  return {
    pool: map.pool,
    fromSlot: map['from-slot'] !== undefined ? BigInt(map['from-slot']) : undefined,
    toSlot: map['to-slot'] !== undefined ? BigInt(map['to-slot']) : undefined,
    rangeBins: map.range !== undefined ? Number(map.range) : 20,
    depositX: map['deposit-x'] !== undefined ? BigInt(map['deposit-x']) : 0n,
    depositY: map['deposit-y'] !== undefined ? BigInt(map['deposit-y']) : 1_000_000n,
    maxSignatures: map['max-sigs'] !== undefined ? Number(map['max-sigs']) : 5_000,
  };
}

function fmt(bn: BN, decimals: number): string {
  const s = bn.toString(10).padStart(decimals + 1, '0');
  const int = s.slice(0, -decimals) || '0';
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const conn = connection();
  console.log(`Loading DLMM ${args.pool}...`);
  const dlmm = await DLMM.create(conn, new PublicKey(args.pool));
  const active = dlmm.lbPair.activeId;
  const lower = active - args.rangeBins;
  const upper = active + args.rangeBins;
  console.log(`Active bin ${active}; priming bins ${lower}..${upper}`);
  const pool = await primeFromChain(dlmm, lower, upper);

  // Deposit Y evenly into all bins from active-range to active (the "bid"
  // side a USDC depositor would take). Spot distribution: equal amount per bin.
  const bidBins: BinDeposit[] = [];
  const bidCount = active - lower + 1;
  const perBinY = args.depositY > 0n ? args.depositY / BigInt(bidCount) : 0n;
  for (let id = lower; id <= active; id++) {
    bidBins.push({
      binId: id,
      amountX: new BN(0),
      amountY: new BN(perBinY.toString()),
    });
  }
  const askBins: BinDeposit[] = [];
  const askCount = upper - active;
  const perBinX = args.depositX > 0n && askCount > 0
    ? args.depositX / BigInt(askCount)
    : 0n;
  for (let id = active + 1; id <= upper; id++) {
    askBins.push({
      binId: id,
      amountX: new BN(perBinX.toString()),
      amountY: new BN(0),
    });
  }
  const position = openPosition({
    id: 'sim-1',
    pool,
    ownerLabel: 'backtest',
    lowerBinId: lower,
    upperBinId: upper,
    deposits: [...bidBins, ...askBins],
    slot: pool.lastSlot,
    blockTime: pool.lastBlockTime,
  });
  console.log(
    `Opened position [${lower}..${upper}], initial deposit X=${fmt(position.totals.initialDepositX, pool.meta.decimalsX)} Y=${fmt(position.totals.initialDepositY, pool.meta.decimalsY)}`,
  );

  const source = backtestSource({
    connection: conn,
    pool: args.pool,
    fromSlot: args.fromSlot,
    toSlot: args.toSlot,
    maxSignatures: args.maxSignatures,
    onPage: ({ sigs, oldestSlot }) => {
      console.log(`  signatures: ${sigs}; oldest slot ${oldestSlot}`);
    },
  });

  let trades = 0;
  let inRange = 0;
  for await (const trade of source.trades()) {
    applyTrade(pool, trade);
    trades++;
    if (pool.activeId >= lower && pool.activeId <= upper) inRange++;
  }
  settlePosition(pool, position);

  console.log('');
  console.log(`Replayed ${trades} swaps; activeId now ${pool.activeId}`);
  console.log(`Time-in-range: ${trades > 0 ? ((inRange / trades) * 100).toFixed(2) : '0.00'}%`);
  console.log(`Accrued fees X: ${fmt(position.totals.accruedFeeX, pool.meta.decimalsX)}`);
  console.log(`Accrued fees Y: ${fmt(position.totals.accruedFeeY, pool.meta.decimalsY)}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
