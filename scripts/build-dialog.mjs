#!/usr/bin/env node
// Generates ui/dialog.mjs (a real ES module) from ui/dialog.js, so there is one implementation.
// `--check` exits 1 if the committed file is stale.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'ui/dialog.js'), 'utf8');
const a = src.indexOf('/*impl:start*/'), b = src.indexOf('/*impl:end*/');
if (a < 0 || b < 0) throw new Error('impl markers missing in ui/dialog.js');
const impl = src.slice(a + '/*impl:start*/'.length, b).trim();
const out = `/* GENERATED from ui/dialog.js by scripts/build-dialog.mjs. Do not edit by hand. */
/* ES module build for Vite / Rollup / Next: import { confirm, toast } from 'octopus-kit/ui/dialog.mjs'. */
const api = (${impl})(typeof window !== 'undefined' ? window : undefined);

export const alert = api.alert;
export const confirm = api.confirm;
export const prompt = api.prompt;
export const toast = api.toast;
export default api;
`;
const file = path.join(root, 'ui/dialog.mjs');
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (cur !== out) { console.error('ui/dialog.mjs is stale: run npm run build:dialog'); process.exit(1); }
} else fs.writeFileSync(file, out);
