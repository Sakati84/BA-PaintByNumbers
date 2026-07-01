import { ColorReducer } from '../../vendor/paintbynumbersgenerator/colorreductionmanagement';
import { toVendorSettings } from './defaultSettings';
import type {
  GeneratorProgress,
  GeneratorResult,
  GeneratorSettings,
  GeneratorStage,
  GeneratorTimings,
  PreparedGeneratorImage,
} from './generatorTypes';
import {
  createEmptyImageData,
  mergeRedundantPaletteColors,
} from './pipelineCore';
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

type PipelineStage = Exclude<GeneratorStage, 'done'>;

export type PreparedRunOptions = {
  decodeDurationMs?: number;
  reportDecodeProgress?: boolean;
};

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
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

export async function generatePaintByNumbersFromPreparedInput(
  preparedInput: PreparedGeneratorImage,
  settings: GeneratorSettings,
  options: PreparedRunOptions = {},
  onProgress?: (progress: GeneratorProgress) => void,
): Promise<GeneratorResult> {
  const report = createProgressReporter(onProgress);
  const timings: GeneratorTimings = {};
  const targetColorCount = Math.max(1, Math.floor(settings.kMeansNrOfClusters));
  const vendorSettings = toVendorSettings({
    ...settings,
    kMeansNrOfClusters: targetColorCount,
  });
  const decodeDurationMs = options.decodeDurationMs ?? 0;
  const reportDecodeProgress = options.reportDecodeProgress ?? false;
  const { preparedImage, imageData } = preparedInput;

  if (decodeDurationMs > 0) {
    addTiming(timings, 'decode', decodeDurationMs);
  }
  if (reportDecodeProgress) {
    report('decode', 1, `Bild mit ${preparedImage.width}x${preparedImage.height} Pixeln vorbereitet.`);
  }

  const kmeansOutput = createEmptyImageData(imageData.width, imageData.height);
  const kmeansStarted = nowMs();
  await ColorReducer.applyKMeansClustering(imageData, kmeansOutput, vendorSettings, (kmeans) => {
    const delta = Math.min(100, Math.max(0, kmeans.currentDeltaDistanceDifference));
    const local = Math.max(0, Math.min(1, (100 - delta) / 100));
    report(
      'kmeans',
      local,
      `Farben werden gruppiert (${targetColorCount} Farben).`,
    );
  });
  addTiming(timings, 'kmeans', nowMs() - kmeansStarted);
  report('kmeans', 1, 'Farben gruppiert.');

  const colorMapStarted = nowMs();
  const colorMapResult = mergeRedundantPaletteColors(
    ColorReducer.createColorMap(kmeansOutput),
    settings.nearIdenticalPaletteMergeLabDistance,
  );
  addTiming(timings, 'colorMap', nowMs() - colorMapStarted);
  report('colorMap', 1, `${colorMapResult.colorsByIndex.length} K-Means-Farben gesäubert.`);

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
    preparedImage,
  };
}
