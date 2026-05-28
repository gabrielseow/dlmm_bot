// Coercion helpers between BN (used at the SDK boundary) and bigint (used
// where natural — tests, SQLite TEXT serialization). Live in one place so
// the conversion contract is obvious and unit-testable.

import BN from 'bn.js';

export function bnToBigint(x: BN): bigint {
  return BigInt(x.toString(10));
}

export function bigintToBN(x: bigint): BN {
  return new BN(x.toString(10), 10);
}

// Decimal string is the canonical SQLite TEXT form (SQLite ints are i64).
export function bnToDecString(x: BN): string {
  return x.toString(10);
}

export function decStringToBN(s: string): BN {
  return new BN(s, 10);
}
