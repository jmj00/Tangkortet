import { describe, expect, it } from "vitest";

import {
  compass,
  daysAgo,
  describeSea,
  onshoreFrom,
  stillFresh,
  summariseWind,
  WINDOW_DAYS,
} from "./wind";

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

  it("drops stations outside 40 km (bbox corners)", () => {
    const far = series("far", [10.98, 56.2], FULL, () => 20); // ~36 km east: inside
    const corner = series("corner", [10.95, 56.52], FULL, () => 20); // ~47 km NE
    expect(summariseWind(far, [], [10.4, 56.2])?.stationId).toBe("far");
    expect(summariseWind(corner, [], [10.4, 56.2])).toBeNull();
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

describe("onshore wind (expert, round 2)", () => {
  // Sea to the east: sectors NØ..SØ (indices 2-6).
  const sea = Array.from({ length: 16 }, (_, i) => i >= 2 && i <= 6);
  const onshore = onshoreFrom(sea);

  it("counts only strong hours blowing from the sea", () => {
    // 10 h ago: 13 m/s from the west (offshore); 40 h ago: 11 m/s from the east.
    const speed = series("s1", [10.4, 56.2], FULL, (h) => (h === 10 ? 13 : h === 40 ? 11 : 4));
    const dir = series("s1", [10.4, 56.2], FULL, (h) => (h === 10 ? 270 : 90));
    const any = summariseWind(speed, dir, [10.4, 56.2]);
    expect(any?.lastStrong?.at.getTime()).toBe(now.getTime() - 10 * HOUR);
    const fromSea = summariseWind(speed, dir, [10.4, 56.2], onshore);
    expect(fromSea?.lastStrong?.at.getTime()).toBe(now.getTime() - 40 * HOUR);
    expect(fromSea?.lastStrong?.fromDeg).toBe(90);
  });

  it("ignores strong hours without a measured direction when filtering", () => {
    const speed = series("s1", [10.4, 56.2], FULL, (h) => (h === 5 ? 15 : 3));
    expect(summariseWind(speed, [], [10.4, 56.2], onshore)?.lastStrong).toBeNull();
  });

  it("maps degrees to the nearest of 16 sectors", () => {
    expect([0, 45, 90, 135, 180, 270].map(onshore)).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it("describes where the sea is, joining stretches across north", () => {
    expect(describeSea(sea)).toBe("NØ–SØ");
    const wrap = Array.from({ length: 16 }, (_, i) => i >= 14 || i <= 1);
    expect(describeSea(wrap)).toBe("NV–NNØ");
    const two = Array.from({ length: 16 }, (_, i) => i === 0 || i === 8);
    expect(describeSea(two)).toBe("S, N");
    expect(describeSea(Array(16).fill(false))).toBe("");
    expect(describeSea(Array(16).fill(true))).toBe("alle retninger");
  });

  it("calls washed-up tang fresh for about a day", () => {
    expect(stillFresh(new Date(now.getTime() - 20 * HOUR), now)).toBe(true);
    expect(stillFresh(new Date(now.getTime() - 30 * HOUR), now)).toBe(false);
  });
});
