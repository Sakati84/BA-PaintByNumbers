# Project Guidelines

## Current Architecture First

Before making architectural, KI/AI, prompt, bridge, pipeline, export, or parity changes, read:

- `docs/technische-architektur-happy-numbers-de.md`

This document is the current high-level technical architecture for the installed Happy Numbers app. Keep it up to date. Whenever a change modifies the app structure, KI call, prompt variants, complexity mapping, generator settings, pipeline stages, output variants, bridge messages, export behavior, or known parity status, update that document in the same change.

## Repository Split

This repository has these important runtime and reference paths:

- `App/`
  Current Expo app used for the installed iPhone build in this checkout. It wraps a locally bundled React web UI from `react-app/` in `react-native-webview` and handles native host capabilities such as image picking, camera, filesystem access, sharing, KI/API calls, and the local generator pipeline.

- `react-app/`
  React + TypeScript UI that is embedded into `App/` as a local WebView bundle. It owns the visible app flow, color-count UI, prompt selection/building, bridge requests, progress display, result screen, and export controls. In a normal browser it can be used for UI preview, but the full flow needs the Expo WebView host.

- `App/src/features/generator/`
  Current local Paint-by-Numbers generator used by the installed app. It prepares images, runs K-Means through vendored generator code, merges redundant palette colors, builds/merges regions, places labels, and renders PNG/SVG variants.

- `App/src/features/imagePosterization/`
  Current KI image-posterization integration. It prepares the upload image, calls Gemini/Nano Banana directly when an API key is present, otherwise calls a configured proxy endpoint, and registers the generated posterized image for the local generator.

- `App/src/vendor/paintbynumbersgenerator/`
  Vendored TypeScript implementation used by the current generator for color reduction, LAB conversion, settings, and supporting data structures.

- `paint_by_numbers.py`
  Python reference pipeline and batch exporter. Treat this as the highest-fidelity behavioral reference for final algorithmic/parity questions and debug artifacts in `output/`.

- `docs/`
  Human-readable project documentation. `docs/technische-architektur-happy-numbers-de.md` is the current architecture document and must be maintained continuously.

- `prompt-lab/`
  Prompt experiments, comparisons, and historical prompt context.

- `pipeline-lab/`
  Pipeline analysis and improvement notes.

## Current Product Flow

The installed app is a React web UI running inside an Expo React Native WebView shell:

1. `App/App.tsx` materializes the generated local WebView bundle.
2. The WebView loads `react-app/dist/index.html` from Expo cache.
3. `react-app/src/ui/App.tsx` sends JSON bridge requests through `window.ReactNativeWebView.postMessage`.
4. `App/App.tsx` handles native requests: pick image, capture image, posterize image with KI, run local generator, persist files, and share/export.
5. The KI-posterized image, not the original photo, is the normal input for the local Paint-by-Numbers generator.

Important bridge files:

- `App/src/features/webview/appWebViewBridgeTypes.ts`
- `react-app/src/lib/webviewBridge.ts`
- `react-app/src/ui/App.tsx`
- `App/App.tsx`

If bridge message shapes change, update both the React UI and Expo shell together.

## Source Of Truth

Use these files as primary references before changing behavior:

- Current architecture: `docs/technische-architektur-happy-numbers-de.md`
- UI and flow: `react-app/src/ui/App.tsx`
- UI settings/complexity: `react-app/src/lib/settings.ts`
- Prompt builder: `react-app/src/lib/promptBuilder.ts`
- Prompt variants: `react-app/src/prompts/paintByNumbersPosterizePrompt.ts`
- Expo shell/bridge handlers: `App/App.tsx`
- KI call: `App/src/features/imagePosterization/posterizeImageWithNanoBanana.ts`
- Gemini request parsing/body: `App/src/features/imagePosterization/geminiImageRequest.ts`
- Generator entry: `App/src/features/generator/generatePaintByNumbers.ts`
- Image preparation: `App/src/features/generator/prepareImage.ts`
- Generator settings: `App/src/features/generator/defaultSettings.ts`
- Palette helpers: `App/src/features/generator/pipelineCore.ts`
- Raster/region/render pipeline: `App/src/features/generator/rasterPaintByNumbers.ts`
- Python reference: `paint_by_numbers.py`
- Reference outputs: `output/`

## Prompt And KI Rules

The current UI derives prompt difficulty from color count:

- 8-11 colors: `simple` UI preset, `easy` prompt variant
- 12-17 colors: `medium` UI preset, `medium` prompt variant
- 18-24 colors: `detailed` UI preset, `expert` prompt variant

The three current prompt variants live in:

- `react-app/src/prompts/paintByNumbersPosterizePrompt.ts`

The final prompt is assembled through:

- `react-app/src/lib/promptBuilder.ts`

The KI call is executed in:

- `App/src/features/imagePosterization/posterizeImageWithNanoBanana.ts`

Model/env behavior:

- model env priority: `EXPO_PUBLIC_NANO_BANANA_MODEL`, then `EXPO_PUBLIC_GEMINI_IMAGE_MODEL`, fallback `gemini-3.1-flash-lite-image`
- API key priority: `EXPO_PUBLIC_NANO_BANANA_API_KEY`, then `EXPO_PUBLIC_GEMINI_API_KEY`
- no API key means proxy mode through `EXPO_PUBLIC_IMAGE_POSTERIZE_ENDPOINT`
- optional seed env priority: `EXPO_PUBLIC_GEMINI_IMAGE_SEED`, then `EXPO_PUBLIC_NANO_BANANA_SEED`

When changing prompts, update:

1. `react-app/src/prompts/paintByNumbersPosterizePrompt.ts`
2. `react-app/src/lib/settings.ts` if complexity/color mapping changes
3. `docs/technische-architektur-happy-numbers-de.md`
4. prompt-lab notes if the change is experimental or comparative

## Current Local Pipeline

The local generator stage order is:

1. `decode`
2. `kmeans`
3. `colorMap`
4. `narrowCleanup`
5. `borderSegment`
6. `facetBuild`
7. `facetReduce`
8. `borderTrace`
9. `labelPlacement`
10. `svgRender`

Current complexity defaults:

- Easy: 8-11 colors, `removeFacetsSmallerThanImageRatio = 0.00012`
- Medium: 12-17 colors, `removeFacetsSmallerThanImageRatio = 0.00006`
- Expert: 18-24 colors, `removeFacetsSmallerThanImageRatio = 0.000025`

Important current behavior:

- `narrowPixelStripCleanupRuns` is currently `0` in UI presets.
- `nrOfTimesToHalveBorderSegments` is currently `0` in UI presets.
- These cleanup stages exist in code but are effectively disabled by the current product settings.
- Region merging of small/thin regions is currently the main local cleanup after K-Means and palette merge.

When changing pipeline semantics, update:

1. `App/src/features/generator/generatorTypes.ts` if stage/result types change
2. `App/src/features/generator/defaultSettings.ts` for setting changes
3. `App/src/features/generator/generatePaintByNumbers.ts` for stage order/progress changes
4. `App/src/features/generator/prepareImage.ts` for decode/resize/alpha behavior
5. `App/src/features/generator/pipelineCore.ts` for palette behavior
6. `App/src/features/generator/rasterPaintByNumbers.ts` for region/render behavior
7. `react-app/src/ui/App.tsx` for UI timing labels, variant display, debug rows, or export controls
8. `docs/technische-architektur-happy-numbers-de.md`

## Render Outputs

Current generated output variants in the app pipeline:

- `brightColorCircles`
- `colorCircles`
- `cleanColor`
- `coloredEdges`
- `coloredEdgesWithDots`
- `circlesOnly`
- `numbers`
- `classic`
- `debugUnlabeled`

The default variant is `brightColorCircles`.

When the source is KI-posterized, the shell also appends comparison variants:

- `inputImage`
- `aiPosterizedImage`

If render outputs change, keep both generator output typing and result UI aligned.

## Build, Sync, Run

There is no root JavaScript package. Do not run `npm install` from the repository root.

Use subproject commands with `--prefix` or change into the subproject directory.

### React WebView UI

Typecheck:

- `npm run typecheck --prefix ./react-app`

Build local WebView files:

- `npm run build:webview-local --prefix ./react-app`

Browser preview for UI/layout:

1. Build local files:
   - `npm run build:webview-local --prefix ./react-app`
2. Serve:
   - `cd react-app/dist`
   - `python3 -m http.server 5177 --bind 127.0.0.1`
3. Open:
   - `http://127.0.0.1:5177/`
4. For iPhone 13 visual checks, use:
   - `390 x 844`

Do not treat browser preview as full native parity. Camera, native sharing, Expo filesystem behavior, KI execution through the shell, and real WebView bridge behavior require the Expo app.

### Expo App

Typecheck:

- `npm run typecheck --prefix ./App`

Run/start:

- `npm run start --prefix ./App`
- `npm run ios --prefix ./App`
- `npm run android --prefix ./App`

After changing `react-app/` and before testing inside the installed Expo app, sync the WebView bundle into `App/`:

- `npm run sync:webview-local --prefix ./App`

This regenerates:

- `App/src/features/generator/localWebViewManifest.generated.ts`

That generated file should not be edited manually.

### Dev Deployment To Phones

Use the Expo app in `App/` for real device tests. Browser preview is only for UI/layout; the full flow needs the native shell.

Before installing on a phone:

1. If `react-app/` changed, sync the WebView bundle:
   - `npm run sync:webview-local --prefix ./App`
2. Run the relevant checks:
   - `npm run typecheck --prefix ./App`
   - `npm run typecheck --prefix ./react-app` when UI or bridge code changed
   - From `App/`: `npx expo config --type public`
   - From `App/`: `npx expo install --check`
3. Do not fix dependency versions, install native packages, or change Expo SDK versions without treating that as a code change.

Android physical device, local install:

1. Install Android Studio, Android SDK/platform-tools, and Java as required by the current Expo SDK.
2. Enable Developer Options and USB debugging on the Android phone.
3. Verify the phone is visible:
   - `adb devices`
4. Install and launch the app:
   - `npm run android --prefix ./App -- --device`
5. If several devices/emulators are connected, keep `--device` and select the target device from the Expo prompt.

Current repository detail: `App/android/` is not checked in. `expo run:android` may generate it locally through Expo prebuild before compiling. `App/.gitignore` ignores `/android`, so treat generated native Android files as local build output unless the user explicitly asks to change native Android configuration.

Android via Expo Go:

- Quick smoke test:
  - `npm run start --prefix ./App`
  - Scan the QR code with Expo Go on Android, or press `A` in the Expo terminal UI for a connected Android target.
- Expo Go uses a fixed native runtime. It is useful for fast smoke checks only when the installed Expo Go SDK includes the native modules used here. Do not treat Expo Go as installed-app parity for camera, file access, sharing, WebView file loading, KI calls, or performance.
- If the flow matters end to end, prefer a local Android install with `npm run android --prefix ./App -- --device` or an APK build.

Android APK for a co-founder or internal tester:

- The current `App/eas.json` has APK output for `development` and `preview`.
- EAS builds require an Expo account and EAS CLI login.
- For a shareable APK that does not require local Android Studio, use EAS from `App/`:
  - `eas build --platform android --profile preview`
- Install from the EAS QR/link on the Android phone, or with `adb install path/to/app.apk`.
- The `development` EAS profile has `developmentClient: true`. If an agent chooses that path and the build requires `expo-dev-client`, add it only after explicit user approval and update the relevant docs.

iPhone local install:

- Use:
  - `npm run ios --prefix ./App`
- A physical iPhone may require Xcode signing/provisioning. For teammate distribution, prefer the existing iOS build path or an EAS/iOS workflow chosen explicitly for that release.

Android smoke-test checklist:

- App starts without a WebView white screen.
- Gallery image pick works after media permission approval.
- Camera capture works after camera permission approval.
- KI posterization succeeds with either configured `EXPO_PUBLIC_NANO_BANANA_API_KEY` / `EXPO_PUBLIC_GEMINI_API_KEY` or `EXPO_PUBLIC_IMAGE_POSTERIZE_ENDPOINT`.
- Local generator reaches `runCompleted` and shows the default `brightColorCircles` variant.
- Export/share works for at least one PNG variant and one SVG path.
- If the source is KI-posterized, comparison variants `inputImage` and `aiPosterizedImage` are present.

Known Android risk areas:

- Dependency drift: `npx expo install --check` must be clean before blaming Android-specific behavior.
- Android SDK/ADB setup: without `adb` in PATH or an authorized device, local install cannot be verified.
- Expo Go parity: Expo Go can mask installed-build differences because it is not this app's own native binary.
- WebView local files: if Android shows a blank UI, inspect `App/App.tsx` WebView errors and local bundle materialization before changing React UI code.
- Permissions: Android photo/camera permission states can persist after denial; reset app permissions or reinstall before retesting.
- Sharing/export: Android share targets and URI handling differ from iOS, so validate PNG and SVG exports on a real device.
- Performance: lower-end Android devices may expose memory or runtime issues in KI image handling and the local generator that do not appear on iPhone or desktop preview.

## Validation Expectations

For documentation-only changes:

- Check the diff for stale architecture statements.

For UI changes:

- Run `npm run typecheck --prefix ./react-app`.
- Build `npm run build:webview-local --prefix ./react-app` when WebView bundle behavior is affected.
- Use browser preview for layout, responsive checks, and text overflow.
- Sync into `App/` before device testing.

For App/shell/pipeline changes:

- Run `npm run typecheck --prefix ./App`.
- If React bridge types or UI are affected, also run `npm run typecheck --prefix ./react-app`.
- For pipeline changes, compare visual output against relevant references in `output/` or create/inspect pipeline-lab artifacts.

Do not assume a passing typecheck means visual parity is correct. For this project, pixel-level, region-level, and human visual checks are often more important than compile success.

## Agent Rules For Changes

1. Read `docs/technische-architektur-happy-numbers-de.md` before non-trivial changes.
2. Keep that document current as the project evolves.
3. Preserve the separation between `react-app/` UI and `App/` native host unless the task explicitly changes the architecture.
4. Do not silently change algorithm semantics in only one layer when another layer depends on it.
5. If a change affects KI prompt behavior, update prompt docs and architecture docs.
6. If a change affects bridge messages, update both sender and receiver types/handlers.
7. If a change affects output variants, update generator types, render code, result UI, export behavior, and docs together.
8. Treat `paint_by_numbers.py` and `output/` as algorithmic/parity references, not as the current installed-app runtime.
9. Never run npm install at repository root.

## Short Version For Future Agents

- The installed app is `App/`: Expo shell plus local React WebView.
- The visible UI is `react-app/`.
- The KI posterization call runs in `App/src/features/imagePosterization/`.
- The local generator runs in `App/src/features/generator/`.
- Prompt variants live in `react-app/src/prompts/paintByNumbersPosterizePrompt.ts`.
- Complexity is driven by color count: 8-11 Easy, 12-17 Medium, 18-24 Expert.
- The main current architecture doc is `docs/technische-architektur-happy-numbers-de.md`.
- Update that doc whenever architecture, KI, prompts, pipeline, complexity, bridge, or exports change.
