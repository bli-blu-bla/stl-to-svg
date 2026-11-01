// Geometry helpers for the measuring view. They read back the SVGs that
// buildSVG() writes, where one viewBox unit equals one output unit (mm, cm,
// in or px), so distances measured in viewBox space are real-world sizes.

const DECIMALS = { mm: 2, cm: 3, in: 3, px: 1 };

export function parseSVG(text) {
  const attr = (name) => text.match(new RegExp(`<svg\\b[^>]*\\s${name}="([^"]*)"`))?.[1];
  const unit = (attr('width') || '').match(/[a-z]+$/i)?.[0] || 'px';
  const vb = (attr('viewBox') || '0 0 1 1').trim().split(/[\s,]+/).map(Number);
  const viewBox = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, 1, 1];

  const paths = [];
  const vertices = [];
  const segments = [];
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;

  for (const [, d] of text.matchAll(/<path\b[^>]*\sd="([^"]*)"/g)) {
    paths.push(d);
    for (const { points, closed } of parsePathData(d)) {
      for (let i = 0; i < points.length; i++) {
        const [x, y] = points[i];
        vertices.push(x, y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (i > 0) segments.push(points[i - 1][0], points[i - 1][1], x, y);
      }
      if (closed && points.length > 2) {
        const a = points[points.length - 1];
        segments.push(a[0], a[1], points[0][0], points[0][1]);
      }
    }
  }

  const bounds = Number.isFinite(minX)
    ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
    : { minX: viewBox[0], minY: viewBox[1], maxX: viewBox[0] + viewBox[2], maxY: viewBox[1] + viewBox[3], width: viewBox[2], height: viewBox[3] };

  return { unit, viewBox, paths, vertices, segments, bounds };
}

// Only the M / L / Z subset is needed — that is all buildSVG() emits.
export function parsePathData(d) {
  const tokens = d.match(/[MLZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  const subpaths = [];
  let current = null;
  let cmd = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^[MLZ]$/i.test(t)) {
      cmd = t.toUpperCase();
      if (cmd === 'Z' && current) {
        current.closed = true;
        current = null;
      }
      continue;
    }
    const x = Number(t);
    const y = Number(tokens[++i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    if (cmd === 'M' || !current) {
      current = { points: [], closed: false };
      subpaths.push(current);
      cmd = 'L'; // Extra coordinate pairs after M are implicit line-tos.
    }
    current.points.push([x, y]);
  }
  return subpaths.filter((s) => s.points.length);
}

// Nearest vertex within `tol`, else the nearest point on an edge within `tol`.
export function snapPoint(geom, x, y, tol) {
  const tol2 = tol * tol;
  const v = geom.vertices;
  let best = null;
  let bestD = tol2;
  for (let i = 0; i < v.length; i += 2) {
    const dx = v[i] - x; const dy = v[i + 1] - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) { bestD = d; best = { x: v[i], y: v[i + 1], kind: 'vertex' }; }
  }
  if (best) return best;

  const s = geom.segments;
  bestD = tol2;
  for (let i = 0; i < s.length; i += 4) {
    const ax = s[i]; const ay = s[i + 1];
    const ex = s[i + 2] - ax; const ey = s[i + 3] - ay;
    const len2 = ex * ex + ey * ey;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / len2)) : 0;
    const px = ax + t * ex; const py = ay + t * ey;
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d <= bestD) { bestD = d; best = { x: px, y: py, kind: 'edge' }; }
  }
  return best;
}

export function measureBetween(a, b) {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return { dx, dy, length: Math.hypot(dx, dy) };
}

export function formatLength(value, unit) {
  const n = DECIMALS[unit] ?? 2;
  return `${value.toFixed(n)} ${unit}`;
}

const clean = (n) => (Math.abs(n) < 1e-12 ? 0 : n);

// Rotate `p` about `a` onto the nearest multiple of `stepDeg`, keeping its
// distance along that direction. `dir` is the unit vector of the locked ray.
export function snapAngle(a, p, stepDeg = 45) {
  const dx = p.x - a.x; const dy = p.y - a.y;
  if (!dx && !dy) return { x: p.x, y: p.y, kind: null, dir: null };
  const step = (stepDeg * Math.PI) / 180;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  const ux = clean(Math.cos(ang)); const uy = clean(Math.sin(ang));
  const t = dx * ux + dy * uy;
  return { x: a.x + ux * t, y: a.y + uy * t, kind: null, dir: [ux, uy] };
}

// Where the ray from `a` along `dir` crosses the geometry, nearest to `p`
// and within `tol` of it. Lets a locked line stop exactly on an edge.
export function rayHit(geom, a, dir, p, tol) {
  const [ux, uy] = dir;
  const s = geom.segments;
  let best = null;
  let bestD = tol;
  for (let i = 0; i < s.length; i += 4) {
    const ax = s[i]; const ay = s[i + 1];
    const ex = s[i + 2] - ax; const ey = s[i + 3] - ay;
    const den = ux * ey - uy * ex;
    if (Math.abs(den) < 1e-12) continue; // Parallel to the ray.
    const wx = ax - a.x; const wy = ay - a.y;
    const t = (wx * ey - wy * ex) / den;
    const u = (wx * uy - wy * ux) / den;
    if (t <= 0 || u < -1e-9 || u > 1 + 1e-9) continue;
    const x = a.x + ux * t; const y = a.y + uy * t;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d <= bestD) {
      bestD = d;
      const end = u < 1e-6 || u > 1 - 1e-6;
      best = { x, y, kind: end ? 'vertex' : 'edge', dir };
    }
  }
  return best;
}

// Inner angle at vertex `v` between the legs to `a` and `b`, in degrees (0–180).
export function angleAt(v, a, b) {
  const ax = a.x - v.x; const ay = a.y - v.y;
  const bx = b.x - v.x; const by = b.y - v.y;
  return (Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by) * 180) / Math.PI;
}

// Direction of a line against the horizontal, 0–180°, counter-clockwise as
// drawn on screen (SVG's y axis points down, so it is flipped here).
export function lineAngle(a, b) {
  const deg = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
  const r = ((deg % 180) + 180) % 180;
  return r > 179.95 ? 0 : r;
}

export const formatAngle = (deg) => `${deg.toFixed(1)}°`;
