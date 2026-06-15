// Shared CSV export helpers. Previously every tabular panel (Telemetry,
// Traceroute, Packet Sniffer, Event Feed, Coverage, Link Budget, RSSI vs
// Distance, Chat, Map) hand-rolled an identical `escCsv` + download-link
// pair. Keep new callers on these so the format and filenames stay uniform.

/** RFC-4180 field escaping: quote and double-up quotes when the value
 *  contains a comma, quote, or newline. */
export function escCsv(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/**
 * Build CSV text from an array of flat string records. Header row is the
 * keys of the first record; every record must share that key set.
 */
export function toCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const body = rows.map((r) => headers.map((h) => escCsv(r[h])).join(',')).join('\n');
  return headers.join(',') + '\n' + body + '\n';
}

/**
 * Trigger a browser download of `rows` as `mesh-<suffix>-<timestamp>.csv`.
 * No-op for an empty set. The timestamp is a filesystem-safe ISO slice.
 */
export function downloadCsv(rows: Array<Record<string, string>>, suffix: string): void {
  if (rows.length === 0) return;
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `mesh-${suffix}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
