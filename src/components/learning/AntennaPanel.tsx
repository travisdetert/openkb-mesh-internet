import React, { useState } from 'react';
import { ANTENNAS, CONNECTOR_LABELS, POLARIZATION_LABELS } from '../../data/antennas';
import { REGIONS } from '../../data/regions';
import type { TabId } from '../TopNav';
import { LearningModeBadge, LearningSeeAlso } from './LearningChrome';

type Tab = 'compare' | 'patterns' | 'polarization' | 'length' | 'recommend';

function bandsLabel(bands: string[]): string {
  if (bands.length === 1 && bands[0] === '*') return 'wideband (any region)';
  return bands
    .map((b) => REGIONS.find((r) => r.id === b)?.label.replace(/\s*\(.+\)$/, '') ?? b)
    .join(', ');
}

export function AntennaPanel({ go }: { go: (id: TabId) => void }) {
  const [tab, setTab] = useState<Tab>('compare');

  return (
    <div className="page">
      <h1 className="page-title">Antennas</h1>
      <p className="page-sub">
        The stock antenna shipped with your radio is roughly <code>$0.50</code> of plastic and copper. Upgrading is the single highest-return change you can make to your range.
      </p>
      <LearningModeBadge mode="offline" />

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'compare' ? ' active' : '')} onClick={() => setTab('compare')}>Compare</button>
        <button className={'subnav-btn' + (tab === 'patterns' ? ' active' : '')} onClick={() => setTab('patterns')}>Patterns</button>
        <button className={'subnav-btn' + (tab === 'polarization' ? ' active' : '')} onClick={() => setTab('polarization')}>Polarization</button>
        <button className={'subnav-btn' + (tab === 'length' ? ' active' : '')} onClick={() => setTab('length')}>Length calculator</button>
        <button className={'subnav-btn' + (tab === 'recommend' ? ' active' : '')} onClick={() => setTab('recommend')}>Recommendations</button>
      </div>

      {tab === 'compare' && <CompareTab />}
      {tab === 'patterns' && <PatternsTab />}
      {tab === 'polarization' && <PolarizationTab />}
      {tab === 'length' && <LengthTab />}
      {tab === 'recommend' && <RecommendTab />}

      <LearningSeeAlso go={go} links={[
        { to: 'link-budget',   label: 'Link Budget',         blurb: 'See how an antenna swap moves the dB ledger.' },
        { to: 'rssi-distance', label: 'RSSI vs. Distance',   blurb: 'Compare your measured RSSI before/after an upgrade.' },
        { to: 'coverage',      label: 'Coverage',            blurb: 'Translate dB into geographic reach.' },
      ]} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Compare tab — existing comparison UI
// ─────────────────────────────────────────────────────────────────────

function CompareTab() {
  const [selectedId, setSelectedId] = useState<string>('stock');
  const stock = ANTENNAS.find((a) => a.id === 'stock')!;
  const upgrade = ANTENNAS.find((a) => a.id === selectedId)!;
  const gainDelta = upgrade.gainDbi - stock.gainDbi;
  const distMultiplier = Math.pow(10, gainDelta / 20);
  const connectorMismatch = stock.connector !== upgrade.connector
    && upgrade.connector !== 'bare-wire'
    && upgrade.connector !== 'integrated';

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pick an upgrade to compare</h2>
          <table className="data">
            <thead>
              <tr>
                <th></th>
                <th>Antenna</th>
                <th>Type</th>
                <th>Gain</th>
                <th>Form factor</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {ANTENNAS.map((a) => (
                <tr key={a.id} onClick={() => setSelectedId(a.id)}
                    style={{ cursor: 'pointer', background: a.id === selectedId ? 'var(--bg-elev-2)' : undefined }}>
                  <td><input type="radio" checked={a.id === selectedId} readOnly /></td>
                  <td style={{ fontFamily: 'inherit', color: 'var(--text)' }}>{a.name}</td>
                  <td>{a.type}</td>
                  <td>{a.gainDbi >= 0 ? '+' : ''}{a.gainDbi} dBi</td>
                  <td style={{ fontFamily: 'inherit', color: 'var(--text-dim)' }}>{a.formFactor}</td>
                  <td>{a.priceUsd[0] === 0 && a.priceUsd[1] === 0 ? '—' : `$${a.priceUsd[0]}–${a.priceUsd[1]}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>{upgrade.name} vs stock</h2>
          <div className="range-grid">
            <Card label="Gain delta" value={`${gainDelta >= 0 ? '+' : ''}${gainDelta.toFixed(1)} dB`} />
            <Card label="Distance multiplier" value={`${distMultiplier.toFixed(2)}×`} hint="Free-space, in your sight line" />
            <Card label="VSWR" value={upgrade.vswr} hint="Lower = less reflected power" />
            <Card label="Beamwidth" value={upgrade.beamwidthDeg ? `${upgrade.beamwidthDeg}°` : 'omni'}
                  hint={upgrade.type === 'directional' ? 'Where you point matters' : '360° horizontal'} />
          </div>
          <div className="range-grid" style={{ marginTop: 10 }}>
            <Card label="Connector" value={CONNECTOR_LABELS[upgrade.connector]}
                  hint={connectorMismatch ? `Stock is ${CONNECTOR_LABELS[stock.connector]} — adapter needed` : 'Matches stock'} />
            <Card label="Polarization" value={POLARIZATION_LABELS[upgrade.polarization]}
                  hint={upgrade.polarization === 'linear-mountable' ? 'Mount vertical to match other nodes' : 'Match other nodes or lose ~20 dB'} />
            <Card label="Bands" value={bandsLabel(upgrade.bands)} hint="Antenna geometry is band-specific unless wideband" />
          </div>
          <div className="info-card" style={{ marginTop: 14 }}>
            <p><strong>Best for:</strong> {upgrade.bestFor}</p>
            <p style={{ marginBottom: 0 }}><strong>Watch out:</strong> {upgrade.watchOut}</p>
          </div>
        </div>
      </div>

      <div>
        <div className="info-card">
          <p><strong>The "10 dBi WiFi antenna" trap.</strong></p>
          <p>Most cheap "high-gain" antennas online are tuned for 2.4 GHz, not 868/915 MHz. A 915 MHz quarter-wave is ~8.2 cm; a 2.4 GHz one is ~3.1 cm. A wrongly-tuned antenna is often <em>worse</em> than stock — high VSWR can damage the radio over time.</p>
          <p style={{ marginBottom: 0 }}>Always verify rated frequency on the spec sheet. Measure VSWR with a NanoVNA (~$50) if you're serious.</p>
        </div>

        <div className="card">
          <h3>The cable matters too</h3>
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12.5 }}>At 915 MHz, per meter of coax:</p>
          <ul style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-dim)', paddingLeft: 16 }}>
            <li>RG-174 (thin): <code>~0.7 dB</code></li>
            <li>RG-58 (typical): <code>~1.0 dB</code></li>
            <li>RG-8X: <code>~0.5 dB</code></li>
            <li>LMR-240: <code>~0.4 dB</code></li>
            <li>LMR-400: <code>~0.2 dB</code></li>
            <li>LMR-600: <code>~0.13 dB</code></li>
          </ul>
          <p style={{ marginTop: 8, color: 'var(--text-faint)', fontSize: 11.5, marginBottom: 0 }}>
            5 m of RG-58 between your radio and a +5 dBi antenna gives you... 0 dB net gain.
          </p>
        </div>

        <div className="card">
          <h3>Connector etiquette</h3>
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12.5 }}>
            SX1262 boards usually use <code>U.FL</code> (tiny pigtail) or <code>SMA</code>. Each connector pair adds ~<code>0.2 dB</code> loss. Adapter chains kill performance — fewer joints, better quality.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Patterns tab — SVG polar plots
// ─────────────────────────────────────────────────────────────────────

interface PatternDef {
  id: string;
  name: string;
  gainDbi: number;
  description: string;
  // Returns gain in dB relative to peak, given azimuth angle in degrees (0 = forward / up).
  pattern: (angleDeg: number) => number;
}

const PATTERNS: PatternDef[] = [
  {
    id: 'isotropic',
    name: 'Isotropic (reference)',
    gainDbi: 0,
    description: 'Theoretical antenna that radiates equally in all directions. Doesn\'t physically exist — it\'s the reference point for all dBi numbers.',
    pattern: () => 0,
  },
  {
    id: 'dipole',
    name: 'Half-wave dipole',
    gainDbi: 2.15,
    description: 'The simplest practical antenna. Donut-shaped pattern: maximum gain perpendicular to the wire, null along the wire axis. Most stock Meshtastic antennas are quarter-wave monopoles approximating a dipole.',
    pattern: (a) => {
      // sin²(θ) pattern, peak at 90°, null at 0° and 180°. Map angleDeg as horizontal (broadside is 0).
      const rad = (a * Math.PI) / 180;
      // We render in the H-plane (top-down view), where dipole is omnidirectional, so gain ≈ 0 dB at all angles.
      return 0;
    },
  },
  {
    id: 'dipole-vplane',
    name: 'Dipole — vertical-plane cut',
    gainDbi: 2.15,
    description: 'Same dipole, viewed from the side. Shows the doughnut\'s figure-8 cross-section: peak gain horizontal, nulls up and down. This is why mounting a vertical antenna high up still doesn\'t help straight overhead.',
    pattern: (a) => {
      const rad = (a * Math.PI) / 180;
      const sin2 = Math.sin(rad);
      if (sin2 === 0) return -30;
      return 10 * Math.log10(sin2 * sin2);
    },
  },
  {
    id: '5-8-wave',
    name: '5/8-wave monopole',
    gainDbi: 3.0,
    description: 'A longer-than-quarter-wave whip. ~3 dBi gain by pushing energy more horizontally and pulling it out of the overhead null. Common on roof-mount LoRa.',
    pattern: (a) => {
      const rad = (a * Math.PI) / 180;
      const s = Math.sin(rad);
      if (s === 0) return -30;
      return 10 * Math.log10(s * s * 1.5);
    },
  },
  {
    id: 'collinear',
    name: 'Collinear array (~6 dBi)',
    gainDbi: 6,
    description: 'Stacked dipoles that share a feed. Squeezes the doughnut flatter — more horizontal gain, narrower vertical beam. Excellent for ground-level meshes where most other nodes are also near the ground.',
    pattern: (a) => {
      const rad = (a * Math.PI) / 180;
      const s = Math.sin(rad);
      if (s === 0) return -30;
      // ~6 dB at horizon, narrower lobe
      return 10 * Math.log10(Math.pow(Math.abs(s), 4) * 3);
    },
  },
  {
    id: 'yagi',
    name: 'Yagi-Uda (directional ~9 dBi)',
    gainDbi: 9,
    description: 'Driven element + reflector + multiple directors. Forward gain at the cost of broadside and rear coverage. Point at the distant node — works wonders for one specific link, useless for omnidirectional mesh participation.',
    pattern: (a) => {
      // Approximate forward lobe peaking at 0°, falling off with cos^N
      const rad = (a * Math.PI) / 180;
      // Allow rear lobe at ~ -15 dB (front-to-back ratio)
      const front = Math.pow(Math.max(0, Math.cos(rad)), 4);
      const back = (1 - Math.cos(rad)) > 1.5 ? 0.05 : 0;
      const linear = front + back;
      if (linear <= 0) return -30;
      return 10 * Math.log10(linear * 3);
    },
  },
  {
    id: 'patch',
    name: 'Patch (~7 dBi, hemispherical)',
    gainDbi: 7,
    description: 'Flat panel that radiates into a front hemisphere. Good for mounting on a wall facing the area you care about. Effectively zero gain behind.',
    pattern: (a) => {
      const rad = (a * Math.PI) / 180;
      // Hemispherical, peak at 0°
      if (Math.cos(rad) < 0) return -30;
      const linear = Math.pow(Math.cos(rad), 2);
      if (linear === 0) return -30;
      return 10 * Math.log10(linear * 2.5);
    },
  },
];

function PatternsTab() {
  const [selectedId, setSelectedId] = useState('dipole-vplane');
  const selected = PATTERNS.find((p) => p.id === selectedId)!;

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Radiation patterns</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 13 }}>
            Antennas don't radiate equally in all directions — they have a shape. Pick a type to see where the energy goes. The further the curve is from the centre, the more gain in that direction.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
            <div>
              {PATTERNS.map((p) => (
                <button
                  key={p.id}
                  className={'convo-item' + (selectedId === p.id ? ' active' : '')}
                  onClick={() => setSelectedId(p.id)}
                >
                  <div className="convo-row">
                    <span className="convo-label">{p.name}</span>
                    <span className="convo-time">{p.gainDbi > 0 ? '+' : ''}{p.gainDbi} dBi</span>
                  </div>
                  <div className="convo-preview">{p.description.slice(0, 80)}…</div>
                </button>
              ))}
            </div>
            <div>
              <PolarPlot pattern={selected.pattern} maxGainDb={Math.max(selected.gainDbi + 3, 6)} />
              <div className="info-card" style={{ marginTop: 12 }}>
                <p style={{ margin: 0, fontSize: 13 }}><strong>{selected.name}</strong> · {selected.gainDbi > 0 ? '+' : ''}{selected.gainDbi} dBi peak</p>
                <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>{selected.description}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What you're looking at.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            These polar plots show <em>relative</em> gain in each direction. The outer edge = peak gain; the centre = no signal. Concentric rings are 10 dB steps. A circle is omnidirectional; a peanut is a dipole; a tear is a Yagi.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>The cost of directionality.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Every dB of forward gain on a directional antenna comes from energy <em>not</em> going elsewhere. A 9 dBi Yagi has ~14 dB less coverage behind it than a dipole would. For mesh participation (where you want to hear everyone), omnidirectional usually wins.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Vertical pattern matters more than you'd think.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            A high-gain collinear has a narrow vertical beam. If you live on a hill and most other nodes are below you, your signal goes <em>past</em> them. Sometimes a "lower-gain" antenna mounted lower performs better in practice.
          </p>
        </div>
      </div>
    </div>
  );
}

function PolarPlot({ pattern, maxGainDb }: { pattern: (a: number) => number; maxGainDb: number }) {
  const cx = 280, cy = 280, rMax = 240;
  const dynamicRangeDb = 30;
  const rFor = (gainDb: number) => {
    // Map gainDb so that maxGainDb → rMax and (maxGainDb - dynamicRangeDb) → 0
    const ratio = (gainDb - (maxGainDb - dynamicRangeDb)) / dynamicRangeDb;
    return Math.max(0, Math.min(1, ratio)) * rMax;
  };
  // Sample 360 points
  const points: string[] = [];
  for (let a = 0; a <= 360; a += 2) {
    const g = pattern(a);
    const r = rFor(g);
    const rad = ((a - 90) * Math.PI) / 180; // 0° = up
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  // Reference rings
  const rings: number[] = [];
  for (let g = maxGainDb; g > maxGainDb - dynamicRangeDb; g -= 10) {
    rings.push(g);
  }
  return (
    <svg viewBox="0 0 560 560" width="100%" style={{ background: 'var(--bg)', borderRadius: 8, maxHeight: 500 }}>
      {/* Rings */}
      {rings.map((g) => {
        const r = rFor(g);
        return <circle key={g} cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />;
      })}
      {rings.map((g) => {
        const r = rFor(g);
        return <text key={`l-${g}`} x={cx + 4} y={cy - r - 2} fontSize={10} fill="rgba(255,255,255,0.4)" fontFamily="ui-monospace">{g} dBi</text>;
      })}
      {/* Cardinal lines */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const rad = ((a - 90) * Math.PI) / 180;
        const x2 = cx + rMax * Math.cos(rad);
        const y2 = cy + rMax * Math.sin(rad);
        return <line key={a} x1={cx} y1={cy} x2={x2} y2={y2} stroke="rgba(255,255,255,0.05)" />;
      })}
      {/* Cardinal labels */}
      <text x={cx} y={20} textAnchor="middle" fontSize={11} fill="var(--text-faint)" fontFamily="ui-monospace">0°</text>
      <text x={cx} y={cy + rMax + 18} textAnchor="middle" fontSize={11} fill="var(--text-faint)" fontFamily="ui-monospace">180°</text>
      <text x={cx + rMax + 16} y={cy + 4} textAnchor="middle" fontSize={11} fill="var(--text-faint)" fontFamily="ui-monospace">90°</text>
      <text x={cx - rMax - 16} y={cy + 4} textAnchor="middle" fontSize={11} fill="var(--text-faint)" fontFamily="ui-monospace">270°</text>
      {/* Pattern */}
      <polygon points={points.join(' ')} fill="rgba(92,200,255,0.25)" stroke="#5cc8ff" strokeWidth={2} />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Polarization tab
// ─────────────────────────────────────────────────────────────────────

function PolarizationTab() {
  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Polarization</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 13 }}>
            Every LoRa antenna radiates a wave oriented in a specific direction in space. If your antenna is vertical and the other node's is horizontal, you lose ~<strong>20 dB</strong> — that's 99% of your signal. Polarization match is the cheapest performance lever, and stock Meshtastic antennas are <strong>vertical</strong>.
          </p>
          <PolarizationDiagram />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <div className="info-card" style={{ borderLeftColor: 'var(--good)' }}>
              <p style={{ margin: 0 }}><strong>Match (both vertical):</strong></p>
              <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>Full signal. No penalty.</p>
            </div>
            <div className="info-card" style={{ borderLeftColor: 'var(--warn)' }}>
              <p style={{ margin: 0 }}><strong>45° mismatch:</strong></p>
              <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>~3 dB loss. Half the signal strength.</p>
            </div>
            <div className="info-card" style={{ borderLeftColor: 'var(--bad)' }}>
              <p style={{ margin: 0 }}><strong>Cross-pol (90°):</strong></p>
              <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>~20 dB loss. <strong>99%</strong> of the signal gone.</p>
            </div>
            <div className="info-card">
              <p style={{ margin: 0 }}><strong>Circular ↔ linear:</strong></p>
              <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>~3 dB loss either direction.</p>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Why "carry your radio sideways" hurts.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Walking with a Meshtastic radio dangling sideways on a backpack? Your vertically-polarized antenna is now <em>horizontal</em>. Every other vertical-antenna node in the mesh loses 10–20 dB to you. The fix is free: keep the radio oriented so the antenna points up (or down).
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Tip jars: cross-polarised channels.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Some hams use circularly-polarised antennas on busy nets so neighbours' linear antennas only see ~3 dB loss in either orientation — better than the 20 dB cliff. It's a niche move for Meshtastic, but if you've got a single dominant local node, going circular on your end can level the playing field.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What about Yagis?</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Yagi elements are conductors — their polarization matches their orientation. Horizontal-mounted Yagi → horizontal polarization → 20 dB worse for talking to vertical omnis. Always match orientations.
          </p>
        </div>
      </div>
    </div>
  );
}

function PolarizationDiagram() {
  // Two antennas drawn left and right; an animated wave going between
  return (
    <svg viewBox="0 0 700 220" width="100%" style={{ background: 'var(--bg)', borderRadius: 6 }}>
      <defs>
        <linearGradient id="wave" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(92,200,255,0)" />
          <stop offset="50%" stopColor="rgba(92,200,255,0.7)" />
          <stop offset="100%" stopColor="rgba(92,200,255,0)" />
        </linearGradient>
      </defs>
      {/* TX antenna (vertical) */}
      <line x1={80} y1={50} x2={80} y2={190} stroke="#5cc8ff" strokeWidth={4} strokeLinecap="round" />
      <circle cx={80} cy={195} r={4} fill="#5cc8ff" />
      <text x={80} y={210} textAnchor="middle" fontSize={11} fill="var(--text-faint)" fontFamily="ui-monospace">TX (vertical)</text>
      {/* RX antenna (vertical, match) */}
      <line x1={620} y1={50} x2={620} y2={190} stroke="#66d39a" strokeWidth={4} strokeLinecap="round" />
      <circle cx={620} cy={195} r={4} fill="#66d39a" />
      <text x={620} y={210} textAnchor="middle" fontSize={11} fill="var(--text-faint)" fontFamily="ui-monospace">RX (vertical) → match</text>
      {/* Wave (vertical oscillation) */}
      <path d="M 120 120 Q 160 60 200 120 T 280 120 T 360 120 T 440 120 T 520 120 T 600 120"
            fill="none" stroke="url(#wave)" strokeWidth={2.5} />
      {/* Arrows for polarization plane */}
      <line x1={350} y1={80} x2={350} y2={160} stroke="rgba(255,209,102,0.7)" strokeWidth={1.5} markerEnd="url(#arrow)" />
      <line x1={350} y1={160} x2={350} y2={80} stroke="rgba(255,209,102,0.7)" strokeWidth={1.5} markerEnd="url(#arrow)" />
      <text x={365} y={125} fontSize={10} fill="var(--warn)" fontFamily="ui-monospace">E-field</text>
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="rgba(255,209,102,0.7)" />
        </marker>
      </defs>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Length calculator
// ─────────────────────────────────────────────────────────────────────

function LengthTab() {
  const C_M_PER_S = 299_792_458;
  const VELOCITY_FACTOR = 0.95; // wire antennas typically run at ~95% c
  const [freqMHz, setFreqMHz] = useState(915);

  const wavelengthM = (C_M_PER_S / (freqMHz * 1e6)) * VELOCITY_FACTOR;
  const quarter = wavelengthM / 4;
  const half = wavelengthM / 2;
  const fiveEighths = (wavelengthM * 5) / 8;
  const fullWave = wavelengthM;
  const threeQuarter = (wavelengthM * 3) / 4;

  const COMMON_FREQS = [
    { mhz: 433, label: '433 MHz (EU 433)' },
    { mhz: 868, label: '868 MHz (EU 868)' },
    { mhz: 915, label: '915 MHz (US/ANZ)' },
    { mhz: 920, label: '920 MHz (JP/KR/TW)' },
    { mhz: 2400, label: '2.4 GHz (LORA_24)' },
  ];

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Antenna physical length</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 13 }}>
            Quarter-wave is the most common DIY antenna for Meshtastic — just a piece of solid wire or rigid copper at exactly the right length. Use the 95% velocity factor below for typical insulated wire.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 10, alignItems: 'center', marginBottom: 14 }}>
            <label>Frequency (MHz)</label>
            <input type="number" className="text" value={freqMHz} onChange={(e) => setFreqMHz(Number(e.target.value) || 915)} />
            <label>Common bands</label>
            <div className="map-style-toggle">
              {COMMON_FREQS.map((f) => (
                <button key={f.mhz} className={'map-style-btn' + (freqMHz === f.mhz ? ' active' : '')} onClick={() => setFreqMHz(f.mhz)}>{f.mhz}</button>
              ))}
            </div>
          </div>
          <table className="data">
            <thead><tr><th>Antenna type</th><th>Length (mm)</th><th>Length (in)</th></tr></thead>
            <tbody>
              <tr><td>Quarter-wave whip (¼λ)</td><td style={{ fontFamily: 'var(--mono)' }}>{(quarter * 1000).toFixed(1)} mm</td><td style={{ fontFamily: 'var(--mono)' }}>{(quarter * 39.37).toFixed(2)} in</td></tr>
              <tr><td>Half-wave dipole (½λ, total length)</td><td style={{ fontFamily: 'var(--mono)' }}>{(half * 1000).toFixed(1)} mm</td><td style={{ fontFamily: 'var(--mono)' }}>{(half * 39.37).toFixed(2)} in</td></tr>
              <tr><td>5/8-wave whip</td><td style={{ fontFamily: 'var(--mono)' }}>{(fiveEighths * 1000).toFixed(1)} mm</td><td style={{ fontFamily: 'var(--mono)' }}>{(fiveEighths * 39.37).toFixed(2)} in</td></tr>
              <tr><td>Three-quarter wave</td><td style={{ fontFamily: 'var(--mono)' }}>{(threeQuarter * 1000).toFixed(1)} mm</td><td style={{ fontFamily: 'var(--mono)' }}>{(threeQuarter * 39.37).toFixed(2)} in</td></tr>
              <tr><td>Full wave (λ)</td><td style={{ fontFamily: 'var(--mono)' }}>{(fullWave * 1000).toFixed(1)} mm</td><td style={{ fontFamily: 'var(--mono)' }}>{(fullWave * 39.37).toFixed(2)} in</td></tr>
            </tbody>
          </table>
          <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--text-faint)' }}>
            Lengths shown use a 95% velocity factor (typical for insulated copper wire). Bare wire is closer to 98%; thicker rods (≥1/4" diameter) start losing accuracy at this simple scaling.
          </p>
        </div>
      </div>
      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>The cheapest LoRa upgrade in the world.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            A piece of <strong>{(quarter * 1000).toFixed(0)} mm</strong> of stiff copper wire soldered onto your U.FL pigtail will outperform many off-the-shelf "high gain" antennas at {freqMHz} MHz. Verify with a NanoVNA — VSWR should be {'<'} 2 across your band.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Velocity factor matters.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Electromagnetic waves travel slower in a conductor than in vacuum. The wavelength in your wire is shorter than the free-space wavelength by the velocity factor (0.90–0.98 depending on wire/coating). Cutting at full free-space ¼λ gives you an antenna tuned ~5% too high — usable but not optimal.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Why quarter-wave over half-wave?</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            A quarter-wave whip needs a ground plane (the radio's PCB or a counterpoise wire) to "see" the other half of itself electrically. A half-wave dipole is self-resonant and doesn't need a ground plane — but it's twice as long and harder to mount. For portable Meshtastic, quarter-wave wins.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Recommendations tab
// ─────────────────────────────────────────────────────────────────────

function RecommendTab() {
  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Recommendations by use case</h2>
          <Recommendation
            title="Portable / EDC"
            best="Stock antenna, plus a clip-on 1/4λ whip when you stop moving"
            why="Anything bigger snags on backpacks and breaks. Mount-where-it-points-up matters more than gain."
            range="1–3 km urban, 5–8 km open"
          />
          <Recommendation
            title="Home fixed install (router-class)"
            best="5/8-wave fiberglass omni on a 5–10 m mast, LMR-400 down to the radio"
            why="Antenna height swamps every other variable. A +6 dB antenna at 2 m underperforms a +0 dBi antenna at 10 m."
            range="10–30 km urban with LOS to other elevated nodes"
          />
          <Recommendation
            title="Mountaintop / repeater"
            best="Collinear vertical (6+ dBi) with cavity filter if other gear nearby"
            why="At elevation, free-space loss dominates — every dB of antenna gain converts to range. Filtering protects the SX1262 front-end from intermod with cellular."
            range="50–200 km LOS, depending on other-side antenna"
          />
          <Recommendation
            title="One known-direction long link"
            best="Yagi (9–14 dBi) on both ends, polarisation matched"
            why="If you need a specific point-to-point bridge (cabin → town), directional beats omni by an order of magnitude in range."
            range="20–80 km if mounted high on both ends"
          />
          <Recommendation
            title="Indoor / desk"
            best="External SMA whip on a 1 m extension cable, near a window"
            why="The cable lets you get the antenna away from your computer's RF noise and onto a windowsill — antenna location often beats antenna gain indoors."
            range="200 m – 2 km depending on building"
          />
          <Recommendation
            title="Vehicle"
            best="Magnetic-mount 1/4λ whip on the roof"
            why="The car body is a near-perfect ground plane. Don't waste money on tiny window-mount whips — they need to be on metal."
            range="2–8 km urban, 10–25 km rural"
          />
        </div>
      </div>
      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Where dB goes furthest.</strong></p>
          <ol style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)' }}>
            <li><strong>Height.</strong> Free. Get the antenna above local obstructions.</li>
            <li><strong>Polarization match.</strong> Free. Mount antennas vertical.</li>
            <li><strong>Better stock antenna.</strong> $20–$30 buys +3 dB.</li>
            <li><strong>Shorter / better coax.</strong> Especially if you're cabling far.</li>
            <li><strong>TX power.</strong> Diminishing returns; often EIRP-capped.</li>
          </ol>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Antenna height vs. gain — a real example.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            A +0 dBi antenna at 10 m AGL with a clear Fresnel zone consistently outperforms a +6 dBi antenna at 1.5 m AGL with foliage in the way. The horizon is closer than you think at antenna heights — 4 km at 1.5 m, 11 km at 10 m, 36 km at 100 m (just ground geometry, before LoRa range even enters the equation).
          </p>
        </div>
      </div>
    </div>
  );
}

function Recommendation({ title, best, why, range }: { title: string; best: string; why: string; range: string }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <div style={{ fontWeight: 500, fontSize: 14, color: 'var(--accent)', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}><strong>Best: </strong>{best}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 4 }}><strong>Why: </strong>{why}</div>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>typical range · {range}</div>
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="range-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
