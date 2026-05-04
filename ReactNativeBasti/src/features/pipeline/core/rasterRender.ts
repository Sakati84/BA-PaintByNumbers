import type { ImageBufferRGBA } from "./imageBuffer";
import { brightenPaletteForTemplate } from "./colorMath";
import { clampCircleToCanvas } from "./facets";
import { OUTLINE_RGB, TEMPLATE_BG_RGB } from "./constants";
import type { LabelPlacement, RegionInfo } from "./placement";

const DARK_TEXT_RGB: [number, number, number] = [34, 34, 34];
const LIGHT_TEXT_RGB: [number, number, number] = [255, 255, 255];
const DEBUG_OUTLINE_RGB: [number, number, number] = [0, 0, 0];
const DEBUG_UNLABELED_RGB: [number, number, number] = [255, 0, 0];

const DIGIT_FONT: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "001", "001", "001"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};

export function renderRgbaBufferFromLabelMap(
  labelMap: Int32Array,
  paletteRgb: Uint8Array,
  width: number,
  height: number,
  fallbackRgb: [number, number, number] = [255, 255, 255],
): ImageBufferRGBA {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const maxLabel = Math.max(0, paletteRgb.length / 3 - 1);
  for (let pixelIndex = 0; pixelIndex < labelMap.length; pixelIndex += 1) {
    const label = labelMap[pixelIndex];
    const outputOffset = pixelIndex * 4;
    if (label < 0) {
      pixels[outputOffset] = fallbackRgb[0];
      pixels[outputOffset + 1] = fallbackRgb[1];
      pixels[outputOffset + 2] = fallbackRgb[2];
      pixels[outputOffset + 3] = 255;
      continue;
    }
    const paletteOffset = Math.min(maxLabel, label) * 3;
    pixels[outputOffset] = paletteRgb[paletteOffset];
    pixels[outputOffset + 1] = paletteRgb[paletteOffset + 1];
    pixels[outputOffset + 2] = paletteRgb[paletteOffset + 2];
    pixels[outputOffset + 3] = 255;
  }
  return { width, height, data: pixels };
}

function paintPixel(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  rgb: [number, number, number],
): void {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return;
  }
  const offset = (y * width + x) * 4;
  pixels[offset] = rgb[0];
  pixels[offset + 1] = rgb[1];
  pixels[offset + 2] = rgb[2];
  pixels[offset + 3] = 255;
}

function paintFilledCircle(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  rgb: [number, number, number],
): void {
  const minX = Math.max(0, centerX - radius);
  const maxX = Math.min(width - 1, centerX + radius);
  const minY = Math.max(0, centerY - radius);
  const maxY = Math.min(height - 1, centerY + radius);
  const radiusSquared = radius * radius;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radiusSquared) {
        paintPixel(pixels, width, height, x, y, rgb);
      }
    }
  }
}

function applyOutlinesToPixels(
  pixels: Uint8ClampedArray,
  boundaryMask: Uint8Array,
  outlineRgb: [number, number, number] = OUTLINE_RGB,
): void {
  for (let index = 0; index < boundaryMask.length; index += 1) {
    if (boundaryMask[index] === 0) {
      continue;
    }
    const offset = index * 4;
    pixels[offset] = outlineRgb[0];
    pixels[offset + 1] = outlineRgb[1];
    pixels[offset + 2] = outlineRgb[2];
    pixels[offset + 3] = 255;
  }
}

function labelTextColor(fillR: number, fillG: number, fillB: number): [number, number, number] {
  const luminance = 0.2126 * fillR + 0.7152 * fillG + 0.0722 * fillB;
  return luminance > 140 ? DARK_TEXT_RGB : LIGHT_TEXT_RGB;
}

function numberFontSize(width: number, height: number): number {
  return Math.max(8, Math.round(Math.max(width, height) / 120));
}

function bitmapScaleForCanvas(width: number, height: number): number {
  return Math.max(1, Math.round(numberFontSize(width, height) / 5));
}

function measureBitmapText(text: string, scale: number): { width: number; height: number } {
  if (text.length === 0) {
    return { width: 0, height: 0 };
  }
  const glyphWidth = 3 * scale;
  const spacing = scale;
  return { width: text.length * glyphWidth + (text.length - 1) * spacing, height: 5 * scale };
}

function drawBitmapDigit(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  digit: string,
  startX: number,
  startY: number,
  scale: number,
  rgb: [number, number, number],
): void {
  const glyph = DIGIT_FONT[digit];
  if (!glyph) {
    return;
  }
  for (let row = 0; row < glyph.length; row += 1) {
    const rowBits = glyph[row];
    for (let column = 0; column < rowBits.length; column += 1) {
      if (rowBits[column] !== "1") {
        continue;
      }
      for (let offsetY = 0; offsetY < scale; offsetY += 1) {
        for (let offsetX = 0; offsetX < scale; offsetX += 1) {
          paintPixel(pixels, width, height, startX + column * scale + offsetX, startY + row * scale + offsetY, rgb);
        }
      }
    }
  }
}

function drawBitmapText(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  text: string,
  centerX: number,
  centerY: number,
  scale: number,
  rgb: [number, number, number],
): void {
  const size = measureBitmapText(text, scale);
  let cursorX = Math.round(centerX - size.width / 2);
  const startY = Math.round(centerY - size.height / 2);
  for (const digit of text) {
    drawBitmapDigit(pixels, width, height, digit, cursorX, startY, scale, rgb);
    cursorX += 4 * scale;
  }
}

function buildColorToNumberMap(regions: RegionInfo[]): Map<number, number> {
  const usedColors = new Set<number>();
  for (const region of regions) {
    usedColors.add(region.colorIndex);
  }
  const sortedColors = [...usedColors].sort((left, right) => left - right);
  const colorToNumber = new Map<number, number>();
  sortedColors.forEach((colorIndex, index) => colorToNumber.set(colorIndex, index + 1));
  return colorToNumber;
}

function buildPlacementMap(placements: LabelPlacement[]): Map<number, LabelPlacement> {
  const placementByRegionId = new Map<number, LabelPlacement>();
  for (const placement of placements) {
    placementByRegionId.set(placement.regionId, placement);
  }
  return placementByRegionId;
}

export function fixedCircleMarkerRadius(width: number, height: number): number {
  const longest = Math.max(width, height);
  return Math.max(3, Math.min(5, Math.round(longest / 300)));
}

export function renderBrightColorCirclesTemplate(args: {
  labelMap: Int32Array;
  regions: RegionInfo[];
  placements: LabelPlacement[];
  paletteRgb: Uint8Array;
  boundaryMask: Uint8Array;
  width: number;
  height: number;
}): ImageBufferRGBA {
  const brightPaletteRgb = brightenPaletteForTemplate(args.paletteRgb);
  const base = renderRgbaBufferFromLabelMap(args.labelMap, brightPaletteRgb, args.width, args.height, TEMPLATE_BG_RGB);
  const pixels = base.data instanceof Uint8ClampedArray ? base.data : new Uint8ClampedArray(base.data);
  applyOutlinesToPixels(pixels, args.boundaryMask);
  const placementByRegionId = buildPlacementMap(args.placements);

  for (const region of [...args.regions].sort((left, right) => right.area - left.area || left.regionId - right.regionId)) {
    const placement = placementByRegionId.get(region.regionId);
    if (!placement) {
      continue;
    }
    const circleRadius = Math.min(
      fixedCircleMarkerRadius(args.width, args.height),
      Math.max(1, Math.floor(placement.radius * 0.75)),
    );
    const [centerX, centerY, safeRadius] = clampCircleToCanvas(placement.x, placement.y, circleRadius, args.width, args.height);
    const paletteOffset = region.colorIndex * 3;
    paintFilledCircle(
      pixels,
      args.width,
      args.height,
      centerX,
      centerY,
      safeRadius,
      [args.paletteRgb[paletteOffset], args.paletteRgb[paletteOffset + 1], args.paletteRgb[paletteOffset + 2]],
    );
  }

  return { width: args.width, height: args.height, data: pixels };
}

export function renderNumbersTemplate(args: {
  labelMap: Int32Array;
  regions: RegionInfo[];
  placements: LabelPlacement[];
  boundaryMask: Uint8Array;
  width: number;
  height: number;
}): ImageBufferRGBA {
  const whitePalette = new Uint8Array(Math.max(3, args.regions.length * 3 || 3)).fill(255);
  const base = renderRgbaBufferFromLabelMap(args.labelMap, whitePalette, args.width, args.height, TEMPLATE_BG_RGB);
  const pixels = base.data instanceof Uint8ClampedArray ? base.data : new Uint8ClampedArray(base.data);
  applyOutlinesToPixels(pixels, args.boundaryMask);
  const colorToNumber = buildColorToNumberMap(args.regions);
  const placementByRegionId = buildPlacementMap(args.placements);
  const scale = bitmapScaleForCanvas(args.width, args.height);

  for (const region of [...args.regions].sort((left, right) => right.area - left.area || left.regionId - right.regionId)) {
    const placement = placementByRegionId.get(region.regionId);
    if (!placement) {
      continue;
    }
    const text = String(colorToNumber.get(region.colorIndex) ?? region.colorIndex + 1);
    const [centerX, centerY] = clampCircleToCanvas(placement.x, placement.y, 0, args.width, args.height);
    drawBitmapText(pixels, args.width, args.height, text, centerX, centerY, scale, DARK_TEXT_RGB);
  }

  return { width: args.width, height: args.height, data: pixels };
}

export function renderColorCirclesTemplate(args: {
  labelMap: Int32Array;
  regions: RegionInfo[];
  placements: LabelPlacement[];
  paletteRgb: Uint8Array;
  boundaryMask: Uint8Array;
  width: number;
  height: number;
}): ImageBufferRGBA {
  const whitePalette = new Uint8Array(Math.max(3, args.paletteRgb.length)).fill(255);
  const base = renderRgbaBufferFromLabelMap(args.labelMap, whitePalette, args.width, args.height, TEMPLATE_BG_RGB);
  const pixels = base.data instanceof Uint8ClampedArray ? base.data : new Uint8ClampedArray(base.data);
  applyOutlinesToPixels(pixels, args.boundaryMask);
  const colorToNumber = buildColorToNumberMap(args.regions);
  const placementByRegionId = buildPlacementMap(args.placements);
  const scale = bitmapScaleForCanvas(args.width, args.height);
  const fontSize = numberFontSize(args.width, args.height);

  for (const region of [...args.regions].sort((left, right) => right.area - left.area || left.regionId - right.regionId)) {
    const placement = placementByRegionId.get(region.regionId);
    if (!placement) {
      continue;
    }
    const numberText = String(colorToNumber.get(region.colorIndex) ?? region.colorIndex + 1);
    const textSize = measureBitmapText(numberText, scale);
    const circleRadius = Math.max(Math.round(fontSize * 0.6), Math.round(textSize.width * 0.7 + 2));
    const [centerX, centerY, safeRadius] = clampCircleToCanvas(placement.x, placement.y, circleRadius, args.width, args.height);
    const paletteOffset = region.colorIndex * 3;
    const fillRgb: [number, number, number] = [
      args.paletteRgb[paletteOffset],
      args.paletteRgb[paletteOffset + 1],
      args.paletteRgb[paletteOffset + 2],
    ];
    paintFilledCircle(pixels, args.width, args.height, centerX, centerY, safeRadius, fillRgb);
    drawBitmapText(
      pixels,
      args.width,
      args.height,
      numberText,
      centerX,
      centerY,
      scale,
      labelTextColor(fillRgb[0], fillRgb[1], fillRgb[2]),
    );
  }

  return { width: args.width, height: args.height, data: pixels };
}

export function renderCirclesOnlyTemplate(args: {
  labelMap: Int32Array;
  regions: RegionInfo[];
  placements: LabelPlacement[];
  paletteRgb: Uint8Array;
  boundaryMask: Uint8Array;
  width: number;
  height: number;
}): ImageBufferRGBA {
  const whitePalette = new Uint8Array(Math.max(3, args.paletteRgb.length)).fill(255);
  const base = renderRgbaBufferFromLabelMap(args.labelMap, whitePalette, args.width, args.height, TEMPLATE_BG_RGB);
  const pixels = base.data instanceof Uint8ClampedArray ? base.data : new Uint8ClampedArray(base.data);
  applyOutlinesToPixels(pixels, args.boundaryMask);
  const placementByRegionId = buildPlacementMap(args.placements);

  for (const region of [...args.regions].sort((left, right) => right.area - left.area || left.regionId - right.regionId)) {
    const placement = placementByRegionId.get(region.regionId);
    if (!placement) {
      continue;
    }
    const circleRadius = Math.min(
      fixedCircleMarkerRadius(args.width, args.height),
      Math.max(1, Math.floor(placement.radius * 0.75)),
    );
    const [centerX, centerY, safeRadius] = clampCircleToCanvas(placement.x, placement.y, circleRadius, args.width, args.height);
    const paletteOffset = region.colorIndex * 3;
    paintFilledCircle(
      pixels,
      args.width,
      args.height,
      centerX,
      centerY,
      safeRadius,
      [args.paletteRgb[paletteOffset], args.paletteRgb[paletteOffset + 1], args.paletteRgb[paletteOffset + 2]],
    );
  }

  return { width: args.width, height: args.height, data: pixels };
}

export function renderClassicTemplate(args: {
  labelMap: Int32Array;
  paletteRgb: Uint8Array;
  boundaryMask: Uint8Array;
  width: number;
  height: number;
}): ImageBufferRGBA {
  const base = renderRgbaBufferFromLabelMap(args.labelMap, args.paletteRgb, args.width, args.height, TEMPLATE_BG_RGB);
  const pixels = base.data instanceof Uint8ClampedArray ? base.data : new Uint8ClampedArray(base.data);
  applyOutlinesToPixels(pixels, args.boundaryMask);
  return { width: args.width, height: args.height, data: pixels };
}

export function renderDebugUnlabeledTemplate(args: {
  facetMap: Uint32Array | Int32Array;
  regions: RegionInfo[];
  placements: LabelPlacement[];
  paletteRgb: Uint8Array;
  boundaryMask: Uint8Array;
  width: number;
  height: number;
}): ImageBufferRGBA {
  const unlabeledRegionIds = new Set<number>();
  const labeledRegionIds = new Set<number>(args.placements.map((placement) => placement.regionId));
  for (const region of args.regions) {
    if (!labeledRegionIds.has(region.regionId)) {
      unlabeledRegionIds.add(region.regionId);
    }
  }

  const facetColor = new Map<number, number>();
  for (const region of args.regions) {
    facetColor.set(region.regionId, region.colorIndex);
  }

  const pixels = new Uint8ClampedArray(args.width * args.height * 4);
  for (let index = 0; index < args.width * args.height; index += 1) {
    const facetId = args.facetMap[index];
    const offset = index * 4;
    if (args.boundaryMask[index]) {
      pixels[offset] = DEBUG_OUTLINE_RGB[0];
      pixels[offset + 1] = DEBUG_OUTLINE_RGB[1];
      pixels[offset + 2] = DEBUG_OUTLINE_RGB[2];
      pixels[offset + 3] = 255;
    } else if (unlabeledRegionIds.has(facetId)) {
      pixels[offset] = DEBUG_UNLABELED_RGB[0];
      pixels[offset + 1] = DEBUG_UNLABELED_RGB[1];
      pixels[offset + 2] = DEBUG_UNLABELED_RGB[2];
      pixels[offset + 3] = 255;
    } else {
      const colorIndex = facetColor.get(facetId) ?? 0;
      const paletteOffset = colorIndex * 3;
      pixels[offset] = args.paletteRgb[paletteOffset];
      pixels[offset + 1] = args.paletteRgb[paletteOffset + 1];
      pixels[offset + 2] = args.paletteRgb[paletteOffset + 2];
      pixels[offset + 3] = 255;
    }
  }

  return { width: args.width, height: args.height, data: pixels };
}
