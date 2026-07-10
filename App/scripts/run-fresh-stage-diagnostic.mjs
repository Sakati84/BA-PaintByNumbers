#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), '..');
const cacheDirectory = path.join(appRoot, '.pipeline-lab-cache');
const outputFile = path.join(cacheDirectory, 'fresh-stage-diagnostic.mjs');

await mkdir(cacheDirectory, { recursive: true });
await build({
  entryPoints: [path.join(appRoot, 'scripts', 'fresh-stage-diagnostic.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: outputFile,
  logLevel: 'silent',
});
process.argv = [process.argv[0], outputFile, ...process.argv.slice(2)];
await import(`${pathToFileURL(outputFile).href}?t=${Date.now()}`);
