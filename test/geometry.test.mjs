import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSTL, STLError } from '../src/lib/stl.js';
import { basisFor, boundsOf, normalFromAngles, offsetRange } from '../src/lib/plane.js';
import { sliceMesh } from '../src/lib/slice.js';
import { projectMesh } from '../src/lib/project.js';
import { buildSVG } from '../src/lib/svg.js';
import { signedArea } from '../src/lib/geom2d.js';
import { cube, torus, sphere, encodeAsciiSTL, encodeBinarySTL } from './fixtures.mjs';

const CUBE = parseSTL(encodeBinarySTL(cube(10)));
const TORUS = parseSTL(encodeBinarySTL(torus()));

const extentOf = (paths) => {
  const xs = paths.flatMap((p) => p.points.map((q) => q[0]));
  const ys = paths.flatMap((p) => p.points.map((q) => q[1]));
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};

test('parses binary STL', () => {
  assert.equal(CUBE.length / 9, 12);
  assert.deepEqual(boundsOf(CUBE).size, [20, 20, 20]);
});

test('parses ASCII STL to the same geometry as binary', () => {
  const ascii = parseSTL(new TextEncoder().encode(encodeAsciiSTL(cube(10))).buffer);
  assert.equal(ascii.length, CUBE.length);
  assert.deepEqual(boundsOf(ascii).size, boundsOf(CUBE).size);
});

test('slicing a cube gives one closed square on every axis plane', () => {
  for (const key of ['XY', 'XZ', 'YZ']) {
    const paths = sliceMesh(CUBE, basisFor(key), 0, 0.05);
    assert.equal(paths.length, 1, key);
    assert.equal(paths[0].closed, true, key);
    assert.equal(paths[0].points.length, 4, `${key} should simplify to 4 corners`);
    assert.deepEqual(extentOf(paths).map(Math.round), [20, 20], key);
  }
});

test('slicing a torus through its centre gives two closed rings', () => {
  for (const key of ['XY', 'XZ', 'YZ']) {
    const paths = sliceMesh(TORUS, basisFor(key), 0, 0.05);
    assert.equal(paths.length, 2, key);
    assert.ok(paths.every((p) => p.closed), `${key} rings must be closed`);
  }
});

test('slicing outside the model yields nothing', () => {
  assert.equal(sliceMesh(CUBE, basisFor('XY'), 500, 0.05).length, 0);
});

test('a custom plane slices a torus into two closed rings', () => {
  for (const [yaw, pitch] of [[0, 45], [30, 90], [200, 10]]) {
    const basis = basisFor('custom', normalFromAngles(yaw, pitch));
    const { min, max } = offsetRange(TORUS, basis.n);
    const paths = sliceMesh(TORUS, basis, (min + max) / 2, 0.05);
    assert.equal(paths.length, 2, `yaw=${yaw} pitch=${pitch}`);
    assert.ok(paths.every((p) => p.closed));
  }
});

test('the plane basis stays orthonormal for custom orientations', () => {
  const { n, u, v } = basisFor('custom', normalFromAngles(37, 63));
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  for (const vec of [n, u, v]) assert.ok(Math.abs(dot(vec, vec) - 1) < 1e-9);
  for (const [a, b] of [[n,u],[n,v],[u,v]]) assert.ok(Math.abs(dot(a, b)) < 1e-9);
});

test('projecting a torus gives an annulus in both quality modes', () => {
  for (const quality of ['exact', 'raster']) {
    const paths = projectMesh(TORUS, basisFor('XY'), 0.05, quality);
    assert.equal(paths.length, 2, quality);
    const areas = paths.map((p) => Math.abs(signedArea(p.points))).sort((a, b) => b - a);
    // Outer disc r=20, inner hole r=10.
    assert.ok(Math.abs(areas[0] - Math.PI * 400) / (Math.PI * 400) < 0.02, `outer ${quality}`);
    assert.ok(Math.abs(areas[1] - Math.PI * 100) / (Math.PI * 100) < 0.05, `inner ${quality}`);
  }
});

test('projection merges overlapping bodies but keeps detached ones apart', () => {
  const tris = [
    ...sphere(-6, 0, 0, 10), ...sphere(6, 0, 0, 10), ...sphere(0, 9, 0, 8),
    ...cube(4).map((f) => f.map(([x, y, z]) => [x + 40, y, z])),
  ];
  const mesh = parseSTL(encodeBinarySTL(tris));
  for (const quality of ['exact', 'raster']) {
    const paths = projectMesh(mesh, basisFor('XY'), 0.1, quality);
    assert.equal(paths.length, 2, `${quality}: three overlapping spheres merge, the cube stays separate`);
  }
});

test('resolution controls how aggressively paths are simplified', () => {
  const fine = sliceMesh(TORUS, basisFor('XY'), 0, 0.01);
  const coarse = sliceMesh(TORUS, basisFor('XY'), 0, 1.0);
  const count = (p) => p.reduce((a, x) => a + x.points.length, 0);
  assert.ok(count(coarse) < count(fine), 'a coarser resolution must emit fewer points');
});

test('SVG output carries the model size in the requested unit', () => {
  const paths = sliceMesh(CUBE, basisFor('XY'), 0, 0.05);
  const mm = buildSVG(paths, { unit: 'mm', strokeWidth: 0.1 });
  assert.match(mm, /width="20\.1mm" height="20\.1mm"/);
  assert.equal((mm.match(/<path/g) || []).length, 1);
  assert.match(mm, /d="M [\d.]+ [\d.]+ .* Z"/);

  // A 0.1 mm stroke must stay 0.1 mm wide whatever unit the file is written in.
  const inch = buildSVG(paths, { unit: 'in', strokeWidth: 0.1 });
  assert.match(inch, /width="0\.7913in"/); // 20 mm = 0.7874 in, plus one stroke
  assert.match(inch, /stroke-width="0\.0039"/);

  const px = buildSVG(paths, { unit: 'px', strokeWidth: 0.1 });
  assert.match(px, /width="75\.9685"/); // 20 mm at 96 dpi, plus one stroke
  assert.match(px, /stroke-width="0\.378"/);
});

test('SVG coordinates are mirrored so the plane v axis points up', () => {
  // A triangle whose apex is at high v must end up at a low SVG y.
  const paths = [{ closed: true, points: [[0, 0], [10, 0], [5, 10]] }];
  const svg = buildSVG(paths, { unit: 'mm', strokeWidth: 0 });
  const ys = [...svg.matchAll(/[ML] [\d.-]+ ([\d.-]+)/g)].map((m) => +m[1]);
  assert.equal(Math.min(...ys), 0, 'the apex maps to y=0 at the top');
});

test('degenerate geometry produces no outline rather than throwing', () => {
  assert.deepEqual(sliceMesh(new Float32Array(0), basisFor('XY'), 0, 0.1), []);
  assert.deepEqual(projectMesh(new Float32Array(0), basisFor('XY'), 0.1, 'exact'), []);
  // A zero-area triangle contributes no outline.
  const flat = new Float32Array([0,0,0, 1,0,0, 2,0,0]);
  assert.deepEqual(projectMesh(flat, basisFor('XY'), 0.1, 'exact'), []);
});
