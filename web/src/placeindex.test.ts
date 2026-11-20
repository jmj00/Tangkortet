import { describe, expect, it } from "vitest";

import {
  buildPlaceIndex,
  coastSlip,
  foldLetters,
  matchPlaces,
  nameRank,
  normalizeName,
  oneSlipApart,
  parseAddressQuery,
  isPlaceName,
  type RawPlaces,
} from "./placeindex";
import raw from "./data/places.json";

// The real list (pipeline/places.py): the searches the app promises to answer.
const real = buildPlaceIndex(raw as unknown as RawPlaces);
const first = (q: string) => matchPlaces(real, q)[0];
const texts = (q: string) => matchPlaces(real, q).map((s) => s.text);

describe("matchPlaces on the real list", () => {
  it("finds a town by its name", () => {
    expect(first("Silkeborg")).toMatchObject({ text: "Silkeborg", kind: "town", rank: 0 });
    expect(first("silkeborg").meta).toBe("By"); // a city: no district
    expect(first("Skagen")).toMatchObject({ text: "Skagen", kind: "town" });
  });

  it("lists the village of Rold with its district", () => {
    expect(first("Rold")).toMatchObject({ text: "Rold", meta: "By · 9510 Arden" });
  });

  it("finds Aarhus spelled any way, the city before its districts and beaches", () => {
    for (const q of ["Aarhus", "aarhus", "Århus", "AARHUS"]) expect(first(q).text).toBe("Aarhus");
    expect(texts("Aarhus")).not.toContain("8000 Aarhus C");
  });

  it("lists towns beginning with three letters", () => {
    const aar = texts("Aar");
    expect(aar[0]).toBe("Aarhus");
    expect(aar).toEqual(expect.arrayContaining(["Aars", "Aarup"]));
    expect(aar.length).toBeLessThanOrEqual(6);
  });

  it("places a postal district at its town, not the middle of its box", () => {
    const s = first("6857");
    expect(s).toMatchObject({ text: "6857 Blåvand", kind: "postal", meta: "Postnummer" });
    // Blåvand is at 8.08 E; the box's middle lies far out in the North Sea
    expect(s.target[0]).toBeGreaterThan(8.0);
    expect(s.target[0]).toBeLessThan(8.2);
  });

  it("lists districts for three digits, and København K once", () => {
    expect(texts("685")).toContain("6857 Blåvand");
    expect(texts("105").filter((t) => t.endsWith("København K"))).toHaveLength(1);
    expect(matchPlaces(real, "9999")).toEqual([]);
  });

  it("finds a bathing site, before the holiday-home area of the same name", () => {
    const vemmetofte = matchPlaces(real, "Vemmetofte Strand");
    expect(vemmetofte[0]).toMatchObject({ text: "Vemmetofte Strand", kind: "coast", zoom: 14 });
    expect(vemmetofte[0].meta).toMatch(/^Badested · 46\d\d /);
    // the village of Vemmetofte is the name itself; the beach comes next
    expect(
      matchPlaces(real, "vemmetofte")
        .slice(0, 2)
        .map((s) => s.kind),
    ).toEqual(["town", "coast"]);
  });

  it("lists the town before beaches named after it", () => {
    const skagen = matchPlaces(real, "Skagen");
    expect(skagen[0].kind).toBe("town");
    expect(skagen.some((s) => s.kind === "coast")).toBe(true);
  });

  it("forgives one slip in a longer name", () => {
    expect(first("Silkebrog").text).toBe("Silkeborg");
  });

  it("finds a place of one or two letters by that name alone", () => {
    for (const name of ["Ho", "Ry", "Rø", "Eg", "Em", "Øm", "Ås", "Å"]) {
      const found = matchPlaces(real, name);
      expect(found.length, name).toBeGreaterThan(0);
      expect(
        found.every((s) => normalizeName(s.text.replace(/^d{4} /, "")) === normalizeName(name)),
        name,
      ).toBe(true);
    }
    expect(first("Aa").text).toBe("Å"); // "aa" is "å"
    expect(matchPlaces(real, "Qz")).toEqual([]);
    expect(matchPlaces(real, "S")).toEqual([]);
  });

  it("finds nothing for nonsense", () => {
    expect(matchPlaces(real, "xqzvw")).toEqual([]);
  });

  it("forgives one slip in a beach name", () => {
    expect(first("Vemmetofte strnd")).toMatchObject({ text: "Vemmetofte Strand", kind: "coast" });
  });

  it("knows Kbh, and æ, ø, å typed as a, o", () => {
    expect(first("Kbh").text).toBe("København");
    expect(first("cph").text).toBe("København");
    expect(first("Fano").text).toBe("6720 Fanø");
    expect(first("Romo").text).toBe("6792 Rømø");
    expect(first("Naestved").text).toBe("Næstved");
  });

  it("takes a postal number before or after the town, with or without a space", () => {
    for (const q of ["Silkeborg 8600", "Silkeborg, 8600", "8600Silkeborg", "8600 Silkeborg"]) {
      expect(texts(q), q).toEqual(["Silkeborg", "8600 Silkeborg"]);
    }
    expect(texts("8600")).toEqual(["8600 Silkeborg"]);
  });

  it("drops a holiday-home area named after the beach beside it", () => {
    const found = matchPlaces(real, "Vemmetofte Strand");
    expect(found.filter((s) => s.text === "Vemmetofte Strand").map((s) => s.kind)).toEqual([
      "coast",
    ]);
  });

  it("never lists one suggestion twice", () => {
    for (const q of ["Strand", "Nord", "Hel", "Søby", "Aar"]) {
      const ids = matchPlaces(real, q).map((s) => `${s.text}|${s.meta}`);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("parseAddressQuery and isPlaceName", () => {
  it("turns a town after an address into its postal number", () => {
    expect(parseAddressQuery(real, "Vestergade 10 Silkeborg").texts).toEqual([
      "Vestergade 10, 8600",
    ]);
    expect(parseAddressQuery(real, "Vestergade 10, 8600").texts).toEqual(["Vestergade 10, 8600"]);
    expect(parseAddressQuery(real, "Vestergade 10").scoped).toBe(false);
  });

  it("knows a bare place name", () => {
    expect(isPlaceName(real, "Silkeborg")).toBe(true);
    expect(isPlaceName(real, "vemmetofte strand")).toBe(true);
    expect(isPlaceName(real, "Vestergade 10")).toBe(false);
  });
});

describe("a small list", () => {
  const index = buildPlaceIndex({
    postal: [
      ["4000", "Roskilde", 12.0, 55.6, 12.2, 55.7],
      ["4640", "Faxe", 12.0, 55.1, 12.3, 55.3],
    ],
    towns: [
      ["Roskilde", 12.08, 55.64, 3.0, 0, 0],
      ["Faxe", 12.12, 55.25, 1.5, 1, 0],
      ["Strandhuse", 12.2, 55.2, 0.5, 1, 2],
    ],
    coast: [
      ["Roskilde Fjord, Strandvejen", 12.07, 55.66, 0],
      ["Faxe Strand", 12.13, 55.21, 1],
      ["Strandhuse", 12.2, 55.21, 1],
    ],
  });

  it("orders by rank, then the town meant, then beaches, then other towns", () => {
    expect(matchPlaces(index, "roskilde").map((s) => s.text)).toEqual([
      "Roskilde",
      "Roskilde Fjord, Strandvejen",
    ]);
    // the beach "Strandhuse" before the holiday-home area of that name
    expect(matchPlaces(index, "strandhuse").map((s) => s.kind)).toEqual(["coast", "town"]);
  });

  it("matches inside a word only from four letters", () => {
    expect(matchPlaces(index, "and").map((s) => s.text)).toEqual([]);
    expect(matchPlaces(index, "rand").map((s) => s.text)).toContain("Faxe Strand");
  });

  it("works without any bathing sites", () => {
    const old = buildPlaceIndex({ postal: [["4640", "Faxe", 12, 55, 12.3, 55.3]], towns: [] });
    expect(matchPlaces(old, "Faxe")).toEqual([
      expect.objectContaining({ text: "4640 Faxe", kind: "postal" }),
    ]);
  });
});

describe("helpers", () => {
  it("normalizes spelling", () => {
    expect(normalizeName(" AARHUS  Ø ")).toBe("århus ø");
    expect(normalizeName("Skt.-Klemens")).toBe("skt klemens");
  });

  it("ranks names", () => {
    expect(nameRank("vemmetofte strand", "vemmetofte strand")).toBe(0);
    expect(nameRank("vemmetofte strand", "strand")).toBe(1);
    expect(nameRank("faxe strand", "rand")).toBe(2);
    expect(nameRank("faxe", "rold")).toBe(-1);
  });

  it("folds æ, ø, å and finds a beach one slip off", () => {
    expect(foldLetters("rømø")).toBe(foldLetters("romo"));
    expect(foldLetters("næstved")).toBe(foldLetters("naestved"));
    expect(coastSlip("vemmetofte strand", "vemmetofte strnd")).toBe(0);
    expect(coastSlip("vemmetofte strand øst", "vemmetofte strnd")).toBe(1);
    expect(coastSlip("vemmetofte strand", "skagen")).toBe(-1);
  });

  it("allows one slip", () => {
    expect(oneSlipApart("silkeborg", "silkebrog")).toBe(true);
    expect(oneSlipApart("silkeborg", "silkbrog")).toBe(false);
  });
});
