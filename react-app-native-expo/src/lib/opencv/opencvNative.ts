import { File, Paths } from 'expo-file-system';
import {
  BorderTypes,
  ColorConversionCodes,
  DataTypes,
  DistanceTransformMasks,
  DistanceTypes,
  InterpolationFlags,
  ObjectType,
  OpenCV,
  type Mat,
} from 'react-native-fast-opencv';

import type { ImageBufferRGBA } from '../platform/imageBuffer';
import { clampInteger } from '../pipeline';
import type { NativeMatHandle, OpenCvAdapterStatus } from './opencvTypes';

function getMatMetadata(mat: Mat): { width: number; height: number; channels: number } {
  const info = OpenCV.matToBuffer(mat, 'uint8');
  return {
    width: info.cols,
    height: info.rows,
    channels: info.channels,
  };
}

function wrapMat(mat: Mat): NativeMatHandle {
  const metadata = getMatMetadata(mat);
  return {
    mat,
    id: mat.id,
    width: metadata.width,
    height: metadata.height,
    channels: metadata.channels,
  };
}

function createEmptyMat(type: DataTypes): Mat {
  return OpenCV.createObject(ObjectType.Mat, 0, 0, type);
}

function ensureReady(name: string): void {
  if (typeof OpenCV?.invoke !== 'function') {
    throw new Error(
      `${name} is not available. Build and run react-app-native-expo with Expo Development Build so react-native-fast-opencv can install its native bindings.`
    );
  }
}

async function convertToColorSpace(input: NativeMatHandle, code: ColorConversionCodes, outputType: DataTypes): Promise<NativeMatHandle> {
  ensureReady('Color conversion');
  const output = createEmptyMat(outputType);
  OpenCV.invoke('cvtColor', input.mat, output, code);
  return wrapMat(output);
}

async function ensureRgbMat(input: NativeMatHandle): Promise<NativeMatHandle> {
  if (input.channels === 3) {
    return input;
  }
  if (input.channels === 4) {
    return convertToColorSpace(input, ColorConversionCodes.COLOR_RGBA2RGB, DataTypes.CV_8UC3);
  }
  if (input.channels === 1) {
    return convertToColorSpace(input, ColorConversionCodes.COLOR_GRAY2RGB, DataTypes.CV_8UC3);
  }
  throw new Error(`Unsupported channel count for RGB conversion: ${input.channels}`);
}

async function ensureRgbaMat(input: NativeMatHandle): Promise<NativeMatHandle> {
  if (input.channels === 4) {
    return input;
  }
  if (input.channels === 3) {
    return convertToColorSpace(input, ColorConversionCodes.COLOR_RGB2RGBA, DataTypes.CV_8UC4);
  }
  if (input.channels === 1) {
    return convertToColorSpace(input, ColorConversionCodes.COLOR_GRAY2RGBA, DataTypes.CV_8UC4);
  }
  throw new Error(`Unsupported channel count for RGBA conversion: ${input.channels}`);
}

export async function getOpenCvAdapterStatus(): Promise<OpenCvAdapterStatus> {
  try {
    return typeof OpenCV?.invoke === 'function' && typeof OpenCV?.base64ToMat === 'function'
      ? 'ready'
      : 'unconfigured';
  } catch {
    return 'unconfigured';
  }
}

export async function loadImageUriToMat(uri: string): Promise<NativeMatHandle> {
  ensureReady('loadImageUriToMat');
  const file = new File(uri);
  const base64 = await file.base64();
  const mat = OpenCV.base64ToMat(base64);
  return wrapMat(mat);
}

export async function resizeMat(
  input: NativeMatHandle,
  width: number,
  height: number,
): Promise<NativeMatHandle> {
  ensureReady('resizeMat');
  const outputType = input.channels === 4 ? DataTypes.CV_8UC4 : input.channels === 3 ? DataTypes.CV_8UC3 : DataTypes.CV_8UC1;
  const output = createEmptyMat(outputType);
  const size = OpenCV.createObject(ObjectType.Size, width, height);
  const interpolation = width < input.width || height < input.height
    ? InterpolationFlags.INTER_AREA
    : InterpolationFlags.INTER_LINEAR;
  OpenCV.invoke('resize', input.mat, output, size, 0, 0, interpolation);
  return wrapMat(output);
}

export async function saveMatToCacheFile(input: NativeMatHandle, prefix: string): Promise<string> {
  ensureReady('saveMatToCacheFile');
  const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const outputFile = new File(Paths.cache, `${safePrefix}-${Date.now()}.png`);
  if (outputFile.exists) {
    outputFile.delete();
  }
  OpenCV.saveMatToFile(input.mat, outputFile.uri, 'png', 1);
  return outputFile.uri;
}

export async function saveRgbaBufferToCacheFile(input: ImageBufferRGBA, prefix: string): Promise<string> {
  ensureReady('saveRgbaBufferToCacheFile');
  const bytes = input.data instanceof Uint8ClampedArray ? new Uint8Array(input.data) : input.data;
  const source = OpenCV.bufferToMat('uint8', input.height, input.width, 4, bytes);
  const bgra = createEmptyMat(DataTypes.CV_8UC4);
  OpenCV.invoke('cvtColor', source, bgra, ColorConversionCodes.COLOR_RGBA2BGRA);
  const outputFile = new File(Paths.cache, `${prefix.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}-${Date.now()}.png`);
  if (outputFile.exists) {
    outputFile.delete();
  }
  OpenCV.saveMatToFile(bgra, outputFile.uri, 'png', 1);
  return outputFile.uri;
}

export async function rgbaToRgb(input: ImageBufferRGBA): Promise<NativeMatHandle> {
  ensureReady('rgbaToRgb');
  const bytes = input.data instanceof Uint8ClampedArray ? new Uint8Array(input.data) : input.data;
  const source = OpenCV.bufferToMat('uint8', input.height, input.width, 4, bytes);
  const output = createEmptyMat(DataTypes.CV_8UC3);
  OpenCV.invoke('cvtColor', source, output, ColorConversionCodes.COLOR_RGBA2RGB);
  return wrapMat(output);
}

export async function rgbToLab(input: NativeMatHandle): Promise<NativeMatHandle> {
  const rgbInput = await ensureRgbMat(input);
  return convertToColorSpace(rgbInput, ColorConversionCodes.COLOR_RGB2Lab, DataTypes.CV_8UC3);
}

export async function labPaletteToRgbBytes(labPalette: Uint8Array): Promise<Uint8Array> {
  ensureReady('labPaletteToRgbBytes');
  if (labPalette.length === 0) {
    return new Uint8Array(0);
  }

  const colorCount = Math.max(1, Math.floor(labPalette.length / 3));
  const source = OpenCV.bufferToMat('uint8', 1, colorCount, 3, labPalette);
  const output = createEmptyMat(DataTypes.CV_8UC3);
  OpenCV.invoke('cvtColor', source, output, ColorConversionCodes.COLOR_Lab2RGB);
  const info = OpenCV.matToBuffer(output, 'uint8');
  return new Uint8Array(info.buffer);
}

export async function rgbPaletteToLabBytes(paletteRgb: Uint8Array): Promise<Uint8Array> {
  ensureReady('rgbPaletteToLabBytes');
  if (paletteRgb.length === 0) {
    return new Uint8Array(0);
  }

  const colorCount = Math.max(1, Math.floor(paletteRgb.length / 3));
  const source = OpenCV.bufferToMat('uint8', 1, colorCount, 3, paletteRgb);
  const output = createEmptyMat(DataTypes.CV_8UC3);
  OpenCV.invoke('cvtColor', source, output, ColorConversionCodes.COLOR_RGB2Lab);
  const info = OpenCV.matToBuffer(output, 'uint8');
  return new Uint8Array(info.buffer);
}

export async function bilateralSmoothRgb(
  input: NativeMatHandle,
  d: number,
  sigmaColor: number,
  sigmaSpace: number,
): Promise<NativeMatHandle> {
  ensureReady('bilateralSmoothRgb');
  const rgbInput = await ensureRgbMat(input);
  const output = createEmptyMat(DataTypes.CV_8UC3);
  OpenCV.invoke('bilateralFilter', rgbInput.mat, output, d, sigmaColor, sigmaSpace, BorderTypes.BORDER_DEFAULT);
  return wrapMat(output);
}

export async function labMatToFloat32Samples(input: NativeMatHandle): Promise<Float32Array> {
  ensureReady('labMatToFloat32Samples');
  if (input.channels !== 3) {
    throw new Error('labMatToFloat32Samples expects a 3-channel Lab mat. Convert RGB input with rgbToLab() first.');
  }
  const info = OpenCV.matToBuffer(input.mat, 'uint8');
  const samples = new Float32Array(info.buffer.length);
  for (let index = 0; index < info.buffer.length; index += 1) {
    samples[index] = info.buffer[index];
  }
  return samples;
}

export async function matToRGBA(input: NativeMatHandle): Promise<ImageBufferRGBA> {
  ensureReady('matToRGBA');
  const rgbaMat = await ensureRgbaMat(input);
  const info = OpenCV.matToBuffer(rgbaMat.mat, 'uint8');
  return {
    width: info.cols,
    height: info.rows,
    data: new Uint8Array(info.buffer),
  };
}

export async function findRegionLabelPointForBBox(args: {
  regionMap: Int32Array | Uint32Array;
  regionId: number;
  bbox: [number, number, number, number];
  width: number;
  height: number;
}): Promise<{ x: number; y: number; radius: number }> {
  ensureReady('findRegionLabelPointForBBox');

  const [x1, y1, x2, y2] = args.bbox;
  const boxWidth = Math.max(0, x2 - x1);
  const boxHeight = Math.max(0, y2 - y1);
  const mask = new Uint8Array(boxWidth * boxHeight);
  let hasAny = false;

  for (let localY = 0; localY < boxHeight; localY += 1) {
    for (let localX = 0; localX < boxWidth; localX += 1) {
      const globalIndex = (y1 + localY) * args.width + x1 + localX;
      const maskIndex = localY * boxWidth + localX;
      if (args.regionMap[globalIndex] === args.regionId) {
        mask[maskIndex] = 1;
        hasAny = true;
      }
    }
  }

  if (!hasAny || boxWidth === 0 || boxHeight === 0) {
    return { x: x1, y: y1, radius: 0 };
  }

  const maskMat = OpenCV.bufferToMat('uint8', boxHeight, boxWidth, 1, mask);
  const paddedMat = createEmptyMat(DataTypes.CV_8UC1);
  const distanceMat = createEmptyMat(DataTypes.CV_32FC1);
  const zero = OpenCV.createObject(ObjectType.Scalar, 0, 0, 0, 0);

  OpenCV.invoke('copyMakeBorder', maskMat, paddedMat, 1, 1, 1, 1, BorderTypes.BORDER_CONSTANT, zero);
  OpenCV.invoke('distanceTransform', paddedMat, distanceMat, DistanceTypes.DIST_L2, DistanceTransformMasks.DIST_MASK_5);
  const distancePeak = OpenCV.invoke('minMaxLoc', distanceMat);

  return {
    x: clampInteger(x1 + Math.trunc(distancePeak.maxX) - 1, 0, args.width - 1),
    y: clampInteger(y1 + Math.trunc(distancePeak.maxY) - 1, 0, args.height - 1),
    radius: distancePeak.maxVal,
  };
}

export async function releaseMat(input: NativeMatHandle): Promise<void> {
  ensureReady('releaseMat');
  OpenCV.releaseBuffers([input.id]);
}

export async function clearOpenCVBuffers(): Promise<void> {
  ensureReady('clearOpenCVBuffers');
  OpenCV.clearBuffers();
}
