// Compares the local pinned OpenAPI spec against the live URL.
// Exit 0 + "matches" message on no drift; exit 1 + path-level diff on drift.
// Pass --write to overwrite the local spec with the remote (used by `update:api`).

import { readFileSync, writeFileSync } from 'node:fs';

const SPEC_URL = 'https://dlmm.datapi.meteora.ag/api-docs/openapi.json';
const LOCAL = 'spec/meteora-api.json';
const write = process.argv.includes('--write');

const res = await fetch(SPEC_URL);
if (!res.ok) {
  console.error(`Fetch failed: ${res.status} ${res.statusText}`);
  process.exit(2);
}
const remote = await res.json();
const local = JSON.parse(readFileSync(LOCAL, 'utf8'));

const diffs = [];
function walk(a, b, path = '') {
  if (a === b) return;
  const isObj = (v) => v !== null && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    diffs.push({ path: path || '<root>', local: a, remote: b });
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) walk(a[k], b[k], path ? `${path}.${k}` : k);
}
walk(local, remote);

if (diffs.length === 0) {
  console.log('✓ Local spec matches remote.');
  process.exit(0);
}

console.error(`✗ Spec drift detected (${diffs.length} differences):\n`);
const trunc = (v) => {
  const s = JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > 100 ? s.slice(0, 100) + '…' : s;
};
for (const d of diffs.slice(0, 30)) {
  console.error(`  ${d.path}`);
  console.error(`    local:  ${trunc(d.local)}`);
  console.error(`    remote: ${trunc(d.remote)}`);
}
if (diffs.length > 30) console.error(`  …and ${diffs.length - 30} more`);

if (write) {
  writeFileSync(LOCAL, JSON.stringify(remote, null, 2) + '\n');
  console.error('\nLocal spec updated from remote. Re-run `npm run gen:api`.');
  process.exit(0);
}
process.exit(1);
