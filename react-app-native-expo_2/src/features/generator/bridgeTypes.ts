import type { GeneratorProgress, GeneratorResult, GeneratorSettings, PreparedImage } from './generatorTypes';

export type PreparedGeneratorInput = {
  preparedImage: PreparedImage;
  imageData: {
    width: number;
    height: number;
    dataBase64?: string;
    dataByteLength: number;
  };
};

export type GeneratorRunChunkPhase = 'start' | 'chunk' | 'finish';

export type GeneratorBridgeRunChunk = {
  phase: GeneratorRunChunkPhase;
  chunkIndex: number;
  totalChunks: number;
  chunk: string;
  preparedInput?: PreparedGeneratorInput;
  settings?: GeneratorSettings;
  decodeDurationMs?: number;
};

export type GeneratorBridgeRequest =
  | {
      type: 'bridgeReadyAck';
      requestId: string;
      payload?: null;
    }
  | {
      type: 'runGenerator';
      requestId: string;
      payload: GeneratorBridgeRunChunk;
    }
  | {
      type: 'resetWorker';
      requestId: string;
      payload?: null;
    };

export type GeneratorBridgeEvent =
  | {
      type: 'bridgeReady';
      requestId: string;
      payload: {
        runnerVersion: string;
      };
    }
  | {
      type: 'progress';
      requestId: string;
      payload: GeneratorProgress;
    }
  | {
      type: 'success';
      requestId: string;
      payload: GeneratorResult;
    }
  | {
      type: 'error';
      requestId: string;
      error: {
        message: string;
      };
    };
