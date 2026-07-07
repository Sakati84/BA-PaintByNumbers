import React, { useEffect, useMemo, useRef, useState } from 'react';

import backgroundArt from '../../../App/assets/Background.png';
import uploadArt from '../../../App/assets/Upload.png';
import type {
  GeneratorDebugParameter,
  GeneratorDebugStageSnapshot,
  GeneratorOutputVariant,
  GeneratorResult,
  GeneratorSettings,
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
  | { name: 'upload'; colorCount: number; debugMode: boolean }
  | { name: 'config'; source: WebImageSource; colorCount: number; debugMode: boolean }
  | {
      name: 'processing';
      source?: WebImageSource;
      colorCount: number;
      debugMode: boolean;
      debugStartStage?: GeneratorStage;
      runSettings: GeneratorSettings;
      progressPhase: 'posterizeImage' | 'paintByNumbers';
      progressValue: number | null;
      progressMessage: string;
      progressPreview?: GeneratorDebugStageSnapshot;
    }
  | {
      name: 'result';
      source: WebImageSource;
      result: GeneratorResult;
      colorCount: number;
      debugMode: boolean;
      debugStartStage?: GeneratorStage;
      runSettings: GeneratorSettings;
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

const DEBUG_FINAL_VARIANT_LABEL = 'Classic';

const PIPELINE_STAGE_INFO: Partial<Record<GeneratorStage, { title: string; body: string }>> = {
  decode: {
    title: 'Decode',
    body: 'Bereitet das Eingabebild fuer die Pipeline vor: Resize auf die Arbeitsgroesse, PNG-Normalisierung und Alpha-Flattening auf Weiss. Fehler hier zeigen sich oft als falsche Groesse, Transparenzartefakte oder unerwartete Eingabefarben.',
  },
  kmeans: {
    title: 'K-Means',
    body: 'Reduziert alle Pixel im LAB-Farbraum auf die gewuenschte Anzahl Farbcluster. Wenn Motive zu fleckig, matschig oder farblich falsch wirken, sind Farbcluster, Seed und Min-Delta die ersten Hebel.',
  },
  colorMap: {
    title: 'Color Map',
    body: 'Baut aus dem K-Means-Bild eine Labelkarte und merged fast identische Palettefarben. Zu aggressives Merging kann Details verlieren, zu niedriges Merging erzeugt redundante Farbnummern.',
  },
  narrowCleanup: {
    title: 'Narrow Cleanup',
    body: 'Kann einzelne schmale Pixelstreifen und isolierte Pixel in passendere Nachbarfarben umwandeln. Aktuell ist diese Stufe oft auf 0 Runs gesetzt; erhoehe sie vorsichtig, wenn K-Means duenne Stoerlinien erzeugt.',
  },
  borderSegment: {
    title: 'Protrusion Pruning',
    body: 'Entfernt schwache duenne Auslaeuferpixel an Farbkanten, solange die Farbnaehe das erlaubt. Hilft bei kleinen Zacken, kann bei zu vielen Runs aber Motivkanten weichzeichnen.',
  },
  facetBuild: {
    title: 'Facet Build',
    body: 'Findet zusammenhaengende Regionen aus der Labelkarte. Jede getrennte Flaeche bekommt eine eigene Region, auch wenn sie dieselbe Farbe wie andere Flaechen hat.',
  },
  facetReduce: {
    title: 'Facet Reduce',
    body: 'Merged kleine oder sehr duenne Regionen in bessere Nachbarn. Das ist aktuell der wichtigste Cleanup-Schritt fuer ausmalbare Flaechen. Mindestflaeche, aehnliche Nachbarn und Max-Flaechenlimit bestimmen die Staerke.',
  },
  borderTrace: {
    title: 'Border Trace',
    body: 'Berechnet Grenzen und SVG-Pfade der finalen Regionen. Probleme hier zeigen sich meist als fehlende, gezackte oder falsch geschlossene Konturen.',
  },
  labelPlacement: {
    title: 'Label Placement',
    body: 'Sucht fuer ausreichend grosse Regionen die breiteste Stelle fuer Zahl oder Farbpunkt. Wenn Labels fehlen oder schlecht liegen, sind Regionengroesse und Form nach Facet Reduce entscheidend.',
  },
  svgRender: {
    title: 'SVG Render',
    body: 'Rendert aus Regionen, Konturen und Labelpositionen die sichtbare Ausgabe. Im Debug Mode wird nur Classic gerendert, damit Reruns schneller und die Diagnose fokussierter bleiben.',
  },
};

type ZoomImage = {
  src: string;
  label: string;
  width?: number;
  height?: number;
};

function getDefaultRunSettings(colorCount: number): GeneratorSettings {
  return settingsForColorCount(colorCount);
}

function normalizeDebugSettings(settings: GeneratorSettings): GeneratorSettings {
  return {
    kMeansNrOfClusters: Math.max(1, Math.min(48, Math.round(settings.kMeansNrOfClusters))),
    kMeansMinDeltaDifference: Math.max(0.1, Math.min(10, Number(settings.kMeansMinDeltaDifference) || 1)),
    nearIdenticalPaletteMergeLabDistance: Math.max(0, Math.min(20, Number(settings.nearIdenticalPaletteMergeLabDistance) || 0)),
    narrowPixelStripCleanupRuns: Math.max(0, Math.min(8, Math.round(settings.narrowPixelStripCleanupRuns))),
    mergeSimilarAdjacentRegions: Boolean(settings.mergeSimilarAdjacentRegions),
    removeFacetsSmallerThanImageRatio: Math.max(0, Math.min(0.001, Number(settings.removeFacetsSmallerThanImageRatio) || 0)),
    removeFacetsFromLargeToSmall: Boolean(settings.removeFacetsFromLargeToSmall),
    maximumNumberOfFacets: Math.max(0, Math.min(12000, Math.round(settings.maximumNumberOfFacets))),
    nrOfTimesToHalveBorderSegments: Math.max(0, Math.min(8, Math.round(settings.nrOfTimesToHalveBorderSegments))),
    resizeImageWidth: Math.max(128, Math.min(2048, Math.round(settings.resizeImageWidth))),
    resizeImageHeight: Math.max(128, Math.min(2048, Math.round(settings.resizeImageHeight))),
    randomSeed: Math.max(0, Math.min(999999, Math.round(settings.randomSeed))),
  };
}

function updateDebugSettingValue(
  settings: GeneratorSettings,
  parameter: GeneratorDebugParameter,
  rawValue: number | boolean,
): GeneratorSettings {
  const next = {
    ...settings,
    [parameter.key]: rawValue,
  } as GeneratorSettings;
  return normalizeDebugSettings(next);
}

function debugImageSource(stage: GeneratorDebugStageSnapshot): string | null {
  if (stage.image?.pngBase64 == null || stage.image.pngBase64.length === 0) {
    return null;
  }
  return `data:image/png;base64,${stage.image.pngBase64}`;
}

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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Das Bild konnte nicht gelesen werden.'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

async function createBrowserPreviewSource(file: File): Promise<WebImageSource> {
  const previewDataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(previewDataUrl);

  return {
    sourceToken: `browser-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'uploaded',
    label: file.name || 'Browser-Bild',
    previewDataUrl,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
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
      <span className="field-label">Farben & Detailgrad</span>
      <div className="color-count-control">
        <div className="color-count-control__header">
          <div>
            <strong>{colorCount} Farben - {option.label}</strong>
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
              <strong>{range.label}</strong>
              <small>{range.scaleDescription}</small>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function DebugModeToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <section className={`debug-toggle-panel ${enabled ? 'debug-toggle-panel--active' : ''}`}>
      <div>
        <span className="field-label">Debug Mode</span>
        <strong>Pipeline sichtbar machen</strong>
        <p>Zeigt pro Schritt Parameter, Timing und Output-Bild. Reruns koennen ab einem Schritt starten.</p>
      </div>
      <button
        aria-label="Debug Mode"
        aria-pressed={enabled}
        className={`debug-switch ${enabled ? 'debug-switch--on' : ''}`}
        onClick={() => onChange(!enabled)}
        type="button"
      >
        <span />
      </button>
    </section>
  );
}

function ProcessingLivePreview({
  source,
  snapshot,
  phase,
  onOpenImage,
}: {
  source?: WebImageSource;
  snapshot?: GeneratorDebugStageSnapshot;
  phase: 'posterizeImage' | 'paintByNumbers';
  onOpenImage: (image: ZoomImage) => void;
}) {
  const snapshotSrc = snapshot == null ? null : debugImageSource(snapshot);
  const src = snapshotSrc ?? source?.previewDataUrl ?? null;
  const label =
    snapshot?.label ??
    (phase === 'posterizeImage'
      ? 'Ausgangsbild'
      : source?.kind === 'posterized'
        ? 'KI-Bild'
        : 'Pipeline-Eingang');
  const description =
    snapshot?.description ??
    (phase === 'posterizeImage'
      ? 'Dieses Bild wird gerade fuer die lokale Pipeline vorbereitet.'
      : 'Die lokale Pipeline startet mit diesem vorbereiteten Bild.');
  const metrics = snapshot?.metrics.slice(0, 3) ?? [];
  const width = snapshot?.image?.width ?? source?.width;
  const height = snapshot?.image?.height ?? source?.height;

  return (
    <section className="processing-live">
      <div className="processing-live__header">
        <div>
          <span className="field-label">{snapshot == null ? 'Vorschau' : 'Debug-Live-Vorschau'}</span>
          <h2>{label}</h2>
          <p>{description}</p>
        </div>
        <span>{phase === 'posterizeImage' ? 'KI' : 'Pipeline'}</span>
      </div>
      {src != null ? (
        <button
          className="processing-live__image"
          onClick={() => onOpenImage({ src, label, width, height })}
          type="button"
        >
          <img src={src} alt={label} />
          <span>{formatDimensions(width, height)}</span>
        </button>
      ) : (
        <div className="empty-state">Vorschau wird vorbereitet...</div>
      )}
      {metrics.length > 0 ? (
        <div className="processing-live__metrics">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DebugParameterControl({
  parameter,
  value,
  onChange,
}: {
  parameter: GeneratorDebugParameter;
  value: number | boolean;
  onChange: (parameter: GeneratorDebugParameter, value: number | boolean) => void;
}) {
  if (parameter.input === 'boolean') {
    return (
      <label className="debug-param debug-param--toggle">
        <span>
          <strong>{parameter.label}</strong>
          {parameter.description != null ? <small>{parameter.description}</small> : null}
        </span>
        <input
          checked={Boolean(value)}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(parameter, event.currentTarget.checked)}
          type="checkbox"
        />
      </label>
    );
  }

  return (
    <label className="debug-param">
      <span>
        <strong>{parameter.label}</strong>
        {parameter.description != null ? <small>{parameter.description}</small> : null}
      </span>
      <div className="debug-param__input">
        <input
          max={parameter.max}
          min={parameter.min}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(parameter, Number(event.currentTarget.value))}
          step={parameter.step}
          type="number"
          value={Number(value)}
        />
        {parameter.unit != null ? <em>{parameter.unit}</em> : null}
      </div>
    </label>
  );
}

function PipelineDebugPanel({
  stages,
  settings,
  savedConfig,
  saveMessage,
  onChangeSetting,
  onOpenImage,
  onRerunFromStage,
  onSaveConfig,
}: {
  stages: GeneratorDebugStageSnapshot[];
  settings: GeneratorSettings;
  savedConfig: string | null;
  saveMessage: string | null;
  onChangeSetting: (parameter: GeneratorDebugParameter, value: number | boolean) => void;
  onOpenImage: (image: ZoomImage) => void;
  onRerunFromStage: (stage: GeneratorStage) => void;
  onSaveConfig: () => void;
}) {
  const [openInfoStage, setOpenInfoStage] = useState<GeneratorStage | null>(null);

  return (
    <section className="pipeline-debug">
      <div className="pipeline-debug__heading">
        <div>
          <span className="field-label">Pipeline Debug</span>
          <h2>Schritte, Bilder, Parameter</h2>
        </div>
        <span>{stages.length} Stufen</span>
      </div>
      <div className="pipeline-debug__list">
        {stages.map((stage, index) => {
          const src = debugImageSource(stage);
          return (
            <article className="pipeline-stage" key={`${stage.stage}-${index}`}>
              <div className="pipeline-stage__header">
                <div>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <h3>{stage.label}</h3>
                </div>
                <div className="pipeline-stage__actions">
                  <button
                    aria-expanded={openInfoStage === stage.stage}
                    aria-label={`Info zu ${stage.label}`}
                    className="pipeline-stage__info-button"
                    onClick={() => setOpenInfoStage((current) => (current === stage.stage ? null : stage.stage))}
                    type="button"
                  >
                    i
                  </button>
                  <strong>{stage.cacheHit ? 'Cache' : formatDuration(stage.timingMs)}</strong>
                </div>
              </div>
              <p>{stage.description}</p>
              {openInfoStage === stage.stage ? (
                <div className="pipeline-stage__info">
                  <strong>{PIPELINE_STAGE_INFO[stage.stage]?.title ?? stage.label}</strong>
                  <p>{PIPELINE_STAGE_INFO[stage.stage]?.body ?? stage.description}</p>
                </div>
              ) : null}
              {stage.metrics.length > 0 ? (
                <div className="pipeline-stage__metrics">
                  {stage.metrics.map((metric) => (
                    <div key={metric.label}>
                      <span>{metric.label}</span>
                      <strong>{metric.value}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
              {src != null ? (
                <button
                  className="pipeline-stage__image"
                  onClick={() => onOpenImage({
                    src,
                    label: stage.image?.label ?? stage.label,
                    width: stage.image?.width,
                    height: stage.image?.height,
                  })}
                  type="button"
                >
                  <img src={src} alt={stage.image?.label ?? stage.label} />
                  <span>Tippen zum Zoomen</span>
                </button>
              ) : null}
              {stage.parameters.length > 0 ? (
                <div className="pipeline-stage__params">
                  {stage.parameters.map((parameter) => (
                    <div key={parameter.key}>
                      <DebugParameterControl
                        parameter={parameter}
                        value={settings[parameter.key]}
                        onChange={onChangeSetting}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              {stage.canRerunFromHere ? (
                <button
                  className="button-secondary pipeline-stage__rerun"
                  onClick={() => onRerunFromStage(stage.stage)}
                  type="button"
                >
                  Rerun from here
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
      <div className="debug-config-export">
        <button className="button-primary" onClick={onSaveConfig} type="button">
          Parameterkonfiguration speichern
        </button>
        {saveMessage != null ? <p>{saveMessage}</p> : null}
        {savedConfig != null ? (
          <textarea readOnly aria-label="Gespeicherte Debug-Parameter" value={savedConfig} />
        ) : null}
      </div>
    </section>
  );
}

function ZoomModal({
  image,
  onClose,
}: {
  image: ZoomImage | null;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const gestureRef = useRef<{
    distance: number;
    scale: number;
    offsetX: number;
    offsetY: number;
    centerX: number;
    centerY: number;
    panX: number;
    panY: number;
    lastTapAt: number;
  }>({
    distance: 0,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    centerX: 0,
    centerY: 0,
    panX: 0,
    panY: 0,
    lastTapAt: 0,
  });

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [image]);

  if (image == null) {
    return null;
  }

  function clampZoom(value: number): number {
    return Math.max(1, Math.min(6, value));
  }

  function touchDistance(touches: React.TouchList): number {
    if (touches.length < 2) {
      return 0;
    }
    const left = touches[0];
    const right = touches[1];
    return Math.hypot(right.clientX - left.clientX, right.clientY - left.clientY);
  }

  function touchCenter(touches: React.TouchList): { x: number; y: number } {
    if (touches.length < 2) {
      return { x: touches[0]?.clientX ?? 0, y: touches[0]?.clientY ?? 0 };
    }
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  function resetZoom(): void {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>): void {
    if (event.touches.length === 2) {
      const center = touchCenter(event.touches);
      gestureRef.current = {
        ...gestureRef.current,
        distance: touchDistance(event.touches),
        scale,
        offsetX: offset.x,
        offsetY: offset.y,
        centerX: center.x,
        centerY: center.y,
      };
      return;
    }

    if (event.touches.length === 1) {
      const now = Date.now();
      if (now - gestureRef.current.lastTapAt < 280) {
        resetZoom();
        gestureRef.current.lastTapAt = 0;
        return;
      }
      gestureRef.current = {
        ...gestureRef.current,
        panX: event.touches[0].clientX,
        panY: event.touches[0].clientY,
        offsetX: offset.x,
        offsetY: offset.y,
        lastTapAt: now,
      };
    }
  }

  function handleTouchMove(event: React.TouchEvent<HTMLDivElement>): void {
    if (event.touches.length === 2 && gestureRef.current.distance > 0) {
      event.preventDefault();
      const center = touchCenter(event.touches);
      const nextScale = clampZoom(gestureRef.current.scale * (touchDistance(event.touches) / gestureRef.current.distance));
      const scaleRatio = nextScale / Math.max(1, gestureRef.current.scale);
      setScale(nextScale);
      setOffset({
        x: gestureRef.current.offsetX * scaleRatio + (center.x - gestureRef.current.centerX),
        y: gestureRef.current.offsetY * scaleRatio + (center.y - gestureRef.current.centerY),
      });
      return;
    }

    if (event.touches.length === 1 && scale > 1) {
      event.preventDefault();
      setOffset({
        x: gestureRef.current.offsetX + event.touches[0].clientX - gestureRef.current.panX,
        y: gestureRef.current.offsetY + event.touches[0].clientY - gestureRef.current.panY,
      });
    }
  }

  function setZoom(value: number): void {
    const nextScale = clampZoom(value);
    setScale(nextScale);
    if (nextScale === 1) {
      setOffset({ x: 0, y: 0 });
    }
  }

  return (
    <div className="zoom-modal" role="dialog" aria-modal="true" aria-label={image.label}>
      <div className="zoom-modal__bar">
        <div>
          <strong>{image.label}</strong>
          {image.width != null && image.height != null ? <span>{image.width} x {image.height} px</span> : null}
        </div>
        <button className="button-secondary" onClick={onClose} type="button">
          Schliessen
        </button>
      </div>
      <div className="zoom-modal__viewport">
        <div
          className="zoom-modal__gesture-layer"
          onDoubleClick={resetZoom}
          onTouchMove={handleTouchMove}
          onTouchStart={handleTouchStart}
        >
          <img
            src={image.src}
            alt={image.label}
            draggable={false}
            style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})` }}
          />
        </div>
      </div>
      <div className="zoom-modal__controls">
        <button className="button-secondary" onClick={() => setZoom(scale - 0.5)} type="button">
          -
        </button>
        <input
          aria-label="Zoom"
          max={6}
          min={1}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setZoom(Number(event.currentTarget.value))}
          step={0.25}
          type="range"
          value={scale}
        />
        <button className="button-secondary" onClick={() => setZoom(scale + 0.5)} type="button">
          +
        </button>
      </div>
    </div>
  );
}

export function App() {
  const browserFileInputRef = useRef<HTMLInputElement | null>(null);
  const [screen, setScreen] = useState<ScreenState>({ name: 'splash' });
  const [debugSettings, setDebugSettings] = useState<GeneratorSettings>(() => getDefaultRunSettings(DEFAULT_COLOR_COUNT));
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isBrowserPreview, setIsBrowserPreview] = useState(false);
  const [resultPngPreviewUrl, setResultPngPreviewUrl] = useState<string | null>(null);
  const [resultPreviewError, setResultPreviewError] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [zoomImage, setZoomImage] = useState<ZoomImage | null>(null);
  const [savedDebugConfig, setSavedDebugConfig] = useState<string | null>(null);
  const [debugConfigMessage, setDebugConfigMessage] = useState<string | null>(null);
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
              ? { name: 'upload', colorCount: DEFAULT_COLOR_COUNT, debugMode: false }
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
              debugMode: current.debugMode,
            };
          }
          if (current.name === 'processing') {
            return {
              name: 'upload',
              colorCount: current.colorCount,
              debugMode: current.debugMode,
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
          setScreen((current) => {
            const colorCount = current.name === 'upload' ? current.colorCount : DEFAULT_COLOR_COUNT;
            const debugMode = current.name === 'upload' ? current.debugMode : false;
            return {
              name: 'config',
              source: event.payload,
              colorCount,
              debugMode,
            };
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
                settings: current.runSettings,
                debugMode: current.debugMode,
              },
            });

            return {
              ...current,
              source: posterizedSource,
              progressPhase: 'paintByNumbers',
              progressValue: 0,
              progressMessage: 'Das KI-Bild ist bereit. Die lokale Malvorlage wird berechnet...',
              progressPreview: undefined,
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
            progressValue: event.payload.progress ?? current.progressValue,
            progressMessage: event.payload.message,
            progressPreview: event.payload.preview ?? current.progressPreview,
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
          const debugMode = current.name === 'processing' ? current.debugMode : result.debug?.enabled === true;
          const runSettings = current.name === 'processing'
            ? current.runSettings
            : result.debug?.parameterConfig ?? getDefaultRunSettings(colorCount);
          const debugStartStage = current.name === 'processing' ? current.debugStartStage : result.debug?.rerunFromStage;
          saveCreation(source, result);
          return {
            name: 'result',
            source,
            result,
            colorCount,
            debugMode,
            debugStartStage,
            runSettings,
          };
        });
        if (result.debug?.parameterConfig != null) {
          setDebugSettings(result.debug.parameterConfig);
        }
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
            ? { name: 'upload', colorCount: DEFAULT_COLOR_COUNT, debugMode: false }
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

  async function handleBrowserFileSelected(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file == null) {
      return;
    }

    try {
      setErrorBanner(null);
      const source = await createBrowserPreviewSource(file);
      setScreen((current) => ({
        name: 'config',
        source,
        colorCount: current.name === 'upload' ? current.colorCount : DEFAULT_COLOR_COUNT,
        debugMode: current.name === 'upload' ? current.debugMode : false,
      }));
    } catch (error) {
      setErrorBanner(error instanceof Error ? error.message : 'Das Bild konnte in der Browser-Vorschau nicht geladen werden.');
    }
  }

  function startUploadFlow(): void {
    if (isBrowserPreview) {
      setErrorBanner(null);
      browserFileInputRef.current?.click();
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

  function startCameraFlow(): void {
    if (isBrowserPreview) {
      setErrorBanner('Kameraaufnahme braucht die Expo-WebView-App. In der Browser-Vorschau kannst du stattdessen eine Bilddatei auswählen.');
      browserFileInputRef.current?.click();
      return;
    }
    setErrorBanner(null);
    const requestId = createRequestId('camera');
    activePickRequestIdRef.current = requestId;
    bridge.send({
      type: 'captureImage',
      requestId,
      payload: null,
    });
  }

  function updateScreenColorCount(colorCount: number): void {
    const clamped = clampColorCount(colorCount);
    setDebugSettings(getDefaultRunSettings(clamped));
    setSavedDebugConfig(null);
    setDebugConfigMessage(null);
    setScreen((current) => {
      if (current.name === 'upload') {
        return { ...current, colorCount: clamped };
      }
      if (current.name === 'config') {
        return { ...current, colorCount: clamped };
      }
      return current;
    });
  }

  function updateDebugMode(enabled: boolean): void {
    const currentColorCount =
      screen.name === 'upload' || screen.name === 'config'
        ? screen.colorCount
        : DEFAULT_COLOR_COUNT;
    setDebugSettings(getDefaultRunSettings(currentColorCount));
    setSavedDebugConfig(null);
    setDebugConfigMessage(null);
    setScreen((current) => {
      if (current.name === 'upload') {
        return { ...current, debugMode: enabled };
      }
      if (current.name === 'config') {
        return { ...current, debugMode: enabled };
      }
      return current;
    });
  }

  function changeDebugParameter(parameter: GeneratorDebugParameter, value: number | boolean): void {
    setDebugSettings((current) => updateDebugSettingValue(current, parameter, value));
    setSavedDebugConfig(null);
    setDebugConfigMessage(null);
  }

  function startDebugRerun(stage: GeneratorStage): void {
    if (screen.name !== 'result') {
      return;
    }
    if (isBrowserPreview) {
      setErrorBanner('Debug-Reruns brauchen die Expo-WebView-App.');
      return;
    }

    const runSettings = normalizeDebugSettings(debugSettings);
    const requestId = createRequestId('debug-run');
    activeRunRequestIdRef.current = requestId;
    setErrorBanner(null);
    setScreen({
      name: 'processing',
      source: screen.source,
      colorCount: Math.max(1, Math.round(runSettings.kMeansNrOfClusters)),
      debugMode: true,
      debugStartStage: stage,
      runSettings,
      progressPhase: 'paintByNumbers',
      progressValue: 0,
      progressMessage: `Debug-Rerun ab ${stage} wird gestartet...`,
      progressPreview: undefined,
    });
    bridge.send({
      type: 'runPaintByNumbers',
      requestId,
      payload: {
        sourceToken: screen.source.sourceToken,
        settings: runSettings,
        debugMode: true,
        debugStartStage: stage,
      },
    });
  }

  function saveDebugParameterConfig(): void {
    if (screen.name !== 'result') {
      return;
    }
    const payload = {
      kind: 'happy-numbers-generator-debug-config',
      savedAt: new Date().toISOString(),
      sourceLabel: screen.source.label,
      rerunFromStage: screen.debugStartStage ?? screen.result.debug?.rerunFromStage ?? null,
      finalVariant: screen.result.debug?.finalVariantId ?? DEBUG_FINAL_VARIANT_LABEL,
      settings: normalizeDebugSettings(debugSettings),
    };
    const json = JSON.stringify(payload, null, 2);
    setSavedDebugConfig(json);
    setDebugConfigMessage('Konfiguration erstellt.');
    const copyPromise = navigator.clipboard?.writeText(json);
    if (copyPromise == null) {
      setDebugConfigMessage('Konfiguration erstellt. Kopieren ist in dieser WebView eventuell gesperrt.');
      return;
    }
    void copyPromise
      .then(() => setDebugConfigMessage('Konfiguration erstellt und in die Zwischenablage kopiert.'))
      .catch(() => setDebugConfigMessage('Konfiguration erstellt. Kopieren ist in dieser WebView eventuell gesperrt.'));
  }

  function launchPosterizeAndRun(source: WebImageSource, colorCount: number): void {
    if (isBrowserPreview) {
      setErrorBanner('Der App-Flow funktioniert erst eingebettet in der Expo-WebView-App.');
      return;
    }

    const clampedColorCount = clampColorCount(colorCount);
    const complexity = complexityForColorCount(clampedColorCount);
    const currentDebugMode = screen.name === 'config' ? screen.debugMode : false;
    const runSettings = currentDebugMode
      ? normalizeDebugSettings(debugSettings)
      : getDefaultRunSettings(clampedColorCount);
    const requestId = createRequestId('posterize');
    activePosterizeRequestIdRef.current = requestId;
    setErrorBanner(null);
    setScreen({
      name: 'processing',
      source,
      colorCount: clampedColorCount,
      debugMode: currentDebugMode,
      runSettings,
      progressPhase: 'posterizeImage',
      progressValue: null,
      progressMessage: `Das Bild wird mit ${clampedColorCount} Farben posterisiert...`,
      progressPreview: undefined,
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
        <input
          ref={browserFileInputRef}
          accept="image/*"
          aria-label="Browser-Bilddatei auswählen"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            void handleBrowserFileSelected(event);
          }}
          style={{ display: 'none' }}
          type="file"
        />
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
            <DebugModeToggle enabled={screen.debugMode} onChange={updateDebugMode} />
            <button className="upload-panel" onClick={startUploadFlow}>
              <img src={uploadArt} alt="" />
              <div className="upload-panel__body">
                <strong>Bild auswählen</strong>
                <span>Aus deiner Galerie wählen oder direkt mit der Kamera aufnehmen.</span>
              </div>
            </button>
            <div className="upload-actions">
              <button className="upload-action" onClick={startUploadFlow}>
                <span className="upload-action__icon upload-action__icon--gallery" aria-hidden="true" />
                <span>Galerie</span>
              </button>
              <button className="upload-action" onClick={startCameraFlow}>
                <span className="upload-action__icon upload-action__icon--camera" aria-hidden="true" />
                <span>Kamera</span>
              </button>
            </div>
            <ColorCountSelector
              value={screen.colorCount}
              onChange={updateScreenColorCount}
            />
          </>
        ) : null}

        {screen.name === 'config' ? (
          <>
            <Hero title={UI_TEXT.configTitle} subtitle={UI_TEXT.configSubtitle} />
            <section className="preview-frame">
              <img src={screen.source.previewDataUrl} alt={screen.source.label} />
            </section>
            <DebugModeToggle enabled={screen.debugMode} onChange={updateDebugMode} />
            <ColorCountSelector
              value={screen.colorCount}
              onChange={updateScreenColorCount}
            />
            <div className="toolbar">
              <button className="button-secondary" onClick={() => setScreen({ name: 'upload', colorCount: screen.colorCount, debugMode: screen.debugMode })}>
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
            <ProcessingLivePreview
              source={screen.source}
              snapshot={screen.progressPreview}
              phase={screen.progressPhase}
              onOpenImage={setZoomImage}
            />
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
                <button
                  className="preview-frame__zoom-button"
                  onClick={() => setZoomImage({
                    src: resultPngPreviewUrl,
                    label: selectedVariant?.label ?? 'Fertige Malvorlage',
                    width: selectedVariant?.pngWidth ?? screen.result.previewPngWidth,
                    height: selectedVariant?.pngHeight ?? screen.result.previewPngHeight,
                  })}
                  type="button"
                >
                  <img className="result-image" src={resultPngPreviewUrl} alt={selectedVariant?.label ?? 'Fertige Malvorlage'} />
                  <span>Tippen zum Zoomen</span>
                </button>
              ) : resultPreviewError != null ? (
                <div className="empty-state">
                  Die SVG-Datei wurde erstellt, aber die PNG-Vorschau konnte nicht geladen werden.
                  {resultSvgSource != null ? <span> Du kannst die Vorlage trotzdem speichern.</span> : null}
                </div>
              ) : (
                <div className="empty-state">PNG-Vorschau wird vorbereitet...</div>
              )}
            </section>
            {resultVariants.length > 0 && !screen.debugMode ? (
              <section className="glass-panel output-picker">
                <label className="field-label" htmlFor="output-variant-select">Ausgabe</label>
                <select
                  className="output-picker__select"
                  id="output-variant-select"
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setSelectedVariantId(event.target.value)}
                  value={selectedVariant?.id ?? ''}
                >
                  {resultVariants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.label}
                    </option>
                  ))}
                </select>
                {selectedVariant?.description != null && selectedVariant.description.length > 0 ? (
                  <p className="output-picker__description">{selectedVariant.description}</p>
                ) : null}
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
              <div>
                {screen.result.facetCount} ausmalbare Flächen erzeugt
                {screen.debugMode ? ` · ${DEBUG_FINAL_VARIANT_LABEL}` : ''}
              </div>
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
            {screen.debugMode && screen.result.debug != null ? (
              <PipelineDebugPanel
                stages={screen.result.debug.stages}
                settings={debugSettings}
                savedConfig={savedDebugConfig}
                saveMessage={debugConfigMessage}
                onChangeSetting={changeDebugParameter}
                onOpenImage={setZoomImage}
                onRerunFromStage={startDebugRerun}
                onSaveConfig={saveDebugParameterConfig}
              />
            ) : null}
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
              <button className="button-secondary" onClick={() => setScreen({ name: 'upload', colorCount: screen.colorCount, debugMode: screen.debugMode })}>
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
      <ZoomModal image={zoomImage} onClose={() => setZoomImage(null)} />
    </main>
  );
}
