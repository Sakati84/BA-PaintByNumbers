import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import { decode } from 'fast-png';
import { Platform } from 'react-native';

import type { SimpleImageData } from '../../types/imageData';
import type { GeneratorSettings, PreparedImage } from './generatorTypes';

function calculateTargetSize(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height };
  }

  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function normalizeChannel(value: number, depth: number): number {
  if (depth <= 8) {
    return value;
  }
  return Math.round((value / ((1 << depth) - 1)) * 255);
}

function flattenDecodedPngToImageData(decoded: ReturnType<typeof decode>): SimpleImageData {
  const data = new Uint8ClampedArray(decoded.width * decoded.height * 4);
  const channels = decoded.channels;
  const depth = decoded.depth;
  const source = decoded.data;

  for (let pixel = 0; pixel < decoded.width * decoded.height; pixel += 1) {
    const srcOffset = pixel * channels;
    const dstOffset = pixel * 4;
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 255;

    if (channels === 1) {
      red = green = blue = normalizeChannel(source[srcOffset], depth);
    } else if (channels === 2) {
      red = green = blue = normalizeChannel(source[srcOffset], depth);
      alpha = normalizeChannel(source[srcOffset + 1], depth);
    } else if (channels === 3) {
      red = normalizeChannel(source[srcOffset], depth);
      green = normalizeChannel(source[srcOffset + 1], depth);
      blue = normalizeChannel(source[srcOffset + 2], depth);
    } else {
      red = normalizeChannel(source[srcOffset], depth);
      green = normalizeChannel(source[srcOffset + 1], depth);
      blue = normalizeChannel(source[srcOffset + 2], depth);
      alpha = normalizeChannel(source[srcOffset + 3], depth);
    }

    const alphaRatio = alpha / 255;
    data[dstOffset] = Math.round(255 * (1 - alphaRatio) + red * alphaRatio);
    data[dstOffset + 1] = Math.round(255 * (1 - alphaRatio) + green * alphaRatio);
    data[dstOffset + 2] = Math.round(255 * (1 - alphaRatio) + blue * alphaRatio);
    data[dstOffset + 3] = 255;
  }

  return {
    width: decoded.width,
    height: decoded.height,
    data,
  };
}

async function preparePickedImageForWeb(
  asset: ImagePickerAsset,
  target: { width: number; height: number },
): Promise<{ prepared: PreparedImage; imageData: SimpleImageData }> {
  const imageElement = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image in browser.'));
    image.src = asset.uri;
  });

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context == null) {
    throw new Error('Could not create a 2D canvas context for image preparation.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(imageElement, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const preparedUri = canvas.toDataURL('image/png');

  return {
    prepared: {
      imageUri: preparedUri,
      width: imageData.width,
      height: imageData.height,
      fileName: asset.fileName ?? null,
      mimeType: 'image/png',
    },
    imageData: {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
    },
  };
}

export async function preparePickedImageForGenerator(
  asset: ImagePickerAsset,
  settings: GeneratorSettings,
): Promise<{ prepared: PreparedImage; imageData: SimpleImageData }> {
  const target = calculateTargetSize(
    asset.width,
    asset.height,
    settings.resizeImageWidth,
    settings.resizeImageHeight,
  );
  const needsResize = target.width !== asset.width || target.height !== asset.height;

  if (Platform.OS === 'web') {
    return preparePickedImageForWeb(asset, target);
  }

  const manipulated = await manipulateAsync(
    asset.uri,
    needsResize ? [{ resize: target }] : [],
    {
      compress: 1,
      format: SaveFormat.PNG,
    },
  );

  const file = new File(manipulated.uri);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoded = decode(bytes);
  const imageData = flattenDecodedPngToImageData(decoded);

  return {
    prepared: {
      imageUri: manipulated.uri,
      width: imageData.width,
      height: imageData.height,
      fileName: asset.fileName ?? null,
      mimeType: 'image/png',
    },
    imageData,
  };
}
