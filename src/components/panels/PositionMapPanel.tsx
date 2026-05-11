import React, { useEffect, useMemo, useRef, useState } from 'react';

type BasemapStyle = 'dark' | 'voyager' | 'light';
const BASEMAP_URLS: Record<BasemapStyle, string> = {
  dark:    'dark_all',
  voyager: 'rastertiles/voyager',
  light:   'light_all',
};

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
  const [basemap, setBasemap] = useState<BasemapStyle>('voyager');
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const [centerOverride, setCenterOverride] = useState<{ lat: number; lon: number } | null>(null);
  const dragRef = useRef<{ startLat: number; startLon: number; startClientX: number; startClientY: number; rect: DOMRect; zoom: number } | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const wheelAccumRef = useRef(0);
  const wheelLastRef = useRef(0);

  const positionedAll = useMemo(
    () => nodes.filter((n) => n.lat !== undefined && n.lon !== undefined && (n.lat !== 0 || n.lon !== 0)),
    [nodes],
  );
  const positioned = useMemo(
    () => hideStale ? positionedAll.filter((n) => !isStale(n.lastHeard)) : positionedAll,
    [positionedAll, hideStale],
  );

  const myId = state.myInfo?.myNodeNum;
  const me = positioned.find((n) => n.num === myId);

  const autoView = useMemo(() => computeView(positioned, me), [positioned, me]);

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
  const adjustZoom = (delta: number) => {
    setZoomOverride(clampZoom((view?.zoom ?? autoView?.zoom ?? 12) + delta));
    if (centerOverride === null && view) setCenterOverride({ lat: view.centerLat, lon: view.centerLon });
  };
  const resetView = () => { setZoomOverride(null); setCenterOverride(null); };
  const recenterOnMe = () => {
    if (!me?.lat || !me?.lon) return;
    setCenterOverride({ lat: me.lat, lon: me.lon });
  };
  const recenterOnNode = (n: NodeRecord) => {
    if (n.lat == null || n.lon == null) return;
    setCenterOverride({ lat: n.lat, lon: n.lon });
    setZoomOverride(clampZoom((view?.zoom ?? autoView?.zoom ?? 12) + 1));
  };

  const [hoverNum, setHoverNum] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [cursorLatLon, setCursorLatLon] = useState<{ lat: number; lon: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'map' | 'data'>('map');
  const [showLinks, setShowLinks] = useState(true);
  const [showDistances, setShowDistances] = useState(false);

  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!view) return;
    e.preventDefault();
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
    // Always update cursor lat/lon so the bottom-right readout is live.
    if (view) {
      const rect = e.currentTarget.getBoundingClientRect();
      const sxPx = (e.clientX - rect.left) * (SVG_W / rect.width);
      const syPx = (e.clientY - rect.top) * (SVG_H / rect.height);
      const mx = view.minMx + sxPx;
      const my = view.minMy + syPx;
      setCursorLatLon({ lat: mercYToLat(my, view.zoom), lon: mercXToLon(mx, view.zoom) });
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
        adjustZoom(-steps); // negative deltaY = scroll up = zoom in
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

  // Build renderable mesh edges: link rows where BOTH endpoints have positions.
  const placedByNum = useMemo(() => {
    const m = new Map<number, PlacedNode>();
    for (const p of placed) m.set(p.node.num, p);
    return m;
  }, [placed]);
  const meshEdges = useMemo(() => {
    if (!showLinks) return [] as Array<{ a: PlacedNode; b: PlacedNode; distKm: number; rssi: number; snr: number; count: number; }>;
    const edges: Array<{ a: PlacedNode; b: PlacedNode; distKm: number; rssi: number; snr: number; count: number; }> = [];
    for (const l of links) {
      const a = placedByNum.get(l.a_num);
      const b = placedByNum.get(l.b_num);
      if (!a || !b) continue;
      const distKm = haversineKm(a.node.lat!, a.node.lon!, b.node.lat!, b.node.lon!);
      edges.push({ a, b, distKm, rssi: l.rssi_max ?? 0, snr: l.snr_avg ?? 0, count: l.count });
    }
    return edges;
  }, [links, placedByNum, showLinks]);

  return (
    <div className="page">
      <h1 className="page-title">Map</h1>
      <p className="page-sub">
        Nodes that share GPS over the mesh appear here. Basemap tiles are © OpenStreetMap contributors / © CARTO. Distances use the haversine formula; halos show position precision.
      </p>

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
                style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', background: 'var(--bg)', borderRadius: 6, overflow: 'hidden', cursor: dragRef.current ? 'grabbing' : 'grab', userSelect: 'none' }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={endDrag}
                onMouseLeave={onMouseLeave}
              >
                <svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid meet">
                  <MapTiles view={view!} style={basemap} />
                  <Grid view={view!} basemap={basemap} />

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

                  {/* Mesh-wide link edges from the observed-links DB */}
                  {meshEdges.map((e, i) => {
                    const dim = e.a.isStale || e.b.isStale;
                    // Stroke darkness/thickness scaled by RSSI (better = stronger line) and observation count.
                    const strength = e.rssi !== 0 ? Math.max(0, Math.min(1, (e.rssi + 130) / 50)) : 0.3;
                    const opacity = (dim ? 0.25 : 0.55) * (0.4 + 0.6 * strength);
                    const width = 0.8 + 1.4 * Math.min(1, Math.log10(1 + e.count) / 1.5);
                    return (
                      <line
                        key={`mesh-${i}`}
                        x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y}
                        stroke={basemap === 'light' ? '#0c5fa3' : '#5cc8ff'}
                        strokeWidth={width}
                        opacity={opacity}
                      />
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

                  {placed.map((p) => {
                    const fill = p.isMe ? '#5cc8ff' : (p.node.hopsAway ?? 0) === 0 ? '#66d39a' : '#ffd166';
                    return (
                      <g
                        key={p.node.num}
                        data-node-num={p.node.num}
                        onClick={() => setSelectedId(p.node.num)}
                        onDoubleClick={(e) => { e.stopPropagation(); recenterOnNode(p.node); }}
                        onMouseEnter={() => { setHoverNum(p.node.num); setHoverPos({ x: p.x, y: p.y }); }}
                        onMouseLeave={() => setHoverNum((cur) => (cur === p.node.num ? null : cur))}
                        style={{ cursor: 'pointer', opacity: p.isStale ? 0.45 : 1 }}
                      >
                        <circle cx={p.x} cy={p.y} r={p.isMe ? 12 : 9}
                                fill={fill}
                                stroke={selectedId === p.node.num ? '#fff' : 'rgba(0,0,0,0.6)'}
                                strokeWidth={selectedId === p.node.num ? 3 : 1.5} />
                        <text x={p.x} y={p.y - (p.isMe ? 18 : 14)}
                              textAnchor="middle"
                              fontSize={p.isMe ? 14 : 12}
                              fill={p.isMe ? '#5cc8ff' : (basemap === 'light' ? '#1a1d23' : '#e6e8ee')}
                              stroke={basemap === 'light' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.7)'}
                              strokeWidth={3}
                              paintOrder="stroke fill"
                              fontFamily="ui-monospace, Menlo, monospace">
                          {p.node.shortName || '????'}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {/* Floating overlay: style toggle + zoom controls */}
                <div className="map-overlay map-overlay-tr">
                  <div className="map-style-toggle">
                    {(['dark', 'voyager', 'light'] as const).map((s) => (
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
                      <button onClick={resetView} title="Reset to auto-fit">⟲</button>
                    )}
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
                  </div>
                </div>

                {/* Cursor lat/lon readout */}
                {cursorLatLon && (
                  <div className="map-overlay map-overlay-br map-coords">
                    {cursorLatLon.lat.toFixed(5)}, {cursorLatLon.lon.toFixed(5)}
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
            onClick={() => window.mesh.sendTraceroute({ to: node.num })}
            disabled={state.status !== 'ready'}
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            Traceroute
          </button>
        </div>
      )}
    </div>
  );
}

interface View {
  centerLat: number;
  centerLon: number;
  spanLat: number;
  spanLon: number;
  spanKm: number;
  /** Web Mercator zoom level (0 = whole world, 18 = street level) */
  zoom: number;
  /** Mercator pixel bounds at the chosen zoom */
  minMx: number;
  maxMx: number;
  minMy: number;
  maxMy: number;
}

const SVG_W = 1600;
const SVG_H = 1000;
const TILE_SIZE = 256;

function clampZoom(z: number): number {
  return Math.max(1, Math.min(18, Math.round(z)));
}
function lonToMercX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z) * TILE_SIZE;
}
function latToMercY(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  return (
    (0.5 - Math.log((1 + Math.sin(latRad)) / (1 - Math.sin(latRad))) / (4 * Math.PI)) *
    Math.pow(2, z) *
    TILE_SIZE
  );
}
function mercYToLat(my: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * my) / (TILE_SIZE * Math.pow(2, z));
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function mercXToLon(mx: number, z: number): number {
  return (mx / (TILE_SIZE * Math.pow(2, z))) * 360 - 180;
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

function projectMeters(lat: number, lon: number, view: View): { x: number; y: number } {
  const mx = lonToMercX(lon, view.zoom);
  const my = latToMercY(lat, view.zoom);
  return {
    x: ((mx - view.minMx) / (view.maxMx - view.minMx)) * SVG_W,
    y: ((my - view.minMy) / (view.maxMy - view.minMy)) * SVG_H,
  };
}

function MapTiles({ view, style }: { view: View; style: BasemapStyle }) {
  // Carto basemaps. Free, no API key, attribution required.
  // Subdomain rotation parallelises tile fetches across HTTP/2 connections.
  const subdomains = ['a', 'b', 'c', 'd'];
  const path = BASEMAP_URLS[style];

  const tileXMin = Math.floor(view.minMx / TILE_SIZE);
  const tileXMax = Math.floor(view.maxMx / TILE_SIZE);
  const tileYMin = Math.floor(view.minMy / TILE_SIZE);
  const tileYMax = Math.floor(view.maxMy / TILE_SIZE);
  const worldTiles = Math.pow(2, view.zoom);

  const tiles: React.ReactNode[] = [];
  for (let tx = tileXMin; tx <= tileXMax; tx++) {
    for (let ty = tileYMin; ty <= tileYMax; ty++) {
      if (ty < 0 || ty >= worldTiles) continue;
      const wrappedTx = ((tx % worldTiles) + worldTiles) % worldTiles;
      const sub = subdomains[(tx + ty) % subdomains.length];
      const url = `https://${sub}.basemaps.cartocdn.com/${path}/${view.zoom}/${wrappedTx}/${ty}.png`;
      const tileMx = tx * TILE_SIZE;
      const tileMy = ty * TILE_SIZE;
      const x = ((tileMx - view.minMx) / (view.maxMx - view.minMx)) * SVG_W;
      const y = ((tileMy - view.minMy) / (view.maxMy - view.minMy)) * SVG_H;
      const w = (TILE_SIZE / (view.maxMx - view.minMx)) * SVG_W;
      const h = (TILE_SIZE / (view.maxMy - view.minMy)) * SVG_H;
      tiles.push(
        <image
          key={`${tx},${ty}`}
          href={url}
          x={x}
          y={y}
          width={w + 0.5}  /* +0.5 hides hairline gaps from sub-pixel rounding */
          height={h + 0.5}
          preserveAspectRatio="none"
        />
      );
    }
  }
  return <g>{tiles}</g>;
}

function Grid({ view, basemap }: { view: View; basemap: BasemapStyle }) {
  const dark = basemap === 'dark';
  const gridStroke = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
  const barStroke = dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)';
  const barText = dark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.75)';

  const lines: React.ReactNode[] = [];
  const stepKm = pickGridStep(view.spanKm);
  const stepDegLat = stepKm / 111;
  const stepDegLon = stepKm / (111 * Math.cos((view.centerLat * Math.PI) / 180));

  const minLat = view.centerLat - view.spanLat / 2;
  const maxLat = view.centerLat + view.spanLat / 2;
  const minLon = view.centerLon - view.spanLon / 2;
  const maxLon = view.centerLon + view.spanLon / 2;

  for (let lat = Math.ceil(minLat / stepDegLat) * stepDegLat; lat < maxLat; lat += stepDegLat) {
    const { y } = projectMeters(lat, view.centerLon, view);
    lines.push(<line key={`gh-${lat}`} x1={0} x2={1600} y1={y} y2={y} stroke={gridStroke} />);
  }
  for (let lon = Math.ceil(minLon / stepDegLon) * stepDegLon; lon < maxLon; lon += stepDegLon) {
    const { x } = projectMeters(view.centerLat, lon, view);
    lines.push(<line key={`gv-${lon}`} y1={0} y2={1000} x1={x} x2={x} stroke={gridStroke} />);
  }

  const barLengthKm = stepKm;
  const barPx = (barLengthKm / view.spanKm) * 1600 * 0.95;
  return (
    <>
      {lines}
      <line x1={40} x2={40 + barPx} y1={960} y2={960} stroke={barStroke} strokeWidth={2} />
      <line x1={40} x2={40} y1={954} y2={966} stroke={barStroke} strokeWidth={2} />
      <line x1={40 + barPx} x2={40 + barPx} y1={954} y2={966} stroke={barStroke} strokeWidth={2} />
      <text x={40 + barPx / 2} y={950} fill={barText} fontSize={14} textAnchor="middle"
            fontFamily="ui-monospace, Menlo, monospace">{barLengthKm} km</text>
    </>
  );
}

function pickGridStep(spanKm: number): number {
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500];
  return candidates.find((c) => c * 8 > spanKm) ?? 1000;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

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
  const headers = [
    'short_name', 'long_name', 'node_num', 'hw_model', 'lat', 'lon', 'altitude_m',
    'precision_bits', 'distance_km', 'bearing_deg', 'hops_away', 'rssi_dbm', 'snr_db',
    'fspl_db', 'excess_db', 'battery_pct', 'voltage_v', 'last_heard_iso', 'is_stale',
  ];
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
    const fields = [
      n.shortName || '',
      n.longName || '',
      '!' + (n.num >>> 0).toString(16).padStart(8, '0'),
      n.hwModelName || '',
      n.lat?.toFixed(6) ?? '',
      n.lon?.toFixed(6) ?? '',
      n.altitude?.toString() ?? '',
      n.posPrecisionBits?.toString() ?? '',
      dist,
      bearing,
      n.hopsAway?.toString() ?? '',
      n.rssi !== undefined && n.rssi !== 0 ? n.rssi.toString() : '',
      n.snr !== undefined ? n.snr.toFixed(2) : '',
      fspl,
      excess,
      n.batteryLevel?.toString() ?? '',
      n.voltage !== undefined ? n.voltage.toFixed(2) : '',
      n.lastHeard ? new Date(n.lastHeard * 1000).toISOString() : '',
      p.isStale ? '1' : '0',
    ];
    return fields.map(escCsv).join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `mesh-nodes-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escCsv(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
