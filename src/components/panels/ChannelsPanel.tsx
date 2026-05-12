import React, { useEffect, useMemo, useState } from 'react';
import { useActiveConnId } from '../../hooks/MeshContext';

const MAX_CHANNELS = 8;
const ROLE_LABELS: Record<number, string> = { 0: 'Disabled', 1: 'Primary', 2: 'Secondary' };
const DEFAULT_KEY_BYTE = 0x01; // Meshtastic convention: 1-byte PSK == "default key"

interface Props {
  state: ConnectionState;
}

interface Draft {
  role: number;
  name: string;
  psk: number[];
  uplinkEnabled: boolean;
  downlinkEnabled: boolean;
}

function liveToDraft(c: MeshChannel | undefined): Draft {
  return {
    role: c?.role ?? 0,
    name: c?.name ?? '',
    psk: c?.psk ? [...c.psk] : [],
    uplinkEnabled: !!c?.uplinkEnabled,
    downlinkEnabled: !!c?.downlinkEnabled,
  };
}

function pskHex(psk: number[]): string {
  return psk.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseHex(s: string): number[] | null {
  const clean = s.replace(/\s|0x/gi, '').trim();
  if (clean.length % 2 !== 0) return null;
  if (!/^[0-9a-f]*$/i.test(clean)) return null;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    out.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

function pskDescription(psk: number[]): string {
  if (psk.length === 0) return 'open (no encryption)';
  if (psk.length === 1 && psk[0] === DEFAULT_KEY_BYTE) return 'default key';
  if (psk.length === 1) return `1-byte key index ${psk[0]}`;
  if (psk.length === 16) return 'AES-128 (custom key)';
  if (psk.length === 32) return 'AES-256 (custom key)';
  return `${psk.length}-byte key`;
}

function randomBytes(n: number): number[] {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return Array.from(arr);
}

function draftEquals(a: Draft, b: Draft): boolean {
  if (a.role !== b.role) return false;
  if (a.name !== b.name) return false;
  if (a.uplinkEnabled !== b.uplinkEnabled) return false;
  if (a.downlinkEnabled !== b.downlinkEnabled) return false;
  if (a.psk.length !== b.psk.length) return false;
  for (let i = 0; i < a.psk.length; i++) if (a.psk[i] !== b.psk[i]) return false;
  return true;
}

export function ChannelsPanel({ state }: Props) {
  const connId = useActiveConnId();
  const channels = state.channels ?? [];
  const isReady = state.status === 'ready';

  const [selected, setSelected] = useState<number>(0);
  const live = channels.find((c) => c.index === selected);
  const [draft, setDraft] = useState<Draft>(liveToDraft(live));
  const [showPsk, setShowPsk] = useState(false);
  const [pskInput, setPskInput] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Share URL state
  const [shareUrl, setShareUrl] = useState<string>('');
  const [importUrl, setImportUrl] = useState<string>('');
  const [importBusy, setImportBusy] = useState(false);

  // Re-sync draft when the selected channel's live data changes (or selection changes)
  useEffect(() => {
    setDraft(liveToDraft(live));
    setPskInput(live?.psk ? pskHex(live.psk) : '');
    setShowPsk(false);
    setMsg(''); setErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, live?.role, live?.name, live?.uplinkEnabled, live?.downlinkEnabled, live?.pskLength, live?.psk?.join(',')]);

  const dirty = !draftEquals(draft, liveToDraft(live));

  const upd = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const applyPskMode = (mode: 'open' | 'default' | 'aes128' | 'aes256' | 'custom-input') => {
    if (mode === 'open') { upd('psk', []); setPskInput(''); }
    else if (mode === 'default') { upd('psk', [DEFAULT_KEY_BYTE]); setPskInput(pskHex([DEFAULT_KEY_BYTE])); }
    else if (mode === 'aes128') { const r = randomBytes(16); upd('psk', r); setPskInput(pskHex(r)); setShowPsk(true); }
    else if (mode === 'aes256') { const r = randomBytes(32); upd('psk', r); setPskInput(pskHex(r)); setShowPsk(true); }
  };

  const onPskInputChange = (s: string) => {
    setPskInput(s);
    const parsed = parseHex(s);
    if (parsed !== null) upd('psk', parsed);
  };

  const apply = async () => {
    if (!connId) return;
    setBusy(true); setMsg(''); setErr('');
    try {
      await window.mesh.setChannel({
        connId,
        channel: {
          index: selected,
          role: draft.role,
          name: draft.name,
          psk: draft.psk,
          uplinkEnabled: draft.uplinkEnabled,
          downlinkEnabled: draft.downlinkEnabled,
        },
      });
      setMsg(`Channel ${selected} sent. Radio applies channel edits immediately — no reboot needed.`);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const revert = () => {
    setDraft(liveToDraft(live));
    setPskInput(live?.psk ? pskHex(live.psk) : '');
  };

  const addNew = () => {
    // Find first slot with role=0 (DISABLED) to claim as a new SECONDARY.
    const used = new Set(channels.filter((c) => c.role !== 0).map((c) => c.index));
    let next = -1;
    for (let i = 1; i < MAX_CHANNELS; i++) {
      if (!used.has(i)) { next = i; break; }
    }
    if (next === -1) {
      setErr('All 8 channel slots are in use.');
      return;
    }
    setSelected(next);
    setDraft({ role: 2, name: 'new', psk: [DEFAULT_KEY_BYTE], uplinkEnabled: false, downlinkEnabled: false });
    setPskInput(pskHex([DEFAULT_KEY_BYTE]));
  };

  const disable = async () => {
    if (!connId || !window.confirm(`Disable channel ${selected}? Members of this channel will no longer be reachable from this radio.`)) return;
    setBusy(true); setErr('');
    try {
      await window.mesh.setChannel({ connId, channel: { index: selected, role: 0, name: '', psk: [], uplinkEnabled: false, downlinkEnabled: false } });
      setMsg(`Channel ${selected} disabled.`);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const generateShareUrl = async () => {
    if (!connId) return;
    const url = await window.mesh.getChannelSetUrl(connId);
    if (url) setShareUrl(url); else setErr('Could not generate URL — LoRa config not yet received from the radio.');
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); setMsg('Copied share URL to clipboard.'); }
    catch { /* ignore */ }
  };

  const applyImport = async () => {
    if (!connId || !importUrl.trim()) return;
    if (!window.confirm('Importing this URL will overwrite ALL of this radio\'s channels and LoRa config. Continue?')) return;
    setImportBusy(true); setErr(''); setMsg('');
    try {
      const ok = await window.mesh.applyChannelSetUrl({ connId, url: importUrl.trim() });
      if (ok) { setMsg('Import sent. The radio will reboot if LoRa config changed.'); setImportUrl(''); }
      else setErr('Could not parse that URL — make sure it\'s a meshtastic.org/e/# share link.');
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setImportBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <h1 className="page-title">Channels</h1>
      <p className="page-sub">
        Up to 8 channels per radio. <strong>Primary</strong> (slot 0) is the default mesh — its name + PSK derive your network identity, so two radios on the same mesh MUST share both. Secondary channels are optional sub-meshes for private groups.
      </p>

      {!isReady && (
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)' }}>
          <p style={{ margin: 0, fontSize: 12.5 }}>The radio must be connected and ready to view or edit channels.</p>
        </div>
      )}

      <div className="ch-layout">
        {/* Slot list */}
        <div className="card ch-slots">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Slots</h3>
            <button className="ghost" style={{ padding: '3px 10px', fontSize: 11 }} onClick={addNew} disabled={!isReady}>+ Add</button>
          </div>
          {Array.from({ length: MAX_CHANNELS }).map((_, i) => {
            const c = channels.find((x) => x.index === i);
            const isActive = i === selected;
            const role = c?.role ?? 0;
            const enabled = role !== 0;
            const cls = isActive ? 'ch-slot active' : 'ch-slot';
            return (
              <button
                key={i}
                className={cls + (enabled ? '' : ' disabled')}
                onClick={() => setSelected(i)}
              >
                <div className="ch-slot-row">
                  <span className="ch-slot-idx">{i}</span>
                  <span className="ch-slot-name">{enabled ? (c?.name || '(default)') : '— empty slot —'}</span>
                  {enabled && role === 1 && <span className="ch-pill ch-pill-primary">PRIMARY</span>}
                  {enabled && role === 2 && <span className="ch-pill ch-pill-secondary">secondary</span>}
                </div>
                {enabled && (
                  <div className="ch-slot-sub">
                    {pskDescription(c?.psk ?? [])}
                    {c?.uplinkEnabled && <span className="src-chip src-mqtt" style={{ marginLeft: 6 }}>UP</span>}
                    {c?.downlinkEnabled && <span className="src-chip src-mqtt" style={{ marginLeft: 4 }}>DOWN</span>}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Editor */}
        <div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Slot {selected}{live ? ` · ${live.roleName}` : ''}</h3>
              {dirty && <span style={{ color: 'var(--warn)', fontSize: 12 }}>unsaved changes</span>}
            </div>

            <div className="kv-form" style={{ marginTop: 10 }}>
              <div className="kv-row">
                <div className="kv-label">
                  <div>Role</div>
                  <div className="kv-hint">Slot 0 must be PRIMARY (it's your default mesh). Other slots can be Secondary or Disabled.</div>
                </div>
                <select
                  className="text"
                  value={draft.role}
                  onChange={(e) => upd('role', Number(e.target.value))}
                  disabled={!isReady || selected === 0}
                  style={{ minWidth: 140 }}
                  title={selected === 0 ? 'Slot 0 is always PRIMARY' : undefined}
                >
                  {selected === 0
                    ? <option value={1}>{ROLE_LABELS[1]}</option>
                    : <>
                        <option value={2}>{ROLE_LABELS[2]}</option>
                        <option value={0}>{ROLE_LABELS[0]} (delete)</option>
                      </>}
                </select>
              </div>

              <div className="kv-row">
                <div className="kv-label">
                  <div>Name</div>
                  <div className="kv-hint">Used (together with PSK) to derive the network ID. Two radios with different names on slot 0 are on different meshes.</div>
                </div>
                <input
                  className="text"
                  value={draft.name}
                  maxLength={11}
                  onChange={(e) => upd('name', e.target.value)}
                  disabled={!isReady || draft.role === 0}
                  placeholder={selected === 0 ? '(default)' : 'e.g. friends'}
                  style={{ minWidth: 220 }}
                />
              </div>

              <div className="kv-row">
                <div className="kv-label">
                  <div>Encryption</div>
                  <div className="kv-hint">Current: {pskDescription(draft.psk)}. Pick a preset or paste your own hex below.</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button className="ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => applyPskMode('open')} disabled={!isReady || draft.role === 0}>Open</button>
                  <button className="ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => applyPskMode('default')} disabled={!isReady || draft.role === 0}>Default key</button>
                  <button className="ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => applyPskMode('aes128')} disabled={!isReady || draft.role === 0}>New AES-128</button>
                  <button className="ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => applyPskMode('aes256')} disabled={!isReady || draft.role === 0}>New AES-256</button>
                </div>
              </div>

              {draft.psk.length > 0 && (
                <div className="kv-row">
                  <div className="kv-label">
                    <div>PSK (hex)</div>
                    <div className="kv-hint">Hidden by default. Anyone with this key can decrypt traffic on this channel.</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
                    <input
                      className="text"
                      type={showPsk ? 'text' : 'password'}
                      value={pskInput}
                      onChange={(e) => onPskInputChange(e.target.value)}
                      disabled={!isReady || draft.role === 0}
                      style={{ flex: 1, minWidth: 260, fontFamily: 'var(--mono)', fontSize: 11.5 }}
                      placeholder="paste/type hex bytes…"
                    />
                    <button className="ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setShowPsk((v) => !v)}>{showPsk ? 'Hide' : 'Show'}</button>
                    <button
                      className="ghost"
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      onClick={async () => { try { await navigator.clipboard.writeText(pskInput); setMsg('Copied PSK hex.'); } catch {} }}
                      title="Copy PSK to clipboard"
                    >Copy</button>
                  </div>
                </div>
              )}

              <div className="kv-row">
                <div className="kv-label">
                  <div>MQTT uplink</div>
                  <div className="kv-hint">Publish packets from this channel to MQTT.</div>
                </div>
                <input type="checkbox" checked={draft.uplinkEnabled} onChange={(e) => upd('uplinkEnabled', e.target.checked)} disabled={!isReady || draft.role === 0} />
              </div>
              <div className="kv-row">
                <div className="kv-label">
                  <div>MQTT downlink</div>
                  <div className="kv-hint">Re-transmit MQTT-sourced packets onto the airwaves on this channel.</div>
                </div>
                <input type="checkbox" checked={draft.downlinkEnabled} onChange={(e) => upd('downlinkEnabled', e.target.checked)} disabled={!isReady || draft.role === 0} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="primary" disabled={!isReady || !dirty || busy} onClick={apply}>
                {busy ? 'Sending…' : 'Apply to radio'}
              </button>
              <button className="ghost" disabled={!dirty || busy} onClick={revert}>Revert</button>
              {selected !== 0 && live && live.role !== 0 && (
                <button className="ghost" style={{ marginLeft: 'auto', color: 'var(--bad)' }} onClick={disable} disabled={!isReady || busy}>
                  Disable channel
                </button>
              )}
            </div>
            {msg && <div style={{ color: 'var(--good)', marginTop: 10, fontSize: 12 }}>{msg}</div>}
            {err && <div style={{ color: 'var(--bad)', marginTop: 10, fontSize: 12, fontFamily: 'var(--mono)' }}>{err}</div>}
          </div>

          {/* Share / import */}
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Share or import</h3>
            <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12 }}>
              Meshtastic distributes channel sets as a URL: <code>https://meshtastic.org/e/#…</code>. The link encodes every enabled channel
              <em> and</em> your LoRa config (region, preset, frequency), so a single paste configures a brand-new radio for your mesh.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>Share this radio's channel set</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={generateShareUrl} disabled={!isReady}>Generate URL</button>
                  {shareUrl && <button className="ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={copyShareUrl}>Copy</button>}
                </div>
                {shareUrl && (
                  <textarea
                    className="text"
                    readOnly
                    value={shareUrl}
                    style={{ width: '100%', marginTop: 8, fontFamily: 'var(--mono)', fontSize: 11, padding: 6, height: 70 }}
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  />
                )}
              </div>

              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>Import from URL</div>
                <textarea
                  className="text"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="https://meshtastic.org/e/#…"
                  style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 11, padding: 6, height: 70 }}
                />
                <button
                  className="primary"
                  style={{ marginTop: 8, padding: '4px 12px', fontSize: 12 }}
                  onClick={applyImport}
                  disabled={!isReady || !importUrl.trim() || importBusy}
                >
                  {importBusy ? 'Importing…' : 'Apply to radio'}
                </button>
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>
                  This overwrites the radio's primary + all secondary channels and applies the URL's LoRa config. The radio will reboot if the LoRa portion changed.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
