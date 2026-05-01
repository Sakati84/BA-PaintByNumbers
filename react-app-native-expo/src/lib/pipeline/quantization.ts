import { clampToByte, mergeNearDuplicateColors } from './colorMath';
import { KMEANS_MERGE_SIMILAR_LAB_DISTANCE, PYTHON_KMEANS_RANDOM_STATE } from './constants';
import { assignNearestCenters, miniBatchKMeans } from './miniBatchKMeans';

export type QuantizationDataResult = {
  width: number;
  height: number;
  colorCount: number;
  labelMap: Int32Array;
  centerLabU8: Uint8Array;
};

function sampleLabPixelsDeterministic(
  labSamples: Float32Array,
  pixelCount: number,
  maxTrainingPixels: number,
): Float32Array {
  if (pixelCount <= maxTrainingPixels) {
    return labSamples;
  }

  const sampleCount = Math.max(1, Math.min(pixelCount, maxTrainingPixels));
  const sampled = new Float32Array(sampleCount * 3);
  for (let index = 0; index < sampleCount; index += 1) {
    const pixelIndex = Math.min(pixelCount - 1, Math.floor((index * pixelCount) / sampleCount));
    const sourceOffset = pixelIndex * 3;
    const targetOffset = index * 3;
    sampled[targetOffset] = labSamples[sourceOffset];
    sampled[targetOffset + 1] = labSamples[sourceOffset + 1];
    sampled[targetOffset + 2] = labSamples[sourceOffset + 2];
  }
  return sampled;
}

export function applyMiniBatchQuantization(args: {
  labSamples: Float32Array;
  width: number;
  height: number;
  requestedColorCount: number;
  seed?: number;
}): QuantizationDataResult {
  const pixelCount = args.width * args.height;
  const colorCount = Math.max(1, Math.min(Math.trunc(args.requestedColorCount) || 1, pixelCount));
  const overK = Math.min(pixelCount, colorCount + Math.max(4, Math.ceil(colorCount * 0.5)));
  const trainingSamples = sampleLabPixelsDeterministic(args.labSamples, pixelCount, 120_000);
  const trainingPixelCount = Math.floor(trainingSamples.length / 3);

  const kmeans = miniBatchKMeans(trainingSamples, 3, {
    k: overK,
    maxIterations: trainingPixelCount > 40_000 ? 60 : 80,
    batchSize: Math.min(Math.max(512, Math.floor(trainingPixelCount * 0.08)), 2048),
    seed: args.seed ?? PYTHON_KMEANS_RANDOM_STATE,
    tolerance: 0.2,
    init: 'kmeans++',
  });

  const centerFloats = new Float32Array(kmeans.centers);
  const rawLabels = kmeans.labels ?? assignNearestCenters(args.labSamples, centerFloats, 3);
  const clusterAlive = new Uint8Array(overK).fill(1);
  const clusterRemap = new Int32Array(overK);
  for (let index = 0; index < overK; index += 1) {
    clusterRemap[index] = index;
  }
  const clusterWeight = new Float64Array(overK);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    clusterWeight[rawLabels[pixel]] += 1;
  }

  let liveCount = overK;
  while (liveCount > colorCount) {
    let mergeLeft = -1;
    let mergeRight = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let left = 0; left < overK; left += 1) {
      if (!clusterAlive[left]) {
        continue;
      }
      for (let right = left + 1; right < overK; right += 1) {
        if (!clusterAlive[right]) {
          continue;
        }
        const leftOffset = left * 3;
        const rightOffset = right * 3;
        const deltaL = centerFloats[leftOffset] - centerFloats[rightOffset];
        const deltaA = centerFloats[leftOffset + 1] - centerFloats[rightOffset + 1];
        const deltaB = centerFloats[leftOffset + 2] - centerFloats[rightOffset + 2];
        const distance = deltaL * deltaL + deltaA * deltaA + deltaB * deltaB;
        if (distance < bestDistance) {
          bestDistance = distance;
          mergeLeft = left;
          mergeRight = right;
        }
      }
    }
    if (mergeLeft < 0 || mergeRight < 0) {
      break;
    }
    const leftWeight = clusterWeight[mergeLeft];
    const rightWeight = clusterWeight[mergeRight];
    const totalWeight = leftWeight + rightWeight || 1;
    const leftOffset = mergeLeft * 3;
    const rightOffset = mergeRight * 3;
    centerFloats[leftOffset] = (centerFloats[leftOffset] * leftWeight + centerFloats[rightOffset] * rightWeight) / totalWeight;
    centerFloats[leftOffset + 1] = (centerFloats[leftOffset + 1] * leftWeight + centerFloats[rightOffset + 1] * rightWeight) / totalWeight;
    centerFloats[leftOffset + 2] = (centerFloats[leftOffset + 2] * leftWeight + centerFloats[rightOffset + 2] * rightWeight) / totalWeight;
    clusterWeight[mergeLeft] = totalWeight;
    clusterAlive[mergeRight] = 0;
    for (let index = 0; index < overK; index += 1) {
      if (clusterRemap[index] === mergeRight) {
        clusterRemap[index] = mergeLeft;
      }
    }
    liveCount -= 1;
  }

  const finalIndex = new Int32Array(overK).fill(-1);
  let finalCount = 0;
  for (let index = 0; index < overK; index += 1) {
    if (clusterAlive[index]) {
      finalIndex[index] = finalCount;
      finalCount += 1;
    }
  }

  const centerLabU8 = new Uint8Array(finalCount * 3);
  for (let index = 0; index < overK; index += 1) {
    if (!clusterAlive[index]) {
      continue;
    }
    const finalOffset = finalIndex[index] * 3;
    const centerOffset = index * 3;
    centerLabU8[finalOffset] = clampToByte(centerFloats[centerOffset]);
    centerLabU8[finalOffset + 1] = clampToByte(centerFloats[centerOffset + 1]);
    centerLabU8[finalOffset + 2] = clampToByte(centerFloats[centerOffset + 2]);
  }

  const labels = new Int32Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const sampleOffset = pixel * 3;
    const lightness = args.labSamples[sampleOffset];
    const a = args.labSamples[sampleOffset + 1];
    const b = args.labSamples[sampleOffset + 2];
    let bestLabel = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let center = 0; center < finalCount; center += 1) {
      const centerOffset = center * 3;
      const deltaL = lightness - centerLabU8[centerOffset];
      const deltaA = a - centerLabU8[centerOffset + 1];
      const deltaB = b - centerLabU8[centerOffset + 2];
      const distance = deltaL * deltaL + deltaA * deltaA + deltaB * deltaB;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLabel = center;
      }
    }
    labels[pixel] = bestLabel;
  }

  mergeNearDuplicateColors(centerLabU8, labels, finalCount);

  return {
    width: args.width,
    height: args.height,
    colorCount: finalCount,
    labelMap: labels,
    centerLabU8,
  };
}

export function quantizationMergeThreshold(): number {
  return KMEANS_MERGE_SIMILAR_LAB_DISTANCE;
}
