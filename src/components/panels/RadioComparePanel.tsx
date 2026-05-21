import React, { useEffect, useMemo, useState } from 'react';
import { useMeshContext } from '../../hooks/MeshContext';
import type { ConnectionView } from '../../hooks/useMesh';
import { ROLE_NAMES } from '../../lib/device-roles';

function hex8(n: number): string {
  return '!' + (n >>> 0).toString(16).padStart(8, '0');
}

function pskLabel(len: number): string {
  if (len === 0) return 'open (no PSK)';
  if (len === 1) return 'default key';
  if (len === 16) return 'AES-128';
  if (len === 32) return 'AES-256';
  return `${len}-byte custom`;
}

function presetDescription(c?: ConnectionView['state']['loraConfig']): string {
  if (!c) return '—';
  if (c.usePreset) return c.modemPresetName;
  return `SF${c.spreadFactor}/${(c.bandwidth / 1000).toFixed(0)} kHz/4-${c.codingRate}`;
}

function shortName(v: ConnectionView): string {
  const my = v.state.myInfo?.myNodeNum;
  if (!my) return v.portPath ?? v.connId;
  const node = v.nodes.find((n) => n.num === my);
  return node?.shortName || node?.longName || hex8(my);
}

interface DiagFinding {
  severity: 'block' | 'warn' | 'info' | 'ok';
  title: string;
  detail: string;
}

/** Inspect two connection views and return prioritized findings about why they might (not) talk. */
function diagnose(a: ConnectionView, b: ConnectionView): DiagFinding[] {
  const out: DiagFinding[] = [];
  const la = a.state.loraConfig;
  const lb = b.state.loraConfig;

  if (!la || !lb) {
    out.push({
      severity: 'warn',
      title: 'LoRa config not loaded',
      detail: 'Wait for both radios to finish syncing, then refresh.',
    });
    return out;
  }

  // 1. Region — completely fatal if mismatched.
  if (la.region !== lb.region) {
    out.push({
      severity: 'block',
      title: 'Region mismatch — radios use different frequency bands',
      detail: `${shortName(a)} is on ${la.regionName} (band ${la.region}); ${shortName(b)} is on ${lb.regionName} (band ${lb.region}). They are physically tuned to different frequencies and cannot hear each other. Set both to the same region in Settings.`,
    });
  }

  // 2. Modem preset / SF / BW — fatal if mismatched.
  if (la.usePreset !== lb.usePreset) {
    out.push({
      severity: 'block',
      title: 'Preset vs custom mismatch',
      detail: `${shortName(a)} uses ${la.usePreset ? 'a preset' : 'custom SF/BW'}; ${shortName(b)} uses ${lb.usePreset ? 'a preset' : 'custom SF/BW'}. Even if numbers look similar, the radios won't sync — set both the same way.`,
    });
  } else if (la.usePreset && la.modemPreset !== lb.modemPreset) {
    out.push({
      severity: 'block',
      title: 'Modem preset mismatch',
      detail: `${shortName(a)} = ${la.modemPresetName}, ${shortName(b)} = ${lb.modemPresetName}. The chirp parameters (SF/BW/CR) are different, so the demodulator on each radio cannot decode the other's packets.`,
    });
  } else if (!la.usePreset && (la.spreadFactor !== lb.spreadFactor || la.bandwidth !== lb.bandwidth || la.codingRate !== lb.codingRate)) {
    out.push({
      severity: 'block',
      title: 'SF/BW/CR mismatch',
      detail: `${shortName(a)} = SF${la.spreadFactor}/${la.bandwidth / 1000}kHz/4-${la.codingRate}; ${shortName(b)} = SF${lb.spreadFactor}/${lb.bandwidth / 1000}kHz/4-${lb.codingRate}. All three must match exactly.`,
    });
  }

  // 3. Channel number within region — different sub-frequency.
  if (la.channelNum !== lb.channelNum) {
    out.push({
      severity: 'block',
      title: 'Channel number mismatch',
      detail: `${shortName(a)} is on channel ${la.channelNum}; ${shortName(b)} is on channel ${lb.channelNum}. The "channel" here is the sub-frequency offset within the region's band — different channels mean different MHz tunings.`,
    });
  }

  // 4. Frequency override.
  if (la.overrideFrequency !== lb.overrideFrequency) {
    out.push({
      severity: 'block',
      title: 'Frequency override mismatch',
      detail: `${shortName(a)} override = ${la.overrideFrequency || 'none'}; ${shortName(b)} override = ${lb.overrideFrequency || 'none'}. An override takes precedence over the regional channel calculation — both must match (or both be zero).`,
    });
  }

  // 5. Primary channel name + PSK length (proxy for matching keys).
  const pa = a.state.channels?.find((c) => c.index === 0);
  const pb = b.state.channels?.find((c) => c.index === 0);
  if (pa && pb) {
    const nameA = pa.name || '(default)';
    const nameB = pb.name || '(default)';
    if (nameA !== nameB) {
      out.push({
        severity: 'block',
        title: 'Primary channel name mismatch',
        detail: `Primary channel: ${shortName(a)}="${nameA}" vs ${shortName(b)}="${nameB}". Meshtastic uses channel name + PSK to derive the network ID. Even if both are open, different names = different mesh.`,
      });
    }
    if (pa.pskLength !== pb.pskLength) {
      out.push({
        severity: 'block',
        title: 'Primary channel encryption mismatch (different key length)',
        detail: `${shortName(a)} uses ${pskLabel(pa.pskLength)}; ${shortName(b)} uses ${pskLabel(pb.pskLength)}. Even with matching names, the encryption key must match — encrypted packets from one decrypt as garbage on the other.`,
      });
    } else if (pa.psk && pb.psk && pa.psk.length === pb.psk.length && pa.psk.length > 0) {
      // Same length: now check actual bytes. Two AES-128 keys can both be "16 bytes"
      // but be totally different; that's the silent-failure case that survives every
      // other check and looks healthy in Mesh Health / Compare Radios.
      const bytesMatch = pa.psk.every((byte, i) => byte === pb.psk[i]);
      if (!bytesMatch) {
        out.push({
          severity: 'block',
          title: 'Primary channel PSK bytes differ',
          detail: `Both radios report ${pskLabel(pa.psk.length)}, but the actual key bytes are different. They share the channel name but their packets will look like random noise to each other. Use the Channels panel to copy A's PSK to B (or import a share URL).`,
        });
      }
    }
  }

  // 6. TX disabled on either side.
  if (!la.txEnabled) {
    out.push({
      severity: 'block',
      title: `${shortName(a)} has TX disabled`,
      detail: `This radio can listen but cannot transmit. Re-enable TX in Settings → LoRa.`,
    });
  }
  if (!lb.txEnabled) {
    out.push({
      severity: 'block',
      title: `${shortName(b)} has TX disabled`,
      detail: `This radio can listen but cannot transmit. Re-enable TX in Settings → LoRa.`,
    });
  }

  // 7. TX power floor warning (sub-10 dBm at short range is fine, but worth noting).
  if (la.txPower && la.txPower < 5) {
    out.push({
      severity: 'warn',
      title: `${shortName(a)} TX power is very low (${la.txPower} dBm)`,
      detail: `Below 5 dBm the link gets fragile even at short range. Try 17–22 dBm for indoor testing.`,
    });
  }
  if (lb.txPower && lb.txPower < 5) {
    out.push({
      severity: 'warn',
      title: `${shortName(b)} TX power is very low (${lb.txPower} dBm)`,
      detail: `Below 5 dBm the link gets fragile even at short range. Try 17–22 dBm for indoor testing.`,
    });
  }

  // 8. Hop limit too low for ack to make a round trip.
  if (la.hopLimit < 1) {
    out.push({ severity: 'warn', title: `${shortName(a)} hop limit is 0`, detail: 'Packets can only go directly; no relays will rebroadcast.' });
  }
  if (lb.hopLimit < 1) {
    out.push({ severity: 'warn', title: `${shortName(b)} hop limit is 0`, detail: 'Packets can only go directly; no relays will rebroadcast.' });
  }

  // 9. NodeDB visibility — does A see B and vice versa?
  const aMy = a.state.myInfo?.myNodeNum;
  const bMy = b.state.myInfo?.myNodeNum;
  if (aMy && bMy) {
    const aSeesB = a.nodes.find((n) => n.num === bMy);
    const bSeesA = b.nodes.find((n) => n.num === aMy);
    if (!aSeesB && !bSeesA) {
      out.push({
        severity: out.some((f) => f.severity === 'block') ? 'info' : 'warn',
        title: 'Neither radio sees the other in its nodeDB',
        detail: 'Once the config issues above are fixed, NodeInfo packets are sent ~every 3 hours by default. To force one immediately, restart either radio.',
      });
    } else if (aSeesB && !bSeesA) {
      out.push({
        severity: 'info',
        title: `${shortName(a)} sees ${shortName(b)}, but not the other way around`,
        detail: `One-way visibility usually means ${shortName(b)}'s NodeInfo packet reached ${shortName(a)} once, but the reverse direction hasn't transmitted yet (or got lost). Try sending a chat message from ${shortName(b)} to force a transmission.`,
      });
    } else if (!aSeesB && bSeesA) {
      out.push({
        severity: 'info',
        title: `${shortName(b)} sees ${shortName(a)}, but not the other way around`,
        detail: `One-way visibility usually means ${shortName(a)}'s NodeInfo packet reached ${shortName(b)} once, but the reverse direction hasn't transmitted yet (or got lost). Try sending a chat message from ${shortName(a)} to force a transmission.`,
      });
    } else if (aSeesB && bSeesA) {
      const directA = (aSeesB.hopsAway ?? 0) === 0;
      const directB = (bSeesA.hopsAway ?? 0) === 0;
      out.push({
        severity: 'ok',
        title: directA && directB ? 'Both radios see each other directly (0 hops)' : 'Both radios see each other, but via relays',
        detail: directA && directB
          ? 'They are talking. If you still see message failures, look at Delivery panel for specific Routing.Error codes.'
          : `${shortName(a)} sees ${shortName(b)} at ${aSeesB.hopsAway ?? '?'} hops; ${shortName(b)} sees ${shortName(a)} at ${bSeesA.hopsAway ?? '?'} hops. They depend on intermediate nodes.`,
      });
    }
  }

  // 10. Ignore-mqtt flag — if one has it off, MQTT-bridged nodes could pollute.
  // (We don't currently expose this field; skipping.)

  // If nothing fired, all the major bases are covered.
  if (out.length === 0) {
    out.push({
      severity: 'ok',
      title: 'No config mismatches detected',
      detail: 'Region, preset, channel number, frequency override, primary channel name/PSK, and TX settings all match. If they still don\'t talk, the issue is likely RF environment (range, antenna, obstruction) — try the Coverage and Signal panels.',
    });
  }

  return out;
}

interface RowDef {
  label: string;
  hint?: string;
  // Render a value for a connection. Return '—' when missing.
  get: (v: ConnectionView) => React.ReactNode;
  // Equality test for highlighting. Defaults to strict comparison of `get`'s string form.
  eq?: (a: ConnectionView, b: ConnectionView) => boolean;
}

interface SectionDef {
  title: string;
  rows: RowDef[];
}

function buildSections(): SectionDef[] {
  return [
    {
      title: 'Identity',
      rows: [
        { label: 'Short name',  get: (v) => {
            const my = v.state.myInfo?.myNodeNum;
            const node = my ? v.nodes.find((n) => n.num === my) : undefined;
            return node?.shortName || '—';
          },
          eq: (a, b) => {
            const sa = a.state.myInfo?.myNodeNum; const sb = b.state.myInfo?.myNodeNum;
            const na = sa ? a.nodes.find((n) => n.num === sa)?.shortName : undefined;
            const nb = sb ? b.nodes.find((n) => n.num === sb)?.shortName : undefined;
            return na !== nb; // always "different" between two radios — never highlight as bad
          },
        },
        { label: 'Long name',  get: (v) => {
            const my = v.state.myInfo?.myNodeNum;
            const node = my ? v.nodes.find((n) => n.num === my) : undefined;
            return node?.longName || '—';
          },
          eq: () => true, // never highlight
        },
        { label: 'Node #',  get: (v) => v.state.myInfo?.myNodeNum ? hex8(v.state.myInfo.myNodeNum) : '—', eq: () => true },
        { label: 'Hardware',  get: (v) => {
            const my = v.state.myInfo?.myNodeNum;
            return (my ? v.nodes.find((n) => n.num === my)?.hwModelName : undefined) || '—';
          },
          eq: () => true,
        },
        { label: 'Firmware',  get: (v) => v.state.myInfo?.firmwareVersion || '—', eq: (a, b) => (a.state.myInfo?.firmwareVersion ?? '') === (b.state.myInfo?.firmwareVersion ?? '') },
        { label: 'Role',  get: (v) => v.state.deviceConfig ? (ROLE_NAMES[v.state.deviceConfig.role] ?? String(v.state.deviceConfig.role)) : '—',
          eq: (a, b) => (a.state.deviceConfig?.role ?? -1) === (b.state.deviceConfig?.role ?? -1) },
      ],
    },
    {
      title: 'LoRa configuration',
      rows: [
        { label: 'Region', hint: 'Must match — different regions = different RF bands.',
          get: (v) => v.state.loraConfig?.regionName ?? '—',
          eq: (a, b) => (a.state.loraConfig?.region ?? -1) === (b.state.loraConfig?.region ?? -1) },
        { label: 'Preset / SF/BW', hint: 'Must match exactly. Different chirp params won\'t demodulate.',
          get: (v) => presetDescription(v.state.loraConfig),
          eq: (a, b) => {
            const la = a.state.loraConfig; const lb = b.state.loraConfig;
            if (!la || !lb) return false;
            if (la.usePreset !== lb.usePreset) return false;
            if (la.usePreset) return la.modemPreset === lb.modemPreset;
            return la.spreadFactor === lb.spreadFactor && la.bandwidth === lb.bandwidth && la.codingRate === lb.codingRate;
          } },
        { label: 'Channel #', hint: 'Sub-band offset within the region. Must match.',
          get: (v) => v.state.loraConfig ? String(v.state.loraConfig.channelNum) : '—',
          eq: (a, b) => (a.state.loraConfig?.channelNum ?? -1) === (b.state.loraConfig?.channelNum ?? -1) },
        { label: 'Frequency override', hint: 'If set, takes precedence over channel #. Must match (or both be zero).',
          get: (v) => v.state.loraConfig?.overrideFrequency ? `${v.state.loraConfig.overrideFrequency.toFixed(3)} MHz` : '—',
          eq: (a, b) => (a.state.loraConfig?.overrideFrequency ?? 0) === (b.state.loraConfig?.overrideFrequency ?? 0) },
        { label: 'TX enabled', hint: 'Both must be on, otherwise one radio can only receive.',
          get: (v) => v.state.loraConfig ? (v.state.loraConfig.txEnabled ? 'yes' : 'no') : '—',
          eq: (a, b) => (a.state.loraConfig?.txEnabled ?? false) === (b.state.loraConfig?.txEnabled ?? false) },
        { label: 'TX power', hint: 'Doesn\'t need to match — but very low power can break links.',
          get: (v) => v.state.loraConfig?.txPower ? `${v.state.loraConfig.txPower} dBm` : 'auto',
          eq: () => true, // never highlight as wrong
        },
        { label: 'Hop limit',  get: (v) => v.state.loraConfig ? String(v.state.loraConfig.hopLimit) : '—', eq: () => true },
        { label: 'Boost RX',  get: (v) => v.state.loraConfig ? (v.state.loraConfig.sx126xRxBoostedGain ? 'on' : 'off') : '—', eq: () => true },
        { label: 'Override duty cycle',  get: (v) => v.state.loraConfig ? (v.state.loraConfig.overrideDutyCycle ? 'yes' : 'no') : '—', eq: () => true },
      ],
    },
    {
      title: 'Primary channel (slot 0)',
      rows: [
        { label: 'Name', hint: 'Channel name + PSK derive the network ID. Names must match.',
          get: (v) => v.state.channels?.find((c) => c.index === 0)?.name || '(default)',
          eq: (a, b) => {
            const na = a.state.channels?.find((c) => c.index === 0)?.name || '';
            const nb = b.state.channels?.find((c) => c.index === 0)?.name || '';
            return na === nb;
          } },
        { label: 'Encryption', hint: 'Both must use the same key for packets to decrypt. We compare the actual bytes, not just the length.',
          get: (v) => {
            const ch = v.state.channels?.find((c) => c.index === 0);
            if (!ch) return '—';
            // Include a short fingerprint of the actual PSK bytes so two
            // identically-labelled keys are visually distinguishable.
            const fp = ch.psk && ch.psk.length >= 4
              ? ' · ' + ch.psk.slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('')
              + '…' + ch.psk.slice(-2).map((b) => b.toString(16).padStart(2, '0')).join('')
              : '';
            return pskLabel(ch.pskLength) + fp;
          },
          eq: (a, b) => {
            const pa = a.state.channels?.find((c) => c.index === 0);
            const pb = b.state.channels?.find((c) => c.index === 0);
            if (!pa || !pb) return false;
            if (pa.pskLength !== pb.pskLength) return false;
            if (!pa.psk || !pb.psk) return false;
            if (pa.psk.length !== pb.psk.length) return false;
            return pa.psk.every((byte, i) => byte === pb.psk[i]);
          } },
        { label: 'Uplink/downlink',  get: (v) => {
            const ch = v.state.channels?.find((c) => c.index === 0);
            if (!ch) return '—';
            return `${ch.uplinkEnabled ? 'up' : '—'} / ${ch.downlinkEnabled ? 'down' : '—'}`;
          },
          eq: () => true },
      ],
    },
  ];
}

export function RadioComparePanel() {
  const { connections } = useMeshContext();
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);

  // Initialize to first two connections when possible.
  useEffect(() => {
    if (aId === null && connections[0]) setAId(connections[0].connId);
    if (bId === null && connections[1] && connections[1].connId !== aId) setBId(connections[1].connId);
  }, [connections, aId, bId]);

  // Drop stale ids if a connection was removed.
  useEffect(() => {
    if (aId && !connections.some((c) => c.connId === aId)) setAId(null);
    if (bId && !connections.some((c) => c.connId === bId)) setBId(null);
  }, [connections, aId, bId]);

  const a = aId ? connections.find((c) => c.connId === aId) : null;
  const b = bId ? connections.find((c) => c.connId === bId) : null;
  const findings = useMemo(() => (a && b ? diagnose(a, b) : []), [a, b]);
  const sections = useMemo(() => buildSections(), []);

  if (connections.length < 2) {
    return (
      <div className="page">
        <h1 className="page-title">Compare Radios</h1>
        <p className="page-sub">
          Side-by-side diagnostic for two radios that should be on the same mesh. Connect a second USB radio on the Connect page to use this view.
        </p>
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)' }}>
          <p style={{ margin: 0 }}>
            <strong>You only have {connections.length} radio connected.</strong> Plug in a second device (different USB port) and open it via <em>Connect → + Add another radio</em>. When two radios are connected they'll show up in the selectors here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Compare Radios</h1>
      <p className="page-sub">
        Find out why two radios aren't talking. Pick a pair below; the diagnosis card surfaces the most likely culprits (region, preset, channel, encryption, TX) and the detail tables highlight the exact rows that differ.
      </p>

      {/* Selectors */}
      <div className="rc-selectors">
        <RadioPicker label="Radio A" value={aId} onChange={setAId} connections={connections} excludeId={bId} accent="a" />
        <div className="rc-vs">vs</div>
        <RadioPicker label="Radio B" value={bId} onChange={setBId} connections={connections} excludeId={aId} accent="b" />
      </div>

      {!a || !b ? (
        <div className="info-card">
          <p style={{ margin: 0 }}>Pick two different radios to compare.</p>
        </div>
      ) : (
        <>
          {/* Diagnosis */}
          <div className="rc-diagnosis">
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>Diagnosis</h2>
            <div className="rc-findings">
              {findings.map((f, i) => (
                <Finding key={i} f={f} />
              ))}
            </div>
          </div>

          {/* Detail tables */}
          {sections.map((s) => (
            <DetailTable key={s.title} title={s.title} rows={s.rows} a={a} b={b} />
          ))}

          {/* Channel matrix — show all non-disabled channels side by side */}
          <ChannelMatrix a={a} b={b} />

          {/* Mesh visibility */}
          <MeshVisibility a={a} b={b} />
        </>
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
            {shortName(c)} ({c.state.loraConfig?.regionName ?? c.state.status} · {c.portPath?.split('/').pop() ?? c.connId})
          </option>
        ))}
      </select>
    </div>
  );
}

function Finding({ f }: { f: DiagFinding }) {
  return (
    <div className={`rc-finding rc-finding-${f.severity}`}>
      <div className="rc-finding-icon">
        {f.severity === 'block' ? '✗' : f.severity === 'warn' ? '!' : f.severity === 'ok' ? '✓' : 'i'}
      </div>
      <div className="rc-finding-body">
        <div className="rc-finding-title">{f.title}</div>
        <div className="rc-finding-detail">{f.detail}</div>
      </div>
    </div>
  );
}

function DetailTable({ title, rows, a, b }: { title: string; rows: RowDef[]; a: ConnectionView; b: ConnectionView }) {
  return (
    <div className="card rc-table">
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <table className="data">
        <thead>
          <tr>
            <th style={{ width: '32%' }}>Field</th>
            <th>{shortName(a)}</th>
            <th>{shortName(b)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const match = r.eq ? r.eq(a, b) : (String(r.get(a)) === String(r.get(b)));
            return (
              <tr key={r.label} className={match ? '' : 'rc-row-diff'}>
                <td>
                  <div style={{ fontWeight: 500 }}>{r.label}</div>
                  {r.hint && <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 2 }}>{r.hint}</div>}
                </td>
                <td>{r.get(a)}</td>
                <td>{r.get(b)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChannelMatrix({ a, b }: { a: ConnectionView; b: ConnectionView }) {
  const chA = (a.state.channels ?? []).filter((c) => c.role !== 0);
  const chB = (b.state.channels ?? []).filter((c) => c.role !== 0);
  const maxIdx = Math.max(0, ...chA.map((c) => c.index), ...chB.map((c) => c.index));
  if (maxIdx === 0 && chA.length === 0 && chB.length === 0) return null;

  const rows: Array<{ index: number; a?: typeof chA[0]; b?: typeof chB[0] }> = [];
  for (let i = 0; i <= maxIdx; i++) {
    rows.push({ index: i, a: chA.find((c) => c.index === i), b: chB.find((c) => c.index === i) });
  }

  return (
    <div className="card rc-table">
      <h3 style={{ marginTop: 0 }}>Channel slots</h3>
      <p style={{ margin: '0 0 8px', color: 'var(--text-dim)', fontSize: 12 }}>
        All enabled channels on each radio. Mismatched slot 0 (primary) prevents direct communication — secondary slots only matter if you're chatting on them.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>Slot</th>
            <th>{shortName(a)}</th>
            <th>{shortName(b)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const nameA = r.a?.name || (r.a ? '(default)' : '—');
            const nameB = r.b?.name || (r.b ? '(default)' : '—');
            const fp = (psk?: number[]) => psk && psk.length >= 4
              ? ' · ' + psk.slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('') + '…'
              : '';
            const cryptA = r.a ? pskLabel(r.a.pskLength) + fp(r.a.psk) : '—';
            const cryptB = r.b ? pskLabel(r.b.pskLength) + fp(r.b.psk) : '—';
            const pskBytesMatch = !!r.a && !!r.b
              && r.a.pskLength === r.b.pskLength
              && (r.a.psk?.length ?? 0) === (r.b.psk?.length ?? 0)
              && (r.a.psk ?? []).every((byte, i) => byte === (r.b!.psk ?? [])[i]);
            const match = nameA === nameB && pskBytesMatch;
            return (
              <tr key={r.index} className={match ? '' : 'rc-row-diff'}>
                <td style={{ fontFamily: 'var(--mono)' }}>{r.index}</td>
                <td>
                  <div>{nameA}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{cryptA} · {r.a?.roleName ?? '—'}</div>
                </td>
                <td>
                  <div>{nameB}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>{cryptB} · {r.b?.roleName ?? '—'}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MeshVisibility({ a, b }: { a: ConnectionView; b: ConnectionView }) {
  const aMy = a.state.myInfo?.myNodeNum;
  const bMy = b.state.myInfo?.myNodeNum;
  const aSeesB = aMy && bMy ? a.nodes.find((n) => n.num === bMy) : undefined;
  const bSeesA = aMy && bMy ? b.nodes.find((n) => n.num === aMy) : undefined;

  return (
    <div className="card rc-table">
      <h3 style={{ marginTop: 0 }}>Mesh visibility</h3>
      <p style={{ margin: '0 0 8px', color: 'var(--text-dim)', fontSize: 12 }}>
        Does each radio's nodeDB contain the other? If yes, when was its last NodeInfo packet heard, and how many hops away?
      </p>
      <table className="data">
        <thead>
          <tr>
            <th style={{ width: '32%' }}>From → To</th>
            <th>Seen?</th>
            <th>Hops</th>
            <th>RSSI</th>
            <th>SNR</th>
            <th>Last heard</th>
          </tr>
        </thead>
        <tbody>
          <VisRow label={`${shortName(a)} → ${shortName(b)}`} node={aSeesB} />
          <VisRow label={`${shortName(b)} → ${shortName(a)}`} node={bSeesA} />
        </tbody>
      </table>
    </div>
  );
}

function VisRow({ label, node }: { label: string; node: NodeRecord | undefined }) {
  if (!node) {
    return (
      <tr className="rc-row-diff">
        <td>{label}</td>
        <td>no</td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
      </tr>
    );
  }
  const ago = node.lastHeard ? secondsAgoLabel(Math.max(0, Math.floor(Date.now() / 1000) - node.lastHeard)) : '—';
  return (
    <tr>
      <td>{label}</td>
      <td style={{ color: 'var(--good)' }}>yes</td>
      <td>{node.hopsAway ?? '?'}</td>
      <td>{node.rssi ? node.rssi : '—'}</td>
      <td>{node.snr ? node.snr.toFixed(1) : '—'}</td>
      <td>{ago}</td>
    </tr>
  );
}

function secondsAgoLabel(s: number): string {
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
