import React, { useEffect, useMemo, useState } from 'react';
import { useActiveConnId } from '../../hooks/MeshContext';

interface Props {
  state: ConnectionState;
  nodes: NodeRecord[];
  recentPackets: Array<MeshPacketLite & { receivedAt: number }>;
}

const DEFAULT_BROKER = 'mqtt.meshtastic.org';
const DEFAULT_ROOT = 'msh';

function emptyDraft(): MQTTConfig {
  return {
    enabled: false,
    address: '',
    username: '',
    password: '',
    encryptionEnabled: true,
    jsonEnabled: false,
    tlsEnabled: false,
    root: '',
    proxyToClientEnabled: false,
    mapReportingEnabled: false,
    mapReportPublishIntervalSecs: 7200,
    mapReportPositionPrecision: 14,
  };
}

function configsEqual(a: MQTTConfig | undefined, b: MQTTConfig): boolean {
  if (!a) return false;
  return (
    a.enabled === b.enabled &&
    a.address === b.address &&
    a.username === b.username &&
    a.password === b.password &&
    a.encryptionEnabled === b.encryptionEnabled &&
    a.jsonEnabled === b.jsonEnabled &&
    a.tlsEnabled === b.tlsEnabled &&
    a.root === b.root &&
    a.proxyToClientEnabled === b.proxyToClientEnabled &&
    a.mapReportingEnabled === b.mapReportingEnabled &&
    (a.mapReportPublishIntervalSecs ?? 0) === (b.mapReportPublishIntervalSecs ?? 0) &&
    (a.mapReportPositionPrecision ?? 0) === (b.mapReportPositionPrecision ?? 0)
  );
}

export function MqttPanel({ state, nodes, recentPackets }: Props) {
  const connId = useActiveConnId();
  const live = state.mqttConfig;
  const [draft, setDraft] = useState<MQTTConfig>(live ?? emptyDraft());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const isReady = state.status === 'ready';

  const dirty = !configsEqual(live, draft);

  // Whenever the radio reports a new config, sync the draft (unless the user
  // has unsaved edits — keep their work).
  useEffect(() => {
    if (live && !dirty) setDraft(live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const upd = <K extends keyof MQTTConfig>(k: K, v: MQTTConfig[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const apply = async () => {
    if (!connId) return;
    setBusy(true); setMsg(''); setErr('');
    try {
      await window.mesh.setMqttConfig({ connId, config: draft });
      setMsg('Sent to radio. The radio will reboot to apply MQTT changes; reconnect happens automatically.');
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const revert = () => { if (live) setDraft(live); };

  // ── Live stats ────────────────────────────────────────────────────────
  const mqttNodes = useMemo(() => nodes.filter((n) => n.viaMqtt), [nodes]);
  const cutoff = Date.now() - 60_000;
  const recentInWindow = recentPackets.filter((p) => p.receivedAt >= cutoff);
  const recentMqtt = recentInWindow.filter((p) => p.viaMqtt).length;
  const lastMqttPacket = recentPackets.find((p) => p.viaMqtt);

  const uplinkChannels = (state.channels ?? []).filter((c) => c.role !== 0 && c.uplinkEnabled);
  const downlinkChannels = (state.channels ?? []).filter((c) => c.role !== 0 && c.downlinkEnabled);

  return (
    <div className="page">
      <h1 className="page-title">MQTT</h1>
      <p className="page-sub">
        Meshtastic's MQTT bridge lets your radio publish (and optionally consume) packets to a broker over the internet —
        making "nodes" you see in the app potentially come from anywhere in the world, not just your local airwaves.
        When this is on, look for the <span className="src-chip src-mqtt">MQTT</span> chip in Nodes and Packet Sniffer.
      </p>

      {/* Status strip — always visible */}
      <div className="mqtt-strip">
        <StatChip
          label="Bridge"
          value={live?.enabled ? 'ON' : 'off'}
          tone={live?.enabled ? 'good' : 'dim'}
          hint={live?.enabled ? `Connected via ${live.address || DEFAULT_BROKER}` : 'Radio is not publishing or consuming MQTT'}
        />
        <StatChip
          label="Broker"
          value={live?.address || (live ? DEFAULT_BROKER : '—')}
          tone={live ? 'normal' : 'dim'}
          hint={live?.address ? 'Custom broker' : 'Default public Meshtastic broker'}
        />
        <StatChip
          label="Root topic"
          value={live?.root || (live ? `${DEFAULT_ROOT}/` : '—')}
          tone="dim"
        />
        <StatChip
          label="Encryption"
          value={live?.encryptionEnabled ? 'on' : 'OFF'}
          tone={live?.encryptionEnabled ? 'good' : 'bad'}
          hint={live?.encryptionEnabled ? 'Packets keep their channel PSK encryption when published' : 'Plaintext on the wire — anyone with the topic can read'}
        />
        <StatChip label="TLS" value={live?.tlsEnabled ? 'on' : 'off'} tone={live?.tlsEnabled ? 'good' : 'dim'} />
        <StatChip
          label="Proxy to client"
          value={live?.proxyToClientEnabled ? 'on' : 'off'}
          tone={live?.proxyToClientEnabled ? 'good' : 'dim'}
          hint={live?.proxyToClientEnabled ? 'Radio tunnels MQTT via this app — no WiFi needed' : 'Radio connects directly to broker over WiFi/Ethernet'}
        />
        <StatChip
          label="Map reporting"
          value={live?.mapReportingEnabled ? 'ON' : 'off'}
          tone={live?.mapReportingEnabled ? 'warn' : 'dim'}
          hint={live?.mapReportingEnabled ? 'Position is published to the public Meshtastic map' : ''}
        />
      </div>

      {/* Activity card */}
      <div className="mqtt-activity">
        <ActivityStat label="Nodes via MQTT" value={String(mqttNodes.length)} sub={nodes.length > 0 ? `of ${nodes.length} known (${Math.round(mqttNodes.length / nodes.length * 100)}%)` : ''} />
        <ActivityStat
          label="MQTT pkts / min"
          value={String(recentMqtt)}
          sub={recentInWindow.length > 0 ? `${Math.round(recentMqtt / recentInWindow.length * 100)}% of last 60 s` : 'no recent packets'}
        />
        <ActivityStat
          label="Last MQTT packet"
          value={lastMqttPacket ? ago(lastMqttPacket.receivedAt) : '—'}
          sub={lastMqttPacket ? `from ${shortHex(lastMqttPacket.from)}` : 'none yet this session'}
        />
        <ActivityStat
          label="Channels uplinking"
          value={uplinkChannels.length === 0 ? '0' : uplinkChannels.map((c) => c.name || `ch${c.index}`).join(', ')}
          sub={`${downlinkChannels.length} channel(s) accept MQTT downlinks`}
        />
      </div>

      {/* Editor */}
      <div className="layout-split-wide">
        <div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Bridge configuration</h2>
              {dirty && <span style={{ color: 'var(--warn)', fontSize: 12 }}>unsaved changes</span>}
            </div>
            {!isReady && (
              <div className="info-card" style={{ borderLeftColor: 'var(--warn)', marginTop: 8 }}>
                <p style={{ margin: 0, fontSize: 12 }}>The radio must be connected and ready to apply changes.</p>
              </div>
            )}
            {!live && isReady && (
              <div className="info-card" style={{ marginTop: 8 }}>
                <p style={{ margin: 0, fontSize: 12 }}>
                  This radio hasn't reported its MQTT config yet — older firmware doesn't include ModuleConfigs in the
                  default config dump. Sending an enable here will create the config; the radio will reboot to apply.
                </p>
              </div>
            )}

            <div className="kv-form" style={{ marginTop: 12 }}>
              <Toggle
                label="Enable MQTT bridge"
                hint="Master switch. Off = the radio does not connect to any broker."
                value={draft.enabled}
                onChange={(v) => upd('enabled', v)}
                disabled={!isReady}
              />
              <Field
                label="Broker address"
                hint={`host[:port]. Blank = ${DEFAULT_BROKER} (the public Meshtastic broker). Use TLS on 8883 for private brokers.`}
                value={draft.address}
                placeholder={DEFAULT_BROKER}
                onChange={(v) => upd('address', v)}
                disabled={!isReady || !draft.enabled}
              />
              <Field
                label="Root topic"
                hint={`Topic prefix. Blank = "${DEFAULT_ROOT}/". Change this to publish to a private broker namespace.`}
                value={draft.root}
                placeholder={`${DEFAULT_ROOT}/`}
                onChange={(v) => upd('root', v)}
                disabled={!isReady || !draft.enabled}
              />
              <Field
                label="Username"
                value={draft.username}
                onChange={(v) => upd('username', v)}
                disabled={!isReady || !draft.enabled}
              />
              <Field
                label="Password"
                type="password"
                hint="Write-only on the radio — reads return blank, which is normal."
                value={draft.password}
                onChange={(v) => upd('password', v)}
                disabled={!isReady || !draft.enabled}
              />
              <Toggle
                label="Use TLS"
                hint="Required for most private brokers. Port should typically be 8883."
                value={draft.tlsEnabled}
                onChange={(v) => upd('tlsEnabled', v)}
                disabled={!isReady || !draft.enabled}
              />
              <Toggle
                label="Encrypt packets before publishing"
                hint="On (default): packets keep their channel PSK encryption when published. Off: plaintext — useful for debugging, but anyone subscribing can read your traffic."
                value={draft.encryptionEnabled}
                onChange={(v) => upd('encryptionEnabled', v)}
                disabled={!isReady || !draft.enabled}
              />
              <Toggle
                label="Publish JSON debug stream"
                hint="In addition to the protobuf topic, publish a JSON-encoded copy. Useful for piping into Home Assistant, Node-RED, etc. Always sent in the clear."
                value={draft.jsonEnabled}
                onChange={(v) => upd('jsonEnabled', v)}
                disabled={!isReady || !draft.enabled}
              />
              <Toggle
                label="Proxy MQTT through this app"
                hint="Tunnels MQTT traffic over the USB serial link to this client, so the radio doesn't need its own WiFi/Ethernet. This app does NOT yet open a broker connection on the radio's behalf — leave this off for now unless you know what you're doing."
                value={draft.proxyToClientEnabled}
                onChange={(v) => upd('proxyToClientEnabled', v)}
                disabled={!isReady || !draft.enabled}
              />
              <Toggle
                label="Publish to the public Meshtastic map"
                hint="Adds this radio's position to https://meshtastic.org/map. Off by default — turn on only if you want to be visible publicly."
                value={draft.mapReportingEnabled}
                onChange={(v) => upd('mapReportingEnabled', v)}
                disabled={!isReady || !draft.enabled}
              />
              {draft.mapReportingEnabled && (
                <>
                  <Field
                    label="Map publish interval (s)"
                    hint="How often to send a position update to the map. 7200 (2 hours) is the recommended default."
                    type="number"
                    value={String(draft.mapReportPublishIntervalSecs ?? 7200)}
                    onChange={(v) => upd('mapReportPublishIntervalSecs', Number(v) || 0)}
                    disabled={!isReady || !draft.enabled}
                  />
                  <Field
                    label="Map position precision (bits)"
                    hint="Lower = coarser (better privacy). 14 ≈ a few city blocks; 24 ≈ a meter. Full precision is 32."
                    type="number"
                    value={String(draft.mapReportPositionPrecision ?? 14)}
                    onChange={(v) => upd('mapReportPositionPrecision', Number(v) || 0)}
                    disabled={!isReady || !draft.enabled}
                  />
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="primary" disabled={!isReady || !dirty || busy} onClick={apply}>
                {busy ? 'Sending…' : 'Apply'}
              </button>
              <button className="ghost" disabled={!dirty || busy} onClick={revert}>Revert</button>
            </div>
            {msg && <div style={{ color: 'var(--good)', marginTop: 10, fontSize: 12 }}>{msg}</div>}
            {err && <div style={{ color: 'var(--bad)', marginTop: 10, fontSize: 12, fontFamily: 'var(--mono)' }}>{err}</div>}
          </div>

          {/* Channel uplink/downlink matrix */}
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Per-channel uplink / downlink</h2>
            <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12 }}>
              Each channel can independently opt in to publishing (<em>uplink</em>) or receiving (<em>downlink</em>) over MQTT.
              These flags live on the channel itself, not on the MQTT module — edit them in the official app for now.
            </p>
            {(state.channels ?? []).filter((c) => c.role !== 0).length === 0 ? (
              <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>No enabled channels reported by the radio.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Uplink</th>
                    <th>Downlink</th>
                  </tr>
                </thead>
                <tbody>
                  {(state.channels ?? []).filter((c) => c.role !== 0).map((c) => (
                    <tr key={c.index}>
                      <td style={{ fontFamily: 'var(--mono)' }}>{c.index}</td>
                      <td>{c.name || '(default)'}</td>
                      <td>{c.roleName}</td>
                      <td>
                        {c.uplinkEnabled
                          ? <span className="src-chip src-mqtt">UP</span>
                          : <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>—</span>}
                      </td>
                      <td>
                        {c.downlinkEnabled
                          ? <span className="src-chip src-mqtt">DOWN</span>
                          : <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <div className="info-card">
            <p style={{ margin: 0 }}><strong>What MQTT does to your view of the mesh</strong></p>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)' }}>
              <li>Nodes published to the broker (by any radio anywhere) can show up in your Nodes list as if they were neighbors. They are not — they came over IP.</li>
              <li>If a channel has <strong>downlink</strong> on, your radio re-transmits MQTT packets onto the airwaves. That's how a single MQTT-bridged radio can flood a local mesh with global traffic.</li>
              <li>If you only want to see your local neighbors, toggle <em>local mesh only</em> on the Map and use the <em>RF only</em> filter on Nodes / Packet Sniffer.</li>
              <li>Encryption on the broker side does NOT replace the channel PSK — it just keeps that PSK encryption intact during transit. Without the PSK, subscribers still can't decode.</li>
            </ul>
          </div>
          <div className="info-card">
            <p><strong>The two MQTT modes</strong></p>
            <p style={{ margin: '0 0 6px' }}><strong>Native:</strong> the radio's own WiFi/Ethernet connects to the broker. Required: the radio has a network module enabled.</p>
            <p style={{ margin: 0 }}><strong>Proxied via client:</strong> the radio sends MQTT frames over USB to this app, and the app would (in a future version) speak MQTT on its behalf. Useful when the radio has no WiFi but the laptop does. Until this app implements the client-side broker connection, leave this off.</p>
          </div>
          <div className="info-card">
            <p style={{ margin: 0 }}><strong>Default public broker</strong></p>
            <p style={{ margin: '6px 0 0', fontSize: 12 }}>
              Blank address → <code>{DEFAULT_BROKER}</code>. Topic prefix → <code>{DEFAULT_ROOT}/</code>. This is the global Meshtastic broker;
              your traffic is visible to anyone subscribed to your region's topic but stays channel-PSK encrypted by default.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── small UI helpers ─────────────────────────────────────────────────

function StatChip({ label, value, tone = 'normal', hint }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'dim' | 'normal'; hint?: string }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : tone === 'dim' ? 'var(--text-faint)' : 'var(--text)';
  return (
    <div className="mqtt-stat" title={hint}>
      <div className="mqtt-stat-label">{label}</div>
      <div className="mqtt-stat-value" style={{ color }}>{value}</div>
    </div>
  );
}

function ActivityStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="mqtt-activity-stat">
      <div className="mqtt-activity-label">{label}</div>
      <div className="mqtt-activity-value">{value}</div>
      {sub && <div className="mqtt-activity-sub">{sub}</div>}
    </div>
  );
}

function Field({ label, hint, value, onChange, type = 'text', placeholder, disabled }: { label: string; hint?: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; disabled?: boolean }) {
  return (
    <div className="kv-row">
      <div className="kv-label">
        <div>{label}</div>
        {hint && <div className="kv-hint">{hint}</div>}
      </div>
      <input
        className="text"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

function Toggle({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="kv-row">
      <div className="kv-label">
        <div>{label}</div>
        {hint && <div className="kv-hint">{hint}</div>}
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: disabled ? 'not-allowed' : 'pointer' }}>
        <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
        <span style={{ fontSize: 12, color: value ? 'var(--good)' : 'var(--text-faint)' }}>{value ? 'on' : 'off'}</span>
      </label>
    </div>
  );
}

function ago(ms: number): string {
  const d = Math.max(0, Date.now() - ms);
  if (d < 1000) return 'just now';
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  return `${Math.floor(d / 3_600_000)}h ago`;
}

function shortHex(n: number): string {
  return '!' + (n >>> 0).toString(16).padStart(8, '0').slice(-4);
}
