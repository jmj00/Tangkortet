import { describe, expect, it } from "vitest";

import { beyond, centreOffset, insetsFrom, insideVisible, popupAnchor, px } from "./camera";

const padding = { top: 60, right: 0, bottom: 450, left: 0 };

describe("px", () => {
  it("reads plain pixel lengths only", () => {
    expect(px("120px")).toBe(120);
    expect(px(" 12.5px ")).toBe(12.5);
    expect(px("53dvh")).toBeNull();
    expect(px("calc(1rem + 2px)")).toBeNull();
    expect(px("")).toBeNull();
  });
});

describe("insetsFrom", () => {
  it("takes the sheet's live edge for the bottom", () => {
    expect(insetsFrom(padding, "96px")).toEqual({ ...padding, bottom: 96 });
  });

  it("falls back to the map padding before the sheet has measured", () => {
    expect(insetsFrom(padding, "53dvh")).toEqual(padding);
  });

  it("is all zero on the desktop layout", () => {
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(insetsFrom(none, "0px")).toEqual(none);
  });
});

describe("beyond", () => {
  it("passes only what the map's own padding does not cover", () => {
    expect(beyond({ top: 80, right: 0, bottom: 300, left: 10 }, padding)).toEqual({
      top: 20,
      right: 0,
      bottom: 0,
      left: 10,
    });
  });
});

describe("centreOffset", () => {
  it("is zero when the map padding already covers the UI", () => {
    expect(centreOffset({ ...padding, bottom: 96 }, padding)).toEqual([0, 0]);
  });

  it("moves the centre away from extra cover", () => {
    expect(centreOffset({ top: 100, right: 0, bottom: 450, left: 0 }, padding)).toEqual([0, 20]);
  });
});

describe("insideVisible", () => {
  it("excludes points under the sheet or the search", () => {
    const pad = { top: 60, right: 0, bottom: 400, left: 0 };
    expect(insideVisible(200, 300, 390, 844, pad)).toBe(true);
    expect(insideVisible(200, 500, 390, 844, pad)).toBe(false); // under the sheet
    expect(insideVisible(200, 30, 390, 844, pad)).toBe(false); // under the search
  });
});

describe("popupAnchor", () => {
  const pad = { top: 60, right: 0, bottom: 400, left: 0 };
  it("opens below a point with room above the sheet", () => {
    expect(popupAnchor(150, 844, pad)).toBe("top");
  });

  it("opens above a point close to the sheet's edge", () => {
    expect(popupAnchor(420, 844, pad)).toBe("bottom");
  });
});
