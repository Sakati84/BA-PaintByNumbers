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

export const DEFAULT_SETTINGS: GeneratorSettings = {
  kMeansNrOfClusters: 16,
  kMeansMinDeltaDifference: 1,
  narrowPixelStripCleanupRuns: 3,
  removeFacetsSmallerThanNrOfPoints: 50,
  removeFacetsFromLargeToSmall: true,
  maximumNumberOfFacets: 0,
  nrOfTimesToHalveBorderSegments: 2,
  resizeImageWidth: 1024,
  resizeImageHeight: 1024,
  randomSeed: 7707,
};

export const COLOR_COUNT_MIN = 8;
export const COLOR_COUNT_MAX = 24;
export const DEFAULT_COLOR_COUNT = 16;
export const POSTERIZE_MAX_EDGE = 1024;

export type ComplexityPreset = 'simple' | 'medium' | 'detailed';

export type ComplexityOption = {
  preset: ComplexityPreset;
  label: string;
  minColorCount: number;
  maxColorCount: number;
  description: string;
  scaleDescription: string;
};

export const COMPLEXITY_OPTIONS: ComplexityOption[] = [
  {
    preset: 'simple',
    label: 'Easy',
    minColorCount: 8,
    maxColorCount: 11,
    description: 'Kindgerecht: grosse Malflaechen, sehr niedriger Detailgrad.',
    scaleDescription: '8-11 Farben, sehr grob',
  },
  {
    preset: 'medium',
    label: 'Medium',
    minColorCount: 12,
    maxColorCount: 17,
    description: 'Ausgewogen: klare Formen, mittlerer Detailgrad.',
    scaleDescription: '12-17 Farben, mittel',
  },
  {
    preset: 'detailed',
    label: 'Expert',
    minColorCount: 18,
    maxColorCount: 24,
    description: 'Expert: hohe Motivtreue, mehr Struktur und feinere Flaechen.',
    scaleDescription: '18-24 Farben, fein',
  },
];

export function complexityOptionForPreset(preset: ComplexityPreset): ComplexityOption {
  return COMPLEXITY_OPTIONS.find((option) => option.preset === preset) ?? COMPLEXITY_OPTIONS[1];
}

export function clampColorCount(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_COLOR_COUNT;
  }
  return Math.max(COLOR_COUNT_MIN, Math.min(COLOR_COUNT_MAX, Math.round(value)));
}

export function complexityForColorCount(colorCount: number): ComplexityPreset {
  const clamped = clampColorCount(colorCount);
  if (clamped <= COMPLEXITY_OPTIONS[0].maxColorCount) {
    return 'simple';
  }
  if (clamped <= COMPLEXITY_OPTIONS[1].maxColorCount) {
    return 'medium';
  }
  return 'detailed';
}

export function settingsForColorCount(colorCount: number): GeneratorSettings {
  const kMeansNrOfClusters = clampColorCount(colorCount);
  const complexity = complexityForColorCount(kMeansNrOfClusters);
  if (complexity === 'simple') {
    return {
      ...DEFAULT_SETTINGS,
      kMeansNrOfClusters,
      narrowPixelStripCleanupRuns: 4,
      removeFacetsSmallerThanNrOfPoints: 320,
      nrOfTimesToHalveBorderSegments: 3,
    };
  }

  if (complexity === 'detailed') {
    return {
      ...DEFAULT_SETTINGS,
      kMeansNrOfClusters,
      removeFacetsSmallerThanNrOfPoints: 40,
      nrOfTimesToHalveBorderSegments: 1,
    };
  }

  return {
    ...DEFAULT_SETTINGS,
    kMeansNrOfClusters,
  };
}

export function settingsForComplexity(preset: ComplexityPreset): GeneratorSettings {
  const option = complexityOptionForPreset(preset);
  return settingsForColorCount(Math.round((option.minColorCount + option.maxColorCount) / 2));
}
