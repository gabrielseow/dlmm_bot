// Unit tests for the pure valuation / impermanent loss / net PnL (T025, US4 #1/#2).
// Run via `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeValuation } from '../../src/simulator/valuation.js';
import { distributeLiquidity, priceToBinId } from '../../src/simulator/bins.js';

const BIN_STEP = 20;
const OPEN_PRICE = 100;

function valueAt(markPrice: number, earnedFeesUsd = 0) {
  // A range straddling the opening price so the position holds a real mix.
  const center = priceToBinId(OPEN_PRICE, BIN_STEP);
  const binLiquidity = distributeLiquidity('spot', 1000, [center - 5, center + 5], BIN_STEP);
  return computeValuation({
    binLiquidity,
    binStep: BIN_STEP,
    openPrice: OPEN_PRICE,
    markPrice,
    priceXUsd: 100,
    priceYUsd: 1,
    earnedFeesUsd,
  });
}

test('IL is exactly zero when price is unchanged (US4 #2)', () => {
  const { valuation } = valueAt(OPEN_PRICE);
  assert.ok(Math.abs(valuation.impermanentLossUsd) < 1e-6, 'IL ≈ 0 at flat price');
  assert.ok(
    Math.abs(valuation.positionValueUsd - valuation.holdValueUsd) < 1e-6,
    'position value equals hold value at open price',
  );
});

test('net PnL equals earned fees when price is flat (US4 #2)', () => {
  const { valuation } = valueAt(OPEN_PRICE, 42);
  assert.ok(Math.abs(valuation.netPnlUsd - 42) < 1e-6);
});

test('net PnL = earnedFees − impermanentLoss (US4 #1)', () => {
  const { valuation } = valueAt(130, 10);
  const expected = valuation.earnedFeesUsd - valuation.impermanentLossUsd;
  assert.ok(Math.abs(valuation.netPnlUsd - expected) < 1e-9);
});

test('a price move produces a non-negative impermanent loss', () => {
  const up = valueAt(130).valuation.impermanentLossUsd;
  const down = valueAt(75).valuation.impermanentLossUsd;
  assert.ok(up >= -1e-6, 'IL ≥ 0 on an up move');
  assert.ok(down >= -1e-6, 'IL ≥ 0 on a down move');
});

test('valuation figures are finite (no Infinity/NaN)', () => {
  const { valuation, returnedAmounts } = valueAt(155, 5);
  for (const v of [
    valuation.positionValueUsd,
    valuation.holdValueUsd,
    valuation.impermanentLossUsd,
    valuation.netPnlUsd,
    returnedAmounts.x,
    returnedAmounts.y,
    returnedAmounts.usd,
  ]) {
    assert.ok(Number.isFinite(v));
  }
});

test('returned amounts value equals position value at the marking price', () => {
  const { valuation, returnedAmounts } = valueAt(120);
  assert.ok(Math.abs(returnedAmounts.usd - valuation.positionValueUsd) < 1e-9);
});

test('determinism: identical inputs yield identical valuation', () => {
  const a = valueAt(140, 7);
  const b = valueAt(140, 7);
  assert.deepEqual(a, b);
});
