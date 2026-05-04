import {
  FACET_DETAIL_PROTECT_LAB_DISTANCE,
  KMEANS_MERGE_SIMILAR_LAB_DISTANCE,
  LIGHT_PAINT_RGB,
} from "./constants";

export function clampInteger(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

export function clampToByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbChannelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized > 0.04045 ? ((normalized + 0.055) / 1.055) ** 2.4 : normalized / 12.92;
}

function linearChannelToRgb(channel: number): number {
  const normalized = channel > 0.0031308 ? 1.055 * channel ** (1 / 2.4) - 0.055 : 12.92 * channel;
  return clampToByte(normalized * 255);
}

function xyzPivot(value: number): number {
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  return value > epsilon ? value ** (1 / 3) : (kappa * value + 16) / 116;
}

function xyzInversePivot(value: number): number {
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  const cubed = value * value * value;
  return cubed > epsilon ? cubed : (116 * value - 16) / kappa;
}

export function rgbTripletToLabBytes(red: number, green: number, blue: number): [number, number, number] {
  const linearRed = rgbChannelToLinear(red);
  const linearGreen = rgbChannelToLinear(green);
  const linearBlue = rgbChannelToLinear(blue);

  const x = xyzPivot((linearRed * 0.4124564 + linearGreen * 0.3575761 + linearBlue * 0.1804375) / 0.95047);
  const y = xyzPivot(linearRed * 0.2126729 + linearGreen * 0.7151522 + linearBlue * 0.072175);
  const z = xyzPivot((linearRed * 0.0193339 + linearGreen * 0.119192 + linearBlue * 0.9503041) / 1.08883);

  return [
    clampToByte(((116 * y - 16) / 100) * 255),
    clampToByte(500 * (x - y) + 128),
    clampToByte(200 * (y - z) + 128),
  ];
}

export function labTripletBytesToRgb(lightness: number, a: number, b: number): [number, number, number] {
  const normalizedLightness = (lightness / 255) * 100;
  const normalizedA = a - 128;
  const normalizedB = b - 128;

  const y = (normalizedLightness + 16) / 116;
  const x = normalizedA / 500 + y;
  const z = y - normalizedB / 200;

  const xLinear = 0.95047 * xyzInversePivot(x);
  const yLinear = xyzInversePivot(y);
  const zLinear = 1.08883 * xyzInversePivot(z);

  return [
    linearChannelToRgb(xLinear * 3.2404542 + yLinear * -1.5371385 + zLinear * -0.4985314),
    linearChannelToRgb(xLinear * -0.969266 + yLinear * 1.8760108 + zLinear * 0.041556),
    linearChannelToRgb(xLinear * 0.0556434 + yLinear * -0.2040259 + zLinear * 1.0572252),
  ];
}

export function rgbBufferToLabSamples(rgba: Uint8ClampedArray): Float32Array {
  const pixelCount = Math.floor(rgba.length / 4);
  const lab = new Float32Array(pixelCount * 3);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const rgbaOffset = pixel * 4;
    const labOffset = pixel * 3;
    const [lightness, a, b] = rgbTripletToLabBytes(
      rgba[rgbaOffset],
      rgba[rgbaOffset + 1],
      rgba[rgbaOffset + 2],
    );
    lab[labOffset] = lightness;
    lab[labOffset + 1] = a;
    lab[labOffset + 2] = b;
  }
  return lab;
}

export function rgbPaletteToLab(paletteRgb: Uint8Array): Float64Array {
  const count = paletteRgb.length / 3;
  const lab = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const [lightness, a, b] = rgbTripletToLabBytes(
      paletteRgb[offset],
      paletteRgb[offset + 1],
      paletteRgb[offset + 2],
    );
    lab[offset] = lightness;
    lab[offset + 1] = a;
    lab[offset + 2] = b;
  }
  return lab;
}

export function labPaletteToRgb(labPalette: Uint8Array | Float32Array | Float64Array): Uint8Array {
  const rgb = new Uint8Array(labPalette.length);
  for (let offset = 0; offset < labPalette.length; offset += 3) {
    const [red, green, blue] = labTripletBytesToRgb(
      Number(labPalette[offset]),
      Number(labPalette[offset + 1]),
      Number(labPalette[offset + 2]),
    );
    rgb[offset] = red;
    rgb[offset + 1] = green;
    rgb[offset + 2] = blue;
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

    hsv[offset] = clampToByte((hue / 360) * 255);
    hsv[offset + 1] = clampToByte(saturation * 255);
    hsv[offset + 2] = clampToByte(maxValue * 255);
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

export function paletteColorDistanceSquared(
  paletteLab: Float64Array | Uint8Array,
  leftLabel: number,
  rightLabel: number,
): number {
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
