// Species photos: size variants and the small photo boxes of the species list,
// the lookalikes and the start screen's picker.
//
// iNaturalist's open-data bucket serves every photo in fixed size variants under
// the same path (square 75 px, small 240 px, medium 500 px, large 1024 px), so
// any one of them names the others. The manifest carries the `small` URL per
// species (pipeline/publish.py); the species document the `large` ones. From
// Svampekortet 624fb8b (web/src/thumb.ts), plus the hero's variants and the
// seaweed placeholder.

import "./thumb.css";

import { h } from "./dom";

const INAT_VARIANT = /^(https:\/\/[^?#]+\/photos\/\d+\/)(?:large|medium|small|square)(\.[a-z]+)$/i;

export interface PhotoSources {
  src: string;
  srcset?: string;
}

/** Thumbnail renditions: the square for 1x screens, the small one for dense
 * screens and bigger boxes, a few kB each. `medium` adds the 500 px one
 * (~200 kB) for boxes that are large on dense screens (the picker tiles). */
export function thumbSources(url: string, medium = false): PhotoSources {
  const match = INAT_VARIANT.exec(url);
  if (!match) return { src: url };
  const [, base, ext] = match;
  return {
    src: `${base}square${ext}`,
    srcset: `${base}square${ext} 75w, ${base}small${ext} 240w${medium ? `, ${base}medium${ext} 500w` : ""}`,
  };
}

/** Hero renditions: medium (500 px, ~200 kB) for phones, large for wide or
 * dense screens. */
export function heroSources(url: string): PhotoSources {
  const match = INAT_VARIANT.exec(url);
  if (!match) return { src: url };
  const [, base, ext] = match;
  return {
    src: `${base}medium${ext}`,
    srcset: `${base}medium${ext} 500w, ${base}large${ext} 1024w`,
  };
}

/** A line drawing of a seaweed frond (20x20, current colour). */
export const SEAWEED_PATHS =
  '<path d="M10 18c0-4-3-5.5-3-9s2-5 2-6.5M10 18c0-3 3-4 3-7.5S11 6 12.5 3.5M10 18c-.5-2-3.5-2.5-4.5-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>';

/** Hotlinked photos are requested with CORS (the bucket allows any origin), so
 * the service worker can keep them for offline use (public/sw.js). */
export function photoImg(
  sources: PhotoSources,
  sizes: string,
  loading: "lazy" | "eager" = "lazy",
): HTMLImageElement {
  // loading and crossOrigin before src, or the fetch starts without them
  const img = h("img", { alt: "", decoding: "async", draggable: "false", loading });
  img.crossOrigin = "anonymous";
  if (sources.srcset) {
    img.srcset = sources.srcset;
    img.sizes = sizes;
  }
  img.src = sources.src;
  return img;
}

/** A fixed-size photo box: the species' thumbnail over a placeholder in its
 * algae group's colour with a seaweed drawing. Without a photo, or when it
 * cannot be fetched (offline), the placeholder simply stays. The photo is
 * decorative: the species' name is always beside it. `sizes` is the box's
 * rendered width, for picking the rendition. */
export function thumbBox(
  className: string,
  group: string,
  url: string | null | undefined,
  sizes: string,
  medium = false,
): HTMLSpanElement {
  const box = h("span", {
    class: `sp-thumb ${className}`,
    "data-group": group,
    "aria-hidden": "true",
  });
  box.innerHTML = `<svg class="sp-thumb__icon" viewBox="0 0 20 20" focusable="false">${SEAWEED_PATHS}</svg>`;
  if (!url) return box;
  const img = photoImg(thumbSources(url, medium), sizes);
  img.addEventListener("load", () => img.classList.add("is-loaded"));
  img.addEventListener("error", () => img.remove());
  box.append(img);
  return box;
}
