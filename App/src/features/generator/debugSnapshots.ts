import { encode } from 'fast-png';

import { uint8ToBase64 } from './base64';
import type { GeneratorDebugImage } from './generatorTypes';

const DEFAULT_DEBUG_MAX_EDGE = 720;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function downsampleRgba(
  width: number,
  height: number,
  data: Uint8Array | Uint8ClampedArray,
  maxEdge: number,
): { width: number; height: number; data: Uint8Array } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const outputWidth = Math.max(1, Math.round(width * scale));
  const outputHeight = Math.max(1, Math.round(height * scale));
  const output = new Uint8Array(outputWidth * outputHeight * 4);

  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const sourceOffset = (sourceY * width + sourceX) * 4;
      const targetOffset = (y * outputWidth + x) * 4;
      output[targetOffset] = clampByte(data[sourceOffset]);
      output[targetOffset + 1] = clampByte(data[sourceOffset + 1]);
      output[targetOffset + 2] = clampByte(data[sourceOffset + 2]);
      output[targetOffset + 3] = clampByte(data[sourceOffset + 3] ?? 255);
    }
  }

  return {
    width: outputWidth,
    height: outputHeight,
    data: output,
  };
}

export async function encodeRgbaDebugImage(
  label: string,
  width: number,
  height: number,
  data: Uint8Array | Uint8ClampedArray,
  maxEdge = DEFAULT_DEBUG_MAX_EDGE,
): Promise<GeneratorDebugImage> {
  const rendered = downsampleRgba(width, height, data, maxEdge);
  const bytes = encode({
    width: rendered.width,
    height: rendered.height,
    data: rendered.data,
    depth: 8,
    channels: 4,
  });

  const pngBase64 = uint8ToBase64(bytes);
  return {
    label,
    pngBase64,
    width: rendered.width,
    height: rendered.height,
    byteLength: Math.ceil((pngBase64.length * 3) / 4),
  };
}
