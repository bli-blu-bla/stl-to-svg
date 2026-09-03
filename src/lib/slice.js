// Intersection mode: slice the mesh with a plane and return the resulting
// cross-section contours in plane-local 2D coordinates.

import { chainSegments, simplify } from './geom2d.js';

export function sliceMesh(positions, basis, offset, tolerance) {
  const { n, u, v } = basis;
  const triCount = positions.length / 9;
  const segments = [];

  const dist = new Float64Array(3);
  const vx = new Float64Array(3);
  const vy = new Float64Array(3);
  const vz = new Float64Array(3);

  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    let pos = 0;
    let neg = 0;
    for (let k = 0; k < 3; k++) {
      const x = positions[base + k * 3];
      const y = positions[base + k * 3 + 1];
      const z = positions[base + k * 3 + 2];
      vx[k] = x; vy[k] = y; vz[k] = z;
      let d = x * n[0] + y * n[1] + z * n[2] - offset;
      // Nudge exact hits to one side. This keeps every crossing triangle at
      // exactly two intersection points and drops coplanar ones, which is the
      // standard way to avoid degenerate slice cases.
      if (d === 0) d = 1e-12;
      dist[k] = d;
      if (d > 0) pos++; else neg++;
    }
    if (pos === 3 || neg === 3) continue;

    const hits = [];
    for (let k = 0; k < 3; k++) {
      const a = k;
      const b = (k + 1) % 3;
      if ((dist[a] > 0) === (dist[b] > 0)) continue;
      hits.push(edgePoint(vx, vy, vz, dist, a, b));
    }
    if (hits.length !== 2) continue;

    const p0 = hits[0];
    const p1 = hits[1];
    const s = [
      p0[0] * u[0] + p0[1] * u[1] + p0[2] * u[2],
      p0[0] * v[0] + p0[1] * v[1] + p0[2] * v[2],
      p1[0] * u[0] + p1[1] * u[1] + p1[2] * u[2],
      p1[0] * v[0] + p1[1] * v[1] + p1[2] * v[2],
    ];
    if (s[0] !== s[2] || s[1] !== s[3]) segments.push(s);
  }

  if (!segments.length) return [];

  // Weld far below the simplification tolerance: this only needs to close
  // floating-point cracks between neighbouring triangles.
  const eps = Math.max(1e-9, tolerance * 1e-3);
  return chainSegments(segments, eps)
    .map((p) => ({ closed: p.closed, points: simplify(p.points, tolerance, p.closed) }))
    .filter((p) => p.points.length >= 2);
}

// Interpolate along an edge in a canonical vertex order, so that the same edge
// shared by two triangles yields bit-identical points and the contours chain up
// without needing a loose weld tolerance.
function edgePoint(vx, vy, vz, dist, a, b) {
  let i = a;
  let j = b;
  if (vx[i] > vx[j] || (vx[i] === vx[j] && (vy[i] > vy[j] || (vy[i] === vy[j] && vz[i] > vz[j])))) {
    i = b; j = a;
  }
  const t = dist[i] / (dist[i] - dist[j]);
  return [
    vx[i] + (vx[j] - vx[i]) * t,
    vy[i] + (vy[j] - vy[i]) * t,
    vz[i] + (vz[j] - vz[i]) * t,
  ];
}
