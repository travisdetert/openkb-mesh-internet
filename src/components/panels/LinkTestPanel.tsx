import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMeshContext } from '../../hooks/MeshContext';
import type { ConnectionView } from '../../hooks/useMesh';

const TEST_TIMEOUT_MS = 20_000;
const MARKER_PREFIX = 'OK-LT-';
const CORRELATION_WINDOW_MS = 5 * 60_000; // last 5 min of emissions

interface LinkTest {
  id: string;
  marker: string;
  fromConnId: string;
  toConnId: string;
  sentAt: number;
  status: 'pending' | 'received' | 'timeout' | 'error';
  receivedAt?: number;
  rxRssi?: number;
  rxSnr?: number;
  hopStart?: number;
  hopLimit?: number;
  errorMsg?: string;
}

function shortHex(num: number): string {
  return '!' + (num >>> 0).toString(16).padStart(8, '0').slice(-4);
}
function shortName(v: ConnectionView): string {
  const my = v.state.myInfo?.myNodeNum;
  if (!my) return v.portPath ?? v.connId;
  const node = v.nodes.find((n) => n.num === my);
  return node?.shortName || node?.longName || shortHex(my);
}
function makeMarker(): string {
  return MARKER_PREFIX + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

interface PairedEmission {
  // From A's perspective: a packet emitted by A's radio
  packetId: number;
  fromNum: number;
  emittedAt: number; // ms timestamp on A
  portnum?: number;
  text?: string;
  // From B's perspective: did B hear it?
  bReceivedAt?: number;
  bRssi?: number;
  bSnr?: number;
  bHopStart?: number;
  bHopLimit?: number;
  bViaMqtt?: boolean;
}

function buildPairings(emitter: ConnectionView, observer: ConnectionView): PairedEmission[] {
  const emitterMy = emitter.state.myInfo?.myNodeNum;
  if (!emitterMy) return [];
  const cutoff = Date.now() - CORRELATION_WINDOW_MS;
  const emissions = emitter.recentPackets.filter((p) =>
    p.from === emitterMy && p.receivedAt >= cutoff,
  );
  // Index observer's RF (non-MQTT) packets by (from, id) so we can pair quickly.
  const observerIdx = new Map<string, typeof observer.recentPackets[0]>();
  for (const p of observer.recentPackets) {
    const key = `${p.from >>> 0}-${p.id >>> 0}`;
    if (!observerIdx.has(key)) observerIdx.set(key, p);
  }
  return emissions.map((p): PairedEmission => {
    const key = `${p.from >>> 0}-${p.id >>> 0}`;
    const match = observerIdx.get(key);
    return {
      packetId: p.id,
      fromNum: p.from,
      emittedAt: p.receivedAt,
      portnum: p.portnum,
      text: p.text,
      bReceivedAt: match?.receivedAt,
      bRssi: match?.rxRssi,
      bSnr: match?.rxSnr,
      bHopStart: match?.hopStart,
      bHopLimit: match?.hopLimit,
      bViaMqtt: match?.viaMqtt,
    };
  });
}

type Verdict = 'healthy' | 'partial-ab' | 'partial-ba' | 'silent' | 'untested';
function summarize(a: ConnectionView, b: ConnectionView, tests: LinkTest[]): { verdict: Verdict; aToBHeard: number; aToBTotal: number; bToAHeard: number; bToATotal: number } {
  // Use passive pairings as the basis; if neither direction has emissions, fall back to test results.
  const aToB = buildPairings(a, b);
  const bToA = buildPairings(b, a);
  const rfMatch = (e: PairedEmission) => e.bReceivedAt !== undefined && !e.bViaMqtt;
  const aToBHeard = aToB.filter(rfMatch).length;
  const bToAHeard = bToA.filter(rfMatch).length;
  const aToBTotal = aToB.length;
  const bToATotal = bToA.length;

  if (aToBTotal === 0 && bToATotal === 0) {
    // Use tests if no passive data yet
    const successAB = tests.filter((t) => t.fromConnId === a.connId && t.status === 'received').length;
    const successBA = tests.filter((t) => t.fromConnId === b.connId && t.status === 'received').length;
    const triedAB = tests.filter((t) => t.fromConnId === a.connId && t.status !== 'pending').length;
    const triedBA = tests.filter((t) => t.fromConnId === b.connId && t.status !== 'pending').length;
    if (triedAB === 0 && triedBA === 0) return { verdict: 'untested', aToBHeard: 0, aToBTotal: 0, bToAHeard: 0, bToATotal: 0 };
    if (successAB > 0 && successBA > 0) return { verdict: 'healthy', aToBHeard: successAB, aToBTotal: triedAB, bToAHeard: successBA, bToATotal: triedBA };
    if (successAB > 0 && successBA === 0) return { verdict: 'partial-ab', aToBHeard: successAB, aToBTotal: triedAB, bToAHeard: 0, bToATotal: triedBA };
    if (successAB === 0 && successBA > 0) return { verdict: 'partial-ba', aToBHeard: 0, aToBTotal: triedAB, bToAHeard: successBA, bToATotal: triedBA };
    return { verdict: 'silent', aToBHeard: 0, aToBTotal: triedAB, bToAHeard: 0, bToATotal: triedBA };
  }

  // Treat ≥50% delivery as healthy in that direction.
  const okAB = aToBTotal > 0 && aToBHeard / aToBTotal >= 0.5;
  const okBA = bToATotal > 0 && bToAHeard / bToATotal >= 0.5;
  if (okAB && okBA) return { verdict: 'healthy', aToBHeard, aToBTotal, bToAHeard, bToATotal };
  if (okAB && !okBA) return { verdict: 'partial-ab', aToBHeard, aToBTotal, bToAHeard, bToATotal };
  if (!okAB && okBA) return { verdict: 'partial-ba', aToBHeard, aToBTotal, bToAHeard, bToATotal };
  return { verdict: 'silent', aToBHeard, aToBTotal, bToAHeard, bToATotal };
}

export function LinkTestPanel() {
  const { connections } = useMeshContext();
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const [tests, setTests] = useState<LinkTest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string>('');

  // Initial selection
  useEffect(() => {
    if (aId === null && connections[0]) setAId(connections[0].connId);
    if (bId === null && connections[1] && connections[1].connId !== aId) setBId(connections[1].connId);
  }, [connections, aId, bId]);
  // Drop stale selections
  useEffect(() => {
    if (aId && !connections.some((c) => c.connId === aId)) setAId(null);
    if (bId && !connections.some((c) => c.connId === bId)) setBId(null);
  }, [connections, aId, bId]);

  const a = aId ? connections.find((c) => c.connId === aId) : null;
  const b = bId ? connections.find((c) => c.connId === bId) : null;
  const isReadyA = a?.state.status === 'ready';
  const isReadyB = b?.state.status === 'ready';

  // Tick once a second so timeouts + relative times update.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Watch each pending test for receipt on its destination radio. Runs whenever
  // either radio's messages change or the 1-second tick fires (for timeouts).
  // We bail out without producing a new state array when nothing actually changed,
  // otherwise setTests + setTick would feed each other infinitely.
  useEffect(() => {
    if (!a || !b) return;
    setTests((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        if (t.status !== 'pending') return t;
        const target = t.toConnId === a.connId ? a : t.toConnId === b.connId ? b : null;
        if (!target) return t;
        const match = target.messages.find((m) => m.text === t.marker);
        if (match) {
          changed = true;
          return {
            ...t,
            status: 'received' as const,
            receivedAt: match.rxTime * 1000,
            rxRssi: match.rxRssi,
            rxSnr: match.rxSnr,
            hopStart: match.hopStart,
            hopLimit: match.hopLimit,
          };
        }
        if (Date.now() - t.sentAt > TEST_TIMEOUT_MS) {
          changed = true;
          return { ...t, status: 'timeout' as const };
        }
        return t;
      });
      return changed ? next : prev;
    });
  }, [a, b, a?.messages.length, b?.messages.length, tick]);

  const runTest = async (fromConn: ConnectionView, toConn: ConnectionView) => {
    setErr('');
    setBusy(fromConn.connId);
    const marker = makeMarker();
    const test: LinkTest = {
      id: marker,
      marker,
      fromConnId: fromConn.connId,
      toConnId: toConn.connId,
      sentAt: Date.now(),
      status: 'pending',
    };
    setTests((prev) => [test, ...prev].slice(0, 20));
    try {
      await window.mesh.sendText({ connId: fromConn.connId, text: marker, channel: 0 });
    } catch (e: any) {
      const errMsg = e?.message ?? String(e);
      setErr(errMsg);
      setTests((prev) => prev.map((t) => (t.id === marker ? { ...t, status: 'error', errorMsg: errMsg } : t)));
    } finally {
      setBusy(null);
    }
  };

  const swap = () => {
    if (!aId || !bId) return;
    setAId(bId); setBId(aId);
  };

  const pairsAB = useMemo(() => (a && b ? buildPairings(a, b) : []), [a, b]);
  const pairsBA = useMemo(() => (a && b ? buildPairings(b, a) : []), [a, b]);
  const summary = useMemo(() => (a && b ? summarize(a, b, tests) : null), [a, b, tests]);

  // ── Render ────────────────────────────────────────────────────────

  if (connections.length < 2) {
    return (
      <div className="page">
        <h1 className="page-title">Link Test</h1>
        <p className="page-sub">
          Connect two radios at once, then send a test message from one and watch it arrive on the other. The fastest way to confirm two devices in the same room are actually on the same mesh.
        </p>
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)' }}>
          <p style={{ margin: 0, fontSize: 12.5 }}>
            <strong>You only have {connections.length} radio connected.</strong> Plug in a second device and open it via <em>Connect → + Add another radio</em>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Link Test</h1>
      <p className="page-sub">
        Are these two radios actually talking? Pick a pair, send a test ping, and the panel will show whether and how the other side heard it. Below that, every packet either radio has recently transmitted is paired with whether the other radio heard it — passive proof of the link.
      </p>

      {/* Selectors */}
      <div className="rc-selectors">
        <RadioPicker label="Radio A" value={aId} onChange={setAId} connections={connections} excludeId={bId} accent="a" />
        <button className="ghost rc-vs" onClick={swap} title="Swap A and B" style={{ cursor: 'pointer' }}>⇄</button>
        <RadioPicker label="Radio B" value={bId} onChange={setBId} connections={connections} excludeId={aId} accent="b" />
      </div>

      {a && b && summary && (
        <VerdictChip a={a} b={b} summary={summary} />
      )}

      {a && b && (
        <>
          {/* Active ping */}
          <div className="card lt-test-card">
            <h3 style={{ marginTop: 0 }}>Active ping</h3>
            <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12 }}>
              Sends a short marker chat from one radio on the primary channel (broadcast). Listens on the other for up to {Math.round(TEST_TIMEOUT_MS / 1000)} seconds. If it arrives, you see the exact RSSI/SNR/hops the destination measured — and the time it took.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                className="primary"
                onClick={() => runTest(a, b)}
                disabled={!isReadyA || !isReadyB || busy === a.connId}
              >
                {busy === a.connId ? 'Sending…' : `Ping ${shortName(a)} → ${shortName(b)}`}
              </button>
              <button
                className="primary"
                onClick={() => runTest(b, a)}
                disabled={!isReadyA || !isReadyB || busy === b.connId}
              >
                {busy === b.connId ? 'Sending…' : `Ping ${shortName(b)} → ${shortName(a)}`}
              </button>
            </div>
            {(!isReadyA || !isReadyB) && (
              <p style={{ marginTop: 8, color: 'var(--warn)', fontSize: 12 }}>
                Both radios must be in <em>ready</em> state. {!isReadyA && shortName(a)} {!isReadyB && shortName(b)} not ready.
              </p>
            )}
            {err && <p style={{ marginTop: 8, color: 'var(--bad)', fontSize: 12, fontFamily: 'var(--mono)' }}>{err}</p>}

            {tests.length > 0 && (
              <table className="data" style={{ marginTop: 14 }}>
                <thead>
                  <tr>
                    <th>From → To</th>
                    <th>Sent</th>
                    <th>Status</th>
                    <th>Delay</th>
                    <th>RSSI</th>
                    <th>SNR</th>
                    <th>Hops</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t) => {
                    const fromName = t.fromConnId === a.connId ? shortName(a) : shortName(b);
                    const toName = t.toConnId === a.connId ? shortName(a) : shortName(b);
                    const ago = Math.round((Date.now() - t.sentAt) / 1000);
                    const delay = t.receivedAt ? ((t.receivedAt - t.sentAt) / 1000).toFixed(1) + 's' : '—';
                    const hops = t.hopStart && t.hopLimit ? `${t.hopStart - t.hopLimit}/${t.hopStart}` : '—';
                    return (
                      <tr key={t.id}>
                        <td>{fromName} → {toName}</td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{ago}s ago</td>
                        <td>
                          {t.status === 'pending' && <span className="lt-status lt-pending">⏳ waiting</span>}
                          {t.status === 'received' && <span className="lt-status lt-received">✓ received</span>}
                          {t.status === 'timeout' && <span className="lt-status lt-timeout">✗ timeout</span>}
                          {t.status === 'error' && <span className="lt-status lt-error">✗ {t.errorMsg ?? 'error'}</span>}
                        </td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{delay}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{t.rxRssi ? t.rxRssi : '—'}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{t.rxSnr ? t.rxSnr.toFixed(1) : '—'}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{hops}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Passive correlation */}
          <div className="card lt-corr-card">
            <h3 style={{ marginTop: 0 }}>Passive packet correlation (last 5 min)</h3>
            <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12 }}>
              For every packet either radio has transmitted, we check whether the other one heard it via RF. MQTT-only matches don't count — that proves nothing about the local airwaves.
            </p>
            <div className="lt-corr-grid">
              <CorrelationTable label={`${shortName(a)} → ${shortName(b)}`} pairs={pairsAB} />
              <CorrelationTable label={`${shortName(b)} → ${shortName(a)}`} pairs={pairsBA} />
            </div>
          </div>

          {/* Hints */}
          {summary && summary.verdict !== 'healthy' && summary.verdict !== 'untested' && (
            <div className="info-card" style={{ borderLeftColor: 'var(--warn)' }}>
              <p style={{ margin: 0, fontSize: 12.5 }}>
                <strong>Next steps:</strong> open <em>Compare Radios</em> to check for region / preset / channel / PSK mismatches first.
                If those all match and packets still don't cross,
                {summary.verdict === 'partial-ab' && ' the missing direction is usually antenna orientation or one radio being in deep sleep — try waking it manually.'}
                {summary.verdict === 'partial-ba' && ' the missing direction is usually antenna orientation or one radio being in deep sleep — try waking it manually.'}
                {summary.verdict === 'silent' && ' nothing is crossing in either direction. Likely culprits in order: (1) different channel PSK / name on slot 0, (2) different region or preset, (3) one radio in deep sleep, (4) antenna disconnected or wrong RF connector.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VerdictChip({ a, b, summary }: { a: ConnectionView; b: ConnectionView; summary: ReturnType<typeof summarize> }) {
  const tone =
    summary.verdict === 'healthy' ? 'ok'
    : summary.verdict === 'untested' ? 'dim'
    : summary.verdict === 'silent' ? 'bad'
    : 'warn';
  const label =
    summary.verdict === 'healthy' ? 'Link healthy — bidirectional RF traffic confirmed'
    : summary.verdict === 'untested' ? 'No traffic yet — run an active ping below'
    : summary.verdict === 'silent' ? 'No packets crossing — silent link'
    : summary.verdict === 'partial-ab' ? `One-way: ${shortName(a)} → ${shortName(b)} works, reverse does not`
    : `One-way: ${shortName(b)} → ${shortName(a)} works, reverse does not`;
  return (
    <div className={`lt-verdict lt-verdict-${tone}`}>
      <div className="lt-verdict-icon">
        {tone === 'ok' ? '✓' : tone === 'bad' ? '✗' : tone === 'dim' ? '·' : '!'}
      </div>
      <div style={{ flex: 1 }}>
        <div className="lt-verdict-title">{label}</div>
        <div className="lt-verdict-counts">
          <span>{shortName(a)} → {shortName(b)}: <strong>{summary.aToBHeard}/{summary.aToBTotal}</strong> heard</span>
          <span>{shortName(b)} → {shortName(a)}: <strong>{summary.bToAHeard}/{summary.bToATotal}</strong> heard</span>
        </div>
      </div>
    </div>
  );
}

function CorrelationTable({ label, pairs }: { label: string; pairs: PairedEmission[] }) {
  return (
    <div>
      <div className="lt-corr-label">{label}</div>
      {pairs.length === 0 ? (
        <div className="empty" style={{ padding: 14, fontSize: 12 }}>
          No emissions yet in this direction. The radio transmits its nodeInfo every ~3 hours; send a chat to force traffic.
        </div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Packet</th>
              <th>Type</th>
              <th>Heard?</th>
              <th>Delay</th>
              <th>RSSI</th>
              <th>SNR</th>
            </tr>
          </thead>
          <tbody>
            {pairs.slice(0, 12).map((p) => {
              const heard = p.bReceivedAt !== undefined && !p.bViaMqtt;
              const delay = heard && p.bReceivedAt ? `${(p.bReceivedAt - p.emittedAt) / 1000}s` : '—';
              const typeLabel = portnumShort(p.portnum) + (p.text ? ` "${p.text.slice(0, 12)}${p.text.length > 12 ? '…' : ''}"` : '');
              return (
                <tr key={`${p.fromNum}-${p.packetId}-${p.emittedAt}`}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>!{(p.packetId >>> 0).toString(16).padStart(8, '0').slice(-4)}</td>
                  <td style={{ fontSize: 11 }}>{typeLabel}</td>
                  <td>
                    {heard ? <span className="lt-status lt-received">✓ yes</span>
                     : p.bViaMqtt ? <span className="lt-status lt-mqtt">via MQTT only</span>
                     : <span className="lt-status lt-timeout">✗ no</span>}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{delay}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{p.bRssi || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)' }}>{p.bSnr ? p.bSnr.toFixed(1) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RadioPicker({
  label, value, onChange, connections, excludeId, accent,
}: {
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
  connections: ConnectionView[];
  excludeId: string | null;
  accent: 'a' | 'b';
}) {
  return (
    <div className={`rc-picker rc-picker-${accent}`}>
      <label className="rc-picker-label">{label}</label>
      <select className="text" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— pick —</option>
        {connections.map((c) => (
          <option key={c.connId} value={c.connId} disabled={c.connId === excludeId}>
            {shortName(c)} ({c.state.status} · {c.portPath?.split('/').pop() ?? c.connId})
          </option>
        ))}
      </select>
    </div>
  );
}

function portnumShort(p?: number): string {
  switch (p) {
    case 1: return 'TEXT';
    case 3: return 'POS';
    case 4: return 'NODEINFO';
    case 5: return 'ROUTING';
    case 6: return 'ADMIN';
    case 67: return 'TELEMETRY';
    case 70: return 'TRACEROUTE';
    case undefined: return 'enc';
    default: return `p${p}`;
  }
}
