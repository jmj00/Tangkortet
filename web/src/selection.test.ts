import { beforeEach, describe, expect, it, vi } from "vitest";

import { groupCounts, SpeciesSelection, type SelectionView } from "./species";

type S = { slug: string };
type D = { slug: string };

/** A selection with a scripted loadDoc: each call returns a promise the test settles. */
function setup() {
  const pending = new Map<string, { resolve: (d: D) => void; reject: (e: Error) => void }>();
  const selected: (string | null)[] = [];
  const views: string[] = [];
  const timers: (() => void)[] = [];
  const sel = new SpeciesSelection<S, D>({
    loadDoc: (s) => new Promise<D>((resolve, reject) => pending.set(s.slug, { resolve, reject })),
    onSelect: (doc) => selected.push(doc?.slug ?? null),
    render: (view: SelectionView<S, D>) =>
      views.push(view.kind === "list" ? "list" : `${view.kind}:${view.summary.slug}`),
    isOffline: () => false,
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {},
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { sel, pending, selected, views, timers, tick };
}

const A = { slug: "ulva-fenestrata" };
const B = { slug: "ulva-compressa" };

describe("SpeciesSelection", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("clears the map when a lookalike fails to load after an open page", async () => {
    const { sel, pending, selected, views, tick } = setup();
    void sel.open(A, { user: true, via: "list" });
    pending.get(A.slug)!.resolve(A);
    await tick();
    expect(selected).toEqual(["ulva-fenestrata"]);

    void sel.open(B, { user: true, via: "lookalike" });
    // Leaving the loaded page clears the map at once, before B has loaded.
    expect(selected).toEqual(["ulva-fenestrata", null]);
    pending.get(B.slug)!.reject(new Error("offline"));
    await tick();
    expect(views[views.length - 1]).toBe("error:ulva-compressa");
    expect(selected).toEqual(["ulva-fenestrata", null]);

    // "back" steps to A (cached) which shows its finds again; then home clears.
    sel.back();
    expect(views[views.length - 1]).toBe("sheet:ulva-fenestrata");
    expect(selected[selected.length - 1]).toBe("ulva-fenestrata");
    sel.home();
    expect(views[views.length - 1]).toBe("list");
    expect(selected[selected.length - 1]).toBeNull();
  });

  it("drops a load overtaken by 'back', and clears the URL on the way out", async () => {
    const { sel, pending, selected, views, tick } = setup();
    void sel.open(A, { user: true, via: "list" });
    sel.back();
    expect(selected).toEqual([null]); // loading -> list also clears (the hash named A)
    pending.get(A.slug)!.resolve(A);
    await tick();
    expect(views[views.length - 1]).toBe("list");
    expect(selected).toEqual([null]);
  });

  it("turns a hanging load into the error page, and still shows a late answer", async () => {
    const { sel, pending, views, timers, tick } = setup();
    void sel.open(A, { user: true, via: "list" });
    timers[0]();
    expect(views[views.length - 1]).toBe("error:ulva-fenestrata");
    pending.get(A.slug)!.resolve(A);
    await tick();
    expect(views[views.length - 1]).toBe("sheet:ulva-fenestrata");
  });

  it("retries a hung load with a fresh request after the timeout", async () => {
    const calls: string[] = [];
    const timedOut: string[] = [];
    const timers: (() => void)[] = [];
    const views: string[] = [];
    let attempt = 0;
    const sel = new SpeciesSelection<S, D>({
      loadDoc: (s) => {
        calls.push(s.slug);
        // The first request hangs forever; the retry answers.
        return attempt++ === 0 ? new Promise<D>(() => {}) : Promise.resolve(s);
      },
      onSelect: () => {},
      render: (view) => views.push(view.kind),
      isOffline: () => false,
      onTimeout: (s) => timedOut.push(s.slug),
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => {},
    });
    void sel.open(A, { user: true, via: "list" });
    timers[0]();
    expect(views[views.length - 1]).toBe("error");
    expect(timedOut).toEqual(["ulva-fenestrata"]);
    sel.retry();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["ulva-fenestrata", "ulva-fenestrata"]);
    expect(views[views.length - 1]).toBe("sheet");
  });

  it("recovers a failed page when the bulk load brings its document", async () => {
    const { sel, pending, selected, views, tick } = setup();
    void sel.open(A, { user: true, via: "list" });
    pending.get(A.slug)!.reject(new Error("x"));
    await tick();
    expect(views[views.length - 1]).toBe("error:ulva-fenestrata");
    sel.addDocs([A, B]);
    expect(views[views.length - 1]).toBe("sheet:ulva-fenestrata");
    expect(selected[selected.length - 1]).toBe("ulva-fenestrata");
  });

  it("keeps a trail only through lookalikes", () => {
    const { sel } = setup();
    sel.addDocs([A, B]);
    void sel.open(A, { user: true, via: "list" });
    void sel.open(B, { user: true, via: "lookalike" });
    expect(sel.trail.map((s) => s.slug)).toEqual(["ulva-fenestrata"]);
    void sel.open(A, { user: true, via: "list" });
    expect(sel.trail).toEqual([]);
  });
});

describe("groupCounts", () => {
  it("counts groups within the current search", () => {
    const list = [
      {
        danish_name: "Søl",
        scientific_name: "Palmaria palmata",
        group: "rødalge",
        invasive: false,
      },
      { danish_name: "Sukkertang", scientific_name: "S l", group: "brunalge", invasive: false },
      { danish_name: "Savtang", scientific_name: "F s", group: "brunalge", invasive: false },
    ];
    expect(groupCounts(list, "")).toEqual(
      new Map([
        ["rødalge", 1],
        ["brunalge", 2],
      ]),
    );
    expect(groupCounts(list, "sukker")).toEqual(new Map([["brunalge", 1]]));
  });
});
