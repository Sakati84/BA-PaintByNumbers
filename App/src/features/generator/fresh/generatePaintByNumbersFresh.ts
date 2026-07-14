import '../textDecoderCompatibility';
import { encode } from 'fast-png';

import type { SimpleImageData } from '../../../types/imageData';
import { uint8ToBase64 } from '../base64';
import type {
  GeneratorDebugImage,
  GeneratorDebugMetric,
  GeneratorDebugParameter,
  GeneratorDebugStageSnapshot,
  GeneratorOutputVariant,
  GeneratorOutputVariantId,
  GeneratorProgress,
  GeneratorResult,
  GeneratorSettings,
  GeneratorStage,
  GeneratorTimings,
  PaletteStat,
  PreparedImage,
} from '../generatorTypes';
import { encodeRgbaDebugImage } from '../debugSnapshots';
import { renderFreshVectorSvg } from './freshVectorRenderer';

const WORK_MAX_EDGE = 1400;
const FRESH_PIPELINE_CACHE_VERSION = 4;
const TOKEN_CHROMA_RANGE = 96;
const PALETTE_WEIGHT_POWER = 0.78;
const MAJORITY_FILTER_RUNS = 2;
const POST_MAJORITY_FILTER_RUNS = 1;
const FINAL_MAJORITY_FILTER_RUNS = 1;
const EASY_MIN_REGION_RATIO = 0.00022;
const MEDIUM_MIN_REGION_RATIO = 0.00014;
const EXPERT_MIN_REGION_RATIO = 0.000012;
const EASY_MIN_REGION_PIXELS = 220;
const MEDIUM_MIN_REGION_PIXELS = 130;
const EXPERT_MIN_REGION_PIXELS = 18;
const TINY_MERGE_PASSES = 12;
const SPECKLE_REGION_PIXELS = 48;
const FINAL_SPECKLE_PASSES = 8;
const DETAIL_PROTECT_MIN_PIXELS = 80;
const DETAIL_PROTECT_LAB_DISTANCE = 26;
const DETAIL_SPECKLE_PROTECT_MIN_PIXELS = 18;
const DETAIL_SPECKLE_PROTECT_LAB_DISTANCE = 34;
const EASY_LANDMARK_MIN_PIXELS = 12;
const EASY_LANDMARK_MAX_COUNT = 12;
const EASY_LANDMARK_MAX_AREA_MULTIPLIER = 2.5;
const EASY_LANDMARK_MAX_SPAN = 72;
const EASY_LANDMARK_MIN_FILL_RATIO = 0.28;
const EASY_LANDMARK_MAX_ASPECT_RATIO = 3.2;
const EASY_LANDMARK_MIN_ENCLOSURE = 0.55;
const EASY_LANDMARK_MIN_COMPACTNESS = 0.08;
const EASY_LANDMARK_MIN_SOURCE_LAB_DISTANCE = 20;
const EASY_LANDMARK_MAX_PALETTE_LAB_DISTANCE = 32;
const EASY_LANDMARK_MIN_OUTPUT_LAB_DISTANCE = 12;
const SOURCE_AWARE_MAJORITY_RGB_TOLERANCE = 22;
const SOURCE_AWARE_MAJORITY_ABSOLUTE_RGB_LIMIT = 46;
const SOURCE_MERGE_MAX_LAB_DISTANCE = 28;
const SOURCE_TINY_MERGE_MAX_LAB_DISTANCE = 34;
const SOURCE_GLOBAL_REASSIGN_MAX_LAB_DISTANCE = 24;
const SOURCE_GLOBAL_REASSIGN_MIN_IMPROVEMENT = 5;
const PALETTE_REINTRO_MAX_LAB_DISTANCE = 22;
const PALETTE_REINTRO_MIN_IMPROVEMENT = 2;
const MAX_FACET_BUDGET_PASSES = 16;
const BOUNDARY_ALPHA = 0.82;
const BOUNDARY_SOFT_ALPHA = 0.22;
const OUTLINE_R = 22;
const OUTLINE_G = 29;
const OUTLINE_B = 31;
const WHITE_R = 250;
const WHITE_G = 252;
const WHITE_B = 249;

const DEFAULT_FRESH_OUTPUT_VARIANT_IDS: readonly GeneratorOutputVariantId[] = [
  'cleanColor',
  'coloredEdges',
  'coloredEdgesWithDots',
  'circlesOnly',
];

type PipelineStage = Exclude<GeneratorStage, 'done'>;
type LabelMap = Uint8Array;
type TokenLabelMap = Uint16Array;

type TokenPolicy = {
  lumaBins: number;
  chromaBins: number;
  colorCount: number;
};

export type PreparedFreshGeneratorImage = {
  prepared: PreparedImage;
  imageData: SimpleImageData;
};

const STAGE_WEIGHTS: Record<PipelineStage, number> = {
  decode: 0.08,
  kmeans: 0.32,
  colorMap: 0.08,
  narrowCleanup: 0.08,
  borderSegment: 0.04,
  facetBuild: 0.14,
  facetReduce: 0.14,
  borderTrace: 0.04,
  labelPlacement: 0.01,
  svgRender: 0.07,
};

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

type FreshLabelDebugState = {
  labelMap: LabelMap;
  paletteRgb: Float32Array;
};

type FreshRegionDebugState = {
  paletteRgb: Float32Array;
  components: Components;
};

export type GeneratorPipelineDebugCache = {
  version: number;
  sourceKey: string;
  signatures: Partial<Record<PipelineStage, string>>;
  decoded?: PreparedFreshGeneratorImage;
  smoothed?: Uint8ClampedArray;
  tokenComponents?: Components;
  colorMap?: FreshLabelDebugState;
  afterNarrowCleanup?: FreshLabelDebugState;
  afterBorderSegment?: FreshLabelDebugState;
  beforeFacetReduce?: FreshRegionDebugState;
  afterFacetReduce?: FreshRegionDebugState;
  markerPlacements?: MarkerPlacement[];
};

export type GeneratePaintByNumbersOptions = {
  debug?: {
    enabled: boolean;
    rerunFromStage?: GeneratorStage;
    cache?: GeneratorPipelineDebugCache | null;
    onCacheUpdated?: (cache: GeneratorPipelineDebugCache) => void;
  };
  onStageSnapshot?: (snapshot: GeneratorDebugStageSnapshot) => void;
  variantIds?: readonly GeneratorOutputVariantId[];
  shouldCancel?: () => boolean;
  preparedDecodeDurationMs?: number;
  cacheSourceKey?: string;
};

type Components = {
  componentMap: Int32Array;
  labels: Int32Array;
  areas: Int32Array;
  meanRgb: Float32Array;
  minX: Int32Array;
  minY: Int32Array;
  maxX: Int32Array;
  maxY: Int32Array;
};

type MergeResult = {
  labelMap: LabelMap;
  mergeCount: number;
  globalReassignCount: number;
  componentCount: number;
  smallRemaining: number;
  protectedSmall: number;
};

type FacetBudgetResult = {
  labelMap: LabelMap;
  mergeCount: number;
  componentCount: number;
  satisfied: boolean;
};

type EasyLandmarkCandidate = {
  componentId: number;
  area: number;
  sourceContrast: number;
  enclosure: number;
  compactness: number;
  score: number;
};

type EasyLandmarkRestoreResult = {
  labelMap: LabelMap;
  candidateCount: number;
  restoredCount: number;
  restoredPixelCount: number;
};

type Rgb = [number, number, number];

type FreshRenderFillMode = 'color' | 'white';
type FreshRenderBoundaryMode = 'none' | 'black' | 'color';
type FreshRenderMarkerMode = 'none' | 'circles';

type FreshRenderConfig = {
  id: GeneratorOutputVariantId;
  label: string;
  description: string;
  fillMode: FreshRenderFillMode;
  boundaryMode: FreshRenderBoundaryMode;
  markerMode: FreshRenderMarkerMode;
  isDefault?: boolean;
};

type MarkerPlacement = {
  regionId: number;
  colorIndex: number;
  x: number;
  y: number;
  radius: number;
};

const FRESH_RENDER_VARIANTS: FreshRenderConfig[] = [
  {
    id: 'cleanColor',
    label: 'Fresh Clean',
    description: 'Region-First-Farbflächen ohne Grenzen oder Marker.',
    fillMode: 'color',
    boundaryMode: 'none',
    markerMode: 'none',
    isDefault: true,
  },
  {
    id: 'coloredEdges',
    label: 'Farbige Kanten',
    description: 'Weiße Vorlage mit farbigen Regionenkanten.',
    fillMode: 'white',
    boundaryMode: 'color',
    markerMode: 'none',
  },
  {
    id: 'coloredEdgesWithDots',
    label: 'Farbige Kanten + Kreise',
    description: 'Weiße Vorlage mit farbigen Regionenkanten und Farbpunkten.',
    fillMode: 'white',
    boundaryMode: 'color',
    markerMode: 'circles',
  },
  {
    id: 'circlesOnly',
    label: 'Nur Kreise',
    description: 'Weiße Vorlage mit schwarzen Regionenkanten und Farbkreisen.',
    fillMode: 'white',
    boundaryMode: 'black',
    markerMode: 'circles',
  },
  {
    id: 'classic',
    label: 'Fresh Classic',
    description: 'Region-First-Farbflächen mit geglätteten schwarzen Grenzen.',
    fillMode: 'color',
    boundaryMode: 'black',
    markerMode: 'none',
  },
];

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function nowYield(): Promise<void> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout;
    if (typeof timer === 'function') {
      timer(resolve, 0);
      return;
    }
    resolve();
  });
}

async function yieldAndCheckCancellation(options: GeneratePaintByNumbersOptions): Promise<void> {
  await nowYield();
  if (options.shouldCancel?.() === true) {
    throw new Error('Fresh pipeline run was cancelled.');
  }
}

function finiteInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizedFreshSettings(settings: GeneratorSettings): GeneratorSettings {
  return {
    ...settings,
    kMeansNrOfClusters: finiteInteger(settings.kMeansNrOfClusters, 12, 1, 64),
    narrowPixelStripCleanupRuns: finiteInteger(settings.narrowPixelStripCleanupRuns, 0, 0, 16),
    nrOfTimesToHalveBorderSegments: finiteInteger(settings.nrOfTimesToHalveBorderSegments, 0, 0, 16),
    maximumNumberOfFacets: finiteInteger(settings.maximumNumberOfFacets, 0, 0, 50000),
    resizeImageWidth: finiteInteger(settings.resizeImageWidth, WORK_MAX_EDGE, 1, WORK_MAX_EDGE),
    resizeImageHeight: finiteInteger(settings.resizeImageHeight, WORK_MAX_EDGE, 1, WORK_MAX_EDGE),
    randomSeed: finiteInteger(settings.randomSeed, 7707, 0, 0x7fffffff),
    removeFacetsSmallerThanImageRatio: Number.isFinite(settings.removeFacetsSmallerThanImageRatio)
      ? Math.max(0, Math.min(0.05, settings.removeFacetsSmallerThanImageRatio))
      : 0,
  };
}

function sourceKeyForPrepared(prepared: PreparedFreshGeneratorImage): string {
  return [
    prepared.prepared.imageUri,
    prepared.imageData.width,
    prepared.imageData.height,
    prepared.prepared.fileName ?? '',
  ].join('|');
}

function signature(parts: readonly (string | number | boolean)[]): string {
  return parts.join('|');
}

export function freshDecodeCacheSignature(sourceKey: string, requestedSettings: GeneratorSettings): string {
  const settings = normalizedFreshSettings(requestedSettings);
  return signature([
    FRESH_PIPELINE_CACHE_VERSION,
    sourceKey,
    settings.resizeImageWidth,
    settings.resizeImageHeight,
  ]);
}

export function getReusableFreshDecodedInput(
  cache: GeneratorPipelineDebugCache | null | undefined,
  sourceKey: string,
  settings: GeneratorSettings,
  rerunFromStage: GeneratorStage | undefined,
): PreparedFreshGeneratorImage | null {
  if (
    rerunFromStage == null
    || stageIndex('decode') >= stageIndex(rerunFromStage)
    || cache?.version !== FRESH_PIPELINE_CACHE_VERSION
    || cache.sourceKey !== sourceKey
    || cache.signatures.decode !== freshDecodeCacheSignature(sourceKey, settings)
  ) {
    return null;
  }
  return cache.decoded ?? null;
}

function assertValidLabelMap(
  labelMap: LabelMap,
  colorCount: number,
  width: number,
  height: number,
  stage: string,
): void {
  if (labelMap.length !== width * height) {
    throw new Error(`${stage}: label map length does not match image dimensions.`);
  }
  for (let index = 0; index < labelMap.length; index += 1) {
    if (labelMap[index] >= colorCount) {
      throw new Error(`${stage}: label ${labelMap[index]} at pixel ${index} exceeds palette size ${colorCount}.`);
    }
  }
}

function assertValidComponents(components: Components, pixelCount: number, stage: string): void {
  let areaSum = 0;
  for (const area of components.areas) {
    areaSum += area;
  }
  if (areaSum !== pixelCount) {
    throw new Error(`${stage}: connected-component coverage is ${areaSum}/${pixelCount} pixels.`);
  }
  for (let index = 0; index < components.componentMap.length; index += 1) {
    const componentId = components.componentMap[index];
    if (componentId < 0 || componentId >= components.labels.length) {
      throw new Error(`${stage}: invalid component ${componentId} at pixel ${index}.`);
    }
  }
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
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
    const progress = Math.max(0, Math.min(1, offset + weight * Math.max(0, Math.min(1, localProgress))));
    onProgress?.({
      stage,
      progress: Math.round(progress * 100),
      message,
    });
  };
}

function addTiming(timings: GeneratorTimings, stage: GeneratorStage, startedAt: number): void {
  timings[stage] = (timings[stage] ?? 0) + (nowMs() - startedAt);
}

function regionPolicyForColorCount(colorCount: number): {
  minRegionRatio: number;
  minRegionPixels: number;
  detailProtectMinPixels: number;
} {
  if (colorCount <= 11) {
    return {
      minRegionRatio: EASY_MIN_REGION_RATIO,
      minRegionPixels: EASY_MIN_REGION_PIXELS,
      detailProtectMinPixels: DETAIL_PROTECT_MIN_PIXELS,
    };
  }

  if (colorCount <= 17) {
    return {
      minRegionRatio: MEDIUM_MIN_REGION_RATIO,
      minRegionPixels: MEDIUM_MIN_REGION_PIXELS,
      detailProtectMinPixels: Math.round(DETAIL_PROTECT_MIN_PIXELS * 0.8),
    };
  }

  return {
    minRegionRatio: EXPERT_MIN_REGION_RATIO,
    minRegionPixels: EXPERT_MIN_REGION_PIXELS,
    detailProtectMinPixels: Math.round(DETAIL_PROTECT_MIN_PIXELS * 0.7),
  };
}

function edgePreservingSmooth(image: SimpleImageData): Uint8ClampedArray {
  const { width, height, data } = image;
  const output = new Uint8ClampedArray(data.length);
  const colorThresholdSquared = 34 * 34 * 3;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const centerR = data[offset];
      const centerG = data[offset + 1];
      const centerB = data[offset + 2];
      let sumR = centerR * 3;
      let sumG = centerG * 3;
      let sumB = centerB * 3;
      let weight = 3;

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          if (nx < 0 || nx >= width) {
            continue;
          }
          const neighborOffset = (ny * width + nx) * 4;
          const dr = data[neighborOffset] - centerR;
          const dg = data[neighborOffset + 1] - centerG;
          const db = data[neighborOffset + 2] - centerB;
          if (dr * dr + dg * dg + db * db > colorThresholdSquared) {
            continue;
          }
          sumR += data[neighborOffset];
          sumG += data[neighborOffset + 1];
          sumB += data[neighborOffset + 2];
          weight += 1;
        }
      }

      output[offset] = Math.round(sumR / weight);
      output[offset + 1] = Math.round(sumG / weight);
      output[offset + 2] = Math.round(sumB / weight);
      output[offset + 3] = 255;
    }
  }

  return output;
}

function tokenPolicyForColorCount(colorCount: number): TokenPolicy {
  const [lumaBins, chromaBins] = colorCount <= 11
    ? [10, 5]
    : colorCount <= 17
      ? [14, 7]
      : [18, 9];
  return {
    lumaBins,
    chromaBins,
    colorCount: lumaBins * chromaBins * chromaBins,
  };
}

function quantizeTokenChroma(value: number, bins: number): number {
  const normalized = (Math.max(-TOKEN_CHROMA_RANGE, Math.min(TOKEN_CHROMA_RANGE, value)) + TOKEN_CHROMA_RANGE)
    / (TOKEN_CHROMA_RANGE * 2);
  return Math.min(bins - 1, Math.floor(normalized * bins));
}

function tokenForRgb(data: Uint8ClampedArray, offset: number, policy: TokenPolicy): number {
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const luma = (r + g * 2 + b) / 4;
  const orangeBlue = r - b;
  const greenMagenta = g - (r + b) / 2;
  const lumaBin = Math.min(policy.lumaBins - 1, Math.floor((luma * policy.lumaBins) / 256));
  const orangeBlueBin = quantizeTokenChroma(orangeBlue, policy.chromaBins);
  const greenMagentaBin = quantizeTokenChroma(greenMagenta, policy.chromaBins);
  return (lumaBin * policy.chromaBins + orangeBlueBin) * policy.chromaBins + greenMagentaBin;
}

function buildTokenLabels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  policy: TokenPolicy,
): TokenLabelMap {
  const labels = new Uint16Array(width * height);
  for (let index = 0; index < labels.length; index += 1) {
    labels[index] = tokenForRgb(data, index * 4, policy);
  }
  return labels;
}

function connectedComponentsForLabels(
  labelMap: LabelMap | TokenLabelMap,
  labelCount: number,
  width: number,
  height: number,
  rgbData?: Uint8ClampedArray,
): Components {
  const pixelCount = width * height;
  const componentMap = new Int32Array(pixelCount);
  componentMap.fill(-1);
  const queue = new Int32Array(pixelCount);
  const labels: number[] = [];
  const areas: number[] = [];
  const meanRgb: number[] = [];
  const minX: number[] = [];
  const minY: number[] = [];
  const maxX: number[] = [];
  const maxY: number[] = [];

  for (let start = 0; start < pixelCount; start += 1) {
    if (componentMap[start] !== -1) {
      continue;
    }
    const sourceLabel = labelMap[start];
    if (sourceLabel < 0 || sourceLabel >= labelCount) {
      continue;
    }

    const componentId = labels.length;
    let head = 0;
    let tail = 0;
    let area = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let componentMinX = width;
    let componentMinY = height;
    let componentMaxX = 0;
    let componentMaxY = 0;
    queue[tail] = start;
    tail += 1;
    componentMap[start] = componentId;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      area += 1;
      if (rgbData != null) {
        const offset = index * 4;
        sumR += rgbData[offset];
        sumG += rgbData[offset + 1];
        sumB += rgbData[offset + 2];
      }

      const x = index % width;
      const y = Math.floor(index / width);
      componentMinX = Math.min(componentMinX, x);
      componentMinY = Math.min(componentMinY, y);
      componentMaxX = Math.max(componentMaxX, x);
      componentMaxY = Math.max(componentMaxY, y);
      const up = index - width;
      const down = index + width;
      const left = index - 1;
      const right = index + 1;
      if (up >= 0 && componentMap[up] === -1 && labelMap[up] === sourceLabel) {
        componentMap[up] = componentId;
        queue[tail] = up;
        tail += 1;
      }
      if (down < pixelCount && componentMap[down] === -1 && labelMap[down] === sourceLabel) {
        componentMap[down] = componentId;
        queue[tail] = down;
        tail += 1;
      }
      if (x > 0 && componentMap[left] === -1 && labelMap[left] === sourceLabel) {
        componentMap[left] = componentId;
        queue[tail] = left;
        tail += 1;
      }
      if (x + 1 < width && componentMap[right] === -1 && labelMap[right] === sourceLabel) {
        componentMap[right] = componentId;
        queue[tail] = right;
        tail += 1;
      }
    }

    labels.push(sourceLabel);
    areas.push(area);
    meanRgb.push(
      area > 0 ? sumR / area : 255,
      area > 0 ? sumG / area : 255,
      area > 0 ? sumB / area : 255,
    );
    minX.push(componentMinX);
    minY.push(componentMinY);
    maxX.push(componentMaxX);
    maxY.push(componentMaxY);
  }

  return {
    componentMap,
    labels: Int32Array.from(labels),
    areas: Int32Array.from(areas),
    meanRgb: Float32Array.from(meanRgb),
    minX: Int32Array.from(minX),
    minY: Int32Array.from(minY),
    maxX: Int32Array.from(maxX),
    maxY: Int32Array.from(maxY),
  };
}

function pivotRgb(value: number): number {
  const normalized = value / 255;
  return normalized > 0.04045 ? ((normalized + 0.055) / 1.055) ** 2.4 : normalized / 12.92;
}

function pivotXyz(value: number): number {
  return value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
}

function rgbToLab(r: number, g: number, b: number): Rgb {
  const linearR = pivotRgb(r);
  const linearG = pivotRgb(g);
  const linearB = pivotRgb(b);
  const x = (linearR * 0.4124 + linearG * 0.3576 + linearB * 0.1805) / 0.95047;
  const y = linearR * 0.2126 + linearG * 0.7152 + linearB * 0.0722;
  const z = (linearR * 0.0193 + linearG * 0.1192 + linearB * 0.9505) / 1.08883;
  const fx = pivotXyz(x);
  const fy = pivotXyz(y);
  const fz = pivotXyz(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDistance(left: Float32Array, leftIndex: number, right: Float32Array, rightIndex: number): number {
  const leftOffset = leftIndex * 3;
  const rightOffset = rightIndex * 3;
  const dL = left[leftOffset] - right[rightOffset];
  const dA = left[leftOffset + 1] - right[rightOffset + 1];
  const dB = left[leftOffset + 2] - right[rightOffset + 2];
  return Math.sqrt(dL * dL + dA * dA + dB * dB);
}

function rgbDistanceToPalette(
  sourceRgbData: Uint8ClampedArray,
  pixelOffset: number,
  paletteRgb: Float32Array,
  label: number,
): number {
  const paletteOffset = label * 3;
  const dR = sourceRgbData[pixelOffset] - (paletteRgb[paletteOffset] ?? 255);
  const dG = sourceRgbData[pixelOffset + 1] - (paletteRgb[paletteOffset + 1] ?? 255);
  const dB = sourceRgbData[pixelOffset + 2] - (paletteRgb[paletteOffset + 2] ?? 255);
  return Math.sqrt(dR * dR + dG * dG + dB * dB);
}

function componentLabColors(meanRgb: Float32Array): Float32Array {
  const lab = new Float32Array(meanRgb.length);
  for (let index = 0; index < meanRgb.length / 3; index += 1) {
    const offset = index * 3;
    const color = rgbToLab(meanRgb[offset], meanRgb[offset + 1], meanRgb[offset + 2]);
    lab[offset] = color[0];
    lab[offset + 1] = color[1];
    lab[offset + 2] = color[2];
  }
  return lab;
}

function weightedPaletteKMeans(
  meanRgb: Float32Array,
  areas: Int32Array,
  colorCount: number,
  seed: number,
): { componentLabels: LabelMap; paletteRgb: Float32Array } {
  const componentCount = areas.length;
  if (componentCount === 0) {
    throw new Error('Fresh palette learning requires at least one connected component.');
  }
  const actualColorCount = Math.max(1, Math.min(colorCount, componentCount));
  const componentLab = componentLabColors(meanRgb);
  const weights = new Float32Array(componentCount);
  let firstCenter = 0;
  for (let index = 0; index < componentCount; index += 1) {
    weights[index] = Math.max(1, areas[index]) ** PALETTE_WEIGHT_POWER;
    if (areas[index] > areas[firstCenter]) {
      firstCenter = index;
    }
  }

  const centers = new Float32Array(actualColorCount * 3);
  centers[0] = componentLab[firstCenter * 3];
  centers[1] = componentLab[firstCenter * 3 + 1];
  centers[2] = componentLab[firstCenter * 3 + 2];
  const closest = new Float32Array(componentCount);
  closest.fill(Number.POSITIVE_INFINITY);

  for (let centerIndex = 1; centerIndex < actualColorCount; centerIndex += 1) {
    let bestIndex = 0;
    let bestScore = -1;
    for (let index = 0; index < componentCount; index += 1) {
      const distance = labDistance(componentLab, index, centers, centerIndex - 1);
      closest[index] = Math.min(closest[index], distance * distance);
      const score = closest[index] * weights[index] * (1 + ((seed + index * 17) % 997) / 997000);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const dst = centerIndex * 3;
    const src = bestIndex * 3;
    centers[dst] = componentLab[src];
    centers[dst + 1] = componentLab[src + 1];
    centers[dst + 2] = componentLab[src + 2];
  }

  const componentLabels = new Uint8Array(componentCount);
  componentLabels.fill(255);
  for (let iteration = 0; iteration < 30; iteration += 1) {
    let changed = 0;
    for (let index = 0; index < componentCount; index += 1) {
      let bestLabel = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let centerIndex = 0; centerIndex < actualColorCount; centerIndex += 1) {
        const distance = labDistance(componentLab, index, centers, centerIndex);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLabel = centerIndex;
        }
      }
      if (componentLabels[index] !== bestLabel) {
        componentLabels[index] = bestLabel;
        changed += 1;
      }
    }

    const sums = new Float64Array(actualColorCount * 3);
    const weightSums = new Float64Array(actualColorCount);
    for (let index = 0; index < componentCount; index += 1) {
      const label = componentLabels[index];
      const weight = weights[index];
      const src = index * 3;
      const dst = label * 3;
      sums[dst] += componentLab[src] * weight;
      sums[dst + 1] += componentLab[src + 1] * weight;
      sums[dst + 2] += componentLab[src + 2] * weight;
      weightSums[label] += weight;
    }
    let reseededEmptyCenter = false;
    const reseedComponents = new Set<number>();
    for (let label = 0; label < actualColorCount; label += 1) {
      const dst = label * 3;
      const weight = weightSums[label];
      if (weight > 0) {
        centers[dst] = sums[dst] / weight;
        centers[dst + 1] = sums[dst + 1] / weight;
        centers[dst + 2] = sums[dst + 2] / weight;
        continue;
      }

      let replacement = firstCenter;
      let replacementScore = Number.NEGATIVE_INFINITY;
      for (let componentId = 0; componentId < componentCount; componentId += 1) {
        if (reseedComponents.has(componentId)) {
          continue;
        }
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (let activeLabel = 0; activeLabel < actualColorCount; activeLabel += 1) {
          if (weightSums[activeLabel] <= 0) {
            continue;
          }
          nearestDistance = Math.min(
            nearestDistance,
            labDistance(componentLab, componentId, centers, activeLabel),
          );
        }
        const score = nearestDistance * nearestDistance * weights[componentId];
        if (score > replacementScore) {
          replacementScore = score;
          replacement = componentId;
        }
      }
      reseedComponents.add(replacement);
      const src = replacement * 3;
      centers[dst] = componentLab[src];
      centers[dst + 1] = componentLab[src + 1];
      centers[dst + 2] = componentLab[src + 2];
      componentLabels[replacement] = label;
      reseededEmptyCenter = true;
    }

    if (changed === 0 && !reseededEmptyCenter) {
      break;
    }
  }

  const paletteSums = new Float64Array(actualColorCount * 3);
  const paletteWeights = new Float64Array(actualColorCount);
  for (let index = 0; index < componentCount; index += 1) {
    const label = componentLabels[index];
    const weight = weights[index];
    const src = index * 3;
    const dst = label * 3;
    paletteSums[dst] += meanRgb[src] * weight;
    paletteSums[dst + 1] += meanRgb[src + 1] * weight;
    paletteSums[dst + 2] += meanRgb[src + 2] * weight;
    paletteWeights[label] += weight;
  }

  const paletteRgb = new Float32Array(actualColorCount * 3);
  for (let label = 0; label < actualColorCount; label += 1) {
    const dst = label * 3;
    const weight = paletteWeights[label];
    if (weight > 0) {
      paletteRgb[dst] = paletteSums[dst] / weight;
      paletteRgb[dst + 1] = paletteSums[dst + 1] / weight;
      paletteRgb[dst + 2] = paletteSums[dst + 2] / weight;
    } else {
      const fallbackOffset = firstCenter * 3;
      paletteRgb[dst] = meanRgb[fallbackOffset];
      paletteRgb[dst + 1] = meanRgb[fallbackOffset + 1];
      paletteRgb[dst + 2] = meanRgb[fallbackOffset + 2];
    }
  }

  return { componentLabels, paletteRgb };
}

function labelMapFromComponents(componentMap: Int32Array, componentLabels: Int32Array | LabelMap): LabelMap {
  const labelMap = new Uint8Array(componentMap.length);
  for (let index = 0; index < componentMap.length; index += 1) {
    labelMap[index] = componentLabels[componentMap[index]] ?? 0;
  }
  return labelMap;
}

function majorityFilterLabels(
  labelMap: LabelMap,
  width: number,
  height: number,
  colorCount: number,
  runs: number,
  sourceRgbData?: Uint8ClampedArray,
  paletteRgb?: Float32Array,
): LabelMap {
  let current = labelMap;
  for (let run = 0; run < runs; run += 1) {
    const next = new Uint8Array(current.length);
    const counts = new Int16Array(colorCount);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        counts.fill(0);
        let bestLabel = current[y * width + x];
        let bestCount = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) {
            continue;
          }
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) {
              continue;
            }
            const label = current[ny * width + nx];
            if (label < 0 || label >= colorCount) {
              continue;
            }
            counts[label] += dx === 0 && dy === 0 ? 2 : 1;
            if (counts[label] > bestCount) {
              bestCount = counts[label];
              bestLabel = label;
            }
          }
        }
        const index = y * width + x;
        const currentLabel = current[index];
        if (
          bestLabel !== currentLabel
          && sourceRgbData != null
          && paletteRgb != null
          && currentLabel >= 0
          && currentLabel < colorCount
        ) {
          const pixelOffset = index * 4;
          const currentDistance = rgbDistanceToPalette(sourceRgbData, pixelOffset, paletteRgb, currentLabel);
          const targetDistance = rgbDistanceToPalette(sourceRgbData, pixelOffset, paletteRgb, bestLabel);
          if (
            targetDistance > SOURCE_AWARE_MAJORITY_ABSOLUTE_RGB_LIMIT
            && targetDistance > currentDistance + SOURCE_AWARE_MAJORITY_RGB_TOLERANCE
          ) {
            bestLabel = currentLabel;
          }
        }
        next[index] = bestLabel;
      }
    }
    current = next;
  }
  return current;
}

function paletteLab(paletteRgb: Float32Array): Float32Array {
  const lab = new Float32Array(paletteRgb.length);
  for (let index = 0; index < paletteRgb.length / 3; index += 1) {
    const offset = index * 3;
    const color = rgbToLab(paletteRgb[offset], paletteRgb[offset + 1], paletteRgb[offset + 2]);
    lab[offset] = color[0];
    lab[offset + 1] = color[1];
    lab[offset + 2] = color[2];
  }
  return lab;
}

function buildAdjacency(componentMap: Int32Array, width: number, height: number): Map<number, Map<number, number>> {
  const adjacency = new Map<number, Map<number, number>>();
  function add(left: number, right: number): void {
    if (left === right) {
      return;
    }
    let leftMap = adjacency.get(left);
    if (leftMap == null) {
      leftMap = new Map();
      adjacency.set(left, leftMap);
    }
    leftMap.set(right, (leftMap.get(right) ?? 0) + 1);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const current = componentMap[index];
      if (x + 1 < width) {
        const right = componentMap[index + 1];
        add(current, right);
        add(right, current);
      }
      if (y + 1 < height) {
        const down = componentMap[index + width];
        add(current, down);
        add(down, current);
      }
    }
  }
  return adjacency;
}

function nearestPaletteLabelForComponent(
  componentLab: Float32Array,
  componentId: number,
  paletteLabColors: Float32Array,
  colorCount: number,
): { label: number; distance: number } {
  let label = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let candidate = 0; candidate < colorCount; candidate += 1) {
    const candidateDistance = labDistance(componentLab, componentId, paletteLabColors, candidate);
    if (candidateDistance < distance) {
      distance = candidateDistance;
      label = candidate;
    }
  }
  return { label, distance };
}

function findEasyLandmarkCandidates(
  sourceComponents: Components,
  width: number,
  height: number,
  minRegionArea: number,
): EasyLandmarkCandidate[] {
  const imageAreaRatio = Math.max(
    1 / 16,
    Math.min(1, (width * height) / (WORK_MAX_EDGE * WORK_MAX_EDGE)),
  );
  const linearScale = Math.sqrt(imageAreaRatio);
  const minimumArea = Math.max(4, Math.round(EASY_LANDMARK_MIN_PIXELS * imageAreaRatio));
  const maximumArea = Math.max(
    minimumArea,
    Math.round(Math.max(
      minRegionArea * EASY_LANDMARK_MAX_AREA_MULTIPLIER,
      EASY_LANDMARK_MAX_SPAN * EASY_LANDMARK_MAX_SPAN * imageAreaRatio * 0.16,
    )),
  );
  const maximumSpan = Math.max(8, Math.round(EASY_LANDMARK_MAX_SPAN * linearScale));
  const componentLab = componentLabColors(sourceComponents.meanRgb);
  const adjacency = buildAdjacency(sourceComponents.componentMap, width, height);
  const candidates: EasyLandmarkCandidate[] = [];

  for (let componentId = 0; componentId < sourceComponents.labels.length; componentId += 1) {
    const area = sourceComponents.areas[componentId];
    if (area < minimumArea || area > maximumArea) {
      continue;
    }
    const minX = sourceComponents.minX[componentId];
    const minY = sourceComponents.minY[componentId];
    const maxX = sourceComponents.maxX[componentId];
    const maxY = sourceComponents.maxY[componentId];
    if (minX <= 0 || minY <= 0 || maxX >= width - 1 || maxY >= height - 1) {
      continue;
    }
    const boundingWidth = maxX - minX + 1;
    const boundingHeight = maxY - minY + 1;
    if (boundingWidth > maximumSpan || boundingHeight > maximumSpan) {
      continue;
    }
    const aspectRatio = Math.max(boundingWidth, boundingHeight) / Math.max(1, Math.min(boundingWidth, boundingHeight));
    if (aspectRatio > EASY_LANDMARK_MAX_ASPECT_RATIO) {
      continue;
    }
    const fillRatio = area / Math.max(1, boundingWidth * boundingHeight);
    if (fillRatio < EASY_LANDMARK_MIN_FILL_RATIO) {
      continue;
    }

    const neighbors = adjacency.get(componentId);
    if (neighbors == null || neighbors.size === 0) {
      continue;
    }
    let totalBorder = 0;
    let dominantNeighborId = -1;
    let dominantBorder = 0;
    for (const [neighborId, borderCount] of neighbors) {
      totalBorder += borderCount;
      if (borderCount > dominantBorder) {
        dominantNeighborId = neighborId;
        dominantBorder = borderCount;
      }
    }
    if (dominantNeighborId < 0 || totalBorder <= 0) {
      continue;
    }
    const enclosure = dominantBorder / totalBorder;
    if (enclosure < EASY_LANDMARK_MIN_ENCLOSURE) {
      continue;
    }
    const compactness = (4 * Math.PI * area) / Math.max(1, totalBorder * totalBorder);
    if (compactness < EASY_LANDMARK_MIN_COMPACTNESS) {
      continue;
    }
    const sourceContrast = labDistance(componentLab, componentId, componentLab, dominantNeighborId);
    if (sourceContrast < EASY_LANDMARK_MIN_SOURCE_LAB_DISTANCE) {
      continue;
    }
    const sizePreference = Math.max(0, 12 - Math.log1p(area) * 1.35);
    const score = sourceContrast * 1.5
      + enclosure * 20
      + Math.min(1, compactness) * 16
      + sizePreference
      - aspectRatio * 2;
    candidates.push({
      componentId,
      area,
      sourceContrast,
      enclosure,
      compactness,
      score,
    });
  }

  return candidates
    .sort((left, right) => right.score - left.score || right.area - left.area || left.componentId - right.componentId)
    .slice(0, EASY_LANDMARK_MAX_COUNT);
}

function restoreEasyLandmarks(
  labelMap: LabelMap,
  sourceComponents: Components,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  minRegionArea: number,
): EasyLandmarkRestoreResult {
  const candidates = findEasyLandmarkCandidates(sourceComponents, width, height, minRegionArea);
  if (candidates.length === 0) {
    return { labelMap, candidateCount: 0, restoredCount: 0, restoredPixelCount: 0 };
  }

  const colorCount = paletteRgb.length / 3;
  const sourceLab = componentLabColors(sourceComponents.meanRgb);
  const paletteLabColors = paletteLab(paletteRgb);
  let next: LabelMap | null = null;
  let restoredCount = 0;
  let restoredPixelCount = 0;

  for (const candidate of candidates) {
    const nearestPalette = nearestPaletteLabelForComponent(
      sourceLab,
      candidate.componentId,
      paletteLabColors,
      colorCount,
    );
    if (nearestPalette.distance > EASY_LANDMARK_MAX_PALETTE_LAB_DISTANCE) {
      continue;
    }

    const borderLabelCounts = new Int32Array(colorCount);
    let targetPixelCount = 0;
    const minX = sourceComponents.minX[candidate.componentId];
    const minY = sourceComponents.minY[candidate.componentId];
    const maxX = sourceComponents.maxX[candidate.componentId];
    const maxY = sourceComponents.maxY[candidate.componentId];
    const current = next ?? labelMap;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = y * width + x;
        if (sourceComponents.componentMap[index] !== candidate.componentId) {
          continue;
        }
        if (current[index] === nearestPalette.label) {
          targetPixelCount += 1;
        }
        const neighborIndexes = [index - width, index + width, index - 1, index + 1];
        for (const neighborIndex of neighborIndexes) {
          if (
            neighborIndex < 0
            || neighborIndex >= current.length
            || sourceComponents.componentMap[neighborIndex] === candidate.componentId
          ) {
            continue;
          }
          const neighborLabel = current[neighborIndex];
          if (neighborLabel >= 0 && neighborLabel < colorCount) {
            borderLabelCounts[neighborLabel] += 1;
          }
        }
      }
    }
    if (targetPixelCount >= candidate.area * 0.6) {
      continue;
    }

    let surroundingLabel = -1;
    let surroundingCount = 0;
    for (let label = 0; label < colorCount; label += 1) {
      if (borderLabelCounts[label] > surroundingCount) {
        surroundingLabel = label;
        surroundingCount = borderLabelCounts[label];
      }
    }
    if (
      surroundingLabel < 0
      || surroundingLabel === nearestPalette.label
      || labDistance(paletteLabColors, nearestPalette.label, paletteLabColors, surroundingLabel)
        < EASY_LANDMARK_MIN_OUTPUT_LAB_DISTANCE
    ) {
      continue;
    }

    if (next == null) {
      next = new Uint8Array(labelMap);
    }
    let changedPixels = 0;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = y * width + x;
        if (
          sourceComponents.componentMap[index] === candidate.componentId
          && next[index] !== nearestPalette.label
        ) {
          next[index] = nearestPalette.label;
          changedPixels += 1;
        }
      }
    }
    if (changedPixels > 0) {
      restoredCount += 1;
      restoredPixelCount += changedPixels;
    }
  }

  return {
    labelMap: next ?? labelMap,
    candidateCount: candidates.length,
    restoredCount,
    restoredPixelCount,
  };
}

async function mergeTinyRegions(
  labelMap: LabelMap,
  sourceRgbData: Uint8ClampedArray,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  minArea: number,
  maxPasses: number,
  forceMergeBelow: number,
  protectMinArea: number,
  protectLabDistance: number,
  options: GeneratePaintByNumbersOptions,
): Promise<MergeResult> {
  let current = new Uint8Array(labelMap);
  const colorCount = paletteRgb.length / 3;
  const lab = paletteLab(paletteRgb);
  let totalMerges = 0;
  let totalGlobalReassignments = 0;
  let componentCount = 0;
  let smallRemaining = 0;
  let protectedSmall = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const components = connectedComponentsForLabels(current, colorCount, width, height, sourceRgbData);
    const componentLab = componentLabColors(components.meanRgb);
    componentCount = components.labels.length;
    const adjacency = buildAdjacency(components.componentMap, width, height);
    const replacementByComponent = new Uint8Array(componentCount);
    const scheduledSource = new Uint8Array(componentCount);
    const lockedAsTarget = new Uint8Array(componentCount);
    let mergeCount = 0;
    let globalReassignCount = 0;

    for (let componentId = 0; componentId < componentCount; componentId += 1) {
      replacementByComponent[componentId] = components.labels[componentId];
    }

    const candidates = Array.from({ length: componentCount }, (_, componentId) => componentId)
      .filter((componentId) => components.areas[componentId] < minArea)
      .sort((left, right) => components.areas[left] - components.areas[right] || left - right);

    for (const componentId of candidates) {
      if (lockedAsTarget[componentId] !== 0) {
        continue;
      }
      const area = components.areas[componentId];
      const sourceLabel = components.labels[componentId];
      const neighbors = adjacency.get(componentId);
      if (neighbors == null || neighbors.size === 0) {
        continue;
      }

      const nearestPalette = nearestPaletteLabelForComponent(componentLab, componentId, lab, colorCount);
      const currentSourceDistance = labDistance(componentLab, componentId, lab, sourceLabel);
      let nearestNeighborSourceDistance = Number.POSITIVE_INFINITY;
      let bestLabel = sourceLabel;
      let bestNeighborId = -1;
      let bestNeighborSourceDistance = Number.POSITIVE_INFINITY;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const [neighborId, borderCount] of neighbors) {
        if (scheduledSource[neighborId] !== 0) {
          continue;
        }
        const targetLabel = components.labels[neighborId];
        if (targetLabel === sourceLabel) {
          continue;
        }
        const paletteDistance = labDistance(lab, sourceLabel, lab, targetLabel);
        const sourceTargetDistance = labDistance(componentLab, componentId, lab, targetLabel);
        nearestNeighborSourceDistance = Math.min(nearestNeighborSourceDistance, sourceTargetDistance);
        const borderBonus = Math.min(8, Math.log1p(borderCount) * 1.4);
        const areaBonus = Math.min(12, Math.log1p(components.areas[neighborId]) * 0.8);
        const score = sourceTargetDistance * 1.25 + paletteDistance * 0.18 - borderBonus - areaBonus;
        if (score < bestScore) {
          bestScore = score;
          bestLabel = targetLabel;
          bestNeighborId = neighborId;
          bestNeighborSourceDistance = sourceTargetDistance;
        }
      }

      const isForcedTiny = area < forceMergeBelow;
      const neighborLimit = isForcedTiny ? SOURCE_TINY_MERGE_MAX_LAB_DISTANCE : SOURCE_MERGE_MAX_LAB_DISTANCE;
      const hasGoodNeighbor = bestLabel !== sourceLabel && bestNeighborSourceDistance <= neighborLimit;
      const globalIsBetter =
        nearestPalette.distance <= SOURCE_GLOBAL_REASSIGN_MAX_LAB_DISTANCE
        || nearestPalette.distance + SOURCE_GLOBAL_REASSIGN_MIN_IMPROVEMENT < bestNeighborSourceDistance
        || nearestPalette.distance + SOURCE_GLOBAL_REASSIGN_MIN_IMPROVEMENT < currentSourceDistance;
      const canUseGlobalReassignment =
        area >= protectMinArea
        || (
          area >= DETAIL_SPECKLE_PROTECT_MIN_PIXELS
          && nearestNeighborSourceDistance >= protectLabDistance + 8
          && nearestPalette.distance <= SOURCE_GLOBAL_REASSIGN_MAX_LAB_DISTANCE * 0.75
        );
      const detailProtected =
        area >= protectMinArea
        && nearestNeighborSourceDistance >= protectLabDistance
        && nearestPalette.distance <= Math.max(SOURCE_GLOBAL_REASSIGN_MAX_LAB_DISTANCE, currentSourceDistance + SOURCE_GLOBAL_REASSIGN_MIN_IMPROVEMENT);

      if (canUseGlobalReassignment && (detailProtected || !hasGoodNeighbor) && nearestPalette.label !== sourceLabel && globalIsBetter) {
        replacementByComponent[componentId] = nearestPalette.label;
        scheduledSource[componentId] = 1;
        globalReassignCount += 1;
        totalGlobalReassignments += 1;
        continue;
      }

      if (detailProtected && !isForcedTiny) {
        continue;
      }

      if (hasGoodNeighbor) {
        replacementByComponent[componentId] = bestLabel;
        scheduledSource[componentId] = 1;
        if (bestNeighborId >= 0) {
          lockedAsTarget[bestNeighborId] = 1;
        }
        mergeCount += 1;
      } else if (nearestPalette.label === sourceLabel && detailProtected) {
        continue;
      } else if (bestLabel !== sourceLabel && isForcedTiny) {
        replacementByComponent[componentId] = bestLabel;
        scheduledSource[componentId] = 1;
        if (bestNeighborId >= 0) {
          lockedAsTarget[bestNeighborId] = 1;
        }
        mergeCount += 1;
      }
    }

    if (mergeCount === 0 && globalReassignCount === 0) {
      break;
    }

    const next = new Uint8Array(current.length);
    for (let index = 0; index < current.length; index += 1) {
      next[index] = replacementByComponent[components.componentMap[index]];
    }
    current = next;
    totalMerges += mergeCount;
    await yieldAndCheckCancellation(options);
  }

  const finalComponents = connectedComponentsForLabels(current, colorCount, width, height, sourceRgbData);
  const finalComponentLab = componentLabColors(finalComponents.meanRgb);
  componentCount = finalComponents.labels.length;
  const adjacency = buildAdjacency(finalComponents.componentMap, width, height);
  for (let componentId = 0; componentId < componentCount; componentId += 1) {
    const area = finalComponents.areas[componentId];
    if (area >= minArea) {
      continue;
    }
    const sourceLabel = finalComponents.labels[componentId];
    let nearestDistance = Number.POSITIVE_INFINITY;
    const neighbors = adjacency.get(componentId);
    if (neighbors != null) {
      for (const neighborId of neighbors.keys()) {
        const targetLabel = finalComponents.labels[neighborId];
        if (targetLabel !== sourceLabel) {
          nearestDistance = Math.min(nearestDistance, labDistance(finalComponentLab, componentId, lab, targetLabel));
        }
      }
    }
    if (area >= protectMinArea && nearestDistance >= protectLabDistance) {
      protectedSmall += 1;
    } else {
      smallRemaining += 1;
    }
  }

  return {
    labelMap: current,
    mergeCount: totalMerges,
    globalReassignCount: totalGlobalReassignments,
    componentCount,
    smallRemaining,
    protectedSmall,
  };
}

async function enforceFacetBudget(
  labelMap: LabelMap,
  sourceRgbData: Uint8ClampedArray,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  maximumNumberOfFacets: number,
  options: GeneratePaintByNumbersOptions,
): Promise<FacetBudgetResult> {
  let current = new Uint8Array(labelMap);
  const colorCount = paletteRgb.length / 3;
  const lab = paletteLab(paletteRgb);
  let totalMergeCount = 0;
  let componentCount = Number.POSITIVE_INFINITY;

  for (let pass = 0; pass < MAX_FACET_BUDGET_PASSES; pass += 1) {
    const components = connectedComponentsForLabels(current, colorCount, width, height, sourceRgbData);
    componentCount = components.labels.length;
    if (componentCount <= maximumNumberOfFacets) {
      return { labelMap: current, mergeCount: totalMergeCount, componentCount, satisfied: true };
    }

    const excess = componentCount - maximumNumberOfFacets;
    const componentLab = componentLabColors(components.meanRgb);
    const adjacency = buildAdjacency(components.componentMap, width, height);
    const proposals: Array<{ sourceId: number; targetId: number; targetLabel: number; cost: number }> = [];

    for (let componentId = 0; componentId < componentCount; componentId += 1) {
      const sourceLabel = components.labels[componentId];
      const neighbors = adjacency.get(componentId);
      if (neighbors == null) {
        continue;
      }
      let bestTargetId = -1;
      let bestTargetLabel = sourceLabel;
      let bestCost = Number.POSITIVE_INFINITY;
      for (const [neighborId, borderCount] of neighbors) {
        const targetLabel = components.labels[neighborId];
        if (targetLabel === sourceLabel) {
          continue;
        }
        const sourceDistance = labDistance(componentLab, componentId, lab, targetLabel);
        const sharedBoundaryReward = Math.min(18, Math.log1p(borderCount) * 2.2);
        const targetAreaReward = Math.min(14, Math.log1p(components.areas[neighborId]) * 0.9);
        const compactDetailPenalty = components.areas[componentId] >= DETAIL_PROTECT_MIN_PIXELS
          && sourceDistance >= DETAIL_PROTECT_LAB_DISTANCE
          ? 80
          : 0;
        const cost = sourceDistance * 1.7 - sharedBoundaryReward - targetAreaReward + compactDetailPenalty;
        if (cost < bestCost) {
          bestCost = cost;
          bestTargetId = neighborId;
          bestTargetLabel = targetLabel;
        }
      }
      if (bestTargetId >= 0) {
        proposals.push({
          sourceId: componentId,
          targetId: bestTargetId,
          targetLabel: bestTargetLabel,
          cost: bestCost + Math.log1p(components.areas[componentId]) * 0.35,
        });
      }
    }

    const targetUseCounts = new Int32Array(componentCount);
    for (const proposal of proposals) {
      targetUseCounts[proposal.targetId] += 1;
    }
    proposals.sort((left, right) => (
      targetUseCounts[right.targetId] - targetUseCounts[left.targetId]
      || left.cost - right.cost
      || left.sourceId - right.sourceId
    ));
    const scheduledSource = new Uint8Array(componentCount);
    const lockedTarget = new Uint8Array(componentCount);
    const replacementByComponent = new Uint8Array(components.labels);
    let scheduled = 0;
    for (const proposal of proposals) {
      if (scheduled >= excess) {
        break;
      }
      if (
        scheduledSource[proposal.sourceId] !== 0
        || lockedTarget[proposal.sourceId] !== 0
        || scheduledSource[proposal.targetId] !== 0
      ) {
        continue;
      }
      replacementByComponent[proposal.sourceId] = proposal.targetLabel;
      scheduledSource[proposal.sourceId] = 1;
      lockedTarget[proposal.targetId] = 1;
      scheduled += 1;
    }

    if (scheduled === 0) {
      break;
    }
    const next = new Uint8Array(current.length);
    for (let index = 0; index < current.length; index += 1) {
      next[index] = replacementByComponent[components.componentMap[index]];
    }
    current = next;
    totalMergeCount += scheduled;
    await yieldAndCheckCancellation(options);
  }

  componentCount = connectedComponentsForLabels(current, colorCount, width, height).labels.length;
  return {
    labelMap: current,
    mergeCount: totalMergeCount,
    componentCount,
    satisfied: componentCount <= maximumNumberOfFacets,
  };
}

function labelPixelCounts(labelMap: LabelMap, colorCount: number): Int32Array {
  const counts = new Int32Array(colorCount);
  for (const label of labelMap) {
    if (label >= 0 && label < colorCount) {
      counts[label] += 1;
    }
  }
  return counts;
}

function ensureTargetPaletteUsage(
  labelMap: LabelMap,
  sourceRgbData: Uint8ClampedArray,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  colorCount: number,
  minRegionArea: number,
): { labelMap: LabelMap; reintroducedCount: number } {
  const counts = labelPixelCounts(labelMap, colorCount);
  const missingLabels: number[] = [];
  for (let label = 0; label < colorCount; label += 1) {
    if (counts[label] === 0) {
      missingLabels.push(label);
    }
  }
  if (missingLabels.length === 0) {
    return { labelMap, reintroducedCount: 0 };
  }

  const components = connectedComponentsForLabels(labelMap, colorCount, width, height, sourceRgbData);
  if (components.labels.length <= colorCount - missingLabels.length) {
    return { labelMap, reintroducedCount: 0 };
  }

  const componentLab = componentLabColors(components.meanRgb);
  const lab = paletteLab(paletteRgb);
  const selectedComponents = new Set<number>();
  let next: LabelMap | null = null;
  let reintroducedCount = 0;
  const minimumCandidateArea = Math.max(DETAIL_SPECKLE_PROTECT_MIN_PIXELS, Math.min(minRegionArea, MEDIUM_MIN_REGION_PIXELS));

  for (const missingLabel of missingLabels) {
    let bestComponent = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestMissingDistance = Number.POSITIVE_INFINITY;
    let bestImprovement = Number.NEGATIVE_INFINITY;

    for (let componentId = 0; componentId < components.labels.length; componentId += 1) {
      if (selectedComponents.has(componentId)) {
        continue;
      }
      const area = components.areas[componentId];
      if (area < minimumCandidateArea) {
        continue;
      }
      const sourceLabel = components.labels[componentId];
      if (counts[sourceLabel] <= area) {
        continue;
      }
      const currentDistance = labDistance(componentLab, componentId, lab, sourceLabel);
      const missingDistance = labDistance(componentLab, componentId, lab, missingLabel);
      const improvement = currentDistance - missingDistance;
      const isPlausibleReintroduction =
        missingDistance <= PALETTE_REINTRO_MAX_LAB_DISTANCE
        && improvement >= PALETTE_REINTRO_MIN_IMPROVEMENT;
      if (!isPlausibleReintroduction) {
        continue;
      }
      const areaScore = Math.min(16, Math.log1p(area) * 1.6);
      const hugeAreaPenalty = Math.max(0, area / Math.max(1, width * height) - 0.08) * 80;
      const score = currentDistance * 1.4 + improvement * 1.8 + areaScore - hugeAreaPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestComponent = componentId;
        bestMissingDistance = missingDistance;
        bestImprovement = improvement;
      }
    }

    if (
      bestComponent < 0
      || bestMissingDistance > PALETTE_REINTRO_MAX_LAB_DISTANCE
      || bestImprovement < PALETTE_REINTRO_MIN_IMPROVEMENT
    ) {
      continue;
    }

    if (next == null) {
      next = new Uint8Array(labelMap);
    }
    const previousLabel = components.labels[bestComponent];
    for (let index = 0; index < components.componentMap.length; index += 1) {
      if (components.componentMap[index] === bestComponent) {
        next[index] = missingLabel;
      }
    }
    counts[previousLabel] -= components.areas[bestComponent];
    counts[missingLabel] += components.areas[bestComponent];
    selectedComponents.add(bestComponent);
    reintroducedCount += 1;
  }

  return {
    labelMap: next ?? labelMap,
    reintroducedCount,
  };
}

function recomputePalette(rgbData: Uint8ClampedArray, labelMap: LabelMap, colorCount: number): Float32Array {
  const sums = new Float64Array(colorCount * 3);
  const counts = new Int32Array(colorCount);
  for (let index = 0; index < labelMap.length; index += 1) {
    const label = labelMap[index];
    if (label < 0 || label >= colorCount) {
      continue;
    }
    const src = index * 4;
    const dst = label * 3;
    sums[dst] += rgbData[src];
    sums[dst + 1] += rgbData[src + 1];
    sums[dst + 2] += rgbData[src + 2];
    counts[label] += 1;
  }
  const palette = new Float32Array(colorCount * 3);
  for (let label = 0; label < colorCount; label += 1) {
    const dst = label * 3;
    if (counts[label] > 0) {
      palette[dst] = sums[dst] / counts[label];
      palette[dst + 1] = sums[dst + 1] / counts[label];
      palette[dst + 2] = sums[dst + 2] / counts[label];
    } else {
      palette[dst] = 255;
      palette[dst + 1] = 255;
      palette[dst + 2] = 255;
    }
  }
  return palette;
}

function paletteColorForLabel(paletteRgb: Float32Array, label: number): Rgb {
  const offset = Math.max(0, label) * 3;
  return [
    clampByte(paletteRgb[offset] ?? 255),
    clampByte(paletteRgb[offset + 1] ?? 255),
    clampByte(paletteRgb[offset + 2] ?? 255),
  ];
}

function blendChannel(base: number, overlay: number, alpha: number): number {
  return base * (1 - alpha) + overlay * alpha;
}

function blendRgb(base: Rgb, overlay: Rgb, alpha: number): Rgb {
  return [
    blendChannel(base[0], overlay[0], alpha),
    blendChannel(base[1], overlay[1], alpha),
    blendChannel(base[2], overlay[2], alpha),
  ];
}

function computeMarkerPlacements(components: Components, width: number, height: number): MarkerPlacement[] {
  const regionCount = components.labels.length;
  const placements: MarkerPlacement[] = [];
  for (let regionId = 0; regionId < regionCount; regionId += 1) {
    const minX = Math.max(0, components.minX[regionId]);
    const minY = Math.max(0, components.minY[regionId]);
    const maxX = Math.min(width - 1, components.maxX[regionId]);
    const maxY = Math.min(height - 1, components.maxY[regionId]);
    if (minX > maxX || minY > maxY) {
      continue;
    }

    const localWidth = maxX - minX + 3;
    const localHeight = maxY - minY + 3;
    const distances = new Int16Array(localWidth * localHeight);
    const large = 32000;
    for (let localY = 1; localY < localHeight - 1; localY += 1) {
      const sourceY = minY + localY - 1;
      const sourceRow = sourceY * width;
      const localRow = localY * localWidth;
      for (let localX = 1; localX < localWidth - 1; localX += 1) {
        const sourceX = minX + localX - 1;
        distances[localRow + localX] = components.componentMap[sourceRow + sourceX] === regionId ? large : 0;
      }
    }

    for (let localY = 1; localY < localHeight - 1; localY += 1) {
      const row = localY * localWidth;
      for (let localX = 1; localX < localWidth - 1; localX += 1) {
        const index = row + localX;
        if (distances[index] === 0) {
          continue;
        }
        distances[index] = Math.min(
          distances[index],
          distances[index - 1] + 1,
          distances[index - localWidth] + 1,
          distances[index - localWidth - 1] + 1,
          distances[index - localWidth + 1] + 1,
        );
      }
    }

    let bestX = 1;
    let bestY = 1;
    let bestClearance = 1;
    for (let localY = localHeight - 2; localY >= 1; localY -= 1) {
      const row = localY * localWidth;
      for (let localX = localWidth - 2; localX >= 1; localX -= 1) {
        const index = row + localX;
        if (distances[index] === 0) {
          continue;
        }
        const clearance = Math.min(
          distances[index],
          distances[index + 1] + 1,
          distances[index + localWidth] + 1,
          distances[index + localWidth - 1] + 1,
          distances[index + localWidth + 1] + 1,
        );
        distances[index] = clearance;
        if (clearance > bestClearance) {
          bestClearance = clearance;
          bestX = localX;
          bestY = localY;
        }
      }
    }

    const area = Math.max(1, components.areas[regionId]);
    const areaRadius = Math.sqrt(area / Math.PI) * 0.32;
    const radius = Math.max(0.25, Math.min(8.5, areaRadius, Math.max(0.25, bestClearance - 0.7)));
    placements.push({
      regionId,
      colorIndex: components.labels[regionId],
      x: minX + bestX - 0.5,
      y: minY + bestY - 0.5,
      radius,
    });
  }

  return placements;
}

function boundaryMask(regionMap: Int32Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const region = regionMap[index];
      if ((x + 1 < width && regionMap[index + 1] !== region) || (y + 1 < height && regionMap[index + width] !== region)) {
        mask[index] = 2;
        if (x + 1 < width) {
          mask[index + 1] = Math.max(mask[index + 1], 2);
        }
        if (y + 1 < height) {
          mask[index + width] = Math.max(mask[index + width], 2);
        }
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] !== 2) {
        continue;
      }
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) {
            continue;
          }
          const neighborIndex = ny * width + nx;
          if (mask[neighborIndex] === 0) {
            mask[neighborIndex] = 1;
          }
        }
      }
    }
  }
  return mask;
}

function blendPixel(rgba: Uint8Array, width: number, height: number, x: number, y: number, color: Rgb, alpha: number): void {
  if (x < 0 || x >= width || y < 0 || y >= height || alpha <= 0) {
    return;
  }
  const offset = (y * width + x) * 4;
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  rgba[offset] = clampByte(blendChannel(rgba[offset], color[0], clampedAlpha));
  rgba[offset + 1] = clampByte(blendChannel(rgba[offset + 1], color[1], clampedAlpha));
  rgba[offset + 2] = clampByte(blendChannel(rgba[offset + 2], color[2], clampedAlpha));
  rgba[offset + 3] = 255;
}

function drawCircleMarker(
  rgba: Uint8Array,
  width: number,
  height: number,
  placement: MarkerPlacement,
  paletteRgb: Float32Array,
): void {
  const fill = paletteColorForLabel(paletteRgb, placement.colorIndex);
  const stroke: Rgb = [OUTLINE_R, OUTLINE_G, OUTLINE_B];
  const strokeWidth = Math.min(0.85, Math.max(0.12, placement.radius * 0.35));
  const outerRadius = placement.radius + strokeWidth;
  const strokeStart = Math.max(0, placement.radius - strokeWidth);
  const minX = Math.max(0, Math.floor(placement.x - outerRadius - 1));
  const maxX = Math.min(width - 1, Math.ceil(placement.x + outerRadius + 1));
  const minY = Math.max(0, Math.floor(placement.y - outerRadius - 1));
  const maxY = Math.min(height - 1, Math.ceil(placement.y + outerRadius + 1));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - placement.x;
      const dy = y + 0.5 - placement.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > outerRadius) {
        continue;
      }
      const color = distance >= strokeStart ? stroke : fill;
      const alpha = distance > outerRadius - 1 ? outerRadius - distance : 1;
      blendPixel(rgba, width, height, x, y, color, alpha);
    }
  }
}

function drawMarkerCircles(
  rgba: Uint8Array,
  width: number,
  height: number,
  placements: MarkerPlacement[],
  paletteRgb: Float32Array,
): void {
  for (const placement of placements) {
    drawCircleMarker(rgba, width, height, placement, paletteRgb);
  }
}

function renderRgba(
  labelMap: LabelMap,
  regionMap: Int32Array,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  config: FreshRenderConfig,
  placements: MarkerPlacement[],
  cachedBoundaries?: Uint8Array,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const boundaries = config.boundaryMode === 'none'
    ? undefined
    : cachedBoundaries ?? boundaryMask(regionMap, width, height);
  for (let index = 0; index < labelMap.length; index += 1) {
    const label = labelMap[index];
    const outputOffset = index * 4;
    let color: Rgb = config.fillMode === 'white'
      ? [WHITE_R, WHITE_G, WHITE_B]
      : paletteColorForLabel(paletteRgb, label);
    const boundary = boundaries?.[index] ?? 0;
    if (boundary > 0) {
      const boundaryColor: Rgb = config.boundaryMode === 'color'
        ? paletteColorForLabel(paletteRgb, label)
        : [OUTLINE_R, OUTLINE_G, OUTLINE_B];
      const alpha = boundary === 2 ? BOUNDARY_ALPHA : BOUNDARY_SOFT_ALPHA;
      color = blendRgb(color, boundaryColor, alpha);
    }
    rgba[outputOffset] = clampByte(color[0]);
    rgba[outputOffset + 1] = clampByte(color[1]);
    rgba[outputOffset + 2] = clampByte(color[2]);
    rgba[outputOffset + 3] = 255;
  }
  if (config.markerMode === 'circles') {
    drawMarkerCircles(rgba, width, height, placements, paletteRgb);
  }
  return rgba;
}

function pngBase64FromRgba(width: number, height: number, data: Uint8Array): string {
  const bytes = encode({
    width,
    height,
    data,
    depth: 8,
    channels: 4,
  });
  return uint8ToBase64(bytes);
}

function buildPaletteStats(labelMap: LabelMap, paletteRgb: Float32Array): PaletteStat[] {
  const colorCount = paletteRgb.length / 3;
  const counts = new Int32Array(colorCount);
  let total = 0;
  for (const label of labelMap) {
    if (label >= 0 && label < colorCount) {
      counts[label] += 1;
      total += 1;
    }
  }
  const stats: PaletteStat[] = [];
  for (let label = 0; label < colorCount; label += 1) {
    if (counts[label] === 0) {
      continue;
    }
    const offset = label * 3;
    stats.push({
      index: label + 1,
      color: [clampByte(paletteRgb[offset]), clampByte(paletteRgb[offset + 1]), clampByte(paletteRgb[offset + 2])],
      frequency: counts[label],
      areaPercentage: total > 0 ? counts[label] / total : 0,
    });
  }
  return stats.sort((left, right) => right.frequency - left.frequency || left.index - right.index);
}

function createVariant(
  config: FreshRenderConfig,
  base64: string,
  svg: string,
  width: number,
  height: number,
): GeneratorOutputVariant {
  return {
    id: config.id,
    label: config.label,
    description: config.description,
    pngBase64: base64,
    pngWidth: width,
    pngHeight: height,
    pngByteLength: Math.ceil((base64.length * 3) / 4),
    svg,
    svgWidth: width,
    svgHeight: height,
    svgByteLength: svg.length,
    isDefault: config.isDefault,
  };
}

type FreshDebugImageSource =
  | GeneratorDebugImage
  | (() => GeneratorDebugImage | Promise<GeneratorDebugImage | undefined> | undefined)
  | undefined;

function addElapsedTiming(timings: GeneratorTimings, stage: GeneratorStage, elapsedMs: number): void {
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

function freshStageParameters(stage: GeneratorStage, settings: GeneratorSettings): GeneratorDebugParameter[] {
  if (stage === 'decode') {
    return [
      debugNumberParameter(settings, 'resizeImageWidth', 'Max. Breite', 128, 2048, 64, 'px'),
      debugNumberParameter(settings, 'resizeImageHeight', 'Max. Hoehe', 128, 2048, 64, 'px'),
    ];
  }

  if (stage === 'colorMap') {
    return [
      debugNumberParameter(settings, 'kMeansNrOfClusters', 'Zielfarben', 2, 48, 1, 'Farben'),
      debugNumberParameter(settings, 'randomSeed', 'Random Seed', 0, 999999, 1),
    ];
  }

  if (stage === 'narrowCleanup') {
    return [
      debugNumberParameter(
        settings,
        'narrowPixelStripCleanupRuns',
        'Zusatz-Cleanup',
        0,
        8,
        1,
        'Runs',
        'Fresh nutzt zwei feste source-aware Basisdurchlaeufe; dieser Wert fuegt weitere Durchlaeufe hinzu.',
      ),
    ];
  }

  if (stage === 'borderSegment') {
    return [
      debugNumberParameter(
        settings,
        'nrOfTimesToHalveBorderSegments',
        'Zusatz-Pruning',
        0,
        8,
        1,
        'Runs',
        'Fresh nutzt diesen Wert als optionale weitere source-aware Beruhigung vor dem Region-Build.',
      ),
    ];
  }

  if (stage === 'facetReduce') {
    return [
      debugNumberParameter(
        settings,
        'removeFacetsSmallerThanImageRatio',
        'Mindestflaeche-Floor',
        0,
        0.001,
        0.000005,
        'Bildanteil',
        'Kann die Fresh-Mindestflaeche anheben; die farbanzahlabhaengige Fresh-Policy bleibt die Untergrenze.',
      ),
      debugNumberParameter(
        settings,
        'maximumNumberOfFacets',
        'Maximale Flaechen',
        0,
        12000,
        25,
        'Flaechen',
        '0 bedeutet kein hartes Flaechenlimit.',
      ),
    ];
  }

  return [];
}

function debugRegionColor(regionId: number): Rgb {
  const hash = Math.imul(regionId + 1, 1103515245) + 12345;
  return [
    70 + Math.abs(hash & 0xff) % 150,
    70 + Math.abs((hash >> 8) & 0xff) % 150,
    70 + Math.abs((hash >> 16) & 0xff) % 150,
  ];
}

function labelMapToRgba(
  labelMap: LabelMap,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  components?: Components,
  mode: 'color' | 'debugRegions' | 'boundaries' = 'color',
  placements?: MarkerPlacement[],
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const boundaries = components != null && mode !== 'color' ? boundaryMask(components.componentMap, width, height) : undefined;

  for (let index = 0; index < labelMap.length; index += 1) {
    const regionId = components?.componentMap[index] ?? -1;
    const rgb = mode === 'debugRegions' && regionId >= 0
      ? debugRegionColor(regionId)
      : paletteColorForLabel(paletteRgb, labelMap[index]);
    const offset = index * 4;
    rgba[offset] = rgb[0];
    rgba[offset + 1] = rgb[1];
    rgba[offset + 2] = rgb[2];
    rgba[offset + 3] = 255;
  }

  if (boundaries != null) {
    for (let index = 0; index < boundaries.length; index += 1) {
      const boundary = boundaries[index];
      if (boundary === 0) {
        continue;
      }
      const offset = index * 4;
      const alpha = boundary === 2 ? BOUNDARY_ALPHA : BOUNDARY_SOFT_ALPHA;
      rgba[offset] = clampByte(blendChannel(rgba[offset], OUTLINE_R, alpha));
      rgba[offset + 1] = clampByte(blendChannel(rgba[offset + 1], OUTLINE_G, alpha));
      rgba[offset + 2] = clampByte(blendChannel(rgba[offset + 2], OUTLINE_B, alpha));
    }
  }

  if (placements != null) {
    drawMarkerCircles(rgba, width, height, placements, paletteRgb);
  }

  return rgba;
}

async function renderFreshDebugImage(
  label: string,
  labelMap: LabelMap,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  components?: Components,
  mode: 'color' | 'debugRegions' | 'boundaries' = 'color',
  placements?: MarkerPlacement[],
): Promise<GeneratorDebugImage> {
  return encodeRgbaDebugImage(
    label,
    width,
    height,
    labelMapToRgba(labelMap, paletteRgb, width, height, components, mode, placements),
  );
}

async function pushFreshDebugSnapshot(
  snapshots: GeneratorDebugStageSnapshot[] | null,
  stage: GeneratorStage,
  label: string,
  description: string,
  settings: GeneratorSettings,
  metrics: GeneratorDebugMetric[],
  image: FreshDebugImageSource,
  timingMs: number | undefined,
  cacheHit = false,
  onStageSnapshot?: (snapshot: GeneratorDebugStageSnapshot) => void,
): Promise<void> {
  if (snapshots == null && onStageSnapshot == null) {
    return;
  }

  const resolvedImage = typeof image === 'function' ? await image() : image;
  const snapshot: GeneratorDebugStageSnapshot = {
    stage,
    label,
    description,
    parameters: freshStageParameters(stage, settings),
    metrics,
    image: resolvedImage,
    timingMs,
    canRerunFromHere: stage !== 'svgRender',
    cacheHit,
  };

  snapshots?.push(snapshot);
  onStageSnapshot?.(snapshot);
}

async function generatePaintByNumbersInternal(
  preparedInput: PreparedFreshGeneratorImage,
  requestedSettings: GeneratorSettings,
  onProgress?: (progress: GeneratorProgress) => void,
  options: GeneratePaintByNumbersOptions = {},
): Promise<GeneratorResult> {
  const settings = normalizedFreshSettings(requestedSettings);
  const report = createProgressReporter(onProgress);
  const timings: GeneratorTimings = {};
  const targetColorCount = settings.kMeansNrOfClusters;
  const debugEnabled = options.debug?.enabled === true;
  const debugSnapshots: GeneratorDebugStageSnapshot[] | null = debugEnabled ? [] : null;
  const previousCache = options.debug?.cache ?? null;
  const sourceKey = options.cacheSourceKey ?? sourceKeyForPrepared(preparedInput);
  const nextCache: GeneratorPipelineDebugCache = {
    version: FRESH_PIPELINE_CACHE_VERSION,
    sourceKey,
    signatures: {},
  };
  let cachePrefixValid =
    previousCache?.version === FRESH_PIPELINE_CACHE_VERSION
    && previousCache.sourceKey === sourceKey;
  const canUseCachedStage = (stage: PipelineStage, expectedSignature: string, valuePresent: boolean): boolean => {
    if (!shouldUseCachedStage(options, stage)) {
      return false;
    }
    const valid =
      cachePrefixValid
      && valuePresent
      && previousCache?.signatures?.[stage] === expectedSignature;
    if (!valid) {
      cachePrefixValid = false;
    }
    return valid;
  };
  const rememberSignature = (stage: PipelineStage, value: string): void => {
    nextCache.signatures[stage] = value;
  };
  const decodeSignature = freshDecodeCacheSignature(sourceKey, settings);

  let decoded: PreparedFreshGeneratorImage;
  if (canUseCachedStage('decode', decodeSignature, previousCache?.decoded != null)) {
    decoded = previousCache?.decoded as PreparedFreshGeneratorImage;
    nextCache.decoded = decoded;
    addElapsedTiming(timings, 'decode', 0);
    report('decode', 1, 'Vorbereitetes Bild aus Debug-Cache übernommen.');
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'decode',
      'Decode',
      'Normalisiertes Eingabebild nach Resize und Alpha-Flattening.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Arbeitsgroesse', value: `${decoded.imageData.width} x ${decoded.imageData.height} px` },
      ],
      () => encodeRgbaDebugImage('Decode', decoded.imageData.width, decoded.imageData.height, decoded.imageData.data),
      0,
      true,
      options.onStageSnapshot,
    );
  } else {
    report('decode', 0, 'Bild wird fuer neue Region-First-Pipeline vorbereitet.');
    const decodeStarted = nowMs();
    decoded = preparedInput;
    if (
      decoded.imageData.width <= 0
      || decoded.imageData.height <= 0
      || decoded.imageData.data.length !== decoded.imageData.width * decoded.imageData.height * 4
    ) {
      throw new Error('Fresh pipeline received invalid prepared image dimensions or pixel data.');
    }
    addElapsedTiming(
      timings,
      'decode',
      Math.max(options.preparedDecodeDurationMs ?? 0, nowMs() - decodeStarted),
    );
    report('decode', 1, `Bild mit ${decoded.imageData.width}x${decoded.imageData.height} Pixeln vorbereitet.`);
    nextCache.decoded = decoded;
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'decode',
      'Decode',
      'Normalisiertes Eingabebild nach Resize und Alpha-Flattening.',
      settings,
      [
        { label: 'Arbeitsgroesse', value: `${decoded.imageData.width} x ${decoded.imageData.height} px` },
        { label: 'Fresh-Resize-Limit', value: `${Math.min(settings.resizeImageWidth, WORK_MAX_EDGE)} x ${Math.min(settings.resizeImageHeight, WORK_MAX_EDGE)} px` },
      ],
      () => encodeRgbaDebugImage('Decode', decoded.imageData.width, decoded.imageData.height, decoded.imageData.data),
      timings.decode,
      false,
      options.onStageSnapshot,
    );
  }
  rememberSignature('decode', decodeSignature);
  await yieldAndCheckCancellation(options);

  const { width, height } = decoded.imageData;
  const tokenPolicy = tokenPolicyForColorCount(targetColorCount);
  const kmeansSignature = signature([
    decodeSignature,
    tokenPolicy.lumaBins,
    tokenPolicy.chromaBins,
    TOKEN_CHROMA_RANGE,
    PALETTE_WEIGHT_POWER,
    'perceptual-tokens-v3',
  ]);
  let smoothed: Uint8ClampedArray;
  let tokenComponents: Components;
  if (
    canUseCachedStage(
      'kmeans',
      kmeansSignature,
      previousCache?.smoothed != null && previousCache.tokenComponents != null,
    )
  ) {
    smoothed = previousCache?.smoothed as Uint8ClampedArray;
    tokenComponents = previousCache?.tokenComponents as Components;
    nextCache.smoothed = smoothed;
    nextCache.tokenComponents = tokenComponents;
    addElapsedTiming(timings, 'kmeans', 0);
    report('kmeans', 1, 'Fresh-Tokenisierung aus Debug-Cache übernommen.');
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'kmeans',
      'Fresh Tokenisierung',
      'Kantenbewusst geglaettetes Bild und detailabhaengige Helligkeits-/Chroma-Token als Startregionen.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Farb-Token', value: String(tokenPolicy.colorCount) },
        { label: 'Token-Raster', value: `${tokenPolicy.lumaBins} x ${tokenPolicy.chromaBins} x ${tokenPolicy.chromaBins}` },
        { label: 'Startregionen', value: String(tokenComponents.labels.length) },
      ],
      () => encodeRgbaDebugImage('Fresh Tokenisierung', width, height, smoothed),
      0,
      true,
      options.onStageSnapshot,
    );
  } else {
    report('kmeans', 0.1, 'Farben werden kantenbewusst geglaettet.');
    const colorStarted = nowMs();
    smoothed = edgePreservingSmooth(decoded.imageData);
    report('kmeans', 0.45, `${tokenPolicy.colorCount} wahrnehmungsnahe Farb-Token werden aufgebaut.`);
    const tokenLabels = buildTokenLabels(smoothed, width, height, tokenPolicy);
    report('kmeans', 0.7, 'Zusammenhaengende Farbregionen werden gesucht.');
    tokenComponents = connectedComponentsForLabels(
      tokenLabels,
      tokenPolicy.colorCount,
      width,
      height,
      smoothed,
    );
    report('kmeans', 0.9, `${tokenComponents.labels.length} Startregionen gefunden.`);
    addTiming(timings, 'kmeans', colorStarted);
    nextCache.smoothed = smoothed;
    nextCache.tokenComponents = tokenComponents;
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'kmeans',
      'Fresh Tokenisierung',
      'Kantenbewusst geglaettetes Bild und detailabhaengige Helligkeits-/Chroma-Token als Startregionen.',
      settings,
      [
        { label: 'Farb-Token', value: String(tokenPolicy.colorCount) },
        { label: 'Token-Raster', value: `${tokenPolicy.lumaBins} x ${tokenPolicy.chromaBins} x ${tokenPolicy.chromaBins}` },
        { label: 'Startregionen', value: String(tokenComponents.labels.length) },
      ],
      () => encodeRgbaDebugImage('Fresh Tokenisierung', width, height, smoothed),
      timings.kmeans,
      false,
      options.onStageSnapshot,
    );
  }
  assertValidComponents(tokenComponents, width * height, 'kmeans');
  rememberSignature('kmeans', kmeansSignature);
  await yieldAndCheckCancellation(options);

  const colorMapSignature = signature([kmeansSignature, targetColorCount, settings.randomSeed, 'palette-v2']);
  let labelMap: LabelMap;
  let paletteRgb: Float32Array;
  if (canUseCachedStage('colorMap', colorMapSignature, previousCache?.colorMap != null)) {
    const cached = previousCache?.colorMap as FreshLabelDebugState;
    labelMap = cached.labelMap;
    paletteRgb = cached.paletteRgb;
    nextCache.colorMap = cached;
    addElapsedTiming(timings, 'colorMap', 0);
    report('colorMap', 1, 'Fresh-Zielpalette aus Debug-Cache übernommen.');
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'colorMap',
      'Color Map',
      'Regionengewichtete Zielpalette und erstes Ziel-Farblabelbild.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Zielfarben', value: String(targetColorCount) },
      ],
      () => renderFreshDebugImage('Color Map', labelMap, paletteRgb, width, height),
      0,
      true,
      options.onStageSnapshot,
    );
  } else {
    report('colorMap', 0, `${targetColorCount} Zielfarben werden regionengewichtet gelernt.`);
    const paletteStarted = nowMs();
    const paletteModel = weightedPaletteKMeans(
      tokenComponents.meanRgb,
      tokenComponents.areas,
      targetColorCount,
      settings.randomSeed,
    );
    labelMap = labelMapFromComponents(tokenComponents.componentMap, paletteModel.componentLabels);
    paletteRgb = paletteModel.paletteRgb;
    addTiming(timings, 'colorMap', paletteStarted);
    report('colorMap', 1, `${paletteRgb.length / 3} von ${targetColorCount} Zielfarben gelernt.`);
    nextCache.colorMap = { labelMap, paletteRgb };
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'colorMap',
      'Color Map',
      'Regionengewichtete Zielpalette und erstes Ziel-Farblabelbild.',
      settings,
      [
        { label: 'Zielfarben', value: String(targetColorCount) },
        { label: 'Startregionen', value: String(tokenComponents.labels.length) },
        { label: 'Seed', value: String(settings.randomSeed) },
      ],
      () => renderFreshDebugImage('Color Map', labelMap, paletteRgb, width, height),
      timings.colorMap,
      false,
      options.onStageSnapshot,
    );
  }
  rememberSignature('colorMap', colorMapSignature);
  const paletteColorCount = paletteRgb.length / 3;
  assertValidLabelMap(labelMap, paletteColorCount, width, height, 'colorMap');
  await yieldAndCheckCancellation(options);

  const narrowExtraRuns = Math.max(0, Math.floor(settings.narrowPixelStripCleanupRuns));
  const narrowTotalRuns = MAJORITY_FILTER_RUNS + narrowExtraRuns;
  const narrowSignature = signature([
    colorMapSignature,
    narrowTotalRuns,
    SOURCE_AWARE_MAJORITY_RGB_TOLERANCE,
    SOURCE_AWARE_MAJORITY_ABSOLUTE_RGB_LIMIT,
  ]);
  if (canUseCachedStage('narrowCleanup', narrowSignature, previousCache?.afterNarrowCleanup != null)) {
    const cached = previousCache?.afterNarrowCleanup as FreshLabelDebugState;
    labelMap = cached.labelMap;
    paletteRgb = cached.paletteRgb;
    nextCache.afterNarrowCleanup = cached;
    addElapsedTiming(timings, 'narrowCleanup', 0);
    report('narrowCleanup', 1, 'Fresh-Majority-Cleanup aus Debug-Cache übernommen.');
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'narrowCleanup',
      'Narrow Cleanup',
      'Source-aware Majority-Filter fuer lokale Pixelinseln.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Basis-Runs', value: String(MAJORITY_FILTER_RUNS) },
        { label: 'Zusatz-Runs', value: String(narrowExtraRuns) },
      ],
      () => renderFreshDebugImage('Narrow Cleanup', labelMap, paletteRgb, width, height),
      0,
      true,
      options.onStageSnapshot,
    );
  } else {
    report('narrowCleanup', 0, 'Lokale Pixelinseln werden beruhigt.');
    const majorityStarted = nowMs();
    labelMap = majorityFilterLabels(
      labelMap,
      width,
      height,
      paletteColorCount,
      narrowTotalRuns,
      smoothed,
      paletteRgb,
    );
    addTiming(timings, 'narrowCleanup', majorityStarted);
    report('narrowCleanup', 1, 'Lokale Pixelinseln beruhigt.');
    nextCache.afterNarrowCleanup = { labelMap, paletteRgb };
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'narrowCleanup',
      'Narrow Cleanup',
      'Source-aware Majority-Filter fuer lokale Pixelinseln.',
      settings,
      [
        { label: 'Basis-Runs', value: String(MAJORITY_FILTER_RUNS) },
        { label: 'Zusatz-Runs', value: String(narrowExtraRuns) },
        { label: 'Gesamt-Runs', value: String(narrowTotalRuns) },
      ],
      () => renderFreshDebugImage('Narrow Cleanup', labelMap, paletteRgb, width, height),
      timings.narrowCleanup,
      false,
      options.onStageSnapshot,
    );
  }
  assertValidLabelMap(labelMap, paletteColorCount, width, height, 'narrowCleanup');
  rememberSignature('narrowCleanup', narrowSignature);
  await yieldAndCheckCancellation(options);

  const borderSegmentRuns = Math.max(0, Math.floor(settings.nrOfTimesToHalveBorderSegments));
  const borderSegmentSignature = signature([narrowSignature, borderSegmentRuns]);
  if (canUseCachedStage('borderSegment', borderSegmentSignature, previousCache?.afterBorderSegment != null)) {
    const cached = previousCache?.afterBorderSegment as FreshLabelDebugState;
    labelMap = cached.labelMap;
    paletteRgb = cached.paletteRgb;
    nextCache.afterBorderSegment = cached;
    addElapsedTiming(timings, 'borderSegment', 0);
    report('borderSegment', 1, 'Fresh-Border-Segment aus Debug-Cache übernommen.');
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'borderSegment',
      'Border Segment',
      'Optionaler Fresh-Zusatzfilter vor dem Aufbau finaler Regionen.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Zusatz-Runs', value: String(borderSegmentRuns) },
      ],
      () => renderFreshDebugImage('Border Segment', labelMap, paletteRgb, width, height),
      0,
      true,
      options.onStageSnapshot,
    );
  } else {
    report('borderSegment', 0, 'Fresh-Zusatzfilter vor dem Region-Build wird angewendet.');
    const borderSegmentStarted = nowMs();
    if (borderSegmentRuns > 0) {
      labelMap = majorityFilterLabels(
        labelMap,
        width,
        height,
        paletteColorCount,
        borderSegmentRuns,
        smoothed,
        paletteRgb,
      );
    }
    addTiming(timings, 'borderSegment', borderSegmentStarted);
    report('borderSegment', 1, borderSegmentRuns > 0 ? 'Fresh-Zusatzfilter angewendet.' : 'Fresh-Zusatzfilter uebersprungen.');
    nextCache.afterBorderSegment = { labelMap, paletteRgb };
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'borderSegment',
      'Border Segment',
      'Optionaler Fresh-Zusatzfilter vor dem Aufbau finaler Regionen.',
      settings,
      [
        { label: 'Zusatz-Runs', value: String(borderSegmentRuns) },
        { label: 'Status', value: borderSegmentRuns > 0 ? 'Angewendet' : 'Keine Zusatz-Runs' },
      ],
      () => renderFreshDebugImage('Border Segment', labelMap, paletteRgb, width, height),
      timings.borderSegment,
      false,
      options.onStageSnapshot,
    );
  }
  assertValidLabelMap(labelMap, paletteColorCount, width, height, 'borderSegment');
  rememberSignature('borderSegment', borderSegmentSignature);
  await yieldAndCheckCancellation(options);

  const regionPolicy = regionPolicyForColorCount(targetColorCount);
  const freshPolicyMinArea = Math.max(
    regionPolicy.minRegionPixels,
    Math.round(width * height * regionPolicy.minRegionRatio),
  );
  const settingsMinArea = Math.max(0, Math.round(width * height * settings.removeFacetsSmallerThanImageRatio));
  const minRegionArea = Math.max(freshPolicyMinArea, settingsMinArea);
  const facetBuildSignature = signature([borderSegmentSignature, paletteColorCount, 'components-v2']);

  let regionComponents: Components;
  if (canUseCachedStage('facetBuild', facetBuildSignature, previousCache?.beforeFacetReduce != null)) {
    const cached = previousCache?.beforeFacetReduce as FreshRegionDebugState;
    paletteRgb = cached.paletteRgb;
    regionComponents = cached.components;
    labelMap = labelMapFromComponents(regionComponents.componentMap, regionComponents.labels);
    nextCache.beforeFacetReduce = cached;
    addElapsedTiming(timings, 'facetBuild', 0);
    report('facetBuild', 1, 'Fresh-Regionen aus Debug-Cache übernommen.');
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'facetBuild',
      'Facet Build',
      'Zusammenhaengende Ziel-Farbregionen vor der Reduktion.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Regionen vor Merge', value: String(regionComponents.labels.length) },
        { label: 'Mindestflaeche', value: `${minRegionArea} px` },
      ],
      () => renderFreshDebugImage('Facet Build', labelMap, paletteRgb, width, height, regionComponents, 'debugRegions'),
      0,
      true,
      options.onStageSnapshot,
    );
  } else {
    report('facetBuild', 0, 'Finale Farbregionen werden aufgebaut.');
    const facetBuildStarted = nowMs();
    regionComponents = connectedComponentsForLabels(labelMap, paletteColorCount, width, height);
    addTiming(timings, 'facetBuild', facetBuildStarted);
    report('facetBuild', 1, `${regionComponents.labels.length} Farbregionen erkannt.`);
    nextCache.beforeFacetReduce = { paletteRgb, components: regionComponents };
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'facetBuild',
      'Facet Build',
      'Zusammenhaengende Ziel-Farbregionen vor der Reduktion.',
      settings,
      [
        { label: 'Regionen vor Merge', value: String(regionComponents.labels.length) },
        { label: 'Fresh-Policy-Min', value: `${freshPolicyMinArea} px` },
        { label: 'Settings-Min', value: `${settingsMinArea} px` },
      ],
      () => renderFreshDebugImage('Facet Build', labelMap, paletteRgb, width, height, regionComponents, 'debugRegions'),
      timings.facetBuild,
      false,
      options.onStageSnapshot,
    );
  }
  assertValidComponents(regionComponents, width * height, 'facetBuild');
  rememberSignature('facetBuild', facetBuildSignature);
  await yieldAndCheckCancellation(options);

  const regionCountBeforeReduce = regionComponents.labels.length;
  let paletteUsageReintroducedCount = 0;
  let easyLandmarkCandidateCount = 0;
  let easyLandmarkRestoredCount = 0;
  let easyLandmarkRestoredPixelCount = 0;
  let totalMergeCount = 0;
  let totalGlobalReassignCount = 0;
  let totalProtectedSmall = 0;
  let finalSmallRemaining = 0;
  let facetBudgetSatisfied = true;
  let forcedBudgetMergeCount = 0;
  const maximumNumberOfFacets = Math.max(0, Math.floor(settings.maximumNumberOfFacets));
  const facetReduceSignature = signature([
    facetBuildSignature,
    minRegionArea,
    maximumNumberOfFacets,
    regionPolicy.detailProtectMinPixels,
    TINY_MERGE_PASSES,
    FINAL_SPECKLE_PASSES,
    EASY_LANDMARK_MIN_PIXELS,
    EASY_LANDMARK_MAX_COUNT,
    EASY_LANDMARK_MAX_AREA_MULTIPLIER,
    EASY_LANDMARK_MAX_SPAN,
    EASY_LANDMARK_MIN_FILL_RATIO,
    EASY_LANDMARK_MAX_ASPECT_RATIO,
    EASY_LANDMARK_MIN_ENCLOSURE,
    EASY_LANDMARK_MIN_COMPACTNESS,
    EASY_LANDMARK_MIN_SOURCE_LAB_DISTANCE,
    EASY_LANDMARK_MAX_PALETTE_LAB_DISTANCE,
    EASY_LANDMARK_MIN_OUTPUT_LAB_DISTANCE,
    'stable-target-v3-easy-landmarks',
  ]);
  if (canUseCachedStage('facetReduce', facetReduceSignature, previousCache?.afterFacetReduce != null)) {
    const cached = previousCache?.afterFacetReduce as FreshRegionDebugState;
    paletteRgb = cached.paletteRgb;
    regionComponents = cached.components;
    labelMap = labelMapFromComponents(regionComponents.componentMap, regionComponents.labels);
    nextCache.afterFacetReduce = cached;
    addElapsedTiming(timings, 'facetReduce', 0);
    report('facetReduce', 1, 'Fresh-Regionen nach Reduktion aus Debug-Cache übernommen.');
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'facetReduce',
      'Facet Reduce',
      'Source-aware Merge kleiner Restregionen und optionales Flaechenbudget.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Regionen', value: String(regionComponents.labels.length) },
        { label: 'Mindestflaeche', value: `${minRegionArea} px` },
      ],
      () => renderFreshDebugImage('Facet Reduce', labelMap, paletteRgb, width, height, regionComponents, 'debugRegions'),
      0,
      true,
      options.onStageSnapshot,
    );
  } else {
    report('facetReduce', 0, 'Kleine Restregionen werden gemerged.');
    const reduceStarted = nowMs();
    const accumulateMerge = (mergeResult: MergeResult): void => {
      totalMergeCount += mergeResult.mergeCount;
      totalGlobalReassignCount += mergeResult.globalReassignCount;
      totalProtectedSmall = mergeResult.protectedSmall;
      finalSmallRemaining = mergeResult.smallRemaining;
    };
    let merge = await mergeTinyRegions(
      labelMap,
      smoothed,
      paletteRgb,
      width,
      height,
      minRegionArea,
      TINY_MERGE_PASSES,
      SPECKLE_REGION_PIXELS,
      regionPolicy.detailProtectMinPixels,
      DETAIL_PROTECT_LAB_DISTANCE,
      options,
    );
    accumulateMerge(merge);
    labelMap = majorityFilterLabels(
      merge.labelMap,
      width,
      height,
      paletteColorCount,
      POST_MAJORITY_FILTER_RUNS,
      smoothed,
      paletteRgb,
    );
    merge = await mergeTinyRegions(
      labelMap,
      smoothed,
      paletteRgb,
      width,
      height,
      minRegionArea,
      Math.max(4, Math.floor(TINY_MERGE_PASSES / 2)),
      SPECKLE_REGION_PIXELS,
      regionPolicy.detailProtectMinPixels,
      DETAIL_PROTECT_LAB_DISTANCE,
      options,
    );
    accumulateMerge(merge);
    labelMap = majorityFilterLabels(
      merge.labelMap,
      width,
      height,
      paletteColorCount,
      FINAL_MAJORITY_FILTER_RUNS,
      smoothed,
      paletteRgb,
    );
    merge = await mergeTinyRegions(
      labelMap,
      smoothed,
      paletteRgb,
      width,
      height,
      SPECKLE_REGION_PIXELS,
      FINAL_SPECKLE_PASSES,
      SPECKLE_REGION_PIXELS,
      DETAIL_SPECKLE_PROTECT_MIN_PIXELS,
      DETAIL_SPECKLE_PROTECT_LAB_DISTANCE,
      options,
    );
    accumulateMerge(merge);
    labelMap = merge.labelMap;
    if (maximumNumberOfFacets > 0) {
      const budgetResult = await enforceFacetBudget(
        labelMap,
        smoothed,
        paletteRgb,
        width,
        height,
        maximumNumberOfFacets,
        options,
      );
      labelMap = budgetResult.labelMap;
      forcedBudgetMergeCount = budgetResult.mergeCount;
      totalMergeCount += budgetResult.mergeCount;
      facetBudgetSatisfied = budgetResult.satisfied;
      if (!budgetResult.satisfied) {
        throw new Error(
          `Fresh facet budget could not be satisfied: ${budgetResult.componentCount} regions remain above ${maximumNumberOfFacets}.`,
        );
      }
    }
    const paletteUsage = ensureTargetPaletteUsage(
      labelMap,
      smoothed,
      paletteRgb,
      width,
      height,
      paletteColorCount,
      minRegionArea,
    );
    paletteUsageReintroducedCount = paletteUsage.reintroducedCount;
    labelMap = paletteUsage.labelMap;
    if (targetColorCount <= 11) {
      const landmarkRestore = restoreEasyLandmarks(
        labelMap,
        tokenComponents,
        paletteRgb,
        width,
        height,
        minRegionArea,
      );
      easyLandmarkCandidateCount = landmarkRestore.candidateCount;
      easyLandmarkRestoredCount = landmarkRestore.restoredCount;
      easyLandmarkRestoredPixelCount = landmarkRestore.restoredPixelCount;
      labelMap = landmarkRestore.labelMap;
      if (maximumNumberOfFacets > 0 && landmarkRestore.restoredCount > 0) {
        const budgetResult = await enforceFacetBudget(
          labelMap,
          smoothed,
          paletteRgb,
          width,
          height,
          maximumNumberOfFacets,
          options,
        );
        labelMap = budgetResult.labelMap;
        forcedBudgetMergeCount += budgetResult.mergeCount;
        totalMergeCount += budgetResult.mergeCount;
        facetBudgetSatisfied = budgetResult.satisfied;
        if (!budgetResult.satisfied) {
          throw new Error(
            `Fresh facet budget could not be satisfied after landmark restoration: ${budgetResult.componentCount} regions remain above ${maximumNumberOfFacets}.`,
          );
        }
      }
    }
    paletteRgb = recomputePalette(smoothed, labelMap, paletteColorCount);
    regionComponents = connectedComponentsForLabels(labelMap, paletteColorCount, width, height);
    addTiming(timings, 'facetReduce', reduceStarted);
    report(
      'facetReduce',
      1,
      `${regionComponents.labels.length} finale Regionen erzeugt${paletteUsage.reintroducedCount > 0 ? `, ${paletteUsage.reintroducedCount} Zielfarben reaktiviert` : ''}${easyLandmarkRestoredCount > 0 ? `, ${easyLandmarkRestoredCount} Easy-Landmarks restauriert` : ''}.`,
    );
    nextCache.afterFacetReduce = { paletteRgb, components: regionComponents };
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'facetReduce',
      'Facet Reduce',
      'Source-aware Merge kleiner Restregionen und optionales Flaechenbudget.',
      settings,
      [
        { label: 'Regionen vor Merge', value: String(regionCountBeforeReduce) },
        { label: 'Regionen nach Merge', value: String(regionComponents.labels.length) },
        { label: 'Mindestflaeche', value: `${minRegionArea} px` },
        { label: 'Merges', value: String(totalMergeCount) },
        { label: 'Globale Reassigns', value: String(totalGlobalReassignCount) },
        { label: 'Geschuetzte kleine Regionen', value: String(totalProtectedSmall) },
        { label: 'Kleine Restregionen', value: String(finalSmallRemaining) },
        { label: 'Reaktivierte Farben', value: String(paletteUsageReintroducedCount) },
        { label: 'Easy-Landmark-Kandidaten', value: String(easyLandmarkCandidateCount) },
        { label: 'Restaurierte Easy-Landmarks', value: String(easyLandmarkRestoredCount) },
        { label: 'Restaurierte Landmark-Pixel', value: String(easyLandmarkRestoredPixelCount) },
        { label: 'Budget-Merges', value: String(forcedBudgetMergeCount) },
        {
          label: 'Flaechenbudget',
          value: maximumNumberOfFacets <= 0
            ? 'Deaktiviert'
            : facetBudgetSatisfied
              ? `Erfuellt (<= ${maximumNumberOfFacets})`
              : `Nicht erreichbar (${regionComponents.labels.length} > ${maximumNumberOfFacets})`,
        },
      ],
      () => renderFreshDebugImage('Facet Reduce', labelMap, paletteRgb, width, height, regionComponents, 'debugRegions'),
      timings.facetReduce,
      false,
      options.onStageSnapshot,
    );
  }
  assertValidLabelMap(labelMap, paletteColorCount, width, height, 'facetReduce');
  assertValidComponents(regionComponents, width * height, 'facetReduce');
  facetBudgetSatisfied = maximumNumberOfFacets <= 0 || regionComponents.labels.length <= maximumNumberOfFacets;
  rememberSignature('facetReduce', facetReduceSignature);
  await yieldAndCheckCancellation(options);

  report('borderTrace', 0, 'Geglaettete Grenzen werden vorbereitet.');
  const borderStarted = nowMs();
  const regionMap = regionComponents.componentMap;
  const boundaries = boundaryMask(regionMap, width, height);
  addTiming(timings, 'borderTrace', borderStarted);
  report('borderTrace', 1, 'Grenzen vorbereitet.');
  const boundaryPixelCount = boundaries.reduce((sum, value) => sum + (value === 2 ? 1 : 0), 0);
  await pushFreshDebugSnapshot(
    debugSnapshots,
    'borderTrace',
    'Border Trace',
    'Boundary-Layer der finalen Fresh-Regionen.',
    settings,
    [
      { label: 'Regionen', value: String(regionComponents.labels.length) },
      { label: 'Boundary-Pixel', value: String(boundaryPixelCount) },
    ],
    () => renderFreshDebugImage('Border Trace', labelMap, paletteRgb, width, height, regionComponents, 'boundaries'),
    timings.borderTrace,
    false,
    options.onStageSnapshot,
  );
  const borderTraceSignature = signature([facetReduceSignature, boundaryPixelCount, 'boundary-v2']);
  rememberSignature('borderTrace', borderTraceSignature);
  await yieldAndCheckCancellation(options);

  let markerPlacements: MarkerPlacement[];
  const labelPlacementSignature = signature([facetReduceSignature, 'distance-transform-v2']);
  if (canUseCachedStage('labelPlacement', labelPlacementSignature, previousCache?.markerPlacements != null)) {
    markerPlacements = previousCache?.markerPlacements as MarkerPlacement[];
    nextCache.markerPlacements = markerPlacements;
    addElapsedTiming(timings, 'labelPlacement', 0);
    report('labelPlacement', 1, 'Farbpunkte aus Debug-Cache übernommen.');
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'labelPlacement',
      'Label Placement',
      'Farbpunktpositionen fuer die finalen Fresh-Regionen.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Marker', value: `${markerPlacements.length} / ${regionComponents.labels.length}` },
      ],
      () => renderFreshDebugImage('Label Placement', labelMap, paletteRgb, width, height, regionComponents, 'boundaries', markerPlacements),
      0,
      true,
      options.onStageSnapshot,
    );
  } else {
    report('labelPlacement', 0, 'Farbpunkte werden in den Regionen platziert.');
    const labelStarted = nowMs();
    markerPlacements = computeMarkerPlacements(regionComponents, width, height);
    addTiming(timings, 'labelPlacement', labelStarted);
    report('labelPlacement', 1, `${markerPlacements.length} Farbpunkte platziert.`);
    nextCache.markerPlacements = markerPlacements;
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'labelPlacement',
      'Label Placement',
      'Farbpunktpositionen fuer die finalen Fresh-Regionen.',
      settings,
      [
        { label: 'Marker', value: `${markerPlacements.length} / ${regionComponents.labels.length}` },
      ],
      () => renderFreshDebugImage('Label Placement', labelMap, paletteRgb, width, height, regionComponents, 'boundaries', markerPlacements),
      timings.labelPlacement,
      false,
      options.onStageSnapshot,
    );
  }
  rememberSignature('labelPlacement', labelPlacementSignature);
  await yieldAndCheckCancellation(options);

  report('svgRender', 0, 'Neue Pipeline-Ausgaben werden gerendert.');
  const renderStarted = nowMs();
  const selectedVariantIds = options.variantIds ?? DEFAULT_FRESH_OUTPUT_VARIANT_IDS;
  const renderConfigs = FRESH_RENDER_VARIANTS.filter((config) => selectedVariantIds.includes(config.id));
  if (renderConfigs.length === 0) {
    throw new Error('No fresh pipeline render variants selected.');
  }
  const variants: GeneratorOutputVariant[] = [];
  for (let index = 0; index < renderConfigs.length; index += 1) {
    const config = renderConfigs[index];
    const base64 = pngBase64FromRgba(
      width,
      height,
      renderRgba(labelMap, regionMap, paletteRgb, width, height, config, markerPlacements, boundaries),
    );
    const svg = renderFreshVectorSvg(config, labelMap, regionMap, paletteRgb, width, height, markerPlacements);
    variants.push(createVariant(config, base64, svg, width, height));
    report('svgRender', (index + 1) / renderConfigs.length, `${config.label} gerendert.`);
    await yieldAndCheckCancellation(options);
  }
  const defaultVariant = variants.find((variant) => variant.isDefault) ?? variants[0];
  if (defaultVariant?.pngBase64 == null || defaultVariant.svg == null) {
    throw new Error('Fresh pipeline did not render a default output variant.');
  }
  addTiming(timings, 'svgRender', renderStarted);
  report('svgRender', 1, 'Neue Pipeline-Ausgaben gerendert.');
  rememberSignature('svgRender', signature([labelPlacementSignature, ...selectedVariantIds, 'vector-svg-v2']));
  await pushFreshDebugSnapshot(
    debugSnapshots,
    'svgRender',
    'SVG Render',
    'Final gerenderte Fresh-Debug-Ausgabe.',
    settings,
    [
      { label: 'Varianten', value: String(variants.length) },
      { label: 'Finale Variante', value: defaultVariant.label },
      { label: 'Output', value: `${width} x ${height} px` },
    ],
    {
      label: defaultVariant.label,
      pngBase64: defaultVariant.pngBase64,
      width,
      height,
      byteLength: defaultVariant.pngByteLength,
    },
    timings.svgRender,
    false,
    options.onStageSnapshot,
  );

  onProgress?.({
    stage: 'done',
    progress: 100,
    message: 'Malvorlage mit neuer Pipeline fertig.',
  });

  const previewPngBase64 = defaultVariant.pngBase64;
  const svg = defaultVariant.svg;

  if (debugEnabled) {
    options.debug?.onCacheUpdated?.(nextCache);
  }

  return {
    svg,
    previewPngBase64,
    previewPngWidth: width,
    previewPngHeight: height,
    variants,
    svgWidth: width,
    svgHeight: height,
    imageWidth: width,
    imageHeight: height,
    facetCount: regionComponents.labels.length,
    palette: buildPaletteStats(labelMap, paletteRgb),
    timings,
    preparedImage: decoded.prepared,
    debug: debugEnabled
      ? {
          enabled: true,
          rerunFromStage: options.debug?.rerunFromStage,
          finalVariantId: defaultVariant?.id ?? variants[0]?.id ?? 'cleanColor',
          parameterConfig: { ...settings },
          stages: debugSnapshots ?? [],
        }
      : undefined,
  };
}

export async function generatePaintByNumbersFreshFromPreparedInput(
  preparedInput: PreparedFreshGeneratorImage,
  settings: GeneratorSettings,
  onProgress?: (progress: GeneratorProgress) => void,
  options: GeneratePaintByNumbersOptions = {},
): Promise<GeneratorResult> {
  return generatePaintByNumbersInternal(preparedInput, settings, onProgress, options);
}
