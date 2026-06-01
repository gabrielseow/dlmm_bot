// Unit tests for the pure bin geometry (T006, SC-005). Run via `npm test`
// (node --import tsx --test). No new dependencies — node:test + node:assert.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  binIdToPrice,
  distributeLiquidity,
  priceToBinId,
  rangeToBins,
} from '../../src/simulator/bins.js';

const BIN_STEP = 20; // 0.2% per bin — a common DLMM step.

test('price ↔ bin round-trip lands within the originating bin', () => {
  for (const price of [0.5, 1, 25, 142.37, 1000]) {
    const binId = priceToBinId(price, BIN_STEP);
    const binLow = binIdToPrice(binId, BIN_STEP);
    const binHigh = binIdToPrice(binId + 1, BIN_STEP);
    assert.ok(binLow <= price, `${price} >= bin low ${binLow}`);
    assert.ok(price < binHigh, `${price} < next bin low ${binHigh}`);
  }
});

test('binIdToPrice is monotonically increasing in binId', () => {
  let prev = binIdToPrice(-50, BIN_STEP);
  for (let id = -49; id <= 50; id += 1) {
    const p = binIdToPrice(id, BIN_STEP);
    assert.ok(p > prev, `price increases at bin ${id}`);
    prev = p;
  }
});

test('rangeToBins returns an ordered inclusive bin range', () => {
  const [lo, hi] = rangeToBins(140, 160, BIN_STEP);
  assert.ok(lo <= hi);
  assert.equal(lo, priceToBinId(140, BIN_STEP));
  assert.equal(hi, priceToBinId(160, BIN_STEP));
});

test('rangeToBins normalizes an inverted price range to lo <= hi', () => {
  const [lo, hi] = rangeToBins(160, 140, BIN_STEP);
  assert.ok(lo <= hi);
});

test('shape distribution sums to the deposit (spot/curve/bid_ask)', () => {
  const range: [number, number] = [100, 110];
  for (const shape of ['spot', 'curve', 'bid_ask'] as const) {
    const bins = distributeLiquidity(shape, 1000, range, BIN_STEP);
    assert.equal(bins.length, 11, `${shape}: one entry per bin`);
    const total = bins.reduce((s, b) => s + b.liquidity, 0);
    assert.ok(Math.abs(total - 1000) < 1e-6, `${shape}: liquidity sums to deposit`);
    for (const b of bins) {
      assert.ok(Number.isFinite(b.liquidity) && b.liquidity >= 0, `${shape}: bin finite/≥0`);
    }
  }
});

test('spot shape distributes liquidity uniformly', () => {
  const bins = distributeLiquidity('spot', 900, [0, 8], BIN_STEP); // 9 bins
  const expected = 900 / 9;
  for (const b of bins) {
    assert.ok(Math.abs(b.liquidity - expected) < 1e-9);
  }
});

test('curve shape concentrates toward the centre', () => {
  const bins = distributeLiquidity('curve', 1000, [0, 10], BIN_STEP); // 11 bins, mid=5
  const mid = bins[5]!.liquidity;
  const edge = bins[0]!.liquidity;
  assert.ok(mid > edge, 'centre bin holds more than the edge bin');
});

test('bid_ask shape concentrates toward the edges', () => {
  const bins = distributeLiquidity('bid_ask', 1000, [0, 10], BIN_STEP); // 11 bins
  const mid = bins[5]!.liquidity;
  const edge = bins[0]!.liquidity;
  assert.ok(edge > mid, 'edge bin holds more than the centre bin');
});

test('inverted range yields an empty distribution', () => {
  const bins = distributeLiquidity('spot', 1000, [10, 5], BIN_STEP);
  assert.equal(bins.length, 0);
});

test('single-bin range puts the whole deposit in one bin', () => {
  const bins = distributeLiquidity('spot', 500, [42, 42], BIN_STEP);
  assert.equal(bins.length, 1);
  assert.ok(Math.abs(bins[0]!.liquidity - 500) < 1e-9);
});

test('non-positive deposit yields zero (never NaN) liquidity', () => {
  const bins = distributeLiquidity('spot', 0, [0, 4], BIN_STEP);
  assert.equal(bins.length, 5);
  for (const b of bins) {
    assert.equal(b.liquidity, 0);
    assert.ok(Number.isFinite(b.liquidity));
  }
});
