import { clampInteger } from './colorMath';

export type RegionInfo = {
  regionId: number;
  colorIndex: number;
  area: number;
  bbox: [number, number, number, number];
};

export type LabelPlacement = {
  regionId: number;
  x: number;
  y: number;
  radius: number;
};

export type FacetBBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type FacetPoint = {
  x: number;
  y: number;
};

export type Facet = {
  id: number;
  color: number;
  pointCount: number;
  borderPoints: FacetPoint[];
  neighbourFacets: number[] | null;
  neighbourFacetsIsDirty: boolean;
  bbox: FacetBBox;
};

export type FacetResult = {
  facetMap: Uint32Array;
  facets: (Facet | null)[];
  width: number;
  height: number;
};

export function precomputeLabelPlacementsFast(
  facets: FacetResult,
  regions: RegionInfo[],
  minLabelArea: number,
): Map<number, LabelPlacement> {
  const placements = new Map<number, LabelPlacement>();
  for (const region of regions) {
    if (region.area < minLabelArea) {
      continue;
    }
    const facet = facets.facets[region.regionId];
    if (!facet || facet.borderPoints.length === 0) {
      continue;
    }

    const [minX, minY, maxXExclusive, maxYExclusive] = region.bbox;
    const boxWidth = maxXExclusive - minX;
    const boxHeight = maxYExclusive - minY;
    if (boxWidth <= 0 || boxHeight <= 0) {
      continue;
    }

    const mask = new Uint8Array(boxWidth * boxHeight);
    for (let localY = 0; localY < boxHeight; localY += 1) {
      for (let localX = 0; localX < boxWidth; localX += 1) {
        if (facets.facetMap[(minY + localY) * facets.width + minX + localX] === facet.id) {
          mask[localY * boxWidth + localX] = 1;
        }
      }
    }

    const distance = new Float32Array(boxWidth * boxHeight);
    const inf = boxWidth + boxHeight;
    for (let index = 0; index < mask.length; index += 1) {
      distance[index] = mask[index] ? inf : 0;
    }

    for (let localY = 0; localY < boxHeight; localY += 1) {
      for (let localX = 0; localX < boxWidth; localX += 1) {
        const globalX = minX + localX;
        const globalY = minY + localY;
        if (globalX === 0 || globalY === 0 || globalX === facets.width - 1 || globalY === facets.height - 1) {
          distance[localY * boxWidth + localX] = 0;
        }
      }
    }

    for (let localY = 0; localY < boxHeight; localY += 1) {
      for (let localX = 0; localX < boxWidth; localX += 1) {
        const index = localY * boxWidth + localX;
        if (distance[index] === 0) {
          continue;
        }
        if (localY > 0) distance[index] = Math.min(distance[index], distance[(localY - 1) * boxWidth + localX] + 1);
        if (localX > 0) distance[index] = Math.min(distance[index], distance[localY * boxWidth + localX - 1] + 1);
        if (localY > 0 && localX > 0) distance[index] = Math.min(distance[index], distance[(localY - 1) * boxWidth + localX - 1] + 1.414);
        if (localY > 0 && localX + 1 < boxWidth) distance[index] = Math.min(distance[index], distance[(localY - 1) * boxWidth + localX + 1] + 1.414);
      }
    }

    for (let localY = boxHeight - 1; localY >= 0; localY -= 1) {
      for (let localX = boxWidth - 1; localX >= 0; localX -= 1) {
        const index = localY * boxWidth + localX;
        if (distance[index] === 0) {
          continue;
        }
        if (localY + 1 < boxHeight) distance[index] = Math.min(distance[index], distance[(localY + 1) * boxWidth + localX] + 1);
        if (localX + 1 < boxWidth) distance[index] = Math.min(distance[index], distance[localY * boxWidth + localX + 1] + 1);
        if (localY + 1 < boxHeight && localX + 1 < boxWidth) distance[index] = Math.min(distance[index], distance[(localY + 1) * boxWidth + localX + 1] + 1.414);
        if (localY + 1 < boxHeight && localX > 0) distance[index] = Math.min(distance[index], distance[(localY + 1) * boxWidth + localX - 1] + 1.414);
      }
    }

    let maxDistance = 0;
    let bestX = 0;
    let bestY = 0;
    for (let localY = 0; localY < boxHeight; localY += 1) {
      for (let localX = 0; localX < boxWidth; localX += 1) {
        const value = distance[localY * boxWidth + localX];
        if (value > maxDistance) {
          maxDistance = value;
          bestX = localX;
          bestY = localY;
        }
      }
    }

    placements.set(region.regionId, {
      regionId: region.regionId,
      x: clampInteger(minX + bestX, 0, facets.width - 1),
      y: clampInteger(minY + bestY, 0, facets.height - 1),
      radius: maxDistance,
    });
  }
  return placements;
}
