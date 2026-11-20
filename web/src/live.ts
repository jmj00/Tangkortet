// Questions answered live against the authorities' map servers when a pin is
// set, instead of shipping polygons (docs/data-sources.md, ADR-0002):
//
// - Natura 2000 (habitat, bird) and fredninger: Miljøportalen WFS;
// - coastal water body and its ecological / chemical status: MiljøGIS WFS;
// - mapped soil contamination V1/V2 within 1 km: DKJord via Vejdirektoratet's
//   ArcGIS mirror, which withholds geometry but answers distance queries.
//
// All three allow cross-origin requests. Each query fails on its own; the UI
// says so instead of implying "nothing found".

import { wgs84ToUtm32n } from "./proj";

const MILJOEPORTAL = "https://arealeditering-dist-geo.miljoeportal.dk/geoserver/ows";
const MILJOEGIS = "https://wfs2-miljoegis.mim.dk/vp3_2endelig2025/ows";
const VD_JORD = "https://kort.vd.dk/server/rest/services/Grunddata/Jordforurening/MapServer";
const TIMEOUT_MS = 20_000;

/** Pins on the beach should still find the protected area / water body. */
const NEAR_M = { protection: 100, water: 1000, soil: 1000, stream: 200 } as const;

export type LiveResult<T> = { ok: true; items: T[] } | { ok: false };

export interface ProtectedArea {
  kind: "habitat" | "fugle" | "fredning";
  name: string;
  detail?: string;
  link?: string;
}

export interface WaterBody {
  name: string;
  ecological: string | null;
  chemical: string | null;
  link: string | null;
}

export interface SoilSite {
  level: "V1" | "V2";
  locality: string;
  address: string | null;
}

/** `signal` plus a timeout. Built by hand: AbortSignal.any is too new for
 * older iPhones (Safari < 17.4). */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), ms);
  const stop = () => {
    clearTimeout(timer);
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  return controller.signal;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal: withTimeout(signal, TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function wfsUrl(base: string, layer: string, props: string[], cql: string): string {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: layer,
    outputFormat: "application/json",
    propertyName: props.join(","),
    CQL_FILTER: cql,
  });
  return `${base}?${params}`;
}

const dwithin = (geom: string, [x, y]: [number, number], m: number) =>
  `DWITHIN(${geom},POINT(${x.toFixed(1)} ${y.toFixed(1)}),${m},meters)`;

type Props = Record<string, unknown>;

function featureProps(json: unknown): Props[] {
  const features = (json as { features?: { properties?: Props }[] })?.features ?? [];
  return features.map((f) => f.properties ?? {});
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() && v !== "None" ? v.trim() : null;

export function parseProtected(kind: ProtectedArea["kind"], json: unknown): ProtectedArea[] {
  return featureProps(json).map((p) =>
    kind === "fredning"
      ? {
          kind,
          name: text(p.Fred_navn) ?? "Fredning",
          detail: text(p.Fred_tnavn) ?? undefined,
          link: text(p.Link) ?? undefined,
        }
      : { kind, name: text(p.Objektnavn) ?? "Natura 2000-område" },
  );
}

export function parseWaterBodies(json: unknown): WaterBody[] {
  return featureProps(json).map((p) => ({
    name: text(p.ov_navn) ?? "Kystvand",
    ecological: text(p.til_oko_sm),
    chemical: text(p.ov_til_kem),
    link: text(p.mgl_opf),
  }));
}

export interface Streams {
  /** Named water-plan watercourses (MiljøGIS), each once. */
  names: string[];
  /** 1 when only unnamed protected watercourses (Miljøportalen) were found, else 0.
   * Those come as segments that often overlap the named ones, so they are never
   * counted on top of a named watercourse. */
  unnamed: number;
}

export function parseStreams(named: unknown, small: unknown): Streams {
  const names = [
    ...new Set(featureProps(named).map((p) => text(p.ov_navn) ?? "Unavngivet vandløb")),
  ];
  const unnamed = names.length === 0 && featureProps(small).length > 0 ? 1 : 0;
  return { names, unnamed };
}

export function parseSoil(level: SoilSite["level"], json: unknown): SoilSite[] {
  const features =
    (json as { features?: { attributes?: Props }[] })?.features?.map((f) => f.attributes ?? {}) ??
    [];
  const seen = new Set<string>();
  const out: SoilSite[] = [];
  for (const a of features) {
    const locality = text(a.lokalitetsnr);
    if (!locality || seen.has(locality)) continue; // one row per cadastral parcel upstream
    seen.add(locality);
    out.push({ level, locality, address: text(a.lokalitetetsadresse) });
  }
  return out;
}

async function settle<T>(work: Promise<T[]>): Promise<LiveResult<T>> {
  try {
    return { ok: true, items: await work };
  } catch (err) {
    if ((err as Error).name !== "AbortError") console.warn("live query failed", err);
    return { ok: false };
  }
}

export function queryProtected(
  pin: [number, number],
  signal?: AbortSignal,
): Promise<LiveResult<ProtectedArea>> {
  const xy = wgs84ToUtm32n(...pin);
  const cql = dwithin("Shape", xy, NEAR_M.protection);
  const layers: [ProtectedArea["kind"], string, string[]][] = [
    ["habitat", "dai:habitat_omr", ["Objektnavn"]],
    ["fugle", "dai:fugle_bes_omr", ["Objektnavn"]],
    ["fredning", "dai:fredede_omr", ["Fred_navn", "Fred_tnavn", "Link"]],
  ];
  return settle(
    Promise.all(
      layers.map(([kind, layer, props]) =>
        getJson(wfsUrl(MILJOEPORTAL, layer, props, cql), signal).then((j) =>
          parseProtected(kind, j),
        ),
      ),
    ).then((lists) => lists.flat()),
  );
}

// Watercourses within STREAM_RADIUS_M: at the coast that means a stream mouth
// (expert, round 2; Fødevarestyrelsen also advises avoiding "åer").

/** Named water-plan watercourses within STREAM_RADIUS_M (MiljøGIS, fast).
 * null = the query failed. */
export async function queryNamedStreams(
  pin: [number, number],
  signal?: AbortSignal,
): Promise<unknown | null> {
  const xy = wgs84ToUtm32n(...pin);
  try {
    return await getJson(
      wfsUrl(
        MILJOEGIS,
        "vp3_2endelig2025:vp3_2e2025_vandloeb_samlet",
        ["ov_navn"],
        dwithin("wkb_geometry", xy, NEAR_M.stream),
      ),
      signal,
    );
  } catch (err) {
    if ((err as Error).name !== "AbortError") console.warn("named stream query failed", err);
    return null;
  }
}

/** Small protected watercourses within STREAM_RADIUS_M (Miljøportalen). This
 * server often takes 3-12 s, so the traffic light does not wait for it: it is
 * added when it arrives (riskpanel.ts). null = the query failed. */
export async function querySmallStreams(
  pin: [number, number],
  signal?: AbortSignal,
): Promise<unknown | null> {
  const xy = wgs84ToUtm32n(...pin);
  try {
    return await getJson(
      wfsUrl(MILJOEPORTAL, "dai:bes_vandloeb", ["Temanavn"], dwithin("Shape", xy, NEAR_M.stream)),
      signal,
    );
  } catch (err) {
    if ((err as Error).name !== "AbortError") console.warn("small stream query failed", err);
    return null;
  }
}

export function queryWaterBodies(
  pin: [number, number],
  signal?: AbortSignal,
): Promise<LiveResult<WaterBody>> {
  const xy = wgs84ToUtm32n(...pin);
  const url = wfsUrl(
    MILJOEGIS,
    "vp3_2endelig2025:vp3_2e2025_marin_samlet",
    ["ov_navn", "til_oko_sm", "ov_til_kem", "mgl_opf"],
    dwithin("wkb_geometry", xy, NEAR_M.water),
  );
  return settle(getJson(url, signal).then(parseWaterBodies));
}

export function querySoil(
  pin: [number, number],
  signal?: AbortSignal,
): Promise<LiveResult<SoilSite>> {
  const [x, y] = wgs84ToUtm32n(...pin);
  const url = (layerId: number) =>
    `${VD_JORD}/${layerId}/query?` +
    new URLSearchParams({
      geometry: JSON.stringify({ x, y }),
      geometryType: "esriGeometryPoint",
      inSR: "25832",
      distance: String(NEAR_M.soil),
      units: "esriSRUnit_Meter",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "lokalitetsnr,lokalitetetsadresse",
      returnGeometry: "false",
      returnDistinctValues: "true",
      f: "json",
    });
  return settle(
    Promise.all([
      getJson(url(6), signal).then((j) => parseSoil("V2", j)),
      getJson(url(5), signal).then((j) => parseSoil("V1", j)),
    ]).then((lists) => lists.flat()),
  );
}

export const SOIL_RADIUS_M = NEAR_M.soil;
export const STREAM_RADIUS_M = NEAR_M.stream;
