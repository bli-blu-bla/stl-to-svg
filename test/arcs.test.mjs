import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSTL } from '../src/lib/stl.js';
import { basisFor, normalFromAngles } from '../src/lib/plane.js';
import { sliceMesh } from '../src/lib/slice.js';
import { projectMesh } from '../src/lib/project.js';
import { projectEdges } from '../src/lib/edges.js';
import { fitArcs, pathBounds } from '../src/lib/arcs.js';
import { buildSVG } from '../src/lib/svg.js';
import { parseSVG, snapPoint } from '../src/lib/measure.js';
import { torus, sphere, encodeBinarySTL } from './fixtures.mjs';

const mesh = (...parts) => parseSTL(encodeBinarySTL(parts.flat()));
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const XY = basisFor('XY');

const ngon = (r, n, ox = 0, oy = 0) => Array.from({ length: n }, (_, i) => {
  const a = (2 * Math.PI * i) / n;
  return [ox + r * Math.cos(a), oy + r * Math.sin(a)];
});

// A 2a × 2b rectangle with corners rounded to r, `seg` chords per corner.
function roundedRect(a, b, r, seg) {
  const ring = [];
  for (const [cx, cy, start] of [[a - r, b - r, 0], [-a + r, b - r, 90], [-a + r, -b + r, 180], [a - r, -b + r, 270]]) {
    for (let i = 0; i <= seg; i++) {
      const t = ((start + (90 * i) / seg) * Math.PI) / 180;
      ring.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  }
  return ring;
}

// A convex outline extruded to height h.
function prism(ring, h) {
  const t = [];
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]; const [x1, y1] = ring[(i + 1) % ring.length];
    t.push([[x0, y0, 0], [x1, y1, 0], [x1, y1, h]], [[x0, y0, 0], [x1, y1, h], [x0, y0, h]]);
    t.push([[cx, cy, h], [x0, y0, h], [x1, y1, h]], [[cx, cy, 0], [x1, y1, 0], [x0, y0, 0]]);
  }
  return t;
}

const PLATE = mesh(prism(roundedRect(10, 5, 2, 6), 4));
const ROD = mesh(prism(ngon(7, 48, 3, -2), 4));

// Every way a contour is made: section, exact outline, raster outline, edges.
const MODES = {
  slice: (m, tol) => sliceMesh(m, XY, 2, tol, true),
  outline: (m, tol) => projectMesh(m, XY, tol, 'exact', null, true),
  raster: (m, tol) => projectMesh(m, XY, tol, 'raster', null, true),
  edges: (m, tol) => projectEdges(m, XY, tol, 30, null, true),
};

test('a round rod comes out as one circle in every mode', () => {
  for (const [name, run] of Object.entries(MODES)) {
    const paths = run(ROD, 0.1);
    assert.equal(paths.length, 1, name);
    assert.ok(paths[0].circle, `${name}: expected a circle`);
    // The raster outline is sampled, so its circle is only as good as the grid.
    const eps = name === 'raster' ? 0.05 : 1e-4;
    close(paths[0].circle.r, 7, eps);
    close(paths[0].circle.cx, 3, eps);
    close(paths[0].circle.cy, -2, eps);
  }
});

test('rounded corners come out as four arcs with their radius', () => {
  for (const [name, run] of Object.entries(MODES)) {
    const [p, ...rest] = run(PLATE, 0.05);
    assert.equal(rest.length, 0, name);
    assert.ok(p.closed, name);
    const arcs = p.arcs.filter(Boolean);
    assert.equal(arcs.length, 4, `${name}: one arc per corner`);
    assert.equal(p.points.length, 8, `${name}: four arcs and four straight sides`);
    const exact = name !== 'raster';
    for (const arc of arcs) {
      close(arc.r, 2, exact ? 1e-4 : 0.05);
      close((arc.sweep * 180) / Math.PI, 90, exact ? 1e-3 : 5);
    }
  }
});

test('an arc cut by the start of the ring is still found whole', () => {
  // Start the ring in the middle of a corner.
  const ring = roundedRect(10, 5, 2, 6);
  const turned = ring.slice(3).concat(ring.slice(0, 3));
  const p = fitArcs(turned, true, 0.05);
  assert.equal(p.arcs.filter(Boolean).length, 4);
  for (const arc of p.arcs.filter(Boolean)) close((arc.sweep * 180) / Math.PI, 90);
});

test('polygons that are meant as polygons stay polygons', () => {
  for (const n of [4, 6, 8]) {
    const [p] = sliceMesh(mesh(prism(ngon(7, n), 4)), XY, 2, 0.1, true);
    assert.ok(!p.circle && !p.arcs, `${n}-gon`);
    assert.equal(p.points.length, n);
  }
  // The corners of any symmetric trapezoid lie on a circle. Not an arc.
  const [t] = sliceMesh(mesh(prism([[0, 0], [30, 0], [24.8, 19.3], [5.2, 19.3]], 4)), XY, 2, 0.1, true);
  assert.ok(!t.arcs);
  assert.equal(t.points.length, 4);
});

test('a straight wall between two rounded corners is never bent into an arc', () => {
  // At a coarse resolution both corners and the 6 mm wall between them fit a
  // 30 mm circle to within tolerance — which would bow the wall outwards.
  for (const tol of [0.25, 0.5, 1]) {
    const [p] = sliceMesh(PLATE, XY, 2, tol, true);
    for (const arc of (p.arcs || []).filter(Boolean)) close(arc.r, 2, 1e-4);
    const { minX, maxX, minY, maxY } = pathBounds([p]);
    // Nothing bulges past the walls (corners may be cut within the resolution).
    assert.ok(maxX - minX <= 20 + 1e-6 && maxX - minX >= 20 - 2 * tol);
    assert.ok(maxY - minY <= 10 + 1e-6 && maxY - minY >= 10 - 2 * tol);
  }
});

test('curves that are no circles are approximated within the resolution', () => {
  // A cylinder cut at an angle is an ellipse.
  const tol = 0.05;
  const basis = basisFor('custom', normalFromAngles(0, 30));
  const rod = mesh(prism(ngon(7, 96), 40));
  const [exact] = sliceMesh(rod, basis, 15, 1e-6);
  const [p] = sliceMesh(rod, basis, 15, tol, true);
  assert.ok(!p.circle);
  assert.ok(p.arcs.filter(Boolean).length >= 4);
  // Every vertex of the true section lies within the resolution of some arc.
  const n = p.points.length;
  for (const [x, y] of exact.points) {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const arc = p.arcs[i];
      if (arc) best = Math.min(best, Math.abs(Math.hypot(x - arc.cx, y - arc.cy) - arc.r));
    }
    assert.ok(best <= tol, `vertex ${best} mm off`);
  }
});

test('torus and sphere sections are circles', () => {
  const rings = sliceMesh(mesh(torus()), XY, 2.3, 0.1, true);
  assert.equal(rings.length, 2);
  assert.ok(rings.every((p) => p.circle));
  // Between two rings of latitude the slice crosses the facets' diagonals too.
  const [s] = sliceMesh(mesh(sphere(0, 0, 0, 10)), XY, 3.3, 0.1, true);
  assert.ok(s.circle);
  close(s.circle.r, Math.sqrt(100 - 3.3 * 3.3), 0.05);
});

test('without the option the output is plain polylines, as before', () => {
  const [p] = sliceMesh(ROD, XY, 2, 0.1);
  assert.ok(!p.circle && !p.arcs);
  assert.ok(p.points.length > 12);
});

test('the SVG holds a <circle> and arc commands, sized by the true curve', () => {
  const rod = buildSVG(sliceMesh(ROD, XY, 2, 0.1, true), { strokeWidth: 0.1 });
  assert.match(rod, /<circle cx="7\.05" cy="7\.05" r="7"\/>/);
  assert.match(rod, /width="14\.1mm" height="14\.1mm"/);

  const plate = buildSVG(sliceMesh(PLATE, XY, 2, 0.1, true), { strokeWidth: 0.1, unit: 'cm' });
  assert.equal((plate.match(/ A 0\.2 0\.2 0 0 [01] /g) || []).length, 4, 'radius follows the unit');
  assert.equal((plate.match(/ L /g) || []).length, 4);

  // A 12-sided circle: its sides lie well inside the curve, the size must not.
  const coarse = buildSVG(sliceMesh(mesh(prism(ngon(7, 12, 0.3, 0.2).map(([x, y]) => {
    const c = Math.cos(0.2); const s = Math.sin(0.2);
    return [x * c - y * s, x * s + y * c];
  }), 4)), XY, 2, 0.1, true), { strokeWidth: 0 });
  assert.match(coarse, /width="14mm" height="14mm"/);
});

test('arcs keep their direction when mirrored into SVG', () => {
  // A quarter circle from (2,0) to (0,2), counter-clockwise about the origin,
  // closed over the origin. Its bulge must point to the upper right.
  const pts = [[0, 0], ...Array.from({ length: 13 }, (_, i) => {
    const a = (i * Math.PI) / 24;
    return [2 * Math.cos(a), 2 * Math.sin(a)];
  })];
  const p = fitArcs(pts, true, 0.01);
  assert.equal(p.arcs.filter(Boolean).length, 1);
  const g = parseSVG(buildSVG([p], { strokeWidth: 0 }));
  close(g.bounds.width, 2, 1e-6);
  close(g.bounds.height, 2, 1e-6);
  // The middle of the arc, in SVG coordinates (y down, origin at the top).
  const m = Math.SQRT2;
  const hit = snapPoint(g, m, 2 - m, 0.01);
  assert.ok(hit, 'the arc passes through its midpoint');
});

test('the measuring view reads circles and arcs back', () => {
  const g = parseSVG(buildSVG(sliceMesh(ROD, XY, 2, 0.1, true), { strokeWidth: 0 }));
  close(g.bounds.width, 14, 1e-6);
  close(g.bounds.height, 14, 1e-6);
  // The centre and the quadrant points are there to snap to …
  assert.deepEqual(snapPoint(g, 7.01, 6.99, 0.1), { x: 7, y: 7, kind: 'vertex' });
  assert.equal(snapPoint(g, 13.99, 7.01, 0.1).kind, 'vertex');
  // … and anywhere else on the circle counts as its edge.
  const e = snapPoint(g, 7 + 7.02 * Math.cos(1), 7 + 7.02 * Math.sin(1), 0.1);
  assert.equal(e.kind, 'edge');
  close(Math.hypot(e.x - 7, e.y - 7), 7, 2e-3);
});
