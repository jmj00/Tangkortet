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
  tørtVedLavvande: { group: "shoal", label: "Tørlægges ved lavvande" },
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
  /** A water's shore: its rings without the edges along the names cells'
   * grid lines, where the pipeline cut it (a cut is no shore, and a concave
   * bay cut by a cell leaves a zero-width sliver along the cut, far inland).
   * Distances are measured to these; null for anything else. */
  shore: LonLat[][] | null;
}

/** Whether a segment lies along one grid line of a `deg` grid. */
function onGridLine(a: LonLat, b: LonLat, deg: number): boolean {
  const on = (v: number): boolean => Math.abs(v / deg - Math.round(v / deg)) < 1e-6;
  return (a[0] === b[0] && on(a[0])) || (a[1] === b[1] && on(a[1]));
}

/** The rings as lines, broken where an edge lies along a grid line. */
export function shoreLines(rings: readonly LonLat[][], deg: number): LonLat[][] {
  const out: LonLat[][] = [];
  for (const ring of rings) {
    let run: LonLat[] = [];
    for (let i = 0; i + 1 < ring.length; i++) {
      if (deg > 0 && onGridLine(ring[i], ring[i + 1], deg)) {
        if (run.length >= 2) out.push(run);
        run = [];
        continue;
      }
      if (run.length === 0) run.push(ring[i]);
      run.push(ring[i + 1]);
    }
    if (run.length >= 2) out.push(run);
  }
  return out;
}

/** Every name in the cells. A water is clipped to each cell, so its pieces
 * all stay (one id); anything else lies whole in every cell it touches and
 * is counted once. `cellDeg`: the cells' size (NamesIndex.cell_deg), so the
 * cuts along the cell edges are left out of a water's shore. */
export function cellNames(cells: readonly NameCell[], cellDeg = 0): NamedPlace[] {
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
        shore: group === "water" && type === "a" ? shoreLines(rings, cellDeg) : null,
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

/** Metres from the pin to the place; 0 inside an area. A water is measured
 * to its shore (NamedPlace.shore), not to where a cell cut it. */
export function nameDistance(p: NamedPlace, pin: LonLat): number {
  if (p.type !== "a") return featureDistance({ type: p.type, coords: p.coords }, pin);
  if (inRings(p.rings, pin)) return 0;
  let best = Infinity;
  for (const line of p.shore ?? p.rings)
    best = Math.min(best, featureDistance({ type: "l", coords: line }, pin));
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
  /** The names of the landform areas the pin is inside (an island, a
   * peninsula, a næs on it), for "På Helgenæs". */
  onLandforms: string[];
}

/** The water the pin is in (the smallest, so "Kalø Vig" before "Århus
 * Bugt"), else, of the waters within WATER_NEAR_M, the smallest of those at
 * most SAME_PLACE_M further than the nearest (by Egå: Kalø Vig, not
 * Kattegat, whose shore there is the same). */
export function waterAt(places: readonly NamedPlace[], pin: LonLat): WaterName | null {
  let inside: NamedPlace | null = null;
  const hits: NameHit[] = [];
  for (const p of places) {
    if (p.group !== "water") continue;
    if (inRings(p.rings, pin)) {
      if (!inside || p.areaHa < inside.areaHa) inside = p;
      continue;
    }
    if (inside) continue;
    const d = nameDistance(p, pin);
    if (d <= WATER_NEAR_M) hits.push({ place: p, distanceM: d });
  }
  if (inside) return { name: inside.name, kind: inside.kind, inside: true, distanceM: 0 };
  const nearest = Math.min(...hits.map((h) => h.distanceM));
  const near = hits
    .filter((h) => h.distanceM <= nearest + SAME_PLACE_M)
    .sort((a, b) => a.place.areaHa - b.place.areaHa || a.distanceM - b.distanceM)[0];
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
    onLandforms: places
      .filter((p) => p.group === "landform" && p.type === "a" && inRings(p.rings, pin))
      .map((p) => p.name),
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
  /** The row shows an official name (Danske Stednavne). */
  official: boolean;
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
  // the name first, then what the register says it is ("Keldsand ·
  // tørlægges ved lavvande"): a fact about the water, never a way out
  if (hit.place.group === "shoal")
    return {
      label: hit.place.name,
      name: label.toLocaleLowerCase("da"),
      joiner: " · ",
      distanceM: hit.distanceM,
      official: true,
    };
  return {
    label: hit.place.name,
    name: namesItsKind(hit.place.name, label) ? null : label.toLocaleLowerCase("da"),
    joiner: " · ",
    distanceM: hit.distanceM,
    official: true,
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
      return {
        label,
        name: match.h.place.name,
        joiner: " – ",
        distanceM: n.distanceM,
        official: true,
      };
    }
    return {
      label: n.label,
      name: shownName(n.feature),
      joiner: " – ",
      distanceM: n.distanceM,
      official: false,
    };
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
          official: true,
        });
    }
    if (names.landform) rows.push(placeRow(names.landform));
    if (names.shoal) rows.push(placeRow(names.shoal));
  }
  return rows.sort((a, b) => a.distanceM - b.distanceM);
}

/** "her" (the pin is inside it), "ved nålen" (at it), else the distance. */
export function distText(m: number): string {
  if (m === 0) return "her";
  return m < EDGE_M ? "ved nålen" : metres(m);
}

/** Whether the card shows an official name: in its water line or a row. */
export function showsOfficialName(
  s: Pick<CoastSummary, "water" | "names">,
  rows: readonly ShoreRow[],
): boolean {
  const n = s.names?.water;
  const line = waterLine(s);
  return rows.some((r) => r.official) || (n != null && line != null && line.includes(n.name));
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

/** The pin is on the island or peninsula `name`: inside its outline in the
 * names cells, and not in the water by OpenStreetMap's coastline ("På
 * Helgenæs"; not a pin in Ebeltoft Vig, whatever a circle round Helgenæs
 * says). */
export function onNamedLand(s: Pick<CoastSummary, "water" | "names">, name: string): boolean {
  return (s.names?.onLandforms ?? []).includes(name) && !s.water?.inWater;
}

/** The pin is inside a landform's outline (an island, a næs): on land. */
export function onLandform(s: Pick<CoastSummary, "names">): boolean {
  const l = s.names?.landform;
  return l != null && l.distanceM === 0 && l.place.type === "a";
}

/** Further out than this, a pin in the water is named by the water. */
export const OFFSHORE_M = 200;
