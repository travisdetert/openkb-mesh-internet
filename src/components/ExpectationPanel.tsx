import React, { useMemo, useState } from 'react';
import { listInstances, getInstance } from '../concepts/registry';
import type { Instance } from '../concepts/schema';
import {
  loraAirtimeMs,
  rangeMeters,
  hopChain,
  dutyCycleFraction,
  summarize,
  perHopProbabilities,
} from '../concepts/calc';

interface Props {
  nodes?: NodeRecord[];
  myNode?: NodeRecord;
  state?: ConnectionState;
}

type Tab = 'calc' | 'live' | 'tables';

export function ExpectationPanel({ nodes = [], myNode, state }: Props = {}) {
  const [tab, setTab] = useState<Tab>('calc');
  const protocols = listInstances('protocol');
  const modulations = listInstances('modulation');
  const antennas = listInstances('antenna');
  const environments = listInstances('environment');
  const updates = listInstances('update');

  const [protocolId, setProtocolId] = useState('meshtastic');
  const [modulationId, setModulationId] = useState('LongFast');
  const [txAntennaId, setTxAntennaId] = useState('stock');
  const [rxAntennaId, setRxAntennaId] = useState('stock');
  const [environmentId, setEnvironmentId] = useState('suburban');
  const [updateId, setUpdateId] = useState('text-message');
  const [hops, setHops] = useState(3);
  const [txPowerOverride, setTxPowerOverride] = useState<number | null>(null);

  const protocol = getInstance('protocol', protocolId);
  const modulation = getInstance('modulation', modulationId);
  const txAntenna = getInstance('antenna', txAntennaId);
  const rxAntenna = getInstance('antenna', rxAntennaId);
  const environment = getInstance('environment', environmentId);
  const update = getInstance('update', updateId);
  const routing = protocol ? getInstance('routing_scheme', String(protocol.routing_scheme)) : null;

  const result = useMemo(() => {
    if (!protocol || !modulation || !txAntenna || !rxAntenna || !environment || !update || !routing) return null;

    const txPower = txPowerOverride ?? Number(protocol.tx_power_dbm_typical ?? 14);
    const sf = Number(modulation.sf);
    const bw = Number(modulation.bw);
    const cr = Number(modulation.cr);
    const sensitivity = Number(modulation.sensitivity_dbm);
    const payloadBytes = Number(update.payload_bytes_typical) + 16;

    const airtimeMs = loraAirtimeMs(payloadBytes, sf, bw, cr);

    const ranges = rangeMeters({
      txPowerDbm: txPower,
      txGainDbi: Number(txAntenna.gain_dbi),
      rxGainDbi: Number(rxAntenna.gain_dbi),
      rxSensitivityDbm: sensitivity,
      cableLossDb: 1,
      linkMarginDb: 6,
      refDistanceM: Number(environment.ref_distance_m),
      refPathLossDb: Number(environment.ref_path_loss_db),
      pathLossExponent: Number(environment.path_loss_exponent),
      shadowFadingSigmaDb: Number(environment.shadow_fading_sigma_db),
    });

    const chain = hopChain({
      hopCount: hops,
      perHopRangeM: ranges.p50,
      airtimePerHopMs: airtimeMs,
      hopLatencyMs: Number(routing.hop_latency_ms_typical),
      channelBusyMs: 200,
      hopLossProbability: Number(routing.hop_loss_probability_typical),
      routeDiscoveryHops: Number(routing.route_discovery_cost_hops),
      retransmits: Number(routing.retransmits_on_loss),
    });

    const dutyFrac = dutyCycleFraction(
      chain.airtimeConsumedMsPerPacket,
      Number(update.frequency_hz) || 0,
      1,
    );

    return { airtimeMs, ranges, chain, dutyFrac, txPower };
  }, [protocol, modulation, txAntenna, rxAntenna, environment, update, routing, hops, txPowerOverride]);

  const overHopLimit = routing ? hops > Number(routing.max_practical_hops) : false;

  return (
    <div className="page">
      <h1 className="page-title">What can I expect?</h1>
      <p className="page-sub">
        Pick a protocol, an environment, an update, and how many hops away the destination is. The numbers below are
        honest ranges (10th–90th percentile) — RF is probabilistic, not deterministic.
      </p>

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'calc' ? ' active' : '')} onClick={() => setTab('calc')}>Calculator</button>
        <button className={'subnav-btn' + (tab === 'live' ? ' active' : '')} onClick={() => setTab('live')}>Live comparison</button>
        <button className={'subnav-btn' + (tab === 'tables' ? ' active' : '')} onClick={() => setTab('tables')}>Reference tables</button>
      </div>

      {tab === 'live' && <LiveComparisonTab nodes={nodes} myNode={myNode} state={state} />}
      {tab === 'tables' && <ReferenceTablesTab />}
      {tab === 'calc' && (
      <div className="layout-split-wide">
        <div>
          <div className="card">
            <h2>Inputs</h2>
            <div className="range-grid">
              <Picker label="Protocol"     value={protocolId}    options={protocols}    onChange={setProtocolId} />
              <Picker label="Modulation"   value={modulationId}  options={modulations}  onChange={setModulationId} />
              <Picker label="Tx Antenna"   value={txAntennaId}   options={antennas}     onChange={setTxAntennaId} />
              <Picker label="Rx Antenna"   value={rxAntennaId}   options={antennas}     onChange={setRxAntennaId} />
              <Picker label="Environment"  value={environmentId} options={environments} onChange={setEnvironmentId} />
              <Picker label="Update"       value={updateId}      options={updates}      onChange={setUpdateId} />
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)', marginBottom: 4 }}>
                Hops to destination: <strong style={{ color: 'var(--text)' }}>{hops}</strong>
                {overHopLimit && routing && (
                  <span style={{ color: '#ffae5c', marginLeft: 8 }}>
                    (above {String(routing.name)}'s practical limit of {String(routing.max_practical_hops)})
                  </span>
                )}
              </label>
              <input type="range" min={0} max={10} value={hops} onChange={(e) => setHops(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
            <div style={{ marginTop: 8 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)', marginBottom: 4 }}>
                Tx Power: <strong style={{ color: 'var(--text)' }}>
                  {txPowerOverride ?? Number(protocol?.tx_power_dbm_typical ?? 14)} dBm
                </strong>
                {txPowerOverride === null && <span style={{ marginLeft: 8 }}>(protocol default)</span>}
              </label>
              <input type="range" min={-10} max={30} value={txPowerOverride ?? Number(protocol?.tx_power_dbm_typical ?? 14)}
                     onChange={(e) => setTxPowerOverride(Number(e.target.value))} style={{ width: '100%' }} />
            </div>
          </div>

          {result && (
            <div className="card">
              <h2>Outputs</h2>
              <div className="range-grid">
                <Stat label="Per-hop range (worst 10%)" value={fmtRange(result.ranges.p10)} hint="bottom of the link-margin curve" />
                <Stat label="Per-hop range (typical)"   value={fmtRange(result.ranges.p50)} hint="50th percentile — the honest middle" />
                <Stat label="Per-hop range (best 10%)"  value={fmtRange(result.ranges.p90)} hint="ideal placement, low fading" />
                <Stat label="Total reach"               value={fmtRange(result.chain.totalReachM)} hint={`${hops} hops at ~60% spacing`} />
                <Stat label="One-way latency (p50)"     value={fmtSec(result.chain.oneWayLatencyP50Ms)} />
                <Stat label="One-way latency (p95)"     value={fmtSec(result.chain.oneWayLatencyP95Ms)} hint="includes retries + channel busy" />
                <Stat label="Round-trip (p50)"          value={fmtSec(result.chain.roundTripLatencyP50Ms)} hint="text → reply" />
                <Stat label="Round-trip (p95)"          value={fmtSec(result.chain.roundTripLatencyP95Ms)} />
                <Stat label="Delivery probability"      value={fmtPct(result.chain.successProbability)} hint={`(1 − loss)^${hops}`} />
                <Stat label="Airtime / packet (all hops)" value={fmtMs(result.chain.airtimeConsumedMsPerPacket)} hint={`${hops + 1} transmissions`} />
                <Stat label="Duty-cycle budget used"    value={fmtPct(Math.min(result.dutyFrac, 5))} hint="at the typical emit rate; 100% = legal cap" />
              </div>
              <div className="info-card" style={{ marginTop: 12 }}>
                <p style={{ margin: 0 }}><strong>{summarize(result.chain, result.dutyFrac)}</strong></p>
              </div>
            </div>
          )}

          {result && hops > 0 && routing && (
            <div className="card">
              <h2>Hop chain</h2>
              <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 0 }}>
                Each hop adds latency and a chance of loss. Watch where the cumulative probability crosses 50%.
              </p>
              <HopChainViz
                hops={hops}
                perHopMs={result.chain.oneWayLatencyP50Ms / hops}
                perHopProbabilities={perHopProbabilities(Number(routing.hop_loss_probability_typical), hops)}
              />
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>What "range" actually means</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: 0 }}>
              RF range isn't a circle — it's a fuzzy probability cloud. The numbers above are an 80% confidence
              interval based on the chosen Environment's shadow-fading σ. Within the same nominal range you'll
              still drop into pockets with no signal, and you'll occasionally hit a peer well past the p90 distance.
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Why hops aren't free</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: 0 }}>
              On flooding meshes (Meshtastic, BATMAN) the originator <em>and</em> every relay each transmit the
              packet once. {hops + 1} transmissions of a {result ? result.airtimeMs.toFixed(2) : '—'} ms airtime
              packet means that single user-facing message consumes about {result ? fmtMs(result.chain.airtimeConsumedMsPerPacket) : '—'} of
              shared channel time. Two of those per minute and the channel is saturated for everyone.
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Why your reply is slow</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: 0 }}>
              Round-trip = (airtime + per-hop latency + channel-busy wait) × 2 × hops. For Meshtastic LongFast at 3
              hops each way, you're looking at ~6–14 seconds typical. That's not a bug — it's the medium. Optical
              fiber moves bits at light speed; this moves bits at human speed and pays for the privilege of needing
              no infrastructure.
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Why people overestimate range</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: 0 }}>
              Vendor specs are line-of-sight, antennas at 10 m, no obstacles, no other users on the channel. Real
              life has none of those. A 15 km vendor claim is honest in <code>free-space</code>; in <code>urban-dense</code>
              it's a 500 m connection. Pick the Environment that matches your actual install and trust those numbers.
            </p>
          </div>

          {routing && (
            <div className="info-card">
              <p style={{ margin: 0 }}>
                <strong>Routing: {String(routing.name)}</strong>
                <br />
                <span style={{ color: 'var(--text-dim)' }}>{String(routing.summary)}</span>
              </p>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Live comparison tab
// ─────────────────────────────────────────────────────────────────────

function LiveComparisonTab({ nodes, myNode, state }: { nodes: NodeRecord[]; myNode?: NodeRecord; state?: ConnectionState }) {
  const myNum = state?.myInfo?.myNodeNum;
  const stats = useMemo(() => {
    const direct = nodes.filter((n) => n.num !== myNum && n.hopsAway === 0 && n.rssi !== undefined && n.rssi !== 0 && n.lat !== undefined && n.lon !== undefined);
    const distances = direct
      .filter(() => myNode?.lat != null)
      .map((n) => haversineKm(myNode!.lat!, myNode!.lon!, n.lat!, n.lon!))
      .filter((d) => d > 0);
    distances.sort((a, b) => a - b);

    const medianDistKm = distances.length > 0 ? distances[Math.floor(distances.length / 2)] : null;
    const maxDistKm = distances.length > 0 ? distances[distances.length - 1] : null;

    const rssiVals = nodes.filter((n) => n.num !== myNum && n.rssi !== undefined && n.rssi !== 0).map((n) => n.rssi!).sort((a, b) => a - b);
    const medianRssi = rssiVals.length > 0 ? rssiVals[Math.floor(rssiVals.length / 2)] : null;

    return { directCount: direct.length, medianDistKm, maxDistKm, medianRssi, totalKnown: nodes.length };
  }, [nodes, myNode, myNum]);

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your mesh's measured numbers vs. theory</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 13 }}>
            The Calculator tab gives theoretical answers from a model. This tab compares those theoretical answers against what your radio is actually measuring right now.
          </p>

          <div className="range-grid">
            <Stat label="Direct neighbors heard" value={String(stats.directCount)} hint={`Out of ${stats.totalKnown} total known`} />
            <Stat label="Median direct distance" value={stats.medianDistKm != null ? (stats.medianDistKm < 1 ? `${(stats.medianDistKm * 1000).toFixed(0)} m` : `${stats.medianDistKm.toFixed(2)} km`) : '—'} hint="From your radio to direct neighbors with GPS" />
            <Stat label="Max direct distance" value={stats.maxDistKm != null ? (stats.maxDistKm < 1 ? `${(stats.maxDistKm * 1000).toFixed(0)} m` : `${stats.maxDistKm.toFixed(2)} km`) : '—'} hint="Your longest hop-0 reception" />
            <Stat label="Median RSSI" value={stats.medianRssi !== null ? `${stats.medianRssi} dBm` : '—'} hint="Typical received strength across the mesh" />
          </div>

          {stats.medianDistKm !== null && (
            <div className="info-card" style={{ marginTop: 14 }}>
              <p style={{ margin: 0 }}><strong>Interpretation</strong></p>
              <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-dim)' }}>
                Your median direct-neighbor distance is <strong>{stats.medianDistKm < 1 ? `${(stats.medianDistKm * 1000).toFixed(0)} m` : `${stats.medianDistKm.toFixed(1)} km`}</strong>. {' '}
                {stats.medianDistKm < 1 ? 'Tight pack — likely indoors or all at one location.' :
                 stats.medianDistKm < 5 ? 'Typical suburban LoRa mesh — most nodes within walking distance.' :
                 stats.medianDistKm < 20 ? 'Spread-out suburban or mixed terrain — comfortable mesh range.' :
                 'Large geographic spread — you likely have elevated nodes or open terrain.'}
                {' '}
                The "Per-hop range (typical)" output in the Calculator tab should land near this number if you pick the matching Environment. If theory says 10 km but you're seeing 2 km, your environment is more obstructed than the model assumes.
              </p>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Direct-neighbor distances</h2>
          {stats.directCount === 0 || stats.medianDistKm === null ? (
            <div className="empty">No direct-neighbor positions yet — need at least one hop-0 reception from a node with GPS, plus your own position.</div>
          ) : (
            <table className="data">
              <thead><tr><th>Node</th><th>Distance</th><th>RSSI</th><th>SNR</th></tr></thead>
              <tbody>
                {nodes
                  .filter((n) => n.num !== myNum && n.hopsAway === 0 && n.lat !== undefined && n.lon !== undefined && n.rssi !== undefined && n.rssi !== 0)
                  .map((n) => {
                    const d = myNode?.lat != null ? haversineKm(myNode.lat, myNode.lon!, n.lat!, n.lon!) : null;
                    return { n, d };
                  })
                  .filter((r) => r.d != null)
                  .sort((a, b) => (a.d! - b.d!))
                  .map(({ n, d }) => (
                    <tr key={n.num}>
                      <td style={{ color: 'var(--accent)' }}>{n.shortName || '????'}</td>
                      <td>{d! < 1 ? `${(d! * 1000).toFixed(0)} m` : `${d!.toFixed(2)} km`}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{n.rssi} dBm</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{n.snr !== undefined ? n.snr.toFixed(1) : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>How to use this.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Open the Calculator tab in a second window, pick the Environment that matches your area, and dial the protocol to your radio's actual preset and TX power. Compare the "per-hop range (typical)" output to the median distance shown here.
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            If the calculator overshoots by 2× or more, your real environment is harder than its model. Switch to a more pessimistic environment (urban → urban-dense). If it undershoots, you might be in unusually open terrain — try the rural or LOS preset.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>RSSI sanity.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            A typical suburban LoRa mesh has a median RSSI somewhere between -90 and -110 dBm across direct neighbors. Anything stronger means you're surrounded by close-range nodes; anything weaker and you're operating near the edge.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Reference tables tab
// ─────────────────────────────────────────────────────────────────────

function ReferenceTablesTab() {
  // Pre-computed reference numbers for typical deployments
  const SCENARIOS = [
    { name: 'Urban handheld',   preset: 'LongFast',     env: 'Urban dense',    range: '0.5–2 km', hops: '1–2', rtt: '4–8 s', delivery: '80–95%', notes: 'Stock antenna, ground level, lots of obstructions.' },
    { name: 'Suburban handheld',preset: 'LongFast',     env: 'Suburban',       range: '1–5 km',   hops: '1–3', rtt: '4–10 s', delivery: '85–95%', notes: 'Typical neighborhood with trees, houses, mild hills.' },
    { name: 'Rural handheld',   preset: 'LongFast',     env: 'Rural',          range: '3–15 km',  hops: '1–2', rtt: '3–8 s', delivery: '90–98%', notes: 'Open fields, low foliage, lots of clear line-of-sight.' },
    { name: 'Roof omni → roof omni', preset: 'LongFast', env: 'LOS suburban',  range: '10–30 km', hops: '1', rtt: '2–4 s', delivery: '95–99%', notes: 'Both nodes well above local rooftops.' },
    { name: 'Mountaintop relay',preset: 'LongFast',     env: 'LOS',            range: '50–200 km',hops: '1', rtt: '2–4 s', delivery: '98%+',   notes: 'Summit-to-summit, big antennas. Limited by Earth\'s curvature, not LoRa.' },
    { name: 'Solar router (24/7)', preset: 'LongFast',  env: 'Mixed',          range: '5–20 km',  hops: '1–2', rtt: '—',  delivery: '90–95%', notes: 'Headless ESP32, omni antenna, fixed install on a pole.' },
    { name: 'Dense mesh (50+)',  preset: 'ShortFast',   env: 'Urban',          range: '0.3–1 km', hops: '2–4', rtt: '3–6 s', delivery: '70–90%', notes: 'Channel utilization is the bottleneck. Faster preset = less collision.' },
    { name: 'Long-range/sparse',preset: 'LongSlow',     env: 'Rural',          range: '5–25 km',  hops: '1–2', rtt: '15–30 s', delivery: '80–90%', notes: 'Maximum sensitivity, slow as molasses, ideal for few-node networks.' },
  ];

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Reference tables — what to expect by deployment style</h2>
      <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 13 }}>
        Pre-computed expectations for the most common Meshtastic setups. Numbers are realistic ranges, not vendor specs. Compare your own mesh against the closest matching scenario.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Preset</th>
            <th>Per-hop range</th>
            <th>Typical hops</th>
            <th>Round-trip</th>
            <th>Delivery</th>
          </tr>
        </thead>
        <tbody>
          {SCENARIOS.map((s, i) => (
            <tr key={i}>
              <td>
                <div style={{ color: 'var(--accent)' }}>{s.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{s.notes}</div>
              </td>
              <td style={{ fontFamily: 'var(--mono)' }}>{s.preset}</td>
              <td style={{ fontFamily: 'var(--mono)' }}>{s.range}</td>
              <td style={{ fontFamily: 'var(--mono)' }}>{s.hops}</td>
              <td style={{ fontFamily: 'var(--mono)' }}>{s.rtt}</td>
              <td style={{ fontFamily: 'var(--mono)' }}>{s.delivery}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="info-card" style={{ marginTop: 14 }}>
        <p style={{ margin: 0 }}><strong>Reading this table.</strong></p>
        <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
          Pick the row that most resembles your deployment. The range, hops, RTT and delivery numbers are what you should expect — anything significantly worse means there's a debuggable issue (bad antenna, wrong polarization, too much congestion, wrong preset). Anything significantly better means you got lucky with terrain or did the install carefully.
        </p>
      </div>
    </div>
  );
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function Picker({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Instance[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="range-card">
      <div className="label">{label}</div>
      <select className="text" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
        {options.map((o) => (
          <option key={o.ID} value={o.ID}>{String(o.label ?? o.name ?? o.ID)}</option>
        ))}
      </select>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="range-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function HopChainViz({ hops, perHopMs, perHopProbabilities }: {
  hops: number;
  perHopMs: number;
  perHopProbabilities: number[];
}) {
  let cumulativeP = 1;
  let cumulativeMs = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, fontFamily: 'var(--mono)', fontSize: 11, overflowX: 'auto' }}>
      <NodeBox label="src" />
      {Array.from({ length: hops }, (_, i) => {
        cumulativeP *= perHopProbabilities[i];
        cumulativeMs += perHopMs;
        const cliff = cumulativeP < 0.5;
        return (
          <React.Fragment key={i}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 90 }}>
              <div style={{ color: 'var(--text-faint)' }}>+{perHopMs.toFixed(0)} ms</div>
              <div style={{ width: '100%', height: 2, background: cliff ? '#ff7777' : '#5cc8ff', margin: '6px 0' }} />
              <div style={{ color: 'var(--text-faint)' }}>× {(perHopProbabilities[i] * 100).toFixed(0)}%</div>
              <div style={{ marginTop: 4, color: cliff ? '#ff9999' : 'var(--text)', fontWeight: 600 }}>
                {(cumulativeMs / 1000).toFixed(1)}s · {(cumulativeP * 100).toFixed(0)}%
              </div>
            </div>
            <NodeBox label={`hop${i + 1}`} dim={cliff} />
          </React.Fragment>
        );
      })}
    </div>
  );
}

function NodeBox({ label, dim }: { label: string; dim?: boolean }) {
  return (
    <div style={{
      minWidth: 56,
      padding: '6px 10px',
      border: `1px solid ${dim ? 'rgba(255,120,120,0.4)' : 'rgba(92,200,255,0.5)'}`,
      borderRadius: 6,
      textAlign: 'center',
      color: dim ? '#ff9999' : 'var(--text)',
      background: 'var(--bg)',
    }}>
      {label}
    </div>
  );
}

function fmtRange(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m > 10_000 ? 0 : 1)} km`;
  return `${m.toFixed(0)} m`;
}
function fmtSec(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
function fmtPct(f: number): string {
  return `${(f * 100).toFixed(0)}%`;
}
