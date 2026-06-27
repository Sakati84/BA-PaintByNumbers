import { buildPaintByNumbersPosterizePrompt } from '../prompts/paintByNumbersPosterizePrompt';
import type { ComplexityPreset } from './settings';
import { POSTERIZE_MAX_EDGE, clampColorCount, complexityForColorCount, complexityOptionForPreset } from './settings';

export type PosterizePromptInput = {
  colorCount: number;
  maxEdge?: number;
};

export function buildPosterizePrompt(input: PosterizePromptInput): string {
  const colorCount = clampColorCount(input.colorCount);
  const complexity = complexityForColorCount(colorCount);
  const option = complexityOptionForPreset(complexity);
  return buildPaintByNumbersPosterizePrompt({
    colorCount,
    complexityLabel: option.label,
    complexityGuidance: complexityPromptGuidance(complexity, colorCount),
    maxEdge: input.maxEdge ?? POSTERIZE_MAX_EDGE,
  });
}

function complexityPromptGuidance(complexity: ComplexityPreset, colorCount: number): string {
  if (complexity === 'simple') {
    return `Use the ${colorCount}-color limit to make a genuinely easy image: broad iconic shapes, simple subject interiors, calm backgrounds, and very few small accents. Preserve the original composition and the silhouette of every important subject, but redraw dense details as larger semantic color zones. Remove repeated texture, tiny shadows, small surface markings, clutter, and decorative micro-shapes before they reach the final image.`;
  }

  if (complexity === 'detailed') {
    return `Use the ${colorCount}-color budget for a harder, richer paint-by-numbers source: preserve important silhouettes, structural parts, characteristic features, layered tonal zones, visible foreground/background separation, and meaningful secondary details. Keep small details when they are clean, intentional, and paintable; consolidate only noisy texture, random speckles, and unimportant micro-variation.`;
  }

  return `Use the ${colorCount}-color palette for a balanced result: clear medium-sized semantic regions, recognizable identity cues, preserved major secondary forms, and controlled accents. Simplify repeated texture and small shadows into clean zones, but keep enough internal structure that the subject does not become plain or generic.`;
}
