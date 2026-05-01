# Project Guidelines

## Repository Split

This repository has three important runtime paths:

- `paint_by_numbers.py`
  Python reference pipeline and batch exporter. Treat this as the highest-fidelity behavioral reference for final outputs and debug artifacts in `output/`.

- `react-app/`
  Browser React + Vite + TypeScript app. This is the interactive web reference implementation for the staged pipeline. Most porting work should compare against `react-app/src/lib/pipeline.ts` and `react-app/src/lib/worker.ts`.

- `react-app-native-expo/`
  Expo + React Native port of the browser pipeline. This app is not a WebView wrapper. It uses native OpenCV bindings through `react-native-fast-opencv` and a typed artifact pipeline instead of a browser worker.

If an agent is working on parity or feature completion, the usual direction is:

1. Read the Python or web implementation.
2. Port the behavior into `react-app-native-expo/`.
3. Preserve the web app unless the task explicitly asks for cross-project changes.

## Source Of Truth

Use these files as the primary references before changing algorithms:

- `react-app/src/lib/pipeline.ts`
- `react-app/src/lib/worker.ts`
- `paint_by_numbers.py`
- `docs/pipeline-uebersicht-de.md`
- `output/step_quantized.png`
- `output/step_strip_cleanup.png`
- `output/step_protrusion_prune.png`
- `output/template_bright_color_circles.png`

Important behavioral note:

- The browser worker UI exposes fewer visible steps than the full parity plan. The full conceptual pipeline still includes strip cleanup between quantization and protrusion pruning.

## Current Project Status

The native app has a real staged processing flow and is no longer just a scaffold.

Implemented in `react-app-native-expo/`:

- normalize / resize
- bilateral smoothing
- quantization with TypeScript MiniBatch K-Means over native OpenCV Lab samples
- strip cleanup
- protrusion pruning
- facet-based region merging
- Python-style bbox-local distance-transform label placement when native OpenCV bindings are available
- bright color circles render
- color circles render
- numbers render
- classic render
- debug unlabeled render
- typed artifact caching between stages in the controller

Still missing or not yet exact:

- `circlesOnly` render template is not ported yet
- normalize still has an open parity note around alpha/transparent pixels flattening to white
- `numbers` and `colorCircles` use a bitmap-digit renderer in native instead of browser Canvas text drawing
- native quantization is intentionally not the same code path as the browser: the web app uses OpenCV K-Means plus oversample-and-merge, while native uses MiniBatch K-Means in TypeScript
- exact placement parity depends on a real native Expo Development Build; fallback mode is approximate if bindings are unavailable
- device-level parity against the browser/Python outputs has not been fully validated end to end

## Architecture

### Web App

`react-app/` uses:

- React UI in `react-app/src/App.tsx`
- browser worker orchestration in `react-app/src/lib/worker.ts`
- OpenCV.js in the worker
- canvas and ImageData based previews

The worker caches intermediate stage outputs and invalidates downstream stages when an earlier stage reruns.

### Native App

`react-app-native-expo/` uses:

- app shell in `react-app-native-expo/src/app/App.tsx`
- step controller in `react-app-native-expo/src/features/processing/processingController.ts`
- per-step execution in `react-app-native-expo/src/features/processing/processImageNative.ts`
- platform-neutral algorithm modules in `react-app-native-expo/src/lib/pipeline/`
- native OpenCV adapter in `react-app-native-expo/src/lib/opencv/opencvNative.ts`

The native app does not use a worker. It carries typed stage artifacts through the controller:

- raw indexed label maps
- compacted palettes
- facet results
- merged regions
- label placements
- render template URIs

## Pipeline Overview

The current native step order is:

1. normalize
2. smooth
3. quantize
4. strip-cleanup
5. protrusions
6. region-merge
7. render

### Step 1: Normalize

Web reference:

- load image into browser canvas
- flatten alpha to white
- resize to configured max edge

Native port:

- image URI is decoded into a native Mat
- resize is performed through native OpenCV
- preview is saved to cache as PNG

Known gap:

- transparent pixel handling still needs exact parity verification

### Step 2: Smooth

Web reference:

- bilateral filter over the normalized RGB image

Native port:

- bilateral filter through `react-native-fast-opencv`
- uses the same tuned constants as the reference path

### Step 3: Quantize

Web reference:

- RGB to Lab
- OpenCV K-Means with oversampling
- greedy center merging back to target color count
- nearest-center reassignment

Native port:

- RGB to Lab via native OpenCV
- samples extracted to typed arrays
- MiniBatch K-Means in TypeScript
- palette converted back with native `COLOR_Lab2RGB`

Important:

- this is parity by intent, not identical implementation

### Step 4: Strip Cleanup

Reference behavior:

- remove narrow one-pixel and cross-like strip artifacts
- compact labels and palette ordering afterward

Native port:

- implemented as an explicit stage in the Expo app
- uses the hard edge Lab-distance guard before replacements

### Step 5: Protrusion Pruning

Reference behavior:

- remove thin protrusions after strip cleanup

Native port:

- typed-array pruning pass with palette-distance guard
- label compaction runs again afterward

### Step 6: Region Merge

Reference behavior:

- facet-based merge of small regions into better neighbors
- preserve strong contrast boundaries except for tiny edge cases

Native port:

- implemented in `react-app-native-expo/src/lib/pipeline/facets.ts`
- outputs merged label map, palette, facets, and region metadata

### Step 7: Label Placement

Reference behavior:

- for each surviving region, build a mask in its bbox
- pad by one pixel
- run `distanceTransform(..., DIST_L2, 5)`
- use the max location as the label anchor

Native port:

- exact placement path is implemented with native OpenCV in `findRegionLabelPointForBBox`
- fallback path uses the earlier typed-array approximation only when native bindings are unavailable

### Step 8: Render Templates

Web reference currently produces:

- brightColorCircles
- colorCircles
- circlesOnly
- numbers
- classic
- debugUnlabeled

Native port currently produces:

- brightColorCircles
- colorCircles
- numbers
- classic
- debugUnlabeled

Still missing:

- circlesOnly

Important rendering note:

- the web app uses Canvas text drawing for numbered templates
- the native app currently uses a bitmap-digit renderer because the current OpenCV wrapper does not expose `putText`

## Agent Rules For Changes

When changing the native port:

1. Treat `react-app/` as the immediate behavioral reference.
2. Treat `paint_by_numbers.py` and `output/` as the final parity reference.
3. Do not silently change algorithm semantics in only one project unless the task explicitly asks for divergence.
4. If you add a new stage, update all of these together:
   - `react-app-native-expo/src/features/processing/processingTypes.ts`
   - `react-app-native-expo/src/features/processing/processingProgress.ts`
   - `react-app-native-expo/src/features/processing/processingController.ts`
   - `react-app-native-expo/src/features/processing/processImageNative.ts`
   - any UI preview ordering in `react-app-native-expo/src/app/App.tsx`
5. If you change render outputs, keep both the primary render preview and the extra template previews aligned.

When changing the web app:

1. Update `react-app/src/lib/pipeline.ts` first.
2. Check whether the worker flow in `react-app/src/lib/worker.ts` also needs to expose that change.
3. If the change affects parity, record the native impact in the Expo port as well.

## Install And Run

There is no root JavaScript package. Do not run npm install from the repository root.

Use either:

- a shell with the subproject as the current working directory
- or npm commands with `--prefix`

### Web App

Install:

- `npm install --prefix ./react-app`

Run dev server:

- `npm run dev --prefix ./react-app`

Typecheck:

- `npm run typecheck --prefix ./react-app`

Build:

- `npm run build --prefix ./react-app`

### Expo Native App

Install:

- change directory into `react-app-native-expo`
- run `npm install`

Typecheck:

- `npm run typecheck`

Important runtime constraint:

- `react-native-fast-opencv` is a native module
- Expo Go is not enough for this app
- use an Expo Development Build

Recommended native workflow:

1. `cd react-app-native-expo`
2. `npm install`
3. `npm run prebuild`
4. install or build a development client
5. `npm run start:dev-client`

Android local development build:

- after prebuild, use `npx expo run:android`
- once the dev client is installed, use `npm run start:dev-client`

iOS development build:

- local iOS builds require macOS for `npx expo run:ios`
- on Windows, use EAS Build or another macOS-based build path for a development client
- this repo currently does not include an `eas.json`, so add or configure EAS deliberately instead of assuming it is already wired

Useful Expo files:

- `react-app-native-expo/app.json`
- `react-app-native-expo/package.json`

## Validation Expectations

When parity work changes the pipeline, compare against these checkpoints:

- Stage 3 parity target: `output/step_quantized.png`
- Stage 4 parity target: `output/step_strip_cleanup.png`
- Stage 5 parity target: `output/step_protrusion_prune.png`
- Stage 8 parity target: `output/template_bright_color_circles.png`

Do not assume a passing typecheck means visual parity is correct. For this repository, pixel or region-level preview comparison matters more than compile success.

## Short Version For Future Agents

- `react-app/` is the web reference implementation.
- `react-app-native-expo/` is the native port target.
- `paint_by_numbers.py` and `output/` are the final parity truth.
- the native core pipeline is mostly ported, but not fully identical yet.
- `circlesOnly`, exact text rendering parity, and final normalize parity are still open items.
- Expo Go is not sufficient; use a Development Build.
- never run npm install at repo root.