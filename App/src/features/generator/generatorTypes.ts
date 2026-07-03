import type { RGB } from '../../vendor/paintbynumbersgenerator/common';

export type GeneratorStage =
  | 'decode'
  | 'kmeans'
  | 'colorMap'
  | 'facetBuild'
  | 'narrowCleanup'
  | 'facetReduce'
  | 'borderTrace'
  | 'borderSegment'
  | 'labelPlacement'
  | 'svgRender'
  | 'done';

export type GeneratorSettings = {
  kMeansNrOfClusters: number;
  kMeansMinDeltaDifference: number;
  nearIdenticalPaletteMergeLabDistance: number;
  narrowPixelStripCleanupRuns: number;
  mergeSimilarAdjacentRegions: boolean;
  removeFacetsSmallerThanImageRatio: number;
  removeFacetsFromLargeToSmall: boolean;
  maximumNumberOfFacets: number;
  nrOfTimesToHalveBorderSegments: number;
  resizeImageWidth: number;
  resizeImageHeight: number;
  randomSeed: number;
};

export type GeneratorDebugParameterKey = keyof GeneratorSettings;

export type GeneratorDebugParameter = {
  key: GeneratorDebugParameterKey;
  label: string;
  value: number | boolean;
  input: 'number' | 'boolean';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  description?: string;
};

export type GeneratorDebugMetric = {
  label: string;
  value: string;
};

export type GeneratorDebugImage = {
  label: string;
  pngBase64: string;
  width: number;
  height: number;
  byteLength?: number;
};

export type GeneratorDebugStageSnapshot = {
  stage: GeneratorStage;
  label: string;
  description: string;
  parameters: GeneratorDebugParameter[];
  metrics: GeneratorDebugMetric[];
  image?: GeneratorDebugImage;
  timingMs?: number;
  canRerunFromHere: boolean;
  cacheHit?: boolean;
};

export type GeneratorDebugInfo = {
  enabled: boolean;
  rerunFromStage?: GeneratorStage;
  finalVariantId: GeneratorOutputVariantId;
  parameterConfig: GeneratorSettings;
  stages: GeneratorDebugStageSnapshot[];
};

export type GeneratorProgress = {
  stage: GeneratorStage;
  progress: number;
  message: string;
};

export type GeneratorTimings = Partial<Record<GeneratorStage, number>>;

export type PaletteStat = {
  index: number;
  color: RGB;
  frequency: number;
  areaPercentage: number;
};

export type GeneratorOutputVariantId =
  | 'inputImage'
  | 'aiPosterizedImage'
  | 'brightColorCircles'
  | 'colorCircles'
  | 'cleanColor'
  | 'coloredEdges'
  | 'coloredEdgesWithDots'
  | 'circlesOnly'
  | 'numbers'
  | 'classic'
  | 'debugUnlabeled';

export type GeneratorOutputVariant = {
  id: GeneratorOutputVariantId;
  label: string;
  description: string;
  pngBase64?: string;
  pngUri?: string;
  pngFileName?: string;
  pngWidth: number;
  pngHeight: number;
  pngByteLength?: number;
  svg?: string;
  svgUri?: string;
  svgFileName?: string;
  svgWidth?: number;
  svgHeight?: number;
  svgByteLength?: number;
  isDefault?: boolean;
};

export type PreparedImage = {
  imageUri: string;
  width: number;
  height: number;
  fileName?: string | null;
  mimeType?: string | null;
};

export type PreparedGeneratorImage = {
  preparedImage: PreparedImage;
  imageData: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };
};

export type GeneratorResult = {
  svg: string;
  svgUri?: string;
  svgFileName?: string;
  svgByteLength?: number;
  previewPngBase64?: string;
  previewPngUri?: string;
  previewPngFileName?: string;
  previewPngWidth?: number;
  previewPngHeight?: number;
  previewPngByteLength?: number;
  variants?: GeneratorOutputVariant[];
  svgWidth: number;
  svgHeight: number;
  imageWidth: number;
  imageHeight: number;
  facetCount: number;
  palette: PaletteStat[];
  timings: GeneratorTimings;
  preparedImage: PreparedImage;
  debug?: GeneratorDebugInfo;
};
