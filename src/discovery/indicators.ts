// Pure indicator functions (FR-002, FR-004, FR-006, FR-007, Decision 2).
// Guards run BEFORE any division so results are always finite real numbers —
// zero/missing/NaN inputs never produce Infinity/NaN (SC-003). These functions
// are I/O-free and fully unit-tested (Principle IV).

import type { MeasurementWindow, WindowValues } from './types.js';

/** Extract one window's value; null when the API value is missing (FR-006/FR-007). */
export function selectWindow(data: WindowValues, window: MeasurementWindow): number | null {
  return data[window];
}

/**
 * fee-to-TVL = fees / tvl, guaranteed finite. Returns 0 for any degenerate input
 * (missing/zero/non-finite tvl, or missing/non-finite fees) so callers never see
 * Infinity/NaN. Eligible pools always pass valid finite inputs (tvl > 0).
 */
export function feeToTvl(fees: number | null, tvl: number | null): number {
  if (tvl === null || !Number.isFinite(tvl) || tvl <= 0) return 0;
  if (fees === null || !Number.isFinite(fees)) return 0;
  return fees / tvl;
}

/** volume-to-TVL = volume / tvl, with the same finiteness guarantees as feeToTvl. */
export function volumeToTvl(volume: number | null, tvl: number | null): number {
  if (tvl === null || !Number.isFinite(tvl) || tvl <= 0) return 0;
  if (volume === null || !Number.isFinite(volume)) return 0;
  return volume / tvl;
}
