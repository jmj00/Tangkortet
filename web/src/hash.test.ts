import { describe, expect, it } from "vitest";

import { formatHash, parseHash } from "./hash";

describe("hash links", () => {
  it("round-trips a pin and tab", () => {
    const hash = formatHash([10.4, 56.2], "risiko");
    expect(hash).toBe("#pin=56.20000,10.40000&tab=risiko");
    expect(parseHash(hash)).toEqual({ pin: [10.4, 56.2], tab: "risiko", species: null });
    expect(parseHash(formatHash(null, "arter", "fucus-serratus"))).toEqual({
      pin: null,
      tab: "arter",
      species: "fucus-serratus",
    });
  });

  it("ignores pins outside Denmark, junk and unknown tabs", () => {
    const empty = { pin: null, tab: null, species: null };
    expect(parseHash("#pin=48.8,2.3&tab=x&art=<script>")).toEqual(empty);
    expect(parseHash("#pin=abc")).toEqual(empty);
    expect(parseHash("")).toEqual(empty);
  });
});
