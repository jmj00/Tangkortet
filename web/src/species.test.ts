import { describe, expect, it } from "vitest";

import {
  accumulationText,
  depthText,
  findsNear,
  harvestText,
  PENDING,
  seasonText,
} from "./species";
import type { SpeciesDoc } from "./types";

function doc(overrides: Partial<SpeciesDoc> = {}): SpeciesDoc {
  return {
    slug: "saccharina-latissima",
    danish_name: "Sukkertang",
    danish_name_verified: true,
    scientific_name: "Saccharina latissima",
    group: "brunalge",
    gbif_usage_key: 1,
    invasive: false,
    lookalikes: [],
    warnings: [],
    expert: {
      verified: false,
      depth_m: null,
      harvest_method: null,
      season_months: null,
      accumulation: null,
    },
    observed_depth: null,
    attachment_counts: { attached: 0, drift: 0, unknown: 0 },
    observation_count: 0,
    datasets: [],
    observations: [],
    ...overrides,
  };
}

describe("findsNear", () => {
  it("counts finds inside the radius by attachment", () => {
    const d = doc({
      observations: [
        [10.4, 56.2, 1993, 0, 9, 0],
        [10.41, 56.2, 2024, 1, null, 0],
        [10.42, 56.2, 2024, 2, null, 0],
        [11.4, 56.2, 2024, 0, 9, 0], // ~62 km away
      ],
    });
    expect(findsNear(d, [10.4, 56.2])).toEqual({ attached: 1, drift: 1, unknown: 1, total: 3 });
  });
});

describe("expert fields", () => {
  it("falls back to 'afventer ekspert' when nothing is known", () => {
    const d = doc();
    for (const f of [depthText, harvestText, seasonText, accumulationText]) {
      expect(f(d)).toEqual({ text: PENDING, status: "pending" });
    }
  });

  it("uses observed depth, labelled as data, until the expert answers", () => {
    const d = doc({ observed_depth: { n: 1103, p10: 2, median: 10, p90: 15 } });
    expect(depthText(d)).toEqual({
      text: "Ifølge fund: typisk 2–15 m (median 10 m, 1103 fund med dybde)",
      status: "data",
    });
  });

  it("prefers the expert's values, provisional until verified", () => {
    const d = doc({
      observed_depth: { n: 10, p10: 2, median: 10, p90: 15 },
      expert: {
        verified: false,
        depth_m: [0.5, 3.5],
        harvest_method: "klip_skudspids",
        season_months: [5, 3, 4],
        accumulation: ["jod"],
      },
    });
    expect(depthText(d)).toEqual({ text: "0,5–3,5 m", status: "provisional" });
    expect(harvestText(d).text).toMatch(/^Klip skudspidserne/);
    expect(seasonText(d).text).toBe("mar, apr, maj");
    expect(accumulationText(d)).toEqual({ text: "Kan ophobe jod.", status: "provisional" });
    expect(depthText(doc({ ...d, expert: { ...d.expert, verified: true } })).status).toBe("expert");
  });
});
