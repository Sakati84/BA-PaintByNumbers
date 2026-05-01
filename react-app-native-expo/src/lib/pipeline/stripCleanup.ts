import { HARD_EDGE_PROTECTION_LAB_DISTANCE } from './constants';
import { labelPixelCounts, paletteColorDistanceSquared } from './colorMath';

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