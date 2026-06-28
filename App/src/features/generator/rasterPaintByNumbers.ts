import type { ColorMapResult } from '../../vendor/paintbynumbersgenerator/colorreductionmanagement';
import type { RGB } from '../../vendor/paintbynumbersgenerator/common';
import { rgb2lab, rgbToHsl } from '../../vendor/paintbynumbersgenerator/lib/colorconversion';
import { uint8ToBase64 } from './base64';
import type {
  GeneratorOutputVariant,
  GeneratorOutputVariantId,
  GeneratorSettings,
  GeneratorStage,
  PaletteStat,
} from './generatorTypes';

type RasterStage = Exclude<GeneratorStage, 'decode' | 'kmeans' | 'colorMap' | 'done'>;

type RasterReport = (stage: RasterStage, localProgress: number, message: string) => void;

type AddTiming = (stage: GeneratorStage, elapsedMs: number) => void;

type RasterPipelineOptions = {
  report: RasterReport;
  addTiming: AddTiming;
  nowMs: () => number;
};

type RasterData = {
  width: number;
  height: number;
  labelMap: Int32Array;
  paletteRgb: Uint8Array;
};

type RegionInfo = {
  id: number;
  colorIndex: number;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type ConnectedRegions = {
  regionMap: Int32Array;
  regions: RegionInfo[];
};

type LabelPlacement = {
  regionId: number;
  colorIndex: number;
  x: number;
  y: number;
  radius: number;
};

type RenderFillMode = 'bright' | 'color' | 'white' | 'debug';
type RenderMarkerMode = 'numberedCircles' | 'circlesOnly' | 'numbersOnly' | 'none';
type RenderStrokeMode = 'black' | 'color';

type RenderVariantConfig = {
  id: GeneratorOutputVariantId;
  label: string;
  description: string;
  fillMode: RenderFillMode;
  markerMode: RenderMarkerMode;
  strokeMode: RenderStrokeMode;
  isDefault?: boolean;
};

type SvgRegionPath = {
  regionId: number;
  colorIndex: number;
  area: number;
  pathData: string;
};

type Point = {
  x: number;
  y: number;
};

export type RasterPaintByNumbersResult = {
  svg: string;
  previewPngBase64: string;
  previewPngWidth: number;
  previewPngHeight: number;
  variants: GeneratorOutputVariant[];
  imageWidth: number;
  imageHeight: number;
  facetCount: number;
  palette: PaletteStat[];
};

const HARD_EDGE_PROTECTION_LAB_DISTANCE = 26;
const TINY_HARD_EDGE_MERGE_MAX_AREA = 8;
const MIN_REGION_AREA_RATIO = 0.0001;
const MIN_LABEL_AREA_RATIO = 0.0001;
const SMALL_REGION_MAX_PASSES = 3;
const MAX_FACELET_REDUCTION_MAX_PASSES = 24;
const MAX_FACELET_REDUCTION_EXTRA_CANDIDATES = 0.35;
const MAX_FACELET_REDUCTION_MIN_EXTRA_CANDIDATES = 12;
const MAX_FACELET_MERGE_LAB_DISTANCE = 18;
const THIN_REGION_AREA_MULTIPLIER = 2;
const THIN_REGION_MAX_AVERAGE_THICKNESS = 5.5;
const EXPORT_SCALE = 2;
const SVG_PATH_SIMPLIFY_TOLERANCE = 0.85;
const OUTLINE_R = 22;
const OUTLINE_G = 29;
const OUTLINE_B = 31;
const WHITE_R = 250;
const WHITE_G = 252;
const WHITE_B = 249;

const RENDER_VARIANTS: RenderVariantConfig[] = [
  {
    id: 'brightColorCircles',
    label: 'Helle Malvorlage',
    description: 'Helle Flächen, Grenzen, Farbpunkte und Zahlen.',
    fillMode: 'bright',
    markerMode: 'numberedCircles',
    strokeMode: 'black',
    isDefault: true,
  },
  {
    id: 'colorCircles',
    label: 'Farbige Vorlage',
    description: 'Originale Flächenfarben mit Farbpunkten und Zahlen.',
    fillMode: 'color',
    markerMode: 'numberedCircles',
    strokeMode: 'black',
  },
  {
    id: 'cleanColor',
    label: 'Farbflächen',
    description: 'Posterisiertes Farbbild ohne schwarze Grenzen.',
    fillMode: 'color',
    markerMode: 'none',
    strokeMode: 'color',
  },
  {
    id: 'coloredEdges',
    label: 'Farbige Kanten',
    description: 'Helle Vorlage mit farbigen statt schwarzen Grenzen.',
    fillMode: 'white',
    markerMode: 'none',
    strokeMode: 'color',
  },
  {
    id: 'coloredEdgesWithDots',
    label: 'Farbige Kanten + Punkte',
    description: 'Weiße Vorlage mit farbigen Kanten und Farbpunkten.',
    fillMode: 'white',
    markerMode: 'circlesOnly',
    strokeMode: 'color',
  },
  {
    id: 'circlesOnly',
    label: 'Nur Farbpunkte',
    description: 'Weiße Vorlage mit Grenzen und Farbpunkten.',
    fillMode: 'white',
    markerMode: 'circlesOnly',
    strokeMode: 'black',
  },
  {
    id: 'numbers',
    label: 'Nur Zahlen',
    description: 'Weiße Vorlage mit Grenzen und Zahlen.',
    fillMode: 'white',
    markerMode: 'numbersOnly',
    strokeMode: 'black',
  },
  {
    id: 'classic',
    label: 'Klassisch farbig',
    description: 'Posterisiertes Farbbild mit klaren Grenzen.',
    fillMode: 'color',
    markerMode: 'none',
    strokeMode: 'black',
  },
  {
    id: 'debugUnlabeled',
    label: 'Debug-Regionen',
    description: 'Regionen sichtbar eingefärbt, ohne Marker.',
    fillMode: 'debug',
    markerMode: 'none',
    strokeMode: 'black',
  },
];

const DIGIT_PATTERNS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
};

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function nowYield(): Promise<void> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout;
    if (typeof timer === 'function') {
      timer(resolve, 0);
      return;
    }
    resolve();
  });
}

function getColorMapArray(colorMapResult: ColorMapResult): Uint8Array {
  return (colorMapResult.imgColorIndices as unknown as { arr: Uint8Array }).arr;
}

function colorMapToRaster(colorMapResult: ColorMapResult): RasterData {
  const source = getColorMapArray(colorMapResult);
  const labelMap = new Int32Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    labelMap[index] = source[index];
  }

  const paletteRgb = new Uint8Array(colorMapResult.colorsByIndex.length * 3);
  colorMapResult.colorsByIndex.forEach((color, index) => {
    const offset = index * 3;
    paletteRgb[offset] = clampByte(color[0]);
    paletteRgb[offset + 1] = clampByte(color[1]);
    paletteRgb[offset + 2] = clampByte(color[2]);
  });

  return {
    width: colorMapResult.width,
    height: colorMapResult.height,
    labelMap,
    paletteRgb,
  };
}

function computePaletteLab(paletteRgb: Uint8Array): Float32Array {
  const paletteLab = new Float32Array((paletteRgb.length / 3) * 3);
  for (let colorIndex = 0; colorIndex < paletteRgb.length / 3; colorIndex += 1) {
    const offset = colorIndex * 3;
    const lab = rgb2lab([paletteRgb[offset], paletteRgb[offset + 1], paletteRgb[offset + 2]]);
    paletteLab[offset] = lab[0];
    paletteLab[offset + 1] = lab[1];
    paletteLab[offset + 2] = lab[2];
  }
  return paletteLab;
}

function paletteLabDistance(paletteLab: Float32Array, leftIndex: number, rightIndex: number): number {
  if (leftIndex === rightIndex) {
    return 0;
  }

  const leftOffset = leftIndex * 3;
  const rightOffset = rightIndex * 3;
  const dL = paletteLab[leftOffset] - paletteLab[rightOffset];
  const dA = paletteLab[leftOffset + 1] - paletteLab[rightOffset + 1];
  const dB = paletteLab[leftOffset + 2] - paletteLab[rightOffset + 2];
  return Math.sqrt(dL * dL + dA * dA + dB * dB);
}

function canReplaceLabel(paletteLab: Float32Array, sourceLabel: number, targetLabel: number): boolean {
  return paletteLabDistance(paletteLab, sourceLabel, targetLabel) <= HARD_EDGE_PROTECTION_LAB_DISTANCE;
}

function cleanupNarrowPixelStrips(
  raster: RasterData,
  runs: number,
  report?: (run: number, runs: number, changedPixels: number) => void,
): RasterData {
  if (runs <= 0 || raster.width < 3 || raster.height < 3) {
    return raster;
  }

  const { width, height } = raster;
  const paletteLab = computePaletteLab(raster.paletteRgb);
  let current = raster.labelMap;

  for (let run = 0; run < runs; run += 1) {
    const next = new Int32Array(current);
    let changedPixels = 0;

    for (let y = 1; y < height - 1; y += 1) {
      const rowOffset = y * width;
      for (let x = 1; x < width - 1; x += 1) {
        const index = rowOffset + x;
        const label = current[index];
        const left = current[index - 1];
        const right = current[index + 1];
        const up = current[index - width];
        const down = current[index + width];

        let replacement = -1;
        let bestDistance = Number.POSITIVE_INFINITY;

        if (left === right && left !== label && canReplaceLabel(paletteLab, label, left)) {
          const distance = paletteLabDistance(paletteLab, label, left);
          replacement = left;
          bestDistance = distance;
        }
        if (up === down && up !== label && canReplaceLabel(paletteLab, label, up)) {
          const distance = paletteLabDistance(paletteLab, label, up);
          if (distance < bestDistance) {
            replacement = up;
            bestDistance = distance;
          }
        }

        if (replacement < 0) {
          const neighborLabels = [left, right, up, down];
          let sameNeighborCount = 0;
          for (const neighbor of neighborLabels) {
            if (neighbor === label) {
              sameNeighborCount += 1;
            }
          }

          if (sameNeighborCount === 0) {
            const candidates = [left, right, up, down];
            for (const candidate of candidates) {
              if (candidate === label || !canReplaceLabel(paletteLab, label, candidate)) {
                continue;
              }
              const distance = paletteLabDistance(paletteLab, label, candidate);
              if (distance < bestDistance) {
                replacement = candidate;
                bestDistance = distance;
              }
            }
          }
        }

        if (replacement >= 0 && replacement !== label) {
          next[index] = replacement;
          changedPixels += 1;
        }
      }
    }

    current = next;
    report?.(run + 1, runs, changedPixels);
    if (changedPixels === 0) {
      break;
    }
  }

  return { ...raster, labelMap: current };
}

function pruneWeakProtrusionPixels(raster: RasterData, runs: number): RasterData {
  if (runs <= 0 || raster.width < 3 || raster.height < 3) {
    return raster;
  }

  const { width, height } = raster;
  const paletteLab = computePaletteLab(raster.paletteRgb);
  let current = raster.labelMap;

  for (let run = 0; run < runs; run += 1) {
    const next = new Int32Array(current);
    let changedPixels = 0;

    for (let y = 1; y < height - 1; y += 1) {
      const rowOffset = y * width;
      for (let x = 1; x < width - 1; x += 1) {
        const index = rowOffset + x;
        const label = current[index];
        let same4 = 0;
        if (current[index - 1] === label) same4 += 1;
        if (current[index + 1] === label) same4 += 1;
        if (current[index - width] === label) same4 += 1;
        if (current[index + width] === label) same4 += 1;

        if (same4 > 1) {
          continue;
        }

        let same8 = same4;
        if (current[index - width - 1] === label) same8 += 1;
        if (current[index - width + 1] === label) same8 += 1;
        if (current[index + width - 1] === label) same8 += 1;
        if (current[index + width + 1] === label) same8 += 1;

        if (same8 > 3) {
          continue;
        }

        const candidates = [
          current[index - 1],
          current[index + 1],
          current[index - width],
          current[index + width],
          current[index - width - 1],
          current[index - width + 1],
          current[index + width - 1],
          current[index + width + 1],
        ];
        let bestLabel = -1;
        let bestScore = Number.NEGATIVE_INFINITY;

        for (const candidate of candidates) {
          if (candidate === label || !canReplaceLabel(paletteLab, label, candidate)) {
            continue;
          }
          let count = 0;
          for (const other of candidates) {
            if (other === candidate) {
              count += 1;
            }
          }
          const distance = paletteLabDistance(paletteLab, label, candidate);
          const score = count * 100 - distance;
          if (score > bestScore) {
            bestScore = score;
            bestLabel = candidate;
          }
        }

        if (bestLabel >= 0) {
          next[index] = bestLabel;
          changedPixels += 1;
        }
      }
    }

    current = next;
    if (changedPixels === 0) {
      break;
    }
  }

  return { ...raster, labelMap: current };
}

function compactLabels(raster: RasterData): RasterData {
  const colorCount = raster.paletteRgb.length / 3;
  const counts = new Int32Array(colorCount);
  for (const label of raster.labelMap) {
    if (label >= 0 && label < colorCount) {
      counts[label] += 1;
    }
  }

  const presentLabels: number[] = [];
  for (let label = 0; label < colorCount; label += 1) {
    if (counts[label] > 0) {
      presentLabels.push(label);
    }
  }

  presentLabels.sort((left, right) => {
    const countDelta = counts[right] - counts[left];
    if (countDelta !== 0) {
      return countDelta;
    }

    const leftOffset = left * 3;
    const rightOffset = right * 3;
    const leftHsl = rgbToHsl(raster.paletteRgb[leftOffset], raster.paletteRgb[leftOffset + 1], raster.paletteRgb[leftOffset + 2]);
    const rightHsl = rgbToHsl(raster.paletteRgb[rightOffset], raster.paletteRgb[rightOffset + 1], raster.paletteRgb[rightOffset + 2]);
    return leftHsl[0] - rightHsl[0] || leftHsl[2] - rightHsl[2] || left - right;
  });

  const remap = new Int32Array(colorCount);
  remap.fill(-1);
  const compactPalette = new Uint8Array(presentLabels.length * 3);
  presentLabels.forEach((oldLabel, newLabel) => {
    remap[oldLabel] = newLabel;
    const oldOffset = oldLabel * 3;
    const newOffset = newLabel * 3;
    compactPalette[newOffset] = raster.paletteRgb[oldOffset];
    compactPalette[newOffset + 1] = raster.paletteRgb[oldOffset + 1];
    compactPalette[newOffset + 2] = raster.paletteRgb[oldOffset + 2];
  });

  const compactMap = new Int32Array(raster.labelMap.length);
  for (let index = 0; index < raster.labelMap.length; index += 1) {
    const label = raster.labelMap[index];
    compactMap[index] = label >= 0 && label < remap.length ? remap[label] : -1;
  }

  return {
    ...raster,
    labelMap: compactMap,
    paletteRgb: compactPalette,
  };
}

function findConnectedRegions(labelMap: Int32Array, width: number, height: number): ConnectedRegions {
  const pixelCount = labelMap.length;
  const visited = new Uint8Array(pixelCount);
  const regionMap = new Int32Array(pixelCount);
  regionMap.fill(-1);
  const stack = new Int32Array(pixelCount);
  const regions: RegionInfo[] = [];

  for (let startIndex = 0; startIndex < pixelCount; startIndex += 1) {
    if (visited[startIndex] !== 0 || labelMap[startIndex] < 0) {
      continue;
    }

    const colorIndex = labelMap[startIndex];
    const regionId = regions.length;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let stackSize = 0;
    stack[stackSize] = startIndex;
    stackSize += 1;
    visited[startIndex] = 1;

    while (stackSize > 0) {
      stackSize -= 1;
      const index = stack[stackSize];
      regionMap[index] = regionId;
      area += 1;

      const x = index % width;
      const y = Math.floor(index / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0) {
        const neighborIndex = index - 1;
        if (visited[neighborIndex] === 0 && labelMap[neighborIndex] === colorIndex) {
          visited[neighborIndex] = 1;
          stack[stackSize] = neighborIndex;
          stackSize += 1;
        }
      }
      if (x < width - 1) {
        const neighborIndex = index + 1;
        if (visited[neighborIndex] === 0 && labelMap[neighborIndex] === colorIndex) {
          visited[neighborIndex] = 1;
          stack[stackSize] = neighborIndex;
          stackSize += 1;
        }
      }
      if (y > 0) {
        const neighborIndex = index - width;
        if (visited[neighborIndex] === 0 && labelMap[neighborIndex] === colorIndex) {
          visited[neighborIndex] = 1;
          stack[stackSize] = neighborIndex;
          stackSize += 1;
        }
      }
      if (y < height - 1) {
        const neighborIndex = index + width;
        if (visited[neighborIndex] === 0 && labelMap[neighborIndex] === colorIndex) {
          visited[neighborIndex] = 1;
          stack[stackSize] = neighborIndex;
          stackSize += 1;
        }
      }
    }

    regions.push({
      id: regionId,
      colorIndex,
      area,
      minX,
      minY,
      maxX,
      maxY,
    });
  }

  return { regionMap, regions };
}

function buildRegionAdjacency(regionMap: Int32Array, width: number, height: number): Map<number, Map<number, number>> {
  const adjacency = new Map<number, Map<number, number>>();

  function add(leftId: number, rightId: number): void {
    if (leftId < 0 || rightId < 0 || leftId === rightId) {
      return;
    }
    let leftNeighbors = adjacency.get(leftId);
    if (leftNeighbors == null) {
      leftNeighbors = new Map<number, number>();
      adjacency.set(leftId, leftNeighbors);
    }
    leftNeighbors.set(rightId, (leftNeighbors.get(rightId) ?? 0) + 1);

    let rightNeighbors = adjacency.get(rightId);
    if (rightNeighbors == null) {
      rightNeighbors = new Map<number, number>();
      adjacency.set(rightId, rightNeighbors);
    }
    rightNeighbors.set(leftId, (rightNeighbors.get(leftId) ?? 0) + 1);
  }

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x;
      const regionId = regionMap[index];
      if (x + 1 < width) {
        add(regionId, regionMap[index + 1]);
      }
      if (y + 1 < height) {
        add(regionId, regionMap[index + width]);
      }
    }
  }

  return adjacency;
}

function isThinRegion(region: RegionInfo, minRegionArea: number): boolean {
  const bboxWidth = region.maxX - region.minX + 1;
  const bboxHeight = region.maxY - region.minY + 1;
  const longestSide = Math.max(bboxWidth, bboxHeight);
  if (longestSide <= 0) {
    return false;
  }
  const averageThickness = region.area / longestSide;
  return region.area <= minRegionArea * THIN_REGION_AREA_MULTIPLIER && averageThickness <= THIN_REGION_MAX_AVERAGE_THICKNESS;
}

function buildCandidateMask(regions: RegionInfo[], minRegionArea: number): Uint8Array {
  const candidates = new Uint8Array(regions.length);
  for (const region of regions) {
    if (region.area < minRegionArea || isThinRegion(region, minRegionArea)) {
      candidates[region.id] = 1;
    }
  }
  return candidates;
}

function chooseMergeTarget(
  region: RegionInfo,
  regions: RegionInfo[],
  adjacency: Map<number, Map<number, number>>,
  candidateMask: Uint8Array,
  paletteLab: Float32Array,
): number {
  const neighbors = adjacency.get(region.id);
  if (neighbors == null || neighbors.size === 0) {
    return -1;
  }

  let bestTarget = -1;
  let bestCandidatePenalty = Number.POSITIVE_INFINITY;
  let bestBorder = -1;
  let bestArea = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [neighborId, borderLength] of neighbors) {
    const neighbor = regions[neighborId];
    if (neighbor == null) {
      continue;
    }

    const distance = paletteLabDistance(paletteLab, region.colorIndex, neighbor.colorIndex);
    if (region.area > TINY_HARD_EDGE_MERGE_MAX_AREA && distance > HARD_EDGE_PROTECTION_LAB_DISTANCE) {
      continue;
    }

    const candidatePenalty = candidateMask[neighborId] === 1 ? 1 : 0;
    if (candidatePenalty === 1 && neighbor.area <= region.area) {
      continue;
    }

    const isBetter =
      candidatePenalty < bestCandidatePenalty ||
      (candidatePenalty === bestCandidatePenalty && borderLength > bestBorder) ||
      (candidatePenalty === bestCandidatePenalty && borderLength === bestBorder && neighbor.area > bestArea) ||
      (candidatePenalty === bestCandidatePenalty &&
        borderLength === bestBorder &&
        neighbor.area === bestArea &&
        distance < bestDistance) ||
      (candidatePenalty === bestCandidatePenalty &&
        borderLength === bestBorder &&
        neighbor.area === bestArea &&
        distance === bestDistance &&
        neighborId < bestTarget);

    if (isBetter) {
      bestTarget = neighborId;
      bestCandidatePenalty = candidatePenalty;
      bestBorder = borderLength;
      bestArea = neighbor.area;
      bestDistance = distance;
    }
  }

  return bestTarget;
}

function chooseMaxFaceletMergeTarget(
  region: RegionInfo,
  regions: RegionInfo[],
  adjacency: Map<number, Map<number, number>>,
  candidateMask: Uint8Array,
  paletteLab: Float32Array,
): number {
  const neighbors = adjacency.get(region.id);
  if (neighbors == null || neighbors.size === 0) {
    return -1;
  }

  let bestTarget = -1;
  let bestCandidatePenalty = Number.POSITIVE_INFINITY;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestArea = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  function visitNeighbor(neighborId: number, borderLength: number, allowCandidateTarget: boolean): void {
    const neighbor = regions[neighborId];
    if (neighbor == null) {
      return;
    }

    const candidatePenalty = candidateMask[neighborId] === 1 ? 1 : 0;
    if (!allowCandidateTarget && candidatePenalty === 1 && neighbor.area <= region.area) {
      return;
    }

    const distance = paletteLabDistance(paletteLab, region.colorIndex, neighbor.colorIndex);
    if (region.area > TINY_HARD_EDGE_MERGE_MAX_AREA && distance > MAX_FACELET_MERGE_LAB_DISTANCE) {
      return;
    }

    const score = borderLength * 12 + Math.log2(Math.max(2, neighbor.area)) * 4 - distance * 2.5;
    const isBetter =
      candidatePenalty < bestCandidatePenalty ||
      (candidatePenalty === bestCandidatePenalty && score > bestScore) ||
      (candidatePenalty === bestCandidatePenalty && score === bestScore && neighbor.area > bestArea) ||
      (candidatePenalty === bestCandidatePenalty && score === bestScore && neighbor.area === bestArea && distance < bestDistance) ||
      (candidatePenalty === bestCandidatePenalty &&
        score === bestScore &&
        neighbor.area === bestArea &&
        distance === bestDistance &&
        neighborId < bestTarget);

    if (isBetter) {
      bestTarget = neighborId;
      bestCandidatePenalty = candidatePenalty;
      bestScore = score;
      bestArea = neighbor.area;
      bestDistance = distance;
    }
  }

  for (const [neighborId, borderLength] of neighbors) {
    visitNeighbor(neighborId, borderLength, false);
  }

  if (bestTarget < 0) {
    for (const [neighborId, borderLength] of neighbors) {
      visitNeighbor(neighborId, borderLength, true);
    }
  }

  return bestTarget;
}

function buildMaxFaceletCandidateWindow(regions: RegionInfo[], targetFacelets: number): RegionInfo[] {
  const excess = regions.length - targetFacelets;
  if (excess <= 0) {
    return [];
  }

  const extraCandidateCount = Math.max(
    MAX_FACELET_REDUCTION_MIN_EXTRA_CANDIDATES,
    Math.ceil(excess * MAX_FACELET_REDUCTION_EXTRA_CANDIDATES),
  );
  return regions
    .slice()
    .sort((left, right) => left.area - right.area || left.id - right.id)
    .slice(0, Math.min(regions.length - 1, excess + extraCandidateCount));
}

function resolveMergeTarget(targets: Int32Array, regionId: number): number {
  let current = regionId;
  let guard = 0;
  while (current >= 0 && current < targets.length && targets[current] >= 0 && guard < targets.length) {
    current = targets[current];
    guard += 1;
  }
  return current;
}

function applyMergeTargets(
  labelMap: Int32Array,
  regionMap: Int32Array,
  regions: RegionInfo[],
  targets: Int32Array,
): Int32Array {
  const regionToLabel = new Int32Array(regions.length);
  for (const region of regions) {
    const targetId = resolveMergeTarget(targets, region.id);
    const targetRegion = regions[targetId] ?? region;
    regionToLabel[region.id] = targetRegion.colorIndex;
  }

  const next = new Int32Array(labelMap.length);
  for (let index = 0; index < labelMap.length; index += 1) {
    const regionId = regionMap[index];
    next[index] = regionId >= 0 ? regionToLabel[regionId] : -1;
  }
  return next;
}

async function mergeSmallAndThinRegions(raster: RasterData, minRegionArea: number, report: RasterReport): Promise<RasterData> {
  let current = raster;

  for (let pass = 0; pass < SMALL_REGION_MAX_PASSES; pass += 1) {
    const paletteLab = computePaletteLab(current.paletteRgb);
    const connected = findConnectedRegions(current.labelMap, current.width, current.height);
    const candidateMask = buildCandidateMask(connected.regions, minRegionArea);
    let candidateCount = 0;
    for (const value of candidateMask) {
      if (value === 1) {
        candidateCount += 1;
      }
    }

    report('facetBuild', (pass + 0.2) / SMALL_REGION_MAX_PASSES, `${connected.regions.length} Regionen erkannt.`);
    if (candidateCount === 0) {
      return current;
    }

    const adjacency = buildRegionAdjacency(connected.regionMap, current.width, current.height);
    const targets = new Int32Array(connected.regions.length);
    targets.fill(-1);
    const candidateRegions = connected.regions
      .filter((region) => candidateMask[region.id] === 1)
      .sort((left, right) => left.area - right.area || left.id - right.id);

    let mergeCount = 0;
    for (const region of candidateRegions) {
      const target = chooseMergeTarget(region, connected.regions, adjacency, candidateMask, paletteLab);
      if (target >= 0) {
        targets[region.id] = target;
        mergeCount += 1;
      }
    }

    report(
      'facetReduce',
      (pass + 0.65) / SMALL_REGION_MAX_PASSES,
      `${mergeCount} kleine oder schmale Regionen zusammengeführt.`,
    );

    if (mergeCount === 0) {
      return current;
    }

    current = compactLabels({
      ...current,
      labelMap: applyMergeTargets(current.labelMap, connected.regionMap, connected.regions, targets),
    });
    await nowYield();
  }

  return current;
}

async function limitMaximumFacelets(
  raster: RasterData,
  maxFacelets: number,
  report: RasterReport,
): Promise<{ raster: RasterData; connected: ConnectedRegions }> {
  let current = raster;
  let connected = findConnectedRegions(current.labelMap, current.width, current.height);
  if (maxFacelets <= 0) {
    return { raster: current, connected };
  }

  const targetFacelets = Math.max(1, Math.floor(maxFacelets));
  if (connected.regions.length <= targetFacelets) {
    return { raster: current, connected };
  }

  const initialRegionCount = connected.regions.length;
  let pass = 0;
  while (connected.regions.length > targetFacelets && pass < MAX_FACELET_REDUCTION_MAX_PASSES) {
    const paletteLab = computePaletteLab(current.paletteRgb);
    const excess = connected.regions.length - targetFacelets;
    const adjacency = buildRegionAdjacency(connected.regionMap, current.width, current.height);
    const candidates = buildMaxFaceletCandidateWindow(connected.regions, targetFacelets);
    const candidateMask = new Uint8Array(connected.regions.length);
    for (const candidate of candidates) {
      candidateMask[candidate.id] = 1;
    }

    const targets = new Int32Array(connected.regions.length);
    targets.fill(-1);
    let mergeCount = 0;
    for (const region of candidates) {
      if (mergeCount >= excess) {
        break;
      }
      const target = chooseMaxFaceletMergeTarget(region, connected.regions, adjacency, candidateMask, paletteLab);
      if (target >= 0 && resolveMergeTarget(targets, target) !== region.id) {
        targets[region.id] = target;
        mergeCount += 1;
      }
    }

    if (mergeCount === 0) {
      break;
    }

    current = compactLabels({
      ...current,
      labelMap: applyMergeTargets(current.labelMap, connected.regionMap, connected.regions, targets),
    });
    connected = findConnectedRegions(current.labelMap, current.width, current.height);
    pass += 1;
    const totalReductionNeeded = Math.max(1, initialRegionCount - targetFacelets);
    const reducedCount = Math.max(0, initialRegionCount - connected.regions.length);
    report(
      'facetReduce',
      Math.min(1, 0.72 + reducedCount / totalReductionNeeded * 0.26),
      `${connected.regions.length} Flächen übrig, Ziel ${targetFacelets} ohne harte Farbkanten zu mischen.`,
    );
    await nowYield();
  }

  return { raster: current, connected };
}

function buildBoundaryMask(regionMap: Int32Array, width: number, height: number): Uint8Array {
  const boundary = new Uint8Array(regionMap.length);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x;
      const regionId = regionMap[index];
      if (x + 1 < width && regionMap[index + 1] !== regionId) {
        boundary[index] = 1;
        boundary[index + 1] = 1;
      }
      if (y + 1 < height && regionMap[index + width] !== regionId) {
        boundary[index] = 1;
        boundary[index + width] = 1;
      }
    }
  }
  return boundary;
}

function pointKey(x: number, y: number): string {
  return `${x},${y}`;
}

function parsePointKey(key: string): Point {
  const commaIndex = key.indexOf(',');
  return {
    x: Number(key.slice(0, commaIndex)),
    y: Number(key.slice(commaIndex + 1)),
  };
}

function addDirectedEdge(edgesByStart: Map<string, string[]>, startX: number, startY: number, endX: number, endY: number): void {
  const start = pointKey(startX, startY);
  const end = pointKey(endX, endY);
  const edges = edgesByStart.get(start);
  if (edges == null) {
    edgesByStart.set(start, [end]);
    return;
  }
  edges.push(end);
}

function traceRegionLoops(region: RegionInfo, regionMap: Int32Array, width: number, height: number): Point[][] {
  const edgesByStart = new Map<string, string[]>();

  for (let y = region.minY; y <= region.maxY; y += 1) {
    const rowOffset = y * width;
    for (let x = region.minX; x <= region.maxX; x += 1) {
      const index = rowOffset + x;
      if (regionMap[index] !== region.id) {
        continue;
      }

      if (y === 0 || regionMap[index - width] !== region.id) {
        addDirectedEdge(edgesByStart, x, y, x + 1, y);
      }
      if (x === width - 1 || regionMap[index + 1] !== region.id) {
        addDirectedEdge(edgesByStart, x + 1, y, x + 1, y + 1);
      }
      if (y === height - 1 || regionMap[index + width] !== region.id) {
        addDirectedEdge(edgesByStart, x + 1, y + 1, x, y + 1);
      }
      if (x === 0 || regionMap[index - 1] !== region.id) {
        addDirectedEdge(edgesByStart, x, y + 1, x, y);
      }
    }
  }

  const loops: Point[][] = [];
  while (edgesByStart.size > 0) {
    const firstStart = edgesByStart.keys().next().value as string | undefined;
    if (firstStart == null) {
      break;
    }

    const loop: Point[] = [parsePointKey(firstStart)];
    let current = firstStart;
    let guard = 0;

    while (guard < region.area * 8 + 16) {
      const edges = edgesByStart.get(current);
      if (edges == null || edges.length === 0) {
        edgesByStart.delete(current);
        break;
      }

      const next = edges.pop() as string;
      if (edges.length === 0) {
        edgesByStart.delete(current);
      }

      if (next === firstStart) {
        break;
      }

      loop.push(parsePointKey(next));
      current = next;
      guard += 1;
    }

    if (loop.length >= 3) {
      loops.push(loop);
    }
  }

  return loops;
}

function pointLineDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const projectedX = start.x + t * dx;
  const projectedY = start.y + t * dy;
  return Math.hypot(point.x - projectedX, point.y - projectedY);
}

function simplifyOpenPoints(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) {
    return points;
  }

  let maxDistance = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointLineDistance(points[index], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }

  if (maxDistance <= tolerance) {
    return [start, end];
  }

  const left = simplifyOpenPoints(points.slice(0, maxIndex + 1), tolerance);
  const right = simplifyOpenPoints(points.slice(maxIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function removeDuplicateAndCollinearPoints(points: Point[]): Point[] {
  const unique: Point[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (previous == null || previous.x !== point.x || previous.y !== point.y) {
      unique.push(point);
    }
  }

  if (unique.length <= 3) {
    return unique;
  }

  const reduced: Point[] = [];
  for (let index = 0; index < unique.length; index += 1) {
    const previous = unique[(index - 1 + unique.length) % unique.length];
    const current = unique[index];
    const next = unique[(index + 1) % unique.length];
    const dx1 = current.x - previous.x;
    const dy1 = current.y - previous.y;
    const dx2 = next.x - current.x;
    const dy2 = next.y - current.y;
    if (dx1 * dy2 !== dy1 * dx2) {
      reduced.push(current);
    }
  }
  return reduced;
}

function simplifyClosedLoop(points: Point[]): Point[] {
  const reduced = removeDuplicateAndCollinearPoints(points);
  if (reduced.length <= 4) {
    return reduced;
  }

  const open = [...reduced, reduced[0]];
  const simplified = simplifyOpenPoints(open, SVG_PATH_SIMPLIFY_TOLERANCE);
  const withoutDuplicateClose = simplified.slice(0, -1);
  return withoutDuplicateClose.length >= 3 ? withoutDuplicateClose : reduced;
}

function loopToSmoothPath(points: Point[]): string {
  const simplified = simplifyClosedLoop(points);
  if (simplified.length === 0) {
    return '';
  }
  if (simplified.length < 3) {
    return `M ${simplified.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`;
  }

  const last = simplified[simplified.length - 1];
  const first = simplified[0];
  const startX = (last.x + first.x) / 2;
  const startY = (last.y + first.y) / 2;
  const parts = [`M ${startX.toFixed(2)} ${startY.toFixed(2)}`];

  for (let index = 0; index < simplified.length; index += 1) {
    const current = simplified[index];
    const next = simplified[(index + 1) % simplified.length];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    parts.push(`Q ${current.x.toFixed(2)} ${current.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`);
  }

  parts.push('Z');
  return parts.join(' ');
}

function buildSvgRegionPaths(connected: ConnectedRegions, width: number, height: number): SvgRegionPath[] {
  const paths: SvgRegionPath[] = [];
  const sortedRegions = [...connected.regions].sort((left, right) => right.area - left.area || left.id - right.id);
  for (const region of sortedRegions) {
    const loops = traceRegionLoops(region, connected.regionMap, width, height);
    const pathData = loops.map(loopToSmoothPath).filter((path) => path.length > 0).join(' ');
    if (pathData.length === 0) {
      continue;
    }
    paths.push({
      regionId: region.id,
      colorIndex: region.colorIndex,
      area: region.area,
      pathData,
    });
  }
  return paths;
}

function findRegionLabelPoint(region: RegionInfo, regionMap: Int32Array, width: number): LabelPlacement {
  const localWidth = region.maxX - region.minX + 3;
  const localHeight = region.maxY - region.minY + 3;
  const dist = new Int16Array(localWidth * localHeight);
  const large = 32000;

  for (let localY = 1; localY < localHeight - 1; localY += 1) {
    const y = region.minY + localY - 1;
    const localRowOffset = localY * localWidth;
    const sourceRowOffset = y * width;
    for (let localX = 1; localX < localWidth - 1; localX += 1) {
      const x = region.minX + localX - 1;
      dist[localRowOffset + localX] = regionMap[sourceRowOffset + x] === region.id ? large : 0;
    }
  }

  for (let y = 1; y < localHeight - 1; y += 1) {
    const rowOffset = y * localWidth;
    for (let x = 1; x < localWidth - 1; x += 1) {
      const index = rowOffset + x;
      if (dist[index] === 0) {
        continue;
      }
      let best = dist[index];
      best = Math.min(best, dist[index - 1] + 1);
      best = Math.min(best, dist[index - localWidth] + 1);
      best = Math.min(best, dist[index - localWidth - 1] + 1);
      best = Math.min(best, dist[index - localWidth + 1] + 1);
      dist[index] = best;
    }
  }

  let bestX = Math.floor(localWidth / 2);
  let bestY = Math.floor(localHeight / 2);
  let bestDistance = -1;
  for (let y = localHeight - 2; y >= 1; y -= 1) {
    const rowOffset = y * localWidth;
    for (let x = localWidth - 2; x >= 1; x -= 1) {
      const index = rowOffset + x;
      if (dist[index] === 0) {
        continue;
      }
      let best = dist[index];
      best = Math.min(best, dist[index + 1] + 1);
      best = Math.min(best, dist[index + localWidth] + 1);
      best = Math.min(best, dist[index + localWidth - 1] + 1);
      best = Math.min(best, dist[index + localWidth + 1] + 1);
      dist[index] = best;

      if (best > bestDistance) {
        bestDistance = best;
        bestX = x;
        bestY = y;
      }
    }
  }

  return {
    regionId: region.id,
    colorIndex: region.colorIndex,
    x: region.minX + bestX - 1,
    y: region.minY + bestY - 1,
    radius: Math.max(2, bestDistance),
  };
}

function computeLabelPlacements(
  connected: ConnectedRegions,
  width: number,
  minLabelArea: number,
): LabelPlacement[] {
  const placements: LabelPlacement[] = [];
  const sortedRegions = [...connected.regions].sort((left, right) => right.area - left.area || left.id - right.id);
  for (const region of sortedRegions) {
    if (region.area < minLabelArea) {
      continue;
    }
    placements.push(findRegionLabelPoint(region, connected.regionMap, width));
  }
  return placements;
}

function brightenColor(channel: number): number {
  return clampByte(255 - (255 - channel) * 0.2);
}

function debugRegionColor(regionId: number): [number, number, number] {
  const hash = Math.imul(regionId + 1, 1103515245) + 12345;
  return [
    70 + Math.abs(hash & 0xff) % 150,
    70 + Math.abs((hash >> 8) & 0xff) % 150,
    70 + Math.abs((hash >> 16) & 0xff) % 150,
  ];
}

function fillColorForPixel(
  config: RenderVariantConfig,
  label: number,
  regionId: number,
  paletteRgb: Uint8Array,
): [number, number, number] {
  if (config.fillMode === 'white' || label < 0) {
    return [WHITE_R, WHITE_G, WHITE_B];
  }

  if (config.fillMode === 'debug') {
    return debugRegionColor(regionId);
  }

  const paletteOffset = label * 3;
  if (config.fillMode === 'bright') {
    return [
      brightenColor(paletteRgb[paletteOffset]),
      brightenColor(paletteRgb[paletteOffset + 1]),
      brightenColor(paletteRgb[paletteOffset + 2]),
    ];
  }

  return [paletteRgb[paletteOffset], paletteRgb[paletteOffset + 1], paletteRgb[paletteOffset + 2]];
}

function paletteColorForLabel(label: number, paletteRgb: Uint8Array): [number, number, number] {
  if (label < 0) {
    return [WHITE_R, WHITE_G, WHITE_B];
  }
  const paletteOffset = label * 3;
  return [paletteRgb[paletteOffset], paletteRgb[paletteOffset + 1], paletteRgb[paletteOffset + 2]];
}

function strokeColorForPixel(
  config: RenderVariantConfig,
  label: number,
  fillColor: [number, number, number],
  paletteRgb: Uint8Array,
): [number, number, number] {
  if (config.strokeMode === 'black') {
    return [OUTLINE_R, OUTLINE_G, OUTLINE_B];
  }
  if (config.fillMode === 'color' || config.fillMode === 'debug') {
    return fillColor;
  }
  return paletteColorForLabel(label, paletteRgb);
}

function setPixel(data: Uint8Array, width: number, height: number, x: number, y: number, rgb: [number, number, number]): void {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }
  const offset = (y * width + x) * 4;
  data[offset] = rgb[0];
  data[offset + 1] = rgb[1];
  data[offset + 2] = rgb[2];
  data[offset + 3] = 255;
}

function drawFilledCircle(data: Uint8Array, width: number, height: number, cx: number, cy: number, radius: number, rgb: [number, number, number]): void {
  const radiusSquared = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radiusSquared) {
        setPixel(data, width, height, x, y, rgb);
      }
    }
  }
}

function drawCircleOutline(data: Uint8Array, width: number, height: number, cx: number, cy: number, radius: number): void {
  const outer = radius * radius;
  const inner = Math.max(0, (radius - 1.6) * (radius - 1.6));
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared <= outer && distanceSquared >= inner) {
        setPixel(data, width, height, x, y, [OUTLINE_R, OUTLINE_G, OUTLINE_B]);
      }
    }
  }
}

function drawDigitText(
  data: Uint8Array,
  width: number,
  height: number,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  rgb: [number, number, number],
): void {
  const digitWidth = 5;
  const digitHeight = 7;
  const gap = 1;
  const textColumns = text.length * digitWidth + Math.max(0, text.length - 1) * gap;
  const block = Math.max(1, Math.floor(Math.min((radius * 1.55) / textColumns, (radius * 1.45) / digitHeight)));
  const totalWidth = textColumns * block;
  const totalHeight = digitHeight * block;
  const startX = Math.round(cx - totalWidth / 2);
  const startY = Math.round(cy - totalHeight / 2);

  for (let digitIndex = 0; digitIndex < text.length; digitIndex += 1) {
    const pattern = DIGIT_PATTERNS[text[digitIndex]];
    if (pattern == null) {
      continue;
    }
    const digitStartX = startX + digitIndex * (digitWidth + gap) * block;
    for (let row = 0; row < digitHeight; row += 1) {
      for (let col = 0; col < digitWidth; col += 1) {
        if (pattern[row][col] !== '1') {
          continue;
        }
        for (let yy = 0; yy < block; yy += 1) {
          for (let xx = 0; xx < block; xx += 1) {
            setPixel(data, width, height, digitStartX + col * block + xx, startY + row * block + yy, rgb);
          }
        }
      }
    }
  }
}

function fillPixelBlock(
  data: Uint8Array,
  outputWidth: number,
  outputHeight: number,
  x: number,
  y: number,
  scale: number,
  rgb: [number, number, number],
): void {
  const startX = x * scale;
  const startY = y * scale;
  for (let yy = 0; yy < scale; yy += 1) {
    const pixelY = startY + yy;
    if (pixelY < 0 || pixelY >= outputHeight) {
      continue;
    }
    for (let xx = 0; xx < scale; xx += 1) {
      const pixelX = startX + xx;
      if (pixelX < 0 || pixelX >= outputWidth) {
        continue;
      }
      const offset = (pixelY * outputWidth + pixelX) * 4;
      data[offset] = rgb[0];
      data[offset + 1] = rgb[1];
      data[offset + 2] = rgb[2];
      data[offset + 3] = 255;
    }
  }
}

async function renderTemplatePngBase64(
  raster: RasterData,
  connected: ConnectedRegions,
  placements: LabelPlacement[],
  config: RenderVariantConfig,
): Promise<{ base64: string; width: number; height: number }> {
  const { encode } = await import('fast-png');
  const { width, height, labelMap, paletteRgb } = raster;
  const outputWidth = width * EXPORT_SCALE;
  const outputHeight = height * EXPORT_SCALE;
  const boundary = buildBoundaryMask(connected.regionMap, width, height);
  const data = new Uint8Array(outputWidth * outputHeight * 4);

  for (let index = 0; index < labelMap.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const label = labelMap[index];
    const fillColor = fillColorForPixel(config, label, connected.regionMap[index], paletteRgb);
    if (boundary[index] === 1) {
      fillPixelBlock(data, outputWidth, outputHeight, x, y, EXPORT_SCALE, strokeColorForPixel(config, label, fillColor, paletteRgb));
      continue;
    }

    fillPixelBlock(data, outputWidth, outputHeight, x, y, EXPORT_SCALE, fillColor);
  }

  if (config.markerMode !== 'none') {
    for (const placement of placements) {
      const paletteOffset = placement.colorIndex * 3;
      const circleColor: [number, number, number] = [
        paletteRgb[paletteOffset],
        paletteRgb[paletteOffset + 1],
        paletteRgb[paletteOffset + 2],
      ];
      const labelText = String(placement.colorIndex + 1);
      const minTextRadius = Math.max(5, labelText.length * 3 + 3);
      const circleRadius = Math.max(4, Math.min(Math.max(minTextRadius, 8), Math.floor(placement.radius * 0.88))) * EXPORT_SCALE;
      const markerX = placement.x * EXPORT_SCALE + Math.floor(EXPORT_SCALE / 2);
      const markerY = placement.y * EXPORT_SCALE + Math.floor(EXPORT_SCALE / 2);
      const luminance = circleColor[0] * 0.299 + circleColor[1] * 0.587 + circleColor[2] * 0.114;
      const textColor: [number, number, number] = luminance > 145 ? [OUTLINE_R, OUTLINE_G, OUTLINE_B] : [255, 255, 255];

      if (config.markerMode === 'numberedCircles' || config.markerMode === 'circlesOnly') {
        drawFilledCircle(data, outputWidth, outputHeight, markerX, markerY, circleRadius, circleColor);
        drawCircleOutline(data, outputWidth, outputHeight, markerX, markerY, circleRadius);
      }

      if (config.markerMode === 'numberedCircles') {
        drawDigitText(data, outputWidth, outputHeight, labelText, markerX, markerY, circleRadius, textColor);
      } else if (config.markerMode === 'numbersOnly') {
        drawDigitText(data, outputWidth, outputHeight, labelText, markerX, markerY, circleRadius, [OUTLINE_R, OUTLINE_G, OUTLINE_B]);
      }
    }
  }

  const bytes = encode({
    width: outputWidth,
    height: outputHeight,
    data,
    depth: 8,
    channels: 4,
  });
  return {
    base64: uint8ToBase64(bytes),
    width: outputWidth,
    height: outputHeight,
  };
}

function createEmbeddedPngSvg(previewPngBase64: string, width: number, height: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<image href="data:image/png;base64,${previewPngBase64}" width="${width}" height="${height}" />`,
    '</svg>',
  ].join('');
}

function rgbCss(rgb: [number, number, number]): string {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderVectorSvg(
  raster: RasterData,
  connected: ConnectedRegions,
  placements: LabelPlacement[],
  svgPaths: SvgRegionPath[],
  config: RenderVariantConfig,
): string {
  const { width, height, paletteRgb } = raster;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="rgb(255,255,255)" />',
    '<g class="regions" fill-rule="evenodd">',
  ];

  for (const regionPath of svgPaths) {
    const fillColor = fillColorForPixel(config, regionPath.colorIndex, regionPath.regionId, paletteRgb);
    const strokeColor = strokeColorForPixel(config, regionPath.colorIndex, fillColor, paletteRgb);
    const strokeWidth = config.strokeMode === 'black' ? 0.65 : config.fillMode === 'white' ? 0.95 : 0.75;
    parts.push(
      `<path d="${regionPath.pathData}" fill="${rgbCss(fillColor)}" stroke="${rgbCss(strokeColor)}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" />`,
    );
  }
  parts.push('</g>');

  if (config.markerMode !== 'none') {
    parts.push('<g class="markers" font-family="Arial, Helvetica, sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central">');
    for (const placement of placements) {
      const paletteOffset = placement.colorIndex * 3;
      const circleColor: [number, number, number] = [
        paletteRgb[paletteOffset],
        paletteRgb[paletteOffset + 1],
        paletteRgb[paletteOffset + 2],
      ];
      const labelText = String(placement.colorIndex + 1);
      const minTextRadius = Math.max(5, labelText.length * 3 + 3);
      const circleRadius = Math.max(4, Math.min(Math.max(minTextRadius, 8), placement.radius * 0.88));
      const luminance = circleColor[0] * 0.299 + circleColor[1] * 0.587 + circleColor[2] * 0.114;
      const textColor: [number, number, number] = luminance > 145 ? [OUTLINE_R, OUTLINE_G, OUTLINE_B] : [255, 255, 255];
      const fontSize = Math.max(4, Math.min(circleRadius * 1.24, (circleRadius * 2.1) / Math.max(1, labelText.length * 0.72)));

      if (config.markerMode === 'numberedCircles' || config.markerMode === 'circlesOnly') {
        parts.push(
          `<circle cx="${placement.x}" cy="${placement.y}" r="${circleRadius.toFixed(2)}" fill="${rgbCss(circleColor)}" stroke="${rgbCss([OUTLINE_R, OUTLINE_G, OUTLINE_B])}" stroke-width="0.65" />`,
        );
      }

      if (config.markerMode === 'numberedCircles') {
        parts.push(
          `<text x="${placement.x}" y="${placement.y}" font-size="${fontSize.toFixed(2)}" fill="${rgbCss(textColor)}">${escapeXml(labelText)}</text>`,
        );
      } else if (config.markerMode === 'numbersOnly') {
        parts.push(
          `<text x="${placement.x}" y="${placement.y}" font-size="${fontSize.toFixed(2)}" fill="${rgbCss([OUTLINE_R, OUTLINE_G, OUTLINE_B])}">${escapeXml(labelText)}</text>`,
        );
      }
    }
    parts.push('</g>');
  }

  parts.push('</svg>');
  return parts.join('');
}

function buildPaletteStats(labelMap: Int32Array, paletteRgb: Uint8Array): PaletteStat[] {
  const colorCount = paletteRgb.length / 3;
  const counts = new Int32Array(colorCount);
  let totalPixels = 0;

  for (const label of labelMap) {
    if (label >= 0 && label < colorCount) {
      counts[label] += 1;
      totalPixels += 1;
    }
  }

  const stats: PaletteStat[] = [];
  for (let index = 0; index < colorCount; index += 1) {
    if (counts[index] === 0) {
      continue;
    }
    const offset = index * 3;
    const color: RGB = [paletteRgb[offset], paletteRgb[offset + 1], paletteRgb[offset + 2]];
    stats.push({
      index: index + 1,
      color,
      frequency: counts[index],
      areaPercentage: totalPixels > 0 ? counts[index] / totalPixels : 0,
    });
  }

  return stats.sort((left, right) => right.frequency - left.frequency || left.index - right.index);
}

export async function buildRasterPaintByNumbers(
  colorMapResult: ColorMapResult,
  settings: GeneratorSettings,
  options: RasterPipelineOptions,
): Promise<RasterPaintByNumbersResult> {
  let started = options.nowMs();
  let raster = colorMapToRaster(colorMapResult);
  options.report('narrowCleanup', 0, 'Schmale Streifen werden geglättet.');
  raster = cleanupNarrowPixelStrips(raster, Math.max(1, settings.narrowPixelStripCleanupRuns + 4), (run, runs, changedPixels) => {
    options.report('narrowCleanup', run / runs, `${changedPixels} Streifen-Pixel geglättet.`);
  });
  raster = compactLabels(raster);
  options.addTiming('narrowCleanup', options.nowMs() - started);
  await nowYield();

  started = options.nowMs();
  options.report('borderSegment', 0, 'Dünne Ausläufer werden bereinigt.');
  raster = pruneWeakProtrusionPixels(raster, settings.nrOfTimesToHalveBorderSegments + 1);
  raster = compactLabels(raster);
  options.report('borderSegment', 1, 'Dünne Ausläufer bereinigt.');
  options.addTiming('borderSegment', options.nowMs() - started);
  await nowYield();

  const minRegionArea = Math.max(
    settings.removeFacetsSmallerThanNrOfPoints,
    Math.round(raster.width * raster.height * MIN_REGION_AREA_RATIO),
  );
  started = options.nowMs();
  options.report('facetBuild', 0, 'Regionen werden erkannt.');
  options.report('facetReduce', 0, `Regionen unter ${minRegionArea} Pixeln werden zusammengeführt.`);
  raster = await mergeSmallAndThinRegions(raster, minRegionArea, options.report);
  let connected = findConnectedRegions(raster.labelMap, raster.width, raster.height);
  if (settings.maximumNumberOfFacets > 0 && connected.regions.length > settings.maximumNumberOfFacets) {
    options.report(
      'facetReduce',
      0.72,
      `Zielwert ${settings.maximumNumberOfFacets} Flächen wird kontrastgeschützt vorbereitet.`,
    );
    const limited = await limitMaximumFacelets(raster, settings.maximumNumberOfFacets, options.report);
    raster = limited.raster;
    connected = limited.connected;
  }
  options.addTiming('facetBuild', (options.nowMs() - started) * 0.45);
  options.addTiming('facetReduce', (options.nowMs() - started) * 0.55);
  options.report('facetBuild', 1, `${connected.regions.length} ausmalbare Flächen erkannt.`);
  options.report('facetReduce', 1, 'Regionen zusammengeführt.');

  started = options.nowMs();
  options.report('borderTrace', 0, 'Grenzen werden berechnet.');
  buildBoundaryMask(connected.regionMap, raster.width, raster.height);
  options.addTiming('borderTrace', options.nowMs() - started);
  options.report('borderTrace', 1, 'Grenzen berechnet.');
  await nowYield();

  const minLabelArea = Math.max(minRegionArea, Math.round(raster.width * raster.height * MIN_LABEL_AREA_RATIO));
  started = options.nowMs();
  options.report('labelPlacement', 0, 'Zahlenpositionen werden gesetzt.');
  const placements = computeLabelPlacements(connected, raster.width, minLabelArea);
  options.addTiming('labelPlacement', options.nowMs() - started);
  options.report('labelPlacement', 1, `${placements.length} Zahlenpositionen gesetzt.`);
  await nowYield();

  started = options.nowMs();
  options.report('svgRender', 0, 'Ausgabevarianten werden gerendert.');
  const svgPaths = buildSvgRegionPaths(connected, raster.width, raster.height);
  const variants: GeneratorOutputVariant[] = [];
  for (let index = 0; index < RENDER_VARIANTS.length; index += 1) {
    const config = RENDER_VARIANTS[index];
    const renderedPng = await renderTemplatePngBase64(raster, connected, placements, config);
    const svg = renderVectorSvg(raster, connected, placements, svgPaths, config);
    variants.push({
      id: config.id,
      label: config.label,
      description: config.description,
      pngBase64: renderedPng.base64,
      pngWidth: renderedPng.width,
      pngHeight: renderedPng.height,
      pngByteLength: Math.ceil((renderedPng.base64.length * 3) / 4),
      svg,
      svgWidth: raster.width,
      svgHeight: raster.height,
      svgByteLength: svg.length,
      isDefault: config.isDefault,
    });
    options.report('svgRender', (index + 1) / RENDER_VARIANTS.length, `${config.label} gerendert.`);
    await nowYield();
  }
  const defaultVariant = variants.find((variant) => variant.isDefault) ?? variants[0];
  const previewPngBase64 = defaultVariant.pngBase64 ?? '';
  const previewPngWidth = defaultVariant.pngWidth;
  const previewPngHeight = defaultVariant.pngHeight;
  const svg = defaultVariant.svg ?? createEmbeddedPngSvg(previewPngBase64, previewPngWidth, previewPngHeight);
  options.addTiming('svgRender', options.nowMs() - started);
  options.report('svgRender', 1, 'Ausgabevarianten gerendert.');

  return {
    svg,
    previewPngBase64,
    previewPngWidth,
    previewPngHeight,
    variants,
    imageWidth: raster.width,
    imageHeight: raster.height,
    facetCount: connected.regions.length,
    palette: buildPaletteStats(raster.labelMap, raster.paletteRgb),
  };
}
