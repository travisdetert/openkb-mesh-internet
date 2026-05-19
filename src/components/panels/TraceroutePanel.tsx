import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TracerouteRecord } from '../../hooks/useMesh';
import { useActiveConnId } from '../../hooks/MeshContext';
import { PanelChannelHeader } from '../PanelChannelHeader';

interface Props {
  nodes: NodeRecord[];
  state: ConnectionState;
  traceroutes: TracerouteRecord[];
  onMessageNode?: (num: number) => void;
}

type Tab = 'run' | 'history' | 'map';

const TILE_SIZE = 256;
const SVG_W = 1200;
const SVG_H = 700;

import { nodeIdHex, nodeShortHex as shortHex, nodeDisplayName as nameFor } from '../../lib/node-identity';
function colorForNode(num: number): string {
  const hue = ((num >>> 0) * 137.508) % 360;
  return `hsl(${hue}, 65%, 65%)`;
}

// Mercator helpers (duplicated from PositionMapPanel for now; safe to extract later).
function lonToMercX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z) * TILE_SIZE;
}
function latToMercY(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  return (0.5 - Math.log((1 + Math.sin(latRad)) / (1 - Math.sin(latRad))) / (4 * Math.PI)) * Math.pow(2, z) * TILE_SIZE;
}
function clampZoom(z: number): number { return Math.max(1, Math.min(17, Math.round(z))); }

export function TraceroutePanel({ nodes, state, traceroutes, onMessageNode }: Props) {
  const [tab, setTab] = useState<Tab>('run');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Group records by destination, newest first.
  const byTarget = useMemo(() => {
    const m = new Map<number, TracerouteRecord[]>();
    for (const tr of traceroutes) {
      if (!m.has(tr.to)) m.set(tr.to, []);
      m.get(tr.to)!.push(tr);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.sentAt - a.sentAt);
    return m;
  }, [traceroutes]);

  const exportCsv = () => {
    const rows = traceroutes.flatMap((tr) => {
      const dest = nameFor(nodes, tr.to);
      const sent = new Date(tr.sentAt).toISOString();
      const route = tr.response ? tr.response.route.map((n) => nameFor(nodes, n)).join(' → ') : '';
      const rtt = tr.response ? ((tr.response.receivedAt - tr.sentAt) / 1000).toFixed(2) : '';
      return [{
        sent_iso: sent,
        target_short: dest,
        target_hex: nodeIdHex(tr.to),
        hops: tr.response ? String(tr.response.route.length + 1) : '',
        rtt_s: rtt,
        rssi_dbm: tr.response ? String(tr.response.rxRssi) : '',
        snr_db: tr.response ? tr.response.rxSnr.toFixed(2) : '',
        route: route,
      }];
    });
    downloadCsv(rows, 'traceroutes');
  };

  return (
    <div className="page">
      <h1 className="page-title">Traceroute</h1>
      <p className="page-sub">
        Ask the mesh: which nodes did the packet pass through to reach a destination — and how did the response come back? Each intermediate relay stamps its node ID into the route as the request flows.
      </p>

      <PanelChannelHeader state={state} label="TRACING FROM" />

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'run' ? ' active' : '')} onClick={() => setTab('run')}>Run</button>
        <button className={'subnav-btn' + (tab === 'history' ? ' active' : '')} onClick={() => setTab('history')}>
          History
          {traceroutes.length > 0 && <span className="subnav-count">{traceroutes.length}</span>}
        </button>
        <button className={'subnav-btn' + (tab === 'map' ? ' active' : '')} onClick={() => setTab('map')}>Map</button>
        <div style={{ marginLeft: 'auto' }}>
          {traceroutes.length > 0 && (
            <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={exportCsv}>⇩ CSV</button>
          )}
        </div>
      </div>

      {tab === 'run' && (
        <RunTab
          nodes={nodes}
          state={state}
          traceroutes={traceroutes}
          onMessageNode={onMessageNode}
        />
      )}
      {tab === 'history' && (
        <HistoryTab
          nodes={nodes}
          state={state}
          byTarget={byTarget}
          selectedKey={selectedKey}
          setSelectedKey={setSelectedKey}
          onMessageNode={onMessageNode}
        />
      )}
      {tab === 'map' && (
        <MapTab
          nodes={nodes}
          state={state}
          traceroutes={traceroutes}
          selectedKey={selectedKey}
          setSelectedKey={setSelectedKey}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Run tab
// ─────────────────────────────────────────────────────────────────────

function RunTab({ nodes, state, traceroutes, onMessageNode }: { nodes: NodeRecord[]; state: ConnectionState; traceroutes: TracerouteRecord[]; onMessageNode?: (num: number) => void }) {
  const connId = useActiveConnId();
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);

  const remoteNodes = useMemo(
    () => nodes.filter((n) => n.num !== state.myInfo?.myNodeNum).sort((a, b) => (b.lastHeard ?? 0) - (a.lastHeard ?? 0)),
    [nodes, state.myInfo?.myNodeNum],
  );

  useEffect(() => {
    if (target === null && remoteNodes.length > 0) setTarget(remoteNodes[0].num);
  }, [remoteNodes, target]);

  const trace = async () => {
    if (target === null || !connId) return;
    setBusy(true); setErr('');
    try {
      await window.mesh.sendTraceroute({ connId, to: target });
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const traceTopFive = async () => {
    if (!connId) return;
    setBatchBusy(true); setErr('');
    try {
      // Spread requests 30s apart to respect typical Meshtastic traceroute
      // throttling and avoid swamping the channel.
      const top = remoteNodes.filter((n) => n.lastHeard).slice(0, 5);
      for (let i = 0; i < top.length; i++) {
        await window.mesh.sendTraceroute({ connId, to: top[i].num });
        if (i < top.length - 1) await new Promise((r) => setTimeout(r, 30000));
      }
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBatchBusy(false); }
  };

  const isReady = state.status === 'ready';

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Trace a node</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Target</div>
              <select className="text" value={target ?? ''} onChange={(e) => setTarget(Number(e.target.value))} disabled={!isReady}>
                {remoteNodes.length === 0 && <option value="">No remote nodes known yet</option>}
                {remoteNodes.map((n) => (
                  <option key={n.num} value={n.num}>
                    {n.shortName || '????'} — {n.longName || nodeIdHex(n.num)}{n.hopsAway !== undefined ? ` · ${n.hopsAway} hop${n.hopsAway === 1 ? '' : 's'}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <button className="primary" onClick={trace} disabled={!isReady || target === null || busy || batchBusy}>
              {busy ? 'Sending…' : 'Trace'}
            </button>
            <button
              className="ghost"
              onClick={traceTopFive}
              disabled={!isReady || busy || batchBusy || remoteNodes.length === 0}
              title="Send a traceroute to the 5 most-recently-heard nodes, 30s apart"
            >
              {batchBusy ? 'Tracing top 5…' : 'Trace top 5'}
            </button>
          </div>
          {!isReady && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-faint)' }}>Connect to your node first.</div>
          )}
          {err && <div style={{ color: 'var(--bad)', marginTop: 8, fontFamily: 'var(--mono)', fontSize: 12 }}>{err}</div>}
        </div>

        <div className="card">
          <h2>Recent traces</h2>
          {traceroutes.length === 0 ? (
            <div className="empty">No traces yet. Pick a node and hit Trace.</div>
          ) : (
            traceroutes.slice(0, 20).map((tr, i) => (
              <TraceCard key={i} record={tr} nodes={nodes} myNum={state.myInfo?.myNodeNum} onMessageNode={onMessageNode} />
            ))
          )}
        </div>
      </div>

      <div>
        <div className="info-card">
          <p><strong>What you're seeing.</strong></p>
          <p>The radio sends a tiny packet (portnum 70, empty payload, want_response=true). Every node that forwards it appends its node number to the <code>route</code> field. The destination receives the packet, sees its name in the route, and replies — and the reply traces its own way home.</p>
          <p style={{ marginBottom: 0 }}>If the response never comes back, the destination might not be reachable, the route is too long for hop_limit, or the channel is too congested.</p>
        </div>
        <div className="card">
          <h3>Reading a hop chain</h3>
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12.5 }}>
            <code>me → A → B → them</code> means your packet went through A and B to reach the target. Click any hop to message that node directly. The shorter the chain, the lower the latency. Two chains to the same target that differ in length over time tell you where the mesh is well-connected vs where it's a long thin line.
          </p>
        </div>
        <div className="info-card">
          <p><strong>Heads up.</strong></p>
          <p style={{ marginBottom: 0 }}>Some firmwares rate-limit traceroutes aggressively (one per 30 sec). "Trace top 5" honors that. If you see no response within 60 s, the target probably can't be reached at all — see the History tab for whether you've ever successfully traced this node.</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// History tab — per-destination over time
// ─────────────────────────────────────────────────────────────────────

function HistoryTab({ nodes, state, byTarget, selectedKey, setSelectedKey, onMessageNode }: {
  nodes: NodeRecord[]; state: ConnectionState;
  byTarget: Map<number, TracerouteRecord[]>;
  selectedKey: string | null;
  setSelectedKey: (k: string | null) => void;
  onMessageNode?: (num: number) => void;
}) {
  const entries = Array.from(byTarget.entries()).map(([num, traces]) => ({
    num,
    traces,
    latest: traces[0],
    answered: traces.filter((t) => t.response).length,
  })).sort((a, b) => (b.latest.sentAt - a.latest.sentAt));

  const activeKey = selectedKey ?? (entries[0] ? `dst:${entries[0].num}` : null);
  const activeNum = activeKey?.startsWith('dst:') ? Number(activeKey.slice(4)) : null;
  const activeEntry = activeNum != null ? entries.find((e) => e.num === activeNum) : null;

  if (entries.length === 0) {
    return (
      <div className="card">
        <div className="empty">No traceroutes captured yet. Send one from the Run tab.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
      <div className="card" style={{ padding: 6 }}>
        <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 8px' }}>
          Destinations ({entries.length})
        </div>
        {entries.map((e) => {
          const active = activeNum === e.num;
          const target = nodes.find((n) => n.num === e.num);
          return (
            <button
              key={e.num}
              className={'convo-item' + (active ? ' active' : '')}
              onClick={() => setSelectedKey(`dst:${e.num}`)}
            >
              <div className="convo-row">
                <span className="convo-label" style={{ color: colorForNode(e.num) }}>{target?.shortName || shortHex(e.num)}</span>
                <span className="convo-time">{e.traces.length}× / {e.answered} ✓</span>
              </div>
              <div className="convo-preview">
                latest {e.latest.response ? `${e.latest.response.route.length + 1} hop${e.latest.response.route.length === 0 ? '' : 's'}` : 'no response'} · {timeAgoSec(Math.floor(e.latest.sentAt / 1000))}
              </div>
            </button>
          );
        })}
      </div>

      {activeEntry && (
        <div className="card">
          <DestinationHistory
            entry={activeEntry}
            nodes={nodes}
            state={state}
            onMessageNode={onMessageNode}
          />
        </div>
      )}
    </div>
  );
}

function DestinationHistory({ entry, nodes, state, onMessageNode }: {
  entry: { num: number; traces: TracerouteRecord[]; latest: TracerouteRecord; answered: number };
  nodes: NodeRecord[];
  state: ConnectionState;
  onMessageNode?: (num: number) => void;
}) {
  const target = nodes.find((n) => n.num === entry.num);

  // Hop count over time for sparkline.
  const hopSeries = entry.traces
    .filter((t) => t.response)
    .sort((a, b) => a.sentAt - b.sentAt)
    .map((t) => ({ ts: t.sentAt, hops: t.response!.route.length + 1 }));

  // RTT series
  const rttSeries = entry.traces
    .filter((t) => t.response)
    .sort((a, b) => a.sentAt - b.sentAt)
    .map((t) => ({ ts: t.sentAt, rtt: (t.response!.receivedAt - t.sentAt) / 1000 }));

  // Path-change detection: walk back through history, note when route differs.
  const sortedAsc = entry.traces.filter((t) => t.response).sort((a, b) => a.sentAt - b.sentAt);
  const changes: Array<{ at: number; from: string; to: string }> = [];
  for (let i = 1; i < sortedAsc.length; i++) {
    const prev = sortedAsc[i - 1].response!.route.join(',');
    const cur = sortedAsc[i].response!.route.join(',');
    if (prev !== cur) {
      changes.push({
        at: sortedAsc[i].sentAt,
        from: sortedAsc[i - 1].response!.route.map((n) => nameFor(nodes, n)).join(' → ') || '(direct)',
        to: sortedAsc[i].response!.route.map((n) => nameFor(nodes, n)).join(' → ') || '(direct)',
      });
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
        <div>
          <h2 style={{ margin: 0 }}>{target?.longName || target?.shortName || shortHex(entry.num)}</h2>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)', marginTop: 2 }}>
            {nodeIdHex(entry.num)} · {entry.traces.length} trace{entry.traces.length === 1 ? '' : 's'} · {entry.answered} answered
          </div>
        </div>
        {onMessageNode && (
          <button className="primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onMessageNode(entry.num)} disabled={state.status !== 'ready'}>
            Message
          </button>
        )}
      </div>

      <div className="range-grid" style={{ marginBottom: 14 }}>
        <Metric label="Total traces" value={String(entry.traces.length)} />
        <Metric label="Answered" value={`${entry.answered}/${entry.traces.length}`} tone={entry.answered === 0 ? 'bad' : entry.answered < entry.traces.length ? 'warn' : 'good'} />
        <Metric label="Latest hops" value={entry.latest.response ? String(entry.latest.response.route.length + 1) : 'no response'} />
        <Metric label="Path changes" value={String(changes.length)} tone={changes.length > 0 ? 'warn' : 'good'} hint="route differed between consecutive traces" />
      </div>

      <Sparkline title="Hop count" series={hopSeries.map((p) => ({ ts: p.ts, v: p.hops }))} yMax={Math.max(7, ...hopSeries.map((p) => p.hops + 1))} yLabel="" color="#ffd166" />
      <Sparkline title="Round-trip time (s)" series={rttSeries.map((p) => ({ ts: p.ts, v: p.rtt }))} yMax={Math.max(10, ...rttSeries.map((p) => p.rtt * 1.2))} yLabel="s" color="#5cc8ff" />

      {changes.length > 0 && (
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)', marginTop: 12 }}>
          <p style={{ margin: 0, fontWeight: 500 }}>Path changes detected</p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text-dim)' }}>
            {changes.slice(-5).map((c, i) => (
              <li key={i}>
                {new Date(c.at).toLocaleString()}: <code>{c.from}</code> → <code style={{ color: 'var(--accent)' }}>{c.to}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <HopReliability entry={entry} nodes={nodes} myNum={state.myInfo?.myNodeNum} />

      <div style={{ marginTop: 14 }}>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 8 }}>Individual traces</h3>
        {entry.traces.map((tr, i) => (
          <TraceCard key={i} record={tr} nodes={nodes} myNum={state.myInfo?.myNodeNum} onMessageNode={onMessageNode} compact />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Per-hop reliability summary
// ─────────────────────────────────────────────────────────────────────

/**
 * Aggregate every trace to a given destination into per-link reliability
 * stats. Each "link" is an ordered pair (from→to) appearing in the
 * forward or return path of some trace. We track:
 *   - apperances: how many of the answered traces this link was in
 *   - SNR samples (forward + return), with min/avg
 *   - bottleneck heuristic: the link with the lowest mean SNR is the
 *     weakest leg of the chain, and is what would most benefit from an
 *     antenna/elevation improvement.
 *
 * Round-trip success is `entry.answered / entry.traces.length`. With
 * the per-link reliability + the round-trip rate, the user can see
 * exactly why intermittent traces fail.
 */
function HopReliability({ entry, nodes, myNum }: { entry: { traces: TracerouteRecord[]; answered: number }; nodes: NodeRecord[]; myNum?: number }) {
  type LinkStat = {
    from: number;
    to: number;
    appearances: number;        // number of answered traces this link is in
    fwdSnrs: number[];
    backSnrs: number[];
  };

  const answered = entry.traces.filter((t) => t.response);
  if (answered.length === 0) {
    return (
      <div className="info-card" style={{ borderLeftColor: 'var(--bad)', marginTop: 14 }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          <strong style={{ color: 'var(--bad)' }}>0 of {entry.traces.length}</strong> traces completed.
          That means either the forward path doesn't close (your packet never reaches them) or the reply path
          doesn't (they hear you but their answer can't get back). Common causes are hop limit, asymmetric link,
          or a missing intermediate relay. The traces below have no per-hop data because no response came back.
        </p>
      </div>
    );
  }

  const links = new Map<string, LinkStat>();
  const linkKey = (a: number, b: number) => `${a}>${b}`;

  for (const t of answered) {
    const r = t.response!;
    // Forward chain: me → route[0] → … → target. The route field doesn't
    // include the endpoints, so we synthesise the full chain.
    const target = r.from; // response.from = the node that replied = destination
    const fwd = [myNum ?? 0, ...r.route, target].filter((n) => n);
    for (let i = 0; i < fwd.length - 1; i++) {
      const key = linkKey(fwd[i], fwd[i + 1]);
      const s = links.get(key) ?? { from: fwd[i], to: fwd[i + 1], appearances: 0, fwdSnrs: [], backSnrs: [] };
      s.appearances += 1;
      // snr_towards[i] is the SNR observed at fwd[i+1] for the packet from
      // fwd[i]. May not be present in older firmware — guard for missing.
      const snr = r.snrTowards?.[i];
      if (typeof snr === 'number' && Number.isFinite(snr) && snr !== 0) s.fwdSnrs.push(snr);
      links.set(key, s);
    }
    // Return chain: target → routeBack[0] → … → me. routeBack may be
    // empty on firmware that doesn't populate it (older builds) — we just
    // skip the return-direction stats in that case.
    if (Array.isArray(r.routeBack) && r.routeBack.length > 0) {
      const back = [target, ...r.routeBack, myNum ?? 0].filter((n) => n);
      for (let i = 0; i < back.length - 1; i++) {
        const key = linkKey(back[i], back[i + 1]);
        const s = links.get(key) ?? { from: back[i], to: back[i + 1], appearances: 0, fwdSnrs: [], backSnrs: [] };
        // Don't double-count appearance — the return path is the same
        // attempt, not a new one. Only record SNR.
        const snr = r.snrBack?.[i];
        if (typeof snr === 'number' && Number.isFinite(snr) && snr !== 0) s.backSnrs.push(snr);
        links.set(key, s);
      }
    }
  }

  const rows = Array.from(links.values()).map((s) => {
    const fwdAvg = s.fwdSnrs.length ? s.fwdSnrs.reduce((a, b) => a + b, 0) / s.fwdSnrs.length : null;
    const fwdMin = s.fwdSnrs.length ? Math.min(...s.fwdSnrs) : null;
    const backAvg = s.backSnrs.length ? s.backSnrs.reduce((a, b) => a + b, 0) / s.backSnrs.length : null;
    const backMin = s.backSnrs.length ? Math.min(...s.backSnrs) : null;
    // Mean of available SNR values across directions — used to rank
    // bottlenecks. Lower = weaker leg.
    const meanSnr = (fwdAvg !== null && backAvg !== null) ? (fwdAvg + backAvg) / 2
      : (fwdAvg ?? backAvg);
    return { ...s, fwdAvg, fwdMin, backAvg, backMin, meanSnr };
  });

  const total = answered.length;
  // Bottleneck = link with the worst mean SNR (only consider links with
  // any SNR samples, to avoid promoting "no data" entries as bottlenecks).
  const withSnr = rows.filter((r) => r.meanSnr !== null);
  const bottleneck = withSnr.length > 0
    ? withSnr.reduce((a, b) => (a.meanSnr! < b.meanSnr! ? a : b))
    : null;

  const rttsMs = answered.map((t) => t.response!.receivedAt - t.sentAt);
  const rttAvg = rttsMs.reduce((a, b) => a + b, 0) / rttsMs.length / 1000;
  const rttMin = Math.min(...rttsMs) / 1000;
  const rttMax = Math.max(...rttsMs) / 1000;
  const roundTripPct = (answered.length / entry.traces.length) * 100;

  const name = (num: number) => {
    const n = nodes.find((x) => x.num === num);
    if (num === myNum) return 'me';
    return n?.shortName || shortHex(num);
  };
  const snrLabel = (v: number | null) => v === null ? '—' : `${v.toFixed(1)}`;
  const snrTone = (v: number | null) => {
    if (v === null) return 'var(--text-faint)';
    if (v >= 5) return 'var(--good)';
    if (v >= -5) return 'var(--warn)';
    return 'var(--bad)';
  };

  // Sort: bottleneck first, then by appearance frequency (most common
  // links highest), then by mean SNR ascending.
  rows.sort((a, b) => {
    if (a === bottleneck) return -1;
    if (b === bottleneck) return 1;
    if (a.appearances !== b.appearances) return b.appearances - a.appearances;
    return (a.meanSnr ?? Infinity) - (b.meanSnr ?? Infinity);
  });

  return (
    <div style={{ marginTop: 14 }}>
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 8 }}>
        Per-hop reliability ({answered.length} answered of {entry.traces.length})
      </h3>

      <div className="info-card" style={{ marginBottom: 10, borderLeftColor: roundTripPct >= 80 ? 'var(--good)' : roundTripPct >= 50 ? 'var(--warn)' : 'var(--bad)' }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          <strong>Round-trip success: {roundTripPct.toFixed(0)}%</strong>
          <span style={{ color: 'var(--text-faint)' }}> · RTT {rttMin.toFixed(1)}–{rttMax.toFixed(1)} s (avg {rttAvg.toFixed(1)} s)</span>
        </p>
        {bottleneck && (
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-dim)' }}>
            <strong style={{ color: 'var(--warn)' }}>Bottleneck:</strong>{' '}
            <code>{name(bottleneck.from)} → {name(bottleneck.to)}</code>{' '}
            — mean SNR {bottleneck.meanSnr?.toFixed(1)} dB, appears in {bottleneck.appearances}/{total} answered traces.
            {bottleneck.meanSnr !== null && bottleneck.meanSnr < -5 && (
              <> At this SNR the receiver is near the LoRa decode cliff (-20 dB SF12, -7.5 dB LongFast) — small environmental changes (a moving vehicle, wet leaves, time of day) tip individual packets past correctable bit errors. This is why retries succeed and fail seemingly at random.</>
            )}
            {bottleneck.meanSnr !== null && bottleneck.meanSnr >= -5 && bottleneck.meanSnr < 5 && (
              <> Working but with little headroom — a few dB of fading can cause intermittent drops. Antenna height / gain on this leg's endpoints is the cheapest improvement.</>
            )}
          </p>
        )}
        {!bottleneck && (
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
            Per-hop SNR data isn't populated by this peer's firmware — we can still see <em>which</em> hops are involved, just not how strong each leg is.
          </p>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="data" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th>Link</th>
              <th style={{ textAlign: 'right' }}>Appears</th>
              <th style={{ textAlign: 'right' }}>SNR →</th>
              <th style={{ textAlign: 'right' }}>SNR ←</th>
              <th style={{ textAlign: 'right' }}>Min →</th>
              <th style={{ textAlign: 'right' }}>Min ←</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isBottleneck = r === bottleneck;
              return (
                <tr key={`${r.from}-${r.to}`} style={isBottleneck ? { background: 'rgba(255,209,102,0.08)' } : undefined}>
                  <td>
                    {isBottleneck && <span title="weakest leg" style={{ marginRight: 6 }}>⚠</span>}
                    <code style={{ color: 'var(--accent)' }}>{name(r.from)}</code>
                    <span style={{ margin: '0 4px', color: 'var(--text-faint)' }}>→</span>
                    <code style={{ color: 'var(--accent)' }}>{name(r.to)}</code>
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.appearances}/{total}</td>
                  <td style={{ textAlign: 'right', color: snrTone(r.fwdAvg) }}>{snrLabel(r.fwdAvg)}</td>
                  <td style={{ textAlign: 'right', color: snrTone(r.backAvg) }}>{snrLabel(r.backAvg)}</td>
                  <td style={{ textAlign: 'right', color: snrTone(r.fwdMin) }}>{snrLabel(r.fwdMin)}</td>
                  <td style={{ textAlign: 'right', color: snrTone(r.backMin) }}>{snrLabel(r.backMin)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 6, fontSize: 10.5, color: 'var(--text-faint)' }}>
        Direction arrows show the side from which the SNR was observed (→ = forward, on the way to this peer; ← = return, coming back).
        Green ≥ 5 dB · yellow −5–5 dB · red below −5 dB. SNRs require firmware that populates <code>snr_towards</code> / <code>snr_back</code>.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Map tab
// ─────────────────────────────────────────────────────────────────────

function MapTab({ nodes, state, traceroutes, selectedKey, setSelectedKey }: {
  nodes: NodeRecord[];
  state: ConnectionState;
  traceroutes: TracerouteRecord[];
  selectedKey: string | null;
  setSelectedKey: (k: string | null) => void;
}) {
  const myNum = state.myInfo?.myNodeNum;
  const answered = useMemo(() => traceroutes.filter((t) => t.response), [traceroutes]);

  // Default selection = newest answered
  useEffect(() => {
    if (!selectedKey && answered[0]) {
      setSelectedKey(`tr:${answered[0].response!.receivedAt}-${answered[0].to}`);
    }
  }, [answered, selectedKey, setSelectedKey]);

  const selected = useMemo(() => {
    if (!selectedKey?.startsWith('tr:')) return answered[0] ?? null;
    return answered.find((t) => `tr:${t.response!.receivedAt}-${t.to}` === selectedKey) ?? answered[0] ?? null;
  }, [answered, selectedKey]);

  if (answered.length === 0) {
    return (
      <div className="card">
        <div className="empty">No answered traceroutes yet — nothing to plot. Send one from the Run tab.</div>
      </div>
    );
  }

  // Build the route node chain for the selected trace.
  const myNode = nodes.find((n) => n.num === myNum);
  const routeNumChain = selected ? [myNum, ...selected.response!.route, selected.to].filter((n): n is number => typeof n === 'number') : [];
  const routeNodes = routeNumChain.map((num) => nodes.find((n) => n.num === num)).filter((n): n is NodeRecord => !!n);
  const positionedRouteNodes = routeNodes.filter((n) => n.lat !== undefined && n.lon !== undefined && (n.lat !== 0 || n.lon !== 0));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
      <div className="card" style={{ padding: 6 }}>
        <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 8px' }}>
          Answered traces ({answered.length})
        </div>
        {answered.map((t) => {
          const k = `tr:${t.response!.receivedAt}-${t.to}`;
          const active = selectedKey === k;
          return (
            <button
              key={k}
              className={'convo-item' + (active ? ' active' : '')}
              onClick={() => setSelectedKey(k)}
            >
              <div className="convo-row">
                <span className="convo-label" style={{ color: colorForNode(t.to) }}>{nameFor(nodes, t.to)}</span>
                <span className="convo-time">{t.response!.route.length + 1}h</span>
              </div>
              <div className="convo-preview">
                {new Date(t.sentAt).toLocaleString()}
              </div>
            </button>
          );
        })}
      </div>

      <div>
        {selected && (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Route to {nameFor(nodes, selected.to)}</h2>
            {positionedRouteNodes.length < 2 ? (
              <div className="empty">
                <p style={{ margin: 0 }}>
                  Only {positionedRouteNodes.length} of {routeNodes.length} node{routeNodes.length === 1 ? '' : 's'} in this route has shared a position — can't draw a meaningful line.
                  {routeNodes.length > positionedRouteNodes.length && <> Missing: {routeNodes.filter((n) => n.lat === undefined).map((n) => nameFor(nodes, n.num)).join(', ')}.</>}
                </p>
              </div>
            ) : (
              <RouteMap routeNodes={positionedRouteNodes} allRouteNumbers={routeNumChain} allNodes={nodes} />
            )}
            <div style={{ marginTop: 12, fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--text-dim)' }}>
              chain: {routeNumChain.map((num, i) => (
                <span key={i}>
                  {i > 0 && ' → '}
                  <span style={{ color: positionedRouteNodes.some((p) => p.num === num) ? 'var(--accent)' : 'var(--warn)' }}>
                    {nameFor(nodes, num)}
                  </span>
                </span>
              ))}
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>
              <span style={{ color: 'var(--accent)' }}>blue</span> = node with known position · <span style={{ color: 'var(--warn)' }}>yellow</span> = no position broadcast yet (skipped in the polyline)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function RouteMap({ routeNodes, allRouteNumbers, allNodes }: { routeNodes: NodeRecord[]; allRouteNumbers: number[]; allNodes: NodeRecord[] }) {
  if (routeNodes.length < 2) return null;

  // Compute bbox + zoom that fits.
  const lats = routeNodes.map((n) => n.lat!);
  const lons = routeNodes.map((n) => n.lon!);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLon = Math.min(...lons), maxLon = Math.max(...lons);
  if (maxLat - minLat < 0.001) { minLat -= 0.005; maxLat += 0.005; }
  if (maxLon - minLon < 0.001) { minLon -= 0.005; maxLon += 0.005; }
  const padLat = (maxLat - minLat) * 0.2, padLon = (maxLon - minLon) * 0.2;
  minLat -= padLat; maxLat += padLat;
  minLon -= padLon; maxLon += padLon;

  let zoom = 17;
  for (; zoom >= 1; zoom--) {
    const w = lonToMercX(maxLon, zoom) - lonToMercX(minLon, zoom);
    const h = latToMercY(minLat, zoom) - latToMercY(maxLat, zoom);
    if (w <= SVG_W && h <= SVG_H) break;
  }
  zoom = clampZoom(zoom);
  const dataMinMx = lonToMercX(minLon, zoom);
  const dataMaxMx = lonToMercX(maxLon, zoom);
  const dataMinMy = latToMercY(maxLat, zoom);
  const dataMaxMy = latToMercY(minLat, zoom);
  const cx = (dataMinMx + dataMaxMx) / 2;
  const cy = (dataMinMy + dataMaxMy) / 2;
  const view = { zoom, minMx: cx - SVG_W / 2, maxMx: cx + SVG_W / 2, minMy: cy - SVG_H / 2, maxMy: cy + SVG_H / 2 };

  const project = (lat: number, lon: number) => ({
    x: ((lonToMercX(lon, view.zoom) - view.minMx) / (view.maxMx - view.minMx)) * SVG_W,
    y: ((latToMercY(lat, view.zoom) - view.minMy) / (view.maxMy - view.minMy)) * SVG_H,
  });

  // Render Carto Voyager tiles (more colourful, reads well as a route map background).
  const tileXMin = Math.floor(view.minMx / TILE_SIZE);
  const tileXMax = Math.floor(view.maxMx / TILE_SIZE);
  const tileYMin = Math.floor(view.minMy / TILE_SIZE);
  const tileYMax = Math.floor(view.maxMy / TILE_SIZE);
  const worldTiles = Math.pow(2, view.zoom);
  const subdomains = ['a', 'b', 'c', 'd'];
  const tiles: React.ReactNode[] = [];
  for (let tx = tileXMin; tx <= tileXMax; tx++) {
    for (let ty = tileYMin; ty <= tileYMax; ty++) {
      if (ty < 0 || ty >= worldTiles) continue;
      const wrappedTx = ((tx % worldTiles) + worldTiles) % worldTiles;
      const sub = subdomains[(tx + ty) % subdomains.length];
      const url = `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${view.zoom}/${wrappedTx}/${ty}.png`;
      const tileMx = tx * TILE_SIZE;
      const tileMy = ty * TILE_SIZE;
      const x = ((tileMx - view.minMx) / (view.maxMx - view.minMx)) * SVG_W;
      const y = ((tileMy - view.minMy) / (view.maxMy - view.minMy)) * SVG_H;
      const w = (TILE_SIZE / (view.maxMx - view.minMx)) * SVG_W;
      const h = (TILE_SIZE / (view.maxMy - view.minMy)) * SVG_H;
      tiles.push(<image key={`${tx},${ty}`} href={url} x={x} y={y} width={w + 0.5} height={h + 0.5} preserveAspectRatio="none" />);
    }
  }

  const pathPoints = routeNodes.map((n) => project(n.lat!, n.lon!));
  const pathStr = pathPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // Cumulative distance label per leg
  function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(b.lat - a.lat); const dLon = toRad(b.lon - a.lon);
    const sinDLat = Math.sin(dLat / 2); const sinDLon = Math.sin(dLon / 2);
    const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLon * sinDLon;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '12 / 7', background: 'var(--bg)', borderRadius: 6, overflow: 'hidden' }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`} preserveAspectRatio="xMidYMid meet">
        {tiles}
        {/* Polyline through route */}
        <path d={pathStr} stroke="#5cc8ff" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
        {/* Mid-leg distance labels */}
        {pathPoints.slice(0, -1).map((p, i) => {
          const a = routeNodes[i], b = routeNodes[i + 1];
          const d = haversineKm({ lat: a.lat!, lon: a.lon! }, { lat: b.lat!, lon: b.lon! });
          const mid = { x: (p.x + pathPoints[i + 1].x) / 2, y: (p.y + pathPoints[i + 1].y) / 2 };
          const label = d < 1 ? `${(d * 1000).toFixed(0)}m` : `${d.toFixed(1)}km`;
          return (
            <text key={`leg-${i}`} x={mid.x} y={mid.y - 6} textAnchor="middle" fontSize={11} fill="#e6e8ee" stroke="rgba(0,0,0,0.75)" strokeWidth={2.5} paintOrder="stroke fill" fontFamily="ui-monospace, Menlo, monospace">{label}</text>
          );
        })}
        {/* Node markers */}
        {pathPoints.map((p, i) => {
          const isFirst = i === 0, isLast = i === pathPoints.length - 1;
          const fill = isFirst ? '#5cc8ff' : isLast ? '#66d39a' : '#ffd166';
          return (
            <g key={`node-${i}`}>
              <circle cx={p.x} cy={p.y} r={10} fill={fill} stroke="rgba(0,0,0,0.7)" strokeWidth={1.5} />
              <text x={p.x} y={p.y - 14} textAnchor="middle" fontSize={12} fill="#e6e8ee" stroke="rgba(0,0,0,0.75)" strokeWidth={2.5} paintOrder="stroke fill" fontFamily="ui-monospace, Menlo, monospace">
                {routeNodes[i].shortName || shortHex(routeNodes[i].num)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TraceCard — shared component for Run + History
// ─────────────────────────────────────────────────────────────────────

function TraceCard({ record, nodes, myNum, onMessageNode, compact = false }: { record: TracerouteRecord; nodes: NodeRecord[]; myNum?: number; onMessageNode?: (num: number) => void; compact?: boolean }) {
  const targetName = nameFor(nodes, record.to);
  const elapsed = record.response ? ((record.response.receivedAt - record.sentAt) / 1000).toFixed(2) + 's' : '…';

  const chain: { id: number; label: string }[] = [];
  if (myNum) chain.push({ id: myNum, label: 'me' });
  if (record.response) {
    for (const id of record.response.route) chain.push({ id, label: nameFor(nodes, id) });
    chain.push({ id: record.to, label: targetName });
  }

  return (
    <div style={{ padding: 10, border: '1px solid var(--line)', borderRadius: 6, marginBottom: 8, background: 'var(--bg-elev-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div>
          <strong style={{ color: colorForNode(record.to) }}>{targetName}</strong>
          <span style={{ color: 'var(--text-faint)', marginLeft: 8, fontFamily: 'var(--mono)', fontSize: 11 }}>{nodeIdHex(record.to)}</span>
          {!compact && <span style={{ color: 'var(--text-faint)', marginLeft: 8, fontSize: 11 }}>{new Date(record.sentAt).toLocaleString()}</span>}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: record.response ? 'var(--good)' : 'var(--warn)' }}>
          {record.response ? `${elapsed} · RSSI ${record.response.rxRssi} · SNR ${record.response.rxSnr.toFixed(1)}` : 'awaiting response…'}
        </div>
      </div>
      {record.response ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 12.5 }}>
          {chain.map((hop, i) => (
            <React.Fragment key={i}>
              <button
                className="prop-node"
                onClick={() => onMessageNode && hop.id !== myNum && onMessageNode(hop.id)}
                disabled={hop.id === myNum || !onMessageNode}
                title={hop.id === myNum ? 'this is you' : onMessageNode ? `Message ${hop.label}` : ''}
                style={{
                  cursor: hop.id === myNum || !onMessageNode ? 'default' : 'pointer',
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                }}
              >
                <span style={{
                  padding: '3px 8px',
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  color: i === 0 ? 'var(--accent)' : i === chain.length - 1 ? 'var(--good)' : 'var(--text)',
                  display: 'inline-block',
                }}>
                  {hop.label}
                </span>
              </button>
              {i < chain.length - 1 && <span style={{ color: 'var(--text-faint)' }}>→</span>}
            </React.Fragment>
          ))}
          <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', fontSize: 11 }}>
            hop {record.response.hopStart - record.response.hopLimit}/{record.response.hopStart}
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
          sent at {new Date(record.sentAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sparkline + helpers
// ─────────────────────────────────────────────────────────────────────

function Sparkline({ title, series, yMax, yLabel, color }: { title: string; series: Array<{ ts: number; v: number }>; yMax: number; yLabel: string; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    drawSpark(ctx, c.width, c.height, series, yMax, yLabel, color);
  }, [series, yMax, color]);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{title}</div>
      <canvas ref={canvasRef} width={900} height={90} style={{ width: '100%', height: 90, display: 'block', background: 'var(--bg)', borderRadius: 4 }} />
    </div>
  );
}

function drawSpark(ctx: CanvasRenderingContext2D, w: number, h: number, series: Array<{ ts: number; v: number }>, yMax: number, yLabel: string, color: string): void {
  ctx.clearRect(0, 0, w, h);
  const padL = 36, padR = 8, padT = 6, padB = 14;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  if (series.length < 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '11px ui-monospace';
    ctx.fillText('not enough samples', padL, h / 2);
    return;
  }
  const minT = series[0].ts, maxT = series[series.length - 1].ts;
  const tSpan = Math.max(1, maxT - minT);
  const xScale = (t: number) => padL + ((t - minT) / tSpan) * plotW;
  const yScale = (v: number) => padT + (1 - v / yMax) * plotH;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px ui-monospace';
  for (const v of [0, yMax / 2, yMax]) {
    const y = yScale(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
    ctx.fillText(`${v.toFixed(v < 10 ? 1 : 0)}${yLabel}`, 4, y + 3);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.6;
  ctx.beginPath();
  series.forEach((p, i) => {
    const x = xScale(p.ts), y = yScale(p.v);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  // Dots on each sample
  ctx.fillStyle = color;
  for (const p of series) {
    ctx.beginPath();
    ctx.arc(xScale(p.ts), yScale(p.v), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function Metric({ label, value, tone, hint }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'dim'; hint?: string }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : tone === 'dim' ? 'var(--text-faint)' : 'var(--text)';
  return (
    <div className="range-card">
      <div className="label">{label}</div>
      <div className="value" style={{ color }}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function timeAgoSec(sec: number): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
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
