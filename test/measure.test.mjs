import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSVG } from '../src/lib/svg.js';
import {
  alignPoint, angleAt, arcAt, closestGap, curveHit, formatAngle, formatLength, lineAngle, measureBetween, parsePathData, parseSVG, rayAlign, rayHit, snapAngle, snapPoint,
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

test('aligns to the row or column of a nearby vertex', () => {
  const g = parseSVG(buildSVG([square(10)], { strokeWidth: 0 }));
  // Level with the top edge's corners, out to the right.
  const row = alignPoint(g, 15, 10.3, 0.5);
  assert.equal(row.kind, 'align');
  assert.deepEqual([row.x, row.y], [15, 10]);
  assert.deepEqual(row.guides, [{ x: 10, y: 10 }], 'guide drawn from the nearest corner on that row');
  // Below the right edge, in line with it.
  const col = alignPoint(g, 10.2, 14, 0.5);
  assert.deepEqual([col.x, col.y], [10, 14]);
  // In line with two different corners at once: lands on the crossing.
  const both = alignPoint(g, 10.3, -4, 0.5, [{ x: 30, y: -4.2 }]);
  assert.deepEqual([both.x, both.y], [10, -4.2]);
  assert.equal(both.guides.length, 2);
  assert.equal(alignPoint(g, 15, 15, 0.5), null);
});

test('a locked ray stops level with a vertex', () => {
  const g = parseSVG(buildSVG([square(10)], { strokeWidth: 0 }));
  // Straight down from (15, -5): crosses the rows y = 0 and y = 10.
  const hit = rayAlign(g, { x: 15, y: -5 }, [0, 1], { x: 15, y: 9.7 }, 0.5);
  assert.deepEqual([hit.x, hit.y], [15, 10]);
  assert.equal(hit.kind, 'align');
  assert.equal(rayAlign(g, { x: 15, y: -5 }, [0, 1], { x: 15, y: 5 }, 0.5), null);
});

// --- Gap and circle tools ----------------------------------------------------

const ring = (cx, cy, r) => ({ closed: true, circle: { cx, cy, r }, points: [[cx + r, cy], [cx, cy + r], [cx - r, cy], [cx, cy - r]] });
const near = (a, b, eps = 2e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('the gap tool finds the narrowest place between two circles', () => {
  // Radii 10 and 6, centres 20 apart: 4 between them, on the line of centres.
  const g = parseSVG(buildSVG([ring(0, 0, 10), ring(20, 0, 6)], { strokeWidth: 0 }));
  // Picked well away from the narrow spot, on either circle.
  const a = curveHit(g, 10 + 10 * Math.cos(1), 10 - 10 * Math.sin(1), 0.1);
  const b = curveHit(g, 30 + 6 * Math.cos(2), 10 - 6 * Math.sin(2), 0.1);
  assert.ok(a && b && a.curve !== b.curve);
  const [p, q] = closestGap(g, a, b);
  near(measureBetween(p, q).length, 4);
  near(p.y, 10); near(q.y, 10);
  near(p.x, 20); near(q.x, 24);
});

test('the gap tool measures a waist: two stretches of one outline', () => {
  // A dumbbell outline: two arcs of radius 13 bulging towards each other,
  // 6 apart at the middle, joined by straight ends.
  const arcOf = (cy, from, to) => ({ cx: 0, cy, r: 13, ccw: to > from, sweep: Math.abs(to - from) });
  const up = Math.asin(12 / 13);
  const path = {
    closed: true,
    points: [[-12, -11], [12, -11], [12, 11], [-12, 11]],
    // Bottom edge bulges up (centre below), top edge bulges down (centre above).
    arcs: [null, arcOf(-16, Math.PI / 2 + up, Math.PI / 2 - up), null, arcOf(16, -Math.PI / 2 + up, -Math.PI / 2 - up)],
  };
  const g = parseSVG(buildSVG([path], { strokeWidth: 0 }));
  near(g.bounds.height, 22);
  // Pick the upper and the lower edge, off-centre and on different sides.
  const top = curveHit(g, 12 - 5, 11 - (16 - Math.sqrt(169 - 25)), 0.05);
  const bottom = curveHit(g, 12 + 7, 11 + (16 - Math.sqrt(169 - 49)), 0.05);
  assert.ok(top && bottom);
  assert.equal(top.curve, bottom.curve);
  const [p, q] = closestGap(g, top, bottom);
  near(measureBetween(p, q).length, 6);
  near(p.x, 12, 0.02); near(q.x, 12, 0.02);
});

test('two picks on one unbroken curve close up to nothing', () => {
  const g = parseSVG(buildSVG([ring(0, 0, 10)], { strokeWidth: 0 }));
  const a = curveHit(g, 10 + 10 * Math.cos(0.3), 10 + 10 * Math.sin(0.3), 0.1);
  const b = curveHit(g, 10 + 10 * Math.cos(0.5), 10 + 10 * Math.sin(0.5), 0.1);
  const [p, q] = closestGap(g, a, b);
  near(measureBetween(p, q).length, 0, 1e-6);
});

test('the circle tool reads centre and radius off circles and arcs, not lines', () => {
  const corner = {
    closed: true,
    points: [[0, 0], [10, 0], [10, 8], [8, 10], [0, 10]],
    arcs: [null, null, null, { cx: 8, cy: 8, r: 2, ccw: true, sweep: Math.PI / 2 }, null],
  };
  const g = parseSVG(buildSVG([corner, ring(4, 4, 1.5)], { strokeWidth: 0 }));
  // SVG y runs down: the drawing is 10 high, so y_svg = 10 - y.
  const onArc = arcAt(g, curveHit(g, 8 + Math.SQRT2, 10 - (8 + Math.SQRT2), 0.05));
  near(onArc.r, 2); near(onArc.cx, 8); near(onArc.cy, 2);
  assert.equal(onArc.full, false);
  const onHole = arcAt(g, curveHit(g, 4, 10 - 5.5, 0.05));
  near(onHole.r, 1.5); near(onHole.cx, 4); near(onHole.cy, 6);
  assert.equal(onHole.full, true);
  assert.equal(arcAt(g, curveHit(g, 5, 10, 0.05)), null, 'a straight side has no radius');
  assert.equal(curveHit(g, 5, 5.2, 0.05), null, 'nothing within reach');
});
