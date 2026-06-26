import { buildPaintByNumbersPosterizePrompt } from '../prompts/paintByNumbersPosterizePrompt';
import type { ComplexityPreset } from './settings';
import { complexityOptionForPreset } from './settings';

export type PosterizePromptInput = {
  complexity: ComplexityPreset;
  maxEdge?: number;
};

export function buildPosterizePrompt(input: PosterizePromptInput): string {
  const option = complexityOptionForPreset(input.complexity);
  return buildPaintByNumbersPosterizePrompt({
    colorCount: option.colorCount,
    complexityLabel: option.label,
    maxEdge: input.maxEdge ?? 1200,
  });
}
