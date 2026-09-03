// Plane definition and 2D basis construction.
//
// A cutting/projection plane is stored as a unit normal `n` plus an offset `d`
// along that normal, so the plane is the set of points p with dot(p, n) === d.
// Every 2D output is expressed in the orthonormal basis (u, v) that spans it.

export const PRESETS = {
  XY: { label: 'XY Plane', normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  XZ: { label: 'XZ Plane', normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  YZ: { label: 'YZ Plane', normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
};

export function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]);
  if (l < 1e-12) return [0, 0, 1];
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Rotate a normal by yaw (around Z) then pitch (away from Z), both in degrees.
// This is how the custom-plane controls are parameterised.
export function normalFromAngles(yawDeg, pitchDeg) {
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  const s = Math.sin(pitch);
  return normalize([s * Math.cos(yaw), s * Math.sin(yaw), Math.cos(pitch)]);
}

// Build a right-handed basis (u, v, n). For the axis presets we return the
// canonical axes so that, e.g., an XY slice always maps X to u and Y to v.
export function basisFor(planeKey, customNormal) {
  if (PRESETS[planeKey]) {
    const p = PRESETS[planeKey];
    return { n: p.normal.slice(), u: p.u.slice(), v: p.v.slice() };
  }
  const n = normalize(customNormal);
  // Pick the world axis least aligned with n as the seed for u.
  const abs = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  const seed = abs[0] <= abs[1] && abs[0] <= abs[2] ? [1, 0, 0]
    : abs[1] <= abs[2] ? [0, 1, 0] : [0, 0, 1];
  const u = normalize(cross(seed, n));
  const v = cross(n, u);
  return { n, u, v };
}

// Range of the mesh along the plane normal, used to bound the offset slider.
export function offsetRange(positions, n) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const t = positions[i] * n[0] + positions[i + 1] * n[1] + positions[i + 2] * n[2];
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!isFinite(min)) return { min: 0, max: 0 };
  return { min, max };
}

export function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const val = positions[i + a];
      if (val < min[a]) min[a] = val;
      if (val > max[a]) max[a] = val;
    }
  }
  if (!isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}
