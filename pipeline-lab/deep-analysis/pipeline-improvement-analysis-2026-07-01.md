# Pipeline Improvement Analysis - 2026-07-01

## Scope

Analysiert wurden die frischen Pipeline-Läufe:

- Easy: `pipeline-lab/current-params-overview/runs/2026-07-01T04-27-51-306Z_easy-classic-single-band-merge-12c-v2`
- Medium: `pipeline-lab/current-params-overview/runs/2026-07-01T04-27-51-305Z_medium-classic-current-16c-v1`
- High: `pipeline-lab/current-params-overview/runs/2026-07-01T04-27-51-588Z_expert-classic-current-24c-v1`

Zusätzlich wurden `cleanColor` und `debugUnlabeled` gerendert:

- `pipeline-lab/deep-analysis/current-extra-variants-overview.png`
- `pipeline-lab/deep-analysis/current-segmentation-metrics.json`

## Current Observations

| Level | Avg facets | Avg actual colors | Avg duration | Main issue |
| --- | ---: | ---: | ---: | --- |
| Easy | 63.5 | 11.5 | 613 ms | Generally clean; horse background remains line-heavy. |
| Medium | 158.8 | 14.5 | 679 ms | Good compromise; woodpecker/landscape foliage has many small regions. |
| High | 289.8 | 20.3 | 820 ms | Detail is high, but some images become noisy and less paintable. |

Actual color count often ends below target:

- Easy flower: 10 colors despite target 12.
- Medium landscape/woodpecker: 15 colors despite target 16.
- High flower: 16 colors despite target 24.

This means the target should be treated as a maximum or desired complexity, not as guaranteed exact usable colors.

## Timing Hotspots

Average stage share:

| Level | Top stages |
| --- | --- |
| Easy | `narrowCleanup` 190 ms / 31.9%, `svgRender` 149 ms / 25.0%, `kmeans` 99 ms / 16.6% |
| Medium | `narrowCleanup` 192 ms / 29.1%, `svgRender` 162 ms / 24.6%, `kmeans` 120 ms / 18.3% |
| High | `kmeans` 212 ms / 26.5%, `narrowCleanup` 200 ms / 25.0%, `svgRender` 171 ms / 21.4% |

Main performance target: `narrowCleanup`, then render/export, then K-Means for High.

## Quality Metrics

Connected components measured from `cleanColor`:

| Level | Avg components | Avg small components `<64px` | Median component area trend |
| --- | ---: | ---: | --- |
| Easy | 63.3 | 3.8 | large regions, very paintable |
| Medium | 158.3 | 3.3 | balanced |
| High | 289.0 | 22.0 | many small regions, noisier |

Boundary transitions per megapixel:

- Easy avg: 13,996
- Medium avg: 26,577
- High avg: 34,399

High is not just more detailed; it has substantially more boundary density, which increases perceived noise and line clutter.

## Key Code Findings

1. App K-Means currently uses RGB:
   - `App/src/features/generator/defaultSettings.ts:21`
   - The algorithm can use Lab in `colorreductionmanagement.ts:107`, but the App path does not select it.

2. `narrowCleanup` runs more passes than settings imply:
   - `rasterPaintByNumbers.ts:1816-1819`
   - actual runs = `settings.narrowPixelStripCleanupRuns + 4`
   - This explains the consistently high cleanup cost.

3. Cleanup allocates/copies the full label map every pass:
   - `rasterPaintByNumbers.ts:317-319`
   - This is simple but expensive at 1024px input.

4. SVG draws every region with its own stroke:
   - `rasterPaintByNumbers.ts:1728-1734`
   - Shared boundaries are stroked by both neighboring regions, which can create visually doubled/thick lines in SVG/classic output.

5. The documented reference pipeline expects Lab quantization:
   - `docs/pipeline-uebersicht-de.md`, stage 3.
   - Python reference uses Lab MiniBatchKMeans.

## Mean-Shift Benchmark Summary

MeanShift `sp=12 sr=18` as prefilter:

| Set | Baseline | MeanShift only | Total with prefilter | Delta |
| --- | ---: | ---: | ---: | ---: |
| Medium | 633 ms/image | 425 ms/image | 983 ms/image | +350 ms / +55% |
| High | 773 ms/image | 1005 ms/image | 1639 ms/image | +866 ms / +113% |

Quality:

- Medium improved in 3 of 4 images.
- High improved in 2 of 4 images and worsened in woodpecker/flower.

Conclusion: MeanShift should be adaptive, not globally forced.

## Prioritized Improvement Candidates

### P1 - Switch App K-Means to Lab or add a Lab/RGB A-B setting

Expected effect:

- More perceptual palette assignment.
- Better handling of yellows, greens, off-whites, and grays.
- Closer to Python/reference documentation.

Risk:

- Palette and region counts will shift; needs visual regression across all current lab cases.

### P1 - Render shared borders once instead of stroking every region

Expected effect:

- Removes double/thick internal lines.
- More predictable line weight.
- Potentially smaller SVGs.

Implementation idea:

- Render fills without strokes.
- Build one boundary mask/edge graph from `connected.regionMap`.
- Draw outlines once as global boundary paths or a single raster boundary layer.

### P1 - Make MeanShift or stronger prefilter adaptive by difficulty

Recommended policy:

- Easy: on or medium-strength.
- Medium: on, but tune per image.
- High: off or mild only when artifact score is high.

Artifact score candidates:

- color variance inside local windows,
- number of near-duplicate palette clusters,
- small-component count after first quantization,
- boundary density before merge.

### P2 - Optimize narrow cleanup

Expected effect:

- Largest direct speed win.
- Current cost is ~190-200 ms/image.

Implementation ideas:

- Stop using `settings + 4` unconditionally.
- Track changed pixels and process a dirty neighborhood frontier.
- Reuse counts instead of recomputing every pass.
- Consider 2-3 stronger passes instead of 7-8 full-image passes.

### P2 - Treat requested color count as complexity target, not exact promise

Expected effect:

- Avoids forcing meaningless colors.
- Better UI honesty and better output.

Implementation ideas:

- Show "actual palette colors" clearly.
- Use auto color estimation to choose a lower target when the AI image has fewer dominant colors.
- Preserve broad semantic colors over hitting exact K.

### P2 - Adaptive region merge thresholds

Current suites use `removeFacetsSmallerThanNrOfPoints = 640` for Easy/Medium/High benchmarking. This is easy to compare, but not ideal as a general rule.

Better:

- Easy: high merge threshold.
- Medium: medium threshold.
- High: smaller threshold but cap boundary density / max facets.
- Use relative area plus image complexity, not only fixed pixels.

### P3 - Region-aware quantization / superpixel path

Expected effect:

- Better flat paint regions, fewer JPEG-gradient artifacts.

Risk:

- More complexity and possible detail loss.

Recommended route:

- Start as an optional Easy/Medium path.
- Use mean-shift/SLIC-like oversegmentation.
- Quantize region means weighted by area.
- Preserve small but coherent high-contrast regions.

### P3 - Lazy render/export

Expected effect:

- Faster perceived completion.

Implementation idea:

- Render the selected preview first.
- Generate extra templates only when user opens/exports them.
- Keep `svgPaths` cache between variants.

## Recommended Next Experiment

Run an A-B-C suite across Easy/Medium/High:

1. Current baseline.
2. Lab K-Means only.
3. Lab K-Means + adaptive MeanShift for Easy/Medium.
4. Lab K-Means + single global border renderer.

Success metrics:

- lower or equal small-component count,
- no loss of target details in flower/horse/woodpecker,
- lower boundary density for Easy/Medium,
- equal or lower duration after cleanup optimization,
- no doubled black outlines.
