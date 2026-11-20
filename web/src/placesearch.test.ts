import { afterEach, describe, expect, it, vi } from "vitest";

import { mergeHits, preferHits, withTimeout } from "./addresses";
import { step } from "./addresscombo";
import { missedText, searchMessage, searchWords, type SearchState } from "./placesearch";
import { createPlaceLoader, LOAD_TIMEOUT_MS, STALL_MS, type RawPlaces } from "./placeindex";

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

  it("counts the suggestions, and says nothing after a choice", () => {
    expect(said("results", "Skagen", 3)).toBe("3 forslag");
    expect(said("results", "Ry", 1)).toBe("1 forslag");
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

describe("createPlaceLoader", () => {
  afterEach(() => vi.useRealTimers());
  const raw: RawPlaces = {
    postal: [["8600", "Silkeborg", 9.4, 56.1, 9.7, 56.3]],
    towns: [],
    coast: [],
  };

  it("keeps a slow fetch going after a search gives up, and a retry joins it", async () => {
    vi.useFakeTimers();
    let resolveFirst: (r: RawPlaces) => void = () => {};
    const signals: AbortSignal[] = [];
    const loader = createPlaceLoader((signal) => {
      signals.push(signal);
      return new Promise<RawPlaces>((res) => (resolveFirst = res));
    });
    const first = loader.load(LOAD_TIMEOUT_MS).catch((e: Error) => e.message);
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);
    expect(await first).toBe("place list timed out");
    expect(signals[0].aborted).toBe(false);
    // "Prøv igen" while the list is still arriving
    const retry = loader.load(LOAD_TIMEOUT_MS);
    vi.advanceTimersByTime(3000);
    resolveFirst(raw);
    expect((await retry).postal[0].postnr).toBe("8600");
    expect(signals).toHaveLength(1);
  });

  it("one caller's timeout does not cut off another caller", async () => {
    vi.useFakeTimers();
    let resolveFirst: (r: RawPlaces) => void = () => {};
    const loader = createPlaceLoader(() => new Promise<RawPlaces>((res) => (resolveFirst = res)));
    const early = loader.load(LOAD_TIMEOUT_MS).catch((e: Error) => e.message); // focus
    vi.advanceTimersByTime(9000);
    const late = loader.load(LOAD_TIMEOUT_MS); // a search 9 s later
    vi.advanceTimersByTime(1500);
    expect(await early).toBe("place list timed out");
    resolveFirst(raw);
    expect((await late).postal[0].postnr).toBe("8600");
  });

  it("drops a stalled fetch, and a retry fetches afresh", async () => {
    vi.useFakeTimers();
    let resolveFirst: (r: RawPlaces) => void = () => {};
    const signals: AbortSignal[] = [];
    let calls = 0;
    const loader = createPlaceLoader((signal) => {
      signals.push(signal);
      calls++;
      return calls === 1
        ? new Promise<RawPlaces>((res) => (resolveFirst = res)) // hangs
        : Promise.resolve(raw);
    });
    void loader.load(LOAD_TIMEOUT_MS).catch(() => {});
    vi.advanceTimersByTime(STALL_MS);
    // "Prøv igen" after the fetch has stalled
    const index = await loader.load(LOAD_TIMEOUT_MS);
    expect(signals[0].aborted).toBe(true);
    expect(calls).toBe(2);
    expect(index.postal[0].postnr).toBe("8600");
    // the stalled fetch answering late changes nothing
    resolveFirst({ postal: [["1050", "København K", 12, 55, 13, 56]], towns: [] });
    await Promise.resolve();
    expect(loader.loaded()?.postal[0].postnr).toBe("8600");
    expect(await loader.load()).toBe(index);
    expect(calls).toBe(2);
  });

  it("fetches again after a failure, but only once while one is on its way", async () => {
    let calls = 0;
    const loader = createPlaceLoader(() =>
      ++calls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(raw),
    );
    await expect(loader.load()).rejects.toThrow("offline");
    const [a, b] = await Promise.all([loader.load(), loader.load()]);
    expect(a).toBe(b);
    expect(calls).toBe(2);
  });
});

describe("withTimeout", () => {
  it("gives up on a silent address service, and still follows the caller", async () => {
    const timed = withTimeout(undefined, 5) as AbortSignal;
    await new Promise((r) => setTimeout(r, 30));
    expect(timed.aborted).toBe(true);
    expect((timed.reason as Error).name).toBe("TimeoutError");
    const caller = new AbortController();
    const both = withTimeout(caller.signal, 60_000) as AbortSignal;
    caller.abort();
    expect(both.aborted).toBe(true);
  });
});
