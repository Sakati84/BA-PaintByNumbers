import { Image } from 'react-native';

import type { NormalizedImageDimensions } from './imageBuffer';

export async function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return await new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

export function calculateNormalizedDimensions(
  width: number,
  height: number,
  resizeMax: number,
): NormalizedImageDimensions {
  if (width <= 0 || height <= 0) {
    throw new Error('Image dimensions must be positive.');
  }

  if (resizeMax <= 0) {
    return { width, height, scale: 1 };
  }

  const longestEdge = Math.max(width, height);
  if (longestEdge <= resizeMax) {
    return { width, height, scale: 1 };
  }

  const scale = resizeMax / longestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}
