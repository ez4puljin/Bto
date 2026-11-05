import type * as MapLibre from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { cn } from '@/lib/utils';

/*
 * A map of the company's places (ADR-0146 #6): MapLibre on OpenFreeMap's streets, with no key and
 * no account, like the staff app's store map (ADR-0068). Loaded with its page's first map.
 */

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const CIRCLES = 'bto-radius';
/** Mörön, until the page has a point of its own. */
const DEFAULT_CENTER: [number, number] = [100.1623, 49.6345];

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** A circle of this many metres around the point (a work site's radius). */
  radiusM?: number | null;
  /** A token colour for the pin; the primary colour otherwise. */
  color?: string;
  photoUrl?: string | null;
}

/** A circle as a polygon, close enough for a few hundred metres. */
function circle(point: MapPoint) {
  const steps = 48;
  const metres = point.radiusM ?? 0;
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.cos((point.lat * Math.PI) / 180));
  const ring = Array.from({ length: steps + 1 }, (_, index) => {
    const angle = (index / steps) * 2 * Math.PI;
    return [point.lng + dLng * Math.cos(angle), point.lat + dLat * Math.sin(angle)];
  });
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [ring] },
  };
}

const canDraw = () =>
  !navigator.userAgent.includes('jsdom') && typeof window.WebGLRenderingContext !== 'undefined';

/**
 * The map with pins (and radii). `focus` flies to a point; `onPick` turns a click on the map into a
 * position, for placing a work site. `label` names the map for a screen reader; the page lists the
 * same points beside it.
 */
export function GeoMap(props: {
  points: readonly MapPoint[];
  label: string;
  focusId?: string | null;
  onPick?: (position: { lat: number; lng: number }) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const ready = useRef(false);
  const lib = useRef<typeof MapLibre | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const render = () => {
    const instance = map.current;
    const maplibre = lib.current;
    if (!instance || !maplibre || !ready.current) return;
    for (const marker of markers.current) marker.remove();
    const { points } = latest.current;
    markers.current = points.map((point) =>
      new maplibre.Marker({
        color:
          point.color ??
          getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
      })
        .setLngLat([point.lng, point.lat])
        .setPopup(new maplibre.Popup({ offset: 24 }).setText(point.label))
        .addTo(instance),
    );
    const source = instance.getSource<GeoJSONSource>(CIRCLES);
    void source?.setData({
      type: 'FeatureCollection',
      features: points.filter((point) => point.radiusM).map(circle),
    });
  };

  const fit = () => {
    const instance = map.current;
    const maplibre = lib.current;
    if (!instance || !maplibre) return;
    const { points } = latest.current;
    const first = points[0];
    if (!first) return;
    if (points.length === 1) {
      instance.jumpTo({ center: [first.lng, first.lat], zoom: 15 });
      return;
    }
    const bounds = new maplibre.LngLatBounds();
    for (const point of points) bounds.extend([point.lng, point.lat]);
    instance.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
  };

  useEffect(() => {
    if (!canDraw() || !box.current) return undefined;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    void Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(
      ([maplibre]) => {
        if (cancelled || !box.current) return;
        lib.current = maplibre;
        // MapLibre 6 finds its worker beside its own file, which a bundler moves.
        maplibre.setWorkerUrl(workerUrl);
        const instance = new maplibre.Map({
          container: box.current,
          style: STYLE_URL,
          center: DEFAULT_CENTER,
          zoom: 12,
          attributionControl: { compact: true },
        });
        map.current = instance;
        instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
        instance.addControl(new maplibre.FullscreenControl(), 'top-right');
        instance.on('load', () => {
          const primary = getComputedStyle(document.documentElement)
            .getPropertyValue('--primary')
            .trim();
          instance.addSource(CIRCLES, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          instance.addLayer({
            id: `${CIRCLES}-fill`,
            type: 'fill',
            source: CIRCLES,
            paint: { 'fill-color': primary, 'fill-opacity': 0.14 },
          });
          instance.addLayer({
            id: `${CIRCLES}-line`,
            type: 'line',
            source: CIRCLES,
            paint: { 'line-color': primary, 'line-width': 2 },
          });
          ready.current = true;
          render();
          fit();
        });
        instance.on('click', (event) => {
          latest.current.onPick?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });
        });
        observer = new ResizeObserver(() => instance.resize());
        observer.observe(box.current);
      },
    );
    return () => {
      cancelled = true;
      ready.current = false;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
    };
    // Mounted once; new points go through the effects below.
  }, []);

  useEffect(render);

  const pointIds = props.points.map((point) => point.id).join(',');
  const fitted = useRef('');
  useEffect(() => {
    if (fitted.current === pointIds) return;
    fitted.current = pointIds;
    fit();
  });

  const { focusId } = props;
  useEffect(() => {
    if (!focusId) return;
    const point = latest.current.points.find((entry) => entry.id === focusId);
    if (point) map.current?.flyTo({ center: [point.lng, point.lat], zoom: 16, speed: 1.4 });
  }, [focusId]);

  return (
    <div
      ref={box}
      role="application"
      aria-label={props.label}
      className={cn('h-full min-h-72 w-full overflow-hidden rounded-xl border', props.className)}
    />
  );
}
