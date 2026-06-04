import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TabId, TABS } from './components/TopNav';

const LAST_TAB_KEY = 'openkb.lastTab.v1';

function loadLastTab(): TabId | null {
  try {
    const raw = localStorage.getItem(LAST_TAB_KEY);
    if (!raw) return null;
    // Validate against the TABS array — localStorage corruption shouldn't
    // crash the app into an unrenderable state.
    if (TABS.some((t) => t.id === raw)) return raw as TabId;
    return null;
  } catch { return null; }
}
import { Sidebar } from './components/Sidebar';
import { BleScanBanner } from './components/BleScanBanner';
import { RebootBanner } from './components/RebootBanner';
import { HomePage } from './components/HomePage';
import { ConnectionWizard } from './components/ConnectionWizard';
import { SettingsPanel } from './components/panels/SettingsPanel';
import { MqttPanel } from './components/panels/MqttPanel';
import { ChannelsPanel } from './components/panels/ChannelsPanel';
import { NodesPanel } from './components/panels/NodesPanel';
import { PositionMapPanel } from './components/panels/PositionMapPanel';
import { ChatPanel } from './components/panels/ChatPanel';
import { TelemetryPanel } from './components/panels/TelemetryPanel';
import { TraceroutePanel } from './components/panels/TraceroutePanel';
import { DeliveryPanel } from './components/panels/DeliveryPanel';
import { PacketSnifferPanel } from './components/panels/PacketSnifferPanel';
import { RadioComparePanel } from './components/panels/RadioComparePanel';
import { MeshHealthPanel } from './components/panels/MeshHealthPanel';
import { LinkTestPanel } from './components/panels/LinkTestPanel';
import { DeviceLabPanel } from './components/panels/DeviceLabPanel';
import { FirmwarePanel } from './components/panels/FirmwarePanel';
import { DiscoveryPanel } from './components/learning/DiscoveryPanel';
import { AsymmetricLinksPanel } from './components/learning/AsymmetricLinksPanel';
import { PeerCheckPanel } from './components/panels/PeerCheckPanel';
import { LinkBudgetPanel } from './components/learning/LinkBudgetPanel';
import { SignalDistancePanel } from './components/learning/SignalDistancePanel';
import { CoveragePanel } from './components/learning/CoveragePanel';
import { AntennaPanel } from './components/learning/AntennaPanel';
import { LoRaCssPanel } from './components/learning/LoRaCssPanel';
import { MeshRoutingPanel } from './components/learning/MeshRoutingPanel';
import { MeshRealityPanel } from './components/learning/MeshRealityPanel';
import { ConceptsPanel } from './components/ConceptsPanel';
import { DeviceDatabasePanel } from './components/panels/DeviceDatabasePanel';
import { AntennaDatabasePanel } from './components/panels/AntennaDatabasePanel';
import { ExpectationPanel } from './components/ExpectationPanel';
import { ComparePanel } from './components/ComparePanel';
import { EventFeedPanel } from './components/EventFeedPanel';
import { useMesh } from './hooks/useMesh';
import { MeshContext, type RebootEntry } from './hooks/MeshContext';
import { Onboarding, hasCompletedOnboarding } from './components/Onboarding';
import {
  summarizeCompareRadios,
  summarizeMeshHealth,
  summarizeLinkTest,
  summarizeDelivery,
} from './lib/troubleshoot-summary';

export type ChatTarget =
  | { kind: 'channel'; index: number }
  | { kind: 'dm'; nodeNum: number };

export function App() {
  // Land on Home on every cold start — a radio is never connected at app
  // launch, so jumping to Chat would just show an empty "connect first" state.
  // Once a connection becomes ready, we'll restore the last visited tab
  // (saved in localStorage on every change) provided the user is still on Home.
  const [tab, setTab] = useState<TabId>('home');
  const [connectAddMode, setConnectAddMode] = useState(false);
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null);
  const mesh = useMesh();
  // Auto-show the onboarding tour for first-time users. Manual trigger lives
  // on the Home page so users can revisit any time.
  const [showOnboarding, setShowOnboarding] = useState(() => !hasCompletedOnboarding());

  const navigateTo = (id: string) => {
    if (id === 'connect-add') {
      setConnectAddMode(true);
      setTab('connect');
    } else {
      if (id !== 'connect') setConnectAddMode(false);
      setTab(id as TabId);
    }
  };

  // Persist tab changes so we can restore them once a radio reconnects.
  useEffect(() => {
    try { localStorage.setItem(LAST_TAB_KEY, tab); } catch { /* ignore */ }
  }, [tab]);

  // Wire up the renderer↔main BLE bridge once. Idempotent; safe to call
  // before any actual Bluetooth pairing has happened.
  useEffect(() => {
    void import('./lib/ble-client').then(({ initBleBridge }) => initBleBridge());
  }, []);

  // Reboot lifecycle tracking — kept at the App level (instead of in any
  // individual panel) so every consumer that wants to surface a "rebooting…"
  // state (the Connect wizard chips AND the sidebar) sees the same truth.
  const [pendingReboots, setPendingReboots] = useState<Record<string, RebootEntry>>({});
  const markRebootStarted = (myNodeNum: number, info: { shortName: string; longName: string; portPath?: string }) => {
    setPendingReboots((prev) => ({
      ...prev,
      [String(myNodeNum)]: { startedAt: Date.now(), ...info },
    }));
  };

  // Force a re-render every second while we have pending reboots so the
  // "rebooting in Ns" / "restarting · Ns" labels stay live. Cheap — only
  // runs while a reboot is in flight.
  const [, tickRebootClock] = useState(0);
  useEffect(() => {
    if (Object.keys(pendingReboots).length === 0) return;
    const id = setInterval(() => tickRebootClock((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [pendingReboots]);

  // GC entries that have been pending too long — protects against a failed
  // reboot leaving a "Restarting…" placeholder stuck on screen forever.
  useEffect(() => {
    const id = setInterval(() => {
      setPendingReboots((prev) => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, RebootEntry> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.startedAt > 60_000) { changed = true; continue; }
          next[k] = v;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // When a live connection appears whose myNodeNum matches a pending entry,
  // drop the entry — the radio has come back.
  useEffect(() => {
    const liveNodeNums = new Set(
      mesh.connections.map((c) => c.state.myInfo?.myNodeNum).filter((n) => !!n) as number[],
    );
    setPendingReboots((prev) => {
      let changed = false;
      const next: Record<string, RebootEntry> = {};
      for (const [k, v] of Object.entries(prev)) {
        const num = parseInt(k, 10);
        const justQueued = Date.now() - v.startedAt < 6_000;
        if (justQueued || !liveNodeNums.has(num)) next[k] = v;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [mesh.connections]);

  // First-ready-of-the-session restore. We only fire this once per launch
  // and only if the user hasn't already navigated away from Home — manual
  // navigation always wins over auto-restore.
  const autoRestoredRef = useRef(false);
  useEffect(() => {
    if (autoRestoredRef.current) return;
    if (mesh.state.status !== 'ready') return;
    autoRestoredRef.current = true;
    if (tab !== 'home') return; // user already chose where to go
    const saved = loadLastTab();
    if (saved && saved !== 'home') setTab(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh.state.status]);

  // Per-panel "last viewed" timestamps drive unread badges.
  const [lastViewed, setLastViewed] = useState<Partial<Record<TabId, number>>>({});

  // Bump the timestamp every time we *enter* a tab (and again on tab switch out
  // so badges reset cleanly).
  useEffect(() => {
    setLastViewed((prev) => ({ ...prev, [tab]: Date.now() }));
  }, [tab]);

  // Pulse the connection dot briefly each time a packet arrives.
  const [pulseKey, setPulseKey] = useState(0);
  const lastPacketRef = useRef<number | null>(null);
  useEffect(() => {
    if (mesh.lastPacketAt && mesh.lastPacketAt !== lastPacketRef.current) {
      lastPacketRef.current = mesh.lastPacketAt;
      setPulseKey((k) => k + 1);
    }
  }, [mesh.lastPacketAt]);

  // Pulse the Chat sidebar entry when a new unread arrives in a non-active thread.
  const [chatPulseKey, setChatPulseKey] = useState(0);
  const prevUnreadRef = useRef(0);

  const positioned = useMemo(
    () => mesh.nodes.filter((n) => n.lat !== undefined && n.lon !== undefined && (n.lat !== 0 || n.lon !== 0)).length,
    [mesh.nodes],
  );
  const myNum = mesh.state.myInfo?.myNodeNum ?? 0;
  const myNode = useMemo(() => mesh.nodes.find((n) => n.num === myNum), [mesh.nodes, myNum]);
  const lastChatViewed = lastViewed.chat ?? 0;
  const unreadMessages = useMemo(
    () => mesh.messages.filter((m) => m.from !== myNum && m.rxTime * 1000 > lastChatViewed).length,
    [mesh.messages, myNum, lastChatViewed],
  );
  useEffect(() => {
    if (unreadMessages > prevUnreadRef.current) setChatPulseKey((k) => k + 1);
    prevUnreadRef.current = unreadMessages;
    // Mirror the unread count into the OS dock/taskbar badge + tray tooltip.
    window.mesh?.setUnread?.(unreadMessages);
  }, [unreadMessages]);

  // A notification or tray click (handled in the main process) asks us to
  // open a specific thread — jump to Chat and select it.
  useEffect(() => {
    return window.mesh?.onActivateConversation?.((target) => {
      setChatTarget(target);
      setTab('chat');
    });
  }, []);
  const pendingTraces = useMemo(() => mesh.traceroutes.filter((t) => !t.response).length, [mesh.traceroutes]);

  // Active connection view, needed by the troubleshoot summaries that look at
  // per-radio state (traces, lastPacketAt). `mesh.traces` etc. are already a
  // projection of the active view, but the summarizer accepts the whole view.
  const activeView = useMemo(
    () => mesh.connections.find((c) => c.connId === mesh.activeConnId) ?? null,
    [mesh.connections, mesh.activeConnId],
  );

  const compareBadge = useMemo(() => summarizeCompareRadios(mesh.connections), [mesh.connections]);
  const healthBadge = useMemo(() => summarizeMeshHealth(activeView), [activeView]);
  const linkTestBadge = useMemo(() => summarizeLinkTest(mesh.connections), [mesh.connections]);
  const deliveryBadge = useMemo(() => summarizeDelivery(activeView), [activeView]);

  // ── Data-flow bubbles for the rest of the panels ─────────────────────
  // Telemetry: most recent channel utilization (if the radio is reporting it).
  const chanUtil = myNode?.channelUtilization;
  // Discovery / mesh routing: how many distinct neighbours the radio knows,
  // and how many are 0-hop direct vs. relayed.
  const directNeighbours = useMemo(
    () => mesh.nodes.filter((n) => n.num !== myNum && (n.hopsAway ?? 99) === 0 && n.lastHeard).length,
    [mesh.nodes, myNum],
  );
  // RSSI/Coverage: positioned nodes with a real RSSI sample (what the
  // scatter and path-loss-fit panels actually plot).
  const rssiSamples = useMemo(
    () => mesh.nodes.filter((n) =>
      n.lat !== undefined && n.lon !== undefined && (n.lat !== 0 || n.lon !== 0)
      && n.rssi !== undefined && n.rssi !== 0
    ).length,
    [mesh.nodes],
  );

  const sidebarBadges: Partial<Record<TabId, { text: string; tone?: 'accent' | 'good' | 'warn' | 'bad' | 'dim' }>> = {
    nodes: mesh.nodes.length > 0 ? { text: String(mesh.nodes.length), tone: 'dim' } : undefined,
    chat: unreadMessages > 0 ? { text: String(unreadMessages), tone: 'accent' } : undefined,
    map: positioned > 0 ? { text: String(positioned), tone: 'dim' } : undefined,
    telemetry: chanUtil !== undefined
      ? { text: `${chanUtil.toFixed(0)}%`, tone: chanUtil >= 25 ? 'warn' : chanUtil >= 10 ? 'good' : 'dim' }
      : undefined,
    sniffer: mesh.packetsLast60s > 0 ? { text: `${mesh.packetsLast60s}/m`, tone: 'good' } : undefined,
    traceroute: pendingTraces > 0 ? { text: String(pendingTraces), tone: 'warn' } : undefined,
    'radio-compare': compareBadge,
    health: healthBadge,
    'link-test': linkTestBadge,
    delivery: deliveryBadge,
    // Live-driven learn panels — show counts that signal "this panel has
    // your data" so users know the offline reference content isn't all there is.
    discovery: mesh.nodes.length > 0 ? { text: String(mesh.nodes.length), tone: 'good' } : undefined,
    'rssi-distance': rssiSamples > 0 ? { text: String(rssiSamples), tone: 'good' } : undefined,
    coverage: rssiSamples > 0 ? { text: String(rssiSamples), tone: 'good' } : undefined,
    'mesh-routing': directNeighbours > 0 ? { text: `${directNeighbours} direct`, tone: 'good' } : undefined,
    events: mesh.recentPackets.length > 0 ? { text: String(mesh.recentPackets.length), tone: 'dim' } : undefined,
    devices: mesh.nodes.length > 0 ? { text: String(mesh.nodes.length), tone: 'dim' } : undefined,
  };

  const openDm = (nodeNum: number) => {
    setChatTarget({ kind: 'dm', nodeNum });
    setTab('chat');
  };

  return (
    <MeshContext.Provider
      value={{
        connections: mesh.connections,
        activeConnId: mesh.activeConnId,
        setActiveConnId: mesh.setActiveConnId,
        pendingReboots,
        markRebootStarted,
      }}
    >
    {showOnboarding && (
      <Onboarding
        go={(t) => { setTab(t); /* keep overlay open so user can continue clicking through */ }}
        state={mesh.state}
        onClose={() => setShowOnboarding(false)}
      />
    )}
    <div className="app">
      <BleScanBanner />
      <RebootBanner reboots={pendingReboots} now={Date.now()} />
      <div className="app-body">
      <Sidebar
        active={tab}
        onSelect={navigateTo}
        state={mesh.state}
        myNode={myNode}
        badges={sidebarBadges}
        nodesCount={mesh.nodes.length}
        positionedCount={positioned}
        packetsLast60s={mesh.packetsLast60s}
        unreadMessages={unreadMessages}
        pulseKey={pulseKey}
        chatPulseKey={chatPulseKey}
        connections={mesh.connections}
        activeConnId={mesh.activeConnId}
        onSelectConnection={mesh.setActiveConnId}
      />
      <main className="main">
      {tab === 'home' && (
        <HomePage
          go={setTab}
          state={mesh.state}
          nodes={mesh.nodes}
          nodesCount={mesh.nodes.length}
          positionedCount={positioned}
          lastPacketAt={mesh.lastPacketAt}
          packetsLast60s={mesh.packetsLast60s}
          messages={mesh.messages}
          recentPackets={mesh.recentPackets}
          connections={mesh.connections}
          activeConnId={mesh.activeConnId}
          setActiveConnId={mesh.setActiveConnId}
          unreadMessages={unreadMessages}
          pendingTraces={pendingTraces}
          onShowTour={() => setShowOnboarding(true)}
          openDm={openDm}
        />
      )}
      {tab === 'settings' && <SettingsPanel state={mesh.state} />}
      {tab === 'mqtt' && <MqttPanel state={mesh.state} nodes={mesh.nodes} recentPackets={mesh.recentPackets} />}
      {tab === 'channels' && <ChannelsPanel state={mesh.state} />}
      {tab === 'connect' && (
        <ConnectionWizard
          state={mesh.state}
          myNode={myNode}
          nodes={mesh.nodes}
          recentPackets={mesh.recentPackets}
          nodesCount={mesh.nodes.length}
          channelsCount={mesh.state.channels?.length ?? 0}
          connectStartedAt={mesh.connectStartedAt}
          readyAt={mesh.readyAt}
          lastPacketAt={mesh.lastPacketAt}
          packetsLast60s={mesh.packetsLast60s}
          go={navigateTo}
          initialAdding={connectAddMode}
          onAddingChange={setConnectAddMode}
        />
      )}
      {tab === 'nodes' && <NodesPanel nodes={mesh.nodes} state={mesh.state} onMessageNode={openDm} go={setTab} />}
      {tab === 'map' && <PositionMapPanel nodes={mesh.nodes} state={mesh.state} links={mesh.links} onMessageNode={openDm} />}
      {tab === 'chat' && <ChatPanel messages={mesh.messages} nodes={mesh.nodes} state={mesh.state} target={chatTarget} setTarget={setChatTarget} />}
      {tab === 'telemetry' && <TelemetryPanel nodes={mesh.nodes} utilHistory={mesh.utilHistory} state={mesh.state} onMessageNode={openDm} />}
      {tab === 'traceroute' && <TraceroutePanel nodes={mesh.nodes} state={mesh.state} traceroutes={mesh.traceroutes} onMessageNode={openDm} />}
      {tab === 'delivery' && <DeliveryPanel traces={mesh.traces} nodes={mesh.nodes} state={mesh.state} />}
      {tab === 'sniffer' && <PacketSnifferPanel packets={mesh.recentPackets} packetCount={mesh.packetCount} nodes={mesh.nodes} state={mesh.state} onMessageNode={openDm} />}
      {tab === 'radio-compare' && <RadioComparePanel />}
      {tab === 'link-test' && <LinkTestPanel />}
      {tab === 'device-lab' && <DeviceLabPanel />}
      {tab === 'firmware' && <FirmwarePanel go={setTab} />}
      {tab === 'health' && (
        <MeshHealthPanel
          state={mesh.state}
          nodes={mesh.nodes}
          traces={mesh.traces}
          links={mesh.links}
          recentPackets={mesh.recentPackets}
          packetsLast60s={mesh.packetsLast60s}
          lastPacketAt={mesh.lastPacketAt}
          go={setTab}
        />
      )}
      {tab === 'discovery' && <DiscoveryPanel state={mesh.state} nodes={mesh.nodes} go={setTab} />}
      {tab === 'asymmetric-links' && <AsymmetricLinksPanel go={setTab} />}
      {tab === 'peer-check' && <PeerCheckPanel nodes={mesh.nodes} state={mesh.state} messages={mesh.messages} go={setTab} />}
      {tab === 'link-budget' && <LinkBudgetPanel nodes={mesh.nodes} state={mesh.state} myNode={myNode} onMessageNode={openDm} go={setTab} />}
      {tab === 'rssi-distance' && <SignalDistancePanel nodes={mesh.nodes} state={mesh.state} myNode={myNode} onMessageNode={openDm} go={setTab} />}
      {tab === 'coverage' && <CoveragePanel nodes={mesh.nodes} state={mesh.state} myNode={myNode} onMessageNode={openDm} go={setTab} />}
      {tab === 'antennas' && <AntennaPanel go={setTab} />}
      {tab === 'lora' && <LoRaCssPanel state={mesh.state} go={setTab} />}
      {tab === 'mesh-routing' && <MeshRoutingPanel nodes={mesh.nodes} links={mesh.links} state={mesh.state} myNode={myNode} go={setTab} />}
      {tab === 'reality' && <MeshRealityPanel nodes={mesh.nodes} myNode={myNode} state={mesh.state} go={setTab} />}
      {tab === 'expectations' && <ExpectationPanel nodes={mesh.nodes} myNode={myNode} state={mesh.state} />}
      {tab === 'compare' && <ComparePanel />}
      {tab === 'events' && <EventFeedPanel nodes={mesh.nodes} onMessageNode={openDm} />}
      {tab === 'devices' && <DeviceDatabasePanel nodes={mesh.nodes} />}
      {tab === 'antennas-db' && <AntennaDatabasePanel />}
      {tab === 'concepts' && <ConceptsPanel />}
      </main>
      </div>
    </div>
    </MeshContext.Provider>
  );
}
