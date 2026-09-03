# STL to SVG Converter

Convert 3D STL files to 2D SVG paths for laser cutting, CNC routing, and fabrication.

Everything runs in the browser. There is no backend, no upload, no account — your
files never leave your machine, which is also why the whole thing costs nothing to
host as a static page.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/

npm run test:unit  # geometry and parser tests (fast, no browser)
npm run test:e2e   # browser tests in Chromium and WebKit
npm test           # all of it
```

## The two modes

**Intersection Outline** slices the mesh with a plane and returns the cross-section:
every edge where the plane meets the geometry, inner walls included. Use it for
cross-sections, internal structure patterns, and layered cutting templates.

**Projection Outline** flattens the whole mesh onto the plane and traces the resulting
silhouette, holes included. Overlapping bodies merge into one outline; detached ones
stay separate. Use it for templates, stencils, and gaskets.

Both work on the XY / XZ / YZ planes or on a custom orientation (yaw around Z plus tilt
away from Z). The 3D preview draws the plane in place — red for the cutting plane,
green for the projection surface with an arrow showing the viewing direction.

## Settings

| Setting | Meaning |
| --- | --- |
| Output Units | mm, cm, in, or px (96 dpi). STL coordinates are treated as millimetres. |
| Plane Offset | Where along the plane normal the cut happens. Bounded by the model's extent. |
| Resolution | Maximum distance a simplified path may deviate from the exact contour, 0.05–1 mm. |
| Stroke Width | Line width in millimetres; scaled into the chosen output unit so it stays physically constant. |
| Outline Quality | Projection only — `exact`, `raster`, or `auto`. See below. |

## Deploying to GitHub Pages

Push to `main` and the included workflow builds and publishes automatically. Once, in
the repository settings, set **Settings → Pages → Source** to **GitHub Actions**.

The build uses relative asset URLs (`base: './'`), so the same `dist/` works at a
domain root and under a project path like `/<repo>/`. That is not an assumption — the
browser tests serve the production build from a sub-path precisely to keep it true.

## How it works

- `src/lib/stl.js` — binary and ASCII STL reader. Binary detection is by exact file
  length (`84 + 50n`), since binary files frequently start with `solid` too. Treats the
  file as untrusted: the triangle count is clamped to what the file can actually hold,
  so a corrupt header claiming four billion triangles cannot drive an allocation, and
  triangles with non-finite coordinates are dropped rather than poisoning the bounds.
- `src/lib/plane.js` — plane normal plus an orthonormal `(u, v)` basis. All 2D output
  lives in that basis.
- `src/lib/slice.js` — per-triangle plane intersection. Edge points are interpolated in a
  canonical vertex order, so an edge shared by two triangles produces bit-identical
  points and the segments chain into closed rings without a loose weld tolerance.
  Vertices exactly on the plane are nudged to one side, which keeps every crossing
  triangle at exactly two intersection points and drops coplanar ones.
- `src/lib/project.js` — two strategies. `exact` unions every projected triangle with
  `polygon-clipping`, merging in a balanced tree rather than folding one triangle at a
  time; this gives crisp straight edges. `raster` samples the silhouette onto a grid and
  runs marching squares — far cheaper, and what `auto` falls back to above 60k triangles
  (or if the boolean union fails).
- `src/lib/geom2d.js` — segment chaining and Ramer–Douglas–Peucker simplification.
  Open chains are emitted separately so non-manifold meshes degrade gracefully instead
  of producing bogus loops.
- Conversion runs in a Web Worker, so large meshes never block the UI, and a run can be
  cancelled — a boolean union cannot be interrupted cooperatively, so cancelling
  terminates the thread and the next job starts a fresh one.

## Limits and failure modes

- **File size is capped at 100 MB per file, five files at a time.** A 100 MB mesh holds
  ~2.1 million triangles and costs roughly 150 MB of live buffers; the browser tab is
  the only memory budget there is, so oversized files are refused up front instead of
  crashing the page.
- **Non-manifold or self-intersecting meshes** still slice, but their cross-sections may
  come out as open polylines rather than closed rings. This is deliberate: inventing
  closed loops from broken topology would be worse than showing what is actually there.
- **STL has no unit information.** Coordinates are assumed to be millimetres, which is
  the near-universal convention but not a guarantee — check the reported model size
  before cutting.
- **Binary STL has no magic number.** A non-STL file of the right length can be read as
  garbage triangles rather than rejected. The 3D preview makes this obvious immediately.
- **Without WebGL** the 3D preview degrades to a message; conversion and download still
  work.

## License

MIT — see [LICENSE](LICENSE).
