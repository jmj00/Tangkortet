import { utm32nToWgs84 } from "./proj";

// Ported from Svampekortet (0024b43).
// Adressevælgeren -- Klimadatastyrelsens replacement for DAWA, which shuts
// down permanently 2026-10-01 (docs/data-sources.md). Two calls where DAWA's
// autocomplete needed one: a phonetic search returns candidate ids with no
// coordinates, so each candidate needs a follow-up lookup by id. Both use the
// same VITE_DATAFORDELER_API_KEY as the basemap (web/src/map.ts) -- a plain
// API-Key, safe to ship in client code (unlike an OAuth Shared Secret), scoped
// to Datafordeler's public/unprotected data.
//
// Lookup responses carry coordinates in EPSG:25832 (UTM zone 32N) -- all of
// Denmark falls in one UTM zone, so utm32nToWgs84 below hard-codes it rather
// than handling zones generally. Converted here since the rest of this
// codebase works in WGS84 [lon, lat] (matches GeoJSON convention).

const TOKEN = import.meta.env.VITE_DATAFORDELER_API_KEY;
const SEARCH_ENDPOINT = "https://adressevaelger.dk/soeg";
const LOOKUP_ENDPOINT = "https://adressevaelger.dk/husnumre";
const MAX_RESULTS = 6;

// Shape kept close to DAWA's `adgangsadresser/autocomplete` item so the rest
// of the app (main.ts) didn't need to change.
export interface AddressSuggestion {
  tekst: string;
  adgangsadresse: {
    id: string;
    vejnavn: string;
    husnr: string;
    postnr: string;
    postnrnavn: string;
    x: number; // longitude, WGS84
    y: number; // latitude, WGS84
  };
}

interface SearchHit {
  type: string;
  id: string;
}

interface SearchResponse {
  status: string;
  fund: SearchHit[];
}

interface LookupResponse {
  status: string;
  husnummer: {
    husnummertekst: string;
    adgangsadressebetegnelse: string;
    vejnavn: string;
    postnummer: { navn: string; postnr: string };
    adgangspunkt: { koordinater: { x: number; y: number } };
  };
}

async function lookup(id: string, signal?: AbortSignal): Promise<AddressSuggestion | null> {
  const res = await fetch(`${LOOKUP_ENDPOINT}/${id}?token=${TOKEN}`, { signal });
  if (!res.ok) return null;
  const detail = (await res.json()) as LookupResponse;
  const { x, y } = detail.husnummer.adgangspunkt.koordinater;
  const [lon, lat] = utm32nToWgs84(x, y);
  return {
    tekst: detail.husnummer.adgangsadressebetegnelse,
    adgangsadresse: {
      id,
      vejnavn: detail.husnummer.vejnavn,
      husnr: detail.husnummer.husnummertekst,
      postnr: detail.husnummer.postnummer.postnr,
      postnrnavn: detail.husnummer.postnummer.navn,
      x: lon,
      y: lat,
    },
  };
}

export async function searchAddresses(
  query: string,
  signal?: AbortSignal,
): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3 || !TOKEN) return [];

  const res = await fetch(`${SEARCH_ENDPOINT}?tekst=${encodeURIComponent(q)}&token=${TOKEN}`, {
    signal,
  });
  if (!res.ok) throw new Error(`Adressevælgeren responded ${res.status}`);
  const data = (await res.json()) as SearchResponse;

  const ids = data.fund
    .filter((hit) => hit.type === "husnummer")
    .slice(0, MAX_RESULTS)
    .map((hit) => hit.id);
  const found = await Promise.all(ids.map((id) => lookup(id, signal)));
  return found.filter((item): item is AddressSuggestion => item !== null);
}
