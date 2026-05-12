import React, { useMemo } from 'react';
import type { TabId } from '../TopNav';

type Severity = 'critical' | 'warn' | 'info' | 'ok';

interface Finding {
  /** Stable key — used to dedupe & let the user dismiss in future. */
  key: string;
  severity: Severity;
  title: string;
  detail: React.ReactNode;
  action?: { label: string; tab: TabId };
}

interface Section {
  title: string;
  blurb: string;
  findings: Finding[];
}

interface Props {
  state: ConnectionState;
  nodes: NodeRecord[];
  traces: PacketTrace[];
  links: LinkRow[];
  recentPackets: Array<MeshPacketLite & { receivedAt: number }>;
  packetsLast60s: number;
  lastPacketAt: number | null;
  go: (tab: TabId) => void;
}

const STALE_S = 24 * 3600;
const VERY_STALE_S = 7 * 24 * 3600;

function shortHex(n: number): string { return '!' + (n >>> 0).toString(16).padStart(8, '0').slice(-4); }
function nameFor(nodes: NodeRecord[], num: number): string {
  const n = nodes.find((x) => x.num === num);
  return n?.shortName || shortHex(num);
}

// ─── Check helpers ─────────────────────────────────────────────────────

function checkOwnRadio(state: ConnectionState): Finding[] {
  const out: Finding[] = [];
  if (state.status !== 'ready') return out;

  const lora = state.loraConfig;
  if (lora) {
    if (lora.region === 0) {
      out.push({
        key: 'region-unset',
        severity: 'critical',
        title: 'LoRa region is UNSET',
        detail: 'The radio is not licensed to transmit on any band yet. Set the correct region in Settings before it can talk to anyone.',
        action: { label: 'Open Settings', tab: 'settings' },
      });
    }
    if (!lora.txEnabled) {
      out.push({
        key: 'tx-disabled',
        severity: 'critical',
        title: 'TX is disabled',
        detail: 'This radio can receive but never transmit. Re-enable TX in Settings → LoRa.',
        action: { label: 'Open Settings', tab: 'settings' },
      });
    }
    if (lora.txPower !== 0 && lora.txPower < 5) {
      out.push({
        key: 'tx-power-low',
        severity: 'warn',
        title: `TX power is very low (${lora.txPower} dBm)`,
        detail: 'Below 5 dBm the link gets unreliable even indoors. Most users want 17–22 dBm; leave at 0 (auto) unless you have a reason to clamp.',
        action: { label: 'Open Settings', tab: 'settings' },
      });
    }
    if (lora.hopLimit < 1) {
      out.push({
        key: 'hop-limit-zero',
        severity: 'warn',
        title: 'Hop limit is 0',
        detail: 'No relay will rebroadcast packets from this radio — only direct neighbors will see your traffic.',
        action: { label: 'Open Settings', tab: 'settings' },
      });
    }
  }

  // Channel sanity
  const primary = state.channels?.find((c) => c.index === 0);
  if (primary) {
    const isOpen = (primary.pskLength ?? 0) === 0;
    const isDefaultKey = (primary.pskLength ?? 0) === 1 && primary.psk?.[0] === 0x01;
    if (isOpen) {
      out.push({
        key: 'primary-open',
        severity: 'info',
        title: 'Primary channel is open (no encryption)',
        detail: 'Everyone on the same name + region will see your traffic in the clear. Fine for public meshes; switch to a custom AES key for private groups.',
        action: { label: 'Open Channels', tab: 'channels' },
      });
    }
    if (!primary.name && !isOpen && !isDefaultKey) {
      out.push({
        key: 'primary-name-blank',
        severity: 'warn',
        title: 'Primary channel has no name',
        detail: 'A blank name + custom PSK is unusual and may indicate a partially-imported channel set.',
        action: { label: 'Open Channels', tab: 'channels' },
      });
    }
  }

  // MQTT firehose check (your radio is the source)
  if (state.mqttConfig?.enabled && state.mqttConfig?.proxyToClientEnabled) {
    out.push({
      key: 'mqtt-proxy-on',
      severity: 'warn',
      title: 'MQTT proxy-to-client is on but this app does not yet relay',
      detail: 'The radio is sending MQTT frames over USB expecting this app to forward them, but this app has not implemented the client-side broker bridge. Until then, MQTT traffic will queue without going anywhere.',
      action: { label: 'Open MQTT', tab: 'mqtt' },
    });
  }
  if (state.mqttConfig?.enabled && !state.mqttConfig?.encryptionEnabled) {
    out.push({
      key: 'mqtt-plaintext',
      severity: 'warn',
      title: 'MQTT publishing plaintext (channel encryption stripped)',
      detail: 'When encryption_enabled is off, packets are published to the broker in cleartext. Anyone subscribed to your topic can read traffic on any channel that has uplink enabled.',
      action: { label: 'Open MQTT', tab: 'mqtt' },
    });
  }

  return out;
}

function checkPrivacy(state: ConnectionState): Finding[] {
  const out: Finding[] = [];
  if (state.mqttConfig?.mapReportingEnabled) {
    out.push({
      key: 'map-reporting-on',
      severity: 'info',
      title: 'Publishing position to the public Meshtastic map',
      detail: 'Your radio\'s position is being uploaded to https://meshtastic.org/map. Disable in MQTT settings if you didn\'t intend that.',
      action: { label: 'Open MQTT', tab: 'mqtt' },
    });
  }
  const pos = state.positionConfig;
  // positionFlags bit 0 = ALTITUDE, etc — high-precision sharing isn't a flag we expose directly,
  // but if smart broadcast is OFF and position_broadcast_secs is short, that's wasteful.
  if (pos && !pos.positionBroadcastSmartEnabled && pos.positionBroadcastSecs > 0 && pos.positionBroadcastSecs < 300) {
    out.push({
      key: 'pos-flooding',
      severity: 'warn',
      title: `Position broadcast every ${pos.positionBroadcastSecs}s with smart broadcast off`,
      detail: 'Without smart-broadcast, position packets go out on a fixed timer even when you haven\'t moved. Enable smart broadcast or raise the interval to ≥300 s.',
      action: { label: 'Open Settings', tab: 'settings' },
    });
  }
  return out;
}

function checkLocalMesh(state: ConnectionState, nodes: NodeRecord[], lastPacketAt: number | null): Finding[] {
  const out: Finding[] = [];
  const myNum = state.myInfo?.myNodeNum;
  const nowS = Math.floor(Date.now() / 1000);

  const rfNodes = nodes.filter((n) => !n.viaMqtt && n.num !== myNum);
  const heard = rfNodes.filter((n) => n.lastHeard);
  const stale = heard.filter((n) => (nowS - (n.lastHeard ?? 0)) > STALE_S);
  const verystale = heard.filter((n) => (nowS - (n.lastHeard ?? 0)) > VERY_STALE_S);
  const direct = heard.filter((n) => (n.hopsAway ?? 0) === 0);

  if (state.status === 'ready' && rfNodes.length === 0) {
    out.push({
      key: 'no-rf-neighbors',
      severity: 'warn',
      title: 'No RF neighbors heard yet',
      detail: lastPacketAt
        ? 'Packets are arriving, but none are from another local-mesh node. You may be hearing only MQTT-sourced traffic; check the source chip on Nodes.'
        : 'Mesh traffic is sparse — give it a few minutes, or transmit something to wake the channel. If still nothing, see the Compare Radios panel.',
      action: { label: 'Open Nodes', tab: 'nodes' },
    });
  }

  if (state.status === 'ready' && rfNodes.length > 0 && direct.length === 0) {
    out.push({
      key: 'no-direct',
      severity: 'warn',
      title: `No direct (0-hop) neighbors — ${heard.length} nodes only via relays`,
      detail: 'Every node you can hear is being relayed through someone else. You\'re likely on the fringe of the mesh, or your antenna needs height/orientation help.',
      action: { label: 'Open Map', tab: 'map' },
    });
  }

  if (verystale.length > 0 && verystale.length === heard.length && heard.length > 3) {
    out.push({
      key: 'all-stale',
      severity: 'critical',
      title: `All ${heard.length} known nodes are very stale (>7 days)`,
      detail: 'No fresh RF activity at all. The radio is connected but the mesh around you appears dead — could be antenna, region/preset mismatch, or you moved away from your usual area.',
      action: { label: 'Open Compare Radios', tab: 'radio-compare' },
    });
  } else if (stale.length > 0 && heard.length > 0 && stale.length / heard.length > 0.6) {
    out.push({
      key: 'mostly-stale',
      severity: 'warn',
      title: `${stale.length} of ${heard.length} RF nodes are stale (>24h)`,
      detail: 'A majority of your neighbors went quiet. Could be normal nighttime/weekend slowdown, or a regional outage.',
      action: { label: 'Open Nodes', tab: 'nodes' },
    });
  }

  // Battery rounds
  const lowBatt = rfNodes.filter((n) => n.batteryLevel !== undefined && n.batteryLevel <= 20 && n.batteryLevel > 0 && n.batteryLevel < 101);
  if (lowBatt.length > 0) {
    out.push({
      key: 'low-batteries',
      severity: 'info',
      title: `${lowBatt.length} node${lowBatt.length === 1 ? '' : 's'} below 20% battery`,
      detail: lowBatt.slice(0, 5).map((n) => `${n.shortName || shortHex(n.num)} (${n.batteryLevel}%)`).join(' · ') + (lowBatt.length > 5 ? ` · …+${lowBatt.length - 5} more` : ''),
      action: { label: 'Open Telemetry', tab: 'telemetry' },
    });
  }

  // Short-name collisions
  const byShort = new Map<string, NodeRecord[]>();
  for (const n of nodes) {
    if (!n.shortName) continue;
    const arr = byShort.get(n.shortName) ?? [];
    arr.push(n);
    byShort.set(n.shortName, arr);
  }
  const collisions = Array.from(byShort.values()).filter((arr) => arr.length > 1);
  if (collisions.length > 0) {
    out.push({
      key: 'short-name-collision',
      severity: 'info',
      title: `${collisions.length} short-name collision${collisions.length === 1 ? '' : 's'}`,
      detail: collisions.slice(0, 3).map((arr) => `${arr[0].shortName}: ${arr.map((x) => shortHex(x.num)).join(' / ')}`).join(' · ')
        + (collisions.length > 3 ? ` · …+${collisions.length - 3} more` : ''),
      action: { label: 'Open Nodes', tab: 'nodes' },
    });
  }

  // Missing positions among RF nodes
  const heardNoPos = heard.filter((n) => n.lat === undefined || n.lon === undefined || (n.lat === 0 && n.lon === 0));
  if (heard.length > 0 && heardNoPos.length / heard.length > 0.5 && heard.length > 3) {
    out.push({
      key: 'missing-positions',
      severity: 'info',
      title: `${heardNoPos.length} of ${heard.length} heard nodes lack a position`,
      detail: 'Position broadcasts are opt-in — many users have them off. The Map will only ever show nodes that share theirs.',
      action: { label: 'Open Map', tab: 'map' },
    });
  }

  return out;
}

function checkTraffic(
  state: ConnectionState,
  nodes: NodeRecord[],
  traces: PacketTrace[],
  recentPackets: Array<MeshPacketLite & { receivedAt: number }>,
  packetsLast60s: number,
  lastPacketAt: number | null,
): Finding[] {
  const out: Finding[] = [];
  const myNum = state.myInfo?.myNodeNum;

  // Channel utilization (the radio reports its own + may receive others' via telemetry)
  const myNode = myNum ? nodes.find((n) => n.num === myNum) : undefined;
  if (myNode?.channelUtilization !== undefined && myNode.channelUtilization >= 25) {
    out.push({
      key: 'my-chan-util-high',
      severity: 'critical',
      title: `This radio's channel utilization is ${myNode.channelUtilization.toFixed(1)}%`,
      detail: 'Above 25% the channel is congested — packets queue, ack timeouts climb, and delivery degrades. Reduce position broadcast frequency, disable noisy modules, or switch to a less congested channel.',
      action: { label: 'Open Settings', tab: 'settings' },
    });
  } else if (myNode?.channelUtilization !== undefined && myNode.channelUtilization >= 15) {
    out.push({
      key: 'my-chan-util-warn',
      severity: 'warn',
      title: `This radio's channel utilization is ${myNode.channelUtilization.toFixed(1)}%`,
      detail: 'Approaching the duty-cycle ceiling. Above 25% the radio starts to throttle.',
      action: { label: 'Open Settings', tab: 'settings' },
    });
  }

  // High-util neighbors
  const hotNeighbors = nodes.filter((n) => n.num !== myNum && n.channelUtilization !== undefined && n.channelUtilization >= 25);
  if (hotNeighbors.length > 0) {
    out.push({
      key: 'neighbor-chan-util-high',
      severity: 'warn',
      title: `${hotNeighbors.length} neighbor${hotNeighbors.length === 1 ? '' : 's'} report channel-util ≥ 25%`,
      detail: hotNeighbors.slice(0, 5).map((n) => `${n.shortName || shortHex(n.num)}: ${n.channelUtilization!.toFixed(0)}%`).join(' · ')
        + (hotNeighbors.length > 5 ? ` · …+${hotNeighbors.length - 5} more` : ''),
      action: { label: 'Open Telemetry', tab: 'telemetry' },
    });
  }

  // Failed deliveries from recent traces
  const recentTraces = traces.filter((t) => Date.now() - t.sentAt < 60 * 60_000); // last hour
  const failed = recentTraces.filter((t) => t.finalStatus === 'failed');
  if (failed.length > 0) {
    // Group by destination
    const perDest = new Map<number, number>();
    for (const t of failed) perDest.set(t.to, (perDest.get(t.to) ?? 0) + 1);
    const dests = Array.from(perDest.entries()).sort((a, b) => b[1] - a[1]);
    out.push({
      key: 'recent-failed-deliveries',
      severity: failed.length >= 3 ? 'critical' : 'warn',
      title: `${failed.length} failed deliver${failed.length === 1 ? 'y' : 'ies'} in the last hour`,
      detail: dests.slice(0, 3).map(([num, count]) => `${nameFor(nodes, num)} × ${count}`).join(' · ')
        + (dests.length > 3 ? ` · …+${dests.length - 3} dests` : '')
        + ' — open Delivery for per-message error codes.',
      action: { label: 'Open Delivery', tab: 'delivery' },
    });
  }

  // MQTT firehose: what fraction of recent traffic was MQTT?
  const fiveMinAgo = Date.now() - 5 * 60_000;
  const recent = recentPackets.filter((p) => p.receivedAt >= fiveMinAgo);
  if (recent.length > 0) {
    const mqttFrac = recent.filter((p) => p.viaMqtt).length / recent.length;
    if (mqttFrac > 0.7 && recent.length > 10) {
      out.push({
        key: 'mqtt-firehose',
        severity: 'warn',
        title: `${Math.round(mqttFrac * 100)}% of recent packets came via MQTT`,
        detail: 'Most of what you\'re seeing isn\'t local airwaves — it\'s nodes from elsewhere reaching you through the MQTT bridge. If you only care about RF, toggle "local mesh only" on the Map or "RF only" on Nodes.',
        action: { label: 'Open Map', tab: 'map' },
      });
    }
  }

  // Quiet mesh
  if (state.status === 'ready' && lastPacketAt && Date.now() - lastPacketAt > 10 * 60_000) {
    const mins = Math.round((Date.now() - lastPacketAt) / 60_000);
    out.push({
      key: 'mesh-quiet',
      severity: 'info',
      title: `No packets in ${mins} minute${mins === 1 ? '' : 's'}`,
      detail: 'Could just be a quiet night, but if you expected traffic, try sending a chat message — your radio will echo it back when it transmits, confirming the link is alive.',
      action: { label: 'Open Chat', tab: 'chat' },
    });
  }

  // Encrypted-undecodable packets — implies a channel mismatch with someone nearby
  const encrypted = recent.filter((p) => p.encrypted);
  if (encrypted.length > 0 && recent.length > 5 && encrypted.length / recent.length > 0.3) {
    out.push({
      key: 'encrypted-undecodable',
      severity: 'warn',
      title: `${encrypted.length} of ${recent.length} recent packets were encrypted with a key you don't have`,
      detail: 'Someone is transmitting on a channel slot your radio knows about, but with a different PSK. They\'re a separate mesh sharing your airwaves — interference, not communication.',
      action: { label: 'Open Channels', tab: 'channels' },
    });
  }

  return out;
}

// ─── Component ─────────────────────────────────────────────────────────

function severityIcon(s: Severity): string {
  return s === 'critical' ? '✗' : s === 'warn' ? '!' : s === 'ok' ? '✓' : 'i';
}

export function MeshHealthPanel({ state, nodes, traces, links, recentPackets, packetsLast60s, lastPacketAt, go }: Props) {
  const sections: Section[] = useMemo(() => {
    const radioFindings = checkOwnRadio(state);
    const privacyFindings = checkPrivacy(state);
    const meshFindings = checkLocalMesh(state, nodes, lastPacketAt);
    const trafficFindings = checkTraffic(state, nodes, traces, recentPackets, packetsLast60s, lastPacketAt);
    return [
      {
        title: 'This radio',
        blurb: 'Self-checks on your own radio\'s LoRa config, channels, and MQTT bridge.',
        findings: radioFindings,
      },
      {
        title: 'Local mesh',
        blurb: 'RF-heard neighbors only (MQTT-sourced nodes excluded).',
        findings: meshFindings,
      },
      {
        title: 'Traffic',
        blurb: 'Recent packet stream, channel utilization, and message delivery.',
        findings: trafficFindings,
      },
      {
        title: 'Privacy & external',
        blurb: 'What your radio is telling the wider world.',
        findings: privacyFindings,
      },
    ];
  }, [state, nodes, traces, recentPackets, packetsLast60s, lastPacketAt]);

  // Aggregate counts for the score chip
  const counts = useMemo(() => {
    let critical = 0, warn = 0, info = 0;
    for (const s of sections) for (const f of s.findings) {
      if (f.severity === 'critical') critical++;
      else if (f.severity === 'warn') warn++;
      else if (f.severity === 'info') info++;
    }
    return { critical, warn, info };
  }, [sections]);

  const overallTone: Severity = counts.critical > 0 ? 'critical' : counts.warn > 0 ? 'warn' : counts.info > 0 ? 'info' : 'ok';
  const overallLabel = overallTone === 'critical' ? 'Critical issues need attention'
    : overallTone === 'warn' ? 'Warnings — review when you have a minute'
    : overallTone === 'info' ? 'Healthy — informational notes only'
    : 'All checks passing';

  return (
    <div className="page">
      <h1 className="page-title">Mesh Health</h1>
      <p className="page-sub">
        Continuous self-audit of your mesh: own-radio config, neighbor freshness, delivery success, channel congestion, MQTT noise. Same approach as Compare Radios, but applied across every datapoint this app sees.
      </p>

      {state.status !== 'ready' && (
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)' }}>
          <p style={{ margin: 0, fontSize: 12.5 }}>The radio must be connected and ready before checks run. Open the Connect page to bring it online.</p>
        </div>
      )}

      {/* Overall score chip */}
      {state.status === 'ready' && (
        <div className={`mh-score mh-score-${overallTone}`}>
          <div className="mh-score-icon">{severityIcon(overallTone)}</div>
          <div style={{ flex: 1 }}>
            <div className="mh-score-title">{overallLabel}</div>
            <div className="mh-score-counts">
              <span style={{ color: counts.critical > 0 ? 'var(--bad)' : 'var(--text-faint)' }}>✗ {counts.critical} critical</span>
              <span style={{ color: counts.warn > 0 ? 'var(--warn)' : 'var(--text-faint)' }}>! {counts.warn} warn</span>
              <span style={{ color: counts.info > 0 ? '#6db4ff' : 'var(--text-faint)' }}>i {counts.info} info</span>
            </div>
          </div>
        </div>
      )}

      {/* Sections */}
      {state.status === 'ready' && sections.map((s) => (
        <SectionView key={s.title} section={s} go={go} />
      ))}
    </div>
  );
}

function SectionView({ section, go }: { section: Section; go: (t: TabId) => void }) {
  if (section.findings.length === 0) {
    return (
      <div className="mh-section mh-section-ok">
        <div className="mh-section-head">
          <h2 className="mh-section-title">{section.title}</h2>
          <span className="mh-section-status mh-ok">✓ all good</span>
        </div>
        <p className="mh-section-blurb">{section.blurb}</p>
      </div>
    );
  }
  return (
    <div className="mh-section">
      <div className="mh-section-head">
        <h2 className="mh-section-title">{section.title}</h2>
        <span className="mh-section-status">{section.findings.length} finding{section.findings.length === 1 ? '' : 's'}</span>
      </div>
      <p className="mh-section-blurb">{section.blurb}</p>
      <div className="mh-findings">
        {section.findings.map((f) => (
          <div key={f.key} className={`mh-finding mh-finding-${f.severity}`}>
            <div className="mh-finding-icon">{severityIcon(f.severity)}</div>
            <div className="mh-finding-body">
              <div className="mh-finding-title">{f.title}</div>
              <div className="mh-finding-detail">{f.detail}</div>
            </div>
            {f.action && (
              <button
                className="ghost"
                style={{ padding: '4px 12px', fontSize: 12, alignSelf: 'center', whiteSpace: 'nowrap' }}
                onClick={() => go(f.action!.tab)}
              >
                {f.action.label} →
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
