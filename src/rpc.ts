// Centralised Solana RPC connection. Reads RPC_URL from env so we don't
// rely on the public mainnet-beta endpoint (which is rate-limited and will
// not survive multi-thousand-tx backfills).

import { Connection, type Commitment } from '@solana/web3.js';

export interface RpcConnectionOptions {
  commitment?: Commitment;
  envVar?: string;
}

export function connection(opts: RpcConnectionOptions = {}): Connection {
  const envVar = opts.envVar ?? 'RPC_URL';
  const url = process.env[envVar];
  if (!url) {
    throw new Error(
      `${envVar} is not set. Backfill needs a paid/private Solana RPC endpoint; the public mainnet-beta URL is rate-limited and will not survive a backtest. Export ${envVar}=<your-rpc-url> and retry.`,
    );
  }
  return new Connection(url, opts.commitment ?? 'confirmed');
}
