import { StyleSheet, Text, View } from 'react-native';

import { PIPELINE_STEPS } from '../features/processing/processingProgress';
import type { StepId } from '../features/processing/processingTypes';

type Props = {
  timings: Partial<Record<StepId, number>>;
};

export function DebugTimingsPanel({ timings }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Timings</Text>
      {PIPELINE_STEPS.map((step) => (
        <View key={step.id} style={styles.row}>
          <Text style={styles.label}>{step.label}</Text>
          <Text style={styles.value}>{timings[step.id] != null ? `${timings[step.id]!.toFixed(1)} ms` : '—'}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1b1d22',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    flex: 1,
    fontSize: 14,
    color: '#556070',
  },
  value: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1b1d22',
  },
});
