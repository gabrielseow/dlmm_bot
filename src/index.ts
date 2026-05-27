import DLMM from '@meteora-ag/dlmm'
import { Connection, PublicKey } from '@solana/web3.js';

const mainnetConnection = new Connection('https://api.mainnet-beta.solana.com');

const USDC_USDT_POOL = new PublicKey('ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq') // You can get your desired pool address from the API https://dlmm-api.meteora.ag/pair/all
const dlmmPool = await DLMM.create(mainnetConnection, USDC_USDT_POOL);

const activeBin = await dlmmPool.getActiveBin();
const activeBinPriceLamport = activeBin.price;
const activeBinPricePerToken = dlmmPool.fromPricePerLamport(
    Number(activeBin.price)
);

function main(): void {
    console.log("Hello World!")
    console.log(activeBinPriceLamport)
    console.log(activeBinPricePerToken)
}

main()