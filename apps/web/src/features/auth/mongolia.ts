/**
 * The login page's map of Mongolia (owner, 2026-10-13; ADR-0042 #11): the projection shared with
 * the generated aimag shapes (`mongolia-aimags.ts`, from `tools/maps/ne-aimags.cjs`) and the three
 * places on it — the capital, the main branch «Оргил Бөөний төв» in Mörön (Khövsgöl) and the
 * branch «Боломж бөөний төв» in Kharkhorin (Övörkhangai). Equirectangular with the cosine of 47°N,
 * so the country keeps its proportions.
 */
type LonLat = readonly [number, number];

export const PLACES = {
  ulaanbaatar: [106.92, 47.92],
  muron: [100.16, 49.64],
  kharkhorin: [102.83, 47.2],
} as const satisfies Record<string, LonLat>;

// tools/maps/ne-aimags.cjs projects with the same numbers.
const WEST = 87.4;
const EAST = 120.2;
const NORTH = 52.4;
const SOUTH = 41.3;
const SCALE = 40;
const ASPECT = Math.cos((47 * Math.PI) / 180);

export const MAP_WIDTH = Math.round((EAST - WEST) * ASPECT * SCALE);
export const MAP_HEIGHT = Math.round((NORTH - SOUTH) * SCALE);

export function project([lon, lat]: LonLat): [number, number] {
  return [(lon - WEST) * ASPECT * SCALE, (NORTH - lat) * SCALE];
}

/** A route drawn as a gentle arc from `from` to `to`, bulging north. */
export function routePath(from: LonLat, to: LonLat): string {
  const [x1, y1] = project(from);
  const [x2, y2] = project(to);
  const lift = Math.hypot(x2 - x1, y2 - y1) * 0.32;
  const cx = (x1 + x2) / 2 - lift * 0.3;
  const cy = Math.min(y1, y2) - lift;
  return `M${x1.toFixed(1)},${y1.toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}
