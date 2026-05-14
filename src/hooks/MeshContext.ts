import { createContext, useContext } from 'react';
import type { ConnectionView } from './useMesh';

/** One reboot we kicked off and are following through its lifecycle. Keyed
 *  by the radio's myNodeNum (stable across the reboot — survives portPath
 *  churn that happens when the device re-enumerates). */
export interface RebootEntry {
  startedAt: number;
  shortName: string;
  longName: string;
  portPath?: string;
}

export interface MeshContextValue {
  connections: ConnectionView[];
  activeConnId: string | null;
  setActiveConnId: (id: string | null) => void;
  /** Radios mid-reboot, keyed by myNodeNum (as string). Both the Connect
   *  wizard's chip strip and the sidebar consume this so the "rebooting…"
   *  state stays consistent everywhere it's surfaced. */
  pendingReboots: Record<string, RebootEntry>;
  markRebootStarted: (myNodeNum: number, info: { shortName: string; longName: string; portPath?: string }) => void;
}

export const MeshContext = createContext<MeshContextValue | null>(null);

/** Read the active mesh connection's id. Returns `null` if no radios are connected. */
export function useActiveConnId(): string | null {
  return useContext(MeshContext)?.activeConnId ?? null;
}

export function useMeshContext(): MeshContextValue {
  const ctx = useContext(MeshContext);
  if (!ctx) throw new Error('useMeshContext must be used inside <MeshContext.Provider>');
  return ctx;
}
