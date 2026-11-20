import { describe, expect, it } from "vitest";

import { bathingQuality, groupNearby, riskItems } from "./risk";
import type { RiskIndex } from "./types";

const index: RiskIndex = {
  cell_deg: 0.2,
  cells: ["52_281"],
  layers: {
    rbu: {
      label: "",
      source: "",
      count: 3,
      fields: ["lon", "lat", "kind", "code", "name", "owner", "volume_m3_per_year"],
    },
    klapplads: {
      label: "",
      source: "",
      count: 1,
      fields: ["lon", "lat", "radius_m", "name", "id", "active"],
    },
    badevand: {
      label: "",
      source: "",
      count: 1,
      fields: ["lon", "lat", "name", "quality", "season", "profile_url"],
    },
  },
};

const pin: [number, number] = [10.4, 56.2];

const cell = {
  rbu: [
    [10.401, 56.2, "overloeb", "OV", "BK1", "Aarhus Vand", 14102],
    [10.43, 56.2, "regnvand", "SE", null, null, 0],
    [10.402, 56.2, "ukendt", "UR", "X", null, null],
  ],
  klapplads: [[10.41, 56.2, 1000, "Klapplads Ø", "K_1", false]],
  badevand: [[10.4, 56.201, "Strand", "2 - Good", "2024", "https://profil"]],
};

describe("riskItems", () => {
  const items = riskItems([cell], index, pin);

  it("puts overflows and unknown outlets in the overflow group, rainwater apart", () => {
    expect(items.filter((i) => i.group === "overloeb").map((i) => i.title)).toEqual(["BK1", "X"]);
    expect(items.find((i) => i.group === "regnvand")?.title).toBe("Udløb");
    expect(items.find((i) => i.title === "X")?.detail).toBe("type UR");
  });

  it("describes volume, rounded, in Danish", () => {
    expect(items.find((i) => i.title === "BK1")?.detail).toBe(
      "Aarhus Vand · ca. 14.000 m³ pr. år (beregnet normalår)",
    );
  });

  it("measures dumping sites to their edge, never below 0", () => {
    const site = items.find((i) => i.group === "klapplads");
    expect(site?.distanceM).toBe(0); // ~620 m to the centre, radius 1000 m
    expect(site?.detail).toBe("Nedlagt");
  });

  it("translates the bathing-water class and keeps the profile link", () => {
    const bath = items.find((i) => i.group === "badevand");
    expect(bath?.detail).toBe("EU-klassificering: God (2024)");
    expect(bath?.link).toBe("https://profil");
  });
});

describe("groupNearby", () => {
  it("filters by radius and sorts nearest first, in fixed group order", () => {
    const groups = groupNearby(riskItems([cell], index, pin), 500);
    expect(groups.map((g) => g.key).slice(0, 2)).toEqual(["overloeb", "rens"]);
    const overflow = groups.find((g) => g.key === "overloeb");
    expect(overflow?.count).toBe(2);
    expect(overflow?.nearest.map((i) => i.title)).toEqual(["BK1", "X"]);
    expect(groups.find((g) => g.key === "regnvand")?.count).toBe(0); // ~1.9 km away
  });
});

describe("bathingQuality", () => {
  it("maps EU classes to the Danish terms", () => {
    expect(bathingQuality("1 - Excellent")).toBe("Udmærket");
    expect(bathingQuality("4 - Poor")).toBe("Ringe");
    expect(bathingQuality(null)).toBe("Ukendt");
  });
});
