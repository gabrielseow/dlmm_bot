// Unit tests for the pure eligibility + ranking core.
//   T007 (US1): descending rank, deterministic tie-breaks, degenerate routing.
//   T012 (US2): configurable threshold exclusion.
//   T014 (US3): determinism across runs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { screen } from '../../src/discovery/screen.js';
import type {
  MeasurementWindow,
  PoolRow,
  ScreeningCriteria,
  WindowValues,
} from '../../src/discovery/types.js';

const FIXED_NOW = Date.UTC(2026, 4, 29); // deterministic clock for tests

function win(value: number | null): WindowValues {
  return { '30m': value, '1h': value, '2h': value, '4h': value, '12h': value, '24h': value };
}

interface PoolOverrides {
  address?: string;
  name?: string;
  tvl?: number | null;
  fees?: number | null;
  volume?: number | null;
  createdAt?: number;
  isBlacklisted?: boolean;
}

function makePool(o: PoolOverrides = {}): PoolRow {
  const address = o.address ?? 'PoolAddr1111111111111111111111111111111111';
  return {
    address,
    name: o.name ?? 'AAA-BBB',
    tokenX: { symbol: 'AAA', address: 'mintAAA', decimals: 6 },
    tokenY: { symbol: 'BBB', address: 'mintBBB', decimals: 9 },
    binStep: 10,
    baseFeePct: 0.01,
    tvl: o.tvl === undefined ? 1000 : o.tvl,
    fees: win(o.fees === undefined ? 100 : o.fees),
    volume: win(o.volume === undefined ? 5000 : o.volume),
    apiFeeTvlRatio: win(0.1),
    createdAt: o.createdAt ?? 0,
    isBlacklisted: o.isBlacklisted ?? false,
  };
}

function makeCriteria(o: Partial<ScreeningCriteria> = {}): ScreeningCriteria {
  return {
    window: (o.window ?? '24h') as MeasurementWindow,
    indicator: o.indicator ?? 'fee_to_tvl',
    minTvl: o.minTvl ?? 0,
    minVolume: o.minVolume ?? 0,
    topN: o.topN ?? null,
    sortDirection: o.sortDirection ?? 'desc',
    network: o.network ?? 'mainnet',
    baseUrl: o.baseUrl ?? 'https://example.test',
    output: o.output ?? null,
    newPoolMaxAgeSec: o.newPoolMaxAgeSec ?? 86_400,
  };
}

// ---------------------------------------------------------------------------
// T007 — US1: ranking
// ---------------------------------------------------------------------------

test('candidates are ordered by descending selected indicator (FR-003)', () => {
  const pools = [
    makePool({ address: 'B', tvl: 1000, fees: 100 }), // fee/tvl = 0.10
    makePool({ address: 'A', tvl: 1000, fees: 300 }), // fee/tvl = 0.30
    makePool({ address: 'C', tvl: 1000, fees: 200 }), // fee/tvl = 0.20
  ];
  const { candidates } = screen(pools, makeCriteria(), FIXED_NOW);
  assert.deepEqual(
    candidates.map((c) => c.address),
    ['A', 'C', 'B'],
  );
  assert.deepEqual(
    candidates.map((c) => c.rank),
    [1, 2, 3],
  );
});

test('equal-ratio pools tie-break by tvl desc then address asc (Decision 5)', () => {
  const pools = [
    makePool({ address: 'zzz', tvl: 1000, fees: 100 }), // ratio 0.1, tvl 1000
    makePool({ address: 'aaa', tvl: 1000, fees: 100 }), // ratio 0.1, tvl 1000 -> address asc
    makePool({ address: 'mmm', tvl: 2000, fees: 200 }), // ratio 0.1, tvl 2000 -> tvl desc first
  ];
  const { candidates } = screen(pools, makeCriteria(), FIXED_NOW);
  assert.deepEqual(
    candidates.map((c) => c.address),
    ['mmm', 'aaa', 'zzz'],
  );
});

test('volume_to_tvl indicator drives ranking when selected (FR-004)', () => {
  const pools = [
    makePool({ address: 'A', tvl: 1000, fees: 999, volume: 1000 }), // v/tvl 1.0
    makePool({ address: 'B', tvl: 1000, fees: 1, volume: 9000 }), // v/tvl 9.0
  ];
  const { candidates } = screen(pools, makeCriteria({ indicator: 'volume_to_tvl' }), FIXED_NOW);
  assert.deepEqual(
    candidates.map((c) => c.address),
    ['B', 'A'],
  );
});

test('zero/missing TVL pools route to ineligible with missing_or_zero_tvl (FR-006)', () => {
  const pools = [
    makePool({ address: 'zero', tvl: 0 }),
    makePool({ address: 'missing', tvl: null }),
    makePool({ address: 'ok', tvl: 1000 }),
  ];
  const { candidates, ineligible } = screen(pools, makeCriteria(), FIXED_NOW);
  assert.deepEqual(candidates.map((c) => c.address), ['ok']);
  const reasons = new Map(ineligible.map((i) => [i.address, i.reason]));
  assert.equal(reasons.get('zero'), 'missing_or_zero_tvl');
  assert.equal(reasons.get('missing'), 'missing_or_zero_tvl');
});

test('missing fee/volume pools route to ineligible with the right reason (FR-007)', () => {
  const pools = [
    makePool({ address: 'nofee', fees: null }),
    makePool({ address: 'novol', volume: null }),
    makePool({ address: 'ok' }),
  ];
  const { candidates, ineligible } = screen(pools, makeCriteria(), FIXED_NOW);
  assert.deepEqual(candidates.map((c) => c.address), ['ok']);
  const reasons = new Map(ineligible.map((i) => [i.address, i.reason]));
  assert.equal(reasons.get('nofee'), 'missing_fee_data');
  assert.equal(reasons.get('novol'), 'missing_volume_data');
});

test('candidate indicators are always finite (SC-003) and match fees/tvl (SC-004)', () => {
  const { candidates } = screen([makePool({ tvl: 1000, fees: 100, volume: 5000 })], makeCriteria(), FIXED_NOW);
  const c = candidates[0];
  assert.ok(c);
  assert.ok(Number.isFinite(c.feeToTvl) && Number.isFinite(c.volumeToTvl));
  assert.equal(c.feeToTvl, 0.1);
  assert.equal(c.volumeToTvl, 5);
  assert.equal(c.rankingScore, c.feeToTvl);
});

test('isNewPool reflects createdAt vs newPoolMaxAgeSec', () => {
  const nowSec = Math.floor(FIXED_NOW / 1000);
  const pools = [
    makePool({ address: 'new', createdAt: nowSec - 100 }),
    makePool({ address: 'old', createdAt: nowSec - 200_000 }),
  ];
  const { candidates } = screen(pools, makeCriteria({ newPoolMaxAgeSec: 86_400 }), FIXED_NOW);
  const byAddr = new Map(candidates.map((c) => [c.address, c.isNewPool]));
  assert.equal(byAddr.get('new'), true);
  assert.equal(byAddr.get('old'), false);
});

// ---------------------------------------------------------------------------
// T012 — US2: threshold exclusion
// ---------------------------------------------------------------------------

test('pools below minTvl are excluded with reason below_min_tvl (FR-005)', () => {
  const pools = [
    makePool({ address: 'small', tvl: 500, volume: 5000 }),
    makePool({ address: 'big', tvl: 50_000, volume: 5000 }),
  ];
  const { candidates, ineligible } = screen(pools, makeCriteria({ minTvl: 10_000 }), FIXED_NOW);
  assert.deepEqual(candidates.map((c) => c.address), ['big']);
  assert.equal(ineligible.find((i) => i.address === 'small')?.reason, 'below_min_tvl');
});

test('pools below minVolume are excluded with reason below_min_volume (FR-005)', () => {
  const pools = [
    makePool({ address: 'thin', tvl: 50_000, volume: 100 }),
    makePool({ address: 'liquid', tvl: 50_000, volume: 80_000 }),
  ];
  const { candidates, ineligible } = screen(pools, makeCriteria({ minVolume: 50_000 }), FIXED_NOW);
  assert.deepEqual(candidates.map((c) => c.address), ['liquid']);
  assert.equal(ineligible.find((i) => i.address === 'thin')?.reason, 'below_min_volume');
});

test('no sub-threshold pool ever appears in candidates (SC-002)', () => {
  const pools = Array.from({ length: 20 }, (_, i) =>
    makePool({ address: `p${i}`, tvl: i * 1000, volume: i * 1000 }),
  );
  const criteria = makeCriteria({ minTvl: 5000, minVolume: 5000 });
  const { candidates } = screen(pools, criteria, FIXED_NOW);
  for (const c of candidates) {
    assert.ok(c.tvl >= criteria.minTvl);
    assert.ok(c.volume >= criteria.minVolume);
  }
});

test('changing a threshold value changes the candidate set (SC-006)', () => {
  const pools = [
    makePool({ address: 'a', tvl: 1000, volume: 5000 }),
    makePool({ address: 'b', tvl: 20_000, volume: 5000 }),
  ];
  const loose = screen(pools, makeCriteria({ minTvl: 0 }), FIXED_NOW).candidates.length;
  const strict = screen(pools, makeCriteria({ minTvl: 10_000 }), FIXED_NOW).candidates.length;
  assert.equal(loose, 2);
  assert.equal(strict, 1);
});

test('topN caps the candidate list', () => {
  const pools = Array.from({ length: 10 }, (_, i) =>
    makePool({ address: `p${i}`, tvl: 1000, fees: i + 1 }),
  );
  const { candidates } = screen(pools, makeCriteria({ topN: 3 }), FIXED_NOW);
  assert.equal(candidates.length, 3);
});

// ---------------------------------------------------------------------------
// T014 — US3: determinism
// ---------------------------------------------------------------------------

test('screening identical input twice yields byte-identical candidates and ineligible (SC-005)', () => {
  const pools = [
    makePool({ address: 'c', tvl: 1000, fees: 100 }),
    makePool({ address: 'a', tvl: 1000, fees: 100 }), // tie with c
    makePool({ address: 'b', tvl: 0 }), // ineligible
    makePool({ address: 'd', tvl: 3000, fees: 600 }),
  ];
  const criteria = makeCriteria();
  const first = screen(pools, criteria, FIXED_NOW);
  const second = screen([...pools], criteria, FIXED_NOW + 999); // only the clock differs
  assert.equal(JSON.stringify(first.candidates), JSON.stringify(second.candidates));
  assert.equal(JSON.stringify(first.ineligible), JSON.stringify(second.ineligible));
  assert.notEqual(first.generatedAt, second.generatedAt);
});
