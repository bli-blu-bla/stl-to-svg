// Minimal STL reader (binary + ASCII) returning a flat Float32Array of
// triangle vertices. Kept dependency-free so it can run inside the worker.
//
// Everything here treats the file as untrusted input: a corrupt or hostile
// header must never drive an allocation, and failures must carry a message
// that means something to the person who picked the file.

export class STLError extends Error {
  constructor(message) {
    super(message);
    this.name = 'STLError';
  }
}

const HEADER = 84;      // 80-byte comment + uint32 triangle count
const RECORD = 50;      // normal + 3 vertices + attribute byte count

export function parseSTL(buffer) {
  if (!buffer || buffer.byteLength === 0) throw new STLError('The file is empty.');

  const view = new DataView(buffer);
  const positions = looksBinary(buffer, view) ? parseBinary(view) : parseASCII(buffer);
  if (positions.length === 0) {
    throw new STLError('No triangles found — this does not look like an STL file.');
  }
  return positions;
}

function looksBinary(buffer, view) {
  // A binary STL of n triangles is exactly HEADER + RECORD*n bytes. That size
  // check is far more reliable than sniffing for a leading "solid" keyword,
  // since plenty of binary exporters write one too.
  if (buffer.byteLength < HEADER) return false;
  if (HEADER + view.getUint32(80, true) * RECORD === buffer.byteLength) return true;

  // Size did not match, so fall back to looking for ASCII markers. Decode
  // leniently: a binary file's header bytes are not valid UTF-8.
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(new Uint8Array(buffer, 0, Math.min(512, buffer.byteLength)));
  return !(/^\s*solid/.test(head) && /facet\s+normal/i.test(head));
}

function parseBinary(view) {
  const claimed = view.getUint32(80, true);
  // Never allocate from the header alone — a corrupt count of four billion
  // would otherwise ask for tens of gigabytes. The file's own length is the
  // only trustworthy bound.
  const available = Math.max(0, Math.floor((view.byteLength - HEADER) / RECORD));
  const count = Math.min(claimed, available);

  if (count === 0) {
    throw new STLError('The file is too short to contain any triangles.');
  }

  const positions = new Float32Array(count * 9);
  let p = 0;
  for (let i = 0; i < count; i++) {
    const base = HEADER + i * RECORD + 12; // skip the per-facet normal
    for (let c = 0; c < 9; c++) positions[p++] = view.getFloat32(base + c * 4, true);
  }
  return sanitize(positions, claimed > available);
}

function parseASCII(buffer) {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const coords = [];
  // Tolerates CRLF, tabs, and the exponent forms real exporters emit.
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    coords.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  // Drop any trailing partial triangle from a truncated file.
  const usable = coords.length - (coords.length % 9);
  return sanitize(new Float32Array(coords.slice(0, usable)), false);
}

// Drop triangles carrying NaN or Infinity. A single bad vertex would otherwise
// poison the bounding box and take the whole conversion down with it.
function sanitize(positions, truncated) {
  const triCount = positions.length / 9;
  let bad = 0;
  const keep = new Uint8Array(triCount);
  for (let t = 0; t < triCount; t++) {
    let ok = true;
    for (let k = 0; k < 9; k++) {
      if (!Number.isFinite(positions[t * 9 + k])) { ok = false; break; }
    }
    keep[t] = ok ? 1 : 0;
    if (!ok) bad++;
  }

  if (bad === triCount && triCount > 0) {
    throw new STLError('Every triangle in this file has invalid coordinates.');
  }
  if (bad === 0) {
    if (truncated) positions.truncated = true;
    return positions;
  }

  const out = new Float32Array((triCount - bad) * 9);
  let p = 0;
  for (let t = 0; t < triCount; t++) {
    if (!keep[t]) continue;
    out.set(positions.subarray(t * 9, t * 9 + 9), p);
    p += 9;
  }
  return out;
}
