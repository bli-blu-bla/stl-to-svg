import React from 'react';
import { UNITS } from '../lib/svg.js';

const RESOLUTIONS = [
  { value: 0.05, label: 'High (0.05 mm)' },
  { value: 0.1, label: 'Fine (0.1 mm)' },
  { value: 0.25, label: 'Medium (0.25 mm)' },
  { value: 0.5, label: 'Coarse (0.5 mm)' },
  { value: 1, label: 'Low (1.0 mm)' },
];

const PLANES = [
  { key: 'XY', label: 'XY', hint: 'XY — top view' },
  { key: 'XZ', label: 'XZ', hint: 'XZ — front view' },
  { key: 'YZ', label: 'YZ', hint: 'YZ — side view' },
  { key: 'custom', label: 'Custom', hint: 'Custom — rotate and tilt the plane freely' },
];

// The conversion form. `children` renders below it (the convert actions).
export default function Settings({ s, set, range, disabled, children }) {
  const intersection = s.mode === 'intersection';
  const span = range.max - range.min;
  const step = span > 0 ? span / 1000 : 0.01;
  const plane = PLANES.find((p) => p.key === s.planeKey) || PLANES[0];

  return (
    <section className="panel settings" aria-label="Conversion settings">
      <h2 className="panel-title">Settings</h2>

      <div className="seg" role="radiogroup" aria-label="Mode">
        {[['intersection', 'Intersection'], ['projection', 'Projection']].map(([mode, label]) => (
          <button
            key={mode}
            role="radio"
            aria-checked={s.mode === mode}
            onClick={() => set({ mode })}
            title={mode === 'intersection' ? 'Slice the model where the plane cuts it' : 'Trace the silhouette seen through the plane'}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="field">
        <span className="field-label" id="plane-label">{intersection ? 'Cutting plane' : 'Viewing plane'}</span>
        <div className="chips" role="group" aria-labelledby="plane-label">
          {PLANES.map((p) => (
            <button
              key={p.key}
              aria-pressed={s.planeKey === p.key}
              title={p.hint}
              onClick={() => set({ planeKey: p.key })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="field-hint">{plane.hint}</span>
      </div>

      {s.planeKey === 'custom' && (
        <div className="grid-2">
          <div className="field">
            <label htmlFor="yaw">Rotate around Z · <span className="mono">{s.yaw}°</span></label>
            <input id="yaw" type="range" min="0" max="360" step="1"
              value={s.yaw} onChange={(e) => set({ yaw: +e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pitch">Tilt from Z · <span className="mono">{s.pitch}°</span></label>
            <input id="pitch" type="range" min="0" max="180" step="1"
              value={s.pitch} onChange={(e) => set({ pitch: +e.target.value })} />
          </div>
        </div>
      )}

      {intersection && (
        <div className="field">
          <div className="field-head">
            <label htmlFor="offset">Plane offset</label>
            <input
              className="value-input" type="number" step={0.1} value={round(s.offset)}
              disabled={disabled}
              aria-label="Plane offset value"
              onChange={(e) => set({ offset: clamp(+e.target.value, range.min, range.max) })}
            />
          </div>
          <input
            id="offset" type="range"
            min={range.min} max={range.max} step={step}
            value={s.offset}
            disabled={disabled || span <= 0}
            onChange={(e) => set({ offset: +e.target.value })}
          />
          <div className="range-hint">
            <span>{round(range.min)}</span>
            <span>model extent along the normal</span>
            <span>{round(range.max)}</span>
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="field">
          <label htmlFor="res">Resolution</label>
          <select id="res" value={s.resolution} onChange={(e) => set({ resolution: +e.target.value })}>
            {RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sw">Stroke width (mm)</label>
          <input id="sw" type="number" min="0.01" max="5" step="0.01"
            value={s.strokeWidth}
            onChange={(e) => set({ strokeWidth: clamp(+e.target.value || 0.1, 0.01, 5) })} />
        </div>
        <div className="field">
          <label htmlFor="unit">Output unit</label>
          <select id="unit" value={s.unit} onChange={(e) => set({ unit: e.target.value })}>
            {Object.entries(UNITS).map(([k, u]) => <option key={k} value={k}>{u.label}</option>)}
          </select>
        </div>
        {!intersection && (
          <div className="field">
            <label htmlFor="q">Quality</label>
            <select id="q" value={s.quality} onChange={(e) => set({ quality: e.target.value })}>
              <option value="auto">Auto</option>
              <option value="exact">Exact — crisp edges</option>
              <option value="raster">Fast — for huge meshes</option>
            </select>
          </div>
        )}
      </div>

      {children}
    </section>
  );
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v) => Math.round(v * 1000) / 1000;
