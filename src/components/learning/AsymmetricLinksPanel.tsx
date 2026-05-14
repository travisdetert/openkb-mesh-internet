import React from 'react';
import type { TabId } from '../TopNav';
import { LearningModeBadge, LearningSeeAlso } from './LearningChrome';

/**
 * Learn-panel explainer for the most confusing real-world Meshtastic
 * situation: someone messages you, their app says it was acknowledged,
 * but you never see their node — sometimes for hours.
 *
 * Two distinct ideas are tangled together here. We separate them:
 *   1. Physical RF links can be one-way ("asymmetric"). One side hears
 *      the other but not vice-versa, for several specific reasons.
 *   2. "Acknowledged" in Meshtastic can mean three different things,
 *      only one of which proves the destination actually decoded the
 *      message.
 *
 * The aim is to give a user the language to diagnose this with their
 * friend instead of just saying "hmm, weird".
 */

interface Props {
  go: (id: TabId) => void;
}

export function AsymmetricLinksPanel({ go }: Props) {
  return (
    <div className="page">
      <h1 className="page-title">Acks &amp; Asymmetric Links</h1>
      <p className="page-sub">
        Your friend's app says the message was delivered. Hours later, you still don't see his node. What's actually happening — and what does "acknowledged" really mean?
      </p>
      <LearningModeBadge mode="offline" />

      <section className="discovery-section">
        <h2>1. The scenario</h2>
        <p>
          A friend brings a new radio over to your area. Within an hour his app shows your node in his node list, and he sends you a DM. His app shows the message <em>queued</em> and then <strong>acknowledged</strong>. Hours go by. You never see his node in your list, and his message never arrives in your chat.
        </p>
        <p>
          Two separate things are happening, and both are worth understanding.
        </p>
      </section>

      <section className="discovery-section">
        <h2>2. RF links aren't symmetric</h2>
        <p>
          A LoRa link works in each direction <strong>independently</strong>. The signal travelling from his radio to yours sees one set of physical conditions; the signal coming back sees another. For a link to be usable both ways, both directions have to close their own budget.
        </p>
        <AsymmetryDiagram />
        <p>
          Four common reasons one side hears the other but not vice-versa:
        </p>
        <ul style={{ paddingLeft: 20, lineHeight: 1.55, color: 'var(--text-dim)', fontSize: 13 }}>
          <li>
            <strong style={{ color: 'var(--text)' }}>TX power asymmetry.</strong>{' '}
            Default TX power varies by hardware and region — 17 dBm vs 22 dBm vs 30 dBm. A 5 dB advantage on one side roughly <code>1.8×</code> the reach in that direction.
          </li>
          <li>
            <strong style={{ color: 'var(--text)' }}>Antenna gain (counts twice).</strong>{' '}
            Antennas work for both transmit and receive. A 5 dBi whip versus a stock 2 dBi rubber duck is <code>+3 dB</code> in each direction — and since one antenna is at <em>each</em> end of the path, swapping just one rebalances both sides differently.
          </li>
          <li>
            <strong style={{ color: 'var(--text)' }}>Receiver noise floor.</strong>{' '}
            Sensitivity in dB is what you can decode <em>above the local noise floor</em>. A radio in an apartment next to a WiFi access point, a TV, or a switching power supply has a higher noise floor than one in the woods. The quieter side hears the noisier side just fine; the noisy side can't pick the quiet side out of the hash.
          </li>
          <li>
            <strong style={{ color: 'var(--text)' }}>Polarisation mismatch.</strong>{' '}
            Two antennas pointed 90° to each other lose ~20 dB. If one radio is lying flat on a desk and the other is mounted vertically, that's a huge handicap. (You can usually fix this with both at the same orientation.)
          </li>
        </ul>
        <p style={{ marginTop: 12 }}>
          So if your friend has a stronger TX, a better antenna, or a quieter RX environment, the "hear me but I can't hear you" situation is completely physical and completely normal.
        </p>
      </section>

      <section className="discovery-section">
        <h2>3. What "acknowledged" actually means</h2>
        <p>
          Meshtastic shows acks the same way for every kind of message, but there are <strong>three different mechanisms</strong> behind that single ✓ in the UI:
        </p>

        <div className="card" style={{ marginTop: 8, padding: 0 }}>
          <table className="data" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ width: 220 }}>Kind</th>
                <th style={{ width: 200 }}>What proves what</th>
                <th>Reliability</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong style={{ color: 'var(--accent)' }}>Implicit ack (broadcast)</strong><br/>
                  <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>Heard a neighbour retransmit your own packet.</span>
                </td>
                <td>At least <em>one</em> neighbour heard you and forwarded the packet.</td>
                <td style={{ color: 'var(--warn)' }}>Says nothing about whether the destination received it.</td>
              </tr>
              <tr>
                <td>
                  <strong style={{ color: 'var(--accent)' }}>Routing ack from destination</strong><br/>
                  <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>DM with <code>wantAck=true</code>, errorReason=NONE.</span>
                </td>
                <td>The destination decoded the message and sent a reply back through the mesh.</td>
                <td style={{ color: 'var(--good)' }}>This is the one that means delivered. Round-trip RF — must close both ways.</td>
              </tr>
              <tr>
                <td>
                  <strong style={{ color: 'var(--accent)' }}>Implicit ack (DM via relay)</strong><br/>
                  <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>Some firmware fakes an ack when a closer relay forwards.</span>
                </td>
                <td>A node <em>closer</em> to the destination forwarded the packet, but never confirmed the destination got it.</td>
                <td style={{ color: 'var(--warn)' }}>Looks identical to a real ack. This is the source of "but it said acked!" confusion.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p style={{ marginTop: 12 }}>
          <strong style={{ color: 'var(--text)' }}>"Queued"</strong> just means the firmware accepted the message into its TX queue. It's a local-app receipt, not a delivery receipt. The radio will try to send it on its next slot in the duty cycle.
        </p>
        <p>
          If your friend's <strong>only</strong> evidence is "queued and acknowledged" and you can't see his node at all, the most likely explanation is that <em>your radio</em> (or one within range of him) replied with a Routing ack on behalf of being the destination — but the packet then died on the way to your radio's actual decoder, or got there via a path that didn't add him to your nodeDB.
        </p>
      </section>

      <section className="discovery-section">
        <h2>4. Why don't you see his node?</h2>
        <p>
          Receiving a packet from a node <em>does</em> register that node number in your nodeDB — but its name and metadata don't appear until your radio receives a separate <code>NodeInfo</code> packet from it. That broadcast happens roughly every <strong>3 hours</strong> by default. If the path from his radio to yours can't carry a NodeInfo through the mesh (lossy relays, hop limit too short), you'll see "<code>!aabbccdd</code>" with no name — or nothing at all if even the relayed message path is blocked.
        </p>
        <p style={{ marginTop: 8 }}>
          The <strong>Node Discovery</strong> learn panel walks through this in detail with your own nodeDB as the live example.
        </p>
      </section>

      <section className="discovery-section">
        <h2>5. How to actually diagnose this</h2>
        <ol style={{ paddingLeft: 20, lineHeight: 1.6, color: 'var(--text-dim)' }}>
          <li>
            <strong style={{ color: 'var(--text)' }}>Have your friend "Poke the mesh".</strong>{' '}
            The button on the Nodes panel broadcasts his NodeInfo immediately with <code>wantResponse=true</code>. If the path from him to you exists at all, you'll get a NodeInfo within seconds — that's both his identity arriving in your nodeDB AND a reply from your radio that proves the link closes in your direction.
          </li>
          <li>
            <strong style={{ color: 'var(--text)' }}>Run a traceroute to him.</strong>{' '}
            If you can see him at all (even as a numeric ID), the Traceroute panel will draw the path. A traceroute that reaches him but never comes back is a textbook one-way link — proof of asymmetry.
          </li>
          <li>
            <strong style={{ color: 'var(--text)' }}>Compare TX power and antennas.</strong>{' '}
            Open Settings → LoRa on each of your radios. If one is at 17 dBm and the other is at 27 dBm, that's a 10 dB asymmetry — enough to make one side reach 3× further. The Link Budget learn panel does the math.
          </li>
          <li>
            <strong style={{ color: 'var(--text)' }}>Check the RSSI on his side, then yours.</strong>{' '}
            If he heard you at <code>-95 dBm</code> and you heard him at <code>-115 dBm</code> (when you eventually do), that 20 dB gap quantifies the asymmetry. You can use it to plan an antenna upgrade.
          </li>
          <li>
            <strong style={{ color: 'var(--text)' }}>Watch his next NodeInfo window.</strong>{' '}
            Firmware default cadence is ~3 hours. If you don't see him after 6+ hours despite him being active, the link is either fully one-way or only working intermittently. Antenna and elevation improvements are the usual fix.
          </li>
        </ol>
      </section>

      <section className="discovery-section">
        <h2>6. The short version</h2>
        <p>
          <strong style={{ color: 'var(--accent)' }}>"Acknowledged" in his app ≠ "decoded by your radio".</strong>{' '}
          And RF links are physical, not logical — they can be one-way. Use the Poke the mesh button to force a NodeInfo broadcast, run a traceroute, and compare both ends' TX power and antenna setups. Most "ghost" message problems come down to a few dB of asymmetry that an antenna swap quietly fixes.
        </p>
      </section>

      <LearningSeeAlso
        links={[
          { to: 'discovery',     label: 'Node Discovery',  blurb: 'How NodeInfo broadcasts populate your nodeDB.' },
          { to: 'link-budget',   label: 'Link Budget',     blurb: 'TX power → loss → sensitivity — the math behind "can they hear me".' },
          { to: 'mesh-routing',  label: 'Mesh Routing',    blurb: 'How relays carry messages further than a single hop.' },
          { to: 'traceroute',    label: 'Traceroute',      blurb: 'Visualise the actual path your packets are taking.' },
        ]}
        go={go}
      />
    </div>
  );
}

/**
 * Schematic showing two nodes with a one-way link — RF from A reaches B,
 * but B's response doesn't make it back to A. Stylised, not to scale.
 */
function AsymmetryDiagram() {
  return (
    <svg width="100%" viewBox="0 0 600 200" style={{ display: 'block', maxWidth: 720, margin: '12px auto', background: 'var(--bg-elev)', borderRadius: 6, border: '1px solid var(--line)' }}>
      {/* Node A — your friend, stronger setup */}
      <g>
        <rect x={50} y={70} width={90} height={60} rx={8} fill="rgba(102,211,154,0.10)" stroke="rgba(102,211,154,0.6)" />
        <text x={95} y={95} textAnchor="middle" fontSize={13} fill="rgba(230,232,238,0.95)" fontWeight={600}>Friend</text>
        <text x={95} y={114} textAnchor="middle" fontSize={10} fill="rgba(230,232,238,0.75)">22 dBm · 5 dBi</text>
        {/* antenna squiggle */}
        <line x1={95} y1={70} x2={95} y2={50} stroke="rgba(102,211,154,0.7)" strokeWidth={1.5} />
        <circle cx={95} cy={48} r={3} fill="rgba(102,211,154,0.9)" />
      </g>

      {/* Node B — you, weaker setup */}
      <g>
        <rect x={460} y={70} width={90} height={60} rx={8} fill="rgba(92,200,255,0.10)" stroke="rgba(92,200,255,0.6)" />
        <text x={505} y={95} textAnchor="middle" fontSize={13} fill="rgba(230,232,238,0.95)" fontWeight={600}>You</text>
        <text x={505} y={114} textAnchor="middle" fontSize={10} fill="rgba(230,232,238,0.75)">17 dBm · 2 dBi</text>
        <line x1={505} y1={70} x2={505} y2={55} stroke="rgba(92,200,255,0.7)" strokeWidth={1.5} />
        <circle cx={505} cy={53} r={3} fill="rgba(92,200,255,0.9)" />
      </g>

      {/* Forward arrow — solid green, "Friend → You: heard fine" */}
      <g>
        <line x1={145} y1={88} x2={455} y2={88} stroke="rgba(102,211,154,0.9)" strokeWidth={2} markerEnd="url(#arrow-good)" />
        <text x={300} y={80} textAnchor="middle" fontSize={11} fill="rgba(102,211,154,0.95)" fontWeight={600}>heard fine (−95 dBm)</text>
      </g>

      {/* Reverse arrow — dashed bad, "You → Friend: doesn't decode" */}
      <g>
        <line x1={455} y1={118} x2={145} y2={118} stroke="rgba(255,107,129,0.8)" strokeWidth={2} strokeDasharray="5 4" markerEnd="url(#arrow-bad)" />
        <text x={300} y={140} textAnchor="middle" fontSize={11} fill="rgba(255,107,129,0.95)" fontWeight={600}>too weak to decode</text>
      </g>

      {/* Caption */}
      <text x={300} y={175} textAnchor="middle" fontSize={11} fill="rgba(154,163,178,0.85)">
        Friend's signal reaches you. Yours doesn't reach him. The link is one-way until something rebalances.
      </text>

      <defs>
        <marker id="arrow-good" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={8} markerHeight={8} orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="rgba(102,211,154,0.9)" />
        </marker>
        <marker id="arrow-bad" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={8} markerHeight={8} orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,107,129,0.85)" />
        </marker>
      </defs>
    </svg>
  );
}
