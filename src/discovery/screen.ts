// Pure eligibility + ranking core (FR-003, FR-005, FR-006, FR-007, FR-009,
// FR-012, Decision 4, Decision 5). I/O-free and deterministic: given identical
// PoolRow[] input it produces byte-identical candidates and ineligible arrays.

import { feeToTvl, selectWindow, volumeToTvl } from './indicators.js';
import type {
  CandidatePair,
  IneligibilityReason,
  IneligiblePool,
  PoolRow,
  ScreeningCriteria,
  ScreeningResult,
} from './types.js';

/** Result of one pool passing the eligibility pass: validated finite fees/volume. */
interface EligibleEvaluation {
  ok: true;
  tvl: number;
  fees: number;
  volume: number;
}

interface IneligibleEvaluation {
  ok: false;
  reason: IneligibilityReason;
}

/**
 * Threshold enforcement (FR-005, SC-002). Returns the first failing reason in a
 * deterministic order, or null if both thresholds are satisfied. Called only with
 * already-validated finite tvl/volume.
 */
export function applyThresholds(
  tvl: number,
  volume: number,
  criteria: ScreeningCriteria,
): IneligibilityReason | null {
  if (tvl < criteria.minTvl) return 'below_min_tvl';
  if (volume < criteria.minVolume) return 'below_min_volume';
  return null;
}

/**
 * Classify a single pool. Eligibility rules run in a fixed, deterministic order
 * and the FIRST failing rule is recorded (Decision 4): blacklist → missing/zero
 * TVL → missing fee → missing volume → thresholds.
 */
function evaluate(
  pool: PoolRow,
  criteria: ScreeningCriteria,
): EligibleEvaluation | IneligibleEvaluation {
  if (pool.isBlacklisted) return { ok: false, reason: 'blacklisted' };

  const tvl = pool.tvl;
  if (tvl === null || !Number.isFinite(tvl) || tvl <= 0) {
    return { ok: false, reason: 'missing_or_zero_tvl' };
  }

  const fees = selectWindow(pool.fees, criteria.window);
  if (fees === null || !Number.isFinite(fees)) {
    return { ok: false, reason: 'missing_fee_data' };
  }

  const volume = selectWindow(pool.volume, criteria.window);
  if (volume === null || !Number.isFinite(volume)) {
    return { ok: false, reason: 'missing_volume_data' };
  }

  const thresholdFailure = applyThresholds(tvl, volume, criteria);
  if (thresholdFailure !== null) {
    return { ok: false, reason: thresholdFailure };
  }

  return { ok: true, tvl, fees, volume };
}

function buildCandidate(
  pool: PoolRow,
  evaluation: EligibleEvaluation,
  criteria: ScreeningCriteria,
  nowSec: number,
): CandidatePair {
  const { tvl, fees, volume } = evaluation;
  const ratioFee = feeToTvl(fees, tvl);
  const ratioVolume = volumeToTvl(volume, tvl);
  const rankingScore = criteria.indicator === 'fee_to_tvl' ? ratioFee : ratioVolume;
  const isNewPool =
    pool.createdAt > 0 && nowSec - pool.createdAt < criteria.newPoolMaxAgeSec;

  return {
    rank: 0, // assigned by rank()
    address: pool.address,
    name: pool.name,
    pair: { tokenX: pool.tokenX, tokenY: pool.tokenY },
    binStep: pool.binStep,
    tvl,
    fees,
    volume,
    window: criteria.window,
    feeToTvl: ratioFee,
    volumeToTvl: ratioVolume,
    rankingScore,
    isNewPool,
  };
}

/**
 * Sort candidates by the deterministic total order (Decision 5) and assign
 * 1-based ranks. Primary key: rankingScore in the configured direction. Tie-breaks
 * (always, regardless of direction): tvl desc, then address asc.
 */
export function rank(
  candidates: readonly CandidatePair[],
  criteria: ScreeningCriteria,
): CandidatePair[] {
  const direction = criteria.sortDirection === 'asc' ? 1 : -1;
  const sorted = [...candidates].sort((a, b) => {
    if (a.rankingScore !== b.rankingScore) {
      return direction * (a.rankingScore - b.rankingScore);
    }
    if (a.tvl !== b.tvl) return b.tvl - a.tvl; // tvl desc
    if (a.address < b.address) return -1; // address asc
    if (a.address > b.address) return 1;
    return 0;
  });
  return sorted.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/**
 * Run the full screening pass over the fetched universe and assemble the complete
 * ScreeningResult envelope (FR-008, FR-012). `status` is always "complete": this
 * function is only ever invoked on a fully-fetched universe; data-source failures
 * abort before reaching here (the CLI exits non-zero with no result).
 */
export function screen(
  pools: readonly PoolRow[],
  criteria: ScreeningCriteria,
  now: number = Date.now(),
): ScreeningResult {
  const nowSec = Math.floor(now / 1000);
  const eligible: CandidatePair[] = [];
  const ineligible: IneligiblePool[] = [];

  for (const pool of pools) {
    const evaluation = evaluate(pool, criteria);
    if (evaluation.ok) {
      eligible.push(buildCandidate(pool, evaluation, criteria, nowSec));
    } else {
      ineligible.push({
        address: pool.address,
        name: pool.name,
        reason: evaluation.reason,
        tvl: pool.tvl,
      });
    }
  }

  let candidates = rank(eligible, criteria);
  if (criteria.topN !== null) {
    candidates = candidates.slice(0, criteria.topN);
  }

  // Deterministic ineligible ordering independent of fetch order (FR-009).
  ineligible.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));

  return {
    generatedAt: new Date(now).toISOString(),
    criteria,
    poolUniverseCount: pools.length,
    candidates,
    ineligible,
    status: 'complete',
  };
}
