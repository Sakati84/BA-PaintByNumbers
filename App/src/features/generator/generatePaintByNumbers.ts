import type { ImagePickerAsset } from 'expo-image-picker';

import { ColorMapResult, ColorReducer } from '../../vendor/paintbynumbersgenerator/colorreductionmanagement';
import type { RGB } from '../../vendor/paintbynumbersgenerator/common';
import { rgb2lab } from '../../vendor/paintbynumbersgenerator/lib/colorconversion';
import { Uint8Array2D } from '../../vendor/paintbynumbersgenerator/structs/typedarrays';
import type { SimpleImageData } from '../../types/imageData';
import { toVendorSettings } from './defaultSettings';
import type {
  GeneratorProgress,
  GeneratorResult,
  GeneratorSettings,
  GeneratorStage,
  GeneratorTimings,
} from './generatorTypes';
import { preparePickedImageForGenerator } from './prepareImage';
import { buildRasterPaintByNumbers } from './rasterPaintByNumbers';

const STAGE_ORDER: PipelineStage[] = [
  'decode',
  'kmeans',
  'colorMap',
  'narrowCleanup',
  'borderSegment',
  'facetBuild',
  'facetReduce',
  'borderTrace',
  'labelPlacement',
  'svgRender',
];

const STAGE_WEIGHTS: Record<PipelineStage, number> = {
  decode: 0.06,
  kmeans: 0.3,
  colorMap: 0.03,
  narrowCleanup: 0.1,
  borderSegment: 0.07,
  facetBuild: 0.12,
  facetReduce: 0.16,
  borderTrace: 0.06,
  labelPlacement: 0.04,
  svgRender: 0.06,
};

const COLOR_OVERSAMPLE_FACTOR = 1.6;
const COLOR_OVERSAMPLE_MIN_EXTRA = 4;
const COLOR_OVERSAMPLE_MAX_EXTRA = 18;

type PipelineStage = Exclude<GeneratorStage, 'done'>;

type PaletteMergePair = {
  left: number;
  right: number;
};

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function createEmptyImageData(width: number, height: number): SimpleImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 3; index < data.length; index += 4) {
    data[index] = 255;
  }
  return { width, height, data };
}

function createProgressReporter(onProgress?: (progress: GeneratorProgress) => void) {
  const offsets = new Map<PipelineStage, number>();
  let currentOffset = 0;
  for (const stage of STAGE_ORDER) {
    offsets.set(stage, currentOffset);
    currentOffset += STAGE_WEIGHTS[stage];
  }

  return (stage: PipelineStage, localProgress: number, message: string) => {
    const offset = offsets.get(stage) ?? 0;
    const weight = STAGE_WEIGHTS[stage] ?? 0;
    const overall = Math.max(0, Math.min(1, offset + weight * Math.max(0, Math.min(1, localProgress))));
    onProgress?.({
      stage,
      progress: Math.round(overall * 100),
      message,
    });
  };
}

function addTiming(timings: GeneratorTimings, stage: GeneratorStage, elapsedMs: number): void {
  timings[stage] = (timings[stage] ?? 0) + elapsedMs;
}

function getOversampledColorCount(targetColorCount: number): number {
  if (targetColorCount <= 0) {
    return targetColorCount;
  }

  const extra = Math.min(
    COLOR_OVERSAMPLE_MAX_EXTRA,
    Math.max(COLOR_OVERSAMPLE_MIN_EXTRA, Math.ceil(targetColorCount * (COLOR_OVERSAMPLE_FACTOR - 1))),
  );
  return targetColorCount + extra;
}

function getColorMapIndexArray(colorMapResult: ColorMapResult): Uint8Array {
  return (colorMapResult.imgColorIndices as unknown as { arr: Uint8Array }).arr;
}

function labDistance(left: RGB, right: RGB): number {
  const leftLab = rgb2lab(left);
  const rightLab = rgb2lab(right);
  const dL = leftLab[0] - rightLab[0];
  const dA = leftLab[1] - rightLab[1];
  const dB = leftLab[2] - rightLab[2];
  return Math.sqrt(dL * dL + dA * dA + dB * dB);
}

function choosePaletteMergePair(colors: RGB[], counts: number[]): PaletteMergePair | null {
  let bestPair: PaletteMergePair | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const total = counts.reduce((sum, count) => sum + count, 0);

  for (let left = 0; left < colors.length; left += 1) {
    for (let right = left + 1; right < colors.length; right += 1) {
      const distance = labDistance(colors[left], colors[right]);
      const smallerShare = Math.min(counts[left], counts[right]) / Math.max(1, total);
      const largerShare = Math.max(counts[left], counts[right]) / Math.max(1, total);
      const rareAccentPenalty = distance > 18 && smallerShare < 0.025 ? 22 : 0;
      const dominantBackgroundBonus = distance < 16 && largerShare > 0.08 ? 4 : 0;
      const score = distance + rareAccentPenalty - dominantBackgroundBonus;

      if (score < bestScore) {
        bestScore = score;
        bestPair = { left, right };
      }
    }
  }

  return bestPair;
}

function mergePaletteEntry(colors: RGB[], counts: number[], left: number, right: number): { source: number; target: number } {
  const target = counts[left] >= counts[right] ? left : right;
  const source = target === left ? right : left;
  const total = counts[target] + counts[source];
  colors[target] = [
    Math.round((colors[target][0] * counts[target] + colors[source][0] * counts[source]) / total),
    Math.round((colors[target][1] * counts[target] + colors[source][1] * counts[source]) / total),
    Math.round((colors[target][2] * counts[target] + colors[source][2] * counts[source]) / total),
  ];
  counts[target] = total;
  colors.splice(source, 1);
  counts.splice(source, 1);
  return { source, target };
}

function reduceColorMapPaletteForDiversity(colorMapResult: ColorMapResult, targetColorCount: number): ColorMapResult {
  if (targetColorCount <= 0 || colorMapResult.colorsByIndex.length <= targetColorCount) {
    return colorMapResult;
  }

  const sourceIndices = getColorMapIndexArray(colorMapResult);
  const sourceColorCount = colorMapResult.colorsByIndex.length;
  const originalToCurrent = new Int32Array(sourceColorCount);
  const counts = new Array<number>(sourceColorCount).fill(0);
  for (let index = 0; index < sourceColorCount; index += 1) {
    originalToCurrent[index] = index;
  }
  for (const colorIndex of sourceIndices) {
    counts[colorIndex] += 1;
  }

  const colors = colorMapResult.colorsByIndex.map((color) => [color[0], color[1], color[2]] as RGB);
  while (colors.length > targetColorCount) {
    const pair = choosePaletteMergePair(colors, counts);
    if (pair == null) {
      break;
    }

    const { source, target } = mergePaletteEntry(colors, counts, pair.left, pair.right);
    const adjustedTarget = source < target ? target - 1 : target;
    for (let originalIndex = 0; originalIndex < originalToCurrent.length; originalIndex += 1) {
      const current = originalToCurrent[originalIndex];
      if (current === source || current === target) {
        originalToCurrent[originalIndex] = adjustedTarget;
      } else if (current > source) {
        originalToCurrent[originalIndex] = current - 1;
      }
    }
  }

  const imgColorIndices = new Uint8Array2D(colorMapResult.width, colorMapResult.height);
  const targetIndices = (imgColorIndices as unknown as { arr: Uint8Array }).arr;
  for (let index = 0; index < sourceIndices.length; index += 1) {
    targetIndices[index] = originalToCurrent[sourceIndices[index]];
  }

  const result = new ColorMapResult();
  result.imgColorIndices = imgColorIndices;
  result.colorsByIndex = colors;
  result.width = colorMapResult.width;
  result.height = colorMapResult.height;
  return result;
}

export async function generatePaintByNumbers(
  asset: ImagePickerAsset,
  settings: GeneratorSettings,
  onProgress?: (progress: GeneratorProgress) => void,
): Promise<GeneratorResult> {
  const report = createProgressReporter(onProgress);
  const timings: GeneratorTimings = {};
  const targetColorCount = Math.max(1, Math.floor(settings.kMeansNrOfClusters));
  const vendorSettings = toVendorSettings({
    ...settings,
    kMeansNrOfClusters: getOversampledColorCount(targetColorCount),
  });

  report('decode', 0, 'Bild wird vorbereitet.');
  const decodeStarted = nowMs();
  const { prepared, imageData } = await preparePickedImageForGenerator(asset, settings);
  addTiming(timings, 'decode', nowMs() - decodeStarted);
  report('decode', 1, `Bild mit ${prepared.width}x${prepared.height} Pixeln vorbereitet.`);

  const kmeansOutput = createEmptyImageData(imageData.width, imageData.height);
  const kmeansStarted = nowMs();
  await ColorReducer.applyKMeansClustering(imageData, kmeansOutput, vendorSettings, (kmeans) => {
    const delta = Math.min(100, Math.max(0, kmeans.currentDeltaDistanceDifference));
    const local = Math.max(0, Math.min(1, (100 - delta) / 100));
    report(
      'kmeans',
      local,
      `Farben werden divers gruppiert (${targetColorCount} Ziel, ${vendorSettings.kMeansNrOfClusters} Kandidaten).`,
    );
  });
  addTiming(timings, 'kmeans', nowMs() - kmeansStarted);
  report('kmeans', 1, 'Farben gruppiert.');

  const colorMapStarted = nowMs();
  const rawColorMapResult = ColorReducer.createColorMap(kmeansOutput);
  const colorMapResult = reduceColorMapPaletteForDiversity(rawColorMapResult, targetColorCount);
  addTiming(timings, 'colorMap', nowMs() - colorMapStarted);
  report('colorMap', 1, `${colorMapResult.colorsByIndex.length} Farben farbdivers vorbereitet.`);

  const rasterResult = await buildRasterPaintByNumbers(colorMapResult, settings, {
    report: (stage, localProgress, message) => report(stage, localProgress, message),
    addTiming: (stage, elapsedMs) => addTiming(timings, stage, elapsedMs),
    nowMs,
  });

  onProgress?.({
    stage: 'done',
    progress: 100,
    message: 'Malvorlage fertig.',
  });

  return {
    svg: rasterResult.svg,
    previewPngBase64: rasterResult.previewPngBase64,
    previewPngWidth: rasterResult.previewPngWidth,
    previewPngHeight: rasterResult.previewPngHeight,
    variants: rasterResult.variants,
    svgWidth: rasterResult.previewPngWidth,
    svgHeight: rasterResult.previewPngHeight,
    imageWidth: rasterResult.imageWidth,
    imageHeight: rasterResult.imageHeight,
    facetCount: rasterResult.facetCount,
    palette: rasterResult.palette,
    timings,
    preparedImage: prepared,
  };
}
