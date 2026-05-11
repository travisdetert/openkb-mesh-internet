import React, { useMemo, useState } from 'react';

const BROADCAST = 0xffffffff;

function shortHex(num: number): string {
  return '!' + (num >>> 0).toString(16).padStart(8, '0').slice(-4);
}
function fullHex(num: number): string {
  return '!' + (num >>> 0).toString(16).padStart(8, '0');
}
function nameFor(nodes: NodeRecord[], num: number): string {
  if (num === BROADCAST) return 'broadcast';
  const n = nodes.find((x) => x.num === num);
  return n?.shortName || shortHex(num);
}
function longNameFor(nodes: NodeRecord[], num: number): string {
  if (num === BROADCAST) return 'broadcast';
  const n = nodes.find((x) => x.num === num);
  return n?.longName || n?.shortName || shortHex(num);
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtTimeAbs(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: false });
}

const KIND_LABEL: Record<TraceEventKind, string> = {
  sent: 'sent to radio',
  echo: 'radio TX confirmed',
  relay: 'relayed by',
  ack: 'ack from',
  nak: 'nak from',
  timeout: 'local 60s timeout',
};
const KIND_GLYPH: Record<TraceEventKind, string> = {
  sent: '●',
  echo: '↑',
  relay: '↻',
  ack: '✓',
  nak: '✗',
  timeout: '⏰',
};
const KIND_COLOR: Record<TraceEventKind, string> = {
  sent: 'var(--accent)',
  echo: 'var(--good)',
  relay: 'var(--warn)',
  ack: 'var(--good)',
  nak: 'var(--bad)',
  timeout: 'var(--bad)',
};

interface Props {
  traces: PacketTrace[];
  nodes: NodeRecord[];
  state: ConnectionState;
}

export function DeliveryPanel({ traces, nodes, state }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Default selection = first (newest) trace.
  const ordered = useMemo(() => [...traces].sort((a, b) => b.sentAt - a.sentAt), [traces]);
  const activeId = selectedId ?? ordered[0]?.packetId ?? null;
  const selected = ordered.find((t) => t.packetId === activeId);

  return (
    <div className="page">
      <h1 className="page-title">Delivery</h1>
      <p className="page-sub">
        Every outgoing message you send is tracked here from the moment your radio TX-confirms it, through every node that relays it, all the way to (or instead of) an ack. Use this when a message looks like it didn't get through — the trace shows you how far into the mesh it actually traveled.
      </p>

      {ordered.length === 0 ? (
        <div className="card">
          <div className="empty">
            <p style={{ margin: '0 0 6px' }}>No outgoing traces yet.</p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
              Send a chat message from the Chat tab. As soon as you hit Send, this panel starts capturing the packet's
              propagation through the mesh in real time.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16, alignItems: 'stretch' }}>
          <div className="card" style={{ padding: 6, minHeight: 0 }}>
            <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 8px' }}>
              Recent sends ({ordered.length})
            </div>
            {ordered.map((t) => {
              const active = t.packetId === activeId;
              const tone = t.finalStatus === 'acked' ? 'var(--good)' : t.finalStatus === 'failed' ? 'var(--bad)' : 'var(--warn)';
              const relays = t.events.filter((e) => e.kind === 'relay').length;
              return (
                <button
                  key={t.packetId}
                  className={'convo-item' + (active ? ' active' : '')}
                  onClick={() => setSelectedId(t.packetId)}
                >
                  <div className="convo-row">
                    <span className="convo-label">
                      → {t.to === BROADCAST ? `# ch${t.channel}` : nameFor(nodes, t.to)}
                    </span>
                    <span className="convo-time" style={{ color: tone }}>{t.finalStatus}</span>
                  </div>
                  <div className="convo-preview">
                    {t.text || <span style={{ color: 'var(--text-faint)' }}>(no text)</span>}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 2, fontFamily: 'var(--mono)' }}>
                    {new Date(t.sentAt).toLocaleTimeString()} · {relays} relay{relays === 1 ? '' : 's'}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="card" style={{ minHeight: 0 }}>
            {selected ? (
              <TraceDetail trace={selected} nodes={nodes} state={state} />
            ) : (
              <div className="empty">Select a trace.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TraceDetail({ trace, nodes, state }: { trace: PacketTrace; nodes: NodeRecord[]; state: ConnectionState }) {
  const sentTs = trace.sentAt;
  const events = [...trace.events].sort((a, b) => a.ts - b.ts);
  const firstRelay = events.find((e) => e.kind === 'relay');
  const ackEv = events.find((e) => e.kind === 'ack');
  const echoEv = events.find((e) => e.kind === 'echo');
  const relays = events.filter((e) => e.kind === 'relay');
  const uniqueRelays = new Set(relays.map((r) => r.fromNode)).size;
  const target = trace.to;
  const targetIsBroadcast = target === BROADCAST;
  const targetNode = targetIsBroadcast ? undefined : nodes.find((n) => n.num === target);
  const targetLastHeard = targetNode?.lastHeard;
  const myFreq = state.loraConfig?.regionName;
  const myPreset = state.loraConfig?.usePreset ? state.loraConfig.modemPresetName : 'custom';

  // Diagnostic interpretation
  const diagnosis = diagnose(trace, nodes, state);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>
            → {targetIsBroadcast ? `Broadcast on channel ${trace.channel}` : longNameFor(nodes, target)}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)', marginTop: 3 }}>
            packet !{trace.packetId.toString(16).padStart(8, '0')} · {fmtTimeAbs(trace.sentAt)} · wantAck={String(trace.wantAck)}
          </div>
          {trace.text && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--bg-elev-2)', borderRadius: 6, fontSize: 13.5, fontStyle: 'italic' }}>
              "{trace.text}"
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={`ack ack-${trace.finalStatus === 'acked' ? 'acked' : trace.finalStatus === 'failed' ? 'failed' : 'pending'}`} style={{ fontSize: 14 }}>
            {trace.finalStatus === 'acked' ? '✓ delivered' : trace.finalStatus === 'failed' ? '✗ failed' : '… in flight'}
          </div>
        </div>
      </div>

      {/* Headline metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Metric label="time to TX" value={echoEv ? fmtMs(echoEv.ts - sentTs) : '—'} />
        <Metric label="time to first relay" value={firstRelay ? fmtMs(firstRelay.ts - sentTs) : '—'} tone={firstRelay ? 'good' : 'dim'} />
        <Metric label="distinct relays" value={String(uniqueRelays)} tone={uniqueRelays > 0 ? 'good' : 'dim'} />
        <Metric label="time to ack" value={ackEv ? fmtMs(ackEv.ts - sentTs) : '—'} tone={ackEv ? 'good' : 'dim'} />
      </div>

      {/* Diagnostic interpretation */}
      <div className="info-card" style={{ marginBottom: 14, borderLeftColor: diagnosis.tone === 'good' ? 'var(--good)' : diagnosis.tone === 'warn' ? 'var(--warn)' : diagnosis.tone === 'bad' ? 'var(--bad)' : 'var(--accent)' }}>
        <p style={{ margin: 0, fontWeight: 500 }}>{diagnosis.headline}</p>
        <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--text-dim)' }}>{diagnosis.detail}</p>
        {diagnosis.suggestions.length > 0 && (
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)' }}>
            {diagnosis.suggestions.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        )}
      </div>

      {/* Propagation chain visual */}
      {relays.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}>Propagation</h3>
          <div className="prop-chain">
            <div className="prop-node prop-me">me</div>
            <span className="prop-arrow">→</span>
            {relays.map((r, i) => {
              const name = r.fromNode ? nameFor(nodes, r.fromNode) : '?';
              const hopUsed = (r.hopStart && r.hopLimit) ? r.hopStart - r.hopLimit : '?';
              return (
                <React.Fragment key={i}>
                  <div className="prop-node">
                    <div>{name}</div>
                    <div className="prop-meta">
                      {r.rssi !== undefined && r.rssi !== 0 && <span>{r.rssi} dBm</span>}
                      {' '}<span>hop {hopUsed}</span>
                    </div>
                  </div>
                  {i < relays.length - 1 && <span className="prop-arrow">→</span>}
                </React.Fragment>
              );
            })}
            {ackEv && (
              <>
                <span className="prop-arrow">→</span>
                <div className="prop-node prop-target">
                  <div>{ackEv.fromNode ? nameFor(nodes, ackEv.fromNode) : nameFor(nodes, target)}</div>
                  <div className="prop-meta">acked</div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Detailed timeline */}
      <div className="card" style={{ padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Timeline</h3>
        <div className="trace-timeline">
          {events.map((e, i) => {
            const offsetMs = e.ts - sentTs;
            const senderNum = e.fromNode ?? trace.from;
            const isMe = senderNum === state.myInfo?.myNodeNum;
            return (
              <div key={i} className="trace-row">
                <div className="trace-time">+{fmtMs(offsetMs)}</div>
                <div className="trace-glyph" style={{ color: KIND_COLOR[e.kind] }}>{KIND_GLYPH[e.kind]}</div>
                <div className="trace-body">
                  <div>
                    <strong>{KIND_LABEL[e.kind]}</strong>
                    {e.kind === 'relay' && e.fromNode && (
                      <> <span style={{ color: 'var(--accent)' }}>{nameFor(nodes, e.fromNode)}</span> <span style={{ color: 'var(--text-faint)', fontFamily: 'var(--mono)', fontSize: 11 }}>{fullHex(e.fromNode)}</span></>
                    )}
                    {(e.kind === 'ack' || e.kind === 'nak') && e.fromNode !== undefined && (
                      <> <span style={{ color: 'var(--accent)' }}>{nameFor(nodes, e.fromNode)}</span></>
                    )}
                    {e.kind === 'sent' && (
                      <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}> · {targetIsBroadcast ? `broadcast on ch${trace.channel}` : `addressed to ${nameFor(nodes, target)}`}</span>
                    )}
                  </div>
                  <div className="trace-extras">
                    {e.rssi !== undefined && e.rssi !== 0 && <span>{e.rssi} dBm</span>}
                    {e.snr !== undefined && e.snr !== 0 && <span>SNR {e.snr.toFixed(1)}</span>}
                    {e.hopStart !== undefined && e.hopLimit !== undefined && e.hopStart > 0 && <span>hop {e.hopStart - e.hopLimit}/{e.hopStart}</span>}
                    {e.errorReason !== undefined && e.errorReason !== 0 && <span>routing.error={e.errorReason}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Channel / preset context */}
      <div className="card" style={{ padding: 12, marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Radio context at send time</h3>
        <dl className="kv kv-tight" style={{ fontSize: 12.5 }}>
          <dt>Region</dt><dd>{myFreq ?? '—'}</dd>
          <dt>Modem preset</dt><dd>{myPreset}</dd>
          <dt>Hop limit</dt><dd>{state.loraConfig?.hopLimit ?? '—'}</dd>
          <dt>TX power</dt><dd>{state.loraConfig?.txPower ?? 'auto'} dBm{state.loraConfig?.txEnabled === false ? ' · TX OFF' : ''}</dd>
          {targetNode && <>
            <dt>Recipient hops away</dt><dd>{targetNode.hopsAway ?? '—'}</dd>
            <dt>Recipient last heard</dt><dd>{targetLastHeard ? agoShort(targetLastHeard) : 'never'}</dd>
            <dt>Recipient RSSI / SNR</dt><dd>{targetNode.rssi !== undefined && targetNode.rssi !== 0 ? `${targetNode.rssi} dBm` : '—'}{targetNode.snr !== undefined ? ` · ${targetNode.snr.toFixed(1)} dB` : ''}</dd>
          </>}
        </dl>
        {targetNode && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
            For two radios to communicate, they must be on the same <strong>region</strong> (frequency band) and the same <strong>modem preset</strong> — both fields above apply to your radio. If your recipient was configured for a different region or preset, packets won't decode at all and you won't get any relays from them.
          </p>
        )}
      </div>
    </div>
  );
}

interface Diagnosis { headline: string; detail: string; suggestions: string[]; tone: 'good' | 'warn' | 'bad' | 'dim'; }

function diagnose(trace: PacketTrace, nodes: NodeRecord[], state: ConnectionState): Diagnosis {
  const events = trace.events;
  const echoEv = events.find((e) => e.kind === 'echo');
  const relays = events.filter((e) => e.kind === 'relay');
  const ackEv = events.find((e) => e.kind === 'ack');
  const nakEv = events.find((e) => e.kind === 'nak');
  const timeoutEv = events.find((e) => e.kind === 'timeout');
  const targetIsBroadcast = trace.to === BROADCAST;
  const targetNode = targetIsBroadcast ? undefined : nodes.find((n) => n.num === trace.to);

  if (ackEv) {
    const dt = ackEv.ts - trace.sentAt;
    return {
      tone: 'good',
      headline: 'Delivered.',
      detail: `Recipient sent back an ack ${fmtMs(dt)} after we transmitted, ${relays.length > 0 ? `via ${new Set(relays.map((r) => r.fromNode)).size} relay${new Set(relays.map((r) => r.fromNode)).size === 1 ? '' : 's'}.` : 'in a single hop.'}`,
      suggestions: [],
    };
  }

  if (nakEv) {
    return {
      tone: 'bad',
      headline: `Rejected by the network (routing.error = ${nakEv.errorReason ?? '?'}).`,
      detail: 'A node along the path explicitly refused this packet. Most common cause is a channel/PSK mismatch with the recipient.',
      suggestions: [
        'Verify both radios share the same channel + PSK.',
        'If the channel is custom, double-check the encryption key matches exactly.',
      ],
    };
  }

  if (!echoEv) {
    // We never heard the radio TX our packet back — it might still be queued or USB might be stuck.
    return {
      tone: 'warn',
      headline: 'Radio has not transmitted yet.',
      detail: 'We handed the packet to the radio over USB but never heard the on-air echo. The TX queue may be backed up, or the USB link may be stale.',
      suggestions: [
        'Wait a moment — heavy channel utilization can delay TX several seconds.',
        'Check Connect → Connection health for "last packet" — if it\'s stale, the USB link may need reconnecting.',
        'Verify TX is enabled (Connect → Radio configuration → TX power).',
      ],
    };
  }

  if (relays.length === 0 && timeoutEv) {
    // Packet went out but nobody relayed it — local-only RF reach, no mesh propagation.
    const tone = targetIsBroadcast ? 'warn' : 'bad';
    const why: string[] = [];
    if (state.loraConfig?.region) why.push(`Region ${state.loraConfig.regionName} (${state.loraConfig.modemPresetName ?? 'custom'}) is the frequency you're on; any node not on the same region won't hear you at all.`);
    if (targetNode?.lastHeard) {
      const ageS = Math.floor(Date.now() / 1000) - targetNode.lastHeard;
      if (ageS > 3600) why.push(`Recipient was last heard ${agoShort(targetNode.lastHeard)} ago — they may be offline.`);
    } else if (!targetIsBroadcast) {
      why.push('Recipient has never been heard by your radio. They may not be in your nodeDB at all, in which case you have no proof they\'re reachable.');
    }
    return {
      tone,
      headline: 'Transmitted, but no node rebroadcast it.',
      detail: 'Your radio confirmed it transmitted, yet not a single neighbor relayed the packet. Either no node was in range to hear you, or those that did don\'t share enough of your config (region/preset/channel) to forward.',
      suggestions: [
        ...why,
        'Move closer to a known-online node and resend (the Map shows last-known positions).',
        'If you suspect frequency mismatch: confirm your region and modem preset match what the wider community in your area uses (LongFast on US is the default).',
        'Try a broadcast on the Default channel — it\'s the one most likely to be shared with everyone.',
      ],
    };
  }

  if (relays.length > 0 && !ackEv && !targetIsBroadcast) {
    const lastRelay = relays[relays.length - 1];
    const lastSecs = Math.floor((Date.now() - lastRelay.ts) / 1000);
    return {
      tone: timeoutEv ? 'bad' : 'warn',
      headline: timeoutEv
        ? `Reached ${new Set(relays.map((r) => r.fromNode)).size} relay${new Set(relays.map((r) => r.fromNode)).size === 1 ? '' : 's'} but recipient never acknowledged.`
        : `In flight via ${new Set(relays.map((r) => r.fromNode)).size} relay${new Set(relays.map((r) => r.fromNode)).size === 1 ? '' : 's'}.`,
      detail: timeoutEv
        ? `The packet propagated into the mesh — ${relays.length} relay event${relays.length === 1 ? '' : 's'} observed — but no Routing.ack came back from the recipient within 60 seconds. Most common explanations: recipient is offline, the relay chain to them is broken, or the channel is too congested for the ack to make it back.`
        : `Last relay heard ${lastSecs}s ago. Still waiting on a Routing.ack from the recipient.`,
      suggestions: timeoutEv ? [
        'The packet may still have arrived — absence of ack only means the *return path* didn\'t complete.',
        'Resend in a moment to give the network another chance to route.',
        'Check the recipient on the Map: if they\'re multiple hops away, intermediate nodes need to be online for the ack to come back.',
        'If this happens to one specific node every time, the link to them is too marginal — consider a Traceroute to see the path.',
      ] : [],
    };
  }

  if (relays.length > 0 && targetIsBroadcast) {
    return {
      tone: 'good',
      headline: `Broadcast reached ${new Set(relays.map((r) => r.fromNode)).size} relay${new Set(relays.map((r) => r.fromNode)).size === 1 ? '' : 's'}.`,
      detail: 'For broadcasts, the rebroadcast itself is the implicit ack. Each unique relay confirms at least that node received and re-transmitted the packet.',
      suggestions: [],
    };
  }

  return {
    tone: 'dim',
    headline: 'Tracking…',
    detail: 'Waiting for echo, relay, or ack events.',
    suggestions: [],
  };
}

function Metric({ label, value, tone = 'dim' }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'dim' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : 'var(--text)';
  return (
    <div style={{ background: 'var(--bg-elev-2)', borderRadius: 6, padding: '8px 12px' }}>
      <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 18, fontFamily: 'var(--mono)', marginTop: 2, color }}>{value}</div>
    </div>
  );
}

function agoShort(secs: number): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - secs);
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}
