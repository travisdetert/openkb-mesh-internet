import React from 'react';

export type TabId =
  | 'home'
  | 'connect'
  | 'settings'
  | 'mqtt'
  | 'channels'
  | 'nodes'
  | 'map'
  | 'chat'
  | 'telemetry'
  | 'traceroute'
  | 'delivery'
  | 'sniffer'
  | 'discovery'
  | 'asymmetric-links'
  | 'peer-check'
  | 'link-budget'
  | 'rssi-distance'
  | 'coverage'
  | 'antennas'
  | 'lora'
  | 'mesh-routing'
  | 'reality'
  | 'expectations'
  | 'compare'
  | 'radio-compare'
  | 'link-test'
  | 'health'
  | 'device-lab'
  | 'firmware'
  | 'events'
  | 'concepts'
  | 'devices'
  | 'antennas-db';

/** Sidebar grouping. After this got dense enough to be confusing we split
 *  it into seven buckets:
 *    setup       — get a radio configured and online
 *    use         — what's happening on the mesh right now
 *    diagnose    — why isn't the mesh doing what I expect
 *    tools       — device-level / developer tooling (Device Lab, Firmware)
 *    mechanics   — concept + diagnostic Learn panels (physics, protocol)
 *    planning    — higher-level "should I use this for X" Learn panels
 *    reference   — catalog + glossary
 */
export type TabGroup = 'setup' | 'use' | 'diagnose' | 'tools' | 'mechanics' | 'planning' | 'reference';

export interface Tab {
  id: TabId;
  label: string;
  group: TabGroup;
}

export const TABS: Tab[] = [
  { id: 'home',         label: 'Home',           group: 'setup' },
  { id: 'connect',      label: 'Connect',        group: 'setup' },
  { id: 'settings',     label: 'Settings',       group: 'setup' },
  { id: 'mqtt',         label: 'MQTT',           group: 'setup' },
  { id: 'channels',     label: 'Channels',       group: 'setup' },
  { id: 'nodes',        label: 'Nodes',          group: 'use' },
  { id: 'map',          label: 'Map',            group: 'use' },
  { id: 'chat',         label: 'Chat',           group: 'use' },
  { id: 'telemetry',    label: 'Telemetry',      group: 'use' },
  { id: 'events',       label: 'Event Feed',     group: 'use' },
  { id: 'health',       label: 'Mesh Health',    group: 'diagnose' },
  { id: 'radio-compare', label: 'Compare Radios', group: 'diagnose' },
  { id: 'link-test',    label: 'Link Test',      group: 'diagnose' },
  { id: 'delivery',     label: 'Delivery',       group: 'diagnose' },
  { id: 'peer-check',   label: 'Peer Check',     group: 'diagnose' },
  { id: 'traceroute',   label: 'Traceroute',     group: 'diagnose' },
  { id: 'sniffer',      label: 'Packet Sniffer', group: 'diagnose' },
  // Five "learn" panels that consume live mesh data — they really belong
  // with the diagnostic tools because that's how people will reach for
  // them. Their educational framing stays in the panel itself; pure-concept
  // primers can live alongside them in Mechanics if we want.
  { id: 'discovery',     label: 'Node Discovery',   group: 'diagnose' },
  { id: 'link-budget',   label: 'Link Budget',      group: 'diagnose' },
  { id: 'rssi-distance', label: 'RSSI vs Distance', group: 'diagnose' },
  { id: 'coverage',      label: 'Coverage',         group: 'diagnose' },
  { id: 'mesh-routing',  label: 'Mesh Routing',     group: 'diagnose' },
  { id: 'device-lab',   label: 'Device Lab',     group: 'tools' },
  { id: 'firmware',     label: 'Firmware',       group: 'tools' },
  { id: 'asymmetric-links',  label: 'Acks & Asymmetry', group: 'mechanics' },
  { id: 'antennas',          label: 'Antennas',         group: 'mechanics' },
  { id: 'lora',              label: 'LoRa CSS',         group: 'mechanics' },
  { id: 'reality',      label: 'Reality Check',  group: 'planning' },
  { id: 'expectations', label: 'Expectations',   group: 'planning' },
  { id: 'compare',      label: 'Compare',        group: 'planning' },
  { id: 'devices',      label: 'Device DB',      group: 'reference' },
  { id: 'antennas-db',  label: 'Antenna DB',     group: 'reference' },
  { id: 'concepts',     label: 'Concepts',       group: 'reference' },
];

interface Props {
  active: TabId;
  onSelect: (id: TabId) => void;
  state: ConnectionState;
}

export function TopNav({ active, onSelect, state }: Props) {
  const pill = pillFor(state);
  return (
    <nav className="topnav">
      <div className="brand">OpenKB Mesh Internet</div>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={'tab' + (active === t.id ? ' active' : '')}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
      <div className={`conn-pill ${pill.cls}`}>{pill.text}</div>
    </nav>
  );
}

function pillFor(s: ConnectionState): { cls: string; text: string } {
  switch (s.status) {
    case 'ready':
      return { cls: 'ok', text: `● ${s.myInfo?.firmwareVersion ?? 'connected'}` };
    case 'configuring':
      return { cls: 'warn', text: '● configuring…' };
    case 'connecting':
      return { cls: 'warn', text: '● connecting…' };
    case 'disconnected':
    default:
      return { cls: 'bad', text: '○ disconnected' };
  }
}
