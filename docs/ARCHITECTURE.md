# Architecture

How the app is put together and how a byte off the radio becomes a pixel on a
panel. This is the map; the individual *why*-decisions live in [`adr/`](adr/).

## The one-paragraph version

openkb-mesh-internet is an Electron desktop app. The **main process** owns all
device I/O and all persistence: it opens transports (USB serial / BLE), decodes
the Meshtastic protobuf stream, keeps N radios alive at once, and writes a local
SQLite history. The **renderer** is a React app that never touches a device
directly — it talks to main only through a context-isolated `window.mesh` bridge,
turns the events it receives into React state, and *also* re-publishes them onto
an in-memory event bus that the learn/telemetry panels subscribe to. The security
posture and the reasoning behind each boundary are in [`../SECURITY.md`](../SECURITY.md)
and the ADRs.

## Process & data-flow model

```mermaid
flowchart TB
  subgraph HW["Hardware"]
    radio["Meshtastic radio"]
  end

  subgraph MAIN["Electron main process — owns device I/O + persistence"]
    direction TB
    serial["MeshtasticSerialConnection<br/><small>0x94 0xC3 framing (serial-only)</small>"]
    bleT["BleProxyTransport<br/><small>unframed FromRadio/ToRadio</small>"]
    ctrl["MeshtasticController<br/><small>per radio; decode/encode</small>"]
    codec["protobuf-codec<br/><small>ADR-0006</small>"]
    mgr["MeshManager (EventEmitter)<br/><small>N controllers keyed by connId; auto-connect</small>"]
    db[("MeshDatabase<br/>better-sqlite3<br/><small>ADR-0003</small>")]
    ipcmain["ipcMain handlers +<br/>webContents.send('mesh:*')"]
  end

  subgraph BRIDGE["Preload — context-isolated bridge (ADR-0007)"]
    bridge["window.mesh<br/><small>invoke() methods · on*() event subs</small>"]
  end

  subgraph REND["Electron renderer — React app, no direct device access"]
    direction TB
    usemesh["useMesh / MeshContext<br/><small>the seam: IPC → state + translator</small>"]
    state["React state<br/><small>nodes · messages · traces · telemetry</small>"]
    translator["concepts/translators/meshtastic<br/><small>native event → typed BusEvent</small>"]
    bus["in-memory bus<br/><small>pub/sub · 500-event ring buffer</small>"]
    panels["Mesh panels<br/><small>nodes · map · chat · telemetry · traceroute</small>"]
    learn["Learn / event-sourced panels<br/><small>EventFeed · concept views</small>"]
  end

  radio <-->|"USB serial"| serial
  radio <-.->|"BLE (GATT)"| bleT
  serial --> ctrl
  bleT --> ctrl
  ctrl <--> codec
  ctrl --> mgr
  mgr --> db
  mgr --> ipcmain
  ipcmain <--> bridge
  bridge --> usemesh
  usemesh --> state
  usemesh --> translator
  translator --> bus
  state --> panels
  bus --> learn
```

Everything above the preload line runs with Node/OS privileges; everything below
it is sandboxed and reaches main **only** through the narrow `window.mesh`
surface. That boundary is the whole security model — see ADR-0007.

## Inbound packet — the happy path

```mermaid
sequenceDiagram
  participant R as Radio
  participant T as Transport (serial/BLE)
  participant C as Controller
  participant M as MeshManager
  participant DB as SQLite
  participant W as webContents
  participant H as useMesh (renderer)
  participant S as React state
  participant B as event bus

  R->>T: raw bytes / GATT notify
  T->>C: unframed FromRadio protobuf
  C->>C: decode (protobuf-codec)
  C->>M: node / message / packet / telemetry event
  M->>DB: persist (keyed by connId)
  M->>W: webContents.send('mesh:node' | 'mesh:message' | …)
  W->>H: window.mesh.onNode(...) callback
  H->>S: setState (drives mesh panels)
  H->>B: translator.publish* → BusEvent (drives learn panels)
```

Two consumers, one source: the same IPC event updates React state **and** is
translated into a `BusEvent`. Mesh panels read state; the event-sourced learn
panels read the bus. The translator (`concepts/translators/meshtastic.ts`) is the
only place protocol-native shapes cross into the bus vocabulary — the rest of the
app speaks in `Update`/`Topic` concept slugs, never `MeshPacket`.

## The BLE inversion (ADR-0005)

BLE is the one flow that runs *backwards*. WebBluetooth only exists in the
renderer, so for a BLE radio the renderer owns the GATT connection and the main
process holds a `BleProxyTransport` stand-in. Frames are proxied across the
bridge in both directions:

```mermaid
sequenceDiagram
  participant D as Renderer (WebBluetooth)
  participant P as window.mesh bridge
  participant Bp as BleProxyTransport (main)
  participant C as Controller (main)

  Note over D,C: TX — sending to the radio
  C->>Bp: write(unframed ToRadio)
  Bp->>P: webContents.send('mesh:bleTxFrame')
  P->>D: onBleTxFrame → GATT write to radio

  Note over D,C: RX — receiving from the radio
  D->>P: window.mesh.bleRxFrame(bytes)
  P->>Bp: deliver frame
  Bp->>C: unframed FromRadio protobuf
```

Decode still happens in main (ADR-0006); only the physical GATT hop lives in the
renderer. This keeps a single decode path regardless of transport.

## Where things live

| Concern | Code | ADR |
| --- | --- | --- |
| App shell (Electron + React + Vite + TS) | `electron/main.ts`, `src/` | [0002](adr/0002-electron-react-vite-typescript-shell.md) |
| Local history store | `electron/database.ts` | [0003](adr/0003-better-sqlite3-mesh-store.md) |
| Transport abstraction | `electron/meshtastic/transport.ts` | [0004](adr/0004-pluggable-transport-abstraction.md) |
| BLE in renderer, proxied to main | `electron/meshtastic/ble-proxy-transport.ts` | [0005](adr/0005-webbluetooth-in-renderer-proxied-to-main.md) |
| Protobuf decode in main | `electron/meshtastic/protobuf-codec.ts` | [0006](adr/0006-protobuf-decode-in-main-process.md) |
| Context-isolated IPC bridge | `electron/preload.ts` | [0007](adr/0007-context-isolated-ipc-bridge.md) |
| Unified tail-able log | `electron/main.ts` | [0008](adr/0008-unified-tailable-log-file.md) |
| Panel quality bar | `src/components/panels/` | [0009](adr/0009-panel-quality-bar.md) |
| Event bus + concept translators | `src/bus.ts`, `src/concepts/` | [0010](adr/0010-in-memory-event-bus.md) |

## The concepts / event-bus layer

The renderer carries a small **event-sourced layer** — `src/concepts/` — modelled
as `Update` and `Topic` concept instances rather than raw protocol messages. The
`bus` (`src/bus.ts`) is an in-memory pub/sub with a 500-event ring buffer so late
subscribers can replay recent history. This is deliberately the shape an
event-sourced network would use, scaled to one app; it's what lets a learn panel
say "show me every position-beacon in the last minute" without knowing anything
about Meshtastic protobufs. See [ADR-0010](adr/0010-in-memory-event-bus.md).
