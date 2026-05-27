# JenCoder Web Edition — Pisces Moon P4 IDE

> *Sibling tool to [Lety](https://lety.fluidfortune.com).
> Lety targets the ESP32-S3 family. JenCoder targets the ESP32-P4 family.*

Browser-based development for **Pisces Moon OS P4** — the dual-MCU
implementation that runs on boards with an **ESP32-P4** application
processor and an **ESP32-C6** always-on radio coprocessor.

**Write code → click ⚡ Build &amp; Flash → app runs on your CrowPanel.**

**Live:** https://jencoder.fluidfortune.com
**Main OS:** github.com/FluidFortune/pisces-moon-os-p4
**S3 cousin IDE:** https://lety.fluidfortune.com
**License:** AGPL-3.0-or-later

---

## What You Get

- **Monaco editor** with Pisces Moon P4 API autocomplete and C highlighting
- **Live preview** — your app's `pm_app_t` lifecycle runs in a 1024×600
  CrowPanel emulator window in your browser
- **Cloud build** — backend runs `idf.py build` for `esp32p4`, returns
  a real `.bin`
- **Web Serial flash** — flashes directly to your CrowPanel without
  leaving Chrome
- **8 starter templates** covering every category (TOOLS, GAMES, COMMS,
  CYBER, INTEL, MEDIA, SYSTEM) — built around the `pm_app_t` contract
- **Full API reference** — `pm_ui`, `pm_hal`, `pm_peer`, `pm_gps_state`,
  `pm_nosql`, `pm_sqlite` — searchable in the sidebar
- **Modular peer mocks** — preview lifelike WiFi/BLE/NFC/GPS scans
  without hardware
- **Export** — generates `pm_app_*.c` + `pm_app_*.h` + integration
  steps for local VS Code + ESP-IDF builds

---

## JenCoder vs Lety — Why Two IDEs?

The Pisces Moon family ships on two distinct hardware lines:

| | **Lety** (S3) | **JenCoder** (P4) |
|---|---|---|
| **Target chip** | ESP32-S3 | ESP32-P4 + ESP32-C6 |
| **Reference board** | LilyGO T-Deck Plus | ELECROW CrowPanel Advanced 7" |
| **Display** | 320×240 ST7789 | 1024×600 MIPI-DSI touch |
| **Language** | Arduino C++ | C (ESP-IDF) |
| **Graphics** | Arduino_GFX | LVGL via `pm_ui` kit |
| **Build system** | PlatformIO | ESP-IDF + CMake |
| **App contract** | `void run_my_app()` + `apps.h` decl | `pm_app_t` struct (lifecycle hooks) |
| **Radio model** | Direct (single-MCU) | Modular via `pm_peer` (C6 coprocessor) |
| **Cost (board)** | ~$80 | ~$46 |

Both IDEs share the Pisces Moon brand, palette, and three workflow
paths. Both are AGPL-3.0-or-later. Skills transfer between them — if
you can write a Lety app, you can write a JenCoder app.

JenCoder Web Edition is also the browser counterpart to **JenCoder**
(the desktop tool inside **Jennifer OS** — coming soon). Both share
the same source format: anything built here drops into Jennifer OS
unchanged.

---

## I'm New to ESP32 — What's Different About the P4?

If you've used the S3 (or any Arduino-style ESP32), the P4 family
introduces three structural differences worth knowing up front.

### 1. Two MCUs instead of one

The P4 has no built-in WiFi or Bluetooth. Pisces Moon pairs it with
an **ESP32-C6** — a small always-on radio coprocessor — that handles
all networking and BLE traffic and forwards events to the P4 over
a UART bridge.

Apps never talk to the C6 directly. They ask the **peer registry**
for a capability, and the registry routes the call:

```c
pm_peer_t* p = pm_peer_find("wifi_scan", PM_PEER_ROLE_PRIMARY);
if (p) {
    pm_peer_call(p, "scan_start", NULL);
}
```

If a WiFi scanner peer is registered (the C6 always is, and a T-Beam
might be plugged in as a secondary), you get a handle. If nothing
provides that capability, you get `NULL` and the app shows
"feature unavailable" gracefully. This is the **modular OS philosophy**:
present what's there, hide what isn't.

### 2. ESP-IDF, not Arduino

P4 apps compile under **ESP-IDF** — Espressif's native C SDK — not
Arduino. The build system is CMake. The HAL replaces Arduino calls
with `pm_hal_*`:

| Arduino (S3) | Pisces Moon P4 |
|---|---|
| `Serial.print` | `pm_log_i(TAG, "...")` |
| `millis()` | `pm_millis()` |
| `delay(ms)` | `pm_delay_ms(ms)` |
| `ps_malloc()` | `pm_psram_alloc()` |
| `SemaphoreHandle_t` | `pm_mutex_t` |
| `File / SdFat` | `pm_file_t` |
| `Arduino_GFX*` | LVGL via `pm_ui_*` |

### 3. LVGL via the `pm_ui_*` widget kit

Instead of drawing pixels directly, P4 apps compose a screen out of
**LVGL widgets** wrapped by Pisces Moon's `pm_ui_*` kit. A typical
app's `_build_screen()` is six or seven function calls:

```c
static void _build_screen(void) {
    s_screen = pm_ui_screen();
    pm_ui_titlebar(s_screen, "MY APP", NULL, NULL);

    lv_obj_t* card = pm_ui_card(s_screen);
    s_lbl_uptime = pm_ui_kv_row(card, "UPTIME", "0 s");
    s_lbl_clicks = pm_ui_kv_row(card, "CLICKS", "0");

    pm_ui_button(s_screen, "TAP ME", _on_click, NULL);
}
```

…and that's the whole UI. The kit enforces a coherent look across all
56+ Pisces Moon P4 apps — same titlebar, same card styling, same
palette, same touch behavior.

---

## The App Contract — `pm_app_t`

Every app on Pisces Moon P4 implements this struct:

```c
typedef struct {
    const char*    id;          // "myapp"
    const char*    display_name;// "MY APP"
    pm_category_t  category;
    uint16_t       icon_id;

    void (*init)(void);
    void (*enter)(void);
    void (*tick)(uint32_t elapsed_ms);
    void (*exit)(void);
    void (*deinit)(void);
} pm_app_t;
```

Lifecycle:

| Hook | When | Notes |
|---|---|---|
| `init` | Once at boot | Allocate persistent state. Keep it light — runs during launcher boot. May be `NULL`. |
| `enter` | Every time user opens the app | Build/show LVGL screen, subscribe to input. This is where heavy alloc belongs. |
| `tick` | Periodic from main loop | `elapsed_ms` since last tick. Optional. ~30 Hz typical. |
| `exit` | Every time user backs out | Free transient state, hide screen, unsubscribe. |
| `deinit` | Once at shutdown | Rare. May be `NULL`. |

The bottom of every app file looks like this:

```c
static const pm_app_t _APP = {
    .id           = "myapp",
    .display_name = "MY APP",
    .category     = PM_CAT_TOOLS,
    .init         = _init,
    .enter        = _enter,
    .tick         = _tick,
    .exit         = _exit_,
    .deinit       = NULL,
};

const pm_app_t* pm_app_myapp(void) { return &_APP; }
```

The launcher discovers apps through `pm_apps_register.c`, which calls
each app's accessor in turn. JenCoder's **Export** path generates an
`integration.txt` showing exactly which lines to add.

---

## The `pm_ui_*` Widget Kit

| Widget | Purpose |
|---|---|
| `pm_ui_screen` | Fresh screen with base styling — use instead of `lv_obj_create(NULL)` |
| `pm_ui_titlebar` | Top bar with app name + optional back button |
| `pm_ui_card` | Bordered, padded container |
| `pm_ui_button` | Themed button with `LV_EVENT_CLICKED` callback |
| `pm_ui_chip` | Small status pill |
| `pm_ui_kv_row` | "KEY: value" row — returns the value label so you can update it |
| `pm_ui_status_dot` | Colored circle — recolor with `lv_obj_set_style_bg_color` |
| `pm_ui_list` | Themed scrollable list |
| `pm_ui_meter_bar` | Horizontal meter (RSSI, level) |
| `pm_ui_keypad` | Calc-style numeric pad with row breaks |
| `pm_ui_log_panel` | Append-only scrollback for status/event lines |
| `pm_ui_grid` | Quick equal-cell grid |
| `pm_ui_default_screen` | Placeholder screen with status text — handy while you're sketching |

Plus on-screen keyboard (`pm_ui_keyboard_*`) and virtual gamepad
(`pm_ui_gamepad_*`) for apps that want them.

The **Pisces Moon palette** (matches the firmware exactly):

```
PM_C_BG         #0A1828   PM_C_FG         #E6F0FA
PM_C_BG_2       #122B45   PM_C_FG_DIM     #8FA8C2
PM_C_BG_3       #1A3A5C   PM_C_ACCENT     #4FD1C5  (teal moon)
                          PM_C_ACCENT_2   #B4A0FF  (pisces purple)
PM_C_OK         #4ADE80   PM_C_WARN       #FBBF24
PM_C_ERR        #F87171   PM_C_BORDER     #2A4A6C
```

---

## The Modular Peer System

Pisces Moon P4 is hot-plug aware. The board has two permanent fixtures
(the C6 and a BN-180 GPS); everything else is optional and detected
at boot:

- PN532 NFC reader (on the C6's UART1 connector)
- Wireless module in the slot (SX1262 / nRF24 / H2 / etc.)
- T-Beam Supreme S3 (on the 2x12 header, secondary radios)
- CSI camera (on the CIS-CAM ribbon)
- 8BitDo / other BLE HID device (paired via C6)
- Cardputer ADV module over I2C

Apps don't care what's attached. They ask for capabilities:

```c
pm_peer_t* nfc = pm_peer_find("nfc_read", PM_PEER_ROLE_ANY);
if (!nfc) {
    pm_log_w(TAG, "no NFC available");
    return;
}
pm_peer_call(nfc, "poll", NULL);
// ... read the result
pm_peer_release(nfc);
```

JenCoder's preview registers mock peers for every capability so your
scanner UIs render lifelike previews even without hardware. GPS walks
a slow circle around an LA-area origin, WiFi scans return realistic
SSIDs, NFC tags appear and disappear on an 8-second cycle, the Gemini
peer answers with canned strings.

Capability strings the firmware currently supports include:
`wifi_scan`, `wifi_capture`, `wifi_connect`, `ble_scan`, `ble_gatt`,
`ble_hid_host`, `lora_tx`, `lora_rx`, `lora_mesh`, `nrf24_sniff`,
`nfc_read`, `nfc_write`, `camera_snapshot`, `camera_stream`,
`http_get`, `http_post`, `gps_remote`, `keyboard_hid`.

---

## The Three Workflow Paths

### ⚡ Build &amp; Flash (cloud or local)

You click the button, the source is POSTed to a build server. The
server clones the latest `pisces-moon-os-p4` tree, drops your file
into `main/jencoder_app.c`, edits `main/pm_apps_register.c` and the
appropriate `CMakeLists.txt`, runs `idf.py set-target esp32p4 && idf.py build`,
and returns the compiled `.bin`. The browser then flashes it to your
CrowPanel over Web Serial via `esptool-js`. Total time: ~60-90 seconds
for a cold build, much faster on warm caches.

By default the cloud endpoint is `jencoder-build.fluidfortune.com`.
Check **"Use local backend"** in the build modal to point at your own
`localhost:3000` instead — useful if you've cloned the repo and are
running the bundled Node.js server.

### ⊞ Export

Generates a zip containing `pm_app_<name>.c`, `pm_app_<name>.h`, and
`integration.txt` (exact lines to add to `main/pm_apps_register.c` and
the relevant `components/pm_apps/pm_apps_<cat>/CMakeLists.txt`). Drop
into a local `pisces-moon-os-p4` clone and build via VS Code's
**Espressif IDF** extension.

### 📋 Copy

Source straight to clipboard. Paste anywhere.

---

## Preview Limitations

The preview is an HTML/CSS renderer of the LVGL widget kit. What works:

- All `pm_ui_*` widgets — titlebars, cards, kv-rows, buttons, chips,
  status dots, lists, log panels, meter bars, keypads, grids
- Lifecycle (`init` → `enter` → `tick` → `exit`)
- Touch input (mouse → `pm_input_get_touch`)
- D-pad (arrow keys)
- Virtual gamepad / keyboard events
- Mock peers (WiFi/BLE/NFC/GPS/Gemini/camera)
- Mock VFS (`/sd/...` writes go to in-memory store)

What approximates:

- Heavy custom LVGL outside the `pm_ui` kit may render approximately
  but will still compile fine for hardware.
- `snprintf` is wrapped with a simpler formatter — exotic format
  specifiers may differ from glibc.

What's stubbed:

- Real radios, real GPS, real SD I/O, real audio playback
- The SPI Bus Treaty (P4-narrow: SD vs LoRa) — taken/given are no-ops
- FreeRTOS task creation — single-threaded JS execution

The point is to iterate fast on layout, lifecycle, and logic. Hardware
behavior is exercised by the cloud build path.

---

## Hardware Support

**Reference board:** [ELECROW CrowPanel Advanced 7"](https://www.elecrow.com/)
ESP32-P4 dev board with onboard ESP32-C6, 1024×600 MIPI-DSI capacitive
touchscreen, MicroSD, audio codec, MIPI-CSI camera connector, USB-C.
~$46.

JenCoder targets this board exclusively in v1. Other ESP32-P4 boards
will be supported as Pisces Moon firmware adds BSP coverage — the
backend is already parameterized on board target, the IDE just doesn't
expose the switcher yet.

---

## SPI Bus Treaty — P4-Narrow

On the S3, the treaty covers SD + LoRa + display sharing one bus. On
the P4 the scope narrows considerably: WiFi/BLE live on the C6 (no
shared bus), the display has its own dedicated DSI, and only SD vs
LoRa actually contend. The macros are still there for portability:

```c
PM_SPI_TAKE("wardrive_log") {
    pm_file_t* f = pm_file_open("/sd/log.csv", PM_FILE_APPEND | PM_FILE_CREATE);
    if (f) {
        pm_file_printf(f, "%u,%s,%d\n", t, ssid, rssi);
        pm_file_close(f);
    }
} PM_SPI_GIVE();
```

The `pm_nosql_*` and `pm_sqlite_*` functions handle the treaty
internally — apps using them don't need the macros themselves.

---

## Browser Requirements

For preview only: any modern browser.

For ⚡ Build &amp; Flash: **Chrome, Edge, or Opera on desktop**. Web
Serial isn't supported in Firefox or Safari. Mobile browsers don't
support it either.

---

## Repo Layout

```
index.html, ide.css, ide.js   ← UI shell
jencoder_emulator.js          ← C → JS preview engine (LVGL renderer)
jencoder_hal.js               ← Browser mocks for pm_hal.h
jencoder_peer.js              ← Modular peer registry mocks
jencoder_build.js             ← Cloud compile + Web Serial flash + Export
jencoder_api.js               ← API reference (sidebar data)
jencoder_templates.js         ← 8 starter pm_app_t templates
CNAME                         ← Custom domain
CLA.md, README.md             ← Documentation
backend/                      ← Cloud compile service (separate deploy)
  server.js                   ← Express + idf.py orchestration
  package.json
  Dockerfile                  ← ESP-IDF v5.5.3 + Node 20
  README.md                   ← Deploy & local-run guide
```

Pure static site for the frontend. Deploy on GitHub Pages, Cloudflare
Pages, Netlify, Vercel, S3 — anywhere static.

The cloud compile backend is a separate deployment — see
`backend/README.md`.

---

## Cost

Frontend: free on GitHub Pages.

Backend (only needed for ⚡ Build & Flash): $0-15/month depending on
traffic. P4 builds are slower and heavier than S3 (full LVGL +
ESP-IDF) so the per-build cost is higher than Lety's:

- 50 builds/day: free tier on Fly.io / Railway
- 500 builds/day: ~$8/mo
- 5000 builds/day: ~$25/mo

See `backend/README.md` for full sizing.

---

## Contributing

Pull requests welcome. By submitting one you agree to the CLA in
[`CLA.md`](./CLA.md).

Good areas to contribute:
- New templates demonstrating uncommon `pm_ui` patterns
- Additional peer-capability mocks for richer preview
- Backend improvements (faster cache warming, multi-board targets)
- API reference accuracy as the firmware evolves

---

*JenCoder Web Edition · v1.0 "Origin" · Copyright (C) 2026 Eric Becker / Fluid Fortune · fluidfortune.com*
*AGPL-3.0-or-later*
