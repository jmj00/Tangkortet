// "Where should I go?": when nothing has been found near the pin (say, at home
// in the middle of Jutland), the nearest places on the coast that do have
// finds. A spot is a coastal bathing site (placeindex.ts: public, reachable,
// on the sea) with finds within SPOT_RADIUS_M of it. Seaweed records inland
// (lakes, streams, records placed on a town) are never suggested. Spots are
// kept apart so they are different stretches of coast, not three beaches in
// a row. Pure, for testing; the species list draws them (speciespanel.ts).

import { distanceM } from "./geo";
import type { SpeciesDoc } from "./types";

export interface Spot {
  lngLat: [number, number];
  /** From the pin to the spot. */
  distanceM: number;
  /** Species found within SPOT_RADIUS_M of the spot. */
  species: number;
  /** Of those, species with at least one attached find there. */
  attached: number;
}

/** Finds this close to a beach count as found there. */
export const SPOT_RADIUS_M = 2_500;
/** How far apart two suggested spots must be. */
export const SPOT_SPACING_M = 8_000;

interface Find {
  lngLat: [number, number];
  doc: number;
  attached: boolean;
}

/** Finds bucketed by a coarse grid, so "finds near a beach" looks only at the
 * cells round it, not at all ten thousand finds per beach. */
const CELL_LAT = 0.05; // about 5.5 km
const CELL_LON = 0.08; // about 5 km at Danish latitudes

function cellKey(lon: number, lat: number): string {
  return `${Math.floor(lon / CELL_LON)},${Math.floor(lat / CELL_LAT)}`;
}

function bucket(docs: readonly SpeciesDoc[]): Map<string, Find[]> {
  const cells = new Map<string, Find[]>();
  docs.forEach((doc, i) => {
    for (const [lon, lat, , a] of doc.observations) {
      const key = cellKey(lon, lat);
      let list = cells.get(key);
      if (!list) cells.set(key, (list = []));
      list.push({ lngLat: [lon, lat], doc: i, attached: a === 0 });
    }
  });
  return cells;
}

function findsAround(cells: Map<string, Find[]>, [lon, lat]: [number, number]): Find[] {
  const cx = Math.floor(lon / CELL_LON);
  const cy = Math.floor(lat / CELL_LAT);
  const out: Find[] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (const f of cells.get(`${cx + dx},${cy + dy}`) ?? [])
        if (distanceM([lon, lat], f.lngLat) <= SPOT_RADIUS_M) out.push(f);
  return out;
}

/**
 * The `count` nearest beaches (`[lon, lat]` each) with finds near them,
 * nearest first. Without beaches (the place list could not be fetched), the
 * nearest finds themselves are the spots.
 */
export function nearestSpots(
  docs: readonly SpeciesDoc[],
  pin: [number, number],
  beaches: readonly [number, number][] | null,
  count = 3,
): Spot[] {
  const cells = bucket(docs);
  const candidates: [number, number][] = beaches
    ? [...beaches]
    : [...cells.values()].flat().map((f) => f.lngLat);
  const byDistance = candidates
    .map((lngLat) => ({ lngLat, d: distanceM(pin, lngLat) }))
    .sort((a, b) => a.d - b.d);
  const spots: Spot[] = [];
  for (const { lngLat, d } of byDistance) {
    if (spots.length >= count) break;
    if (spots.some((s) => distanceM(s.lngLat, lngLat) < SPOT_SPACING_M)) continue;
    const here = findsAround(cells, lngLat);
    if (here.length === 0) continue; // a beach with nothing recorded near it
    spots.push({
      lngLat,
      distanceM: d,
      species: new Set(here.map((f) => f.doc)).size,
      attached: new Set(here.filter((f) => f.attached).map((f) => f.doc)).size,
    });
  }
  return spots;
}

/** The distance from the pin to the nearest find of any species, or null. */
export function nearestFindM(docs: readonly SpeciesDoc[], pin: [number, number]): number | null {
  let best: number | null = null;
  for (const doc of docs) {
    for (const [lon, lat] of doc.observations) {
      const d = distanceM(pin, [lon, lat]);
      if (best === null || d < best) best = d;
    }
  }
  return best;
}
