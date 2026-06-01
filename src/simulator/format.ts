// Serialize a SimulationResult to JSON (the machine-readable contract for later
// pipeline parts, conforming to contracts/simulation-result.schema.json) and
// render a concise human-readable summary to stderr (FR-013). The JSON is the
// source of truth; the summary is a convenience view and never the contract.

import type { SimulationResult } from './types.js';

/** Canonical pretty-printed JSON for the result (the FR-013 hand-off contract). */
export function toJson(result: SimulationResult): string {
  return JSON.stringify(result, null, 2);
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** A concise, human-readable summary for stderr. */
export function renderSummary(result: SimulationResult): string {
  const lines: string[] = [];
  const { pool, window, fees, fidelity, status } = result;

  lines.push(`DLMM Position Simulation — ${pool.name} (${pool.address})`);
  lines.push(
    `Window: ${window.start}→${window.end} @ ${window.timeframe} ` +
      `(${window.bucketCount} buckets, ${window.complete ? 'complete' : 'INCOMPLETE'})`,
  );
  lines.push(
    `Range: bins [${result.position.binLower}, ${result.position.binUpper}] · ` +
      `shape ${result.position.shape} · deposit ${usd(result.position.deposit.usd)}`,
  );
  lines.push(
    `Fees earned: ${usd(fees.totalFees.usd)} ` +
      `(${fees.bucketsCounted} buckets in range, ${fees.bucketsOutOfRange} out of range)`,
  );

  if (result.valuation !== null) {
    const v = result.valuation;
    lines.push(
      `Valuation @ ${v.markPrice}: position ${usd(v.positionValueUsd)} · ` +
        `hold ${usd(v.holdValueUsd)} · IL ${usd(v.impermanentLossUsd)} · ` +
        `net PnL ${usd(v.netPnlUsd)}`,
    );
  }

  if (result.verification !== null) {
    const ver = result.verification;
    const observed = ver.observedFeesUsd === null ? 'n/a' : usd(ver.observedFeesUsd);
    const rel = ver.relDiff === null ? 'n/a' : `${(ver.relDiff * 100).toFixed(1)}%`;
    lines.push(
      `Verification (${ver.mode}): ${ver.status.toUpperCase()} — ` +
        `sim ${usd(ver.simulatedFeesUsd)} vs observed ${observed} ` +
        `(relΔ ${rel}, tol ${(ver.tolerance * 100).toFixed(1)}%)`,
    );
    if (ver.note) lines.push(`  ${ver.note}`);
  }

  if (result.operations.length > 0) {
    lines.push('Lifecycle:');
    for (const op of result.operations) {
      const s = op.stateAfter;
      lines.push(
        `  #${op.seq} ${op.type}@${op.at} → ` +
          `unclaimed ${usd(s.unclaimedFees.usd)}, realized ${usd(s.realizedFees.usd)}, ` +
          `earned ${usd(s.earnedFees.usd)} [${s.status}]`,
      );
    }
  }

  lines.push(
    `Fidelity: price ${fidelity.priceGranularity} · volume ${fidelity.volumeBasis} · ` +
      `liquidity ${fidelity.liquiditySource}`,
  );
  if (fidelity.liquidityCaveat) lines.push(`  ${fidelity.liquidityCaveat}`);
  lines.push(`Status: ${status}`);

  return lines.join('\n');
}
