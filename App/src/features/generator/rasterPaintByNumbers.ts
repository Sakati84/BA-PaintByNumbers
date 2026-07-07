import { encode } from 'fast-png';

import type { ColorMapResult } from '../../vendor/paintbynumbersgenerator/colorreductionmanagement';
import type { RGB } from '../../vendor/paintbynumbersgenerator/common';
import { rgb2lab, rgbToHsl } from '../../vendor/paintbynumbersgenerator/lib/colorconversion';
import { uint8ToBase64 } from './base64';
import type {
  GeneratorDebugImage,
  GeneratorDebugMetric,
  GeneratorDebugParameter,
  GeneratorDebugStageSnapshot,
  GeneratorOutputVariant,
  GeneratorOutputVariantId,
  GeneratorSettings,
  GeneratorStage,
  PaletteStat,
} from './generatorTypes';
import { encodeRgbaDebugImage } from './debugSnapshots';

type RasterStage = Exclude<GeneratorStage, 'decode' | 'kmeans' | 'colorMap' | 'done'>;

type RasterReport = (stage: RasterStage, localProgress: number, message: string) => void;

type AddTiming = (stage: GeneratorStage, elapsedMs: number) => void;

type RasterPipelineOptions = {
  report: RasterReport;
  addTiming: AddTiming;
  nowMs: () => number;
  variantIds?: readonly GeneratorOutputVariantId[];
  debug?: {
    enabled: boolean;
    rerunFromStage?: GeneratorStage;
    cache?: RasterPipelineDebugCache | null;
    snapshots?: GeneratorDebugStageSnapshot[];
  };
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
  area: number;
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
  smoothLoops: Point[][];
};

type BoundaryPath = {
  colorIndex: number;
  points: Point[];
  closed: boolean;
  pathData: string;
};

type BoundaryEdge = {
  startKey: string;
  endKey: string;
  colorIndex: number;
};

export type RasterPipelineDebugCache = {
  colorMapRaster?: RasterData;
  afterNarrowCleanup?: RasterData;
  afterBorderSegment?: RasterData;
  beforeFacetReduce?: {
    raster: RasterData;
    connected: ConnectedRegions;
  };
  afterFacetReduce?: {
    raster: RasterData;
    connected: ConnectedRegions;
  };
  svgPaths?: SvgRegionPath[];
  boundaryPaths?: BoundaryPath[];
  placements?: LabelPlacement[];
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
  debugCache?: RasterPipelineDebugCache;
};

const HARD_EDGE_PROTECTION_LAB_DISTANCE = 26;
const TINY_HARD_EDGE_MERGE_MAX_AREA = 8;
const MIN_LABEL_AREA_RATIO = 0.0001;
const SMALL_REGION_MAX_PASSES = 3;
const SIMILAR_REGION_MAX_PASSES = 4;
const SIMILAR_REGION_MERGE_LAB_DISTANCE = 8.5;
const MAX_FACELET_REDUCTION_MAX_PASSES = 24;
const MAX_FACELET_REDUCTION_EXTRA_CANDIDATES = 0.35;
const MAX_FACELET_REDUCTION_MIN_EXTRA_CANDIDATES = 12;
const MAX_FACELET_MERGE_LAB_DISTANCE = 18;
const QUIET_REGION_MERGE_LAB_DISTANCE = 12;
const QUIET_REGION_MERGE_MAX_AREA_MULTIPLIER = 3.6;
const DETAIL_PROTECTION_LAB_DISTANCE = 24;
const DETAIL_PROTECTION_WEIGHTED_LAB_DISTANCE = 30;
const DETAIL_PROTECTION_MAX_AREA_MULTIPLIER = 3.2;
const DETAIL_PROTECTION_MIN_COMPACTNESS = 0.16;
const DETAIL_PROTECTION_MIN_BORDER_SHARE = 0.34;
const THIN_REGION_AREA_MULTIPLIER = 2;
const THIN_REGION_MAX_AVERAGE_THICKNESS = 5.5;
const THIN_REGION_SOFT_MERGE_LAB_DISTANCE = 34;
const PNG_OUTPUT_SCALE = 2;
const PNG_RENDER_SCALE = 3;
const SVG_PATH_SIMPLIFY_TOLERANCE = 1.45;
const SVG_PATH_SMALL_LOOP_SIMPLIFY_TOLERANCE = 0.95;
const SVG_PATH_SMOOTHING_MIN_PERIMETER = 18;
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

function labelPixelCounts(labelMap: Int32Array, colorCount: number): Int32Array {
  const counts = new Int32Array(colorCount);
  for (const label of labelMap) {
    if (label >= 0 && label < colorCount) {
      counts[label] += 1;
    }
  }
  return counts;
}

function countPresentLabels(counts: Int32Array): number {
  let present = 0;
  for (const count of counts) {
    if (count > 0) {
      present += 1;
    }
  }
  return present;
}

function canRemoveLabelPixel(counts: Int32Array, presentLabelCount: number, label: number, minPaletteColors: number): boolean {
  if (label < 0 || label >= counts.length) {
    return true;
  }
  return presentLabelCount > minPaletteColors || counts[label] > 1;
}

function moveLabelCount(counts: Int32Array, sourceLabel: number, targetLabel: number, presentLabelCount: number): number {
  let nextPresentLabelCount = presentLabelCount;
  if (sourceLabel >= 0 && sourceLabel < counts.length) {
    counts[sourceLabel] -= 1;
    if (counts[sourceLabel] === 0) {
      nextPresentLabelCount -= 1;
    }
  }
  if (targetLabel >= 0 && targetLabel < counts.length) {
    if (counts[targetLabel] === 0) {
      nextPresentLabelCount += 1;
    }
    counts[targetLabel] += 1;
  }
  return nextPresentLabelCount;
}

function cleanupNarrowPixelStrips(
  raster: RasterData,
  runs: number,
  minPaletteColors: number,
  report?: (run: number, runs: number, changedPixels: number) => void,
): RasterData {
  if (runs <= 0 || raster.width < 3 || raster.height < 3) {
    return raster;
  }

  const { width, height } = raster;
  const paletteLab = computePaletteLab(raster.paletteRgb);
  const colorCount = raster.paletteRgb.length / 3;
  let current = raster.labelMap;

  for (let run = 0; run < runs; run += 1) {
    const next = new Int32Array(current);
    const counts = labelPixelCounts(current, colorCount);
    let presentLabelCount = countPresentLabels(counts);
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
        const upLeft = current[index - width - 1];
        const upRight = current[index - width + 1];
        const downLeft = current[index + width - 1];
        const downRight = current[index + width + 1];

        let replacement = -1;
        let replacementStrength = -1;
        let bestDistance = Number.POSITIVE_INFINITY;

        const promote = (targetLabel: number): void => {
          if (
            targetLabel < 0 ||
            targetLabel === label ||
            !canRemoveLabelPixel(counts, presentLabelCount, label, minPaletteColors) ||
            !canReplaceLabel(paletteLab, label, targetLabel)
          ) {
            return;
          }
          const strength = counts[targetLabel] ?? 0;
          const distance = paletteLabDistance(paletteLab, label, targetLabel);
          if (strength > replacementStrength || (strength === replacementStrength && distance < bestDistance)) {
            replacement = targetLabel;
            replacementStrength = strength;
            bestDistance = distance;
          }
        };

        if (left === right && left !== label) promote(left);
        if (up === down && up !== label) promote(up);
        if (upLeft === downRight && upLeft !== label) promote(upLeft);
        if (upRight === downLeft && upRight !== label) promote(upRight);
        if (left === up && left === down && left !== label) promote(left);
        if (right === up && right === down && right !== label) promote(right);
        if (up === left && up === right && up !== label) promote(up);
        if (down === left && down === right && down !== label) promote(down);

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
              if (
                candidate === label ||
                !canRemoveLabelPixel(counts, presentLabelCount, label, minPaletteColors) ||
                !canReplaceLabel(paletteLab, label, candidate)
              ) {
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
          presentLabelCount = moveLabelCount(counts, label, replacement, presentLabelCount);
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

function pruneWeakProtrusionPixels(raster: RasterData, runs: number, minPaletteColors: number): RasterData {
  if (runs <= 0 || raster.width < 3 || raster.height < 3) {
    return raster;
  }

  const { width, height } = raster;
  const paletteLab = computePaletteLab(raster.paletteRgb);
  const colorCount = raster.paletteRgb.length / 3;
  let current = raster.labelMap;

  for (let run = 0; run < runs; run += 1) {
    const next = new Int32Array(current);
    const counts = labelPixelCounts(current, colorCount);
    let presentLabelCount = countPresentLabels(counts);
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
          if (
            candidate === label ||
            !canRemoveLabelPixel(counts, presentLabelCount, label, minPaletteColors) ||
            !canReplaceLabel(paletteLab, label, candidate)
          ) {
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
          presentLabelCount = moveLabelCount(counts, label, bestLabel, presentLabelCount);
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

function regionAverageThickness(region: RegionInfo): number {
  const bboxWidth = region.maxX - region.minX + 1;
  const bboxHeight = region.maxY - region.minY + 1;
  const longestSide = Math.max(bboxWidth, bboxHeight);
  if (longestSide <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return region.area / longestSide;
}

function regionCompactness(region: RegionInfo): number {
  const bboxWidth = region.maxX - region.minX + 1;
  const bboxHeight = region.maxY - region.minY + 1;
  const bboxArea = Math.max(1, bboxWidth * bboxHeight);
  return region.area / bboxArea;
}

function isThinRegion(region: RegionInfo, minRegionArea: number): boolean {
  return (
    region.area <= minRegionArea * THIN_REGION_AREA_MULTIPLIER &&
    regionAverageThickness(region) <= THIN_REGION_MAX_AVERAGE_THICKNESS
  );
}

type RegionAdjacencyStats = {
  totalBorder: number;
  strongestBorder: number;
  strongestBorderShare: number;
  nearestLabDistance: number;
  weightedLabDistance: number;
};

function regionAdjacencyStats(
  region: RegionInfo,
  regions: RegionInfo[],
  adjacency: Map<number, Map<number, number>>,
  paletteLab: Float32Array,
): RegionAdjacencyStats {
  const neighbors = adjacency.get(region.id);
  if (neighbors == null || neighbors.size === 0) {
    return {
      totalBorder: 0,
      strongestBorder: 0,
      strongestBorderShare: 0,
      nearestLabDistance: Number.POSITIVE_INFINITY,
      weightedLabDistance: Number.POSITIVE_INFINITY,
    };
  }

  let totalBorder = 0;
  let strongestBorder = 0;
  let nearestLabDistance = Number.POSITIVE_INFINITY;
  let weightedDistanceSum = 0;

  for (const [neighborId, borderLength] of neighbors) {
    const neighbor = regions[neighborId];
    if (neighbor == null) {
      continue;
    }
    const distance = paletteLabDistance(paletteLab, region.colorIndex, neighbor.colorIndex);
    totalBorder += borderLength;
    strongestBorder = Math.max(strongestBorder, borderLength);
    nearestLabDistance = Math.min(nearestLabDistance, distance);
    weightedDistanceSum += distance * borderLength;
  }

  return {
    totalBorder,
    strongestBorder,
    strongestBorderShare: totalBorder <= 0 ? 0 : strongestBorder / totalBorder,
    nearestLabDistance,
    weightedLabDistance: totalBorder <= 0 ? Number.POSITIVE_INFINITY : weightedDistanceSum / totalBorder,
  };
}

function isDetailProtectedRegion(
  region: RegionInfo,
  regions: RegionInfo[],
  adjacency: Map<number, Map<number, number>>,
  paletteLab: Float32Array,
  minRegionArea: number,
): boolean {
  if (
    region.area <= TINY_HARD_EDGE_MERGE_MAX_AREA ||
    region.area > minRegionArea * DETAIL_PROTECTION_MAX_AREA_MULTIPLIER ||
    isThinRegion(region, minRegionArea) ||
    regionCompactness(region) < DETAIL_PROTECTION_MIN_COMPACTNESS
  ) {
    return false;
  }

  const stats = regionAdjacencyStats(region, regions, adjacency, paletteLab);
  if (stats.totalBorder <= 0 || stats.strongestBorderShare < DETAIL_PROTECTION_MIN_BORDER_SHARE) {
    return false;
  }

  return (
    stats.nearestLabDistance >= DETAIL_PROTECTION_LAB_DISTANCE ||
    stats.weightedLabDistance >= DETAIL_PROTECTION_WEIGHTED_LAB_DISTANCE
  );
}

function isQuietMergeCandidate(
  region: RegionInfo,
  regions: RegionInfo[],
  adjacency: Map<number, Map<number, number>>,
  paletteLab: Float32Array,
  minRegionArea: number,
): boolean {
  if (region.area > minRegionArea * QUIET_REGION_MERGE_MAX_AREA_MULTIPLIER) {
    return false;
  }

  const stats = regionAdjacencyStats(region, regions, adjacency, paletteLab);
  return (
    stats.totalBorder > 0 &&
    stats.nearestLabDistance <= QUIET_REGION_MERGE_LAB_DISTANCE &&
    stats.strongestBorderShare >= DETAIL_PROTECTION_MIN_BORDER_SHARE
  );
}

function buildCandidateMask(
  regions: RegionInfo[],
  adjacency: Map<number, Map<number, number>>,
  paletteLab: Float32Array,
  minRegionArea: number,
): Uint8Array {
  const candidates = new Uint8Array(regions.length);
  for (const region of regions) {
    const isSmall = region.area < minRegionArea;
    const shouldMerge =
      isThinRegion(region, minRegionArea) ||
      isQuietMergeCandidate(region, regions, adjacency, paletteLab, minRegionArea);

    if (
      (isSmall || shouldMerge) &&
      !isDetailProtectedRegion(region, regions, adjacency, paletteLab, minRegionArea)
    ) {
      candidates[region.id] = 1;
    }
  }
  return candidates;
}

function countRegionsByColor(regions: RegionInfo[], colorCount: number): Int32Array {
  const counts = new Int32Array(colorCount);
  for (const region of regions) {
    if (region.colorIndex >= 0 && region.colorIndex < colorCount) {
      counts[region.colorIndex] += 1;
    }
  }
  return counts;
}

function canMergeRegionWithoutDroppingPaletteColor(
  region: RegionInfo,
  regionColorCounts: Int32Array,
  currentPaletteColors: number,
  minPaletteColors: number,
): boolean {
  if (region.colorIndex < 0 || region.colorIndex >= regionColorCounts.length) {
    return true;
  }
  return currentPaletteColors > minPaletteColors || regionColorCounts[region.colorIndex] > 1;
}

function chooseMergeTarget(
  region: RegionInfo,
  regions: RegionInfo[],
  adjacency: Map<number, Map<number, number>>,
  candidateMask: Uint8Array,
  paletteLab: Float32Array,
  minRegionArea: number,
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
  const regionStats = regionAdjacencyStats(region, regions, adjacency, paletteLab);
  const quietMerge = isQuietMergeCandidate(region, regions, adjacency, paletteLab, minRegionArea);

  for (const [neighborId, borderLength] of neighbors) {
    const neighbor = regions[neighborId];
    if (neighbor == null) {
      continue;
    }

    const distance = paletteLabDistance(paletteLab, region.colorIndex, neighbor.colorIndex);
    const distanceLimit =
      regionAverageThickness(region) <= THIN_REGION_MAX_AVERAGE_THICKNESS
        ? THIN_REGION_SOFT_MERGE_LAB_DISTANCE
        : quietMerge
          ? HARD_EDGE_PROTECTION_LAB_DISTANCE
        : HARD_EDGE_PROTECTION_LAB_DISTANCE;
    if (region.area > TINY_HARD_EDGE_MERGE_MAX_AREA && distance > distanceLimit) {
      continue;
    }

    const candidatePenalty = candidateMask[neighborId] === 1 ? 1 : 0;
    if (candidatePenalty === 1 && neighbor.area <= region.area) {
      continue;
    }

    const borderShare = regionStats.totalBorder <= 0 ? 0 : borderLength / regionStats.totalBorder;
    const score =
      borderLength * 10 +
      borderShare * 48 +
      Math.log2(Math.max(2, neighbor.area)) * 5 -
      distance * (quietMerge ? 4.5 : 3);
    const isBetter =
      candidatePenalty < bestCandidatePenalty ||
      (candidatePenalty === bestCandidatePenalty && score > bestScore) ||
      (candidatePenalty === bestCandidatePenalty && score === bestScore && neighbor.area > bestArea) ||
      (candidatePenalty === bestCandidatePenalty &&
        score === bestScore &&
        neighbor.area === bestArea &&
        distance < bestDistance) ||
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

  return bestTarget;
}

function chooseMaxFaceletMergeTarget(
  region: RegionInfo,
  regions: RegionInfo[],
  adjacency: Map<number, Map<number, number>>,
  candidateMask: Uint8Array,
  paletteLab: Float32Array,
  minRegionArea: number,
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
  const regionStats = regionAdjacencyStats(region, regions, adjacency, paletteLab);
  const quietMerge = isQuietMergeCandidate(region, regions, adjacency, paletteLab, minRegionArea);

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
    const distanceLimit = quietMerge ? HARD_EDGE_PROTECTION_LAB_DISTANCE : MAX_FACELET_MERGE_LAB_DISTANCE;
    if (region.area > TINY_HARD_EDGE_MERGE_MAX_AREA && distance > distanceLimit) {
      return;
    }

    const borderShare = regionStats.totalBorder <= 0 ? 0 : borderLength / regionStats.totalBorder;
    const score =
      borderLength * 14 +
      borderShare * 44 +
      Math.log2(Math.max(2, neighbor.area)) * 4 -
      distance * (quietMerge ? 4.2 : 2.8);
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

function maxFaceletMergePriority(
  region: RegionInfo,
  regions: RegionInfo[],
  adjacency: Map<number, Map<number, number>>,
  paletteLab: Float32Array,
  minRegionArea: number,
): number {
  const stats = regionAdjacencyStats(region, regions, adjacency, paletteLab);
  const protectedPenalty = isDetailProtectedRegion(region, regions, adjacency, paletteLab, minRegionArea) ? 1_000_000 : 0;
  const quietBonus = isQuietMergeCandidate(region, regions, adjacency, paletteLab, minRegionArea) ? -minRegionArea * 1.5 : 0;
  const thinBonus = isThinRegion(region, minRegionArea) ? -minRegionArea : 0;
  const contrastPenalty = Number.isFinite(stats.nearestLabDistance) ? stats.nearestLabDistance * 10 : 0;
  const sharedBorderBonus = stats.strongestBorderShare * minRegionArea * 0.45;
  return protectedPenalty + region.area + contrastPenalty + quietBonus + thinBonus - sharedBorderBonus;
}

function buildMaxFaceletCandidateWindow(
  regions: RegionInfo[],
  adjacency: Map<number, Map<number, number>>,
  paletteLab: Float32Array,
  minRegionArea: number,
  targetFacelets: number,
): RegionInfo[] {
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
    .sort((left, right) => (
      maxFaceletMergePriority(left, regions, adjacency, paletteLab, minRegionArea) -
      maxFaceletMergePriority(right, regions, adjacency, paletteLab, minRegionArea)
    ) || left.area - right.area || left.id - right.id)
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

function chooseSimilarColorMergeTarget(
  region: RegionInfo,
  regions: RegionInfo[],
  adjacency: Map<number, Map<number, number>>,
  paletteLab: Float32Array,
): number {
  const neighbors = adjacency.get(region.id);
  if (neighbors == null || neighbors.size === 0) {
    return -1;
  }

  let bestTarget = -1;
  let bestBorder = -1;
  let bestArea = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [neighborId, borderLength] of neighbors) {
    const neighbor = regions[neighborId];
    if (neighbor == null || neighbor.colorIndex === region.colorIndex) {
      continue;
    }
    if (neighbor.area < region.area || (neighbor.area === region.area && neighbor.id > region.id)) {
      continue;
    }

    const distance = paletteLabDistance(paletteLab, region.colorIndex, neighbor.colorIndex);
    if (distance > SIMILAR_REGION_MERGE_LAB_DISTANCE) {
      continue;
    }

    const isBetter =
      borderLength > bestBorder ||
      (borderLength === bestBorder && neighbor.area > bestArea) ||
      (borderLength === bestBorder && neighbor.area === bestArea && distance < bestDistance) ||
      (borderLength === bestBorder &&
        neighbor.area === bestArea &&
        distance === bestDistance &&
        neighbor.id < bestTarget);

    if (isBetter) {
      bestTarget = neighbor.id;
      bestBorder = borderLength;
      bestArea = neighbor.area;
      bestDistance = distance;
    }
  }

  return bestTarget;
}

async function mergeSimilarAdjacentRegions(raster: RasterData, report: RasterReport): Promise<RasterData> {
  let current = raster;

  for (let pass = 0; pass < SIMILAR_REGION_MAX_PASSES; pass += 1) {
    const paletteLab = computePaletteLab(current.paletteRgb);
    const connected = findConnectedRegions(current.labelMap, current.width, current.height);
    const adjacency = buildRegionAdjacency(connected.regionMap, current.width, current.height);
    const targets = new Int32Array(connected.regions.length);
    targets.fill(-1);

    const regions = connected.regions
      .slice()
      .sort((left, right) => left.area - right.area || left.id - right.id);

    let mergeCount = 0;
    for (const region of regions) {
      const target = chooseSimilarColorMergeTarget(region, connected.regions, adjacency, paletteLab);
      if (target >= 0) {
        targets[region.id] = target;
        mergeCount += 1;
      }
    }

    report(
      'facetReduce',
      0.08 + (pass + 1) / SIMILAR_REGION_MAX_PASSES * 0.18,
      `${mergeCount} benachbarte Regionen mit sehr ähnlicher Farbe zusammengeführt.`,
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

async function mergeSmallAndThinRegions(
  raster: RasterData,
  minRegionArea: number,
  minPaletteColors: number,
  report: RasterReport,
): Promise<RasterData> {
  let current = raster;

  for (let pass = 0; pass < SMALL_REGION_MAX_PASSES; pass += 1) {
    const paletteLab = computePaletteLab(current.paletteRgb);
    const connected = findConnectedRegions(current.labelMap, current.width, current.height);
    const adjacency = buildRegionAdjacency(connected.regionMap, current.width, current.height);
    const candidateMask = buildCandidateMask(connected.regions, adjacency, paletteLab, minRegionArea);
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

    const targets = new Int32Array(connected.regions.length);
    targets.fill(-1);
    const regionColorCounts = countRegionsByColor(connected.regions, current.paletteRgb.length / 3);
    let currentPaletteColors = countPresentLabels(regionColorCounts);
    const candidateRegions = connected.regions
      .filter((region) => candidateMask[region.id] === 1)
      .sort((left, right) => left.area - right.area || left.id - right.id);

    let mergeCount = 0;
    for (const region of candidateRegions) {
      if (
        !canMergeRegionWithoutDroppingPaletteColor(
          region,
          regionColorCounts,
          currentPaletteColors,
          minPaletteColors,
        )
      ) {
        continue;
      }
      const target = chooseMergeTarget(region, connected.regions, adjacency, candidateMask, paletteLab, minRegionArea);
      if (target >= 0) {
        targets[region.id] = target;
        if (region.colorIndex >= 0 && region.colorIndex < regionColorCounts.length) {
          regionColorCounts[region.colorIndex] -= 1;
          if (regionColorCounts[region.colorIndex] === 0) {
            currentPaletteColors -= 1;
          }
        }
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
  minRegionArea: number,
  minPaletteColors: number,
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
    const candidates = buildMaxFaceletCandidateWindow(connected.regions, adjacency, paletteLab, minRegionArea, targetFacelets);
    const candidateMask = new Uint8Array(connected.regions.length);
    for (const candidate of candidates) {
      candidateMask[candidate.id] = 1;
    }

    const targets = new Int32Array(connected.regions.length);
    targets.fill(-1);
    const regionColorCounts = countRegionsByColor(connected.regions, current.paletteRgb.length / 3);
    let currentPaletteColors = countPresentLabels(regionColorCounts);
    let mergeCount = 0;
    for (const region of candidates) {
      if (mergeCount >= excess) {
        break;
      }
      if (
        !canMergeRegionWithoutDroppingPaletteColor(
          region,
          regionColorCounts,
          currentPaletteColors,
          minPaletteColors,
        )
      ) {
        continue;
      }
      const target = chooseMaxFaceletMergeTarget(region, connected.regions, adjacency, candidateMask, paletteLab, minRegionArea);
      if (target >= 0 && resolveMergeTarget(targets, target) !== region.id) {
        targets[region.id] = target;
        if (region.colorIndex >= 0 && region.colorIndex < regionColorCounts.length) {
          regionColorCounts[region.colorIndex] -= 1;
          if (regionColorCounts[region.colorIndex] === 0) {
            currentPaletteColors -= 1;
          }
        }
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

function removeDuplicateAndCollinearOpenPoints(points: Point[]): Point[] {
  const unique: Point[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (previous == null || previous.x !== point.x || previous.y !== point.y) {
      unique.push(point);
    }
  }

  if (unique.length <= 2) {
    return unique;
  }

  const reduced: Point[] = [unique[0]];
  for (let index = 1; index < unique.length - 1; index += 1) {
    const previous = reduced[reduced.length - 1];
    const current = unique[index];
    const next = unique[index + 1];
    const dx1 = current.x - previous.x;
    const dy1 = current.y - previous.y;
    const dx2 = next.x - current.x;
    const dy2 = next.y - current.y;
    if (dx1 * dy2 !== dy1 * dx2) {
      reduced.push(current);
    }
  }
  reduced.push(unique[unique.length - 1]);
  return reduced;
}

function loopPerimeter(points: Point[]): number {
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    perimeter += Math.hypot(next.x - point.x, next.y - point.y);
  }
  return perimeter;
}

function openPathLength(points: Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
  }
  return length;
}

function simplifyClosedLoop(points: Point[], tolerance: number): Point[] {
  const reduced = removeDuplicateAndCollinearPoints(points);
  if (reduced.length <= 4) {
    return reduced;
  }

  const open = [...reduced, reduced[0]];
  const simplified = simplifyOpenPoints(open, tolerance);
  const withoutDuplicateClose = simplified.slice(0, -1);
  return withoutDuplicateClose.length >= 3 ? withoutDuplicateClose : reduced;
}

function smoothClosedLoop(points: Point[], passes: number): Point[] {
  let current = points;
  for (let pass = 0; pass < passes; pass += 1) {
    if (current.length < 4) {
      return current;
    }

    const next: Point[] = [];
    for (let index = 0; index < current.length; index += 1) {
      const point = current[index];
      const following = current[(index + 1) % current.length];
      next.push({
        x: point.x * 0.75 + following.x * 0.25,
        y: point.y * 0.75 + following.y * 0.25,
      });
      next.push({
        x: point.x * 0.25 + following.x * 0.75,
        y: point.y * 0.25 + following.y * 0.75,
      });
    }
    current = next;
  }
  return current;
}

function smoothOpenPath(points: Point[], passes: number): Point[] {
  let current = points;
  for (let pass = 0; pass < passes; pass += 1) {
    if (current.length < 3) {
      return current;
    }

    const next: Point[] = [current[0]];
    for (let index = 0; index < current.length - 1; index += 1) {
      const point = current[index];
      const following = current[index + 1];
      next.push({
        x: point.x * 0.75 + following.x * 0.25,
        y: point.y * 0.75 + following.y * 0.25,
      });
      next.push({
        x: point.x * 0.25 + following.x * 0.75,
        y: point.y * 0.25 + following.y * 0.75,
      });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

function prepareSmoothLoop(points: Point[]): Point[] {
  const reduced = removeDuplicateAndCollinearPoints(points);
  if (reduced.length <= 4) {
    return reduced;
  }

  const perimeter = loopPerimeter(reduced);
  const tolerance = perimeter < SVG_PATH_SMOOTHING_MIN_PERIMETER * 2
    ? SVG_PATH_SMALL_LOOP_SIMPLIFY_TOLERANCE
    : SVG_PATH_SIMPLIFY_TOLERANCE;
  const simplified = simplifyClosedLoop(reduced, tolerance);
  if (simplified.length <= 4 || perimeter < SVG_PATH_SMOOTHING_MIN_PERIMETER) {
    return simplified;
  }

  const passes = perimeter > 80 && simplified.length >= 8 ? 2 : 1;
  return smoothClosedLoop(simplified, passes);
}

function prepareSmoothOpenPath(points: Point[]): Point[] {
  const reduced = removeDuplicateAndCollinearOpenPoints(points);
  if (reduced.length <= 2) {
    return reduced;
  }

  const length = openPathLength(reduced);
  const tolerance = length < SVG_PATH_SMOOTHING_MIN_PERIMETER * 2
    ? SVG_PATH_SMALL_LOOP_SIMPLIFY_TOLERANCE
    : SVG_PATH_SIMPLIFY_TOLERANCE;
  const simplified = simplifyOpenPoints(reduced, tolerance);
  if (simplified.length <= 2 || length < SVG_PATH_SMOOTHING_MIN_PERIMETER) {
    return simplified;
  }

  const passes = length > 80 && simplified.length >= 8 ? 2 : 1;
  return smoothOpenPath(simplified, passes);
}

function loopToSmoothPath(points: Point[]): string {
  if (points.length === 0) {
    return '';
  }
  if (points.length < 3) {
    return `M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`;
  }

  const last = points[points.length - 1];
  const first = points[0];
  const startX = (last.x + first.x) / 2;
  const startY = (last.y + first.y) / 2;
  const parts = [`M ${startX.toFixed(2)} ${startY.toFixed(2)}`];

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    parts.push(`Q ${current.x.toFixed(2)} ${current.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`);
  }

  parts.push('Z');
  return parts.join(' ');
}

function openPointsToPath(points: Point[]): string {
  if (points.length === 0) {
    return '';
  }
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
  }

  const parts = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    parts.push(`Q ${current.x.toFixed(2)} ${current.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`);
  }
  const last = points[points.length - 1];
  parts.push(`L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`);
  return parts.join(' ');
}

function buildSvgRegionPaths(connected: ConnectedRegions, width: number, height: number): SvgRegionPath[] {
  const paths: SvgRegionPath[] = [];
  const sortedRegions = [...connected.regions].sort((left, right) => right.area - left.area || left.id - right.id);
  for (const region of sortedRegions) {
    const loops = traceRegionLoops(region, connected.regionMap, width, height);
    const smoothLoops = loops
      .map(prepareSmoothLoop)
      .filter((loop) => loop.length >= 3);
    const pathData = smoothLoops.map(loopToSmoothPath).filter((path) => path.length > 0).join(' ');
    if (pathData.length === 0) {
      continue;
    }
    paths.push({
      regionId: region.id,
      colorIndex: region.colorIndex,
      area: region.area,
      pathData,
      smoothLoops,
    });
  }
  return paths;
}

function boundaryColorIndex(regionA: number, regionB: number, colorByRegionId: Map<number, number>): number {
  const colorA = colorByRegionId.get(regionA);
  const colorB = colorByRegionId.get(regionB);
  if (colorA == null) {
    return colorB ?? 0;
  }
  if (colorB == null) {
    return colorA;
  }
  return Math.min(colorA, colorB);
}

function addBoundaryEdge(
  edges: BoundaryEdge[],
  adjacency: Map<string, number[]>,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  colorIndex: number,
): void {
  const startKey = pointKey(startX, startY);
  const endKey = pointKey(endX, endY);
  const edgeIndex = edges.length;
  edges.push({ startKey, endKey, colorIndex });

  const startEdges = adjacency.get(startKey);
  if (startEdges == null) {
    adjacency.set(startKey, [edgeIndex]);
  } else {
    startEdges.push(edgeIndex);
  }

  const endEdges = adjacency.get(endKey);
  if (endEdges == null) {
    adjacency.set(endKey, [edgeIndex]);
  } else {
    endEdges.push(edgeIndex);
  }
}

function traceBoundaryChain(
  firstEdgeIndex: number,
  startKey: string,
  edges: BoundaryEdge[],
  adjacency: Map<string, number[]>,
  used: Uint8Array,
): { points: Point[]; closed: boolean; colorIndex: number } {
  const points: Point[] = [parsePointKey(startKey)];
  let currentKey = startKey;
  let edgeIndex = firstEdgeIndex;
  let colorIndex = edges[firstEdgeIndex].colorIndex;
  let guard = 0;

  while (guard < edges.length + 1) {
    if (used[edgeIndex] === 1) {
      break;
    }
    used[edgeIndex] = 1;
    const edge = edges[edgeIndex];
    colorIndex = edge.colorIndex;
    const nextKey = edge.startKey === currentKey ? edge.endKey : edge.startKey;
    points.push(parsePointKey(nextKey));
    currentKey = nextKey;

    const incident = adjacency.get(currentKey) ?? [];
    const unusedIncident = incident.filter((candidate) => used[candidate] === 0);
    if (unusedIncident.length === 0) {
      break;
    }
    if (currentKey === startKey) {
      break;
    }
    if (incident.length !== 2) {
      break;
    }

    edgeIndex = unusedIncident[0];
    guard += 1;
  }

  return {
    points,
    closed: currentKey === startKey,
    colorIndex,
  };
}

function buildBoundaryPaths(connected: ConnectedRegions, width: number, height: number): BoundaryPath[] {
  const colorByRegionId = new Map(connected.regions.map((region) => [region.id, region.colorIndex]));
  const edges: BoundaryEdge[] = [];
  const adjacency = new Map<string, number[]>();
  const { regionMap } = connected;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = rowOffset + x;
      const regionId = regionMap[index];
      const colorIndex = colorByRegionId.get(regionId) ?? 0;

      if (y === 0) {
        addBoundaryEdge(edges, adjacency, x, y, x + 1, y, colorIndex);
      }
      if (x === 0) {
        addBoundaryEdge(edges, adjacency, x, y + 1, x, y, colorIndex);
      }

      const rightRegionId = x === width - 1 ? -1 : regionMap[index + 1];
      if (rightRegionId !== regionId) {
        addBoundaryEdge(
          edges,
          adjacency,
          x + 1,
          y,
          x + 1,
          y + 1,
          boundaryColorIndex(regionId, rightRegionId, colorByRegionId),
        );
      }

      const bottomRegionId = y === height - 1 ? -1 : regionMap[index + width];
      if (bottomRegionId !== regionId) {
        addBoundaryEdge(
          edges,
          adjacency,
          x + 1,
          y + 1,
          x,
          y + 1,
          boundaryColorIndex(regionId, bottomRegionId, colorByRegionId),
        );
      }
    }
  }

  const used = new Uint8Array(edges.length);
  const paths: BoundaryPath[] = [];
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    if (used[edgeIndex] === 1) {
      continue;
    }

    const edge = edges[edgeIndex];
    const startDegree = adjacency.get(edge.startKey)?.length ?? 0;
    const endDegree = adjacency.get(edge.endKey)?.length ?? 0;
    const startKey = startDegree !== 2 || endDegree === 2 ? edge.startKey : edge.endKey;
    const traced = traceBoundaryChain(edgeIndex, startKey, edges, adjacency, used);
    const rawPoints = traced.closed && traced.points.length > 1
      ? traced.points.slice(0, -1)
      : traced.points;
    const smoothPoints = traced.closed
      ? prepareSmoothLoop(rawPoints)
      : prepareSmoothOpenPath(rawPoints);
    if (smoothPoints.length < (traced.closed ? 3 : 2)) {
      continue;
    }
    const pathData = traced.closed ? loopToSmoothPath(smoothPoints) : openPointsToPath(smoothPoints);
    if (pathData.length === 0) {
      continue;
    }
    paths.push({
      colorIndex: traced.colorIndex,
      points: smoothPoints,
      closed: traced.closed,
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
    area: region.area,
    x: region.minX + bestX - 1,
    y: region.minY + bestY - 1,
    radius: Math.max(1, bestDistance),
  };
}

function computeLabelPlacements(connected: ConnectedRegions, width: number): LabelPlacement[] {
  const placements: LabelPlacement[] = [];
  const sortedRegions = [...connected.regions].sort((left, right) => right.area - left.area || left.id - right.id);
  for (const region of sortedRegions) {
    placements.push(findRegionLabelPoint(region, connected.regionMap, width));
  }
  return placements;
}

function markerRadiusForPlacement(placement: LabelPlacement, labelText: string): number {
  const textRadius = Math.max(5, labelText.length * 3 + 3);
  const areaRadius = Math.sqrt(Math.max(1, placement.area) / Math.PI) * 0.72;
  const interiorRadius = Math.max(1, placement.radius * 0.88);
  const preferredRadius = Math.max(4, Math.min(10, textRadius));
  return Math.max(1.25, Math.min(preferredRadius, areaRadius, interiorRadius));
}

function shouldRenderMarkerText(circleRadius: number, labelText: string): boolean {
  return circleRadius >= Math.max(3.5, labelText.length * 1.6 + 1.5);
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

function strokeWidthForConfig(config: RenderVariantConfig): number {
  if (config.strokeMode === 'black') {
    return 0.85;
  }
  if (config.fillMode === 'white') {
    return 1.05;
  }
  return 0.85;
}

function quadraticPoint(start: Point, control: Point, end: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  };
}

function drawSmoothClosedLoopStroke(
  data: Uint8Array,
  width: number,
  height: number,
  loop: Point[],
  scale: number,
  radius: number,
  rgb: [number, number, number],
): void {
  if (loop.length < 3) {
    return;
  }

  const last = loop[loop.length - 1];
  const first = loop[0];
  let start: Point = {
    x: (last.x + first.x) / 2,
    y: (last.y + first.y) / 2,
  };

  for (let index = 0; index < loop.length; index += 1) {
    const control = loop[index];
    const next = loop[(index + 1) % loop.length];
    const end: Point = {
      x: (control.x + next.x) / 2,
      y: (control.y + next.y) / 2,
    };
    const approximateLength = Math.hypot(control.x - start.x, control.y - start.y) + Math.hypot(end.x - control.x, end.y - control.y);
    const steps = Math.max(3, Math.ceil((approximateLength * scale) / Math.max(0.65, radius * 0.72)));

    for (let step = 0; step <= steps; step += 1) {
      const point = quadraticPoint(start, control, end, step / steps);
      drawFilledCircle(data, width, height, point.x * scale, point.y * scale, radius, rgb);
    }

    start = end;
  }
}

function drawSmoothOpenPathStroke(
  data: Uint8Array,
  width: number,
  height: number,
  points: Point[],
  scale: number,
  radius: number,
  rgb: [number, number, number],
): void {
  if (points.length < 2) {
    return;
  }
  if (points.length === 2) {
    const start = points[0];
    const end = points[1];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(2, Math.ceil((length * scale) / Math.max(0.65, radius * 0.72)));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      drawFilledCircle(
        data,
        width,
        height,
        (start.x + (end.x - start.x) * t) * scale,
        (start.y + (end.y - start.y) * t) * scale,
        radius,
        rgb,
      );
    }
    return;
  }

  let start = points[0];
  for (let index = 1; index < points.length - 1; index += 1) {
    const control = points[index];
    const next = points[index + 1];
    const end: Point = {
      x: (control.x + next.x) / 2,
      y: (control.y + next.y) / 2,
    };
    const approximateLength = Math.hypot(control.x - start.x, control.y - start.y) + Math.hypot(end.x - control.x, end.y - control.y);
    const steps = Math.max(3, Math.ceil((approximateLength * scale) / Math.max(0.65, radius * 0.72)));
    for (let step = 0; step <= steps; step += 1) {
      const point = quadraticPoint(start, control, end, step / steps);
      drawFilledCircle(data, width, height, point.x * scale, point.y * scale, radius, rgb);
    }
    start = end;
  }

  const last = points[points.length - 1];
  const tailLength = Math.hypot(last.x - start.x, last.y - start.y);
  const tailSteps = Math.max(2, Math.ceil((tailLength * scale) / Math.max(0.65, radius * 0.72)));
  for (let step = 0; step <= tailSteps; step += 1) {
    const t = step / tailSteps;
    drawFilledCircle(
      data,
      width,
      height,
      (start.x + (last.x - start.x) * t) * scale,
      (start.y + (last.y - start.y) * t) * scale,
      radius,
      rgb,
    );
  }
}

function drawSmoothBoundaryLines(
  data: Uint8Array,
  width: number,
  height: number,
  raster: RasterData,
  boundaryPaths: BoundaryPath[],
  config: RenderVariantConfig,
  scale: number,
): void {
  const { paletteRgb } = raster;
  const radius = Math.max(0.75, (strokeWidthForConfig(config) * scale) / 2);

  for (const boundaryPath of boundaryPaths) {
    const fillColor = paletteColorForLabel(boundaryPath.colorIndex, paletteRgb);
    const strokeColor = strokeColorForPixel(config, boundaryPath.colorIndex, fillColor, paletteRgb);
    if (boundaryPath.closed) {
      drawSmoothClosedLoopStroke(data, width, height, boundaryPath.points, scale, radius, strokeColor);
    } else {
      drawSmoothOpenPathStroke(data, width, height, boundaryPath.points, scale, radius, strokeColor);
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

function downsampleRgba(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return source;
  }

  const target = new Uint8Array(targetWidth * targetHeight * 4);
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY0 = Math.floor(y * scaleY);
    const sourceY1 = Math.max(sourceY0 + 1, Math.ceil((y + 1) * scaleY));

    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX0 = Math.floor(x * scaleX);
      const sourceX1 = Math.max(sourceX0 + 1, Math.ceil((x + 1) * scaleX));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;

      for (let yy = sourceY0; yy < sourceY1 && yy < sourceHeight; yy += 1) {
        for (let xx = sourceX0; xx < sourceX1 && xx < sourceWidth; xx += 1) {
          const sourceOffset = (yy * sourceWidth + xx) * 4;
          red += source[sourceOffset];
          green += source[sourceOffset + 1];
          blue += source[sourceOffset + 2];
          alpha += source[sourceOffset + 3];
          count += 1;
        }
      }

      const targetOffset = (y * targetWidth + x) * 4;
      target[targetOffset] = Math.round(red / count);
      target[targetOffset + 1] = Math.round(green / count);
      target[targetOffset + 2] = Math.round(blue / count);
      target[targetOffset + 3] = Math.round(alpha / count);
    }
  }

  return target;
}

async function renderTemplatePngBase64(
  raster: RasterData,
  connected: ConnectedRegions,
  placements: LabelPlacement[],
  boundaryPaths: BoundaryPath[],
  config: RenderVariantConfig,
): Promise<{ base64: string; width: number; height: number }> {
  const { width, height, labelMap, paletteRgb } = raster;
  const renderScale = Math.max(PNG_OUTPUT_SCALE, PNG_RENDER_SCALE);
  const outputWidth = width * PNG_OUTPUT_SCALE;
  const outputHeight = height * PNG_OUTPUT_SCALE;
  const renderWidth = width * renderScale;
  const renderHeight = height * renderScale;
  const renderData = new Uint8Array(renderWidth * renderHeight * 4);

  for (let index = 0; index < labelMap.length; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const label = labelMap[index];
    const fillColor = fillColorForPixel(config, label, connected.regionMap[index], paletteRgb);
    fillPixelBlock(renderData, renderWidth, renderHeight, x, y, renderScale, fillColor);
  }

  drawSmoothBoundaryLines(renderData, renderWidth, renderHeight, raster, boundaryPaths, config, renderScale);

  if (config.markerMode !== 'none') {
    for (const placement of placements) {
      const paletteOffset = placement.colorIndex * 3;
      const circleColor: [number, number, number] = [
        paletteRgb[paletteOffset],
        paletteRgb[paletteOffset + 1],
        paletteRgb[paletteOffset + 2],
      ];
      const labelText = String(placement.colorIndex + 1);
      const circleRadius = markerRadiusForPlacement(placement, labelText) * renderScale;
      const markerX = placement.x * renderScale + Math.floor(renderScale / 2);
      const markerY = placement.y * renderScale + Math.floor(renderScale / 2);
      const luminance = circleColor[0] * 0.299 + circleColor[1] * 0.587 + circleColor[2] * 0.114;
      const textColor: [number, number, number] = luminance > 145 ? [OUTLINE_R, OUTLINE_G, OUTLINE_B] : [255, 255, 255];
      const canRenderText = shouldRenderMarkerText(circleRadius / renderScale, labelText);

      if (config.markerMode === 'numberedCircles' || config.markerMode === 'circlesOnly') {
        drawFilledCircle(renderData, renderWidth, renderHeight, markerX, markerY, circleRadius, circleColor);
        drawCircleOutline(renderData, renderWidth, renderHeight, markerX, markerY, circleRadius);
      }

      if (config.markerMode === 'numberedCircles' && canRenderText) {
        drawDigitText(renderData, renderWidth, renderHeight, labelText, markerX, markerY, circleRadius, textColor);
      } else if (config.markerMode === 'numbersOnly') {
        if (canRenderText) {
          drawDigitText(renderData, renderWidth, renderHeight, labelText, markerX, markerY, circleRadius, [OUTLINE_R, OUTLINE_G, OUTLINE_B]);
        } else {
          drawFilledCircle(renderData, renderWidth, renderHeight, markerX, markerY, Math.max(1.25, Math.min(circleRadius, 2.25 * renderScale)), [OUTLINE_R, OUTLINE_G, OUTLINE_B]);
        }
      }
    }
  }

  const outputData = downsampleRgba(renderData, renderWidth, renderHeight, outputWidth, outputHeight);
  const bytes = encode({
    width: outputWidth,
    height: outputHeight,
    data: outputData,
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
  placements: LabelPlacement[],
  svgPaths: SvgRegionPath[],
  boundaryPaths: BoundaryPath[],
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
    parts.push(`<path d="${regionPath.pathData}" fill="${rgbCss(fillColor)}" stroke="none" />`);
  }
  parts.push('</g>');

  const strokeWidth = strokeWidthForConfig(config);
  parts.push('<g class="boundaries" fill="none">');
  for (const boundaryPath of boundaryPaths) {
    const fillColor = paletteColorForLabel(boundaryPath.colorIndex, paletteRgb);
    const strokeColor = strokeColorForPixel(config, boundaryPath.colorIndex, fillColor, paletteRgb);
    parts.push(
      `<path d="${boundaryPath.pathData}" stroke="${rgbCss(strokeColor)}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" />`,
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
      const circleRadius = markerRadiusForPlacement(placement, labelText);
      const luminance = circleColor[0] * 0.299 + circleColor[1] * 0.587 + circleColor[2] * 0.114;
      const textColor: [number, number, number] = luminance > 145 ? [OUTLINE_R, OUTLINE_G, OUTLINE_B] : [255, 255, 255];
      const fontSize = Math.max(2.5, Math.min(circleRadius * 1.24, (circleRadius * 2.1) / Math.max(1, labelText.length * 0.72)));
      const canRenderText = shouldRenderMarkerText(circleRadius, labelText);

      if (config.markerMode === 'numberedCircles' || config.markerMode === 'circlesOnly') {
        parts.push(
          `<circle cx="${placement.x}" cy="${placement.y}" r="${circleRadius.toFixed(2)}" fill="${rgbCss(circleColor)}" stroke="${rgbCss([OUTLINE_R, OUTLINE_G, OUTLINE_B])}" stroke-width="0.65" />`,
        );
      }

      if (config.markerMode === 'numberedCircles' && canRenderText) {
        parts.push(
          `<text x="${placement.x}" y="${placement.y}" font-size="${fontSize.toFixed(2)}" fill="${rgbCss(textColor)}">${escapeXml(labelText)}</text>`,
        );
      } else if (config.markerMode === 'numbersOnly') {
        if (canRenderText) {
          parts.push(
            `<text x="${placement.x}" y="${placement.y}" font-size="${fontSize.toFixed(2)}" fill="${rgbCss([OUTLINE_R, OUTLINE_G, OUTLINE_B])}">${escapeXml(labelText)}</text>`,
          );
        } else {
          parts.push(
            `<circle cx="${placement.x}" cy="${placement.y}" r="${Math.max(1.25, Math.min(circleRadius, 2.25)).toFixed(2)}" fill="${rgbCss([OUTLINE_R, OUTLINE_G, OUTLINE_B])}" stroke="none" />`,
          );
        }
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

function cloneRaster(raster: RasterData): RasterData {
  return {
    width: raster.width,
    height: raster.height,
    labelMap: new Int32Array(raster.labelMap),
    paletteRgb: new Uint8Array(raster.paletteRgb),
  };
}

function cloneConnected(connected: ConnectedRegions): ConnectedRegions {
  return {
    regionMap: new Int32Array(connected.regionMap),
    regions: connected.regions.map((region) => ({ ...region })),
  };
}

function clonePlacements(placements: LabelPlacement[]): LabelPlacement[] {
  return placements.map((placement) => ({ ...placement }));
}

function cloneSvgPaths(paths: SvgRegionPath[]): SvgRegionPath[] {
  return paths.map((path) => ({
    ...path,
    smoothLoops: path.smoothLoops.map((loop) => loop.map((point) => ({ ...point }))),
  }));
}

function cloneBoundaryPaths(paths: BoundaryPath[]): BoundaryPath[] {
  return paths.map((path) => ({
    ...path,
    points: path.points.map((point) => ({ ...point })),
  }));
}

function stageIndex(stage: GeneratorStage): number {
  const order: GeneratorStage[] = [
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
    'done',
  ];
  const index = order.indexOf(stage);
  return index < 0 ? 0 : index;
}

function shouldUseCachedStage(options: RasterPipelineOptions, stage: GeneratorStage): boolean {
  const startStage = options.debug?.rerunFromStage;
  return options.debug?.enabled === true && startStage != null && stageIndex(stage) < stageIndex(startStage);
}

function debugNumberParameter(
  settings: GeneratorSettings,
  key: keyof GeneratorSettings,
  label: string,
  min: number,
  max: number,
  step: number,
  unit?: string,
  description?: string,
): GeneratorDebugParameter {
  return {
    key,
    label,
    value: Number(settings[key]),
    input: 'number',
    min,
    max,
    step,
    unit,
    description,
  };
}

function debugBooleanParameter(
  settings: GeneratorSettings,
  key: keyof GeneratorSettings,
  label: string,
  description?: string,
): GeneratorDebugParameter {
  return {
    key,
    label,
    value: Boolean(settings[key]),
    input: 'boolean',
    description,
  };
}

function rasterStageParameters(stage: GeneratorStage, settings: GeneratorSettings): GeneratorDebugParameter[] {
  if (stage === 'narrowCleanup') {
    return [
      debugNumberParameter(
        settings,
        'narrowPixelStripCleanupRuns',
        'Cleanup-Durchlaeufe',
        0,
        8,
        1,
        'Runs',
        'Anzahl der Durchlaeufe gegen einzelne Streifen- und Inselpixel.',
      ),
    ];
  }

  if (stage === 'borderSegment') {
    return [
      debugNumberParameter(
        settings,
        'nrOfTimesToHalveBorderSegments',
        'Protrusion-Pruning',
        0,
        8,
        1,
        'Runs',
        'Entfernt schwache einzelne Auslaeuferpixel an Farbkanten.',
      ),
    ];
  }

  if (stage === 'facetReduce') {
    return [
      debugNumberParameter(
        settings,
        'removeFacetsSmallerThanImageRatio',
        'Mindestflaeche',
        0,
        0.001,
        0.000005,
        'Bildanteil',
        'Regionen unterhalb dieses Bildanteils werden Merge-Kandidaten.',
      ),
      debugBooleanParameter(
        settings,
        'mergeSimilarAdjacentRegions',
        'Aehnliche Nachbarn mergen',
        'Fuehrt angrenzende Regionen mit sehr aehnlicher Farbe vor der Groessenreduktion zusammen.',
      ),
      debugNumberParameter(
        settings,
        'maximumNumberOfFacets',
        'Maximale Flaechen',
        0,
        12000,
        25,
        'Flaechen',
        '0 bedeutet kein hartes Flaechenlimit.',
      ),
    ];
  }

  return [];
}

async function renderRasterDebugImage(
  label: string,
  raster: RasterData,
  connected?: ConnectedRegions,
  placements?: LabelPlacement[],
  mode: 'color' | 'debugRegions' | 'boundaries' = 'color',
): Promise<GeneratorDebugImage> {
  const { width, height, labelMap, paletteRgb } = raster;
  const data = new Uint8Array(width * height * 4);

  for (let index = 0; index < labelMap.length; index += 1) {
    const labelIndex = labelMap[index];
    const regionId = connected?.regionMap[index] ?? -1;
    let rgb: [number, number, number];
    if (mode === 'debugRegions' && regionId >= 0) {
      rgb = debugRegionColor(regionId);
    } else {
      rgb = paletteColorForLabel(labelIndex, paletteRgb);
    }

    const offset = index * 4;
    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
    data[offset + 3] = 255;
  }

  if (connected != null && mode !== 'color') {
    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x += 1) {
        const index = rowOffset + x;
        const regionId = connected.regionMap[index];
        const isBoundary =
          (x + 1 < width && connected.regionMap[index + 1] !== regionId) ||
          (y + 1 < height && connected.regionMap[index + width] !== regionId) ||
          (x > 0 && connected.regionMap[index - 1] !== regionId) ||
          (y > 0 && connected.regionMap[index - width] !== regionId);
        if (isBoundary) {
          const offset = index * 4;
          data[offset] = OUTLINE_R;
          data[offset + 1] = OUTLINE_G;
          data[offset + 2] = OUTLINE_B;
        }
      }
    }
  }

  if (placements != null) {
    for (const placement of placements) {
      const radius = Math.max(2, Math.min(6, Math.round(placement.radius * 0.45)));
      drawFilledCircle(data, width, height, placement.x, placement.y, radius, [255, 255, 255]);
      drawCircleOutline(data, width, height, placement.x, placement.y, radius);
    }
  }

  return encodeRgbaDebugImage(label, width, height, data);
}

async function pushRasterDebugSnapshot(
  options: RasterPipelineOptions,
  stage: GeneratorStage,
  label: string,
  description: string,
  settings: GeneratorSettings,
  metrics: GeneratorDebugMetric[],
  image: GeneratorDebugImage | undefined,
  timingMs: number | undefined,
  cacheHit = false,
): Promise<void> {
  if (options.debug?.enabled !== true || options.debug.snapshots == null) {
    return;
  }

  options.debug.snapshots.push({
    stage,
    label,
    description,
    parameters: rasterStageParameters(stage, settings),
    metrics,
    image,
    timingMs,
    canRerunFromHere: stage !== 'svgRender',
    cacheHit,
  });
}

export async function buildRasterPaintByNumbers(
  colorMapResult: ColorMapResult,
  settings: GeneratorSettings,
  options: RasterPipelineOptions,
): Promise<RasterPaintByNumbersResult> {
  const targetPaletteColors = Math.max(1, Math.floor(settings.kMeansNrOfClusters));
  const previousCache = options.debug?.cache ?? null;
  const nextDebugCache: RasterPipelineDebugCache = {};
  let started = options.nowMs();
  let raster =
    shouldUseCachedStage(options, 'colorMap') && previousCache?.colorMapRaster != null
      ? cloneRaster(previousCache.colorMapRaster)
      : colorMapToRaster(colorMapResult);
  nextDebugCache.colorMapRaster = cloneRaster(raster);

  if (shouldUseCachedStage(options, 'narrowCleanup') && previousCache?.afterNarrowCleanup != null) {
    raster = cloneRaster(previousCache.afterNarrowCleanup);
    nextDebugCache.afterNarrowCleanup = cloneRaster(raster);
    options.addTiming('narrowCleanup', 0);
    options.report('narrowCleanup', 1, 'Schmale Streifen aus Debug-Cache übernommen.');
    await pushRasterDebugSnapshot(
      options,
      'narrowCleanup',
      'Narrow Cleanup',
      'Labelkarte nach optionaler Streifenbereinigung.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Palette', value: String(raster.paletteRgb.length / 3) },
      ],
      await renderRasterDebugImage('Narrow Cleanup', raster),
      0,
      true,
    );
  } else {
    options.report('narrowCleanup', 0, 'Schmale Streifen werden geglättet.');
    raster = cleanupNarrowPixelStrips(
      raster,
      Math.max(0, settings.narrowPixelStripCleanupRuns),
      targetPaletteColors,
      (run, runs, changedPixels) => {
        options.report('narrowCleanup', run / runs, `${changedPixels} Streifen-Pixel geglättet.`);
      },
    );
    raster = compactLabels(raster);
    const timingMs = options.nowMs() - started;
    options.addTiming('narrowCleanup', timingMs);
    nextDebugCache.afterNarrowCleanup = cloneRaster(raster);
    await pushRasterDebugSnapshot(
      options,
      'narrowCleanup',
      'Narrow Cleanup',
      'Labelkarte nach optionaler Streifenbereinigung.',
      settings,
      [
        { label: 'Runs', value: String(Math.max(0, settings.narrowPixelStripCleanupRuns)) },
        { label: 'Palette', value: String(raster.paletteRgb.length / 3) },
      ],
      await renderRasterDebugImage('Narrow Cleanup', raster),
      timingMs,
    );
  }
  await nowYield();

  started = options.nowMs();
  if (shouldUseCachedStage(options, 'borderSegment') && previousCache?.afterBorderSegment != null) {
    raster = cloneRaster(previousCache.afterBorderSegment);
    nextDebugCache.afterBorderSegment = cloneRaster(raster);
    options.addTiming('borderSegment', 0);
    options.report('borderSegment', 1, 'Ausläufer-Cleanup aus Debug-Cache übernommen.');
    await pushRasterDebugSnapshot(
      options,
      'borderSegment',
      'Protrusion Pruning',
      'Labelkarte nach optionaler Bereinigung einzelner schwacher Auslaeuferpixel.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Palette', value: String(raster.paletteRgb.length / 3) },
      ],
      await renderRasterDebugImage('Protrusion Pruning', raster),
      0,
      true,
    );
  } else {
    options.report('borderSegment', 0, 'Dünne Ausläufer werden bereinigt.');
    raster = pruneWeakProtrusionPixels(raster, Math.max(0, settings.nrOfTimesToHalveBorderSegments), targetPaletteColors);
    raster = compactLabels(raster);
    options.report('borderSegment', 1, 'Dünne Ausläufer bereinigt.');
    const timingMs = options.nowMs() - started;
    options.addTiming('borderSegment', timingMs);
    nextDebugCache.afterBorderSegment = cloneRaster(raster);
    await pushRasterDebugSnapshot(
      options,
      'borderSegment',
      'Protrusion Pruning',
      'Labelkarte nach optionaler Bereinigung einzelner schwacher Auslaeuferpixel.',
      settings,
      [
        { label: 'Runs', value: String(Math.max(0, settings.nrOfTimesToHalveBorderSegments)) },
        { label: 'Palette', value: String(raster.paletteRgb.length / 3) },
      ],
      await renderRasterDebugImage('Protrusion Pruning', raster),
      timingMs,
    );
  }
  await nowYield();

  const minRegionArea = Math.max(1, Math.round(raster.width * raster.height * settings.removeFacetsSmallerThanImageRatio));
  let connected: ConnectedRegions;
  started = options.nowMs();
  if (shouldUseCachedStage(options, 'facetBuild') && previousCache?.beforeFacetReduce != null) {
    raster = cloneRaster(previousCache.beforeFacetReduce.raster);
    connected = cloneConnected(previousCache.beforeFacetReduce.connected);
    nextDebugCache.beforeFacetReduce = {
      raster: cloneRaster(raster),
      connected: cloneConnected(connected),
    };
    options.addTiming('facetBuild', 0);
    options.report('facetBuild', 1, 'Regionen aus Debug-Cache übernommen.');
    await pushRasterDebugSnapshot(
      options,
      'facetBuild',
      'Facet Build',
      'Zusammenhaengende Regionen vor der Reduktion.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Regionen vor Merge', value: String(connected.regions.length) },
        { label: 'Mindestflaeche', value: `${minRegionArea} px` },
      ],
      await renderRasterDebugImage('Facet Build', raster, connected, undefined, 'debugRegions'),
      0,
      true,
    );
  } else {
    options.report('facetBuild', 0, 'Regionen werden erkannt.');
    connected = findConnectedRegions(raster.labelMap, raster.width, raster.height);
    const timingMs = options.nowMs() - started;
    options.addTiming('facetBuild', timingMs);
    options.report('facetBuild', 1, `${connected.regions.length} Regionen vor dem Merge erkannt.`);
    nextDebugCache.beforeFacetReduce = {
      raster: cloneRaster(raster),
      connected: cloneConnected(connected),
    };
    await pushRasterDebugSnapshot(
      options,
      'facetBuild',
      'Facet Build',
      'Zusammenhaengende Regionen vor der Reduktion.',
      settings,
      [
        { label: 'Regionen vor Merge', value: String(connected.regions.length) },
        { label: 'Mindestflaeche', value: `${minRegionArea} px` },
      ],
      await renderRasterDebugImage('Facet Build', raster, connected, undefined, 'debugRegions'),
      timingMs,
    );
  }

  started = options.nowMs();
  const regionCountBeforeReduce = connected.regions.length;
  if (shouldUseCachedStage(options, 'facetReduce') && previousCache?.afterFacetReduce != null) {
    raster = cloneRaster(previousCache.afterFacetReduce.raster);
    connected = cloneConnected(previousCache.afterFacetReduce.connected);
    nextDebugCache.afterFacetReduce = {
      raster: cloneRaster(raster),
      connected: cloneConnected(connected),
    };
    options.addTiming('facetReduce', 0);
    options.report('facetReduce', 1, 'Reduzierte Regionen aus Debug-Cache übernommen.');
    await pushRasterDebugSnapshot(
      options,
      'facetReduce',
      'Facet Reduce',
      'Regionen nach dem Merge kleiner, duennen oder optional aehnlicher Nachbarn.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Regionen', value: String(connected.regions.length) },
        { label: 'Mindestflaeche', value: `${minRegionArea} px` },
      ],
      await renderRasterDebugImage('Facet Reduce', raster, connected, undefined, 'debugRegions'),
      0,
      true,
    );
  } else {
    if (settings.mergeSimilarAdjacentRegions) {
      options.report('facetReduce', 0, 'Benachbarte Regionen mit sehr ähnlichen Farben werden bereinigt.');
      raster = await mergeSimilarAdjacentRegions(raster, options.report);
    }
    options.report('facetReduce', 0.28, `Regionen unter ${minRegionArea} Pixeln werden zusammengeführt.`);
    raster = await mergeSmallAndThinRegions(raster, minRegionArea, targetPaletteColors, options.report);
    connected = findConnectedRegions(raster.labelMap, raster.width, raster.height);
    if (settings.maximumNumberOfFacets > 0 && connected.regions.length > settings.maximumNumberOfFacets) {
      options.report(
        'facetReduce',
        0.72,
        `Zielwert ${settings.maximumNumberOfFacets} Flächen wird kontrastgeschützt vorbereitet.`,
      );
      const limited = await limitMaximumFacelets(
        raster,
        settings.maximumNumberOfFacets,
        minRegionArea,
        targetPaletteColors,
        options.report,
      );
      raster = limited.raster;
      connected = limited.connected;
    }
    const timingMs = options.nowMs() - started;
    options.addTiming('facetReduce', timingMs);
    options.report('facetReduce', 1, 'Regionen zusammengeführt.');
    nextDebugCache.afterFacetReduce = {
      raster: cloneRaster(raster),
      connected: cloneConnected(connected),
    };
    await pushRasterDebugSnapshot(
      options,
      'facetReduce',
      'Facet Reduce',
      'Regionen nach dem Merge kleiner, duennen oder optional aehnlicher Nachbarn.',
      settings,
      [
        { label: 'Regionen vor Merge', value: String(regionCountBeforeReduce) },
        { label: 'Regionen nach Merge', value: String(connected.regions.length) },
        { label: 'Mindestflaeche', value: `${minRegionArea} px` },
      ],
      await renderRasterDebugImage('Facet Reduce', raster, connected, undefined, 'debugRegions'),
      timingMs,
    );
  }

  started = options.nowMs();
  let svgPaths: SvgRegionPath[];
  let boundaryPaths: BoundaryPath[];
  if (shouldUseCachedStage(options, 'borderTrace') && previousCache?.svgPaths != null && previousCache.boundaryPaths != null) {
    svgPaths = cloneSvgPaths(previousCache.svgPaths);
    boundaryPaths = cloneBoundaryPaths(previousCache.boundaryPaths);
    nextDebugCache.svgPaths = cloneSvgPaths(svgPaths);
    nextDebugCache.boundaryPaths = cloneBoundaryPaths(boundaryPaths);
    options.addTiming('borderTrace', 0);
    options.report('borderTrace', 1, 'Konturen aus Debug-Cache übernommen.');
    await pushRasterDebugSnapshot(
      options,
      'borderTrace',
      'Border Trace',
      'Berechnete Grenzen und SVG-Pfade der finalen Regionen.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'SVG-Pfade', value: String(svgPaths.length) },
        { label: 'Boundary-Pfade', value: String(boundaryPaths.length) },
      ],
      await renderRasterDebugImage('Border Trace', raster, connected, undefined, 'boundaries'),
      0,
      true,
    );
  } else {
    options.report('borderTrace', 0, 'Grenzen werden berechnet.');
    buildBoundaryMask(connected.regionMap, raster.width, raster.height);
    svgPaths = buildSvgRegionPaths(connected, raster.width, raster.height);
    boundaryPaths = buildBoundaryPaths(connected, raster.width, raster.height);
    const timingMs = options.nowMs() - started;
    options.addTiming('borderTrace', timingMs);
    options.report('borderTrace', 1, 'Grenzen berechnet.');
    nextDebugCache.svgPaths = cloneSvgPaths(svgPaths);
    nextDebugCache.boundaryPaths = cloneBoundaryPaths(boundaryPaths);
    await pushRasterDebugSnapshot(
      options,
      'borderTrace',
      'Border Trace',
      'Berechnete Grenzen und SVG-Pfade der finalen Regionen.',
      settings,
      [
        { label: 'SVG-Pfade', value: String(svgPaths.length) },
        { label: 'Boundary-Pfade', value: String(boundaryPaths.length) },
        { label: 'Regionen', value: String(connected.regions.length) },
      ],
      await renderRasterDebugImage('Border Trace', raster, connected, undefined, 'boundaries'),
      timingMs,
    );
  }
  await nowYield();

  const referenceLabelArea = Math.max(minRegionArea, Math.round(raster.width * raster.height * MIN_LABEL_AREA_RATIO));
  started = options.nowMs();
  let placements: LabelPlacement[];
  if (shouldUseCachedStage(options, 'labelPlacement') && previousCache?.placements != null) {
    placements = clonePlacements(previousCache.placements);
    nextDebugCache.placements = clonePlacements(placements);
    options.addTiming('labelPlacement', 0);
    options.report('labelPlacement', 1, 'Zahlenpositionen aus Debug-Cache übernommen.');
    await pushRasterDebugSnapshot(
      options,
      'labelPlacement',
      'Label Placement',
      'Gefundene Zahl- und Punktpositionen fuer alle finalen Regionen.',
      settings,
      [
        { label: 'Status', value: 'Aus Cache' },
        { label: 'Marker', value: `${placements.length} / ${connected.regions.length}` },
        { label: 'Referenzflaeche', value: `${referenceLabelArea} px` },
      ],
      await renderRasterDebugImage('Label Placement', raster, connected, placements, 'boundaries'),
      0,
      true,
    );
  } else {
    options.report('labelPlacement', 0, 'Zahlenpositionen werden gesetzt.');
    placements = computeLabelPlacements(connected, raster.width);
    const timingMs = options.nowMs() - started;
    options.addTiming('labelPlacement', timingMs);
    options.report('labelPlacement', 1, `${placements.length} Markerpositionen gesetzt.`);
    nextDebugCache.placements = clonePlacements(placements);
    await pushRasterDebugSnapshot(
      options,
      'labelPlacement',
      'Label Placement',
      'Gefundene Zahl- und Punktpositionen fuer alle finalen Regionen.',
      settings,
      [
        { label: 'Marker', value: `${placements.length} / ${connected.regions.length}` },
        { label: 'Referenzflaeche', value: `${referenceLabelArea} px` },
      ],
      await renderRasterDebugImage('Label Placement', raster, connected, placements, 'boundaries'),
      timingMs,
    );
  }
  await nowYield();

  started = options.nowMs();
  options.report('svgRender', 0, 'Ausgabevarianten werden gerendert.');
  const renderVariants = options.variantIds == null
    ? RENDER_VARIANTS
    : RENDER_VARIANTS.filter((config) => options.variantIds?.includes(config.id));
  if (renderVariants.length === 0) {
    throw new Error('No render variants selected.');
  }
  const variants: GeneratorOutputVariant[] = [];
  for (let index = 0; index < renderVariants.length; index += 1) {
    const config = renderVariants[index];
    const renderedPng = await renderTemplatePngBase64(raster, connected, placements, boundaryPaths, config);
    const svg = renderVectorSvg(raster, placements, svgPaths, boundaryPaths, config);
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
      isDefault: config.isDefault || (options.debug?.enabled === true && config.id === 'classic'),
    });
    options.report('svgRender', (index + 1) / renderVariants.length, `${config.label} gerendert.`);
    await nowYield();
  }
  const defaultVariant = variants.find((variant) => variant.isDefault) ?? variants[0];
  const previewPngBase64 = defaultVariant.pngBase64 ?? '';
  const previewPngWidth = defaultVariant.pngWidth;
  const previewPngHeight = defaultVariant.pngHeight;
  const svg = defaultVariant.svg ?? createEmbeddedPngSvg(previewPngBase64, previewPngWidth, previewPngHeight);
  const renderTimingMs = options.nowMs() - started;
  options.addTiming('svgRender', renderTimingMs);
  options.report('svgRender', 1, 'Ausgabevarianten gerendert.');
  await pushRasterDebugSnapshot(
    options,
    'svgRender',
    'SVG Render',
    'Final gerenderte Debug-Ausgabe. Im Debug Mode wird nur Classic erzeugt.',
    settings,
    [
      { label: 'Varianten', value: String(variants.length) },
      { label: 'Finale Variante', value: defaultVariant.label },
      { label: 'Output', value: `${previewPngWidth} x ${previewPngHeight} px` },
    ],
    {
      label: defaultVariant.label,
      pngBase64: previewPngBase64,
      width: previewPngWidth,
      height: previewPngHeight,
      byteLength: defaultVariant.pngByteLength,
    },
    renderTimingMs,
  );

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
    debugCache: nextDebugCache,
  };
}
