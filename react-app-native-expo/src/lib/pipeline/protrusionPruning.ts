import { rgbPaletteToLab } from './colorMath';
import { FACET_DETAIL_PROTECT_LAB_DISTANCE, THIN_PROTRUSION_KERNEL_RADIUS, THIN_PROTRUSION_MAX_FILL_STEPS } from './constants';

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
  const contrastThresholdSquared = FACET_DETAIL_PROTECT_LAB_DISTANCE * FACET_DETAIL_PROTECT_LAB_DISTANCE;
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
            if (neighbourLabel === label) {
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
