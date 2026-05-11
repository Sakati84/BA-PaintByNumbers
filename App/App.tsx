import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { generateIdeaImage } from './src/features/ideaGeneration/generateIdeaImage';
import { generatePaintByNumbers } from './src/features/generator/generatePaintByNumbers';
import { ensureLocalWebViewBundle } from './src/features/generator/localWebViewLoader';
import type {
  GeneratorSettings,
  WebImageSource,
  WebViewAppRequest,
  WebViewHostEvent,
} from './src/features/webview/appWebViewBridgeTypes';

const NativeWebView = require('react-native-webview').WebView;

type StoredSource = {
  asset: ImagePicker.ImagePickerAsset;
  source: WebImageSource;
};

type BridgeErrorStage = 'bridge' | 'pickImage' | 'ideaImage' | 'paintByNumbers';

function serializeBridgeEvent(event: WebViewHostEvent): string {
  return JSON.stringify(event);
}

function parseBridgeRequest(rawValue: string): WebViewAppRequest {
  return JSON.parse(rawValue) as WebViewAppRequest;
}

function createSourceToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    throw new Error('Konnte keine WebView-Vorschau fuer das Bild erstellen.');
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
): WebImageSource {
  return {
    sourceToken: token,
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
  const [bundleUri, setBundleUri] = useState<string | null>(null);
  const [readAccessUri, setReadAccessUri] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  ): Promise<void> {
    const token = createSourceToken(kind);
    const preview = await buildPreviewDataUrl(asset);
    const source = createWebImageSource(
      token,
      kind,
      label,
      preview.previewDataUrl,
      asset.width,
      asset.height,
      promptText,
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

  async function handleGenerateIdeaImage(requestId: string, prompt: string, label: string): Promise<void> {
    postEvent({
      type: 'processingProgress',
      requestId,
      payload: {
        phase: 'ideaImage',
        progress: null,
        message: 'Ideenbild wird ueber Gemini erzeugt...',
      },
    });

    const generated = await generateIdeaImage({ prompt, label });
    await registerSource(requestId, 'generated', generated.asset, generated.label, generated.promptText);
  }

  async function handleRunPaintByNumbers(requestId: string, sourceToken: string, settings: GeneratorSettings): Promise<void> {
    const source = sourceStoreRef.current.get(sourceToken);
    if (source == null) {
      throw new Error(`Die angeforderte Bildquelle ${sourceToken} ist in der Shell nicht mehr vorhanden.`);
    }

    postEvent({
      type: 'processingProgress',
      requestId,
      payload: {
        phase: 'paintByNumbers',
        progress: 0,
        message: 'Paint-by-Numbers-Verarbeitung wird gestartet...',
      },
    });

    const result = await generatePaintByNumbers(source.asset, settings, (progress) => {
      postEvent({
        type: 'processingProgress',
        requestId,
        payload: {
          phase: 'paintByNumbers',
          progress: progress.progress,
          message: progress.message,
        },
      });
    });

    postEvent({
      type: 'runCompleted',
      requestId,
      payload: {
        source: source.source,
        result,
      },
    });
  }

  async function handleMessage(rawValue: string): Promise<void> {
    const request = parseBridgeRequest(rawValue);

    if (request.type === 'webAppReady') {
      postEvent({
        type: 'hostReady',
        requestId: request.requestId,
        payload: {
          runnerVersion: '2',
        },
      });
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

    if (request.type === 'generateIdeaImage') {
      try {
        await handleGenerateIdeaImage(request.requestId, request.payload.prompt, request.payload.label);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Das Ideenbild konnte nicht erzeugt werden.';
        postError(request.requestId, 'ideaImage', message);
      }
      return;
    }

    if (request.type === 'runPaintByNumbers') {
      try {
        await handleRunPaintByNumbers(request.requestId, request.payload.sourceToken, request.payload.settings);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Die Paint-by-Numbers-Verarbeitung ist fehlgeschlagen.';
        postError(request.requestId, 'paintByNumbers', message);
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
        <NativeWebView
          ref={webViewRef}
          source={{ uri: bundleUri }}
          originWhitelist={['*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          allowingReadAccessToURL={readAccessUri ?? bundleUri}
          domStorageEnabled
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
});
