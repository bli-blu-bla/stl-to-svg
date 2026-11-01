// Procedurally generated, watertight test meshes — no binary fixtures to ship.

import { deflateRawSync, crc32 } from 'node:zlib';

export function encodeBinarySTL(tris) {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const view = new DataView(buf);
  view.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    const o = 84 + i * 50 + 12;
    t.forEach((v, vi) => v.forEach((c, ci) => view.setFloat32(o + vi * 12 + ci * 4, c, true)));
  });
  return buf;
}

export function encodeAsciiSTL(tris) {
  return 'solid test\n' + tris.map((t) =>
    'facet normal 0 0 0\n outer loop\n' +
    t.map((v) => `  vertex ${v.join(' ')}`).join('\n') +
    '\n endloop\nendfacet\n').join('') + 'endsolid test\n';
}

export function cube(s = 10) {
  const v = [[-s,-s,-s],[s,-s,-s],[s,s,-s],[-s,s,-s],[-s,-s,s],[s,-s,s],[s,s,s],[-s,s,s]];
  return [[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]
    .map((f) => f.map((i) => v[i]));
}

// Axis-aligned box from (x0, y0, z0) to (x1, y1, z1), outward-facing.
export function box(x0, y0, z0, x1, y1, z1) {
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  return [[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]
    .map((f) => f.map((i) => v[i]));
}

export function torus(R = 15, r = 5, NU = 64, NV = 32) {
  const P = (i, j) => {
    const u = 2 * Math.PI * (i % NU) / NU;
    const v = 2 * Math.PI * (j % NV) / NV;
    return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)];
  };
  const tris = [];
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    tris.push([P(i,j), P(i+1,j), P(i+1,j+1)], [P(i,j), P(i+1,j+1), P(i,j+1)]);
  }
  return tris;
}

export function sphere(cx, cy, cz, r, NU = 40, NV = 20) {
  const P = (i, j) => {
    const u = 2 * Math.PI * (i % NU) / NU;
    const v = Math.PI * j / NV;
    return [cx + r*Math.sin(v)*Math.cos(u), cy + r*Math.sin(v)*Math.sin(u), cz + r*Math.cos(v)];
  };
  const tris = [];
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = P(i,j), b = P(i+1,j), c = P(i+1,j+1), d = P(i,j+1);
    if (j > 0) tris.push([a,b,c]);
    if (j < NV - 1) tris.push([a,c,d]);
  }
  return tris;
}

// --- 3MF ---------------------------------------------------------------------


// A 3MF <model> document. `objects` maps id → triangles (mesh),
// { name?, mesh } or { name?, components: [{ objectid, transform?, path? }] };
// `items` are build items.
export function modelXML({ unit = 'millimeter', objects = {}, items = [] } = {}) {
  const obj = Object.entries(objects).map(([id, spec]) => {
    const o = Array.isArray(spec) ? spec : spec.mesh || spec;
    const name = spec.name ? ` name="${spec.name}"` : '';
    if (Array.isArray(o)) {
      const verts = []; const index = new Map(); const tris = [];
      for (const t of o) {
        tris.push(t.map((v) => {
          const k = v.join(',');
          if (!index.has(k)) { index.set(k, verts.length); verts.push(v); }
          return index.get(k);
        }));
      }
      return `  <object id="${id}"${name} type="model"><mesh>
   <vertices>${verts.map((v) => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join('')}</vertices>
   <triangles>${tris.map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles>
  </mesh></object>`;
    }
    return `  <object id="${id}"${name} type="model"><components>${o.components.map((c) =>
      `<component objectid="${c.objectid}"${c.transform ? ` transform="${c.transform}"` : ''}${c.path ? ` p:path="${c.path}"` : ''}/>`).join('')}</components></object>`;
  }).join('\n');
  const build = items.map((i) => `<item objectid="${i.objectid}"${i.transform ? ` transform="${i.transform}"` : ''}/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
 <resources>
${obj}
 </resources>
 <build>${build}</build>
</model>`;
}

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

// A ZIP holding `files` (path → text). Deflated by default, as slicers do.
export function encodeZip(files, { deflate = true } = {}) {
  const local = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    local.push(lh, nameBuf, data);
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  const buf = Buffer.concat([...local, cd, end]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

// A complete 3MF package; `extra` adds further model files (path → XML).
export function encode3MF(model, extra = {}, opts) {
  return encodeZip({ '_rels/.rels': RELS, '3D/3dmodel.model': modelXML(model), ...extra }, opts);
}
