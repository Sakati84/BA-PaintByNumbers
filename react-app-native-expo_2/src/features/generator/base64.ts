const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function getBase64Char(index: number): string {
  return BASE64_ALPHABET[index] ?? '=';
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const byte0 = bytes[index] ?? 0;
    const byte1 = bytes[index + 1] ?? 0;
    const byte2 = bytes[index + 2] ?? 0;
    const combined = (byte0 << 16) | (byte1 << 8) | byte2;

    output += getBase64Char((combined >> 18) & 0x3f);
    output += getBase64Char((combined >> 12) & 0x3f);
    output += index + 1 < bytes.length ? getBase64Char((combined >> 6) & 0x3f) : '=';
    output += index + 2 < bytes.length ? getBase64Char(combined & 0x3f) : '=';
  }

  return output;
}

export function base64ToUint8(base64: string): Uint8Array {
  const cleaned = base64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  const outputLength = Math.max(0, (cleaned.length / 4) * 3 - padding);
  const output = new Uint8Array(outputLength);

  let outputIndex = 0;
  for (let index = 0; index < cleaned.length; index += 4) {
    const encoded0 = BASE64_ALPHABET.indexOf(cleaned[index] ?? 'A');
    const encoded1 = BASE64_ALPHABET.indexOf(cleaned[index + 1] ?? 'A');
    const encoded2 = cleaned[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(cleaned[index + 2] ?? 'A');
    const encoded3 = cleaned[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(cleaned[index + 3] ?? 'A');
    const combined = (encoded0 << 18) | (encoded1 << 12) | (encoded2 << 6) | encoded3;

    if (outputIndex < outputLength) {
      output[outputIndex] = (combined >> 16) & 0xff;
      outputIndex += 1;
    }
    if (outputIndex < outputLength) {
      output[outputIndex] = (combined >> 8) & 0xff;
      outputIndex += 1;
    }
    if (outputIndex < outputLength) {
      output[outputIndex] = combined & 0xff;
      outputIndex += 1;
    }
  }

  return output;
}
