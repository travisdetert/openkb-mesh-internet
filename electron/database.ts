import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface PathLossSample {
  fromNum: number;
  toNum: number;
  rssi: number;
  snr: number;
  hopsAway: number;
  ts: number;
}

export interface NodeRow {
  node_num: number;
  long_name: string;
  short_name: string;
  hw_model: number;
  first_seen: number;
  last_seen: number;
}

export interface PositionRow { node_num: number; lat: number; lon: number; altitude: number; ts: number; }
export interface DeviceTelemetryRow { node_num: number; battery: number; voltage: number; chan_util: number; air_util_tx: number; ts: number; }
export interface MessageRow { id: number; from_num: number; to_num: number; channel: number; text: string; rssi: number; snr: number; hop_start: number; hop_limit: number; ts: number; }
export interface PacketRow { id: number; from_num: number; to_num: number; portnum: number; rssi: number; snr: number; hop_start: number; hop_limit: number; ts: number; }
export interface TracerouteRow { request_id: number; from_num: number; to_num: number; route_json: string; sent_ts: number; recv_ts: number | null; rssi: number; snr: number; }
export interface LinkRow { a_num: number; b_num: number; rssi_min: number; rssi_max: number; snr_avg: number; count: number; last_ts: number; }
export interface AntennaOverrideRow { node_num: number; dbi: number; notes: string; updated_at: number; }
export interface OwnedDeviceRow { hw_model: number; quantity: number; notes: string; updated_at: number; }
export interface OwnedAntennaRow { antenna_id: string; quantity: number; notes: string; updated_at: number; }

export class MeshDatabase {
  private db: Database.Database;
  private dbPath: string;

  constructor(dataDir?: string) {
    const dir = dataDir ?? path.join(os.homedir(), '.openkb-mesh-internet');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.dbPath = path.join(dir, 'mesh.sqlite');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  getDbPath(): string { return this.dbPath; }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        node_num INTEGER PRIMARY KEY,
        long_name TEXT,
        short_name TEXT,
        hw_model INTEGER,
        first_seen INTEGER,
        last_seen INTEGER
      );

      CREATE TABLE IF NOT EXISTS positions (
        node_num INTEGER NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        altitude INTEGER,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_positions_node_ts ON positions(node_num, ts DESC);

      CREATE TABLE IF NOT EXISTS device_telemetry (
        node_num INTEGER NOT NULL,
        battery INTEGER,
        voltage REAL,
        chan_util REAL,
        air_util_tx REAL,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_device_telemetry_node_ts ON device_telemetry(node_num, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_device_telemetry_ts ON device_telemetry(ts DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER NOT NULL,
        from_num INTEGER NOT NULL,
        to_num INTEGER NOT NULL,
        channel INTEGER NOT NULL,
        text TEXT NOT NULL,
        rssi INTEGER,
        snr REAL,
        hop_start INTEGER,
        hop_limit INTEGER,
        ts INTEGER NOT NULL,
        PRIMARY KEY (id, from_num, ts)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts DESC);

      CREATE TABLE IF NOT EXISTS packet_log (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id INTEGER NOT NULL,
        from_num INTEGER NOT NULL,
        to_num INTEGER NOT NULL,
        portnum INTEGER,
        rssi INTEGER,
        snr REAL,
        hop_start INTEGER,
        hop_limit INTEGER,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_packet_log_from_ts ON packet_log(from_num, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_packet_log_ts ON packet_log(ts DESC);

      CREATE TABLE IF NOT EXISTS traceroutes (
        request_id INTEGER NOT NULL,
        from_num INTEGER NOT NULL,
        to_num INTEGER NOT NULL,
        route_json TEXT,
        sent_ts INTEGER NOT NULL,
        recv_ts INTEGER,
        rssi INTEGER,
        snr REAL,
        PRIMARY KEY (request_id, from_num, sent_ts)
      );
      CREATE INDEX IF NOT EXISTS idx_traceroutes_recv ON traceroutes(recv_ts DESC);

      CREATE TABLE IF NOT EXISTS links (
        a_num INTEGER NOT NULL,
        b_num INTEGER NOT NULL,
        rssi_min INTEGER,
        rssi_max INTEGER,
        snr_sum REAL,
        count INTEGER NOT NULL DEFAULT 0,
        last_ts INTEGER NOT NULL,
        PRIMARY KEY (a_num, b_num)
      );
      CREATE INDEX IF NOT EXISTS idx_links_last_ts ON links(last_ts DESC);

      /* Per-node antenna overrides. Meshtastic's wire protocol has no
         antenna field, so we keep this app-side: when the user upgrades
         a stock whip on their own radio (or notes that a peer's been
         upgraded), the override travels with the node_num and feeds the
         Link Budget / Coverage / Peer Check math instead of the hwModel's
         catalog stock value. */
      CREATE TABLE IF NOT EXISTS antenna_overrides (
        node_num INTEGER PRIMARY KEY,
        dbi REAL NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );

      /* Owned-devices roster. Records which hwModels the user personally
         owns (separate from "have seen in mesh"). Drives the Device DB's
         "Owned" filter / badge so a user can find their own fleet
         instantly even when those radios aren't currently on the air. */
      CREATE TABLE IF NOT EXISTS owned_devices (
        hw_model INTEGER PRIMARY KEY,
        quantity INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );

      /* Owned-antennas roster. Keyed by an app-side antenna_id from
         src/lib/antenna-catalog.ts (e.g. "diamond-x30a"). Used by the
         per-node antenna-override picker so the user can attach a known
         antenna spec to a node instead of retyping dBi each time. */
      CREATE TABLE IF NOT EXISTS owned_antennas (
        antenna_id TEXT PRIMARY KEY,
        quantity INTEGER NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
    `);
  }

  // ── Nodes ──────────────────────────────────────────────────────────────

  upsertNode(num: number, longName: string, shortName: string, hwModel: number, ts: number) {
    this.db.prepare(`
      INSERT INTO nodes (node_num, long_name, short_name, hw_model, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_num) DO UPDATE SET
        long_name = COALESCE(NULLIF(excluded.long_name, ''), long_name),
        short_name = COALESCE(NULLIF(excluded.short_name, ''), short_name),
        hw_model = CASE WHEN excluded.hw_model > 0 THEN excluded.hw_model ELSE hw_model END,
        last_seen = MAX(last_seen, excluded.last_seen)
    `).run(num, longName, shortName, hwModel, ts, ts);
  }

  touchNodeLastSeen(num: number, ts: number) {
    this.db.prepare(`
      INSERT INTO nodes (node_num, long_name, short_name, hw_model, first_seen, last_seen)
      VALUES (?, '', '', 0, ?, ?)
      ON CONFLICT(node_num) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen)
    `).run(num, ts, ts);
  }

  getNodes(): NodeRow[] {
    return this.db.prepare(`SELECT * FROM nodes ORDER BY last_seen DESC`).all() as NodeRow[];
  }

  // ── Positions ──────────────────────────────────────────────────────────

  insertPosition(num: number, lat: number, lon: number, altitude: number, ts: number) {
    if (lat === 0 && lon === 0) return;
    this.db.prepare(`INSERT INTO positions (node_num, lat, lon, altitude, ts) VALUES (?, ?, ?, ?, ?)`)
      .run(num, lat, lon, altitude, ts);
  }

  getLatestPositions(): Map<number, PositionRow> {
    const rows = this.db.prepare(`
      SELECT p.* FROM positions p
      JOIN (SELECT node_num, MAX(ts) as max_ts FROM positions GROUP BY node_num) m
        ON p.node_num = m.node_num AND p.ts = m.max_ts
    `).all() as PositionRow[];
    const map = new Map<number, PositionRow>();
    for (const r of rows) map.set(r.node_num, r);
    return map;
  }

  getPositionHistory(num: number, limit = 200): PositionRow[] {
    return this.db.prepare(`SELECT * FROM positions WHERE node_num = ? ORDER BY ts DESC LIMIT ?`)
      .all(num, limit) as PositionRow[];
  }

  // ── Device telemetry ───────────────────────────────────────────────────

  insertDeviceTelemetry(num: number, battery: number, voltage: number, chanUtil: number, airUtilTx: number, ts: number) {
    this.db.prepare(`INSERT INTO device_telemetry (node_num, battery, voltage, chan_util, air_util_tx, ts) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(num, battery, voltage, chanUtil, airUtilTx, ts);
  }

  getRecentTelemetry(sinceMs: number): DeviceTelemetryRow[] {
    return this.db.prepare(`SELECT * FROM device_telemetry WHERE ts >= ? ORDER BY ts ASC`)
      .all(sinceMs) as DeviceTelemetryRow[];
  }

  // ── Messages ───────────────────────────────────────────────────────────

  insertMessage(m: { id: number; fromNum: number; toNum: number; channel: number; text: string; rssi: number; snr: number; hopStart: number; hopLimit: number; ts: number }) {
    this.db.prepare(`
      INSERT OR IGNORE INTO messages (id, from_num, to_num, channel, text, rssi, snr, hop_start, hop_limit, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(m.id, m.fromNum, m.toNum, m.channel, m.text, m.rssi, m.snr, m.hopStart, m.hopLimit, m.ts);
  }

  getRecentMessages(limit = 200): MessageRow[] {
    const rows = this.db.prepare(`SELECT * FROM messages ORDER BY ts DESC LIMIT ?`).all(limit) as MessageRow[];
    return rows.reverse();
  }

  /**
   * Delete messages matching a single conversation. `kind='channel'`
   * matches anything broadcast on that channel; `kind='dm'` matches the
   * union of (me→peer) and (peer→me). Returns the row count deleted.
   */
  deleteMessagesByConversation(opts: { kind: 'channel' | 'dm'; channel?: number; myNum?: number; peer?: number }): number {
    if (opts.kind === 'channel' && opts.channel !== undefined) {
      const r = this.db.prepare(`DELETE FROM messages WHERE channel = ? AND to_num = ?`).run(opts.channel, 0xffffffff);
      return r.changes;
    }
    if (opts.kind === 'dm' && opts.myNum !== undefined && opts.peer !== undefined) {
      const r = this.db.prepare(`
        DELETE FROM messages
        WHERE (from_num = ? AND to_num = ?) OR (from_num = ? AND to_num = ?)
      `).run(opts.myNum, opts.peer, opts.peer, opts.myNum);
      return r.changes;
    }
    return 0;
  }

  /** Wipe every message. Confirmed by caller — no undo. */
  deleteAllMessages(): number {
    return this.db.prepare(`DELETE FROM messages`).run().changes;
  }

  /** Auto-prune helper — drop anything older than the cutoff (ms epoch). */
  // ── Antenna overrides ──────────────────────────────────────────────────

  listAntennaOverrides(): AntennaOverrideRow[] {
    return this.db.prepare(`SELECT * FROM antenna_overrides`).all() as AntennaOverrideRow[];
  }

  setAntennaOverride(nodeNum: number, dbi: number, notes: string, ts: number): void {
    this.db.prepare(`
      INSERT INTO antenna_overrides (node_num, dbi, notes, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(node_num) DO UPDATE SET dbi = excluded.dbi, notes = excluded.notes, updated_at = excluded.updated_at
    `).run(nodeNum, dbi, notes, ts);
  }

  clearAntennaOverride(nodeNum: number): boolean {
    const r = this.db.prepare(`DELETE FROM antenna_overrides WHERE node_num = ?`).run(nodeNum);
    return r.changes > 0;
  }

  // ── Owned devices / antennas ──────────────────────────────────────────

  listOwnedDevices(): OwnedDeviceRow[] {
    return this.db.prepare(`SELECT * FROM owned_devices`).all() as OwnedDeviceRow[];
  }
  setOwnedDevice(hwModel: number, quantity: number, notes: string, ts: number): void {
    this.db.prepare(`
      INSERT INTO owned_devices (hw_model, quantity, notes, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(hw_model) DO UPDATE SET quantity = excluded.quantity, notes = excluded.notes, updated_at = excluded.updated_at
    `).run(hwModel, quantity, notes, ts);
  }
  clearOwnedDevice(hwModel: number): boolean {
    return this.db.prepare(`DELETE FROM owned_devices WHERE hw_model = ?`).run(hwModel).changes > 0;
  }

  listOwnedAntennas(): OwnedAntennaRow[] {
    return this.db.prepare(`SELECT * FROM owned_antennas`).all() as OwnedAntennaRow[];
  }
  setOwnedAntenna(antennaId: string, quantity: number, notes: string, ts: number): void {
    this.db.prepare(`
      INSERT INTO owned_antennas (antenna_id, quantity, notes, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(antenna_id) DO UPDATE SET quantity = excluded.quantity, notes = excluded.notes, updated_at = excluded.updated_at
    `).run(antennaId, quantity, notes, ts);
  }
  clearOwnedAntenna(antennaId: string): boolean {
    return this.db.prepare(`DELETE FROM owned_antennas WHERE antenna_id = ?`).run(antennaId).changes > 0;
  }

  pruneMessagesOlderThan(tsMs: number): number {
    return this.db.prepare(`DELETE FROM messages WHERE ts < ?`).run(tsMs).changes;
  }

  // ── Packet log ─────────────────────────────────────────────────────────

  insertPacket(p: { id: number; fromNum: number; toNum: number; portnum: number; rssi: number; snr: number; hopStart: number; hopLimit: number; ts: number }) {
    this.db.prepare(`
      INSERT INTO packet_log (id, from_num, to_num, portnum, rssi, snr, hop_start, hop_limit, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.id, p.fromNum, p.toNum, p.portnum, p.rssi, p.snr, p.hopStart, p.hopLimit, p.ts);
  }

  getPacketsForNode(num: number, limit = 500): PacketRow[] {
    return this.db.prepare(`SELECT * FROM packet_log WHERE from_num = ? ORDER BY ts DESC LIMIT ?`)
      .all(num, limit) as PacketRow[];
  }

  /**
   * Path-loss samples join packet_log with the latest position of each node
   * so we can compute (distance, RSSI) pairs for the Coverage panel.
   * Limited to direct (hop_start - hop_limit == 0) or unknown-hop packets.
   */
  getPathLossSamples(myNodeNum: number, sinceMs: number): Array<{ fromNum: number; rssi: number; snr: number; hopsAway: number; lat: number; lon: number; ts: number }> {
    return this.db.prepare(`
      SELECT pl.from_num as fromNum, pl.rssi, pl.snr, COALESCE(pl.hop_start - pl.hop_limit, 0) as hopsAway,
             pos.lat, pos.lon, pl.ts
      FROM packet_log pl
      JOIN (SELECT node_num, lat, lon, MAX(ts) as max_ts FROM positions GROUP BY node_num) pos
        ON pos.node_num = pl.from_num
      WHERE pl.from_num != ?
        AND pl.rssi != 0
        AND pl.ts >= ?
      ORDER BY pl.ts DESC
    `).all(myNodeNum, sinceMs) as any;
  }

  // ── Traceroutes ────────────────────────────────────────────────────────

  insertTracerouteRequest(requestId: number, fromNum: number, toNum: number, ts: number) {
    this.db.prepare(`INSERT OR REPLACE INTO traceroutes (request_id, from_num, to_num, sent_ts) VALUES (?, ?, ?, ?)`)
      .run(requestId, fromNum, toNum, ts);
  }

  updateTracerouteResponse(fromNum: number, toNum: number, route: number[], rssi: number, snr: number, recvTs: number) {
    // Match against most recent unresolved request to that target
    this.db.prepare(`
      UPDATE traceroutes
      SET route_json = ?, recv_ts = ?, rssi = ?, snr = ?
      WHERE rowid = (
        SELECT rowid FROM traceroutes
        WHERE to_num = ? AND from_num = ? AND recv_ts IS NULL
        ORDER BY sent_ts DESC LIMIT 1
      )
    `).run(JSON.stringify(route), recvTs, rssi, snr, fromNum, toNum);
  }

  // ── Links ──────────────────────────────────────────────────────────────

  observeLink(aNum: number, bNum: number, rssi: number, snr: number, ts: number) {
    if (rssi === 0) return;
    // Sort tuple so (a,b) and (b,a) collapse into one row
    const [lo, hi] = aNum < bNum ? [aNum, bNum] : [bNum, aNum];
    const existing = this.db.prepare(`SELECT * FROM links WHERE a_num = ? AND b_num = ?`).get(lo, hi) as LinkRow | undefined;
    if (existing) {
      this.db.prepare(`
        UPDATE links SET
          rssi_min = MIN(rssi_min, ?),
          rssi_max = MAX(rssi_max, ?),
          snr_sum = snr_sum + ?,
          count = count + 1,
          last_ts = MAX(last_ts, ?)
        WHERE a_num = ? AND b_num = ?
      `).run(rssi, rssi, snr, ts, lo, hi);
    } else {
      this.db.prepare(`INSERT INTO links (a_num, b_num, rssi_min, rssi_max, snr_sum, count, last_ts) VALUES (?, ?, ?, ?, ?, 1, ?)`)
        .run(lo, hi, rssi, rssi, snr, ts);
    }
  }

  getLinks(): LinkRow[] {
    return this.db.prepare(`SELECT a_num, b_num, rssi_min, rssi_max, snr_sum / count as snr_avg, count, last_ts FROM links ORDER BY count DESC`).all() as LinkRow[];
  }

  // ── Stats ──────────────────────────────────────────────────────────────

  getStats() {
    return {
      nodes: (this.db.prepare(`SELECT COUNT(*) as c FROM nodes`).get() as any).c,
      positions: (this.db.prepare(`SELECT COUNT(*) as c FROM positions`).get() as any).c,
      telemetry: (this.db.prepare(`SELECT COUNT(*) as c FROM device_telemetry`).get() as any).c,
      messages: (this.db.prepare(`SELECT COUNT(*) as c FROM messages`).get() as any).c,
      packets: (this.db.prepare(`SELECT COUNT(*) as c FROM packet_log`).get() as any).c,
      traceroutes: (this.db.prepare(`SELECT COUNT(*) as c FROM traceroutes`).get() as any).c,
      links: (this.db.prepare(`SELECT COUNT(*) as c FROM links`).get() as any).c,
      dbPath: this.dbPath,
    };
  }

  close() { this.db.close(); }
}
