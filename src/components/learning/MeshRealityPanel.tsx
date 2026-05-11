import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TabId } from '../TopNav';

type Tab = 'reach' | 'cross' | 'loss' | 'mine';

type HopProfile = {
  id: string;
  label: string;
  km: number;
  detail: string;
};

const HOP_PROFILES: HopProfile[] = [
  { id: 'handheld',    label: 'Handheld, ground',   km: 2,  detail: 'Stock node in your pocket, urban / suburban.' },
  { id: 'rooftop',     label: 'Rooftop ↔ rooftop',  km: 15, detail: 'Mounted node with clear line of sight to a neighbor.' },
  { id: 'tower',       label: 'Tower ↔ tower',      km: 40, detail: 'Elevated nodes, decent antennas, no big terrain in the way.' },
  { id: 'mountaintop', label: 'Mountaintop relays', km: 80, detail: 'Best-case terrain. Summit-to-summit LoS, big antennas.' },
];

const CITIES: { name: string; kmFromSF: number }[] = [
  { name: 'SF',         kmFromSF: 0 },
  { name: 'San Jose',   kmFromSF: 75 },
  { name: 'Sacramento', kmFromSF: 140 },
  { name: 'Reno',       kmFromSF: 350 },
  { name: 'LA',         kmFromSF: 600 },
  { name: 'Las Vegas',  kmFromSF: 670 },
  { name: 'Phoenix',    kmFromSF: 1050 },
  { name: 'Denver',     kmFromSF: 1500 },
  { name: 'Dallas',     kmFromSF: 2300 },
  { name: 'Chicago',    kmFromSF: 2980 },
  { name: 'NYC',        kmFromSF: 4140 },
];

const CONTINENTAL_MAX_KM = 4500;
const ZOOM_MAX_KM = 200;
const HOP_LOSS = 0.08;
const AIRTIME_PER_PACKET_S = 1.0;
const DUTY_CYCLE_BUDGET_S_PER_HOUR = 36;

interface Props {
  nodes?: NodeRecord[];
  myNode?: NodeRecord;
  state?: ConnectionState;
  go?: (id: TabId) => void;
}

export function MeshRealityPanel({ nodes = [], myNode, state, go }: Props = {}) {
  const [tab, setTab] = useState<Tab>('reach');
  const [hops, setHops] = useState(3);
  const [profileId, setProfileId] = useState('rooftop');
  const profile = HOP_PROFILES.find((p) => p.id === profileId)!;
  const reachKm = hops * profile.km;

  const stripFar = useRef<HTMLCanvasElement>(null);
  const stripNear = useRef<HTMLCanvasElement>(null);
  const bridgeCanvas = useRef<HTMLCanvasElement>(null);
  const lossCanvas = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const c = stripFar.current;
    if (c) drawScaleStrip(c, CONTINENTAL_MAX_KM, reachKm, hops, profile);
  }, [reachKm, hops, profile, tick]);

  useEffect(() => {
    const c = stripNear.current;
    if (c) drawScaleStrip(c, ZOOM_MAX_KM, reachKm, hops, profile, true);
  }, [reachKm, hops, profile, tick]);

  useEffect(() => {
    const c = bridgeCanvas.current;
    if (c) drawBridge(c, tick);
  }, [tick]);

  useEffect(() => {
    const c = lossCanvas.current;
    if (c) drawLossCurve(c, hops);
  }, [hops]);

  const survival = Math.pow(1 - HOP_LOSS, hops);
  const hopsToNYC = Math.ceil(4140 / profile.km);
  const survivalToNYC = Math.pow(1 - HOP_LOSS, hopsToNYC);

  return (
    <div className="page">
      <h1 className="page-title">Reality Check: how far can a message actually go?</h1>
      <p className="page-sub">
        Honest answers backed by physics — and where applicable, by your own mesh data.
      </p>

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'reach' ? ' active' : '')} onClick={() => setTab('reach')}>7-hop reach</button>
        <button className={'subnav-btn' + (tab === 'cross' ? ' active' : '')} onClick={() => setTab('cross')}>Cross-country</button>
        <button className={'subnav-btn' + (tab === 'loss' ? ' active' : '')} onClick={() => setTab('loss')}>Hop loss</button>
        <button className={'subnav-btn' + (tab === 'mine' ? ' active' : '')} onClick={() => setTab('mine')}>
          Your area {nodes.length > 0 && <span className="subnav-count">{nodes.length}</span>}
        </button>
      </div>

      {tab === 'reach' && (
      <div className="card">
        <h2>What 7 hops looks like, at scale</h2>
        <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 13 }}>
          Pick a hop length and a hop count. The colored bar is your reach. The dots are real
          cities at their real distances from San Francisco. The continental view shows the
          country; the zoomed view shows the same reach inside a 200&nbsp;km window.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Per-hop distance
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {HOP_PROFILES.map((p) => (
                <button
                  key={p.id}
                  className={p.id === profileId ? 'primary' : 'ghost'}
                  onClick={() => setProfileId(p.id)}
                  style={{ textAlign: 'left', padding: '8px 10px' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span>{p.label}</span>
                    <span style={{ fontFamily: 'var(--mono)' }}>{p.km} km/hop</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2, fontWeight: 400 }}>{p.detail}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              <span>Hops</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{hops}</span>
            </div>
            <input
              type="range"
              min={1}
              max={7}
              step={1}
              value={hops}
              onChange={(e) => setHops(Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
              Default 3, max 7 (3-bit field in the protocol).
            </div>

            <div className="range-grid" style={{ marginTop: 14 }}>
              <Stat label="Reach" value={`${reachKm.toLocaleString()} km`} hint={`${hops} × ${profile.km} km`} />
              <Stat
                label="Packet survival"
                value={`${(survival * 100).toFixed(0)}%`}
                hint={`(1 − 8%)^${hops}`}
                tone={survival < 0.5 ? 'bad' : survival < 0.8 ? 'warn' : 'good'}
              />
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
          Continental scale — 0 to {CONTINENTAL_MAX_KM.toLocaleString()} km
        </div>
        <canvas
          ref={stripFar}
          width={1200}
          height={130}
          style={{ width: '100%', height: 130, display: 'block', background: 'var(--bg)', borderRadius: 6, marginBottom: 14 }}
        />

        <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
          Zoomed — 0 to {ZOOM_MAX_KM} km
        </div>
        <canvas
          ref={stripNear}
          width={1200}
          height={110}
          style={{ width: '100%', height: 110, display: 'block', background: 'var(--bg)', borderRadius: 6 }}
        />

        <div className="info-card" style={{ marginTop: 14 }}>
          <p style={{ margin: 0 }}>
            At <strong>{profile.label.toLowerCase()}</strong> spacing, your maximum 7-hop reach is{' '}
            <strong style={{ color: 'var(--accent)' }}>{(7 * profile.km).toLocaleString()} km</strong>.
            To touch New York from San Francisco (4,140 km) you'd need{' '}
            <strong>{hopsToNYC.toLocaleString()} hops</strong> — and even ignoring the 7-hop ceiling,
            that's a per-message survival rate of{' '}
            <strong style={{ color: 'var(--bad)' }}>
              {survivalToNYC < 0.001 ? '<0.1%' : (survivalToNYC * 100).toFixed(2) + '%'}
            </strong>{' '}
            from compounding hop loss alone.
          </p>
        </div>
      </div>

      )}

      {tab === 'cross' && (
      <div className="card">
        <h2>How a cross-country message actually moves</h2>
        <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 13 }}>
          You don't span the country with the mesh. You <em>leave</em> the mesh. A node configured
          as an MQTT gateway publishes encrypted packets to a broker over normal internet. Another
          gateway, on a different continent if you want, subscribes and re-injects them into a
          totally different local mesh. Two meshes glued by TCP/IP.
        </p>
        <canvas
          ref={bridgeCanvas}
          width={1200}
          height={280}
          style={{ width: '100%', height: 280, display: 'block', background: 'var(--bg)', borderRadius: 6 }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
          <Bullet color="var(--accent)" title="RF segment (left mesh)">
            Real airtime, real hop limit, real loss. The gateway is just another node — it hears
            the packet over the air and uplinks the bytes.
          </Bullet>
          <Bullet color="var(--good)" title="Internet segment">
            Encrypted payload over MQTT/TCP. Effectively unlimited range, near-zero latency,
            broker can't decrypt it. This is the part that crosses the country.
          </Bullet>
          <Bullet color="var(--accent)" title="RF segment (right mesh)">
            Remote gateway publishes the packet back onto its local channel. Hops, airtime, and
            loss start over from zero on this side.
          </Bullet>
        </div>
      </div>

      )}

      {tab === 'loss' && (
      <div className="card">
        <h2>Why "just allow more hops" doesn't fix it</h2>
        <p style={{ margin: '0 0 12px', color: 'var(--text-dim)', fontSize: 13 }}>
          The 3-bit hop field is the obvious wall. The deeper wall is physics: each hop has an
          ~8% drop rate (no per-hop ACKs in flooding) and costs ~1 second of airtime per relay.
        </p>
        <canvas
          ref={lossCanvas}
          width={1200}
          height={240}
          style={{ width: '100%', height: 240, display: 'block', background: 'var(--bg)', borderRadius: 6 }}
        />
        <div className="info-card" style={{ marginTop: 12 }}>
          <p style={{ margin: 0 }}>
            By the 30-hop mark, fewer than 1 in 10 packets survive. By 60 hops, fewer than 1 in
            150. And each hop bills its own airtime — at ~1 s per packet on LongFast, a 60-hop
            chain through a busy mesh would saturate the EU 1% duty-cycle limit
            ({DUTY_CYCLE_BUDGET_S_PER_HOUR} s/hr) for every relay involved. The 7-hop cap isn't
            the blocker. The flood model is.
          </p>
        </div>
      </div>
      )}

      {tab === 'mine' && (
        <YourAreaTab nodes={nodes} myNode={myNode} state={state} go={go} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Your area tab — answers common questions with the user's real numbers
// ─────────────────────────────────────────────────────────────────────

function YourAreaTab({ nodes, myNode, state, go }: { nodes: NodeRecord[]; myNode?: NodeRecord; state?: ConnectionState; go?: (id: TabId) => void }) {
  const myNum = state?.myInfo?.myNodeNum;

  const stats = useMemo(() => {
    const positioned = nodes.filter((n) => n.lat !== undefined && n.lon !== undefined && (n.lat !== 0 || n.lon !== 0));
    const lats = positioned.map((n) => n.lat!);
    const lons = positioned.map((n) => n.lon!);
    let bboxKm: number | null = null;
    if (lats.length >= 2) {
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const minLon = Math.min(...lons), maxLon = Math.max(...lons);
      bboxKm = haversineKm(minLat, minLon, maxLat, maxLon);
    }

    let maxDistFromMeKm: number | null = null;
    let farthestNode: NodeRecord | null = null;
    let bestRssi: { node: NodeRecord; rssi: number } | null = null;
    let worstRssi: { node: NodeRecord; rssi: number } | null = null;
    if (myNode?.lat != null && myNode?.lon != null) {
      for (const n of positioned) {
        if (n.num === myNum) continue;
        const d = haversineKm(myNode.lat, myNode.lon, n.lat!, n.lon!);
        if (maxDistFromMeKm == null || d > maxDistFromMeKm) {
          maxDistFromMeKm = d;
          farthestNode = n;
        }
      }
    }
    for (const n of nodes) {
      if (n.num === myNum) continue;
      if (n.rssi !== undefined && n.rssi !== 0) {
        if (!bestRssi || n.rssi > bestRssi.rssi) bestRssi = { node: n, rssi: n.rssi };
        if (!worstRssi || n.rssi < worstRssi.rssi) worstRssi = { node: n, rssi: n.rssi };
      }
    }

    const hopCounts = nodes.filter((n) => n.hopsAway !== undefined && n.num !== myNum).map((n) => n.hopsAway!);
    hopCounts.sort((a, b) => a - b);
    const medianHops = hopCounts.length > 0 ? hopCounts[Math.floor(hopCounts.length / 2)] : null;
    const maxHops = hopCounts.length > 0 ? hopCounts[hopCounts.length - 1] : 0;

    const direct = hopCounts.filter((h) => h === 0).length;
    const oneHop = hopCounts.filter((h) => h === 1).length;
    const twoOrMore = hopCounts.filter((h) => h >= 2).length;

    return { positioned, bboxKm, maxDistFromMeKm, farthestNode, bestRssi, worstRssi, medianHops, maxHops, direct, oneHop, twoOrMore, total: nodes.length };
  }, [nodes, myNode, myNum]);

  const preset = state?.loraConfig?.modemPresetName ?? '(unknown preset)';
  const region = state?.loraConfig?.regionName ?? '(unknown region)';

  if (nodes.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <p style={{ margin: 0 }}>Connect to your radio first — this tab answers questions with <em>your</em> mesh data.</p>
        </div>
      </div>
    );
  }

  // Q&A entries
  const questions: Array<{ q: string; a: React.ReactNode; tone: 'good' | 'warn' | 'bad' | 'dim' }> = [];

  // Q: how big is my mesh, geographically?
  if (stats.bboxKm != null) {
    questions.push({
      q: 'How big is the area my mesh actually covers?',
      a: <>The positioned nodes span <strong>{stats.bboxKm < 1 ? `${(stats.bboxKm * 1000).toFixed(0)} m` : `${stats.bboxKm.toFixed(1)} km`}</strong> diagonally. {stats.positioned.length < 5 ? 'Only a handful have shared positions — the area shown is biased by that.' : 'That\'s the bounding box of every node that\'s shared a GPS fix.'}</>,
      tone: stats.bboxKm > 20 ? 'good' : 'warn',
    });
  }

  // Q: farthest reachable node
  if (stats.maxDistFromMeKm != null && stats.farthestNode) {
    questions.push({
      q: 'What\'s the farthest node I\'m hearing right now?',
      a: <><strong style={{ color: 'var(--accent)' }}>{stats.farthestNode.shortName || '????'}</strong> at <strong>{stats.maxDistFromMeKm < 1 ? `${(stats.maxDistFromMeKm * 1000).toFixed(0)} m` : `${stats.maxDistFromMeKm.toFixed(2)} km`}</strong>{stats.farthestNode.hopsAway !== undefined && <> via {stats.farthestNode.hopsAway} hop{stats.farthestNode.hopsAway === 1 ? '' : 's'}</>}{stats.farthestNode.rssi !== undefined && stats.farthestNode.rssi !== 0 && <> at {stats.farthestNode.rssi} dBm</>}.</>,
      tone: stats.maxDistFromMeKm > 10 ? 'good' : 'warn',
    });
  }

  // Q: best signal
  if (stats.bestRssi) {
    questions.push({
      q: 'What\'s my strongest current link?',
      a: <><strong style={{ color: 'var(--accent)' }}>{stats.bestRssi.node.shortName || '????'}</strong> at <strong>{stats.bestRssi.rssi} dBm</strong>. {stats.bestRssi.rssi > -85 ? 'Stronger than -85 dBm means they\'re essentially at clear-line-of-sight or very close.' : 'Workable; comfortable margin above the decoder floor.'}</>,
      tone: stats.bestRssi.rssi > -85 ? 'good' : 'warn',
    });
  }

  // Q: weakest decoded link
  if (stats.worstRssi) {
    questions.push({
      q: 'How weak is the weakest packet I\'m still decoding?',
      a: <><strong style={{ color: 'var(--accent)' }}>{stats.worstRssi.node.shortName || '????'}</strong> at <strong>{stats.worstRssi.rssi} dBm</strong> — {stats.worstRssi.rssi < -120 ? `that's near the LoRa demodulator floor. Any weaker and packets start dropping.` : stats.worstRssi.rssi < -110 ? 'in the marginal range. Acks may be unreliable.' : 'plenty of margin still.'}</>,
      tone: stats.worstRssi.rssi < -120 ? 'bad' : stats.worstRssi.rssi < -110 ? 'warn' : 'good',
    });
  }

  // Q: median hop distance
  if (stats.medianHops !== null) {
    questions.push({
      q: 'How many hops does a typical message in this mesh travel?',
      a: <>Median is <strong>{stats.medianHops}</strong> hop{stats.medianHops === 1 ? '' : 's'}; deepest observed is <strong>{stats.maxHops}</strong>. {stats.maxHops >= 5 ? 'You\'re near the 7-hop ceiling — relays at the edge of your DB might be unreachable.' : stats.maxHops >= 3 ? 'Comfortable: the default hop_limit of 3 still covers most of your mesh.' : 'Compact mesh — everything\'s within a couple of hops.'}</>,
      tone: stats.maxHops >= 6 ? 'warn' : 'good',
    });
  }

  // Q: can I reach the next city?
  questions.push({
    q: 'Can I reach the next city over (~30 km)?',
    a: <>{
      stats.maxDistFromMeKm == null
        ? 'Hard to say without positioned nodes — set yourself a fixed position and ask again.'
        : stats.maxDistFromMeKm >= 25
          ? <>You\'re already hearing nodes <strong>{stats.maxDistFromMeKm.toFixed(0)} km</strong> away. A 30 km link is plausible to anyone with a comparable antenna and view.</>
          : <>Currently the farthest you\'re hearing is <strong>{stats.maxDistFromMeKm < 1 ? `${(stats.maxDistFromMeKm * 1000).toFixed(0)} m` : `${stats.maxDistFromMeKm.toFixed(1)} km`}</strong>. 30 km direct would need a major antenna upgrade (rooftop omni) or a relay halfway.</>
    }</>,
    tone: stats.maxDistFromMeKm != null && stats.maxDistFromMeKm >= 25 ? 'good' : 'warn',
  });

  // Q: can I message cross-country?
  questions.push({
    q: 'Can I message someone cross-country over the mesh?',
    a: <>No. The 7-hop limit, the ~8% per-hop drop rate, and the 1-second-per-relay airtime all conspire — at <em>any</em> per-hop distance, you can\'t string enough hops together. Cross-country requires an <strong>MQTT gateway</strong> on each end (see the Cross-country tab). Your mesh handles the local hop; the internet handles the long haul.</>,
    tone: 'bad',
  });

  // Q: density / role check
  if (stats.direct + stats.oneHop > 0) {
    questions.push({
      q: 'Is my mesh densely connected or stringy?',
      a: <>Direct neighbors: <strong>{stats.direct}</strong>. One-hop: <strong>{stats.oneHop}</strong>. Two-or-more hops: <strong>{stats.twoOrMore}</strong>. {stats.direct >= 5 ? 'Looks densely connected — you have plenty of relay options.' : stats.direct >= 2 ? 'Workable density. If a direct neighbor goes offline, you have alternatives.' : 'Stringy — a single relay outage could isolate you. Consider helping deploy more nodes between you and the rest of the mesh.'}</>,
      tone: stats.direct >= 5 ? 'good' : stats.direct >= 2 ? 'warn' : 'bad',
    });
  }

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Questions, answered with your mesh's actual data</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 13 }}>
            Region <strong>{region}</strong> · preset <strong>{preset}</strong> · <strong>{stats.total}</strong> nodes known · <strong>{stats.positioned.length}</strong> with positions.
          </p>
          {questions.map((q, i) => {
            const color = q.tone === 'good' ? 'var(--good)' : q.tone === 'warn' ? 'var(--warn)' : q.tone === 'bad' ? 'var(--bad)' : 'var(--text-faint)';
            return (
              <div key={i} className="info-card" style={{ borderLeftColor: color, marginBottom: 10 }}>
                <p style={{ margin: 0, fontWeight: 500 }}>{q.q}</p>
                <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-dim)' }}>{q.a}</p>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Where these numbers come from.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Live: your radio's nodeDB (lastHeard, hopsAway, rssi) + GPS positions where available. Historical: the local SQLite DB of every packet we've decoded. The Coverage panel does the heavier statistical fit; this tab just asks the simple questions.
          </p>
        </div>

        {go && (
          <div className="info-card">
            <p style={{ margin: 0 }}><strong>Want the deeper view?</strong></p>
            <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12.5 }}>
              <li><a href="#" onClick={(e) => { e.preventDefault(); go('map'); }} style={{ color: 'var(--accent)' }}>Map</a> — see your mesh geographically</li>
              <li><a href="#" onClick={(e) => { e.preventDefault(); go('coverage'); }} style={{ color: 'var(--accent)' }}>Coverage</a> — measured path-loss exponent for your environment</li>
              <li><a href="#" onClick={(e) => { e.preventDefault(); go('link-budget'); }} style={{ color: 'var(--accent)' }}>Link Budget</a> — per-link math vs. theory</li>
              <li><a href="#" onClick={(e) => { e.preventDefault(); go('traceroute'); }} style={{ color: 'var(--accent)' }}>Traceroute</a> — draw actual paths through the mesh</li>
            </ul>
          </div>
        )}

        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Sanity checks.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            If a "best RSSI" of -50 dBm shows up, that's a node in the same room — RSSI that high is suspicious otherwise (radio overloading). If the "weakest" RSSI is -130 dBm, you're at the absolute floor and most packets are being dropped silently. Mid-range nodes around -90 to -110 dBm are the typical sub-urban LoRa pattern.
          </p>
        </div>
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

function drawScaleStrip(
  c: HTMLCanvasElement,
  maxKm: number,
  reachKm: number,
  hops: number,
  profile: HopProfile,
  zoomed = false,
) {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const w = c.width;
  const h = c.height;
  ctx.clearRect(0, 0, w, h);

  const padL = 70;
  const padR = 30;
  const axisY = h - 36;
  const innerW = w - padL - padR;
  const kmToX = (km: number) => padL + (Math.min(km, maxKm) / maxKm) * innerW;

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, axisY);
  ctx.lineTo(w - padR, axisY);
  ctx.stroke();

  const tickStep = niceTick(maxKm);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '10px ui-monospace';
  ctx.textAlign = 'center';
  for (let km = 0; km <= maxKm; km += tickStep) {
    const x = kmToX(km);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(x, axisY);
    ctx.lineTo(x, axisY + 4);
    ctx.stroke();
    ctx.fillText(km.toLocaleString(), x, axisY + 16);
  }
  ctx.textAlign = 'right';
  ctx.fillText('km', padL - 8, axisY + 4);

  const reachX = kmToX(reachKm);
  const barTop = axisY - 38;
  const grad = ctx.createLinearGradient(padL, 0, reachX, 0);
  grad.addColorStop(0, 'rgba(92,200,255,0.55)');
  grad.addColorStop(1, 'rgba(92,200,255,0.18)');
  ctx.fillStyle = grad;
  ctx.fillRect(padL, barTop, Math.max(2, reachX - padL), 28);
  ctx.strokeStyle = 'rgba(92,200,255,0.9)';
  ctx.lineWidth = 1;
  ctx.strokeRect(padL + 0.5, barTop + 0.5, Math.max(2, reachX - padL) - 1, 27);

  for (let i = 1; i <= hops; i++) {
    const x = kmToX(i * profile.km);
    if (x > w - padR) break;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, barTop);
    ctx.lineTo(x, barTop + 28);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = '#5cc8ff';
  ctx.font = '11px ui-monospace';
  ctx.textAlign = 'left';
  const labelX = Math.min(reachX + 6, w - padR - 100);
  if (reachKm <= maxKm * 1.05) {
    ctx.fillText(`${hops} hops · ${reachKm.toLocaleString()} km`, labelX, barTop - 4);
  } else {
    ctx.fillText('off-chart →', w - padR - 80, barTop - 4);
  }

  for (const city of CITIES) {
    if (city.kmFromSF > maxKm * 1.02) continue;
    const x = kmToX(city.kmFromSF);
    const inReach = city.kmFromSF <= reachKm;
    ctx.fillStyle = inReach ? '#66d39a' : '#5e6678';
    ctx.beginPath();
    ctx.arc(x, axisY - 5, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = inReach ? '#cfeede' : 'rgba(255,255,255,0.55)';
    ctx.font = '10.5px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(city.name, x, axisY - 12);
  }

  ctx.fillStyle = '#ffb86b';
  ctx.beginPath();
  ctx.arc(kmToX(0), axisY - 5, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,184,107,0.95)';
  ctx.font = 'bold 10.5px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(zoomed ? 'YOU' : '', kmToX(0), axisY - 22);
}

function niceTick(maxKm: number): number {
  if (maxKm <= 200) return 25;
  if (maxKm <= 500) return 100;
  if (maxKm <= 2000) return 500;
  return 1000;
}

function drawBridge(c: HTMLCanvasElement, tick: number) {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const w = c.width;
  const h = c.height;
  ctx.clearRect(0, 0, w, h);

  const yMid = h / 2;
  const leftMeshX = 110;
  const leftGwX = 340;
  const brokerX = w / 2;
  const rightGwX = w - 340;
  const rightMeshX = w - 110;

  drawMiniMesh(ctx, leftMeshX, yMid, 8, 'San Francisco');
  drawMiniMesh(ctx, rightMeshX, yMid, 8, 'New York');

  drawNode(ctx, leftGwX, yMid, '#ffb86b', 'Gateway', 'MQTT uplink');
  drawNode(ctx, rightGwX, yMid, '#ffb86b', 'Gateway', 'MQTT downlink');

  ctx.fillStyle = '#66d39a';
  ctx.beginPath();
  ctx.arc(brokerX, yMid - 30, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0f1115';
  ctx.font = 'bold 11px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('BROKER', brokerX, yMid - 27);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '10.5px ui-monospace';
  ctx.fillText('mqtt.meshtastic.org', brokerX, yMid + 4);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '10px ui-sans-serif, system-ui';
  ctx.fillText('(can\'t decrypt — payload is AES-256)', brokerX, yMid + 18);

  drawSegment(ctx, leftMeshX + 50, yMid, leftGwX - 18, yMid, '#5cc8ff', 'RF · airtime billed', 'dashed');
  drawSegment(ctx, leftGwX + 18, yMid, brokerX - 22, yMid - 30, '#66d39a', 'TCP/IP · ~free', 'solid');
  drawSegment(ctx, brokerX + 22, yMid - 30, rightGwX - 18, yMid, '#66d39a', 'TCP/IP · ~free', 'solid');
  drawSegment(ctx, rightGwX + 18, yMid, rightMeshX - 50, yMid, '#5cc8ff', 'RF · airtime billed', 'dashed');

  const phase = (tick % 200) / 200;
  const path = [
    { x: leftMeshX + 50, y: yMid },
    { x: leftGwX, y: yMid },
    { x: brokerX, y: yMid - 30 },
    { x: rightGwX, y: yMid },
    { x: rightMeshX - 50, y: yMid },
  ];
  const segLen = 1 / (path.length - 1);
  const segIdx = Math.min(path.length - 2, Math.floor(phase / segLen));
  const segT = (phase - segIdx * segLen) / segLen;
  const a = path[segIdx];
  const b = path[segIdx + 1];
  const px = a.x + (b.x - a.x) * segT;
  const py = a.y + (b.y - a.y) * segT;
  const overRf = segIdx === 0 || segIdx === 3;
  ctx.fillStyle = overRf ? '#5cc8ff' : '#66d39a';
  ctx.shadowColor = overRf ? '#5cc8ff' : '#66d39a';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(px, py, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '11px ui-sans-serif, system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('One message, four segments:', 16, 22);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '10.5px ui-sans-serif, system-ui';
  ctx.fillText('blue = RF (real radio)   green = internet', 16, 38);
}

function drawMiniMesh(ctx: CanvasRenderingContext2D, cx: number, cy: number, n: number, label: string) {
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + 0.5;
    const r = 28 + ((i * 17) % 18);
    positions.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r });
  }
  ctx.strokeStyle = 'rgba(92,200,255,0.18)';
  ctx.lineWidth = 1;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      if (Math.sqrt(dx * dx + dy * dy) < 38) {
        ctx.beginPath();
        ctx.moveTo(positions[i].x, positions[i].y);
        ctx.lineTo(positions[j].x, positions[j].y);
        ctx.stroke();
      }
    }
  }
  ctx.fillStyle = '#5cc8ff';
  for (const p of positions) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10.5px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(label + ' mesh', cx, cy + 70);
}

function drawNode(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, label: string, sub: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0f1115';
  ctx.font = 'bold 9px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('GW', x, y + 3);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '10.5px ui-sans-serif, system-ui';
  ctx.fillText(label, x, y + 32);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '10px ui-sans-serif, system-ui';
  ctx.fillText(sub, x, y + 46);
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, label: string, style: 'solid' | 'dashed',
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash(style === 'dashed' ? [5, 4] : []);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = '10px ui-monospace';
  ctx.textAlign = 'center';
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  ctx.fillText(label, mx, my - 8);
}

function drawLossCurve(c: HTMLCanvasElement, currentHops: number) {
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const w = c.width;
  const h = c.height;
  ctx.clearRect(0, 0, w, h);

  const padL = 60;
  const padR = 130;
  const padT = 24;
  const padB = 36;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const maxHops = 60;

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let p = 0; p <= 100; p += 25) {
    const y = padT + (1 - p / 100) * innerH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + innerW, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px ui-monospace';
    ctx.textAlign = 'right';
    ctx.fillText(p + '%', padL - 8, y + 3);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '10px ui-monospace';
  ctx.textAlign = 'center';
  for (let n = 0; n <= maxHops; n += 10) {
    const x = padL + (n / maxHops) * innerW;
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + innerH);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(String(n), x, padT + innerH + 16);
  }
  ctx.textAlign = 'center';
  ctx.fillText('hops', padL + innerW / 2, padT + innerH + 30);

  const sevenX = padL + (7 / maxHops) * innerW;
  ctx.strokeStyle = 'rgba(255,209,102,0.6)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(sevenX, padT);
  ctx.lineTo(sevenX, padT + innerH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,209,102,0.95)';
  ctx.font = '10px ui-monospace';
  ctx.textAlign = 'left';
  ctx.fillText('7-hop ceiling', sevenX + 4, padT + 12);

  ctx.strokeStyle = '#ff6b81';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let n = 0; n <= maxHops; n++) {
    const survival = Math.pow(1 - HOP_LOSS, n);
    const x = padL + (n / maxHops) * innerW;
    const y = padT + (1 - survival) * innerH;
    if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.strokeStyle = '#5cc8ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let n = 0; n <= maxHops; n++) {
    const airtimeS = n * AIRTIME_PER_PACKET_S;
    const frac = Math.min(1, airtimeS / DUTY_CYCLE_BUDGET_S_PER_HOUR);
    const x = padL + (n / maxHops) * innerW;
    const y = padT + (1 - frac) * innerH;
    if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const cx = padL + (Math.min(currentHops, maxHops) / maxHops) * innerW;
  const survivalNow = Math.pow(1 - HOP_LOSS, currentHops);
  const cy = padT + (1 - survivalNow) * innerH;
  ctx.fillStyle = '#ff6b81';
  ctx.shadowColor = '#ff6b81';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  const lx = padL + innerW + 16;
  ctx.fillStyle = '#ff6b81';
  ctx.fillRect(lx, padT, 14, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '11px ui-sans-serif, system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('Packet survival', lx + 20, padT + 4);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '10px ui-sans-serif, system-ui';
  ctx.fillText('(1 − 8%)^N', lx + 20, padT + 18);

  ctx.fillStyle = '#5cc8ff';
  ctx.fillRect(lx, padT + 38, 14, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '11px ui-sans-serif, system-ui';
  ctx.fillText('EU duty-cycle use', lx + 20, padT + 42);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '10px ui-sans-serif, system-ui';
  ctx.fillText('% of 36 s/hr budget', lx + 20, padT + 56);
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : tone === 'good' ? 'var(--good)' : undefined;
  return (
    <div className="range-card">
      <div className="label">{label}</div>
      <div className="value" style={color ? { color } : undefined}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function Bullet({ color, title, children }: { color: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{children}</div>
    </div>
  );
}
