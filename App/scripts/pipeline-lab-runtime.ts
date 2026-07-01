import { ColorReducer } from '../src/vendor/paintbynumbersgenerator/colorreductionmanagement';
import type { SimpleImageData } from '../src/types/imageData';
import { toVendorSettings } from '../src/features/generator/defaultSettings';
import type {
  GeneratorOutputVariant,
  GeneratorOutputVariantId,
  GeneratorResult,
  GeneratorSettings,
  GeneratorStage,
  GeneratorTimings,
  PreparedImage,
} from '../src/features/generator/generatorTypes';
import {
  createEmptyImageData,
  mergeRedundantPaletteColors,
} from '../src/features/generator/pipelineCore';
import { buildRasterPaintByNumbers } from '../src/features/generator/rasterPaintByNumbers';
import {
  DEFAULT_SETTINGS,
  settingsForColorCount,
  settingsForComplexity,
  type ComplexityPreset,
} from '../../react-app/src/lib/settings';

export type PipelineLabConfigInput = {
  id?: string;
  label?: string;
  description?: string;
  colorCount?: number;
  difficulty?: 'easy' | 'medium' | 'expert' | 'simple' | 'detailed';
  settings?: Partial<GeneratorSettings>;
};

export type PipelineLabResolvedConfig = {
  id: string;
  label: string;
  description: string | null;
  colorCount: number;
  difficulty: string | null;
  settings: GeneratorSettings;
};

export type PipelineLabPreparedImage = {
  imageUri: string;
  width: number;
  height: number;
  fileName?: string | null;
  mimeType?: string | null;
};

export type PipelineLabRunResult = Omit<GeneratorResult, 'preparedImage'> & {
  preparedImage: PreparedImage;
  variants: GeneratorOutputVariant[];
};

export type PipelineLabRunOptions = {
  variantIds?: readonly GeneratorOutputVariantId[];
};

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function addTiming(timings: GeneratorTimings, stage: GeneratorStage, elapsedMs: number): void {
  timings[stage] = (timings[stage] ?? 0) + elapsedMs;
}

function complexityForDifficulty(difficulty: PipelineLabConfigInput['difficulty']): ComplexityPreset | null {
  if (difficulty === 'easy' || difficulty === 'simple') {
    return 'simple';
  }
  if (difficulty === 'medium') {
    return 'medium';
  }
  if (difficulty === 'expert' || difficulty === 'detailed') {
    return 'detailed';
  }
  return null;
}

function defaultColorCountForDifficulty(difficulty: PipelineLabConfigInput['difficulty']): number | null {
  if (difficulty === 'easy' || difficulty === 'simple') {
    return 8;
  }
  if (difficulty === 'medium') {
    return 12;
  }
  if (difficulty === 'expert' || difficulty === 'detailed') {
    return 24;
  }
  return null;
}

export function resolvePipelineLabConfig(input: PipelineLabConfigInput): PipelineLabResolvedConfig {
  const difficulty = input.difficulty;
  const complexity = complexityForDifficulty(difficulty);
  const colorCount = Math.round(input.colorCount ?? defaultColorCountForDifficulty(difficulty) ?? DEFAULT_SETTINGS.kMeansNrOfClusters);
  const baseSettings = complexity == null && input.colorCount == null
    ? DEFAULT_SETTINGS
    : complexity == null
      ? settingsForColorCount(colorCount)
      : settingsForComplexity(complexity);
  const settings: GeneratorSettings = {
    ...baseSettings,
    kMeansNrOfClusters: colorCount,
    ...input.settings,
  };

  return {
    id: input.id ?? `colors-${settings.kMeansNrOfClusters}`,
    label: input.label ?? input.id ?? `${settings.kMeansNrOfClusters} colors`,
    description: input.description ?? null,
    colorCount: settings.kMeansNrOfClusters,
    difficulty: difficulty ?? null,
    settings,
  };
}

export async function runPipelineLabImage(
  imageData: SimpleImageData,
  settings: GeneratorSettings,
  preparedImage: PipelineLabPreparedImage,
  options: PipelineLabRunOptions = {},
): Promise<PipelineLabRunResult> {
  const timings: GeneratorTimings = {};
  const targetColorCount = Math.max(1, Math.floor(settings.kMeansNrOfClusters));
  const vendorSettings = toVendorSettings({
    ...settings,
    kMeansNrOfClusters: targetColorCount,
  });

  const kmeansOutput = createEmptyImageData(imageData.width, imageData.height);
  const kmeansStarted = nowMs();
  await ColorReducer.applyKMeansClustering(imageData, kmeansOutput, vendorSettings);
  addTiming(timings, 'kmeans', nowMs() - kmeansStarted);

  const colorMapStarted = nowMs();
  const colorMapResult = mergeRedundantPaletteColors(
    ColorReducer.createColorMap(kmeansOutput),
    settings.nearIdenticalPaletteMergeLabDistance,
  );
  addTiming(timings, 'colorMap', nowMs() - colorMapStarted);

  const rasterResult = await buildRasterPaintByNumbers(colorMapResult, settings, {
    report: () => {},
    addTiming: (stage, elapsedMs) => addTiming(timings, stage, elapsedMs),
    nowMs,
    variantIds: options.variantIds,
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
    preparedImage: {
      imageUri: preparedImage.imageUri,
      width: preparedImage.width,
      height: preparedImage.height,
      fileName: preparedImage.fileName ?? null,
      mimeType: preparedImage.mimeType ?? 'image/png',
    },
  };
}
