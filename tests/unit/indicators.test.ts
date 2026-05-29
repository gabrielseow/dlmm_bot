// Unit tests for the pure indicator core (T006). Covers SC-003 (no Infinity/NaN),
// SC-004 (full-precision match to fees/tvl), and FR-006/FR-007 (window selection
// and missing-data handling).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { feeToTvl, selectWindow, volumeToTvl } from '../../src/discovery/indicators.js';
import type { WindowValues } from '../../src/discovery/types.js';

const windows: WindowValues = {
  '30m': 1,
  '1h': 2,
  '2h': null,
  '4h': 8,
  '12h': 24,
  '24h': 48,
};

test('feeToTvl matches fees/tvl to full precision on normal inputs (SC-004)', () => {
  assert.equal(feeToTvl(100, 1000), 0.1);
  assert.equal(feeToTvl(1, 3), 1 / 3);
  assert.equal(feeToTvl(0, 1000), 0); // a legitimate zero fee is not "missing"
});

test('volumeToTvl matches volume/tvl to full precision on normal inputs (SC-004)', () => {
  assert.equal(volumeToTvl(500, 2000), 0.25);
  assert.equal(volumeToTvl(2, 3), 2 / 3);
});

test('zero/missing/NaN TVL never yields Infinity or NaN (SC-003)', () => {
  for (const indicator of [feeToTvl, volumeToTvl]) {
    for (const badTvl of [0, null, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const out = indicator(100, badTvl as number);
      assert.ok(Number.isFinite(out), `expected finite, got ${out} for tvl=${badTvl}`);
    }
  }
});

test('missing fee/volume never yields a non-finite indicator (FR-007)', () => {
  assert.ok(Number.isFinite(feeToTvl(null, 1000)));
  assert.ok(Number.isFinite(feeToTvl(Number.NaN, 1000)));
  assert.ok(Number.isFinite(volumeToTvl(null, 1000)));
});

test('selectWindow extracts the correct TimeWindowData key (FR-006)', () => {
  assert.equal(selectWindow(windows, '30m'), 1);
  assert.equal(selectWindow(windows, '24h'), 48);
  assert.equal(selectWindow(windows, '12h'), 24);
});

test('selectWindow reports a missing window value as null (FR-007)', () => {
  assert.equal(selectWindow(windows, '2h'), null);
});
