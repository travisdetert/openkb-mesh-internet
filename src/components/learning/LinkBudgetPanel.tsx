import React, { useEffect, useMemo, useState } from 'react';
import { LORA_PRESETS, DEFAULT_PRESET } from '../../data/lora-presets';
import { REGIONS } from '../../data/regions';
import type { TabId } from '../TopNav';

const REGION_MAP_FROM_RADIO: Record<string, string> = {
  US: 'US', EU_433: 'EU433', EU_868: 'EU868', CN: 'CN', JP: 'JP', ANZ: 'AU',
};

function presetIdFromRadio(name: string): string | undefined {
  const exact = LORA_PRESETS.find((p) => p.id === name);
  if (exact) return exact.id;
  const lower = name.toLowerCase();
  return LORA_PRESETS.find((p) => p.id.toLowerCase() === lower)?.id;
}

function fspl(distKm: number, freqMHz: number): number {
  if (distKm <= 0) return 0;
  return 20 * Math.log10(distKm) + 20 * Math.log10(freqMHz) + 32.44;
}
function distanceFromLoss(lossDb: number, freqMHz: number): number {
  const exp = (lossDb - 32.44 - 20 * Math.log10(freqMHz)) / 20;
  return Math.pow(10, exp);
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

interface Props {
  nodes: NodeRecord[];
  state: ConnectionState;
  myNode?: NodeRecord;
  onMessageNode?: (num: number) => void;
  go?: (id: TabId) => void;
}

type Tab = 'calc' | 'perlink' | 'compare';

export function LinkBudgetPanel({ nodes, state, myNode, onMessageNode, go }: Props) {
  const [tab, setTab] = useState<Tab>('calc');
  const [presetId, setPresetId] = useState(DEFAULT_PRESET.id);
  const [regionId, setRegionId] = useState('US');
  const [txPower, setTxPower] = useState(20);
  const [txGain, setTxGain] = useState(2.5);
  const [rxGain, setRxGain] = useState(2.5);
  const [feedlineLoss, setFeedlineLoss] = useState(1);
  const [obstructionLoss, setObstructionLoss] = useState(0);
  const [fade, setFade] = useState(10);
  const [autofilled, setAutofilled] = useState(false);

  useEffect(() => {
    if (autofilled || !state.loraConfig) return;
    const cfg = state.loraConfig;
    if (cfg.usePreset) {
      const matched = presetIdFromRadio(cfg.modemPresetName);
      if (matched) setPresetId(matched);
    }
    const mappedRegion = REGION_MAP_FROM_RADIO[cfg.regionName];
    if (mappedRegion) setRegionId(mappedRegion);
    if (cfg.txPower && cfg.txPower > 0) setTxPower(cfg.txPower);
    setAutofilled(true);
  }, [state.loraConfig, autofilled]);

  const preset = LORA_PRESETS.find((p) => p.id === presetId)!;
  const region = REGIONS.find((r) => r.id === regionId)!;
  const eirp = txPower + txGain - feedlineLoss;
  const eirpHeadroom = region.maxEirpDbm - eirp;
  const totalBudget = txPower + txGain + rxGain - feedlineLoss * 2 - preset.sensitivity - obstructionLoss - fade;
  const lineOfSightKm = distanceFromLoss(totalBudget, region.freqMHz);

  return (
    <div className="page">
      <h1 className="page-title">Link Budget</h1>
      <p className="page-sub">
        How far your signal travels is just arithmetic in dB. This panel adds and subtracts the actual gains and losses in your path so you can see <em>why</em> your range is what it is — and compare it against what you're actually measuring on the mesh.
        {state.loraConfig && (
          <span style={{ display: 'block', color: 'var(--good)', fontSize: 12, marginTop: 4 }}>
            ✓ Auto-filled from your radio: {state.loraConfig.regionName} · {state.loraConfig.modemPresetName}
            {state.loraConfig.txPower ? ` · ${state.loraConfig.txPower} dBm` : ''}
          </span>
        )}
      </p>

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'calc' ? ' active' : '')} onClick={() => setTab('calc')}>Calculator</button>
        <button className={'subnav-btn' + (tab === 'perlink' ? ' active' : '')} onClick={() => setTab('perlink')}>
          Per-link
          {nodes.length > 0 && <span className="subnav-count">{nodes.filter((n) => n.rssi !== undefined && n.rssi !== 0).length}</span>}
        </button>
        <button className={'subnav-btn' + (tab === 'compare' ? ' active' : '')} onClick={() => setTab('compare')}>Compare presets</button>
      </div>

      {tab === 'calc' && (
        <CalculatorTab
          preset={preset} setPresetId={setPresetId} presetId={presetId}
          region={region} setRegionId={setRegionId} regionId={regionId}
          txPower={txPower} setTxPower={setTxPower}
          txGain={txGain} setTxGain={setTxGain}
          rxGain={rxGain} setRxGain={setRxGain}
          feedlineLoss={feedlineLoss} setFeedlineLoss={setFeedlineLoss}
          obstructionLoss={obstructionLoss} setObstructionLoss={setObstructionLoss}
          fade={fade} setFade={setFade}
          eirp={eirp} eirpHeadroom={eirpHeadroom}
          totalBudget={totalBudget} lineOfSightKm={lineOfSightKm}
          nodes={nodes}
        />
      )}
      {tab === 'perlink' && (
        <PerLinkTab
          nodes={nodes} myNode={myNode}
          preset={preset} region={region}
          txPower={txPower} txGain={txGain} rxGain={rxGain} feedlineLoss={feedlineLoss}
          obstructionLoss={obstructionLoss} fade={fade}
          onMessageNode={onMessageNode} go={go}
        />
      )}
      {tab === 'compare' && (
        <CompareTab
          region={region} txPower={txPower} txGain={txGain} rxGain={rxGain}
          feedlineLoss={feedlineLoss} obstructionLoss={obstructionLoss} fade={fade}
          currentPresetId={presetId}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Calculator tab — original sliders + math + range estimates
// ─────────────────────────────────────────────────────────────────────

function CalculatorTab(props: any) {
  const {
    preset, presetId, setPresetId,
    region, regionId, setRegionId,
    txPower, setTxPower, txGain, setTxGain, rxGain, setRxGain,
    feedlineLoss, setFeedlineLoss, obstructionLoss, setObstructionLoss, fade, setFade,
    eirp, eirpHeadroom, totalBudget, lineOfSightKm, nodes,
  } = props;

  const ruralKm = lineOfSightKm * 0.5;
  const suburbanKm = lineOfSightKm * 0.15;
  const urbanKm = lineOfSightKm * 0.05;

  const observed = useMemo(() => {
    const rssi = nodes.map((n: NodeRecord) => n.rssi).filter((r: number): r is number => typeof r === 'number' && r !== 0);
    if (!rssi.length) return null;
    const min = Math.min(...rssi);
    const dist = distanceFromLoss(txPower + txGain + rxGain - feedlineLoss * 2 - min, region.freqMHz);
    return { min, dist };
  }, [nodes, txPower, txGain, rxGain, feedlineLoss, region.freqMHz]);

  // Diagnostic interpretation
  let diagTone: 'good' | 'warn' | 'bad' = 'good';
  let diagHead = '';
  let diagBody = '';
  if (totalBudget < 100) { diagTone = 'bad'; diagHead = 'Tight budget.'; diagBody = `Only ${totalBudget.toFixed(0)} dB of usable path loss. Free-space reach is ~${lineOfSightKm.toFixed(1)} km — anything beyond a few hundred metres through obstacles is unlikely. Slow preset + better antenna would help most.`; }
  else if (totalBudget < 130) { diagTone = 'warn'; diagHead = 'Modest budget.'; diagBody = `${totalBudget.toFixed(0)} dB. Workable for a suburban mesh. Each +6 dB doubles range — a $30 antenna upgrade or LongSlow preset would feel huge.`; }
  else { diagTone = 'good'; diagHead = 'Comfortable budget.'; diagBody = `${totalBudget.toFixed(0)} dB of usable path loss. Your radio should reach ${suburbanKm.toFixed(1)} km even through obstacles. Antenna height is your remaining lever.`; }

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your radio</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="LoRa preset" hint={`Receiver sensitivity ${preset.sensitivity} dBm`}>
              <select className="text" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                {LORA_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Region" hint={`${region.freqMHz} MHz · max EIRP ${region.maxEirpDbm} dBm`}>
              <select className="text" value={regionId} onChange={(e) => setRegionId(e.target.value)}>
                {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </Field>
            <Slider label="TX power (dBm)" value={txPower} min={2} max={30} step={1} onChange={setTxPower} hint={`${dBmToMw(txPower).toFixed(1)} mW conducted`} />
            <Slider label="Feedline loss (dB)" value={feedlineLoss} min={0} max={6} step={0.5} onChange={setFeedlineLoss} hint="Coax + connectors" />
            <Slider label="TX antenna gain (dBi)" value={txGain} min={-3} max={12} step={0.5} onChange={setTxGain} />
            <Slider label="RX antenna gain (dBi)" value={rxGain} min={-3} max={12} step={0.5} onChange={setRxGain} />
            <Slider label="Obstruction loss (dB)" value={obstructionLoss} min={0} max={40} step={1} onChange={setObstructionLoss} hint="Trees, buildings, hills" />
            <Slider label="Fade margin (dB)" value={fade} min={0} max={20} step={1} onChange={setFade} hint="Reserve for weather, multipath" />
          </div>
          {eirpHeadroom < 0 && (
            <div className="info-card" style={{ borderLeftColor: 'var(--bad)', marginTop: 12 }}>
              ⚠ EIRP {eirp.toFixed(1)} dBm exceeds {region.label} legal limit ({region.maxEirpDbm} dBm) by {(-eirpHeadroom).toFixed(1)} dB. Reduce TX power or antenna gain.
            </div>
          )}
        </div>

        <div className="card">
          <h2>The math</h2>
          <pre style={{ background: 'var(--bg)', padding: 12, borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12.5, margin: 0, lineHeight: 1.7 }}>
{`  TX power               + ${txPower.toFixed(1)} dBm
  TX antenna gain        + ${txGain.toFixed(1)} dB
  TX feedline loss       − ${feedlineLoss.toFixed(1)} dB
                         ─────────────
  EIRP                   = ${eirp.toFixed(1)} dBm   (max ${region.maxEirpDbm})

  RX antenna gain        + ${rxGain.toFixed(1)} dB
  RX feedline loss       − ${feedlineLoss.toFixed(1)} dB
  Obstruction loss       − ${obstructionLoss.toFixed(1)} dB
  Fade margin            − ${fade.toFixed(1)} dB
  Receiver sensitivity   = ${preset.sensitivity} dBm
                         ─────────────
  Available path loss    = ${totalBudget.toFixed(1)} dB`}
          </pre>
        </div>

        <div className="card">
          <h2>Estimated range</h2>
          <div className="range-grid">
            <RangeCard label="Line of sight" km={lineOfSightKm} hint="Mountaintop to mountaintop, water" />
            <RangeCard label="Rural / clear" km={ruralKm} hint="Open fields, low trees" />
            <RangeCard label="Suburban" km={suburbanKm} hint="Trees, houses, mild hills" />
            <RangeCard label="Dense urban" km={urbanKm} hint="Multi-story buildings, multipath" />
          </div>
        </div>

        {observed && (
          <div className="card">
            <h2>What you're actually seeing</h2>
            <p style={{ margin: '0 0 8px', color: 'var(--text-dim)' }}>
              Weakest live RSSI from a real node: <strong style={{ color: 'var(--text)' }}>{observed.min} dBm</strong>.
              Plugged into the same equation, that node is around <strong style={{ color: 'var(--accent)' }}>{observed.dist.toFixed(1)} km</strong> away (line-of-sight equivalent).
            </p>
            <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: 12 }}>
              If they're closer geographically, the difference is your obstruction + fade budget — that's where antenna height and clear sight lines pay off.
            </p>
          </div>
        )}
      </div>

      <div>
        <div className="info-card" style={{ borderLeftColor: diagTone === 'good' ? 'var(--good)' : diagTone === 'warn' ? 'var(--warn)' : 'var(--bad)' }}>
          <p style={{ margin: 0, fontWeight: 500 }}>{diagHead}</p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-dim)' }}>{diagBody}</p>
        </div>

        <div className="info-card">
          <p><strong>The dB game.</strong> Every <code>+3 dB</code> doubles power. Every <code>+6 dB</code> doubles distance in free space. So:</p>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            <li>Adding +3 dBi to each antenna: distance ×2.</li>
            <li>Doubling TX power (e.g. 20 → 23 dBm): distance ×1.4.</li>
            <li>Switching from LongFast to LongSlow (+6 dB sensitivity): distance ×2.</li>
            <li>Trees: ~10 dB per heavy stand. That's <code>1/3</code> the range.</li>
          </ul>
        </div>

        <div className="card">
          <h3>Where to spend dB</h3>
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12.5 }}>In order of bang-per-buck:</p>
          <ol style={{ marginTop: 8, paddingLeft: 18, color: 'var(--text-dim)', fontSize: 12.5 }}>
            <li><strong>Antenna height.</strong> Free. Roof &gt; window &gt; pocket.</li>
            <li><strong>Better antenna.</strong> $30 fiberglass omni = +3 dB.</li>
            <li><strong>Slower preset.</strong> LongSlow = +6 dB sensitivity.</li>
            <li><strong>Coax quality.</strong> RG-58 loses ~1 dB/m at 915 MHz; LMR-400 loses ~0.2 dB/m.</li>
            <li><strong>TX power.</strong> Last resort — drains battery, often EIRP-capped anyway.</li>
          </ol>
        </div>

        <div className="card">
          <h3>Region note</h3>
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12 }}>{region.dutyCycleNote}</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Per-link tab — live nodes' real vs theoretical
// ─────────────────────────────────────────────────────────────────────

function PerLinkTab({
  nodes, myNode, preset, region, txPower, txGain, rxGain, feedlineLoss, obstructionLoss, fade,
  onMessageNode, go,
}: {
  nodes: NodeRecord[]; myNode?: NodeRecord;
  preset: { id: string; sensitivity: number; label?: string };
  region: { freqMHz: number; label: string; maxEirpDbm: number };
  txPower: number; txGain: number; rxGain: number; feedlineLoss: number; obstructionLoss: number; fade: number;
  onMessageNode?: (n: number) => void; go?: (id: TabId) => void;
}) {
  const eirp = txPower + txGain - feedlineLoss;
  const myBudget = eirp + rxGain - feedlineLoss - preset.sensitivity - obstructionLoss - fade;

  // For each heard node, compute measured loss, expected FSPL at known distance,
  // excess, and predicted margin.
  const rows = useMemo(() => {
    return nodes
      .filter((n) => n.rssi !== undefined && n.rssi !== 0 && n.num !== myNode?.num)
      .map((n) => {
        const distKm = (myNode?.lat != null && myNode?.lon != null && n.lat != null && n.lon != null)
          ? haversineKm(myNode.lat, myNode.lon, n.lat, n.lon)
          : null;
        // Measured path loss between effective TX (EIRP) and effective RX (RSSI - rxGain + feedlineLoss).
        const measuredLoss = eirp - (n.rssi! - rxGain + feedlineLoss);
        const fsplDb = distKm != null ? fspl(distKm, region.freqMHz) : null;
        const excess = fsplDb != null ? measuredLoss - fsplDb : null;
        // Margin = how much more loss we could absorb before dropping below sensitivity.
        const margin = (n.rssi! - preset.sensitivity);
        return { node: n, distKm, measuredLoss, fsplDb, excess, margin };
      })
      .sort((a, b) => (b.node.rssi ?? -999) - (a.node.rssi ?? -999));
  }, [nodes, myNode, eirp, rxGain, feedlineLoss, region.freqMHz, preset.sensitivity]);

  const [selectedNum, setSelectedNum] = useState<number | null>(null);
  const selectedRow = rows.find((r) => r.node.num === selectedNum) ?? rows[0];

  const exportCsv = () => {
    const csvRows = rows.map((r) => ({
      short_name: r.node.shortName || '',
      long_name: r.node.longName || '',
      node_hex: shortHex(r.node.num),
      distance_km: r.distKm?.toFixed(3) ?? '',
      rssi_dbm: r.node.rssi?.toString() ?? '',
      snr_db: r.node.snr?.toFixed(2) ?? '',
      hops: r.node.hopsAway?.toString() ?? '',
      measured_loss_db: r.measuredLoss.toFixed(2),
      fspl_db: r.fsplDb?.toFixed(2) ?? '',
      excess_db: r.excess?.toFixed(2) ?? '',
      margin_db: r.margin.toFixed(1),
    }));
    downloadCsv(csvRows, 'link-budget-perlink');
  };

  if (rows.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <p style={{ margin: '0 0 6px' }}>No live RSSI measurements yet.</p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
            This tab measures real link quality against the budget you've set in the Calculator. As soon as your radio hears any node with a non-zero RSSI, that node appears here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, alignItems: 'start' }}>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
          <h2 style={{ margin: 0 }}>Per-link measurements</h2>
          <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={exportCsv}>⇩ CSV</button>
        </div>
        <table className="data" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th>Node</th>
              <th>Distance</th>
              <th>RSSI</th>
              <th>Margin</th>
              <th>Measured loss</th>
              <th>FSPL</th>
              <th>Excess</th>
              <th>Hops</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const selected = selectedRow?.node.num === r.node.num;
              const marginTone = r.margin > 20 ? 'var(--good)' : r.margin > 6 ? 'var(--warn)' : 'var(--bad)';
              const excessTone = r.excess == null ? 'var(--text-faint)' : r.excess < 10 ? 'var(--good)' : r.excess < 25 ? 'var(--warn)' : 'var(--bad)';
              return (
                <tr
                  key={r.node.num}
                  onClick={() => setSelectedNum(r.node.num)}
                  style={{ cursor: 'pointer', background: selected ? 'var(--bg-elev-2)' : undefined }}
                >
                  <td style={{ color: colorForNode(r.node.num) }}>{r.node.shortName || shortHex(r.node.num)}</td>
                  <td>{r.distKm != null ? (r.distKm < 1 ? `${(r.distKm * 1000).toFixed(0)} m` : `${r.distKm.toFixed(2)} km`) : '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{r.node.rssi} dBm</td>
                  <td style={{ color: marginTone, fontFamily: 'var(--mono)' }}>+{r.margin.toFixed(0)} dB</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{r.measuredLoss.toFixed(0)} dB</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{r.fsplDb != null ? `${r.fsplDb.toFixed(0)} dB` : '—'}</td>
                  <td style={{ color: excessTone, fontFamily: 'var(--mono)' }}>
                    {r.excess != null ? `${r.excess > 0 ? '+' : ''}${r.excess.toFixed(0)} dB` : '—'}
                  </td>
                  <td>{r.node.hopsAway ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        {selectedRow && (
          <LinkDetail
            row={selectedRow}
            preset={preset}
            region={region}
            txPower={txPower} txGain={txGain} rxGain={rxGain}
            feedlineLoss={feedlineLoss} obstructionLoss={obstructionLoss} fade={fade}
            myBudget={myBudget}
            onMessageNode={onMessageNode}
            go={go}
          />
        )}
      </div>
    </div>
  );
}

function LinkDetail({
  row, preset, region, txPower, txGain, rxGain, feedlineLoss, obstructionLoss, fade, myBudget,
  onMessageNode, go,
}: any) {
  const { node, distKm, measuredLoss, fsplDb, excess, margin } = row;
  const eirp = txPower + txGain - feedlineLoss;

  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <h3 style={{ marginTop: 0, color: colorForNode(node.num), fontSize: 15, textTransform: 'none', letterSpacing: 0 }}>
        {node.shortName || '????'}
        {node.longName && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-faint)' }}>{node.longName}</span>}
      </h3>

      <pre style={{ background: 'var(--bg)', padding: 10, borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 11.5, margin: '8px 0', lineHeight: 1.6 }}>
{`  EIRP from us           = ${eirp.toFixed(1)} dBm
  RSSI heard at them     = ${node.rssi} dBm
  - RX antenna gain      − ${rxGain.toFixed(1)} dB
  + RX feedline loss     + ${feedlineLoss.toFixed(1)} dB
                         ─────────────
  Measured path loss     = ${measuredLoss.toFixed(1)} dB`}
      </pre>

      {distKm != null && fsplDb != null && excess != null && (
        <pre style={{ background: 'var(--bg)', padding: 10, borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 11.5, margin: '8px 0', lineHeight: 1.6 }}>
{`  Distance (haversine)   = ${distKm < 1 ? `${(distKm * 1000).toFixed(0)} m` : `${distKm.toFixed(2)} km`}
  FSPL at ${region.freqMHz} MHz       = ${fsplDb.toFixed(1)} dB
  Excess over FSPL       = ${excess > 0 ? '+' : ''}${excess.toFixed(1)} dB`}
        </pre>
      )}

      <pre style={{ background: 'var(--bg)', padding: 10, borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 11.5, margin: '8px 0', lineHeight: 1.6 }}>
{`  RX sensitivity         = ${preset.sensitivity} dBm
  Margin above floor     = ${margin > 0 ? '+' : ''}${margin.toFixed(1)} dB`}
      </pre>

      {excess != null && (
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-dim)' }}>
          {excess < 10 && 'Effectively line-of-sight — your antennas are seeing each other directly.'}
          {excess >= 10 && excess < 25 && 'Typical sub-urban path. Trees, a few buildings, mild terrain.'}
          {excess >= 25 && excess < 40 && 'Heavy obstruction. Dense trees, multi-story buildings, terrain shadow.'}
          {excess >= 40 && 'Marginal link. The signal is doing real work to get to you. One more obstacle and it drops.'}
        </p>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        {onMessageNode && (
          <button className="primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onMessageNode(node.num)}>Message</button>
        )}
        {go && (
          <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => go('map')}>View on Map</button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Compare presets tab
// ─────────────────────────────────────────────────────────────────────

function CompareTab({
  region, txPower, txGain, rxGain, feedlineLoss, obstructionLoss, fade, currentPresetId,
}: {
  region: { freqMHz: number; label: string; maxEirpDbm: number };
  txPower: number; txGain: number; rxGain: number; feedlineLoss: number; obstructionLoss: number; fade: number;
  currentPresetId: string;
}) {
  const rows = useMemo(() => {
    return LORA_PRESETS.map((p) => {
      const budget = txPower + txGain + rxGain - feedlineLoss * 2 - p.sensitivity - obstructionLoss - fade;
      const losKm = distanceFromLoss(budget, region.freqMHz);
      return { p, budget, losKm };
    }).sort((a, b) => b.budget - a.budget);
  }, [region.freqMHz, txPower, txGain, rxGain, feedlineLoss, obstructionLoss, fade]);
  const maxBudget = Math.max(...rows.map((r) => r.budget));
  const minBudget = Math.min(...rows.map((r) => r.budget));

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Same scenario, every preset</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 12.5 }}>
            Holding TX power, antennas, obstruction, and fade margin constant, here's how the available path loss changes when you swap modem presets. Each row's bar shows the budget relative to the strongest preset.
          </p>
          <div className="preset-compare">
            <div className="preset-compare-head" style={{ gridTemplateColumns: '160px 1fr 120px 120px' }}>
              <div>Preset</div>
              <div>Available path loss</div>
              <div>Sensitivity</div>
              <div>LOS reach</div>
            </div>
            {rows.map((r) => {
              const isLive = r.p.id === currentPresetId;
              const widthPct = ((r.budget - minBudget + 20) / (maxBudget - minBudget + 20)) * 100;
              return (
                <div key={r.p.id} className={'preset-compare-row' + (isLive ? ' active' : '')} style={{ gridTemplateColumns: '160px 1fr 120px 120px' }}>
                  <div className="preset-name">
                    {r.p.label}
                    {isLive && <span className="preset-live-tag">live</span>}
                  </div>
                  <div className="preset-bar-cell">
                    <div className="preset-bar">
                      <div className="preset-bar-fill" style={{ width: `${widthPct}%`, background: 'var(--accent)' }} />
                    </div>
                    <div className="preset-bar-label">{r.budget.toFixed(1)} dB</div>
                  </div>
                  <div className="preset-meta">{r.p.sensitivity} dBm</div>
                  <div className="preset-meta">{r.losKm > 100 ? r.losKm.toFixed(0) : r.losKm.toFixed(1)} km</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What this tells you.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            The budget difference between the slowest and fastest preset is the receiver-sensitivity difference — typically ~20 dB across the LongSlow ↔ ShortTurbo range. Twenty dB is 10× the range in free space. The cost is throughput: slow presets carry one-tenth the bytes per second.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Trade-off triangle.</strong></p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12.5, color: 'var(--text-dim)' }}>
            <li><strong>Range</strong>: slower preset = more sensitivity = longer reach.</li>
            <li><strong>Throughput</strong>: faster preset = more bytes/sec.</li>
            <li><strong>Channel capacity</strong>: slower preset = each packet eats more airtime = fewer nodes can talk per minute. A 30-node mesh on LongSlow saturates fast.</li>
          </ul>
        </div>
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)' }}>
          <p style={{ margin: 0 }}><strong>EU868 caveat.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            EU868's 1% duty-cycle cap means slow presets cap your message rate at single digits per hour. LongFast is typically the EU sweet spot.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function dBmToMw(dbm: number): number { return Math.pow(10, dbm / 10); }

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4, fontFamily: 'var(--mono)' }}>{hint}</div>}
    </div>
  );
}

function Slider({
  label, value, min, max, step, onChange, hint,
}: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; hint?: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        <span>{label}</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} style={{ width: '100%' }}
             onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function RangeCard({ label, km, hint }: { label: string; km: number; hint: string }) {
  const display = km > 100 ? km.toFixed(0) : km > 10 ? km.toFixed(1) : km.toFixed(2);
  return (
    <div className="range-card">
      <div className="label">{label}</div>
      <div className="value">{display}<span className="unit">km</span></div>
      <div className="hint">{hint}</div>
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
