// OpenCV runtime is passed as parameter from the worker

export interface PipelineOptions {
  colorCount: number;
  resizeMax: number;
}

export interface PipelineProgressUpdate {
  stepId: string;
  message: string;
  percent: number;
}

export interface PipelineDebugStage {
  id: string;
  name: string;
  blob: Blob;
  objectUrl: string;
  width: number;
  height: number;
}

export interface PipelineStageResult {
  stageId: string;
  stageName: string;
  blob: Blob;
  objectUrl: string;
  width: number;
  height: number;
  colorCount: number;
  validationTarget: string;
  validationNote: string;
  debugStages: PipelineDebugStage[];
}

const PYTHON_DEFAULT_SMOOTH_D = 9;
const PYTHON_DEFAULT_SMOOTH_SIGMA_COLOR = 50.0;
const PYTHON_DEFAULT_SMOOTH_SIGMA_SPACE = 50.0;
const PYTHON_KMEANS_RANDOM_STATE = 0;
const PYTHON_DEFAULT_MIN_LABEL_AREA = 260;
const MIN_LABEL_AREA_RATIO = 0.00025;
const PYTHON_PRE_REGION_STRIP_CLEANUP_RUNS = 8;
const OUTLINE_RGB: [number, number, number] = [200, 200, 200];
const TEMPLATE_BG_RGB: [number, number, number] = [255, 255, 255];
const LIGHT_PAINT_RGB: [number, number, number] = [238, 232, 218];
const HARD_EDGE_PROTECTION_LAB_DISTANCE = 26.0;
const TINY_HARD_EDGE_MERGE_MAX_AREA = 8;
const SMALL_REGION_MAX_PASSES = 3;
const THIN_REGION_MAX_AREA_MULTIPLIER = 2;
const THIN_REGION_MAX_AVERAGE_THICKNESS = 5.5;
const NARROW_STRIP_CLEANUP_RUNS = 4;
const THIN_PROTRUSION_KERNEL_RADIUS = 1;
const THIN_PROTRUSION_MAX_FILL_STEPS = 12;
const KMEANS_TERM_MAX_ITER = 100;
const KMEANS_TERM_EPSILON = 0.2;
const KMEANS_MERGE_SIMILAR_LAB_DISTANCE = 8; // merge palette entries closer than this in Lab space

// Facet-based region merging (Voronoi reallocation)
const FACET_SMALL_THRESHOLD = 20;
const FACET_MAX_COUNT = Number.MAX_SAFE_INTEGER;
const FACET_REMOVE_LARGE_TO_SMALL = false;
const FACET_DETAIL_PROTECT_LAB_DISTANCE = 25; // skip deletion if min Lab color distance to ALL neighbours exceeds this
const FACET_FORCE_MERGE_BELOW = 20; // regions smaller than this are ALWAYS merged, even high-contrast ones

export type QuantizationResult = {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  colorCount: number;
  labelMap: Int32Array;
  paletteRgb: Uint8Array;
};

export type LabelCleanupResult = {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  colorCount: number;
  labelMap: Int32Array;
  paletteRgb: Uint8Array;
};

export type ProtrusionPruneResult = {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  colorCount: number;
  labelMap: Int32Array;
  paletteRgb: Uint8Array;
};

export type RegionMergeResult = {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  colorCount: number;
  labelMap: Int32Array;
  paletteRgb: Uint8Array;
};

type RegionInfo = {
  regionId: number;
  colorIndex: number;
  area: number;
  bbox: [number, number, number, number];
};

type LabelPlacement = {
  regionId: number;
  x: number;
  y: number;
  radius: number;
};

// ── Facet-based region merging types ──

interface FacetBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface FacetPoint {
  x: number;
  y: number;
}

interface Facet {
  id: number;
  color: number;
  pointCount: number;
  borderPoints: FacetPoint[];
  neighbourFacets: number[] | null;
  neighbourFacetsIsDirty: boolean;
  bbox: FacetBBox;
}

interface FacetResult {
  facetMap: Uint32Array;
  facets: (Facet | null)[];
  width: number;
  height: number;
}

export async function runCurrentStage(
  sourceImageData: ImageData,
  options: PipelineOptions,
  onProgress?: (update: PipelineProgressUpdate) => void,
): Promise<PipelineStageResult> {
  reportProgress(onProgress, "normalize", "Loading source image", 5);
  await yieldToUi();
  const loaded = await loadAndNormalizeImage(sourceImageData, options.resizeMax);

  reportProgress(onProgress, "opencv", "OpenCV should be pre-loaded from worker", 12);
  await yieldToUi();
  const cv = null as any; // Not used — pipeline steps are called individually from the worker

  reportProgress(onProgress, "smooth", "Applying bilateral smoothing", 24);
  await yieldToUi();
  const smoothCanvas = applyBilateralSmoothing(loaded.canvas, cv);

  reportProgress(onProgress, "quantize", "Converting to Lab and running OpenCV kmeans", 40);
  await yieldToUi();
  const quantized = applyKMeansQuantization(smoothCanvas, options.colorCount, cv);

  reportProgress(onProgress, "strip-cleanup", "Cleaning narrow strips and compacting labels", 55);
  await yieldToUi();
  const stripCleanup = applyStripCleanupAndCompaction(quantized, cv);

  reportProgress(onProgress, "protrusions", "Pruning thin protrusions", 65);
  await yieldToUi();
  const protrusionPrune = applyProtrusionPruning(stripCleanup, cv);

  reportProgress(onProgress, "region-merge", "Merging small regions", 76);
  await yieldToUi();
  const regionMerge = applyRegionMerging(protrusionPrune, cv);

  reportProgress(onProgress, "placements", "Computing label placements and final render", 88);
  await yieldToUi();
  const finalTemplate = applyBrightColorCirclesRender(regionMerge, cv);

  reportProgress(onProgress, "debug-capture", "Capturing debug previews", 95);
  await yieldToUi();
  const debugStages = await Promise.all([
    createDebugStage("normalized", "Normalized input", loaded.canvas),
    createDebugStage("smooth", "Bilateral smoothing", smoothCanvas),
    createDebugStage("quantized", "Raw quantized raster", quantized.canvas),
    createDebugStage("strip-cleanup", "Strip cleanup", stripCleanup.canvas),
    createDebugStage("protrusion-prune", "Protrusion prune", protrusionPrune.canvas),
    createDebugStage("region-merge", "Merged cleanup", regionMerge.canvas),
  ]);

  reportProgress(onProgress, "complete", "Rendering final Stage 8 template", 100);
  await yieldToUi();
  const blob = await canvasToBlob(finalTemplate.canvas);
  const objectUrl = URL.createObjectURL(blob);

  return {
    stageId: "stage-8-render",
    stageName: "Stage 8: Bright color circles render",
    blob,
    objectUrl,
    width: loaded.width,
    height: loaded.height,
    colorCount: finalTemplate.colorCount,
    validationTarget: "Python output: output/template_bright_color_circles.png",
    validationNote:
      `This final browser template computes ${finalTemplate.placementCount} Python-style label anchors, applies the same normalized paint palette, and brightens the region fill with the same white-tint rule as Python. Compare the full output against output/template_bright_color_circles.png. Any remaining mismatch is most likely still upstream from Stage 3 because the browser uses OpenCV kmeans while Python uses sklearn MiniBatchKMeans.`,
    debugStages,
  };
}

function reportProgress(
  onProgress: ((update: PipelineProgressUpdate) => void) | undefined,
  stepId: string,
  message: string,
  percent: number,
): void {
  onProgress?.({ stepId, message, percent });
}

async function yieldToUi(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function createDebugStage(id: string, name: string, canvas: OffscreenCanvas): Promise<PipelineDebugStage> {
  const blob = await canvasToBlob(canvas);
  return {
    id,
    name,
    blob,
    objectUrl: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function loadAndNormalizeImage(imageData: ImageData, resizeMax: number): Promise<{ canvas: OffscreenCanvas; width: number; height: number }> {
  const source = await createImageBitmap(imageData);
  const srcWidth = source.width;
  const srcHeight = source.height;
  const longest = Math.max(srcWidth, srcHeight);
  const scale = resizeMax > 0 && longest > resizeMax ? resizeMax / longest : 1;
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("OffscreenCanvas 2D is not available.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  (context as any).imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  source.close();

  return { canvas, width, height };
}

export function applyBilateralSmoothing(canvas: OffscreenCanvas, cv: any): OffscreenCanvas {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is not available in this browser.");
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const rgbaMat = cv.matFromImageData(imageData);
  const rgbMat = new cv.Mat();
  const smoothMat = new cv.Mat();
  const outputRgbaMat = new cv.Mat();

  try {
    cv.cvtColor(rgbaMat, rgbMat, cv.COLOR_RGBA2RGB);
    cv.bilateralFilter(
      rgbMat,
      smoothMat,
      PYTHON_DEFAULT_SMOOTH_D,
      PYTHON_DEFAULT_SMOOTH_SIGMA_COLOR,
      PYTHON_DEFAULT_SMOOTH_SIGMA_SPACE,
    );
    cv.cvtColor(smoothMat, outputRgbaMat, cv.COLOR_RGB2RGBA);

    const outputCanvas = new OffscreenCanvas(canvas.width, canvas.height);

    const outputContext = outputCanvas.getContext("2d");
    if (!outputContext) {
      throw new Error("Canvas 2D is not available in this browser.");
    }

    const outputImageData = new ImageData(
      new Uint8ClampedArray(outputRgbaMat.data),
      outputCanvas.width,
      outputCanvas.height,
    );
    outputContext.putImageData(outputImageData, 0, 0);
    return outputCanvas;
  } finally {
    rgbaMat.delete();
    rgbMat.delete();
    smoothMat.delete();
    outputRgbaMat.delete();
  }
}

export function applyKMeansQuantization(
  canvas: OffscreenCanvas,
  requestedColorCount: number,
  cv: any,
): QuantizationResult {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is not available in this browser.");
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const rgbaMat = cv.matFromImageData(imageData);
  const rgbMat = new cv.Mat();
  const labMat = new cv.Mat();
  const labelMat = new cv.Mat();
  const centerMat = new cv.Mat();

  let sampleMat: ReturnType<typeof cv.matFromArray> | null = null;
  let centerLabU8Mat: ReturnType<typeof cv.matFromArray> | null = null;
  let centerRgbMat: ReturnType<typeof cv.matFromArray> | null = null;

  try {
    cv.cvtColor(rgbaMat, rgbMat, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgbMat, labMat, cv.COLOR_RGB2Lab);

    const pixelCount = canvas.width * canvas.height;
    const colorCount = Math.max(1, Math.min(Math.trunc(requestedColorCount) || 1, pixelCount));
    const labFloats = new Float32Array(labMat.data.length);
    for (let index = 0; index < labMat.data.length; index += 1) {
      labFloats[index] = labMat.data[index];
    }

    sampleMat = cv.matFromArray(pixelCount, 3, cv.CV_32F, labFloats);
    if (typeof cv.setRNGSeed === "function") {
      cv.setRNGSeed(PYTHON_KMEANS_RANDOM_STATE);
    }

    const criteriaType = (cv.TermCriteria_EPS ?? 2) + (cv.TermCriteria_MAX_ITER ?? 1);
    const criteria = new cv.TermCriteria(criteriaType, KMEANS_TERM_MAX_ITER, KMEANS_TERM_EPSILON);
    const flags = typeof cv.KMEANS_PP_CENTERS === "number" ? cv.KMEANS_PP_CENTERS : 2;

    // Oversample: run K-means with extra clusters so minority colors
    // (e.g., brown among greens) get their own center rather than being
    // absorbed by a majority-color center.  Then greedily merge the
    // closest center pairs back to the requested count.
    const overK = Math.min(pixelCount, colorCount + Math.max(4, Math.ceil(colorCount * 0.5)));
    cv.kmeans(sampleMat, overK, labelMat, criteria, 1, flags, centerMat);

    // --- Merge closest center pairs from overK down to colorCount ---
    const centerFloats = new Float32Array(overK * 3);
    for (let i = 0; i < overK * 3; i++) centerFloats[i] = centerMat.data32F[i];
    const rawLabels = new Int32Array(labelMat.data32S);
    const clusterAlive = new Uint8Array(overK).fill(1);
    const clusterRemap = new Int32Array(overK);
    for (let i = 0; i < overK; i++) clusterRemap[i] = i;
    const clusterWeight = new Float64Array(overK);
    for (let p = 0; p < pixelCount; p++) clusterWeight[rawLabels[p]]++;

    let liveCount = overK;
    while (liveCount > colorCount) {
      let mI = -1, mJ = -1, mD = Number.MAX_VALUE;
      for (let i = 0; i < overK; i++) {
        if (!clusterAlive[i]) continue;
        for (let j = i + 1; j < overK; j++) {
          if (!clusterAlive[j]) continue;
          const oi = i * 3, oj = j * 3;
          const dL = centerFloats[oi] - centerFloats[oj];
          const da = centerFloats[oi + 1] - centerFloats[oj + 1];
          const db = centerFloats[oi + 2] - centerFloats[oj + 2];
          const d = dL * dL + da * da + db * db;
          if (d < mD) { mD = d; mI = i; mJ = j; }
        }
      }
      if (mI < 0) break;
      const wi = clusterWeight[mI], wj = clusterWeight[mJ], wt = wi + wj || 1;
      const oi = mI * 3, oj = mJ * 3;
      centerFloats[oi]     = (centerFloats[oi] * wi + centerFloats[oj] * wj) / wt;
      centerFloats[oi + 1] = (centerFloats[oi + 1] * wi + centerFloats[oj + 1] * wj) / wt;
      centerFloats[oi + 2] = (centerFloats[oi + 2] * wi + centerFloats[oj + 2] * wj) / wt;
      clusterWeight[mI] = wt;
      clusterAlive[mJ] = 0;
      for (let k = 0; k < overK; k++) {
        if (clusterRemap[k] === mJ) clusterRemap[k] = mI;
      }
      liveCount--;
    }

    const finalIdx = new Int32Array(overK).fill(-1);
    let finalCount = 0;
    for (let i = 0; i < overK; i++) {
      if (clusterAlive[i]) finalIdx[i] = finalCount++;
    }

    const centerLabU8 = new Uint8Array(finalCount * 3);
    for (let i = 0; i < overK; i++) {
      if (!clusterAlive[i]) continue;
      const fo = finalIdx[i] * 3, ci = i * 3;
      centerLabU8[fo]     = clampToByte(centerFloats[ci]);
      centerLabU8[fo + 1] = clampToByte(centerFloats[ci + 1]);
      centerLabU8[fo + 2] = clampToByte(centerFloats[ci + 2]);
    }

    // Reassign each pixel to the nearest final center in Lab space.
    // The remap path (finalIdx[clusterRemap[...]]) can leave a pixel with a
    // center that is no longer its closest after the weighted merge.  With
    // only ~24 final centers the brute-force scan is cheap.
    const labels = new Int32Array(pixelCount);
    for (let p = 0; p < pixelCount; p++) {
      const pOff = p * 3;
      const pL = labFloats[pOff], pa = labFloats[pOff + 1], pb = labFloats[pOff + 2];
      let bestLabel = 0, bestDist = Number.MAX_VALUE;
      for (let c = 0; c < finalCount; c++) {
        const co = c * 3;
        const dL = pL - centerLabU8[co];
        const da = pa - centerLabU8[co + 1];
        const db2 = pb - centerLabU8[co + 2];
        const d = dL * dL + da * da + db2 * db2;
        if (d < bestDist) { bestDist = d; bestLabel = c; }
      }
      labels[p] = bestLabel;
    }

    centerLabU8Mat = cv.matFromArray(1, finalCount, cv.CV_8UC3, centerLabU8);
    centerRgbMat = new cv.Mat();
    cv.cvtColor(centerLabU8Mat, centerRgbMat, cv.COLOR_Lab2RGB);

    const paletteRgb = new Uint8Array(centerRgbMat.data);

    // Merge near-duplicate palette colors that K-Means split
    mergeNearDuplicateColors(centerLabU8, paletteRgb, labels, finalCount);

    return {
      canvas: renderCanvasFromLabelMap(labels, paletteRgb, canvas.width, canvas.height),
      width: canvas.width,
      height: canvas.height,
      colorCount: finalCount,
      labelMap: labels,
      paletteRgb,
    };
  } finally {
    rgbaMat.delete();
    rgbMat.delete();
    labMat.delete();
    labelMat.delete();
    centerMat.delete();
    sampleMat?.delete();
    centerLabU8Mat?.delete();
    centerRgbMat?.delete();
  }
}

export function applyStripCleanupAndCompaction(
  quantized: QuantizationResult,
  cv: any,
): LabelCleanupResult {
  const cleaned = cleanupNarrowPixelStrips(
    quantized.labelMap,
    quantized.paletteRgb,
    quantized.width,
    quantized.height,
    cv,
    PYTHON_PRE_REGION_STRIP_CLEANUP_RUNS,
  );
  const compacted = compactLabelsByPalette(cleaned, quantized.paletteRgb, quantized.width, quantized.height, cv);

  return {
    canvas: renderCanvasFromLabelMap(compacted.labelMap, compacted.paletteRgb, quantized.width, quantized.height),
    width: quantized.width,
    height: quantized.height,
    colorCount: compacted.paletteRgb.length / 3,
    labelMap: compacted.labelMap,
    paletteRgb: compacted.paletteRgb,
  };
}

export function applyProtrusionPruning(
  input: QuantizationResult,
  cv: any,
  pruneRadius?: number,
): ProtrusionPruneResult {
  const radius = pruneRadius != null ? pruneRadius : THIN_PROTRUSION_KERNEL_RADIUS;
  if (radius <= 0) {
    // Skip pruning entirely
    return {
      canvas: renderCanvasFromLabelMap(input.labelMap, input.paletteRgb, input.width, input.height),
      width: input.width,
      height: input.height,
      colorCount: input.colorCount,
      labelMap: new Int32Array(input.labelMap),
      paletteRgb: input.paletteRgb,
    };
  }
  const pruned = pruneThinProtrusions(
    input.labelMap,
    input.width,
    input.height,
    input.colorCount,
    input.paletteRgb,
    cv,
    radius,
  );

  return {
    canvas: renderCanvasFromLabelMap(pruned, input.paletteRgb, input.width, input.height),
    width: input.width,
    height: input.height,
    colorCount: input.colorCount,
    labelMap: pruned,
    paletteRgb: input.paletteRgb,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// Facet-based region merging (Voronoi reallocation)
// Ported from paintbynumbersgenerator — uses flood-fill CCA + iterative
// facet deletion with Voronoi-style pixel redistribution.
// ══════════════════════════════════════════════════════════════════════════

// Optimized flood-fill (Adam Milazzo algorithm)
function facetFill(
  x: number, y: number, width: number, height: number,
  visited: (i: number, j: number) => boolean,
  setFill: (i: number, j: number) => void,
) {
  let xx = x, yy = y;
  while (true) {
    const ox = xx, oy = yy;
    while (yy !== 0 && !visited(xx, yy - 1)) yy--;
    while (xx !== 0 && !visited(xx - 1, yy)) xx--;
    if (xx === ox && yy === oy) break;
  }
  facetFillCore(xx, yy, width, height, visited, setFill);
}

function facetFillCore(
  x: number, y: number, width: number, height: number,
  visited: (i: number, j: number) => boolean,
  setFill: (i: number, j: number) => void,
) {
  let lastRowLength = 0;
  do {
    let rowLength = 0;
    let sx = x;
    if (lastRowLength !== 0 && visited(x, y)) {
      do { if (--lastRowLength === 0) return; } while (visited(++x, y));
      sx = x;
    } else {
      for (; x !== 0 && !visited(x - 1, y); rowLength++, lastRowLength++) {
        x--;
        setFill(x, y);
        if (y !== 0 && !visited(x, y - 1)) facetFill(x, y - 1, width, height, visited, setFill);
      }
    }
    for (; sx < width && !visited(sx, y); rowLength++, sx++) setFill(sx, y);
    if (rowLength < lastRowLength) {
      for (const end = x + lastRowLength; ++sx < end;) {
        if (!visited(sx, y)) facetFillCore(sx, y, width, height, visited, setFill);
      }
    } else if (rowLength > lastRowLength && y !== 0) {
      for (let ux = x + lastRowLength; ++ux < sx;) {
        if (!visited(ux, y - 1)) facetFill(ux, y - 1, width, height, visited, setFill);
      }
    }
    lastRowLength = rowLength;
  } while (lastRowLength !== 0 && ++y < height);
}

function facetBuildOne(
  facetIndex: number, facetColorIndex: number,
  x: number, y: number,
  visitedArr: Uint8Array, colorIndices: Int32Array,
  facetMap: Uint32Array, width: number, height: number,
): Facet {
  const facet: Facet = {
    id: facetIndex, color: facetColorIndex, pointCount: 0,
    borderPoints: [], neighbourFacets: null, neighbourFacetsIsDirty: true,
    bbox: { minX: Number.MAX_SAFE_INTEGER, minY: Number.MAX_SAFE_INTEGER, maxX: 0, maxY: 0 },
  };
  facetFill(x, y, width, height,
    (ptx, pty) => visitedArr[pty * width + ptx] !== 0 || colorIndices[pty * width + ptx] !== facetColorIndex,
    (ptx, pty) => {
      const idx = pty * width + ptx;
      visitedArr[idx] = 1;
      facetMap[idx] = facetIndex;
      facet.pointCount++;
      const isInner =
        (ptx - 1 >= 0 && colorIndices[idx - 1] === facetColorIndex) &&
        (pty - 1 >= 0 && colorIndices[idx - width] === facetColorIndex) &&
        (ptx + 1 < width && colorIndices[idx + 1] === facetColorIndex) &&
        (pty + 1 < height && colorIndices[idx + width] === facetColorIndex);
      if (!isInner) facet.borderPoints.push({ x: ptx, y: pty });
      if (ptx > facet.bbox.maxX) facet.bbox.maxX = ptx;
      if (pty > facet.bbox.maxY) facet.bbox.maxY = pty;
      if (ptx < facet.bbox.minX) facet.bbox.minX = ptx;
      if (pty < facet.bbox.minY) facet.bbox.minY = pty;
    },
  );
  return facet;
}

function facetBuildNeighbour(facet: Facet, fr: FacetResult) {
  const uniqueSet = new Set<number>();
  const { facetMap, width, height } = fr;
  for (const pt of facet.borderPoints) {
    const idx = pt.y * width + pt.x;
    if (pt.x - 1 >= 0) { const v = facetMap[idx - 1]; if (v !== facet.id) uniqueSet.add(v); }
    if (pt.y - 1 >= 0) { const v = facetMap[idx - width]; if (v !== facet.id) uniqueSet.add(v); }
    if (pt.x + 1 < width) { const v = facetMap[idx + 1]; if (v !== facet.id) uniqueSet.add(v); }
    if (pt.y + 1 < height) { const v = facetMap[idx + width]; if (v !== facet.id) uniqueSet.add(v); }
  }
  facet.neighbourFacets = [...uniqueSet];
  facet.neighbourFacetsIsDirty = false;
}

function facetGetAll(colorIndices: Int32Array, width: number, height: number): FacetResult {
  const visitedArr = new Uint8Array(width * height);
  const facetMap = new Uint32Array(width * height);
  const facets: (Facet | null)[] = [];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (visitedArr[j * width + i] === 0) {
        const colorIndex = colorIndices[j * width + i];
        const facetIndex = facets.length;
        facets.push(facetBuildOne(facetIndex, colorIndex, i, j, visitedArr, colorIndices, facetMap, width, height));
      }
    }
  }
  const result: FacetResult = { facetMap, facets, width, height };
  for (const f of facets) { if (f != null) facetBuildNeighbour(f, result); }
  return result;
}

/** Pure-JS sRGB → CIE Lab conversion for a small palette (no OpenCV needed). */
function rgbPaletteToLab(paletteRgb: Uint8Array): Float64Array {
  const n = paletteRgb.length / 3;
  const lab = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ro = i * 3;
    // Linearize sRGB
    let r = paletteRgb[ro] / 255, g = paletteRgb[ro + 1] / 255, b = paletteRgb[ro + 2] / 255;
    r = r > 0.04045 ? ((r + 0.055) / 1.055) ** 2.4 : r / 12.92;
    g = g > 0.04045 ? ((g + 0.055) / 1.055) ** 2.4 : g / 12.92;
    b = b > 0.04045 ? ((b + 0.055) / 1.055) ** 2.4 : b / 12.92;
    // sRGB → XYZ (D65)
    let x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
    let y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
    let z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;
    const e = 216 / 24389, k = 24389 / 27;
    x = x > e ? x ** (1 / 3) : (k * x + 16) / 116;
    y = y > e ? y ** (1 / 3) : (k * y + 16) / 116;
    z = z > e ? z ** (1 / 3) : (k * z + 16) / 116;
    lab[ro]     = 116 * y - 16; // L
    lab[ro + 1] = 500 * (x - y); // a
    lab[ro + 2] = 200 * (y - z); // b
  }
  return lab;
}

function facetColorDistanceMatrix(paletteRgb: Uint8Array): number[][] {
  const paletteLab = rgbPaletteToLab(paletteRgb);
  const colorCount = paletteRgb.length / 3;
  const distances: number[][] = new Array(colorCount);
  for (let j = 0; j < colorCount; j++) distances[j] = new Array(colorCount);
  for (let j = 0; j < colorCount; j++) {
    for (let i = j; i < colorCount; i++) {
      const jo = j * 3, io = i * 3;
      const dL = paletteLab[jo] - paletteLab[io];
      const da = paletteLab[jo + 1] - paletteLab[io + 1];
      const db = paletteLab[jo + 2] - paletteLab[io + 2];
      const dist = Math.sqrt(dL * dL + da * da + db * db);
      distances[i][j] = dist;
      distances[j][i] = dist;
    }
  }
  return distances;
}

// Find the neighbor whose color is most similar to the facet being removed.
// Returns the neighbor facet ID, or -1 if no neighbors exist.
function facetMostSimilarNeighbour(
  facetToRemove: Facet, fr: FacetResult, colorDistances: number[][],
): number {
  let bestNeighbour = -1, bestDist = Number.MAX_VALUE;
  if (facetToRemove.neighbourFacetsIsDirty) facetBuildNeighbour(facetToRemove, fr);
  for (const neighbourIdx of facetToRemove.neighbourFacets!) {
    const neighbour = fr.facets[neighbourIdx];
    if (neighbour != null) {
      const dist = colorDistances[facetToRemove.color][neighbour.color];
      if (dist < bestDist) { bestDist = dist; bestNeighbour = neighbourIdx; }
    }
  }
  return bestNeighbour;
}

function facetRebuildChangedNeighbours(
  visitedArr: Uint8Array, facetToRemove: Facet,
  colorIndices: Int32Array, fr: FacetResult,
) {
  const changedNeighbours = new Set<number>();
  if (facetToRemove.neighbourFacetsIsDirty) facetBuildNeighbour(facetToRemove, fr);
  for (const neighbourIdx of facetToRemove.neighbourFacets!) {
    const neighbour = fr.facets[neighbourIdx];
    if (neighbour != null) {
      changedNeighbours.add(neighbourIdx);
      if (neighbour.neighbourFacetsIsDirty) facetBuildNeighbour(neighbour, fr);
      for (const n of neighbour.neighbourFacets!) changedNeighbours.add(n);
      const newFacet = facetBuildOne(
        neighbourIdx, neighbour.color,
        neighbour.borderPoints[0].x, neighbour.borderPoints[0].y,
        visitedArr, colorIndices, fr.facetMap, fr.width, fr.height,
      );
      fr.facets[neighbourIdx] = newFacet;
      if (newFacet.pointCount === 0) fr.facets[neighbourIdx] = null;
    }
  }
  // Reset visited for affected neighbor areas
  if (facetToRemove.neighbourFacetsIsDirty) facetBuildNeighbour(facetToRemove, fr);
  for (const neighbourIdx of facetToRemove.neighbourFacets!) {
    const neighbour = fr.facets[neighbourIdx];
    if (neighbour != null) {
      for (let y = neighbour.bbox.minY; y <= neighbour.bbox.maxY; y++) {
        for (let x = neighbour.bbox.minX; x <= neighbour.bbox.maxX; x++) {
          if (fr.facetMap[y * fr.width + x] === neighbour.id) visitedArr[y * fr.width + x] = 0;
        }
      }
    }
  }

  // Mark dirty for deferred rebuild
  for (const neighbourIdx of changedNeighbours) {
    const f = fr.facets[neighbourIdx];
    if (f != null) { f.neighbourFacets = null; f.neighbourFacetsIsDirty = true; }
  }
}

function facetRebuildForChange(
  visitedArr: Uint8Array, facet: Facet,
  colorIndices: Int32Array, fr: FacetResult,
) {
  facetRebuildChangedNeighbours(visitedArr, facet, colorIndices, fr);
  // Sanity check: reassign any orphaned pixels
  let needsRebuild = false;
  const { width, height } = fr;
  for (let y = facet.bbox.minY; y <= facet.bbox.maxY; y++) {
    for (let x = facet.bbox.minX; x <= facet.bbox.maxX; x++) {
      const idx = y * width + x;
      if (fr.facetMap[idx] === facet.id) {
        needsRebuild = true;
        if (x - 1 >= 0 && fr.facetMap[idx - 1] !== facet.id && fr.facets[fr.facetMap[idx - 1]] !== null) {
          colorIndices[idx] = fr.facets[fr.facetMap[idx - 1]]!.color;
        } else if (y - 1 >= 0 && fr.facetMap[idx - width] !== facet.id && fr.facets[fr.facetMap[idx - width]] !== null) {
          colorIndices[idx] = fr.facets[fr.facetMap[idx - width]]!.color;
        } else if (x + 1 < width && fr.facetMap[idx + 1] !== facet.id && fr.facets[fr.facetMap[idx + 1]] !== null) {
          colorIndices[idx] = fr.facets[fr.facetMap[idx + 1]]!.color;
        } else if (y + 1 < height && fr.facetMap[idx + width] !== facet.id && fr.facets[fr.facetMap[idx + width]] !== null) {
          colorIndices[idx] = fr.facets[fr.facetMap[idx + width]]!.color;
        }
      }
    }
  }
  if (needsRebuild) facetRebuildChangedNeighbours(visitedArr, facet, colorIndices, fr);
}

function facetDelete(
  facetIdToRemove: number, fr: FacetResult,
  colorIndices: Int32Array, colorDistances: number[][],
  visitedArr: Uint8Array,
) {
  const facetToRemove = fr.facets[facetIdToRemove];
  if (facetToRemove === null) return;
  if (facetToRemove.neighbourFacetsIsDirty) facetBuildNeighbour(facetToRemove, fr);
  if (facetToRemove.neighbourFacets!.length > 0) {
    // Color-similarity relabeling: assign ALL pixels to the most color-similar
    // neighbor. This preserves the boundary shape exactly — the region just
    // adopts a different color rather than having its pixels spatially
    // redistributed (Voronoi), which would erode sharp silhouette edges.
    const bestNeighbour = facetMostSimilarNeighbour(facetToRemove, fr, colorDistances);
    if (bestNeighbour !== -1) {
      const newColor = fr.facets[bestNeighbour]!.color;
      for (let j = facetToRemove.bbox.minY; j <= facetToRemove.bbox.maxY; j++) {
        for (let i = facetToRemove.bbox.minX; i <= facetToRemove.bbox.maxX; i++) {
          const idx = j * fr.width + i;
          if (fr.facetMap[idx] === facetToRemove.id) {
            colorIndices[idx] = newColor;
          }
        }
      }
    }
  }
  facetRebuildForChange(visitedArr, facetToRemove, colorIndices, fr);
  fr.facets[facetToRemove.id] = null;
}

function facetIsHighContrast(facet: Facet, fr: FacetResult, colorDistances: number[][]): boolean {
  if (facet.neighbourFacetsIsDirty) facetBuildNeighbour(facet, fr);
  if (!facet.neighbourFacets || facet.neighbourFacets.length === 0) return false;
  // Check the minimum color distance to any neighbour
  let minDist = Number.MAX_VALUE;
  for (const nIdx of facet.neighbourFacets) {
    const neighbour = fr.facets[nIdx];
    if (neighbour != null) {
      const dist = colorDistances[facet.color][neighbour.color];
      if (dist < minDist) minDist = dist;
    }
  }
  return minDist > FACET_DETAIL_PROTECT_LAB_DISTANCE;
}

function facetReduce(
  smallerThan: number, removeLargeToSmall: boolean, maxFacets: number,
  paletteRgb: Uint8Array, fr: FacetResult, colorIndices: Int32Array,
  protectHighContrast = false, highContrastMinPx = FACET_FORCE_MERGE_BELOW,
) {
  const visitedArr = new Uint8Array(fr.width * fr.height);
  const colorDistances = facetColorDistanceMatrix(paletteRgb);
  const order = fr.facets
    .filter((f): f is Facet => f != null).slice(0)
    .sort((a, b) => b.pointCount - a.pointCount || a.id - b.id)
    .map(f => f.id);
  if (!removeLargeToSmall) order.reverse();
  for (const fId of order) {
    const f = fr.facets[fId];
    if (f != null && f.pointCount < smallerThan) {
      if (protectHighContrast && f.pointCount >= highContrastMinPx && facetIsHighContrast(f, fr, colorDistances)) continue;
      facetDelete(f.id, fr, colorIndices, colorDistances, visitedArr);
    }
  }
  let facetCount = fr.facets.filter(f => f != null).length;
  while (facetCount > maxFacets) {
    const reorder = fr.facets
      .filter((f): f is Facet => f != null)
      .sort((a, b) => a.pointCount - b.pointCount || a.id - b.id);
    if (reorder.length === 0) break;
    facetDelete(reorder[0].id, fr, colorIndices, colorDistances, visitedArr);
    facetCount = fr.facets.filter(f => f != null).length;
  }
}

function applyRegionMergingVoronoi(
  protrusionPrune: ProtrusionPruneResult, cv: any, minRegionSize?: number, protectHighContrast = false, highContrastMinPx?: number,
): RegionMergeResult {
  const threshold = minRegionSize != null && minRegionSize >= 1 ? minRegionSize : FACET_SMALL_THRESHOLD;
  const effectiveMergeArea = threshold;
  const hcFloor = highContrastMinPx != null && highContrastMinPx >= 1 ? highContrastMinPx : FACET_FORCE_MERGE_BELOW;
  const colorIndices = new Int32Array(protrusionPrune.labelMap);
  const fr = facetGetAll(colorIndices, protrusionPrune.width, protrusionPrune.height);
  facetReduce(effectiveMergeArea, FACET_REMOVE_LARGE_TO_SMALL, FACET_MAX_COUNT, protrusionPrune.paletteRgb, fr, colorIndices, protectHighContrast, hcFloor);
  const compacted = compactLabelsByPalette(
    new Int32Array(colorIndices), protrusionPrune.paletteRgb,
    protrusionPrune.width, protrusionPrune.height, cv,
  );

  // Second pass: compaction can create new tiny disconnected fragments.
  // Run CCA + reduce again to clean those up unconditionally.
  const colorIndices2 = new Int32Array(compacted.labelMap);
  const fr2 = facetGetAll(colorIndices2, protrusionPrune.width, protrusionPrune.height);
  facetReduce(effectiveMergeArea, FACET_REMOVE_LARGE_TO_SMALL, FACET_MAX_COUNT, compacted.paletteRgb, fr2, colorIndices2, protectHighContrast, hcFloor);
  const compacted2 = compactLabelsByPalette(
    new Int32Array(colorIndices2), compacted.paletteRgb,
    protrusionPrune.width, protrusionPrune.height, cv,
  );

  return {
    canvas: renderCanvasFromLabelMap(compacted2.labelMap, compacted2.paletteRgb, protrusionPrune.width, protrusionPrune.height),
    width: protrusionPrune.width,
    height: protrusionPrune.height,
    colorCount: compacted2.paletteRgb.length / 3,
    labelMap: compacted2.labelMap,
    paletteRgb: compacted2.paletteRgb,
  };
}

export function applyRegionMerging(
  protrusionPrune: ProtrusionPruneResult,
  cv: any,
  minRegionSize?: number,
  protectHighContrast = false,
  highContrastMinPx?: number,
): RegionMergeResult {
  return applyRegionMergingVoronoi(protrusionPrune, cv, minRegionSize, protectHighContrast, highContrastMinPx);
}

// ══════════════════════════════════════════════════════════════════════════
// Legacy: OpenCV-based region merging (kept for reference / fallback)
// ══════════════════════════════════════════════════════════════════════════

export function applyRegionMergingLegacy(
  protrusionPrune: ProtrusionPruneResult,
  cv: any,
): RegionMergeResult {
  const effectiveMergeArea = Math.max(
    PYTHON_DEFAULT_MIN_LABEL_AREA,
    Math.round(protrusionPrune.width * protrusionPrune.height * MIN_LABEL_AREA_RATIO),
  );
  const merged = mergeSmallRegions(
    protrusionPrune.labelMap,
    protrusionPrune.paletteRgb,
    protrusionPrune.width,
    protrusionPrune.height,
    effectiveMergeArea,
    cv,
  );

  return {
    canvas: renderCanvasFromLabelMap(merged.labelMap, merged.paletteRgb, protrusionPrune.width, protrusionPrune.height),
    width: protrusionPrune.width,
    height: protrusionPrune.height,
    colorCount: merged.paletteRgb.length / 3,
    labelMap: merged.labelMap,
    paletteRgb: merged.paletteRgb,
  };
}

export type TemplateSet = {
  brightColorCircles: OffscreenCanvas;
  colorCircles: OffscreenCanvas;
  circlesOnly: OffscreenCanvas;
  numbers: OffscreenCanvas;
  classic: OffscreenCanvas;
  debugUnlabeled: OffscreenCanvas;
  colorCount: number;
  placementCount: number;
  regionCount: number;
};

export function applyAllTemplateRenders(
  regionMerge: RegionMergeResult,
  cv: any,
): TemplateSet {
  // Every region that survived merging should get a label.
  // Survivors are either ≥ minRegionSize, or ≥ FACET_FORCE_MERGE_BELOW (20px) AND high-contrast.
  // Use the force-merge floor so the smaller high-contrast survivors also get labels.
  const effectiveMinLabelArea = FACET_FORCE_MERGE_BELOW;

  const fr = facetGetAll(regionMerge.labelMap, regionMerge.width, regionMerge.height);
  const regions: RegionInfo[] = [];
  for (const f of fr.facets) {
    if (f != null) {
      regions.push({
        regionId: f.id,
        colorIndex: f.color,
        area: f.pointCount,
        bbox: [f.bbox.minX, f.bbox.minY, f.bbox.maxX + 1, f.bbox.maxY + 1],
      });
    }
  }
  const placements = precomputeLabelPlacementsFast(fr, regions, effectiveMinLabelArea);
  const normalizedPaletteRgb = normalizePaintPalette(regionMerge.paletteRgb);
  const outlines = buildBoundaryMask(regionMerge.labelMap, regionMerge.width, regionMerge.height);
  const { width, height, labelMap } = regionMerge;

  // Build a color-index-to-label-number map (1-based, sorted by palette order)
  const usedColors = new Set<number>();
  for (const r of regions) usedColors.add(r.colorIndex);
  const sortedColors = [...usedColors].sort((a, b) => a - b);
  const colorToNumber = new Map<number, number>();
  sortedColors.forEach((c, i) => colorToNumber.set(c, i + 1));

  return {
    brightColorCircles: renderBrightColorCirclesTemplate(labelMap, regions, placements, normalizedPaletteRgb, outlines, width, height),
    colorCircles:       renderColorCirclesTemplate(labelMap, regions, placements, normalizedPaletteRgb, outlines, width, height, colorToNumber),
    circlesOnly:        renderCirclesOnlyTemplate(labelMap, regions, placements, normalizedPaletteRgb, outlines, width, height),
    numbers:            renderNumbersTemplate(labelMap, regions, placements, outlines, width, height, colorToNumber),
    classic:            renderClassicTemplate(labelMap, regions, placements, normalizedPaletteRgb, outlines, width, height, colorToNumber),
    debugUnlabeled:     renderDebugUnlabeledTemplate(fr.facetMap, regions, placements, normalizedPaletteRgb, outlines, width, height),
    colorCount: normalizedPaletteRgb.length / 3,
    placementCount: placements.size,
    regionCount: regions.length,
  };
}

// Keep old export as wrapper for backward compat
export function applyBrightColorCirclesRender(
  regionMerge: RegionMergeResult,
  cv: any,
): { canvas: OffscreenCanvas; colorCount: number; placementCount: number } {
  const t = applyAllTemplateRenders(regionMerge, cv);
  return { canvas: t.brightColorCircles, colorCount: t.colorCount, placementCount: t.placementCount };
}

// Fast label placement: find the border point furthest from the bbox edge (approximate pole of inaccessibility)
function precomputeLabelPlacementsFast(
  fr: FacetResult, regions: RegionInfo[], minLabelArea: number,
): Map<number, LabelPlacement> {
  const placements = new Map<number, LabelPlacement>();
  for (const region of regions) {
    if (region.area < minLabelArea) continue;
    const facet = fr.facets[region.regionId];
    if (!facet || facet.borderPoints.length === 0) continue;

    // Build a mini distance field inside the facet's bbox using chamfer distance
    const [bx1, by1, bx2, by2] = region.bbox;
    const bw = bx2 - bx1;
    const bh = by2 - by1;
    if (bw <= 0 || bh <= 0) continue;

    // Create mask: 0 = not this facet, 1 = this facet
    const mask = new Uint8Array(bw * bh);
    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        if (fr.facetMap[(by1 + ly) * fr.width + bx1 + lx] === facet.id) {
          mask[ly * bw + lx] = 1;
        }
      }
    }

    // Chamfer distance transform (two-pass 3-4 approximation)
    const dist = new Float32Array(bw * bh);
    const INF = bw + bh;
    // Init: inside=INF, outside=0
    for (let i = 0; i < mask.length; i++) dist[i] = mask[i] ? INF : 0;
    // Treat image-edge pixels as boundary so labels aren't placed at corners
    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const gx = bx1 + lx, gy = by1 + ly;
        if (gx === 0 || gy === 0 || gx === fr.width - 1 || gy === fr.height - 1) {
          dist[ly * bw + lx] = 0;
        }
      }
    }
    // Forward pass
    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const i = ly * bw + lx;
        if (dist[i] === 0) continue;
        if (ly > 0) dist[i] = Math.min(dist[i], dist[(ly - 1) * bw + lx] + 1);
        if (lx > 0) dist[i] = Math.min(dist[i], dist[ly * bw + lx - 1] + 1);
        if (ly > 0 && lx > 0) dist[i] = Math.min(dist[i], dist[(ly - 1) * bw + lx - 1] + 1.414);
        if (ly > 0 && lx + 1 < bw) dist[i] = Math.min(dist[i], dist[(ly - 1) * bw + lx + 1] + 1.414);
      }
    }
    // Backward pass
    for (let ly = bh - 1; ly >= 0; ly--) {
      for (let lx = bw - 1; lx >= 0; lx--) {
        const i = ly * bw + lx;
        if (dist[i] === 0) continue;
        if (ly + 1 < bh) dist[i] = Math.min(dist[i], dist[(ly + 1) * bw + lx] + 1);
        if (lx + 1 < bw) dist[i] = Math.min(dist[i], dist[ly * bw + lx + 1] + 1);
        if (ly + 1 < bh && lx + 1 < bw) dist[i] = Math.min(dist[i], dist[(ly + 1) * bw + lx + 1] + 1.414);
        if (ly + 1 < bh && lx > 0) dist[i] = Math.min(dist[i], dist[(ly + 1) * bw + lx - 1] + 1.414);
      }
    }

    // Find max distance point
    let maxDist = 0, bestX = 0, bestY = 0;
    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const d = dist[ly * bw + lx];
        if (d > maxDist) { maxDist = d; bestX = lx; bestY = ly; }
      }
    }

    placements.set(region.regionId, {
      regionId: region.regionId,
      x: clampInteger(bx1 + bestX, 0, fr.width - 1),
      y: clampInteger(by1 + bestY, 0, fr.height - 1),
      radius: maxDist,
    });
  }
  return placements;
}

function pruneThinProtrusions(
  labelMap: Int32Array, width: number, height: number,
  colorCount: number, paletteRgb: Uint8Array, _cv: any, kernelRadius?: number,
): Int32Array {
  const pruned = new Int32Array(labelMap);
  const radius = Math.max(1, kernelRadius ?? THIN_PROTRUSION_KERNEL_RADIUS);
  // Features with min cross-section span < minWidth get cleaned.
  // radius=1 → clean 1px strips, radius=2 → clean 1-2px strips.
  const minWidth = radius + 1;

  const paletteLab = rgbPaletteToLab(paletteRgb);
  const contrastThresholdSq = FACET_DETAIL_PROTECT_LAB_DISTANCE * FACET_DETAIL_PROTECT_LAB_DISTANCE;

  // 4 line directions to measure cross-section: horizontal, vertical, 2 diagonals
  const dirs: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]];

  for (let pass = 0; pass < THIN_PROTRUSION_MAX_FILL_STEPS; pass++) {
    let changed = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const label = pruned[idx];

        // Measure minimum span across 4 directions through this pixel
        let isThin = false;
        for (const [ddx, ddy] of dirs) {
          let neg = 0;
          for (let s = 1; s < minWidth; s++) {
            const nx = x - ddx * s, ny = y - ddy * s;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) break;
            if (pruned[ny * width + nx] !== label) break;
            neg++;
          }
          let pos = 0;
          for (let s = 1; s < minWidth; s++) {
            const nx = x + ddx * s, ny = y + ddy * s;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) break;
            if (pruned[ny * width + nx] !== label) break;
            pos++;
          }
          if (neg + 1 + pos < minWidth) { isThin = true; break; }
        }
        if (!isThin) continue;

        // Thin pixel — find the most color-similar different-label neighbor (8-connected)
        let bestLabel = -1;
        let bestDist = Infinity;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const nLabel = pruned[ny * width + nx];
            if (nLabel === label) continue;
            const lOff = label * 3, nOff = nLabel * 3;
            const dL = paletteLab[lOff] - paletteLab[nOff];
            const da = paletteLab[lOff + 1] - paletteLab[nOff + 1];
            const db = paletteLab[lOff + 2] - paletteLab[nOff + 2];
            const d = dL * dL + da * da + db * db;
            if (d < bestDist) { bestDist = d; bestLabel = nLabel; }
          }
        }

        // Only reassign if a similar-color neighbor exists (protects high-contrast detail)
        if (bestLabel >= 0 && bestDist < contrastThresholdSq) {
          pruned[idx] = bestLabel;
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  return pruned;
}

function precomputeLabelPlacements(
  regionMap: Int32Array,
  regions: RegionInfo[],
  minLabelArea: number,
  width: number,
  height: number,
  cv: any,
): Map<number, LabelPlacement> {
  const placements = new Map<number, LabelPlacement>();
  for (const region of regions) {
    if (region.area < minLabelArea) {
      continue;
    }
    const placement = regionLabelPointForBBox(regionMap, region.regionId, region.bbox, width, height, cv);
    placements.set(region.regionId, {
      regionId: region.regionId,
      x: placement.x,
      y: placement.y,
      radius: placement.radius,
    });
  }
  return placements;
}

function regionLabelPointForBBox(
  regionMap: Int32Array,
  regionId: number,
  bbox: [number, number, number, number],
  width: number,
  height: number,
  cv: any,
): { x: number; y: number; radius: number } {
  const [x1, y1, x2, y2] = bbox;
  const boxWidth = Math.max(0, x2 - x1);
  const boxHeight = Math.max(0, y2 - y1);
  const mask = new Uint8Array(boxWidth * boxHeight);
  let hasAny = false;

  for (let localY = 0; localY < boxHeight; localY += 1) {
    for (let localX = 0; localX < boxWidth; localX += 1) {
      const globalIndex = (y1 + localY) * width + x1 + localX;
      const maskIndex = localY * boxWidth + localX;
      if (regionMap[globalIndex] === regionId) {
        mask[maskIndex] = 1;
        hasAny = true;
      }
    }
  }

  if (!hasAny || boxWidth === 0 || boxHeight === 0) {
    return { x: x1, y: y1, radius: 0 };
  }

  const maskMat = cv.matFromArray(boxHeight, boxWidth, cv.CV_8UC1, mask);
  const paddedMat = new cv.Mat();
  const distanceMat = new cv.Mat();
  try {
    cv.copyMakeBorder(maskMat, paddedMat, 1, 1, 1, 1, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
    cv.distanceTransform(paddedMat, distanceMat, cv.DIST_L2, 5);
    const distancePeak = cv.minMaxLoc(distanceMat);
    const maxLocation = distancePeak.maxLoc;
    return {
      x: clampInteger(x1 + Math.trunc(maxLocation.x) - 1, 0, width - 1),
      y: clampInteger(y1 + Math.trunc(maxLocation.y) - 1, 0, height - 1),
      radius: distancePeak.maxVal,
    };
  } finally {
    maskMat.delete();
    paddedMat.delete();
    distanceMat.delete();
  }
}

function collectPresentLabels(labelMap: Int32Array, colorCount: number): number[] {
  const counts = labelPixelCounts(labelMap, colorCount);
  const labels: number[] = [];
  for (let label = 0; label < counts.length; label += 1) {
    if (counts[label] > 0) {
      labels.push(label);
    }
  }
  return labels;
}

function hasAnyPositive(values: Uint8Array): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== 0) {
      return true;
    }
  }
  return false;
}

function buildNeighborMap(
  labelMap: Int32Array,
  width: number,
  height: number,
  dy: number,
  dx: number,
): Int32Array {
  const neighbor = new Int32Array(labelMap.length).fill(-1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x + dx;
      const sourceY = y + dy;
      if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) {
        continue;
      }
      neighbor[y * width + x] = labelMap[sourceY * width + sourceX];
    }
  }
  return neighbor;
}

function buildBoundaryMask(regionMap: Int32Array, width: number, height: number): Uint8Array {
  const boundary = new Uint8Array(regionMap.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const cur = regionMap[idx];
      // Mark pixel if it differs from right or bottom neighbor (1px-thin boundary)
      if (x + 1 < width && cur !== regionMap[idx + 1]) { boundary[idx] = 1; continue; }
      if (y + 1 < height && cur !== regionMap[idx + width]) { boundary[idx] = 1; }
    }
  }

  return boundary;
}

function mergeSmallRegions(
  labelMap: Int32Array,
  paletteRgb: Uint8Array,
  width: number,
  height: number,
  minRegionArea: number,
  cv: any,
): { labelMap: Int32Array; paletteRgb: Uint8Array } {
  if (minRegionArea <= 1) {
    return compactLabelsByPalette(labelMap, paletteRgb, width, height, cv);
  }

  let merged: Int32Array<ArrayBufferLike> = new Int32Array(labelMap);
  for (let pass = 0; pass < SMALL_REGION_MAX_PASSES; pass += 1) {
    let changed = false;
    const connected = connectedRegions(merged, paletteRgb.length / 3, width, height, cv);
    const adjacency = buildRegionAdjacency(connected.regionMap, width, height);
    const candidateIds = collectMergeCandidateRegionIds(connected.regions, minRegionArea);
    if (candidateIds.length > 0) {
      const mergeTargets = planRegionMerges(candidateIds, connected.regions, adjacency, paletteRgb, cv);
      if (mergeTargets.size > 0) {
        merged = applyRegionMerges(connected.regionMap, connected.regions, mergeTargets, width, height);
        changed = true;
      }
    }

    const stripResult = cleanupNarrowPixelStripsDetailed(merged, paletteRgb, width, height, cv, NARROW_STRIP_CLEANUP_RUNS);
    merged = stripResult.labelMap;
    changed = changed || stripResult.changed;
    if (!changed) {
      break;
    }
  }

  return compactLabelsByPalette(merged, paletteRgb, width, height, cv);
}

function connectedRegions(
  labelMap: Int32Array,
  colorCount: number,
  width: number,
  height: number,
  cv: any,
): { regionMap: Int32Array; regions: RegionInfo[] } {
  const regionMap = new Int32Array(labelMap.length).fill(-1);
  const regions: RegionInfo[] = [];
  let nextId = 0;

  for (const colorIndex of collectPresentLabels(labelMap, colorCount)) {
    const mask = new Uint8Array(labelMap.length);
    let hasAny = false;
    for (let index = 0; index < labelMap.length; index += 1) {
      if (labelMap[index] === colorIndex) {
        mask[index] = 1;
        hasAny = true;
      }
    }
    if (!hasAny) {
      continue;
    }

    const maskMat = cv.matFromArray(height, width, cv.CV_8UC1, mask);
    const componentsMat = new cv.Mat();
    const statsMat = new cv.Mat();
    const centroidsMat = new cv.Mat();
    try {
      const numLabels = cv.connectedComponentsWithStats(maskMat, componentsMat, statsMat, centroidsMat, 8, cv.CV_32S);
      for (let componentId = 1; componentId < numLabels; componentId += 1) {
        const statsOffset = componentId * statsMat.cols;
        const area = statsMat.data32S[statsOffset + cv.CC_STAT_AREA];
        if (area <= 0) {
          continue;
        }

        for (let index = 0; index < labelMap.length; index += 1) {
          if (componentsMat.data32S[index] === componentId) {
            regionMap[index] = nextId;
          }
        }

        const x = statsMat.data32S[statsOffset + cv.CC_STAT_LEFT];
        const y = statsMat.data32S[statsOffset + cv.CC_STAT_TOP];
        const w = statsMat.data32S[statsOffset + cv.CC_STAT_WIDTH];
        const h = statsMat.data32S[statsOffset + cv.CC_STAT_HEIGHT];
        regions.push({
          regionId: nextId,
          colorIndex,
          area,
          bbox: [x, y, x + w, y + h],
        });
        nextId += 1;
      }
    } finally {
      maskMat.delete();
      componentsMat.delete();
      statsMat.delete();
      centroidsMat.delete();
    }
  }

  return { regionMap, regions };
}

function buildRegionAdjacency(regionMap: Int32Array, width: number, height: number): Map<number, Map<number, number>> {
  const adjacency = new Map<number, Map<number, number>>();
  if (regionMap.length === 0 || width <= 0 || height <= 0) {
    return adjacency;
  }

  const addPairs = (left: number, right: number) => {
    if (left < 0 || right < 0 || left === right) {
      return;
    }
    const a = Math.min(left, right);
    const b = Math.max(left, right);
    const leftMap = adjacency.get(a) ?? new Map<number, number>();
    leftMap.set(b, (leftMap.get(b) ?? 0) + 1);
    adjacency.set(a, leftMap);
    const rightMap = adjacency.get(b) ?? new Map<number, number>();
    rightMap.set(a, (rightMap.get(a) ?? 0) + 1);
    adjacency.set(b, rightMap);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x + 1 < width) {
        addPairs(regionMap[index], regionMap[index + 1]);
      }
      if (y + 1 < height) {
        addPairs(regionMap[index], regionMap[index + width]);
      }
    }
  }
  return adjacency;
}

function collectMergeCandidateRegionIds(regions: RegionInfo[], minRegionArea: number): number[] {
  const candidateIds: number[] = [];
  const thinRegionAreaLimit = minRegionArea * THIN_REGION_MAX_AREA_MULTIPLIER;
  for (const region of regions) {
    if (region.area < minRegionArea) {
      candidateIds.push(region.regionId);
      continue;
    }
    if (region.area <= thinRegionAreaLimit && regionAverageThickness(region) <= THIN_REGION_MAX_AVERAGE_THICKNESS) {
      candidateIds.push(region.regionId);
    }
  }
  return candidateIds;
}

function regionAverageThickness(region: RegionInfo): number {
  const [x1, y1, x2, y2] = region.bbox;
  const width = Math.max(1, x2 - x1);
  const height = Math.max(1, y2 - y1);
  return region.area / Math.max(width, height);
}

function planRegionMerges(
  candidateIds: number[],
  regions: RegionInfo[],
  adjacency: Map<number, Map<number, number>>,
  paletteRgb: Uint8Array,
  cv: any,
): Map<number, number> {
  const paletteLab = convertPaletteRgb(paletteRgb, cv.COLOR_RGB2Lab, cv);
  const candidateSet = new Set(candidateIds);
  const regionsById = buildRegionsById(regions);
  const mergeTargets = new Map<number, number>();
  const sortedCandidateIds = [...candidateSet].sort((left, right) => {
    const leftRegion = regionsById.get(left)!;
    const rightRegion = regionsById.get(right)!;
    return leftRegion.area - rightRegion.area || left - right;
  });

  for (const regionId of sortedCandidateIds) {
    const targetRegionId = chooseRegionMergeTarget(regionId, regionsById, adjacency, candidateSet, paletteLab);
    if (targetRegionId !== null) {
      mergeTargets.set(regionId, targetRegionId);
    }
  }

  return mergeTargets;
}

function chooseRegionMergeTarget(
  sourceRegionId: number,
  regionsById: Map<number, RegionInfo>,
  adjacency: Map<number, Map<number, number>>,
  candidateSet: Set<number>,
  paletteLab: Uint8Array,
): number | null {
  const sourceRegion = regionsById.get(sourceRegionId);
  if (!sourceRegion) {
    return null;
  }

  const options: Array<[number, number, number, number, number, number]> = [];
  for (const [neighborRegionId, borderCount] of adjacency.get(sourceRegionId) ?? []) {
    const neighborRegion = regionsById.get(neighborRegionId);
    if (!neighborRegion) {
      continue;
    }

    const isCandidateNeighbor = candidateSet.has(neighborRegionId);
    if (
      isCandidateNeighbor &&
      (neighborRegion.area < sourceRegion.area || (neighborRegion.area === sourceRegion.area && neighborRegion.regionId <= sourceRegion.regionId))
    ) {
      continue;
    }

    const largerNeighbor = neighborRegion.area > sourceRegion.area;
    const colorDistance = Math.sqrt(paletteColorDistanceSquared(paletteLab, neighborRegion.colorIndex, sourceRegion.colorIndex));
    if (colorDistance > HARD_EDGE_PROTECTION_LAB_DISTANCE && sourceRegion.area > TINY_HARD_EDGE_MERGE_MAX_AREA) {
      continue;
    }

    options.push([
      isCandidateNeighbor ? 1 : 0,
      largerNeighbor ? 0 : 1,
      -borderCount,
      -neighborRegion.area,
      colorDistance,
      neighborRegionId,
    ]);
  }

  if (options.length === 0) {
    return null;
  }

  options.sort(compareTupleOptions);
  return options[0][5];
}

function compareTupleOptions(
  left: [number, number, number, number, number, number],
  right: [number, number, number, number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return 0;
}

function buildRegionsById(regions: RegionInfo[]): Map<number, RegionInfo> {
  const regionsById = new Map<number, RegionInfo>();
  for (const region of regions) {
    regionsById.set(region.regionId, region);
  }
  return regionsById;
}

function applyRegionMerges(
  regionMap: Int32Array,
  regions: RegionInfo[],
  mergeTargets: Map<number, number>,
  width: number,
  height: number,
): Int32Array {
  const resolvedCache = new Map<number, number>();
  const regionsById = buildRegionsById(regions);

  const resolveTarget = (regionId: number): number => {
    let current = regionId;
    const visited: number[] = [];
    while (mergeTargets.has(current)) {
      if (resolvedCache.has(current)) {
        current = resolvedCache.get(current)!;
        break;
      }
      if (visited.includes(current)) {
        break;
      }
      visited.push(current);
      current = mergeTargets.get(current)!;
    }
    for (const item of visited) {
      resolvedCache.set(item, current);
    }
    return current;
  };

  const maxRegionId = Math.max(-1, ...regions.map((region) => region.regionId));
  const regionToLabel = new Int32Array(maxRegionId + 1).fill(-1);
  for (const region of regions) {
    regionToLabel[region.regionId] = region.colorIndex;
  }

  for (const sourceRegionId of [...mergeTargets.keys()].sort((left, right) => left - right)) {
    const targetRegionId = resolveTarget(mergeTargets.get(sourceRegionId)!);
    const targetRegion = regionsById.get(targetRegionId);
    if (!targetRegion) {
      continue;
    }
    regionToLabel[sourceRegionId] = targetRegion.colorIndex;
  }

  const merged = new Int32Array(width * height).fill(-1);
  for (let index = 0; index < regionMap.length; index += 1) {
    const regionId = regionMap[index];
    if (regionId >= 0) {
      merged[index] = regionToLabel[regionId];
    }
  }
  return merged;
}

function cleanupNarrowPixelStrips(
  labelMap: Int32Array,
  paletteRgb: Uint8Array,
  width: number,
  height: number,
  cv: any,
  runs: number,
): Int32Array {
  return cleanupNarrowPixelStripsDetailed(labelMap, paletteRgb, width, height, cv, runs).labelMap;
}

function cleanupNarrowPixelStripsDetailed(
  labelMap: Int32Array,
  paletteRgb: Uint8Array,
  width: number,
  height: number,
  cv: any,
  runs: number,
): { labelMap: Int32Array; changed: boolean } {
  if (width < 3 || height < 3) {
    return { labelMap: new Int32Array(labelMap), changed: false };
  }

  let cleaned = new Int32Array(labelMap);
  let changedAnyOverall = false;
  const paletteLab = convertPaletteRgb(paletteRgb, cv.COLOR_RGB2Lab, cv);
  const maxDistanceSquared = HARD_EDGE_PROTECTION_LAB_DISTANCE * HARD_EDGE_PROTECTION_LAB_DISTANCE;

  for (let run = 0; run < Math.max(1, Math.trunc(runs)); run += 1) {
    const counts = labelPixelCounts(cleaned, paletteRgb.length / 3);
    const next = new Int32Array(cleaned);
    let changedAny = false;

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const center = cleaned[index];
        if (center < 0) {
          continue;
        }

        const left = cleaned[index - 1];
        const right = cleaned[index + 1];
        const up = cleaned[index - width];
        const down = cleaned[index + width];
        const upLeft = cleaned[index - width - 1];
        const upRight = cleaned[index - width + 1];
        const downLeft = cleaned[index + width - 1];
        const downRight = cleaned[index + width + 1];

        let replacement = center;
        let replacementStrength = 0;

        const promote = (target: number, enabled: boolean) => {
          if (!enabled || target < 0) {
            return;
          }
          const colorDistanceSquared = paletteColorDistanceSquared(paletteLab, center, target);
          if (colorDistanceSquared > maxDistanceSquared) {
            return;
          }
          const targetStrength = counts[target] ?? 0;
          if (targetStrength > replacementStrength) {
            replacement = target;
            replacementStrength = targetStrength;
          }
        };

        promote(left, left === right && left !== center);
        promote(up, up === down && up !== center);
        promote(upLeft, upLeft === downRight && upLeft !== center);
        promote(upRight, upRight === downLeft && upRight !== center);
        promote(left, left === up && left === down && left !== center);
        promote(right, right === up && right === down && right !== center);
        promote(up, up === left && up === right && up !== center);
        promote(down, down === left && down === right && down !== center);

        if (replacement !== center) {
          next[index] = replacement;
          changedAny = true;
        }
      }
    }

    if (!changedAny) {
      break;
    }

    cleaned = next;
    changedAnyOverall = true;
  }

  return { labelMap: cleaned, changed: changedAnyOverall };
}

function compactLabelsByPalette(
  labelMap: Int32Array,
  paletteRgb: Uint8Array,
  width: number,
  height: number,
  cv: any,
): { labelMap: Int32Array; paletteRgb: Uint8Array } {
  const counts = labelPixelCounts(labelMap, paletteRgb.length / 3);
  const presentLabels: number[] = [];
  for (let label = 0; label < counts.length; label += 1) {
    if (counts[label] > 0) {
      presentLabels.push(label);
    }
  }

  if (presentLabels.length === 0) {
    return {
      labelMap: new Int32Array(width * height),
      paletteRgb: new Uint8Array([255, 255, 255]),
    };
  }

  const paletteHsv = convertPaletteRgb(paletteRgb, cv.COLOR_RGB2HSV, cv);
  const entries = presentLabels.map((label) => ({
    oldLabel: label,
    count: counts[label],
    hsvOffset: label * 3,
  }));

  entries.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    for (let channel = 0; channel < 3; channel += 1) {
      const delta = paletteHsv[left.hsvOffset + channel] - paletteHsv[right.hsvOffset + channel];
      if (delta !== 0) {
        return delta;
      }
    }

    return left.oldLabel - right.oldLabel;
  });

  const remap = new Int32Array(paletteRgb.length / 3).fill(-1);
  const compactPalette = new Uint8Array(entries.length * 3);
  for (let newLabel = 0; newLabel < entries.length; newLabel += 1) {
    const oldLabel = entries[newLabel].oldLabel;
    remap[oldLabel] = newLabel;
    const oldOffset = oldLabel * 3;
    const newOffset = newLabel * 3;
    compactPalette[newOffset] = paletteRgb[oldOffset];
    compactPalette[newOffset + 1] = paletteRgb[oldOffset + 1];
    compactPalette[newOffset + 2] = paletteRgb[oldOffset + 2];
  }

  const compacted = new Int32Array(labelMap.length);
  for (let index = 0; index < labelMap.length; index += 1) {
    const label = labelMap[index];
    compacted[index] = label >= 0 ? remap[label] : -1;
  }

  return { labelMap: compacted, paletteRgb: compactPalette };
}

function convertPaletteRgb(
  paletteRgb: Uint8Array,
  conversionCode: number,
  cv: any,
): Uint8Array {
  if (paletteRgb.length === 0) {
    return new Uint8Array(0);
  }

  const colorCount = paletteRgb.length / 3;
  const paletteMat = cv.matFromArray(1, colorCount, cv.CV_8UC3, paletteRgb);
  const convertedMat = new cv.Mat();
  try {
    cv.cvtColor(paletteMat, convertedMat, conversionCode);
    return new Uint8Array(convertedMat.data);
  } finally {
    paletteMat.delete();
    convertedMat.delete();
  }
}

function labelPixelCounts(labelMap: Int32Array, colorCount: number): Int32Array {
  const counts = new Int32Array(colorCount);
  for (let index = 0; index < labelMap.length; index += 1) {
    const label = labelMap[index];
    if (label >= 0 && label < colorCount) {
      counts[label] += 1;
    }
  }
  return counts;
}

function paletteColorDistanceSquared(paletteLab: Uint8Array, leftLabel: number, rightLabel: number): number {
  const leftOffset = leftLabel * 3;
  const rightOffset = rightLabel * 3;
  const delta0 = paletteLab[leftOffset] - paletteLab[rightOffset];
  const delta1 = paletteLab[leftOffset + 1] - paletteLab[rightOffset + 1];
  const delta2 = paletteLab[leftOffset + 2] - paletteLab[rightOffset + 2];
  return delta0 * delta0 + delta1 * delta1 + delta2 * delta2;
}

export function renderCanvasFromLabelMap(
  labelMap: Int32Array,
  paletteRgb: Uint8Array,
  width: number,
  height: number,
): OffscreenCanvas {
  const outputPixels = new Uint8ClampedArray(width * height * 4);
  const maxLabel = Math.max(0, paletteRgb.length / 3 - 1);
  for (let pixelIndex = 0; pixelIndex < labelMap.length; pixelIndex += 1) {
    const label = labelMap[pixelIndex];
    const outputOffset = pixelIndex * 4;
    const paletteOffset = Math.min(maxLabel, Math.max(0, label)) * 3;
    outputPixels[outputOffset] = paletteRgb[paletteOffset];
    outputPixels[outputOffset + 1] = paletteRgb[paletteOffset + 1];
    outputPixels[outputOffset + 2] = paletteRgb[paletteOffset + 2];
    outputPixels[outputOffset + 3] = 255;
  }

  const outputCanvas = new OffscreenCanvas(width, height);

  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) {
    throw new Error("Canvas 2D is not available in this browser.");
  }

  outputContext.putImageData(new ImageData(outputPixels, width, height), 0, 0);
  return outputCanvas;
}

/** Debug template: regions with a label shown normally, unlabeled (too-small) regions filled solid red. */
function renderDebugUnlabeledTemplate(
  facetMap: Uint32Array | Int32Array,
  regions: RegionInfo[],
  placements: Map<number, LabelPlacement>,
  paletteRgb: Uint8Array,
  outlines: Uint8Array,
  width: number,
  height: number,
): OffscreenCanvas {
  // Build set of region IDs that have no placement
  const unlabeledRegionIds = new Set<number>();
  for (const r of regions) {
    if (!placements.has(r.regionId)) unlabeledRegionIds.add(r.regionId);
  }

  // Build facetId → colorIndex lookup
  const facetColor = new Map<number, number>();
  for (const r of regions) facetColor.set(r.regionId, r.colorIndex);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(width, height);
  const px = imgData.data;

  for (let i = 0; i < width * height; i++) {
    const facetId = facetMap[i];
    const o = i * 4;
    if (outlines[i]) {
      px[o] = 0; px[o + 1] = 0; px[o + 2] = 0; px[o + 3] = 255;
    } else if (unlabeledRegionIds.has(facetId)) {
      px[o] = 255; px[o + 1] = 0; px[o + 2] = 0; px[o + 3] = 255;
    } else {
      const colorIdx = facetColor.get(facetId) ?? 0;
      const co = colorIdx * 3;
      px[o] = paletteRgb[co]; px[o + 1] = paletteRgb[co + 1]; px[o + 2] = paletteRgb[co + 2]; px[o + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function renderBrightColorCirclesTemplate(
  labelMap: Int32Array,
  regions: RegionInfo[],
  placements: Map<number, LabelPlacement>,
  paletteRgb: Uint8Array,
  outlines: Uint8Array,
  width: number,
  height: number,
): OffscreenCanvas {
  const brightPaletteRgb = brightenPaletteForTemplate(paletteRgb);
  const canvas = renderCanvasFromLabelMapWithFallback(labelMap, brightPaletteRgb, TEMPLATE_BG_RGB, width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is not available in this browser.");
  }

  const outputImageData = context.getImageData(0, 0, width, height);
  const outputPixels = outputImageData.data;
  for (let index = 0; index < width * height; index += 1) {
    if (outlines[index] === 0) {
      continue;
    }
    const offset = index * 4;
    outputPixels[offset] = OUTLINE_RGB[0];
    outputPixels[offset + 1] = OUTLINE_RGB[1];
    outputPixels[offset + 2] = OUTLINE_RGB[2];
  }
  context.putImageData(outputImageData, 0, 0);

  for (const region of [...regions].sort((left, right) => right.area - left.area || left.regionId - right.regionId)) {
    const placement = placements.get(region.regionId);
    if (!placement) {
      continue;
    }

    const circleRadius = Math.min(
      fixedCircleMarkerRadius(width, height),
      Math.max(1, Math.floor(placement.radius * 0.75)),
    );
    const [centerX, centerY, safeRadius] = clampCircleToCanvas(
      placement.x,
      placement.y,
      circleRadius,
      width,
      height,
    );
    const paletteOffset = region.colorIndex * 3;
    context.beginPath();
    context.arc(centerX, centerY, safeRadius, 0, Math.PI * 2);
    context.fillStyle = `rgb(${paletteRgb[paletteOffset]}, ${paletteRgb[paletteOffset + 1]}, ${paletteRgb[paletteOffset + 2]})`;
    context.fill();
  }

  return canvas;
}

// Helper: apply outline pixels to an existing canvas's ImageData
function applyOutlines(context: OffscreenCanvasRenderingContext2D, outlines: Uint8Array, width: number, height: number) {
  const imgData = context.getImageData(0, 0, width, height);
  const px = imgData.data;
  for (let i = 0; i < width * height; i++) {
    if (outlines[i]) {
      const o = i * 4;
      px[o] = OUTLINE_RGB[0]; px[o + 1] = OUTLINE_RGB[1]; px[o + 2] = OUTLINE_RGB[2];
    }
  }
  context.putImageData(imgData, 0, 0);
}

// Helper: pick text color (dark or light) based on fill luminance
function labelTextColor(fillR: number, fillG: number, fillB: number): string {
  const lum = 0.2126 * fillR + 0.7152 * fillG + 0.0722 * fillB;
  return lum > 140 ? '#222' : '#fff';
}

// Helper: draw number labels with adaptive text color
function drawNumberLabels(
  context: OffscreenCanvasRenderingContext2D,
  regions: RegionInfo[],
  placements: Map<number, LabelPlacement>,
  colorToNumber: Map<number, number>,
  width: number,
  height: number,
  getFillColor?: (colorIndex: number) => [number, number, number],
) {
  const fontSize = Math.max(8, Math.round(Math.max(width, height) / 120));
  context.font = `bold ${fontSize}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  for (const region of [...regions].sort((a, b) => b.area - a.area || a.regionId - b.regionId)) {
    const placement = placements.get(region.regionId);
    if (!placement) continue;
    const num = colorToNumber.get(region.colorIndex) ?? region.colorIndex + 1;
    const text = String(num);
    const [cx, cy] = clampCircleToCanvas(placement.x, placement.y, 0, width, height);
    if (getFillColor) {
      const [fr, fg, fb] = getFillColor(region.colorIndex);
      context.fillStyle = labelTextColor(fr, fg, fb);
    } else {
      context.fillStyle = '#333';
    }
    context.fillText(text, cx, cy);
  }
}

/**
 * Numbers template: white fill + outlines + number labels
 */
function renderNumbersTemplate(
  labelMap: Int32Array, regions: RegionInfo[],
  placements: Map<number, LabelPlacement>,
  outlines: Uint8Array, width: number, height: number,
  colorToNumber: Map<number, number>,
): OffscreenCanvas {
  const whitePalette = new Uint8Array(((new Set(regions.map(r => r.colorIndex))).size + 1) * 3).fill(255);
  const canvas = renderCanvasFromLabelMapWithFallback(labelMap, whitePalette, TEMPLATE_BG_RGB, width, height);
  const ctx = canvas.getContext('2d')!;
  applyOutlines(ctx, outlines, width, height);
  drawNumberLabels(ctx, regions, placements, colorToNumber, width, height);
  return canvas;
}

/**
 * Color Circles template: white fill + outlines + color circle with number inside
 */
function renderColorCirclesTemplate(
  labelMap: Int32Array, regions: RegionInfo[],
  placements: Map<number, LabelPlacement>,
  paletteRgb: Uint8Array, outlines: Uint8Array,
  width: number, height: number,
  colorToNumber: Map<number, number>,
): OffscreenCanvas {
  const whitePalette = new Uint8Array(paletteRgb.length).fill(255);
  const canvas = renderCanvasFromLabelMapWithFallback(labelMap, whitePalette, TEMPLATE_BG_RGB, width, height);
  const ctx = canvas.getContext('2d')!;
  applyOutlines(ctx, outlines, width, height);

  const fontSize = Math.max(8, Math.round(Math.max(width, height) / 120));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const region of [...regions].sort((a, b) => b.area - a.area || a.regionId - b.regionId)) {
    const placement = placements.get(region.regionId);
    if (!placement) continue;
    const num = colorToNumber.get(region.colorIndex) ?? region.colorIndex + 1;
    const text = String(num);
    const textWidth = ctx.measureText(text).width;
    const circleRadius = Math.max(fontSize * 0.6, textWidth * 0.7 + 2);
    const [cx, cy, sr] = clampCircleToCanvas(placement.x, placement.y, circleRadius, width, height);

    const po = region.colorIndex * 3;
    const cr = paletteRgb[po], cg = paletteRgb[po + 1], cb = paletteRgb[po + 2];
    ctx.beginPath();
    ctx.arc(cx, cy, sr, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    ctx.fill();
    ctx.fillStyle = labelTextColor(cr, cg, cb);
    ctx.fillText(text, cx, cy);
  }

  return canvas;
}

/**
 * Circles Only template: white fill + outlines + small color dot (no text)
 */
function renderCirclesOnlyTemplate(
  labelMap: Int32Array, regions: RegionInfo[],
  placements: Map<number, LabelPlacement>,
  paletteRgb: Uint8Array, outlines: Uint8Array,
  width: number, height: number,
): OffscreenCanvas {
  const whitePalette = new Uint8Array(paletteRgb.length).fill(255);
  const canvas = renderCanvasFromLabelMapWithFallback(labelMap, whitePalette, TEMPLATE_BG_RGB, width, height);
  const ctx = canvas.getContext('2d')!;
  applyOutlines(ctx, outlines, width, height);

  for (const region of [...regions].sort((a, b) => b.area - a.area || a.regionId - b.regionId)) {
    const placement = placements.get(region.regionId);
    if (!placement) continue;
    const circleRadius = Math.min(
      fixedCircleMarkerRadius(width, height),
      Math.max(1, Math.floor(placement.radius * 0.75)),
    );
    const [cx, cy, sr] = clampCircleToCanvas(placement.x, placement.y, circleRadius, width, height);
    const po = region.colorIndex * 3;
    ctx.beginPath();
    ctx.arc(cx, cy, sr, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${paletteRgb[po]},${paletteRgb[po + 1]},${paletteRgb[po + 2]})`;
    ctx.fill();
  }

  return canvas;
}

/**
 * Classic template: full palette color fill + outlines + number labels
 */
function renderClassicTemplate(
  labelMap: Int32Array, regions: RegionInfo[],
  placements: Map<number, LabelPlacement>,
  paletteRgb: Uint8Array, outlines: Uint8Array,
  width: number, height: number,
  colorToNumber: Map<number, number>,
): OffscreenCanvas {
  const canvas = renderCanvasFromLabelMapWithFallback(labelMap, paletteRgb, TEMPLATE_BG_RGB, width, height);
  const ctx = canvas.getContext('2d')!;
  applyOutlines(ctx, outlines, width, height);
  return canvas;
}

function renderCanvasFromLabelMapWithFallback(
  labelMap: Int32Array,
  paletteRgb: Uint8Array,
  fallbackRgb: [number, number, number],
  width: number,
  height: number,
): OffscreenCanvas {
  const outputPixels = new Uint8ClampedArray(width * height * 4);
  const maxLabel = Math.max(0, paletteRgb.length / 3 - 1);
  for (let pixelIndex = 0; pixelIndex < labelMap.length; pixelIndex += 1) {
    const label = labelMap[pixelIndex];
    const outputOffset = pixelIndex * 4;
    if (label < 0) {
      outputPixels[outputOffset] = fallbackRgb[0];
      outputPixels[outputOffset + 1] = fallbackRgb[1];
      outputPixels[outputOffset + 2] = fallbackRgb[2];
      outputPixels[outputOffset + 3] = 255;
      continue;
    }
    const paletteOffset = Math.min(maxLabel, label) * 3;
    outputPixels[outputOffset] = paletteRgb[paletteOffset];
    outputPixels[outputOffset + 1] = paletteRgb[paletteOffset + 1];
    outputPixels[outputOffset + 2] = paletteRgb[paletteOffset + 2];
    outputPixels[outputOffset + 3] = 255;
  }

  const outputCanvas = new OffscreenCanvas(width, height);

  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) {
    throw new Error("Canvas 2D is not available in this browser.");
  }

  outputContext.putImageData(new ImageData(outputPixels, width, height), 0, 0);
  return outputCanvas;
}

function fixedCircleMarkerRadius(width: number, height: number): number {
  const longest = Math.max(width, height);
  return Math.max(3, Math.min(5, Math.round(longest / 300)));
}

function clampCircleToCanvas(x: number, y: number, radius: number, width: number, height: number): [number, number, number] {
  const maxRadius = Math.max(1, Math.floor((Math.min(width, height) - 2) / 2));
  const safeRadius = Math.min(radius, maxRadius);
  const minX = safeRadius + 1;
  const maxX = width - safeRadius - 2;
  const minY = safeRadius + 1;
  const maxY = height - safeRadius - 2;

  const safeX = maxX < minX ? Math.floor(width / 2) : clampInteger(Math.round(x), minX, maxX);
  const safeY = maxY < minY ? Math.floor(height / 2) : clampInteger(Math.round(y), minY, maxY);

  return [safeX, safeY, safeRadius];
}

function normalizePaintPalette(paletteRgb: Uint8Array): Uint8Array {
  const normalized = new Uint8Array(paletteRgb.length);
  for (let offset = 0; offset < paletteRgb.length; offset += 3) {
    const [red, green, blue] = normalizePaintColor([
      paletteRgb[offset],
      paletteRgb[offset + 1],
      paletteRgb[offset + 2],
    ]);
    normalized[offset] = red;
    normalized[offset + 1] = green;
    normalized[offset + 2] = blue;
  }
  return normalized;
}

function brightenPaletteForTemplate(paletteRgb: Uint8Array): Uint8Array {
  const brightened = new Uint8Array(paletteRgb.length);
  for (let offset = 0; offset < paletteRgb.length; offset += 3) {
    const [red, green, blue] = brightTemplateColor([
      paletteRgb[offset],
      paletteRgb[offset + 1],
      paletteRgb[offset + 2],
    ]);
    brightened[offset] = red;
    brightened[offset + 1] = green;
    brightened[offset + 2] = blue;
  }
  return brightened;
}

function normalizePaintColor(rgb: [number, number, number]): [number, number, number] {
  const luminance = relativeLuminance(rgb);
  const spread = Math.max(...rgb) - Math.min(...rgb);

  if (luminance > 244 && spread < 24) {
    return LIGHT_PAINT_RGB;
  }

  if (luminance >= 42) {
    return rgb;
  }

  const scale = 42 / Math.max(luminance, 1);
  return [
    clampInteger(Math.round(rgb[0] * scale), 24, 255),
    clampInteger(Math.round(rgb[1] * scale), 24, 255),
    clampInteger(Math.round(rgb[2] * scale), 24, 255),
  ];
}

function relativeLuminance(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function brightTemplateColor(rgb: [number, number, number]): [number, number, number] {
  const alpha = 0.08;
  return [
    clampToByte(255 * (1 - alpha) + rgb[0] * alpha),
    clampToByte(255 * (1 - alpha) + rgb[1] * alpha),
    clampToByte(255 * (1 - alpha) + rgb[2] * alpha),
  ];
}

function clampToByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mergeNearDuplicateColors(
  centerLab: Uint8Array, paletteRgb: Uint8Array,
  labels: Int32Array, colorCount: number,
) {
  const threshold = KMEANS_MERGE_SIMILAR_LAB_DISTANCE;
  // Build a remap table: for each color index, what should it map to?
  const remap = new Int32Array(colorCount);
  for (let i = 0; i < colorCount; i++) remap[i] = i;

  for (let i = 0; i < colorCount; i++) {
    if (remap[i] !== i) continue; // already remapped
    for (let j = i + 1; j < colorCount; j++) {
      if (remap[j] !== j) continue; // already remapped
      const io = i * 3, jo = j * 3;
      const dL = centerLab[io] - centerLab[jo];
      const da = centerLab[io + 1] - centerLab[jo + 1];
      const db = centerLab[io + 2] - centerLab[jo + 2];
      const dist = Math.sqrt(dL * dL + da * da + db * db);
      if (dist < threshold) {
        remap[j] = i; // merge j into i
      }
    }
  }

  // Apply remap to all pixel labels
  let anyChanged = false;
  for (let p = 0; p < labels.length; p++) {
    const oldLabel = labels[p];
    if (oldLabel >= 0 && oldLabel < colorCount && remap[oldLabel] !== oldLabel) {
      labels[p] = remap[oldLabel];
      anyChanged = true;
    }
  }
  // No need to compact palette here — compactLabelsByPalette runs later in the pipeline
  if (!anyChanged) return;
}

function clampInteger(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

// loadBitmap removed — worker receives ImageData and uses createImageBitmap directly

function canvasToBlob(canvas: OffscreenCanvas): Promise<Blob> {
  return canvas.convertToBlob({ type: "image/png" });
}
