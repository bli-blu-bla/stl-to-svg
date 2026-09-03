import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Dropzone from './components/Dropzone.jsx';
import Settings from './components/Settings.jsx';
import Viewer3D from './components/Viewer3D.jsx';
import Results from './components/Results.jsx';
import { parseSTL } from './lib/stl.js';
import { basisFor, boundsOf, normalFromAngles, offsetRange } from './lib/plane.js';
import { convert, cancelAll } from './lib/converter.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';

const MAX_FILES = 5;
// Beyond this a 100 MB mesh already costs ~150 MB of live buffers, and the
// browser tab is the only budget we have. Rejecting early beats an OOM crash.
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const LARGE_FILE_BYTES = 25 * 1024 * 1024;

const DEFAULTS = {
  mode: 'intersection',
  unit: 'mm',
  planeKey: 'XY',
  yaw: 0,
  pitch: 45,
  offset: 0,
  resolution: 0.1,
  strokeWidth: 0.1,
  quality: 'auto',
};

export default function App() {
  const [files, setFiles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [s, setS] = useState(DEFAULTS);
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [resetKey, setResetKey] = useState(0);
  const [notice, setNotice] = useState(null);
  const nextId = useRef(1);
  // Guards the auto-centering of the offset so it only runs on a genuinely new
  // plane/model, not on every user drag of the slider.
  const offsetKey = useRef(null);

  const selected = files.find((f) => f.id === selectedId) || null;

  const basis = useMemo(
    () => basisFor(s.planeKey, normalFromAngles(s.yaw, s.pitch)),
    [s.planeKey, s.yaw, s.pitch]
  );

  const range = useMemo(() => {
    if (!selected?.positions) return { min: -1, max: 1 };
    const r = offsetRange(selected.positions, basis.n);
    return r.max - r.min < 1e-9 ? { min: r.min - 1, max: r.max + 1 } : r;
  }, [selected, basis]);

  // Recentre the cutting plane when the model or plane orientation changes.
  useEffect(() => {
    const key = `${selectedId}|${basis.n.join(',')}`;
    if (offsetKey.current === key) return;
    offsetKey.current = key;
    setS((prev) => ({ ...prev, offset: (range.min + range.max) / 2 }));
  }, [selectedId, basis, range]);

  const set = useCallback((patch) => setS((prev) => ({ ...prev, ...patch })), []);

  const addFiles = useCallback(async (incoming) => {
    setNotice(null);
    const room = MAX_FILES - files.length;
    if (room <= 0) {
      setNotice({ error: true, text: `You can work with at most ${MAX_FILES} files at a time.` });
      return;
    }
    if (incoming.length > room) {
      setNotice({ error: true, text: `Only the first ${room} file(s) were added — the limit is ${MAX_FILES}.` });
    }

    const loaded = await Promise.all(incoming.slice(0, room).map(async (file) => {
      const entry = { id: nextId.current++, name: file.name, size: file.size };
      if (file.size > MAX_FILE_BYTES) {
        return { ...entry, error: `Too large (${(file.size / 1048576).toFixed(0)} MB). The limit is ${MAX_FILE_BYTES / 1048576} MB.` };
      }
      try {
        const positions = parseSTL(await file.arrayBuffer());
        return { ...entry, positions, bounds: boundsOf(positions), triangles: positions.length / 9 };
      } catch (err) {
        return { ...entry, error: err?.message || 'Could not read this STL file.' };
      }
    }));

    const heavy = loaded.filter((f) => !f.error && f.size > LARGE_FILE_BYTES);
    if (heavy.length && !incoming.some((f) => f.size > MAX_FILE_BYTES)) {
      setNotice({ text: `${heavy.length === 1 ? 'That file is' : 'Those files are'} large — conversion may take a few seconds and use a lot of memory.` });
    }

    setFiles((prev) => [...prev, ...loaded]);
    const firstUsable = loaded.find((f) => !f.error);
    if (firstUsable) setSelectedId((prev) => prev ?? firstUsable.id);
  }, [files.length]);

  const removeFile = useCallback((id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setResults((prev) => {
      if (prev[id]?.url) URL.revokeObjectURL(prev[id].url);
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  // Re-select something sensible whenever the current selection disappears.
  useEffect(() => {
    if (selectedId !== null && files.some((f) => f.id === selectedId)) return;
    setSelectedId(files.find((f) => !f.error)?.id ?? null);
  }, [files, selectedId]);

  const runConversion = useCallback(async () => {
    const usable = files.filter((f) => !f.error);
    if (!usable.length) return;
    setBusy(true);
    setNotice(null);

    setResults((prev) => {
      for (const r of Object.values(prev)) if (r.url) URL.revokeObjectURL(r.url);
      return Object.fromEntries(usable.map((f) => [f.id, { busy: true }]));
    });

    let index = 0;
    for (const f of usable) {
      index++;
      const settings = {
        mode: s.mode,
        planeKey: s.planeKey,
        customNormal: normalFromAngles(s.yaw, s.pitch),
        offset: s.offset,
        resolution: s.resolution,
        strokeWidth: s.strokeWidth,
        unit: s.unit,
        stroke: '#000000',
        quality: s.quality,
        title: f.name,
      };
      const label = usable.length > 1 ? `${f.name} (${index}/${usable.length})` : f.name;
      try {
        const { svg, stats } = await convert(f.positions, settings, ({ stage, fraction }) =>
          // Report progress across the whole batch, so the bar advances
          // monotonically instead of resetting on every file.
          setProgress({ label, stage, fraction: (index - 1 + (fraction || 0)) / usable.length }));
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        setResults((prev) => ({ ...prev, [f.id]: { svg, stats, url } }));
      } catch (err) {
        if (err?.cancelled) {
          // Drop the placeholders of everything that never ran.
          setResults((prev) => Object.fromEntries(
            Object.entries(prev).filter(([, r]) => !r.busy)));
          break;
        }
        setResults((prev) => ({ ...prev, [f.id]: { error: err?.message || 'Conversion failed.' } }));
      }
    }
    setBusy(false);
    setProgress(null);
  }, [files, s]);

  const cancel = useCallback(() => {
    cancelAll();
    setBusy(false);
    setProgress(null);
  }, []);

  const download = useCallback((file) => {
    const r = results[file.id];
    if (!r?.svg) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
    a.download = file.name.replace(/\.stl$/i, '') + `-${s.mode}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, [results, s.mode]);

  const downloadAll = useCallback(() => {
    files.forEach((f, i) => {
      if (results[f.id]?.svg) setTimeout(() => download(f), i * 150);
    });
  }, [files, results, download]);

  // Release preview blobs on unmount; the per-conversion cleanup handles the rest.
  const resultsRef = useRef(results);
  resultsRef.current = results;
  useEffect(() => () => {
    for (const r of Object.values(resultsRef.current)) if (r.url) URL.revokeObjectURL(r.url);
  }, []);

  const anySvg = files.some((f) => results[f.id]?.svg);
  const usableCount = files.filter((f) => !f.error).length;

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <div className="brand"><span className="brand-mark">◪</span> STL Tools</div>
          <nav aria-label="Sections">
            <a href="#how-to">How to use</a>
            <a href="#features">Features</a>
          </nav>
        </div>
      </header>

      <main className="wrap">
        <div className="hero">
          <h1>STL to SVG Converter</h1>
          <p>Convert 3D STL files to 2D SVG paths for laser cutting, CNC routing, and fabrication.</p>
          <div className="badges">
            <span className="badge">Projection Outlines</span>
            <span className="badge">Intersection Paths</span>
            <span className="badge">Custom Planes</span>
            <span className="badge">3D Preview</span>
            <span className="badge">Runs fully offline</span>
          </div>
        </div>

        <Dropzone onFiles={addFiles} maxFiles={MAX_FILES} />
        {notice && <div className={`note${notice.error ? ' error' : ''}`}>{notice.text}</div>}

        {files.length > 0 && (
          <div className="files">
            {files.map((f) => (
              <div key={f.id} className={`file-row${f.id === selectedId ? ' active' : ''}`}>
                <button
                  className="pick"
                  aria-disabled={!!f.error}
                  onClick={() => !f.error && setSelectedId(f.id)}
                >
                  <div className="name">{f.name}</div>
                  {f.error
                    ? <div className="err">{f.error}</div>
                    : <div className="meta">{(f.size / 1048576).toFixed(2)} MB · {f.triangles.toLocaleString('en-US')} triangles · {f.bounds.size.map((v) => v.toFixed(1)).join(' × ')} mm</div>}
                </button>
                <button className="btn icon" aria-label={`Remove ${f.name}`} onClick={() => removeFile(f.id)}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="workspace">
          <div className="panel viewer">
            <h3>
              3D Preview
              <span className="spacer">
                <button className="btn small" onClick={() => setResetKey((k) => k + 1)}>Reset View</button>
              </span>
            </h3>
            <ErrorBoundary
              title="The 3D preview stopped working."
              hint="Conversion and download are unaffected."
            >
              <Viewer3D mesh={selected?.error ? null : selected} basis={basis} offset={s.offset} mode={s.mode} resetKey={resetKey} />
            </ErrorBoundary>
            <div className="plane-note">
              <span className="swatch" style={{ background: s.mode === 'intersection' ? 'var(--red)' : 'var(--green)' }} />
              {s.mode === 'intersection'
                ? <span><strong>Red plane:</strong> shows the cutting plane. All geometry intersecting this plane will create outline paths.</span>
                : <span><strong>Green plane:</strong> shows the projection surface. The arrow points along the viewing direction your outline is seen from.</span>}
            </div>
          </div>

          <div>
            <Settings s={s} set={set} range={range} disabled={!selected} />
            <div className="actions">
              <button className="btn primary" disabled={!usableCount || busy} onClick={runConversion}>
                {busy ? 'Converting…' : `Convert to SVG${usableCount > 1 ? ` (${usableCount})` : ''}`}
              </button>
              {busy
                ? <button className="btn" onClick={cancel}>Cancel</button>
                : <button className="btn" disabled={!anySvg} onClick={downloadAll}>Download All SVG</button>}
            </div>
            {progress && (
              <div className="progress" role="status" aria-live="polite">
                <div className="progress-label">
                  <span>{progress.stage} — {progress.label}</span>
                  <span>{Math.round((progress.fraction || 0) * 100)}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-bar" style={{ width: `${Math.max(2, (progress.fraction || 0) * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        <ErrorBoundary title="The result gallery stopped working.">
          <Results files={files} results={results} onDownload={download} />
        </ErrorBoundary>

        <section className="block" id="features">
          <div className="cards">
            <div className="card">
              <h4>Laser Cutting Ready</h4>
              <p>Generate precise SVG paths optimised for laser cutters, with customisable stroke widths and resolution settings.</p>
            </div>
            <div className="card">
              <h4>Multiple Modes</h4>
              <p>Choose between projection outlines for templates or intersection paths for cross-sections and internal structures.</p>
            </div>
            <div className="card">
              <h4>Visual Preview</h4>
              <p>See your 3D model and the cutting plane in real time before converting, so the result is what you expect.</p>
            </div>
          </div>
        </section>

        <section className="block" id="how-to">
          <h2>How to Use the STL to SVG Converter</h2>
          <div className="howto">
            <div className="card">
              <h4>Projection Mode — step by step</h4>
              <ol>
                <li><strong>Upload your STL file</strong> by dragging it in or clicking to browse.</li>
                <li><strong>Select Projection Outline</strong> in the conversion settings.</li>
                <li><strong>Choose your viewing plane:</strong> XY (top), XZ (front), YZ (side), or a custom orientation.</li>
                <li><strong>Adjust settings:</strong> resolution, stroke width, and output units.</li>
                <li><strong>Check the 3D preview:</strong> the green plane is your projection surface.</li>
                <li><strong>Convert</strong> and <strong>download</strong> — the SVG holds the silhouette of the model, holes included.</li>
              </ol>
              <p className="best-for"><strong>Best for:</strong> templates, stencils, gaskets, and simple cutting patterns where you need the outline shape of your 3D object.</p>
            </div>
            <div className="card">
              <h4>Intersection Mode — step by step</h4>
              <ol>
                <li><strong>Upload your STL file.</strong></li>
                <li><strong>Select Intersection Outline</strong> in the conversion settings.</li>
                <li><strong>Choose the cutting plane</strong> or define a custom orientation.</li>
                <li><strong>Set the plane offset</strong> to position where the plane cuts through the model.</li>
                <li><strong>Check the 3D preview:</strong> the red plane shows exactly where the model is sliced.</li>
                <li><strong>Convert</strong> and <strong>download</strong> — the SVG holds every edge where the plane meets the geometry.</li>
              </ol>
              <p className="best-for"><strong>Best for:</strong> cross-sections, internal structure patterns, layered cutting templates, and inspecting hollow geometry.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap">
          STL to SVG Converter — all conversion happens locally in your browser; no file ever leaves your machine.
        </div>
      </footer>
    </>
  );
}
