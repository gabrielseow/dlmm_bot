// Output formatting (FR-008, contracts/screener-cli.md). Two renderings:
//   - toJson: the machine-readable ScreeningResult (stdout or SCREEN_OUTPUT file).
//   - renderTable: a human ranked table for stderr (keeps stdout clean for piping).

import type { CandidatePair, ScreeningResult } from './types.js';

/** Serialize the ScreeningResult as pretty-printed JSON conforming to the schema. */
export function toJson(result: ScreeningResult): string {
  return JSON.stringify(result, null, 2);
}

function fmtNumber(value: number): string {
  if (Math.abs(value) >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtRatio(value: number): string {
  return value.toFixed(6);
}

function pad(value: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (value.length >= width) return value;
  const filler = ' '.repeat(width - value.length);
  return align === 'right' ? filler + value : value + filler;
}

interface Column {
  header: string;
  width: number;
  align: 'left' | 'right';
  value: (c: CandidatePair) => string;
}

const COLUMNS: readonly Column[] = [
  { header: '#', width: 4, align: 'right', value: (c) => String(c.rank) },
  { header: 'Pair', width: 20, align: 'left', value: (c) => c.name },
  { header: 'Bin', width: 5, align: 'right', value: (c) => String(c.binStep) },
  { header: 'TVL', width: 14, align: 'right', value: (c) => fmtNumber(c.tvl) },
  { header: 'Fees(win)', width: 14, align: 'right', value: (c) => fmtNumber(c.fees) },
  { header: 'Vol(win)', width: 14, align: 'right', value: (c) => fmtNumber(c.volume) },
  { header: 'fee/TVL', width: 11, align: 'right', value: (c) => fmtRatio(c.feeToTvl) },
  { header: 'vol/TVL', width: 11, align: 'right', value: (c) => fmtRatio(c.volumeToTvl) },
  { header: '', width: 4, align: 'left', value: (c) => (c.isNewPool ? 'NEW*' : '') },
];

/**
 * Render the ranked candidates as a fixed-width human table, with a summary
 * footer covering the universe size, eligible count, and ineligible count.
 */
export function renderTable(result: ScreeningResult): string {
  const lines: string[] = [];
  const { criteria, candidates, ineligible, poolUniverseCount } = result;

  lines.push(
    `DLMM screen — indicator=${criteria.indicator} window=${criteria.window} ` +
      `sort=${criteria.sortDirection} minTvl=${criteria.minTvl} minVolume=${criteria.minVolume}` +
      (criteria.topN !== null ? ` topN=${criteria.topN}` : ''),
  );

  const headerRow = COLUMNS.map((col) => pad(col.header, col.width, col.align)).join('  ');
  lines.push(headerRow);
  lines.push('-'.repeat(headerRow.length));

  if (candidates.length === 0) {
    lines.push('(no eligible candidates)');
  } else {
    for (const candidate of candidates) {
      lines.push(
        COLUMNS.map((col) => pad(col.value(candidate), col.width, col.align)).join('  '),
      );
    }
  }

  lines.push('');
  lines.push(
    `Universe: ${poolUniverseCount} pools | eligible: ${candidates.length} | ` +
      `ineligible: ${ineligible.length}  (NEW* = newly created pool)`,
  );

  return lines.join('\n');
}
