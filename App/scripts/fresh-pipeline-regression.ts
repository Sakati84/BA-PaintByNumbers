import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { DEFAULT_GENERATOR_SETTINGS } from '../src/features/generator/defaultSettings';
import {
  generatePaintByNumbersFreshFromPreparedInput,
  type GeneratorPipelineDebugCache,
  type PreparedFreshGeneratorImage,
} from '../src/features/generator/fresh/generatePaintByNumbersFresh';
import type { GeneratorResult, GeneratorSettings } from '../src/features/generator/generatorTypes';

type PixelFactory = (x: number, y: number) => readonly [number, number, number];

function preparedImage(name: string, width: number, height: number, pixel: PixelFactory): PreparedFreshGeneratorImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
  return {
    prepared: {
      imageUri: `memory://${name}`,
      width,
      height,
      fileName: `${name}.png`,
      mimeType: 'image/png',
    },
    imageData: { width, height, data },
  };
}

function settings(colorCount: number, overrides: Partial<GeneratorSettings> = {}): GeneratorSettings {
  return {
    ...DEFAULT_GENERATOR_SETTINGS,
    resizeImageWidth: 1400,
    resizeImageHeight: 1400,
    kMeansNrOfClusters: colorCount,
    ...overrides,
  };
}

function hashResult(result: GeneratorResult): string {
  const hash = createHash('sha256');
  hash.update(result.svg);
  hash.update(result.previewPngBase64 ?? '');
  hash.update(JSON.stringify(result.palette));
  hash.update(String(result.facetCount));
  return hash.digest('hex');
}

function assertVectorOutputs(result: GeneratorResult): void {
  assert.ok(result.svg.includes('<path') || result.facetCount === 1, 'Fresh SVG should contain vector paths.');
  assert.ok(!result.svg.includes('data:image/png;base64'), 'Fresh SVG must not embed a raster PNG.');
  for (const variant of result.variants ?? []) {
    assert.ok(variant.svg?.startsWith('<svg'), `${variant.id} should contain an SVG document.`);
    assert.ok(!variant.svg?.includes('data:image/png;base64'), `${variant.id} should be a true vector SVG.`);
  }
}

async function run(): Promise<void> {
  const solid = preparedImage('solid', 32, 32, () => [90, 130, 170]);
  const solidResult = await generatePaintByNumbersFreshFromPreparedInput(
    solid,
    settings(24),
    undefined,
    { variantIds: ['cleanColor'] },
  );
  assert.equal(solidResult.facetCount, 1, 'A solid image must remain one region.');
  assert.equal(solidResult.palette.length, 1, 'A solid image must not invent missing colors.');
  assertVectorOutputs(solidResult);

  const tinyNeighbor = preparedImage('tiny-neighbor', 48, 32, (x) => (
    x < 3 ? [112, 116, 120] : [100, 104, 108]
  ));
  const tinyNeighborResult = await generatePaintByNumbersFreshFromPreparedInput(
    tinyNeighbor,
    settings(8),
    undefined,
    { variantIds: ['cleanColor'] },
  );
  assert.equal(
    tinyNeighborResult.facetCount,
    1,
    'Two close neighboring regions must merge instead of swapping labels between passes.',
  );

  const budgetBlocks = preparedImage('budget-blocks', 60, 30, (x) => (
    x < 20 ? [190, 45, 45] : x < 40 ? [45, 180, 70] : [45, 70, 190]
  ));
  const strictBudgetResult = await generatePaintByNumbersFreshFromPreparedInput(
    budgetBlocks,
    settings(8, { maximumNumberOfFacets: 1 }),
    undefined,
    { variantIds: ['cleanColor'] },
  );
  assert.equal(strictBudgetResult.facetCount, 1, 'The hard budget must merge even large high-contrast regions when explicitly required.');

  const checkerboard = preparedImage('checkerboard', 48, 48, (x, y) => (
    (x + y) % 2 === 0 ? [80, 120, 160] : [92, 132, 172]
  ));
  const budgetSettings = settings(8, { maximumNumberOfFacets: 20 });
  const progress: number[] = [];
  const firstBudgetResult = await generatePaintByNumbersFreshFromPreparedInput(
    checkerboard,
    budgetSettings,
    (update) => progress.push(update.progress),
    { variantIds: ['cleanColor', 'coloredEdgesWithDots'] },
  );
  assert.ok(firstBudgetResult.facetCount <= 20, 'maximumNumberOfFacets must be a real postcondition.');
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]), 'Progress must be monotonic.');
  const markerSvg = firstBudgetResult.variants?.find((variant) => variant.id === 'coloredEdgesWithDots')?.svg ?? '';
  assert.equal((markerSvg.match(/<circle /g) ?? []).length, firstBudgetResult.facetCount, 'Every final region needs one marker.');
  assertVectorOutputs(firstBudgetResult);

  const secondBudgetResult = await generatePaintByNumbersFreshFromPreparedInput(
    checkerboard,
    budgetSettings,
    undefined,
    { variantIds: ['cleanColor', 'coloredEdgesWithDots'] },
  );
  assert.equal(hashResult(firstBudgetResult), hashResult(secondBudgetResult), 'Fresh output must be deterministic.');

  const cacheSource = preparedImage('cache-source', 40, 36, (x, y) => (
    x < 14 ? [180, 80 + y, 70] : x < 28 ? [60, 150, 90 + y] : [60 + y, 90, 180]
  ));
  let cache: GeneratorPipelineDebugCache | undefined;
  await generatePaintByNumbersFreshFromPreparedInput(
    cacheSource,
    settings(12),
    undefined,
    {
      variantIds: ['cleanColor'],
      debug: {
        enabled: true,
        onCacheUpdated: (nextCache) => {
          cache = nextCache;
        },
      },
    },
  );
  assert.ok(cache != null, 'A debug run must publish a cache.');

  const changedSettings = settings(8, { maximumNumberOfFacets: 12 });
  const cachedChangedResult = await generatePaintByNumbersFreshFromPreparedInput(
    cacheSource,
    changedSettings,
    undefined,
    {
      variantIds: ['cleanColor'],
      debug: {
        enabled: true,
        rerunFromStage: 'facetReduce',
        cache,
      },
    },
  );
  const cleanChangedResult = await generatePaintByNumbersFreshFromPreparedInput(
    cacheSource,
    changedSettings,
    undefined,
    { variantIds: ['cleanColor'] },
  );
  assert.equal(
    hashResult(cachedChangedResult),
    hashResult(cleanChangedResult),
    'A settings-incompatible partial cache must fall back to the same result as a clean run.',
  );

  process.stdout.write('Fresh pipeline regression checks passed.\n');
}

void run();
