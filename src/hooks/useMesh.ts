import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as mt from '../concepts/translators/meshtastic';

const MAX_UTIL_HISTORY = 240;

export interface UtilPoint { t: number; chanUtil: number; airUtilTx: number; nodeId: number }

export interface TracerouteRecord {
  packetId: number;
  to: number;
  sentAt: number;
  response?: TracerouteResponse;
}

/** All per-connection state that the UI cares about. */
export interface ConnectionView {
  connId: string;
  state: ConnectionState;
  portPath?: string;
  nodes: NodeRecord[];
  messages: TextMessage[];
  packetCount: number;
  recentRssi: number[];
  utilHistory: UtilPoint[];
  traceroutes: TracerouteRecord[];
  traces: PacketTrace[];
  recentPackets: Array<MeshPacketLite & { receivedAt: number }>;
  lastPacketAt: number | null;
  connectStartedAt: number | null;
  readyAt: number | null;
  packetTimestamps: number[];
}

function emptyView(connId: string, state?: ConnectionState, portPath?: string): ConnectionView {
  return {
    connId,
    state: state ?? { status: 'disconnected' },
    portPath,
    nodes: [],
    messages: [],
    packetCount: 0,
    recentRssi: [],
    utilHistory: [],
    traceroutes: [],
    traces: [],
    recentPackets: [],
    lastPacketAt: null,
    connectStartedAt: null,
    readyAt: null,
    packetTimestamps: [],
  };
}

export function useMesh() {
  const [views, setViews] = useState<Map<string, ConnectionView>>(new Map());
  const [activeConnId, setActiveConnIdState] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const priorNodesRef = useRef<Map<string, NodeRecord>>(new Map());
  const prevStatusRef = useRef<Map<string, ConnectionState['status']>>(new Map());

  const updateView = useCallback(
    (connId: string, updater: (v: ConnectionView) => ConnectionView) => {
      setViews((prev) => {
        const cur = prev.get(connId);
        if (!cur) return prev; // ignore events for unknown connections
        const next = new Map(prev);
        next.set(connId, updater(cur));
        return next;
      });
    },
    [],
  );

  // Bootstrap: load any pre-existing connections (helps on renderer reload).
  useEffect(() => {
    let mounted = true;
    (async () => {
      const conns = await window.mesh.listConnections();
      if (!mounted) return;
      const next = new Map<string, ConnectionView>();
      for (const c of conns) {
        next.set(c.connId, emptyView(c.connId, c.state, c.portPath));
      }
      setViews(next);
      if (conns.length > 0) setActiveConnIdState((cur) => cur ?? conns[0].connId);

      // Hydrate nodes/messages/traces per connection.
      await Promise.all(
        conns.map(async (c) => {
          const [n, m, t] = await Promise.all([
            window.mesh.getNodes(c.connId),
            window.mesh.getMessages(c.connId),
            window.mesh.getTraces(c.connId),
          ]);
          if (!mounted) return;
          for (const node of n) {
            const k = `${c.connId}:${node.num}`;
            mt.publishNode(node, priorNodesRef.current.get(k));
            priorNodesRef.current.set(k, node);
          }
          setViews((prev) => {
            const cur = prev.get(c.connId);
            if (!cur) return prev;
            const next2 = new Map(prev);
            next2.set(c.connId, { ...cur, nodes: n, messages: m, traces: t });
            return next2;
          });
        }),
      );
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Links are global / cross-radio (derived from the shared DB).
  useEffect(() => {
    let mounted = true;
    const refresh = () => window.mesh.links().then((l) => mounted && setLinks(l));
    refresh();
    const t = setInterval(refresh, 5000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  // Wire all event streams once. Every event carries a connId so we can route it.
  useEffect(() => {
    const offConnAdded = window.mesh.onConnectionAdded(({ connId, portPath }) => {
      setViews((prev) => {
        if (prev.has(connId)) return prev;
        const next = new Map(prev);
        next.set(connId, emptyView(connId, { status: 'connecting', portPath }, portPath));
        return next;
      });
      setActiveConnIdState((cur) => cur ?? connId);
    });

    const offConnRemoved = window.mesh.onConnectionRemoved(({ connId }) => {
      setViews((prev) => {
        if (!prev.has(connId)) return prev;
        const next = new Map(prev);
        next.delete(connId);
        return next;
      });
      setActiveConnIdState((cur) => {
        if (cur !== connId) return cur;
        // Pick another connection if available.
        const remaining = Array.from(views.keys()).filter((k) => k !== connId);
        return remaining[0] ?? null;
      });
    });

    const offState = window.mesh.onState(({ connId, state }) => {
      const prev = prevStatusRef.current.get(connId) ?? 'disconnected';
      let connectStartedDelta: number | null | undefined;
      let readyDelta: number | null | undefined;
      if (prev === 'disconnected' && (state.status === 'connecting' || state.status === 'configuring')) {
        connectStartedDelta = Date.now();
        readyDelta = null;
      }
      if (prev !== 'ready' && state.status === 'ready') {
        readyDelta = Date.now();
      }
      if (state.status === 'disconnected') {
        readyDelta = null;
      }
      prevStatusRef.current.set(connId, state.status);

      // Ensure the view exists (state events can arrive before connection-added in some races).
      setViews((prevMap) => {
        const cur = prevMap.get(connId) ?? emptyView(connId, state, state.portPath);
        const next = new Map(prevMap);
        next.set(connId, {
          ...cur,
          state,
          portPath: state.portPath ?? cur.portPath,
          connectStartedAt: connectStartedDelta !== undefined ? connectStartedDelta : cur.connectStartedAt,
          readyAt: readyDelta !== undefined ? readyDelta : cur.readyAt,
        });
        return next;
      });
      setActiveConnIdState((cur) => cur ?? connId);
    });

    const offNode = window.mesh.onNode(({ connId, node }) => {
      const k = `${connId}:${node.num}`;
      mt.publishNode(node, priorNodesRef.current.get(k));
      priorNodesRef.current.set(k, node);
      // Refetch full node list for this connection to keep ordering stable.
      window.mesh.getNodes(connId).then((nodes) => {
        updateView(connId, (v) => ({ ...v, nodes }));
      });
    });

    const offMessage = window.mesh.onMessage(({ connId, message }) => {
      mt.publishMessage(message);
      updateView(connId, (v) => {
        const idx = v.messages.findIndex((x) => x.id === message.id && x.from === message.from);
        const messages =
          idx >= 0
            ? v.messages.map((x, i) => (i === idx ? message : x))
            : [...v.messages, message];
        return { ...v, messages };
      });
    });

    const offMessageStatus = window.mesh.onMessageStatus(({ connId, message }) => {
      updateView(connId, (v) => ({
        ...v,
        messages: v.messages.map((x) =>
          x.id === message.id && x.from === message.from
            ? { ...x, ackStatus: message.ackStatus, ackError: message.ackError, ackFromNode: message.ackFromNode }
            : x,
        ),
      }));
    });

    // When the user purges a radio's nodeDB, mirror the wipe in our
    // per-connection state so the Nodes table empties immediately
    // (peers will repopulate from future NodeInfo broadcasts).
    const offNodedbCleared = window.mesh.onNodedbCleared(({ connId, myNum }) => {
      updateView(connId, (v) => ({
        ...v,
        nodes: v.nodes.filter((n) => n.num === myNum), // keep only "me"
      }));
    });

    // When main wipes messages from the DB, mirror the deletion in our
    // per-connection state so the chat updates instantly without needing
    // a reload.
    const offMessagesCleared = window.mesh.onMessagesCleared(({ connId, info }) => {
      updateView(connId, (v) => {
        if (info.kind === 'all') return { ...v, messages: [] };
        if (info.kind === 'channel' && info.channel !== undefined) {
          return { ...v, messages: v.messages.filter((m) => !(m.channel === info.channel && m.to === 0xffffffff)) };
        }
        if (info.kind === 'dm' && info.peer !== undefined) {
          const myNum = v.state.myInfo?.myNodeNum;
          if (myNum === undefined) return v;
          return { ...v, messages: v.messages.filter((m) =>
            !((m.from === myNum && m.to === info.peer) || (m.from === info.peer && m.to === myNum)),
          ) };
        }
        return v;
      });
    });

    const offPacket = window.mesh.onPacket(({ connId, packet }) => {
      mt.publishPacket(packet);
      const now = Date.now();
      updateView(connId, (v) => {
        const cutoff = now - 60_000;
        return {
          ...v,
          packetCount: v.packetCount + 1,
          lastPacketAt: now,
          packetTimestamps: [...v.packetTimestamps, now].filter((t) => t >= cutoff),
          recentRssi: packet.rxRssi !== 0 ? [...v.recentRssi.slice(-99), packet.rxRssi] : v.recentRssi,
          recentPackets: [{ ...packet, receivedAt: now }, ...v.recentPackets].slice(0, 1000),
        };
      });
    });

    const offUtil = window.mesh.onTelemetrySample(({ connId, sample }) => {
      mt.publishTelemetry(sample);
      updateView(connId, (v) => {
        const next = [
          ...v.utilHistory,
          { t: sample.timestamp, chanUtil: sample.channelUtilization, airUtilTx: sample.airUtilTx, nodeId: sample.nodeId },
        ];
        return { ...v, utilHistory: next.length > MAX_UTIL_HISTORY ? next.slice(-MAX_UTIL_HISTORY) : next };
      });
    });

    const offTrSent = window.mesh.onTracerouteSent(({ connId, trace }) => {
      mt.publishTraceroute(trace);
      updateView(connId, (v) => ({
        ...v,
        traceroutes: [{ packetId: trace.packetId, to: trace.to, sentAt: trace.sentAt }, ...v.traceroutes].slice(0, 20),
      }));
    });

    const offTrResp = window.mesh.onTracerouteResponse(({ connId, response }) => {
      mt.publishTracerouteResponse(response);
      updateView(connId, (v) => {
        const idx = v.traceroutes.findIndex((r) => r.to === response.from && !r.response);
        if (idx === -1) {
          return {
            ...v,
            traceroutes: [{ packetId: 0, to: response.from, sentAt: response.receivedAt, response }, ...v.traceroutes].slice(0, 20),
          };
        }
        const next = [...v.traceroutes];
        next[idx] = { ...next[idx], response };
        return { ...v, traceroutes: next };
      });
    });

    const offTrace = window.mesh.onTraceUpdate(({ connId, trace }) => {
      updateView(connId, (v) => {
        const idx = v.traces.findIndex((x) => x.packetId === trace.packetId);
        const traces = idx >= 0
          ? v.traces.map((x, i) => (i === idx ? trace : x))
          : [trace, ...v.traces].slice(0, 100);
        return { ...v, traces };
      });
    });

    return () => {
      offConnAdded();
      offConnRemoved();
      offState();
      offNode();
      offMessage();
      offMessageStatus();
      offMessagesCleared();
      offNodedbCleared();
      offPacket();
      offUtil();
      offTrSent();
      offTrResp();
      offTrace();
    };
    // We intentionally don't list `views` here — these listeners should be set up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateView]);

  const connections = useMemo(() => Array.from(views.values()), [views]);
  const active = activeConnId ? views.get(activeConnId) ?? null : null;

  const setActiveConnId = useCallback((id: string | null) => {
    setActiveConnIdState(id);
  }, []);

  // Project active view as flat returns so existing panels need no changes.
  const empty = emptyView('');
  const projected = active ?? empty;

  return {
    // Per-connection projection of the active radio:
    state: projected.state,
    nodes: projected.nodes,
    messages: projected.messages,
    packetCount: projected.packetCount,
    recentRssi: projected.recentRssi,
    utilHistory: projected.utilHistory,
    traceroutes: projected.traceroutes,
    traces: projected.traces,
    recentPackets: projected.recentPackets,
    lastPacketAt: projected.lastPacketAt,
    connectStartedAt: projected.connectStartedAt,
    readyAt: projected.readyAt,
    packetsLast60s: projected.packetTimestamps.length,
    // Cross-connection (DB-derived):
    links,
    // Multi-radio API:
    connections,
    activeConnId,
    setActiveConnId,
  };
}
