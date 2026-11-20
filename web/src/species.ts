// Display logic for a species: finds near a pin, and the expert-dependent fields
// with their "afventer ekspert" / "foreløbig" fallbacks. Pure, for testing.

import { distanceM } from "./geo";
import type { Attachment, ExpertFields, SpeciesDoc } from "./types";

export const NEAR_PIN_M = 10_000;

export const PENDING = "Afventer ekspert";

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** Finds within `radiusM` of the pin, split by attachment. */
export function findsNear(
  doc: SpeciesDoc,
  pin: [number, number],
  radiusM = NEAR_PIN_M,
): { attached: number; drift: number; unknown: number; total: number } {
  const counts = { attached: 0, drift: 0, unknown: 0, total: 0 };
  for (const [lon, lat, , a] of doc.observations) {
    if (distanceM(pin, [lon, lat]) > radiusM) continue;
    counts.total++;
    if (a === 0) counts.attached++;
    else if (a === 1) counts.drift++;
    else counts.unknown++;
  }
  return counts;
}

const num = (v: number) => String(v).replace(".", ",");

export interface FieldText {
  text: string;
  /** "expert" = signed off; "provisional" = expert value not yet verified;
   * "data" = derived from finds only; "pending" = nothing yet. */
  status: "expert" | "provisional" | "data" | "pending";
}

function expertStatus(e: ExpertFields): FieldText["status"] {
  return e.verified ? "expert" : "provisional";
}

export function depthText(doc: SpeciesDoc): FieldText {
  const e = doc.expert;
  if (e.depth_m) {
    return { text: `${num(e.depth_m[0])}–${num(e.depth_m[1])} m`, status: expertStatus(e) };
  }
  const d = doc.observed_depth;
  if (d) {
    return {
      text: `Ifølge fund: typisk ${num(d.p10)}–${num(d.p90)} m (median ${num(d.median)} m, ${d.n} fund med dybde)`,
      status: "data",
    };
  }
  return { text: PENDING, status: "pending" };
}

const HARVEST: Record<string, string> = {
  klip_skudspids: "Klip skudspidserne af med saks – arten vokser fra spidserne.",
  hel_plade: "Høst hele bladpladen eller tæt ved stipes (stammen) – arten vokser fra bladpladen.",
  andet: "Se noter.",
};

export function harvestText(doc: SpeciesDoc): FieldText {
  const m = doc.expert.harvest_method;
  return m
    ? { text: HARVEST[m], status: expertStatus(doc.expert) }
    : { text: PENDING, status: "pending" };
}

export function seasonText(doc: SpeciesDoc): FieldText {
  const months = doc.expert.season_months;
  if (!months?.length) return { text: PENDING, status: "pending" };
  return {
    text: [...months]
      .sort((a, b) => a - b)
      .map((m) => MONTHS[m - 1])
      .join(", "),
    status: expertStatus(doc.expert),
  };
}

const ACCUMULATION: Record<string, string> = { jod: "jod", arsen: "arsen", cadmium: "cadmium" };

export function accumulationText(doc: SpeciesDoc): FieldText {
  const a = doc.expert.accumulation;
  if (!a) return { text: PENDING, status: "pending" };
  if (a.length === 0) return { text: "Ingen særlig advarsel.", status: expertStatus(doc.expert) };
  return {
    text: `Kan ophobe ${a.map((x) => ACCUMULATION[x]).join(", ")}.`,
    status: expertStatus(doc.expert),
  };
}

// --- species list: search and group filter ---------------------------------
// Search precedence follows Svampekortet's keywords.ts (624fb8b), adapted to
// the three algae groups.

/** The algae groups, in chip order. */
export const GROUPS = ["brunalge", "rødalge", "grønalge"] as const;

export const GROUP_PLURAL: Record<string, string> = {
  brunalge: "Brunalger",
  rødalge: "Rødalger",
  grønalge: "Grønalger",
};

/** "Brunalge" for the sheet's subtitle. */
export function groupLabel(group: string): string {
  return group ? group[0].toUpperCase() + group.slice(1) : group;
}

/** A query shorter than this does not filter yet: one typed letter would
 * otherwise flash "nothing matches" before the second keystroke. */
export const MIN_QUERY_LENGTH = 2;
const MIN_FALLBACK_WORD_LENGTH = 2;

/** Lowercase and drop accents and Danish letters (æ→ae, ø→o, å→a), so a typed
 * "sol" finds "Søl" and "rodalge" finds the red algae. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o");
}

/** Whether `query` is long enough to narrow the list at all. */
export function isActiveQuery(query: string): boolean {
  return normalise(query.trim()).length >= MIN_QUERY_LENGTH;
}

// A query that is exactly a group's own name (with a common ending) means the
// whole group.
const GROUP_WORDS: { pattern: RegExp; group: string }[] = [
  { pattern: /^brun ?alger?(ne)?$/, group: "brunalge" },
  { pattern: /^rod ?alger?(ne)?$/, group: "rødalge" },
  { pattern: /^gron ?alger?(ne)?$/, group: "grønalge" },
];

interface Searchable {
  danish_name: string;
  scientific_name: string;
  group: string;
  invasive: boolean;
}

// Looser keywords, tried only when the query is not part of a species name.
// First matching rule wins. Written against the normalised query.
const RULES: { pattern: RegExp; keep: (s: Searchable) => boolean }[] = [
  { pattern: /invasiv|invasive/, keep: (s) => s.invasive },
  { pattern: /brun|phaeophyc|brown/, keep: (s) => s.group === "brunalge" },
  { pattern: /\brod|rhodophyt|\bred\b/, keep: (s) => s.group === "rødalge" },
  { pattern: /gron|chlorophyt|green/, keep: (s) => s.group === "grønalge" },
];

const unhyphen = (text: string) => text.replace(/-/g, " ");

/** Resolution order, most specific first:
 *  1. a group's own name ("brunalger") -> the whole group;
 *  2. part of a species' Danish or scientific name -> those species
 *     (so "rød" finds Rød purpurhinde, not every red alga);
 *  3. a looser keyword ("invasiv", "rødtang", "green");
 *  4. any single word of the query found in a name.
 * A query under MIN_QUERY_LENGTH returns the list unchanged. */
export function resolveQuery<T extends Searchable>(query: string, species: readonly T[]): T[] {
  const q = normalise(query.trim()).replace(/\s+/g, " ");
  if (q.length < MIN_QUERY_LENGTH) return [...species];

  const groupWord = GROUP_WORDS.find((g) => g.pattern.test(q));
  if (groupWord) return species.filter((s) => s.group === groupWord.group);

  const names = species.map((s) => `${normalise(s.danish_name)} ${normalise(s.scientific_name)}`);
  const byName = species.filter(
    (_, i) => names[i].includes(q) || unhyphen(names[i]).includes(unhyphen(q)),
  );
  if (byName.length > 0) return byName;

  const rule = RULES.find((r) => r.pattern.test(q));
  if (rule) return species.filter(rule.keep);

  const words = q.split(" ").filter((w) => w.length >= MIN_FALLBACK_WORD_LENGTH);
  return species.filter((_, i) => words.some((w) => names[i].includes(w)));
}

/** The search and the group chip together (both must match). */
export function filterSpecies<T extends Searchable>(
  species: readonly T[],
  query: string,
  group: string | null,
): T[] {
  return resolveQuery(query, species).filter((s) => group === null || s.group === group);
}

/** Most finds near the pin first; ties keep their order (Array.sort is stable). */
export function sortByNear<T extends { slug: string }>(
  species: readonly T[],
  near: ReadonlyMap<string, number> | null,
): T[] {
  if (!near) return [...species];
  return [...species].sort((a, b) => (near.get(b.slug) ?? -1) - (near.get(a.slug) ?? -1));
}

// --- species sheet: the section model ---------------------------------------

export interface LookalikeRef {
  scientific: string;
  /** "Danish (Scientific)" for a species in the list, else the scientific name. */
  label: string;
  /** Slug to open, when the lookalike is itself in the list. */
  slug: string | null;
}

export function lookalikeRefs(
  doc: Pick<SpeciesDoc, "lookalikes">,
  species: readonly { slug: string; danish_name: string; scientific_name: string }[],
): LookalikeRef[] {
  return doc.lookalikes.map((scientific) => {
    const s = species.find((x) => x.scientific_name === scientific);
    return {
      scientific,
      label: s?.danish_name ? `${s.danish_name} (${scientific})` : scientific,
      slug: s?.slug ?? null,
    };
  });
}

export interface SheetModel {
  /** "Vigtigt": shown first. */
  warnings: string[];
  finds: {
    total: number;
    counts: Record<Attachment, number>;
    /** Null without a pin. */
    near: ReturnType<typeof findsNear> | null;
  };
  harvest: { depth: FieldText; method: FieldText; season: FieldText };
  accumulation: FieldText;
  lookalikes: LookalikeRef[];
  sources: { title: string; license: string }[];
}

/** Everything the species sheet shows, in section order. */
export function sheetModel(
  doc: SpeciesDoc,
  species: readonly { slug: string; danish_name: string; scientific_name: string }[],
  pin: [number, number] | null,
): SheetModel {
  return {
    warnings: doc.warnings,
    finds: {
      total: doc.observation_count,
      counts: doc.attachment_counts,
      near: pin ? findsNear(doc, pin) : null,
    },
    harvest: { depth: depthText(doc), method: harvestText(doc), season: seasonText(doc) },
    accumulation: accumulationText(doc),
    lookalikes: lookalikeRefs(doc, species),
    sources: doc.datasets,
  };
}

/** "CC BY 4.0" from a licence URL. */
export function licenseName(url: string): string {
  if (/publicdomain\/zero/.test(url) || /CC0/i.test(url)) return "CC0";
  const m = url.match(/licenses\/(by(?:-[a-z]+)*)\/(\d\.\d)/i);
  if (m) return `CC ${m[1].toUpperCase()} ${m[2]}`;
  return url.replace(/^https?:\/\//, "");
}
