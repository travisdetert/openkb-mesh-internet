import React from 'react';
import { TABS, TabId } from './TopNav';
import type { ConnectionView } from '../hooks/useMesh';

type Tone = 'accent' | 'good' | 'warn' | 'dim';
interface Badge { text: string; tone?: Tone }

interface Props {
  active: TabId;
  onSelect: (id: TabId) => void;
  state: ConnectionState;
  myNode?: NodeRecord;
  badges: Partial<Record<TabId, Badge | undefined>>;
  nodesCount: number;
  positionedCount: number;
  packetsLast60s: number;
  unreadMessages: number;
  /** Increments every time a packet arrives — drives the connection dot's pulse. */
  pulseKey: number;
  /** Increments when an unread chat message arrives — drives the Chat link's pulse. */
  chatPulseKey: number;
  /** All connected radios, including the active one. */
  connections: ConnectionView[];
  activeConnId: string | null;
  onSelectConnection: (id: string | null) => void;
}

// 'app' header items (home + connect) are rendered specially at the top of
// the sidebar — home is the brand link, connect is the status block. Other
// 'app' entries (like Settings) appear under the Setup group below.
const SPECIAL_APP_IDS = new Set<TabId>(['home', 'connect']);
const GROUP_ORDER: Array<{ key: 'app' | 'live' | 'learn' | 'kb'; label: string }> = [
  { key: 'app', label: 'Setup' },
  { key: 'live', label: 'Live' },
  { key: 'learn', label: 'Learn' },
  { key: 'kb', label: 'Reference' },
];

export function Sidebar({
  active, onSelect, state, myNode, badges,
  nodesCount, positionedCount, packetsLast60s, unreadMessages, pulseKey, chatPulseKey,
  connections, activeConnId, onSelectConnection,
}: Props) {
  const pill = pillFor(state, myNode);
  const isReady = state.status === 'ready';
  const battery = myNode?.batteryLevel;
  const batteryTone = battery === undefined ? 'dim' : battery > 50 ? 'good' : battery > 20 ? 'warn' : 'bad';
  const batteryColor = batteryTone === 'good' ? 'var(--good)' : batteryTone === 'warn' ? 'var(--warn)' : batteryTone === 'bad' ? 'var(--bad)' : 'var(--text-faint)';
  const requiresConnection = (id: TabId) => id !== 'home' && id !== 'connect' && !id.startsWith('learn');

  return (
    <aside className="sidebar">
      <button
        className={'sidebar-brand' + (active === 'home' ? ' active' : '')}
        onClick={() => onSelect('home')}
        title="Home"
      >
        OpenKB Mesh
      </button>

      <button
        className={`sidebar-status ${pill.cls}` + (active === 'connect' ? ' active' : '')}
        onClick={() => onSelect('connect')}
        title="Connection setup"
      >
        <span className="status-dot-row">
          <span key={pulseKey} className={`status-dot ${pill.cls}`} />
          <span className="status-text">{pill.text}</span>
        </span>
        {isReady && myNode && (myNode.shortName || myNode.longName) && (
          <span className="status-stats" style={{ color: 'var(--text)' }}>
            {myNode.longName || myNode.shortName}
            {myNode.hwModelName && <span style={{ color: 'var(--text-faint)' }}> · {myNode.hwModelName}</span>}
          </span>
        )}
        {isReady && (battery !== undefined || myNode?.voltage !== undefined) && (
          <span className="status-stats">
            {battery !== undefined && <span style={{ color: batteryColor }}>🔋 {battery}%</span>}
            {myNode?.voltage !== undefined && <span style={{ marginLeft: 6, color: 'var(--text-faint)' }}>{myNode.voltage.toFixed(2)}V</span>}
            {myNode?.channelUtilization !== undefined && <span style={{ marginLeft: 6, color: myNode.channelUtilization >= 25 ? 'var(--warn)' : 'var(--text-faint)' }}>· {myNode.channelUtilization.toFixed(0)}% ch</span>}
          </span>
        )}
        {isReady && (
          <span className="status-stats">
            {nodesCount} nodes · {positionedCount} mapped · {packetsLast60s}/min
            {unreadMessages > 0 && <> · <span style={{ color: 'var(--accent)' }}>{unreadMessages} new</span></>}
          </span>
        )}
        {state.status === 'configuring' && (
          <span className="status-stats">received {nodesCount} nodes so far…</span>
        )}
        {state.status === 'disconnected' && (
          <span className="status-stats" style={{ color: 'var(--text-faint)' }}>click to connect</span>
        )}
      </button>

      {connections.length > 1 && (
        <div className="sidebar-conns">
          <div className="sidebar-section-label" style={{ marginBottom: 4 }}>Radios</div>
          {connections.map((c) => {
            const isActive = c.connId === activeConnId;
            const cMy = c.state.myInfo?.myNodeNum;
            const cNode = cMy ? c.nodes.find((n) => n.num === cMy) : undefined;
            const label = cNode?.shortName || cNode?.longName || c.portPath?.split('/').pop() || c.connId;
            const sub = c.state.status === 'ready'
              ? `${c.nodes.length} nodes`
              : c.state.status === 'configuring'
                ? 'syncing…'
                : c.state.status === 'connecting'
                  ? 'opening…'
                  : 'disconnected';
            const dotCls = c.state.status === 'ready' ? 'ok' : c.state.status === 'disconnected' ? 'bad' : 'warn';
            return (
              <button
                key={c.connId}
                className={'sidebar-conn' + (isActive ? ' active' : '')}
                onClick={() => onSelectConnection(c.connId)}
                title={c.portPath ?? c.connId}
              >
                <span className={`status-dot ${dotCls}`} />
                <span className="sidebar-conn-label">{label}</span>
                <span className="sidebar-conn-sub">{sub}</span>
              </button>
            );
          })}
        </div>
      )}

      <nav className="sidebar-nav">
        {GROUP_ORDER.map(({ key, label }) => {
          const groupTabs = TABS.filter((t) => t.group === key && !SPECIAL_APP_IDS.has(t.id));
          if (groupTabs.length === 0) return null;
          return (
            <div key={key} className="sidebar-section">
              <div className="sidebar-section-label">{label}</div>
              {groupTabs.map((t) => {
                const dim = key === 'live' && !isReady && requiresConnection(t.id);
                const badge = badges[t.id];
                const isChat = t.id === 'chat';
                const pulseAttr = isChat ? chatPulseKey : 0;
                return (
                  <button
                    key={t.id}
                    className={'sidebar-link' + (active === t.id ? ' active' : '') + (dim ? ' dim' : '') + (isChat && active !== t.id && unreadMessages > 0 ? ' has-unread' : '')}
                    onClick={() => onSelect(t.id)}
                    title={dim ? 'Connect to your node to see live data' : undefined}
                  >
                    <span className="sidebar-link-label">{t.label}</span>
                    {badge && <span key={pulseAttr} className={`sidebar-badge tone-${badge.tone ?? 'dim'}` + (isChat ? ' pulse-on-update' : '')}>{badge.text}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      {state.error && (
        <div className="sidebar-foot">
          <div className="sidebar-error" title={state.error}>{state.error}</div>
        </div>
      )}
    </aside>
  );
}

function pillFor(s: ConnectionState, myNode?: NodeRecord): { cls: string; text: string } {
  switch (s.status) {
    case 'ready': {
      const name = myNode?.shortName;
      const fw = s.myInfo?.firmwareVersion?.split(' ')[0];
      return { cls: 'ok', text: name ? `live · ${name}` : fw ? `live · fw ${fw}` : 'live' };
    }
    case 'configuring':
      return { cls: 'warn', text: 'syncing nodeDB…' };
    case 'connecting':
      return { cls: 'warn', text: 'opening port…' };
    case 'disconnected':
    default:
      return { cls: 'bad', text: 'disconnected' };
  }
}
