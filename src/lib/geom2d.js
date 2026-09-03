// Shared 2D helpers: point welding, segment chaining, simplification.

export function makeWelder(eps) {
  const map = new Map();
  const pts = [];
  const inv = 1 / eps;
  return {
    pts,
    add(x, y) {
      // Probe the cell and its 8 neighbours so points that straddle a cell
      // boundary still weld together.
      const cx = Math.round(x * inv);
      const cy = Math.round(y * inv);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const hit = map.get(`${cx + dx},${cy + dy}`);
          if (hit === undefined) continue;
          const p = pts[hit];
          if (Math.abs(p[0] - x) <= eps && Math.abs(p[1] - y) <= eps) return hit;
        }
      }
      const id = pts.length;
      pts.push([x, y]);
      map.set(`${cx},${cy}`, id);
      return id;
    },
  };
}

// Turn an unordered soup of segments into polylines, closing them into rings
// wherever the topology allows.
export function chainSegments(segments, eps) {
  const welder = makeWelder(eps);
  const edges = [];
  for (const s of segments) {
    const a = welder.add(s[0], s[1]);
    const b = welder.add(s[2], s[3]);
    if (a !== b) edges.push([a, b]);
  }

  const adj = new Map();
  edges.forEach(([a, b], i) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(i);
    adj.get(b).push(i);
  });

  const used = new Uint8Array(edges.length);
  const paths = [];

  const walk = (start) => {
    const idx = [start];
    let current = start;
    for (;;) {
      const next = (adj.get(current) || []).find((e) => !used[e]);
      if (next === undefined) break;
      used[next] = 1;
      const [a, b] = edges[next];
      current = a === current ? b : a;
      idx.push(current);
      if (current === start) break;
    }
    return idx;
  };

  // Open chains first, starting from odd-degree endpoints, so that broken or
  // non-manifold geometry does not get folded into bogus loops.
  for (const [node, list] of adj) {
    if (list.length % 2 === 0) continue;
    while ((adj.get(node) || []).some((e) => !used[e])) {
      const idx = walk(node);
      if (idx.length > 1) paths.push({ closed: false, idx });
    }
  }
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const [a, b] = edges[i];
    const idx = [a, b].concat(walk(b).slice(1));
    const closed = idx[idx.length - 1] === a;
    if (closed) idx.pop();
    if (idx.length > 1) paths.push({ closed, idx });
  }

  return paths.map((p) => ({ closed: p.closed, points: p.idx.map((i) => welder.pts[i]) }));
}

// Ramer-Douglas-Peucker. `tolerance` is the maximum distance the simplified
// path may deviate from the original.
export function simplify(points, tolerance, closed) {
  if (tolerance <= 0 || points.length < 3) return points;
  if (!closed) return rdp(points, tolerance);
  // For a ring, cut at the vertex farthest from the first one so the seam is
  // not an arbitrary point that RDP is forced to keep.
  let far = 0;
  let farD = -1;
  for (let i = 1; i < points.length; i++) {
    const d = (points[i][0] - points[0][0]) ** 2 + (points[i][1] - points[0][1]) ** 2;
    if (d > farD) { farD = d; far = i; }
  }
  const a = rdp(points.slice(0, far + 1), tolerance);
  const b = rdp(points.slice(far).concat([points[0]]), tolerance);
  const merged = a.concat(b.slice(1, -1));
  return merged.length >= 3 ? merged : points;
}

function rdp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1;
    let maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegDist(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol && maxI > 0) {
      keep[maxI] = 1;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function pointSegDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}
