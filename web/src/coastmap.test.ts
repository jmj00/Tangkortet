import { describe, expect, it } from "vitest";

import type { CoastFeature } from "./coast";
import { COAST_PALETTE, legendItems, Lru, toGeoJson } from "./coastmap";
import { legendSummary } from "./maplegend";
import { coastText } from "./tapcard";

const ring: [number, number][] = [
  [10.2, 56.1],
  [10.201, 56.1],
  [10.201, 56.101],
  [10.2, 56.1],
];

const feature = (over: Partial<CoastFeature>): CoastFeature => ({
  id: "w1",
  kind: "beach",
  type: "a",
  coords: ring,
  name: null,
  detail: null,
  ...over,
});

describe("the coast on the map", () => {
  it("draws areas and lines, never the coastline or single points", () => {
    const fc = toGeoJson([
      feature({}),
      feature({ id: "w2", kind: "pier", type: "l", coords: ring.slice(0, 2) }),
      feature({ id: "w3", kind: "coastline", type: "l" }),
      feature({ id: "n4", kind: "harbour", type: "p", coords: [ring[0]] }),
    ]);
    expect(fc.features.map((f) => [f.geometry.type, f.properties?.k])).toEqual([
      ["Polygon", "beach"],
      ["LineString", "pier"],
    ]);
  });

  it("explains only the kinds in view, in a fixed order", () => {
    const items = legendItems(new Set(["cliff", "sand", "marina"]), false);
    expect(items.map((i) => i.label)).toEqual([
      "Strand og sand",
      "Havn, lystbådehavn",
      "Skrænt, klint",
    ]);
    expect(items[0].color).toBe(COAST_PALETTE.light.sand);
    expect(legendItems(new Set(), true)).toEqual([]);
  });

  it("names the coast in the key's summary", () => {
    const coast = legendItems(new Set(["beach"]), false);
    expect(legendSummary({ finds: null, risk: null, coast })).toBe("kysten");
    expect(
      legendSummary({ finds: { name: "Søl", color: "#000", kinds: [] }, risk: null, coast }),
    ).toBe("fund af Søl og kysten");
  });
});

describe("the coast line in the pin's card", () => {
  it("covers loading, failure, nothing near and no data", () => {
    expect(coastText("loading")).toBe("Kysten: henter…");
    expect(coastText("error")).toBe("Kysten: kunne ikke hentes");
    expect(coastText(null)).toBeNull();
    expect(coastText({ water: null, nearby: [] })).toBe("Ingen kyst inden for 1 km");
    expect(coastText({ water: { distanceM: 40, inWater: false }, nearby: [] })).toBe(
      "Kysten: Vandet 40 m væk",
    );
  });
});

describe("the decoded-cell cache", () => {
  it("keeps the most recently used cells", () => {
    const lru = new Lru<string, number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    expect(lru.get("a")).toBe(1); // a is now the newest
    lru.set("c", 3);
    expect(lru.has("b")).toBe(false);
    expect(lru.has("a") && lru.has("c")).toBe(true);
    expect(lru.size).toBe(2);
  });
});
