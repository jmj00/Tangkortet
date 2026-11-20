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
  nearestPlace,
  coastPlaceName,
  isGenericCoastName,
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

  it("forgives one slip in a beach name, only when no town matches", () => {
    expect(first("Vemmetofte strnd")).toMatchObject({ text: "Vemmetofte Strand", kind: "coast" });
    expect(texts("Rørvig").filter((t) => t.startsWith("Rødvig"))).toEqual([]);
  });

  it("knows Kbh, and æ, ø, å typed as a, o", () => {
    expect(first("Kbh").text).toBe("København");
    expect(first("cph").text).toBe("København");
    expect(first("Fano").text).toBe("6720 Fanø");
    expect(first("Romo").text).toBe("6792 Rømø");
    expect(first("Naestved").text).toBe("Næstved");
    expect(first("Aero").text).toBe("Ærøskøbing");
    expect(first("Arhus").text).toBe("Aarhus");
    expect(first("Aarhus").text).toBe("Aarhus");
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
    expect(foldLetters("ærø")).not.toBe(foldLetters("årø"));
    expect(foldLetters("ærø", true)).toBe(foldLetters("årø", true));
    expect(coastSlip("vemmetofte strand", "vemmetofte strnd")).toBe(0);
    expect(coastSlip("vemmetofte strand øst", "vemmetofte strnd")).toBe(1);
    expect(coastSlip("vemmetofte strand", "skagen")).toBe(-1);
  });

  it("allows one slip", () => {
    expect(oneSlipApart("silkeborg", "silkebrog")).toBe(true);
    expect(oneSlipApart("silkeborg", "silkbrog")).toBe(false);
  });
});

describe("nearestPlace", () => {
  const index = buildPlaceIndex({
    postal: [],
    towns: [
      ["Bystad", 10.0, 56.0, 2.0, -1, 0],
      ["Bystad Nord", 10.0, 56.015, 0.5, -1, 1],
      ["Lillelund", 10.2, 56.0, 0.3, -1, 0],
    ],
    coast: [
      ["Lillelund Strand", 10.2, 56.01, -1],
      ["100 m nord for Lillelund Strand", 10.2, 56.011, -1],
    ],
  });

  it("names the town a point lies in, the nearer centre of two", () => {
    expect(nearestPlace(index, [10.0, 56.0])).toMatchObject({ name: "Bystad", distanceM: 0 });
    // inside both Bystad (2 km) and Bystad Nord (0.5 km): the part of town
    expect(nearestPlace(index, [10.0, 56.014])?.name).toBe("Bystad Nord");
  });

  it("measures a town to the edge of its area", () => {
    const p = nearestPlace(index, [10.0, 56.05]); // 5.6 km from Bystad's centre
    expect(p?.name).toBe("Bystad Nord");
    expect(p?.distanceM).toBeGreaterThan(3000);
  });

  it("prefers a bathing site right by the point", () => {
    expect(nearestPlace(index, [10.2, 56.0105])).toMatchObject({
      name: "Lillelund Strand",
      kind: "coast",
    });
  });

  it("skips bathing sites named by where they are", () => {
    expect(nearestPlace(index, [10.2, 56.0112])?.name).toBe("Lillelund Strand");
  });

  it("returns null out at sea", () => {
    expect(nearestPlace(index, [11.0, 56.5])).toBeNull();
  });

  it("names a spot on the real list", () => {
    // Aarhus harbour front (the README's risk example)
    const p = nearestPlace(real, [10.219, 56.151]);
    expect(p).not.toBeNull();
    expect(p?.distanceM).toBeLessThan(2000);
  });
});

describe("bathing-site names as place names", () => {
  it("drops names that only describe where the site is", () => {
    for (const name of [
      "100 m nord for Gl. Løgten Strandkro",
      "Syd for Humlebæk Havn",
      "Nord for Thorsminde",
      "Øst for Havn",
      "Vest for Bønnerup Havn (Strømrende)",
      "Ud for Tværvej",
      "Bag ved Havn, Sejerø",
      "Mellem Marenmølle Bæk og Lystbådehavnen",
      "Overfor Kirken",
      "Ved Lunden",
    ])
      expect(coastPlaceName(name), name).toBeNull();
  });

  it("keeps the name before a description", () => {
    expect(coastPlaceName("Falsled, syd for havnen")).toBe("Falsled");
    expect(coastPlaceName("Nordby ud for Campingplads")).toBe("Nordby");
    expect(coastPlaceName("Blåvand Strand ved Høfde 1")).toBe("Blåvand Strand");
    expect(coastPlaceName("Tversted Strand, 500 m øst for Nedkørsel")).toBe("Tversted Strand");
    expect(coastPlaceName("Skagen Syd, v/Damstedvej")).toBe("Skagen Syd");
    expect(coastPlaceName("Amager Strandpark, Øresund")).toBe("Amager Strandpark, Øresund");
    expect(coastPlaceName("Bellevue Strand")).toBe("Bellevue Strand");
  });

  it("knows a generic beach name", () => {
    for (const name of ["Sydstranden", "Stranden", "Søbad Nord", "Badebro", "Offentlig Strand"])
      expect(isGenericCoastName(name), name).toBe(true);
    for (const name of ["Bellevue Strand", "Amager Strandpark", "Kerteminde"])
      expect(isGenericCoastName(name), name).toBe(false);
  });
});

describe("nearestPlace between beaches and towns", () => {
  const index = buildPlaceIndex({
    postal: [],
    towns: [
      ["Kystby", 10.0, 56.0, 1.0, -1, 0],
      ["Kystby Øst", 10.03, 56.0, 0.3, -1, 1],
    ],
    coast: [
      ["Sydstranden", 10.0, 55.993, -1],
      ["Fin Strandpark", 10.04, 55.995, -1],
    ],
  });

  it("names a generic beach with its town", () => {
    // 330 m from Sydstranden, inside Kystby
    expect(nearestPlace(index, [10.0, 55.996])).toMatchObject({
      name: "Sydstranden",
      kind: "coast",
      town: "Kystby",
    });
  });

  it("prefers a beach within 800 m over a part of a town", () => {
    // ~600 m from Fin Strandpark, ~250 m from the edge of Kystby Øst
    const p = nearestPlace(index, [10.035, 56.0]);
    expect(p).toMatchObject({ name: "Fin Strandpark", kind: "coast" });
    expect(p?.town).toBeUndefined();
  });

  it("keeps the town proper the point lies in over a beach 400-800 m away", () => {
    expect(nearestPlace(index, [10.0, 56.0])?.name).toBe("Kystby");
  });
});

describe("nearestPlace with its town proper", () => {
  const index = buildPlaceIndex({
    postal: [],
    towns: [
      ["Havneby", 10.0, 56.0, 2.0, -1, 0],
      ["Klostervang", 10.001, 56.001, 0.4, -1, 1],
    ],
    coast: [["Bugten", 10.0, 56.03, -1]],
  });

  it("says the town after a part of it", () => {
    expect(nearestPlace(index, [10.001, 56.001])).toMatchObject({
      name: "Klostervang",
      town: "Havneby",
    });
  });

  it("says the town after a beach just outside it", () => {
    // ~550 m from Bugten, ~900 m from Havneby's edge
    expect(nearestPlace(index, [10.0, 56.025])).toMatchObject({ name: "Bugten", town: "Havneby" });
  });
});

describe("official coastal names (Danske Stednavne)", () => {
  it("finds beaches, harbours, landforms and waters with their kind", () => {
    expect(first("Helgenæs")).toMatchObject({ text: "Helgenæs", kind: "landform" });
    expect(first("Helgenæs").meta).toBe("Halvø · 8420 Knebel");
    // the bathing site and the harbour of that name, 360 m apart: one entry
    const marina = matchPlaces(real, "Egå Marina").filter((s) => s.text === "Egå Marina");
    expect(marina).toHaveLength(1);
    expect(marina[0].meta).toBe("Badested og lystbådehavn · 8250 Egå");
    expect(texts("Egå").filter((t) => t === "Egå Marina")).toHaveLength(1);
    const kalo = matchPlaces(real, "Kalø");
    expect(kalo[0]).toMatchObject({ text: "Kalø Vig", kind: "water", meta: "Bugt" });
    expect(kalo.map((s) => s.text)).toContain("Kaløvig Bådehavn");
  });

  it("puts the town's own harbour before islets that only begin with its name", () => {
    const ronne = texts("Rønne");
    expect(ronne[0]).toBe("Rønne");
    expect(ronne).toContain("Rønne Havn");
    const islet = ronne.indexOf("Rønnen");
    if (islet >= 0) expect(ronne.indexOf("Rønne Havn")).toBeLessThan(islet);
  });

  it("finds Århus Bugt spelled the Aarhus way, zoomed out to the bay", () => {
    const s = first("Aarhus Bugt");
    expect(s).toMatchObject({ text: "Århus Bugt", kind: "water" });
    expect(s.zoom).toBeLessThan(10);
  });

  it("keeps the town first for a town's name", () => {
    expect(first("Aarhus").text).toBe("Aarhus");
    expect(isPlaceName(real, "Kalø Vig")).toBe(true);
  });
});

describe("nearestPlace with landforms", () => {
  const index = buildPlaceIndex({
    postal: [],
    towns: [["Bystad", 10.0, 56.0, 0.5, -1, 0]],
    coast: [],
    names: [
      ["Prøve Pynt", 10.0, 56.03, 0, -1, "pynt"],
      ["Holmø", 10.2, 56.0, 1.0, -1, "ø"],
      ["Storø", 10.6, 56.0, 20, -1, "ø"],
      ["Prøve Bugt", 10.0, 56.1, 5, -1, "bugt"],
      ["Prøve Havn", 10.4, 56.0, 0.1, -1, "lystbådehavn"],
    ],
  });

  it("names a landform nearer than any town", () => {
    expect(nearestPlace(index, [10.0, 56.032])).toMatchObject({
      name: "Prøve Pynt",
      kind: "landform",
    });
    // nearer Bystad's edge than the point
    expect(nearestPlace(index, [10.0, 56.008])?.name).toBe("Bystad");
  });

  it("is on an island inside it", () => {
    expect(nearestPlace(index, [10.205, 56.001])).toMatchObject({ name: "Holmø", on: true });
  });

  it("names no island as large as Fyn, and no water", () => {
    expect(nearestPlace(index, [10.6, 56.0])?.name).not.toBe("Storø");
    expect(nearestPlace(index, [10.0, 56.1])?.name).not.toBe("Prøve Bugt");
  });

  it("names a harbour as it names a bathing site", () => {
    expect(nearestPlace(index, [10.401, 56.0])).toMatchObject({
      name: "Prøve Havn",
      kind: "coast",
    });
  });
});
