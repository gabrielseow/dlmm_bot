// Typed client for the Meteora DLMM API.
// Types are generated from spec/meteora-api.json (see `npm run gen:api`).
// Spec source of truth: https://dlmm.datapi.meteora.ag/api-docs/openapi.json
// Run `npm run check:api` to verify the local spec still matches remote.

import createClient from 'openapi-fetch';
import type { paths } from './generated/meteora-api.d.ts';

/** Default Meteora DLMM API base URL (matches the pinned spec source of truth). */
export const DEFAULT_METEORA_BASE_URL = 'https://dlmm.datapi.meteora.ag';

/** Build a typed Meteora client against the given base URL (FR-011 configurable endpoint). */
export function createMeteoraClient(baseUrl: string = DEFAULT_METEORA_BASE_URL) {
  return createClient<paths>({ baseUrl });
}

export const meteoraApi = createMeteoraClient();
