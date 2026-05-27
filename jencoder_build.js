// Pisces Moon OS — JenCoder Web Edition
// Copyright (C) 2026 Eric Becker / Fluid Fortune
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// jencoder_build.js — Build & Flash + Export
//
// Three paths the user can take:
//   1. ⚡ Build & Flash      → POST source to backend → idf.py build →
//                              Web Serial flash via esptool-js
//   2. ⊞  Export            → Generate .c + .h + integration.txt zip
//                              for local VS Code + ESP-IDF builds
//   3. 📋 Copy               → Plain source to clipboard for fast paste
//
// The backend default is the public cloud build at
// jencoder-build.fluidfortune.com. Local users running the bundled
// Node.js backend can override via the "Local backend" toggle in
// the build modal (sets window.JC_BUILD_API to http://localhost:3000).

const JC_BUILD_API_DEFAULT  = "https://jencoder-build.fluidfortune.com/api/build";
const JC_BUILD_API_LOCAL    = "http://localhost:3000/api/build";

// ─────────────────────────────────────────────────────────────
//  JenCoderBuilder
// ─────────────────────────────────────────────────────────────
class JenCoderBuilder {
  constructor() {
    this.busy = false;
    this.useLocalBackend = false;

    // IDE hooks (set by ide.js)
    this.statusHook   = (state, msg) => {};
    this.progressHook = (pct) => {};
    this.consoleLog   = (msg, type) => {};
    this.stageHook    = (stage, status) => {};   // status: pending|active|done|err
  }

  apiUrl() {
    return this.useLocalBackend ? JC_BUILD_API_LOCAL : JC_BUILD_API_DEFAULT;
  }

  // ───────────────────────────────────────────────────────────
  //  Auto-detect the app's function-suffix and ID from source.
  //  We look for "const pm_app_t* pm_app_<name>(void)" and the
  //  ".id = \"<id>\"" line in the pm_app_t literal.
  // ───────────────────────────────────────────────────────────
  parseAppMetadata(source) {
    const meta = {
      app_name: "myapp",
      app_id:   "myapp",
      category: "TOOLS",
      display_name: "MY APP",
    };

    const accessor = source.match(/const\s+pm_app_t\s*\*\s*pm_app_(\w+)\s*\(/);
    if (accessor) meta.app_name = accessor[1];

    const id = source.match(/\.id\s*=\s*"([^"]+)"/);
    if (id) meta.app_id = id[1];

    const dn = source.match(/\.display_name\s*=\s*"([^"]+)"/);
    if (dn) meta.display_name = dn[1];

    const cat = source.match(/\.category\s*=\s*PM_CAT_(\w+)/);
    if (cat) meta.category = cat[1];

    return meta;
  }

  // ═══════════════════════════════════════════════════════════
  //  CLOUD / LOCAL BUILD
  // ═══════════════════════════════════════════════════════════
  async build(source, meta) {
    if (this.busy) throw new Error("Build already in progress");
    this.busy = true;

    try {
      this.stageHook("compile", "active");
      this.statusHook("compiling", "Submitting source to build server...");
      this.progressHook(5);
      this.consoleLog("→ Connecting to " + this.apiUrl(), "info");

      const res = await fetch(this.apiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source:        source,
          app_name:      meta.app_name,
          app_id:        meta.app_id,
          display_name:  meta.display_name,
          category:      meta.category,
          target:        "esp32p4",
          api_version:   "1.0",
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Build server returned ${res.status}: ${txt.slice(0, 280)}`);
      }

      this.progressHook(40);
      this.statusHook("compiling", "Compiling on server (idf.py build)...");

      const result = await res.json();

      if (!result.ok) {
        this.stageHook("compile", "err");
        this.consoleLog("Compile failed:", "err");
        for (const line of (result.errors || ["Unknown error"])) {
          this.consoleLog("  " + line, "err");
        }
        throw new Error(result.errors?.[0] || "Compile failed");
      }

      this.progressHook(90);
      this.consoleLog(`✓ Compiled successfully (${result.binary_size} bytes)`, "info");
      this.stageHook("compile", "done");

      const binary = this._base64ToBytes(result.binary);

      this.progressHook(100);
      return {
        binary:        binary,
        size:          binary.length,
        flashAddress:  result.flash_address || 0x10000,
        partition:     result.partition || "factory",
        appName:       meta.app_name,
      };
    } finally {
      this.busy = false;
    }
  }

  _base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  _bytesToBinaryString(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  // ═══════════════════════════════════════════════════════════
  //  WEB SERIAL FLASH (esptool-js)
  // ═══════════════════════════════════════════════════════════
  async flash(buildResult) {
    if (!("serial" in navigator)) {
      throw new Error("Web Serial API not supported. Use Chrome, Edge, or Opera on desktop.");
    }

    this.stageHook("connect", "active");
    this.statusHook("connecting", "Requesting serial port...");
    this.consoleLog("→ Select your CrowPanel from the port picker", "info");

    let port;
    try {
      port = await navigator.serial.requestPort({ filters: [] });
    } catch (err) {
      this.stageHook("connect", "err");
      throw new Error("Port selection cancelled");
    }

    this.statusHook("connecting", "Opening port at 115200 baud...");
    await port.open({ baudRate: 115200 });
    this.consoleLog("✓ Port open", "info");
    this.stageHook("connect", "done");

    try {
      this.stageHook("flash", "active");
      this.statusHook("flashing", "Loading esptool-js...");
      const { ESPLoader, Transport } = await this._loadEsptool();

      const transport = new Transport(port, true);
      const loader = new ESPLoader({
        transport: transport,
        baudrate: 115200,
        terminal: {
          clean: () => {},
          writeLine: (data) => this.consoleLog("[esptool] " + data, "info"),
          write:     () => {},
        },
      });

      this.statusHook("flashing", "Detecting chip...");
      const chip = await loader.main();
      this.consoleLog(`✓ Detected: ${chip}`, "info");
      if (!/P4|p4/.test(String(chip))) {
        this.consoleLog(`⚠ Expected ESP32-P4, got ${chip}. Continuing anyway.`, "warn");
      }

      const fileArray = [{
        data:    this._bytesToBinaryString(buildResult.binary),
        address: buildResult.flashAddress,
      }];

      this.statusHook("flashing", "Writing flash...");
      this.progressHook(0);
      await loader.writeFlash({
        fileArray:  fileArray,
        flashSize:  "16MB",
        flashMode:  "qio",
        flashFreq:  "80m",
        eraseAll:   false,
        compress:   true,
        reportProgress: (fileIdx, written, total) => {
          const pct = Math.floor((written / total) * 100);
          this.progressHook(pct);
          this.statusHook("flashing", `Flashing ${pct}%...`);
        },
      });

      this.consoleLog("✓ Flash complete", "info");
      this.stageHook("flash", "done");

      this.stageHook("run", "active");
      this.statusHook("resetting", "Resetting CrowPanel...");
      await loader.hardReset();
      this.consoleLog("✓ Device reset — your app is running", "info");
      this.stageHook("run", "done");

      this.statusHook("done", "Flashed successfully");
    } finally {
      try { await port.close(); } catch (_) {}
    }
  }

  async _loadEsptool() {
    if (window._esptoolModule) return window._esptoolModule;
    const mod = await import(
      "https://cdn.jsdelivr.net/npm/esptool-js@0.4.4/+esm"
    );
    window._esptoolModule = mod;
    return mod;
  }

  // ═══════════════════════════════════════════════════════════
  //  EXPORT — generate a zip containing source + integration.txt
  // ═══════════════════════════════════════════════════════════
  async export(source, meta) {
    const JSZip = await this._loadJSZip();
    const zip = new JSZip();

    const name = meta.app_name || "myapp";
    const id   = meta.app_id   || name;
    const display = meta.display_name || name.toUpperCase();
    const category = meta.category || "TOOLS";

    // 1. The source file (.c)
    zip.file(`pm_app_${name}.c`, source);

    // 2. The header file (.h)
    zip.file(`pm_app_${name}.h`, this._generateHeader(name));

    // 3. integration.txt with exact lines to add to the firmware tree
    zip.file("integration.txt", this._generateIntegrationGuide(name, id, display, category));

    // 4. README inside the zip for quick reference
    zip.file("README_INTEGRATION.md", this._generateReadme(name, display, category));

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pm_app_${name}_export.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    this.consoleLog(`✓ Exported pm_app_${name}_export.zip`, "info");
  }

  _generateHeader(name) {
    return `// Pisces Moon OS
// Copyright (C) 2026 Eric Becker / Fluid Fortune
// SPDX-License-Identifier: AGPL-3.0-or-later
// Contributions: see CLA.md
// fluidfortune.com
//
// Generated by JenCoder Web Edition.

#ifndef PM_APP_${name.toUpperCase()}_H
#define PM_APP_${name.toUpperCase()}_H

#include "pm_app.h"

#ifdef __cplusplus
extern "C" {
#endif

const pm_app_t* pm_app_${name}(void);

#ifdef __cplusplus
}
#endif

#endif  // PM_APP_${name.toUpperCase()}_H
`;
  }

  _generateIntegrationGuide(name, id, display, category) {
    const catLower = category.toLowerCase();
    return `# JenCoder — Integration Guide for pm_app_${name}

Generated for app:
  id            = "${id}"
  display_name  = "${display}"
  category      = PM_CAT_${category}
  funcName      = pm_app_${name}()

This file lists exactly what to change in the
pisces-moon-os-p4 firmware tree to wire your app in.

────────────────────────────────────────────────────────────────
STEP 1 — Drop in the source files
────────────────────────────────────────────────────────────────

Copy these two files into the matching directory:

  pm_app_${name}.c → components/pm_apps/pm_apps_${catLower}/
  pm_app_${name}.h → components/pm_apps/pm_apps_${catLower}/include/

────────────────────────────────────────────────────────────────
STEP 2 — Register in main/pm_apps_register.c
────────────────────────────────────────────────────────────────

Add to the includes block near the top:

    #include "pm_app_${name}.h"

Add in main_register_apps(), inside the matching category block:

    REGISTER_IF(pm_app_${name}());

────────────────────────────────────────────────────────────────
STEP 3 — Update the category's CMakeLists.txt
────────────────────────────────────────────────────────────────

Edit:

  components/pm_apps/pm_apps_${catLower}/CMakeLists.txt

Add to the SRCS list:

    pm_app_${name}.c

────────────────────────────────────────────────────────────────
STEP 4 — Build and flash
────────────────────────────────────────────────────────────────

From the repo root:

    . $IDF_PATH/export.sh
    idf.py set-target esp32p4
    idf.py build
    idf.py -p /dev/ttyUSB0 flash monitor

Your app appears in the launcher under the ${category} category.

────────────────────────────────────────────────────────────────
Notes
────────────────────────────────────────────────────────────────

- Heavy work belongs in enter(), not init() — init() runs at boot
  and delays the launcher.
- Free transient state in exit(). The OS calls deinit() only at
  shutdown, which is rare.
- All LVGL access must happen with lvgl_port_lock() held inside
  background tasks. Code that runs from tick() is already on the
  LVGL thread.
- For modular hardware capabilities (NFC, LoRa, camera, etc.) use
  pm_peer_find(...) — never hard-code chip-specific calls. See the
  pm_peer.h docs.

Built with JenCoder Web Edition — jencoder.fluidfortune.com
`;
  }

  _generateReadme(name, display, category) {
    return `# ${display}

This zip was generated by JenCoder Web Edition for the
**${category}** category of Pisces Moon OS P4.

## Contents

- \`pm_app_${name}.c\` — your app source
- \`pm_app_${name}.h\` — the public accessor header
- \`integration.txt\` — exact steps to wire it into the firmware
- \`README_INTEGRATION.md\` — this file

## Quick start

1. Clone the firmware tree:
   \`\`\`
   git clone https://github.com/FluidFortune/pisces-moon-os-p4
   \`\`\`

2. Follow \`integration.txt\` step by step.

3. Open in VS Code with the **Espressif IDF** extension installed,
   set the target to **esp32p4**, then build and flash.

Or simply use JenCoder's **⚡ Build & Flash** button to skip the
local toolchain entirely.

[jencoder.fluidfortune.com](https://jencoder.fluidfortune.com)
`;
  }

  async _loadJSZip() {
    if (window.JSZip) return window.JSZip;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load JSZip"));
      document.head.appendChild(s);
    });
    return window.JSZip;
  }

  // ═══════════════════════════════════════════════════════════
  //  COMBINED BUILD + FLASH
  // ═══════════════════════════════════════════════════════════
  async buildAndFlash(source) {
    const meta = this.parseAppMetadata(source);
    try {
      const result = await this.build(source, meta);
      await this.flash(result);
      return { ok: true };
    } catch (err) {
      this.statusHook("error", err.message);
      this.consoleLog(`✗ ${err.message}`, "err");
      return { ok: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  COPY TO CLIPBOARD
  // ═══════════════════════════════════════════════════════════
  async copyToClipboard(source) {
    try {
      await navigator.clipboard.writeText(source);
      this.consoleLog("✓ Source copied to clipboard", "info");
      return true;
    } catch (err) {
      this.consoleLog(`✗ Clipboard write failed: ${err.message}`, "err");
      return false;
    }
  }
}

if (typeof window !== "undefined") {
  window.JenCoderBuilder = JenCoderBuilder;
}
