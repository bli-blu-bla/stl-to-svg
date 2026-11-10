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
  const curves = [];
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;

  // Circles are read as four quarter arcs, which makes their quadrant points
  // vertices to snap to; the centre is added as one more.
  const shapes = [];
  for (const m of text.matchAll(/<(path|circle)\b([^>]*)>/g)) {
    const num = (name) => Number(m[2].match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]);
    if (m[1] === 'path') {
      const d = m[2].match(/\sd="([^"]*)"/)?.[1];
      if (d) shapes.push({ d });
      continue;
    }
    const cx = num('cx'); const cy = num('cy'); const r = num('r');
    if (![cx, cy, r].every(Number.isFinite) || r <= 0) continue;
    const q = `A ${r} ${r} 0 0 1`;
    shapes.push({ d: `M ${cx + r} ${cy} ${q} ${cx} ${cy + r} ${q} ${cx - r} ${cy} ${q} ${cx} ${cy - r} ${q} ${cx + r} ${cy} Z`, circle: { cx, cy, r } });
    vertices.push(cx, cy);
  }

  for (const { d, circle } of shapes) {
    paths.push(d);
    for (const { points, outline, closed, arcs } of parsePathData(d)) {
      // The same outline as one walkable curve, for the gap and circle tools.
      const pts = outline.slice();
      const end = pts[pts.length - 1];
      if (closed && pts.length > 2 && (end[0] !== pts[0][0] || end[1] !== pts[0][1])) pts.push(pts[0]);
      if (pts.length > 1) {
        curves.push({
          pts,
          closed,
          arcs: circle ? [{ from: 0, to: pts.length - 1, ...circle, full: true }] : arcs,
        });
      }
      for (const [x, y] of points) vertices.push(x, y);
      // Arcs are followed along short chords for snapping and for the bounds.
      for (let i = 0; i < outline.length; i++) {
        const [x, y] = outline[i];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (i > 0) segments.push(outline[i - 1][0], outline[i - 1][1], x, y);
      }
      const a = outline[outline.length - 1];
      if (closed && outline.length > 2 && (a[0] !== outline[0][0] || a[1] !== outline[0][1])) {
        segments.push(a[0], a[1], outline[0][0], outline[0][1]);
      }
    }
  }

  const bounds = Number.isFinite(minX)
    ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
    : { minX: viewBox[0], minY: viewBox[1], maxX: viewBox[0] + viewBox[2], maxY: viewBox[1] + viewBox[3], width: viewBox[2], height: viewBox[3] };

  return { unit, viewBox, paths, vertices, segments, curves, bounds };
}

// Only the M / L / A / Z subset is needed — that is all buildSVG() emits, and
// its arcs are always circular (rx = ry, no rotation). Each subpath has its
// `points` (where segments start and end), its `outline` — the same path
// with every arc followed along short chords — and `arcs`, the circle behind
// each stretch of that outline ({ from, to } index it).
export function parsePathData(d) {
  const tokens = d.match(/[MLAZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  const subpaths = [];
  let current = null;
  let cmd = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^[MLAZ]$/i.test(t)) {
      cmd = t.toUpperCase();
      if (cmd === 'Z' && current) {
        current.closed = true;
        current = null;
      }
      continue;
    }
    let arc = null;
    if (cmd === 'A' && current) {
      arc = { r: Number(t), large: Number(tokens[i + 3]) !== 0, sweep: Number(tokens[i + 4]) !== 0 };
      i += 5;
    }
    const x = Number(tokens[i]);
    const y = Number(tokens[++i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    if (cmd === 'M' || !current) {
      current = { points: [], outline: [], arcs: [], closed: false };
      subpaths.push(current);
      cmd = 'L'; // Extra coordinate pairs after M are implicit line-tos.
      arc = null;
    }
    if (arc && Number.isFinite(arc.r)) {
      const from = current.points[current.points.length - 1];
      const c = arcChords(from[0], from[1], arc.r, arc.large, arc.sweep, x, y);
      if (c) {
        current.arcs.push({ from: current.outline.length - 1, to: current.outline.length + c.pts.length, cx: c.cx, cy: c.cy, r: c.r, full: false });
        current.outline.push(...c.pts);
      }
    }
    current.points.push([x, y]);
    current.outline.push([x, y]);
  }
  return subpaths.filter((s) => s.points.length);
}

// The circle of a circular SVG arc and points along it, strictly between its
// two ends, close enough together that the chords stay within a thousandth
// of a unit of it.
function arcChords(x1, y1, radius, large, sweep, x2, y2) {
  const hx = (x1 - x2) / 2; const hy = (y1 - y2) / 2;
  const half2 = hx * hx + hy * hy;
  if (!half2 || !(radius > 0)) return null;
  // As the SVG spec has it: a radius too small to span the ends is scaled up.
  const r = Math.max(radius, Math.sqrt(half2));
  const k = Math.sqrt(Math.max(0, r * r - half2) / half2) * (large === sweep ? -1 : 1);
  const cx = (x1 + x2) / 2 + k * hy;
  const cy = (y1 + y2) / 2 - k * hx;
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  let da = Math.atan2(y2 - cy, x2 - cx) - a1;
  if (sweep && da < 0) da += 2 * Math.PI;
  if (!sweep && da > 0) da -= 2 * Math.PI;
  const step = 2 * Math.acos(1 - Math.min(0.5, 1e-3 / r));
  const n = Math.min(720, Math.max(2, Math.ceil(Math.abs(da) / step)));
  const out = [];
  for (let i = 1; i < n; i++) {
    const a = a1 + (da * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return { cx, cy, r, pts: out };
}

// --- Curves: the gap and circle tools ----------------------------------------

// Closest point of segment `i` of a curve to (x, y).
function onSegment(curve, i, x, y) {
  const a = curve.pts[i]; const b = curve.pts[i + 1];
  const ex = b[0] - a[0]; const ey = b[1] - a[1];
  const len2 = ex * ex + ey * ey;
  const t = len2 ? Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / len2)) : 0;
  const px = a[0] + t * ex; const py = a[1] + t * ey;
  return { i, x: px, y: py, d2: (px - x) ** 2 + (py - y) ** 2 };
}

// The spot on any curve nearest to (x, y), within `tol`. Unlike snapPoint it
// says which curve it is on and where, so the point can be slid along it.
export function curveHit(geom, x, y, tol) {
  let best = null;
  let bestD = tol * tol;
  geom.curves.forEach((curve, c) => {
    for (let i = 0; i < curve.pts.length - 1; i++) {
      const h = onSegment(curve, i, x, y);
      if (h.d2 <= bestD) { bestD = h.d2; best = { curve: c, i: h.i, x: h.x, y: h.y }; }
    }
  });
  return best;
}

// The circle a curve follows at a hit, if that stretch is an arc or a circle.
export function arcAt(geom, hit) {
  if (!hit) return null;
  return geom.curves[hit.curve].arcs.find((a) => hit.i >= a.from && hit.i < a.to) || null;
}

// The narrowest place between two curves, near where each was picked. Both
// points slide along their own curve — each in turn to the spot nearest the
// other — until neither moves. Sliding, not jumping: the two picks may lie on
// the same outline (the waist of a part), where the nearest point overall
// would always be the other pick itself.
export function closestGap(geom, a, b) {
  const slide = (hit, to) => {
    const curve = geom.curves[hit.curve];
    const n = curve.pts.length - 1;
    // Look only a short way along the curve from where the point is now.
    const reach = Math.max(3, Math.ceil(n / 64));
    let best = onSegment(curve, hit.i, to.x, to.y);
    for (let k = -reach; k <= reach; k++) {
      let i = hit.i + k;
      if (curve.closed) i = ((i % n) + n) % n;
      else if (i < 0 || i >= n) continue;
      const h = onSegment(curve, i, to.x, to.y);
      if (h.d2 < best.d2) best = h;
    }
    return { curve: hit.curve, i: best.i, x: best.x, y: best.y };
  };
  let p = a; let q = b;
  for (let iter = 0; iter < 4000; iter++) {
    const np = slide(p, q);
    const nq = slide(q, np);
    const moved = Math.hypot(np.x - p.x, np.y - p.y) + Math.hypot(nq.x - q.x, nq.y - q.y);
    p = np; q = nq;
    if (moved < 1e-10) break;
  }
  return exactGap(geom, p, q) || [{ x: p.x, y: p.y }, { x: q.x, y: q.y }];
}

// The walk above runs along the short chords an arc is followed with, which
// places the narrow spot only to within a chord. Where an arc is involved the
// true spot is known: on the line through the two centres, or on the
// perpendicular from the centre to a straight side.
function exactGap(geom, p, q) {
  const ends = [p, q].map((h) => {
    const curve = geom.curves[h.curve];
    const a = curve.pts[h.i]; const b = curve.pts[h.i + 1];
    return { h, a, b, arc: arcAt(geom, h), chord: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  if (!ends[0].arc && !ends[1].arc) return null;

  // Which way the gap runs, seen from the first end.
  let dx; let dy;
  if (ends[0].arc && ends[1].arc) {
    dx = ends[1].arc.cx - ends[0].arc.cx; dy = ends[1].arc.cy - ends[0].arc.cy;
  } else {
    const line = ends[0].arc ? ends[1] : ends[0];
    dx = -(line.b[1] - line.a[1]); dy = line.b[0] - line.a[0];
  }
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null; // Concentric: equally far apart everywhere.
  dx /= len; dy /= len;

  // On an arc: where that direction leaves the circle, on the side found.
  const onArc = (e) => {
    const s = Math.sign((e.h.x - e.arc.cx) * dx + (e.h.y - e.arc.cy) * dy) || 1;
    return { x: e.arc.cx + s * e.arc.r * dx, y: e.arc.cy + s * e.arc.r * dy };
  };
  const out = ends.map((e) => (e.arc ? onArc(e) : null));
  for (let k = 0; k < 2; k++) {
    if (out[k]) continue;
    // On a straight side: the foot of the perpendicular from the arc's point.
    const e = ends[k]; const o = out[1 - k];
    const ex = e.b[0] - e.a[0]; const ey = e.b[1] - e.a[1];
    const t = ((o.x - e.a[0]) * ex + (o.y - e.a[1]) * ey) / (ex * ex + ey * ey);
    if (!(t >= 0 && t <= 1)) return null; // The gap ends at a corner.
    out[k] = { x: e.a[0] + t * ex, y: e.a[1] + t * ey };
  }
  // Only a correction: it must land where the walk already arrived, or the
  // narrow spot is at the end of an arc and not where its circle would have it.
  for (let k = 0; k < 2; k++) {
    if (ends[k].arc && Math.hypot(out[k].x - ends[k].h.x, out[k].y - ends[k].h.y) > 2 * ends[k].chord) return null;
  }
  return out;
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

// Alignment ("tracking") candidates: every outline vertex plus any extra
// points, e.g. those already placed for the measurement in progress.
function* alignTargets(geom, extra) {
  const v = geom.vertices;
  for (let i = 0; i < v.length; i += 2) yield [v[i], v[i + 1]];
  for (const p of extra || []) yield [p.x, p.y];
}

// Snap `x` to the column and/or `y` to the row of a nearby vertex, within
// `tol`. Ties between vertices on the same line go to the one closest to the
// cursor, which is where the guide is drawn from. Returns null when nothing
// lines up.
export function alignPoint(geom, x, y, tol, extra) {
  let col = null; let colD = tol; let colR = Infinity;
  let row = null; let rowD = tol; let rowR = Infinity;
  for (const [vx, vy] of alignTargets(geom, extra)) {
    const r = Math.hypot(vx - x, vy - y);
    const dx = Math.abs(vx - x);
    if (dx < colD - 1e-12 || (dx <= colD + 1e-12 && r < colR)) { colD = dx; colR = r; col = { x: vx, y: vy }; }
    const dy = Math.abs(vy - y);
    if (dy < rowD - 1e-12 || (dy <= rowD + 1e-12 && r < rowR)) { rowD = dy; rowR = r; row = { x: vx, y: vy }; }
  }
  if (!col && !row) return null;
  return {
    x: col ? col.x : x,
    y: row ? row.y : y,
    kind: 'align',
    guides: [col, row].filter(Boolean),
  };
}

// Along a locked ray from `a`, stop where it crosses the row or column of a
// vertex, if that crossing is within `tol` of `p`.
export function rayAlign(geom, a, dir, p, tol, extra) {
  const [ux, uy] = dir;
  let best = null;
  let bestD = tol;
  const consider = (t, ref) => {
    if (!(t > 1e-9)) return;
    const x = a.x + ux * t; const y = a.y + uy * t;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < bestD) { bestD = d; best = { x, y, kind: 'align', guides: [ref], dir }; }
  };
  for (const [vx, vy] of alignTargets(geom, extra)) {
    if (Math.abs(uy) > 1e-12) consider((vy - a.y) / uy, { x: vx, y: vy });
    if (Math.abs(ux) > 1e-12) consider((vx - a.x) / ux, { x: vx, y: vy });
  }
  return best;
}
