import React, { useEffect, useMemo, useRef, useState } from 'react';
import { bus, type BusEvent, type BusFilter } from '../bus';
import { listInstances, getInstance } from '../concepts/registry';

interface Props {
  nodes: NodeRecord[];
  onMessageNode?: (num: number) => void;
}

type Tab = 'all' | 'bytype' | 'stats' | 'about';

function shortHex(num: number): string { return '!' + (num >>> 0).toString(16).padStart(8, '0').slice(-4); }
function nameFor(nodes: NodeRecord[], from: string | number | undefined): string {
  if (from === undefined) return '—';
  if (typeof from === 'string') return from;
  const n = nodes.find((x) => x.num === from);
  return n?.shortName || shortHex(from);
}
function colorForKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffffffff;
  return `hsl(${Math.abs(h) % 360}, 60%, 65%)`;
}

export function EventFeedPanel({ nodes, onMessageNode }: Props) {
  const [tab, setTab] = useState<Tab>('all');
  const [events, setEvents] = useState<BusEvent[]>(() => bus.history().slice(-500));
  const [filterUpdate, setFilterUpdate] = useState('');
  const [filterTopic, setFilterTopic] = useState('');
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Used to drive sparkline ticks even when no events arrive
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const updateConcepts = useMemo(() => listInstances('update'), []);
  const topicConcepts = useMemo(() => listInstances('topic'), []);

  useEffect(() => {
    if (paused) return;
    const filter: BusFilter = {};
    if (filterUpdate) filter.updateSlug = filterUpdate;
    if (filterTopic) filter.topicSlug = filterTopic;
    setEvents(bus.history(filter).slice(-500));
    const off = bus.subscribe(filter, (e) => {
      setEvents((prev) => [...prev.slice(-499), e]);
    });
    return off;
  }, [filterUpdate, filterTopic, paused]);

  const searched = useMemo(() => {
    if (!search) return events;
    const q = search.toLowerCase();
    return events.filter((e) => {
      const blob = [e.updateSlug, e.topicSlug, e.sourceProtocolSlug,
        e.from?.toString(), e.to?.toString(),
        JSON.stringify(e.payload ?? '')].join(' ').toLowerCase();
      return blob.includes(q);
    });
  }, [events, search]);

  const exportCsv = () => {
    const rows = searched.map((e) => ({
      ts_iso: new Date(e.ts).toISOString(),
      update: e.updateSlug,
      topic: e.topicSlug ?? '',
      source: e.sourceProtocolSlug,
      from: e.from?.toString() ?? '',
      to: e.to?.toString() ?? '',
      wire_bytes: e.wireBytes?.toString() ?? '',
      payload_json: JSON.stringify(e.payload ?? ''),
    }));
    downloadCsv(rows, 'events');
  };

  return (
    <div className="page">
      <h1 className="page-title">Event Feed</h1>
      <p className="page-sub">
        Every protocol-native packet that arrives gets translated into a typed Update on an internal event bus.
        Panels subscribe by Update or Topic — not by protocol — so adding Reticulum or LoRaWAN would be a new
        translator file, no UI changes.
      </p>

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'all' ? ' active' : '')} onClick={() => setTab('all')}>
          All {events.length > 0 && <span className="subnav-count">{events.length}</span>}
        </button>
        <button className={'subnav-btn' + (tab === 'bytype' ? ' active' : '')} onClick={() => setTab('bytype')}>By type</button>
        <button className={'subnav-btn' + (tab === 'stats' ? ' active' : '')} onClick={() => setTab('stats')}>Stats</button>
        <button className={'subnav-btn' + (tab === 'about' ? ' active' : '')} onClick={() => setTab('about')}>About</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {searched.length > 0 && (
            <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={exportCsv}>⇩ CSV</button>
          )}
        </div>
      </div>

      {tab === 'all' && (
        <AllTab
          events={searched}
          nodes={nodes}
          updateConcepts={updateConcepts}
          topicConcepts={topicConcepts}
          filterUpdate={filterUpdate}
          setFilterUpdate={setFilterUpdate}
          filterTopic={filterTopic}
          setFilterTopic={setFilterTopic}
          search={search}
          setSearch={setSearch}
          paused={paused}
          setPaused={setPaused}
          expandedKey={expandedKey}
          setExpandedKey={setExpandedKey}
          onClearBuffer={() => { bus.clearBuffer(); setEvents([]); }}
          onMessageNode={onMessageNode}
        />
      )}
      {tab === 'bytype' && <ByTypeTab events={events} nodes={nodes} />}
      {tab === 'stats' && <StatsTab events={events} />}
      {tab === 'about' && <AboutTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// All tab — main live feed
// ─────────────────────────────────────────────────────────────────────

function AllTab({
  events, nodes, updateConcepts, topicConcepts,
  filterUpdate, setFilterUpdate, filterTopic, setFilterTopic,
  search, setSearch, paused, setPaused, expandedKey, setExpandedKey,
  onClearBuffer, onMessageNode,
}: {
  events: BusEvent[]; nodes: NodeRecord[];
  updateConcepts: any[]; topicConcepts: any[];
  filterUpdate: string; setFilterUpdate: (s: string) => void;
  filterTopic: string; setFilterTopic: (s: string) => void;
  search: string; setSearch: (s: string) => void;
  paused: boolean; setPaused: (p: boolean) => void;
  expandedKey: string | null; setExpandedKey: (k: string | null) => void;
  onClearBuffer: () => void;
  onMessageNode?: (n: number) => void;
}) {
  return (
    <div>
      <div className="card" style={{ padding: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="text" value={filterUpdate} onChange={(e) => setFilterUpdate(e.target.value)} style={{ width: 200 }}>
            <option value="">All updates</option>
            {updateConcepts.map((u) => (
              <option key={u.ID} value={u.ID}>{String(u.name)}</option>
            ))}
          </select>
          <select className="text" value={filterTopic} onChange={(e) => setFilterTopic(e.target.value)} style={{ width: 180 }}>
            <option value="">All topics</option>
            {topicConcepts.map((t) => (
              <option key={t.ID} value={t.ID}>{String(t.name)}</option>
            ))}
          </select>
          <input
            className="text"
            placeholder="search payload/from/update…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button className={paused ? 'primary' : 'ghost'} style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setPaused(!paused)}>
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onClearBuffer}>Clear</button>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-faint)' }}>
          {events.length} event{events.length === 1 ? '' : 's'} {paused && <span style={{ color: 'var(--warn)' }}>· paused</span>}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {events.length === 0 ? (
          <div className="empty" style={{ padding: 18 }}>
            No events buffered. Connect a Meshtastic node and traffic will appear here as typed Updates.
          </div>
        ) : (
          <table className="data" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Update</th>
                <th>Topic</th>
                <th>From</th>
                <th>→ To</th>
                <th>Bytes</th>
              </tr>
            </thead>
            <tbody>
              {events.slice().reverse().slice(0, 300).map((e, i) => {
                const k = `${e.ts}-${e.updateSlug}-${i}`;
                const expanded = expandedKey === k;
                const update = getInstance('update', e.updateSlug);
                const fromColor = typeof e.from === 'number' ? colorForKey(String(e.from)) : 'var(--text)';
                return (
                  <React.Fragment key={k}>
                    <tr
                      onClick={() => setExpandedKey(expanded ? null : k)}
                      style={{ cursor: 'pointer', background: expanded ? 'var(--bg-elev-2)' : undefined }}
                    >
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-faint)' }}>
                        {new Date(e.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: false })}
                      </td>
                      <td style={{ color: colorForKey(e.updateSlug) }}>{String(update?.name ?? e.updateSlug)}</td>
                      <td style={{ color: 'var(--text-dim)' }}>{e.topicSlug ?? '—'}</td>
                      <td style={{ color: fromColor, fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                        {nameFor(nodes, e.from)}
                      </td>
                      <td style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                        {e.to !== undefined ? nameFor(nodes, e.to) : '*'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{e.wireBytes ?? '—'}</td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--bg-elev-2)', padding: 14 }}>
                          <EventDetail event={e} nodes={nodes} onMessageNode={onMessageNode} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {events.length > 300 && (
          <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--line)' }}>
            Showing newest 300 of {events.length} buffered events. Use filters / search to narrow.
          </div>
        )}
      </div>
    </div>
  );
}

function EventDetail({ event, nodes, onMessageNode }: { event: BusEvent; nodes: NodeRecord[]; onMessageNode?: (n: number) => void }) {
  const update = getInstance('update', event.updateSlug);
  const topic = event.topicSlug ? getInstance('topic', event.topicSlug) : null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
      <div>
        <h4 style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Envelope</h4>
        <dl className="kv kv-tight" style={{ fontSize: 12 }}>
          <dt>ts</dt><dd>{new Date(event.ts).toLocaleString()}</dd>
          <dt>update</dt><dd><span style={{ color: colorForKey(event.updateSlug) }}>{String(update?.name ?? event.updateSlug)}</span> ({event.updateSlug})</dd>
          <dt>topic</dt><dd>{topic ? `${String(topic.name)} (${event.topicSlug})` : (event.topicSlug ?? '—')}</dd>
          <dt>source</dt><dd>{event.sourceProtocolSlug}</dd>
          <dt>from</dt><dd>{nameFor(nodes, event.from)}{typeof event.from === 'number' ? ` · !${(event.from >>> 0).toString(16).padStart(8, '0')}` : ''}</dd>
          <dt>to</dt><dd>{event.to !== undefined ? nameFor(nodes, event.to) : '* (broadcast)'}</dd>
          <dt>wireBytes</dt><dd>{event.wireBytes ?? '—'}</dd>
        </dl>
        {onMessageNode && typeof event.from === 'number' && (
          <div style={{ marginTop: 10 }}>
            <button className="primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onMessageNode(event.from as number)}>
              Message sender
            </button>
          </div>
        )}
      </div>
      <div>
        <h4 style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Payload</h4>
        <pre style={{ background: 'var(--bg)', padding: 12, borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 11.5, margin: 0, overflowX: 'auto', maxHeight: 280 }}>
          {event.payload === undefined ? '(no payload)' : JSON.stringify(event.payload, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// By type — per-update drilldown with sparkline
// ─────────────────────────────────────────────────────────────────────

function ByTypeTab({ events, nodes }: { events: BusEvent[]; nodes: NodeRecord[] }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) m.set(e.updateSlug, (m.get(e.updateSlug) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [events]);

  const [selected, setSelected] = useState<string | null>(null);
  const activeSlug = selected ?? counts[0]?.[0] ?? null;
  const subset = useMemo(() => events.filter((e) => e.updateSlug === activeSlug), [events, activeSlug]);

  if (counts.length === 0) {
    return <div className="card"><div className="empty">No events yet to break down.</div></div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16 }}>
      <div className="card" style={{ padding: 6 }}>
        <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 8px' }}>
          Update types ({counts.length})
        </div>
        {counts.map(([slug, count]) => {
          const u = getInstance('update', slug);
          const active = activeSlug === slug;
          return (
            <button
              key={slug}
              className={'convo-item' + (active ? ' active' : '')}
              onClick={() => setSelected(slug)}
            >
              <div className="convo-row">
                <span className="convo-label" style={{ color: colorForKey(slug) }}>{String(u?.name ?? slug)}</span>
                <span className="convo-time">{count}</span>
              </div>
              <div className="convo-preview" style={{ fontSize: 11 }}>{slug}</div>
            </button>
          );
        })}
      </div>

      {activeSlug && (
        <div>
          <div className="card">
            <h2 style={{ marginTop: 0, color: colorForKey(activeSlug) }}>
              {String(getInstance('update', activeSlug)?.name ?? activeSlug)}
            </h2>
            <div style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)', marginBottom: 10 }}>
              {subset.length} event{subset.length === 1 ? '' : 's'} · slug: {activeSlug}
            </div>
            <RateChart events={subset} color={colorForKey(activeSlug)} />
            <h3 style={{ marginTop: 14 }}>Recent</h3>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {subset.slice().reverse().slice(0, 50).map((e, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 140px 1fr', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-faint)' }}>
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: typeof e.from === 'number' ? colorForKey(String(e.from)) : 'var(--text)' }}>
                    {nameFor(nodes, e.from)}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.payload === undefined ? '—' : JSON.stringify(e.payload).slice(0, 120)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RateChart({ events, color }: { events: BusEvent[]; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawRate(ctx, c.width, c.height, events, color);
  }, [events, color]);
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        Rate · last 10 minutes (per-minute bins)
      </div>
      <canvas ref={canvasRef} width={900} height={120} style={{ width: '100%', height: 120, display: 'block', background: 'var(--bg)', borderRadius: 4 }} />
    </div>
  );
}

function drawRate(ctx: CanvasRenderingContext2D, w: number, h: number, events: BusEvent[], color: string): void {
  ctx.clearRect(0, 0, w, h);
  const padL = 30, padR = 8, padT = 6, padB = 16;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const bucketCount = 10;
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const buckets = new Array(bucketCount).fill(0);
  for (const e of events) {
    const ageMs = now - e.ts;
    if (ageMs > windowMs) continue;
    const idx = Math.min(bucketCount - 1, Math.floor((1 - ageMs / windowMs) * bucketCount));
    buckets[idx]++;
  }
  const max = Math.max(1, ...buckets);
  const barW = plotW / bucketCount;
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px ui-monospace';
  ctx.fillText('0', padL - 18, padT + plotH);
  ctx.fillText(String(max), padL - 22, padT + 10);
  buckets.forEach((v, i) => {
    const x = padL + i * barW;
    const barH = (v / max) * plotH;
    const y = padT + plotH - barH;
    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y, barW - 2, barH);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText('-10m', padL, h - 4);
  ctx.fillText('now', padL + plotW - 24, h - 4);
}

// ─────────────────────────────────────────────────────────────────────
// Stats tab
// ─────────────────────────────────────────────────────────────────────

function StatsTab({ events }: { events: BusEvent[] }) {
  const stats = useMemo(() => {
    const byUpdate = new Map<string, number>();
    const bySource = new Map<string, number>();
    const sources = new Set<string | number>();
    let totalBytes = 0;
    let earliest = Infinity, latest = 0;
    for (const e of events) {
      byUpdate.set(e.updateSlug, (byUpdate.get(e.updateSlug) ?? 0) + 1);
      bySource.set(e.sourceProtocolSlug, (bySource.get(e.sourceProtocolSlug) ?? 0) + 1);
      if (e.from !== undefined) sources.add(e.from);
      totalBytes += e.wireBytes ?? 0;
      if (e.ts < earliest) earliest = e.ts;
      if (e.ts > latest) latest = e.ts;
    }
    return {
      byUpdate: Array.from(byUpdate.entries()).sort((a, b) => b[1] - a[1]),
      bySource: Array.from(bySource.entries()).sort((a, b) => b[1] - a[1]),
      total: events.length,
      totalBytes,
      uniqueSources: sources.size,
      windowSec: events.length > 0 ? Math.max(0, (latest - earliest) / 1000) : 0,
    };
  }, [events]);

  const updateMax = Math.max(1, ...stats.byUpdate.map(([, c]) => c));

  if (events.length === 0) {
    return <div className="card"><div className="empty">No events yet.</div></div>;
  }

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Update mix</h2>
          {stats.byUpdate.map(([slug, count]) => {
            const u = getInstance('update', slug);
            return (
              <div key={slug} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 60px 50px', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: colorForKey(slug), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {String(u?.name ?? slug)}
                </span>
                <div style={{ background: 'var(--bg-elev-2)', height: 8, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${(count / updateMax) * 100}%`, height: '100%', background: colorForKey(slug) }} />
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, textAlign: 'right', color: 'var(--text-faint)' }}>{count}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, textAlign: 'right', color: 'var(--text-faint)' }}>
                  {Math.round((count / stats.total) * 100)}%
                </span>
              </div>
            );
          })}
        </div>

        {stats.bySource.length > 1 && (
          <div className="card">
            <h2>By source protocol</h2>
            {stats.bySource.map(([src, count]) => (
              <div key={src} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 60px', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{src}</span>
                <div style={{ background: 'var(--bg-elev-2)', height: 8, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${(count / stats.total) * 100}%`, height: '100%', background: 'var(--accent)' }} />
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, textAlign: 'right', color: 'var(--text-faint)' }}>{count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="range-grid">
          <Metric label="Total events" value={String(stats.total)} />
          <Metric label="Wire bytes (approx)" value={String(stats.totalBytes)} hint="sum of translator estimates" />
          <Metric label="Unique sources" value={String(stats.uniqueSources)} />
          <Metric label="Window" value={`${stats.windowSec.toFixed(0)} s`} />
          <Metric label="Events / sec" value={stats.windowSec > 0 ? (stats.total / stats.windowSec).toFixed(2) : '—'} />
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What "Topic" means.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Updates are types ("text message"). Topics are channels of conversation that updates flow through ("public channel 0", "DM with X"). The translator routes each Meshtastic packet to one update slug + one topic slug.
          </p>
        </div>
      </div>
    </div>
  );
}

function AboutTab() {
  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Why this bus exists</h2>
          <p style={{ color: 'var(--text-dim)' }}>
            Every panel in this app could, in principle, read from the event bus instead of polling the Meshtastic controller.
            That's the architectural commitment: the UI doesn't know what protocol packets look like, only what Updates mean.
            Add a Reticulum translator file, and every panel that reads <code>text-message</code> Updates automatically starts
            showing Reticulum chat too — no panel changes required.
          </p>
          <p style={{ color: 'var(--text-dim)' }}>
            This is the same pattern an event-sourced internet would use, scaled down to one app. The Concepts panel
            (under Reference) has the full vocabulary of <code>Update</code>, <code>Topic</code>, <code>Protocol</code>
            instances that drive this system.
          </p>
        </div>

        <div className="card">
          <h2>Anatomy of an event</h2>
          <pre style={{ background: 'var(--bg)', padding: 12, borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, margin: 0, lineHeight: 1.5 }}>
{`{
  ts: 1736192831234,                       // wall-clock ms
  updateSlug: 'text-message',              // typed Update concept slug
  topicSlug: 'public-channel-0',           // which conversation
  sourceProtocolSlug: 'meshtastic-lora',   // which translator emitted this
  from: 0xa1cbf0d0,                        // sender node num
  to: 0xffffffff,                          // recipient (or broadcast)
  wireBytes: 73,                           // observed/estimated cost
  payload: { text: 'hello mesh', ... },    // the decoded body
}`}
          </pre>
        </div>
      </div>

      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Translator lives at:</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, fontFamily: 'var(--mono)' }}>
            src/concepts/translators/meshtastic.ts
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-dim)' }}>
            That single file is the entire seam between Meshtastic-specific protocol details and the rest of the app. A second-protocol translator would be a peer file beside it.
          </p>
        </div>

        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Buffer.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Last 500 events are retained in memory. Use Clear to reset. Closing the app loses the buffer — for persistent history use the Packet Sniffer's CSV export or query the SQLite DB directly.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="range-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function downloadCsv(rows: Array<Record<string, string>>, suffix: string): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const body = rows.map((r) => headers.map((h) => escCsv(r[h])).join(',')).join('\n');
  const csv = headers.join(',') + '\n' + body + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url; a.download = `mesh-${suffix}-${stamp}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escCsv(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
