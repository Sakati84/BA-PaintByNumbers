#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { build } from 'esbuild';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = path.resolve(appRoot, '..');
const defaultRunRoot = path.join(repoRoot, 'prompt-lab', 'runs');
const defaultModel = 'gemini-3.1-flash-lite-image';
const defaultMaxEdge = 1024;
const defaultTemperature = 0.2;

function printUsage() {
  console.log(`Usage:
  npm run prompt:lab -- --suite ./prompt-lab/suites/expert-ab.example.json
  npm run prompt:lab -- --image ./test-assets/legacy-samples/dog.jpg --variant expert --colors 24 --seed 1234
  npm run prompt:lab -- --image ./test-assets/legacy-samples/dog.jpg --prompt ./prompt-lab/prompts/expert-v2.md --seed 1234

Options:
  --suite <file>       Run a JSON suite.
  --image <file>       Input image. Can be passed more than once.
  --prompt <file>      Full prompt text file for single-case mode.
  --variant <name>     Built-in prompt variant: easy, medium, expert. Default: expert.
  --colors <number>    Number of intended colors. Default: 24.
  --seed <number>      Gemini generationConfig.seed.
  --temperature <n>    Gemini temperature. Default: 0.2.
  --model <name>       Gemini model. Default: gemini-3.1-flash-lite-image.
  --max-edge <number>  Longest input edge sent to the model. Default: 1024.
  --out-dir <dir>      Run output root. Default: ./prompt-lab/runs.
  --dry-run            Build prompts, request JSON, manifest, and HTML without calling Gemini.
`);
}

function parseArgs(argv) {
  const options = {
    images: [],
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    const next = argv[index + 1];
    if (next == null || next.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;

    if (arg === '--suite') {
      options.suite = next;
    } else if (arg === '--image') {
      options.images.push(next);
    } else if (arg === '--prompt') {
      options.prompt = next;
    } else if (arg === '--variant') {
      options.variant = next;
    } else if (arg === '--colors') {
      options.colors = Number(next);
    } else if (arg === '--seed') {
      options.seed = Number(next);
    } else if (arg === '--temperature') {
      options.temperature = Number(next);
    } else if (arg === '--model') {
      options.model = next;
    } else if (arg === '--max-edge') {
      options.maxEdge = Number(next);
    } else if (arg === '--out-dir') {
      options.outDir = next;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function resolveFromRepo(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function resolveFromCwd(value) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function sha256File(filePath) {
  return sha256Buffer(await readFile(filePath));
}

function imageExtensionForMime(mimeType) {
  if (mimeType === 'image/jpeg') {
    return 'jpg';
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  return 'png';
}

function mimeForInputPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }
  if (ext === '.webp') {
    return 'image/webp';
  }
  return 'image/png';
}

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderPromptTemplate(template, values) {
  return Object.entries(values).reduce((output, [key, value]) => {
    return output.split(`{{${key}}}`).join(String(value));
  }, template);
}

async function loadDotEnvFile(filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

async function loadEnvFiles() {
  await loadDotEnvFile(path.join(repoRoot, '.env'));
  await loadDotEnvFile(path.join(appRoot, '.env'));
  await loadDotEnvFile(path.join(appRoot, '.env.local'));
}

async function loadRuntime() {
  const cacheDir = path.join(appRoot, '.prompt-lab-cache');
  await mkdir(cacheDir, { recursive: true });
  const outfile = path.join(cacheDir, 'prompt-lab-runtime.mjs');
  await build({
    entryPoints: [path.join(appRoot, 'scripts', 'prompt-lab-runtime.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

async function loadSuite(options) {
  if (options.suite != null) {
    const suitePath = resolveFromCwd(options.suite);
    const suite = JSON.parse(await readFile(suitePath, 'utf8'));
    suite.__suitePath = suitePath;
    return suite;
  }

  if (options.images.length === 0) {
    throw new Error('Pass --suite or at least one --image.');
  }

  return {
    name: 'single-run',
    model: options.model,
    maxEdge: options.maxEdge,
    generationConfig: {
      seed: options.seed,
      temperature: options.temperature,
    },
    inputs: options.images.map(resolveFromCwd),
    cases: [
      {
        id: options.prompt != null ? slugify(path.basename(options.prompt)) : options.variant ?? 'expert',
        promptFile: options.prompt != null ? resolveFromCwd(options.prompt) : undefined,
        difficulty: options.variant ?? 'expert',
        colorCount: options.colors,
      },
    ],
  };
}

function normalizeSuite(suite, options) {
  const baseDir = suite.__suitePath != null ? path.dirname(suite.__suitePath) : repoRoot;
  const model = options.model ?? suite.model ?? process.env.GEMINI_IMAGE_MODEL ?? process.env.EXPO_PUBLIC_GEMINI_IMAGE_MODEL ?? defaultModel;
  const maxEdge = Number(options.maxEdge ?? suite.maxEdge ?? defaultMaxEdge);
  const temperature = Number(options.temperature ?? suite.generationConfig?.temperature ?? defaultTemperature);
  const seed = options.seed ?? suite.generationConfig?.seed;
  const outRoot =
    options.outDir != null
      ? resolveFromCwd(options.outDir)
      : suite.outDir != null
        ? path.resolve(baseDir, suite.outDir)
        : defaultRunRoot;

  if (!Array.isArray(suite.inputs) || suite.inputs.length === 0) {
    throw new Error('Suite must contain at least one input image.');
  }
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    throw new Error('Suite must contain at least one case.');
  }

  return {
    name: suite.name ?? 'prompt-lab',
    baseDir,
    model,
    maxEdge,
    generationConfig: {
      ...suite.generationConfig,
      temperature,
      seed,
    },
    inputs: suite.inputs.map((inputPath) => path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDir, inputPath)),
    cases: suite.cases,
    outRoot,
  };
}

async function prepareInputImage(inputPath, outputDir, maxEdge) {
  const originalBuffer = await readFile(inputPath);
  const preparedPath = path.join(outputDir, 'input.prepared.jpg');
  const python = `
import json
import sys
from PIL import Image, ImageOps

source, target, max_edge = sys.argv[1], sys.argv[2], int(sys.argv[3])
with Image.open(source) as im:
    im = ImageOps.exif_transpose(im)
    im = im.convert("RGB")
    im.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    im.save(target, format="JPEG", quality=92)
    print(json.dumps({"width": im.width, "height": im.height, "mimeType": "image/jpeg"}))
`;
  const { stdout } = await execFileAsync('python3', ['-c', python, inputPath, preparedPath, String(maxEdge)], {
    maxBuffer: 1024 * 1024,
  });
  const metadata = JSON.parse(stdout.trim());
  const preparedBuffer = await readFile(preparedPath);

  return {
    originalPath: inputPath,
    originalFileName: path.basename(inputPath),
    originalSha256: sha256Buffer(originalBuffer),
    originalByteLength: originalBuffer.byteLength,
    preparedPath,
    preparedSha256: sha256Buffer(preparedBuffer),
    preparedByteLength: preparedBuffer.byteLength,
    width: metadata.width,
    height: metadata.height,
    mimeType: metadata.mimeType ?? mimeForInputPath(preparedPath),
    base64: preparedBuffer.toString('base64'),
  };
}

async function buildPromptForCase(runtime, suite, testCase) {
  const colorCount = Number(testCase.colorCount ?? 24);
  const maxEdge = Number(testCase.maxEdge ?? suite.maxEdge);
  const targetAudience = testCase.targetAudience;

  if (typeof testCase.prompt === 'string') {
    return renderPromptTemplate(testCase.prompt, {
      NUMBER_OF_COLORS: colorCount,
      TARGET_AUDIENCE: targetAudience ?? 'advanced users or expert-level coloring',
      MAX_EDGE: maxEdge,
    });
  }

  if (typeof testCase.promptFile === 'string') {
    const promptPath = path.isAbsolute(testCase.promptFile)
      ? testCase.promptFile
      : path.resolve(suite.baseDir, testCase.promptFile);
    const template = await readFile(promptPath, 'utf8');
    return renderPromptTemplate(template.trim(), {
      NUMBER_OF_COLORS: colorCount,
      TARGET_AUDIENCE: targetAudience ?? 'advanced users or expert-level coloring',
      MAX_EDGE: maxEdge,
    });
  }

  return runtime.buildPromptLabPosterizePrompt({
    difficulty: testCase.difficulty ?? 'expert',
    colorCount,
    maxEdge,
    targetAudience,
  });
}

function generationConfigForCase(suite, testCase) {
  const config = {
    responseModalities: ['IMAGE'],
    temperature: defaultTemperature,
    ...suite.generationConfig,
    ...testCase.generationConfig,
  };

  if (config.seed == null || Number.isNaN(Number(config.seed))) {
    delete config.seed;
  } else {
    config.seed = Math.trunc(Number(config.seed));
  }

  if (config.temperature == null || Number.isNaN(Number(config.temperature))) {
    delete config.temperature;
  } else {
    config.temperature = Number(config.temperature);
  }

  return config;
}

async function callGemini({ apiKey, model, requestBody }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  let responseJson = null;
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    responseJson = { rawText: responseText };
  }

  if (!response.ok) {
    const error = new Error(`Gemini HTTP ${response.status}: ${responseText}`);
    error.status = response.status;
    error.responseJson = responseJson;
    throw error;
  }

  return responseJson;
}

function responseWithoutInlineData(responseJson) {
  return JSON.parse(JSON.stringify(responseJson, (key, value) => {
    if (key === 'data' && typeof value === 'string' && value.length > 200) {
      return `[base64 omitted, ${value.length} chars]`;
    }
    return value;
  }));
}

async function writeContactSheet(runDir, manifest) {
  const cases = manifest.cases;
  const inputs = manifest.inputs;
  const rows = inputs.map((input) => {
    const cells = cases.map((testCase) => {
      const result = manifest.results.find((item) => item.inputId === input.id && item.caseId === testCase.id);
      if (result == null) {
        return '<td class="missing">Missing</td>';
      }
      if (result.status === 'dry-run') {
        const promptHref = path.relative(runDir, result.promptPath).split(path.sep).join('/');
        const requestHref = path.relative(runDir, result.requestPath).split(path.sep).join('/');
        return `<td class="missing">
          <strong>${htmlEscape(testCase.id)}</strong>
          <p>Dry run only.</p>
          <div class="links"><a href="${htmlEscape(promptHref)}">prompt</a> <a href="${htmlEscape(requestHref)}">request</a></div>
        </td>`;
      }
      if (result.status !== 'ok') {
        return `<td class="error"><strong>${htmlEscape(testCase.id)}</strong><p>${htmlEscape(result.error ?? 'Failed')}</p></td>`;
      }
      const imageSrc = path.relative(runDir, result.outputPath).split(path.sep).join('/');
      const promptHref = path.relative(runDir, result.promptPath).split(path.sep).join('/');
      const requestHref = path.relative(runDir, result.requestPath).split(path.sep).join('/');
      return `<td>
        <a href="${htmlEscape(imageSrc)}"><img src="${htmlEscape(imageSrc)}" alt="${htmlEscape(testCase.id)} result"></a>
        <div class="meta"><strong>${htmlEscape(testCase.id)}</strong></div>
        <div class="meta">seed: ${htmlEscape(result.generationConfig.seed ?? 'none')}</div>
        <div class="meta">output: ${htmlEscape(result.outputSha256.slice(0, 12))}</div>
        <div class="links"><a href="${htmlEscape(promptHref)}">prompt</a> <a href="${htmlEscape(requestHref)}">request</a></div>
      </td>`;
    }).join('\n');
    const inputHref = path.relative(runDir, input.preparedPath).split(path.sep).join('/');
    return `<tr>
      <th><a href="${htmlEscape(inputHref)}"><img src="${htmlEscape(inputHref)}" alt="${htmlEscape(input.id)} input"></a><div>${htmlEscape(input.id)}</div></th>
      ${cells}
    </tr>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(manifest.name)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f2933; background: #f7f8fa; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    .summary { color: #52606d; margin-bottom: 20px; }
    table { border-collapse: collapse; width: 100%; background: #fff; }
    th, td { border: 1px solid #d9e2ec; padding: 10px; vertical-align: top; min-width: 220px; }
    th { width: 220px; background: #f0f4f8; text-align: left; }
    img { width: 220px; max-height: 260px; object-fit: contain; display: block; background: #fff; }
    .meta, .links { font-size: 12px; margin-top: 6px; color: #52606d; }
    .links a { margin-right: 8px; }
    .error { background: #fff5f5; color: #9b1c1c; }
    .missing { color: #7b8794; }
  </style>
</head>
<body>
  <h1>${htmlEscape(manifest.name)}</h1>
  <div class="summary">Model: ${htmlEscape(manifest.model)} | Created: ${htmlEscape(manifest.createdAt)} | Dry run: ${manifest.dryRun ? 'yes' : 'no'}</div>
  <table>
    <thead>
      <tr><th>Input</th>${cases.map((testCase) => `<th>${htmlEscape(testCase.id)}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>
`;
  await writeFile(path.join(runDir, 'contact-sheet.html'), html);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  await loadEnvFiles();
  const runtime = await loadRuntime();
  const rawSuite = await loadSuite(options);
  const suite = normalizeSuite(rawSuite, options);
  const runDir = path.join(suite.outRoot, `${timestampForPath()}_${slugify(suite.name)}`);
  await mkdir(runDir, { recursive: true });

  const apiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.NANO_BANANA_API_KEY?.trim() ||
    process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim() ||
    process.env.EXPO_PUBLIC_NANO_BANANA_API_KEY?.trim();

  if (!options.dryRun && (apiKey == null || apiKey.length === 0)) {
    throw new Error('No Gemini API key found. Set GEMINI_API_KEY or run with --dry-run.');
  }

  const manifest = {
    name: suite.name,
    createdAt: new Date().toISOString(),
    dryRun: Boolean(options.dryRun),
    model: suite.model,
    maxEdge: suite.maxEdge,
    runDir,
    inputs: [],
    cases: [],
    results: [],
  };

  for (const testCase of suite.cases) {
    manifest.cases.push({
      id: testCase.id ?? slugify(testCase.promptFile ?? testCase.difficulty ?? 'case'),
      difficulty: testCase.difficulty ?? null,
      colorCount: testCase.colorCount ?? 24,
      promptFile: testCase.promptFile ?? null,
      model: testCase.model ?? suite.model,
      generationConfig: generationConfigForCase(suite, testCase),
    });
  }

  const preparedInputs = [];
  for (const inputPath of suite.inputs) {
    await stat(inputPath);
    const inputId = slugify(path.basename(inputPath));
    const inputDir = path.join(runDir, inputId);
    await mkdir(inputDir, { recursive: true });
    const originalCopyPath = path.join(inputDir, `input.original${path.extname(inputPath).toLowerCase() || '.img'}`);
    await copyFile(inputPath, originalCopyPath);
    const prepared = await prepareInputImage(inputPath, inputDir, suite.maxEdge);
    prepared.inputDir = inputDir;
    prepared.id = inputId;
    prepared.originalCopyPath = originalCopyPath;
    preparedInputs.push(prepared);
    manifest.inputs.push({
      id: inputId,
      originalPath: inputPath,
      originalCopyPath,
      originalSha256: prepared.originalSha256,
      originalByteLength: prepared.originalByteLength,
      preparedPath: prepared.preparedPath,
      preparedSha256: prepared.preparedSha256,
      preparedByteLength: prepared.preparedByteLength,
      width: prepared.width,
      height: prepared.height,
      mimeType: prepared.mimeType,
    });
  }

  for (const prepared of preparedInputs) {
    for (const rawCase of suite.cases) {
      const caseId = rawCase.id ?? slugify(rawCase.promptFile ?? rawCase.difficulty ?? 'case');
      const caseDir = path.join(prepared.inputDir, caseId);
      await mkdir(caseDir, { recursive: true });

      const model = rawCase.model ?? suite.model;
      const generationConfig = generationConfigForCase(suite, rawCase);
      const prompt = await buildPromptForCase(runtime, suite, rawCase);
      const promptPath = path.join(caseDir, 'prompt.txt');
      await writeFile(promptPath, prompt);
      const promptSha256 = sha256Buffer(Buffer.from(prompt));

      const requestBody = runtime.buildPromptLabGeminiBody({
        prompt,
        image: {
          mimeType: prepared.mimeType,
          data: prepared.base64,
        },
        generationConfig,
      });
      const requestPath = path.join(caseDir, 'request.json');
      await writeFile(requestPath, JSON.stringify(requestBody, null, 2));

      const resultBase = {
        inputId: prepared.id,
        caseId,
        model,
        promptPath,
        promptSha256,
        requestPath,
        requestSha256: await sha256File(requestPath),
        generationConfig,
      };

      if (options.dryRun) {
        manifest.results.push({
          ...resultBase,
          status: 'dry-run',
        });
        continue;
      }

      try {
        const startedAt = Date.now();
        const responseJson = await callGemini({ apiKey, model, requestBody });
        const responsePath = path.join(caseDir, 'response.summary.json');
        await writeFile(responsePath, JSON.stringify(responseWithoutInlineData(responseJson), null, 2));
        const output = runtime.extractPromptLabGeminiImage(responseJson);
        if (output == null) {
          throw new Error('Gemini response did not contain an inline image.');
        }

        const outputBuffer = Buffer.from(output.data, 'base64');
        const outputPath = path.join(caseDir, `output.${imageExtensionForMime(output.mimeType)}`);
        await writeFile(outputPath, outputBuffer);
        manifest.results.push({
          ...resultBase,
          status: 'ok',
          responsePath,
          outputPath,
          outputMimeType: output.mimeType,
          outputSha256: sha256Buffer(outputBuffer),
          outputByteLength: outputBuffer.byteLength,
          durationMs: Date.now() - startedAt,
        });
        console.log(`ok ${prepared.id} / ${caseId} -> ${path.relative(repoRoot, outputPath)}`);
      } catch (error) {
        const errorPath = path.join(caseDir, 'error.json');
        await writeFile(errorPath, JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
          status: error?.status ?? null,
          response: error?.responseJson ?? null,
        }, null, 2));
        manifest.results.push({
          ...resultBase,
          status: 'error',
          errorPath,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`error ${prepared.id} / ${caseId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await writeContactSheet(runDir, manifest);
  console.log(`Prompt Lab run written to ${path.relative(repoRoot, runDir)}`);

  if (manifest.results.some((result) => result.status === 'error')) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
