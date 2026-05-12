import React from 'react';
import { findCoords, findUrls } from '../lib/smart-text';

/**
 * Render plain chat text with inline enhancements:
 *   - Lat/lon substrings turn into clickable map chips
 *   - http(s) URLs turn into clickable links
 *   - Everything else passes through as plain text
 *
 * Both helpers return absolute character offsets so we can build a flat
 * list of segments. Overlaps shouldn't happen in practice (coords don't
 * contain URLs and vice versa), but we sort and de-overlap defensively.
 */
export function SmartText({ text }: { text: string }) {
  const coords = findCoords(text).map((m) => ({ ...m, kind: 'coord' as const }));
  const urls = findUrls(text).map((m) => ({ ...m, kind: 'url' as const }));

  const merged = [...coords, ...urls].sort((a, b) => a.start - b.start);
  // Drop any later match that starts before the previous one ends.
  const matches: typeof merged = [];
  let lastEnd = 0;
  for (const m of merged) {
    if (m.start >= lastEnd) {
      matches.push(m);
      lastEnd = m.end;
    }
  }

  if (matches.length === 0) return <>{text}</>;

  const nodes: React.ReactNode[] = [];
  let pos = 0;
  matches.forEach((m, i) => {
    if (m.start > pos) nodes.push(text.slice(pos, m.start));
    if (m.kind === 'coord') {
      nodes.push(<CoordChip lat={m.lat} lon={m.lon} key={`c${i}`} />);
    } else {
      nodes.push(
        <a
          key={`u${i}`}
          href={m.url}
          target="_blank"
          rel="noreferrer"
          className="smart-link"
        >
          {m.url}
        </a>,
      );
    }
    pos = m.end;
  });
  if (pos < text.length) nodes.push(text.slice(pos));
  return <>{nodes}</>;
}

function CoordChip({ lat, lon }: { lat: number; lon: number }) {
  const href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=14/${lat}/${lon}`;
  return (
    <a
      className="smart-coord-chip"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`Open ${lat.toFixed(5)}, ${lon.toFixed(5)} in OpenStreetMap`}
    >
      {lat.toFixed(5)}, {lon.toFixed(5)}
    </a>
  );
}
