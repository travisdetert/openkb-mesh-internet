import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LORA_PRESETS, DEFAULT_PRESET } from '../../data/lora-presets';
import type { TabId } from '../TopNav';
import { LearningModeBadge, LearningSeeAlso } from './LearningChrome';
import { downloadCsv } from '../../lib/csv';

interface Props {
  nodes: NodeRecord[];
  state: ConnectionState;
  myNode?: NodeRecord;
  onMessageNode?: (n: number) => void;
  go: (id: TabId) => void;
}

interface Sample {
  node: NodeRecord;
  distKm: number;
  rssi: number;
  predictedRssi: number;
  obstructionLossDb: number;
}

type Tab = 'scatter' | 'trend' | 'outliers';

const REGION_FREQ_MHZ: Record<string, number> = {
  US: 915, EU_433: 433, EU_868: 868, CN: 480, JP: 923, ANZ: 915,
  KR: 921, TW: 923, RU: 868, IN: 866, NZ_865: 865, TH: 920,
  LORA_24: 2440, UA_433: 433, UA_868: 868, MY_433: 433, MY_919: 919, SG_923: 920,
};

function fspl(distKm: number, freqMHz: number): number {
  if (distKm <= 0) return 0;
  return 20 * Math.log10(distKm) + 20 * Math.log10(freqMHz) + 32.44;
}
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function shortHex(num: number): string { return '!' + (num >>> 0).toString(16).padStart(8, '0').slice(-4); }
function colorForNode(num: number): string {
  const hue = ((num >>> 0) * 137.508) % 360;
  return `hsl(${hue}, 65%, 65%)`;
}
function lossColor(db: number): string {
  if (db < 5) return 'var(--good)';
  if (db < 20) return 'var(--warn)';
  return 'var(--bad)';
}

export function SignalDistancePanel({ nodes, state, myNode, onMessageNode, go }: Props) {
  const [tab, setTab] = useState<Tab>('scatter');
  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id);
  const [txPower, setTxPower] = useState(20);
  const [txGain, setTxGain] = useState(2.5);
  const [rxGain, setRxGain] = useState(2.5);
  const [freqMHz, setFreqMHz] = useState(915);
  const [autofilled, setAutofilled] = useState(false);

  useEffect(() => {
    if (autofilled || !state.loraConfig) return;
    const cfg = state.loraConfig;
    const matched = LORA_PRESETS.find((p) => p.id.toLowerCase() === cfg.modemPresetName.toLowerCase());
    if (matched && cfg.usePreset) setPresetId(matched.id);
    const f = REGION_FREQ_MHZ[cfg.regionName];
    if (f) setFreqMHz(f);
    if (cfg.txPower && cfg.txPower > 0) setTxPower(cfg.txPower);
    setAutofilled(true);
  }, [state.loraConfig, autofilled]);

  const preset = LORA_PRESETS.find((p) => p.id === presetId)!;

  const samples: Sample[] = useMemo(() => {
    if (!myNode?.lat || !myNode?.lon) return [];
    return nodes
      .filter((n) =>
        n.num !== myNode.num &&
        n.lat !== undefined && n.lon !== undefined && (n.lat !== 0 || n.lon !== 0) &&
        n.rssi !== undefined && n.rssi !== 0,
      )
      .map((n) => {
        const distKm = haversineKm(myNode.lat!, myNode.lon!, n.lat!, n.lon!);
        const predictedRssi = txPower + txGain + rxGain - fspl(distKm, freqMHz);
        const obstructionLossDb = predictedRssi - n.rssi!;
        return { node: n, distKm, rssi: n.rssi!, predictedRssi, obstructionLossDb };
      })
      .sort((a, b) => a.distKm - b.distKm);
  }, [nodes, myNode, txPower, txGain, rxGain, freqMHz]);

  return (
    <div className="page">
      <h1 className="page-title">RSSI vs Distance</h1>
      <p className="page-sub">
        The chart that makes physics visible. Each dot is a real node your radio has heard. The blue curve is what the Link Budget equation predicts in free space. The gap between dot and curve is the loss you didn't account for — trees, buildings, terrain, multipath.
        {state.loraConfig && (
          <span style={{ display: 'block', color: 'var(--good)', fontSize: 12, marginTop: 4 }}>
            ✓ Auto-filled from your radio: {freqMHz} MHz · {preset.label} · {txPower} dBm
          </span>
        )}
      </p>
      <LearningModeBadge mode="live" />

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'scatter' ? ' active' : '')} onClick={() => setTab('scatter')}>
          Scatter {samples.length > 0 && <span className="subnav-count">{samples.length}</span>}
        </button>
        <button className={'subnav-btn' + (tab === 'trend' ? ' active' : '')} onClick={() => setTab('trend')}>Per-node trend</button>
        <button className={'subnav-btn' + (tab === 'outliers' ? ' active' : '')} onClick={() => setTab('outliers')}>Outliers</button>
      </div>

      {tab === 'scatter' && (
        <ScatterTab
          samples={samples} myNode={myNode}
          preset={preset} presetId={presetId} setPresetId={setPresetId}
          freqMHz={freqMHz} setFreqMHz={setFreqMHz}
          txPower={txPower} setTxPower={setTxPower}
          txGain={txGain} setTxGain={setTxGain}
          rxGain={rxGain} setRxGain={setRxGain}
          onMessageNode={onMessageNode}
        />
      )}
      {tab === 'trend' && <TrendTab nodes={nodes} myNode={myNode} onMessageNode={onMessageNode} />}
      {tab === 'outliers' && <OutliersTab samples={samples} onMessageNode={onMessageNode} />}

      <LearningSeeAlso go={go} links={[
        { to: 'coverage',    label: 'Coverage',    blurb: 'Fit a path-loss curve to this scatter and project geographic reach.' },
        { to: 'link-budget', label: 'Link Budget', blurb: 'See the dB ledger that explains the predicted curve.' },
        { to: 'antennas',    label: 'Antennas',    blurb: 'Most of your outliers are antenna problems.' },
      ]} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Scatter tab
// ─────────────────────────────────────────────────────────────────────

function ScatterTab({
  samples, myNode, preset, presetId, setPresetId, freqMHz, setFreqMHz,
  txPower, setTxPower, txGain, setTxGain, rxGain, setRxGain, onMessageNode,
}: any) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [selectedNum, setSelectedNum] = useState<number | null>(null);
  const directOnly = samples.filter((s: Sample) => (s.node.hopsAway ?? 0) === 0);
  const meanLoss = directOnly.length
    ? directOnly.reduce((sum: number, s: Sample) => sum + s.obstructionLossDb, 0) / directOnly.length
    : null;

  const selectedSample = selectedNum != null ? samples.find((s: Sample) => s.node.num === selectedNum) : null;

  const positionsRef = useRef<Array<{ x: number; y: number; sample: Sample }>>([]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    positionsRef.current = drawChart(ctx, c.width, c.height, {
      samples, freqMHz, txPower, txGain, rxGain, sensitivity: preset.sensitivity,
    });
  }, [samples, freqMHz, txPower, txGain, rxGain, preset.sensitivity]);

  const onCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const scaleX = c.width / rect.width;
    const scaleY = c.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    let best = -1, bestDist = 14 * 14;
    positionsRef.current.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    });
    setHoverIdx(best === -1 ? null : best);
  };

  const onCanvasClick = () => {
    if (hoverIdx == null) return;
    const sample = positionsRef.current[hoverIdx]?.sample;
    if (sample) setSelectedNum(sample.node.num);
  };

  const exportCsv = () => {
    const rows = samples.map((s: Sample) => ({
      short_name: s.node.shortName || '',
      node_hex: shortHex(s.node.num),
      distance_km: s.distKm.toFixed(3),
      rssi_dbm: s.rssi.toString(),
      predicted_rssi_dbm: s.predictedRssi.toFixed(2),
      obstruction_loss_db: s.obstructionLossDb.toFixed(2),
      hops_away: s.node.hopsAway?.toString() ?? '',
    }));
    downloadCsv(rows, 'rssi-vs-distance');
  };

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Real signal vs predicted free-space loss</h2>
            {samples.length > 0 && (
              <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={exportCsv}>⇩ CSV</button>
            )}
          </div>
          {!myNode?.lat ? (
            <div className="empty">
              Need your own position first. Your radio hasn't broadcast its GPS yet. If your radio has no GPS, set a fixed position in Settings → Position.
            </div>
          ) : samples.length === 0 ? (
            <div className="empty">
              No nodes yet with both position <em>and</em> a measured RSSI. As more nodes broadcast both, they'll appear here automatically.
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <canvas
                ref={canvasRef}
                width={1100}
                height={500}
                style={{ width: '100%', height: 500, display: 'block', background: 'var(--bg)', borderRadius: 6, cursor: hoverIdx != null ? 'pointer' : 'crosshair' }}
                onMouseMove={onCanvasMove}
                onMouseLeave={() => setHoverIdx(null)}
                onClick={onCanvasClick}
              />
              {hoverIdx != null && positionsRef.current[hoverIdx] && (() => {
                const p = positionsRef.current[hoverIdx];
                const c = canvasRef.current!;
                const rect = c.getBoundingClientRect();
                const left = (p.x / c.width) * rect.width;
                const top = (p.y / c.height) * rect.height;
                return (
                  <div className="map-tooltip" style={{ position: 'absolute', left: left + 14, top: top + 14, pointerEvents: 'none' }}>
                    <div className="map-tooltip-title">{p.sample.node.shortName || shortHex(p.sample.node.num)}</div>
                    <div className="map-tooltip-row">
                      <span>{p.sample.distKm < 1 ? `${(p.sample.distKm * 1000).toFixed(0)} m` : `${p.sample.distKm.toFixed(2)} km`}</span>
                      <span>{p.sample.rssi} dBm</span>
                      <span>hop {p.sample.node.hopsAway ?? '—'}</span>
                    </div>
                    <div className="map-tooltip-hint">excess {p.sample.obstructionLossDb > 0 ? '+' : ''}{p.sample.obstructionLossDb.toFixed(1)} dB · click to select</div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Adjust the predicted curve</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
            <Field label="Frequency (MHz)"><input type="number" className="text" value={freqMHz} step={1} onChange={(e) => setFreqMHz(Number(e.target.value))} /></Field>
            <Field label="Modem preset">
              <select className="text" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                {LORA_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
            <Slider label="TX power (dBm)" value={txPower} min={2} max={30} step={1} onChange={setTxPower} />
            <Slider label="TX antenna gain (dBi)" value={txGain} min={-3} max={12} step={0.5} onChange={setTxGain} />
            <Slider label="RX antenna gain (dBi)" value={rxGain} min={-3} max={12} step={0.5} onChange={setRxGain} />
          </div>
        </div>

        {samples.length > 0 && (
          <div className="card">
            <h2>Per-node breakdown</h2>
            <table className="data">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Hops</th>
                  <th>Distance</th>
                  <th>Real RSSI</th>
                  <th>Predicted RSSI</th>
                  <th>Excess loss</th>
                  <th>Headroom</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s: Sample) => (
                  <tr
                    key={s.node.num}
                    onClick={() => setSelectedNum(s.node.num)}
                    style={{ cursor: 'pointer', background: selectedNum === s.node.num ? 'var(--bg-elev-2)' : undefined }}
                  >
                    <td style={{ color: colorForNode(s.node.num) }}>{s.node.shortName || shortHex(s.node.num)}</td>
                    <td>
                      <span className={`dot ${(s.node.hopsAway ?? 0) === 0 ? 'good' : 'warn'}`}></span>
                      {s.node.hopsAway ?? '—'}
                    </td>
                    <td>{s.distKm < 1 ? `${(s.distKm * 1000).toFixed(0)} m` : `${s.distKm.toFixed(2)} km`}</td>
                    <td>{s.rssi} dBm</td>
                    <td>{s.predictedRssi.toFixed(1)} dBm</td>
                    <td style={{ color: lossColor(s.obstructionLossDb) }}>
                      {s.obstructionLossDb >= 0 ? '+' : ''}{s.obstructionLossDb.toFixed(1)} dB
                    </td>
                    <td>{(s.rssi - preset.sensitivity).toFixed(0)} dB</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginTop: 8, color: 'var(--text-faint)', fontSize: 11.5 }}>
              "Excess loss" only makes sense for direct (hop 0) nodes. Relayed nodes show the RSSI of the last hop, not the original sender — distance and RSSI don't correspond.
            </p>
          </div>
        )}
      </div>

      <div>
        {selectedSample ? (
          <SampleDetail sample={selectedSample} preset={preset} onClose={() => setSelectedNum(null)} onMessageNode={onMessageNode} />
        ) : (
          <div className="info-card">
            <p><strong>How to read this.</strong></p>
            <p><strong>Blue curve</strong> = free-space path loss. Theoretical best case with nothing between you and the other node.</p>
            <p><strong>Green dots</strong> = direct (hop 0) nodes. Distances and RSSIs are real and comparable.</p>
            <p><strong>Yellow dots</strong> = relayed nodes. Their RSSI is from the relay — only their <em>distance</em> matters here.</p>
            <p style={{ marginBottom: 0 }}><strong>Red dashed line</strong> = the LoRa demodulator's noise floor. Below this, the receiver gives up.</p>
          </div>
        )}

        {meanLoss !== null && (
          <div className="card">
            <h3>Your environment, measured</h3>
            <div style={{ fontSize: 24, fontFamily: 'var(--mono)', color: lossColor(meanLoss) }}>
              {meanLoss >= 0 ? '+' : ''}{meanLoss.toFixed(1)} dB
            </div>
            <p style={{ margin: '6px 0 0', color: 'var(--text-dim)', fontSize: 12.5 }}>
              Average excess loss above free space across {directOnly.length} direct node{directOnly.length === 1 ? '' : 's'}. Reference:
            </p>
            <ul style={{ marginTop: 8, paddingLeft: 16, color: 'var(--text-dim)', fontSize: 12 }}>
              <li><strong>0–10 dB:</strong> open sky, water, line-of-sight</li>
              <li><strong>10–20 dB:</strong> light foliage or one obstruction</li>
              <li><strong>20–30 dB:</strong> typical suburban, mixed terrain</li>
              <li><strong>30+ dB:</strong> heavy urban, dense forest, indoor TX</li>
            </ul>
          </div>
        )}

        <div className="info-card">
          <p><strong>Why dots fall <em>above</em> the curve.</strong></p>
          <p style={{ marginBottom: 0 }}>Sometimes excess loss appears negative — your real RSSI is <em>better</em> than free space predicts. This isn't magic; usually one of: (1) ground reflection adding constructively, (2) we underestimated TX power or antenna gain, or (3) the node is closer than its GPS suggests (cheap GPS can be off by 50+ m).</p>
        </div>
      </div>
    </div>
  );
}

function SampleDetail({ sample, preset, onClose, onMessageNode }: { sample: Sample; preset: any; onClose: () => void; onMessageNode?: (n: number) => void }) {
  const { node, distKm, rssi, predictedRssi, obstructionLossDb } = sample;
  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <h3 style={{ margin: 0, color: colorForNode(node.num), fontSize: 15, textTransform: 'none', letterSpacing: 0 }}>
          {node.shortName || shortHex(node.num)}
          {node.longName && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-faint)' }}>{node.longName}</span>}
        </h3>
        <button className="ghost" onClick={onClose} style={{ padding: '2px 8px', fontSize: 11 }}>×</button>
      </div>
      <dl className="kv kv-tight">
        <dt>Distance</dt><dd>{distKm < 1 ? `${(distKm * 1000).toFixed(0)} m` : `${distKm.toFixed(3)} km`}</dd>
        <dt>Hops</dt><dd>{node.hopsAway ?? '—'}</dd>
        <dt>Real RSSI</dt><dd>{rssi} dBm</dd>
        <dt>Predicted (FSPL)</dt><dd>{predictedRssi.toFixed(1)} dBm</dd>
        <dt>Excess loss</dt>
        <dd style={{ color: lossColor(obstructionLossDb) }}>
          {obstructionLossDb >= 0 ? '+' : ''}{obstructionLossDb.toFixed(1)} dB
        </dd>
        <dt>Headroom to floor</dt><dd>{(rssi - preset.sensitivity).toFixed(0)} dB above {preset.sensitivity} dBm</dd>
        {node.snr !== undefined && <><dt>SNR</dt><dd>{node.snr.toFixed(1)} dB</dd></>}
      </dl>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>
        {(node.hopsAway ?? 0) > 0
          ? `This node was reached via ${node.hopsAway} hop${node.hopsAway === 1 ? '' : 's'}. RSSI above is from the relay that handed off to you, not from this node directly — comparing it to FSPL at the full geographic distance is misleading.`
          : obstructionLossDb < 10
            ? 'Effectively line-of-sight. Your antennas can see each other.'
            : obstructionLossDb < 25
              ? 'Typical sub-urban path. Some trees or buildings in the way.'
              : 'Heavy obstruction. Dense trees, multi-story buildings, or terrain shadow.'}
      </p>
      {onMessageNode && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button className="primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onMessageNode(node.num)}>Message</button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Trend tab — per-node RSSI over time
// ─────────────────────────────────────────────────────────────────────

function TrendTab({ nodes, myNode, onMessageNode }: { nodes: NodeRecord[]; myNode?: NodeRecord; onMessageNode?: (n: number) => void }) {
  const [scale, setScale] = useState<'1h' | '6h' | '24h' | '7d'>('24h');
  const [samples, setSamples] = useState<PathLossSample[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedNum, setSelectedNum] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ms = scale === '1h' ? 3600_000 : scale === '6h' ? 6 * 3600_000 : scale === '24h' ? 24 * 3600_000 : 7 * 24 * 3600_000;
    setLoading(true);
    window.mesh.pathLossSamples({ sinceMs: Date.now() - ms }).then((rows) => {
      if (!cancelled) {
        setSamples(rows);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [scale]);

  // Group samples by node
  const byNode = useMemo(() => {
    const m = new Map<number, PathLossSample[]>();
    for (const s of samples) {
      if (!m.has(s.fromNum)) m.set(s.fromNum, []);
      m.get(s.fromNum)!.push(s);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.ts - b.ts);
    return m;
  }, [samples]);

  const ranked = useMemo(() => {
    return Array.from(byNode.entries())
      .map(([num, rows]) => {
        const node = nodes.find((n) => n.num === num);
        const latest = rows[rows.length - 1];
        return { num, node, count: rows.length, latestRssi: latest.rssi, latestTs: latest.ts };
      })
      .sort((a, b) => b.count - a.count);
  }, [byNode, nodes]);

  useEffect(() => {
    if (selectedNum === null && ranked[0]) setSelectedNum(ranked[0].num);
  }, [ranked, selectedNum]);

  const activeRows = selectedNum != null ? byNode.get(selectedNum) ?? [] : [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
      <div>
        <div className="card" style={{ padding: 6, marginBottom: 12 }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Window</span>
            {loading && <span style={{ color: 'var(--text-faint)' }}>loading…</span>}
          </div>
          <div className="map-style-toggle" style={{ margin: '4px 8px' }}>
            {(['1h', '6h', '24h', '7d'] as const).map((s) => (
              <button key={s} className={'map-style-btn' + (scale === s ? ' active' : '')} onClick={() => setScale(s)}>{s}</button>
            ))}
          </div>
        </div>
        <div className="card" style={{ padding: 6 }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 8px' }}>
            Nodes with samples ({ranked.length})
          </div>
          {ranked.length === 0 && <div className="empty" style={{ padding: 10 }}>No samples in this window.</div>}
          {ranked.map((r) => {
            const active = selectedNum === r.num;
            return (
              <button key={r.num} className={'convo-item' + (active ? ' active' : '')} onClick={() => setSelectedNum(r.num)}>
                <div className="convo-row">
                  <span className="convo-label" style={{ color: colorForNode(r.num) }}>{r.node?.shortName || shortHex(r.num)}</span>
                  <span className="convo-time">{r.count}×</span>
                </div>
                <div className="convo-preview">latest {r.latestRssi} dBm · {timeAgo(r.latestTs)}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        {selectedNum != null && activeRows.length > 0 ? (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <h2 style={{ margin: 0, color: colorForNode(selectedNum) }}>
                {nodes.find((n) => n.num === selectedNum)?.shortName || shortHex(selectedNum)}
              </h2>
              {onMessageNode && (
                <button className="primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onMessageNode(selectedNum!)}>Message</button>
              )}
            </div>
            <TrendSpark title="RSSI over time" series={activeRows.map((r) => ({ ts: r.ts, v: r.rssi }))} yMin={-130} yMax={-30} yLabel="dBm" color={colorForNode(selectedNum)} />
            <TrendSpark title="SNR over time" series={activeRows.map((r) => ({ ts: r.ts, v: r.snr }))} yMin={-20} yMax={15} yLabel="dB" color="#ffd166" />
            <h3 style={{ marginTop: 14 }}>Recent samples</h3>
            <table className="data" style={{ fontSize: 11.5 }}>
              <thead><tr><th>Time</th><th>RSSI</th><th>SNR</th><th>Hops</th></tr></thead>
              <tbody>
                {activeRows.slice().reverse().slice(0, 30).map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--mono)' }}>{new Date(r.ts).toLocaleTimeString()}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{r.rssi} dBm</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{r.snr.toFixed(1)}</td>
                    <td>{r.hopsAway}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <div className="empty">
              {loading ? 'Loading samples…' : ranked.length === 0
                ? `No packets with RSSI measurements landed in the last ${scale}. Widen the window or wait for traffic.`
                : 'Pick a node from the list.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrendSpark({ title, series, yMin, yMax, yLabel, color }: { title: string; series: Array<{ ts: number; v: number }>; yMin: number; yMax: number; yLabel: string; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const padL = 40, padR = 8, padT = 8, padB = 16;
    const w = c.width, h = c.height;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    if (series.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '11px ui-monospace';
      ctx.fillText('not enough samples', padL, h / 2);
      return;
    }
    const minT = series[0].ts;
    const maxT = series[series.length - 1].ts;
    const tSpan = Math.max(1, maxT - minT);
    const xScale = (t: number) => padL + ((t - minT) / tSpan) * plotW;
    const yScale = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '10px ui-monospace';
    for (const v of [yMin, (yMin + yMax) / 2, yMax]) {
      const y = yScale(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
      ctx.fillText(`${v.toFixed(0)}${yLabel}`, 4, y + 3);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.4;
    ctx.beginPath();
    series.forEach((p, i) => {
      const x = xScale(p.ts), y = yScale(p.v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = color;
    for (const p of series) {
      ctx.beginPath(); ctx.arc(xScale(p.ts), yScale(p.v), 2, 0, Math.PI * 2); ctx.fill();
    }
  }, [series, yMin, yMax, color]);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{title}</div>
      <canvas ref={canvasRef} width={900} height={120} style={{ width: '100%', height: 120, display: 'block', background: 'var(--bg)', borderRadius: 4 }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Outliers tab
// ─────────────────────────────────────────────────────────────────────

function OutliersTab({ samples, onMessageNode }: { samples: Sample[]; onMessageNode?: (n: number) => void }) {
  const direct = samples.filter((s) => (s.node.hopsAway ?? 0) === 0);
  const sortedHigh = [...direct].sort((a, b) => b.obstructionLossDb - a.obstructionLossDb);
  const sortedLow = [...direct].sort((a, b) => a.obstructionLossDb - b.obstructionLossDb);

  if (direct.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          No direct (hop 0) measurements yet — outlier detection only makes sense for nodes you can directly hear, since for relays the RSSI doesn't correspond to the geographic distance.
        </div>
      </div>
    );
  }

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>High excess loss (link is worse than FSPL predicts)</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12.5 }}>
            These nodes are weaker than free-space math expects for their distance. Usually obstruction — trees, hills, buildings. Sometimes their reported GPS is wrong.
          </p>
          <OutlierList items={sortedHigh.slice(0, 10)} kind="bad" onMessageNode={onMessageNode} />
        </div>
        <div className="card">
          <h2>Surprisingly good (RSSI better than FSPL predicts)</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12.5 }}>
            RSSI is stronger than free space would allow. Reasons: constructive ground reflection, you've under-estimated TX power or antenna gain, or the GPS coords are wrong (closer than reported).
          </p>
          <OutlierList items={sortedLow.slice(0, 10)} kind="good" onMessageNode={onMessageNode} />
        </div>
      </div>
      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What outliers tell you.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            A consistent positive excess across many direct nodes means your overall environment (foliage, buildings, terrain). A single node 20+ dB worse than its peers usually means one specific obstacle (a hill, a thick wall).
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Negative excess (RSSI better than predicted) for a single node points to GPS error on their end — common with low-quality GPS chips that report position before getting a real fix.
          </p>
        </div>
      </div>
    </div>
  );
}

function OutlierList({ items, kind, onMessageNode }: { items: Sample[]; kind: 'good' | 'bad'; onMessageNode?: (n: number) => void }) {
  if (items.length === 0) return <div className="empty">No data.</div>;
  return (
    <table className="data">
      <thead><tr><th>Node</th><th>Distance</th><th>Real RSSI</th><th>Predicted</th><th>Excess</th><th></th></tr></thead>
      <tbody>
        {items.map((s) => (
          <tr key={s.node.num}>
            <td style={{ color: colorForNode(s.node.num) }}>{s.node.shortName || shortHex(s.node.num)}</td>
            <td>{s.distKm < 1 ? `${(s.distKm * 1000).toFixed(0)} m` : `${s.distKm.toFixed(2)} km`}</td>
            <td style={{ fontFamily: 'var(--mono)' }}>{s.rssi} dBm</td>
            <td style={{ fontFamily: 'var(--mono)' }}>{s.predictedRssi.toFixed(0)} dBm</td>
            <td style={{ color: kind === 'bad' ? 'var(--bad)' : 'var(--good)', fontFamily: 'var(--mono)' }}>
              {s.obstructionLossDb >= 0 ? '+' : ''}{s.obstructionLossDb.toFixed(1)} dB
            </td>
            <td>{onMessageNode && (
              <button className="primary" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => onMessageNode(s.node.num)}>Message</button>
            )}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Canvas chart (returns clickable positions)
// ─────────────────────────────────────────────────────────────────────

interface ChartArgs {
  samples: Sample[];
  freqMHz: number;
  txPower: number;
  txGain: number;
  rxGain: number;
  sensitivity: number;
}

function drawChart(ctx: CanvasRenderingContext2D, w: number, h: number, args: ChartArgs): Array<{ x: number; y: number; sample: Sample }> {
  ctx.clearRect(0, 0, w, h);
  const padL = 60, padR = 20, padT = 30, padB = 50;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const yMin = -135, yMax = -30;
  const yScale = (rssi: number) => padT + ((yMax - rssi) / (yMax - yMin)) * plotH;
  const xMin = -2;
  const distMaxKm = args.samples.length > 0 ? Math.max(...args.samples.map((s) => s.distKm), 1) : 5;
  const xMaxAdj = Math.max(2, Math.ceil(Math.log10(distMaxKm * 1.5)));
  const xScale = (km: number) => {
    if (km <= 0) return padL;
    const logKm = Math.log10(km);
    return padL + ((logKm - xMin) / (xMaxAdj - xMin)) * plotW;
  };

  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '11px ui-monospace';
  ctx.lineWidth = 1;

  for (let rssi = -130; rssi <= -30; rssi += 10) {
    const y = yScale(rssi);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(`${rssi}`, 8, y + 4);
  }
  const xTicks = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100];
  for (const km of xTicks) {
    if (Math.log10(km) > xMaxAdj) continue;
    const x = xScale(km);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    const label = km < 1 ? `${km * 1000}m` : `${km}km`;
    ctx.fillText(label, x - 14, padT + plotH + 18);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('RSSI (dBm)', 8, padT - 12);
  ctx.fillText('distance →', padL + plotW - 70, padT + plotH + 38);

  // Sensitivity floor
  const yFloor = yScale(args.sensitivity);
  ctx.strokeStyle = '#ff6b81';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padL, yFloor); ctx.lineTo(padL + plotW, yFloor); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ff6b81';
  ctx.fillText(`demod floor ${args.sensitivity} dBm`, padL + 8, yFloor - 6);

  // FSPL curve
  ctx.strokeStyle = '#5cc8ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= 200; i++) {
    const logKm = xMin + ((xMaxAdj - xMin) * i) / 200;
    const km = Math.pow(10, logKm);
    const predicted = args.txPower + args.txGain + args.rxGain - fspl(km, args.freqMHz);
    const x = xScale(km), y = yScale(predicted);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#5cc8ff';
  ctx.fillText('FSPL', xScale(1) + 6, yScale(args.txPower + args.txGain + args.rxGain - fspl(1, args.freqMHz)) - 6);

  // Dots
  const positions: Array<{ x: number; y: number; sample: Sample }> = [];
  for (const s of args.samples) {
    const x = xScale(s.distKm);
    const y = yScale(s.rssi);
    const isDirect = (s.node.hopsAway ?? 0) === 0;
    ctx.fillStyle = isDirect ? '#66d39a' : '#ffd166';
    ctx.beginPath();
    ctx.arc(x, y, isDirect ? 6 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (isDirect) {
      const yPred = yScale(s.predictedRssi);
      ctx.strokeStyle = 'rgba(102,211,154,0.4)';
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, yPred); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = 'rgba(230,232,238,0.85)';
    ctx.font = '11px ui-monospace';
    ctx.fillText(s.node.shortName || '???', x + 9, y + 3);
    positions.push({ x, y, sample: s });
  }

  // Legend
  const legendY = padT + 8;
  ctx.fillStyle = '#5cc8ff';
  ctx.fillRect(padL + plotW - 220, legendY, 14, 2);
  ctx.fillStyle = 'rgba(230,232,238,0.85)';
  ctx.fillText('predicted (FSPL)', padL + plotW - 200, legendY + 5);

  ctx.fillStyle = '#66d39a';
  ctx.beginPath();
  ctx.arc(padL + plotW - 220 + 7, legendY + 18, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(230,232,238,0.85)';
  ctx.fillText('direct', padL + plotW - 200, legendY + 22);

  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.arc(padL + plotW - 150 + 7, legendY + 18, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(230,232,238,0.85)';
  ctx.fillText('relayed', padL + plotW - 130, legendY + 22);

  return positions;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        <span>{label}</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} style={{ width: '100%' }} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
function timeAgo(ts: number): string {
  const d = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
