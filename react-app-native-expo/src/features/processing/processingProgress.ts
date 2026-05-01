import type { PipelineStepDefinition, StepId } from './processingTypes';

export const STEP_ORDER: StepId[] = [
  'normalize',
  'smooth',
  'quantize',
  'strip-cleanup',
  'protrusions',
  'region-merge',
  'render',
];

export const PIPELINE_STEPS: readonly PipelineStepDefinition[] = [
  {
    id: 'normalize',
    label: 'Normalize & Resize',
    description: 'Load the image into the mobile pipeline and fit it to the configured max edge.',
  },
  {
    id: 'smooth',
    label: 'Bilateral Smoothing',
    description: 'Native OpenCV adapter target for edge-preserving smoothing.',
  },
  {
    id: 'quantize',
    label: 'K-Means Quantize',
    description: 'Run MiniBatch K-Means and keep the raw indexed-color raster before cleanup.',
  },
  {
    id: 'strip-cleanup',
    label: 'Strip Cleanup',
    description: 'Match the react-app narrow-strip cleanup and palette compaction stage.',
  },
  {
    id: 'protrusions',
    label: 'Protrusion Pruning',
    description: 'Prune thin protrusions after strip cleanup using the typed-array region pass.',
  },
  {
    id: 'region-merge',
    label: 'Region Merging',
    description: 'Port facet-based region reduction with the current high-contrast protection semantics.',
  },
  {
    id: 'render',
    label: 'Final Render',
    description: 'Produce the bright-color-circles template with Python-style label anchors.',
  },
];
