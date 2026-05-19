import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMeshContext } from '../../hooks/MeshContext';
import type { ConnectionView } from '../../hooks/useMesh';
import {
  emptyInsights,
  foldLines,
  BOOT_PHASE_ORDER,
  BOOT_PHASE_LABELS,
  BOOT_PHASE_HINTS,
  type DeviceInsights,
  type BootPhase,
  type CrashRecord,
} from '../../lib/parse-device-log';

const MAX_LOG_LINES = 2000;
const MAX_EVENT_LINES = 200;

type LogEntry = {
  at: number;
  direction: 'rx' | 'tx';
  /** Plain-text version of the line (for search / CSV / copy). */
  text: string;
  /** ANSI-coloured segments for rendering. */
  segments: AnsiSegment[];
  /** Raw bytes for this line; hex view is derived from this. */
  rawHead: Uint8Array;
  bytes: number;
  /** Number of raw USB chunks that fed into this line (often 1, sometimes
   *  more when a single log line gets split across reads). */
  chunks: number;
};

const RAW_HEAD_CAP = 256;
/** If a partial line sits in the buffer with no newline arriving, flush
 *  it after this many ms. Binary protobuf frames have no newlines, so
 *  this is what makes them appear at all. */
const PARTIAL_FLUSH_MS = 200;
/** Hard cap on a single buffered "line" — protects against pathological
 *  firmware output that never sends a newline. */
const LINE_BYTE_CAP = 4096;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Meshtastic firmware emits coloured log output via standard ANSI SGR
// escapes — DEBUG cyan/blue, INFO green, WARN yellow, ERROR red, etc.
// We parse those out into typed segments so the renderer can show them
// as actual colours, plus produce a plain-text version for copy/CSV.
const ANSI_CSI_RE = /\x1b\[([0-9;?]*)([a-zA-Z])/g;
// Standard SGR foreground colours mapped to readable hues for our dark theme.
const ANSI_FG: Record<number, string> = {
  30: '#7a828f', // black -> grey (would be invisible on dark bg otherwise)
  31: '#ff6b81', // red
  32: '#66d39a', // green
  33: '#ffd166', // yellow
  34: '#5cc8ff', // blue
  35: '#b88aff', // magenta
  36: '#5fd0d7', // cyan
  37: '#e6e8ee', // white
  90: '#9aa3b2', 91: '#ff6b81', 92: '#66d39a', 93: '#ffd166',
  94: '#5cc8ff', 95: '#b88aff', 96: '#5fd0d7', 97: '#ffffff',
};

export interface AnsiSegment {
  text: string;
  color?: string;
  bold?: boolean;
}

/**
 * Decode bytes into ANSI-aware segments. Non-printable bytes become
 * a faint dot so binary protobuf frames still show their rough shape.
 * Newlines, tabs, and CR are preserved (with CR dropped, like a normal
 * terminal). ESC sequences drive the colour state machine.
 */
function bytesToSegments(u8: Uint8Array): AnsiSegment[] {
  // Phase 1: build a printable string keeping ESC bytes so the regex
  // can match whole CSI sequences.
  let raw = '';
  for (let i = 0; i < u8.length; i++) {
    const c = u8[i];
    if (c === 0x0a) raw += '\n';
    else if (c === 0x0d) continue;
    else if (c === 0x09) raw += '\t';
    else if (c === 0x1b) raw += '\x1b';
    else if (c < 0x20 || c > 0x7e) raw += '·';
    else raw += String.fromCharCode(c);
  }
  // Phase 2: walk the string, splitting on CSI matches and accumulating
  // segments under the current SGR state.
  const segments: AnsiSegment[] = [];
  let cursor = 0;
  let color: string | undefined;
  let bold = false;
  ANSI_CSI_RE.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = ANSI_CSI_RE.exec(raw)); ) {
    const before = raw.slice(cursor, m.index);
    if (before) segments.push({ text: before, color, bold });
    cursor = m.index + m[0].length;
    if (m[2] !== 'm') continue; // non-SGR (cursor moves etc.) — just drop
    const params = m[1].split(';').filter((s) => s.length > 0).map((s) => parseInt(s, 10));
    if (params.length === 0) { color = undefined; bold = false; continue; }
    for (const p of params) {
      if (p === 0)      { color = undefined; bold = false; }
      else if (p === 1) bold = true;
      else if (p === 22) bold = false;
      else if (p === 39) color = undefined;
      else if (ANSI_FG[p]) color = ANSI_FG[p];
    }
  }
  if (cursor < raw.length) segments.push({ text: raw.slice(cursor), color, bold });
  return segments;
}

/** Join ANSI segments into the same plain-text form bytesToPrintable
 *  used to return — for hex-mode toggle, CSV export, search, etc. */
function segmentsToPlain(segs: AnsiSegment[]): string {
  return segs.map((s) => s.text).join('');
}

function bytesToHex(u8: Uint8Array, max = 32): string {
  const parts: string[] = [];
  const n = Math.min(u8.length, max);
  for (let i = 0; i < n; i++) parts.push(u8[i].toString(16).padStart(2, '0'));
  return parts.join(' ') + (u8.length > max ? ` …(+${u8.length - max}b)` : '');
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function ago(ms: number | null): string {
  if (!ms) return '—';
  const d = Math.max(0, Date.now() - ms);
  if (d < 1000) return 'now';
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  return `${Math.floor(d / 3_600_000)}h ago`;
}

function chipFamilyFromHwModel(hwName?: string): 'esp32' | 'esp32-s3' | 'nrf52' | 'rp2040' | 'unknown' {
  if (!hwName) return 'unknown';
  const n = hwName.toLowerCase();
  if (n.includes('s3') || n.includes('t-deck') || n.includes('heltec_v3') || n.includes('station_g2')) return 'esp32-s3';
  if (n.includes('t1000') || n.includes('rak4631') || n.includes('t-echo') || n.includes('nrf52')) return 'nrf52';
  if (n.includes('rp2040') || n.includes('rak11200')) return 'rp2040';
  if (n.includes('tlora') || n.includes('heltec') || n.includes('t-beam') || n.includes('esp32')) return 'esp32';
  return 'unknown';
}

export function DeviceLabPanel() {
  const { connections, activeConnId, setActiveConnId } = useMeshContext();
  const active = useMemo(() => connections.find((c) => c.connId === activeConnId) ?? connections[0] ?? null, [connections, activeConnId]);

  const [log, setLog] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<SerialEvent[]>([]);
  const [stats, setStats] = useState<PortStats | null>(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<'all' | 'rx' | 'tx'>('all');
  const [hexMode, setHexMode] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [insights, setInsights] = useState<DeviceInsights>(emptyInsights);
  const logRef = useRef<HTMLDivElement | null>(null);
  const autoscroll = useRef(true);
  // Per-direction line buffer. Raw bytes accumulate until we see a newline
  // (printable firmware output) or the partial-flush timer fires (binary
  // protobuf frames, partial trailers). Each emitted log row corresponds
  // to one logical line, with ANSI escape sequences reassembled across
  // chunk boundaries before parsing.
  type LineBuf = { bytes: Uint8Array; ts: number; chunks: number; timer: any };
  const rxBuf = useRef<LineBuf>({ bytes: new Uint8Array(0), ts: 0, chunks: 0, timer: null });
  const txBuf = useRef<LineBuf>({ bytes: new Uint8Array(0), ts: 0, chunks: 0, timer: null });
  // Carry-over for the boot/crash text parser (different concern from the
  // rendering line buffer — kept as plain text since insights only cares
  // about decoded lines).
  const insightsCarry = useRef('');

  // Stream raw bytes and structured events for the currently-active radio.
  useEffect(() => {
    if (!active) return;

    const emitEntry = (direction: 'rx' | 'tx', bytes: Uint8Array, at: number, chunks: number) => {
      const segments = bytesToSegments(bytes);
      const text = segmentsToPlain(segments).replace(/\n+$/, '');
      // Skip pure-whitespace rows so a trailing CR/LF doesn't produce a
      // blank line of its own.
      if (text.length === 0 && bytes.every((b) => b === 0x0a || b === 0x0d)) return;
      // Re-segment without the trailing newline so the row renders cleanly.
      const trimmedSegs: AnsiSegment[] = [];
      let remaining = text.length;
      for (const s of segments) {
        if (remaining <= 0) break;
        if (s.text.length === 0) continue;
        if (s.text.length <= remaining) {
          trimmedSegs.push(s);
          remaining -= s.text.length;
        } else {
          trimmedSegs.push({ ...s, text: s.text.slice(0, remaining) });
          remaining = 0;
        }
      }
      setLog((prev) => {
        const next = prev.length >= MAX_LOG_LINES ? prev.slice(prev.length - MAX_LOG_LINES + 1) : prev.slice();
        next.push({
          at,
          direction,
          text,
          segments: trimmedSegs,
          rawHead: bytes.length > RAW_HEAD_CAP ? bytes.subarray(0, RAW_HEAD_CAP) : bytes,
          bytes: bytes.length,
          chunks,
        });
        return next;
      });
    };

    const flushBuf = (direction: 'rx' | 'tx', buf: LineBuf) => {
      if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
      if (buf.bytes.length === 0) return;
      emitEntry(direction, buf.bytes, buf.ts, buf.chunks);
      buf.bytes = new Uint8Array(0);
      buf.ts = 0;
      buf.chunks = 0;
    };

    const handleChunk = (direction: 'rx' | 'tx', incoming: Uint8Array, at: number) => {
      const buf = direction === 'rx' ? rxBuf.current : txBuf.current;
      if (buf.bytes.length === 0) buf.ts = at;
      // Append incoming bytes to the buffer.
      const combined = new Uint8Array(buf.bytes.length + incoming.length);
      combined.set(buf.bytes, 0);
      combined.set(incoming, buf.bytes.length);
      buf.bytes = combined;
      buf.chunks += 1;
      // Walk the combined buffer, emitting one entry per newline.
      let start = 0;
      for (let i = 0; i < buf.bytes.length; i++) {
        if (buf.bytes[i] === 0x0a) {
          const line = buf.bytes.subarray(start, i + 1);
          // Each emitted line takes credit for the chunk it landed in;
          // approximate "chunks" as the running counter, then reset.
          emitEntry(direction, line, buf.ts, buf.chunks);
          start = i + 1;
          buf.ts = at;
          buf.chunks = 1;
        }
      }
      if (start > 0) {
        buf.bytes = buf.bytes.subarray(start);
        if (buf.bytes.length === 0) { buf.ts = 0; buf.chunks = 0; }
      }
      // Hard cap: protect against a runaway producer that never emits \n.
      if (buf.bytes.length > LINE_BYTE_CAP) flushBuf(direction, buf);
      // (Re)arm the partial-flush timer for whatever tail remains.
      if (buf.timer) clearTimeout(buf.timer);
      if (buf.bytes.length > 0) {
        buf.timer = setTimeout(() => flushBuf(direction, buf), PARTIAL_FLUSH_MS);
      }
    };

    const offRaw = window.mesh.onSerialRaw((p) => {
      if (paused || p.connId !== active.connId) return;
      const u8 = base64ToBytes(p.bytes);
      handleChunk(p.direction, u8, p.at);
      // Only the rx stream carries the device's boot text / panic dumps.
      if (p.direction === 'rx') {
        const combined = insightsCarry.current + segmentsToPlain(bytesToSegments(u8));
        const lines = combined.split('\n');
        insightsCarry.current = lines.pop() ?? '';
        if (lines.length > 0) {
          setInsights((prev) => foldLines(prev, lines, p.at));
        }
      }
    });
    const offEvt = window.mesh.onSerialEvent((p) => {
      if (p.connId !== active.connId) return;
      setEvents((prev) => {
        const next = prev.length >= MAX_EVENT_LINES ? prev.slice(-MAX_EVENT_LINES + 1) : prev.slice();
        next.push(p.event);
        return next;
      });
    });
    return () => {
      offRaw();
      offEvt();
      if (rxBuf.current.timer) { clearTimeout(rxBuf.current.timer); rxBuf.current.timer = null; }
      if (txBuf.current.timer) { clearTimeout(txBuf.current.timer); txBuf.current.timer = null; }
    };
  }, [active?.connId, paused]);

  // Reset buffer when the active connection switches.
  useEffect(() => {
    setLog([]);
    setEvents([]);
    setActionResult(null);
    setInsights(emptyInsights());
    insightsCarry.current = '';
    if (rxBuf.current.timer) clearTimeout(rxBuf.current.timer);
    if (txBuf.current.timer) clearTimeout(txBuf.current.timer);
    rxBuf.current = { bytes: new Uint8Array(0), ts: 0, chunks: 0, timer: null };
    txBuf.current = { bytes: new Uint8Array(0), ts: 0, chunks: 0, timer: null };
  }, [active?.connId]);

  // Poll stats every second — they change too fast for event-driven updates
  // to be useful, and the JSON snapshot is tiny.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const tick = async () => {
      const s = await window.mesh.getPortStats(active.connId);
      if (!cancelled) setStats(s);
    };
    void tick();
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [active?.connId]);

  // Sticky autoscroll: if the user is at the bottom, keep them there; if
  // they scrolled up to read history, leave them alone.
  useEffect(() => {
    const el = logRef.current;
    if (!el || !autoscroll.current) return;
    el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoscroll.current = nearBottom;
  };

  const handleReset = async (profile: ResetProfile) => {
    if (!active) return;
    setBusy(profile);
    setActionResult(null);
    try {
      await window.mesh.resetDevice({ connId: active.connId, profile });
      setActionResult({ ok: true, msg: `${profileLabel(profile)} signal sent. Watch the log + event timeline for the device's boot output.` });
    } catch (e: any) {
      setActionResult({ ok: false, msg: e?.message ?? String(e) });
    } finally {
      setBusy(null);
    }
  };

  const saveCapture = () => {
    if (!active) return;
    const body = {
      capturedAt: new Date().toISOString(),
      connId: active.connId,
      portPath: active.portPath,
      state: active.state,
      portStats: stats,
      insights,
      events,
      log: log.slice(-MAX_LOG_LINES),
    };
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `device-lab-${active.connId}-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = useMemo(() => log.filter((l) => filter === 'all' || l.direction === filter), [log, filter]);
  const my = active?.state.myInfo?.myNodeNum;
  const myNode = my ? active!.nodes.find((n) => n.num === my) : undefined;
  const hwName = myNode?.hwModelName;
  const chip = chipFamilyFromHwModel(hwName);

  if (!active) {
    return (
      <div className="page">
        <h1 className="page-title">Device Lab</h1>
        <p className="page-sub">Connect a radio first — Device Lab streams the live USB-serial traffic and surfaces the controls that un-stick wedged firmware.</p>
      </div>
    );
  }

  const sessionBytes = (stats?.bytesIn ?? 0) + (stats?.bytesOut ?? 0);
  const upSec = stats?.openedAt ? Math.max(1, Math.round((Date.now() - stats.openedAt) / 1000)) : 0;
  const avgBps = upSec > 0 ? Math.round(sessionBytes / upSec) : 0;

  return (
    <div className="page device-lab">
      <h1 className="page-title">Device Lab</h1>
      <p className="page-sub">
        Live USB-serial inspection for the active radio. Use this when the firmware is misbehaving — crashing, refusing to boot, not enumerating, or running fine until you ask it to transmit.
      </p>

      {/* Radio picker (mirrors Connect tab) */}
      {connections.length > 1 && (
        <div className="conn-chips" style={{ marginBottom: 12 }}>
          {connections.map((c) => {
            const isActive = c.connId === activeConnId;
            const cMy = c.state.myInfo?.myNodeNum;
            const cNode = cMy ? c.nodes.find((n) => n.num === cMy) : undefined;
            const label = cNode?.shortName || cNode?.longName || c.portPath?.split('/').pop() || c.connId;
            const dot = c.state.status === 'ready' ? 'ok' : c.state.status === 'disconnected' ? 'bad' : 'warn';
            return (
              <div key={c.connId} className={'conn-chip' + (isActive ? ' active' : '')} onClick={() => setActiveConnId(c.connId)} role="button" tabIndex={0}>
                <span className={`status-dot ${dot}`} />
                <div className="conn-chip-text">
                  <div className="conn-chip-label">{label}</div>
                  <div className="conn-chip-sub">{c.portPath?.split('/').pop()}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Header strip — port stats + identification */}
      <div className="lab-strip">
        <LabStat label="state" value={active.state.status} tone={active.state.status === 'ready' ? 'good' : 'warn'} />
        <LabStat label="port" value={active.portPath?.split('/').pop() ?? '—'} mono />
        <LabStat label="hardware" value={hwName ?? 'unknown'} mono />
        <LabStat label="chip family" value={chip} mono tone={chip === 'unknown' ? 'dim' : undefined} />
        <LabStat label="uptime" value={upSec > 0 ? formatDuration(upSec) : '—'} mono tone={upSec > 0 ? 'good' : 'dim'} />
        <LabStat label="last data" value={ago(stats?.lastDataAt ?? null)} mono />
        <LabStat label="bytes in" value={(stats?.bytesIn ?? 0).toLocaleString()} mono />
        <LabStat label="bytes out" value={(stats?.bytesOut ?? 0).toLocaleString()} mono />
        <LabStat label="avg B/s" value={avgBps.toLocaleString()} mono />
        <LabStat label="frames" value={`${stats?.framesIn ?? 0} / ${stats?.framesOut ?? 0}`} mono />
        <LabStat label="corrupt" value={String(stats?.framesCorrupt ?? 0)} mono tone={(stats?.framesCorrupt ?? 0) > 0 ? 'warn' : 'dim'} />
        <LabStat label="errors" value={String(stats?.errorCount ?? 0)} mono tone={(stats?.errorCount ?? 0) > 0 ? 'bad' : 'dim'} />
        <LabStat label="reopens" value={String(stats?.reconnectCount ?? 0)} mono tone={(stats?.reconnectCount ?? 0) > 0 ? 'warn' : 'dim'} />
      </div>

      {/* Reset / bootloader controls */}
      <div className="lab-actions">
        <div className="lab-actions-label">Hardware controls</div>
        <button
          className="lab-btn"
          onClick={() => handleReset('esp32')}
          disabled={busy !== null || chip === 'nrf52' || chip === 'rp2040'}
          title="Pulse EN via RTS — works on most ESP32 boards (CP210x, CH9102, FTDI, native S3 USB)"
        >
          {busy === 'esp32' ? 'Resetting…' : '↻ Reset (ESP32)'}
        </button>
        <button
          className="lab-btn"
          onClick={() => handleReset('esp32-bootloader')}
          disabled={busy !== null || chip === 'nrf52' || chip === 'rp2040'}
          title="Classic esptool reset-to-bootloader sequence — required before flashing"
        >
          {busy === 'esp32-bootloader' ? 'Entering…' : '⤓ Bootloader (ESP32)'}
        </button>
        <button
          className="lab-btn"
          onClick={() => handleReset('nrf52-dfu')}
          disabled={busy !== null || (chip !== 'nrf52' && chip !== 'unknown')}
          title="1200-baud touch — triggers the Adafruit nRF52 DFU bootloader"
        >
          {busy === 'nrf52-dfu' ? 'Touching…' : '⤓ DFU (nRF52, 1200-baud)'}
        </button>
        <button
          className="lab-btn"
          onClick={() => handleReset('rp2040-bootsel')}
          disabled={busy !== null}
          title="RP2040 BOOTSEL is hardware-only — this just shows the instructions"
        >
          ⤓ BOOTSEL (RP2040)
        </button>
        <button className="lab-btn ghost" onClick={() => {
          setLog([]); setEvents([]); setInsights(emptyInsights());
          insightsCarry.current = '';
          if (rxBuf.current.timer) clearTimeout(rxBuf.current.timer);
          if (txBuf.current.timer) clearTimeout(txBuf.current.timer);
          rxBuf.current = { bytes: new Uint8Array(0), ts: 0, chunks: 0, timer: null };
          txBuf.current = { bytes: new Uint8Array(0), ts: 0, chunks: 0, timer: null };
        }}>Clear log</button>
        <button className="lab-btn ghost" onClick={() => setPaused((p) => !p)}>{paused ? '▶ Resume' : '❚❚ Pause'}</button>
        <button className="lab-btn ghost" onClick={saveCapture}>⤓ Save capture</button>
      </div>

      {actionResult && (
        <div className="info-card" style={{ borderLeftColor: actionResult.ok ? 'var(--good)' : 'var(--bad)', marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 12.5 }}>{actionResult.msg}</p>
        </div>
      )}

      <BootInsightsCard insights={insights} chip={chip} />
      {insights.lastCrash && <CrashCard crash={insights.lastCrash} />}

      {/* Three-up: timeline + live serial log */}
      <div className="lab-grid">
        <div className="card lab-events">
          <div className="card-head-row">
            <h3 style={{ margin: 0 }}>Event timeline</h3>
            <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>{events.length}</span>
          </div>
          {events.length === 0 ? (
            <div className="dash-empty">No lifecycle events yet. The port handshake, reconnects, errors, and resets appear here.</div>
          ) : (
            <ul className="lab-event-list">
              {events.slice(-MAX_EVENT_LINES).reverse().map((e, i) => (
                <li key={i} className={`lab-event lab-event-${e.kind}`}>
                  <span className="lab-event-time">{fmtTime(e.at)}</span>
                  <span className="lab-event-kind">{e.kind}</span>
                  {e.detail && <span className="lab-event-detail">{e.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card lab-log-card">
          <div className="card-head-row" style={{ alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Serial log</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="lab-filter">
                <button className={'lab-filter-btn' + (filter === 'all' ? ' active' : '')} onClick={() => setFilter('all')}>all</button>
                <button className={'lab-filter-btn' + (filter === 'rx' ? ' active' : '')} onClick={() => setFilter('rx')}>rx</button>
                <button className={'lab-filter-btn' + (filter === 'tx' ? ' active' : '')} onClick={() => setFilter('tx')}>tx</button>
              </div>
              <label style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={hexMode} onChange={(e) => setHexMode(e.target.checked)} /> hex
              </label>
            </div>
          </div>
          <div ref={logRef} className="lab-log" onScroll={onScroll}>
            {filtered.length === 0 ? (
              <div className="dash-empty">{paused ? 'Paused.' : 'Waiting for serial data…'}</div>
            ) : filtered.map((l, i) => (
              <div key={i} className={`lab-log-row lab-log-${l.direction}`}>
                <span className="lab-log-time">{fmtTime(l.at)}</span>
                <span className="lab-log-dir">{l.direction === 'rx' ? '◀' : '▶'}</span>
                <span className="lab-log-bytes" title={l.chunks > 1 ? `${l.chunks} chunks merged` : '1 chunk'}>
                  {l.bytes}b{l.chunks > 1 ? `·${l.chunks}` : ''}
                </span>
                <span className="lab-log-text">
                  {hexMode
                    ? bytesToHex(l.rawHead, 64) + (l.bytes > l.rawHead.length ? ` …(+${l.bytes - l.rawHead.length}b)` : '')
                    : l.segments.map((s, j) => (
                        <span
                          key={j}
                          style={{
                            color: s.color,
                            fontWeight: s.bold ? 600 : undefined,
                          }}
                        >
                          {s.text}
                        </span>
                      ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Troubleshooting hints based on what we're seeing */}
      <Hints stats={stats} events={events} state={active.state} chip={chip} />
    </div>
  );
}

function profileLabel(p: ResetProfile): string {
  switch (p) {
    case 'esp32': return 'Reset (ESP32)';
    case 'esp32-bootloader': return 'ESP32 bootloader-entry';
    case 'nrf52-dfu': return 'nRF52 1200-baud DFU touch';
    case 'rp2040-bootsel': return 'RP2040 BOOTSEL';
  }
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60 > 0 ? ' ' + (sec % 60) + 's' : ''}`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h${m > 0 ? ' ' + m + 'm' : ''}`;
}

function LabStat({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: 'good' | 'warn' | 'bad' | 'dim' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : tone === 'dim' ? 'var(--text-faint)' : 'var(--text)';
  return (
    <div className="lab-stat">
      <div className="lab-stat-label">{label}</div>
      <div className="lab-stat-value" style={{ color, fontFamily: mono ? 'var(--mono)' : 'inherit' }}>{value}</div>
    </div>
  );
}

function BootInsightsCard({ insights, chip }: { insights: DeviceInsights; chip: string }) {
  const { lastResetCode, lastResetReason, bootCount, crashCount, lastBootAt, bootPhases } = insights;
  const phaseSet = useMemo(() => new Set(bootPhases), [bootPhases]);
  // nRF52 / RP2040 builds don't print ESP32 boot text, so the phase tracker
  // would just look broken. Hide it for those families.
  const showPhases = chip === 'esp32' || chip === 'esp32-s3' || chip === 'unknown';

  return (
    <div className="card lab-insights">
      <div className="card-head-row">
        <h3 style={{ margin: 0 }}>Boot insights</h3>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          parsed live from rx stream
        </span>
      </div>

      <div className="lab-insights-row">
        <LabStat
          label="last reset"
          value={lastResetCode ? `${lastResetCode} · ${lastResetReason}` : '—'}
          mono
          tone={lastResetReason?.includes('BROWN_OUT') ? 'bad'
              : lastResetReason?.includes('WDT') ? 'warn'
              : lastResetCode ? 'good' : 'dim'}
        />
        <LabStat label="boots seen" value={String(bootCount)} mono tone={bootCount > 0 ? 'good' : 'dim'} />
        <LabStat
          label="crashes"
          value={String(crashCount)}
          mono
          tone={crashCount > 0 ? 'bad' : 'dim'}
        />
        <LabStat label="last boot" value={ago(lastBootAt)} mono />
      </div>

      {showPhases && (
        <>
          <div className="lab-phases-label">Boot progression</div>
          <div className="lab-phases">
            {BOOT_PHASE_ORDER.map((phase) => {
              const lit = phaseSet.has(phase);
              return (
                <span
                  key={phase}
                  className={'lab-phase-chip' + (lit ? ' lit' : '')}
                  title={BOOT_PHASE_HINTS[phase] + (lit ? '' : '  (not yet seen)')}
                >
                  {BOOT_PHASE_LABELS[phase]}
                </span>
              );
            })}
          </div>
          {bootCount === 0 && (
            <p className="lab-insights-empty">
              No reset banner seen yet. Trigger a reset (↻ above) to watch the device boot from scratch — phases light up as the firmware passes them.
            </p>
          )}
        </>
      )}
      {!showPhases && (
        <p className="lab-insights-empty">
          Boot-phase tracking is ESP32-only — nRF52 and RP2040 don't emit a comparable text-mode boot log over USB-serial.
        </p>
      )}
    </div>
  );
}

function CrashCard({ crash }: { crash: CrashRecord }) {
  return (
    <div className="card lab-crash">
      <div className="card-head-row">
        <h3 style={{ margin: 0, color: 'var(--bad)' }}>Last crash · {crash.cause}{crash.core !== null ? ` (core ${crash.core})` : ''}</h3>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
          {fmtTime(crash.at)}
        </span>
      </div>
      {crash.hint && (
        <p style={{ margin: '4px 0 8px', fontSize: 12.5, color: 'var(--text-dim)' }}>{crash.hint}</p>
      )}
      {crash.pc && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, marginBottom: 6 }}>
          <span style={{ color: 'var(--text-faint)' }}>PC </span>
          <span>{crash.pc}</span>
        </div>
      )}
      {crash.backtrace.length > 0 ? (
        <div className="lab-crash-bt">
          <div className="lab-crash-bt-label">Backtrace</div>
          <code>{crash.backtrace.join(' ')}</code>
          <p className="lab-crash-bt-note">
            Decode addresses with <code>xtensa-esp32-elf-addr2line -pfiaC -e firmware.elf {crash.backtrace[0]?.split(':')[0] ?? '0x4xx'}</code> against the matching firmware ELF.
          </p>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
          Backtrace not captured (yet). Subsequent rx lines may complete it — leave the panel open after a panic to be sure.
        </p>
      )}
    </div>
  );
}

function Hints({ stats, events, state, chip }: { stats: PortStats | null; events: SerialEvent[]; state: ConnectionState; chip: string }) {
  const hints: Array<{ tone: 'good' | 'warn' | 'bad'; title: string; body: string }> = [];
  const recentErrors = events.filter((e) => e.kind === 'error').slice(-5).length;
  const recentReopens = events.filter((e) => e.kind === 'reconnect-attempt').length;
  const corrupt = stats?.framesCorrupt ?? 0;
  const lastData = stats?.lastDataAt;
  const sinceData = lastData ? Date.now() - lastData : Infinity;

  if (recentErrors >= 3) {
    hints.push({
      tone: 'bad',
      title: `${recentErrors} recent serial errors`,
      body: 'Repeated errors usually mean a marginal USB cable (charge-only, damaged), a flaky hub, or under-voltage on the board. Try a different known-good USB-C/USB-A data cable and skip the hub.',
    });
  }
  if (corrupt > 0 && corrupt / Math.max(1, stats?.framesIn ?? 1) > 0.05) {
    hints.push({
      tone: 'warn',
      title: `${corrupt} corrupt frames (${((corrupt / Math.max(1, stats?.framesIn ?? 1)) * 100).toFixed(0)}% of inbound)`,
      body: 'Garbled bytes on the wire — typically a baud-rate mismatch, ground loop, or RF interference into the USB cable. Re-seat the cable and verify the firmware version matches the protobuf the app expects.',
    });
  }
  if (state.status === 'ready' && sinceData > 60_000) {
    hints.push({
      tone: 'warn',
      title: `No serial data for ${Math.floor(sinceData / 1000)}s`,
      body: 'The handshake completed but nothing is flowing. The radio may have entered light sleep or the USB-CDC virtual line silently dropped. Try a soft reset (↻ Reset above) and see if traffic resumes.',
    });
  }
  if (recentReopens > 0) {
    hints.push({
      tone: 'warn',
      title: `Port has reopened ${recentReopens} time${recentReopens === 1 ? '' : 's'} this session`,
      body: 'On macOS this usually means a brown-out: the LilyGO is drawing more current than the host can supply, the chip browns out, USB drops, and the kernel re-enumerates. Plug into a USB port that supplies ≥500 mA reliably, or use a powered hub.',
    });
  }
  if (chip === 'unknown') {
    hints.push({
      tone: 'warn',
      title: 'Chip family not yet identified',
      body: 'The radio hasn\'t reported its hardware model. Reset profiles default to ESP32; for nRF52/RP2040 boards the labeled buttons are the correct path.',
    });
  }
  if (hints.length === 0) {
    hints.push({ tone: 'good', title: 'No anomalies detected', body: 'Serial channel looks healthy. If the device still misbehaves, capture the log and inspect for repeating crash signatures.' });
  }
  return (
    <div className="lab-hints">
      <div className="bucket-title" style={{ marginBottom: 6 }}>Diagnostic hints</div>
      {hints.map((h, i) => (
        <div key={i} className={`info-card lab-hint lab-hint-${h.tone}`}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{h.title}</p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-dim)' }}>{h.body}</p>
        </div>
      ))}
    </div>
  );
}
