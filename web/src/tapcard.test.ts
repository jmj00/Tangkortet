import { describe, expect, it } from "vitest";

import { findLines } from "./findcard";
import { basemapPaint } from "./map";
import { clearOfBox, legendSummary } from "./maplegend";
import {
  coordsText,
  findsNearText,
  findsText,
  placeText,
  splitText,
  summarizeFinds,
  verdictText,
} from "./tapcard";
import type { ObservationRow, SpeciesDoc } from "./types";

describe("the pin's card", () => {
  it("names the place, near or some way off", () => {
    expect(placeText({ name: "Aarhus", kind: "town", distanceM: 0 })).toBe("Ved Aarhus");
    expect(placeText({ name: "Ebeltoft", kind: "town", distanceM: 1180 })).toBe(
      "1,2 km fra Ebeltoft",
    );
    expect(placeText(null)).toBeNull();
  });

  it("is on an island or a peninsula, by a headland", () => {
    expect(placeText({ name: "Helgenæs", kind: "landform", distanceM: 0, on: true })).toBe(
      "På Helgenæs",
    );
    expect(placeText({ name: "Næsset", kind: "landform", distanceM: 120 })).toBe("Ved Næsset");
  });

  it("writes coordinates the Danish way", () => {
    expect(coordsText([10.219, 56.151])).toBe("56,1510° N, 10,2190° Ø");
  });

  it("never shows green without saying it is no guarantee", () => {
    expect(verdictText("green")).toMatch(/ingen garanti/);
    expect(verdictText("pending")).toBe("Vurderer risiko…");
    expect(verdictText("unknown")).toBe("Kan ikke vurderes");
    expect(verdictText("red")).toMatch(/^Rød/);
  });

  it("counts species near the pin, split so the parts add up", () => {
    const doc = (rows: ObservationRow[]): SpeciesDoc => ({ observations: rows }) as SpeciesDoc;
    const pin: [number, number] = [10.2, 56.15];
    const docs = [
      doc([[10.2, 56.15, 2020, 0, null, 0]]),
      doc([
        [10.21, 56.15, 2021, 1, null, 0],
        [10.2, 56.16, 2021, 0, 2.5, 0],
      ]),
      doc([[10.21, 56.15, 2021, 1, null, 0]]),
      doc([[10.2, 56.15, null, 2, null, 0]]),
      doc([[12.5, 55.7, 2019, 0, null, 0]]), // far away
    ];
    const summary = summarizeFinds(docs, pin);
    expect(summary).toEqual({ species: 4, attached: 2, drift: 1, unknown: 1 });
    expect(summary.attached + summary.drift + summary.unknown).toBe(summary.species);
    expect(findsText(summary)).toBe("4 arter");
    expect(findsNearText(summary)).toBe(" i nærheden");
    expect(splitText(summary)).toBe("Inden for 10 km: 2 fastsiddende, 1 kun opskyllet, 1 ukendt");
    // a zero part is left out
    expect(splitText({ species: 3, attached: 3, drift: 0, unknown: 0 })).toBe(
      "Inden for 10 km: 3 fastsiddende",
    );
    expect(findsText({ species: 1, attached: 1, drift: 0, unknown: 0 })).toBe("1 art");
    expect(findsText({ species: 0, attached: 0, drift: 0, unknown: 0 })).toBe("Ingen fund");
    expect(splitText({ species: 0, attached: 0, drift: 0, unknown: 0 })).toBe(
      "Ingen inden for 10 km – se steder med fund under Arter",
    );
    expect(findsText("loading")).toBe("Finder arter…");
    expect(findsNearText("loading")).toBe("");
  });

  it("names a generic beach with its town", () => {
    expect(
      placeText({ name: "Sydstranden", kind: "coast", distanceM: 260, town: "Kerteminde" }),
    ).toBe("Ved Sydstranden, Kerteminde");
  });
});

describe("the find card", () => {
  it("says attached or washed up, the year and the depth", () => {
    expect(findLines({ a: "attached", year: 2019, depth: 3.5 })).toEqual([
      "Fastsiddende",
      "Fundet 2019",
      "Dybde 3,5 m",
    ]);
    expect(findLines({ a: "drift", year: null, depth: null })).toEqual([
      "Opskyllet",
      "Årstal ukendt",
    ]);
  });
});

describe("the map key", () => {
  it("sums up what is on the map", () => {
    expect(
      legendSummary({
        finds: { name: "Søl", color: "#000", kinds: ["attached"] },
        risk: { radiusM: 2000, groups: [] },
      }),
    ).toBe("fund af Søl og mulige kilder inden for 2 km");
  });
});

describe("keeping a frame clear of the open key", () => {
  const pad = { top: 0, right: 64, bottom: 0, left: 0 };
  it("goes round it from the side that leaves the larger square", () => {
    // a wide, short map: room to the right of the key
    expect(clearOfBox(pad, { right: 250, top: 330 }, 950, 650)).toMatchObject({
      left: 258,
      bottom: 0,
    });
    // a narrow, tall map: room above it
    expect(clearOfBox(pad, { right: 250, top: 600 }, 400, 800)).toMatchObject({
      left: 0,
      bottom: 208,
    });
  });
});

describe("the muted basemap", () => {
  it("is softened in light mode and inverted in dark mode", () => {
    const light = basemapPaint(false);
    const dark = basemapPaint(true);
    expect(light["raster-saturation"]).toBeLessThan(0);
    // inverted: brightness-min above brightness-max
    expect(dark["raster-brightness-min"]).toBeGreaterThan(dark["raster-brightness-max"] as number);
    expect(dark["raster-hue-rotate"]).toBe(180);
    expect(basemapPaint(false, true)["raster-fade-duration"]).toBe(0);
  });
});
