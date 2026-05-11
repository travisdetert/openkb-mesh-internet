# Panel polish plan — full Map/Nodes-quality bar

**Quality bar (set by Map and Nodes panels):**
1. **Master/detail** — list view + sticky detail drawer with full record
2. **Subnav** — `Live / Data / Settings`-style sub-tabs where it adds value
3. **CSV export** — every panel that surfaces tabular data
4. **Real-time data** — driven by live IPC events, not periodic polls
5. **Cross-panel actions** — Message / Traceroute / Jump-to-Node buttons
6. **Inline diagnostic copy** — explains what each value means and what to do about it
7. **Floating overlay controls** where applicable (Map's pattern)
8. **Stale / fresh state visualization**
9. **Hover tooltips on data points**
10. **Active-state highlighting** (live preset, selected node, etc.)

---

## Phase A — Live debugging stack (~6 hrs at full bar)

### 1. Telemetry — *90 min*
**Subnav:** `Channel util / Battery & power / Air time / Per-node`

- Time-scale picker (`1h / 6h / 24h / 7d / all`) on each subtab
- Multi-line chart with per-node legend, click line to focus, hover for cursor readout
- **Master/detail:** select a node from legend → drawer with full per-metric history sparklines + last-known values
- Live updating from existing `onTelemetrySample` IPC
- **Inline diagnostic:** "Channel util > 25% = collisions; you're at X% — Y%-iles over the last 24h: ... " with green/yellow/red severity
- **Low-battery banner** if any node < 20% with quick links to those nodes
- **Voltage trend** per node — useful for diagnosing solar nodes
- **Air-time-TX** view that ties into duty-cycle limits (region-aware: EU868 = 1%/hr cap)
- CSV export per metric
- Cross-panel actions: Message / Traceroute / open in Nodes

### 2. Traceroute — *75 min*
**Subnav:** `Run / History / Compare / On Map`

- Run tab: existing UI polished + "trace all known nodes" batch button (rate-limited to 1/30s per protocol)
- History tab: every trace ever run, with hop count + latency over time per destination, sparkline showing path stability
- Compare tab: pick 2+ traces, overlay them — see path drift
- **On Map tab:** render the most recent route per destination as a polyline on the Mercator basemap (reuse Map's tile + projection code)
- **Inline diagnostic per trace:** auto-detect path changes ("path went 2 → 4 hops at 14:23 — likely a relay went offline")
- CSV export of all routes
- Cross-panel: jump to any hop in Nodes, message a hop directly

### 3. Packet Sniffer — *90 min*
**Subnav:** `Stream / Decode / Stats`

- Stream tab: real-time packet feed (one row per packet) with portnum / from / hops / RSSI / SNR / encrypted
- **Filters:** portnum, sender, hops range, encrypted, from-me, free-text search across decoded fields
- **Pause / resume** button so you can inspect a busy session without rows scrolling out
- **Master/detail:** click packet → side drawer with hex dump (selectable), decoded protobuf fields, raw 0x94 0xC3 frame
- Decode tab: paste-or-load any raw frame and see it decoded
- Stats tab: portnum distribution (pie), top senders (bar), RSSI histogram, encrypted-vs-decoded ratio over time
- **Inline diagnostic:** "X% of packets are encrypted (no key for that channel) — check Connect → Channels for what you have keys for"
- CSV / JSON export of the visible filtered set
- Cross-panel: click sender → Nodes; click portnum → glossary

### 4. Event Feed — *60 min*
**Subnav:** `All / By type / Search / Stats`

- All tab: real-time stream of every event with type-color coding (packet / message / node / telemetry / state)
- By type: filter to one event class, with type-specific column layouts
- Search: substring match across all serialized event payloads with highlight
- Stats: events/min over time, type distribution, top actors
- Per-event expandable detail with full JSON
- CSV export
- Cross-panel actions where applicable

---

## Phase B — Learn panels with live-data ties (~4 hrs)

### 5. Link Budget — *90 min*
**Subnav:** `Calculator / Per-link / Compare presets`

- Calculator tab: full waterfall diagram (TX power → TX antenna gain → FSPL → RX antenna gain → sensitivity → margin) with sliders, auto-filled from your live preset
- Per-link tab: list every node we've heard, computed budget from real RSSI vs theoretical at distance — color by gap
- Compare presets tab: stack the budget for LongFast/LongSlow/ShortFast/etc. against the same scenario
- **Inline diagnostic:** "Your margin is +23 dB — comfortable; another 6 dB would 2× your range"
- **Master/detail:** click a per-link row → drawer with full RSSI history + path-loss math
- CSV export
- Cross-panel: jump to node, message

### 6. RSSI vs Distance — *60 min*
**Subnav:** `Scatter / Per-node trend / Outliers`

- Scatter tab: existing plot + theoretical FSPL curve overlay at active preset's frequency, color points by hops
- Per-node trend tab: select a node, see how RSSI has drifted over time
- Outliers tab: nodes with measurably better/worse signal than FSPL predicts for their distance, with "why" hypothesis ("LOS to mountaintop", "obstruction with X dB excess")
- Hover any point → tooltip with name, distance, hops, freshness
- Click point → drawer with full node info + LOS calc (reuse Map detail card)
- CSV export
- Cross-panel: jump to node

### 7. Coverage — *75 min*
**Subnav:** `Heatmap / Predicted reach / Samples`

- Heatmap tab: render path-loss samples as a coverage heatmap on a Mercator basemap (reuse Map tile + projection code)
- Predicted reach tab: theoretical reach rings around your radio for the current preset, plus dashed rings showing reach at LongSlow / ShortFast for comparison
- Samples tab: tabular view of every (distance, RSSI, hops) measurement with CSV export
- Hover map → estimated path loss to that point given measured environment
- Cross-panel actions

---

## Phase C — Educational visualizations (~5 hrs)

### 8. Antennas — *75 min*
**Subnav:** `Patterns / Polarization / Length calculator / Recommendations`

- Patterns: SVG gain patterns (dipole, monopole, 5/8 wave, Yagi, patch, collinear), interactive — rotate, see gain at any angle
- Polarization: animated cross-pol diagram showing the 20+ dB penalty
- Length calculator: 915/868/433 MHz, multiple antenna types, computes physical length
- Recommendations: real antenna products with price ranges, tradeoffs (mounting, weatherproofing, wind load)
- **Inline diagnostic:** "Your stock 2 dBi antenna at 17 dBm = 19 dBm EIRP. A $25 5 dBi upgrade would give 22 dBm EIRP — 1.4× the range for the same battery"
- Cross-panel: jump to Link Budget with the antenna swap pre-applied

### 9. LoRa CSS — *30 min*  *(already partially done — preset compare table exists)*
**Subnav:** `Chirp / Compare / Math`

- Chirp tab: existing chirp visualization
- Compare tab: existing preset compare with bar charts
- Math tab: interactive SF / BW / CR sliders that update sensitivity, airtime, bitrate live with explainer copy
- Cross-panel: "use this preset" → opens Connect → Settings (read-only since we don't write config)

### 10. Mesh Routing — *90 min*
**Subnav:** `Demo / Your mesh / Math`

- Demo tab: animated SVG with a sample mesh, packet propagating from node A to node Z, hop limits decrementing, dedup pruning duplicate paths, broadcasting hitting horizons
- Your mesh tab: same animation but using your *actual* node graph + observed links — watch how a hypothetical packet would spread from your radio
- Math tab: airtime calculations, retransmit math, channel-saturation curves
- Step-through controls (1 hop at a time / play / pause)
- Cross-panel: jump to Map to see the real paths

### 11. Reality Check — *60 min*
**Subnav:** `Common questions / Your area's reality`

- Common questions tab: Q&A format ("Cross-country messaging?", "Off-grid resilience?", "What if cell goes down?") with honest answers backed by physics + observed data
- Your area's reality tab: live data overlay ("In your area, the mesh has X nodes spanning Y km, Z packets/min — realistic answer for [your question]: ...")
- Cross-panel: each Q links to the panel that demonstrates the constraint

### 12. Expectations — *60 min*
**Subnav:** `Tables / Live comparison`

- Tables tab: concrete expected ranges / hop counts / reply times per preset and node density
- Live comparison tab: your measured medians (RSSI, hops, reply latency from traces) shown next to theoretical
- "How does my mesh compare to a typical urban / suburban / rural deployment?"
- Cross-panel: jump to specific examples in your nodes

### 13. Compare — *45 min*  *(already exists — light polish)*
**Subnav:** `Calculator / Scenarios / Cost`

- Calculator tab: existing scenario picker, polished to match the design language
- Scenarios tab: pre-built scenarios (group chat, sensor net, off-grid coordination)
- Cost tab: compute monthly cost for each architecture (mesh = $0, cell = $X, sat = $Y) given the user's traffic
- Cross-panel actions

---

## Phase D — Reference (~1 hr)

### 14. Concepts — *60 min*
**Subnav:** `Browse / Search / Index`

- Browse tab: category navigation (modulation / hardware / regulation / protocol / etc.) with rich cards
- Search tab: substring match across all concept fields with highlighting
- Index tab: alphabetic A–Z list with letter jump
- Per-concept page: full definition + cross-references back to panels that demonstrate it + links to upstream Meshtastic docs
- Cross-panel: every concept gets "see this in action" links to the relevant Live or Learn panel

---

## Total

| Phase | Hours |
| --- | --- |
| A — Live debugging | ~6 |
| B — Learn (live-data) | ~4 |
| C — Educational | ~5 |
| D — Reference | ~1 |
| **Total** | **~16 hrs focused work** |

Suggested execution order: A → B → C → D, since each phase builds on infrastructure from the previous.

Notes:
- The exact distinction between Phase B and Phase C is fluid — Mesh Routing's "your mesh" sub-tab is essentially live-data even though it's Learn.
- Cross-panel actions are cheap to add as we go since the App-level `setTab` + `setChatTarget` plumbing already exists.
- CSV export is a copy-paste pattern at this point.
- The Map's tile + Mercator + projection code in `PositionMapPanel.tsx` should be extracted into a shared helper module so Coverage and Mesh Routing can reuse it without duplication. About 30 min of refactor work, payoff is huge.

## Pre-work refactor candidates

Before starting Phase B/C, ~1 hr of refactor will pay off across multiple panels:

1. **Extract Map components** — `MapTiles`, `Grid`, `projectMeters`, `lonToMercX`/`latToMercY` from `PositionMapPanel.tsx` into `src/components/map/` so Coverage / Mesh Routing / RSSI vs Distance can reuse them.
2. **Extract `Subnav` component** — currently each panel hand-rolls its own subnav. One shared component takes a tab list and renders consistently.
3. **Extract CSV-export helper** — currently each panel has its own `escCsv` and download-link plumbing. Move to `src/lib/csv.ts`.
4. **Extract `nameFor` / `shortHex` / `longNameFor`** — every panel duplicates these. Move to `src/lib/nodes.ts`.
