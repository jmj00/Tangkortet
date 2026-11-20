import { describe, expect, it } from "vitest";

import { anyUnreviewed, photoAlt } from "./photoviewer";
import { heroSources, thumbSources } from "./thumb";
import type { SpeciesImage } from "./types";

const BASE = "https://inaturalist-open-data.s3.amazonaws.com/photos/30205339/";

describe("thumbSources", () => {
  it("derives the square and small renditions from any iNaturalist variant", () => {
    for (const variant of ["small", "large", "medium", "square"]) {
      expect(thumbSources(`${BASE}${variant}.jpg`)).toEqual({
        src: `${BASE}square.jpg`,
        srcset: `${BASE}square.jpg 75w, ${BASE}small.jpg 240w`,
      });
    }
  });

  it("keeps the extension (some photos are .jpeg or .png)", () => {
    expect(thumbSources(`${BASE}small.jpeg`).src).toBe(`${BASE}square.jpeg`);
  });

  it("leaves other URLs alone", () => {
    expect(thumbSources("https://example.org/a.jpg")).toEqual({ src: "https://example.org/a.jpg" });
  });
});

describe("heroSources", () => {
  it("offers medium for phones and large for wide or dense screens", () => {
    expect(heroSources(`${BASE}large.jpg`)).toEqual({
      src: `${BASE}medium.jpg`,
      srcset: `${BASE}medium.jpg 500w, ${BASE}large.jpg 1024w`,
    });
  });
});

describe("photo text", () => {
  const img = (reviewed: boolean): SpeciesImage => ({
    url: `${BASE}large.jpg`,
    credit: "A",
    license: "CC BY 4.0",
    photo_url: null,
    observation_url: null,
    reviewed,
  });

  it("never presents an unreviewed photo as the species", () => {
    expect(photoAlt("Søl", img(false), 0, 4)).toBe(
      "Foto 1 af 4, angivet som Søl (ikke gennemgået)",
    );
    expect(photoAlt("Søl", img(true), 0, 1)).toBe("Foto: Søl");
  });

  it("flags a species while any of its photos is unreviewed", () => {
    expect(anyUnreviewed([img(true), img(false)])).toBe(true);
    expect(anyUnreviewed([img(true)])).toBe(false);
    expect(anyUnreviewed([])).toBe(false);
  });
});
