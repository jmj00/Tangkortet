import { utm32nToWgs84 } from "./proj";
import {
  isPlaceName,
  loadPlaceIndex,
  normalizeName,
  parseAddressQuery,
  type AddressQuery,
  type PlaceSuggestion,
} from "./placeindex";

// Ported from Svampekortet (624fb8b; first 0024b43).
// Adressevælgeren -- Klimadatastyrelsens replacement for DAWA, which shut
// down permanently 2026-10-01 (docs/data-sources.md). Two calls where DAWA's
// autocomplete needed one: a phonetic search returns candidate ids with no
// coordinates, then one lookup gives the addresses behind them. Both use the
// same VITE_DATAFORDELER_API_KEY as the basemap (web/src/map.ts) -- a plain
// API-Key, safe to ship in client code, scoped to Datafordeler's public data.
// Without a key nothing is asked: the place search then offers towns, postal
// districts and bathing sites from the app's own list only (placeindex.ts).
//
// What the service offers (Svampekortet checked it 2026-11-19; it has no
// public documentation): `/soeg?tekst=` returns up to 100 hits of three kinds
// -- `vejnavn`, `navngivenvejpostnummer` and `husnummer` -- sorted by postal
// number, not by how well they match; spelling is matched phonetically. A
// postal number after the address ("Vestergade 10, 8600") narrows the search
// to that district; a town name does not, and a town alone finds nothing. So
// a town or postal number in the query is turned into "…, <postnr>" here
// (placeindex.ts parseAddressQuery). `/husnumre?id_lokalids=a,b` looks up
// several addresses in one request. Coordinates come in EPSG:25832.

const TOKEN = import.meta.env.VITE_DATAFORDELER_API_KEY;
const SEARCH_ENDPOINT = "https://adressevaelger.dk/soeg";
const LOOKUP_ENDPOINT = "https://adressevaelger.dk/husnumre";
const MAX_RESULTS = 6;

/** Whether addresses can be searched at all (Tangkortet's own key is set). */
export const ADDRESSES_ENABLED = Boolean(TOKEN);

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
  /** "Vestergade 10, 8600 Silkeborg" */
  titel?: string;
}

interface SearchResponse {
  status: string;
  fund: SearchHit[];
}

interface LookupItem {
  id_lokalid: string;
  husnummertekst: string;
  adgangsadressebetegnelse: string;
  vejnavn: string;
  postnummer: { navn: string; postnr: string };
  adgangspunkt: { koordinater: { x: number; y: number } };
}

interface LookupResponse {
  status: string;
  husnumre: LookupItem[];
}

/** The addresses behind the ids, in one request, in the order given. */
async function lookup(ids: string[], signal?: AbortSignal): Promise<AddressSuggestion[]> {
  if (ids.length === 0) return [];
  const res = await fetch(`${LOOKUP_ENDPOINT}?id_lokalids=${ids.join(",")}&token=${TOKEN}`, {
    signal,
  });
  if (!res.ok) throw new Error(`Adressevælgeren responded ${res.status}`);
  const data = (await res.json()) as LookupResponse;
  const byId = new Map((data.husnumre ?? []).map((item) => [item.id_lokalid, item]));
  const out: AddressSuggestion[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    const point = item?.adgangspunkt?.koordinater;
    if (!item || !point) continue;
    const [lon, lat] = utm32nToWgs84(point.x, point.y);
    out.push({
      tekst: item.adgangsadressebetegnelse,
      adgangsadresse: {
        id,
        vejnavn: item.vejnavn,
        husnr: item.husnummertekst,
        postnr: item.postnummer.postnr,
        postnrnavn: item.postnummer.navn,
        x: lon,
        y: lat,
      },
    });
  }
  return out;
}

/** The ids of the addresses one search finds. */
async function soeg(text: string, signal?: AbortSignal, prefer: string[] = []): Promise<string[]> {
  const res = await fetch(`${SEARCH_ENDPOINT}?tekst=${encodeURIComponent(text)}&token=${TOKEN}`, {
    signal,
  });
  if (!res.ok) throw new Error(`Adressevælgeren responded ${res.status}`);
  const data = (await res.json()) as SearchResponse;
  const hits = (data.fund ?? []).filter((hit) => hit.type === "husnummer");
  return preferHits(hits, prefer).map((hit) => hit.id);
}

/** Pure: the hits in a preferred postal district first (by the district name
 * at the end of each title, "Vestergade 10, 1456 København K"), otherwise
 * in the service's order. */
export function preferHits<T extends { titel?: string }>(hits: T[], prefer: string[]): T[] {
  if (prefer.length === 0) return hits;
  const inPreferred = (hit: T): boolean => {
    const district = normalizeName((hit.titel ?? "").replace(/^.*,\s*\d{4}\s+/, ""));
    return prefer.includes(district);
  };
  return [...hits.filter(inPreferred), ...hits.filter((hit) => !inPreferred(hit))];
}

/** Pure: the hits of several searches as one list, each search's own order
 * kept and its turn taken in order (the first search is the best guess), no
 * address twice. */
export function mergeHits(lists: string[][], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const id of list) {
      if (out.length >= max) return out;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** What an address search found. `missed`: a town or postal number was read
 * out of the query and has no such address; what is listed is from anywhere. */
export interface AddressResult {
  addresses: AddressSuggestion[];
  missed?: { street: string; town: string; place: PlaceSuggestion | null };
}

/**
 * Addresses for what is typed. A town or postal number in the query narrows
 * the search to its postal district; when that finds nothing, the street is
 * tried nationwide, and the result says so. A query that is just a place's
 * name asks nothing: the service would only answer with streets that sound
 * alike. Only the typed text goes to the service. Without a key: nothing.
 */
export async function searchAddresses(query: string, signal?: AbortSignal): Promise<AddressResult> {
  const q = query.trim();
  if (q.length < 3 || !TOKEN) return { addresses: [] };

  const index = await loadPlaceIndex().catch(() => null); // without it: the query as typed
  if (index && isPlaceName(index, q)) return { addresses: [] };
  const parsed: AddressQuery = index ? parseAddressQuery(index, q) : { texts: [q], scoped: false };
  const prefer = parsed.prefer ?? [];
  let ids = mergeHits(
    await Promise.all(parsed.texts.map((t) => soeg(t, signal, prefer))),
    MAX_RESULTS,
  );
  let missed: AddressResult["missed"];
  if (ids.length === 0 && parsed.scoped && parsed.texts.length > 0) {
    ids = mergeHits([await soeg(parsed.street ?? q, signal)], MAX_RESULTS);
    if (parsed.street && parsed.town) {
      missed = { street: parsed.street, town: parsed.town, place: parsed.place ?? null };
    }
  }
  return { addresses: await lookup(ids, signal), missed };
}
