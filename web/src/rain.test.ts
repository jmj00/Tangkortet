import { describe, expect, it } from "vitest";

import { summariseRain } from "./rain";

const now = new Date("2026-10-23T12:00:00Z");

function hourly(stationId: string, at: [number, number], hours: number, mm: (h: number) => number) {
  return Array.from({ length: hours }, (_, h) => ({
    geometry: { coordinates: at },
    properties: {
      stationId,
      observed: new Date(now.getTime() - h * 3_600_000).toISOString(),
      value: mm(h),
    },
  }));
}

describe("summariseRain", () => {
  it("sums the last 24/48/72 hours at the nearest complete station", () => {
    const near = hourly("near", [10.41, 56.2], 72, (h) => (h < 24 ? 1 : h < 48 ? 0.5 : 0));
    const summary = summariseRain(near, [10.4, 56.2], now);
    expect(summary).toMatchObject({ stationId: "near", mm24: 24, mm48: 36, mm72: 36, hours: 72 });
  });

  it("skips a nearer station with a patchy record", () => {
    const patchy = hourly("patchy", [10.401, 56.2], 20, () => 9);
    const full = hourly("full", [10.5, 56.2], 72, () => 0.1);
    expect(summariseRain([...patchy, ...full], [10.4, 56.2], now)?.stationId).toBe("full");
  });

  it("falls back to the nearest station when none is complete", () => {
    const patchy = hourly("patchy", [10.401, 56.2], 20, () => 1);
    expect(summariseRain(patchy, [10.4, 56.2], now)).toMatchObject({
      stationId: "patchy",
      mm24: 20,
    });
  });

  it("returns null without data", () => {
    expect(summariseRain([], [10.4, 56.2], now)).toBeNull();
  });
});
