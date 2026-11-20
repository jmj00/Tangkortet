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

/** Species per group among those matching `query` (for the chip counts). */
export function groupCounts<T extends Searchable>(
  species: readonly T[],
  query: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of resolveQuery(query, species)) counts.set(s.group, (counts.get(s.group) ?? 0) + 1);
  return counts;
}

// --- which species is open: a small state machine, kept free of the DOM ----

/** A loading page turns into the error page (with "Prøv igen") after this. */
export const LOAD_TIMEOUT_MS = 15_000;

export type SelectionView<S, D> =
  | { kind: "list" }
  | { kind: "loading"; summary: S }
  | { kind: "error"; summary: S; offline: boolean }
  | { kind: "sheet"; summary: S; doc: D };

export interface SelectionHooks<S, D> {
  loadDoc(summary: S): Promise<D>;
  /** The species whose finds the map shows (and the URL names), or null to clear. */
  onSelect(doc: D | null): void;
  /** Draw `view`. `user` is true when the user asked for it just now (focus may move). */
  render(view: SelectionView<S, D>, prev: SelectionView<S, D>, user: boolean): void;
  isOffline(): boolean;
  /** The load for `summary` timed out: drop any cached pending request so a
   * retry starts afresh instead of waiting on the hung one. */
  onTimeout?(summary: S): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(id: unknown): void;
}

/** Opening, loading, failing and closing species pages. Rules:
 *  - the map only ever shows the species whose page is open and loaded: any
 *    move from a loaded page to a loading/error page or to the list clears it;
 *  - a load that is overtaken by another open (or by "back") is dropped;
 *  - a load still pending after LOAD_TIMEOUT_MS shows the error page, but if
 *    the document arrives after all (late response, or `addDocs`), it shows;
 *  - pages opened from a lookalike remember where they came from, so "back"
 *    goes one step; "home" always returns to the list. */
export class SpeciesSelection<S extends { slug: string }, D extends { slug: string }> {
  view: SelectionView<S, D> = { kind: "list" };
  /** Pages to step back through, most recent last. */
  readonly trail: S[] = [];
  private readonly docs = new Map<string, D>();
  private token = 0;
  private timer: unknown = null;

  constructor(
    private readonly hooks: SelectionHooks<S, D>,
    private readonly timeoutMs = LOAD_TIMEOUT_MS,
  ) {}

  doc(slug: string): D | undefined {
    return this.docs.get(slug);
  }

  /** Documents loaded elsewhere (the near-pin bulk load). Recovers a page that
   * is loading or failed if its document is among them. */
  addDocs(docs: readonly D[]): void {
    for (const d of docs) this.docs.set(d.slug, d);
    const v = this.view;
    if (v.kind === "loading" || v.kind === "error") {
      const doc = this.docs.get(v.summary.slug);
      if (doc) {
        this.token++;
        this.set({ kind: "sheet", summary: v.summary, doc }, false);
      }
    }
  }

  /** Open a species. `via: "lookalike"` remembers the current page for "back". */
  async open(summary: S, opts: { user: boolean; via?: "lookalike" | "list" }): Promise<void> {
    const current = this.view;
    if (opts.via === "lookalike" && current.kind !== "list") {
      if (current.summary.slug !== summary.slug) this.trail.push(current.summary);
    } else if (opts.via === "list") {
      this.trail.length = 0;
    }
    const token = ++this.token;
    const cached = this.docs.get(summary.slug);
    if (cached) return this.set({ kind: "sheet", summary, doc: cached }, opts.user);

    this.set({ kind: "loading", summary }, opts.user);
    this.startTimer(token, summary);
    let doc: D;
    try {
      doc = await this.hooks.loadDoc(summary);
    } catch (err) {
      if (token !== this.token) return;
      console.error(err);
      this.set({ kind: "error", summary, offline: this.hooks.isOffline() }, false);
      return;
    }
    this.docs.set(doc.slug, doc);
    if (token !== this.token) return; // another species was opened, or "back"
    this.set({ kind: "sheet", summary, doc }, false);
  }

  /** Try the page that failed again. */
  retry(user = true): void {
    const v = this.view;
    if (v.kind === "error") void this.open(v.summary, { user });
  }

  /** One step back: the page this one was opened from, else the list. */
  back(): void {
    const previous = this.trail.pop();
    if (previous) void this.open(previous, { user: true });
    else this.home();
  }

  /** Straight to the list. `user` false: return without moving focus. */
  home(user = true): void {
    this.trail.length = 0;
    this.token++; // drop a load in flight
    this.set({ kind: "list" }, user);
  }

  private startTimer(token: number, summary: S): void {
    const clear = this.hooks.clearTimer ?? ((id) => clearTimeout(id as number));
    const set = this.hooks.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    if (this.timer !== null) clear(this.timer);
    this.timer = set(() => {
      this.timer = null;
      // Still the same load and still waiting: say so, but let a late answer win.
      if (token === this.token && this.view.kind === "loading") {
        this.hooks.onTimeout?.(summary);
        this.set({ kind: "error", summary, offline: this.hooks.isOffline() }, false);
      }
    }, this.timeoutMs);
  }

  private set(view: SelectionView<S, D>, user: boolean): void {
    const prev = this.view;
    this.view = view;
    if (view.kind !== "loading" && this.timer !== null) {
      (this.hooks.clearTimer ?? ((id) => clearTimeout(id as number)))(this.timer);
      this.timer = null;
    }
    this.hooks.render(view, prev, user);
    if (view.kind === "sheet") this.hooks.onSelect(view.doc);
    else if (prev.kind === "sheet" || (view.kind === "list" && prev.kind !== "list")) {
      this.hooks.onSelect(null);
    }
  }
}
