import React, { useEffect, useState } from 'react';
import { useActiveConnId } from '../../hooks/MeshContext';
import { PanelChannelHeader } from '../PanelChannelHeader';
import { nodeIdHex } from '../../lib/node-identity';
import type { TabId } from '../TopNav';
import { useAntennaOverrides } from '../../hooks/useAntennaOverrides';
import { useOwnedAntennas } from '../../hooks/useOwnedRosters';
import { ANTENNA_CATALOG } from '../../lib/antenna-catalog';
import { ROLE_NAMES } from '../../lib/device-roles';

const STALE_S = 24 * 3600;
const AGING_S = 3600;

function ago(secs?: number): string {
  if (!secs) return '—';
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - secs);
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

function freshness(secs?: number): 'fresh' | 'aging' | 'stale' | 'never' {
  if (!secs) return 'never';
  const d = Math.floor(Date.now() / 1000) - secs;
  if (d < AGING_S) return 'fresh';
  if (d < STALE_S) return 'aging';
  return 'stale';
}

function rssiClass(rssi?: number): string {
  if (rssi === undefined || rssi === 0) return 'idle';
  if (rssi > -85) return 'good';
  if (rssi > -110) return 'warn';
  return 'bad';
}

function snrBars(snr?: number): number {
  if (snr === undefined) return 0;
  if (snr > 5) return 4;
  if (snr > 0) return 3;
  if (snr > -7) return 2;
  if (snr > -15) return 1;
  return 0;
}

type SortKey =
  | 'smart'
  | 'shortName'
  | 'longName'
  | 'num'
  | 'hwModelName'
  | 'viaMqtt'
  | 'hopsAway'
  | 'snr'
  | 'rssi'
  | 'batteryLevel'
  | 'lastHeard';
type SortDir = 'asc' | 'desc';

/**
 * Star toggle that calls the radio's admin port to set/clear the node's
 * is_favorite flag. The controller optimistically updates its local
 * record so the UI flips immediately; the radio's next NodeInfo
 * broadcast confirms the new state on its end. Self-favorite is
 * disallowed (the radio doesn't accept it).
 */
function FavoriteToggle({ node, disabled }: { node: NodeRecord; disabled?: boolean }) {
  const connId = useActiveConnId();

  // "Me" row gets a non-toggle home glyph instead of the star — clearer
  // than just dimming the star, and it instantly orients you when
  // scrolling the table.
  if (disabled) {
    return (
      <span
        className="fav-toggle me-marker"
        data-me="1"
        title="This is your radio (the one this app is connected to)."
      >
        ⌂
      </span>
    );
  }

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const hex = (node.num >>> 0).toString(16).padStart(8, '0');
    console.log(`[favorite] click !${hex} current=${node.isFavorite ? 'yes' : 'no'} connId=${connId}`);
    if (!connId) { console.warn('[favorite] no active connId — ignoring'); return; }
    try {
      const ok = await window.mesh.setFavoriteNode({ connId, nodeNum: node.num, favorite: !node.isFavorite });
      console.log(`[favorite] IPC returned ${ok}`);
    } catch (err) {
      console.error('[favorite] IPC error', err);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!connId}
      className="fav-toggle"
      data-fav={node.isFavorite ? '1' : '0'}
      title={node.isFavorite
        ? 'Favorited on this radio\'s nodeDB. Click to remove.'
        : 'Favorite this node on the radio. Persists across reboots.'}
    >
      {node.isFavorite ? '★' : '☆'}
    </button>
  );
}

/**
 * "Smart" default sort. Puts the most actionable rows at the top:
 *   1. Me (the radio you're connected to)
 *   2. Freshness tier — fresh / aging / stale / never
 *   3. RF before MQTT (your local neighbours before internet relays)
 *   4. Hops ascending (closer in the routing graph = higher priority)
 *   5. Recency
 */
function freshnessRank(secs?: number): number {
  if (!secs) return 3; // never heard
  const d = Math.floor(Date.now() / 1000) - secs;
  if (d < AGING_S) return 0;
  if (d < STALE_S) return 1;
  return 2;
}

function smartCompare(a: NodeRecord, b: NodeRecord, myNum?: number): number {
  if (myNum !== undefined) {
    if (a.num === myNum) return -1;
    if (b.num === myNum) return 1;
  }
  // Favorites bubble up just below "me" — that's the whole point of
  // marking them.
  const fav = (a.isFavorite ? 1 : 0) - (b.isFavorite ? 1 : 0);
  if (fav !== 0) return -fav;
  const fa = freshnessRank(a.lastHeard);
  const fb = freshnessRank(b.lastHeard);
  if (fa !== fb) return fa - fb;
  const sa = a.viaMqtt ? 1 : 0;
  const sb = b.viaMqtt ? 1 : 0;
  if (sa !== sb) return sa - sb;
  const ha = a.hopsAway ?? 99;
  const hb = b.hopsAway ?? 99;
  if (ha !== hb) return ha - hb;
  return (b.lastHeard ?? 0) - (a.lastHeard ?? 0);
}

/**
 * Column-by-column comparator. Nulls/missing values always sort to the
 * END of the list regardless of direction — otherwise asc-sort by SNR
 * puts every node-we-have-no-SNR-for at the top, which is useless. The
 * `dir` only flips the relative order of rows that have a real value.
 */
function compareByKey(a: NodeRecord, b: NodeRecord, key: SortKey, dir: SortDir, myNum?: number): number {
  if (key === 'smart') return smartCompare(a, b, myNum);

  const av = sortFieldOf(a, key);
  const bv = sortFieldOf(b, key);
  const aMissing = av === null;
  const bMissing = bv === null;
  if (aMissing && bMissing) return (a.shortName || '').localeCompare(b.shortName || '');
  if (aMissing) return 1;
  if (bMissing) return -1;

  let cmp: number;
  if (typeof av === 'string') cmp = av.localeCompare(bv as string);
  else cmp = (av as number) - (bv as number);
  return dir === 'asc' ? cmp : -cmp;
}

function sortFieldOf(n: NodeRecord, key: SortKey): string | number | null {
  switch (key) {
    case 'shortName':    return n.shortName || null;
    case 'longName':     return n.longName || null;
    case 'num':          return n.num;
    case 'hwModelName':  return n.hwModelName || null;
    case 'viaMqtt':      return n.viaMqtt ? 1 : 0;
    case 'hopsAway':     return n.hopsAway ?? null;
    case 'snr':          return n.snr ?? null;
    case 'rssi':         return n.rssi ?? null;
    case 'batteryLevel': return n.batteryLevel ?? null;
    case 'lastHeard':    return n.lastHeard ?? null;
    default:             return null;
  }
}

/** Default sort direction for a column when first clicked. Higher-is-better
 *  fields default to desc; identity/categorical fields default to asc. */
function defaultDirFor(key: SortKey): SortDir {
  switch (key) {
    case 'snr':
    case 'rssi':
    case 'batteryLevel':
    case 'lastHeard':
      return 'desc';
    default:
      return 'asc';
  }
}

function precisionMeters(bits?: number): number | undefined {
  if (!bits || bits >= 32) return undefined;
  return (360 / Math.pow(2, bits)) * 111000;
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLon * sinDLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Free-space path loss at 915 MHz baseline. distance in km. */
function fsplDb(distanceKm: number, freqMHz: number = 915): number {
  if (distanceKm <= 0) return 0;
  return 20 * Math.log10(distanceKm) + 20 * Math.log10(freqMHz) + 32.44;
}

type SourceFilter = 'all' | 'rf' | 'mqtt';

export function NodesPanel({ nodes, state, onMessageNode, go }: { nodes: NodeRecord[]; state: ConnectionState; onMessageNode?: (num: number) => void; go?: (id: TabId) => void }) {
  const heard = nodes.filter((n) => n.lastHeard);
  const direct = heard.filter((n) => (n.hopsAway ?? 0) === 0).length;
  const relayed = heard.filter((n) => (n.hopsAway ?? 0) > 0).length;
  const staleCount = nodes.filter((n) => freshness(n.lastHeard) === 'stale').length;
  const mqttCount = nodes.filter((n) => n.viaMqtt).length;

  const [selectedNum, setSelectedNum] = useState<number | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('smart');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const filteredNodes = nodes
    .filter((n) => {
      if (sourceFilter === 'rf') return !n.viaMqtt;
      if (sourceFilter === 'mqtt') return !!n.viaMqtt;
      return true;
    })
    .slice()
    .sort((a, b) => compareByKey(a, b, sortKey, sortDir, state.myInfo?.myNodeNum));

  const onHeaderClick = (key: SortKey) => () => {
    if (sortKey === key) {
      // Same column: toggle direction, but if you're on the smart default
      // and click anything, switch to that column at its natural default.
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(defaultDirFor(key));
    }
  };

  const sortInd = (key: SortKey) => {
    if (sortKey !== key) return null;
    return <span className="sort-ind">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };
  const thClass = (key: SortKey) => 'sortable' + (sortKey === key ? ' active' : '');
  const selected = selectedNum !== null ? nodes.find((n) => n.num === selectedNum) : null;
  const me = nodes.find((n) => n.num === state.myInfo?.myNodeNum);

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 className="page-title">Nodes</h1>
          <p className="page-sub">
            Every node your radio has heard since it powered on. Click a row for detail. Direct = picked up off the air; Relayed = forwarded through another node.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <BroadcastNodeInfoButton state={state} />
          <NodeRefreshButton />
        </div>
      </div>

      <PanelChannelHeader state={state} label="LISTENING ON" />

      <div className="layout-split-wide">
        <div>
          <div className="card">
            <div style={{ display: 'flex', gap: 18, marginBottom: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <Stat label="Total known" value={String(nodes.length)} />
              <Stat label="Heard" value={String(heard.length)} />
              <Stat label="Direct" value={String(direct)} />
              <Stat label="Relayed" value={String(relayed)} />
              <Stat label="Stale" value={String(staleCount)} />
              {mqttCount > 0 && <Stat label="Via MQTT" value={String(mqttCount)} />}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
                {sortKey !== 'smart' && (
                  <button
                    className="ghost"
                    style={{ padding: '3px 9px', fontSize: 11 }}
                    onClick={() => { setSortKey('smart'); setSortDir('asc'); }}
                    title="Reset to smart default: me first, then fresh RF neighbours, then MQTT, then stale."
                  >
                    ↻ smart sort
                  </button>
                )}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>source:</span>
                  {(['all', 'rf', 'mqtt'] as SourceFilter[]).map((f) => (
                    <button
                      key={f}
                      className={'ghost' + (sourceFilter === f ? ' active' : '')}
                      style={{ padding: '3px 9px', fontSize: 11, opacity: sourceFilter === f ? 1 : 0.7 }}
                      onClick={() => setSourceFilter(f)}
                      disabled={f === 'mqtt' && mqttCount === 0}
                      title={f === 'mqtt' && mqttCount === 0 ? 'No MQTT-sourced nodes detected yet' : undefined}
                    >
                      {f === 'all' ? 'all' : f === 'rf' ? 'RF only' : 'MQTT only'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {nodes.length === 0 && (
              <div className="empty">
                {state.status === 'ready'
                  ? 'No nodes yet. Mesh traffic is sparse — give it a few minutes, or transmit something to wake the channel.'
                  : 'Connect to your node to see who it has heard.'}
              </div>
            )}

            {nodes.length > 0 && (
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 28, textAlign: 'center' }} title="Favorite">★</th>
                    <th className={thClass('shortName')}    onClick={onHeaderClick('shortName')}>Short{sortInd('shortName')}</th>
                    <th className={thClass('longName')}     onClick={onHeaderClick('longName')}>Long name{sortInd('longName')}</th>
                    <th className={thClass('num')}          onClick={onHeaderClick('num')}>ID{sortInd('num')}</th>
                    <th className={thClass('hwModelName')}  onClick={onHeaderClick('hwModelName')}>Hardware{sortInd('hwModelName')}</th>
                    <th className={thClass('viaMqtt')}      onClick={onHeaderClick('viaMqtt')}>Src{sortInd('viaMqtt')}</th>
                    <th className={thClass('hopsAway')}     onClick={onHeaderClick('hopsAway')}>Hops{sortInd('hopsAway')}</th>
                    <th className={thClass('snr')}          onClick={onHeaderClick('snr')}>SNR{sortInd('snr')}</th>
                    <th className={thClass('rssi')}         onClick={onHeaderClick('rssi')}>RSSI{sortInd('rssi')}</th>
                    <th className={thClass('batteryLevel')} onClick={onHeaderClick('batteryLevel')}>Battery{sortInd('batteryLevel')}</th>
                    <th className={thClass('lastHeard')}    onClick={onHeaderClick('lastHeard')}>Heard{sortInd('lastHeard')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNodes.map((n) => {
                    const fr = freshness(n.lastHeard);
                    const isMe = state.myInfo?.myNodeNum === n.num;
                    return (
                      <tr
                        key={n.num}
                        onClick={() => setSelectedNum(n.num)}
                        style={{
                          cursor: 'pointer',
                          opacity: fr === 'stale' ? 0.55 : 1,
                          background: selectedNum === n.num ? 'var(--bg-elev-2)' : undefined,
                        }}
                      >
                        <td style={{ textAlign: 'center', padding: 0 }}>
                          <FavoriteToggle node={n} disabled={isMe} />
                        </td>
                        <td style={{ color: 'var(--accent)' }}>{n.shortName || '????'}</td>
                        <td style={{ fontFamily: 'inherit' }}>
                          {n.longName || '(no name)'}
                          {isMe && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-faint)' }}>(me)</span>}
                          {fr === 'stale' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--warn)' }}>stale</span>}
                          {fr === 'aging' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-faint)' }}>quiet</span>}
                        </td>
                        <td style={{ color: 'var(--text-faint)' }}>{nodeIdHex(n.num)}</td>
                        <td>{n.hwModelName}</td>
                        <td>
                          {n.viaMqtt
                            ? <span className="src-chip src-mqtt" title="Heard via the radio's MQTT bridge — not on the local airwaves">MQTT</span>
                            : <span className="src-chip src-rf" title="Heard over the air (RF) by the connected radio">RF</span>}
                        </td>
                        <td>
                          <span className={`dot ${(n.hopsAway ?? 0) === 0 ? 'good' : 'warn'}`}></span>
                          {n.hopsAway ?? '—'}
                        </td>
                        <td>
                          <span className="signal-meter">
                            {[1, 2, 3, 4].map((i) => (
                              <span key={i} className={i <= snrBars(n.snr) ? 'on' : ''} />
                            ))}
                          </span>
                          {' '}{n.snr !== undefined ? n.snr.toFixed(1) : '—'}
                        </td>
                        <td>
                          <span className={`dot ${rssiClass(n.rssi)}`}></span>
                          {n.rssi ?? '—'}
                        </td>
                        <td>
                          {n.batteryLevel !== undefined ? (
                            <span>
                              <span className="bar" style={{ display: 'inline-block', width: 36, marginRight: 6 }}>
                                <div style={{ width: `${Math.min(100, n.batteryLevel)}%` }} />
                              </span>
                              {n.batteryLevel}%
                            </span>
                          ) : '—'}
                        </td>
                        <td>{ago(n.lastHeard)}</td>
                        <td>
                          {onMessageNode && !isMe && (
                            <button
                              className="primary"
                              style={{ padding: '2px 8px', fontSize: 11 }}
                              onClick={(e) => { e.stopPropagation(); onMessageNode(n.num); }}
                              disabled={state.status !== 'ready'}
                              title="Open a direct chat with this node"
                            >
                              Message
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          {selected ? (
            <NodeDetail node={selected} me={me} state={state} onMessage={onMessageNode} onClose={() => setSelectedNum(null)} go={go} />
          ) : (
            <>
              <div className="info-card">
                <p><strong>Reading the columns</strong></p>
                <p><strong>Hops</strong> = how many radios relayed the packet to you. 0 means direct line-of-sight RF.</p>
                <p><strong>SNR</strong> (Signal-to-Noise Ratio in dB) is the better quality metric for LoRa. LoRa can decode down to about <code>−20 dB</code> SNR thanks to chirp spreading.</p>
                <p><strong>RSSI</strong> is raw received power in dBm. Below <code>−120 dBm</code> the receiver gives up.</p>
                <p style={{ margin: 0 }}>Click any row to see the full record for that node, plus a line-of-sight estimate vs. measured signal.</p>
              </div>

              <div className="card">
                <h3>Why "stale"?</h3>
                <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12.5 }}>
                  Nodes that haven't been heard in 24 hours are dimmed. They're not gone — your radio just hasn't picked up a packet from them recently. Could be off, out of range, or simply quiet. Their last-known position and identity are kept so the map and chat history stay useful.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NodeDetail({
  node,
  me,
  state,
  onMessage,
  onClose,
  go,
}: {
  node: NodeRecord;
  me: NodeRecord | undefined;
  state: ConnectionState;
  onMessage?: (n: number) => void;
  onClose: () => void;
  go?: (id: TabId) => void;
}) {
  const connId = useActiveConnId();
  const fr = freshness(node.lastHeard);
  const isMe = state.myInfo?.myNodeNum === node.num;
  const txPower = state.loraConfig?.txPower || 17; // sane default
  const distance = me?.lat && me?.lon && node.lat && node.lon
    ? haversineKm({ lat: me.lat, lon: me.lon }, { lat: node.lat, lon: node.lon })
    : null;
  const fspl = distance != null ? fsplDb(distance) : null;
  const measuredLoss = node.rssi !== undefined && node.rssi !== 0 ? txPower - node.rssi : null;
  const excessLoss = fspl != null && measuredLoss != null ? measuredLoss - fspl : null;
  const precM = precisionMeters(node.posPrecisionBits);

  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ margin: 0, color: 'var(--accent)', fontSize: 16, textTransform: 'none', letterSpacing: 0 }}>
          {node.shortName || '????'}
          {isMe && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-faint)' }}>(this is your radio)</span>}
        </h3>
        <button className="ghost" onClick={onClose} style={{ padding: '2px 8px', fontSize: 11 }}>×</button>
      </div>

      <dl className="kv">
        <dt>Long name</dt><dd style={{ fontFamily: 'inherit' }}>{node.longName || '—'}</dd>
        <dt>Node num</dt><dd>{nodeIdHex(node.num)}</dd>
        {node.id && <><dt>User id</dt><dd>{node.id}</dd></>}
        <dt>Hardware</dt><dd>{node.hwModelName || '—'}</dd>
        {node.role !== undefined && <><dt>Role</dt><dd>{ROLE_NAMES[node.role] ?? node.role}</dd></>}
        {node.macaddr && <><dt>MAC</dt><dd>{node.macaddr}</dd></>}
        <dt>Last heard</dt><dd>{ago(node.lastHeard)}{node.lastHeard ? ` (${new Date(node.lastHeard * 1000).toLocaleString()})` : ''}</dd>
        <dt>Source</dt>
        <dd>
          {node.viaMqtt
            ? <><span className="src-chip src-mqtt">MQTT</span> <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>via the radio's MQTT bridge — not on the airwaves</span></>
            : <><span className="src-chip src-rf">RF</span> <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>heard over the air by this radio</span></>}
        </dd>
        <dt>Hops away</dt><dd>{node.hopsAway ?? '—'}</dd>
        <dt>RSSI</dt><dd>{node.rssi !== undefined && node.rssi !== 0 ? `${node.rssi} dBm` : '—'}</dd>
        <dt>SNR</dt><dd>{node.snr !== undefined ? `${node.snr.toFixed(1)} dB` : '—'}</dd>
        <dt>Battery</dt><dd>{node.batteryLevel !== undefined ? `${node.batteryLevel}%` : '—'}</dd>
        <dt>Voltage</dt><dd>{node.voltage !== undefined ? `${node.voltage.toFixed(2)} V` : '—'}</dd>
        <dt>Channel util.</dt><dd>{node.channelUtilization !== undefined ? `${node.channelUtilization.toFixed(1)}%` : '—'}</dd>
        <dt>Air util TX</dt><dd>{node.airUtilTx !== undefined ? `${node.airUtilTx.toFixed(2)}%` : '—'}</dd>
        {node.lat !== undefined && node.lon !== undefined && (
          <>
            <dt>Position</dt><dd>{node.lat.toFixed(5)}, {node.lon.toFixed(5)}{precM ? ` (±${precM < 1000 ? Math.round(precM) + ' m' : (precM / 1000).toFixed(1) + ' km'})` : ''}</dd>
            <dt>Altitude</dt><dd>{node.altitude !== undefined ? `${node.altitude} m` : '—'}</dd>
          </>
        )}
        <dt>Packets seen</dt><dd>{node.packetCount}</dd>
      </dl>

      <AntennaOverrideEditor node={node} />


      {!isMe && (
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <button
            className="primary"
            onClick={() => onMessage?.(node.num)}
            disabled={state.status !== 'ready'}
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            Message
          </button>
          <button
            className="ghost"
            onClick={async () => {
              if (!connId) return;
              await window.mesh.sendTraceroute({ connId, to: node.num });
              // Jump to the Traceroute panel so the user sees the path
              // build up as relays answer. The new trace appears in the
              // panel's history with full timeline + hop breakdown.
              go?.('traceroute');
            }}
            disabled={state.status !== 'ready' || !connId}
            style={{ padding: '4px 10px', fontSize: 12 }}
            title="Send a traceroute to this node and open the Traceroute panel to watch the path build up."
          >
            Traceroute →
          </button>
        </div>
      )}

      {fr === 'stale' && (
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)', marginTop: 12 }}>
          <p style={{ margin: 0 }}><strong>Stale data.</strong> No packet heard from this node in over 24 hours. The fields above are the last known values — they might be wildly out of date. The node could be off, out of range, or simply silent (some sensors only transmit on change).</p>
        </div>
      )}

      {distance != null && (
        <div className="info-card" style={{ marginTop: 12 }}>
          <p><strong>Line-of-sight check.</strong></p>
          <p style={{ margin: '0 0 6px' }}>Distance from your radio: <strong>{distance < 1 ? `${(distance * 1000).toFixed(0)} m` : `${distance.toFixed(2)} km`}</strong></p>
          {fspl != null && <p style={{ margin: '0 0 6px' }}>Free-space path loss @ 915 MHz: <strong>{fspl.toFixed(1)} dB</strong> (best case, vacuum).</p>}
          {measuredLoss != null && <p style={{ margin: '0 0 6px' }}>Implied path loss from your TX power ({txPower} dBm) and their RSSI: <strong>{measuredLoss.toFixed(1)} dB</strong>.</p>}
          {excessLoss != null && (
            <p style={{ margin: 0, color: excessLoss > 25 ? 'var(--bad)' : excessLoss > 10 ? 'var(--warn)' : 'var(--good)' }}>
              Excess over free-space: <strong>{excessLoss.toFixed(1)} dB</strong>{' '}
              {excessLoss < 10
                ? '— effectively line-of-sight. Beautiful.'
                : excessLoss < 25
                  ? '— typical for sub-urban / a few buildings between you. Antenna upgrades pay off here.'
                  : '— heavy obstruction (terrain, dense buildings, foliage). The signal is doing real work to get to you. This is exactly where line-of-sight matters: clearing one Fresnel-zone obstacle could swing this 20+ dB.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 22, fontFamily: 'var(--mono)', marginTop: 2 }}>{value}</div>
    </div>
  );
}

/**
 * Manual "refresh nodeDB from radio" button. The controller already runs a
 * scheduled refresh every 15 min on its own — this exposes the same wantConfig
 * round-trip on demand for users who want fresh data right now.
 */
function NodeRefreshButton() {
  const connId = useActiveConnId();
  const [busy, setBusy] = useState(false);
  const [lastAt, setLastAt] = useState<number>(0);
  const [nowTick, setNowTick] = useState(0);

  // Poll the last-refresh timestamp every 5s so the "X ago" stays live.
  useEffect(() => {
    if (!connId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const t = await window.mesh.lastRefreshAt(connId);
        if (!cancelled) setLastAt(t);
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(() => { setNowTick((n) => n + 1); tick(); }, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [connId]);

  if (!connId) return null;
  const sinceMs = lastAt ? Math.max(0, Date.now() - lastAt) : 0;
  const sinceLabel = !lastAt ? 'never'
    : sinceMs < 60_000 ? 'just now'
    : sinceMs < 60 * 60_000 ? `${Math.floor(sinceMs / 60_000)}m ago`
    : `${Math.floor(sinceMs / (60 * 60_000))}h ago`;

  const onClick = async () => {
    setBusy(true);
    try { await window.mesh.refresh(connId); }
    finally { setTimeout(() => setBusy(false), 1500); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
      <button
        className="ghost"
        onClick={onClick}
        disabled={busy}
        title="Re-send wantConfig to the radio — forces a fresh dump of its nodeDB. Runs automatically every 15 min."
        style={{ padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }}
      >
        {busy ? 'Refreshing…' : '⟳ Refresh from radio'}
      </button>
      <span style={{ fontSize: 10.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }} key={nowTick}>
        last sync {sinceLabel}
      </span>
    </div>
  );
}

/**
 * Broadcast our own NodeInfo on the primary channel with wantResponse=true.
 * Meshtastic is push-only — peers' NodeInfo only arrives when *they* decide
 * to broadcast (default 3 hr cadence). This is the closest thing to an
 * "active scan": peers update their nodeDB with our identity AND reply with
 * their own NodeInfo, so a previously-quiet neighbor often appears within a
 * few seconds. Disabled until the radio finishes its handshake (we need
 * myNodeNum to fill in the User payload).
 */
function BroadcastNodeInfoButton({ state }: { state: ConnectionState }) {
  const connId = useActiveConnId();
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ at: number; ok: boolean } | null>(null);

  if (!connId) return null;
  const ready = state.status === 'ready' && !!state.myInfo?.myNodeNum;

  const onClick = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const ok = await window.mesh.broadcastNodeInfo(connId);
      setLastResult({ at: Date.now(), ok });
    } finally {
      setTimeout(() => setBusy(false), 1500);
    }
  };

  const tooltip = !ready
    ? 'Waiting for the radio to finish syncing — we need our own NodeInfo before we can broadcast it.'
    : 'Send our NodeInfo to the mesh with wantResponse=true. Peers that hear it should reply with their own NodeInfo, surfacing nodes that haven\'t broadcast recently. Costs one air-time slot.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
      <button
        className="ghost"
        onClick={onClick}
        disabled={busy || !ready}
        title={tooltip}
        style={{ padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }}
      >
        {busy ? 'Broadcasting…' : '📣 Poke the mesh'}
      </button>
      {lastResult && (
        <span style={{ fontSize: 10.5, color: lastResult.ok ? 'var(--text-faint)' : 'var(--warn)', fontFamily: 'var(--mono)' }}>
          {lastResult.ok ? 'sent — listen for replies' : 'not ready yet'}
        </span>
      )}
    </div>
  );
}

/**
 * Inline editor for the user's per-node antenna gain override. The
 * Device DB catalog ships a stockAntennaDbi for each hwModel — fine
 * out of the box, but every real-world deployment with a 5 dBi
 * fibreglass whip silently breaks our Link Budget math until the user
 * tells us about it. This editor stores the override in the local DB
 * (keyed by myNodeNum); the change immediately flows through every
 * panel that uses `gainForNode` via the useAntennaOverrides hook.
 */
function AntennaOverrideEditor({ node }: { node: NodeRecord }) {
  const { gainForNode, getOverride } = useAntennaOverrides();
  const current = gainForNode(node);
  const override = getOverride(node.num);

  const [editing, setEditing] = useState(false);
  const [dbi, setDbi] = useState<string>(String(current.dbi));
  const [notes, setNotes] = useState<string>(override?.notes ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Re-sync the form when the underlying override changes (e.g. from
    // a save) or when the user selects a different node.
    setDbi(String(current.dbi));
    setNotes(override?.notes ?? '');
  }, [node.num, current.dbi, override?.notes]);

  const onSave = async () => {
    const parsed = parseFloat(dbi);
    if (!isFinite(parsed) || parsed < -10 || parsed > 30) {
      alert('Enter a valid antenna gain in dBi (typical range: 2–9).');
      return;
    }
    setBusy(true);
    try {
      await window.mesh.setAntennaOverride({ nodeNum: node.num, dbi: parsed, notes: notes.trim() });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  const onClear = async () => {
    if (!confirm('Remove the antenna override? Link-budget math reverts to the catalog stock value for this hardware.')) return;
    setBusy(true);
    try {
      await window.mesh.clearAntennaOverride(node.num);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel = current.source === 'override' ? 'override'
    : current.source === 'catalog' ? 'stock (catalog)'
    : 'unknown · assumed';

  if (!editing) {
    return (
      <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 4, background: 'rgba(154,163,178,0.06)', border: '1px solid rgba(154,163,178,0.18)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--text-faint)' }}>Antenna gain · </span>
            <strong style={{ color: current.source === 'override' ? 'var(--accent)' : 'var(--text)' }}>{current.dbi.toFixed(1)} dBi</strong>
            <span style={{ color: 'var(--text-faint)', marginLeft: 6, fontSize: 10.5 }}>{sourceLabel}</span>
          </div>
          <button className="ghost" onClick={() => setEditing(true)} style={{ padding: '2px 8px', fontSize: 11 }}>
            {override ? 'Edit' : 'Override'}
          </button>
        </div>
        {override?.notes && (
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-dim)' }}>{override.notes}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 4, background: 'rgba(92,200,255,0.05)', border: '1px solid rgba(92,200,255,0.3)' }}>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 }}>
        Stock catalog gain for this hardware: <strong>{(current.source === 'catalog' ? current : { dbi: 2 }).dbi.toFixed(1)} dBi</strong> · used by Link Budget, Coverage, Peer Check.
      </div>
      <OwnedAntennaPicker onPick={(spec) => { setDbi(String(spec.gainDbi)); setNotes(spec.name); }} />
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>dBi</label>
        <input
          className="text"
          type="number"
          step="0.5"
          min="-10"
          max="30"
          value={dbi}
          onChange={(e) => setDbi(e.target.value)}
          disabled={busy}
          style={{ fontFamily: 'var(--mono)' }}
        />
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Notes</label>
        <input
          className="text"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder='e.g. "5 dBi fibreglass omni, roof mount"'
          disabled={busy}
        />
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="primary" onClick={onSave} disabled={busy} style={{ padding: '4px 10px', fontSize: 12 }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {override && (
          <button className="ghost" onClick={onClear} disabled={busy} style={{ padding: '4px 10px', fontSize: 12, borderColor: 'var(--bad)', color: 'var(--bad)' }}>
            Reset to stock
          </button>
        )}
        <button className="ghost" onClick={() => setEditing(false)} disabled={busy} style={{ padding: '4px 10px', fontSize: 12 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Quick-pick dropdown that lets the user pick an antenna from their
 * owned roster (Antenna DB → ⌂ Owned) and have the editor's dBi + notes
 * fields auto-fill. Renders nothing if the roster is empty.
 */
function OwnedAntennaPicker({ onPick }: { onPick: (spec: { id: string; name: string; gainDbi: number }) => void }) {
  const owned = useOwnedAntennas();
  const ownedSpecs = ANTENNA_CATALOG.filter((a) => owned.isOwned(a.id));
  if (ownedSpecs.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ fontSize: 11, color: 'var(--text-faint)', display: 'block', marginBottom: 3 }}>
        Pick from your owned antennas ({ownedSpecs.length}):
      </label>
      <select
        className="text"
        defaultValue=""
        onChange={(e) => {
          const a = ownedSpecs.find((x) => x.id === e.target.value);
          if (a) onPick(a);
          e.target.value = ''; // reset so re-picking the same one still fires
        }}
        style={{ width: '100%' }}
      >
        <option value="">— pick to auto-fill dBi + notes —</option>
        {ownedSpecs.map((a) => (
          <option key={a.id} value={a.id}>{a.name} · {a.gainDbi} dBi</option>
        ))}
      </select>
    </div>
  );
}
