import React, { useEffect, useState } from 'react';
import type { TabId } from './TopNav';
import type { ConnectionView } from '../hooks/useMesh';

interface Props {
  go: (id: TabId) => void;
  state: ConnectionState;
  nodes: NodeRecord[];
  nodesCount: number;
  positionedCount: number;
  lastPacketAt: number | null;
  packetsLast60s: number;
  messages: TextMessage[];
  recentPackets: Array<MeshPacketLite & { receivedAt: number }>;
  connections: ConnectionView[];
  activeConnId: string | null;
  setActiveConnId: (id: string) => void;
  unreadMessages: number;
  pendingTraces: number;
  onShowTour?: () => void;
  openDm?: (num: number) => void;
}

interface PathCard {
  to: TabId;
  title: string;
  blurb: string;
}

const LEARN_CARDS: PathCard[] = [
  { to: 'link-budget',   title: 'Link Budget',       blurb: 'TX power → loss → sensitivity, step by step.' },
  { to: 'rssi-distance', title: 'RSSI vs. Distance', blurb: 'Live scatter of measured RSSI vs. geographic distance.' },
  { to: 'coverage',      title: 'Coverage',          blurb: 'Measured path loss + elevation → estimated reach.' },
  { to: 'lora',          title: 'LoRa CSS',          blurb: 'How a 25 mW radio decodes −20 dB SNR.' },
  { to: 'mesh-routing',  title: 'Mesh Routing',      blurb: 'Why flooding works small and breaks large.' },
  { to: 'antennas',      title: 'Antennas',          blurb: 'Length, polarization, and ground planes.' },
];

const PLAN_CARDS: PathCard[] = [
  { to: 'reality',      title: 'Reality Check', blurb: 'What this radio honestly can and can’t do.' },
  { to: 'expectations', title: 'Expectations',  blurb: 'Expected ranges, hop counts, reply times.' },
  { to: 'compare',      title: 'Compare',       blurb: 'Meshtastic vs. LoRaWAN, satellite, cell.' },
  { to: 'concepts',     title: 'Concepts',      blurb: 'Glossary back-linked to every panel.' },
];

function ago(ms: number): string {
  const d = Math.max(0, Date.now() - ms);
  if (d < 1000) return 'just now';
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  return `${Math.floor(d / 3_600_000)}h ago`;
}

function shortAgo(ms: number): string {
  const d = Math.max(0, Date.now() - ms);
  if (d < 60_000) return `${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  return `${Math.floor(d / 3_600_000)}h`;
}

export function HomePage({
  go, state, nodes, nodesCount, positionedCount, lastPacketAt, packetsLast60s,
  messages, recentPackets, connections, activeConnId, setActiveConnId,
  unreadMessages, pendingTraces, onShowTour, openDm,
}: Props) {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [showLimits, setShowLimits] = useState(false);

  useEffect(() => {
    let mounted = true;
    const refresh = () => window.mesh.dbStats().then((s) => mounted && setStats(s));
    refresh();
    const id = setInterval(refresh, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const anyReady = connections.some((c) => c.state.status === 'ready');
  const anyConn = connections.length > 0;
  const myNode = state.myInfo?.myNodeNum ? nodes.find((n) => n.num === state.myInfo!.myNodeNum) : undefined;
  const chanUtil = myNode?.channelUtilization;

  return (
    <div className="page">
      <div className="home-header">
        <div>
          <h1 className="page-title">A field guide to your Meshtastic node.</h1>
          <p className="page-sub">
            Watch packets fly. Understand why your range is what it is. Then push it further.
          </p>
        </div>
        {onShowTour && (
          <button className="ghost home-tour-btn" onClick={onShowTour} title="Walk through the app's main panels">
            Show me around
          </button>
        )}
      </div>

      <DevicesSection
        connections={connections}
        activeConnId={activeConnId}
        setActiveConnId={setActiveConnId}
        go={go}
      />

      {anyReady && (
        <div className="home-2col">
          <HealthSummaryCard nodes={nodes} state={state} go={go} />
          <RecentActivityCard
            messages={messages}
            recentPackets={recentPackets}
            nodes={nodes}
            state={state}
            go={go}
            openDm={openDm}
          />
        </div>
      )}

      <section className="bucket bucket-tight">
        <div className="bucket-head">
          <h2 className="bucket-title">Watch the mesh</h2>
          <p className="bucket-sub">Live counts from your radio — click through for the full panel.</p>
        </div>
        <div className="watch-grid">
          <WatchTile to="nodes" title="Nodes" tagline="Everyone heard — hop, RSSI, battery."
            count={nodesCount} tone={nodesCount > 0 ? 'good' : 'dim'} go={go} disabled={!anyReady} />
          <WatchTile to="map" title="Map" tagline="Spatial view of positioned nodes."
            count={positionedCount} sub={nodesCount > 0 ? `of ${nodesCount}` : undefined}
            tone={positionedCount > 0 ? 'good' : 'dim'} go={go} disabled={!anyReady} />
          <WatchTile to="chat" title="Chat" tagline="Channels and DMs with delivery acks."
            count={unreadMessages} sub={unreadMessages > 0 ? 'new' : 'caught up'}
            tone={unreadMessages > 0 ? 'accent' : 'dim'} go={go} disabled={!anyReady} />
          <WatchTile to="telemetry" title="Telemetry" tagline="Channel util, air-time, battery history."
            count={chanUtil !== undefined ? Math.round(chanUtil) : 0}
            sub={chanUtil !== undefined ? '% util' : 'no data'}
            tone={chanUtil === undefined ? 'dim' : chanUtil >= 25 ? 'warn' : 'good'}
            go={go} disabled={!anyReady} />
          <WatchTile to="traceroute" title="Traceroute" tagline="Hop-by-hop paths to a specific node."
            count={pendingTraces} sub={pendingTraces > 0 ? 'pending' : 'idle'}
            tone={pendingTraces > 0 ? 'warn' : 'dim'} go={go} disabled={!anyReady} />
          <WatchTile to="sniffer" title="Packet Sniffer" tagline="Decode raw frames field by field."
            count={packetsLast60s} sub="/min"
            tone={packetsLast60s > 0 ? 'good' : 'dim'} go={go} disabled={!anyReady} />
        </div>
      </section>

      <CompactBucket title="Learn the physics" subtitle="Works without a radio — uses your real data when available." cards={LEARN_CARDS} go={go} />
      <CompactBucket title="Plan and decide" subtitle="Frame your expectations and pick the right tool." cards={PLAN_CARDS} go={go} />

      <section className="about-row">
        <div className="card about-card">
          <h3 className="about-title">What is Meshtastic?</h3>
          <p>
            A small, cheap LoRa radio (sub-GHz, ~25 mW) that forwards short text messages and telemetry hop-by-hop across a
            self-organizing mesh — no internet, no cell tower, no infrastructure. Your node speaks the
            <strong> Meshtastic protobuf protocol</strong> over USB serial — that’s the wire we listen on.
          </p>
        </div>

        <div className="card about-card">
          <button className="about-toggle" onClick={() => setShowLimits((v) => !v)} aria-expanded={showLimits}>
            <h3 className="about-title" style={{ margin: 0 }}>Honest limitations</h3>
            <span className="about-toggle-chev">{showLimits ? '▾' : '▸'}</span>
          </button>
          {showLimits ? (
            <dl className="kv kv-tight">
              <dt>Throughput</dt><dd>~0.3–11 kbit/s. Texts only — no images, no voice.</dd>
              <dt>Latency</dt><dd>Seconds to tens of seconds per hop.</dd>
              <dt>Range</dt><dd>~1–5 km urban, 5–30 km rural LOS, 100+ km peak-to-peak.</dd>
              <dt>Power</dt><dd>Region-locked (US 30 dBm, EU 14 dBm). Stock 17–22 dBm.</dd>
              <dt>Capacity</dt><dd>One talker at a time. Saturates above ~30–50 active nodes.</dd>
              <dt>Privacy</dt><dd>AES-256 per-channel — anyone with the key reads everything.</dd>
            </dl>
          ) : (
            <p style={{ margin: '6px 0 0', color: 'var(--text-faint)', fontSize: 12 }}>
              Throughput, latency, range, power, capacity, privacy — click to expand.
            </p>
          )}
        </div>

        {stats && (
          <div className="card about-card">
            <h3 className="about-title">Your data</h3>
            <p style={{ margin: '0 0 6px', color: 'var(--text-faint)', fontSize: 11.5 }}>
              Persists locally. The longer it runs, the better the analytics.
            </p>
            <dl className="kv kv-tight">
              <dt>Nodes</dt><dd>{stats.nodes.toLocaleString()}</dd>
              <dt>Positions</dt><dd>{stats.positions.toLocaleString()}</dd>
              <dt>Telemetry</dt><dd>{stats.telemetry.toLocaleString()}</dd>
              <dt>Messages</dt><dd>{stats.messages.toLocaleString()}</dd>
              <dt>Packets</dt><dd>{stats.packets.toLocaleString()}</dd>
              <dt>Links</dt><dd>{stats.links.toLocaleString()}</dd>
            </dl>
          </div>
        )}
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Connected devices — replaces the old Hero. One compact tile per radio,
// or a single "no radio" CTA when nothing is connected.
// ────────────────────────────────────────────────────────────────────

function DevicesSection({
  connections, activeConnId, setActiveConnId, go,
}: {
  connections: ConnectionView[];
  activeConnId: string | null;
  setActiveConnId: (id: string) => void;
  go: (id: TabId) => void;
}) {
  if (connections.length === 0) {
    return (
      <div className="devices-empty">
        <div className="devices-empty-row">
          <span className="hero-dot bad" />
          <div>
            <div className="devices-empty-headline">No radio connected.</div>
            <p className="devices-empty-sub">
              Plug a Meshtastic node in over USB. We classify every USB-serial chip (CP210x, CH340/CH9102, FTDI, native ESP32-S3 / nRF52 / RP2040) and recognised boards auto-connect.
            </p>
          </div>
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={() => go('connect')}>Connect a radio</button>
          <button className="ghost" onClick={() => go('reality')}>I don’t have one yet — what is this?</button>
        </div>
      </div>
    );
  }

  return (
    <section className="bucket bucket-tight">
      <div className="bucket-head">
        <h2 className="bucket-title">Connected devices</h2>
        <p className="bucket-sub">
          {connections.length === 1 ? 'Your radio.' : `${connections.length} radios in this session.`} Click a tile to make it active or open the Connect panel to manage.
        </p>
      </div>
      <div className="devices-grid">
        {connections.map((c) => (
          <DeviceTile key={c.connId} c={c} isActive={c.connId === activeConnId} onClick={() => setActiveConnId(c.connId)} />
        ))}
        <button className="device-tile device-tile-add" onClick={() => go('connect')} title="Open the Connect panel">
          <span className="device-tile-add-icon">+</span>
          <span className="device-tile-add-label">Add or manage</span>
        </button>
      </div>
    </section>
  );
}

function DeviceTile({ c, isActive, onClick }: { c: ConnectionView; isActive: boolean; onClick: () => void }) {
  const my = c.state.myInfo?.myNodeNum;
  const myNode = my ? c.nodes.find((n) => n.num === my) : undefined;
  const short = myNode?.shortName || c.portPath?.split('/').pop() || c.connId;
  const long = myNode?.longName;
  const region = c.state.loraConfig?.regionName;
  const preset = c.state.loraConfig?.usePreset ? c.state.loraConfig?.modemPresetName : 'custom';
  const status = c.state.status;
  const dotCls = status === 'ready' ? 'ok' : status === 'disconnected' ? 'bad' : 'warn';
  const lastPkt = c.lastPacketAt;
  const pktMin = c.packetTimestamps.length;
  const batt = myNode?.batteryLevel;
  const battColor = batt === undefined ? undefined : batt > 50 ? 'var(--good)' : batt > 20 ? 'var(--warn)' : 'var(--bad)';
  const isReady = status === 'ready';

  return (
    <button className={'device-tile' + (isActive ? ' active' : '')} onClick={onClick}>
      <div className="device-tile-head">
        <span className={`hero-dot ${dotCls}`} />
        <div className="device-tile-names">
          <div className="device-tile-short">{short}</div>
          {long && <div className="device-tile-long">{long}</div>}
        </div>
        {isActive && <span className="device-tile-active-pill">active</span>}
      </div>
      <div className="device-tile-config">
        {isReady && region ? <>{region}{preset ? <> · {preset}</> : null}</> : status === 'configuring' ? 'syncing nodeDB…' : status === 'connecting' ? 'opening port…' : 'disconnected'}
      </div>
      <div className="device-tile-stats">
        <DTStat label="nodes" value={String(c.nodes.length)} tone={c.nodes.length > 0 ? 'good' : 'dim'} />
        <DTStat label="/min"  value={String(pktMin)} tone={pktMin > 0 ? 'good' : 'dim'} />
        <DTStat label="last"  value={lastPkt ? shortAgo(lastPkt) : '—'} tone={!lastPkt ? 'dim' : Date.now() - lastPkt < 60_000 ? 'good' : Date.now() - lastPkt < 300_000 ? 'warn' : 'bad'} />
        <DTStat label="batt"  value={batt !== undefined ? `${batt}%` : '—'} color={battColor} />
      </div>
    </button>
  );
}

function DTStat({ label, value, tone, color }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'dim'; color?: string }) {
  const c = color ?? (tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : tone === 'dim' ? 'var(--text-faint)' : 'var(--text)');
  return (
    <div className="dt-stat">
      <span className="dt-stat-value" style={{ color: c }}>{value}</span>
      <span className="dt-stat-label">{label}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Recent activity + Health cards — kept from previous layout, smaller.
// ────────────────────────────────────────────────────────────────────

function RecentActivityCard({
  messages, recentPackets, nodes, state, go, openDm,
}: {
  messages: TextMessage[];
  recentPackets: Array<MeshPacketLite & { receivedAt: number }>;
  nodes: NodeRecord[];
  state: ConnectionState;
  go: (id: TabId) => void;
  openDm?: (num: number) => void;
}) {
  const myNum = state.myInfo?.myNodeNum ?? 0;

  const recentMessages = messages.slice(-6).reverse();
  const recentNewNodes = [...nodes]
    .filter((n) => n.firstHeard && Date.now() - n.firstHeard < 24 * 3600_000 && n.num !== myNum)
    .sort((a, b) => (b.firstHeard ?? 0) - (a.firstHeard ?? 0))
    .slice(0, 3);

  type Entry = { ts: number; kind: 'msg' | 'newnode'; node?: number; preview: string; onClick?: () => void };
  const entries: Entry[] = [
    ...recentMessages.map((m): Entry => {
      const from = m.from === myNum ? 'me' : nameFor(nodes, m.from);
      const where = m.to === 0xffffffff ? `# ch ${m.channel}` : (m.from === myNum ? `→ ${nameFor(nodes, m.to)}` : 'DM');
      return {
        ts: m.rxTime * 1000,
        kind: 'msg',
        node: m.from,
        preview: `${from}${where !== 'DM' ? ' ' + where : ''}: ${m.text.startsWith('> ') ? m.text.split('\n').slice(1).join(' ') : m.text}`,
        onClick: () => { if (m.to === 0xffffffff) go('chat'); else openDm?.(m.from === myNum ? m.to : m.from); },
      };
    }),
    ...recentNewNodes.map((n): Entry => ({
      ts: n.firstHeard ?? 0,
      kind: 'newnode',
      node: n.num,
      preview: `New node: ${n.shortName || ('!' + (n.num >>> 0).toString(16).slice(-4))}${n.longName ? ` — ${n.longName}` : ''}`,
      onClick: () => openDm?.(n.num),
    })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 7);

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div className="dash-card-title">Recent activity</div>
        <button className="dash-card-link" onClick={() => go('events')}>→ Event Feed</button>
      </div>
      {entries.length === 0 ? (
        <div className="dash-empty">No activity yet. Wait for traffic or send a message to wake the channel.</div>
      ) : (
        <ul className="dash-feed">
          {entries.map((e, i) => (
            <li key={i} className="dash-feed-row" onClick={e.onClick} role={e.onClick ? 'button' : undefined} tabIndex={e.onClick ? 0 : undefined}>
              <span className={'dash-feed-icon dash-feed-icon-' + e.kind}>{e.kind === 'msg' ? '✉' : '+'}</span>
              <span className="dash-feed-text">{e.preview}</span>
              <span className="dash-feed-time">{ago(e.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HealthSummaryCard({
  nodes, state, go,
}: {
  nodes: NodeRecord[];
  state: ConnectionState;
  go: (id: TabId) => void;
}) {
  const findings: Array<{ severity: 'critical' | 'warn' | 'info'; label: string }> = [];
  const myNum = state.myInfo?.myNodeNum;
  const heard = nodes.filter((n) => n.lastHeard);
  const stale = heard.filter((n) => n.lastHeard && (Date.now() / 1000 - n.lastHeard) > 24 * 3600).length;
  const lowBatt = nodes.filter((n) => n.batteryLevel !== undefined && n.batteryLevel > 0 && n.batteryLevel <= 20).length;
  const myNode = myNum ? nodes.find((n) => n.num === myNum) : undefined;

  if (state.loraConfig?.region === 0) findings.push({ severity: 'critical', label: 'LoRa region is UNSET — radio cannot TX legally' });
  if (state.loraConfig && !state.loraConfig.txEnabled) findings.push({ severity: 'critical', label: 'TX is disabled — radio is receive-only' });
  if (myNode?.channelUtilization !== undefined && myNode.channelUtilization >= 25) findings.push({ severity: 'warn', label: `Channel util ${myNode.channelUtilization.toFixed(0)}% — congested` });
  if (stale > 0 && heard.length > 0 && stale / heard.length > 0.5) findings.push({ severity: 'warn', label: `${stale} of ${heard.length} nodes stale (>24h)` });
  if (lowBatt > 0) findings.push({ severity: 'info', label: `${lowBatt} node${lowBatt === 1 ? '' : 's'} below 20% battery` });
  if (state.mqttConfig?.mapReportingEnabled) findings.push({ severity: 'info', label: 'Position published to public Meshtastic map' });

  const critical = findings.filter((f) => f.severity === 'critical').length;
  const warn = findings.filter((f) => f.severity === 'warn').length;

  return (
    <button className="dash-card dash-card-button" onClick={() => go('health')}>
      <div className="dash-card-head">
        <div className="dash-card-title">Mesh health</div>
        <span className="dash-card-link">→ Mesh Health</span>
      </div>
      {findings.length === 0 ? (
        <div className="dash-health-ok">
          <div className="dash-health-icon ok">✓</div>
          <div>
            <div style={{ fontSize: 13, color: 'var(--good)' }}>All checks passing</div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>No issues from the quick scan.</div>
          </div>
        </div>
      ) : (
        <>
          <div className="dash-health-counts">
            {critical > 0 && <span className="dash-health-count bad">{critical} critical</span>}
            {warn > 0 && <span className="dash-health-count warn">{warn} warn</span>}
            {findings.length - critical - warn > 0 && <span className="dash-health-count info">{findings.length - critical - warn} info</span>}
          </div>
          <ul className="dash-health-list">
            {findings.slice(0, 4).map((f, i) => (
              <li key={i} className={'dash-health-row dash-health-' + f.severity}>
                <span className="dash-health-bullet" />
                <span>{f.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// Watch / Learn / Plan tiles
// ────────────────────────────────────────────────────────────────────

function WatchTile({
  to, title, tagline, count, sub, tone, go, disabled,
}: {
  to: TabId;
  title: string;
  tagline: string;
  count: number;
  sub?: string;
  tone: 'good' | 'warn' | 'accent' | 'dim';
  go: (id: TabId) => void;
  disabled?: boolean;
}) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'accent' ? 'var(--accent)' : 'var(--text-faint)';
  return (
    <button className="watch-tile" onClick={() => go(to)} disabled={disabled}>
      <div className="watch-tile-head">
        <span className="watch-tile-title">{title}</span>
        <span className="watch-tile-count" style={{ color }}>
          {count}{sub ? <span className="watch-tile-sub">{sub}</span> : null}
        </span>
      </div>
      <div className="watch-tile-blurb">{tagline}</div>
    </button>
  );
}

function CompactBucket({ title, subtitle, cards, go }: { title: string; subtitle: string; cards: PathCard[]; go: (id: TabId) => void }) {
  return (
    <section className="bucket bucket-tight">
      <div className="bucket-head">
        <h2 className="bucket-title">{title}</h2>
        <p className="bucket-sub">{subtitle}</p>
      </div>
      <div className="bucket-grid bucket-grid-tight">
        {cards.map((c) => (
          <button key={c.to} className="path-card path-card-tight" onClick={() => go(c.to)}>
            <div className="path-card-title">{c.title}</div>
            <div className="path-card-blurb">{c.blurb}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

function nameFor(nodes: NodeRecord[], num: number): string {
  const n = nodes.find((x) => x.num === num);
  return n?.shortName || '!' + (num >>> 0).toString(16).slice(-4);
}
