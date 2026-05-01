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

export type PreparedImage = {
  imageUri: string;
  width: number;
  height: number;
  fileName?: string | null;
  mimeType?: string | null;
};

export type GeneratorResult = {
  svg: string;
  svgWidth: number;
  svgHeight: number;
  imageWidth: number;
  imageHeight: number;
  facetCount: number;
  palette: PaletteStat[];
  timings: GeneratorTimings;
  preparedImage: PreparedImage;
};
