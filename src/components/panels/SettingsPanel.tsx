import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveConnId, useMeshContext } from '../../hooks/MeshContext';

const REGIONS: Array<{ value: number; label: string; band: string }> = [
  { value: 0, label: 'UNSET',     band: '— pick one —' },
  { value: 1, label: 'US',        band: '902–928 MHz' },
  { value: 2, label: 'EU_433',    band: '433.05–434.79 MHz' },
  { value: 3, label: 'EU_868',    band: '869.4–869.65 MHz' },
  { value: 4, label: 'CN',        band: '470–510 MHz' },
  { value: 5, label: 'JP',        band: '920.8–927.8 MHz' },
  { value: 6, label: 'ANZ',       band: '915–928 MHz (AU/NZ)' },
  { value: 7, label: 'KR',        band: '920–923 MHz' },
  { value: 8, label: 'TW',        band: '920–925 MHz' },
  { value: 9, label: 'RU',        band: '868.7–869.2 MHz' },
  { value: 10, label: 'IN',       band: '865–867 MHz' },
  { value: 11, label: 'NZ_865',   band: '864–868 MHz' },
  { value: 12, label: 'TH',       band: '920–925 MHz' },
  { value: 13, label: 'LORA_24',  band: '2.4 GHz ISM' },
  { value: 14, label: 'UA_433',   band: '433 MHz (Ukraine)' },
  { value: 15, label: 'UA_868',   band: '868 MHz (Ukraine)' },
  { value: 16, label: 'MY_433',   band: '433 MHz (Malaysia)' },
  { value: 17, label: 'MY_919',   band: '919–924 MHz (Malaysia)' },
  { value: 18, label: 'SG_923',   band: '917–925 MHz (Singapore)' },
];

const PRESETS: Array<{ value: number; label: string; hint: string }> = [
  { value: 0, label: 'LongFast',     hint: 'DEFAULT · SF11/250kHz · ~1 kbit/s · good range' },
  { value: 1, label: 'LongSlow',     hint: 'SF12/125kHz · ~0.2 kbit/s · max range, slow' },
  { value: 2, label: 'VeryLongSlow', hint: 'SF12/62.5kHz · slowest, longest range (illegal in some EU)' },
  { value: 3, label: 'MediumSlow',   hint: 'SF10/250kHz · balanced' },
  { value: 4, label: 'MediumFast',   hint: 'SF9/250kHz · balanced, faster' },
  { value: 5, label: 'ShortSlow',    hint: 'SF8/250kHz · fast, short range' },
  { value: 6, label: 'ShortFast',    hint: 'SF7/250kHz · faster, short range' },
  { value: 7, label: 'LongModerate', hint: 'SF11/125kHz' },
  { value: 8, label: 'ShortTurbo',   hint: 'SF7/500kHz · fastest LoRa preset' },
];

const DEVICE_ROLES = [
  { value: 0, label: 'CLIENT', hint: 'default · normal user node' },
  { value: 1, label: 'CLIENT_MUTE', hint: 'receive-only · won\'t rebroadcast' },
  { value: 2, label: 'ROUTER', hint: 'high-uptime relay, optimised for forwarding' },
  { value: 3, label: 'ROUTER_CLIENT', hint: 'deprecated · use ROUTER' },
  { value: 4, label: 'REPEATER', hint: 'just rebroadcasts · doesn\'t appear as a user' },
  { value: 5, label: 'TRACKER', hint: 'low-power GPS beacon mode' },
  { value: 6, label: 'SENSOR', hint: 'periodic telemetry broadcaster' },
  { value: 7, label: 'TAK', hint: 'TAK client integration' },
  { value: 8, label: 'CLIENT_HIDDEN', hint: 'normal node but suppressed from others\' nodeDBs' },
  { value: 9, label: 'LOST_AND_FOUND', hint: 'shouts location on a fixed channel' },
  { value: 10, label: 'TAK_TRACKER', hint: 'TAK + tracker' },
  { value: 11, label: 'ROUTER_LATE', hint: 'router that prefers to defer to other routers' },
];

const REBROADCAST_MODES = [
  { value: 0, label: 'ALL', hint: 'rebroadcast everything · default for most roles' },
  { value: 1, label: 'ALL_SKIP_DECODING', hint: 'rebroadcast without decrypting/decoding · max throughput' },
  { value: 2, label: 'LOCAL_ONLY', hint: 'only rebroadcast packets that originated locally' },
  { value: 3, label: 'KNOWN_ONLY', hint: 'only rebroadcast from nodes in your nodeDB' },
  { value: 4, label: 'NONE', hint: 'do not rebroadcast anything · receive-only relay' },
];

const GPS_MODES = [
  { value: 0, label: 'DISABLED', hint: 'GPS hardware never powered · saves battery' },
  { value: 1, label: 'ENABLED', hint: 'GPS active per interval' },
  { value: 2, label: 'NOT_PRESENT', hint: 'no GPS hardware on this board' },
];

const BT_MODES = [
  { value: 0, label: 'RANDOM_PIN', hint: 'shows a random 6-digit PIN on the screen at pairing time' },
  { value: 1, label: 'FIXED_PIN', hint: 'use the fixed PIN below' },
  { value: 2, label: 'NO_PIN', hint: 'no pairing PIN — insecure but convenient' },
];

const DISPLAY_UNITS = [
  { value: 0, label: 'METRIC', hint: 'metres, kilometres, celsius' },
  { value: 1, label: 'IMPERIAL', hint: 'feet, miles, fahrenheit' },
];

const NETWORK_ADDRESS_MODES = [
  { value: 0, label: 'DHCP', hint: 'get IPv4 from DHCP server' },
  { value: 1, label: 'STATIC', hint: 'use the static IP fields below (not yet exposed)' },
];

type ConfigSection = 'lora' | 'device' | 'position' | 'power' | 'bluetooth' | 'display' | 'network';

export function SettingsPanel({ state }: { state: ConnectionState }) {
  const [section, setSection] = useState<ConfigSection>('lora');
  const isReady = state.status === 'ready';
  const { connections, activeConnId, setActiveConnId } = useMeshContext();
  const active = connections.find((c) => c.connId === activeConnId);
  const myNum = state.myInfo?.myNodeNum;
  const myNode = myNum ? state.channels && active?.nodes.find((n) => n.num === myNum) : undefined;
  const radioLabel = myNode?.shortName || myNode?.longName || state.portPath?.split('/').pop() || activeConnId || 'radio';

  return (
    <div className="page">
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">
        Change your radio's configuration directly. Most changes trigger a device reboot (~5–10 s) — this app will auto-reconnect and resync.
      </p>

      {/* Active radio header — critical with multi-radio: every Apply goes to this one */}
      {connections.length > 0 && (
        <div className="settings-target">
          <span className="settings-target-label">EDITING</span>
          {connections.length > 1 ? (
            <select
              className="text settings-target-select"
              value={activeConnId ?? ''}
              onChange={(e) => setActiveConnId(e.target.value || null)}
            >
              {connections.map((c) => {
                const cMy = c.state.myInfo?.myNodeNum;
                const cName = cMy ? c.nodes.find((n) => n.num === cMy) : undefined;
                const label = cName?.shortName || cName?.longName || c.portPath?.split('/').pop() || c.connId;
                return <option key={c.connId} value={c.connId}>{label} ({c.state.status})</option>;
              })}
            </select>
          ) : (
            <span className="settings-target-name">{radioLabel}</span>
          )}
          {state.portPath && <span className="settings-target-port">{state.portPath}</span>}
          {state.myInfo?.firmwareVersion && <span className="settings-target-fw">fw {state.myInfo.firmwareVersion}</span>}
        </div>
      )}

      {!isReady && (
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)', marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>Not connected.</strong> Connect to a radio first — settings are written via admin commands sent over USB.
          </p>
        </div>
      )}

      {/* The radio reports its own capabilities in MyInfo. Use them to grey
       *  out config sections that don't apply to this hardware (e.g. an nRF52
       *  board with no WiFi shouldn't pretend it can join WiFi). */}
      {(() => {
        const hasWifi = state.myInfo?.hasWifi ?? true;
        const hasBluetooth = state.myInfo?.hasBluetooth ?? true;
        const sections: Array<{ id: ConfigSection; label: string; disabled?: boolean; reason?: string }> = [
          { id: 'lora',      label: 'LoRa' },
          { id: 'device',    label: 'Device' },
          { id: 'position',  label: 'Position' },
          { id: 'power',     label: 'Power' },
          { id: 'bluetooth', label: 'Bluetooth', disabled: !hasBluetooth, reason: 'This radio does not have a Bluetooth radio (per MyInfo.has_bluetooth).' },
          { id: 'display',   label: 'Display' },
          { id: 'network',   label: 'Network',   disabled: !hasWifi,      reason: 'This radio does not have a WiFi radio (per MyInfo.has_wifi). Network config has no effect.' },
        ];
        // If the current section just got disabled (e.g. user switched radios),
        // bounce back to a safe one so we don't render a disabled-only screen.
        if (section === 'bluetooth' && !hasBluetooth) setTimeout(() => setSection('lora'), 0);
        if (section === 'network' && !hasWifi)        setTimeout(() => setSection('lora'), 0);
        return (
          <div className="subnav">
            {sections.map((s) => (
              <button
                key={s.id}
                className={'subnav-btn' + (section === s.id ? ' active' : '') + (s.disabled ? ' disabled' : '')}
                onClick={() => !s.disabled && setSection(s.id)}
                disabled={s.disabled}
                title={s.reason}
              >
                {s.label}
                {s.disabled && <span style={{ marginLeft: 4, opacity: 0.5 }}>·</span>}
              </button>
            ))}
          </div>
        );
      })()}

      {section === 'lora'      && <LoRaEditor      state={state} isReady={isReady} />}
      {section === 'device'    && <DeviceEditor    state={state} isReady={isReady} />}
      {section === 'position'  && <PositionEditor  state={state} isReady={isReady} />}
      {section === 'power'     && <PowerEditor     state={state} isReady={isReady} />}
      {section === 'bluetooth' && <BluetoothEditor state={state} isReady={isReady} />}
      {section === 'display'   && <DisplayEditor   state={state} isReady={isReady} />}
      {section === 'network'   && <NetworkEditor   state={state} isReady={isReady} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared form harness
// ─────────────────────────────────────────────────────────────────────

interface EditorHarnessProps<T> {
  live: T | undefined;
  isReady: boolean;
  apply: (next: T) => Promise<void>;
  title: string;
  description: React.ReactNode;
  rightColumn: React.ReactNode;
  renderForm: (draft: T, update: <K extends keyof T>(k: K, v: T[K]) => void) => React.ReactNode;
  diffRows: (live: T, draft: T) => Array<{ field: string; live: any; draft: any }>;
}

function EditorHarness<T extends object>({ live, isReady, apply, title, description, rightColumn, renderForm, diffRows }: EditorHarnessProps<T>) {
  const [draft, setDraft] = useState<T | null>(null);
  // Track what `live` *actually was* by content, not by reference — the parent
  // rebuilds `live` on every render, so a naive [live] dep would reset the
  // draft on every keystroke. Only re-seed when a value genuinely changed
  // (e.g. the radio echoed back a fresh config after a reboot).
  const livePrevRef = useRef<T | undefined>(undefined);
  useEffect(() => {
    if (!live) return;
    const prev = livePrevRef.current;
    const changed = !prev || Object.keys(live).some((k) => (live as any)[k] !== (prev as any)[k]);
    if (changed) {
      setDraft({ ...(live as any) });
      livePrevRef.current = { ...(live as any) };
    }
  }, [live]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn' | 'bad'; text: string } | null>(null);
  // What we last sent to the radio + when. Cleared once `live` echoes a match,
  // or when the verification times out.
  const [pendingApply, setPendingApply] = useState<{ at: number; expected: T } | null>(null);
  const [, setTick] = useState(0);

  // 1-Hz tick so the "(Xs ago)" portion of the pending message updates.
  useEffect(() => {
    if (!pendingApply) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [pendingApply]);

  // Verify a pending apply: when the radio echoes a fresh config, compare it
  // to what we sent. Match → confirmed; mismatch is silent until timeout.
  useEffect(() => {
    if (!pendingApply || !live) return;
    const matches = Object.keys(pendingApply.expected).every((k) => {
      const exp = (pendingApply.expected as any)[k];
      const got = (live as any)[k];
      if (typeof exp === 'number' && typeof got === 'number') return Math.abs(exp - got) < 0.001;
      return exp === got;
    });
    if (matches) {
      const dt = ((Date.now() - pendingApply.at) / 1000).toFixed(1);
      setMsg({ tone: 'good', text: `✓ Radio confirmed — config echoed back after ${dt}s.` });
      setPendingApply(null);
    }
  }, [live, pendingApply]);

  // Verification timeout — admin messages can be silently dropped; surface that.
  useEffect(() => {
    if (!pendingApply) return;
    const handle = setTimeout(() => {
      setMsg({
        tone: 'bad',
        text: 'No matching config echo in 45 s — the change may not have applied. Likely causes: firmware requires session passkey, value outside region\'s allowed range, or the admin message was dropped. Check the Compare Radios panel to see the radio\'s actual current values.',
      });
      setPendingApply(null);
    }, 45_000);
    return () => clearTimeout(handle);
  }, [pendingApply]);

  const dirty = useMemo(() => {
    if (!live || !draft) return false;
    for (const k of Object.keys(live) as Array<keyof T>) {
      if ((draft as any)[k] !== (live as any)[k]) return true;
    }
    return false;
  }, [live, draft]);

  if (!live || !draft) {
    return (
      <div className="card">
        <div className="empty">
          {isReady ? `Waiting for ${title.toLowerCase()} config from radio…` : 'Connect to a radio first.'}
        </div>
      </div>
    );
  }

  const update = <K extends keyof T>(k: K, v: T[K]) => setDraft((p) => (p ? { ...(p as any), [k]: v } : p));

  const onApply = async () => {
    if (!draft) return;
    setBusy(true); setMsg(null);
    const snapshot = { at: Date.now(), expected: { ...(draft as any) } as T };
    try {
      await apply(draft);
      setPendingApply(snapshot);
      setMsg({ tone: 'warn', text: '⏳ Sent to radio. Waiting for echo confirming the new values (up to 45s — radio reboots first on most changes)…' });
    } catch (e: any) {
      setMsg({ tone: 'bad', text: 'Error sending to radio: ' + (e?.message ?? String(e)) });
    } finally {
      setBusy(false);
    }
  };

  const revert = () => { setDraft({ ...(live as any) }); setMsg(null); setPendingApply(null); };

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{title}</h2>
          {description && <div style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 12.5 }}>{description}</div>}
          {renderForm(draft, update)}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="primary" onClick={onApply} disabled={!isReady || busy || !dirty}>
              {busy ? 'Sending…' : dirty ? 'Apply (radio will reboot)' : 'No changes'}
            </button>
            {dirty && <button className="ghost" onClick={revert} disabled={busy}>Revert</button>}
            {msg && (
              <span style={{
                fontSize: 12,
                color: msg.tone === 'good' ? 'var(--good)' : msg.tone === 'warn' ? 'var(--warn)' : 'var(--bad)',
                flex: '1 1 auto',
                minWidth: 200,
              }}>{msg.text}</span>
            )}
          </div>
        </div>
      </div>
      <div>
        {rightColumn}
        <div className="card">
          <h3>Current vs draft</h3>
          <table className="data" style={{ fontSize: 11.5 }}>
            <thead><tr><th>Field</th><th>Live</th><th>Draft</th></tr></thead>
            <tbody>
              {diffRows(live, draft).map((r) => (
                <DiffRow key={r.field} field={r.field} live={r.live} draft={r.draft} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
      <div>
        <div style={{ fontSize: 13 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function DiffRow({ field, live, draft }: { field: string; live: any; draft: any }) {
  const same = String(live) === String(draft);
  return (
    <tr>
      <td>{field}</td>
      <td style={{ fontFamily: 'var(--mono)' }}>{String(live)}</td>
      <td style={{ fontFamily: 'var(--mono)', color: same ? 'var(--text-faint)' : 'var(--warn)' }}>
        {same ? '—' : String(draft)}
      </td>
    </tr>
  );
}

function lookup<T extends { value: number; label: string }>(table: T[], v: number): string {
  return table.find((x) => x.value === v)?.label ?? String(v);
}

// ─────────────────────────────────────────────────────────────────────
// LoRa
// ─────────────────────────────────────────────────────────────────────

function LoRaEditor({ state, isReady }: { state: ConnectionState; isReady: boolean }) {
  const connId = useActiveConnId();
  const reject = () => Promise.reject(new Error('No active radio connection'));
  return (
    <EditorHarness<LoRaConfigEdit>
      live={state.loraConfig ? {
        usePreset: state.loraConfig.usePreset, modemPreset: state.loraConfig.modemPreset,
        bandwidth: state.loraConfig.bandwidth, spreadFactor: state.loraConfig.spreadFactor,
        codingRate: state.loraConfig.codingRate, region: state.loraConfig.region,
        hopLimit: state.loraConfig.hopLimit, txEnabled: state.loraConfig.txEnabled,
        txPower: state.loraConfig.txPower, channelNum: state.loraConfig.channelNum,
        overrideDutyCycle: state.loraConfig.overrideDutyCycle,
        sx126xRxBoostedGain: state.loraConfig.sx126xRxBoostedGain,
        overrideFrequency: state.loraConfig.overrideFrequency,
        ignoreMqtt: false,
      } : undefined}
      isReady={isReady}
      apply={(c) => connId ? window.mesh.setLoraConfig({ connId, config: c }) : reject()}
      title="LoRa radio"
      description={<>The two settings that <strong>must</strong> match between any two communicating radios are <strong>region</strong> (frequency band) and <strong>modem preset</strong> (SF/BW/CR combination). If your other device has different values, you will hear nothing.</>}
      rightColumn={<>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Will my other device communicate after I change this?</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>Only if it has the <em>exact same</em> region and modem preset.</p>
        </div>
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)' }}>
          <p style={{ margin: 0 }}><strong>Reboots on change:</strong> region, preset, custom SF/BW/CR, freq override, TX power.</p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Region defaults</strong></p>
          <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12.5, color: 'var(--text-dim)' }}>
            <li><strong>US</strong>: 902–928 MHz · 30 dBm max</li>
            <li><strong>EU_868</strong>: 869.4–869.65 MHz · 14 dBm · 10% duty</li>
            <li><strong>ANZ</strong>: 915–928 MHz · 30 dBm</li>
            <li><strong>JP</strong>: 920–927 MHz · 13 dBm</li>
          </ul>
        </div>
      </>}
      renderForm={(d, update) => (<>
        <Row label="Region" hint={REGIONS.find((r) => r.value === d.region)?.band}>
          <select className="text" value={d.region} onChange={(e) => update('region', Number(e.target.value))} disabled={!isReady}>
            {REGIONS.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.band}</option>)}
          </select>
        </Row>
        <Row label="Use modem preset" hint="off = custom SF/BW/CR below">
          <input type="checkbox" checked={d.usePreset} onChange={(e) => update('usePreset', e.target.checked)} disabled={!isReady} />
        </Row>
        {d.usePreset ? (
          <Row label="Modem preset" hint={PRESETS.find((p) => p.value === d.modemPreset)?.hint}>
            <select className="text" value={d.modemPreset} onChange={(e) => update('modemPreset', Number(e.target.value))} disabled={!isReady}>
              {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label} — {p.hint}</option>)}
            </select>
          </Row>
        ) : (
          <>
            <Row label="Spread factor" hint="7–12 · higher = longer range, slower">
              <input type="number" className="text" min={7} max={12} value={d.spreadFactor} onChange={(e) => update('spreadFactor', Number(e.target.value))} disabled={!isReady} />
            </Row>
            <Row label="Bandwidth (Hz)" hint="125000 / 250000 / 500000 · higher = faster, less range">
              <input type="number" className="text" value={d.bandwidth} onChange={(e) => update('bandwidth', Number(e.target.value))} disabled={!isReady} />
            </Row>
            <Row label="Coding rate" hint="5 (4/5) to 8 (4/8) · higher = more error correction overhead">
              <input type="number" className="text" min={5} max={8} value={d.codingRate} onChange={(e) => update('codingRate', Number(e.target.value))} disabled={!isReady} />
            </Row>
          </>
        )}
        <Row label="Channel number" hint="0 = derive from preset"><input type="number" className="text" min={0} max={104} value={d.channelNum} onChange={(e) => update('channelNum', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Hop limit" hint="how many times the network will forward your packet (default 3, max 7)"><input type="number" className="text" min={0} max={7} value={d.hopLimit} onChange={(e) => update('hopLimit', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="TX enabled" hint="off = receive-only · won't acknowledge or relay"><input type="checkbox" checked={d.txEnabled} onChange={(e) => update('txEnabled', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="TX power (dBm)" hint="0 = auto · region-capped"><input type="number" className="text" min={0} max={30} value={d.txPower} onChange={(e) => update('txPower', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Override duty cycle" hint="ignore regional duty-cycle limits (illegal in many regions)"><input type="checkbox" checked={d.overrideDutyCycle} onChange={(e) => update('overrideDutyCycle', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="Boosted RX gain" hint="+2–3 dB sensitivity on SX126x · slight battery cost"><input type="checkbox" checked={d.sx126xRxBoostedGain} onChange={(e) => update('sx126xRxBoostedGain', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="Override frequency (MHz)" hint="0 = use channel derivation"><input type="number" step="0.001" className="text" value={d.overrideFrequency} onChange={(e) => update('overrideFrequency', Number(e.target.value))} disabled={!isReady} /></Row>
      </>)}
      diffRows={(live, draft) => [
        { field: 'Region',       live: lookup(REGIONS, live.region), draft: lookup(REGIONS, draft.region) },
        { field: 'Preset',       live: lookup(PRESETS, live.modemPreset), draft: lookup(PRESETS, draft.modemPreset) },
        { field: 'Hop limit',    live: live.hopLimit, draft: draft.hopLimit },
        { field: 'TX power',     live: live.txPower, draft: draft.txPower },
        { field: 'TX enabled',   live: live.txEnabled, draft: draft.txEnabled },
        { field: 'Boost RX',     live: live.sx126xRxBoostedGain, draft: draft.sx126xRxBoostedGain },
        { field: 'Override freq', live: live.overrideFrequency, draft: draft.overrideFrequency },
      ]}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Device
// ─────────────────────────────────────────────────────────────────────

function DeviceEditor({ state, isReady }: { state: ConnectionState; isReady: boolean }) {
  const connId = useActiveConnId();
  const reject = () => Promise.reject(new Error('No active radio connection'));
  return (
    <EditorHarness<DeviceConfig>
      live={state.deviceConfig}
      isReady={isReady}
      apply={(c) => connId ? window.mesh.setDeviceConfig({ connId, config: c }) : reject()}
      title="Device"
      description={<>The radio's <strong>role</strong> determines how aggressively it participates in the mesh — routers prioritize forwarding, trackers prioritize battery, clients are the default.</>}
      rightColumn={
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Role matters.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>Setting your role to ROUTER tells the network you have good uptime/coverage and should be preferred for forwarding. Don't set this unless you actually have a permanently-powered, well-positioned node. Misuse degrades the mesh.</p>
        </div>
      }
      renderForm={(d, update) => (<>
        <Row label="Role" hint={DEVICE_ROLES.find((r) => r.value === d.role)?.hint}>
          <select className="text" value={d.role} onChange={(e) => update('role', Number(e.target.value))} disabled={!isReady}>
            {DEVICE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.hint}</option>)}
          </select>
        </Row>
        <Row label="Rebroadcast mode" hint={REBROADCAST_MODES.find((r) => r.value === d.rebroadcastMode)?.hint}>
          <select className="text" value={d.rebroadcastMode} onChange={(e) => update('rebroadcastMode', Number(e.target.value))} disabled={!isReady}>
            {REBROADCAST_MODES.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.hint}</option>)}
          </select>
        </Row>
        <Row label="NodeInfo broadcast (s)" hint="how often your radio re-announces its identity (default 10800 = 3 h)"><input type="number" className="text" value={d.nodeInfoBroadcastSecs} onChange={(e) => update('nodeInfoBroadcastSecs', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Serial enabled" hint="enable the user-accessible serial console (separate from API)"><input type="checkbox" checked={d.serialEnabled} onChange={(e) => update('serialEnabled', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="Button GPIO" hint="GPIO pin · 0 = use board default"><input type="number" className="text" value={d.buttonGpio} onChange={(e) => update('buttonGpio', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Buzzer GPIO" hint="GPIO pin · 0 = use board default / disabled"><input type="number" className="text" value={d.buzzerGpio} onChange={(e) => update('buzzerGpio', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Double-tap = button press" hint="treat IMU double-tap as a button press"><input type="checkbox" checked={d.doubleTapAsButtonPress} onChange={(e) => update('doubleTapAsButtonPress', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="LED heartbeat disabled" hint="suppress the LED blink that shows the firmware is alive"><input type="checkbox" checked={d.ledHeartbeatDisabled} onChange={(e) => update('ledHeartbeatDisabled', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="Timezone" hint="tzdef string · e.g. CST6CDT,M3.2.0,M11.1.0"><input className="text" value={d.tzdef} onChange={(e) => update('tzdef', e.target.value)} disabled={!isReady} /></Row>
      </>)}
      diffRows={(live, draft) => [
        { field: 'Role', live: lookup(DEVICE_ROLES, live.role), draft: lookup(DEVICE_ROLES, draft.role) },
        { field: 'Rebroadcast', live: lookup(REBROADCAST_MODES, live.rebroadcastMode), draft: lookup(REBROADCAST_MODES, draft.rebroadcastMode) },
        { field: 'NodeInfo (s)', live: live.nodeInfoBroadcastSecs, draft: draft.nodeInfoBroadcastSecs },
        { field: 'Serial', live: live.serialEnabled, draft: draft.serialEnabled },
        { field: 'LED off', live: live.ledHeartbeatDisabled, draft: draft.ledHeartbeatDisabled },
      ]}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Position
// ─────────────────────────────────────────────────────────────────────

function PositionEditor({ state, isReady }: { state: ConnectionState; isReady: boolean }) {
  const connId = useActiveConnId();
  const reject = () => Promise.reject(new Error('No active radio connection'));
  return (
    <EditorHarness<PositionConfig>
      live={state.positionConfig}
      isReady={isReady}
      apply={(c) => connId ? window.mesh.setPositionConfig({ connId, config: c }) : reject()}
      title="Position"
      description={<>How often your radio broadcasts its location, and how it gets that location. Smart broadcast suppresses updates when you haven't moved.</>}
      rightColumn={
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Privacy.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>Position broadcasts are public on the channel. Use <em>position-precision bits</em> via the official app's settings to blur your coordinates (e.g. 13 bits ≈ 5 km radius).</p>
        </div>
      }
      renderForm={(d, update) => (<>
        <Row label="Broadcast interval (s)" hint="how often we send our position · default 900 (15 min)"><input type="number" className="text" value={d.positionBroadcastSecs} onChange={(e) => update('positionBroadcastSecs', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Smart broadcast" hint="suppress position updates when you haven't moved enough"><input type="checkbox" checked={d.positionBroadcastSmartEnabled} onChange={(e) => update('positionBroadcastSmartEnabled', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="Smart min distance (m)" hint="don't transmit unless you've moved this far"><input type="number" className="text" value={d.broadcastSmartMinimumDistance} onChange={(e) => update('broadcastSmartMinimumDistance', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Smart min interval (s)" hint="cap on how often smart-broadcast can fire"><input type="number" className="text" value={d.broadcastSmartMinimumIntervalSecs} onChange={(e) => update('broadcastSmartMinimumIntervalSecs', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Fixed position" hint="use a hand-entered lat/lon instead of GPS"><input type="checkbox" checked={d.fixedPosition} onChange={(e) => update('fixedPosition', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="GPS mode" hint={GPS_MODES.find((m) => m.value === d.gpsMode)?.hint}>
          <select className="text" value={d.gpsMode} onChange={(e) => update('gpsMode', Number(e.target.value))} disabled={!isReady}>
            {GPS_MODES.map((m) => <option key={m.value} value={m.value}>{m.label} — {m.hint}</option>)}
          </select>
        </Row>
        <Row label="GPS update interval (s)" hint="how often the GPS chip takes a fix"><input type="number" className="text" value={d.gpsUpdateInterval} onChange={(e) => update('gpsUpdateInterval', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Position flags" hint="bitfield · advanced · 0 = defaults"><input type="number" className="text" value={d.positionFlags} onChange={(e) => update('positionFlags', Number(e.target.value))} disabled={!isReady} /></Row>
      </>)}
      diffRows={(live, draft) => [
        { field: 'Broadcast (s)', live: live.positionBroadcastSecs, draft: draft.positionBroadcastSecs },
        { field: 'Smart broadcast', live: live.positionBroadcastSmartEnabled, draft: draft.positionBroadcastSmartEnabled },
        { field: 'GPS mode', live: lookup(GPS_MODES, live.gpsMode), draft: lookup(GPS_MODES, draft.gpsMode) },
        { field: 'Fixed', live: live.fixedPosition, draft: draft.fixedPosition },
      ]}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Power
// ─────────────────────────────────────────────────────────────────────

function PowerEditor({ state, isReady }: { state: ConnectionState; isReady: boolean }) {
  const connId = useActiveConnId();
  const reject = () => Promise.reject(new Error('No active radio connection'));
  return (
    <EditorHarness<PowerConfig>
      live={state.powerConfig}
      isReady={isReady}
      apply={(c) => connId ? window.mesh.setPowerConfig({ connId, config: c }) : reject()}
      title="Power"
      description={<>Sleep timings determine how much battery you save versus how responsive the device feels. Super-deep-sleep (SDS) cuts almost everything; light-sleep (LS) keeps the radio on but pauses the CPU between events.</>}
      rightColumn={
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)' }}>
          <p style={{ margin: 0 }}><strong>Careful with SDS.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>If you enable super-deep-sleep on a device without a hardware wake source (button, motion sensor, RTC), you may not be able to wake it without a power-cycle.</p>
        </div>
      }
      renderForm={(d, update) => (<>
        <Row label="Power-saving mode" hint="enables aggressive sleep schedules"><input type="checkbox" checked={d.isPowerSaving} onChange={(e) => update('isPowerSaving', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="Shutdown on battery (s)" hint="auto-shutdown after this many seconds on battery · 0 = never"><input type="number" className="text" value={d.onBatteryShutdownAfterSecs} onChange={(e) => update('onBatteryShutdownAfterSecs', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="ADC multiplier override" hint="correct battery voltage measurement · 0 = use default"><input type="number" step="0.01" className="text" value={d.adcMultiplierOverride} onChange={(e) => update('adcMultiplierOverride', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="BT wait (s)" hint="how long to wait for BLE pair attempts before sleeping"><input type="number" className="text" value={d.waitBluetoothSecs} onChange={(e) => update('waitBluetoothSecs', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="SDS interval (s)" hint="super-deep-sleep interval · 0 = disabled"><input type="number" className="text" value={d.sdsSecs} onChange={(e) => update('sdsSecs', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="LS interval (s)" hint="light-sleep interval · default 300"><input type="number" className="text" value={d.lsSecs} onChange={(e) => update('lsSecs', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Min wake (s)" hint="min time awake after sleep · default 10"><input type="number" className="text" value={d.minWakeSecs} onChange={(e) => update('minWakeSecs', Number(e.target.value))} disabled={!isReady} /></Row>
      </>)}
      diffRows={(live, draft) => [
        { field: 'Power saving', live: live.isPowerSaving, draft: draft.isPowerSaving },
        { field: 'SDS (s)', live: live.sdsSecs, draft: draft.sdsSecs },
        { field: 'LS (s)', live: live.lsSecs, draft: draft.lsSecs },
        { field: 'Min wake (s)', live: live.minWakeSecs, draft: draft.minWakeSecs },
      ]}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Bluetooth
// ─────────────────────────────────────────────────────────────────────

function BluetoothEditor({ state, isReady }: { state: ConnectionState; isReady: boolean }) {
  const connId = useActiveConnId();
  const reject = () => Promise.reject(new Error('No active radio connection'));
  return (
    <EditorHarness<BluetoothConfig>
      live={state.bluetoothConfig}
      isReady={isReady}
      apply={(c) => connId ? window.mesh.setBluetoothConfig({ connId, config: c }) : reject()}
      title="Bluetooth"
      description={<>Pairing mode and PIN. Most users should leave this on RANDOM_PIN (shown on the device screen when pairing).</>}
      rightColumn={
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>This app talks USB.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>You don't need BLE for this app — but if you pair the radio with the official mobile app too, this is where its pairing security lives.</p>
        </div>
      }
      renderForm={(d, update) => (<>
        <Row label="Enabled" hint="off = no BLE advertised"><input type="checkbox" checked={d.enabled} onChange={(e) => update('enabled', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="Pairing mode" hint={BT_MODES.find((m) => m.value === d.mode)?.hint}>
          <select className="text" value={d.mode} onChange={(e) => update('mode', Number(e.target.value))} disabled={!isReady}>
            {BT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label} — {m.hint}</option>)}
          </select>
        </Row>
        <Row label="Fixed PIN" hint="6-digit · used only when mode = FIXED_PIN"><input type="number" className="text" value={d.fixedPin} onChange={(e) => update('fixedPin', Number(e.target.value))} disabled={!isReady} /></Row>
      </>)}
      diffRows={(live, draft) => [
        { field: 'Enabled', live: live.enabled, draft: draft.enabled },
        { field: 'Mode', live: lookup(BT_MODES, live.mode), draft: lookup(BT_MODES, draft.mode) },
        { field: 'Fixed PIN', live: live.fixedPin, draft: draft.fixedPin },
      ]}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Display
// ─────────────────────────────────────────────────────────────────────

function DisplayEditor({ state, isReady }: { state: ConnectionState; isReady: boolean }) {
  const connId = useActiveConnId();
  const reject = () => Promise.reject(new Error('No active radio connection'));
  return (
    <EditorHarness<DisplayConfig>
      live={state.displayConfig}
      isReady={isReady}
      apply={(c) => connId ? window.mesh.setDisplayConfig({ connId, config: c }) : reject()}
      title="Display"
      description={<>OLED screen behavior: how long it stays on, what gets shown, orientation, units.</>}
      rightColumn={
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Headless radios.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>If your board has no screen, these settings are harmless to leave at defaults. The firmware safely ignores them.</p>
        </div>
      }
      renderForm={(d, update) => (<>
        <Row label="Screen on (s)" hint="seconds before the screen turns off · 0 = always on"><input type="number" className="text" value={d.screenOnSecs} onChange={(e) => update('screenOnSecs', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Carousel (s)" hint="auto-advance between info pages · 0 = manual"><input type="number" className="text" value={d.autoScreenCarouselSecs} onChange={(e) => update('autoScreenCarouselSecs', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Compass north up" hint="orient the compass so north is up rather than your heading"><input type="checkbox" checked={d.compassNorthTop} onChange={(e) => update('compassNorthTop', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="Flip screen" hint="rotate the display 180°"><input type="checkbox" checked={d.flipScreen} onChange={(e) => update('flipScreen', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="Units" hint={DISPLAY_UNITS.find((u) => u.value === d.units)?.hint}>
          <select className="text" value={d.units} onChange={(e) => update('units', Number(e.target.value))} disabled={!isReady}>
            {DISPLAY_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label} — {u.hint}</option>)}
          </select>
        </Row>
        <Row label="OLED type" hint="0 = auto-detect · advanced override"><input type="number" className="text" value={d.oled} onChange={(e) => update('oled', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Display mode" hint="0 = default · 1 = 2-color · 2 = inverted · 3 = color"><input type="number" className="text" value={d.displaymode} onChange={(e) => update('displaymode', Number(e.target.value))} disabled={!isReady} /></Row>
        <Row label="Heading bold" hint="bold the heading on the compass page"><input type="checkbox" checked={d.headingBold} onChange={(e) => update('headingBold', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="Wake on motion/tap" hint="turn screen on when the IMU detects motion"><input type="checkbox" checked={d.wakeOnTapOrMotion} onChange={(e) => update('wakeOnTapOrMotion', e.target.checked)} disabled={!isReady} /></Row>
      </>)}
      diffRows={(live, draft) => [
        { field: 'Screen on (s)', live: live.screenOnSecs, draft: draft.screenOnSecs },
        { field: 'Carousel (s)', live: live.autoScreenCarouselSecs, draft: draft.autoScreenCarouselSecs },
        { field: 'Units', live: lookup(DISPLAY_UNITS, live.units), draft: lookup(DISPLAY_UNITS, draft.units) },
        { field: 'Flip screen', live: live.flipScreen, draft: draft.flipScreen },
      ]}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Network
// ─────────────────────────────────────────────────────────────────────

function NetworkEditor({ state, isReady }: { state: ConnectionState; isReady: boolean }) {
  const connId = useActiveConnId();
  const reject = () => Promise.reject(new Error('No active radio connection'));
  return (
    <EditorHarness<NetworkConfig>
      live={state.networkConfig}
      isReady={isReady}
      apply={(c) => connId ? window.mesh.setNetworkConfig({ connId, config: c }) : reject()}
      title="Network"
      description={<>WiFi and Ethernet (where supported by the board). Most users don't need this — but turning on WiFi lets the radio join MQTT and act as an internet ↔ mesh gateway.</>}
      rightColumn={<>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Not all boards have WiFi.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>nRF52 boards (RAK4631, etc.) have no WiFi. ESP32 boards (Heltec, Lilygo, RAK) do.</p>
        </div>
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)' }}>
          <p style={{ margin: 0 }}><strong>WiFi credentials.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>Sent in cleartext over USB. If you don't trust the host running this app, configure WiFi via the device's own setup flow.</p>
        </div>
      </>}
      renderForm={(d, update) => (<>
        <Row label="WiFi enabled"><input type="checkbox" checked={d.wifiEnabled} onChange={(e) => update('wifiEnabled', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="WiFi SSID"><input className="text" value={d.wifiSsid} onChange={(e) => update('wifiSsid', e.target.value)} disabled={!isReady} /></Row>
        <Row label="WiFi password"><input type="password" className="text" value={d.wifiPsk} onChange={(e) => update('wifiPsk', e.target.value)} disabled={!isReady} /></Row>
        <Row label="Ethernet enabled" hint="boards with onboard ethernet only"><input type="checkbox" checked={d.ethEnabled} onChange={(e) => update('ethEnabled', e.target.checked)} disabled={!isReady} /></Row>
        <Row label="Address mode" hint={NETWORK_ADDRESS_MODES.find((m) => m.value === d.addressMode)?.hint}>
          <select className="text" value={d.addressMode} onChange={(e) => update('addressMode', Number(e.target.value))} disabled={!isReady}>
            {NETWORK_ADDRESS_MODES.map((m) => <option key={m.value} value={m.value}>{m.label} — {m.hint}</option>)}
          </select>
        </Row>
        <Row label="NTP server" hint="e.g. pool.ntp.org · empty = firmware default"><input className="text" value={d.ntpServer} onChange={(e) => update('ntpServer', e.target.value)} disabled={!isReady} /></Row>
        <Row label="rsyslog server" hint="optional · remote logging target"><input className="text" value={d.rsyslogServer} onChange={(e) => update('rsyslogServer', e.target.value)} disabled={!isReady} /></Row>
      </>)}
      diffRows={(live, draft) => [
        { field: 'WiFi', live: live.wifiEnabled, draft: draft.wifiEnabled },
        { field: 'WiFi SSID', live: live.wifiSsid, draft: draft.wifiSsid },
        { field: 'WiFi PSK', live: live.wifiPsk ? '••••••' : '', draft: draft.wifiPsk ? '••••••' : '' },
        { field: 'Ethernet', live: live.ethEnabled, draft: draft.ethEnabled },
      ]}
    />
  );
}
