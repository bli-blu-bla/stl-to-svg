import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSVG } from '../src/lib/svg.js';
import {
  angleAt, formatAngle, formatLength, lineAngle, measureBetween, parsePathData, parseSVG, rayHit, snapAngle, snapPoint,
} from '../src/lib/measure.js';

const square = (s) => ({ closed: true, points: [[0, 0], [s, 0], [s, s], [0, s]] });

test('reads back the unit, outline and true size of a generated SVG', () => {
  const g = parseSVG(buildSVG([square(20)], { unit: 'mm', strokeWidth: 0.5 }));
  assert.equal(g.unit, 'mm');
  assert.equal(g.paths.length, 1);
  assert.equal(g.vertices.length, 8);
  assert.equal(g.segments.length, 16, 'closed path contributes its closing edge');
  // The stroke margin is not part of the part's size.
  assert.ok(Math.abs(g.bounds.width - 20) < 1e-9);
  assert.ok(Math.abs(g.bounds.height - 20) < 1e-9);
});

test('sizes follow the output unit', () => {
  assert.ok(Math.abs(parseSVG(buildSVG([square(20)], { unit: 'cm' })).bounds.width - 2) < 1e-9);
  const px = parseSVG(buildSVG([square(25.4)], { unit: 'px' }));
  assert.equal(px.unit, 'px');
  assert.ok(Math.abs(px.bounds.width - 96) < 1e-6);
});

test('parses multiple subpaths and implicit line-tos', () => {
  const sp = parsePathData('M 0 0 1 0 1 1 Z M 5 5 L 6 6');
  assert.equal(sp.length, 2);
  assert.equal(sp[0].points.length, 3);
  assert.ok(sp[0].closed);
  assert.ok(!sp[1].closed);
});

test('snaps to vertices first, then edges, and ignores far points', () => {
  const g = parseSVG(buildSVG([square(10)], { strokeWidth: 0 }));
  assert.deepEqual(snapPoint(g, 0.2, 0.3, 1), { x: 0, y: 0, kind: 'vertex' });
  const e = snapPoint(g, 5, 0.4, 1);
  assert.equal(e.kind, 'edge');
  assert.ok(Math.abs(e.x - 5) < 1e-9 && Math.abs(e.y) < 1e-9);
  assert.equal(snapPoint(g, 5, 5, 1), null);
});

test('measures distances', () => {
  assert.deepEqual(measureBetween({ x: 0, y: 0 }, { x: 3, y: -4 }), { dx: 3, dy: 4, length: 5 });
  assert.equal(formatLength(12.3456, 'mm'), '12.35 mm');
  assert.equal(formatLength(1.23456, 'in'), '1.235 in');
});

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('45° snap locks the direction and keeps the projected length', () => {
  const h = snapAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
  assert.deepEqual([h.x, h.y, ...h.dir], [10, 0, 1, 0]);
  const v = snapAngle({ x: 0, y: 0 }, { x: -0.5, y: 8 });
  assert.equal(v.x, 0, 'vertical stays exactly vertical');
  close(v.y, 8);
  const d = snapAngle({ x: 1, y: 1 }, { x: 6, y: 5 });
  close(d.x - 1, d.y - 1);
  close(Math.hypot(d.x - 1, d.y - 1), (5 + 4) / Math.SQRT2);
  assert.equal(snapAngle({ x: 2, y: 2 }, { x: 2, y: 2 }).dir, null);
});

test('a locked ray stops on the edge it crosses', () => {
  const g = parseSVG(buildSVG([square(10)], { strokeWidth: 0 }));
  // From the middle of the left edge, horizontally to the right edge.
  const hit = rayHit(g, { x: 0, y: 5 }, [1, 0], { x: 9.6, y: 5 }, 1);
  assert.equal(hit.kind, 'edge');
  close(hit.x, 10); close(hit.y, 5);
  // Diagonal from one corner lands on the opposite corner.
  const c = rayHit(g, { x: 0, y: 0 }, [Math.SQRT1_2, Math.SQRT1_2], { x: 9.5, y: 9.5 }, 1);
  assert.equal(c.kind, 'vertex');
  close(c.x, 10); close(c.y, 10);
  assert.equal(rayHit(g, { x: 0, y: 5 }, [1, 0], { x: 5, y: 5 }, 1), null, 'too far from any crossing');
});

test('measures angles and line directions', () => {
  const v = { x: 0, y: 0 };
  close(angleAt(v, { x: 5, y: 0 }, { x: 0, y: 3 }), 90);
  close(angleAt(v, { x: 5, y: 0 }, { x: -2, y: 0 }), 180);
  close(angleAt(v, { x: 1, y: 0 }, { x: 1, y: -1 }), 45);
  close(angleAt(v, { x: 1, y: 0 }, { x: 1, y: 1 }), 45); // Inner angle regardless of side.
  // SVG y points down: a line drawn up-and-right is +45°.
  close(lineAngle({ x: 0, y: 0 }, { x: 1, y: -1 }), 45);
  close(lineAngle({ x: 0, y: 0 }, { x: 1, y: 1 }), 135);
  assert.equal(lineAngle({ x: 5, y: 0 }, { x: 0, y: 0 }), 0);
  assert.equal(formatAngle(89.96), '90.0°');
});
