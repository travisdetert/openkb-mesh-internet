import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TabId } from '../TopNav';
import { LORA_PRESETS } from '../../data/lora-presets';
import { LearningModeBadge, LearningSeeAlso } from './LearningChrome';

type Tab = 'demo' | 'mine' | 'math';

interface Props {
  nodes: NodeRecord[];
  links: LinkRow[];
  state: ConnectionState;
  myNode?: NodeRecord;
  go?: (id: TabId) => void;
}

export function MeshRoutingPanel({ nodes, links, state, myNode, go }: Props) {
  const [tab, setTab] = useState<Tab>('demo');

  return (
    <div className="page">
      <h1 className="page-title">Mesh Routing</h1>
      <p className="page-sub">
        Meshtastic uses <strong>managed flood routing</strong>: every node retransmits messages it hasn't seen before, with random backoff and a hop counter. Simple, robust, ugly at scale.
      </p>
      <LearningModeBadge mode={nodes.length > 0 ? 'mixed' : 'offline'} />

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'demo' ? ' active' : '')} onClick={() => setTab('demo')}>Demo</button>
        <button className={'subnav-btn' + (tab === 'mine' ? ' active' : '')} onClick={() => setTab('mine')}>
          Your mesh {nodes.length > 0 && <span className="subnav-count">{nodes.length}</span>}
        </button>
        <button className={'subnav-btn' + (tab === 'math' ? ' active' : '')} onClick={() => setTab('math')}>Math</button>
      </div>

      {tab === 'demo' && <DemoTab nodes={nodes} go={go} />}
      {tab === 'mine' && <YourMeshTab nodes={nodes} links={links} myNode={myNode} state={state} go={go} />}
      {tab === 'math' && <MathTab state={state} nodes={nodes} />}

      {go && (
        <LearningSeeAlso go={go} links={[
          { to: 'reality',    label: 'Reality Check', blurb: 'Honest answers about how far flooding actually scales.' },
          { to: 'map',        label: 'Map',           blurb: 'See which of your neighbours are direct vs. relayed.' },
          { to: 'traceroute', label: 'Traceroute',    blurb: 'Watch a specific packet take its hops in real time.' },
        ]} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Demo tab — animated flood
// ─────────────────────────────────────────────────────────────────────

function DemoTab({ nodes, go }: { nodes: NodeRecord[]; go?: (id: TabId) => void }) {
  const [hopLimit, setHopLimit] = useState(3);
  const [density, setDensity] = useState(10);
  const [playing, setPlaying] = useState(true);
  const [tick, setTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setTick((t) => t + 1), 80);
    return () => clearInterval(id);
  }, [playing]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawMesh(ctx, c.width, c.height, density, hopLimit, tick);
  }, [tick, density, hopLimit]);

  const reachableEstimate = Math.min(density, Math.floor(1 + density * (1 - Math.pow(0.4, hopLimit))));
  const directHeard = nodes.filter((n) => (n.hopsAway ?? 0) === 0).length;
  const relayed = nodes.filter((n) => (n.hopsAway ?? 0) > 0).length;
  const maxHopsSeen = nodes.reduce((m, n) => Math.max(m, n.hopsAway ?? 0), 0);

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Watch a packet flood through a mesh</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className={playing ? 'primary' : 'ghost'} style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => setPlaying(!playing)}>
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>
              <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setTick((t) => t + 10)} disabled={playing}>Step</button>
              <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setTick(0)}>Reset</button>
            </div>
          </div>
          <canvas ref={canvasRef} width={900} height={420} style={{ width: '100%', height: 420, display: 'block', background: 'var(--bg)', borderRadius: 6 }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 12 }}>
            <Slider label="Hop limit" value={hopLimit} min={1} max={7} step={1} onChange={setHopLimit} hint="Default is 3. Max is 7." />
            <Slider label="Mesh density" value={density} min={3} max={20} step={1} onChange={setDensity} hint="Number of nodes in the simulation" />
          </div>

          <div className="range-grid" style={{ marginTop: 12 }}>
            <Stat label="Hop limit" value={String(hopLimit)} />
            <Stat label="Theoretical reach" value={`~${reachableEstimate} of ${density}`} hint="Beyond hop_limit, packet dies" />
            <Stat label="Per-packet airtime" value={`up to ${(reachableEstimate * 1.0).toFixed(1)} s`} hint="One packet × every relayer × ~1 s on LongFast" />
          </div>
        </div>

        {nodes.length > 0 && (
          <div className="card">
            <h2>Your real mesh, right now</h2>
            <div className="range-grid">
              <Stat label="Direct (hop 0)" value={String(directHeard)} hint="Heard off the air, no relay" />
              <Stat label="Relayed" value={String(relayed)} hint="Reached you via another node" />
              <Stat label="Deepest hop seen" value={String(maxHopsSeen)} hint="Highest hop_start − hop_limit observed" />
              <Stat label="Total in DB" value={String(nodes.length)} />
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="info-card">
          <p><strong>How a flood works.</strong></p>
          <ol style={{ margin: 0, paddingLeft: 16 }}>
            <li>Sender broadcasts a packet with <code>hop_limit=3</code>, random ID.</li>
            <li>Every neighbor that hears it stores the ID and waits a randomised 50–600 ms.</li>
            <li>If it didn't already hear someone else rebroadcast first, it decrements <code>hop_limit</code> and rebroadcasts.</li>
            <li>Anyone receiving a packet with the same ID a second time silently drops it.</li>
            <li>When <code>hop_limit</code> hits 0, the packet dies.</li>
          </ol>
        </div>

        <div className="card">
          <h3>Why floods don't scale</h3>
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12.5 }}>
            In a 50-node mesh on LongFast, one text message is ~1 second of airtime — multiplied by every relayer ≈ <strong>20+ seconds</strong> of channel time spent on one message. Channel utilization climbs fast.
          </p>
          <p style={{ marginTop: 8, color: 'var(--text-dim)', fontSize: 12.5 }}>
            That's why Meshtastic has <code>ROUTER</code> and <code>ROUTER_CLIENT</code> roles — only routers rebroadcast. Set most nodes to <em>CLIENT</em> in dense areas.
          </p>
        </div>

        {go && (
          <div className="info-card">
            <p style={{ margin: 0 }}>
              <strong>Wondering if this scales cross-country?</strong>{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); go('reality'); }} style={{ color: 'var(--accent)' }}>Reality Check →</a> shows what 7 hops actually covers on a map.
            </p>
          </div>
        )}

        <div className="info-card">
          <p><strong>Encryption is per-channel.</strong></p>
          <p style={{ marginBottom: 0 }}>Every node on the same channel shares an AES-256 key. Packets are encrypted before transmission and decrypted on receive — but every node on that channel can read every message. Direct messages use the same key plus the recipient's pubkey so only they can read; everyone else still sees the packet pass by, just can't decrypt the payload.</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Your mesh tab — real topology
// ─────────────────────────────────────────────────────────────────────

function YourMeshTab({ nodes, links, myNode, state, go }: { nodes: NodeRecord[]; links: LinkRow[]; myNode?: NodeRecord; state: ConnectionState; go?: (id: TabId) => void }) {
  const myNum = state.myInfo?.myNodeNum;

  // Hops distribution
  const hopBuckets = useMemo(() => {
    const m = new Map<number, number>();
    for (const n of nodes) {
      if (n.num === myNum) continue;
      const h = n.hopsAway ?? -1;
      m.set(h, (m.get(h) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [nodes, myNum]);

  const reachableAtHop = (hopLimit: number) => {
    let count = 0;
    for (const [h, n] of hopBuckets) if (h >= 0 && h <= hopLimit) count += n;
    return count;
  };

  const totalKnown = nodes.length;
  const unknownHops = nodes.filter((n) => n.hopsAway === undefined && n.num !== myNum).length;

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your actual mesh topology</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 13 }}>
            Real nodes laid out by geographic position (when known). Blue lines are observed direct RF links from the local <code>links</code> DB — proof that those two nodes can hear each other directly.
          </p>
          <MeshTopologySvg nodes={nodes} links={links} myNum={myNum} />
        </div>

        <div className="card">
          <h2>Hops distribution</h2>
          <table className="data">
            <thead><tr><th>Hops away</th><th>Count</th><th>Bar</th></tr></thead>
            <tbody>
              {hopBuckets.map(([h, c]) => {
                const max = Math.max(...hopBuckets.map(([, n]) => n));
                const widthPct = (c / max) * 100;
                return (
                  <tr key={h}>
                    <td style={{ fontFamily: 'var(--mono)' }}>{h === -1 ? '(unknown)' : h === 0 ? '0 · direct' : h}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{c}</td>
                    <td>
                      <div style={{ background: 'var(--bg-elev-2)', height: 8, borderRadius: 3, width: '100%', overflow: 'hidden' }}>
                        <div style={{ width: `${widthPct}%`, height: '100%', background: h === 0 ? 'var(--good)' : h <= 2 ? 'var(--warn)' : 'var(--bad)' }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Reach at each hop limit</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12.5 }}>
            If you broadcast right now with various <code>hop_limit</code> settings, here's how far your packet would reach based on the hops we've observed:
          </p>
          <table className="data">
            <thead><tr><th>hop_limit</th><th>Nodes reachable</th><th>Coverage</th></tr></thead>
            <tbody>
              {[1, 2, 3, 4, 5, 7].map((h) => {
                const r = reachableAtHop(h);
                const pct = totalKnown > 0 ? (r / totalKnown) * 100 : 0;
                return (
                  <tr key={h}>
                    <td style={{ fontFamily: 'var(--mono)' }}>{h}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{r} of {totalKnown - unknownHops}</td>
                    <td>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ background: 'var(--bg-elev-2)', height: 6, width: 100, borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>{pct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {unknownHops > 0 && (
            <p style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-faint)' }}>
              {unknownHops} node{unknownHops === 1 ? '' : 's'} with unknown hop count — not included.
            </p>
          )}
        </div>
      </div>

      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What this shows.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Each blue line is a direct RF link your radio knows about — either because it observed a hop-0 reception or because a traceroute response included that edge. Without traceroutes, you'll only see edges that touch your own node.
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Want to grow this graph? Open the Traceroute panel and hit "Trace top 5" — every response adds the full chain to the link DB.
          </p>
        </div>

        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Hop count = path stability.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            A node consistently reported as 2 hops away means there's a stable two-hop path. Nodes that jump between hop counts in your DB are <em>marginal</em> — sometimes a relay is online, sometimes it isn't. Coverage of marginal nodes improves dramatically when you can position more relays between them and you.
          </p>
        </div>

        {go && (
          <div className="info-card">
            <p style={{ margin: 0 }}><strong>See it geographically.</strong></p>
            <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
              The <a href="#" onClick={(e) => { e.preventDefault(); go('map'); }} style={{ color: 'var(--accent)' }}>Map panel</a> renders these same nodes and links on a real basemap with distance labels.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function MeshTopologySvg({ nodes, links, myNum }: { nodes: NodeRecord[]; links: LinkRow[]; myNum?: number }) {
  // Pick positioned nodes; fall back to ring layout for nodes without position.
  const positioned = nodes.filter((n) => n.lat !== undefined && n.lon !== undefined && (n.lat !== 0 || n.lon !== 0));
  const unpositioned = nodes.filter((n) => !(n.lat !== undefined && n.lon !== undefined && (n.lat !== 0 || n.lon !== 0)));

  const W = 900, H = 460;

  // Project positioned to fit
  const placed: Array<{ num: number; x: number; y: number; node: NodeRecord }> = [];
  if (positioned.length >= 1) {
    const lats = positioned.map((n) => n.lat!);
    const lons = positioned.map((n) => n.lon!);
    let minLat = Math.min(...lats), maxLat = Math.max(...lats);
    let minLon = Math.min(...lons), maxLon = Math.max(...lons);
    if (maxLat - minLat < 0.001) { minLat -= 0.005; maxLat += 0.005; }
    if (maxLon - minLon < 0.001) { minLon -= 0.005; maxLon += 0.005; }
    for (const n of positioned) {
      const x = 60 + ((n.lon! - minLon) / (maxLon - minLon)) * (W - 120);
      // Note: lat decreases southward, flip
      const y = 60 + ((maxLat - n.lat!) / (maxLat - minLat)) * (H - 180);
      placed.push({ num: n.num, x, y, node: n });
    }
  }
  // Unpositioned go into an outer ring at the bottom of the canvas
  unpositioned.forEach((n, i) => {
    const ang = (i / Math.max(1, unpositioned.length)) * Math.PI;
    const r = (W - 120) / 2.5;
    const cx = W / 2;
    const cy = H - 50;
    const x = cx + Math.cos(Math.PI + ang) * r;
    const y = cy + Math.sin(Math.PI + ang) * 30; // squashed arc
    placed.push({ num: n.num, x, y, node: n });
  });

  const byNum = new Map(placed.map((p) => [p.num, p]));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ background: 'var(--bg)', borderRadius: 6 }}>
      {/* Edges from links DB */}
      {links.map((l, i) => {
        const a = byNum.get(l.a_num);
        const b = byNum.get(l.b_num);
        if (!a || !b) return null;
        // Width proportional to count
        const width = 0.8 + Math.min(2.5, Math.log10(1 + l.count));
        const opacity = Math.min(0.7, 0.2 + (l.count / 50));
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#5cc8ff" strokeWidth={width} opacity={opacity} />;
      })}

      {/* Nodes */}
      {placed.map((p) => {
        const isMe = p.num === myNum;
        const hop = p.node.hopsAway ?? -1;
        const color = isMe ? '#5cc8ff' : hop === 0 ? '#66d39a' : hop > 0 ? '#ffd166' : '#666';
        const r = isMe ? 9 : 5;
        return (
          <g key={p.num}>
            <circle cx={p.x} cy={p.y} r={r} fill={color} stroke="rgba(0,0,0,0.5)" strokeWidth={1} opacity={hop === -1 ? 0.5 : 1} />
            {(isMe || hop !== undefined) && p.node.shortName && (
              <text x={p.x} y={p.y - r - 4} textAnchor="middle" fontSize={10} fill="var(--text)" stroke="rgba(0,0,0,0.6)" strokeWidth={2.5} paintOrder="stroke fill" fontFamily="ui-monospace, Menlo, monospace">
                {p.node.shortName}
              </text>
            )}
          </g>
        );
      })}

      <text x={12} y={20} fontSize={11} fill="var(--text-faint)" fontFamily="ui-monospace">
        {placed.length} nodes · {links.length} observed links
      </text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Math tab — airtime + channel saturation
// ─────────────────────────────────────────────────────────────────────

function MathTab({ state, nodes }: { state: ConnectionState; nodes: NodeRecord[] }) {
  const [presetId, setPresetId] = useState(state.loraConfig?.modemPresetName?.toLowerCase() ?? 'longfast');
  const [meshSize, setMeshSize] = useState(Math.max(10, nodes.length));
  const [msgsPerHr, setMsgsPerHr] = useState(20);
  const [hopLimit, setHopLimit] = useState(state.loraConfig?.hopLimit || 3);

  const preset = LORA_PRESETS.find((p) => p.id.toLowerCase() === presetId) ?? LORA_PRESETS[0];

  const PAYLOAD_SIZES = [10, 50, 100, 200];
  // Airtime ratio per byte (derived from each preset's 50-byte airtime, assuming linear with size — approximation)
  const airtimePerByte = preset ? (preset.airtimeSec_50byte ?? 1) / 50 : 0;

  // Channel utilization model:
  // Each message = msgsPerHr per node × meshSize / 3600 s in air per second per node.
  // Each message floods through (worst case) every other node, so airtime per message ≈ airtime50B * hopLimit * avgRelayFactor.
  // Approximation: floodAirtime = airtime50B * min(meshSize, density-bounded reach at hopLimit)
  const reach = Math.min(meshSize, Math.floor(1 + meshSize * (1 - Math.pow(0.4, hopLimit))));
  const airtime50 = preset.airtimeSec_50byte ?? 1;
  const floodAirtimePerMessage = airtime50 * reach;
  const totalAirtimePerHour = msgsPerHr * meshSize * floodAirtimePerMessage;
  const channelUtilPct = (totalAirtimePerHour / 3600) * 100;

  const tone = channelUtilPct > 50 ? 'bad' : channelUtilPct > 25 ? 'warn' : 'good';

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Channel saturation under flood</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 13 }}>
            With N nodes, each transmitting M messages per hour, each message floods through ~K other nodes. Plug in the numbers — watch when the channel saturates.
          </p>

          <Row label="Modem preset">
            <select className="text" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {LORA_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Row>
          <Row label={`Mesh size: ${meshSize} nodes`}>
            <input type="range" min={5} max={200} step={1} value={meshSize} onChange={(e) => setMeshSize(Number(e.target.value))} style={{ width: '100%' }} />
          </Row>
          <Row label={`Messages per hour per node: ${msgsPerHr}`}>
            <input type="range" min={1} max={200} step={1} value={msgsPerHr} onChange={(e) => setMsgsPerHr(Number(e.target.value))} style={{ width: '100%' }} />
          </Row>
          <Row label={`Hop limit: ${hopLimit}`}>
            <input type="range" min={1} max={7} step={1} value={hopLimit} onChange={(e) => setHopLimit(Number(e.target.value))} style={{ width: '100%' }} />
          </Row>

          <div className="range-grid" style={{ marginTop: 14 }}>
            <Stat label="Airtime per 50 B" value={`${airtime50.toFixed(2)} s`} hint="One transmission" />
            <Stat label="Reach at hop_limit" value={`${reach} nodes`} hint="With this hop_limit" />
            <Stat label="Airtime per flood" value={`${floodAirtimePerMessage.toFixed(1)} s`} hint="Sum of all rebroadcasts" />
            <Stat label="Channel utilization" value={`${channelUtilPct.toFixed(1)}%`} tone={tone} hint={channelUtilPct > 100 ? 'OVER CAPACITY' : channelUtilPct > 50 ? 'saturated' : channelUtilPct > 25 ? 'congested' : 'healthy'} />
          </div>

          <div className="info-card" style={{ borderLeftColor: tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : 'var(--bad)', marginTop: 14 }}>
            <p style={{ margin: 0, fontWeight: 500 }}>
              {channelUtilPct > 100 ? '⚠ Theoretical airtime exceeds 100%' : channelUtilPct > 50 ? 'Saturated' : channelUtilPct > 25 ? 'Congested' : 'Healthy'}
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-dim)' }}>
              {channelUtilPct > 100 && `This mesh cannot sustain ${msgsPerHr} msgs/hr from ${meshSize} nodes on ${preset.label}. You'd need a faster preset, fewer messages, or fewer routing nodes.`}
              {channelUtilPct <= 100 && channelUtilPct > 50 && `${meshSize} nodes × ${msgsPerHr} msgs/hr ≈ ${channelUtilPct.toFixed(0)}% airtime. Acks will be unreliable. Either reduce traffic or split into multiple channels.`}
              {channelUtilPct <= 50 && channelUtilPct > 25 && `${meshSize} nodes × ${msgsPerHr} msgs/hr ≈ ${channelUtilPct.toFixed(0)}% airtime. Workable but acks may need retries. Consider faster preset.`}
              {channelUtilPct <= 25 && `${meshSize} nodes × ${msgsPerHr} msgs/hr ≈ ${channelUtilPct.toFixed(0)}% airtime. Plenty of headroom.`}
            </p>
          </div>
        </div>

        <div className="card">
          <h2>Airtime per payload size, by preset</h2>
          <table className="data" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Preset</th>
                {PAYLOAD_SIZES.map((s) => <th key={s}>{s} B</th>)}
              </tr>
            </thead>
            <tbody>
              {LORA_PRESETS.slice().sort((a, b) => (b.airtimeSec_50byte ?? 1) - (a.airtimeSec_50byte ?? 1)).map((p) => (
                <tr key={p.id} style={{ background: p.id === preset.id ? 'rgba(102,211,154,0.06)' : undefined }}>
                  <td>{p.label}{p.id === preset.id && <span className="preset-live-tag">selected</span>}</td>
                  {PAYLOAD_SIZES.map((s) => {
                    const air = ((p.airtimeSec_50byte ?? 1) / 50) * s;
                    return <td key={s} style={{ fontFamily: 'var(--mono)' }}>{air.toFixed(2)} s</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 8, fontSize: 11, color: 'var(--text-faint)' }}>
            Approximation: airtime scales linearly with payload after preamble overhead — exact for &gt;30 bytes, slightly off for tiny packets.
          </p>
        </div>
      </div>

      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>The saturation math, in plain English.</strong></p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12.5 }}>
            <li>Each broadcast takes ~{airtime50.toFixed(1)} s on the air for {preset.label}.</li>
            <li>It floods through ~{reach} nodes — each rebroadcasting once.</li>
            <li>So one logical message eats {floodAirtimePerMessage.toFixed(1)} s of channel time.</li>
            <li>With {meshSize} nodes each sending {msgsPerHr} msgs/hr, total is {totalAirtimePerHour.toFixed(0)} s/hr.</li>
            <li>3600 s/hr is 100%. We're at {channelUtilPct.toFixed(0)}%.</li>
          </ul>
        </div>

        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Mitigations.</strong></p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12.5 }}>
            <li><strong>Lower hop_limit</strong> on chatty nodes. A sensor that nobody needs to reach beyond their local hop only needs hop_limit=1.</li>
            <li><strong>Faster preset</strong> (ShortFast = 10× fewer seconds per message vs LongFast).</li>
            <li><strong>Fewer routers.</strong> Mark most nodes as CLIENT so they listen but don't rebroadcast.</li>
            <li><strong>Move traffic to channel 1+.</strong> Encrypted DMs only count against the recipient's channel utilization for that channel.</li>
          </ul>
        </div>

        <div className="info-card">
          <p style={{ margin: 0 }}><strong>EU 1% caveat.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            EU868 regions cap each <em>individual node</em> at 1% airtime per hour — 36 s. The model above is the network-wide ceiling; the per-node legal ceiling can bite earlier on slow presets.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Canvas demo helpers
// ─────────────────────────────────────────────────────────────────────

function drawMesh(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, hopLimit: number, tick: number) {
  ctx.clearRect(0, 0, w, h);
  const positions: { x: number; y: number; hop: number | null }[] = [];
  const cx = w / 2, cy = h / 2;
  const seed = (n * 7 + 17) % 100;
  positions.push({ x: cx, y: cy, hop: 0 });
  for (let i = 1; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + (seed * 0.01);
    const r = 60 + ((i * 53 + seed) % (Math.min(w, h) * 0.4 - 60));
    positions.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r, hop: null });
  }
  const linkRadius = Math.min(w, h) * 0.22;
  const links: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      if (Math.sqrt(dx * dx + dy * dy) < linkRadius) links.push([i, j]);
    }
  }
  const phase = tick % 60;
  const wavefront = Math.min(hopLimit, Math.floor(phase / 10));
  for (let h = 0; h < hopLimit; h++) {
    const next: number[] = [];
    for (let i = 0; i < positions.length; i++) {
      if (positions[i].hop === h) {
        for (const [a, b] of links) {
          if (a === i && positions[b].hop === null) { positions[b].hop = h + 1; next.push(b); }
          else if (b === i && positions[a].hop === null) { positions[a].hop = h + 1; next.push(a); }
        }
      }
    }
    if (!next.length) break;
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (const [a, b] of links) {
    ctx.beginPath();
    ctx.moveTo(positions[a].x, positions[a].y);
    ctx.lineTo(positions[b].x, positions[b].y);
    ctx.stroke();
  }
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const reached = p.hop !== null && p.hop <= wavefront;
    ctx.fillStyle = reached ? hopColor(p.hop ?? 0) : '#3a4150';
    ctx.beginPath();
    ctx.arc(p.x, p.y, i === 0 ? 9 : 6, 0, Math.PI * 2);
    ctx.fill();
    if (reached && p.hop === wavefront && phase % 10 < 5) {
      ctx.strokeStyle = hopColor(p.hop);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12 + (phase % 10) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '11px ui-monospace';
  ctx.fillText(`hop ${wavefront}/${hopLimit}`, 10, 18);
}

function hopColor(hop: number): string {
  return ['#5cc8ff', '#66d39a', '#ffd166', '#ffb86b', '#ff6b81', '#c79cff', '#ffffff'][hop] ?? '#fff';
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : 'var(--text)';
  return (
    <div className="range-card">
      <div className="label">{label}</div>
      <div className="value" style={{ color }}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        <span>{label}</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} style={{ width: '100%' }} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}
