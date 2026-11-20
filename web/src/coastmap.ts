// The coast on the map from zoom 13 (OpenStreetMap, ODbL; coast.ts): beaches
// and shore sand as a sandy fill, salt marsh and tidal flats as faint green
// and grey-brown fills, harbours and marinas as a dashed outline, and piers,
// breakwaters, groynes and cliffs as lines. Subtle on the muted basemap, and
// always under the finds, the risk ring and the risk markers.
//
// Only the cells in view are fetched (data.ts loadCoastCell, cached), once
// the map has stopped moving at zoom 12.5 or closer. The map key gets a
// "Kysten" section for the kinds drawn in view.

import type maplibregl from "maplibre-gl";
import { cellFeatures, type CoastFeature } from "./coast";
import { loadCoastCell } from "./data";
import { cellKeys } from "./geo";
import { prefersDark } from "./layers";
import { legendFor, type LegendCoastItem } from "./maplegend";
import type { CoastIndex, CoastKind } from "./types";

export const COAST_MIN_ZOOM = 13;
/** Start fetching a little before the layers show, so they are there at 13. */
const FETCH_ZOOM = 12.5;
/** More cells than this in view: too far out to draw anyway. */
const MAX_CELLS = 9;

const SOURCE = "coast";
const FILL = "coast-fill";
const EDGE = "coast-edge";
const HARBOUR = "coast-harbour";
const LINES = "coast-lines";
const CLIFF = "coast-cliff";
export const COAST_LAYERS = [FILL, EDGE, HARBOUR, LINES, CLIFF] as const;
/** The app's own layers, which the coast stays under (layers.ts). */
const ABOVE = ["observations", "risk-radius", "risk"];

interface Palette {
  sand: string;
  sandEdge: string;
  saltmarsh: string;
  tidalflat: string;
  harbour: string;
  pier: string;
  groyne: string;
  cliff: string;
  /** fill opacities */
  sandOpacity: number;
  wetOpacity: number;
}

/** Light: on the desaturated map (land ~#f1efe9, water ~#b6cacf). Dark: on
 * the inverted one (land ~#1d2324, water ~#3a4e54). Lines reach 3:1 against
 * both land and water; fills stay faint and get an edge. */
export const COAST_PALETTE: Record<"light" | "dark", Palette> = {
  light: {
    sand: "#e2c06a",
    sandEdge: "#a57f22",
    saltmarsh: "#5f9a4c",
    tidalflat: "#8c7a5a",
    harbour: "#2f5f86",
    pier: "#4a4a52",
    groyne: "#7a5230",
    cliff: "#9c3f1f",
    sandOpacity: 0.45,
    wetOpacity: 0.28,
  },
  dark: {
    sand: "#d9b866",
    sandEdge: "#e6c97e",
    saltmarsh: "#7fc06a",
    tidalflat: "#c2ad86",
    harbour: "#8fb8dc",
    pier: "#d8d8e0",
    groyne: "#d9a877",
    cliff: "#ef8f6a",
    sandOpacity: 0.28,
    wetOpacity: 0.22,
  },
};

const palette = (dark = prefersDark()): Palette => COAST_PALETTE[dark ? "dark" : "light"];

type Expr = maplibregl.ExpressionSpecification;

function fillColor(p: Palette): Expr {
  return [
    "match",
    ["get", "k"],
    "saltmarsh",
    p.saltmarsh,
    "tidalflat",
    p.tidalflat,
    p.sand,
  ] as Expr;
}

function fillOpacity(p: Palette): Expr {
  return ["match", ["get", "k"], ["saltmarsh", "tidalflat"], p.wetOpacity, p.sandOpacity] as Expr;
}

function edgeColor(p: Palette): Expr {
  return [
    "match",
    ["get", "k"],
    "saltmarsh",
    p.saltmarsh,
    "tidalflat",
    p.tidalflat,
    p.sandEdge,
  ] as Expr;
}

function lineColor(p: Palette): Expr {
  return ["match", ["get", "k"], "groyne", p.groyne, p.pier] as Expr;
}

/** GeoJSON for the map: areas as polygons, lines as lines; points (a beach
 * mapped as a single node) are left to the pin's card. */
export function toGeoJson(features: readonly CoastFeature[]): GeoJSON.FeatureCollection {
  const out: GeoJSON.Feature[] = [];
  for (const f of features) {
    if (f.kind === "coastline" || f.type === "p") continue;
    const properties = { k: f.kind, n: f.name ?? "" };
    if (f.type === "a") {
      out.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [f.coords] },
        properties,
      });
    } else {
      out.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: f.coords },
        properties,
      });
    }
  }
  return { type: "FeatureCollection", features: out };
}

/** The key's rows, in a fixed order, for the kinds in `kinds`. */
export function legendItems(
  kinds: ReadonlySet<CoastKind>,
  dark = prefersDark(),
): LegendCoastItem[] {
  const p = palette(dark);
  const rows: (LegendCoastItem & { when: CoastKind[] })[] = [
    {
      key: "sand",
      label: "Strand og sand",
      color: p.sand,
      edge: p.sandEdge,
      style: "fill",
      when: ["beach", "sand"],
    },
    {
      key: "saltmarsh",
      label: "Strandeng",
      color: p.saltmarsh,
      edge: p.saltmarsh,
      style: "fill",
      when: ["saltmarsh"],
    },
    {
      key: "tidalflat",
      label: "Vadeflade",
      color: p.tidalflat,
      edge: p.tidalflat,
      style: "fill",
      when: ["tidalflat"],
    },
    {
      key: "harbour",
      label: "Havn, lystbådehavn",
      color: p.harbour,
      style: "dash",
      when: ["harbour", "marina"],
    },
    { key: "pier", label: "Bro, mole", color: p.pier, style: "line", when: ["pier", "breakwater"] },
    { key: "groyne", label: "Høfde", color: p.groyne, style: "line", when: ["groyne"] },
    { key: "cliff", label: "Klint", color: p.cliff, style: "dots", when: ["cliff"] },
  ];
  return rows
    .filter((r) => r.when.some((k) => kinds.has(k)))
    .map((r): LegendCoastItem => ({
      key: r.key,
      label: r.label,
      color: r.color,
      edge: r.edge,
      style: r.style,
    }));
}

function addLayers(map: maplibregl.Map): void {
  const p = palette();
  const before = (): string | undefined => ABOVE.find((id) => map.getLayer(id));
  const add = (layer: maplibregl.LayerSpecification): void => {
    map.addLayer(layer, before());
  };
  const zoomWidth = (at13: number, at17: number): Expr =>
    ["interpolate", ["linear"], ["zoom"], 13, at13, 17, at17] as Expr;
  add({
    id: FILL,
    type: "fill",
    source: SOURCE,
    minzoom: COAST_MIN_ZOOM,
    filter: [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      ["in", ["get", "k"], ["literal", ["beach", "sand", "saltmarsh", "tidalflat"]]],
    ],
    paint: { "fill-color": fillColor(p), "fill-opacity": fillOpacity(p) },
  });
  add({
    id: EDGE,
    type: "line",
    source: SOURCE,
    minzoom: COAST_MIN_ZOOM,
    filter: [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      ["in", ["get", "k"], ["literal", ["beach", "sand", "saltmarsh", "tidalflat"]]],
    ],
    paint: { "line-color": edgeColor(p), "line-width": 0.8, "line-opacity": 0.75 },
  });
  add({
    id: HARBOUR,
    type: "line",
    source: SOURCE,
    minzoom: COAST_MIN_ZOOM,
    filter: ["in", ["get", "k"], ["literal", ["harbour", "marina"]]],
    paint: {
      "line-color": p.harbour,
      "line-width": zoomWidth(1.2, 2),
      "line-dasharray": [3, 2],
    },
  });
  add({
    id: LINES,
    type: "line",
    source: SOURCE,
    minzoom: COAST_MIN_ZOOM,
    filter: ["in", ["get", "k"], ["literal", ["pier", "groyne", "breakwater"]]],
    layout: { "line-cap": "round" },
    paint: {
      "line-color": lineColor(p),
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        13,
        ["match", ["get", "k"], "breakwater", 2.2, 1.6],
        17,
        ["match", ["get", "k"], "breakwater", 5, 3.5],
      ] as Expr,
    },
  });
  add({
    id: CLIFF,
    type: "line",
    source: SOURCE,
    minzoom: COAST_MIN_ZOOM,
    filter: ["==", ["get", "k"], "cliff"],
    layout: { "line-cap": "round" },
    paint: {
      "line-color": p.cliff,
      "line-width": zoomWidth(2, 3.5),
      "line-dasharray": [0.1, 2],
    },
  });
}

function repaint(map: maplibregl.Map): void {
  if (!map.getLayer(FILL)) return;
  const p = palette();
  map.setPaintProperty(FILL, "fill-color", fillColor(p));
  map.setPaintProperty(FILL, "fill-opacity", fillOpacity(p));
  map.setPaintProperty(EDGE, "line-color", edgeColor(p));
  map.setPaintProperty(HARBOUR, "line-color", p.harbour);
  map.setPaintProperty(LINES, "line-color", lineColor(p));
  map.setPaintProperty(CLIFF, "line-color", p.cliff);
}

type Bbox = [number, number, number, number];

function featureBbox(f: CoastFeature): Bbox {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of f.coords) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

const overlaps = (a: Bbox, b: Bbox): boolean =>
  a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Draw the coast on `map` (once the style is ready) and keep it to the
 * cells in view. */
export function initCoastMap(map: maplibregl.Map, index: CoastIndex | null | undefined): void {
  if (!index) return;
  const available = new Set(index.cells);
  const decoded = new Map<string, { feature: CoastFeature; bbox: Bbox }[]>();
  let shown = "";
  let request = 0;
  let kindsInView = new Set<CoastKind>();

  map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  addLayers(map);

  const pushLegend = (): void => {
    const visible = map.getZoom() >= COAST_MIN_ZOOM && kindsInView.size > 0;
    legendFor(map).update({ coast: visible ? legendItems(kindsInView) : null });
  };

  const update = async (): Promise<void> => {
    const id = ++request;
    if (map.getZoom() < FETCH_ZOOM) {
      kindsInView = new Set();
      pushLegend();
      return;
    }
    const b = map.getBounds();
    const view: Bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const keys = cellKeys(view, index.cell_deg).filter((k) => available.has(k));
    if (keys.length > MAX_CELLS) return;
    try {
      await Promise.all(
        keys
          .filter((k) => !decoded.has(k))
          .map(async (k) => {
            const cell = await loadCoastCell(k);
            decoded.set(
              k,
              cellFeatures([cell]).map((feature) => ({ feature, bbox: featureBbox(feature) })),
            );
          }),
      );
    } catch {
      return; // offline: the map simply has no coast layer; the next move tries again
    }
    if (id !== request) return;
    const signature = keys.join(",");
    if (signature !== shown) {
      shown = signature;
      const seen = new Set<string>();
      const features: CoastFeature[] = [];
      for (const k of keys) {
        for (const { feature } of decoded.get(k) ?? []) {
          // an area lies whole in every cell it touches; draw it once
          if (feature.type === "a") {
            if (seen.has(feature.id)) continue;
            seen.add(feature.id);
          }
          features.push(feature);
        }
      }
      (map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(toGeoJson(features));
    }
    kindsInView = new Set();
    for (const k of keys)
      for (const { feature, bbox } of decoded.get(k) ?? [])
        if (feature.kind !== "coastline" && feature.type !== "p" && overlaps(bbox, view))
          kindsInView.add(feature.kind);
    pushLegend();
  };

  map.on("moveend", () => void update());
  void update();

  globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    repaint(map);
    pushLegend();
  });
}
