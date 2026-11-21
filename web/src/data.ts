import type { CoastCell, Manifest, NameCell, PlaceInfoFile, RiskCell, SpeciesDoc } from "./types";

// In dev this resolves to web/public/data/. In production it points at wherever
// the pipeline publishes its payload (set VITE_DATA_BASE at build time).
const BASE = (import.meta.env.VITE_DATA_BASE ?? "/data").replace(/\/+$/, "");

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return (await res.json()) as T;
}

export function loadManifest(): Promise<Manifest> {
  return getJson<Manifest>("manifest.json");
}

const speciesCache = new Map<string, Promise<SpeciesDoc>>();
const speciesSettled = new Set<Promise<SpeciesDoc>>();

export function loadSpecies(file: string): Promise<SpeciesDoc> {
  let pending = speciesCache.get(file);
  if (!pending) {
    const request = getJson<SpeciesDoc>(file);
    pending = request;
    request.then(
      () => speciesSettled.add(request),
      () => {
        // Let a later attempt retry -- unless a newer request already took its place.
        if (speciesCache.get(file) === request) speciesCache.delete(file);
      },
    );
    speciesCache.set(file, request);
  }
  return pending;
}

/** Forget a species request that is still pending (a hung connection), so the
 * next loadSpecies starts a fresh one. A loaded document stays cached. The old
 * request is left running: anything already waiting on it (the near-pin bulk
 * load) still gets its answer if it ever comes. */
export function forgetPendingSpecies(file: string): void {
  const pending = speciesCache.get(file);
  if (pending && !speciesSettled.has(pending)) speciesCache.delete(file);
}

/** Every species doc, for "finds near the pin" in the species list. */
export function loadAllSpecies(manifest: Manifest): Promise<SpeciesDoc[]> {
  return Promise.all(manifest.species.map((s) => loadSpecies(s.file)));
}

const cellCache = new Map<string, Promise<RiskCell>>();

export function loadRiskCell(key: string): Promise<RiskCell> {
  let pending = cellCache.get(key);
  if (!pending) {
    pending = getJson<RiskCell>(`risk/${key}.json`);
    pending.catch(() => cellCache.delete(key));
    cellCache.set(key, pending);
  }
  return pending;
}

const coastCache = new Map<string, Promise<CoastCell>>();

/** One OpenStreetMap coast cell (coast.ts); a failed fetch is retried next time. */
export function loadCoastCell(key: string): Promise<CoastCell> {
  let pending = coastCache.get(key);
  if (!pending) {
    pending = getJson<CoastCell>(`coast/${key}.json`);
    pending.catch(() => coastCache.delete(key));
    coastCache.set(key, pending);
  }
  return pending;
}

const nameCache = new Map<string, Promise<NameCell>>();

/** One Danske Stednavne cell (names.ts); a failed fetch is retried next time. */
export function loadNameCell(key: string): Promise<NameCell> {
  let pending = nameCache.get(key);
  if (!pending) {
    pending = getJson<NameCell>(`names/${key}.json`);
    pending.catch(() => nameCache.delete(key));
    nameCache.set(key, pending);
  }
  return pending;
}

let placeInfo: Promise<PlaceInfoFile> | null = null;

/** The place cards (placecard.ts), one small file fetched on the first pin;
 * a failed fetch is retried next time. */
export function loadPlaceInfo(file: string): Promise<PlaceInfoFile> {
  if (!placeInfo) {
    const pending = getJson<PlaceInfoFile>(file);
    pending.catch(() => {
      if (placeInfo === pending) placeInfo = null;
    });
    placeInfo = pending;
  }
  return placeInfo;
}
