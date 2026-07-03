import { createRequire } from 'node:module';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const reactAppRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(reactAppRoot, '..');
const appNodeModules = path.join(repoRoot, 'App', 'node_modules');
const distDirectory = path.join(reactAppRoot, 'dist');
const requireFromApp = createRequire(path.join(appNodeModules, 'package.json'));
const sucrase = requireFromApp('sucrase');

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];
const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg']);
const CSS_EXTENSIONS = new Set(['.css']);
const REQUIRE_PATTERN = /require\(["']([^"']+)["']\)/g;

const moduleSources = new Map();
const moduleDeps = new Map();
const cssFiles = new Set();
const assetModules = new Map();
const copiedAssets = new Set();

await mkdir(distDirectory, { recursive: true });
for (const entry of await readdir(distDirectory, { withFileTypes: true })) {
  const entryPath = path.join(distDirectory, entry.name);
  await rm(entryPath, { recursive: true, force: true }).catch((error) => {
    if (error != null && typeof error === 'object' && 'code' in error && error.code === 'EBUSY') {
      return;
    }
    throw error;
  });
}

await addSourceModule(path.join(reactAppRoot, 'src', 'main.tsx'));
await addVendorModule('scheduler', path.join(appNodeModules, 'scheduler', 'cjs', 'scheduler.production.js'));
await addVendorModule('react', path.join(appNodeModules, 'react', 'cjs', 'react.production.js'));
await addVendorModule('react/jsx-runtime', path.join(appNodeModules, 'react', 'cjs', 'react-jsx-runtime.production.js'));
await addVendorModule('react-dom', path.join(appNodeModules, 'react-dom', 'cjs', 'react-dom.production.js'));
await addVendorModule('react-dom/client', path.join(appNodeModules, 'react-dom', 'cjs', 'react-dom-client.production.js'));

const appJs = createBundleSource();
await writeFile(path.join(distDirectory, 'app.js'), appJs, 'utf8');
await writeFile(path.join(distDirectory, 'app.css'), await createCssBundle(), 'utf8');
await writeFile(path.join(distDirectory, 'index.html'), createHtml(), 'utf8');

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function moduleIdForFile(filePath) {
  return `./${toPosix(path.relative(reactAppRoot, filePath))}`;
}

function assetOutputName(filePath) {
  const relative = toPosix(path.relative(repoRoot, filePath));
  return `assets/${relative.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

async function addSourceModule(filePath) {
  const normalizedPath = await resolveSourceFile(filePath);
  const moduleId = moduleIdForFile(normalizedPath);
  if (moduleSources.has(moduleId)) {
    return moduleId;
  }

  const source = await readFile(normalizedPath, 'utf8');
  const transformed = sucrase.transform(source, {
    transforms: ['typescript', 'jsx', 'imports'],
    production: true,
    jsxRuntime: 'automatic',
  }).code;

  moduleSources.set(moduleId, transformed);
  const deps = {};
  moduleDeps.set(moduleId, deps);

  for (const request of findRequires(transformed)) {
    if (!request.startsWith('.')) {
      deps[request] = request;
      continue;
    }

    const resolved = await resolveRelativeRequest(normalizedPath, request);
    deps[request] = resolved;
  }

  return moduleId;
}

async function addVendorModule(moduleId, filePath) {
  if (moduleSources.has(moduleId)) {
    return moduleId;
  }
  const source = await readFile(filePath, 'utf8');
  moduleSources.set(moduleId, source);
  const deps = {};
  moduleDeps.set(moduleId, deps);
  for (const request of findRequires(source)) {
    deps[request] = request;
  }
  return moduleId;
}

function findRequires(source) {
  const requests = [];
  for (const match of source.matchAll(REQUIRE_PATTERN)) {
    requests.push(match[1]);
  }
  return requests;
}

async function resolveSourceFile(filePath) {
  if (SOURCE_EXTENSIONS.includes(path.extname(filePath))) {
    return filePath;
  }

  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${filePath}${extension}`;
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // Continue trying extensions.
    }
  }

  throw new Error(`Could not resolve source file ${filePath}.`);
}

async function resolveRelativeRequest(fromFile, request) {
  const absoluteRequest = path.resolve(path.dirname(fromFile), request);
  const extension = path.extname(absoluteRequest);

  if (CSS_EXTENSIONS.has(extension)) {
    cssFiles.add(absoluteRequest);
    return await addEmptyModule(absoluteRequest);
  }

  if (ASSET_EXTENSIONS.has(extension)) {
    return await addAssetModule(absoluteRequest);
  }

  return addSourceModule(absoluteRequest);
}

async function addEmptyModule(filePath) {
  const moduleId = moduleIdForFile(filePath);
  if (!moduleSources.has(moduleId)) {
    moduleSources.set(moduleId, 'Object.defineProperty(exports, "__esModule", { value: true });');
    moduleDeps.set(moduleId, {});
  }
  return moduleId;
}

async function addAssetModule(filePath) {
  const moduleId = moduleIdForFile(filePath);
  if (moduleSources.has(moduleId)) {
    return moduleId;
  }

  const outputName = assetOutputName(filePath);
  const outputPath = path.join(distDirectory, outputName);
  await mkdir(path.dirname(outputPath), { recursive: true });
  if (!copiedAssets.has(outputPath)) {
    await copyFile(filePath, outputPath);
    copiedAssets.add(outputPath);
  }

  assetModules.set(moduleId, `./${outputName}`);
  moduleSources.set(
    moduleId,
    `Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = ${JSON.stringify(`./${outputName}`)};`,
  );
  moduleDeps.set(moduleId, {});
  return moduleId;
}

async function createCssBundle() {
  const chunks = [];
  for (const cssFile of cssFiles) {
    chunks.push(rewriteCssAssetUrls(await readFile(cssFile, 'utf8')));
  }
  return chunks.join('\n\n');
}

function rewriteCssAssetUrls(source) {
  return source.replaceAll(
    "url('../../App/assets/Background.png')",
    "url('./assets/App_assets_Background.png')",
  );
}

function createBundleSource() {
  const serializedModules = [...moduleSources.entries()]
    .map(([moduleId, source]) => {
      const deps = moduleDeps.get(moduleId) ?? {};
      return `${JSON.stringify(moduleId)}: [${JSON.stringify(deps)}, function(require, module, exports) {\n${source}\n}]`;
    })
    .join(',\n');

  return `(function() {
  const modules = {
${serializedModules}
  };
  const cache = {};
  function load(id) {
    if (cache[id]) {
      return cache[id].exports;
    }
    const entry = modules[id];
    if (!entry) {
      throw new Error('WebView bundle module not found: ' + id);
    }
    const deps = entry[0];
    const factory = entry[1];
    const module = { exports: {} };
    cache[id] = module;
    function localRequire(request) {
      return load(deps[request] || request);
    }
    factory(localRequire, module, module.exports);
    return module.exports;
  }
  load('./src/main.tsx');
})();`;
}

function createHtml() {
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
    />
    <title>Happy Numbers</title>
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
    <script src="./app.js"></script>
  </body>
</html>
`;
}
