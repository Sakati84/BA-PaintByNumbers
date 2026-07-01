import {
  buildGeminiImageGenerateContentBody,
  extractGeminiImage,
  type GeminiImageGenerationConfig,
  type InlineImagePart,
} from '../src/features/imagePosterization/geminiImageRequest';
import {
  buildPhotoToPosterizedPrompt,
  type PromptBuildOptions,
  type PromptDifficulty,
} from '../../react-app/src/prompts/paintByNumbersPosterizePrompt';

export type PromptLabBuildPromptInput = {
  difficulty?: PromptDifficulty;
  colorCount?: number;
  maxEdge?: number;
  targetAudience?: string;
};

export type PromptLabGeminiRequestInput = {
  prompt: string;
  image: InlineImagePart;
  generationConfig: GeminiImageGenerationConfig;
};

export function buildPromptLabPosterizePrompt(input: PromptLabBuildPromptInput): string {
  const difficulty = input.difficulty ?? 'expert';
  const options: PromptBuildOptions = {};
  if (typeof input.colorCount === 'number') {
    options.numberOfColors = input.colorCount;
  }
  if (typeof input.targetAudience === 'string' && input.targetAudience.trim().length > 0) {
    options.targetAudience = input.targetAudience.trim();
  }

  const builtPrompt = buildPhotoToPosterizedPrompt(difficulty, options);
  const maxEdge = input.maxEdge ?? 1024;

  return [
    builtPrompt.positivePrompt,
    '',
    'Negative prompt:',
    builtPrompt.negativePrompt,
    'numbers, labels, text, logos, watermarks',
    '',
    'Output constraints:',
    '- Output a normal clean image only, not a numbered template.',
    `- Keep the useful image size within about ${maxEdge}px on the longest edge.`,
  ].join('\n');
}

export function buildPromptLabGeminiBody(input: PromptLabGeminiRequestInput): Record<string, unknown> {
  return buildGeminiImageGenerateContentBody(input);
}

export function extractPromptLabGeminiImage(payload: unknown): InlineImagePart | null {
  return extractGeminiImage(payload);
}
