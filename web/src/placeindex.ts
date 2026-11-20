// Towns, postal districts and coastal bathing sites for the place search.
// Adapted from Svampekortet 624fb8b (web/src/placeindex.ts, ADR-0022 there).
//
// Adressevælgeren (the address service, addresses.ts) knows streets and house
// numbers only: a town name typed alone finds nothing, and a town after an
// address ("Vestergade 10 Silkeborg") does not narrow the search -- the answer
// comes sorted by postal number, so København K first. What it does honour is
// a postal number after the address ("Vestergade 10, 8600"). And Tangkortet
// may have no key for it at all. So the app carries its own list
// (web/src/data/places.json, built by pipeline/places.py):
//
//   - towns, parts of towns and holiday-home areas (Danske Stednavne) and
//     postal districts (DAGI), from Svampekortet's list;
//   - named coastal bathing sites (Miljøstyrelsen's badevand layer): the
//     beaches a forager names ("Vemmetofte Strand").
//
// It is used two ways: a typed place is a suggestion of its own
// (matchPlaces), and a town or postal number after an address is turned into
// the postal number the service understands (parseAddressQuery).
//
// Everything here is pure except loadPlaceIndex, which fetches the list (about
// 155 kB gzipped) the first time the search field is focused.

import placesUrl from "./data/places.json?url";
import { distanceM } from "./geo";

export interface Town {
  name: string;
  lon: number;
  lat: number;
  /** Radius of a circle of the town's area (km). */
  radiusKm: number;
  /** The postal district the town's point lies in (index), or -1. */
  postal: number;
  /** 0 a town or village, 1 part of a town, 2 a holiday-home area. */
  type: 0 | 1 | 2;
}

export interface PostalDistrict {
  postnr: string;
  name: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
}

/** A named coastal bathing site. */
export interface CoastSite {
  name: string;
  lon: number;
  lat: number;
  /** The postal district of the nearest town (index), or -1. */
  postal: number;
  /** normalizeName(name), for matching. */
  key: string;
}

export interface PlaceIndex {
  towns: Town[];
  postal: PostalDistrict[];
  coast: CoastSite[];
  byPostnr: Map<string, PostalDistrict>;
  /** Normalised name -> towns of that name, the one it means first. */
  townsByName: Map<string, Town[]>;
  /** Normalised name -> postal districts of that name ("aarhus c"). */
  postalByName: Map<string, PostalDistrict[]>;
  /** Every normalised town and district name, sorted, for prefix search. */
  names: string[];
  /** Postal number -> the district's main town: where a district is on land
   * (its box takes in the sea around it). */
  mainTown: Map<string, Town>;
}

export interface RawPlaces {
  postal: [string, string, number, number, number, number][];
  towns: [string, number, number, number, number, number][];
  coast?: [string, number, number, number][];
}

/** "Århus", "aarhus" and "AARHUS" are one search; so are "Sankt" and "Skt."
 * spelled either way with dots, dashes and commas. */
export function normalizeName(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/aa/g, "å")
    .replace(/[.,/()\-–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildPlaceIndex(raw: RawPlaces): PlaceIndex {
  const postal: PostalDistrict[] = raw.postal.map(([postnr, name, w, s, e, n]) => ({
    postnr,
    name,
    bbox: [w, s, e, n],
  }));
  const towns: Town[] = raw.towns.map(([name, lon, lat, radiusKm, district, type]) => ({
    name,
    lon,
    lat,
    radiusKm,
    postal: district,
    type: (type === 1 || type === 2 ? type : 0) as Town["type"],
  }));
  const coast: CoastSite[] = (raw.coast ?? []).map(([name, lon, lat, district]) => ({
    name,
    lon,
    lat,
    postal: district,
    key: normalizeName(name),
  }));
  const byPostnr = new Map(postal.map((p) => [p.postnr, p]));
  const townsByName = new Map<string, Town[]>();
  for (const town of towns) {
    const key = normalizeName(town.name);
    const list = townsByName.get(key) ?? [];
    list.push(town);
    townsByName.set(key, list);
  }
  for (const list of townsByName.values()) {
    // the one the name is known for first (Hellerup in 2900 Hellerup, not the
    // hamlet of that name on Funen), then towns before parts of towns, larger first
    list.sort(
      (a, b) =>
        Number(knownBy(postal, b)) - Number(knownBy(postal, a)) ||
        a.type - b.type ||
        b.radiusKm - a.radiusKm,
    );
  }
  const postalByName = new Map<string, PostalDistrict[]>();
  for (const district of postal) {
    const key = normalizeName(district.name);
    const list = postalByName.get(key) ?? [];
    list.push(district);
    postalByName.set(key, list);
  }
  const names = [...new Set([...townsByName.keys(), ...postalByName.keys()])].sort();
  const mainTown = new Map<string, Town>();
  for (const town of towns) {
    const district = postal[town.postal];
    if (!district) continue;
    const best = mainTown.get(district.postnr);
    if (!best || mainRank(district, town) < mainRank(district, best))
      mainTown.set(district.postnr, town);
  }
  return { towns, postal, coast, byPostnr, townsByName, postalByName, names, mainTown };
}

/** How well a town stands for its district, lower is better: the one of
 * the district's own name (Blåvand for 6857 Blåvand, even as a holiday-home
 * area), else a town before a part of one before a holiday-home area, the
 * largest first. */
function mainRank(district: PostalDistrict, town: Town): number {
  const named = normalizeName(town.name) === normalizeName(district.name) ? 0 : 1;
  return named * 1000 + town.type * 100 - Math.min(town.radiusKm, 99);
}

/** Whether `a` and `b` are at most one typing slip apart (a letter missing,
 * extra, wrong, or two swapped). */
export function oneSlipApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const restA = a.slice(i);
  const restB = b.slice(i);
  if (restA.slice(1) === restB.slice(1)) return true; // replaced
  if (restA.slice(1) === restB || restA === restB.slice(1)) return true; // dropped or added
  return (
    restA.length >= 2 &&
    restA[0] === restB[1] &&
    restA[1] === restB[0] &&
    restA.slice(2) === restB.slice(2)
  );
}

/** The names in the index at most one slip from `key` (keys of 5 letters or
 * more: shorter ones match too much by accident). */
function nearNames(index: PlaceIndex, key: string): string[] {
  if (key.length < 5) return [];
  return index.names.filter(
    (name) => Math.abs(name.length - key.length) <= 1 && oneSlipApart(name, key),
  );
}

/** The postal districts a typed name means: its own name ("Silkeborg"), the
 * parts of a city ("Aarhus" -> Aarhus C, N, V), or one slip away. */
export function postalFor(index: PlaceIndex, name: string): PostalDistrict[] {
  const key = normalizeName(name);
  if (!key) return [];
  const exact = index.postalByName.get(key);
  if (exact) return exact;
  const parts = index.postal.filter((p) => {
    const n = normalizeName(p.name);
    return n.startsWith(`${key} `) && n.length - key.length <= 2; // "aarhus c", "odense sø"
  });
  if (parts.length) return parts;
  return nearNames(index, key).flatMap((n) => index.postalByName.get(n) ?? []);
}

/** The towns a typed name means: exactly that name, or one slip away. */
export function townsFor(index: PlaceIndex, name: string): Town[] {
  const key = normalizeName(name);
  if (!key) return [];
  const exact = index.townsByName.get(key);
  if (exact) return exact;
  return nearNames(index, key).flatMap((n) => index.townsByName.get(n) ?? []);
}

export interface AddressQuery {
  /** What to send to the address service, one search each (at most ten). */
  texts: string[];
  /** True when a town or postal number was read out of the query. */
  scoped: boolean;
  /** The street part and the town as the query names them, when a town or
   * postal number was read out (for saying that it has no such address). */
  street?: string;
  town?: string;
  /** The town or district itself, to offer when it has no such address. */
  place?: PlaceSuggestion;
  /** Postal district names (normalised) whose addresses go first: for a
   * city of many postal numbers (København K has one for every few
   * streets), where narrowing by number would miss most of it. */
  prefer?: string[];
}

const MAX_SCOPES = 10;

/**
 * What to ask the address service for. A postal number anywhere after the
 * street ("Vestergade 10 8600", "Vestergade 10, 8600 Silkeborg") or a town at
 * the end ("Vestergade 10 Silkeborg", "Hovedvejen 3, Rold") becomes the form
 * the service filters on: "Vestergade 10, 8600". A town that is a postal
 * district's name is taken at its word; any other town only after a comma or
 * a house number, so that a street such as "Rold Skovvej" is not cut in two.
 * Without either, the query goes as typed.
 */
export function parseAddressQuery(index: PlaceIndex, query: string): AddressQuery {
  const typed = query.trim().replace(/\s+/g, " ");
  // tokens, with where the commas were
  const parts = typed.split(",");
  const tokens: string[] = [];
  const commaBefore = new Set<number>();
  parts.forEach((part, i) => {
    if (i > 0) commaBefore.add(tokens.length);
    tokens.push(...part.trim().split(" ").filter(Boolean));
  });
  const n = tokens.length;
  const plain: AddressQuery = { texts: typed ? [typed] : [], scoped: false };

  // a postal number after the street
  for (let i = n - 1; i >= 0; i--) {
    if (!/^\d{4}$/.test(tokens[i]) || !index.byPostnr.has(tokens[i])) continue;
    if (i === 0) return { texts: [], scoped: true }; // just a number: a district, not an address
    const district = index.byPostnr.get(tokens[i]) as PostalDistrict;
    const street = tokens.slice(0, i).join(" ");
    return {
      texts: [`${street}, ${tokens[i]}`],
      scoped: true,
      street,
      town: `${district.postnr} ${district.name}`,
      place: districtSuggestion(index, district),
    };
  }

  // a town at the end: the longest that is one, up to three words
  for (let k = Math.min(3, n - 1); k >= 1; k--) {
    const rest = tokens.slice(0, n - k);
    const name = tokens.slice(n - k).join(" ");
    const evidence = commaBefore.has(n - k) || rest.some((t) => /\d/.test(t));
    const districts = postalFor(index, name);
    let postnrs = districts.map((p) => p.postnr);
    let place: PlaceSuggestion | undefined;
    let townName = districts[0]?.name;
    const towns = townsFor(index, name);
    if (towns[0]) {
      place = townSuggestion(index, towns[0]);
      townName = towns[0].name;
    } else if (districts[0]) place = districtSuggestion(index, districts[0]);
    if (postnrs.length === 0 && evidence) {
      postnrs = towns
        .map((town) => index.postal[town.postal]?.postnr)
        .filter((p): p is string => Boolean(p));
    }
    const unique = [...new Set(postnrs)];
    if (unique.length === 0) continue;
    const street = rest.join(" ");
    if (unique.length > MAX_SCOPES) {
      const names = unique.map((p) => normalizeName(index.byPostnr.get(p)?.name ?? ""));
      return {
        texts: [street],
        scoped: true,
        street,
        town: townName,
        place,
        prefer: [...new Set(names)].filter(Boolean),
      };
    }
    return {
      texts: unique.map((p) => `${street}, ${p}`),
      scoped: true,
      street,
      town: townName,
      place,
    };
  }
  return plain;
}

/** Whether the query is just a place's name (a town, a postal district, a
 * bathing site): nothing to ask the address service. */
export function isPlaceName(index: PlaceIndex, query: string): boolean {
  const key = normalizeName(query);
  return (
    !/\d/.test(key) &&
    (index.townsByName.has(key) ||
      index.postalByName.has(key) ||
      index.coast.some((c) => c.key === key))
  );
}

export type PlaceKind = "town" | "postal" | "coast";

/** A place the search offers, and how close to fly. */
export interface PlaceSuggestion {
  /** The name, as the list shows it and the pin is called: "Rold",
   * "6857 Blåvand", "Vemmetofte Strand". */
  text: string;
  /** What it is and where, in a second, quieter line: "By · 9510 Arden",
   * "Postnummer", "Badested · 4640 Faxe". */
  meta: string;
  kind: PlaceKind;
  target: [number, number];
  zoom: number;
  /** 0: what was typed is its name (or postal number); 1: its name or one of
   * its words begins so; 2: the name has it inside a word. */
  rank: number;
}

/** How close to fly to a town of this size: its surroundings in view. */
export function townZoom(radiusKm: number): number {
  if (radiusKm < 0.4) return 14;
  if (radiusKm < 0.8) return 13.5;
  if (radiusKm < 1.5) return 13;
  if (radiusKm < 3) return 12;
  return 11.5;
}

/** How close to fly for a postal district with no town: the whole district. */
export function districtZoom([w, s, e, n]: [number, number, number, number]): number {
  const lat = ((s + n) / 2) * (Math.PI / 180);
  const spanKm = Math.max((e - w) * 111.32 * Math.cos(lat), (n - s) * 110.57, 1);
  // about 320 px of map across the district on a phone
  const zoom = Math.log2((40075 * Math.cos(lat) * 320) / (256 * spanKm));
  return Math.round(Math.min(13, Math.max(8.5, zoom)) * 2) / 2;
}

/** A bathing site: close enough to see the shore and what lies behind it. */
export const COAST_ZOOM = 14;

/**
 * Whether the name means this town: it lies in the postal district of its own
 * name ("Hellerup" in 2900 Hellerup, "Aarhus" for 8000 Aarhus C), or it is a
 * city, whose middle may lie in any of its districts (Aarhus's in 8230
 * Åbyhøj). A hamlet that shares a district's name but lies elsewhere (the
 * Hellerup in 5750 Ringe) is not.
 */
export function knownBy(postal: readonly PostalDistrict[], town: Town): boolean {
  if (town.type === 2) return false;
  if (isCity(town)) return true;
  const district = postal[town.postal];
  if (!district) return false;
  const key = normalizeName(town.name);
  const own = normalizeName(district.name);
  return own === key || own.startsWith(`${key} `);
}

const isCity = (town: Town): boolean => town.type === 0 && town.radiusKm >= 2;

const TOWN_TYPE = ["By", "Bydel", "Sommerhusområde"] as const;

function districtText(district: PostalDistrict | undefined): string {
  return district ? `${district.postnr} ${district.name}` : "";
}

function townSuggestion(index: PlaceIndex, town: Town, rank = 0): PlaceSuggestion {
  // A city is shown without a district: its middle can lie in any of them.
  // and one in the district of its own name by its number alone ("By · 9990")
  const district = index.postal[town.postal];
  const own = district && normalizeName(district.name) === normalizeName(town.name);
  const where = isCity(town) ? "" : own ? district.postnr : districtText(district);
  return {
    text: town.name,
    meta: [TOWN_TYPE[town.type], where].filter(Boolean).join(" · "),
    kind: "town",
    target: [town.lon, town.lat],
    zoom: townZoom(town.radiusKm),
    rank,
  };
}

/** Where a postal district is: its main town, at a zoom that shows the town
 * (the middle of its box can be in the sea: 6857 Blåvand's is 60 km out in
 * the North Sea). Only a district with no town falls back to its box. */
export function districtPoint(
  index: PlaceIndex,
  district: PostalDistrict,
): { target: [number, number]; zoom: number } {
  const town = index.mainTown.get(district.postnr);
  if (town) return { target: [town.lon, town.lat], zoom: Math.min(13, townZoom(town.radiusKm)) };
  const [w, s, e, n] = district.bbox;
  return { target: [(w + e) / 2, (s + n) / 2], zoom: districtZoom(district.bbox) };
}

function districtSuggestion(
  index: PlaceIndex,
  district: PostalDistrict,
  rank = 0,
): PlaceSuggestion {
  return {
    text: districtText(district),
    meta: "Postnummer",
    kind: "postal",
    ...districtPoint(index, district),
    rank,
  };
}

function coastSuggestion(index: PlaceIndex, site: CoastSite, rank: number): PlaceSuggestion {
  const where = districtText(index.postal[site.postal]);
  return {
    text: site.name,
    meta: where ? `Badested · ${where}` : "Badested",
    kind: "coast",
    target: [site.lon, site.lat],
    zoom: COAST_ZOOM,
    rank,
  };
}

/** How well a name matches what is typed (both normalised): 0 it is the
 * name, 1 the name or one of its words begins with it, 2 it is inside a
 * word, -1 not at all. */
export function nameRank(name: string, key: string): number {
  if (!key) return -1;
  if (name === key || name.replace(/ /g, "") === key.replace(/ /g, "")) return 0;
  if (name.startsWith(key) || name.includes(` ${key}`)) return 1;
  return name.includes(key) ? 2 : -1;
}

/** A beach name one slip from what is typed: 0 the whole name ("vemmetofte
 * strnd"), 1 its beginning ("vemmetofte strnd" for a longer name), -1 not. */
export function coastSlip(name: string, key: string): number {
  if (oneSlipApart(name, key)) return 0;
  for (let len = key.length - 1; len <= key.length + 1; len++) {
    if (len < name.length && oneSlipApart(name.slice(0, len), key)) return 1;
  }
  return -1;
}

/** At most this many of each kind, and in all. */
export const LIMITS = { towns: 4, coast: 4, total: 6 };

interface Candidate {
  s: PlaceSuggestion;
  /** Within one rank: 0 the town or district the name means, 1 a bathing
   * site, 2 any other town or district. */
  tier: number;
  /** Larger first, within a tier. */
  size: number;
}

/**
 * Towns, postal districts and bathing sites for what is typed, the best
 * first. A postal number gives its district (three digits: the districts
 * that begin so). A name gives, by how well it matches (the name itself,
 * then names or words that begin with it, then names that only contain it,
 * from four letters): the town or district the name means first, then
 * bathing sites, then other towns (a part of a town, a hamlet of the same
 * name, a holiday-home area). So "Skagen" lists the town before "Skagen
 * Søndre Strand", and "Vemmetofte Strand" the beach without the holiday-home
 * area of that name beside it. A name one slip off counts when nothing begins
 * with what is typed, and then one with æ, ø, å typed as a, o ("Fano"). One or
 * two letters find only a name that is just that ("Ry", "Å"). A postal number
 * before or after a town ("Silkeborg 8600") gives the district.
 */
export function matchPlaces(index: PlaceIndex, query: string): PlaceSuggestion[] {
  const typed = query.trim();
  // "8600 Silkeborg", "8600Silkeborg", "Silkeborg 8600", "Silkeborg, 8600"
  const lead = /^(\d{3,4})(?:\s*,?\s*(\D.*))?$/.exec(typed);
  const trail = lead ? null : /^(\D+?)\s*,?\s*(\d{4})$/.exec(typed);
  const digits = lead ? lead[1] : trail?.[2];
  if (digits) {
    const named = lead ? lead[2] : trail?.[1];
    if (digits.length === 4) {
      const district = index.byPostnr.get(digits);
      if (!district) return [];
      // the town of that name in the district first, when one is named
      const towns = named
        ? townsFor(index, named).filter((t) => index.postal[t.postal] === district)
        : [];
      return [
        ...towns.slice(0, 1).map((t) => townSuggestion(index, t, 0)),
        districtSuggestion(index, district, 0),
      ];
    }
    if (named) return [];
    return index.postal
      .filter((p) => p.postnr.startsWith(digits))
      .filter((p, i, all) => all.findIndex((o) => o.name === p.name) === i) // København K once
      .slice(0, LIMITS.total)
      .map((p) => districtSuggestion(index, p, 1));
  }
  const key = aliasOf(normalizeName(typed));
  if (!key || /\d/.test(key)) return [];
  // one or two letters ("Ry", "Ø", "Å"): only a name that is just that
  if (typed.replace(/\s/g, "").length < MIN_LETTERS) return exactPlaces(index, key);

  const found = matchName(index, key);
  if (found.length > 0) return found;
  // "Fano", "Romo", "Kobenhavn": æ, ø and å typed as plain letters. First
  // with æ as "ae" ("Aero" is Ærø, not Årø), then with æ as "a" too.
  for (const loose of [false, true]) {
    const plain = foldLetters(key, loose);
    const fold = (n: string): string => foldLetters(n, loose);
    const names = [
      ...index.names.filter((n) => fold(n) === plain),
      ...index.names.filter((n) => fold(n).startsWith(plain) && fold(n) !== plain),
      ...index.coast.filter((c) => fold(c.key).startsWith(plain)).map((c) => c.key),
    ];
    if (names.length > 0) return matchName(index, names[0]);
  }
  return [];
}

/** From this many letters a name is searched by its beginning; below it only
 * a name that is just what is typed ("Ry", "Ho", "Å"). */
export const MIN_LETTERS = 3;

/** Short names people type for a place. */
const ALIASES: Record<string, string> = {
  kbh: "københavn",
  cph: "københavn",
  kbhvn: "københavn",
};

function aliasOf(key: string): string {
  return ALIASES[key] ?? key;
}

/** æ, ø and å as a keyboard without them writes them: "fano", "romo", "arhus". */
export function foldLetters(key: string, loose = false): string {
  const strict = key.replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a");
  // loose: æ typed as a plain "a" as well ("Nastved")
  return loose ? strict.replace(/ae/g, "a") : strict;
}

/** The places whose name is just `key`: towns (the one it means), postal
 * districts and bathing sites. For one or two letters, where a prefix would
 * match half the country. */
export function exactPlaces(index: PlaceIndex, key: string): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = [];
  const towns = index.townsByName.get(key) ?? [];
  out.push(...towns.slice(0, 2).map((t) => townSuggestion(index, t, 0)));
  if (!towns.some((t) => knownBy(index.postal, t))) {
    for (const district of index.postalByName.get(key) ?? [])
      out.push(districtSuggestion(index, district, 0));
  }
  for (const site of index.coast) {
    if (site.key === key) out.push(coastSuggestion(index, site, 0));
  }
  return out.slice(0, LIMITS.total);
}

function matchName(index: PlaceIndex, key: string): PlaceSuggestion[] {
  const towns: Candidate[] = [];
  // names that are, or begin with, what is typed (binary search for the start)
  let lo = 0;
  let hi = index.names.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (index.names[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  let keys: string[] = [];
  for (let i = lo; i < index.names.length && index.names[i].startsWith(key); i++)
    keys.push(index.names[i]);
  const slipped = keys.length === 0;
  if (slipped) keys = nearNames(index, key);

  for (const name of keys) {
    const rank = name === key || slipped ? 0 : 1;
    const named = index.townsByName.get(name) ?? [];
    for (const town of named.slice(0, 2)) {
      // two of a name at most: the one it means, then the largest
      const meant = knownBy(index.postal, town);
      towns.push({
        s: townSuggestion(index, town, rank),
        tier: meant ? 0 : 2,
        size: town.radiusKm,
      });
    }
    // A district of the name when no town the name means is there; first
    // when towns of the name lie only elsewhere (9940 Læsø before the hamlet
    // on Lolland).
    if (!named.some((town) => knownBy(index.postal, town))) {
      for (const district of index.postalByName.get(name) ?? []) {
        towns.push({ s: districtSuggestion(index, district, rank), tier: 0, size: 1 });
      }
    }
  }
  // "Lyngby" for 2800 Kongens Lyngby: a district whose last word is what was
  // typed, unless a town the name means is already there
  const meant = (index.townsByName.get(key) ?? []).some((town) => knownBy(index.postal, town));
  if (!meant && key.length >= 4) {
    for (const district of index.postal) {
      if (normalizeName(district.name).endsWith(` ${key}`)) {
        towns.push({ s: districtSuggestion(index, district, 0), tier: 0, size: 0 });
      }
    }
  }
  // no district of a city's parts when the city itself is offered ("Aarhus")
  const cityKeys = towns
    .filter((c) => c.s.kind === "town" && c.tier === 0)
    .map((c) => normalizeName(c.s.text));
  const keptTowns = towns.filter(
    (c) =>
      c.s.kind !== "postal" ||
      !cityKeys.some((t) => normalizeName(c.s.text.replace(/^\d{4} /, "")).startsWith(t)),
  );

  const coast: Candidate[] = [];
  for (const site of index.coast) {
    const rank = nameRank(site.key, key);
    if (rank < 0 || (rank === 2 && key.length < 4)) continue;
    coast.push({ s: coastSuggestion(index, site, rank), tier: 1, size: -site.name.length });
  }
  // a beach name one slip off ("Vemmetofte strnd"), when none has what is typed
  // (and no town has it either: "Rørvig" is not "Rødvig Øst")
  if (coast.length === 0 && (slipped || keptTowns.length === 0) && key.length >= 5) {
    for (const site of index.coast) {
      const rank = coastSlip(site.key, key);
      if (rank >= 0)
        coast.push({ s: coastSuggestion(index, site, rank), tier: 1, size: -site.name.length });
    }
  }
  // a town or holiday-home area named after the beach beside it: the beach is
  // what was meant ("Vemmetofte Strand")
  const beside = (c: Candidate): boolean =>
    c.s.kind === "town" &&
    coast.some(
      (b) =>
        normalizeName(b.s.text) === normalizeName(c.s.text) &&
        distanceM(b.s.target, c.s.target) <= 1000,
    );

  const order = (a: Candidate, b: Candidate): number =>
    a.s.rank - b.s.rank || a.tier - b.tier || b.size - a.size;
  const picked = [
    ...uniqueTexts(keptTowns.filter((c) => !beside(c)).sort(order)).slice(0, LIMITS.towns),
    ...uniqueTexts(coast.sort(order)).slice(0, LIMITS.coast),
  ];
  return picked
    .sort(order)
    .slice(0, LIMITS.total)
    .map((c) => c.s);
}

/** No two suggestions that read the same (name and second line). */
function uniqueTexts(list: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const id = `${c.s.text}|${c.s.meta}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** How long a search waits for the place list before it says so ("Prøv igen"). */
export const LOAD_TIMEOUT_MS = 10_000;

/** How long the fetch itself may run before it counts as stalled. Longer than
 * LOAD_TIMEOUT_MS: on a slow coastal connection (155 kB gzipped at ~5 kB/s)
 * the fetch keeps going after a search has stopped waiting, and "Prøv igen"
 * joins it rather than starting over. */
export const STALL_MS = 45_000;

/** Fetches the raw list; aborts when the signal does. */
export type FetchPlaces = (signal: AbortSignal) => Promise<RawPlaces>;

const fetchPlaces: FetchPlaces = async (signal) => {
  const res = await fetch(placesUrl, { signal });
  if (!res.ok) throw new Error(`places.json: HTTP ${res.status}`);
  return (await res.json()) as RawPlaces;
};

export interface PlaceLoader {
  /** The list if it has arrived. */
  loaded(): PlaceIndex | null;
  /** The list, fetched once and shared by every caller. A caller stops
   * waiting after `ms`, but the fetch goes on. A fetch that fails, or is still
   * running after STALL_MS when a caller asks again, is dropped (and aborted),
   * so that call fetches afresh; a late answer from a dropped fetch is ignored. */
  load(ms?: number): Promise<PlaceIndex>;
}

export function createPlaceLoader(fetchRaw: FetchPlaces = fetchPlaces): PlaceLoader {
  let loaded: PlaceIndex | null = null;
  let current: {
    id: number;
    started: number;
    abort: AbortController;
    promise: Promise<PlaceIndex>;
  } | null = null;
  let attempts = 0;

  const drop = (id: number): void => {
    if (current?.id !== id) return; // a newer fetch: leave it be
    current.abort.abort();
    current = null;
  };

  function start(): NonNullable<typeof current> {
    const id = ++attempts;
    const abort = new AbortController();
    const promise = fetchRaw(abort.signal).then(
      (raw) => {
        if (current?.id !== id) throw new Error("place list fetch was dropped");
        loaded = buildPlaceIndex(raw);
        return loaded;
      },
      (err: unknown) => {
        drop(id);
        throw err;
      },
    );
    promise.catch(() => {}); // a caller that timed out no longer listens
    return { id, started: Date.now(), abort, promise };
  }

  return {
    loaded: () => loaded,
    load(ms = LOAD_TIMEOUT_MS): Promise<PlaceIndex> {
      if (loaded) return Promise.resolve(loaded);
      if (current && Date.now() - current.started >= STALL_MS) drop(current.id);
      current ??= start();
      const { promise } = current;
      return new Promise((resolve, reject) => {
        // Only this caller gives up; the shared fetch goes on (see STALL_MS).
        const timer = setTimeout(() => reject(new Error("place list timed out")), ms);
        promise.then(
          (index) => {
            clearTimeout(timer);
            resolve(index);
          },
          (err: unknown) => {
            clearTimeout(timer);
            reject(err);
          },
        );
      });
    },
  };
}

/** The app's own list (an asset of its build, cached offline by the service
 * worker like the rest of it). */
const placeLoader = createPlaceLoader();

/** The list if it has arrived. */
export function loadedPlaceIndex(): PlaceIndex | null {
  return placeLoader.loaded();
}

/** The list, or a rejection after LOAD_TIMEOUT_MS; a retry fetches afresh. */
export function loadPlaceIndex(): Promise<PlaceIndex> {
  return placeLoader.load();
}
