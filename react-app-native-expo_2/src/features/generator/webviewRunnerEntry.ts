import { base64ToUint8 } from './base64';
import type { GeneratorBridgeEvent, GeneratorBridgeRequest, PreparedGeneratorInput } from './bridgeTypes';
import type { GeneratorSettings } from './generatorTypes';
import { generatePaintByNumbersFromPreparedInput } from './generatePaintByNumbersCore';

type PendingRun = {
  chunks: string[];
  totalChunks: number;
  preparedInput: PreparedGeneratorInput;
  decodeDurationMs: number;
  settings: GeneratorSettings;
};

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
  }
}

function postEvent(event: GeneratorBridgeEvent): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify(event));
}

function postError(requestId: string, error: unknown): void {
  postEvent({
    type: 'error',
    requestId,
    error: {
      message: error instanceof Error ? error.message : 'Unknown WebView runner error.',
    },
  });
}

function deserializePreparedInput(preparedInput: PreparedGeneratorInput, chunkData: string) {
  const bytes = base64ToUint8(chunkData);
  if (bytes.byteLength !== preparedInput.imageData.dataByteLength) {
    throw new Error(
      `WebView image payload length mismatch. Expected ${preparedInput.imageData.dataByteLength}, received ${bytes.byteLength}.`,
    );
  }

  return {
    preparedImage: preparedInput.preparedImage,
    imageData: {
      width: preparedInput.imageData.width,
      height: preparedInput.imageData.height,
      data: new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    },
  };
}

const pendingRuns = new Map<string, PendingRun>();
let activeRequestId: string | null = null;

function handleRunGenerator(request: Extract<GeneratorBridgeRequest, { type: 'runGenerator' }>): void {
  const { requestId, payload } = request;
  const existing = pendingRuns.get(requestId);

  if (payload.phase === 'start') {
    if (payload.preparedInput == null || payload.settings == null) {
      throw new Error('runGenerator start payload is missing preparedInput or settings.');
    }
    pendingRuns.set(requestId, {
      chunks: Array.from({ length: payload.totalChunks }),
      totalChunks: payload.totalChunks,
      preparedInput: payload.preparedInput,
      decodeDurationMs: payload.decodeDurationMs ?? 0,
      settings: payload.settings,
    });
    pendingRuns.get(requestId)!.chunks[payload.chunkIndex] = payload.chunk;
    return;
  }

  if (existing == null) {
    throw new Error(`Received runGenerator ${payload.phase} chunk for unknown request ${requestId}.`);
  }

  existing.chunks[payload.chunkIndex] = payload.chunk;
  if (payload.phase !== 'finish') {
    return;
  }

  if (activeRequestId != null && activeRequestId !== requestId) {
    throw new Error(`Runner is already processing request ${activeRequestId}.`);
  }
  if (existing.chunks.some((chunk) => chunk == null)) {
    throw new Error(`Request ${requestId} is missing one or more image payload chunks.`);
  }

  activeRequestId = requestId;
  pendingRuns.delete(requestId);

  void (async () => {
    try {
      const preparedInput = deserializePreparedInput(existing.preparedInput, existing.chunks.join(''));
      const result = await generatePaintByNumbersFromPreparedInput(
        preparedInput,
        existing.settings,
        {
          decodeDurationMs: existing.decodeDurationMs,
          reportDecodeProgress: false,
        },
        (progress) => {
          postEvent({
            type: 'progress',
            requestId,
            payload: progress,
          });
        },
      );

      postEvent({
        type: 'success',
        requestId,
        payload: result,
      });
    } catch (error) {
      postError(requestId, error);
    } finally {
      activeRequestId = null;
    }
  })();
}

function handleRequest(rawRequest: string): void {
  const request = JSON.parse(rawRequest) as GeneratorBridgeRequest;

  if (request.type === 'bridgeReadyAck') {
    return;
  }

  if (request.type === 'resetWorker') {
    pendingRuns.clear();
    activeRequestId = null;
    return;
  }

  handleRunGenerator(request);
}

window.addEventListener('message', (event) => {
  try {
    handleRequest(String(event.data ?? ''));
  } catch (error) {
    postError('bridge', error);
  }
});

const documentMessageTarget = document as Document & {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
};

documentMessageTarget.addEventListener('message', (event: Event) => {
  const messageEvent = event as MessageEvent;
  try {
    handleRequest(String(messageEvent.data ?? ''));
  } catch (error) {
    postError('bridge', error);
  }
});

postEvent({
  type: 'bridgeReady',
  requestId: 'bridge',
  payload: {
    runnerVersion: '1',
  },
});
