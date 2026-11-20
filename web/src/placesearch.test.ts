import { afterEach, describe, expect, it, vi } from "vitest";

import { mergeHits, preferHits } from "./addresses";
import { step } from "./addresscombo";
import {
  LOAD_TIMEOUT_MS,
  missedText,
  placeIndexWithin,
  searchMessage,
  searchWords,
  type SearchState,
} from "./placesearch";
import type { PlaceIndex } from "./placeindex";

const said = (
  state: SearchState | "chosen",
  query = "",
  shown = 0,
  addresses = false,
  focused = true,
) => searchMessage({ state, query, shown }, "tryk", addresses, focused);

describe("searchMessage", () => {
  it("explains an empty focused field, and says nothing unfocused", () => {
    expect(said("idle")).toContain("„6857“");
    expect(said("idle")).toContain("Vemmetofte Strand");
    expect(said("idle", "", 0, true)).toContain("Vestergade 10, Silkeborg");
    expect(said("idle", "", 0, false, false)).toBe("");
  });

  it("asks for more at one or two characters", () => {
    expect(said("short", "Aa")).toBe("Skriv mindst 3 bogstaver.");
    expect(said("short", "68")).toBe("Skriv mindst 3 cifre af postnummeret.");
  });

  it("says what to try when nothing matches, with the device's verb", () => {
    expect(said("empty", "xqz")).toContain("„xqz“");
    expect(said("empty", "xqz")).toContain("tryk på kortet");
    expect(searchMessage({ state: "empty", query: "x", shown: 0 }, "klik", false)).toContain(
      "klik på kortet",
    );
    expect(said("empty", "xqz", 0, true)).toContain("Vestergade 10, Silkeborg");
  });

  it("tells an unreachable address service from no match", () => {
    expect(said("failed", "Vestergade", 2, true)).toBe(
      "Adressesøgningen svarer ikke lige nu, så her er kun byer og strande.",
    );
    expect(said("failed", "Vestergade", 0, true)).toContain("svarer ikke");
    expect(said("offline", "Skagen")).toContain("kunne ikke hentes");
  });

  it("says the list is on its way", () => {
    expect(said("loading", "Skagen")).toBe("Henter byer og strande…");
  });

  it("says nothing with results or after a choice", () => {
    expect(said("results", "Skagen", 3)).toBe("");
    expect(said("chosen", "Skagen")).toBe("");
  });
});

describe("helpers", () => {
  it("names the field after what it finds", () => {
    expect(searchWords(false).label).toBe("Søg by, postnummer eller strand");
    expect(searchWords(true).label).toContain("adresse");
  });

  it("steps through options, wrapping", () => {
    expect(step(-1, 1, 3)).toBe(0);
    expect(step(-1, -1, 3)).toBe(2);
    expect(step(2, 1, 3)).toBe(0);
    expect(step(0, -1, 3)).toBe(2);
    expect(step(-1, 1, 0)).toBe(-1);
  });

  it("puts a preferred district's addresses first", () => {
    const hits = [
      { id: "a", titel: "Vestergade 1, 1456 København K" },
      { id: "b", titel: "Vestergade 1, 8600 Silkeborg" },
    ];
    expect(preferHits(hits, ["silkeborg"]).map((h) => h.id)).toEqual(["b", "a"]);
    expect(preferHits(hits, []).map((h) => h.id)).toEqual(["a", "b"]);
  });

  it("merges several searches' hits in turn, without repeats", () => {
    expect(
      mergeHits(
        [
          ["a", "b"],
          ["b", "c"],
        ],
        6,
      ),
    ).toEqual(["a", "b", "c"]);
    expect(mergeHits([["a", "b", "c"]], 2)).toEqual(["a", "b"]);
  });

  it("words the line above addresses found elsewhere", () => {
    expect(missedText("Hovedgaden 1", "Rold")).toBe(
      "Ingen Hovedgaden 1 i Rold – adresser andre steder:",
    );
  });
});

describe("placeIndexWithin", () => {
  afterEach(() => vi.useRealTimers());

  it("gives up after the timeout, into the offline state", async () => {
    vi.useFakeTimers();
    const never = () => new Promise<PlaceIndex>(() => {});
    const result = placeIndexWithin(LOAD_TIMEOUT_MS, never);
    const caught = result.catch((e: Error) => e.message);
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);
    expect(await caught).toBe("place list timed out");
  });

  it("passes the list on when it comes in time", async () => {
    const index = { towns: [] } as unknown as PlaceIndex;
    await expect(placeIndexWithin(1000, () => Promise.resolve(index))).resolves.toBe(index);
  });
});
