import { buildPaintByNumbersPosterizePrompt } from '../prompts/paintByNumbersPosterizePrompt';
import { POSTERIZE_MAX_EDGE, clampColorCount, complexityForColorCount } from './settings';

export type PosterizePromptInput = {
  colorCount: number;
  maxEdge?: number;
};

export function buildPosterizePrompt(input: PosterizePromptInput): string {
  const colorCount = clampColorCount(input.colorCount);
  const complexity = complexityForColorCount(colorCount);
  return buildPaintByNumbersPosterizePrompt({
    colorCount,
    complexityPreset: complexity,
    maxEdge: input.maxEdge ?? POSTERIZE_MAX_EDGE,
  });
}
