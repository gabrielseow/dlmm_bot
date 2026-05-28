// Typed client for the Meteora DLMM API.
// Types are generated from spec/meteora-api.json (see `npm run gen:api`).
// Spec source of truth: https://dlmm.datapi.meteora.ag/api-docs/openapi.json
// Run `npm run check:api` to verify the local spec still matches remote.

import createClient from 'openapi-fetch';
import type { paths } from './generated/meteora-api.d.ts';

export const meteoraApi = createClient<paths>({
  baseUrl: 'https://dlmm.datapi.meteora.ag',
});
