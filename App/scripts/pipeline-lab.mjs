#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { build } from 'esbuild';
import { decode } from 'fast-png';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = path.resolve(appRoot, '..');
const defaultRunRoot = path.join(repoRoot, 'pipeline-lab', 'runs');
const defaultSuitePath = path.join(repoRoot, 'pipeline-lab', 'suites', 'current-presets.json');
const defaultSourceRun = path.join(
  repoRoot,
  'prompt-lab',
  'runs',
  '2026-06-30T19-40-19-250Z_nano-banana-2-lite-easy-medium-expert',
);

const allVariantIds = [
  'brightColorCircles',
  'colorCircles',
  'cleanColor',
  'coloredEdges',
  'coloredEdgesWithDots',
  'circlesOnly',
  'numbers',
  'classic',
  'debugUnlabeled',
];

function printUsage() {
  console.log(`Usage:
  npm run pipeline:lab -- --suite ./pipeline-lab/suites/current-presets.json
  npm run pipeline:lab -- --source-run ./prompt-lab/runs/<run> --limit-sources 1 --limit-configs 1

Options:
  --suite <file>          Pipeline benchmark suite. Default: ./pipeline-lab/suites/current-presets.json.
  --source-run <dir>      Prompt Lab run directory to use as AI-image source.
  --source-case <id>      Only use a Prompt Lab case. Can be passed more than once.
  --input-id <id>         Only use a Prompt Lab input image. Can be passed more than once.
  --config-id <id>        Only run a pipeline config. Can be passed more than once.
  --variant <id>          Output variant to render. Can be passed more than once. Default comes from suite.
  --limit-sources <n>     Limit source AI images, useful for smoke tests.
  --limit-configs <n>     Limit pipeline configs, useful for smoke tests.
  --out-dir <dir>         Run output root. Default: ./pipeline-lab/runs.
  --dry-run               Build manifest and HTML without running the pipeline.
`);
}

function parseArgs(argv) {
  const options = {
    sourceCases: [],
    inputIds: [],
    configIds: [],
    variants: [],
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
    } else if (arg === '--source-run') {
      options.sourceRun = next;
    } else if (arg === '--source-case') {
      options.sourceCases.push(next);
    } else if (arg === '--input-id') {
      options.inputIds.push(next);
    } else if (arg === '--config-id') {
      options.configIds.push(next);
    } else if (arg === '--variant') {
      options.variants.push(next);
    } else if (arg === '--limit-sources') {
      options.limitSources = Number(next);
    } else if (arg === '--limit-configs') {
      options.limitConfigs = Number(next);
    } else if (arg === '--out-dir') {
      options.outDir = next;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function resolveFromCwd(value) {
  if (path.isAbsolute(value)) {
    return value;
  }
  const cwdPath = path.resolve(process.cwd(), value);
  if (existsSync(cwdPath)) {
    return cwdPath;
  }
  return path.resolve(repoRoot, value);
}

function slugify(value) {
  return String(value)
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

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pathHref(fromDir, targetPath) {
  return path.relative(fromDir, targetPath).split(path.sep).join('/');
}

function decodePreparedPng(buffer) {
  const decoded = decode(buffer);
  const data = new Uint8ClampedArray(decoded.width * decoded.height * 4);
  const channels = decoded.channels;
  const depth = decoded.depth;
  const source = decoded.data;
  const maxValue = depth <= 8 ? 255 : (1 << depth) - 1;

  for (let pixel = 0; pixel < decoded.width * decoded.height; pixel += 1) {
    const srcOffset = pixel * channels;
    const dstOffset = pixel * 4;
    const readChannel = (channelOffset, fallback) => {
      if (channelOffset >= channels) {
        return fallback;
      }
      const raw = source[srcOffset + channelOffset];
      return depth <= 8 ? raw : Math.round((raw / maxValue) * 255);
    };

    const red = channels === 1 || channels === 2 ? readChannel(0, 0) : readChannel(0, 0);
    const green = channels === 1 || channels === 2 ? red : readChannel(1, red);
    const blue = channels === 1 || channels === 2 ? red : readChannel(2, red);
    const alpha = channels === 2 ? readChannel(1, 255) : channels >= 4 ? readChannel(3, 255) : 255;
    const alphaRatio = alpha / 255;

    data[dstOffset] = Math.round(255 * (1 - alphaRatio) + red * alphaRatio);
    data[dstOffset + 1] = Math.round(255 * (1 - alphaRatio) + green * alphaRatio);
    data[dstOffset + 2] = Math.round(255 * (1 - alphaRatio) + blue * alphaRatio);
    data[dstOffset + 3] = 255;
  }

  return {
    width: decoded.width,
    height: decoded.height,
    data,
  };
}

async function loadRuntime() {
  const cacheDir = path.join(appRoot, '.pipeline-lab-cache');
  await mkdir(cacheDir, { recursive: true });
  const outfile = path.join(cacheDir, 'pipeline-lab-runtime.mjs');
  await build({
    entryPoints: [path.join(appRoot, 'scripts', 'pipeline-lab-runtime.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

async function loadSuite(options) {
  const suitePath = options.suite == null ? defaultSuitePath : resolveFromCwd(options.suite);
  let suite;
  try {
    suite = JSON.parse(await readFile(suitePath, 'utf8'));
  } catch (error) {
    if (options.suite != null) {
      throw error;
    }
    suite = {
      name: 'current-presets',
      sourceRun: defaultSourceRun,
      configs: [
        { id: 'easy-current', label: 'Easy current', difficulty: 'easy', colorCount: 8 },
        { id: 'medium-current', label: 'Medium current', difficulty: 'medium', colorCount: 12 },
        { id: 'expert-current', label: 'Expert current', difficulty: 'expert', colorCount: 24 },
      ],
    };
  }
  suite.__suitePath = suitePath;
  return suite;
}

function normalizeSuite(suite, options) {
  const baseDir = suite.__suitePath != null ? path.dirname(suite.__suitePath) : repoRoot;
  const sourceRun = options.sourceRun != null
    ? resolveFromCwd(options.sourceRun)
    : suite.sourceRun != null
      ? path.resolve(baseDir, suite.sourceRun)
      : defaultSourceRun;
  const outRoot =
    options.outDir != null
      ? resolveFromCwd(options.outDir)
      : suite.outDir != null
        ? path.resolve(baseDir, suite.outDir)
        : defaultRunRoot;

  if (!Array.isArray(suite.configs) || suite.configs.length === 0) {
    throw new Error('Pipeline suite must contain at least one config.');
  }
  const variants = [...new Set(options.variants.length > 0 ? options.variants : (suite.variants ?? allVariantIds))];
  const invalidVariants = variants.filter((variantId) => !allVariantIds.includes(variantId));
  if (invalidVariants.length > 0) {
    throw new Error(`Unknown output variant(s): ${invalidVariants.join(', ')}`);
  }

  return {
    name: suite.name ?? 'pipeline-lab',
    baseDir,
    sourceRun,
    sourceCases: [...new Set([...(suite.sourceCases ?? []), ...options.sourceCases])],
    inputIds: [...new Set([...(suite.inputIds ?? []), ...options.inputIds])],
    configs: suite.configs,
    configIds: [...new Set(options.configIds)],
    variants,
    matchSourceDifficulty: Boolean(suite.matchSourceDifficulty),
    limitSources: options.limitSources,
    limitConfigs: options.limitConfigs,
    outRoot,
  };
}

function limitList(items, limit, label) {
  if (limit == null) {
    return items;
  }
  const numericLimit = Math.trunc(Number(limit));
  if (!Number.isFinite(numericLimit) || numericLimit < 1) {
    throw new Error(`${label} must be at least 1.`);
  }
  return items.slice(0, numericLimit);
}

async function collectPromptLabSources(sourceRun, sourceCases) {
  const manifestPath = path.join(sourceRun, 'manifest.json');
  const promptManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const inputsById = new Map((promptManifest.inputs ?? []).map((input) => [input.id, input]));
  const casesById = new Map((promptManifest.cases ?? []).map((testCase) => [testCase.id, testCase]));
  const sourceCaseSet = new Set(sourceCases ?? []);
  const sources = [];

  for (const result of promptManifest.results ?? []) {
    if (result.status !== 'ok' || typeof result.outputPath !== 'string') {
      continue;
    }
    if (sourceCaseSet.size > 0 && !sourceCaseSet.has(result.caseId)) {
      continue;
    }
    const input = inputsById.get(result.inputId) ?? {};
    const testCase = casesById.get(result.caseId) ?? {};
    const outputPath = path.isAbsolute(result.outputPath) ? result.outputPath : path.resolve(sourceRun, result.outputPath);
    sources.push({
      id: `${result.inputId}__${result.caseId}`,
      inputId: result.inputId,
      caseId: result.caseId,
      difficulty: testCase.difficulty ?? null,
      promptColorCount: testCase.colorCount ?? null,
      imagePath: outputPath,
      imageSha256: result.outputSha256 ?? null,
      promptPath: result.promptPath ?? null,
      originalInputPath: input.originalCopyPath ?? input.originalPath ?? null,
      preparedPromptInputPath: input.preparedPath ?? null,
    });
  }

  if (sources.length === 0) {
    throw new Error(`No successful Prompt Lab output images found in ${sourceRun}.`);
  }

  return {
    promptManifest,
    manifestPath,
    sources,
  };
}

async function prepareImageForPipeline(sourcePath, targetPath, settings) {
  const python = `
import json
import sys
from PIL import Image, ImageOps

source, target, max_width, max_height = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
with Image.open(source) as im:
    im = ImageOps.exif_transpose(im)
    im = im.convert("RGBA")
    scale = min(max_width / im.width, max_height / im.height)
    if abs(scale - 1.0) > 0.0001:
        size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
        im = im.resize(size, Image.Resampling.LANCZOS)
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    im = Image.alpha_composite(bg, im).convert("RGB")
    im.save(target, format="PNG")
    print(json.dumps({"width": im.width, "height": im.height, "mimeType": "image/png"}))
`;
  const { stdout } = await execFileAsync(
    'python3',
    ['-c', python, sourcePath, targetPath, String(settings.resizeImageWidth), String(settings.resizeImageHeight)],
    { maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(stdout.trim());
}

function resultWithoutInlinePayload(result) {
  return {
    svgWidth: result.svgWidth,
    svgHeight: result.svgHeight,
    imageWidth: result.imageWidth,
    imageHeight: result.imageHeight,
    facetCount: result.facetCount,
    timings: result.timings,
    preparedImage: result.preparedImage,
    palette: result.palette,
    variants: result.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      description: variant.description,
      pngWidth: variant.pngWidth,
      pngHeight: variant.pngHeight,
      pngByteLength: variant.pngByteLength,
      svgWidth: variant.svgWidth,
      svgHeight: variant.svgHeight,
      svgByteLength: variant.svgByteLength,
      isDefault: Boolean(variant.isDefault),
    })),
  };
}

async function writePipelineResultFiles(configDir, result) {
  const variantsDir = path.join(configDir, 'variants');
  await mkdir(variantsDir, { recursive: true });
  const variants = [];

  for (const variant of result.variants) {
    const pngPath = path.join(variantsDir, `${variant.id}.png`);
    const svgPath = path.join(variantsDir, `${variant.id}.svg`);
    if (variant.pngBase64 != null) {
      await writeFile(pngPath, Buffer.from(variant.pngBase64, 'base64'));
    }
    if (variant.svg != null) {
      await writeFile(svgPath, variant.svg);
    }
    variants.push({
      id: variant.id,
      label: variant.label,
      description: variant.description,
      pngPath,
      pngSha256: variant.pngBase64 == null ? null : sha256Buffer(Buffer.from(variant.pngBase64, 'base64')),
      pngWidth: variant.pngWidth,
      pngHeight: variant.pngHeight,
      pngByteLength: variant.pngByteLength,
      svgPath,
      svgSha256: variant.svg == null ? null : sha256Buffer(Buffer.from(variant.svg)),
      svgWidth: variant.svgWidth,
      svgHeight: variant.svgHeight,
      svgByteLength: variant.svgByteLength,
      isDefault: Boolean(variant.isDefault),
    });
  }

  await writeFile(path.join(configDir, 'result.summary.json'), JSON.stringify(resultWithoutInlinePayload(result), null, 2));
  await writeFile(path.join(configDir, 'palette.json'), JSON.stringify(result.palette, null, 2));
  await writeFile(path.join(configDir, 'timings.json'), JSON.stringify(result.timings, null, 2));
  return variants;
}

function configMetaHtml(config) {
  const settings = config.settings;
  return `<div class="config-meta">
    <strong>${htmlEscape(config.label)}</strong>
    <div>${htmlEscape(config.description ?? '')}</div>
    <code>${htmlEscape(JSON.stringify({
      pipeline: config.pipeline,
      freshPaintabilityProfile: config.freshPaintabilityProfile ?? 'current',
      colors: settings.kMeansNrOfClusters,
      nearIdentical: settings.nearIdenticalPaletteMergeLabDistance,
      minAreaRatio: settings.removeFacetsSmallerThanImageRatio,
      similarMerge: Boolean(settings.mergeSimilarAdjacentRegions),
      cleanup: settings.narrowPixelStripCleanupRuns,
      protrusion: settings.nrOfTimesToHalveBorderSegments,
      maxFacets: settings.maximumNumberOfFacets,
      seed: settings.randomSeed,
    }))}</code>
  </div>`;
}

function resultCellHtml(runDir, result, variantId, configLabel = null) {
  if (result == null) {
    return '<td class="missing">missing</td>';
  }
  if (result.status === 'dry-run') {
    return '<td class="missing">dry run</td>';
  }
  if (result.status !== 'ok') {
    return `<td class="error">${htmlEscape(result.error ?? 'error')}</td>`;
  }
  const variant = result.variants.find((item) => item.id === variantId);
  if (variant == null || variant.pngPath == null) {
    return '<td class="missing">variant missing</td>';
  }
  const imageHref = pathHref(runDir, variant.pngPath);
  const configHref = pathHref(runDir, result.settingsPath);
  const paletteHref = pathHref(runDir, result.palettePath);
  return `<td>
    <a href="${htmlEscape(imageHref)}"><img src="${htmlEscape(imageHref)}" alt="${htmlEscape(result.configId)} ${htmlEscape(variantId)}"></a>
    ${configLabel == null ? '' : `<div class="meta"><strong>${htmlEscape(configLabel)}</strong></div>`}
    <div class="meta">facets: ${htmlEscape(result.facetCount)}</div>
    <div class="meta">palette: ${htmlEscape(result.paletteCount)}</div>
    <div class="links"><a href="${htmlEscape(configHref)}">settings</a> <a href="${htmlEscape(paletteHref)}">palette</a></div>
  </td>`;
}

async function writeContactSheet(runDir, manifest) {
  const configs = manifest.configs;
  const matchSourceDifficulty = manifest.matchSourceDifficulty === true;
  const resultsBySourceConfig = new Map(manifest.results.map((result) => [`${result.sourceId}/${result.configId}`, result]));
  const renderedVariantIds = manifest.variants ?? allVariantIds;
  const variantSections = renderedVariantIds.map((variantId) => {
    const variantLabel = manifest.results
      .flatMap((result) => result.variants ?? [])
      .find((variant) => variant.id === variantId)?.label ?? variantId;
    const rows = manifest.sources.map((source) => {
      const sourceHref = pathHref(runDir, source.localAiImagePath);
      const originalHref = source.localOriginalInputPath == null ? null : pathHref(runDir, source.localOriginalInputPath);
      const matchingConfig = matchSourceDifficulty
        ? configs.find((config) => config.difficulty === source.difficulty)
        : null;
      const cells = matchSourceDifficulty
        ? resultCellHtml(
            runDir,
            matchingConfig == null ? null : resultsBySourceConfig.get(`${source.id}/${matchingConfig.id}`),
            variantId,
            matchingConfig?.label ?? null,
          )
        : configs.map((config) => resultCellHtml(runDir, resultsBySourceConfig.get(`${source.id}/${config.id}`), variantId)).join('\n');
      return `<tr>
        <th>
          <a href="${htmlEscape(sourceHref)}"><img src="${htmlEscape(sourceHref)}" alt="${htmlEscape(source.id)} AI source"></a>
          <div>${htmlEscape(source.inputId)} / ${htmlEscape(source.caseId)}</div>
          <div class="meta">prompt ${htmlEscape(source.difficulty ?? 'unknown')} | ${htmlEscape(source.promptColorCount ?? 'n/a')} colors</div>
          ${originalHref == null ? '' : `<div class="links"><a href="${htmlEscape(originalHref)}">original</a></div>`}
        </th>
        ${cells}
      </tr>`;
    }).join('\n');

    return `<section id="${htmlEscape(variantId)}">
      <h2>${htmlEscape(variantLabel)} <span class="variant-id">${htmlEscape(variantId)}</span></h2>
      <table>
        <thead>
          <tr>
            <th>AI Source</th>
            ${matchSourceDifficulty
              ? `<th>${htmlEscape(variantLabel)} · passendes Preset</th>`
              : configs.map((config) => `<th>${configMetaHtml(config)}</th>`).join('\n')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  }).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(manifest.name)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f2933; background: #f7f8fa; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 { font-size: 20px; margin: 32px 0 12px; }
    .variant-id { color: #7b8794; font-size: 13px; font-weight: 500; margin-left: 6px; }
    .summary, .meta, .links { color: #52606d; font-size: 12px; }
    .summary { margin-bottom: 16px; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 24px; }
    nav a { padding: 6px 9px; border: 1px solid #bcccdc; border-radius: 6px; background: #fff; color: #243b53; text-decoration: none; font-size: 13px; }
    table { border-collapse: collapse; width: 100%; background: #fff; margin-bottom: 28px; }
    th, td { border: 1px solid #d9e2ec; padding: 10px; vertical-align: top; min-width: 220px; }
    th { width: 240px; background: #f0f4f8; text-align: left; }
    img { width: 220px; max-height: 280px; object-fit: contain; display: block; background: #fff; }
    code { display: block; white-space: pre-wrap; font-size: 11px; margin-top: 6px; color: #334e68; }
    .config-meta { max-width: 240px; }
    .links a { margin-right: 8px; }
    .error { background: #fff5f5; color: #9b1c1c; }
    .missing { color: #7b8794; }
  </style>
</head>
<body>
  <h1>${htmlEscape(manifest.name)}</h1>
  <div class="summary">Created: ${htmlEscape(manifest.createdAt)} | Sources: ${manifest.sources.length} | Configs: ${manifest.configs.length} | Dry run: ${manifest.dryRun ? 'yes' : 'no'}</div>
  <div class="summary">Prompt Lab source: ${htmlEscape(manifest.sourceRun)}</div>
  <nav>${renderedVariantIds.map((variantId) => `<a href="#${htmlEscape(variantId)}">${htmlEscape(variantId)}</a>`).join('')}</nav>
  ${variantSections}
</body>
</html>
`;

  await writeFile(path.join(runDir, 'contact-sheet.html'), html);
  await writeFile(path.join(runDir, 'index.html'), html);
}

async function writeOverviewImage(manifestPath, outputPath, variantId) {
  const python = `
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

manifest_path, output_path, variant_id = sys.argv[1], sys.argv[2], sys.argv[3]
manifest = json.loads(Path(manifest_path).read_text())
configs = manifest["configs"]
sources = manifest["sources"]
results = {(r["sourceId"], r["configId"]): r for r in manifest["results"]}
match_source_difficulty = bool(manifest.get("matchSourceDifficulty"))
variant_label = next((variant.get("label", variant_id) for result in manifest["results"] for variant in result.get("variants", []) if variant.get("id") == variant_id), variant_id)
display_configs = [{"label": f"{variant_label} · passendes Preset"}] if match_source_difficulty else configs

thumb_w, thumb_h = 260, 190
label_h = 58
pad = 12
header_h = 84
source_w = 260
width = pad + source_w + pad + len(display_configs) * (thumb_w + pad)
height = pad + header_h + pad + len(sources) * (thumb_h + label_h + pad)
canvas = Image.new("RGB", (width, height), (247, 248, 250))
draw = ImageDraw.Draw(canvas)

try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 15)
    font_bold = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 15)
    font_small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 12)
except Exception:
    font = font_bold = font_small = ImageFont.load_default()

def fit_text(text, x, y, width, selected_font, fill=(31, 41, 51), line_height=16, max_lines=3):
    words = str(text).split()
    line = ""
    lines = []
    for word in words:
        test = word if not line else line + " " + word
        if draw.textbbox((0, 0), test, font=selected_font)[2] <= width:
            line = test
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    for index, line in enumerate(lines[:max_lines]):
        draw.text((x, y + index * line_height), line, font=selected_font, fill=fill)

def paste_thumb(image_path, box):
    x, y, w, h = box
    image = Image.open(image_path).convert("RGB")
    image.thumbnail((w, h), Image.Resampling.LANCZOS)
    canvas.paste(image, (x + (w - image.width) // 2, y + (h - image.height) // 2))

draw.text((pad, pad), "AI Source", font=font_bold, fill=(31, 41, 51))
x = pad + source_w + pad
for config in display_configs:
    draw.rounded_rectangle((x, pad, x + thumb_w, pad + header_h), radius=4, fill=(240, 244, 248), outline=(217, 226, 236))
    fit_text(config["label"], x + 8, pad + 8, thumb_w - 16, font_bold)
    if not match_source_difficulty:
        settings = config["settings"]
        area_ratio = settings.get('removeFacetsSmallerThanImageRatio', 0)
        similar = "similar on" if settings.get('mergeSimilarAdjacentRegions') else "similar off"
        near_identical = settings.get('nearIdenticalPaletteMergeLabDistance', 0)
        meta = f"{settings['kMeansNrOfClusters']}c near {near_identical:.2f} area {area_ratio:.6f} {similar} cleanup {settings['narrowPixelStripCleanupRuns']} protr {settings['nrOfTimesToHalveBorderSegments']}"
        fit_text(meta, x + 8, pad + 42, thumb_w - 16, font_small, fill=(82, 96, 109), max_lines=2)
    x += thumb_w + pad

y = pad + header_h + pad
for source in sources:
    draw.rectangle((pad, y, pad + source_w, y + thumb_h + label_h), fill=(255, 255, 255), outline=(217, 226, 236))
    paste_thumb(source["localAiImagePath"], (pad, y, source_w, thumb_h))
    fit_text(f"{source['inputId']} / {source['caseId']}", pad + 8, y + thumb_h + 8, source_w - 16, font_bold, max_lines=1)
    fit_text(f"prompt colors {source.get('promptColorCount')}", pad + 8, y + thumb_h + 30, source_w - 16, font_small, fill=(82, 96, 109), max_lines=1)
    x = pad + source_w + pad
    row_configs = [next(config for config in configs if config.get("difficulty") == source.get("difficulty"))] if match_source_difficulty else configs
    for config in row_configs:
        result = results[(source["id"], config["id"])]
        draw.rectangle((x, y, x + thumb_w, y + thumb_h + label_h), fill=(255, 255, 255), outline=(217, 226, 236))
        if result["status"] == "ok":
            variant = next((item for item in result["variants"] if item["id"] == variant_id), None)
            if variant is not None:
                paste_thumb(variant["pngPath"], (x, y, thumb_w, thumb_h))
            fit_text(f"facets {result.get('facetCount')} palette {result.get('paletteCount')}", x + 8, y + thumb_h + 8, thumb_w - 16, font_small, fill=(82, 96, 109), max_lines=1)
            if match_source_difficulty:
                fit_text(config.get("label", ""), x + 8, y + thumb_h + 28, thumb_w - 16, font_small, fill=(82, 96, 109), max_lines=1)
        else:
            fit_text(result.get("error", result["status"]), x + 8, y + 8, thumb_w - 16, font_small, fill=(155, 28, 28))
        x += thumb_w + pad
    y += thumb_h + label_h + pad

canvas.save(output_path)
print(output_path)
`;

  await execFileAsync('python3', ['-c', python, manifestPath, outputPath, variantId], {
    maxBuffer: 1024 * 1024,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const runtime = await loadRuntime();
  const rawSuite = await loadSuite(options);
  const suite = normalizeSuite(rawSuite, options);
  const runDir = path.join(suite.outRoot, `${timestampForPath()}_${slugify(suite.name)}`);
  await mkdir(runDir, { recursive: true });

  const { manifestPath: promptManifestPath, promptManifest, sources: allSources } = await collectPromptLabSources(
    suite.sourceRun,
    suite.sourceCases,
  );
  let sources = allSources;
  if (suite.inputIds.length > 0) {
    const inputIdSet = new Set(suite.inputIds);
    sources = sources.filter((source) => inputIdSet.has(source.inputId));
    if (sources.length === 0) {
      throw new Error('No prompt-lab sources match the selected input ids.');
    }
  }

  let configs = suite.configs.map((config) => runtime.resolvePipelineLabConfig(config));
  if (suite.configIds.length > 0) {
    const configIdSet = new Set(suite.configIds);
    configs = configs.filter((config) => configIdSet.has(config.id));
  }
  configs = limitList(configs, suite.limitConfigs, '--limit-configs');
  if (configs.length === 0) {
    throw new Error('No pipeline configs selected.');
  }
  if (suite.matchSourceDifficulty) {
    const selectedDifficulties = new Set(configs.map((config) => config.difficulty));
    sources = sources.filter((source) => selectedDifficulties.has(source.difficulty));
    if (sources.length === 0) {
      throw new Error('No prompt-lab sources match the selected pipeline config difficulties.');
    }
  }
  sources = limitList(sources, suite.limitSources, '--limit-sources');

  const manifest = {
    name: suite.name,
    createdAt: new Date().toISOString(),
    dryRun: Boolean(options.dryRun),
    runDir,
    sourceRun: suite.sourceRun,
    promptManifestPath,
    promptManifestName: promptManifest.name ?? null,
    variants: suite.variants,
    matchSourceDifficulty: suite.matchSourceDifficulty,
    sources: [],
    configs,
    results: [],
  };

  for (const source of sources) {
    await stat(source.imagePath);
    const sourceDir = path.join(runDir, source.id);
    await mkdir(sourceDir, { recursive: true });
    const aiExt = path.extname(source.imagePath).toLowerCase() || '.img';
    const localAiImagePath = path.join(sourceDir, `ai-source${aiExt}`);
    await copyFile(source.imagePath, localAiImagePath);

    let localOriginalInputPath = null;
    if (source.originalInputPath != null) {
      try {
        const originalExt = path.extname(source.originalInputPath).toLowerCase() || '.img';
        localOriginalInputPath = path.join(sourceDir, `original-input${originalExt}`);
        await copyFile(source.originalInputPath, localOriginalInputPath);
      } catch {
        localOriginalInputPath = null;
      }
    }

    manifest.sources.push({
      ...source,
      localAiImagePath,
      localAiImageSha256: await sha256File(localAiImagePath),
      localOriginalInputPath,
    });

    for (const config of configs) {
      if (suite.matchSourceDifficulty && config.difficulty !== source.difficulty) {
        continue;
      }
      const configDir = path.join(sourceDir, config.id);
      await mkdir(configDir, { recursive: true });
      const settingsPath = path.join(configDir, 'settings.json');
      await writeFile(settingsPath, JSON.stringify(config.settings, null, 2));

      const resultBase = {
        sourceId: source.id,
        inputId: source.inputId,
        sourceCaseId: source.caseId,
        configId: config.id,
        settingsPath,
        settingsSha256: await sha256File(settingsPath),
      };

      if (options.dryRun) {
        manifest.results.push({
          ...resultBase,
          status: 'dry-run',
        });
        continue;
      }

      try {
        const preparedPath = path.join(configDir, 'input.prepared.png');
        const prepared = await prepareImageForPipeline(source.imagePath, preparedPath, config.settings);
        const preparedBuffer = await readFile(preparedPath);
        const imageData = decodePreparedPng(preparedBuffer);
        const startedAt = Date.now();
        const result = await runtime.runPipelineLabImage(imageData, config.settings, {
          imageUri: preparedPath,
          width: imageData.width,
          height: imageData.height,
          fileName: path.basename(preparedPath),
          mimeType: prepared.mimeType,
        }, {
          variantIds: suite.variants,
          pipeline: config.pipeline,
          freshPaintabilityProfile: config.freshPaintabilityProfile,
        });
        const variants = await writePipelineResultFiles(configDir, result);
        const palettePath = path.join(configDir, 'palette.json');
        const timingsPath = path.join(configDir, 'timings.json');
        manifest.results.push({
          ...resultBase,
          status: 'ok',
          preparedPath,
          preparedSha256: sha256Buffer(preparedBuffer),
          preparedWidth: imageData.width,
          preparedHeight: imageData.height,
          durationMs: Date.now() - startedAt,
          facetCount: result.facetCount,
          paletteCount: result.palette.length,
          palettePath,
          timingsPath,
          variants,
        });
        console.log(`ok ${source.id} / ${config.id} -> ${result.facetCount} facets`);
      } catch (error) {
        const errorPath = path.join(configDir, 'error.json');
        await writeFile(errorPath, JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : null,
        }, null, 2));
        manifest.results.push({
          ...resultBase,
          status: 'error',
          errorPath,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`error ${source.id} / ${config.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const manifestPath = path.join(runDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeContactSheet(runDir, manifest);
  if (!options.dryRun) {
    manifest.overviews = {};
    for (const variantId of suite.variants) {
      const overviewPath = path.join(runDir, `overview-${variantId}.png`);
      await writeOverviewImage(manifestPath, overviewPath, variantId);
      manifest.overviews[variantId] = overviewPath;
    }
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }
  console.log(`Pipeline Lab run written to ${path.relative(repoRoot, runDir)}`);

  if (manifest.results.some((result) => result.status === 'error')) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
