import { useEffect, useState } from 'react';

/**
 * Hooks that load + reactively track the user's owned-device roster
 * (per-hwModel) and owned-antenna roster (per-catalog-id). Sibling to
 * useAntennaOverrides — same pattern: load on mount, mutate via IPC,
 * receive change events to keep all consumers in sync.
 */

export interface OwnedDevice {
  hwModel: number;
  quantity: number;
  notes: string;
  updatedAt: number;
}

export interface OwnedAntenna {
  antennaId: string;
  quantity: number;
  notes: string;
  updatedAt: number;
}

export function useOwnedDevices() {
  const [byHwModel, setByHwModel] = useState<Map<number, OwnedDevice>>(new Map());
  useEffect(() => {
    let cancelled = false;
    void window.mesh.listOwnedDevices().then((rows) => {
      if (cancelled) return;
      const m = new Map<number, OwnedDevice>();
      for (const r of rows) m.set(r.hw_model, { hwModel: r.hw_model, quantity: r.quantity, notes: r.notes, updatedAt: r.updated_at });
      setByHwModel(m);
    });
    const off = window.mesh.onOwnedDeviceChanged(({ hwModel, quantity, notes }) => {
      setByHwModel((prev) => {
        const next = new Map(prev);
        if (quantity <= 0) next.delete(hwModel);
        else next.set(hwModel, { hwModel, quantity, notes, updatedAt: Date.now() });
        return next;
      });
    });
    return () => { cancelled = true; off(); };
  }, []);

  return {
    byHwModel,
    isOwned: (hwModel: number) => byHwModel.has(hwModel),
    get: (hwModel: number) => byHwModel.get(hwModel),
    /** Total radio count across all owned models. */
    totalCount: Array.from(byHwModel.values()).reduce((s, d) => s + d.quantity, 0),
  };
}

export function useOwnedAntennas() {
  const [byId, setById] = useState<Map<string, OwnedAntenna>>(new Map());
  useEffect(() => {
    let cancelled = false;
    void window.mesh.listOwnedAntennas().then((rows) => {
      if (cancelled) return;
      const m = new Map<string, OwnedAntenna>();
      for (const r of rows) m.set(r.antenna_id, { antennaId: r.antenna_id, quantity: r.quantity, notes: r.notes, updatedAt: r.updated_at });
      setById(m);
    });
    const off = window.mesh.onOwnedAntennaChanged(({ antennaId, quantity, notes }) => {
      setById((prev) => {
        const next = new Map(prev);
        if (quantity <= 0) next.delete(antennaId);
        else next.set(antennaId, { antennaId, quantity, notes, updatedAt: Date.now() });
        return next;
      });
    });
    return () => { cancelled = true; off(); };
  }, []);

  return {
    byId,
    isOwned: (id: string) => byId.has(id),
    get: (id: string) => byId.get(id),
    totalCount: Array.from(byId.values()).reduce((s, a) => s + a.quantity, 0),
  };
}
