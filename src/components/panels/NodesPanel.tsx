import React, { useState } from 'react';
import { useActiveConnId } from '../../hooks/MeshContext';
import { channelHash, channelHashHex, pskFingerprint, pskLabel } from '../../channel-identity';

const STALE_S = 24 * 3600;
const AGING_S = 3600;

function nodeIdHex(num: number): string {
  return '!' + (num >>> 0).toString(16).padStart(8, '0');
}

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

const ROLE_NAMES: Record<number, string> = {
  0: 'CLIENT', 1: 'CLIENT_MUTE', 2: 'ROUTER', 3: 'ROUTER_CLIENT',
  4: 'REPEATER', 5: 'TRACKER', 6: 'SENSOR', 7: 'TAK',
  8: 'CLIENT_HIDDEN', 9: 'LOST_AND_FOUND', 10: 'TAK_TRACKER',
};

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

export function NodesPanel({ nodes, state, onMessageNode }: { nodes: NodeRecord[]; state: ConnectionState; onMessageNode?: (num: number) => void }) {
  const heard = nodes.filter((n) => n.lastHeard);
  const direct = heard.filter((n) => (n.hopsAway ?? 0) === 0).length;
  const relayed = heard.filter((n) => (n.hopsAway ?? 0) > 0).length;
  const staleCount = nodes.filter((n) => freshness(n.lastHeard) === 'stale').length;
  const mqttCount = nodes.filter((n) => n.viaMqtt).length;

  const [selectedNum, setSelectedNum] = useState<number | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const filteredNodes = nodes.filter((n) => {
    if (sourceFilter === 'rf') return !n.viaMqtt;
    if (sourceFilter === 'mqtt') return !!n.viaMqtt;
    return true;
  });
  const selected = selectedNum !== null ? nodes.find((n) => n.num === selectedNum) : null;
  const me = nodes.find((n) => n.num === state.myInfo?.myNodeNum);

  const primary = state.channels?.find((c) => c.index === 0);
  const primaryHash = primary ? channelHash(primary.name || '', primary.psk ?? []) : null;

  return (
    <div className="page">
      <h1 className="page-title">Nodes</h1>
      <p className="page-sub">
        Every node your radio has heard since it powered on. Click a row for detail. Direct = picked up off the air; Relayed = forwarded through another node.
      </p>

      {state.status === 'ready' && primary && (
        <div className="nodes-channel-id">
          <span className="nodes-channel-id-label">LISTENING ON</span>
          <span className="nodes-channel-id-name">{primary.name || '(default)'}</span>
          <span className="nodes-channel-id-meta">{pskLabel(primary.pskLength)}</span>
          {primaryHash !== null && (
            <span className="nodes-channel-id-meta" title="8-bit channel hash = xor(name) ^ xor(psk). Two radios on the same logical channel compute the same hash; receivers use it to pick a decryption key.">
              hash <strong style={{ color: 'var(--accent)', fontFamily: 'var(--mono)' }}>{channelHashHex(primaryHash)}</strong>
            </span>
          )}
          <span className="nodes-channel-id-meta">
            psk <span style={{ fontFamily: 'var(--mono)' }}>{pskFingerprint(primary.psk ?? [])}</span>
          </span>
          {state.loraConfig && (
            <span className="nodes-channel-id-meta">
              {state.loraConfig.regionName} · {state.loraConfig.usePreset ? state.loraConfig.modemPresetName : `SF${state.loraConfig.spreadFactor}/${(state.loraConfig.bandwidth / 1000).toFixed(0)}k`}
            </span>
          )}
        </div>
      )}

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
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
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
                    <th>Short</th>
                    <th>Long name</th>
                    <th>ID</th>
                    <th>Hardware</th>
                    <th>Src</th>
                    <th>Hops</th>
                    <th>SNR</th>
                    <th>RSSI</th>
                    <th>Battery</th>
                    <th>Heard</th>
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
            <NodeDetail node={selected} me={me} state={state} onMessage={onMessageNode} onClose={() => setSelectedNum(null)} />
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
}: {
  node: NodeRecord;
  me: NodeRecord | undefined;
  state: ConnectionState;
  onMessage?: (n: number) => void;
  onClose: () => void;
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
            onClick={() => connId && window.mesh.sendTraceroute({ connId, to: node.num })}
            disabled={state.status !== 'ready' || !connId}
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            Traceroute
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
