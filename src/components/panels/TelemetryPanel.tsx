import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { UtilPoint } from '../../hooks/useMesh';
import { PanelChannelHeader } from '../PanelChannelHeader';
import { Subnav } from '../Subnav';
import { downloadCsv } from '../../lib/csv';
import {
  nodeDisplayName as nameFor,
  nodeShortHex as shortHex,
  nodeColor as colorForNode,
} from '../../lib/node-identity';

interface Props {
  nodes: NodeRecord[];
  utilHistory: UtilPoint[];
  state: ConnectionState;
  onMessageNode?: (num: number) => void;
}

type Tab = 'chan' | 'battery' | 'airtime' | 'pernode';
type Scale = '1h' | '6h' | '24h' | '7d' | 'all';

const SCALE_MS: Record<Scale, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  'all': 365 * 24 * 60 * 60 * 1000,
};

const CONGESTION_THRESHOLD = 25; // % channel utilization

// nameFor / shortHex / colorForNode are imported from ../../lib/node-identity
// (aliased above) so node naming + per-node color stay consistent app-wide.

function batteryClass(b: number): string {
  if (b > 50) return 'good';
  if (b > 20) return 'warn';
  return 'bad';
}

export function TelemetryPanel({ nodes, utilHistory, state, onMessageNode }: Props) {
  const [tab, setTab] = useState<Tab>('chan');
  const [scale, setScale] = useState<Scale>('6h');
  const [history, setHistory] = useState<TelemetryHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch from DB whenever the time-scale changes (and once on mount).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const since = Date.now() - SCALE_MS[scale];
    window.mesh.telemetryHistory({ sinceMs: since }).then((rows) => {
      if (!cancelled) {
        setHistory(rows);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [scale]);

  // Keep history in sync with live samples that arrive via utilHistory.
  // (The hook already updates utilHistory in memory; we merge by reloading
  // periodically — cheap because samples land at ~minute cadence.)
  useEffect(() => {
    if (utilHistory.length === 0) return;
    const last = utilHistory[utilHistory.length - 1];
    setHistory((prev) => {
      const exists = prev.some((r) => r.node_num === last.nodeId && r.ts === last.t);
      if (exists) return prev;
      return [...prev, {
        node_num: last.nodeId, battery: 0, voltage: 0,
        chan_util: last.chanUtil, air_util_tx: last.airUtilTx, ts: last.t,
      }];
    });
  }, [utilHistory]);

  // Low-battery nodes (<20%, excluding unreported 0%), worst first. Surfaced
  // as a panel-wide banner so it's visible from every sub-tab, not just Battery.
  const lowBattery = useMemo(
    () => nodes
      .filter((n) => n.batteryLevel !== undefined && n.batteryLevel > 0 && n.batteryLevel < 20)
      .sort((a, b) => (a.batteryLevel ?? 0) - (b.batteryLevel ?? 0)),
    [nodes],
  );

  // Master/detail: any tab can open a node's full telemetry in a slide-in
  // drawer (legend chip, battery row, air-time row). null = closed.
  const [drawerNum, setDrawerNum] = useState<number | null>(null);
  const drawerNode = drawerNum != null ? nodes.find((n) => n.num === drawerNum) ?? null : null;
  const drawerHistory = useMemo(
    () => history.filter((r) => r.node_num === drawerNum).sort((a, b) => a.ts - b.ts),
    [history, drawerNum],
  );

  return (
    <div className="page">
      <h1 className="page-title">Telemetry</h1>
      <p className="page-sub">
        Mesh health: how saturated the airwaves are, how much battery each node has, how much airtime each node is using. Telemetry packets arrive on port 67, typically every 15–30 minutes per node.
      </p>

      <PanelChannelHeader state={state} label="TELEMETRY FROM" />

      {lowBattery.length > 0 && (
        <LowBatteryBanner nodes={lowBattery} onMessageNode={onMessageNode} />
      )}

      <Subnav
        items={[
          { key: 'chan', label: 'Channel util' },
          { key: 'battery', label: 'Battery & power', count: lowBattery.length },
          { key: 'airtime', label: 'Air time' },
          { key: 'pernode', label: 'Per-node' },
        ]}
        active={tab}
        onChange={setTab}
        trailing={
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <ScalePicker scale={scale} setScale={setScale} />
            {loading && <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>loading…</span>}
          </div>
        }
      />

      {tab === 'chan' && <ChannelUtilTab nodes={nodes} history={history} scale={scale} onSelectNode={setDrawerNum} />}
      {tab === 'battery' && <BatteryTab nodes={nodes} history={history} scale={scale} onMessageNode={onMessageNode} onSelectNode={setDrawerNum} />}
      {tab === 'airtime' && <AirtimeTab nodes={nodes} history={history} scale={scale} regionName={state.loraConfig?.regionName} onSelectNode={setDrawerNum} />}
      {tab === 'pernode' && <PerNodeTab nodes={nodes} history={history} scale={scale} state={state} onMessageNode={onMessageNode} />}

      {drawerNode && (
        <NodeDetailDrawer
          node={drawerNode}
          nodeHistory={drawerHistory}
          scale={scale}
          state={state}
          onMessageNode={onMessageNode}
          onClose={() => setDrawerNum(null)}
        />
      )}
    </div>
  );
}

// Panel-wide alert for nodes that have dropped below 20% battery. Each node
// is a clickable chip that opens a message to it (so you can tell whoever owns
// it to go swap/charge). Hidden entirely when nothing is low.
function LowBatteryBanner({ nodes, onMessageNode }: { nodes: NodeRecord[]; onMessageNode?: (n: number) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
      margin: '0 0 12px', padding: '8px 12px', borderRadius: 4,
      borderLeft: '3px solid #ff6b81', background: 'rgba(255,107,129,0.08)',
      fontSize: 13,
    }}>
      <span style={{ fontWeight: 600 }}>🪫 Low battery</span>
      <span style={{ color: 'var(--text-dim)' }}>
        {nodes.length} node{nodes.length === 1 ? '' : 's'} below 20%:
      </span>
      {nodes.map((n) => (
        <button
          key={n.num}
          onClick={() => onMessageNode?.(n.num)}
          title={onMessageNode ? `Message ${nameFor([n], n.num)}` : undefined}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            border: '1px solid var(--line)', borderRadius: 12,
            background: 'var(--bg-elev-2)', color: 'var(--text)',
            padding: '2px 9px', fontSize: 12, fontFamily: 'inherit',
            cursor: onMessageNode ? 'pointer' : 'default',
          }}
        >
          <span style={{ color: colorForNode(n.num) }}>{n.shortName || shortHex(n.num)}</span>
          <span style={{ fontFamily: 'var(--mono)', color: '#ff6b81' }}>{n.batteryLevel}%</span>
        </button>
      ))}
    </div>
  );
}

function ScalePicker({ scale, setScale }: { scale: Scale; setScale: (s: Scale) => void }) {
  return (
    <div className="map-style-toggle">
      {(['1h', '6h', '24h', '7d', 'all'] as const).map((s) => (
        <button key={s} className={'map-style-btn' + (scale === s ? ' active' : '')} onClick={() => setScale(s)}>{s}</button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tab 1: Channel utilization
// ─────────────────────────────────────────────────────────────────────

function ChannelUtilTab({ nodes, history, scale, onSelectNode }: { nodes: NodeRecord[]; history: TelemetryHistoryRow[]; scale: Scale; onSelectNode: (n: number) => void }) {
  // Compute mesh-wide stats over the window, including the distribution
  // percentiles so the diagnostic can say where "now" sits historically.
  const stats = useMemo(() => {
    const chanVals = history.map((r) => r.chan_util).filter((x) => typeof x === 'number' && x > 0).sort((a, b) => a - b);
    const n = chanVals.length;
    if (n === 0) return null;
    const avg = chanVals.reduce((a, b) => a + b, 0) / n;
    const overThreshold = chanVals.filter((v) => v >= CONGESTION_THRESHOLD).length;
    const q = (p: number) => chanVals[Math.min(n - 1, Math.floor(p * (n - 1)))];
    return { avg, peak: chanVals[n - 1], overThresholdPct: (overThreshold / n) * 100, count: n, p50: q(0.5), p90: q(0.9), vals: chanVals };
  }, [history]);

  const currentChan = useMemo(() => {
    const vals = nodes.map((n) => n.channelUtilization).filter((x): x is number => typeof x === 'number' && x > 0);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [nodes]);

  // Where the current reading sits in the window's distribution (0–100).
  const currentRank = useMemo(() => {
    if (currentChan == null || !stats) return null;
    const below = stats.vals.filter((v) => v <= currentChan).length;
    return (below / stats.vals.length) * 100;
  }, [currentChan, stats]);

  const exportCsv = () => downloadCsv(history.map((r) => ({
    ts_iso: new Date(r.ts).toISOString(),
    node: shortHex(r.node_num),
    chan_util_pct: r.chan_util.toFixed(2),
    air_util_tx_pct: r.air_util_tx.toFixed(2),
  })), `telemetry-chan-${scale}`);

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Channel utilization over {scale}</h2>
            {history.length > 0 && <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={exportCsv}>⇩ CSV</button>}
          </div>
          <MultiNodeChart
            history={history}
            field="chan_util"
            nodes={nodes}
            yMax={Math.max(50, Math.ceil((stats?.peak ?? 0) / 10) * 10)}
            yLabel="%"
            thresholdY={CONGESTION_THRESHOLD}
            thresholdLabel="25% congestion"
          />
          {history.length === 0 && (
            <div className="empty">No telemetry samples in this window. Telemetry packets typically arrive every 15–30 minutes per node.</div>
          )}
          <ChartLegend history={history} field="chan_util" nodes={nodes} onSelect={onSelectNode} />
        </div>

        <div className="range-grid">
          <Metric label="Current avg" value={currentChan != null ? `${currentChan.toFixed(1)}%` : '—'} tone={currentChan != null && currentChan >= CONGESTION_THRESHOLD ? 'bad' : 'good'} />
          <Metric label={`Avg over ${scale}`} value={stats ? `${stats.avg.toFixed(1)}%` : '—'} />
          <Metric label={`Peak over ${scale}`} value={stats ? `${stats.peak.toFixed(1)}%` : '—'} tone={stats && stats.peak >= 50 ? 'bad' : stats && stats.peak >= CONGESTION_THRESHOLD ? 'warn' : 'good'} />
          <Metric label={`Time over ${CONGESTION_THRESHOLD}%`} value={stats ? `${stats.overThresholdPct.toFixed(0)}%` : '—'} tone={stats && stats.overThresholdPct > 10 ? 'bad' : 'good'} hint={stats ? `${stats.count} samples` : ''} />
        </div>
      </div>

      <div>
        <CongestionDiagnostic stats={stats} currentChan={currentChan} currentRank={currentRank} scale={scale} />
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What "channel utilization" actually is.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Every Meshtastic node tracks what fraction of recent airtime had detectable LoRa energy on its channel. It's a mesh-wide statistic (one node measures, all nodes broadcast their measurement). Above ~25% you start getting collisions because acks can't squeeze through. Above 50% the network falls off a cliff — packets retransmit, retransmit again, retransmit again, and every node burns battery on each repeat.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What to do if congested.</strong></p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12.5, color: 'var(--text-dim)' }}>
            <li>Switch to a faster preset (ShortFast → 10× the throughput of LongFast)</li>
            <li>Reduce hop limit so packets don't bounce as far</li>
            <li>Find and silence chatty sensor nodes (Per-node tab → sort by air util)</li>
            <li>Move noisy traffic to a secondary channel</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function CongestionDiagnostic({ stats, currentChan, currentRank, scale }: {
  stats: { avg: number; peak: number; overThresholdPct: number; count: number; p50: number; p90: number } | null;
  currentChan: number | null;
  currentRank: number | null;
  scale: Scale;
}) {
  let tone: 'good' | 'warn' | 'bad' = 'good';
  let headline = 'Mesh is healthy.';
  let detail = 'Channel utilization is comfortably below the 25% congestion threshold.';

  if (stats === null && currentChan === null) {
    tone = 'warn';
    headline = 'No telemetry yet.';
    detail = 'Most nodes broadcast telemetry every 15–30 minutes. Give it time, or check the Nodes panel to see if any node is reporting metrics at all.';
  } else if ((currentChan ?? 0) >= 50 || (stats?.peak ?? 0) >= 50) {
    tone = 'bad';
    headline = 'Mesh is saturated.';
    detail = 'Channel utilization is at or above 50% — acks aren\'t getting through, packets are colliding, every node is burning battery on retransmissions. Reduce traffic immediately or switch to a faster preset.';
  } else if ((currentChan ?? 0) >= CONGESTION_THRESHOLD || (stats?.overThresholdPct ?? 0) > 30) {
    tone = 'warn';
    headline = 'Mesh is congested.';
    detail = `Channel utilization is in the 25–50% range. DMs may need multiple resends to deliver. Consider reducing hop limit, finding chatty nodes, or switching to a faster preset.`;
  }

  const colorVar = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : 'var(--bad)';

  return (
    <div className="info-card" style={{ borderLeftColor: colorVar }}>
      <p style={{ margin: 0, fontWeight: 500 }}>{headline}</p>
      <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-dim)' }}>{detail}</p>
      {stats && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
          {currentChan != null && currentRank != null
            ? `Right now ${currentChan.toFixed(1)}% — higher than ${Math.round(currentRank)}% of readings over the last ${scale}. `
            : ''}
          Median {stats.p50.toFixed(1)}%, p90 {stats.p90.toFixed(1)}%, peak {stats.peak.toFixed(1)}% ({stats.count} sample{stats.count === 1 ? '' : 's'}).
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tab 2: Battery & power
// ─────────────────────────────────────────────────────────────────────

function BatteryTab({ nodes, history, scale, onMessageNode, onSelectNode }: { nodes: NodeRecord[]; history: TelemetryHistoryRow[]; scale: Scale; onMessageNode?: (n: number) => void; onSelectNode: (n: number) => void }) {
  const withBattery = useMemo(() => nodes.filter((n) => n.batteryLevel !== undefined).sort((a, b) => (a.batteryLevel ?? 0) - (b.batteryLevel ?? 0)), [nodes]);
  const lowBattery = withBattery.filter((n) => (n.batteryLevel ?? 100) < 20);

  // Per-node voltage change across the window (last − first sample). Surfaces
  // draining battery nodes and solar nodes whose panel isn't keeping up.
  const vTrend = useMemo(() => {
    const byNode = new Map<number, { ts: number; v: number }[]>();
    for (const r of history) {
      if (r.voltage > 0) (byNode.get(r.node_num) ?? byNode.set(r.node_num, []).get(r.node_num)!).push({ ts: r.ts, v: r.voltage });
    }
    const out = new Map<number, number>();
    for (const [num, arr] of byNode) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => a.ts - b.ts);
      out.set(num, arr[arr.length - 1].v - arr[0].v);
    }
    return out;
  }, [history]);

  // Nodes that dropped a meaningful amount of voltage over the window, worst first.
  const declining = useMemo(
    () => [...vTrend.entries()].filter(([, d]) => d <= -0.15).sort((a, b) => a[1] - b[1]),
    [vTrend],
  );

  const exportCsv = () => downloadCsv(history.filter((r) => r.battery > 0).map((r) => ({
    ts_iso: new Date(r.ts).toISOString(),
    node: shortHex(r.node_num),
    short_name: nameFor(nodes, r.node_num),
    battery_pct: r.battery.toString(),
    voltage_v: r.voltage.toFixed(2),
  })), `telemetry-battery-${scale}`);

  return (
    <div className="layout-split-wide">
      <div>
        {lowBattery.length > 0 && (
          <div className="info-card" style={{ borderLeftColor: 'var(--bad)' }}>
            <p style={{ margin: 0, fontWeight: 500 }}>{lowBattery.length} node{lowBattery.length === 1 ? '' : 's'} under 20% battery</p>
            <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12.5, color: 'var(--text-dim)' }}>
              {lowBattery.map((n) => (
                <li key={n.num}>
                  <span style={{ color: colorForNode(n.num) }}>{n.shortName || shortHex(n.num)}</span> — {n.batteryLevel}%
                  {n.voltage !== undefined && <> · {n.voltage.toFixed(2)} V</>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Battery across the mesh</h2>
            {history.length > 0 && <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={exportCsv}>⇩ CSV</button>}
          </div>
          {withBattery.length === 0 ? (
            <div className="empty">No battery telemetry yet. Most nodes report every 15–30 minutes.</div>
          ) : (
            <table className="data">
              <thead><tr><th>Node</th><th>Battery</th><th>Voltage</th><th>Channel util</th><th>Air util TX</th><th></th></tr></thead>
              <tbody>
                {withBattery.map((n) => (
                  <tr key={n.num} style={{ opacity: 1 }}>
                    <td>
                      <button className="linkish" style={{ color: colorForNode(n.num) }} onClick={() => onSelectNode(n.num)} title="Open telemetry detail">
                        {n.shortName || shortHex(n.num)}
                      </button>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className={`bar ${batteryClass(n.batteryLevel ?? 0)}`} style={{ display: 'inline-block', width: 60 }}>
                          <div style={{ width: `${Math.min(100, n.batteryLevel ?? 0)}%` }} />
                        </span>
                        {n.batteryLevel}%
                      </span>
                    </td>
                    <td>
                      {n.voltage !== undefined ? `${n.voltage.toFixed(2)} V` : '—'}
                      <VoltageTrend delta={vTrend.get(n.num)} />
                    </td>
                    <td>{n.channelUtilization !== undefined ? `${n.channelUtilization.toFixed(1)}%` : '—'}</td>
                    <td>{n.airUtilTx !== undefined ? `${n.airUtilTx.toFixed(2)}%` : '—'}</td>
                    <td>{onMessageNode && (
                      <button className="primary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => onMessageNode(n.num)}>Message</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div>
        {declining.length > 0 && (
          <div className="info-card" style={{ borderLeftColor: 'var(--warn)' }}>
            <p style={{ margin: 0, fontWeight: 500 }}>{declining.length} node{declining.length === 1 ? '' : 's'} losing voltage over {scale}</p>
            <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12.5, color: 'var(--text-dim)' }}>
              {declining.slice(0, 6).map(([num, d]) => (
                <li key={num}>
                  <span style={{ color: colorForNode(num) }}>{nameFor(nodes, num)}</span> — {d.toFixed(2)} V
                </li>
              ))}
            </ul>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
              Expected for a draining battery node. For a solar node, a sustained daytime drop means the panel isn't keeping up — check placement and shading.
            </p>
          </div>
        )}
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Why batteries die faster than expected.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Idle RX listens at ~10–30 mA. Each TX burst is 100–150 mA at 17 dBm, ~600 ms in air for LongFast. A node that flood-rebroadcasts everything in a busy area can use 5–10× more power than one in a quiet rural mesh. ESP32 boards eat ~90 mA just keeping WiFi/BT stacks alive — disable both for solar/battery deployments (Settings → Network → WiFi off).
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Reading the voltage.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            A typical 1S lithium battery is 4.2 V full → 3.3 V empty. Below 3.5 V the battery percentage gets unreliable. Solar nodes often oscillate between 3.7–4.1 V daily.
          </p>
        </div>
      </div>
    </div>
  );
}

// Inline voltage-trend chip: arrow + signed delta, green rising / amber
// falling. Hidden for negligible change (< 0.05 V) or too few samples.
function VoltageTrend({ delta }: { delta?: number }) {
  if (delta === undefined || Math.abs(delta) < 0.05) return null;
  const up = delta > 0;
  return (
    <span
      style={{ marginLeft: 6, fontSize: 11, fontFamily: 'var(--mono)', color: up ? 'var(--good)' : 'var(--warn)' }}
      title={`${up ? 'Rising' : 'Falling'} over the window`}
    >
      {up ? '↑' : '↓'}{delta > 0 ? '+' : ''}{delta.toFixed(2)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tab 3: Air time
// ─────────────────────────────────────────────────────────────────────

function AirtimeTab({ nodes, history, scale, regionName, onSelectNode }: { nodes: NodeRecord[]; history: TelemetryHistoryRow[]; scale: Scale; regionName?: string; onSelectNode: (n: number) => void }) {
  // Ranking: most recent air util per node.
  const ranked = useMemo(() => {
    const latest = new Map<number, number>();
    for (const r of history) {
      if (!latest.has(r.node_num) || r.ts > 0) latest.set(r.node_num, r.air_util_tx);
    }
    const arr = Array.from(latest.entries()).map(([num, v]) => ({ num, air: v, name: nameFor(nodes, num) }));
    arr.sort((a, b) => b.air - a.air);
    return arr;
  }, [history, nodes]);

  const isEU = regionName?.startsWith('EU') ?? false;
  const dutyCycleCap = isEU ? 1 : 100; // EU868 = 1%; US = effectively uncapped at the regulatory layer
  const exceedingCap = ranked.filter((r) => r.air > dutyCycleCap);

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Air util TX over {scale}</h2>
          </div>
          <MultiNodeChart
            history={history}
            field="air_util_tx"
            nodes={nodes}
            yMax={Math.max(5, Math.ceil(Math.max(...history.map((r) => r.air_util_tx)) / 5) * 5)}
            yLabel="%"
            thresholdY={isEU ? 1 : undefined}
            thresholdLabel={isEU ? 'EU 1% cap' : undefined}
          />
          <ChartLegend history={history} field="air_util_tx" nodes={nodes} onSelect={onSelectNode} />
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Who's transmitting the most</h2>
          {ranked.length === 0 ? (
            <div className="empty">No air-time telemetry in this window.</div>
          ) : (
            <table className="data">
              <thead><tr><th>Node</th><th>Latest air util TX</th><th></th></tr></thead>
              <tbody>
                {ranked.slice(0, 20).map((r) => (
                  <tr key={r.num}>
                    <td>
                      <button className="linkish" style={{ color: colorForNode(r.num) }} onClick={() => onSelectNode(r.num)} title="Open telemetry detail">
                        {r.name}
                      </button>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className={`bar ${r.air > dutyCycleCap ? 'bad' : r.air > dutyCycleCap * 0.5 ? 'warn' : 'good'}`} style={{ display: 'inline-block', width: 80 }}>
                          <div style={{ width: `${Math.min(100, (r.air / Math.max(1, dutyCycleCap * 2)) * 100)}%` }} />
                        </span>
                        {r.air.toFixed(2)}%
                      </span>
                    </td>
                    <td style={{ color: r.air > dutyCycleCap ? 'var(--bad)' : 'var(--text-faint)', fontSize: 11.5 }}>
                      {r.air > dutyCycleCap ? `exceeds ${dutyCycleCap}% cap` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div>
        <div className="info-card" style={{ borderLeftColor: isEU ? 'var(--warn)' : 'var(--accent)' }}>
          <p style={{ margin: 0 }}><strong>{isEU ? 'EU868 duty-cycle cap: 1%' : 'No regulatory duty cycle on US 902–928 MHz'}</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            {isEU
              ? 'European 868 MHz devices are legally limited to 1% airtime per hour on most sub-bands — that\'s 36 seconds of TX every 60 minutes. Exceeding this is a regulatory violation. If a node here is above 1%, either it\'s misconfigured or the firmware is intentionally overriding duty cycle.'
              : 'US LoRa devices can transmit indefinitely on 902–928 MHz under FCC Part 15 rules. The practical limit becomes channel utilization (collisions), not regulation.'}
          </p>
        </div>

        {exceedingCap.length > 0 && (
          <div className="info-card" style={{ borderLeftColor: 'var(--bad)' }}>
            <p style={{ margin: 0 }}><strong>{exceedingCap.length} node{exceedingCap.length === 1 ? '' : 's'} over {dutyCycleCap}% cap.</strong></p>
            <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
              These nodes are consuming a disproportionate share of channel time. If they're yours, look at telemetry interval, position-broadcast interval, and whether the role is correct (a CLIENT shouldn't be transmitting as much as a ROUTER).
            </p>
          </div>
        )}

        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What pumps air util TX up.</strong></p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12.5, color: 'var(--text-dim)' }}>
            <li>Frequent telemetry broadcasts (default 30 min — Settings → Device)</li>
            <li>Frequent position broadcasts (default 15 min — Settings → Position)</li>
            <li>NodeInfo broadcasts (default 3 hours)</li>
            <li>Rebroadcasting every packet because role = ROUTER on a busy mesh</li>
            <li>Chat traffic from connected clients</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tab 4: Per-node detail
// ─────────────────────────────────────────────────────────────────────

function PerNodeTab({ nodes, history, scale, state, onMessageNode }: { nodes: NodeRecord[]; history: TelemetryHistoryRow[]; scale: Scale; state: ConnectionState; onMessageNode?: (n: number) => void }) {
  const reporting = useMemo(() => {
    const ids = new Set(history.map((r) => r.node_num));
    return nodes.filter((n) => ids.has(n.num)).sort((a, b) => (b.lastHeard ?? 0) - (a.lastHeard ?? 0));
  }, [history, nodes]);

  const [selectedNum, setSelectedNum] = useState<number | null>(null);
  const active = selectedNum ?? reporting[0]?.num ?? null;
  const node = active != null ? nodes.find((n) => n.num === active) : null;
  const nodeHistory = useMemo(() => history.filter((r) => r.node_num === active).sort((a, b) => a.ts - b.ts), [history, active]);

  if (reporting.length === 0) {
    return (
      <div className="card">
        <div className="empty">No telemetry from any node in this window. Widen the time range or wait for the next broadcast.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16 }}>
      <div className="card" style={{ padding: 6 }}>
        <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 8px' }}>
          Nodes reporting ({reporting.length})
        </div>
        {reporting.map((n) => (
          <button
            key={n.num}
            className={'convo-item' + (active === n.num ? ' active' : '')}
            onClick={() => setSelectedNum(n.num)}
          >
            <div className="convo-row">
              <span className="convo-label" style={{ color: colorForNode(n.num) }}>{n.shortName || shortHex(n.num)}</span>
            </div>
            <div className="convo-preview">
              {n.batteryLevel !== undefined ? `${n.batteryLevel}% · ` : ''}
              {n.voltage !== undefined ? `${n.voltage.toFixed(2)}V · ` : ''}
              {n.airUtilTx !== undefined ? `${n.airUtilTx.toFixed(2)}% air` : ''}
            </div>
          </button>
        ))}
      </div>

      {node && (
        <div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div>
                <h2 style={{ margin: 0 }}>{node.longName || node.shortName || shortHex(node.num)}</h2>
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                  {shortHex(node.num)} · {nodeHistory.length} sample{nodeHistory.length === 1 ? '' : 's'} over {scale}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => exportNodeCsv(node, nodeHistory, scale)}>⇩ CSV</button>
                {onMessageNode && state.myInfo?.myNodeNum !== node.num && (
                  <button className="primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onMessageNode(node.num)}>Message</button>
                )}
              </div>
            </div>

            <NodeTelemetryBody node={node} nodeHistory={nodeHistory} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared node-detail pieces (Per-node tab + slide-in drawer)
// ─────────────────────────────────────────────────────────────────────

/** Export one node's telemetry history as CSV. */
function exportNodeCsv(node: NodeRecord, nodeHistory: TelemetryHistoryRow[], scale: Scale): void {
  downloadCsv(nodeHistory.map((r) => ({
    ts_iso: new Date(r.ts).toISOString(),
    battery_pct: r.battery.toString(),
    voltage_v: r.voltage.toFixed(2),
    chan_util_pct: r.chan_util.toFixed(2),
    air_util_tx_pct: r.air_util_tx.toFixed(2),
  })), `telemetry-${node.shortName || shortHex(node.num)}-${scale}`);
}

/** Last-known metric grid + per-metric history sparklines for one node.
 *  Shared verbatim by the Per-node tab and the detail drawer. */
function NodeTelemetryBody({ node, nodeHistory }: { node: NodeRecord; nodeHistory: TelemetryHistoryRow[] }) {
  return (
    <>
      <div className="range-grid" style={{ marginBottom: 12 }}>
        <Metric label="Battery" value={node.batteryLevel !== undefined ? `${node.batteryLevel}%` : '—'} tone={node.batteryLevel === undefined ? 'dim' : node.batteryLevel > 50 ? 'good' : node.batteryLevel > 20 ? 'warn' : 'bad'} />
        <Metric label="Voltage" value={node.voltage !== undefined ? `${node.voltage.toFixed(2)} V` : '—'} />
        <Metric label="Channel util" value={node.channelUtilization !== undefined ? `${node.channelUtilization.toFixed(1)}%` : '—'} tone={node.channelUtilization !== undefined && node.channelUtilization >= CONGESTION_THRESHOLD ? 'warn' : 'good'} />
        <Metric label="Air util TX" value={node.airUtilTx !== undefined ? `${node.airUtilTx.toFixed(2)}%` : '—'} />
      </div>
      <SingleNodeChart history={nodeHistory} field="battery" yMax={100} yLabel="%" title="Battery" color="#66d39a" />
      <SingleNodeChart history={nodeHistory} field="voltage" yMax={4.5} yLabel="V" title="Voltage" color="#ffb86b" />
      <SingleNodeChart history={nodeHistory} field="chan_util" yMax={50} yLabel="%" title="Channel utilization" color="#5cc8ff" thresholdY={CONGESTION_THRESHOLD} />
      <SingleNodeChart history={nodeHistory} field="air_util_tx" yMax={5} yLabel="%" title="Air util TX" color="#c490ff" />
    </>
  );
}

/** Clickable per-node legend under a multi-node chart. Lists every node with
 *  at least one positive sample for `field`, color-matched to its chart line;
 *  clicking opens that node's detail drawer. */
function ChartLegend({ history, field, nodes, onSelect }: {
  history: TelemetryHistoryRow[];
  field: 'chan_util' | 'air_util_tx';
  nodes: NodeRecord[];
  onSelect: (n: number) => void;
}) {
  const present = useMemo(() => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const r of history) {
      if ((r[field] as number) > 0 && !seen.has(r.node_num)) { seen.add(r.node_num); out.push(r.node_num); }
    }
    return out;
  }, [history, field]);

  if (present.length === 0) return null;
  return (
    <div className="chart-legend">
      {present.map((num) => (
        <button key={num} className="legend-chip" onClick={() => onSelect(num)} title="Open telemetry detail">
          <span className="legend-dot" style={{ background: colorForNode(num) }} />
          {nameFor(nodes, num)}
        </button>
      ))}
    </div>
  );
}

/** Slide-in detail drawer: full per-metric history + last-known values for one
 *  node, openable from any tab. Closes on scrim click, the × button, or Esc. */
function NodeDetailDrawer({ node, nodeHistory, scale, state, onMessageNode, onClose }: {
  node: NodeRecord;
  nodeHistory: TelemetryHistoryRow[];
  scale: Scale;
  state: ConnectionState;
  onMessageNode?: (n: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer-panel" role="dialog" aria-label="Node telemetry detail">
        <div className="drawer-head">
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>{node.longName || node.shortName || shortHex(node.num)}</h2>
            <div style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)', marginTop: 2 }}>
              {shortHex(node.num)} · {nodeHistory.length} sample{nodeHistory.length === 1 ? '' : 's'} over {scale}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => exportNodeCsv(node, nodeHistory, scale)}>⇩ CSV</button>
            {onMessageNode && state.myInfo?.myNodeNum !== node.num && (
              <button className="primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => { onMessageNode(node.num); onClose(); }}>Message</button>
            )}
            <button className="drawer-close" onClick={onClose} aria-label="Close" title="Close (Esc)">×</button>
          </div>
        </div>
        <div className="drawer-body">
          {nodeHistory.length === 0 ? (
            <div className="empty">No telemetry samples for this node in the current {scale} window. Widen the time range to see history.</div>
          ) : (
            <NodeTelemetryBody node={node} nodeHistory={nodeHistory} />
          )}
        </div>
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Multi-series canvas chart (one line per node)
// ─────────────────────────────────────────────────────────────────────

// Shared geometry so the canvas draw fn and the hover math agree on the plot box.
const MULTI_W = 1100, MULTI_H = 240;
const MULTI_PAD = { L: 50, R: 16, T: 16, B: 28 };

function MultiNodeChart({ history, field, nodes, yMax, yLabel, thresholdY, thresholdLabel }: {
  history: TelemetryHistoryRow[];
  field: 'chan_util' | 'air_util_tx';
  nodes: NodeRecord[];
  yMax: number;
  yLabel: string;
  thresholdY?: number;
  thresholdLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Hover cursor readout: the time under the pointer + each node's nearest value.
  const [hover, setHover] = useState<{ left: number; flip: boolean; t: number; rows: { num: number; name: string; value: number }[] } | null>(null);

  const [minT, maxT] = useMemo(() => {
    if (history.length === 0) return [0, 0];
    const ts = history.map((r) => r.ts);
    return [Math.min(...ts), Math.max(...ts)];
  }, [history]);

  // Per-node sorted samples (positive values only) — drives the hover tooltip.
  const byNode = useMemo(() => {
    const m = new Map<number, TelemetryHistoryRow[]>();
    for (const r of history) {
      if ((r[field] as number) <= 0) continue;
      (m.get(r.node_num) ?? m.set(r.node_num, []).get(r.node_num)!).push(r);
    }
    for (const rows of m.values()) rows.sort((a, b) => a.ts - b.ts);
    return m;
  }, [history, field]);

  const plotW = MULTI_W - MULTI_PAD.L - MULTI_PAD.R;
  const hoverX = hover ? MULTI_PAD.L + ((hover.t - minT) / Math.max(1, maxT - minT)) * plotW : undefined;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawMultiSeries(ctx, c.width, c.height, history, field, nodes, yMax, yLabel, thresholdY, thresholdLabel, hoverX);
  }, [history, field, yMax, thresholdY, hoverX]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c || history.length === 0) { return; }
    const rect = c.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const canvasX = (cssX / rect.width) * MULTI_W;
    if (canvasX < MULTI_PAD.L || canvasX > MULTI_PAD.L + plotW) { setHover(null); return; }
    const t = minT + ((canvasX - MULTI_PAD.L) / plotW) * Math.max(1, maxT - minT);
    const rows = [...byNode.entries()].map(([num, samples]) => {
      let best = samples[0], bestD = Infinity;
      for (const s of samples) { const d = Math.abs(s.ts - t); if (d < bestD) { bestD = d; best = s; } }
      return { num, name: nameFor(nodes, num), value: best[field] as number };
    }).sort((a, b) => b.value - a.value);
    setHover({ left: cssX, flip: canvasX > MULTI_PAD.L + plotW / 2, t, rows });
  };

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={MULTI_W}
        height={MULTI_H}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ width: '100%', height: MULTI_H, display: 'block', background: 'var(--bg)', borderRadius: 6, cursor: 'crosshair' }}
      />
      {hover && hover.rows.length > 0 && (
        <div
          style={{
            position: 'absolute', top: 8, pointerEvents: 'none', zIndex: 2,
            left: hover.left, transform: `translateX(${hover.flip ? 'calc(-100% - 12px)' : '12px'})`,
            background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6,
            padding: '6px 9px', fontSize: 11.5, boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
            maxWidth: 220,
          }}
        >
          <div style={{ color: 'var(--text-faint)', fontFamily: 'var(--mono)', marginBottom: 4 }}>
            {new Date(hover.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
          {hover.rows.slice(0, 8).map((r) => (
            <div key={r.num} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: colorForNode(r.num), flex: 'none' }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>
                {r.value.toFixed(field === 'air_util_tx' ? 2 : 1)}{yLabel}
              </span>
            </div>
          ))}
          {hover.rows.length > 8 && <div style={{ color: 'var(--text-faint)', marginTop: 2 }}>+{hover.rows.length - 8} more</div>}
        </div>
      )}
    </div>
  );
}

function drawMultiSeries(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  history: TelemetryHistoryRow[], field: 'chan_util' | 'air_util_tx',
  nodes: NodeRecord[],
  yMax: number, yLabel: string,
  thresholdY?: number, thresholdLabel?: string,
  hoverX?: number,
): void {
  ctx.clearRect(0, 0, w, h);
  const { L: padL, R: padR, T: padT, B: padB } = MULTI_PAD;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  if (history.length === 0) return;

  const minT = Math.min(...history.map((r) => r.ts));
  const maxT = Math.max(...history.map((r) => r.ts));
  const tSpan = Math.max(1, maxT - minT);
  const xScale = (t: number) => padL + ((t - minT) / tSpan) * plotW;
  const yScale = (v: number) => padT + (1 - v / yMax) * plotH;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '11px ui-monospace';
  for (let i = 0; i <= 5; i++) {
    const v = (yMax / 5) * i;
    const y = yScale(v);
    ctx.beginPath();
    ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
    ctx.fillText(`${v.toFixed(0)}${yLabel}`, 8, y + 4);
  }

  // Threshold band
  if (thresholdY !== undefined && yMax > thresholdY) {
    ctx.fillStyle = 'rgba(255,107,129,0.06)';
    ctx.fillRect(padL, yScale(yMax), plotW, yScale(thresholdY) - yScale(yMax));
    ctx.strokeStyle = 'rgba(255,107,129,0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, yScale(thresholdY)); ctx.lineTo(padL + plotW, yScale(thresholdY)); ctx.stroke();
    ctx.setLineDash([]);
    if (thresholdLabel) {
      ctx.fillStyle = 'rgba(255,107,129,0.7)';
      ctx.fillText(thresholdLabel, padL + plotW - 100, yScale(thresholdY) - 4);
    }
  }

  // Group history per node
  const byNode = new Map<number, TelemetryHistoryRow[]>();
  for (const r of history) {
    if (!byNode.has(r.node_num)) byNode.set(r.node_num, []);
    byNode.get(r.node_num)!.push(r);
  }

  // Draw one line per node
  for (const [num, rows] of byNode) {
    rows.sort((a, b) => a.ts - b.ts);
    ctx.strokeStyle = colorForNode(num);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    rows.forEach((r, i) => {
      const v = r[field];
      if (v <= 0) return;
      const x = xScale(r.ts);
      const y = yScale(v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Hover crosshair (drawn on top of the series)
  if (hoverX !== undefined && hoverX >= padL && hoverX <= padL + plotW) {
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hoverX, padT); ctx.lineTo(hoverX, padT + plotH); ctx.stroke();
    ctx.setLineDash([]);
  }

  // x-axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(formatTimeAgo(minT), padL, h - 8);
  ctx.fillText('now', padL + plotW - 28, h - 8);
}

function SingleNodeChart({ history, field, yMax, yLabel, title, color, thresholdY }: {
  history: TelemetryHistoryRow[];
  field: 'battery' | 'voltage' | 'chan_util' | 'air_util_tx';
  yMax: number;
  yLabel: string;
  title: string;
  color: string;
  thresholdY?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawSingleSeries(ctx, c.width, c.height, history, field, yMax, yLabel, color, thresholdY);
  }, [history, field, yMax, color, thresholdY]);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{title}</div>
      <canvas ref={canvasRef} width={900} height={90} style={{ width: '100%', height: 90, display: 'block', background: 'var(--bg)', borderRadius: 4 }} />
    </div>
  );
}

function drawSingleSeries(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  history: TelemetryHistoryRow[], field: 'battery' | 'voltage' | 'chan_util' | 'air_util_tx',
  yMax: number, yLabel: string, color: string, thresholdY?: number,
): void {
  ctx.clearRect(0, 0, w, h);
  const padL = 36, padR = 8, padT = 6, padB = 14;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const valid = history.filter((r) => (r[field] as number) > 0);
  if (valid.length < 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '11px ui-monospace';
    ctx.fillText('not enough samples', padL, h / 2);
    return;
  }
  const minT = valid[0].ts;
  const maxT = valid[valid.length - 1].ts;
  const tSpan = Math.max(1, maxT - minT);
  const xScale = (t: number) => padL + ((t - minT) / tSpan) * plotW;
  const yScale = (v: number) => padT + (1 - v / yMax) * plotH;

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px ui-monospace';
  for (const v of [0, yMax / 2, yMax]) {
    const y = yScale(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
    ctx.fillText(`${v.toFixed(v < 10 ? 1 : 0)}${yLabel}`, 4, y + 3);
  }

  if (thresholdY !== undefined && yMax > thresholdY) {
    ctx.strokeStyle = 'rgba(255,107,129,0.4)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, yScale(thresholdY)); ctx.lineTo(padL + plotW, yScale(thresholdY)); ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  valid.forEach((r, i) => {
    const v = r[field] as number;
    const x = xScale(r.ts);
    const y = yScale(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill underneath subtly
  ctx.fillStyle = color + '26';
  ctx.lineTo(xScale(valid[valid.length - 1].ts), yScale(0));
  ctx.lineTo(xScale(valid[0].ts), yScale(0));
  ctx.closePath();
  ctx.fill();
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

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

function formatTimeAgo(ts: number): string {
  const ago = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (ago < 60) return `${ago}s ago`;
  if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
  if (ago < 86400) return `${Math.floor(ago / 3600)}h ago`;
  return `${Math.floor(ago / 86400)}d ago`;
}

