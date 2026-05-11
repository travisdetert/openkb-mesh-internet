// In-memory event bus for typed Updates. Every protocol provider (translator)
// emits BusEvent instances; every panel can subscribe by Update slug, Topic slug,
// or with a free-form predicate. This is the same architectural pattern an
// event-sourced internet would use, scaled down to one app.

import type { Instance } from './concepts/schema';
import { getInstance } from './concepts/registry';

export interface BusEvent {
  /** Slug of the Update Concept Instance this event is. */
  updateSlug: string;
  /** Slug of the Topic Concept Instance, derived from the Update or overridden. */
  topicSlug?: string;
  /** Which protocol provider produced this. */
  sourceProtocolSlug: string;
  /** Wall-clock timestamp ms. */
  ts: number;
  /** Sender (e.g. node id) — opaque, protocol-specific. */
  from?: string | number;
  /** Recipient — undefined for broadcast/channel updates. */
  to?: string | number;
  /** Wire-byte cost as observed (or estimated by the translator). */
  wireBytes?: number;
  /** The decoded payload — protocol-specific shape, panels coerce as needed. */
  payload?: unknown;
}

export interface BusFilter {
  updateSlug?: string;
  topicSlug?: string;
  sourceProtocolSlug?: string;
  predicate?: (e: BusEvent) => boolean;
}

type Handler = (e: BusEvent) => void;

class Bus {
  private subs = new Set<{ filter: BusFilter; handler: Handler }>();
  private buffer: BusEvent[] = [];
  private maxBuffer = 500;

  publish(event: BusEvent): void {
    if (!event.topicSlug) {
      const update = getInstance('update', event.updateSlug);
      if (update?.topic) event.topicSlug = String(update.topic);
    }
    this.buffer.push(event);
    if (this.buffer.length > this.maxBuffer) this.buffer = this.buffer.slice(-this.maxBuffer);

    for (const { filter, handler } of this.subs) {
      if (matches(event, filter)) {
        try { handler(event); } catch { /* a bad subscriber doesn't break the bus */ }
      }
    }
  }

  subscribe(filter: BusFilter, handler: Handler): () => void {
    const entry = { filter, handler };
    this.subs.add(entry);
    return () => { this.subs.delete(entry); };
  }

  /** Return buffered history matching a filter — useful for late subscribers. */
  history(filter: BusFilter = {}): BusEvent[] {
    return this.buffer.filter((e) => matches(e, filter));
  }

  clearBuffer(): void {
    this.buffer = [];
  }

  resolveUpdate(event: BusEvent): Instance | undefined {
    return getInstance('update', event.updateSlug);
  }
}

function matches(event: BusEvent, filter: BusFilter): boolean {
  if (filter.updateSlug && event.updateSlug !== filter.updateSlug) return false;
  if (filter.topicSlug && event.topicSlug !== filter.topicSlug) return false;
  if (filter.sourceProtocolSlug && event.sourceProtocolSlug !== filter.sourceProtocolSlug) return false;
  if (filter.predicate && !filter.predicate(event)) return false;
  return true;
}

export const bus = new Bus();
