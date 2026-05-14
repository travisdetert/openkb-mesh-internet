import React, { useMemo, useState } from 'react';
import type { TabId } from '../TopNav';
import { channelHash, channelHashHex, pskFingerprint, pskLabel } from '../../channel-identity';
import { LearningModeBadge, LearningSeeAlso } from './LearningChrome';

/**
 * Learn-panel explainer for how Meshtastic node discovery actually works,
 * plus a live diagnostic of the user's own nodeDB so they can see the
 * mechanism running (or not) on their mesh.
 *
 * The aim is to defuse the most common "why don't I see X?" confusion:
 * Meshtastic isn't a "scan for nearby radios" protocol — peers only appear
 * after one of them broadcasts a NodeInfo packet on a channel you share.
 * The default broadcast cadence is 3 hours, so a fresh nodeDB can stay
 * sparse for surprisingly long.
 */

interface Props {
  state: ConnectionState;
  nodes: NodeRecord[];
  go: (id: TabId) => void;
}

const NODEINFO_DEFAULT_S = 3 * 3600; // 10 800 s
const STALE_S = 24 * 3600;
const VERY_STALE_S = 7 * 24 * 3600;

function agoLabel(secAgo: number): string {
  if (secAgo < 60) return `${Math.round(secAgo)}s ago`;
  if (secAgo < 3600) return `${Math.round(secAgo / 60)}m ago`;
  if (secAgo < 86400) return `${Math.round(secAgo / 3600)}h ago`;
  return `${Math.round(secAgo / 86400)}d ago`;
}

export function DiscoveryPanel({ state, nodes, go }: Props) {
  const myNum = state.myInfo?.myNodeNum;
  const nowSec = Math.floor(Date.now() / 1000);

  // Categorise known nodes by last-heard age.
  const stats = useMemo(() => {
    const peers = nodes.filter((n) => n.num !== myNum);
    const recentish = peers.filter((n) => n.lastHeard && (nowSec - n.lastHeard) < NODEINFO_DEFAULT_S).length;
    const stale = peers.filter((n) => n.lastHeard && (nowSec - n.lastHeard) > STALE_S && (nowSec - n.lastHeard) < VERY_STALE_S).length;
    const verystale = peers.filter((n) => n.lastHeard && (nowSec - n.lastHeard) > VERY_STALE_S).length;
    const neverHeard = peers.filter((n) => !n.lastHeard).length;
    return { total: peers.length, recentish, stale, verystale, neverHeard };
  }, [nodes, myNum, nowSec]);

  // Per-node last-heard sparkline (when in the last 24h did each peer broadcast?).
  const peerRows = useMemo(() => {
    return [...nodes]
      .filter((n) => n.num !== myNum && n.lastHeard)
      .sort((a, b) => (b.lastHeard ?? 0) - (a.lastHeard ?? 0))
      .slice(0, 30);
  }, [nodes, myNum]);

  const primary = state.channels?.find((c) => c.index === 0);
  const primaryHash = primary ? channelHash(primary.name || '', primary.psk ?? []) : null;

  return (
    <div className="page">
      <h1 className="page-title">Node Discovery</h1>
      <p className="page-sub">
        Why your radio sometimes sees lots of peers and sometimes none — even when nothing has changed in your setup.
        Meshtastic discovery is opaque by default; this page walks through the mechanism and shows you what your radio is actually seeing.
      </p>
      <LearningModeBadge mode="live" />

      <section className="discovery-section">
        <h2>1. How discovery actually works</h2>
        <p>
          A Meshtastic node doesn't "scan" for peers. It listens passively, and every other node on the same channel
          periodically broadcasts a small <code>NodeInfo</code> packet containing its identity (long name, short name,
          node number, hardware model, public key). When you receive one, that peer is now in your nodeDB.
        </p>
        <DiscoveryDiagram />
        <p style={{ marginTop: 8, color: 'var(--text-dim)', fontSize: 12.5 }}>
          Any packet — text, position, telemetry, traceroute — also registers the sender as a known node, because every packet header carries the sender's
          node number. NodeInfo is just the explicit "here's who I am" beacon.
        </p>
      </section>

      <section className="discovery-section">
        <h2>2. The cadence that surprises everyone</h2>
        <div className="discovery-cadence">
          <div>
            <p>
              Default <code>node_info_broadcast_secs</code> is <strong>10800 seconds (3 hours)</strong>. Most stock radios fire this on boot and every ~3 hours after.
              Until that timer expires or the node sends some other packet, your radio cannot know they exist.
            </p>
            <p>
              That means after rebooting a radio or resetting its nodeDB, a quiet mesh will look <em>empty</em> for up to ~3 hours.
              It feels broken. It's just the protocol.
            </p>
          </div>
          <CadenceClock />
        </div>
      </section>

      <section className="discovery-section">
        <h2>3. What forces a fresh broadcast</h2>
        <ul className="discovery-list">
          <li><strong>Reboot</strong> — every Meshtastic node sends a NodeInfo at boot.</li>
          <li><strong>Send any message</strong> — the packet header registers your identity even without a NodeInfo.</li>
          <li><strong>"Request NodeInfo"</strong> — the firmware exposes an admin command that asks a specific peer to broadcast now. Stock app surfaces this; this app doesn't yet expose it directly (todo).</li>
          <li><strong>Lower the broadcast interval</strong> — Settings → Device → Node info broadcast secs. 900 (15 min) is reasonable for active testing; below that risks duty-cycle violations.</li>
        </ul>
      </section>

      <section className="discovery-section">
        <h2>4. What blocks discovery</h2>
        <ul className="discovery-list">
          <li><strong>Different channel (name + PSK).</strong> Two radios on the same airwaves but different channels never see each other's NodeInfo — they can't even decrypt it. <em>Compare Radios</em> verifies this is the same.</li>
          <li><strong>Different region or preset.</strong> Different frequency band or chirp parameters = literally different radio configuration. Receivers don't tune in.</li>
          <li><strong>Out of range, or blocked.</strong> NodeInfo is just another packet — it follows the same physics as a chat message.</li>
          <li><strong>Deep sleep / power saving.</strong> Quiet client roles may suppress periodic broadcasts to save battery.</li>
          <li><strong>Duty-cycle exhausted.</strong> EU radios cap themselves at ~36s of airtime per hour. Heavy chat or position spam can postpone scheduled NodeInfos.</li>
          <li><strong>PKI key not exchanged (DMs).</strong> Firmware 2.5+ requires the destination's pubkey for DMs — if it's missing, the DM is silently dropped (broadcasts still work).</li>
        </ul>
      </section>

      <section className="discovery-section">
        <h2>5. Are you actually on the public mesh?</h2>
        <PublicMeshCheck state={state} go={go} />
      </section>

      <section className="discovery-section">
        <h2>6. Your radio's current discovery state</h2>
        {state.status !== 'ready' ? (
          <div className="info-card">
            <p style={{ margin: 0 }}>Connect a radio to see live discovery diagnostics.</p>
          </div>
        ) : (
          <>
            <div className="discovery-glance">
              <DiscStat label="Known peers" value={String(stats.total)} />
              <DiscStat label="Heard in last 3h" value={String(stats.recentish)} tone={stats.recentish > 0 ? 'good' : 'warn'} sub="(default NodeInfo window)" />
              <DiscStat label="Stale (1–7d)" value={String(stats.stale)} tone={stats.stale > 0 ? 'warn' : 'dim'} />
              <DiscStat label="Very stale (>7d)" value={String(stats.verystale)} tone={stats.verystale > 0 ? 'bad' : 'dim'} />
              <DiscStat label="No timestamp" value={String(stats.neverHeard)} tone={stats.neverHeard > 0 ? 'warn' : 'dim'} sub="learned via relay" />
            </div>

            {primary && primaryHash !== null && (
              <p style={{ marginTop: 12, color: 'var(--text-dim)', fontSize: 12.5 }}>
                You are listening on channel <strong>{primary.name || '(default)'}</strong> · {pskLabel(primary.pskLength)} · hash <code style={{ color: 'var(--accent)' }}>{channelHashHex(primaryHash)}</code> · psk fp <code>{pskFingerprint(primary.psk ?? [])}</code>.
                Any peer with a different hash here is invisible to you no matter how close.
              </p>
            )}

            <h3 style={{ marginTop: 16 }}>Per-peer last-heard timeline</h3>
            <p style={{ margin: '0 0 6px', color: 'var(--text-dim)', fontSize: 12 }}>
              When each known peer last sent anything (NodeInfo or otherwise). A flat-lined column past the 3h marker means
              that peer hasn't beaconed since — perfectly normal at default cadence.
            </p>
            {peerRows.length === 0 ? (
              <div className="empty" style={{ padding: 14 }}>No peers heard yet. Either no traffic, or they haven't beaconed since you started listening.</div>
            ) : (
              <table className="data discovery-table">
                <thead>
                  <tr>
                    <th>Peer</th>
                    <th>Hops</th>
                    <th>RSSI</th>
                    <th>Last heard</th>
                    <th style={{ width: '40%' }}>Recency</th>
                  </tr>
                </thead>
                <tbody>
                  {peerRows.map((n) => {
                    const secAgo = nowSec - (n.lastHeard ?? nowSec);
                    return (
                      <tr key={n.num}>
                        <td>
                          <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{n.shortName || '????'}</span>
                          <span style={{ marginLeft: 6, color: 'var(--text-faint)', fontSize: 11 }}>{n.longName || ''}</span>
                        </td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{n.hopsAway ?? '—'}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{n.rssi !== undefined && n.rssi !== 0 ? n.rssi : '—'}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{agoLabel(secAgo)}</td>
                        <td><RecencyBar secAgo={secAgo} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      <section className="discovery-section">
        <h2>If you suspect a problem</h2>
        <div className="discovery-actions">
          <button className="ghost" onClick={() => go('radio-compare')}>Compare two radios →</button>
          <button className="ghost" onClick={() => go('link-test')}>Verify RF link →</button>
          <button className="ghost" onClick={() => go('health')}>Run Mesh Health →</button>
          <button className="ghost" onClick={() => go('settings')}>Adjust broadcast interval →</button>
        </div>
        <p style={{ marginTop: 10, color: 'var(--text-faint)', fontSize: 12 }}>
          Quickest test: reboot one of your radios. If the other one's nodeDB picks it up within 60 seconds,
          the link is fine and you were just waiting for the next scheduled NodeInfo.
        </p>
      </section>

      <LearningSeeAlso go={go} links={[
        { to: 'radio-compare', label: 'Compare Radios', blurb: 'Why two radios on "the same channel" might still not see each other.' },
        { to: 'link-test',     label: 'Link Test',      blurb: 'Force a NodeInfo exchange to confirm both directions work.' },
        { to: 'health',        label: 'Mesh Health',    blurb: 'See whether your own radio is set up to be discoverable.' },
      ]} />
    </div>
  );
}

/**
 * Diagnose whether the user is on the public Meshtastic mesh or has
 * accidentally created a private island. Looks at the primary channel's
 * name and PSK signature against the firmware's well-known public default.
 */
function PublicMeshCheck({ state, go }: { state: ConnectionState; go: (id: TabId) => void }) {
  if (state.status !== 'ready') {
    return <div className="info-card">Connect a radio to run this check.</div>;
  }
  const primary = state.channels?.find((c) => c.index === 0);
  if (!primary) {
    return <div className="info-card">No primary channel reported by the radio yet.</div>;
  }

  const name = primary.name || '';
  const psk = primary.psk ?? [];
  const pskLen = primary.pskLength ?? psk.length;

  // The firmware's stock public default uses a 1-byte PSK indicator (value 0x01)
  // which expands internally to the well-known AES-256 default key. Many
  // public regional meshes also use this default but rename the channel.
  const isDefaultKey = pskLen === 1 && psk.length === 1 && psk[0] === 0x01;
  const isOpen = pskLen === 0;
  const isCustomKey = pskLen > 1; // any user-generated AES-128/256 key

  const isUnnamed = name === '';
  const isStandardName = ['LongFast', 'LongSlow', 'ShortFast', 'ShortSlow', 'MediumFast', 'MediumSlow', 'ShortTurbo', 'LongModerate'].includes(name);

  let verdict: 'public' | 'public-named' | 'private-key' | 'open' | 'private-named';
  let detail: React.ReactNode;
  let tone: 'good' | 'warn' | 'bad' | 'info' = 'good';

  if (isCustomKey) {
    verdict = 'private-key';
    tone = 'bad';
    detail = (
      <>
        <p style={{ margin: 0 }}>
          <strong>Your primary channel uses a custom encryption key</strong> ({pskLen}-byte
          {pskLen === 16 ? ' AES-128' : pskLen === 32 ? ' AES-256' : ''}).
          That means only radios you've personally given this key to can hear you. Most public mesh nodes around you
          are on the default key — your radios cannot decrypt their packets and they cannot decrypt yours.
        </p>
        <p style={{ margin: '6px 0 0' }}>
          <strong>Fix:</strong> open <em>Channels</em>, edit the primary channel, click <code>Default key</code>, and clear the channel name (or leave whatever is there). After saving, your radio will hear every node on the public default mesh in your range.
        </p>
      </>
    );
  } else if (isOpen) {
    verdict = 'open';
    tone = 'warn';
    detail = (
      <p style={{ margin: 0 }}>
        Your primary channel is <strong>open (no encryption)</strong>. Public-mesh nodes use the default key, so you won't hear them. Switch to the default key in the <em>Channels</em> editor.
      </p>
    );
  } else if (isDefaultKey && (isUnnamed || isStandardName)) {
    verdict = 'public';
    tone = 'good';
    detail = (
      <p style={{ margin: 0 }}>
        Looks like the public default: <code>{name || '(blank)'}</code> · default key. You <em>should</em> be hearing
        any public-mesh node in RF range. If you still see no nodes, the likely answers are <strong>nobody is in range</strong> (LoRa goes far but not through buildings),
        or every public node nearby has gone quiet (rural areas).
      </p>
    );
  } else if (isDefaultKey && !isStandardName) {
    verdict = 'public-named';
    tone = 'warn';
    detail = (
      <>
        <p style={{ margin: 0 }}>
          You're using the default key but you've <strong>renamed the channel</strong> to <code>{name}</code>.
          That changes the channel hash, so you're effectively on a private mesh named "{name}".
        </p>
        <p style={{ margin: '6px 0 0' }}>
          If you want to be on the absolute public default, clear the channel name. If "{name}" is a known regional
          mesh (e.g. <code>BayMesh</code>, <code>PHL</code>, <code>SoCal</code>), then you're on that mesh — and would only see nodes also on that channel.
        </p>
      </>
    );
  } else {
    verdict = 'private-named';
    tone = 'warn';
    detail = <p style={{ margin: 0 }}>Custom configuration — you're on a private mesh.</p>;
  }

  const fixUrl = `https://www.openstreetmap.org/`; // placeholder; not used here

  const toneColor = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : '#6db4ff';
  const toneBg   = tone === 'good' ? 'rgba(102,211,154,0.06)' : tone === 'warn' ? 'rgba(255,180,80,0.06)' : 'rgba(255,100,120,0.06)';
  const icon     = tone === 'good' ? '✓' : tone === 'bad' ? '✗' : '!';

  return (
    <div style={{
      background: toneBg,
      border: `1px solid ${toneColor}`,
      borderLeft: `3px solid ${toneColor}`,
      borderRadius: 6,
      padding: '12px 14px',
      display: 'grid',
      gridTemplateColumns: '32px 1fr',
      gap: 12,
      alignItems: 'start',
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: toneColor, color: '#1b1b1b',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
          {verdict === 'public'         && 'On the public default mesh'}
          {verdict === 'public-named'   && 'Renamed public mesh — effectively private'}
          {verdict === 'private-key'    && 'Private mesh — custom encryption key'}
          {verdict === 'open'           && 'Open channel — incompatible with public mesh'}
          {verdict === 'private-named'  && 'Private / custom mesh'}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          {detail}
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={() => go('channels')} style={{ padding: '4px 10px', fontSize: 11 }}>Open Channels →</button>
          <button className="ghost" onClick={() => go('mqtt')} style={{ padding: '4px 10px', fontSize: 11 }}>Enable MQTT bridge →</button>
        </div>
      </div>
    </div>
  );
}

// ── Visual helpers ───────────────────────────────────────────────────

/** Two-radio diagram with animated NodeInfo packets flying both ways. */
function DiscoveryDiagram() {
  return (
    <svg className="discovery-diagram" viewBox="0 0 600 200" preserveAspectRatio="xMidYMid meet">
      {/* Channel boundary */}
      <rect x="20" y="40" width="560" height="120" fill="rgba(120,180,255,0.04)" stroke="rgba(120,180,255,0.25)" strokeDasharray="4 3" rx="6" />
      <text x="40" y="60" fill="var(--text-faint)" fontFamily="var(--mono)" fontSize="11">channel "LongFast" · hash A7 · same PSK</text>

      {/* Radio A */}
      <g>
        <circle cx="120" cy="120" r="32" fill="var(--bg-elev)" stroke="var(--accent)" strokeWidth="2" />
        <text x="120" y="125" textAnchor="middle" fontFamily="var(--mono)" fontSize="14" fill="var(--accent)" fontWeight="600">TDeck</text>
        <text x="120" y="172" textAnchor="middle" fontSize="11" fill="var(--text-faint)">listening + beaconing</text>
      </g>

      {/* Radio B */}
      <g>
        <circle cx="480" cy="120" r="32" fill="var(--bg-elev)" stroke="var(--accent)" strokeWidth="2" />
        <text x="480" y="125" textAnchor="middle" fontFamily="var(--mono)" fontSize="14" fill="var(--accent)" fontWeight="600">Solar</text>
        <text x="480" y="172" textAnchor="middle" fontSize="11" fill="var(--text-faint)">listening + beaconing</text>
      </g>

      {/* Packet animations */}
      <g>
        <rect width="50" height="14" rx="3" fill="rgba(102,211,154,0.2)" stroke="var(--good)" strokeWidth="1">
          <animate attributeName="x" from="155" to="427" dur="2.6s" repeatCount="indefinite" />
          <animate attributeName="y" from="112" to="112" dur="2.6s" repeatCount="indefinite" />
        </rect>
        <text dy="3" fontSize="9" fontFamily="var(--mono)" fill="var(--good)" textAnchor="middle">
          <animate attributeName="x" from="180" to="452" dur="2.6s" repeatCount="indefinite" />
          <animate attributeName="y" from="120" to="120" dur="2.6s" repeatCount="indefinite" />
          NodeInfo
        </text>
      </g>
      <g>
        <rect width="50" height="14" rx="3" fill="rgba(255,209,102,0.2)" stroke="var(--warn)" strokeWidth="1">
          <animate attributeName="x" from="395" to="125" dur="2.6s" begin="1.3s" repeatCount="indefinite" />
          <animate attributeName="y" from="132" to="132" dur="2.6s" begin="1.3s" repeatCount="indefinite" />
        </rect>
        <text dy="3" fontSize="9" fontFamily="var(--mono)" fill="var(--warn)" textAnchor="middle">
          <animate attributeName="x" from="420" to="150" dur="2.6s" begin="1.3s" repeatCount="indefinite" />
          <animate attributeName="y" from="140" to="140" dur="2.6s" begin="1.3s" repeatCount="indefinite" />
          NodeInfo
        </text>
      </g>
    </svg>
  );
}

/** A clock showing the 3-hour broadcast cycle. */
function CadenceClock() {
  // Generate ticks every 15min around a full circle, highlighting the 3-hour mark.
  const ticks: React.ReactNode[] = [];
  const radius = 70;
  const cx = 90, cy = 90;
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
    const isMajor = i === 0 || i === 6;
    const x1 = cx + Math.cos(angle) * (radius - (isMajor ? 12 : 7));
    const y1 = cy + Math.sin(angle) * (radius - (isMajor ? 12 : 7));
    const x2 = cx + Math.cos(angle) * radius;
    const y2 = cy + Math.sin(angle) * radius;
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--line)" strokeWidth={isMajor ? 2 : 1} />);
  }
  // 3-hour wedge (90° to 180° from 12-o'clock, going clockwise from 12-o'clock)
  // 3 hours of 12 = 90 degrees. Sweep from -90 to 0 in SVG coords.
  return (
    <svg viewBox="0 0 180 180" width="180" height="180" className="cadence-clock">
      <circle cx={cx} cy={cy} r={radius} fill="var(--bg-elev)" stroke="var(--line)" strokeWidth="1" />
      <path d={`M${cx} ${cy} L${cx} ${cy - radius} A${radius} ${radius} 0 0 1 ${cx + radius} ${cy} Z`}
            fill="rgba(120,180,255,0.16)" stroke="var(--accent)" strokeWidth="1" strokeDasharray="3 2" />
      {ticks}
      <circle cx={cx} cy={cy} r={3} fill="var(--accent)" />
      <text x={cx} y={cy - 28} textAnchor="middle" fontSize="10" fill="var(--accent)" fontFamily="var(--mono)">3h</text>
      <text x={cx} y={cy + 38} textAnchor="middle" fontSize="9" fill="var(--text-faint)" fontFamily="var(--mono)">10800s default</text>
    </svg>
  );
}

/** Bar showing how recent a peer's last broadcast was on a 0–24h scale. */
function RecencyBar({ secAgo }: { secAgo: number }) {
  const hours = secAgo / 3600;
  const pct = Math.min(100, (hours / 24) * 100); // saturate at 24h
  const color =
    secAgo < 3600 ? 'var(--good)' :
    secAgo < NODEINFO_DEFAULT_S ? '#88c5ff' :
    secAgo < STALE_S ? 'var(--warn)' :
    'var(--bad)';
  return (
    <div className="recency-bar">
      <div className="recency-bar-fill" style={{ width: `${100 - pct}%`, background: color }} />
      <div className="recency-bar-tick" style={{ left: `${100 - (NODEINFO_DEFAULT_S / 86400) * 100}%` }} title="3h NodeInfo default" />
    </div>
  );
}

function DiscStat({ label, value, sub, tone = 'normal' }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' | 'dim' | 'normal' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : tone === 'dim' ? 'var(--text-faint)' : 'var(--text)';
  return (
    <div className="dash-stat">
      <div className="dash-stat-value" style={{ color }}>{value}</div>
      <div className="dash-stat-label">{label}</div>
      {sub && <div className="dash-stat-sub">{sub}</div>}
    </div>
  );
}
