import type { ImagePickerAsset } from 'expo-image-picker';
import { encode } from 'fast-png';

import type { SimpleImageData } from '../../App/src/types/imageData';
import { uint8ToBase64 } from '../../App/src/features/generator/base64';
import type {
  GeneratorDebugStageSnapshot,
  GeneratorOutputVariant,
  GeneratorOutputVariantId,
  GeneratorProgress,
  GeneratorResult,
  GeneratorSettings,
  GeneratorStage,
  GeneratorTimings,
  PaletteStat,
} from '../../App/src/features/generator/generatorTypes';
import { preparePickedImageForGenerator } from '../../App/src/features/generator/prepareImage';

const WORK_MAX_EDGE = 1400;
const TOKEN_BINS_PER_CHANNEL = 4;
const TOKEN_COLOR_COUNT = TOKEN_BINS_PER_CHANNEL * TOKEN_BINS_PER_CHANNEL * TOKEN_BINS_PER_CHANNEL;
const PALETTE_WEIGHT_POWER = 0.78;
const MAJORITY_FILTER_RUNS = 2;
const POST_MAJORITY_FILTER_RUNS = 1;
const FINAL_MAJORITY_FILTER_RUNS = 1;
const MIN_REGION_RATIO = 0.00018;
const MIN_REGION_PIXELS = 160;
const TINY_MERGE_PASSES = 12;
const SPECKLE_REGION_PIXELS = 48;
const FINAL_SPECKLE_PASSES = 8;
const DETAIL_PROTECT_MIN_PIXELS = 80;
const DETAIL_PROTECT_LAB_DISTANCE = 26;
const BOUNDARY_ALPHA = 0.82;
const BOUNDARY_SOFT_ALPHA = 0.22;

type PipelineStage = Exclude<GeneratorStage, 'done'>;

const STAGE_WEIGHTS: Record<PipelineStage, number> = {
  decode: 0.08,
  kmeans: 0.32,
  colorMap: 0.08,
  narrowCleanup: 0.08,
  borderSegment: 0.04,
  facetBuild: 0.14,
  facetReduce: 0.14,
  borderTrace: 0.04,
  labelPlacement: 0.01,
  svgRender: 0.07,
};

const STAGE_ORDER: PipelineStage[] = [
  'decode',
  'kmeans',
  'colorMap',
  'narrowCleanup',
  'borderSegment',
  'facetBuild',
  'facetReduce',
  'borderTrace',
  'labelPlacement',
  'svgRender',
];

export type GeneratorPipelineDebugCache = Record<string, never>;

type GeneratePaintByNumbersOptions = {
  debug?: {
    enabled: boolean;
    rerunFromStage?: GeneratorStage;
    cache?: GeneratorPipelineDebugCache | null;
    onCacheUpdated?: (cache: GeneratorPipelineDebugCache) => void;
  };
  onStageSnapshot?: (snapshot: GeneratorDebugStageSnapshot) => void;
  variantIds?: readonly GeneratorOutputVariantId[];
};

type Components = {
  componentMap: Int32Array;
  labels: Int32Array;
  areas: Int32Array;
  meanRgb: Float32Array;
};

type MergeResult = {
  labelMap: Int32Array;
  mergeCount: number;
  componentCount: number;
  smallRemaining: number;
  protectedSmall: number;
};

type Rgb = [number, number, number];

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
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
    const progress = Math.max(0, Math.min(1, offset + weight * Math.max(0, Math.min(1, localProgress))));
    onProgress?.({
      stage,
      progress: Math.round(progress * 100),
      message,
    });
  };
}

function addTiming(timings: GeneratorTimings, stage: GeneratorStage, startedAt: number): void {
  timings[stage] = (timings[stage] ?? 0) + (nowMs() - startedAt);
}

function settingsWithPipelineResizeLimit(settings: GeneratorSettings): GeneratorSettings {
  return {
    ...settings,
    resizeImageWidth: Math.min(settings.resizeImageWidth, WORK_MAX_EDGE),
    resizeImageHeight: Math.min(settings.resizeImageHeight, WORK_MAX_EDGE),
  };
}

function edgePreservingSmooth(image: SimpleImageData): Uint8ClampedArray {
  const { width, height, data } = image;
  const output = new Uint8ClampedArray(data.length);
  const colorThresholdSquared = 34 * 34 * 3;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const centerR = data[offset];
      const centerG = data[offset + 1];
      const centerB = data[offset + 2];
      let sumR = centerR * 3;
      let sumG = centerG * 3;
      let sumB = centerB * 3;
      let weight = 3;

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          if (nx < 0 || nx >= width) {
            continue;
          }
          const neighborOffset = (ny * width + nx) * 4;
          const dr = data[neighborOffset] - centerR;
          const dg = data[neighborOffset + 1] - centerG;
          const db = data[neighborOffset + 2] - centerB;
          if (dr * dr + dg * dg + db * db > colorThresholdSquared) {
            continue;
          }
          sumR += data[neighborOffset];
          sumG += data[neighborOffset + 1];
          sumB += data[neighborOffset + 2];
          weight += 1;
        }
      }

      output[offset] = Math.round(sumR / weight);
      output[offset + 1] = Math.round(sumG / weight);
      output[offset + 2] = Math.round(sumB / weight);
      output[offset + 3] = 255;
    }
  }

  return output;
}

function tokenForRgb(data: Uint8ClampedArray, offset: number): number {
  const rBin = data[offset] >> 6;
  const gBin = data[offset + 1] >> 6;
  const bBin = data[offset + 2] >> 6;
  return (rBin << 4) | (gBin << 2) | bBin;
}

function buildTokenLabels(data: Uint8ClampedArray, width: number, height: number): Int32Array {
  const labels = new Int32Array(width * height);
  for (let index = 0; index < labels.length; index += 1) {
    labels[index] = tokenForRgb(data, index * 4);
  }
  return labels;
}

function connectedComponentsForLabels(
  labelMap: Int32Array,
  labelCount: number,
  width: number,
  height: number,
  rgbData?: Uint8ClampedArray,
): Components {
  const pixelCount = width * height;
  const componentMap = new Int32Array(pixelCount);
  componentMap.fill(-1);
  const queue = new Int32Array(pixelCount);
  const labels: number[] = [];
  const areas: number[] = [];
  const meanRgb: number[] = [];

  for (let start = 0; start < pixelCount; start += 1) {
    if (componentMap[start] !== -1) {
      continue;
    }
    const sourceLabel = labelMap[start];
    if (sourceLabel < 0 || sourceLabel >= labelCount) {
      continue;
    }

    const componentId = labels.length;
    let head = 0;
    let tail = 0;
    let area = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    queue[tail] = start;
    tail += 1;
    componentMap[start] = componentId;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      area += 1;
      if (rgbData != null) {
        const offset = index * 4;
        sumR += rgbData[offset];
        sumG += rgbData[offset + 1];
        sumB += rgbData[offset + 2];
      }

      const x = index % width;
      const up = index - width;
      const down = index + width;
      const left = index - 1;
      const right = index + 1;
      if (up >= 0 && componentMap[up] === -1 && labelMap[up] === sourceLabel) {
        componentMap[up] = componentId;
        queue[tail] = up;
        tail += 1;
      }
      if (down < pixelCount && componentMap[down] === -1 && labelMap[down] === sourceLabel) {
        componentMap[down] = componentId;
        queue[tail] = down;
        tail += 1;
      }
      if (x > 0 && componentMap[left] === -1 && labelMap[left] === sourceLabel) {
        componentMap[left] = componentId;
        queue[tail] = left;
        tail += 1;
      }
      if (x + 1 < width && componentMap[right] === -1 && labelMap[right] === sourceLabel) {
        componentMap[right] = componentId;
        queue[tail] = right;
        tail += 1;
      }
    }

    labels.push(sourceLabel);
    areas.push(area);
    meanRgb.push(
      area > 0 ? sumR / area : 255,
      area > 0 ? sumG / area : 255,
      area > 0 ? sumB / area : 255,
    );
  }

  return {
    componentMap,
    labels: Int32Array.from(labels),
    areas: Int32Array.from(areas),
    meanRgb: Float32Array.from(meanRgb),
  };
}

function pivotRgb(value: number): number {
  const normalized = value / 255;
  return normalized > 0.04045 ? ((normalized + 0.055) / 1.055) ** 2.4 : normalized / 12.92;
}

function pivotXyz(value: number): number {
  return value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
}

function rgbToLab(r: number, g: number, b: number): Rgb {
  const linearR = pivotRgb(r);
  const linearG = pivotRgb(g);
  const linearB = pivotRgb(b);
  const x = (linearR * 0.4124 + linearG * 0.3576 + linearB * 0.1805) / 0.95047;
  const y = linearR * 0.2126 + linearG * 0.7152 + linearB * 0.0722;
  const z = (linearR * 0.0193 + linearG * 0.1192 + linearB * 0.9505) / 1.08883;
  const fx = pivotXyz(x);
  const fy = pivotXyz(y);
  const fz = pivotXyz(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDistance(left: Float32Array, leftIndex: number, right: Float32Array, rightIndex: number): number {
  const leftOffset = leftIndex * 3;
  const rightOffset = rightIndex * 3;
  const dL = left[leftOffset] - right[rightOffset];
  const dA = left[leftOffset + 1] - right[rightOffset + 1];
  const dB = left[leftOffset + 2] - right[rightOffset + 2];
  return Math.sqrt(dL * dL + dA * dA + dB * dB);
}

function componentLabColors(meanRgb: Float32Array): Float32Array {
  const lab = new Float32Array(meanRgb.length);
  for (let index = 0; index < meanRgb.length / 3; index += 1) {
    const offset = index * 3;
    const color = rgbToLab(meanRgb[offset], meanRgb[offset + 1], meanRgb[offset + 2]);
    lab[offset] = color[0];
    lab[offset + 1] = color[1];
    lab[offset + 2] = color[2];
  }
  return lab;
}

function weightedPaletteKMeans(
  meanRgb: Float32Array,
  areas: Int32Array,
  colorCount: number,
  seed: number,
): { componentLabels: Int32Array; paletteRgb: Float32Array } {
  const componentCount = areas.length;
  const actualColorCount = Math.max(1, Math.min(colorCount, componentCount));
  const componentLab = componentLabColors(meanRgb);
  const weights = new Float32Array(componentCount);
  let firstCenter = 0;
  for (let index = 0; index < componentCount; index += 1) {
    weights[index] = Math.max(1, areas[index]) ** PALETTE_WEIGHT_POWER;
    if (areas[index] > areas[firstCenter]) {
      firstCenter = index;
    }
  }

  const centers = new Float32Array(actualColorCount * 3);
  centers[0] = componentLab[firstCenter * 3];
  centers[1] = componentLab[firstCenter * 3 + 1];
  centers[2] = componentLab[firstCenter * 3 + 2];
  const closest = new Float32Array(componentCount);
  closest.fill(Number.POSITIVE_INFINITY);

  for (let centerIndex = 1; centerIndex < actualColorCount; centerIndex += 1) {
    let bestIndex = 0;
    let bestScore = -1;
    for (let index = 0; index < componentCount; index += 1) {
      const distance = labDistance(componentLab, index, centers, centerIndex - 1);
      closest[index] = Math.min(closest[index], distance * distance);
      const score = closest[index] * weights[index] * (1 + ((seed + index * 17) % 997) / 997000);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const dst = centerIndex * 3;
    const src = bestIndex * 3;
    centers[dst] = componentLab[src];
    centers[dst + 1] = componentLab[src + 1];
    centers[dst + 2] = componentLab[src + 2];
  }

  const componentLabels = new Int32Array(componentCount);
  for (let iteration = 0; iteration < 18; iteration += 1) {
    let changed = 0;
    for (let index = 0; index < componentCount; index += 1) {
      let bestLabel = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let centerIndex = 0; centerIndex < actualColorCount; centerIndex += 1) {
        const distance = labDistance(componentLab, index, centers, centerIndex);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLabel = centerIndex;
        }
      }
      if (componentLabels[index] !== bestLabel) {
        componentLabels[index] = bestLabel;
        changed += 1;
      }
    }

    const sums = new Float64Array(actualColorCount * 3);
    const weightSums = new Float64Array(actualColorCount);
    for (let index = 0; index < componentCount; index += 1) {
      const label = componentLabels[index];
      const weight = weights[index];
      const src = index * 3;
      const dst = label * 3;
      sums[dst] += componentLab[src] * weight;
      sums[dst + 1] += componentLab[src + 1] * weight;
      sums[dst + 2] += componentLab[src + 2] * weight;
      weightSums[label] += weight;
    }
    for (let label = 0; label < actualColorCount; label += 1) {
      const dst = label * 3;
      const weight = weightSums[label];
      if (weight > 0) {
        centers[dst] = sums[dst] / weight;
        centers[dst + 1] = sums[dst + 1] / weight;
        centers[dst + 2] = sums[dst + 2] / weight;
      }
    }

    if (changed === 0) {
      break;
    }
  }

  const paletteSums = new Float64Array(actualColorCount * 3);
  const paletteWeights = new Float64Array(actualColorCount);
  for (let index = 0; index < componentCount; index += 1) {
    const label = componentLabels[index];
    const weight = weights[index];
    const src = index * 3;
    const dst = label * 3;
    paletteSums[dst] += meanRgb[src] * weight;
    paletteSums[dst + 1] += meanRgb[src + 1] * weight;
    paletteSums[dst + 2] += meanRgb[src + 2] * weight;
    paletteWeights[label] += weight;
  }

  const paletteRgb = new Float32Array(colorCount * 3);
  for (let label = 0; label < colorCount; label += 1) {
    const dst = label * 3;
    const weight = paletteWeights[label];
    if (weight > 0) {
      paletteRgb[dst] = paletteSums[dst] / weight;
      paletteRgb[dst + 1] = paletteSums[dst + 1] / weight;
      paletteRgb[dst + 2] = paletteSums[dst + 2] / weight;
    } else {
      paletteRgb[dst] = 255;
      paletteRgb[dst + 1] = 255;
      paletteRgb[dst + 2] = 255;
    }
  }

  return { componentLabels, paletteRgb };
}

function labelMapFromComponents(componentMap: Int32Array, componentLabels: Int32Array): Int32Array {
  const labelMap = new Int32Array(componentMap.length);
  for (let index = 0; index < componentMap.length; index += 1) {
    labelMap[index] = componentLabels[componentMap[index]] ?? 0;
  }
  return labelMap;
}

function majorityFilterLabels(labelMap: Int32Array, width: number, height: number, colorCount: number, runs: number): Int32Array {
  let current = labelMap;
  for (let run = 0; run < runs; run += 1) {
    const next = new Int32Array(current.length);
    const counts = new Int16Array(colorCount);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        counts.fill(0);
        let bestLabel = current[y * width + x];
        let bestCount = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) {
            continue;
          }
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) {
              continue;
            }
            const label = current[ny * width + nx];
            if (label < 0 || label >= colorCount) {
              continue;
            }
            counts[label] += dx === 0 && dy === 0 ? 2 : 1;
            if (counts[label] > bestCount) {
              bestCount = counts[label];
              bestLabel = label;
            }
          }
        }
        next[y * width + x] = bestLabel;
      }
    }
    current = next;
  }
  return current;
}

function paletteLab(paletteRgb: Float32Array): Float32Array {
  const lab = new Float32Array(paletteRgb.length);
  for (let index = 0; index < paletteRgb.length / 3; index += 1) {
    const offset = index * 3;
    const color = rgbToLab(paletteRgb[offset], paletteRgb[offset + 1], paletteRgb[offset + 2]);
    lab[offset] = color[0];
    lab[offset + 1] = color[1];
    lab[offset + 2] = color[2];
  }
  return lab;
}

function buildAdjacency(componentMap: Int32Array, width: number, height: number): Map<number, Map<number, number>> {
  const adjacency = new Map<number, Map<number, number>>();
  function add(left: number, right: number): void {
    if (left === right) {
      return;
    }
    let leftMap = adjacency.get(left);
    if (leftMap == null) {
      leftMap = new Map();
      adjacency.set(left, leftMap);
    }
    leftMap.set(right, (leftMap.get(right) ?? 0) + 1);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const current = componentMap[index];
      if (x + 1 < width) {
        const right = componentMap[index + 1];
        add(current, right);
        add(right, current);
      }
      if (y + 1 < height) {
        const down = componentMap[index + width];
        add(current, down);
        add(down, current);
      }
    }
  }
  return adjacency;
}

function mergeTinyRegions(
  labelMap: Int32Array,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  minArea: number,
  maxPasses: number,
  forceMergeBelow: number,
  protectMinArea: number,
  protectLabDistance: number,
): MergeResult {
  let current = labelMap;
  const colorCount = paletteRgb.length / 3;
  const lab = paletteLab(paletteRgb);
  let totalMerges = 0;
  let componentCount = 0;
  let smallRemaining = 0;
  let protectedSmall = 0;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const components = connectedComponentsForLabels(current, colorCount, width, height);
    componentCount = components.labels.length;
    const adjacency = buildAdjacency(components.componentMap, width, height);
    const replacementByComponent = new Int32Array(componentCount);
    let changed = 0;

    for (let componentId = 0; componentId < componentCount; componentId += 1) {
      replacementByComponent[componentId] = components.labels[componentId];
    }

    for (let componentId = 0; componentId < componentCount; componentId += 1) {
      const area = components.areas[componentId];
      if (area >= minArea) {
        continue;
      }
      const sourceLabel = components.labels[componentId];
      const neighbors = adjacency.get(componentId);
      if (neighbors == null || neighbors.size === 0) {
        continue;
      }

      let nearestDistance = Number.POSITIVE_INFINITY;
      let bestLabel = sourceLabel;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const [neighborId, borderCount] of neighbors) {
        const targetLabel = components.labels[neighborId];
        if (targetLabel === sourceLabel) {
          continue;
        }
        const distance = labDistance(lab, sourceLabel, lab, targetLabel);
        nearestDistance = Math.min(nearestDistance, distance);
        const borderBonus = Math.min(8, Math.log1p(borderCount) * 1.4);
        const areaBonus = Math.min(12, Math.log1p(components.areas[neighborId]) * 0.8);
        const score = distance - borderBonus - areaBonus;
        if (score < bestScore) {
          bestScore = score;
          bestLabel = targetLabel;
        }
      }

      const detailProtected = area >= protectMinArea && nearestDistance >= protectLabDistance;
      if (detailProtected && area >= forceMergeBelow) {
        continue;
      }
      if (bestLabel !== sourceLabel) {
        replacementByComponent[componentId] = bestLabel;
        changed += 1;
      }
    }

    if (changed === 0) {
      break;
    }

    const next = new Int32Array(current.length);
    for (let index = 0; index < current.length; index += 1) {
      next[index] = replacementByComponent[components.componentMap[index]];
    }
    current = next;
    totalMerges += changed;
  }

  const finalComponents = connectedComponentsForLabels(current, colorCount, width, height);
  componentCount = finalComponents.labels.length;
  const adjacency = buildAdjacency(finalComponents.componentMap, width, height);
  for (let componentId = 0; componentId < componentCount; componentId += 1) {
    const area = finalComponents.areas[componentId];
    if (area >= minArea) {
      continue;
    }
    const sourceLabel = finalComponents.labels[componentId];
    let nearestDistance = Number.POSITIVE_INFINITY;
    const neighbors = adjacency.get(componentId);
    if (neighbors != null) {
      for (const neighborId of neighbors.keys()) {
        const targetLabel = finalComponents.labels[neighborId];
        if (targetLabel !== sourceLabel) {
          nearestDistance = Math.min(nearestDistance, labDistance(lab, sourceLabel, lab, targetLabel));
        }
      }
    }
    if (area >= protectMinArea && nearestDistance >= protectLabDistance) {
      protectedSmall += 1;
    } else {
      smallRemaining += 1;
    }
  }

  return {
    labelMap: current,
    mergeCount: totalMerges,
    componentCount,
    smallRemaining,
    protectedSmall,
  };
}

function recomputePalette(rgbData: Uint8ClampedArray, labelMap: Int32Array, colorCount: number): Float32Array {
  const sums = new Float64Array(colorCount * 3);
  const counts = new Int32Array(colorCount);
  for (let index = 0; index < labelMap.length; index += 1) {
    const label = labelMap[index];
    if (label < 0 || label >= colorCount) {
      continue;
    }
    const src = index * 4;
    const dst = label * 3;
    sums[dst] += rgbData[src];
    sums[dst + 1] += rgbData[src + 1];
    sums[dst + 2] += rgbData[src + 2];
    counts[label] += 1;
  }
  const palette = new Float32Array(colorCount * 3);
  for (let label = 0; label < colorCount; label += 1) {
    const dst = label * 3;
    if (counts[label] > 0) {
      palette[dst] = sums[dst] / counts[label];
      palette[dst + 1] = sums[dst + 1] / counts[label];
      palette[dst + 2] = sums[dst + 2] / counts[label];
    } else {
      palette[dst] = 255;
      palette[dst + 1] = 255;
      palette[dst + 2] = 255;
    }
  }
  return palette;
}

function boundaryMask(regionMap: Int32Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const region = regionMap[index];
      if ((x + 1 < width && regionMap[index + 1] !== region) || (y + 1 < height && regionMap[index + width] !== region)) {
        mask[index] = 2;
        if (x + 1 < width) {
          mask[index + 1] = Math.max(mask[index + 1], 2);
        }
        if (y + 1 < height) {
          mask[index + width] = Math.max(mask[index + width], 2);
        }
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] !== 2) {
        continue;
      }
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) {
            continue;
          }
          const neighborIndex = ny * width + nx;
          if (mask[neighborIndex] === 0) {
            mask[neighborIndex] = 1;
          }
        }
      }
    }
  }
  return mask;
}

function renderRgba(
  labelMap: Int32Array,
  regionMap: Int32Array,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  withBoundaries: boolean,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  const boundaries = withBoundaries ? boundaryMask(regionMap, width, height) : undefined;
  for (let index = 0; index < labelMap.length; index += 1) {
    const label = labelMap[index];
    const paletteOffset = label * 3;
    const outputOffset = index * 4;
    let r = paletteRgb[paletteOffset];
    let g = paletteRgb[paletteOffset + 1];
    let b = paletteRgb[paletteOffset + 2];
    const boundary = boundaries?.[index] ?? 0;
    if (boundary > 0) {
      const alpha = boundary === 2 ? BOUNDARY_ALPHA : BOUNDARY_SOFT_ALPHA;
      r *= 1 - alpha;
      g *= 1 - alpha;
      b *= 1 - alpha;
    }
    rgba[outputOffset] = clampByte(r);
    rgba[outputOffset + 1] = clampByte(g);
    rgba[outputOffset + 2] = clampByte(b);
    rgba[outputOffset + 3] = 255;
  }
  return rgba;
}

function pngBase64FromRgba(width: number, height: number, data: Uint8Array): string {
  const bytes = encode({
    width,
    height,
    data,
    depth: 8,
    channels: 4,
  });
  return uint8ToBase64(bytes);
}

function embeddedPngSvg(base64: string, width: number, height: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<image href="data:image/png;base64,${base64}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />`,
    '</svg>',
  ].join('');
}

function buildPaletteStats(labelMap: Int32Array, paletteRgb: Float32Array): PaletteStat[] {
  const colorCount = paletteRgb.length / 3;
  const counts = new Int32Array(colorCount);
  let total = 0;
  for (const label of labelMap) {
    if (label >= 0 && label < colorCount) {
      counts[label] += 1;
      total += 1;
    }
  }
  const stats: PaletteStat[] = [];
  for (let label = 0; label < colorCount; label += 1) {
    if (counts[label] === 0) {
      continue;
    }
    const offset = label * 3;
    stats.push({
      index: label + 1,
      color: [clampByte(paletteRgb[offset]), clampByte(paletteRgb[offset + 1]), clampByte(paletteRgb[offset + 2])],
      frequency: counts[label],
      areaPercentage: total > 0 ? counts[label] / total : 0,
    });
  }
  return stats.sort((left, right) => right.frequency - left.frequency || left.index - right.index);
}

function createVariant(
  id: GeneratorOutputVariantId,
  label: string,
  description: string,
  base64: string,
  width: number,
  height: number,
  isDefault = false,
): GeneratorOutputVariant {
  const svg = embeddedPngSvg(base64, width, height);
  return {
    id,
    label,
    description,
    pngBase64: base64,
    pngWidth: width,
    pngHeight: height,
    pngByteLength: Math.ceil((base64.length * 3) / 4),
    svg,
    svgWidth: width,
    svgHeight: height,
    svgByteLength: svg.length,
    isDefault,
  };
}

export async function generatePaintByNumbers(
  asset: ImagePickerAsset,
  settings: GeneratorSettings,
  onProgress?: (progress: GeneratorProgress) => void,
  options: GeneratePaintByNumbersOptions = {},
): Promise<GeneratorResult> {
  const report = createProgressReporter(onProgress);
  const timings: GeneratorTimings = {};
  const targetColorCount = Math.max(1, Math.floor(settings.kMeansNrOfClusters));

  report('decode', 0, 'Bild wird fuer neue Region-First-Pipeline vorbereitet.');
  const decodeStarted = nowMs();
  const decoded = await preparePickedImageForGenerator(asset, settingsWithPipelineResizeLimit(settings));
  addTiming(timings, 'decode', decodeStarted);
  report('decode', 1, `Bild mit ${decoded.imageData.width}x${decoded.imageData.height} Pixeln vorbereitet.`);

  report('kmeans', 0.1, 'Farben werden kantenbewusst geglaettet.');
  const colorStarted = nowMs();
  const smoothed = edgePreservingSmooth(decoded.imageData);
  report('kmeans', 0.45, '64 Farb-Token werden aufgebaut.');
  const tokenLabels = buildTokenLabels(smoothed, decoded.imageData.width, decoded.imageData.height);
  report('kmeans', 0.7, 'Zusammenhaengende Farbregionen werden gesucht.');
  const tokenComponents = connectedComponentsForLabels(
    tokenLabels,
    TOKEN_COLOR_COUNT,
    decoded.imageData.width,
    decoded.imageData.height,
    smoothed,
  );
  report('kmeans', 0.9, `${tokenComponents.labels.length} Startregionen gefunden.`);
  addTiming(timings, 'kmeans', colorStarted);

  report('colorMap', 0, `${targetColorCount} Zielfarben werden regionengewichtet gelernt.`);
  const paletteStarted = nowMs();
  const paletteModel = weightedPaletteKMeans(
    tokenComponents.meanRgb,
    tokenComponents.areas,
    targetColorCount,
    settings.randomSeed,
  );
  let labelMap = labelMapFromComponents(tokenComponents.componentMap, paletteModel.componentLabels);
  let paletteRgb = paletteModel.paletteRgb;
  addTiming(timings, 'colorMap', paletteStarted);
  report('colorMap', 1, `${targetColorCount} Zielfarben gelernt.`);

  report('narrowCleanup', 0, 'Lokale Pixelinseln werden beruhigt.');
  const majorityStarted = nowMs();
  labelMap = majorityFilterLabels(labelMap, decoded.imageData.width, decoded.imageData.height, targetColorCount, MAJORITY_FILTER_RUNS);
  addTiming(timings, 'narrowCleanup', majorityStarted);
  report('narrowCleanup', 1, 'Lokale Pixelinseln beruhigt.');

  const minRegionArea = Math.max(MIN_REGION_PIXELS, Math.round(decoded.imageData.width * decoded.imageData.height * MIN_REGION_RATIO));

  report('facetBuild', 0, 'Finale Farbregionen werden aufgebaut.');
  const facetBuildStarted = nowMs();
  let regionComponents = connectedComponentsForLabels(labelMap, targetColorCount, decoded.imageData.width, decoded.imageData.height);
  addTiming(timings, 'facetBuild', facetBuildStarted);
  report('facetBuild', 1, `${regionComponents.labels.length} Farbregionen erkannt.`);

  report('facetReduce', 0, 'Kleine Restregionen werden gemerged.');
  const reduceStarted = nowMs();
  let merge = mergeTinyRegions(
    labelMap,
    paletteRgb,
    decoded.imageData.width,
    decoded.imageData.height,
    minRegionArea,
    TINY_MERGE_PASSES,
    SPECKLE_REGION_PIXELS,
    DETAIL_PROTECT_MIN_PIXELS,
    DETAIL_PROTECT_LAB_DISTANCE,
  );
  labelMap = majorityFilterLabels(merge.labelMap, decoded.imageData.width, decoded.imageData.height, targetColorCount, POST_MAJORITY_FILTER_RUNS);
  merge = mergeTinyRegions(
    labelMap,
    paletteRgb,
    decoded.imageData.width,
    decoded.imageData.height,
    minRegionArea,
    Math.max(4, Math.floor(TINY_MERGE_PASSES / 2)),
    SPECKLE_REGION_PIXELS,
    DETAIL_PROTECT_MIN_PIXELS,
    DETAIL_PROTECT_LAB_DISTANCE,
  );
  merge = mergeTinyRegions(
    merge.labelMap,
    paletteRgb,
    decoded.imageData.width,
    decoded.imageData.height,
    SPECKLE_REGION_PIXELS,
    FINAL_SPECKLE_PASSES,
    SPECKLE_REGION_PIXELS,
    Number.MAX_SAFE_INTEGER,
    Number.POSITIVE_INFINITY,
  );
  labelMap = majorityFilterLabels(merge.labelMap, decoded.imageData.width, decoded.imageData.height, targetColorCount, FINAL_MAJORITY_FILTER_RUNS);
  paletteRgb = recomputePalette(smoothed, labelMap, targetColorCount);
  regionComponents = connectedComponentsForLabels(labelMap, targetColorCount, decoded.imageData.width, decoded.imageData.height);
  addTiming(timings, 'facetReduce', reduceStarted);
  report('facetReduce', 1, `${regionComponents.labels.length} finale Regionen erzeugt.`);

  report('borderTrace', 0, 'Geglaettete Grenzen werden vorbereitet.');
  const borderStarted = nowMs();
  const regionMap = regionComponents.componentMap;
  addTiming(timings, 'borderTrace', borderStarted);
  report('borderTrace', 1, 'Grenzen vorbereitet.');

  report('labelPlacement', 1, 'Nummernplatzierung in neuer Pipeline noch deaktiviert.');
  timings.labelPlacement = 0;

  report('svgRender', 0, 'Neue Pipeline-Ausgaben werden gerendert.');
  const renderStarted = nowMs();
  const cleanBase64 = pngBase64FromRgba(
    decoded.imageData.width,
    decoded.imageData.height,
    renderRgba(labelMap, regionMap, paletteRgb, decoded.imageData.width, decoded.imageData.height, false),
  );
  const classicBase64 = pngBase64FromRgba(
    decoded.imageData.width,
    decoded.imageData.height,
    renderRgba(labelMap, regionMap, paletteRgb, decoded.imageData.width, decoded.imageData.height, true),
  );
  const variants = [
    createVariant('classic', 'Neue Pipeline · Klassisch', 'Region-First-Farbflächen mit geglaetteten schwarzen Grenzen.', classicBase64, decoded.imageData.width, decoded.imageData.height, true),
    createVariant('cleanColor', 'Neue Pipeline · Farbflaechen', 'Region-First-Farbflächen ohne Grenzen.', cleanBase64, decoded.imageData.width, decoded.imageData.height),
    createVariant('brightColorCircles', 'Neue Pipeline · App-Default', 'Kompatible Default-Ausgabe der neuen Pipeline, ohne Zahlen.', classicBase64, decoded.imageData.width, decoded.imageData.height),
  ].filter((variant) => options.variantIds == null || options.variantIds.includes(variant.id));
  const defaultVariant = variants.find((variant) => variant.isDefault) ?? variants[0];
  addTiming(timings, 'svgRender', renderStarted);
  report('svgRender', 1, 'Neue Pipeline-Ausgaben gerendert.');

  onProgress?.({
    stage: 'done',
    progress: 100,
    message: 'Malvorlage mit neuer Pipeline fertig.',
  });

  const previewPngBase64 = defaultVariant?.pngBase64 ?? classicBase64;
  const svg = defaultVariant?.svg ?? embeddedPngSvg(previewPngBase64, decoded.imageData.width, decoded.imageData.height);

  if (options.debug?.enabled === true) {
    options.debug.onCacheUpdated?.({});
  }

  return {
    svg,
    previewPngBase64,
    previewPngWidth: decoded.imageData.width,
    previewPngHeight: decoded.imageData.height,
    variants,
    svgWidth: decoded.imageData.width,
    svgHeight: decoded.imageData.height,
    imageWidth: decoded.imageData.width,
    imageHeight: decoded.imageData.height,
    facetCount: regionComponents.labels.length,
    palette: buildPaletteStats(labelMap, paletteRgb),
    timings,
    preparedImage: decoded.prepared,
    debug: options.debug?.enabled === true
      ? {
          enabled: true,
          rerunFromStage: options.debug.rerunFromStage,
          finalVariantId: defaultVariant?.id ?? 'classic',
          parameterConfig: { ...settings },
          stages: [],
        }
      : undefined,
  };
}
