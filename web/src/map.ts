// Ported from Svampekortet (0024b43), then reworked: with a key the basemap is
// the Skærmkort WMS (or the aerial photo) over a flat land/water background,
// and OpenStreetMap's tiles come in only as the fallback when Datafordeler
// fails for good; without a key OSM is the basemap. The Datafordeler layers
// load through a retrying protocol (tileretry.ts).
import type {
  IControl,
  LayerSpecification,
  Map as MapLibreMap,
  RasterLayerSpecification,
  RasterSourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import "./map.css";
import {
  BasemapControl,
  readBasemapMode,
  storeBasemapMode,
  type BasemapMode,
} from "./basemapcontrol";
import { repaintCoast } from "./coastmap";
import { prefersDark, restyleLayers, setPhotoBasemap } from "./layers";
import { LocateControl } from "./locatecontrol";
import { withoutWhite } from "./nodata";
import { emptyStats, fetchTile, TileHealth, type RetryStats, type TileResult } from "./tileretry";

type RasterPaint = NonNullable<RasterLayerSpecification["paint"]>;

/**
 * The basemap is a full-colour road map; under the finds, the risk markers
 * and the pin it has to step back. Light: desaturated and softened. Dark: the
 * same tiles inverted (brightness min above max) with their hues turned back
 * by 180 degrees, so land goes dark, labels light and water stays blue.
 * Adapted from Svampekortet 624fb8b (web/src/map.ts basemapPaint). Less grey
 * than there: this is a coastal map, and water against land must stay
 * obvious, so some of OSM's blue is kept in both themes.
 */
export function basemapPaint(dark: boolean, reducedMotion = false, muted = false): RasterPaint {
  const fade = reducedMotion ? 0 : 300;
  // Skærmkort's own muted variant (dtk_skaermkort_daempet, `muted`) is pale
  // already: in light mode it is only taken a touch off pure white. In dark
  // mode it gets the same inversion as OSM, which on it gives neutral land
  // and roads and keeps the water blue (the full-colour map went brown).
  if (muted && !dark)
    return {
      "raster-brightness-min": 0,
      "raster-brightness-max": 0.97,
      "raster-hue-rotate": 0,
      "raster-saturation": 0,
      "raster-contrast": 0,
      "raster-fade-duration": fade,
    };
  return dark
    ? {
        "raster-brightness-min": 0.86,
        "raster-brightness-max": 0.12,
        "raster-hue-rotate": 180,
        "raster-saturation": -0.3,
        "raster-contrast": -0.05,
        "raster-fade-duration": fade,
      }
    : {
        "raster-brightness-min": 0.05,
        "raster-brightness-max": 1,
        "raster-hue-rotate": 0,
        "raster-saturation": -0.45,
        "raster-contrast": -0.1,
        "raster-fade-duration": fade,
      };
}

const reducedMotion = (): boolean =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const currentBasemapPaint = (): RasterPaint => basemapPaint(prefersDark(), reducedMotion());

/** The aerial photo stays a photo: no desaturation or inversion. Dark mode
 * only takes the glare off, so the page around it doesn't flash. */
export function photoPaint(dark: boolean, reducedMotion = false): RasterPaint {
  return {
    "raster-brightness-min": 0,
    "raster-brightness-max": dark ? 0.8 : 1,
    "raster-saturation": dark ? -0.1 : 0,
    "raster-contrast": 0,
    "raster-hue-rotate": 0,
    "raster-fade-duration": reducedMotion ? 0 : 300,
  };
}

/** The layers that make up the basemap, bottom up: a flat background, OSM
 * (without a key, or after Datafordeler failed), Skærmkort and the photo. */
const BASEMAP_LAYERS = ["bg", "osm", "sdfi", "orto"] as const;

/** Sampled from the painted tiles (Skærmkort's dtk_skaermkort_daempet with
 * basemapPaint, and the photo's open sea with photoPaint), per theme. */
const BG = {
  land: "#f7f7f7",
  landDark: "#232323",
  photoWater: "#13384b",
  photoWaterDark: "#0f2c3b",
};

/**
 * The flat colour under the basemap tiles: what a tile that failed after its
 * retries shows (the map's land tone), and, under the photo, the sea beyond
 * the flown strips, whose white no-data is cleared (nodata.ts): a flat water
 * tone close to the photo's own sea.
 */
export function backgroundColor(dark: boolean, photo: boolean): string {
  if (photo) return dark ? BG.photoWaterDark : BG.photoWater;
  return dark ? BG.landDark : BG.land;
}

/** Whether the aerial photo is the basemap now (Basemap.apply). */
let photoShown = false;

function applyBasemapTheme(map: MapLibreMap): void {
  if (map.getLayer("bg"))
    map.setPaintProperty("bg", "background-color", backgroundColor(prefersDark(), photoShown));
  for (const id of ["osm", "sdfi", "orto"] as const) {
    if (!map.getLayer(id)) continue;
    const paint =
      id === "orto"
        ? photoPaint(prefersDark(), reducedMotion())
        : basemapPaint(prefersDark(), reducedMotion(), id === "sdfi");
    for (const [name, value] of Object.entries(paint)) {
      map.setPaintProperty(id, name, value);
    }
  }
}

const OSM_SOURCE: RasterSourceSpecification = {
  type: "raster",
  tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
  tileSize: 256,
  maxzoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};

/** The opening style: the flat background, plus OSM only when there is no
 * key. With a key, OSM is never requested unless Datafordeler fails for good
 * (Basemap.giveUp): no doubled traffic against the OSMF tile policy, and no
 * OSM credit for a map that doesn't show it. */
function baseStyle(withOsm: boolean): StyleSpecification {
  // the photo's sea tone from the start when the photo is the stored choice:
  // no flash of the land tone before Basemap.apply
  const background: LayerSpecification = {
    id: "bg",
    type: "background",
    paint: {
      "background-color": backgroundColor(
        prefersDark(),
        !!DATAFORDELER_KEY && readBasemapMode() === "photo",
      ),
    },
  };
  const osm: LayerSpecification = {
    id: "osm",
    type: "raster",
    source: "osm",
    paint: currentBasemapPaint(),
  };
  return {
    version: 8,
    sources: withOsm ? { osm: OSM_SOURCE } : {},
    layers: withOsm ? [background, osm] : [background],
  };
}

// Roughly the centre of Denmark (Storebælt), so the opening view frames the
// whole country from Jutland to Bornholm.
const DENMARK_CENTER: [number, number] = [10.9, 55.9];
/** Jutland to Bornholm, Skagen to the border: the opening view frames this
 * inside the part of the map the sheet leaves uncovered (main.ts). */
export const DENMARK_BOUNDS: [[number, number], [number, number]] = [
  [8.0, 54.55],
  [15.2, 57.75],
];

const DATAFORDELER_KEY = import.meta.env.VITE_DATAFORDELER_API_KEY;

const LINK = (href: string, text: string): string =>
  `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const CC_BY = LINK("https://creativecommons.org/licenses/by/4.0/deed.da", "CC BY 4.0");

// GeoDanmark data, CC BY 4.0 (Klimadatastyrelsen's terms for free data). Must
// be shown to the user (map + "Om Tangkortet"). See docs/data-sources.md.
const SDFI_ATTRIBUTION =
  `Kort: ${LINK("https://www.geodanmark.dk", "GeoDanmark")} (${CC_BY}), ` +
  LINK("https://datafordeler.dk", "Datafordeler");
// Kept as short as the map's credit, so the expanded credit on a phone stays
// on two lines; "Om Tangkortet" names Ortofoto forår and Klimadatastyrelsen.
const ORTO_ATTRIBUTION =
  `Luftfoto: ${LINK("https://www.geodanmark.dk", "GeoDanmark")} (${CC_BY}), ` +
  LINK("https://datafordeler.dk", "Datafordeler");

type WmsId = "sdfi" | "orto";

interface WmsSpec {
  /** Path on wms.datafordeler.dk. */
  path: string;
  layers: string;
  format: string;
  attribution: string;
  /** For console messages. */
  name: string;
  /** Paints "no data" white (the photo out at sea): cleared (nodata.ts). */
  whiteNoData?: boolean;
}

/**
 * Klimadatastyrelsen's WMS services on Datafordeler, both reprojected on the
 * fly to EPSG:3857 (confirmed in their GetCapabilities, 2026-11-20).
 *
 * - Skærmkort, muted ("dtk_skaermkort_daempet"): the topographic screen map
 *   in pale colours, quieter under the app's marks and cleaner in dark mode
 *   than the full-colour "dtk_skaermkort" ("dtk_skaermkort_graa" loses the
 *   water). Its WMTS is UTM32N-only, hence the WMS.
 * - Ortofoto forår ("orto_foraar"): the newest spring aerial photo, JPEG.
 *
 * These WMS enforce the WMS 1.3.0 spelling of TRANSPARENT and reject
 * `transparent=false`, so the parameter is left out (default FALSE: opaque).
 */
const WMS: Record<WmsId, WmsSpec> = {
  sdfi: {
    path: "Dkskaermkort/topo_skaermkort/1.0.0/wms",
    layers: "dtk_skaermkort_daempet",
    // opaque, so JPEG: ~10 kB a tile against ~75-105 kB as PNG
    format: "image/jpeg",
    attribution: SDFI_ATTRIBUTION,
    name: "Skærmkort",
  },
  orto: {
    path: "GeoDanmarkOrto/orto_foraar/1.0.0/WMS",
    layers: "orto_foraar",
    format: "image/jpeg",
    attribution: ORTO_ATTRIBUTION,
    name: "Ortofoto",
    whiteNoData: true,
  },
};

/** The real GetMap URL. The key goes last, so a log line cut short never
 * shows it; MapLibre itself only ever sees the `datafordeler://` URL. */
function wmsUrl(spec: WmsSpec, bbox: string): string {
  return (
    `https://wms.datafordeler.dk/${spec.path}?service=WMS&version=1.3.0&request=GetMap` +
    `&layers=${spec.layers}&styles=&format=${encodeURIComponent(spec.format)}` +
    `&crs=EPSG:3857&width=256&height=256&bbox=${bbox}&apikey=${DATAFORDELER_KEY}`
  );
}

/** Tiles are requested as `datafordeler://<id>/<bbox>` and fetched here with
 * retries (tileretry.ts): Datafordeler's random 401s, which carry no CORS
 * headers, would otherwise leave holes or (before this) drop the whole layer. */
const PROTOCOL = "datafordeler";

/** Per-layer counts for the session (window.__tileStats in dev). */
const tileStats: Record<WmsId, RetryStats> = { sdfi: emptyStats(), orto: emptyStats() };

interface Tracked {
  health: TileHealth;
  /** Given up already: later results don't count. */
  done: boolean;
  onGiveUp: (result: TileResult) => void;
  /** A tile of this layer loaded: the key works. */
  onLoaded: () => void;
}

/** The layers currently on the map, by id. */
const tracked = new Map<WmsId, Tracked>();

let protocolAdded = false;

/** Some Datafordeler tile has loaded this session (either layer). */
let keyWorks = false;

function addProtocolOnce(lib: typeof import("maplibre-gl")): void {
  if (protocolAdded) return;
  protocolAdded = true;
  lib.addProtocol(PROTOCOL, async (params, abortController) => {
    const match = /^[a-z]+:\/\/([a-z]+)\/(.+)$/.exec(params.url);
    const id = match?.[1] as WmsId | undefined;
    if (!match || !id || !(id in WMS)) throw new Error("unknown basemap tile");
    const spec = WMS[id];
    // In flight, so a stray ServiceException on the first tile back doesn't
    // condemn the layer while the rest of the view may still load (TileHealth).
    const started = tracked.get(id);
    started?.health.begin();
    let r: Awaited<ReturnType<typeof fetchTile>>;
    try {
      r = await fetchTile(wmsUrl(spec, match[2]), abortController.signal);
    } catch (error) {
      // AbortedError: the tile is no longer wanted, not counted
      started?.health.cancel();
      throw error;
    }
    const stats = tileStats[id];
    stats.tiles += 1;
    stats.attempts += r.attempts;
    if (r.attempts > 1) stats.retried += 1;
    if (r.attempts > 1 && r.result === "loaded") stats.recovered += 1;
    if (r.result !== "loaded") stats.failed += 1;
    if (r.result === "loaded") keyWorks = true;
    // Once any Datafordeler tile has loaded the key is good: a ServiceException
    // on the other layer's first tile is a stray, one failed tile (tileretry.ts
    // TileHealth), not a rejected key that would hide "Luftfoto".
    const result = r.result === "invalid" && keyWorks ? "failed" : r.result;
    const t = tracked.get(id);
    // the layer was replaced while this tile was on its way: settle the old one
    if (started && started !== t) started.health.cancel();
    if (t && r.result === "loaded") t.onLoaded();
    if (t && !t.done && t.health.record(result) === "give-up") {
      t.done = true;
      t.onGiveUp(result);
    }
    if (r.data) return { data: spec.whiteNoData ? await withoutWhite(r.data) : r.data };
    // no URL in the message: it carries the key
    throw new Error(`${spec.name}: tile not available after ${r.attempts} attempts`);
  });
}

/**
 * The Datafordeler basemap: Skærmkort, or the aerial photo when the user
 * picks it (BasemapControl, remembered per device), over a flat background in
 * the theme's land or water tone, so a tile that fails after its retries
 * leaves a quiet gap, not a hole. A layer is dropped only when the service
 * clearly doesn't work: ServiceExceptions before any tile loaded (an invalid
 * key: two, or one with no other tile on its way), or no tile at all after
 * several failed ones. Skærmkort dropped brings in OpenStreetMap; the photo
 * dropped goes back to the map, and the photo button, hidden for a rejected
 * key, comes back once any tile loads.
 */
class Basemap {
  readonly control: BasemapControl;
  private mode: BasemapMode;

  constructor(
    private readonly map: MapLibreMap,
    private readonly lib: typeof import("maplibre-gl"),
    private readonly notice?: (text: string) => void,
  ) {
    this.mode = readBasemapMode();
    this.control = new BasemapControl({
      photo: this.mode === "photo",
      onToggle: (photo) => {
        this.mode = photo ? "photo" : "map";
        storeBasemapMode(this.mode);
        this.apply();
      },
    });
  }

  /** Once the style is ready. */
  start(): void {
    addProtocolOnce(this.lib);
    // A tile that fails after its retries is expected now and then (the
    // background shows through): keep it out of the console. With a listener MapLibre
    // no longer logs errors itself, so everything else is logged here.
    this.map.on("error", (e: { error?: unknown; sourceId?: string }) => {
      if (e.sourceId === "sdfi" || e.sourceId === "orto") return;
      console.error(e.error ?? e);
    });
    this.add("sdfi");
    this.apply();
  }

  private add(id: WmsId): void {
    tracked.set(id, {
      health: new TileHealth(),
      done: false,
      onGiveUp: (result) => this.giveUp(id, result),
      // the photo button back, should it have been hidden for a key that
      // turned out to work after all
      onLoaded: () => this.control.setAvailable(true),
    });
    this.map.addSource(id, {
      type: "raster",
      tiles: [`${PROTOCOL}://${id}/{bbox-epsg-3857}`],
      tileSize: 256,
      attribution: WMS[id].attribution,
    });
    // above the other basemap layers, under everything the app draws
    const before = this.map
      .getStyle()
      .layers.find((l) => !(BASEMAP_LAYERS as readonly string[]).includes(l.id))?.id;
    this.map.addLayer(
      {
        id,
        type: "raster",
        source: id,
        paint: id === "orto" ? photoPaint(prefersDark(), reducedMotion()) : currentBasemapPaint(),
      },
      before,
    );
  }

  private remove(id: WmsId): void {
    tracked.delete(id);
    if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (this.map.getSource(id)) this.map.removeSource(id);
  }

  /** OpenStreetMap as the basemap, right above the background: only once
   * Skærmkort has failed for good. */
  private addOsm(): void {
    if (this.map.getLayer("osm")) return;
    this.map.addSource("osm", OSM_SOURCE);
    this.map.addLayer(
      { id: "osm", type: "raster", source: "osm", paint: currentBasemapPaint() },
      this.map.getStyle().layers.find((l) => l.id !== "bg")?.id,
    );
  }

  private giveUp(id: WmsId, result: TileResult): void {
    const why = result === "invalid" ? "the key was rejected" : "no tile loaded";
    const instead = id === "orto" ? "showing the map" : "falling back to OpenStreetMap";
    console.warn(`${WMS[id].name} unavailable (${why}): ${instead}`);
    this.remove(id);
    // A rejected key fails the photo too: no button that cannot work.
    if (result === "invalid") this.control.setAvailable(false);
    if (id === "sdfi") {
      this.addOsm();
      this.apply();
      return;
    }
    // Back to the map, and remembered, so the next visit doesn't fail again;
    // pressing "Luftfoto" again is the retry.
    this.mode = "map";
    storeBasemapMode("map");
    this.apply();
    this.notice?.(
      "Luftfotoet kunne ikke hentes lige nu. Kortet vises i stedet – prøv igen senere.",
    );
  }

  private apply(): void {
    const photo = this.mode === "photo";
    if (photo && !this.map.getLayer("orto")) this.add("orto");
    if (this.map.getLayer("orto"))
      this.map.setLayoutProperty("orto", "visibility", photo ? "visible" : "none");
    // Hidden, Skærmkort (or OSM after a fallback) fetches nothing, and the
    // photo's cleared no-data shows the flat water background.
    for (const id of ["sdfi", "osm"])
      if (this.map.getLayer(id))
        this.map.setLayoutProperty(id, "visibility", photo ? "none" : "visible");
    this.control.setPhoto(photo);
    photoShown = photo;
    // the pin's halo on the photo (map.css)
    this.map.getContainer().dataset.basemap = photo ? "photo" : "map";
    applyBasemapTheme(this.map);
    setPhotoBasemap(this.map, photo);
    repaintCoast(this.map);
  }
}

/** "Om Tangkortet og data" as a map button. On the phone it stands in for the
 * panel's footer link, which the sheet has no room for (shell.css hides it in
 * the sidebar layout, where the footer shows). */
function aboutControl(onClick: () => void): IControl {
  let container: HTMLElement | null = null;
  return {
    onAdd() {
      container = document.createElement("div");
      container.className = "maplibregl-ctrl maplibregl-ctrl-group about-ctrl";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "about-ctrl__button";
      button.title = "Om Tangkortet og data";
      button.setAttribute("aria-label", "Om Tangkortet og data");
      button.textContent = "?";
      button.addEventListener("click", onClick);
      container.append(button);
      return container;
    },
    onRemove() {
      container?.remove();
    },
  };
}

export interface MapBundle {
  map: MapLibreMap;
  geolocate: LocateControl;
  /** The loaded module namespace, so callers can `new maplibregl.Marker(...)`
   *  without a second static import of the library. */
  maplibregl: typeof import("maplibre-gl");
  /** Resolves once the style is ready for layers. Use this, not
   * `map.isStyleLoaded()`: that is also false while tiles are loading (e.g.
   * during a flyTo), and waiting for "load" after it has fired never returns. */
  loaded: Promise<void>;
}

/**
 * Load MapLibre (its own ~800 kB chunk) and build the map. Async so the library
 * stays out of the entry bundle — the species panel renders from the payload
 * while this resolves.
 */
export async function createMap(
  container: string,
  options: {
    onLocateAsk?: () => void;
    onAbout?: () => void;
    /** A short message over the map (main.ts showMapStatus). */
    onNotice?: (text: string) => void;
  } = {},
): Promise<MapBundle> {
  const maplibregl = await import("maplibre-gl");
  await import("maplibre-gl/dist/maplibre-gl.css");

  const map = new maplibregl.Map({
    container,
    style: baseStyle(!DATAFORDELER_KEY),
    center: DENMARK_CENTER,
    zoom: 6.4,
    attributionControl: { compact: true },
  });

  // One position per press, never a watch, and no camera move of its own
  // (locatecontrol.ts, locate.ts): the app frames an answer it accepts.
  const geolocate = new LocateControl({
    positionOptions: { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    makeMarker: (element) => new maplibregl.Marker({ element }),
    onAsk: options.onLocateAsk,
  });

  map.addControl(new maplibregl.NavigationControl(), "top-right");
  if (options.onAbout) map.addControl(aboutControl(options.onAbout), "top-right");
  // Map or aerial photo, only with a key (both come from Datafordeler).
  const basemap = DATAFORDELER_KEY ? new Basemap(map, maplibregl, options.onNotice) : null;
  if (basemap) map.addControl(basemap.control, "top-right");
  map.addControl(geolocate, "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));

  // Phones, upright or on their side: the opened credit (two lines with
  // Skærmkort or the photo) covers the map key and the locate button.
  // MapLibre folds it on the first drag; a phone user may only tap, so fold
  // it after a few seconds too. It stays one tap away behind the (i).
  const phone = globalThis.matchMedia?.(
    "(max-width: 559.98px), (max-width: 719.98px) and (min-height: 520.02px), (max-height: 520px)",
  );
  map.once("load", () => {
    window.setTimeout(() => {
      if (!phone?.matches) return;
      map
        .getContainer()
        .querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")
        ?.classList.remove("maplibregl-compact-show");
    }, 5000);
  });

  // Layers only need the style, not every tile: "style.load" fires as soon as
  // it is parsed, while "load" also waits for the first view's tiles (slow
  // network, or a flyTo started at startup). Whichever comes first.
  const loaded = new Promise<void>((resolve) => {
    let done = false;
    const ready = () => {
      if (done) return;
      done = true;
      basemap?.start();
      resolve();
    };
    map.once("style.load", ready);
    map.once("load", ready);
  });

  // The page's theme follows the OS setting; the map follows it without a
  // reload (from Svampekortet 624fb8b, web/src/map.ts).
  globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    void loaded.then(() => {
      applyBasemapTheme(map);
      restyleLayers(map);
    });
  });

  // Dev server only (dropped from production builds): lets the screenshot
  // harness drive the map (from Svampekortet 624fb8b, web/src/map.ts).
  if (import.meta.env.DEV) {
    const w = window as unknown as { __map?: MapLibreMap; __tileStats?: unknown };
    w.__map = map;
    w.__tileStats = tileStats;
  }

  return { map, geolocate, maplibregl, loaded };
}
