import { FACET_DETAIL_PROTECT_LAB_DISTANCE, KMEANS_MERGE_SIMILAR_LAB_DISTANCE, LIGHT_PAINT_RGB } from './constants';

export function clampInteger(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

export function clampToByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function rgbPaletteToLab(paletteRgb: Uint8Array): Float64Array {
  const count = paletteRgb.length / 3;
  const lab = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    let red = paletteRgb[offset] / 255;
    let green = paletteRgb[offset + 1] / 255;
    let blue = paletteRgb[offset + 2] / 255;

    red = red > 0.04045 ? ((red + 0.055) / 1.055) ** 2.4 : red / 12.92;
    green = green > 0.04045 ? ((green + 0.055) / 1.055) ** 2.4 : green / 12.92;
    blue = blue > 0.04045 ? ((blue + 0.055) / 1.055) ** 2.4 : blue / 12.92;

    let x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047;
    let y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
    let z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883;

    const epsilon = 216 / 24389;
    const kappa = 24389 / 27;
    x = x > epsilon ? x ** (1 / 3) : (kappa * x + 16) / 116;
    y = y > epsilon ? y ** (1 / 3) : (kappa * y + 16) / 116;
    z = z > epsilon ? z ** (1 / 3) : (kappa * z + 16) / 116;

    lab[offset] = 116 * y - 16;
    lab[offset + 1] = 500 * (x - y);
    lab[offset + 2] = 200 * (y - z);
  }
  return lab;
}

export function labPaletteToRgb(labPalette: Uint8Array | Float32Array | Float64Array): Uint8Array {
  const rgb = new Uint8Array(labPalette.length);
  for (let offset = 0; offset < labPalette.length; offset += 3) {
    const lightness = (Number(labPalette[offset]) / 255) * 100;
    const a = Number(labPalette[offset + 1]) - 128;
    const b = Number(labPalette[offset + 2]) - 128;

    let y = (lightness + 16) / 116;
    let x = a / 500 + y;
    let z = y - b / 200;

    const epsilon = 216 / 24389;
    const kappa = 24389 / 27;
    const x3 = x * x * x;
    const y3 = y * y * y;
    const z3 = z * z * z;

    x = 0.95047 * (x3 > epsilon ? x3 : (116 * x - 16) / kappa);
    y = y3 > epsilon ? y3 : (116 * y - 16) / kappa;
    z = 1.08883 * (z3 > epsilon ? z3 : (116 * z - 16) / kappa);

    let red = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
    let green = x * -0.969266 + y * 1.8760108 + z * 0.041556;
    let blue = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

    red = red > 0.0031308 ? 1.055 * red ** (1 / 2.4) - 0.055 : 12.92 * red;
    green = green > 0.0031308 ? 1.055 * green ** (1 / 2.4) - 0.055 : 12.92 * green;
    blue = blue > 0.0031308 ? 1.055 * blue ** (1 / 2.4) - 0.055 : 12.92 * blue;

    rgb[offset] = clampToByte(red * 255);
    rgb[offset + 1] = clampToByte(green * 255);
    rgb[offset + 2] = clampToByte(blue * 255);
  }
  return rgb;
}

export function rgbPaletteToHsv(paletteRgb: Uint8Array): Uint8Array {
  const hsv = new Uint8Array(paletteRgb.length);
  for (let offset = 0; offset < paletteRgb.length; offset += 3) {
    const red = paletteRgb[offset] / 255;
    const green = paletteRgb[offset + 1] / 255;
    const blue = paletteRgb[offset + 2] / 255;

    const maxValue = Math.max(red, green, blue);
    const minValue = Math.min(red, green, blue);
    const delta = maxValue - minValue;

    let hue = 0;
    if (delta !== 0) {
      if (maxValue === red) {
        hue = ((green - blue) / delta) % 6;
      } else if (maxValue === green) {
        hue = (blue - red) / delta + 2;
      } else {
        hue = (red - green) / delta + 4;
      }
      hue *= 60;
      if (hue < 0) {
        hue += 360;
      }
    }

    const saturation = maxValue === 0 ? 0 : delta / maxValue;
    const value = maxValue;

    hsv[offset] = clampToByte((hue / 360) * 255);
    hsv[offset + 1] = clampToByte(saturation * 255);
    hsv[offset + 2] = clampToByte(value * 255);
  }
  return hsv;
}

export function labelPixelCounts(labelMap: Int32Array, colorCount: number): Int32Array {
  const counts = new Int32Array(colorCount);
  for (let index = 0; index < labelMap.length; index += 1) {
    const label = labelMap[index];
    if (label >= 0 && label < colorCount) {
      counts[label] += 1;
    }
  }
  return counts;
}

export function compactLabelsByPalette(
  labelMap: Int32Array,
  paletteRgb: Uint8Array,
  width: number,
  height: number,
): { labelMap: Int32Array; paletteRgb: Uint8Array } {
  const counts = labelPixelCounts(labelMap, paletteRgb.length / 3);
  const presentLabels: number[] = [];
  for (let label = 0; label < counts.length; label += 1) {
    if (counts[label] > 0) {
      presentLabels.push(label);
    }
  }

  if (presentLabels.length === 0) {
    return {
      labelMap: new Int32Array(width * height),
      paletteRgb: new Uint8Array([255, 255, 255]),
    };
  }

  const paletteHsv = rgbPaletteToHsv(paletteRgb);
  const entries = presentLabels.map((label) => ({
    oldLabel: label,
    count: counts[label],
    hsvOffset: label * 3,
  }));

  entries.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = paletteHsv[left.hsvOffset + channel] - paletteHsv[right.hsvOffset + channel];
      if (delta !== 0) {
        return delta;
      }
    }
    return left.oldLabel - right.oldLabel;
  });

  const remap = new Int32Array(paletteRgb.length / 3).fill(-1);
  const compactPalette = new Uint8Array(entries.length * 3);
  for (let newLabel = 0; newLabel < entries.length; newLabel += 1) {
    const oldLabel = entries[newLabel].oldLabel;
    remap[oldLabel] = newLabel;
    const oldOffset = oldLabel * 3;
    const newOffset = newLabel * 3;
    compactPalette[newOffset] = paletteRgb[oldOffset];
    compactPalette[newOffset + 1] = paletteRgb[oldOffset + 1];
    compactPalette[newOffset + 2] = paletteRgb[oldOffset + 2];
  }

  const compacted = new Int32Array(labelMap.length);
  for (let index = 0; index < labelMap.length; index += 1) {
    const label = labelMap[index];
    compacted[index] = label >= 0 ? remap[label] : -1;
  }

  return { labelMap: compacted, paletteRgb: compactPalette };
}

export function facetColorDistanceMatrix(paletteRgb: Uint8Array): number[][] {
  const paletteLab = rgbPaletteToLab(paletteRgb);
  const colorCount = paletteRgb.length / 3;
  const distances: number[][] = new Array(colorCount);
  for (let row = 0; row < colorCount; row += 1) {
    distances[row] = new Array(colorCount);
  }
  for (let left = 0; left < colorCount; left += 1) {
    for (let right = left; right < colorCount; right += 1) {
      const leftOffset = left * 3;
      const rightOffset = right * 3;
      const deltaL = paletteLab[leftOffset] - paletteLab[rightOffset];
      const deltaA = paletteLab[leftOffset + 1] - paletteLab[rightOffset + 1];
      const deltaB = paletteLab[leftOffset + 2] - paletteLab[rightOffset + 2];
      const distance = Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB);
      distances[left][right] = distance;
      distances[right][left] = distance;
    }
  }
  return distances;
}

export function paletteColorDistanceSquared(paletteLab: Float64Array | Uint8Array, leftLabel: number, rightLabel: number): number {
  const leftOffset = leftLabel * 3;
  const rightOffset = rightLabel * 3;
  const delta0 = paletteLab[leftOffset] - paletteLab[rightOffset];
  const delta1 = paletteLab[leftOffset + 1] - paletteLab[rightOffset + 1];
  const delta2 = paletteLab[leftOffset + 2] - paletteLab[rightOffset + 2];
  return delta0 * delta0 + delta1 * delta1 + delta2 * delta2;
}

export function mergeNearDuplicateColors(
  centerLab: Uint8Array,
  labels: Int32Array,
  colorCount: number,
): boolean {
  const remap = new Int32Array(colorCount);
  for (let index = 0; index < colorCount; index += 1) {
    remap[index] = index;
  }

  for (let left = 0; left < colorCount; left += 1) {
    if (remap[left] !== left) {
      continue;
    }
    for (let right = left + 1; right < colorCount; right += 1) {
      if (remap[right] !== right) {
        continue;
      }
      const leftOffset = left * 3;
      const rightOffset = right * 3;
      const deltaL = centerLab[leftOffset] - centerLab[rightOffset];
      const deltaA = centerLab[leftOffset + 1] - centerLab[rightOffset + 1];
      const deltaB = centerLab[leftOffset + 2] - centerLab[rightOffset + 2];
      const distance = Math.sqrt(deltaL * deltaL + deltaA * deltaA + deltaB * deltaB);
      if (distance < KMEANS_MERGE_SIMILAR_LAB_DISTANCE) {
        remap[right] = left;
      }
    }
  }

  let changed = false;
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const oldLabel = labels[pixel];
    if (oldLabel >= 0 && oldLabel < colorCount && remap[oldLabel] !== oldLabel) {
      labels[pixel] = remap[oldLabel];
      changed = true;
    }
  }
  return changed;
}

export function relativeLuminance(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function normalizePaintColor(rgb: [number, number, number]): [number, number, number] {
  const luminance = relativeLuminance(rgb);
  const spread = Math.max(...rgb) - Math.min(...rgb);
  if (luminance > 244 && spread < 24) {
    return LIGHT_PAINT_RGB;
  }
  if (luminance >= 42) {
    return rgb;
  }
  const scale = 42 / Math.max(luminance, 1);
  return [
    clampInteger(Math.round(rgb[0] * scale), 24, 255),
    clampInteger(Math.round(rgb[1] * scale), 24, 255),
    clampInteger(Math.round(rgb[2] * scale), 24, 255),
  ];
}

export function brightTemplateColor(rgb: [number, number, number]): [number, number, number] {
  const alpha = 0.08;
  return [
    clampToByte(255 * (1 - alpha) + rgb[0] * alpha),
    clampToByte(255 * (1 - alpha) + rgb[1] * alpha),
    clampToByte(255 * (1 - alpha) + rgb[2] * alpha),
  ];
}

export function normalizePaintPalette(paletteRgb: Uint8Array): Uint8Array {
  const normalized = new Uint8Array(paletteRgb.length);
  for (let offset = 0; offset < paletteRgb.length; offset += 3) {
    const [red, green, blue] = normalizePaintColor([
      paletteRgb[offset],
      paletteRgb[offset + 1],
      paletteRgb[offset + 2],
    ]);
    normalized[offset] = red;
    normalized[offset + 1] = green;
    normalized[offset + 2] = blue;
  }
  return normalized;
}

export function brightenPaletteForTemplate(paletteRgb: Uint8Array): Uint8Array {
  const brightened = new Uint8Array(paletteRgb.length);
  for (let offset = 0; offset < paletteRgb.length; offset += 3) {
    const [red, green, blue] = brightTemplateColor([
      paletteRgb[offset],
      paletteRgb[offset + 1],
      paletteRgb[offset + 2],
    ]);
    brightened[offset] = red;
    brightened[offset + 1] = green;
    brightened[offset + 2] = blue;
  }
  return brightened;
}

export function hardContrastThresholdSquared(): number {
  return FACET_DETAIL_PROTECT_LAB_DISTANCE * FACET_DETAIL_PROTECT_LAB_DISTANCE;
}
