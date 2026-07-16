#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decode } from 'fast-png';

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = path.resolve(appRoot, '..');

const REFERENCE_MAX_EDGE = 1400;
const CORE_RADII = [3, 5, 8];
const DELTA_E_THRESHOLDS = [8, 12, 16];
const SOURCE_EDGE_THRESHOLDS = [4, 8, 12];
const SOURCE_EDGE_RECALL_THRESHOLDS = [12, 16];
const SOURCE_EDGE_SEARCH_RADIUS = 2;
const STRONG_BOUNDARY_ALPHA = 0.82;
const SOFT_BOUNDARY_ALPHA = 0.22;
const LOW_CONTRAST_DELTA_E = 12;

const NARROW_BAND_MAX_EFFECTIVE_WIDTH = 10;
const NARROW_BAND_MIN_SPAN = 24;
const NARROW_BAND_MIN_ELONGATION = 4;
const NARROW_BAND_DOMINANT_SHARE = 0.65;
const NARROW_BAND_TOP_TWO_SHARE = 0.55;
const NARROW_BAND_SECOND_SHARE = 0.08;
const NARROW_BAND_SECOND_PIXELS = 6;

function printUsage() {
  console.log(`Usage:
  node ./App/scripts/analyze-classic-paintability.mjs <manifest.json> [options]

Options:
  --manifest <file>       Pipeline Lab manifest (alternative to the positional path).
  --config-id <id>        Only analyze this config. Can be passed more than once.
  --json <file>           Also write the complete analysis as JSON.
  --help                  Show this help.
`);
}

function parseArgs(argv) {
  const options = { configIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      if (options.manifestPath != null) {
        throw new Error(`Unexpected positional argument: ${arg}`);
      }
      options.manifestPath = arg;
      continue;
    }

    const next = argv[index + 1];
    if (next == null || next.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;
    if (arg === '--manifest') {
      options.manifestPath = next;
    } else if (arg === '--config-id') {
      options.configIds.push(next);
    } else if (arg === '--json') {
      options.jsonPath = next;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function resolveInputPath(value) {
  if (path.isAbsolute(value)) {
    return value;
  }
  const fromCwd = path.resolve(process.cwd(), value);
  return existsSync(fromCwd) ? fromCwd : path.resolve(repoRoot, value);
}

function resolveOutputPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function resolveManifestAsset(manifestDir, value) {
  return path.isAbsolute(value) ? value : path.resolve(manifestDir, value);
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ratio(numerator, denominator) {
  return denominator <= 0 ? 0 : round(numerator / denominator);
}

function percentile(sortedValues, quantile) {
  if (sortedValues.length === 0) {
    return null;
  }
  return sortedValues[Math.floor((sortedValues.length - 1) * quantile)];
}

function numericStats(values, digits = 6) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  let sum = 0;
  for (const value of sorted) {
    sum += value;
  }
  return {
    min: round(sorted[0], digits),
    p10: round(percentile(sorted, 0.1), digits),
    p25: round(percentile(sorted, 0.25), digits),
    p50: round(percentile(sorted, 0.5), digits),
    p75: round(percentile(sorted, 0.75), digits),
    p90: round(percentile(sorted, 0.9), digits),
    max: round(sorted[sorted.length - 1], digits),
    mean: round(sum / sorted.length, digits),
  };
}

function category(componentCount, pixelCount, totalComponents, totalPixels) {
  return {
    componentCount,
    componentShare: ratio(componentCount, totalComponents),
    pixelCount,
    pixelShare: ratio(pixelCount, totalPixels),
  };
}

function percent(value) {
  return `${round((value ?? 0) * 100, 2)}%`;
}

function decodeExactRgb(buffer) {
  const decoded = decode(buffer);
  const { width, height, channels, depth, data } = decoded;
  const pixelCount = width * height;
  const colors = new Uint32Array(pixelCount);

  if (depth === 8 && channels === 4) {
    for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 4) {
      colors[pixel] = ((data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]) >>> 0;
    }
  } else if (depth === 8 && channels === 3) {
    for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 3) {
      colors[pixel] = ((data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]) >>> 0;
    }
  } else if (depth === 8 && (channels === 1 || channels === 2)) {
    for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += channels) {
      const gray = data[offset];
      colors[pixel] = ((gray << 16) | (gray << 8) | gray) >>> 0;
    }
  } else {
    const maxValue = 2 ** depth - 1;
    const toByte = (value) => Math.round((value / maxValue) * 255);
    for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += channels) {
      const red = toByte(data[offset]);
      const green = channels <= 2 ? red : toByte(data[offset + 1]);
      const blue = channels <= 2 ? red : toByte(data[offset + 2]);
      colors[pixel] = ((red << 16) | (green << 8) | blue) >>> 0;
    }
  }

  return { width, height, colors };
}

function linearSrgb(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function labPivot(value) {
  return value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
}

function writeRgbToLab(target, offset, packedRgb) {
  const red = linearSrgb(packedRgb >>> 16);
  const green = linearSrgb((packedRgb >>> 8) & 0xff);
  const blue = linearSrgb(packedRgb & 0xff);
  const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047;
  const y = 0.2126729 * red + 0.7151522 * green + 0.072175 * blue;
  const z = (0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / 1.08883;
  const fx = labPivot(x);
  const fy = labPivot(y);
  const fz = labPivot(z);
  target[offset] = 116 * fy - 16;
  target[offset + 1] = 500 * (fx - fy);
  target[offset + 2] = 200 * (fy - fz);
}

function labDistance(lab, leftIndex, rightIndex) {
  const left = leftIndex * 3;
  const right = rightIndex * 3;
  return Math.hypot(
    lab[left] - lab[right],
    lab[left + 1] - lab[right + 1],
    lab[left + 2] - lab[right + 2],
  );
}

function labDistanceOffsets(leftLab, leftOffset, rightLab, rightOffset) {
  return Math.hypot(
    leftLab[leftOffset] - rightLab[rightOffset],
    leftLab[leftOffset + 1] - rightLab[rightOffset + 1],
    leftLab[leftOffset + 2] - rightLab[rightOffset + 2],
  );
}

function buildPixelLab(colors) {
  const lab = new Float32Array(colors.length * 3);
  for (let index = 0; index < colors.length; index += 1) {
    writeRgbToLab(lab, index * 3, colors[index]);
  }
  return lab;
}

function buildComponents(width, height, colors) {
  const pixelCount = colors.length;
  const componentMap = new Int32Array(pixelCount);
  componentMap.fill(-1);
  const queue = new Int32Array(pixelCount);
  const components = [];
  const componentByColor = new Map();

  for (let start = 0; start < pixelCount; start += 1) {
    if (componentMap[start] >= 0) {
      continue;
    }
    const componentId = components.length;
    const color = colors[start];
    let head = 0;
    let tail = 1;
    let area = 0;
    let perimeter = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    queue[0] = start;
    componentMap[start] = componentId;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      if (x > 0 && colors[index - 1] === color) {
        if (componentMap[index - 1] < 0) {
          componentMap[index - 1] = componentId;
          queue[tail] = index - 1;
          tail += 1;
        }
      } else {
        perimeter += 1;
      }
      if (x + 1 < width && colors[index + 1] === color) {
        if (componentMap[index + 1] < 0) {
          componentMap[index + 1] = componentId;
          queue[tail] = index + 1;
          tail += 1;
        }
      } else {
        perimeter += 1;
      }
      if (y > 0 && colors[index - width] === color) {
        if (componentMap[index - width] < 0) {
          componentMap[index - width] = componentId;
          queue[tail] = index - width;
          tail += 1;
        }
      } else {
        perimeter += 1;
      }
      if (y + 1 < height && colors[index + width] === color) {
        if (componentMap[index + width] < 0) {
          componentMap[index + width] = componentId;
          queue[tail] = index + width;
          tail += 1;
        }
      } else {
        perimeter += 1;
      }
    }

    components.push({ componentId, color, area, perimeter, minX, minY, maxX, maxY });
    if (!componentByColor.has(color)) {
      componentByColor.set(color, componentId);
    }
  }

  const componentLab = new Float32Array(components.length * 3);
  for (const component of components) {
    writeRgbToLab(componentLab, component.componentId * 3, component.color);
  }
  return { componentMap, components, componentLab, componentByColor };
}

function addContact(adjacency, sourceId, targetId, length = 1) {
  const contacts = adjacency[sourceId];
  contacts.set(targetId, (contacts.get(targetId) ?? 0) + length);
}

function sourceEdgeSupportVertical(sourceLab, width, height, x, y, searchRadius) {
  let support = 0;
  const minEdgeX = Math.max(0, x - searchRadius);
  const maxEdgeX = Math.min(width - 2, x + searchRadius);
  for (let edgeX = minEdgeX; edgeX <= maxEdgeX; edgeX += 1) {
    const leftOffset = (y * width + edgeX) * 3;
    const rightOffset = leftOffset + 3;
    support = Math.max(support, labDistanceOffsets(sourceLab, leftOffset, sourceLab, rightOffset));
  }
  return support;
}

function sourceEdgeSupportHorizontal(sourceLab, width, height, x, y, searchRadius) {
  let support = 0;
  const minEdgeY = Math.max(0, y - searchRadius);
  const maxEdgeY = Math.min(height - 2, y + searchRadius);
  for (let edgeY = minEdgeY; edgeY <= maxEdgeY; edgeY += 1) {
    const topOffset = (edgeY * width + x) * 3;
    const bottomOffset = topOffset + width * 3;
    support = Math.max(support, labDistanceOffsets(sourceLab, topOffset, sourceLab, bottomOffset));
  }
  return support;
}

function outputBoundaryNearVertical(componentMap, width, x, y, searchRadius) {
  const row = y * width;
  const minEdgeX = Math.max(0, x - searchRadius);
  const maxEdgeX = Math.min(width - 2, x + searchRadius);
  for (let edgeX = minEdgeX; edgeX <= maxEdgeX; edgeX += 1) {
    if (componentMap[row + edgeX] !== componentMap[row + edgeX + 1]) {
      return true;
    }
  }
  return false;
}

function outputBoundaryNearHorizontal(componentMap, width, height, x, y, searchRadius) {
  const minEdgeY = Math.max(0, y - searchRadius);
  const maxEdgeY = Math.min(height - 2, y + searchRadius);
  for (let edgeY = minEdgeY; edgeY <= maxEdgeY; edgeY += 1) {
    const topIndex = edgeY * width + x;
    if (componentMap[topIndex] !== componentMap[topIndex + width]) {
      return true;
    }
  }
  return false;
}

function analyzeSourceEdgeRecall(componentMap, width, height, sourceLab, searchRadius) {
  if (sourceLab == null) {
    return {
      available: false,
      reason: 'Prepared input is missing or has different dimensions from cleanColor.',
    };
  }

  const totals = Object.fromEntries(SOURCE_EDGE_RECALL_THRESHOLDS.map((threshold) => [threshold, 0]));
  const recalled = Object.fromEntries(SOURCE_EDGE_RECALL_THRESHOLDS.map((threshold) => [threshold, 0]));

  const recordSourceEdge = (deltaE, isRecalled) => {
    for (const threshold of SOURCE_EDGE_RECALL_THRESHOLDS) {
      if (deltaE >= threshold) {
        totals[threshold] += 1;
        if (isRecalled) {
          recalled[threshold] += 1;
        }
      }
    }
  };

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = row + x;
      const sourceOffset = index * 3;
      if (x + 1 < width) {
        const deltaE = labDistanceOffsets(sourceLab, sourceOffset, sourceLab, sourceOffset + 3);
        if (deltaE >= SOURCE_EDGE_RECALL_THRESHOLDS[0]) {
          recordSourceEdge(
            deltaE,
            outputBoundaryNearVertical(componentMap, width, x, y, searchRadius),
          );
        }
      }
      if (y + 1 < height) {
        const deltaE = labDistanceOffsets(
          sourceLab,
          sourceOffset,
          sourceLab,
          sourceOffset + width * 3,
        );
        if (deltaE >= SOURCE_EDGE_RECALL_THRESHOLDS[0]) {
          recordSourceEdge(
            deltaE,
            outputBoundaryNearHorizontal(componentMap, width, height, x, y, searchRadius),
          );
        }
      }
    }
  }

  const thresholdMetric = (threshold) => ({
    sourceEdgeCount: totals[threshold],
    recalledEdgeCount: recalled[threshold],
    recallShare: ratio(recalled[threshold], totals[threshold]),
  });
  return {
    available: true,
    normalSearchRadiusPx: searchRadius,
    ge12: thresholdMetric(12),
    ge16: thresholdMetric(16),
  };
}

function analyzeBoundaries(model, width, height, sourceLab) {
  const { componentMap, components, componentLab } = model;
  const pixelCount = width * height;
  const adjacencyByComponent = Array.from({ length: components.length }, () => new Map());
  const adjacencyByColor = Array.from({ length: components.length }, () => new Map());
  const classicMask = new Uint8Array(pixelCount);
  const deltaECounts = Object.fromEntries(DELTA_E_THRESHOLDS.map((threshold) => [threshold, 0]));
  const sourceCounts = Object.fromEntries(SOURCE_EDGE_THRESHOLDS.map((threshold) => [threshold, 0]));
  const sourceAvailable = sourceLab != null;
  const scale = Math.max(width, height) / REFERENCE_MAX_EDGE;
  const sourceSearchRadius = Math.max(1, Math.round(SOURCE_EDGE_SEARCH_RADIUS * scale));
  let internalEdgeCount = 0;
  let outputDeltaESum = 0;
  let sourceSupportSum = 0;

  const processEdge = (leftIndex, rightIndex, sourceSupport) => {
    const leftComponent = componentMap[leftIndex];
    const rightComponent = componentMap[rightIndex];
    if (leftComponent === rightComponent) {
      return;
    }
    internalEdgeCount += 1;
    classicMask[leftIndex] = 2;
    classicMask[rightIndex] = 2;
    addContact(adjacencyByComponent, leftComponent, rightComponent);
    addContact(adjacencyByComponent, rightComponent, leftComponent);
    addContact(adjacencyByColor, leftComponent, components[rightComponent].color);
    addContact(adjacencyByColor, rightComponent, components[leftComponent].color);

    const outputDeltaE = labDistance(componentLab, leftComponent, rightComponent);
    outputDeltaESum += outputDeltaE;
    for (const threshold of DELTA_E_THRESHOLDS) {
      if (outputDeltaE < threshold) {
        deltaECounts[threshold] += 1;
      }
    }
    if (sourceAvailable) {
      sourceSupportSum += sourceSupport;
      for (const threshold of SOURCE_EDGE_THRESHOLDS) {
        if (sourceSupport < threshold) {
          sourceCounts[threshold] += 1;
        }
      }
    }
  };

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const index = row + x;
      if (x + 1 < width && componentMap[index] !== componentMap[index + 1]) {
        const support = sourceAvailable
          ? sourceEdgeSupportVertical(sourceLab, width, height, x, y, sourceSearchRadius)
          : 0;
        processEdge(index, index + 1, support);
      }
      if (y + 1 < height && componentMap[index] !== componentMap[index + width]) {
        const support = sourceAvailable
          ? sourceEdgeSupportHorizontal(sourceLab, width, height, x, y, sourceSearchRadius)
          : 0;
        processEdge(index, index + width, support);
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (classicMask[index] !== 2) {
        continue;
      }
      for (let dy = -1; dy <= 1; dy += 1) {
        const neighborY = y + dy;
        if (neighborY < 0 || neighborY >= height) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx += 1) {
          const neighborX = x + dx;
          if (neighborX < 0 || neighborX >= width) {
            continue;
          }
          const neighborIndex = neighborY * width + neighborX;
          if (classicMask[neighborIndex] === 0) {
            classicMask[neighborIndex] = 1;
          }
        }
      }
    }
  }

  let strongPixelCount = 0;
  let softPixelCount = 0;
  for (const value of classicMask) {
    if (value === 2) strongPixelCount += 1;
    if (value === 1) softPixelCount += 1;
  }
  const visibleFillByComponent = new Int32Array(components.length);
  for (let index = 0; index < pixelCount; index += 1) {
    if (classicMask[index] === 0) {
      visibleFillByComponent[componentMap[index]] += 1;
    }
  }
  const fillRetentions = components.map((component) => (
    visibleFillByComponent[component.componentId] / Math.max(1, component.area)
  ));
  const retentionCategory = (predicate) => {
    let componentCount = 0;
    let regionPixelCount = 0;
    for (let componentId = 0; componentId < components.length; componentId += 1) {
      if (predicate(fillRetentions[componentId])) {
        componentCount += 1;
        regionPixelCount += components[componentId].area;
      }
    }
    return category(componentCount, regionPixelCount, components.length, pixelCount);
  };

  return {
    adjacencyByComponent,
    adjacencyByColor,
    classicMask,
    metrics: {
      internalEdgeCount,
      internalEdgeDensity: ratio(internalEdgeCount, pixelCount),
      outputDeltaEMean: round(outputDeltaESum / Math.max(1, internalEdgeCount)),
      strongPixelCount,
      strongPixelShare: ratio(strongPixelCount, pixelCount),
      softPixelCount,
      softPixelShare: ratio(softPixelCount, pixelCount),
      footprintPixelCount: strongPixelCount + softPixelCount,
      footprintPixelShare: ratio(strongPixelCount + softPixelCount, pixelCount),
      weightedInkShare: round(
        (strongPixelCount * STRONG_BOUNDARY_ALPHA + softPixelCount * SOFT_BOUNDARY_ALPHA) / pixelCount,
      ),
      fillRetention: {
        stats: numericStats(fillRetentions),
        zero: retentionCategory((value) => value === 0),
        lt0_25: retentionCategory((value) => value < 0.25),
        lt0_50: retentionCategory((value) => value < 0.5),
        lt0_75: retentionCategory((value) => value < 0.75),
      },
    },
    boundaryContrast: {
      edgeCount: internalEdgeCount,
      deltaEMean: round(outputDeltaESum / Math.max(1, internalEdgeCount)),
      lt8: { edgeCount: deltaECounts[8], edgeShare: ratio(deltaECounts[8], internalEdgeCount) },
      lt12: { edgeCount: deltaECounts[12], edgeShare: ratio(deltaECounts[12], internalEdgeCount) },
      lt16: { edgeCount: deltaECounts[16], edgeShare: ratio(deltaECounts[16], internalEdgeCount) },
    },
    sourceEdgeSupport: sourceAvailable
      ? {
          available: true,
          edgeCount: internalEdgeCount,
          normalSearchRadiusPx: sourceSearchRadius,
          deltaEMean: round(sourceSupportSum / Math.max(1, internalEdgeCount)),
          lt4: { edgeCount: sourceCounts[4], edgeShare: ratio(sourceCounts[4], internalEdgeCount) },
          lt8: { edgeCount: sourceCounts[8], edgeShare: ratio(sourceCounts[8], internalEdgeCount) },
          lt12: { edgeCount: sourceCounts[12], edgeShare: ratio(sourceCounts[12], internalEdgeCount) },
        }
      : {
          available: false,
          reason: 'Prepared input is missing or has different dimensions from cleanColor.',
        },
    sourceEdgeRecall: analyzeSourceEdgeRecall(
      componentMap,
      width,
      height,
      sourceLab,
      sourceSearchRadius,
    ),
  };
}

function analyzeInteriorCores(model, width, height, adjacencyByComponent) {
  const { componentMap, components, componentLab } = model;
  const pixelCount = width * height;
  const distances = new Uint16Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  for (let index = 0; index < pixelCount; index += 1) {
    const x = index % width;
    const y = Math.floor(index / width);
    const componentId = componentMap[index];
    if (
      x === 0
      || x + 1 === width
      || y === 0
      || y + 1 === height
      || componentMap[index - 1] !== componentId
      || componentMap[index + 1] !== componentId
      || componentMap[index - width] !== componentId
      || componentMap[index + width] !== componentId
    ) {
      distances[index] = 1;
      queue[tail] = index;
      tail += 1;
    }
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    const componentId = componentMap[index];
    const nextDistance = distances[index] + 1;
    if (x > 0 && componentMap[index - 1] === componentId && distances[index - 1] === 0) {
      distances[index - 1] = nextDistance;
      queue[tail] = index - 1;
      tail += 1;
    }
    if (x + 1 < width && componentMap[index + 1] === componentId && distances[index + 1] === 0) {
      distances[index + 1] = nextDistance;
      queue[tail] = index + 1;
      tail += 1;
    }
    if (y > 0 && componentMap[index - width] === componentId && distances[index - width] === 0) {
      distances[index - width] = nextDistance;
      queue[tail] = index - width;
      tail += 1;
    }
    if (y + 1 < height && componentMap[index + width] === componentId && distances[index + width] === 0) {
      distances[index + width] = nextDistance;
      queue[tail] = index + width;
      tail += 1;
    }
  }

  const maxDepth = new Uint16Array(components.length);
  for (let index = 0; index < pixelCount; index += 1) {
    const componentId = componentMap[index];
    maxDepth[componentId] = Math.max(maxDepth[componentId], distances[index]);
  }
  const minAdjacentDeltaE = new Float32Array(components.length);
  minAdjacentDeltaE.fill(Number.POSITIVE_INFINITY);
  for (let componentId = 0; componentId < components.length; componentId += 1) {
    for (const neighborId of adjacencyByComponent[componentId].keys()) {
      minAdjacentDeltaE[componentId] = Math.min(
        minAdjacentDeltaE[componentId],
        labDistance(componentLab, componentId, neighborId),
      );
    }
  }

  const scale = Math.max(width, height) / REFERENCE_MAX_EDGE;
  const results = {};
  for (const referenceRadius of CORE_RADII) {
    const radiusPx = Math.max(1, Math.round(referenceRadius * scale));
    let allCount = 0;
    let allPixels = 0;
    let lowContrastCount = 0;
    let lowContrastPixels = 0;
    for (let componentId = 0; componentId < components.length; componentId += 1) {
      if (maxDepth[componentId] > radiusPx) {
        continue;
      }
      allCount += 1;
      allPixels += components[componentId].area;
      if (minAdjacentDeltaE[componentId] < LOW_CONTRAST_DELTA_E) {
        lowContrastCount += 1;
        lowContrastPixels += components[componentId].area;
      }
    }
    results[`r${referenceRadius}`] = {
      radiusPx,
      all: category(allCount, allPixels, components.length, pixelCount),
      lowContrastAdjacentDe12: category(
        lowContrastCount,
        lowContrastPixels,
        components.length,
        pixelCount,
      ),
    };
  }
  return results;
}

function analyzeNarrowSandwich(model, width, height, adjacencyByColor, internalEdgeCount) {
  const { components, componentLab, componentByColor } = model;
  const pixelCount = width * height;
  const scale = Math.max(width, height) / REFERENCE_MAX_EDGE;
  const maxEffectiveWidth = NARROW_BAND_MAX_EFFECTIVE_WIDTH * scale;
  const minSpan = NARROW_BAND_MIN_SPAN * scale;
  const minSecondPixels = Math.max(1, Math.round(NARROW_BAND_SECOND_PIXELS * scale));
  const totals = {
    all: { componentCount: 0, pixelCount: 0, pairedLength: 0 },
    lowContrastDe12: { componentCount: 0, pixelCount: 0, pairedLength: 0 },
    lowContrastDe16: { componentCount: 0, pixelCount: 0, pairedLength: 0 },
  };

  for (let componentId = 0; componentId < components.length; componentId += 1) {
    const component = components[componentId];
    const effectiveWidth = (2 * component.area) / Math.max(1, component.perimeter);
    const span = Math.max(component.maxX - component.minX + 1, component.maxY - component.minY + 1);
    const elongation = span / Math.max(1e-6, effectiveWidth);
    if (
      effectiveWidth > maxEffectiveWidth
      || span < minSpan
      || elongation < NARROW_BAND_MIN_ELONGATION
    ) {
      continue;
    }

    const dominant = [...adjacencyByColor[componentId].entries()]
      .sort((left, right) => right[1] - left[1]);
    if (dominant.length === 0) {
      continue;
    }
    const first = dominant[0];
    const second = dominant[1];
    const dominantTopology = first[1] / Math.max(1, component.perimeter) >= NARROW_BAND_DOMINANT_SHARE;
    const secondMinimum = Math.max(minSecondPixels, component.perimeter * NARROW_BAND_SECOND_SHARE);
    const sandwichTopology = second != null
      && first[1] >= secondMinimum
      && second[1] >= secondMinimum
      && (first[1] + second[1]) / Math.max(1, component.perimeter) >= NARROW_BAND_TOP_TWO_SHARE;
    if (!dominantTopology && !sandwichTopology) {
      continue;
    }

    const pairedLength = dominantTopology ? first[1] / 2 : Math.min(first[1], second[1]);
    let minNeighborDeltaE = Number.POSITIVE_INFINITY;
    for (const [neighborColor] of dominant.slice(0, 2)) {
      const neighborComponent = componentByColor.get(neighborColor);
      if (neighborComponent != null) {
        minNeighborDeltaE = Math.min(
          minNeighborDeltaE,
          labDistance(componentLab, componentId, neighborComponent),
        );
      }
    }
    const add = (bucket) => {
      bucket.componentCount += 1;
      bucket.pixelCount += component.area;
      bucket.pairedLength += pairedLength;
    };
    add(totals.all);
    if (minNeighborDeltaE < 16) add(totals.lowContrastDe16);
    if (minNeighborDeltaE < 12) add(totals.lowContrastDe12);
  }

  const finalize = (bucket) => ({
    componentCount: bucket.componentCount,
    componentShare: ratio(bucket.componentCount, components.length),
    pixelCount: bucket.pixelCount,
    pixelShare: ratio(bucket.pixelCount, pixelCount),
    pairedLength: round(bucket.pairedLength, 2),
    pairedLengthShareOfBoundary: ratio(bucket.pairedLength, internalEdgeCount),
  });
  return {
    policy: {
      maxEffectiveWidthPx: round(maxEffectiveWidth, 3),
      minSpanPx: round(minSpan, 3),
      minElongation: NARROW_BAND_MIN_ELONGATION,
      dominantBoundaryShare: NARROW_BAND_DOMINANT_SHARE,
      topTwoBoundaryShare: NARROW_BAND_TOP_TWO_SHARE,
      secondBoundaryShare: NARROW_BAND_SECOND_SHARE,
      secondBoundaryPixels: minSecondPixels,
    },
    all: finalize(totals.all),
    lowContrastDe12: finalize(totals.lowContrastDe12),
    lowContrastDe16: finalize(totals.lowContrastDe16),
  };
}

function analyzeClassic(width, height, colors, prepared) {
  const model = buildComponents(width, height, colors);
  const sourceLab = prepared != null && prepared.width === width && prepared.height === height
    ? prepared.lab
    : null;
  const boundaries = analyzeBoundaries(model, width, height, sourceLab);
  const areas = model.components.map((component) => component.area);
  return {
    componentCount: model.components.length,
    exactColorCount: new Set(model.components.map((component) => component.color)).size,
    componentArea: numericStats(areas, 2),
    classicBoundary: boundaries.metrics,
    interiorCores: analyzeInteriorCores(
      model,
      width,
      height,
      boundaries.adjacencyByComponent,
    ),
    boundaryContrast: boundaries.boundaryContrast,
    narrowSandwich: analyzeNarrowSandwich(
      model,
      width,
      height,
      boundaries.adjacencyByColor,
      boundaries.metrics.internalEdgeCount,
    ),
    sourceEdgeSupport: boundaries.sourceEdgeSupport,
    sourceEdgeRecall: boundaries.sourceEdgeRecall,
  };
}

async function loadPrepared(result, manifestDir, cache) {
  if (result.preparedPath == null) {
    return { path: null, prepared: null };
  }
  const preparedPath = resolveManifestAsset(manifestDir, result.preparedPath);
  const cacheKey = result.preparedSha256 ?? preparedPath;
  let prepared = cache.get(cacheKey);
  if (prepared == null) {
    const decoded = decodeExactRgb(await readFile(preparedPath));
    prepared = {
      width: decoded.width,
      height: decoded.height,
      lab: buildPixelLab(decoded.colors),
    };
    cache.set(cacheKey, prepared);
  }
  return { path: preparedPath, prepared };
}

function aggregateResults(results, configs) {
  const byConfig = new Map();
  for (const result of results) {
    let aggregate = byConfig.get(result.configId);
    if (aggregate == null) {
      const config = configs.get(result.configId);
      aggregate = {
        configId: result.configId,
        label: config?.label ?? null,
        resultCount: 0,
        pixels: 0,
        components: 0,
        boundaryEdges: 0,
        strongPixels: 0,
        softPixels: 0,
        fillLt50: 0,
        coreR5: 0,
        lowContrastCoreR5: 0,
        boundaryDe12: 0,
        narrowCount: 0,
        narrowPaired: 0,
        sourceEdges: 0,
        sourceUnsupported8: 0,
        sourceRecallAvailableResults: 0,
        sourceRecallEdges12: 0,
        sourceRecalledEdges12: 0,
        sourceRecallEdges16: 0,
        sourceRecalledEdges16: 0,
      };
      byConfig.set(result.configId, aggregate);
    }
    const metrics = result.metrics;
    aggregate.resultCount += 1;
    aggregate.pixels += result.pixelCount;
    aggregate.components += metrics.componentCount;
    aggregate.boundaryEdges += metrics.classicBoundary.internalEdgeCount;
    aggregate.strongPixels += metrics.classicBoundary.strongPixelCount;
    aggregate.softPixels += metrics.classicBoundary.softPixelCount;
    aggregate.fillLt50 += metrics.classicBoundary.fillRetention.lt0_50.componentCount;
    aggregate.coreR5 += metrics.interiorCores.r5.all.componentCount;
    aggregate.lowContrastCoreR5 += metrics.interiorCores.r5.lowContrastAdjacentDe12.componentCount;
    aggregate.boundaryDe12 += metrics.boundaryContrast.lt12.edgeCount;
    aggregate.narrowCount += metrics.narrowSandwich.lowContrastDe12.componentCount;
    aggregate.narrowPaired += metrics.narrowSandwich.lowContrastDe12.pairedLength;
    if (metrics.sourceEdgeSupport.available) {
      aggregate.sourceEdges += metrics.sourceEdgeSupport.edgeCount;
      aggregate.sourceUnsupported8 += metrics.sourceEdgeSupport.lt8.edgeCount;
    }
    if (metrics.sourceEdgeRecall.available) {
      aggregate.sourceRecallAvailableResults += 1;
      aggregate.sourceRecallEdges12 += metrics.sourceEdgeRecall.ge12.sourceEdgeCount;
      aggregate.sourceRecalledEdges12 += metrics.sourceEdgeRecall.ge12.recalledEdgeCount;
      aggregate.sourceRecallEdges16 += metrics.sourceEdgeRecall.ge16.sourceEdgeCount;
      aggregate.sourceRecalledEdges16 += metrics.sourceEdgeRecall.ge16.recalledEdgeCount;
    }
  }

  return [...byConfig.values()].map((item) => ({
    configId: item.configId,
    label: item.label,
    resultCount: item.resultCount,
    componentCount: item.components,
    componentCountPerResult: round(item.components / item.resultCount, 2),
    boundaryEdgeCount: item.boundaryEdges,
    boundaryEdgeDensity: ratio(item.boundaryEdges, item.pixels),
    classicBoundaryFootprintShare: ratio(item.strongPixels + item.softPixels, item.pixels),
    classicWeightedInkShare: round(
      (item.strongPixels * STRONG_BOUNDARY_ALPHA + item.softPixels * SOFT_BOUNDARY_ALPHA) / item.pixels,
    ),
    fillRetentionLt0_50: {
      componentCount: item.fillLt50,
      componentShare: ratio(item.fillLt50, item.components),
    },
    corelessR5: {
      componentCount: item.coreR5,
      componentShare: ratio(item.coreR5, item.components),
      lowContrastComponentCount: item.lowContrastCoreR5,
      lowContrastComponentShare: ratio(item.lowContrastCoreR5, item.components),
    },
    boundaryDeltaELt12Share: ratio(item.boundaryDe12, item.boundaryEdges),
    lowContrastNarrowSandwich: {
      componentCount: item.narrowCount,
      componentShare: ratio(item.narrowCount, item.components),
      pairedLength: round(item.narrowPaired, 2),
      pairedLengthShareOfBoundary: ratio(item.narrowPaired, item.boundaryEdges),
    },
    sourceEdgeUnsupportedLt8Share: item.sourceEdges > 0
      ? ratio(item.sourceUnsupported8, item.sourceEdges)
      : null,
    sourceEdgeRecall: item.sourceRecallAvailableResults > 0
      ? {
          availableResultCount: item.sourceRecallAvailableResults,
          ge12: {
            sourceEdgeCount: item.sourceRecallEdges12,
            recalledEdgeCount: item.sourceRecalledEdges12,
            recallShare: ratio(item.sourceRecalledEdges12, item.sourceRecallEdges12),
          },
          ge16: {
            sourceEdgeCount: item.sourceRecallEdges16,
            recalledEdgeCount: item.sourceRecalledEdges16,
            recallShare: ratio(item.sourceRecalledEdges16, item.sourceRecallEdges16),
          },
        }
      : null,
  }));
}

function printSummary(report) {
  console.log(`Analyzed ${report.results.length} Classic/cleanColor result(s) from ${report.manifestPath}`);
  if (report.skipped.length > 0) {
    console.log(`Skipped ${report.skipped.length} result(s); details are included in the JSON report.`);
  }
  console.log('\nPer result');
  console.table(report.results.map((result) => {
    const metrics = result.metrics;
    return {
      source: result.sourceId,
      config: result.configId,
      regions: metrics.componentCount,
      'B / px': metrics.classicBoundary.internalEdgeDensity,
      footprint: percent(metrics.classicBoundary.footprintPixelShare),
      ink: percent(metrics.classicBoundary.weightedInkShare),
      'fill <50%': metrics.classicBoundary.fillRetention.lt0_50.componentCount,
      'coreless r5': metrics.interiorCores.r5.all.componentCount,
      'LC core r5': metrics.interiorCores.r5.lowContrastAdjacentDe12.componentCount,
      'boundary DE<12': percent(metrics.boundaryContrast.lt12.edgeShare),
      'LC bands': metrics.narrowSandwich.lowContrastDe12.componentCount,
      'LC paired / B': percent(metrics.narrowSandwich.lowContrastDe12.pairedLengthShareOfBoundary),
      'source <8': metrics.sourceEdgeSupport.available
        ? percent(metrics.sourceEdgeSupport.lt8.edgeShare)
        : '-',
      'source recall >=12': metrics.sourceEdgeRecall.available
        ? percent(metrics.sourceEdgeRecall.ge12.recallShare)
        : '-',
      'source recall >=16': metrics.sourceEdgeRecall.available
        ? percent(metrics.sourceEdgeRecall.ge16.recallShare)
        : '-',
    };
  }));

  console.log('\nAggregate by config');
  console.table(report.aggregateByConfig.map((item) => ({
    config: item.configId,
    images: item.resultCount,
    regions: item.componentCount,
    'B / px': item.boundaryEdgeDensity,
    footprint: percent(item.classicBoundaryFootprintShare),
    ink: percent(item.classicWeightedInkShare),
    'fill <50%': item.fillRetentionLt0_50.componentCount,
    'coreless r5': item.corelessR5.componentCount,
    'LC core r5': item.corelessR5.lowContrastComponentCount,
    'boundary DE<12': percent(item.boundaryDeltaELt12Share),
    'LC bands': item.lowContrastNarrowSandwich.componentCount,
    'LC paired / B': percent(item.lowContrastNarrowSandwich.pairedLengthShareOfBoundary),
    'source <8': item.sourceEdgeUnsupportedLt8Share == null
      ? '-'
      : percent(item.sourceEdgeUnsupportedLt8Share),
    'source recall >=12': item.sourceEdgeRecall == null
      ? '-'
      : percent(item.sourceEdgeRecall.ge12.recallShare),
    'source recall >=16': item.sourceEdgeRecall == null
      ? '-'
      : percent(item.sourceEdgeRecall.ge16.recallShare),
  })));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (options.manifestPath == null) {
    printUsage();
    throw new Error('A Pipeline Lab manifest path is required.');
  }

  const manifestPath = resolveInputPath(options.manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const configs = new Map((manifest.configs ?? []).map((config) => [config.id, config]));
  const configFilter = new Set(options.configIds);
  const preparedCache = new Map();
  const results = [];
  const skipped = [];

  for (const result of manifest.results ?? []) {
    if (result.status !== 'ok') {
      continue;
    }
    if (configFilter.size > 0 && !configFilter.has(result.configId)) {
      continue;
    }
    const cleanColor = result.variants?.find((variant) => variant.id === 'cleanColor' && variant.pngPath != null);
    if (cleanColor == null) {
      skipped.push({ sourceId: result.sourceId, configId: result.configId, reason: 'cleanColor PNG is missing' });
      continue;
    }
    const classic = result.variants?.find((variant) => variant.id === 'classic' && variant.pngPath != null);
    const cleanColorPath = resolveManifestAsset(manifestDir, cleanColor.pngPath);
    try {
      const decoded = decodeExactRgb(await readFile(cleanColorPath));
      const loadedPrepared = await loadPrepared(result, manifestDir, preparedCache);
      results.push({
        sourceId: result.sourceId,
        inputId: result.inputId ?? null,
        sourceCaseId: result.sourceCaseId ?? null,
        configId: result.configId,
        cleanColorPath,
        classicPath: classic == null ? null : resolveManifestAsset(manifestDir, classic.pngPath),
        preparedPath: loadedPrepared.path,
        width: decoded.width,
        height: decoded.height,
        pixelCount: decoded.width * decoded.height,
        manifestFacetCount: result.facetCount ?? null,
        paletteCount: result.paletteCount ?? null,
        metrics: analyzeClassic(
          decoded.width,
          decoded.height,
          decoded.colors,
          loadedPrepared.prepared,
        ),
      });
    } catch (error) {
      skipped.push({
        sourceId: result.sourceId,
        configId: result.configId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    manifestPath,
    metricContract: {
      referenceMaxEdge: REFERENCE_MAX_EDGE,
      componentConnectivity: 4,
      classicBoundary: {
        strongAlpha: STRONG_BOUNDARY_ALPHA,
        softAlpha: SOFT_BOUNDARY_ALPHA,
        softHalo: 'Chebyshev radius 1 around strong transition endpoints',
      },
      coreRadiiAtReference: CORE_RADII,
      boundaryDeltaEThresholds: DELTA_E_THRESHOLDS,
      lowContrastDeltaE: LOW_CONTRAST_DELTA_E,
      sourceEdgeThresholds: SOURCE_EDGE_THRESHOLDS,
      sourceEdgeRecallThresholds: SOURCE_EDGE_RECALL_THRESHOLDS,
      sourceEdgeNormalSearchRadiusAtReference: SOURCE_EDGE_SEARCH_RADIUS,
      sourceEdgeRecallMatch: 'Same-orientation output boundary within the normal search radius',
      narrowSandwich: {
        maxEffectiveWidthAtReference: NARROW_BAND_MAX_EFFECTIVE_WIDTH,
        minSpanAtReference: NARROW_BAND_MIN_SPAN,
        minElongation: NARROW_BAND_MIN_ELONGATION,
        dominantBoundaryShare: NARROW_BAND_DOMINANT_SHARE,
        topTwoBoundaryShare: NARROW_BAND_TOP_TWO_SHARE,
        secondBoundaryShare: NARROW_BAND_SECOND_SHARE,
        secondBoundaryPixelsAtReference: NARROW_BAND_SECOND_PIXELS,
      },
    },
    results,
    skipped,
    aggregateByConfig: aggregateResults(results, configs),
  };

  printSummary(report);
  if (options.jsonPath != null) {
    const jsonPath = resolveOutputPath(options.jsonPath);
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nJSON report written to ${jsonPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
