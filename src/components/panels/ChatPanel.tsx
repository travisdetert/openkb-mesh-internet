import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatTarget } from '../../App';

const BROADCAST = 0xffffffff;

function shortHex(num: number): string {
  return '!' + (num >>> 0).toString(16).padStart(8, '0').slice(-4);
}

function nameFor(nodes: NodeRecord[], num: number): string {
  if (num === BROADCAST) return 'all';
  const n = nodes.find((x) => x.num === num);
  return n?.shortName || shortHex(num);
}

function longNameFor(nodes: NodeRecord[], num: number): string {
  if (num === BROADCAST) return 'Broadcast';
  const n = nodes.find((x) => x.num === num);
  return n?.longName || n?.shortName || shortHex(num);
}

interface ConvoItem {
  key: string;
  target: ChatTarget;
  label: string;
  sub: string;
  lastTs: number;
  lastText?: string;
  lastFromMe?: boolean;
  lastSender?: string;
  unread: number;
}

function senderColor(num: number): string {
  // Golden-angle hue distribution → visually distinct, deterministic per node.
  const hue = ((num >>> 0) * 137.508) % 360;
  return `hsl(${hue}, 65%, 68%)`;
}

function relTime(rxSec: number): string {
  if (!rxSec) return '';
  const d = Math.max(0, Math.floor(Date.now() / 1000) - rxSec);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

function buildConvoList(messages: TextMessage[], nodes: NodeRecord[], state: ConnectionState, lastViewed: Record<string, number>): ConvoItem[] {
  const myNum = state.myInfo?.myNodeNum ?? 0;
  const items = new Map<string, ConvoItem>();

  for (const ch of state.channels ?? []) {
    if (ch.role === 0) continue;
    const key = `ch:${ch.index}`;
    items.set(key, {
      key,
      target: { kind: 'channel', index: ch.index },
      label: ch.name || (ch.index === 0 ? 'Default' : `Channel ${ch.index}`),
      sub: ch.role === 1 ? 'primary' : 'secondary',
      lastTs: 0,
      unread: 0,
    });
  }

  for (const m of messages) {
    let key: string;
    if (m.to === BROADCAST) {
      key = `ch:${m.channel}`;
    } else {
      const peer = m.from === myNum ? m.to : m.from;
      key = `dm:${peer}`;
      if (!items.has(key)) {
        items.set(key, {
          key,
          target: { kind: 'dm', nodeNum: peer },
          label: nameFor(nodes, peer),
          sub: 'direct',
          lastTs: 0,
          unread: 0,
        });
      }
    }
    const it = items.get(key);
    if (!it) continue;
    if (m.rxTime >= it.lastTs) {
      it.lastTs = m.rxTime;
      it.lastText = m.text;
      it.lastFromMe = m.from === myNum;
      it.lastSender = m.from === myNum ? 'me' : nameFor(nodes, m.from);
    }
    if (m.from !== myNum && m.rxTime * 1000 > (lastViewed[key] ?? 0)) {
      it.unread += 1;
    }
  }

  // Sort by recent activity, mixing channels and DMs. Silent channels (no
  // messages yet, lastTs == 0) sink to the bottom but stay listed.
  return Array.from(items.values()).sort((a, b) => {
    if (a.lastTs === 0 && b.lastTs === 0) {
      // Both silent: channels first by index, then DMs alphabetically.
      if (a.target.kind === 'channel' && b.target.kind === 'channel') return a.target.index - b.target.index;
      if (a.target.kind === 'channel') return -1;
      if (b.target.kind === 'channel') return 1;
      return a.label.localeCompare(b.label);
    }
    if (a.lastTs === 0) return 1;
    if (b.lastTs === 0) return -1;
    return b.lastTs - a.lastTs;
  });
}

function matches(target: ChatTarget, m: TextMessage, myNum: number): boolean {
  if (target.kind === 'channel') return m.to === BROADCAST && m.channel === target.index;
  const peer = target.nodeNum;
  return (m.from === peer && m.to === myNum) || (m.from === myNum && m.to === peer);
}

function targetKey(t: ChatTarget): string {
  return t.kind === 'channel' ? `ch:${t.index}` : `dm:${t.nodeNum}`;
}

function ackGlyph(status: TextMessage['ackStatus']): string {
  switch (status) {
    case 'pending': return '…';
    case 'acked': return '✓';
    case 'failed': return '✗';
    default: return '';
  }
}

interface FailureInfo { label: string; explainer: string; nextSteps: string[]; }
/**
 * Map Meshtastic Routing.Error codes (mesh.proto) to a human label, an
 * explainer, and concrete next-step suggestions.
 */
function describeAckError(code?: number): FailureInfo | null {
  if (code === undefined) return null;
  switch (code) {
    case 0: return null;
    case 1: return {
      label: 'no route',
      explainer: 'Your radio could not find a path to the destination. Either the recipient is out of mesh range entirely, or every node that *can* hear you can\'t reach them.',
      nextSteps: [
        'Check the recipient was last heard recently (Nodes panel).',
        'If they\'re multiple hops away, an intermediate relay may be offline.',
        'Try when you know the recipient is reachable, e.g. from the Map.',
      ],
    };
    case 2: return {
      label: 'rejected (NAK)',
      explainer: 'A node along the path explicitly rejected the packet. The most common cause is a channel/PSK mismatch with the recipient.',
      nextSteps: [
        'Verify both you and the recipient are on the same channel with the same key.',
        'If the channel uses default keys, this should not happen — file a bug.',
      ],
    };
    case 3: return {
      label: 'timeout',
      explainer: 'No ack arrived within 60 seconds. The packet may still have been delivered — the absence of an ack only means we didn\'t hear back, not that it definitely failed.',
      nextSteps: [
        'Try resending. The radio retried up to 3× internally; one more user-level send sometimes gets through.',
        'On a busy channel (utilization > 25%), drops are common — wait a minute.',
        'If repeated DMs to the same node all time out, the link is too marginal — see Map for hop count and RSSI.',
      ],
    };
    case 4: return {
      label: 'no interface',
      explainer: 'The radio has no transmit interface available. TX may be disabled or the radio is in an odd state.',
      nextSteps: [
        'Check Connect → Radio config → TX power. If TX is OFF, re-enable it in the official setup app.',
        'Power-cycle the radio if TX is on but nothing transmits.',
      ],
    };
    case 5: return {
      label: 'max retransmits',
      explainer: 'Your radio gave up after 3 transmit attempts without hearing an ack rebroadcast. The link is marginal or the channel is congested.',
      nextSteps: [
        'Resend in a moment — collisions clear quickly.',
        'If it keeps happening for one specific node, they may be too far for reliable RF.',
      ],
    };
    case 6: return {
      label: 'no channel',
      explainer: 'The recipient isn\'t configured for the channel you sent on. They literally have no slot for it.',
      nextSteps: [
        'Send on a channel both of you have configured (the Default channel is the safest bet).',
      ],
    };
    case 7: return {
      label: 'too large',
      explainer: 'Payload exceeded the LoRa per-packet limit. Meshtastic caps text messages around 200 bytes after framing.',
      nextSteps: [
        'Shorten the message and try again.',
      ],
    };
    case 8: return {
      label: 'no response',
      explainer: 'The destination did not respond to a request that needed a reply (e.g. a traceroute that no one answered).',
      nextSteps: [
        'For traceroute: try a node known to be reachable. For DM: resend.',
      ],
    };
    case 9: return {
      label: 'duty-cycle limit',
      explainer: 'Your radio hit a regional regulatory transmit-time cap (most commonly 1% in EU868). It will refuse to TX more until the window resets.',
      nextSteps: [
        'Wait a few minutes for the duty-cycle window to clear.',
        'On EU868, switching to a faster preset (e.g. ShortFast) buys you ~10× more messages per hour.',
      ],
    };
    case 32: return {
      label: 'bad request',
      explainer: 'The packet was malformed in a way the firmware rejected outright.',
      nextSteps: ['File a bug — this app shouldn\'t produce malformed packets.'],
    };
    case 33: return {
      label: 'not authorized',
      explainer: 'The recipient rejected the packet for an authorization reason — usually an admin-channel or session-key issue.',
      nextSteps: ['You\'re not allowed to send admin commands to that node.'],
    };
    case 34: case 35: return {
      label: 'PKI mismatch',
      explainer: 'Public-key encryption failed. Either the recipient\'s key is unknown to your radio, or they rejected the key you sent.',
      nextSteps: [
        'Have the recipient re-share their pubkey (a NodeInfo broadcast usually does this).',
        'If the radio recently factory-reset, keys may have rotated.',
      ],
    };
    case 38: return {
      label: 'rate-limited',
      explainer: 'You\'re sending faster than the radio or the network is willing to accept. This is firmware-side throttling, separate from regional duty cycles.',
      nextSteps: ['Slow down — wait at least a few seconds between messages.'],
    };
    default: return {
      label: `error ${code}`,
      explainer: 'The radio reported a Routing error code we don\'t have a friendly name for.',
      nextSteps: ['Try resending. If it persists, check the firmware version on Connect.'],
    };
  }
}

function formatTime(rxSec: number): string {
  const d = new Date(rxSec * 1000);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(rxSec: number): string {
  const d = new Date(rxSec * 1000);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: today.getFullYear() === d.getFullYear() ? undefined : 'numeric' });
}

function dayKey(rxSec: number): string {
  const d = new Date(rxSec * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface Props {
  messages: TextMessage[];
  nodes: NodeRecord[];
  state: ConnectionState;
  target: ChatTarget | null;
  setTarget: (t: ChatTarget | null) => void;
}

export function ChatPanel({ messages, nodes, state, target, setTarget }: Props) {
  const myNum = state.myInfo?.myNodeNum ?? 0;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'conversations' | 'activity' | 'settings'>('conversations');
  // Per-thread last-viewed for unread badges; keyed by ConvoItem.key.
  const [lastViewed, setLastViewed] = useState<Record<string, number>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const convos = useMemo(() => buildConvoList(messages, nodes, state, lastViewed), [messages, nodes, state, lastViewed]);

  const effective: ChatTarget | null = target ?? (convos[0]?.target ?? null);

  const filtered = useMemo(() => {
    if (!effective) return [];
    return messages.filter((m) => matches(effective, m, myNum));
  }, [effective, messages, myNum]);

  // Mark current conversation read whenever it changes / messages arrive in it.
  useEffect(() => {
    if (!effective || activeTab !== 'conversations') return;
    const k = targetKey(effective);
    setLastViewed((prev) => ({ ...prev, [k]: Date.now() }));
  }, [effective, filtered.length, activeTab]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [filtered.length, effective?.kind === 'dm' ? effective.nodeNum : effective?.kind === 'channel' ? effective.index : -1]);

  const send = async () => {
    if (!text.trim() || state.status !== 'ready' || !effective) return;
    setSending(true);
    try {
      if (effective.kind === 'channel') {
        await window.mesh.sendText({ text: text.trim(), channel: effective.index });
      } else {
        await window.mesh.sendText({ text: text.trim(), to: effective.nodeNum, wantAck: true });
      }
      setText('');
    } finally {
      setSending(false);
    }
  };

  const resend = async (m: TextMessage) => {
    if (state.status !== 'ready') return;
    if (m.to === BROADCAST) await window.mesh.sendText({ text: m.text, channel: m.channel });
    else await window.mesh.sendText({ text: m.text, to: m.to, wantAck: true });
  };

  const exportMessages = (subset: TextMessage[], suffix: string) => {
    const headers = ['ts_iso', 'from', 'from_short', 'to', 'to_short', 'channel', 'text', 'rssi', 'snr', 'hop_taken', 'hop_start', 'ack_status'];
    const rows = subset.map((m) => [
      new Date(m.rxTime * 1000).toISOString(),
      '!' + (m.from >>> 0).toString(16).padStart(8, '0'),
      nameFor(nodes, m.from),
      m.to === BROADCAST ? 'broadcast' : '!' + (m.to >>> 0).toString(16).padStart(8, '0'),
      m.to === BROADCAST ? 'all' : nameFor(nodes, m.to),
      String(m.channel),
      m.text,
      m.rxRssi !== 0 ? String(m.rxRssi) : '',
      m.rxSnr ? m.rxSnr.toFixed(2) : '',
      m.hopStart && m.hopLimit ? String(m.hopStart - m.hopLimit) : '',
      m.hopStart ? String(m.hopStart) : '',
      m.ackStatus ?? '',
    ].map(escCsv).join(','));
    const csv = [headers.join(','), ...rows].join('\n') + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url; a.download = `mesh-chat-${suffix}-${stamp}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <h1 className="page-title">Chat</h1>
      <p className="page-sub">
        Channels broadcast to anyone with the matching key. DMs are addressed to a single node and request an ack.
      </p>

      <div className="subnav">
        <button className={'subnav-btn' + (activeTab === 'conversations' ? ' active' : '')} onClick={() => setActiveTab('conversations')}>
          Conversations
          {convos.reduce((s, c) => s + c.unread, 0) > 0 && (
            <span className="subnav-count" style={{ background: 'rgba(120,180,255,0.15)', color: 'var(--accent)', borderColor: 'rgba(120,180,255,0.4)' }}>
              {convos.reduce((s, c) => s + c.unread, 0)}
            </span>
          )}
        </button>
        <button className={'subnav-btn' + (activeTab === 'activity' ? ' active' : '')} onClick={() => setActiveTab('activity')}>
          Activity
          <span className="subnav-count">{messages.length}</span>
        </button>
        <button className={'subnav-btn' + (activeTab === 'settings' ? ' active' : '')} onClick={() => setActiveTab('settings')}>
          Settings
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {activeTab === 'conversations' && filtered.length > 0 && (
            <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => exportMessages(filtered, 'thread')}>⇩ CSV (this thread)</button>
          )}
          {activeTab === 'activity' && messages.length > 0 && (
            <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => exportMessages(messages, 'all')}>⇩ CSV (all)</button>
          )}
        </div>
      </div>

      {activeTab === 'conversations' && (
        <ConversationsView
          convos={convos}
          effective={effective}
          setTarget={setTarget}
          filtered={filtered}
          messages={messages}
          nodes={nodes}
          state={state}
          myNum={myNum}
          text={text}
          setText={setText}
          send={send}
          sending={sending}
          resend={resend}
          scrollRef={scrollRef}
        />
      )}
      {activeTab === 'activity' && (
        <ActivityView messages={messages} nodes={nodes} state={state} myNum={myNum} setTarget={setTarget} setActiveTab={setActiveTab} />
      )}
      {activeTab === 'settings' && (
        <SettingsView state={state} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Conversations tab
// ────────────────────────────────────────────────────────────────────

function ConversationsView({
  convos, effective, setTarget, filtered, messages, nodes, state, myNum,
  text, setText, send, sending, resend, scrollRef,
}: ConversationsProps) {
  const composeRef = useRef<HTMLTextAreaElement>(null);
  // Auto-focus the compose box when the user enters a conversation.
  useEffect(() => {
    if (state.status === 'ready') composeRef.current?.focus();
  }, [effective?.kind === 'dm' ? effective.nodeNum : effective?.kind === 'channel' ? effective.index : -1, state.status]);
  // Auto-grow textarea height to fit content (up to 5 lines).
  useEffect(() => {
    const el = composeRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [text]);
  return _Conversations({ convos, effective, setTarget, filtered, messages, nodes, state, myNum, text, setText, send, sending, resend, scrollRef, composeRef });
}
interface ConversationsProps {
  convos: ConvoItem[];
  effective: ChatTarget | null;
  setTarget: (t: ChatTarget | null) => void;
  filtered: TextMessage[];
  messages: TextMessage[];
  nodes: NodeRecord[];
  state: ConnectionState;
  myNum: number;
  text: string;
  setText: (s: string) => void;
  send: () => void;
  sending: boolean;
  resend: (m: TextMessage) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
}

function _Conversations({
  convos, effective, setTarget, filtered, messages, nodes, state, myNum,
  text, setText, send, sending, resend, scrollRef, composeRef,
}: ConversationsProps & { composeRef: React.RefObject<HTMLTextAreaElement> }) {
  const headerLabel = effective
    ? effective.kind === 'channel'
      ? `# ${convos.find((c) => c.key === `ch:${effective.index}`)?.label ?? effective.index}`
      : longNameFor(nodes, effective.nodeNum)
    : 'No conversation';

  const channelMeta = effective?.kind === 'channel' ? state.channels?.find((c) => c.index === effective.index) : undefined;
  const peerNode = effective?.kind === 'dm' ? nodes.find((n) => n.num === effective.nodeNum) : undefined;

  const placeholder = state.status !== 'ready'
    ? 'Connect to your node to chat'
    : effective?.kind === 'dm'
      ? `Message ${nameFor(nodes, effective.nodeNum)}…`
      : 'Send to channel…';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16, alignItems: 'stretch' }}>
      <div className="card" style={{ padding: 6, minHeight: 0 }}>
        <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 8px' }}>
          Channels & DMs
        </div>
        {convos.length === 0 && <div className="empty" style={{ padding: 12 }}>No channels yet.</div>}
        {convos.map((c) => {
          const active = effective && (
            (effective.kind === 'channel' && c.target.kind === 'channel' && effective.index === c.target.index) ||
            (effective.kind === 'dm' && c.target.kind === 'dm' && effective.nodeNum === c.target.nodeNum)
          );
          const accent = c.target.kind === 'dm' ? senderColor(c.target.nodeNum) : 'var(--text)';
          return (
            <button
              key={c.key}
              onClick={() => setTarget(c.target)}
              className={'convo-item' + (active ? ' active' : '')}
            >
              <div className="convo-row">
                <span className="convo-label" style={{ color: active ? 'var(--accent)' : accent }}>
                  {c.target.kind === 'channel' ? `# ${c.label}` : c.label}
                </span>
                {c.lastTs > 0 && <span className="convo-time">{relTime(c.lastTs)}</span>}
                {c.unread > 0 && <span className="convo-unread">{c.unread}</span>}
              </div>
              <div className="convo-preview">
                {c.lastText
                  ? <>{c.lastFromMe ? <span className="convo-prev-sender">me:</span> : <span className="convo-prev-sender">{c.lastSender}:</span>} {c.lastText}</>
                  : <span style={{ color: 'var(--text-faint)' }}>{c.sub}</span>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="chat-header">
          <div>
            <div className="chat-header-title">{headerLabel}</div>
            <div className="chat-header-sub">
              {effective?.kind === 'channel' && channelMeta && (
                <>
                  <span>{channelMeta.roleName}</span>
                  <span>·</span>
                  <span>{channelMeta.pskLength === 0 ? 'unencrypted' : channelMeta.pskLength === 1 ? 'default key' : 'AES'}</span>
                  <span>·</span>
                  <span>{filtered.length} msg{filtered.length === 1 ? '' : 's'}</span>
                </>
              )}
              {effective?.kind === 'dm' && peerNode && (
                <>
                  <span>{shortHex(peerNode.num)}</span>
                  {peerNode.hopsAway !== undefined && <><span>·</span><span>hop {peerNode.hopsAway}</span></>}
                  {peerNode.rssi !== undefined && peerNode.rssi !== 0 && <><span>·</span><span>{peerNode.rssi} dBm</span></>}
                  {peerNode.lastHeard && <><span>·</span><span>last heard {agoShort(peerNode.lastHeard)}</span></>}
                </>
              )}
            </div>
          </div>
          {effective?.kind === 'dm' && (
            <button
              className="ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => window.mesh.sendTraceroute({ to: (effective as any).nodeNum })}
              disabled={state.status !== 'ready'}
              title="Send a traceroute to this node"
            >
              Traceroute
            </button>
          )}
        </div>

        <div ref={scrollRef} className="chat-scroll">
          {filtered.length === 0 ? (
            <EmptyExplainer state={state} effective={effective} totalMessages={messages.length} />
          ) : (
            <MessageList messages={filtered} nodes={nodes} myNum={myNum} onResend={resend} />
          )}
        </div>

        <div className="compose">
          <textarea
            ref={composeRef}
            className="text compose-textarea"
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={state.status !== 'ready' || sending || !effective}
            maxLength={200}
            rows={1}
          />
          <button className="primary" onClick={send} disabled={state.status !== 'ready' || sending || !text.trim() || !effective}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        <div className="compose-hint">
          {text.length}/200 chars · Enter sends · Shift+Enter newline · {effective?.kind === 'dm'
            ? `to ${shortHex(effective.nodeNum)} · wantAck=true`
            : `broadcast · channel ${effective?.kind === 'channel' ? effective.index : 0}`}
        </div>
      </div>
    </div>
  );
}

function MessageList({
  messages, nodes, myNum, onResend,
}: {
  messages: TextMessage[];
  nodes: NodeRecord[];
  myNum: number;
  onResend: (m: TextMessage) => void;
}) {
  const items: React.ReactNode[] = [];
  let prevDay = '';
  let prevFrom = -1;
  let prevTime = 0;

  messages.forEach((m, i) => {
    const dk = dayKey(m.rxTime);
    if (dk !== prevDay) {
      items.push(
        <div key={`day-${dk}-${i}`} className="day-sep">
          <span>{dayLabel(m.rxTime)}</span>
        </div>,
      );
      prevDay = dk;
      prevFrom = -1;
      prevTime = 0;
    }
    const isMe = m.from === myNum;
    const next = messages[i + 1];
    const grouped = m.from === prevFrom && (m.rxTime - prevTime) < 120;
    const hasNextSame = next && next.from === m.from && (next.rxTime - m.rxTime) < 120 && dayKey(next.rxTime) === dk;
    items.push(
      <ChatBubble
        key={`${m.id}-${m.from}-${m.rxTime}-${i}`}
        m={m}
        nodes={nodes}
        isMe={isMe}
        showHeader={!grouped}
        attachedTop={grouped}
        attachedBottom={!!hasNextSame}
        onResend={onResend}
      />,
    );
    prevFrom = m.from;
    prevTime = m.rxTime;
  });
  return <>{items}</>;
}

function ChatBubble({
  m, nodes, isMe, showHeader, attachedTop, attachedBottom, onResend,
}: {
  m: TextMessage;
  nodes: NodeRecord[];
  isMe: boolean;
  showHeader: boolean;
  attachedTop: boolean;
  attachedBottom: boolean;
  onResend: (m: TextMessage) => void;
}) {
  const sender = isMe ? 'me' : nameFor(nodes, m.from);
  const color = isMe ? 'var(--good)' : senderColor(m.from);
  const ack = m.ackStatus;
  const failed = ack === 'failed';
  const failure = failed ? describeAckError(m.ackError) : null;
  const isLastInGroup = !attachedBottom;
  return (
    <div className={'chat-row' + (isMe ? ' me' : '') + (attachedTop ? ' attached-top' : '') + (attachedBottom ? ' attached-bottom' : '')}>
      {showHeader && (
        <div className="chat-row-head">
          <span className="chat-row-name" style={{ color }}>{sender}</span>
          <span className="chat-row-time">{formatTime(m.rxTime)}</span>
        </div>
      )}
      <div
        className={'chat-bubble' + (isMe ? ' me' : '') + (failed ? ' failed' : '') + (attachedTop ? ' attached-top' : '') + (attachedBottom ? ' attached-bottom' : '')}
        style={!isMe ? { borderLeft: `2px solid ${color}` } : undefined}
        title={`packet !${m.id.toString(16).padStart(8, '0')} · ${new Date(m.rxTime * 1000).toLocaleString()}`}
      >
        <div className="chat-text">{m.text}</div>
        {isLastInGroup && (
          <div className="chat-meta">
            {!isMe && m.rxRssi !== 0 && <span>{m.rxRssi} dBm</span>}
            {!isMe && m.rxSnr !== 0 && <span>SNR {m.rxSnr.toFixed(1)}</span>}
            {!isMe && m.hopStart > 0 && <span>hop {m.hopStart - m.hopLimit}/{m.hopStart}</span>}
            {isMe && ack === 'pending' && <span className="ack ack-pending">… pending</span>}
            {isMe && ack === 'acked' && <span className="ack ack-acked">✓ delivered</span>}
            {isMe && failed && (
              <span className="ack ack-failed">✗ {failure?.label ?? 'failed'}</span>
            )}
            {isMe && failed && <button className="resend-btn" onClick={() => onResend(m)}>resend</button>}
          </div>
        )}
        {isLastInGroup && failed && failure && (
          <div className="chat-failure">
            <div className="chat-failure-explainer">{failure.explainer}</div>
            {failure.nextSteps.length > 0 && (
              <ul className="chat-failure-steps">
                {failure.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Activity tab — unified chronological feed
// ────────────────────────────────────────────────────────────────────

function ActivityView({
  messages, nodes, state, myNum, setTarget, setActiveTab,
}: {
  messages: TextMessage[];
  nodes: NodeRecord[];
  state: ConnectionState;
  myNum: number;
  setTarget: (t: ChatTarget | null) => void;
  setActiveTab: (t: 'conversations') => void;
}) {
  if (messages.length === 0) {
    return (
      <div className="card">
        <EmptyExplainer state={state} effective={null} totalMessages={0} />
      </div>
    );
  }
  const sorted = [...messages].sort((a, b) => b.rxTime - a.rxTime);
  return (
    <div className="card">
      <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12.5 }}>
        Every message across every channel and DM, newest first. Click a row to jump into that conversation.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>When</th>
            <th>Where</th>
            <th>From</th>
            <th>Message</th>
            <th>RF</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => {
            const isMe = m.from === myNum;
            const where: ChatTarget = m.to === BROADCAST
              ? { kind: 'channel', index: m.channel }
              : { kind: 'dm', nodeNum: isMe ? m.to : m.from };
            const whereLabel = m.to === BROADCAST
              ? `# ${state.channels?.find((c) => c.index === m.channel)?.name || (m.channel === 0 ? 'Default' : `Ch${m.channel}`)}`
              : `DM ${nameFor(nodes, isMe ? m.to : m.from)}`;
            return (
              <tr
                key={`${m.id}-${m.from}-${m.rxTime}`}
                onClick={() => { setTarget(where); setActiveTab('conversations'); }}
                style={{ cursor: 'pointer' }}
              >
                <td>{formatTime(m.rxTime)}</td>
                <td style={{ color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 12 }}>{whereLabel}</td>
                <td>{isMe ? 'me' : nameFor(nodes, m.from)}</td>
                <td style={{ fontFamily: 'inherit' }}>{m.text}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-faint)' }}>
                  {!isMe && m.rxRssi !== 0 && <>{m.rxRssi} dBm · SNR {m.rxSnr.toFixed(1)} · </>}
                  {!isMe && m.hopStart > 0 && <>hop {m.hopStart - m.hopLimit}/{m.hopStart}</>}
                  {isMe && m.ackStatus && (
                    <span className={`ack ack-${m.ackStatus}`} title={m.ackStatus === 'failed' ? describeAckError(m.ackError)?.explainer : undefined}>
                      {ackGlyph(m.ackStatus)}{' '}
                      {m.ackStatus === 'failed' ? (describeAckError(m.ackError)?.label ?? 'failed') : m.ackStatus === 'acked' ? 'delivered' : m.ackStatus}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Settings tab — identity, behavior
// ────────────────────────────────────────────────────────────────────

function SettingsView({ state }: { state: ConnectionState }) {
  const [longName, setLongName] = useState('');
  const [shortName, setShortName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const isReady = state.status === 'ready';

  const apply = async () => {
    if (!longName.trim() || !shortName.trim()) return;
    setBusy(true); setMsg('');
    try {
      await window.mesh.setOwner({ longName: longName.trim(), shortName: shortName.trim().slice(0, 4) });
      setMsg('Sent to radio. Other nodes will pick up the new name on the next NodeInfo broadcast.');
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Your radio's identity</h2>
          <p style={{ margin: '0 0 12px', color: 'var(--text-dim)', fontSize: 12.5 }}>
            Other nodes label you with whatever <code>longName</code> / <code>shortName</code> your radio reports. The short name shows up in chat headers; the long name shows up in node detail pages.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Long name</label>
            <input className="text" maxLength={40} value={longName} onChange={(e) => setLongName(e.target.value)} placeholder="e.g. Travis (rooftop)" disabled={!isReady} />
            <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Short name</label>
            <input className="text" maxLength={4} value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="≤ 4 chars" disabled={!isReady} />
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="primary" onClick={apply} disabled={!isReady || busy || !longName.trim() || !shortName.trim()}>
              {busy ? 'Sending…' : 'Apply'}
            </button>
            {!isReady && <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Connect to your radio first.</span>}
            {msg && <span style={{ fontSize: 12, color: msg.startsWith('Error') ? 'var(--bad)' : 'var(--good)' }}>{msg}</span>}
          </div>
        </div>

        <div className="card">
          <h2>Default behavior</h2>
          <dl className="kv kv-tight">
            <dt>Broadcast wantAck</dt><dd>off — implicit acks via flood-rebroadcast</dd>
            <dt>DM wantAck</dt><dd>on — radio retries up to 3× and waits for explicit ack</dd>
            <dt>Heartbeat</dt><dd>every 5 min · keeps the USB API alive</dd>
            <dt>Retry timeout</dt><dd>60 s before a DM is marked failed</dd>
          </dl>
        </div>
      </div>

      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Why this exists.</strong> The official Meshtastic app exposes radio identity in five different places. The reality is just two strings the radio broadcasts in its NodeInfo packet. Set them once, here.</p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Channel keys.</strong> Channel encryption keys are configured on the radio itself. This app reads them via <code>want_config_id</code> but does not let you change them — that's a job for the official setup app, where typo-protection is more important than aesthetic.</p>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function EmptyExplainer({
  state,
  effective,
  totalMessages,
}: {
  state: ConnectionState;
  effective: ChatTarget | null;
  totalMessages: number;
}) {
  if (state.status !== 'ready') {
    return (
      <div className="empty">
        <p style={{ margin: '0 0 6px' }}>Connect to your node first.</p>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>Use the sidebar's <strong>Connect</strong> entry.</p>
      </div>
    );
  }
  if (effective?.kind === 'dm') {
    return (
      <div className="empty">
        <p style={{ margin: '0 0 6px' }}>No DMs with this node yet. Say hi.</p>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
          DMs are addressed to a specific node and request an ack. The <code>…</code> next to your message turns into <code>✓</code> when the recipient's radio confirms it received the packet, or <code>✗</code> if the ack times out — at which point a <em>resend</em> button appears.
        </p>
      </div>
    );
  }
  if (totalMessages === 0) {
    return (
      <div className="empty">
        <p style={{ margin: '0 0 8px' }}>No messages on the mesh yet. A few reasons that's normal:</p>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)' }}>
          <li>Most meshes are <strong>silent for hours</strong> outside cities — typical residential traffic is one packet every 30s–5min.</li>
          <li>Encrypted channels you don't have the key for arrive as <em>encrypted</em> packets and don't show up here at all (visible on the Packet Sniffer).</li>
          <li>Send your own message — it'll echo back from your radio when it actually transmits, confirming the link is alive.</li>
        </ul>
      </div>
    );
  }
  return (
    <div className="empty">
      <p style={{ margin: '0 0 6px' }}>No messages on this channel yet.</p>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
        Other channels in the sidebar may have traffic. If a channel you expect is empty, double-check the encryption key matches the senders'.
      </p>
    </div>
  );
}

function agoShort(secs: number): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - secs);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function escCsv(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
