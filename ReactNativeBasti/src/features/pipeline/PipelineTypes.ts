export type PipelineStepId =
  | "load"
  | "normalize"
  | "smooth"
  | "quantize"
  | "protrusions"
  | "region-merge"
  | "render"
  | "done";

export type PipelineOptions = {
  resizeMax: number;
  colorCount: number;
  minRegionSize: number;
  protectHighContrast: boolean;
  highContrastMinPx: number;
  pruneRadius: number;
};

export type PipelineImageSource =
  | {
      kind: "url";
      url: string;
    }
  | {
      kind: "base64";
      base64: string;
      mimeType: string;
    };

export type PipelineTemplateResult = {
  id: string;
  label: string;
  imageUrl: string;
};

export type PipelineStepResult = {
  stepId: PipelineStepId;
  label: string;
  imageUrl: string;
  width: number;
  height: number;
  timingMs: number;
};

export type PipelineFinalResult = {
  templates: PipelineTemplateResult[];
  intermediateResults: PipelineStepResult[];
  stats: {
    regionCount: number;
    placementCount: number;
  };
  timings: Record<string, number>;
};

export type PipelineProgress = {
  stepId: PipelineStepId;
  stepIndex: number;
  stepCount: number;
  message: string;
  progress: number;
};

export type PipelineBridgeEvent =
  | {
      type: "READY";
      requestId?: string;
    }
  | {
      type: "STATUS";
      message: string;
    }
  | {
      type: "IMAGE_LOADED";
      requestId: string;
      width: number;
      height: number;
    }
  | ({
      type: "PROGRESS";
      requestId: string;
    } & PipelineProgress)
  | ({
      type: "STEP_RESULT";
      requestId: string;
    } & PipelineStepResult)
  | ({
      type: "FINAL_RESULT";
      requestId: string;
    } & PipelineFinalResult)
  | {
      type: "ERROR";
      requestId?: string;
      message: string;
      stack?: string;
    };
