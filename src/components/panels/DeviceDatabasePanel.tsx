import React, { useMemo, useState } from 'react';
import { DeviceDiagram } from '../DeviceDiagram';
import { getDeviceReference, CONNECTOR_LABELS, type DeviceReference, type SetupTip } from '../../lib/device-reference';
import { CATALOG, type DeviceSpec } from '../../lib/device-catalog';
import { useOwnedDevices } from '../../hooks/useOwnedRosters';


interface Props {
  nodes: NodeRecord[];
}

export function DeviceDatabasePanel({ nodes }: Props) {
  const [search, setSearch] = useState('');
  const [filterChip, setFilterChip] = useState<string>('all');
  const [filterFeature, setFilterFeature] = useState<'all' | 'recommended' | 'owned' | 'gps' | 'wifi' | 'screen' | 'in-mesh'>('all');
  const [selectedHw, setSelectedHw] = useState<number | null>(null);
  const owned = useOwnedDevices();

  // Count how many of each model are in the user's nodeDB.
  const meshCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const n of nodes) {
      m.set(n.hwModel, (m.get(n.hwModel) ?? 0) + 1);
    }
    return m;
  }, [nodes]);

  const filtered = useMemo(() => {
    return CATALOG.filter((d) => {
      if (filterChip !== 'all' && d.chipFamily !== filterChip) return false;
      if (filterFeature === 'recommended' && !d.recommended) return false;
      if (filterFeature === 'owned' && !owned.isOwned(d.hwModel)) return false;
      if (filterFeature === 'gps' && !d.gps) return false;
      if (filterFeature === 'wifi' && !d.wifi) return false;
      if (filterFeature === 'screen' && d.display === 'none') return false;
      if (filterFeature === 'in-mesh' && !meshCounts.has(d.hwModel)) return false;
      if (search) {
        const q = search.toLowerCase();
        const blob = [d.name, d.vendor, d.chipFamily, d.loraChip, d.notes ?? ''].join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      // Owned first, then in-mesh, then alphabetical.
      const aOwn = owned.isOwned(a.hwModel) ? 1 : 0;
      const bOwn = owned.isOwned(b.hwModel) ? 1 : 0;
      if (aOwn !== bOwn) return bOwn - aOwn;
      const aIn = meshCounts.has(a.hwModel) ? 1 : 0;
      const bIn = meshCounts.has(b.hwModel) ? 1 : 0;
      if (aIn !== bIn) return bIn - aIn;
      return a.name.localeCompare(b.name);
    });
  }, [filterChip, filterFeature, search, meshCounts, owned]);

  const active = selectedHw != null ? CATALOG.find((d) => d.hwModel === selectedHw) : null;

  // Detect unknown hwModels in the user's mesh that we don't catalog yet.
  const unknownInMesh = useMemo(() => {
    const known = new Set(CATALOG.map((c) => c.hwModel));
    const unknown = new Map<number, number>();
    for (const n of nodes) {
      if (n.hwModel !== 0 && !known.has(n.hwModel)) {
        unknown.set(n.hwModel, (unknown.get(n.hwModel) ?? 0) + 1);
      }
    }
    return unknown;
  }, [nodes]);

  return (
    <div className="page">
      <h1 className="page-title">Device DB</h1>
      <p className="page-sub">
        Catalog of Meshtastic-compatible hardware. Specs, recommended uses, stock antenna gain. Models we recognize in your nodeDB are highlighted so you can see at a glance what's actually on the air around you.
      </p>

      <div className="card" style={{ padding: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="text"
            placeholder="search name / vendor / chip / notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <select className="text" value={filterChip} onChange={(e) => setFilterChip(e.target.value)} style={{ width: 160 }}>
            <option value="all">All chip families</option>
            <option value="ESP32">ESP32</option>
            <option value="ESP32-S3">ESP32-S3</option>
            <option value="nRF52">nRF52</option>
            <option value="RP2040">RP2040</option>
          </select>
          <select className="text" value={filterFeature} onChange={(e) => setFilterFeature(e.target.value as any)} style={{ width: 180 }}>
            <option value="all">Any features</option>
            <option value="recommended">★ Recommended</option>
            <option value="owned">⌂ Owned{owned.totalCount > 0 ? ` (${owned.byHwModel.size} model${owned.byHwModel.size === 1 ? '' : 's'})` : ''}</option>
            <option value="gps">Has GPS</option>
            <option value="wifi">Has WiFi</option>
            <option value="screen">Has screen</option>
            <option value="in-mesh">In your nodeDB</option>
          </select>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 'auto' }}>
            {filtered.length} of {CATALOG.length} models
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        <div className="card" style={{ padding: 0 }}>
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: 18 }}>No models match these filters.</div>
          ) : (
            <table className="data" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Chip</th>
                  <th>LoRa</th>
                  <th>GPS · WiFi · BT</th>
                  <th>Screen</th>
                  <th>Max TX</th>
                  <th>In mesh</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const count = meshCounts.get(d.hwModel) ?? 0;
                  const selected = selectedHw === d.hwModel;
                  return (
                    <tr
                      key={d.hwModel}
                      onClick={() => setSelectedHw(d.hwModel)}
                      style={{
                        cursor: 'pointer',
                        background: selected ? 'var(--bg-elev-2)' : count > 0 ? 'rgba(102,211,154,0.04)' : undefined,
                      }}
                    >
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ color: 'var(--accent)' }}>{d.name}</span>
                          {owned.isOwned(d.hwModel) && (
                            <span
                              style={{
                                background: 'rgba(92,200,255,0.15)',
                                color: 'var(--accent)',
                                border: '1px solid rgba(92,200,255,0.5)',
                                padding: '1px 8px',
                                borderRadius: 10,
                                fontFamily: 'var(--mono)',
                                fontSize: 10.5,
                                fontWeight: 600,
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                              }}
                              title={owned.get(d.hwModel)?.notes || 'You own this device.'}
                            >
                              ⌂ Owned{(owned.get(d.hwModel)!.quantity > 1) ? ` ×${owned.get(d.hwModel)!.quantity}` : ''}
                            </span>
                          )}
                          {d.recommended && (
                            <span
                              style={{
                                background: 'rgba(102,211,154,0.12)',
                                color: 'var(--good)',
                                border: '1px solid rgba(102,211,154,0.4)',
                                padding: '1px 8px',
                                borderRadius: 10,
                                fontFamily: 'var(--mono)',
                                fontSize: 10.5,
                                fontWeight: 600,
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                              }}
                              title={d.recommended}
                            >
                              ★ Recommended
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-faint)', marginTop: 2 }}>
                          {d.vendor}
                        </div>
                      </td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{d.chipFamily}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{d.loraChip}</td>
                      <td style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                        {d.gps ? '✓' : '–'} · {d.wifi ? '✓' : '–'} · {d.ble ? '✓' : '–'}
                      </td>
                      <td style={{ fontSize: 11 }}>{d.display === 'none' ? '—' : d.display}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{d.maxTxDbm} dBm</td>
                      <td>
                        {count > 0 ? (
                          <span style={{
                            background: 'rgba(102,211,154,0.15)', color: 'var(--good)',
                            border: '1px solid rgba(102,211,154,0.4)',
                            padding: '1px 8px', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: 11,
                          }}>{count}</span>
                        ) : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div>
          {active ? (
            <DeviceDetail device={active} count={meshCounts.get(active.hwModel) ?? 0} />
          ) : (
            <div className="info-card">
              <p style={{ margin: 0 }}><strong>How to read this catalog.</strong></p>
              <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
                Models highlighted with a green count are present in your mesh right now. Pick one to see full specs, recommended use cases, and how it compares to alternatives. Hardware-model numbers come from the Meshtastic <code>HardwareModel</code> protobuf enum.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Below the split-wide row so they don't share a column with the sticky
       *  detail card — otherwise they slide up behind it on scroll. */}
      {unknownInMesh.size > 0 && (
        <div className="info-card" style={{ borderLeftColor: 'var(--warn)', marginTop: 14 }}>
          <p style={{ margin: 0 }}><strong>Unknown models in your mesh.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            {Array.from(unknownInMesh.entries()).map(([hw, count], i) => (
              <span key={hw}>{i > 0 ? ', ' : ''}hwModel #{hw} ({count})</span>
            ))}
            {' '}— either newer hardware than this catalog covers, or zero (which means the radio never reported a hwModel for that node).
          </p>
        </div>
      )}

      <div className="info-card" style={{ marginTop: 10 }}>
        <p style={{ margin: 0 }}><strong>What this catalog is for.</strong></p>
        <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
          When you click "Message" or "Traceroute" to another node, knowing what hardware they're on tells you what to expect — a TBEAM with GPS will broadcast position; a Heltec WSL with no display might be a permanently-deployed router; an nRF52 board with 22 dBm probably has serious uptime.
        </p>
      </div>
    </div>
  );
}

function DeviceDetail({ device, count }: { device: DeviceSpec; count: number }) {
  const ref = getDeviceReference(device.hwModel);
  return (
    <div className="card" style={{ position: 'sticky', top: 0, background: 'var(--bg-elev)', zIndex: 1, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0, color: 'var(--accent)' }}>{device.name}</h2>
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)', marginTop: 2 }}>
          {device.vendor} · hwModel #{device.hwModel}
        </div>
        {count > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--good)' }}>
            ● {count} in your mesh right now
          </div>
        )}
      </div>

      <DeviceOwnershipEditor hwModel={device.hwModel} />

      {ref && (
        <div style={{ margin: '10px 0 14px' }}>
          <DeviceDiagram layout={ref.layout} width={320} />
          <div style={{ fontSize: 10, color: 'var(--text-faint)', textAlign: 'center', marginTop: 2, fontStyle: 'italic' }}>
            schematic — positions approximate
          </div>
        </div>
      )}

      <dl className="kv kv-tight">
        <dt>Chip family</dt><dd>{device.chipFamily}</dd>
        <dt>LoRa transceiver</dt><dd>{device.loraChip}</dd>
        <dt>Max TX power</dt><dd>{device.maxTxDbm} dBm</dd>
        <dt>Stock antenna</dt><dd>{device.stockAntennaDbi} dBi</dd>
        <dt>Display</dt><dd>{device.display}</dd>
        <dt>Battery</dt><dd>{device.battery}</dd>
        <dt>GPS</dt><dd>{device.gps ? 'yes' : 'no'}</dd>
        <dt>WiFi</dt><dd>{device.wifi ? 'yes' : 'no'}</dd>
        <dt>Bluetooth</dt><dd>{device.ble ? 'yes' : 'no'}</dd>
        <dt>Price (approx)</dt><dd>{device.approxPriceUsd}</dd>
      </dl>

      {device.notes && (
        <div className="info-card" style={{ marginTop: 12 }}>
          <p style={{ margin: 0, fontSize: 12.5 }}>{device.notes}</p>
        </div>
      )}
      {device.recommended && (
        <div className="info-card" style={{ marginTop: 8, borderLeftColor: 'var(--good)' }}>
          <p style={{ margin: 0, fontSize: 12.5 }}><strong>★ {device.recommended}</strong></p>
        </div>
      )}

      {ref && <DeviceReferenceTables reference={ref} />}

      <div className="info-card" style={{ marginTop: 12 }}>
        <p style={{ margin: 0, fontSize: 12 }}><strong>Antenna upgrade math.</strong></p>
        <p style={{ margin: '6px 0 0', fontSize: 12 }}>
          Going from stock {device.stockAntennaDbi} dBi to a typical $30 5 dBi fiberglass omni = +{(5 - device.stockAntennaDbi).toFixed(1)} dB on TX and another +{(5 - device.stockAntennaDbi).toFixed(1)} dB on RX. That's {Math.pow(10, ((5 - device.stockAntennaDbi) * 2) / 20).toFixed(1)}× the range — for the same battery and TX power.
        </p>
      </div>
    </div>
  );
}

function DeviceReferenceTables({ reference }: { reference: DeviceReference }) {
  const ref = reference;
  return (
    <div style={{ marginTop: 14 }}>
      {ref.physicalNotes && (
        <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 12px' }}>{ref.physicalNotes}</p>
      )}

      {/* Buttons */}
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-faint)', margin: '14px 0 6px' }}>
        Buttons
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ref.layout.buttons.map((b, i) => (
          <div key={i} style={{ border: '1px solid rgba(154,163,178,0.18)', borderRadius: 4, padding: '6px 8px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
              {b.label}{b.altLabel && <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: 6 }}>({b.altLabel})</span>}
            </div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12 }}>
              {b.actions.map((a, j) => (
                <li key={j}>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>{a.trigger}</span>
                  {' — '}{a.effect}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Ports */}
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-faint)', margin: '14px 0 6px' }}>
        Ports
      </h3>
      <table className="data" style={{ fontSize: 12, width: '100%' }}>
        <thead>
          <tr><th>Label</th><th>Connector</th><th>Edge</th></tr>
        </thead>
        <tbody>
          {ref.layout.ports.map((p, i) => (
            <tr key={i}>
              <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{p.label}</td>
              <td style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>{CONNECTOR_LABELS[p.connector]}</td>
              <td style={{ fontSize: 11, color: 'var(--text-faint)' }}>{p.edge}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 6 }}>
        {ref.layout.ports.filter((p) => p.notes).map((p, i) => (
          <div key={i} style={{ fontSize: 11.5, marginTop: 4, color: 'var(--text-dim)' }}>
            <strong style={{ color: 'var(--accent)' }}>{p.label}</strong> — {p.notes}
          </div>
        ))}
      </div>

      {/* Setup tips */}
      {ref.setupTips.length > 0 && (
        <>
          <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-faint)', margin: '14px 0 6px' }}>
            First-time setup
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ref.setupTips.map((tip, i) => <SetupTipCard key={i} tip={tip} />)}
          </div>
        </>
      )}

      {/* Bootloader */}
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-faint)', margin: '14px 0 6px' }}>
        Enter bootloader / DFU
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>{ref.bootloaderInstructions}</p>
    </div>
  );
}

function SetupTipCard({ tip }: { tip: SetupTip }) {
  const tone = tip.tone ?? 'info';
  const borderColor = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : 'var(--accent)';
  const icon = tone === 'bad' ? '⚠' : tone === 'warn' ? '!' : 'ℹ';
  return (
    <div style={{ borderLeft: `3px solid ${borderColor}`, paddingLeft: 8, fontSize: 12 }}>
      <div style={{ fontWeight: 600, color: borderColor }}>
        <span style={{ marginRight: 6 }}>{icon}</span>{tip.title}
      </div>
      <p style={{ margin: '2px 0 0', color: 'var(--text-dim)' }}>{tip.body}</p>
    </div>
  );
}

/**
 * Per-hwModel ownership editor inside the DeviceDetail card. Tracks
 * quantity and a free-text note (e.g. "rooftop router · purchased 2025-03").
 * Stores to SQLite; the useOwnedDevices hook picks up the change event
 * and re-renders the catalog (badges + Owned filter + sort).
 */
function DeviceOwnershipEditor({ hwModel }: { hwModel: number }) {
  const owned = useOwnedDevices();
  const current = owned.get(hwModel);
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState<string>(String(current?.quantity ?? 1));
  const [notes, setNotes] = useState<string>(current?.notes ?? '');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    setQty(String(current?.quantity ?? 1));
    setNotes(current?.notes ?? '');
  }, [hwModel, current?.quantity, current?.notes]);

  const onSave = async () => {
    const n = parseInt(qty, 10);
    if (!Number.isFinite(n) || n < 1 || n > 99) {
      alert('Quantity must be 1–99.');
      return;
    }
    setBusy(true);
    try {
      await window.mesh.setOwnedDevice({ hwModel, quantity: n, notes: notes.trim() });
      setEditing(false);
    } finally { setBusy(false); }
  };
  const onClear = async () => {
    if (!confirm('Remove from your owned-devices roster?')) return;
    setBusy(true);
    try { await window.mesh.clearOwnedDevice(hwModel); setEditing(false); }
    finally { setBusy(false); }
  };

  if (!editing) {
    return (
      <div style={{ marginTop: 10, marginBottom: 10, padding: '8px 10px', borderRadius: 4, background: current ? 'rgba(92,200,255,0.06)' : 'rgba(154,163,178,0.05)', border: `1px solid ${current ? 'rgba(92,200,255,0.3)' : 'rgba(154,163,178,0.18)'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 12 }}>
            {current
              ? <>
                  <span style={{
                    background: 'rgba(92,200,255,0.18)',
                    color: 'var(--accent)',
                    border: '1px solid rgba(92,200,255,0.5)',
                    padding: '2px 10px',
                    borderRadius: 10,
                    fontFamily: 'var(--mono)',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                  }}>⌂ Owned{current.quantity > 1 ? ` ×${current.quantity}` : ''}</span>
                </>
              : <span style={{ color: 'var(--text-faint)' }}>Not in your owned roster</span>}
          </div>
          <button className="ghost" onClick={() => setEditing(true)} style={{ padding: '2px 8px', fontSize: 11 }}>
            {current ? 'Edit' : 'Mark owned'}
          </button>
        </div>
        {current?.notes && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-dim)' }}>{current.notes}</div>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, marginBottom: 10, padding: '10px 12px', borderRadius: 4, background: 'rgba(92,200,255,0.06)', border: '1px solid rgba(92,200,255,0.4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Quantity</label>
        <input className="text" type="number" min="1" max="99" value={qty} onChange={(e) => setQty(e.target.value)} disabled={busy} style={{ fontFamily: 'var(--mono)' }} />
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Notes</label>
        <input className="text" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder='e.g. "rooftop router, purchased 2025-03"' disabled={busy} />
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="primary" onClick={onSave} disabled={busy} style={{ padding: '4px 10px', fontSize: 12 }}>{busy ? 'Saving…' : 'Save'}</button>
        {current && (
          <button className="ghost" onClick={onClear} disabled={busy} style={{ padding: '4px 10px', fontSize: 12, borderColor: 'var(--bad)', color: 'var(--bad)' }}>
            Remove
          </button>
        )}
        <button className="ghost" onClick={() => setEditing(false)} disabled={busy} style={{ padding: '4px 10px', fontSize: 12 }}>Cancel</button>
      </div>
    </div>
  );
}
