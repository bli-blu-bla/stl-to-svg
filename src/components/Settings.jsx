import React from 'react';
import { UNITS } from '../lib/svg.js';

const RESOLUTIONS = [
  { value: 0.05, label: 'High (0.05 mm)' },
  { value: 0.1, label: 'Fine (0.1 mm)' },
  { value: 0.25, label: 'Medium (0.25 mm)' },
  { value: 0.5, label: 'Coarse (0.5 mm)' },
  { value: 1, label: 'Low (1.0 mm)' },
];

export default function Settings({ s, set, range, disabled }) {
  const custom = s.planeKey === 'custom';
  const span = range.max - range.min;
  const step = span > 0 ? span / 1000 : 0.01;

  return (
    <div className="panel">
      <h3>Conversion Settings</h3>

      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={s.mode === 'intersection'}
          className={s.mode === 'intersection' ? 'active' : ''}
          onClick={() => set({ mode: 'intersection' })}
        >
          Intersection Outline
        </button>
        <button
          role="tab"
          aria-selected={s.mode === 'projection'}
          className={s.mode === 'projection' ? 'active' : ''}
          onClick={() => set({ mode: 'projection' })}
        >
          Projection Outline
        </button>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="unit">Output Units</label>
          <select id="unit" value={s.unit} onChange={(e) => set({ unit: e.target.value })}>
            {Object.entries(UNITS).map(([k, u]) => <option key={k} value={k}>{u.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="plane">{s.mode === 'intersection' ? 'Cutting Plane' : 'Viewing Plane'}</label>
          <select id="plane" value={s.planeKey} onChange={(e) => set({ planeKey: e.target.value })}>
            <option value="XY">XY Plane (top view)</option>
            <option value="XZ">XZ Plane (front view)</option>
            <option value="YZ">YZ Plane (side view)</option>
            <option value="custom">Custom Plane…</option>
          </select>
        </div>
      </div>

      {custom && (
        <div className="field-row">
          <div className="field">
            <label htmlFor="yaw">Rotation around Z: {s.yaw}°</label>
            <input id="yaw" type="range" min="0" max="360" step="1"
              value={s.yaw} onChange={(e) => set({ yaw: +e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pitch">Tilt from Z: {s.pitch}°</label>
            <input id="pitch" type="range" min="0" max="180" step="1"
              value={s.pitch} onChange={(e) => set({ pitch: +e.target.value })} />
          </div>
        </div>
      )}

      {s.mode === 'intersection' && (
        <div className="field">
          <label htmlFor="offset">Plane Offset</label>
          <div className="slider-row">
            <input
              id="offset" type="range"
              min={range.min} max={range.max} step={step}
              value={s.offset}
              disabled={disabled || span <= 0}
              onChange={(e) => set({ offset: +e.target.value })}
            />
            <input
              type="number" step={0.1} value={round(s.offset)}
              disabled={disabled}
              aria-label="Plane offset value"
              onChange={(e) => set({ offset: clamp(+e.target.value, range.min, range.max) })}
            />
          </div>
          <div className="range-hint">
            <span>{round(range.min)}</span>
            <span>model extent along plane normal</span>
            <span>{round(range.max)}</span>
          </div>
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="res">Resolution</label>
          <select id="res" value={s.resolution} onChange={(e) => set({ resolution: +e.target.value })}>
            {RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sw">Stroke Width (mm)</label>
          <input id="sw" type="number" min="0.01" max="5" step="0.01"
            value={s.strokeWidth}
            onChange={(e) => set({ strokeWidth: clamp(+e.target.value || 0.1, 0.01, 5) })} />
        </div>
      </div>

      {s.mode === 'projection' && (
        <div className="field">
          <label htmlFor="q">Outline Quality</label>
          <select id="q" value={s.quality} onChange={(e) => set({ quality: e.target.value })}>
            <option value="auto">Auto (exact, raster above 60k triangles)</option>
            <option value="exact">Exact — boolean union, crisp edges</option>
            <option value="raster">Fast — grid sampled, for very large meshes</option>
          </select>
        </div>
      )}

      <div className="note">
        {s.mode === 'intersection' ? (
          <>
            <strong>Intersection Mode:</strong> slices through your 3D model at a specific plane to
            create cross-section outlines. Ideal for internal structure patterns, cross-sections, or
            layered cutting templates.
          </>
        ) : (
          <>
            <strong>Projection Mode:</strong> flattens the whole model onto the plane and traces the
            resulting silhouette, holes included. Ideal for templates, stencils, gaskets, and simple
            cutting patterns.
          </>
        )}
      </div>
    </div>
  );
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v) => Math.round(v * 1000) / 1000;
