import opencvScriptUrl from "@techstark/opencv-js/dist/opencv.js?url";

type OpenCvMat = {
  rows: number;
  cols: number;
  data: Uint8Array;
  data32F: Float32Array;
  data32S: Int32Array;
  delete(): void;
};

type OpenCvPoint = {
  x: number;
  y: number;
};

type OpenCvMinMaxLocResult = {
  minVal: number;
  maxVal: number;
  minLoc: OpenCvPoint;
  maxLoc: OpenCvPoint;
};

export type OpenCvRuntime = {
  Mat: new () => OpenCvMat;
  Size: new (width: number, height: number) => {
    width: number;
    height: number;
  };
  TermCriteria: new (type: number, maxCount: number, epsilon: number) => {
    type: number;
    maxCount: number;
    epsilon: number;
  };
  matFromImageData(imageData: ImageData): OpenCvMat;
  matFromArray(rows: number, cols: number, type: number, array: ArrayBufferView | number[]): OpenCvMat;
  getStructuringElement(shape: number, ksize: { width: number; height: number }, anchor?: { x: number; y: number }): OpenCvMat;
  copyMakeBorder(
    src: OpenCvMat,
    dst: OpenCvMat,
    top: number,
    bottom: number,
    left: number,
    right: number,
    borderType: number,
    value?: number[] | number,
  ): void;
  connectedComponentsWithStats(
    image: OpenCvMat,
    labels: OpenCvMat,
    stats: OpenCvMat,
    centroids: OpenCvMat,
    connectivity?: number,
    ltype?: number,
  ): number;
  cvtColor(src: OpenCvMat, dst: OpenCvMat, code: number, dstCn?: number): void;
  bilateralFilter(
    src: OpenCvMat,
    dst: OpenCvMat,
    d: number,
    sigmaColor: number,
    sigmaSpace: number,
    borderType?: number,
  ): void;
  morphologyEx(
    src: OpenCvMat,
    dst: OpenCvMat,
    op: number,
    kernel: OpenCvMat,
    anchor?: { x: number; y: number },
    iterations?: number,
    borderType?: number,
    borderValue?: number[] | number,
  ): void;
  kmeans(
    data: OpenCvMat,
    clusterCount: number,
    bestLabels: OpenCvMat,
    criteria: { type: number; maxCount: number; epsilon: number },
    attempts: number,
    flags: number,
    centers?: OpenCvMat,
  ): number;
  distanceTransform(src: OpenCvMat, dst: OpenCvMat, distanceType: number, maskSize: number, dstType?: number): void;
  minMaxLoc(src: OpenCvMat, mask?: OpenCvMat): OpenCvMinMaxLocResult;
  setRNGSeed(seed: number): void;
  TermCriteria_EPS: number;
  TermCriteria_MAX_ITER: number;
  KMEANS_PP_CENTERS?: number;
  BORDER_CONSTANT: number;
  CV_8U: number;
  CV_8UC1: number;
  CV_32S: number;
  CV_32F: number;
  CV_8UC3: number;
  MORPH_ELLIPSE: number;
  MORPH_OPEN: number;
  CC_STAT_LEFT: number;
  CC_STAT_TOP: number;
  CC_STAT_WIDTH: number;
  CC_STAT_HEIGHT: number;
  CC_STAT_AREA: number;
  COLOR_RGBA2RGB: number;
  COLOR_RGB2RGBA: number;
  COLOR_RGB2HSV: number;
  COLOR_RGB2Lab: number;
  COLOR_Lab2RGB: number;
  DIST_L2: number;
};

type OpenCvBootstrap = OpenCvRuntime & {
  onRuntimeInitialized?: (() => void) | null;
};

type OpenCvGlobal = typeof globalThis & {
  cv?: Promise<OpenCvRuntime> | OpenCvBootstrap | OpenCvRuntime;
};

type OpenCvThenable = {
  then: (callback: (runtime: OpenCvRuntime) => void) => void;
};

let openCvPromise: Promise<OpenCvRuntime> | null = null;
let openCvScriptPromise: Promise<void> | null = null;

export function loadOpenCv(): Promise<OpenCvRuntime> {
  if (!openCvPromise) {
    openCvPromise = initializeOpenCv().catch((error) => {
      openCvPromise = null;
      throw error;
    });
  }
  return openCvPromise;
}

export function preloadOpenCv(): Promise<OpenCvRuntime> {
  ensureOpenCvScriptPreload();
  return loadOpenCv();
}

export function prefetchOpenCvScript(): void {
  ensureOpenCvScriptPreload();
}

async function initializeOpenCv(): Promise<OpenCvRuntime> {
  const globalScope = globalThis as OpenCvGlobal;
  if (!globalScope.cv) {
    await injectOpenCvScript();
  }

  const candidate = globalScope.cv as Promise<OpenCvRuntime> | OpenCvBootstrap | OpenCvRuntime | undefined;
  if (!candidate) {
    throw new Error("OpenCV.js did not attach itself to the browser global scope.");
  }

  if (candidate instanceof Promise) {
    return candidate;
  }

  if (typeof (candidate as { then?: unknown }).then === "function") {
    return new Promise<OpenCvRuntime>((resolve) => {
      (candidate as unknown as OpenCvThenable).then((runtime) => resolve(runtime));
    });
  }

  if (typeof candidate.Mat === "function" && typeof candidate.cvtColor === "function") {
    return candidate;
  }

  await new Promise<void>((resolve) => {
    const bootstrap = candidate as OpenCvBootstrap;
    bootstrap.onRuntimeInitialized = () => resolve();
  });

  return candidate as OpenCvRuntime;
}

function injectOpenCvScript(): Promise<void> {
  if (!openCvScriptPromise) {
    openCvScriptPromise = new Promise<void>((resolve, reject) => {
      ensureOpenCvScriptPreload();
      const existingScript = document.querySelector<HTMLScriptElement>(`script[data-opencv-script="${opencvScriptUrl}"]`);
      if (existingScript) {
        if ((globalThis as OpenCvGlobal).cv) {
          resolve();
          return;
        }

        existingScript.addEventListener("load", () => resolve(), { once: true });
        existingScript.addEventListener("error", () => reject(new Error("Failed to load OpenCV.js.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = opencvScriptUrl;
      script.async = true;
      script.dataset.opencvScript = opencvScriptUrl;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load OpenCV.js from ${opencvScriptUrl}.`));
      document.head.appendChild(script);
    }).catch((error) => {
      openCvScriptPromise = null;
      throw error;
    });
  }

  return openCvScriptPromise;
}

function ensureOpenCvScriptPreload(): void {
  const existingPreload = document.querySelector<HTMLLinkElement>(`link[data-opencv-preload="${opencvScriptUrl}"]`);
  if (existingPreload) {
    return;
  }

  const preloadLink = document.createElement("link");
  preloadLink.rel = "preload";
  preloadLink.as = "script";
  preloadLink.href = opencvScriptUrl;
  preloadLink.dataset.opencvPreload = opencvScriptUrl;
  document.head.appendChild(preloadLink);
}