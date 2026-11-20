// Official place names along the coast, from Danske Stednavne
// (Klimadatastyrelsen, CC BY 4.0; pipeline/ingest/stednavne.py): the water
// the pin is in or by ("I Århus Bugt", "Kalø Vig 40 m væk"), the nearest
// landform ("Næsset 400 m", "Helgenæs"), shallow stones, and the official
// name and kind of a beach or harbour OpenStreetMap has left unnamed.
//
// Pure logic, like coast.ts: decoding the names cells and the "Kysten her"
// rows. Fetching is in data.ts (loadNameCell), the card in riskpanel.ts and
// tapcard.ts. Names say where a place is and what it is called, nothing
// more: shallow stones are a feature of the shore, never a claim that
// anything there is good to eat or safe.

import {
  COAST_RADIUS_M,
  EDGE_M,
  decode,
  featureDistance,
  metres,
  shownName,
  waterText,
  type CoastSummary,
  type LonLat,
  type Nearby,
} from "./coast";
import { bboxAround, cellKeys } from "./geo";
import type { NameCell, NameRow, NamesIndex } from "./types";

/** Which names the card looks for, and how far. */
export const LANDFORM_RADIUS_M = 1500;
export const SHOAL_RADIUS_M = 1000;
/** A water this near a pin on land is the water "by" it. */
export const WATER_NEAR_M = 1000;
/** An official beach or harbour this near an OpenStreetMap one is the same place. */
export const SAME_PLACE_M = 200;

export type NameGroup = "beach" | "shore" | "harbour" | "landform" | "water" | "shoal" | "bath";

/** The Stednavne type of each kind (pipeline GROUPS), and the Danish word for it. */
export const KINDS: Record<string, { group: NameGroup; label: string }> = {
  strand: { group: "beach", label: "Strand" },
  marsk: { group: "shore", label: "Marsk" },
  sandKlit: { group: "shore", label: "Klit" },
  klippeIOverfladen: { group: "shore", label: "Klippekyst" },
  lystbådehavn: { group: "harbour", label: "Lystbådehavn" },
  fiskerihavn: { group: "harbour", label: "Fiskerihavn" },
  // a ferry or commercial port: "Havn" reads better than "Trafikhavn"
  trafikhavn: { group: "harbour", label: "Havn" },
  pynt: { group: "landform", label: "Pynt" },
  næs: { group: "landform", label: "Næs" },
  odde: { group: "landform", label: "Odde" },
  klint: { group: "landform", label: "Klint" },
  skræntNaturlig: { group: "landform", label: "Skrænt" },
  skær: { group: "landform", label: "Skær" },
  tange: { group: "landform", label: "Tange" },
  hage: { group: "landform", label: "Hage" },
  halvø: { group: "landform", label: "Halvø" },
  ø: { group: "landform", label: "Ø" },
  bugt: { group: "water", label: "Bugt" },
  fjord: { group: "water", label: "Fjord" },
  sund: { group: "water", label: "Sund" },
  nor: { group: "water", label: "Nor" },
  bredning: { group: "water", label: "Bredning" },
  løb: { group: "water", label: "Løb" },
  hav: { group: "water", label: "Hav" },
  tørtVedLavvande: { group: "shoal", label: "Tørt ved lavvande" },
  overskylledeSten: { group: "shoal", label: "Overskyllede sten" },
  havbad: { group: "bath", label: "Havbad" },
};

export function kindInfo(kind: string): { group: NameGroup; label: string } {
  return KINDS[kind] ?? { group: "shore", label: kind };
}

export interface NamedPlace {
  id: number;
  kind: string;
  group: NameGroup;
  name: string;
  type: "p" | "l" | "a";
  /** A point or line; for an area, its rings (outer rings and holes, even-odd). */
  coords: LonLat[];
  rings: LonLat[][];
  /** The whole area (hectares), for "the smallest water the pin is in". */
  areaHa: number;
}

/** Every name in the cells. A water is clipped to each cell, so its pieces
 * all stay (one id); anything else lies whole in every cell it touches and
 * is counted once. */
export function cellNames(cells: readonly NameCell[]): NamedPlace[] {
  const seen = new Set<number>();
  const out: NamedPlace[] = [];
  for (const cell of cells) {
    for (const row of cell.features ?? []) {
      const [id, kind, type, coords, name, areaHa] = row as NameRow;
      const group = kindInfo(kind).group;
      if (group !== "water") {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const rings = type === "a" ? (coords as number[][]).map(decode) : [];
      out.push({
        id,
        kind,
        group,
        name,
        type,
        coords: type === "a" ? [] : decode(coords as number[]),
        rings,
        areaHa: areaHa ?? 0,
      });
    }
  }
  return out;
}

/** Even-odd over all rings. */
export function inRings(rings: readonly LonLat[][], [x, y]: LonLat): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Metres from the pin to the place; 0 inside an area. */
export function nameDistance(p: NamedPlace, pin: LonLat): number {
  if (p.type !== "a") return featureDistance({ type: p.type, coords: p.coords }, pin);
  if (inRings(p.rings, pin)) return 0;
  let best = Infinity;
  for (const ring of p.rings)
    best = Math.min(best, featureDistance({ type: "l", coords: ring }, pin));
  return best;
}

export interface WaterName {
  name: string;
  kind: string;
  /** The pin lies inside the water as the register draws it. */
  inside: boolean;
  /** Metres to its edge (0 inside). */
  distanceM: number;
}

export interface NameHit {
  place: NamedPlace;
  distanceM: number;
}

export interface NamesSummary {
  water: WaterName | null;
  landform: NameHit | null;
  shoal: NameHit | null;
  /** Beaches and harbours within COAST_RADIUS_M, nearest first. */
  beaches: NameHit[];
  harbours: NameHit[];
}

/** The water the pin is in (the smallest, so "Kalø Vig" before "Århus
 * Bugt"), else the nearest within WATER_NEAR_M. */
export function waterAt(places: readonly NamedPlace[], pin: LonLat): WaterName | null {
  let inside: NamedPlace | null = null;
  let near: NameHit | null = null;
  for (const p of places) {
    if (p.group !== "water") continue;
    if (inRings(p.rings, pin)) {
      if (!inside || p.areaHa < inside.areaHa) inside = p;
      continue;
    }
    if (inside) continue;
    const d = nameDistance(p, pin);
    if (d <= WATER_NEAR_M && (!near || d < near.distanceM)) near = { place: p, distanceM: d };
  }
  if (inside) return { name: inside.name, kind: inside.kind, inside: true, distanceM: 0 };
  if (near)
    return {
      name: near.place.name,
      kind: near.place.kind,
      inside: false,
      distanceM: near.distanceM,
    };
  return null;
}

/** The nearest place of a group within `radiusM`; inside several areas, the
 * smallest (a næs on a halvø before the halvø). */
function nearest(
  places: readonly NamedPlace[],
  pin: LonLat,
  group: NameGroup,
  radiusM: number,
): NameHit[] {
  const hits: NameHit[] = [];
  for (const p of places) {
    if (p.group !== group) continue;
    const d = nameDistance(p, pin);
    if (d <= radiusM) hits.push({ place: p, distanceM: d });
  }
  return hits.sort(
    (a, b) =>
      a.distanceM - b.distanceM ||
      (a.distanceM === 0 ? a.place.areaHa - b.place.areaHa : 0) ||
      a.place.name.localeCompare(b.place.name, "da"),
  );
}

export function summarizeNames(places: readonly NamedPlace[], pin: LonLat): NamesSummary {
  return {
    water: waterAt(places, pin),
    landform: nearest(places, pin, "landform", LANDFORM_RADIUS_M)[0] ?? null,
    shoal: nearest(places, pin, "shoal", SHOAL_RADIUS_M)[0] ?? null,
    beaches: nearest(places, pin, "beach", COAST_RADIUS_M),
    harbours: nearest(places, pin, "harbour", COAST_RADIUS_M),
  };
}

/** The cells to fetch for a pin, or null when the data does not cover it. */
export function nameCellsFor(index: NamesIndex, pin: LonLat): string[] | null {
  const keys = cellKeys(bboxAround(pin, LANDFORM_RADIUS_M), index.cell_deg);
  if (index.coverage && keys.some((k) => !index.coverage?.includes(k))) return null;
  const available = new Set(index.cells);
  return keys.filter((k) => available.has(k));
}

// --- the rows of "Kysten her" ---

/** One row of the card: "Sandstrand – Egå Strand 150 m", "Næsset · pynt 400 m". */
export interface ShoreRow {
  /** The first, bold part: a kind ("Lystbådehavn") or, for a landform or
   * shallow stones, the name ("Helgenæs"). */
  label: string;
  /** After the label: " – Egå Marina", or the kind in small letters (" · halvø"). */
  name: string | null;
  /** How `name` is joined on: a name after a dash, a kind after a dot. */
  joiner: " – " | " · ";
  distanceM: number;
}

/** Whether the name already says what it is ("Kalø Vig" is not; "Helgenæs"
 * says næs, "Mandø" says ø, "Rønnen Pynt" says pynt). */
function namesItsKind(name: string, label: string): boolean {
  const n = name.toLocaleLowerCase("da");
  const l = label.toLocaleLowerCase("da");
  return n.endsWith(l) || n.includes(`${l} `);
}

function placeRow(hit: NameHit): ShoreRow {
  const { label } = kindInfo(hit.place.kind);
  if (hit.place.group === "shoal")
    return { label, name: hit.place.name, joiner: " – ", distanceM: hit.distanceM };
  return {
    label: hit.place.name,
    name: namesItsKind(hit.place.name, label) ? null : label.toLocaleLowerCase("da"),
    joiner: " · ",
    distanceM: hit.distanceM,
  };
}

/** Metres between an OpenStreetMap feature and an official place (0 when
 * they overlap: a corner of one inside the other). */
function apart(n: Nearby, p: NamedPlace): number {
  const coords = n.feature.coords;
  let best = Infinity;
  for (const c of coords) best = Math.min(best, nameDistance(p, c));
  if (p.type === "a")
    for (const ring of p.rings)
      for (const c of ring) best = Math.min(best, featureDistance(n.feature, c));
  else best = Math.min(best, featureDistance(n.feature, p.coords[0]));
  return best;
}

const OSM_GROUP: Partial<Record<Nearby["feature"]["kind"], NameGroup>> = {
  beach: "beach",
  harbour: "harbour",
  marina: "harbour",
};

/**
 * The card's rows: the OpenStreetMap features (coast.ts nearbyFeatures),
 * a beach or harbour with its official name when one lies within
 * SAME_PLACE_M of it (and a harbour with its official kind: Lystbådehavn,
 * Fiskerihavn, Havn), an official beach or harbour OpenStreetMap lacks, the
 * nearest landform and the nearest shallow stones; nearest first.
 */
export function shoreRows(s: CoastSummary): ShoreRow[] {
  const names = s.names;
  const used = new Set<number>();
  const rows: ShoreRow[] = s.nearby.map((n) => {
    const group = OSM_GROUP[n.feature.kind];
    const candidates = group === "beach" ? names?.beaches : group ? names?.harbours : undefined;
    const match = candidates
      ?.filter((h) => !used.has(h.place.id))
      .map((h) => ({ h, d: apart(n, h.place) }))
      .filter((m) => m.d <= SAME_PLACE_M)
      .sort((a, b) => a.d - b.d)[0];
    if (match) {
      used.add(match.h.place.id);
      const label = group === "harbour" ? kindInfo(match.h.place.kind).label : n.label;
      return { label, name: match.h.place.name, joiner: " – ", distanceM: n.distanceM };
    }
    return { label: n.label, name: shownName(n.feature), joiner: " – ", distanceM: n.distanceM };
  });
  if (names) {
    const has = (group: NameGroup): boolean =>
      s.nearby.some((n) => OSM_GROUP[n.feature.kind] === group);
    for (const [group, hits] of [
      ["beach", names.beaches],
      ["harbour", names.harbours],
    ] as const) {
      const hit = has(group) ? undefined : hits.find((h) => !used.has(h.place.id));
      if (hit)
        rows.push({
          label: kindInfo(hit.place.kind).label,
          name: hit.place.name,
          joiner: " – ",
          distanceM: hit.distanceM,
        });
    }
    if (names.landform) rows.push(placeRow(names.landform));
    if (names.shoal) rows.push(placeRow(names.shoal));
  }
  return rows.sort((a, b) => a.distanceM - b.distanceM);
}

/** "ved nålen" (at or inside it), else the distance. */
export function distText(m: number): string {
  return m < EDGE_M ? "ved nålen" : metres(m);
}

/** "I Århus Bugt, 120 m fra kysten", "Kalø Vig 40 m væk", "I vandet, 120 m
 * fra kysten" (no name), "I Århus Bugt" (no coastline data). */
export function waterLine(s: Pick<CoastSummary, "water" | "names">): string | null {
  const w = s.water;
  const n = s.names?.water ?? null;
  if (!n) return w ? waterText(w) : null;
  // on an island or a headland the register draws the water over (Mandø in
  // Vadehavet): land, whatever the water's outline says
  if (onLandform(s) && !w?.inWater) return w ? waterText(w) : null;
  if (!w) return n.inside ? `I ${n.name}` : `${n.name} ${metres(n.distanceM)} væk`;
  if (w.inWater || w.distanceM < EDGE_M) {
    if (!n.inside && n.distanceM > SAME_PLACE_M) return waterText(w);
    if (w.distanceM < EDGE_M) return `Ved vandkanten, ${n.name}`;
    return `I ${n.name}, ${metres(w.distanceM)} fra kysten`;
  }
  // on land: the water the register names, when it is the water nearest
  if (n.inside || Math.abs(n.distanceM - w.distanceM) <= SAME_PLACE_M)
    return `${n.name} ${metres(w.distanceM)} væk`;
  return waterText(w);
}

/** One line for the pin's card: the water, then up to `max` rows.
 * "I Århus Bugt, 1,2 km fra kysten · Næsset · pynt 400 m". */
export function shoreLine(s: CoastSummary, max = 2): string | null {
  const parts: string[] = [];
  const water = waterLine(s);
  if (water) parts.push(water);
  for (const r of shoreRows(s).slice(0, max))
    parts.push(`${r.label}${r.name ? `${r.joiner}${r.name}` : ""} ${distText(r.distanceM)}`);
  return parts.length ? parts.join(" · ") : null;
}

/** The water to name the pin by in its card ("I Århus Bugt"): only when it
 * is out in the water (not by the shore, where a beach or town says more). */
export function seaName(s: CoastSummary | null | undefined): string | null {
  const n = s?.names?.water;
  if (!n?.inside || !s || onLandform(s)) return null;
  const w = s?.water;
  if (w && (!w.inWater || w.distanceM < OFFSHORE_M)) return null;
  return `I ${n.name}`;
}

/** The pin is inside a landform's outline (an island, a næs): on land. */
export function onLandform(s: Pick<CoastSummary, "names">): boolean {
  const l = s.names?.landform;
  return l != null && l.distanceM === 0 && l.place.type === "a";
}

/** Further out than this, a pin in the water is named by the water. */
export const OFFSHORE_M = 200;
