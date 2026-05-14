import React from 'react';
import { TABS, TabId } from './TopNav';
import type { ConnectionView } from '../hooks/useMesh';

type Tone = 'accent' | 'good' | 'warn' | 'bad' | 'dim';
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

// Items rendered with their own hero treatment outside any group:
//   - home/connect/chat get bespoke treatments at the top of the sidebar
//   - settings/mqtt/channels are reachable from inside the Connect tab
//     (they configure the active device, so they belong with the device view).
const SPECIAL_APP_IDS = new Set<TabId>(['home', 'connect', 'chat', 'settings', 'mqtt', 'channels']);
const GROUP_ORDER: Array<{ key: 'app' | 'live' | 'troubleshoot' | 'learn' | 'kb'; label: string }> = [
  { key: 'app', label: 'Setup' },
  { key: 'live', label: 'Live' },
  { key: 'troubleshoot', label: 'Troubleshoot' },
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
      <div className="sidebar-brand-row">
        <button
          className={'sidebar-brand' + (active === 'home' ? ' active' : '')}
          onClick={() => onSelect('home')}
          title="Home"
        >
          OpenKB Mesh
        </button>
        <button
          className={'sidebar-brand-radios' + (active === 'connect' ? ' active' : '')}
          onClick={() => onSelect('connect')}
          title={connections.length === 0 ? 'No radios connected — open Connect' : `${connections.length} radio${connections.length === 1 ? '' : 's'} connected — open Connect`}
        >
          <span key={pulseKey} className={`status-dot ${pill.cls}`} />
          <span className="sidebar-brand-radios-count">{connections.length}</span>
        </button>
      </div>

      {/* Per-radio list (or empty-state CTA). The radio count + status dot
       *  lives in the brand header above to avoid duplicating it here. */}
      <div className="sidebar-conn-card">
        {connections.length === 0 ? (
          <div className="sidebar-conn-empty">
            <button className="sidebar-conn-empty-btn" onClick={() => onSelect('connect')}>
              + Connect a radio
            </button>
          </div>
        ) : (
          <>
            {connections.map((c) => {
              const isActiveRow = c.connId === activeConnId;
              const cMy = c.state.myInfo?.myNodeNum;
              const cNode = cMy ? c.nodes.find((n) => n.num === cMy) : undefined;
              const label = cNode?.shortName || cNode?.longName || c.portPath?.split('/').pop() || c.connId;
              const dotCls = c.state.status === 'ready' ? 'ok' : c.state.status === 'disconnected' ? 'bad' : 'warn';
              const cBatt = cNode?.batteryLevel;
              const cBattColor = cBatt === undefined ? undefined : cBatt > 50 ? 'var(--good)' : cBatt > 20 ? 'var(--warn)' : 'var(--bad)';
              const cNodes = c.nodes.length;
              const subText = c.state.status === 'ready'
                ? `${cNodes} nodes${cBatt !== undefined ? ' · 🔋 ' + cBatt + '%' : ''}`
                : c.state.status === 'configuring' ? 'syncing nodeDB…'
                : c.state.status === 'connecting'  ? 'opening port…'
                : 'disconnected';
              return (
                <button
                  key={c.connId}
                  className={'sidebar-conn-row' + (isActiveRow ? ' active' : '')}
                  onClick={() => { onSelectConnection(c.connId); onSelect('connect'); }}
                  title="Make this the active radio and open its device view"
                >
                  <span className={`status-dot ${dotCls}`} />
                  <div className="sidebar-conn-row-text">
                    <div className="sidebar-conn-row-label">
                      {label}
                      {isActiveRow && <span className="sidebar-conn-row-active-pill">active</span>}
                    </div>
                    <div className="sidebar-conn-row-sub" style={cBatt !== undefined ? { color: cBattColor } : undefined}>
                      {subText}
                    </div>
                  </div>
                </button>
              );
            })}
            <button className="sidebar-conn-add" onClick={() => onSelect('connect')} title="Open the Connect panel to add or manage radios">
              + Add / manage radios
            </button>
          </>
        )}
      </div>

      <button
        key={chatPulseKey}
        className={'sidebar-chat' + (active === 'chat' ? ' active' : '') + (unreadMessages > 0 ? ' has-unread' : '') + (isReady ? '' : ' dim')}
        onClick={() => onSelect('chat')}
        title={isReady ? 'Open the chat' : 'Connect a radio to start chatting'}
      >
        <div className="sidebar-chat-row">
          <span className="sidebar-chat-label">Chat</span>
          {unreadMessages > 0 && <span className="sidebar-chat-unread">{unreadMessages > 99 ? '99+' : unreadMessages}</span>}
        </div>
        <span className="sidebar-chat-sub">
          {!isReady
            ? 'connect a radio'
            : unreadMessages > 0
              ? `${unreadMessages} new message${unreadMessages === 1 ? '' : 's'}`
              : 'all caught up'}
        </span>
      </button>

      <nav className="sidebar-nav">
        {GROUP_ORDER.map(({ key, label }) => {
          const groupTabs = TABS.filter((t) => t.group === key && !SPECIAL_APP_IDS.has(t.id));
          if (groupTabs.length === 0) return null;
          return (
            <div key={key} className="sidebar-section">
              <div className="sidebar-section-label">{label}</div>
              {groupTabs.map((t) => {
                const dim = (key === 'live' || key === 'troubleshoot') && !isReady && requiresConnection(t.id);
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
