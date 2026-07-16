#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decode } from 'fast-png';

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = path.resolve(appRoot, '..');
const THICKNESS_THRESHOLDS = [2.5, 5.5];

function printUsage() {
  console.log(`Usage:
  node ./App/scripts/analyze-pipeline-paintability.mjs <manifest.json> [options]

Options:
  --manifest <file>       Pipeline Lab manifest (alternative to the positional path).
  --config-id <id>        Only analyze this config. Can be passed more than once.
  --json <file>           Also write the complete analysis as JSON.
  --help                  Show this help.
`);
}

function parseArgs(argv) {
  const options = {
    configIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      if (options.manifestPath != null) {
        throw new Error(`Unexpected positional argument: ${arg}`);
      }
      options.manifestPath = arg;
      continue;
    }

    const next = argv[index + 1];
    if (next == null || next.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;

    if (arg === '--manifest') {
      options.manifestPath = next;
    } else if (arg === '--config-id') {
      options.configIds.push(next);
    } else if (arg === '--json') {
      options.jsonPath = next;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function resolveInputPath(value) {
  if (path.isAbsolute(value)) {
    return value;
  }
  const fromCwd = path.resolve(process.cwd(), value);
  if (existsSync(fromCwd)) {
    return fromCwd;
  }
  return path.resolve(repoRoot, value);
}

function resolveOutputPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function resolveManifestAsset(manifestDir, value) {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(manifestDir, value);
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ratio(numerator, denominator) {
  return denominator <= 0 ? 0 : round(numerator / denominator);
}

function percentile(sortedValues, quantile) {
  if (sortedValues.length === 0) {
    return null;
  }
  const index = Math.floor((sortedValues.length - 1) * quantile);
  return sortedValues[index];
}

function numericStats(values, digits = 2) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return null;
  }
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of finite) {
    sum += value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return {
    min,
    mean: round(sum / finite.length, digits),
    max,
  };
}

function areaStats(areas) {
  if (areas.length === 0) {
    return null;
  }
  const sorted = [...areas].sort((left, right) => left - right);
  let sum = 0;
  for (const area of sorted) {
    sum += area;
  }
  return {
    min: sorted[0],
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    mean: round(sum / sorted.length, 2),
  };
}

function category(componentCount, pixelCount, totalComponents, totalPixels) {
  return {
    componentCount,
    componentShare: ratio(componentCount, totalComponents),
    pixelCount,
    pixelShare: ratio(pixelCount, totalPixels),
  };
}

function decodeExactRgb(buffer) {
  const decoded = decode(buffer);
  const { width, height, channels, depth, data } = decoded;
  const pixelCount = width * height;
  const colors = new Uint32Array(pixelCount);

  if (depth === 8 && channels === 4) {
    for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 4) {
      colors[pixel] = ((data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]) >>> 0;
    }
  } else if (depth === 8 && channels === 3) {
    for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 3) {
      colors[pixel] = ((data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]) >>> 0;
    }
  } else if (depth === 8 && (channels === 1 || channels === 2)) {
    for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += channels) {
      const gray = data[offset];
      colors[pixel] = ((gray << 16) | (gray << 8) | gray) >>> 0;
    }
  } else {
    const maxValue = 2 ** depth - 1;
    const toByte = (value) => Math.round((value / maxValue) * 255);
    for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += channels) {
      const red = toByte(data[offset]);
      const green = channels <= 2 ? red : toByte(data[offset + 1]);
      const blue = channels <= 2 ? red : toByte(data[offset + 2]);
      colors[pixel] = ((red << 16) | (green << 8) | blue) >>> 0;
    }
  }

  return { width, height, colors };
}

function analyzeExactRgbComponents(width, height, colors) {
  const pixelCount = colors.length;
  const visited = new Uint8Array(pixelCount);
  const stack = new Int32Array(pixelCount);
  const exactColors = new Set();
  const areas = [];
  const counters = {
    noCrossCoreComponents: 0,
    noCrossCorePixels: 0,
    bboxThicknessLe2_5Components: 0,
    bboxThicknessLe2_5Pixels: 0,
    bboxThicknessLe5_5Components: 0,
    bboxThicknessLe5_5Pixels: 0,
    perimeterWidthLe2_5Components: 0,
    perimeterWidthLe2_5Pixels: 0,
    perimeterWidthLe5_5Components: 0,
    perimeterWidthLe5_5Pixels: 0,
    weakProtrusionPixels: 0,
    interiorPixels: Math.max(0, width - 2) * Math.max(0, height - 2),
  };

  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] !== 0) {
      continue;
    }

    const color = colors[start];
    exactColors.add(color);
    let stackSize = 1;
    stack[0] = start;
    visited[start] = 1;

    let area = 0;
    let perimeter = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let hasCrossCore = false;

    while (stackSize > 0) {
      stackSize -= 1;
      const index = stack[stackSize];
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      let same4 = 0;

      if (x > 0 && colors[index - 1] === color) {
        same4 += 1;
        if (visited[index - 1] === 0) {
          visited[index - 1] = 1;
          stack[stackSize] = index - 1;
          stackSize += 1;
        }
      } else {
        perimeter += 1;
      }

      if (x + 1 < width && colors[index + 1] === color) {
        same4 += 1;
        if (visited[index + 1] === 0) {
          visited[index + 1] = 1;
          stack[stackSize] = index + 1;
          stackSize += 1;
        }
      } else {
        perimeter += 1;
      }

      if (index >= width && colors[index - width] === color) {
        same4 += 1;
        if (visited[index - width] === 0) {
          visited[index - width] = 1;
          stack[stackSize] = index - width;
          stackSize += 1;
        }
      } else {
        perimeter += 1;
      }

      if (index + width < pixelCount && colors[index + width] === color) {
        same4 += 1;
        if (visited[index + width] === 0) {
          visited[index + width] = 1;
          stack[stackSize] = index + width;
          stackSize += 1;
        }
      } else {
        perimeter += 1;
      }

      if (same4 === 4) {
        hasCrossCore = true;
      }

      const isInterior = x > 0 && x + 1 < width && index >= width && index + width < pixelCount;
      if (isInterior && same4 <= 1) {
        let same8 = same4;
        if (colors[index - width - 1] === color) same8 += 1;
        if (colors[index - width + 1] === color) same8 += 1;
        if (colors[index + width - 1] === color) same8 += 1;
        if (colors[index + width + 1] === color) same8 += 1;
        if (same8 <= 3) {
          counters.weakProtrusionPixels += 1;
        }
      }
    }

    areas.push(area);
    if (!hasCrossCore) {
      counters.noCrossCoreComponents += 1;
      counters.noCrossCorePixels += area;
    }

    const bboxWidth = maxX - minX + 1;
    const bboxHeight = maxY - minY + 1;
    const bboxThickness = area / Math.max(bboxWidth, bboxHeight);
    const perimeterEffectiveWidth = perimeter <= 0 ? Number.POSITIVE_INFINITY : (2 * area) / perimeter;

    if (bboxThickness <= THICKNESS_THRESHOLDS[0]) {
      counters.bboxThicknessLe2_5Components += 1;
      counters.bboxThicknessLe2_5Pixels += area;
    }
    if (bboxThickness <= THICKNESS_THRESHOLDS[1]) {
      counters.bboxThicknessLe5_5Components += 1;
      counters.bboxThicknessLe5_5Pixels += area;
    }
    if (perimeterEffectiveWidth <= THICKNESS_THRESHOLDS[0]) {
      counters.perimeterWidthLe2_5Components += 1;
      counters.perimeterWidthLe2_5Pixels += area;
    }
    if (perimeterEffectiveWidth <= THICKNESS_THRESHOLDS[1]) {
      counters.perimeterWidthLe5_5Components += 1;
      counters.perimeterWidthLe5_5Pixels += area;
    }
  }

  const componentCount = areas.length;
  return {
    areas,
    exactColorCount: exactColors.size,
    componentCount,
    area: areaStats(areas),
    noCrossCore: category(
      counters.noCrossCoreComponents,
      counters.noCrossCorePixels,
      componentCount,
      pixelCount,
    ),
    bboxThicknessLe2_5: category(
      counters.bboxThicknessLe2_5Components,
      counters.bboxThicknessLe2_5Pixels,
      componentCount,
      pixelCount,
    ),
    bboxThicknessLe5_5: category(
      counters.bboxThicknessLe5_5Components,
      counters.bboxThicknessLe5_5Pixels,
      componentCount,
      pixelCount,
    ),
    perimeterEffectiveWidthLe2_5: category(
      counters.perimeterWidthLe2_5Components,
      counters.perimeterWidthLe2_5Pixels,
      componentCount,
      pixelCount,
    ),
    perimeterEffectiveWidthLe5_5: category(
      counters.perimeterWidthLe5_5Components,
      counters.perimeterWidthLe5_5Pixels,
      componentCount,
      pixelCount,
    ),
    weakProtrusionPixels: {
      pixelCount: counters.weakProtrusionPixels,
      imagePixelShare: ratio(counters.weakProtrusionPixels, pixelCount),
      interiorPixelShare: ratio(counters.weakProtrusionPixels, counters.interiorPixels),
    },
  };
}

function meanAbsoluteRgbError(left, right) {
  if (left.width !== right.width || left.height !== right.height || left.colors.length !== right.colors.length) {
    return null;
  }
  let absoluteError = 0;
  for (let index = 0; index < left.colors.length; index += 1) {
    const leftColor = left.colors[index];
    const rightColor = right.colors[index];
    absoluteError += Math.abs((leftColor >>> 16) - (rightColor >>> 16));
    absoluteError += Math.abs(((leftColor >>> 8) & 0xff) - ((rightColor >>> 8) & 0xff));
    absoluteError += Math.abs((leftColor & 0xff) - (rightColor & 0xff));
  }
  return round(absoluteError / Math.max(1, left.colors.length * 3), 6);
}

function createAggregate(config) {
  return {
    configId: config?.id ?? null,
    label: config?.label ?? null,
    pipeline: config?.pipeline ?? null,
    difficulty: config?.difficulty ?? null,
    resultCount: 0,
    totalPixels: 0,
    totalComponents: 0,
    componentCounts: [],
    componentAreas: [],
    maeRgbValues: [],
    paletteCounts: [],
    exactColorCounts: [],
    noCrossCoreComponents: 0,
    noCrossCorePixels: 0,
    bboxThicknessLe2_5Components: 0,
    bboxThicknessLe2_5Pixels: 0,
    bboxThicknessLe5_5Components: 0,
    bboxThicknessLe5_5Pixels: 0,
    perimeterWidthLe2_5Components: 0,
    perimeterWidthLe2_5Pixels: 0,
    perimeterWidthLe5_5Components: 0,
    perimeterWidthLe5_5Pixels: 0,
    weakProtrusionPixels: 0,
    interiorPixels: 0,
  };
}

function addToAggregate(aggregate, result) {
  const { metrics } = result;
  aggregate.resultCount += 1;
  aggregate.totalPixels += result.pixelCount;
  aggregate.totalComponents += metrics.componentCount;
  aggregate.componentCounts.push(metrics.componentCount);
  // Avoid spreading large anti-aliased legacy rasters past V8's argument limit.
  for (const area of metrics.areas) {
    aggregate.componentAreas.push(area);
  }
  if (Number.isFinite(result.paletteCount)) {
    aggregate.paletteCounts.push(result.paletteCount);
  }
  aggregate.exactColorCounts.push(metrics.exactColorCount);
  if (Number.isFinite(result.maeRgb)) {
    aggregate.maeRgbValues.push(result.maeRgb);
  }
  aggregate.noCrossCoreComponents += metrics.noCrossCore.componentCount;
  aggregate.noCrossCorePixels += metrics.noCrossCore.pixelCount;
  aggregate.bboxThicknessLe2_5Components += metrics.bboxThicknessLe2_5.componentCount;
  aggregate.bboxThicknessLe2_5Pixels += metrics.bboxThicknessLe2_5.pixelCount;
  aggregate.bboxThicknessLe5_5Components += metrics.bboxThicknessLe5_5.componentCount;
  aggregate.bboxThicknessLe5_5Pixels += metrics.bboxThicknessLe5_5.pixelCount;
  aggregate.perimeterWidthLe2_5Components += metrics.perimeterEffectiveWidthLe2_5.componentCount;
  aggregate.perimeterWidthLe2_5Pixels += metrics.perimeterEffectiveWidthLe2_5.pixelCount;
  aggregate.perimeterWidthLe5_5Components += metrics.perimeterEffectiveWidthLe5_5.componentCount;
  aggregate.perimeterWidthLe5_5Pixels += metrics.perimeterEffectiveWidthLe5_5.pixelCount;
  aggregate.weakProtrusionPixels += metrics.weakProtrusionPixels.pixelCount;
  aggregate.interiorPixels += Math.max(0, result.width - 2) * Math.max(0, result.height - 2);
}

function finalizeAggregate(aggregate) {
  return {
    configId: aggregate.configId,
    label: aggregate.label,
    pipeline: aggregate.pipeline,
    difficulty: aggregate.difficulty,
    resultCount: aggregate.resultCount,
    totalPixels: aggregate.totalPixels,
    componentCount: aggregate.totalComponents,
    componentCountPerResult: numericStats(aggregate.componentCounts),
    area: areaStats(aggregate.componentAreas),
    paletteCount: numericStats(aggregate.paletteCounts),
    exactColorCount: numericStats(aggregate.exactColorCounts),
    maeRgb: numericStats(aggregate.maeRgbValues, 6),
    noCrossCore: category(
      aggregate.noCrossCoreComponents,
      aggregate.noCrossCorePixels,
      aggregate.totalComponents,
      aggregate.totalPixels,
    ),
    bboxThicknessLe2_5: category(
      aggregate.bboxThicknessLe2_5Components,
      aggregate.bboxThicknessLe2_5Pixels,
      aggregate.totalComponents,
      aggregate.totalPixels,
    ),
    bboxThicknessLe5_5: category(
      aggregate.bboxThicknessLe5_5Components,
      aggregate.bboxThicknessLe5_5Pixels,
      aggregate.totalComponents,
      aggregate.totalPixels,
    ),
    perimeterEffectiveWidthLe2_5: category(
      aggregate.perimeterWidthLe2_5Components,
      aggregate.perimeterWidthLe2_5Pixels,
      aggregate.totalComponents,
      aggregate.totalPixels,
    ),
    perimeterEffectiveWidthLe5_5: category(
      aggregate.perimeterWidthLe5_5Components,
      aggregate.perimeterWidthLe5_5Pixels,
      aggregate.totalComponents,
      aggregate.totalPixels,
    ),
    weakProtrusionPixels: {
      pixelCount: aggregate.weakProtrusionPixels,
      imagePixelShare: ratio(aggregate.weakProtrusionPixels, aggregate.totalPixels),
      interiorPixelShare: ratio(aggregate.weakProtrusionPixels, aggregate.interiorPixels),
    },
  };
}

function percent(value) {
  return `${round((value ?? 0) * 100, 2)}%`;
}

function countRange(stats) {
  if (stats == null) {
    return '-';
  }
  if (stats.min === stats.max) {
    return String(stats.min);
  }
  return `${stats.mean} [${stats.min}-${stats.max}]`;
}

function printSummary(report) {
  console.log(`Analyzed ${report.results.length} cleanColor PNG(s) from ${report.manifestPath}`);
  if (report.skipped.length > 0) {
    console.log(`Skipped ${report.skipped.length} result(s); reasons are included in the JSON report.`);
  }

  console.log('\nAggregate by config');
  console.table(
    report.aggregateByConfig.map((item) => ({
      config: item.configId,
      images: item.resultCount,
      components: item.componentCount,
      'components/image': item.componentCountPerResult?.mean ?? '-',
      'area p10': item.area?.p10 ?? '-',
      'area p50': item.area?.p50 ?? '-',
      'no core': `${item.noCrossCore.componentCount} (${percent(item.noCrossCore.componentShare)})`,
      'bbox <=2.5': `${item.bboxThicknessLe2_5.componentCount} (${percent(item.bboxThicknessLe2_5.componentShare)})`,
      'bbox <=5.5': `${item.bboxThicknessLe5_5.componentCount} (${percent(item.bboxThicknessLe5_5.componentShare)})`,
      '2A/P <=2.5': `${item.perimeterEffectiveWidthLe2_5.componentCount} (${percent(item.perimeterEffectiveWidthLe2_5.componentShare)})`,
      '2A/P <=5.5': `${item.perimeterEffectiveWidthLe5_5.componentCount} (${percent(item.perimeterEffectiveWidthLe5_5.componentShare)})`,
      'weak px': `${item.weakProtrusionPixels.pixelCount} (${percent(item.weakProtrusionPixels.imagePixelShare)})`,
      'RGB MAE': item.maeRgb?.mean ?? '-',
      palette: countRange(item.paletteCount),
      'exact RGB': countRange(item.exactColorCount),
    })),
  );

  console.log('\nPer result');
  console.table(
    report.results.map((item) => ({
      source: item.sourceId,
      config: item.configId,
      size: `${item.width}x${item.height}`,
      components: item.metrics.componentCount,
      'area p10': item.metrics.area?.p10 ?? '-',
      'area p50': item.metrics.area?.p50 ?? '-',
      'no core': item.metrics.noCrossCore.componentCount,
      'bbox <=2.5': item.metrics.bboxThicknessLe2_5.componentCount,
      'bbox <=5.5': item.metrics.bboxThicknessLe5_5.componentCount,
      '2A/P <=2.5': item.metrics.perimeterEffectiveWidthLe2_5.componentCount,
      '2A/P <=5.5': item.metrics.perimeterEffectiveWidthLe5_5.componentCount,
      'weak px': item.metrics.weakProtrusionPixels.pixelCount,
      'RGB MAE': item.maeRgb ?? '-',
      palette: item.paletteCount ?? '-',
      'exact RGB': item.metrics.exactColorCount,
    })),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (options.manifestPath == null) {
    printUsage();
    throw new Error('A Pipeline Lab manifest path is required.');
  }

  const manifestPath = resolveInputPath(options.manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const configs = new Map((manifest.configs ?? []).map((config) => [config.id, config]));
  const configFilter = new Set(options.configIds);
  const results = [];
  const skipped = [];
  const aggregates = new Map();

  for (const result of manifest.results ?? []) {
    if (result.status !== 'ok') {
      continue;
    }
    if (configFilter.size > 0 && !configFilter.has(result.configId)) {
      continue;
    }
    const cleanColor = result.variants?.find((variant) => variant.id === 'cleanColor' && variant.pngPath != null);
    if (cleanColor == null) {
      skipped.push({ sourceId: result.sourceId, configId: result.configId, reason: 'cleanColor PNG is missing' });
      continue;
    }

    const pngPath = resolveManifestAsset(manifestDir, cleanColor.pngPath);
    try {
      const decoded = decodeExactRgb(await readFile(pngPath));
      const preparedPath = result.preparedPath == null ? null : resolveManifestAsset(manifestDir, result.preparedPath);
      const prepared = preparedPath == null ? null : decodeExactRgb(await readFile(preparedPath));
      const metrics = analyzeExactRgbComponents(decoded.width, decoded.height, decoded.colors);
      const analyzed = {
        sourceId: result.sourceId,
        inputId: result.inputId ?? null,
        sourceCaseId: result.sourceCaseId ?? null,
        configId: result.configId,
        pngPath,
        preparedPath,
        width: decoded.width,
        height: decoded.height,
        pixelCount: decoded.width * decoded.height,
        manifestFacetCount: result.facetCount ?? null,
        paletteCount: result.paletteCount ?? null,
        maeRgb: prepared == null ? null : meanAbsoluteRgbError(decoded, prepared),
        metrics,
      };
      results.push(analyzed);

      let aggregate = aggregates.get(result.configId);
      if (aggregate == null) {
        aggregate = createAggregate(configs.get(result.configId) ?? { id: result.configId });
        aggregates.set(result.configId, aggregate);
      }
      addToAggregate(aggregate, analyzed);
    } catch (error) {
      skipped.push({
        sourceId: result.sourceId,
        configId: result.configId,
        pngPath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const configOrder = new Map((manifest.configs ?? []).map((config, index) => [config.id, index]));
  const aggregateByConfig = [...aggregates.values()]
    .sort((left, right) => (configOrder.get(left.configId) ?? Number.MAX_SAFE_INTEGER) - (configOrder.get(right.configId) ?? Number.MAX_SAFE_INTEGER))
    .map(finalizeAggregate);

  const report = {
    generatedAt: new Date().toISOString(),
    manifestPath,
    manifestName: manifest.name ?? null,
    definitions: {
      connectivity: '4-connected components of identical 8-bit RGB values; alpha is ignored',
      percentileMethod: 'sorted[floor((count - 1) * quantile)]',
      noCrossCore: 'component has no interior pixel whose four direct neighbors have the same RGB value',
      bboxAverageThickness: 'component area / max(bounding-box width, bounding-box height)',
      perimeterEffectiveWidth: '2 * component area / four-neighbor grid perimeter',
      weakProtrusionPixel: 'interior pixel with same4 <= 1 and same8 <= 3',
      maeRgb: 'mean absolute per-channel RGB error between cleanColor and the prepared source at identical dimensions',
      thicknessThresholds: THICKNESS_THRESHOLDS,
    },
    aggregateByConfig,
    results: results.map((result) => ({
      ...result,
      metrics: {
        ...result.metrics,
        areas: undefined,
      },
    })),
    skipped,
  };

  printSummary(report);

  if (options.jsonPath != null) {
    const jsonPath = resolveOutputPath(options.jsonPath);
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`\nJSON: ${jsonPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
