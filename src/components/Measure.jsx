import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  angleAt, formatAngle, formatLength, lineAngle, measureBetween, parseSVG, rayHit, snapAngle, snapPoint,
} from '../lib/measure.js';
import { Angle, Back, Distance, Minus, Plus, Snap45 } from './Icons.jsx';

const SNAP_PX = 10;
const ZOOM_STEP = 1.4;
const PILL_CHAR_PX = 8.2; // Generous per-glyph width at 12.5 px, so labels never spill out of their pill.
const DRAG_PX = 4;
const MIN_ZOOM_PX = 0.02; // Guard rails so the wheel cannot zoom into nothing.
const MAX_ZOOM_PX = 20000;
const DOUBLE_ESC_MS = 500; // A single Esc never closes the view — it takes two in a row.
// Clicks needed per tool: distance = start, end; angle = vertex, leg, leg.
const NEEDS = { distance: 2, angle: 3 };
const STEPS = {
  distance: ['Click the start point', 'Click the end point'],
  angle: ['Click the vertex', 'Click a point on the first leg', 'Click a point on the second leg'],
};

export default function Measure({ items, activeId, onSelect, onClose }) {
  const active = items.find((i) => i.id === activeId) || null;
  const svgText = active?.svg || null;
  const geom = useMemo(() => (svgText ? parseSVG(svgText) : null), [svgText]);
  const unit = geom?.unit || 'mm';

  // Measurements per file, discarded when that file's SVG is regenerated.
  const [store, setStore] = useState({});
  const entry = store[activeId];
  const list = entry && entry.svg === svgText ? entry.list : [];
  const setList = useCallback((fn) => {
    setStore((prev) => {
      const cur = prev[activeId];
      const base = cur && cur.svg === svgText ? cur.list : [];
      return { ...prev, [activeId]: { svg: svgText, list: fn(base) } };
    });
  }, [activeId, svgText]);

  const [tool, setTool] = useState('distance');
  const [lock45, setLock45] = useState(false);
  const [pts, setPts] = useState([]); // Points placed for the measurement in progress.
  const [hover, setHover] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [view, setView] = useState(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const drag = useRef(null);
  const lastPointer = useRef(null);
  const lastEsc = useRef(0);
  const [escArmed, setEscArmed] = useState(false);
  const nextId = useRef(1);

  // Fit the drawing whenever another SVG is shown.
  const fit = useCallback(() => { if (geom) setView(fitView(geom)); }, [geom]);
  useEffect(() => { fit(); setPts([]); setHover(null); }, [fit]);

  const chooseTool = (t) => { setTool(t); setPts([]); };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width || 1, h: e.contentRect.height || 1 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Screen pixels per drawing unit, as laid out by preserveAspectRatio="meet".
  const ready = !!(geom && view);
  const ppu = view ? Math.min(size.w / view.w, size.h / view.h) : 1;
  const fitted = geom ? fitView(geom) : null;
  const zoomPct = fitted && view ? Math.round((fitted.w / view.w) * 100) : 100;

  const zoomBy = (f) => setView((v) => {
    if (!v) return v;
    const next = Math.min(size.w / (v.w * f), size.h / (v.h * f));
    if ((next < MIN_ZOOM_PX && f > 1) || (next > MAX_ZOOM_PX && f < 1)) return v;
    const cx = v.x + v.w / 2; const cy = v.y + v.h / 2;
    return { x: cx - (v.w * f) / 2, y: cy - (v.h * f) / 2, w: v.w * f, h: v.h * f };
  });

  // Size and measurement count for each entry in the sidebar. Parsing is
  // cached by SVG text because `items` is rebuilt on every parent render.
  const parsed = useRef(new Map());
  const infoFor = (it) => {
    if (!it.svg) return null;
    let g = parsed.current.get(it.svg);
    if (!g) {
      g = it.svg === svgText && geom ? geom : parseSVG(it.svg);
      parsed.current.set(it.svg, g);
    }
    const e = store[it.id];
    return { g, count: e && e.svg === it.svg ? e.list.length : 0 };
  };

  const [copied, setCopied] = useState(false);
  const copyAll = async () => {
    const lines = list.map((m, i) => `${i + 1}. ${summaryText(m, unit)}`);
    try {
      await navigator.clipboard.writeText(`${active?.name}\n${lines.join('\n')}\n`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — nothing to do */ }
  };

  const toDrawing = useCallback((e) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  // Cursor → snapped drawing point. Every leg is measured from the first
  // point (the start, or the angle's vertex), so that is the 45° anchor.
  const resolve = useCallback((e) => {
    const raw = toDrawing(e);
    if (!raw || !geom) return null;
    const tol = SNAP_PX / ppu;
    const anchor = pts[0];
    if (anchor && lock45 !== e.shiftKey) {
      const locked = snapAngle(anchor, raw);
      if (locked.dir) {
        const hit = !e.altKey && rayHit(geom, anchor, locked.dir, locked, tol);
        return { ...(hit || locked), locked: true };
      }
    }
    return (!e.altKey && snapPoint(geom, raw.x, raw.y, tol)) || { ...raw, kind: null };
  }, [toDrawing, geom, ppu, pts, lock45]);

  // Zoom around the cursor. Registered by hand: React's wheel listener is passive.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const p = toDrawing(e);
      if (!p) return;
      const f = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      setView((v) => {
        if (!v) return v;
        const next = Math.min(size.w / (v.w * f), size.h / (v.h * f));
        if ((next < MIN_ZOOM_PX && f > 1) || (next > MAX_ZOOM_PX && f < 1)) return v;
        return { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w: v.w * f, h: v.h * f };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [toDrawing, size, ready]);

  const remember = (e) => {
    lastPointer.current = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, altKey: e.altKey };
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, view, moved: e.button === 1, button: e.button };
  };

  const onPointerMove = (e) => {
    remember(e);
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.sx; const dy = e.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > DRAG_PX) d.moved = true;
      if (d.moved && d.view) {
        setView({ ...d.view, x: d.view.x - dx / ppu, y: d.view.y - dy / ppu });
        return;
      }
    }
    setHover(resolve(e));
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || d.button !== 0) return;
    const p = resolve(e);
    if (!p) return;
    // A second click on the same spot would give a zero-length leg.
    if (pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9)) return;
    const point = { x: p.x, y: p.y };
    const next = [...pts, point];
    if (next.length < NEEDS[tool]) {
      setPts(next);
    } else {
      setList((l) => [...l, { id: nextId.current++, type: tool, pts: next }]);
      setPts([]);
    }
  };

  // Re-evaluate the hover point when Shift / Alt change without the mouse moving.
  const refreshHover = useCallback((e) => {
    const last = lastPointer.current;
    if (!last || drag.current) return;
    last.shiftKey = e.shiftKey;
    last.altKey = e.altKey;
    setHover(resolve(last));
  }, [resolve]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      if (e.key === 'Shift' || e.key === 'Alt') { refreshHover(e); return; }
      if (e.key === 'Escape') {
        e.preventDefault();
        const now = performance.now();
        if (pts.length) {
          setPts([]);
          lastEsc.current = 0;
        } else if (now - lastEsc.current < DOUBLE_ESC_MS) {
          onClose();
        } else {
          lastEsc.current = now;
          setEscArmed(true);
        }
      } else if (e.key === 'Backspace' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        if (pts.length) setPts((p) => p.slice(0, -1));
        else setList((l) => l.slice(0, -1));
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'd') { setTool('distance'); setPts([]); }
        else if (k === 'a') { setTool('angle'); setPts([]); }
        else if (k === 's') setLock45((v) => !v);
      }
    };
    const onKeyUp = (e) => { if (e.key === 'Shift' || e.key === 'Alt') refreshHover(e); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [pts, onClose, setList, refreshHover]);

  // The "press Esc again" hint disappears once the double-press window closes.
  useEffect(() => {
    if (!escArmed) return undefined;
    const t = setTimeout(() => setEscArmed(false), DOUBLE_ESC_MS);
    return () => clearTimeout(t);
  }, [escArmed]);

  // Toggling the lock from the toolbar should show its effect immediately.
  useEffect(() => {
    const last = lastPointer.current;
    if (last && !drag.current) setHover(resolve(last));
  }, [lock45, resolve]);

  // The page behind must not scroll while this view covers it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const px = (n) => n / ppu; // Screen pixels → drawing units, for constant-size overlays.
  const b = geom?.bounds;
  const live = hover && pts.length ? [...pts, hover] : null;
  const far = view ? (view.w + view.h) * 2 : 0;
  const dims = (g) => `${formatLength(g.bounds.width, g.unit).split(' ')[0]} × ${formatLength(g.bounds.height, g.unit)}`;

  return (
    <div className="measure" role="dialog" aria-modal="true" aria-label="Measure SVG">
      <div className="measure-top">
        <button className="btn icon back-btn" onClick={onClose} aria-label="Back to workspace"><Back /></button>
        <div className="measure-title">
          <strong title={active?.name}>{active?.name || 'No SVG selected'}</strong>
          {geom && <span className="measure-size">{dims(geom)}</span>}
        </div>
        <div className="measure-tools">
          <div className="tool-seg" role="radiogroup" aria-label="Measuring tool">
            {[['distance', 'Distance', 'D', Distance], ['angle', 'Angle', 'A', Angle]].map(([t, label, key, Ico]) => (
              <button key={t} role="radio" aria-checked={tool === t} onClick={() => chooseTool(t)} title={`${label} (${key})`}>
                <Ico /> {label} <kbd aria-hidden="true">{key}</kbd>
              </button>
            ))}
          </div>
          <button
            className="btn toggle"
            aria-pressed={lock45}
            onClick={() => setLock45((v) => !v)}
            title="Snap lines to 45° steps (S) — hold Shift to invert"
          >
            <Snap45 /> 45° snap
          </button>
          <span className="divider" aria-hidden="true" />
          <button className="btn" onClick={fit} disabled={!geom}>Fit</button>
          <button className="btn" onClick={() => { setList(() => []); setPts([]); }} disabled={!list.length && !pts.length}>
            Clear
          </button>
          <button className="btn ink" onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="measure-body">
        <div className="measure-stage" ref={stageRef}>
          {ready ? (
            <svg
              ref={svgRef}
              className="measure-canvas"
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              preserveAspectRatio="xMidYMid meet"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => { if (!drag.current) setHover(null); }}
              onContextMenu={(e) => e.preventDefault()}
              data-testid="measure-canvas"
            >
              <rect
                x={b.minX} y={b.minY} width={b.width} height={b.height}
                className="m-bounds" vectorEffect="non-scaling-stroke"
              />
              <g className="m-paths">
                {geom.paths.map((d, i) => <path key={i} d={d} vectorEffect="non-scaling-stroke" />)}
              </g>

              {hover?.locked && pts[0] && (
                <line
                  className="m-guide" vectorEffect="non-scaling-stroke"
                  x1={pts[0].x - hover.dir[0] * far} y1={pts[0].y - hover.dir[1] * far}
                  x2={pts[0].x + hover.dir[0] * far} y2={pts[0].y + hover.dir[1] * far}
                />
              )}

              {list.map((m, i) => (
                <Mark key={m.id} m={m} n={i + 1} unit={unit} px={px} hot={highlight === m.id} />
              ))}
              {live && <Mark m={{ type: tool, pts: live }} unit={unit} px={px} live />}

              {pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={px(5)} className="m-end live" />)}
              {hover && hover.kind === 'vertex' && (
                <rect x={hover.x - px(7)} y={hover.y - px(7)} width={px(14)} height={px(14)} className="m-snap" vectorEffect="non-scaling-stroke" />
              )}
              {hover && hover.kind === 'edge' && (
                <circle cx={hover.x} cy={hover.y} r={px(6)} className="m-snap" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
          ) : (
            <div className="measure-empty">
              {active ? 'This SVG is being regenerated…' : 'Choose an SVG on the right.'}
            </div>
          )}

          <div className="measure-status" role="status">
            <strong>{escArmed ? 'Press Esc again to close' : STEPS[tool][pts.length]}</strong>
            {hover && b && (
              <span className="coords">
                x {formatLength(hover.x - b.minX, unit).split(' ')[0]}  y {formatLength(b.maxY - hover.y, unit)}
                {hover.kind ? ` · on ${hover.kind}` : ''}
                {hover.locked ? ' · 45° lock' : ''}
              </span>
            )}
          </div>

          {ready && (
            <div className="zoom">
              <button className="btn icon" aria-label="Zoom in" onClick={() => zoomBy(1 / ZOOM_STEP)}><Plus /></button>
              <span aria-label="Zoom level">{zoomPct}%</span>
              <button className="btn icon" aria-label="Zoom out" onClick={() => zoomBy(ZOOM_STEP)}><Minus /></button>
            </div>
          )}
        </div>

        <aside className="measure-side">
          <section aria-label="SVGs">
            <div className="side-head"><h2>SVGs · {items.length}</h2></div>
            <div className="measure-files">
              {items.map((it) => {
                const info = infoFor(it);
                return (
                  <button
                    key={it.id}
                    className={`measure-file${it.id === activeId ? ' active' : ''}`}
                    onClick={() => onSelect(it.id)}
                    aria-current={it.id === activeId ? 'true' : undefined}
                  >
                    <span className="t">{it.url ? <img src={it.url} alt="" /> : '…'}</span>
                    <span className="n">
                      <b title={it.name}>{it.name}</b>
                      <small>{info ? dims(info.g) : 'converting…'}</small>
                    </span>
                    {info?.count > 0 && <span className="count" aria-label={`${info.count} measurements`}>{info.count}</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grow" aria-label="Measurements">
            <div className="side-head">
              <h2>Measurements</h2>
              <button className="link-btn" onClick={copyAll} disabled={!list.length}>{copied ? 'Copied' : 'Copy all'}</button>
            </div>
            {list.length ? (
              <ol className="measure-list">
                {list.map((m, i) => (
                  <li key={m.id} onMouseEnter={() => setHighlight(m.id)} onMouseLeave={() => setHighlight(null)}>
                    <span className="idx">{i + 1}</span>
                    <MarkSummary m={m} unit={unit} />
                    <button
                      className="btn icon"
                      aria-label={`Delete measurement ${i + 1}`}
                      onClick={() => setList((l) => l.filter((x) => x.id !== m.id))}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="measure-none">No measurements yet — click two points on the drawing.</p>
            )}

            <div className="shortcuts">
              <span><kbd>Shift</kbd> 45° lock</span>
              <span><kbd>Alt</kbd> no snapping</span>
              <span><kbd>Esc</kbd> cancel point</span>
              <span><kbd>Esc Esc</kbd> close</span>
              <span><kbd>Drag</kbd> pan</span>
              <span><kbd>Wheel</kbd> zoom</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function fitView(geom) {
  const b = geom.bounds;
  const pad = Math.max(b.width, b.height, 1e-6) * 0.08;
  return { x: b.minX - pad, y: b.minY - pad, w: b.width + 2 * pad, h: b.height + 2 * pad };
}

function summaryText(m, unit) {
  if (m.type === 'angle') {
    const [v, a, b] = m.pts;
    return `${formatAngle(angleAt(v, a, b))} (angle, legs ${formatLength(measureBetween(v, a).length, unit)} / ${formatLength(measureBetween(v, b).length, unit)})`;
  }
  const [a, b] = m.pts;
  const r = measureBetween(a, b);
  return `${formatLength(r.length, unit)} (Δx ${formatLength(r.dx, unit)}, Δy ${formatLength(r.dy, unit)}, ∠ ${formatAngle(lineAngle(a, b))})`;
}

function MarkSummary({ m, unit }) {
  if (m.type === 'angle') {
    const [v, a, b] = m.pts;
    return (
      <div className="v">
        <strong>{formatAngle(angleAt(v, a, b))}</strong>
        <div className="d">
          Angle · legs {formatLength(measureBetween(v, a).length, unit).split(' ')[0]} / {formatLength(measureBetween(v, b).length, unit)}
        </div>
      </div>
    );
  }
  const [a, b] = m.pts;
  const r = measureBetween(a, b);
  return (
    <div className="v">
      <strong>{formatLength(r.length, unit)}</strong>
      <div className="d">Δx {formatLength(r.dx, unit)} · Δy {formatLength(r.dy, unit)} · ∠ {formatAngle(lineAngle(a, b))}</div>
    </div>
  );
}

// A label pill centred on (x, y), kept at a constant screen size.
function Pill({ x, y, text, px, outline }) {
  const w = px(text.length * PILL_CHAR_PX + 18);
  const h = px(22);
  return (
    <g className={`m-pill${outline ? ' outline' : ''}`}>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={px(6)} vectorEffect="non-scaling-stroke" />
      <text x={x} y={y + px(4.4)} fontSize={px(12.5)} textAnchor="middle">{text}</text>
    </g>
  );
}

// Filled arrowhead with its tip on `tip`, pointing away from `from`.
function Arrow({ tip, from, px }) {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (!len) return null;
  const ux = (tip.x - from.x) / len; const uy = (tip.y - from.y) / len;
  const bx = tip.x - ux * px(11); const by = tip.y - uy * px(11);
  const nx = -uy * px(4.5); const ny = ux * px(4.5);
  return <path className="m-arrow" d={`M ${tip.x} ${tip.y} L ${bx + nx} ${by + ny} L ${bx - nx} ${by - ny} Z`} />;
}

// A finished or in-progress measurement drawn on the canvas.
function Mark({ m, n, unit, px, hot, live }) {
  const cls = `m-dim${hot ? ' hot' : ''}${live ? ' live' : ''}`;
  const prefix = n ? `${n} · ` : '';
  const ends = (points) => points.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={px(4.5)} className="m-end" vectorEffect="non-scaling-stroke" />);
  const leg = (a, b, key) => <line key={key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} vectorEffect="non-scaling-stroke" />;

  if (m.type === 'angle') {
    const [v, a, b] = m.pts;
    if (!b) return <g className={cls}>{leg(v, a)}{ends([v, a])}</g>; // Only the first leg so far.
    const la = measureBetween(v, a).length;
    const lb = measureBetween(v, b).length;
    const deg = angleAt(v, a, b);
    const ua = { x: (a.x - v.x) / la, y: (a.y - v.y) / la };
    const ub = { x: (b.x - v.x) / lb, y: (b.y - v.y) / lb };
    const r = Math.min(px(52), 0.6 * Math.min(la, lb));
    const sweep = ua.x * ub.y - ua.y * ub.x > 0 ? 1 : 0;
    let bx = ua.x + ub.x; let by = ua.y + ub.y;
    const bl = Math.hypot(bx, by);
    // Legs pointing in opposite directions have no bisector — use the normal.
    if (bl < 1e-9) { bx = -ua.y * (sweep ? -1 : 1); by = ua.x * (sweep ? -1 : 1); } else { bx /= bl; by /= bl; }
    const text = prefix + formatAngle(deg);
    const lr = r + px(text.length * PILL_CHAR_PX / 2 + 14);
    return (
      <g className={cls}>
        {leg(v, a, 'a')}{leg(v, b, 'b')}
        <path
          className="m-arc" vectorEffect="non-scaling-stroke"
          d={`M ${v.x + ua.x * r} ${v.y + ua.y * r} A ${r} ${r} 0 0 ${sweep} ${v.x + ub.x * r} ${v.y + ub.y * r}`}
        />
        {ends([v, a, b])}
        <Pill x={v.x + bx * lr} y={v.y + by * lr} text={text} px={px} outline />
      </g>
    );
  }

  const [a, b] = m.pts;
  const len = measureBetween(a, b).length;
  // Arrowheads only once the line is long enough on screen to carry them.
  const arrows = len / px(1) > 48;
  return (
    <g className={cls}>
      {leg(a, b)}
      {arrows && <><Arrow tip={a} from={b} px={px} /><Arrow tip={b} from={a} px={px} /></>}
      {!arrows && ends([a, b])}
      <Pill x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} text={prefix + formatLength(len, unit)} px={px} />
    </g>
  );
}
