// Fetching WMS tiles with retries, and deciding when a WMS basemap has failed
// for good. Datafordeler's WMS answers a share of good requests with a 401
// (seen at 15-25 % right after a key was issued), and that 401 carries no
// CORS headers, so the browser sees it as a network error. A rejected key
// looks exactly the same from the browser. So: retry each tile a few times,
// and give the layer up only when nothing has loaded and several tiles have
// failed after all their attempts. map.ts wires this into a MapLibre
// protocol.

/** The outcome of one HTTP attempt. */
export type Attempt =
  | { kind: "ok" }
  /** fetch threw: offline, DNS, or an error response without CORS headers */
  | { kind: "network" }
  | { kind: "http"; status: number }
  /** HTTP 200 with an XML body: a WMS ServiceException (e.g. an invalid key) */
  | { kind: "service-exception" };

export const MAX_ATTEMPTS = 3;

/** Worth another try: transient by nature, or Datafordeler's random 401. */
export function isRetryable(a: Attempt): boolean {
  switch (a.kind) {
    case "network":
      return true;
    case "http":
      return a.status === 401 || a.status === 408 || a.status === 429 || a.status >= 500;
    default:
      return false;
  }
}

/** Wait before attempt `next` (2, 3, …): 300 ms, then 900 ms, ±25 % jitter so
 * the tiles of one view don't retry in lockstep. */
export function backoffMs(next: number, random: () => number = Math.random): number {
  const base = 300 * 3 ** Math.max(0, next - 2);
  return Math.round(base * (0.75 + 0.5 * random()));
}

/** What a response is, from its status, content type and first bytes. */
export function classify(status: number, contentType: string | null, head: Uint8Array): Attempt {
  if (status !== 200) return { kind: "http", status };
  const type = (contentType ?? "").toLowerCase();
  // "<" (0x3c), possibly after whitespace: XML where an image belongs
  const firstChar = head.find((b) => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09);
  if (type.includes("xml") || firstChar === 0x3c) return { kind: "service-exception" };
  return { kind: "ok" };
}

export type TileResult = "loaded" | "failed" | "invalid";

export type Verdict = "pending" | "ok" | "give-up";

/** Failed tiles (each after all its attempts), with none loaded, before the
 * layer is given up. A view needs 6-20 tiles, so this is quick for a dead
 * key and still survives a bad streak. */
export const GIVE_UP_AFTER = 4;

/** A layer's track record. Once a tile has loaded the service works: later
 * failures, a stray ServiceException included, only leave gaps (the map's
 * land/water background shows through), never a fallback. A ServiceException
 * before anything has loaded means a wrong key or layer: give up at once. */
export class TileHealth {
  loaded = 0;
  failed = 0;
  invalid = false;

  record(result: TileResult): Verdict {
    if (result === "loaded") this.loaded += 1;
    else if (result === "failed") this.failed += 1;
    else if (this.loaded === 0) this.invalid = true;
    else this.failed += 1;
    return this.verdict();
  }

  verdict(): Verdict {
    if (this.invalid) return "give-up";
    if (this.loaded > 0) return "ok";
    return this.failed >= GIVE_UP_AFTER ? "give-up" : "pending";
  }
}

/** Counts for the whole session, per layer (handy in a console). */
export interface RetryStats {
  tiles: number;
  /** tiles that needed more than one attempt */
  retried: number;
  /** of those, the ones that loaded in the end */
  recovered: number;
  failed: number;
  attempts: number;
}

export const emptyStats = (): RetryStats => ({
  tiles: 0,
  retried: 0,
  recovered: 0,
  failed: 0,
  attempts: 0,
});

export class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

/** Resolves after `ms`, or rejects at once when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface TileFetchResult {
  result: TileResult;
  attempts: number;
  data?: ArrayBuffer;
}

/**
 * Fetch one tile, retrying what `isRetryable` allows up to `MAX_ATTEMPTS`
 * times. Throws `AbortedError` when the map cancels the tile (it scrolled out
 * of view); everything else ends in a result.
 */
export async function fetchTile(
  url: string,
  signal: AbortSignal,
  deps: {
    fetch?: typeof fetch;
    wait?: (ms: number, signal: AbortSignal) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<TileFetchResult> {
  const doFetch = deps.fetch ?? fetch;
  const wait = deps.wait ?? sleep;
  for (let attempt = 1; ; attempt++) {
    if (signal.aborted) throw new AbortedError();
    let outcome: Attempt;
    let data: ArrayBuffer | undefined;
    try {
      const response = await doFetch(url, { signal });
      data = await response.arrayBuffer();
      outcome = classify(
        response.status,
        response.headers.get("content-type"),
        new Uint8Array(data, 0, Math.min(16, data.byteLength)),
      );
    } catch {
      if (signal.aborted) throw new AbortedError();
      outcome = { kind: "network" };
    }
    if (outcome.kind === "ok") return { result: "loaded", attempts: attempt, data };
    if (outcome.kind === "service-exception") return { result: "invalid", attempts: attempt };
    if (!isRetryable(outcome) || attempt >= MAX_ATTEMPTS)
      return { result: "failed", attempts: attempt };
    await wait(backoffMs(attempt + 1, deps.random), signal);
  }
}
