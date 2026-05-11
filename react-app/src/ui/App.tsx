import React, { useEffect, useMemo, useRef, useState } from 'react';

import backgroundArt from '../../../App/assets/Background.png';
import createArt from '../../../App/assets/Create.png';
import uploadArt from '../../../App/assets/Upload.png';
import type {
  GeneratorResult,
  WebImageSource,
  WebViewHostEvent,
} from '../../../App/src/features/webview/appWebViewBridgeTypes';
import { UI_TEXT } from '../content/uiText';
import { buildIdeaPrompt } from '../lib/promptBuilder';
import { DEFAULT_SETTINGS, settingsForPreset, type DetailPreset } from '../lib/settings';
import { WebViewBridge } from '../lib/webviewBridge';
import { IDEA_CHIPS } from '../prompts/ideaChips';

type ScreenState =
  | { name: 'splash' }
  | { name: 'hub' }
  | {
      name: 'idea';
      ideaText: string;
      detailPreset: DetailPreset;
    }
  | {
      name: 'config';
      flow: 'uploaded' | 'idea';
      source?: WebImageSource;
      ideaText?: string;
      detailPreset: DetailPreset;
      outputMode: 'paintByNumbers';
    }
  | {
      name: 'processing';
      flow: 'uploaded' | 'idea';
      source?: WebImageSource;
      ideaText?: string;
      detailPreset: DetailPreset;
      progressPhase: 'ideaImage' | 'paintByNumbers';
      progressValue: number | null;
      progressMessage: string;
    }
  | {
      name: 'result';
      flow: 'uploaded' | 'idea';
      source: WebImageSource;
      result: GeneratorResult;
      detailPreset: DetailPreset;
      ideaText?: string;
    };

type StoredCreation = {
  id: string;
  title: string;
  createdAt: number;
  thumbnailDataUrl: string;
  sourceLabel: string;
  resultSvg: string;
};

const bridge = new WebViewBridge();
const RECENT_STORAGE_KEY = 'paintbynumbers.recentCreations';

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function encodeSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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
    return parsed;
  } catch {
    return [];
  }
}

function writeStoredCreations(value: StoredCreation[]): void {
  window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(value));
}

function saveCreation(source: WebImageSource, result: GeneratorResult, ideaText?: string): StoredCreation {
  const entry: StoredCreation = {
    id: `${Date.now()}`,
    title: ideaText?.trim() || source.label,
    createdAt: Date.now(),
    thumbnailDataUrl: encodeSvgDataUrl(result.svg),
    sourceLabel: source.label,
    resultSvg: result.svg,
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
      <div className="topbar__pill">WebView Studio</div>
    </header>
  );
}

function Hero({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <section className="hero">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </section>
  );
}

export function App() {
  const [screen, setScreen] = useState<ScreenState>({ name: 'splash' });
  const [recentCreations, setRecentCreations] = useState<StoredCreation[]>(() => readStoredCreations());
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isBrowserPreview, setIsBrowserPreview] = useState(false);
  const activePickRequestIdRef = useRef<string | null>(null);
  const activeRunRequestIdRef = useRef<string | null>(null);
  const activeIdeaRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    const hasNativeHost = typeof window.ReactNativeWebView?.postMessage === 'function';
    const unsubscribe = bridge.subscribe((event: WebViewHostEvent) => {
      if (event.type === 'hostReady') {
        window.setTimeout(() => {
          setScreen((current) => (current.name === 'splash' ? { name: 'hub' } : current));
        }, 700);
        return;
      }

      if (event.type === 'error') {
        setErrorBanner(event.error.message);
        setScreen((current) => {
          if (current.name === 'processing' && current.flow === 'idea' && event.error.stage === 'ideaImage') {
            return {
              name: 'config',
              flow: 'idea',
              detailPreset: current.detailPreset,
              ideaText: current.ideaText,
              outputMode: 'paintByNumbers',
            };
          }

          if (current.name === 'processing' && current.source != null) {
            return {
              name: 'config',
              flow: current.flow,
              source: current.source,
              ideaText: current.ideaText,
              detailPreset: current.detailPreset,
              outputMode: 'paintByNumbers',
            };
          }

          return current;
        });
        return;
      }

      if (event.type === 'sourceReady') {
        if (event.requestId === activePickRequestIdRef.current && event.payload.kind === 'uploaded') {
          activePickRequestIdRef.current = null;
          setScreen({
            name: 'config',
            flow: 'uploaded',
            source: event.payload,
            detailPreset: 'medium',
            outputMode: 'paintByNumbers',
          });
          return;
        }

        if (event.requestId === activeIdeaRequestIdRef.current) {
          activeIdeaRequestIdRef.current = null;
          const source = event.payload;
          setScreen((current) => {
            if (current.name !== 'processing' || current.flow !== 'idea') {
              return current;
            }

            const runRequestId = createRequestId('run');
            activeRunRequestIdRef.current = runRequestId;
            bridge.send({
              type: 'runPaintByNumbers',
              requestId: runRequestId,
              payload: {
                sourceToken: source.sourceToken,
                settings: settingsForPreset(current.detailPreset),
              },
            });

            return {
              ...current,
              source,
              progressPhase: 'paintByNumbers',
              progressValue: 0,
              progressMessage: 'Das Ideenbild wurde erzeugt. Jetzt entsteht deine Malvorlage...',
            };
          });
        }
        return;
      }

      if (event.type === 'processingProgress') {
        const isRelevant =
          event.requestId === activeRunRequestIdRef.current ||
          event.requestId === activeIdeaRequestIdRef.current;

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
          const ideaText = current.name === 'processing' ? current.ideaText : undefined;
          const detailPreset = current.name === 'processing' ? current.detailPreset : 'medium';
          const flow = current.name === 'processing' ? current.flow : source.kind === 'uploaded' ? 'uploaded' : 'idea';
          saveCreation(source, result, ideaText);
          setRecentCreations(readStoredCreations());
          return {
            name: 'result',
            flow,
            source,
            result,
            detailPreset,
            ideaText,
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
        setScreen((current) => (current.name === 'splash' ? { name: 'hub' } : current));
      }, 700);
    }

    return unsubscribe;
  }, []);

  const currentIdeaText = screen.name === 'idea' ? screen.ideaText : screen.name === 'config' ? screen.ideaText ?? '' : '';
  const currentIdeaPreset =
    screen.name === 'idea' || screen.name === 'config' || screen.name === 'processing' || screen.name === 'result'
      ? screen.detailPreset
      : 'medium';

  const canStartIdea = currentIdeaText.trim().length >= 8;

  const resultDataUrl = useMemo(() => {
    if (screen.name !== 'result') {
      return null;
    }
    return encodeSvgDataUrl(screen.result.svg);
  }, [screen]);

  function startUploadFlow(): void {
    if (isBrowserPreview) {
      setErrorBanner('Bildauswahl ist in der reinen Browser-Vorschau nicht verdrahtet. Bitte nutze dafuer die Expo-WebView-App.');
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

  function beginIdeaFlow(): void {
    setErrorBanner(null);
    setScreen({
      name: 'idea',
      ideaText: '',
      detailPreset: 'medium',
    });
  }

  function launchIdeaGeneration(ideaText: string, detailPreset: DetailPreset): void {
    if (isBrowserPreview) {
      setErrorBanner('Ideenbild-Erzeugung ist in der Browser-Vorschau nicht aktiv. Bitte teste den Flow in der Expo-WebView-App.');
      return;
    }
    setErrorBanner(null);
    const prompt = buildIdeaPrompt({ ideaText, detailLevel: detailPreset });
    const requestId = createRequestId('idea');
    activeIdeaRequestIdRef.current = requestId;
    setScreen({
      name: 'processing',
      flow: 'idea',
      ideaText,
      detailPreset,
      progressPhase: 'ideaImage',
      progressValue: null,
      progressMessage: 'Wir erzeugen zuerst ein passendes Ideenbild...',
    });
    bridge.send({
      type: 'generateIdeaImage',
      requestId,
      payload: {
        prompt,
        label: ideaText.trim(),
      },
    });
  }

  function launchPaintByNumbers(source: WebImageSource, detailPreset: DetailPreset, flow: 'uploaded' | 'idea', ideaText?: string): void {
    if (isBrowserPreview) {
      setErrorBanner('Die Paint-by-Numbers-Verarbeitung ist in der Browser-Vorschau nicht aktiv. Bitte teste den Flow in der Expo-WebView-App.');
      return;
    }
    setErrorBanner(null);
    const requestId = createRequestId('run');
    activeRunRequestIdRef.current = requestId;
    setScreen({
      name: 'processing',
      flow,
      source,
      ideaText,
      detailPreset,
      progressPhase: 'paintByNumbers',
      progressValue: 0,
      progressMessage: 'Die Paint-by-Numbers-Vorlage wird erstellt...',
    });
    bridge.send({
      type: 'runPaintByNumbers',
      requestId,
      payload: {
        sourceToken: source.sourceToken,
        settings: settingsForPreset(detailPreset),
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
              <div>Die UI laeuft ohne Expo-WebView-Host. Der komplette Generator-Flow funktioniert erst eingebettet in der App.</div>
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

        {screen.name === 'hub' ? (
          <>
            <Hero eyebrow="Kreativ starten" title={UI_TEXT.hubTitle} subtitle={UI_TEXT.hubSubtitle} />
            <div className="hub-grid">
              <button className="feature-card" onClick={beginIdeaFlow}>
                <img src={createArt} alt="" />
                <div className="feature-card__overlay" />
                <div className="feature-card__content">
                  <h3>{UI_TEXT.createCardTitle}</h3>
                  <p>{UI_TEXT.createCardSubtitle}</p>
                </div>
              </button>
              <button className="feature-card" onClick={startUploadFlow}>
                <img src={uploadArt} alt="" />
                <div className="feature-card__overlay" />
                <div className="feature-card__content">
                  <h3>{UI_TEXT.uploadCardTitle}</h3>
                  <p>{UI_TEXT.uploadCardSubtitle}</p>
                </div>
              </button>
            </div>

            <section className="recent-section">
              <div className="hero" style={{ marginTop: 0 }}>
                <h2 style={{ fontSize: '1.9rem', marginBottom: 0 }}>Letzte Vorlagen</h2>
              </div>
              {recentCreations.length === 0 ? (
                <div className="empty-state">Noch keine gespeicherte Vorlage. Starte mit einer Idee oder lade ein Bild hoch.</div>
              ) : (
                <div className="recent-grid">
                  {recentCreations.map((creation: StoredCreation) => (
                    <article className="recent-card" key={creation.id}>
                      <img className="recent-card__thumb" src={creation.thumbnailDataUrl} alt={creation.title} />
                      <div className="recent-card__body">
                        <h4>{creation.title}</h4>
                        <p>{new Date(creation.createdAt).toLocaleDateString('de-DE')}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}

        {screen.name === 'idea' ? (
          <>
            <Hero eyebrow="Schritt 1" title={UI_TEXT.ideaScreenTitle} subtitle={UI_TEXT.ideaScreenSubtitle} />
            <section className="glass-panel">
              <label className="field-label" htmlFor="ideaText">
                Beschreibe dein Motiv
              </label>
              <textarea
                id="ideaText"
                className="idea-input"
                placeholder="Zum Beispiel: Eine freundliche Waldfee zwischen Blumen und Schmetterlingen..."
                value={screen.ideaText}
                onChange={(event: { target: HTMLTextAreaElement; currentTarget: HTMLTextAreaElement }) => {
                  setScreen({
                    ...screen,
                    ideaText: event.target.value,
                  });
                }}
              />
              <div className="chips">
                {IDEA_CHIPS.map((chip) => (
                  <button
                    className="chip"
                    key={chip}
                    onClick={() => {
                      const nextText = screen.ideaText.trim().length === 0 ? chip : `${screen.ideaText.trim()}, ${chip}`;
                      setScreen({
                        ...screen,
                        ideaText: nextText,
                      });
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </section>
            <section className="glass-panel">
              <span className="field-label">Detailgrad</span>
              <div className="config-grid config-grid--three">
                {(['low', 'medium', 'high'] as DetailPreset[]).map((preset) => (
                  <button
                    className={`select-card ${screen.detailPreset === preset ? 'select-card--selected' : ''}`}
                    key={preset}
                    onClick={() => setScreen({ ...screen, detailPreset: preset })}
                  >
                    <div className="select-card__header">
                      {preset === 'low' ? 'Einfach' : preset === 'medium' ? 'Mittel' : 'Detailreich'}
                    </div>
                    <div className="select-card__meta">
                      {preset === 'low'
                        ? 'Grosse Flaechen und ruhiges Motiv'
                        : preset === 'medium'
                          ? 'Ausgewogene Vorlage'
                          : 'Mehr Struktur bei klarer Lesbarkeit'}
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <div className="toolbar">
              <button className="button-secondary" onClick={() => setScreen({ name: 'hub' })}>
                Zurueck
              </button>
              <button
                className="button-primary"
                disabled={!canStartIdea}
                onClick={() =>
                  setScreen({
                    name: 'config',
                    flow: 'idea',
                    ideaText: screen.ideaText,
                    detailPreset: screen.detailPreset,
                    outputMode: 'paintByNumbers',
                  })
                }
              >
                Weiter zur Vorlage
              </button>
            </div>
          </>
        ) : null}

        {screen.name === 'config' ? (
          <>
            <Hero eyebrow="Schritt 2" title={UI_TEXT.configTitle} subtitle={UI_TEXT.configSubtitle} />
            {screen.source != null ? (
              <section className="preview-frame">
                <img src={screen.source.previewDataUrl} alt={screen.source.label} />
              </section>
            ) : screen.flow === 'idea' ? (
              <section className="glass-panel">
                <span className="field-label">Idee</span>
                <div>{screen.ideaText}</div>
              </section>
            ) : null}
            <section className="glass-panel">
              <span className="field-label">Ausgabemodus</span>
              <div className="config-grid config-grid--two">
                <button className="select-card select-card--selected">
                  <div className="select-card__header">Malen nach Zahlen</div>
                  <div className="select-card__meta">Die bestehende Vorlage mit Zahlen und Regionen.</div>
                </button>
                <button className="select-card" disabled>
                  <div className="select-card__header">Klassisch</div>
                  <div className="select-card__meta">Kommt spaeter. Fuer jetzt ist nur die PBN-Vorlage aktiv.</div>
                </button>
              </div>
            </section>
            <section className="glass-panel">
              <span className="field-label">Detailgrad</span>
              <div className="config-grid config-grid--three">
                {(['low', 'medium', 'high'] as DetailPreset[]).map((preset) => (
                  <button
                    className={`select-card ${screen.detailPreset === preset ? 'select-card--selected' : ''}`}
                    key={preset}
                    onClick={() => setScreen({ ...screen, detailPreset: preset })}
                  >
                    <div className="select-card__header">
                      {preset === 'low' ? 'Einfach' : preset === 'medium' ? 'Mittel' : 'Detailreich'}
                    </div>
                    <div className="select-card__meta">
                      {preset === 'low'
                        ? 'Weniger Farben und groebere Bereiche'
                        : preset === 'medium'
                          ? 'Der empfohlene Mittelweg'
                          : 'Mehr Farben und feinere Regionen'}
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <div className="toolbar">
              <button
                className="button-secondary"
                onClick={() =>
                  setScreen(
                    screen.flow === 'idea'
                      ? {
                          name: 'idea',
                          ideaText: screen.ideaText ?? '',
                          detailPreset: screen.detailPreset,
                        }
                      : { name: 'hub' },
                  )
                }
              >
                Zurueck
              </button>
              <button
                className="button-primary"
                onClick={() => {
                  if (screen.flow === 'idea' && screen.ideaText != null) {
                    launchIdeaGeneration(screen.ideaText, screen.detailPreset);
                    return;
                  }
                  if (screen.source != null) {
                    launchPaintByNumbers(screen.source, screen.detailPreset, screen.flow, screen.ideaText);
                  }
                }}
              >
                Malvorlage erstellen
              </button>
            </div>
          </>
        ) : null}

        {screen.name === 'processing' ? (
          <>
            <Hero eyebrow="Verarbeitung" title={UI_TEXT.processingTitle} subtitle={screen.progressMessage} />
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
                <strong>{screen.progressPhase === 'ideaImage' ? 'Ideenbild wird erzeugt' : 'Paint-by-Numbers wird berechnet'}</strong>
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
            <Hero eyebrow="Fertig" title={UI_TEXT.resultTitle} subtitle={UI_TEXT.resultSubtitle} />
            <section className="preview-frame">
              <div className="svg-frame" dangerouslySetInnerHTML={{ __html: screen.result.svg }} />
            </section>
            <section className="glass-panel">
              <span className="field-label">Quelle</span>
              <div>{screen.source.label}</div>
              {screen.ideaText != null ? (
                <>
                  <span className="field-label" style={{ marginTop: 16 }}>
                    Idee
                  </span>
                  <div>{screen.ideaText}</div>
                </>
              ) : null}
            </section>
            <section className="glass-panel">
              <span className="field-label">Palette</span>
              <div className="palette-list">
                {screen.result.palette.slice(0, 8).map((entry: GeneratorResult['palette'][number]) => (
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
                        {Math.round(entry.areaPercentage * 100)}% Flaeche
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <div className="toolbar">
              <button className="button-secondary" onClick={() => setScreen({ name: 'hub' })}>
                Zum Start
              </button>
              <a className="button-primary" href={resultDataUrl ?? '#'} download="happy-lines-malvorlage.svg">
                SVG speichern
              </a>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
