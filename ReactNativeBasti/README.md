# React Native Basti

Hybrid MVP:

- React Native renders the visible app UI.
- A hidden `react-native-webview` loads a bundled local pipeline bridge.
- The bridge embeds OpenCV.js and the existing `react-app` pipeline code directly in the app bundle.
- Progress and PNG result images are sent back to React Native via `postMessage`.
- No local dev server, LAN URL, or online server is required for the pipeline.

## Development Runtime

Generate the bundled bridge after changing pipeline code:

```bash
npm run build:pipeline-html
```

Then run this app:

```bash
cd ReactNativeBasti
npm run ios -- --device "00008110-00182DEE02F0401E"
```

## MVP Flow

1. Wait for `Pipeline ready`.
2. Tap `Use eagle example` or `Pick image`.
3. Tap `Run pipeline`.
4. Watch native progress update per pipeline stage.
5. Review final templates and intermediate stage images in native UI.
