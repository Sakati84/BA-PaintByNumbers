import type {
  GeneratorDebugParameter,
  GeneratorDebugStageSnapshot,
  GeneratorOutputVariant,
  GeneratorProgress,
  GeneratorResult,
  GeneratorSettings,
  GeneratorStage,
  GeneratorTimings,
  PaletteStat,
} from '../generator/generatorTypes';

export type {
  GeneratorDebugParameter,
  GeneratorDebugStageSnapshot,
  GeneratorOutputVariant,
  GeneratorProgress,
  GeneratorResult,
  GeneratorSettings,
  GeneratorStage,
  GeneratorTimings,
  PaletteStat,
};

export type WebImageSource = {
  sourceToken: string;
  parentSourceToken?: string;
  kind: 'uploaded' | 'posterized';
  label: string;
  width: number;
  height: number;
  previewDataUrl: string;
  promptText?: string;
};

export type WebViewAppRequest =
  | {
      type: 'webAppReady';
      requestId: string;
      payload?: null;
    }
  | {
      type: 'webRuntimeError';
      requestId: string;
      payload: {
        message: string;
      };
    }
  | {
      type: 'pickImage';
      requestId: string;
      payload?: null;
    }
  | {
      type: 'captureImage';
      requestId: string;
      payload?: null;
    }
  | {
      type: 'posterizeUploadedImage';
      requestId: string;
      payload: {
        sourceToken: string;
        complexity: 'simple' | 'medium' | 'detailed';
        colorCount: number;
        prompt: string;
      };
    }
  | {
      type: 'runPaintByNumbers';
      requestId: string;
      payload: {
        sourceToken: string;
        settings: GeneratorSettings;
        debugMode?: boolean;
        debugStartStage?: GeneratorStage;
      };
    }
  | {
      type: 'shareResultSvg';
      requestId: string;
      payload: {
        svgUri: string;
        fileName?: string;
      };
    }
  | {
      type: 'shareResultFile';
      requestId: string;
      payload: {
        uri: string;
        fileName?: string;
        mimeType?: string;
        uti?: string;
      };
    }
  | {
      type: 'shareResultSvgFromPng';
      requestId: string;
      payload: {
        pngUri: string;
        fileName?: string;
        width: number;
        height: number;
      };
    };

export type WebViewHostEvent =
  | {
      type: 'hostReady';
      requestId: string;
      payload: {
        runnerVersion: string;
      };
    }
  | {
      type: 'sourceReady';
      requestId: string;
      payload: WebImageSource;
    }
  | {
      type: 'processingProgress';
      requestId: string;
      payload: {
        phase: 'posterizeImage' | 'paintByNumbers';
        progress: number | null;
        message: string;
      };
    }
  | {
      type: 'runCompleted';
      requestId: string;
      payload: {
        source: WebImageSource;
        result: GeneratorResult;
      };
    }
  | {
      type: 'shareCompleted';
      requestId: string;
      payload: {
        message: string;
      };
    }
  | {
      type: 'error';
      requestId: string;
      error: {
        stage: 'bridge' | 'pickImage' | 'captureImage' | 'posterizeImage' | 'paintByNumbers' | 'shareResult';
        message: string;
      };
    };
