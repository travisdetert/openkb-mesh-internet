import React, { useEffect, useMemo, useRef, useState } from 'react';
import { listInstances } from '../../concepts/registry';
import type { Instance } from '../../concepts/schema';

type Tab = 'chirp' | 'compare' | 'math';

export function LoRaCssPanel({ state }: { state?: ConnectionState }) {
  const cssModulations = useMemo(
    () => listInstances('modulation').filter((m) => m.scheme === 'CSS'),
    [],
  );
  const activePresetName = state?.loraConfig?.usePreset ? state.loraConfig.modemPresetName : undefined;
  const initialPreset = activePresetName
    ? cssModulations.find((m) => String(m.ID).toLowerCase() === activePresetName.toLowerCase())?.ID ?? cssModulations[0]?.ID
    : cssModulations[0]?.ID;
  const [presetId, setPresetId] = useState(initialPreset ?? 'LongFast');
  const [tab, setTab] = useState<Tab>('chirp');

  const preset: Instance = cssModulations.find((m) => m.ID === presetId) ?? cssModulations[0];

  if (!preset) {
    return <div className="page"><p>No CSS modulation instances found.</p></div>;
  }

  return (
    <div className="page">
      <h1 className="page-title">LoRa Chirp Spread Spectrum</h1>
      <p className="page-sub">
        LoRa doesn't transmit at one frequency — it sweeps. Each symbol is a chirp that ramps from low to high frequency across the channel. That sweep is what gives LoRa its absurd sensitivity and immunity to interference.
      </p>

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'chirp' ? ' active' : '')} onClick={() => setTab('chirp')}>Chirp</button>
        <button className={'subnav-btn' + (tab === 'compare' ? ' active' : '')} onClick={() => setTab('compare')}>
          Compare presets
          {cssModulations.length > 0 && <span className="subnav-count">{cssModulations.length}</span>}
        </button>
        <button className={'subnav-btn' + (tab === 'math' ? ' active' : '')} onClick={() => setTab('math')}>Math</button>
      </div>

      {tab === 'chirp' && <ChirpTab preset={preset} cssModulations={cssModulations} presetId={presetId} setPresetId={setPresetId} />}
      {tab === 'compare' && <CompareTab cssModulations={cssModulations} presetId={presetId} setPresetId={setPresetId} activePresetName={activePresetName} />}
      {tab === 'math' && <MathTab activePresetName={activePresetName} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Chirp tab — existing single-preset visualization
// ─────────────────────────────────────────────────────────────────────

function ChirpTab({ preset, cssModulations, presetId, setPresetId }: { preset: Instance; cssModulations: Instance[]; presetId: string; setPresetId: (s: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawChirp(ctx, c.width, c.height, Number(preset.sf), Number(preset.bw));
  }, [presetId, preset]);

  const sf = Number(preset.sf);
  const bw = Number(preset.bw);
  const cr = Number(preset.cr);
  const sensitivity = Number(preset.sensitivity_dbm);
  const bitrate = Number(preset.bitrate_bps);
  const airtime = Number(preset.airtime_sec_50byte);

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pick a preset, see the chirp</h2>
          <select className="text" value={presetId} onChange={(e) => setPresetId(e.target.value)} style={{ marginBottom: 12, maxWidth: 320 }}>
            {cssModulations.map((m) => (
              <option key={m.ID} value={m.ID}>{String(m.label ?? m.name)}</option>
            ))}
          </select>
          <canvas ref={canvasRef} width={900} height={260} style={{ width: '100%', height: 260, display: 'block', background: 'var(--bg)', borderRadius: 6 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--mono)', marginTop: 4 }}>
            <span>0 Hz</span>
            <span>time →</span>
            <span>{(bw / 1000).toFixed(0)} kHz</span>
          </div>
        </div>

        <div className="card">
          <h2>What changes with each parameter</h2>
          <div className="range-grid">
            <Stat label="Spreading factor" value={`SF${sf}`} hint={`Each symbol carries ${sf} bits, takes 2^${sf} chips`} />
            <Stat label="Bandwidth" value={`${bw / 1000} kHz`} hint="How wide the chirp sweeps" />
            <Stat label="Coding rate" value={`4/${cr}`} hint={`${cr - 4} parity bits per 4 data bits`} />
            <Stat label="Sensitivity" value={`${sensitivity} dBm`} hint="Lower (more negative) = better" />
            <Stat label="Bitrate" value={`${bitrate.toLocaleString()} bps`} hint="Effective payload rate" />
            <Stat label="Airtime (50-byte msg)" value={`${airtime.toFixed(2)} s`} hint="Time on air per packet" />
          </div>
        </div>

        <div className="info-card">
          <p><strong>Reading the chirp.</strong> Each diagonal line is one symbol. Steeper slope = shorter symbol = more bits per second but less time for the receiver to integrate signal. The receiver multiplies the incoming chirp by an inverse chirp ("dechirp"), which collapses the signal to a single tone whose frequency tells you the symbol value. This is why LoRa can decode 20 dB <em>below</em> the noise floor — the chirp acts as a matched filter.</p>
        </div>
      </div>

      <div>
        <div className="card">
          <h3>The fundamental tradeoff</h3>
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12.5 }}>
            Going from <strong>SF7</strong> to <strong>SF12</strong>:
          </p>
          <ul style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-dim)', paddingLeft: 16 }}>
            <li>Sensitivity improves by ~15 dB (≈ 5× the range)</li>
            <li>Time on air goes up ~32×</li>
            <li>Battery use per packet goes up ~32×</li>
            <li>Channel capacity collapses — only one node can talk at a time, and they take much longer</li>
          </ul>
          <p style={{ marginTop: 8, color: 'var(--text-faint)', fontSize: 11.5 }}>
            That's why LongSlow is great for one balloon over Texas — and terrible for a city of 50 nodes.
          </p>
        </div>

        <div className="info-card">
          <p><strong>Why slower = farther.</strong></p>
          <p style={{ marginBottom: 0 }}>Each chirp carries energy proportional to its duration. Doubling the spreading factor doubles the time the receiver integrates signal, halves the noise contribution, and gains 3 dB of sensitivity. Slow == loud, in receiver terms.</p>
        </div>

        <div className="card">
          <h3>The 1% airtime rule</h3>
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12.5 }}>
            EU regions cap each device at 1% airtime per hour on most sub-bands — that's 36 seconds of total transmission. On LongSlow, that's ~6 fifty-byte messages per hour. On ShortFast, it's ~280. Preset choice has direct legal consequences in EU868.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Compare tab — preset bar chart (extracted from previous bottom)
// ─────────────────────────────────────────────────────────────────────

function CompareTab({ cssModulations, presetId, setPresetId, activePresetName }: { cssModulations: Instance[]; presetId: string; setPresetId: (s: string) => void; activePresetName?: string }) {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Side-by-side: every preset</h2>
      <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 12.5 }}>
        Each row visualises the trade-off. Sensitivity bar is "how weak a signal can I decode" — longer is better. Throughput, airtime, range, and msgs/hour are all derived from SF / BW / CR.
      </p>
      <PresetCompare presets={cssModulations} activeId={presetId} activePresetName={activePresetName} onSelect={setPresetId} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Math tab — interactive SF / BW / CR with live derivations
// ─────────────────────────────────────────────────────────────────────

function MathTab({ activePresetName }: { activePresetName?: string }) {
  const [sf, setSf] = useState(11);
  const [bwKhz, setBwKhz] = useState(250);
  const [cr, setCr] = useState(5);

  const bw = bwKhz * 1000;
  // Symbol time = 2^SF / BW seconds
  const symbolTimeMs = (Math.pow(2, sf) / bw) * 1000;
  const symbolRate = bw / Math.pow(2, sf);
  // Raw bitrate (uncoded): SF * symbol rate
  const rawBitrate = sf * symbolRate;
  // Coded bitrate: raw * 4/CR
  const codedBitrate = rawBitrate * (4 / cr);
  // Sensitivity ≈ -174 + 10*log10(BW) + NF + SNR_thresh
  const NF = 6; // dB noise figure for SX1262
  const snrThreshold: Record<number, number> = { 7: -7.5, 8: -10, 9: -12.5, 10: -15, 11: -17.5, 12: -20 };
  const snr = snrThreshold[sf] ?? -7.5;
  const sensitivity = -174 + 10 * Math.log10(bw) + NF + snr;
  // Airtime estimate for 50-byte payload (Semtech AN1200.13 formula, simplified)
  const preambleSymbols = 8 + 4.25; // standard + sync
  const lowDataRateOptimize = (symbolTimeMs > 16) ? 1 : 0; // toggle for slow rates
  const ceilingNumerator = 8 * 50 - 4 * sf + 28 + 16 - 20 * 0; // assuming CRC on, header on
  const ceilingDenominator = 4 * (sf - 2 * lowDataRateOptimize);
  const payloadSymbols = 8 + Math.max(0, Math.ceil(ceilingNumerator / ceilingDenominator) * cr);
  const totalSymbols = preambleSymbols + payloadSymbols;
  const airtimeMs = totalSymbols * symbolTimeMs;
  const airtimeSec = airtimeMs / 1000;
  // EU 1% duty-cycle messages per hour
  const msgsPerHrEU = 36 / airtimeSec;
  // Free-space range with assumed link budget at 915 MHz, 17 dBm TX, 2.5 dBi gain each side
  const linkBudget = 17 + 2.5 + 2.5 - 1 - sensitivity; // dB
  const rangeKm = Math.pow(10, (linkBudget - 32.44 - 20 * Math.log10(915)) / 20);

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Slide the LoRa parameters, watch the numbers move</h2>
          <p style={{ margin: '0 0 16px', color: 'var(--text-dim)', fontSize: 13 }}>
            Every modem preset is just three numbers: spreading factor, bandwidth, coding rate. From those three, every other LoRa property is computable — sensitivity, airtime, bitrate, theoretical range, even how many messages you can legally send per hour in EU868.
          </p>

          <Row label={`Spreading factor: SF${sf}`} hint="Each symbol carries SF bits via 2^SF chips. Higher = more sensitivity, longer airtime.">
            <input type="range" min={7} max={12} step={1} value={sf} onChange={(e) => setSf(Number(e.target.value))} style={{ width: '100%' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
              <span>SF7 fastest</span><span>SF12 slowest</span>
            </div>
          </Row>

          <Row label={`Bandwidth: ${bwKhz} kHz`} hint="Wider = faster chirp = more bits/sec but worse sensitivity.">
            <div className="map-style-toggle">
              {[62.5, 125, 250, 500].map((v) => (
                <button key={v} className={'map-style-btn' + (bwKhz === v ? ' active' : '')} onClick={() => setBwKhz(v)}>{v}</button>
              ))}
            </div>
          </Row>

          <Row label={`Coding rate: 4/${cr}`} hint="Higher CR = more error correction parity bits = lower effective throughput.">
            <input type="range" min={5} max={8} step={1} value={cr} onChange={(e) => setCr(Number(e.target.value))} style={{ width: '100%' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
              <span>4/5 light FEC</span><span>4/8 heavy FEC</span>
            </div>
          </Row>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Derived</h2>
          <div className="range-grid">
            <Stat label="Symbol time" value={`${symbolTimeMs.toFixed(2)} ms`} hint={`= 2^${sf} / ${bwKhz}k Hz`} />
            <Stat label="Symbol rate" value={`${symbolRate.toFixed(0)} sym/s`} hint="How many symbols you send per second" />
            <Stat label="Raw bitrate" value={`${(rawBitrate / 1000).toFixed(2)} kbps`} hint="Uncoded — SF × symbol rate" />
            <Stat label="Coded bitrate" value={`${(codedBitrate / 1000).toFixed(2)} kbps`} hint="Effective — raw × 4/CR" />
            <Stat label="Sensitivity" value={`${sensitivity.toFixed(0)} dBm`} hint="Theoretical: −174 + 10·log₁₀(BW) + NF + SNR" />
            <Stat label="Airtime (50 B)" value={`${airtimeSec.toFixed(2)} s`} hint="Semtech AN1200.13 formula, simplified" />
            <Stat label="Msgs / hr @ 1% duty" value={`${msgsPerHrEU.toFixed(1)}`} hint="EU868 legal cap" />
            <Stat label="LOS range (915 MHz)" value={`${rangeKm.toFixed(1)} km`} hint="17 dBm TX, 2.5 dBi each side, 1 dB feedline" />
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>The formulas</h2>
          <pre style={{ background: 'var(--bg)', padding: 12, borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12, margin: 0, lineHeight: 1.6 }}>
{`Symbol time:       T_sym = 2^SF / BW                       seconds
Symbol rate:       R_sym = BW / 2^SF                       symbols/sec
Raw bitrate:       R_raw = SF · R_sym                      bits/sec
Coded bitrate:     R_b   = R_raw · 4/CR                    bits/sec
Sensitivity:       S     = -174 + 10·log₁₀(BW) + NF + SNR  dBm
   ·NF (noise figure) ≈ 6 dB for SX1262
   ·SNR by SF: 7→-7.5, 8→-10, 9→-12.5, 10→-15, 11→-17.5, 12→-20
Airtime (n payload bytes):
   T_pkt = (n_pre + n_pay) · T_sym
   n_pre = 8 + 4.25
   n_pay = 8 + max(0, ⌈(8·PL − 4·SF + 28 + 16 − 20·H) / (4·(SF − 2·DE))⌉ · CR)`}
          </pre>
        </div>
      </div>

      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Why -174?</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            That's the thermal noise floor in 1 Hz of bandwidth at room temperature: <code>kTB = -174 dBm/Hz</code>. Widen the bandwidth and you let in more noise — that's why ShortTurbo (500 kHz) has the worst sensitivity even at SF7.
          </p>
        </div>

        <div className="info-card">
          <p style={{ margin: 0 }}><strong>The SNR threshold is what makes LoRa magic.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            At SF12 the receiver can decode at <strong>SNR = -20 dB</strong> — meaning the signal is 100× <em>weaker</em> than the noise. The chirp-spreading process acts as a matched filter that integrates signal energy over the entire 2^SF chip period. Bandwidth widens noise; spreading collapses it.
          </p>
        </div>

        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What the sliders are showing you.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Going SF7 → SF12 at fixed 250 kHz BW: sensitivity improves 12.5 dB (≈ 4× range), airtime grows 32×, throughput drops 32×. There is no preset that's good at everything — Meshtastic picks LongFast (SF11/250k) as the default because it lands in the sweet spot for typical multi-node use.
          </p>
        </div>

        <div className="info-card" style={{ borderLeftColor: 'var(--warn)' }}>
          <p style={{ margin: 0 }}><strong>Heads up: these are theoretical.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Real LoRa modems land within 1–2 dB of these sensitivity numbers under ideal conditions. Real range is much shorter than the LOS row above — the Coverage panel measures your actual environment's path-loss exponent.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared components
// ─────────────────────────────────────────────────────────────────────

function PresetCompare({
  presets, activeId, activePresetName, onSelect,
}: {
  presets: Instance[]; activeId: string; activePresetName?: string; onSelect: (id: string) => void;
}) {
  const sensVals = presets.map((p) => Number(p.sensitivity_dbm));
  const bitVals  = presets.map((p) => Number(p.bitrate_bps));
  const airVals  = presets.map((p) => Number(p.airtime_sec_50byte));
  const sensBest = Math.min(...sensVals);
  const sensWorst = Math.max(...sensVals);
  const bitBest = Math.max(...bitVals);
  const airWorst = Math.max(...airVals);
  const relRange = (sens: number) => Math.pow(10, (sensWorst - sens) / 20);
  const rangeMax = relRange(sensBest);
  return (
    <div className="preset-compare">
      <div className="preset-compare-head">
        <div className="preset-name">Preset</div>
        <div>SF·BW·CR</div>
        <div>Sensitivity (lower = better)</div>
        <div>Throughput</div>
        <div>Airtime / 50 B</div>
        <div>Rel. range</div>
        <div>Msgs/hr (1% duty)</div>
      </div>
      {presets
        .slice()
        .sort((a, b) => Number(b.airtime_sec_50byte) - Number(a.airtime_sec_50byte))
        .map((p) => {
          const sens = Number(p.sensitivity_dbm);
          const bps  = Number(p.bitrate_bps);
          const air  = Number(p.airtime_sec_50byte);
          const sensBar = (sensWorst - sens) / (sensWorst - sensBest);
          const bitBar  = bps / bitBest;
          const airBar  = air / airWorst;
          const range   = relRange(sens);
          const rangeBar = range / rangeMax;
          const msgsPerHr = 36 / air;
          const isActive = p.ID === activeId;
          const isLive = activePresetName && String(p.ID).toLowerCase() === activePresetName.toLowerCase();
          return (
            <div
              key={p.ID}
              className={'preset-compare-row' + (isActive ? ' active' : '') + (isLive ? ' live' : '')}
              onClick={() => onSelect(String(p.ID))}
            >
              <div className="preset-name">
                {String(p.label ?? p.name)}
                {isLive && <span className="preset-live-tag">live</span>}
              </div>
              <div className="preset-meta">SF{String(p.sf)} · {Number(p.bw) / 1000}k · 4/{String(p.cr)}</div>
              <Bar value={sensBar} label={`${sens} dBm`} tone="good" />
              <Bar value={bitBar}  label={fmtBps(bps)}    tone="accent" />
              <Bar value={airBar}  label={`${air.toFixed(2)}s`} tone="warn" inverted />
              <Bar value={rangeBar} label={`${range.toFixed(1)}×`} tone="good" />
              <Bar value={Math.min(1, msgsPerHr / 600)} label={`${msgsPerHr < 10 ? msgsPerHr.toFixed(1) : Math.round(msgsPerHr)}`} tone="dim" />
            </div>
          );
        })}
    </div>
  );
}

function Bar({ value, label, tone, inverted = false }: { value: number; label: string; tone: 'good' | 'warn' | 'accent' | 'dim'; inverted?: boolean }) {
  const colors = { good: 'var(--good)', warn: 'var(--warn)', accent: 'var(--accent)', dim: 'var(--text-faint)' };
  return (
    <div className="preset-bar-cell">
      <div className="preset-bar">
        <div
          className={'preset-bar-fill' + (inverted ? ' inverted' : '')}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: colors[tone] }}
        />
      </div>
      <div className="preset-bar-label">{label}</div>
    </div>
  );
}

function fmtBps(bps: number): string {
  if (bps >= 1000) return `${(bps / 1000).toFixed(1)} kbps`;
  return `${bps} bps`;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 }}>{hint}</div>}
      {children}
    </div>
  );
}

function drawChirp(ctx: CanvasRenderingContext2D, w: number, h: number, sf: number, _bw: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 8; i++) {
    const y = (i * h) / 8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const symbolsToDraw = 4;
  const symbolWidth = w / symbolsToDraw;
  for (let s = 0; s < symbolsToDraw; s++) {
    const offsetFrac = (s * 0.27) % 1;
    ctx.strokeStyle = '#5cc8ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const samples = 200;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const fNorm = (offsetFrac + t) % 1;
      const x = s * symbolWidth + t * symbolWidth;
      const y = h - fNorm * h * 0.95 - h * 0.025;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      if (fNorm + (1 / samples) > 1 && i < samples) {
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, h - h * 0.025);
      }
    }
    ctx.stroke();
    if (s < symbolsToDraw - 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo((s + 1) * symbolWidth, 0);
      ctx.lineTo((s + 1) * symbolWidth, h);
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '11px ui-monospace';
  ctx.fillText(`SF${sf} — ${symbolsToDraw} symbols, each carrying ${sf} bits`, 8, 16);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="range-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
