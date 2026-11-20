// The aerial photo's "no data" is white: beyond the flown strips, out at sea,
// GeoDanmark's orthophoto WMS paints solid white blocks. As a transparent PNG
// it would be ~10x the bytes of the JPEG (measured 2026-11-20: 722 kB vs 60 kB
// for five tiles), so the photo comes as JPEG and the white is cleared here,
// letting the map's flat water background show through instead of a white
// rectangle.

/** A channel this bright counts as white (JPEG leaves 255 at 252-255). */
export const WHITE_MIN = 252;
/** Only white reached from the tile's edge, and at least this share of the
 * tile, is cleared: no-data comes in large blocks that run off the tile,
 * while a white roof or a boat is a few pixels, usually inside it. */
export const MIN_SHARE = 0.02;
/** ...or white along at least this share of the tile's longer side: the
 * thin end of a no-data block that lies mostly in the next tile. */
export const MIN_EDGE_SHARE = 0.25;

/** JPEG rings at the block's edge: a pixel this light next to a cleared one
 * goes too, for `FRINGE_PASSES` pixels inwards. */
export const FRINGE_MIN = 140;
export const FRINGE_PASSES = 3;

/** What a cleared pixel holds besides alpha 0: the photo's dark sea (map.ts
 * backgroundColor), not white. The map samples the tile with linear
 * filtering, so the colour of a transparent neighbour bleeds into the edge
 * of the photo: white there drew a thin light line along the coverage. */
export const CLEARED_RGB = [19, 56, 75] as const;

const clear = (px: Uint8ClampedArray, i: number): void => {
  px[i] = CLEARED_RGB[0];
  px[i + 1] = CLEARED_RGB[1];
  px[i + 2] = CLEARED_RGB[2];
  px[i + 3] = 0;
};

const isWhite = (px: Uint8ClampedArray, i: number, min: number): boolean =>
  px[i] >= min && px[i + 1] >= min && px[i + 2] >= min;

/** The white pixels (by index) connected to the tile's edge, 4-neighbour
 * flood fill. */
function edgeWhite(px: Uint8ClampedArray, width: number, height: number): number[] {
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (p: number): void => {
    if (seen[p] || !isWhite(px, p * 4, WHITE_MIN)) return;
    seen[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  const found: number[] = [];
  while (stack.length > 0) {
    const p = stack.pop() as number;
    found.push(p);
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < (height - 1) * width) push(p + width);
  }
  return found;
}

/** Pure: make the white of an RGBA tile `width` pixels wide transparent, in
 * place: the white connected to the tile's edge, when it is at least
 * `MIN_SHARE` of the tile or runs `MIN_EDGE_SHARE` along its edge, and the
 * light fringe around it. White inside the
 * photo (a roof, a boat, a wave) stays. Returns how many were cleared. */
export function clearWhite(px: Uint8ClampedArray, width: number): number {
  const total = px.length / 4;
  const height = total / width;
  const white = edgeWhite(px, width, height);
  const onEdge = (p: number): boolean => {
    const x = p % width;
    return x === 0 || x === width - 1 || p < width || p >= (height - 1) * width;
  };
  const big =
    white.length >= total * MIN_SHARE ||
    white.filter(onEdge).length >= Math.max(width, height) * MIN_EDGE_SHARE;
  if (white.length === 0 || !big) return clearSeam(px, width, height);
  for (const p of white) clear(px, p * 4);
  let cleared = white.length;
  for (let pass = 0; pass < FRINGE_PASSES; pass++) {
    const next: number[] = [];
    for (let p = 0; p < total; p++) {
      const i = p * 4;
      if (px[i + 3] === 0 || !isWhite(px, i, FRINGE_MIN)) continue;
      const x = p % width;
      const y = (p - x) / width;
      const near =
        (x > 0 && px[i - 1] === 0) ||
        (x < width - 1 && px[i + 7] === 0) ||
        (y > 0 && px[i - width * 4 + 3] === 0) ||
        (y < height - 1 && px[i + width * 4 + 3] === 0);
      if (near) next.push(i);
    }
    for (const i of next) clear(px, i);
    cleared += next.length;
  }
  return cleared + clearSeam(px, width, height);
}

/** The JPEG fringe of a no-data block in the next tile: light pixels on
 * this tile's edge, fewer than `FRINGE_PASSES` deep, with photo behind them.
 * Cleared, they no longer draw a dotted light seam along the coverage; sand
 * or a roof running off the tile is light further in, and stays. */
function clearSeam(px: Uint8ClampedArray, width: number, height: number): number {
  if (width <= FRINGE_PASSES || height <= FRINGE_PASSES) return 0;
  let cleared = 0;
  const light = (p: number): boolean => px[p * 4 + 3] !== 0 && isWhite(px, p * 4, FRINGE_MIN);
  const check = (p: number, step: number): void => {
    let depth = 0;
    while (depth < FRINGE_PASSES && light(p + depth * step)) depth++;
    if (depth === 0 || depth === FRINGE_PASSES) return;
    for (let k = 0; k < depth; k++) clear(px, (p + k * step) * 4);
    cleared += depth;
  };
  for (let x = 0; x < width; x++) {
    check(x, width);
    check((height - 1) * width + x, -width);
  }
  for (let y = 0; y < height; y++) {
    check(y * width, 1);
    check(y * width + width - 1, -1);
  }
  return cleared;
}

/** Decode a tile and clear its no-data. Without OffscreenCanvas (old
 * browsers) the JPEG is handed on as it is: white blocks, but a photo. */
export async function withoutWhite(data: ArrayBuffer): Promise<ArrayBuffer | ImageBitmap> {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined")
    return data;
  const bitmap = await createImageBitmap(new Blob([data]));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return bitmap;
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  if (clearWhite(image.data, bitmap.width) === 0) return bitmap;
  bitmap.close();
  ctx.putImageData(image, 0, 0);
  return canvas.transferToImageBitmap();
}
