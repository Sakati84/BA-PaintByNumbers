export type ImageBufferRGBA = {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
};

export type ImageBufferRGB = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type NormalizedImageDimensions = {
  width: number;
  height: number;
  scale: number;
};
