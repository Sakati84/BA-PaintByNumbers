import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { getExpoGoProjectConfig } from 'expo/src/environment/ExpoGo';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import type {
  GeneratorProgress,
  GeneratorResult,
  GeneratorSettings,
  GeneratorStage,
} from './src/features/generator/generatorTypes';

const NativeWebView = Platform.OS === 'web' ? null : require('react-native-webview').WebView;
const DEFAULT_WEB_SERVER_URL = 'http://192.168.178.186:5175/';

type NumericSettingKey = Exclude<keyof GeneratorSettings, 'removeFacetsFromLargeToSmall'>;

type SettingsDraft = Record<NumericSettingKey, string> & {
  removeFacetsFromLargeToSmall: boolean;
};

type PickedImage = ImagePicker.ImagePickerAsset;

const STAGE_LABELS: Record<GeneratorStage, string> = {
  decode: 'Decode',
  kmeans: 'K-Means',
  colorMap: 'Color Map',
  facetBuild: 'Facet Build',
  narrowCleanup: 'Narrow Cleanup',
  facetReduce: 'Facet Reduce',
  borderTrace: 'Border Trace',
  borderSegment: 'Border Segment',
  labelPlacement: 'Label Placement',
  svgRender: 'SVG Render',
  done: 'Done',
};

const SETTING_FIELDS: Array<{
  key: NumericSettingKey;
  label: string;
  keyboardType?: 'default' | 'numeric';
}> = [
  { key: 'kMeansNrOfClusters', label: 'K-Means clusters', keyboardType: 'numeric' },
  { key: 'kMeansMinDeltaDifference', label: 'K-Means min delta', keyboardType: 'numeric' },
  { key: 'narrowPixelStripCleanupRuns', label: 'Strip cleanup runs', keyboardType: 'numeric' },
  { key: 'removeFacetsSmallerThanNrOfPoints', label: 'Min facet size', keyboardType: 'numeric' },
  { key: 'maximumNumberOfFacets', label: 'Max facets', keyboardType: 'numeric' },
  { key: 'nrOfTimesToHalveBorderSegments', label: 'Border halving runs', keyboardType: 'numeric' },
  { key: 'resizeImageWidth', label: 'Resize width', keyboardType: 'numeric' },
  { key: 'resizeImageHeight', label: 'Resize height', keyboardType: 'numeric' },
  { key: 'randomSeed', label: 'Random seed', keyboardType: 'numeric' },
];

function createDraftFromSettings(settings: GeneratorSettings): SettingsDraft {
  return {
    kMeansNrOfClusters: String(settings.kMeansNrOfClusters),
    kMeansMinDeltaDifference: String(settings.kMeansMinDeltaDifference),
    narrowPixelStripCleanupRuns: String(settings.narrowPixelStripCleanupRuns),
    removeFacetsSmallerThanNrOfPoints: String(settings.removeFacetsSmallerThanNrOfPoints),
    maximumNumberOfFacets: String(settings.maximumNumberOfFacets),
    nrOfTimesToHalveBorderSegments: String(settings.nrOfTimesToHalveBorderSegments),
    resizeImageWidth: String(settings.resizeImageWidth),
    resizeImageHeight: String(settings.resizeImageHeight),
    randomSeed: String(settings.randomSeed),
    removeFacetsFromLargeToSmall: settings.removeFacetsFromLargeToSmall,
  };
}

function clampInt(value: number, fallback: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function clampFloat(value: number, fallback: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeSettingsDraft(draft: SettingsDraft, defaults: GeneratorSettings): GeneratorSettings {
  return {
    kMeansNrOfClusters: clampInt(Number(draft.kMeansNrOfClusters), defaults.kMeansNrOfClusters, 2, 128),
    kMeansMinDeltaDifference: clampFloat(Number(draft.kMeansMinDeltaDifference), defaults.kMeansMinDeltaDifference, 0.01, 1000),
    narrowPixelStripCleanupRuns: clampInt(Number(draft.narrowPixelStripCleanupRuns), defaults.narrowPixelStripCleanupRuns, 0, 20),
    removeFacetsSmallerThanNrOfPoints: clampInt(
      Number(draft.removeFacetsSmallerThanNrOfPoints),
      defaults.removeFacetsSmallerThanNrOfPoints,
      1,
      100000,
    ),
    removeFacetsFromLargeToSmall: draft.removeFacetsFromLargeToSmall,
    maximumNumberOfFacets: clampInt(Number(draft.maximumNumberOfFacets), defaults.maximumNumberOfFacets, 0, 100000),
    nrOfTimesToHalveBorderSegments: clampInt(
      Number(draft.nrOfTimesToHalveBorderSegments),
      defaults.nrOfTimesToHalveBorderSegments,
      0,
      10,
    ),
    resizeImageWidth: clampInt(Number(draft.resizeImageWidth), defaults.resizeImageWidth, 32, 4096),
    resizeImageHeight: clampInt(Number(draft.resizeImageHeight), defaults.resizeImageHeight, 32, 4096),
    randomSeed: clampInt(Number(draft.randomSeed), defaults.randomSeed, 0, 2147483647),
  };
}

function formatDuration(ms?: number): string {
  if (ms == null) {
    return '0 ms';
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${ms.toFixed(1)} ms`;
}

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function getDefaultGeneratorWebUrl(): string {
  const hostUri = getExpoGoProjectConfig()?.debuggerHost ?? null;
  if (hostUri == null || hostUri.length === 0) {
    return DEFAULT_WEB_SERVER_URL;
  }

  const normalized = hostUri.replace(/^https?:\/\//, '');
  const slashIndex = normalized.indexOf('/');
  const withoutPath = slashIndex >= 0 ? normalized.slice(0, slashIndex) : normalized;
  const colonIndex = withoutPath.lastIndexOf(':');
  const host = colonIndex >= 0 ? withoutPath.slice(0, colonIndex) : withoutPath;
  return `http://${host}:5175/`;
}

function MobileWebViewShell() {
  const webViewRef = useRef<any>(null);
  const [webUrl, setWebUrl] = useState(() => getDefaultGeneratorWebUrl());
  const [draftUrl, setDraftUrl] = useState(() => getDefaultGeneratorWebUrl());
  const [isUrlBarExpanded, setIsUrlBarExpanded] = useState(true);
  const [statusMessage, setStatusMessage] = useState('Loading WebView...');

  function normalizeUrl(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return webUrl;
    }
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  }

  function handleLoadUrl(): void {
    const nextUrl = normalizeUrl(draftUrl);
    setWebUrl(nextUrl);
    setDraftUrl(nextUrl);
    setIsUrlBarExpanded(true);
    setStatusMessage('Loading WebView...');
  }

  function handleReload(): void {
    setIsUrlBarExpanded(true);
    setStatusMessage('Loading WebView...');
    webViewRef.current?.reload();
  }

  return (
    <SafeAreaView style={styles.appShell}>
      <StatusBar style="dark" />
      <View style={styles.nativeShell}>
        <View style={isUrlBarExpanded ? styles.webviewToolbarExpanded : styles.webviewToolbarCollapsed}>
          {isUrlBarExpanded ? (
            <>
              <Text style={styles.toolbarLabel}>{statusMessage}</Text>
              <View style={styles.toolbarControls}>
                <TextInput
                  value={draftUrl}
                  onChangeText={setDraftUrl}
                  style={styles.toolbarInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="go"
                  onSubmitEditing={handleLoadUrl}
                />
                <Pressable onPress={handleLoadUrl} style={styles.toolbarButton}>
                  <Text style={styles.toolbarButtonText}>Go</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.collapsedToolbarRow}>
              <Text numberOfLines={1} style={styles.collapsedUrl}>{webUrl}</Text>
              <Pressable onPress={() => setIsUrlBarExpanded(true)} style={styles.toolbarButton}>
                <Text style={styles.toolbarButtonText}>Edit</Text>
              </Pressable>
              <Pressable onPress={handleReload} style={styles.toolbarButton}>
                <Text style={styles.toolbarButtonText}>Reload</Text>
              </Pressable>
            </View>
          )}
        </View>
        <View style={styles.webviewCard}>
          {NativeWebView == null ? null : (
            <NativeWebView
              ref={webViewRef}
              source={{ uri: webUrl }}
              originWhitelist={['*']}
              allowFileAccess
              allowingReadAccessToURL={webUrl}
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
              onLoadStart={() => {
                setIsUrlBarExpanded(true);
                setStatusMessage('Loading WebView...');
              }}
              onLoadEnd={() => {
                setStatusMessage('Loaded');
                setIsUrlBarExpanded(false);
              }}
              onHttpError={(event: any) => {
                setStatusMessage(`HTTP ${event.nativeEvent.statusCode}`);
                setIsUrlBarExpanded(true);
              }}
              onError={(event: any) => {
                setStatusMessage(event.nativeEvent.description ?? 'Failed to load WebView');
                setIsUrlBarExpanded(true);
              }}
              renderLoading={() => (
                <View style={styles.webviewLoading}>
                  <ActivityIndicator color="#135c44" />
                  <Text style={styles.settingHint}>Loading browser generator...</Text>
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

function WebGeneratorApp() {
  const { SvgXml } = require('react-native-svg') as typeof import('react-native-svg');
  const { DEFAULT_GENERATOR_SETTINGS } = require('./src/features/generator/defaultSettings') as typeof import('./src/features/generator/defaultSettings');
  const { generatePaintByNumbers } = require('./src/features/generator/generatePaintByNumbers') as typeof import('./src/features/generator/generatePaintByNumbers');
  const { width: screenWidth } = useWindowDimensions();
  const [selectedImage, setSelectedImage] = useState<PickedImage | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>(() => createDraftFromSettings(DEFAULT_GENERATOR_SETTINGS));
  const [progress, setProgress] = useState<GeneratorProgress | null>(null);
  const [result, setResult] = useState<GeneratorResult | null>(null);
  const [runningSettings, setRunningSettings] = useState<GeneratorSettings | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const previewWidth = Math.max(240, screenWidth - 48);
  const svgPreviewHeight =
    result == null ? 240 : Math.max(240, Math.round((previewWidth * result.svgHeight) / Math.max(1, result.svgWidth)));

  async function handlePickImage(): Promise<void> {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: false,
      selectionLimit: 1,
    });

    if (picked.canceled || picked.assets.length === 0) {
      return;
    }

    setSelectedImage(picked.assets[0]);
    setResult(null);
    setProgress(null);
  }

  function handleNumericSettingChange(key: NumericSettingKey, value: string): void {
    setSettingsDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleGenerate(): Promise<void> {
    if (selectedImage == null) {
      Alert.alert('No image selected', 'Pick an image first so the generator has something to process.');
      return;
    }

    const normalizedSettings = normalizeSettingsDraft(settingsDraft, DEFAULT_GENERATOR_SETTINGS);
    setSettingsDraft(createDraftFromSettings(normalizedSettings));
    setRunningSettings(normalizedSettings);
    setIsGenerating(true);
    setProgress({
      stage: 'decode',
      progress: 0,
      message: 'Preparing image...',
    });
    setResult(null);

    try {
      const nextResult = await generatePaintByNumbers(selectedImage, normalizedSettings, (nextProgress) => {
        setProgress(nextProgress);
      });
      setResult(nextResult);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown generator error.';
      Alert.alert('Generation failed', message);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <View style={styles.appShell}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>Expo Go MVP</Text>
          <Text style={styles.title}>Paint by Numbers SVG Generator</Text>
          <Text style={styles.subtitle}>
            This app runs the vendored `paintbynumbersgenerator` pipeline in pure JavaScript so it can load in Expo Go without a custom dev build.
          </Text>
          <View style={styles.heroActions}>
            <Pressable onPress={handlePickImage} style={[styles.primaryButton, isGenerating && styles.buttonDisabled]}>
              <Text style={styles.primaryButtonText}>{selectedImage == null ? 'Pick image' : 'Pick another image'}</Text>
            </Pressable>
            <Pressable
              onPress={handleGenerate}
              disabled={selectedImage == null || isGenerating}
              style={[styles.secondaryButton, (selectedImage == null || isGenerating) && styles.buttonDisabled]}
            >
              <Text style={styles.secondaryButtonText}>{isGenerating ? 'Generating...' : 'Generate SVG'}</Text>
            </Pressable>
          </View>
        </View>

        {selectedImage != null ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Selected Image</Text>
            <Image source={{ uri: selectedImage.uri }} style={styles.selectedImage} resizeMode="contain" />
            <Text style={styles.metaText}>
              {selectedImage.fileName ?? 'Picked image'} · {selectedImage.width}x{selectedImage.height}
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Settings</Text>
          <Text style={styles.sectionHint}>
            The defaults come from the original `paintbynumbersgenerator` settings, with a fixed `randomSeed=0` for reproducible runs.
          </Text>
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.settingLabel}>Reduce facets from large to small</Text>
              <Text style={styles.settingHint}>Matches the reference reducer strategy.</Text>
            </View>
            <Switch
              value={settingsDraft.removeFacetsFromLargeToSmall}
              onValueChange={(value) =>
                setSettingsDraft((current) => ({
                  ...current,
                  removeFacetsFromLargeToSmall: value,
                }))
              }
            />
          </View>
          <View style={styles.settingsGrid}>
            {SETTING_FIELDS.map((field) => (
              <View key={field.key} style={styles.settingField}>
                <Text style={styles.settingLabel}>{field.label}</Text>
                <TextInput
                  value={settingsDraft[field.key]}
                  onChangeText={(value) => handleNumericSettingChange(field.key, value)}
                  style={styles.input}
                  keyboardType={field.keyboardType ?? 'default'}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Progress</Text>
          {progress == null ? (
            <Text style={styles.sectionHint}>Pick an image and start the generator to see stage updates.</Text>
          ) : (
            <>
              <View style={styles.progressHeader}>
                <Text style={styles.progressStage}>{STAGE_LABELS[progress.stage]}</Text>
                <Text style={styles.progressPercent}>{progress.progress}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressBar, { width: `${progress.progress}%` }]} />
              </View>
              <Text style={styles.progressMessage}>{progress.message}</Text>
              {isGenerating ? <ActivityIndicator color="#135c44" style={styles.spinner} /> : null}
            </>
          )}
        </View>

        {result != null ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>SVG Preview</Text>
              <Text style={styles.metaText}>
                {result.imageWidth}x{result.imageHeight} source · {result.svgWidth}x{result.svgHeight} SVG · {result.facetCount} surviving facets
              </Text>
              <View style={styles.svgFrame}>
                <SvgXml xml={result.svg} width={previewWidth} height={svgPreviewHeight} />
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Timings</Text>
              {Object.entries(result.timings).map(([stage, duration]) => (
                <View key={stage} style={styles.metricRow}>
                  <Text style={styles.metricLabel}>{STAGE_LABELS[stage as GeneratorStage] ?? stage}</Text>
                  <Text style={styles.metricValue}>{formatDuration(duration)}</Text>
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Palette</Text>
              {result.palette.map((entry) => (
                <View key={entry.index} style={styles.paletteRow}>
                  <View
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: `rgb(${entry.color[0]}, ${entry.color[1]}, ${entry.color[2]})`,
                      },
                    ]}
                  />
                  <View style={styles.paletteCopy}>
                    <Text style={styles.metricLabel}>Color {entry.index}</Text>
                    <Text style={styles.settingHint}>
                      rgb({entry.color[0]}, {entry.color[1]}, {entry.color[2]}) · {entry.frequency} px · {formatPercentage(entry.areaPercentage)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Run Details</Text>
              <Text style={styles.settingHint}>Prepared image URI: {result.preparedImage.imageUri}</Text>
              <Text style={styles.settingHint}>
                Prepared image: {result.preparedImage.width}x{result.preparedImage.height}
              </Text>
              {runningSettings != null ? (
                <Text style={styles.settingHint}>
                  Active settings: {runningSettings.kMeansNrOfClusters} clusters, min facet {runningSettings.removeFacetsSmallerThanNrOfPoints}, resize {runningSettings.resizeImageWidth}x{runningSettings.resizeImageHeight}, seed {runningSettings.randomSeed}
                </Text>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default function App() {
  if (Platform.OS !== 'web') {
    return <MobileWebViewShell />;
  }

  return <WebGeneratorApp />;
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    backgroundColor: '#f3efe5',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 40,
    gap: 16,
  },
  nativeShell: {
    flex: 1,
    padding: 0,
  },
  webviewToolbarExpanded: {
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: '#f3efe5',
    borderBottomWidth: 1,
    borderBottomColor: '#d9cfbc',
  },
  webviewToolbarCollapsed: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#f3efe5',
    borderBottomWidth: 1,
    borderBottomColor: '#d9cfbc',
  },
  toolbarLabel: {
    color: '#605e55',
    fontSize: 12,
    fontWeight: '700',
  },
  toolbarControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolbarInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: '#d9cfbc',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    color: '#24211d',
    fontSize: 14,
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
  collapsedToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  collapsedUrl: {
    flex: 1,
    color: '#35332d',
    fontSize: 13,
    fontWeight: '600',
  },
  heroCard: {
    backgroundColor: '#0f3d2e',
    borderRadius: 28,
    padding: 22,
    gap: 12,
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
  eyebrow: {
    color: '#b6ecd8',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f7f4ed',
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 34,
  },
  subtitle: {
    color: '#d7ebdf',
    fontSize: 16,
    lineHeight: 24,
  },
  heroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: '#d1f1ae',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#0f3d2e',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#f7f4ed',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#18362c',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  card: {
    backgroundColor: '#fffaf2',
    borderRadius: 24,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: '#e7decd',
  },
  cardTitle: {
    color: '#1f1f1c',
    fontSize: 24,
    fontWeight: '800',
  },
  sectionHint: {
    color: '#605e55',
    fontSize: 15,
    lineHeight: 22,
  },
  selectedImage: {
    width: '100%',
    height: 220,
    borderRadius: 18,
    backgroundColor: '#ebe4d6',
  },
  metaText: {
    color: '#5a564c',
    fontSize: 14,
    lineHeight: 20,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderRadius: 18,
    backgroundColor: '#f4ecdd',
    padding: 14,
  },
  switchCopy: {
    flex: 1,
    gap: 4,
  },
  settingsGrid: {
    gap: 12,
  },
  settingField: {
    gap: 6,
  },
  settingLabel: {
    color: '#272620',
    fontSize: 15,
    fontWeight: '700',
  },
  settingHint: {
    color: '#6b675b',
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d9cfbc',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#24211d',
    fontSize: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressStage: {
    color: '#1d2c28',
    fontSize: 17,
    fontWeight: '700',
  },
  progressPercent: {
    color: '#135c44',
    fontSize: 17,
    fontWeight: '800',
  },
  progressTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: '#e6e1d5',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#2a8c69',
  },
  progressMessage: {
    color: '#5d6057',
    fontSize: 15,
    lineHeight: 22,
  },
  spinner: {
    marginTop: 4,
  },
  svgFrame: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e9e1d1',
    paddingVertical: 12,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  metricLabel: {
    color: '#26251f',
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  metricValue: {
    color: '#0f3d2e',
    fontSize: 15,
    fontWeight: '800',
  },
  paletteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dad2c3',
  },
  paletteCopy: {
    flex: 1,
    gap: 2,
  },
});
