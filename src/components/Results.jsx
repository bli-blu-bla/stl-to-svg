import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatLength, parseSVG } from '../lib/measure.js';
import { Download, Ruler } from './Icons.jsx';

export default function Results({ files, results, onDownload, onMeasure }) {
  const [zoom, setZoom] = useState(null);
  const done = files.filter((f) => results[f.id]);
  if (!done.length) return null;

  return (
    <section className="results" aria-label="Results">
      <div className="section-head">
        <h2>Results</h2>
        <span>Click a preview to enlarge</span>
      </div>
      <div className="results-grid">
        {done.map((f) => (
          <ResultCard
            key={f.id} file={f} result={results[f.id]}
            onZoom={setZoom} onDownload={onDownload} onMeasure={onMeasure}
          />
        ))}
      </div>
      {zoom && <Lightbox {...zoom} onClose={() => setZoom(null)} />}
    </section>
  );
}

function ResultCard({ file: f, result: r, onZoom, onDownload, onMeasure }) {
  // The real part size, read back from the SVG (stroke margin excluded).
  const size = useMemo(() => {
    if (!r.svg) return null;
    const g = parseSVG(r.svg);
    const n = (v) => formatLength(v, g.unit).split(' ')[0];
    return `${n(g.bounds.width)} × ${n(g.bounds.height)} ${g.unit}`;
  }, [r.svg]);

  return (
    <article className="panel result-card">
      {r.busy && (
        <div className="thumb paper pending" role="status">
          <span className="indeterminate" />
          Converting…
        </div>
      )}
      {r.error && <div className="thumb failed">{r.error}</div>}
      {r.url && (
        <button className="thumb paper" onClick={() => onZoom({ url: r.url, name: f.name })} aria-label={`Enlarge ${f.name}`}>
          <img src={r.url} alt={`SVG preview of ${f.name}`} />
        </button>
      )}
      <div className="body">
        <div className="title-row">
          <h3 className="name" title={f.name}>{f.name}</h3>
          {size && <span className="dims">{size}</span>}
        </div>
        {r.stats && (
          <div className="stats">
            {r.stats.paths} path{r.stats.paths === 1 ? '' : 's'} · {r.stats.vertices} points · {r.stats.ms} ms
          </div>
        )}
        <div className="btns">
          <button className="btn ink" disabled={!r.svg} onClick={() => onDownload(f)}>
            <Download /> Download SVG
          </button>
          <button className="btn outline" disabled={!r.svg} onClick={() => onMeasure(f)}>
            <Ruler /> Measure
          </button>
        </div>
      </div>
    </article>
  );
}

function Lightbox({ url, name, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog className="lightbox" ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <button className="btn small close" onClick={onClose}>Close</button>
      <div className="inner paper">
        <img src={url} alt={`Enlarged SVG preview of ${name}`} />
      </div>
    </dialog>
  );
}
