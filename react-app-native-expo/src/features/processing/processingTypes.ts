import type { FacetResult, LabelPlacement, RegionInfo } from '../../lib/pipeline';
import type { PipelineConfig, StepTiming } from '../../lib/pipeline/pipelineTypes';

export type StepId = 'normalize' | 'smooth' | 'quantize' | 'strip-cleanup' | 'protrusions' | 'region-merge' | 'render';

export type PipelineImageAsset = {
  uri: string;
  width: number;
  height: number;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
};

export type NativePipelineSettings = {
  resizeMax: number;
  targetColorCount: number;
  minRegionSize: number;
  protectHighContrast: boolean;
  highContrastMinPx: number;
  pruneRadius: number;
  randomSeed: number;
};

export type ProcessingProgress = {
  step: StepId | 'idle';
  progress: number;
  message: string;
};

export type PipelineStepDefinition = {
  id: StepId;
  label: string;
  description: string;
};

export type RenderTemplateId = 'brightColorCircles' | 'colorCircles' | 'numbers' | 'classic' | 'debugUnlabeled';

export type RenderTemplatePreview = {
  id: RenderTemplateId;
  label: string;
  imageUri: string;
};

export type PipelineStagePreview = {
  stepId: StepId;
  imageUri: string;
  width: number;
  height: number;
  note: string;
  status: 'implemented' | 'placeholder';
  colorCount?: number;
  paletteRgb?: number[];
  regionCount?: number;
  placementCount?: number;
  templates?: RenderTemplatePreview[];
};

export type IndexedStageArtifact = {
  width: number;
  height: number;
  colorCount: number;
  labelMap: Int32Array;
  paletteRgb: Uint8Array;
  centerLabU8?: Uint8Array;
};

export type QuantizeStageArtifact = IndexedStageArtifact & {
  stepId: 'quantize';
};

export type StripCleanupStageArtifact = IndexedStageArtifact & {
  stepId: 'strip-cleanup';
};

export type ProtrusionsStageArtifact = IndexedStageArtifact & {
  stepId: 'protrusions';
};

export type RegionBackedStageArtifact = IndexedStageArtifact & {
  facets: FacetResult;
  regions: RegionInfo[];
};

export type RegionMergeStageArtifact = RegionBackedStageArtifact & {
  stepId: 'region-merge';
};

export type RenderStageArtifact = RegionBackedStageArtifact & {
  stepId: 'render';
  boundaryMask: Uint8Array;
  placements: LabelPlacement[];
  templateUris?: Partial<Record<RenderTemplateId, string>>;
};

export type PipelineStageArtifact =
  | QuantizeStageArtifact
  | StripCleanupStageArtifact
  | ProtrusionsStageArtifact
  | RegionMergeStageArtifact
  | RenderStageArtifact;

export type PipelineStageArtifacts = {
  quantize?: QuantizeStageArtifact;
  'strip-cleanup'?: StripCleanupStageArtifact;
  protrusions?: ProtrusionsStageArtifact;
  'region-merge'?: RegionMergeStageArtifact;
  render?: RenderStageArtifact;
};

export type RunStepResult = {
  preview: PipelineStagePreview;
  artifact?: PipelineStageArtifact;
  timing: StepTiming;
};

export type PipelineControllerState = {
  sourceImage: PipelineImageAsset | null;
  results: Partial<Record<StepId, PipelineStagePreview>>;
  timings: Partial<Record<StepId, number>>;
  artifacts: PipelineStageArtifacts;
};

export const DEFAULT_PIPELINE_SETTINGS: NativePipelineSettings = {
  resizeMax: 1200,
  targetColorCount: 24,
  minRegionSize: 200,
  protectHighContrast: false,
  highContrastMinPx: 20,
  pruneRadius: 1,
  randomSeed: 0,
};

export function toPipelineConfig(settings: NativePipelineSettings): PipelineConfig {
  return {
    resizeMax: settings.resizeMax,
    smoothing: {
      enabled: true,
      d: 9,
      sigmaColor: 50,
      sigmaSpace: 50,
    },
    quantization: {
      k: settings.targetColorCount,
      seed: settings.randomSeed,
      maxIterations: 100,
      batchSize: 4096,
      sampleRatio: 1,
      mergeThreshold: 8,
    },
    facets: {
      minRegionSize: settings.minRegionSize,
      enableProtrusionPruning: settings.pruneRadius > 0,
      protrusionPruneRadius: settings.pruneRadius,
      protectHighContrast: settings.protectHighContrast,
      highContrastMinPx: settings.highContrastMinPx,
    },
    labels: {
      enabled: true,
      placementMode: 'fast',
    },
  };
}
