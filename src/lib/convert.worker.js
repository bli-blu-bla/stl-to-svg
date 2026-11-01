import { basisFor } from './plane.js';
import { sliceMesh } from './slice.js';
import { projectMesh } from './project.js';
import { projectEdges } from './edges.js';
import { buildSVG } from './svg.js';

self.onmessage = (e) => {
  const { id, positions, settings } = e.data;
  const t0 = performance.now();

  // Throttle progress reports. The union loop can call this thousands of times
  // per second, and every message costs a React render on the main thread —
  // unthrottled it floods the very UI it exists to keep responsive.
  let lastSent = 0;
  const progress = (stage, fraction) => {
    const now = performance.now();
    if (now - lastSent < 100) return;
    lastSent = now;
    self.postMessage({ id, progress: { stage, fraction } });
  };

  try {
    const basis = basisFor(settings.planeKey, settings.customNormal);
    const tolerance = settings.resolution;

    progress(settings.mode === 'intersection' ? 'Slicing' : 'Projecting', 0);
    const paths = settings.mode === 'intersection'
      ? sliceMesh(positions, basis, settings.offset, tolerance)
      : settings.detail === 'edges'
        ? projectEdges(positions, basis, tolerance, settings.edgeAngle, progress)
        : projectMesh(positions, basis, tolerance, settings.quality, progress);

    if (!paths.length) {
      self.postMessage({ id, error: settings.mode === 'intersection'
        ? 'The plane does not intersect this model at the current offset.'
        : 'No outline could be generated for this model.' });
      return;
    }

    progress('Writing SVG', 0.95);
    const svg = buildSVG(paths, {
      unit: settings.unit,
      strokeWidth: settings.strokeWidth,
      stroke: settings.stroke,
      title: settings.title,
    });

    self.postMessage({
      id,
      svg,
      stats: {
        paths: paths.length,
        closed: paths.filter((p) => p.closed).length,
        vertices: paths.reduce((a, p) => a + p.points.length, 0),
        ms: Math.round(performance.now() - t0),
      },
    });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
