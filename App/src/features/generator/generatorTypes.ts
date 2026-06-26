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
  narrowPixelStripCleanupRuns: number;
  removeFacetsSmallerThanNrOfPoints: number;
  removeFacetsFromLargeToSmall: boolean;
  maximumNumberOfFacets: number;
  nrOfTimesToHalveBorderSegments: number;
  resizeImageWidth: number;
  resizeImageHeight: number;
  randomSeed: number;
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
  | 'brightColorCircles'
  | 'colorCircles'
  | 'cleanColor'
  | 'coloredEdges'
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
};
