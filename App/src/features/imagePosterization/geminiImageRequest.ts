export type InlineImagePart = {
  mimeType: string;
  data: string;
};

export type GeminiImageGenerationConfig = {
  responseModalities?: string[];
  temperature?: number;
  seed?: number;
  responseFormat?: {
    image?: {
      aspectRatio?: string;
    };
  };
};

export type GeminiImageRequestInput = {
  prompt: string;
  image?: InlineImagePart;
  generationConfig?: GeminiImageGenerationConfig;
};

export function stripDataUrlPrefix(value: string): string {
  const marker = ';base64,';
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) {
    return value;
  }
  return value.slice(markerIndex + marker.length);
}

function sanitizeGenerationConfig(config: GeminiImageGenerationConfig | undefined): GeminiImageGenerationConfig {
  const output: GeminiImageGenerationConfig = {
    responseModalities: config?.responseModalities ?? ['IMAGE'],
  };

  if (typeof config?.temperature === 'number') {
    output.temperature = config.temperature;
  }

  if (typeof config?.seed === 'number' && Number.isFinite(config.seed)) {
    output.seed = Math.trunc(config.seed);
  }

  if (config?.responseFormat != null) {
    output.responseFormat = config.responseFormat;
  }

  return output;
}

export function buildGeminiImageGenerateContentBody(input: GeminiImageRequestInput): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [{ text: input.prompt }];

  if (input.image != null) {
    parts.push({
      inline_data: {
        mime_type: input.image.mimeType,
        data: stripDataUrlPrefix(input.image.data),
      },
    });
  }

  return {
    contents: [
      {
        parts,
      },
    ],
    generationConfig: sanitizeGenerationConfig(input.generationConfig),
  };
}

export function extractGeminiImage(payload: unknown): InlineImagePart | null {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }

  const candidates = (payload as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates)) {
    return null;
  }

  for (const candidate of candidates) {
    if (candidate == null || typeof candidate !== 'object') {
      continue;
    }
    const content = (candidate as Record<string, unknown>).content;
    if (content == null || typeof content !== 'object') {
      continue;
    }
    const parts = (content as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    for (const part of parts) {
      if (part == null || typeof part !== 'object') {
        continue;
      }

      const inlineData = (part as Record<string, unknown>).inlineData ?? (part as Record<string, unknown>).inline_data;
      if (inlineData == null || typeof inlineData !== 'object') {
        continue;
      }

      const imageRecord = inlineData as Record<string, unknown>;
      if (typeof imageRecord.data === 'string') {
        return {
          mimeType:
            typeof imageRecord.mimeType === 'string'
              ? imageRecord.mimeType
              : typeof imageRecord.mime_type === 'string'
                ? imageRecord.mime_type
                : 'image/png',
          data: stripDataUrlPrefix(imageRecord.data),
        };
      }
    }
  }

  return null;
}
