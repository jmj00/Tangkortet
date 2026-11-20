import { describe, expect, it } from "vitest";

import type { RiskItem } from "./risk";
import { evaluate, RULES } from "./verdict";

function item(group: RiskItem["group"], distanceM: number, kind?: string): RiskItem {
  return { group, distanceM, kind, lon: 0, lat: 0, title: `${group}-${distanceM}`, detail: "" };
}

const ids = (v: ReturnType<typeof evaluate>) => v.reasons.map((r) => r.rule.id);

describe("traffic light", () => {
  it("is green when nothing matches, and says what it could not check", () => {
    const v = evaluate({ items: [item("overloeb", 5000)], rain48: 2, soilV2: 0 });
    expect(v.level).toBe("green");
    expect(v.reasons).toEqual([]);
    expect(v.unchecked).toEqual([]);
  });

  it("is red for an overflow at 300 m after heavy rain, listed once", () => {
    const v = evaluate({ items: [item("overloeb", 300)], rain48: 13.6, soilV2: 0 });
    expect(v.level).toBe("red");
    expect(ids(v)).toEqual(["overloeb_regn", "regn"]);
    expect(v.reasons[0].evidence).toBe("nærmeste: overloeb-300, 300 m");
  });

  it("is only yellow for the same overflow in dry weather", () => {
    const v = evaluate({ items: [item("overloeb", 300)], rain48: 1, soilV2: 0 });
    expect(v.level).toBe("yellow");
    expect(ids(v)).toEqual(["overloeb"]);
  });

  it("tells commercial harbours from marinas", () => {
    const marina = evaluate({ items: [item("havne", 400, "Lystbådehavn")], rain48: 0, soilV2: 0 });
    expect(marina.level).toBe("yellow");
    const port = evaluate({
      items: [item("havne", 400, "Erhvervshavn og lystbådehavn")],
      rain48: 0,
      soilV2: 0,
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
    });
    expect(v.level).toBe("yellow");
    expect(ids(v)).toEqual(["klapplads", "badevand_daarlig"]);
  });

  it("counts V2 soil sites and reports missing live data as unchecked", () => {
    const v = evaluate({ items: [], rain48: null, soilV2: 2 });
    expect(v.level).toBe("yellow");
    expect(v.reasons[0].evidence).toBe("2 grunde");
    expect(v.unchecked.map((r) => r.id)).toEqual(["overloeb_regn", "regn"]);
  });

  it("cannot judge without the mapped sources", () => {
    expect(evaluate({ items: null, rain48: 0, soilV2: 0 }).level).toBe("unknown");
  });

  it("has a unique id and a Danish text for every rule", () => {
    const all = RULES.rules.map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
    for (const r of RULES.rules) expect(r.text.length).toBeGreaterThan(10);
  });
});
