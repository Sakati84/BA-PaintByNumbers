import { ClusteringColorSpace, Settings } from '../../vendor/paintbynumbersgenerator/settings';
import type { GeneratorSettings } from './generatorTypes';

export const DEFAULT_GENERATOR_SETTINGS: GeneratorSettings = {
  kMeansNrOfClusters: 16,
  kMeansMinDeltaDifference: 1,
  nearIdenticalPaletteMergeLabDistance: 4.25,
  narrowPixelStripCleanupRuns: 0,
  mergeSimilarAdjacentRegions: false,
  removeFacetsSmallerThanImageRatio: 0.00006,
  removeFacetsFromLargeToSmall: true,
  maximumNumberOfFacets: 0,
  nrOfTimesToHalveBorderSegments: 0,
  resizeImageWidth: 2048,
  resizeImageHeight: 2048,
  randomSeed: 7707,
};

export function toVendorSettings(settings: GeneratorSettings): Settings {
  const vendor = new Settings();
  vendor.kMeansNrOfClusters = settings.kMeansNrOfClusters;
  vendor.kMeansMinDeltaDifference = settings.kMeansMinDeltaDifference;
  vendor.kMeansClusteringColorSpace = ClusteringColorSpace.LAB;
  vendor.kMeansColorRestrictions = [];
  vendor.colorAliases = {};
  vendor.narrowPixelStripCleanupRuns = settings.narrowPixelStripCleanupRuns;
  vendor.removeFacetsSmallerThanNrOfPoints = Math.max(1, Math.round(1024 * 1024 * settings.removeFacetsSmallerThanImageRatio));
  vendor.removeFacetsFromLargeToSmall = settings.removeFacetsFromLargeToSmall;
  vendor.maximumNumberOfFacets = settings.maximumNumberOfFacets <= 0 ? Number.MAX_VALUE : settings.maximumNumberOfFacets;
  vendor.nrOfTimesToHalveBorderSegments = settings.nrOfTimesToHalveBorderSegments;
  vendor.resizeImageIfTooLarge = true;
  vendor.resizeImageWidth = settings.resizeImageWidth;
  vendor.resizeImageHeight = settings.resizeImageHeight;
  vendor.randomSeed = settings.randomSeed;
  return vendor;
}
