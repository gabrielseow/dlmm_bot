// PURE verification (FR-008/009/010, Decision 7). Compares a simulated fee
// figure against an observed (ground-truth) one and returns a VerificationOutcome
// — pass / fail / could_not_verify. A missing observed figure is never a silent
// pass: it is reported as could_not_verify (FR-010, SC-008). No I/O, no clock.

import type {
  ObservedPosition,
  VerificationMode,
  VerificationOutcome,
} from './types.js';

/** Floor for the relative-difference denominator (avoids divide-by-zero). */
const EPSILON = 1e-9;

/**
 * Compare simulated vs observed fees under a relative tolerance.
 *   relDiff = |sim − observed| / max(observed, ε)
 *   status  = could_not_verify  when observed is null
 *             pass              when relDiff ≤ tolerance
 *             fail              otherwise (note carries direction + magnitude)
 */
export function compare(
  simulatedFeesUsd: number,
  observedFeesUsd: number | null,
  tolerance: number,
  mode: VerificationMode,
  observed?: ObservedPosition | null,
): VerificationOutcome {
  const position =
    observed != null
      ? {
          positionAddress: observed.positionAddress,
          binLower: observed.binLower,
          binUpper: observed.binUpper,
          openedAt: observed.openedAt,
          closedAt: observed.closedAt,
          isClosed: observed.isClosed,
        }
      : null;

  if (observedFeesUsd === null || !Number.isFinite(observedFeesUsd)) {
    return {
      mode,
      simulatedFeesUsd,
      observedFeesUsd: null,
      absDiffUsd: null,
      relDiff: null,
      tolerance,
      status: 'could_not_verify',
      note: 'No observed fee figure available for the matched position; cannot verify (not a pass).',
      position,
    };
  }

  const absDiffUsd = Math.abs(simulatedFeesUsd - observedFeesUsd);
  const relDiff = absDiffUsd / Math.max(observedFeesUsd, EPSILON);
  const within = relDiff <= tolerance;
  const direction = simulatedFeesUsd >= observedFeesUsd ? 'over' : 'under';

  const note = within
    ? `Within tolerance: simulated ${direction}stated observed fees by ${(relDiff * 100).toFixed(1)}% (≤ ${(tolerance * 100).toFixed(1)}%).`
    : `Beyond tolerance: simulated ${direction}stated observed fees by ${(relDiff * 100).toFixed(1)}% ` +
      `(absΔ $${absDiffUsd.toFixed(2)}, tolerance ${(tolerance * 100).toFixed(1)}%).`;

  return {
    mode,
    simulatedFeesUsd,
    observedFeesUsd,
    absDiffUsd,
    relDiff,
    tolerance,
    status: within ? 'pass' : 'fail',
    note,
    position,
  };
}
