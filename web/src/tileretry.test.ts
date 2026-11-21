import { describe, expect, it } from "vitest";
import {
  AbortedError,
  backoffMs,
  classify,
  fetchTile,
  GIVE_UP_AFTER,
  isRetryable,
  MAX_ATTEMPTS,
  sleep,
  TileHealth,
} from "./tileretry";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const xml = new TextEncoder().encode('<?xml version="1.0"?><ServiceExceptionReport/>');

describe("isRetryable", () => {
  it("retries network errors, 401, 408, 429 and 5xx", () => {
    expect(isRetryable({ kind: "network" })).toBe(true);
    for (const status of [401, 408, 429, 500, 502, 503, 504])
      expect(isRetryable({ kind: "http", status })).toBe(true);
  });
  it("does not retry other client errors, success or a ServiceException", () => {
    for (const status of [400, 403, 404]) expect(isRetryable({ kind: "http", status })).toBe(false);
    expect(isRetryable({ kind: "ok" })).toBe(false);
    expect(isRetryable({ kind: "service-exception" })).toBe(false);
  });
});

describe("backoffMs", () => {
  it("grows per attempt and stays within the jitter", () => {
    expect(backoffMs(2, () => 0.5)).toBe(300);
    expect(backoffMs(3, () => 0.5)).toBe(900);
    expect(backoffMs(2, () => 0)).toBe(225);
    expect(backoffMs(2, () => 1)).toBe(375);
  });
});

describe("classify", () => {
  it("accepts an image", () => {
    expect(classify(200, "image/png", png)).toEqual({ kind: "ok" });
  });
  it("treats XML at HTTP 200 as a ServiceException, by type or by body", () => {
    expect(classify(200, "text/xml; charset=UTF-8", xml).kind).toBe("service-exception");
    expect(classify(200, "image/png", xml).kind).toBe("service-exception");
    expect(classify(200, null, new TextEncoder().encode("  \n<x/>")).kind).toBe(
      "service-exception",
    );
  });
  it("passes other statuses through", () => {
    expect(classify(401, "application/problem+json", new Uint8Array())).toEqual({
      kind: "http",
      status: 401,
    });
  });
});

describe("TileHealth", () => {
  it("is pending until a tile loads or enough fail", () => {
    const h = new TileHealth();
    for (let i = 1; i < GIVE_UP_AFTER; i++) expect(h.record("failed")).toBe("pending");
    expect(h.record("failed")).toBe("give-up");
  });
  it("never gives up for failures once a tile has loaded", () => {
    const h = new TileHealth();
    h.record("failed");
    expect(h.record("loaded")).toBe("ok");
    for (let i = 0; i < 50; i++) expect(h.record("failed")).toBe("ok");
  });
  it("gives up on a ServiceException before anything has loaded when no other tile is on its way", () => {
    const h = new TileHealth();
    h.record("failed");
    expect(h.record("invalid")).toBe("give-up");
    expect(h.invalid).toBe(true);
  });
  it("survives one stray ServiceException on the first tile back while others are in flight", () => {
    // the view's first tiles start together; the first answer is a stray XML
    const h = new TileHealth();
    for (let i = 0; i < 12; i++) h.begin();
    expect(h.record("invalid")).toBe("pending");
    expect(h.invalid).toBe(false);
    expect(h.record("loaded")).toBe("ok");
    for (let i = 0; i < 10; i++) expect(h.record("loaded")).toBe("ok");
  });
  it("gives up on the second ServiceException while nothing has loaded (a rejected key)", () => {
    const h = new TileHealth();
    for (let i = 0; i < 12; i++) h.begin();
    expect(h.record("invalid")).toBe("pending");
    expect(h.record("invalid")).toBe("give-up");
    expect(h.invalid).toBe(true);
  });
  it("gives up on one ServiceException once the other tiles have been cancelled", () => {
    const h = new TileHealth();
    h.begin();
    h.begin();
    h.cancel();
    expect(h.inFlight).toBe(1);
    expect(h.record("invalid")).toBe("give-up");
  });
  it("still gives up after enough failed tiles when a stray ServiceException was one of them", () => {
    const h = new TileHealth();
    for (let i = 0; i < 12; i++) h.begin();
    h.record("invalid");
    for (let i = 1; i < GIVE_UP_AFTER - 1; i++) expect(h.record("failed")).toBe("pending");
    expect(h.record("failed")).toBe("give-up");
    expect(h.invalid).toBe(false);
  });
  it("keeps a working layer on a stray ServiceException, counting it as one failed tile", () => {
    const h = new TileHealth();
    h.record("loaded");
    expect(h.record("invalid")).toBe("ok");
    expect(h.invalid).toBe(false);
    expect(h.failed).toBe(1);
    for (let i = 0; i < 10; i++) expect(h.record("invalid")).toBe("ok");
  });
});

/** A fake fetch answering from a script of outcomes. */
function scripted(outcomes: ("png" | "xml" | "throw" | number)[]) {
  const calls: string[] = [];
  const fake = (async (url: string) => {
    calls.push(url);
    const next = outcomes.shift() ?? "throw";
    if (next === "throw") throw new TypeError("Failed to fetch");
    if (typeof next === "number")
      return new Response("{}", { status: next, headers: { "content-type": "application/json" } });
    return next === "png"
      ? new Response(png, { status: 200, headers: { "content-type": "image/png" } })
      : new Response(xml, { status: 200, headers: { "content-type": "text/xml" } });
  }) as unknown as typeof fetch;
  return { fake, calls };
}

const noWait = async (): Promise<void> => {};

describe("fetchTile", () => {
  it("returns the image on the first try", async () => {
    const { fake, calls } = scripted(["png"]);
    const r = await fetchTile("u", new AbortController().signal, { fetch: fake, wait: noWait });
    expect(r.result).toBe("loaded");
    expect(r.attempts).toBe(1);
    expect(r.data?.byteLength).toBe(png.byteLength);
    expect(calls).toHaveLength(1);
  });
  it("recovers from a network error and a 401", async () => {
    const { fake } = scripted(["throw", 401, "png"]);
    const waits: number[] = [];
    const r = await fetchTile("u", new AbortController().signal, {
      fetch: fake,
      wait: async (ms) => {
        waits.push(ms);
      },
      random: () => 0.5,
    });
    expect(r).toMatchObject({ result: "loaded", attempts: 3 });
    expect(waits).toEqual([300, 900]);
  });
  it("fails after MAX_ATTEMPTS", async () => {
    const { fake, calls } = scripted([503, 503, 503, "png"]);
    const r = await fetchTile("u", new AbortController().signal, { fetch: fake, wait: noWait });
    expect(r).toMatchObject({ result: "failed", attempts: MAX_ATTEMPTS });
    expect(calls).toHaveLength(MAX_ATTEMPTS);
  });
  it("does not retry a 404", async () => {
    const { fake, calls } = scripted([404, "png"]);
    const r = await fetchTile("u", new AbortController().signal, { fetch: fake, wait: noWait });
    expect(r.result).toBe("failed");
    expect(calls).toHaveLength(1);
  });
  it("reports a ServiceException as an invalid key without retrying", async () => {
    const { fake, calls } = scripted(["xml", "png"]);
    const r = await fetchTile("u", new AbortController().signal, { fetch: fake, wait: noWait });
    expect(r.result).toBe("invalid");
    expect(calls).toHaveLength(1);
  });
  it("stops when aborted during the backoff", async () => {
    const { fake, calls } = scripted(["throw", "png"]);
    const controller = new AbortController();
    const p = fetchTile("u", controller.signal, {
      fetch: fake,
      wait: (ms, signal) => {
        controller.abort();
        return sleep(ms, signal);
      },
    });
    await expect(p).rejects.toBeInstanceOf(AbortedError);
    expect(calls).toHaveLength(1);
  });
  it("throws AbortedError, not a failure, when the fetch itself is aborted", async () => {
    const controller = new AbortController();
    const fake = (async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    await expect(
      fetchTile("u", controller.signal, { fetch: fake, wait: noWait }),
    ).rejects.toBeInstanceOf(AbortedError);
  });
});
