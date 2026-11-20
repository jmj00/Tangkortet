// Months and species-level risk for the species list and page: the expert's
// harvest months (a 12-month strip, or "Afventer ekspert"), the finds per
// month as a small bar chart, and the risk badges (iodine, arsenic, cadmium,
// kainic acid). Pure, for testing; speciespanel.ts draws it.
//
// The finds per month say when people *recorded* the species, which follows
// summer shore visits, not when it is good to collect. Nothing here turns them
// into season advice, and the literature windows (docs/literature-season.md)
// stay out of the app until the expert has answered.

import { PENDING, type FieldText } from "./species";
import type { ExpertFields, FindsByMonth } from "./types";

export const MONTH_NAMES = [
  "januar",
  "februar",
  "marts",
  "april",
  "maj",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "december",
] as const;

export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

/** One letter per month, for the narrow chart axis. */
export const MONTH_INITIAL = MONTH_NAMES.map((m) => m[0].toUpperCase());

/** The current calendar month, 1-12, in the device's time zone. */
export function currentMonth(now: Date = new Date()): number {
  return now.getMonth() + 1;
}

/** "juli", "juli og august", "juni, juli og august". */
export function joinDanish(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} og ${items[items.length - 1]}`;
}

/** Valid months (1-12), unique and sorted. */
function cleanMonths(months: readonly number[] | null | undefined): number[] {
  return [...new Set((months ?? []).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort(
    (a, b) => a - b,
  );
}

/** Months as ranges round the year: [3,4,5,9] -> "mar–maj, sep", [11,12,1,2] ->
 * "nov–feb", all twelve -> "hele året". */
export function monthRanges(months: readonly number[] | null | undefined): string {
  const set = new Set(cleanMonths(months));
  if (set.size === 0) return "";
  if (set.size === 12) return "hele året";
  const prev = (m: number) => (m === 1 ? 12 : m - 1);
  const next = (m: number) => (m === 12 ? 1 : m + 1);
  const starts = [...set].filter((m) => !set.has(prev(m))).sort((a, b) => a - b);
  return starts
    .map((start) => {
      let end = start;
      while (set.has(next(end))) end = next(end);
      const a = MONTH_SHORT[start - 1];
      return end === start ? a : `${a}–${MONTH_SHORT[end - 1]}`;
    })
    .join(", ");
}

// --- the expert's harvest months ---------------------------------------------

export interface StripCell {
  month: number;
  initial: string;
  name: string;
  /** "in": one of the expert's best months. */
  state: "in" | "out";
  current: boolean;
}

export type SeasonStrip =
  | { kind: "pending"; text: string; current: number }
  | {
      kind: "known";
      /** "provisional" until the expert has signed the fields off. */
      status: Extract<FieldText["status"], "expert" | "provisional">;
      cells: StripCell[];
      /** "apr–jun" */
      text: string;
      current: number;
      inSeasonNow: boolean;
    };

/** The 12-month strip, or "Afventer ekspert" while the expert has not given
 * the months. */
export function seasonStrip(
  expert: Pick<ExpertFields, "season_months" | "verified">,
  now: Date = new Date(),
): SeasonStrip {
  const current = currentMonth(now);
  const months = cleanMonths(expert.season_months);
  if (months.length === 0) return { kind: "pending", text: PENDING, current };
  const cells = MONTH_NAMES.map((name, i) => ({
    month: i + 1,
    initial: MONTH_INITIAL[i],
    name,
    state: months.includes(i + 1) ? ("in" as const) : ("out" as const),
    current: i + 1 === current,
  }));
  return {
    kind: "known",
    status: expert.verified ? "expert" : "provisional",
    cells,
    text: monthRanges(months),
    current,
    inSeasonNow: months.includes(current),
  };
}

/** The list row's season cue: only when the expert has given the months and
 * this month is one of them. Never a guess from the finds. */
export function seasonCue(
  months: readonly number[] | null | undefined,
  verified: boolean | undefined,
  now: Date = new Date(),
): { label: string; provisional: boolean } | null {
  if (!cleanMonths(months).includes(currentMonth(now))) return null;
  return { label: "Sæson nu", provisional: verified !== true };
}

// --- finds per month ---------------------------------------------------------

/** Below this many dated finds the chart says the pattern means little. */
export const SPARSE_FINDS = 30;

/** A month counts as a peak at this share of the busiest month or more. */
const PEAK_SHARE = 0.85;

export interface MonthBar {
  month: number;
  initial: string;
  name: string;
  all: number;
  attached: number;
  /** Heights relative to the busiest month, 0-100. */
  allPct: number;
  attachedPct: number;
  current: boolean;
}

export interface FindsChart {
  bars: MonthBar[];
  total: number;
  attachedTotal: number;
  max: number;
  /** The busiest months (1-12), in calendar order. */
  peaks: number[];
  sparse: boolean;
  /** The text alternative: "Flest fund i juli og august (1.513 fund med dato)." */
  summary: string;
}

const NUMBER = new Intl.NumberFormat("da-DK");

/** The bar data, or null when there is nothing to draw (no counts, or no
 * dated finds). */
export function findsChart(
  byMonth: FindsByMonth | null | undefined,
  now: Date = new Date(),
): FindsChart | null {
  if (!byMonth || byMonth.all?.length !== 12) return null;
  const all = byMonth.all.map((n) => Math.max(0, n || 0));
  // attached is a subset of all; clamp so a bad payload cannot overshoot
  const attached = all.map((n, i) => Math.min(n, Math.max(0, byMonth.attached?.[i] || 0)));
  const total = all.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const max = Math.max(...all);
  const current = currentMonth(now);
  const pct = (n: number) => Math.round((n / max) * 1000) / 10;
  const bars = all.map((n, i) => ({
    month: i + 1,
    initial: MONTH_INITIAL[i],
    name: MONTH_NAMES[i],
    all: n,
    attached: attached[i],
    allPct: pct(n),
    attachedPct: pct(attached[i]),
    current: i + 1 === current,
  }));
  const peaks = bars.filter((b) => b.all >= PEAK_SHARE * max).map((b) => b.month);
  const sparse = total < SPARSE_FINDS;
  const dated = `${NUMBER.format(total)} fund med dato`;
  const summary = sparse
    ? `Kun ${dated} – for få til at sige noget om årstiden.`
    : `Flest registreringer i ${joinDanish(peaks.map((m) => MONTH_NAMES[m - 1]))} (${dated}).`;
  return {
    bars,
    total,
    attachedTotal: attached.reduce((a, b) => a + b, 0),
    max,
    peaks,
    sparse,
    summary,
  };
}

// --- species-level risk badges ------------------------------------------------

export type RiskKey = "jod" | "arsen" | "cadmium" | "kainsyre";

export interface RiskFlag {
  key: RiskKey;
  /** Badge text: "Jod". */
  label: string;
  /** Named in a "Vigtigt" warning (else only in the expert's accumulation list). */
  inWarning: boolean;
}

// TODO(expert): kainic acid (and any substance only named in a warning) is
// found by matching the warning text, because the expert's accumulation list
// has no "kainsyre". It should become an explicit expert field; until then
// the stems below also match compounds ("jodindhold", "uorganisk arsen") and
// skip a term negated just before it ("indeholder ikke jod").
const RISKS: { key: RiskKey; label: string; stem: string }[] = [
  { key: "jod", label: "Jod", stem: "jod" },
  { key: "arsen", label: "Arsen", stem: "arsen" },
  { key: "cadmium", label: "Cadmium", stem: "[ck]admium" },
  { key: "kainsyre", label: "Kainsyre", stem: "kainsyre" },
];

/** Whether `text` names the substance, other than as "ikke/ingen/uden …". */
function names(text: string, stem: string): boolean {
  const any = new RegExp(stem, "i");
  const negated = new RegExp(`\\b(?:ikke|ingen|uden)\\s+(?:\\S+\\s+){0,2}\\S*${stem}`, "i");
  // per sentence, so a negation elsewhere in the warning does not count
  return text.split(/(?<=[.!?])\s+/).some((s) => any.test(s) && !negated.test(s));
}

/** The note under the species list, as sentences: what the badges mean, that
 * no badge is no all-clear (with how many species still await the expert's
 * accumulation answer), and the season lines that apply to the rows shown. */
export function listNote(
  shown: readonly {
    accumulation?: ExpertFields["accumulation"];
    season_months?: number[] | null;
    expert_verified?: boolean;
  }[],
  all: readonly { accumulation?: ExpertFields["accumulation"] }[],
  now: Date = new Date(),
): string[] {
  const pending = all.filter((s) => s.accumulation == null).length;
  const which = pending * 2 > all.length ? "de fleste arter" : pending > 0 ? "nogle arter" : "";
  const lines = [
    "Jod, arsen, cadmium og kainsyre er stoffer, som arten selv kan indeholde – ikke stedets risiko, som står under Risiko.",
    which
      ? `Ingen markering betyder ikke, at arten er sikker; for ${which} afventer ophobning stadig vores fagperson.`
      : "Ingen markering betyder ikke, at arten er sikker.",
  ];
  if (shown.some((s) => seasonCue(s.season_months, s.expert_verified, now)?.provisional))
    lines.push("„Sæson nu*“ er foreløbig og endnu ikke bekræftet af vores fagperson.");
  const noMonths = shown.filter((s) => !s.season_months?.length).length;
  if (noMonths === shown.length && noMonths > 0)
    lines.push("De bedste måneder for hver art afventer også vores fagperson.");
  else if (noMonths > 0)
    lines.push(
      `For ${noMonths} af de viste arter afventer de bedste måneder stadig vores fagperson.`,
    );
  return lines;
}

/** The substances to flag for a species (not for a spot): those the expert
 * lists as accumulating, plus those its "Vigtigt" warnings name. Fixed order. */
export function riskFlags(
  accumulation: ExpertFields["accumulation"] | undefined,
  warnings: readonly string[] | undefined,
): RiskFlag[] {
  const text = (warnings ?? []).join(" ");
  return RISKS.flatMap(({ key, label, stem }) => {
    const inWarning = names(text, stem);
    const listed = (accumulation ?? []).includes(key as "jod" | "arsen" | "cadmium");
    return inWarning || listed ? [{ key, label, inWarning }] : [];
  });
}
