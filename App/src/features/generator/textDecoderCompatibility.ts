function installLatin1TextDecoderCompatibility(): void {
  const TextDecoderConstructor = globalThis.TextDecoder;
  if (TextDecoderConstructor == null) {
    return;
  }

  try {
    new TextDecoderConstructor('latin1');
    return;
  } catch {
    // React Native/Hermes rejects "latin1". Some PNG chunks use this encoding.
  }

  const CompatibleTextDecoder = class {
    private readonly delegate: TextDecoder | null;
    readonly encoding: string;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;

    constructor(label?: string, options?: TextDecoderOptions) {
      const normalizedLabel = label?.toLowerCase();
      this.encoding = normalizedLabel === 'latin1' ? 'latin1' : (label ?? 'utf-8');
      this.fatal = options?.fatal ?? false;
      this.ignoreBOM = options?.ignoreBOM ?? false;
      this.delegate = normalizedLabel === 'latin1' ? null : new TextDecoderConstructor(label, options);
    }

    decode(input?: BufferSource, options?: TextDecodeOptions): string {
      if (this.delegate != null) {
        return this.delegate.decode(input, options);
      }

      if (input == null) {
        return '';
      }

      const bytes =
        input instanceof ArrayBuffer
          ? new Uint8Array(input)
          : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      let text = '';
      const chunkSize = 8192;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        text += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      return text;
    }
  };

  globalThis.TextDecoder = CompatibleTextDecoder as typeof TextDecoderConstructor;
}

installLatin1TextDecoderCompatibility();
