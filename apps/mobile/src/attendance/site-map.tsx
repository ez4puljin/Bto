'use dom';

import type { DOMProps } from 'expo/dom';
import {
  AttributionControl,
  type GeoJSONSource,
  Map as MapLibreMap,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { colors } from '../theme/tokens';
import { isTrustedWorker, WORKER_URL } from '../map/worker';
import { circleRing } from './week';

// The map of «Ирц»: the person and their work site's circle. Same approach as the store map
// (src/map/store-map.tsx): an Expo DOM component, MapLibre GL JS with OpenFreeMap's tiles, the
// tile worker fetched and checked against the installed file's hash. The phone's position comes
// from expo-location on the native side and arrives as a prop.

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const ZOOM = 16.3;

let workerReady: Promise<void> | null = null;

function prepareWorker(): Promise<void> {
  workerReady ??= (async () => {
    const response = await fetch(WORKER_URL, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`MapLibre worker: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const subtle = globalThis.crypto?.subtle as SubtleCrypto | undefined;
    if (subtle ? !(await isTrustedWorker(bytes, subtle)) : process.env.NODE_ENV === 'production') {
      throw new Error('MapLibre worker: not the installed file');
    }
    setWorkerUrl(URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' })));
  })().catch((error: unknown) => {
    workerReady = null;
    throw error;
  });
  return workerReady;
}

export interface MePoint {
  lat: number;
  lng: number;
}

export interface SiteCircle {
  lat: number;
  lng: number;
  radiusM: number;
  inside: boolean;
}

interface Collection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry:
      | { type: 'Point'; coordinates: [number, number] }
      | { type: 'Polygon'; coordinates: [number, number][][] };
    properties: Record<string, never>;
  }[];
}

function meData(me: MePoint | null): Collection {
  return {
    type: 'FeatureCollection',
    features: me
      ? [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [me.lng, me.lat] },
            properties: {},
          },
        ]
      : [],
  };
}

function siteData(site: SiteCircle | null): Collection {
  return {
    type: 'FeatureCollection',
    features: site
      ? [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [circleRing(site.lat, site.lng, site.radiusM)],
            },
            properties: {},
          },
        ]
      : [],
  };
}

function siteCentreData(site: SiteCircle | null): Collection {
  return meData(site ? { lat: site.lat, lng: site.lng } : null);
}

/** The circle's tone: green inside, red outside. */
function toneOf(site: SiteCircle | null): string {
  return site && !site.inside ? colors.destructive : colors.success;
}

const fill: CSSProperties = { position: 'fixed', inset: 0, background: colors.canvas };

export default function SiteMap({
  me,
  site,
  focus,
  focusNonce,
  bottomPad,
  onMapError,
}: {
  me: MePoint | null;
  site: SiteCircle | null;
  /** Which point the buttons «Миний байршил» and «Ажлын байршил» centre on. */
  focus: 'me' | 'site';
  /** Bumped by those buttons: the map flies to `focus`. */
  focusNonce: number;
  /** The part of the map the sheet covers, in CSS pixels: the centre lies above it. */
  bottomPad: number;
  /** The map cannot be drawn (no internet, no WebGL): the screen keeps its own background. */
  onMapError: () => Promise<void>;
  dom?: DOMProps;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const latest = useRef({ me, site, bottomPad, onMapError });
  const camera = useRef<{ on: 'none' | 'site' | 'me'; touched: boolean }>({
    on: 'none',
    touched: false,
  });

  const meKey = me === null ? null : `${me.lat},${me.lng}`;
  const siteKey =
    site === null ? null : `${site.lat},${site.lng},${site.radiusM},${site.inside ? 1 : 0}`;

  useEffect(() => {
    latest.current = { me, site, bottomPad, onMapError };
  });

  useEffect(() => {
    document.body.style.margin = '0';
    document.body.style.overscrollBehavior = 'none';
    let gone = false;
    let created: MapLibreMap | null = null;
    prepareWorker().then(
      () => {
        if (gone || !container.current) return;
        try {
          const instance = new MapLibreMap({
            container: container.current,
            style: STYLE_URL,
            center: [100.162, 49.634],
            zoom: 5,
            attributionControl: false,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            maxPitch: 0,
          });
          created = instance;
          instance.touchZoomRotate.disableRotation();
          instance.addControl(new AttributionControl({ compact: true }), 'bottom-left');
          let loaded = false;
          instance.on('load', () => {
            loaded = true;
            const now = latest.current;
            instance.addSource('site', { type: 'geojson', data: siteData(now.site) });
            instance.addSource('site-centre', { type: 'geojson', data: siteCentreData(now.site) });
            instance.addSource('me', { type: 'geojson', data: meData(now.me) });
            const tone = toneOf(now.site);
            instance.addLayer({
              id: 'site-fill',
              type: 'fill',
              source: 'site',
              paint: { 'fill-color': tone, 'fill-opacity': 0.18 },
            });
            instance.addLayer({
              id: 'site-line',
              type: 'line',
              source: 'site',
              paint: { 'line-color': tone, 'line-width': 2, 'line-opacity': 0.7 },
            });
            instance.addLayer({
              id: 'site-dot',
              type: 'circle',
              source: 'site-centre',
              paint: {
                'circle-radius': 5,
                'circle-color': tone,
                'circle-stroke-width': 2,
                'circle-stroke-color': colors.card,
              },
            });
            instance.addLayer({
              id: 'me-halo',
              type: 'circle',
              source: 'me',
              paint: {
                'circle-radius': 24,
                'circle-color': colors.primary,
                'circle-opacity': 0.18,
              },
            });
            instance.addLayer({
              id: 'me-dot',
              type: 'circle',
              source: 'me',
              paint: {
                'circle-radius': 9,
                'circle-color': colors.primary,
                'circle-stroke-width': 3.5,
                'circle-stroke-color': colors.card,
              },
            });
            if (!gone) setMap(instance);
          });
          instance.on('error', (event) => {
            if (loaded || 'sourceId' in event || 'tile' in event) return;
            void latest.current.onMapError();
          });
          instance.on('movestart', (event) => {
            if (event.originalEvent) camera.current.touched = true;
          });
        } catch {
          void latest.current.onMapError();
        }
      },
      () => {
        if (!gone) void latest.current.onMapError();
      },
    );
    return () => {
      gone = true;
      created?.remove();
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    void map.getSource<GeoJSONSource>('site')?.setData(siteData(latest.current.site));
    void map.getSource<GeoJSONSource>('site-centre')?.setData(siteCentreData(latest.current.site));
    const tone = toneOf(latest.current.site);
    map.setPaintProperty('site-fill', 'fill-color', tone);
    map.setPaintProperty('site-line', 'line-color', tone);
    map.setPaintProperty('site-dot', 'circle-color', tone);
  }, [map, siteKey]);

  useEffect(() => {
    if (!map) return;
    void map.getSource<GeoJSONSource>('me')?.setData(meData(latest.current.me));
  }, [map, meKey]);

  // The opening view: on the person when the phone's position is known, else on the site; a late
  // position moves it once, while the person has not touched the map.
  useEffect(() => {
    if (!map) return;
    const padding = { top: 0, left: 0, right: 0, bottom: latest.current.bottomPad };
    const here = latest.current.me;
    const there = latest.current.site;
    if (camera.current.touched) return;
    if (here && camera.current.on !== 'me') {
      map.jumpTo({ center: [here.lng, here.lat], zoom: ZOOM, padding });
      camera.current.on = 'me';
    } else if (!here && there && camera.current.on === 'none') {
      map.jumpTo({ center: [there.lng, there.lat], zoom: ZOOM, padding });
      camera.current.on = 'site';
    }
  }, [map, meKey, siteKey]);

  useEffect(() => {
    if (focusNonce === 0 || !map) return;
    const target = focus === 'me' ? latest.current.me : latest.current.site;
    if (!target) return;
    camera.current.touched = true;
    map.flyTo({
      center: [target.lng, target.lat],
      zoom: Math.max(map.getZoom(), ZOOM - 1),
      padding: { top: 0, left: 0, right: 0, bottom: latest.current.bottomPad },
    });
  }, [map, focusNonce, focus]);

  // The credit stays above the sheet.
  useEffect(() => {
    const corner = container.current?.querySelector<HTMLElement>('.maplibregl-ctrl-bottom-left');
    if (corner) corner.style.bottom = `${bottomPad}px`;
  }, [map, bottomPad]);

  return <div ref={container} style={fill} />;
}
