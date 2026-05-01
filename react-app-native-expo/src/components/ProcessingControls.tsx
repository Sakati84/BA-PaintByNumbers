import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { PIPELINE_STEPS } from '../features/processing/processingProgress';
import type { NativePipelineSettings, StepId } from '../features/processing/processingTypes';

type Props = {
  settings: NativePipelineSettings;
  busy: boolean;
  hasImage: boolean;
  onPickImage: () => void;
  onRunAll: () => void;
  onRunStep: (stepId: StepId) => void;
  onUpdateSettings: (next: NativePipelineSettings) => void;
};

export function ProcessingControls({
  settings,
  busy,
  hasImage,
  onPickImage,
  onRunAll,
  onRunStep,
  onUpdateSettings,
}: Props) {
  const updateNumber = (key: keyof NativePipelineSettings, fallback: number, min: number, max?: number) => (value: string) => {
    const raw = Number(value);
    const normalized = Number.isFinite(raw) ? Math.max(min, max != null ? Math.min(max, raw) : raw) : fallback;
    onUpdateSettings({ ...settings, [key]: normalized });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Controls</Text>

      <Pressable style={styles.primaryButton} onPress={onPickImage} disabled={busy}>
        <Text style={styles.primaryButtonText}>Pick Image</Text>
      </Pressable>

      <View style={styles.fieldGroup}>
        <Field label="Resize max" value={String(settings.resizeMax)} onChangeText={updateNumber('resizeMax', 1200, 64)} />
        <Field label="K-Means color count" value={String(settings.targetColorCount)} onChangeText={updateNumber('targetColorCount', 24, 1, 64)} />
        <Field label="Min region size" value={String(settings.minRegionSize)} onChangeText={updateNumber('minRegionSize', 200, 1)} />
        <Field label="Prune radius" value={String(settings.pruneRadius)} onChangeText={updateNumber('pruneRadius', 1, 0, 5)} />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Protect high contrast</Text>
          <Switch
            value={settings.protectHighContrast}
            onValueChange={(value) => onUpdateSettings({ ...settings, protectHighContrast: value })}
          />
        </View>
        {settings.protectHighContrast ? (
          <Field
            label="High-contrast min px"
            value={String(settings.highContrastMinPx)}
            onChangeText={updateNumber('highContrastMinPx', 20, 1)}
          />
        ) : null}
      </View>

      <Pressable style={[styles.secondaryButton, (!hasImage || busy) && styles.buttonDisabled]} onPress={onRunAll} disabled={!hasImage || busy}>
        <Text style={styles.secondaryButtonText}>Run All</Text>
      </Pressable>

      <View style={styles.stepList}>
        {PIPELINE_STEPS.map((step) => (
          <Pressable
            key={step.id}
            style={[styles.stepButton, (!hasImage || busy) && styles.buttonDisabled]}
            onPress={() => onRunStep(step.id)}
            disabled={!hasImage || busy}
          >
            <Text style={styles.stepButtonText}>{step.label}</Text>
            <Text style={styles.stepButtonHint}>{step.description}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
};

function Field({ label, value, onChangeText }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType="numeric"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1b1d22',
  },
  fieldGroup: {
    gap: 10,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#556070',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d7dde7',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1b1d22',
    backgroundColor: '#f8fafc',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1b1d22',
  },
  primaryButton: {
    borderRadius: 14,
    backgroundColor: '#1b1d22',
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 14,
    backgroundColor: '#3e7bfa',
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  stepList: {
    gap: 10,
  },
  stepButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d7dde7',
    padding: 12,
    gap: 4,
    backgroundColor: '#f8fafc',
  },
  stepButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1b1d22',
  },
  stepButtonHint: {
    fontSize: 12,
    lineHeight: 16,
    color: '#556070',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
