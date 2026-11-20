import { describe, expect, it } from "vitest";

import { cellsFor, summarize, type CoastSummary, type LonLat, type Nearby } from "./coast";
import manifest from "../public/data/manifest.json";
import {
  cellNames,
  inRings,
  kindInfo,
  nameCellsFor,
  seaName,
  shoreLine,
  shoreRows,
  summarizeNames,
  waterAt,
  waterLine,
  type NamedPlace,
} from "./names";
import type { Manifest, NameCell, NameRow } from "./types";

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

const box = (w: number, s: number, e: number, n: number): LonLat[] => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
];

// A big bay with a small cove in it, a headland and an island, a stony shoal.
const bigBay: NameRow = [1, "bugt", "a", [enc(box(10.0, 56.0, 10.2, 56.1))], "Store Bugt", 13000];
const cove: NameRow = [2, "bugt", "a", [enc(box(10.1, 56.05, 10.2, 56.1))], "Lille Vig", 3000];
const pynt: NameRow = [3, "pynt", "p", enc([[10.02, 56.101]]), "Prøve Pynt"];
const island: NameRow = [
  4,
  "ø",
  "a",
  [enc(box(10.02, 56.02, 10.04, 56.03))],
  "Holmø", // says "ø" itself
  200,
];
const shoal: NameRow = [
  5,
  "tørtVedLavvande",
  "a",
  [enc(box(10.06, 56.06, 10.061, 56.061))],
  "Stenene",
  1,
];
const marina: NameRow = [
  6,
  "lystbådehavn",
  "a",
  [enc(box(10.0, 56.1, 10.004, 56.102))],
  "Prøve Marina",
  5,
];
const beach: NameRow = [
  7,
  "strand",
  "a",
  [enc(box(10.01, 56.1, 10.02, 56.1005))],
  "Prøve Strand",
  4,
];
const cell: NameCell = { features: [bigBay, cove, pynt, island, shoal, marina, beach] };
// the bay again in the cell to the east: one water, two pieces
const east: NameCell = { features: [bigBay, island] };
const places = (): NamedPlace[] => cellNames([cell, east]);

describe("cellNames", () => {
  it("decodes rows, keeps every piece of a water and the rest once", () => {
    const all = places();
    expect(all.filter((p) => p.name === "Store Bugt")).toHaveLength(2);
    expect(all.filter((p) => p.name === "Holmø")).toHaveLength(1);
    const p = all.find((x) => x.name === "Prøve Pynt");
    expect(p).toMatchObject({ type: "p", group: "landform", coords: [[10.02, 56.101]] });
  });

  it("knows the kinds in Danish", () => {
    expect(kindInfo("lystbådehavn")).toEqual({ group: "harbour", label: "Lystbådehavn" });
    expect(kindInfo("trafikhavn").label).toBe("Havn");
    expect(kindInfo("tørtVedLavvande").label).toBe("Tørt ved lavvande");
    expect(kindInfo("overskylledeSten").label).toBe("Overskyllede sten");
  });

  it("tests a point against rings even-odd", () => {
    const rings = [box(0, 0, 4, 4), box(1, 1, 2, 2)];
    expect(inRings(rings, [3, 3])).toBe(true);
    expect(inRings(rings, [1.5, 1.5])).toBe(false); // in the hole
  });
});

describe("the water at the pin", () => {
  it("is the smallest water the pin is in", () => {
    expect(waterAt(places(), [10.15, 56.07])).toMatchObject({ name: "Lille Vig", inside: true });
    expect(waterAt(places(), [10.05, 56.07])).toMatchObject({ name: "Store Bugt", inside: true });
  });

  it("is the nearest water within 1 km of a pin outside them all", () => {
    const w = waterAt(places(), [10.05, 56.105]); // 560 m north of the bay
    expect(w).toMatchObject({ name: "Store Bugt", inside: false });
    expect(w?.distanceM).toBeGreaterThan(500);
    expect(waterAt(places(), [10.05, 56.2])).toBeNull();
  });
});

const summary = (pin: LonLat, extra: Partial<CoastSummary> = {}): CoastSummary => ({
  water: null,
  nearby: [],
  names: summarizeNames(places(), pin),
  ...extra,
});

describe("the card's water line", () => {
  it("names the water the pin is in, with the distance to the coast", () => {
    const pin: LonLat = [10.15, 56.07];
    expect(waterLine(summary(pin, { water: { distanceM: 1200, inWater: true } }))).toBe(
      "I Lille Vig, 1,2 km fra kysten",
    );
    expect(waterLine(summary(pin))).toBe("I Lille Vig");
    expect(waterLine(summary(pin, { water: { distanceM: 5, inWater: true } }))).toBe(
      "Ved vandkanten, Lille Vig",
    );
  });

  it("names the water by a pin on land", () => {
    const pin: LonLat = [10.05, 56.1004]; // 45 m north of the bay
    expect(waterLine(summary(pin, { water: { distanceM: 40, inWater: false } }))).toBe(
      "Store Bugt 40 m væk",
    );
  });

  it("does not say 'I' a water on an island it is drawn over", () => {
    const pin: LonLat = [10.03, 56.025]; // on Holmø, inside the bay's outline
    expect(waterLine(summary(pin))).toBeNull();
    expect(waterLine(summary(pin, { water: { distanceM: 300, inWater: false } }))).toBe(
      "Vandet 300 m væk",
    );
    expect(seaName(summary(pin))).toBeNull();
  });

  it("falls back to the plain words without names", () => {
    expect(waterLine({ water: { distanceM: 42, inWater: false } })).toBe("Vandet 40 m væk");
    expect(waterLine({ water: null })).toBeNull();
  });
});

describe("the pin card's name at sea", () => {
  it("is the water when the pin is out in it", () => {
    expect(seaName(summary([10.15, 56.07], { water: { distanceM: 900, inWater: true } }))).toBe(
      "I Lille Vig",
    );
    expect(seaName(summary([10.15, 56.07]))).toBe("I Lille Vig"); // no coastline near
  });

  it("is not the water by the shore or on land", () => {
    expect(seaName(summary([10.15, 56.07], { water: { distanceM: 80, inWater: true } }))).toBe(
      null,
    );
    expect(seaName(summary([10.15, 56.07], { water: { distanceM: 900, inWater: false } }))).toBe(
      null,
    );
    expect(seaName(null)).toBeNull();
  });
});

function osm(kind: Nearby["feature"]["kind"], coords: LonLat[], d: number, name?: string): Nearby {
  return {
    feature: { id: `w${d}`, kind, type: "a", coords, name: name ?? null, detail: null },
    distanceM: d,
    label: kind === "marina" ? "Lystbådehavn" : kind === "harbour" ? "Havn" : "Strand",
  };
}

describe("the card's rows", () => {
  const pin: LonLat = [10.012, 56.1003];

  it("gives an unnamed OpenStreetMap harbour its official name and kind", () => {
    const harbour = osm("harbour", box(10.0005, 56.1005, 10.0035, 56.1015), 300);
    const rows = shoreRows(summary(pin, { nearby: [harbour] }));
    expect(rows.find((r) => r.name === "Prøve Marina")).toMatchObject({
      label: "Lystbådehavn",
      joiner: " – ",
      distanceM: 300,
    });
  });

  it("keeps OpenStreetMap's name when no official place is near", () => {
    const far = osm("beach", box(10.1, 56.2, 10.11, 56.201), 500, "OSM-stranden");
    const rows = shoreRows(summary([10.105, 56.199], { nearby: [far] }));
    expect(rows[0]).toMatchObject({ label: "Strand", name: "OSM-stranden" });
  });

  it("adds an official beach OpenStreetMap lacks, the landform and shallow stones", () => {
    const rows = shoreRows(summary(pin));
    const text = rows.map((r) => `${r.label}${r.name ? r.joiner + r.name : ""}`);
    expect(text).toContain("Strand – Prøve Strand");
    expect(text).toContain("Lystbådehavn – Prøve Marina");
    expect(text).toContain("Prøve Pynt"); // the name says what it is
    // nearest first
    const d = rows.map((r) => r.distanceM);
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });

  it("says the kind after a name that does not", () => {
    const vig = summary([10.0605, 56.0605]);
    const stones = shoreRows(vig).find((r) => r.label === "Tørt ved lavvande");
    expect(stones).toMatchObject({ name: "Stenene", distanceM: 0 });
    const odd: NamedPlace[] = cellNames([
      { features: [[9, "odde", "p", enc([[10.0605, 56.061]]), "Sønderspids"]] },
    ]);
    const rows = shoreRows({
      water: null,
      nearby: [],
      names: summarizeNames(odd, [10.0605, 56.0605]),
    });
    expect(rows[0]).toMatchObject({ label: "Sønderspids", name: "odde", joiner: " · " });
  });

  it("makes one line for the pin's card", () => {
    expect(shoreLine(summary([10.15, 56.07], { water: { distanceM: 1200, inWater: true } }))).toBe(
      "I Lille Vig, 1,2 km fra kysten",
    );
    expect(shoreLine({ water: null, nearby: [] })).toBeNull();
  });
});

describe("the committed dev sample", () => {
  const m = manifest as unknown as Manifest;
  // the committed cells, read by Vite at test time
  const files = import.meta.glob<unknown>(
    ["../public/data/names/*.json", "../public/data/coast/*.json"],
    {
      eager: true,
      import: "default",
    },
  );
  const load = (dir: string, key: string): unknown => files[`../public/data/${dir}/${key}.json`];
  const at = (pin: LonLat): CoastSummary => {
    const names = summarizeNames(
      cellNames((nameCellsFor(m.names!, pin) ?? []).map((k) => load("names", k) as NameCell)),
      pin,
    );
    const coast = summarize(
      (cellsFor(m.coast!, pin) ?? []).map((k) => load("coast", k) as never),
      pin,
    );
    return { ...coast, names };
  };

  it("covers the coast sample with CC BY 4.0 names", () => {
    expect(m.names?.license).toBe("CC BY 4.0");
    expect(m.names?.coverage).toEqual(m.coast?.coverage);
  });

  it("names Århus Bugt out at sea and Kalø Vig in the cove", () => {
    expect(seaName(at([10.33, 56.1]))).toBe("I Århus Bugt");
    expect(waterLine(at([10.4, 56.235]))).toBe("I Kalø Vig");
  });

  it("names Egå Marina as a Lystbådehavn", () => {
    const rows = shoreRows(at([10.2905, 56.2105]));
    expect(rows[0]).toMatchObject({ label: "Lystbådehavn", name: "Egå Marina" });
  });

  it("is on Helgenæs and on Mandø, not in the water drawn over them", () => {
    expect(shoreRows(at([10.52, 56.13]))[0]).toMatchObject({ label: "Helgenæs", name: "halvø" });
    const mando = at([8.556, 55.281]);
    expect(shoreRows(mando)[0]).toMatchObject({ label: "Mandø", name: null });
    expect(waterLine(mando)).toBeNull();
  });
});
