// Camera helpers: how much of the map the app's own UI covers, and moving the
// camera without tripping MapLibre's duration-0 bug. Ported from Svampekortet
// (624fb8b, web/src/camera.ts); flyCamera and popupAnchor are Tangkortet's.

import type maplibregl from "maplibre-gl";

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const prefersReducedMotion = (): boolean =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** A custom property counts only when it is a plain pixel length: the shell's
 * stylesheet defaults are `calc()`/`dvh`/`var()` expressions, which a custom
 * property hands back unresolved. */
export function px(value: string): number | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)px\s*$/.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * The covered pixels on each side of the map, from what the shell publishes.
 *
 * `mapPadding` is the padding the shell gave MapLibre (the search field on
 * top, the sheet at its half height below). `liveBottom` is the shell's
 * `--map-inset-bottom`, which follows the sheet as it is dragged, so a sheet
 * folded to its peek frees the map it no longer covers.
 */
export function insetsFrom(mapPadding: Padding, liveBottom: string): Padding {
  return {
    top: mapPadding.top,
    right: mapPadding.right,
    bottom: px(liveBottom) ?? mapPadding.bottom,
    left: mapPadding.left,
  };
}

/** What `pad` asks for beyond `base`, side by side. MapLibre adds the padding
 * passed to a camera call to the map's own padding, so camera calls must pass
 * only the difference or the covered area is counted twice. */
export function beyond(pad: Padding, base: Padding): Padding {
  return {
    top: Math.max(0, pad.top - base.top),
    right: Math.max(0, pad.right - base.right),
    bottom: Math.max(0, pad.bottom - base.bottom),
    left: Math.max(0, pad.left - base.left),
  };
}

/**
 * THE one place that decides which part of the map is covered by the app's
 * own UI, in pixels from each edge of the map container. Every camera move
 * and everything placed over the map asks here. On the desktop layout the
 * map is a column of its own beside the sidebar and nothing covers it.
 */
export function mapInsets(map: maplibregl.Map, options: { controls?: boolean } = {}): Padding {
  const live = getComputedStyle(map.getContainer()).getPropertyValue("--map-inset-bottom");
  const pad = insetsFrom(map.getPadding(), live);
  if (options.controls) pad.right = Math.max(pad.right, controlColumn(map));
  return pad;
}

/** Width of the column of map buttons along the right edge (zoom, locate,
 * "?"), with a little room; 0 when none is shown. Popups and frames that must
 * stay clear of the buttons ask for it with `mapInsets(map, { controls: true })`. */
export function controlColumn(map: maplibregl.Map): number {
  const container = map.getContainer();
  const column = container.querySelector(".maplibregl-ctrl-top-right");
  if (!column) return 0;
  const box = column.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return 0;
  return Math.max(0, Math.round(container.getBoundingClientRect().right - box.left + 4));
}

/** Pure: a box around a circle of `radiusM` metres at `center` ([lng, lat]),
 * as [[west, south], [east, north]]. */
export function ringBounds(
  center: [number, number],
  radiusM: number,
): [[number, number], [number, number]] {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((center[1] * Math.PI) / 180));
  return [
    [center[0] - dLng, center[1] - dLat],
    [center[0] + dLng, center[1] + dLat],
  ];
}

/** Pure: is screen point (x, y) inside the uncovered part of a w×h map? */
export function insideVisible(x: number, y: number, w: number, h: number, pad: Padding): boolean {
  return x >= pad.left && x <= w - pad.right && y >= pad.top && y <= h - pad.bottom;
}

export function visibleTest(
  map: maplibregl.Map,
  pad: Padding = mapInsets(map),
): (point: [number, number]) => boolean {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  return (point) => {
    const { x, y } = map.project(point);
    return insideVisible(x, y, w, h, pad);
  };
}

/** The coordinate at the middle of the uncovered part of the map. */
export function visibleCenter(
  map: maplibregl.Map,
  pad: Padding = mapInsets(map),
): [number, number] {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const { lng, lat } = map.unproject([
    (pad.left + w - pad.right) / 2,
    (pad.top + h - pad.bottom) / 2,
  ]);
  return [lng, lat];
}

/** A MapLibre popup anchor: the side of the popup that touches the point. */
export type PopupAnchor =
  "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * Pure: where a popup at screen point (x, y) of a w×h map should open so it
 * stays in the uncovered map: below the point when there is room above the
 * sheet for it, otherwise above; and near a side edge (or the button column)
 * towards the middle, as MapLibre's own edge avoidance would, which a fixed
 * anchor switches off. `size` is a generous estimate of the popup.
 */
export function popupAnchor(
  x: number,
  y: number,
  w: number,
  h: number,
  pad: Padding,
  size: { width: number; height: number } = { width: 240, height: 90 },
): PopupAnchor {
  const roomBelow = h - pad.bottom - y;
  const roomAbove = y - pad.top;
  const vertical = roomBelow >= size.height || roomBelow >= roomAbove ? "top" : "bottom";
  const half = size.width / 2;
  if (x - pad.left < half) return `${vertical}-left`;
  if (w - pad.right - x < half) return `${vertical}-right`;
  return vertical;
}

/**
 * Fit the camera to `bounds`, keeping it clear of the floating UI.
 * `fitBounds`/`flyTo` with duration 0 NaNs the transform, so under
 * `prefers-reduced-motion` (or `instant`) the camera is computed and jumped
 * to instead.
 */
export function fitCamera(
  map: maplibregl.Map,
  bounds: [[number, number], [number, number]],
  options: { maxZoom?: number; margin?: number; padding?: Padding; instant?: boolean } = {},
): Promise<void> {
  const pad = options.padding ?? mapInsets(map);
  // Breathing room around the bounds, shrunk when the free area is small so
  // the margin never eats the space it is meant to frame.
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const free = Math.min(w - pad.left - pad.right, h - pad.top - pad.bottom);
  const margin = Math.max(8, Math.min(options.margin ?? 64, free / 6));
  const extra = beyond(pad, map.getPadding()); // MapLibre adds its own padding
  const opts = {
    padding: {
      top: extra.top + margin,
      right: extra.right + margin,
      bottom: extra.bottom + margin,
      left: extra.left + margin,
    },
    // Only when set: an explicit `maxZoom: undefined` overrides MapLibre's own
    // default and the camera comes out NaN.
    ...(options.maxZoom === undefined ? {} : { maxZoom: options.maxZoom }),
  };
  if (options.instant || prefersReducedMotion()) {
    const camera = map.cameraForBounds(bounds, opts);
    if (camera) map.jumpTo(camera);
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    map.once("moveend", () => resolve());
    map.fitBounds(bounds, { ...opts, duration: 600 });
  });
}

/**
 * Pure: the screen offset (from the padded centre) that puts a point in the
 * middle of the uncovered map. MapLibre's own padding already accounts for
 * the sheet at its half snap; a sheet folded lower leaves more room below.
 */
export function centreOffset(pad: Padding, base: Padding): [number, number] {
  const extra = beyond(pad, base);
  // padding beyond the map's own shifts the centre by half of it, away from that side
  return [(extra.left - extra.right) / 2, (extra.top - extra.bottom) / 2];
}

/**
 * Fly to `center` so it lands in the middle of the uncovered map. Resolves
 * when the camera has landed. Under reduced motion, jumps (flyTo with
 * duration 0 NaNs the transform; Svampekortet lesson).
 */
export function flyCamera(
  map: maplibregl.Map,
  center: [number, number],
  zoom: number,
): Promise<void> {
  const offset = centreOffset(mapInsets(map), map.getPadding());
  if (prefersReducedMotion()) {
    map.jumpTo({ center, zoom });
    if (offset[0] !== 0 || offset[1] !== 0) {
      const middle = map.project(map.getCenter());
      map.jumpTo({ center: map.unproject([middle.x - offset[0], middle.y - offset[1]]) });
    }
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    map.once("moveend", () => resolve());
    map.flyTo({ center, zoom, offset });
  });
}
