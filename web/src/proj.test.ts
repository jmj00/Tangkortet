import { describe, expect, it } from "vitest";

import { utm32nToWgs84, wgs84ToUtm32n } from "./proj";

describe("UTM32N projection", () => {
  it("matches a known Adressevælgeren lookup (Rold Skovvej 10, 8700 Horsens)", () => {
    const [lon, lat] = utm32nToWgs84(556004.23, 6186277.17);
    expect(lon).toBeCloseTo(9.8938, 3);
    expect(lat).toBeCloseTo(55.8188, 3);
  });

  it("round-trips to well under a metre across Denmark", () => {
    for (const [lon, lat] of [
      [8.1, 55.5], // Esbjerg
      [10.2, 56.15], // Aarhus
      [12.6, 55.68], // København
      [14.9, 55.1], // Bornholm
    ] as [number, number][]) {
      const [x, y] = wgs84ToUtm32n(lon, lat);
      const [lon2, lat2] = utm32nToWgs84(x, y);
      expect(Math.abs(lon2 - lon) * 63_000).toBeLessThan(0.5);
      expect(Math.abs(lat2 - lat) * 111_000).toBeLessThan(0.5);
    }
  });

  it("puts Horsens at the expected easting/northing", () => {
    const [x, y] = wgs84ToUtm32n(9.89381, 55.81882);
    expect(x).toBeCloseTo(556004, -1);
    expect(y).toBeCloseTo(6186277, -1);
  });
});
