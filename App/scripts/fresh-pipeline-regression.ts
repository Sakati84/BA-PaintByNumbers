import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decode } from 'fast-png';

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

  const hillColors: readonly (readonly [number, number, number])[] = [
    [82, 69, 65],
    [103, 96, 88],
    [116, 120, 95],
    [124, 121, 102],
  ];
  const wallColors: readonly (readonly [number, number, number])[] = [
    [48, 54, 60], [72, 78, 84], [94, 100, 108], [132, 138, 146],
    [168, 174, 182], [205, 212, 220], [76, 60, 48], [104, 78, 60],
    [136, 100, 76], [166, 126, 96], [194, 154, 120], [220, 188, 154],
    [54, 78, 58], [72, 104, 70], [92, 132, 84], [120, 154, 104],
    [54, 70, 96], [72, 94, 126], [96, 120, 154], [126, 150, 180],
    [96, 72, 102], [126, 92, 132], [156, 116, 162], [186, 146, 192],
  ];
  const lowContrastFacets = preparedImage('low-contrast-facets', 240, 160, (x, y) => {
    if (y < 120) {
      return hillColors[Math.min(hillColors.length - 1, Math.floor(x / 60))];
    }
    return wallColors[Math.min(wallColors.length - 1, Math.floor(x / 10))];
  });
  const lowContrastResult = await generatePaintByNumbersFreshFromPreparedInput(
    lowContrastFacets,
    settings(24),
    undefined,
    { variantIds: ['cleanColor'] },
  );
  assert.equal(lowContrastResult.palette.length, 24, 'Detail preservation must stay inside the requested 24-color palette.');
  assert.ok(lowContrastResult.previewPngBase64 != null, 'The low-contrast regression needs a rendered preview.');
  const lowContrastPreview = decode(Buffer.from(lowContrastResult.previewPngBase64, 'base64'));
  const retainedHillColors = new Set<string>();
  for (const x of [30, 90, 150, 210]) {
    const offset = (60 * lowContrastPreview.width + x) * lowContrastPreview.channels;
    retainedHillColors.add(
      `${lowContrastPreview.data[offset]}-${lowContrastPreview.data[offset + 1]}-${lowContrastPreview.data[offset + 2]}`,
    );
  }
  assert.equal(
    retainedHillColors.size,
    hillColors.length,
    'Large low-contrast source facets must not collapse merely because they share a coarse RGB bin.',
  );

  const landmarkColors: readonly (readonly [number, number, number])[] = [
    [80, 126, 74],
    [74, 104, 148],
    [224, 208, 168],
    [178, 72, 58],
    [130, 136, 140],
    [218, 180, 60],
  ];
  const tinyEye = preparedImage('tiny-eye', 160, 120, (x, y) => {
    if (y < 80) {
      if (x >= 78 && x <= 80 && y >= 38 && y <= 40) {
        return [35, 32, 28];
      }
      return [184, 142, 104];
    }
    return landmarkColors[Math.min(landmarkColors.length - 1, Math.floor(x / (160 / landmarkColors.length)))];
  });
  const tinyEyeResult = await generatePaintByNumbersFreshFromPreparedInput(
    tinyEye,
    settings(8),
    undefined,
    { variantIds: ['cleanColor'] },
  );
  assert.equal(tinyEyeResult.palette.length, 8, 'Easy landmark restoration must not add a ninth color.');
  assert.ok(tinyEyeResult.previewPngBase64 != null, 'The Easy landmark regression needs a rendered preview.');
  const tinyEyePreview = decode(Buffer.from(tinyEyeResult.previewPngBase64, 'base64'));
  const eyeOffset = (39 * tinyEyePreview.width + 79) * tinyEyePreview.channels;
  const faceOffset = (39 * tinyEyePreview.width + 70) * tinyEyePreview.channels;
  assert.notDeepEqual(
    Array.from(tinyEyePreview.data.slice(eyeOffset, eyeOffset + 3)),
    Array.from(tinyEyePreview.data.slice(faceOffset, faceOffset + 3)),
    'A compact high-contrast Easy eye must survive cleanup as a closed facet.',
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
  );
  assert.ok(firstBudgetResult.facetCount <= 20, 'maximumNumberOfFacets must be a real postcondition.');
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]), 'Progress must be monotonic.');
  assert.deepEqual(
    firstBudgetResult.variants?.map((variant) => variant.id),
    ['cleanColor', 'coloredEdges', 'coloredEdgesWithDots', 'circlesOnly'],
    'The normal Fresh run must expose every exportable product variant.',
  );
  const markerSvg = firstBudgetResult.variants?.find((variant) => variant.id === 'coloredEdgesWithDots')?.svg ?? '';
  assert.equal((markerSvg.match(/<circle /g) ?? []).length, firstBudgetResult.facetCount, 'Every final region needs one marker.');
  const circlesOnlyVariant = firstBudgetResult.variants?.find((variant) => variant.id === 'circlesOnly');
  assert.ok(circlesOnlyVariant?.pngBase64 != null, 'Circles-only needs a PNG export.');
  const circlesOnlyPng = decode(Buffer.from(circlesOnlyVariant.pngBase64, 'base64'));
  assert.equal(circlesOnlyPng.width, checkerboard.prepared.width, 'Circles-only PNG width must match the render size.');
  assert.equal(circlesOnlyPng.height, checkerboard.prepared.height, 'Circles-only PNG height must match the render size.');
  assert.ok(circlesOnlyVariant.svg?.startsWith('<svg'), 'Circles-only needs a vector SVG export.');
  assert.ok(circlesOnlyVariant.svg?.includes('stroke="rgb(22,29,31)"'), 'Circles-only SVG needs black region edges.');
  assert.equal(
    (circlesOnlyVariant.svg?.match(/<circle /g) ?? []).length,
    firstBudgetResult.facetCount,
    'Circles-only SVG needs one circle per final region.',
  );
  assertVectorOutputs(firstBudgetResult);

  const secondBudgetResult = await generatePaintByNumbersFreshFromPreparedInput(
    checkerboard,
    budgetSettings,
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
