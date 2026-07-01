import { ColorMapResult } from '../../vendor/paintbynumbersgenerator/colorreductionmanagement';
import type { RGB } from '../../vendor/paintbynumbersgenerator/common';
import { rgb2lab } from '../../vendor/paintbynumbersgenerator/lib/colorconversion';
import { Uint8Array2D } from '../../vendor/paintbynumbersgenerator/structs/typedarrays';
import type { SimpleImageData } from '../../types/imageData';

const REDUNDANT_NEUTRAL_MERGE_DISTANCE = 9;
const REDUNDANT_LIGHT_NEUTRAL_MERGE_DISTANCE = 7;
const REDUNDANT_NEUTRAL_CHROMA_MAX = 12;
const REDUNDANT_LIGHT_CHROMA_MAX = 18;
const REDUNDANT_LIGHT_L_MIN = 82;
const DEFAULT_NEAR_IDENTICAL_PALETTE_MERGE_LAB_DISTANCE = 4.25;

type LabMetrics = {
  lab: [number, number, number];
  chroma: number;
};

export function createEmptyImageData(width: number, height: number): SimpleImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 3; index < data.length; index += 4) {
    data[index] = 255;
  }
  return { width, height, data };
}

function getColorMapIndexArray(colorMapResult: ColorMapResult): Uint8Array {
  return (colorMapResult.imgColorIndices as unknown as { arr: Uint8Array }).arr;
}

function labMetrics(color: RGB): LabMetrics {
  const lab = rgb2lab(color) as [number, number, number];
  const chroma = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
  return { lab, chroma };
}

function labDistanceFromMetrics(left: LabMetrics, right: LabMetrics): number {
  const leftLab = left.lab;
  const rightLab = right.lab;
  const dL = leftLab[0] - rightLab[0];
  const dA = leftLab[1] - rightLab[1];
  const dB = leftLab[2] - rightLab[2];
  return Math.sqrt(dL * dL + dA * dA + dB * dB);
}

function mergePaletteEntry(colors: RGB[], counts: number[], left: number, right: number): { source: number; target: number } {
  const target = counts[left] >= counts[right] ? left : right;
  const source = target === left ? right : left;
  counts[target] += counts[source];
  colors.splice(source, 1);
  counts.splice(source, 1);
  return { source, target };
}

function shouldMergeRedundantPaletteColors(
  leftColor: RGB,
  rightColor: RGB,
  nearIdenticalPaletteMergeLabDistance: number,
): boolean {
  const left = labMetrics(leftColor);
  const right = labMetrics(rightColor);
  const distance = labDistanceFromMetrics(left, right);
  if (distance <= nearIdenticalPaletteMergeLabDistance) {
    return true;
  }

  const maxChroma = Math.max(left.chroma, right.chroma);
  const bothNeutral = maxChroma <= REDUNDANT_NEUTRAL_CHROMA_MAX;
  const bothLightLowChroma =
    left.lab[0] >= REDUNDANT_LIGHT_L_MIN &&
    right.lab[0] >= REDUNDANT_LIGHT_L_MIN &&
    maxChroma <= REDUNDANT_LIGHT_CHROMA_MAX;

  return (
    (bothNeutral && distance <= REDUNDANT_NEUTRAL_MERGE_DISTANCE) ||
    (bothLightLowChroma && distance <= REDUNDANT_LIGHT_NEUTRAL_MERGE_DISTANCE)
  );
}

export function mergeRedundantPaletteColors(
  colorMapResult: ColorMapResult,
  nearIdenticalPaletteMergeLabDistance = DEFAULT_NEAR_IDENTICAL_PALETTE_MERGE_LAB_DISTANCE,
): ColorMapResult {
  const sourceIndices = getColorMapIndexArray(colorMapResult);
  const sourceColorCount = colorMapResult.colorsByIndex.length;
  if (sourceColorCount <= 1) {
    return colorMapResult;
  }

  const nearIdenticalDistance = Math.max(0, nearIdenticalPaletteMergeLabDistance);
  const colors = colorMapResult.colorsByIndex.map((color) => [color[0], color[1], color[2]] as RGB);
  const counts = new Array<number>(sourceColorCount).fill(0);
  const originalToCurrent = new Int32Array(sourceColorCount);
  for (let index = 0; index < sourceColorCount; index += 1) {
    originalToCurrent[index] = index;
  }
  for (const colorIndex of sourceIndices) {
    counts[colorIndex] += 1;
  }

  let mergedAny = false;
  while (true) {
    let bestLeft = -1;
    let bestRight = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let left = 0; left < colors.length; left += 1) {
      for (let right = left + 1; right < colors.length; right += 1) {
        if (!shouldMergeRedundantPaletteColors(colors[left], colors[right], nearIdenticalDistance)) {
          continue;
        }

        const distance = labDistanceFromMetrics(labMetrics(colors[left]), labMetrics(colors[right]));
        if (distance < bestDistance) {
          bestLeft = left;
          bestRight = right;
          bestDistance = distance;
        }
      }
    }

    if (bestLeft < 0 || bestRight < 0) {
      break;
    }

    const { source, target } = mergePaletteEntry(colors, counts, bestLeft, bestRight);
    const adjustedTarget = source < target ? target - 1 : target;
    for (let originalIndex = 0; originalIndex < originalToCurrent.length; originalIndex += 1) {
      const current = originalToCurrent[originalIndex];
      if (current === source || current === target) {
        originalToCurrent[originalIndex] = adjustedTarget;
      } else if (current > source) {
        originalToCurrent[originalIndex] = current - 1;
      }
    }
    mergedAny = true;
  }

  if (!mergedAny) {
    return colorMapResult;
  }

  const imgColorIndices = new Uint8Array2D(colorMapResult.width, colorMapResult.height);
  const targetIndices = (imgColorIndices as unknown as { arr: Uint8Array }).arr;
  for (let index = 0; index < sourceIndices.length; index += 1) {
    targetIndices[index] = originalToCurrent[sourceIndices[index]];
  }

  const result = new ColorMapResult();
  result.imgColorIndices = imgColorIndices;
  result.colorsByIndex = colors;
  result.width = colorMapResult.width;
  result.height = colorMapResult.height;
  return result;
}
