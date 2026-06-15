import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LORA_PRESETS } from '../../data/lora-presets';
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

const REGION_FREQ_MHZ: Record<string, number> = {
  US: 915, EU_433: 433, EU_868: 868, CN: 480, JP: 923, ANZ: 915,
  KR: 921, TW: 923, RU: 868, IN: 866, NZ_865: 865, TH: 920,
  LORA_24: 2440, UA_433: 433, UA_868: 868, MY_433: 433, MY_919: 919, SG_923: 920,
};

const TIME_WINDOWS = [
  { id: '1h',  label: 'Last hour',     ms: 60 * 60 * 1000 },
  { id: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: '7d',  label: 'Last 7 days',   ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: 'Last 30 days',  ms: 30 * 24 * 60 * 60 * 1000 },
  { id: 'all', label: 'All time',      ms: 365 * 10 * 24 * 60 * 60 * 1000 },
];

const TILE_SIZE = 256;
const SVG_W = 1200, SVG_H = 700;

type Tab = 'pathloss' | 'heatmap' | 'reach';

interface PreparedSample {
  fromNum: number;
  rssi: number;
  snr: number;
  hopsAway: number;
  distKm: number;
  ts: number;
  lat: number;
  lon: number;
}

interface Fit {
  intercept: number;
  slope: number;
  exponent: number;
  rmsErrorDb: number;
  sampleCount: number;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function fspl(distKm: number, freqMHz: number): number {
  if (distKm <= 0) return 0;
  return 20 * Math.log10(distKm) + 20 * Math.log10(freqMHz) + 32.44;
}
function distanceFromLoss(lossDb: number, freqMHz: number): number {
  const exp = (lossDb - 32.44 - 20 * Math.log10(freqMHz)) / 20;
  return Math.pow(10, exp);
}
function shortHex(num: number): string { return '!' + (num >>> 0).toString(16).padStart(8, '0').slice(-4); }

function fitLinear(samples: PreparedSample[]): Fit | null {
  const valid = samples.filter((s) => s.distKm > 0.001 && s.distKm < 200);
  const n = valid.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const s of valid) {
    const x = Math.log10(s.distKm);
    const y = s.rssi;
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const meanX = sx / n;
  const meanY = sy / n;
  const denom = sxx - n * meanX * meanX;
  if (Math.abs(denom) < 1e-9) return null;
  const slope = (sxy - n * meanX * meanY) / denom;
  const intercept = meanY - slope * meanX;
  let sse = 0;
  for (const s of valid) {
    const x = Math.log10(s.distKm);
    const predicted = intercept + slope * x;
    sse += (s.rssi - predicted) ** 2;
  }
  return { intercept, slope, exponent: -slope / 10, rmsErrorDb: Math.sqrt(sse / n), sampleCount: n };
}

// Mercator helpers (mirrors PositionMapPanel — extract later)
function lonToMercX(lon: number, z: number): number { return ((lon + 180) / 360) * Math.pow(2, z) * TILE_SIZE; }
function latToMercY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return (0.5 - Math.log((1 + Math.sin(r)) / (1 - Math.sin(r))) / (4 * Math.PI)) * Math.pow(2, z) * TILE_SIZE;
}
function clampZoom(z: number): number { return Math.max(1, Math.min(17, Math.round(z))); }

export function CoveragePanel({ nodes, state, myNode, onMessageNode, go }: Props) {
  const [tab, setTab] = useState<Tab>('pathloss');
  const [windowId, setWindowId] = useState('7d');
  const [hopsFilter, setHopsFilter] = useState<'direct' | 'all'>('direct');
  const [samples, setSamples] = useState<PathLossSample[]>([]);
  const [loading, setLoading] = useState(false);

  const timeWindow = TIME_WINDOWS.find((w) => w.id === windowId)!;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.mesh.pathLossSamples({ sinceMs: Date.now() - timeWindow.ms }).then((s) => {
      if (!cancelled) { setSamples(s); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [windowId]);

  const prepared: PreparedSample[] = useMemo(() => {
    if (!myNode?.lat || !myNode?.lon) return [];
    return samples
      .filter((s) => hopsFilter === 'all' || s.hopsAway === 0)
      .map((s) => ({
        fromNum: s.fromNum, rssi: s.rssi, snr: s.snr, hopsAway: s.hopsAway, ts: s.ts,
        lat: s.lat, lon: s.lon,
        distKm: haversineKm(myNode.lat!, myNode.lon!, s.lat, s.lon),
      }))
      .filter((s) => s.distKm > 0);
  }, [samples, myNode, hopsFilter]);

  const fit = useMemo(() => fitLinear(prepared), [prepared]);
  const freqMHz = REGION_FREQ_MHZ[state.loraConfig?.regionName ?? 'US'] ?? 915;

  return (
    <div className="page">
      <h1 className="page-title">Coverage</h1>
      <p className="page-sub">
        Every <code>(distance, RSSI)</code> sample your radio has accumulated, fitted to a path-loss model — and projected back onto the actual geography. {state.loraConfig && <span style={{ color: 'var(--good)' }}>· {freqMHz} MHz</span>}
      </p>
      <LearningModeBadge mode="live" />

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'pathloss' ? ' active' : '')} onClick={() => setTab('pathloss')}>
          Path loss
          {prepared.length > 0 && <span className="subnav-count">{prepared.length}</span>}
        </button>
        <button className={'subnav-btn' + (tab === 'heatmap' ? ' active' : '')} onClick={() => setTab('heatmap')}>Heatmap</button>
        <button className={'subnav-btn' + (tab === 'reach' ? ' active' : '')} onClick={() => setTab('reach')}>Predicted reach</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="map-style-toggle">
            {TIME_WINDOWS.map((w) => (
              <button key={w.id} className={'map-style-btn' + (windowId === w.id ? ' active' : '')} onClick={() => setWindowId(w.id)}>
                {w.id}
              </button>
            ))}
          </div>
          <select className="text" value={hopsFilter} onChange={(e) => setHopsFilter(e.target.value as any)} style={{ width: 150, fontSize: 11 }}>
            <option value="direct">Direct only (hop 0)</option>
            <option value="all">All (incl. relayed)</option>
          </select>
          {loading && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>loading…</span>}
        </div>
      </div>

      {tab === 'pathloss' && (
        <PathLossTab
          myNode={myNode} prepared={prepared} fit={fit}
          freqMHz={freqMHz} nodes={nodes}
        />
      )}
      {tab === 'heatmap' && (
        <HeatmapTab
          myNode={myNode} prepared={prepared} fit={fit} freqMHz={freqMHz} nodes={nodes}
          onMessageNode={onMessageNode}
        />
      )}
      {tab === 'reach' && (
        <ReachTab
          myNode={myNode} fit={fit} freqMHz={freqMHz}
          activePresetName={state.loraConfig?.modemPresetName}
          txPower={state.loraConfig?.txPower || 17}
        />
      )}

      <LearningSeeAlso go={go} links={[
        { to: 'rssi-distance', label: 'RSSI vs. Distance', blurb: 'See the raw samples that feed this fit.' },
        { to: 'link-budget',   label: 'Link Budget',       blurb: 'Walk through the dB math behind the path-loss curve.' },
        { to: 'map',           label: 'Map',               blurb: 'See the heatmap overlaid on real positions.' },
      ]} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Path loss tab — fit + chart + stats
// ─────────────────────────────────────────────────────────────────────

function PathLossTab({ myNode, prepared, fit, freqMHz, nodes }: { myNode?: NodeRecord; prepared: PreparedSample[]; fit: Fit | null; freqMHz: number; nodes: NodeRecord[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawCoverage(ctx, c.width, c.height, prepared, fit, freqMHz);
  }, [prepared, fit, freqMHz]);

  const stats = useMemo(() => {
    if (prepared.length === 0) return null;
    let best = prepared[0], worst = prepared[0], longest = prepared[0];
    for (const s of prepared) {
      if (s.rssi > best.rssi) best = s;
      if (s.rssi < worst.rssi) worst = s;
      if (s.distKm > longest.distKm) longest = s;
    }
    return { best, worst, longest };
  }, [prepared]);

  const nameFor = (num: number): string => {
    const n = nodes.find((x) => x.num === num);
    return n?.shortName || shortHex(num);
  };

  const exportCsv = () => downloadCsv(prepared.map((s) => ({
    ts_iso: new Date(s.ts).toISOString(),
    node: nameFor(s.fromNum),
    node_hex: shortHex(s.fromNum),
    distance_km: s.distKm.toFixed(3),
    rssi_dbm: s.rssi.toString(),
    snr_db: s.snr.toFixed(2),
    hops_away: s.hopsAway.toString(),
  })), 'coverage-samples');

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Real (distance, RSSI) measurements</h2>
            {prepared.length > 0 && <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={exportCsv}>⇩ CSV</button>}
          </div>
          {!myNode?.lat ? (
            <div className="empty">Need your radio's GPS position before distances can be computed. Set a fixed position in Settings → Position if your radio has no GPS.</div>
          ) : prepared.length === 0 ? (
            <div className="empty">No samples in this time window yet. Keep the app running — the database fills as packets arrive.</div>
          ) : (
            <canvas ref={canvasRef} width={1100} height={460} style={{ width: '100%', height: 460, display: 'block', background: 'var(--bg)', borderRadius: 6 }} />
          )}
        </div>

        {fit && (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Your local path-loss exponent</h2>
            <div className="range-grid">
              <Card label="Exponent (n)" value={fit.exponent.toFixed(2)} hint={describeExponent(fit.exponent)} />
              <Card label="RMS error" value={`±${fit.rmsErrorDb.toFixed(1)} dB`} hint="How much real RSSI scatters around the fit" />
              <Card label="Samples used" value={String(fit.sampleCount)} hint="More direct samples = better fit" />
              <Card label="Path loss at 1 km" value={`${(20 - fit.intercept).toFixed(0)} dB`} hint="Assuming 20 dBm conducted reference" />
            </div>
          </div>
        )}

        {stats && (
          <div className="card">
            <h2>Notable links in this window</h2>
            <table className="data">
              <tbody>
                <tr>
                  <td style={{ color: 'var(--text-dim)' }}>Strongest signal</td>
                  <td style={{ color: 'var(--accent)' }}>{nameFor(stats.best.fromNum)}</td>
                  <td>{formatDist(stats.best.distKm)}</td>
                  <td>{stats.best.rssi} dBm</td>
                  <td>SNR {stats.best.snr.toFixed(1)}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-dim)' }}>Weakest decoded</td>
                  <td style={{ color: 'var(--accent)' }}>{nameFor(stats.worst.fromNum)}</td>
                  <td>{formatDist(stats.worst.distKm)}</td>
                  <td>{stats.worst.rssi} dBm</td>
                  <td>SNR {stats.worst.snr.toFixed(1)}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-dim)' }}>Longest distance</td>
                  <td style={{ color: 'var(--accent)' }}>{nameFor(stats.longest.fromNum)}</td>
                  <td>{formatDist(stats.longest.distKm)}</td>
                  <td>{stats.longest.rssi} dBm</td>
                  <td>SNR {stats.longest.snr.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <div className="info-card">
          <p><strong>What this panel computes.</strong></p>
          <p>For every direct-reception packet stored in your local DB, it joins on the sender's most recent reported position to get a real (distance, RSSI) pair. Then it fits the standard log-distance path-loss model:</p>
          <pre style={{ background: 'var(--bg)', padding: 8, borderRadius: 4, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)', margin: '8px 0' }}>
{`PL(d) = PL(d₀) + 10·n·log₁₀(d/d₀)`}
          </pre>
          <p style={{ marginBottom: 0 }}>Least-squares fit on (log₁₀(d), RSSI) gives you the exponent n directly from your data — no theory required.</p>
        </div>

        {fit && (
          <div className="info-card">
            <p><strong>Your environment, n = {fit.exponent.toFixed(2)}.</strong></p>
            <p>Free space is <code>n = 2.0</code> — pure inverse-square. Real ranges:</p>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5 }}>
              <li><code>2.0–2.5</code>: open water, mountaintops, true LOS</li>
              <li><code>2.5–3.0</code>: open suburban with low foliage</li>
              <li><code>3.0–4.0</code>: typical suburban with trees and buildings</li>
              <li><code>4.0–5.0</code>: dense urban, indoor-to-indoor</li>
              <li><code>5.0+</code>: extreme — penetrating walls, dense forest</li>
            </ul>
            <p style={{ marginBottom: 0, fontSize: 12.5 }}>Multiplying TX power by 4 (+6 dB) doubles your range only when n=2. At n=4 it gives 1.4×. <strong>Antenna height beats power output</strong> — getting above obstructions effectively lowers n.</p>
          </div>
        )}

        <div className="info-card">
          <p><strong>The fit gets better as data grows.</strong></p>
          <p style={{ marginBottom: 0 }}>3 samples is enough to compute a number; 30 samples gives you a real estimate; 300+ gets you a tight fit with predictive value. Leave the app running through different weather, times of day, and antenna positions to capture variance.</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Heatmap tab — coverage points on a basemap
// ─────────────────────────────────────────────────────────────────────

function HeatmapTab({ myNode, prepared, fit, freqMHz, nodes, onMessageNode }: {
  myNode?: NodeRecord; prepared: PreparedSample[]; fit: Fit | null; freqMHz: number; nodes: NodeRecord[]; onMessageNode?: (n: number) => void;
}) {
  if (!myNode?.lat || !myNode?.lon) {
    return <div className="card"><div className="empty">Need your radio's GPS position to render a geographic heatmap.</div></div>;
  }
  if (prepared.length === 0) {
    return <div className="card"><div className="empty">No samples in this window yet. The heatmap fills as packets arrive.</div></div>;
  }

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>RSSI coverage from your radio</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12.5 }}>
            Each dot is one (distance, RSSI) sample at the sender's reported position. Green = strong (above -85 dBm), yellow = workable (-85 to -110), red = marginal (below -110, near the sensitivity floor). Lines connect each sample back to your radio.
          </p>
          <CoverageMap myNode={myNode} prepared={prepared} nodes={nodes} onMessageNode={onMessageNode} />
        </div>
      </div>
      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What you can read off this.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Clusters of green in one direction = a clear path that way. A wedge of red = an obstruction (mountain, building, dense forest) blocking that arc. Same node showing two different colors at the same location = signal varies with weather or antenna position.
          </p>
        </div>
        {fit && (
          <div className="info-card">
            <p style={{ margin: 0 }}><strong>At n = {fit.exponent.toFixed(2)} (your measured environment):</strong></p>
            <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
              For a typical 130 dB budget, predicted reach is roughly {formatDist(estimateReach(fit, 130, freqMHz))}. Antenna height changes <em>n</em> more than power does — that's where doubling-of-reach lives.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function CoverageMap({ myNode, prepared, nodes, onMessageNode }: { myNode: NodeRecord; prepared: PreparedSample[]; nodes: NodeRecord[]; onMessageNode?: (n: number) => void }) {
  // Bbox: include me + all samples
  const lats = [myNode.lat!, ...prepared.map((s) => s.lat)];
  const lons = [myNode.lon!, ...prepared.map((s) => s.lon)];
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLon = Math.min(...lons), maxLon = Math.max(...lons);
  if (maxLat - minLat < 0.001) { minLat -= 0.005; maxLat += 0.005; }
  if (maxLon - minLon < 0.001) { minLon -= 0.005; maxLon += 0.005; }
  const padLat = (maxLat - minLat) * 0.2, padLon = (maxLon - minLon) * 0.2;
  minLat -= padLat; maxLat += padLat; minLon -= padLon; maxLon += padLon;

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

  const mePt = project(myNode.lat!, myNode.lon!);

  function colorFor(rssi: number): string {
    if (rssi > -85) return '#66d39a';
    if (rssi > -110) return '#ffd166';
    return '#ff6b81';
  }

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '12 / 7', background: 'var(--bg)', borderRadius: 6, overflow: 'hidden' }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`} preserveAspectRatio="xMidYMid meet">
        {tiles}
        {/* Reception rays from me to each sample, color-coded */}
        {prepared.map((s, i) => {
          const p = project(s.lat, s.lon);
          return (
            <line key={`ray-${i}`} x1={mePt.x} y1={mePt.y} x2={p.x} y2={p.y}
                  stroke={colorFor(s.rssi)} strokeWidth={1} opacity={0.25} />
          );
        })}
        {/* Sample dots */}
        {prepared.map((s, i) => {
          const p = project(s.lat, s.lon);
          return (
            <g key={`dot-${i}`} onClick={() => onMessageNode?.(s.fromNum)} style={{ cursor: onMessageNode ? 'pointer' : 'default' }}>
              <circle cx={p.x} cy={p.y} r={s.hopsAway === 0 ? 5 : 3.5} fill={colorFor(s.rssi)} stroke="rgba(0,0,0,0.6)" strokeWidth={1} opacity={0.85} />
            </g>
          );
        })}
        {/* My radio */}
        <circle cx={mePt.x} cy={mePt.y} r={10} fill="#5cc8ff" stroke="rgba(0,0,0,0.7)" strokeWidth={1.5} />
        <text x={mePt.x} y={mePt.y - 14} textAnchor="middle" fontSize={13} fill="#5cc8ff" stroke="rgba(0,0,0,0.75)" strokeWidth={3} paintOrder="stroke fill" fontFamily="ui-monospace, Menlo, monospace">
          me
        </text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Predicted reach tab — concentric rings per preset
// ─────────────────────────────────────────────────────────────────────

function ReachTab({ myNode, fit, freqMHz, activePresetName, txPower }: { myNode?: NodeRecord; fit: Fit | null; freqMHz: number; activePresetName?: string; txPower: number }) {
  if (!myNode?.lat || !myNode?.lon) {
    return <div className="card"><div className="empty">Need your radio's GPS position to render reach rings.</div></div>;
  }

  // Compute predicted reach per preset, with both FSPL (n=2) and measured fit.
  const reach = LORA_PRESETS.map((p) => {
    const budget = txPower + 2.5 + 2.5 - 1 - p.sensitivity; // assumes 2.5 dBi each side, 1 dB feedline
    const fsplKm = distanceFromLoss(budget, freqMHz);
    const fitKm = fit ? estimateReach(fit, budget, freqMHz) : null;
    const isLive = !!(activePresetName && p.id.toLowerCase() === activePresetName.toLowerCase());
    return { preset: p, fsplKm, fitKm, isLive };
  }).sort((a, b) => b.fsplKm - a.fsplKm);

  const maxReach = Math.max(...reach.map((r) => r.fsplKm));

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Predicted reach for each preset</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12.5 }}>
            Concentric rings around your radio. Solid = your <em>measured</em> environment (n = {fit ? fit.exponent.toFixed(2) : '—'}). Dashed = theoretical free-space (n = 2). The gap between solid and dashed is everything in the way.
          </p>
          <ReachMap myNode={myNode} reach={reach} maxReach={maxReach} fit={fit} />
        </div>
        <div className="card">
          <h2>Reach by preset (km)</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Preset</th>
                <th>Sensitivity</th>
                <th>FSPL reach</th>
                <th>Measured reach</th>
              </tr>
            </thead>
            <tbody>
              {reach.map((r) => (
                <tr key={r.preset.id} style={{ background: r.isLive ? 'rgba(102,211,154,0.08)' : undefined }}>
                  <td>
                    {r.preset.label}
                    {r.isLive && <span className="preset-live-tag">live</span>}
                  </td>
                  <td>{r.preset.sensitivity} dBm</td>
                  <td>{r.fsplKm < 1 ? `${(r.fsplKm * 1000).toFixed(0)} m` : `${r.fsplKm.toFixed(1)} km`}</td>
                  <td style={{ color: r.fitKm != null ? (r.fitKm < r.fsplKm * 0.3 ? 'var(--bad)' : r.fitKm < r.fsplKm * 0.6 ? 'var(--warn)' : 'var(--good)') : 'var(--text-faint)' }}>
                    {r.fitKm == null ? '—' : r.fitKm < 1 ? `${(r.fitKm * 1000).toFixed(0)} m` : `${r.fitKm.toFixed(1)} km`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>How to read the rings.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            The dashed outer rings are the best case — vacuum, no obstacles, infinite antenna height. The solid inner rings are your <em>actual</em> environment. If the gap is small, you're close to FSPL — congratulations, you've optimized antenna height and clearance. If it's huge, there's a lot of obstruction.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Caveat.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            These rings are isotropic — they assume the same obstruction in every direction. In practice your "good" direction (mountain LOS, water) may be 5× the radius of your "bad" direction (forest, downtown). The Heatmap tab shows that asymmetry directly.
          </p>
        </div>
      </div>
    </div>
  );
}

function ReachMap({ myNode, reach, maxReach, fit }: { myNode: NodeRecord; reach: Array<{ preset: any; fsplKm: number; fitKm: number | null; isLive: boolean }>; maxReach: number; fit: Fit | null }) {
  // Picks a zoom that fits maxReach with some padding.
  const earthCircKm = 40075;
  const targetSpanKm = maxReach * 2.4;
  // Find zoom where the visible width is roughly targetSpanKm
  let zoom = 17;
  for (; zoom >= 1; zoom--) {
    const widthKm = (SVG_W / (TILE_SIZE * Math.pow(2, zoom))) * earthCircKm * Math.cos((myNode.lat! * Math.PI) / 180);
    if (widthKm >= targetSpanKm) break;
  }
  zoom = clampZoom(zoom);

  const cx = lonToMercX(myNode.lon!, zoom);
  const cy = latToMercY(myNode.lat!, zoom);
  const view = { zoom, minMx: cx - SVG_W / 2, maxMx: cx + SVG_W / 2, minMy: cy - SVG_H / 2, maxMy: cy + SVG_H / 2 };
  const project = (lat: number, lon: number) => ({
    x: ((lonToMercX(lon, view.zoom) - view.minMx) / (view.maxMx - view.minMx)) * SVG_W,
    y: ((latToMercY(lat, view.zoom) - view.minMy) / (view.maxMy - view.minMy)) * SVG_H,
  });

  const mePt = project(myNode.lat!, myNode.lon!);

  // Compute pixels per km at center latitude
  const onePxToKm = ((view.maxMx - view.minMx) / SVG_W) * (40075 / (TILE_SIZE * Math.pow(2, view.zoom))) * Math.cos((myNode.lat! * Math.PI) / 180);
  const kmToPx = (km: number) => km / onePxToKm;

  // Tiles
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

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '12 / 7', background: 'var(--bg)', borderRadius: 6, overflow: 'hidden' }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`} preserveAspectRatio="xMidYMid meet">
        {tiles}
        {/* FSPL rings (dashed) — outer */}
        {reach.map((r, i) => (
          <circle key={`fspl-${i}`} cx={mePt.x} cy={mePt.y} r={kmToPx(r.fsplKm)} fill="none" stroke="rgba(92,200,255,0.5)" strokeWidth={r.isLive ? 2 : 1} strokeDasharray="6 4" />
        ))}
        {/* Measured rings (solid) — inner */}
        {fit && reach.map((r, i) => r.fitKm != null && (
          <circle key={`fit-${i}`} cx={mePt.x} cy={mePt.y} r={kmToPx(r.fitKm)} fill="rgba(255,184,107,0.04)" stroke="rgba(255,184,107,0.7)" strokeWidth={r.isLive ? 2 : 1} />
        ))}
        {/* My radio */}
        <circle cx={mePt.x} cy={mePt.y} r={10} fill="#5cc8ff" stroke="rgba(0,0,0,0.7)" strokeWidth={1.5} />
        <text x={mePt.x} y={mePt.y - 14} textAnchor="middle" fontSize={13} fill="#5cc8ff" stroke="rgba(0,0,0,0.75)" strokeWidth={3} paintOrder="stroke fill" fontFamily="ui-monospace, Menlo, monospace">me</text>

        {/* Label each preset's reach ring */}
        {reach.map((r, i) => {
          const ry = mePt.y - kmToPx(r.fsplKm);
          if (ry < 20) return null;
          return (
            <text key={`lbl-${i}`} x={mePt.x} y={ry - 4} textAnchor="middle" fontSize={11} fill="#5cc8ff" stroke="rgba(0,0,0,0.7)" strokeWidth={2.5} paintOrder="stroke fill" fontFamily="ui-monospace, Menlo, monospace">
              {r.preset.label} · {r.fsplKm.toFixed(1)} km
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Canvas chart
// ─────────────────────────────────────────────────────────────────────

function drawCoverage(ctx: CanvasRenderingContext2D, w: number, h: number, samples: PreparedSample[], fit: Fit | null, freqMHz: number) {
  ctx.clearRect(0, 0, w, h);
  const padL = 60, padR = 20, padT = 30, padB = 50;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const yMin = -135, yMax = -30;
  const yScale = (rssi: number) => padT + ((yMax - rssi) / (yMax - yMin)) * plotH;
  const distances = samples.map((s) => s.distKm).filter((d) => d > 0);
  const xMaxKm = Math.max(distances.length ? Math.max(...distances) : 1, 0.5);
  const xMaxLog = Math.max(2, Math.ceil(Math.log10(xMaxKm * 1.5)));
  const xMin = -2;
  const xScale = (km: number) => {
    if (km <= 0) return padL;
    return padL + ((Math.log10(km) - xMin) / (xMaxLog - xMin)) * plotW;
  };

  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '11px ui-monospace';
  ctx.lineWidth = 1;
  for (let r = -130; r <= -30; r += 10) {
    const y = yScale(r);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
    ctx.fillText(`${r}`, 8, y + 4);
  }
  for (const km of [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100]) {
    if (Math.log10(km) > xMaxLog) continue;
    const x = xScale(km);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
    const label = km < 1 ? `${km * 1000}m` : `${km}km`;
    ctx.fillText(label, x - 14, padT + plotH + 18);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('RSSI (dBm)', 8, padT - 12);
  ctx.fillText('distance →', padL + plotW - 70, padT + plotH + 38);

  // FSPL reference
  ctx.strokeStyle = 'rgba(92,200,255,0.5)';
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i <= 200; i++) {
    const lk = xMin + ((xMaxLog - xMin) * i) / 200;
    const km = Math.pow(10, lk);
    const predicted = 25 - fspl(km, freqMHz);
    const x = xScale(km); const y = yScale(predicted);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(92,200,255,0.6)';
  ctx.fillText('FSPL reference (n=2)', xScale(1) + 6, yScale(25 - fspl(1, freqMHz)) - 6);

  // Sample dots
  const now = Date.now();
  const oldestTs = Math.min(...samples.map((s) => s.ts), now);
  const tSpan = Math.max(1, now - oldestTs);
  for (const s of samples) {
    const age = (now - s.ts) / tSpan;
    const alpha = 1 - age * 0.7;
    const direct = s.hopsAway === 0;
    ctx.fillStyle = direct ? `rgba(102,211,154,${alpha})` : `rgba(255,209,102,${alpha})`;
    ctx.beginPath();
    ctx.arc(xScale(s.distKm), yScale(s.rssi), direct ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  }

  if (fit && samples.length >= 3) {
    ctx.strokeStyle = '#ffb86b';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    let s2 = false;
    for (let i = 0; i <= 200; i++) {
      const lk = xMin + ((xMaxLog - xMin) * i) / 200;
      const km = Math.pow(10, lk);
      const predicted = fit.intercept + fit.slope * lk;
      const x = xScale(km); const y = yScale(predicted);
      if (!s2) { ctx.moveTo(x, y); s2 = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#ffb86b';
    ctx.font = 'bold 13px ui-monospace';
    ctx.fillText(`fit n = ${fit.exponent.toFixed(2)}`, padL + plotW - 130, padT + 18);
  }

  // Legend
  ctx.font = '11px ui-monospace';
  ctx.fillStyle = '#66d39a';
  ctx.beginPath(); ctx.arc(padL + 8, padT + 11, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(230,232,238,0.85)';
  ctx.fillText('direct (hop 0)', padL + 18, padT + 14);
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(padL + 110, padT + 11, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(230,232,238,0.85)';
  ctx.fillText('relayed', padL + 120, padT + 14);
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function estimateReach(fit: Fit, budgetDb: number, freqMHz: number): number {
  // RSSI at distance d (km): intercept + slope * log10(d)
  // Reach is where RSSI = sensitivity. budget = TX_eirp + Rx_gain - sensitivity (approx)
  // We approximate by solving for log10(d) such that path_loss = budget assuming
  // intercept anchors at d=1 km.
  // Equivalent: solve intercept + slope*log10(d) = -(budget - intercept_eirp_ref)
  // Simpler: use measured n: PL(d) = PL(1) + 10n*log10(d); solve for d when PL(d) = budget
  const pl1 = 20 - fit.intercept; // path loss at 1 km assuming 20 dBm reference
  const logD = (budgetDb - pl1) / (10 * fit.exponent);
  return Math.pow(10, logD);
}

function describeExponent(n: number): string {
  if (n < 1.5) return 'unphysical — likely TX power assumed too low';
  if (n < 2.2) return 'open / line-of-sight';
  if (n < 2.8) return 'low-clutter suburban';
  if (n < 3.5) return 'typical suburban with trees';
  if (n < 4.2) return 'dense urban or moderate indoor';
  if (n < 5.0) return 'heavy obstruction';
  return 'extreme — multiwall indoor or canyon';
}

function formatDist(km: number): string {
  if (km < 0.1) return `${(km * 1000).toFixed(0)} m`;
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  if (km < 10) return `${km.toFixed(2)} km`;
  return `${km.toFixed(1)} km`;
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="range-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

