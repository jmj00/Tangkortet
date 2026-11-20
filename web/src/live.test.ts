import { describe, expect, it } from "vitest";

import { parseProtected, parseSoil, parseStreams, parseWaterBodies } from "./live";

describe("live parsers", () => {
  it("reads Natura 2000 and fredning names", () => {
    expect(
      parseProtected("habitat", { features: [{ properties: { Objektnavn: "Mols Bjerge" } }] }),
    ).toEqual([{ kind: "habitat", name: "Mols Bjerge" }]);
    expect(
      parseProtected("fredning", {
        features: [
          { properties: { Fred_navn: "Kalø", Fred_tnavn: "Områdefredning", Link: "None" } },
        ],
      }),
    ).toEqual([{ kind: "fredning", name: "Kalø", detail: "Områdefredning", link: undefined }]);
  });

  it("reads water body status", () => {
    expect(
      parseWaterBodies({
        features: [
          {
            properties: {
              ov_navn: "Aarhus Bugt og Begtrup Vig",
              til_oko_sm: "Ringe økologisk tilstand",
              ov_til_kem: "Ikke-god kemisk tilstand",
              mgl_opf: "https://vandplandata.dk/x",
            },
          },
        ],
      }),
    ).toEqual([
      {
        name: "Aarhus Bugt og Begtrup Vig",
        ecological: "Ringe økologisk tilstand",
        chemical: "Ikke-god kemisk tilstand",
        link: "https://vandplandata.dk/x",
      },
    ]);
  });

  it("dedupes soil sites by locality number", () => {
    const json = {
      features: [
        { attributes: { lokalitetsnr: "751-00104", lokalitetetsadresse: "Ankersgade 25" } },
        { attributes: { lokalitetsnr: "751-00104", lokalitetetsadresse: "Ankersgade 25" } },
        { attributes: { lokalitetsnr: "751-00094", lokalitetetsadresse: null } },
      ],
    };
    expect(parseSoil("V2", json)).toEqual([
      { level: "V2", locality: "751-00104", address: "Ankersgade 25" },
      { level: "V2", locality: "751-00094", address: null },
    ]);
  });

  it("treats a missing feature list as empty", () => {
    expect(parseWaterBodies({})).toEqual([]);
    expect(parseSoil("V1", null)).toEqual([]);
  });

  it("names water-plan streams once and counts unnamed ones only on their own", () => {
    const named = {
      features: [
        { properties: { ov_navn: "Giberå" } },
        { properties: { ov_navn: "Giberå" } },
        { properties: { ov_navn: "Lille Fulden Bæk" } },
      ],
    };
    const small = { features: [{ properties: {} }, { properties: {} }] };
    expect(parseStreams(named, small)).toEqual({
      names: ["Giberå", "Lille Fulden Bæk"],
      unnamed: 0,
    });
    expect(parseStreams({ features: [] }, small)).toEqual({ names: [], unnamed: 1 });
    expect(parseStreams({}, {})).toEqual({ names: [], unnamed: 0 });
    // Small-stream query still pending (null): named streams only.
    expect(parseStreams(named, null)).toEqual({
      names: ["Giberå", "Lille Fulden Bæk"],
      unnamed: 0,
    });
  });
});
