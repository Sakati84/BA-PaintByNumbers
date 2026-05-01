import { StyleSheet, Text, View } from 'react-native';

import { PIPELINE_STEPS } from '../features/processing/processingProgress';
import type { PipelineStagePreview, StepId } from '../features/processing/processingTypes';

type Props = {
  results: Partial<Record<StepId, PipelineStagePreview>>;
};

export function ResultPreview({ results }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Pipeline Stages</Text>
      {PIPELINE_STEPS.map((step) => {
        const result = results[step.id];
        return (
          <View key={step.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>{step.label}</Text>
              <Text style={styles.description}>{result?.note ?? step.description}</Text>
            </View>
            <Text style={[styles.badge, result ? styles.badgeReady : styles.badgePending]}>
              {result ? result.status : 'pending'}
            </Text>
          </View>
        );
      })}
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
  row: {
    gap: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d7dde7',
  },
  rowText: {
    gap: 4,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1b1d22',
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    color: '#556070',
  },
  badge: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  badgePending: {
    backgroundColor: '#eef1f5',
    color: '#556070',
  },
  badgeReady: {
    backgroundColor: '#dff7e7',
    color: '#0b6b34',
  },
});
