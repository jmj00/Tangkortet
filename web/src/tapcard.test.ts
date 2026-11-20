import { describe, expect, it } from "vitest";

import { findLines } from "./findcard";
import { basemapPaint } from "./map";
import { legendSummary } from "./maplegend";
import {
  coordsText,
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

  it("writes coordinates the Danish way", () => {
    expect(coordsText([10.219, 56.151])).toBe("56,1510° N, 10,2190° Ø");
  });

  it("never shows green without saying it is no guarantee", () => {
    expect(verdictText("green")).toMatch(/ingen garanti/);
    expect(verdictText("pending")).toBe("Vurderer risiko…");
    expect(verdictText("unknown")).toBe("Kan ikke vurderes");
    expect(verdictText("red")).toMatch(/^Rød/);
  });

  it("counts species near the pin with the attached/washed-up split", () => {
    const doc = (rows: ObservationRow[]): SpeciesDoc => ({ observations: rows }) as SpeciesDoc;
    const pin: [number, number] = [10.2, 56.15];
    const docs = [
      doc([[10.2, 56.15, 2020, 0, null, 0]]),
      doc([
        [10.21, 56.15, 2021, 1, null, 0],
        [10.2, 56.16, 2021, 0, 2.5, 0],
      ]),
      doc([[12.5, 55.7, 2019, 0, null, 0]]), // far away
    ];
    const summary = summarizeFinds(docs, pin);
    expect(summary).toEqual({ species: 2, attached: 2, drift: 1 });
    expect(findsText(summary)).toBe("2 arter i nærheden");
    expect(splitText(summary)).toBe("Inden for 10 km: 2 fastsiddende, 1 opskyllet");
    expect(findsText({ species: 1, attached: 1, drift: 0 })).toBe("1 art i nærheden");
    expect(findsText({ species: 0, attached: 0, drift: 0 })).toBe("Ingen fund i nærheden");
    expect(findsText("loading")).toBe("Finder arter…");
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
