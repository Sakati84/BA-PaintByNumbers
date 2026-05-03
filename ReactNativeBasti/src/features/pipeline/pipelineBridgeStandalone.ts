import {
  applyAllTemplateRenders,
  applyBilateralSmoothing,
  applyKMeansQuantization,
  applyProtrusionPruning,
  applyRegionMerging,
  loadAndNormalizeImage,
  type ProtrusionPruneResult,
  type QuantizationResult,
  type RegionMergeResult,
} from "../../../../react-app/src/lib/pipeline";

type PipelineStepId = "normalize" | "smooth" | "quantize" | "protrusions" | "region-merge" | "render";

type PipelineOptions = {
  resizeMax?: number;
  colorCount?: number;
  minRegionSize?: number;
  protectHighContrast?: boolean;
  highContrastMinPx?: number;
  pruneRadius?: number;
};

type BridgeCommand =
  | { type: "INIT"; requestId?: string }
  | {
      type: "LOAD_IMAGE";
      requestId: string;
      image: { kind: "base64"; base64: string; mimeType: string };
    }
  | { type: "RUN_ALL"; requestId: string; options: PipelineOptions }
  | { type: "RESET"; requestId?: string };

const PIPELINE_STEPS: PipelineStepId[] = [
  "normalize",
  "smooth",
  "quantize",
  "protrusions",
  "region-merge",
  "render",
];

const STEP_LABELS: Record<PipelineStepId, string> = {
  normalize: "Normalize & Resize",
  smooth: "Bilateral Smoothing",
  quantize: "K-Means Quantize",
  protrusions: "Protrusion Pruning",
  "region-merge": "Region Merging",
  render: "Final Render",
};

let cvReady = false;
let cvInstance: any = null;
let sourceImageData: ImageData | null = null;
let normalizedResult: { canvas: OffscreenCanvas; width: number; height: number } | null = null;
let smoothCanvas: OffscreenCanvas | null = null;
let quantizedResult: QuantizationResult | null = null;
let protrusionResult: ProtrusionPruneResult | null = null;
let regionMergeResult: RegionMergeResult | null = null;

function postToNative(message: unknown): void {
  const serialized = JSON.stringify(message);
  if ((window as any).ReactNativeWebView?.postMessage) {
    (window as any).ReactNativeWebView.postMessage(serialized);
    return;
  }
  console.log("[pipeline-standalone]", serialized);
}

function postError(requestId: string | undefined, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  postToNative({ type: "ERROR", requestId, message, stack });
}

function postStatus(message: string): void {
  postToNative({ type: "STATUS", message });
}

function clearFrom(stage: string): void {
  const stages = ["normalize", "smooth", "quantize", "protrusions", "region-merge", "render"];
  const idx = stages.indexOf(stage);
  if (idx <= 0) {
    normalizedResult = null;
    smoothCanvas = null;
    quantizedResult = null;
    protrusionResult = null;
    regionMergeResult = null;
  }
  if (idx <= 1) {
    smoothCanvas = null;
    quantizedResult = null;
    protrusionResult = null;
    regionMergeResult = null;
  }
  if (idx <= 2) {
    quantizedResult = null;
    protrusionResult = null;
    regionMergeResult = null;
  }
  if (idx <= 3) {
    protrusionResult = null;
    regionMergeResult = null;
  }
  if (idx <= 4) {
    regionMergeResult = null;
  }
}

function canvasToImageData(canvas: OffscreenCanvas): ImageData {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create canvas context.");
  }
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function imageDataToPngDataUrl(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create output canvas context.");
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function waitForCv(): any {
  if (cvReady && cvInstance) {
    return cvInstance;
  }
  throw new Error("OpenCV runtime is not ready yet.");
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`${label} timeout.`));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function resolveOpenCvCandidate(candidate: any): Promise<any> {
  if (!candidate) {
    throw new Error("OpenCV script did not expose window.cv.");
  }

  const resolvedCandidate = typeof candidate === "function" ? candidate() : candidate;
  if (resolvedCandidate?.Mat) {
    return resolvedCandidate;
  }

  if (resolvedCandidate && typeof resolvedCandidate.then === "function") {
    const resolved = await withTimeout(Promise.resolve(resolvedCandidate), 45000, "OpenCV runtime initialization");
    if (resolved?.Mat) {
      return resolved;
    }
  }

  if (resolvedCandidate && typeof resolvedCandidate === "object") {
    return await withTimeout(
      new Promise((resolve, reject) => {
        const existingRuntimeInitialized = resolvedCandidate.onRuntimeInitialized;
        resolvedCandidate.onRuntimeInitialized = function onRuntimeInitialized() {
          try {
            if (typeof existingRuntimeInitialized === "function") {
              existingRuntimeInitialized.call(resolvedCandidate);
            }
            if (resolvedCandidate.Mat) {
              resolve(resolvedCandidate);
            } else {
              reject(new Error("OpenCV runtime initialized without cv.Mat."));
            }
          } catch (error) {
            reject(error);
          }
        };
      }),
      45000,
      "OpenCV onRuntimeInitialized",
    );
  }

  throw new Error("Unsupported OpenCV runtime shape.");
}

async function initializeOpenCv(candidate: any = (window as any).cv): Promise<any> {
  if (cvReady && cvInstance) {
    return cvInstance;
  }

  postStatus("OpenCV script loaded, waiting for runtime");
  const resolved = await resolveOpenCvCandidate(candidate);
  cvInstance = resolved;
  (window as any).cv = resolved;
  cvReady = true;
  postStatus("OpenCV runtime ready");
  postToNative({ type: "READY" });
  return resolved;
}

async function imageCommandToImageData(image: Extract<BridgeCommand, { type: "LOAD_IMAGE" }>["image"]): Promise<ImageData> {
  const imageUrl = `data:${image.mimeType || "image/png"};base64,${image.base64}`;
  const imageElement = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("Failed to decode source image."));
    element.src = imageUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = imageElement.naturalWidth || imageElement.width;
  canvas.height = imageElement.naturalHeight || imageElement.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Could not create source canvas context.");
  }
  context.drawImage(imageElement, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function stepOptions(stepId: PipelineStepId, options: PipelineOptions): PipelineOptions {
  if (stepId === "normalize") {
    return { resizeMax: options.resizeMax };
  }
  if (stepId === "quantize") {
    return { colorCount: options.colorCount };
  }
  if (stepId === "protrusions") {
    return { pruneRadius: options.pruneRadius };
  }
  if (stepId === "region-merge") {
    return {
      minRegionSize: options.minRegionSize,
      protectHighContrast: options.protectHighContrast,
      highContrastMinPx: options.highContrastMinPx,
    };
  }
  return {};
}

async function handleLoadImage(command: Extract<BridgeCommand, { type: "LOAD_IMAGE" }>): Promise<void> {
  waitForCv();
  postToNative({
    type: "PROGRESS",
    requestId: command.requestId,
    stepId: "load",
    stepIndex: 0,
    stepCount: PIPELINE_STEPS.length + 1,
    message: "Loading source image",
    progress: 0,
  });
  sourceImageData = await imageCommandToImageData(command.image);
  clearFrom("normalize");
  postToNative({
    type: "IMAGE_LOADED",
    requestId: command.requestId,
    width: sourceImageData.width,
    height: sourceImageData.height,
  });
}

async function runStep(stepId: PipelineStepId, options: PipelineOptions): Promise<{
  result: ImageData;
  width: number;
  height: number;
  templates?: Record<string, ImageData>;
  regionCount?: number;
  placementCount?: number;
}> {
  if (!sourceImageData) {
    throw new Error("No image loaded.");
  }

  const cv = waitForCv();
  const nextOptions = stepOptions(stepId, options);

  if (stepId === "normalize") {
    clearFrom("normalize");
    const result = await loadAndNormalizeImage(sourceImageData, nextOptions.resizeMax ?? 1200);
    normalizedResult = result;
    return {
      result: canvasToImageData(result.canvas),
      width: result.width,
      height: result.height,
    };
  }

  if (stepId === "smooth") {
    if (!normalizedResult) {
      throw new Error('Run "Normalize" first.');
    }
    clearFrom("smooth");
    const result = applyBilateralSmoothing(normalizedResult.canvas, cv);
    smoothCanvas = result;
    return {
      result: canvasToImageData(result),
      width: result.width,
      height: result.height,
    };
  }

  if (stepId === "quantize") {
    if (!smoothCanvas) {
      throw new Error('Run "Bilateral Smoothing" first.');
    }
    clearFrom("quantize");
    const result = applyKMeansQuantization(smoothCanvas, nextOptions.colorCount ?? 24, cv);
    quantizedResult = result;
    return {
      result: canvasToImageData(result.canvas),
      width: result.width,
      height: result.height,
    };
  }

  if (stepId === "protrusions") {
    if (!quantizedResult) {
      throw new Error('Run "K-Means Quantize" first.');
    }
    clearFrom("protrusions");
    const result = applyProtrusionPruning(quantizedResult, cv, nextOptions.pruneRadius);
    protrusionResult = result;
    return {
      result: canvasToImageData(result.canvas),
      width: result.width,
      height: result.height,
    };
  }

  if (stepId === "region-merge") {
    if (!protrusionResult) {
      throw new Error('Run "Protrusion Pruning" first.');
    }
    clearFrom("region-merge");
    const result = applyRegionMerging(
      protrusionResult,
      cv,
      nextOptions.minRegionSize,
      nextOptions.protectHighContrast,
      nextOptions.highContrastMinPx,
    );
    regionMergeResult = result;
    return {
      result: canvasToImageData(result.canvas),
      width: result.width,
      height: result.height,
    };
  }

  if (stepId === "render") {
    if (!regionMergeResult) {
      throw new Error('Run "Region Merging" first.');
    }
    const templates = applyAllTemplateRenders(regionMergeResult, cv);
    return {
      result: canvasToImageData(templates.brightColorCircles),
      width: templates.brightColorCircles.width,
      height: templates.brightColorCircles.height,
      templates: {
        colorCircles: canvasToImageData(templates.colorCircles),
        circlesOnly: canvasToImageData(templates.circlesOnly),
        numbers: canvasToImageData(templates.numbers),
        classic: canvasToImageData(templates.classic),
        debugUnlabeled: canvasToImageData(templates.debugUnlabeled),
      },
      regionCount: templates.regionCount,
      placementCount: templates.placementCount,
    };
  }

  throw new Error(`Unknown step: ${stepId}`);
}

async function handleRunAll(command: Extract<BridgeCommand, { type: "RUN_ALL" }>): Promise<void> {
  const timings: Record<string, number> = {};
  const intermediateResults: Array<{
    stepId: PipelineStepId;
    label: string;
    imageUrl: string;
    width: number;
    height: number;
    timingMs: number;
  }> = [];

  for (let index = 0; index < PIPELINE_STEPS.length; index += 1) {
    const stepId = PIPELINE_STEPS[index];
    postToNative({
      type: "PROGRESS",
      requestId: command.requestId,
      stepId,
      stepIndex: index + 1,
      stepCount: PIPELINE_STEPS.length,
      message: STEP_LABELS[stepId],
      progress: Math.round((index / PIPELINE_STEPS.length) * 100),
    });

    const startedAt = performance.now();
    const payload = await runStep(stepId, command.options);
    const timingMs = performance.now() - startedAt;
    timings[stepId] = timingMs;

    const imageUrl = imageDataToPngDataUrl(payload.result);
    intermediateResults.push({
      stepId,
      label: STEP_LABELS[stepId],
      imageUrl,
      width: payload.width,
      height: payload.height,
      timingMs,
    });

    postToNative({
      type: "STEP_RESULT",
      requestId: command.requestId,
      stepId,
      label: STEP_LABELS[stepId],
      imageUrl,
      width: payload.width,
      height: payload.height,
      timingMs,
    });

    if (stepId === "render") {
      const templates = [
        { id: "brightColorCircles", label: "Bright Color Circles", imageUrl },
        ...Object.entries(payload.templates ?? {}).map(([id, imageData]) => ({
          id,
          label: String(id),
          imageUrl: imageDataToPngDataUrl(imageData),
        })),
      ];

      postToNative({
        type: "FINAL_RESULT",
        requestId: command.requestId,
        templates,
        intermediateResults,
        stats: {
          regionCount: payload.regionCount ?? 0,
          placementCount: payload.placementCount ?? 0,
        },
        timings,
      });
    }
  }

  postToNative({
    type: "PROGRESS",
    requestId: command.requestId,
    stepId: "done",
    stepIndex: PIPELINE_STEPS.length,
    stepCount: PIPELINE_STEPS.length,
    message: "Done",
    progress: 100,
  });
}

async function handleCommand(command: BridgeCommand): Promise<void> {
  try {
    if (command.type === "INIT") {
      await initializeOpenCv();
      postToNative({ type: "READY", requestId: command.requestId });
    } else if (command.type === "LOAD_IMAGE") {
      await handleLoadImage(command);
    } else if (command.type === "RUN_ALL") {
      await handleRunAll(command);
    } else if (command.type === "RESET") {
      sourceImageData = null;
      clearFrom("normalize");
      postToNative({ type: "RESET_DONE", requestId: command.requestId });
    }
  } catch (error) {
    postError(command.requestId, error);
  }
}

function parseMessage(event: MessageEvent): BridgeCommand | null {
  const raw = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
  try {
    return JSON.parse(raw) as BridgeCommand;
  } catch {
    return null;
  }
}

window.addEventListener("message", (event) => {
  const command = parseMessage(event);
  if (command) {
    void handleCommand(command);
  }
});

document.addEventListener("message", ((event: Event) => {
  const command = parseMessage(event as MessageEvent);
  if (command) {
    void handleCommand(command);
  }
}) as EventListener);

(window as any).PaintPipelineBridge = {
  initializeOpenCv(candidate?: any) {
    void initializeOpenCv(candidate).catch((error) => postError(undefined, error));
  },
};

postStatus("Pipeline bridge loaded");
