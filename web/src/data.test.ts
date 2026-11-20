import { afterEach, describe, expect, it, vi } from "vitest";

import { forgetPendingSpecies, loadSpecies } from "./data";

const doc = (slug: string) => ({ slug }) as unknown;
const ok = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

afterEach(() => vi.unstubAllGlobals());

describe("loadSpecies", () => {
  it("retries with a fresh request after a hung one is forgotten", async () => {
    const fetch = vi
      .fn()
      .mockReturnValueOnce(new Promise(() => {})) // never settles
      .mockReturnValueOnce(ok(doc("a")));
    vi.stubGlobal("fetch", fetch);

    const hung = loadSpecies("species/hung.json");
    expect(loadSpecies("species/hung.json")).toBe(hung); // shared while pending
    forgetPendingSpecies("species/hung.json");
    await expect(loadSpecies("species/hung.json")).resolves.toEqual({ slug: "a" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a loaded document cached", async () => {
    const fetch = vi.fn().mockReturnValue(ok(doc("b")));
    vi.stubGlobal("fetch", fetch);
    const first = await loadSpecies("species/b.json");
    forgetPendingSpecies("species/b.json");
    expect(await loadSpecies("species/b.json")).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not let a forgotten request's failure evict its replacement", async () => {
    let failOld: (e: Error) => void = () => {};
    const fetch = vi
      .fn()
      .mockReturnValueOnce(new Promise((_, reject) => (failOld = reject)))
      .mockReturnValueOnce(ok(doc("c")));
    vi.stubGlobal("fetch", fetch);
    const old = loadSpecies("species/c.json");
    old.catch(() => {});
    forgetPendingSpecies("species/c.json");
    const fresh = await loadSpecies("species/c.json");
    failOld(new Error("late failure"));
    await old.catch(() => {});
    expect(await loadSpecies("species/c.json")).toBe(fresh);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
