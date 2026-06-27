import React, { useEffect, useMemo, useRef, useState } from 'react';

import backgroundArt from '../../../App/assets/Background.png';
import uploadArt from '../../../App/assets/Upload.png';
import type {
  GeneratorOutputVariant,
  GeneratorResult,
  GeneratorStage,
  WebImageSource,
  WebViewHostEvent,
} from '../../../App/src/features/webview/appWebViewBridgeTypes';
import { UI_TEXT } from '../content/uiText';
import { buildPosterizePrompt } from '../lib/promptBuilder';
import {
  COMPLEXITY_OPTIONS,
  COLOR_COUNT_MAX,
  COLOR_COUNT_MIN,
  DEFAULT_COLOR_COUNT,
  clampColorCount,
  complexityForColorCount,
  complexityOptionForPreset,
  settingsForColorCount,
} from '../lib/settings';
import { WebViewBridge } from '../lib/webviewBridge';

type ScreenState =
  | { name: 'splash' }
  | { name: 'upload'; colorCount: number }
  | { name: 'config'; source: WebImageSource; colorCount: number }
  | {
      name: 'processing';
      source?: WebImageSource;
      colorCount: number;
      progressPhase: 'posterizeImage' | 'paintByNumbers';
      progressValue: number | null;
      progressMessage: string;
    }
  | {
      name: 'result';
      source: WebImageSource;
      result: GeneratorResult;
      colorCount: number;
    };

type StoredCreation = {
  id: string;
  title: string;
  createdAt: number;
  thumbnailDataUrl: string;
  sourceLabel: string;
  resultSvgUri?: string;
};

const bridge = new WebViewBridge();
const RECENT_STORAGE_KEY = 'happynumbers.recentCreations';
const RESULT_PREVIEW_MAX_EDGE = 1400;
const DEBUG_TIMING_STAGES: Array<{ stage: GeneratorStage; label: string }> = [
  { stage: 'decode', label: 'Bild vorbereiten' },
  { stage: 'kmeans', label: 'Farben gruppieren' },
  { stage: 'colorMap', label: 'Farbkarte' },
  { stage: 'narrowCleanup', label: 'Streifen-Cleanup' },
  { stage: 'borderSegment', label: 'Ausläufer-Cleanup' },
  { stage: 'facetBuild', label: 'Regionen erkennen' },
  { stage: 'facetReduce', label: 'Regionen mergen' },
  { stage: 'borderTrace', label: 'Konturen' },
  { stage: 'labelPlacement', label: 'Label-Platzierung' },
  { stage: 'svgRender', label: 'Rendern' },
];

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function encodeSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getResultPreviewSource(result: GeneratorResult): string | null {
  if (result.svgUri != null && result.svgUri.length > 0) {
    return result.svgUri;
  }
  if (result.svg.length > 0) {
    return encodeSvgDataUrl(result.svg);
  }
  return null;
}

function getResultVariants(result: GeneratorResult): GeneratorOutputVariant[] {
  if (result.variants != null && result.variants.length > 0) {
    return result.variants;
  }

  if (result.previewPngUri != null && result.previewPngUri.length > 0) {
    return [
      {
        id: 'brightColorCircles',
        label: 'Malvorlage',
        description: 'Gerenderte PNG-Ausgabe.',
        pngUri: result.previewPngUri,
        pngFileName: result.previewPngFileName,
        pngWidth: result.previewPngWidth ?? result.imageWidth,
        pngHeight: result.previewPngHeight ?? result.imageHeight,
        pngByteLength: result.previewPngByteLength,
        isDefault: true,
      },
    ];
  }

  return [];
}

function getDefaultVariantId(variants: GeneratorOutputVariant[]): string | null {
  return variants.find((variant) => variant.isDefault)?.id ?? variants[0]?.id ?? null;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value * 100) + '%';
}

function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) {
    return 'n/a';
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(ms / 1000)} s`;
}

function formatBytes(bytes: number | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) {
    return 'n/a';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(bytes / 1024)} KB`;
  }
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
}

function formatDimensions(width: number | undefined, height: number | undefined): string {
  if (width == null || height == null || width <= 0 || height <= 0) {
    return 'n/a';
  }
  return `${formatInteger(width)} x ${formatInteger(height)} px`;
}

function isSafeStoredThumbnail(value: string): boolean {
  if (value.startsWith('data:image/jpeg') || value.startsWith('data:image/png')) {
    return value.length < 800000;
  }
  return value.startsWith('file:') && !value.toLowerCase().endsWith('.svg');
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob == null) {
        reject(new Error('Canvas konnte keine PNG-Vorschau erzeugen.'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('SVG konnte nicht für die PNG-Vorschau geladen werden.'));
    image.src = src;
  });
}

async function createSvgImageSource(result: GeneratorResult): Promise<{ url: string; revoke: () => void }> {
  if (result.svg.length > 0) {
    const url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
    return {
      url,
      revoke: () => URL.revokeObjectURL(url),
    };
  }

  if (result.svgUri == null || result.svgUri.length === 0) {
    throw new Error('Es gibt keine SVG-Datei für die Vorschau.');
  }

  try {
    const response = await fetch(result.svgUri);
    if (response.ok) {
      const svg = await response.text();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      return {
        url,
        revoke: () => URL.revokeObjectURL(url),
      };
    }
  } catch {
    // WKWebView can load file URLs as images even when fetch(file://...) is blocked.
  }

  return {
    url: result.svgUri,
    revoke: () => {},
  };
}

async function createPngPreviewUrl(result: GeneratorResult): Promise<string> {
  const source = await createSvgImageSource(result);
  try {
    const image = await loadImage(source.url);
    const baseWidth = result.svgWidth > 0 ? result.svgWidth : image.naturalWidth;
    const baseHeight = result.svgHeight > 0 ? result.svgHeight : image.naturalHeight;
    const scale = Math.min(1, RESULT_PREVIEW_MAX_EDGE / Math.max(baseWidth, baseHeight));
    const width = Math.max(1, Math.round(baseWidth * scale));
    const height = Math.max(1, Math.round(baseHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context == null) {
      throw new Error('Canvas ist nicht verfügbar.');
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const pngBlob = await canvasToPngBlob(canvas);
    return URL.createObjectURL(pngBlob);
  } finally {
    source.revoke();
  }
}

function readStoredCreations(): StoredCreation[] {
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (raw == null) {
      return [];
    }
    const parsed = JSON.parse(raw) as StoredCreation[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => typeof entry.thumbnailDataUrl === 'string' && isSafeStoredThumbnail(entry.thumbnailDataUrl))
      .map((entry) => ({
        id: String(entry.id),
        title: String(entry.title),
        createdAt: Number(entry.createdAt),
        thumbnailDataUrl: entry.thumbnailDataUrl,
        sourceLabel: String(entry.sourceLabel),
        resultSvgUri: entry.resultSvgUri,
      }));
  } catch {
    return [];
  }
}

function writeStoredCreations(value: StoredCreation[]): void {
  window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(value));
}

function saveCreation(source: WebImageSource, result: GeneratorResult): StoredCreation {
  const entry: StoredCreation = {
    id: `${Date.now()}`,
    title: source.label,
    createdAt: Date.now(),
    thumbnailDataUrl: result.previewPngUri ?? source.previewDataUrl,
    sourceLabel: source.label,
    resultSvgUri: result.svgUri,
  };

  const next = [entry, ...readStoredCreations()].slice(0, 6);
  writeStoredCreations(next);
  return entry;
}

function AppTopBar() {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <div className="topbar__dot" />
        <div className="topbar__title">{UI_TEXT.appName}</div>
      </div>
    </header>
  );
}

function Hero({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <section className="hero">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </section>
  );
}

function ColorCountSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (colorCount: number) => void;
}) {
  const colorCount = clampColorCount(value);
  const complexity = complexityForColorCount(colorCount);
  const option = complexityOptionForPreset(complexity);

  return (
    <section className="glass-panel">
      <span className="field-label">Farben</span>
      <div className="color-count-control">
        <div className="color-count-control__header">
          <div>
            <strong>{colorCount} Farben</strong>
            <span>{option.description}</span>
          </div>
          <span className="color-count-control__pill">{option.label}</span>
        </div>
        <input
          aria-label="Anzahl der Farben"
          max={COLOR_COUNT_MAX}
          min={COLOR_COUNT_MIN}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(clampColorCount(Number(event.currentTarget.value)))}
          step={1}
          type="range"
          value={colorCount}
        />
        <div className="color-count-control__scale">
          {COMPLEXITY_OPTIONS.map((range) => (
            <span className={range.preset === complexity ? 'color-count-control__scale-active' : ''} key={range.preset}>
              {range.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function App() {
  const [screen, setScreen] = useState<ScreenState>({ name: 'splash' });
  const [recentCreations, setRecentCreations] = useState<StoredCreation[]>(() => readStoredCreations());
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isBrowserPreview, setIsBrowserPreview] = useState(false);
  const [resultPngPreviewUrl, setResultPngPreviewUrl] = useState<string | null>(null);
  const [resultPreviewError, setResultPreviewError] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const activePickRequestIdRef = useRef<string | null>(null);
  const activePosterizeRequestIdRef = useRef<string | null>(null);
  const activeRunRequestIdRef = useRef<string | null>(null);
  const activeShareRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    const hasNativeHost = typeof window.ReactNativeWebView?.postMessage === 'function';
    const unsubscribe = bridge.subscribe((event: WebViewHostEvent) => {
      if (event.type === 'hostReady') {
        window.setTimeout(() => {
          setScreen((current) =>
            current.name === 'splash'
              ? { name: 'upload', colorCount: DEFAULT_COLOR_COUNT }
              : current,
          );
        }, 500);
        return;
      }

      if (event.type === 'error') {
        if (event.requestId === activeShareRequestIdRef.current) {
          activeShareRequestIdRef.current = null;
        }
        setErrorBanner(event.error.message);
        setScreen((current) => {
          if (current.name === 'processing' && current.source != null) {
            return {
              name: 'config',
              source: current.source,
              colorCount: current.colorCount,
            };
          }
          if (current.name === 'processing') {
            return {
              name: 'upload',
              colorCount: current.colorCount,
            };
          }
          return current;
        });
        return;
      }

      if (event.type === 'shareCompleted' && event.requestId === activeShareRequestIdRef.current) {
        activeShareRequestIdRef.current = null;
        setErrorBanner(event.payload.message);
        return;
      }

      if (event.type === 'sourceReady') {
        if (event.requestId === activePickRequestIdRef.current && event.payload.kind === 'uploaded') {
          activePickRequestIdRef.current = null;
          setScreen({
            name: 'config',
            source: event.payload,
            colorCount: DEFAULT_COLOR_COUNT,
          });
          return;
        }

        if (event.requestId === activePosterizeRequestIdRef.current && event.payload.kind === 'posterized') {
          activePosterizeRequestIdRef.current = null;
          const posterizedSource = event.payload;
          setScreen((current) => {
            if (current.name !== 'processing') {
              return current;
            }

            const runRequestId = createRequestId('run');
            activeRunRequestIdRef.current = runRequestId;
            bridge.send({
              type: 'runPaintByNumbers',
              requestId: runRequestId,
              payload: {
                sourceToken: posterizedSource.sourceToken,
                settings: settingsForColorCount(current.colorCount),
              },
            });

            return {
              ...current,
              source: posterizedSource,
              progressPhase: 'paintByNumbers',
              progressValue: 0,
              progressMessage: 'Das KI-Bild ist bereit. Die lokale Malvorlage wird berechnet...',
            };
          });
        }
        return;
      }

      if (event.type === 'processingProgress') {
        const isRelevant =
          event.requestId === activeRunRequestIdRef.current ||
          event.requestId === activePosterizeRequestIdRef.current;

        if (!isRelevant) {
          return;
        }

        setScreen((current) => {
          if (current.name !== 'processing') {
            return current;
          }
          return {
            ...current,
            progressPhase: event.payload.phase,
            progressValue: event.payload.progress,
            progressMessage: event.payload.message,
          };
        });
        return;
      }

      if (event.type === 'runCompleted' && event.requestId === activeRunRequestIdRef.current) {
        activeRunRequestIdRef.current = null;
        const source = event.payload.source;
        const result = event.payload.result;
        setScreen((current) => {
          const colorCount = current.name === 'processing' ? current.colorCount : DEFAULT_COLOR_COUNT;
          saveCreation(source, result);
          setRecentCreations(readStoredCreations());
          return {
            name: 'result',
            source,
            result,
            colorCount,
          };
        });
      }
    });

    if (hasNativeHost) {
      bridge.send({
        type: 'webAppReady',
        requestId: createRequestId('ready'),
        payload: null,
      });
    } else {
      setIsBrowserPreview(true);
      window.setTimeout(() => {
        setScreen((current) =>
          current.name === 'splash'
            ? { name: 'upload', colorCount: DEFAULT_COLOR_COUNT }
            : current,
        );
      }, 500);
    }

    return unsubscribe;
  }, []);

  const resultSvgSource = useMemo(() => {
    if (screen.name !== 'result') {
      return null;
    }
    return getResultPreviewSource(screen.result);
  }, [screen]);

  const resultVariants = useMemo(() => {
    if (screen.name !== 'result') {
      return [];
    }
    return getResultVariants(screen.result);
  }, [screen]);

  const selectedVariant = useMemo(() => {
    if (resultVariants.length === 0) {
      return null;
    }
    return resultVariants.find((variant) => variant.id === selectedVariantId) ?? resultVariants[0];
  }, [resultVariants, selectedVariantId]);

  const resultDebugRows = useMemo(() => {
    if (screen.name !== 'result') {
      return [];
    }

    const result = screen.result;
    const largestPaletteEntry = result.palette[0];
    const totalTimingMs = Object.entries(result.timings)
      .filter(([stage]) => stage !== 'done')
      .reduce((sum, [, elapsedMs]) => sum + (Number.isFinite(elapsedMs) ? elapsedMs : 0), 0);
    const selectedPngBytes = selectedVariant?.pngByteLength ?? result.previewPngByteLength;
    const selectedSvgBytes = selectedVariant?.svgByteLength ?? result.svgByteLength ?? (result.svg.length > 0 ? result.svg.length : undefined);
    const outputWidth = selectedVariant?.pngWidth ?? selectedVariant?.svgWidth ?? result.previewPngWidth ?? result.svgWidth;
    const outputHeight = selectedVariant?.pngHeight ?? selectedVariant?.svgHeight ?? result.previewPngHeight ?? result.svgHeight;

    return [
      { label: 'Quelle', value: screen.source.label },
      { label: 'Aktuelle Ausgabe', value: selectedVariant?.label ?? 'Malvorlage' },
      { label: 'Gewählte Farben', value: formatInteger(screen.colorCount) },
      { label: 'Verwendete Farben', value: formatInteger(result.palette.length) },
      { label: 'Ausmalbare Flächen', value: formatInteger(result.facetCount) },
      { label: 'Arbeitsgröße', value: formatDimensions(result.imageWidth, result.imageHeight) },
      { label: 'Ausgabegröße', value: formatDimensions(outputWidth, outputHeight) },
      { label: 'Ausgabevarianten', value: formatInteger(resultVariants.length) },
      {
        label: 'Größte Farbe',
        value: largestPaletteEntry != null
          ? `Farbe ${largestPaletteEntry.index} · ${formatPercent(largestPaletteEntry.areaPercentage)}`
          : 'n/a',
      },
      { label: 'PNG-Groesse', value: formatBytes(selectedPngBytes) },
      { label: 'SVG-Groesse', value: formatBytes(selectedSvgBytes) },
      { label: 'Gesamtzeit lokal', value: totalTimingMs > 0 ? formatDuration(totalTimingMs) : 'n/a' },
    ];
  }, [resultVariants.length, screen, selectedVariant]);

  const resultTimingRows = useMemo(() => {
    if (screen.name !== 'result') {
      return [];
    }

    return DEBUG_TIMING_STAGES
      .map(({ stage, label }) => ({ label, value: screen.result.timings[stage] }))
      .filter((entry) => entry.value != null && Number.isFinite(entry.value));
  }, [screen]);

  useEffect(() => {
    if (screen.name !== 'result') {
      setSelectedVariantId(null);
      return;
    }

    const variants = getResultVariants(screen.result);
    const nextVariantId = getDefaultVariantId(variants);
    setSelectedVariantId((current) => (current != null && variants.some((variant) => variant.id === current) ? current : nextVariantId));
  }, [screen]);

  useEffect(() => {
    if (screen.name !== 'result') {
      setResultPngPreviewUrl(null);
      setResultPreviewError(null);
      return;
    }

    const selectedPngUri = selectedVariant?.pngUri ?? screen.result.previewPngUri;
    if (selectedPngUri != null && selectedPngUri.length > 0) {
      setResultPngPreviewUrl(selectedPngUri);
      setResultPreviewError(null);
      return;
    }

    let isCancelled = false;
    let objectUrl: string | null = null;

    setResultPngPreviewUrl(null);
    setResultPreviewError(null);

    void createPngPreviewUrl(screen.result)
      .then((url) => {
        if (isCancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setResultPngPreviewUrl(url);
      })
      .catch((error: unknown) => {
        if (isCancelled) {
          return;
        }
        setResultPreviewError(error instanceof Error ? error.message : 'Die PNG-Vorschau konnte nicht erzeugt werden.');
      });

    return () => {
      isCancelled = true;
      if (objectUrl != null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [screen, selectedVariant]);

  function shareCurrentResult(format: 'png' | 'svg' = 'png'): void {
    if (screen.name !== 'result') {
      return;
    }
    const pngUri = selectedVariant?.pngUri ?? screen.result.previewPngUri;
    if (pngUri != null && pngUri.length > 0) {
      const requestId = createRequestId('share');
      activeShareRequestIdRef.current = requestId;
      setErrorBanner(null);
      if (format === 'svg') {
        if (selectedVariant?.svgUri != null && selectedVariant.svgUri.length > 0) {
          bridge.send({
            type: 'shareResultFile',
            requestId,
            payload: {
              uri: selectedVariant.svgUri,
              fileName: selectedVariant.svgFileName,
              mimeType: 'image/svg+xml',
              uti: 'public.svg-image',
            },
          });
          return;
        }

        bridge.send({
          type: 'shareResultSvgFromPng',
          requestId,
          payload: {
            pngUri,
            fileName: selectedVariant?.pngFileName?.replace(/\.[^.]+$/, '.svg') ?? screen.result.svgFileName,
            width: selectedVariant?.pngWidth ?? screen.result.previewPngWidth ?? screen.result.svgWidth,
            height: selectedVariant?.pngHeight ?? screen.result.previewPngHeight ?? screen.result.svgHeight,
          },
        });
        return;
      }

      bridge.send({
        type: 'shareResultFile',
        requestId,
        payload: {
          uri: pngUri,
          fileName: selectedVariant?.pngFileName ?? screen.result.previewPngFileName,
          mimeType: 'image/png',
          uti: 'public.png',
        },
      });
      return;
    }

    if (format === 'svg' && screen.result.svgUri != null && screen.result.svgUri.length > 0) {
      const requestId = createRequestId('share');
      activeShareRequestIdRef.current = requestId;
      setErrorBanner(null);
      bridge.send({
        type: 'shareResultSvg',
        requestId,
        payload: {
          svgUri: screen.result.svgUri,
          fileName: screen.result.svgFileName,
        },
      });
      return;
    }

    if (screen.result.svgUri == null || screen.result.svgUri.length === 0) {
      setErrorBanner('Diese Vorlage liegt noch nicht als Datei vor. Bitte erstelle sie erneut.');
      return;
    }

    const requestId = createRequestId('share');
    activeShareRequestIdRef.current = requestId;
    setErrorBanner(null);
    bridge.send({
      type: 'shareResultSvg',
      requestId,
      payload: {
        svgUri: screen.result.svgUri,
        fileName: screen.result.svgFileName,
      },
    });
  }

  function startUploadFlow(): void {
    if (isBrowserPreview) {
      setErrorBanner('Bildauswahl ist in der reinen Browser-Vorschau nicht verdrahtet. Bitte nutze die Expo-WebView-App.');
      return;
    }
    setErrorBanner(null);
    const requestId = createRequestId('pick');
    activePickRequestIdRef.current = requestId;
    bridge.send({
      type: 'pickImage',
      requestId,
      payload: null,
    });
  }

  function launchPosterizeAndRun(source: WebImageSource, colorCount: number): void {
    if (isBrowserPreview) {
      setErrorBanner('Der App-Flow funktioniert erst eingebettet in der Expo-WebView-App.');
      return;
    }

    const clampedColorCount = clampColorCount(colorCount);
    const complexity = complexityForColorCount(clampedColorCount);
    const requestId = createRequestId('posterize');
    activePosterizeRequestIdRef.current = requestId;
    setErrorBanner(null);
    setScreen({
      name: 'processing',
      source,
      colorCount: clampedColorCount,
      progressPhase: 'posterizeImage',
      progressValue: null,
      progressMessage: `Das Bild wird mit ${clampedColorCount} Farben posterisiert...`,
    });
    bridge.send({
      type: 'posterizeUploadedImage',
      requestId,
      payload: {
        sourceToken: source.sourceToken,
        complexity,
        colorCount: clampedColorCount,
        prompt: buildPosterizePrompt({ colorCount: clampedColorCount }),
      },
    });
  }

  if (screen.name === 'splash') {
    return (
      <main className="app-shell">
        <section className="screen splash">
          <div className="splash__art">
            <img src={backgroundArt} alt="" />
          </div>
          <div className="hero">
            <h2>{UI_TEXT.splashTitle}</h2>
            <p>{UI_TEXT.splashSubtitle}</p>
          </div>
          <div className="progress-card" style={{ width: 'min(460px, 92vw)' }}>
            <div className="progress-bar">
              <div className="progress-bar__fill" style={{ width: '64%' }} />
            </div>
            <div className="progress-meta">
              <strong>{UI_TEXT.splashLoading}</strong>
              <span>Startet lokal in der WebView</span>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="screen">
        <AppTopBar />
        {isBrowserPreview ? (
          <div className="status-banner">
            <div>
              <strong>Browser-Vorschau</strong>
              <div>Die UI läuft ohne Expo-WebView-Host. Der komplette Generator-Flow funktioniert erst eingebettet in der App.</div>
            </div>
          </div>
        ) : null}
        {errorBanner != null ? (
          <div className="status-banner status-banner--error">
            <div>
              <strong>Da ist etwas schiefgelaufen</strong>
              <div>{errorBanner}</div>
            </div>
          </div>
        ) : null}

        {screen.name === 'upload' ? (
          <>
            <Hero title={UI_TEXT.uploadOnlyTitle} subtitle={UI_TEXT.uploadOnlySubtitle} />
            <button className="upload-panel" onClick={startUploadFlow}>
              <img src={uploadArt} alt="" />
              <div className="upload-panel__body">
                <strong>Bild auswählen</strong>
                <span>JPG oder PNG, wird automatisch auf eine sinnvolle Größe skaliert.</span>
              </div>
            </button>
            <ColorCountSelector
              value={screen.colorCount}
              onChange={(colorCount) => setScreen({ ...screen, colorCount })}
            />
            {recentCreations.length > 0 ? (
              <section className="recent-section">
                <div className="section-heading">
                  <h2>Letzte Vorlagen</h2>
                </div>
                <div className="recent-grid">
                  {recentCreations.map((creation) => (
                    <article className="recent-card" key={creation.id}>
                      <img className="recent-card__thumb" src={creation.thumbnailDataUrl} alt={creation.title} />
                      <div className="recent-card__body">
                        <h4>{creation.title}</h4>
                        <p>{new Date(creation.createdAt).toLocaleDateString('de-DE')}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {screen.name === 'config' ? (
          <>
            <Hero title={UI_TEXT.configTitle} subtitle={UI_TEXT.configSubtitle} />
            <section className="preview-frame">
              <img src={screen.source.previewDataUrl} alt={screen.source.label} />
            </section>
            <ColorCountSelector
              value={screen.colorCount}
              onChange={(colorCount) => setScreen({ ...screen, colorCount })}
            />
            <div className="toolbar">
              <button className="button-secondary" onClick={() => setScreen({ name: 'upload', colorCount: screen.colorCount })}>
                Neues Bild
              </button>
              <button className="button-primary" onClick={() => launchPosterizeAndRun(screen.source, screen.colorCount)}>
                Malvorlage erstellen
              </button>
            </div>
          </>
        ) : null}

        {screen.name === 'processing' ? (
          <>
            <Hero title={UI_TEXT.processingTitle} subtitle={screen.progressMessage} />
            {screen.source != null ? (
              <section className="preview-frame">
                <img src={screen.source.previewDataUrl} alt={screen.source.label} />
              </section>
            ) : null}
            <section className="progress-card">
              <div className="progress-bar">
                <div
                  className="progress-bar__fill"
                  style={{ width: `${screen.progressValue == null ? 18 : Math.max(8, screen.progressValue)}%` }}
                />
              </div>
              <div className="progress-meta">
                <strong>{screen.progressPhase === 'posterizeImage' ? 'KI-Posterisierung' : 'Lokale Pipeline'}</strong>
                <span>{screen.progressValue == null ? 'Bitte kurz warten' : `${screen.progressValue}%`}</span>
              </div>
              <div className="status-banner">
                <div>
                  <strong>Status</strong>
                  <div>{screen.progressMessage}</div>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {screen.name === 'result' ? (
          <>
            <Hero title={UI_TEXT.resultTitle} subtitle={UI_TEXT.resultSubtitle} />
            <section className="preview-frame">
              {resultPngPreviewUrl != null ? (
                <img className="result-image" src={resultPngPreviewUrl} alt={selectedVariant?.label ?? 'Fertige Malvorlage'} />
              ) : resultPreviewError != null ? (
                <div className="empty-state">
                  Die SVG-Datei wurde erstellt, aber die PNG-Vorschau konnte nicht geladen werden.
                  {resultSvgSource != null ? <span> Du kannst die Vorlage trotzdem speichern.</span> : null}
                </div>
              ) : (
                <div className="empty-state">PNG-Vorschau wird vorbereitet...</div>
              )}
            </section>
            {resultVariants.length > 0 ? (
              <section className="glass-panel">
                <span className="field-label">Ausgabe</span>
                <div className="variant-grid">
                  {resultVariants.map((variant) => (
                    <button
                      className={`select-card variant-card ${selectedVariant?.id === variant.id ? 'select-card--selected' : ''}`}
                      key={variant.id}
                      onClick={() => setSelectedVariantId(variant.id)}
                    >
                      <div className="select-card__header">{variant.label}</div>
                      <div className="select-card__meta">{variant.description}</div>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
            <section className="glass-panel">
              <span className="field-label">Quelle</span>
              <div>{screen.source.label}</div>
              <span className="field-label" style={{ marginTop: 16 }}>
                Farben
              </span>
              <div>
                {complexityOptionForPreset(complexityForColorCount(screen.colorCount)).label},{' '}
                {screen.colorCount} Farben
              </div>
              <span className="field-label" style={{ marginTop: 16 }}>
                Ergebnis
              </span>
              <div>{screen.result.facetCount} ausmalbare Flächen erzeugt</div>
            </section>
            <section className="glass-panel">
              <span className="field-label">Debug-Infos</span>
              <table className="debug-table">
                <tbody>
                  {resultDebugRows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td>{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {resultTimingRows.length > 0 ? (
                <>
                  <span className="field-label field-label--subtle">Pipeline-Timings</span>
                  <table className="debug-table debug-table--compact">
                    <tbody>
                      {resultTimingRows.map((row) => (
                        <tr key={row.label}>
                          <th scope="row">{row.label}</th>
                          <td>{formatDuration(row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
            </section>
            <section className="glass-panel">
              <span className="field-label">Palette ({screen.result.palette.length})</span>
              <div className="palette-list">
                {screen.result.palette.map((entry) => (
                  <div className="palette-item" key={entry.index}>
                    <div
                      className="palette-swatch"
                      style={{
                        backgroundColor: `rgb(${entry.color[0]}, ${entry.color[1]}, ${entry.color[2]})`,
                      }}
                    />
                    <div>
                      <div>Farbe {entry.index}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        {Math.round(entry.areaPercentage * 100)}% Fläche
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <div className="toolbar">
              <button className="button-secondary" onClick={() => setScreen({ name: 'upload', colorCount: screen.colorCount })}>
                Neues Bild
              </button>
              <button className="button-secondary" onClick={() => shareCurrentResult('svg')}>
                SVG speichern
              </button>
              <button className="button-primary" onClick={() => shareCurrentResult('png')}>
                PNG speichern
              </button>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
