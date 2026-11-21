import { describe, expect, it } from "vitest";
import { CLEARED_RGB, clearWhite, FRINGE_PASSES, MIN_SHARE, SEAM_MIN, SEAM_RUN } from "./nodata";

/** n pixels of one colour, RGBA, opaque. */
function pixels(n: number, rgb: [number, number, number]): number[] {
  return Array.from({ length: n }, () => [...rgb, 255]).flat();
}

/** A square tile, `size` wide, of `rgb`, with `white(x, y)` pixels white. */
function tile(
  size: number,
  rgb: [number, number, number],
  white: (x: number, y: number) => boolean,
): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    const c = white(p % size, Math.floor(p / size)) ? [255, 255, 255] : rgb;
    px.set([...c, 255], p * 4);
  }
  return px;
}

const alpha = (px: Uint8ClampedArray, size: number, x: number, y: number): number =>
  px[(y * size + x) * 4 + 3];

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

  it("leaves the photo's dark sea, not white, in a cleared pixel (no light seam when filtered)", () => {
    const px = new Uint8ClampedArray([...pixels(5, [255, 255, 255]), ...pixels(5, [20, 60, 80])]);
    clearWhite(px, 10);
    expect([...px.slice(0, 4)]).toEqual([...CLEARED_RGB, 0]);
  });

  it("clears a no-data block running off the tile's edge", () => {
    const size = 32;
    const px = tile(size, [20, 60, 80], (x) => x >= 20);
    expect(clearWhite(px, size)).toBe(12 * size);
    expect(alpha(px, size, 31, 0)).toBe(0);
    expect(alpha(px, size, 20, 16)).toBe(0);
    expect(alpha(px, size, 19, 16)).toBe(255);
  });

  it("keeps scattered white inside the photo, even when there is a lot of it", () => {
    // roofs and boats: 1-2 px white specks all over, ~10 % of the tile, none
    // touching the edge, beside a real no-data block on the right
    const size = 64;
    const speck = (x: number, y: number): boolean =>
      x > 0 && y > 0 && y < size - 1 && x < 40 && x % 3 === 1 && y % 3 === 1;
    const px = tile(size, [90, 110, 70], (x, y) => speck(x, y) || x >= 56);
    const cleared = clearWhite(px, size);
    expect(cleared).toBe(8 * size);
    for (let y = 1; y < size - 1; y++)
      for (let x = 1; x < 40; x++) if (speck(x, y)) expect(alpha(px, size, x, y)).toBe(255);
    expect(alpha(px, size, 60, 10)).toBe(0);
  });

  it("leaves a small white patch at the edge (a roof cut by the tile) alone", () => {
    const size = 50;
    // 6 x 8 = 48 white pixels, under 2 % of 2500, 8 of them on the edge
    expect(48).toBeLessThan(size * size * MIN_SHARE);
    const px = tile(size, [90, 110, 70], (x, y) => y < 6 && x >= 10 && x < 18);
    expect(clearWhite(px, size)).toBe(0);
    expect(alpha(px, size, 10, 0)).toBe(255);
  });

  it("clears a thin strip of no-data along a whole side of the tile", () => {
    const size = 100;
    // 1 % of the tile, but the full height of it
    const px = tile(size, [72, 96, 108], (x) => x === 0);
    expect(clearWhite(px, size)).toBe(size);
    expect(alpha(px, size, 0, 50)).toBe(0);
  });

  it("clears a light seam on the tile's edge (the fringe of no-data in the next tile)", () => {
    const size = 32;
    const px = tile(size, [72, 96, 108], () => false);
    for (let y = 0; y < size; y++) {
      px.set([236, 240, 244], y * size * 4);
      px.set([163, 177, 186], (y * size + 1) * 4);
    }
    expect(clearWhite(px, size)).toBe(2 * size);
    expect(alpha(px, size, 0, 3)).toBe(0);
    expect(alpha(px, size, 1, 3)).toBe(0);
    expect(alpha(px, size, 2, 3)).toBe(255);
  });

  it("keeps a short light run on the edge (a white roof or a wave crest cut by the tile)", () => {
    const size = 32;
    const px = tile(size, [72, 96, 108], () => false);
    for (let y = 4; y < 4 + SEAM_RUN - 1; y++) px.set([240, 242, 244], y * size * 4);
    expect(clearWhite(px, size)).toBe(0);
  });

  it("keeps a light but not near-white edge (pale concrete, a grey roof row)", () => {
    const size = 32;
    const px = tile(size, [72, 96, 108], () => false);
    for (let y = 0; y < size; y++)
      px.set([SEAM_MIN - 12, SEAM_MIN - 8, SEAM_MIN - 6], y * size * 4);
    expect(clearWhite(px, size)).toBe(0);
  });

  it("clears nothing on noisy land (heath, concrete, roofs at grey 120-170, ±20)", () => {
    // the regression: a light-pixel rule cleared heath and roofs on every
    // tile's edge and drew a dark dotted tile grid over the land
    let seed = 1;
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const size = 256;
    for (const base of [120, 135, 145, 155, 170]) {
      const px = new Uint8ClampedArray(size * size * 4);
      for (let p = 0; p < size * size; p++) {
        const v = base + (rnd() - 0.5) * 40;
        px.set([v + 8, v, v - 6, 255], p * 4);
      }
      expect(clearWhite(px, size)).toBe(0);
    }
  });

  it("keeps light ground running off the tile (sand, a roof)", () => {
    const size = 32;
    const px = tile(size, [72, 96, 108], () => false);
    for (let y = 0; y < size; y++)
      for (const x of [0, 1, 2, 3]) px.set([240, 238, 232], (y * size + x) * 4);
    expect(clearWhite(px, size)).toBe(0);
  });

  it("does not take bright but coloured pixels for white", () => {
    const px = new Uint8ClampedArray(pixels(10, [255, 255, 240]));
    expect(clearWhite(px, 10)).toBe(0);
  });

  it("clears the light JPEG fringe next to the block, FRINGE_PASSES pixels deep", () => {
    // one row: white, white, four light fringe pixels, then water
    const px = new Uint8ClampedArray([
      ...pixels(2, [255, 255, 255]),
      ...pixels(4, [230, 235, 238]),
      ...pixels(4, [20, 60, 80]),
    ]);
    expect(FRINGE_PASSES).toBe(3);
    expect(clearWhite(px, 10)).toBe(5);
    expect([3, 7, 11, 15, 19, 23, 27].map((i) => px[i])).toEqual([0, 0, 0, 0, 0, 255, 255]);
  });
});
