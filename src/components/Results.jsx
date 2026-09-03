import React, { useEffect, useRef, useState } from 'react';

export default function Results({ files, results, onDownload }) {
  const [zoom, setZoom] = useState(null);
  const done = files.filter((f) => results[f.id]);
  if (!done.length) return null;

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h3>
        2D Result Preview
        <span className="spacer">Click a preview to enlarge</span>
      </h3>
      <div className="results-grid">
        {done.map((f) => {
          const r = results[f.id];
          return (
            <div className="result-card" key={f.id}>
              {r.busy && <div className="thumb pending">Converting…</div>}
              {r.error && <div className="thumb failed">{r.error}</div>}
              {r.url && (
                <button className="thumb" onClick={() => setZoom({ url: r.url, name: f.name })}>
                  <img src={r.url} alt={`SVG preview of ${f.name}`} />
                </button>
              )}
              <div className="body">
                <div className="name" title={f.name}>{f.name}</div>
                {r.stats && (
                  <div className="stats">
                    {r.stats.paths} path{r.stats.paths === 1 ? '' : 's'} ·{' '}
                    {r.stats.vertices} points · {r.stats.ms} ms
                  </div>
                )}
                <button className="btn small" disabled={!r.svg} onClick={() => onDownload(f)}>
                  Download SVG
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {zoom && <Lightbox {...zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

function Lightbox({ url, name, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog className="lightbox" ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <button className="btn small close" onClick={onClose}>Close</button>
      <div className="inner">
        <img src={url} alt={`Enlarged SVG preview of ${name}`} />
      </div>
    </dialog>
  );
}
