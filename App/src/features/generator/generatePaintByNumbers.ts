import type { ImagePickerAsset } from 'expo-image-picker';

import { ColorReducer } from '../../vendor/paintbynumbersgenerator/colorreductionmanagement';
import type { ColorMapResult } from '../../vendor/paintbynumbersgenerator/colorreductionmanagement';
import type { SimpleImageData } from '../../types/imageData';
import { toVendorSettings } from './defaultSettings';
import type {
  GeneratorDebugMetric,
  GeneratorDebugParameter,
  GeneratorDebugStageSnapshot,
  GeneratorOutputVariantId,
  GeneratorProgress,
  GeneratorResult,
  GeneratorSettings,
  GeneratorStage,
  GeneratorTimings,
} from './generatorTypes';
import {
  createEmptyImageData,
  mergeRedundantPaletteColors,
} from './pipelineCore';
import { preparePickedImageForGenerator } from './prepareImage';
import { buildRasterPaintByNumbers } from './rasterPaintByNumbers';
import type { RasterPipelineDebugCache } from './rasterPaintByNumbers';
import { encodeRgbaDebugImage } from './debugSnapshots';

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

export type GeneratorPipelineDebugCache = {
  prepared?: Awaited<ReturnType<typeof preparePickedImageForGenerator>>;
  kmeansOutput?: SimpleImageData;
  colorMapResult?: ColorMapResult;
  raster?: RasterPipelineDebugCache;
};

type GeneratePaintByNumbersOptions = {
  debug?: {
    enabled: boolean;
    rerunFromStage?: GeneratorStage;
    cache?: GeneratorPipelineDebugCache | null;
    onCacheUpdated?: (cache: GeneratorPipelineDebugCache) => void;
  };
  variantIds?: readonly GeneratorOutputVariantId[];
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

function stageIndex(stage: GeneratorStage): number {
  const order: GeneratorStage[] = [...STAGE_ORDER, 'done'];
  const index = order.indexOf(stage);
  return index < 0 ? 0 : index;
}

function shouldUseCachedStage(options: GeneratePaintByNumbersOptions | undefined, stage: GeneratorStage): boolean {
  const startStage = options?.debug?.rerunFromStage;
  return options?.debug?.enabled === true && startStage != null && stageIndex(stage) < stageIndex(startStage);
}

function cloneSimpleImageData(imageData: SimpleImageData): SimpleImageData {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  };
}

function clonePreparedCache(
  prepared: Awaited<ReturnType<typeof preparePickedImageForGenerator>>,
): Awaited<ReturnType<typeof preparePickedImageForGenerator>> {
  return {
    prepared: { ...prepared.prepared },
    imageData: cloneSimpleImageData(prepared.imageData),
  };
}

function colorMapToImageData(colorMapResult: ColorMapResult): SimpleImageData {
  const source = (colorMapResult.imgColorIndices as unknown as { arr: Uint8Array }).arr;
  const data = new Uint8ClampedArray(colorMapResult.width * colorMapResult.height * 4);
  for (let index = 0; index < source.length; index += 1) {
    const color = colorMapResult.colorsByIndex[source[index]] ?? [255, 255, 255];
    const offset = index * 4;
    data[offset] = Math.max(0, Math.min(255, Math.round(color[0])));
    data[offset + 1] = Math.max(0, Math.min(255, Math.round(color[1])));
    data[offset + 2] = Math.max(0, Math.min(255, Math.round(color[2])));
    data[offset + 3] = 255;
  }
  return {
    width: colorMapResult.width,
    height: colorMapResult.height,
    data,
  };
}

function debugNumberParameter(
  settings: GeneratorSettings,
  key: keyof GeneratorSettings,
  label: string,
  min: number,
  max: number,
  step: number,
  unit?: string,
  description?: string,
): GeneratorDebugParameter {
  return {
    key,
    label,
    value: Number(settings[key]),
    input: 'number',
    min,
    max,
    step,
    unit,
    description,
  };
}

function stageParameters(stage: GeneratorStage, settings: GeneratorSettings): GeneratorDebugParameter[] {
  if (stage === 'decode') {
    return [
      debugNumberParameter(settings, 'resizeImageWidth', 'Max. Breite', 128, 2048, 64, 'px'),
      debugNumberParameter(settings, 'resizeImageHeight', 'Max. Hoehe', 128, 2048, 64, 'px'),
    ];
  }

  if (stage === 'kmeans') {
    return [
      debugNumberParameter(settings, 'kMeansNrOfClusters', 'Farbcluster', 2, 48, 1, 'Farben'),
      debugNumberParameter(settings, 'kMeansMinDeltaDifference', 'Min. Delta', 0.1, 10, 0.1),
      debugNumberParameter(settings, 'randomSeed', 'Random Seed', 0, 999999, 1),
    ];
  }

  if (stage === 'colorMap') {
    return [
      debugNumberParameter(
        settings,
        'nearIdenticalPaletteMergeLabDistance',
        'Palette-Merge LAB',
        0,
        20,
        0.25,
        'DeltaE',
        'Hoeherer Wert merged fast identische Farben aggressiver.',
      ),
    ];
  }

  return [];
}

async function pushDebugSnapshot(
  snapshots: GeneratorDebugStageSnapshot[] | null,
  stage: GeneratorStage,
  label: string,
  description: string,
  settings: GeneratorSettings,
  metrics: GeneratorDebugMetric[],
  imageData: SimpleImageData | undefined,
  timingMs: number | undefined,
  cacheHit = false,
): Promise<void> {
  if (snapshots == null) {
    return;
  }

  snapshots.push({
    stage,
    label,
    description,
    parameters: stageParameters(stage, settings),
    metrics,
    image: imageData == null
      ? undefined
      : await encodeRgbaDebugImage(label, imageData.width, imageData.height, imageData.data),
    timingMs,
    canRerunFromHere: true,
    cacheHit,
  });
}

export async function generatePaintByNumbers(
  asset: ImagePickerAsset,
  settings: GeneratorSettings,
  onProgress?: (progress: GeneratorProgress) => void,
  options: GeneratePaintByNumbersOptions = {},
): Promise<GeneratorResult> {
  const report = createProgressReporter(onProgress);
  const timings: GeneratorTimings = {};
  const targetColorCount = Math.max(1, Math.floor(settings.kMeansNrOfClusters));
  const vendorSettings = toVendorSettings({
    ...settings,
    kMeansNrOfClusters: targetColorCount,
  });
  const debugEnabled = options.debug?.enabled === true;
  const debugSnapshots: GeneratorDebugStageSnapshot[] | null = debugEnabled ? [] : null;
  const previousCache = options.debug?.cache ?? null;
  const nextCache: GeneratorPipelineDebugCache = {};

  let prepared: Awaited<ReturnType<typeof preparePickedImageForGenerator>>['prepared'];
  let imageData: SimpleImageData;
  if (shouldUseCachedStage(options, 'decode') && previousCache?.prepared != null) {
    const cached = clonePreparedCache(previousCache.prepared);
    prepared = cached.prepared;
    imageData = cached.imageData;
    nextCache.prepared = clonePreparedCache(cached);
    addTiming(timings, 'decode', 0);
    report('decode', 1, 'Vorbereitetes Bild aus Debug-Cache übernommen.');
    await pushDebugSnapshot(
      debugSnapshots,
      'decode',
      'Decode',
      'Normalisiertes Eingabebild nach Resize und Alpha-Flattening.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Arbeitsgroesse', value: `${imageData.width} x ${imageData.height} px` },
      ],
      imageData,
      0,
      true,
    );
  } else {
    report('decode', 0, 'Bild wird vorbereitet.');
    const decodeStarted = nowMs();
    const decoded = await preparePickedImageForGenerator(asset, settings);
    prepared = decoded.prepared;
    imageData = decoded.imageData;
    const timingMs = nowMs() - decodeStarted;
    addTiming(timings, 'decode', timingMs);
    report('decode', 1, `Bild mit ${prepared.width}x${prepared.height} Pixeln vorbereitet.`);
    nextCache.prepared = clonePreparedCache(decoded);
    await pushDebugSnapshot(
      debugSnapshots,
      'decode',
      'Decode',
      'Normalisiertes Eingabebild nach Resize und Alpha-Flattening.',
      settings,
      [
        { label: 'Arbeitsgroesse', value: `${imageData.width} x ${imageData.height} px` },
        { label: 'Resize-Limit', value: `${settings.resizeImageWidth} x ${settings.resizeImageHeight} px` },
      ],
      imageData,
      timingMs,
    );
  }

  let kmeansOutput: SimpleImageData;
  if (shouldUseCachedStage(options, 'kmeans') && previousCache?.kmeansOutput != null) {
    kmeansOutput = cloneSimpleImageData(previousCache.kmeansOutput);
    nextCache.kmeansOutput = cloneSimpleImageData(kmeansOutput);
    addTiming(timings, 'kmeans', 0);
    report('kmeans', 1, 'K-Means-Ergebnis aus Debug-Cache übernommen.');
    await pushDebugSnapshot(
      debugSnapshots,
      'kmeans',
      'K-Means',
      'Quantisiertes Bild nach LAB-K-Means.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Ziel-Farben', value: String(targetColorCount) },
      ],
      kmeansOutput,
      0,
      true,
    );
  } else {
    kmeansOutput = createEmptyImageData(imageData.width, imageData.height);
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
    const timingMs = nowMs() - kmeansStarted;
    addTiming(timings, 'kmeans', timingMs);
    report('kmeans', 1, 'Farben gruppiert.');
    nextCache.kmeansOutput = cloneSimpleImageData(kmeansOutput);
    await pushDebugSnapshot(
      debugSnapshots,
      'kmeans',
      'K-Means',
      'Quantisiertes Bild nach LAB-K-Means.',
      settings,
      [
        { label: 'Ziel-Farben', value: String(targetColorCount) },
        { label: 'Min. Delta', value: String(settings.kMeansMinDeltaDifference) },
        { label: 'Seed', value: String(settings.randomSeed) },
      ],
      kmeansOutput,
      timingMs,
    );
  }

  let colorMapResult: ColorMapResult;
  if (shouldUseCachedStage(options, 'colorMap') && previousCache?.colorMapResult != null) {
    colorMapResult = previousCache.colorMapResult;
    nextCache.colorMapResult = colorMapResult;
    addTiming(timings, 'colorMap', 0);
    report('colorMap', 1, 'Farbkarte aus Debug-Cache übernommen.');
    await pushDebugSnapshot(
      debugSnapshots,
      'colorMap',
      'Color Map',
      'Labelkarte nach Palette-Merge fast identischer Farben.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Palette', value: String(colorMapResult.colorsByIndex.length) },
      ],
      colorMapToImageData(colorMapResult),
      0,
      true,
    );
  } else {
    const colorMapStarted = nowMs();
    const rawColorMapResult = ColorReducer.createColorMap(kmeansOutput);
    colorMapResult = mergeRedundantPaletteColors(
      rawColorMapResult,
      settings.nearIdenticalPaletteMergeLabDistance,
    );
    const timingMs = nowMs() - colorMapStarted;
    addTiming(timings, 'colorMap', timingMs);
    report('colorMap', 1, `${colorMapResult.colorsByIndex.length} K-Means-Farben gesäubert.`);
    nextCache.colorMapResult = colorMapResult;
    await pushDebugSnapshot(
      debugSnapshots,
      'colorMap',
      'Color Map',
      'Labelkarte nach Palette-Merge fast identischer Farben.',
      settings,
      [
        { label: 'Palette vorher', value: String(rawColorMapResult.colorsByIndex.length) },
        { label: 'Palette nach Merge', value: String(colorMapResult.colorsByIndex.length) },
        { label: 'Merge-Distanz', value: String(settings.nearIdenticalPaletteMergeLabDistance) },
      ],
      colorMapToImageData(colorMapResult),
      timingMs,
    );
  }

  const rasterResult = await buildRasterPaintByNumbers(colorMapResult, settings, {
    report: (stage, localProgress, message) => report(stage, localProgress, message),
    addTiming: (stage, elapsedMs) => addTiming(timings, stage, elapsedMs),
    nowMs,
    variantIds: options.variantIds,
    debug: debugEnabled
      ? {
          enabled: true,
          rerunFromStage: options.debug?.rerunFromStage,
          cache: previousCache?.raster,
          snapshots: debugSnapshots ?? [],
        }
      : undefined,
  });
  nextCache.raster = rasterResult.debugCache;
  if (debugEnabled) {
    options.debug?.onCacheUpdated?.(nextCache);
  }

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
    debug: debugEnabled
      ? {
          enabled: true,
          rerunFromStage: options.debug?.rerunFromStage,
          finalVariantId: options.variantIds?.[0] ?? 'brightColorCircles',
          parameterConfig: { ...settings },
          stages: debugSnapshots ?? [],
        }
      : undefined,
  };
}
