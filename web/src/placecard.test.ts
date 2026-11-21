import { describe, expect, it } from "vitest";

import {
  headerNames,
  kindLabel,
  nearPlaces,
  osmCreditLabel,
  outlineCredit,
  placeAlt,
  placeDistance,
  PLACE_RADIUS_M,
  SHORE_RADIUS_M,
} from "./placecard";
import type { PlaceCard } from "./types";

const card = (over: Partial<PlaceCard>): PlaceCard => ({
  id: "Q1",
  name: "Sted",
  kind: "beach",
  lon: 10.2,
  lat: 56.15,
  reviewed: false,
  ...over,
});

// ~111 m per 0.001° of latitude; ~62 m per 0.001° of longitude at 56°N
const north = (m: number): [number, number] => [10.2, 56.15 + m / 110_574];

describe("placeDistance", () => {
  it("is the distance to the point without an outline", () => {
    expect(placeDistance(card({}), north(300))).toBeCloseTo(300, -1);
  });

  it("is 0 inside the outline", () => {
    const ring: [number, number][] = [
      [10.19, 56.14],
      [10.21, 56.14],
      [10.21, 56.16],
      [10.19, 56.16],
      [10.19, 56.14],
    ];
    const big = card({ lon: 10.3, lat: 56.3, geom: { type: "ring", coords: ring } });
    expect(placeDistance(big, [10.2, 56.15])).toBe(0);
  });

  it("measures to the nearest edge of a line or outline", () => {
    const line: [number, number][] = [
      [10.18, 56.15],
      [10.22, 56.15],
    ];
    const cliff = card({ lon: 10.3, lat: 56.3, geom: { type: "line", coords: line } });
    expect(placeDistance(cliff, north(200))).toBeCloseTo(200, -1);
  });
});

describe("nearPlaces", () => {
  it("keeps the places within the radius, nearest first", () => {
    const far = card({ id: "far", name: "Langt", lat: 56.15 + 900 / 110_574 });
    const mid = card({ id: "mid", name: "Midt", lat: 56.15 + 300 / 110_574 });
    const near = card({ id: "near", name: "Nær", lat: 56.15 + 50 / 110_574 });
    const got = nearPlaces([far, mid, near], [10.2, 56.15]);
    expect(got.map((n) => n.card.id)).toEqual(["near", "mid"]);
    expect(got[0].distanceM).toBeLessThan(got[1].distanceM);
  });

  it("uses 500 m by default", () => {
    expect(PLACE_RADIUS_M).toBe(500);
    const edge = card({ lat: 56.15 + 490 / 110_574 });
    const out = card({ lat: 56.15 + 520 / 110_574 });
    expect(nearPlaces([edge], [10.2, 56.15])).toHaveLength(1);
    expect(nearPlaces([out], [10.2, 56.15])).toHaveLength(0);
  });

  it("puts a beach before the bay it lies in when the pin is inside both", () => {
    const ring: [number, number][] = [
      [10.1, 56.1],
      [10.3, 56.1],
      [10.3, 56.2],
      [10.1, 56.2],
      [10.1, 56.1],
    ];
    const bay = card({
      id: "bay",
      kind: "bay",
      name: "Bugten",
      geom: { type: "ring", coords: ring },
    });
    const beach = card({ id: "beach", name: "Stranden", geom: { type: "ring", coords: ring } });
    expect(nearPlaces([bay, beach], [10.2, 56.15]).map((n) => n.card.id)).toEqual(["beach", "bay"]);
  });

  it("returns nothing for an empty list", () => {
    expect(nearPlaces([], [10.2, 56.15])).toEqual([]);
  });
});

describe("labels", () => {
  it("names the kind in Danish", () => {
    expect(kindLabel("marina")).toBe("Lystbådehavn");
    expect(kindLabel("headland")).toBe("Pynt");
    expect(kindLabel("unknown")).toBe("Sted");
  });

  it("gives the photo an alt text from the name and kind", () => {
    expect(placeAlt(card({ name: "Den Permanente" }))).toBe("Foto af Den Permanente (strand)");
  });
});

describe("shores (peninsulas and islets)", () => {
  // a square peninsula; its shore is the north, east and south sides
  const shore: [number, number][][] = [
    [
      [10.19, 56.16],
      [10.21, 56.16],
      [10.21, 56.14],
      [10.19, 56.14],
    ],
  ];
  const peninsula = card({ id: "p", kind: "peninsula", lon: 10.2, lat: 56.15, shore });

  it("shows no card for a pin inland on the peninsula", () => {
    // its centre: ~1.1 km from the north and south sides, ~620 m from the east
    expect(placeDistance(peninsula, [10.2, 56.15])).toBeGreaterThan(SHORE_RADIUS_M);
    expect(nearPlaces([peninsula], [10.2, 56.15])).toEqual([]);
  });

  it("shows the card at its shore, inside or outside", () => {
    const inside: [number, number] = [10.2, 56.16 - 100 / 110_574];
    const outside: [number, number] = [10.2, 56.16 + 200 / 110_574];
    expect(nearPlaces([peninsula], inside)).toHaveLength(1);
    expect(nearPlaces([peninsula], outside)).toHaveLength(1);
    expect(nearPlaces([peninsula], [10.2, 56.16 + 400 / 110_574])).toHaveLength(0);
  });

  it("takes the shore over the point", () => {
    // the point is at the pin, but the shore is far
    expect(placeDistance(peninsula, [10.2, 56.15])).toBeCloseTo(620, -2);
  });
});

describe("big bays with a shore round their point", () => {
  // the bay's point 2 km out; its shore runs north-south 2 km west of it
  const west = (m: number): number => 10.2 - m / 62_300;
  const shore: [number, number][][] = [
    [
      [west(2000), 56.13],
      [west(2000), 56.17],
    ],
  ];
  const bay = card({ id: "bay", kind: "bay", name: "Bugten", lon: 10.2, lat: 56.15, shore });

  it("shows the card at the shore", () => {
    expect(nearPlaces([bay], [west(1800), 56.15])).toHaveLength(1);
    expect(nearPlaces([bay], [west(2250), 56.15])).toHaveLength(1);
  });

  it("shows the card on the water near the point", () => {
    expect(nearPlaces([bay], [west(450), 56.15])).toHaveLength(1);
  });

  it("shows no card between them or inland", () => {
    expect(nearPlaces([bay], [west(1000), 56.15])).toEqual([]);
    expect(nearPlaces([bay], [west(2500), 56.15])).toEqual([]);
  });
});

describe("near-equal places", () => {
  const ring: [number, number][] = [
    [10.1, 56.1],
    [10.3, 56.1],
    [10.3, 56.2],
    [10.1, 56.2],
    [10.1, 56.1],
  ];
  // the pin in a fjord (inside its outline, 0 m), 60 m off a peninsula's shore
  const fjord = card({
    id: "fjord",
    kind: "bay",
    name: "Lammefjorden",
    geom: { type: "ring", coords: ring },
  });
  const naes = card({
    id: "naes",
    kind: "peninsula",
    name: "Tuse Næs",
    shore: [
      [
        [10.19, 56.15 + 60 / 110_574],
        [10.21, 56.15 + 60 / 110_574],
      ],
    ],
  });
  const beach = card({ id: "beach", name: "Strandvejen Strand", lat: 56.15 + 90 / 110_574 });

  it("puts a shore or land card before a bay about as near", () => {
    expect(nearPlaces([fjord, naes], [10.2, 56.15]).map((n) => n.card.id)).toEqual([
      "naes",
      "fjord",
    ]);
  });

  it("puts the card the pin's header names first", () => {
    const got = nearPlaces(
      [fjord, naes, beach],
      [10.2, 56.15],
      undefined,
      "Ved Strandvejen Strand",
    );
    expect(got[0].card.id).toBe("beach");
    expect(
      nearPlaces([fjord, naes, beach], [10.2, 56.15], undefined, "Ved Tuse Næs")[0].card.id,
    ).toBe("naes");
  });

  it("keeps the nearest when the others are over 100 m further", () => {
    const far = card({
      ...naes,
      id: "far",
      shore: [
        [
          [10.19, 56.152],
          [10.21, 56.152],
        ],
      ],
    });
    expect(nearPlaces([fjord, far], [10.2, 56.15])[0].card.id).toBe("fjord");
  });

  it("reads the header case-blind", () => {
    expect(headerNames("På tuse næs", "Tuse Næs")).toBe(true);
    expect(headerNames(null, "Tuse Næs")).toBe(false);
  });
});

describe("credits", () => {
  it("credits OpenStreetMap only when it had a part", () => {
    expect(outlineCredit({})).toEqual([]);
    expect(outlineCredit({ shore: [] })).toEqual([]);
  });

  it("credits a card matched in OpenStreetMap without an outline", () => {
    expect(osmCreditLabel({ osm: true })).toBe("Kortdata");
    expect(osmCreditLabel({})).toBeNull();
  });

  it("calls an outline or shore Afgrænsning", () => {
    expect(
      osmCreditLabel({
        osm: true,
        shore: [
          [
            [10, 56],
            [10.1, 56],
          ],
        ],
      }),
    ).toBe("Afgrænsning");
    expect(
      osmCreditLabel({
        geom: {
          type: "line",
          coords: [
            [10, 56],
            [10.1, 56],
          ],
        },
      }),
    ).toBe("Afgrænsning");
  });
});
