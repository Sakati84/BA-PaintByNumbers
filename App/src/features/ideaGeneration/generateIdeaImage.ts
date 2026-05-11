import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

type IdeaGenerationRequest = {
  prompt: string;
  label: string;
};

export type GeneratedIdeaImage = {
  asset: ImagePickerAsset;
  previewDataUrl: string;
  label: string;
  promptText: string;
};

type InlineImagePart = {
  mimeType: string;
  data: string;
};

function getGeminiModel(): string {
  return process.env.EXPO_PUBLIC_GEMINI_IMAGE_MODEL?.trim() || 'gemini-2.5-flash-image';
}

function resizeToFit(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (width <= maxEdge && height <= maxEdge) {
    return { width, height };
  }

  const scale = Math.min(maxEdge / width, maxEdge / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function sanitizeLabel(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'Ideenbild';
  }
  return trimmed.slice(0, 80);
}

function extractProxyImage(payload: unknown): InlineImagePart | null {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const directBase64 = typeof record.imageBase64 === 'string' ? record.imageBase64 : null;
  const directMime = typeof record.mimeType === 'string' ? record.mimeType : 'image/png';
  if (directBase64 != null) {
    return {
      mimeType: directMime,
      data: directBase64,
    };
  }

  const nestedImage = record.image;
  if (nestedImage != null && typeof nestedImage === 'object') {
    const imageRecord = nestedImage as Record<string, unknown>;
    if (typeof imageRecord.base64 === 'string') {
      return {
        mimeType: typeof imageRecord.mimeType === 'string' ? imageRecord.mimeType : 'image/png',
        data: imageRecord.base64,
      };
    }
  }

  return null;
}

function extractGeminiImage(payload: unknown): InlineImagePart | null {
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
          mimeType: typeof imageRecord.mimeType === 'string' ? imageRecord.mimeType : 'image/png',
          data: imageRecord.data,
        };
      }
    }
  }

  return null;
}

async function requestViaProxy(prompt: string): Promise<InlineImagePart> {
  const endpoint = process.env.EXPO_PUBLIC_IDEA_GENERATOR_ENDPOINT?.trim();
  if (endpoint == null || endpoint.length === 0) {
    throw new Error(
      'Es ist kein Ideenbild-Endpunkt konfiguriert. Setze EXPO_PUBLIC_IDEA_GENERATOR_ENDPOINT oder hinterlege einen Gemini-Key.',
    );
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      model: getGeminiModel(),
      aspectRatio: '3:4',
    }),
  });

  if (!response.ok) {
    throw new Error(`Der Ideenbild-Endpunkt antwortete mit HTTP ${response.status}.`);
  }

  const data = (await response.json()) as unknown;
  const image = extractProxyImage(data);
  if (image == null) {
    throw new Error('Der Ideenbild-Endpunkt hat kein Bild im erwarteten Format geliefert.');
  }
  return image;
}

async function requestViaGemini(prompt: string): Promise<InlineImagePart> {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim();
  if (apiKey == null || apiKey.length === 0) {
    return requestViaProxy(prompt);
  }

  const model = getGeminiModel();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseModalities: ['IMAGE'],
          responseFormat: {
            image: {
              aspectRatio: '3:4',
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini antwortete mit HTTP ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as unknown;
  const image = extractGeminiImage(data);
  if (image == null) {
    throw new Error('Gemini hat kein Bild in der Antwort geliefert.');
  }

  return image;
}

async function writeGeneratedImageFile(image: InlineImagePart): Promise<{ uri: string; width: number; height: number; mimeType: string }> {
  const outputDirectory = new Directory(Paths.cache, 'idea-images');
  outputDirectory.create({ idempotent: true, intermediates: true });

  const extension = image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const outputFile = new File(outputDirectory, `idea-${Date.now()}.${extension}`);
  outputFile.create({ overwrite: true, intermediates: true });
  outputFile.write(image.data, { encoding: 'base64' });

  const normalized = await manipulateAsync(outputFile.uri, [], {
    compress: 1,
    format: image.mimeType === 'image/jpeg' ? SaveFormat.JPEG : SaveFormat.PNG,
  });

  return {
    uri: normalized.uri,
    width: normalized.width,
    height: normalized.height,
    mimeType: image.mimeType,
  };
}

async function buildPreviewDataUrl(uri: string, width: number, height: number): Promise<string> {
  const previewSize = resizeToFit(width, height, 1200);
  const preview = await manipulateAsync(
    uri,
    previewSize.width === width && previewSize.height === height ? [] : [{ resize: previewSize }],
    {
      base64: true,
      compress: 0.92,
      format: SaveFormat.JPEG,
    },
  );

  if (preview.base64 == null) {
    throw new Error('Konnte keine Vorschau fuer das Ideenbild erzeugen.');
  }

  return `data:image/jpeg;base64,${preview.base64}`;
}

export async function generateIdeaImage(request: IdeaGenerationRequest): Promise<GeneratedIdeaImage> {
  const generatedImage = await requestViaGemini(request.prompt);
  const normalized = await writeGeneratedImageFile(generatedImage);
  const previewDataUrl = await buildPreviewDataUrl(normalized.uri, normalized.width, normalized.height);

  const fileName = `idea-${Date.now()}.${generatedImage.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`;

  return {
    asset: {
      assetId: null,
      fileName,
      height: normalized.height,
      mimeType: generatedImage.mimeType,
      type: 'image',
      uri: normalized.uri,
      width: normalized.width,
    },
    previewDataUrl,
    label: sanitizeLabel(request.label),
    promptText: request.prompt,
  };
}
