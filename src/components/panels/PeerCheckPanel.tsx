import React, { useEffect, useMemo, useState } from 'react';
import type { TabId } from '../TopNav';
import { useActiveConnId, useMeshContext } from '../../hooks/MeshContext';
import { nodeShortHex, nodeIdHex } from '../../lib/node-identity';

/**
 * Targeted diagnostic for "I can see this peer, they say they can see me,
 * but DMs aren't getting through". Runs a checklist of every concrete thing
 * that can be checked from this side, calls out the gaps, and offers
 * interactive tests (traceroute, ping DM, broadcast NodeInfo) to probe the
 * cases we can't introspect.
 *
 * The aim: every negative finding has a "what to try next" attached, so the
 * user doesn't need to be an RF expert to walk the diagnostic tree.
 */

interface Props {
  nodes: NodeRecord[];
  state: ConnectionState;
  messages: TextMessage[];
  go: (id: TabId) => void;
}

type Status = 'pass' | 'warn' | 'fail' | 'info';
interface Check {
  status: Status;
  title: string;
  evidence?: string;
  suggestion?: string;
  /** Optional jump to a related panel for deeper diagnosis. */
  link?: { label: string; to: TabId };
}

const BROADCAST = 0xffffffff;

function ageLabel(secs?: number): string {
  if (!secs) return 'never';
  const d = Math.max(0, Math.floor(Date.now() / 1000) - secs);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function PeerCheckPanel({ nodes, state, messages, go }: Props) {
  const connId = useActiveConnId();
  const { connections } = useMeshContext();

  const myNum = state.myInfo?.myNodeNum;
  const peers = useMemo(() =>
    [...nodes].filter((n) => n.num !== myNum)
      .sort((a, b) => (b.lastHeard ?? 0) - (a.lastHeard ?? 0)),
    [nodes, myNum]);

  // Auto-select the first peer if the user hasn't picked one yet.
  const [selectedNum, setSelectedNum] = useState<number | null>(null);
  useEffect(() => {
    if (selectedNum === null && peers.length > 0) setSelectedNum(peers[0].num);
  }, [peers, selectedNum]);

  // Per-second tick for live "Xs ago" labels.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const peer = peers.find((p) => p.num === selectedNum) ?? null;

  // IMPORTANT: every hook must be called before any conditional early
  // return below — otherwise React error #310 (rendered more hooks
  // than the previous render) fires the first time peer flips from
  // null → an actual node and the panel crashes the whole renderer.
  const [actionStatus, setActionStatus] = useState<string>('');

  // Sends to this peer (DM) and their ack outcome.
  const sendsToPeer = useMemo(() => {
    if (!peer || !myNum) return [];
    return messages
      .filter((m) => m.from === myNum && m.to === peer.num)
      .sort((a, b) => (b.sentAt ?? b.rxTime * 1000) - (a.sentAt ?? a.rxTime * 1000));
  }, [messages, peer, myNum]);

  // Cross-radio: do any of MY other connected radios currently report
  // hearing this peer? That's independent proof the peer is actually
  // transmitting right now.
  const otherRadiosHearingPeer = useMemo(() => {
    if (!peer || !connId) return [] as Array<{ name: string; lastHeard?: number }>;
    return connections
      .filter((c) => c.connId !== connId && c.state.status === 'ready')
      .map((c) => {
        const them = c.nodes.find((n) => n.num === peer.num);
        const cMy = c.state.myInfo?.myNodeNum;
        const cName = (cMy ? c.nodes.find((n) => n.num === cMy) : undefined)?.shortName ?? c.connId;
        return { name: cName, lastHeard: them?.lastHeard };
      })
      .filter((x) => x.lastHeard); // only the ones that have heard the peer at all
  }, [peer, connId, connections]);

  if (!peer) {
    return (
      <div className="page">
        <h1 className="page-title">Peer Check</h1>
        <p className="page-sub">Targeted diagnostic for a DM that's not getting through.</p>
        <div className="info-card"><p style={{ margin: 0 }}>{peers.length === 0 ? 'No peers in your nodeDB yet — wait for a NodeInfo broadcast, or ask the peer to "Poke the mesh".' : 'Pick a peer from the list to run checks.'}</p></div>
      </div>
    );
  }

  const checks: Check[] = [];
  const lora = state.loraConfig;
  const primaryCh = state.channels?.find((c) => c.index === 0);

  // ── 1. Radio readiness ─────────────────────────────────────────────
  if (state.status !== 'ready') {
    checks.push({
      status: 'fail',
      title: 'Your radio isn\'t ready',
      evidence: `status = ${state.status}`,
      suggestion: 'Wait for the handshake to finish, or reconnect from the Connect tab.',
    });
  } else {
    checks.push({ status: 'pass', title: 'Your radio is ready', evidence: `myNodeNum=${nodeIdHex(myNum!)}` });
  }

  // ── 2. TX enabled ──────────────────────────────────────────────────
  if (lora && !lora.txEnabled) {
    checks.push({
      status: 'fail',
      title: 'Transmit is DISABLED on your radio',
      evidence: 'loraConfig.txEnabled = false',
      suggestion: 'Open Settings → LoRa and turn TX back on. With TX off, every message dies in the outbox.',
      link: { label: 'Open LoRa settings', to: 'settings' },
    });
  } else if (lora) {
    checks.push({
      status: 'pass',
      title: 'TX is enabled',
      evidence: `txPower=${lora.txPower || 'auto'} dBm · region=${lora.regionName}`,
    });
  }

  // ── 3. Peer is in our nodeDB and not super stale ───────────────────
  const peerHeardSec = peer.lastHeard ?? 0;
  const peerAgeMin = peerHeardSec ? (Date.now() / 1000 - peerHeardSec) / 60 : Infinity;
  if (!peer.lastHeard) {
    checks.push({
      status: 'warn',
      title: 'Peer is in your nodeDB but you have never received a packet from them',
      evidence: 'lastHeard is unset — they\'re known only because someone else mentioned them',
      suggestion: 'Ask the peer to "Poke the mesh" so their NodeInfo broadcasts. Without that you\'ve never directly received them, which strongly suggests the path them→you doesn\'t close.',
    });
  } else if (peerAgeMin > 60 * 6) {
    checks.push({
      status: 'warn',
      title: `Peer last heard ${ageLabel(peer.lastHeard)} — they may be offline`,
      evidence: `lastHeard ${ageLabel(peer.lastHeard)} (${peerAgeMin.toFixed(0)} min)`,
      suggestion: 'If your DM was sent while the peer was offline, the firmware retried briefly then gave up. Wait until you see them again and retry.',
    });
  } else {
    checks.push({
      status: 'pass',
      title: `Peer heard ${ageLabel(peer.lastHeard)}`,
      evidence: peer.snr !== undefined && peer.snr !== 0
        ? `SNR ${peer.snr.toFixed(1)} · RSSI ${peer.rssi ?? '—'} dBm · ${peer.hopsAway ?? '?'} hop${peer.hopsAway === 1 ? '' : 's'}`
        : `hopsAway=${peer.hopsAway ?? '?'}`,
    });
  }

  // ── 4. Hop limit vs peer.hopsAway ──────────────────────────────────
  if (lora && peer.hopsAway !== undefined) {
    const hopLimit = lora.hopLimit || 3;
    if (peer.hopsAway >= hopLimit) {
      checks.push({
        status: 'fail',
        title: `Peer is ${peer.hopsAway} hops away — your hop limit is ${hopLimit}`,
        evidence: `loraConfig.hopLimit = ${hopLimit}, peer.hopsAway = ${peer.hopsAway}`,
        suggestion: `Your packet runs out of relays before it reaches them. Raise hop limit in Settings → LoRa (max 7) or get a relay closer.`,
        link: { label: 'Open LoRa settings', to: 'settings' },
      });
    } else if (peer.hopsAway >= hopLimit - 1) {
      checks.push({
        status: 'warn',
        title: `Peer is ${peer.hopsAway} hops away — close to your hop limit (${hopLimit})`,
        evidence: 'Acks come back over the same mesh — a small disturbance in the path will lose them.',
        suggestion: 'Consider raising hopLimit by 1 to leave headroom for ack return.',
      });
    } else {
      checks.push({
        status: 'pass',
        title: `Hop limit OK (${hopLimit}) for peer at ${peer.hopsAway} hops`,
      });
    }
  } else if (peer.hopsAway === undefined) {
    checks.push({
      status: 'info',
      title: 'Peer\'s hopsAway is unknown',
      evidence: 'Either they\'ve only been heard via NodeInfo (no SNR yet) or only via MQTT — we don\'t know how many physical hops away they are.',
    });
  }

  // ── 5. Where did we hear them — direct or via relay? ───────────────
  if (peer.viaMqtt) {
    checks.push({
      status: 'warn',
      title: 'Peer was heard via your radio\'s MQTT bridge, not over the air',
      evidence: 'viaMqtt = true',
      suggestion: 'MQTT-only peers aren\'t reachable by direct RF DM — the packets would only flow if both ends share the same MQTT broker AND uplink/downlink are enabled. Try a broadcast on the channel instead.',
    });
  } else if (peer.hopsAway !== undefined && peer.hopsAway > 0) {
    checks.push({
      status: 'info',
      title: `Peer is ${peer.hopsAway} hop${peer.hopsAway === 1 ? '' : 's'} away — relayed, not direct`,
      evidence: 'Every relay between you adds a chance to lose the packet and another chance to lose the ack on the return trip.',
      suggestion: 'If DM keeps failing, check the relay node\'s health (battery, range). See Mesh Routing and Acks & Asymmetry to understand the round-trip risk.',
      link: { label: 'Acks & Asymmetry', to: 'asymmetric-links' },
    });
  } else if (peer.hopsAway === 0 && peer.rssi !== undefined && peer.rssi < -115) {
    checks.push({
      status: 'warn',
      title: `Direct RF link but very weak (RSSI ${peer.rssi} dBm)`,
      evidence: 'Below ~-115 dBm the receiver gives up. Packets that *do* arrive are at the edge of decodability.',
      suggestion: 'An antenna upgrade or moving even a few meters can pull the link out of the noise floor. See Antennas / Link Budget.',
      link: { label: 'Link Budget', to: 'link-budget' },
    });
  }

  // ── 6. Channel — DMs ride channel 0 ────────────────────────────────
  if (!primaryCh) {
    checks.push({
      status: 'fail',
      title: 'Your radio has no primary channel',
      evidence: 'channels[0] is missing.',
      suggestion: 'Set up channel 0 in Settings → Channels — DMs ride on the primary channel.',
      link: { label: 'Open Channels', to: 'channels' },
    });
  } else {
    checks.push({
      status: 'info',
      title: `Primary channel: "${primaryCh.name || '(default)'}" — ${primaryCh.pskLength ? `${primaryCh.pskLength}-byte PSK` : 'no PSK'}`,
      evidence: 'DMs encrypt with this channel\'s key.',
      suggestion: peer.viaMqtt
        ? undefined
        : 'Both ends MUST have the same channel name AND PSK for DMs to decrypt. We can\'t introspect the peer\'s side — verify with them.',
    });
  }

  // ── 7. Recent DM history to this peer ──────────────────────────────
  if (sendsToPeer.length === 0) {
    checks.push({
      status: 'info',
      title: 'No prior DMs to this peer in this session',
      suggestion: 'Send a test DM with "Request ACK" enabled to get a concrete delivery result.',
    });
  } else {
    const recent = sendsToPeer.slice(0, 5);
    const failures = recent.filter((m) => m.ackStatus === 'failed').length;
    const acked = recent.filter((m) => m.ackStatus === 'acked').length;
    const pending = recent.filter((m) => m.ackStatus === 'pending').length;
    const last = recent[0];
    if (failures === recent.length) {
      checks.push({
        status: 'fail',
        title: `All ${recent.length} recent DMs to this peer failed`,
        evidence: `Last failure: ${last.ackError === 3 ? 'TIMEOUT' : `Routing.Error ${last.ackError ?? '?'}`}`,
        suggestion: 'Run a traceroute — the path the firmware tried to use either doesn\'t exist or only works one way. Asymmetric links are the most common cause when both sides "see" each other.',
        link: { label: 'Acks & Asymmetry', to: 'asymmetric-links' },
      });
    } else if (failures > 0) {
      checks.push({
        status: 'warn',
        title: `${failures}/${recent.length} recent DMs failed (${acked} acked, ${pending} pending)`,
        evidence: 'Intermittent delivery — the path exists but is fragile.',
        suggestion: 'Try a stronger antenna or move closer. Check Delivery panel for trace details.',
        link: { label: 'Delivery panel', to: 'delivery' },
      });
    } else if (pending > 0) {
      checks.push({
        status: 'warn',
        title: `Most recent DM still pending (${pending} pending of last ${recent.length})`,
        evidence: 'Within the 60s timeout, still waiting on a routing ack.',
      });
    } else {
      checks.push({
        status: 'pass',
        title: `Last ${recent.length} DMs to this peer all acked`,
      });
    }
  }

  // ── 8. Cross-radio independent confirmation ────────────────────────
  if (otherRadiosHearingPeer.length > 0) {
    checks.push({
      status: 'pass',
      title: `Another of your radios (${otherRadiosHearingPeer.map((r) => r.name).join(', ')}) is also hearing this peer`,
      evidence: 'Independent confirmation the peer is actually transmitting right now.',
    });
  }

  // Ranking — failures up top.
  const rank: Record<Status, number> = { fail: 0, warn: 1, info: 2, pass: 3 };
  checks.sort((a, b) => rank[a.status] - rank[b.status]);
  const failCount = checks.filter((c) => c.status === 'fail').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;

  const summary = failCount > 0
    ? { tone: 'bad' as const, text: `${failCount} blocking issue${failCount === 1 ? '' : 's'} preventing reliable DMs to this peer.` }
    : warnCount > 0
      ? { tone: 'warn' as const, text: `${warnCount} concern${warnCount === 1 ? '' : 's'} that could explain spotty delivery.` }
      : { tone: 'good' as const, text: 'Everything we can check from this side looks fine. The issue is likely on the peer\'s side — channel name + PSK mismatch is the most common case we can\'t see.' };

  // ── Test actions ─────────────────────────────────────────────────────
  // actionStatus state lives above the early return for hook stability.
  const onTraceroute = async () => {
    if (!connId) return;
    setActionStatus('Sending traceroute…');
    try {
      const r = await window.mesh.sendTraceroute({ connId, to: peer.num, channel: 0 });
      setActionStatus(r ? `Traceroute sent (packet !${r.packetId.toString(16).padStart(8, '0').slice(-4)}). Open the Traceroute panel to watch the response.` : 'Traceroute failed to send.');
    } catch (e: any) {
      setActionStatus(`Traceroute error: ${e?.message ?? String(e)}`);
    }
  };
  const onPingDm = async () => {
    if (!connId) return;
    setActionStatus('Sending test DM with ACK…');
    try {
      const m = await window.mesh.sendText({ connId, text: '🟢 ping (peer-check)', to: peer.num, channel: 0, wantAck: true });
      setActionStatus(m ? `Test DM sent (packet !${m.id.toString(16).padStart(8, '0').slice(-4)}). Watch the ack status in Chat or Delivery.` : 'Test DM failed to send.');
    } catch (e: any) {
      setActionStatus(`Test DM error: ${e?.message ?? String(e)}`);
    }
  };
  const onBroadcastMyNodeInfo = async () => {
    if (!connId) return;
    setActionStatus('Broadcasting your NodeInfo…');
    try {
      const ok = await window.mesh.broadcastNodeInfo(connId);
      setActionStatus(ok ? 'Your NodeInfo broadcast — peers that hear it will reply with theirs, populating their nodeDBs with your identity.' : 'Broadcast failed — handshake may not be ready yet.');
    } catch (e: any) {
      setActionStatus(`Broadcast error: ${e?.message ?? String(e)}`);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Peer Check</h1>
      <p className="page-sub">
        "I can see them, they can see me, why isn't my DM getting through?" — pick the peer below and walk through what we can verify from this side, plus the actions we can take to probe the rest.
      </p>

      {/* Peer selector */}
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>Peer:</label>
          <select
            className="text"
            value={String(peer.num)}
            onChange={(e) => setSelectedNum(parseInt(e.target.value, 10))}
            style={{ minWidth: 280 }}
          >
            {peers.map((p) => (
              <option key={p.num} value={p.num}>
                {p.shortName || nodeShortHex(p.num)} — {p.longName || nodeIdHex(p.num)}
                {p.lastHeard ? ` · heard ${ageLabel(p.lastHeard)}` : ' · never heard'}
              </option>
            ))}
          </select>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
            {nodeIdHex(peer.num)}
          </span>
        </div>
      </div>

      {/* Summary banner */}
      <div
        className="info-card"
        style={{
          borderLeftColor:
            summary.tone === 'bad' ? 'var(--bad)'
            : summary.tone === 'warn' ? 'var(--warn)' : 'var(--good)',
          marginBottom: 12,
        }}
      >
        <p style={{ margin: 0, fontSize: 13 }}>
          <strong style={{ color: summary.tone === 'bad' ? 'var(--bad)' : summary.tone === 'warn' ? 'var(--warn)' : 'var(--good)' }}>
            {summary.tone === 'bad' ? '✗ ' : summary.tone === 'warn' ? '⚠ ' : '✓ '}
          </strong>
          {summary.text}
        </p>
      </div>

      {/* Checks */}
      <div className="card" style={{ padding: 0, marginBottom: 12 }}>
        {checks.map((c, i) => (
          <div
            key={i}
            style={{
              padding: '10px 14px',
              borderBottom: i === checks.length - 1 ? 'none' : '1px solid var(--line)',
              display: 'flex',
              gap: 10,
            }}
          >
            <div style={{ width: 22, flexShrink: 0, paddingTop: 1, fontSize: 14 }}>
              {c.status === 'pass' ? <span style={{ color: 'var(--good)' }}>✓</span>
                : c.status === 'warn' ? <span style={{ color: 'var(--warn)' }}>⚠</span>
                : c.status === 'fail' ? <span style={{ color: 'var(--bad)' }}>✗</span>
                : <span style={{ color: 'var(--text-faint)' }}>·</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{c.title}</div>
              {c.evidence && (
                <div style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                  {c.evidence}
                </div>
              )}
              {c.suggestion && (
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                  → {c.suggestion}
                </div>
              )}
              {c.link && (
                <button
                  className="ghost"
                  style={{ marginTop: 6, padding: '2px 10px', fontSize: 11 }}
                  onClick={() => go(c.link!.to)}
                >
                  {c.link.label} →
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Interactive probes */}
      <div className="card">
        <h3 style={{ margin: 0, marginBottom: 8 }}>Probes</h3>
        <p style={{ margin: '0 0 12px', color: 'var(--text-dim)', fontSize: 12 }}>
          Send something on the wire and watch what happens. Each probe stresses a different part of the path.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="primary" onClick={onTraceroute} disabled={!connId} title="Draw the path your packet takes to the peer and back. Failed traceroutes reveal exactly where the chain breaks.">
            ↗ Traceroute
          </button>
          <button className="primary" onClick={onPingDm} disabled={!connId} title="Send a small 'ping' DM with wantAck=true. Concrete delivery test — Routing ack or 60s timeout.">
            🟢 Send test DM
          </button>
          <button className="ghost" onClick={onBroadcastMyNodeInfo} disabled={!connId} title="Broadcast your NodeInfo with wantResponse=true. Forces peers to update their nodeDB AND reply with theirs.">
            📣 Broadcast my NodeInfo
          </button>
        </div>
        {actionStatus && (
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text)', fontFamily: 'var(--mono)' }}>
            {actionStatus}
          </p>
        )}
      </div>
    </div>
  );
}
