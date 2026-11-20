import type { Manifest, RiskCell, SpeciesDoc } from "./types";

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
