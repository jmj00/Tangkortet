// Rain in the last 24 / 48 / 72 hours at the nearest DMI station (brief §1,
// "Kraftig nedbør"; checklist "Kontrollér nedbør de seneste 24, 48 og 72 timer").
// Fetched live from DMI's metObs API (ADR-0002: no key, CORS allowed), so it is
// current to the hour. No thresholds: what counts as "too much rain" is the
// expert's call, so the card shows the numbers and the brief's reasoning.

import { bboxAround, distanceM } from "./geo";

const OBS = "https://opendataapi.dmi.dk/v2/metObs/collections/observation/items";
const STATIONS = "https://opendataapi.dmi.dk/v2/metObs/collections/station/items";
const SEARCH_RADIUS_M = 40_000;
const HOUR = 3_600_000;

export interface RainSummary {
  stationId: string;
  stationName: string | null;
  distanceM: number;
  /** mm in the last 24, 48 and 72 hours. */
  mm24: number;
  mm48: number;
  mm72: number;
  /** Hourly values present out of 72. */
  hours: number;
}

interface ObsFeature {
  geometry: { coordinates: [number, number] };
  properties: { stationId: string; observed: string; value: number };
}

/** Pick the nearest station with a near-complete record (>= 60 of 72 hours),
 * falling back to the nearest with any data. Pure, for testing. */
export function summariseRain(
  features: ObsFeature[],
  pin: [number, number],
  now: Date,
): RainSummary | null {
  const byStation = new Map<string, { at: [number, number]; values: [number, number][] }>();
  for (const f of features) {
    const { stationId, observed, value } = f.properties;
    if (typeof value !== "number") continue;
    const entry = byStation.get(stationId) ?? { at: f.geometry.coordinates, values: [] };
    entry.values.push([now.getTime() - Date.parse(observed), value]);
    byStation.set(stationId, entry);
  }
  const summaries = [...byStation].map(([stationId, { at, values }]) => {
    const sum = (hours: number) =>
      Math.round(
        values.filter(([age]) => age >= 0 && age < hours * HOUR).reduce((s, [, v]) => s + v, 0) *
          10,
      ) / 10;
    return {
      stationId,
      stationName: null,
      distanceM: distanceM(pin, at),
      mm24: sum(24),
      mm48: sum(48),
      mm72: sum(72),
      hours: values.filter(([age]) => age >= 0 && age < 72 * HOUR).length,
    };
  });
  summaries.sort((a, b) => a.distanceM - b.distanceM);
  return summaries.find((s) => s.hours >= 60) ?? summaries[0] ?? null;
}

export async function stationName(id: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`${STATIONS}?stationId=${id}&limit=1`, { signal });
    const json = (await res.json()) as { features?: { properties?: { name?: string } }[] };
    return json.features?.[0]?.properties?.name ?? null;
  } catch {
    return null;
  }
}

export async function fetchRain(
  pin: [number, number],
  signal?: AbortSignal,
  now = new Date(),
): Promise<RainSummary | null> {
  const start = new Date(now.getTime() - 72 * HOUR).toISOString().slice(0, 19) + "Z";
  const end = now.toISOString().slice(0, 19) + "Z";
  const params = new URLSearchParams({
    parameterId: "precip_past1h",
    bbox: bboxAround(pin, SEARCH_RADIUS_M)
      .map((v) => v.toFixed(4))
      .join(","),
    datetime: `${start}/${end}`,
    limit: "20000",
  });
  const res = await fetch(`${OBS}?${params}`, { signal });
  if (!res.ok) throw new Error(`DMI ${res.status}`);
  const json = (await res.json()) as { features: ObsFeature[] };
  const summary = summariseRain(json.features, pin, now);
  if (summary) summary.stationName = await stationName(summary.stationId, signal);
  return summary;
}
