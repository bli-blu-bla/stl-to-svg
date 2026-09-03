import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSTL, STLError } from '../src/lib/stl.js';
import { boundsOf } from '../src/lib/plane.js';
import { sliceMesh } from '../src/lib/slice.js';
import { basisFor } from '../src/lib/plane.js';
import { cube, encodeAsciiSTL, encodeBinarySTL } from './fixtures.mjs';

const utf8 = (s) => new TextEncoder().encode(s).buffer;

test('rejects an empty file with a message a user can act on', () => {
  assert.throws(() => parseSTL(new ArrayBuffer(0)), STLError);
  assert.throws(() => parseSTL(new ArrayBuffer(0)), /empty/i);
});

test('never allocates from the header count alone', () => {
  // A corrupt header claiming four billion triangles must not ask for 140 GB.
  const buf = new ArrayBuffer(84);
  new DataView(buf).setUint32(80, 4_000_000_000, true);
  assert.throws(() => parseSTL(buf), /too short/i);
});

test('recovers what it can from a truncated binary file', () => {
  const full = encodeBinarySTL(cube(10));
  const cut = full.slice(0, 84 + 50 * 5); // header says 12, only 5 survive
  const positions = parseSTL(cut);
  assert.equal(positions.length / 9, 5);
});

test('drops triangles with non-finite coordinates', () => {
  const tris = cube(10);
  tris[0] = [[NaN, 0, 0], [1, 0, 0], [0, 1, 0]];
  tris[1] = [[0, 0, Infinity], [1, 0, 0], [0, 1, 0]];
  const positions = parseSTL(encodeBinarySTL(tris));
  assert.equal(positions.length / 9, tris.length - 2);
  assert.ok(positions.every(Number.isFinite));
  assert.ok(boundsOf(positions).size.every(Number.isFinite));
});

test('rejects a file where every triangle is invalid', () => {
  const tris = [[[NaN, NaN, NaN], [NaN, NaN, NaN], [NaN, NaN, NaN]]];
  assert.throws(() => parseSTL(encodeBinarySTL(tris)), /invalid coordinates/i);
});

test('reads ASCII with CRLF line endings and exponent notation', () => {
  const ascii = encodeAsciiSTL(cube(10)).replace(/\n/g, '\r\n');
  const positions = parseSTL(utf8(ascii));
  assert.equal(positions.length / 9, 12);

  const exp = 'solid s\nfacet normal 0 0 0\n outer loop\n  vertex 1.0e1 -2.5E-1 0\n' +
    '  vertex 0 0 0\n  vertex 0 1 0\n endloop\nendfacet\nendsolid s\n';
  const p2 = parseSTL(utf8(exp));
  assert.equal(p2[0], 10);
  assert.equal(p2[1], -0.25);
});

test('treats a binary file whose header starts with "solid" as binary', () => {
  // Many exporters write "solid" into the 80-byte comment of a binary file.
  const buf = encodeBinarySTL(cube(10));
  new Uint8Array(buf).set(new TextEncoder().encode('solid exported-by-something'), 0);
  assert.equal(parseSTL(buf).length / 9, 12);
});

test('a non-manifold mesh slices into open polylines instead of failing', () => {
  // An open box: the same cube with two faces removed.
  const open = cube(10).slice(0, 10);
  const positions = parseSTL(encodeBinarySTL(open));
  const paths = sliceMesh(positions, basisFor('XY'), 0, 0.05);
  assert.ok(paths.length > 0, 'a hole in the mesh must not swallow the section');
  assert.ok(paths.every((p) => p.points.length >= 2));
});

test('duplicated coincident triangles do not corrupt the section', () => {
  const doubled = [...cube(10), ...cube(10)];
  const positions = parseSTL(encodeBinarySTL(doubled));
  const paths = sliceMesh(positions, basisFor('XY'), 0, 0.05);
  const total = paths.reduce((a, p) => a + p.points.length, 0);
  // Each edge is now seen twice, so expect more segments — but still bounded,
  // not an explosion, and still describing a 20 mm square.
  const xs = paths.flatMap((p) => p.points.map((q) => q[0]));
  assert.ok(Math.max(...xs) - Math.min(...xs) - 20 < 1e-6);
  assert.ok(total <= 16, `expected a small section, got ${total} points`);
});

test('inverted winding does not change the projected silhouette', async () => {
  const { projectMesh } = await import('../src/lib/project.js');
  const { signedArea } = await import('../src/lib/geom2d.js');
  const flipped = cube(10).map((t) => [t[0], t[2], t[1]]);
  const a = projectMesh(parseSTL(encodeBinarySTL(cube(10))), basisFor('XY'), 0.05, 'exact');
  const b = projectMesh(parseSTL(encodeBinarySTL(flipped)), basisFor('XY'), 0.05, 'exact');
  assert.equal(a.length, b.length);
  assert.ok(Math.abs(Math.abs(signedArea(a[0].points)) - Math.abs(signedArea(b[0].points))) < 1e-6);
});
