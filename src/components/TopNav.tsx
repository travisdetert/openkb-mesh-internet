import React from 'react';

export type TabId =
  | 'home'
  | 'connect'
  | 'settings'
  | 'nodes'
  | 'map'
  | 'chat'
  | 'telemetry'
  | 'traceroute'
  | 'delivery'
  | 'sniffer'
  | 'link-budget'
  | 'rssi-distance'
  | 'coverage'
  | 'antennas'
  | 'lora'
  | 'mesh-routing'
  | 'reality'
  | 'expectations'
  | 'compare'
  | 'events'
  | 'concepts'
  | 'devices';

export interface Tab {
  id: TabId;
  label: string;
  group: 'app' | 'live' | 'learn' | 'kb';
}

export const TABS: Tab[] = [
  { id: 'home',         label: 'Home',           group: 'app' },
  { id: 'connect',      label: 'Connect',        group: 'app' },
  { id: 'settings',     label: 'Settings',       group: 'app' },
  { id: 'nodes',        label: 'Nodes',          group: 'live' },
  { id: 'map',          label: 'Map',            group: 'live' },
  { id: 'chat',         label: 'Chat',           group: 'live' },
  { id: 'telemetry',    label: 'Telemetry',      group: 'live' },
  { id: 'traceroute',   label: 'Traceroute',     group: 'live' },
  { id: 'delivery',     label: 'Delivery',       group: 'live' },
  { id: 'sniffer',      label: 'Packet Sniffer', group: 'live' },
  { id: 'link-budget',   label: 'Link Budget',     group: 'learn' },
  { id: 'rssi-distance', label: 'RSSI vs Distance', group: 'learn' },
  { id: 'coverage',      label: 'Coverage',         group: 'learn' },
  { id: 'antennas',      label: 'Antennas',        group: 'learn' },
  { id: 'lora',         label: 'LoRa CSS',       group: 'learn' },
  { id: 'mesh-routing', label: 'Mesh Routing',   group: 'learn' },
  { id: 'reality',      label: 'Reality Check',  group: 'learn' },
  { id: 'expectations', label: 'Expectations',   group: 'learn' },
  { id: 'compare',      label: 'Compare',        group: 'learn' },
  { id: 'events',       label: 'Event Feed',     group: 'live' },
  { id: 'devices',      label: 'Device DB',       group: 'kb' },
  { id: 'concepts',     label: 'Concepts',       group: 'kb' },
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
