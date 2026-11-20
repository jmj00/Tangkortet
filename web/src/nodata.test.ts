import { describe, expect, it } from "vitest";
import { clearWhite, MIN_SHARE } from "./nodata";

/** n pixels of one colour, RGBA, opaque. */
function pixels(n: number, rgb: [number, number, number]): number[] {
  return Array.from({ length: n }, () => [...rgb, 255]).flat();
}

describe("clearWhite", () => {
  it("clears a white block and keeps the photo", () => {
    const px = new Uint8ClampedArray([
      ...pixels(50, [255, 255, 255]),
      ...pixels(2, [253, 254, 252]),
      ...pixels(48, [20, 60, 80]),
    ]);
    expect(clearWhite(px, 100)).toBe(52);
    expect(px[3]).toBe(0);
    expect(px[51 * 4 + 3]).toBe(0);
    expect(px[52 * 4 + 3]).toBe(255);
  });

  it("leaves a few white pixels (a roof, a boat) alone", () => {
    const n = 1000;
    const few = Math.floor(n * MIN_SHARE) - 1;
    const px = new Uint8ClampedArray([
      ...pixels(few, [255, 255, 255]),
      ...pixels(n - few, [90, 110, 70]),
    ]);
    expect(clearWhite(px, n)).toBe(0);
    expect(px[3]).toBe(255);
  });

  it("does not take bright but coloured pixels for white", () => {
    const px = new Uint8ClampedArray(pixels(10, [255, 255, 240]));
    expect(clearWhite(px, 10)).toBe(0);
  });

  it("clears the light JPEG fringe next to the block, two pixels deep", () => {
    // one row: white, white, three light fringe pixels, then water
    const px = new Uint8ClampedArray([
      ...pixels(2, [255, 255, 255]),
      ...pixels(3, [230, 235, 238]),
      ...pixels(5, [20, 60, 80]),
    ]);
    expect(clearWhite(px, 10)).toBe(4);
    expect([3, 7, 11, 15, 19, 23].map((i) => px[i])).toEqual([0, 0, 0, 0, 255, 255]);
  });
});
