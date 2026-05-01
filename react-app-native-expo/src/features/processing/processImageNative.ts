import { calculateNormalizedDimensions } from '../../lib/platform/imageIO.native';
import {
  bilateralSmoothRgb,
  findRegionLabelPointForBBox,
  getOpenCvAdapterStatus,
  labMatToFloat32Samples,
  labPaletteToRgbBytes,
  loadImageUriToMat,
  resizeMat,
  rgbPaletteToLabBytes,
  rgbToLab,
  saveRgbaBufferToCacheFile,
  saveMatToCacheFile,
} from '../../lib/opencv/opencvNative';
import {
  applyMiniBatchQuantization,
  applyRegionMergingTyped,
  buildBoundaryMask,
  cleanupNarrowPixelStrips,
  compactLabelsByPalette,
  FACET_FORCE_MERGE_BELOW,
  type LabelPlacement,
  normalizePaintPalette,
  precomputeLabelPlacementsFast,
  pruneThinProtrusions,
  PYTHON_DEFAULT_SMOOTH_D,
  PYTHON_DEFAULT_SMOOTH_SIGMA_COLOR,
  PYTHON_DEFAULT_SMOOTH_SIGMA_SPACE,
  PYTHON_PRE_REGION_STRIP_CLEANUP_RUNS,
  renderBrightColorCirclesTemplate,
  renderClassicTemplate,
  renderColorCirclesTemplate,
  renderDebugUnlabeledTemplate,
  renderNumbersTemplate,
  renderRgbaBufferFromLabelMap,
} from '../../lib/pipeline';
import type {
  NativePipelineSettings,
  PipelineImageAsset,
  PipelineStageArtifact,
  PipelineStagePreview,
  ProtrusionsStageArtifact,
  QuantizeStageArtifact,
  RenderTemplatePreview,
  RegionMergeStageArtifact,
  StripCleanupStageArtifact,
  StepId,
} from './processingTypes';

function isIndexedArtifact(
  artifact: PipelineStageArtifact | undefined,
): artifact is QuantizeStageArtifact | StripCleanupStageArtifact | ProtrusionsStageArtifact | RegionMergeStageArtifact {
  return artifact != null && 'labelMap' in artifact && 'paletteRgb' in artifact;
}

function isRegionArtifact(
  artifact: PipelineStageArtifact | undefined,
): artifact is RegionMergeStageArtifact {
  return isIndexedArtifact(artifact) && 'regions' in artifact && 'facets' in artifact;
}

function passThroughPreview(
  stepId: StepId,
  sourceImage: PipelineImageAsset,
  note: string,
  status: 'implemented' | 'placeholder',
  extra?: Partial<PipelineStagePreview>,
): PipelineStagePreview {
  return {
    stepId,
    imageUri: sourceImage.uri,
    width: sourceImage.width,
    height: sourceImage.height,
    note,
    status,
    ...extra,
  };
}

async function computeRegionPlacements(args: {
  regionMap: Uint32Array;
  regions: RegionMergeStageArtifact['regions'];
  width: number;
  height: number;
  exact: boolean;
  facets: RegionMergeStageArtifact['facets'];
}): Promise<LabelPlacement[]> {
  const labelRegions = args.regions.filter((region) => region.area >= FACET_FORCE_MERGE_BELOW);

  if (!args.exact) {
    return [...precomputeLabelPlacementsFast(args.facets, args.regions, FACET_FORCE_MERGE_BELOW).values()];
  }

  const placements = await Promise.all(
    labelRegions.map(async (region) => {
      const placement = await findRegionLabelPointForBBox({
        regionMap: args.regionMap,
        regionId: region.regionId,
        bbox: region.bbox,
        width: args.width,
        height: args.height,
      });
      return {
        regionId: region.regionId,
        x: placement.x,
        y: placement.y,
        radius: placement.radius,
      };
    }),
  );

  return placements;
}

export async function processImageNative(args: {
  stepId: StepId;
  sourceImage: PipelineImageAsset;
  settings: NativePipelineSettings;
  previousPreview?: PipelineStagePreview;
  previousArtifact?: PipelineStageArtifact;
}): Promise<{ preview: PipelineStagePreview; artifact?: PipelineStageArtifact }> {
  const { stepId, sourceImage, settings, previousPreview, previousArtifact } = args;
  const previewSource = previousPreview ?? passThroughPreview('normalize', sourceImage, 'Source image selected.', 'implemented');
  const openCvStatus = await getOpenCvAdapterStatus();

  switch (stepId) {
    case 'normalize': {
      const normalized = calculateNormalizedDimensions(sourceImage.width, sourceImage.height, settings.resizeMax);
      if (openCvStatus !== 'ready') {
        return {
          preview: {
            stepId,
            imageUri: sourceImage.uri,
            width: normalized.width,
            height: normalized.height,
            note: 'Image resize targets are computed, but native pixel normalization still requires an Expo Development Build with react-native-fast-opencv linked.',
            status: 'placeholder',
          },
        };
      }

      const sourceMat = await loadImageUriToMat(sourceImage.uri);
      let outputUri = sourceImage.uri;
      if (normalized.width !== sourceMat.width || normalized.height !== sourceMat.height) {
        const resizedMat = await resizeMat(sourceMat, normalized.width, normalized.height);
        outputUri = await saveMatToCacheFile(resizedMat, 'normalize');
      }

      return {
        preview: {
          stepId,
          imageUri: outputUri,
          width: normalized.width,
          height: normalized.height,
          note: 'Normalize & Resize is running through the native file/OpenCV path. Transparent pixel compositing to white still needs a parity pass against the web implementation.',
          status: 'implemented',
        },
      };
    }

    case 'smooth': {
      if (openCvStatus !== 'ready') {
        return {
          preview: passThroughPreview(
            stepId,
            sourceImage,
            'Bilateral smoothing is ready in code, but it requires a native Expo Development Build before the OpenCV bindings are available at runtime.',
            'placeholder',
            { imageUri: previewSource.imageUri, width: previewSource.width, height: previewSource.height },
          ),
        };
      }

      const normalizedInput = await loadImageUriToMat(previewSource.imageUri);
      const smoothed = await bilateralSmoothRgb(
        normalizedInput,
        PYTHON_DEFAULT_SMOOTH_D,
        PYTHON_DEFAULT_SMOOTH_SIGMA_COLOR,
        PYTHON_DEFAULT_SMOOTH_SIGMA_SPACE,
      );
      const outputUri = await saveMatToCacheFile(smoothed, 'smooth');
      return {
        preview: {
          stepId,
          imageUri: outputUri,
          width: smoothed.width,
          height: smoothed.height,
          note: 'Bilateral smoothing now runs through react-native-fast-opencv. The next step is extracting RGB/Lab samples from this native output for quantization.',
          status: 'implemented',
        },
      };
    }

    case 'quantize': {
      if (openCvStatus !== 'ready') {
        return {
          preview: passThroughPreview(
            stepId,
            sourceImage,
            'Quantization is implemented, but native Lab sampling and PNG preview output require an Expo Development Build with react-native-fast-opencv linked.',
            'placeholder',
            {
              imageUri: previewSource.imageUri,
              width: previewSource.width,
              height: previewSource.height,
              colorCount: settings.targetColorCount,
            },
          ),
        };
      }

      const sourceMat = await loadImageUriToMat(previewSource.imageUri);
      const labMat = await rgbToLab(sourceMat);
      const labSamples = await labMatToFloat32Samples(labMat);
      const quantized = applyMiniBatchQuantization({
        labSamples,
        width: labMat.width,
        height: labMat.height,
        requestedColorCount: settings.targetColorCount,
        seed: settings.randomSeed,
      });
      const paletteRgb = await labPaletteToRgbBytes(quantized.centerLabU8);
      const outputBuffer = renderRgbaBufferFromLabelMap(quantized.labelMap, paletteRgb, quantized.width, quantized.height);
      const outputUri = await saveRgbaBufferToCacheFile(outputBuffer, 'quantize');

      return {
        preview: {
          stepId,
          imageUri: outputUri,
          width: quantized.width,
          height: quantized.height,
          note: `MiniBatch K-Means quantization now runs natively on Lab samples and keeps the raw indexed raster before strip cleanup. Requested ${settings.targetColorCount} colors, resolved ${quantized.colorCount} centers.`,
          status: 'implemented',
          colorCount: quantized.colorCount,
          paletteRgb: Array.from(paletteRgb),
        },
        artifact: {
          stepId: 'quantize',
          width: quantized.width,
          height: quantized.height,
          colorCount: quantized.colorCount,
          labelMap: quantized.labelMap,
          paletteRgb,
          centerLabU8: quantized.centerLabU8,
        },
      };
    }

    case 'strip-cleanup': {
      if (!isIndexedArtifact(previousArtifact)) {
        return {
          preview: passThroughPreview(
            stepId,
            sourceImage,
            'Strip cleanup is implemented, but this step still needs the raw quantized indexed raster from the previous stage.',
            'placeholder',
            { imageUri: previewSource.imageUri, width: previewSource.width, height: previewSource.height },
          ),
        };
      }

      if (openCvStatus !== 'ready') {
        return {
          preview: passThroughPreview(
            stepId,
            sourceImage,
            'Strip cleanup requires native OpenCV RGB->Lab palette conversion and PNG preview output, so it needs an Expo Development Build.',
            'placeholder',
            { imageUri: previewSource.imageUri, width: previewSource.width, height: previewSource.height },
          ),
        };
      }

      const paletteLab = await rgbPaletteToLabBytes(previousArtifact.paletteRgb);
      const cleaned = cleanupNarrowPixelStrips(
        previousArtifact.labelMap,
        paletteLab,
        previousArtifact.width,
        previousArtifact.height,
        PYTHON_PRE_REGION_STRIP_CLEANUP_RUNS,
      );
      const compacted = compactLabelsByPalette(
        cleaned,
        previousArtifact.paletteRgb,
        previousArtifact.width,
        previousArtifact.height,
      );
      const outputBuffer = renderRgbaBufferFromLabelMap(
        compacted.labelMap,
        compacted.paletteRgb,
        previousArtifact.width,
        previousArtifact.height,
      );
      const outputUri = await saveRgbaBufferToCacheFile(outputBuffer, 'strip-cleanup');

      return {
        preview: {
          stepId,
          imageUri: outputUri,
          width: previousArtifact.width,
          height: previousArtifact.height,
          note: `Strip cleanup now matches the react-app stage: ${PYTHON_PRE_REGION_STRIP_CLEANUP_RUNS} narrow-strip passes followed by palette compaction.`,
          status: 'implemented',
          colorCount: compacted.paletteRgb.length / 3,
          paletteRgb: Array.from(compacted.paletteRgb),
        },
        artifact: {
          stepId: 'strip-cleanup',
          width: previousArtifact.width,
          height: previousArtifact.height,
          colorCount: compacted.paletteRgb.length / 3,
          labelMap: compacted.labelMap,
          paletteRgb: compacted.paletteRgb,
          centerLabU8: previousArtifact.centerLabU8,
        },
      };
    }

    case 'protrusions': {
      if (!isIndexedArtifact(previousArtifact)) {
        return {
          preview: passThroughPreview(
            stepId,
            sourceImage,
            'Protrusion pruning is implemented, but this step still needs the strip-cleaned indexed-color artifacts from the previous stage.',
            'placeholder',
            { imageUri: previewSource.imageUri, width: previewSource.width, height: previewSource.height },
          ),
        };
      }

      const prunedLabelMap = settings.pruneRadius > 0
        ? pruneThinProtrusions(
            previousArtifact.labelMap,
            previousArtifact.width,
            previousArtifact.height,
            previousArtifact.paletteRgb,
            settings.pruneRadius,
          )
        : new Int32Array(previousArtifact.labelMap);
      const compacted = compactLabelsByPalette(
        prunedLabelMap,
        previousArtifact.paletteRgb,
        previousArtifact.width,
        previousArtifact.height,
      );
      const outputBuffer = renderRgbaBufferFromLabelMap(
        compacted.labelMap,
        compacted.paletteRgb,
        previousArtifact.width,
        previousArtifact.height,
      );
      const outputUri = openCvStatus === 'ready'
        ? await saveRgbaBufferToCacheFile(outputBuffer, 'protrusions')
        : previewSource.imageUri;

      return {
        preview: {
          stepId,
          imageUri: outputUri,
          width: previousArtifact.width,
          height: previousArtifact.height,
          note: settings.pruneRadius > 0
            ? `Thin protrusion pruning is running after strip cleanup on the indexed label map with radius ${settings.pruneRadius}.`
            : 'Thin protrusion pruning is disabled, so this stage is passing the strip-cleaned indexed raster through unchanged.',
          status: 'implemented',
          colorCount: compacted.paletteRgb.length / 3,
          paletteRgb: Array.from(compacted.paletteRgb),
        },
        artifact: {
          stepId: 'protrusions',
          width: previousArtifact.width,
          height: previousArtifact.height,
          colorCount: compacted.paletteRgb.length / 3,
          labelMap: compacted.labelMap,
          paletteRgb: compacted.paletteRgb,
          centerLabU8: previousArtifact.centerLabU8,
        },
      };
    }

    case 'region-merge': {
      if (!isIndexedArtifact(previousArtifact)) {
        return {
          preview: passThroughPreview(
            stepId,
            sourceImage,
            `Facet-based region merging is implemented, but this step still needs indexed-color artifacts from protrusion pruning. Current config: minRegionSize=${settings.minRegionSize}, protectHighContrast=${settings.protectHighContrast}, highContrastMinPx=${settings.highContrastMinPx}.`,
            'placeholder',
            { imageUri: previewSource.imageUri, width: previewSource.width, height: previewSource.height },
          ),
        };
      }

      const merged = applyRegionMergingTyped({
        labelMap: previousArtifact.labelMap,
        width: previousArtifact.width,
        height: previousArtifact.height,
        paletteRgb: previousArtifact.paletteRgb,
        minRegionSize: settings.minRegionSize,
        protectHighContrast: settings.protectHighContrast,
        highContrastMinPx: settings.highContrastMinPx,
      });
      const outputBuffer = renderRgbaBufferFromLabelMap(merged.labelMap, merged.paletteRgb, merged.width, merged.height);
      const outputUri = openCvStatus === 'ready'
        ? await saveRgbaBufferToCacheFile(outputBuffer, 'region-merge')
        : previewSource.imageUri;

      return {
        preview: {
          stepId,
          imageUri: outputUri,
          width: merged.width,
          height: merged.height,
          note: `Facet-based region merging is now running end-to-end with minRegionSize=${settings.minRegionSize}, protectHighContrast=${settings.protectHighContrast}, highContrastMinPx=${settings.highContrastMinPx}.`,
          status: 'implemented',
          colorCount: merged.colorCount,
          paletteRgb: Array.from(merged.paletteRgb),
          regionCount: merged.regions.length,
        },
        artifact: {
          stepId: 'region-merge',
          width: merged.width,
          height: merged.height,
          colorCount: merged.colorCount,
          labelMap: merged.labelMap,
          paletteRgb: merged.paletteRgb,
          facets: merged.facets,
          regions: merged.regions,
        },
      };
    }

    case 'render': {
      if (!isRegionArtifact(previousArtifact)) {
        return {
          preview: passThroughPreview(
            stepId,
            sourceImage,
            'Final rendering is implemented as a native template-preview pass, but it still needs merged region artifacts from the previous stage.',
            'placeholder',
            {
              imageUri: previewSource.imageUri,
              width: previewSource.width,
              height: previewSource.height,
              regionCount: 0,
              placementCount: 0,
            },
          ),
        };
      }

      const placements = await computeRegionPlacements({
        regionMap: previousArtifact.facets.facetMap,
        regions: previousArtifact.regions,
        width: previousArtifact.width,
        height: previousArtifact.height,
        exact: openCvStatus === 'ready',
        facets: previousArtifact.facets,
      });
      const boundaryMask = buildBoundaryMask(previousArtifact.labelMap, previousArtifact.width, previousArtifact.height);
      const normalizedPaletteRgb = normalizePaintPalette(previousArtifact.paletteRgb);
      const outputBuffer = renderBrightColorCirclesTemplate({
        labelMap: previousArtifact.labelMap,
        regions: previousArtifact.regions,
        placements,
        paletteRgb: normalizedPaletteRgb,
        boundaryMask,
        width: previousArtifact.width,
        height: previousArtifact.height,
      });
      const colorCirclesBuffer = renderColorCirclesTemplate({
        labelMap: previousArtifact.labelMap,
        regions: previousArtifact.regions,
        placements,
        paletteRgb: normalizedPaletteRgb,
        boundaryMask,
        width: previousArtifact.width,
        height: previousArtifact.height,
      });
      const numbersBuffer = renderNumbersTemplate({
        labelMap: previousArtifact.labelMap,
        regions: previousArtifact.regions,
        placements,
        boundaryMask,
        width: previousArtifact.width,
        height: previousArtifact.height,
      });
      const classicBuffer = renderClassicTemplate({
        labelMap: previousArtifact.labelMap,
        paletteRgb: normalizedPaletteRgb,
        boundaryMask,
        width: previousArtifact.width,
        height: previousArtifact.height,
      });
      const debugUnlabeledBuffer = renderDebugUnlabeledTemplate({
        facetMap: previousArtifact.facets.facetMap,
        regions: previousArtifact.regions,
        placements,
        paletteRgb: normalizedPaletteRgb,
        boundaryMask,
        width: previousArtifact.width,
        height: previousArtifact.height,
      });

      const templateUris = openCvStatus === 'ready'
        ? await Promise.all([
            saveRgbaBufferToCacheFile(outputBuffer, 'render-bright-color-circles'),
            saveRgbaBufferToCacheFile(colorCirclesBuffer, 'render-color-circles'),
            saveRgbaBufferToCacheFile(numbersBuffer, 'render-numbers'),
            saveRgbaBufferToCacheFile(classicBuffer, 'render-classic'),
            saveRgbaBufferToCacheFile(debugUnlabeledBuffer, 'render-debug-unlabeled'),
          ])
        : null;
      const outputUri = templateUris?.[0] ?? previewSource.imageUri;
      const extraTemplates: RenderTemplatePreview[] = templateUris
        ? [
            { id: 'colorCircles', label: 'Color Circles', imageUri: templateUris[1] },
            { id: 'numbers', label: 'Numbers', imageUri: templateUris[2] },
            { id: 'classic', label: 'Classic', imageUri: templateUris[3] },
            { id: 'debugUnlabeled', label: 'Debug Unlabeled', imageUri: templateUris[4] },
          ]
        : [];

      return {
        preview: {
          stepId,
          imageUri: outputUri,
          width: previousArtifact.width,
          height: previousArtifact.height,
          note: openCvStatus === 'ready'
            ? `Bright-color-circles render now uses native distance-transform label anchors for ${placements.length} surviving regions.`
            : `Bright-color-circles render is falling back to approximate placements because the native OpenCV bindings are unavailable.`,
          status: 'implemented',
          colorCount: previousArtifact.colorCount,
          regionCount: previousArtifact.regions.length,
          placementCount: placements.length,
          templates: extraTemplates,
        },
        artifact: {
          stepId: 'render',
          width: previousArtifact.width,
          height: previousArtifact.height,
          colorCount: previousArtifact.colorCount,
          labelMap: previousArtifact.labelMap,
          paletteRgb: previousArtifact.paletteRgb,
          facets: previousArtifact.facets,
          regions: previousArtifact.regions,
          boundaryMask,
          placements,
          templateUris: templateUris
            ? {
                brightColorCircles: templateUris[0],
                colorCircles: templateUris[1],
                numbers: templateUris[2],
                classic: templateUris[3],
                debugUnlabeled: templateUris[4],
              }
            : undefined,
        },
      };
    }
  }
}
