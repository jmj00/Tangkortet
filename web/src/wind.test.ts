import { describe, expect, it } from "vitest";

import { compass, daysAgo, summariseWind, WINDOW_DAYS } from "./wind";

const now = new Date("2026-10-23T12:00:00Z");
const HOUR = 3_600_000;

function series(stationId: string, at: [number, number], hours: number, v: (h: number) => number) {
  return Array.from({ length: hours }, (_, h) => ({
    geometry: { coordinates: at },
    properties: {
      stationId,
      observed: new Date(now.getTime() - h * HOUR).toISOString(),
      value: v(h),
    },
  }));
}

const FULL = WINDOW_DAYS * 24;

describe("summariseWind", () => {
  it("finds the latest strong-wind hour, its episode peak and direction", () => {
    // Gale 50-60 h ago peaking 14 m/s at 55 h, calm otherwise.
    const speed = series("s1", [10.4, 56.2], FULL, (h) =>
      h >= 50 && h <= 60 ? (h === 55 ? 14 : 11) : 4,
    );
    const dir = series("s1", [10.4, 56.2], FULL, (h) => (h === 55 ? 270 : 180));
    const w = summariseWind(speed, dir, [10.41, 56.2]);
    expect(w?.stationId).toBe("s1");
    expect(w?.lastStrong?.at.getTime()).toBe(now.getTime() - 50 * HOUR);
    expect(w?.lastStrong?.peakMs).toBe(14);
    expect(w?.lastStrong?.fromDeg).toBe(270);
  });

  it("reports no strong wind in the window", () => {
    const w = summariseWind(
      series("s1", [10.4, 56.2], FULL, () => 5),
      [],
      [10.4, 56.2],
    );
    expect(w).toMatchObject({ stationId: "s1", lastStrong: null });
  });

  it("uses the windiest station, not the nearest", () => {
    const inland = series("inland", [10.401, 56.2], FULL, () => 6);
    const coast = series("coast", [10.6, 56.2], FULL, (h) => (h === 30 ? 12.4 : 7));
    const w = summariseWind([...inland, ...coast], [], [10.4, 56.2]);
    expect(w?.stationId).toBe("coast");
    expect(w?.lastStrong?.peakMs).toBe(12.4);
  });

  it("names the nearest station when nothing was strong", () => {
    const near = series("near", [10.401, 56.2], FULL, () => 3);
    const far = series("far", [10.6, 56.2], FULL, () => 9);
    expect(summariseWind([...near, ...far], [], [10.4, 56.2])).toMatchObject({
      stationId: "near",
      lastStrong: null,
    });
  });

  it("returns null without data", () => {
    expect(summariseWind([], [], [10.4, 56.2])).toBeNull();
  });
});

describe("wind helpers", () => {
  it("names compass directions in Danish", () => {
    expect([0, 44, 90, 135, 200, 225, 270, 315, 359].map(compass)).toEqual([
      "N",
      "NØ",
      "Ø",
      "SØ",
      "S",
      "SV",
      "V",
      "NV",
      "N",
    ]);
  });

  it("says when, in days", () => {
    expect(daysAgo(new Date(now.getTime() - 2 * HOUR), now)).toBe("i dag");
    expect(daysAgo(new Date(now.getTime() - 24 * HOUR), now)).toBe("i går");
    expect(daysAgo(new Date(now.getTime() - 3 * 24 * HOUR), now)).toBe("for 3 dage siden");
  });
});
