// Pisces Moon OS — JenCoder Web Edition
// Copyright (C) 2026 Eric Becker / Fluid Fortune
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// jencoder_templates.js — Starter app templates
//
// Eight canonical P4 patterns covering the seven categories. Each one
// is a complete pm_app_t source file ready to compile via ESP-IDF.
// The emulator parses these the same way it parses any other source.
//
// Pattern conventions for every template:
//   - SPDX header
//   - Tag constant for logging
//   - File-scope statics for LVGL handles and counters
//   - _build_screen() builds the UI using pm_ui_* helpers
//   - _render() updates labels with lv_label_set_text()
//   - _init() / _enter() / _tick() / _exit_() lifecycle
//   - Bottom: const pm_app_t _APP = { ... };
//             const pm_app_t* pm_app_<name>(void) { return &_APP; }

const JENCODER_TEMPLATES = {

  // ─────────────────────────────────────────────────────────────
  basic_app: {
    name: "Basic App",
    desc: "Titlebar + card + kv_rows + tick render. The universal starting point.",
    category: "TOOLS",
    funcName: "myapp",
    code: `// Pisces Moon OS — My App
// Copyright (C) 2026 Your Name
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// The universal P4 app skeleton. Replaces the S3 "Basic App"
// pattern. Demonstrates:
//   - pm_ui_* widget kit composition
//   - pm_app_t lifecycle (init, enter, tick, exit)
//   - lv_label_set_text() for live updates from tick()

#include "pm_app_myapp.h"
#include "pm_app.h"
#include "pm_hal.h"
#include "pm_ui.h"
#include "lvgl.h"
#include <stdio.h>

static const char* TAG = "MYAPP";

// ── LVGL handles ────────────────────────────────────────────
static lv_obj_t* s_screen      = NULL;
static lv_obj_t* s_lbl_uptime  = NULL;
static lv_obj_t* s_lbl_clicks  = NULL;
static lv_obj_t* s_lbl_status  = NULL;

// ── App state ───────────────────────────────────────────────
static int      s_click_count   = 0;
static uint32_t s_last_render_ms = 0;

// ── Callbacks ───────────────────────────────────────────────
static void _on_click(lv_event_t* e) {
    (void)e;
    s_click_count++;
    pm_log_i(TAG, "click %d", s_click_count);
}

static void _build_screen(void) {
    s_screen = pm_ui_screen();
    pm_ui_titlebar(s_screen, "MY APP", NULL, NULL);

    lv_obj_t* card = pm_ui_card(s_screen);
    lv_obj_set_width(card, LV_PCT(100));

    s_lbl_status = lv_label_create(card);
    lv_label_set_text(s_lbl_status, "Hello, Pisces Moon P4.");
    lv_obj_set_style_text_color(s_lbl_status, PM_C_ACCENT, 0);
    lv_obj_set_style_text_font(s_lbl_status, &lv_font_montserrat_28, 0);

    s_lbl_uptime = pm_ui_kv_row(card, "UPTIME", "0 s");
    s_lbl_clicks = pm_ui_kv_row(card, "CLICKS", "0");

    pm_ui_button(s_screen, "TAP ME", _on_click, NULL);
}

static void _render(void) {
    char buf[32];
    snprintf(buf, sizeof(buf), "%u s", (unsigned)pm_uptime_seconds());
    if (s_lbl_uptime) lv_label_set_text(s_lbl_uptime, buf);

    snprintf(buf, sizeof(buf), "%d", s_click_count);
    if (s_lbl_clicks) lv_label_set_text(s_lbl_clicks, buf);
}

// ── Lifecycle ───────────────────────────────────────────────
static void _init(void)  { _build_screen(); }
static void _enter(void) {
    if (s_screen) lv_screen_load(s_screen);
    pm_log_i(TAG, "enter");
    _render();
}
static void _tick(uint32_t elapsed_ms) {
    (void)elapsed_ms;
    uint32_t now = pm_millis();
    if (now - s_last_render_ms < 500) return;
    s_last_render_ms = now;
    _render();
}
static void _exit_(void) { pm_log_i(TAG, "exit"); }

static const pm_app_t _APP = {
    .id           = "myapp",
    .display_name = "MY APP",
    .category     = PM_CAT_TOOLS,
    .icon_id      = 0,
    .init         = _init,
    .enter        = _enter,
    .tick         = _tick,
    .exit         = _exit_,
    .deinit       = NULL,
};

const pm_app_t* pm_app_myapp(void) { return &_APP; }
`,
  },

  // ─────────────────────────────────────────────────────────────
  list_app: {
    name: "List App",
    desc: "Scrollable list with selection — the foundation of every browser-style app.",
    category: "TOOLS",
    funcName: "mylist",
    code: `// Pisces Moon OS — List App
// Copyright (C) 2026 Your Name
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// Renders a vertical list inside pm_ui_list(). Each row is a
// lv_button containing a label. Selection state is tracked in
// s_cursor; the visual selection updates via background recolor.

#include "pm_app_mylist.h"
#include "pm_app.h"
#include "pm_hal.h"
#include "pm_ui.h"
#include "lvgl.h"
#include <stdio.h>
#include <string.h>

static const char* TAG = "MYLIST";

static const char* ITEMS[] = {
    "Power management",
    "Network capture",
    "GPS log",
    "Audio recordings",
    "Notes",
    "Calendar",
    "About",
};
static const int ITEM_COUNT = (int)(sizeof(ITEMS) / sizeof(ITEMS[0]));

static lv_obj_t* s_screen    = NULL;
static lv_obj_t* s_list      = NULL;
static lv_obj_t* s_rows[8]   = {0};
static lv_obj_t* s_lbl_pick  = NULL;
static int       s_cursor    = 0;

static void _refresh_selection(void) {
    for (int i = 0; i < ITEM_COUNT; i++) {
        if (!s_rows[i]) continue;
        lv_obj_set_style_bg_color(s_rows[i],
            i == s_cursor ? PM_C_BG_3 : PM_C_BG_2, 0);
    }
    if (s_lbl_pick) {
        char buf[64];
        snprintf(buf, sizeof(buf), "Selected: %s", ITEMS[s_cursor]);
        lv_label_set_text(s_lbl_pick, buf);
    }
}

static void _on_row(lv_event_t* e) {
    int idx = (int)(intptr_t)lv_event_get_user_data(e);
    s_cursor = idx;
    pm_log_i(TAG, "row %d (%s)", idx, ITEMS[idx]);
    _refresh_selection();
}

static void _build_screen(void) {
    s_screen = pm_ui_screen();
    pm_ui_titlebar(s_screen, "LIST", NULL, NULL);

    lv_obj_t* card = pm_ui_card(s_screen);
    lv_obj_set_width(card, LV_PCT(100));

    s_list = pm_ui_list(card);
    lv_obj_set_width(s_list, LV_PCT(100));
    lv_obj_set_height(s_list, 380);

    for (int i = 0; i < ITEM_COUNT && i < 8; i++) {
        lv_obj_t* row = lv_btn_create(s_list);
        lv_obj_remove_style_all(row);
        lv_obj_set_width(row, LV_PCT(100));
        lv_obj_set_height(row, 48);
        lv_obj_set_style_bg_color(row, PM_C_BG_2, 0);
        lv_obj_set_style_bg_opa(row, LV_OPA_COVER, 0);
        lv_obj_set_style_border_color(row, PM_C_BORDER, 0);
        lv_obj_set_style_border_width(row, 1, 0);
        lv_obj_set_style_border_side(row, LV_BORDER_SIDE_BOTTOM, 0);
        lv_obj_set_style_pad_left(row, 16, 0);
        lv_obj_add_event_cb(row, _on_row, LV_EVENT_CLICKED,
                            (void*)(intptr_t)i);

        lv_obj_t* lbl = lv_label_create(row);
        lv_label_set_text(lbl, ITEMS[i]);
        lv_obj_set_style_text_color(lbl, PM_C_FG, 0);
        lv_obj_set_style_text_font(lbl, &lv_font_montserrat_16, 0);
        lv_obj_align(lbl, LV_ALIGN_LEFT_MID, 0, 0);

        s_rows[i] = row;
    }

    s_lbl_pick = lv_label_create(card);
    lv_label_set_text(s_lbl_pick, "Selected: (none)");
    lv_obj_set_style_text_color(s_lbl_pick, PM_C_ACCENT, 0);
}

static void _init(void)  { _build_screen(); _refresh_selection(); }
static void _enter(void) {
    if (s_screen) lv_screen_load(s_screen);
    pm_log_i(TAG, "enter");
}
static void _exit_(void) { pm_log_i(TAG, "exit"); }

static const pm_app_t _APP = {
    .id           = "mylist",
    .display_name = "LIST",
    .category     = PM_CAT_TOOLS,
    .icon_id      = 0,
    .init         = _init,
    .enter        = _enter,
    .tick         = NULL,
    .exit         = _exit_,
    .deinit       = NULL,
};

const pm_app_t* pm_app_mylist(void) { return &_APP; }
`,
  },

  // ─────────────────────────────────────────────────────────────
  gps_viewer: {
    name: "GPS Viewer",
    desc: "Live latitude/longitude/altitude/satellites display. Mirrors pm_app_gps.c.",
    category: "COMMS",
    funcName: "mygps",
    code: `// Pisces Moon OS — GPS Viewer
// Copyright (C) 2026 Your Name
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// Reads pm_gps_state directly — on real hardware the BN-180 feeds
// it via UART4. Updates every 250 ms in tick() so the readout looks
// alive even with slow GPS updates.

#include "pm_app_mygps.h"
#include "pm_app.h"
#include "pm_hal.h"
#include "pm_ui.h"
#include "pm_gps_state.h"
#include "lvgl.h"
#include <stdio.h>

static const char* TAG = "MYGPS";

static lv_obj_t* s_screen     = NULL;
static lv_obj_t* s_lbl_status = NULL;
static lv_obj_t* s_lbl_lat    = NULL;
static lv_obj_t* s_lbl_lng    = NULL;
static lv_obj_t* s_lbl_alt    = NULL;
static lv_obj_t* s_lbl_speed  = NULL;
static lv_obj_t* s_lbl_sats   = NULL;
static lv_obj_t* s_lbl_age    = NULL;

static uint32_t s_last_render_ms = 0;

static void _render(void) {
    pm_gps_t g;
    pm_gps_state_get(&g);

    char buf[64];

    if (g.valid) {
        snprintf(buf, sizeof(buf), "STATUS: FIX  |  %d satellites", g.sats);
        lv_obj_set_style_text_color(s_lbl_status, PM_C_OK, 0);
    } else if (g.sats > 0) {
        snprintf(buf, sizeof(buf), "STATUS: SEARCHING  |  %d sats", g.sats);
        lv_obj_set_style_text_color(s_lbl_status, PM_C_WARN, 0);
    } else {
        snprintf(buf, sizeof(buf), "STATUS: NO SIGNAL");
        lv_obj_set_style_text_color(s_lbl_status, PM_C_ERR, 0);
    }
    if (s_lbl_status) lv_label_set_text(s_lbl_status, buf);

    if (g.valid) {
        snprintf(buf, sizeof(buf), "%+.6f", g.lat);
        if (s_lbl_lat) lv_label_set_text(s_lbl_lat, buf);
        snprintf(buf, sizeof(buf), "%+.6f", g.lng);
        if (s_lbl_lng) lv_label_set_text(s_lbl_lng, buf);
    } else {
        if (s_lbl_lat) lv_label_set_text(s_lbl_lat, "--");
        if (s_lbl_lng) lv_label_set_text(s_lbl_lng, "--");
    }

    snprintf(buf, sizeof(buf), "%.1f m", g.alt_m);
    if (s_lbl_alt) lv_label_set_text(s_lbl_alt, buf);

    snprintf(buf, sizeof(buf), "%.1f m/s", g.speed_mps);
    if (s_lbl_speed) lv_label_set_text(s_lbl_speed, buf);

    snprintf(buf, sizeof(buf), "%d", g.sats);
    if (s_lbl_sats) lv_label_set_text(s_lbl_sats, buf);

    if (g.last_update_ms == 0) {
        if (s_lbl_age) lv_label_set_text(s_lbl_age, "no updates yet");
    } else {
        uint32_t age = pm_millis() - g.last_update_ms;
        snprintf(buf, sizeof(buf), "%u ms ago", (unsigned)age);
        if (s_lbl_age) lv_label_set_text(s_lbl_age, buf);
    }
}

static void _build_screen(void) {
    s_screen = pm_ui_screen();
    pm_ui_titlebar(s_screen, "GPS", NULL, NULL);

    lv_obj_t* status_card = pm_ui_card(s_screen);
    lv_obj_set_width(status_card, LV_PCT(100));
    s_lbl_status = lv_label_create(status_card);
    lv_label_set_text(s_lbl_status, "STATUS: starting");
    lv_obj_set_style_text_font(s_lbl_status, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(s_lbl_status, PM_C_FG_DIM, 0);

    lv_obj_t* card = pm_ui_card(s_screen);
    lv_obj_set_width(card, LV_PCT(100));

    s_lbl_lat   = pm_ui_kv_row(card, "LAT",   "--");
    s_lbl_lng   = pm_ui_kv_row(card, "LNG",   "--");
    s_lbl_sats  = pm_ui_kv_row(card, "SATS",  "0");
    s_lbl_alt   = pm_ui_kv_row(card, "ALT",   "0.0 m");
    s_lbl_speed = pm_ui_kv_row(card, "SPEED", "0.0 m/s");
    s_lbl_age   = pm_ui_kv_row(card, "AGE",   "no updates yet");
}

static void _init(void)  { _build_screen(); }
static void _enter(void) {
    if (s_screen) lv_screen_load(s_screen);
    pm_log_i(TAG, "enter");
    s_last_render_ms = 0;
    _render();
}
static void _tick(uint32_t elapsed_ms) {
    (void)elapsed_ms;
    uint32_t now = pm_millis();
    if (now - s_last_render_ms < 250) return;
    s_last_render_ms = now;
    _render();
}
static void _exit_(void) { pm_log_i(TAG, "exit"); }

static const pm_app_t _APP = {
    .id           = "mygps",
    .display_name = "GPS",
    .category     = PM_CAT_COMMS,
    .icon_id      = 0,
    .init         = _init,
    .enter        = _enter,
    .tick         = _tick,
    .exit         = _exit_,
    .deinit       = NULL,
};

const pm_app_t* pm_app_mygps(void) { return &_APP; }
`,
  },

  // ─────────────────────────────────────────────────────────────
  nfc_reader: {
    name: "NFC Reader",
    desc: "Polls the PN532 via the peer registry; shows UID + NDEF text.",
    category: "CYBER",
    funcName: "mynfc",
    code: `// Pisces Moon OS — NFC Reader
// Copyright (C) 2026 Your Name
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// Uses the modular peer registry. If a PN532 is plugged into the
// C6's UART1 connector, pm_peer_find("nfc_read") returns a handle.
// If not, we draw "NFC unavailable" and exit gracefully — that is
// the modular-OS philosophy.
//
// In JenCoder preview, jencoder_peer.js simulates a tag cycling
// every ~8 seconds so the UI is exercised even without hardware.

#include "pm_app_mynfc.h"
#include "pm_app.h"
#include "pm_hal.h"
#include "pm_ui.h"
#include "pm_peer.h"
#include "lvgl.h"
#include <stdio.h>
#include <string.h>

static const char* TAG = "MYNFC";

static lv_obj_t* s_screen    = NULL;
static lv_obj_t* s_lbl_state = NULL;
static lv_obj_t* s_lbl_uid   = NULL;
static lv_obj_t* s_lbl_ndef  = NULL;
static lv_obj_t* s_lbl_count = NULL;
static lv_obj_t* s_status_dot= NULL;

static pm_peer_t* s_nfc      = NULL;
static int        s_read_count = 0;
static uint32_t   s_last_poll_ms = 0;

// Simple tag struct populated by the peer call.
typedef struct {
    bool   valid;
    uint8_t uid[16];
    int     uid_len;
    char    ndef_text[80];
} nfc_tag_t;
static nfc_tag_t s_tag;

static void _hexify(const uint8_t* buf, int n, char* out, size_t cap) {
    if (cap < 1) return;
    out[0] = 0;
    for (int i = 0; i < n && (i * 3 + 3) < (int)cap; i++) {
        char tmp[4];
        snprintf(tmp, sizeof(tmp), "%02X ", buf[i]);
        strncat(out, tmp, cap - strlen(out) - 1);
    }
}

static void _render(void) {
    if (!s_nfc) {
        if (s_lbl_state) lv_label_set_text(s_lbl_state, "NFC PEER UNAVAILABLE");
        if (s_status_dot) lv_obj_set_style_bg_color(s_status_dot, PM_C_ERR, 0);
        return;
    }

    if (s_tag.valid) {
        if (s_lbl_state) lv_label_set_text(s_lbl_state, "TAG DETECTED");
        if (s_status_dot) lv_obj_set_style_bg_color(s_status_dot, PM_C_OK, 0);
        char uid_str[64];
        _hexify(s_tag.uid, s_tag.uid_len, uid_str, sizeof(uid_str));
        if (s_lbl_uid) lv_label_set_text(s_lbl_uid, uid_str);
        if (s_lbl_ndef) lv_label_set_text(s_lbl_ndef,
            s_tag.ndef_text[0] ? s_tag.ndef_text : "(no NDEF text)");
    } else {
        if (s_lbl_state) lv_label_set_text(s_lbl_state, "PLACE TAG");
        if (s_status_dot) lv_obj_set_style_bg_color(s_status_dot, PM_C_WARN, 0);
        if (s_lbl_uid) lv_label_set_text(s_lbl_uid, "--");
        if (s_lbl_ndef) lv_label_set_text(s_lbl_ndef, "--");
    }

    char buf[24];
    snprintf(buf, sizeof(buf), "%d", s_read_count);
    if (s_lbl_count) lv_label_set_text(s_lbl_count, buf);
}

static void _build_screen(void) {
    s_screen = pm_ui_screen();
    pm_ui_titlebar(s_screen, "NFC", NULL, NULL);

    lv_obj_t* status_card = pm_ui_card(s_screen);
    lv_obj_set_width(status_card, LV_PCT(100));
    lv_obj_set_layout(status_card, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(status_card, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(status_card,
        LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(status_card, 16, 0);

    s_status_dot = pm_ui_status_dot(status_card, PM_C_WARN);
    s_lbl_state = lv_label_create(status_card);
    lv_label_set_text(s_lbl_state, "INITIALIZING");
    lv_obj_set_style_text_font(s_lbl_state, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(s_lbl_state, PM_C_FG, 0);

    lv_obj_t* card = pm_ui_card(s_screen);
    lv_obj_set_width(card, LV_PCT(100));
    s_lbl_uid   = pm_ui_kv_row(card, "UID",  "--");
    s_lbl_ndef  = pm_ui_kv_row(card, "NDEF", "--");
    s_lbl_count = pm_ui_kv_row(card, "READS", "0");
}

static void _init(void)  { _build_screen(); }

static void _enter(void) {
    if (s_screen) lv_screen_load(s_screen);
    pm_log_i(TAG, "enter");
    s_nfc = pm_peer_find("nfc_read", PM_PEER_ROLE_ANY);
    if (s_nfc) {
        pm_log_i(TAG, "using peer: %s", pm_peer_name(s_nfc));
    } else {
        pm_log_w(TAG, "no NFC peer available");
    }
    s_read_count = 0;
    s_tag.valid = false;
    _render();
}

static void _tick(uint32_t elapsed_ms) {
    (void)elapsed_ms;
    if (!s_nfc) return;
    uint32_t now = pm_millis();
    if (now - s_last_poll_ms < 200) return;
    s_last_poll_ms = now;

    // Ask the peer for a poll. The mock returns valid=true for part
    // of an 8s cycle and valid=false otherwise.
    int rc = pm_peer_call(s_nfc, "poll", NULL);
    if (rc == 0) {
        // In a real implementation the peer would fill s_tag via a
        // shared buffer. For the preview we read directly from the
        // mock. JenCoder injects this via the runtime context.
        extern void __jc_mock_nfc_fill(nfc_tag_t* out);
        __jc_mock_nfc_fill(&s_tag);
        if (s_tag.valid) s_read_count++;
    }
    _render();
}

static void _exit_(void) {
    pm_log_i(TAG, "exit");
    if (s_nfc) pm_peer_release(s_nfc);
    s_nfc = NULL;
}

static const pm_app_t _APP = {
    .id           = "mynfc",
    .display_name = "NFC",
    .category     = PM_CAT_CYBER,
    .icon_id      = 0,
    .init         = _init,
    .enter        = _enter,
    .tick         = _tick,
    .exit         = _exit_,
    .deinit       = NULL,
};

const pm_app_t* pm_app_mynfc(void) { return &_APP; }
`,
  },

  // ─────────────────────────────────────────────────────────────
  wardrive_lite: {
    name: "Wardrive Lite",
    desc: "WiFi+BLE peer query, live log panel, start/stop. Foundation pattern.",
    category: "CYBER",
    funcName: "mywardrive",
    code: `// Pisces Moon OS — Wardrive Lite
// Copyright (C) 2026 Your Name
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// Stripped-down version of the production Wardrive app. Same shape:
//   - Ask the C6 Ghost Engine for a WiFi scan (modular peer)
//   - Log each AP into a scrollable log panel
//   - Update the WIFI / BLE / PROBE counters on each event
//   - Toggle scanning with START / STOP buttons
//
// The full app adds SQLite session logging, GPS-tagged CSV export,
// promiscuous mode, and BLE source fallback. Add those layer by
// layer when you're ready.

#include "pm_app_mywardrive.h"
#include "pm_app.h"
#include "pm_hal.h"
#include "pm_ui.h"
#include "pm_peer.h"
#include "lvgl.h"
#include <stdio.h>
#include <string.h>

static const char* TAG = "MYWARDRIVE";

static lv_obj_t* s_screen   = NULL;
static lv_obj_t* s_btn_start= NULL;
static lv_obj_t* s_btn_stop = NULL;
static lv_obj_t* s_lbl_wifi = NULL;
static lv_obj_t* s_lbl_ble  = NULL;
static lv_obj_t* s_lbl_state= NULL;
static lv_obj_t* s_status_dot = NULL;
static pm_ui_log_t* s_log   = NULL;

static pm_peer_t* s_wifi_peer = NULL;
static pm_peer_t* s_ble_peer  = NULL;
static bool       s_running   = false;
static int        s_wifi_total = 0;
static int        s_ble_total  = 0;
static uint32_t   s_last_scan_ms = 0;

static void _set_running_ui(bool on) {
    if (s_lbl_state) lv_label_set_text(s_lbl_state, on ? "SCANNING" : "IDLE");
    if (s_status_dot) lv_obj_set_style_bg_color(s_status_dot,
                                                 on ? PM_C_OK : PM_C_FG_DIM, 0);
    if (s_btn_start) lv_obj_set_style_bg_opa(s_btn_start, on ? 25 : 80, 0);
    if (s_btn_stop)  lv_obj_set_style_bg_opa(s_btn_stop,  on ? 80 : 25, 0);
}

static void _on_start(lv_event_t* e) {
    (void)e;
    if (s_running) return;
    s_running = true;
    pm_log_i(TAG, "scan start");
    if (s_log) pm_ui_log_append(s_log, "[START] WiFi + BLE scan");
    _set_running_ui(true);
}

static void _on_stop(lv_event_t* e) {
    (void)e;
    if (!s_running) return;
    s_running = false;
    pm_log_i(TAG, "scan stop");
    if (s_log) pm_ui_log_append(s_log, "[STOP] scan halted");
    _set_running_ui(false);
}

static void _on_clear(lv_event_t* e) {
    (void)e;
    if (s_log) pm_ui_log_clear(s_log);
    s_wifi_total = 0;
    s_ble_total = 0;
    if (s_lbl_wifi) lv_label_set_text(s_lbl_wifi, "0");
    if (s_lbl_ble)  lv_label_set_text(s_lbl_ble, "0");
}

static void _build_screen(void) {
    s_screen = pm_ui_screen();
    pm_ui_titlebar(s_screen, "WARDRIVE", NULL, NULL);

    // Status row
    lv_obj_t* status = pm_ui_card(s_screen);
    lv_obj_set_width(status, LV_PCT(100));
    lv_obj_set_layout(status, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(status, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(status,
        LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(status, 14, 0);

    s_status_dot = pm_ui_status_dot(status, PM_C_FG_DIM);
    s_lbl_state = lv_label_create(status);
    lv_label_set_text(s_lbl_state, "IDLE");
    lv_obj_set_style_text_font(s_lbl_state, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(s_lbl_state, PM_C_FG, 0);

    // Counters
    lv_obj_t* card = pm_ui_card(s_screen);
    lv_obj_set_width(card, LV_PCT(100));
    s_lbl_wifi = pm_ui_kv_row(card, "WIFI", "0");
    s_lbl_ble  = pm_ui_kv_row(card, "BLE",  "0");

    // Log
    s_log = pm_ui_log_create(s_screen);
    if (s_log) {
        lv_obj_set_width(pm_ui_log_obj(s_log), LV_PCT(100));
        lv_obj_set_height(pm_ui_log_obj(s_log), 220);
    }

    // Buttons row
    lv_obj_t* btn_row = lv_obj_create(s_screen);
    lv_obj_remove_style_all(btn_row);
    lv_obj_set_width(btn_row, LV_PCT(100));
    lv_obj_set_height(btn_row, 56);
    lv_obj_set_layout(btn_row, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(btn_row, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(btn_row,
        LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(btn_row, 12, 0);

    s_btn_start = pm_ui_button(btn_row, LV_SYMBOL_PLAY " START", _on_start, NULL);
    s_btn_stop  = pm_ui_button(btn_row, LV_SYMBOL_STOP " STOP",  _on_stop,  NULL);
    pm_ui_button(btn_row, "CLEAR", _on_clear, NULL);
}

static void _do_scan(void) {
    char line[80];
    char buf[16];

    // WiFi — JenCoder's mock returns a JS array of APs directly via
    // the convenience global __jc_mock_wifi_list().
    if (s_wifi_peer && pm_peer_call(s_wifi_peer, "scan_start", NULL) == 0) {
        extern void* __jc_mock_wifi_list(void);
        extern int   __jc_mock_wifi_list_len(void);
        extern const char* __jc_mock_wifi_ssid(int idx);
        extern const char* __jc_mock_wifi_bssid(int idx);
        extern int         __jc_mock_wifi_rssi(int idx);
        extern int         __jc_mock_wifi_ch(int idx);

        int n = __jc_mock_wifi_list_len();
        for (int i = 0; i < n && i < 8; i++) {
            const char* ssid  = __jc_mock_wifi_ssid(i);
            const char* bssid = __jc_mock_wifi_bssid(i);
            int rssi = __jc_mock_wifi_rssi(i);
            int ch   = __jc_mock_wifi_ch(i);
            snprintf(line, sizeof(line), "[WIFI] %-18s %s ch%d %ddBm",
                     ssid && ssid[0] ? ssid : "(hidden)",
                     bssid ? bssid : "??:??:??:??:??:??",
                     ch, rssi);
            if (s_log) pm_ui_log_append(s_log, line);
            s_wifi_total++;
        }
        snprintf(buf, sizeof(buf), "%d", s_wifi_total);
        if (s_lbl_wifi) lv_label_set_text(s_lbl_wifi, buf);
    }

    // BLE
    if (s_ble_peer && pm_peer_call(s_ble_peer, "scan_start", NULL) == 0) {
        extern int         __jc_mock_ble_list_len(void);
        extern const char* __jc_mock_ble_name(int idx);
        extern const char* __jc_mock_ble_mac(int idx);
        extern int         __jc_mock_ble_rssi(int idx);

        int n = __jc_mock_ble_list_len();
        for (int i = 0; i < n && i < 6; i++) {
            const char* name = __jc_mock_ble_name(i);
            const char* mac  = __jc_mock_ble_mac(i);
            int rssi = __jc_mock_ble_rssi(i);
            snprintf(line, sizeof(line), "[BLE]  %-14s %s %ddBm",
                     name && name[0] ? name : "(unnamed)",
                     mac ? mac : "??:??:??:??:??:??",
                     rssi);
            if (s_log) pm_ui_log_append(s_log, line);
            s_ble_total++;
        }
        snprintf(buf, sizeof(buf), "%d", s_ble_total);
        if (s_lbl_ble) lv_label_set_text(s_lbl_ble, buf);
    }
}

static void _init(void)  { _build_screen(); _set_running_ui(false); }

static void _enter(void) {
    if (s_screen) lv_screen_load(s_screen);
    pm_log_i(TAG, "enter");
    s_wifi_peer = pm_peer_find("wifi_scan", PM_PEER_ROLE_PRIMARY);
    s_ble_peer  = pm_peer_find("ble_scan",  PM_PEER_ROLE_ANY);
    if (!s_wifi_peer) pm_log_w(TAG, "no wifi_scan peer");
    if (!s_ble_peer)  pm_log_w(TAG, "no ble_scan peer");
}

static void _tick(uint32_t elapsed_ms) {
    (void)elapsed_ms;
    if (!s_running) return;
    uint32_t now = pm_millis();
    if (now - s_last_scan_ms < 2500) return;
    s_last_scan_ms = now;
    _do_scan();
}

static void _exit_(void) {
    pm_log_i(TAG, "exit");
    if (s_wifi_peer) pm_peer_release(s_wifi_peer);
    if (s_ble_peer)  pm_peer_release(s_ble_peer);
    s_wifi_peer = NULL;
    s_ble_peer  = NULL;
    s_running = false;
}

static const pm_app_t _APP = {
    .id           = "mywardrive",
    .display_name = "WARDRIVE",
    .category     = PM_CAT_CYBER,
    .icon_id      = 0,
    .init         = _init,
    .enter        = _enter,
    .tick         = _tick,
    .exit         = _exit_,
    .deinit       = NULL,
};

const pm_app_t* pm_app_mywardrive(void) { return &_APP; }
`,
  },

  // ─────────────────────────────────────────────────────────────
  gemini_log: {
    name: "Gemini Log",
    desc: "Prompt → Gemini → log panel. The classic AI-assistant pattern.",
    category: "INTEL",
    funcName: "mygemini",
    code: `// Pisces Moon OS — Gemini Log
// Copyright (C) 2026 Your Name
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// On real hardware the C6 Ghost Engine proxies HTTP to Google
// Gemini using the API key in include/secrets.h. In JenCoder the
// peer mock returns canned demo responses so the UI can be
// previewed without a key.

#include "pm_app_mygemini.h"
#include "pm_app.h"
#include "pm_hal.h"
#include "pm_ui.h"
#include "pm_peer.h"
#include "lvgl.h"
#include <stdio.h>
#include <string.h>

static const char* TAG = "MYGEMINI";

static lv_obj_t*    s_screen     = NULL;
static lv_obj_t*    s_text_area  = NULL;
static lv_obj_t*    s_lbl_state  = NULL;
static pm_ui_log_t* s_log        = NULL;
static pm_peer_t*   s_http       = NULL;

static int          s_msg_count  = 0;

static void _append_prompt_and_reply(const char* prompt) {
    char line[160];

    snprintf(line, sizeof(line), "> %s", prompt);
    if (s_log) pm_ui_log_append(s_log, line);

    // Ask the peer for a reply. The mock answers in three rotating
    // canned strings so the screen shows distinct entries.
    extern const char* __jc_mock_gemini_reply(const char* prompt);
    const char* reply = s_http ? __jc_mock_gemini_reply(prompt)
                                : "Gemini peer unavailable";

    snprintf(line, sizeof(line), "  %s", reply);
    if (s_log) pm_ui_log_append(s_log, line);

    s_msg_count++;
}

static void _on_send(lv_event_t* e) {
    (void)e;
    if (!s_text_area) return;
    const char* text = lv_textarea_get_text(s_text_area);
    if (!text || !text[0]) return;

    char prompt[160];
    strncpy(prompt, text, sizeof(prompt) - 1);
    prompt[sizeof(prompt) - 1] = 0;

    lv_textarea_set_text(s_text_area, "");
    if (s_lbl_state) lv_label_set_text(s_lbl_state, "ASKING...");
    _append_prompt_and_reply(prompt);
    if (s_lbl_state) lv_label_set_text(s_lbl_state, "READY");
}

static void _on_clear(lv_event_t* e) {
    (void)e;
    if (s_log) pm_ui_log_clear(s_log);
    s_msg_count = 0;
}

static void _build_screen(void) {
    s_screen = pm_ui_screen();
    pm_ui_titlebar(s_screen, "GEMINI LOG", NULL, NULL);

    // Status card
    lv_obj_t* status = pm_ui_card(s_screen);
    lv_obj_set_width(status, LV_PCT(100));
    s_lbl_state = lv_label_create(status);
    lv_label_set_text(s_lbl_state, "READY");
    lv_obj_set_style_text_color(s_lbl_state, PM_C_ACCENT, 0);
    lv_obj_set_style_text_font(s_lbl_state, &lv_font_montserrat_20, 0);

    // Log
    s_log = pm_ui_log_create(s_screen);
    if (s_log) {
        lv_obj_set_width(pm_ui_log_obj(s_log), LV_PCT(100));
        lv_obj_set_height(pm_ui_log_obj(s_log), 320);
    }

    // Input row
    lv_obj_t* in_row = lv_obj_create(s_screen);
    lv_obj_remove_style_all(in_row);
    lv_obj_set_width(in_row, LV_PCT(100));
    lv_obj_set_height(in_row, 60);
    lv_obj_set_layout(in_row, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(in_row, LV_FLEX_FLOW_ROW);
    lv_obj_set_style_pad_column(in_row, 10, 0);
    lv_obj_set_flex_align(in_row,
        LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

    s_text_area = lv_textarea_create(in_row);
    lv_textarea_set_one_line(s_text_area, true);
    lv_textarea_set_placeholder_text(s_text_area, "Ask something...");
    lv_obj_set_flex_grow(s_text_area, 1);
    lv_obj_set_height(s_text_area, 48);

    pm_ui_button(in_row, "SEND",  _on_send,  NULL);
    pm_ui_button(in_row, "CLEAR", _on_clear, NULL);
}

static void _init(void)  { _build_screen(); }

static void _enter(void) {
    if (s_screen) lv_screen_load(s_screen);
    pm_log_i(TAG, "enter");
    s_http = pm_peer_find("http_post", PM_PEER_ROLE_PRIMARY);
    if (!s_http) pm_log_w(TAG, "no http_post peer");
    if (s_log) {
        pm_ui_log_clear(s_log);
        pm_ui_log_append(s_log, "Connected to Gemini. Ask anything.");
    }
}

static void _exit_(void) {
    pm_log_i(TAG, "exit");
    if (s_http) pm_peer_release(s_http);
    s_http = NULL;
}

static const pm_app_t _APP = {
    .id           = "mygemini",
    .display_name = "GEMINI LOG",
    .category     = PM_CAT_INTEL,
    .icon_id      = 0,
    .init         = _init,
    .enter        = _enter,
    .tick         = NULL,
    .exit         = _exit_,
    .deinit       = NULL,
};

const pm_app_t* pm_app_mygemini(void) { return &_APP; }
`,
  },

  // ─────────────────────────────────────────────────────────────
  audio_player: {
    name: "Audio Player",
    desc: "Peer query + file list + play/stop. Hardware audio is stubbed in preview.",
    category: "MEDIA",
    funcName: "myaudio",
    code: `// Pisces Moon OS — Audio Player
// Copyright (C) 2026 Your Name
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// Lists audio files in /sd/audio/ (or wherever they live in
// pm_file_t convention) and plays the selected one via the
// NS4168 codec — wrapped behind a "audio_play" peer call.
// The codec is a permanent fixture so the peer is always there.

#include "pm_app_myaudio.h"
#include "pm_app.h"
#include "pm_hal.h"
#include "pm_ui.h"
#include "pm_peer.h"
#include "lvgl.h"
#include <stdio.h>
#include <string.h>

static const char* TAG = "MYAUDIO";

#define MAX_FILES 12

typedef struct {
    char name[40];
    char path[64];
} audio_file_t;

static audio_file_t s_files[MAX_FILES];
static int          s_file_count = 0;
static int          s_cursor     = 0;
static bool         s_playing    = false;

static lv_obj_t*  s_screen    = NULL;
static lv_obj_t*  s_list      = NULL;
static lv_obj_t*  s_rows[MAX_FILES] = {0};
static lv_obj_t*  s_lbl_now   = NULL;
static lv_obj_t*  s_btn_play  = NULL;
static lv_obj_t*  s_btn_stop  = NULL;
static pm_peer_t* s_audio     = NULL;

static void _scan_directory(void) {
    // Demo entries — on hardware this would iterate pm_dir_open("/sd/audio").
    static const char* DEMO[] = {
        "intro.mp3", "field_log_01.wav", "rainforest.mp3",
        "drone.wav", "noise_test.mp3", "voice_memo_3.wav",
    };
    s_file_count = (int)(sizeof(DEMO) / sizeof(DEMO[0]));
    if (s_file_count > MAX_FILES) s_file_count = MAX_FILES;
    for (int i = 0; i < s_file_count; i++) {
        strncpy(s_files[i].name, DEMO[i], sizeof(s_files[i].name) - 1);
        snprintf(s_files[i].path, sizeof(s_files[i].path),
                 "/sd/audio/%s", DEMO[i]);
    }
}

static void _refresh_now(void) {
    if (!s_lbl_now) return;
    if (s_playing && s_cursor < s_file_count) {
        char buf[80];
        snprintf(buf, sizeof(buf), LV_SYMBOL_PLAY "  %s",
                 s_files[s_cursor].name);
        lv_label_set_text(s_lbl_now, buf);
        lv_obj_set_style_text_color(s_lbl_now, PM_C_OK, 0);
    } else if (s_cursor < s_file_count) {
        char buf[80];
        snprintf(buf, sizeof(buf), "Selected: %s", s_files[s_cursor].name);
        lv_label_set_text(s_lbl_now, buf);
        lv_obj_set_style_text_color(s_lbl_now, PM_C_FG, 0);
    } else {
        lv_label_set_text(s_lbl_now, "(no file selected)");
        lv_obj_set_style_text_color(s_lbl_now, PM_C_FG_DIM, 0);
    }
}

static void _refresh_rows(void) {
    for (int i = 0; i < s_file_count; i++) {
        if (!s_rows[i]) continue;
        lv_obj_set_style_bg_color(s_rows[i],
            i == s_cursor ? PM_C_BG_3 : PM_C_BG_2, 0);
    }
}

static void _on_row(lv_event_t* e) {
    int idx = (int)(intptr_t)lv_event_get_user_data(e);
    s_cursor = idx;
    _refresh_rows();
    _refresh_now();
}

static void _on_play(lv_event_t* e) {
    (void)e;
    if (s_cursor >= s_file_count) return;
    if (!s_audio) {
        pm_log_w(TAG, "no audio peer");
        return;
    }
    pm_peer_call(s_audio, "play", s_files[s_cursor].path);
    s_playing = true;
    pm_log_i(TAG, "play: %s", s_files[s_cursor].path);
    _refresh_now();
}

static void _on_stop(lv_event_t* e) {
    (void)e;
    if (!s_audio) return;
    pm_peer_call(s_audio, "stop", NULL);
    s_playing = false;
    pm_log_i(TAG, "stop");
    _refresh_now();
}

static void _build_screen(void) {
    s_screen = pm_ui_screen();
    pm_ui_titlebar(s_screen, "AUDIO", NULL, NULL);

    lv_obj_t* card = pm_ui_card(s_screen);
    lv_obj_set_width(card, LV_PCT(100));
    s_lbl_now = lv_label_create(card);
    lv_label_set_text(s_lbl_now, "(no file selected)");
    lv_obj_set_style_text_font(s_lbl_now, &lv_font_montserrat_24, 0);
    lv_obj_set_style_text_color(s_lbl_now, PM_C_FG_DIM, 0);

    s_list = pm_ui_list(s_screen);
    lv_obj_set_width(s_list, LV_PCT(100));
    lv_obj_set_height(s_list, 320);

    for (int i = 0; i < s_file_count; i++) {
        lv_obj_t* row = lv_btn_create(s_list);
        lv_obj_remove_style_all(row);
        lv_obj_set_width(row, LV_PCT(100));
        lv_obj_set_height(row, 44);
        lv_obj_set_style_bg_color(row, PM_C_BG_2, 0);
        lv_obj_set_style_bg_opa(row, LV_OPA_COVER, 0);
        lv_obj_set_style_border_color(row, PM_C_BORDER, 0);
        lv_obj_set_style_border_width(row, 1, 0);
        lv_obj_set_style_border_side(row, LV_BORDER_SIDE_BOTTOM, 0);
        lv_obj_set_style_pad_left(row, 16, 0);
        lv_obj_add_event_cb(row, _on_row, LV_EVENT_CLICKED,
                            (void*)(intptr_t)i);

        lv_obj_t* lbl = lv_label_create(row);
        lv_label_set_text(lbl, s_files[i].name);
        lv_obj_set_style_text_color(lbl, PM_C_FG, 0);
        lv_obj_set_style_text_font(lbl, &lv_font_montserrat_14, 0);
        lv_obj_align(lbl, LV_ALIGN_LEFT_MID, 0, 0);

        s_rows[i] = row;
    }

    lv_obj_t* btn_row = lv_obj_create(s_screen);
    lv_obj_remove_style_all(btn_row);
    lv_obj_set_width(btn_row, LV_PCT(100));
    lv_obj_set_height(btn_row, 60);
    lv_obj_set_layout(btn_row, LV_LAYOUT_FLEX);
    lv_obj_set_flex_flow(btn_row, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(btn_row,
        LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    lv_obj_set_style_pad_column(btn_row, 12, 0);
    s_btn_play = pm_ui_button(btn_row, LV_SYMBOL_PLAY " PLAY", _on_play, NULL);
    s_btn_stop = pm_ui_button(btn_row, LV_SYMBOL_STOP " STOP", _on_stop, NULL);
}

static void _init(void) {
    _scan_directory();
    _build_screen();
    _refresh_rows();
    _refresh_now();
}

static void _enter(void) {
    if (s_screen) lv_screen_load(s_screen);
    pm_log_i(TAG, "enter");
    s_audio = pm_peer_find("audio_play", PM_PEER_ROLE_PRIMARY);
    if (!s_audio) pm_log_w(TAG, "no audio peer");
}

static void _exit_(void) {
    pm_log_i(TAG, "exit");
    if (s_playing && s_audio) pm_peer_call(s_audio, "stop", NULL);
    if (s_audio) pm_peer_release(s_audio);
    s_audio = NULL;
    s_playing = false;
}

static const pm_app_t _APP = {
    .id           = "myaudio",
    .display_name = "AUDIO",
    .category     = PM_CAT_MEDIA,
    .icon_id      = 0,
    .init         = _init,
    .enter        = _enter,
    .tick         = NULL,
    .exit         = _exit_,
    .deinit       = NULL,
};

const pm_app_t* pm_app_myaudio(void) { return &_APP; }
`,
  },

  // ─────────────────────────────────────────────────────────────
  system_info: {
    name: "System Info",
    desc: "pm_chip_info + heap/PSRAM + uptime + peer enumeration.",
    category: "SYSTEM",
    funcName: "mysys",
    code: `// Pisces Moon OS — System Info
// Copyright (C) 2026 Your Name
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// Read-only diagnostic panel. Updates every second.
// Demonstrates the full pm_hal info API plus peer enumeration.

#include "pm_app_mysys.h"
#include "pm_app.h"
#include "pm_hal.h"
#include "pm_ui.h"
#include "pm_peer.h"
#include "lvgl.h"
#include <stdio.h>
#include <string.h>

static const char* TAG = "MYSYS";

static lv_obj_t* s_screen    = NULL;
static lv_obj_t* s_lbl_chip  = NULL;
static lv_obj_t* s_lbl_cores = NULL;
static lv_obj_t* s_lbl_flash = NULL;
static lv_obj_t* s_lbl_psram = NULL;
static lv_obj_t* s_lbl_heap  = NULL;
static lv_obj_t* s_lbl_psfree= NULL;
static lv_obj_t* s_lbl_uptime= NULL;
static lv_obj_t* s_lbl_peers = NULL;
static lv_obj_t* s_lbl_ver   = NULL;
static lv_obj_t* s_lbl_peers_list = NULL;

static uint32_t  s_last_render_ms = 0;

static void _format_bytes(size_t bytes, char* out, size_t cap) {
    if (bytes >= 1024 * 1024) {
        snprintf(out, cap, "%.2f MB", bytes / (1024.0 * 1024.0));
    } else if (bytes >= 1024) {
        snprintf(out, cap, "%.1f KB", bytes / 1024.0);
    } else {
        snprintf(out, cap, "%u B", (unsigned)bytes);
    }
}

static void _render(void) {
    char buf[96];
    pm_chip_info_t info;
    pm_chip_info(&info);

    if (s_lbl_chip)  lv_label_set_text(s_lbl_chip,  info.chip_name);
    snprintf(buf, sizeof(buf), "%d", info.cores);
    if (s_lbl_cores) lv_label_set_text(s_lbl_cores, buf);

    _format_bytes(info.flash_bytes, buf, sizeof(buf));
    if (s_lbl_flash) lv_label_set_text(s_lbl_flash, buf);
    _format_bytes(info.psram_bytes, buf, sizeof(buf));
    if (s_lbl_psram) lv_label_set_text(s_lbl_psram, buf);

    _format_bytes(pm_free_heap(), buf, sizeof(buf));
    if (s_lbl_heap) lv_label_set_text(s_lbl_heap, buf);
    _format_bytes(pm_psram_free_bytes(), buf, sizeof(buf));
    if (s_lbl_psfree) lv_label_set_text(s_lbl_psfree, buf);

    uint32_t up = pm_uptime_seconds();
    snprintf(buf, sizeof(buf), "%02u:%02u:%02u",
        (unsigned)(up / 3600), (unsigned)((up / 60) % 60), (unsigned)(up % 60));
    if (s_lbl_uptime) lv_label_set_text(s_lbl_uptime, buf);

    int npeers = pm_peer_count();
    snprintf(buf, sizeof(buf), "%d", npeers);
    if (s_lbl_peers) lv_label_set_text(s_lbl_peers, buf);

    // Peer enumeration into a multi-line label — uses strncat
    // for portability between C and the JenCoder preview.
    char list[400];
    list[0] = 0;
    for (int i = 0; i < npeers; i++) {
        const pm_peer_t* p = pm_peer_at(i);
        if (!p) continue;
        if (i > 0) strncat(list, "\n", sizeof(list) - strlen(list) - 1);
        strncat(list, pm_peer_name(p), sizeof(list) - strlen(list) - 1);
    }
    if (list[0] == 0) snprintf(list, sizeof(list), "(no peers registered)");
    if (s_lbl_peers_list) lv_label_set_text(s_lbl_peers_list, list);
}

static void _build_screen(void) {
    s_screen = pm_ui_screen();
    pm_ui_titlebar(s_screen, "SYSTEM", NULL, NULL);

    lv_obj_t* card = pm_ui_card(s_screen);
    lv_obj_set_width(card, LV_PCT(100));
    s_lbl_chip   = pm_ui_kv_row(card, "CHIP",       "--");
    s_lbl_cores  = pm_ui_kv_row(card, "CORES",      "0");
    s_lbl_flash  = pm_ui_kv_row(card, "FLASH",      "0");
    s_lbl_psram  = pm_ui_kv_row(card, "PSRAM",      "0");
    s_lbl_heap   = pm_ui_kv_row(card, "FREE HEAP",  "0");
    s_lbl_psfree = pm_ui_kv_row(card, "FREE PSRAM", "0");
    s_lbl_uptime = pm_ui_kv_row(card, "UPTIME",     "00:00:00");
    s_lbl_peers  = pm_ui_kv_row(card, "PEERS",      "0");
    s_lbl_ver    = pm_ui_kv_row(card, "VERSION",    PM_VERSION_STRING);

    lv_obj_t* peers_card = pm_ui_card(s_screen);
    lv_obj_set_width(peers_card, LV_PCT(100));
    lv_obj_t* hdr = lv_label_create(peers_card);
    lv_label_set_text(hdr, "REGISTERED PEERS");
    lv_obj_set_style_text_color(hdr, PM_C_FG_DIM, 0);
    lv_obj_set_style_text_font(hdr, &lv_font_montserrat_14, 0);

    s_lbl_peers_list = lv_label_create(peers_card);
    lv_label_set_text(s_lbl_peers_list, "");
    lv_obj_set_style_text_color(s_lbl_peers_list, PM_C_ACCENT, 0);
    lv_obj_set_style_text_font(s_lbl_peers_list, &lv_font_montserrat_16, 0);
    lv_label_set_long_mode(s_lbl_peers_list, LV_LABEL_LONG_WRAP);
    lv_obj_set_width(s_lbl_peers_list, LV_PCT(100));
}

static void _init(void)  { _build_screen(); }
static void _enter(void) {
    if (s_screen) lv_screen_load(s_screen);
    pm_log_i(TAG, "enter");
    s_last_render_ms = 0;
    _render();
}
static void _tick(uint32_t elapsed_ms) {
    (void)elapsed_ms;
    uint32_t now = pm_millis();
    if (now - s_last_render_ms < 1000) return;
    s_last_render_ms = now;
    _render();
}
static void _exit_(void) { pm_log_i(TAG, "exit"); }

static const pm_app_t _APP = {
    .id           = "mysys",
    .display_name = "SYSTEM",
    .category     = PM_CAT_SYSTEM,
    .icon_id      = 0,
    .init         = _init,
    .enter        = _enter,
    .tick         = _tick,
    .exit         = _exit_,
    .deinit       = NULL,
};

const pm_app_t* pm_app_mysys(void) { return &_APP; }
`,
  },

};

if (typeof window !== "undefined") {
  window.JENCODER_TEMPLATES = JENCODER_TEMPLATES;
}
