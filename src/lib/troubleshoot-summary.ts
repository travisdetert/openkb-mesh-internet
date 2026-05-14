import type { ConnectionView } from '../hooks/useMesh';

export type BadgeTone = 'good' | 'warn' | 'bad' | 'accent' | 'dim';
export interface Badge { text: string; tone?: BadgeTone }

/**
 * Compare two radios on the *blocking* criteria — same checks the
 * RadioComparePanel uses for severity='block', minus the rich descriptions.
 * Returns the count of mismatches; 0 means the radios should be able to talk.
 */
function configBlockCount(a: ConnectionView, b: ConnectionView): { blocks: number; ready: boolean } {
  const la = a.state.loraConfig;
  const lb = b.state.loraConfig;
  if (!la || !lb) return { blocks: 0, ready: false };
  let blocks = 0;
  if (la.region !== lb.region) blocks++;
  if (la.usePreset !== lb.usePreset) blocks++;
  else if (la.usePreset && la.modemPreset !== lb.modemPreset) blocks++;
  else if (!la.usePreset && (la.spreadFactor !== lb.spreadFactor || la.bandwidth !== lb.bandwidth || la.codingRate !== lb.codingRate)) blocks++;
  if (la.channelNum !== lb.channelNum) blocks++;
  if (la.overrideFrequency !== lb.overrideFrequency) blocks++;
  if (!la.txEnabled || !lb.txEnabled) blocks++;
  const pa = a.state.channels?.find((c) => c.index === 0);
  const pb = b.state.channels?.find((c) => c.index === 0);
  if (pa && pb) {
    const nameA = pa.name || '';
    const nameB = pb.name || '';
    if (nameA !== nameB) blocks++;
    else if (pa.pskLength !== pb.pskLength) blocks++;
    else if (pa.psk && pb.psk && pa.psk.length > 0 && !pa.psk.every((byte, i) => byte === pb.psk[i])) blocks++;
  }
  return { blocks, ready: true };
}

export function summarizeCompareRadios(connections: ConnectionView[]): Badge | undefined {
  const ready = connections.filter((c) => c.state.status === 'ready');
  if (ready.length < 2) return ready.length === 1 ? { text: 'need 2+', tone: 'dim' } : undefined;

  // Run all unordered pairs; take the worst result so the badge reflects
  // the most attention-grabbing problem the panel would show.
  let totalBlocks = 0;
  let pairsChecked = 0;
  for (let i = 0; i < ready.length; i++) {
    for (let j = i + 1; j < ready.length; j++) {
      const { blocks, ready: bothReady } = configBlockCount(ready[i], ready[j]);
      if (!bothReady) continue;
      pairsChecked++;
      totalBlocks += blocks;
    }
  }
  if (pairsChecked === 0) return { text: 'syncing…', tone: 'dim' };
  if (totalBlocks === 0) return { text: 'ok', tone: 'good' };
  return { text: `${totalBlocks} block${totalBlocks === 1 ? '' : 's'}`, tone: 'bad' };
}

export function summarizeMeshHealth(view: ConnectionView | null): Badge | undefined {
  if (!view) return undefined;
  if (view.state.status !== 'ready') return undefined;

  // Quick critical checks that mirror MeshHealthPanel's 'critical' severity
  // without re-running the full audit.
  const lora = view.state.loraConfig;
  if (lora && lora.txEnabled === false) return { text: 'TX off', tone: 'bad' };
  if (lora && lora.region === 0) return { text: 'no region', tone: 'bad' };

  // Recent delivery failures over the last 10 minutes carry the most weight —
  // they're the "did my last few messages actually arrive?" question.
  const since = Date.now() - 10 * 60 * 1000;
  const recentTraces = view.traces.filter((t) => t.sentAt >= since);
  const failed = recentTraces.filter((t) => t.finalStatus === 'failed').length;
  if (failed > 0) return { text: `${failed} fail`, tone: 'warn' };

  // Quiet mesh (no packets in 5 min) is worth flagging if the radio is otherwise up.
  if (view.lastPacketAt && Date.now() - view.lastPacketAt > 5 * 60 * 1000) {
    return { text: 'quiet', tone: 'warn' };
  }
  return { text: 'ok', tone: 'good' };
}

export function summarizeLinkTest(connections: ConnectionView[]): Badge | undefined {
  const ready = connections.filter((c) => c.state.status === 'ready');
  if (ready.length < 2) return ready.length === 1 ? { text: 'need 2+', tone: 'dim' } : undefined;
  return { text: 'ready', tone: 'good' };
}

export function summarizeDelivery(view: ConnectionView | null): Badge | undefined {
  if (!view) return undefined;
  if (view.traces.length === 0) return undefined;
  const latest = [...view.traces].sort((a, b) => b.sentAt - a.sentAt)[0];
  if (!latest) return undefined;
  if (latest.finalStatus === 'acked') return { text: '✓ ok', tone: 'good' };
  if (latest.finalStatus === 'pending') return { text: 'in flight', tone: 'warn' };
  return { text: '✗ failed', tone: 'bad' };
}
