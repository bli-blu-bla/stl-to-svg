import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatLength, parseSVG } from '../lib/measure.js';
import { Close, Download, Ruler } from './Icons.jsx';

export default function Results({ cuts, onDownload, onMeasure, onRemove, onClear }) {
  const [zoom, setZoom] = useState(null);
  if (!cuts.length) return null;

  return (
    <section className="results" aria-label="Results">
      <div className="section-head">
        <h2>Results <span className="count">{cuts.length}</span></h2>
        <div className="section-tools">
          <span>Click a preview to enlarge</span>
          <button className="btn small" onClick={onClear} disabled={cuts.every((c) => c.busy)}>Clear all</button>
        </div>
      </div>
      <div className="results-grid">
        {cuts.map((c) => (
          <ResultCard
            key={c.id} cut={c}
            onZoom={setZoom} onDownload={onDownload} onMeasure={onMeasure} onRemove={onRemove}
          />
        ))}
      </div>
      {zoom && <Lightbox {...zoom} onClose={() => setZoom(null)} />}
    </section>
  );
}

function ResultCard({ cut: r, onZoom, onDownload, onMeasure, onRemove }) {
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
        <button className="thumb paper" onClick={() => onZoom({ url: r.url, name: r.name })} aria-label={`Enlarge ${r.name}, ${r.label}`}>
          <img src={r.url} alt={`SVG preview of ${r.name}, ${r.label}`} />
        </button>
      )}
      {!r.busy && (
        <button className="btn icon remove" onClick={() => onRemove(r.id)} aria-label={`Delete cut: ${r.name}, ${r.label}`} title="Remove this cut">
          <Close />
        </button>
      )}
      <div className="body">
        <div className="title-row">
          <h3 className="name" title={r.name}>{r.name}</h3>
          {size && <span className="dims">{size}</span>}
        </div>
        <div className="cut-label">{r.label}</div>
        {r.stats && (
          <div className="stats">
            {r.stats.paths} path{r.stats.paths === 1 ? '' : 's'} · {r.stats.vertices} points · {r.stats.ms} ms
          </div>
        )}
        <div className="btns">
          <button className="btn ink" disabled={!r.svg} onClick={() => onDownload(r)}>
            <Download /> Download SVG
          </button>
          <button className="btn outline" disabled={!r.svg} onClick={() => onMeasure(r)}>
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
