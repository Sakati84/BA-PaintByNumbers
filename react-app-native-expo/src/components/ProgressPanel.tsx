import { StyleSheet, Text, View } from 'react-native';

import type { ProcessingProgress } from '../features/processing/processingTypes';

type Props = {
  progress: ProcessingProgress;
  errorMessage: string | null;
};

export function ProgressPanel({ progress, errorMessage }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Progress</Text>
      <View style={styles.progressBarTrack}>
        <View style={[styles.progressBarFill, { width: `${progress.progress}%` }]} />
      </View>
      <Text style={styles.message}>{progress.message}</Text>
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
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
  progressBarTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#e3e8f0',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#3e7bfa',
  },
  message: {
    fontSize: 14,
    color: '#556070',
  },
  error: {
    fontSize: 14,
    color: '#b42318',
  },
});
