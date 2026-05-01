export type StepTiming = {
  step: string;
  ms: number;
};

export type PaletteColorLab = {
  id: number;
  l: number;
  a: number;
  b: number;
  count: number;
};

export type PaletteColorRGB = {
  id: number;
  r: number;
  g: number;
  b: number;
  count: number;
};

export type RegionModel = {
  id: number;
  colorId: number;
  area: number;
  bbox: [number, number, number, number];
};

export type LabelModel = {
  regionId: number;
  x: number;
  y: number;
  radius: number;
};

export type PaintByNumbersResult = {
  width: number;
  height: number;
  palette: PaletteColorRGB[];
  regions: RegionModel[];
  labels: LabelModel[];
  timings: StepTiming[];
};

export type PipelineConfig = {
  resizeMax: number;
  smoothing: {
    enabled: boolean;
    d: number;
    sigmaColor: number;
    sigmaSpace: number;
  };
  quantization: {
    k: number;
    seed: number;
    maxIterations: number;
    batchSize: number;
    sampleRatio?: number;
    mergeThreshold?: number;
  };
  facets: {
    minRegionSize: number;
    enableProtrusionPruning: boolean;
    protrusionPruneRadius: number;
    protectHighContrast: boolean;
    highContrastMinPx: number;
  };
  labels: {
    enabled: boolean;
    placementMode: 'fast' | 'distanceTransform';
  };
};
