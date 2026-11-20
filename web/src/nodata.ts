// The aerial photo's "no data" is white: beyond the flown strips, out at sea,
// GeoDanmark's orthophoto WMS paints solid white blocks. As a transparent PNG
// it would be ~10x the bytes of the JPEG (measured 2026-11-20: 722 kB vs 60 kB
// for five tiles), so the photo comes as JPEG and the white is cleared here,
// letting the OSM base show through instead of a white rectangle.

/** A channel this bright counts as white (JPEG leaves 255 at 252-255). */
export const WHITE_MIN = 252;
/** Only a tile with at least this share of white is touched: no-data comes in
 * large blocks, while a white roof or a boat is a few pixels. */
export const MIN_SHARE = 0.02;

/** JPEG rings at the block's edge: a pixel this light next to a cleared one
 * goes too, for `FRINGE_PASSES` pixels inwards. */
export const FRINGE_MIN = 200;
export const FRINGE_PASSES = 2;

const isWhite = (px: Uint8ClampedArray, i: number, min: number): boolean =>
  px[i] >= min && px[i + 1] >= min && px[i + 2] >= min;

/** Pure: make the white pixels of an RGBA tile `width` pixels wide
 * transparent, in place, when they are at least `MIN_SHARE` of it, and the
 * light fringe around them. Returns how many were cleared. */
export function clearWhite(px: Uint8ClampedArray, width: number): number {
  const total = px.length / 4;
  let white = 0;
  for (let i = 0; i < px.length; i += 4) if (isWhite(px, i, WHITE_MIN)) white++;
  if (white === 0 || white < total * MIN_SHARE) return 0;
  for (let i = 0; i < px.length; i += 4) if (isWhite(px, i, WHITE_MIN)) px[i + 3] = 0;
  let cleared = white;
  const height = total / width;
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
    for (const i of next) px[i + 3] = 0;
    cleared += next.length;
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
