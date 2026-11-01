import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSTL } from '../src/lib/stl.js';
import { basisFor } from '../src/lib/plane.js';
import { projectEdges, mergeCollinear } from '../src/lib/edges.js';
import { projectMesh } from '../src/lib/project.js';
import { box, torus, encodeBinarySTL } from './fixtures.mjs';

const mesh = (...parts) => parseSTL(encodeBinarySTL(parts.flat()));
const totalLength = (paths) => paths.reduce((sum, p) => {
  const pts = p.closed ? [...p.points, p.points[0]] : p.points;
  for (let i = 1; i < pts.length; i++) sum += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return sum;
}, 0);
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// A 20×20×5 plate with a 10×10×5 boss standing on it.
const STEPPED = mesh(box(-10, -10, 0, 10, 10, 5), box(-5, -5, 5, 5, 5, 10));

test('top view shows the step that the outline hides', () => {
  const top = basisFor('XY');
  assert.equal(projectMesh(STEPPED, top, 0.01).length, 1, 'outline: just the plate');
  const edges = projectEdges(STEPPED, top, 0.01);
  assert.equal(edges.length, 2, 'plate rim and boss rim');
  assert.ok(edges.every((p) => p.closed));
  // Two squares, each drawn once: the plate's top and bottom rims coincide
  // in this view and must merge rather than be cut twice.
  close(totalLength(edges), 80 + 40);
});

test('front view shows the visible edge across the step', () => {
  // Outline of the stepped profile (60) plus the plate's top front edge
  // behind which the boss rises (10).
  close(totalLength(projectEdges(STEPPED, basisFor('XZ'), 0.01)), 70);
});

test('edges hidden under an overhang are dropped', () => {
  // A plate held up by a smaller pedestal: from above only the plate shows.
  const table = mesh(box(-10, -10, 5, 10, 10, 10), box(-5, -5, 0, 5, 5, 5));
  const edges = projectEdges(table, basisFor('XY'), 0.01);
  close(totalLength(edges), 80);
});

test('smooth surfaces draw only their silhouette, not their facets', () => {
  // The torus is tessellated in 11.25° steps — below the 30° edge angle.
  const edges = projectEdges(mesh(torus()), basisFor('XY'), 0.01);
  assert.equal(edges.length, 2, 'outer and inner rim');
  // Lowering the edge angle below the facet angle brings the facets back.
  assert.ok(projectEdges(mesh(torus()), basisFor('XY'), 0.01, 5).length > 2);
});

test('collinear segments merge into their union', () => {
  const merged = mergeCollinear([
    [0, 0, 5, 0],
    [3, 0, 8, 0], // overlaps the first
    [8, 0, 2, 0], // reversed, inside the union
    [10, 0, 12, 0], // same line, separate
    [0, 1, 5, 1], // parallel, different line
  ], 1e-6);
  const lens = merged.map((s) => Math.hypot(s[2] - s[0], s[3] - s[1])).sort((a, b) => a - b);
  assert.deepEqual(lens.map((l) => +l.toFixed(9)), [2, 5, 8]);
});

// Closed frustum from radius r0 at z0 to r1 at z1, `seg` facets round.
function frustum(z0, z1, r0, r1, seg = 48) {
  const t = [];
  const p = (r, z, a) => [r * Math.cos(a), r * Math.sin(a), z];
  for (let i = 0; i < seg; i++) {
    const a = (2 * Math.PI * i) / seg; const b = (2 * Math.PI * (i + 1)) / seg;
    t.push([p(r0, z0, a), p(r0, z0, b), p(r1, z1, b)], [p(r0, z0, a), p(r1, z1, b), p(r1, z1, a)]);
    t.push([[0, 0, z0], p(r0, z0, b), p(r0, z0, a)], [[0, 0, z1], p(r1, z1, a), p(r1, z1, b)]);
  }
  return t;
}

test('a chamfered boss draws two whole circles, not fragments', () => {
  // The chords of a polygonal rim lie inside the curve, where the rising
  // chamfer is slightly nearer the viewer — that must not hide the rim.
  const boss = mesh(frustum(0, 3, 7, 7), frustum(3, 4.5, 7, 5.5));
  const paths = projectEdges(boss, basisFor('XY'), 0.1);
  assert.equal(paths.length, 2);
  assert.ok(paths.every((p) => p.closed));
});

// A 20×10×4 block whose vertical edges are rounded (r = 2), seen from the
// front: its side walls are edge-on, and the outline runs where the rounding
// meets them — between a face turned to the viewer and one seen edge-on.
test('outline where a rounded edge meets a wall seen edge-on', () => {
  const a = 10; const b = 5; const r = 2; const h = 4; const SEG = 6;
  const ring = [];
  for (const [cx, cy, start] of [[a - r, b - r, 0], [-a + r, b - r, 90], [-a + r, -b + r, 180], [a - r, -b + r, 270]]) {
    for (let i = 0; i <= SEG; i++) {
      const t = ((start + (90 * i) / SEG) * Math.PI) / 180;
      ring.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  }
  const tris = [];
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]; const [x1, y1] = ring[(i + 1) % ring.length];
    tris.push([[x0, y0, 0], [x1, y1, 0], [x1, y1, h]], [[x0, y0, 0], [x1, y1, h], [x0, y0, h]]);
    tris.push([[0, 0, h], [x0, y0, h], [x1, y1, h]], [[0, 0, 0], [x1, y1, 0], [x0, y0, 0]]);
  }
  const paths = projectEdges(mesh(tris), basisFor('XZ'), 0.01, 30);
  // The full rectangle, both sides included.
  close(totalLength(paths), 2 * (2 * a + h), 0.05);
  const xs = paths.flatMap((p) => p.points.map(([x]) => x));
  close(Math.min(...xs), -a);
  close(Math.max(...xs), a);
});
