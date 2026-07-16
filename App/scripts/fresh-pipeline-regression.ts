import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decode } from 'fast-png';

import { DEFAULT_GENERATOR_SETTINGS } from '../src/features/generator/defaultSettings';
import {
  boundaryMask,
  ensureTargetPaletteUsage,
  generatePaintByNumbersFreshFromPreparedInput,
  pruneThinProtrusions,
  terminalPaintabilityDecision,
  type GeneratorPipelineDebugCache,
  type PreparedFreshGeneratorImage,
} from '../src/features/generator/fresh/generatePaintByNumbersFresh';
import { canFitNumberGlyph } from '../src/features/generator/fresh/freshMarkerSizing';
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

function referenceBoundaryMask(regionMap: Int32Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (x + 1 < width && regionMap[index + 1] !== regionMap[index]) {
        mask[index] = 2;
        mask[index + 1] = 2;
      }
      if (y + 1 < height && regionMap[index + width] !== regionMap[index]) {
        mask[index] = 2;
        mask[index + width] = 2;
      }
    }
  }
  const primary = new Uint8Array(mask);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (primary[index] !== 2) {
        continue;
      }
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
            continue;
          }
          const neighbor = ny * width + nx;
          if (mask[neighbor] === 0) {
            mask[neighbor] = 1;
          }
        }
      }
    }
  }
  return mask;
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
  let capBoundaryMutationRounds = 0;
  let capBoundaryDecision: ReturnType<typeof terminalPaintabilityDecision> = 'mutate';
  while (capBoundaryDecision === 'mutate') {
    capBoundaryDecision = terminalPaintabilityDecision(
      capBoundaryMutationRounds,
      capBoundaryMutationRounds < 6 ? 1 : 0,
      6,
    );
    if (capBoundaryDecision === 'mutate') {
      capBoundaryMutationRounds += 1;
    }
  }
  assert.equal(capBoundaryMutationRounds, 6, 'Terminal convergence must allow all six mutation rounds.');
  assert.equal(
    capBoundaryDecision,
    'stable',
    'A map that stabilizes after the sixth mutation must pass the final read-only audit.',
  );
  assert.equal(
    terminalPaintabilityDecision(6, 1, 6),
    'exhausted',
    'A seventh required mutation must still fail the terminal convergence cap.',
  );

  const boundaryFixtureWidth = 9;
  const boundaryFixtureHeight = 9;
  const boundaryFixture = new Int32Array(boundaryFixtureWidth * boundaryFixtureHeight);
  for (let y = 2; y <= 6; y += 1) {
    boundaryFixture[y * boundaryFixtureWidth + 4] = 1;
  }
  for (let x = 4; x <= 7; x += 1) {
    boundaryFixture[6 * boundaryFixtureWidth + x] = 1;
  }
  assert.deepEqual(
    boundaryMask(boundaryFixture, boundaryFixtureWidth, boundaryFixtureHeight),
    referenceBoundaryMask(boundaryFixture, boundaryFixtureWidth, boundaryFixtureHeight),
    'Classic PNG boundaries must mark right/down adjacencies independently without orthogonal ghost lines.',
  );

  const exactPaletteWidth = 80;
  const exactPaletteHeight = 40;
  const exactPaletteLabels = new Uint8Array(exactPaletteWidth * exactPaletteHeight);
  const exactPaletteSource = preparedImage('exact-palette-fallback', exactPaletteWidth, exactPaletteHeight, (x) => {
    if (x < 20) return [100, 100, 100];
    if (x < 40) return [80, 80, 80];
    if (x < 60) return [105, 105, 105];
    return [140, 140, 140];
  });
  for (let y = 0; y < exactPaletteHeight; y += 1) {
    for (let x = 0; x < exactPaletteWidth; x += 1) {
      exactPaletteLabels[y * exactPaletteWidth + x] = x < 20 || (x >= 40 && x < 60)
        ? 0
        : x < 40
          ? 1
          : 2;
    }
  }
  const exactPaletteBeforeBoundaries = boundaryMask(
    Int32Array.from(exactPaletteLabels),
    exactPaletteWidth,
    exactPaletteHeight,
  );
  const exactPaletteRepair = ensureTargetPaletteUsage(
    exactPaletteLabels,
    exactPaletteSource.imageData.data,
    new Float32Array([
      100, 100, 100,
      80, 80, 80,
      140, 140, 140,
      110, 110, 110,
    ]),
    exactPaletteWidth,
    exactPaletteHeight,
    4,
    130,
  );
  assert.equal(exactPaletteRepair.reintroducedCount, 1, 'One missing learned color must be reintroduced.');
  assert.equal(
    exactPaletteRepair.forcedReintroducedCount,
    1,
    'The deterministic whole-component fallback must handle a valid donor that misses the strict improvement threshold.',
  );
  assert.equal(new Set(exactPaletteRepair.labelMap).size, 4, 'Every geometrically feasible learned color must be used.');
  assert.deepEqual(
    boundaryMask(Int32Array.from(exactPaletteRepair.labelMap), exactPaletteWidth, exactPaletteHeight),
    exactPaletteBeforeBoundaries,
    'Exact palette restoration must relabel whole components without changing Classic boundaries.',
  );

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

  const expertMicroPalette: readonly (readonly [number, number, number])[] = [
    [34, 68, 112],
    [196, 66, 54],
    [62, 148, 78],
    [224, 184, 56],
    [126, 72, 166],
    [218, 222, 214],
  ];
  const expertMicroMosaic = preparedImage('expert-micro-mosaic', 240, 168, (x, y) => (
    expertMicroPalette[(Math.floor(x / 6) + Math.floor(y / 6)) % expertMicroPalette.length]
  ));
  const expertMicroMosaicResult = await generatePaintByNumbersFreshFromPreparedInput(
    expertMicroMosaic,
    settings(24),
    undefined,
    { variantIds: ['cleanColor'] },
  );
  assert.ok(
    expertMicroMosaicResult.facetCount <= 500,
    `Expert paintability regression: 6 px micro-facets must be consolidated (got ${expertMicroMosaicResult.facetCount}).`,
  );

  const unpaintableStripes = preparedImage('unpaintable-stripes', 360, 180, (x) => (
    x === 100 || x === 240 || x === 241 ? [28, 34, 40] : [214, 220, 226]
  ));
  const unpaintableStripesResult = await generatePaintByNumbersFreshFromPreparedInput(
    unpaintableStripes,
    settings(24),
    undefined,
    { variantIds: ['cleanColor'] },
  );
  const unpaintableStripesPng = unpaintableStripesResult.variants?.find((variant) => variant.id === 'cleanColor')?.pngBase64;
  assert.ok(unpaintableStripesPng != null, 'The hard-thin regression needs a clean-color render.');
  const unpaintableStripesPreview = decode(Buffer.from(unpaintableStripesPng, 'base64'));
  const stripePixel = (x: number): number[] => {
    const offset = (90 * unpaintableStripesPreview.width + x) * unpaintableStripesPreview.channels;
    return Array.from(unpaintableStripesPreview.data.slice(offset, offset + 3));
  };
  const stripeRunWidth = (x: number): number => {
    const color = stripePixel(x).join('-');
    let left = x;
    let right = x;
    while (left > 0 && stripePixel(left - 1).join('-') === color) left -= 1;
    while (right + 1 < unpaintableStripesPreview.width && stripePixel(right + 1).join('-') === color) right += 1;
    return right - left + 1;
  };
  assert.ok(
    stripeRunWidth(100) > 2,
    'A long one-pixel facet must become part of a paintable-width region even when its area exceeds the Expert floor.',
  );
  assert.ok(
    stripeRunWidth(240) > 2,
    'A long two-pixel facet must become part of a paintable-width region even when its area exceeds the Expert floor.',
  );

  for (const [width, height] of [[512, 384], [1024, 768]] as const) {
    const bandWidth = Math.round((width / 512) * 3);
    const bandStart = Math.floor(width * 0.49);
    const lowContrastBand = preparedImage(`safe-gradient-band-${width}`, width, height, (x) => (
      x < bandStart
        ? [100, 100, 100]
        : x < bandStart + bandWidth
          ? [110, 110, 110]
          : [120, 120, 120]
    ));
    const lowContrastBandResult = await generatePaintByNumbersFreshFromPreparedInput(
      lowContrastBand,
      settings(24),
      undefined,
      { variantIds: ['cleanColor'] },
    );
    const lowContrastBandPng = lowContrastBandResult.variants?.find((variant) => variant.id === 'cleanColor')?.pngBase64;
    assert.ok(lowContrastBandPng != null, 'The safe gradient-band regression needs a clean-color render.');
    const lowContrastBandPreview = decode(Buffer.from(lowContrastBandPng, 'base64'));
    const bandColor = (x: number): string => {
      const offset = (Math.floor(height / 2) * width + x) * lowContrastBandPreview.channels;
      return Array.from(lowContrastBandPreview.data.slice(offset, offset + 3)).join('-');
    };
    assert.ok(
      bandColor(bandStart + Math.floor(bandWidth / 2)) === bandColor(bandStart - 4)
        || bandColor(bandStart + Math.floor(bandWidth / 2)) === bandColor(bandStart + bandWidth + 4),
      `A scaled low-contrast Lab-intermediate sandwich band must collapse at ${width}px.`,
    );

    const semanticStripe = preparedImage(`safe-semantic-stripe-${width}`, width, height, (x) => (
      x >= bandStart && x < bandStart + bandWidth ? [30, 34, 38] : [220, 224, 228]
    ));
    const semanticStripeResult = await generatePaintByNumbersFreshFromPreparedInput(
      semanticStripe,
      settings(24),
      undefined,
      { variantIds: ['cleanColor'] },
    );
    const semanticStripePng = semanticStripeResult.variants?.find((variant) => variant.id === 'cleanColor')?.pngBase64;
    assert.ok(semanticStripePng != null, 'The semantic-stripe regression needs a clean-color render.');
    const semanticStripePreview = decode(Buffer.from(semanticStripePng, 'base64'));
    const stripeCenterOffset = (
      Math.floor(height / 2) * width + bandStart + Math.floor(bandWidth / 2)
    ) * semanticStripePreview.channels;
    const stripeBackgroundOffset = (Math.floor(height / 2) * width + bandStart - 4)
      * semanticStripePreview.channels;
    assert.notDeepEqual(
      Array.from(semanticStripePreview.data.slice(stripeCenterOffset, stripeCenterOffset + 3)),
      Array.from(semanticStripePreview.data.slice(stripeBackgroundOffset, stripeBackgroundOffset + 3)),
      `A scaled paintable high-contrast semantic stripe must survive at ${width}px.`,
    );
  }

  const attachedTendril = preparedImage('attached-tendril', 160, 120, (x, y) => {
    const inBody = x >= 20 && x <= 69 && y >= 30 && y <= 79;
    const inTendril = x >= 70 && x <= 130 && y >= 54 && y <= 55;
    return inBody || inTendril ? [118, 128, 138] : [100, 110, 120];
  });
  const tendrilLabelMap = new Uint8Array(attachedTendril.prepared.width * attachedTendril.prepared.height);
  for (let y = 30; y <= 79; y += 1) {
    for (let x = 20; x <= 69; x += 1) {
      tendrilLabelMap[y * attachedTendril.prepared.width + x] = 1;
    }
  }
  for (let y = 54; y <= 55; y += 1) {
    for (let x = 70; x <= 130; x += 1) {
      tendrilLabelMap[y * attachedTendril.prepared.width + x] = 1;
    }
  }
  const directTendrilPrune = await pruneThinProtrusions(
    tendrilLabelMap,
    attachedTendril.imageData.data,
    new Float32Array([100, 110, 120, 118, 128, 138]),
    attachedTendril.prepared.width,
    attachedTendril.prepared.height,
    1,
    {},
  );
  assert.ok(directTendrilPrune.changedPixelCount > 0, 'The protrusion fixture must exercise the opening itself.');
  assert.equal(
    directTendrilPrune.labelMap[54 * attachedTendril.prepared.width + 120],
    0,
    'The source-aware opening must remove a two-pixel attached tendril.',
  );
  assert.equal(
    directTendrilPrune.labelMap[55 * attachedTendril.prepared.width + 45],
    1,
    'The source-aware opening must preserve the paintable core.',
  );
  const bridgeLabelMap = new Uint8Array(attachedTendril.prepared.width * attachedTendril.prepared.height);
  for (let y = 25; y <= 84; y += 1) {
    for (let x = 10; x <= 49; x += 1) bridgeLabelMap[y * attachedTendril.prepared.width + x] = 1;
    for (let x = 110; x <= 149; x += 1) bridgeLabelMap[y * attachedTendril.prepared.width + x] = 1;
  }
  for (let y = 54; y <= 55; y += 1) {
    for (let x = 50; x <= 109; x += 1) bridgeLabelMap[y * attachedTendril.prepared.width + x] = 1;
  }
  const bridgePrune = await pruneThinProtrusions(
    bridgeLabelMap,
    attachedTendril.imageData.data,
    new Float32Array([100, 110, 120, 118, 128, 138]),
    attachedTendril.prepared.width,
    attachedTendril.prepared.height,
    1,
    {},
  );
  assert.equal(
    bridgePrune.labelMap[54 * attachedTendril.prepared.width + 80],
    1,
    'Restricted protrusion cleanup must not sever a thin isthmus between two retained cores.',
  );
  let attachedTendrilCache: GeneratorPipelineDebugCache | undefined;
  const attachedTendrilResult = await generatePaintByNumbersFreshFromPreparedInput(
    attachedTendril,
    settings(8),
    undefined,
    {
      variantIds: ['cleanColor'],
      debug: {
        enabled: true,
        onCacheUpdated: (nextCache) => {
          attachedTendrilCache = nextCache;
        },
      },
    },
  );
  const attachedTendrilPng = attachedTendrilResult.variants?.find((variant) => variant.id === 'cleanColor')?.pngBase64;
  assert.ok(attachedTendrilPng != null, 'The protrusion regression needs a clean-color render.');
  const attachedTendrilPreview = decode(Buffer.from(attachedTendrilPng, 'base64'));
  const tendrilPixel = (x: number, y: number): number[] => {
    const offset = (y * attachedTendrilPreview.width + x) * attachedTendrilPreview.channels;
    return Array.from(attachedTendrilPreview.data.slice(offset, offset + 3));
  };
  assert.deepEqual(
    tendrilPixel(120, 54),
    tendrilPixel(120, 52),
    'The default pipeline must not leave a two-pixel attached tendril in the final template.',
  );
  assert.notDeepEqual(
    tendrilPixel(45, 55),
    tendrilPixel(10, 55),
    'Protrusion pruning must preserve the paintable core of the same facet.',
  );
  assert.ok(attachedTendrilCache?.afterFacetReduce != null, 'The tendril debug run must retain its final regions.');
  assert.ok(attachedTendrilCache.smoothed != null, 'The tendril debug run must retain its smoothed source.');
  const finalTendrilComponents = attachedTendrilCache.afterFacetReduce.components;
  const finalTendrilLabelMap = new Uint8Array(finalTendrilComponents.componentMap.length);
  for (let index = 0; index < finalTendrilLabelMap.length; index += 1) {
    finalTendrilLabelMap[index] = finalTendrilComponents.labels[finalTendrilComponents.componentMap[index]];
  }
  const terminalOpeningAudit = await pruneThinProtrusions(
    finalTendrilLabelMap,
    attachedTendrilCache.smoothed,
    attachedTendrilCache.afterFacetReduce.paletteRgb,
    attachedTendril.prepared.width,
    attachedTendril.prepared.height,
    1,
    {},
  );
  assert.equal(terminalOpeningAudit.candidatePixelCount, 0, 'No removable thin protrusion may survive facetReduce.');
  assert.equal(terminalOpeningAudit.changedPixelCount, 0, 'Terminal protrusion cleanup must be idempotent.');

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
    { variantIds: ['cleanColor', 'numbers'] },
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
  const tinyEyeNumbersSvg = tinyEyeResult.variants?.find((variant) => variant.id === 'numbers')?.svg ?? '';
  const tinyEyeNumberCount = (tinyEyeNumbersSvg.match(/data-marker="number"/g) ?? []).length;
  const tinyEyeFallbackCount = (tinyEyeNumbersSvg.match(/data-marker="color-fallback"/g) ?? []).length;
  assert.equal(
    tinyEyeNumberCount + tinyEyeFallbackCount,
    tinyEyeResult.facetCount,
    'Every numbers variant region needs either a contained number or a palette-color fallback dot.',
  );
  assert.ok(tinyEyeFallbackCount > 0, 'A protected tiny landmark must use a color dot instead of forced text.');

  const expertReferenceColors: readonly (readonly [number, number, number])[] = [
    [32, 38, 46], [54, 70, 92], [72, 96, 124], [94, 122, 150],
    [118, 146, 172], [144, 170, 190], [174, 194, 208], [206, 216, 222],
    [72, 58, 48], [96, 72, 56], [220, 188, 154], [54, 70, 96],
    [186, 146, 192], [204, 166, 126], [70, 88, 58], [92, 116, 72],
    [118, 144, 86], [148, 170, 108], [78, 62, 92], [106, 80, 120],
    [138, 104, 150], [168, 134, 178], [188, 72, 62], [218, 184, 62],
  ];
  const expertSemanticDetails = preparedImage('expert-semantic-details', 320, 200, (x, y) => {
    if (y >= 160) {
      return expertReferenceColors[Math.min(23, Math.floor(x / (320 / 24)))];
    }
    const inFace = x >= 118 && x <= 218 && y >= 34 && y <= 132;
    const inMouth = x >= 164 && x <= 168 && y >= 88 && y <= 92;
    const inWall = x >= 22 && x <= 104 && y >= 64 && y <= 138;
    const stoneIndex = [36, 58, 80].findIndex((startX) => (
      x >= startX && x < startX + 8 && y >= 88 && y < 96
    ));
    if (inMouth) return [34, 30, 28];
    if (stoneIndex >= 0) return expertReferenceColors[10 + stoneIndex];
    if (inFace) return [184, 142, 104];
    if (inWall) return [104, 98, 90];
    return [218, 224, 228];
  });
  const expertSemanticDetailsResult = await generatePaintByNumbersFreshFromPreparedInput(
    expertSemanticDetails,
    settings(24, { removeFacetsSmallerThanImageRatio: 0.002 }),
    undefined,
    { variantIds: ['cleanColor'], debug: { enabled: true } },
  );
  const expertSemanticDetailsPng = expertSemanticDetailsResult.variants?.find(
    (variant) => variant.id === 'cleanColor',
  )?.pngBase64;
  assert.ok(expertSemanticDetailsPng != null, 'The Expert semantic-detail regression needs a clean-color render.');
  const expertSemanticDetailsPreview = decode(Buffer.from(expertSemanticDetailsPng, 'base64'));
  const expertFacetReduceStage = expertSemanticDetailsResult.debug?.stages.find(
    (stage) => stage.stage === 'facetReduce',
  );
  const restoredExpertDetailMetric = Number(
    expertFacetReduceStage?.metrics.find((metric) => metric.label === 'Restaurierte Expert-Details')?.value ?? 0,
  );
  assert.ok(restoredExpertDetailMetric > 0, 'The Expert semantic-detail fixture must exercise detail restoration.');
  const expertDetailPixel = (x: number, y: number): number[] => {
    const offset = (y * expertSemanticDetailsPreview.width + x) * expertSemanticDetailsPreview.channels;
    return Array.from(expertSemanticDetailsPreview.data.slice(offset, offset + 3));
  };
  assert.notDeepEqual(
    expertDetailPixel(166, 90),
    expertDetailPixel(158, 90),
    'A compact high-contrast Expert mouth must be restored with an existing distinct palette color.',
  );
  const retainedFieldstoneCount = [39, 61, 83].filter((stoneX) => (
    expertDetailPixel(stoneX, 90).join('-') !== expertDetailPixel(stoneX, 100).join('-')
  )).length;
  assert.ok(
    retainedFieldstoneCount >= 2,
    `Expert cleanup must retain a readable representative set of fieldstones (got ${retainedFieldstoneCount}/3).`,
  );
  assert.equal(
    expertSemanticDetailsResult.palette.length,
    24,
    'Expert detail restoration must reuse the requested palette instead of adding colors.',
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

  const numberedBands = preparedImage('numbered-bands', 180, 90, (x) => (
    x < 60 ? [190, 45, 45] : x < 120 ? [45, 180, 70] : [45, 70, 190]
  ));
  const numberedBandsResult = await generatePaintByNumbersFreshFromPreparedInput(
    numberedBands,
    settings(8),
    undefined,
    { variantIds: ['brightColorCircles', 'numbers'] },
  );
  const brightTemplate = numberedBandsResult.variants?.find((variant) => variant.id === 'brightColorCircles');
  const numbersTemplate = numberedBandsResult.variants?.find((variant) => variant.id === 'numbers');
  assert.equal(brightTemplate?.isDefault, true, 'The printable numbered template must be the Fresh default.');
  assert.ok(brightTemplate?.svg?.includes('<text '), 'Large Fresh regions need readable numbers inside their color circles.');
  assert.ok(numbersTemplate?.svg?.includes('<text '), 'The numbers-only Fresh variant needs readable vector labels.');
  assert.equal(
    (numbersTemplate?.svg?.match(/<text /g) ?? []).length,
    numberedBandsResult.facetCount,
    'The numbers-only Fresh variant must label every final region.',
  );
  assert.equal(
    (numbersTemplate?.svg?.match(/data-marker="color-fallback"/g) ?? []).length,
    0,
    'Large numbered bands must not need fallback dots.',
  );
  assert.equal(canFitNumberGlyph(4.7, '1'), false, 'A one-digit glyph must not be forced into an undersized marker.');
  assert.equal(canFitNumberGlyph(7.1, '24'), true, 'A two-digit glyph should fit once its full 5x7 box is contained.');
  assert.ok(brightTemplate?.pngBase64 != null, 'The printable numbered template needs a PNG export.');
  assert.ok(numbersTemplate?.pngBase64 != null, 'The numbers-only template needs a PNG export.');

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
    [
      'brightColorCircles',
      'colorCircles',
      'cleanColor',
      'coloredEdges',
      'coloredEdgesWithDots',
      'circlesOnly',
      'numbers',
      'classic',
      'debugUnlabeled',
    ],
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
