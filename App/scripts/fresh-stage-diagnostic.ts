import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { decode } from 'fast-png';

import {
  generatePaintByNumbersFreshFromPreparedInput,
  type PreparedFreshGeneratorImage,
} from '../src/features/generator/fresh/generatePaintByNumbersFresh';
import type { GeneratorDebugStageSnapshot, GeneratorSettings } from '../src/features/generator/generatorTypes';

function requiredArg(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value == null) {
    throw new Error(`Missing required argument ${name}.`);
  }
  return path.resolve(value);
}

function decodePng(bytes: Uint8Array): PreparedFreshGeneratorImage['imageData'] {
  const decoded = decode(bytes);
  const rgba = new Uint8ClampedArray(decoded.width * decoded.height * 4);
  for (let pixel = 0; pixel < decoded.width * decoded.height; pixel += 1) {
    const sourceOffset = pixel * decoded.channels;
    const targetOffset = pixel * 4;
    if (decoded.channels === 1 || decoded.channels === 2) {
      rgba[targetOffset] = decoded.data[sourceOffset];
      rgba[targetOffset + 1] = decoded.data[sourceOffset];
      rgba[targetOffset + 2] = decoded.data[sourceOffset];
    } else {
      rgba[targetOffset] = decoded.data[sourceOffset];
      rgba[targetOffset + 1] = decoded.data[sourceOffset + 1];
      rgba[targetOffset + 2] = decoded.data[sourceOffset + 2];
    }
    rgba[targetOffset + 3] = decoded.channels === 2
      ? decoded.data[sourceOffset + 1]
      : decoded.channels === 4
        ? decoded.data[sourceOffset + 3]
        : 255;
  }
  return { width: decoded.width, height: decoded.height, data: rgba };
}

async function main(): Promise<void> {
  const inputPath = requiredArg('--input');
  const settingsPath = requiredArg('--settings');
  const outputDirectory = requiredArg('--out');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as GeneratorSettings;
  const imageData = decodePng(new Uint8Array(await readFile(inputPath)));
  const snapshots: GeneratorDebugStageSnapshot[] = [];
  await mkdir(outputDirectory, { recursive: true });

  const result = await generatePaintByNumbersFreshFromPreparedInput(
    {
      prepared: {
        imageUri: inputPath,
        width: imageData.width,
        height: imageData.height,
        fileName: path.basename(inputPath),
        mimeType: 'image/png',
      },
      imageData,
    },
    settings,
    undefined,
    {
      variantIds: ['cleanColor'],
      debug: { enabled: true },
      onStageSnapshot: (snapshot) => snapshots.push(snapshot),
    },
  );

  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    if (snapshot.image?.pngBase64 != null) {
      await writeFile(
        path.join(outputDirectory, `${String(index + 1).padStart(2, '0')}-${snapshot.stage}.png`),
        Buffer.from(snapshot.image.pngBase64, 'base64'),
      );
    }
  }
  await writeFile(
    path.join(outputDirectory, 'stages.json'),
    JSON.stringify(snapshots.map(({ image: _image, ...snapshot }) => snapshot), null, 2),
  );
  await writeFile(
    path.join(outputDirectory, 'result.json'),
    JSON.stringify({ facetCount: result.facetCount, palette: result.palette, timings: result.timings }, null, 2),
  );
  process.stdout.write(`${outputDirectory}\n`);
}

void main();
