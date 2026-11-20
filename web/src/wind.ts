// "When did it last blow hard from the sea?" -- the expert's freshness check for
// drift tang (review page, rounds 1-2): washed-up tang most likely came ashore in
// the last strong onshore wind, and stays fresh for about a day.
//
// Live from DMI metObs: hourly mean wind and direction at every station within
// 40 km over the last 14 days. STRONG_WIND_MS is Beaufort 6 ("hård vind"); the
// expert is asked on the review page what counts as strong.

import { bboxAround, distanceM } from "./geo";
import { stationName } from "./rain";

const OBS = "https://opendataapi.dmi.dk/v2/metObs/collections/observation/items";
const SEARCH_RADIUS_M = 40_000;
const HOUR = 3_600_000;
export const WINDOW_DAYS = 14;
export const STRONG_WIND_MS = 10.8;

export interface WindSummary {
  /** The station that measured the peak (or the nearest, if no strong wind). */
  stationId: string;
  stationName: string | null;
  distanceM: number;
  /** Most recent hour at or above STRONG_WIND_MS, or null if none in the window. */
  lastStrong: {
    at: Date;
    /** Highest hourly mean within 12 h either side of `at`. */
    peakMs: number;
    /** Direction the wind came from at the peak, degrees. */
    fromDeg: number | null;
  } | null;
}

interface ObsFeature {
  geometry: { coordinates: [number, number] };
  properties: { stationId: string; observed: string; value: number; parameterId?: string };
}

const COMPASS = ["N", "NØ", "Ø", "SØ", "S", "SV", "V", "NV"];

export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Pure, for testing. `speeds` and `dirs` are hourly features from metObs,
 * already limited to stations within SEARCH_RADIUS_M of the pin.
 *
 * Uses the *strongest* station, not the nearest: inland stations read far
 * lower than the coast (e.g. 14 Oct 2026: Sletterhage Fyr 12.4 m/s, Ødum 7.6),
 * and it is the coastal wind that brings tang ashore. */
/** Wind direction (degrees, where it blows FROM) -> true if it blows from the sea. */
export type OnshoreTest = (fromDeg: number) => boolean;

/** Pure, for testing. `speeds` and `dirs` are hourly features from metObs,
 * already limited to stations within SEARCH_RADIUS_M of the pin.
 *
 * Uses the *strongest* station, not the nearest: inland stations read far
 * lower than the coast (e.g. 14 Oct 2026: Sletterhage Fyr 12.4 m/s, Ødum 7.6),
 * and it is the coastal wind that brings tang ashore. With `onshore`, only hours
 * whose measured direction blows from the sea count (expert, round 2: strong
 * wind tears tang loose, onshore wind washes it up). */
export function summariseWind(
  speeds: ObsFeature[],
  dirs: ObsFeature[],
  pin: [number, number],
  onshore?: OnshoreTest,
): WindSummary | null {
  // The request is a bbox; keep stations truly within SEARCH_RADIUS_M (the
  // bbox corners reach ~56 km).
  const valid = speeds.filter(
    (f) =>
      typeof f.properties.value === "number" &&
      distanceM(pin, f.geometry.coordinates) <= SEARCH_RADIUS_M,
  );
  if (valid.length === 0) return null;
  const at = (f: ObsFeature) => Date.parse(f.properties.observed);
  const dirAt = new Map<string, number>();
  for (const f of dirs) {
    if (typeof f.properties.value === "number")
      dirAt.set(`${f.properties.stationId}|${at(f)}`, f.properties.value);
  }
  const dirOf = (f: ObsFeature) => dirAt.get(`${f.properties.stationId}|${at(f)}`);
  const qualifies = (f: ObsFeature) => {
    if (f.properties.value < STRONG_WIND_MS) return false;
    if (!onshore) return true;
    const d = dirOf(f);
    return d !== undefined && onshore(d);
  };
  const strong = valid.filter(qualifies);
  if (strong.length === 0) {
    const nearest = valid.reduce((a, b) =>
      distanceM(pin, a.geometry.coordinates) <= distanceM(pin, b.geometry.coordinates) ? a : b,
    );
    return {
      stationId: nearest.properties.stationId,
      stationName: null,
      distanceM: distanceM(pin, nearest.geometry.coordinates),
      lastStrong: null,
    };
  }
  const latest = strong.reduce((a, b) => (at(b) > at(a) ? b : a));
  // The episode's peak: strongest qualifying hour at any station within 12 h.
  const peak = strong
    .filter((f) => Math.abs(at(f) - at(latest)) <= 12 * HOUR)
    .reduce((a, b) => (b.properties.value > a.properties.value ? b : a));
  const fromDeg = dirOf(peak);
  return {
    stationId: peak.properties.stationId,
    stationName: null,
    distanceM: distanceM(pin, peak.geometry.coordinates),
    lastStrong: {
      at: new Date(at(latest)),
      peakMs: peak.properties.value,
      fromDeg: fromDeg ?? null,
    },
  };
}

/** Washed-up tang stays fresh for about a day after the wind that brought it
 * (expert, round 2). */
export const FRESH_DAYS = 1;

export function stillFresh(at: Date, now: Date): boolean {
  return now.getTime() - at.getTime() <= FRESH_DAYS * 24 * HOUR;
}

const SECTORS16 = [
  "N",
  "NNØ",
  "NØ",
  "ØNØ",
  "Ø",
  "ØSØ",
  "SØ",
  "SSØ",
  "S",
  "SSV",
  "SV",
  "VSV",
  "V",
  "VNV",
  "NV",
  "NNV",
];

/** Onshore test from 16 sea/land samples around the pin (index 0 = north,
 * clockwise in 22.5° steps; see live.ts querySeaDirections). */
export function onshoreFrom(sea: boolean[]): OnshoreTest {
  return (deg) => sea[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** "NØ–SØ", or "N–NNØ, NNV" for several stretches; "" when no sea was found. */
export function describeSea(sea: boolean[]): string {
  if (!sea.some(Boolean)) return "";
  if (sea.every(Boolean)) return "alle retninger";
  // Start just after a land sector so no stretch wraps around the list end.
  const start = (sea.findIndex((v) => !v) + 1) % 16;
  const runs: string[] = [];
  let first = -1;
  for (let k = 0; k <= 16; k++) {
    const i = (start + k) % 16;
    const on = k < 16 && sea[i];
    if (on && first < 0) first = i;
    if (!on && first >= 0) {
      const last = (i + 15) % 16;
      runs.push(first === last ? SECTORS16[first] : `${SECTORS16[first]}–${SECTORS16[last]}`);
      first = -1;
    }
  }
  return runs.join(", ");
}

/** "i dag", "i går", "for 3 dage siden". */
export function daysAgo(at: Date, now: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(at)) / (24 * HOUR));
  if (days <= 0) return "i dag";
  if (days === 1) return "i går";
  return `for ${days} dage siden`;
}

async function hourly(parameterId: string, pin: [number, number], now: Date, signal?: AbortSignal) {
  const start = new Date(now.getTime() - WINDOW_DAYS * 24 * HOUR).toISOString().slice(0, 19) + "Z";
  const end = now.toISOString().slice(0, 19) + "Z";
  const params = new URLSearchParams({
    parameterId,
    bbox: bboxAround(pin, SEARCH_RADIUS_M)
      .map((v) => v.toFixed(4))
      .join(","),
    datetime: `${start}/${end}`,
    limit: "50000",
  });
  const res = await fetch(`${OBS}?${params}`, { signal });
  if (!res.ok) throw new Error(`DMI ${res.status}`);
  return ((await res.json()) as { features: ObsFeature[] }).features;
}

export async function fetchWind(
  pin: [number, number],
  signal?: AbortSignal,
  onshore?: OnshoreTest,
  now = new Date(),
): Promise<WindSummary | null> {
  const [speeds, dirs] = await Promise.all([
    hourly("wind_speed_past1h", pin, now, signal),
    hourly("wind_dir_past1h", pin, now, signal),
  ]);
  const summary = summariseWind(speeds, dirs, pin, onshore);
  if (summary) summary.stationName = await stationName(summary.stationId, signal);
  return summary;
}
