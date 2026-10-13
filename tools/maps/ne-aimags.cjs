// Builds apps/web/src/features/auth/mongolia-aimags.ts from Natural Earth 1:10m admin-1 (public
// domain, v5.1.2): Mongolia's 21 aimags and Ulaanbaatar as SVG paths in the login map's units.
// Usage: download ne_10m_admin_1_states_provinces.geojson (github.com/nvkelso/natural-earth-vector,
// tag v5.1.2, geojson/), then:
//   node tools/maps/ne-aimags.cjs <that file> apps/web/src/features/auth/mongolia-aimags.ts
const fs = require('fs');

const [, , input, output] = process.argv;
if (!input || !output) throw new Error('usage: node tools/maps/ne-aimags.cjs <geojson> <out.ts>');

// Must match apps/web/src/features/auth/mongolia.ts.
const WEST = 87.4;
const NORTH = 52.4;
const SCALE = 40;
const ASPECT = Math.cos((47 * Math.PI) / 180);
const TOLERANCE = 0.7; // map units (~0.02°), small enough to keep the borders recognisable

const project = ([lon, lat]) => [(lon - WEST) * ASPECT * SCALE, (NORTH - lat) * SCALE];

function perpendicular(point, start, end) {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(x - x1, y - y1);
  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length;
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let index = 0;
  let distance = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicular(points[i], points[0], points[points.length - 1]);
    if (d > distance) {
      index = i;
      distance = d;
    }
  }
  if (distance <= tolerance) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

/** A closed ring split in two halves so Douglas–Peucker keeps its shape. */
function simplifyRing(ring) {
  const projected = ring.map(project);
  const half = Math.floor(projected.length / 2);
  const first = simplify(projected.slice(0, half + 1), TOLERANCE);
  const second = simplify(projected.slice(half), TOLERANCE);
  return [...first.slice(0, -1), ...second];
}

const round = (value) => Math.round(value * 10) / 10;
const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const units = data.features
  .filter((feature) => feature.properties.adm0_a3 === 'MNG')
  .map((feature) => {
    const rings =
      feature.geometry.type === 'Polygon'
        ? feature.geometry.coordinates
        : feature.geometry.coordinates.flat(1);
    const d = rings
      .map(simplifyRing)
      .filter((ring) => ring.length >= 4)
      .map(
        (ring) =>
          `M${ring
            .slice(0, -1)
            .map(([x, y]) => `${round(x)},${round(y)}`)
            .join('L')}Z`,
      )
      .join('');
    return { code: feature.properties.iso_3166_2, name: feature.properties.name_en, d };
  })
  .sort((a, b) => a.code.localeCompare(b.code));

const points = units.reduce((sum, unit) => sum + unit.d.split(/[ML]/).length - 1, 0);
const lines = [
  '/*',
  " * GENERATED — do not edit by hand. Mongolia's 21 aimags and Ulaanbaatar for the login map",
  ' * (ADR-0042 #11): Natural Earth 1:10m admin-1 states and provinces v5.1.2 (public domain,',
  ' * naturalearthdata.com), projected like `mongolia.ts` and simplified (Douglas-Peucker,',
  ` * ${TOLERANCE} map units; ${points} points). Rebuild with tools/maps/ne-aimags.cjs.`,
  ' */',
  'export interface AimagShape {',
  '  /** ISO 3166-2 code (MN-041 is Khövsgöl, MN-055 Övörkhangai, MN-1 Ulaanbaatar). */',
  '  code: string;',
  '  name: string;',
  '  d: string;',
  '}',
  '',
  'export const AIMAGS: readonly AimagShape[] = [',
  ...units.map(
    (unit) =>
      `  {\n    code: '${unit.code}',\n    name: '${unit.name.replace(/'/g, "\\'")}',\n    d: '${unit.d}',\n  },`,
  ),
  '];',
  '',
];
fs.writeFileSync(output, lines.join('\n'));
console.log(`${units.length} units, ${points} points, ${fs.statSync(output).size} bytes`);
