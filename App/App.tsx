import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ensureLocalWebViewBundle } from './src/features/generator/localWebViewLoader';

const NativeWebView = require('react-native-webview').WebView;

function MobileWebViewShell() {
  const webViewRef = useRef<any>(null);
  const [bundleUri, setBundleUri] = useState<string | null>(null);
  const [readAccessUri, setReadAccessUri] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Preparing local WebView bundle...');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      try {
        setStatusMessage('Preparing local WebView bundle...');
        setLoadError(null);
        const localBundle = await ensureLocalWebViewBundle();
        if (!isActive) {
          return;
        }

        setBundleUri(localBundle.indexUri);
        setReadAccessUri(localBundle.rootUri);
        setStatusMessage('Loading local WebView...');
      } catch (error) {
        if (!isActive) {
          return;
        }

        setLoadError(error instanceof Error ? error.message : 'Failed to prepare local WebView bundle.');
        setStatusMessage('Local WebView failed to prepare.');
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  function handleReload(): void {
    setStatusMessage('Reloading local WebView...');
    webViewRef.current?.reload();
  }

  return (
    <SafeAreaView style={styles.appShell}>
      <StatusBar style="dark" />
      <View style={styles.nativeShell}>
        <View style={styles.localShellHeader}>
          <View style={styles.localShellCopy}>
            <Text style={styles.localShellLabel}>Local WebView Bundle</Text>
            <Text style={styles.localShellStatus}>{statusMessage}</Text>
            {bundleUri != null ? (
              <Text numberOfLines={1} style={styles.localShellPath}>
                {bundleUri}
              </Text>
            ) : null}
            {loadError != null ? <Text style={styles.localShellError}>{loadError}</Text> : null}
          </View>
          <Pressable onPress={handleReload} style={styles.toolbarButton} disabled={bundleUri == null}>
            <Text style={styles.toolbarButtonText}>Reload</Text>
          </Pressable>
        </View>
        <View style={styles.webviewCard}>
          {bundleUri == null ? (
            <View style={styles.webviewLoading}>
              <ActivityIndicator color="#135c44" />
              <Text style={styles.settingHint}>{loadError ?? 'Preparing local generator...'}</Text>
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
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
              onLoadStart={() => {
                setStatusMessage('Loading local WebView...');
              }}
              onLoadEnd={() => {
                setStatusMessage('Local WebView loaded.');
              }}
              onHttpError={(event: any) => {
                setStatusMessage(`HTTP ${event.nativeEvent.statusCode}`);
              }}
              onError={(event: any) => {
                const message = event.nativeEvent.description ?? 'Failed to load local WebView';
                setLoadError(message);
                setStatusMessage(message);
              }}
              renderLoading={() => (
                <View style={styles.webviewLoading}>
                  <ActivityIndicator color="#135c44" />
                  <Text style={styles.settingHint}>Loading local generator...</Text>
                </View>
              )}
              style={styles.webview}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return <MobileWebViewShell />;
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    backgroundColor: '#f3efe5',
  },
  nativeShell: {
    flex: 1,
    padding: 0,
  },
  localShellHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: '#f3efe5',
    borderBottomWidth: 1,
    borderBottomColor: '#d9cfbc',
  },
  localShellCopy: {
    flex: 1,
    gap: 4,
  },
  localShellLabel: {
    color: '#605e55',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  localShellStatus: {
    color: '#1f1f1c',
    fontSize: 15,
    fontWeight: '700',
  },
  localShellPath: {
    color: '#5d6057',
    fontSize: 12,
    lineHeight: 18,
  },
  localShellError: {
    color: '#8b2f25',
    fontSize: 13,
    lineHeight: 18,
  },
  toolbarButton: {
    minWidth: 48,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#d1f1ae',
    paddingHorizontal: 10,
  },
  toolbarButtonText: {
    color: '#0f3d2e',
    fontSize: 13,
    fontWeight: '800',
  },
  webviewCard: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  webview: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webviewLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#fffaf2',
  },
  settingHint: {
    color: '#6b675b',
    fontSize: 14,
    lineHeight: 20,
  },
});
