import { describe, expect, it } from "vitest";

import { bboxAround, cellKeys, distanceM, formatDistance } from "./geo";

describe("geo", () => {
  it("measures Aarhus-København at ~157 km", () => {
    expect(distanceM([10.2039, 56.1629], [12.5683, 55.6761]) / 1000).toBeCloseTo(157, 0);
  });

  it("builds a bbox that contains the circle", () => {
    const center: [number, number] = [10.4, 56.2];
    const [minLon, minLat, maxLon, maxLat] = bboxAround(center, 2000);
    expect(distanceM(center, [maxLon, center[1]])).toBeCloseTo(2000, -1);
    expect(distanceM(center, [center[0], minLat])).toBeCloseTo(2000, -1);
    expect(minLon).toBeLessThan(center[0]);
    expect(maxLat).toBeGreaterThan(center[1]);
  });

  it("lists the same cell keys as the pipeline", () => {
    // pipeline/tests/test_geo.py: cell_key(10.41, 56.21, 0.2) == "52_281"
    expect(cellKeys([10.41, 56.21, 10.41, 56.21], 0.2)).toEqual(["52_281"]);
    expect(cellKeys([10.39, 56.19, 10.41, 56.21], 0.2)).toEqual([
      "51_280",
      "51_281",
      "52_280",
      "52_281",
    ]);
  });

  it("formats distances in Danish", () => {
    expect(formatDistance(20)).toBe("ved nålen");
    expect(formatDistance(437)).toBe("440 m");
    expect(formatDistance(1530)).toBe("1,5 km");
    expect(formatDistance(23_400)).toBe("23 km");
  });
});
