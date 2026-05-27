import { useEffect, useState } from 'react';

export interface BleDevice {
  deviceId: string;
  deviceName: string;
  alreadyOnUsb: boolean;
}

export function useBleScan() {
  const [active, setActive] = useState(false);
  const [devices, setDevices] = useState<BleDevice[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const offUpdate = window.mesh.onBleScanUpdate((p: any) => {
      setActive(true);
      setDevices(p.devices);
      setElapsedMs(p.elapsedMs);
    });
    const offEnded = window.mesh.onBleScanEnded(() => {
      setActive(false);
      setDevices([]);
      setElapsedMs(0);
    });
    return () => { offUpdate(); offEnded(); };
  }, []);

  useEffect(() => {
    if (!active) return;
    const start = Date.now() - elapsedMs;
    const id = setInterval(() => setElapsedMs(Date.now() - start), 1000);
    return () => clearInterval(id);
  }, [active]);

  return { active, devices, elapsedMs };
}

export function looksMeshtastic(name: string): boolean {
  return /Meshtastic|mesh|^[A-Z]{2,4}_[A-F0-9]{4}$/i.test(name);
}
