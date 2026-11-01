// One entry point for every supported mesh format. The format is told by the
// file's content (3MF is a ZIP package), not by its name.

import { parseSTL } from './stl.js';
import { isZip, parse3MF, parse3MFObjects } from './threemf.js';

export const MODEL_EXTENSIONS = /\.(stl|3mf)$/i;

// The whole file as one mesh.
export async function parseModel(buffer) {
  return isZip(buffer) ? parse3MF(buffer) : parseSTL(buffer);
}

// The file as the objects a person would pick between: an STL is one object;
// a 3MF yields one per object on its build plate. 3MF objects are centred in
// X and Y — a plate position means nothing once an object is worked on alone —
// while Z is kept, so each still stands where it stood.
export async function parseModelObjects(buffer, fileName) {
  if (!isZip(buffer)) return [{ name: fileName, positions: parseSTL(buffer) }];

  const objects = await parse3MFObjects(buffer);
  if (objects.length === 1) return [{ name: fileName, positions: centerXY(objects[0].positions) }];

  const used = new Map();
  return objects.map((o, i) => {
    const base = o.name || `Object ${i + 1}`;
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return { name: n > 1 ? `${base} (${n})` : base, positions: centerXY(o.positions) };
  });
}

export function centerXY(positions) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]; const y = positions[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2; const cy = (minY + maxY) / 2;
  if (!Number.isFinite(cx) || (cx === 0 && cy === 0)) return positions;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx;
    positions[i + 1] -= cy;
  }
  return positions;
}
