import { canFitNumberGlyph, fallbackColorDotRadius } from './freshMarkerSizing';

export type FreshVectorRenderConfig = {
  fillMode: 'bright' | 'color' | 'white' | 'debug';
  boundaryMode: 'none' | 'black' | 'color';
  markerMode: 'none' | 'circles' | 'numberedCircles' | 'numbers';
};

export type FreshVectorMarker = {
  colorIndex: number;
  x: number;
  y: number;
  radius: number;
};

type Rgb = [number, number, number];

const OUTLINE: Rgb = [22, 29, 31];
const PAPER_WHITE: Rgb = [250, 252, 249];

function brightenColor(channel: number): number {
  return clampByte(255 - (255 - channel) * 0.2);
}

function debugRegionColor(regionId: number): Rgb {
  const hash = Math.imul(regionId + 1, 1103515245) + 12345;
  return [
    70 + Math.abs(hash & 0xff) % 150,
    70 + Math.abs((hash >> 8) & 0xff) % 150,
    70 + Math.abs((hash >> 16) & 0xff) % 150,
  ];
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function paletteColor(paletteRgb: Float32Array, label: number): Rgb {
  const offset = Math.max(0, label) * 3;
  return [
    clampByte(paletteRgb[offset] ?? 255),
    clampByte(paletteRgb[offset + 1] ?? 255),
    clampByte(paletteRgb[offset + 2] ?? 255),
  ];
}

function svgRgb(color: Rgb): string {
  return `rgb(${color[0]},${color[1]},${color[2]})`;
}

function fillColor(
  config: FreshVectorRenderConfig,
  paletteRgb: Float32Array,
  label: number,
  regionId: number,
): Rgb {
  if (config.fillMode === 'debug') {
    return debugRegionColor(regionId);
  }
  const color = paletteColor(paletteRgb, label);
  return config.fillMode === 'bright'
    ? [brightenColor(color[0]), brightenColor(color[1]), brightenColor(color[2])]
    : color;
}

function buildFillPaths(
  config: FreshVectorRenderConfig,
  labelMap: Uint8Array,
  regionMap: Int32Array,
  paletteRgb: Float32Array,
  width: number,
  height: number,
): string[] {
  const commandsByKey = new Map<number, string[]>();
  const labelByKey = new Map<number, number>();
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    let x = 0;
    while (x < width) {
      const label = labelMap[rowOffset + x];
      const regionId = regionMap[rowOffset + x];
      const key = config.fillMode === 'debug' ? regionId : label;
      const startX = x;
      x += 1;
      while (
        x < width
        && (config.fillMode === 'debug' ? regionMap[rowOffset + x] === regionId : labelMap[rowOffset + x] === label)
      ) {
        x += 1;
      }
      if (label < paletteRgb.length / 3 && regionId >= 0) {
        const command = `M${startX} ${y}h${x - startX}v1h-${x - startX}z`;
        const commands = commandsByKey.get(key);
        if (commands == null) {
          commandsByKey.set(key, [command]);
          labelByKey.set(key, label);
        } else {
          commands.push(command);
        }
      }
    }
  }

  const paths: string[] = [];
  for (const [key, commands] of commandsByKey) {
    const regionId = config.fillMode === 'debug' ? key : 0;
    const label = labelByKey.get(key) ?? 0;
    paths.push(`<path d="${commands.join('')}" fill="${svgRgb(fillColor(config, paletteRgb, label, regionId))}"/>`);
  }
  return paths;
}

function buildBoundaryPaths(
  labelMap: Uint8Array,
  regionMap: Int32Array,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  mode: FreshVectorRenderConfig['boundaryMode'],
): string[] {
  if (mode === 'none') {
    return [];
  }
  const commandsByColor = new Map<number, string[]>();
  const append = (colorLabel: number, command: string): void => {
    const key = mode === 'black' ? -1 : colorLabel;
    const existing = commandsByColor.get(key);
    if (existing == null) {
      commandsByColor.set(key, [command]);
    } else {
      existing.push(command);
    }
  };

  for (let x = 1; x < width; x += 1) {
    let y = 0;
    while (y < height) {
      const leftIndex = y * width + x - 1;
      if (regionMap[leftIndex] === regionMap[leftIndex + 1]) {
        y += 1;
        continue;
      }
      const colorLabel = Math.min(labelMap[leftIndex], labelMap[leftIndex + 1]);
      const startY = y;
      y += 1;
      while (y < height) {
        const index = y * width + x - 1;
        if (
          regionMap[index] === regionMap[index + 1]
          || Math.min(labelMap[index], labelMap[index + 1]) !== colorLabel
        ) {
          break;
        }
        y += 1;
      }
      append(colorLabel, `M${x} ${startY}V${y}`);
    }
  }

  for (let y = 1; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      const topIndex = (y - 1) * width + x;
      if (regionMap[topIndex] === regionMap[topIndex + width]) {
        x += 1;
        continue;
      }
      const colorLabel = Math.min(labelMap[topIndex], labelMap[topIndex + width]);
      const startX = x;
      x += 1;
      while (x < width) {
        const index = (y - 1) * width + x;
        if (
          regionMap[index] === regionMap[index + width]
          || Math.min(labelMap[index], labelMap[index + width]) !== colorLabel
        ) {
          break;
        }
        x += 1;
      }
      append(colorLabel, `M${startX} ${y}H${x}`);
    }
  }

  const paths: string[] = [];
  for (const [colorLabel, commands] of commandsByColor) {
    const stroke = colorLabel < 0 ? svgRgb(OUTLINE) : svgRgb(paletteColor(paletteRgb, colorLabel));
    paths.push(
      `<path d="${commands.join('')}" fill="none" stroke="${stroke}" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  }
  return paths;
}

export function renderFreshVectorSvg(
  config: FreshVectorRenderConfig,
  labelMap: Uint8Array,
  regionMap: Int32Array,
  paletteRgb: Float32Array,
  width: number,
  height: number,
  placements: readonly FreshVectorMarker[],
): string {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision">`,
  ];
  if (config.fillMode === 'white') {
    parts.push(`<rect width="${width}" height="${height}" fill="${svgRgb(PAPER_WHITE)}"/>`);
  } else {
    parts.push(...buildFillPaths(config, labelMap, regionMap, paletteRgb, width, height));
  }
  parts.push(...buildBoundaryPaths(labelMap, regionMap, paletteRgb, width, height, config.boundaryMode));
  if (config.markerMode !== 'none') {
    parts.push('<g font-family="Arial, Helvetica, sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central">');
    for (const placement of placements) {
      const labelText = String(placement.colorIndex + 1);
      const strokeWidth = Math.min(0.9, Math.max(0.12, placement.radius * 0.35));
      const canRenderText = canFitNumberGlyph(placement.radius, labelText);
      const markerColor = paletteColor(paletteRgb, placement.colorIndex);
      const luminance = markerColor[0] * 0.299 + markerColor[1] * 0.587 + markerColor[2] * 0.114;
      const textColor: Rgb = luminance > 145 ? OUTLINE : [255, 255, 255];
      const fontSize = Math.max(
        2.5,
        Math.min(placement.radius * 1.24, (placement.radius * 2.1) / Math.max(1, labelText.length * 0.72)),
      );

      if (config.markerMode === 'circles' || config.markerMode === 'numberedCircles') {
        parts.push(
          `<circle cx="${placement.x.toFixed(2)}" cy="${placement.y.toFixed(2)}" r="${placement.radius.toFixed(2)}" fill="${svgRgb(markerColor)}" stroke="${svgRgb(OUTLINE)}" stroke-width="${strokeWidth.toFixed(2)}"/>`,
        );
      }
      if (config.markerMode === 'numberedCircles' && canRenderText) {
        parts.push(
          `<text x="${placement.x.toFixed(2)}" y="${placement.y.toFixed(2)}" font-size="${fontSize.toFixed(2)}" fill="${svgRgb(textColor)}">${labelText}</text>`,
        );
      } else if (config.markerMode === 'numbers' && canRenderText) {
        parts.push(
          `<text data-marker="number" x="${placement.x.toFixed(2)}" y="${placement.y.toFixed(2)}" font-size="${fontSize.toFixed(2)}" fill="${svgRgb(OUTLINE)}">${labelText}</text>`,
        );
      } else if (config.markerMode === 'numbers') {
        const fallbackRadius = fallbackColorDotRadius(placement.radius);
        parts.push(
          `<circle data-marker="color-fallback" cx="${placement.x.toFixed(2)}" cy="${placement.y.toFixed(2)}" r="${fallbackRadius.toFixed(2)}" fill="${svgRgb(markerColor)}" stroke="${svgRgb(OUTLINE)}" stroke-width="${Math.min(0.7, Math.max(0.12, fallbackRadius * 0.35)).toFixed(2)}"/>`,
        );
      }
    }
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('');
}
