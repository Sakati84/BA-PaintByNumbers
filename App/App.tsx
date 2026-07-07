import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { Directory, File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { generatePaintByNumbers } from '../pipeline_new/src/generatePaintByNumbersNew';
import type { GeneratorPipelineDebugCache } from '../pipeline_new/src/generatePaintByNumbersNew';
import { ensureLocalWebViewBundle } from './src/features/generator/localWebViewLoader';
import { posterizeImageWithNanoBanana } from './src/features/imagePosterization/posterizeImageWithNanoBanana';
import type {
  GeneratorDebugStageSnapshot,
  GeneratorSettings,
  GeneratorStage,
  WebImageSource,
  WebViewAppRequest,
  WebViewHostEvent,
} from './src/features/webview/appWebViewBridgeTypes';
import type { GeneratorOutputVariant, GeneratorResult } from './src/features/generator/generatorTypes';

const NativeWebView = require('react-native-webview').WebView;

const WEBVIEW_ERROR_BRIDGE = `
(() => {
  const sendError = (message) => {
    try {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'webRuntimeError',
        requestId: 'web-runtime',
        payload: { message: String(message || 'Unbekannter WebView-Fehler.') }
      }));
    } catch (_) {}
  };
  window.addEventListener('error', (event) => {
    sendError(event.message || (event.error && event.error.message));
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    sendError(reason && reason.message ? reason.message : reason);
  });
})();
true;
`;

type StoredSource = {
  asset: ImagePicker.ImagePickerAsset;
  source: WebImageSource;
};

type BridgeErrorStage = 'bridge' | 'pickImage' | 'captureImage' | 'posterizeImage' | 'paintByNumbers' | 'shareResult';

function serializeBridgeEvent(event: WebViewHostEvent): string {
  return JSON.stringify(event);
}

function parseBridgeRequest(rawValue: string): WebViewAppRequest {
  return JSON.parse(rawValue) as WebViewAppRequest;
}

function createSourceToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createResultFileName(): string {
  return `happy-numbers-malvorlage-${Date.now()}.svg`;
}

function createPreviewFileName(): string {
  return `happy-numbers-vorschau-${Date.now()}.png`;
}

function createVariantFileName(variantId: string, extension = 'png'): string {
  return `happy-numbers-${variantId}-${Date.now()}.${extension}`;
}

function createVariantSvgFileName(fileName?: string): string {
  if (fileName != null && fileName.length > 0) {
    return fileName.toLowerCase().endsWith('.svg') ? fileName : fileName.replace(/\.[^.]+$/, '') + '.svg';
  }
  return `happy-numbers-svg-${Date.now()}.svg`;
}

function createEmbeddedPngSvg(pngBase64: string, width: number, height: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<image href="data:image/png;base64,${pngBase64}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />`,
    '</svg>',
  ].join('');
}

async function buildPreviewDataUrl(asset: ImagePicker.ImagePickerAsset): Promise<{ previewDataUrl: string; width: number; height: number }> {
  const preview = await manipulateAsync(
    asset.uri,
    asset.width > 1200 || asset.height > 1200
      ? [
          {
            resize:
              asset.width >= asset.height
                ? { width: 1200 }
                : { height: 1200 },
          },
        ]
      : [],
    {
      base64: true,
      compress: 0.9,
      format: SaveFormat.JPEG,
    },
  );

  if (preview.base64 == null) {
    throw new Error('Konnte keine WebView-Vorschau für das Bild erstellen.');
  }

  return {
    previewDataUrl: `data:image/jpeg;base64,${preview.base64}`,
    width: preview.width,
    height: preview.height,
  };
}

function createWebImageSource(
  token: string,
  kind: WebImageSource['kind'],
  label: string,
  previewDataUrl: string,
  width: number,
  height: number,
  promptText?: string,
  parentSourceToken?: string,
): WebImageSource {
  return {
    sourceToken: token,
    parentSourceToken,
    kind,
    label,
    previewDataUrl,
    width,
    height,
    promptText,
  };
}

export default function App() {
  const webViewRef = useRef<any>(null);
  const sourceStoreRef = useRef<Map<string, StoredSource>>(new Map());
  const debugCacheStoreRef = useRef<Map<string, GeneratorPipelineDebugCache>>(new Map());
  const [bundleUri, setBundleUri] = useState<string | null>(null);
  const [readAccessUri, setReadAccessUri] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [webViewReady, setWebViewReady] = useState(false);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      try {
        setLoadError(null);
        const localBundle = await ensureLocalWebViewBundle();
        if (!isActive) {
          return;
        }

        setBundleUri(localBundle.indexUri);
        setReadAccessUri(localBundle.rootUri);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setLoadError(error instanceof Error ? error.message : 'Das lokale WebView-Bundle konnte nicht vorbereitet werden.');
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (bundleUri == null || webViewReady || loadError != null) {
      return;
    }

    const timer = setTimeout(() => {
      setLoadError('Die lokale WebView-App hat nicht geantwortet. Bitte neu bauen oder Logs prüfen.');
    }, 5000);

    return () => clearTimeout(timer);
  }, [bundleUri, loadError, webViewReady]);

  function postEvent(event: WebViewHostEvent): void {
    const serialized = serializeBridgeEvent(event);
    webViewRef.current?.postMessage?.(serialized);
  }

  function postError(requestId: string, stage: BridgeErrorStage, message: string): void {
    postEvent({
      type: 'error',
      requestId,
      error: {
        stage,
        message,
      },
    });
  }

  async function registerSource(
    requestId: string,
    kind: WebImageSource['kind'],
    asset: ImagePicker.ImagePickerAsset,
    label: string,
    promptText?: string,
    previewOverride?: { previewDataUrl: string; width: number; height: number },
    parentSourceToken?: string,
  ): Promise<void> {
    const token = createSourceToken(kind);
    const preview = previewOverride ?? (await buildPreviewDataUrl(asset));
    const source = createWebImageSource(
      token,
      kind,
      label,
      preview.previewDataUrl,
      asset.width,
      asset.height,
      promptText,
      parentSourceToken,
    );

    sourceStoreRef.current.set(token, {
      asset,
      source,
    });

    postEvent({
      type: 'sourceReady',
      requestId,
      payload: source,
    });
  }

  async function handlePickImage(requestId: string): Promise<void> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Bitte erlaube den Zugriff auf deine Fotos, um ein Bild auszuwählen.');
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    await registerSource(requestId, 'uploaded', asset, asset.fileName ?? 'Hochgeladenes Bild');
  }

  async function handleCaptureImage(requestId: string): Promise<void> {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Bitte erlaube den Kamerazugriff, um direkt ein Foto aufzunehmen.');
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    await registerSource(requestId, 'uploaded', asset, asset.fileName ?? 'Aufgenommenes Foto');
  }

  async function handlePosterizeUploadedImage(
    requestId: string,
    sourceToken: string,
    complexity: string,
    colorCount: number,
    prompt: string,
  ): Promise<void> {
    const source = sourceStoreRef.current.get(sourceToken);
    if (source == null) {
      throw new Error(`Die angeforderte Bildquelle ${sourceToken} ist in der Shell nicht mehr vorhanden.`);
    }

    postEvent({
      type: 'processingProgress',
      requestId,
      payload: {
        phase: 'posterizeImage',
        progress: null,
        message: `Bild wird mit ${colorCount} Farben per KI vorbereitet...`,
      },
    });

    const posterized = await posterizeImageWithNanoBanana({
      asset: source.asset,
      prompt,
      colorCount,
      complexity,
    });

    await registerSource(
      requestId,
      'posterized',
      posterized.asset,
      posterized.label,
      posterized.promptText,
      {
        previewDataUrl: posterized.previewDataUrl,
        width: posterized.asset.width,
        height: posterized.asset.height,
      },
      sourceToken,
    );
  }

  async function handleRunPaintByNumbers(
    requestId: string,
    sourceToken: string,
    settings: GeneratorSettings,
    debugMode = false,
    debugStartStage?: GeneratorStage,
  ): Promise<void> {
    const source = sourceStoreRef.current.get(sourceToken);
    if (source == null) {
      throw new Error(`Die angeforderte Bildquelle ${sourceToken} ist in der Shell nicht mehr vorhanden.`);
    }
    const originalSource =
      source.source.parentSourceToken != null ? sourceStoreRef.current.get(source.source.parentSourceToken) : undefined;

    postEvent({
      type: 'processingProgress',
      requestId,
      payload: {
        phase: 'paintByNumbers',
        progress: 0,
        message: 'Paint-by-Numbers-Verarbeitung wird gestartet...',
      },
    });

    let updatedDebugCache: GeneratorPipelineDebugCache | undefined;
    let lastRunProgress = 0;
    const postStageSnapshot = debugMode
      ? (preview: GeneratorDebugStageSnapshot) => {
          postEvent({
            type: 'processingProgress',
            requestId,
            payload: {
              phase: 'paintByNumbers',
              progress: lastRunProgress,
              message: `${preview.label}: ${preview.description}`,
              preview,
            },
          });
        }
      : undefined;

    const generatedResult = await generatePaintByNumbers(source.asset, settings, (progress) => {
      lastRunProgress = progress.progress;
      postEvent({
        type: 'processingProgress',
        requestId,
        payload: {
          phase: 'paintByNumbers',
          progress: progress.progress,
          message: progress.message,
        },
      });
    }, {
      onStageSnapshot: postStageSnapshot,
      variantIds: debugMode ? ['classic'] : undefined,
      debug: debugMode
        ? {
            enabled: true,
            rerunFromStage: debugStartStage,
            cache: debugCacheStoreRef.current.get(sourceToken),
            onCacheUpdated: (cache) => {
              updatedDebugCache = cache;
            },
          }
        : undefined,
    });
    if (debugMode && updatedDebugCache != null) {
      debugCacheStoreRef.current.set(sourceToken, updatedDebugCache);
    }
    const resultWithComparisons = debugMode
      ? generatedResult
      : await appendComparisonVariants(generatedResult, originalSource, source);
    const result = persistResultAssets(resultWithComparisons);

    postEvent({
      type: 'runCompleted',
      requestId,
      payload: {
        source: source.source,
        result,
      },
    });
  }

  async function createAssetComparisonVariant(
    id: 'inputImage' | 'aiPosterizedImage',
    label: string,
    description: string,
    asset: ImagePicker.ImagePickerAsset,
  ): Promise<GeneratorOutputVariant> {
    const rendered = await manipulateAsync(
      asset.uri,
      [],
      {
        base64: true,
        compress: 1,
        format: SaveFormat.PNG,
      },
    );

    if (rendered.base64 == null) {
      throw new Error(`${label} konnte nicht als Vergleichsbild vorbereitet werden.`);
    }

    return {
      id,
      label,
      description,
      pngBase64: rendered.base64,
      pngWidth: rendered.width,
      pngHeight: rendered.height,
      pngByteLength: Math.ceil((rendered.base64.length * 3) / 4),
    };
  }

  async function appendComparisonVariants(
    result: GeneratorResult,
    originalSource: StoredSource | undefined,
    aiSource: StoredSource,
  ): Promise<GeneratorResult> {
    const comparisonVariants: GeneratorOutputVariant[] = [];

    if (originalSource != null) {
      comparisonVariants.push(
        await createAssetComparisonVariant(
          'inputImage',
          'Originalbild',
          'Vollständiges Eingabebild vor der KI-Vereinfachung.',
          originalSource.asset,
        ),
      );
    }

    if (aiSource.source.kind === 'posterized') {
      comparisonVariants.push(
        await createAssetComparisonVariant(
          'aiPosterizedImage',
          'KI-Bild',
          'Von der KI vereinfachtes Bild vor der lokalen Flächenreduktion.',
          aiSource.asset,
        ),
      );
    }

    if (comparisonVariants.length === 0) {
      return result;
    }

    return {
      ...result,
      variants: [...(result.variants ?? []), ...comparisonVariants],
    };
  }

  function persistResultAssets(result: GeneratorResult): GeneratorResult {
    if (readAccessUri == null) {
      return result;
    }

    const outputDirectory = new Directory(readAccessUri, 'generated');
    outputDirectory.create({ idempotent: true, intermediates: true });

    const fileName = createResultFileName();
    const outputFile = new File(outputDirectory, fileName);
    outputFile.create({ intermediates: true, overwrite: true });
    outputFile.write(result.svg);

    let previewPngUri: string | undefined;
    let previewPngFileName: string | undefined;
    const variants = result.variants?.map((variant) => {
      let pngUri = variant.pngUri;
      let pngFileName = variant.pngFileName;
      let pngByteLength = variant.pngByteLength;
      if (variant.pngBase64 != null && variant.pngBase64.length > 0) {
        pngFileName = createVariantFileName(variant.id, 'png');
        const variantFile = new File(outputDirectory, pngFileName);
        variantFile.create({ intermediates: true, overwrite: true });
        variantFile.write(variant.pngBase64, { encoding: 'base64' });
        pngUri = variantFile.uri;
        pngByteLength = Math.ceil((variant.pngBase64.length * 3) / 4);
      }

      let svgUri = variant.svgUri;
      let svgFileName = variant.svgFileName;
      let svgByteLength = variant.svgByteLength;
      if (variant.svg != null && variant.svg.length > 0) {
        svgFileName = createVariantFileName(variant.id, 'svg');
        const variantSvgFile = new File(outputDirectory, svgFileName);
        variantSvgFile.create({ intermediates: true, overwrite: true });
        variantSvgFile.write(variant.svg);
        svgUri = variantSvgFile.uri;
        svgByteLength = variant.svg.length;
      }

      if (variant.isDefault) {
        previewPngUri = pngUri;
        previewPngFileName = pngFileName;
      }

      return {
        ...variant,
        pngBase64: undefined,
        svg: undefined,
        pngUri,
        pngFileName,
        pngByteLength,
        svgUri,
        svgFileName,
        svgByteLength,
      };
    });

    if (previewPngUri == null && result.previewPngBase64 != null && result.previewPngBase64.length > 0) {
      previewPngFileName = createPreviewFileName();
      const previewFile = new File(outputDirectory, previewPngFileName);
      previewFile.create({ intermediates: true, overwrite: true });
      previewFile.write(result.previewPngBase64, { encoding: 'base64' });
      previewPngUri = previewFile.uri;
    }

    if (previewPngUri == null && variants != null && variants.length > 0) {
      previewPngUri = variants[0].pngUri;
      previewPngFileName = variants[0].pngFileName;
    }

    return {
      ...result,
      svg: '',
      previewPngBase64: undefined,
      variants,
      svgUri: outputFile.uri,
      svgFileName: fileName,
      svgByteLength: result.svg.length,
      previewPngUri,
      previewPngFileName,
      previewPngByteLength:
        result.previewPngBase64 != null && result.previewPngBase64.length > 0
          ? Math.ceil((result.previewPngBase64.length * 3) / 4)
          : undefined,
    };
  }

  async function handleShareResultFile(
    requestId: string,
    uri: string,
    fileName?: string,
    mimeType?: string,
    uti?: string,
  ): Promise<void> {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      throw new Error('Teilen oder Speichern ist auf diesem Gerät nicht verfügbar.');
    }

    await Sharing.shareAsync(uri, {
      mimeType: mimeType ?? 'image/png',
      UTI: uti ?? 'public.png',
      dialogTitle: fileName ?? 'Happy Numbers Malvorlage',
    });

    postEvent({
      type: 'shareCompleted',
      requestId,
      payload: {
        message: 'Export geöffnet.',
      },
    });
  }

  async function handleShareResultSvgFromPng(
    requestId: string,
    pngUri: string,
    width: number,
    height: number,
    fileName?: string,
  ): Promise<void> {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      throw new Error('Teilen oder Speichern ist auf diesem Gerät nicht verfügbar.');
    }

    const pngFile = new File(pngUri);
    const pngBase64 = await pngFile.base64();
    const outputFile = new File(pngFile.parentDirectory, createVariantSvgFileName(fileName));
    outputFile.create({ intermediates: true, overwrite: true });
    outputFile.write(createEmbeddedPngSvg(pngBase64, width, height));

    await Sharing.shareAsync(outputFile.uri, {
      mimeType: 'image/svg+xml',
      UTI: 'public.svg-image',
      dialogTitle: outputFile.name,
    });

    postEvent({
      type: 'shareCompleted',
      requestId,
      payload: {
        message: 'SVG-Export geöffnet.',
      },
    });
  }

  async function handleShareResultSvg(requestId: string, svgUri: string, fileName?: string): Promise<void> {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      throw new Error('Teilen oder Speichern ist auf diesem Gerät nicht verfügbar.');
    }

    await Sharing.shareAsync(svgUri, {
      mimeType: 'image/svg+xml',
      UTI: 'public.svg-image',
      dialogTitle: fileName ?? 'Happy Numbers Malvorlage',
    });

    postEvent({
      type: 'shareCompleted',
      requestId,
      payload: {
        message: 'Export geöffnet.',
      },
    });
  }

  async function handleMessage(rawValue: string): Promise<void> {
    const request = parseBridgeRequest(rawValue);

    if (request.type === 'webAppReady') {
      setWebViewReady(true);
      setLoadError(null);
      postEvent({
        type: 'hostReady',
        requestId: request.requestId,
        payload: {
          runnerVersion: '2',
        },
      });
      return;
    }

    if (request.type === 'webRuntimeError') {
      setLoadError(request.payload.message);
      return;
    }

    if (request.type === 'pickImage') {
      try {
        await handlePickImage(request.requestId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Die Bildauswahl ist fehlgeschlagen.';
        postError(request.requestId, 'pickImage', message);
      }
      return;
    }

    if (request.type === 'captureImage') {
      try {
        await handleCaptureImage(request.requestId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Die Kameraaufnahme ist fehlgeschlagen.';
        postError(request.requestId, 'captureImage', message);
      }
      return;
    }

    if (request.type === 'posterizeUploadedImage') {
      try {
        await handlePosterizeUploadedImage(
          request.requestId,
          request.payload.sourceToken,
          request.payload.complexity,
          request.payload.colorCount,
          request.payload.prompt,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Das Bild konnte nicht posterisiert werden.';
        postError(request.requestId, 'posterizeImage', message);
      }
      return;
    }

    if (request.type === 'runPaintByNumbers') {
      try {
        await handleRunPaintByNumbers(
          request.requestId,
          request.payload.sourceToken,
          request.payload.settings,
          request.payload.debugMode === true,
          request.payload.debugStartStage,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Die Paint-by-Numbers-Verarbeitung ist fehlgeschlagen.';
        postError(request.requestId, 'paintByNumbers', message);
      }
      return;
    }

    if (request.type === 'shareResultSvg') {
      try {
        await handleShareResultSvg(request.requestId, request.payload.svgUri, request.payload.fileName);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Die Malvorlage konnte nicht exportiert werden.';
        postError(request.requestId, 'shareResult', message);
      }
      return;
    }

    if (request.type === 'shareResultFile') {
      try {
        await handleShareResultFile(
          request.requestId,
          request.payload.uri,
          request.payload.fileName,
          request.payload.mimeType,
          request.payload.uti,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Die Malvorlage konnte nicht exportiert werden.';
        postError(request.requestId, 'shareResult', message);
      }
      return;
    }

    if (request.type === 'shareResultSvgFromPng') {
      try {
        await handleShareResultSvgFromPng(
          request.requestId,
          request.payload.pngUri,
          request.payload.width,
          request.payload.height,
          request.payload.fileName,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Die SVG-Datei konnte nicht exportiert werden.';
        postError(request.requestId, 'shareResult', message);
      }
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" translucent backgroundColor="transparent" />
      {bundleUri == null ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color="#2d6a4f" size="large" />
          <Text style={styles.loadingText}>{loadError ?? 'Die lokale React-App wird vorbereitet...'}</Text>
        </View>
      ) : (
        <>
          <NativeWebView
            ref={webViewRef}
            source={{ uri: bundleUri }}
            originWhitelist={['*']}
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            allowingReadAccessToURL={readAccessUri ?? bundleUri}
            domStorageEnabled
            injectedJavaScriptBeforeContentLoaded={WEBVIEW_ERROR_BRIDGE}
            javaScriptEnabled
            nestedScrollEnabled
            overScrollMode="always"
            scrollEnabled
            bounces={false}
            onHttpError={(event: any) => {
              const message = `HTTP ${event.nativeEvent.statusCode}`;
              setLoadError(message);
            }}
            onError={(event: any) => {
              const message = event.nativeEvent.description ?? 'Die lokale WebView konnte nicht geladen werden.';
              setLoadError(message);
            }}
            onMessage={(event: any) => {
              void handleMessage(String(event.nativeEvent.data ?? '')).catch((error: unknown) => {
                const message = error instanceof Error ? error.message : 'Unbekannter Bridge-Fehler.';
                postError('bridge', 'bridge', message);
              });
            }}
            renderLoading={() => (
              <View style={styles.loadingState}>
                <ActivityIndicator color="#2d6a4f" size="large" />
                <Text style={styles.loadingText}>Die lokale React-App wird geladen...</Text>
              </View>
            )}
            startInLoadingState
            style={styles.webview}
          />
          {loadError != null ? (
            <View style={styles.errorOverlay}>
              <Text style={styles.errorTitle}>Startfehler</Text>
              <Text style={styles.loadingText}>{loadError}</Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webview: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
    backgroundColor: '#f9fcfc',
  },
  loadingText: {
    color: '#4f5c60',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
    backgroundColor: '#f9fcfc',
  },
  errorTitle: {
    color: '#c65252',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
});
