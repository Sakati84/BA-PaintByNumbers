import { Directory, File, Paths } from 'expo-file-system';

import { LOCAL_WEBVIEW_BUILD_ID, LOCAL_WEBVIEW_FILES } from './localWebViewManifest.generated';

export type LocalWebViewBundle = {
  buildId: string;
  indexUri: string;
  rootUri: string;
};

let localWebViewBundlePromise: Promise<LocalWebViewBundle> | null = null;

export function ensureLocalWebViewBundle(): Promise<LocalWebViewBundle> {
  if (localWebViewBundlePromise == null) {
    localWebViewBundlePromise = materializeLocalWebViewBundle().catch((error) => {
      localWebViewBundlePromise = null;
      throw error;
    });
  }

  return localWebViewBundlePromise;
}

async function materializeLocalWebViewBundle(): Promise<LocalWebViewBundle> {
  const rootDirectory = new Directory(Paths.cache, 'local-webview');
  rootDirectory.create({ idempotent: true, intermediates: true });

  const buildDirectory = new Directory(rootDirectory, LOCAL_WEBVIEW_BUILD_ID);
  buildDirectory.create({ idempotent: true, intermediates: true });

  for (const bundledFile of LOCAL_WEBVIEW_FILES) {
    const outputFile = new File(buildDirectory, ...bundledFile.relativePath.split('/'));
    if (!outputFile.exists || outputFile.size !== bundledFile.byteLength) {
      outputFile.create({ intermediates: true, overwrite: true });
      outputFile.write(bundledFile.base64Chunks.join(''), { encoding: 'base64' });
    }
  }

  const indexFile = new File(buildDirectory, 'index.html');
  if (!indexFile.exists) {
    throw new Error('Local WebView bundle is missing index.html after materialization.');
  }

  return {
    buildId: LOCAL_WEBVIEW_BUILD_ID,
    indexUri: indexFile.uri,
    rootUri: buildDirectory.uri,
  };
}
