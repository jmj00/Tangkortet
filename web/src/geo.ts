// Small geodesy helpers. Coordinates are [lon, lat] (GeoJSON order) unless a
// name says otherwise.

const EARTH_RADIUS_M = 6371008.8;

export function distanceM(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** [minLon, minLat, maxLon, maxLat] of a circle, generous at Danish latitudes. */
export function bboxAround(
  center: [number, number],
  radiusM: number,
): [number, number, number, number] {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((center[1] * Math.PI) / 180));
  return [center[0] - dLon, center[1] - dLat, center[0] + dLon, center[1] + dLat];
}

/** Grid cell keys overlapping a bbox. Must match pipeline/geo.py `cell_key`. */
export function cellKeys(bbox: [number, number, number, number], cellDeg: number): string[] {
  const keys: string[] = [];
  for (let x = Math.floor(bbox[0] / cellDeg); x <= Math.floor(bbox[2] / cellDeg); x++) {
    for (let y = Math.floor(bbox[1] / cellDeg); y <= Math.floor(bbox[3] / cellDeg); y++) {
      keys.push(`${x}_${y}`);
    }
  }
  return keys;
}

export function formatDistance(m: number): string {
  if (m < 50) return "ved nålen";
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0).replace(".", ",")} km`;
}
