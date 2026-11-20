// Map layers: a species' finds (attached solid, drift as a ring, unknown faint)
// and the risk factors around the pin with the search radius.

import type maplibregl from "maplibre-gl";
import type { RiskItem } from "./risk";
import type { GroupKey } from "./risk";
import type { Attachment, SpeciesDoc } from "./types";
import { ATTACHMENTS } from "./types";

export const ALGAE_COLOR: Record<string, string> = {
  brunalge: "#8a5f1d",
  rødalge: "#b0405a",
  grønalge: "#3c8a3c",
};

export const RISK_COLOR: Record<GroupKey, string> = {
  overloeb: "#b3412c",
  rens: "#7d4f96",
  industri: "#55555f",
  havne: "#2f6f9f",
  klapplads: "#8c6d1f",
  akvakultur: "#2f8f7f",
  regnvand: "#6f9fbf",
  badevand: "#3a9a5b",
};

const OBS = "observations";
const RISK = "risk";
const RING = "risk-radius";

function setGeoJson(map: maplibregl.Map, id: string, data: GeoJSON.FeatureCollection): boolean {
  const source = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
    return false;
  }
  map.addSource(id, { type: "geojson", data });
  return true;
}

export function showObservations(
  map: maplibregl.Map,
  doc: SpeciesDoc,
  visible: Set<Attachment>,
): void {
  const features: GeoJSON.Feature[] = doc.observations
    .filter((o) => visible.has(ATTACHMENTS[o[3]]))
    .map(([lon, lat, year, a, depth]) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { a: ATTACHMENTS[a], year, depth },
    }));
  const color = ALGAE_COLOR[doc.group] ?? "#1f6f78";
  if (setGeoJson(map, OBS, { type: "FeatureCollection", features })) {
    map.addLayer({
      id: OBS,
      type: "circle",
      source: OBS,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3, 12, 7],
        "circle-stroke-width": ["match", ["get", "a"], "drift", 2, 1],
        "circle-stroke-color": ["match", ["get", "a"], "drift", color, "#ffffff"],
        "circle-color": color,
        "circle-opacity": ["match", ["get", "a"], "attached", 0.85, "drift", 0, 0.35],
      },
    });
  }
  map.setPaintProperty(OBS, "circle-color", color);
  map.setPaintProperty(OBS, "circle-stroke-color", [
    "match",
    ["get", "a"],
    "drift",
    color,
    "#ffffff",
  ]);
}

// --- reframing, ported from Svampekortet's observations.ts (0024b43) ---

export interface Framing {
  bounds: [[number, number], [number, number]];
  maxZoom: number;
}

interface MapView {
  center: [number, number];
  zoom: number;
  contains: (point: [number, number]) => boolean;
}

/**
 * Decide how to reframe the map when a species' finds load.
 *
 * Returns `null` to leave the camera where it is — a find is already on screen,
 * so the user keeps their zoom and their pin. Otherwise returns a bounds that
 * spans the current centre and the nearest find, with `maxZoom` pinned to the
 * current zoom: the map only ever zooms *out*, just far enough to bring a find
 * into view, and never jumps to the national extent.
 */
export function framingForNearest(view: MapView, points: [number, number][]): Framing | null {
  if (points.length === 0) return null;
  if (points.some(([lon, lat]) => view.contains([lon, lat]))) return null;

  const [cx, cy] = view.center;
  let nearest = points[0];
  let best = Infinity;
  for (const point of points) {
    const d = (point[0] - cx) ** 2 + (point[1] - cy) ** 2;
    if (d < best) {
      best = d;
      nearest = point;
    }
  }

  return {
    bounds: [
      [Math.min(cx, nearest[0]), Math.min(cy, nearest[1])],
      [Math.max(cx, nearest[0]), Math.max(cy, nearest[1])],
    ],
    maxZoom: view.zoom,
  };
}

export function frameToNearest(map: maplibregl.Map, points: [number, number][]): void {
  const { lng, lat } = map.getCenter();
  const framing = framingForNearest(
    {
      center: [lng, lat],
      zoom: map.getZoom(),
      contains: (point) => map.getBounds().contains(point),
    },
    points,
  );
  if (!framing) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const opts = { padding: 80, maxZoom: framing.maxZoom };
  if (reduce) {
    // `fitBounds`/`flyTo` with duration 0 NaNs the transform; compute the camera
    // and jump to it instead.
    const camera = map.cameraForBounds(framing.bounds, opts);
    if (camera) map.jumpTo(camera);
  } else {
    map.fitBounds(framing.bounds, { ...opts, duration: 600 });
  }
}

export function clearObservations(map: maplibregl.Map): void {
  if (map.getLayer(OBS)) map.removeLayer(OBS);
  if (map.getSource(OBS)) map.removeSource(OBS);
}

function circlePolygon(center: [number, number], radiusM: number): GeoJSON.Feature {
  const coords: [number, number][] = [];
  const latScale = 111_320;
  const lonScale = latScale * Math.cos((center[1] * Math.PI) / 180);
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    coords.push([
      center[0] + (radiusM * Math.cos(t)) / lonScale,
      center[1] + (radiusM * Math.sin(t)) / latScale,
    ]);
  }
  return { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} };
}

export function showRisk(
  map: maplibregl.Map,
  pin: [number, number],
  radiusM: number,
  items: RiskItem[],
): void {
  const color: unknown[] = ["match", ["get", "g"]];
  for (const [group, c] of Object.entries(RISK_COLOR)) color.push(group, c);
  color.push("#888888");

  const points: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: items
      .filter((i) => i.distanceM <= radiusM)
      .map((i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [i.lon, i.lat] },
        properties: { g: i.group, title: i.title },
      })),
  };
  const ring: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [circlePolygon(pin, radiusM)],
  };
  if (setGeoJson(map, RING, ring)) {
    map.addLayer({
      id: RING,
      type: "line",
      source: RING,
      paint: { "line-color": "#1f6f78", "line-width": 1.5, "line-dasharray": [2, 2] },
    });
  }
  if (setGeoJson(map, RISK, points)) {
    map.addLayer({
      id: RISK,
      type: "circle",
      source: RISK,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 7],
        "circle-color": color as maplibregl.ExpressionSpecification,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
      },
    });
  }
}

export function clearRisk(map: maplibregl.Map): void {
  for (const id of [RISK, RING]) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
}
