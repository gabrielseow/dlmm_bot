// CLI dispatcher. `npm run dev` enters here. Subcommands delegate to
// modules under src/cli/ (or in the case of `pools`, do their own thing
// inline — that's the pre-existing pool-listing behaviour).

import { meteoraApi } from './meteora.js';

async function listPools(): Promise<void> {
  const { data, error } = await meteoraApi.GET('/pools', {
    params: { query: { page_size: 10, sort_by: 'fee_tvl_ratio_30m:desc' } },
  });
  if (error) throw error;
  for (const pool of data.data) {
    console.log(`Pool ${pool.name} fees:`);
    console.log(`  30m:  $${pool.fees['30m']}`);
    console.log(`  1h:   $${pool.fees['1h']}`);
    console.log(`  24h:  $${pool.fees['24h']}`);
    console.log(`  TVL:  $${pool.tvl}`);
    console.log(`  APR:  ${pool.apr}%`);
  }
}

async function poolDetails(address: string): Promise<void> {
  const { data, error } = await meteoraApi.GET('/pools/{address}', {
    params: { path: { address } },
  });
  if (error) throw error;
  console.log(`Pool ${data.name} fees:`);
  console.log(`  30m:  $${data.fees['30m']}`);
  console.log(`  1h:   $${data.fees['1h']}`);
  console.log(`  24h:  $${data.fees['24h']}`);
  console.log(`  TVL:  $${data.tvl}`);
  console.log(`  APR:  ${data.apr}%`);
}

function usage(): void {
  console.log(
    [
      'Usage: dlmm_bot <command> [args]',
      '',
      'Commands:',
      '  pools                List highest fee/TVL ratio pools.',
      '  pool <address>       Show fees/TVL/APR for one pool.',
      '  sim:backtest ...     Replay swaps and simulate a position.',
      '                       (run via `npm run sim:backtest -- ...`)',
      '  sim:report ...       Print a backtest report (stub for now).',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case undefined:
    case 'pools':
      return listPools();
    case 'pool':
      if (rest[0] === undefined) {
        usage();
        process.exit(2);
      }
      return poolDetails(rest[0]);
    case 'help':
    case '--help':
    case '-h':
      return usage();
    default:
      console.error(`unknown command: ${cmd}`);
      usage();
      process.exit(2);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
