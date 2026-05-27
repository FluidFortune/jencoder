// Pisces Moon OS — JenCoder Web Edition
// Copyright (C) 2026 Eric Becker / Fluid Fortune
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// jencoder_peer.js — Modular peer registry mock
//
// Pisces Moon P4 is a MODULAR OS. Apps don't ask "do we have a
// PN532?" — they ask "is anything offering nfc_read?" and let the
// registry answer.
//
// JenCoder's preview pretends the following peers are connected:
//   - C6 Ghost Engine        (wifi_scan, wifi_capture, ble_scan, ble_gatt, http_get/post)
//   - BN-180 GPS             (gps_remote — but P4 reads it direct)
//   - PN532 NFC reader       (nfc_read, nfc_write, nfc_emulate)
//   - SX1262 wireless slot   (lora_tx, lora_rx, lora_mesh)
//   - T-Beam Supreme S3      (wifi_scan secondary, ble_scan secondary)
//   - CSI camera             (camera_snapshot, camera_stream, camera_barcode)
//
// Calls to pm_peer_call() with op strings ("scan", "read_tag", "tx",
// "get_fix") return deterministic mock data, slowly walking
// coordinates, varying RSSI, fake BSSIDs, etc — enough that scanner
// UIs render lifelike previews.
//
// Apps that depend on a specific peer get the appropriate handle.
// Apps that look up an unavailable capability get null — letting
// the "feature unavailable" branch be exercised in preview.

// ─────────────────────────────────────────────────────────────
//  Peer kind enum (matches pm_peer.h)
// ─────────────────────────────────────────────────────────────
const PM_PEER_KIND = {
  C6_GHOST:       0,
  TBEAM_S3:       1,
  SLOT_SX1262:    2,
  SLOT_NRF24:     3,
  SLOT_H2:        4,
  SLOT_C6:        5,
  SLOT_HALOW:     6,
  NFC_PN532:      7,
  CAMERA_CSI:     8,
  BT_GAMEPAD:     9,
  BT_KEYBOARD:    10,
  CARDPUTER_I2C:  11,
};

const PM_PEER_ROLE = {
  ANY:        0,
  PRIMARY:    1,
  SECONDARY:  2,
  EXCLUSIVE:  3,
};

// Hand-rolled mock SSID set — keeps wardrive scans believable
const MOCK_SSIDS = [
  { ssid: "PiscesMoon-Lab",     bssid: "AA:BB:CC:00:01:02", enc: "WPA2",    ch: 6,  rssi: -42 },
  { ssid: "Fluid Fortune Net",  bssid: "11:22:33:44:55:66", enc: "WPA3",    ch: 11, rssi: -55 },
  { ssid: "JenCoder-Dev",       bssid: "DC:EE:FF:11:22:33", enc: "WPA2",    ch: 1,  rssi: -47 },
  { ssid: "Coffee_Shop",        bssid: "00:1A:2B:3C:4D:5E", enc: "OPEN",    ch: 3,  rssi: -68 },
  { ssid: "linksys",            bssid: "00:18:84:00:00:11", enc: "WEP",     ch: 8,  rssi: -78 },
  { ssid: "",                   bssid: "F4:CB:52:1A:9D:31", enc: "WPA2",    ch: 6,  rssi: -82 },
  { ssid: "GhostEngine",        bssid: "00:DE:AD:BE:EF:00", enc: "WPA2/3",  ch: 11, rssi: -61 },
];

const MOCK_BLE = [
  { mac: "F4:E1:38:01:23:45", name: "PiscesMoon T-Deck",  rssi: -45, connectable: true,  mfg: "Espressif" },
  { mac: "C2:08:1F:73:21:B0", name: "JBL Flip 6",          rssi: -58, connectable: true,  mfg: "JBL" },
  { mac: "5E:11:22:33:44:55", name: "",                    rssi: -72, connectable: false, mfg: "" },
  { mac: "AC:23:3F:DD:EE:01", name: "8BitDo SN30 Pro",     rssi: -52, connectable: true,  mfg: "8BitDo" },
  { mac: "00:0C:BF:11:22:33", name: "Garmin HRM",          rssi: -77, connectable: true,  mfg: "Garmin" },
  { mac: "D4:7A:E2:99:88:77", name: "Apple Watch",         rssi: -64, connectable: true,  mfg: "Apple" },
];

const MOCK_NFC_TAGS = [
  { uid: [0x04, 0xA3, 0xF2, 0x11, 0xC2, 0x5E, 0x80], type: "NTAG215", ndef_text: "Pisces Moon dev tag" },
  { uid: [0x04, 0x88, 0x12, 0xC5, 0x9B, 0x44, 0x70], type: "MIFARE Classic 1K", ndef_text: "" },
  { uid: [0x04, 0xFE, 0xED, 0xBE, 0xEF, 0x00, 0x00], type: "NTAG213", ndef_text: "https://fluidfortune.com" },
];

// ─────────────────────────────────────────────────────────────
//  Peer instances
// ─────────────────────────────────────────────────────────────
class PMPeer {
  constructor(opts) {
    this.kind = opts.kind;
    this.name = opts.name;
    this.role = opts.role;
    this.caps = opts.caps;       // array of capability strings
    this.degraded = !!opts.degraded;
    this._held = false;
  }
}

// ─────────────────────────────────────────────────────────────
//  Registry
// ─────────────────────────────────────────────────────────────
class JCPeerRegistry {
  constructor() {
    this.peers = [];
    this._gpsBase = { lat: 34.06713, lng: -118.20405 };
    this._scanSerial = 0;
    this._bleSerial = 0;
    this._loraInbox = [];
    this._nfcCycle = 0;
    this._tagPresentSince = 0;
    this._initialized = false;
  }

  init() {
    if (this._initialized) return this.peers.length;

    // C6 Ghost Engine — always present
    this.peers.push(new PMPeer({
      kind: PM_PEER_KIND.C6_GHOST,
      name: "C6 Ghost Engine",
      role: PM_PEER_ROLE.PRIMARY,
      caps: ["wifi_scan", "wifi_capture", "wifi_promisc",
             "wifi_connect", "ble_scan", "ble_gatt", "ble_hid_host",
             "http_get", "http_post"],
    }));

    // BN-180 GPS — permanent fixture, P4-direct on UART1
    this.peers.push(new PMPeer({
      kind: PM_PEER_KIND.C6_GHOST,
      name: "BN-180 GPS",
      role: PM_PEER_ROLE.PRIMARY,
      caps: ["gps_remote"],
    }));

    // PN532 NFC reader — detected via C6 bridge
    this.peers.push(new PMPeer({
      kind: PM_PEER_KIND.NFC_PN532,
      name: "PN532 NFC",
      role: PM_PEER_ROLE.PRIMARY,
      caps: ["nfc_read", "nfc_write", "nfc_emulate"],
    }));

    // SX1262 in wireless slot — detected via SPI signature
    this.peers.push(new PMPeer({
      kind: PM_PEER_KIND.SLOT_SX1262,
      name: "SX1262 Slot",
      role: PM_PEER_ROLE.PRIMARY,
      caps: ["lora_tx", "lora_rx", "lora_mesh", "lora_voice"],
    }));

    // T-Beam Supreme S3 — secondary radios
    this.peers.push(new PMPeer({
      kind: PM_PEER_KIND.TBEAM_S3,
      name: "T-Beam Supreme S3",
      role: PM_PEER_ROLE.SECONDARY,
      caps: ["wifi_scan", "ble_scan", "lora_tx", "lora_rx"],
    }));

    // CSI camera — detected via I2C
    this.peers.push(new PMPeer({
      kind: PM_PEER_KIND.CAMERA_CSI,
      name: "CSI Camera SC2336",
      role: PM_PEER_ROLE.PRIMARY,
      caps: ["camera_snapshot", "camera_stream", "camera_barcode"],
    }));

    // Paired gamepad — would be present if user has pre-paired
    this.peers.push(new PMPeer({
      kind: PM_PEER_KIND.BT_GAMEPAD,
      name: "8BitDo Gamepad",
      role: PM_PEER_ROLE.PRIMARY,
      caps: ["gamepad_hid"],
    }));

    this._initialized = true;
    return this.peers.length;
  }

  // pm_peer_find(capability, role)
  find(capability, role) {
    if (!this._initialized) this.init();
    role = role || PM_PEER_ROLE.ANY;

    // Filter by capability
    const matches = this.peers.filter(p => p.caps.includes(capability));
    if (matches.length === 0) return null;

    if (role === PM_PEER_ROLE.PRIMARY) {
      const p = matches.find(p => p.role === PM_PEER_ROLE.PRIMARY);
      if (p) return p;
      return null;
    }
    if (role === PM_PEER_ROLE.SECONDARY) {
      const p = matches.find(p => p.role === PM_PEER_ROLE.SECONDARY);
      if (p) return p;
      return null;
    }
    if (role === PM_PEER_ROLE.EXCLUSIVE) {
      const p = matches.find(p => p.role === PM_PEER_ROLE.PRIMARY && !p._held);
      if (p) { p._held = true; return p; }
      return null;
    }
    return matches[0];
  }

  release(p) {
    if (p) p._held = false;
  }

  // Call into a peer. Returns { rc: 0, data: ... } on success.
  call(p, op, params) {
    if (!p) return { rc: -1, data: null };

    // GPS
    if (p.caps.includes("gps_remote") && (op === "get_fix" || op === "status")) {
      return { rc: 0, data: this.getGpsFix() };
    }

    // WiFi scan
    if (op === "scan" && p.caps.includes("wifi_scan")) {
      this._scanSerial++;
      return { rc: 0, data: { networks: this.scanWifi() } };
    }

    // BLE scan
    if (op === "ble_scan_start" || op === "ble_scan") {
      this._bleSerial++;
      return { rc: 0, data: { devices: this.scanBle() } };
    }
    if (op === "ble_scan_stop") {
      return { rc: 0, data: {} };
    }

    // NFC
    if (op === "read_tag" || op === "poll" || op === "nfc_poll") {
      return { rc: 0, data: this.pollNfc() };
    }
    if (op === "write_tag" || op === "nfc_write") {
      jcHal.consoleLog(`[NFC] Mock write to tag: ${(params || "").slice(0, 80)}`, "info");
      return { rc: 0, data: {} };
    }
    if (op === "emulate") {
      jcHal.consoleLog(`[NFC] Mock emulation started`, "info");
      return { rc: 0, data: {} };
    }

    // LoRa
    if (op === "lora_tx" || op === "tx") {
      jcHal.consoleLog(`[LoRa] TX: ${(params || "").slice(0, 80)}`, "info");
      // Echo it back after a beat so the mesh UI can show a delivered marker
      setTimeout(() => {
        this._loraInbox.push({
          ts:   jcHal.pm_millis(),
          from: 0xCAFE,
          to:   0xFFFF,
          rssi: -88 + Math.floor(Math.random() * 12),
          text: "ACK " + (params || "").slice(0, 40),
        });
      }, 600);
      return { rc: 0, data: {} };
    }
    if (op === "lora_rx" || op === "lora_pop") {
      if (this._loraInbox.length > 0) {
        return { rc: 0, data: this._loraInbox.shift() };
      }
      return { rc: 0, data: null };
    }

    // Camera
    if (op === "snapshot") {
      return { rc: 0, data: { width: 1280, height: 720, bytes: 124000 } };
    }
    if (op === "stream_start") {
      return { rc: 0, data: { url: "csi://0" } };
    }
    if (op === "barcode" || op === "qr_decode") {
      return { rc: 0, data: { type: "QR", text: "https://fluidfortune.com" } };
    }

    // HTTP proxy
    if (op === "http_get") {
      return { rc: 0, data: { status: 200, body: "{\"ok\":true,\"mock\":true}" } };
    }

    // Status
    if (op === "status") {
      return { rc: 0, data: { name: p.name, ok: true, degraded: p.degraded } };
    }

    return { rc: 0, data: null };
  }

  count() { return this.peers.length; }
  at(i)   { return this.peers[i] || null; }

  // ── Mock data generators ────────────────────────────────────

  getGpsFix() {
    const t = jcHal.pm_millis() / 1000;
    return {
      valid: true,
      lat:   this._gpsBase.lat + Math.sin(t * 0.05) * 0.0002,
      lng:   this._gpsBase.lng + Math.cos(t * 0.05) * 0.0002,
      alt_m: 89.0 + Math.sin(t * 0.1) * 1.5,
      sats:  8 + Math.floor(Math.sin(t * 0.2) * 2),
      speed_mps: Math.abs(Math.sin(t * 0.07)) * 1.2,
      heading: (t * 5) % 360,
      hour:   new Date().getUTCHours(),
      minute: new Date().getUTCMinutes(),
      second: new Date().getUTCSeconds(),
      last_update_ms: jcHal.pm_millis(),
    };
  }

  scanWifi() {
    // Jitter the RSSI of each network so the list animates a little
    const arr = MOCK_SSIDS.map(n => ({
      ssid:  n.ssid,
      bssid: n.bssid,
      enc:   n.enc,
      ch:    n.ch,
      rssi:  n.rssi + Math.floor((Math.random() - 0.5) * 8),
    }));
    arr.sort((a, b) => b.rssi - a.rssi);
    return arr;
  }

  scanBle() {
    const arr = MOCK_BLE.map(d => ({
      mac:  d.mac,
      name: d.name,
      rssi: d.rssi + Math.floor((Math.random() - 0.5) * 6),
      connectable: d.connectable,
      mfg:  d.mfg,
    }));
    arr.sort((a, b) => b.rssi - a.rssi);
    return arr;
  }

  // NFC poll — tags come and go on an 8-second cycle
  pollNfc() {
    const t = jcHal.pm_millis() % 8000;
    const present = (t < 2500);
    if (!present) {
      this._tagPresentSince = 0;
      return { valid: false, uid: [], uid_len: 0, ndef_text: "", type: "" };
    }
    if (this._tagPresentSince === 0) {
      this._tagPresentSince = jcHal.pm_millis();
      this._nfcCycle = (this._nfcCycle + 1) % MOCK_NFC_TAGS.length;
    }
    const tag = MOCK_NFC_TAGS[this._nfcCycle];
    return {
      valid:     true,
      uid:       tag.uid,
      uid_len:   tag.uid.length,
      ndef_text: tag.ndef_text,
      type:      tag.type,
      data_len:  tag.uid.length,
    };
  }

  // ── Convenience wrappers exposed to templates ────────────────
  getNfcTag() { return this.pollNfc(); }

  getWifiCount() {
    if (!this._wifiCache || jcHal.pm_millis() - this._wifiCacheMs > 2000) {
      this._wifiCache = this.scanWifi();
      this._wifiCacheMs = jcHal.pm_millis();
    }
    return this._wifiCache.length;
  }
  getWifiAp(idx) {
    if (!this._wifiCache) this.getWifiCount();
    return this._wifiCache[idx] || null;
  }

  getBleCount() {
    if (!this._bleCache || jcHal.pm_millis() - this._bleCacheMs > 2000) {
      this._bleCache = this.scanBle();
      this._bleCacheMs = jcHal.pm_millis();
    }
    return this._bleCache.length;
  }
  getBleDev(idx) {
    if (!this._bleCache) this.getBleCount();
    return this._bleCache[idx] || null;
  }

  geminiReply(prompt) {
    if (!prompt) return "(empty prompt)";
    const replies = [
      "I am the Pisces Moon Gemini proxy running in JenCoder preview. Drop a real API key into include/secrets.h to get live responses on hardware.",
      "Got it. In a real deployment the C6 forwards this over HTTPS to generativelanguage.googleapis.com and the JSON response routes back here.",
      "Mock reply " + (this._geminiCount = (this._geminiCount || 0) + 1) + " — your prompt was " + prompt.length + " chars long.",
      "Pisces Moon's Gemini integration treats the C6 as an HTTP proxy peer so the P4 never needs an IP stack of its own.",
    ];
    return replies[(this._geminiCount || 0) % replies.length];
  }
}

// ─────────────────────────────────────────────────────────────
//  Top-level pm_* exports
// ─────────────────────────────────────────────────────────────
const jcPeer = new JCPeerRegistry();
if (typeof window !== "undefined") {
  window.jcPeer = jcPeer;
  window.PM_PEER_KIND = PM_PEER_KIND;
  window.PM_PEER_ROLE = PM_PEER_ROLE;

  // pm_peer_*  user-visible functions
  window.pm_peer_init_auto = () => jcPeer.init();
  window.pm_peer_find      = (cap, role) => jcPeer.find(cap, role);
  window.pm_peer_release   = (p) => jcPeer.release(p);
  window.pm_peer_call      = (p, op, params) => jcPeer.call(p, op, params).rc;
  window.pm_peer_count     = () => jcPeer.count();
  window.pm_peer_at        = (i) => jcPeer.at(i);
  window.pm_peer_kind      = (p) => p ? p.kind : -1;
  window.pm_peer_name      = (p) => p ? p.name : "";
  window.pm_peer_capabilities = (p) => p ? p.caps : [];

  // pm_gps_state — convenience direct accessor used by some apps
  window.pm_gps_state_get = (out) => {
    const g = jcPeer.getGpsFix();
    if (out) Object.assign(out, g);
    return g;
  };
}
