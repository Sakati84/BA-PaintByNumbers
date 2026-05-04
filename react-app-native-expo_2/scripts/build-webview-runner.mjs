import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const entryFile = path.join(projectRoot, 'src', 'features', 'generator', 'webviewRunnerEntry.ts');
const outputFile = path.join(projectRoot, 'src', 'features', 'generator', 'webviewRunner.generated.ts');

const result = await build({
  entryPoints: [entryFile],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: ['es2020'],
  charset: 'utf8',
  minify: false,
});

const bundled = result.outputFiles[0]?.text ?? '';
const moduleSource = `export const WEBVIEW_RUNNER_SCRIPT = ${JSON.stringify(bundled)};\n`;

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, moduleSource, 'utf8');
