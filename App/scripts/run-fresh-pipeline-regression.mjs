#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), '..');
const cacheDir = path.join(appRoot, '.pipeline-lab-cache');
const outfile = path.join(cacheDir, 'fresh-pipeline-regression.mjs');

await mkdir(cacheDir, { recursive: true });
await build({
  entryPoints: [path.join(appRoot, 'scripts', 'fresh-pipeline-regression.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile,
  logLevel: 'silent',
});
await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
