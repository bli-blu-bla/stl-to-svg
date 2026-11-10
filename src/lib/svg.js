// Serialise plane-local contours into an SVG document.

import { pathBounds } from './arcs.js';

export const UNITS = {
  mm: { label: 'Millimeters (mm)', suffix: 'mm', scale: 1 },
  cm: { label: 'Centimeters (cm)', suffix: 'cm', scale: 0.1 },
  in: { label: 'Inches (in)', suffix: 'in', scale: 1 / 25.4 },
  px: { label: 'Pixels (px)', suffix: '', scale: 96 / 25.4 },
};

const round = (n) => {
  const r = Math.round(n * 1e4) / 1e4;
  return Object.is(r, -0) ? 0 : r;
};

export function buildSVG(paths, opts) {
  const { unit = 'mm', strokeWidth = 0.1, stroke = '#000000', title = '' } = opts || {};
  const { suffix, scale } = UNITS[unit] || UNITS.mm;
  // The stroke width is authored in millimetres, so it has to be scaled into
  // the output unit alongside the geometry to stay physically the same width.
  const sw = strokeWidth * scale;

  let { minX, minY, maxX, maxY } = pathBounds(paths);
  if (!isFinite(minX)) {
    minX = 0; minY = 0; maxX = 1; maxY = 1;
  }

  // Half a stroke on each side so the outermost line is not clipped.
  const margin = sw / 2;
  const width = (maxX - minX) * scale + sw;
  const height = (maxY - minY) * scale + sw;

  // SVG's y axis points down, so the plane's v axis is mirrored.
  const tx = (x) => round((x - minX) * scale + margin);
  const ty = (y) => round((maxY - y) * scale + margin);

  // Recognised arcs are written as arcs and whole circles as <circle>, so CAM
  // software gets a true radius instead of a run of short chords. Mirroring y
  // turns a counter-clockwise arc into sweep-flag 0.
  const seg = (p, i) => {
    const arc = p.arcs?.[i];
    const end = `${tx(p.points[i][0])} ${ty(p.points[i][1])}`;
    if (!arc) return `L ${end}`;
    const r = round(arc.r * scale);
    return `A ${r} ${r} 0 ${arc.sweep > Math.PI ? 1 : 0} ${arc.ccw ? 0 : 1} ${end}`;
  };

  const body = paths.map((p) => {
    if (p.circle) {
      return `  <circle cx="${tx(p.circle.cx)}" cy="${ty(p.circle.cy)}" r="${round(p.circle.r * scale)}"/>`;
    }
    const pts = p.points;
    let s = `M ${tx(pts[0][0])} ${ty(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) s += ` ${seg(p, i)}`;
    if (p.closed) s += p.arcs?.[0] ? ` ${seg(p, 0)} Z` : ' Z';
    return `  <path d="${s}"/>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1"
     width="${round(width)}${suffix}" height="${round(height)}${suffix}"
     viewBox="0 0 ${round(width)} ${round(height)}">
${title ? `  <title>${escapeXml(title)}</title>\n` : ''}  <g fill="none" stroke="${stroke}" stroke-width="${round(sw)}" stroke-linecap="round" stroke-linejoin="round">
${body}
  </g>
</svg>
`;
}

function escapeXml(s) {
  return s.replace(/[<>&"']/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}
