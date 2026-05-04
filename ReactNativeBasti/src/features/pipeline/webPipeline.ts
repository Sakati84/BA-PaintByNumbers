import { cleanupNarrowPixelStrips, pruneThinProtrusions } from "./core/cleanup";
import { compactLabelsByPalette, normalizePaintPalette, rgbBufferToLabSamples, rgbPaletteToLab } from "./core/colorMath";
import { FACET_FORCE_MERGE_BELOW, PYTHON_PRE_REGION_STRIP_CLEANUP_RUNS } from "./core/constants";
import { applyRegionMergingTyped, buildBoundaryMask } from "./core/facets";
import type { ImageBufferRGBA } from "./core/imageBuffer";
import type { LabelPlacement, RegionInfo } from "./core/placement";
import { precomputeLabelPlacementsFast } from "./core/placement";
import { applyMiniBatchQuantization, type QuantizationDataResult } from "./core/quantization";
import {
  renderBrightColorCirclesTemplate,
  renderCirclesOnlyTemplate,
  renderClassicTemplate,
  renderColorCirclesTemplate,
  renderDebugUnlabeledTemplate,
  renderNumbersTemplate,
  renderRgbaBufferFromLabelMap,
} from "./core/rasterRender";

export type NormalizedImageResult = {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
};

export type WebQuantizationResult = QuantizationDataResult & {
  canvas: OffscreenCanvas;
};

export type IndexedStageResult = {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  colorCount: number;
  labelMap: Int32Array;
  paletteRgb: Uint8Array;
};

export type WebRegionMergeResult = IndexedStageResult & {
  facets: ReturnType<typeof applyRegionMergingTyped>["facets"];
  regions: RegionInfo[];
};

export type RenderTemplatesResult = {
  brightColorCircles: OffscreenCanvas;
  colorCircles: OffscreenCanvas;
  circlesOnly: OffscreenCanvas;
  numbers: OffscreenCanvas;
  classic: OffscreenCanvas;
  debugUnlabeled: OffscreenCanvas;
  regionCount: number;
  placementCount: number;
};

function createOffscreenCanvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(width, height);
}

export function imageDataToOffscreenCanvas(imageData: ImageData): OffscreenCanvas {
  const canvas = createOffscreenCanvas(imageData.width, imageData.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is not available.");
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

export function rgbaBufferToCanvas(input: ImageBufferRGBA): OffscreenCanvas {
  const canvas = createOffscreenCanvas(input.width, input.height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is not available.");
  }
  const pixels = new Uint8ClampedArray(input.width * input.height * 4);
  pixels.set(input.data);
  context.putImageData(new ImageData(pixels, input.width, input.height), 0, 0);
  return canvas;
}

export function canvasToImageData(canvas: OffscreenCanvas): ImageData {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is not available.");
  }
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export async function loadAndNormalizeImage(imageData: ImageData, resizeMax: number): Promise<NormalizedImageResult> {
  const source = await createImageBitmap(imageData);
  const srcWidth = source.width;
  const srcHeight = source.height;
  const longest = Math.max(srcWidth, srcHeight);
  const scale = resizeMax > 0 && longest > resizeMax ? resizeMax / longest : 1;
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const canvas = createOffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is not available.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  (context as OffscreenCanvasRenderingContext2D & { imageSmoothingQuality?: ImageSmoothingQuality }).imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  source.close();

  return { canvas, width, height };
}

function channelDistanceSquared(
  pixels: Uint8ClampedArray,
  centerOffset: number,
  neighbourOffset: number,
): number {
  const deltaRed = pixels[centerOffset] - pixels[neighbourOffset];
  const deltaGreen = pixels[centerOffset + 1] - pixels[neighbourOffset + 1];
  const deltaBlue = pixels[centerOffset + 2] - pixels[neighbourOffset + 2];
  return deltaRed * deltaRed + deltaGreen * deltaGreen + deltaBlue * deltaBlue;
}

export function applyEdgeAwareSmoothing(input: OffscreenCanvas): OffscreenCanvas {
  const context = input.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is not available.");
  }
  let current = context.getImageData(0, 0, input.width, input.height);
  const width = input.width;
  const height = input.height;
  const thresholdSquared = 42 * 42 * 3;

  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Uint8ClampedArray(current.data);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const centerOffset = (y * width + x) * 4;
        let sumRed = current.data[centerOffset] * 3;
        let sumGreen = current.data[centerOffset + 1] * 3;
        let sumBlue = current.data[centerOffset + 2] * 3;
        let totalWeight = 3;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nextX = x + dx;
            const nextY = y + dy;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
              continue;
            }
            const neighbourOffset = (nextY * width + nextX) * 4;
            if (channelDistanceSquared(current.data, centerOffset, neighbourOffset) > thresholdSquared) {
              continue;
            }
            const weight = dx === 0 || dy === 0 ? 2 : 1;
            sumRed += current.data[neighbourOffset] * weight;
            sumGreen += current.data[neighbourOffset + 1] * weight;
            sumBlue += current.data[neighbourOffset + 2] * weight;
            totalWeight += weight;
          }
        }

        next[centerOffset] = Math.round(sumRed / totalWeight);
        next[centerOffset + 1] = Math.round(sumGreen / totalWeight);
        next[centerOffset + 2] = Math.round(sumBlue / totalWeight);
        next[centerOffset + 3] = current.data[centerOffset + 3];
      }
    }
    current = new ImageData(next, width, height);
  }

  const output = createOffscreenCanvas(width, height);
  const outputContext = output.getContext("2d");
  if (!outputContext) {
    throw new Error("Canvas 2D is not available.");
  }
  outputContext.putImageData(current, 0, 0);
  return output;
}

export function applyWebQuantization(canvas: OffscreenCanvas, requestedColorCount: number): WebQuantizationResult {
  const imageData = canvasToImageData(canvas);
  const labSamples = rgbBufferToLabSamples(imageData.data);
  const quantized = applyMiniBatchQuantization({
    labSamples,
    width: canvas.width,
    height: canvas.height,
    requestedColorCount,
  });
  const buffer = renderRgbaBufferFromLabelMap(quantized.labelMap, quantized.paletteRgb, quantized.width, quantized.height);
  return {
    ...quantized,
    canvas: rgbaBufferToCanvas(buffer),
  };
}

export function applyWebStripCleanup(input: WebQuantizationResult): IndexedStageResult {
  const paletteLab = new Uint8Array(rgbPaletteToLab(input.paletteRgb));
  const cleaned = cleanupNarrowPixelStrips(
    input.labelMap,
    paletteLab,
    input.width,
    input.height,
    PYTHON_PRE_REGION_STRIP_CLEANUP_RUNS,
  );
  const compacted = compactLabelsByPalette(cleaned, input.paletteRgb, input.width, input.height);
  const output = renderRgbaBufferFromLabelMap(compacted.labelMap, compacted.paletteRgb, input.width, input.height);
  return {
    canvas: rgbaBufferToCanvas(output),
    width: input.width,
    height: input.height,
    colorCount: compacted.paletteRgb.length / 3,
    labelMap: compacted.labelMap,
    paletteRgb: compacted.paletteRgb,
  };
}

export function applyWebProtrusionPruning(input: IndexedStageResult, pruneRadius = 1): IndexedStageResult {
  const pruned = pruneRadius > 0
    ? pruneThinProtrusions(input.labelMap, input.width, input.height, input.paletteRgb, pruneRadius)
    : new Int32Array(input.labelMap);
  const compacted = compactLabelsByPalette(pruned, input.paletteRgb, input.width, input.height);
  const output = renderRgbaBufferFromLabelMap(compacted.labelMap, compacted.paletteRgb, input.width, input.height);
  return {
    canvas: rgbaBufferToCanvas(output),
    width: input.width,
    height: input.height,
    colorCount: compacted.paletteRgb.length / 3,
    labelMap: compacted.labelMap,
    paletteRgb: compacted.paletteRgb,
  };
}

export function applyWebRegionMerging(args: {
  input: IndexedStageResult;
  minRegionSize?: number;
  protectHighContrast?: boolean;
  highContrastMinPx?: number;
}): WebRegionMergeResult {
  const merged = applyRegionMergingTyped({
    labelMap: args.input.labelMap,
    width: args.input.width,
    height: args.input.height,
    paletteRgb: args.input.paletteRgb,
    minRegionSize: args.minRegionSize,
    protectHighContrast: args.protectHighContrast,
    highContrastMinPx: args.highContrastMinPx,
  });
  const output = renderRgbaBufferFromLabelMap(merged.labelMap, merged.paletteRgb, merged.width, merged.height);
  return {
    canvas: rgbaBufferToCanvas(output),
    width: merged.width,
    height: merged.height,
    colorCount: merged.colorCount,
    labelMap: merged.labelMap,
    paletteRgb: merged.paletteRgb,
    facets: merged.facets,
    regions: merged.regions,
  };
}

function computeFastPlacements(regionMerge: WebRegionMergeResult): LabelPlacement[] {
  return [...precomputeLabelPlacementsFast(regionMerge.facets, regionMerge.regions, FACET_FORCE_MERGE_BELOW).values()];
}

export function applyAllTemplateRenders(regionMerge: WebRegionMergeResult): RenderTemplatesResult {
  const placements = computeFastPlacements(regionMerge);
  const boundaryMask = buildBoundaryMask(regionMerge.labelMap, regionMerge.width, regionMerge.height);
  const normalizedPaletteRgb = normalizePaintPalette(regionMerge.paletteRgb);

  return {
    brightColorCircles: rgbaBufferToCanvas(
      renderBrightColorCirclesTemplate({
        labelMap: regionMerge.labelMap,
        regions: regionMerge.regions,
        placements,
        paletteRgb: normalizedPaletteRgb,
        boundaryMask,
        width: regionMerge.width,
        height: regionMerge.height,
      }),
    ),
    colorCircles: rgbaBufferToCanvas(
      renderColorCirclesTemplate({
        labelMap: regionMerge.labelMap,
        regions: regionMerge.regions,
        placements,
        paletteRgb: normalizedPaletteRgb,
        boundaryMask,
        width: regionMerge.width,
        height: regionMerge.height,
      }),
    ),
    circlesOnly: rgbaBufferToCanvas(
      renderCirclesOnlyTemplate({
        labelMap: regionMerge.labelMap,
        regions: regionMerge.regions,
        placements,
        paletteRgb: normalizedPaletteRgb,
        boundaryMask,
        width: regionMerge.width,
        height: regionMerge.height,
      }),
    ),
    numbers: rgbaBufferToCanvas(
      renderNumbersTemplate({
        labelMap: regionMerge.labelMap,
        regions: regionMerge.regions,
        placements,
        boundaryMask,
        width: regionMerge.width,
        height: regionMerge.height,
      }),
    ),
    classic: rgbaBufferToCanvas(
      renderClassicTemplate({
        labelMap: regionMerge.labelMap,
        paletteRgb: normalizedPaletteRgb,
        boundaryMask,
        width: regionMerge.width,
        height: regionMerge.height,
      }),
    ),
    debugUnlabeled: rgbaBufferToCanvas(
      renderDebugUnlabeledTemplate({
        facetMap: regionMerge.facets.facetMap,
        regions: regionMerge.regions,
        placements,
        paletteRgb: normalizedPaletteRgb,
        boundaryMask,
        width: regionMerge.width,
        height: regionMerge.height,
      }),
    ),
    regionCount: regionMerge.regions.length,
    placementCount: placements.length,
  };
}
