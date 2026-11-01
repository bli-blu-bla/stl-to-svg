// "All edges" projection: a drawing view of the model as seen along the plane
// normal, like a top view in a technical drawing. Besides the outline it shows
// every visible step, ledge, hole rim and chamfer.
//
// 1. Feature edges: creases (adjacent faces meet at more than `edgeAngle`),
//    open/non-manifold edges, and silhouettes of curved surfaces (one face
//    turned towards the viewer, the other away). Tessellation edges inside
//    smooth or flat surfaces are left out.
// 2. Hidden-line removal: the mesh is rasterised into a depth buffer seen from
//    the viewer, and each edge keeps only the stretches nothing covers.
// 3. Lines that coincide in 2D — the top and bottom rim of a vertical wall,
//    say — are merged, so a laser does not cut the same path twice.

import { cross, dot } from './plane.js';
import { chainSegments, simplify } from './geom2d.js';

const GRID_CELLS = 2048; // Depth-buffer resolution along the longer side.
// Steepest depth slope an edge's own faces may excuse (see featureEdges).
const MAX_SLOPE = 8;
// Distance (in cells) from a sample to the far corner of its 3×3 neighbourhood.
const REACH_CELLS = 2.2;
// A face counts as turned towards the viewer above this cosine; below, it is
// seen edge-on or from behind. Above float rounding of a wall's normal.
const FACING = 1e-5;

export function projectEdges(positions, basis, tolerance, edgeAngle = 30, onProgress) {
  const { u, v } = basis;
  // Look from the side where (u, v) reads like a normal, unmirrored drawing.
  const w = cross(u, v);
  const triCount = positions.length / 9;
  if (!triCount) return [];

  // Plane-local coordinates: x, y in the drawing, d = depth towards viewer.
  const vertCount = triCount * 3;
  const px = new Float64Array(vertCount);
  const py = new Float64Array(vertCount);
  const pd = new Float64Array(vertCount);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  let minD = Infinity; let maxD = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const p = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const x = dot(p, u); const y = dot(p, v); const d = dot(p, w);
    px[i] = x; py[i] = y; pd[i] = d;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (d < minD) minD = d; if (d > maxD) maxD = d;
  }
  const extent = Math.max(maxX - minX, maxY - minY, 1e-9);

  onProgress?.('Finding edges', 0.05);
  const edges = featureEdges(positions, w, edgeAngle, extent);

  onProgress?.('Removing hidden lines', 0.3);
  const zb = depthBuffer(px, py, pd, triCount, minX, minY, extent);
  const depthEps = Math.max(1e-9, (maxD - minD) * 1e-4);

  const segs = [];
  const step = zb.cell * 0.5;
  for (let e = 0; e < edges.length; e += 7) {
    // An edge's own faces can sit slightly in front of it inside the depth
    // cells around it (a chamfer rising from its rim, or a polygonal circle
    // whose chords lie inside the curve). Allow for their slope, so the edge
    // is not taken as hidden by the very surface it bounds.
    const eps = depthEps + edges[e + 6] * zb.cell * REACH_CELLS;
    const ax = dot([edges[e], edges[e + 1], edges[e + 2]], u);
    const ay = dot([edges[e], edges[e + 1], edges[e + 2]], v);
    const ad = dot([edges[e], edges[e + 1], edges[e + 2]], w);
    const bx = dot([edges[e + 3], edges[e + 4], edges[e + 5]], u);
    const by = dot([edges[e + 3], edges[e + 4], edges[e + 5]], v);
    const bd = dot([edges[e + 3], edges[e + 4], edges[e + 5]], w);
    const len = Math.hypot(bx - ax, by - ay);
    if (len < extent * 1e-9) continue; // Seen end-on: projects to a point.

    // Walk the edge and keep the runs of visible samples.
    const n = Math.max(1, Math.ceil(len / step));
    let runStart = -1;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const vis = zb.visible(ax + (bx - ax) * t, ay + (by - ay) * t, ad + (bd - ad) * t, eps);
      if (vis && runStart < 0) runStart = t;
      if ((!vis || k === n) && runStart >= 0) {
        const end = vis ? 1 : (k - 1) / n;
        if (end > runStart) {
          segs.push([
            ax + (bx - ax) * runStart, ay + (by - ay) * runStart,
            ax + (bx - ax) * end, ay + (by - ay) * end,
          ]);
        }
        runStart = -1;
      }
    }
  }
  if (!segs.length) return [];

  onProgress?.('Merging lines', 0.8);
  const lineTol = Math.max(tolerance * 0.25, extent * 1e-7);
  const merged = mergeCollinear(segs, lineTol);
  // Merging re-derives endpoints from a shared line, which moves them by up to
  // half the line tolerance — weld at that scale so chains stay connected.
  return chainSegments(merged, lineTol)
    .map((p) => ({ closed: p.closed, points: simplify(p.points, tolerance, p.closed) }))
    .filter((p) => p.points.length >= 2);
}

// Returns a flat array of 3D edge endpoints plus the steepest depth slope of
// the edge's faces as seen by the viewer: [ax, ay, az, bx, by, bz, slope, ...].
export function featureEdges(positions, w, edgeAngle, extent) {
  const triCount = positions.length / 9;
  const cosLimit = Math.cos((edgeAngle * Math.PI) / 180);

  // Weld vertices so triangles sharing an edge find each other.
  const q = 1 / Math.max(extent * 1e-7, 1e-12);
  const ids = new Map();
  const coords = [];
  const vid = new Uint32Array(triCount * 3);
  for (let i = 0; i < triCount * 3; i++) {
    const x = positions[i * 3]; const y = positions[i * 3 + 1]; const z = positions[i * 3 + 2];
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let id = ids.get(key);
    if (id === undefined) { id = coords.length / 3; ids.set(key, id); coords.push(x, y, z); }
    vid[i] = id;
  }

  const normals = new Float64Array(triCount * 3);
  const valid = new Uint8Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    const e1 = [positions[b + 3] - positions[b], positions[b + 4] - positions[b + 1], positions[b + 5] - positions[b + 2]];
    const e2 = [positions[b + 6] - positions[b], positions[b + 7] - positions[b + 1], positions[b + 8] - positions[b + 2]];
    const nrm = cross(e1, e2);
    const l = Math.hypot(nrm[0], nrm[1], nrm[2]);
    if (l < 1e-20) continue; // Degenerate sliver: contributes no edges.
    normals[t * 3] = nrm[0] / l; normals[t * 3 + 1] = nrm[1] / l; normals[t * 3 + 2] = nrm[2] / l;
    valid[t] = 1;
  }

  // Undirected edge → adjacent faces. Key fits in a double for < 2^26 vertices.
  const N = coords.length / 3 + 1;
  const adj = new Map();
  for (let t = 0; t < triCount; t++) {
    if (!valid[t]) continue;
    for (let k = 0; k < 3; k++) {
      const a = vid[t * 3 + k]; const b = vid[t * 3 + ((k + 1) % 3)];
      if (a === b) continue;
      const key = a < b ? a * N + b : b * N + a;
      const rec = adj.get(key);
      if (!rec) adj.set(key, { a: Math.min(a, b), b: Math.max(a, b), f1: t, f2: -1, count: 1 });
      else { if (rec.count === 1) rec.f2 = t; rec.count++; }
    }
  }

  const out = [];
  const n = (t) => [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]];
  for (const rec of adj.values()) {
    let keep = rec.count !== 2; // Open or non-manifold: always an edge.
    if (!keep) {
      const n1 = n(rec.f1); const n2 = n(rec.f2);
      // Silhouette of a curved surface: one face turned towards the viewer,
      // the other not. "Not" includes faces seen exactly edge-on — a rounded
      // edge running into a wall parallel to the view has its outline there.
      keep = dot(n1, n2) < cosLimit // Crease.
        || (dot(n1, w) > FACING) !== (dot(n2, w) > FACING);
    }
    if (keep) {
      out.push(
        coords[rec.a * 3], coords[rec.a * 3 + 1], coords[rec.a * 3 + 2],
        coords[rec.b * 3], coords[rec.b * 3 + 1], coords[rec.b * 3 + 2],
        Math.max(slopeOf(n(rec.f1), w), rec.f2 >= 0 ? slopeOf(n(rec.f2), w) : 0),
      );
    }
  }
  return out;
}

// How fast a face's depth changes per unit of drawing distance. Faces seen
// nearly edge-on cover almost no cells, so they are capped rather than allowed
// to excuse arbitrarily large depth differences.
function slopeOf(nrm, w) {
  const c = Math.abs(dot(nrm, w));
  if (c < 1e-6) return 0;
  return Math.min(MAX_SLOPE, Math.sqrt(Math.max(0, 1 - c * c)) / c);
}

// Rasterise the nearest depth per cell, seen from the viewer.
function depthBuffer(px, py, pd, triCount, minX, minY, extent) {
  const cell = extent / GRID_CELLS;
  // One cell of margin all round so edge samples on the border stay in range.
  const ox = minX - cell; const oy = minY - cell;
  let maxX = -Infinity; let maxY = -Infinity;
  for (let i = 0; i < px.length; i++) { if (px[i] > maxX) maxX = px[i]; if (py[i] > maxY) maxY = py[i]; }
  const W = Math.ceil((maxX - ox) / cell) + 2;
  const H = Math.ceil((maxY - oy) / cell) + 2;
  const z = new Float32Array(W * H).fill(-Infinity);

  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3; const i1 = i0 + 1; const i2 = i0 + 2;
    const x0 = (px[i0] - ox) / cell; const y0 = (py[i0] - oy) / cell;
    const x1 = (px[i1] - ox) / cell; const y1 = (py[i1] - oy) / cell;
    const x2 = (px[i2] - ox) / cell; const y2 = (py[i2] - oy) / cell;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-12) continue; // Seen edge-on: covers nothing.
    const c0 = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const c1 = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
    const r0 = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const r1 = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
    const inv = 1 / area;
    for (let r = r0; r <= r1; r++) {
      const cy = r + 0.5;
      for (let c = c0; c <= c1; c++) {
        const cx = c + 0.5;
        const l1 = ((cx - x0) * (y2 - y0) - (x2 - x0) * (cy - y0)) * inv;
        const l2 = ((x1 - x0) * (cy - y0) - (cx - x0) * (y1 - y0)) * inv;
        const l0 = 1 - l1 - l2;
        if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
        const d = l0 * pd[i0] + l1 * pd[i1] + l2 * pd[i2];
        const k = r * W + c;
        if (d > z[k]) z[k] = d;
      }
    }
  }

  return {
    cell,
    // An edge point is visible when it is not behind the nearest surface of
    // its neighbourhood. Using the 3×3 minimum keeps edges that run along a
    // face boundary from flickering between visible and hidden.
    visible(x, y, d, eps) {
      const c = Math.floor((x - ox) / cell);
      const r = Math.floor((y - oy) / cell);
      let nearest = Infinity;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= H) return true;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= W) return true;
          const zz = z[rr * W + cc];
          if (zz < nearest) nearest = zz;
        }
      }
      return d >= nearest - eps;
    },
  };
}

// Merge 2D segments lying on the same line into their union, so overlapping
// or duplicate lines become one.
export function mergeCollinear(segs, distTol) {
  const ANG_TOL = 1e-6;
  const groups = new Map();
  for (const s of segs) {
    let dx = s[2] - s[0]; let dy = s[3] - s[1];
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    dx /= len; dy /= len;
    // Canonical direction, so a reversed copy lands in the same group.
    if (dx < -1e-12 || (Math.abs(dx) <= 1e-12 && dy < 0)) { dx = -dx; dy = -dy; }
    const ang = Math.atan2(dy, dx);
    const off = -dy * s[0] + dx * s[1];
    const key = `${Math.round(ang / ANG_TOL)}|${Math.round(off / distTol)}`;
    let g = groups.get(key);
    if (!g) { g = { dx, dy, off, iv: [] }; groups.set(key, g); }
    const t0 = g.dx * s[0] + g.dy * s[1];
    const t1 = g.dx * s[2] + g.dy * s[3];
    g.iv.push(t0 < t1 ? [t0, t1] : [t1, t0]);
  }

  const out = [];
  for (const g of groups.values()) {
    g.iv.sort((a, b) => a[0] - b[0]);
    let [s0, s1] = g.iv[0];
    const emit = () => {
      const nx = -g.dy; const ny = g.dx;
      out.push([g.dx * s0 + nx * g.off, g.dy * s0 + ny * g.off, g.dx * s1 + nx * g.off, g.dy * s1 + ny * g.off]);
    };
    for (let i = 1; i < g.iv.length; i++) {
      const [a, b] = g.iv[i];
      if (a <= s1 + distTol * 1e-3) { if (b > s1) s1 = b; } else { emit(); s0 = a; s1 = b; }
    }
    emit();
  }
  return out;
}
