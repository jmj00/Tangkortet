import { describe, expect, it } from "vitest";
import { parseBasemapMode } from "./basemapcontrol";

describe("parseBasemapMode", () => {
  it("reads a stored photo choice", () => {
    expect(parseBasemapMode("photo")).toBe("photo");
  });

  it("defaults to the map for anything else", () => {
    for (const stored of [null, undefined, "", "map", "Photo", "satellite"])
      expect(parseBasemapMode(stored)).toBe("map");
  });
});
