// Shapes of the published payload (pipeline/publish.py).

export type Attachment = "attached" | "drift" | "unknown";

/** Index order of `Attachment` in a packed observation (pipeline ATTACHMENT_CODE). */
export const ATTACHMENTS: readonly Attachment[] = ["attached", "drift", "unknown"];

export interface Attribution {
  observations: string;
  basemap: string;
  risk: string;
  weather: string;
  /** Since the species photos (2026-11); absent in older payloads. */
  photos?: string;
  /** The OpenStreetMap coast cells (ODbL); absent in older payloads. */
  coast?: string;
  /** Danske Stednavne (CC BY 4.0); absent in older payloads. */
  names?: string;
  /** The place cards (Wikipedia CC BY-SA, Commons photos); absent in older payloads. */
  places?: string;
}

export interface SpeciesSummary {
  slug: string;
  danish_name: string;
  scientific_name: string;
  group: string;
  invasive: boolean;
  observation_count: number;
  attachment_counts: Record<Attachment, number>;
  file: string;
  /** A small rendition of the first photo (iNaturalist `small`), or null. */
  thumbnail?: string | null;
  /** Finds per calendar month (index 0 = January); absent in older payloads. */
  finds_by_month?: FindsByMonth;
  /** The expert's best harvest months (1-12), null until answered. */
  season_months?: number[] | null;
  /** Copies of the document's expert accumulation, warnings and sign-off, for
   * the list's species-level risk badges (season.ts riskFlags). */
  accumulation?: ExpertFields["accumulation"];
  warnings?: string[];
  /** Natural toxins a warning names, e.g. "kainsyre" (pipeline/species.py). */
  toxins?: string[];
  expert_verified?: boolean;
}

/** When finds were *recorded*, per calendar month (index 0 = January): not
 * when the species is good to collect. */
export interface FindsByMonth {
  all: number[];
  attached: number[];
}

export interface RiskLayerInfo {
  label: string;
  /** Column names of a row, starting with "lon", "lat". */
  fields: string[];
  source: string;
  count: number;
}

export interface RiskIndex {
  cell_deg: number;
  /** Cell keys that have a file, "<floor(lon/deg)>_<floor(lat/deg)>". */
  cells: string[];
  layers: Record<string, RiskLayerInfo>;
}

export interface Manifest {
  version: string;
  attribution: Attribution;
  species: SpeciesSummary[];
  risk: RiskIndex | null;
  /** Absent in payloads from before the coast cells. */
  coast?: CoastIndex | null;
  /** Absent in payloads from before the names cells. */
  names?: NamesIndex | null;
  /** The place cards (placecard.ts); absent in payloads from before them. */
  place_info?: PlaceInfoIndex | null;
}

/** One file of place cards (pipeline/placeinfo.py), loaded on the first pin. */
export interface PlaceInfoIndex {
  file: string;
  count: number;
  source: string;
  /** The texts' licence (Wikipedia: CC BY-SA 4.0); each photo has its own. */
  license: string;
  license_url?: string;
  fetched?: string | null;
}

export interface PlacePhoto {
  /** 330 px wide (an upload.wikimedia.org thumbnail at a standard step). */
  small: string;
  /** 960 px wide. */
  large: string;
  width?: number;
  height?: number;
  /** Plain text, from Commons' Artist field, cleaned of wiki noise
   * (pipeline/placeinfo.py clean_author); the uploader when it names none. */
  author: string;
  /** "CC BY-SA 4.0", "CC BY 2.0", "CC0", "Public domain". */
  license: string;
  license_url?: string;
  /** The file's page on Wikimedia Commons. */
  page?: string;
}

/** A well-known coastal place with a photo and a sentence or two. */
export interface PlaceCard {
  /** The Wikidata item, "Q5256478". */
  id: string;
  name: string;
  /** "beach", "harbour", "marina", "headland", ... (placecard.ts KIND_LABEL) */
  kind: string;
  lon: number;
  lat: number;
  /** The OpenStreetMap outline (simplified), when the place is an area or a line. */
  geom?: { type: "ring" | "line"; coords: [number, number][] };
  /** A peninsula's or islet's shore: the OpenStreetMap coastline along its
   * outline (simplified). Its card shows only near it, never inland. */
  shore?: [number, number][][];
  text?: string;
  text_source?: "wikipedia_da" | "wikipedia_en" | "wikidata";
  article?: { url: string; lang: "da" | "en" };
  photo?: PlacePhoto;
  /** False until the owner has looked at the card. */
  reviewed: boolean;
}

export interface PlaceInfoFile {
  places: PlaceCard[];
}

/** Official coastal place names, Danske Stednavne (pipeline/ingest/stednavne.py). CC BY 4.0. */
export interface NamesIndex {
  cell_deg: number;
  cells: string[];
  coverage: string[] | null;
  source: string;
  license: string;
  /** https://creativecommons.org/licenses/by/4.0/ */
  license_url?: string;
  fetched?: string | null;
}

/** `[id, kind, type, coords, name, area_ha?]`: kind the Stednavne type
 * ("strand", "lystbådehavn", "pynt", "bugt", "tørtVedLavvande", "havbad",
 * ...); type "p" (coords `[x, y]`), "l" (delta-encoded as the coast cells) or
 * "a" (coords a list of delta-encoded rings, even-odd); area_ha the whole
 * area's size. A water is clipped to the cell; it keeps its id everywhere. */
export type NameRow = [number, string, "p" | "l" | "a", number[] | number[][], string, number?];

export interface NameCell {
  features: NameRow[];
}

/** The OpenStreetMap coast cells (pipeline/ingest/coast.py). ODbL. */
export interface CoastIndex {
  cell_deg: number;
  /** Cell keys that have a file, as for the risk cells. */
  cells: string[];
  /** The cells the data was cut to (the dev sample), or null for Denmark. */
  coverage: string[] | null;
  source: string;
  license: string;
  /** https://opendatacommons.org/licenses/odbl/1-0/ */
  license_url?: string;
  osm_timestamp?: string | null;
}

export type CoastKind =
  | "beach"
  | "sand"
  | "saltmarsh"
  | "tidalflat"
  | "harbour"
  | "marina"
  | "pier"
  | "groyne"
  | "breakwater"
  | "cliff"
  | "coastline";

/** `[id, kind, type, deltas, name?, detail?]`: type "p" point, "l" line, "a"
 * area (outer ring); deltas `[x0, y0, dx1, dy1, ...]` in 1e-5 degrees; detail
 * a beach's surface or "bade" for a bathing jetty. */
export type CoastRow = [string, CoastKind, "p" | "l" | "a", number[], (string | null)?, string?];

/** One coast cell file. */
export interface CoastCell {
  coastline: number[][];
  features: CoastRow[];
}

/** [lon, lat, year|null, attachment index, depth_m|null, dataset index] */
export type ObservationRow = [number, number, number | null, 0 | 1 | 2, number | null, number];

export interface ExpertFields {
  /** True once the expert has signed off the fields below. */
  verified: boolean;
  depth_m: [number, number] | null;
  harvest_method: "klip_skudspids" | "hel_plade" | "andet" | null;
  season_months: number[] | null;
  accumulation: ("jod" | "arsen" | "cadmium")[] | null;
}

/** A CC0 / CC BY photo hotlinked from iNaturalist (data/images/README.md). */
export interface SpeciesImage {
  /** The `large` rendition; thumb.ts derives the others from it. */
  url: string;
  credit: string;
  license: string;
  photo_url: string | null;
  observation_url: string | null;
  /** False until the expert has confirmed the identification. */
  reviewed: boolean;
}

export interface SpeciesDoc {
  slug: string;
  /** "" when the national species checklist has no Danish name. */
  danish_name: string;
  danish_name_verified: boolean;
  scientific_name: string;
  group: string;
  gbif_usage_key: number;
  invasive: boolean;
  /** Scientific names the expert says it is easily confused with. */
  lookalikes: string[];
  /** Danish advice shown prominently (official recommendations, via the expert). */
  warnings: string[];
  /** Natural toxins a warning names, e.g. "kainsyre". */
  toxins?: string[];
  expert: ExpertFields;
  observed_depth: { n: number; p10: number; median: number; p90: number } | null;
  attachment_counts: Record<Attachment, number>;
  observation_count: number;
  /** Absent in payloads from before the month counts. */
  finds_by_month?: FindsByMonth;
  datasets: { title: string; license: string }[];
  observations: ObservationRow[];
  /** Absent in payloads from before the photos. */
  images?: SpeciesImage[];
}

/** One risk cell file: layer key -> rows (`RiskLayerInfo.fields`). */
export type RiskCell = Record<string, unknown[][]>;

/** The name to show: Danish when the national checklist has one, else scientific. */
export function shownName(s: { danish_name: string; scientific_name: string }): string {
  return s.danish_name || s.scientific_name;
}
