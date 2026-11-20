import { describe, expect, it } from "vitest";

import {
  currentMonth,
  findsChart,
  listNote,
  joinDanish,
  monthRanges,
  riskFlags,
  seasonCue,
  seasonStrip,
  SPARSE_FINDS,
} from "./season";
import { PENDING } from "./species";

const JULY = new Date(2026, 6, 15, 12);
const DECEMBER_LAST = new Date(2026, 11, 31, 23, 59);
const JANUARY_FIRST = new Date(2027, 0, 1, 0, 1);

// Blæretang in the published payload: summer-heavy, as recorded.
const BLAERETANG = {
  all: [51, 23, 48, 131, 174, 195, 346, 273, 154, 69, 29, 20],
  attached: [8, 2, 12, 42, 39, 28, 96, 71, 44, 5, 6, 3],
};

describe("currentMonth", () => {
  it("is 1-12 in local time, including the turn of the year", () => {
    expect(currentMonth(JULY)).toBe(7);
    expect(currentMonth(DECEMBER_LAST)).toBe(12);
    expect(currentMonth(JANUARY_FIRST)).toBe(1);
  });
});

describe("joinDanish / monthRanges", () => {
  it("joins with commas and 'og'", () => {
    expect(joinDanish([])).toBe("");
    expect(joinDanish(["juli"])).toBe("juli");
    expect(joinDanish(["juli", "august"])).toBe("juli og august");
    expect(joinDanish(["juni", "juli", "august"])).toBe("juni, juli og august");
  });

  it("collapses runs, wraps round the new year and ignores junk", () => {
    expect(monthRanges([4, 5, 6])).toBe("apr–jun");
    expect(monthRanges([3, 4, 5, 9])).toBe("mar–maj, sep");
    expect(monthRanges([11, 12, 1, 2])).toBe("nov–feb");
    expect(monthRanges([12, 1, 6])).toBe("jun, dec–jan");
    expect(monthRanges([5, 5, 0, 13, 2.5])).toBe("maj");
    expect(monthRanges(Array.from({ length: 12 }, (_, i) => i + 1))).toBe("hele året");
    expect(monthRanges(null)).toBe("");
  });
});

describe("seasonStrip", () => {
  it("says 'Afventer ekspert' while the expert has not given months", () => {
    for (const season_months of [null, []]) {
      const strip = seasonStrip({ season_months, verified: true }, JULY);
      expect(strip).toEqual({ kind: "pending", text: PENDING, current: 7 });
    }
  });

  it("marks the expert's months and the current month", () => {
    const strip = seasonStrip({ season_months: [6, 4, 5], verified: false }, JULY);
    if (strip.kind !== "known") throw new Error("expected known");
    expect(strip.status).toBe("provisional");
    expect(strip.text).toBe("apr–jun");
    expect(strip.cells).toHaveLength(12);
    expect(strip.cells.filter((c) => c.state === "in").map((c) => c.month)).toEqual([4, 5, 6]);
    expect(strip.cells.filter((c) => c.current).map((c) => c.month)).toEqual([7]);
    expect(strip.cells[0]).toMatchObject({ initial: "J", name: "januar" });
    expect(strip.inSeasonNow).toBe(false);
  });

  it("is the expert's own once verified", () => {
    const strip = seasonStrip({ season_months: [7], verified: true }, JULY);
    expect(strip).toMatchObject({ kind: "known", status: "expert", inSeasonNow: true });
  });
});

describe("seasonCue", () => {
  it("only shows when the expert's months include this month", () => {
    expect(seasonCue(null, true, JULY)).toBeNull();
    expect(seasonCue(undefined, undefined, JULY)).toBeNull();
    expect(seasonCue([4, 5, 6], true, JULY)).toBeNull();
    expect(seasonCue([6, 7], true, JULY)).toEqual({ label: "Sæson nu", provisional: false });
    expect(seasonCue([7], false, JULY)?.provisional).toBe(true);
    expect(seasonCue([7], undefined, JULY)?.provisional).toBe(true);
  });
});

describe("findsChart", () => {
  it("has twelve bars scaled to the busiest month, attached inside all", () => {
    const chart = findsChart(BLAERETANG, JULY)!;
    expect(chart.bars).toHaveLength(12);
    expect(chart.max).toBe(346);
    expect(chart.total).toBe(1513);
    expect(chart.attachedTotal).toBe(356);
    const july = chart.bars[6];
    expect(july).toMatchObject({ month: 7, name: "juli", all: 346, allPct: 100, current: true });
    expect(july.attachedPct).toBeCloseTo(27.7, 1);
    expect(chart.bars.filter((b) => b.current)).toHaveLength(1);
    for (const b of chart.bars) {
      expect(b.attachedPct).toBeLessThanOrEqual(b.allPct);
      expect(b.allPct).toBeGreaterThanOrEqual(0);
      expect(b.allPct).toBeLessThanOrEqual(100);
    }
  });

  it("describes the busiest months in words (the text alternative)", () => {
    expect(findsChart(BLAERETANG, JULY)!.summary).toBe(
      "Flest registreringer i juli (1.513 fund med dato).",
    );
    const two = findsChart({ all: [0, 0, 0, 0, 0, 0, 90, 100, 0, 0, 0, 0], attached: [] }, JULY)!;
    expect(two.peaks).toEqual([7, 8]);
    expect(two.summary).toBe("Flest registreringer i juli og august (190 fund med dato).");
  });

  it("says when there are too few finds to mean anything", () => {
    const few = findsChart({ all: [0, 0, 0, 0, 4, 4, 5, 0, 0, 0, 0, 0], attached: [] }, JULY)!;
    expect(few.total).toBeLessThan(SPARSE_FINDS);
    expect(few.sparse).toBe(true);
    expect(few.summary).toBe("Kun 13 fund med dato – for få til at sige noget om årstiden.");
  });

  it("is null with nothing to draw, and clamps a bad payload", () => {
    expect(findsChart(undefined)).toBeNull();
    expect(findsChart({ all: [1, 2], attached: [] })).toBeNull();
    expect(findsChart({ all: Array(12).fill(0), attached: Array(12).fill(0) })).toBeNull();
    const bad = findsChart({ all: [5, ...Array(11).fill(0)], attached: [9] }, JULY)!;
    expect(bad.bars[0].attached).toBe(5);
    expect(bad.bars[1].attached).toBe(0);
  });
});

describe("riskFlags", () => {
  it("takes the expert's accumulation list", () => {
    expect(riskFlags(["jod"], []).map((f) => f.label)).toEqual(["Jod"]);
    expect(riskFlags(["cadmium", "arsen"], []).map((f) => f.key)).toEqual(["arsen", "cadmium"]);
    expect(riskFlags(null, undefined)).toEqual([]);
  });

  it("adds what the warnings name (kainic acid in dulse)", () => {
    const sol = [
      "Søl indeholder giftstoffet kainsyre (op til ca. 560 µg pr. gram tørret søl i målte prøver).",
    ];
    expect(riskFlags(null, sol)).toEqual([{ key: "kainsyre", label: "Kainsyre", inWarning: true }]);
    // the explicit field gives the badge without any warning text
    expect(riskFlags(null, [], ["kainsyre"]).map((f) => f.key)).toEqual(["kainsyre"]);
    const kelp = ["Tangen kan indeholde store mængder jod."];
    expect(riskFlags(["jod"], kelp)).toEqual([{ key: "jod", label: "Jod", inWarning: true }]);
    expect(riskFlags(["jod"], [])[0].inWarning).toBe(false);
  });

  it("does not match words that merely contain the letters", () => {
    expect(riskFlags(null, ["Vokser på jordbund og sten."])).toEqual([]);
  });
});

describe("riskFlags: compounds and negation", () => {
  it("matches compounds and skips a negated term", () => {
    expect(riskFlags(null, ["Højt jodindhold."]).map((f) => f.key)).toEqual(["jod"]);
    expect(riskFlags(null, ["Kan indeholde uorganisk arsen."]).map((f) => f.key)).toEqual([
      "arsen",
    ]);
    // negations are not parsed: an extra badge is the safe error, a missing one is not
    expect(riskFlags(null, ["Spis ikke tangen rå: kainsyre."]).map((f) => f.key)).toEqual([
      "kainsyre",
    ]);
    expect(
      riskFlags(null, ["Ingen grænse for jod i loven, men høj jod."]).map((f) => f.key),
    ).toEqual(["jod"]);
    expect(riskFlags(null, ["Bør ikke spises pga. kainsyre."]).map((f) => f.key)).toEqual([
      "kainsyre",
    ]);
    const kelp = ["Kan indeholde store mængder jod. Man bør ikke spise store mængder dagligt."];
    expect(riskFlags(null, kelp).map((f) => f.key)).toEqual(["jod"]);
  });
});

describe("listNote", () => {
  const pending = { accumulation: null, season_months: null };
  const known = { accumulation: ["jod"] as ("jod" | "arsen" | "cadmium")[], season_months: null };

  it("always says no badge is no all-clear, with the pending share", () => {
    const lines = listNote([pending], [pending, pending, known], JULY);
    expect(lines[1]).toBe(
      "Ingen markering betyder ikke, at arten er sikker; for de fleste arter afventer ophobning stadig vores fagperson.",
    );
    expect(listNote([known], [pending, known, known], JULY)[1]).toContain("for nogle arter");
    expect(listNote([known], [known], JULY)[1]).toBe(
      "Ingen markering betyder ikke, at arten er sikker.",
    );
  });

  it("follows the rows shown for the season lines", () => {
    expect(listNote([pending], [pending], JULY)).toContain(
      "De bedste måneder for hver art afventer også vores fagperson.",
    );
    const starred = { ...pending, season_months: [7], expert_verified: false };
    const lines = listNote([starred, pending], [starred, pending], JULY);
    expect(lines).toContain("„Sæson nu*“ er foreløbig og endnu ikke bekræftet af vores fagperson.");
    expect(lines).toContain(
      "For 1 af de viste arter afventer de bedste måneder stadig vores fagperson.",
    );
    // months given but not this month: no star is shown, so no star line
    const later = { ...pending, season_months: [1], expert_verified: false };
    expect(listNote([later], [later], JULY).join(" ")).not.toContain("Sæson nu");
    expect(listNote([], [pending], JULY)).toHaveLength(2);
  });
});
