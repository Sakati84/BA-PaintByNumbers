import { ClusteringColorSpace, Settings } from '../../vendor/paintbynumbersgenerator/settings';
import type { GeneratorSettings } from './generatorTypes';

export const DEFAULT_GENERATOR_SETTINGS: GeneratorSettings = {
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

export function toVendorSettings(settings: GeneratorSettings): Settings {
  const vendor = new Settings();
  vendor.kMeansNrOfClusters = settings.kMeansNrOfClusters;
  vendor.kMeansMinDeltaDifference = settings.kMeansMinDeltaDifference;
  vendor.kMeansClusteringColorSpace = ClusteringColorSpace.RGB;
  vendor.kMeansColorRestrictions = [];
  vendor.colorAliases = {};
  vendor.narrowPixelStripCleanupRuns = settings.narrowPixelStripCleanupRuns;
  vendor.removeFacetsSmallerThanNrOfPoints = settings.removeFacetsSmallerThanNrOfPoints;
  vendor.removeFacetsFromLargeToSmall = settings.removeFacetsFromLargeToSmall;
  vendor.maximumNumberOfFacets = settings.maximumNumberOfFacets <= 0 ? Number.MAX_VALUE : settings.maximumNumberOfFacets;
  vendor.nrOfTimesToHalveBorderSegments = settings.nrOfTimesToHalveBorderSegments;
  vendor.resizeImageIfTooLarge = true;
  vendor.resizeImageWidth = settings.resizeImageWidth;
  vendor.resizeImageHeight = settings.resizeImageHeight;
  vendor.randomSeed = settings.randomSeed;
  return vendor;
}
