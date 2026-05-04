import { rgbPaletteToLab } from "./colorMath";
import { HARD_EDGE_PROTECTION_LAB_DISTANCE, THIN_PROTRUSION_KERNEL_RADIUS, THIN_PROTRUSION_MAX_FILL_STEPS } from "./constants";
import { labelPixelCounts, paletteColorDistanceSquared } from "./colorMath";

export function cleanupNarrowPixelStrips(
  labelMap: Int32Array,
  paletteLab: Uint8Array,
  width: number,
  height: number,
  runs: number,
): Int32Array {
  return cleanupNarrowPixelStripsDetailed(labelMap, paletteLab, width, height, runs).labelMap;
}

export function cleanupNarrowPixelStripsDetailed(
  labelMap: Int32Array,
  paletteLab: Uint8Array,
  width: number,
  height: number,
  runs: number,
): { labelMap: Int32Array; changed: boolean } {
  if (width < 3 || height < 3) {
    return { labelMap: new Int32Array(labelMap), changed: false };
  }

  let cleaned = new Int32Array(labelMap);
  let changedAnyOverall = false;
  const maxDistanceSquared = HARD_EDGE_PROTECTION_LAB_DISTANCE * HARD_EDGE_PROTECTION_LAB_DISTANCE;

  for (let run = 0; run < Math.max(1, Math.trunc(runs)); run += 1) {
    const counts = labelPixelCounts(cleaned, paletteLab.length / 3);
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
          if (paletteColorDistanceSquared(paletteLab, center, target) > maxDistanceSquared) {
            return;
          }
          const targetStrength = counts[target];
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

export function pruneThinProtrusions(
  labelMap: Int32Array,
  width: number,
  height: number,
  paletteRgb: Uint8Array,
  kernelRadius?: number,
): Int32Array {
  const pruned = new Int32Array(labelMap);
  const radius = Math.max(1, kernelRadius ?? THIN_PROTRUSION_KERNEL_RADIUS);
  const minWidth = radius + 1;
  const paletteLab = rgbPaletteToLab(paletteRgb);
  const contrastThresholdSquared = HARD_EDGE_PROTECTION_LAB_DISTANCE * HARD_EDGE_PROTECTION_LAB_DISTANCE;
  const directions: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]];

  for (let pass = 0; pass < THIN_PROTRUSION_MAX_FILL_STEPS; pass += 1) {
    let changed = false;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const label = pruned[index];

        let isThin = false;
        for (const [dx, dy] of directions) {
          let negative = 0;
          for (let step = 1; step < minWidth; step += 1) {
            const nextX = x - dx * step;
            const nextY = y - dy * step;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) break;
            if (pruned[nextY * width + nextX] !== label) break;
            negative += 1;
          }

          let positive = 0;
          for (let step = 1; step < minWidth; step += 1) {
            const nextX = x + dx * step;
            const nextY = y + dy * step;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) break;
            if (pruned[nextY * width + nextX] !== label) break;
            positive += 1;
          }

          if (negative + 1 + positive < minWidth) {
            isThin = true;
            break;
          }
        }

        if (!isThin) {
          continue;
        }

        let bestLabel = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nextX = x + dx;
            const nextY = y + dy;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
              continue;
            }
            const neighbourLabel = pruned[nextY * width + nextX];
            if (neighbourLabel === label || neighbourLabel < 0) {
              continue;
            }
            const labelOffset = label * 3;
            const neighbourOffset = neighbourLabel * 3;
            const deltaL = paletteLab[labelOffset] - paletteLab[neighbourOffset];
            const deltaA = paletteLab[labelOffset + 1] - paletteLab[neighbourOffset + 1];
            const deltaB = paletteLab[labelOffset + 2] - paletteLab[neighbourOffset + 2];
            const distance = deltaL * deltaL + deltaA * deltaA + deltaB * deltaB;
            if (distance < bestDistance) {
              bestDistance = distance;
              bestLabel = neighbourLabel;
            }
          }
        }

        if (bestLabel >= 0 && bestDistance < contrastThresholdSquared) {
          pruned[index] = bestLabel;
          changed = true;
        }
      }
    }
    if (!changed) {
      break;
    }
  }

  return pruned;
}
