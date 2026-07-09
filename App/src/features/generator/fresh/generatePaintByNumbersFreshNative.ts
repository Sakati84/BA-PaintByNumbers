import type { ImagePickerAsset } from 'expo-image-picker';

import type { GeneratorProgress, GeneratorResult, GeneratorSettings } from '../generatorTypes';
import { preparePickedImageForGenerator } from '../prepareImage';
import {
  generatePaintByNumbersFreshFromPreparedInput,
  getReusableFreshDecodedInput,
  type GeneratePaintByNumbersOptions,
} from './generatePaintByNumbersFresh';

export type { GeneratorPipelineDebugCache } from './generatePaintByNumbersFresh';

const FRESH_WORK_MAX_EDGE = 1400;

export async function generatePaintByNumbers(
  asset: ImagePickerAsset,
  settings: GeneratorSettings,
  onProgress?: (progress: GeneratorProgress) => void,
  options: GeneratePaintByNumbersOptions = {},
): Promise<GeneratorResult> {
  const sourceKey = [asset.uri, asset.width, asset.height, asset.fileName ?? '', asset.fileSize ?? ''].join('|');
  const cachedPrepared = getReusableFreshDecodedInput(
    options.debug?.cache,
    sourceKey,
    settings,
    options.debug?.rerunFromStage,
  );
  const decodeStarted = globalThis.performance?.now?.() ?? Date.now();
  const requestedWidth = Number.isFinite(settings.resizeImageWidth) ? settings.resizeImageWidth : FRESH_WORK_MAX_EDGE;
  const requestedHeight = Number.isFinite(settings.resizeImageHeight) ? settings.resizeImageHeight : FRESH_WORK_MAX_EDGE;
  const prepared = cachedPrepared ?? await preparePickedImageForGenerator(asset, {
    ...settings,
    resizeImageWidth: Math.min(FRESH_WORK_MAX_EDGE, Math.max(1, requestedWidth)),
    resizeImageHeight: Math.min(FRESH_WORK_MAX_EDGE, Math.max(1, requestedHeight)),
  });
  const decodeFinished = globalThis.performance?.now?.() ?? Date.now();
  return generatePaintByNumbersFreshFromPreparedInput(
    prepared,
    settings,
    onProgress,
    {
      ...options,
      preparedDecodeDurationMs: cachedPrepared == null ? decodeFinished - decodeStarted : 0,
      cacheSourceKey: sourceKey,
    },
  );
}
