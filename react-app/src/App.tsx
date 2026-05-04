import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

const PIPELINE_STEPS = [
  { id: 'normalize', label: 'Normalize & Resize', description: 'Loads image, resizes to max dimension, and pads transparent areas with white' },
  { id: 'smooth', label: 'Bilateral Smoothing', description: 'Softens noise while keeping edges sharp using bilateral filter (d=9, σ=50)' },
  { id: 'quantize', label: 'K-Means Quantize', description: 'Reduces colors via oversampled K-Means in Lab space, then merges nearest centers back to target count' },
  { id: 'protrusions', label: 'Protrusion Pruning', description: 'Cleans thin 1-2px strips between regions by reassigning to similar-color neighbors; high-contrast detail is preserved' },
  { id: 'region-merge', label: 'Region Merging', description: 'Merges regions smaller than min-size into their most color-similar neighbor using Lab distance' },
  { id: 'render', label: 'Final Render', description: 'Generates 5 template styles (color circles, numbers, classic, etc.) with label placements' },
] as const;

const EXAMPLE_IMAGE_URL = "./eagle.png";
const EXAMPLE_IMAGE_NAME = "eagle.png";

type StepId = (typeof PIPELINE_STEPS)[number]['id'];

type StepResult = {
  objectUrl: string;
  width: number;
  height: number;
  colorCount?: number;
  paletteRgb?: number[];
};

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const [openCvStatus, setOpenCvStatus] = useState<"loading" | "ready" | "error">("loading");
  const [openCvStatusMessage, setOpenCvStatusMessage] = useState("OpenCV loading in Web Worker...");
  const [imageLoaded, setImageLoaded] = useState(false);
  const [runningStep, setRunningStep] = useState<StepId | null>(null);
  const [completedStep, setCompletedStep] = useState<number>(-1); // index into PIPELINE_STEPS, -1 = none
  const [stepResults, setStepResults] = useState<Map<StepId, StepResult>>(new Map());
  const [stepTimings, setStepTimings] = useState<Map<StepId, number>>(new Map());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [targetColorCount, setTargetColorCount] = useState(24);
  const [resizeMax, setResizeMax] = useState(1200);
  const [minRegionSize, setMinRegionSize] = useState(200);
  const [maxRegions, setMaxRegions] = useState(0);
  const [protectHighContrast, setProtectHighContrast] = useState(false);
  const [highContrastMinPx, setHighContrastMinPx] = useState(20);
  const [pruneRadius, setPruneRadius] = useState(1);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [templateUrls, setTemplateUrls] = useState<{ label: string; url: string }[]>([]);
  const [renderStats, setRenderStats] = useState<{ regionCount: number; placementCount: number } | null>(null);

  // ── Worker init ──
  useEffect(() => {
    const worker = new Worker(new URL('./lib/worker.ts', import.meta.url));
    workerRef.current = worker;
    const startedAt = performance.now();

    worker.onmessage = (e) => {
      const { type, error } = e.data;
      if (type === 'READY') {
        const sec = ((performance.now() - startedAt) / 1000).toFixed(1);
        setOpenCvStatus("ready");
        setOpenCvStatusMessage(`OpenCV ready in ${sec}s (Web Worker)`);
      } else if (type === 'ERROR') {
        setOpenCvStatus("error");
        setOpenCvStatusMessage("Worker error: " + error);
      }
    };

    worker.postMessage({ type: 'INIT' });
    return () => worker.terminate();
  }, []);

  // ── Cleanup object URLs on unmount ──
  useEffect(() => {
    return () => {
      if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
      stepResults.forEach((sr) => URL.revokeObjectURL(sr.objectUrl));
    };
  }, [sourcePreviewUrl, stepResults]);

  // ── Send a message to the worker and wait for a typed response ──
  const sendWorkerMessage = useCallback(
    (msgType: string, msgPayload: any): Promise<any> => {
      return new Promise((resolve, reject) => {
        const worker = workerRef.current;
        if (!worker) return reject(new Error("Worker not initialized"));

        const handler = (e: MessageEvent) => {
          const { type, payload, error } = e.data;
          if (type === 'STEP_SUCCESS') {
            worker.removeEventListener('message', handler);
            resolve(payload);
          } else if (type === 'ERROR') {
            worker.removeEventListener('message', handler);
            reject(new Error(error));
          }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: msgType, payload: msgPayload });
      });
    },
    [],
  );

  async function loadImageFile(nextFile: File | null) {
    setErrorMessage(null);
    setSelectedFile(nextFile);
    setImageLoaded(false);
    setCompletedStep(-1);
    setRunningStep(null);

    // Clear old results
    stepResults.forEach((sr) => URL.revokeObjectURL(sr.objectUrl));
    setStepResults(new Map());
    setStepTimings(new Map());
    templateUrls.forEach((t) => URL.revokeObjectURL(t.url));
    setTemplateUrls([]);
    setRenderStats(null);

    if (!nextFile) {
      setSourcePreviewUrl(null);
      return;
    }

    setSourcePreviewUrl(URL.createObjectURL(nextFile));

    if (openCvStatus !== "ready") {
      setErrorMessage("OpenCV is still loading. Select image again after it's ready.");
      return;
    }

    try {
      const bitmap = await createImageBitmap(nextFile);
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close();

      await sendWorkerMessage('LOAD_IMAGE', { imageData });
      setImageLoaded(true);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load image into worker.");
    }
  }

  // ── File selected → load into worker ──
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    await loadImageFile(event.target.files?.[0] ?? null);
  }

  async function handleUseExampleImage() {
    try {
      const response = await fetch(EXAMPLE_IMAGE_URL);
      if (!response.ok) {
        throw new Error(`Failed to load ${EXAMPLE_IMAGE_NAME}: HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const file = new File([blob], EXAMPLE_IMAGE_NAME, { type: blob.type || "image/png" });
      await loadImageFile(file);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load eagle example.");
    }
  }

  // ── Run all pipeline steps sequentially ──
  async function runAll() {
    for (let i = 0; i < PIPELINE_STEPS.length; i++) {
      const ok = await runStep(i);
      if (!ok) break;
    }
  }

  // ── Run a single pipeline step ──
  async function runStep(stepIndex: number): Promise<boolean> {
    const step = PIPELINE_STEPS[stepIndex];
    setRunningStep(step.id);
    setErrorMessage(null);
    const t0 = performance.now();

    try {
      const options: any = {};
      if (step.id === 'normalize') options.resizeMax = resizeMax;
      if (step.id === 'quantize') options.colorCount = targetColorCount;
      if (step.id === 'protrusions') options.pruneRadius = pruneRadius;
      if (step.id === 'region-merge') { options.minRegionSize = minRegionSize; options.maxRegions = maxRegions > 0 ? maxRegions : undefined; options.protectHighContrast = protectHighContrast; options.highContrastMinPx = highContrastMinPx; }

      const result = await sendWorkerMessage('RUN_STEP', {
        stepId: step.id,
        options,
      });

      // Convert ImageData to blob URL
      const outCanvas = document.createElement('canvas');
      outCanvas.width = result.width;
      outCanvas.height = result.height;
      const ctx = outCanvas.getContext('2d')!;
      ctx.putImageData(result.result, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => {
        outCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('blob failed'))), 'image/png');
      });

      const objectUrl = URL.createObjectURL(blob);

      // If render step, also convert extra templates
      if (step.id === 'render' && result.templates) {
        const newTemplateUrls: { label: string; url: string }[] = [
          { label: 'Bright Color Circles', url: objectUrl },
        ];
        const templateEntries: [string, string][] = [
          ['colorCircles', 'Color Circles'],
          ['circlesOnly', 'Circles Only'],
          ['numbers', 'Numbers'],
          ['classic', 'Classic'],
          ['debugUnlabeled', 'Debug: Unlabeled (red)'],
        ];
        for (const [key, label] of templateEntries) {
          const imgData = result.templates[key] as ImageData;
          if (imgData) {
            const tc = document.createElement('canvas');
            tc.width = imgData.width;
            tc.height = imgData.height;
            tc.getContext('2d')!.putImageData(imgData, 0, 0);
            const tb = await new Promise<Blob>((resolve, reject) => {
              tc.toBlob((b) => (b ? resolve(b) : reject(new Error('blob failed'))), 'image/png');
            });
            newTemplateUrls.push({ label, url: URL.createObjectURL(tb) });
          }
        }
        // Revoke old template URLs
        templateUrls.forEach((t) => URL.revokeObjectURL(t.url));
        setTemplateUrls(newTemplateUrls);
        setRenderStats({
          regionCount: result.regionCount ?? 0,
          placementCount: result.placementCount ?? 0,
        });
      }

      setStepResults((prev) => {
        const next = new Map(prev);
        const old = next.get(step.id);
        if (old) URL.revokeObjectURL(old.objectUrl);
        next.set(step.id, {
          objectUrl,
          width: result.width,
          height: result.height,
          colorCount: result.colorCount,
          paletteRgb: result.paletteRgb,
        });
        return next;
      });
      setStepTimings((prev) => {
        const next = new Map(prev);
        next.set(step.id, performance.now() - t0);
        return next;
      });
      setCompletedStep(stepIndex);
      return true;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : `Step ${step.label} failed.`);
      return false;
    } finally {
      setRunningStep(null);
    }
  }

  return (
    <div className="page-shell">
      <div className="page-grid">
        {/* ── Header ── */}
        <section className="hero-card">
          <p className="eyebrow">Step-by-step pipeline</p>
          <h1 className="hero-title">OpenCV pipeline — run each step individually</h1>
          <p className="hero-copy">
            Upload an image, then click each step button in order. Every step feeds its result
            into the next one so you can inspect each intermediate stage.
          </p>
          <div className={`hero-chip engine-chip engine-chip-${openCvStatus}`}>{openCvStatusMessage}</div>
        </section>

        {/* ── Image upload ── */}
        <section className="card">
          <h2 className="section-title">Source image</h2>
          <div className="actions">
            <button type="button" className="primary-btn" onClick={() => fileInputRef.current?.click()}>
              {selectedFile ? "Choose another image" : "Upload image"}
            </button>
            <button type="button" className="secondary-btn" onClick={handleUseExampleImage}>
              Use eagle example
            </button>
            <input ref={fileInputRef} className="file-input" type="file" accept="image/*" onChange={handleFileChange} />
          </div>
          <div className="preview-frame" style={{ marginTop: 18 }}>
            {sourcePreviewUrl
              ? <img className="preview-image" src={sourcePreviewUrl} alt="Source preview" />
              : <p className="placeholder">Upload an image to begin.</p>}
          </div>
          {imageLoaded && <p className="footer-note" style={{ marginTop: 10, color: '#4a7' }}>Image loaded into worker — ready to run steps.</p>}
        </section>

        {/* ── Options ── */}
        <section className="card">
          <h2 className="section-title">Options</h2>
          <label className="meta-label" htmlFor="resize-max">Resize max (px)</label>
          <input
            id="resize-max"
            type="number"
            min={100}
            step={100}
            value={resizeMax}
            onChange={(e) => setResizeMax(Math.max(100, Number(e.target.value) || 1200))}
            style={{ marginTop: 4, minHeight: 44, borderRadius: 14, border: "1px solid rgba(120, 98, 70, 0.22)", padding: "0 14px", fontSize: "1rem", width: "100%" }}
          />
          <label className="meta-label" htmlFor="color-count" style={{ marginTop: 14, display: 'block' }}>K-Means color count</label>
          <input
            id="color-count"
            type="number"
            min={1}
            max={64}
            step={1}
            value={targetColorCount}
            onChange={(e) => setTargetColorCount(Math.max(1, Math.min(64, Number(e.target.value) || 24)))}
            style={{ marginTop: 4, minHeight: 44, borderRadius: 14, border: "1px solid rgba(120, 98, 70, 0.22)", padding: "0 14px", fontSize: "1rem", width: "100%" }}
          />
          <label className="meta-label" htmlFor="min-region" style={{ marginTop: 14, display: 'block' }}>Min region size (px)</label>
          <input
            id="min-region"
            type="number"
            min={1}
            step={5}
            value={minRegionSize}
            onChange={(e) => setMinRegionSize(Math.max(1, Number(e.target.value) || 200))}
            style={{ marginTop: 4, minHeight: 44, borderRadius: 14, border: "1px solid rgba(120, 98, 70, 0.22)", padding: "0 14px", fontSize: "1rem", width: "100%" }}
          />
          <label className="meta-label" htmlFor="max-regions" style={{ marginTop: 14, display: 'block' }}>Max regions</label>
          <input
            id="max-regions"
            type="number"
            min={0}
            step={10}
            value={maxRegions}
            onChange={(e) => setMaxRegions(Math.max(0, Number(e.target.value) || 0))}
            style={{ marginTop: 4, minHeight: 44, borderRadius: 14, border: "1px solid rgba(120, 98, 70, 0.22)", padding: "0 14px", fontSize: "1rem", width: "100%" }}
          />
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#888' }}>0 = unlimited, otherwise merge until at most this many regions remain</p>
          <label style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={protectHighContrast} onChange={(e) => setProtectHighContrast(e.target.checked)} />
            Protect high-contrast small regions
          </label>
          {protectHighContrast && (
            <>
              <label className="meta-label" htmlFor="hc-min-px" style={{ marginTop: 8, display: 'block' }}>High-contrast min size (px)</label>
              <input
                id="hc-min-px"
                type="number"
                min={1}
                step={5}
                value={highContrastMinPx}
                onChange={(e) => setHighContrastMinPx(Math.max(1, Number(e.target.value) || 20))}
                style={{ marginTop: 4, minHeight: 44, borderRadius: 14, border: "1px solid rgba(120, 98, 70, 0.22)", padding: "0 14px", fontSize: "1rem", width: "100%" }}
              />
              <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#888' }}>Regions ≥ this size are kept if high-contrast against all neighbors</p>
            </>
          )}
          <label className="meta-label" htmlFor="prune-radius" style={{ marginTop: 14, display: 'block' }}>Prune kernel radius (px)</label>
          <input
            id="prune-radius"
            type="number"
            min={0}
            max={5}
            step={1}
            value={pruneRadius}
            onChange={(e) => { const v = Number(e.target.value); setPruneRadius(Number.isFinite(v) ? Math.max(0, Math.min(5, v)) : 1); }}
            style={{ marginTop: 4, minHeight: 44, borderRadius: 14, border: "1px solid rgba(120, 98, 70, 0.22)", padding: "0 14px", fontSize: "1rem", width: "100%" }}
          />
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#888' }}>0 = skip, 1 = clean 1px strips, 2 = clean 1-2px strips</p>
        </section>

        {/* ── Error ── */}
        {errorMessage && <div className="card card-wide"><div className="error-banner">{errorMessage}</div></div>}

        {/* ── Pipeline steps ── */}
        <section className="card card-wide">
          <h2 className="section-title">Pipeline steps</h2>
          <div className="actions" style={{ marginBottom: 14 }}>
            <button
              type="button"
              className="primary-btn"
              disabled={!imageLoaded || openCvStatus !== 'ready' || !!runningStep}
              onClick={runAll}
            >
              {runningStep ? 'Running…' : 'Run All'}
            </button>
          </div>
          <div className="steps-grid">
            {PIPELINE_STEPS.map((step, idx) => {
              const result = stepResults.get(step.id);
              const timing = stepTimings.get(step.id);
              const canRun = imageLoaded && openCvStatus === 'ready' && !runningStep && (idx === 0 || completedStep >= idx - 1);
              const isRunning = runningStep === step.id;
              const isDone = completedStep >= idx;

              return (
                <div key={step.id} className={`step-card ${isDone ? 'step-done' : ''} ${isRunning ? 'step-running' : ''}`}>
                  <div className="step-header">
                    <span className="step-number">{idx + 1}</span>
                    <div>
                      <p className="step-label">{step.label}</p>
                      <p className="step-desc">{step.description}</p>
                    </div>
                    <button
                      type="button"
                      className="step-btn"
                      disabled={!canRun}
                      onClick={() => runStep(idx)}
                    >
                      {isRunning ? 'Running…' : isDone ? 'Re-run' : 'Run'}
                    </button>
                  </div>
                  {result && (
                    <div className="step-result">
                      <img
                        src={result.objectUrl}
                        alt={`${step.label} result`}
                        className="step-result-img clickable-img"
                        onClick={() => setLightboxSrc(result.objectUrl)}
                      />
                      <p className="step-result-meta">
                        {result.width} × {result.height}
                        {timing != null && <span className="step-timing"> — {(timing / 1000).toFixed(2)}s</span>}
                        {' '}<a href={result.objectUrl} download={`${step.id}.png`} style={{ marginLeft: 8, fontSize: '0.8rem' }}>⬇ Download</a>
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Palette debug ── */}
        {(() => {
          // Find the latest step that has palette data
          const stepsWithPalette: StepId[] = ['region-merge', 'protrusions', 'quantize'];
          for (const sid of stepsWithPalette) {
            const sr = stepResults.get(sid);
            if (sr?.paletteRgb && sr.colorCount) {
              const colors: string[] = [];
              for (let i = 0; i < sr.colorCount; i++) {
                const r = sr.paletteRgb[i * 3], g = sr.paletteRgb[i * 3 + 1], b = sr.paletteRgb[i * 3 + 2];
                colors.push(`rgb(${r},${g},${b})`);
              }
              return (
                <section className="card card-wide">
                  <h2 className="section-title">Palette debug — {sid} ({sr.colorCount} colors)</h2>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {colors.map((c, i) => {
                      const r = sr.paletteRgb![i * 3], g = sr.paletteRgb![i * 3 + 1], b = sr.paletteRgb![i * 3 + 2];
                      return (
                        <div key={i} style={{ textAlign: 'center', fontSize: 10, fontFamily: 'monospace' }}>
                          <div style={{
                            width: 40, height: 40, borderRadius: 6,
                            backgroundColor: c,
                            border: '1px solid rgba(0,0,0,0.2)',
                          }} />
                          <div style={{ marginTop: 2 }}>#{r.toString(16).padStart(2, '0')}{g.toString(16).padStart(2, '0')}{b.toString(16).padStart(2, '0')}</div>
                          <div style={{ color: '#888' }}>{r},{g},{b}</div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            }
          }
          return null;
        })()}

        {/* ── Generated templates ── */}
        {templateUrls.length > 0 && (
          <section className="card card-wide">
            <h2 className="section-title">Generated templates ({templateUrls.length} styles)</h2>
            <div className="templates-grid">
              {templateUrls.map((t) => (
                <div key={t.label} className="template-item">
                  <img
                    src={t.url}
                    alt={t.label}
                    className="step-result-img clickable-img"
                    onClick={() => setLightboxSrc(t.url)}
                  />
                  <p className="step-result-meta">
                    {t.label}
                    {' '}<a href={t.url} download={`${t.label.replace(/\s+/g, '_').toLowerCase()}.png`} style={{ marginLeft: 8, fontSize: '0.8rem' }}>⬇ Download</a>
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Region stats debug ── */}
        {renderStats && (
          <section className="card card-wide">
            <h2 className="section-title">Region stats</h2>
            <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: '0.95rem' }}>
              <div><strong>{renderStats.regionCount}</strong> total regions</div>
              <div><strong>{renderStats.placementCount}</strong> labeled (with circle/number)</div>
              <div><strong>{renderStats.regionCount - renderStats.placementCount}</strong> too small to label</div>
            </div>
          </section>
        )}
      </div>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* ── Lightbox modal ── */}
      {lightboxSrc && (
        <div className="lightbox-overlay" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} alt="Full size" className="lightbox-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
