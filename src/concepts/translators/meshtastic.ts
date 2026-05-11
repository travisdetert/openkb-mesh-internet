// Translates protocol-native Meshtastic events into typed BusEvents.
// This is the seam where protocol details meet the event-sourced layer:
// the rest of the app reads BusEvents and never imports `MeshPacketLite` etc.

import { bus, type BusEvent } from '../../bus';

const PROTOCOL_SLUG = 'meshtastic';

// Header overhead estimate when the source doesn't tell us the wire size.
const HEADER_BYTES = 16;

export function publishNode(n: NodeRecord, prior?: NodeRecord): void {
  // First time we see a node → presence (nodeinfo). After that, position deltas
  // and telemetry both have their own paths below; we treat node table updates
  // as nodeinfo refreshes when the identity fields changed.
  const isNew = !prior;
  const identityChanged = prior &&
    (prior.longName !== n.longName || prior.shortName !== n.shortName || prior.hwModel !== n.hwModel);

  if (isNew || identityChanged) {
    publish({
      updateSlug: 'nodeinfo',
      from: n.num,
      wireBytes: HEADER_BYTES + (n.longName?.length ?? 0) + (n.shortName?.length ?? 0) + 8,
      payload: { num: n.num, longName: n.longName, shortName: n.shortName, hwModelName: n.hwModelName },
    });
  }

  if (n.lat != null && n.lon != null && (!prior || prior.lat !== n.lat || prior.lon !== n.lon)) {
    publish({
      updateSlug: 'position-beacon',
      from: n.num,
      wireBytes: HEADER_BYTES + 14,
      payload: { lat: n.lat, lon: n.lon, alt: n.altitude, t: n.lastHeard },
    });
  }
}

export function publishMessage(m: TextMessage): void {
  const bytes = HEADER_BYTES + new TextEncoder().encode(m.text ?? '').byteLength;
  publish({
    updateSlug: 'text-message',
    from: m.from,
    to: m.to === 0xffffffff ? undefined : m.to,
    topicSlug: 'channel-default',
    wireBytes: bytes,
    payload: { text: m.text, channel: m.channel, rssi: m.rxRssi, snr: m.rxSnr },
  });
}

export function publishTelemetry(s: TelemetrySample): void {
  publish({
    updateSlug: 'device-telemetry',
    from: s.nodeId,
    wireBytes: HEADER_BYTES + 18,
    payload: {
      battery: s.batteryLevel,
      voltage: s.voltage,
      chanUtil: s.channelUtilization,
      airUtilTx: s.airUtilTx,
    },
  });
}

export function publishTraceroute(t: TracerouteSent): void {
  publish({
    updateSlug: 'traceroute-request',
    to: t.to,
    wireBytes: HEADER_BYTES + 12,
    payload: { packetId: t.packetId, sentAt: t.sentAt },
  });
}

export function publishTracerouteResponse(r: TracerouteResponse): void {
  publish({
    updateSlug: 'traceroute-request',
    from: r.from,
    to: r.to,
    wireBytes: HEADER_BYTES + 12 + r.route.length * 4,
    payload: { route: r.route, rssi: r.rxRssi, snr: r.rxSnr, hopStart: r.hopStart, hopLimit: r.hopLimit },
  });
}

export function publishPacket(p: MeshPacketLite): void {
  // Packets we haven't classified into a more-specific Update still flow through
  // as ack-packet (the catch-all for "the wire moved bytes"). This keeps the
  // event feed honest about traffic volume even when we can't decode meaning.
  publish({
    updateSlug: 'ack-packet',
    from: p.from,
    to: p.to === 0xffffffff ? undefined : p.to,
    wireBytes: HEADER_BYTES, // we don't know the payload size from MeshPacketLite
    payload: { id: p.id, channel: p.channel, hopLimit: p.hopLimit, portnum: p.portnum, rssi: p.rxRssi, snr: p.rxSnr },
  });
}

function publish(partial: Omit<BusEvent, 'sourceProtocolSlug' | 'ts'>): void {
  const event: BusEvent = {
    ...partial,
    sourceProtocolSlug: PROTOCOL_SLUG,
    ts: Date.now(),
  };
  bus.publish(event);
}
