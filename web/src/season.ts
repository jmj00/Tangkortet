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
    : `Flest fund i ${joinDanish(peaks.map((m) => MONTH_NAMES[m - 1]))} (${dated}).`;
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

const RISKS: { key: RiskKey; label: string; pattern: RegExp }[] = [
  { key: "jod", label: "Jod", pattern: /\bjod/i },
  { key: "arsen", label: "Arsen", pattern: /\barsen/i },
  { key: "cadmium", label: "Cadmium", pattern: /\b[ck]admium/i },
  { key: "kainsyre", label: "Kainsyre", pattern: /\bkainsyre/i },
];

/** The substances to flag for a species (not for a spot): those the expert
 * lists as accumulating, plus those its "Vigtigt" warnings name. Fixed order. */
export function riskFlags(
  accumulation: ExpertFields["accumulation"] | undefined,
  warnings: readonly string[] | undefined,
): RiskFlag[] {
  const text = (warnings ?? []).join(" ");
  return RISKS.flatMap(({ key, label, pattern }) => {
    const inWarning = pattern.test(text);
    const listed = (accumulation ?? []).includes(key as "jod" | "arsen" | "cadmium");
    return inWarning || listed ? [{ key, label, inWarning }] : [];
  });
}
