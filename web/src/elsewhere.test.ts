import { describe, expect, it } from "vitest";

import { nearestFindM, nearestSpots, SPOT_SPACING_M } from "./elsewhere";
import { distanceM } from "./geo";
import type { ObservationRow, SpeciesDoc } from "./types";

const doc = (rows: ObservationRow[]): SpeciesDoc => ({ observations: rows }) as SpeciesDoc;
const row = (lon: number, lat: number, a: 0 | 1 | 2 = 0): ObservationRow => [
  lon,
  lat,
  2020,
  a,
  null,
  0,
];

// Silkeborg, inland; finds near Juelsminde (east coast) and Aarhus.
const home: [number, number] = [9.55, 56.17];
const juelsminde: [number, number] = [10.02, 55.71];
const aarhus: [number, number] = [10.22, 56.15];

describe("nearest spots with finds", () => {
  const docs = [
    doc([row(...aarhus), row(aarhus[0] + 0.005, aarhus[1], 1), row(...juelsminde)]),
    doc([row(aarhus[0] + 0.008, aarhus[1], 1), row(10.6, 56.2)]),
    doc([row(juelsminde[0] + 0.01, juelsminde[1])]),
  ];

  it("lists distinct spots, nearest first, with what was found there", () => {
    const spots = nearestSpots(docs, home, null);
    expect(spots.map((s) => s.lngLat)).toEqual([aarhus, juelsminde, [10.6, 56.2]]);
    expect(spots[0].distanceM).toBeCloseTo(distanceM(home, aarhus), 0);
    // Aarhus: species 0 (attached + drift) and species 1 (drift only)
    expect(spots[0]).toMatchObject({ species: 2, attached: 1 });
    expect(spots[1]).toMatchObject({ species: 2, attached: 2 });
  });

  it("never suggests two spots on the same stretch of coast", () => {
    const spots = nearestSpots(docs, home, null, 5);
    for (const a of spots)
      for (const b of spots)
        if (a !== b) expect(distanceM(a.lngLat, b.lngLat)).toBeGreaterThanOrEqual(SPOT_SPACING_M);
  });

  it("suggests beaches with finds near them, never an inland find", () => {
    const lake: [number, number] = [9.6, 56.15]; // a find in a lake near home
    const withLake = [...docs, doc([row(...lake)])];
    const beachAarhus: [number, number] = [aarhus[0] + 0.01, aarhus[1] + 0.005];
    const emptyBeach: [number, number] = [9.9, 56.0]; // nothing recorded near it
    const beachJuels: [number, number] = [juelsminde[0], juelsminde[1] + 0.01];
    const spots = nearestSpots(withLake, home, [emptyBeach, beachJuels, beachAarhus]);
    expect(spots.map((s) => s.lngLat)).toEqual([beachAarhus, beachJuels]);
    expect(spots[0]).toMatchObject({ species: 2, attached: 1 });
    expect(spots[0].distanceM).toBeCloseTo(distanceM(home, beachAarhus), 0);
  });

  it("has nothing to suggest without finds", () => {
    expect(nearestSpots([], home, null)).toEqual([]);
    expect(nearestFindM([], home)).toBeNull();
  });

  it("knows how far the nearest find is", () => {
    expect(nearestFindM(docs, home)).toBeCloseTo(distanceM(home, aarhus), 0);
  });
});
