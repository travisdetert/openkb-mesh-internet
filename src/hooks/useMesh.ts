import { useEffect, useRef, useState } from 'react';
import * as mt from '../concepts/translators/meshtastic';

const MAX_UTIL_HISTORY = 240;

export interface UtilPoint { t: number; chanUtil: number; airUtilTx: number; nodeId: number }

export interface TracerouteRecord {
  packetId: number;
  to: number;
  sentAt: number;
  response?: TracerouteResponse;
}

export function useMesh() {
  const [state, setState] = useState<ConnectionState>({ status: 'disconnected' });
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [messages, setMessages] = useState<TextMessage[]>([]);
  const [packetCount, setPacketCount] = useState(0);
  const [recentRssi, setRecentRssi] = useState<number[]>([]);
  const [utilHistory, setUtilHistory] = useState<UtilPoint[]>([]);
  const [traceroutes, setTraceroutes] = useState<TracerouteRecord[]>([]);
  const [lastPacketAt, setLastPacketAt] = useState<number | null>(null);
  // Connection lifecycle markers for the wizard.
  const [connectStartedAt, setConnectStartedAt] = useState<number | null>(null);
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [packetTimestamps, setPacketTimestamps] = useState<number[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [traces, setTraces] = useState<PacketTrace[]>([]);
  const [recentPackets, setRecentPackets] = useState<Array<MeshPacketLite & { receivedAt: number }>>([]);
  const priorNodesRef = useRef<Map<number, NodeRecord>>(new Map());
  const prevStatusRef = useRef<ConnectionState['status']>('disconnected');

  useEffect(() => {
    let mounted = true;

    window.mesh.getState().then((s) => mounted && setState(s));
    window.mesh.getNodes().then((n) => {
      if (!mounted) return;
      setNodes(n);
      for (const node of n) {
        mt.publishNode(node, priorNodesRef.current.get(node.num));
        priorNodesRef.current.set(node.num, node);
      }
    });
    window.mesh.getMessages().then((m) => mounted && setMessages(m));
    const refreshLinks = () => window.mesh.links().then((l) => mounted && setLinks(l));
    refreshLinks();
    const linksTimer = setInterval(refreshLinks, 5000);
    window.mesh.getTraces().then((t) => mounted && setTraces(t));
    const offTrace = window.mesh.onTraceUpdate((t) => {
      if (!mounted) return;
      setTraces((prev) => {
        const idx = prev.findIndex((x) => x.packetId === t.packetId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = t;
          return next;
        }
        return [t, ...prev].slice(0, 100);
      });
    });

    const offState = window.mesh.onState((s) => {
      if (!mounted) return;
      const prev = prevStatusRef.current;
      if (prev === 'disconnected' && (s.status === 'connecting' || s.status === 'configuring')) {
        setConnectStartedAt(Date.now());
        setReadyAt(null);
      }
      if (prev !== 'ready' && s.status === 'ready') {
        setReadyAt(Date.now());
      }
      if (s.status === 'disconnected') {
        setReadyAt(null);
      }
      prevStatusRef.current = s.status;
      setState(s);
    });
    const offNode = window.mesh.onNode((node) => {
      if (!mounted) return;
      mt.publishNode(node, priorNodesRef.current.get(node.num));
      priorNodesRef.current.set(node.num, node);
      window.mesh.getNodes().then((n) => mounted && setNodes(n));
    });
    const offMessage = window.mesh.onMessage((m) => {
      if (!mounted) return;
      mt.publishMessage(m);
      setMessages((prev) => {
        const idx = prev.findIndex((x) => x.id === m.id && x.from === m.from);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = m;
          return next;
        }
        return [...prev, m];
      });
    });
    const offMessageStatus = window.mesh.onMessageStatus((m) => {
      if (!mounted) return;
      setMessages((prev) => prev.map((x) => (x.id === m.id && x.from === m.from ? { ...x, ackStatus: m.ackStatus, ackError: m.ackError } : x)));
    });
    const offPacket = window.mesh.onPacket((p) => {
      if (!mounted) return;
      mt.publishPacket(p);
      const now = Date.now();
      setPacketCount((c) => c + 1);
      setLastPacketAt(now);
      setPacketTimestamps((prev) => {
        const cutoff = now - 60_000;
        return [...prev, now].filter((t) => t >= cutoff);
      });
      if (p.rxRssi !== 0) {
        setRecentRssi((prev) => [...prev.slice(-99), p.rxRssi]);
      }
      // Keep a rolling buffer (newest first) capped at 1000 for the Sniffer.
      setRecentPackets((prev) => [{ ...p, receivedAt: now }, ...prev].slice(0, 1000));
    });
    const offUtil = window.mesh.onTelemetrySample((s) => {
      if (!mounted) return;
      mt.publishTelemetry(s);
      setUtilHistory((prev) => {
        const next = [...prev, { t: s.timestamp, chanUtil: s.channelUtilization, airUtilTx: s.airUtilTx, nodeId: s.nodeId }];
        return next.length > MAX_UTIL_HISTORY ? next.slice(-MAX_UTIL_HISTORY) : next;
      });
    });
    const offTrSent = window.mesh.onTracerouteSent((t) => {
      if (!mounted) return;
      mt.publishTraceroute(t);
      setTraceroutes((prev) => [{ packetId: t.packetId, to: t.to, sentAt: t.sentAt }, ...prev].slice(0, 20));
    });
    const offTrResp = window.mesh.onTracerouteResponse((resp) => {
      if (!mounted) return;
      mt.publishTracerouteResponse(resp);
      setTraceroutes((prev) => {
        const idx = prev.findIndex((r) => r.to === resp.from && !r.response);
        if (idx === -1) {
          return [{ packetId: 0, to: resp.from, sentAt: resp.receivedAt, response: resp }, ...prev].slice(0, 20);
        }
        const next = [...prev];
        next[idx] = { ...next[idx], response: resp };
        return next;
      });
    });

    return () => {
      mounted = false;
      clearInterval(linksTimer);
      offTrace();
      offState();
      offNode();
      offMessage();
      offMessageStatus();
      offPacket();
      offUtil();
      offTrSent();
      offTrResp();
    };
  }, []);

  return {
    state, nodes, messages, packetCount, recentRssi, utilHistory, traceroutes, links, traces, recentPackets,
    lastPacketAt, connectStartedAt, readyAt,
    packetsLast60s: packetTimestamps.length,
  };
}
