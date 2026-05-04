export type MiniBatchKMeansOptions = {
  k: number;
  maxIterations: number;
  batchSize: number;
  seed: number;
  tolerance?: number;
  init: "kmeans++" | "deterministic-grid";
};

export type MiniBatchKMeansResult = {
  centers: Float32Array;
  labels?: Uint16Array | Uint32Array;
  inertia: number;
  iterations: number;
};

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function copySample(
  samples: Float32Array,
  sampleIndex: number,
  dimensions: number,
  target: Float32Array,
  targetOffset: number,
): void {
  const sourceOffset = sampleIndex * dimensions;
  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    target[targetOffset + dimension] = samples[sourceOffset + dimension];
  }
}

function squaredDistance(
  samples: Float32Array,
  sampleIndex: number,
  centers: Float32Array,
  centerIndex: number,
  dimensions: number,
): number {
  const sourceOffset = sampleIndex * dimensions;
  const centerOffset = centerIndex * dimensions;
  let distance = 0;
  for (let dimension = 0; dimension < dimensions; dimension += 1) {
    const delta = samples[sourceOffset + dimension] - centers[centerOffset + dimension];
    distance += delta * delta;
  }
  return distance;
}

function initializeDeterministicGrid(samples: Float32Array, dimensions: number, k: number): Float32Array {
  const sampleCount = Math.max(1, Math.floor(samples.length / dimensions));
  const centers = new Float32Array(k * dimensions);
  for (let index = 0; index < k; index += 1) {
    const sampleIndex = Math.min(sampleCount - 1, Math.floor((index * sampleCount) / k));
    copySample(samples, sampleIndex, dimensions, centers, index * dimensions);
  }
  return centers;
}

function initializeKMeansPP(samples: Float32Array, dimensions: number, k: number, seed: number): Float32Array {
  const sampleCount = Math.max(1, Math.floor(samples.length / dimensions));
  const centers = new Float32Array(k * dimensions);
  const random = createDeterministicRandom(seed);
  const distances = new Float64Array(sampleCount);

  const firstIndex = Math.min(sampleCount - 1, Math.floor(random() * sampleCount));
  copySample(samples, firstIndex, dimensions, centers, 0);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    distances[sampleIndex] = squaredDistance(samples, sampleIndex, centers, 0, dimensions);
  }

  for (let centerIndex = 1; centerIndex < k; centerIndex += 1) {
    let totalDistance = 0;
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      totalDistance += distances[sampleIndex];
    }

    let chosenSample = 0;
    if (totalDistance > 0) {
      let threshold = random() * totalDistance;
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        threshold -= distances[sampleIndex];
        if (threshold <= 0) {
          chosenSample = sampleIndex;
          break;
        }
      }
    } else {
      chosenSample = Math.min(sampleCount - 1, Math.floor(random() * sampleCount));
    }

    copySample(samples, chosenSample, dimensions, centers, centerIndex * dimensions);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const distance = squaredDistance(samples, sampleIndex, centers, centerIndex, dimensions);
      if (distance < distances[sampleIndex]) {
        distances[sampleIndex] = distance;
      }
    }
  }

  return centers;
}

export function assignNearestCenters(
  samples: Float32Array,
  centers: Float32Array,
  dimensions: number,
): Uint16Array | Uint32Array {
  const sampleCount = Math.max(0, Math.floor(samples.length / dimensions));
  const centerCount = Math.max(1, Math.floor(centers.length / dimensions));
  const labels = centerCount <= 0xffff ? new Uint16Array(sampleCount) : new Uint32Array(sampleCount);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    let bestCenter = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let centerIndex = 0; centerIndex < centerCount; centerIndex += 1) {
      const distance = squaredDistance(samples, sampleIndex, centers, centerIndex, dimensions);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCenter = centerIndex;
      }
    }
    labels[sampleIndex] = bestCenter;
  }

  return labels;
}

export function miniBatchKMeans(
  samples: Float32Array,
  dimensions: number,
  options: MiniBatchKMeansOptions,
): MiniBatchKMeansResult {
  const sampleCount = Math.max(0, Math.floor(samples.length / dimensions));
  if (sampleCount === 0) {
    return {
      centers: new Float32Array(0),
      labels: new Uint16Array(0),
      inertia: 0,
      iterations: 0,
    };
  }

  const k = Math.max(1, Math.min(Math.trunc(options.k) || 1, sampleCount));
  const tolerance = options.tolerance ?? 0.01;
  const batchSize = Math.max(1, Math.min(Math.trunc(options.batchSize) || sampleCount, sampleCount));
  const centers = options.init === "deterministic-grid"
    ? initializeDeterministicGrid(samples, dimensions, k)
    : initializeKMeansPP(samples, dimensions, k, options.seed);
  const counts = new Int32Array(k);
  const random = createDeterministicRandom(options.seed ^ 0x9e3779b9);
  let iterations = 0;

  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    let movement = 0;
    for (let batchIndex = 0; batchIndex < batchSize; batchIndex += 1) {
      const sampleIndex = Math.min(sampleCount - 1, Math.floor(random() * sampleCount));
      let bestCenter = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let centerIndex = 0; centerIndex < k; centerIndex += 1) {
        const distance = squaredDistance(samples, sampleIndex, centers, centerIndex, dimensions);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCenter = centerIndex;
        }
      }

      counts[bestCenter] += 1;
      const learningRate = 1 / counts[bestCenter];
      const sampleOffset = sampleIndex * dimensions;
      const centerOffset = bestCenter * dimensions;
      for (let dimension = 0; dimension < dimensions; dimension += 1) {
        const previous = centers[centerOffset + dimension];
        const next = previous + learningRate * (samples[sampleOffset + dimension] - previous);
        movement += Math.abs(next - previous);
        centers[centerOffset + dimension] = next;
      }
    }

    iterations = iteration + 1;
    if (movement / (batchSize * dimensions) <= tolerance) {
      break;
    }
  }

  const labels = assignNearestCenters(samples, centers, dimensions);
  let inertia = 0;
  for (let sampleIndex = 0; sampleIndex < labels.length; sampleIndex += 1) {
    inertia += squaredDistance(samples, sampleIndex, centers, labels[sampleIndex], dimensions);
  }

  return {
    centers,
    labels,
    inertia,
    iterations,
  };
}
