// PURE position lifecycle state machine (FR-004/005/006, Decision 5). Each
// transition takes an immutable Position and returns a new Position plus the
// Operation it produced, so the ordered operation list is the auditable history
// (US3 #3). The conservation invariant earnedFees = realizedFees + unclaimedFees
// holds after every transition (SC-009). No I/O, no clock — `at` is supplied by
// the caller from input data.
//
// T009 (US1) implements `open` and `accrue`; `claim`/`mark`/`close` are added in
// T019 (US3).

import type {
  BinLiquidity,
  Operation,
  Position,
  PositionSnapshot,
  Shape,
  TokenAmounts,
} from './types.js';
import { ZERO_AMOUNTS } from './types.js';

/** Thrown on an invalid lifecycle transition (rejected open, op on closed pos). */
export class PositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PositionError';
  }
}

/** Componentwise sum of two TokenAmounts. */
export function addAmounts(a: TokenAmounts, b: TokenAmounts): TokenAmounts {
  return { x: a.x + b.x, y: a.y + b.y, usd: a.usd + b.usd };
}

/** earnedFees = realizedFees + unclaimedFees (the conserved quantity). */
export function earnedFees(position: Position): TokenAmounts {
  return addAmounts(position.realizedFees, position.unclaimedFees);
}

function snapshotOf(position: Position): PositionSnapshot {
  return {
    status: position.status,
    unclaimedFees: position.unclaimedFees,
    realizedFees: position.realizedFees,
    earnedFees: earnedFees(position),
  };
}

export interface OpenParams {
  pool: string;
  binLower: number;
  binUpper: number;
  shape: Shape;
  deposit: TokenAmounts;
  binLiquidity: BinLiquidity[];
  openedAt: number;
}

/** Result of every transition: the new state and the operation it appended. */
export interface Transition {
  position: Position;
  operation: Operation;
}

/**
 * Open a position. Validates the deposit (> 0 in USD) and the range
 * (binLower ≤ binUpper, non-empty distribution); rejects degenerate inputs at
 * the boundary so no Infinity/NaN can propagate (FR-001, SC-005).
 */
export function openPosition(params: OpenParams): Transition {
  const { pool, binLower, binUpper, shape, deposit, binLiquidity, openedAt } = params;
  if (!(deposit.usd > 0)) {
    throw new PositionError('Cannot open a position with a non-positive deposit.');
  }
  if (binLower > binUpper) {
    throw new PositionError(
      `Cannot open a position with an inverted bin range [${binLower}, ${binUpper}].`,
    );
  }
  if (binLiquidity.length === 0) {
    throw new PositionError('Cannot open a position over an empty bin range.');
  }

  const position: Position = {
    pool,
    status: 'open',
    binLower,
    binUpper,
    shape,
    deposit,
    binLiquidity,
    unclaimedFees: { ...ZERO_AMOUNTS },
    realizedFees: { ...ZERO_AMOUNTS },
    openedAt,
    closedAt: null,
  };

  const operation: Operation = {
    seq: 0,
    type: 'open',
    at: openedAt,
    inputs: { binLower, binUpper, shape, deposit },
    result: { binCount: binLiquidity.length },
    stateAfter: snapshotOf(position),
  };

  return { position, operation };
}

/**
 * Accrue fees onto the position's unclaimed balance over a window slice. A
 * closed position rejects accrual (edge case). `seq` is the next operation index.
 */
export function accrue(
  position: Position,
  feesAdded: TokenAmounts,
  at: number,
  seq: number,
): Transition {
  if (position.status === 'closed') {
    throw new PositionError('Cannot accrue fees on a closed position.');
  }

  const next: Position = {
    ...position,
    unclaimedFees: addAmounts(position.unclaimedFees, feesAdded),
  };

  const operation: Operation = {
    seq,
    type: 'accrue',
    at,
    inputs: { feesAdded },
    result: { unclaimedFees: next.unclaimedFees },
    stateAfter: snapshotOf(next),
  };

  return { position: next, operation };
}

/**
 * Claim accrued fees: move unclaimed → realized and zero unclaimed. Claiming
 * with nothing accrued is a no-op (the recorded amount is zero, state unchanged).
 * A closed position rejects claiming. The earned total is conserved (SC-009).
 */
export function claim(position: Position, at: number, seq: number): Transition {
  if (position.status === 'closed') {
    throw new PositionError('Cannot claim fees on a closed position.');
  }

  const claimed = position.unclaimedFees;
  const next: Position = {
    ...position,
    realizedFees: addAmounts(position.realizedFees, claimed),
    unclaimedFees: { ...ZERO_AMOUNTS },
  };

  const operation: Operation = {
    seq,
    type: 'claim',
    at,
    inputs: {},
    result: { amountRealized: claimed, noop: claimed.usd === 0 },
    stateAfter: snapshotOf(next),
  };

  return { position: next, operation };
}

/**
 * Mark the position at a price — a read-only valuation that leaves state
 * unchanged but records the marking in the operation history. The full Valuation
 * block is assembled separately (valuation.ts / T024); here we record the price
 * and any precomputed position value the caller supplies.
 */
export function mark(
  position: Position,
  markPrice: number,
  at: number,
  seq: number,
  positionValueUsd?: number,
): Transition {
  const operation: Operation = {
    seq,
    type: 'mark',
    at,
    inputs: { markPrice },
    result: positionValueUsd === undefined ? {} : { positionValueUsd },
    stateAfter: snapshotOf(position),
  };
  // State is unchanged by a read-only mark.
  return { position, operation };
}

/**
 * Close the position: record the token amounts returned at the closing price and
 * mark it closed. A closed position rejects a second close. Unclaimed fees are
 * preserved on the snapshot (the earned total is conserved, SC-009); the caller
 * may claim before close to realize them.
 */
export function close(
  position: Position,
  returnedAmounts: TokenAmounts,
  closedAt: number,
  seq: number,
): Transition {
  if (position.status === 'closed') {
    throw new PositionError('Cannot close an already-closed position.');
  }

  const next: Position = {
    ...position,
    status: 'closed',
    closedAt,
  };

  const operation: Operation = {
    seq,
    type: 'close',
    at: closedAt,
    inputs: {},
    result: { returnedAmounts },
    stateAfter: snapshotOf(next),
  };

  return { position: next, operation };
}
