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
      image:
        | { kind: "url"; url: string }
        | { kind: "base64"; base64: string; mimeType: string };
    }
  | { type: "RUN_ALL"; requestId: string; options: PipelineOptions }
  | { type: "RESET"; requestId?: string };

type WorkerResponse = {
  type: "READY" | "STEP_SUCCESS" | "ERROR";
  id?: string;
  payload?: any;
  error?: string;
};

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

let worker: Worker | null = null;
let workerReady = false;
let sourceLoaded = false;
const pendingWorkerMessages = new Map<string, {
  resolve: (payload: any) => void;
  reject: (error: Error) => void;
}>();

function postToNative(message: unknown): void {
  const serialized = JSON.stringify(message);
  if ((window as any).ReactNativeWebView?.postMessage) {
    (window as any).ReactNativeWebView.postMessage(serialized);
    return;
  }
  console.log("[pipeline-bridge]", serialized);
}

function postError(requestId: string | undefined, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  postToNative({ type: "ERROR", requestId, message, stack });
}

function ensureWorker(): Worker {
  if (worker) {
    return worker;
  }

  worker = new Worker(new URL("./lib/worker.ts", import.meta.url));
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const { type, id, payload, error } = event.data;
    if (type === "READY") {
      workerReady = true;
      postToNative({ type: "READY" });
      return;
    }

    if (id && pendingWorkerMessages.has(id)) {
      const pending = pendingWorkerMessages.get(id)!;
      pendingWorkerMessages.delete(id);
      if (type === "STEP_SUCCESS") {
        pending.resolve(payload);
      } else {
        pending.reject(new Error(error ?? "Pipeline worker error"));
      }
      return;
    }

    if (type === "ERROR") {
      postError(id, error ?? "Pipeline worker error");
    }
  };

  worker.onerror = (event) => {
    postError(undefined, event.message);
  };

  worker.postMessage({ type: "INIT", id: "bridge-init" });
  return worker;
}

function sendWorkerMessage(type: string, payload: unknown, requestId: string): Promise<any> {
  const activeWorker = ensureWorker();
  const id = `${requestId}:${type}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    pendingWorkerMessages.set(id, { resolve, reject });
    activeWorker.postMessage({ type, payload, id });
  });
}

async function waitForWorkerReady(): Promise<void> {
  ensureWorker();
  if (workerReady) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      if (workerReady) {
        window.clearInterval(interval);
        resolve();
      } else if (Date.now() - startedAt > 35000) {
        window.clearInterval(interval);
        reject(new Error("Pipeline worker did not become ready."));
      }
    }, 50);
  });
}

async function imageCommandToImageData(image: Extract<BridgeCommand, { type: "LOAD_IMAGE" }>["image"]): Promise<ImageData> {
  const imageUrl =
    image.kind === "url"
      ? image.url
      : `data:${image.mimeType || "image/png"};base64,${image.base64}`;

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("Could not create canvas context.");
  }

  context.drawImage(bitmap, 0, 0);
  const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return imageData;
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
  await waitForWorkerReady();
  postToNative({
    type: "PROGRESS",
    requestId: command.requestId,
    stepId: "load",
    stepIndex: 0,
    stepCount: PIPELINE_STEPS.length + 1,
    message: "Loading source image",
    progress: 0,
  });
  const imageData = await imageCommandToImageData(command.image);
  await sendWorkerMessage("LOAD_IMAGE", { imageData }, command.requestId);
  sourceLoaded = true;
  postToNative({
    type: "IMAGE_LOADED",
    requestId: command.requestId,
    width: imageData.width,
    height: imageData.height,
  });
}

async function handleRunAll(command: Extract<BridgeCommand, { type: "RUN_ALL" }>): Promise<void> {
  await waitForWorkerReady();
  if (!sourceLoaded) {
    throw new Error("No image loaded.");
  }

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
    const payload = await sendWorkerMessage("RUN_STEP", {
      stepId,
      options: stepOptions(stepId, command.options),
    }, command.requestId);
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
          imageUrl: imageDataToPngDataUrl(imageData as ImageData),
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
      await waitForWorkerReady();
      postToNative({ type: "READY", requestId: command.requestId });
    } else if (command.type === "LOAD_IMAGE") {
      await handleLoadImage(command);
    } else if (command.type === "RUN_ALL") {
      await handleRunAll(command);
    } else if (command.type === "RESET") {
      sourceLoaded = false;
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

ensureWorker();
