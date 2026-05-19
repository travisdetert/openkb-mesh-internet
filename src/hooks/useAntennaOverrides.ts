import { useEffect, useMemo, useState } from 'react';

/**
 * Per-node antenna gain overrides. The catalog Device DB stores the
 * *stock* dBi for each hwModel — fine for an out-of-the-box radio, off
 * by a lot once the user upgrades to e.g. a 5 dBi fibreglass omni. This
 * hook loads the override table from main on mount, listens for
 * change events, and exposes a `gainForNode(node)` helper that returns
 * the *effective* gain (override if set, else the stock value).
 *
 * Lives in the renderer because it's purely UI metadata — Meshtastic's
 * wire protocol has no antenna field, so this never round-trips to the
 * radio.
 */

import { CATALOG } from '../lib/device-catalog';

export interface AntennaOverride {
  nodeNum: number;
  dbi: number;
  notes: string;
  updatedAt: number;
}

export function useAntennaOverrides() {
  const [overrides, setOverrides] = useState<Map<number, AntennaOverride>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void window.mesh.listAntennaOverrides().then((rows) => {
      if (cancelled) return;
      const m = new Map<number, AntennaOverride>();
      for (const r of rows) m.set(r.node_num, { nodeNum: r.node_num, dbi: r.dbi, notes: r.notes, updatedAt: r.updated_at });
      setOverrides(m);
    });
    const off = window.mesh.onAntennaOverrideChanged(({ nodeNum, dbi, notes }) => {
      setOverrides((prev) => {
        const next = new Map(prev);
        if (dbi === null) next.delete(nodeNum);
        else next.set(nodeNum, { nodeNum, dbi, notes, updatedAt: Date.now() });
        return next;
      });
    });
    return () => { cancelled = true; off(); };
  }, []);

  return useMemo(() => {
    const getOverride = (nodeNum: number) => overrides.get(nodeNum);
    /** Effective antenna gain (dBi) for a node — override if set,
     *  catalog stock if known, fallback 2 dBi otherwise. The second
     *  return value flags whether the gain came from an override. */
    const gainForNode = (node?: Pick<NodeRecord, 'num' | 'hwModel'>): { dbi: number; source: 'override' | 'catalog' | 'fallback' } => {
      if (!node) return { dbi: 2, source: 'fallback' };
      const ov = overrides.get(node.num);
      if (ov) return { dbi: ov.dbi, source: 'override' };
      const spec = CATALOG.find((c) => c.hwModel === node.hwModel);
      if (spec) return { dbi: spec.stockAntennaDbi, source: 'catalog' };
      return { dbi: 2, source: 'fallback' };
    };
    return { overrides, getOverride, gainForNode };
  }, [overrides]);
}
