import { createRequire } from 'node:module';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const reactAppRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(reactAppRoot, '..');
const appNodeModules = path.join(repoRoot, 'App', 'node_modules');
const distDirectory = path.join(reactAppRoot, 'dist');

const requireFromApp = createRequire(path.join(appNodeModules, 'package.json'));
const esbuild = requireFromApp('esbuild');

await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });

await esbuild.build({
  absWorkingDir: reactAppRoot,
  bundle: true,
  entryPoints: ['src/main.tsx'],
  outfile: path.join(distDirectory, 'app.js'),
  format: 'esm',
  jsx: 'automatic',
  loader: {
    '.png': 'file',
    '.jpg': 'file',
    '.jpeg': 'file',
    '.svg': 'file',
  },
  minify: false,
  nodePaths: [appNodeModules],
  platform: 'browser',
  sourcemap: false,
  target: ['es2020'],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});

const html = `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
    />
    <title>Happy Lines</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Spline+Sans:wght@500;600;700;800&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="./app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./app.js"></script>
  </body>
</html>
`;

await writeFile(path.join(distDirectory, 'index.html'), html, 'utf8');
