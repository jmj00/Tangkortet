// "Kysten her": what the shore is like at the pin and how far it is to the
// water, from the OpenStreetMap coast cells (pipeline/ingest/coast.py, ODbL).
//
// Pure logic: decoding the cells, distances, the nearest feature of each kind
// and the Danish words for them. Fetching is in data.ts (loadCoastCell), the
// card in riskpanel.ts and tapcard.ts, the map layer in coastmap.ts.
//
// This describes the shore as it is mapped, nothing more: it never says that
// a place is good or safe to collect at.

import { bboxAround, cellKeys } from "./geo";
import type { CoastCell, CoastIndex, CoastKind, CoastRow } from "./types";

/** How far round the pin the card looks for features and for the water. */
export const COAST_RADIUS_M = 1000;
/** Closer than this the pin is at the water's edge (mapping is not more
 * precise than that). */
export const EDGE_M = 15;

const SCALE = 1e5;

export type LonLat = [number, number];

export interface CoastFeature {
  id: string;
  kind: CoastKind;
  /** point, line, or area (a closed outer ring) */
  type: "p" | "l" | "a";
  coords: LonLat[];
  name: string | null;
  detail: string | null;
}

/** `[x0, y0, dx1, dy1, ...]` in 1e-5 degrees -> lon/lat pairs. */
export function decode(deltas: readonly number[]): LonLat[] {
  const out: LonLat[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < deltas.length; i += 2) {
    x += deltas[i];
    y += deltas[i + 1];
    out.push([x / SCALE, y / SCALE]);
  }
  return out;
}

/** Every feature in the cells. Areas and points lie whole in each cell they
 * touch, so they are counted once by id; a line is split per cell, and its
 * pieces all stay. */
export function cellFeatures(cells: readonly CoastCell[]): CoastFeature[] {
  const seen = new Set<string>();
  const out: CoastFeature[] = [];
  for (const cell of cells) {
    for (const row of cell.features ?? []) {
      const [id, kind, type, coords, name, detail] = row as CoastRow;
      if (type !== "l") {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push({
        id,
        kind,
        type,
        coords: decode(coords),
        name: name ?? null,
        detail: detail ?? null,
      });
    }
  }
  return out;
}

export function coastlines(cells: readonly CoastCell[]): LonLat[][] {
  return cells.flatMap((c) => (c.coastline ?? []).map(decode));
}

// --- distances on a flat grid in metres around the pin (fine within a few km) ---

type XY = [number, number];

function projector(pin: LonLat): (p: LonLat) => XY {
  const ky = 111_320;
  const kx = ky * Math.cos((pin[1] * Math.PI) / 180);
  return (p) => [(p[0] - pin[0]) * kx, (p[1] - pin[1]) * ky];
}

/** Distance from the origin to segment ab, and where along it (0..1) the
 * nearest point lies. */
function toSegment(a: XY, b: XY): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2));
  return { d: Math.hypot(a[0] + t * dx, a[1] + t * dy), t };
}

/** Even-odd ray cast from the origin. */
function containsOrigin(ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Metres from the pin to a feature; 0 inside an area. */
export function featureDistance(f: CoastFeature, pin: LonLat): number {
  const proj = projector(pin);
  const pts = f.coords.map(proj);
  if (pts.length === 1) return Math.hypot(pts[0][0], pts[0][1]);
  if (f.type === "a" && containsOrigin(pts)) return 0;
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, toSegment(pts[i], pts[i + 1]).d);
  return best;
}

export interface Water {
  /** Metres to the nearest coastline. */
  distanceM: number;
  /** The pin is on the water side of it (OSM coastlines have land on the left). */
  inWater: boolean;
}

/** The nearest coastline, and which side of it the pin is on; null when none
 * is within `radiusM`. At a corner the side is judged against both edges
 * that meet there (their outward normals added up). */
export function nearestWater(
  lines: readonly LonLat[][],
  pin: LonLat,
  radiusM = COAST_RADIUS_M,
): Water | null {
  const proj = projector(pin);
  let best: { d: number; t: number; line: XY[]; i: number } | null = null;
  for (const line of lines) {
    const pts = line.map(proj);
    for (let i = 0; i + 1 < pts.length; i++) {
      const hit = toSegment(pts[i], pts[i + 1]);
      if (!best || hit.d < best.d) best = { ...hit, line: pts, i };
    }
  }
  if (!best || best.d > radiusM) return null;
  const { line, i, t } = best;
  // the water is to the right of a coastline: normal (dy, -dx)
  const right = (a: XY, b: XY): XY => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
  };
  // A closed line (an island) wraps round: its first vertex is also its last.
  const last = line.length - 1;
  const closed = last >= 3 && line[0][0] === line[last][0] && line[0][1] === line[last][1];
  let normal = right(line[i], line[i + 1]);
  let from = line[i];
  if (t <= 0) {
    const prev = i > 0 ? i - 1 : closed ? last - 1 : -1;
    if (prev >= 0) {
      const n = right(line[prev], line[prev + 1]);
      normal = [normal[0] + n[0], normal[1] + n[1]];
    }
  } else if (t >= 1) {
    from = line[i + 1];
    const next = i + 2 <= last ? i + 1 : closed ? 0 : -1;
    if (next >= 0) {
      const n = right(line[next], line[next + 1]);
      normal = [normal[0] + n[0], normal[1] + n[1]];
    }
  }
  // the pin is at the origin: its offset from the nearest point is -from
  const side = -from[0] * normal[0] + -from[1] * normal[1];
  return { distanceM: best.d, inWater: side > 0 };
}

// --- words ---

/** A beach's `surface` as a kind of beach; null when untagged or unusual
 * (then it is just "Strand"). Mixed values ("sand;gravel") go by the first. */
export function beachType(surface: string | null): "sand" | "grus" | "sten" | null {
  const first = (surface ?? "").toLowerCase().split(/[;,/]/)[0].trim();
  if (["sand", "fine_sand", "dirt/sand"].includes(first)) return "sand";
  if (["gravel", "fine_gravel", "compacted"].includes(first)) return "grus";
  if (
    ["pebblestone", "pebbles", "shingle", "stone", "stones", "rock", "rocks", "boulders"].includes(
      first,
    )
  )
    return "sten";
  return null;
}

const BEACH_LABEL = { sand: "Sandstrand", grus: "Grusstrand", sten: "Stenstrand" } as const;

const KIND_LABEL: Record<CoastKind, string> = {
  beach: "Strand",
  sand: "Sandområde",
  saltmarsh: "Strandeng",
  tidalflat: "Vadeflade",
  harbour: "Havn",
  marina: "Lystbådehavn",
  pier: "Bro",
  groyne: "Høfde",
  breakwater: "Mole",
  // natural=cliff is any steep drop; most Danish ones are low clay slopes
  cliff: "Skrænt",
  coastline: "Kystlinje",
};

/** "Sandstrand", "Badebro", "Høfde", ...; a cliff is a "Klint" only when its
 * name says so (Møns Klint, Stevns Klint), else a "Skrænt". */
export function kindLabel(
  f: Pick<CoastFeature, "kind" | "detail"> & { name?: string | null },
): string {
  if (f.kind === "cliff" && /klint/i.test(f.name ?? "")) return "Klint";
  if (f.kind === "beach") {
    const type = beachType(f.detail);
    return type ? BEACH_LABEL[type] : KIND_LABEL.beach;
  }
  if (f.kind === "pier" && f.detail === "bade") return "Badebro";
  return KIND_LABEL[f.kind];
}

/** Kinds whose names are worth showing; a pier or groyne name is usually a
 * number ("Bro 2", "Høfde 14"). */
const NAMED: readonly CoastKind[] = [
  "beach",
  "harbour",
  "marina",
  "tidalflat",
  "saltmarsh",
  "sand",
  "cliff",
];

export function shownName(f: CoastFeature): string | null {
  return NAMED.includes(f.kind) ? f.name : null;
}

/** "40 m", "1,2 km"; under 10 m reads "10 m" (mapping is not finer). */
export function metres(m: number): string {
  if (m < 995) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

/** "Vandet 40 m væk", "I vandet, 120 m fra kysten", "Ved vandkanten". */
export function waterText(w: Water): string {
  if (w.distanceM < EDGE_M) return "Ved vandkanten";
  if (w.inWater) return `I vandet, ${metres(w.distanceM)} fra kysten`;
  return `Vandet ${metres(w.distanceM)} væk`;
}

const info = (f: CoastFeature): number => (f.name ? 2 : 0) + (f.detail ? 1 : 0);

export interface Nearby {
  feature: CoastFeature;
  distanceM: number;
  label: string;
}

/** The nearest feature of each kind within `radiusM`, nearest first (one
 * beach, whatever its surface; one pier, bathing jetty or not). Sand says
 * little where a beach is mapped, so it is left out then. */
export function nearbyFeatures(
  features: readonly CoastFeature[],
  pin: LonLat,
  radiusM = COAST_RADIUS_M,
): Nearby[] {
  const best = new Map<CoastKind, Nearby>();
  for (const f of features) {
    if (f.kind === "coastline") continue;
    const d = featureDistance(f, pin);
    if (d > radiusM) continue;
    const known = best.get(f.kind);
    // as near (both under the pin): the one that says more, a name or a surface
    const better =
      !known || d < known.distanceM || (d === known.distanceM && info(f) > info(known.feature));
    if (better) best.set(f.kind, { feature: f, distanceM: d, label: kindLabel(f) });
  }
  let list = [...best.values()];
  if (list.some((n) => n.feature.kind === "beach"))
    list = list.filter((n) => n.feature.kind !== "sand");
  return list.sort((a, b) => a.distanceM - b.distanceM);
}

/** "Sandstrand 150 m", "Havn ved nålen" (inside it). */
export function nearbyText(n: Nearby): string {
  return `${n.label} ${n.distanceM < EDGE_M ? "ved nålen" : metres(n.distanceM)}`;
}

export interface CoastSummary {
  water: Water | null;
  nearby: Nearby[];
}

/** Shore that lies out in the sea, far from the mapped coastline: the
 * Wadden Sea flats are kilometres wide. */
const OFFSHORE_KINDS = new Set(["tidalflat", "saltmarsh"]);

/** The coast at the pin. Without a coastline within 1 km there is no coast
 * here, whatever else is mapped: a lake's beach or marina is not "Kysten her"
 * (the pipeline drops most of them; this catches the rest). The exception is
 * a pin on a tidal flat or salt marsh itself, which is the coast. */
export function summarize(cells: readonly CoastCell[], pin: LonLat): CoastSummary {
  const water = nearestWater(coastlines(cells), pin);
  const nearby = nearbyFeatures(cellFeatures(cells), pin);
  if (water) return { water, nearby };
  const onShore = nearby.some((n) => n.distanceM < EDGE_M && OFFSHORE_KINDS.has(n.feature.kind));
  return { water: null, nearby: onShore ? nearby : [] };
}

export const NONE_TEXT = `Ingen kyst inden for ${COAST_RADIUS_M / 1000} km`;

/** One line for the pin's card: the water first, then up to `max` features.
 * "Vandet 40 m væk · Badebro 80 m · Sandstrand 150 m". */
export function summaryLine(s: CoastSummary, max = 2): string {
  if (!s.water && s.nearby.length === 0) return NONE_TEXT;
  const parts = s.water ? [waterText(s.water)] : [];
  parts.push(...s.nearby.slice(0, max).map(nearbyText));
  return parts.join(" · ");
}

/** The cells to fetch for a pin, or null when the data does not cover it
 * (the committed dev sample covers only part of Denmark). */
export function cellsFor(index: CoastIndex, pin: LonLat): string[] | null {
  const keys = cellKeys(bboxAround(pin, COAST_RADIUS_M), index.cell_deg);
  if (index.coverage && keys.some((k) => !index.coverage?.includes(k))) return null;
  const available = new Set(index.cells);
  return keys.filter((k) => available.has(k));
}
