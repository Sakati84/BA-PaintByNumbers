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
} from "./pipeline";
import opencvScriptUrl from "@techstark/opencv-js/dist/opencv.js?url";

type RuntimeMessageData = {
  type: string;
  payload?: any;
  error?: string;
  id?: string;
};

type RuntimeMessageListener = (event: MessageEvent<RuntimeMessageData>) => void;

type OpenCvBootstrap = {
  Mat?: unknown;
  then?: (onfulfilled: (value: any) => void, onrejected?: (reason: unknown) => void) => void;
  onRuntimeInitialized?: (() => void) | null;
};

export type PipelineRuntimeHandle = {
  onmessage: ((event: MessageEvent<RuntimeMessageData>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  addEventListener: (type: "message", listener: RuntimeMessageListener) => void;
  removeEventListener: (type: "message", listener: RuntimeMessageListener) => void;
  postMessage: (message: { type: string; payload?: any; id?: string }) => void;
  terminate: () => void;
};

type RuntimeKind = "worker" | "inline";

function canvasToImageData(canvas: OffscreenCanvas): ImageData {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is not available.");
  }
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function isFileProtocolRuntime(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "file:";
}

async function loadInlineOpenCvRuntime(): Promise<any> {
  const existing = (window as any).cv as any;
  if (existing?.Mat) {
    return existing;
  }

  const candidate = await new Promise<any>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("OpenCV script load timeout (30s)."));
    }, 30000);

    const finish = () => {
      window.clearTimeout(timeout);
      resolve((window as any).cv);
    };

    const existingScript = document.querySelector(`script[data-opencv-local="true"]`) as HTMLScriptElement | null;
    if (existingScript) {
      if ((window as any).cv) {
        finish();
        return;
      }
      existingScript.addEventListener("load", finish, { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Failed to load local OpenCV script.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = opencvScriptUrl;
    script.async = true;
    script.setAttribute("data-opencv-local", "true");
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error(`Failed to load local OpenCV script: ${opencvScriptUrl}`));
    }, { once: true });
    document.head.appendChild(script);
  });

  if (candidate == null) {
    throw new Error("OpenCV script did not attach a runtime to window.cv.");
  }

  if (candidate instanceof Promise) {
    return await candidate;
  }

  if (typeof candidate.then === "function") {
    return await new Promise<any>((resolve, reject) => {
      candidate.then?.(resolve, reject);
    });
  }

  if (candidate.Mat) {
    return candidate as any;
  }

  return await new Promise<any>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("OpenCV initialization timeout (30s)."));
    }, 30000);
    const previousHandler = candidate.onRuntimeInitialized;
    candidate.onRuntimeInitialized = () => {
      window.clearTimeout(timeout);
      previousHandler?.();
      resolve(candidate);
    };
  });
}

class InlinePipelineRuntime implements PipelineRuntimeHandle {
  public onmessage: ((event: MessageEvent<RuntimeMessageData>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;

  private readonly listeners = new Set<RuntimeMessageListener>();
  private terminated = false;
  private cvReady = false;
  private cvRuntime: any = null;
  private initPromise: Promise<any> | null = null;

  private sourceImageData: ImageData | null = null;
  private normalizedResult: { canvas: OffscreenCanvas; width: number; height: number } | null = null;
  private smoothCanvas: OffscreenCanvas | null = null;
  private quantizedResult: QuantizationResult | null = null;
  private protrusionResult: ProtrusionPruneResult | null = null;
  private regionMergeResult: RegionMergeResult | null = null;

  addEventListener(type: "message", listener: RuntimeMessageListener): void {
    if (type === "message") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: "message", listener: RuntimeMessageListener): void {
    if (type === "message") {
      this.listeners.delete(listener);
    }
  }

  postMessage(message: { type: string; payload?: any; id?: string }): void {
    if (this.terminated) {
      return;
    }
    void this.handleMessage(message);
  }

  terminate(): void {
    this.terminated = true;
    this.listeners.clear();
  }

  private emit(data: RuntimeMessageData): void {
    if (this.terminated) {
      return;
    }
    const event = { data } as MessageEvent<RuntimeMessageData>;
    this.onmessage?.(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitError(error: unknown, id?: string): void {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.trim() : String(error);
    this.emit({ type: "ERROR", error: message, id });
  }

  private clearFrom(stage: string): void {
    const stages = ["normalize", "smooth", "quantize", "protrusions", "region-merge", "render"];
    const index = stages.indexOf(stage);
    if (index <= 0) {
      this.normalizedResult = null;
      this.smoothCanvas = null;
      this.quantizedResult = null;
      this.protrusionResult = null;
      this.regionMergeResult = null;
    }
    if (index <= 1) {
      this.smoothCanvas = null;
      this.quantizedResult = null;
      this.protrusionResult = null;
      this.regionMergeResult = null;
    }
    if (index <= 2) {
      this.quantizedResult = null;
      this.protrusionResult = null;
      this.regionMergeResult = null;
    }
    if (index <= 3) {
      this.protrusionResult = null;
      this.regionMergeResult = null;
    }
    if (index <= 4) {
      this.regionMergeResult = null;
    }
  }

  private async ensureReady(): Promise<any> {
    if (this.cvReady && this.cvRuntime) {
      return this.cvRuntime;
    }
    if (!this.initPromise) {
      this.initPromise = loadInlineOpenCvRuntime().then((runtime) => {
        this.cvRuntime = runtime;
        this.cvReady = true;
        return runtime;
      });
    }
    return await this.initPromise;
  }

  private async handleMessage(message: { type: string; payload?: any; id?: string }): Promise<void> {
    const { type, payload, id } = message;

    try {
      if (type === "INIT") {
        await this.ensureReady();
        this.emit({ type: "READY", id });
        return;
      }

      if (type === "LOAD_IMAGE") {
        await this.ensureReady();
        this.sourceImageData = payload.imageData;
        this.clearFrom("normalize");
        this.emit({
          type: "STEP_SUCCESS",
          payload: {
            stepId: "load",
            result: this.sourceImageData,
            width: this.sourceImageData!.width,
            height: this.sourceImageData!.height,
          },
          id,
        });
        return;
      }

      if (type !== "RUN_STEP") {
        this.emit({ type: "ERROR", error: `Unknown message type: ${type}`, id });
        return;
      }

      const cv = await this.ensureReady();
      if (!this.sourceImageData) {
        this.emit({ type: "ERROR", error: "No image loaded.", id });
        return;
      }

      const { stepId, options } = payload;
      let resultImageData: ImageData;
      let resultWidth: number;
      let resultHeight: number;
      let resultColorCount: number | undefined;
      let resultPaletteRgb: Uint8Array | undefined;

      switch (stepId) {
        case "normalize": {
          this.clearFrom("normalize");
          const result = await loadAndNormalizeImage(this.sourceImageData, options?.resizeMax ?? 1200);
          this.normalizedResult = result;
          resultImageData = canvasToImageData(result.canvas);
          resultWidth = result.width;
          resultHeight = result.height;
          break;
        }
        case "smooth": {
          if (!this.normalizedResult) {
            this.emit({ type: "ERROR", error: 'Run "Normalize" first.', id });
            return;
          }
          this.clearFrom("smooth");
          const result = applyBilateralSmoothing(this.normalizedResult.canvas, cv);
          this.smoothCanvas = result;
          resultImageData = canvasToImageData(result);
          resultWidth = result.width;
          resultHeight = result.height;
          break;
        }
        case "quantize": {
          if (!this.smoothCanvas) {
            this.emit({ type: "ERROR", error: 'Run "Bilateral Smoothing" first.', id });
            return;
          }
          this.clearFrom("quantize");
          const result = applyKMeansQuantization(this.smoothCanvas, options?.colorCount ?? 24, cv);
          this.quantizedResult = result;
          resultImageData = canvasToImageData(result.canvas);
          resultWidth = result.width;
          resultHeight = result.height;
          resultColorCount = result.colorCount;
          resultPaletteRgb = result.paletteRgb;
          break;
        }
        case "protrusions": {
          if (!this.quantizedResult) {
            this.emit({ type: "ERROR", error: 'Run "K-Means Quantize" first.', id });
            return;
          }
          this.clearFrom("protrusions");
          const result = applyProtrusionPruning(this.quantizedResult, cv, options?.pruneRadius);
          this.protrusionResult = result;
          resultImageData = canvasToImageData(result.canvas);
          resultWidth = result.width;
          resultHeight = result.height;
          resultColorCount = result.colorCount;
          resultPaletteRgb = result.paletteRgb;
          break;
        }
        case "region-merge": {
          if (!this.protrusionResult) {
            this.emit({ type: "ERROR", error: 'Run "Protrusion Pruning" first.', id });
            return;
          }
          this.clearFrom("region-merge");
          const result = applyRegionMerging(
            this.protrusionResult,
            cv,
            options?.minRegionSize,
            options?.protectHighContrast,
            options?.highContrastMinPx,
          );
          this.regionMergeResult = result;
          resultImageData = canvasToImageData(result.canvas);
          resultWidth = result.width;
          resultHeight = result.height;
          resultColorCount = result.colorCount;
          resultPaletteRgb = result.paletteRgb;
          break;
        }
        case "render": {
          if (!this.regionMergeResult) {
            this.emit({ type: "ERROR", error: 'Run "Region Merging" first.', id });
            return;
          }
          const templates = applyAllTemplateRenders(this.regionMergeResult, cv);
          resultImageData = canvasToImageData(templates.brightColorCircles);
          resultWidth = templates.brightColorCircles.width;
          resultHeight = templates.brightColorCircles.height;
          this.emit({
            type: "STEP_SUCCESS",
            payload: {
              stepId,
              result: resultImageData,
              width: resultWidth,
              height: resultHeight,
              templates: {
                colorCircles: canvasToImageData(templates.colorCircles),
                circlesOnly: canvasToImageData(templates.circlesOnly),
                numbers: canvasToImageData(templates.numbers),
                classic: canvasToImageData(templates.classic),
                debugUnlabeled: canvasToImageData(templates.debugUnlabeled),
              },
              regionCount: templates.regionCount,
              placementCount: templates.placementCount,
            },
            id,
          });
          return;
        }
        default:
          this.emit({ type: "ERROR", error: `Unknown step: ${stepId}`, id });
          return;
      }

      this.emit({
        type: "STEP_SUCCESS",
        payload: {
          stepId,
          result: resultImageData,
          width: resultWidth,
          height: resultHeight,
          colorCount: resultColorCount,
          paletteRgb: resultPaletteRgb ? Array.from(resultPaletteRgb) : undefined,
        },
        id,
      });
    } catch (error) {
      this.emitError(error, id);
    }
  }
}

export function createPipelineRuntime(): { runtime: PipelineRuntimeHandle; kind: RuntimeKind } {
  if (isFileProtocolRuntime()) {
    return {
      runtime: new InlinePipelineRuntime(),
      kind: "inline",
    };
  }

  return {
    runtime: new Worker(new URL("./worker.ts", import.meta.url)),
    kind: "worker",
  };
}
