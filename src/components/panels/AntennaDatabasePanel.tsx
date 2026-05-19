import React, { useMemo, useState } from 'react';
import { ANTENNA_CATALOG, ANTENNA_CATEGORY_LABEL, type AntennaSpec, type AntennaCategory } from '../../lib/antenna-catalog';
import { useOwnedAntennas } from '../../hooks/useOwnedRosters';

/**
 * Reference catalog of common antennas, plus per-model ownership. Mirrors
 * the Device DB panel — list on the left, detail card on the right, with
 * an "Owned" filter and a quantity-plus-notes editor on each detail.
 *
 * The Owned roster is consumed by the per-node antenna-override picker
 * (in NodesPanel → AntennaOverrideEditor) so the user can attach a known
 * antenna spec to a node without retyping dBi values.
 */

interface Props {
  // Currently no props — purely reference + ownership UI. Future: filter
  // by what's compatible with the user's owned radios.
}

export function AntennaDatabasePanel(_props: Props) {
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<'all' | AntennaCategory>('all');
  const [filterBand, setFilterBand] = useState<'all' | '433' | '868' | '915' | '2400' | 'multi'>('all');
  const [filterOwned, setFilterOwned] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const owned = useOwnedAntennas();

  const filtered = useMemo(() => {
    return ANTENNA_CATALOG.filter((a) => {
      if (filterCategory !== 'all' && a.category !== filterCategory) return false;
      if (filterBand !== 'all' && a.freqBand !== filterBand) return false;
      if (filterOwned && !owned.isOwned(a.id)) return false;
      if (search) {
        const q = search.toLowerCase();
        const blob = [a.name, a.vendor, a.notes, ANTENNA_CATEGORY_LABEL[a.category]].join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      // Owned first, then highest gain.
      const aO = owned.isOwned(a.id) ? 1 : 0;
      const bO = owned.isOwned(b.id) ? 1 : 0;
      if (aO !== bO) return bO - aO;
      return b.gainDbi - a.gainDbi;
    });
  }, [filterCategory, filterBand, filterOwned, search, owned]);

  const active = selectedId ? ANTENNA_CATALOG.find((a) => a.id === selectedId) : null;

  return (
    <div className="page">
      <h1 className="page-title">Antenna DB</h1>
      <p className="page-sub">
        Reference catalog of antennas Meshtastic users commonly run. Mark what you own and the Node detail page will let you assign one to a radio's antenna override in one click. Gain figures are manufacturer-stated at the design frequency — real-world performance off-axis or off-band is usually lower.
      </p>

      <div className="card" style={{ padding: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="text"
            placeholder="search name / vendor / notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <select className="text" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value as 'all' | AntennaCategory)} style={{ width: 180 }}>
            <option value="all">Any type</option>
            {Object.entries(ANTENNA_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="text" value={filterBand} onChange={(e) => setFilterBand(e.target.value as 'all' | '433' | '868' | '915' | '2400' | 'multi')} style={{ width: 140 }}>
            <option value="all">Any band</option>
            <option value="433">433 MHz</option>
            <option value="868">868 MHz</option>
            <option value="915">915 MHz</option>
            <option value="2400">2.4 GHz</option>
            <option value="multi">Multi-band</option>
          </select>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-faint)', cursor: 'pointer' }}>
            <input type="checkbox" checked={filterOwned} onChange={(e) => setFilterOwned(e.target.checked)} />
            ⌂ Owned only{owned.totalCount > 0 ? ` (${owned.byId.size})` : ''}
          </label>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 'auto' }}>
            {filtered.length} of {ANTENNA_CATALOG.length} antennas
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        <div className="card" style={{ padding: 0 }}>
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: 18 }}>No antennas match these filters.</div>
          ) : (
            <table className="data" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Antenna</th>
                  <th>Type</th>
                  <th>Gain</th>
                  <th>Band</th>
                  <th>Owned</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => {
                  const isOwned = owned.isOwned(a.id);
                  const ownedRec = owned.get(a.id);
                  const isSelected = selectedId === a.id;
                  return (
                    <tr
                      key={a.id}
                      onClick={() => setSelectedId(a.id)}
                      style={{ cursor: 'pointer', background: isSelected ? 'var(--bg-elev-2)' : isOwned ? 'rgba(92,200,255,0.05)' : undefined }}
                    >
                      <td>
                        <div style={{ color: 'var(--accent)' }}>{a.name}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{a.vendor}{a.approxPriceUsd && a.approxPriceUsd !== 'included' && <> · {a.approxPriceUsd}</>}</div>
                      </td>
                      <td style={{ fontSize: 11 }}>{ANTENNA_CATEGORY_LABEL[a.category]}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{a.gainDbi} dBi</td>
                      <td style={{ fontSize: 11 }}>{a.freqBand === 'multi' ? 'multi' : `${a.freqBand} MHz`}</td>
                      <td>
                        {isOwned ? (
                          <span style={{ background: 'rgba(92,200,255,0.15)', color: 'var(--accent)', border: '1px solid rgba(92,200,255,0.4)', padding: '1px 8px', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: 11 }}>
                            ⌂ {ownedRec!.quantity > 1 ? `×${ownedRec!.quantity}` : 'owned'}
                          </span>
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
          {active ? <AntennaDetail antenna={active} /> : (
            <div className="info-card">
              <p style={{ margin: 0 }}><strong>Mark what you own.</strong></p>
              <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
                Pick an antenna for spec details + a "Mark owned" button. Anything you own becomes selectable on each node's antenna-override picker, so attaching a real antenna to a real radio is one click instead of retyping dBi values.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AntennaDetail({ antenna }: { antenna: AntennaSpec }) {
  return (
    <div className="card" style={{ position: 'sticky', top: 0, background: 'var(--bg-elev)', zIndex: 1 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0, color: 'var(--accent)' }}>{antenna.name}</h2>
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', fontFamily: 'var(--mono)', marginTop: 2 }}>
          {antenna.vendor} · {ANTENNA_CATEGORY_LABEL[antenna.category]}
        </div>
      </div>

      <AntennaOwnershipEditor antennaId={antenna.id} />

      <dl className="kv kv-tight">
        <dt>Peak gain</dt><dd>{antenna.gainDbi} dBi</dd>
        <dt>Design freq</dt><dd>{antenna.freqBand === 'multi' ? 'Multi-band' : `${antenna.freqBand} MHz`}</dd>
        <dt>Form factor</dt><dd>{antenna.size}</dd>
        <dt>Connector</dt><dd>{antenna.connector}</dd>
        <dt>Price (approx)</dt><dd>{antenna.approxPriceUsd}</dd>
      </dl>

      {antenna.notes && (
        <div className="info-card" style={{ marginTop: 12 }}>
          <p style={{ margin: 0, fontSize: 12.5 }}>{antenna.notes}</p>
        </div>
      )}

      <div className="info-card" style={{ marginTop: 10 }}>
        <p style={{ margin: 0, fontSize: 12 }}><strong>Range math.</strong></p>
        <p style={{ margin: '6px 0 0', fontSize: 12 }}>
          Going from a stock 2 dBi rubber duck to this antenna is <strong>+{(antenna.gainDbi - 2).toFixed(1)} dB</strong> on TX and the same on RX. Free-space distance roughly multiplies by {Math.pow(10, ((antenna.gainDbi - 2) * 2) / 20).toFixed(1)}× — for the same TX power and battery.
        </p>
      </div>
    </div>
  );
}

function AntennaOwnershipEditor({ antennaId }: { antennaId: string }) {
  const owned = useOwnedAntennas();
  const current = owned.get(antennaId);
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState<string>(String(current?.quantity ?? 1));
  const [notes, setNotes] = useState<string>(current?.notes ?? '');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    setQty(String(current?.quantity ?? 1));
    setNotes(current?.notes ?? '');
  }, [antennaId, current?.quantity, current?.notes]);

  const onSave = async () => {
    const n = parseInt(qty, 10);
    if (!Number.isFinite(n) || n < 1 || n > 99) { alert('Quantity must be 1–99.'); return; }
    setBusy(true);
    try { await window.mesh.setOwnedAntenna({ antennaId, quantity: n, notes: notes.trim() }); setEditing(false); }
    finally { setBusy(false); }
  };
  const onClear = async () => {
    if (!confirm('Remove this antenna from your owned roster?')) return;
    setBusy(true);
    try { await window.mesh.clearOwnedAntenna(antennaId); setEditing(false); }
    finally { setBusy(false); }
  };

  if (!editing) {
    return (
      <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 4, background: current ? 'rgba(92,200,255,0.06)' : 'rgba(154,163,178,0.05)', border: `1px solid ${current ? 'rgba(92,200,255,0.3)' : 'rgba(154,163,178,0.18)'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 12 }}>
            {current
              ? <><span style={{ color: 'var(--accent)' }}>⌂ Owned</span><span style={{ color: 'var(--text-faint)' }}> · ×{current.quantity}</span></>
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
    <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 4, background: 'rgba(92,200,255,0.06)', border: '1px solid rgba(92,200,255,0.4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Quantity</label>
        <input className="text" type="number" min="1" max="99" value={qty} onChange={(e) => setQty(e.target.value)} disabled={busy} style={{ fontFamily: 'var(--mono)' }} />
        <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>Notes</label>
        <input className="text" type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder='e.g. "roof of garage, north pole"' disabled={busy} />
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button className="primary" onClick={onSave} disabled={busy} style={{ padding: '4px 10px', fontSize: 12 }}>{busy ? 'Saving…' : 'Save'}</button>
        {current && (
          <button className="ghost" onClick={onClear} disabled={busy} style={{ padding: '4px 10px', fontSize: 12, borderColor: 'var(--bad)', color: 'var(--bad)' }}>Remove</button>
        )}
        <button className="ghost" onClick={() => setEditing(false)} disabled={busy} style={{ padding: '4px 10px', fontSize: 12 }}>Cancel</button>
      </div>
    </div>
  );
}
