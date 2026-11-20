// "When did it last blow hard?" -- the expert's freshness check for drift tang
// (review page answer, 2026-10-23): washed-up tang most likely came ashore in
// the last strong wind, so its age is roughly the time since then.
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
export function summariseWind(
  speeds: ObsFeature[],
  dirs: ObsFeature[],
  pin: [number, number],
): WindSummary | null {
  const valid = speeds.filter((f) => typeof f.properties.value === "number");
  if (valid.length === 0) return null;
  const at = (f: ObsFeature) => Date.parse(f.properties.observed);
  const strong = valid.filter((f) => f.properties.value >= STRONG_WIND_MS);
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
  // The episode's peak: strongest hour at any station within 12 h of the latest.
  const peak = valid
    .filter((f) => Math.abs(at(f) - at(latest)) <= 12 * HOUR)
    .reduce((a, b) => (b.properties.value > a.properties.value ? b : a));
  const dir = dirs.find(
    (f) => f.properties.stationId === peak.properties.stationId && at(f) === at(peak),
  );
  return {
    stationId: peak.properties.stationId,
    stationName: null,
    distanceM: distanceM(pin, peak.geometry.coordinates),
    lastStrong: {
      at: new Date(at(latest)),
      peakMs: peak.properties.value,
      fromDeg: typeof dir?.properties.value === "number" ? dir.properties.value : null,
    },
  };
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
  now = new Date(),
): Promise<WindSummary | null> {
  const [speeds, dirs] = await Promise.all([
    hourly("wind_speed_past1h", pin, now, signal),
    hourly("wind_dir_past1h", pin, now, signal),
  ]);
  const summary = summariseWind(speeds, dirs, pin);
  if (summary) summary.stationName = await stationName(summary.stationId, signal);
  return summary;
}
