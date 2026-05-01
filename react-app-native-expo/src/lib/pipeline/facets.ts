import { clampInteger, compactLabelsByPalette, facetColorDistanceMatrix } from './colorMath';
import { FACET_DETAIL_PROTECT_LAB_DISTANCE, FACET_FORCE_MERGE_BELOW, FACET_MAX_COUNT, FACET_REMOVE_LARGE_TO_SMALL, FACET_SMALL_THRESHOLD } from './constants';
import type { Facet, FacetPoint, FacetResult, RegionInfo } from './placement';

function facetFill(
  x: number,
  y: number,
  width: number,
  height: number,
  visited: (i: number, j: number) => boolean,
  setFill: (i: number, j: number) => void,
): void {
  let currentX = x;
  let currentY = y;
  while (true) {
    const originX = currentX;
    const originY = currentY;
    while (currentY !== 0 && !visited(currentX, currentY - 1)) currentY -= 1;
    while (currentX !== 0 && !visited(currentX - 1, currentY)) currentX -= 1;
    if (currentX === originX && currentY === originY) break;
  }
  facetFillCore(currentX, currentY, width, height, visited, setFill);
}

function facetFillCore(
  x: number,
  y: number,
  width: number,
  height: number,
  visited: (i: number, j: number) => boolean,
  setFill: (i: number, j: number) => void,
): void {
  let lastRowLength = 0;
  do {
    let rowLength = 0;
    let startX = x;
    if (lastRowLength !== 0 && visited(x, y)) {
      do {
        if (--lastRowLength === 0) return;
      } while (visited(++x, y));
      startX = x;
    } else {
      for (; x !== 0 && !visited(x - 1, y); rowLength += 1, lastRowLength += 1) {
        x -= 1;
        setFill(x, y);
        if (y !== 0 && !visited(x, y - 1)) facetFill(x, y - 1, width, height, visited, setFill);
      }
    }
    for (; startX < width && !visited(startX, y); rowLength += 1, startX += 1) {
      setFill(startX, y);
    }
    if (rowLength < lastRowLength) {
      for (const end = x + lastRowLength; ++startX < end;) {
        if (!visited(startX, y)) facetFillCore(startX, y, width, height, visited, setFill);
      }
    } else if (rowLength > lastRowLength && y !== 0) {
      for (let upperX = x + lastRowLength; ++upperX < startX;) {
        if (!visited(upperX, y - 1)) facetFill(upperX, y - 1, width, height, visited, setFill);
      }
    }
    lastRowLength = rowLength;
  } while (lastRowLength !== 0 && ++y < height);
}

function facetBuildOne(
  facetIndex: number,
  facetColorIndex: number,
  x: number,
  y: number,
  visitedArray: Uint8Array,
  colorIndices: Int32Array,
  facetMap: Uint32Array,
  width: number,
  height: number,
): Facet {
  const facet: Facet = {
    id: facetIndex,
    color: facetColorIndex,
    pointCount: 0,
    borderPoints: [],
    neighbourFacets: null,
    neighbourFacetsIsDirty: true,
    bbox: {
      minX: Number.MAX_SAFE_INTEGER,
      minY: Number.MAX_SAFE_INTEGER,
      maxX: 0,
      maxY: 0,
    },
  };

  facetFill(
    x,
    y,
    width,
    height,
    (pointX, pointY) => visitedArray[pointY * width + pointX] !== 0 || colorIndices[pointY * width + pointX] !== facetColorIndex,
    (pointX, pointY) => {
      const index = pointY * width + pointX;
      visitedArray[index] = 1;
      facetMap[index] = facetIndex;
      facet.pointCount += 1;
      const isInner =
        pointX - 1 >= 0 && colorIndices[index - 1] === facetColorIndex &&
        pointY - 1 >= 0 && colorIndices[index - width] === facetColorIndex &&
        pointX + 1 < width && colorIndices[index + 1] === facetColorIndex &&
        pointY + 1 < height && colorIndices[index + width] === facetColorIndex;
      if (!isInner) {
        facet.borderPoints.push({ x: pointX, y: pointY });
      }
      if (pointX > facet.bbox.maxX) facet.bbox.maxX = pointX;
      if (pointY > facet.bbox.maxY) facet.bbox.maxY = pointY;
      if (pointX < facet.bbox.minX) facet.bbox.minX = pointX;
      if (pointY < facet.bbox.minY) facet.bbox.minY = pointY;
    },
  );

  return facet;
}

export function facetBuildNeighbour(facet: Facet, result: FacetResult): void {
  const neighbours = new Set<number>();
  const { facetMap, width, height } = result;
  for (const point of facet.borderPoints) {
    const index = point.y * width + point.x;
    if (point.x - 1 >= 0) {
      const value = facetMap[index - 1];
      if (value !== facet.id) neighbours.add(value);
    }
    if (point.y - 1 >= 0) {
      const value = facetMap[index - width];
      if (value !== facet.id) neighbours.add(value);
    }
    if (point.x + 1 < width) {
      const value = facetMap[index + 1];
      if (value !== facet.id) neighbours.add(value);
    }
    if (point.y + 1 < height) {
      const value = facetMap[index + width];
      if (value !== facet.id) neighbours.add(value);
    }
  }
  facet.neighbourFacets = [...neighbours];
  facet.neighbourFacetsIsDirty = false;
}

export function facetGetAll(colorIndices: Int32Array, width: number, height: number): FacetResult {
  const visitedArray = new Uint8Array(width * height);
  const facetMap = new Uint32Array(width * height);
  const facets: (Facet | null)[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (visitedArray[y * width + x] === 0) {
        const colorIndex = colorIndices[y * width + x];
        const facetIndex = facets.length;
        facets.push(facetBuildOne(facetIndex, colorIndex, x, y, visitedArray, colorIndices, facetMap, width, height));
      }
    }
  }
  const result: FacetResult = { facetMap, facets, width, height };
  for (const facet of facets) {
    if (facet != null) {
      facetBuildNeighbour(facet, result);
    }
  }
  return result;
}

function facetMostSimilarNeighbour(facetToRemove: Facet, result: FacetResult, colorDistances: number[][]): number {
  let bestNeighbour = -1;
  let bestDistance = Number.MAX_VALUE;
  if (facetToRemove.neighbourFacetsIsDirty) facetBuildNeighbour(facetToRemove, result);
  for (const neighbourIndex of facetToRemove.neighbourFacets ?? []) {
    const neighbour = result.facets[neighbourIndex];
    if (neighbour != null) {
      const distance = colorDistances[facetToRemove.color][neighbour.color];
      if (distance < bestDistance) {
        bestDistance = distance;
        bestNeighbour = neighbourIndex;
      }
    }
  }
  return bestNeighbour;
}

function facetRebuildChangedNeighbours(
  visitedArray: Uint8Array,
  facetToRemove: Facet,
  colorIndices: Int32Array,
  result: FacetResult,
): void {
  const changedNeighbours = new Set<number>();
  if (facetToRemove.neighbourFacetsIsDirty) facetBuildNeighbour(facetToRemove, result);
  for (const neighbourIndex of facetToRemove.neighbourFacets ?? []) {
    const neighbour = result.facets[neighbourIndex];
    if (neighbour != null) {
      changedNeighbours.add(neighbourIndex);
      if (neighbour.neighbourFacetsIsDirty) facetBuildNeighbour(neighbour, result);
      for (const nested of neighbour.neighbourFacets ?? []) {
        changedNeighbours.add(nested);
      }
      const rebuildSource = neighbour.borderPoints[0];
      const rebuilt = facetBuildOne(
        neighbourIndex,
        neighbour.color,
        rebuildSource.x,
        rebuildSource.y,
        visitedArray,
        colorIndices,
        result.facetMap,
        result.width,
        result.height,
      );
      result.facets[neighbourIndex] = rebuilt.pointCount === 0 ? null : rebuilt;
    }
  }

  for (const neighbourIndex of facetToRemove.neighbourFacets ?? []) {
    const neighbour = result.facets[neighbourIndex];
    if (neighbour != null) {
      for (let y = neighbour.bbox.minY; y <= neighbour.bbox.maxY; y += 1) {
        for (let x = neighbour.bbox.minX; x <= neighbour.bbox.maxX; x += 1) {
          if (result.facetMap[y * result.width + x] === neighbour.id) {
            visitedArray[y * result.width + x] = 0;
          }
        }
      }
    }
  }

  for (const neighbourIndex of changedNeighbours) {
    const facet = result.facets[neighbourIndex];
    if (facet != null) {
      facet.neighbourFacets = null;
      facet.neighbourFacetsIsDirty = true;
    }
  }
}

function facetRebuildForChange(
  visitedArray: Uint8Array,
  facet: Facet,
  colorIndices: Int32Array,
  result: FacetResult,
): void {
  facetRebuildChangedNeighbours(visitedArray, facet, colorIndices, result);
  let needsRebuild = false;
  const { width, height } = result;
  for (let y = facet.bbox.minY; y <= facet.bbox.maxY; y += 1) {
    for (let x = facet.bbox.minX; x <= facet.bbox.maxX; x += 1) {
      const index = y * width + x;
      if (result.facetMap[index] === facet.id) {
        needsRebuild = true;
        if (x - 1 >= 0 && result.facetMap[index - 1] !== facet.id && result.facets[result.facetMap[index - 1]] != null) {
          colorIndices[index] = result.facets[result.facetMap[index - 1]]!.color;
        } else if (y - 1 >= 0 && result.facetMap[index - width] !== facet.id && result.facets[result.facetMap[index - width]] != null) {
          colorIndices[index] = result.facets[result.facetMap[index - width]]!.color;
        } else if (x + 1 < width && result.facetMap[index + 1] !== facet.id && result.facets[result.facetMap[index + 1]] != null) {
          colorIndices[index] = result.facets[result.facetMap[index + 1]]!.color;
        } else if (y + 1 < height && result.facetMap[index + width] !== facet.id && result.facets[result.facetMap[index + width]] != null) {
          colorIndices[index] = result.facets[result.facetMap[index + width]]!.color;
        }
      }
    }
  }
  if (needsRebuild) {
    facetRebuildChangedNeighbours(visitedArray, facet, colorIndices, result);
  }
}

function facetDelete(
  facetIdToRemove: number,
  result: FacetResult,
  colorIndices: Int32Array,
  colorDistances: number[][],
  visitedArray: Uint8Array,
): void {
  const facetToRemove = result.facets[facetIdToRemove];
  if (facetToRemove == null) {
    return;
  }
  if (facetToRemove.neighbourFacetsIsDirty) facetBuildNeighbour(facetToRemove, result);
  if ((facetToRemove.neighbourFacets ?? []).length > 0) {
    const bestNeighbour = facetMostSimilarNeighbour(facetToRemove, result, colorDistances);
    if (bestNeighbour !== -1) {
      const newColor = result.facets[bestNeighbour]!.color;
      for (let y = facetToRemove.bbox.minY; y <= facetToRemove.bbox.maxY; y += 1) {
        for (let x = facetToRemove.bbox.minX; x <= facetToRemove.bbox.maxX; x += 1) {
          const index = y * result.width + x;
          if (result.facetMap[index] === facetToRemove.id) {
            colorIndices[index] = newColor;
          }
        }
      }
    }
  }
  facetRebuildForChange(visitedArray, facetToRemove, colorIndices, result);
  result.facets[facetToRemove.id] = null;
}

function facetIsHighContrast(facet: Facet, result: FacetResult, colorDistances: number[][]): boolean {
  if (facet.neighbourFacetsIsDirty) facetBuildNeighbour(facet, result);
  if (!facet.neighbourFacets || facet.neighbourFacets.length === 0) {
    return false;
  }
  let minimumDistance = Number.MAX_VALUE;
  for (const neighbourIndex of facet.neighbourFacets) {
    const neighbour = result.facets[neighbourIndex];
    if (neighbour != null) {
      const distance = colorDistances[facet.color][neighbour.color];
      if (distance < minimumDistance) minimumDistance = distance;
    }
  }
  return minimumDistance > FACET_DETAIL_PROTECT_LAB_DISTANCE;
}

export function facetReduce(
  smallerThan: number,
  paletteRgb: Uint8Array,
  facets: FacetResult,
  colorIndices: Int32Array,
  protectHighContrast = false,
  highContrastMinPx = FACET_FORCE_MERGE_BELOW,
  removeLargeToSmall = FACET_REMOVE_LARGE_TO_SMALL,
  maxFacets = FACET_MAX_COUNT,
): void {
  const visitedArray = new Uint8Array(facets.width * facets.height);
  const colorDistances = facetColorDistanceMatrix(paletteRgb);
  const order = facets.facets
    .filter((facet): facet is Facet => facet != null)
    .slice(0)
    .sort((left, right) => right.pointCount - left.pointCount || left.id - right.id)
    .map((facet) => facet.id);
  if (!removeLargeToSmall) order.reverse();
  for (const facetId of order) {
    const facet = facets.facets[facetId];
    if (facet != null && facet.pointCount < smallerThan) {
      if (protectHighContrast && facet.pointCount >= highContrastMinPx && facetIsHighContrast(facet, facets, colorDistances)) {
        continue;
      }
      facetDelete(facet.id, facets, colorIndices, colorDistances, visitedArray);
    }
  }

  let facetCount = facets.facets.filter((facet) => facet != null).length;
  while (facetCount > maxFacets) {
    const reorder = facets.facets
      .filter((facet): facet is Facet => facet != null)
      .sort((left, right) => left.pointCount - right.pointCount || left.id - right.id);
    if (reorder.length === 0) {
      break;
    }
    facetDelete(reorder[0].id, facets, colorIndices, colorDistances, visitedArray);
    facetCount = facets.facets.filter((facet) => facet != null).length;
  }
}

export type ReducedRegionResult = {
  width: number;
  height: number;
  colorCount: number;
  labelMap: Int32Array;
  paletteRgb: Uint8Array;
  facets: FacetResult;
  regions: RegionInfo[];
};

export function applyRegionMergingTyped(args: {
  labelMap: Int32Array;
  width: number;
  height: number;
  paletteRgb: Uint8Array;
  minRegionSize?: number;
  protectHighContrast?: boolean;
  highContrastMinPx?: number;
}): ReducedRegionResult {
  const threshold = args.minRegionSize != null && args.minRegionSize >= 1 ? args.minRegionSize : FACET_SMALL_THRESHOLD;
  const highContrastFloor = args.highContrastMinPx != null && args.highContrastMinPx >= 1 ? args.highContrastMinPx : FACET_FORCE_MERGE_BELOW;

  const colorIndices = new Int32Array(args.labelMap);
  const facets = facetGetAll(colorIndices, args.width, args.height);
  facetReduce(threshold, args.paletteRgb, facets, colorIndices, args.protectHighContrast ?? false, highContrastFloor);
  const compacted = compactLabelsByPalette(new Int32Array(colorIndices), args.paletteRgb, args.width, args.height);

  const secondPassIndices = new Int32Array(compacted.labelMap);
  const secondPassFacets = facetGetAll(secondPassIndices, args.width, args.height);
  facetReduce(threshold, compacted.paletteRgb, secondPassFacets, secondPassIndices, args.protectHighContrast ?? false, highContrastFloor);
  const compactedSecondPass = compactLabelsByPalette(new Int32Array(secondPassIndices), compacted.paletteRgb, args.width, args.height);
  const finalFacets = facetGetAll(compactedSecondPass.labelMap, args.width, args.height);

  const regions: RegionInfo[] = [];
  for (const facet of finalFacets.facets) {
    if (facet != null) {
      regions.push({
        regionId: facet.id,
        colorIndex: facet.color,
        area: facet.pointCount,
        bbox: [facet.bbox.minX, facet.bbox.minY, facet.bbox.maxX + 1, facet.bbox.maxY + 1],
      });
    }
  }

  return {
    width: args.width,
    height: args.height,
    colorCount: compactedSecondPass.paletteRgb.length / 3,
    labelMap: compactedSecondPass.labelMap,
    paletteRgb: compactedSecondPass.paletteRgb,
    facets: finalFacets,
    regions,
  };
}

export function buildBoundaryMask(regionMap: Int32Array, width: number, height: number): Uint8Array {
  const boundary = new Uint8Array(regionMap.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const current = regionMap[index];
      if (x + 1 < width && current !== regionMap[index + 1]) {
        boundary[index] = 1;
        continue;
      }
      if (y + 1 < height && current !== regionMap[index + width]) {
        boundary[index] = 1;
      }
    }
  }
  return boundary;
}

export function clampCircleToCanvas(x: number, y: number, radius: number, width: number, height: number): [number, number, number] {
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
