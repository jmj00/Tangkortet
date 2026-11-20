// Ported from Svampekortet (0024b43): OSM base + the Skærmkort WMS when a key is set.
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { LocateControl } from "./locatecontrol";

const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

// Roughly the centre of Denmark (Storebælt), so the opening view frames the
// whole country from Jutland to Bornholm.
const DENMARK_CENTER: [number, number] = [10.9, 55.9];
/** Jutland to Bornholm, Skagen to the border: the opening view frames this
 * inside the part of the map the sheet leaves uncovered (main.ts). */
export const DENMARK_BOUNDS: [[number, number], [number, number]] = [
  [8.0, 54.55],
  [15.2, 57.75],
];

const SDFI_TOKEN = import.meta.env.VITE_DATAFORDELER_API_KEY;

// GeoDanmark Skaermkort, CC BY 4.0. Must be shown to the user (map + an "Om data"
// screen). See docs/data-sources.md.
const SDFI_ATTRIBUTION =
  'Kort: <a href="https://www.geodanmark.dk" target="_blank" rel="noopener">GeoDanmark</a> ' +
  '(<a href="https://creativecommons.org/licenses/by/4.0/deed.da" target="_blank" rel="noopener">CC BY 4.0</a>), ' +
  '<a href="https://datafordeler.dk" target="_blank" rel="noopener">Datafordeler</a>';

/**
 * Klimadatastyrelsens "Skærmkort" via its Datafordeler WMS (the WMTS is
 * UTM32N-only). Same underlying map as before this moved off DAWA/legacy
 * Dataforsyningen (docs/data-sources.md) -- same layer name, same on-the-fly
 * EPSG:3857 reprojection, so MapLibre can use it as a raster source with the
 * {bbox-epsg-3857} token unchanged. If the token is missing the layer is never
 * added; if the tiles fail to decode (a rejected request answers with an XML
 * ServiceException at HTTP 200 -- e.g. an invalid/expired key), the layer is
 * removed on the first error so the map falls back cleanly to the OSM base
 * instead of flooding decode errors.
 *
 * Note: this WMS enforces the WMS 1.3.0 spelling of TRANSPARENT (uppercase
 * TRUE/FALSE) and rejects `transparent=false` outright, so the parameter is
 * omitted -- its default is FALSE, which is what an opaque basemap wants.
 */
function addSdfiBasemap(map: MapLibreMap): void {
  if (!SDFI_TOKEN) return;
  const url =
    "https://wms.datafordeler.dk/Dkskaermkort/topo_skaermkort/1.0.0/wms?service=WMS&version=1.3.0" +
    "&request=GetMap&layers=dtk_skaermkort&styles=&format=image/png" +
    `&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}&apikey=${SDFI_TOKEN}`;

  map.addSource("sdfi", {
    type: "raster",
    tiles: [url],
    tileSize: 256,
    attribution: SDFI_ATTRIBUTION,
  });
  map.addLayer({ id: "sdfi", type: "raster", source: "sdfi" });

  const onError = (e: { error?: Error; sourceId?: string }): void => {
    const decodeError = /could not be decoded/i.test(String(e?.error?.message ?? ""));
    if (e?.sourceId !== "sdfi" && !decodeError) return;
    if (!map.getLayer("sdfi")) return;
    console.warn("SDFI basemap unavailable — falling back to OpenStreetMap", e?.error);
    map.off("error", onError);
    map.removeLayer("sdfi");
    map.removeSource("sdfi");
  };
  map.on("error", onError);
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
  options: { onLocateAsk?: () => void } = {},
): Promise<MapBundle> {
  const maplibregl = await import("maplibre-gl");
  await import("maplibre-gl/dist/maplibre-gl.css");

  const map = new maplibregl.Map({
    container,
    style: OSM_STYLE,
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
  map.addControl(geolocate, "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));

  // Layers only need the style, not every tile: "style.load" fires as soon as
  // it is parsed, while "load" also waits for the first view's tiles (slow
  // network, or a flyTo started at startup). Whichever comes first.
  const loaded = new Promise<void>((resolve) => {
    let done = false;
    const ready = () => {
      if (done) return;
      done = true;
      addSdfiBasemap(map);
      resolve();
    };
    map.once("style.load", ready);
    map.once("load", ready);
  });

  return { map, geolocate, maplibregl, loaded };
}
