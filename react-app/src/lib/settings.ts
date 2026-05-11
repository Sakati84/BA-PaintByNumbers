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
  removeFacetsSmallerThanNrOfPoints: 20,
  removeFacetsFromLargeToSmall: true,
  maximumNumberOfFacets: 100000,
  nrOfTimesToHalveBorderSegments: 2,
  resizeImageWidth: 1024,
  resizeImageHeight: 1024,
  randomSeed: 0,
};

export type DetailPreset = 'low' | 'medium' | 'high';

export function settingsForPreset(preset: DetailPreset): GeneratorSettings {
  if (preset === 'low') {
    return {
      ...DEFAULT_SETTINGS,
      kMeansNrOfClusters: 10,
      narrowPixelStripCleanupRuns: 2,
      removeFacetsSmallerThanNrOfPoints: 36,
      nrOfTimesToHalveBorderSegments: 1,
    };
  }

  if (preset === 'high') {
    return {
      ...DEFAULT_SETTINGS,
      kMeansNrOfClusters: 20,
      removeFacetsSmallerThanNrOfPoints: 12,
      nrOfTimesToHalveBorderSegments: 2,
    };
  }

  return DEFAULT_SETTINGS;
}
