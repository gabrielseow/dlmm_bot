// Unit tests for the pure fee model (T014, FR-003, US1 #2, SC-006). Deterministic
// stub window + share function — no I/O. Run via `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attributeFees } from '../../src/simulator/fees.js';
import { distributeLiquidity } from '../../src/simulator/bins.js';
import type {
  PoolLiquiditySource,
  PoolState,
  WindowBucket,
  WindowTimeline,
} from '../../src/simulator/types.js';

const BIN_STEP = 20;

const pool: PoolState = {
  address: 'POOL',
  name: 'X-Y',
  binStep: BIN_STEP,
  baseFeePct: 0.2,
  dynamicFeePct: 0.2,
  collectFeeMode: 0,
  currentPrice: 100,
  currentActiveBinId: 0,
  tvlUsd: 1_000_000,
  tokenX: { address: 'X', symbol: 'X', decimals: 9, priceUsd: 100 },
  tokenY: { address: 'Y', symbol: 'Y', decimals: 6, priceUsd: 1 },
};

function bucket(over: Partial<WindowBucket>): WindowBucket {
  return {
    timestamp: 0,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volumeUsd: 0,
    feesUsd: 0,
    activeBinLow: 0,
    activeBinHigh: 0,
    ...over,
  };
}

function timeline(buckets: WindowBucket[]): WindowTimeline {
  return { start: 0, end: 100, timeframe: '1h', buckets, complete: true };
}

// A share function that always gives the position the entire bin (Lpool = 0).
const fullShare: PoolLiquiditySource = () => 0;

test('zero-volume window earns zero fees (not NaN)', () => {
  const bins = distributeLiquidity('spot', 1000, [0, 4], BIN_STEP);
  const tl = timeline([
    bucket({ activeBinLow: 1, activeBinHigh: 1, volumeUsd: 0, feesUsd: 0 }),
  ]);
  const fb = attributeFees(pool, tl, bins, fullShare, 0.002);
  assert.equal(fb.totalFees.usd, 0);
  assert.ok(Number.isFinite(fb.totalFees.usd));
});

test('out-of-range buckets contribute zero and are counted (FR-003)', () => {
  const bins = distributeLiquidity('spot', 1000, [0, 4], BIN_STEP);
  const tl = timeline([
    bucket({ activeBinLow: 100, activeBinHigh: 100, volumeUsd: 5000, feesUsd: 50 }),
    bucket({ activeBinLow: -100, activeBinHigh: -100, volumeUsd: 5000, feesUsd: 50 }),
  ]);
  const fb = attributeFees(pool, tl, bins, fullShare, 0.002);
  assert.equal(fb.totalFees.usd, 0);
  assert.equal(fb.bucketsCounted, 0);
  assert.equal(fb.bucketsOutOfRange, 2);
});

test('in-range bucket attributes the full bucket fee when share is 1', () => {
  const bins = distributeLiquidity('spot', 1000, [0, 4], BIN_STEP);
  const tl = timeline([
    bucket({ activeBinLow: 2, activeBinHigh: 2, volumeUsd: 5000, feesUsd: 50 }),
  ]);
  const fb = attributeFees(pool, tl, bins, fullShare, 0.002);
  assert.ok(Math.abs(fb.totalFees.usd - 50) < 1e-9);
  assert.equal(fb.bucketsCounted, 1);
  assert.equal(fb.bucketsOutOfRange, 0);
  assert.equal(fb.perBin.length, 1);
  assert.equal(fb.perBin[0]!.binId, 2);
  assert.ok(fb.perBin[0]!.liquidityShare > 0 && fb.perBin[0]!.liquidityShare <= 1);
});

test('liquidity share splits the fee against competing pool liquidity', () => {
  const bins = distributeLiquidity('spot', 1000, [0, 0], BIN_STEP); // one bin, Lpos=1000
  // Pool has equal competing liquidity → share = 1000/(1000+1000) = 0.5.
  const halfShare: PoolLiquiditySource = () => 1000;
  const tl = timeline([bucket({ activeBinLow: 0, activeBinHigh: 0, volumeUsd: 4000, feesUsd: 40 })]);
  const fb = attributeFees(pool, tl, bins, halfShare, 0.002);
  assert.ok(Math.abs(fb.totalFees.usd - 20) < 1e-9, 'half the bucket fee');
  assert.ok(Math.abs((fb.perBin[0]!.liquidityShare) - 0.5) < 1e-9);
});

test('derives fees from volume × rate when reported fees are missing', () => {
  const bins = distributeLiquidity('spot', 1000, [0, 0], BIN_STEP);
  const tl = timeline([
    bucket({ activeBinLow: 0, activeBinHigh: 0, volumeUsd: 10_000, feesUsd: null }),
  ]);
  const fb = attributeFees(pool, tl, bins, fullShare, 0.002);
  assert.ok(Math.abs(fb.totalFees.usd - 20) < 1e-9, '10_000 × 0.002 = 20');
});

test('a wider-capturing range earns more than one that misses the action (US1 #2)', () => {
  // Price action lives in bins 0..2. Position A covers it; position B sits above it.
  const tl = timeline([
    bucket({ activeBinLow: 0, activeBinHigh: 2, volumeUsd: 6000, feesUsd: 60 }),
  ]);
  const inRange = distributeLiquidity('spot', 1000, [0, 2], BIN_STEP);
  const offRange = distributeLiquidity('spot', 1000, [10, 12], BIN_STEP);
  const feesIn = attributeFees(pool, tl, inRange, fullShare, 0.002).totalFees.usd;
  const feesOff = attributeFees(pool, tl, offRange, fullShare, 0.002).totalFees.usd;
  assert.ok(feesIn > feesOff, 'capturing the action earns more');
  assert.equal(feesOff, 0);
});

test('determinism: identical inputs yield identical fee figures (SC-006)', () => {
  const bins = distributeLiquidity('spot', 1000, [0, 4], BIN_STEP);
  const tl = timeline([
    bucket({ activeBinLow: 1, activeBinHigh: 3, volumeUsd: 7000, feesUsd: 70 }),
  ]);
  const a = attributeFees(pool, tl, bins, fullShare, 0.002);
  const b = attributeFees(pool, tl, bins, fullShare, 0.002);
  assert.deepEqual(a, b);
});

test('totalFees token split is self-consistent: x·pX + y·pY = usd', () => {
  const bins = distributeLiquidity('spot', 1000, [0, 0], BIN_STEP);
  const tl = timeline([bucket({ activeBinLow: 0, activeBinHigh: 0, volumeUsd: 5000, feesUsd: 50 })]);
  const fb = attributeFees(pool, tl, bins, fullShare, 0.002);
  const recombined = fb.totalFees.x * pool.tokenX.priceUsd + fb.totalFees.y * pool.tokenY.priceUsd;
  assert.ok(Math.abs(recombined - fb.totalFees.usd) < 1e-6);
});
