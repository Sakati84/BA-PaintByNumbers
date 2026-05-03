import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageSourcePropType,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  HiddenPipelineWebView,
  type HiddenPipelineWebViewHandle,
} from "../features/pipeline/HiddenPipelineWebView";
import type {
  PipelineBridgeEvent,
  PipelineFinalResult,
  PipelineImageSource,
  PipelineOptions,
  PipelineProgress,
  PipelineStepResult,
} from "../features/pipeline/PipelineTypes";
import { EAGLE_BASE64 } from "../features/pipeline/generated/eagleBase64";
import { PIPELINE_HTML } from "../features/pipeline/generated/pipelineHtml";

const EAGLE_SOURCE = require("../../assets/eagle.png");

type SelectedImage = {
  label: string;
  previewSource: ImageSourcePropType;
  pipelineSource: PipelineImageSource;
};

const DEFAULT_OPTIONS: PipelineOptions = {
  resizeMax: 1200,
  colorCount: 24,
  minRegionSize: 200,
  protectHighContrast: false,
  highContrastMinPx: 20,
  pruneRadius: 1,
};

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTiming(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

export default function App() {
  const pipelineRef = useRef<HiddenPipelineWebViewHandle>(null);
  const pendingRunRef = useRef<{ requestId: string; options: PipelineOptions } | null>(null);
  const [pipelineUri, setPipelineUri] = useState<string | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState("Preparing local pipeline");
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [options, setOptions] = useState<PipelineOptions>(DEFAULT_OPTIONS);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [stepResults, setStepResults] = useState<PipelineStepResult[]>([]);
  const [finalResult, setFinalResult] = useState<PipelineFinalResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function preparePipelineFile(): Promise<void> {
      try {
        const pipelineFile = new FileSystem.File(FileSystem.Paths.cache, "paint-pipeline.html");
        pipelineFile.create({ overwrite: true, intermediates: true });
        pipelineFile.write(PIPELINE_HTML);
        if (!cancelled) {
          setPipelineUri(pipelineFile.uri);
          setBridgeStatus("Opening local WebView file");
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void preparePipelineFile();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pipelineUri || bridgeReady) {
      return;
    }

    const timeout = setTimeout(() => {
      setErrorMessage(
        "The hidden WebView did not report ready within 45 seconds. OpenCV may have failed to initialize.",
      );
    }, 45000);

    return () => clearTimeout(timeout);
  }, [bridgeReady, pipelineUri]);

  function updateNumericOption(key: keyof PipelineOptions, value: string): void {
    const parsed = Number(value);
    setOptions((current) => ({
      ...current,
      [key]: Number.isFinite(parsed) ? parsed : current[key],
    }));
  }

  function handleBridgeEvent(event: PipelineBridgeEvent): void {
    if (event.type === "READY") {
      setBridgeReady(true);
      setBridgeStatus("Pipeline ready");
      setErrorMessage(null);
      return;
    }

    if (event.type === "STATUS") {
      setBridgeStatus(event.message);
      return;
    }

    if (event.type === "PROGRESS") {
      setProgress({
        stepId: event.stepId,
        stepIndex: event.stepIndex,
        stepCount: event.stepCount,
        message: event.message,
        progress: event.progress,
      });
      return;
    }

    if (event.type === "IMAGE_LOADED") {
      const pendingRun = pendingRunRef.current;
      if (pendingRun && pendingRun.requestId === event.requestId) {
        pendingRunRef.current = null;
        pipelineRef.current?.runAll(pendingRun.requestId, pendingRun.options);
      }
      return;
    }

    if (event.type === "STEP_RESULT") {
      setStepResults((current) => [
        ...current.filter((item) => item.stepId !== event.stepId),
        {
          stepId: event.stepId,
          label: event.label,
          imageUrl: event.imageUrl,
          width: event.width,
          height: event.height,
          timingMs: event.timingMs,
        },
      ]);
      return;
    }

    if (event.type === "FINAL_RESULT") {
      setFinalResult({
        templates: event.templates,
        intermediateResults: event.intermediateResults,
        stats: event.stats,
        timings: event.timings,
      });
      setIsRunning(false);
      return;
    }

    if (event.type === "ERROR") {
      setErrorMessage(event.message);
      setIsRunning(false);
    }
  }

  async function handlePickImage(): Promise<void> {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 1,
      selectionLimit: 1,
    });

    if (picked.canceled || picked.assets.length === 0) {
      return;
    }

    const asset = picked.assets[0];
    const base64 = await new FileSystem.File(asset.uri).base64();
    setSelectedImage({
      label: asset.fileName ?? "Selected image",
      previewSource: { uri: asset.uri },
      pipelineSource: {
        kind: "base64",
        base64,
        mimeType: asset.mimeType ?? "image/jpeg",
      },
    });
    resetResults();
  }

  function handleUseEagle(): void {
    setSelectedImage({
      label: "eagle.png",
      previewSource: EAGLE_SOURCE,
      pipelineSource: {
        kind: "base64",
        base64: EAGLE_BASE64,
        mimeType: "image/png",
      },
    });
    resetResults();
  }

  function resetResults(): void {
    setProgress(null);
    setStepResults([]);
    setFinalResult(null);
    setErrorMessage(null);
  }

  function handleRun(): void {
    if (!bridgeReady) {
      Alert.alert("Pipeline not ready", "The hidden WebView pipeline is still loading.");
      return;
    }
    if (!selectedImage) {
      Alert.alert("No image selected", "Pick an image or use the eagle example first.");
      return;
    }

    resetResults();
    setIsRunning(true);
    const requestId = createRequestId("pipeline");
    pendingRunRef.current = { requestId, options };
    pipelineRef.current?.loadImage(requestId, selectedImage.pipelineSource);
  }

  const progressPercent = progress?.progress ?? 0;

  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar style="dark" />
      <HiddenPipelineWebView ref={pipelineRef} sourceUri={pipelineUri} onEvent={handleBridgeEvent} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>React Native Basti</Text>
          <Text style={styles.title}>Native UI, hidden WebView pipeline</Text>
          <Text style={styles.subtitle}>
            The visible app is React Native. The expensive OpenCV pipeline runs in a hidden WebView and returns progress plus result images.
          </Text>
          <View style={[styles.statusPill, bridgeReady ? styles.statusReady : styles.statusLoading]}>
            <Text style={styles.statusText}>
              {bridgeReady ? "Pipeline ready" : pipelineUri ? bridgeStatus : "Preparing local pipeline"}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Source image</Text>
          <View style={styles.actions}>
            <Pressable style={styles.primaryButton} onPress={handleUseEagle} disabled={isRunning}>
              <Text style={styles.primaryButtonText}>Use eagle example</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={handlePickImage} disabled={isRunning}>
              <Text style={styles.secondaryButtonText}>Pick image</Text>
            </Pressable>
          </View>
          <View style={styles.previewFrame}>
            {selectedImage ? (
              <Image source={selectedImage.previewSource} style={styles.previewImage} resizeMode="contain" />
            ) : (
              <Text style={styles.placeholder}>Choose an image to start.</Text>
            )}
          </View>
          {selectedImage ? <Text style={styles.metaText}>{selectedImage.label}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Settings</Text>
          <SettingInput label="Resize max" value={String(options.resizeMax)} onChangeText={(value) => updateNumericOption("resizeMax", value)} />
          <SettingInput label="Color count" value={String(options.colorCount)} onChangeText={(value) => updateNumericOption("colorCount", value)} />
          <SettingInput label="Min region size" value={String(options.minRegionSize)} onChangeText={(value) => updateNumericOption("minRegionSize", value)} />
          <SettingInput label="High contrast min px" value={String(options.highContrastMinPx)} onChangeText={(value) => updateNumericOption("highContrastMinPx", value)} />
          <SettingInput label="Prune radius" value={String(options.pruneRadius)} onChangeText={(value) => updateNumericOption("pruneRadius", value)} />
          <View style={styles.switchRow}>
            <Text style={styles.settingLabel}>Protect high contrast regions</Text>
            <Switch
              value={options.protectHighContrast}
              onValueChange={(value) => setOptions((current) => ({ ...current, protectHighContrast: value }))}
            />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.runHeader}>
            <Text style={styles.cardTitle}>Progress</Text>
            <Pressable
              style={[styles.primaryButton, (!bridgeReady || !selectedImage || isRunning) && styles.disabledButton]}
              onPress={handleRun}
              disabled={!bridgeReady || !selectedImage || isRunning}
            >
              <Text style={styles.primaryButtonText}>{isRunning ? "Running..." : "Run pipeline"}</Text>
            </Pressable>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {progress ? `${progress.message} (${progress.stepIndex}/${progress.stepCount})` : "Waiting for a pipeline run."}
          </Text>
          {isRunning ? <ActivityIndicator color="#135c44" /> : null}
          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        </View>

        {finalResult ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Final templates</Text>
            <Text style={styles.metaText}>
              {finalResult.stats.regionCount} regions, {finalResult.stats.placementCount} labels
            </Text>
            {finalResult.templates.map((template) => (
              <ResultImage key={template.id} label={template.label} imageUrl={template.imageUrl} />
            ))}
          </View>
        ) : null}

        {stepResults.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Intermediate steps</Text>
            {stepResults.map((result) => (
              <ResultImage
                key={result.stepId}
                label={`${result.label} - ${formatTiming(result.timingMs)}`}
                imageUrl={result.imageUrl}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

type SettingInputProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
};

function SettingInput({ label, value, onChangeText }: SettingInputProps) {
  return (
    <View style={styles.settingField}>
      <Text style={styles.settingLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="numeric"
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

type ResultImageProps = {
  label: string;
  imageUrl: string;
};

function ResultImage({ label, imageUrl }: ResultImageProps) {
  return (
    <View style={styles.resultBlock}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Image source={{ uri: imageUrl }} style={styles.resultImage} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#f3efe5",
  },
  content: {
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 40,
  },
  hero: {
    gap: 12,
    borderRadius: 8,
    backgroundColor: "#173f31",
    padding: 18,
  },
  eyebrow: {
    color: "#b6ecd8",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: "#f7f4ed",
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 32,
  },
  subtitle: {
    color: "#d7ebdf",
    fontSize: 15,
    lineHeight: 22,
  },
  statusPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusReady: {
    backgroundColor: "#d1f1ae",
  },
  statusLoading: {
    backgroundColor: "#f4d49b",
  },
  statusText: {
    color: "#12372b",
    fontWeight: "800",
  },
  card: {
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2d7c4",
    backgroundColor: "#fffaf2",
    padding: 16,
  },
  cardTitle: {
    color: "#1f1f1c",
    fontSize: 22,
    fontWeight: "900",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryButton: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#d1f1ae",
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: "#0f3d2e",
    fontSize: 15,
    fontWeight: "900",
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#173f31",
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: "#f7f4ed",
    fontSize: 15,
    fontWeight: "900",
  },
  disabledButton: {
    opacity: 0.45,
  },
  previewFrame: {
    height: 240,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2d7c4",
    backgroundColor: "#f4ecdd",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  placeholder: {
    color: "#706a5f",
    fontSize: 15,
  },
  metaText: {
    color: "#5a564c",
    fontSize: 14,
    lineHeight: 20,
  },
  settingField: {
    gap: 6,
  },
  settingLabel: {
    color: "#272620",
    fontSize: 15,
    fontWeight: "800",
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: "#d9cfbc",
    borderRadius: 8,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    color: "#24211d",
    fontSize: 16,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  runHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  progressTrack: {
    height: 12,
    overflow: "hidden",
    borderRadius: 999,
    backgroundColor: "#e6e1d5",
  },
  progressBar: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#2a8c69",
  },
  progressText: {
    color: "#5d6057",
    fontSize: 15,
    lineHeight: 22,
  },
  errorText: {
    color: "#a12d2d",
    fontSize: 14,
    fontWeight: "700",
  },
  resultBlock: {
    gap: 8,
  },
  resultLabel: {
    color: "#272620",
    fontSize: 15,
    fontWeight: "900",
  },
  resultImage: {
    width: "100%",
    height: 280,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2d7c4",
    backgroundColor: "#fff",
  },
});
