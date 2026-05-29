import DLMM from '@meteora-ag/dlmm'
import { Connection, PublicKey } from '@solana/web3.js';
import { meteoraApi } from './meteora.js';

const mainnetConnection = new Connection('https://api.mainnet-beta.solana.com');

const USDC_USDT_POOL = new PublicKey('ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq') // You can get your desired pool address from the API https://dlmm-api.meteora.ag/pair/all
const dlmmPool = await DLMM.create(mainnetConnection, USDC_USDT_POOL);
const activeBin = await dlmmPool.getActiveBin();

async function fetchPoolFees(address: string) {
    const { data, error } = await meteoraApi.GET('/pools/{address}', {
        params: { path: { address } },
    });
    if (error) throw error;
    return data;
}

async function fetchPools() {
    const {data, error} = await meteoraApi.GET('/pools', {
        params: {
            query: {
                page_size: Number(10),
                sort_by: 'fee_tvl_ratio_30m:desc'
            }},
    });
    if (error) throw error;
    return data;
}

const pool = await fetchPoolFees(USDC_USDT_POOL.toBase58());
console.log(`Pool ${pool.name} fees:`);
console.log(`  30m:  $${pool.fees['30m']}`);
console.log(`  1h:   $${pool.fees['1h']}`);
console.log(`  24h:  $${pool.fees['24h']}`);
console.log(`  TVL:  $${pool.tvl}`);
console.log(`  APR:  ${pool.apr}%`);

const pools = await fetchPools();
for (const pool of pools.data) {
    console.log(`Pool ${pool.name} fees:`);
    console.log(`  30m:  $${pool.fees['30m']}`);
    console.log(`  1h:   $${pool.fees['1h']}`);
    console.log(`  24h:  $${pool.fees['24h']}`);
    console.log(`  TVL:  $${pool.tvl}`);
    console.log(`  APR:  ${pool.apr}%`);
}