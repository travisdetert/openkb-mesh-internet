// Web Mercator projection primitives shared by every map-bearing panel
// (Position Map, Coverage heatmap, Mesh Routing, RSSI vs Distance). These
// were previously private to PositionMapPanel; extracting them lets other
// panels reuse the exact same tile grid + projection without duplicating it.

/** SVG viewBox the map renders into. All projection output is in these units. */
export const SVG_W = 1600;
export const SVG_H = 1000;
/** Web Mercator tile edge in pixels (standard slippy-map tiles). */
export const TILE_SIZE = 256;

/** The camera: a Mercator pixel bounding box at a chosen zoom, plus the
 *  lat/lon center and spans used by overlays (grid, scale bar). */
export interface View {
  centerLat: number;
  centerLon: number;
  spanLat: number;
  spanLon: number;
  spanKm: number;
  /** Web Mercator zoom level (0 = whole world, 18 = street level) */
  zoom: number;
  /** Mercator pixel bounds at the chosen zoom */
  minMx: number;
  maxMx: number;
  minMy: number;
  maxMy: number;
}

export function clampZoom(z: number): number {
  return Math.max(1, Math.min(18, Math.round(z)));
}

export function lonToMercX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z) * TILE_SIZE;
}

export function latToMercY(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  return (
    (0.5 - Math.log((1 + Math.sin(latRad)) / (1 - Math.sin(latRad))) / (4 * Math.PI)) *
    Math.pow(2, z) *
    TILE_SIZE
  );
}

export function mercYToLat(my: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * my) / (TILE_SIZE * Math.pow(2, z));
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function mercXToLon(mx: number, z: number): number {
  return (mx / (TILE_SIZE * Math.pow(2, z))) * 360 - 180;
}

/** Project a lat/lon to SVG pixel coords within the current view. */
export function projectMeters(lat: number, lon: number, view: View): { x: number; y: number } {
  const mx = lonToMercX(lon, view.zoom);
  const my = latToMercY(lat, view.zoom);
  return {
    x: ((mx - view.minMx) / (view.maxMx - view.minMx)) * SVG_W,
    y: ((my - view.minMy) / (view.maxMy - view.minMy)) * SVG_H,
  };
}

/** Choose a "nice" grid/scale-bar step (km) for a given viewport span. */
export function pickGridStep(spanKm: number): number {
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500];
  return candidates.find((c) => c * 8 > spanKm) ?? 1000;
}
