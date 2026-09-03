// Projection mode: flatten the mesh onto the plane and recover the outline of
// the resulting silhouette, holes included.
//
// Two strategies are available. `exact` unions every projected triangle with a
// boolean polygon library, which gives crisp straight edges. `raster` samples
// the silhouette onto a grid and runs marching squares, which is far cheaper
// and is what large meshes fall back to.

import polygonClipping from 'polygon-clipping';
import { chainSegments, simplify, signedArea } from './geom2d.js';

const { union } = polygonClipping;

export const EXACT_TRIANGLE_LIMIT = 60000;

export function projectMesh(positions, basis, tolerance, quality = 'auto', onProgress) {
  const tris = projectTriangles(positions, basis, tolerance);
  if (!tris.length) return [];

  const mode = quality === 'auto'
    ? (tris.length > EXACT_TRIANGLE_LIMIT ? 'raster' : 'exact')
    : quality;

  if (mode === 'exact') {
    const rings = unionTriangles(tris, onProgress);
    if (rings) {
      return rings
        .map((r) => ({ closed: true, points: simplify(r, tolerance, true) }))
        .filter((p) => p.points.length >= 3);
    }
    // Fall through to the raster path if the boolean union gave up.
  }
  return rasterOutline(tris, tolerance);
}

// Project each triangle to plane 2D, dropping ones that collapse to a line.
function projectTriangles(positions, basis, tolerance) {
  const { u, v } = basis;
  const out = [];
  const minArea = Math.max(1e-12, tolerance * tolerance * 1e-4);
  for (let i = 0; i < positions.length; i += 9) {
    const t = new Array(3);
    for (let k = 0; k < 3; k++) {
      const x = positions[i + k * 3];
      const y = positions[i + k * 3 + 1];
      const z = positions[i + k * 3 + 2];
      t[k] = [x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]];
    }
    const area = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1]);
    if (Math.abs(area) * 0.5 < minArea) continue;
    // Normalise to counter-clockwise winding.
    if (area < 0) { const tmp = t[1]; t[1] = t[2]; t[2] = tmp; }
    out.push(t);
  }
  return out;
}

// Hierarchical pairwise union: merging small batches and then merging the
// results is dramatically faster than folding one triangle in at a time.
function unionTriangles(tris, onProgress) {
  const BATCH = 120;
  let level = [];
  try {
    for (let i = 0; i < tris.length; i += BATCH) {
      const batch = tris.slice(i, i + BATCH).map((t) => [[...t, t[0]]]);
      level.push(union(batch[0], ...batch.slice(1)));
      // The batch pass is the bulk of the work; report it as the first half.
      onProgress?.('Merging outlines', 0.5 * (i / tris.length));
    }
    const levels = Math.max(1, Math.ceil(Math.log2(level.length || 1)));
    let done = 0;
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        next.push(i + 1 < level.length ? union(level[i], level[i + 1]) : level[i]);
      }
      level = next;
      onProgress?.('Merging outlines', 0.5 + 0.45 * (++done / levels));
    }
  } catch {
    return null;
  }

  const rings = [];
  for (const poly of level[0] || []) {
    for (const ring of poly) {
      const r = ring.slice(0, -1); // drop the repeated closing vertex
      if (r.length >= 3) rings.push(r);
    }
  }
  return rings;
}

// --- Raster fallback -------------------------------------------------------

function rasterOutline(tris, tolerance) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const t of tris) {
    for (const p of t) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }

  // Sample finer than the requested tolerance, but cap the grid so a huge part
  // at a fine resolution cannot blow up memory.
  const MAX_CELLS = 6e6;
  let cell = Math.max(tolerance * 0.5, 1e-6);
  const pad = cell * 2;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  let w = Math.ceil((maxX - minX) / cell) + 1;
  let h = Math.ceil((maxY - minY) / cell) + 1;
  if (w * h > MAX_CELLS) {
    cell *= Math.sqrt((w * h) / MAX_CELLS);
    w = Math.ceil((maxX - minX) / cell) + 1;
    h = Math.ceil((maxY - minY) / cell) + 1;
  }

  const grid = new Uint8Array(w * h);
  for (const t of tris) rasterizeTriangle(grid, w, h, minX, minY, cell, t);

  const at = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : grid[j * w + i]);
  const segments = [];
  const px = (i) => minX + i * cell;
  const py = (j) => minY + j * cell;

  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const c = at(i, j) | (at(i + 1, j) << 1) | (at(i + 1, j + 1) << 2) | (at(i, j + 1) << 3);
      if (c === 0 || c === 15) continue;
      const L = [px(i), py(j) + cell / 2];
      const R = [px(i) + cell, py(j) + cell / 2];
      const B = [px(i) + cell / 2, py(j)];
      const T = [px(i) + cell / 2, py(j) + cell];
      const push = (a, b) => segments.push([a[0], a[1], b[0], b[1]]);
      switch (c) {
        case 1: case 14: push(L, B); break;
        case 2: case 13: push(B, R); break;
        case 3: case 12: push(L, R); break;
        case 4: case 11: push(R, T); break;
        case 6: case 9: push(B, T); break;
        case 7: case 8: push(L, T); break;
        // Saddle cases, resolved consistently as "foreground stays connected".
        case 5: push(L, T); push(B, R); break;
        case 10: push(L, B); push(R, T); break;
      }
    }
  }

  if (!segments.length) return [];
  return chainSegments(segments, cell * 1e-3)
    .map((p) => ({ closed: p.closed, points: simplify(p.points, tolerance, p.closed) }))
    .filter((p) => p.points.length >= 3 && Math.abs(signedArea(p.points)) > tolerance * tolerance);
}

// Mark every grid sample whose position falls inside the triangle.
function rasterizeTriangle(grid, w, h, minX, minY, cell, t) {
  const xs = [t[0][0], t[1][0], t[2][0]];
  const ys = [t[0][1], t[1][1], t[2][1]];
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - minX) / cell));
  const i1 = Math.min(w - 1, Math.ceil((Math.max(...xs) - minX) / cell));
  const j0 = Math.max(0, Math.floor((Math.min(...ys) - minY) / cell));
  const j1 = Math.min(h - 1, Math.ceil((Math.max(...ys) - minY) / cell));

  const ax = t[0][0]; const ay = t[0][1];
  const bx = t[1][0]; const by = t[1][1];
  const cx = t[2][0]; const cy = t[2][1];
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (d === 0) return;

  for (let j = j0; j <= j1; j++) {
    const y = minY + j * cell;
    for (let i = i0; i <= i1; i++) {
      const x = minX + i * cell;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 >= 0 && l2 >= 0 && l3 >= 0) grid[j * w + i] = 1;
    }
  }
}
