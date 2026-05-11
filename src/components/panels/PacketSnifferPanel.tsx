import React, { useEffect, useMemo, useRef, useState } from 'react';

const BROADCAST = 0xffffffff;

const PORTNUMS: Record<number, string> = {
  0: 'UNKNOWN',
  1: 'TEXT_MESSAGE',
  2: 'REMOTE_HARDWARE',
  3: 'POSITION',
  4: 'NODEINFO',
  5: 'ROUTING',
  6: 'ADMIN',
  7: 'TEXT_COMPRESSED',
  8: 'WAYPOINT',
  9: 'AUDIO',
  10: 'DETECTION_SENSOR',
  32: 'REPLY',
  33: 'IP_TUNNEL',
  34: 'PAXCOUNTER',
  64: 'SERIAL',
  65: 'STORE_FORWARD',
  66: 'RANGE_TEST',
  67: 'TELEMETRY',
  68: 'ZPS',
  69: 'SIMULATOR',
  70: 'TRACEROUTE',
  71: 'NEIGHBORINFO',
  72: 'ATAK_PLUGIN',
  73: 'MAP_REPORT',
  74: 'POWERSTRESS',
  75: 'RETICULUM_TUNNEL',
  256: 'PRIVATE',
  511: 'REACTION',
};

interface CapturedPacket extends MeshPacketLite { receivedAt: number; }

interface Props {
  packets: CapturedPacket[];
  packetCount: number;
  nodes: NodeRecord[];
  state: ConnectionState;
  onMessageNode?: (num: number) => void;
}

type Tab = 'stream' | 'stats' | 'reference';

function shortHex(num: number): string { return '!' + (num >>> 0).toString(16).padStart(8, '0').slice(-4); }
function fullHex(num: number): string { return '!' + (num >>> 0).toString(16).padStart(8, '0'); }
function nameFor(nodes: NodeRecord[], num: number): string {
  if (num === BROADCAST) return 'broadcast';
  const n = nodes.find((x) => x.num === num);
  return n?.shortName || shortHex(num);
}
function colorForNode(num: number): string {
  const hue = ((num >>> 0) * 137.508) % 360;
  return `hsl(${hue}, 65%, 65%)`;
}
function portnumLabel(p: number | undefined): string {
  if (p === undefined) return '—';
  return PORTNUMS[p] ?? `port ${p}`;
}
function rssiTone(rssi: number): 'good' | 'warn' | 'bad' | 'dim' {
  if (!rssi || rssi === 0) return 'dim';
  if (rssi > -85) return 'good';
  if (rssi > -110) return 'warn';
  return 'bad';
}
function fmtAbsTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: false });
}

export function PacketSnifferPanel({ packets, packetCount, nodes, state, onMessageNode }: Props) {
  const [tab, setTab] = useState<Tab>('stream');

  // Sniffer-local pause + filters
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [frozen, setFrozen] = useState<CapturedPacket[] | null>(null);
  useEffect(() => {
    if (paused && frozen === null) setFrozen(packets);
    if (!paused && frozen !== null) setFrozen(null);
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = frozen ?? packets;

  return (
    <div className="page">
      <h1 className="page-title">Packet Sniffer</h1>
      <p className="page-sub">
        Every <code>FromRadio.packet</code> your radio decodes off the air, in real time. Filter, inspect, and export — useful for debugging propagation, channel encryption, or just understanding what your mesh is saying to itself.
      </p>

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'stream' ? ' active' : '')} onClick={() => setTab('stream')}>
          Stream {live.length > 0 && <span className="subnav-count">{live.length}</span>}
        </button>
        <button className={'subnav-btn' + (tab === 'stats' ? ' active' : '')} onClick={() => setTab('stats')}>Stats</button>
        <button className={'subnav-btn' + (tab === 'reference' ? ' active' : '')} onClick={() => setTab('reference')}>Reference</button>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
          {packetCount} packets this session · {live.length} buffered
        </div>
      </div>

      {tab === 'stream' && (
        <StreamTab packets={live} nodes={nodes} state={state} paused={paused} setPaused={setPaused} onMessageNode={onMessageNode} />
      )}
      {tab === 'stats' && <StatsTab packets={live} nodes={nodes} />}
      {tab === 'reference' && <ReferenceTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Stream tab — live table
// ─────────────────────────────────────────────────────────────────────

function StreamTab({ packets, nodes, state, paused, setPaused, onMessageNode }: { packets: CapturedPacket[]; nodes: NodeRecord[]; state: ConnectionState; paused: boolean; setPaused: (p: boolean) => void; onMessageNode?: (n: number) => void }) {
  const [filterPort, setFilterPort] = useState<number | 'all'>('all');
  const [filterSender, setFilterSender] = useState<number | 'all'>('all');
  const [filterEncrypted, setFilterEncrypted] = useState<'all' | 'yes' | 'no'>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const myNum = state.myInfo?.myNodeNum;

  // Unique senders + portnums for dropdowns.
  const senders = useMemo(() => {
    const s = new Set<number>();
    packets.forEach((p) => s.add(p.from));
    return Array.from(s).sort();
  }, [packets]);
  const portnumsSeen = useMemo(() => {
    const s = new Set<number>();
    packets.forEach((p) => { if (p.portnum !== undefined) s.add(p.portnum); });
    return Array.from(s).sort((a, b) => a - b);
  }, [packets]);

  const filtered = useMemo(() => {
    return packets.filter((p) => {
      if (filterPort !== 'all' && p.portnum !== filterPort) return false;
      if (filterSender !== 'all' && p.from !== filterSender) return false;
      if (filterEncrypted === 'yes' && !p.encrypted) return false;
      if (filterEncrypted === 'no' && p.encrypted) return false;
      if (search) {
        const q = search.toLowerCase();
        const haystack = [
          p.text, fullHex(p.from), nameFor(nodes, p.from), portnumLabel(p.portnum),
          p.nodeInfo?.longName, p.nodeInfo?.shortName,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [packets, filterPort, filterSender, filterEncrypted, search, nodes]);

  const exportCsv = () => {
    const rows = filtered.map((p) => ({
      ts_iso: new Date(p.receivedAt).toISOString(),
      packet_id: '!' + p.id.toString(16).padStart(8, '0'),
      from: fullHex(p.from),
      from_short: nameFor(nodes, p.from),
      to: p.to === BROADCAST ? 'broadcast' : fullHex(p.to),
      to_short: p.to === BROADCAST ? 'broadcast' : nameFor(nodes, p.to),
      channel: String(p.channel),
      portnum: portnumLabel(p.portnum),
      portnum_num: String(p.portnum ?? ''),
      encrypted: p.encrypted ? '1' : '0',
      hops_taken: p.hopStart > 0 ? String(p.hopStart - p.hopLimit) : '',
      hops_start: String(p.hopStart),
      rssi_dbm: p.rxRssi !== 0 ? String(p.rxRssi) : '',
      snr_db: p.rxSnr ? p.rxSnr.toFixed(2) : '',
      text: p.text ?? '',
    }));
    downloadCsv(rows, 'packets');
  };

  return (
    <div>
      <div className="card" style={{ padding: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="text" value={filterPort} onChange={(e) => setFilterPort(e.target.value === 'all' ? 'all' : Number(e.target.value))} style={{ width: 180 }}>
            <option value="all">All portnums</option>
            {portnumsSeen.map((p) => <option key={p} value={p}>{portnumLabel(p)} ({p})</option>)}
          </select>
          <select className="text" value={filterSender} onChange={(e) => setFilterSender(e.target.value === 'all' ? 'all' : Number(e.target.value))} style={{ width: 200 }}>
            <option value="all">All senders</option>
            {senders.map((n) => <option key={n} value={n}>{nameFor(nodes, n)} · {fullHex(n)}</option>)}
          </select>
          <select className="text" value={filterEncrypted} onChange={(e) => setFilterEncrypted(e.target.value as any)} style={{ width: 150 }}>
            <option value="all">Any encryption</option>
            <option value="yes">Encrypted only</option>
            <option value="no">Decoded only</option>
          </select>
          <input className="text" placeholder="search text/name/portnum…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <button
            className={paused ? 'primary' : 'ghost'}
            style={{ padding: '4px 12px', fontSize: 12 }}
            onClick={() => setPaused(!paused)}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={exportCsv} disabled={filtered.length === 0}>⇩ CSV</button>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-faint)' }}>
          showing {filtered.length} of {packets.length} buffered packet{packets.length === 1 ? '' : 's'}
          {paused && <span style={{ color: 'var(--warn)' }}> · paused</span>}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <div className="empty" style={{ padding: 18 }}>
            {packets.length === 0
              ? state.status === 'ready' ? 'Waiting for packets…' : 'Connect to a radio first.'
              : 'No packets match the current filters.'}
          </div>
        ) : (
          <table className="data" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>From</th>
                <th>To</th>
                <th>Port</th>
                <th>Hops</th>
                <th>RSSI</th>
                <th>SNR</th>
                <th>Preview</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((p) => {
                const key = `${p.id}-${p.receivedAt}`;
                const expanded = expandedId === key;
                const isFromMe = myNum === p.from;
                return (
                  <React.Fragment key={key}>
                    <tr
                      onClick={() => setExpandedId(expanded ? null : key)}
                      style={{ cursor: 'pointer', background: expanded ? 'var(--bg-elev-2)' : undefined }}
                    >
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{fmtAbsTime(p.receivedAt)}</td>
                      <td>
                        <span style={{ color: isFromMe ? 'var(--good)' : colorForNode(p.from) }}>{nameFor(nodes, p.from)}</span>
                        {isFromMe && <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--text-faint)' }}>(me)</span>}
                      </td>
                      <td>
                        {p.to === BROADCAST ? (
                          <span style={{ color: 'var(--text-faint)' }}># ch{p.channel}</span>
                        ) : (
                          <span style={{ color: colorForNode(p.to) }}>{nameFor(nodes, p.to)}</span>
                        )}
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                        {portnumLabel(p.portnum)}
                        {p.encrypted && <span style={{ marginLeft: 4 }} title="encrypted — no channel key">🔒</span>}
                      </td>
                      <td style={{ fontFamily: 'var(--mono)' }}>
                        {p.hopStart > 0 ? `${p.hopStart - p.hopLimit}/${p.hopStart}` : '—'}
                      </td>
                      <td style={{ color: `var(--${rssiTone(p.rxRssi)})`, fontFamily: 'var(--mono)' }}>
                        {p.rxRssi !== 0 ? p.rxRssi : '—'}
                      </td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{p.rxSnr ? p.rxSnr.toFixed(1) : '—'}</td>
                      <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-dim)', fontSize: 11.5 }}>
                        <PreviewCell p={p} />
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={8} style={{ background: 'var(--bg-elev-2)', padding: 14 }}>
                          <DetailView p={p} nodes={nodes} onMessageNode={onMessageNode} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {filtered.length > 200 && (
          <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-faint)', borderTop: '1px solid var(--line)' }}>
            Showing newest 200 of {filtered.length} matching packets. Tighten filters to narrow further.
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewCell({ p }: { p: CapturedPacket }) {
  if (p.text) return <span style={{ fontFamily: 'inherit', color: 'var(--text)' }}>"{p.text}"</span>;
  if (p.position && (p.position.lat !== 0 || p.position.lon !== 0)) return <span>{p.position.lat.toFixed(4)}, {p.position.lon.toFixed(4)}{p.position.altitude ? ` · ${p.position.altitude}m` : ''}</span>;
  if (p.nodeInfo?.longName) return <span>name: {p.nodeInfo.longName}</span>;
  if (p.telemetry) {
    const bits: string[] = [];
    if (p.telemetry.batteryLevel !== undefined) bits.push(`${p.telemetry.batteryLevel}%`);
    if (p.telemetry.voltage) bits.push(`${p.telemetry.voltage.toFixed(2)}V`);
    if (p.telemetry.channelUtilization) bits.push(`${p.telemetry.channelUtilization.toFixed(1)}% ch`);
    return <span>{bits.join(' · ') || 'telemetry'}</span>;
  }
  if (p.routing) return <span>routing.error = {p.routing.errorReason}</span>;
  if (p.traceroute) return <span>route hops: {p.traceroute.route.length}</span>;
  if (p.encrypted) return <span style={{ color: 'var(--text-faint)' }}>encrypted ({p.channel === 0 ? 'default channel' : `ch${p.channel}`})</span>;
  return <span style={{ color: 'var(--text-faint)' }}>(no decoded payload)</span>;
}

function DetailView({ p, nodes, onMessageNode }: { p: CapturedPacket; nodes: NodeRecord[]; onMessageNode?: (n: number) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
      <div>
        <h4 style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>MeshPacket fields</h4>
        <dl className="kv kv-tight" style={{ fontSize: 12 }}>
          <dt>id</dt><dd>!{p.id.toString(16).padStart(8, '0')}</dd>
          <dt>from</dt><dd>{nameFor(nodes, p.from)} · {fullHex(p.from)}</dd>
          <dt>to</dt><dd>{p.to === BROADCAST ? 'broadcast (0xFFFFFFFF)' : `${nameFor(nodes, p.to)} · ${fullHex(p.to)}`}</dd>
          <dt>channel</dt><dd>{p.channel}</dd>
          <dt>portnum</dt><dd>{portnumLabel(p.portnum)} ({p.portnum ?? '—'})</dd>
          <dt>hopStart</dt><dd>{p.hopStart}</dd>
          <dt>hopLimit</dt><dd>{p.hopLimit}{p.hopStart > 0 ? ` · taken ${p.hopStart - p.hopLimit}` : ''}</dd>
          <dt>rxRssi</dt><dd>{p.rxRssi !== 0 ? `${p.rxRssi} dBm` : '—'}</dd>
          <dt>rxSnr</dt><dd>{p.rxSnr ? `${p.rxSnr.toFixed(2)} dB` : '—'}</dd>
          <dt>rxTime</dt><dd>{p.rxTime ? new Date(p.rxTime * 1000).toLocaleString() : '—'}</dd>
          {p.viaMqtt && <><dt>viaMqtt</dt><dd style={{ color: 'var(--warn)' }}>yes</dd></>}
          {p.encrypted && <><dt>encrypted</dt><dd style={{ color: 'var(--warn)' }}>yes — no key for channel {p.channel}</dd></>}
          {p.requestId && <><dt>requestId</dt><dd>!{p.requestId.toString(16).padStart(8, '0')}</dd></>}
        </dl>
        {onMessageNode && p.from !== p.to && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <button className="primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => onMessageNode(p.from)}>Message sender</button>
          </div>
        )}
      </div>

      <div>
        <h4 style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Decoded payload</h4>
        {p.text && (
          <div style={{ padding: 10, background: 'var(--bg)', borderRadius: 4, fontFamily: 'inherit', fontSize: 13 }}>"{p.text}"</div>
        )}
        {p.position && (
          <dl className="kv kv-tight" style={{ fontSize: 12 }}>
            <dt>lat</dt><dd>{p.position.lat.toFixed(6)}</dd>
            <dt>lon</dt><dd>{p.position.lon.toFixed(6)}</dd>
            <dt>altitude</dt><dd>{p.position.altitude} m</dd>
            <dt>time</dt><dd>{p.position.time ? new Date(p.position.time * 1000).toLocaleString() : '—'}</dd>
            {p.position.precisionBits !== undefined && <><dt>precision</dt><dd>{p.position.precisionBits} bits</dd></>}
          </dl>
        )}
        {p.nodeInfo && (
          <dl className="kv kv-tight" style={{ fontSize: 12 }}>
            {p.nodeInfo.id && <><dt>id</dt><dd>{p.nodeInfo.id}</dd></>}
            <dt>shortName</dt><dd>{p.nodeInfo.shortName}</dd>
            <dt>longName</dt><dd>{p.nodeInfo.longName}</dd>
            <dt>hwModel</dt><dd>{p.nodeInfo.hwModel}</dd>
            {p.nodeInfo.macaddr && <><dt>macaddr</dt><dd>{p.nodeInfo.macaddr}</dd></>}
            {p.nodeInfo.role !== undefined && <><dt>role</dt><dd>{p.nodeInfo.role}</dd></>}
          </dl>
        )}
        {p.telemetry && (
          <dl className="kv kv-tight" style={{ fontSize: 12 }}>
            {p.telemetry.batteryLevel !== undefined && <><dt>battery</dt><dd>{p.telemetry.batteryLevel}%</dd></>}
            {p.telemetry.voltage !== undefined && <><dt>voltage</dt><dd>{p.telemetry.voltage.toFixed(2)} V</dd></>}
            {p.telemetry.channelUtilization !== undefined && <><dt>channelUtilization</dt><dd>{p.telemetry.channelUtilization.toFixed(2)}%</dd></>}
            {p.telemetry.airUtilTx !== undefined && <><dt>airUtilTx</dt><dd>{p.telemetry.airUtilTx.toFixed(2)}%</dd></>}
            {p.telemetry.uptimeSeconds !== undefined && <><dt>uptimeSeconds</dt><dd>{p.telemetry.uptimeSeconds}</dd></>}
            {p.telemetry.temperature !== undefined && <><dt>temperature</dt><dd>{p.telemetry.temperature.toFixed(2)} °C</dd></>}
            {p.telemetry.humidity !== undefined && <><dt>humidity</dt><dd>{p.telemetry.humidity.toFixed(1)}%</dd></>}
          </dl>
        )}
        {p.routing && (
          <dl className="kv kv-tight" style={{ fontSize: 12 }}>
            <dt>errorReason</dt><dd>{p.routing.errorReason} {p.routing.errorReason === 0 ? '(NONE = ack)' : '(error)'}</dd>
          </dl>
        )}
        {p.traceroute && (
          <dl className="kv kv-tight" style={{ fontSize: 12 }}>
            <dt>route</dt><dd>{p.traceroute.route.length === 0 ? '(direct)' : p.traceroute.route.map((n) => nameFor(nodes, n)).join(' → ')}</dd>
            <dt>hops</dt><dd>{p.traceroute.route.length}</dd>
          </dl>
        )}
        {!p.text && !p.position && !p.nodeInfo && !p.telemetry && !p.routing && !p.traceroute && (
          <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>
            {p.encrypted
              ? 'Encrypted payload — your radio doesn\'t have the key for channel ' + p.channel + ', so the bytes are passed through unparsed.'
              : 'No decoded payload sub-message available.'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Stats tab
// ─────────────────────────────────────────────────────────────────────

function StatsTab({ packets, nodes }: { packets: CapturedPacket[]; nodes: NodeRecord[] }) {
  const stats = useMemo(() => {
    const byPort = new Map<number, number>();
    const bySender = new Map<number, number>();
    const rssiHist = new Array(13).fill(0); // -130..0 in 10 dB bins
    let encrypted = 0;
    let direct = 0;
    let relayed = 0;
    for (const p of packets) {
      const port = p.portnum ?? -1;
      byPort.set(port, (byPort.get(port) ?? 0) + 1);
      bySender.set(p.from, (bySender.get(p.from) ?? 0) + 1);
      if (p.rxRssi !== 0) {
        const bin = Math.max(0, Math.min(12, Math.floor((p.rxRssi + 130) / 10)));
        rssiHist[bin]++;
      }
      if (p.encrypted) encrypted++;
      if (p.hopStart > 0 && p.hopStart - p.hopLimit === 0) direct++;
      if (p.hopStart > 0 && p.hopStart - p.hopLimit > 0) relayed++;
    }
    return {
      byPort: Array.from(byPort.entries()).sort((a, b) => b[1] - a[1]),
      bySender: Array.from(bySender.entries()).sort((a, b) => b[1] - a[1]),
      rssiHist,
      encrypted, total: packets.length, direct, relayed,
    };
  }, [packets]);

  const portMax = Math.max(1, ...stats.byPort.map(([, c]) => c));
  const senderMax = Math.max(1, ...stats.bySender.map(([, c]) => c));
  const rssiMax = Math.max(1, ...stats.rssiHist);

  if (packets.length === 0) {
    return <div className="card"><div className="empty">No packets in the buffer yet.</div></div>;
  }

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Portnum distribution</h2>
          {stats.byPort.map(([port, count]) => (
            <div key={port} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 50px', gap: 8, alignItems: 'center', padding: '3px 0' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{portnumLabel(port)}</span>
              <div style={{ background: 'var(--bg-elev-2)', height: 8, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(count / portMax) * 100}%`, height: '100%', background: 'var(--accent)' }} />
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, textAlign: 'right', color: 'var(--text-faint)' }}>{count}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Top 10 senders</h2>
          {stats.bySender.slice(0, 10).map(([num, count]) => (
            <div key={num} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 50px', gap: 8, alignItems: 'center', padding: '3px 0' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: colorForNode(num), overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameFor(nodes, num)}</span>
              <div style={{ background: 'var(--bg-elev-2)', height: 8, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(count / senderMax) * 100}%`, height: '100%', background: colorForNode(num) }} />
              </div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, textAlign: 'right', color: 'var(--text-faint)' }}>{count}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>RSSI histogram</h2>
          <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 120, padding: '6px 0' }}>
            {stats.rssiHist.map((count, i) => {
              const rssiCenter = -130 + i * 10 + 5;
              const tone = rssiCenter > -85 ? 'var(--good)' : rssiCenter > -110 ? 'var(--warn)' : 'var(--bad)';
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'flex-end' }}>
                    <div title={`${count} packets in ${-130 + i * 10}..${-120 + i * 10} dBm`} style={{ width: '100%', height: `${(count / rssiMax) * 100}%`, background: tone, borderRadius: 2 }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>{rssiCenter}</div>
                </div>
              );
            })}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>dBm bins · green {'>'}-85 · warn {'>'}-110 · bad {'≤'}-110</p>
        </div>
      </div>

      <div>
        <div className="range-grid">
          <Metric label="Total" value={String(stats.total)} />
          <Metric label="Encrypted" value={stats.total > 0 ? `${stats.encrypted} (${((stats.encrypted / stats.total) * 100).toFixed(0)}%)` : '—'} tone={stats.encrypted / Math.max(1, stats.total) > 0.5 ? 'warn' : 'dim'} hint="No channel key — bytes unparsed" />
          <Metric label="Direct (hop 0)" value={String(stats.direct)} tone="good" hint="off-the-air receptions" />
          <Metric label="Relayed" value={String(stats.relayed)} tone="warn" hint="forwarded by another node" />
        </div>

        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What this tells you.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            A healthy mesh has a roughly bell-shaped RSSI histogram centered around -100 to -110 dBm (typical sub-urban LoRa). If yours is heavily skewed to {'<'}-120 you're at the edge of the mesh — direct reception is rare. A spike at the top of the chart ({'>'}-60) suggests a node sitting right next to you.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Encrypted packets.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            These are packets on channels your radio doesn't have the key for. They count toward channel utilization but you can't read the contents. To decode them, add the channel + matching key in the official Meshtastic setup app.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Reference tab — frame structure docs (now accurate)
// ─────────────────────────────────────────────────────────────────────

function ReferenceTab() {
  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Wire format</h2>
          <pre style={{ background: 'var(--bg)', padding: 12, borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, margin: 0, overflowX: 'auto', lineHeight: 1.5 }}>
{`USB serial frame:
  [0x94] [0xC3] [len-MSB] [len-LSB] [protobuf payload...]

FromRadio (top-level oneof):
  field 1   uint32       packet id (envelope-level)
  field 2   MeshPacket   live RF packet           ← what this panel decodes
  field 3   MyNodeInfo   device identity
  field 4   NodeInfo     peer in node DB
  field 5   Config       radio config (lora, device, position, etc.)
  field 6   LogRecord    firmware log
  field 7   uint32       config_complete_id
  field 8   bool         rebooted
  field 9   ModuleConfig module config
  field 10  Channel      channel definition
  field 11  QueueStatus  TX queue status
  field 12  DeviceMetadata
  ...

MeshPacket:
  field 1   fixed32   from           ← node num as LE 4-byte
  field 2   fixed32   to             ← node num or 0xFFFFFFFF for broadcast
  field 3   uint32    channel
  field 4   Data      decoded         ← if we have channel key
  field 5   bytes     encrypted       ← if we don't
  field 6   fixed32   id              ← packet id (for ack matching)
  field 7   fixed32   rx_time
  field 8   float     rx_snr
  field 9   uint32    hop_limit
  field 10  bool      want_ack
  field 11  Priority  priority
  field 12  sint32    rx_rssi
  field 14  bool      via_mqtt
  field 15  uint32    hop_start

Data (Meshtastic-app payload):
  field 1   PortNum   portnum         ← TELEMETRY/POSITION/TEXT/...
  field 2   bytes     payload         ← per-portnum protobuf
  field 3   bool      want_response
  field 6   fixed32   request_id      ← matches a previous packet's id`}
          </pre>
        </div>

        <div className="card">
          <h2>Common portnums</h2>
          <table className="data" style={{ fontSize: 11.5 }}>
            <thead><tr><th>#</th><th>Name</th><th>What's inside</th></tr></thead>
            <tbody>
              <tr><td>1</td><td>TEXT_MESSAGE</td><td>UTF-8 text · the chat protocol</td></tr>
              <tr><td>3</td><td>POSITION</td><td>lat/lon/altitude/precision · GPS broadcasts</td></tr>
              <tr><td>4</td><td>NODEINFO</td><td>identity (long/short name, hw model, role)</td></tr>
              <tr><td>5</td><td>ROUTING</td><td>acks + error codes</td></tr>
              <tr><td>6</td><td>ADMIN</td><td>configuration commands (we send setOwner / setConfig here)</td></tr>
              <tr><td>67</td><td>TELEMETRY</td><td>device / environment / power / local-stats metrics</td></tr>
              <tr><td>70</td><td>TRACEROUTE</td><td>hop-by-hop path discovery</td></tr>
              <tr><td>71</td><td>NEIGHBORINFO</td><td>list of direct neighbors</td></tr>
              <tr><td>73</td><td>MAP_REPORT</td><td>opt-in upload to meshtastic.org/map</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What "encrypted" means here.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            If your radio receives a packet on a channel it has a key for, it decrypts the bytes and hands us a <code>Data</code> sub-message with a portnum. If not, the radio passes the raw encrypted blob through and we can see the envelope (from / to / hops / RSSI) but not the contents.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What RSSI tells you.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Higher = stronger. <code>0 dBm</code> = 1 mW at the antenna. Real LoRa lands between <code>−40 dBm</code> (very close) and <code>−130 dBm</code> (the absolute floor). Free space loss adds ~6 dB per doubled distance — so going from <code>−80</code> to <code>−92</code> didn't fade, the node moved 4× farther.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What SNR tells you.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            For LoRa specifically: SNR can be <em>negative</em> and still decode, because chirp spreading effectively integrates over multiple symbol times. LongFast can pull packets out from <code>−20 dB</code> SNR. ShortTurbo bails out around <code>0 dB</code>.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function Metric({ label, value, tone, hint }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'dim'; hint?: string }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : tone === 'dim' ? 'var(--text-faint)' : 'var(--text)';
  return (
    <div className="range-card">
      <div className="label">{label}</div>
      <div className="value" style={{ color }}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function downloadCsv(rows: Array<Record<string, string>>, suffix: string): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const body = rows.map((r) => headers.map((h) => escCsv(r[h])).join(',')).join('\n');
  const csv = headers.join(',') + '\n' + body + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url; a.download = `mesh-${suffix}-${stamp}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escCsv(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
