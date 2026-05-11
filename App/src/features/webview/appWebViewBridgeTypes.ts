import type {
  GeneratorProgress,
  GeneratorResult,
  GeneratorSettings,
  GeneratorStage,
  GeneratorTimings,
  PaletteStat,
} from '../generator/generatorTypes';

export type {
  GeneratorProgress,
  GeneratorResult,
  GeneratorSettings,
  GeneratorStage,
  GeneratorTimings,
  PaletteStat,
};

export type WebImageSource = {
  sourceToken: string;
  kind: 'uploaded' | 'generated';
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
      type: 'pickImage';
      requestId: string;
      payload?: null;
    }
  | {
      type: 'generateIdeaImage';
      requestId: string;
      payload: {
        prompt: string;
        label: string;
      };
    }
  | {
      type: 'runPaintByNumbers';
      requestId: string;
      payload: {
        sourceToken: string;
        settings: GeneratorSettings;
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
        phase: 'ideaImage' | 'paintByNumbers';
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
      type: 'error';
      requestId: string;
      error: {
        stage: 'bridge' | 'pickImage' | 'ideaImage' | 'paintByNumbers';
        message: string;
      };
    };
