import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import { applyTrade, settlePosition } from '../sim/trade-applier.js';
import { openPosition, deposit, withdraw, claim, totalShares } from '../sim/position.js';
import { buildPool, setBin, bn } from './helpers.js';
import type { SwapTrade } from '../sim/types.js';

const POOL = 'TestPool11111111111111111111111111111111111';

function makeTrade(o: Partial<SwapTrade> = {}): SwapTrade {
  return {
    pool: POOL,
    slot: 1n,
    blockTime: 1_700_000_000,
    sig: 'sig-1',
    ixIndex: 0,
    swapForY: true,
    amountIn: new BN(1_000_000),
    amountOut: new BN(0),
    fee: new BN(0),
    protocolFee: new BN(0),
    startBinId: 0,
    endBinId: 0,
    ...o,
  };
}

describe('position', () => {
  it('open + first swap accrues fee, claim zeros accrued', () => {
    const pool = buildPool({ activeId: 0 });
    setBin(pool, 0, 0n, 100_000_000n, 0n);
    const p = openPosition({
      id: 'p1', pool, ownerLabel: 'alice',
      lowerBinId: 0, upperBinId: 0,
      deposits: [{ binId: 0, amountX: bn(0), amountY: bn(50_000_000) }],
      slot: 1n, blockTime: 1_700_000_000,
    });
    applyTrade(pool, makeTrade({ amountIn: new BN(500_000) }));
    settlePosition(pool, p);
    const beforeClaim = p.totals.accruedFeeX.add(p.totals.accruedFeeY);
    assert.ok(beforeClaim.gt(new BN(0)));

    const { feeX, feeY } = claim(pool, p, 2n, 1_700_000_100);
    assert.equal(feeX.add(feeY).toString(), beforeClaim.toString());
    assert.equal(p.totals.accruedFeeX.toString(), '0');
    assert.equal(p.totals.accruedFeeY.toString(), '0');
    assert.equal(
      p.totals.claimedFeeX.add(p.totals.claimedFeeY).toString(),
      beforeClaim.toString(),
    );
  });

  it('withdraw scales bin reserves proportionally', () => {
    const pool = buildPool({ activeId: 0 });
    setBin(pool, 0, 0n, 0n, 0n);
    const p = openPosition({
      id: 'p1', pool, ownerLabel: 'alice',
      lowerBinId: 0, upperBinId: 0,
      deposits: [{ binId: 0, amountX: bn(0), amountY: bn(100_000) }],
      slot: 1n, blockTime: 1_700_000_000,
    });
    // After deposit: bin.amountY = 100_000, supply = 100_000, position share = 100_000
    const bin = pool.bins.get(0)!;
    assert.equal(bin.amountY.toString(), '100000');
    assert.equal(bin.liquiditySupply.toString(), '100000');

    // Withdraw half
    const out = withdraw(pool, p, new BN(1), new BN(2), 2n, 1_700_000_100);
    assert.equal(out.amountY.toString(), '50000');
    assert.equal(bin.amountY.toString(), '50000');
    assert.equal(bin.liquiditySupply.toString(), '50000');
    assert.equal(totalShares(p).toString(), '50000');
  });

  it('pre-withdraw fees preserved, post-withdraw fees scale to new share', () => {
    const pool = buildPool({ activeId: 0 });
    setBin(pool, 0, 0n, 1_000_000_000n, 0n);

    const p = openPosition({
      id: 'p', pool, ownerLabel: 'alice',
      lowerBinId: 0, upperBinId: 0,
      deposits: [{ binId: 0, amountX: bn(0), amountY: bn(100_000) }],
      slot: 1n, blockTime: 1_700_000_000,
    });
    // Second LP so bin liquidity isn't 100% ours (gives realistic fee math).
    const q = openPosition({
      id: 'q', pool, ownerLabel: 'bob',
      lowerBinId: 0, upperBinId: 0,
      deposits: [{ binId: 0, amountX: bn(0), amountY: bn(100_000) }],
      slot: 1n, blockTime: 1_700_000_000,
    });

    // First swap: both have 50% share
    applyTrade(pool, makeTrade({ amountIn: new BN(50_000), slot: 2n }));
    settlePosition(pool, p);
    const feesAfterFirstX = p.totals.accruedFeeX.clone();

    // p withdraws half
    withdraw(pool, p, new BN(1), new BN(2), 3n, 1_700_000_200);
    // p's accrued from before withdraw should still be on the books
    assert.equal(p.totals.accruedFeeX.toString(), feesAfterFirstX.toString());

    // Second swap: p now has 1/3 share (half of original 50%), q has 2/3
    applyTrade(pool, makeTrade({ amountIn: new BN(50_000), slot: 4n }));
    settlePosition(pool, p);
    settlePosition(pool, q);

    const pFeeFromSecond = p.totals.accruedFeeX.sub(feesAfterFirstX);
    const qFeeTotal = q.totals.accruedFeeX;
    // qFeeTotal includes both swaps. The first swap was 50/50, the second
    // was 1/3 - 2/3. So qFeeTotal - feesAfterFirstX (q's first-swap share)
    // is q's second-swap share.
    const qFeeFromSecond = qFeeTotal.sub(feesAfterFirstX);

    // q should receive ~2x p's second-swap fee.
    assert.ok(
      qFeeFromSecond.gte(pFeeFromSecond.muln(2).subn(2)) &&
        qFeeFromSecond.lte(pFeeFromSecond.muln(2).addn(2)),
      `expected q≈2p, got p=${pFeeFromSecond.toString()} q=${qFeeFromSecond.toString()}`,
    );
  });

  it('rejects deposits outside [lowerBinId, upperBinId]', () => {
    const pool = buildPool({ activeId: 0 });
    setBin(pool, 0, 0n, 0n, 0n);
    assert.throws(
      () =>
        openPosition({
          id: 'p', pool, ownerLabel: 'x',
          lowerBinId: 0, upperBinId: 5,
          deposits: [{ binId: 6, amountX: bn(1), amountY: bn(1) }],
          slot: 1n, blockTime: 1_700_000_000,
        }),
      /outside/,
    );
  });

  it('deposit accumulates initialDepositX/Y only on open', () => {
    const pool = buildPool({ activeId: 0 });
    setBin(pool, 0, 0n, 0n, 0n);
    const p = openPosition({
      id: 'p', pool, ownerLabel: 'x',
      lowerBinId: 0, upperBinId: 0,
      deposits: [{ binId: 0, amountX: bn(100), amountY: bn(200) }],
      slot: 1n, blockTime: 1_700_000_000,
    });
    deposit(
      pool, p,
      [{ binId: 0, amountX: bn(50), amountY: bn(50) }],
      2n, 1_700_000_100,
    );
    assert.equal(p.totals.initialDepositX.toString(), '100');
    assert.equal(p.totals.initialDepositY.toString(), '200');
  });
});
