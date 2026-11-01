import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Dropzone from './components/Dropzone.jsx';
import Settings from './components/Settings.jsx';
import Viewer3D from './components/Viewer3D.jsx';
import Results from './components/Results.jsx';
import Measure from './components/Measure.jsx';
import { parseSTL } from './lib/stl.js';
import { basisFor, boundsOf, normalFromAngles, offsetRange } from './lib/plane.js';
import { convert, cancelAll } from './lib/converter.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { Auto, Close as CloseIcon, Code, Logo, Moon, Shield, Sun } from './components/Icons.jsx';
import { useTheme } from './lib/theme.js';

const REPO_URL = 'https://github.com/bli-blu-bla/stl-to-svg';
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

const PLANE_NAME = (s) => (s.planeKey === 'custom' ? `custom ${s.yaw}°/${s.pitch}°` : s.planeKey);
const PLANE_SLUG = (s) => (s.planeKey === 'custom' ? `custom-${s.yaw}-${s.pitch}` : s.planeKey);

// Human label and file-name part describing what a cut was made with.
function describeCut(s) {
  if (s.mode === 'projection') return { label: `Projection · ${PLANE_NAME(s)}`, slug: `projection-${PLANE_SLUG(s)}` };
  const off = s.offset.toFixed(2);
  return { label: `Section · ${PLANE_NAME(s)} @ ${off} mm`, slug: `section-${PLANE_SLUG(s)}-${off}mm` };
}

// Everything that changes a cut's output, so identical re-runs can be spotted.
function cutKey(fileId, s) {
  return JSON.stringify([
    fileId, s.mode, s.planeKey,
    s.planeKey === 'custom' ? [s.yaw, s.pitch] : null,
    s.mode === 'intersection' ? Math.round(s.offset * 1e6) : null,
    s.resolution, s.strokeWidth, s.unit,
    s.mode === 'projection' ? s.quality : null,
  ]);
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [s, setS] = useState(DEFAULTS);
  // Every conversion adds cuts here; older ones stay until removed.
  const [cuts, setCuts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [resetKey, setResetKey] = useState(0);
  const [notice, setNotice] = useState(null);
  const [measureId, setMeasureId] = useState(null);
  // Kept here rather than in the measuring view, so closing it loses nothing.
  const [measurements, setMeasurements] = useState({});
  const [measurePrefs, setMeasurePrefs] = useState({ tool: 'distance', lock45: false });
  const nextId = useRef(1);
  const nextCutId = useRef(1);
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

  // Cuts outlive their file: removing an STL to make room keeps its results.
  const removeFile = useCallback((id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  const removeCut = useCallback((id) => {
    setCuts((prev) => {
      const gone = prev.find((c) => c.id === id);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return prev.filter((c) => c.id !== id);
    });
  }, []);

  const clearCuts = useCallback(() => {
    setCuts((prev) => {
      for (const c of prev) if (c.url) URL.revokeObjectURL(c.url);
      return prev.filter((c) => c.busy); // Running conversions finish into the list.
    });
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

    // New cuts go to the front, in file order. Re-running identical settings
    // on a file replaces that cut instead of stacking duplicates.
    const { label: cutLabel, slug } = describeCut(s);
    const batch = usable.map((f) => ({
      id: nextCutId.current++, fileId: f.id, name: f.name, label: cutLabel, slug, key: cutKey(f.id, s), busy: true,
    }));
    const keys = new Set(batch.map((c) => c.key));
    setCuts((prev) => {
      for (const c of prev) if (keys.has(c.key) && c.url) URL.revokeObjectURL(c.url);
      return [...batch, ...prev.filter((c) => !keys.has(c.key))];
    });
    const update = (id, patch, url) => setCuts((prev) => {
      if (!prev.some((c) => c.id === id)) { // Removed while it was converting.
        if (url) URL.revokeObjectURL(url);
        return prev;
      }
      return prev.map((c) => (c.id === id ? { ...c, busy: false, ...patch } : c));
    });

    let index = 0;
    for (const f of usable) {
      const cut = batch[index];
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
        update(cut.id, { svg, stats, url }, url);
      } catch (err) {
        if (err?.cancelled) {
          // Drop the placeholders of everything that never ran.
          setCuts((prev) => prev.filter((c) => !c.busy));
          break;
        }
        update(cut.id, { error: err?.message || 'Conversion failed.' });
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

  // The settings go into the file name, so several cuts of one part don't
  // overwrite each other in the downloads folder.
  const download = useCallback((cut) => {
    if (!cut?.svg) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([cut.svg], { type: 'image/svg+xml' }));
    a.download = `${cut.name.replace(/\.stl$/i, '')}-${cut.slug}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, []);

  const downloadAll = useCallback(() => {
    cuts.filter((c) => c.svg).forEach((c, i) => setTimeout(() => download(c), i * 150));
  }, [cuts, download]);

  // Release preview blobs on unmount; removal and replacement handle the rest.
  const cutsRef = useRef(cuts);
  cutsRef.current = cuts;
  useEffect(() => () => {
    for (const c of cutsRef.current) if (c.url) URL.revokeObjectURL(c.url);
  }, []);

  const anySvg = cuts.some((c) => c.svg);
  // Everything that has (or is about to get) an SVG can be measured.
  const measurable = cuts
    .filter((c) => !c.error)
    .map((c) => ({ id: c.id, name: c.name, label: c.label, svg: c.svg, url: c.url }));
  const closeMeasure = useCallback(() => setMeasureId(null), []);

  // Forget the measurements of cuts that no longer exist.
  useEffect(() => {
    setMeasurements((prev) => {
      const ids = new Set(cuts.map((c) => String(c.id)));
      const kept = Object.entries(prev).filter(([id]) => ids.has(id));
      return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
    });
  }, [cuts]);

  // Leave the measuring view once its cut is gone.
  useEffect(() => {
    if (measureId !== null && !cuts.some((c) => c.id === measureId)) setMeasureId(null);
  }, [cuts, measureId]);
  const usableCount = files.filter((f) => !f.error).length;

  const theme = useTheme();
  const themeLabel = { auto: 'Auto', light: 'Light', dark: 'Dark' }[theme.pref];
  const ThemeIcon = { auto: Auto, light: Sun, dark: Moon }[theme.pref];

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <a className="brand" href="#top" aria-label="STL to SVG — home">
            <Logo />
            <span>STL<span className="arrow"> → </span>SVG</span>
          </a>
          <nav aria-label="Sections">
            <a href="#top" className="current">Workspace</a>
            <a href="#how-to">How it works</a>
          </nav>
          <div className="header-tools">
            <span className="pill"><Shield /> Runs offline · files never leave your machine</span>
            <a className="btn small" href={REPO_URL} target="_blank" rel="noreferrer">
              <Code /> <span className="gh-label">Source on GitHub</span>
            </a>
            <button
              className="btn small"
              onClick={theme.cycle}
              aria-label={`Theme: ${themeLabel}. Click to change.`}
              title={`Theme: ${themeLabel}`}
            >
              <ThemeIcon /> {themeLabel}
            </button>
          </div>
        </div>
      </header>

      <main className="wrap" id="top">
        <div className="intro">
          <div>
            <p className="eyebrow">3D mesh → 2D cut path</p>
            <h1>STL to SVG converter</h1>
          </div>
          <p>Slice or project a 3D model onto a plane and get clean SVG outlines for laser cutting, CNC routing and templates.</p>
        </div>

        <div className="workspace">
          <section className="rail" aria-label="Files">
            <Dropzone onFiles={addFiles} maxFiles={MAX_FILES} />
            {notice && <div className={`note${notice.error ? ' error' : ''}`}>{notice.text}</div>}
            {files.length > 0 && (
              <ul className="files">
                {files.map((f) => (
                  <li key={f.id} className={`file-row${f.id === selectedId ? ' active' : ''}`}>
                    <button
                      className="pick"
                      aria-disabled={!!f.error}
                      aria-current={f.id === selectedId ? 'true' : undefined}
                      onClick={() => !f.error && setSelectedId(f.id)}
                    >
                      <div className="name">{f.name}</div>
                      {f.error
                        ? <div className="err">{f.error}</div>
                        : <div className="meta">{f.triangles.toLocaleString('en-US')} tri · {f.bounds.size.map((v) => v.toFixed(1)).join(' × ')} mm</div>}
                    </button>
                    <button className="btn icon" aria-label={`Remove ${f.name}`} onClick={() => removeFile(f.id)}><CloseIcon /></button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel viewer" aria-label="3D preview">
            <div className="panel-head">
              <h2 className="panel-title">3D preview</h2>
              <button className="btn small" onClick={() => setResetKey((k) => k + 1)}>Reset view</button>
            </div>
            <ErrorBoundary
              title="The 3D preview stopped working."
              hint="Conversion and download are unaffected."
            >
              <Viewer3D mesh={selected?.error ? null : selected} basis={basis} offset={s.offset} mode={s.mode} resetKey={resetKey} theme={theme.resolved} />
            </ErrorBoundary>
            <p className="plane-note">
              <span className="swatch" style={{ background: s.mode === 'intersection' ? 'var(--accent)' : 'var(--measure)' }} />
              {s.mode === 'intersection'
                ? <span><strong>Cutting plane</strong> — every edge where this plane meets the model becomes a path.</span>
                : <span><strong>Projection surface</strong> — the arrow shows the direction the silhouette is seen from.</span>}
            </p>
          </section>

          <Settings s={s} set={set} range={range} disabled={!selected}>
            <div className="actions">
              <button className="btn accent big" disabled={!usableCount || busy} onClick={runConversion}>
                {busy ? 'Converting…' : usableCount > 1 ? `Convert ${usableCount} files` : 'Convert to SVG'}
              </button>
              {busy
                ? <button className="btn big" onClick={cancel}>Cancel</button>
                : <button className="btn big" disabled={!anySvg} onClick={downloadAll}>Download all</button>}
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
          </Settings>
        </div>

        <ErrorBoundary title="The result gallery stopped working.">
          <Results cuts={cuts} onDownload={download} onMeasure={(c) => setMeasureId(c.id)} onRemove={removeCut} onClear={clearCuts} />
        </ErrorBoundary>

        <section className="block" id="how-to">
          <h2>How it works</h2>
          <div className="howto">
            <div className="panel">
              <h3><span className="swatch" style={{ background: 'var(--accent)' }} />Intersection — a cross-section</h3>
              <ol>
                <li><strong>Upload your STL</strong> by dropping it in or browsing.</li>
                <li><strong>Pick Intersection</strong> and a cutting plane: XY, XZ, YZ or a custom angle.</li>
                <li><strong>Move the offset</strong> until the orange plane sits where you want the cut.</li>
                <li><strong>Convert</strong> — every edge where the plane meets the geometry becomes a path.</li>
                <li><strong>Measure or download</strong> the SVG.</li>
              </ol>
              <p className="best-for"><strong>Best for:</strong> cross-sections, layered cutting templates and inspecting hollow parts.</p>
            </div>
            <div className="panel">
              <h3><span className="swatch" style={{ background: 'var(--measure)' }} />Projection — a silhouette</h3>
              <ol>
                <li><strong>Upload your STL.</strong></li>
                <li><strong>Pick Projection</strong> and the plane you look through.</li>
                <li><strong>Set resolution and stroke width</strong> for your cutter.</li>
                <li><strong>Convert</strong> — the SVG holds the model’s outline, holes included.</li>
                <li><strong>Measure or download</strong> the SVG.</li>
              </ol>
              <p className="best-for"><strong>Best for:</strong> templates, stencils, gaskets and simple cutting patterns.</p>
            </div>
          </div>
        </section>
      </main>

      {measureId !== null && (
        <ErrorBoundary title="The measuring view stopped working.">
          <Measure
            items={measurable} activeId={measureId} onSelect={setMeasureId} onClose={closeMeasure}
            store={measurements} setStore={setMeasurements} prefs={measurePrefs} setPrefs={setMeasurePrefs}
          />
        </ErrorBoundary>
      )}

      <footer className="site-footer">
        <div className="wrap">
          <span>All conversion happens locally in your browser — no file ever leaves your machine.</span>
          <span>Open source · <a href={REPO_URL} target="_blank" rel="noreferrer">github.com/bli-blu-bla/stl-to-svg</a></span>
        </div>
      </footer>
    </>
  );
}
