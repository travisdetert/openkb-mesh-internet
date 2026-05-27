import React, { useEffect, useRef, useState } from 'react';
import { useMeshContext } from '../hooks/MeshContext';
import { SettingsPanel } from './panels/SettingsPanel';
import { ChannelsPanel } from './panels/ChannelsPanel';
import { MqttPanel } from './panels/MqttPanel';
import { useBleScan, looksMeshtastic } from './BleScanModal';
import type { TabId } from './TopNav';
import { ROLE_NAMES } from '../lib/device-roles';

function pskDescription(pskLength: number): string {
  if (pskLength === 0) return 'open (no PSK)';
  if (pskLength === 1) return 'default key';
  if (pskLength === 16) return 'AES-128';
  if (pskLength === 32) return 'AES-256';
  return `${pskLength}-byte custom`;
}

function confidenceBadge(c: PortConfidence): string {
  switch (c) {
    case 'confirmed': return '✓';
    case 'likely':    return '◯';
    case 'possible':  return '·';
    default:          return ' ';
  }
}

interface Props {
  state: ConnectionState;
  myNode?: NodeRecord;
  /** All nodes from the active radio — needed for the inline MQTT panel. */
  nodes: NodeRecord[];
  /** Recent packets — needed for the inline MQTT panel's live traffic view. */
  recentPackets: Array<MeshPacketLite & { receivedAt: number }>;
  nodesCount: number;
  channelsCount: number;
  connectStartedAt: number | null;
  readyAt: number | null;
  lastPacketAt: number | null;
  packetsLast60s: number;
  /** Jump to another top-level panel — used by the "configure this radio" links. */
  go: (id: string) => void;
  /** When true, open directly in "add another radio" mode. */
  initialAdding?: boolean;
  /** Notify parent when adding mode changes so it can clear the flag. */
  onAddingChange?: (v: boolean) => void;
}

type StageKey = 'discover' | 'open' | 'configure' | 'sync' | 'ready';
interface Stage { key: StageKey; label: string; hint: string; }

const STAGES: Stage[] = [
  { key: 'discover',  label: 'Discover',  hint: 'Find a USB serial port that looks like a Meshtastic radio.' },
  { key: 'open',      label: 'Open',      hint: 'Open the port at 115200 8N1.' },
  { key: 'configure', label: 'Configure', hint: 'Send want_config_id; ask the radio to dump identity & channels.' },
  { key: 'sync',      label: 'Sync',      hint: 'Receive node DB, channel list, and LoRa config.' },
  { key: 'ready',     label: 'Ready',     hint: 'Live packets are flowing.' },
];

function stageIndex(state: ConnectionState, hasPorts: boolean, attempted: boolean): number {
  if (state.status === 'ready') return 4;
  if (state.status === 'configuring') return 3;
  if (state.status === 'connecting') return 2;
  if (attempted) return 1;
  if (hasPorts) return 1;
  return 0;
}

function ago(ms: number): string {
  const d = Math.max(0, Date.now() - ms);
  if (d < 1000) return 'just now';
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  return `${Math.floor(d / 3_600_000)}h ago`;
}

export function ConnectionWizard({
  state,
  myNode,
  nodes,
  recentPackets,
  nodesCount,
  channelsCount,
  connectStartedAt,
  readyAt,
  lastPacketAt,
  packetsLast60s,
  go,
  initialAdding,
  onAddingChange,
}: Props) {
  const { connections, activeConnId, setActiveConnId, pendingReboots, markRebootStarted } = useMeshContext();
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>('');
  const [bleStatus, setBleStatus] = useState<string>('');
  const [attempted, setAttempted] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [adding, setAddingRaw] = useState(initialAdding ?? false);
  const setAdding = (v: boolean) => { setAddingRaw(v); onAddingChange?.(v); };
  useEffect(() => { if (initialAdding) setAddingRaw(true); }, [initialAdding]);
  // Inline admin section — when set, the corresponding panel renders
  // beneath the Configure toolbar instead of navigating away. Keeps the
  // user grounded in the device-admin context.
  const [adminSection, setAdminSection] = useState<'settings' | 'channels' | 'mqtt' | null>(null);
  const bleScan = useBleScan();

  const [autoConnect, setAutoConnectLocal] = useState<boolean>(() => {
    try { const v = localStorage.getItem('openkb.autoConnect.v1'); return v === null ? true : v === '1'; } catch { return true; }
  });
  useEffect(() => {
    // Push the current preference to main on mount and whenever it changes.
    void window.mesh.setAutoConnect(autoConnect);
    try { localStorage.setItem('openkb.autoConnect.v1', autoConnect ? '1' : '0'); } catch { /* ignore */ }
  }, [autoConnect]);
  // Ports already in use by an active connection — hide from picker.
  const usedPorts = new Set(connections.map((c) => c.portPath).filter(Boolean) as string[]);
  const availablePorts = ports.filter((p) => !usedPorts.has(p.path));
  // Tick once a second so "X ago" labels stay live.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (state.status !== 'ready') return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  const refresh = async () => {
    const p = await window.mesh.listPorts();
    setPorts(p);
    // Auto-select first available (non-used) port.
    const free = p.filter((pp) => !usedPorts.has(pp.path));
    if (!selected && free.length) setSelected(free[0].path);
  };

  useEffect(() => { refresh(); }, []);
  // When the used-ports set changes (e.g., after a new radio connects), prune
  // the current selection if it's no longer available.
  useEffect(() => {
    if (selected && usedPorts.has(selected)) {
      const next = ports.find((p) => !usedPorts.has(p.path));
      setSelected(next?.path ?? '');
    }
  }, [connections.length]);

  const connect = async () => {
    if (!selected) return;
    setBusy(true);
    setErr('');
    setAttempted(true);
    try {
      const id = await window.mesh.connect(selected);
      setActiveConnId(id);
      setAdding(false);
      setSelected('');
    }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const connectBluetooth = async () => {
    setBusy(true);
    setErr('');
    setBleStatus('Requesting Bluetooth permission…');
    setAttempted(true);
    try {
      const { connectBluetoothDevice } = await import('../lib/ble-client');
      const id = await connectBluetoothDevice((p) => {
        // Translate the structured progress phase into a single human line.
        const dev = p.deviceName ? ` "${p.deviceName}"` : '';
        switch (p.phase) {
          case 'requesting-device':   setBleStatus(`Scanning for radios…${dev}`); break;
          case 'device-picked':       setBleStatus(`Found${dev} — connecting GATT…`); break;
          case 'gatt-connecting':     setBleStatus(`Connecting GATT to${dev}…`); break;
          case 'service-discovery':   setBleStatus(`Looking up Meshtastic service on${dev}…`); break;
          case 'characteristics':     setBleStatus(`Reading characteristics from${dev}…`); break;
          case 'subscribing':         setBleStatus(`Subscribing to notifications on${dev}…`); break;
          case 'session-registered':  setBleStatus(`Session opened (${p.connId}) — waiting for first frames…`); break;
          case 'draining-initial':    setBleStatus(`Pulling initial config from${dev}…`); break;
          case 'connected':           setBleStatus(`Connected${dev} — got ${p.framesDrained ?? 0} initial frame${p.framesDrained === 1 ? '' : 's'}. Handshake continues in background.`); break;
          case 'failed':              setBleStatus(`Failed: ${p.error ?? 'unknown'}`); break;
        }
      });
      setActiveConnId(id);
      setAdding(false);
      // Clear the status after a moment so it doesn't linger.
      setTimeout(() => setBleStatus(''), 4000);
    } catch (e: any) {
      // With the renderer-driven chooser, NotFoundError means the user hit
      // Cancel or the 60s safety timeout fired — neither needs the giant
      // diagnostic. The modal itself surfaces "nothing visible" tips while
      // the scan is live, which is the right time to read them.
      const msg = e?.message ?? String(e);
      if (e?.name === 'NotFoundError' || /User cancelled/i.test(msg)) {
        setBleStatus('');
      } else {
        setErr(`Bluetooth: ${msg}`);
        setBleStatus('');
      }
    }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!activeConnId) return;
    setBusy(true);
    try { await window.mesh.disconnect(activeConnId); } finally { setBusy(false); }
  };

  const disconnectId = async (id: string) => {
    setBusy(true);
    try { await window.mesh.disconnect(id); } finally { setBusy(false); }
  };

  const isConnected = state.status === 'ready' || state.status === 'configuring';
  const isReady = state.status === 'ready';
  const idx = stageIndex(state, ports.length > 0, attempted);
  const elapsed = connectStartedAt ? Math.floor((Date.now() - connectStartedAt) / 1000) : 0;
  const timeToReady = connectStartedAt && readyAt ? ((readyAt - connectStartedAt) / 1000).toFixed(1) : null;

  return (
    <div className="page">
      {/* BleScanModal renders inline below the BLE button */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <h1 className="page-title">
          {adding ? 'Add another radio'
            : connections.length <= 1 ? 'Connect to your node'
            : `Connected radios (${connections.length})`}
        </h1>
        <label className={'autoconnect-toggle' + (autoConnect ? ' on' : '')} title="When enabled, any USB device the app recognises as a Meshtastic board (confirmed VID/PID match) is opened automatically. Generic USB-serial devices are never auto-connected.">
          <input type="checkbox" checked={autoConnect} onChange={(e) => setAutoConnectLocal(e.target.checked)} />
          <span>Auto-connect to recognised radios</span>
        </label>
      </div>

      {/* Multi-radio picker — one chip per active connection plus an "add another" affordance */}
      {connections.length > 0 && (
        <div className="conn-chips">
          {connections.map((c) => {
            const isActive = c.connId === activeConnId;
            const cMy = c.state.myInfo?.myNodeNum;
            const cNode = cMy ? c.nodes.find((n) => n.num === cMy) : undefined;
            const label = cNode?.shortName || cNode?.longName || c.portPath?.split('/').pop() || c.connId;
            // If this chip's radio is mid-reboot, override the status display
            // with a "Rebooting in Ns…" countdown derived from the 5-second
            // grace window the firmware honors before actually restarting.
            const rebootEntry = cMy ? pendingReboots[String(cMy)] : undefined;
            const rebootElapsed = rebootEntry ? Math.floor((Date.now() - rebootEntry.startedAt) / 1000) : 0;
            const rebootRemaining = rebootEntry ? Math.max(0, 5 - rebootElapsed) : 0;
            const isRebooting = !!rebootEntry && rebootElapsed < 6;
            const dot = isRebooting ? 'warn'
              : c.state.status === 'ready' ? 'ok'
              : c.state.status === 'disconnected' ? 'bad'
              : 'warn';
            const sub = isRebooting
              ? (rebootRemaining > 0 ? `↻ rebooting in ${rebootRemaining}s…` : '↻ rebooting now…')
              : c.state.status === 'ready' ? `${c.nodes.length} nodes`
              : c.state.status === 'configuring' ? (c.state.sync && c.state.sync.retries > 0 ? `syncing · retry ${c.state.sync.retries}` : 'syncing')
              : c.state.status === 'connecting' ? 'opening'
              : 'offline';
            // BLE indicator: the radio's own BluetoothConfig (synced over USB).
            // Tells you at a glance whether THIS radio thinks its BLE is on —
            // critical for explaining "why isn't it showing up in the scan?"
            const btCfg = c.state.bluetoothConfig;
            const hasBtCapability = c.state.myInfo?.hasBluetooth ?? true;
            const btBadge =
              !hasBtCapability ? { text: 'no BT', tone: 'dim' as const, tip: 'Hardware has no Bluetooth radio.' }
              : !btCfg ? null  // config not synced yet — don't claim either way
              : !btCfg.enabled ? { text: 'BLE off', tone: 'bad' as const, tip: 'This radio reports its Bluetooth is disabled in firmware config. Enable it under Settings → Bluetooth (or via the official Meshtastic app) before BLE scans will find it.' }
              : { text: 'BLE on', tone: 'good' as const, tip: btCfg.mode === 0 ? 'BLE enabled (random PIN — radio shows pairing code on its screen).' : btCfg.mode === 1 ? 'BLE enabled (no PIN required).' : btCfg.mode === 2 ? `BLE enabled (fixed PIN: ${btCfg.fixedPin}).` : `BLE enabled (mode ${btCfg.mode}).` };
            return (
              <div
                key={c.connId}
                className={'conn-chip' + (isActive ? ' active' : '')}
                onClick={() => setActiveConnId(c.connId)}
                role="button"
                tabIndex={0}
              >
                <span className={`status-dot ${dot}`} />
                <div className="conn-chip-text">
                  <div className="conn-chip-label">
                    {label}
                    {btBadge && (
                      <span
                        title={btBadge.tip}
                        style={{
                          marginLeft: 8,
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 8,
                          fontFamily: 'var(--mono)',
                          color:
                            btBadge.tone === 'good' ? 'var(--good)'
                            : btBadge.tone === 'bad' ? 'var(--bad)'
                            : 'var(--text-faint)',
                          border:
                            btBadge.tone === 'good' ? '1px solid rgba(102,211,154,0.4)'
                            : btBadge.tone === 'bad' ? '1px solid rgba(255,107,129,0.4)'
                            : '1px solid rgba(154,163,178,0.3)',
                          background:
                            btBadge.tone === 'good' ? 'rgba(102,211,154,0.10)'
                            : btBadge.tone === 'bad' ? 'rgba(255,107,129,0.10)'
                            : 'rgba(154,163,178,0.08)',
                        }}
                      >
                        {btBadge.text}
                      </span>
                    )}
                  </div>
                  <div className="conn-chip-sub">
                    {c.portPath?.split('/').pop()} · {sub}
                  </div>
                </div>
                <button
                  className="ghost conn-chip-close"
                  onClick={(e) => { e.stopPropagation(); disconnectId(c.connId); }}
                  title="Disconnect this radio"
                >
                  ✕
                </button>
              </div>
            );
          })}
          {/* Placeholder chips for radios that are mid-reboot AND have
            *  already disconnected from USB. They reappear as live chips
            *  the moment auto-connect picks the radio back up. */}
          {(() => {
            const liveNodeNums = new Set(
              connections.map((c) => c.state.myInfo?.myNodeNum).filter((n) => !!n) as number[],
            );
            return Object.entries(pendingReboots)
              .filter(([k]) => !liveNodeNums.has(parseInt(k, 10)))
              .map(([k, entry]) => {
                const elapsed = Math.floor((Date.now() - entry.startedAt) / 1000);
                const label = entry.shortName || entry.longName || entry.portPath?.split('/').pop() || `!${parseInt(k, 10).toString(16).padStart(8, '0')}`;
                return (
                  <div
                    key={`reboot-${k}`}
                    className="conn-chip"
                    style={{ opacity: 0.75, borderStyle: 'dashed' }}
                    title="Radio is rebooting. Auto-connect will reattach when it re-enumerates."
                  >
                    <span className="status-dot warn" />
                    <div className="conn-chip-text">
                      <div className="conn-chip-label">{label}</div>
                      <div className="conn-chip-sub">↻ restarting · {elapsed}s</div>
                    </div>
                  </div>
                );
              });
          })()}
          {!adding && (
            <button className="conn-chip-add" onClick={() => { setAdding(true); refresh(); }}>
              + Add another radio
            </button>
          )}
        </div>
      )}

      {/* Top dashboard strip — single row, scannable at a glance. Hidden in
       *  "add another radio" mode because these stats describe whichever
       *  radio is currently active, not the one being added. */}
      {!adding && (
        <div className="conn-strip">
          <div className="conn-strip-stages">
            {STAGES.map((s, i) => {
              const status = i < idx ? 'done' : i === idx ? 'active' : 'pending';
              return <StageChip key={s.key} stage={s} status={status} />;
            })}
          </div>
          <div className="conn-strip-stats">
            {isReady && timeToReady && <Stat label="ready in" value={`${timeToReady}s`} />}
            {state.status === 'configuring' && <Stat label="syncing" value={`${elapsed}s`} tone="warn" />}
            <Stat
              label="last packet"
              value={lastPacketAt ? ago(lastPacketAt) : '—'}
              tone={!lastPacketAt ? 'dim' : Date.now() - lastPacketAt < 60_000 ? 'good' : Date.now() - lastPacketAt < 300_000 ? 'warn' : 'bad'}
            />
            <Stat label="pkt / min" value={String(packetsLast60s)} tone={packetsLast60s > 0 ? 'good' : 'dim'} />
            <Stat label="nodes" value={String(nodesCount)} />
            <Stat label="channels" value={String(channelsCount)} />
          </div>
        </div>
      )}

      {/* Device picker — shown when not connected at all, or when explicitly adding another radio */}
      {(!isConnected || adding) ? (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Available devices</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="ghost" onClick={refresh} style={{ padding: '4px 10px', fontSize: 12 }}>Rescan USB</button>
              <button className="ghost" onClick={connectBluetooth} disabled={busy || bleScan.active} style={{ padding: '4px 10px', fontSize: 12 }}>
                {bleScan.active ? `Scanning BLE… ${Math.floor(bleScan.elapsedMs / 1000)}s` : 'Scan Bluetooth'}
              </button>
              {adding && (
                <button className="ghost" onClick={() => { setAdding(false); setErr(''); }} style={{ padding: '4px 10px', fontSize: 12 }}>Cancel</button>
              )}
            </div>
          </div>

          <div className="device-list">
            {availablePorts.map((p) => (
              <button
                key={p.path}
                className={'device-list-row' + (selected === p.path ? ' active' : '')}
                onClick={async () => { setSelected(p.path); setBusy(true); setErr(''); try { const id = await window.mesh.connect(p.path); setActiveConnId(id); setAdding(false); setSelected(''); } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setBusy(false); } }}
                disabled={busy}
              >
                <span className="device-list-icon">USB</span>
                <span className="device-list-info">
                  <span className="device-list-name">{p.description ?? p.manufacturer ?? p.path}</span>
                  <span className="device-list-sub">{p.path}{p.confidence === 'confirmed' ? ' · confirmed Meshtastic' : p.confidence === 'likely' ? ' · likely Meshtastic' : ''}</span>
                </span>
                {p.confidence === 'confirmed' && <span className="ble-scan-pill good">confirmed</span>}
              </button>
            ))}

            {bleScan.devices
              .filter((d) => !d.alreadyOnUsb)
              .sort((a, b) => {
                const am = looksMeshtastic(a.deviceName) ? 0 : 1;
                const bm = looksMeshtastic(b.deviceName) ? 0 : 1;
                return am - bm;
              })
              .map((d) => (
                <button
                  key={d.deviceId}
                  className="device-list-row"
                  onClick={() => window.mesh.bleScanPick(d.deviceId)}
                  disabled={busy}
                >
                  <span className="device-list-icon">BLE</span>
                  <span className="device-list-info">
                    <span className="device-list-name">{d.deviceName || '(unnamed)'}</span>
                    <span className="device-list-sub">{d.deviceId.slice(0, 20)}{d.deviceId.length > 20 ? '…' : ''}</span>
                  </span>
                  {looksMeshtastic(d.deviceName) && <span className="ble-scan-pill good">Meshtastic</span>}
                </button>
              ))}

            {availablePorts.length === 0 && bleScan.devices.length === 0 && (
              <div className="device-list-empty">
                {bleScan.active
                  ? 'Scanning for Bluetooth devices…'
                  : 'No devices found. Plug in a USB radio or click Scan Bluetooth.'}
              </div>
            )}
          </div>
          {bleStatus && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                borderRadius: 4,
                borderLeft: '3px solid var(--accent)',
                background: 'rgba(92,200,255,0.06)',
                fontSize: 12.5,
                color: 'var(--text)',
                fontFamily: 'var(--mono)',
              }}
            >
              <span style={{ color: 'var(--accent)', fontWeight: 600, marginRight: 6 }}>📶 BLE</span>
              {bleStatus}
            </div>
          )}
          {err && <ConnectError message={err} />}
        </div>
      ) : (
        <div className="conn-bar">
          <div className="conn-bar-text">
            <span className={`conn-bar-dot ${isReady ? 'ok' : 'warn'}`} />
            {myNode?.shortName && <span className="conn-bar-label" style={{ color: 'var(--accent)' }}>{myNode.shortName}</span>}
            {myNode?.longName && <span className="conn-bar-meta">{myNode.longName}</span>}
            {!myNode?.shortName && <span className="conn-bar-label">{state.portPath ?? '—'}</span>}
            {state.myInfo?.firmwareVersion && <span className="conn-bar-meta">fw {state.myInfo.firmwareVersion}</span>}
            {state.myInfo?.myNodeNum && <span className="conn-bar-meta">!{state.myInfo.myNodeNum.toString(16).padStart(8, '0')}</span>}
            {myNode?.batteryLevel !== undefined && (
              <span className="conn-bar-meta" style={{ color: myNode.batteryLevel > 50 ? 'var(--good)' : myNode.batteryLevel > 20 ? 'var(--warn)' : 'var(--bad)' }}>
                🔋 {myNode.batteryLevel}%
              </span>
            )}
            {myNode?.voltage !== undefined && myNode.voltage > 0 && <span className="conn-bar-meta">{myNode.voltage.toFixed(2)} V</span>}
            {myNode?.hwModelName && <span className="conn-bar-meta">{myNode.hwModelName}</span>}
            {state.portPath && myNode?.shortName && <span className="conn-bar-meta" style={{ opacity: 0.7 }}>{state.portPath}</span>}
          </div>
          <button className="ghost" onClick={disconnect} disabled={busy} style={{ padding: '4px 12px', fontSize: 12 }}>
            Disconnect
          </button>
        </div>
      )}

      {/* Everything below describes the currently-active radio. In
       *  "add another radio" mode the user is focused on picking a NEW
       *  device — collapse all of this so the wizard is its own focused
       *  screen instead of stacking on top of an in-progress radio view. */}
      {!adding && <>
      {/* Configure this radio — quick links into per-device panels. These
       *  used to live in the sidebar but they're really about whatever
       *  radio is currently active, so they belong with the device view. */}
      {isConnected && (
        <div className="conn-config-row">
          <span className="conn-config-label">Configure this radio</span>
          <button
            className={'conn-config-btn' + (adminSection === 'settings' ? ' active' : '')}
            onClick={() => setAdminSection((s) => s === 'settings' ? null : 'settings')}
            title="LoRa, device, position, power, network, display, Bluetooth"
          >
            <span className="conn-config-icon">⚙</span> Settings
          </button>
          <button
            className={'conn-config-btn' + (adminSection === 'channels' ? ' active' : '')}
            onClick={() => setAdminSection((s) => s === 'channels' ? null : 'channels')}
            title="Edit channels, PSKs, share via URL"
          >
            <span className="conn-config-icon">#</span> Channels
          </button>
          <button
            className={'conn-config-btn' + (adminSection === 'mqtt' ? ' active' : '')}
            onClick={() => setAdminSection((s) => s === 'mqtt' ? null : 'mqtt')}
            title="MQTT bridge, map reporting"
          >
            <span className="conn-config-icon">☁</span> MQTT
          </button>
          <button
            className="conn-config-btn"
            onClick={async () => {
              if (!activeConnId || !isReady) return;
              const myNum = state.myInfo?.myNodeNum;
              const label = myNode?.shortName || myNode?.longName || state.portPath || 'this radio';
              if (!confirm(`Reboot ${label}?\n\nThe radio will disconnect for ~10–15 seconds while it restarts. Auto-connect will pick it back up when it returns.`)) return;
              const ok = await window.mesh.reboot({ connId: activeConnId, seconds: 5 });
              if (!ok) { alert('Could not send reboot — radio handshake may not be complete yet.'); return; }
              if (myNum) {
                markRebootStarted(myNum, {
                  shortName: myNode?.shortName ?? '',
                  longName: myNode?.longName ?? '',
                  portPath: state.portPath,
                });
              }
            }}
            disabled={!isReady}
            title={isReady
              ? 'Send a reboot admin message. The radio drops for ~10–15s then re-enumerates.'
              : 'Wait for the radio to finish syncing before rebooting.'}
          >
            <span className="conn-config-icon">↻</span> Reboot
          </button>
          <button
            className="conn-config-btn"
            onClick={async () => {
              if (!activeConnId || !isReady) return;
              const label = myNode?.shortName || myNode?.longName || state.portPath || 'this radio';
              const nodeCount = connections.find((c) => c.connId === activeConnId)?.nodes.length ?? 0;
              if (!confirm(
                `Purge ${label}'s nodeDB?\n\n` +
                `Sends a nodedb_reset admin message — the radio drops every peer it has stored (currently ${nodeCount}) except itself. ` +
                `Peers will repopulate over time as they broadcast NodeInfo (default ~3 hr cadence; can be sped up by asking peers to "Poke the mesh"). ` +
                `Our local cache for this radio is also cleared, but the SQLite mirror for OTHER radios is unaffected.\n\n` +
                `Use this when the nodeDB has duplicates, stale entries, or corruption you can't otherwise resolve.`,
              )) return;
              const ok = await window.mesh.purgeNodedb(activeConnId);
              if (!ok) alert('Could not send purge — radio handshake may not be complete yet.');
            }}
            disabled={!isReady}
            title={isReady
              ? 'Wipe the radio\'s nodeDB. Peers repopulate from future NodeInfo broadcasts.'
              : 'Wait for the radio to finish syncing before purging.'}
          >
            <span className="conn-config-icon">⌫</span> Purge nodeDB
          </button>
        </div>
      )}

      {/* Inline admin section — renders the chosen settings/channels/mqtt
       *  panel right here on the Connect tab instead of navigating away,
       *  so the user stays grounded in the device-admin context. */}
      {isConnected && adminSection && (
        <div className="card" style={{ padding: 0, marginTop: 4, marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>
              {adminSection === 'settings' ? 'Radio settings' : adminSection === 'channels' ? 'Channels' : 'MQTT'}
            </span>
            <button
              className="ghost"
              style={{ padding: '2px 10px', fontSize: 11 }}
              onClick={() => setAdminSection(null)}
              title="Collapse this section and return to the radio overview"
            >
              ▲ Close
            </button>
          </div>
          <div style={{ padding: 0 }}>
            {adminSection === 'settings' && <SettingsPanel state={state} embedded />}
            {adminSection === 'channels' && <ChannelsPanel state={state} embedded />}
            {adminSection === 'mqtt'     && <MqttPanel state={state} nodes={nodes} recentPackets={recentPackets} embedded />}
          </div>
        </div>
      )}

      {/* Live sync progress — shown during connecting/configuring */}
      {(state.status === 'connecting' || state.status === 'configuring') && (
        <SyncProgress
          state={state}
          nodesCount={nodesCount}
          channelsCount={channelsCount}
          elapsed={elapsed}
          connId={activeConnId ?? undefined}
        />
      )}
      {isReady && lastPacketAt && Date.now() - lastPacketAt > 5 * 60_000 && (
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)', marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 12 }}>
            <strong>It's been quiet for a while.</strong> No packets in the last few minutes. That's normal on a quiet
            mesh outside cities — verify the link is alive by sending a chat message; it'll echo back when the radio
            transmits it.
          </p>
        </div>
      )}
      {isReady && !lastPacketAt && (
        <div className="info-card" style={{ marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 12 }}>
            No packets yet — only your radio's nodeDB has synced. Mesh traffic is sparse: typical residential meshes see
            one packet every 30s–5min depending on neighbor count. Keep this app open in the background and check back later.
          </p>
        </div>
      )}

      {/* Live data: 3-up identity / config / channels grid when connected.
       *  Hidden while an inline admin section is open — the user picked
       *  "go deeper", so the high-level overview belongs out of the way. */}
      {isReady && !adminSection && (
        <div className="conn-grid">
          {state.myInfo && state.myInfo.myNodeNum > 0 && (
            <div className="card">
              <h3>Your radio</h3>
              <dl className="kv kv-tight">
                {myNode?.shortName && <><dt>Short name</dt><dd style={{ color: 'var(--accent)' }}>{myNode.shortName}</dd></>}
                {myNode?.longName && <><dt>Long name</dt><dd style={{ fontFamily: 'inherit' }}>{myNode.longName}</dd></>}
                <dt>Node #</dt><dd>!{state.myInfo.myNodeNum.toString(16).padStart(8, '0')}</dd>
                <dt>Hardware</dt><dd>{myNode?.hwModelName || '—'}</dd>
                {myNode?.role !== undefined && state.deviceConfig && <><dt>Role</dt><dd>{ROLE_NAMES[state.deviceConfig.role] ?? state.deviceConfig.role}</dd></>}
                {!myNode?.role && state.deviceConfig && <><dt>Role</dt><dd>{ROLE_NAMES[state.deviceConfig.role] ?? state.deviceConfig.role}</dd></>}
                <dt>Firmware</dt><dd>{state.myInfo.firmwareVersion || 'unknown'}</dd>
                {myNode?.batteryLevel !== undefined && (
                  <>
                    <dt>Battery</dt>
                    <dd style={{ color: myNode.batteryLevel > 50 ? 'var(--good)' : myNode.batteryLevel > 20 ? 'var(--warn)' : 'var(--bad)' }}>
                      {myNode.batteryLevel}%{myNode.voltage !== undefined && myNode.voltage > 0 ? ` · ${myNode.voltage.toFixed(2)} V` : ''}
                    </dd>
                  </>
                )}
                {myNode?.channelUtilization !== undefined && (
                  <>
                    <dt>Channel util</dt>
                    <dd style={{ color: myNode.channelUtilization >= 25 ? 'var(--warn)' : 'var(--good)' }}>{myNode.channelUtilization.toFixed(1)}%</dd>
                  </>
                )}
                {myNode?.airUtilTx !== undefined && (<><dt>Air util TX</dt><dd>{myNode.airUtilTx.toFixed(2)}%</dd></>)}
                {myNode?.lat !== undefined && myNode?.lon !== undefined && (
                  <>
                    <dt>Position</dt><dd>{myNode.lat.toFixed(5)}, {myNode.lon.toFixed(5)}</dd>
                    {myNode.altitude !== undefined && <><dt>Altitude</dt><dd>{myNode.altitude} m</dd></>}
                  </>
                )}
                <dt>WiFi · BT</dt><dd>{state.myInfo.hasWifi ? '✓' : '–'} wifi · {state.myInfo.hasBluetooth ? '✓' : '–'} bt</dd>
                <dt>Max channels</dt><dd>{state.myInfo.maxChannels}</dd>
              </dl>
            </div>
          )}

          {state.loraConfig && (
            <div className="card">
              <div className="card-head-row">
                <h3 style={{ margin: 0 }}>LoRa config</h3>
                <button className="card-edit-link" onClick={() => setAdminSection('settings')}>Edit →</button>
              </div>
              <dl className="kv kv-tight">
                <dt>Region</dt><dd>{state.loraConfig.regionName}</dd>
                <dt>Preset</dt>
                <dd>
                  {state.loraConfig.usePreset
                    ? state.loraConfig.modemPresetName
                    : `SF${state.loraConfig.spreadFactor}/${(state.loraConfig.bandwidth / 1000).toFixed(0)} kHz/4-${state.loraConfig.codingRate}`}
                </dd>
                <dt>TX power</dt>
                <dd>
                  {state.loraConfig.txPower || 'auto'}
                  {state.loraConfig.txPower ? ' dBm' : ''}
                  {state.loraConfig.txEnabled ? '' : <span style={{ color: 'var(--bad)' }}> · TX OFF</span>}
                </dd>
                <dt>Hop limit</dt><dd>{state.loraConfig.hopLimit || 3}</dd>
                <dt>Boost RX</dt><dd>{state.loraConfig.sx126xRxBoostedGain ? 'on' : 'off'}</dd>
                {state.loraConfig.overrideFrequency > 0 && <><dt>Freq</dt><dd>{state.loraConfig.overrideFrequency.toFixed(3)} MHz</dd></>}
              </dl>
              {!state.loraConfig.txEnabled && (
                <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--bad)' }}>
                  Re-enable TX in the official app under <em>Radio → LoRa</em> to send messages.
                </p>
              )}
            </div>
          )}

          {state.channels && state.channels.length > 0 && (
            <div className="card">
              <div className="card-head-row">
                <h3 style={{ margin: 0 }}>Channels</h3>
                <button className="card-edit-link" onClick={() => setAdminSection('channels')}>Edit →</button>
              </div>
              <table className="data" style={{ fontSize: 11.5 }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Crypto</th>
                  </tr>
                </thead>
                <tbody>
                  {state.channels.filter((c) => c.role !== 0).map((c) => (
                    <tr key={c.index}>
                      <td>{c.index}</td>
                      <td style={{ fontFamily: 'inherit', color: 'var(--text)' }}>{c.name || '(default)'}</td>
                      <td>{c.roleName}</td>
                      <td style={{ fontSize: 11 }}>{pskDescription(c.pskLength)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {state.channels.filter((c) => c.role === 0).length > 0 && (
                <p style={{ marginTop: 8, color: 'var(--text-faint)', fontSize: 11 }}>
                  {state.channels.filter((c) => c.role === 0).length} disabled slots hidden.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      </>}

      {/* Static help collapses when connected — disconnected users still see it inline */}
      {!isConnected ? (
        <div className="layout-split-wide" style={{ marginTop: 4 }}>
          <div>
            <div className="info-card">
              <p style={{ margin: 0 }}><strong>What can fail at each stage</strong></p>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)' }}>
                <li><strong>Discover:</strong> charge-only USB cable, kernel hasn't enumerated yet, old driver suppressing the device.</li>
                <li><strong>Open:</strong> another app holds the port (the official Meshtastic CLI/desktop, or a stale instance of this app).</li>
                <li><strong>Configure:</strong> the radio is wedged or in deep sleep — power-cycle by holding the button, or unplug for 5 seconds.</li>
                <li><strong>Sync:</strong> framing is corrupt (rare — usually a flaky cable). Try a known-good data cable.</li>
                <li><strong>Ready, no traffic:</strong> the mesh is just quiet. Send a chat message — your packet echoes back when the radio transmits.</li>
              </ul>
            </div>
            <div className="info-card">
              <p><strong>Why USB first?</strong></p>
              <p style={{ marginBottom: 0 }}>BLE and WiFi/TCP also work, but USB is direct, fast, and requires zero pairing. The official mobile app talks BLE — and BLE on Meshtastic is famously flaky, especially on iOS where the GATT cache stales out. USB takes that whole class of bug off the table.</p>
            </div>
          </div>
          <div>
            <div className="card">
              <h3>Other transports (later)</h3>
              <dl className="kv">
                <dt>Bluetooth LE</dt><dd>GATT 6ba1b218-…-eafd</dd>
                <dt>WiFi / TCP</dt><dd>port 4403</dd>
                <dt>UDP multicast</dt><dd>port 4404</dd>
              </dl>
            </div>
            <div className="card">
              <h3>Detection model</h3>
              <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12 }}>
                We classify every USB-serial chip family — CP210x, CH340/CH9102, FTDI, ESP32-S3 native, nRF52 native, RP2040 native. New Meshtastic hardware on any of those chips shows up automatically as a likely candidate.
              </p>
              {ports.some(p => p.confidence === 'confirmed') && (
                <p style={{ marginTop: 8, marginBottom: 0, color: 'var(--good)', fontSize: 11.5, fontFamily: 'var(--mono)' }}>
                  ✓ {ports.filter(p => p.confidence === 'confirmed').length}
                  {' · '}◯ {ports.filter(p => p.confidence === 'likely').length}
                  {' · '}· {ports.filter(p => p.confidence === 'possible').length}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <button
            className="ghost"
            onClick={() => setShowHelp((v) => !v)}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            {showHelp ? '▲ Hide troubleshooting & transport notes' : '▼ Show troubleshooting & transport notes'}
          </button>
          {showHelp && (
            <div className="layout-split-wide" style={{ marginTop: 12 }}>
              <div>
                <div className="info-card">
                  <p style={{ margin: 0 }}><strong>What can fail</strong></p>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)' }}>
                    <li><strong>USB drop:</strong> the cable jiggled or the radio rebooted. We auto-reconnect and resync the nodeDB.</li>
                    <li><strong>Quiet mesh:</strong> totally normal. Send a message; your own echo confirms the link is alive.</li>
                    <li><strong>TX disabled:</strong> shown above as <em>TX OFF</em>. You can read traffic but not send. Toggle in the official app.</li>
                  </ul>
                </div>
              </div>
              <div>
                <div className="card">
                  <h3>Other transports</h3>
                  <dl className="kv">
                    <dt>Bluetooth LE</dt><dd>GATT 6ba1b218-…-eafd</dd>
                    <dt>WiFi / TCP</dt><dd>port 4403</dd>
                    <dt>UDP multicast</dt><dd>port 4404</dd>
                  </dl>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StageChip({ stage, status }: { stage: Stage; status: 'done' | 'active' | 'pending' }) {
  const cls = `stage-chip stage-${status}`;
  return (
    <div className={cls} title={stage.hint}>
      {status === 'done' ? '✓ ' : status === 'active' ? '● ' : '○ '}{stage.label}
    </div>
  );
}

interface SyncTapeEvent {
  at: number;
  kind: 'identity' | 'metadata' | 'lora' | 'device' | 'position' | 'power' | 'network' | 'display' | 'bluetooth' | 'mqtt' | 'channel' | 'node' | 'retry' | 'stall';
  text: string;
  detail?: string;
}

function fmtSinceStart(at: number, startedAt: number): string {
  const d = Math.max(0, at - startedAt);
  if (d < 1000) return `+${d}ms`;
  return `+${(d / 1000).toFixed(1)}s`;
}

function tapeKindColor(kind: SyncTapeEvent['kind']): string {
  switch (kind) {
    case 'identity':  return 'var(--accent)';
    case 'metadata':  return 'var(--accent)';
    case 'channel':   return 'var(--good)';
    case 'node':      return 'var(--text)';
    case 'retry':     return 'var(--warn)';
    case 'stall':     return 'var(--bad)';
    default:          return 'var(--text-dim)';
  }
}

function tapeKindGlyph(kind: SyncTapeEvent['kind']): string {
  switch (kind) {
    case 'identity':  return '#';
    case 'metadata':  return 'i';
    case 'lora':
    case 'device':
    case 'position':
    case 'power':
    case 'network':
    case 'display':
    case 'bluetooth':
    case 'mqtt':      return '⚙';
    case 'channel':   return '⛓';
    case 'node':      return '•';
    case 'retry':     return '↻';
    case 'stall':     return '⚠';
  }
}

function SyncProgress({
  state,
  nodesCount,
  channelsCount,
  elapsed,
  connId,
}: {
  state: ConnectionState;
  nodesCount: number;
  channelsCount: number;
  elapsed: number;
  /** Active connection id — used for the manual retry button and the
   *  per-connection NodeInfo subscription that feeds the activity tape. */
  connId?: string;
}) {
  // Watchdog-derived liveness signal. Counts up between frames; resets
  // every time the controller observes a new FromRadio. Past 4s without
  // a frame we tint it warn so the user can see the stall coming.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const sinceLastFrameMs = state.sync ? Math.max(0, now - state.sync.lastFrameAt) : 0;
  const sinceLastFrameLabel = state.sync
    ? sinceLastFrameMs < 800 ? 'just now'
      : sinceLastFrameMs < 1500 ? '1s ago'
      : `${(sinceLastFrameMs / 1000).toFixed(1)}s ago`
    : '—';
  const livenessTone =
    !state.sync ? 'dim'
    : sinceLastFrameMs < 1500 ? 'good'
    : sinceLastFrameMs < 4000 ? 'warn'
    : 'bad';
  const retries = state.sync?.retries ?? 0;

  const [retrying, setRetrying] = useState(false);
  const onRetry = async () => {
    if (!connId) return;
    setRetrying(true);
    try { await window.mesh.retrySync(connId); }
    finally { setTimeout(() => setRetrying(false), 800); }
  };

  // ── Live activity tape ──────────────────────────────────────────────
  // Each interpreted FromRadio frame appears as a one-liner, time-stamped
  // relative to sync start. We derive this entirely from state diffs +
  // the per-connection node subscription, so no new IPC was needed: the
  // controller already streams these as state/node events.
  const [tape, setTape] = useState<SyncTapeEvent[]>([]);
  const TAPE_MAX = 80;
  const pushTape = (ev: SyncTapeEvent | SyncTapeEvent[]) => {
    setTape((cur) => {
      const next = cur.concat(ev);
      return next.length > TAPE_MAX ? next.slice(next.length - TAPE_MAX) : next;
    });
  };

  // Reset whenever a fresh sync starts (startedAt is the canonical "epoch").
  const syncStartedAt = state.sync?.startedAt ?? 0;
  useEffect(() => {
    setTape([]);
  }, [syncStartedAt]);

  // Diff state across renders → emit one event for each freshly-arrived
  // config / identity / channel. Bounded to the configuring window so the
  // tape doesn't keep growing once we hit ready.
  const prevStateRef = useRef<{
    myNodeNum?: number;
    firmwareVersion?: string;
    hasBluetooth?: boolean;
    loraConfig?: boolean;
    deviceConfig?: boolean;
    positionConfig?: boolean;
    powerConfig?: boolean;
    networkConfig?: boolean;
    displayConfig?: boolean;
    bluetoothConfig?: boolean;
    mqttConfig?: boolean;
    channelCount: number;
    retries: number;
    stalled: boolean;
  }>({ channelCount: 0, retries: 0, stalled: false });

  useEffect(() => {
    if (state.status !== 'configuring' && state.status !== 'ready') return;
    const prev = prevStateRef.current;
    const newEvents: SyncTapeEvent[] = [];
    const now = Date.now();

    if (state.myInfo?.myNodeNum && state.myInfo.myNodeNum !== prev.myNodeNum) {
      newEvents.push({ at: now, kind: 'identity', text: `Radio identity !${state.myInfo.myNodeNum.toString(16).padStart(8, '0')}` });
    }
    if (state.myInfo?.firmwareVersion && state.myInfo.firmwareVersion !== prev.firmwareVersion) {
      const caps: string[] = [];
      if (state.myInfo.hasBluetooth) caps.push('BLE');
      if (state.myInfo.hasWifi) caps.push('Wi-Fi');
      newEvents.push({ at: now, kind: 'metadata', text: `Firmware ${state.myInfo.firmwareVersion}`, detail: caps.length ? caps.join(' · ') : undefined });
    }
    if (state.loraConfig && !prev.loraConfig) {
      const lc = state.loraConfig;
      newEvents.push({ at: now, kind: 'lora', text: 'LoRa config', detail: `${lc.regionName} · ${lc.usePreset ? lc.modemPresetName : 'custom'}` });
    }
    if (state.deviceConfig && !prev.deviceConfig) {
      newEvents.push({ at: now, kind: 'device', text: 'Device config', detail: `role=${state.deviceConfig.role}` });
    }
    if (state.positionConfig && !prev.positionConfig) {
      newEvents.push({ at: now, kind: 'position', text: 'Position config' });
    }
    if (state.powerConfig && !prev.powerConfig) {
      newEvents.push({ at: now, kind: 'power', text: 'Power config' });
    }
    if (state.networkConfig && !prev.networkConfig) {
      newEvents.push({ at: now, kind: 'network', text: 'Network config' });
    }
    if (state.displayConfig && !prev.displayConfig) {
      newEvents.push({ at: now, kind: 'display', text: 'Display config' });
    }
    if (state.bluetoothConfig && !prev.bluetoothConfig) {
      newEvents.push({ at: now, kind: 'bluetooth', text: 'Bluetooth config', detail: state.bluetoothConfig.enabled ? 'enabled' : 'disabled' });
    }
    if (state.mqttConfig && !prev.mqttConfig) {
      newEvents.push({ at: now, kind: 'mqtt', text: 'MQTT config', detail: state.mqttConfig.enabled ? 'enabled' : 'disabled' });
    }
    // Channels arrive one at a time — emit one row per fresh slot.
    const channels = state.channels ?? [];
    if (channels.length > prev.channelCount) {
      for (let i = prev.channelCount; i < channels.length; i++) {
        const c = channels[i];
        const name = c.name || (c.role === 1 ? '(primary, default)' : '(unnamed)');
        newEvents.push({ at: now, kind: 'channel', text: `Channel ${c.index}`, detail: `${name} · ${c.roleName}` });
      }
    }
    // Retries — tag the moment we re-sent wantConfig.
    const retries = state.sync?.retries ?? 0;
    if (retries > prev.retries) {
      newEvents.push({ at: now, kind: 'retry', text: `wantConfig re-sent (retry ${retries})`, detail: 'previous frame likely dropped on USB/BLE' });
    }
    // Slow-mode warning — the soft timeout fired but we're still listening.
    const stalled = state.sync?.failure === 'stall';
    if (stalled && !prev.stalled) {
      newEvents.push({ at: now, kind: 'stall', text: 'Sync slow — slow-retry mode', detail: 'transport stays open · radio may still wake up' });
    }
    if (newEvents.length > 0) pushTape(newEvents);

    prevStateRef.current = {
      myNodeNum: state.myInfo?.myNodeNum,
      firmwareVersion: state.myInfo?.firmwareVersion,
      hasBluetooth: state.myInfo?.hasBluetooth,
      loraConfig: !!state.loraConfig,
      deviceConfig: !!state.deviceConfig,
      positionConfig: !!state.positionConfig,
      powerConfig: !!state.powerConfig,
      networkConfig: !!state.networkConfig,
      displayConfig: !!state.displayConfig,
      bluetoothConfig: !!state.bluetoothConfig,
      mqttConfig: !!state.mqttConfig,
      channelCount: channels.length,
      retries,
      stalled,
    };
  }, [state]);

  // Per-connection NodeInfo subscription — pushes one tape row per peer
  // as it arrives in the nodeDB dump.
  useEffect(() => {
    if (!connId) return;
    return window.mesh.onNode(({ connId: cid, node }) => {
      if (cid !== connId) return;
      const hex = node.num.toString(16).padStart(8, '0');
      const longLabel = node.longName || node.shortName || `!${hex}`;
      const shortLabel = node.shortName ? ` (${node.shortName})` : '';
      const hwLabel = node.hwModelName && node.hwModelName !== 'UNSET' ? ` · ${node.hwModelName}` : '';
      pushTape({ at: Date.now(), kind: 'node', text: `NodeInfo: ${longLabel}${shortLabel}`, detail: `!${hex}${hwLabel}` });
    });
  }, [connId]);

  // Auto-scroll to bottom as new rows arrive — sticky if the user is
  // already at the bottom; leave them alone otherwise (so they can read
  // history without the tape yanking them down).
  const tapeRef = useRef<HTMLDivElement | null>(null);
  const tapeStickyRef = useRef(true);
  useEffect(() => {
    const el = tapeRef.current;
    if (!el || !tapeStickyRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [tape.length]);
  const onTapeScroll = () => {
    const el = tapeRef.current;
    if (!el) return;
    tapeStickyRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  // Heuristic completeness: each item received contributes a chunk; nodes
  // contribute proportional to the count so the bar grows visibly during the
  // long node-DB phase.
  const portOpen = state.status === 'configuring' || state.status === 'ready';
  const hasMyInfo = !!state.myInfo && state.myInfo.myNodeNum > 0;
  const hasLora = !!state.loraConfig;
  const hasChannels = channelsCount > 0;
  const tickedCount = (portOpen ? 1 : 0) + (hasMyInfo ? 1 : 0) + (hasLora ? 1 : 0) + (hasChannels ? 1 : 0);
  // 4 fixed milestones get 60% of the bar; node count fills the remaining 40%
  // logarithmically (so '5 nodes' and '50 nodes' both feel like progress).
  const milestoneFraction = (tickedCount / 4) * 0.6;
  const nodeFraction = nodesCount > 0 ? Math.min(0.4, 0.4 * (Math.log10(1 + nodesCount) / Math.log10(50))) : 0;
  const fillPct = Math.min(100, Math.round((milestoneFraction + nodeFraction) * 100));

  const items: Array<{ label: string; done: boolean; detail?: string }> = [
    {
      label: 'Serial port open',
      done: portOpen,
      detail: portOpen ? state.portPath ?? undefined : undefined,
    },
    {
      label: 'Radio identity',
      done: hasMyInfo,
      detail: hasMyInfo
        ? `!${state.myInfo!.myNodeNum.toString(16).padStart(8, '0')}${state.myInfo!.firmwareVersion ? ' · fw ' + state.myInfo!.firmwareVersion : ''}`
        : undefined,
    },
    {
      label: 'LoRa config',
      done: hasLora,
      detail: hasLora
        ? `${state.loraConfig!.regionName} · ${state.loraConfig!.usePreset ? state.loraConfig!.modemPresetName : 'custom'}`
        : undefined,
    },
    {
      label: 'Channels',
      done: hasChannels,
      detail: hasChannels ? `${channelsCount} received` : undefined,
    },
    {
      label: 'NodeDB',
      done: false, // Always "in progress" — the radio doesn't tell us when it's done with nodes; config_complete ends the whole sync.
      detail: nodesCount > 0 ? `${nodesCount} nodes received…` : 'waiting…',
    },
  ];

  const livenessColor =
    livenessTone === 'good' ? 'var(--good)'
    : livenessTone === 'warn' ? 'var(--warn)'
    : livenessTone === 'bad' ? 'var(--bad)'
    : 'var(--text-faint)';

  return (
    <div className="card sync-progress">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 12 }}>SYNCING</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'var(--mono)', fontSize: 11 }}>
          <span style={{ color: 'var(--text-faint)' }}>{elapsed}s elapsed</span>
          <span title="Time since the radio last sent us anything. Long gaps mean a wedged firmware or a dropped wantConfig.">
            <span style={{ color: 'var(--text-faint)' }}>last frame </span>
            <span style={{ color: livenessColor, fontWeight: 600 }}>{sinceLastFrameLabel}</span>
          </span>
          {retries > 0 && (
            <span title="Number of times we re-sent wantConfig because the radio went silent. The first attempt may have been dropped on USB / BLE.">
              <span style={{ color: 'var(--text-faint)' }}>retries </span>
              <span style={{ color: 'var(--warn)', fontWeight: 600 }}>{retries}</span>
            </span>
          )}
          {connId && (
            <button
              className="ghost"
              onClick={onRetry}
              disabled={retrying}
              title="Re-send wantConfig now. Useful when the watchdog hasn't fired yet but the radio's clearly silent."
              style={{ fontSize: 11, padding: '2px 8px' }}
            >
              {retrying ? 'sent…' : '↻ Retry now'}
            </button>
          )}
        </div>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${fillPct}%` }} />
        <div className="progress-shimmer" />
      </div>
      {state.sync?.failure === 'stall' && state.error && (
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)', marginTop: 10, marginBottom: 4 }}>
          <p style={{ margin: 0, fontSize: 12.5 }}>{state.error}</p>
        </div>
      )}
      <ul className="sync-checklist">
        {items.map((it, i) => (
          <li key={i} className={it.done ? 'done' : 'pending'}>
            <span className="sync-check">{it.done ? '✓' : '○'}</span>
            <span className="sync-label">{it.label}</span>
            {it.detail && <span className="sync-detail">{it.detail}</span>}
          </li>
        ))}
      </ul>

      <div className="sync-tape-head">
        <span className="sync-tape-title">Live activity</span>
        <span className="sync-tape-meta">{tape.length} event{tape.length === 1 ? '' : 's'}</span>
      </div>
      <div className="sync-tape" ref={tapeRef} onScroll={onTapeScroll} aria-live="polite">
        {tape.length === 0 ? (
          <div className="sync-tape-empty">Waiting for the first FromRadio frame…</div>
        ) : tape.map((ev, i) => (
          <div key={i} className={`sync-tape-row sync-tape-${ev.kind}`}>
            <span className="sync-tape-time">{syncStartedAt ? fmtSinceStart(ev.at, syncStartedAt) : ''}</span>
            <span className="sync-tape-glyph" style={{ color: tapeKindColor(ev.kind) }}>{tapeKindGlyph(ev.kind)}</span>
            <span className="sync-tape-text">{ev.text}</span>
            {ev.detail && <span className="sync-tape-detail">{ev.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectError({ message }: { message: string }) {
  const lower = message.toLowerCase();
  const isPerm = lower.includes('permission denied');
  const isBusy = lower.includes('is busy') || lower.includes('resource busy');
  const isGone = lower.includes('disappeared');

  // Pull out a shell command if the message contains one in quotes — render as a
  // copyable code block so the user doesn't have to retype it.
  const cmdMatch = message.match(/"([^"]*sudo[^"]*)"/);
  const cmd = cmdMatch?.[1];
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!cmd) return;
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard may be unavailable; user can still select and copy */ }
  };

  let title = 'Connection failed';
  if (isPerm) title = 'Permission denied — your user can\'t open the serial device';
  else if (isBusy) title = 'Port is busy — another app holds it open';
  else if (isGone) title = 'The port vanished';

  return (
    <div
      className="info-card"
      style={{ borderLeftColor: 'var(--bad)', marginTop: 10 }}
      role="alert"
    >
      <p style={{ margin: '0 0 6px', color: 'var(--bad)', fontWeight: 600 }}>{title}</p>
      <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--text-dim)', whiteSpace: 'pre-line' }}>{message}</p>
      {cmd && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
          <code
            style={{
              flex: 1,
              fontFamily: 'var(--mono)',
              fontSize: 12,
              padding: '6px 8px',
              background: 'var(--bg-deep, #0b0d11)',
              border: '1px solid var(--border, #2a2f38)',
              borderRadius: 4,
              userSelect: 'all',
              whiteSpace: 'nowrap',
              overflowX: 'auto',
            }}
          >
            {cmd}
          </code>
          <button className="ghost" onClick={copy} style={{ fontSize: 11, padding: '4px 10px' }}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
      {isPerm && (
        <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>
          After running the command you must log out and back in (or run <code>newgrp dialout</code> in the shell that launches this app) for the group change to take effect.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'dim' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : tone === 'dim' ? 'var(--text-faint)' : 'var(--text)';
  return (
    <div className="conn-stat">
      <div className="conn-stat-label">{label}</div>
      <div className="conn-stat-value" style={{ color }}>{value}</div>
    </div>
  );
}
