import type { Mat } from 'react-native-fast-opencv';

export type NativeMatHandle = {
  mat: Mat;
  id: string;
  width: number;
  height: number;
  channels: number;
};

export type OpenCvAdapterStatus = 'unconfigured' | 'ready';
