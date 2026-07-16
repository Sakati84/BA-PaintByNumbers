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
import { canFitNumberGlyph, fallbackColorDotRadius } from './freshMarkerSizing';
import { renderFreshVectorSvg } from './freshVectorRenderer';

const WORK_MAX_EDGE = 1400;
const FRESH_PIPELINE_CACHE_VERSION = 10;
const TOKEN_CHROMA_RANGE = 96;
const PALETTE_WEIGHT_POWER = 0.78;
const MAJORITY_FILTER_RUNS = 2;
const POST_MAJORITY_FILTER_RUNS = 1;
const FINAL_MAJORITY_FILTER_RUNS = 1;
const EASY_MIN_REGION_RATIO = 0.00022;
const MEDIUM_MIN_REGION_RATIO = 0.00014;
const EXPERT_MIN_REGION_RATIO = 0.00012;
const EASY_MIN_REGION_PIXELS = 220;
const MEDIUM_MIN_REGION_PIXELS = 130;
const EXPERT_MIN_REGION_PIXELS = 72;
const TINY_MERGE_PASSES = 12;
const SPECKLE_REGION_PIXELS = 48;
const FINAL_SPECKLE_PASSES = 8;
const DEFAULT_ATTACHED_PROTRUSION_OPENING_RUNS = 1;
const TERMINAL_PAINTABILITY_MAX_ROUNDS = 6;
const PAINTABILITY_FILL_MAX_ROUNDS = 24;
const ATTACHED_PROTRUSION_MIN_SPAN = 4;
const ATTACHED_PROTRUSION_MAX_BBOX_THICKNESS = 2.5;
const ATTACHED_PROTRUSION_MAX_HYDRAULIC_DIAMETER = 5;
const HARD_UNPAINTABLE_MAX_BBOX_THICKNESS = 2.5;
const HARD_UNPAINTABLE_MAX_HYDRAULIC_DIAMETER = 5;
const SOFT_THIN_MAX_AREA_MULTIPLIER = 2;
const SOFT_THIN_MAX_BBOX_THICKNESS = 5.5;
const SOFT_THIN_MAX_HYDRAULIC_DIAMETER = 11;
const SOFT_THIN_MAX_SOURCE_LAB_INCREASE = 14;
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
const EXPERT_PRODUCTION_MIN_REGION_RATIO = 0.0003;
const EXPERT_DETAIL_MIN_PIXELS = 18;
const EXPERT_DETAIL_MAX_COUNT = 6;
const EXPERT_DETAIL_MAX_AREA_MULTIPLIER = 20;
const EXPERT_DETAIL_MAX_AREA_RATIO = 0.02;
const EXPERT_DETAIL_MAX_TOTAL_AREA_RATIO = 0.015;
const EXPERT_DETAIL_MAX_SPAN = 260;
const EXPERT_DETAIL_MAX_ASPECT_RATIO = 5;
const EXPERT_DETAIL_MIN_FILL_RATIO = 0.16;
const EXPERT_DETAIL_MIN_ENCLOSURE = 0.28;
const EXPERT_DETAIL_MIN_COMPACTNESS = 0.02;
const EXPERT_DETAIL_MIN_SOURCE_LAB_DISTANCE = 10;
const EXPERT_DETAIL_MAX_PALETTE_LAB_DISTANCE = 32;
const EXPERT_DETAIL_MIN_OUTPUT_LAB_DISTANCE = 8;
const EXPERT_DETAIL_ALREADY_PRESENT_SHARE = 0.6;
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

const DIGIT_PATTERNS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
};

const DEFAULT_FRESH_OUTPUT_VARIANT_IDS: readonly GeneratorOutputVariantId[] = [
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

type PipelineStage = Exclude<GeneratorStage, 'done'>;
type LabelMap = Uint8Array;
type TokenLabelMap = Uint16Array;

type TokenPolicy = {
  lumaBins: number;
  chromaBins: number;
  colorCount: number;
};

export type FreshPaintabilityProfileId =
  | 'current'
  | 'opening-v1'
  | 'opening-v1-bands'
  | 'opening-v1-coarse'
  | 'classic-balanced'
  | 'classic-strong'
  | 'classic-strong-coarse'
  | 'classic-safe'
  | 'classic-production';

type ProtrusionCandidateMode = 'attached' | 'unrestricted';

type GradientBandPolicy = {
  maxBboxThickness: number;
  maxHydraulicDiameter: number;
  minLongestSpan: number;
  minElongation: number;
  maxAreaRatio: number;
  minTopTwoBoundaryShare: number;
  minSecondBoundaryShare: number;
  minSecondBoundaryPixels: number;
  minDominantBoundaryShare: number;
  maxDominantSourceLabDistance: number;
  maxBoundaryDirectionCosine: number;
  minNeighborPairLabDistance: number;
  maxLabLineResidual: number;
  maxSourceLabIncrease: number;
  maxPasses: number;
};

type FreshPaintabilityPolicy = {
  id: FreshPaintabilityProfileId;
  expertTokenBins?: readonly [lumaBins: number, chromaBins: number];
  expertMinRegionRatio?: number;
  earlyOpeningRuns: number;
  earlyOpeningMode: ProtrusionCandidateMode;
  earlyOpeningForcePaintability: boolean;
  postMergeOpeningRuns: number;
  terminalOpening: boolean;
  scaleMergeAllCandidates: boolean;
  guardSoftThinSourceFit: boolean;
  softThinUsesBaselineArea: boolean;
  gradientBandAfterPrimaryMerge: boolean;
  gradientBand?: GradientBandPolicy;
};

const CLASSIC_GRADIENT_BAND_POLICY: GradientBandPolicy = {
  maxBboxThickness: 8,
  maxHydraulicDiameter: 16,
  minLongestSpan: 12,
  minElongation: 4,
  maxAreaRatio: 0.003,
  minTopTwoBoundaryShare: 0.78,
  minSecondBoundaryShare: 0.2,
  minSecondBoundaryPixels: 6,
  minDominantBoundaryShare: 0.72,
  maxDominantSourceLabDistance: 10,
  maxBoundaryDirectionCosine: -0.15,
  minNeighborPairLabDistance: 6,
  maxLabLineResidual: 7,
  maxSourceLabIncrease: 18,
  maxPasses: 2,
};

const CLASSIC_STRONG_BAND_POLICY: GradientBandPolicy = {
  maxBboxThickness: 10,
  maxHydraulicDiameter: 20,
  minLongestSpan: 24,
  minElongation: 4,
  maxAreaRatio: 0.006,
  minTopTwoBoundaryShare: 0.55,
  minSecondBoundaryShare: 0.08,
  minSecondBoundaryPixels: 6,
  minDominantBoundaryShare: 0.65,
  maxDominantSourceLabDistance: 16,
  maxBoundaryDirectionCosine: 0,
  minNeighborPairLabDistance: 5,
  maxLabLineResidual: 10,
  maxSourceLabIncrease: 20,
  maxPasses: 2,
};

const CLASSIC_SAFE_BAND_POLICY: GradientBandPolicy = {
  maxBboxThickness: 10,
  maxHydraulicDiameter: 20,
  minLongestSpan: 24,
  minElongation: 4,
  maxAreaRatio: 0.008,
  minTopTwoBoundaryShare: 0.65,
  minSecondBoundaryShare: 0.14,
  minSecondBoundaryPixels: 8,
  minDominantBoundaryShare: 0.65,
  maxDominantSourceLabDistance: 12,
  maxBoundaryDirectionCosine: -0.15,
  minNeighborPairLabDistance: 6,
  maxLabLineResidual: 8,
  maxSourceLabIncrease: 12,
  maxPasses: 1,
};

function paintabilityPolicyForProfile(
  profile: FreshPaintabilityProfileId | undefined,
  colorCount: number,
): FreshPaintabilityPolicy {
  const resolvedProfile = profile ?? (colorCount >= 18 ? 'classic-production' : 'current');
  if (resolvedProfile === 'current' || (resolvedProfile === 'classic-production' && colorCount < 18)) {
    return {
      id: 'current',
      earlyOpeningRuns: 0,
      earlyOpeningMode: 'attached',
      earlyOpeningForcePaintability: false,
      postMergeOpeningRuns: DEFAULT_ATTACHED_PROTRUSION_OPENING_RUNS,
      terminalOpening: true,
      scaleMergeAllCandidates: false,
      guardSoftThinSourceFit: true,
      softThinUsesBaselineArea: false,
      gradientBandAfterPrimaryMerge: false,
    };
  }
  if (resolvedProfile === 'opening-v1') {
    return {
      id: resolvedProfile,
      earlyOpeningRuns: 1,
      earlyOpeningMode: 'unrestricted',
      earlyOpeningForcePaintability: true,
      postMergeOpeningRuns: 0,
      terminalOpening: false,
      scaleMergeAllCandidates: true,
      guardSoftThinSourceFit: false,
      softThinUsesBaselineArea: false,
      gradientBandAfterPrimaryMerge: false,
    };
  }
  if (resolvedProfile === 'opening-v1-bands') {
    return {
      id: resolvedProfile,
      earlyOpeningRuns: 1,
      earlyOpeningMode: 'unrestricted',
      earlyOpeningForcePaintability: true,
      postMergeOpeningRuns: 0,
      terminalOpening: false,
      scaleMergeAllCandidates: true,
      guardSoftThinSourceFit: false,
      softThinUsesBaselineArea: false,
      gradientBandAfterPrimaryMerge: false,
      gradientBand: CLASSIC_GRADIENT_BAND_POLICY,
    };
  }
  if (resolvedProfile === 'opening-v1-coarse') {
    return {
      id: resolvedProfile,
      expertTokenBins: [14, 7],
      earlyOpeningRuns: 1,
      earlyOpeningMode: 'unrestricted',
      earlyOpeningForcePaintability: true,
      postMergeOpeningRuns: 0,
      terminalOpening: false,
      scaleMergeAllCandidates: true,
      guardSoftThinSourceFit: false,
      softThinUsesBaselineArea: false,
      gradientBandAfterPrimaryMerge: false,
    };
  }
  if (resolvedProfile === 'classic-balanced') {
    return {
      id: resolvedProfile,
      expertTokenBins: [14, 7],
      earlyOpeningRuns: 1,
      earlyOpeningMode: 'unrestricted',
      earlyOpeningForcePaintability: true,
      postMergeOpeningRuns: 0,
      terminalOpening: false,
      scaleMergeAllCandidates: true,
      guardSoftThinSourceFit: false,
      softThinUsesBaselineArea: false,
      gradientBandAfterPrimaryMerge: false,
      gradientBand: CLASSIC_GRADIENT_BAND_POLICY,
    };
  }
  if (resolvedProfile === 'classic-strong' || resolvedProfile === 'classic-strong-coarse') {
    return {
      id: resolvedProfile,
      expertTokenBins: resolvedProfile === 'classic-strong-coarse' ? [14, 7] : undefined,
      earlyOpeningRuns: 1,
      earlyOpeningMode: 'unrestricted',
      earlyOpeningForcePaintability: true,
      postMergeOpeningRuns: 0,
      terminalOpening: false,
      scaleMergeAllCandidates: true,
      guardSoftThinSourceFit: false,
      softThinUsesBaselineArea: false,
      gradientBandAfterPrimaryMerge: false,
      gradientBand: CLASSIC_STRONG_BAND_POLICY,
    };
  }
  if (resolvedProfile === 'classic-safe' || resolvedProfile === 'classic-production') {
    return {
      id: resolvedProfile,
      expertMinRegionRatio:
        resolvedProfile === 'classic-production'
          ? EXPERT_PRODUCTION_MIN_REGION_RATIO
          : undefined,
      earlyOpeningRuns: 1,
      earlyOpeningMode: 'unrestricted',
      earlyOpeningForcePaintability: false,
      postMergeOpeningRuns: 0,
      terminalOpening: false,
      scaleMergeAllCandidates: true,
      guardSoftThinSourceFit: true,
      softThinUsesBaselineArea: true,
      gradientBandAfterPrimaryMerge: true,
      gradientBand: CLASSIC_SAFE_BAND_POLICY,
    };
  }
  throw new Error(`Unknown Fresh paintability profile: ${String(resolvedProfile)}`);
}

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
  paintabilityProfile?: FreshPaintabilityProfileId;
};

type Components = {
  componentMap: Int32Array;
  labels: Int32Array;
  areas: Int32Array;
  meanRgb: Float32Array;
  perimeter: Int32Array;
  hasCrossCore: Uint8Array;
  minX: Int32Array;
  minY: Int32Array;
  maxX: Int32Array;
  maxY: Int32Array;
};

type MergeResult = {
  labelMap: LabelMap;
  mergeCount: number;
  geometryMergeCount: number;
  gradientBandMergeCount: number;
  globalReassignCount: number;
  componentCount: number;
  smallRemaining: number;
  protectedSmall: number;
  hardUnpaintableRemaining: number;
  softThinRemaining: number;
};

type ComponentGeometry = {
  perimeter: Int32Array;
  hasCrossCore: Uint8Array;
  bboxAverageThickness: Float32Array;
  hydraulicDiameter: Float32Array;
};

type BoundaryContact = {
  count: number;
  sumX: number;
  sumY: number;
};

type BoundaryContacts = Map<number, Map<number, BoundaryContact>>;

export type ProtrusionPruneResult = {
  labelMap: LabelMap;
  candidatePixelCount: number;
  changedPixelCount: number;
  unresolvedPixelCount: number;
};

export type TerminalPaintabilityDecision = 'stable' | 'mutate' | 'exhausted';

export function terminalPaintabilityDecision(
  mutationRoundsUsed: number,
  candidatePixelCount: number,
  maxMutationRounds = TERMINAL_PAINTABILITY_MAX_ROUNDS,
): TerminalPaintabilityDecision {
  if (candidatePixelCount === 0) {
    return 'stable';
  }
  return mutationRoundsUsed < maxMutationRounds ? 'mutate' : 'exhausted';
}

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

type ExpertDetailCandidate = EasyLandmarkCandidate & {
  aspectRatio: number;
  centerBias: number;
};

type ExpertDetailRestoreResult = {
  labelMap: LabelMap;
  candidateCount: number;
  restoredCount: number;
  restoredPixelCount: number;
};

type Rgb = [number, number, number];

type FreshRenderFillMode = 'bright' | 'color' | 'white' | 'debug';
type FreshRenderBoundaryMode = 'none' | 'black' | 'color';
type FreshRenderMarkerMode = 'none' | 'circles' | 'numberedCircles' | 'numbers';

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
    id: 'brightColorCircles',
    label: 'Helle Malvorlage',
    description: 'Helle Flächen, schwarze Grenzen und Farbpunkte; Zahlen, wenn die Region genug Innenraum hat.',
    fillMode: 'bright',
    boundaryMode: 'black',
    markerMode: 'numberedCircles',
    isDefault: true,
  },
  {
    id: 'colorCircles',
    label: 'Farbige Vorlage',
    description: 'Originale Flächenfarben, schwarze Grenzen und Farbpunkte; Zahlen, wenn die Region genug Innenraum hat.',
    fillMode: 'color',
    boundaryMode: 'black',
    markerMode: 'numberedCircles',
  },
  {
    id: 'cleanColor',
    label: 'Fresh Clean',
    description: 'Region-First-Farbflächen ohne Grenzen oder Marker.',
    fillMode: 'color',
    boundaryMode: 'none',
    markerMode: 'none',
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
    id: 'numbers',
    label: 'Zahlen / Farbpunkte',
    description: 'Weiße Vorlage mit schwarzen Regionenkanten; Zahl bei genügend Innenraum, sonst kleiner Farbpunkt.',
    fillMode: 'white',
    boundaryMode: 'black',
    markerMode: 'numbers',
  },
  {
    id: 'classic',
    label: 'Fresh Classic',
    description: 'Region-First-Farbflächen mit schwarzen Grenzen.',
    fillMode: 'color',
    boundaryMode: 'black',
    markerMode: 'none',
  },
  {
    id: 'debugUnlabeled',
    label: 'Debug-Regionen',
    description: 'Finale Regionen unterscheidbar eingefärbt, ohne Marker.',
    fillMode: 'debug',
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

function tokenPolicyForColorCount(
  colorCount: number,
  paintabilityPolicy?: FreshPaintabilityPolicy,
): TokenPolicy {
  const [lumaBins, chromaBins] = colorCount >= 18 && paintabilityPolicy?.expertTokenBins != null
    ? paintabilityPolicy.expertTokenBins
    : colorCount <= 11
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
  const perimeters: number[] = [];
  const crossCores: number[] = [];
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
    let componentPerimeter = 0;
    let componentHasCrossCore = 0;
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
      const hasUp = y > 0 && labelMap[up] === sourceLabel;
      const hasDown = y + 1 < height && labelMap[down] === sourceLabel;
      const hasLeft = x > 0 && labelMap[left] === sourceLabel;
      const hasRight = x + 1 < width && labelMap[right] === sourceLabel;
      if (!hasUp) componentPerimeter += 1;
      if (!hasDown) componentPerimeter += 1;
      if (!hasLeft) componentPerimeter += 1;
      if (!hasRight) componentPerimeter += 1;
      if (hasUp && hasDown && hasLeft && hasRight) {
        componentHasCrossCore = 1;
      }
      if (hasUp && componentMap[up] === -1) {
        componentMap[up] = componentId;
        queue[tail] = up;
        tail += 1;
      }
      if (hasDown && componentMap[down] === -1) {
        componentMap[down] = componentId;
        queue[tail] = down;
        tail += 1;
      }
      if (hasLeft && componentMap[left] === -1) {
        componentMap[left] = componentId;
        queue[tail] = left;
        tail += 1;
      }
      if (hasRight && componentMap[right] === -1) {
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
    perimeters.push(componentPerimeter);
    crossCores.push(componentHasCrossCore);
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
    perimeter: Int32Array.from(perimeters),
    hasCrossCore: Uint8Array.from(crossCores),
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

function buildBoundaryContacts(
  componentMap: Int32Array,
  width: number,
  height: number,
): BoundaryContacts {
  const contacts: BoundaryContacts = new Map();
  const add = (source: number, target: number, x: number, y: number): void => {
    if (source === target) {
      return;
    }
    let byNeighbor = contacts.get(source);
    if (byNeighbor == null) {
      byNeighbor = new Map();
      contacts.set(source, byNeighbor);
    }
    const contact = byNeighbor.get(target);
    if (contact == null) {
      byNeighbor.set(target, { count: 1, sumX: x, sumY: y });
    } else {
      contact.count += 1;
      contact.sumX += x;
      contact.sumY += y;
    }
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const current = componentMap[index];
      if (x + 1 < width) {
        const right = componentMap[index + 1];
        if (right !== current) {
          add(current, right, x + 0.5, y);
          add(right, current, x + 0.5, y);
        }
      }
      if (y + 1 < height) {
        const down = componentMap[index + width];
        if (down !== current) {
          add(current, down, x, y + 0.5);
          add(down, current, x, y + 0.5);
        }
      }
    }
  }
  return contacts;
}

function profileComponentGeometry(
  components: Components,
): ComponentGeometry {
  const componentCount = components.labels.length;
  const bboxAverageThickness = new Float32Array(componentCount);
  const hydraulicDiameter = new Float32Array(componentCount);
  for (let componentId = 0; componentId < componentCount; componentId += 1) {
    const bboxWidth = components.maxX[componentId] - components.minX[componentId] + 1;
    const bboxHeight = components.maxY[componentId] - components.minY[componentId] + 1;
    const longestSide = Math.max(1, bboxWidth, bboxHeight);
    bboxAverageThickness[componentId] = components.areas[componentId] / longestSide;
    hydraulicDiameter[componentId] = (4 * components.areas[componentId]) / Math.max(1, components.perimeter[componentId]);
  }

  return {
    perimeter: components.perimeter,
    hasCrossCore: components.hasCrossCore,
    bboxAverageThickness,
    hydraulicDiameter,
  };
}

function isHardUnpaintableRegion(geometry: ComponentGeometry, componentId: number): boolean {
  return geometry.hasCrossCore[componentId] === 0 && (
    geometry.bboxAverageThickness[componentId] <= HARD_UNPAINTABLE_MAX_BBOX_THICKNESS
    || geometry.hydraulicDiameter[componentId] <= HARD_UNPAINTABLE_MAX_HYDRAULIC_DIAMETER
  );
}

function isSoftThinRegion(
  components: Components,
  geometry: ComponentGeometry,
  componentId: number,
  minArea: number,
): boolean {
  return (
    components.areas[componentId] <= minArea * SOFT_THIN_MAX_AREA_MULTIPLIER
    && geometry.bboxAverageThickness[componentId] <= SOFT_THIN_MAX_BBOX_THICKNESS
    && geometry.hydraulicDiameter[componentId] <= SOFT_THIN_MAX_HYDRAULIC_DIAMETER
  );
}

function isGradientBandRegion(
  components: Components,
  geometry: ComponentGeometry,
  componentLab: Float32Array,
  boundaryContacts: BoundaryContacts,
  componentId: number,
  width: number,
  height: number,
  policy: GradientBandPolicy,
): boolean {
  const bboxWidth = components.maxX[componentId] - components.minX[componentId] + 1;
  const bboxHeight = components.maxY[componentId] - components.minY[componentId] + 1;
  const longestSpan = Math.max(bboxWidth, bboxHeight);
  const effectiveWidth = Math.max(0.5, geometry.hydraulicDiameter[componentId] / 2);
  const linearScale = Math.max(0.25, Math.max(width, height) / WORK_MAX_EDGE);
  if (
    longestSpan < policy.minLongestSpan * linearScale
    || longestSpan / effectiveWidth < policy.minElongation
    || components.areas[componentId] > width * height * policy.maxAreaRatio
    || (
      geometry.bboxAverageThickness[componentId] > policy.maxBboxThickness * linearScale
      && geometry.hydraulicDiameter[componentId] > policy.maxHydraulicDiameter * linearScale
    )
  ) {
    return false;
  }

  const contacts = boundaryContacts.get(componentId);
  if (contacts == null || contacts.size === 0) {
    return false;
  }
  const dominant = [...contacts.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0] - right[0]);
  const first = dominant[0];
  const second = dominant[1];
  const fullPerimeter = Math.max(1, geometry.perimeter[componentId]);
  const dominantSourceDistance = labDistance(componentLab, componentId, componentLab, first[0]);
  if (
    first[1].count / fullPerimeter >= policy.minDominantBoundaryShare
    && dominantSourceDistance <= policy.maxDominantSourceLabDistance
  ) {
    return true;
  }
  if (
    second == null
    ||
    (first[1].count + second[1].count) / fullPerimeter < policy.minTopTwoBoundaryShare
    || second[1].count / fullPerimeter < policy.minSecondBoundaryShare
    || second[1].count < policy.minSecondBoundaryPixels * linearScale
  ) {
    return false;
  }

  const centerX = (components.minX[componentId] + components.maxX[componentId]) / 2;
  const centerY = (components.minY[componentId] + components.maxY[componentId]) / 2;
  const firstX = first[1].sumX / first[1].count - centerX;
  const firstY = first[1].sumY / first[1].count - centerY;
  const secondX = second[1].sumX / second[1].count - centerX;
  const secondY = second[1].sumY / second[1].count - centerY;
  const firstLength = Math.hypot(firstX, firstY);
  const secondLength = Math.hypot(secondX, secondY);
  if (firstLength < 0.5 || secondLength < 0.5) {
    return false;
  }
  const directionCosine = (firstX * secondX + firstY * secondY) / (firstLength * secondLength);
  if (directionCosine > policy.maxBoundaryDirectionCosine) {
    return false;
  }

  const secondSourceDistance = labDistance(componentLab, componentId, componentLab, second[0]);
  if (Math.min(dominantSourceDistance, secondSourceDistance) <= policy.maxDominantSourceLabDistance) {
    return true;
  }

  const pointOffset = componentId * 3;
  const firstOffset = first[0] * 3;
  const secondOffset = second[0] * 3;
  const vx = componentLab[secondOffset] - componentLab[firstOffset];
  const vy = componentLab[secondOffset + 1] - componentLab[firstOffset + 1];
  const vz = componentLab[secondOffset + 2] - componentLab[firstOffset + 2];
  const lengthSquared = vx * vx + vy * vy + vz * vz;
  if (lengthSquared < policy.minNeighborPairLabDistance * policy.minNeighborPairLabDistance) {
    return false;
  }
  const px = componentLab[pointOffset] - componentLab[firstOffset];
  const py = componentLab[pointOffset + 1] - componentLab[firstOffset + 1];
  const pz = componentLab[pointOffset + 2] - componentLab[firstOffset + 2];
  const position = (px * vx + py * vy + pz * vz) / lengthSquared;
  if (position <= 0.1 || position >= 0.9) {
    return false;
  }
  const closestX = componentLab[firstOffset] + position * vx;
  const closestY = componentLab[firstOffset + 1] + position * vy;
  const closestZ = componentLab[firstOffset + 2] + position * vz;
  const dx = componentLab[pointOffset] - closestX;
  const dy = componentLab[pointOffset + 1] - closestY;
  const dz = componentLab[pointOffset + 2] - closestZ;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) <= policy.maxLabLineResidual;
}

function filterAttachedProtrusionCandidates(
  rawCandidates: Uint8Array,
  componentMap: Int32Array,
  width: number,
  height: number,
): { mask: Uint8Array; count: number } {
  const mask = new Uint8Array(rawCandidates.length);
  const visited = new Uint8Array(rawCandidates.length);
  const queue = new Int32Array(rawCandidates.length);
  const retainedSectionMap = new Int32Array(rawCandidates.length);
  retainedSectionMap.fill(-1);
  let retainedSectionId = 0;
  for (let start = 0; start < rawCandidates.length; start += 1) {
    if (rawCandidates[start] !== 0 || retainedSectionMap[start] >= 0) {
      continue;
    }
    const componentId = componentMap[start];
    let head = 0;
    let tail = 1;
    queue[0] = start;
    retainedSectionMap[start] = retainedSectionId;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      const neighborIndexes = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ];
      for (const neighborIndex of neighborIndexes) {
        if (
          neighborIndex >= 0
          && rawCandidates[neighborIndex] === 0
          && retainedSectionMap[neighborIndex] < 0
          && componentMap[neighborIndex] === componentId
        ) {
          retainedSectionMap[neighborIndex] = retainedSectionId;
          queue[tail] = neighborIndex;
          tail += 1;
        }
      }
    }
    retainedSectionId += 1;
  }
  let count = 0;

  for (let start = 0; start < rawCandidates.length; start += 1) {
    if (rawCandidates[start] === 0 || visited[start] !== 0) {
      continue;
    }
    const componentId = componentMap[start];
    let head = 0;
    let tail = 1;
    let area = 0;
    let perimeter = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let retainedNeighborSection = -1;
    let touchesMultipleRetainedSections = false;
    queue[0] = start;
    visited[start] = 1;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighborIndexes = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ];
      for (const neighborIndex of neighborIndexes) {
        if (neighborIndex < 0 || componentMap[neighborIndex] !== componentId) {
          perimeter += 1;
          continue;
        }
        if (rawCandidates[neighborIndex] === 0) {
          perimeter += 1;
          const neighborSection = retainedSectionMap[neighborIndex];
          if (retainedNeighborSection < 0) {
            retainedNeighborSection = neighborSection;
          } else if (neighborSection !== retainedNeighborSection) {
            touchesMultipleRetainedSections = true;
          }
          continue;
        }
        if (visited[neighborIndex] === 0) {
          visited[neighborIndex] = 1;
          queue[tail] = neighborIndex;
          tail += 1;
        }
      }
    }

    const bboxWidth = maxX - minX + 1;
    const bboxHeight = maxY - minY + 1;
    const longestSpan = Math.max(bboxWidth, bboxHeight);
    const bboxAverageThickness = area / Math.max(1, longestSpan);
    const hydraulicDiameter = (4 * area) / Math.max(1, perimeter);
    const isLongThinProtrusion = longestSpan >= ATTACHED_PROTRUSION_MIN_SPAN && (
      bboxAverageThickness <= ATTACHED_PROTRUSION_MAX_BBOX_THICKNESS
      || hydraulicDiameter <= ATTACHED_PROTRUSION_MAX_HYDRAULIC_DIAMETER
    );
    if (!isLongThinProtrusion || touchesMultipleRetainedSections) {
      continue;
    }
    for (let queueIndex = 0; queueIndex < tail; queueIndex += 1) {
      mask[queue[queueIndex]] = 1;
    }
    count += tail;
  }

  return { mask, count };
}

export async function pruneThinProtrusions(
  labelMap: LabelMap,
  sourceRgbData: Uint8ClampedArray,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  runs: number,
  options: GeneratePaintByNumbersOptions,
  forcePaintability = false,
  candidateMode: ProtrusionCandidateMode = 'attached',
): Promise<ProtrusionPruneResult> {
  let current = new Uint8Array(labelMap);
  const colorCount = paletteRgb.length / 3;
  let candidatePixelCount = 0;
  let changedPixelCount = 0;
  let unresolvedPixelCount = 0;

  for (let run = 0; run < runs; run += 1) {
    const components = connectedComponentsForLabels(current, colorCount, width, height);
    const pixelCount = current.length;
    const core = new Uint8Array(pixelCount);
    const componentHasCore = new Uint8Array(components.labels.length);
    for (let y = 1; y + 1 < height; y += 1) {
      for (let x = 1; x + 1 < width; x += 1) {
        const index = y * width + x;
        const componentId = components.componentMap[index];
        if (
          components.componentMap[index - 1] === componentId
          && components.componentMap[index + 1] === componentId
          && components.componentMap[index - width] === componentId
          && components.componentMap[index + width] === componentId
        ) {
          core[index] = 1;
          componentHasCore[componentId] = 1;
        }
      }
    }

    const rawCandidates = new Uint8Array(pixelCount);
    let rawCandidateCount = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const componentId = components.componentMap[index];
        if (candidateMode === 'attached' && componentHasCore[componentId] === 0) {
          continue;
        }
        const retained = core[index] === 1
          || (x > 0 && core[index - 1] === 1 && components.componentMap[index - 1] === componentId)
          || (x + 1 < width && core[index + 1] === 1 && components.componentMap[index + 1] === componentId)
          || (y > 0 && core[index - width] === 1 && components.componentMap[index - width] === componentId)
          || (y + 1 < height && core[index + width] === 1 && components.componentMap[index + width] === componentId);
        if (!retained) {
          rawCandidates[index] = 1;
          rawCandidateCount += 1;
        }
      }
    }
    const filteredCandidates = candidateMode === 'attached'
      ? filterAttachedProtrusionCandidates(
          rawCandidates,
          components.componentMap,
          width,
          height,
        )
      : { mask: rawCandidates, count: rawCandidateCount };
    const unresolved = filteredCandidates.mask;
    const runCandidateCount = filteredCandidates.count;
    candidatePixelCount += runCandidateCount;
    if (runCandidateCount === 0) {
      break;
    }

    const working = new Uint8Array(current);
    const proposedLabels = new Int16Array(pixelCount);
    const candidateLabels = new Int16Array(4);
    const candidateStrengths = new Int8Array(4);
    let remaining = runCandidateCount;
    for (let round = 0; round < PAINTABILITY_FILL_MAX_ROUNDS && remaining > 0; round += 1) {
      proposedLabels.fill(-1);
      let scheduled = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          if (unresolved[index] === 0) {
            continue;
          }

          candidateLabels.fill(-1);
          candidateStrengths.fill(0);
          let candidateCount = 0;
          for (let direction = 0; direction < 4; direction += 1) {
            let neighborIndex = -1;
            if (direction === 0 && x > 0) neighborIndex = index - 1;
            if (direction === 1 && x + 1 < width) neighborIndex = index + 1;
            if (direction === 2 && y > 0) neighborIndex = index - width;
            if (direction === 3 && y + 1 < height) neighborIndex = index + width;
            if (neighborIndex < 0) {
              continue;
            }
            if (unresolved[neighborIndex] !== 0) {
              continue;
            }
            const candidateLabel = working[neighborIndex];
            let knownCandidate = false;
            for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
              if (candidateLabels[candidateIndex] === candidateLabel) {
                candidateStrengths[candidateIndex] += 1;
                knownCandidate = true;
                break;
              }
            }
            if (!knownCandidate) {
              candidateLabels[candidateCount] = candidateLabel;
              candidateStrengths[candidateCount] = 1;
              candidateCount += 1;
            }
          }
          if (candidateCount === 0) {
            continue;
          }

          let bestLabel = -1;
          let bestScore = Number.POSITIVE_INFINITY;
          const pixelOffset = index * 4;
          for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
            const candidateLabel = candidateLabels[candidateIndex];
            const sourceDistance = rgbDistanceToPalette(sourceRgbData, pixelOffset, paletteRgb, candidateLabel);
            const score = sourceDistance * 1.15 - candidateStrengths[candidateIndex] * 6;
            if (score < bestScore || (score === bestScore && candidateLabel < bestLabel)) {
              bestScore = score;
              bestLabel = candidateLabel;
            }
          }
          if (bestLabel >= 0) {
            proposedLabels[index] = bestLabel;
            scheduled += 1;
          }
        }
      }

      if (scheduled === 0) {
        break;
      }
      for (let index = 0; index < pixelCount; index += 1) {
        let proposedLabel = proposedLabels[index];
        if (proposedLabel < 0) {
          continue;
        }
        const currentLabel = current[index];
        if (proposedLabel !== currentLabel) {
          const pixelOffset = index * 4;
          const currentDistance = rgbDistanceToPalette(sourceRgbData, pixelOffset, paletteRgb, currentLabel);
          const targetDistance = rgbDistanceToPalette(sourceRgbData, pixelOffset, paletteRgb, proposedLabel);
          if (
            !forcePaintability
            && targetDistance > SOURCE_AWARE_MAJORITY_ABSOLUTE_RGB_LIMIT
            && targetDistance > currentDistance + SOURCE_AWARE_MAJORITY_RGB_TOLERANCE
          ) {
            proposedLabel = currentLabel;
          }
        }
        working[index] = proposedLabel;
        unresolved[index] = 0;
        remaining -= 1;
      }
    }

    let runChangedCount = 0;
    for (let index = 0; index < pixelCount; index += 1) {
      if (working[index] !== current[index]) {
        runChangedCount += 1;
      }
    }
    changedPixelCount += runChangedCount;
    unresolvedPixelCount = remaining;
    current = working;
    if (runChangedCount === 0) {
      break;
    }
    await yieldAndCheckCancellation(options);
  }

  return {
    labelMap: current,
    candidatePixelCount,
    changedPixelCount,
    unresolvedPixelCount,
  };
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
  const geometry = profileComponentGeometry(sourceComponents);
  const candidates: EasyLandmarkCandidate[] = [];

  for (let componentId = 0; componentId < sourceComponents.labels.length; componentId += 1) {
    if (isHardUnpaintableRegion(geometry, componentId)) {
      continue;
    }
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

function findExpertDetailCandidates(
  sourceComponents: Components,
  width: number,
  height: number,
  minRegionArea: number,
): ExpertDetailCandidate[] {
  const imageArea = width * height;
  const imageAreaRatio = Math.max(
    1 / 16,
    Math.min(1, imageArea / (WORK_MAX_EDGE * WORK_MAX_EDGE)),
  );
  const linearScale = Math.sqrt(imageAreaRatio);
  const minimumArea = Math.max(9, Math.round(EXPERT_DETAIL_MIN_PIXELS * imageAreaRatio));
  const maximumArea = Math.max(
    minimumArea,
    Math.min(
      Math.round(imageArea * EXPERT_DETAIL_MAX_AREA_RATIO),
      Math.round(minRegionArea * EXPERT_DETAIL_MAX_AREA_MULTIPLIER),
    ),
  );
  const maximumSpan = Math.max(24, Math.round(EXPERT_DETAIL_MAX_SPAN * linearScale));
  const componentLab = componentLabColors(sourceComponents.meanRgb);
  const adjacency = buildAdjacency(sourceComponents.componentMap, width, height);
  const geometry = profileComponentGeometry(sourceComponents);
  const candidates: ExpertDetailCandidate[] = [];

  for (let componentId = 0; componentId < sourceComponents.labels.length; componentId += 1) {
    if (isHardUnpaintableRegion(geometry, componentId)) {
      continue;
    }
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
    const aspectRatio = Math.max(boundingWidth, boundingHeight)
      / Math.max(1, Math.min(boundingWidth, boundingHeight));
    if (aspectRatio > EXPERT_DETAIL_MAX_ASPECT_RATIO) {
      continue;
    }
    const fillRatio = area / Math.max(1, boundingWidth * boundingHeight);
    if (fillRatio < EXPERT_DETAIL_MIN_FILL_RATIO) {
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
    if (enclosure < EXPERT_DETAIL_MIN_ENCLOSURE) {
      continue;
    }
    const compactness = (4 * Math.PI * area) / Math.max(1, totalBorder * totalBorder);
    if (compactness < EXPERT_DETAIL_MIN_COMPACTNESS) {
      continue;
    }
    const sourceContrast = labDistance(componentLab, componentId, componentLab, dominantNeighborId);
    if (sourceContrast < EXPERT_DETAIL_MIN_SOURCE_LAB_DISTANCE) {
      continue;
    }
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const normalizedCenterDistance = Math.hypot(
      (centerX - width / 2) / Math.max(1, width / 2),
      (centerY - height / 2) / Math.max(1, height / 2),
    );
    const centerBias = Math.max(0, 1 - normalizedCenterDistance / Math.SQRT2);
    const score = sourceContrast * 1.7
      + Math.log1p(area) * 5
      + enclosure * 14
      + Math.min(1, compactness) * 12
      + centerBias * 10
      - aspectRatio;
    candidates.push({
      componentId,
      area,
      sourceContrast,
      enclosure,
      compactness,
      aspectRatio,
      centerBias,
      score,
    });
  }

  return candidates
    .sort((left, right) => right.score - left.score || right.area - left.area || left.componentId - right.componentId)
    .slice(0, EXPERT_DETAIL_MAX_COUNT * 6);
}

function restoreExpertDetails(
  labelMap: LabelMap,
  sourceComponents: Components,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  minRegionArea: number,
): ExpertDetailRestoreResult {
  const candidates = findExpertDetailCandidates(sourceComponents, width, height, minRegionArea);
  if (candidates.length === 0) {
    return { labelMap, candidateCount: 0, restoredCount: 0, restoredPixelCount: 0 };
  }

  const colorCount = paletteRgb.length / 3;
  const sourceLab = componentLabColors(sourceComponents.meanRgb);
  const paletteLabColors = paletteLab(paletteRgb);
  const maximumRestoredPixels = Math.max(
    EXPERT_DETAIL_MIN_PIXELS,
    Math.round(width * height * EXPERT_DETAIL_MAX_TOTAL_AREA_RATIO),
  );
  let next: LabelMap | null = null;
  let restoredCount = 0;
  let restoredPixelCount = 0;

  for (const candidate of candidates) {
    if (restoredCount >= EXPERT_DETAIL_MAX_COUNT || restoredPixelCount >= maximumRestoredPixels) {
      break;
    }
    const current = next ?? labelMap;
    const outputLabelCounts = new Int32Array(colorCount);
    const boundaryLabelCounts = new Int32Array(colorCount);
    const minX = sourceComponents.minX[candidate.componentId];
    const minY = sourceComponents.minY[candidate.componentId];
    const maxX = sourceComponents.maxX[candidate.componentId];
    const maxY = sourceComponents.maxY[candidate.componentId];

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = y * width + x;
        if (sourceComponents.componentMap[index] !== candidate.componentId) {
          continue;
        }
        outputLabelCounts[current[index]] += 1;
        const neighborIndexes = [
          y > 0 ? index - width : -1,
          y + 1 < height ? index + width : -1,
          x > 0 ? index - 1 : -1,
          x + 1 < width ? index + 1 : -1,
        ];
        for (const neighborIndex of neighborIndexes) {
          if (
            neighborIndex < 0
            || sourceComponents.componentMap[neighborIndex] === candidate.componentId
          ) {
            continue;
          }
          boundaryLabelCounts[current[neighborIndex]] += 1;
        }
      }
    }

    let dominantOutputLabel = -1;
    let dominantOutputCount = 0;
    let surroundingLabel = -1;
    let surroundingCount = 0;
    for (let label = 0; label < colorCount; label += 1) {
      if (outputLabelCounts[label] > dominantOutputCount) {
        dominantOutputLabel = label;
        dominantOutputCount = outputLabelCounts[label];
      }
      if (boundaryLabelCounts[label] > surroundingCount) {
        surroundingLabel = label;
        surroundingCount = boundaryLabelCounts[label];
      }
    }
    if (dominantOutputLabel < 0 || surroundingLabel < 0) {
      continue;
    }
    const dominantOutputShare = dominantOutputCount / Math.max(1, candidate.area);
    const dominantSourceDistance = labDistance(
      sourceLab,
      candidate.componentId,
      paletteLabColors,
      dominantOutputLabel,
    );
    const dominantOutputContrast = dominantOutputLabel === surroundingLabel
      ? 0
      : labDistance(paletteLabColors, dominantOutputLabel, paletteLabColors, surroundingLabel);
    if (
      dominantOutputShare >= EXPERT_DETAIL_ALREADY_PRESENT_SHARE
      && dominantOutputLabel !== surroundingLabel
      && dominantSourceDistance <= EXPERT_DETAIL_MAX_PALETTE_LAB_DISTANCE
      && dominantOutputContrast >= EXPERT_DETAIL_MIN_OUTPUT_LAB_DISTANCE
    ) {
      continue;
    }

    let replacementLabel = -1;
    let replacementDistance = Number.POSITIVE_INFINITY;
    for (let label = 0; label < colorCount; label += 1) {
      if (boundaryLabelCounts[label] > 0) {
        continue;
      }
      const sourceDistance = labDistance(sourceLab, candidate.componentId, paletteLabColors, label);
      const surroundingContrast = labDistance(paletteLabColors, label, paletteLabColors, surroundingLabel);
      if (
        sourceDistance < replacementDistance
        && surroundingContrast >= EXPERT_DETAIL_MIN_OUTPUT_LAB_DISTANCE
      ) {
        replacementLabel = label;
        replacementDistance = sourceDistance;
      }
    }
    if (
      replacementLabel < 0
      || replacementDistance > EXPERT_DETAIL_MAX_PALETTE_LAB_DISTANCE
      || outputLabelCounts[replacementLabel] >= candidate.area * EXPERT_DETAIL_ALREADY_PRESENT_SHARE
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
          && next[index] !== replacementLabel
        ) {
          next[index] = replacementLabel;
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
  softThinReferenceArea: number,
  maxPasses: number,
  forceMergeBelow: number,
  protectMinArea: number,
  protectLabDistance: number,
  paintabilityPolicy: FreshPaintabilityPolicy,
  allowGradientBands: boolean,
  options: GeneratePaintByNumbersOptions,
): Promise<MergeResult> {
  let current = new Uint8Array(labelMap);
  const colorCount = paletteRgb.length / 3;
  const lab = paletteLab(paletteRgb);
  let totalMerges = 0;
  let totalGeometryMerges = 0;
  let totalGradientBandMerges = 0;
  let totalGlobalReassignments = 0;
  let componentCount = 0;
  let smallRemaining = 0;
  let protectedSmall = 0;
  let hardUnpaintableRemaining = 0;
  let softThinRemaining = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const components = connectedComponentsForLabels(current, colorCount, width, height, sourceRgbData);
    const componentLab = componentLabColors(components.meanRgb);
    componentCount = components.labels.length;
    const adjacency = buildAdjacency(components.componentMap, width, height);
    const canMergeGradientBands = allowGradientBands
      && paintabilityPolicy.gradientBand != null
      && pass < paintabilityPolicy.gradientBand.maxPasses;
    const boundaryContacts = canMergeGradientBands
      ? buildBoundaryContacts(components.componentMap, width, height)
      : null;
    const geometry = profileComponentGeometry(components);
    const hardUnpaintable = new Uint8Array(componentCount);
    const softThin = new Uint8Array(componentCount);
    const gradientBand = new Uint8Array(componentCount);
    const replacementByComponent = new Uint8Array(componentCount);
    const scheduledSource = new Uint8Array(componentCount);
    const lockedAsTarget = new Uint8Array(componentCount);
    let mergeCount = 0;
    let globalReassignCount = 0;

    for (let componentId = 0; componentId < componentCount; componentId += 1) {
      replacementByComponent[componentId] = components.labels[componentId];
      hardUnpaintable[componentId] = isHardUnpaintableRegion(geometry, componentId) ? 1 : 0;
      softThin[componentId] = isSoftThinRegion(components, geometry, componentId, softThinReferenceArea) ? 1 : 0;
      gradientBand[componentId] = canMergeGradientBands
        && paintabilityPolicy.gradientBand != null
        && boundaryContacts != null
        && isGradientBandRegion(
        components,
        geometry,
        componentLab,
        boundaryContacts,
        componentId,
        width,
        height,
        paintabilityPolicy.gradientBand,
      ) ? 1 : 0;
    }

    const candidates = Array.from({ length: componentCount }, (_, componentId) => componentId)
      .filter((componentId) => (
        components.areas[componentId] < minArea
        || hardUnpaintable[componentId] !== 0
        || softThin[componentId] !== 0
        || gradientBand[componentId] !== 0
      ))
      .sort((left, right) => (
        hardUnpaintable[right] - hardUnpaintable[left]
        || gradientBand[right] - gradientBand[left]
        || components.areas[left] - components.areas[right]
        || left - right
      ));

    for (const componentId of candidates) {
      if (lockedAsTarget[componentId] !== 0) {
        continue;
      }
      const area = components.areas[componentId];
      const sourceLabel = components.labels[componentId];
      const isHardUnpaintable = hardUnpaintable[componentId] !== 0;
      const isSoftThin = softThin[componentId] !== 0;
      const isGradientBand = gradientBand[componentId] !== 0;
      const isGeometryCandidate = isHardUnpaintable || isSoftThin || isGradientBand;
      const neighbors = adjacency.get(componentId);
      if (neighbors == null || neighbors.size === 0) {
        continue;
      }

      const nearestPalette = nearestPaletteLabelForComponent(componentLab, componentId, lab, colorCount);
      const currentSourceDistance = labDistance(componentLab, componentId, lab, sourceLabel);
      const isForcedTiny = area < forceMergeBelow;
      const neighborLimit = isForcedTiny || isGeometryCandidate
        ? SOURCE_TINY_MERGE_MAX_LAB_DISTANCE
        : SOURCE_MERGE_MAX_LAB_DISTANCE;
      let nearestNeighborSourceDistance = Number.POSITIVE_INFINITY;
      const neighborsByLabel = new Map<number, {
        borderCount: number;
        area: number;
        representativeId: number;
        representativeBorder: number;
      }>();
      const targetOptions: Array<{
        label: number;
        neighborId: number;
        sourceDistance: number;
        score: number;
      }> = [];
      let totalBorder = 0;
      for (const [neighborId, borderCount] of neighbors) {
        if (scheduledSource[neighborId] !== 0) {
          continue;
        }
        const targetLabel = components.labels[neighborId];
        if (targetLabel === sourceLabel) {
          continue;
        }
        totalBorder += borderCount;
        const aggregate = neighborsByLabel.get(targetLabel);
        if (aggregate == null) {
          neighborsByLabel.set(targetLabel, {
            borderCount,
            area: components.areas[neighborId],
            representativeId: neighborId,
            representativeBorder: borderCount,
          });
        } else {
          aggregate.borderCount += borderCount;
          aggregate.area += components.areas[neighborId];
          if (
            borderCount > aggregate.representativeBorder
            || (
              borderCount === aggregate.representativeBorder
              && components.areas[neighborId] > components.areas[aggregate.representativeId]
            )
          ) {
            aggregate.representativeId = neighborId;
            aggregate.representativeBorder = borderCount;
          }
        }
      }
      for (const [targetLabel, aggregate] of neighborsByLabel) {
        const sourceTargetDistance = labDistance(componentLab, componentId, lab, targetLabel);
        const paletteDistance = labDistance(lab, sourceLabel, lab, targetLabel);
        nearestNeighborSourceDistance = Math.min(nearestNeighborSourceDistance, sourceTargetDistance);
        const distortionDelta = area * (
          sourceTargetDistance * sourceTargetDistance
          - currentSourceDistance * currentSourceDistance
        );
        const mergeScale = distortionDelta / Math.max(1, 2 * aggregate.borderCount);
        const borderShare = aggregate.borderCount / Math.max(1, totalBorder);
        const score = paintabilityPolicy.scaleMergeAllCandidates || isGeometryCandidate
          ? mergeScale - borderShare * 2 - Math.log1p(aggregate.area) * 0.01
          : sourceTargetDistance * 1.25
            + paletteDistance * 0.18
            - Math.min(8, Math.log1p(aggregate.borderCount) * 1.4)
            - Math.min(12, Math.log1p(aggregate.area) * 0.8);
        targetOptions.push({
          label: targetLabel,
          neighborId: aggregate.representativeId,
          sourceDistance: sourceTargetDistance,
          score,
        });
      }
      targetOptions.sort((left, right) => left.score - right.score || left.label - right.label);
      const fallbackTarget = targetOptions[0];
      const bestTarget = targetOptions.find((target) => (
        target.sourceDistance <= neighborLimit
        && (
          !paintabilityPolicy.guardSoftThinSourceFit
          || !isSoftThin
          || target.sourceDistance <= currentSourceDistance + SOFT_THIN_MAX_SOURCE_LAB_INCREASE
        )
        && (
          !isGradientBand
          || target.sourceDistance <= currentSourceDistance
            + (paintabilityPolicy.gradientBand?.maxSourceLabIncrease ?? 0)
        )
      ));
      const bestNeighborSourceDistance = bestTarget?.sourceDistance
        ?? fallbackTarget?.sourceDistance
        ?? Number.POSITIVE_INFINITY;
      const hasGoodNeighbor = bestTarget != null;
      const globalIsBetter =
        nearestPalette.distance <= SOURCE_GLOBAL_REASSIGN_MAX_LAB_DISTANCE
        || nearestPalette.distance + SOURCE_GLOBAL_REASSIGN_MIN_IMPROVEMENT < bestNeighborSourceDistance
        || nearestPalette.distance + SOURCE_GLOBAL_REASSIGN_MIN_IMPROVEMENT < currentSourceDistance;
      const canUseGlobalReassignment = !isGeometryCandidate && (
        area >= protectMinArea
        || (
          area >= DETAIL_SPECKLE_PROTECT_MIN_PIXELS
          && nearestNeighborSourceDistance >= protectLabDistance + 8
          && nearestPalette.distance <= SOURCE_GLOBAL_REASSIGN_MAX_LAB_DISTANCE * 0.75
        )
      );
      const detailProtected =
        !isGeometryCandidate
        && area >= protectMinArea
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
        replacementByComponent[componentId] = bestTarget.label;
        scheduledSource[componentId] = 1;
        if (bestTarget.neighborId >= 0) {
          lockedAsTarget[bestTarget.neighborId] = 1;
        }
        mergeCount += 1;
        if (isGeometryCandidate) {
          totalGeometryMerges += 1;
        }
        if (isGradientBand) {
          totalGradientBandMerges += 1;
        }
      } else if (nearestPalette.label === sourceLabel && detailProtected) {
        continue;
      } else if (fallbackTarget != null && (isForcedTiny || isHardUnpaintable)) {
        replacementByComponent[componentId] = fallbackTarget.label;
        scheduledSource[componentId] = 1;
        if (fallbackTarget.neighborId >= 0) {
          lockedAsTarget[fallbackTarget.neighborId] = 1;
        }
        mergeCount += 1;
        if (isGeometryCandidate) {
          totalGeometryMerges += 1;
        }
        if (isGradientBand) {
          totalGradientBandMerges += 1;
        }
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
  const finalGeometry = profileComponentGeometry(finalComponents);
  for (let componentId = 0; componentId < componentCount; componentId += 1) {
    const area = finalComponents.areas[componentId];
    const hardUnpaintable = isHardUnpaintableRegion(finalGeometry, componentId);
    const softThin = isSoftThinRegion(finalComponents, finalGeometry, componentId, softThinReferenceArea);
    if (hardUnpaintable) {
      hardUnpaintableRemaining += 1;
    }
    if (softThin) {
      softThinRemaining += 1;
    }
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
    if (!hardUnpaintable && !softThin && area >= protectMinArea && nearestDistance >= protectLabDistance) {
      protectedSmall += 1;
    } else {
      smallRemaining += 1;
    }
  }

  return {
    labelMap: current,
    mergeCount: totalMerges,
    geometryMergeCount: totalGeometryMerges,
    gradientBandMergeCount: totalGradientBandMerges,
    globalReassignCount: totalGlobalReassignments,
    componentCount,
    smallRemaining,
    protectedSmall,
    hardUnpaintableRemaining,
    softThinRemaining,
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

function assertRequiredPaletteUsage(
  labelMap: LabelMap,
  colorCount: number,
  componentCount: number,
  stage: string,
): void {
  const counts = labelPixelCounts(labelMap, colorCount);
  let usedColorCount = 0;
  for (const count of counts) {
    if (count > 0) {
      usedColorCount += 1;
    }
  }
  const requiredUsedColorCount = Math.min(colorCount, componentCount);
  if (usedColorCount < requiredUsedColorCount) {
    throw new Error(
      `${stage}: Fresh palette usage invariant failed (${usedColorCount}/${requiredUsedColorCount} learned colors used).`,
    );
  }
}

export function ensureTargetPaletteUsage(
  labelMap: LabelMap,
  sourceRgbData: Uint8ClampedArray,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  colorCount: number,
  minRegionArea: number,
): { labelMap: LabelMap; reintroducedCount: number; forcedReintroducedCount: number } {
  const counts = labelPixelCounts(labelMap, colorCount);
  const missingLabels: number[] = [];
  for (let label = 0; label < colorCount; label += 1) {
    if (counts[label] === 0) {
      missingLabels.push(label);
    }
  }
  if (missingLabels.length === 0) {
    return { labelMap, reintroducedCount: 0, forcedReintroducedCount: 0 };
  }

  const components = connectedComponentsForLabels(labelMap, colorCount, width, height, sourceRgbData);
  const usedColorCount = colorCount - missingLabels.length;
  const requiredUsedColorCount = Math.min(colorCount, components.labels.length);
  const requiredRestorations = Math.max(0, requiredUsedColorCount - usedColorCount);
  if (requiredRestorations === 0) {
    return { labelMap, reintroducedCount: 0, forcedReintroducedCount: 0 };
  }

  const componentLab = componentLabColors(components.meanRgb);
  const lab = paletteLab(paletteRgb);
  const geometry = profileComponentGeometry(components);
  const selectedComponents = new Set<number>();
  const remainingComponentsByLabel = new Int32Array(colorCount);
  for (const label of components.labels) {
    remainingComponentsByLabel[label] += 1;
  }
  let next: LabelMap | null = null;
  let reintroducedCount = 0;
  let forcedReintroducedCount = 0;
  const minimumCandidateArea = Math.max(DETAIL_SPECKLE_PROTECT_MIN_PIXELS, Math.min(minRegionArea, MEDIUM_MIN_REGION_PIXELS));
  const labelsToRestore = missingLabels.slice(0, requiredRestorations);

  for (const missingLabel of labelsToRestore) {
    let bestComponent = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestMissingDistance = Number.POSITIVE_INFINITY;
    let bestImprovement = Number.NEGATIVE_INFINITY;

    for (let componentId = 0; componentId < components.labels.length; componentId += 1) {
      if (selectedComponents.has(componentId)) {
        continue;
      }
      if (isHardUnpaintableRegion(geometry, componentId)) {
        continue;
      }
      const area = components.areas[componentId];
      if (area < minimumCandidateArea) {
        continue;
      }
      const sourceLabel = components.labels[componentId];
      if (counts[sourceLabel] <= area || remainingComponentsByLabel[sourceLabel] <= 1) {
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
    remainingComponentsByLabel[previousLabel] -= 1;
    selectedComponents.add(bestComponent);
    reintroducedCount += 1;
  }

  const pendingLabels = labelsToRestore.filter((label) => counts[label] === 0);
  while (pendingLabels.length > 0) {
    let bestPendingIndex = -1;
    let bestComponent = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let pendingIndex = 0; pendingIndex < pendingLabels.length; pendingIndex += 1) {
      const missingLabel = pendingLabels[pendingIndex];
      for (let componentId = 0; componentId < components.labels.length; componentId += 1) {
        if (selectedComponents.has(componentId) || isHardUnpaintableRegion(geometry, componentId)) {
          continue;
        }
        const area = components.areas[componentId];
        if (area < minimumCandidateArea) {
          continue;
        }
        const sourceLabel = components.labels[componentId];
        if (counts[sourceLabel] <= area || remainingComponentsByLabel[sourceLabel] <= 1) {
          continue;
        }
        const currentDistance = labDistance(componentLab, componentId, lab, sourceLabel);
        const missingDistance = labDistance(componentLab, componentId, lab, missingLabel);
        const fitWorsening = Math.max(0, missingDistance - currentDistance);
        const hugeAreaPenalty = Math.max(0, area / Math.max(1, width * height) - 0.08) * 80;
        const cost = missingDistance * 2
          + fitWorsening * 1.5
          - Math.min(12, currentDistance)
          + hugeAreaPenalty;
        if (
          cost < bestCost
          || (
            cost === bestCost
            && (
              missingLabel < (pendingLabels[bestPendingIndex] ?? Number.POSITIVE_INFINITY)
              || (
                missingLabel === pendingLabels[bestPendingIndex]
                && componentId < bestComponent
              )
            )
          )
        ) {
          bestCost = cost;
          bestPendingIndex = pendingIndex;
          bestComponent = componentId;
        }
      }
    }

    if (bestPendingIndex < 0 || bestComponent < 0) {
      break;
    }
    const missingLabel = pendingLabels[bestPendingIndex];
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
    remainingComponentsByLabel[previousLabel] -= 1;
    selectedComponents.add(bestComponent);
    reintroducedCount += 1;
    forcedReintroducedCount += 1;
    pendingLabels.splice(bestPendingIndex, 1);
  }

  let finalUsedColorCount = 0;
  for (const count of counts) {
    if (count > 0) {
      finalUsedColorCount += 1;
    }
  }
  if (finalUsedColorCount < requiredUsedColorCount) {
    throw new Error(
      `Fresh exact palette usage is infeasible: ${finalUsedColorCount}/${requiredUsedColorCount} learned colors can be assigned without splitting paintable regions.`,
    );
  }

  return {
    labelMap: next ?? labelMap,
    reintroducedCount,
    forcedReintroducedCount,
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

function brightenColor(channel: number): number {
  return clampByte(255 - (255 - channel) * 0.2);
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
    const labelText = String(components.labels[regionId] + 1);
    const textRadius = Math.max(5, labelText.length * 3 + 3);
    const areaRadius = Math.sqrt(area / Math.PI) * 0.72;
    const interiorRadius = Math.max(1, bestClearance * 0.88);
    const preferredRadius = Math.max(4, Math.min(10, textRadius));
    const radius = Math.max(1.25, Math.min(preferredRadius, areaRadius, interiorRadius));
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

export function boundaryMask(regionMap: Int32Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const region = regionMap[index];
      if (x + 1 < width && regionMap[index + 1] !== region) {
        mask[index] = 2;
        mask[index + 1] = Math.max(mask[index + 1], 2);
      }
      if (y + 1 < height && regionMap[index + width] !== region) {
        mask[index] = 2;
        mask[index + width] = Math.max(mask[index + width], 2);
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

function drawDigitText(
  rgba: Uint8Array,
  width: number,
  height: number,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  color: Rgb,
): void {
  const digitWidth = 5;
  const digitHeight = 7;
  const gap = 1;
  const textColumns = text.length * digitWidth + Math.max(0, text.length - 1) * gap;
  const block = Math.max(1, Math.floor(Math.min((radius * 1.55) / textColumns, (radius * 1.45) / digitHeight)));
  const totalWidth = textColumns * block;
  const totalHeight = digitHeight * block;
  const startX = Math.round(cx - totalWidth / 2);
  const startY = Math.round(cy - totalHeight / 2);

  for (let digitIndex = 0; digitIndex < text.length; digitIndex += 1) {
    const pattern = DIGIT_PATTERNS[text[digitIndex]];
    if (pattern == null) {
      continue;
    }
    const digitStartX = startX + digitIndex * (digitWidth + gap) * block;
    for (let row = 0; row < digitHeight; row += 1) {
      for (let column = 0; column < digitWidth; column += 1) {
        if (pattern[row][column] !== '1') {
          continue;
        }
        for (let yy = 0; yy < block; yy += 1) {
          for (let xx = 0; xx < block; xx += 1) {
            blendPixel(
              rgba,
              width,
              height,
              digitStartX + column * block + xx,
              startY + row * block + yy,
              color,
              1,
            );
          }
        }
      }
    }
  }
}

function drawMarkerLabels(
  rgba: Uint8Array,
  width: number,
  height: number,
  placements: MarkerPlacement[],
  paletteRgb: Float32Array,
  markerMode: FreshRenderMarkerMode,
): void {
  const outline: Rgb = [OUTLINE_R, OUTLINE_G, OUTLINE_B];
  for (const placement of placements) {
    const labelText = String(placement.colorIndex + 1);
    const canRenderText = canFitNumberGlyph(placement.radius, labelText);
    if (markerMode === 'numberedCircles' && canRenderText) {
      const markerColor = paletteColorForLabel(paletteRgb, placement.colorIndex);
      const luminance = markerColor[0] * 0.299 + markerColor[1] * 0.587 + markerColor[2] * 0.114;
      drawDigitText(
        rgba,
        width,
        height,
        labelText,
        placement.x,
        placement.y,
        placement.radius,
        luminance > 145 ? outline : [255, 255, 255],
      );
    } else if (markerMode === 'numbers' && canRenderText) {
      drawDigitText(rgba, width, height, labelText, placement.x, placement.y, placement.radius, outline);
    } else if (markerMode === 'numbers') {
      drawCircleMarker(
        rgba,
        width,
        height,
        { ...placement, radius: fallbackColorDotRadius(placement.radius) },
        paletteRgb,
      );
    }
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
    let color: Rgb;
    if (config.fillMode === 'white') {
      color = [WHITE_R, WHITE_G, WHITE_B];
    } else if (config.fillMode === 'debug') {
      color = debugRegionColor(regionMap[index]);
    } else {
      const paletteColor = paletteColorForLabel(paletteRgb, label);
      color = config.fillMode === 'bright'
        ? [brightenColor(paletteColor[0]), brightenColor(paletteColor[1]), brightenColor(paletteColor[2])]
        : paletteColor;
    }
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
  if (config.markerMode === 'circles' || config.markerMode === 'numberedCircles') {
    drawMarkerCircles(rgba, width, height, placements, paletteRgb);
  }
  if (config.markerMode === 'numberedCircles' || config.markerMode === 'numbers') {
    drawMarkerLabels(rgba, width, height, placements, paletteRgb, config.markerMode);
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
        'Fresh nutzt diesen Wert fuer optionale source-aware Cross-Opening-Durchlaeufe auf langen duennen Auslaeufern vor dem Region-Build.',
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
  const paintabilityPolicy = paintabilityPolicyForProfile(options.paintabilityProfile, targetColorCount);
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
  const tokenPolicy = tokenPolicyForColorCount(targetColorCount, paintabilityPolicy);
  const kmeansSignature = signature([
    decodeSignature,
    tokenPolicy.lumaBins,
    tokenPolicy.chromaBins,
    TOKEN_CHROMA_RANGE,
    PALETTE_WEIGHT_POWER,
    paintabilityPolicy.id,
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

  const borderSegmentExtraRuns = Math.max(0, Math.floor(settings.nrOfTimesToHalveBorderSegments));
  const protrusionPruneRuns = paintabilityPolicy.earlyOpeningRuns + borderSegmentExtraRuns;
  let protrusionCandidatePixelCount = 0;
  let protrusionChangedPixelCount = 0;
  let protrusionUnresolvedPixelCount = 0;
  const borderSegmentSignature = signature([
    narrowSignature,
    protrusionPruneRuns,
    paintabilityPolicy.earlyOpeningMode,
    paintabilityPolicy.earlyOpeningForcePaintability,
    ATTACHED_PROTRUSION_MIN_SPAN,
    ATTACHED_PROTRUSION_MAX_BBOX_THICKNESS,
    ATTACHED_PROTRUSION_MAX_HYDRAULIC_DIAMETER,
    SOURCE_AWARE_MAJORITY_RGB_TOLERANCE,
    SOURCE_AWARE_MAJORITY_ABSOLUTE_RGB_LIMIT,
    PAINTABILITY_FILL_MAX_ROUNDS,
    'source-aware-cross-opening-v2',
  ]);
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
      'Optionale source-aware Cross-Opening fuer lange duenne Auslaeufer vor dem Aufbau finaler Regionen.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Opening-Runs', value: String(protrusionPruneRuns) },
      ],
      () => renderFreshDebugImage('Border Segment', labelMap, paletteRgb, width, height),
      0,
      true,
      options.onStageSnapshot,
    );
  } else {
    report('borderSegment', 0, 'Unmalbare schmale Auslaeufer werden source-aware bereinigt.');
    const borderSegmentStarted = nowMs();
    const protrusionPrune = await pruneThinProtrusions(
      labelMap,
      smoothed,
      paletteRgb,
      width,
      height,
      protrusionPruneRuns,
      options,
      paintabilityPolicy.earlyOpeningForcePaintability,
      paintabilityPolicy.earlyOpeningMode,
    );
    labelMap = protrusionPrune.labelMap;
    protrusionCandidatePixelCount = protrusionPrune.candidatePixelCount;
    protrusionChangedPixelCount = protrusionPrune.changedPixelCount;
    protrusionUnresolvedPixelCount = protrusionPrune.unresolvedPixelCount;
    addTiming(timings, 'borderSegment', borderSegmentStarted);
    report(
      'borderSegment',
      1,
      `${protrusionChangedPixelCount} Pixel aus schmalen Auslaeufern neu zugeordnet.`,
    );
    nextCache.afterBorderSegment = { labelMap, paletteRgb };
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'borderSegment',
      'Border Segment',
      'Optionale source-aware Cross-Opening fuer lange duenne Auslaeufer vor dem Aufbau finaler Regionen.',
      settings,
      [
        { label: 'Opening-Runs', value: String(protrusionPruneRuns) },
        { label: 'Kandidaten-Pixel', value: String(protrusionCandidatePixelCount) },
        { label: 'Geaenderte Pixel', value: String(protrusionChangedPixelCount) },
        { label: 'Nicht aufloesbar', value: String(protrusionUnresolvedPixelCount) },
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
  const baselineFreshPolicyMinArea = Math.max(
    regionPolicy.minRegionPixels,
    Math.round(width * height * regionPolicy.minRegionRatio),
  );
  const profileMinRegionRatio = targetColorCount >= 18
    ? paintabilityPolicy.expertMinRegionRatio ?? regionPolicy.minRegionRatio
    : regionPolicy.minRegionRatio;
  const freshPolicyMinArea = Math.max(
    regionPolicy.minRegionPixels,
    Math.round(width * height * profileMinRegionRatio),
  );
  const settingsMinArea = Math.max(0, Math.round(width * height * settings.removeFacetsSmallerThanImageRatio));
  const minRegionArea = Math.max(freshPolicyMinArea, settingsMinArea);
  const softThinReferenceArea = paintabilityPolicy.softThinUsesBaselineArea
    ? baselineFreshPolicyMinArea
    : minRegionArea;
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
  let paletteUsageForcedReintroducedCount = 0;
  let easyLandmarkCandidateCount = 0;
  let easyLandmarkRestoredCount = 0;
  let easyLandmarkRestoredPixelCount = 0;
  let expertDetailCandidateCount = 0;
  let expertDetailRestoredCount = 0;
  let expertDetailRestoredPixelCount = 0;
  let expertDetailRepairMergeCount = 0;
  let totalMergeCount = 0;
  let totalGeometryMergeCount = 0;
  let totalGradientBandMergeCount = 0;
  let totalGlobalReassignCount = 0;
  let totalProtectedSmall = 0;
  let finalSmallRemaining = 0;
  let finalHardUnpaintableRemaining = 0;
  let finalSoftThinRemaining = 0;
  let paintabilityPostconditionMergeCount = 0;
  let paintabilityPruneCandidatePixelCount = 0;
  let paintabilityPruneChangedPixelCount = 0;
  let paintabilityPruneUnresolvedPixelCount = 0;
  let facetBudgetSatisfied = true;
  let forcedBudgetMergeCount = 0;
  const maximumNumberOfFacets = Math.max(0, Math.floor(settings.maximumNumberOfFacets));
  const facetReduceSignature = signature([
    facetBuildSignature,
    minRegionArea,
    baselineFreshPolicyMinArea,
    softThinReferenceArea,
    paintabilityPolicy.expertMinRegionRatio ?? 0,
    maximumNumberOfFacets,
    regionPolicy.detailProtectMinPixels,
    TINY_MERGE_PASSES,
    FINAL_SPECKLE_PASSES,
    HARD_UNPAINTABLE_MAX_BBOX_THICKNESS,
    HARD_UNPAINTABLE_MAX_HYDRAULIC_DIAMETER,
    SOFT_THIN_MAX_AREA_MULTIPLIER,
    SOFT_THIN_MAX_BBOX_THICKNESS,
    SOFT_THIN_MAX_HYDRAULIC_DIAMETER,
    SOFT_THIN_MAX_SOURCE_LAB_INCREASE,
    paintabilityPolicy.id,
    paintabilityPolicy.postMergeOpeningRuns,
    paintabilityPolicy.terminalOpening,
    paintabilityPolicy.scaleMergeAllCandidates,
    paintabilityPolicy.guardSoftThinSourceFit,
    paintabilityPolicy.softThinUsesBaselineArea,
    paintabilityPolicy.gradientBandAfterPrimaryMerge,
    paintabilityPolicy.gradientBand?.maxBboxThickness ?? 0,
    paintabilityPolicy.gradientBand?.maxHydraulicDiameter ?? 0,
    paintabilityPolicy.gradientBand?.minLongestSpan ?? 0,
    paintabilityPolicy.gradientBand?.minElongation ?? 0,
    paintabilityPolicy.gradientBand?.maxAreaRatio ?? 0,
    paintabilityPolicy.gradientBand?.minTopTwoBoundaryShare ?? 0,
    paintabilityPolicy.gradientBand?.minSecondBoundaryShare ?? 0,
    paintabilityPolicy.gradientBand?.minSecondBoundaryPixels ?? 0,
    paintabilityPolicy.gradientBand?.minDominantBoundaryShare ?? 0,
    paintabilityPolicy.gradientBand?.maxDominantSourceLabDistance ?? 0,
    paintabilityPolicy.gradientBand?.maxBoundaryDirectionCosine ?? 0,
    paintabilityPolicy.gradientBand?.minNeighborPairLabDistance ?? 0,
    paintabilityPolicy.gradientBand?.maxLabLineResidual ?? 0,
    paintabilityPolicy.gradientBand?.maxSourceLabIncrease ?? 0,
    paintabilityPolicy.gradientBand?.maxPasses ?? 0,
    PAINTABILITY_FILL_MAX_ROUNDS,
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
    EXPERT_DETAIL_MIN_PIXELS,
    EXPERT_DETAIL_MAX_COUNT,
    EXPERT_DETAIL_MAX_AREA_MULTIPLIER,
    EXPERT_DETAIL_MAX_AREA_RATIO,
    EXPERT_DETAIL_MAX_TOTAL_AREA_RATIO,
    EXPERT_DETAIL_MAX_SPAN,
    EXPERT_DETAIL_MAX_ASPECT_RATIO,
    EXPERT_DETAIL_MIN_FILL_RATIO,
    EXPERT_DETAIL_MIN_ENCLOSURE,
    EXPERT_DETAIL_MIN_COMPACTNESS,
    EXPERT_DETAIL_MIN_SOURCE_LAB_DISTANCE,
    EXPERT_DETAIL_MAX_PALETTE_LAB_DISTANCE,
    EXPERT_DETAIL_MIN_OUTPUT_LAB_DISTANCE,
    EXPERT_DETAIL_ALREADY_PRESENT_SHARE,
    'scale-merge-v2-safe-gradient-bands-exact-palette-expert-detail-v1',
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
      totalGeometryMergeCount += mergeResult.geometryMergeCount;
      totalGradientBandMergeCount += mergeResult.gradientBandMergeCount;
      totalGlobalReassignCount += mergeResult.globalReassignCount;
      totalProtectedSmall = mergeResult.protectedSmall;
      finalSmallRemaining = mergeResult.smallRemaining;
      finalHardUnpaintableRemaining = mergeResult.hardUnpaintableRemaining;
      finalSoftThinRemaining = mergeResult.softThinRemaining;
    };
    let merge = await mergeTinyRegions(
      labelMap,
      smoothed,
      paletteRgb,
      width,
      height,
      minRegionArea,
      softThinReferenceArea,
      TINY_MERGE_PASSES,
      SPECKLE_REGION_PIXELS,
      regionPolicy.detailProtectMinPixels,
      DETAIL_PROTECT_LAB_DISTANCE,
      paintabilityPolicy,
      true,
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
    if (paintabilityPolicy.postMergeOpeningRuns > 0) {
      const paintabilityPrune = await pruneThinProtrusions(
        labelMap,
        smoothed,
        paletteRgb,
        width,
        height,
        paintabilityPolicy.postMergeOpeningRuns,
        options,
      );
      labelMap = paintabilityPrune.labelMap;
      paintabilityPruneCandidatePixelCount = paintabilityPrune.candidatePixelCount;
      paintabilityPruneChangedPixelCount = paintabilityPrune.changedPixelCount;
      paintabilityPruneUnresolvedPixelCount = paintabilityPrune.unresolvedPixelCount;
    }
    merge = await mergeTinyRegions(
      labelMap,
      smoothed,
      paletteRgb,
      width,
      height,
      minRegionArea,
      softThinReferenceArea,
      Math.max(4, Math.floor(TINY_MERGE_PASSES / 2)),
      SPECKLE_REGION_PIXELS,
      regionPolicy.detailProtectMinPixels,
      DETAIL_PROTECT_LAB_DISTANCE,
      paintabilityPolicy,
      paintabilityPolicy.gradientBandAfterPrimaryMerge,
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
      SPECKLE_REGION_PIXELS,
      FINAL_SPECKLE_PASSES,
      SPECKLE_REGION_PIXELS,
      DETAIL_SPECKLE_PROTECT_MIN_PIXELS,
      DETAIL_SPECKLE_PROTECT_LAB_DISTANCE,
      paintabilityPolicy,
      false,
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
    if (targetColorCount >= 18 && paintabilityPolicy.id === 'classic-production') {
      const expertDetailRestore = restoreExpertDetails(
        labelMap,
        tokenComponents,
        paletteRgb,
        width,
        height,
        minRegionArea,
      );
      expertDetailCandidateCount = expertDetailRestore.candidateCount;
      expertDetailRestoredCount = expertDetailRestore.restoredCount;
      expertDetailRestoredPixelCount = expertDetailRestore.restoredPixelCount;
      labelMap = expertDetailRestore.labelMap;
      if (expertDetailRestore.restoredCount > 0) {
        const detailRepair = await mergeTinyRegions(
          labelMap,
          smoothed,
          paletteRgb,
          width,
          height,
          0,
          0,
          FINAL_SPECKLE_PASSES,
          0,
          0,
          DETAIL_PROTECT_LAB_DISTANCE,
          paintabilityPolicy,
          false,
          options,
        );
        expertDetailRepairMergeCount = detailRepair.mergeCount;
        accumulateMerge(detailRepair);
        labelMap = detailRepair.labelMap;
      }
      if (maximumNumberOfFacets > 0 && expertDetailRestore.restoredCount > 0) {
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
            `Fresh facet budget could not be satisfied after Expert detail restoration: ${budgetResult.componentCount} regions remain above ${maximumNumberOfFacets}.`,
          );
        }
      }
    }
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
    let terminalOpeningStable = true;
    let terminalMutationRounds = 0;
    if (paintabilityPolicy.terminalOpening) {
      let paintabilityPostcondition = await mergeTinyRegions(
        labelMap,
        smoothed,
        paletteRgb,
        width,
        height,
        0,
        0,
        FINAL_SPECKLE_PASSES,
        0,
        0,
        DETAIL_PROTECT_LAB_DISTANCE,
        paintabilityPolicy,
        false,
        options,
      );
      paintabilityPostconditionMergeCount = paintabilityPostcondition.mergeCount;
      accumulateMerge(paintabilityPostcondition);
      labelMap = paintabilityPostcondition.labelMap;
      terminalOpeningStable = paintabilityPolicy.postMergeOpeningRuns <= 0;
      while (!terminalOpeningStable && paintabilityPolicy.postMergeOpeningRuns > 0) {
        const terminalPaintabilityPrune = await pruneThinProtrusions(
          labelMap,
          smoothed,
          paletteRgb,
          width,
          height,
          paintabilityPolicy.postMergeOpeningRuns,
          options,
          true,
        );
        paintabilityPruneCandidatePixelCount += terminalPaintabilityPrune.candidatePixelCount;
        paintabilityPruneChangedPixelCount += terminalPaintabilityPrune.changedPixelCount;
        paintabilityPruneUnresolvedPixelCount += terminalPaintabilityPrune.unresolvedPixelCount;
        const decision = terminalPaintabilityDecision(
          terminalMutationRounds,
          terminalPaintabilityPrune.candidatePixelCount,
        );
        if (decision === 'stable') {
          terminalOpeningStable = true;
          break;
        }
        if (decision === 'exhausted') {
          break;
        }
        labelMap = terminalPaintabilityPrune.labelMap;
        terminalMutationRounds += 1;
        paintabilityPostcondition = await mergeTinyRegions(
          labelMap,
          smoothed,
          paletteRgb,
          width,
          height,
          0,
          0,
          FINAL_SPECKLE_PASSES,
          0,
          0,
          DETAIL_PROTECT_LAB_DISTANCE,
          paintabilityPolicy,
          false,
          options,
        );
        labelMap = paintabilityPostcondition.labelMap;
        paintabilityPostconditionMergeCount += paintabilityPostcondition.mergeCount;
        accumulateMerge(paintabilityPostcondition);
      }
    }
    if (!terminalOpeningStable) {
      throw new Error(
        `Fresh paintability postcondition failed after ${TERMINAL_PAINTABILITY_MAX_ROUNDS} terminal mutation rounds and the final read-only audit.`,
      );
    }
    const finalPaletteUsage = ensureTargetPaletteUsage(
      labelMap,
      smoothed,
      paletteRgb,
      width,
      height,
      paletteColorCount,
      minRegionArea,
    );
    paletteUsageReintroducedCount = finalPaletteUsage.reintroducedCount;
    paletteUsageForcedReintroducedCount = finalPaletteUsage.forcedReintroducedCount;
    labelMap = finalPaletteUsage.labelMap;
    paletteRgb = recomputePalette(smoothed, labelMap, paletteColorCount);
    regionComponents = connectedComponentsForLabels(labelMap, paletteColorCount, width, height);
    const finalGeometry = profileComponentGeometry(regionComponents);
    finalHardUnpaintableRemaining = 0;
    finalSoftThinRemaining = 0;
    for (let componentId = 0; componentId < regionComponents.labels.length; componentId += 1) {
      if (isHardUnpaintableRegion(finalGeometry, componentId)) {
        finalHardUnpaintableRemaining += 1;
      }
      if (isSoftThinRegion(regionComponents, finalGeometry, componentId, softThinReferenceArea)) {
        finalSoftThinRemaining += 1;
      }
    }
    if (finalHardUnpaintableRemaining > 0) {
      throw new Error(
        `Fresh paintability postcondition failed: ${finalHardUnpaintableRemaining} regions have no paintable cross-core.`,
      );
    }
    if (maximumNumberOfFacets > 0 && regionComponents.labels.length > maximumNumberOfFacets) {
      throw new Error(
        `Fresh facet budget postcondition failed after terminal paintability cleanup: ${regionComponents.labels.length} regions remain above ${maximumNumberOfFacets}.`,
      );
    }
    addTiming(timings, 'facetReduce', reduceStarted);
    report(
      'facetReduce',
      1,
      `${regionComponents.labels.length} finale Regionen erzeugt${paletteUsageReintroducedCount > 0 ? `, ${paletteUsageReintroducedCount} Zielfarben reaktiviert` : ''}${easyLandmarkRestoredCount > 0 ? `, ${easyLandmarkRestoredCount} Easy-Landmarks restauriert` : ''}${expertDetailRestoredCount > 0 ? `, ${expertDetailRestoredCount} Expert-Details restauriert` : ''}.`,
    );
    nextCache.afterFacetReduce = { paletteRgb, components: regionComponents };
    await pushFreshDebugSnapshot(
      debugSnapshots,
      'facetReduce',
      'Facet Reduce',
      'Source-aware Merge kleiner Restregionen und optionales Flaechenbudget.',
      settings,
      [
        { label: 'Paintability-Profil', value: paintabilityPolicy.id },
        { label: 'Regionen vor Merge', value: String(regionCountBeforeReduce) },
        { label: 'Regionen nach Merge', value: String(regionComponents.labels.length) },
        { label: 'Mindestflaeche', value: `${minRegionArea} px` },
        { label: 'Merges', value: String(totalMergeCount) },
        { label: 'Geometrie-Merges', value: String(totalGeometryMergeCount) },
        { label: 'Gradientenband-Merges', value: String(totalGradientBandMergeCount) },
        { label: 'Globale Reassigns', value: String(totalGlobalReassignCount) },
        { label: 'Geschuetzte kleine Regionen', value: String(totalProtectedSmall) },
        { label: 'Kleine Restregionen', value: String(finalSmallRemaining) },
        { label: 'Unmalbare Restregionen', value: String(finalHardUnpaintableRemaining) },
        { label: 'Weiche duenne Restregionen', value: String(finalSoftThinRemaining) },
        { label: 'Paintability-Postcondition-Merges', value: String(paintabilityPostconditionMergeCount) },
        { label: 'Opening-Kandidaten-Pixel', value: String(paintabilityPruneCandidatePixelCount) },
        { label: 'Opening-Aenderungen', value: String(paintabilityPruneChangedPixelCount) },
        { label: 'Opening-nicht-aufloesbar', value: String(paintabilityPruneUnresolvedPixelCount) },
        { label: 'Reaktivierte Farben', value: String(paletteUsageReintroducedCount) },
        { label: 'Erzwungen reaktivierte Farben', value: String(paletteUsageForcedReintroducedCount) },
        { label: 'Easy-Landmark-Kandidaten', value: String(easyLandmarkCandidateCount) },
        { label: 'Restaurierte Easy-Landmarks', value: String(easyLandmarkRestoredCount) },
        { label: 'Restaurierte Landmark-Pixel', value: String(easyLandmarkRestoredPixelCount) },
        { label: 'Expert-Detail-Kandidaten', value: String(expertDetailCandidateCount) },
        { label: 'Restaurierte Expert-Details', value: String(expertDetailRestoredCount) },
        { label: 'Restaurierte Expert-Detail-Pixel', value: String(expertDetailRestoredPixelCount) },
        { label: 'Expert-Detail-Reparaturmerges', value: String(expertDetailRepairMergeCount) },
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
  assertRequiredPaletteUsage(labelMap, paletteColorCount, regionComponents.labels.length, 'facetReduce');
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
  rememberSignature('svgRender', signature([labelPlacementSignature, ...selectedVariantIds, 'vector-svg-v4-safe-number-fallback']));
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
