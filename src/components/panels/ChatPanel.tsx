import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatTarget } from '../../App';
import { useActiveConnId, useMeshContext } from '../../hooks/MeshContext';
import { channelHash, channelHashHex, pskFingerprint, pskLabel } from '../../channel-identity';
import { estimateAirtimeSec, utf8Bytes, SOFT_BYTE_LIMIT, HARD_BYTE_LIMIT } from '../../lib/lora-airtime';
import { loadCanned, saveCanned, resetCanned } from '../../lib/canned-messages';
import { chunkText, parseChunk, assembleMessages, MAX_CHUNKS } from '../../lib/message-codec';
import { maybeCompress, maybeDecompress, isCompressed } from '../../lib/text-compress';
import { encodePayload, decodePayload, type DecodedPayload, type PositionPayload, type WaypointPayload, type ImageStub } from '../../lib/payload-types';
import { ditherImage, decodeOneBitImage, renderOneBitImage, type DitheredImage } from '../../lib/image-codec';
import { expandSmartText, parseSlashCommand, listShortcodes } from '../../lib/smart-text';
import { SmartText } from '../SmartText';
import { VoiceRecorder, packVoice, unpackVoice, type VoiceClip, VOICE_MAX_MS } from '../../lib/voice-codec';
import { nodeShortHex as shortHex, nodeDisplayName, nodeLongName } from '../../lib/node-identity';

const BROADCAST = 0xffffffff;

function labelForPosition(p: PositionPayload): string {
  const coords = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
  const alt = p.alt ? ` · ${p.alt} m` : '';
  const cap = p.caption ? ` — "${p.caption}"` : '';
  return `[location ${coords}${alt}]${cap}`;
}
function labelForWaypoint(p: WaypointPayload): string {
  return `[waypoint "${p.name}" @ ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}]${p.description ? ` — ${p.description}` : ''}`;
}

function nameFor(nodes: NodeRecord[], num: number): string {
  if (num === BROADCAST) return 'all';
  return nodeDisplayName(nodes, num);
}

function longNameFor(nodes: NodeRecord[], num: number): string {
  if (num === BROADCAST) return 'Broadcast';
  return nodeLongName(nodes, num);
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
  const connId = useActiveConnId();
  const myNum = state.myInfo?.myNodeNum ?? 0;
  // Drafts are kept per target so switching conversations doesn't nuke half-typed text.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'conversations' | 'activity' | 'help' | 'settings'>('conversations');
  // Per-thread last-viewed for unread badges; keyed by ConvoItem.key.
  const [lastViewed, setLastViewed] = useState<Record<string, number>>({});
  // Override for whether sends request an ack. 'auto' = default behavior (DMs on, broadcasts off).
  const [ackOverride, setAckOverride] = useState<'auto' | 'on' | 'off'>('auto');
  // Canned-message list (persisted in localStorage).
  const [canned, setCanned] = useState<string[]>(() => loadCanned());
  // Reply-to: when set, the next send is prefixed with a single-line quote.
  const [replyTarget, setReplyTarget] = useState<TextMessage | null>(null);
  // Search query across ALL messages in ALL conversations. When set, the
  // conversation-list pane shows flat search results instead of the convo list.
  const [searchQuery, setSearchQuery] = useState('');
  // "New DM" picker visibility.
  const [newDmOpen, setNewDmOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const convos = useMemo(() => buildConvoList(messages, nodes, state, lastViewed), [messages, nodes, state, lastViewed]);

  const effective: ChatTarget | null = target ?? (convos[0]?.target ?? null);
  const draftKey = effective ? targetKey(effective) : '';
  const text = drafts[draftKey] ?? '';
  const setText = (v: string) => setDrafts((d) => ({ ...d, [draftKey]: v }));

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

  // Effective ack policy for the current target: 'auto' means DMs request ack, broadcasts don't.
  const wantAckEffective = (): boolean => {
    if (!effective) return false;
    if (ackOverride === 'on') return true;
    if (ackOverride === 'off') return false;
    return effective.kind === 'dm';
  };

  // While a chunked send is in flight, surface progress so the user can see
  // "sending 3/5 chunks…" instead of a frozen Send button.
  const [sendProgress, setSendProgress] = useState<{ index: number; total: number; airtimeRemainingSec: number } | null>(null);

  /**
   * Inner send pipeline: takes any typed payload, runs it through encode →
   * compress → (chunk if needed) → radio. All non-text content types
   * (position, waypoint, future voice/image/gpx) flow through this exact
   * pipeline; only the encode step differs.
   */
  const sendPayload = async (p: DecodedPayload) => {
    if (state.status !== 'ready' || !effective || !connId) return;
    setSending(true);

    // 1. Encode the typed payload to a wire string (\x01<type>|<base64>)
    //    Text payloads pass through unchanged for backwards compatibility.
    const wire = encodePayload(p);

    // 2. Try to compress. The result is either the same string (no win)
    //    or a "\x01Z|<base64>" wrapper around the deflate output.
    const compression = await maybeCompress(wire);
    const wirePayload = compression.payload;
    const bytes = compression.wireBytes;
    const needsChunking = bytes > HARD_BYTE_LIMIT;

    const sendOne = async (textPayload: string) => {
      if (effective.kind === 'channel') {
        await window.mesh.sendText({ connId, text: textPayload, channel: effective.index, wantAck: wantAckEffective() });
      } else {
        await window.mesh.sendText({ connId, text: textPayload, to: effective.nodeNum, wantAck: wantAckEffective() });
      }
    };

    try {
      if (!needsChunking) {
        await sendOne(wirePayload);
      } else {
        const plan = chunkText(wirePayload);
        // Estimate per-chunk airtime so we can rate-limit. We don't want to
        // dump 20 packets into the radio's queue in 50 ms — the radio honors
        // duty cycle internally, but the UI should show paced progress and
        // we should yield enough between sends to let acks land between.
        const preset = state.loraConfig?.modemPresetName;
        const sf = state.loraConfig?.spreadFactor;
        const bw = state.loraConfig?.bandwidth;
        const perChunkAirtime = estimateAirtimeSec(200, preset, sf, bw);
        // Add 200ms safety + min 400ms between to avoid starving acks.
        const interChunkDelayMs = Math.max(400, perChunkAirtime * 1000 + 200);

        for (let i = 0; i < plan.chunks.length; i++) {
          setSendProgress({
            index: i + 1,
            total: plan.chunks.length,
            airtimeRemainingSec: perChunkAirtime * (plan.chunks.length - i),
          });
          await sendOne(plan.chunks[i]);
          if (i < plan.chunks.length - 1) {
            await new Promise((r) => setTimeout(r, interChunkDelayMs));
          }
        }
      }
    } finally {
      setSending(false);
      setSendProgress(null);
    }
  };

  /** Outer wrapper for sending the typed text in the compose box. */
  const send = async (overrideText?: string) => {
    let base = (overrideText ?? text).trim();
    if (!base) return;

    // 1. Slash commands — some are pure side effects (no send), some
    //    transform the text before send.
    const slash = parseSlashCommand(base);
    if (slash) {
      switch (slash.kind) {
        case 'me': {
          const myShort = nodes.find((n) => n.num === myNum)?.shortName || 'me';
          base = `* ${myShort} ${slash.action}`.trim();
          break;
        }
        case 'position':
          await sharePosition();
          if (overrideText === undefined) setText('');
          return;
        case 'help':
          setActiveTab('help');
          if (overrideText === undefined) setText('');
          return;
        case 'shortcodes':
          // Pop the help tab and let the user scroll to the shortcodes list.
          setActiveTab('help');
          if (overrideText === undefined) setText('');
          return;
        case 'unknown':
          // Unknown commands fall through and get sent literally — user might
          // be referring to something the other side understands.
          break;
      }
    }

    // 2. Expand emoji shortcodes + phrase macros.
    base = expandSmartText(base);

    // 3. If replying, prepend a one-line quote.
    let payload = base;
    if (replyTarget) {
      const quoted = replyTarget.text.replace(/\n/g, ' ').slice(0, 40);
      const suffix = replyTarget.text.length > 40 ? '…' : '';
      payload = `> ${quoted}${suffix}\n${base}`;
    }
    await sendPayload({ type: 'text', text: payload });
    if (overrideText === undefined) setText('');
    setReplyTarget(null);
  };

  /** Mark every conversation as read (resets all unread counters). */
  const markAllRead = () => {
    const now = Date.now();
    setLastViewed((prev) => {
      const next = { ...prev };
      for (const c of convos) next[c.key] = now;
      return next;
    });
  };

  // ── Desktop notifications ─────────────────────────────────────────
  // Fire an OS notification when a new message arrives from someone other
  // than us AND we're not currently looking at that conversation. The
  // browser's Notification permission is requested lazily on first arrival.
  const lastMessageIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (messages.length === 0) return;
    const newest = messages[messages.length - 1];
    if (lastMessageIdRef.current === null) {
      // First render — just record where we are; don't notify on startup.
      lastMessageIdRef.current = newest.id;
      return;
    }
    if (newest.id === lastMessageIdRef.current) return;
    lastMessageIdRef.current = newest.id;

    if (newest.from === myNum) return; // our own echo
    // Skip the notification if the user is already looking at the thread.
    if (effective) {
      const sameDm = effective.kind === 'dm' && newest.to !== 0xffffffff && (newest.from === effective.nodeNum || newest.to === effective.nodeNum);
      const sameChannel = effective.kind === 'channel' && newest.to === 0xffffffff && newest.channel === effective.index;
      if ((sameDm || sameChannel) && activeTab === 'conversations') return;
    }

    if (typeof Notification === 'undefined') return;
    const fire = () => {
      const senderLabel = nameFor(nodes, newest.from);
      const where = newest.to === 0xffffffff ? `# channel ${newest.channel}` : 'DM';
      // Strip a leading reply quote for the preview so the user sees the real content.
      const preview = newest.text.startsWith('> ') ? newest.text.split('\n').slice(1).join(' ') : newest.text;
      try {
        new Notification(`${senderLabel} · ${where}`, {
          body: preview.slice(0, 120),
          silent: false,
        });
      } catch { /* ignore */ }
    };
    if (Notification.permission === 'granted') fire();
    else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && fire());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Persist canned-message edits + provide a setter that auto-saves.
  const updateCanned = (next: string[]) => {
    setCanned(next);
    saveCanned(next);
  };

  /**
   * Share the connected radio's current position as a compact typed payload.
   * The optional caption from the compose box is included inline (so the
   * receiver sees one bubble with coordinates AND your note).
   */
  const sharePosition = async () => {
    const myNode = nodes.find((n) => n.num === myNum);
    if (!myNode || myNode.lat === undefined || myNode.lon === undefined) return;
    const caption = text.trim() || undefined;
    await sendPayload({
      type: 'position',
      lat: myNode.lat,
      lon: myNode.lon,
      alt: myNode.altitude,
      caption,
    });
    if (caption) setText('');
  };

  // Stage an image for sending. The picker dithers the source down to ~96×64
  // 1-bit pixels and shows a preview; the user clicks Send to actually
  // transmit. We keep it staged in state so the user can cancel or replace.
  const [pendingImage, setPendingImage] = useState<DitheredImage | null>(null);
  const [pickingImage, setPickingImage] = useState(false);
  const pickImage = async (file: File) => {
    setPickingImage(true);
    try {
      const img = await ditherImage(file);
      setPendingImage(img);
    } catch (e) {
      console.error('image dither failed', e);
    } finally {
      setPickingImage(false);
    }
  };
  const sendImage = async () => {
    if (!pendingImage) return;
    await sendPayload({ type: 'image', bytes: pendingImage.bytes });
    setPendingImage(null);
  };
  const cancelImage = () => setPendingImage(null);

  // Voice recording. The recorder lives outside React state since it owns
  // a mic stream and the recorder object isn't serializable.
  const voiceRecorderRef = useRef<VoiceRecorder | null>(null);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const [pendingVoice, setPendingVoice] = useState<VoiceClip | null>(null);

  // Tick the elapsed-ms readout once a second while recording.
  useEffect(() => {
    if (!recordingVoice) return;
    const t = setInterval(() => {
      setRecordingElapsed(voiceRecorderRef.current?.elapsedMs() ?? 0);
    }, 200);
    return () => clearInterval(t);
  }, [recordingVoice]);

  const startVoice = async () => {
    if (recordingVoice) return;
    const rec = new VoiceRecorder();
    voiceRecorderRef.current = rec;
    try {
      await rec.start({
        onAutoStop: () => { void stopVoice(); },
      });
      setRecordingVoice(true);
      setRecordingElapsed(0);
    } catch (e) {
      voiceRecorderRef.current = null;
      const msg = (e instanceof Error ? e.message : String(e));
      // Most common: permission denied. Surface a one-time alert.
      console.warn('voice recording failed:', msg);
      alert(`Couldn't start recording: ${msg}`);
    }
  };

  const stopVoice = async () => {
    const rec = voiceRecorderRef.current;
    if (!rec) return;
    try {
      const clip = await rec.stop();
      setPendingVoice(clip);
    } catch (e) {
      console.error('voice stop failed', e);
    } finally {
      voiceRecorderRef.current = null;
      setRecordingVoice(false);
      setRecordingElapsed(0);
    }
  };

  const cancelRecording = () => {
    voiceRecorderRef.current?.cancel();
    voiceRecorderRef.current = null;
    setRecordingVoice(false);
    setRecordingElapsed(0);
  };

  const sendVoice = async () => {
    if (!pendingVoice) return;
    const bytes = packVoice(pendingVoice);
    await sendPayload({ type: 'voice', bytes, durationMs: pendingVoice.durationMs });
    setPendingVoice(null);
  };

  const cancelVoice = () => setPendingVoice(null);

  const resend = async (m: TextMessage) => {
    if (state.status !== 'ready' || !connId) return;
    if (m.to === BROADCAST) await window.mesh.sendText({ connId, text: m.text, channel: m.channel });
    else await window.mesh.sendText({ connId, text: m.text, to: m.to, wantAck: true });
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

  const myNode = myNum ? nodes.find((n) => n.num === myNum) : undefined;
  const radioLabel = myNode?.shortName || myNode?.longName || state.portPath?.split('/').pop() || 'this radio';

  return (
    <div className="page">
      <h1 className="page-title">Chat</h1>
      <p className="page-sub">
        Channels broadcast to anyone with the matching key. DMs are addressed to a single node and request an ack.
      </p>
      {state.status === 'ready' && (
        <div className="chat-sending-via">
          <span className="chat-sending-via-label">SENDING VIA</span>
          <span className="chat-sending-via-name">{radioLabel}</span>
          {myNum > 0 && <span className="chat-sending-via-num">!{(myNum >>> 0).toString(16).padStart(8, '0')}</span>}
          {state.portPath && <span className="chat-sending-via-port">{state.portPath}</span>}
        </div>
      )}

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
        <button className={'subnav-btn' + (activeTab === 'help' ? ' active' : '')} onClick={() => setActiveTab('help')}>
          Help
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
          sendProgress={sendProgress}
          resend={resend}
          scrollRef={scrollRef}
          canned={canned}
          ackOverride={ackOverride}
          setAckOverride={setAckOverride}
          sharePosition={sharePosition}
          pendingImage={pendingImage}
          pickImage={pickImage}
          sendImage={sendImage}
          cancelImage={cancelImage}
          pickingImage={pickingImage}
          recordingVoice={recordingVoice}
          recordingElapsed={recordingElapsed}
          pendingVoice={pendingVoice}
          startVoice={startVoice}
          stopVoice={stopVoice}
          cancelRecording={cancelRecording}
          sendVoice={sendVoice}
          cancelVoice={cancelVoice}
          replyTarget={replyTarget}
          setReplyTarget={setReplyTarget}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          newDmOpen={newDmOpen}
          setNewDmOpen={setNewDmOpen}
          markAllRead={markAllRead}
        />
      )}
      {activeTab === 'activity' && (
        <ActivityView messages={messages} nodes={nodes} state={state} myNum={myNum} setTarget={setTarget} setActiveTab={setActiveTab} />
      )}
      {activeTab === 'help' && (
        <HelpView canned={canned} updateCanned={updateCanned} />
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

function ConversationsView(props: ConversationsProps) {
  const { state, text, effective } = props;
  const composeRef = useRef<HTMLTextAreaElement>(null);
  // Auto-focus the compose box when the user enters a conversation.
  useEffect(() => {
    if (state.status === 'ready') composeRef.current?.focus();
  }, [effective?.kind === 'dm' ? effective.nodeNum : effective?.kind === 'channel' ? effective.index : -1, state.status]);
  // Auto-grow textarea height to fit content (up to ~10 lines).
  useEffect(() => {
    const el = composeRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(72, Math.min(el.scrollHeight, 220)) + 'px';
  }, [text]);
  return _Conversations({ ...props, composeRef });
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
  send: (overrideText?: string) => void;
  sending: boolean;
  sendProgress: { index: number; total: number; airtimeRemainingSec: number } | null;
  resend: (m: TextMessage) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
  canned: string[];
  ackOverride: 'auto' | 'on' | 'off';
  setAckOverride: (v: 'auto' | 'on' | 'off') => void;
  sharePosition: () => void;
  pendingImage: DitheredImage | null;
  pickImage: (file: File) => void;
  sendImage: () => void;
  cancelImage: () => void;
  pickingImage: boolean;
  recordingVoice: boolean;
  recordingElapsed: number;
  pendingVoice: VoiceClip | null;
  startVoice: () => void;
  stopVoice: () => void;
  cancelRecording: () => void;
  sendVoice: () => void;
  cancelVoice: () => void;
  replyTarget: TextMessage | null;
  setReplyTarget: (m: TextMessage | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  newDmOpen: boolean;
  setNewDmOpen: (v: boolean) => void;
  markAllRead: () => void;
}

/**
 * Inline node picker for starting a new DM. Filterable by short/long name or
 * hex id. Excludes the user's own node from the list.
 */
function NewDmPicker({
  nodes, myNum, onPick, onClose,
}: {
  nodes: NodeRecord[];
  myNum: number;
  onPick: (num: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return nodes
      .filter((n) => n.num !== myNum)
      .filter((n) => !q || n.shortName?.toLowerCase().includes(q) || n.longName?.toLowerCase().includes(q) || shortHex(n.num).toLowerCase().includes(q))
      // Most-recently-heard first
      .sort((a, b) => (b.lastHeard ?? 0) - (a.lastHeard ?? 0))
      .slice(0, 30);
  }, [nodes, query, myNum]);

  return (
    <div className="new-dm-picker">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <input
          className="text"
          autoFocus
          placeholder="filter by name or id…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, fontSize: 12 }}
        />
        <button className="ghost" onClick={onClose} style={{ padding: '3px 8px', fontSize: 11 }}>✕</button>
      </div>
      <div className="new-dm-list">
        {filtered.length === 0 && (
          <div className="empty" style={{ padding: 10, fontSize: 11 }}>No matching nodes yet.</div>
        )}
        {filtered.map((n) => (
          <button
            key={n.num}
            className="new-dm-item"
            onClick={() => onPick(n.num)}
          >
            <span className="new-dm-short" style={{ color: senderColor(n.num) }}>{n.shortName || '????'}</span>
            <span className="new-dm-long">{n.longName || shortHex(n.num)}</span>
            {n.lastHeard && <span className="new-dm-time">{relTime(n.lastHeard)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function _Conversations({
  convos, effective, setTarget, filtered, messages, nodes, state, myNum,
  text, setText, send, sending, sendProgress, resend, scrollRef, composeRef,
  canned, ackOverride, setAckOverride, sharePosition,
  pendingImage, pickImage, sendImage, cancelImage, pickingImage,
  recordingVoice, recordingElapsed, pendingVoice, startVoice, stopVoice, cancelRecording, sendVoice, cancelVoice,
  replyTarget, setReplyTarget, searchQuery, setSearchQuery, newDmOpen, setNewDmOpen, markAllRead,
}: ConversationsProps & { composeRef: React.RefObject<HTMLTextAreaElement> }) {
  const connId = useActiveConnId();
  const [cannedOpen, setCannedOpen] = useState(false);

  // Cmd/Ctrl + 1-9 sends the corresponding canned message immediately, without
  // touching the in-flight draft. Disabled while sending or disconnected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const msg = canned[n - 1];
      if (!msg) return;
      e.preventDefault();
      if (state.status === 'ready' && effective && !sending) send(msg);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canned, state.status, effective, sending, send]);
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

  // Flat search results when searchQuery is non-empty — across every conversation.
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return messages
      .filter((m) => m.text.toLowerCase().includes(q))
      .slice(-50)
      .reverse();
  }, [messages, searchQuery]);

  const totalUnread = convos.reduce((s, c) => s + c.unread, 0);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'stretch' }}>
      <div className="card" style={{ padding: 6, minHeight: 0 }}>
        <div className="convo-toolbar">
          <input
            className="text convo-search"
            placeholder="Search messages…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="convo-toolbar-buttons">
            <button
              className="ghost convo-toolbar-btn"
              onClick={() => setNewDmOpen(!newDmOpen)}
              title="Start a DM with any node you've heard from"
            >
              + DM
            </button>
            {totalUnread > 0 && (
              <button
                className="ghost convo-toolbar-btn"
                onClick={markAllRead}
                title="Clear all unread badges"
              >
                ✓ all read
              </button>
            )}
          </div>
        </div>

        {newDmOpen && (
          <NewDmPicker
            nodes={nodes}
            myNum={myNum}
            onPick={(num) => { setTarget({ kind: 'dm', nodeNum: num }); setNewDmOpen(false); }}
            onClose={() => setNewDmOpen(false)}
          />
        )}

        {/* When searching, replace the convo list with flat results across all conversations */}
        {searchQuery.trim() ? (
          <div className="convo-search-results">
            <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 8px' }}>
              {searchResults.length} match{searchResults.length === 1 ? '' : 'es'}
            </div>
            {searchResults.length === 0 && <div className="empty" style={{ padding: 12 }}>No matches.</div>}
            {searchResults.map((m) => {
              const isMe = m.from === myNum;
              const isBroadcast = m.to === 0xffffffff;
              const whereTarget: ChatTarget = isBroadcast
                ? { kind: 'channel', index: m.channel }
                : { kind: 'dm', nodeNum: isMe ? m.to : m.from };
              const whereLabel = isBroadcast ? `# ch ${m.channel}` : `${isMe ? 'to ' : 'from '}${nameFor(nodes, isMe ? m.to : m.from)}`;
              // Highlight the matched substring within the preview.
              return (
                <button
                  key={`sr-${m.id}-${m.from}-${m.rxTime}`}
                  className="convo-search-result"
                  onClick={() => { setTarget(whereTarget); setSearchQuery(''); }}
                >
                  <div className="convo-search-result-where">{whereLabel} · {relTime(m.rxTime)}</div>
                  <div className="convo-search-result-text">{m.text}</div>
                </button>
              );
            })}
          </div>
        ) : (
          <>
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
          </>
        )}
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
                  <span>{pskLabel(channelMeta.pskLength)}</span>
                  <span>·</span>
                  <span title="8-bit channel hash = xor(name) ^ xor(psk). Receivers use this to pick a decryption key; mismatched hash = packets ignored.">
                    hash <strong style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{channelHashHex(channelHash(channelMeta.name || '', channelMeta.psk ?? []))}</strong>
                  </span>
                  <span>·</span>
                  <span title="First/last bytes of the actual PSK — proves two identically-labelled keys really are the same.">
                    psk <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-faint)' }}>{pskFingerprint(channelMeta.psk ?? [])}</span>
                  </span>
                  <span>·</span>
                  <span>{filtered.length} msg{filtered.length === 1 ? '' : 's'}</span>
                </>
              )}
              {effective?.kind === 'dm' && peerNode && (
                <>
                  <span>{shortHex(peerNode.num)}</span>
                  {peerNode.hopsAway !== undefined && <><span>·</span><span>hop {peerNode.hopsAway}</span></>}
                  {peerNode.rssi !== undefined && peerNode.rssi !== 0 && <><span>·</span><span>{peerNode.rssi} dBm</span></>}
                  {peerNode.lastHeard && (
                    <>
                      <span>·</span>
                      <span style={{ color: (Date.now() / 1000 - peerNode.lastHeard) < 60 * 30 ? 'var(--good)' : (Date.now() / 1000 - peerNode.lastHeard) < 60 * 60 * 2 ? 'var(--warn)' : 'var(--text-faint)' }}>
                        last RX {agoShort(peerNode.lastHeard)}
                      </span>
                    </>
                  )}
                  {peerNode.viaMqtt && <><span>·</span><span className="src-chip src-mqtt">via MQTT</span></>}
                </>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {effective?.kind === 'dm' && (
              <button
                className="ghost"
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => connId && window.mesh.sendTraceroute({ connId, to: (effective as any).nodeNum })}
                disabled={state.status !== 'ready' || !connId}
                title="Send a traceroute to this node"
              >
                Traceroute
              </button>
            )}
            {effective && filtered.length > 0 && (
              <button
                className="ghost"
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={async () => {
                  const label = effective.kind === 'channel'
                    ? `channel ${effective.index}`
                    : longNameFor(nodes, effective.nodeNum);
                  if (!confirm(`Clear ${filtered.length} message${filtered.length === 1 ? '' : 's'} in this conversation (${label})?\n\nDeletes them from this app's local database and memory. The radio's own message buffer is not affected. No undo.`)) return;
                  if (effective.kind === 'channel') {
                    await window.mesh.clearConversation({ kind: 'channel', channel: effective.index });
                  } else {
                    await window.mesh.clearConversation({ kind: 'dm', myNum, peer: effective.nodeNum });
                  }
                }}
                title="Wipe this conversation from local storage. The radio's own buffer is firmware-managed and not affected."
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="chat-scroll">
          {filtered.length === 0 ? (
            <EmptyExplainer state={state} effective={effective} totalMessages={messages.length} />
          ) : (
            <AssembledMessageList filtered={filtered} nodes={nodes} myNum={myNum} onResend={resend} onReply={setReplyTarget} />
          )}
        </div>

        <DeliveryProbe filtered={filtered} myNum={myNum} effective={effective} />

        {sendProgress && (
          <div className="chat-send-progress">
            <div className="chat-send-progress-label">
              SENDING {sendProgress.index}/{sendProgress.total} CHUNKS
              <span style={{ marginLeft: 8, color: 'var(--text-faint)' }}>
                ~{sendProgress.airtimeRemainingSec.toFixed(1)}s of airtime remaining
              </span>
            </div>
            <div className="chat-send-progress-bar">
              <div className="chat-send-progress-fill" style={{ width: `${(sendProgress.index / sendProgress.total) * 100}%` }} />
            </div>
          </div>
        )}

        {replyTarget && (
          <div className="reply-chip">
            <div className="reply-chip-bar" />
            <div className="reply-chip-body">
              <div className="reply-chip-label">REPLYING TO {nameFor(nodes, replyTarget.from)}</div>
              <div className="reply-chip-text">{replyTarget.text.replace(/\n/g, ' ').slice(0, 80)}{replyTarget.text.length > 80 ? '…' : ''}</div>
            </div>
            <button className="ghost reply-chip-close" onClick={() => setReplyTarget(null)} title="Cancel reply">✕</button>
          </div>
        )}

        {pendingImage && (
          <ImagePreviewBar
            image={pendingImage}
            onSend={sendImage}
            onCancel={cancelImage}
            sending={sending}
            loraConfig={state.loraConfig}
          />
        )}

        {recordingVoice && (
          <VoiceRecordingIndicator
            elapsedMs={recordingElapsed}
            onStop={stopVoice}
            onCancel={cancelRecording}
          />
        )}

        {pendingVoice && (
          <VoicePreviewBar
            clip={pendingVoice}
            onSend={sendVoice}
            onCancel={cancelVoice}
            sending={sending}
            loraConfig={state.loraConfig}
          />
        )}

        <RichCompose
          composeRef={composeRef}
          text={text}
          setText={setText}
          send={send}
          sending={sending}
          state={state}
          effective={effective}
          placeholder={placeholder}
          nodes={nodes}
          myNum={myNum}
          canned={canned}
          cannedOpen={cannedOpen}
          setCannedOpen={setCannedOpen}
          ackOverride={ackOverride}
          setAckOverride={setAckOverride}
          sharePosition={sharePosition}
          pickImage={pickImage}
          pickingImage={pickingImage}
          startVoice={startVoice}
          recordingVoice={recordingVoice}
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Compose box with live airtime + canned-message popover + ACK toggle
// ────────────────────────────────────────────────────────────────────

function RichCompose({
  composeRef, text, setText, send, sending, state, effective, placeholder,
  nodes, myNum, canned, cannedOpen, setCannedOpen, ackOverride, setAckOverride, sharePosition,
  pickImage, pickingImage, startVoice, recordingVoice,
}: {
  composeRef: React.RefObject<HTMLTextAreaElement>;
  text: string;
  setText: (s: string) => void;
  send: (overrideText?: string) => void;
  sending: boolean;
  state: ConnectionState;
  effective: ChatTarget | null;
  placeholder: string;
  nodes: NodeRecord[];
  myNum: number;
  canned: string[];
  cannedOpen: boolean;
  setCannedOpen: (v: boolean) => void;
  ackOverride: 'auto' | 'on' | 'off';
  setAckOverride: (v: 'auto' | 'on' | 'off') => void;
  sharePosition: () => void;
  pickImage: (file: File) => void;
  pickingImage: boolean;
  startVoice: () => void;
  recordingVoice: boolean;
}) {
  // Hidden file input used by the "+ Image" toolbar button.
  const imageInputRef = useRef<HTMLInputElement>(null);
  const bytes = utf8Bytes(text);
  // Live "what would compression do?" preview. We re-run maybeCompress as the
  // user types (debounced via React's render batching). It's cheap for chat-
  // sized text. The result is shown in the toolbar so the user can see
  // compression earning its keep before clicking Send.
  const [compressionPreview, setCompressionPreview] = useState<{ wireBytes: number; used: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!text.trim() || bytes < 80) {
      setCompressionPreview(null);
      return;
    }
    maybeCompress(text).then((r) => {
      if (!cancelled) setCompressionPreview({ wireBytes: r.wireBytes, used: r.used });
    });
    return () => { cancelled = true; };
  }, [text, bytes]);
  const effectiveBytes = compressionPreview?.used ? compressionPreview.wireBytes : bytes;
  const overSoft = effectiveBytes > SOFT_BYTE_LIMIT;
  const willChunk = effectiveBytes > HARD_BYTE_LIMIT;
  // Predict how many chunks this will become — 200 bytes payload per chunk.
  const expectedChunks = willChunk ? Math.min(MAX_CHUNKS, Math.ceil(effectiveBytes / 200)) : 1;
  const overMaxChunks = willChunk && effectiveBytes > MAX_CHUNKS * 200;

  const airtime = useMemo(() => {
    if (!text.trim()) return 0;
    // Use the compressed size if compression is going to win, since that's
    // what actually goes on the air.
    return estimateAirtimeSec(effectiveBytes, state.loraConfig?.modemPresetName, state.loraConfig?.spreadFactor, state.loraConfig?.bandwidth);
  }, [effectiveBytes, text, state.loraConfig]);

  // Duty-cycle context: most regions allow ~1% duty (36 s/hr). Show airtime
  // as a fraction of that, so user sees "1.8s = 5% of your 1-hour duty budget".
  const dutyPctPerHour = airtime > 0 ? (airtime / 36) * 100 : 0;

  const airtimeColor = airtime < 0.5 ? 'var(--good)' : airtime < 2 ? 'var(--warn)' : 'var(--bad)';
  const bytesColor = overMaxChunks ? 'var(--bad)' : overSoft ? 'var(--warn)' : 'var(--text-faint)';

  const myNode = nodes.find((n) => n.num === myNum);
  const canInsertPosition = myNode && myNode.lat !== undefined && myNode.lon !== undefined && !(myNode.lat === 0 && myNode.lon === 0);

  // Effective ack policy for the current target.
  const ackActive = ackOverride === 'on' || (ackOverride === 'auto' && effective?.kind === 'dm');
  const ackEditable = effective !== null;

  // Resolve destination label for the compose summary.
  const destLabel = !effective
    ? '—'
    : effective.kind === 'channel'
      ? `# channel ${effective.index}`
      : `→ ${shortHex(effective.nodeNum)}`;

  const disabled = state.status !== 'ready' || sending || !effective || overMaxChunks;

  return (
    <>
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
              if (!disabled && text.trim()) send();
            }
          }}
          disabled={state.status !== 'ready' || sending || !effective}
          rows={3}
        />
        <button
          className="primary compose-send-btn"
          onClick={() => send()}
          disabled={disabled || !text.trim()}
          title={overMaxChunks ? `Message exceeds the chunked-send cap of ~${MAX_CHUNKS * 200} bytes. Trim or split it.` : willChunk ? `Will be sent as ${expectedChunks} chunks.` : undefined}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>

      <div className="compose-toolbar">
        <div className="compose-toolbar-actions">
          <button
            className="ghost compose-action"
            onClick={() => setCannedOpen(!cannedOpen)}
            disabled={state.status !== 'ready' || !effective}
            title="Quick-insert pre-canned messages"
          >
            Quick ▾
          </button>
          <button
            className="ghost compose-action"
            onClick={sharePosition}
            disabled={!canInsertPosition || state.status !== 'ready' || !effective}
            title={canInsertPosition ? 'Send your current location as a compact typed payload (12 bytes vs ~50 for text). Caption in the compose box is sent inline.' : 'No position from your radio yet'}
          >
            Share location
          </button>
          <button
            className="ghost compose-action"
            onClick={() => imageInputRef.current?.click()}
            disabled={state.status !== 'ready' || !effective || pickingImage}
            title="Pick a photo. The app downscales to ~96×64 and dithers to 1 bit before sending — typical 3-4 chunks on air."
          >
            {pickingImage ? 'Dithering…' : '+ Image'}
          </button>
          <button
            className="ghost compose-action"
            onClick={startVoice}
            disabled={state.status !== 'ready' || !effective || recordingVoice}
            title={`Record a voice message (max ${VOICE_MAX_MS / 1000}s). Encoded with Opus at 6 kbps — speech-grade but uses several chunks of airtime per second of audio.`}
          >
            ● Voice
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) pickImage(file);
              e.currentTarget.value = ''; // allow picking the same file again
            }}
          />
          <label
            className={'compose-toggle' + (ackActive ? ' on' : '') + (!ackEditable ? ' dim' : '')}
            title="Request a routing ack from the destination. Default: on for DMs, off for broadcasts."
          >
            <input
              type="checkbox"
              checked={ackActive}
              disabled={!ackEditable || state.status !== 'ready'}
              onChange={(e) => {
                if (!effective) return;
                const def = effective.kind === 'dm';
                // If the new value matches the default, return to 'auto'.
                setAckOverride(e.target.checked === def ? 'auto' : (e.target.checked ? 'on' : 'off'));
              }}
            />
            Request ACK
            {ackOverride !== 'auto' && <span className="compose-toggle-override">override</span>}
          </label>
        </div>

        <div className="compose-toolbar-meta">
          <span style={{ color: bytesColor }} title="UTF-8 bytes on the wire (after compression if enabled). Single packets cap at ~230 B; longer messages auto-chunk into multiple packets.">
            {effectiveBytes} B
            {compressionPreview?.used && (
              <span style={{ color: 'var(--good)', marginLeft: 4 }} title={`Raw text is ${bytes} B; DEFLATE+base64 cut it to ${compressionPreview.wireBytes} B.`}>
                ↓{bytes} ({Math.round((1 - compressionPreview.wireBytes / bytes) * 100)}%)
              </span>
            )}
            {willChunk && !overMaxChunks && <> · <strong style={{ color: 'var(--warn)' }}>{expectedChunks} chunks</strong></>}
            {overMaxChunks && <strong style={{ color: 'var(--bad)' }}> — too long, max {MAX_CHUNKS * 200} B</strong>}
          </span>
          <span style={{ color: 'var(--text-faint)' }}>·</span>
          {text.trim() ? (
            <span style={{ color: airtimeColor }} title="Estimated time-on-air at the current LoRa preset. ~1% of an hour (36 s) is the regulatory duty-cycle budget in EU.">
              ~{airtime < 1 ? `${(airtime * 1000).toFixed(0)} ms` : `${airtime.toFixed(1)} s`} air
              {dutyPctPerHour > 0 && <> · <span style={{ color: dutyPctPerHour > 2 ? 'var(--warn)' : 'var(--text-faint)' }}>{dutyPctPerHour.toFixed(1)}% / hr duty</span></>}
            </span>
          ) : (
            <span style={{ color: 'var(--text-faint)' }}>airtime · duty</span>
          )}
          <span style={{ color: 'var(--text-faint)' }}>·</span>
          <span style={{ color: 'var(--text-faint)' }}>{destLabel}</span>
          <span style={{ color: 'var(--text-faint)' }}>·</span>
          <span style={{ color: 'var(--text-faint)' }}>Enter sends · Shift+Enter newline · ⌘1–9 send canned</span>
        </div>
      </div>

      {cannedOpen && (
        <div className="compose-canned">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <strong style={{ fontSize: 12, color: 'var(--text-dim)' }}>Quick messages — click to send now</strong>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>edit list in Help</span>
          </div>
          <div className="compose-canned-grid">
            {canned.length === 0 && <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>No quick messages yet. Add some in the Help tab.</span>}
            {canned.map((msg, i) => (
              <button
                key={i}
                className="compose-canned-btn"
                onClick={() => { send(msg); setCannedOpen(false); }}
                disabled={state.status !== 'ready' || !effective || sending}
                title={`Cmd/Ctrl+${i + 1 < 10 ? i + 1 : ''} sends without opening this menu`}
              >
                {i < 9 && <span className="compose-canned-key">{i + 1}</span>}
                {msg}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** TextMessage with optional chunked-assembly + compression + typed-payload metadata. */
interface DisplayMessage extends TextMessage {
  _chunkInfo?: { total: number; received: number; bytes: number; complete: boolean };
  _compression?: { wireBytes: number; decompressedBytes: number };
  /** Decoded typed payload (position / waypoint / voice / image / gpx).
   *  Absent for plain text. */
  _payload?: DecodedPayload;
}

function AssembledMessageList({
  filtered, nodes, myNum, onResend, onReply,
}: {
  filtered: TextMessage[];
  nodes: NodeRecord[];
  myNum: number;
  onResend: (m: TextMessage) => void;
  onReply: (m: TextMessage) => void;
}) {
  // Cache of decompression results keyed by compressed text. Compression is
  // deterministic, so the same wire payload always inflates to the same plain
  // text — caching avoids re-decompressing every render.
  const [decompressed, setDecompressed] = useState<Map<string, string>>(new Map());

  // First pass: build the assembled-but-still-possibly-compressed list.
  const assembledList = useMemo(() => assembleMessages(filtered), [filtered]);

  // Kick off decompression for any complete chunked message whose joined
  // text starts with the compression prefix. This runs async; the cache
  // updates trigger a re-render that swaps in the decompressed text.
  useEffect(() => {
    let cancelled = false;
    for (const a of assembledList) {
      if (!a.complete) continue;
      if (!isCompressed(a.text)) continue;
      if (decompressed.has(a.text)) continue;
      maybeDecompress(a.text).then((plain) => {
        if (cancelled) return;
        setDecompressed((m) => {
          if (m.has(a.text)) return m;
          const next = new Map(m);
          next.set(a.text, plain);
          return next;
        });
      });
    }
    return () => { cancelled = true; };
  }, [assembledList, decompressed]);

  const display = useMemo<DisplayMessage[]>(() => {
    return assembledList.map((a): DisplayMessage => {
      const wireBytes = a.parts.reduce((s, p) => s + new TextEncoder().encode(p.text).length, 0);
      // Did this come in compressed?
      const compressed = a.complete && isCompressed(a.text);
      const plain = compressed ? (decompressed.get(a.text) ?? '(decompressing…)') : a.text;
      const decompressedBytes = compressed ? new TextEncoder().encode(plain).length : wireBytes;

      // Decode the typed-payload header. For raw text, this returns
      // { type: 'text', text } which we just display normally. For position /
      // waypoint / etc., the bubble renders specially.
      const decoded = a.complete ? decodePayload(plain) : undefined;

      // Combine ackStatus across chunks.
      let ackStatus: TextMessage['ackStatus'] = a.representative.ackStatus;
      if (a.parts.length > 1) {
        if (a.parts.every((p) => p.ackStatus === 'acked')) ackStatus = 'acked';
        else if (a.parts.some((p) => p.ackStatus === 'failed')) ackStatus = 'failed';
        else if (a.parts.some((p) => p.ackStatus === 'pending')) ackStatus = 'pending';
      }

      const first = a.parts[0];
      // For non-text typed payloads, set the bubble's `text` to a one-line
      // human label so even minimal renderers show something useful.
      const text = !a.complete
        ? `${a.text}\n[receiving ${a.received}/${a.total} chunks…]`
        : decoded?.type === 'position'
          ? labelForPosition(decoded)
          : decoded?.type === 'waypoint'
            ? labelForWaypoint(decoded)
            : decoded?.type === 'voice'
              ? `[voice message · ${decoded.bytes.length} B]`
              : decoded?.type === 'image'
                ? `[image · ${decoded.bytes.length} B]`
                : decoded?.type === 'gpx'
                  ? `[GPX track · ${decoded.bytes.length} B]`
                  : plain;

      return {
        ...first,
        text,
        ackStatus,
        _chunkInfo: a.chunked ? { total: a.total, received: a.received, bytes: wireBytes, complete: a.complete } : undefined,
        _compression: compressed ? { wireBytes, decompressedBytes } : undefined,
        _payload: decoded && decoded.type !== 'text' ? decoded : undefined,
      };
    });
  }, [assembledList, decompressed]);
  return <MessageList messages={display} nodes={nodes} myNum={myNum} onResend={onResend} onReply={onReply} />;
}

function MessageList({
  messages, nodes, myNum, onResend, onReply,
}: {
  messages: DisplayMessage[];
  nodes: NodeRecord[];
  myNum: number;
  onResend: (m: TextMessage) => void;
  onReply: (m: TextMessage) => void;
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
        onReply={onReply}
      />,
    );
    prevFrom = m.from;
    prevTime = m.rxTime;
  });
  return <>{items}</>;
}

function ChatBubble({
  m, nodes, isMe, showHeader, attachedTop, attachedBottom, onResend, onReply,
}: {
  m: DisplayMessage;
  nodes: NodeRecord[];
  isMe: boolean;
  showHeader: boolean;
  attachedTop: boolean;
  attachedBottom: boolean;
  onResend: (m: TextMessage) => void;
  onReply: (m: TextMessage) => void;
}) {
  // Per-bubble disclosure for the full delivery timeline. Auto-opens on
  // failed messages so the diagnostic surfaces without a click.
  const [showFlow, setShowFlow] = useState(m.ackStatus === 'failed');
  useEffect(() => {
    // If status flips to failed after mount, open the flow automatically.
    if (m.ackStatus === 'failed') setShowFlow(true);
  }, [m.ackStatus]);
  // If the message starts with "> " on its first line, split that off as a
  // styled quote block. This is the same convention every chat app uses
  // and adds zero metadata to the wire payload.
  const lines = m.text.split('\n');
  const firstLineIsQuote = lines.length > 1 && lines[0].startsWith('> ');
  const quoteText = firstLineIsQuote ? lines[0].slice(2).trim() : '';
  const bodyText = firstLineIsQuote ? lines.slice(1).join('\n') : m.text;
  const sender = isMe ? 'me' : nameFor(nodes, m.from);
  const color = isMe ? 'var(--good)' : senderColor(m.from);
  const ack = m.ackStatus;
  const failed = ack === 'failed';
  const failure = failed ? describeAckError(m.ackError) : null;
  const isLastInGroup = !attachedBottom;
  return (
    <div className={'chat-row' + (isMe ? ' me' : '') + (attachedTop ? ' attached-top' : '') + (attachedBottom ? ' attached-bottom' : '')}>
      <div className={'chat-row-head' + (showHeader ? '' : ' chat-row-head-compact')}>
        {showHeader && <span className="chat-row-name" style={{ color }}>{sender}</span>}
        <span className="chat-row-time" title={new Date(m.rxTime * 1000).toLocaleString()}>{formatTime(m.rxTime)}</span>
      </div>
      <div
        className={'chat-bubble' + (isMe ? ' me' : '') + (failed ? ' failed' : '') + (attachedTop ? ' attached-top' : '') + (attachedBottom ? ' attached-bottom' : '')}
        style={!isMe ? { borderLeft: `2px solid ${color}` } : undefined}
        title={`packet !${m.id.toString(16).padStart(8, '0')} · ${new Date(m.rxTime * 1000).toLocaleString()}`}
      >
        {m._payload?.type === 'position' ? (
          <PositionCard p={m._payload} />
        ) : m._payload?.type === 'waypoint' ? (
          <WaypointCard p={m._payload} />
        ) : m._payload?.type === 'image' ? (
          <ImageCard p={m._payload} />
        ) : m._payload?.type === 'voice' ? (
          <VoiceCard bytes={m._payload.bytes} />
        ) : (
          <>
            {quoteText && (
              <div className="chat-quote">
                <span className="chat-quote-bar" />
                <span className="chat-quote-text">{quoteText}</span>
              </div>
            )}
            <div className="chat-text"><SmartText text={bodyText} /></div>
          </>
        )}
        {isLastInGroup && (
          <div className="chat-meta">
            {!isMe && m.rxRssi !== 0 && <span>{m.rxRssi} dBm</span>}
            {!isMe && m.rxSnr !== 0 && <span>SNR {m.rxSnr.toFixed(1)}</span>}
            {!isMe && m.hopStart > 0 && <span>hop {m.hopStart - m.hopLimit}/{m.hopStart}</span>}
            {m._chunkInfo && (
              <span
                className={'chunk-badge' + (m._chunkInfo.complete ? '' : ' partial')}
                title={
                  m._chunkInfo.complete
                    ? `Assembled from ${m._chunkInfo.total} chunks (${m._chunkInfo.bytes} bytes total on air)`
                    : `Receiving — ${m._chunkInfo.received} of ${m._chunkInfo.total} chunks have arrived`
                }
              >
                {m._chunkInfo.complete
                  ? `${m._chunkInfo.total} chunks · ${m._chunkInfo.bytes} B`
                  : `${m._chunkInfo.received}/${m._chunkInfo.total} chunks`}
              </span>
            )}
            {m._compression && (
              <span
                className="compress-badge"
                title={`Compressed with DEFLATE — sent ${m._compression.wireBytes} B over the air, decompressed to ${m._compression.decompressedBytes} B of plain text (${Math.round((1 - m._compression.wireBytes / m._compression.decompressedBytes) * 100)}% smaller)`}
              >
                deflate −{Math.round((1 - m._compression.wireBytes / m._compression.decompressedBytes) * 100)}%
              </span>
            )}
            {isMe && ack === 'pending' && <span className="ack ack-pending">… pending</span>}
            {isMe && ack === 'acked' && (() => {
              // What "delivered" actually means depends on who sent the
              // Routing ack: only an ack from the destination is real
              // proof of receipt. Anything else is a relay's implicit ack.
              const ackFrom = m.ackFromNode;
              const isBroadcast = m.to === 0xffffffff;
              if (isBroadcast) {
                return (
                  <span
                    className="ack ack-acked"
                    style={{ color: 'var(--warn)' }}
                    title="A neighbour retransmitted your broadcast — proof at least one node heard you. Broadcasts have no per-recipient ack, so 'who received it' can only be confirmed by their reply."
                  >
                    ✓ relayed
                  </span>
                );
              }
              if (ackFrom !== undefined && ackFrom === m.to) {
                return (
                  <span
                    className="ack ack-acked"
                    title={`Routing ack came from the destination (!${(ackFrom >>> 0).toString(16).padStart(8, '0')}). High confidence the recipient decoded your message.`}
                  >
                    ✓ delivered
                  </span>
                );
              }
              if (ackFrom !== undefined) {
                return (
                  <span
                    className="ack ack-acked"
                    style={{ color: 'var(--warn)' }}
                    title={`A relay (!${(ackFrom >>> 0).toString(16).padStart(8, '0')}), NOT the destination, sent the routing ack. The packet made it that far but the destination's decode is unconfirmed. See Learn → Acks & Asymmetry.`}
                  >
                    ✓ acked by relay
                  </span>
                );
              }
              return (
                <span
                  className="ack ack-acked"
                  style={{ color: 'var(--warn)' }}
                  title="Routing ack received but we don't know which node sent it. Could be the destination, could be a relay."
                >
                  ✓ acked
                </span>
              );
            })()}
            {isMe && failed && (
              <span className="ack ack-failed">✗ {failure?.label ?? 'failed'}</span>
            )}
            {isMe && failed && <button className="resend-btn" onClick={() => onResend(m)}>resend</button>}
            {isMe && (
              <button
                className="flow-toggle"
                onClick={() => setShowFlow((v) => !v)}
                title="Show or hide the per-step delivery flow (sent → echo → relay → ack) for this message."
              >
                {showFlow ? '▲' : '▼'} flow
              </button>
            )}
            <button
              className="reply-btn"
              onClick={() => onReply(m)}
              title="Quote this message in your next reply"
            >
              reply
            </button>
          </div>
        )}
        {isMe && showFlow && <DeliveryFlow m={m} />}
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

/**
 * Per-message delivery flow shown inline under a chat bubble (instead of
 * forcing the user to jump to the Delivery panel for the same info). Pulls
 * the matching PacketTrace from the active connection and renders the
 * lifecycle events as a compact stepped list. Same data the Delivery panel
 * shows, just rendered in a chat-context style.
 */
function DeliveryFlow({ m }: { m: DisplayMessage }) {
  const { connections, activeConnId } = useMeshContext();
  const conn = connections.find((c) => c.connId === activeConnId);
  const trace = conn?.traces.find((t) => t.packetId === m.id);
  const sentAt = m.sentAt ?? m.rxTime * 1000;
  const fmtAbs = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: false });
  const fmtDelta = (ms: number) => {
    const ds = (ms - sentAt) / 1000;
    if (ds < 0) return '0.0s';
    if (ds < 60) return `+${ds.toFixed(1)}s`;
    return `+${Math.floor(ds / 60)}m${Math.round(ds % 60)}s`;
  };
  const myNum = conn?.state.myInfo?.myNodeNum;
  const peerName = (num?: number) => {
    if (num === undefined) return '?';
    if (num === myNum) return 'me';
    const n = conn?.nodes.find((x) => x.num === num);
    return n?.shortName || `!${(num >>> 0).toString(16).padStart(8, '0').slice(-4)}`;
  };
  const events = trace ? [...trace.events].sort((a, b) => a.ts - b.ts) : [];
  const isBroadcast = m.to === 0xffffffff || m.to === undefined;

  const echo = events.find((e) => e.kind === 'echo');
  const relays = events.filter((e) => e.kind === 'relay');
  const terminal = events.find((e) => e.kind === 'ack' || e.kind === 'nak' || e.kind === 'timeout');

  return (
    <div className="chat-flow">
      <div className="chat-flow-step chat-flow-ok">
        <span className="chat-flow-glyph">●</span>
        <span>sent over USB <span className="chat-flow-time">· {fmtAbs(sentAt)}</span></span>
      </div>
      {echo && (
        <div className="chat-flow-step chat-flow-ok">
          <span className="chat-flow-glyph">↑</span>
          <span>radio confirmed TX <span className="chat-flow-time">· {fmtDelta(echo.ts)}</span></span>
        </div>
      )}
      {relays.map((e, i) => (
        <div key={`relay-${i}`} className="chat-flow-step chat-flow-relay">
          <span className="chat-flow-glyph">↻</span>
          <span>
            relayed by <strong>{peerName(e.fromNode)}</strong>
            {e.snr !== undefined && e.snr !== 0 && <> · SNR {e.snr.toFixed(1)}</>}
            {e.rssi !== undefined && e.rssi !== 0 && <> · RSSI {e.rssi}</>}
            {e.hopStart !== undefined && e.hopLimit !== undefined && <> · hop {e.hopStart - e.hopLimit}/{e.hopStart}</>}
            <span className="chat-flow-time"> · {fmtDelta(e.ts)}</span>
          </span>
        </div>
      ))}
      {!isBroadcast && m.ackStatus === 'acked' && (() => {
        const isRelay = m.ackFromNode !== undefined && m.ackFromNode !== m.to;
        return (
          <div className={'chat-flow-step ' + (isRelay ? 'chat-flow-relay' : 'chat-flow-ok')}>
            <span className="chat-flow-glyph">✓</span>
            <span>
              {isRelay
                ? <>ack came from <strong>{peerName(m.ackFromNode)}</strong> (relay) — destination decode unconfirmed</>
                : <>ack from <strong>{peerName(m.ackFromNode ?? m.to)}</strong> (destination)</>}
              {terminal && <span className="chat-flow-time"> · {fmtDelta(terminal.ts)}</span>}
            </span>
          </div>
        );
      })()}
      {!isBroadcast && m.ackStatus === 'failed' && (
        <div className="chat-flow-step chat-flow-bad">
          <span className="chat-flow-glyph">✗</span>
          <span>
            {m.ackError === 3 ? 'no ack within 60s (timeout)' : `routing nak (code ${m.ackError ?? '?'})`}
            {terminal && <span className="chat-flow-time"> · {fmtDelta(terminal.ts)}</span>}
          </span>
        </div>
      )}
      {!isBroadcast && m.ackStatus === 'pending' && (
        <div className="chat-flow-step chat-flow-pending">
          <span className="chat-flow-glyph">⏳</span>
          <span>waiting for ack <span className="chat-flow-time">· times out at 60s</span></span>
        </div>
      )}
      {isBroadcast && (
        <div className="chat-flow-step chat-flow-pending">
          <span className="chat-flow-glyph">·</span>
          <span>broadcast — no per-recipient ack; relays above are implicit confirmation</span>
        </div>
      )}
    </div>
  );
}

function PositionCard({ p }: { p: PositionPayload }) {
  return (
    <div className="payload-card payload-card-position">
      <div className="payload-card-head">SHARED LOCATION</div>
      <div className="payload-card-body">
        <div className="payload-coord">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</div>
        {p.alt !== undefined && p.alt !== 0 && (
          <div className="payload-sub">altitude {p.alt} m</div>
        )}
        {p.caption && <div className="payload-caption">"{p.caption}"</div>}
      </div>
      <div className="payload-card-actions">
        <a
          className="payload-link"
          href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=14/${p.lat}/${p.lon}`}
          target="_blank"
          rel="noreferrer"
        >
          Open in OSM
        </a>
        <a
          className="payload-link"
          href={`https://maps.apple.com/?q=${p.lat},${p.lon}`}
          target="_blank"
          rel="noreferrer"
        >
          Apple Maps
        </a>
      </div>
    </div>
  );
}

function ImagePreviewBar({
  image, onSend, onCancel, sending, loraConfig,
}: {
  image: DitheredImage;
  onSend: () => void;
  onCancel: () => void;
  sending: boolean;
  loraConfig?: ConnectionState['loraConfig'];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const decoded = decodeOneBitImage(image.bytes);
    if (decoded) renderOneBitImage(c, decoded, 3);
  }, [image]);

  const wireBytes = image.bytes.length; // pre-base64 estimate
  const expectedChunks = Math.max(1, Math.ceil((wireBytes * 4 / 3 + 3) / 200));
  const airtimeSec = expectedChunks * estimateAirtimeSec(200, loraConfig?.modemPresetName, loraConfig?.spreadFactor, loraConfig?.bandwidth);

  return (
    <div className="image-preview-bar">
      <canvas ref={canvasRef} className="image-preview-canvas" />
      <div className="image-preview-meta">
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)' }}>
          {image.width}×{image.height} · {wireBytes} B raw
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-faint)' }}>
          ≈ {expectedChunks} chunk{expectedChunks === 1 ? '' : 's'} · ~{airtimeSec.toFixed(1)}s air
        </div>
      </div>
      <div className="image-preview-actions">
        <button className="primary" onClick={onSend} disabled={sending}>{sending ? 'Sending…' : 'Send image'}</button>
        <button className="ghost" onClick={onCancel} disabled={sending}>Cancel</button>
      </div>
    </div>
  );
}

function VoiceRecordingIndicator({
  elapsedMs, onStop, onCancel,
}: {
  elapsedMs: number;
  onStop: () => void;
  onCancel: () => void;
}) {
  const sec = (elapsedMs / 1000).toFixed(1);
  const max = (VOICE_MAX_MS / 1000).toFixed(0);
  return (
    <div className="voice-recording-bar">
      <span className="voice-recording-dot" />
      <div className="voice-recording-meta">
        <div className="voice-recording-label">RECORDING</div>
        <div className="voice-recording-time">{sec} s / {max} s max</div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="primary" onClick={onStop}>Stop &amp; preview</button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function VoicePreviewBar({
  clip, onSend, onCancel, sending, loraConfig,
}: {
  clip: VoiceClip;
  onSend: () => void;
  onCancel: () => void;
  sending: boolean;
  loraConfig?: ConnectionState['loraConfig'];
}) {
  const wireBytes = clip.audio.length + 3; // header
  const base64Bytes = Math.ceil(wireBytes * 4 / 3);
  const expectedChunks = Math.max(1, Math.ceil(base64Bytes / 200));
  const airtime = expectedChunks * estimateAirtimeSec(200, loraConfig?.modemPresetName, loraConfig?.spreadFactor, loraConfig?.bandwidth);
  const sec = (clip.durationMs / 1000).toFixed(1);

  // Empty / near-empty captures mean the mic never delivered data — almost
  // always a permission issue. Surface it up-front so the user doesn't send
  // silence and wonder why nobody can hear them.
  const looksEmpty = clip.audio.length < 200;

  return (
    <div className={'voice-preview-bar' + (looksEmpty ? ' voice-preview-empty' : '')}>
      <VoicePlayer bytes={clip.audio} mimeType={clip.mimeType} compact />
      <div className="voice-preview-meta">
        {looksEmpty ? (
          <>
            <div style={{ color: 'var(--bad)', fontSize: 12, fontWeight: 600 }}>
              No audio captured ({clip.audio.length} B)
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              Mic permission may be blocked. macOS: System Settings → Privacy &amp; Security → Microphone → enable "Electron". If Electron isn't listed, open Terminal and run <code>tccutil reset Microphone</code>, then quit and relaunch — the OS will prompt fresh.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)' }}>
              {sec}s · {wireBytes} B audio
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-faint)' }}>
              ≈ {expectedChunks} chunks · ~{airtime.toFixed(1)}s air
            </div>
          </>
        )}
      </div>
      <div className="voice-preview-actions">
        <button className="primary" onClick={onSend} disabled={sending || looksEmpty}>{sending ? 'Sending…' : 'Send voice'}</button>
        <button className="ghost" onClick={onCancel} disabled={sending}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Reusable play-or-pause button for an Opus-encoded clip. Owns the
 * <audio> element + object URL lifecycle.
 */
function VoicePlayer({ bytes, mimeType, compact = false }: { bytes: Uint8Array; mimeType: string; compact?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    // Cast through BlobPart — same TS strict-array-buffer dance we already
    // deal with in text-compress.ts.
    const blob = new Blob([bytes as BlobPart], { type: mimeType });
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const a = new Audio(url);
    audioRef.current = a;
    a.addEventListener('timeupdate', () => setProgress(a.currentTime));
    a.addEventListener('loadedmetadata', () => setDuration(a.duration));
    a.addEventListener('ended', () => { setPlaying(false); setProgress(0); });
    return () => {
      a.pause();
      audioRef.current = null;
      if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    };
  }, [bytes, mimeType]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else {
      a.currentTime = 0;
      a.play()
        .then(() => { setPlaying(true); console.log(`[voice] play() started, duration=${a.duration}, src bytes=${bytes.length}`); })
        .catch((err) => { console.error('[voice] play() rejected:', err.name, err.message); setPlaying(false); });
    }
  };

  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

  return (
    <div className={'voice-player' + (compact ? ' compact' : '')}>
      <button className="voice-play-btn" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="voice-player-bar">
        <div className="voice-player-fill" style={{ width: `${pct}%` }} />
      </div>
      {!compact && duration > 0 && (
        <span className="voice-player-time">{progress.toFixed(1)}s / {duration.toFixed(1)}s</span>
      )}
    </div>
  );
}

function VoiceCard({ bytes }: { bytes: Uint8Array }) {
  const clip = useMemo(() => unpackVoice(bytes), [bytes]);
  if (!clip) {
    return (
      <div className="payload-card payload-card-voice">
        <div className="payload-card-head">VOICE · invalid payload</div>
      </div>
    );
  }
  const sec = (clip.durationMs / 1000).toFixed(1);
  return (
    <div className="payload-card payload-card-voice">
      <div className="payload-card-head">VOICE · {sec}s · {bytes.length} B</div>
      <VoicePlayer bytes={clip.audio} mimeType={clip.mimeType} />
    </div>
  );
}

function ImageCard({ p }: { p: ImageStub }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const decoded = decodeOneBitImage(p.bytes);
    if (decoded) renderOneBitImage(c, decoded, 4);
  }, [p]);
  const decoded = decodeOneBitImage(p.bytes);
  return (
    <div className="payload-card payload-card-image">
      <div className="payload-card-head">IMAGE · {decoded ? `${decoded.width}×${decoded.height}` : 'invalid'} · {p.bytes.length} B</div>
      <canvas ref={canvasRef} className="image-card-canvas" />
    </div>
  );
}

function WaypointCard({ p }: { p: WaypointPayload }) {
  return (
    <div className="payload-card payload-card-waypoint">
      <div className="payload-card-head">WAYPOINT</div>
      <div className="payload-card-body">
        <div className="payload-name">{p.name}</div>
        <div className="payload-coord">{p.lat.toFixed(5)}, {p.lon.toFixed(5)}</div>
        {p.description && <div className="payload-caption">{p.description}</div>}
      </div>
      <div className="payload-card-actions">
        <a
          className="payload-link"
          href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=14/${p.lat}/${p.lon}`}
          target="_blank"
          rel="noreferrer"
        >
          Open in OSM
        </a>
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
                  {isMe && m.ackStatus && (() => {
                    const isBroadcast = m.to === 0xffffffff;
                    const ackLabel =
                      m.ackStatus === 'failed' ? (describeAckError(m.ackError)?.label ?? 'failed')
                      : m.ackStatus === 'acked'
                        ? (isBroadcast ? 'relayed'
                          : m.ackFromNode !== undefined && m.ackFromNode === m.to ? 'delivered'
                          : m.ackFromNode !== undefined ? 'acked by relay'
                          : 'acked')
                      : m.ackStatus;
                    return (
                      <span
                        className={`ack ack-${m.ackStatus}`}
                        title={m.ackStatus === 'failed'
                          ? describeAckError(m.ackError)?.explainer
                          : m.ackStatus === 'acked' && m.ackFromNode !== undefined && m.ackFromNode !== m.to && !isBroadcast
                            ? `Ack came from a relay (!${(m.ackFromNode >>> 0).toString(16).padStart(8, '0')}), not the destination. The packet got that far, but the destination's decode is unconfirmed.`
                            : undefined}
                      >
                        {ackGlyph(m.ackStatus)}{' '}{ackLabel}
                      </span>
                    );
                  })()}
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
  const connId = useActiveConnId();
  const [longName, setLongName] = useState('');
  const [shortName, setShortName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const isReady = state.status === 'ready';

  const apply = async () => {
    if (!longName.trim() || !shortName.trim() || !connId) return;
    setBusy(true); setMsg('');
    try {
      await window.mesh.setOwner({ connId, longName: longName.trim(), shortName: shortName.trim().slice(0, 4) });
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

        <ClearAllMessagesCard />
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

/**
 * Wipe-everything card on the Chat → Settings tab. Hits the DB and every
 * controller's in-memory list. No undo — confirms first. Auto-prune (30
 * days) also runs at app startup; this is the manual override.
 */
function ClearAllMessagesCard() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const onClick = async () => {
    if (!confirm('Wipe EVERY message from this app\'s local database?\n\n• Affects every conversation, every channel, every connected radio.\n• The radio\'s own message buffer (firmware-managed) is not touched.\n• No undo.')) return;
    setBusy(true); setMsg('');
    try {
      const n = await window.mesh.clearAllMessages();
      setMsg(`Removed ${n} message${n === 1 ? '' : 's'}.`);
    } catch (e: any) {
      setMsg('Error: ' + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="info-card" style={{ borderLeftColor: 'var(--bad)' }}>
      <p style={{ margin: '0 0 6px' }}><strong style={{ color: 'var(--bad)' }}>Clear all chat history</strong></p>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-dim)' }}>
        Deletes every message from the local SQLite store and every controller's in-memory list. The radio's firmware-side buffer is independent and not affected. Auto-prune drops messages older than 30 days on app startup; this button is the manual nuke.
      </p>
      <button className="ghost" onClick={onClick} disabled={busy} style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
        {busy ? 'Clearing…' : 'Clear all messages'}
      </button>
      {msg && <span style={{ marginLeft: 10, fontSize: 12, color: msg.startsWith('Error') ? 'var(--bad)' : 'var(--good)' }}>{msg}</span>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Help tab — how chat works + canned-messages editor
// ────────────────────────────────────────────────────────────────────

function HelpView({ canned, updateCanned }: { canned: string[]; updateCanned: (next: string[]) => void }) {
  const [editing, setEditing] = useState<string[]>(canned);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setEditing(canned); setDirty(false); }, [canned]);

  const update = (i: number, v: string) => { setEditing((arr) => arr.map((x, idx) => idx === i ? v : x)); setDirty(true); };
  const remove = (i: number) => { setEditing((arr) => arr.filter((_, idx) => idx !== i)); setDirty(true); };
  const add = () => { setEditing((arr) => [...arr, '']); setDirty(true); };
  const move = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= editing.length) return;
    setEditing((arr) => {
      const next = arr.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  };
  const save = () => { updateCanned(editing.filter((s) => s.trim().length > 0)); setDirty(false); };
  const reset = () => { updateCanned(resetCanned()); setDirty(false); };

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>How chat works over LoRa</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 13 }}>
            Each chat message is a Meshtastic <code>TEXT_MESSAGE_APP</code> packet. It carries:
            an 8-bit channel hash so receivers pick the right decryption key, an encrypted payload
            (up to ~230 bytes), and routing fields (from, to, hop counter, packet id, want-ack).
            On the air it spends anywhere from ~30 ms to several seconds depending on the LoRa preset
            and message length.
          </p>
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 13 }}>
            Two radios "talk" if their channel <strong>name + PSK</strong> match (yielding the same
            channel hash), they're on the same region + modem preset, and they're physically in range
            (or there's a relay between them). The Compare Radios panel checks all of that for you.
          </p>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Channel vs DM</h3>
          <dl className="kv kv-tight">
            <dt>Channel</dt><dd>Broadcast to everyone with the matching channel name + PSK. Fire-and-forget — no per-recipient ack. Like a CB radio channel.</dd>
            <dt>DM</dt><dd>Addressed to a specific node. Mesh requests a routing ack from the destination; the dot beside your message turns green when it returns. Newer firmware uses public-key crypto (PKI) for DMs and may drop them if it doesn't have the destination's pubkey.</dd>
          </dl>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>ACK status legend</h3>
          <dl className="kv kv-tight">
            <dt><span className="ack ack-pending">…</span></dt><dd>In flight. Waiting up to 60 s for the destination's routing ack.</dd>
            <dt><span className="ack ack-acked">✓</span></dt><dd>Delivered. Some node (destination or a relay near it) confirmed receipt.</dd>
            <dt><span className="ack ack-failed">✗</span></dt><dd>Failed. The ack didn't come back or the mesh returned a Routing.Error. Common codes: 3=TIMEOUT, 4=NO_INTERFACE, 6=BAD_REQUEST, 32=NO_RESPONSE.</dd>
          </dl>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Why messages may not arrive</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.55 }}>
            <li><strong>Config mismatch</strong>: region, preset, channel #, name, or PSK differs. <em>Open Compare Radios.</em></li>
            <li><strong>Out of range or blocked</strong>: LoRa goes far but not through buildings well. <em>Open Coverage / Link Budget.</em></li>
            <li><strong>Recipient asleep</strong>: nodes with aggressive power saving may miss packets. The keyboard/screen wakes the radio but it can still miss what arrived during sleep.</li>
            <li><strong>Duty cycle hit</strong>: some regions cap to 1% airtime/hour. A flood of long messages can queue locally.</li>
            <li><strong>PKI key missing for DM</strong>: newer firmware drops DMs to unknown pubkeys. Send a broadcast on the primary channel as a workaround.</li>
            <li><strong>T-Deck screen quirk</strong>: the message may be in the radio but not on the display. Cycle screens via the trackball/button.</li>
          </ul>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Airtime &amp; duty cycle</h3>
          <p style={{ margin: '0 0 8px', color: 'var(--text-dim)', fontSize: 13 }}>
            LoRa is a narrowband mode. A 50-byte message takes about 1 s on <em>LongFast</em>, ~5 s on <em>LongSlow</em>.
            EU regions cap radios to ~36 s of airtime per hour (1% duty cycle). The compose box
            shows live airtime and the share of your 1-hour duty budget so you can spot accidental
            spam.
          </p>
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 13 }}>
            <strong>Tips to fit more in less air:</strong> use radio-operator shorthand (QSL, 73,
            ETA, ROGER), keep messages under 50 bytes when possible, prefer broadcasts to channel
            for group chatter (no per-message acks), and use canned messages for repeat phrases.
          </p>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Bandwidth tricks the app does automatically</h3>
          <dl className="kv kv-tight">
            <dt>Multi-packet chunking</dt><dd>Anything over ~230 bytes is split into chunks with a small reassembly header and sent sequentially. The receiver shows it as one bubble with a <span className="chunk-badge">N chunks · X B</span> tag.</dd>
            <dt>DEFLATE compression</dt><dd>Messages over 80 bytes are tried with DEFLATE + base64 before sending; if the result is smaller than the raw text, it goes on the wire and the receiver auto-inflates. Saves 15–30% on typical English chat. Bubble shows <span className="compress-badge">deflate −22%</span> when it kicks in.</dd>
            <dt>Typed payloads</dt><dd>Beyond text, the app can ride any structured content through the same chunk + compress pipeline. Each payload starts with a 1-byte content-type marker:
              <code> \x01P|</code> position, <code>\x01I|</code> image, <code>\x01V|</code> voice, <code>\x01W|</code> waypoint, <code>\x01G|</code> GPX track. Position, image, and voice are wired in today — waypoint and GPX are stubs ready to be filled in.</dd>
            <dt>Voice messages</dt><dd>Hold-to-record up to 8 seconds; encoded with Opus at 6 kbps. A 3-second clip ≈ 2 KB ≈ 10 chunks (~10 s airtime on LongFast). A future swap to Codec2 (700 bps) would reduce that ~6×; the pipeline is identical so it's a one-file replacement.</dd>
            <dt>UTF-8-aware splitting</dt><dd>Chunks never break a multi-byte codepoint in half. Emoji and accented characters survive transit.</dd>
            <dt>Compatibility</dt><dd>Stock Meshtastic clients (T-Deck, official app) see the raw markers as text gibberish — they can't reassemble or decode typed payloads. This is openkb-mesh-internet-only on both ends.</dd>
          </dl>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Keyboard shortcuts</h3>
          <table className="data" style={{ fontSize: 12.5 }}>
            <tbody>
              <tr><td style={{ fontFamily: 'var(--mono)' }}>Enter</td><td>Send the current draft</td></tr>
              <tr><td style={{ fontFamily: 'var(--mono)' }}>Shift + Enter</td><td>Newline within the draft</td></tr>
              <tr><td style={{ fontFamily: 'var(--mono)' }}>⌘ / Ctrl + 1–9</td><td>Send the matching quick message immediately</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Slash commands</h3>
          <p style={{ margin: '0 0 8px', color: 'var(--text-dim)', fontSize: 12.5 }}>
            Type a command starting with <code>/</code> in the compose box.
          </p>
          <table className="data" style={{ fontSize: 12.5 }}>
            <tbody>
              <tr><td style={{ fontFamily: 'var(--mono)' }}>/me {'<action>'}</td><td>"* {'<your shortName>'} {'<action>'}" — IRC-style action message.</td></tr>
              <tr><td style={{ fontFamily: 'var(--mono)' }}>/position or /pos</td><td>Share your current GPS position as a typed payload.</td></tr>
              <tr><td style={{ fontFamily: 'var(--mono)' }}>/help</td><td>Jump to this Help tab.</td></tr>
              <tr><td style={{ fontFamily: 'var(--mono)' }}>/shortcodes</td><td>Show the emoji shortcode list (this tab).</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Emoji shortcodes</h3>
          <p style={{ margin: '0 0 8px', color: 'var(--text-dim)', fontSize: 12.5 }}>
            Type a shortcode like <code>:tu:</code> and it auto-expands to the emoji on send. Useful when typing on a hardware keyboard (T-Deck) that doesn't have emoji input.
          </p>
          <div className="shortcode-grid">
            {listShortcodes().map(({ code, emoji }) => (
              <div key={code} className="shortcode-item">
                <span className="shortcode-emoji">{emoji}</span>
                <code className="shortcode-code">{code}</code>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Phrase macros</h3>
          <p style={{ margin: '0 0 8px', color: 'var(--text-dim)', fontSize: 12.5 }}>
            Short forms that expand to longer phrases when sent. Save typing on a small keyboard.
          </p>
          <table className="data" style={{ fontSize: 12.5 }}>
            <tbody>
              <tr><td style={{ fontFamily: 'var(--mono)' }}>:eta {'<n>'}:</td><td>→ "ETA {'<n>'} min"</td></tr>
              <tr><td style={{ fontFamily: 'var(--mono)' }}>:in {'<n>'}:</td><td>→ "In {'<n>'} min"</td></tr>
              <tr><td style={{ fontFamily: 'var(--mono)' }}>:at {'<place>'}:</td><td>→ "At {'<place>'}"</td></tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Inline smart rendering</h3>
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12.5 }}>
            Plain-text messages automatically detect and enhance:
          </p>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-dim)', fontSize: 12.5, lineHeight: 1.55 }}>
            <li><strong>Coordinates</strong>: any "lat, lon" pair (e.g. <code>37.123, -121.456</code>) renders as a clickable chip that opens OpenStreetMap.</li>
            <li><strong>URLs</strong>: http(s) links open in your browser. Stays plain text on the wire — no expansion cost.</li>
          </ul>
        </div>
      </div>

      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Quick messages</h2>
          <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12.5 }}>
            Edit your canned message list. The first 9 are bound to <code>⌘/Ctrl + 1–9</code> for one-keystroke
            sending. Use radio shorthand to fit a lot of meaning into few bytes.
          </p>
          <div className="canned-editor">
            {editing.map((msg, i) => (
              <div key={i} className="canned-row">
                <span className="canned-row-idx">{i + 1}</span>
                <input
                  className="text"
                  value={msg}
                  maxLength={HARD_BYTE_LIMIT}
                  onChange={(e) => update(i, e.target.value)}
                  placeholder="(empty)"
                />
                <button className="ghost canned-row-btn" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
                <button className="ghost canned-row-btn" onClick={() => move(i, 1)} disabled={i === editing.length - 1} title="Move down">↓</button>
                <button className="ghost canned-row-btn" onClick={() => remove(i)} title="Delete">✕</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
            <button className="ghost" onClick={add}>+ Add message</button>
            <button className="primary" onClick={save} disabled={!dirty}>Save</button>
            <button className="ghost" onClick={reset} style={{ marginLeft: 'auto', color: 'var(--text-faint)' }} title="Restore the default set of canned messages">Reset to defaults</button>
          </div>
          {dirty && <p style={{ marginTop: 6, fontSize: 11, color: 'var(--warn)' }}>Unsaved changes</p>}
        </div>

        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Why canned messages?</strong> Typing on a T-Deck keyboard or finding a radio while moving is awkward. Pre-canned text lets you send a useful update with one tap. Common operator phrases (QSL, 73, ROGER, ETA) also fit in fewer bytes than full English sentences.</p>
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

/**
 * Live verification that "the radio actually transmitted my message and another
 * connected radio physically received it on RF". Watches every OTHER connected
 * radio's recentPackets for a packet matching the most recent outgoing message
 * in this conversation. Hard proof — no inference, no acks, just "did the bytes
 * cross the air?".
 *
 * If the user has only one radio connected, we can't independently verify and
 * the probe collapses to a hint.
 */
function DeliveryProbe({
  filtered, myNum, effective,
}: {
  filtered: TextMessage[];
  myNum: number;
  effective: ChatTarget | null;
}) {
  const { connections, activeConnId } = useMeshContext();
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const lastMine = useMemo(() => {
    // Most recent message we sent on this conversation
    for (let i = filtered.length - 1; i >= 0; i--) {
      if (filtered[i].from === myNum) return filtered[i];
    }
    return null;
  }, [filtered, myNum]);

  // Pull the per-packet trace for this send if we have one. The controller
  // records every lifecycle event — sent / echo / relay / ack / nak / timeout —
  // with millisecond timestamps, which lets us render an actual timeline
  // instead of just "did the radio say it acked?".
  const activeConn = connections.find((c) => c.connId === activeConnId);
  const trace = lastMine ? activeConn?.traces.find((t) => t.packetId === lastMine.id) : undefined;

  if (!lastMine || !effective) return null;

  const others = connections.filter((c) => c.connId !== activeConnId && c.state.status === 'ready');
  const sentAt = lastMine.sentAt ?? lastMine.rxTime * 1000;
  const sinceSec = Math.max(0, (Date.now() - sentAt) / 1000);
  const isBroadcast = lastMine.to === 0xffffffff || lastMine.to === undefined;
  const fmtAbs = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: false });
  const fmtDelta = (ms: number) => {
    const ds = (ms - sentAt) / 1000;
    if (ds < 0) return '0.0s';
    if (ds < 60) return `+${ds.toFixed(1)}s`;
    return `+${Math.floor(ds / 60)}m${Math.round(ds % 60)}s`;
  };
  const nodeName = (num?: number) => {
    if (num === undefined) return '';
    const me = num === myNum;
    if (me) return 'your radio';
    const n = activeConn?.nodes.find((x) => x.num === num);
    return n?.shortName || `!${(num >>> 0).toString(16).padStart(8, '0').slice(-4)}`;
  };

  // Re-send the same text with a fresh packetId. Meshtastic firmware
  // already retries a wantAck packet internally a few times before giving
  // up, so a manual retry generally only helps if the previous attempt
  // hit the 60s app-side timeout, or if conditions have actually changed
  // (different antenna, different position, fresh window of channel time).
  const onRetry = async () => {
    if (!activeConnId) return;
    await window.mesh.sendText({
      connId: activeConnId,
      text: lastMine.text,
      to: isBroadcast ? undefined : lastMine.to,
      channel: lastMine.channel,
      wantAck: !isBroadcast,
    });
  };

  // For each "other" radio, two independent checks:
  // (1) Did its raw RX stream show our packet? (proves the radio decoded it off the air)
  // (2) Did the firmware also store it in the messages buffer? (proves the firmware
  //     considered it a real chat message — not e.g. dropped due to PKI key issues)
  const findings = others.map((c) => {
    const my = c.state.myInfo?.myNodeNum;
    const cName = (my ? c.nodes.find((n) => n.num === my) : undefined)?.shortName || c.portPath?.split('/').pop() || c.connId;
    const match = c.recentPackets.find((p) =>
      p.id === lastMine.id && p.from === lastMine.from && !p.viaMqtt,
    );
    const inMessages = c.messages.find((m) =>
      m.id === lastMine.id && m.from === lastMine.from,
    );
    return { connId: c.connId, name: cName, match, inMessages };
  });

  // Pull the timeline events from the trace, sorted oldest → newest. If
  // we have no trace yet, we synthesise just a "sent" entry so the UI
  // still tells the user *something* happened.
  const traceEvents = trace ? [...trace.events].sort((a, b) => a.ts - b.ts) : [];

  return (
    <div className="chat-probe">
      <div className="chat-probe-label" style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span>DELIVERY PROBE</span>
        <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          packet <code>!{(lastMine.id >>> 0).toString(16).padStart(8, '0').slice(-4)}</code> · sent {fmtAbs(sentAt)} · {sinceSec.toFixed(0)}s ago
        </span>
        {lastMine.ackStatus === 'failed' && !isBroadcast && (
          <button
            className="ghost"
            style={{ padding: '2px 10px', fontSize: 11, marginLeft: 'auto' }}
            onClick={onRetry}
            title="Re-send the same text with a fresh packet id. Use this when conditions may have changed (you moved, plugged in an antenna, the other node just rebooted) — Meshtastic firmware already retries internally up to a few times before reporting failure to us."
          >
            ↻ Retry
          </button>
        )}
      </div>
      <div className="chat-probe-body">

        {/* Step 1: Sent over USB. Always succeeds if we have a packet id. */}
        <div className="chat-probe-row">
          <span className="chat-probe-step ok">✓</span>
          <div>
            <div>
              Sent to radio (over USB) <span style={{ color: 'var(--text-faint)' }}>· {fmtAbs(sentAt)}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
              Why this matters · the app framed your text and wrote it to the serial port. From here the radio owns it — if anything fails later, it's RF, not USB.
            </div>
          </div>
        </div>

        {/* Echo — radio confirmed it transmitted */}
        {traceEvents.filter((e) => e.kind === 'echo').slice(0, 1).map((e, i) => (
          <div key={`echo-${i}`} className="chat-probe-row">
            <span className="chat-probe-step ok">↑</span>
            <div>
              <div>
                Your radio echoed the packet back <span style={{ color: 'var(--text-faint)' }}>· {fmtDelta(e.ts)}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                Why this matters · the firmware reported it transmitted on RF. Without an echo (and no later events), the radio queued the packet but never sent it — often duty-cycle throttling, TX disabled, or deep sleep.
              </div>
            </div>
          </div>
        ))}

        {/* Relay events — other nodes forwarding our packet */}
        {traceEvents.filter((e) => e.kind === 'relay').map((e, i) => (
          <div key={`relay-${i}`} className="chat-probe-row">
            <span className="chat-probe-step pending" style={{ color: 'var(--warn)' }}>↻</span>
            <div>
              <div>
                Relayed by <strong>{nodeName(e.fromNode)}</strong>
                {e.rssi !== undefined && e.rssi !== 0 && <> · RSSI {e.rssi} dBm</>}
                {e.snr !== undefined && e.snr !== 0 && <> · SNR {e.snr.toFixed(1)}</>}
                {e.hopStart !== undefined && e.hopLimit !== undefined && <> · hop {e.hopStart - e.hopLimit}/{e.hopStart}</>}
                <span style={{ color: 'var(--text-faint)' }}> · {fmtDelta(e.ts)}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                Why this matters · this is the "implicit ack" you'd hear on a broadcast — proof at least one neighbour decoded you and forwarded. It does <em>not</em> mean the destination got it; relays don't know what happens past their own retransmission.
              </div>
            </div>
          </div>
        ))}

        {/* Ack / Nak / Timeout — the terminal event for a DM */}
        {!isBroadcast && (() => {
          const acked = lastMine.ackStatus === 'acked';
          const failed = lastMine.ackStatus === 'failed';
          const isTimeout = failed && lastMine.ackError === 3;
          const terminal = traceEvents.find((e) => e.kind === 'ack' || e.kind === 'nak' || e.kind === 'timeout');
          if (acked) {
            return (
              <div className="chat-probe-row">
                <span className="chat-probe-step ok">✓</span>
                <div>
                  <div>
                    Routing ack
                    {terminal?.fromNode !== undefined && <> from <strong>{nodeName(terminal.fromNode)}</strong></>}
                    {terminal?.rssi !== undefined && terminal.rssi !== 0 && <> · RSSI {terminal.rssi} dBm</>}
                    {terminal?.snr !== undefined && terminal.snr !== 0 && <> · SNR {terminal.snr.toFixed(1)}</>}
                    {terminal && <span style={{ color: 'var(--text-faint)' }}> · {fmtDelta(terminal.ts)}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                    Why this matters · someone in the routing path replied <code>errorReason=NONE</code>. For DMs this usually means the destination decoded the payload — but some firmware versions let a relay closer to the destination ack on its behalf. If you never see this node broadcast back, the "ack" was probably a relay's implicit ack. See <em>Learn → Acks &amp; Asymmetry</em>.
                  </div>
                </div>
              </div>
            );
          }
          if (failed) {
            const reason = isTimeout
              ? 'No ack within 60 seconds (TIMEOUT)'
              : `Routing.Error code ${lastMine.ackError ?? '?'}`;
            const whyTimeout = 'Why this matters · either no path to the destination exists, or a path exists one-way (you reach them, but their ack can\'t reach you). The firmware already retried a few times internally before reporting this. Try a Traceroute to see how far the packet actually got, or check Acks & Asymmetry for the one-way-link case.';
            const whyNak = `Why this matters · the mesh routing layer rejected this. Common codes: 1=NO_ROUTE (the destination isn't reachable), 2=NO_INTERFACE, 3=TIMEOUT, 4=MAX_RETRANSMIT, 5=NO_CHANNEL, 6=TOO_LARGE, 8=BAD_REQUEST, 32=NOT_AUTHORIZED.`;
            return (
              <div className="chat-probe-row">
                <span className="chat-probe-step bad">✗</span>
                <div>
                  <div>
                    {reason}
                    {terminal && <span style={{ color: 'var(--text-faint)' }}> · {fmtDelta(terminal.ts)}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                    {isTimeout ? whyTimeout : whyNak}
                  </div>
                </div>
              </div>
            );
          }
          // Still pending
          return (
            <div className="chat-probe-row">
              <span className="chat-probe-step pending">⏳</span>
              <div>
                <div>
                  Waiting for routing ack <span style={{ color: 'var(--text-faint)' }}>· {sinceSec.toFixed(0)}s elapsed · times out at 60s</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                  Why this matters · the firmware is waiting for a Routing-app reply addressed to this packet id. Acks travel back through the same mesh — every hop they cross is another chance to be lost. Inside ~30s on a small mesh is normal; pending past 30s usually means trouble.
                </div>
              </div>
            </div>
          );
        })()}

        {isBroadcast && (
          <div className="chat-probe-row">
            <span className="chat-probe-step pending" style={{ color: 'var(--text-faint)' }}>·</span>
            <div>
              <div>Broadcast — no per-recipient ack</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                Why this matters · broadcasts are fire-and-forget. The firmware listens for someone else retransmitting the same packet (the "implicit ack" / relay events above) as a proxy for "at least one neighbour heard it". To verify it actually crossed the air, see the cross-radio rows below.
              </div>
            </div>
          </div>
        )}

        {others.length === 0 ? (
          <div className="chat-probe-row">
            <span className="chat-probe-step pending">·</span>
            <span style={{ color: 'var(--text-faint)' }}>
              No second radio is connected. Plug in another USB radio (Connect → + Add another radio) to verify packets actually cross the airwaves.
            </span>
          </div>
        ) : (
          findings.flatMap((f) => [
            <div key={f.connId + '-rf'} className="chat-probe-row">
              <span className={'chat-probe-step ' + (f.match ? 'ok' : sinceSec > 30 ? 'bad' : 'pending')}>
                {f.match ? '✓' : sinceSec > 30 ? '✗' : '⏳'}
              </span>
              <span>
                {f.match ? (
                  <>
                    <strong>{f.name}</strong>'s radio decoded it off the air after {((f.match.receivedAt - (lastMine.sentAt ?? lastMine.rxTime * 1000)) / 1000).toFixed(1)}s
                    {f.match.rxRssi !== 0 && <> · RSSI <strong>{f.match.rxRssi}</strong> dBm</>}
                    {f.match.rxSnr !== 0 && <> · SNR <strong>{f.match.rxSnr.toFixed(1)}</strong></>}
                    {f.match.hopStart > 0 && <> · hop <strong>{f.match.hopStart - f.match.hopLimit}/{f.match.hopStart}</strong></>}
                  </>
                ) : sinceSec > 30 ? (
                  <><strong>{f.name}</strong> did NOT receive this packet on RF in 30s. The radios are not talking even though configs match — check antenna, range, or one of them in deep sleep.</>
                ) : (
                  <>Waiting for <strong>{f.name}</strong> to receive on RF… ({sinceSec.toFixed(0)}s)</>
                )}
              </span>
            </div>,
            <div key={f.connId + '-msgs'} className="chat-probe-row">
              <span className={'chat-probe-step ' + (f.inMessages ? 'ok' : f.match && sinceSec > 5 ? 'bad' : 'pending')}>
                {f.inMessages ? '✓' : f.match && sinceSec > 5 ? '✗' : '⏳'}
              </span>
              <span>
                {f.inMessages ? (
                  <><strong>{f.name}</strong>'s firmware stored it in its messages buffer — proof the radio considers this a valid chat message it would display. If the T-Deck screen still isn't showing it, that's a firmware UI bug, not a delivery problem.</>
                ) : f.match && sinceSec > 5 ? (
                  <><strong>{f.name}</strong> received the RF packet but did NOT add it to its messages buffer. Likely a PKI key issue (DM-only) or a corrupted text-decode. Try a broadcast on slot 0 instead of a DM.</>
                ) : (
                  <>Waiting for <strong>{f.name}</strong>'s firmware to register the message…</>
                )}
              </span>
            </div>,
          ])
        )}
      </div>
    </div>
  );
}
