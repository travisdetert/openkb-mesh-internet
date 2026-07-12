# Panels

The UI is organised as **panels** — self-contained views mounted by `App.tsx`.
They fall into three families: **operational** panels that show and act on the
live mesh, **learn** panels that teach the physics/networking with your real data
mixed in, and **reference** panels. This documents what exists and the shared
contract they hold to; the panel quality bar itself is codified in
[ADR-0009](adr/0009-panel-quality-bar.md).

> History: an earlier `PANELS_PLAN.md` laid out a phased build plan for these
> panels. That plan has been realised (and then some — the panel set grew well
> past the original 14), so the plan doc was retired in favour of this living
> reference. The plan lives on in git history if you want the original intent.

## The quality bar

Every panel that surfaces data is held to the same bar (the full, enforced
version is ADR-0009):

1. **Master/detail** — list + sticky detail drawer with the full record
2. **Subnav** where sub-tabs add value (shared `Subnav` component)
3. **CSV export** for anything tabular (shared `src/lib/csv.ts`)
4. **Real-time** — driven by live IPC/bus events, not polling
5. **Cross-panel actions** — Message / Traceroute / Jump-to-Node
6. **Inline diagnostic copy** — what a value means and what to do about it
7. **Floating overlay controls** where the map pattern fits
8. **Stale / fresh** state visualisation
9. **Hover tooltips** on data points
10. **Active-state highlighting** (selected node, live preset, …)

## Operational panels — `src/components/panels/`

Live views over the connected radio(s); driven by `useMesh` state and the
`window.mesh.on*` IPC events (see [ARCHITECTURE.md](ARCHITECTURE.md)).

| Panel | What it does |
| --- | --- |
| `NodesPanel` | Node roster with detail drawer — the master/detail reference panel |
| `PositionMapPanel` | Nodes on a Mercator basemap; owns the shared tile/projection code |
| `ChatPanel` | Channel + direct-message conversations |
| `TelemetryPanel` | Battery/power, channel util, air time, per-node metric history |
| `TraceroutePanel` | Run / history / compare / on-map route tracing |
| `PacketSnifferPanel` | Real-time packet stream, decode, and stats |
| `MeshHealthPanel` | Roll-up health of the mesh |
| `DeviceLabPanel` | Transport stats + lifecycle timeline for a connection |
| `LinkTestPanel` / `PeerCheckPanel` | Point-to-point link and peer reachability checks |
| `DeliveryPanel` | Message delivery / ack tracking |
| `ChannelsPanel` | Channel set inspection + apply-by-URL |
| `SettingsPanel` | Read/apply radio config (LoRa, position, power, …) |
| `FirmwarePanel` / `MqttPanel` | Firmware info; MQTT config |
| `DeviceDatabasePanel` / `AntennaDatabasePanel` | Hardware + antenna reference catalogs |
| `RadioComparePanel` | Compare radios/presets side by side |

## Learn panels — `src/components/learning/`

Teach the underlying physics and networking, blending theory with the user's
observed data. Wrapped in `LearningChrome`.

| Panel | Teaches |
| --- | --- |
| `LinkBudgetPanel` | TX→RX budget waterfall, per-link margins from real RSSI |
| `SignalDistancePanel` | RSSI vs distance scatter against the FSPL curve |
| `CoveragePanel` | Path-loss heatmap + predicted-reach rings |
| `AntennaPanel` | Gain patterns, polarization penalty, length calculator |
| `LoRaCssPanel` | Chirp/CSS visualisation, SF/BW/CR math, preset compare |
| `MeshRoutingPanel` | Animated hop-limit / dedup routing over a demo or your mesh |
| `MeshRealityPanel` | Honest "what can this actually do" Q&A backed by your data |
| `AsymmetricLinksPanel` | Why links aren't always bidirectional |
| `DiscoveryPanel` | Node/link discovery over time |

## Reference panels — `src/components/`

| Panel | What it does |
| --- | --- |
| `ConceptsPanel` | Browsable/searchable glossary of mesh/LoRa concepts (see `src/concepts/`) |
| `ComparePanel` | Mesh-vs-cell-vs-sat scenario + cost comparison |

## Shared infrastructure

Extracted so panels don't re-implement the same plumbing:

- **`src/components/Subnav.tsx`** — one consistent sub-tab bar; panels pass a tab list.
- **`src/lib/csv.ts`** — CSV escaping + download helper for every tabular export.
- **`src/components/map/`** — `MapLayers` (tiles) and `projection.ts` (Mercator
  `lon→x`/`lat→y`, metre projection), reused by Map, Coverage, and RSSI-vs-distance.

When adding a panel, reuse these before hand-rolling equivalents, and hold the new
panel to the ADR-0009 quality bar.
