// Arc and circle recognition.
//
// A mesh only knows polygons: a hole is a 48-gon, a rounded corner a handful
// of short chords. This module looks at a contour *before* it is simplified —
// while every mesh vertex is still there — and finds the runs of vertices that
// lie on a common circle. Those runs are written as true arcs (and closed ones
// as circles); only what is left over is simplified as straight lines.
//
// A path comes out as { closed, points } plus, when something was recognised,
//   circle: { cx, cy, r }        the whole path is one circle, or
//   arcs:   [null | arc, ...]    arcs[i] is the arc that ends at points[i]
//                                (arcs[0]: the closing segment of a ring),
//                                null where a straight line ends there.
// An arc is { cx, cy, r, ccw, sweep }: centre, radius, direction of travel in
// the plane's (u, v) axes, and the angle it covers in radians.

import { simplify } from './geom2d.js';

// Widest angle one chord of an arc may span. A circle needs at least twelve
// sides to be taken as one, so hexagons and octagons stay polygons.
const MAX_STEP = (30.5 * Math.PI) / 180;
// Fewest chords that make an arc. Three chords only count when they are of
// equal length: any symmetric trapezoid has its four corners on a circle.
const MIN_CHORDS = 4;
// A tessellated arc has chords of about one length. A chord much longer than
// the typical one is a straight edge between two curves, not part of an arc —
// drawn as one it would bulge away from the wall it stands for.
const MAX_CHORD_RATIO = 2.5;
const TAU = 2 * Math.PI;

// The one place contours are finished: with `arcs` off this is the plain
// Ramer-Douglas-Peucker simplification.
export function tracePath(points, closed, tolerance, arcs) {
  if (!arcs) return { closed, points: simplify(points, tolerance, closed) };
  return fitArcs(points, closed, tolerance);
}

// Whether a traced path still has something to draw.
export function drawable(p) {
  return !!p.circle || !!p.arcs || p.points.length >= (p.closed ? 3 : 2);
}

export function fitArcs(points, closed, tolerance) {
  // How far a vertex may sit from the circle it is assigned to.
  const fitTol = tolerance * 0.5;
  const plain = () => ({ closed, points: simplify(points, tolerance, closed) });
  if (points.length < MIN_CHORDS || !(tolerance > 0)) return plain();

  // Drop vertices that sit on a straight line between their neighbours (a
  // slice crosses the diagonal of every quad, mid-chord). What remains are
  // the vertices the tessellator placed on the curve.
  let pts = closed ? rotate(points, lowestIndex(points)) : points;
  pts = simplify(pts, tolerance * 0.01, closed);

  if (closed) {
    const circle = wholeCircle(pts, fitTol);
    if (circle) {
      const { cx, cy, r } = circle;
      // The four quadrant points: enough for exact bounds.
      return { closed: true, circle, points: [[cx + r, cy], [cx, cy + r], [cx - r, cy], [cx, cy - r]] };
    }
  }

  let seq = closed ? pts.concat([pts[0]]) : pts;
  let runs = findArcs(seq, fitTol, tolerance);
  if (!runs.length) return plain();
  if (closed && runs.length) {
    // The ring was cut at an arbitrary vertex, possibly in the middle of an
    // arc. The end of the first arc found is a real boundary: start there.
    const start = runs[0].j % pts.length;
    if (start !== 0) {
      pts = rotate(pts, start);
      seq = pts.concat([pts[0]]);
      runs = findArcs(seq, fitTol, tolerance);
      if (!runs.length) return plain();
    }
  }

  // Stitch arcs and the simplified straight runs between them back together.
  const out = [seq[0]];
  const arcs = [null];
  let at = 0;
  const lineTo = (end) => {
    if (end <= at) return;
    const run = simplify(seq.slice(at, end + 1), tolerance, false);
    for (let k = 1; k < run.length; k++) { out.push(run[k]); arcs.push(null); }
    at = end;
  };
  for (const run of runs) {
    lineTo(run.i);
    out.push(seq[run.j]);
    arcs.push(run.arc);
    at = run.j;
  }
  lineTo(seq.length - 1);

  if (closed) {
    // The last point repeats the first; its segment becomes the closing one.
    out.pop();
    arcs[0] = arcs.pop();
  }
  return { closed, points: out, arcs };
}

// Bounding box of traced paths, arcs bulging past their chords included.
export function pathBounds(paths) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const add = (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const p of paths) {
    const pts = p.points;
    for (const [x, y] of pts) add(x, y);
    if (!p.arcs) continue;
    for (let i = 0; i < pts.length; i++) {
      const arc = p.arcs[i];
      if (!arc) continue;
      const from = pts[(i + pts.length - 1) % pts.length];
      const a0 = Math.atan2(from[1] - arc.cy, from[0] - arc.cx);
      // The arc reaches an axis extreme wherever it passes 0°, 90°, 180°, 270°.
      for (let q = 0; q < 4; q++) {
        const ang = (q * Math.PI) / 2;
        const travelled = arc.ccw ? norm(ang - a0) : norm(a0 - ang);
        if (travelled < arc.sweep) add(arc.cx + arc.r * Math.cos(ang), arc.cy + arc.r * Math.sin(ang));
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

// --- Recognition -----------------------------------------------------------

// A closed ring whose every vertex lies on one circle, in even enough steps.
function wholeCircle(pts, fitTol) {
  const n = pts.length;
  if (n < Math.ceil(TAU / MAX_STEP)) return null;
  const fit = fitCircle(pts, 0, n - 1);
  if (!fit) return null;
  let total = 0;
  let dir = 0;
  const steps = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i]; const q = pts[(i + 1) % n];
    if (Math.abs(Math.hypot(p[0] - fit.cx, p[1] - fit.cy) - fit.r) > fitTol) return null;
    const step = turn(Math.atan2(q[1] - fit.cy, q[0] - fit.cx) - Math.atan2(p[1] - fit.cy, p[0] - fit.cx));
    if (!dir) dir = Math.sign(step);
    if (step * dir <= 0 || step * dir > MAX_STEP) return null;
    total += step * dir;
    steps.push(step * dir);
  }
  return Math.abs(total - TAU) < 1e-6 && evenSteps(steps) ? fit : null;
}

// Greedy scan: from each vertex, the longest run that is an arc.
function findArcs(seq, fitTol, tolerance) {
  const last = seq.length - 1;
  const runs = [];
  let i = 0;
  while (i + 3 <= last) {
    const hit = growArc(seq, i, last, fitTol);
    if (!hit) { i++; continue; }
    // So flat that a straight line is within tolerance anyway: leave it to
    // the line simplification.
    const { r, sweep } = hit.arc;
    if (sweep >= Math.PI || r * (1 - Math.cos(sweep / 2)) > tolerance) runs.push(hit);
    i = hit.j;
  }
  return runs;
}

function growArc(seq, i, last, fitTol) {
  const test = (j) => arcThrough(seq, i, j, fitTol);
  let best = i + MIN_CHORDS <= last ? test(i + MIN_CHORDS) : null;
  if (!best) {
    const three = test(i + 3);
    return three && evenChords(seq, i, i + 3) ? three : null;
  }
  // Gallop outwards, then bisect back to the last vertex still on the arc.
  let lo = best.j;
  let hi = lo;
  for (let span = MIN_CHORDS * 2; ; span *= 2) {
    hi = Math.min(last, i + span);
    const t = hi > lo ? test(hi) : null;
    if (!t) break;
    best = t; lo = hi;
    if (hi === last) return best;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const t = test(mid);
    if (t) { best = t; lo = mid; } else hi = mid;
  }
  return best;
}

// The arc from seq[i] to seq[j], if every vertex between them lies on it.
function arcThrough(seq, i, j, fitTol) {
  const fit = fitCircle(seq, i, j);
  if (!fit) return null;
  const a = seq[i]; const b = seq[j];

  // An SVG arc is given by its end points and a radius, so that is the circle
  // to judge: the fitted radius, pinned to pass through both ends exactly.
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) return null;
  const r = Math.max(fit.r, chord / 2);
  const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2;
  const side = Math.sign(dx * (fit.cy - a[1]) - dy * (fit.cx - a[0])) || 1;
  const h = Math.sqrt(Math.max(0, r * r - (chord * chord) / 4)) * side;
  const cx = mx - (dy / chord) * h;
  const cy = my + (dx / chord) * h;

  let sweep = 0;
  let dir = 0;
  const steps = [];
  let prev = Math.atan2(a[1] - cy, a[0] - cx);
  for (let k = i; k <= j; k++) {
    const p = seq[k];
    if (Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r) > fitTol) return null;
    if (k === i) continue;
    const ang = Math.atan2(p[1] - cy, p[0] - cx);
    const step = turn(ang - prev);
    if (!dir) dir = Math.sign(step);
    // Always onwards round the centre, never further than one chord may span.
    if (step * dir <= 0 || step * dir > MAX_STEP) return null;
    sweep += step * dir;
    steps.push(step * dir);
    prev = ang;
  }
  if (sweep > TAU - 1e-6 || !evenSteps(steps)) return null;
  return { i, j, arc: { cx, cy, r, ccw: dir > 0, sweep } };
}

function evenSteps(steps) {
  const sorted = steps.slice().sort((x, y) => x - y);
  return sorted[sorted.length - 1] <= sorted[sorted.length >> 1] * MAX_CHORD_RATIO;
}

function evenChords(seq, i, j) {
  let min = Infinity; let max = 0;
  for (let k = i; k < j; k++) {
    const l = Math.hypot(seq[k + 1][0] - seq[k][0], seq[k + 1][1] - seq[k][1]);
    if (l < min) min = l;
    if (l > max) max = l;
  }
  return max <= min * 1.05;
}

// Least-squares circle (Kåsa) through pts[i..j].
function fitCircle(pts, i, j) {
  const n = j - i + 1;
  let mx = 0; let my = 0;
  for (let k = i; k <= j; k++) { mx += pts[k][0]; my += pts[k][1]; }
  mx /= n; my /= n;
  let suu = 0; let suv = 0; let svv = 0; let suuu = 0; let svvv = 0; let suvv = 0; let svuu = 0;
  for (let k = i; k <= j; k++) {
    const u = pts[k][0] - mx; const v = pts[k][1] - my;
    suu += u * u; suv += u * v; svv += v * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  // Collinear points have no circle.
  if (Math.abs(det) <= 1e-12 * (suu + svv) ** 2) return null;
  const bu = (suuu + suvv) / 2; const bv = (svvv + svuu) / 2;
  const uc = (bu * svv - bv * suv) / det;
  const vc = (bv * suu - bu * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  return Number.isFinite(r) ? { cx: mx + uc, cy: my + vc, r } : null;
}

// --- Small helpers ---------------------------------------------------------

const norm = (a) => ((a % TAU) + TAU) % TAU; // → [0, 2π)
const turn = (a) => { const t = norm(a); return t > Math.PI ? t - TAU : t; }; // → (-π, π]
const rotate = (pts, k) => (k ? pts.slice(k).concat(pts.slice(0, k)) : pts);

// The leftmost (then lowest) vertex is always a real corner of the outline,
// never a point in the middle of a straight run.
function lowestIndex(pts) {
  let best = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] < pts[best][0] || (pts[i][0] === pts[best][0] && pts[i][1] < pts[best][1])) best = i;
  }
  return best;
}
