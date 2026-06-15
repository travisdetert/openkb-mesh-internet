import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveConnId, useMeshContext } from '../../hooks/MeshContext';
import { PanelChannelHeader } from '../PanelChannelHeader';
import { haversineKm } from '../../lib/geo';
import { downloadCsv } from '../../lib/csv';
import {
  type View,
  SVG_W,
  SVG_H,
  clampZoom,
  lonToMercX,
  latToMercY,
  mercYToLat,
  mercXToLon,
  projectMeters,
} from '../map/projection';
import { type BasemapStyle, MapTiles, Grid } from '../map/MapLayers';

interface Props {
  nodes: NodeRecord[];
  state: ConnectionState;
  links: LinkRow[];
  onMessageNode?: (num: number) => void;
}

interface PlacedNode {
  node: NodeRecord;
  x: number;
  y: number;
  isMe: boolean;
  isStale: boolean;
}

const STALE_S = 24 * 3600;

/** Render Position.precision_bits as a human radius. ~111km per degree of latitude. */
function precisionMeters(bits?: number): number | undefined {
  if (!bits || bits >= 32) return undefined;
  return (360 / Math.pow(2, bits)) * 111000;
}
function precisionLabel(bits?: number): string {
  const m = precisionMeters(bits);
  if (m === undefined) return '';
  if (m < 1000) return `±${Math.round(m)} m`;
  return `±${(m / 1000).toFixed(m > 10000 ? 0 : 1)} km`;
}

function isStale(secs?: number): boolean {
  if (!secs) return true;
  return Math.floor(Date.now() / 1000) - secs > STALE_S;
}

function ago(secs?: number): string {
  if (!secs) return '—';
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - secs);
  if (delta < 60) return `${delta}s`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`;
  return `${Math.floor(delta / 86400)}d`;
}

export function PositionMapPanel({ nodes, state, links, onMessageNode }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hideStale, setHideStale] = useState(false);
  const [hideMqtt, setHideMqtt] = useState(false);
  const [basemap, setBasemap] = useState<BasemapStyle>('voyager');
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const [centerOverride, setCenterOverride] = useState<{ lat: number; lon: number } | null>(null);
  const dragRef = useRef<{ startLat: number; startLon: number; startClientX: number; startClientY: number; rect: DOMRect; zoom: number } | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const wheelAccumRef = useRef(0);
  const wheelLastRef = useRef(0);
  // Cursor position over the map in screen coords, kept up-to-date by
  // onMouseMove. Used for cursor-anchored wheel zoom so the point under
  // your pointer stays put as the map scales.
  const cursorScreenRef = useRef<{ sxPx: number; syPx: number; lat: number; lon: number } | null>(null);
  // Active pan tween (when smoothly centering on a node). Cancelled if
  // the user starts dragging or zooming.
  const panTweenRef = useRef<number | null>(null);

  // Activity pings: per-node timestamp of the most recent packet we've
  // heard from them. The map renders an expanding ring per node, keyed
  // by that timestamp so the ring re-mounts (and replays the animation)
  // each time a new packet lands.
  const { connections, activeConnId } = useMeshContext();
  const activeConn = connections.find((c) => c.connId === activeConnId);
  const nodePings = useMemo(() => {
    const out = new Map<number, number>();
    if (!activeConn) return out;
    const cutoff = Date.now() - 5 * 60_000; // ignore pings older than 5min
    for (const p of activeConn.recentPackets) {
      if (p.receivedAt < cutoff) continue;
      const prev = out.get(p.from);
      if (prev === undefined || p.receivedAt > prev) out.set(p.from, p.receivedAt);
    }
    return out;
  }, [activeConn]);
  // Force re-render every second so the age-based opacity on pings/links
  // updates smoothly. Cheap — just a tick counter.
  const [, setMapTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMapTick((n) => (n + 1) & 0xffff), 1000);
    return () => clearInterval(id);
  }, []);
  // Tear down any active pan tween when the map unmounts (panel switch).
  useEffect(() => () => {
    if (panTweenRef.current !== null) cancelAnimationFrame(panTweenRef.current);
  }, []);

  const positionedAll = useMemo(
    () => nodes.filter((n) => n.lat !== undefined && n.lon !== undefined && (n.lat !== 0 || n.lon !== 0)),
    [nodes],
  );
  const positioned = useMemo(
    () => {
      let out = positionedAll;
      if (hideStale) out = out.filter((n) => !isStale(n.lastHeard));
      if (hideMqtt) out = out.filter((n) => !n.viaMqtt);
      return out;
    },
    [positionedAll, hideStale, hideMqtt],
  );

  const myId = state.myInfo?.myNodeNum;
  const me = positioned.find((n) => n.num === myId);

  // Picking what to AUTO-FIT to is separate from what to RENDER. We
  // render every positioned node, but the camera should focus on the
  // local cluster — an MQTT-fed peer 5000 km away shouldn't drag the
  // whole map to continental scale on first paint. The user can still
  // toggle MQTT visibility or reset the view to see the full spread.
  const autoFitNodes = useMemo(() => pickAutoFitNodes(positioned, me), [positioned, me]);
  const autoView = useMemo(() => computeView(autoFitNodes, me), [autoFitNodes, me]);

  // Apply user pan/zoom on top of the auto-fit view.
  const view = useMemo<View | null>(() => {
    if (!autoView) return null;
    const zoom = clampZoom(zoomOverride ?? autoView.zoom);
    const center = centerOverride ?? { lat: autoView.centerLat, lon: autoView.centerLon };
    const centerMx = lonToMercX(center.lon, zoom);
    const centerMy = latToMercY(center.lat, zoom);
    const minMx = centerMx - SVG_W / 2;
    const maxMx = centerMx + SVG_W / 2;
    const minMy = centerMy - SVG_H / 2;
    const maxMy = centerMy + SVG_H / 2;
    const minLat = mercYToLat(maxMy, zoom);
    const maxLat = mercYToLat(minMy, zoom);
    const minLon = mercXToLon(minMx, zoom);
    const maxLon = mercXToLon(maxMx, zoom);
    return {
      centerLat: center.lat,
      centerLon: center.lon,
      spanLat: maxLat - minLat,
      spanLon: maxLon - minLon,
      spanKm: haversineKm(minLat, minLon, maxLat, maxLon),
      zoom, minMx, maxMx, minMy, maxMy,
    };
  }, [autoView, zoomOverride, centerOverride]);

  const userInteracted = zoomOverride !== null || centerOverride !== null;

  /**
   * Zoom by `delta` integer steps. When `anchorScreenX/Y` are given (the
   * cursor's pixel position over the SVG), we adjust the center so the
   * point under the cursor stays put — the rest of the map "scales away
   * from" or "into" the cursor. Without anchors, falls back to centered
   * zoom.
   */
  const adjustZoom = (delta: number, anchor?: { sxPx: number; syPx: number; lat: number; lon: number }) => {
    if (!view) return;
    cancelPanTween(); // Any zoom interaction cancels an in-flight pan tween
    const newZoom = clampZoom(view.zoom + delta);
    if (newZoom === view.zoom) return;
    if (anchor) {
      // Mercator coords of the anchor at the new zoom.
      const anchorMxNew = lonToMercX(anchor.lon, newZoom);
      const anchorMyNew = latToMercY(anchor.lat, newZoom);
      // New min corner so the anchor lands at the same screen pixel.
      const minMxNew = anchorMxNew - anchor.sxPx;
      const minMyNew = anchorMyNew - anchor.syPx;
      const centerMxNew = minMxNew + SVG_W / 2;
      const centerMyNew = minMyNew + SVG_H / 2;
      setCenterOverride({
        lat: mercYToLat(centerMyNew, newZoom),
        lon: mercXToLon(centerMxNew, newZoom),
      });
    } else if (centerOverride === null) {
      setCenterOverride({ lat: view.centerLat, lon: view.centerLon });
    }
    setZoomOverride(newZoom);
  };

  function cancelPanTween() {
    if (panTweenRef.current !== null) {
      cancelAnimationFrame(panTweenRef.current);
      panTweenRef.current = null;
    }
  }

  /**
   * Smoothly tween the camera from its current center to (lat, lon) over
   * `durationMs`. Mid-tween user drags or wheel zooms cancel it. Optional
   * `targetZoom` zooms in/out along the way (useful for click-to-recenter
   * which also zooms in one step).
   */
  function panTo(targetLat: number, targetLon: number, durationMs = 450, targetZoom?: number) {
    if (!view) return;
    cancelPanTween();
    const startLat = view.centerLat;
    const startLon = view.centerLon;
    const startZoom = view.zoom;
    const endZoom = targetZoom !== undefined ? clampZoom(targetZoom) : startZoom;
    const startTs = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const t = Math.min(1, (now - startTs) / durationMs);
      const e = easeOut(t);
      const lat = startLat + (targetLat - startLat) * e;
      const lon = startLon + (targetLon - startLon) * e;
      setCenterOverride({ lat, lon });
      if (startZoom !== endZoom) setZoomOverride(clampZoom(Math.round(startZoom + (endZoom - startZoom) * e)));
      if (t < 1) {
        panTweenRef.current = requestAnimationFrame(step);
      } else {
        panTweenRef.current = null;
      }
    };
    panTweenRef.current = requestAnimationFrame(step);
  }

  const resetView = () => { cancelPanTween(); setZoomOverride(null); setCenterOverride(null); };
  const recenterOnMe = () => {
    if (!me?.lat || !me?.lon) return;
    panTo(me.lat, me.lon);
  };
  const recenterOnNode = (n: NodeRecord) => {
    if (n.lat == null || n.lon == null) return;
    // Smoothly fly to the node and bump zoom by one level — feels much
    // more "alive" than the previous snap-cut.
    panTo(n.lat, n.lon, 500, (view?.zoom ?? autoView?.zoom ?? 12) + 1);
  };
  /** Search-driven jump: select + fly to a node at a useful zoom level. */
  const flyToNode = (n: NodeRecord) => {
    if (n.lat == null || n.lon == null) return;
    setSelectedId(n.num);
    panTo(n.lat, n.lon, 600, Math.max(view?.zoom ?? 12, 14));
  };

  const [hoverNum, setHoverNum] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [cursorLatLon, setCursorLatLon] = useState<{ lat: number; lon: number } | null>(null);
  const [coordsCopied, setCoordsCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  // Distance ruler: shift-click places point A, second shift-click places
  // B. A third shift-click resets to a new A. Esc clears entirely.
  const [rulerStart, setRulerStart] = useState<{ lat: number; lon: number } | null>(null);
  const [rulerEnd, setRulerEnd] = useState<{ lat: number; lon: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'map' | 'data'>('map');
  const [showLinks, setShowLinks] = useState(true);
  const [showDistances, setShowDistances] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [coverageSamples, setCoverageSamples] = useState<PathLossSample[]>([]);
  const [showTrails, setShowTrails] = useState(false);
  const [trailPoints, setTrailPoints] = useState<Array<{ node_num: number; lat: number; lon: number; ts: number }>>([]);

  // Fetch path-loss samples whenever the coverage overlay is enabled. We use
  // a 30-day window — enough history to fit a stable model without including
  // old positions that may no longer reflect terrain (after moves).
  useEffect(() => {
    if (!showCoverage) return;
    let cancelled = false;
    window.mesh.pathLossSamples({ sinceMs: Date.now() - 30 * 24 * 60 * 60 * 1000 })
      .then((s) => { if (!cancelled) setCoverageSamples(s); });
    return () => { cancelled = true; };
  }, [showCoverage]);

  // Position trails — last 24h of fixes per node. Re-queried whenever the
  // trail overlay is toggled on; the 24h window keeps the visual signal
  // strong without dragging in stale history from prior trips.
  useEffect(() => {
    if (!showTrails) return;
    let cancelled = false;
    window.mesh.positionTrails({ sinceMs: Date.now() - 24 * 60 * 60 * 1000 })
      .then((rows) => { if (!cancelled) setTrailPoints(rows); });
    return () => { cancelled = true; };
  }, [showTrails]);

  // Fit a log-distance path-loss model: RSSI = intercept + slope * log10(d_km).
  // The exponent n is -slope / 10 (so slope = -10n in dB per decade of distance).
  // We weight every direct (hop 0) sample equally and ignore distance-zero
  // (self) and absurdly far samples that would skew the fit.
  const coverageFit = useMemo(() => {
    if (!me?.lat || !me?.lon) return null;
    const prepared = coverageSamples
      .filter((s) => s.hopsAway === 0)
      .map((s) => ({ rssi: s.rssi, distKm: haversineKm(me.lat!, me.lon!, s.lat, s.lon) }))
      .filter((s) => s.distKm > 0.001 && s.distKm < 200);
    if (prepared.length < 3) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const s of prepared) {
      const x = Math.log10(s.distKm);
      sx += x; sy += s.rssi; sxx += x * x; sxy += x * s.rssi;
    }
    const n = prepared.length;
    const denom = sxx - sx * sx / n;
    if (Math.abs(denom) < 1e-9) return null;
    const slope = (sxy - sx * sy / n) / denom;
    const intercept = sy / n - slope * sx / n;
    return { intercept, slope, exponent: -slope / 10, sampleCount: n };
  }, [coverageSamples, me?.lat, me?.lon]);

  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!view) return;
    e.preventDefault();
    // Shift-click: place a ruler point instead of starting a pan-drag.
    // First shift-click sets A, second sets B, third resets to a new A.
    if (e.shiftKey) {
      const rect = e.currentTarget.getBoundingClientRect();
      const sxPx = (e.clientX - rect.left) * (SVG_W / rect.width);
      const syPx = (e.clientY - rect.top) * (SVG_H / rect.height);
      const mx = view.minMx + sxPx;
      const my = view.minMy + syPx;
      const pt = { lat: mercYToLat(my, view.zoom), lon: mercXToLon(mx, view.zoom) };
      if (!rulerStart || rulerEnd) {
        setRulerStart(pt);
        setRulerEnd(null);
      } else {
        setRulerEnd(pt);
      }
      return;
    }
    cancelPanTween(); // drag overrides any in-flight smooth pan
    dragRef.current = {
      startLat: view.centerLat,
      startLon: view.centerLon,
      startClientX: e.clientX,
      startClientY: e.clientY,
      rect: e.currentTarget.getBoundingClientRect(),
      zoom: view.zoom,
    };
  };
  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    // Always update cursor lat/lon so the bottom-right readout is live
    // AND cursor screen coords for cursor-anchored wheel zoom.
    if (view) {
      const rect = e.currentTarget.getBoundingClientRect();
      const sxPx = (e.clientX - rect.left) * (SVG_W / rect.width);
      const syPx = (e.clientY - rect.top) * (SVG_H / rect.height);
      const mx = view.minMx + sxPx;
      const my = view.minMy + syPx;
      const lat = mercYToLat(my, view.zoom);
      const lon = mercXToLon(mx, view.zoom);
      setCursorLatLon({ lat, lon });
      cursorScreenRef.current = { sxPx, syPx, lat, lon };
    }
    const d = dragRef.current;
    if (!d) return;
    const dxPx = e.clientX - d.startClientX;
    const dyPx = e.clientY - d.startClientY;
    if (Math.abs(dxPx) < 3 && Math.abs(dyPx) < 3) return;
    const dxMerc = dxPx * (SVG_W / d.rect.width);
    const dyMerc = dyPx * (SVG_H / d.rect.height);
    const newCenterMx = lonToMercX(d.startLon, d.zoom) - dxMerc;
    const newCenterMy = latToMercY(d.startLat, d.zoom) - dyMerc;
    setCenterOverride({
      lat: mercYToLat(newCenterMy, d.zoom),
      lon: mercXToLon(newCenterMx, d.zoom),
    });
  };
  const endDrag: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    // If the mouseup landed on the SVG background (no node hit) and there was
    // no drag motion, treat it as a click-to-deselect.
    if (!d) return;
    const dxPx = e.clientX - d.startClientX;
    const dyPx = e.clientY - d.startClientY;
    if (Math.abs(dxPx) < 3 && Math.abs(dyPx) < 3) {
      const target = e.target as Element;
      const onNode = target.closest('[data-node-num]');
      if (!onNode) setSelectedId(null);
    }
  };
  const onMouseLeave = () => {
    dragRef.current = null;
    setHoverNum(null);
    setCursorLatLon(null);
  };

  // Double-click anywhere on the map: zoom in one step at the click
  // point. Shift+dbl-click zooms out. Node-level onDoubleClick still
  // wins because the node handler stops propagation before this fires.
  const onMapDoubleClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!view) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const sxPx = (e.clientX - rect.left) * (SVG_W / rect.width);
    const syPx = (e.clientY - rect.top) * (SVG_H / rect.height);
    const mx = view.minMx + sxPx;
    const my = view.minMy + syPx;
    adjustZoom(e.shiftKey ? -1 : 1, {
      sxPx, syPx,
      lat: mercYToLat(my, view.zoom),
      lon: mercXToLon(mx, view.zoom),
    });
  };

  // Keyboard navigation. The container is focusable (tabIndex=0) so
  // clicking it focuses; arrow keys pan, +/- zoom (anchored to the
  // current cursor position if known), 0 resets, c centers on me.
  const onMapKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (!view) return;
    const key = e.key;
    // Pan step: 1/6 of the viewport per press — fast but not jarring.
    const panBy = (dxFrac: number, dyFrac: number) => {
      const centerMx = lonToMercX(view.centerLon, view.zoom) + dxFrac * SVG_W;
      const centerMy = latToMercY(view.centerLat, view.zoom) + dyFrac * SVG_H;
      cancelPanTween();
      setCenterOverride({
        lat: mercYToLat(centerMy, view.zoom),
        lon: mercXToLon(centerMx, view.zoom),
      });
    };
    if (key === '+' || key === '=') { e.preventDefault(); adjustZoom(1, cursorScreenRef.current ?? undefined); return; }
    if (key === '-' || key === '_') { e.preventDefault(); adjustZoom(-1, cursorScreenRef.current ?? undefined); return; }
    if (key === '0')                 { e.preventDefault(); resetView(); return; }
    if (key === 'c' || key === 'C') { e.preventDefault(); recenterOnMe(); return; }
    if (key === '?')                { e.preventDefault(); setShowHelp((v) => !v); return; }
    if (key === 'Escape')           { e.preventDefault(); setShowHelp(false); setRulerStart(null); setRulerEnd(null); return; }
    if (key === 'ArrowLeft')        { e.preventDefault(); panBy(-1/6, 0); return; }
    if (key === 'ArrowRight')       { e.preventDefault(); panBy( 1/6, 0); return; }
    if (key === 'ArrowUp')          { e.preventDefault(); panBy(0, -1/6); return; }
    if (key === 'ArrowDown')        { e.preventDefault(); panBy(0,  1/6); return; }
  };

  // Copy the current cursor coords to clipboard with a brief confirmation.
  const copyCursorCoords = async () => {
    if (!cursorLatLon) return;
    const text = `${cursorLatLon.lat.toFixed(5)}, ${cursorLatLon.lon.toFixed(5)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCoordsCopied(true);
      setTimeout(() => setCoordsCopied(false), 1200);
    } catch { /* clipboard may be unavailable; user can select & copy */ }
  };

  // React's onWheel is passive by default, so e.preventDefault() is ignored.
  // Attach a non-passive listener directly to the DOM node so the page doesn't
  // scroll while we're zooming the map.
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!view) return;
      e.preventDefault();
      const now = Date.now();
      // Reset accumulator after a brief idle period so successive bursts feel
      // like discrete actions, not one continuous zoom.
      if (now - wheelLastRef.current > 250) wheelAccumRef.current = 0;
      wheelAccumRef.current += e.deltaY;
      wheelLastRef.current = now;
      const STEP = 60;
      if (Math.abs(wheelAccumRef.current) >= STEP) {
        const steps = Math.trunc(wheelAccumRef.current / STEP);
        wheelAccumRef.current -= steps * STEP;
        // Cursor-anchored zoom: keep the point under the cursor stationary.
        adjustZoom(-steps, cursorScreenRef.current ?? undefined);
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [view]);

  const placed: PlacedNode[] = useMemo(() => {
    if (!view) return [];
    return positioned.map((n) => ({
      node: n,
      ...projectMeters(n.lat!, n.lon!, view),
      isMe: n.num === myId,
      isStale: isStale(n.lastHeard),
    }));
  }, [positioned, view, myId]);

  const selected = placed.find((p) => p.node.num === selectedId)?.node;
  const meBlock = placed.find((p) => p.isMe);
  const staleCount = positionedAll.length - positionedAll.filter((n) => !isStale(n.lastHeard)).length;

  // Search matches — case-insensitive substring over shortName, longName,
  // and hex node id. Capped at 6 results so the dropdown stays compact.
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as NodeRecord[];
    return positioned
      .filter((n) => {
        const hex = '!' + n.num.toString(16).padStart(8, '0');
        return (n.shortName || '').toLowerCase().includes(q)
          || (n.longName || '').toLowerCase().includes(q)
          || (n.id || '').toLowerCase().includes(q)
          || hex.includes(q);
      })
      .slice(0, 6);
  }, [searchQuery, positioned]);

  // Focus mode: when ON and a node is selected, the neighbor set is the
  // selected node plus every node connected to it by a mesh edge. Used
  // by the renderer to dim non-neighbors and edges that don't touch the
  // selected node. Falls back to null (no dimming) if there's nothing
  // useful to focus on.
  const focusNeighbors = useMemo(() => {
    if (!focusMode || selectedId == null) return null;
    const set = new Set<number>([selectedId]);
    for (const l of links) {
      if (l.a_num === selectedId) set.add(l.b_num);
      if (l.b_num === selectedId) set.add(l.a_num);
    }
    return set;
  }, [focusMode, selectedId, links]);

  // Group trail rows by node and keep only nodes that genuinely moved.
  // "Moved" = the bounding box of the trail spans more than ~30 meters.
  // Stationary nodes get filtered out so the canvas isn't full of dots
  // sitting on top of their current pin.
  const trails = useMemo(() => {
    if (!showTrails || trailPoints.length === 0) return [] as Array<{ nodeNum: number; pts: typeof trailPoints }>;
    const grouped = new Map<number, typeof trailPoints>();
    for (const p of trailPoints) {
      const list = grouped.get(p.node_num) ?? [];
      list.push(p);
      grouped.set(p.node_num, list);
    }
    const out: Array<{ nodeNum: number; pts: typeof trailPoints }> = [];
    for (const [nodeNum, pts] of grouped) {
      if (pts.length < 2) continue;
      let minLat = pts[0].lat, maxLat = pts[0].lat, minLon = pts[0].lon, maxLon = pts[0].lon;
      for (const p of pts) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
      }
      // ~111 km per degree of latitude; rough but fine for the threshold.
      const spanM = Math.max(maxLat - minLat, (maxLon - minLon) * Math.cos((minLat + maxLat) / 2 * Math.PI / 180)) * 111000;
      if (spanM >= 30) out.push({ nodeNum, pts });
    }
    return out;
  }, [trailPoints, showTrails]);

  // ── Low-zoom clustering ────────────────────────────────────────────
  // At wide zoom levels, dots and labels stack into a "wall of text".
  // Bucket the placed-node positions into a coarse grid and render each
  // bucket with ≥2 occupants as a single cluster glyph (count inside).
  // "Me" and the selected node are exempt so they're never hidden.
  // Clicking a cluster zooms in to its center.
  const CLUSTER_BUCKET_PX = 36; // SVG units
  const clusters = useMemo(() => {
    if (!view || view.zoom > 9 || placed.length === 0) return null;
    const buckets = new Map<string, PlacedNode[]>();
    for (const p of placed) {
      if (p.isMe || p.node.num === selectedId) continue;
      const bx = Math.floor(p.x / CLUSTER_BUCKET_PX);
      const by = Math.floor(p.y / CLUSTER_BUCKET_PX);
      const key = `${bx}|${by}`;
      const list = buckets.get(key) ?? [];
      list.push(p);
      buckets.set(key, list);
    }
    const out: Array<{ x: number; y: number; count: number; members: number[] }> = [];
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const cx = list.reduce((s, p) => s + p.x, 0) / list.length;
      const cy = list.reduce((s, p) => s + p.y, 0) / list.length;
      out.push({ x: cx, y: cy, count: list.length, members: list.map((p) => p.node.num) });
    }
    return out;
  }, [view, placed, selectedId]);
  const clusteredNums = useMemo(() => {
    const s = new Set<number>();
    if (clusters) for (const c of clusters) for (const n of c.members) s.add(n);
    return s;
  }, [clusters]);

  // ── Label declutter ────────────────────────────────────────────────
  // Greedy collision avoidance: walk labels in priority order (me, then
  // selected, then focus neighbors, then by recency) and only render
  // ones whose bounding box doesn't overlap an already-placed label.
  // Hidden labels still hover-reveal via the existing tooltip path.
  const labelShown = useMemo(() => {
    const visible = placed.filter((p) => !clusteredNums.has(p.node.num));
    const priority = (p: PlacedNode) =>
      (p.isMe ? 1000 : 0)
      + (p.node.num === selectedId ? 500 : 0)
      + (focusNeighbors?.has(p.node.num) ? 200 : 0)
      + (p.node.lastHeard ?? 0) / 1e10;
    const sorted = [...visible].sort((a, b) => priority(b) - priority(a));
    const placedBoxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    const shown = new Set<number>();
    for (const p of sorted) {
      const fontSize = p.isMe ? 14 : 12;
      const label = p.node.shortName || '????';
      const w = Math.max(20, label.length * fontSize * 0.62);
      const h = fontSize + 4;
      const yCenter = p.y - (p.isMe ? 18 : 14);
      const box = { x0: p.x - w / 2, y0: yCenter - h / 2, x1: p.x + w / 2, y1: yCenter + h / 2 };
      let collides = false;
      for (const b of placedBoxes) {
        if (!(box.x1 < b.x0 || b.x1 < box.x0 || box.y1 < b.y0 || b.y1 < box.y0)) {
          collides = true; break;
        }
      }
      if (!collides) { shown.add(p.node.num); placedBoxes.push(box); }
    }
    return shown;
  }, [placed, clusteredNums, selectedId, focusNeighbors]);

  // Build renderable mesh edges: link rows where BOTH endpoints have positions.
  const placedByNum = useMemo(() => {
    const m = new Map<number, PlacedNode>();
    for (const p of placed) m.set(p.node.num, p);
    return m;
  }, [placed]);
  const meshEdges = useMemo(() => {
    if (!showLinks) return [] as Array<{ a: PlacedNode; b: PlacedNode; distKm: number; rssi: number; snr: number; count: number; lastTs: number; }>;
    const edges: Array<{ a: PlacedNode; b: PlacedNode; distKm: number; rssi: number; snr: number; count: number; lastTs: number; }> = [];
    for (const l of links) {
      const a = placedByNum.get(l.a_num);
      const b = placedByNum.get(l.b_num);
      if (!a || !b) continue;
      const distKm = haversineKm(a.node.lat!, a.node.lon!, b.node.lat!, b.node.lon!);
      edges.push({ a, b, distKm, rssi: l.rssi_max ?? 0, snr: l.snr_avg ?? 0, count: l.count, lastTs: l.last_ts ?? 0 });
    }
    return edges;
  }, [links, placedByNum, showLinks]);

  return (
    <div className="page">
      <h1 className="page-title">Map</h1>
      <p className="page-sub">
        Nodes that share GPS over the mesh appear here. <strong>Drag</strong> to pan, <strong>scroll</strong> or <strong>double-click</strong> to zoom (shift+double-click to zoom out), <strong>arrow keys</strong> pan, <strong>+/−</strong> zoom, <strong>0</strong> reset, <strong>c</strong> centers on you. Basemap tiles © OpenStreetMap / © CARTO.
      </p>

      <PanelChannelHeader state={state} label="VIEWING FROM" />

      <div className="subnav">
        <button className={'subnav-btn' + (activeTab === 'map' ? ' active' : '')} onClick={() => setActiveTab('map')}>
          Map
        </button>
        <button className={'subnav-btn' + (activeTab === 'data' ? ' active' : '')} onClick={() => setActiveTab('data')}>
          Data <span className="subnav-count">{placed.length}</span>
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {activeTab === 'data' && placed.length > 0 && (
            <button
              className="ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => exportCsv(placed, me, state.loraConfig?.txPower || 17)}
              title="Download positioned nodes as CSV"
            >
              ⇩ Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="layout-split-wide">
        <div>
          {activeTab === 'map' && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>{positioned.length} node{positioned.length === 1 ? '' : 's'} with position</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--text-faint)', flexWrap: 'wrap' }}>
                {staleCount > 0 && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={hideStale} onChange={(e) => setHideStale(e.target.checked)} />
                    hide stale ({staleCount})
                  </label>
                )}
                {(() => {
                  const mqttPositioned = positionedAll.filter((n) => n.viaMqtt).length;
                  return mqttPositioned > 0 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input type="checkbox" checked={hideMqtt} onChange={(e) => setHideMqtt(e.target.checked)} />
                      local mesh only — hide {mqttPositioned} MQTT
                    </label>
                  );
                })()}
                {view && <span style={{ fontFamily: 'var(--mono)' }}>z{view.zoom} · {Math.round(view.spanKm * 100) / 100} km</span>}
              </div>
            </div>

            {positioned.length === 0 ? (
              <div className="empty">
                <p style={{ margin: '0 0 6px' }}>No nodes have shared a position{hideStale && positionedAll.length > 0 ? ' recently' : ' yet'}.</p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                  Position broadcasts default to every 15 minutes. Even with GPS lock, a node only transmits position when it moves more than the configured threshold or the timer expires. Some users disable position-sharing entirely for privacy.
                </p>
              </div>
            ) : (
              <div
                ref={mapContainerRef}
                tabIndex={0}
                role="application"
                aria-label="Mesh map — pan with drag or arrow keys, zoom with scroll or +/-, double-click to zoom in"
                style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', background: 'var(--bg)', borderRadius: 6, overflow: 'hidden', cursor: dragRef.current ? 'grabbing' : 'grab', userSelect: 'none', outline: 'none' }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={endDrag}
                onMouseLeave={onMouseLeave}
                onDoubleClick={onMapDoubleClick}
                onKeyDown={onMapKeyDown}
              >
                <svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid meet">
                  <MapTiles view={view!} style={basemap} />
                  <Grid view={view!} basemap={basemap} />

                  {showCoverage && view && me?.lat !== undefined && me?.lon !== undefined && coverageFit && (
                    <CoverageHeatmap view={view!} myLat={me.lat!} myLon={me.lon!} fit={coverageFit} />
                  )}

                  {/* Precision halos render under everything else */}
                  {placed.map((p) => {
                    const precM = precisionMeters(p.node.posPrecisionBits);
                    if (!precM || !view) return null;
                    const radPx = (precM / 1000 / view.spanKm) * 1600;
                    if (radPx < 4) return null;
                    return (
                      <circle
                        key={`prec-${p.node.num}`}
                        cx={p.x} cy={p.y} r={radPx}
                        fill={p.isMe ? 'rgba(92,200,255,0.06)' : 'rgba(255,209,102,0.06)'}
                        stroke={p.isMe ? 'rgba(92,200,255,0.25)' : 'rgba(255,209,102,0.25)'}
                        strokeDasharray="2 4"
                        strokeWidth={1}
                      />
                    );
                  })}

                  {/* Position trails — last-24h breadcrumbs for nodes that
                    *  actually moved. Newer segments draw on top with higher
                    *  opacity; older ones fade so a trail visibly "ages out"
                    *  along its length. Rendered under mesh edges so live
                    *  links stay visually dominant. */}
                  {view && showTrails && trails.map((t) => {
                    if (t.pts.length < 2) return null;
                    const segs: React.ReactNode[] = [];
                    const now = Date.now();
                    for (let i = 0; i < t.pts.length - 1; i++) {
                      const p0 = t.pts[i];
                      const p1 = t.pts[i + 1];
                      const a = projectMeters(p0.lat, p0.lon, view);
                      const b = projectMeters(p1.lat, p1.lon, view);
                      const ageH = Math.max(0, (now - p1.ts) / 3600_000);
                      const opacity = Math.max(0.06, 0.55 * Math.exp(-ageH / 8));
                      segs.push(
                        <line
                          key={`tr-${t.nodeNum}-${i}`}
                          x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                          stroke="#ffd166"
                          strokeWidth={1.5}
                          opacity={opacity}
                          strokeLinecap="round"
                        />,
                      );
                    }
                    return <g key={`trail-${t.nodeNum}`} style={{ pointerEvents: 'none' }}>{segs}</g>;
                  })}

                  {/* Mesh-wide link edges from the observed-links DB */}
                  {meshEdges.map((e, i) => {
                    const dim = e.a.isStale || e.b.isStale;
                    // Stroke darkness/thickness scaled by RSSI (better = stronger line) and observation count.
                    const strength = e.rssi !== 0 ? Math.max(0, Math.min(1, (e.rssi + 130) / 50)) : 0.3;
                    // Age fade: links observed in the last hour are full
                    // strength; week-old links drop to ~15%. Helps the
                    // map "breathe" — yesterday's neighbours aren't drawn
                    // with the same confidence as the ones still active.
                    const ageMs = e.lastTs > 0 ? Math.max(0, Date.now() - e.lastTs) : 0;
                    const ageFactor = e.lastTs === 0 ? 0.5
                      : ageMs < 3600_000 ? 1
                      : ageMs < 6 * 3600_000 ? 0.7
                      : ageMs < 24 * 3600_000 ? 0.45
                      : ageMs < 7 * 24 * 3600_000 ? 0.25
                      : 0.12;
                    // Focus mode: dim edges that don't touch the selected
                    // node. Edges between two non-neighbors disappear; edges
                    // from selected → neighbor stay full strength.
                    const focusDim = focusNeighbors
                      ? (focusNeighbors.has(e.a.node.num) && focusNeighbors.has(e.b.node.num)
                          && (e.a.node.num === selectedId || e.b.node.num === selectedId) ? 1 : 0.1)
                      : 1;
                    const opacity = (dim ? 0.25 : 0.55) * (0.4 + 0.6 * strength) * ageFactor * focusDim;
                    const width = 0.8 + 1.4 * Math.min(1, Math.log10(1 + e.count) / 1.5);
                    return (
                      <line
                        key={`mesh-${i}`}
                        x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y}
                        stroke={basemap === 'light' ? '#0c5fa3' : '#5cc8ff'}
                        strokeWidth={width}
                        opacity={opacity}
                      >
                        {e.lastTs > 0 && (
                          <title>Last seen {ago(Math.floor(e.lastTs / 1000))} ago · {e.count} packets · RSSI max {e.rssi || '?'} dBm · SNR avg {e.snr.toFixed(1)} dB</title>
                        )}
                      </line>
                    );
                  })}
                  {/* Distance labels at edge midpoints (optional toggle) */}
                  {showDistances && meshEdges.map((e, i) => {
                    const mx = (e.a.x + e.b.x) / 2;
                    const my = (e.a.y + e.b.y) / 2;
                    const label = e.distKm < 1 ? `${(e.distKm * 1000).toFixed(0)}m` : `${e.distKm.toFixed(1)}km`;
                    return (
                      <text key={`dist-${i}`}
                        x={mx} y={my}
                        textAnchor="middle"
                        fontSize={10}
                        fill={basemap === 'light' ? '#1a1d23' : '#e6e8ee'}
                        stroke={basemap === 'light' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)'}
                        strokeWidth={2.5}
                        paintOrder="stroke fill"
                        fontFamily="ui-monospace, Menlo, monospace"
                        opacity={(e.a.isStale || e.b.isStale) ? 0.55 : 1}
                      >
                        {label}
                      </text>
                    );
                  })}

                  {/* RF link lines from your radio (kept on top of mesh edges, more saturated) */}
                  {meBlock && placed.filter((p) => !p.isMe).map((p) => (
                    <line key={`l-${p.node.num}`}
                          x1={meBlock.x}
                          y1={meBlock.y}
                          x2={p.x} y2={p.y}
                          stroke={(p.node.hopsAway ?? 0) === 0 ? 'rgba(102,211,154,0.3)' : 'rgba(255,209,102,0.2)'}
                          strokeWidth={1}
                          strokeDasharray={(p.node.hopsAway ?? 0) > 0 ? '4 4' : ''}
                          opacity={p.isStale ? 0.35 : 1}
                    />
                  ))}

                  {/* Activity pings — an expanding ring per node when a
                    *  packet from them lands. Keyed by receivedAt so each
                    *  new packet replays the animation. Stays mounted ~1.4s
                    *  then auto-fades to invisible. Pointer-events disabled
                    *  so it doesn't steal clicks from the node dot. */}
                  {placed.map((p) => {
                    const lastPing = nodePings.get(p.node.num);
                    if (!lastPing || Date.now() - lastPing > 5000) return null;
                    const fill = p.isMe ? '#5cc8ff' : p.node.viaMqtt ? '#b88aff' : (p.node.hopsAway ?? 0) === 0 ? '#66d39a' : '#ffd166';
                    return (
                      <circle
                        key={`ping-${p.node.num}-${lastPing}`}
                        cx={p.x} cy={p.y}
                        fill="none"
                        stroke={fill}
                        strokeWidth={2}
                        style={{ pointerEvents: 'none' }}
                      >
                        <animate attributeName="r"       from={p.isMe ? 12 : 9} to="42" dur="1.4s" begin="0s" fill="freeze" />
                        <animate attributeName="opacity" from="0.75"            to="0"  dur="1.4s" begin="0s" fill="freeze" />
                      </circle>
                    );
                  })}

                  {/* Distance ruler. Shift-click two points on the map to
                    *  measure. Renders A + line + B with a distance + free-
                    *  space path-loss readout at the current LoRa frequency. */}
                  {view && rulerStart && (() => {
                    const a = projectMeters(rulerStart.lat, rulerStart.lon, view);
                    const b = rulerEnd ? projectMeters(rulerEnd.lat, rulerEnd.lon, view) : null;
                    const distKm = b ? haversineKm(rulerStart.lat, rulerStart.lon, rulerEnd!.lat, rulerEnd!.lon) : 0;
                    const freqMhz = regionToMhz(state.loraConfig?.region);
                    const fsplDb = b && distKm > 0 ? 20 * Math.log10(distKm) + 20 * Math.log10(freqMhz) + 32.45 : 0;
                    const distLabel = distKm < 1
                      ? `${(distKm * 1000).toFixed(0)} m`
                      : distKm < 100 ? `${distKm.toFixed(2)} km` : `${distKm.toFixed(0)} km`;
                    const miLabel = distKm < 1.609 ? `${(distKm * 1093.6).toFixed(0)} yd` : `${(distKm / 1.609).toFixed(2)} mi`;
                    return (
                      <g style={{ pointerEvents: 'none' }}>
                        {b && (
                          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                                stroke="#ffd166" strokeWidth={2.5}
                                strokeDasharray="6 4" opacity={0.9} />
                        )}
                        <circle cx={a.x} cy={a.y} r={6} fill="#ffd166" stroke="#000" strokeWidth={1.5} />
                        <text x={a.x + 8} y={a.y - 8} fontSize={12} fontWeight={700} fill="#ffd166"
                              stroke="rgba(0,0,0,0.75)" strokeWidth={3} paintOrder="stroke fill"
                              fontFamily="ui-monospace, Menlo, monospace">A</text>
                        {b && (
                          <>
                            <circle cx={b.x} cy={b.y} r={6} fill="#ffd166" stroke="#000" strokeWidth={1.5} />
                            <text x={b.x + 8} y={b.y - 8} fontSize={12} fontWeight={700} fill="#ffd166"
                                  stroke="rgba(0,0,0,0.75)" strokeWidth={3} paintOrder="stroke fill"
                                  fontFamily="ui-monospace, Menlo, monospace">B</text>
                            <g transform={`translate(${(a.x + b.x) / 2}, ${(a.y + b.y) / 2 - 14})`}>
                              <rect x={-78} y={-22} width={156} height={36} rx={4}
                                    fill="rgba(15,17,21,0.92)" stroke="#ffd166" strokeWidth={1} />
                              <text x={0} y={-6} textAnchor="middle" fontSize={12} fontWeight={700}
                                    fill="#ffd166" fontFamily="ui-monospace, Menlo, monospace">
                                {distLabel} · {miLabel}
                              </text>
                              <text x={0} y={9} textAnchor="middle" fontSize={11}
                                    fill="#e6e8ee" fontFamily="ui-monospace, Menlo, monospace">
                                FSPL ≈ {fsplDb.toFixed(1)} dB @ {freqMhz} MHz
                              </text>
                            </g>
                          </>
                        )}
                      </g>
                    );
                  })()}

                  {/* Cluster glyphs (only at low zoom). Click a cluster to
                    *  zoom in 2 steps centered on it — feels like the mobile-
                    *  maps "expand this group" gesture. */}
                  {clusters && clusters.map((c, i) => {
                    if (!view) return null;
                    // Reproject cluster center back to lat/lon for panTo.
                    const mx = view.minMx + c.x;
                    const my = view.minMy + c.y;
                    const cLat = mercYToLat(my, view.zoom);
                    const cLon = mercXToLon(mx, view.zoom);
                    return (
                      <g
                        key={`cluster-${i}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => panTo(cLat, cLon, 500, view.zoom + 3)}
                      >
                        <circle cx={c.x} cy={c.y} r={15}
                                fill="rgba(102, 211, 154, 0.92)"
                                stroke="rgba(0,0,0,0.7)" strokeWidth={1.5} />
                        <text x={c.x} y={c.y + 4}
                              textAnchor="middle"
                              fontSize={12} fontWeight={700}
                              fill="#0f1115"
                              fontFamily="ui-monospace, Menlo, monospace">
                          {c.count}
                        </text>
                      </g>
                    );
                  })}

                  {placed.filter((p) => !clusteredNums.has(p.node.num)).map((p) => {
                    const isMqtt = !!p.node.viaMqtt;
                    const fill = p.isMe ? '#5cc8ff' : isMqtt ? '#b88aff' : (p.node.hopsAway ?? 0) === 0 ? '#66d39a' : '#ffd166';
                    // Focus mode: nodes outside the neighbor set fade out so
                    // the topology around the selection is visually isolated.
                    const focusDim = focusNeighbors && !focusNeighbors.has(p.node.num) ? 0.18 : 1;
                    const opacity = (p.isStale ? 0.45 : 1) * focusDim;
                    const showLabel = labelShown.has(p.node.num);
                    return (
                      <g
                        key={p.node.num}
                        data-node-num={p.node.num}
                        onClick={() => setSelectedId(p.node.num)}
                        onDoubleClick={(e) => { e.stopPropagation(); recenterOnNode(p.node); }}
                        onMouseEnter={() => { setHoverNum(p.node.num); setHoverPos({ x: p.x, y: p.y }); }}
                        onMouseLeave={() => setHoverNum((cur) => (cur === p.node.num ? null : cur))}
                        style={{ cursor: 'pointer', opacity }}
                      >
                        <circle cx={p.x} cy={p.y} r={p.isMe ? 12 : 9}
                                fill={isMqtt ? 'none' : fill}
                                stroke={selectedId === p.node.num ? '#fff' : isMqtt ? '#b88aff' : 'rgba(0,0,0,0.6)'}
                                strokeWidth={selectedId === p.node.num ? 3 : isMqtt ? 2 : 1.5}
                                strokeDasharray={isMqtt ? '3 2' : undefined} />
                        {showLabel && (
                          <text x={p.x} y={p.y - (p.isMe ? 18 : 14)}
                                textAnchor="middle"
                                fontSize={p.isMe ? 14 : 12}
                                fill={p.isMe ? '#5cc8ff' : (basemap === 'light' ? '#1a1d23' : '#e6e8ee')}
                                stroke={basemap === 'light' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)'}
                                strokeWidth={3}
                                paintOrder="stroke fill"
                                fontFamily="ui-monospace, Menlo, monospace">
                            {p.node.shortName || '????'}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>

                {/* Floating overlay: style toggle + zoom controls */}
                <div className="map-overlay map-overlay-tr">
                  <div className="map-style-toggle">
                    {(['dark', 'voyager', 'light', 'satellite'] as const).map((s) => (
                      <button
                        key={s}
                        className={'map-style-btn' + (basemap === s ? ' active' : '')}
                        onClick={() => setBasemap(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <div className="map-zoom-buttons">
                    <button onClick={() => adjustZoom(1)} title="Zoom in (or scroll up)">+</button>
                    <button onClick={() => adjustZoom(-1)} title="Zoom out (or scroll down)">−</button>
                    {me?.lat !== undefined && (
                      <button onClick={recenterOnMe} title="Recenter on your radio">⌖</button>
                    )}
                    {userInteracted && (
                      <button onClick={resetView} title="Reset to auto-fit (0)">⟲</button>
                    )}
                    <button
                      className={showHelp ? 'active' : ''}
                      onClick={() => setShowHelp((v) => !v)}
                      title="Keyboard shortcuts (?)"
                    >?</button>
                  </div>
                  <div className="map-zoom-buttons">
                    <button
                      className={showLinks ? 'active' : ''}
                      onClick={() => setShowLinks((v) => !v)}
                      title={`Toggle mesh links (${meshEdges.length} visible)`}
                    >
                      ⌒ links
                    </button>
                    <button
                      className={showDistances ? 'active' : ''}
                      onClick={() => setShowDistances((v) => !v)}
                      title="Toggle distance labels on links"
                      disabled={!showLinks}
                    >
                      km
                    </button>
                    <button
                      className={showCoverage ? 'active' : ''}
                      onClick={() => setShowCoverage((v) => !v)}
                      title="Coverage heatmap: paints predicted RSSI from your radio across the map, based on a path-loss model fit to your observed links."
                    >
                      ⌷ coverage
                    </button>
                    <button
                      className={focusMode ? 'active' : ''}
                      onClick={() => setFocusMode((v) => !v)}
                      title="Focus mode: when a node is selected, fade everything except its direct neighbors and the edges that connect them. Reveals 'who can this node reach?' at a glance."
                    >
                      ◉ focus
                    </button>
                    <button
                      className={showTrails ? 'active' : ''}
                      onClick={() => setShowTrails((v) => !v)}
                      title="Position trails: faint breadcrumb line behind each mobile node showing where it's been in the last 24 hours."
                    >
                      ~ trails
                    </button>
                  </div>
                </div>

                {/* Search box (top-left) — fuzzy-match by name / id, click a
                    result to fly to that node. */}
                <div className="map-overlay map-overlay-tl map-search">
                  <input
                    type="text"
                    placeholder="search nodes…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchResults.length > 0) {
                        e.preventDefault();
                        flyToNode(searchResults[0]);
                        setSearchQuery('');
                      } else if (e.key === 'Escape') {
                        setSearchQuery('');
                      }
                    }}
                    aria-label="Search positioned nodes"
                  />
                  {searchResults.length > 0 && (
                    <ul className="map-search-results">
                      {searchResults.map((n) => (
                        <li key={n.num}>
                          <button
                            type="button"
                            onClick={() => { flyToNode(n); setSearchQuery(''); }}
                          >
                            <span className="map-search-short">{n.shortName || '????'}</span>
                            <span className="map-search-long">{n.longName || `!${n.num.toString(16).padStart(8, '0')}`}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Coverage legend — only visible when the heatmap overlay is on. */}
                {showCoverage && (
                  <div className="map-overlay map-overlay-bl coverage-legend">
                    <div className="coverage-legend-title">PREDICTED RSSI</div>
                    {coverageFit ? (
                      <>
                        <div className="coverage-legend-row"><span className="coverage-legend-swatch" style={{ background: '#66d39a' }} /> &gt; −85 dBm — strong</div>
                        <div className="coverage-legend-row"><span className="coverage-legend-swatch" style={{ background: '#ffd166' }} /> −85 to −105 — moderate</div>
                        <div className="coverage-legend-row"><span className="coverage-legend-swatch" style={{ background: '#ff6b81' }} /> −105 to −120 — marginal</div>
                        <div className="coverage-legend-footer">
                          n = <strong>{coverageFit.exponent.toFixed(2)}</strong>, fit from {coverageFit.sampleCount} samples
                        </div>
                      </>
                    ) : (
                      <div className="coverage-legend-empty">Not enough RSSI samples to fit a model yet ({coverageSamples.length} found, need 3+ direct).</div>
                    )}
                  </div>
                )}

                {/* Scale bar (bottom-left). Shows a horizontal segment with
                    a "nice" round meters/km value at the current zoom + lat. */}
                {view && (() => {
                  const sb = computeScaleBar(view);
                  return (
                    <div className="map-overlay map-overlay-bl map-scale-bar" title={`Scale at ${view.centerLat.toFixed(2)}° · z${view.zoom}`}>
                      <div className="map-scale-bar-line" style={{ width: `${sb.widthPct}%` }} />
                      <span className="map-scale-bar-label">{sb.label}</span>
                    </div>
                  );
                })()}

                {/* Cursor lat/lon readout — click to copy. */}
                {cursorLatLon && (
                  <button
                    type="button"
                    className="map-overlay map-overlay-br map-coords"
                    onClick={copyCursorCoords}
                    title="Click to copy"
                  >
                    {coordsCopied
                      ? '✓ copied'
                      : `${cursorLatLon.lat.toFixed(5)}, ${cursorLatLon.lon.toFixed(5)}`}
                  </button>
                )}

                {/* Keyboard shortcuts overlay (press ? to toggle). */}
                {showHelp && (
                  <div className="map-help-overlay" role="dialog" aria-label="Map keyboard shortcuts">
                    <div className="map-help-title">Map shortcuts</div>
                    <table className="map-help-table">
                      <tbody>
                        <tr><td><kbd>drag</kbd></td><td>pan</td></tr>
                        <tr><td><kbd>scroll</kbd> · <kbd>+</kbd>/<kbd>−</kbd></td><td>zoom (cursor-anchored)</td></tr>
                        <tr><td><kbd>dbl-click</kbd></td><td>zoom in at point</td></tr>
                        <tr><td><kbd>shift</kbd>+<kbd>dbl-click</kbd></td><td>zoom out at point</td></tr>
                        <tr><td><kbd>shift</kbd>+<kbd>click</kbd></td><td>set ruler point A, then B (distance + path loss)</td></tr>
                        <tr><td><kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd></td><td>pan ⅙ viewport</td></tr>
                        <tr><td><kbd>0</kbd></td><td>reset to auto-fit</td></tr>
                        <tr><td><kbd>c</kbd></td><td>center on your radio</td></tr>
                        <tr><td><kbd>?</kbd></td><td>show / hide this card</td></tr>
                        <tr><td><kbd>esc</kbd></td><td>hide this card</td></tr>
                      </tbody>
                    </table>
                    <button className="map-help-close" onClick={() => setShowHelp(false)} aria-label="Close shortcuts">×</button>
                  </div>
                )}

                {/* Hover tooltip */}
                {hoverNum !== null && hoverPos && (() => {
                  const node = placed.find((p) => p.node.num === hoverNum)?.node;
                  if (!node) return null;
                  // Convert SVG coords back to container px so the tooltip lines up.
                  const rect = mapContainerRef.current?.getBoundingClientRect();
                  if (!rect) return null;
                  const px = (hoverPos.x / SVG_W) * rect.width;
                  const py = (hoverPos.y / SVG_H) * rect.height;
                  return (
                    <div className="map-tooltip" style={{ left: px + 14, top: py + 14 }}>
                      <div className="map-tooltip-title">{node.shortName || '????'}</div>
                      {node.longName && <div className="map-tooltip-sub">{node.longName}</div>}
                      <div className="map-tooltip-row">
                        {node.rssi !== undefined && node.rssi !== 0 && <span>{node.rssi} dBm</span>}
                        {node.snr !== undefined && <span>SNR {node.snr.toFixed(1)}</span>}
                        {node.hopsAway !== undefined && <span>hop {node.hopsAway}</span>}
                        {node.lastHeard && <span>{ago(node.lastHeard)}</span>}
                      </div>
                      <div className="map-tooltip-hint">click to select · double-click to recenter</div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          )}

          {activeTab === 'data' && placed.length > 0 && (
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Distances {me ? 'from your node' : '(no position from your node yet)'}</h2>
              {!me && (
                <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 0 }}>
                  Distances below are pairwise from the first positioned node. Plug in your radio with GPS lock to recenter on yourself.
                </p>
              )}
              <table className="data">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th>Distance</th>
                    <th>Bearing</th>
                    <th>Hops</th>
                    <th>RSSI</th>
                    <th>FSPL</th>
                    <th>Excess</th>
                    <th>Heard</th>
                  </tr>
                </thead>
                <tbody>
                  {placed.filter((p) => !p.isMe).map((p) => {
                    const ref = me ?? placed[0].node;
                    const distKm = haversineKm(ref.lat!, ref.lon!, p.node.lat!, p.node.lon!);
                    const bearing = bearingDeg(ref.lat!, ref.lon!, p.node.lat!, p.node.lon!);
                    const txPower = state.loraConfig?.txPower || 17;
                    const fspl = fsplDb(distKm);
                    const measuredLoss = p.node.rssi !== undefined && p.node.rssi !== 0 ? txPower - p.node.rssi : null;
                    const excess = measuredLoss != null ? measuredLoss - fspl : null;
                    const excessTone = excess == null ? 'var(--text-faint)' : excess < 10 ? 'var(--good)' : excess < 25 ? 'var(--warn)' : 'var(--bad)';
                    return (
                      <tr key={p.node.num}
                          onClick={() => setSelectedId(p.node.num)}
                          style={{ cursor: 'pointer', opacity: p.isStale ? 0.55 : 1, background: selectedId === p.node.num ? 'var(--bg-elev-2)' : undefined }}>
                        <td style={{ color: 'var(--accent)' }}>{p.node.shortName || '????'}</td>
                        <td>{distKm < 1 ? `${(distKm * 1000).toFixed(0)} m` : `${distKm.toFixed(2)} km`}</td>
                        <td>{Math.round(bearing)}°</td>
                        <td>{p.node.hopsAway ?? '—'}</td>
                        <td>{p.node.rssi ?? '—'}</td>
                        <td>{distKm > 0 ? fspl.toFixed(1) : '—'}</td>
                        <td style={{ color: excessTone, fontFamily: 'var(--mono)' }}>
                          {excess != null ? `${excess > 0 ? '+' : ''}${excess.toFixed(1)} dB` : '—'}
                        </td>
                        <td>{ago(p.node.lastHeard)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          {selected ? (
            <SelectedDetail node={selected} me={me} state={state} onMessage={onMessageNode} onClose={() => setSelectedId(null)} />
          ) : (
            <div className="info-card">
              <p style={{ margin: '0 0 6px' }}><strong>Reading the map</strong></p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text-dim)' }}>
                <li><span style={{ color: '#5cc8ff' }}>● blue</span> = your radio</li>
                <li><span style={{ color: '#66d39a' }}>● green</span> = direct (hop 0)</li>
                <li><span style={{ color: '#ffd166' }}>● yellow</span> = relayed</li>
                <li><span style={{ color: '#b88aff' }}>○ dashed purple</span> = MQTT-only (not on the local airwaves)</li>
                <li>solid line = direct RF from your radio · dashed = relayed</li>
                <li><span style={{ color: '#5cc8ff' }}>blue line</span> = observed mesh link (between any two nodes) — thicker = more packets, more opaque = stronger RSSI</li>
                <li>dashed halo = position precision (privacy blur or coarse GPS)</li>
                <li>dimmed = stale ({'>'}24h since last packet)</li>
              </ul>
            </div>
          )}

          <div className="info-card">
            <p style={{ margin: '0 0 4px' }}><strong>Excess over free-space loss</strong></p>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-dim)' }}>
              <span style={{ color: 'var(--good)' }}>{'<10 dB'}</span> ≈ effectively line-of-sight ·{' '}
              <span style={{ color: 'var(--warn)' }}>{'10–25 dB'}</span> ≈ sub-urban with some buildings ·{' '}
              <span style={{ color: 'var(--bad)' }}>{'>25 dB'}</span> ≈ heavy obstruction (terrain, dense buildings, foliage). Clearing one Fresnel-zone obstacle can swing this 20+ dB — that's why line-of-sight is everything in LoRa.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectedDetail({
  node, me, state, onMessage, onClose,
}: {
  node: NodeRecord;
  me?: NodeRecord;
  state: ConnectionState;
  onMessage?: (n: number) => void;
  onClose: () => void;
}) {
  const connId = useActiveConnId();
  const isMe = state.myInfo?.myNodeNum === node.num;
  const distKm = me?.lat && node.lat ? haversineKm(me.lat, me.lon!, node.lat, node.lon!) : null;
  return (
    <div className="card" style={{ position: 'sticky', top: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h3 style={{ margin: 0, color: 'var(--accent)', fontSize: 15, textTransform: 'none', letterSpacing: 0 }}>
          {node.shortName || 'unnamed'}
          {isMe && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-faint)' }}>(this is your radio)</span>}
        </h3>
        <button className="ghost" onClick={onClose} style={{ padding: '2px 8px', fontSize: 11 }}>×</button>
      </div>
      <dl className="kv kv-tight">
        <dt>Long name</dt><dd style={{ fontFamily: 'inherit' }}>{node.longName || '—'}</dd>
        <dt>Hardware</dt><dd>{node.hwModelName}</dd>
        <dt>Position</dt><dd>{node.lat?.toFixed(5)}, {node.lon?.toFixed(5)}{node.posPrecisionBits ? ` (${precisionLabel(node.posPrecisionBits)})` : ''}</dd>
        <dt>Altitude</dt><dd>{node.altitude !== undefined ? `${node.altitude} m` : '—'}</dd>
        {distKm != null && <><dt>Distance</dt><dd>{distKm < 1 ? `${(distKm * 1000).toFixed(0)} m` : `${distKm.toFixed(2)} km`}</dd></>}
        <dt>Hops</dt><dd>{node.hopsAway ?? '—'}</dd>
        <dt>RSSI</dt><dd>{node.rssi !== undefined && node.rssi !== 0 ? `${node.rssi} dBm` : '—'}</dd>
        <dt>SNR</dt><dd>{node.snr !== undefined ? `${node.snr.toFixed(1)} dB` : '—'}</dd>
        <dt>Battery</dt><dd>{node.batteryLevel !== undefined ? `${node.batteryLevel}%` : '—'}</dd>
        <dt>Last heard</dt><dd>{ago(node.lastHeard)}</dd>
      </dl>
      {!isMe && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button
            className="primary"
            onClick={() => onMessage?.(node.num)}
            disabled={state.status !== 'ready' || !onMessage}
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            Message
          </button>
          <button
            className="ghost"
            onClick={() => connId && window.mesh.sendTraceroute({ connId, to: node.num })}
            disabled={state.status !== 'ready' || !connId}
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            Traceroute
          </button>
        </div>
      )}
    </div>
  );
}

// View, SVG_W/SVG_H, clampZoom, and the Mercator projection helpers now live
// in ../map/projection (imported above) so other map panels can reuse them.

/**
 * Approximate center frequency (MHz) for each Meshtastic region enum
 * value. Used by the distance ruler's free-space path-loss readout.
 * The values are band centers — actual LoRa hops within these bands
 * shift a few MHz around the channel, but FSPL math is essentially
 * flat across the channel width so a center freq is plenty close.
 */
function regionToMhz(region: number | undefined): number {
  switch (region) {
    case 1:  return 915;  // US
    case 2:  return 433;  // EU_433
    case 3:  return 869;  // EU_868
    case 4:  return 490;  // CN
    case 5:  return 924;  // JP
    case 6:  return 921;  // ANZ
    case 7:  return 921;  // KR
    case 8:  return 923;  // TW
    case 9:  return 869;  // RU
    case 10: return 866;  // IN
    case 11: return 866;  // NZ_865
    case 12: return 922;  // TH
    case 13: return 2440; // LORA_24
    case 14: return 433;  // UA_433
    case 15: return 868;  // UA_868
    case 16: return 433;  // MY_433
    case 17: return 921;  // MY_919
    case 18: return 921;  // SG_923
    default: return 915;  // unconfigured radios usually US-band hardware
  }
}

/**
 * Compute a scale-bar segment for the current view. Picks a "nice"
 * round meters/km value that lands close to ~120 SVG units wide and
 * returns its label + percentage width of the container.
 *
 * Distance is taken from view.spanKm (haversine across the rendered
 * viewport) so latitude-induced distortion at the poles is already
 * accounted for — no separate cos(lat) correction needed.
 */
function computeScaleBar(view: View): { widthPct: number; label: string } {
  const metersPerSvgUnit = (view.spanKm * 1000) / SVG_W;
  const targetMeters = 140 * metersPerSvgUnit; // aim for ~140 SVG units of width
  const nice = [
    1, 2, 5, 10, 20, 50, 100, 200, 500,
    1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000,
    200_000, 500_000, 1_000_000, 2_000_000, 5_000_000,
  ];
  let chosen = nice[0];
  for (const n of nice) { if (n <= targetMeters) chosen = n; else break; }
  const widthPct = (chosen / metersPerSvgUnit / SVG_W) * 100;
  const label = chosen >= 1_000 ? `${chosen / 1_000} km` : `${chosen} m`;
  return { widthPct, label };
}

/**
 * Pick the subset of positioned nodes that the camera should auto-fit to
 * on first render. Renders aren't affected — every positioned node is
 * still drawn — this only controls the initial bbox.
 *
 * Strategy:
 *   1. Drop MQTT-fed peers if there are local-mesh nodes to anchor on.
 *      MQTT-relayed nodes are usually on the other side of the world
 *      and were the #1 cause of "starts zoomed out way too far".
 *   2. If we know where we are, expand a radius outward (50 → 200 →
 *      500 km → infinite) until at least one peer comes along for the
 *      ride. "me" is always included.
 *   3. Falls back to all positioned nodes if filtering left us with
 *      nothing useful (single-node solo case).
 */
function pickAutoFitNodes(positioned: NodeRecord[], me?: NodeRecord): NodeRecord[] {
  if (positioned.length === 0) return positioned;
  const nonMqtt = positioned.filter((n) => !n.viaMqtt);
  let candidates = nonMqtt.length >= 1 ? nonMqtt : positioned;
  if (me?.lat !== undefined && me?.lon !== undefined) {
    for (const maxKm of [50, 200, 500]) {
      const close = candidates.filter((n) =>
        n.num === me.num || haversineKm(me.lat!, me.lon!, n.lat!, n.lon!) <= maxKm,
      );
      if (close.length >= 2) { candidates = close; break; }
    }
  }
  return candidates.length > 0 ? candidates : positioned;
}

function computeView(nodes: NodeRecord[], me?: NodeRecord): View | null {
  if (!nodes.length) return null;
  const lats = nodes.map((n) => n.lat!);
  const lons = nodes.map((n) => n.lon!);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLon = Math.min(...lons), maxLon = Math.max(...lons);

  if (maxLat - minLat < 0.001) { minLat -= 0.005; maxLat += 0.005; }
  if (maxLon - minLon < 0.001) { minLon -= 0.005; maxLon += 0.005; }

  const padLat = (maxLat - minLat) * 0.15;
  const padLon = (maxLon - minLon) * 0.15;
  minLat -= padLat; maxLat += padLat;
  minLon -= padLon; maxLon += padLon;

  const centerLat = me ? me.lat! : (minLat + maxLat) / 2;
  const centerLon = me ? me.lon! : (minLon + maxLon) / 2;
  const spanLat = maxLat - minLat;
  const spanLon = maxLon - minLon;
  const spanKm = haversineKm(minLat, minLon, maxLat, maxLon);

  // Pick the highest zoom where the merc-projected bbox fits inside SVG_W × SVG_H.
  let zoom = 17;
  for (; zoom >= 1; zoom--) {
    const w = lonToMercX(maxLon, zoom) - lonToMercX(minLon, zoom);
    const h = latToMercY(minLat, zoom) - latToMercY(maxLat, zoom); // y grows southward
    if (w <= SVG_W && h <= SVG_H) break;
  }

  // Lock the merc bbox to be exactly the rendered viewport. Center the actual
  // node bbox inside it so we don't crop nodes when one dimension dominates.
  const dataMinMx = lonToMercX(minLon, zoom);
  const dataMaxMx = lonToMercX(maxLon, zoom);
  const dataMinMy = latToMercY(maxLat, zoom);
  const dataMaxMy = latToMercY(minLat, zoom);
  const dataCenterMx = (dataMinMx + dataMaxMx) / 2;
  const dataCenterMy = (dataMinMy + dataMaxMy) / 2;

  const minMx = dataCenterMx - SVG_W / 2;
  const maxMx = dataCenterMx + SVG_W / 2;
  const minMy = dataCenterMy - SVG_H / 2;
  const maxMy = dataCenterMy + SVG_H / 2;

  return { centerLat, centerLon, spanLat, spanLon, spanKm, zoom, minMx, maxMx, minMy, maxMy };
}

/**
 * Coverage heatmap overlay. Samples a grid of cells in screen space, projects
 * each back to lat/lon, computes distance from the user's radio, predicts RSSI
 * from a fitted path-loss model, and renders coloured rects with low opacity
 * so the basemap underneath is still legible.
 *
 * The grid is intentionally coarse (40×25 ≈ 1000 cells) — high enough to see
 * the shape of the coverage, low enough to repaint instantly on pan/zoom.
 */
function CoverageHeatmap({
  view, myLat, myLon, fit,
}: {
  view: View;
  myLat: number;
  myLon: number;
  fit: { intercept: number; slope: number; exponent: number; sampleCount: number };
}) {
  const COLS = 40;
  const ROWS = 25;
  const SVG_W = 1600;
  const SVG_H = 1000;
  const cellW = SVG_W / COLS;
  const cellH = SVG_H / ROWS;

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cxPx = (c + 0.5) * cellW;
      const cyPx = (r + 0.5) * cellH;
      const mx = view.minMx + (cxPx / SVG_W) * (view.maxMx - view.minMx);
      const my = view.minMy + (cyPx / SVG_H) * (view.maxMy - view.minMy);
      const lat = mercYToLat(my, view.zoom);
      const lon = mercXToLon(mx, view.zoom);
      const d = haversineKm(myLat, myLon, lat, lon);
      // Skip the cell containing the user — it'd predict +∞ dBm.
      if (d < 0.02) continue;
      const predicted = fit.intercept + fit.slope * Math.log10(d);
      const color = colorForRssi(predicted);
      if (!color) continue; // below sensitivity → transparent
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={c * cellW}
          y={r * cellH}
          width={cellW + 0.5} // overlap by half a pixel to hide grid seams
          height={cellH + 0.5}
          fill={color}
          opacity={0.35}
          pointerEvents="none"
        />,
      );
    }
  }
  return <g className="coverage-heatmap" pointerEvents="none">{cells}</g>;
}

function colorForRssi(rssi: number): string | null {
  if (rssi > -85) return '#66d39a';   // strong
  if (rssi > -105) return '#ffd166';  // moderate
  if (rssi > -120) return '#ff6b81';  // marginal
  return null;                         // below practical sensitivity
}

// MapTiles, Grid, pickGridStep moved to ../map (MapLayers + projection);
// haversineKm moved to ../../lib/geo. All imported at the top of this file.

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

function fsplDb(distanceKm: number, freqMHz: number = 915): number {
  if (distanceKm <= 0) return 0;
  return 20 * Math.log10(distanceKm) + 20 * Math.log10(freqMHz) + 32.44;
}

function exportCsv(placed: PlacedNode[], me: NodeRecord | undefined, txPower: number): void {
  const rows = placed.map((p) => {
    const n = p.node;
    let dist = ''; let bearing = ''; let fspl = ''; let excess = '';
    if (me?.lat != null && me?.lon != null && n.lat != null && n.lon != null) {
      const distKm = haversineKm(me.lat, me.lon, n.lat, n.lon);
      dist = distKm.toFixed(4);
      bearing = bearingDeg(me.lat, me.lon, n.lat, n.lon).toFixed(1);
      const f = fsplDb(distKm);
      fspl = f.toFixed(2);
      if (n.rssi !== undefined && n.rssi !== 0) excess = (txPower - n.rssi - f).toFixed(2);
    }
    return {
      short_name: n.shortName || '',
      long_name: n.longName || '',
      node_num: '!' + (n.num >>> 0).toString(16).padStart(8, '0'),
      hw_model: n.hwModelName || '',
      lat: n.lat?.toFixed(6) ?? '',
      lon: n.lon?.toFixed(6) ?? '',
      altitude_m: n.altitude?.toString() ?? '',
      precision_bits: n.posPrecisionBits?.toString() ?? '',
      distance_km: dist,
      bearing_deg: bearing,
      hops_away: n.hopsAway?.toString() ?? '',
      rssi_dbm: n.rssi !== undefined && n.rssi !== 0 ? n.rssi.toString() : '',
      snr_db: n.snr !== undefined ? n.snr.toFixed(2) : '',
      fspl_db: fspl,
      excess_db: excess,
      battery_pct: n.batteryLevel?.toString() ?? '',
      voltage_v: n.voltage !== undefined ? n.voltage.toFixed(2) : '',
      last_heard_iso: n.lastHeard ? new Date(n.lastHeard * 1000).toISOString() : '',
      is_stale: p.isStale ? '1' : '0',
    };
  });
  downloadCsv(rows, 'nodes');
}
