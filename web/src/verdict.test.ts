import { describe, expect, it } from "vitest";

import type { RiskItem } from "./risk";
import { STREAM_RADIUS_M } from "./live";
import { evaluate, RULES } from "./verdict";

const NONE = { names: [], unnamed: 0 };

function item(group: RiskItem["group"], distanceM: number, kind?: string): RiskItem {
  return { group, distanceM, kind, lon: 0, lat: 0, title: `${group}-${distanceM}`, detail: "" };
}

const ids = (v: ReturnType<typeof evaluate>) => v.reasons.map((r) => r.rule.id);

describe("traffic light", () => {
  it("is green when nothing matches, and says what it could not check", () => {
    const v = evaluate({ items: [item("overloeb", 5000)], rain48: 2, soilV2: 0, streams: NONE });
    expect(v.level).toBe("green");
    expect(v.reasons).toEqual([]);
    expect(v.unchecked).toEqual([]);
  });

  it("is red for an overflow at 300 m after heavy rain, listed once", () => {
    const v = evaluate({ items: [item("overloeb", 300)], rain48: 13.6, soilV2: 0, streams: NONE });
    expect(v.level).toBe("red");
    expect(ids(v)).toEqual(["overloeb_regn", "regn"]);
    expect(v.reasons[0].evidence).toBe("nærmeste: overloeb-300, 300 m");
  });

  it("is only yellow for the same overflow in dry weather", () => {
    const v = evaluate({ items: [item("overloeb", 300)], rain48: 1, soilV2: 0, streams: NONE });
    expect(v.level).toBe("yellow");
    expect(ids(v)).toEqual(["overloeb"]);
  });

  it("tells commercial harbours from marinas", () => {
    const marina = evaluate({
      items: [item("havne", 400, "Lystbådehavn")],
      rain48: 0,
      soilV2: 0,
      streams: NONE,
    });
    expect(marina.level).toBe("yellow");
    const port = evaluate({
      items: [item("havne", 400, "Erhvervshavn og lystbådehavn")],
      rain48: 0,
      soilV2: 0,
      streams: NONE,
    });
    expect(port.level).toBe("red");
    expect(ids(port)).toEqual(["erhvervshavn_naer"]);
  });

  it("matches bathing water by EU class and dumping sites by status", () => {
    const v = evaluate({
      items: [
        item("badevand", 800, "1"),
        item("badevand", 900, "4"),
        item("klapplads", 0, "nedlagt"),
      ],
      rain48: 0,
      soilV2: 0,
      streams: NONE,
    });
    expect(v.level).toBe("yellow");
    expect(ids(v)).toEqual(["klapplads", "badevand_daarlig"]);
  });

  it("counts V2 soil sites and reports missing live data as unchecked", () => {
    const v = evaluate({ items: [], rain48: null, soilV2: 2, streams: NONE });
    expect(v.level).toBe("yellow");
    expect(v.reasons[0].evidence).toBe("2 grunde");
    expect(v.unchecked.map((r) => r.id)).toEqual(["overloeb_regn", "vandloeb_regn", "regn"]);
  });

  it("cannot judge without the mapped sources", () => {
    expect(evaluate({ items: null, rain48: 0, soilV2: 0, streams: NONE }).level).toBe("unknown");
  });

  it("has a unique id and a Danish text for every rule", () => {
    const all = RULES.rules.map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
    for (const r of RULES.rules) expect(r.text.length).toBeGreaterThan(10);
  });

  it("follows the expert's stream-mouth rule: yellow, red after rain, shown once", () => {
    const aa = { names: ["Århus Å"], unnamed: 0 };
    const dry = evaluate({ items: [], rain48: 2, soilV2: 0, streams: aa });
    expect(dry.level).toBe("yellow");
    expect(ids(dry)).toEqual(["vandloeb"]);
    expect(dry.reasons[0].evidence).toBe("Århus Å");
    const wet = evaluate({ items: [], rain48: 12, soilV2: 0, streams: aa });
    expect(wet.level).toBe("red");
    expect(ids(wet)).toEqual(["vandloeb_regn", "regn"]);
  });

  it("names an unnamed small watercourse and reports a failed stream query", () => {
    const small = evaluate({ items: [], rain48: 0, soilV2: 0, streams: { names: [], unnamed: 1 } });
    expect(small.reasons[0].evidence).toBe("et mindre beskyttet vandløb");
    const failed = evaluate({ items: [], rain48: 0, soilV2: 0, streams: null });
    expect(failed.level).toBe("green");
    // Dry weather: the after-rain rule cannot match anyway, so only this one is open.
    expect(failed.unchecked.map((r) => r.id)).toEqual(["vandloeb"]);
  });

  it("uses the expert's round-2 distances", () => {
    const byId = Object.fromEntries(RULES.rules.map((r) => [r.id, r]));
    expect(byId.overloeb.within_m).toBe(2000);
    expect(byId.klapplads_aktiv.within_m).toBe(500);
    for (const r of RULES.rules.filter((r) => r.type === "stream")) {
      expect(r.within_m).toBe(STREAM_RADIUS_M);
    }
  });
});
