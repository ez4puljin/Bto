import { Decimal, type DecimalInput } from '../money';

/**
 * Customer locations (SPEC §5.3, §6.7): latitude and longitude as decimal strings with at most six
 * decimals (NUMERIC(9,6) in the database, about 10 cm). The office pastes them from Google Maps
 * now; drivers and reps capture them on site from delivery 4–5.
 */
export interface Coordinates {
  lat: string;
  lng: string;
}

/** Mongolia with a margin. A distributor with its own drivers has no customer outside it. */
export const MONGOLIA_BOUNDS = { minLat: 41.5, maxLat: 52.2, minLng: 87.7, maxLng: 120 } as const;

export const COORDINATE_DECIMALS = 6;

export type CoordinatesProblem = 'EMPTY' | 'SHORT_LINK' | 'FORMAT' | 'OUTSIDE';

const NUMBER = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;
/** "47.918412, 106.917712" as Google Maps copies it from a right click; also space or ";". */
const PAIR = new RegExp(String.raw`^(${NUMBER})\s*[,;\s]\s*(${NUMBER})$`);
/** The dropped pin in a place URL (…!3d47.918412!4d106.917712…), more exact than the map centre. */
const PIN = new RegExp(String.raw`!3d(${NUMBER})!4d(${NUMBER})`);
/** The map centre of a URL: …/@47.9184,106.9177,17z. */
const CENTRE = new RegExp(String.raw`@(${NUMBER}),(${NUMBER})`);
/** ?q=47.9,106.9 · ?query=… · ?ll=… (Google Maps search and share links). */
const QUERY = new RegExp(String.raw`[?&](?:q|query|ll)=(${NUMBER})\s*,\s*(${NUMBER})`, 'i');
/** Short share links need an HTTP request to resolve: the user copies the numbers instead. */
const SHORT_LINK = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i;

export function isInMongolia(lat: DecimalInput, lng: DecimalInput): boolean {
  const latitude = new Decimal(lat);
  const longitude = new Decimal(lng);
  return (
    latitude.gte(MONGOLIA_BOUNDS.minLat) &&
    latitude.lte(MONGOLIA_BOUNDS.maxLat) &&
    longitude.gte(MONGOLIA_BOUNDS.minLng) &&
    longitude.lte(MONGOLIA_BOUNDS.maxLng)
  );
}

function rounded(value: string): string {
  return new Decimal(value).toDecimalPlaces(COORDINATE_DECIMALS).toString();
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Coordinates from what people paste: a "lat, lng" pair or a Google Maps URL (the dropped pin
 * first, then a search query, then the map centre). Rounded half-up to six decimals; a pair given
 * in the wrong order is swapped when only the swapped one lies in Mongolia.
 */
export function parseCoordinates(
  input: string,
): { ok: true; value: Coordinates } | { ok: false; problem: CoordinatesProblem } {
  const text = decoded(input.trim());
  if (!text) return { ok: false, problem: 'EMPTY' };
  if (SHORT_LINK.test(text)) return { ok: false, problem: 'SHORT_LINK' };
  const match = PIN.exec(text) ?? QUERY.exec(text) ?? CENTRE.exec(text) ?? PAIR.exec(text);
  const [first, second] = [match?.[1], match?.[2]];
  if (first === undefined || second === undefined) return { ok: false, problem: 'FORMAT' };
  const [lat, lng] = [rounded(first), rounded(second)];
  if (isInMongolia(lat, lng)) return { ok: true, value: { lat, lng } };
  if (isInMongolia(lng, lat)) return { ok: true, value: { lat: lng, lng: lat } };
  return { ok: false, problem: 'OUTSIDE' };
}

/** A link that opens the point in Google Maps (no API key; works on phones and desktops). */
export function mapsUrl(point: Coordinates): string {
  return `https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`;
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * The great-circle distance between two points in whole metres (haversine). Geometry for the
 * attendance geofence (ADR-0131), never money: plain floating point is fine here.
 */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (value: string) => (Number.parseFloat(value) * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(b.lng) - toRad(a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}
