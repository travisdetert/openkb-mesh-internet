# Cross-country messaging and the 7-hop limit

> Short answer: **no, you can't send a Meshtastic message from California to New York
> over the mesh itself.** The 7-hop limit is the hard ceiling, but you'd hit
> physics-and-airtime walls long before that. Cross-country messaging happens by
> *leaving* the mesh — via an internet-connected gateway, not across it.

This doc explains why, with the actual numbers used elsewhere in the app.

---

## What "hop" means

A *hop* is one relay forwarding a packet to the next relay. Meshtastic uses
**managed flooding**: there are no routing tables. Every node that hears a
packet rebroadcasts it once after a small random delay, decrements the hop
counter, and drops duplicates it has seen before. The packet dies when the
counter hits zero.

So `hop_limit = 3` means:

```
SENDER ──► A ──► B ──► C   (counter: 3 → 2 → 1 → 0, dies)
```

C still receives and decodes the packet. It just won't rebroadcast it.

---

## Where the 7-hop number comes from

The hop counter in a Meshtastic packet header is a **3-bit field**: it can hold
the values 0–7. That's it. Seven is not a tuning parameter, it's the maximum
representable value in the protocol.

Meshtastic ships with `hop_limit = 3` by default. You can raise it up to 7 in
the channel settings. You cannot raise it higher without changing the protocol.

| Setting          | Default | Max |
|------------------|--------:|----:|
| `hop_limit`      | 3       | 7   |

You'll see this enforced in `src/concepts/instances/routing_scheme/managed-flood.json`:

```json
"max_practical_hops": 7
```

and in the Mesh Routing panel's slider (range 1–7).

---

## How far is 7 hops, in real distance?

It depends entirely on the radios, antennas, terrain, and node spacing. Some
points of reference (LongFast, the Meshtastic default, on 915 MHz):

| Setup                                       | Typical per-hop distance |
|---------------------------------------------|-------------------------:|
| Two handhelds, urban ground level           |          ~0.5–2 km       |
| Two handhelds, suburban / open ground       |          ~3–8 km         |
| Roof-mounted node ↔ roof-mounted node       |          ~10–25 km       |
| Hilltop / mountaintop ↔ hilltop             |          ~30–80 km       |
| Balloon or summit relay (LongSlow)          |          250+ km record  |

So a "best realistic" 7-hop chain — 7 mountaintop nodes lined up with line of
sight to each other — could in principle reach **300–500 km** in one direction.
That's the "MeshCore Texas" or "Bay Area MTN" kind of regional deployment.
It's not nothing. But it's not coast-to-coast.

The continental US is ~4,500 km wide. Even at the optimistic 70 km/hop
mountaintop number, you'd need ~64 perfectly-placed hops. The protocol allows
seven.

---

## Why the limit exists at all

You might ask: why not just allow 30 hops? Two reasons make this physically
unworkable, completely separate from the 3-bit field.

### 1. Airtime cost grows with the size of the flood

Managed flooding has **no notion of "the path."** Every node that hears the
packet retransmits it. So the airtime cost of one message is roughly:

```
airtime_per_packet × number_of_relays_in_range
```

On LongFast, one ~50-byte text message = **~1.0 s of airtime** (see
`src/concepts/instances/modulation/long-fast.json`). In a 50-node neighborhood
mesh, that one message can occupy **20+ seconds** of shared channel time as it
ripples outward. With LongSlow, a 50-byte message is **5.9 s** per hop.

Regulators (FCC Part 15, ETSI EN 300 220) cap how much airtime any radio can
take. The EU 868 MHz band is limited to **1% duty cycle** — 36 seconds of
transmit per hour. A single big flood can blow that budget for every node in
range.

This is also why Meshtastic has the `ROUTER` / `CLIENT` roles — only routers
rebroadcast. In dense areas, most nodes should be `CLIENT_MUTE` so they listen
without re-flooding.

### 2. Per-hop packet loss compounds

`managed-flood.json` lists the typical per-hop loss as **8%**. So the chance
of a packet surviving N hops is roughly `0.92^N`:

| Hops | Survival chance |
|------|----------------:|
| 1    |  92 %           |
| 3    |  78 %           |
| 5    |  66 %           |
| 7    |  56 %           |
| 15   |  29 %           |
| 30   |   8 %           |
| 60   |   0.6 %         |

There are no per-hop ACKs or retransmits in flooding (`retransmits_on_loss: 0`
in the routing scheme). The end-to-end ACK exists, but if it gets lost on the
return trip — same physics — you may not know whether the message arrived.

By the time you'd want a 30-hop mesh to span a region, fewer than 1 in 10
messages would actually reach the far end. The 7-hop cap is generous for what
the physics already allow.

### 3. There's no global address space

Meshtastic node IDs are 32-bit integers, often shown as `!a1b2c3d4`. There is
no central registry, no DHT, no "find me node X anywhere on Earth" mechanism.
Floods only reach who is in range of someone in range of someone… up to the
hop limit. Nodes outside that radius do not exist, as far as your packet is
concerned.

---

## So how *do* people send a message across the country?

By **bridging out to the internet**. A node configured as an MQTT gateway
publishes packets it hears to a broker — the public default is
`mqtt.meshtastic.org`, but private brokers are common. Other gateways
subscribed to the same topic re-inject those packets into their own local
mesh.

```
LOCAL MESH (CA)             INTERNET             LOCAL MESH (NY)
node ──► node ──► gateway ─────► MQTT broker ─────► gateway ──► node ──► node
   (RF, hops)        (TCP/IP — "infinite range")        (RF, hops)
```

Things to know about this:

- **It's not the mesh.** Your packet leaves RF, traverses the regular internet,
  and re-enters RF on the other side. It is just two local meshes glued
  together by a TCP/IP backbone. If either gateway is down, or the broker is
  unreachable, you have two unrelated meshes again.
- **Encryption still works.** MQTT carries the encrypted payload. The broker
  cannot read it. But anyone on the same channel (sharing the PSK) anywhere on
  Earth — that's the point of MQTT bridging — can.
- **It's bandwidth-asymmetric.** The internet leg is effectively free. The
  RF legs still carry every cross-country message and pay full airtime for it.
  Subscribing a busy mesh to a global topic is how you accidentally saturate
  your local channel with traffic from strangers.
- **It is the only mainstream way.** No amount of protocol tuning makes
  RF-only Meshtastic span continents.

Other ways to cover long distance — outside Meshtastic itself:

| Technology         | Range              | Tradeoff                              |
|--------------------|--------------------|---------------------------------------|
| HF amateur radio   | global (skip)      | Licensed, slow, much harder to use    |
| Iridium / Starlink | global             | Subscription, hardware cost           |
| LoRaWAN            | ~15 km/gateway     | Needs infrastructure (gateways + NS)  |
| Cellular / SMS     | wherever there's a tower | Defeats the off-grid premise   |

---

## What Meshtastic *is* good at

Putting all of the above together, the honest framing of Meshtastic:

- A **local-to-regional** off-grid messaging system.
- Best at: hiking groups, neighborhood disaster nets, ski resorts, festivals,
  remote crews, sailing fleets within VHF-ish horizon of each other.
- Not at all suited for: replacing the internet, country-scale routing,
  high-bandwidth anything (max throughput is a few kbps shared), or as a
  substitute for proper LoRaWAN infrastructure if you actually need
  city-wide IoT.

The 7-hop limit is not a frustration to engineer around — it's a sign the
protocol knows what it is. Trying to push past it with managed flooding would
saturate every shared channel under it and still wouldn't reach far enough to
matter.

If you want global reach, you bridge to the internet. If you want
internet-grade WAN routing, you don't use a flood protocol — you use a
routing protocol like the ones documented under `src/concepts/instances/`:
AODV, OLSR, source-routed, or Yggdrasil/cjdns-style cryptographic routing.

---

## TL;DR

- The 7-hop max is a 3-bit field. There is no "make it bigger" knob.
- Default is 3 hops. Max is 7. Both apply per-packet.
- 7 hops in the real world is **regional, not continental** — best case a few
  hundred km with mountaintop relays.
- Even if hops were unlimited, packet loss and airtime would kill anything
  much past ~10 hops in a real mesh.
- Cross-country messages happen via **MQTT bridging to the internet**, not
  across the RF mesh.
- Meshtastic is for resilient *local* messaging. That's the whole pitch.
