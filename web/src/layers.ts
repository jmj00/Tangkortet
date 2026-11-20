// Map layers: a species' finds (attached solid, drift as a ring, unknown faint)
// and the risk factors around the pin with the search radius.

import type maplibregl from "maplibre-gl";
import { fitCamera, mapInsets, visibleCenter, visibleTest } from "./camera";
import { legendFor } from "./maplegend";
import type { RiskItem } from "./risk";
import { GROUPS, type GroupKey } from "./risk";
import type { Attachment, SpeciesDoc } from "./types";
import { ATTACHMENTS, shownName } from "./types";

export const ALGAE_COLOR: Record<string, string> = {
  brunalge: "#8a5f1d",
  rødalge: "#b0405a",
  // darker than the list's dot would need: a washed-up find is a ring with
  // no halo, and it must reach 3:1 on the muted water (#b6cacf)
  grønalge: "#2e7a2e",
};

/** The same groups lighter, for the dark basemap: a ring in the light-theme
 * colour all but disappears on dark land. */
export const ALGAE_COLOR_DARK: Record<string, string> = {
  brunalge: "#d3a35a",
  rødalge: "#ec8aa0",
  grønalge: "#79c779",
};

const ACCENT = { light: "#1f6f78", dark: "#7cc4cc" };

export const prefersDark = (): boolean =>
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

/** The colour a species' finds are drawn in (its algae group), per theme. */
export function algaeColor(group: string, dark = prefersDark()): string {
  return (dark ? ALGAE_COLOR_DARK : ALGAE_COLOR)[group] ?? (dark ? ACCENT.dark : ACCENT.light);
}

/** The pin and the dashed risk ring, per theme. Dark: near-white, a colour no
 * risk group or algae group uses (a cyan was too close to the pale blue of
 * the dark Regnvand markers, #9cc8e6). */
export function pinColor(dark = prefersDark()): string {
  return dark ? "#f4f7f8" : ACCENT.light;
}

/** Halo round a solid mark: white on the light map, near-black on the dark
 * one, so a mark reads against land and water alike. */
export const haloColor = (dark = prefersDark()): string => (dark ? "#0d1415" : "#ffffff");

/** Risk markers on the light basemap; each reaches 3:1 against its white
 * halo (Regnvand's blue darkened for it). */
export const RISK_COLOR: Record<GroupKey, string> = {
  overloeb: "#b3412c",
  rens: "#7d4f96",
  industri: "#55555f",
  havne: "#2f6f9f",
  klapplads: "#8c6d1f",
  akvakultur: "#2f8f7f",
  regnvand: "#5689ad",
  badevand: "#3a9a5b",
};

/** The same groups lighter for the dark basemap: 3:1 or more against the
 * dark water (#3a4e54) and land as well as the dark halo. */
export const RISK_COLOR_DARK: Record<GroupKey, string> = {
  overloeb: "#ec7a62",
  rens: "#bf93db",
  industri: "#b2b2bf",
  havne: "#6aa8d8",
  klapplads: "#d4ab55",
  akvakultur: "#52c4ad",
  regnvand: "#9cc8e6",
  badevand: "#62c784",
};

export function riskColor(group: GroupKey, dark = prefersDark()): string {
  return (dark ? RISK_COLOR_DARK : RISK_COLOR)[group];
}

function riskColorExpression(dark: boolean): maplibregl.ExpressionSpecification {
  const color: unknown[] = ["match", ["get", "g"]];
  for (const [group, c] of Object.entries(dark ? RISK_COLOR_DARK : RISK_COLOR))
    color.push(group, c);
  color.push("#888888");
  return color as maplibregl.ExpressionSpecification;
}

/** What the key last said about the risk markers, for a theme change. */
let shownRisk: { radiusM: number; groups: GroupKey[] } | null = null;

function riskLegend(dark = prefersDark()) {
  if (!shownRisk) return null;
  return {
    radiusM: shownRisk.radiusM,
    groups: GROUPS.filter((g) => shownRisk?.groups.includes(g.key)).map((g) => ({
      key: g.key,
      label: g.label,
      color: riskColor(g.key, dark),
    })),
  };
}

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

/** The group of the species whose finds are on the map, for a theme change. */
let shownGroup: string | null = null;

function paintObservations(map: maplibregl.Map, group: string): void {
  const dark = prefersDark();
  const color = algaeColor(group, dark);
  map.setPaintProperty(OBS, "circle-color", color);
  map.setPaintProperty(OBS, "circle-stroke-color", [
    "match",
    ["get", "a"],
    "drift",
    color,
    haloColor(dark),
  ]);
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
  if (setGeoJson(map, OBS, { type: "FeatureCollection", features })) {
    // Under the ring and the risk markers, which belong to the pin.
    map.addLayer(
      {
        id: OBS,
        type: "circle",
        source: OBS,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3, 12, 7],
          // attached: solid with a halo; drift: a ring; unknown: faint
          "circle-stroke-width": ["match", ["get", "a"], "drift", 2, 1],
          "circle-opacity": ["match", ["get", "a"], "attached", 0.9, "drift", 0, 0.35],
        },
      },
      map.getLayer(RING) ? RING : undefined,
    );
  }
  shownGroup = doc.group;
  paintObservations(map, doc.group);
  shownFinds = {
    name: shownName(doc),
    kinds: ATTACHMENTS.filter((a) => visible.has(a) && doc.attachment_counts[a] > 0),
  };
  legendFor(map).update({ finds: { ...shownFinds, color: algaeColor(doc.group) } });
}

/** What the key says about the finds on the map (its colour follows the theme). */
let shownFinds: { name: string; kinds: Attachment[] } | null = null;
/** Whether the pin is on the map, for the key. */
let pinShown = false;

/** Tell the key whether a pin is on the map (main.ts sets the marker). */
export function setPinInLegend(map: maplibregl.Map, shown: boolean): void {
  pinShown = shown;
  legendFor(map).update({ pin: shown ? pinColor() : null });
}

/** Repaint the layers in the colours of the current theme (map.ts calls it
 * when the OS switches between light and dark). */
export function restyleLayers(map: maplibregl.Map): void {
  const dark = prefersDark();
  if (map.getLayer(OBS) && shownGroup) paintObservations(map, shownGroup);
  if (map.getLayer(RING)) map.setPaintProperty(RING, "line-color", pinColor(dark));
  if (map.getLayer(RISK)) {
    map.setPaintProperty(RISK, "circle-stroke-color", haloColor(dark));
    map.setPaintProperty(RISK, "circle-color", riskColorExpression(dark));
  }
  legendFor(map).update({
    finds: shownFinds && shownGroup ? { ...shownFinds, color: algaeColor(shownGroup, dark) } : null,
    pin: pinShown ? pinColor(dark) : null,
    risk: riskLegend(dark),
  });
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

/** Reframe for a species just opened, inside the part of the map the sheet or
 * sidebar leaves uncovered (camera.ts): a find under the sheet does not count
 * as in view, and the new frame keeps clear of it. */
export function frameToNearest(map: maplibregl.Map, points: [number, number][]): void {
  const pad = mapInsets(map);
  // A find right at the edge of the uncovered map is easily missed: it counts
  // as in view only some way inside it.
  const EDGE = 24;
  const inner = {
    top: pad.top + EDGE,
    right: pad.right + EDGE,
    bottom: pad.bottom + EDGE,
    left: pad.left + EDGE,
  };
  const framing = framingForNearest(
    { center: visibleCenter(map, pad), zoom: map.getZoom(), contains: visibleTest(map, inner) },
    points,
  );
  if (!framing) return;
  fitCamera(map, framing.bounds, { maxZoom: framing.maxZoom, padding: pad });
}

export function clearObservations(map: maplibregl.Map): void {
  if (map.getLayer(OBS)) map.removeLayer(OBS);
  if (map.getSource(OBS)) map.removeSource(OBS);
  shownGroup = null;
  shownFinds = null;
  legendFor(map).update({ finds: null });
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
  const inside = items.filter((i) => i.distanceM <= radiusM);
  const points: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: inside.map((i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [i.lon, i.lat] },
      properties: { g: i.group, title: i.title },
    })),
  };
  const ring: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [circlePolygon(pin, radiusM)],
  };
  const dark = prefersDark();
  if (setGeoJson(map, RING, ring)) {
    map.addLayer({
      id: RING,
      type: "line",
      source: RING,
      paint: { "line-color": pinColor(dark), "line-width": 2, "line-dasharray": [2, 1.5] },
    });
  }
  if (setGeoJson(map, RISK, points)) {
    map.addLayer({
      id: RISK,
      type: "circle",
      source: RISK,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 14, 7.5],
        "circle-color": riskColorExpression(dark),
        "circle-stroke-width": 1.5,
        "circle-stroke-color": haloColor(dark),
      },
    });
  }
  const present = new Set(inside.map((i) => i.group));
  shownRisk = { radiusM, groups: [...present] as GroupKey[] };
  legendFor(map).update({ risk: riskLegend(dark) });
}

export function clearRisk(map: maplibregl.Map): void {
  for (const id of [RISK, RING]) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  shownRisk = null;
  legendFor(map).update({ risk: null });
}
