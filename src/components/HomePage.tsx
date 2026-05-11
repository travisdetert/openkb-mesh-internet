import React, { useEffect, useState } from 'react';
import type { TabId } from './TopNav';

interface Props {
  go: (id: TabId) => void;
  state: ConnectionState;
  nodesCount: number;
  positionedCount: number;
  lastPacketAt: number | null;
  packetsLast60s: number;
}

interface PathCard {
  to: TabId;
  title: string;
  blurb: string;
}

const WATCH_CARDS: PathCard[] = [
  { to: 'nodes',      title: 'Nodes',           blurb: 'Every radio your node has heard, with hop count, RSSI, SNR, and battery. Click any row for a full identity card and a line-of-sight estimate.' },
  { to: 'map',        title: 'Map',             blurb: 'Spatial view of nodes that have shared a position. Distance circles and precision halos make range failures intuitive.' },
  { to: 'chat',       title: 'Chat',            blurb: 'Per-channel conversations and DMs with delivery acks (✓ / ✗). Direct chat to any node from the Nodes table.' },
  { to: 'telemetry',  title: 'Telemetry',       blurb: 'Channel utilization and air-time-TX over time, plus battery / voltage from each node that reports it.' },
  { to: 'traceroute', title: 'Traceroute',      blurb: 'Ask the mesh to draw a hop-by-hop path to a specific node. Useful for diagnosing why a DM isn’t getting through.' },
  { to: 'sniffer',    title: 'Packet Sniffer',  blurb: 'Decode raw frames field-by-field. The fastest way to learn what your radio is actually saying on the wire.' },
];

const LEARN_CARDS: PathCard[] = [
  { to: 'link-budget',   title: 'Link Budget',         blurb: 'Why is my range what it is? Walk through TX power, antenna gain, free-space loss, and receiver sensitivity step by step.' },
  { to: 'rssi-distance', title: 'RSSI vs. Distance',   blurb: 'Live scatter of measured RSSI vs. the actual geographic distance between nodes — the realest range graph you can have.' },
  { to: 'coverage',      title: 'Coverage',            blurb: 'Combine measured path loss with elevation to estimate where signals will and won’t reach.' },
  { to: 'lora',          title: 'LoRa CSS',            blurb: 'How chirp spread spectrum lets a 25 mW radio decode −20 dB SNR. Animations, not equations.' },
  { to: 'mesh-routing',  title: 'Mesh Routing',        blurb: 'Why flooding works at small scale and breaks at large scale, and how Meshtastic limits hops to control the blast radius.' },
  { to: 'antennas',      title: 'Antennas',            blurb: 'Length, polarization, ground planes — the highest-leverage upgrade for almost every Meshtastic deployment.' },
];

const PLAN_CARDS: PathCard[] = [
  { to: 'reality',      title: 'Reality Check',     blurb: 'Cross-country messaging? Off-grid resilience? Honest answers about what this technology can and can’t do.' },
  { to: 'expectations', title: 'Expectations',      blurb: 'Concrete expected ranges, hop counts, and reply times for the most common deployments.' },
  { to: 'compare',      title: 'Compare',           blurb: 'Meshtastic next to LoRaWAN, satellite, and cell — when each architecture is the right answer.' },
  { to: 'concepts',     title: 'Concepts',          blurb: 'Browse every concept this app talks about, with cross-references back to the panels that demonstrate them.' },
];

function ago(ms: number): string {
  const d = Math.max(0, Date.now() - ms);
  if (d < 1000) return 'just now';
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  return `${Math.floor(d / 3_600_000)}h ago`;
}

export function HomePage({ go, state, nodesCount, positionedCount, lastPacketAt, packetsLast60s }: Props) {
  const [stats, setStats] = useState<DbStats | null>(null);

  useEffect(() => {
    let mounted = true;
    const refresh = () => window.mesh.dbStats().then((s) => mounted && setStats(s));
    refresh();
    const id = setInterval(refresh, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  return (
    <div className="page">
      <h1 className="page-title">A field guide to your Meshtastic node.</h1>
      <p className="page-sub">
        This app talks directly to your radio over USB. Watch packets fly. Understand why your range is what it is.
        Then learn how to push it further.
      </p>

      <Hero state={state} nodesCount={nodesCount} positionedCount={positionedCount} lastPacketAt={lastPacketAt} packetsLast60s={packetsLast60s} go={go} />

      <PathBucket title="Watch the mesh"  subtitle="Live data from your connected node." cards={WATCH_CARDS} go={go} disabledIfDisconnected={state.status !== 'ready'} />
      <PathBucket title="Learn the physics" subtitle="Works without a radio — uses your real data when available." cards={LEARN_CARDS} go={go} />
      <PathBucket title="Plan and decide"   subtitle="Frame your expectations and pick the right tool for the job." cards={PLAN_CARDS} go={go} />

      <div className="layout-split-wide" style={{ marginTop: 18 }}>
        <div>
          <div className="card">
            <h2>What is Meshtastic?</h2>
            <p style={{ margin: '0 0 10px', color: 'var(--text-dim)' }}>
              A small, cheap LoRa radio (sub-GHz, ~25 mW) that forwards short text messages and telemetry hop-by-hop
              across a self-organizing mesh — no internet, no cell tower, no infrastructure. It is what radios looked
              like before companies put paywalls in front of them.
            </p>
            <p style={{ margin: 0, color: 'var(--text-dim)' }}>
              Each node is two things stacked: a microcontroller (ESP32, nRF52, RP2040) running the Meshtastic
              firmware, and a LoRa transceiver chip (SX1262, SX1276) connected to an antenna. Your node speaks the
              <strong> Meshtastic protobuf protocol</strong> over USB serial — that's the wire we're listening on.
            </p>
          </div>

          <div className="card">
            <h2>The honest limitations</h2>
            <dl className="kv">
              <dt>Throughput</dt>
              <dd>~0.3–11 kbit/s (depends on preset). Texts only — no images, no voice.</dd>
              <dt>Latency</dt>
              <dd>Seconds to tens of seconds per hop. Mesh forwarding adds delay.</dd>
              <dt>Range</dt>
              <dd>~1–5 km urban, 5–30 km rural with line-of-sight, 100+ km mountaintop-to-mountaintop.</dd>
              <dt>Power output</dt>
              <dd>Region-locked (US: 30 dBm / 1 W max, EU: 14 dBm / 25 mW). Stock boards: 17–22 dBm.</dd>
              <dt>Channel capacity</dt>
              <dd>One channel, one talker at a time. Mesh saturates fast above ~30–50 active nodes.</dd>
              <dt>Privacy</dt>
              <dd>AES-256 per-channel — but anyone with the key can read everything on it.</dd>
            </dl>
          </div>
        </div>

        <div>
          <div className="info-card">
            <p style={{ margin: 0 }}><strong>Tip.</strong> The <em>Learn</em> tabs (Link Budget, Antennas, LoRa CSS, Mesh Routing) work offline — you don't need a connected node to explore them. They use your real signal data when available, otherwise reasonable defaults.</p>
          </div>

          {stats && (
            <div className="card">
              <h3>Aggregated data</h3>
              <p style={{ margin: '0 0 8px', color: 'var(--text-faint)', fontSize: 11.5 }}>
                Persists locally on disk. The longer you leave the app running, the better the analytics get.
              </p>
              <dl className="kv">
                <dt>Nodes</dt><dd>{stats.nodes.toLocaleString()}</dd>
                <dt>Positions</dt><dd>{stats.positions.toLocaleString()}</dd>
                <dt>Telemetry samples</dt><dd>{stats.telemetry.toLocaleString()}</dd>
                <dt>Messages</dt><dd>{stats.messages.toLocaleString()}</dd>
                <dt>Packets</dt><dd>{stats.packets.toLocaleString()}</dd>
                <dt>Traceroutes</dt><dd>{stats.traceroutes.toLocaleString()}</dd>
                <dt>Links</dt><dd>{stats.links.toLocaleString()}</dd>
              </dl>
              <p style={{ margin: '10px 0 0', color: 'var(--text-faint)', fontSize: 10.5, fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
                {stats.dbPath}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Hero({
  state, nodesCount, positionedCount, lastPacketAt, packetsLast60s, go,
}: Props) {
  if (state.status === 'disconnected') {
    return (
      <div className="hero">
        <div className="hero-row">
          <span className="hero-dot bad" />
          <div className="hero-headline">No radio connected.</div>
        </div>
        <p className="hero-sub">
          Plug your Meshtastic node in over USB and click Connect. We classify every USB-serial chip family
          (CP210x, CH340/CH9102, FTDI, native ESP32-S3 / nRF52 / RP2040) — your board will show up automatically.
        </p>
        <div className="hero-actions">
          <button className="primary" onClick={() => go('connect')}>Connect to my radio</button>
          <button className="ghost" onClick={() => go('reality')}>I don't have one yet — what is this?</button>
        </div>
      </div>
    );
  }

  if (state.status === 'connecting' || state.status === 'configuring') {
    return (
      <div className="hero">
        <div className="hero-row">
          <span className="hero-dot warn" />
          <div className="hero-headline">{state.status === 'connecting' ? 'Opening serial port…' : `Syncing nodeDB (${nodesCount} nodes received)`}</div>
        </div>
        <p className="hero-sub">
          The radio is sending us its identity, channels, and every node it has heard since boot. Usually 2–5 seconds.
        </p>
        <div className="hero-actions">
          <button className="ghost" onClick={() => go('connect')}>See connection details</button>
        </div>
      </div>
    );
  }

  // Ready
  const myId = state.myInfo?.myNodeNum;
  const myHex = myId ? '!' + myId.toString(16).padStart(8, '0') : '—';
  return (
    <div className="hero hero-ok">
      <div className="hero-row">
        <span className="hero-dot ok" />
        <div className="hero-headline">
          Connected as <code>{myHex}</code>
          {state.loraConfig?.regionName && <> · region {state.loraConfig.regionName}</>}
          {state.loraConfig?.modemPresetName && <> · {state.loraConfig.modemPresetName}</>}
        </div>
      </div>
      <div className="hero-stat-row">
        <HeroStat label="Nodes known"        value={String(nodesCount)} />
        <HeroStat label="With position"      value={String(positionedCount)} />
        <HeroStat label="Packets / min"      value={String(packetsLast60s)} tone={packetsLast60s > 0 ? 'good' : 'dim'} />
        <HeroStat label="Last packet"        value={lastPacketAt ? ago(lastPacketAt) : 'none yet'} tone={!lastPacketAt ? 'dim' : Date.now() - lastPacketAt < 60_000 ? 'good' : Date.now() - lastPacketAt < 300_000 ? 'warn' : 'bad'} />
      </div>
      {nodesCount === 0 && (
        <p className="hero-sub" style={{ margin: '10px 0 0' }}>
          Your radio hasn't heard any peers yet. Mesh traffic is sparse — this is normal in the first minutes after boot, and totally normal in residential areas.
        </p>
      )}
      <div className="hero-actions">
        <button className="primary" onClick={() => go('nodes')}>See who's out there</button>
        <button className="ghost"   onClick={() => go('chat')}>Send a message</button>
        <button className="ghost"   onClick={() => go('map')}>Open the map</button>
      </div>
    </div>
  );
}

function HeroStat({ label, value, tone = 'dim' }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'dim' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : 'var(--text)';
  return (
    <div className="hero-stat">
      <div className="hero-stat-label">{label}</div>
      <div className="hero-stat-value" style={{ color }}>{value}</div>
    </div>
  );
}

function PathBucket({
  title, subtitle, cards, go, disabledIfDisconnected,
}: {
  title: string;
  subtitle: string;
  cards: PathCard[];
  go: (id: TabId) => void;
  disabledIfDisconnected?: boolean;
}) {
  return (
    <section className="bucket">
      <div className="bucket-head">
        <h2 className="bucket-title">{title}</h2>
        <p className="bucket-sub">{subtitle}</p>
      </div>
      <div className="bucket-grid">
        {cards.map((c) => (
          <button key={c.to} className="path-card" onClick={() => go(c.to)} disabled={disabledIfDisconnected}>
            <div className="path-card-title">{c.title}</div>
            <div className="path-card-blurb">{c.blurb}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
