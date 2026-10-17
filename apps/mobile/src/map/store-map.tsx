'use dom';

import type { DOMProps } from 'expo/dom';
import {
  AttributionControl,
  type FilterSpecification,
  type GeoJSONSource,
  type LngLatLike,
  Map as MapLibreMap,
  type MapMouseEvent,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { colors } from '../theme/tokens';
import {
  boundsOf,
  centreOf,
  CLUSTER_MAX_ZOOM,
  FIT_MAX_ZOOM,
  type MapPin,
  type MapPoint,
  type MapTap,
  MONGOLIA,
  STORE_ZOOM,
  storeIdsOf,
  tapOf,
} from './stores';
import { isTrustedWorker, WORKER_URL } from './worker';

// The store map (the owner, 2026-10-18): an Expo DOM component, so MapLibre GL JS draws
// OpenFreeMap's vector tiles (OpenStreetMap data, no key) in a web view. The screen passes JSON
// props and hears taps through the async onPinPress and onPinsPress; the phone's own position
// comes from expo-location on the native side (the web view has no geolocation).

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

let workerReady: Promise<void> | null = null;

/**
 * MapLibre's tile worker (see worker.ts): fetched once, run only when it is the installed file.
 * A development build served over plain http has no Web Crypto and skips the check.
 */
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

/** How far from a finger a pin still counts as tapped, in CSS pixels. */
const TAP_SLOP = 18;
/** Room the screen's «my location» button takes at the bottom right, in CSS pixels. */
const CORNER_CLEAR = 72;

/** The most stores a stack at one point lists. */
const MAX_STACK = 200;

const STORES = 'stores';
const ME = 'me';

/** The GeoJSON the sources take, spelled out (the app does not depend on @types/geojson). */
interface Collection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: Record<string, number | boolean>;
  }[];
}

function storesOf(pins: readonly MapPin[]): Collection {
  return {
    type: 'FeatureCollection',
    features: pins.map((pin) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [pin.lng, pin.lat] },
      properties: { id: pin.id, stale: pin.stale },
    })),
  };
}

function meOf(me: MapPoint | null): Collection {
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

function selectedFilter(id: number | null): FilterSpecification {
  return ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], id ?? -1]];
}

function addLayers(map: MapLibreMap, pins: readonly MapPin[], me: MapPoint | null) {
  map.addSource(STORES, {
    type: 'geojson',
    data: storesOf(pins),
    cluster: true,
    clusterRadius: 42,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    // A cluster rings red while it holds a store without an order.
    clusterProperties: { stale: ['+', ['case', ['get', 'stale'], 1, 0]] },
  });
  map.addSource(ME, { type: 'geojson', data: meOf(me) });

  // The rep's halo under the stores, the dot over them.
  map.addLayer({
    id: 'me-halo',
    type: 'circle',
    source: ME,
    paint: { 'circle-radius': 22, 'circle-color': colors.tint.blue, 'circle-opacity': 0.16 },
  });
  // A soft shadow under every pin and cluster, so they stand off the map. Two layers: MapLibre
  // takes ["zoom"] only as the input of a top-level step or interpolate, never inside a "case".
  const shadow = {
    'circle-color': colors.foreground,
    'circle-opacity': 0.22,
    'circle-blur': 0.6,
    'circle-translate': [0, 1.5] as [number, number],
  };
  map.addLayer({
    id: 'cluster-shadows',
    type: 'circle',
    source: STORES,
    filter: ['has', 'point_count'],
    paint: {
      ...shadow,
      'circle-radius': ['step', ['get', 'point_count'], 20, 10, 23, 50, 27, 200, 31],
    },
  });
  map.addLayer({
    id: 'pin-shadows',
    type: 'circle',
    source: STORES,
    filter: ['!', ['has', 'point_count']],
    paint: {
      ...shadow,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 12, 17, 14],
    },
  });
  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: STORES,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': colors.card,
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 19, 50, 23, 200, 27],
      'circle-stroke-width': 3,
      'circle-stroke-color': [
        'case',
        ['>', ['get', 'stale'], 0],
        colors.tint.red,
        colors.tint.green,
      ],
    },
  });
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: STORES,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 13,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': colors.foreground },
  });
  map.addLayer({
    id: 'selected',
    type: 'circle',
    source: STORES,
    filter: selectedFilter(null),
    paint: {
      'circle-radius': 20,
      'circle-color': ['case', ['get', 'stale'], colors.tint.red, colors.tint.green],
      'circle-opacity': 0.3,
    },
  });
  map.addLayer({
    id: 'pins',
    type: 'circle',
    source: STORES,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 14, 8, 17, 10],
      'circle-color': ['case', ['get', 'stale'], colors.tint.red, colors.tint.green],
      'circle-stroke-width': 3,
      'circle-stroke-color': colors.card,
    },
  });
  map.addLayer({
    id: 'me-dot',
    type: 'circle',
    source: ME,
    paint: {
      'circle-radius': 7,
      'circle-color': colors.tint.blue,
      'circle-stroke-width': 3,
      'circle-stroke-color': colors.card,
    },
  });
}

/**
 * What a tap hit (tapOf in stores.ts): what lies right under the finger first, else what lies
 * within a finger's slop around it. Clusters carry `cluster_id`, pins the store's `id`.
 */
function tapAt(map: MapLibreMap, event: MapMouseEvent): MapTap | null {
  const { x, y } = event.point;
  const layers = ['pins', 'clusters'];
  const exact = map.queryRenderedFeatures([x, y], { layers });
  const found =
    exact.length > 0
      ? exact
      : map.queryRenderedFeatures(
          [
            [x - TAP_SLOP, y - TAP_SLOP],
            [x + TAP_SLOP, y + TAP_SLOP],
          ],
          { layers },
        );
  return tapOf(found.map((feature) => feature.properties as Record<string, unknown>));
}

/** What the map's handlers read at the moment of a tap (the props of the last render). */
interface Latest {
  pins: MapPin[] | null;
  me: MapPoint | null;
  cardHeight: number;
  onPinPress: (customerId: number) => Promise<void>;
  onPinsPress: (customerIds: number[]) => Promise<void>;
  onMapError: () => Promise<void>;
  onMapLoad: () => Promise<void>;
}

/** An error of one source or of one of its tiles (MapLibre retries tiles): the map still works. */
function isSourceError(event: object): boolean {
  return 'sourceId' in event || 'tile' in event;
}

function createMap(
  element: HTMLDivElement,
  latest: { readonly current: Latest },
  onLoad: (map: MapLibreMap) => void,
): MapLibreMap {
  const map = new MapLibreMap({
    container: element,
    style: STYLE_URL,
    center: MONGOLIA.center,
    zoom: MONGOLIA.zoom,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
  });
  map.touchZoomRotate.disableRotation();
  // OpenFreeMap's and OpenStreetMap's credit, shown until the map is first moved, then an «i».
  map.addControl(new AttributionControl({ compact: true }), 'bottom-left');

  let loaded = false;
  map.on('load', () => {
    loaded = true;
    addLayers(map, latest.current.pins ?? [], latest.current.me);
    onLoad(map);
    // An error told before the load (a sprite, say) did not keep the map from drawing.
    void latest.current.onMapLoad();
  });
  // Only a style that never came is fatal, told once; a failed source or tile is not.
  let told = false;
  map.on('error', (event) => {
    if (loaded || told || isSourceError(event)) return;
    told = true;
    void latest.current.onMapError();
  });

  /** A store's pin: it moves into the part of the map above the store card. */
  const openPin = (id: number, near: LngLatLike) => {
    const pin = latest.current.pins?.find((candidate) => candidate.id === id);
    map.easeTo({
      center: pin ? [pin.lng, pin.lat] : near,
      zoom: Math.max(map.getZoom(), STORE_ZOOM - 1),
      offset: [0, -latest.current.cardHeight / 2],
    });
    void latest.current.onPinPress(id);
  };

  /** Stores at (about) one point: the map shows their spot unclustered, the screen asks which. */
  const openStack = (ids: number[], near: LngLatLike) => {
    const wanted = new Set(ids);
    const centre = centreOf(latest.current.pins?.filter((pin) => wanted.has(pin.id)) ?? []);
    map.easeTo({
      center: centre ?? near,
      zoom: Math.max(map.getZoom(), CLUSTER_MAX_ZOOM + 1),
      offset: [0, -latest.current.cardHeight / 2],
    });
    void latest.current.onPinsPress(ids);
  };

  map.on('click', (event) => {
    const hit = tapAt(map, event);
    if (!hit) return;
    if (hit.kind === 'pin') {
      openPin(hit.id, event.lngLat);
      return;
    }
    if (hit.kind === 'pins') {
      openStack(hit.ids, event.lngLat);
      return;
    }
    const source = map.getSource<GeoJSONSource>(STORES);
    if (!source) return;
    const near = event.lngLat;
    void source
      .getClusterExpansionZoom(hit.clusterId)
      .then(async (zoom) => {
        if (zoom <= CLUSTER_MAX_ZOOM) {
          map.easeTo({ center: near, zoom: Math.min(zoom + 0.5, 18) });
          return;
        }
        // The cluster parts only past the last clustering zoom: its stores stand close together.
        // GeoJSON features (the app does not depend on @types/geojson, see Collection).
        const leaves = (await source.getClusterLeaves(hit.clusterId, MAX_STACK, 0)) as unknown as {
          properties: Record<string, unknown> | null;
        }[];
        const ids = storeIdsOf(leaves.map((leaf) => leaf.properties ?? {}));
        const [only] = ids;
        if (ids.length > 1) openStack(ids, near);
        else if (only !== undefined) openPin(only, near);
      })
      .catch(() => undefined);
  });
  return map;
}

const fill: CSSProperties = { position: 'fixed', inset: 0, background: colors.canvas };

export default function StoreMap({
  pins,
  me,
  selectedId,
  locate,
  cardHeight,
  insetBottom,
  onPinPress,
  onPinsPress,
  onMapError,
  onMapLoad,
}: {
  /** null while the stores load: the map stays on Mongolia and fits the pins once they come. */
  pins: MapPin[] | null;
  me: MapPoint | null;
  selectedId: number | null;
  /** Bumped by the screen's «my location» button: the map flies to `me`. */
  locate: number;
  /** The store card's height: a tapped pin is centred in the part of the map above it. */
  cardHeight: number;
  /** The phone's navigation bar under the map, kept clear when the pins are fitted. */
  insetBottom: number;
  onPinPress: (customerId: number) => Promise<void>;
  /** A tap on several stores at (about) one point: the screen asks which one. */
  onPinsPress: (customerIds: number[]) => Promise<void>;
  /**
   * The map cannot be drawn: the worker or the style did not load (no internet), or the phone's web
   * view has no WebGL. The screen shows its failure card with «try again».
   */
  onMapError: () => Promise<void>;
  /** The map loaded: a failure told before it is over. */
  onMapLoad: () => Promise<void>;
  dom?: DOMProps;
}) {
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef<Latest>({
    pins,
    me,
    cardHeight,
    onPinPress,
    onPinsPress,
    onMapError,
    onMapLoad,
  });
  const fitted = useRef(false);
  const [map, setMap] = useState<MapLibreMap | null>(null);

  // Every prop arrives again as new JSON on each of the screen's renders: compare by value.
  const pinsKey = pins === null ? null : JSON.stringify(pins);
  const meKey = me === null ? null : `${me.lat},${me.lng}`;

  useEffect(() => {
    latest.current = { pins, me, cardHeight, onPinPress, onPinsPress, onMapError, onMapLoad };
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
          created = createMap(container.current, latest, (loaded) => {
            if (!gone) setMap(loaded);
          });
        } catch {
          // MapLibre throws when the web view cannot give it a WebGL context.
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

  // New pins (the data, or the «only stale» toggle); the first ones are fitted into view.
  useEffect(() => {
    const current = latest.current.pins;
    if (!map || pinsKey === null || current === null) return;
    void map.getSource<GeoJSONSource>(STORES)?.setData(storesOf(current));
    if (fitted.current) return;
    fitted.current = true;
    const bounds = boundsOf(current);
    if (!bounds) return;
    const [[west, south], [east, north]] = bounds;
    if (west === east && south === north) {
      map.jumpTo({ center: [west, south], zoom: STORE_ZOOM });
    } else {
      map.fitBounds(bounds, {
        padding: { top: 110, bottom: 80 + insetBottom, left: 40, right: 40 },
        maxZoom: FIT_MAX_ZOOM,
        duration: 0,
      });
    }
  }, [map, pinsKey, insetBottom]);

  // The credit stays clear of the phone's navigation bar and of the «my location» button.
  useEffect(() => {
    const corner = container.current?.querySelector<HTMLElement>('.maplibregl-ctrl-bottom-left');
    if (!map || !corner) return;
    corner.style.bottom = `${insetBottom}px`;
    corner.style.right = `${CORNER_CLEAR}px`;
  }, [map, insetBottom]);

  useEffect(() => {
    void map?.getSource<GeoJSONSource>(ME)?.setData(meOf(latest.current.me));
  }, [map, meKey]);

  useEffect(() => {
    map?.setFilter('selected', selectedFilter(selectedId));
  }, [map, selectedId]);

  useEffect(() => {
    const here = latest.current.me;
    if (locate === 0 || !map || !here) return;
    map.flyTo({ center: [here.lng, here.lat], zoom: Math.max(map.getZoom(), STORE_ZOOM - 1) });
  }, [map, locate]);

  return <div ref={container} style={fill} />;
}
