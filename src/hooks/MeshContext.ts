import { createContext, useContext } from 'react';
import type { ConnectionView } from './useMesh';

export interface MeshContextValue {
  connections: ConnectionView[];
  activeConnId: string | null;
  setActiveConnId: (id: string | null) => void;
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
