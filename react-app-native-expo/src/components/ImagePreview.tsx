import { Image, StyleSheet, Text, View } from 'react-native';

type Props = {
  title: string;
  uri: string;
  width: number;
  height: number;
  note?: string;
};

export function ImagePreview({ title, uri, width, height, note }: Props) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Image source={{ uri }} style={styles.image} resizeMode="contain" />
      <Text style={styles.meta}>{width} x {height}</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
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
  image: {
    width: '100%',
    height: 220,
    borderRadius: 14,
    backgroundColor: '#eef1f5',
  },
  meta: {
    fontSize: 12,
    color: '#556070',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  note: {
    fontSize: 13,
    lineHeight: 18,
    color: '#556070',
  },
});
