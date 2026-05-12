import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TabId } from './components/TopNav';
import { Sidebar } from './components/Sidebar';
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
import { LinkBudgetPanel } from './components/learning/LinkBudgetPanel';
import { SignalDistancePanel } from './components/learning/SignalDistancePanel';
import { CoveragePanel } from './components/learning/CoveragePanel';
import { AntennaPanel } from './components/learning/AntennaPanel';
import { LoRaCssPanel } from './components/learning/LoRaCssPanel';
import { MeshRoutingPanel } from './components/learning/MeshRoutingPanel';
import { MeshRealityPanel } from './components/learning/MeshRealityPanel';
import { ConceptsPanel } from './components/ConceptsPanel';
import { DeviceDatabasePanel } from './components/panels/DeviceDatabasePanel';
import { ExpectationPanel } from './components/ExpectationPanel';
import { ComparePanel } from './components/ComparePanel';
import { EventFeedPanel } from './components/EventFeedPanel';
import { useMesh } from './hooks/useMesh';
import { MeshContext } from './hooks/MeshContext';

export type ChatTarget =
  | { kind: 'channel'; index: number }
  | { kind: 'dm'; nodeNum: number };

export function App() {
  // Chat is the app's reason for being — open it by default. Users who want
  // setup land on Connect once via the prominent status block in the sidebar.
  const [tab, setTab] = useState<TabId>('chat');
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null);
  const mesh = useMesh();

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
  }, [unreadMessages]);
  const pendingTraces = useMemo(() => mesh.traceroutes.filter((t) => !t.response).length, [mesh.traceroutes]);

  const sidebarBadges: Partial<Record<TabId, { text: string; tone?: 'accent' | 'good' | 'warn' | 'dim' }>> = {
    nodes: mesh.nodes.length > 0 ? { text: String(mesh.nodes.length), tone: 'dim' } : undefined,
    chat: unreadMessages > 0 ? { text: String(unreadMessages), tone: 'accent' } : undefined,
    map: positioned > 0 ? { text: String(positioned), tone: 'dim' } : undefined,
    sniffer: mesh.packetsLast60s > 0 ? { text: `${mesh.packetsLast60s}/m`, tone: 'good' } : undefined,
    traceroute: pendingTraces > 0 ? { text: String(pendingTraces), tone: 'warn' } : undefined,
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
      }}
    >
    <div className="app">
      <Sidebar
        active={tab}
        onSelect={setTab}
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
          nodesCount={mesh.nodes.length}
          positionedCount={positioned}
          lastPacketAt={mesh.lastPacketAt}
          packetsLast60s={mesh.packetsLast60s}
        />
      )}
      {tab === 'settings' && <SettingsPanel state={mesh.state} />}
      {tab === 'mqtt' && <MqttPanel state={mesh.state} nodes={mesh.nodes} recentPackets={mesh.recentPackets} />}
      {tab === 'channels' && <ChannelsPanel state={mesh.state} />}
      {tab === 'connect' && (
        <ConnectionWizard
          state={mesh.state}
          myNode={myNode}
          nodesCount={mesh.nodes.length}
          channelsCount={mesh.state.channels?.length ?? 0}
          connectStartedAt={mesh.connectStartedAt}
          readyAt={mesh.readyAt}
          lastPacketAt={mesh.lastPacketAt}
          packetsLast60s={mesh.packetsLast60s}
        />
      )}
      {tab === 'nodes' && <NodesPanel nodes={mesh.nodes} state={mesh.state} onMessageNode={openDm} />}
      {tab === 'map' && <PositionMapPanel nodes={mesh.nodes} state={mesh.state} links={mesh.links} onMessageNode={openDm} />}
      {tab === 'chat' && <ChatPanel messages={mesh.messages} nodes={mesh.nodes} state={mesh.state} target={chatTarget} setTarget={setChatTarget} />}
      {tab === 'telemetry' && <TelemetryPanel nodes={mesh.nodes} utilHistory={mesh.utilHistory} state={mesh.state} onMessageNode={openDm} />}
      {tab === 'traceroute' && <TraceroutePanel nodes={mesh.nodes} state={mesh.state} traceroutes={mesh.traceroutes} onMessageNode={openDm} />}
      {tab === 'delivery' && <DeliveryPanel traces={mesh.traces} nodes={mesh.nodes} state={mesh.state} />}
      {tab === 'sniffer' && <PacketSnifferPanel packets={mesh.recentPackets} packetCount={mesh.packetCount} nodes={mesh.nodes} state={mesh.state} onMessageNode={openDm} />}
      {tab === 'radio-compare' && <RadioComparePanel />}
      {tab === 'link-test' && <LinkTestPanel />}
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
      {tab === 'link-budget' && <LinkBudgetPanel nodes={mesh.nodes} state={mesh.state} myNode={myNode} onMessageNode={openDm} go={setTab} />}
      {tab === 'rssi-distance' && <SignalDistancePanel nodes={mesh.nodes} state={mesh.state} myNode={myNode} onMessageNode={openDm} />}
      {tab === 'coverage' && <CoveragePanel nodes={mesh.nodes} state={mesh.state} myNode={myNode} onMessageNode={openDm} />}
      {tab === 'antennas' && <AntennaPanel />}
      {tab === 'lora' && <LoRaCssPanel state={mesh.state} />}
      {tab === 'mesh-routing' && <MeshRoutingPanel nodes={mesh.nodes} links={mesh.links} state={mesh.state} myNode={myNode} go={setTab} />}
      {tab === 'reality' && <MeshRealityPanel nodes={mesh.nodes} myNode={myNode} state={mesh.state} go={setTab} />}
      {tab === 'expectations' && <ExpectationPanel nodes={mesh.nodes} myNode={myNode} state={mesh.state} />}
      {tab === 'compare' && <ComparePanel />}
      {tab === 'events' && <EventFeedPanel nodes={mesh.nodes} onMessageNode={openDm} />}
      {tab === 'devices' && <DeviceDatabasePanel nodes={mesh.nodes} />}
      {tab === 'concepts' && <ConceptsPanel />}
      </main>
    </div>
    </MeshContext.Provider>
  );
}
