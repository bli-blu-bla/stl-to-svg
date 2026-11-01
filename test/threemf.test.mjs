import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parse3MF, parse3MFObjects, isZip, compose, parseTransform, isTurnAboutZ, sameShape } from '../src/lib/threemf.js';
import { parseModel, parseModelObjects } from '../src/lib/model.js';
import { boundsOf } from '../src/lib/plane.js';
import { cube, box, encodeBinarySTL, encode3MF, encodeZip, modelXML } from './fixtures.mjs';

const CUBE = cube(10); // 20 mm, centred on the origin

test('reads a plain 3MF to the same geometry as the STL', async () => {
  const pos = await parse3MF(encode3MF({ objects: { 1: CUBE }, items: [{ objectid: 1 }] }));
  assert.equal(pos.length / 9, 12);
  assert.deepEqual(boundsOf(pos).size, [20, 20, 20]);
});

test('stored (uncompressed) packages read too', async () => {
  const pos = await parse3MF(encode3MF({ objects: { 1: CUBE }, items: [{ objectid: 1 }] }, {}, { deflate: false }));
  assert.equal(pos.length / 9, 12);
});

test('converts the model unit to millimetres', async () => {
  const pos = await parse3MF(encode3MF({ unit: 'inch', objects: { 1: box(0, 0, 0, 1, 2, 1) }, items: [{ objectid: 1 }] }));
  assert.deepEqual(boundsOf(pos).size.map((v) => +v.toFixed(4)), [25.4, 50.8, 25.4]);
});

test('places build items and components with their transforms', async () => {
  const pos = await parse3MF(encode3MF({
    objects: {
      1: box(0, 0, 0, 10, 10, 10),
      // Two copies: one as is, one shifted 30 mm in x.
      2: { components: [{ objectid: 1 }, { objectid: 1, transform: '1 0 0 0 1 0 0 0 1 30 0 0' }] },
    },
    // The whole assembly lifted 5 mm and scaled ×2 in y.
    items: [{ objectid: 2, transform: '1 0 0 0 2 0 0 0 1 0 0 5' }],
  }));
  const b = boundsOf(pos);
  assert.equal(pos.length / 9, 24);
  assert.deepEqual(b.min, [0, 0, 5]);
  assert.deepEqual(b.max, [40, 20, 15]);
});

test('follows components into other model files (Bambu / Prusa layout)', async () => {
  const part = modelXML({ objects: { 7: CUBE } });
  const pos = await parse3MF(encode3MF(
    { objects: { 1: { components: [{ objectid: 7, path: '/3D/Objects/object_1.model' }] } }, items: [{ objectid: 1 }] },
    { '3D/Objects/object_1.model': part },
  ));
  assert.equal(pos.length / 9, 12);
});

test('compose applies the first transform, then the second', () => {
  const scale2 = parseTransform('2 0 0 0 2 0 0 0 2 0 0 0');
  const shift = parseTransform('1 0 0 0 1 0 0 0 1 10 0 0');
  // (1,0,0) → ×2 → (2,0,0) → +10 → (12,0,0)
  assert.deepEqual(compose(scale2, shift).slice(9), [10, 0, 0]);
  assert.deepEqual(compose(shift, scale2).slice(9), [20, 0, 0]);
});

test('detects the format by content, not by name', async () => {
  const zip = encode3MF({ objects: { 1: CUBE }, items: [{ objectid: 1 }] });
  const stl = encodeBinarySTL(CUBE);
  assert.ok(isZip(zip));
  assert.ok(!isZip(stl));
  assert.equal((await parseModel(zip)).length, (await parseModel(stl)).length);
});

test('rejects broken packages with readable messages', async () => {
  await assert.rejects(parse3MF(encodeZip({ 'readme.txt': 'hi' })), /does not contain a 3MF model/);
  await assert.rejects(
    parse3MF(encode3MF({ objects: { 1: CUBE }, items: [{ objectid: 9 }] })), /missing object/);
  await assert.rejects(
    parse3MF(encode3MF({ objects: { 1: { components: [{ objectid: 1 }] } }, items: [{ objectid: 1 }] })), /contains itself/);
  const badIndex = modelXML({ objects: { 1: CUBE }, items: [{ objectid: 1 }] }).replace('v1="0"', 'v1="999"');
  await assert.rejects(parse3MF(encodeZip({ '3D/3dmodel.model': badIndex })), /vertex that does not exist/);
  const zip = new Uint8Array(encode3MF({ objects: { 1: CUBE }, items: [{ objectid: 1 }] }));
  await assert.rejects(parse3MF(zip.slice(0, zip.length - 30).buffer), /damaged/);
});

// Two named objects on a plate, as PrusaSlicer writes them.
const PLATE = encode3MF({
  objects: {
    1: { name: 'Lid', mesh: box(100, 100, 0, 120, 110, 4) },
    2: { name: 'Base &amp; clip', mesh: box(150, 90, 0, 160, 130, 12) },
  },
  items: [{ objectid: 1 }, { objectid: 2 }],
});

test('lists each object on the build plate separately, with its name', async () => {
  const objs = await parse3MFObjects(PLATE);
  assert.deepEqual(objs.map((o) => o.name), ['Lid', 'Base & clip']);
  assert.deepEqual(objs.map((o) => o.positions.length / 9), [12, 12]);
  // parse3MF still merges them, in place.
  assert.deepEqual(boundsOf(await parse3MF(PLATE)).min, [100, 90, 0]);
});

test('objects are centred in X and Y but keep their height', async () => {
  const [lid, base] = await parseModelObjects(PLATE, 'plate.3mf');
  for (const o of [lid, base]) {
    const b = boundsOf(o.positions);
    assert.deepEqual([b.center[0], b.center[1]], [0, 0]);
  }
  assert.deepEqual(boundsOf(base.positions).min[2], 0);
  assert.deepEqual(boundsOf(base.positions).size, [10, 40, 12]);
});

test('names objects from Bambu Studio\'s config, numbers duplicates, falls back', async () => {
  const config = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1"><metadata key="name" value="Bottom.stl"/><part id="1"><metadata key="name" value="part-a"/></part></object>
  <object id="2"><metadata key="name" value="Bottom.stl"/></object>
</config>`;
  const zip = encode3MF(
    { objects: { 1: CUBE, 2: cube(5), 3: cube(7) }, items: [{ objectid: 1 }, { objectid: 2 }, { objectid: 3 }] },
    { 'Metadata/model_settings.config': config },
  );
  const objs = await parseModelObjects(zip, 'case.3mf');
  assert.deepEqual(objs.map((o) => o.name), ['Bottom.stl', 'Bottom.stl (2)', 'Object 3']);
});

test('a single-object 3MF or an STL is one entry named after the file', async () => {
  const one = await parseModelObjects(encode3MF({ objects: { 1: { name: 'Thing', mesh: CUBE } }, items: [{ objectid: 1 }] }), 'thing.3mf');
  assert.deepEqual(one.map((o) => o.name), ['thing.3mf']);
  const stl = await parseModelObjects(encodeBinarySTL(CUBE), 'cube.stl');
  assert.deepEqual(stl.map((o) => o.name), ['cube.stl']);
});

test('identical objects are listed once, counting their copies', async () => {
  const zip = encode3MF({
    objects: {
      1: { name: 'Leg', mesh: box(0, 0, 0, 10, 20, 30) },
      2: { name: 'Leg copy', mesh: box(50, 50, 0, 60, 70, 30) }, // same shape, its own object
      3: { name: 'Top', mesh: box(0, 0, 0, 40, 40, 5) },
    },
    items: [
      { objectid: 1 },
      { objectid: 1, transform: '1 0 0 0 1 0 0 0 1 30 0 0' }, // moved
      { objectid: 1, transform: '0 1 0 -1 0 0 0 0 1 80 0 0' }, // turned 90° about Z
      { objectid: 2 },
      { objectid: 1, transform: '1 0 0 0 0 1 0 -1 0 0 0 0' }, // laid on its side: different
      { objectid: 3 },
    ],
  });
  const objs = await parseModelObjects(zip, 'table.3mf');
  assert.deepEqual(objs.map((o) => [o.name, o.copies]), [['Leg', 4], ['Leg (2)', 1], ['Top', 1]]);
  // The merged list is opt-in: the plain reader keeps every item.
  assert.equal((await parse3MFObjects(zip)).length, 6);
  assert.equal((await parse3MF(zip)).length / 9, 72);
});

test('isTurnAboutZ and sameShape', () => {
  const id = parseTransform('');
  assert.ok(isTurnAboutZ(id, parseTransform('0.6 0.8 0 -0.8 0.6 0 0 0 1 5 5 5')));
  assert.ok(!isTurnAboutZ(id, parseTransform('-1 0 0 0 1 0 0 0 1 0 0 0'))); // mirrored
  assert.ok(!isTurnAboutZ(id, parseTransform('2 0 0 0 2 0 0 0 2 0 0 0'))); // scaled
  const a = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.ok(sameShape(a, new Float32Array([5, 5, 5, 6, 5, 5, 5, 6, 5])));
  assert.ok(!sameShape(a, new Float32Array([0, 0, 0, 2, 0, 0, 0, 1, 0])));
});
