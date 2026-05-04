import type { PreparedGeneratorInput } from './bridgeTypes';
import { uint8ToBase64 } from './base64';
import type { PreparedGeneratorImage } from './generatorTypes';

export const GENERATOR_BRIDGE_CHUNK_SIZE = 240000;

export function serializePreparedGeneratorInput(input: PreparedGeneratorImage): PreparedGeneratorInput {
  const rawBytes = new Uint8Array(
    input.imageData.data.buffer.slice(
      input.imageData.data.byteOffset,
      input.imageData.data.byteOffset + input.imageData.data.byteLength,
    ),
  );

  return {
    preparedImage: input.preparedImage,
    imageData: {
      width: input.imageData.width,
      height: input.imageData.height,
      dataBase64: uint8ToBase64(rawBytes),
      dataByteLength: rawBytes.byteLength,
    },
  };
}

export function splitIntoChunks(value: string, chunkSize = GENERATOR_BRIDGE_CHUNK_SIZE): string[] {
  if (value.length === 0) {
    return [''];
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    chunks.push(value.slice(offset, offset + chunkSize));
  }
  return chunks;
}
