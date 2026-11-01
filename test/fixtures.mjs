// Procedurally generated, watertight test meshes — no binary fixtures to ship.

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
