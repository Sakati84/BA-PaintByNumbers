import { processImageNative } from './processImageNative';
import { STEP_ORDER } from './processingProgress';
import type {
  NativePipelineSettings,
  PipelineControllerState,
  PipelineImageAsset,
  ProcessingProgress,
  RunStepResult,
  StepId,
} from './processingTypes';

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function createInitialControllerState(sourceImage: PipelineImageAsset | null = null): PipelineControllerState {
  return {
    sourceImage,
    results: {},
    timings: {},
    artifacts: {},
  };
}

export function invalidateFrom(
  state: PipelineControllerState,
  stepId: StepId,
): PipelineControllerState {
  const startIndex = STEP_ORDER.indexOf(stepId);
  const nextResults = { ...state.results };
  const nextTimings = { ...state.timings };
  const nextArtifacts: PipelineControllerState['artifacts'] = { ...state.artifacts };

  for (let index = startIndex; index < STEP_ORDER.length; index += 1) {
    const current = STEP_ORDER[index];
    delete nextResults[current];
    delete nextTimings[current];
    if (current === 'quantize' || current === 'strip-cleanup' || current === 'protrusions' || current === 'region-merge' || current === 'render') {
      delete nextArtifacts[current];
    }
  }

  return {
    ...state,
    results: nextResults,
    timings: nextTimings,
    artifacts: nextArtifacts,
  };
}

export async function runPipelineStep(args: {
  state: PipelineControllerState;
  stepId: StepId;
  settings: NativePipelineSettings;
  onProgress?: (progress: ProcessingProgress) => void;
}): Promise<{ state: PipelineControllerState; result: RunStepResult }> {
  const { state, stepId, settings, onProgress } = args;

  if (!state.sourceImage) {
    throw new Error('Pick an image before running pipeline steps.');
  }

  const previousState = invalidateFrom(state, stepId);
  const stepIndex = STEP_ORDER.indexOf(stepId);
  const previousStepId = stepIndex > 0 ? STEP_ORDER[stepIndex - 1] : undefined;
  const previousPreview = previousStepId ? previousState.results[previousStepId] : undefined;
  const previousArtifact =
    previousStepId === 'quantize' || previousStepId === 'strip-cleanup' || previousStepId === 'protrusions' || previousStepId === 'region-merge' || previousStepId === 'render'
      ? previousState.artifacts[previousStepId]
      : undefined;

  onProgress?.({
    step: stepId,
    progress: Math.round((stepIndex / STEP_ORDER.length) * 100),
    message: `Running ${stepId}...`,
  });

  const startedAt = nowMs();
  const processed = await processImageNative({
    stepId,
    sourceImage: state.sourceImage,
    settings,
    previousPreview,
    previousArtifact,
  });
  const { preview, artifact } = processed;
  const elapsed = nowMs() - startedAt;

  const nextArtifacts: PipelineControllerState['artifacts'] = { ...previousState.artifacts };
  if (artifact) {
    if (artifact.stepId === 'quantize') {
      nextArtifacts.quantize = artifact;
    } else if (artifact.stepId === 'strip-cleanup') {
      nextArtifacts['strip-cleanup'] = artifact;
    } else if (artifact.stepId === 'protrusions') {
      nextArtifacts.protrusions = artifact;
    } else if (artifact.stepId === 'region-merge') {
      nextArtifacts['region-merge'] = artifact;
    } else if (artifact.stepId === 'render') {
      nextArtifacts.render = artifact;
    }
  }

  const nextState: PipelineControllerState = {
    ...previousState,
    results: {
      ...previousState.results,
      [stepId]: preview,
    },
    timings: {
      ...previousState.timings,
      [stepId]: elapsed,
    },
    artifacts: nextArtifacts,
  };

  onProgress?.({
    step: stepId,
    progress: Math.round(((stepIndex + 1) / STEP_ORDER.length) * 100),
    message: `${stepId} complete.`,
  });

  return {
    state: nextState,
    result: {
      preview,
      artifact,
      timing: {
        step: stepId,
        ms: elapsed,
      },
    },
  };
}

export async function runAllPipelineSteps(args: {
  state: PipelineControllerState;
  settings: NativePipelineSettings;
  onProgress?: (progress: ProcessingProgress) => void;
}): Promise<PipelineControllerState> {
  let currentState = args.state;
  for (const stepId of STEP_ORDER) {
    const { state } = await runPipelineStep({
      state: currentState,
      stepId,
      settings: args.settings,
      onProgress: args.onProgress,
    });
    currentState = state;
  }
  return currentState;
}
