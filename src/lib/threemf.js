// 3MF reader: a ZIP package of XML model files, flattened into the same
// Float32Array of triangle vertices the STL reader returns.
//
// Supported: the core spec's meshes, components and build items with their
// transforms, all model units, and the Production extension's references to
// other model files (how Bambu Studio and PrusaSlicer split up their 3MFs).
// Everything placed on the build plate is merged into one model, in place.
//
// As with STL, the file is untrusted: sizes in the archive never drive an
// allocation unchecked, decompression is capped, and references are checked.

export class ThreeMFError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ThreeMFError';
  }
}

const UNIT_TO_MM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
const MAX_UNPACKED = 1024 * 1024 * 1024; // Per entry: refuse zip bombs.
const MAX_DEPTH = 32; // Component nesting.
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export function isZip(buffer) {
  if (!buffer || buffer.byteLength < 4) return false;
  const b = new Uint8Array(buffer, 0, 4);
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

// Everything on the build plate merged into one mesh, in place.
export async function parse3MF(buffer) {
  const objects = await parse3MFObjects(buffer);
  const total = objects.reduce((n, o) => n + o.positions.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const obj of objects) { out.set(obj.positions, o); o += obj.positions.length; }
  return out;
}

// One entry per build item — what a slicer shows as separate objects — each
// with its name (if the file has one) and its plate transform applied.
// With `merge`, identical objects are listed once, `copies` counting them:
// the same geometry, whether only moved or also turned about Z on the plate.
export async function parse3MFObjects(buffer, { merge = false } = {}) {
  const zip = readZip(buffer);
  const root = await rootModelPath(zip);

  // Parse each model file once; components may point into other files.
  const models = new Map();
  const load = async (path) => {
    if (!models.has(path)) {
      const entry = zip.get(path);
      if (!entry) throw new ThreeMFError(`The 3MF refers to a missing part: /${path}`);
      models.set(path, parseModelXML(await unpackText(entry), path));
    }
    return models.get(path);
  };

  const rootModel = await load(root);
  // Positions are in the root model's unit; scale to millimetres at the end.
  const scale = UNIT_TO_MM[rootModel.unit];
  if (!scale) throw new ThreeMFError(`Unknown 3MF unit "${rootModel.unit}".`);

  // Preload every model file reachable through components or build items.
  const pending = [rootModel];
  while (pending.length) {
    const m = pending.pop();
    const refs = [...m.items.map((i) => i.path), ...[...m.objects.values()].flatMap((o) => o.components.map((c) => c.path))];
    for (const ref of refs) {
      if (ref && !models.has(ref)) pending.push(await load(ref));
    }
  }

  const names = await bambuNames(zip);
  let out = null;
  const emit = (path, id, matrix, depth, trail) => {
    if (depth > MAX_DEPTH) throw new ThreeMFError('The 3MF nests its parts too deeply.');
    const key = `${path}#${id}`;
    if (trail.has(key)) throw new ThreeMFError('The 3MF has a part that contains itself.');
    const obj = models.get(path)?.objects.get(id);
    if (!obj) throw new ThreeMFError(`The 3MF refers to a missing object (${id}).`);
    if (obj.type === 'support') return; // Slicer support geometry is not part of the model.
    if (obj.vertices.length) addMesh(out, obj, matrix);
    trail.add(key);
    for (const c of obj.components) {
      emit(c.path || path, c.objectid, compose(c.transform, matrix), depth + 1, trail);
    }
    trail.delete(key);
  };
  // Each object's own geometry is built once, however many items place it.
  const local = new Map();
  const shapeOf = (path, id) => {
    const key = `${path}#${id}`;
    if (!local.has(key)) {
      out = new Grower();
      emit(path, id, IDENTITY, 0, new Set());
      local.set(key, out.result());
    }
    return local.get(key);
  };

  const objects = [];
  const seen = []; // With `merge`: what each listed object was made from.
  items: for (const item of rootModel.items) {
    const path = item.path || root;
    const shape = shapeOf(path, item.objectid);
    if (!shape.length) continue; // e.g. a support-only item
    if (merge) {
      // The same geometry lying the same way up, only moved or turned on the plate.
      for (const s of seen) {
        if (sameShape(s.shape, shape) && isTurnAboutZ(s.transform, item.transform)) { s.object.copies++; continue items; }
      }
    }
    const positions = transformed(shape, item.transform);
    if (merge) {
      // Or different objects, or differently built ones, that end up identical.
      for (const s of seen) {
        if (sameShape(s.object.positions, positions)) { s.object.copies++; continue items; }
      }
    }
    const name = models.get(path)?.objects.get(item.objectid)?.name || (path === root ? names.get(item.objectid) : null);
    const object = { name: name || null, positions, copies: 1 };
    objects.push(object);
    if (merge) seen.push({ shape, transform: item.transform, object });
  }
  if (scale !== 1) {
    for (const { positions } of objects) for (let i = 0; i < positions.length; i++) positions[i] *= scale;
  }
  if (!objects.length) throw new ThreeMFError('No triangles found in this 3MF file.');
  return objects;
}

// Bambu Studio keeps object names out of the model, in a config file.
async function bambuNames(zip) {
  const names = new Map();
  const entry = zip.get('Metadata/model_settings.config');
  if (!entry) return names;
  const text = await unpackText(entry);
  for (const m of text.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = attrs(m[1]).id;
    // The object's own name comes before those of its parts.
    const meta = m[2].split(/<part\b/)[0].match(/<metadata\b[^>]*\bkey\s*=\s*["']name["'][^>]*>/);
    if (id && meta) {
      const value = attrs(meta[0].slice(9, -1)).value;
      if (value) names.set(id, value);
    }
  }
  return names;
}

// --- model XML -------------------------------------------------------------

// A small tag scanner rather than DOMParser: it runs in Node tests and in
// workers, and copes with the multi-hundred-megabyte files slicers produce.
export function parseModelXML(text, path = '3D/3dmodel.model') {
  const model = { unit: 'millimeter', objects: new Map(), items: [] };
  let obj = null;
  let sawModel = false;
  const tagRe = /<([/!?]?)([A-Za-z_][\w.:-]*)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(text))) {
    if (m[1] === '!' || m[1] === '?') continue; // Comments, declarations.
    const closing = m[1] === '/';
    const name = m[2].slice(m[2].indexOf(':') + 1); // Drop namespace prefix.
    const body = m[3];

    if (name === 'vertex' && obj) {
      const a = attrs(body);
      const x = +a.x; const y = +a.y; const z = +a.z;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new ThreeMFError('The 3MF contains a vertex with an invalid coordinate.');
      }
      obj.vertices.push(x, y, z);
    } else if (name === 'triangle' && obj) {
      const a = attrs(body);
      obj.triangles.push(+a.v1, +a.v2, +a.v3);
    } else if (closing) {
      if (name === 'object') obj = null;
    } else if (name === 'model') {
      sawModel = true;
      const a = attrs(body);
      if (a.unit) model.unit = a.unit;
    } else if (name === 'object') {
      const a = attrs(body);
      obj = { id: a.id, name: a.name || null, type: a.type || 'model', vertices: [], triangles: [], components: [] };
      model.objects.set(a.id, obj);
      if (body.trimEnd().endsWith('/')) obj = null; // Empty object.
    } else if (name === 'component' && obj) {
      const a = attrs(body);
      obj.components.push({ objectid: a.objectid, transform: parseTransform(a.transform), path: refPath(a.path, path) });
    } else if (name === 'item') {
      const a = attrs(body);
      model.items.push({ objectid: a.objectid, transform: parseTransform(a.transform), path: refPath(a.path, path) });
    }
  }
  if (!sawModel) throw new ThreeMFError('This 3MF has no model data.');

  for (const o of model.objects.values()) {
    const n = o.vertices.length / 3;
    for (const v of o.triangles) {
      if (!Number.isInteger(v) || v < 0 || v >= n) {
        throw new ThreeMFError(`The 3MF object ${o.id} has a triangle pointing at a vertex that does not exist.`);
      }
    }
  }
  return model;
}

function attrs(body) {
  const out = {};
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(body))) {
    const key = m[1].slice(m[1].indexOf(':') + 1); // p:path → path
    out[key] = decodeEntities(m[2] ?? m[3]);
  }
  return out;
}

function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

// Package paths are absolute ("/3D/Objects/a.model"); zip entries are not.
function refPath(ref, from) {
  if (!ref) return null;
  const clean = decodeURIComponent(ref).replace(/\\/g, '/');
  if (clean.startsWith('/')) return normalizePath(clean.slice(1));
  return normalizePath(from.replace(/[^/]*$/, '') + clean);
}

function normalizePath(p) {
  const parts = [];
  for (const seg of p.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

// "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32", applied to row vectors.
export function parseTransform(s) {
  if (!s) return IDENTITY;
  const v = s.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || !v.every(Number.isFinite)) throw new ThreeMFError('The 3MF has an invalid transform.');
  return v;
}

// The transform that applies `a` first, then `b`.
export function compose(a, b) {
  const r = new Array(12);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  for (let j = 0; j < 3; j++) r[9 + j] = a[9] * b[j] + a[10] * b[3 + j] + a[11] * b[6 + j] + b[9 + j];
  return r;
}

function transformed(p, m) {
  const r = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]; const y = p[i + 1]; const z = p[i + 2];
    r[i] = x * m[0] + y * m[3] + z * m[6] + m[9];
    r[i + 1] = x * m[1] + y * m[4] + z * m[7] + m[10];
    r[i + 2] = x * m[2] + y * m[5] + z * m[8] + m[11];
  }
  return r;
}

// The same triangles, vertex for vertex, up to a shift.
export function sameShape(a, b) {
  if (a.length !== b.length || !a.length) return false;
  let extent = 0;
  for (let i = 0; i < a.length; i++) extent = Math.max(extent, Math.abs(a[i] - a[i % 3]));
  const tol = Math.max(1e-6, extent * 1e-5); // Float32 rounding.
  const dx = b[0] - a[0]; const dy = b[1] - a[1]; const dz = b[2] - a[2];
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(b[i] - a[i] - dx) > tol || Math.abs(b[i + 1] - a[i + 1] - dy) > tol || Math.abs(b[i + 2] - a[i + 2] - dz) > tol) return false;
  }
  return true;
}

// Whether placing with `b` is placing with `a`, then turning about the Z axis
// (and moving): b = a · Q with Q a rotation that keeps Z.
export function isTurnAboutZ(a, b) {
  const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
  if (Math.abs(det) < 1e-12) return false;
  // inv(a), 3×3 linear part.
  const inv = [
    (a[4] * a[8] - a[5] * a[7]) / det, (a[2] * a[7] - a[1] * a[8]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det, (a[0] * a[8] - a[2] * a[6]) / det, (a[2] * a[3] - a[0] * a[5]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det, (a[1] * a[6] - a[0] * a[7]) / det, (a[0] * a[4] - a[1] * a[3]) / det,
  ];
  const q = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) q[i * 3 + j] = inv[i * 3] * b[j] + inv[i * 3 + 1] * b[3 + j] + inv[i * 3 + 2] * b[6 + j];
  }
  const eps = 1e-5;
  const near = (x, y) => Math.abs(x - y) < eps;
  return near(q[2], 0) && near(q[5], 0) && near(q[6], 0) && near(q[7], 0) && near(q[8], 1)
    && near(q[0], q[4]) && near(q[1], -q[3]) && near(q[0] * q[0] + q[1] * q[1], 1);
}

function addMesh(out, obj, m) {
  const v = obj.vertices;
  const t = obj.triangles;
  out.reserve(t.length * 3);
  for (let i = 0; i < t.length; i++) {
    const k = t[i] * 3;
    const x = v[k]; const y = v[k + 1]; const z = v[k + 2];
    out.push(
      x * m[0] + y * m[3] + z * m[6] + m[9],
      x * m[1] + y * m[4] + z * m[7] + m[10],
      x * m[2] + y * m[5] + z * m[8] + m[11],
    );
  }
}

class Grower {
  constructor() { this.buf = new Float32Array(1024); this.len = 0; }
  reserve(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const next = new Float32Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  push(a, b, c) { this.buf[this.len++] = a; this.buf[this.len++] = b; this.buf[this.len++] = c; }
  result() { return this.buf.slice(0, this.len); }
}

// --- package (OPC) ---------------------------------------------------------

async function rootModelPath(zip) {
  const rels = zip.get('_rels/.rels');
  if (rels) {
    const text = await unpackText(rels);
    for (const m of text.matchAll(/<(?:\w+:)?Relationship\b([^>]*)>/g)) {
      const a = attrs(m[1]);
      if (/\/3dmodel$/.test(a.Type || '') && a.Target) {
        const p = refPath(a.Target, '');
        if (zip.has(p)) return p;
      }
    }
  }
  if (zip.has('3D/3dmodel.model')) return '3D/3dmodel.model';
  const any = [...zip.keys()].find((k) => /\.model$/i.test(k));
  if (any) return any;
  throw new ThreeMFError('This ZIP file does not contain a 3MF model.');
}

// --- ZIP -------------------------------------------------------------------

export function readZip(buffer) {
  const view = new DataView(buffer);
  const len = buffer.byteLength;
  const fail = () => { throw new ThreeMFError('The 3MF file is damaged (its ZIP directory cannot be read).'); };

  // End of central directory: scan back over a possible archive comment.
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail();
  let count = view.getUint16(eocd + 10, true);
  let cdSize = view.getUint32(eocd + 12, true);
  let cdOffset = view.getUint32(eocd + 16, true);

  // ZIP64: the real values live in a separate record found via a locator.
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || view.getUint32(loc, true) !== 0x07064b50) fail();
    const rec = Number(view.getBigUint64(loc + 8, true));
    if (rec + 56 > len || view.getUint32(rec, true) !== 0x06064b50) fail();
    count = Number(view.getBigUint64(rec + 32, true));
    cdSize = Number(view.getBigUint64(rec + 40, true));
    cdOffset = Number(view.getBigUint64(rec + 48, true));
  }
  if (cdOffset + cdSize > len) fail();

  const names = new TextDecoder();
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > len || view.getUint32(p, true) !== 0x02014b50) fail();
    const method = view.getUint16(p + 10, true);
    let compSize = view.getUint32(p + 20, true);
    let size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    let offset = view.getUint32(p + 42, true);
    const name = names.decode(new Uint8Array(buffer, p + 46, nameLen));

    // ZIP64 extra field: 64-bit values for whichever fields overflowed.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = view.getUint16(e, true);
      const sz = view.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = Number(view.getBigUint64(q, true)); q += 8; }
        if (compSize === 0xffffffff) { compSize = Number(view.getBigUint64(q, true)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(view.getBigUint64(q, true)); }
      }
      e += 4 + sz;
    }

    entries.set(normalizePath(name), { buffer, method, compSize, size, offset, name });
    p = extraEnd + commentLen;
  }
  return entries;
}

async function unpack(entry) {
  const { buffer, method, compSize, size, offset } = entry;
  const view = new DataView(buffer);
  if (offset + 30 > buffer.byteLength || view.getUint32(offset, true) !== 0x04034b50) {
    throw new ThreeMFError('The 3MF file is damaged (a part of it cannot be found).');
  }
  const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
  if (start + compSize > buffer.byteLength) throw new ThreeMFError('The 3MF file is damaged (a part of it is cut off).');
  const data = new Uint8Array(buffer, start, compSize);

  if (method === 0) return data;
  if (method !== 8) throw new ThreeMFError(`The 3MF uses an unsupported compression method (${method}).`);
  if (size > MAX_UNPACKED) throw new ThreeMFError('A part of this 3MF is too large to unpack.');

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    let r;
    try {
      r = await reader.read();
    } catch {
      throw new ThreeMFError('The 3MF file is damaged (a part of it does not decompress).');
    }
    if (r.done) break;
    total += r.value.length;
    if (total > MAX_UNPACKED) {
      await reader.cancel();
      throw new ThreeMFError('A part of this 3MF is too large to unpack.');
    }
    chunks.push(r.value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function unpackText(entry) {
  return new TextDecoder('utf-8').decode(await unpack(entry));
}
