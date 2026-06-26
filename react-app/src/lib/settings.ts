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
  kMeansNrOfClusters: 12,
  kMeansMinDeltaDifference: 1,
  narrowPixelStripCleanupRuns: 4,
  removeFacetsSmallerThanNrOfPoints: 260,
  removeFacetsFromLargeToSmall: false,
  maximumNumberOfFacets: 0,
  nrOfTimesToHalveBorderSegments: 2,
  resizeImageWidth: 1280,
  resizeImageHeight: 1280,
  randomSeed: 0,
};

export type ComplexityPreset = 'simple' | 'medium' | 'detailed';

export type ComplexityOption = {
  preset: ComplexityPreset;
  label: string;
  colorCount: number;
  description: string;
};

export const COMPLEXITY_OPTIONS: ComplexityOption[] = [
  {
    preset: 'simple',
    label: 'Einfach',
    colorCount: 8,
    description: 'Große Flächen, klare Konturen, wenig Detail.',
  },
  {
    preset: 'medium',
    label: 'Mittel',
    colorCount: 12,
    description: 'Ausgewogene Vorlage mit gut lesbaren Bereichen.',
  },
  {
    preset: 'detailed',
    label: 'Detailreich',
    colorCount: 24,
    description: 'Mehr Farbnuancen und feinere Segmente.',
  },
];

export function complexityOptionForPreset(preset: ComplexityPreset): ComplexityOption {
  return COMPLEXITY_OPTIONS.find((option) => option.preset === preset) ?? COMPLEXITY_OPTIONS[1];
}

export function settingsForComplexity(preset: ComplexityPreset): GeneratorSettings {
  if (preset === 'simple') {
    return {
      ...DEFAULT_SETTINGS,
      kMeansNrOfClusters: 8,
      narrowPixelStripCleanupRuns: 5,
      removeFacetsSmallerThanNrOfPoints: 420,
      maximumNumberOfFacets: 0,
      nrOfTimesToHalveBorderSegments: 2,
      resizeImageWidth: 1100,
      resizeImageHeight: 1100,
    };
  }

  if (preset === 'detailed') {
    return {
      ...DEFAULT_SETTINGS,
      kMeansNrOfClusters: 24,
      narrowPixelStripCleanupRuns: 3,
      removeFacetsSmallerThanNrOfPoints: 170,
      maximumNumberOfFacets: 0,
      nrOfTimesToHalveBorderSegments: 1,
      resizeImageWidth: 1500,
      resizeImageHeight: 1500,
    };
  }

  return DEFAULT_SETTINGS;
}
