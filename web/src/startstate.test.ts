import { describe, expect, it } from "vitest";

import { parseHash } from "./hash";
import {
  ENTRY_ORDER,
  entryStep,
  compactSafety,
  escapeFrom,
  fromStartSnap,
  hasSkipParam,
  landingTarget,
  locateMessage,
  mapTapLanding,
  pickerGroups,
  placeFocus,
  placeOptions,
  shouldShowStart,
  toStartSnap,
} from "./startstate";

describe("shouldShowStart", () => {
  const show = (hash: string, search = ""): boolean => shouldShowStart(parseHash(hash), search);

  it("shows on a visit without a link, first or returning", () => {
    expect(show("")).toBe(true);
    // the app writes #tab=… on every visit; a tab alone is not a shared link
    expect(show("#tab=arter")).toBe(true);
    expect(show("#tab=risiko")).toBe(true);
  });

  it("is skipped by a shared link with a pin or a species", () => {
    expect(show("#pin=56.15100,10.21900&tab=risiko")).toBe(false);
    expect(show("#tab=arter&art=palmaria-palmata")).toBe(false);
    expect(show("#pin=56.20000,10.65000&tab=arter&art=palmaria-palmata")).toBe(false);
  });

  it("still shows for a pin outside Denmark (which the app ignores)", () => {
    expect(show("#pin=40.0,10.0")).toBe(true);
  });

  it("is skipped by ?kort", () => {
    expect(hasSkipParam("?kort")).toBe(true);
    expect(hasSkipParam("?a=1&kort=1")).toBe(true);
    expect(hasSkipParam("?kortet")).toBe(false);
    expect(show("", "?kort")).toBe(false);
  });
});

describe("the ways in", () => {
  it("lists risk first, then species, a beach and the map", () => {
    expect(ENTRY_ORDER).toEqual(["risk", "species", "beach", "map"]);
  });

  it("opens the right step", () => {
    expect(entryStep("risk")).toEqual({ view: "place", flow: "risk" });
    expect(entryStep("beach")).toEqual({ view: "place", flow: "beach" });
    expect(entryStep("species")).toEqual({ view: "species" });
    expect(entryStep("map")).toBeNull();
  });

  it("orders the place options for the flow, keeping a pin first", () => {
    expect(placeOptions("risk", false)).toEqual(["locate", "search", "map"]);
    expect(placeOptions("beach", false)).toEqual(["search", "locate", "map"]);
    expect(placeOptions("risk", true)).toEqual(["keep", "locate", "search", "map"]);
    expect(placeOptions("beach", true)[0]).toBe("keep");
  });

  it("focuses the search for a beach, the heading otherwise", () => {
    expect(placeFocus("beach")).toBe("search");
    expect(placeFocus("risk")).toBe("title");
  });

  it("lands each way in on its tab", () => {
    expect(landingTarget({ kind: "risk" })).toEqual({
      tab: "risiko",
      camera: "ring",
      focus: "tabpanel",
    });
    expect(landingTarget({ kind: "beach" })).toEqual({
      tab: "arter",
      camera: "place",
      focus: "tabpanel",
    });
    expect(landingTarget({ kind: "species", slug: "x" })).toEqual({
      tab: "arter",
      camera: "none",
      focus: "species",
    });
    expect(landingTarget({ kind: "guide" }).tab).toBe("guide");
    expect(landingTarget({ kind: "map" })).toEqual({ tab: null, camera: "none", focus: "tab" });
  });

  it("takes a map tap as the question of the view it was made in", () => {
    expect(mapTapLanding("home", null)).toBe("risk");
    expect(mapTapLanding("place", "beach")).toBe("beach");
    expect(mapTapLanding("place", "risk")).toBe("risk");
    expect(mapTapLanding("species", null)).toBeNull();
  });

  it("steps back with Escape: a step to home, home to the map", () => {
    expect(escapeFrom("place")).toBe("home");
    expect(escapeFrom("species")).toBe("home");
    expect(escapeFrom("home")).toBe("map");
  });
});

describe("history snapshots", () => {
  it("round-trips every view", () => {
    expect(toStartSnap(null, null)).toBeNull();
    for (const [view, flow] of [
      ["home", null],
      ["place", "risk"],
      ["place", "beach"],
      ["species", null],
    ] as const) {
      const snap = toStartSnap(view, flow);
      expect(snap).not.toBeNull();
      expect(fromStartSnap(snap!)).toEqual({ view, flow });
    }
  });
});

describe("locateMessage", () => {
  it("points at the other ways, with the device's verb", () => {
    expect(locateMessage("denied", "tryk")).toMatch(/slået fra.*tryk på kysten/);
    expect(locateMessage("unavailable", "klik")).toMatch(/kunne ikke finde.*klik på kysten/);
    expect(locateMessage("slow", "tryk")).toMatch(/længere end ventet/);
  });
});

describe("pickerGroups", () => {
  const sp = (danish_name: string, group: string, scientific_name = "X y") => ({
    danish_name,
    scientific_name,
    group,
  });

  it("groups brown, red, green, alphabetically within, leaving out empty groups", () => {
    const groups = pickerGroups([
      sp("Søl", "rødalge"),
      sp("Sukkertang", "brunalge"),
      sp("Blæretang", "brunalge"),
      sp("Carrageentang", "rødalge"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Brunalger", "Rødalger"]);
    expect(groups[0].species.map((s) => s.danish_name)).toEqual(["Blæretang", "Sukkertang"]);
    expect(groups[1].species.map((s) => s.danish_name)).toEqual(["Carrageentang", "Søl"]);
  });

  it("sorts a species without a Danish name by its scientific one, and keeps unknown groups last", () => {
    const groups = pickerGroups([
      sp("", "grønalge", "Ulva lacinulata"),
      sp("Almindelig søsalat", "grønalge"),
      sp("Noget", "andet"),
    ]);
    expect(groups.map((g) => g.group)).toEqual(["grønalge", "andet"]);
    expect(groups[0].species.map((s) => s.scientific_name)).toEqual(["X y", "Ulva lacinulata"]);
    expect(groups[1].label).toBe("Andre");
  });
});

describe("shouldShowStart on a reload", () => {
  const nav = (...starts: (string | undefined)[]) =>
    ({ tgk: 1, stack: starts.map((start) => ({ start, detail: null })) }) as Parameters<
      typeof shouldShowStart
    >[2];

  it("stays on the map after 'Gå til kortet' (#tab=arter, the map entry)", () => {
    expect(shouldShowStart(parseHash("#tab=arter"), "", nav("home", undefined))).toBe(false);
  });

  it("shows the start screen the entry showed, whatever the hash", () => {
    expect(shouldShowStart(parseHash("#pin=56.15100,10.21900"), "", nav("home"))).toBe(true);
    expect(shouldShowStart(parseHash(""), "", nav("home", "place-risk"))).toBe(true);
  });

  it("still lets ?kort skip it", () => {
    expect(shouldShowStart(parseHash(""), "?kort", nav("home"))).toBe(false);
  });

  it("treats a malformed pin as no pin", () => {
    expect(shouldShowStart(parseHash("#pin=abc"), "")).toBe(true);
  });
});

describe("compactSafety", () => {
  it("is compact on short screens and at large text", () => {
    expect(compactSafety(360, 15)).toBe(true);
    expect(compactSafety(664, 22.5)).toBe(true);
    expect(compactSafety(844, 22.5)).toBe(true);
  });

  it("is full at normal text on phones and laptops", () => {
    expect(compactSafety(640, 15)).toBe(false);
    expect(compactSafety(664, 15)).toBe(false);
    expect(compactSafety(650, 15)).toBe(false);
  });
});
