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
  expert: ExpertFields;
  observed_depth: { n: number; p10: number; median: number; p90: number } | null;
  attachment_counts: Record<Attachment, number>;
  observation_count: number;
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
