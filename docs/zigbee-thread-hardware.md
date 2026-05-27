# Zigbee & Thread Hardware — Relevance to Mesh Networking

Context from the openkb-hue project: we're evaluating replacing proprietary smart home bridges (Philips Hue) with direct Zigbee control via USB coordinators. The nRF52840 — already used in this project's LoRa expansion card — natively supports Zigbee and Thread in addition to BLE.

## nRF52840 as a Multi-Protocol Radio

The nRF52840 has a single 2.4 GHz 802.15.4 radio that supports:

| Protocol | Use Case | Mesh? | Range (indoor) |
|---|---|---|---|
| BLE 5.x | Phone connectivity, provisioning | No (point-to-point) | ~30m |
| Zigbee 3.0 | Smart home devices (Hue bulbs, sensors) | Yes | ~10-20m per hop |
| Thread | Next-gen smart home (Matter devices) | Yes | ~10-20m per hop |
| 802.15.4 raw | Custom mesh protocols | Your choice | ~10-20m per hop |

This means the same chip in the Framework Laptop LoRa expansion card could — with different firmware — act as a Zigbee coordinator controlling every Hue bulb in a house. Same hardware, different firmware image.

## Recommended Zigbee Coordinators

### For development/prototyping:
- **nRF52840 USB Dongle (~$10)** — Same chip we already use. Flash with Zigbee coordinator firmware from nRF Connect SDK. Familiar toolchain.
- **ConBee II (~$30)** — Plug and play, no flashing needed. Best for "just works" testing.
- **Sonoff Zigbee 3.0 Plus-E (~$15)** — EFR32MG21 (Silicon Labs). Needs firmware flash but cheap and modern.

### For production/custom hardware:
- **nRF52840 + SX1262 combo board** — One device that does both LoRa mesh (Meshtastic) AND Zigbee smart home. The nRF handles Zigbee/Thread/BLE while the SX1262 handles LoRa. Already have the RF design for both in this project.

## Overlap With LoRa Mesh

Both Zigbee and Meshtastic LoRa are mesh networks, but at very different scales:

| | Meshtastic (LoRa) | Zigbee 3.0 |
|---|---|---|
| Frequency | 915 MHz (US) | 2.4 GHz |
| Range per hop | 1-10+ km | 10-20m |
| Data rate | ~1 kbps | 250 kbps |
| Use case | Long-range off-grid comms | Indoor smart home |
| Topology | Flood mesh | Routing mesh with coordinator |
| Max devices | ~100 per mesh | ~100 per coordinator |

They're complementary, not competing. A single device with nRF52840 + SX1262 could be both a LoRa mesh node and a Zigbee smart home coordinator.

## Node.js Software Stack

```
zigbee-herdsman          — Zigbee protocol stack (Node.js)
zigbee-herdsman-converters — Per-device parsers (Hue bulbs, IKEA, etc.)
```

Both are npm packages. They talk to the coordinator via serial (USB CDC). No native dependencies, runs in Electron.

## Future Direction

If we build a combined LoRa + Zigbee device:
- **LoRa side:** Meshtastic firmware on SX1262 via nRF52840 SPI
- **Zigbee side:** Coordinator firmware on nRF52840's native 802.15.4 radio
- **Host interface:** USB CDC serial to Electron app
- **Result:** One USB device that provides both off-grid mesh comms AND direct smart home control with no proprietary bridges
