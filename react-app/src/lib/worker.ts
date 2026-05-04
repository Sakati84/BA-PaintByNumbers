/// <reference lib="webworker" />

declare var self: DedicatedWorkerGlobalScope;

import opencvScriptUrl from "@techstark/opencv-js/dist/opencv.js?url";

import {
  loadAndNormalizeImage,
  applyBilateralSmoothing,
  applyKMeansQuantization,
  applyProtrusionPruning,
  applyRegionMerging,
  applyAllTemplateRenders,
  type QuantizationResult,
  type ProtrusionPruneResult,
  type RegionMergeResult,
} from './pipeline';

let cvReady = false;

// Pipeline state persisted across steps
let sourceImageData: ImageData | null = null;
let normalizedResult: { canvas: OffscreenCanvas; width: number; height: number } | null = null;
let smoothCanvas: OffscreenCanvas | null = null;
let quantizedResult: QuantizationResult | null = null;
let protrusionResult: ProtrusionPruneResult | null = null;
let regionMergeResult: RegionMergeResult | null = null;

function canvasToImageData(canvas: OffscreenCanvas): ImageData {
  const ctx = canvas.getContext('2d')!;
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function clearFrom(stage: string) {
  const stages = ['normalize', 'smooth', 'quantize', 'protrusions', 'region-merge', 'render'];
  const idx = stages.indexOf(stage);
  if (idx <= 0) { normalizedResult = null; smoothCanvas = null; quantizedResult = null; protrusionResult = null; regionMergeResult = null; }
  if (idx <= 1) { smoothCanvas = null; quantizedResult = null; protrusionResult = null; regionMergeResult = null; }
  if (idx <= 2) { quantizedResult = null; protrusionResult = null; regionMergeResult = null; }
  if (idx <= 3) { protrusionResult = null; regionMergeResult = null; }
  if (idx <= 4) { regionMergeResult = null; }
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  // ── INIT: load OpenCV from CDN ──
  if (type === 'INIT') {
    if (cvReady) {
      self.postMessage({ type: 'READY', id });
      return;
    }

    try {
      console.log('Worker: loading local OpenCV runtime...');
      self.importScripts(opencvScriptUrl);

      let cvObj = (self as any).cv;

      const fallback = setTimeout(() => {
        if (!cvReady) {
          self.postMessage({
            type: 'ERROR',
            error: 'OpenCV initialization timeout (30s). Check network.',
            id,
          });
        }
      }, 30000);

      const handleReady = (cvMod?: any) => {
        if (cvReady) return;
        if (cvMod) (self as any).cv = cvMod;
        cvReady = true;
        clearTimeout(fallback);
        console.log('Worker: OpenCV ready');
        self.postMessage({ type: 'READY', id });
      };

      if (typeof cvObj === 'function') {
        const res = cvObj();
        if (res && typeof res.then === 'function') {
          res.then(handleReady);
        } else if (res && res.Mat) {
          handleReady(res);
        }
      } else if (cvObj && typeof cvObj.then === 'function') {
        cvObj.then(handleReady);
      } else if (cvObj && cvObj.Mat) {
        handleReady(cvObj);
      } else {
        const checkCv = setInterval(() => {
          let cx = (self as any).cv;
          if (cx && typeof cx === 'function') cx = cx();
          if (cx && typeof cx.then === 'function') {
            clearInterval(checkCv);
            cx.then(handleReady);
          } else if (cx && cx.Mat && !cvReady) {
            clearInterval(checkCv);
            handleReady(cx);
          }
        }, 100);
      }
    } catch (error) {
      console.error('Worker: Error in init:', error);
      self.postMessage({ type: 'ERROR', error: String(error), id });
    }
  }

  // ── LOAD_IMAGE: store raw image data ──
  if (type === 'LOAD_IMAGE') {
    try {
      sourceImageData = payload.imageData;
      clearFrom('normalize');
      self.postMessage({
        type: 'STEP_SUCCESS',
        payload: {
          stepId: 'load',
          result: sourceImageData,
          width: sourceImageData!.width,
          height: sourceImageData!.height,
        },
        id,
      });
    } catch (error) {
      self.postMessage({ type: 'ERROR', error: String(error), id });
    }
  }

  // ── RUN_STEP: execute a single named pipeline step ──
  if (type === 'RUN_STEP') {
    if (!cvReady) {
      self.postMessage({ type: 'ERROR', error: 'OpenCV not ready', id });
      return;
    }
    if (!sourceImageData) {
      self.postMessage({ type: 'ERROR', error: 'No image loaded.', id });
      return;
    }

    const { stepId, options } = payload;
    const cv = (self as any).cv;

    try {
      let resultImageData: ImageData;
      let resultWidth: number;
      let resultHeight: number;
      let resultColorCount: number | undefined;
      let resultPaletteRgb: Uint8Array | undefined;

      switch (stepId) {
        case 'normalize': {
          clearFrom('normalize');
          const result = await loadAndNormalizeImage(sourceImageData!, options?.resizeMax ?? 1200);
          normalizedResult = result;
          resultImageData = canvasToImageData(result.canvas);
          resultWidth = result.width;
          resultHeight = result.height;
          break;
        }

        case 'smooth': {
          if (!normalizedResult) {
            self.postMessage({ type: 'ERROR', error: 'Run "Normalize" first.', id });
            return;
          }
          clearFrom('smooth');
          const result = applyBilateralSmoothing(normalizedResult.canvas, cv);
          smoothCanvas = result;
          resultImageData = canvasToImageData(result);
          resultWidth = result.width;
          resultHeight = result.height;
          break;
        }

        case 'quantize': {
          if (!smoothCanvas) {
            self.postMessage({ type: 'ERROR', error: 'Run "Bilateral Smoothing" first.', id });
            return;
          }
          clearFrom('quantize');
          const result = applyKMeansQuantization(smoothCanvas, options?.colorCount ?? 24, cv);
          quantizedResult = result;
          resultImageData = canvasToImageData(result.canvas);
          resultWidth = result.width;
          resultHeight = result.height;
          resultColorCount = result.colorCount;
          resultPaletteRgb = result.paletteRgb;
          break;
        }

        case 'protrusions': {
          if (!quantizedResult) {
            self.postMessage({ type: 'ERROR', error: 'Run "K-Means Quantize" first.', id });
            return;
          }
          clearFrom('protrusions');
          const result = applyProtrusionPruning(quantizedResult, cv, options?.pruneRadius);
          protrusionResult = result;
          resultImageData = canvasToImageData(result.canvas);
          resultWidth = result.width;
          resultHeight = result.height;
          resultColorCount = result.colorCount;
          resultPaletteRgb = result.paletteRgb;
          break;
        }

        case 'region-merge': {
          if (!protrusionResult) {
            self.postMessage({ type: 'ERROR', error: 'Run "Protrusion Pruning" first.', id });
            return;
          }
          clearFrom('region-merge');
          const result = applyRegionMerging(protrusionResult, cv, options?.minRegionSize, options?.protectHighContrast, options?.highContrastMinPx, options?.maxRegions);
          regionMergeResult = result;
          resultImageData = canvasToImageData(result.canvas);
          resultWidth = result.width;
          resultHeight = result.height;
          resultColorCount = result.colorCount;
          resultPaletteRgb = result.paletteRgb;
          break;
        }

        case 'render': {
          if (!regionMergeResult) {
            self.postMessage({ type: 'ERROR', error: 'Run "Region Merging" first.', id });
            return;
          }
          const templates = applyAllTemplateRenders(regionMergeResult, cv);
          // Primary result is bright color circles
          resultImageData = canvasToImageData(templates.brightColorCircles);
          resultWidth = templates.brightColorCircles.width;
          resultHeight = templates.brightColorCircles.height;
          // Attach all template ImageData
          const extraTemplates: Record<string, ImageData> = {
            colorCircles: canvasToImageData(templates.colorCircles),
            circlesOnly: canvasToImageData(templates.circlesOnly),
            numbers: canvasToImageData(templates.numbers),
            classic: canvasToImageData(templates.classic),
            debugUnlabeled: canvasToImageData(templates.debugUnlabeled),
          };
          // Send with extra templates in payload
          self.postMessage({
            type: 'STEP_SUCCESS',
            payload: {
              stepId,
              result: resultImageData,
              width: resultWidth,
              height: resultHeight,
              templates: extraTemplates,
              regionCount: templates.regionCount,
              placementCount: templates.placementCount,
            },
            id,
          });
          return; // early return — we already posted
        }

        default:
          self.postMessage({ type: 'ERROR', error: `Unknown step: ${stepId}`, id });
          return;
      }

      self.postMessage({
        type: 'STEP_SUCCESS',
        payload: {
          stepId,
          result: resultImageData!,
          width: resultWidth!,
          height: resultHeight!,
          colorCount: resultColorCount,
          paletteRgb: resultPaletteRgb ? Array.from(resultPaletteRgb) : undefined,
        },
        id,
      });
    } catch (error) {
      const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
      console.error(`Worker: error in step ${stepId}:`, error);
      self.postMessage({ type: 'ERROR', error: msg, id });
    }
  }
};
