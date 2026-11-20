import { describe, expect, it } from "vitest";

import {
  accumulationText,
  filterSpecies,
  isActiveQuery,
  licenseName,
  lookalikeRefs,
  resolveQuery,
  sheetModel,
  sortByNear,
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

// A slice of the real manifest: names, groups and the invasive flag.
const LIST = [
  ["ulva-fenestrata", "Almindelig søsalat", "Ulva fenestrata", "grønalge", false],
  ["fucus-vesiculosus", "Blæretang", "Fucus vesiculosus", "brunalge", false],
  [
    "gracilaria-vermiculophylla",
    "Brunlig gracilariatang",
    "Gracilaria vermiculophylla",
    "rødalge",
    true,
  ],
  ["sargassum-muticum", "Butblæret sargassotang", "Sargassum muticum", "brunalge", true],
  ["porphyra-purpurea", "Rød purpurhinde", "Porphyra purpurea", "rødalge", false],
  ["palmaria-palmata", "Søl", "Palmaria palmata", "rødalge", false],
  ["saccharina-latissima", "Sukkertang", "Saccharina latissima", "brunalge", false],
  ["ulva-intestinalis", "Tarm-rørhinde", "Ulva intestinalis", "grønalge", false],
  ["ulva-lacinulata", "", "Ulva lacinulata", "grønalge", false],
].map(([slug, danish_name, scientific_name, group, invasive]) => ({
  slug: slug as string,
  danish_name: danish_name as string,
  scientific_name: scientific_name as string,
  group: group as string,
  invasive: invasive as boolean,
}));

const slugs = (list: { slug: string }[]) => list.map((s) => s.slug);

describe("resolveQuery", () => {
  it("does not filter on an empty or one-letter query", () => {
    expect(resolveQuery("", LIST)).toHaveLength(LIST.length);
    expect(resolveQuery(" s ", LIST)).toHaveLength(LIST.length);
    expect(isActiveQuery("s")).toBe(false);
    expect(isActiveQuery("sø")).toBe(true);
  });

  it("returns the whole group for the group's own name", () => {
    expect(slugs(resolveQuery("rødalge", LIST))).toEqual([
      "gracilaria-vermiculophylla",
      "porphyra-purpurea",
      "palmaria-palmata",
    ]);
    expect(slugs(resolveQuery("Brunalger", LIST))).toEqual([
      "fucus-vesiculosus",
      "sargassum-muticum",
      "saccharina-latissima",
    ]);
    expect(resolveQuery("gronalge", LIST)).toHaveLength(3);
  });

  it("lets a species-name match beat a group keyword", () => {
    // "rød" is a red-algae keyword, but Rød purpurhinde has it in its name.
    expect(slugs(resolveQuery("rød", LIST))).toEqual(["porphyra-purpurea"]);
    // "brun" is a brown-algae keyword, but Brunlig gracilariatang (a red alga) matches by name.
    expect(slugs(resolveQuery("brun", LIST))).toEqual(["gracilaria-vermiculophylla"]);
    // No name contains "rødtang", so the keyword applies.
    expect(resolveQuery("rødtang", LIST).every((s) => s.group === "rødalge")).toBe(true);
  });

  it("matches Danish and scientific names without accents or hyphens", () => {
    expect(slugs(resolveQuery("sol", LIST))).toEqual(["palmaria-palmata"]);
    expect(slugs(resolveQuery("tarm rørhinde", LIST))).toEqual(["ulva-intestinalis"]);
    expect(slugs(resolveQuery("lacinulata", LIST))).toEqual(["ulva-lacinulata"]);
  });

  it("finds invasive species by keyword and falls back word by word", () => {
    expect(slugs(resolveQuery("invasiv", LIST))).toEqual([
      "gracilaria-vermiculophylla",
      "sargassum-muticum",
    ]);
    expect(slugs(resolveQuery("frisk sukkertang", LIST))).toEqual(["saccharina-latissima"]);
    expect(resolveQuery("xyzzy", LIST)).toEqual([]);
  });
});

describe("filterSpecies and sortByNear", () => {
  it("combines the search with the group chip", () => {
    expect(slugs(filterSpecies(LIST, "", "grønalge"))).toEqual([
      "ulva-fenestrata",
      "ulva-intestinalis",
      "ulva-lacinulata",
    ]);
    expect(slugs(filterSpecies(LIST, "ulva", "rødalge"))).toEqual([]);
    expect(slugs(filterSpecies(LIST, "s", "brunalge"))).toHaveLength(3);
  });

  it("sorts by finds near the pin, keeping ties in list order", () => {
    const near = new Map([
      ["palmaria-palmata", 4],
      ["saccharina-latissima", 9],
      ["ulva-fenestrata", 4],
    ]);
    expect(slugs(sortByNear(LIST, near)).slice(0, 4)).toEqual([
      "saccharina-latissima",
      "ulva-fenestrata",
      "palmaria-palmata",
      "fucus-vesiculosus",
    ]);
    expect(sortByNear(LIST, null)).toEqual(LIST);
  });
});

describe("sheetModel", () => {
  it("puts warnings, finds, harvest, accumulation, lookalikes and sources in order", () => {
    const d = doc({
      warnings: ["Kan indeholde meget jod."],
      lookalikes: ["Palmaria palmata", "Ulva rigida"],
      observation_count: 2,
      attachment_counts: { attached: 1, drift: 0, unknown: 1 },
      observations: [
        [10.4, 56.2, 1993, 0, 9, 0],
        [11.4, 56.2, 2024, 2, null, 0],
      ],
      datasets: [{ title: "Arter.dk", license: "http://creativecommons.org/licenses/by/4.0/" }],
    });
    const m = sheetModel(d, LIST, [10.4, 56.2]);
    expect(Object.keys(m)).toEqual([
      "warnings",
      "finds",
      "harvest",
      "accumulation",
      "lookalikes",
      "sources",
    ]);
    expect(m.warnings).toEqual(["Kan indeholde meget jod."]);
    expect(m.finds.near).toEqual({ attached: 1, drift: 0, unknown: 0, total: 1 });
    expect(m.harvest.depth.status).toBe("pending");
    expect(m.lookalikes).toEqual([
      { scientific: "Palmaria palmata", label: "Søl (Palmaria palmata)", slug: "palmaria-palmata" },
      { scientific: "Ulva rigida", label: "Ulva rigida", slug: null },
    ]);
    expect(licenseName(m.sources[0].license)).toBe("CC BY 4.0");
  });

  it("has no near-pin counts without a pin", () => {
    expect(sheetModel(doc(), LIST, null).finds.near).toBeNull();
  });

  it("labels a lookalike without a Danish name by its scientific name", () => {
    const refs = lookalikeRefs({ lookalikes: ["Ulva lacinulata"] }, LIST);
    expect(refs).toEqual([
      { scientific: "Ulva lacinulata", label: "Ulva lacinulata", slug: "ulva-lacinulata" },
    ]);
  });
});
