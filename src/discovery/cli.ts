// CLI entrypoint (FR-013, SC-001, SC-008, contracts/screener-cli.md).
// Wires config → fetch-pools → screen → format and enforces the fail-closed
// exit-code contract:
//   0  full scan completed; valid ScreeningResult emitted (JSON to stdout/file)
//   2  invalid configuration — aborted before any network call, no result
//   3  data-source failure / incomplete scan — NO result emitted
//
// The machine-readable JSON goes to stdout (or SCREEN_OUTPUT); the human table
// goes to stderr so stdout stays clean for piping.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { ConfigError, loadConfig } from './config.js';
import { DataSourceError, fetchPools } from './fetch-pools.js';
import { renderTable, toJson } from './format.js';
import { screen } from './screen.js';
import type { ScreeningCriteria } from './types.js';

async function main(): Promise<number> {
  // 1. Configuration — validated before any network call (exit 2 on failure).
  let criteria: ScreeningCriteria;
  try {
    criteria = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`Configuration error: ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  // 2. Fetch the complete pool universe — fail-closed (exit 3, no result).
  let pools;
  try {
    pools = await fetchPools(criteria);
  } catch (error) {
    const detail =
      error instanceof DataSourceError || error instanceof Error
        ? error.message
        : String(error);
    process.stderr.write(`Data-source failure: ${detail}\nNo result emitted.\n`);
    return 3;
  }

  // 3. Pure screening + ranking.
  const result = screen(pools, criteria);

  // 4. Human table → stderr (keeps stdout clean for piping the JSON).
  process.stderr.write(`${renderTable(result)}\n`);

  // 5. Machine-readable JSON → file or stdout.
  const json = toJson(result);
  if (criteria.output !== null) {
    const dir = dirname(criteria.output);
    if (dir && dir !== '.') {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(criteria.output, `${json}\n`, 'utf8');
    process.stderr.write(`Wrote ScreeningResult to ${criteria.output}\n`);
  } else {
    process.stdout.write(`${json}\n`);
  }

  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unexpected error: ${detail}\n`);
    process.exitCode = 1;
  });
