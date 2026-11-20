import { describe, expect, it } from "vitest";

import {
  beachType,
  cellFeatures,
  cellsFor,
  decode,
  featureDistance,
  kindLabel,
  metres,
  nearbyFeatures,
  nearestWater,
  NONE_TEXT,
  summarize,
  summaryLine,
  waterText,
  type CoastFeature,
  type LonLat,
} from "./coast";
import type { CoastCell, CoastIndex } from "./types";

/** 1e-5 degrees, delta-encoded, as the pipeline writes them. */
function enc(points: LonLat[]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (const [lon, lat] of points) {
    const x = Math.round(lon * 1e5);
    const y = Math.round(lat * 1e5);
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

// About 62 m per 0.001 degrees of longitude, 111 m per 0.001 of latitude.
const coastNorth: LonLat[] = [
  [10.2, 56.14],
  [10.2, 56.16],
]; // runs north: land to the west (left), water to the east

describe("decode", () => {
  it("undoes the pipeline's delta encoding", () => {
    expect(decode([1020000, 5615000, 1, -2])).toEqual([
      [10.2, 56.15],
      [10.20001, 56.14998],
    ]);
  });
});

describe("nearestWater", () => {
  it("tells land from water by the coastline's direction", () => {
    const land = nearestWater([coastNorth], [10.199, 56.15]);
    expect(land?.inWater).toBe(false);
    expect(land?.distanceM).toBeCloseTo(62, -1);
    const sea = nearestWater([coastNorth], [10.202, 56.15]);
    expect(sea?.inWater).toBe(true);
    expect(sea?.distanceM).toBeCloseTo(124, -1);
  });

  it("judges a corner against both edges", () => {
    // north, then east: land to the north-west (left of both edges), the
    // sea to the south-east
    const bend: LonLat[] = [
      [10.2, 56.14],
      [10.2, 56.15],
      [10.21, 56.15],
    ];
    expect(nearestWater([bend], [10.199, 56.151])?.inWater).toBe(false);
    expect(nearestWater([bend], [10.201, 56.149])?.inWater).toBe(true);
  });

  it("is null beyond the radius", () => {
    expect(nearestWater([coastNorth], [10.1, 56.15])).toBeNull();
    expect(nearestWater([], [10.1, 56.15])).toBeNull();
  });
});

describe("words", () => {
  it("names beaches by their surface only when it is tagged", () => {
    expect(beachType("sand")).toBe("sand");
    expect(beachType("pebblestone")).toBe("sten");
    expect(beachType("sand;gravel;stones")).toBe("sand");
    expect(beachType("gravel")).toBe("grus");
    expect(beachType("grass")).toBeNull();
    expect(beachType(null)).toBeNull();
    expect(kindLabel({ kind: "beach", detail: "boulders" })).toBe("Stenstrand");
    expect(kindLabel({ kind: "beach", detail: null })).toBe("Strand");
    expect(kindLabel({ kind: "pier", detail: "bade" })).toBe("Badebro");
    expect(kindLabel({ kind: "pier", detail: null })).toBe("Bro");
    expect(kindLabel({ kind: "groyne", detail: null })).toBe("Høfde");
    expect(kindLabel({ kind: "breakwater", detail: null })).toBe("Mole");
    expect(kindLabel({ kind: "saltmarsh", detail: null })).toBe("Strandeng");
    expect(kindLabel({ kind: "tidalflat", detail: null })).toBe("Vadeflade");
    expect(kindLabel({ kind: "marina", detail: null })).toBe("Lystbådehavn");
  });

  it("rounds distances to 10 m and says where the water is", () => {
    expect(metres(3)).toBe("10 m");
    expect(metres(144)).toBe("140 m");
    expect(metres(1234)).toBe("1,2 km");
    expect(waterText({ distanceM: 42, inWater: false })).toBe("Vandet 40 m væk");
    expect(waterText({ distanceM: 120, inWater: true })).toBe("I vandet, 120 m fra kysten");
    expect(waterText({ distanceM: 6, inWater: true })).toBe("Ved vandkanten");
  });
});

const beachRing: LonLat[] = [
  [10.1995, 56.145],
  [10.1999, 56.145],
  [10.1999, 56.146],
  [10.1995, 56.146],
  [10.1995, 56.145],
];

const cell: CoastCell = {
  coastline: [enc(coastNorth)],
  features: [
    ["w1", "beach", "a", enc(beachRing), "Testby Strand", "sand"],
    [
      "w2",
      "pier",
      "l",
      enc([
        [10.2, 56.147],
        [10.201, 56.147],
      ]),
      null,
      "bade",
    ],
    [
      "w3",
      "groyne",
      "l",
      enc([
        [10.2, 56.148],
        [10.2004, 56.148],
      ]),
    ],
    [
      "w4",
      "groyne",
      "l",
      enc([
        [10.2, 56.152],
        [10.2004, 56.152],
      ]),
    ],
    ["w5", "sand", "a", enc(beachRing.map(([x, y]) => [x - 0.001, y]))],
    ["n6", "harbour", "p", enc([[10.25, 56.15]]), "Langt væk Havn"],
  ],
};

describe("features near the pin", () => {
  it("counts an area once across cells, and 0 m inside it", () => {
    const features = cellFeatures([cell, cell]);
    expect(features.filter((f) => f.id === "w1")).toHaveLength(1);
    const beach = features.find((f) => f.id === "w1") as CoastFeature;
    expect(featureDistance(beach, [10.1997, 56.1455])).toBe(0);
    expect(featureDistance(beach, [10.1997, 56.147])).toBeCloseTo(111, -1);
  });

  it("keeps the nearest of each kind within 1 km, nearest first, sand only without a beach", () => {
    const pin: LonLat = [10.1997, 56.1462];
    const near = nearbyFeatures(cellFeatures([cell]), pin);
    expect(near.map((n) => n.label)).toEqual(["Sandstrand", "Badebro", "Høfde"]);
    expect(near[0].feature.name).toBe("Testby Strand");
    expect(near[2].feature.id).toBe("w3"); // not the groyne further north
  });

  it("sums up in one line", () => {
    const summary = summarize([cell], [10.1997, 56.1462]);
    expect(summaryLine(summary)).toBe("Vandet 20 m væk · Sandstrand 20 m · Badebro 90 m");
    expect(summaryLine({ water: null, nearby: [] })).toBe(NONE_TEXT);
    expect(NONE_TEXT).toBe("Ingen kyst inden for 1 km");
  });
});

describe("cellsFor", () => {
  const index: CoastIndex = {
    cell_deg: 0.2,
    cells: ["51_280"],
    coverage: ["50_280", "51_280"],
    source: "",
    license: "ODbL 1.0",
  };

  it("fetches only the cells with a file", () => {
    expect(cellsFor(index, [10.3, 56.1])).toEqual(["51_280"]);
  });

  it("is null outside the sample's coverage", () => {
    expect(cellsFor(index, [12.5, 55.7])).toBeNull();
    expect(cellsFor({ ...index, coverage: null }, [12.5, 55.7])).toEqual([]);
  });
});
