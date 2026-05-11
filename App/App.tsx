import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ImageBackground,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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
  const [statusMessage, setStatusMessage] = useState('Lokales WebView-Bundle wird vorbereitet...');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      try {
        setStatusMessage('Lokales WebView-Bundle wird vorbereitet...');
        setLoadError(null);
        const localBundle = await ensureLocalWebViewBundle();
        if (!isActive) {
          return;
        }

        setBundleUri(localBundle.indexUri);
        setReadAccessUri(localBundle.rootUri);
        setStatusMessage('WebView wird geladen...');
      } catch (error) {
        if (!isActive) {
          return;
        }

        setLoadError(error instanceof Error ? error.message : 'Das lokale WebView-Bundle konnte nicht vorbereitet werden.');
        setStatusMessage('Die WebView konnte nicht geladen werden.');
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  const shellBadge = useMemo(() => {
    if (loadError != null) {
      return 'Fehler';
    }
    if (!bridgeReady) {
      return 'Startet';
    }
    return 'Bereit';
  }, [bridgeReady, loadError]);

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
      setStatusMessage('Bildauswahl abgebrochen.');
      return;
    }

    const asset = result.assets[0];
    setStatusMessage('Bild fuer die WebView vorbereitet.');
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
    setStatusMessage('Ideenbild wurde erzeugt.');
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

    setStatusMessage('Paint-by-Numbers-Ergebnis bereit.');
    postEvent({
      type: 'runCompleted',
      requestId,
      payload: {
        source: source.source,
        result,
      },
    });
  }

  function handleReload(): void {
    setStatusMessage('WebView wird neu geladen...');
    setLoadError(null);
    webViewRef.current?.reload?.();
  }

  async function handleMessage(rawValue: string): Promise<void> {
    const request = parseBridgeRequest(rawValue);

    if (request.type === 'webAppReady') {
      setBridgeReady(true);
      setStatusMessage('WebView bereit.');
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
        setStatusMessage(message);
        postError(request.requestId, 'pickImage', message);
      }
      return;
    }

    if (request.type === 'generateIdeaImage') {
      try {
        await handleGenerateIdeaImage(request.requestId, request.payload.prompt, request.payload.label);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Das Ideenbild konnte nicht erzeugt werden.';
        setStatusMessage(message);
        postError(request.requestId, 'ideaImage', message);
      }
      return;
    }

    if (request.type === 'runPaintByNumbers') {
      try {
        await handleRunPaintByNumbers(request.requestId, request.payload.sourceToken, request.payload.settings);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Die Paint-by-Numbers-Verarbeitung ist fehlgeschlagen.';
        setStatusMessage(message);
        postError(request.requestId, 'paintByNumbers', message);
      }
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ImageBackground
        source={require('./assets/Background.png')}
        resizeMode="cover"
        imageStyle={styles.backgroundImage}
        style={styles.background}
      >
        <View style={styles.backdrop} />
        <View style={styles.shell}>
          <View style={styles.headerCard}>
            <View style={styles.headerCopy}>
              <Text style={styles.brandLabel}>Happy Lines</Text>
              <Text style={styles.brandTitle}>Sketch & Bloom Studio</Text>
              <Text style={styles.brandText}>{statusMessage}</Text>
              {bundleUri != null ? (
                <Text numberOfLines={1} style={styles.bundlePath}>
                  {bundleUri}
                </Text>
              ) : null}
              {loadError != null ? <Text style={styles.errorText}>{loadError}</Text> : null}
            </View>
            <View style={styles.headerActions}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{shellBadge}</Text>
              </View>
              <Pressable onPress={handleReload} style={styles.reloadButton} disabled={bundleUri == null}>
                <Text style={styles.reloadButtonText}>Neu laden</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.webviewCard}>
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
                onLoadStart={() => {
                  setBridgeReady(false);
                  setStatusMessage('WebView wird geladen...');
                }}
                onLoadEnd={() => {
                  setStatusMessage('WebView gestartet. Warte auf App-Handshake...');
                }}
                onHttpError={(event: any) => {
                  const message = `HTTP ${event.nativeEvent.statusCode}`;
                  setLoadError(message);
                  setStatusMessage(message);
                }}
                onError={(event: any) => {
                  const message = event.nativeEvent.description ?? 'Die lokale WebView konnte nicht geladen werden.';
                  setLoadError(message);
                  setStatusMessage(message);
                }}
                onMessage={(event: any) => {
                  void handleMessage(String(event.nativeEvent.data ?? '')).catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : 'Unbekannter Bridge-Fehler.';
                    setStatusMessage(message);
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
        </View>
      </ImageBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4fafd',
  },
  background: {
    flex: 1,
    backgroundColor: '#f4fafd',
  },
  backgroundImage: {
    opacity: 0.2,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(244, 250, 253, 0.82)',
  },
  shell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 14,
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(215,229,232,0.85)',
  },
  headerCopy: {
    flex: 1,
    gap: 5,
  },
  brandLabel: {
    color: '#4f6d63',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  brandTitle: {
    color: '#16352a',
    fontSize: 24,
    fontWeight: '800',
  },
  brandText: {
    color: '#4f5c60',
    fontSize: 14,
    lineHeight: 20,
  },
  bundlePath: {
    color: '#738589',
    fontSize: 11,
    lineHeight: 16,
  },
  errorText: {
    color: '#b24040',
    fontSize: 13,
    lineHeight: 18,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: 10,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#e9f4ef',
    borderWidth: 1,
    borderColor: '#cae1d8',
  },
  badgeText: {
    color: '#2d6a4f',
    fontSize: 12,
    fontWeight: '800',
  },
  reloadButton: {
    minWidth: 96,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#2d6a4f',
    paddingHorizontal: 16,
    shadowColor: '#2d6a4f',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 3,
  },
  reloadButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  webviewCard: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 32,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(215,229,232,0.92)',
  },
  webview: {
    flex: 1,
    backgroundColor: '#f4fafd',
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
