import React, { useMemo, useState } from 'react';
import { listInstances } from '../concepts/registry';
import type { Instance } from '../concepts/schema';

type ScenarioId =
  | 'chat-100-msg-day'
  | 'sensor-1-min'
  | 'feed-refresh-hourly'
  | 'node-presence-50'
  | 'video-call-1hr';

interface Scenario {
  id: ScenarioId;
  name: string;
  description: string;
  bulkPlane: boolean; // true = video / files, where architecture barely matters
  // Returns bytes/day for a given architecture instance.
  bytesPerDay(arch: Instance): number;
  // What the user is actually doing, in plain English.
  payloadDescription: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'chat-100-msg-day',
    name: '100 chat messages per day (active group)',
    description: 'Small group chat — 100 messages flowing through one user per day, ~40 byte payloads.',
    bulkPlane: false,
    bytesPerDay: (a) => 100 * Number(a.bytes_chat_message ?? 0),
    payloadDescription: '100 × 40 bytes = 4 KB of actual content per day',
  },
  {
    id: 'sensor-1-min',
    name: 'Sensor reading every 60 seconds',
    description: 'A weather/IAQ sensor publishing 1440 readings per day, ~12 byte payloads each.',
    bulkPlane: false,
    bytesPerDay: (a) => 1440 * Number(a.bytes_sensor_reading ?? 0),
    payloadDescription: '1440 × 12 bytes = 17 KB of actual content per day',
  },
  {
    id: 'feed-refresh-hourly',
    name: 'Refresh a feed every hour for 12 hr',
    description: 'A user opens a news/social feed 12 times in a day. Each refresh re-renders the feed.',
    bulkPlane: false,
    bytesPerDay: (a) => 12 * Number(a.bytes_page_view ?? 0),
    payloadDescription: 'Real change in the feed per refresh: ~5 KB. The rest is restating things.',
  },
  {
    id: 'node-presence-50',
    name: '50 nodes, presence every 5 min',
    description: 'Operator monitoring a 50-node mesh. Each node beacons every 5 min.',
    bulkPlane: false,
    bytesPerDay: (a) => {
      const beaconsPerDayPerNode = (24 * 60) / 5;
      // Approximate using sensor-reading cost — small structured update.
      return 50 * beaconsPerDayPerNode * Number(a.bytes_sensor_reading ?? 0);
    },
    payloadDescription: '50 × 288 × 12 bytes = 173 KB of actual content per day',
  },
  {
    id: 'video-call-1hr',
    name: '1 hour of HD video call',
    description: 'A real-time HD video call. Listed for honesty: codec, not protocol, dominates.',
    bulkPlane: true,
    bytesPerDay: () => 1_000_000_000, // ~1 GB regardless of architecture
    payloadDescription: '~2 Mbit/s sustained for 1 hour = ~900 MB. Architecture barely matters here.',
  },
];

type Tab = 'scenarios' | 'details' | 'cost';

export function ComparePanel() {
  const architectures = useMemo(() => listInstances('architecture'), []);
  const [scenarioId, setScenarioId] = useState<ScenarioId>('chat-100-msg-day');
  const [tab, setTab] = useState<Tab>('scenarios');
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;

  const rows = useMemo(() => {
    const computed = architectures.map((a) => ({
      arch: a,
      bytes: scenario.bytesPerDay(a),
    }));
    const min = Math.min(...computed.map((r) => r.bytes).filter((b) => b > 0));
    return computed
      .map((r) => ({ ...r, ratio: r.bytes > 0 ? r.bytes / min : 0 }))
      .sort((a, b) => a.bytes - b.bytes);
  }, [architectures, scenario]);

  const minBytes = rows.length ? Math.min(...rows.map((r) => r.bytes).filter((b) => b > 0)) : 0;
  const maxBytes = rows.length ? Math.max(...rows.map((r) => r.bytes)) : 0;
  const reductionPct = maxBytes > 0 ? Math.round((1 - minBytes / maxBytes) * 100) : 0;

  return (
    <div className="page">
      <h1 className="page-title">Compare Architectures</h1>
      <p className="page-sub">
        Most internet traffic is the control plane restating things both sides already know. Pick a scenario and see how each architecture pays for it. The bulk plane (video, files) is listed for honesty — codec wins dominate there, not protocol wins.
      </p>

      <div className="subnav">
        <button className={'subnav-btn' + (tab === 'scenarios' ? ' active' : '')} onClick={() => setTab('scenarios')}>Scenarios</button>
        <button className={'subnav-btn' + (tab === 'details' ? ' active' : '')} onClick={() => setTab('details')}>
          Architectures {architectures.length > 0 && <span className="subnav-count">{architectures.length}</span>}
        </button>
        <button className={'subnav-btn' + (tab === 'cost' ? ' active' : '')} onClick={() => setTab('cost')}>Cost</button>
      </div>

      {tab === 'cost' && <CostTab scenario={scenario} architectures={architectures} setScenarioId={setScenarioId} scenarioId={scenarioId} />}

      {tab === 'scenarios' && (
      <div className="layout-split-wide">
        <div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Scenario</h2>
            <select
              className="text"
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value as ScenarioId)}
              style={{ width: '100%', maxWidth: 480, marginBottom: 8 }}
            >
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: 0 }}>{scenario.description}</p>
            <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 6, fontFamily: 'var(--mono)' }}>
              Payload signal: {scenario.payloadDescription}
            </p>
            {scenario.bulkPlane && (
              <div className="info-card" style={{ marginTop: 10 }}>
                <p style={{ margin: 0, fontSize: 12.5 }}>
                  <strong>Bulk plane.</strong> Video bytes are codec output — H.264, AV1, Opus. Re-architecting
                  the protocol around them gets you single-digit-percent savings at best. The interesting
                  protocol work is on the other 30% of traffic that isn't video.
                </p>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Wire bytes per day, by architecture</h2>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-faint)' }}>
                  <th style={{ padding: '6px 0' }}>Architecture</th>
                  <th>Bytes / day</th>
                  <th>Ratio vs best</th>
                  <th style={{ width: '40%' }}>Bar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.arch.ID} style={{ borderTop: '1px solid var(--border, rgba(255,255,255,0.06))' }}>
                    <td style={{ padding: '6px 12px 6px 0' }}>{String(r.arch.name)}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{fmtBytes(r.bytes)}</td>
                    <td style={{ fontFamily: 'var(--mono)' }}>{r.ratio === 1 ? '1×' : r.ratio === 0 ? '—' : `${r.ratio.toFixed(1)}×`}</td>
                    <td>
                      <div style={{
                        height: 10,
                        background: r.bytes === minBytes ? '#5cc8ff' : 'rgba(92,200,255,0.3)',
                        width: maxBytes > 0 ? `${(r.bytes / maxBytes) * 100}%` : '0%',
                        borderRadius: 3,
                      }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!scenario.bulkPlane && reductionPct > 0 && (
              <div className="info-card" style={{ marginTop: 12 }}>
                <p style={{ margin: 0 }}>
                  <strong>{reductionPct}% reduction</strong> from worst to best on this scenario. The wins come
                  from <em>not restating known state</em> — short-lived headers, persistent subscriptions, and
                  caching what's already on the wire.
                </p>
              </div>
            )}
          </div>

        </div>
      </div>
      )}

      {tab === 'details' && (
      <div className="layout-split-wide">
        <div>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>How each architecture pays</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              {architectures.map((a) => (
                <details key={a.ID} style={{ background: 'var(--bg)', borderRadius: 6, padding: 8 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                    {String(a.name)} — {fmtBytes(scenario.bytesPerDay(a))}/day
                  </summary>
                  <dl className="kv" style={{ marginTop: 8 }}>
                    <dt>Identity</dt><dd>{String(a.identity_model)}</dd>
                    <dt>Routing</dt><dd>{String(a.routing_primitive)}</dd>
                    <dt>State lives</dt><dd>{String(a.state_location)}</dd>
                    <dt>Cache</dt><dd>{String(a.caching_strategy)}</dd>
                    <dt>Encryption</dt><dd>{String(a.encryption_granularity)}</dd>
                    <dt>Interaction</dt><dd>{String(a.interaction_model)}</dd>
                    <dt>Survives partition</dt><dd>{a.survives_partition ? '✓' : '✗'}</dd>
                    <dt>Survives server loss</dt><dd>{a.survives_server_loss ? '✓' : '✗'}</dd>
                    <dt>Anonymous read</dt><dd>{a.allows_anonymous_read ? '✓' : '✗'}</dd>
                  </dl>
                  <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: '6px 0 0' }}>
                    <strong>Strengths:</strong> <span style={{ whiteSpace: 'pre-wrap' }}>{String(a.strengths)}</span>
                  </p>
                  <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: '6px 0 0' }}>
                    <strong>Tradeoffs:</strong> <span style={{ whiteSpace: 'pre-wrap' }}>{String(a.tradeoffs)}</span>
                  </p>
                </details>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>The two-tier insight</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: 0 }}>
              Today's internet pays the same protocol cost for "I want to know if anyone said anything" as for
              "send me this 4K video." That's the design error. The control plane should be event-based with
              minimal state restatement; the bulk plane stays roughly as it is. Two tiers, not one.
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>What "minimal" actually means</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: 0 }}>
              Not "smaller bytes." It means each transmission carries information the receiver doesn't already
              have. A position beacon sent every 5 min when the node hasn't moved is mostly waste. A
              well-designed system sends a delta only when there's a delta, plus a heartbeat saying "still
              alive, nothing changed."
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Where event-based loses</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: 0 }}>
              Pure event logs grow forever — you trade ongoing wire bytes for unbounded storage. Per-recipient
              encryption fights caching. Eventual consistency confuses users ("why didn't my message arrive?").
              And first-time joiners need a snapshot — pure events can't bootstrap them efficiently. Real
              systems mix events + periodic snapshots + compaction.
            </p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Why the classical web is sticky</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 12.5, margin: 0 }}>
              HTTP+JSON is universal because it's hostile-network-tolerant — proxies, NATs, firewalls, and
              middleboxes all understand it. Every alternative architecture loses that for a long time before
              ecosystems catch up. The migration path is per-application: replace control planes one at a
              time, leave the bulk plane on HTTP for now.
            </p>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Cost tab
// ─────────────────────────────────────────────────────────────────────

interface ArchitectureCost {
  archId: string;
  archName: string;
  monthlyUsd: number;
  setup: string;
  notes: string;
}

function CostTab({ scenario, architectures, scenarioId, setScenarioId }: {
  scenario: Scenario;
  architectures: Instance[];
  scenarioId: ScenarioId;
  setScenarioId: (s: ScenarioId) => void;
}) {
  const costs: ArchitectureCost[] = useMemo(() => {
    const bytesPerDay = (a: Instance) => scenario.bytesPerDay(a);
    return architectures.map((a) => {
      const id = String(a.ID);
      const name = String(a.name);
      const bpd = bytesPerDay(a);
      const mbPerMonth = (bpd * 30) / (1024 * 1024);
      let monthlyUsd = 0;
      let setup = '';
      let notes = '';

      // Architecture-specific cost models (best-effort)
      if (id.includes('mesh') || id.includes('reticulum')) {
        monthlyUsd = 0;
        setup = '$30–$120 once for a Meshtastic node';
        notes = 'No ongoing fees. The mesh is the infrastructure.';
      } else if (id.includes('lorawan')) {
        monthlyUsd = 0;
        setup = '$50 device + free TTN community gateway, or $30/mo for paid network';
        notes = 'TTN free tier limits messages/day. Commercial plans price per message.';
      } else if (id.includes('cellular') || id.includes('lte') || id.includes('5g')) {
        monthlyUsd = Math.max(15, mbPerMonth * 0.05);
        setup = '$0 device + carrier plan';
        notes = `${mbPerMonth.toFixed(1)} MB/month would cost ~$${monthlyUsd.toFixed(0)} on prepaid plans. Most plans charge for minimum data tier even if you use less.`;
      } else if (id.includes('satellite') || id.includes('sat') || id.includes('iridium') || id.includes('starlink')) {
        monthlyUsd = 50 + (mbPerMonth * 0.10);
        setup = '$200–$500 terminal + $50–$150/mo minimum';
        notes = `Starlink ~$50/mo flat, Iridium Short Burst ~$15/month + $1/kilobyte (very expensive for chat).`;
      } else if (id.includes('http') || id.includes('classical') || id.includes('rest')) {
        monthlyUsd = mbPerMonth < 100 ? 5 : 20;
        setup = '$0 (uses existing internet)';
        notes = 'Implicit cost = your existing home/mobile internet. Negligible marginal for typical chat.';
      } else if (id.includes('p2p') || id.includes('libp2p') || id.includes('matrix')) {
        monthlyUsd = 0;
        setup = '$0 (uses existing internet)';
        notes = 'Federated/P2P: free to use; someone is bandwidth-hosting somewhere (often you, eventually).';
      } else {
        monthlyUsd = 0;
        setup = 'unknown';
        notes = '';
      }
      return { archId: id, archName: name, monthlyUsd, setup, notes };
    });
  }, [scenario, architectures]);

  return (
    <div className="layout-split-wide">
      <div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Monthly cost per architecture, for this scenario</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--text-dim)', fontSize: 13 }}>
            Scenario: <strong>{scenario.name}</strong>. {scenario.description} ({scenario.payloadDescription}.)
          </p>
          <select className="text" value={scenarioId} onChange={(e) => setScenarioId(e.target.value as ScenarioId)} style={{ width: '100%', maxWidth: 480, marginBottom: 14 }}>
            {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <table className="data">
            <thead>
              <tr>
                <th>Architecture</th>
                <th>Setup cost</th>
                <th>Monthly</th>
                <th>10-year total</th>
              </tr>
            </thead>
            <tbody>
              {costs.sort((a, b) => a.monthlyUsd - b.monthlyUsd).map((c) => (
                <tr key={c.archId}>
                  <td>
                    <div style={{ color: 'var(--accent)' }}>{c.archName}</div>
                    {c.notes && <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{c.notes}</div>}
                  </td>
                  <td style={{ fontSize: 11.5 }}>{c.setup}</td>
                  <td style={{ fontFamily: 'var(--mono)', color: c.monthlyUsd === 0 ? 'var(--good)' : c.monthlyUsd > 50 ? 'var(--bad)' : 'var(--warn)' }}>
                    {c.monthlyUsd === 0 ? '$0' : `~$${c.monthlyUsd.toFixed(0)}`}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)' }}>
                    {c.monthlyUsd === 0 ? '~$0' : `$${(c.monthlyUsd * 120).toFixed(0)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>Reading this table.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Mesh/Reticulum are free recurring because the mesh <em>is</em> the infrastructure. Cellular and satellite price per MB or per device; their setup is low but monthly bills compound. Classical HTTP is implicitly subsidised by your existing internet plan — fine for chat scale, brutal for streaming-density services.
          </p>
        </div>
      </div>
      <div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>The 10-year column matters.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            Cellular at $20/mo = $2400 over a decade. Iridium at $150/mo = $18,000. A $80 Meshtastic node has paid for itself within a month of replacing either. For chat-density traffic the mesh wins every time-discount calculation; for bulk media (the bulk-plane scenarios), neither mesh nor sat make sense.
          </p>
        </div>
        <div className="info-card">
          <p style={{ margin: 0 }}><strong>What the table can't show.</strong></p>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>
            <em>Reliability.</em> Cellular and satellite have 99.9% uptime per provider SLA; mesh has whatever-uptime your neighbors give you. <em>Reach.</em> Cellular covers a continent; a mesh covers your line-of-sight. <em>Latency.</em> Cellular is sub-second; multi-hop mesh is seconds. Cost is one axis; pick the right architecture for what you actually need.
          </p>
        </div>
      </div>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n === 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
