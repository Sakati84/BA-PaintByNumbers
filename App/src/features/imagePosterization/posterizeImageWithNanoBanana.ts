import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

type PosterizeImageRequest = {
  asset: ImagePickerAsset;
  prompt: string;
  colorCount: number;
  complexity: string;
};

export type PosterizedImage = {
  asset: ImagePickerAsset;
  previewDataUrl: string;
  label: string;
  promptText: string;
};

type InlineImagePart = {
  mimeType: string;
  data: string;
};

const MODEL_INPUT_MAX_EDGE = 1024;

function getNanoBananaModel(): string {
  return (
    process.env.EXPO_PUBLIC_NANO_BANANA_MODEL?.trim() ||
    process.env.EXPO_PUBLIC_GEMINI_IMAGE_MODEL?.trim() ||
    'gemini-2.5-flash-image'
  );
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

function stripDataUrlPrefix(value: string): string {
  const marker = ';base64,';
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) {
    return value;
  }
  return value.slice(markerIndex + marker.length);
}

function sanitizeLabel(asset: ImagePickerAsset, colorCount: number): string {
  const baseName = asset.fileName?.replace(/\.[^.]+$/, '').trim() || 'Hochgeladenes Bild';
  return `${baseName} (${colorCount} Farben)`;
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
      data: stripDataUrlPrefix(directBase64),
    };
  }

  const nestedImage = record.image;
  if (nestedImage != null && typeof nestedImage === 'object') {
    const imageRecord = nestedImage as Record<string, unknown>;
    if (typeof imageRecord.base64 === 'string') {
      return {
        mimeType: typeof imageRecord.mimeType === 'string' ? imageRecord.mimeType : 'image/png',
        data: stripDataUrlPrefix(imageRecord.base64),
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
          mimeType:
            typeof imageRecord.mimeType === 'string'
              ? imageRecord.mimeType
              : typeof imageRecord.mime_type === 'string'
                ? imageRecord.mime_type
                : 'image/png',
          data: imageRecord.data,
        };
      }
    }
  }

  return null;
}

async function prepareInputImage(asset: ImagePickerAsset): Promise<{
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}> {
  const target = resizeToFit(asset.width, asset.height, MODEL_INPUT_MAX_EDGE);
  const prepared = await manipulateAsync(
    asset.uri,
    target.width === asset.width && target.height === asset.height ? [] : [{ resize: target }],
    {
      base64: true,
      compress: 0.92,
      format: SaveFormat.JPEG,
    },
  );

  if (prepared.base64 == null) {
    throw new Error('Konnte das Upload-Bild nicht für den KI-Call vorbereiten.');
  }

  return {
    base64: prepared.base64,
    mimeType: 'image/jpeg',
    width: prepared.width,
    height: prepared.height,
  };
}

async function requestViaProxy(request: PosterizeImageRequest, image: Awaited<ReturnType<typeof prepareInputImage>>): Promise<InlineImagePart> {
  const endpoint = process.env.EXPO_PUBLIC_IMAGE_POSTERIZE_ENDPOINT?.trim();
  if (endpoint == null || endpoint.length === 0) {
    throw new Error('Es ist kein Posterize-Endpunkt konfiguriert. Setze EXPO_PUBLIC_IMAGE_POSTERIZE_ENDPOINT oder einen Nano-Banana-Key.');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: request.prompt,
      model: getNanoBananaModel(),
      colorCount: request.colorCount,
      complexity: request.complexity,
      image: {
        mimeType: image.mimeType,
        base64: image.base64,
        width: image.width,
        height: image.height,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Der Posterize-Endpunkt antwortete mit HTTP ${response.status}.`);
  }

  const data = (await response.json()) as unknown;
  const output = extractProxyImage(data);
  if (output == null) {
    throw new Error('Der Posterize-Endpunkt hat kein Bild im erwarteten Format geliefert.');
  }
  return output;
}

async function requestViaGemini(request: PosterizeImageRequest, image: Awaited<ReturnType<typeof prepareInputImage>>): Promise<InlineImagePart> {
  const apiKey = process.env.EXPO_PUBLIC_NANO_BANANA_API_KEY?.trim() || process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim();
  if (apiKey == null || apiKey.length === 0) {
    return requestViaProxy(request, image);
  }

  const model = getNanoBananaModel();
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
            parts: [
              { text: request.prompt },
              {
                inline_data: {
                  mime_type: image.mimeType,
                  data: image.base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['IMAGE'],
          temperature: 0.2,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Nano Banana antwortete mit HTTP ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as unknown;
  const output = extractGeminiImage(data);
  if (output == null) {
    throw new Error('Nano Banana hat kein Bild in der Antwort geliefert.');
  }
  return output;
}

async function writeOutputImageFile(image: InlineImagePart): Promise<{ uri: string; width: number; height: number; mimeType: string }> {
  const outputDirectory = new Directory(Paths.cache, 'posterized-images');
  outputDirectory.create({ idempotent: true, intermediates: true });

  const extension = image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const outputFile = new File(outputDirectory, `posterized-${Date.now()}.${extension}`);
  outputFile.create({ overwrite: true, intermediates: true });
  outputFile.write(stripDataUrlPrefix(image.data), { encoding: 'base64' });

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
  const previewSize = resizeToFit(width, height, MODEL_INPUT_MAX_EDGE);
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
    throw new Error('Konnte keine Vorschau für das posterisierte Bild erzeugen.');
  }

  return `data:image/jpeg;base64,${preview.base64}`;
}

export async function posterizeImageWithNanoBanana(request: PosterizeImageRequest): Promise<PosterizedImage> {
  const inputImage = await prepareInputImage(request.asset);
  const posterizedImage = await requestViaGemini(request, inputImage);
  const normalized = await writeOutputImageFile(posterizedImage);
  const previewDataUrl = await buildPreviewDataUrl(normalized.uri, normalized.width, normalized.height);
  const fileName = `posterized-${Date.now()}.${posterizedImage.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`;

  return {
    asset: {
      assetId: null,
      fileName,
      height: normalized.height,
      mimeType: normalized.mimeType,
      type: 'image',
      uri: normalized.uri,
      width: normalized.width,
    },
    previewDataUrl,
    label: sanitizeLabel(request.asset, request.colorCount),
    promptText: request.prompt,
  };
}
