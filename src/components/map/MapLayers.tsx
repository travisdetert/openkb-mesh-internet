// Reusable SVG map layers: the basemap tile grid and the lat/lon graticule
// + scale bar. Both are pure functions of a `View` (see projection.ts), so
// any panel can drop them into its own <svg viewBox="0 0 1600 1000"> and get
// the same basemap PositionMapPanel renders.
import React from 'react';
import {
  type View,
  SVG_W,
  SVG_H,
  TILE_SIZE,
  projectMeters,
  pickGridStep,
} from './projection';

export type BasemapStyle = 'dark' | 'voyager' | 'light' | 'satellite';

/**
 * Build the tile URL for a given (style, z, x, y). CARTO basemaps use
 * subdomain rotation (a–d); Esri's World Imagery does not (single host).
 * All four basemaps are free to use with attribution, no API key.
 */
export function tileUrl(style: BasemapStyle, z: number, x: number, y: number, subdomain: string): string {
  switch (style) {
    case 'satellite':
      return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
    case 'dark':
      return `https://${subdomain}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
    case 'voyager':
      return `https://${subdomain}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;
    case 'light':
      return `https://${subdomain}.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`;
  }
}

export function MapTiles({ view, style }: { view: View; style: BasemapStyle }) {
  // Free, no-API-key basemaps (CARTO + Esri). Attribution lives in the
  // page-sub. Subdomain rotation parallelises tile fetches across HTTP/2
  // connections (CARTO accepts a-d; Esri is single-host but harmless).
  const subdomains = ['a', 'b', 'c', 'd'];

  const tileXMin = Math.floor(view.minMx / TILE_SIZE);
  const tileXMax = Math.floor(view.maxMx / TILE_SIZE);
  const tileYMin = Math.floor(view.minMy / TILE_SIZE);
  const tileYMax = Math.floor(view.maxMy / TILE_SIZE);
  const worldTiles = Math.pow(2, view.zoom);

  const tiles: React.ReactNode[] = [];
  for (let tx = tileXMin; tx <= tileXMax; tx++) {
    for (let ty = tileYMin; ty <= tileYMax; ty++) {
      if (ty < 0 || ty >= worldTiles) continue;
      const wrappedTx = ((tx % worldTiles) + worldTiles) % worldTiles;
      const sub = subdomains[(tx + ty) % subdomains.length];
      const url = tileUrl(style, view.zoom, wrappedTx, ty, sub);
      const tileMx = tx * TILE_SIZE;
      const tileMy = ty * TILE_SIZE;
      const x = ((tileMx - view.minMx) / (view.maxMx - view.minMx)) * SVG_W;
      const y = ((tileMy - view.minMy) / (view.maxMy - view.minMy)) * SVG_H;
      const w = (TILE_SIZE / (view.maxMx - view.minMx)) * SVG_W;
      const h = (TILE_SIZE / (view.maxMy - view.minMy)) * SVG_H;
      tiles.push(
        <image
          key={`${tx},${ty}`}
          href={url}
          x={x}
          y={y}
          width={w + 0.5}  /* +0.5 hides hairline gaps from sub-pixel rounding */
          height={h + 0.5}
          preserveAspectRatio="none"
        />
      );
    }
  }
  return <g>{tiles}</g>;
}

export function Grid({ view, basemap }: { view: View; basemap: BasemapStyle }) {
  // Both 'dark' and 'satellite' have low-luminance imagery — use a faint
  // white grid for both, dark grid for the lighter CARTO basemaps.
  const onDarkBg = basemap === 'dark' || basemap === 'satellite';
  const gridStroke = onDarkBg ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
  const barStroke  = onDarkBg ? 'rgba(255,255,255,0.6)'  : 'rgba(0,0,0,0.6)';
  const barText    = onDarkBg ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.75)';

  const lines: React.ReactNode[] = [];
  const stepKm = pickGridStep(view.spanKm);
  const stepDegLat = stepKm / 111;
  const stepDegLon = stepKm / (111 * Math.cos((view.centerLat * Math.PI) / 180));

  const minLat = view.centerLat - view.spanLat / 2;
  const maxLat = view.centerLat + view.spanLat / 2;
  const minLon = view.centerLon - view.spanLon / 2;
  const maxLon = view.centerLon + view.spanLon / 2;

  for (let lat = Math.ceil(minLat / stepDegLat) * stepDegLat; lat < maxLat; lat += stepDegLat) {
    const { y } = projectMeters(lat, view.centerLon, view);
    lines.push(<line key={`gh-${lat}`} x1={0} x2={SVG_W} y1={y} y2={y} stroke={gridStroke} />);
  }
  for (let lon = Math.ceil(minLon / stepDegLon) * stepDegLon; lon < maxLon; lon += stepDegLon) {
    const { x } = projectMeters(view.centerLat, lon, view);
    lines.push(<line key={`gv-${lon}`} y1={0} y2={SVG_H} x1={x} x2={x} stroke={gridStroke} />);
  }

  const barLengthKm = stepKm;
  const barPx = (barLengthKm / view.spanKm) * SVG_W * 0.95;
  return (
    <>
      {lines}
      <line x1={40} x2={40 + barPx} y1={960} y2={960} stroke={barStroke} strokeWidth={2} />
      <line x1={40} x2={40} y1={954} y2={966} stroke={barStroke} strokeWidth={2} />
      <line x1={40 + barPx} x2={40 + barPx} y1={954} y2={966} stroke={barStroke} strokeWidth={2} />
      <text x={40 + barPx / 2} y={950} fill={barText} fontSize={14} textAnchor="middle"
            fontFamily="ui-monospace, Menlo, monospace">{barLengthKm} km</text>
    </>
  );
}
