// Unit tests for the pure verification comparison (T018, FR-010, SC-008).
// Run via `npm test`.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compare } from '../../src/simulator/verify.js';

test('within tolerance → pass', () => {
  const out = compare(105, 100, 0.1, 'historical');
  assert.equal(out.status, 'pass');
  assert.ok(Math.abs((out.relDiff ?? 0) - 0.05) < 1e-9);
  assert.equal(out.absDiffUsd, 5);
});

test('exactly at tolerance → pass (inclusive)', () => {
  const out = compare(110, 100, 0.1, 'historical');
  assert.equal(out.status, 'pass');
});

test('beyond tolerance → fail, with overstatement direction surfaced', () => {
  const out = compare(150, 100, 0.1, 'historical');
  assert.equal(out.status, 'fail');
  assert.ok(out.note.includes('over'), 'note names the direction');
  assert.ok(out.note.toLowerCase().includes('beyond tolerance'));
});

test('beyond tolerance → fail, understatement direction surfaced', () => {
  const out = compare(50, 100, 0.1, 'historical');
  assert.equal(out.status, 'fail');
  assert.ok(out.note.includes('under'), 'note names the direction');
});

test('missing observed data → could_not_verify (never a silent pass)', () => {
  const out = compare(42, null, 0.1, 'live');
  assert.equal(out.status, 'could_not_verify');
  assert.equal(out.observedFeesUsd, null);
  assert.equal(out.absDiffUsd, null);
  assert.equal(out.relDiff, null);
  assert.notEqual(out.status, 'pass');
});

test('zero observed fees does not divide by zero', () => {
  const out = compare(5, 0, 0.1, 'historical');
  assert.ok(Number.isFinite(out.relDiff ?? NaN));
  assert.equal(out.status, 'fail'); // 5 vs 0 is a large relative diff
});

test('attaches observed position metadata when provided', () => {
  const out = compare(100, 100, 0.1, 'historical', {
    positionAddress: 'POS',
    binLower: 10,
    binUpper: 20,
    openedAt: 1000,
    closedAt: 2000,
    observedFeesUsd: 100,
    depositX: 1,
    depositY: 2,
    depositUsd: 300,
    isClosed: true,
  });
  assert.equal(out.position?.positionAddress, 'POS');
  assert.equal(out.position?.isClosed, true);
});

test('determinism: identical inputs yield identical outcomes', () => {
  const a = compare(120, 100, 0.15, 'live');
  const b = compare(120, 100, 0.15, 'live');
  assert.deepEqual(a, b);
});
