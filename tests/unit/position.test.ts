// Unit tests for the pure position lifecycle (T022, FR-005/006, SC-009).
// Run via `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  accrue,
  claim,
  close,
  earnedFees,
  mark,
  openPosition,
  PositionError,
} from '../../src/simulator/position.js';
import { distributeLiquidity } from '../../src/simulator/bins.js';
import type { BinLiquidity, Position, TokenAmounts } from '../../src/simulator/types.js';

const BIN_STEP = 20;

function freshPosition(): Position {
  const binLiquidity: BinLiquidity[] = distributeLiquidity('spot', 1000, [0, 4], BIN_STEP);
  const deposit: TokenAmounts = { x: 5, y: 500, usd: 1000 };
  return openPosition({
    pool: 'POOL',
    binLower: 0,
    binUpper: 4,
    shape: 'spot',
    deposit,
    binLiquidity,
    openedAt: 1000,
  }).position;
}

const fee = (usd: number): TokenAmounts => ({ x: 0, y: usd, usd });

test('open rejects a non-positive deposit', () => {
  assert.throws(
    () =>
      openPosition({
        pool: 'POOL',
        binLower: 0,
        binUpper: 4,
        shape: 'spot',
        deposit: { x: 0, y: 0, usd: 0 },
        binLiquidity: distributeLiquidity('spot', 1000, [0, 4], BIN_STEP),
        openedAt: 1000,
      }),
    PositionError,
  );
});

test('open rejects an inverted / empty range', () => {
  assert.throws(
    () =>
      openPosition({
        pool: 'POOL',
        binLower: 5,
        binUpper: 0,
        shape: 'spot',
        deposit: { x: 1, y: 1, usd: 100 },
        binLiquidity: [],
        openedAt: 1000,
      }),
    PositionError,
  );
});

test('claim moves unclaimed → realized and zeroes unclaimed', () => {
  const opened = freshPosition();
  const { position: accrued } = accrue(opened, fee(30), 1100, 1);
  assert.equal(accrued.unclaimedFees.usd, 30);
  const { position: claimed, operation } = claim(accrued, 1200, 2);
  assert.equal(claimed.unclaimedFees.usd, 0);
  assert.equal(claimed.realizedFees.usd, 30);
  assert.equal(operation.result?.noop, false);
});

test('claim with nothing accrued is a no-op', () => {
  const opened = freshPosition();
  const { position: claimed, operation } = claim(opened, 1200, 1);
  assert.equal(claimed.unclaimedFees.usd, 0);
  assert.equal(claimed.realizedFees.usd, 0);
  assert.equal(operation.result?.noop, true);
});

test('closed-position operations are rejected', () => {
  const opened = freshPosition();
  const { position: closed } = close(opened, { x: 5, y: 500, usd: 1000 }, 2000, 1);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closedAt, 2000);
  assert.throws(() => accrue(closed, fee(10), 2100, 2), PositionError);
  assert.throws(() => claim(closed, 2100, 2), PositionError);
  assert.throws(() => close(closed, { x: 0, y: 0, usd: 0 }, 2100, 2), PositionError);
});

test('mark is read-only and leaves balances unchanged', () => {
  const opened = freshPosition();
  const { position: accrued } = accrue(opened, fee(15), 1100, 1);
  const { position: marked, operation } = mark(accrued, 150, 1150, 2, 1200);
  assert.equal(marked.unclaimedFees.usd, accrued.unclaimedFees.usd);
  assert.equal(marked.realizedFees.usd, accrued.realizedFees.usd);
  assert.equal(marked.status, 'open');
  assert.equal(operation.result?.positionValueUsd, 1200);
});

test('earned = realized + unclaimed holds across open→accrue→claim→close (SC-009)', () => {
  let pos = freshPosition();
  const check = (p: typeof pos) =>
    assert.ok(
      Math.abs(earnedFees(p).usd - (p.realizedFees.usd + p.unclaimedFees.usd)) < 1e-12,
    );
  check(pos);
  pos = accrue(pos, fee(20), 1100, 1).position;
  check(pos);
  pos = accrue(pos, fee(10), 1200, 2).position;
  check(pos);
  assert.equal(earnedFees(pos).usd, 30);
  pos = claim(pos, 1300, 3).position;
  check(pos);
  assert.equal(earnedFees(pos).usd, 30); // earned conserved across a claim
  pos = close(pos, { x: 5, y: 500, usd: 1000 }, 1400, 4).position;
  check(pos);
  assert.equal(earnedFees(pos).usd, 30); // and across a close
});
