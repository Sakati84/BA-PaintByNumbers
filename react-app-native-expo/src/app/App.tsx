import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DebugTimingsPanel } from '../components/DebugTimingsPanel';
import { ImagePreview } from '../components/ImagePreview';
import { ProcessingControls } from '../components/ProcessingControls';
import { ProgressPanel } from '../components/ProgressPanel';
import { ResultPreview } from '../components/ResultPreview';
import { pickImageFromLibrary } from '../features/image-picker/pickImage';
import { createInitialControllerState, runAllPipelineSteps, runPipelineStep } from '../features/processing/processingController';
import {
  DEFAULT_PIPELINE_SETTINGS,
  type NativePipelineSettings,
  type ProcessingProgress,
  type RenderTemplatePreview,
  type StepId,
} from '../features/processing/processingTypes';

export default function NativeApp() {
  const [settings, setSettings] = useState<NativePipelineSettings>(DEFAULT_PIPELINE_SETTINGS);
  const [controllerState, setControllerState] = useState(createInitialControllerState());
  const [progress, setProgress] = useState<ProcessingProgress>({
    step: 'idle',
    progress: 0,
    message: 'Pick an image to begin the Expo migration shell.',
  });
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const latestPreview = useMemo(() => {
    const orderedSteps: StepId[] = ['render', 'region-merge', 'protrusions', 'strip-cleanup', 'quantize', 'smooth', 'normalize'];
    for (const stepId of orderedSteps) {
      const preview = controllerState.results[stepId];
      if (preview) {
        return preview;
      }
    }
    return null;
  }, [controllerState.results]);

  const renderTemplates = useMemo<RenderTemplatePreview[]>(() => {
    return controllerState.results.render?.templates ?? [];
  }, [controllerState.results.render]);

  const pickImage = async () => {
    try {
      setErrorMessage(null);
      const asset = await pickImageFromLibrary();
      if (!asset) {
        return;
      }
      setControllerState(createInitialControllerState(asset));
      setProgress({
        step: 'idle',
        progress: 0,
        message: `Loaded ${asset.fileName ?? 'image'} (${asset.width}x${asset.height}).`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pick image.';
      setErrorMessage(message);
      Alert.alert('Image picker error', message);
    }
  };

  const runStep = async (stepId: StepId) => {
    try {
      setBusy(true);
      setErrorMessage(null);
      const { state } = await runPipelineStep({
        state: controllerState,
        stepId,
        settings,
        onProgress: setProgress,
      });
      setControllerState(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pipeline step failed.';
      setErrorMessage(message);
      setProgress({ step: 'idle', progress: 0, message: 'Pipeline halted.' });
    } finally {
      setBusy(false);
    }
  };

  const runAll = async () => {
    try {
      setBusy(true);
      setErrorMessage(null);
      const nextState = await runAllPipelineSteps({
        state: controllerState,
        settings,
        onProgress: setProgress,
      });
      setControllerState(nextState);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pipeline run failed.';
      setErrorMessage(message);
      setProgress({ step: 'idle', progress: 0, message: 'Pipeline halted.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>React Native / Expo migration</Text>
          <Text style={styles.title}>Paint by Numbers Native Shell</Text>
          <Text style={styles.subtitle}>
            This is the first implementation pass in react-app-native-expo. The app now has a real Expo structure,
            image picking, step orchestration, timings, and the native adapter boundaries for the OpenCV migration.
          </Text>
        </View>

        <ProcessingControls
          settings={settings}
          busy={busy}
          hasImage={controllerState.sourceImage != null}
          onPickImage={pickImage}
          onRunAll={runAll}
          onRunStep={runStep}
          onUpdateSettings={setSettings}
        />

        <ProgressPanel progress={progress} errorMessage={errorMessage} />

        {controllerState.sourceImage ? (
          <ImagePreview
            title="Source Image"
            uri={controllerState.sourceImage.uri}
            width={controllerState.sourceImage.width}
            height={controllerState.sourceImage.height}
            note="Native image selection is live. Pixel-buffer normalization and OpenCV-backed processing are the next migration targets."
          />
        ) : null}

        {latestPreview ? (
          <ImagePreview
            title={`Latest Preview: ${latestPreview.stepId}`}
            uri={latestPreview.imageUri}
            width={latestPreview.width}
            height={latestPreview.height}
            note={latestPreview.note}
          />
        ) : null}

        {renderTemplates.map((template) => (
          <ImagePreview
            key={template.id}
            title={`Render Template: ${template.label}`}
            uri={template.imageUri}
            width={controllerState.results.render?.width ?? 0}
            height={controllerState.results.render?.height ?? 0}
            note="Additional render parity output from the native template stage."
          />
        ))}

        <ResultPreview results={controllerState.results} />
        <DebugTimingsPanel timings={controllerState.timings} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f2f5f9',
  },
  content: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  hero: {
    gap: 8,
    paddingTop: 12,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: '#3e7bfa',
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#101828',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#556070',
  },
});
