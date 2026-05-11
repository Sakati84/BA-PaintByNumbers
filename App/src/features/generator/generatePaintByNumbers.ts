import type { ImagePickerAsset } from 'expo-image-picker';

import { ColorMapResult, ColorReducer } from '../../vendor/paintbynumbersgenerator/colorreductionmanagement';
import { FacetBorderSegmenter } from '../../vendor/paintbynumbersgenerator/facetBorderSegmenter';
import { FacetBorderTracer } from '../../vendor/paintbynumbersgenerator/facetBorderTracer';
import { FacetCreator } from '../../vendor/paintbynumbersgenerator/facetCreator';
import { FacetLabelPlacer } from '../../vendor/paintbynumbersgenerator/facetLabelPlacer';
import { FacetResult } from '../../vendor/paintbynumbersgenerator/facetmanagement';
import { FacetReducer } from '../../vendor/paintbynumbersgenerator/facetReducer';
import type { RGB } from '../../vendor/paintbynumbersgenerator/common';
import type { SimpleImageData } from '../../types/imageData';
import { toVendorSettings } from './defaultSettings';
import type {
  GeneratorProgress,
  GeneratorResult,
  GeneratorSettings,
  GeneratorStage,
  GeneratorTimings,
  PaletteStat,
} from './generatorTypes';
import { preparePickedImageForGenerator } from './prepareImage';
import { createSvgString } from './svgRenderer';

const STAGE_ORDER: PipelineStage[] = [
  'decode',
  'kmeans',
  'colorMap',
  'facetBuild',
  'narrowCleanup',
  'facetReduce',
  'borderTrace',
  'borderSegment',
  'labelPlacement',
  'svgRender',
];

const STAGE_WEIGHTS: Record<PipelineStage, number> = {
  decode: 0.06,
  kmeans: 0.24,
  colorMap: 0.02,
  facetBuild: 0.16,
  narrowCleanup: 0.06,
  facetReduce: 0.14,
  borderTrace: 0.12,
  borderSegment: 0.1,
  labelPlacement: 0.05,
  svgRender: 0.05,
};

type PipelineStage = Exclude<GeneratorStage, 'done'>;

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function createEmptyImageData(width: number, height: number): SimpleImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 3; index < data.length; index += 4) {
    data[index] = 255;
  }
  return { width, height, data };
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
    const overall = Math.max(0, Math.min(1, offset + weight * Math.max(0, Math.min(1, localProgress))));
    onProgress?.({
      stage,
      progress: Math.round(overall * 100),
      message,
    });
  };
}

function createThrottledStageReporter(
  report: (stage: PipelineStage, localProgress: number, message: string) => void,
  stage: PipelineStage,
  messageFactory: (localProgress: number) => string,
  minIntervalMs = 150,
  minProgressDelta = 0.03,
): (localProgress: number) => void {
  let lastReportedProgress = -1;
  let lastReportedAt = 0;

  return (localProgress: number) => {
    const normalized = Math.max(0, Math.min(1, localProgress));
    const now = nowMs();
    const shouldReport =
      lastReportedProgress < 0 ||
      normalized >= 1 ||
      normalized - lastReportedProgress >= minProgressDelta ||
      now - lastReportedAt >= minIntervalMs;

    if (!shouldReport) {
      return;
    }

    lastReportedProgress = normalized;
    lastReportedAt = now;
    report(stage, normalized, messageFactory(normalized));
  };
}

function addTiming(timings: GeneratorTimings, stage: GeneratorStage, elapsedMs: number): void {
  timings[stage] = (timings[stage] ?? 0) + elapsedMs;
}

function buildPaletteStats(facetResult: FacetResult, colorsByIndex: RGB[]): PaletteStat[] {
  const counts = new Map<number, number>();
  let totalPixels = 0;

  for (const facet of facetResult.facets) {
    if (facet == null) {
      continue;
    }
    counts.set(facet.color, (counts.get(facet.color) ?? 0) + facet.pointCount);
    totalPixels += facet.pointCount;
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .map(([index, frequency]) => ({
      index,
      color: colorsByIndex[index],
      frequency,
      areaPercentage: totalPixels > 0 ? frequency / totalPixels : 0,
    }));
}

export async function generatePaintByNumbers(
  asset: ImagePickerAsset,
  settings: GeneratorSettings,
  onProgress?: (progress: GeneratorProgress) => void,
): Promise<GeneratorResult> {
  const report = createProgressReporter(onProgress);
  const timings: GeneratorTimings = {};
  const vendorSettings = toVendorSettings(settings);

  report('decode', 0, 'Preparing image...');
  const decodeStarted = nowMs();
  const { prepared, imageData } = await preparePickedImageForGenerator(asset, settings);
  addTiming(timings, 'decode', nowMs() - decodeStarted);
  report('decode', 1, `Prepared ${prepared.width}x${prepared.height} image.`);

  const kmeansOutput = createEmptyImageData(imageData.width, imageData.height);
  const kmeansStarted = nowMs();
  await ColorReducer.applyKMeansClustering(imageData, kmeansOutput, vendorSettings, (kmeans) => {
    const delta = Math.min(100, Math.max(0, kmeans.currentDeltaDistanceDifference));
    const local = Math.max(0, Math.min(1, (100 - delta) / 100));
    report('kmeans', local, `Running K-Means (${kmeans.currentDeltaDistanceDifference.toFixed(2)} delta)...`);
  });
  addTiming(timings, 'kmeans', nowMs() - kmeansStarted);
  report('kmeans', 1, 'K-Means clustering complete.');

  const colorMapStarted = nowMs();
  const colorMapResult = ColorReducer.createColorMap(kmeansOutput);
  addTiming(timings, 'colorMap', nowMs() - colorMapStarted);
  report('colorMap', 1, `Built color map with ${colorMapResult.colorsByIndex.length} colors.`);

  let facetResult = new FacetResult();
  const cleanupRuns = Math.max(0, vendorSettings.narrowPixelStripCleanupRuns);

  if (cleanupRuns === 0) {
    const facetBuildStarted = nowMs();
    const reportFacetBuild = createThrottledStageReporter(report, 'facetBuild', () => 'Building facets...');
    facetResult = await FacetCreator.getFacets(colorMapResult.width, colorMapResult.height, colorMapResult.imgColorIndices, reportFacetBuild);
    addTiming(timings, 'facetBuild', nowMs() - facetBuildStarted);
    report('facetBuild', 1, `Built ${facetResult.facets.length} raw facets.`);

    const facetReduceStarted = nowMs();
    await FacetReducer.reduceFacets(
      vendorSettings.removeFacetsSmallerThanNrOfPoints,
      vendorSettings.removeFacetsFromLargeToSmall,
      vendorSettings.maximumNumberOfFacets,
      colorMapResult.colorsByIndex,
      facetResult,
      colorMapResult.imgColorIndices,
      createThrottledStageReporter(report, 'facetReduce', () => 'Reducing facets...'),
    );
    addTiming(timings, 'facetReduce', nowMs() - facetReduceStarted);
    report('facetReduce', 1, 'Facet reduction complete.');
  } else {
    for (let run = 0; run < cleanupRuns; run += 1) {
      const cleanupLocalStart = cleanupRuns > 0 ? run / cleanupRuns : 0;
      report('narrowCleanup', cleanupLocalStart, `Cleanup run ${run + 1}/${cleanupRuns}...`);
      const cleanupStarted = nowMs();
      await ColorReducer.processNarrowPixelStripCleanup(colorMapResult);
      addTiming(timings, 'narrowCleanup', nowMs() - cleanupStarted);
      report('narrowCleanup', (run + 1) / cleanupRuns, `Cleanup run ${run + 1}/${cleanupRuns} complete.`);

      const facetBuildStarted = nowMs();
      const reportFacetBuild = createThrottledStageReporter(
        report,
        'facetBuild',
        () => `Building facets (${run + 1}/${cleanupRuns})...`,
      );
      facetResult = await FacetCreator.getFacets(colorMapResult.width, colorMapResult.height, colorMapResult.imgColorIndices, (progress) => {
        reportFacetBuild((run + progress) / cleanupRuns);
      });
      addTiming(timings, 'facetBuild', nowMs() - facetBuildStarted);

      const facetReduceStarted = nowMs();
      const reportFacetReduce = createThrottledStageReporter(
        report,
        'facetReduce',
        () => `Reducing facets (${run + 1}/${cleanupRuns})...`,
      );
      await FacetReducer.reduceFacets(
        vendorSettings.removeFacetsSmallerThanNrOfPoints,
        vendorSettings.removeFacetsFromLargeToSmall,
        vendorSettings.maximumNumberOfFacets,
        colorMapResult.colorsByIndex,
        facetResult,
        colorMapResult.imgColorIndices,
        (progress) => {
          reportFacetReduce((run + progress) / cleanupRuns);
        },
      );
      addTiming(timings, 'facetReduce', nowMs() - facetReduceStarted);
    }
    report('facetBuild', 1, `Built ${facetResult.facets.filter((facet) => facet != null).length} reduced facets.`);
    report('narrowCleanup', 1, 'Narrow cleanup complete.');
    report('facetReduce', 1, 'Cleanup and facet reduction complete.');
  }

  const borderTraceStarted = nowMs();
  await FacetBorderTracer.buildFacetBorderPaths(
    facetResult,
    createThrottledStageReporter(report, 'borderTrace', () => 'Tracing facet borders...'),
  );
  addTiming(timings, 'borderTrace', nowMs() - borderTraceStarted);
  report('borderTrace', 1, 'Border tracing complete.');

  const borderSegmentStarted = nowMs();
  await FacetBorderSegmenter.buildFacetBorderSegments(
    facetResult,
    vendorSettings.nrOfTimesToHalveBorderSegments,
    createThrottledStageReporter(report, 'borderSegment', () => 'Smoothing border segments...'),
  );
  addTiming(timings, 'borderSegment', nowMs() - borderSegmentStarted);
  report('borderSegment', 1, 'Border segmentation complete.');

  const labelPlacementStarted = nowMs();
  await FacetLabelPlacer.buildFacetLabelBounds(
    facetResult,
    createThrottledStageReporter(report, 'labelPlacement', () => 'Placing labels...'),
  );
  addTiming(timings, 'labelPlacement', nowMs() - labelPlacementStarted);
  report('labelPlacement', 1, 'Label placement complete.');

  const svgRenderStarted = nowMs();
  const svg = await createSvgString(
    facetResult,
    colorMapResult.colorsByIndex,
    {
      sizeMultiplier: 3,
      fill: true,
      stroke: true,
      addColorLabels: true,
      fontSize: 50,
      fontColor: '#000',
    },
    createThrottledStageReporter(report, 'svgRender', () => 'Rendering SVG...'),
  );
  addTiming(timings, 'svgRender', nowMs() - svgRenderStarted);
  onProgress?.({
    stage: 'done',
    progress: 100,
    message: 'SVG generation complete.',
  });

  const palette = buildPaletteStats(facetResult, colorMapResult.colorsByIndex);
  const survivingFacets = facetResult.facets.filter((facet) => facet != null).length;

  return {
    svg,
    svgWidth: facetResult.width * 3,
    svgHeight: facetResult.height * 3,
    imageWidth: facetResult.width,
    imageHeight: facetResult.height,
    facetCount: survivingFacets,
    palette,
    timings,
    preparedImage: prepared,
  };
}
