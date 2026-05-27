// Pisces Moon OS — JenCoder Web Edition
// Copyright (C) 2026 Eric Becker / Fluid Fortune
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// jencoder_emulator.js — LVGL widget renderer + pm_app_t lifecycle
//
// This is the engine. Unlike Lety, which transpiles arbitrary C++
// drawing code into JS, JenCoder targets a narrower API surface:
//   - apps build their screen by calling pm_ui_* widget builders
//   - apps update state by calling lv_label_set_text(), lv_obj_*_set_*
//   - apps respond to lifecycle hooks (init / enter / tick / exit)
//
// The transpiler converts the source's pm_app_t struct + the named
// lifecycle functions into JS callables. Widget calls produce real
// styled DOM into a 1024×600 preview viewport.
//
// The result: real P4 source files (the same C that compiles via
// ESP-IDF) render correctly in the browser without needing WASM
// or a full LVGL port.

// ─────────────────────────────────────────────────────────────
//  PiscesP4Emulator
// ─────────────────────────────────────────────────────────────
class PiscesP4Emulator {
  constructor(viewport) {
    this.viewport = viewport;          // The CrowPanel preview <div>
    this.W = 1024;
    this.H = 600;

    // Backing field for the lifecycle generator (delay/yield handling)
    this.running   = false;
    this.startTime = 0;
    this.fpsLast   = 0;
    this.frameCount = 0;

    // Widget handle table
    this._nextId   = 1;
    this._handles  = new Map();
    this._screens  = new Map();       // screens created with pm_ui_screen()
    this._activeScreen = null;

    // Lifecycle callbacks pulled from the parsed pm_app_t
    this._app = {
      id: "",
      display_name: "",
      category: 0,
      init:   null,
      enter:  null,
      tick:   null,
      exit:   null,
      deinit: null,
    };
    this._tickTimer = null;
    this._tickAccum = 0;
    this._lastTickMs = 0;
    this._tickInterval = 33;   // ~30fps

    // IDE hooks
    this.consoleLog = (msg, type) => {};
    this.fpsHook    = (fps) => {};
    this.stoppedHook = () => {};

    // The transpiled script lives here for re-runs.
    this._appScript = null;
    this._appName = "";

    // Allocate the LVGL-like input layer
    this._inputState = {
      touch:    { x: 0, y: 0, pressed: false, lastPress: 0 },
      keyboard: [],
      dpad:     { x: 0, y: 0, clicked: false },
    };

    this._initViewport();
    this._bindInput();
  }

  // ─────────────────────────────────────────────────────────────
  //  Viewport setup
  // ─────────────────────────────────────────────────────────────
  _initViewport() {
    this.viewport.classList.add("jc-viewport");
    this.viewport.style.width  = this.W + "px";
    this.viewport.style.height = this.H + "px";
    this.viewport.style.position = "relative";
    this.viewport.style.overflow = "hidden";
    this.viewport.style.background = "#0A1828";
    this.viewport.style.color      = "#E6F0FA";
    this.viewport.style.fontFamily = "system-ui, -apple-system, 'SF Pro Display', 'Segoe UI', sans-serif";
    this.viewport.style.fontSize   = "14px";
    this.viewport.tabIndex = 0;

    // Default "idle" splash
    this._showIdle();
  }

  _showIdle() {
    this.viewport.innerHTML = `
      <div style="
        position:absolute;inset:0;
        display:flex;flex-direction:column;
        align-items:center;justify-content:center;
        color:#4FD1C5;font-family:ui-monospace,monospace;
        gap:12px;">
        <div style="font-size:56px;letter-spacing:6px;">⬢ JenCoder</div>
        <div style="color:#8FA8C2;font-size:13px;">
          CrowPanel Advanced 7" · ESP32-P4 · 1024×600
        </div>
        <div style="color:#4A6A8C;font-size:11px;margin-top:24px;">
          Click ▶ Run Preview to launch this app
        </div>
      </div>
    `;
  }

  _bindInput() {
    const v = this.viewport;

    const updateTouch = (e) => {
      const rect = v.getBoundingClientRect();
      const scaleX = this.W / rect.width;
      const scaleY = this.H / rect.height;
      this._inputState.touch.x = Math.floor((e.clientX - rect.left) * scaleX);
      this._inputState.touch.y = Math.floor((e.clientY - rect.top)  * scaleY);
    };

    v.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      updateTouch(e);
      this._inputState.touch.pressed = true;
      this._inputState.touch.lastPress = performance.now();
      this._dispatchTouch("press");
      v.focus();
    });
    v.addEventListener("mouseup", (e) => {
      if (this._inputState.touch.pressed) {
        this._dispatchTouch("release");
      }
      this._inputState.touch.pressed = false;
    });
    v.addEventListener("mousemove", (e) => {
      if (this._inputState.touch.pressed) {
        updateTouch(e);
        this._dispatchTouch("move");
      }
    });
    v.addEventListener("mouseleave", () => {
      if (this._inputState.touch.pressed) {
        this._dispatchTouch("release");
      }
      this._inputState.touch.pressed = false;
    });

    v.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === "ArrowUp")    { this._inputState.dpad.y = -1; e.preventDefault(); return; }
      if (k === "ArrowDown")  { this._inputState.dpad.y =  1; e.preventDefault(); return; }
      if (k === "ArrowLeft")  { this._inputState.dpad.x = -1; e.preventDefault(); return; }
      if (k === "ArrowRight") { this._inputState.dpad.x =  1; e.preventDefault(); return; }
      if (k === "Enter" && e.altKey) {
        this._inputState.dpad.clicked = true;
        e.preventDefault();
        return;
      }
      if (k === "Enter")      this._inputState.keyboard.push(13);
      else if (k === "Backspace") this._inputState.keyboard.push(8);
      else if (k === "Escape")    this._inputState.keyboard.push(27);
      else if (k.length === 1)    this._inputState.keyboard.push(k.charCodeAt(0));
    });

    v.addEventListener("keyup", (e) => {
      const k = e.key;
      if (k === "ArrowUp" || k === "ArrowDown")    this._inputState.dpad.y = 0;
      if (k === "ArrowLeft" || k === "ArrowRight") this._inputState.dpad.x = 0;
      if (k === "Enter") this._inputState.dpad.clicked = false;
    });
  }

  _dispatchTouch(phase) {
    // Find the topmost LVGL element under (touch.x, touch.y) and fire
    // its click event if it has one.
    if (phase !== "press") return;
    const { x, y } = this._inputState.touch;
    const tgt = document.elementFromPoint(
      this.viewport.getBoundingClientRect().left + (x / this.W) * this.viewport.clientWidth,
      this.viewport.getBoundingClientRect().top  + (y / this.H) * this.viewport.clientHeight,
    );
    if (!tgt) return;

    // Walk up looking for a handle with a click callback
    let el = tgt;
    while (el && el !== this.viewport) {
      const hid = el.getAttribute && el.getAttribute("data-lv-handle");
      if (hid) {
        const h = this._handles.get(parseInt(hid, 10));
        if (h && h._clickCb) {
          try {
            h._clickCb({ target: h, code: "LV_EVENT_CLICKED" });
          } catch (err) {
            this.consoleLog(`Event handler error: ${err.message}`, "err");
          }
          return;
        }
      }
      el = el.parentElement;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Handle helpers
  // ─────────────────────────────────────────────────────────────
  _alloc(el, kind) {
    const id = this._nextId++;
    el.setAttribute("data-lv-handle", id);
    const h = {
      _id: id,
      _kind: kind,
      _el: el,
      _styles: { 0: {}, LV_STATE_PRESSED: {} },
      _children: [],
      _parent: null,
      _hidden: false,
      _clickCb: null,
      _userData: null,
    };
    this._handles.set(id, h);
    return h;
  }

  _elFromHandle(h) {
    if (!h) return null;
    if (h._el) return h._el;
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  //  Color resolution — accepts lv_color_hex objects, named
  //  PM_C_* constants, or hex integers.
  // ─────────────────────────────────────────────────────────────
  _color(c) { return window.jcHal.colorToCss(c); }

  // ─────────────────────────────────────────────────────────────
  //  pm_ui_* widget builders
  //  Each returns a handle the user code can keep and update.
  // ─────────────────────────────────────────────────────────────

  pm_ui_screen() {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.background = "#0A1828";
    el.style.color = "#E6F0FA";
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.overflow = "hidden";
    const h = this._alloc(el, "screen");
    this._screens.set(h._id, h);
    return h;
  }

  pm_ui_titlebar(parent, title, backCb, backUser) {
    const pEl = this._elFromHandle(parent);
    const bar = document.createElement("div");
    bar.style.height = "52px";
    bar.style.background = "#122B45";
    bar.style.borderBottom = "1px solid #2A4A6C";
    bar.style.display = "flex";
    bar.style.alignItems = "center";
    bar.style.padding = "0 16px";
    bar.style.gap = "12px";
    bar.style.flexShrink = "0";

    // Back arrow
    const back = document.createElement("button");
    back.textContent = "‹";
    back.style.cssText = `
      width:32px;height:32px;border-radius:6px;
      background:transparent;color:#4FD1C5;
      border:1px solid #2A4A6C;font-size:20px;
      cursor:pointer;line-height:1;
    `;
    if (backCb) {
      back.addEventListener("click", () => {
        try { backCb({ target: null, code: "LV_EVENT_CLICKED", user: backUser }); }
        catch (err) { this.consoleLog(`back cb: ${err.message}`, "err"); }
      });
    } else {
      back.addEventListener("click", () => this.stop());
    }
    bar.appendChild(back);

    // Title
    const t = document.createElement("div");
    t.textContent = title || "";
    t.style.cssText = `
      color:#E6F0FA;font-weight:600;font-size:18px;
      letter-spacing:1.5px;text-transform:uppercase;
      flex:1;
    `;
    bar.appendChild(t);

    pEl.appendChild(bar);
    const h = this._alloc(bar, "titlebar");
    return h;
  }

  pm_ui_card(parent) {
    const pEl = this._elFromHandle(parent);
    const card = document.createElement("div");
    card.style.cssText = `
      background:#122B45;
      border:1px solid #2A4A6C;
      border-radius:8px;
      padding:14px 18px;
      margin:10px;
      color:#E6F0FA;
      display:flex;
      flex-direction:column;
      gap:8px;
    `;
    pEl.appendChild(card);
    return this._alloc(card, "card");
  }

  pm_ui_button(parent, label, cb, user) {
    const pEl = this._elFromHandle(parent);
    const btn = document.createElement("button");
    btn.textContent = label || "";
    btn.style.cssText = `
      background:#1A3A5C;color:#4FD1C5;
      border:1px solid #2A4A6C;border-radius:6px;
      padding:10px 18px;font-size:14px;font-weight:600;
      letter-spacing:0.5px;cursor:pointer;
      font-family:inherit;
      transition:background 0.12s, border-color 0.12s;
    `;
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "#234A70";
      btn.style.borderColor = "#4FD1C5";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "#1A3A5C";
      btn.style.borderColor = "#2A4A6C";
    });
    const h = this._alloc(btn, "button");
    h._clickCb = cb;
    if (cb) {
      btn.addEventListener("click", () => {
        try { cb({ target: h, code: "LV_EVENT_CLICKED", user }); }
        catch (err) { this.consoleLog(`btn cb: ${err.message}`, "err"); }
      });
    }
    pEl.appendChild(btn);
    return h;
  }

  pm_ui_chip(parent, text, color) {
    const pEl = this._elFromHandle(parent);
    const css = this._color(color);
    const chip = document.createElement("div");
    chip.textContent = text || "";
    chip.style.cssText = `
      display:inline-block;
      padding:3px 10px;border-radius:12px;
      border:1px solid ${css};
      color:${css};
      font-size:11px;font-weight:700;letter-spacing:1px;
      text-transform:uppercase;
      background:${css}22;
    `;
    const h = this._alloc(chip, "chip");
    // For status updates: emulator-internal text child
    h._textChild = chip;
    pEl.appendChild(chip);
    return h;
  }

  pm_ui_kv_row(parent, key, initial) {
    const pEl = this._elFromHandle(parent);
    const row = document.createElement("div");
    row.style.cssText = `
      display:flex;justify-content:space-between;
      align-items:center;
      padding:6px 0;
      border-bottom:1px solid #1A3A5C;
      font-family:ui-monospace,monospace;
    `;
    const k = document.createElement("span");
    k.textContent = key || "";
    k.style.cssText = `color:#8FA8C2;font-size:12px;text-transform:uppercase;letter-spacing:1px;`;
    const v = document.createElement("span");
    v.textContent = initial != null ? String(initial) : "";
    v.style.cssText = `color:#4FD1C5;font-size:14px;`;
    row.appendChild(k);
    row.appendChild(v);
    pEl.appendChild(row);
    // Returns the *value* label handle for later updates
    return this._alloc(v, "label");
  }

  pm_ui_status_dot(parent, color) {
    const pEl = this._elFromHandle(parent);
    const css = this._color(color);
    const dot = document.createElement("span");
    dot.style.cssText = `
      display:inline-block;width:10px;height:10px;
      border-radius:50%;background:${css};
      box-shadow:0 0 8px ${css};
    `;
    pEl.appendChild(dot);
    return this._alloc(dot, "dot");
  }

  pm_ui_list(parent) {
    const pEl = this._elFromHandle(parent);
    const list = document.createElement("div");
    list.style.cssText = `
      flex:1;overflow-y:auto;
      background:#0A1828;
      border:1px solid #2A4A6C;
      border-radius:6px;
      margin:8px;
    `;
    pEl.appendChild(list);
    return this._alloc(list, "list");
  }

  pm_ui_meter_bar(parent, min, max) {
    const pEl = this._elFromHandle(parent);
    const wrap = document.createElement("div");
    wrap.style.cssText = `
      height:8px;background:#1A3A5C;border-radius:4px;
      overflow:hidden;margin:6px 0;
    `;
    const fill = document.createElement("div");
    fill.style.cssText = `
      height:100%;background:#4FD1C5;
      width:0%;transition:width 0.2s;
    `;
    wrap.appendChild(fill);
    pEl.appendChild(wrap);
    const h = this._alloc(wrap, "bar");
    h._barFill = fill;
    h._barMin  = min || 0;
    h._barMax  = max || 100;
    h._barValue = h._barMin;
    return h;
  }

  pm_ui_keypad(parent, layout, cb, user) {
    const pEl = this._elFromHandle(parent);
    const pad = document.createElement("div");
    pad.style.cssText = `
      display:flex;flex-direction:column;gap:6px;
      padding:10px;
      flex:1;
    `;
    const rows = (layout || "789\n456\n123\n.0=").split("\n");
    for (const r of rows) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;flex:1;gap:6px;";
      for (const c of r) {
        const k = document.createElement("button");
        k.textContent = c;
        k.style.cssText = `
          flex:1;padding:14px;font-size:18px;font-weight:600;
          background:#1A3A5C;color:#E6F0FA;
          border:1px solid #2A4A6C;border-radius:6px;
          cursor:pointer;font-family:ui-monospace,monospace;
        `;
        k.addEventListener("mouseenter", () => { k.style.background = "#234A70"; });
        k.addEventListener("mouseleave", () => { k.style.background = "#1A3A5C"; });
        const ch = c;
        if (cb) {
          k.addEventListener("click", () => {
            try { cb(ch, user); }
            catch (err) { this.consoleLog(`keypad cb: ${err.message}`, "err"); }
          });
        }
        row.appendChild(k);
      }
      pad.appendChild(row);
    }
    pEl.appendChild(pad);
    return this._alloc(pad, "keypad");
  }

  pm_ui_log_panel(parent) {
    const pEl = this._elFromHandle(parent);
    const panel = document.createElement("div");
    panel.style.cssText = `
      flex:1;overflow-y:auto;
      background:#050E1A;
      border:1px solid #2A4A6C;
      border-radius:6px;
      padding:8px 12px;
      font-family:ui-monospace,monospace;
      font-size:12px;
      color:#4FD1C5;
      margin:8px;
    `;
    pEl.appendChild(panel);
    return this._alloc(panel, "log_panel");
  }

  pm_ui_log_append(panel, line) {
    if (!panel || !panel._el) return;
    const row = document.createElement("div");
    row.textContent = line || "";
    row.style.cssText = "line-height:1.5;border-bottom:1px solid #122B45;padding:2px 0;";
    panel._el.appendChild(row);
    panel._el.scrollTop = panel._el.scrollHeight;
  }

  pm_ui_log_clear(panel) {
    if (panel && panel._el) panel._el.innerHTML = "";
  }

  pm_ui_log_obj(panel) { return panel; }

  pm_ui_grid(parent, rows, cols) {
    const pEl = this._elFromHandle(parent);
    const grid = document.createElement("div");
    grid.style.cssText = `
      display:grid;
      grid-template-rows:repeat(${rows || 1}, 1fr);
      grid-template-columns:repeat(${cols || 1}, 1fr);
      gap:10px;padding:10px;flex:1;
    `;
    pEl.appendChild(grid);
    return this._alloc(grid, "grid");
  }

  pm_ui_default_screen(title, status) {
    const scr = this.pm_ui_screen();
    this.pm_ui_titlebar(scr, title || "APP", null, null);
    const card = this.pm_ui_card(scr);
    const lbl = document.createElement("div");
    lbl.textContent = status || "";
    lbl.style.cssText = "color:#E6F0FA;font-size:16px;line-height:1.6;";
    this._elFromHandle(card).appendChild(lbl);
    scr._defaultStatusEl = lbl;
    return scr;
  }

  pm_ui_default_screen_set_status(scr, text) {
    if (scr && scr._defaultStatusEl) {
      scr._defaultStatusEl.textContent = text || "";
    }
  }

  pm_ui_keyboard_create(parent) {
    const pEl = this._elFromHandle(parent);
    const kb = document.createElement("div");
    kb.style.cssText = `
      position:absolute;left:0;right:0;bottom:0;
      height:240px;background:#122B45;
      border-top:2px solid #4FD1C5;
      display:none;
      padding:8px;
    `;
    const rows = [
      "qwertyuiop",
      "asdfghjkl",
      "zxcvbnm",
      " ←⏎",
    ];
    for (const r of rows) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:4px;margin-bottom:4px;";
      for (const c of r) {
        const k = document.createElement("button");
        k.textContent = c === " " ? "space" : c;
        k.style.cssText = `
          flex:${c === " " ? 6 : 1};padding:10px;font-size:14px;
          background:#1A3A5C;color:#E6F0FA;
          border:1px solid #2A4A6C;border-radius:4px;
          cursor:pointer;
        `;
        row.appendChild(k);
      }
      kb.appendChild(row);
    }
    pEl.appendChild(kb);
    return this._alloc(kb, "keyboard");
  }

  pm_ui_keyboard_attach(k, ta) { /* no-op preview */ }
  pm_ui_keyboard_show(k) { if (k && k._el) k._el.style.display = "block"; }
  pm_ui_keyboard_hide(k) { if (k && k._el) k._el.style.display = "none"; }
  pm_ui_keyboard_obj(k)  { return k; }

  pm_ui_gamepad_create(parent) {
    const pEl = this._elFromHandle(parent);
    const gp = document.createElement("div");
    gp.style.cssText = `
      position:absolute;left:0;right:0;bottom:0;
      height:180px;background:#0A1828ee;
      border-top:2px solid #4FD1C5;
      display:flex;align-items:center;justify-content:space-between;
      padding:0 40px;color:#4FD1C5;
      font-family:ui-monospace,monospace;
    `;
    gp.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,40px);grid-template-rows:repeat(3,40px);gap:4px;">
        <div></div><div style="background:#1A3A5C;border-radius:6px;display:flex;align-items:center;justify-content:center;">▲</div><div></div>
        <div style="background:#1A3A5C;border-radius:6px;display:flex;align-items:center;justify-content:center;">◀</div><div></div><div style="background:#1A3A5C;border-radius:6px;display:flex;align-items:center;justify-content:center;">▶</div>
        <div></div><div style="background:#1A3A5C;border-radius:6px;display:flex;align-items:center;justify-content:center;">▼</div><div></div>
      </div>
      <div style="display:flex;gap:12px;font-size:18px;font-weight:bold;">
        <div style="width:48px;height:48px;border-radius:50%;background:#1A3A5C;border:2px solid #4FD1C5;display:flex;align-items:center;justify-content:center;">A</div>
        <div style="width:48px;height:48px;border-radius:50%;background:#1A3A5C;border:2px solid #B4A0FF;display:flex;align-items:center;justify-content:center;">B</div>
      </div>
    `;
    gp.style.display = "none";
    pEl.appendChild(gp);
    return this._alloc(gp, "gamepad");
  }

  pm_ui_gamepad_show(g) { if (g && g._el) g._el.style.display = "flex"; }
  pm_ui_gamepad_hide(g) { if (g && g._el) g._el.style.display = "none"; }
  pm_ui_gamepad_obj(g)  { return g; }

  pm_ui_theme_init() { /* no-op preview */ }

  // ─────────────────────────────────────────────────────────────
  //  Raw LVGL primitives — minimum needed for app code
  // ─────────────────────────────────────────────────────────────

  // Create an LVGL object with no parent (a screen).
  lv_obj_create(parent) {
    const pEl = parent ? this._elFromHandle(parent) : null;
    const el = document.createElement("div");
    if (pEl) {
      pEl.appendChild(el);
    } else {
      // It's a screen — not attached yet. lv_screen_load() will mount it.
    }
    el.style.position = "relative";
    return this._alloc(el, parent ? "obj" : "screen_obj");
  }

  lv_obj_delete(h) {
    if (!h || !h._el) return;
    if (h._el.parentElement) h._el.parentElement.removeChild(h._el);
    this._handles.delete(h._id);
  }

  lv_obj_remove_style_all(h) {
    if (!h || !h._el) return;
    // Reset to a known baseline. We keep position relative for layout safety.
    h._el.style.cssText = "position:relative;";
  }

  lv_obj_set_width(h, w) {
    if (!h || !h._el) return;
    h._el.style.width = this._dim(w);
  }
  lv_obj_set_height(h, hh) {
    if (!h || !h._el) return;
    h._el.style.height = this._dim(hh);
  }
  lv_obj_set_size(h, w, hh) {
    this.lv_obj_set_width(h, w);
    this.lv_obj_set_height(h, hh);
  }
  lv_obj_set_pos(h, x, y) {
    if (!h || !h._el) return;
    h._el.style.left = (x|0) + "px";
    h._el.style.top  = (y|0) + "px";
  }
  lv_obj_center(h) {
    if (!h || !h._el) return;
    h._el.style.margin = "auto";
  }
  lv_obj_align(h, align, dx, dy) {
    if (!h || !h._el) return;
    const ALIGN = {
      LV_ALIGN_CENTER: ["translate(-50%, -50%)", "50%", "50%"],
      LV_ALIGN_TOP_LEFT: ["none", "0", "0"],
      LV_ALIGN_LEFT_MID: ["translate(0, -50%)", "0", "50%"],
      LV_ALIGN_RIGHT_MID: ["translate(0, -50%)", "auto", "50%"],
      LV_ALIGN_BOTTOM_MID: ["translate(-50%, 0)", "50%", "auto"],
    };
    const a = ALIGN[align] || ALIGN.LV_ALIGN_TOP_LEFT;
    h._el.style.position = "absolute";
    h._el.style.transform = a[0];
    h._el.style.left = a[1];
    h._el.style.top  = a[2];
    if (dx) h._el.style.left = ((parseInt(a[1]) || 0) + dx) + "px";
    if (dy) h._el.style.top  = ((parseInt(a[2]) || 0) + dy) + "px";
  }

  _dim(v) {
    if (typeof v === "object" && v !== null && v._pct != null) {
      return v._pct + "%";
    }
    if (typeof v === "number") return v + "px";
    if (typeof v === "string") return v;
    return "auto";
  }

  // Style setters
  lv_obj_set_style_bg_color(h, color, sel)   { if (h && h._el) h._el.style.background = this._color(color); }
  lv_obj_set_style_bg_opa(h, opa, sel)       { if (h && h._el) h._el.style.opacity = (opa >= 100 ? 1 : (opa / 100)); }
  lv_obj_set_style_text_color(h, color, sel) { if (h && h._el) h._el.style.color = this._color(color); }
  lv_obj_set_style_text_font(h, font, sel)   {
    if (h && h._el && font && font._size) h._el.style.fontSize = font._size + "px";
  }
  lv_obj_set_style_text_align(h, align, sel) {
    if (h && h._el) {
      const map = {
        LV_TEXT_ALIGN_LEFT: "left",
        LV_TEXT_ALIGN_CENTER: "center",
        LV_TEXT_ALIGN_RIGHT: "right",
      };
      h._el.style.textAlign = map[align] || "left";
    }
  }
  lv_obj_set_style_text_letter_space(h, sp, sel) {
    if (h && h._el) h._el.style.letterSpacing = (sp || 0) + "px";
  }
  lv_obj_set_style_border_color(h, c, sel) { if (h && h._el) h._el.style.borderColor = this._color(c); }
  lv_obj_set_style_border_width(h, w, sel) { if (h && h._el) h._el.style.borderWidth = (w|0) + "px"; if (h && h._el) h._el.style.borderStyle = "solid"; }
  lv_obj_set_style_border_side(h, side, sel) {
    if (!h || !h._el) return;
    // Reset all and apply just the requested side(s)
    h._el.style.borderTopWidth = "0";
    h._el.style.borderRightWidth = "0";
    h._el.style.borderBottomWidth = "0";
    h._el.style.borderLeftWidth = "0";
    const w = "1px";
    if (side === "LV_BORDER_SIDE_TOP" || side === 1) h._el.style.borderTopWidth = w;
    if (side === "LV_BORDER_SIDE_BOTTOM" || side === 2) h._el.style.borderBottomWidth = w;
    if (side === "LV_BORDER_SIDE_LEFT" || side === 4) h._el.style.borderLeftWidth = w;
    if (side === "LV_BORDER_SIDE_RIGHT" || side === 8) h._el.style.borderRightWidth = w;
  }
  lv_obj_set_style_border_opa(h, opa, sel) { /* opacity handled via bg_opa */ }
  lv_obj_set_style_radius(h, r, sel) { if (h && h._el) h._el.style.borderRadius = (r|0) + "px"; }
  lv_obj_set_style_pad_all(h, p, sel) { if (h && h._el) h._el.style.padding = (p|0) + "px"; }
  lv_obj_set_style_pad_hor(h, p, sel) {
    if (h && h._el) { h._el.style.paddingLeft = (p|0) + "px"; h._el.style.paddingRight = (p|0) + "px"; }
  }
  lv_obj_set_style_pad_ver(h, p, sel) {
    if (h && h._el) { h._el.style.paddingTop = (p|0) + "px"; h._el.style.paddingBottom = (p|0) + "px"; }
  }
  lv_obj_set_style_pad_top(h, p, sel)    { if (h && h._el) h._el.style.paddingTop    = (p|0) + "px"; }
  lv_obj_set_style_pad_bottom(h, p, sel) { if (h && h._el) h._el.style.paddingBottom = (p|0) + "px"; }
  lv_obj_set_style_pad_left(h, p, sel)   { if (h && h._el) h._el.style.paddingLeft   = (p|0) + "px"; }
  lv_obj_set_style_pad_right(h, p, sel)  { if (h && h._el) h._el.style.paddingRight  = (p|0) + "px"; }
  lv_obj_set_style_pad_gap(h, p, sel)    { if (h && h._el) h._el.style.gap           = (p|0) + "px"; }
  lv_obj_set_style_pad_column(h, p, sel) { if (h && h._el) h._el.style.columnGap     = (p|0) + "px"; }
  lv_obj_set_style_pad_row(h, p, sel)    { if (h && h._el) h._el.style.rowGap        = (p|0) + "px"; }

  lv_obj_set_layout(h, layout) {
    if (!h || !h._el) return;
    if (layout === "LV_LAYOUT_FLEX" || layout === 1) h._el.style.display = "flex";
    if (layout === "LV_LAYOUT_GRID" || layout === 2) h._el.style.display = "grid";
  }
  lv_obj_set_flex_flow(h, flow) {
    if (!h || !h._el) return;
    const m = {
      LV_FLEX_FLOW_ROW:    "row",
      LV_FLEX_FLOW_COLUMN: "column",
      LV_FLEX_FLOW_ROW_WRAP: "row wrap",
      LV_FLEX_FLOW_COLUMN_WRAP: "column wrap",
    };
    h._el.style.flexFlow = m[flow] || "row";
  }
  lv_obj_set_flex_align(h, main, cross, track) {
    if (!h || !h._el) return;
    const m = {
      LV_FLEX_ALIGN_START:        "flex-start",
      LV_FLEX_ALIGN_CENTER:       "center",
      LV_FLEX_ALIGN_END:          "flex-end",
      LV_FLEX_ALIGN_SPACE_AROUND: "space-around",
      LV_FLEX_ALIGN_SPACE_BETWEEN:"space-between",
      LV_FLEX_ALIGN_SPACE_EVENLY: "space-evenly",
    };
    h._el.style.justifyContent = m[main]  || "flex-start";
    h._el.style.alignItems     = m[cross] || "stretch";
    h._el.style.alignContent   = m[track] || "stretch";
  }
  lv_obj_set_flex_grow(h, g) { if (h && h._el) h._el.style.flexGrow = (g|0); }
  lv_obj_set_scroll_dir(h, dir) {
    if (!h || !h._el) return;
    h._el.style.overflowY = "auto";
    h._el.style.overflowX = "hidden";
  }

  // Flags
  lv_obj_add_flag(h, flag) {
    if (!h || !h._el) return;
    if (flag === "LV_OBJ_FLAG_HIDDEN") {
      h._hidden = true;
      h._el.style.display = "none";
    }
  }
  lv_obj_remove_flag(h, flag) {
    if (!h || !h._el) return;
    if (flag === "LV_OBJ_FLAG_HIDDEN") {
      h._hidden = false;
      h._el.style.display = "";
    }
  }
  lv_obj_clear_flag(h, flag) { this.lv_obj_remove_flag(h, flag); }

  // Children
  lv_obj_get_child(h, idx) {
    if (!h || !h._el) return null;
    const c = h._el.children[idx];
    if (!c) return null;
    const hid = c.getAttribute("data-lv-handle");
    return hid ? this._handles.get(parseInt(hid, 10)) : null;
  }
  lv_obj_get_child_count(h) {
    if (!h || !h._el) return 0;
    return h._el.children.length;
  }

  // Labels
  lv_label_create(parent) {
    const pEl = this._elFromHandle(parent);
    const el = document.createElement("div");
    el.style.fontFamily = "ui-monospace, monospace";
    el.style.color = "#E6F0FA";
    el.style.fontSize = "14px";
    pEl && pEl.appendChild(el);
    return this._alloc(el, "label");
  }
  lv_label_set_text(h, text) {
    if (h && h._el) h._el.textContent = (text == null) ? "" : String(text);
  }
  lv_label_set_long_mode(h, mode) {
    if (!h || !h._el) return;
    if (mode === "LV_LABEL_LONG_CLIP") {
      h._el.style.overflow = "hidden";
      h._el.style.whiteSpace = "nowrap";
      h._el.style.textOverflow = "ellipsis";
    }
  }

  // Buttons (raw)
  lv_btn_create(parent) {
    const pEl = this._elFromHandle(parent);
    const btn = document.createElement("button");
    btn.style.cssText = `
      background:#1A3A5C;color:#E6F0FA;
      border:1px solid #2A4A6C;border-radius:6px;
      padding:8px 14px;font-family:inherit;cursor:pointer;
    `;
    pEl && pEl.appendChild(btn);
    return this._alloc(btn, "button");
  }

  // ─────────────────────────────────────────────────────────
  //  lv_textarea_*  — single-line and multi-line input
  // ─────────────────────────────────────────────────────────
  lv_textarea_create(parent) {
    const pEl = this._elFromHandle(parent);
    const ta = document.createElement("input");
    ta.type = "text";
    ta.style.cssText = `
      background:#050D17;color:#E6F0FA;
      border:1px solid #2A4A6C;border-radius:4px;
      padding:8px 10px;font-family:ui-monospace,monospace;
      font-size:13px;flex-grow:1;outline:none;
    `;
    ta.addEventListener("focus", () => { ta.style.borderColor = "#4FD1C5"; });
    ta.addEventListener("blur",  () => { ta.style.borderColor = "#2A4A6C"; });
    pEl && pEl.appendChild(ta);
    const h = this._alloc(ta, "textarea");
    h._isTextarea = true;
    return h;
  }
  lv_textarea_set_text(h, text) {
    if (h && h._el) h._el.value = String(text || "");
  }
  lv_textarea_get_text(h) {
    return h && h._el ? (h._el.value || "") : "";
  }
  lv_textarea_set_placeholder_text(h, text) {
    if (h && h._el) h._el.placeholder = String(text || "");
  }
  lv_textarea_set_one_line(h, on) { /* always single-line in preview */ }
  lv_textarea_set_password_mode(h, on) {
    if (h && h._el) h._el.type = on ? "password" : "text";
  }
  lv_textarea_add_char(h, ch) {
    if (h && h._el) h._el.value += String.fromCharCode(ch);
  }
  lv_textarea_del_char(h) {
    if (h && h._el) h._el.value = h._el.value.slice(0, -1);
  }

  lv_obj_add_event_cb(h, cb, evt, user) {
    if (!h || !h._el) return;
    if (evt === "LV_EVENT_CLICKED" || evt === 1) {
      h._clickCb = cb;
      h._el.addEventListener("click", () => {
        try { cb({ target: h, code: "LV_EVENT_CLICKED", user }); }
        catch (err) { this.consoleLog(`event cb: ${err.message}`, "err"); }
      });
    }
  }

  // Event accessors used inside callbacks
  lv_event_get_user_data(e) { return e && "user" in e ? e.user : null; }
  lv_event_get_target(e)    { return e && e.target ? e.target : null; }
  lv_event_get_code(e)      { return e && e.code ? e.code : 0; }

  // Bar
  lv_bar_create(parent) {
    return this.pm_ui_meter_bar(parent, 0, 100);
  }
  lv_bar_set_value(h, v, anim) {
    if (!h || !h._barFill) return;
    h._barValue = v;
    const range = (h._barMax - h._barMin) || 1;
    const pct = Math.max(0, Math.min(100, ((v - h._barMin) / range) * 100));
    h._barFill.style.width = pct + "%";
  }
  lv_bar_set_range(h, mn, mx) {
    if (!h) return;
    h._barMin = mn; h._barMax = mx;
  }

  // Screen management
  lv_screen_load(scr) {
    // Hide all screens, show this one
    for (const [, h] of this._screens) {
      if (h._el && h._el.parentElement) h._el.parentElement.removeChild(h._el);
    }
    if (scr && scr._el) {
      this.viewport.appendChild(scr._el);
      this._activeScreen = scr;
    }
  }

  lvgl_port_lock(ms)  { return 1; }
  lvgl_port_unlock()  { /* noop */ }

  // LV_PCT(n) returns a percentage-tagged dim
  LV_PCT(n) { return { _pct: n }; }
  LV_SIZE_CONTENT() { return "auto"; }

  // ─────────────────────────────────────────────────────────────
  //  TRANSPILER — C source to JS callable
  //
  //  The P4 pattern: every app provides a pm_app_t struct with
  //  named callbacks (init/enter/tick/exit/deinit). We rewrite
  //  the source into a self-contained JS function that, when
  //  invoked with the emulator, returns the lifecycle hooks as
  //  JS closures.
  // ─────────────────────────────────────────────────────────────
  transpile(cSource) {
    let s = cSource;

    // Strip block comments and line comments. (We keep newlines so
    // line numbers in error messages roughly match.)
    s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    s = s.replace(/\/\/.*$/gm, "");

    // Strip preprocessor directives we don't need (include, define,
    // #ifdef, ifndef, endif). We KEEP simple #define value pairs so
    // constants like #define MY_THING 5 become JS consts.
    const defines = {};
    s = s.replace(/^\s*#\s*define\s+([A-Z_][A-Z0-9_]*)\s+(.+?)\s*$/gm, (m, name, val) => {
      defines[name] = val.trim();
      return "";
    });
    s = s.replace(/^\s*#\s*(?:include|ifndef|ifdef|endif|else|elif|if|undef|pragma|error|warning).*$/gm, "");

    // Emit the captured #defines at the top of the transpiled output
    // so identifier references resolve at runtime. Use `let` not `const`
    // because the static/const stripping pass below would otherwise eat
    // the `const` keyword and leave an undeclared assignment.
    if (Object.keys(defines).length) {
      const defLines = Object.entries(defines)
        .map(([k, v]) => `let ${k} = ${v};`)
        .join("\n");
      s = defLines + "\n" + s;
    }

    // Strip extern "C" / extern declarations of external symbols.
    // Templates use `extern void __jc_mock_foo(int idx);` to declare
    // helpers the emulator provides at runtime — we must delete these
    // entirely so they don't appear as malformed JS function decls.
    s = s.replace(/\bextern\s+"C"\s*\{/g, "");
    // Function-prototype externs: `extern <type>... name(args);`
    s = s.replace(/\bextern\s+[\w*\s]+?\s+\w+\s*\([^)]*\)\s*;/g, "");
    // Simple var externs: `extern <type>... name;`
    s = s.replace(/\bextern\s+(?:const\s+)?[\w*\s]+;/g, "");
    s = s.replace(/\bextern\s+/g, "");

    // Drop "static" and "const" qualifiers in function-scope contexts.
    s = s.replace(/\b(?:static|const|volatile|register|inline|__attribute__\s*\(\s*\(\s*[^)]+\)\s*\))\s+/g, "");

    // Strip typedef enums and typedef structs (we don't need their
    // contents — apps using them just need symbols to exist as ints).
    // Capture enum names as symbol → number lookups.
    s = s.replace(/typedef\s+enum\s*(?:\w+\s*)?\{([^}]*)\}\s*(\w+)\s*;/g, (m, body, name) => {
      // Each member becomes a window-level const
      const members = body.split(",").map(x => x.trim()).filter(Boolean);
      let i = 0;
      let out = "";
      for (const mem of members) {
        const eq = mem.indexOf("=");
        if (eq >= 0) {
          const k = mem.slice(0, eq).trim();
          const v = mem.slice(eq + 1).trim();
          out += `const ${k} = ${v};\n`;
          // Best-effort: track integer counter
          const n = parseInt(v, 10);
          if (!isNaN(n)) i = n + 1;
        } else {
          out += `const ${mem.trim()} = ${i++};\n`;
        }
      }
      return out;
    });
    s = s.replace(/typedef\s+struct\s*\w*\s*\{[^}]*\}\s*\w+\s*;/g, "");
    s = s.replace(/typedef\s+[\w\s*]+\s+\w+\s*;/g, "");

    // Plain enum (no typedef)
    s = s.replace(/\benum\s*\{([^}]*)\}\s*;/g, (m, body) => {
      const members = body.split(",").map(x => x.trim()).filter(Boolean);
      let i = 0;
      let out = "";
      for (const mem of members) {
        const eq = mem.indexOf("=");
        if (eq >= 0) {
          const k = mem.slice(0, eq).trim();
          const v = mem.slice(eq + 1).trim();
          out += `const ${k} = ${v};\n`;
          const n = parseInt(v, 10);
          if (!isNaN(n)) i = n + 1;
        } else {
          out += `const ${mem.trim()} = ${i++};\n`;
        }
      }
      return out;
    });

    // Strip plain struct definitions
    s = s.replace(/\bstruct\s+\w*\s*\{[^}]*\}\s*\w*\s*;/g, "");

    // ─────────────────────────────────────────────────────────
    //  Function header rewriting MUST happen before var-decl
    //  stripping or the latter will eat the function names.
    // ─────────────────────────────────────────────────────────
    //   static void _foo(int x, const char* y) {  →  function _foo(x, y) {
    //   const pm_app_t* pm_app_foo(void) {        →  function pm_app_foo() {
    //   void main_register_apps(void) {           →  function main_register_apps() {
    s = s.replace(
      /(?:^|\n)\s*(?:(?:void|bool|char|short|int|long|float|double|signed|unsigned|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|size_t|esp_err_t|TaskHandle_t|SemaphoreHandle_t|FILE|lv_obj_t|lv_color_t|pm_app_t|pm_peer_t|pm_gps_t|pm_ui_log_t|pm_ui_keyboard_t|pm_ui_gamepad_t|const)\s+)+\**\s*(\w+)\s*\(([^)]*)\)\s*\{/g,
      (m, name, args) => {
        const params = (args || "")
          .split(",")
          .map(a => a.trim())
          .filter(a => a && a !== "void")
          .map(a => {
            // Take the last identifier-like token (the param name)
            const parts = a.replace(/\[\s*\d*\s*\]/g, "").split(/[\s*]+/).filter(Boolean);
            return parts[parts.length - 1] || "_";
          })
          .join(", ");
        return `\nfunction ${name}(${params}) {`;
      }
    );

    // One-line accessor functions:  const pm_app_t* pm_app_foo(void) { return &_APP; }
    // (the function-header regex above requires `\{` immediately, which
    // is fine — but the accessor uses `return &_APP;` and the `&` strip
    // hasn't run yet. We handle accessor specifically here just in case.)
    s = s.replace(
      /(?:^|\n)\s*(?:const\s+)?pm_app_t\s*\*\s*(pm_app_\w+)\s*\(\s*(?:void\s*)?\)\s*\{([^}]*)\}/g,
      (m, name, body) => `\nfunction ${name}() {${body}}`
    );

    // Strip C types in declarations:
    //   const char* TAG = "..."     → const TAG = "..."
    //   uint32_t s_count = 0        → let s_count = 0
    //   void* p                     → let p
    //   pm_app_t a; lv_obj_t* x;    → let a; let x;
    const TYPES = "(?:void|bool|char|short|int|long|float|double|signed|unsigned|" +
                  "uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|" +
                  "size_t|ssize_t|intptr_t|uintptr_t|" +
                  "lv_obj_t|lv_color_t|lv_event_cb_t|lv_event_t|" +
                  "pm_app_t|pm_category_t|pm_peer_t|pm_peer_role_t|pm_peer_kind_t|" +
                  "pm_file_t|pm_dir_t|pm_db_t|pm_stmt_t|pm_mutex_t|pm_time_t|" +
                  "pm_chip_info_t|pm_ui_log_t|pm_ui_keyboard_t|pm_ui_gamepad_t|" +
                  "pm_gps_t|wifi_ap_record_t|wifi_auth_mode_t|esp_err_t|" +
                  "TaskHandle_t|SemaphoreHandle_t|TickType_t|BaseType_t|" +
                  "FILE)";

    // ─── Array decls: `char buf[N];` / `char buf[N] = "..."` ───
    // Char arrays → empty string.
    s = s.replace(
      /\b(?:char|uint8_t|int8_t)\b\s+(\w+)\s*\[[^\]]*\]\s*=\s*("[^"]*")\s*;/g,
      "let $1 = $2;"
    );
    s = s.replace(
      /\b(?:char|uint8_t|int8_t)\b\s+(\w+)\s*\[[^\]]*\]\s*;/g,
      'let $1 = "";'
    );

    // Initialized array from C brace-init (empty brackets):
    //   const char* ITEMS[] = { "a", "b" }; → let ITEMS = [ "a", "b" ];
    //   const char* DEMO[] = { "x" };
    // Must run BEFORE the sized-array regex so [] doesn't match [N].
    s = s.replace(
      new RegExp(`\\b${TYPES}\\b\\s*\\**\\s*(\\w+)\\s*\\[\\s*\\]\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*;`, "g"),
      "let $1 = [$2];"
    );

    // Numeric arrays WITH brace initializer:
    //   lv_obj_t* s_rows[8]   = {0};        → let s_rows = [];
    // Require at least one char inside the brackets so we don't match
    // the empty-bracket case above.
    s = s.replace(
      new RegExp(`\\b${TYPES}\\b\\s*\\**\\s*(\\w+)\\s*\\[[^\\]]+\\]\\s*=\\s*\\{[^}]*\\}\\s*;`, "g"),
      "let $1 = [];"
    );

    // Numeric arrays → empty array literal.
    s = s.replace(
      new RegExp(`\\b${TYPES}\\b\\s*\\**\\s*(\\w+)\\s*\\[[^\\]]*\\]\\s*;`, "g"),
      "let $1 = [];"
    );

    // Struct-typed locals (any pm_*_t or wifi_*_t / lv_*_t) get a `{}` init
    // since the C code expects to fill them via out-param functions.
    // Must run BEFORE the general declRe pass.
    const STRUCT_TYPES = "(?:pm_app_t|pm_category_t|pm_peer_t|pm_peer_role_t|pm_peer_kind_t|pm_file_t|pm_dir_t|pm_db_t|pm_stmt_t|pm_mutex_t|pm_time_t|pm_chip_info_t|pm_ui_log_t|pm_ui_keyboard_t|pm_ui_gamepad_t|pm_gps_t|wifi_ap_record_t|lv_event_t)";
    s = s.replace(
      new RegExp(`\\b${STRUCT_TYPES}\\b\\s+(\\w+)\\s*;`, "g"),
      "let $1 = {};"
    );

    // Function parameter lists handled above. Local variable declarations:
    const declRe = new RegExp(
      `\\b${TYPES}\\b\\s*\\**\\s*(\\w+)(\\s*(?:=|;|,|\\)|\\[))`,
      "g"
    );
    s = s.replace(declRe, "let $1$2");

    // ─── User-typedef'd struct vars (any *_t identifier not in TYPES) ───
    // e.g. `nfc_tag_t s_tag;` → `let s_tag = {};`
    // We're conservative: only match at line start (with optional whitespace)
    // and only when followed by ` name;` or ` name = ...;`. This avoids
    // mangling things like `extern int  __jc_mock_wifi_rssi(int idx);`.
    s = s.replace(
      /(^|\n)([ \t]*)([a-z][a-z0-9_]*_t)\s+(\w+)\s*;/g,
      "$1$2let $4 = {};"
    );
    // User typedef array with brace init: `audio_file_t s_files[MAX] = {0};`
    s = s.replace(
      /(^|\n)([ \t]*)([a-z][a-z0-9_]*_t)\s+(\w+)\s*\[[^\]]*\]\s*=\s*\{[^}]*\}\s*;/g,
      "$1$2let $4 = [];"
    );
    s = s.replace(
      /(^|\n)([ \t]*)([a-z][a-z0-9_]*_t)\s+(\w+)\s*\[[^\]]*\]\s*;/g,
      "$1$2let $4 = [];"
    );

    // Multi-var on one line: let a, b, c;
    // Handled by simple comma chains, JS accepts them.

    // Sizeof — for typical buffer dimensioning, return the array length
    // if we can infer it (otherwise 0).
    //
    // First handle the common C idiom `sizeof(arr) / sizeof(arr[0])`
    // → `arr.length`. We also accept casts around the whole thing.
    s = s.replace(
      /sizeof\s*\(\s*(\w+)\s*\)\s*\/\s*sizeof\s*\(\s*\1\s*\[\s*0\s*\]\s*\)/g,
      "($1 ? $1.length : 0)"
    );
    // Generic fallback: anything else `sizeof(...)` becomes 0. Apps that
    // need a real size will get an obvious 0 to debug.
    s = s.replace(/\bsizeof\s*\([^)]+\)/g, "0");

    // Address-of: &x → x (we don't have C pointers). Must not eat &&
    // (logical AND) or &= (compound assignment).
    s = s.replace(/(?<![&])&(?![&=])\s*(\w+)/g, "$1");

    // Dereference: *p → p (assume single-level)
    // (We don't do this aggressively — only obvious patterns)
    s = s.replace(/\*\s*(\w+)\s*=\s*/g, "$1 = ");

    // Arrow operator → dot. ctx->gfx → ctx.gfx
    s = s.replace(/->/g, ".");

    // String literal concat in C is implicit: "a" "b" → "ab"
    // Only match when the two literals are on the same line and contain
    // no quotes themselves. Without the [^"\\n] restriction the regex
    // happily ate code between literals on different lines.
    s = s.replace(/"([^"\\\n]*)"[ \t]+"([^"\\\n]*)"/g, '"$1$2"');

    // C also allows IDENTIFIER + string-literal adjacency, where the
    // identifier resolves to a string literal via #define (e.g.
    // LV_SYMBOL_PLAY " START"). In JS we need `+` between them.
    // Identifier first, then string:
    s = s.replace(/\b([A-Z_][A-Z0-9_]*)\s+"([^"\\\n]*)"/g, '$1 + "$2"');
    // String first, then identifier:
    s = s.replace(/"([^"\\\n]*)"\s+([A-Z_][A-Z0-9_]*)\b/g, '"$1" + $2');

    // NULL / nullptr
    s = s.replace(/\bNULL\b/g, "null");
    s = s.replace(/\bnullptr\b/g, "null");

    // true/false are JS-compatible.

    // pdTRUE / pdFALSE / pdMS_TO_TICKS
    s = s.replace(/\bpdTRUE\b/g, "true");
    s = s.replace(/\bpdFALSE\b/g, "false");
    s = s.replace(/\bpdPASS\b/g, "0");
    s = s.replace(/\bpdMS_TO_TICKS\s*\([^)]*\)/g, "0");

    // PM_SPI_TAKE("...") {  ...  } PM_SPI_GIVE();  →  { ... }
    s = s.replace(/\bPM_SPI_TAKE\s*\([^)]*\)\s*\{/g, "{");
    s = s.replace(/\bPM_SPI_GIVE\s*\(\s*\)\s*;/g, "");

    // Strip ATTRIBUTE annotations
    s = s.replace(/__attribute__\s*\(\([^)]+\)\)/g, "");

    // memcpy/memset/strncpy/strcpy stubs — leave as functions, define
    // them below. snprintf returns formatted string into a buffer var;
    // we model it as buf = sprintf-equivalent. Buffer arg may be a
    // plain identifier OR a member access like `s_files[i].path` —
    // we accept any expression that doesn't contain a comma.
    s = s.replace(
      /snprintf\s*\(\s*([^,]+?)\s*,\s*[^,]+,\s*([\s\S]+?)\)\s*;/g,
      "$1 = __jc_sprintf($2);"
    );
    // Fallback for snprintf where the format string is the third arg but
    // we can't easily split. Just rewrite the head.
    s = s.replace(/\bsnprintf\s*\(\s*[^,]+,[^,]+,/g, "__jc_sprintf(");
    s = s.replace(/\bstrncpy\s*\([^)]+\)\s*;/g, "");
    s = s.replace(/\bstrcpy\s*\([^)]+\)\s*;/g, "");
    s = s.replace(/\bmemcpy\s*\([^)]+\)\s*;/g, "");
    s = s.replace(/\bmemset\s*\([^)]+\)\s*;/g, "");
    s = s.replace(/\bstrcmp\s*\(\s*([^,]+),\s*([^)]+)\)/g, "(($1) === ($2) ? 0 : 1)");
    s = s.replace(/\bstrlen\s*\(\s*([^)]+)\)/g, "(($1) ? ($1).length : 0)");

    // Convert numeric typecasts (cast → no-op)
    s = s.replace(
      /\((?:int|unsigned|char|short|long|float|double|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|size_t|intptr_t|uintptr_t|void\s*\*?|wifi_auth_mode_t)\s*\*?\s*\)/g,
      ""
    );

    // do/while/if all valid JS already. for-loops with `let i = 0` already work.

    // Convert `void _func(void)` empty-arg signatures handled above.

    // Replace lifecycle hook references to functions with their names
    // (in the pm_app_t struct designated initializer).
    //
    //   static const pm_app_t _APP = {
    //       .id           = "calculator",
    //       .display_name = "CALC",
    //       .category     = PM_CAT_TOOLS,
    //       .init         = _init,
    //       .enter        = _enter,
    //       ...
    //   };
    //
    // We rewrite this as:
    //   const _APP = { id: "calculator", ..., init: _init, ... };
    s = s.replace(
      /\b(let|const|var)?\s*pm_app_t\s+(\w+)\s*=\s*\{([\s\S]*?)\};/g,
      (m, _kw, name, body) => {
        const fields = body
          .split(",")
          .map(x => x.trim())
          .filter(Boolean)
          .map(x => {
            const mm = x.match(/^\.(\w+)\s*=\s*(.+)$/);
            return mm ? `${mm[1]}: ${mm[2]}` : "";
          })
          .filter(Boolean)
          .join(", ");
        return `const ${name} = { ${fields} };`;
      }
    );

    // Same for any const pm_app_t after the type-strip pass left "let"
    s = s.replace(
      /\blet\s+(\w+)\s*=\s*\{\s*\.id[\s\S]*?\}\s*;/g,
      (m) => m.replace(/\.(\w+)\s*=/g, "$1:").replace(/let /, "const ")
    );

    // FreeRTOS task creation / semaphore — stubbed
    s = s.replace(/xTaskCreatePinnedToCore\s*\([^;]+\)\s*;/g, "/* xTaskCreatePinnedToCore */");
    s = s.replace(/xTaskCreate\s*\([^;]+\)\s*;/g, "/* xTaskCreate */");
    s = s.replace(/xSemaphoreCreateMutex\s*\(\s*\)/g, "({})");
    s = s.replace(/xSemaphoreTake\s*\([^)]+\)/g, "true");
    s = s.replace(/xSemaphoreGive\s*\([^)]+\)\s*;/g, "");
    s = s.replace(/ulTaskNotifyTake\s*\([^)]+\)/g, "0");
    s = s.replace(/xTaskNotifyGive\s*\([^)]+\)\s*;/g, "");
    s = s.replace(/vTaskDelay\s*\([^)]+\)\s*;/g, "");

    // ESP wifi calls — stubbed in the HAL layer
    s = s.replace(/\besp_wifi_scan_start\s*\(/g, "__jc_wifi_scan_start(");
    s = s.replace(/\besp_wifi_scan_get_ap_num\s*\(/g, "__jc_wifi_scan_get_ap_num(");
    s = s.replace(/\besp_wifi_scan_get_ap_records\s*\(/g, "__jc_wifi_scan_get_ap_records(");
    s = s.replace(/\besp_wifi_clear_ap_list\s*\(\)/g, "0");
    s = s.replace(/\besp_event_handler_register\s*\([^)]+\)/g, "0");
    s = s.replace(/\besp_err_to_name\s*\([^)]+\)/g, "\"ESP_OK\"");

    return s;
  }

  // ─────────────────────────────────────────────────────────────
  //  Load and run an app from C source
  // ─────────────────────────────────────────────────────────────
  load(cSource, appName) {
    this._appName = appName || "app";
    this.stop();      // ensure any prior tick loop is dead
    this._handles.clear();
    this._screens.clear();
    this._activeScreen = null;

    let js;
    try {
      js = this.transpile(cSource);
    } catch (err) {
      this.consoleLog(`Transpile error: ${err.message}`, "err");
      return false;
    }

    // Wrap in a function that runs the transpiled code in its own scope,
    // then calls the discovered pm_app_<name>() accessor and returns its
    // result. We auto-detect the accessor name by regex on the transpiled
    // source — every template ends with `function pm_app_<name>() { ... }`.
    let accessorName = null;
    const accessorMatch = js.match(/function\s+(pm_app_\w+)\s*\(/);
    if (accessorMatch) {
      accessorName = accessorMatch[1];
    }

    // Build the body: transpiled code, then call the accessor (or fall
    // back to scanning for a const ending in _APP).
    const wrapperBody = accessorName
      ? `"use strict";\n${js}\nreturn ${accessorName}();\n`
      : `"use strict";\n${js}\ntry { if (typeof _APP !== "undefined" && _APP && _APP.enter) return _APP; } catch(_) {}\nreturn null;\n`;

    // Build the runtime context: HAL + UI helpers + LVGL + peer + color constants
    const ctx = this._buildContext();
    const argNames = Object.keys(ctx);
    const argVals  = argNames.map(k => ctx[k]);

    let app;
    try {
      const fn = new Function(...argNames, wrapperBody);
      app = fn(...argVals);
    } catch (err) {
      this.consoleLog(`Runtime build error: ${err.message}`, "err");
      console.error("JenCoder transpile/build error", err, js);
      return false;
    }

    if (!app) {
      this.consoleLog("No pm_app_t accessor found in source", "err");
      return false;
    }

    this._app = app;
    this._appLoaded = true;
    this.consoleLog(`Loaded "${app.display_name || app.id || appName}"`, "info");
    return true;
  }

  run() {
    if (!this._appLoaded) {
      this.consoleLog("No app loaded", "err");
      return false;
    }
    const app = this._app;
    if (!app.enter) {
      this.consoleLog("App has no enter() callback", "err");
      return false;
    }

    this.running = true;
    this.startTime = performance.now();
    this._lastTickMs = this.startTime;
    this.frameCount = 0;
    this.fpsLast = this.startTime;

    // Clear viewport, run init then enter
    this.viewport.innerHTML = "";
    try {
      if (app.init) app.init();
      app.enter();
    } catch (err) {
      this.consoleLog(`init/enter error: ${err.message}`, "err");
      this.running = false;
      return false;
    }

    // Start tick loop
    const tickFn = () => {
      if (!this.running) return;
      const now = performance.now();
      const dt = now - this._lastTickMs;
      this._lastTickMs = now;
      this.frameCount++;
      if (now - this.fpsLast >= 1000) {
        this.fpsHook(this.frameCount);
        this.frameCount = 0;
        this.fpsLast = now;
      }
      try {
        if (app.tick) app.tick(dt | 0);
      } catch (err) {
        this.consoleLog(`tick error: ${err.message}`, "err");
        this.running = false;
        return;
      }
      this._tickTimer = requestAnimationFrame(tickFn);
    };
    this._tickTimer = requestAnimationFrame(tickFn);
    return true;
  }

  stop() {
    if (this._tickTimer) cancelAnimationFrame(this._tickTimer);
    this._tickTimer = null;
    if (this.running && this._app && this._app.exit) {
      try { this._app.exit(); } catch (e) {}
    }
    this.running = false;
    this._showIdle();
    this.stoppedHook();
  }

  // ─────────────────────────────────────────────────────────────
  //  Build the runtime context object (function name → impl).
  //  This is what gets injected when running the transpiled code.
  // ─────────────────────────────────────────────────────────────
  _buildContext() {
    const ctx = {};
    const emu = this;
    const hal = window.jcHal;

    // pm_ui_*
    const uiFns = [
      "pm_ui_screen","pm_ui_titlebar","pm_ui_card","pm_ui_button",
      "pm_ui_chip","pm_ui_kv_row","pm_ui_status_dot","pm_ui_list",
      "pm_ui_meter_bar","pm_ui_keypad","pm_ui_log_panel","pm_ui_log_append",
      "pm_ui_log_clear","pm_ui_log_obj","pm_ui_grid","pm_ui_default_screen",
      "pm_ui_default_screen_set_status","pm_ui_keyboard_create","pm_ui_keyboard_attach",
      "pm_ui_keyboard_show","pm_ui_keyboard_hide","pm_ui_keyboard_obj",
      "pm_ui_gamepad_create","pm_ui_gamepad_show","pm_ui_gamepad_hide","pm_ui_gamepad_obj",
      "pm_ui_theme_init",
    ];
    for (const n of uiFns) ctx[n] = (...a) => emu[n](...a);

    // Real P4 API names `pm_ui_log_create` (we internally call it
    // pm_ui_log_panel). Expose both.
    ctx.pm_ui_log_create = (...a) => emu.pm_ui_log_panel(...a);

    // lv_*
    const lvFns = [
      "lv_obj_create","lv_obj_delete","lv_obj_remove_style_all",
      "lv_obj_set_width","lv_obj_set_height","lv_obj_set_size",
      "lv_obj_set_pos","lv_obj_center","lv_obj_align",
      "lv_obj_set_style_bg_color","lv_obj_set_style_bg_opa",
      "lv_obj_set_style_text_color","lv_obj_set_style_text_font",
      "lv_obj_set_style_text_align","lv_obj_set_style_text_letter_space",
      "lv_obj_set_style_border_color","lv_obj_set_style_border_width",
      "lv_obj_set_style_border_side","lv_obj_set_style_border_opa",
      "lv_obj_set_style_radius","lv_obj_set_style_pad_all",
      "lv_obj_set_style_pad_hor","lv_obj_set_style_pad_ver",
      "lv_obj_set_style_pad_top","lv_obj_set_style_pad_bottom",
      "lv_obj_set_style_pad_left","lv_obj_set_style_pad_right",
      "lv_obj_set_style_pad_gap","lv_obj_set_style_pad_column",
      "lv_obj_set_style_pad_row",
      "lv_obj_set_layout","lv_obj_set_flex_flow","lv_obj_set_flex_align",
      "lv_obj_set_flex_grow","lv_obj_set_scroll_dir",
      "lv_obj_add_flag","lv_obj_remove_flag","lv_obj_clear_flag",
      "lv_obj_get_child","lv_obj_get_child_count",
      "lv_label_create","lv_label_set_text","lv_label_set_long_mode",
      "lv_btn_create","lv_obj_add_event_cb",
      "lv_event_get_user_data","lv_event_get_target","lv_event_get_code",
      "lv_textarea_create","lv_textarea_set_text","lv_textarea_get_text",
      "lv_textarea_set_placeholder_text","lv_textarea_set_one_line",
      "lv_textarea_set_password_mode","lv_textarea_add_char","lv_textarea_del_char",
      "lv_bar_create","lv_bar_set_value","lv_bar_set_range",
      "lv_screen_load","lvgl_port_lock","lvgl_port_unlock",
    ];
    for (const n of lvFns) ctx[n] = (...a) => emu[n](...a);

    ctx.LV_PCT          = (n) => emu.LV_PCT(n);
    ctx.LV_SIZE_CONTENT = emu.LV_SIZE_CONTENT();
    ctx.lv_color_hex    = hal.lv_color_hex.bind(hal);
    ctx.lv_color_white  = hal.lv_color_white.bind(hal);
    ctx.lv_color_black  = hal.lv_color_black.bind(hal);
    ctx.lv_color_to_u32 = hal.lv_color_to_u32.bind(hal);

    // LVGL fonts: simple objects with a _size field. Apps pass these
    // around as `&lv_font_montserrat_14` etc — pre-stripped of the &.
    const mkFont = (sz) => ({ _size: sz, _font: true });
    ctx.lv_font_montserrat_10 = mkFont(10);
    ctx.lv_font_montserrat_12 = mkFont(12);
    ctx.lv_font_montserrat_14 = mkFont(14);
    ctx.lv_font_montserrat_16 = mkFont(16);
    ctx.lv_font_montserrat_20 = mkFont(20);
    ctx.lv_font_montserrat_24 = mkFont(24);
    ctx.lv_font_montserrat_28 = mkFont(28);
    ctx.lv_font_montserrat_32 = mkFont(32);
    ctx.lv_font_montserrat_48 = mkFont(48);

    // LVGL enums
    const enums = {
      // align
      LV_ALIGN_CENTER:"LV_ALIGN_CENTER",LV_ALIGN_TOP_LEFT:"LV_ALIGN_TOP_LEFT",
      LV_ALIGN_LEFT_MID:"LV_ALIGN_LEFT_MID",LV_ALIGN_RIGHT_MID:"LV_ALIGN_RIGHT_MID",
      LV_ALIGN_BOTTOM_MID:"LV_ALIGN_BOTTOM_MID",
      // flex
      LV_LAYOUT_FLEX:"LV_LAYOUT_FLEX",LV_LAYOUT_GRID:"LV_LAYOUT_GRID",
      LV_FLEX_FLOW_ROW:"LV_FLEX_FLOW_ROW",LV_FLEX_FLOW_COLUMN:"LV_FLEX_FLOW_COLUMN",
      LV_FLEX_FLOW_ROW_WRAP:"LV_FLEX_FLOW_ROW_WRAP",LV_FLEX_FLOW_COLUMN_WRAP:"LV_FLEX_FLOW_COLUMN_WRAP",
      LV_FLEX_ALIGN_START:"LV_FLEX_ALIGN_START",LV_FLEX_ALIGN_CENTER:"LV_FLEX_ALIGN_CENTER",
      LV_FLEX_ALIGN_END:"LV_FLEX_ALIGN_END",LV_FLEX_ALIGN_SPACE_AROUND:"LV_FLEX_ALIGN_SPACE_AROUND",
      LV_FLEX_ALIGN_SPACE_BETWEEN:"LV_FLEX_ALIGN_SPACE_BETWEEN",LV_FLEX_ALIGN_SPACE_EVENLY:"LV_FLEX_ALIGN_SPACE_EVENLY",
      // text
      LV_TEXT_ALIGN_LEFT:"LV_TEXT_ALIGN_LEFT",LV_TEXT_ALIGN_CENTER:"LV_TEXT_ALIGN_CENTER",
      LV_TEXT_ALIGN_RIGHT:"LV_TEXT_ALIGN_RIGHT",
      LV_LABEL_LONG_CLIP:"LV_LABEL_LONG_CLIP",LV_LABEL_LONG_SCROLL:"LV_LABEL_LONG_SCROLL",
      LV_LABEL_LONG_WRAP:"LV_LABEL_LONG_WRAP",LV_LABEL_LONG_DOT:"LV_LABEL_LONG_DOT",
      LV_LABEL_LONG_SCROLL_CIRCULAR:"LV_LABEL_LONG_SCROLL_CIRCULAR",
      // border
      LV_BORDER_SIDE_NONE:0,LV_BORDER_SIDE_TOP:1,LV_BORDER_SIDE_BOTTOM:2,
      LV_BORDER_SIDE_LEFT:4,LV_BORDER_SIDE_RIGHT:8,LV_BORDER_SIDE_FULL:15,
      // opa
      LV_OPA_COVER:100,LV_OPA_TRANSP:0,
      // direction
      LV_DIR_HOR:1,LV_DIR_VER:2,LV_DIR_ALL:3,
      // event
      LV_EVENT_CLICKED:1,LV_EVENT_PRESSED:2,LV_EVENT_RELEASED:3,
      LV_EVENT_VALUE_CHANGED:5,
      // state
      LV_STATE_DEFAULT:0,LV_STATE_PRESSED:0x0001,LV_STATE_FOCUSED:0x0002,
      // radius
      LV_RADIUS_CIRCLE:0x7FFF,
      // flag
      LV_OBJ_FLAG_HIDDEN:"LV_OBJ_FLAG_HIDDEN",
      LV_OBJ_FLAG_CLICKABLE:"LV_OBJ_FLAG_CLICKABLE",
      LV_OBJ_FLAG_SCROLLABLE:"LV_OBJ_FLAG_SCROLLABLE",
    };
    Object.assign(ctx, enums);

    // PM_* color constants
    Object.assign(ctx, window.PM_COLORS);

    // LV_SYMBOL_*
    Object.assign(ctx, window.LV_SYMBOLS);

    // pm_app_t categories
    ctx.PM_CAT_COMMS  = 0;
    ctx.PM_CAT_CYBER  = 1;
    ctx.PM_CAT_TOOLS  = 2;
    ctx.PM_CAT_GAMES  = 3;
    ctx.PM_CAT_INTEL  = 4;
    ctx.PM_CAT_MEDIA  = 5;
    ctx.PM_CAT_SYSTEM = 6;
    ctx.PM_CAT_COUNT  = 7;

    // pm_hal
    const halFns = [
      "pm_millis","pm_micros","pm_delay_ms","pm_delay_us",
      "pm_uptime_seconds","pm_time_now",
      "pm_log_i","pm_log_w","pm_log_e","pm_log_d",
      "pm_psram_alloc","pm_psram_calloc","pm_psram_realloc","pm_psram_free",
      "pm_psram_free_bytes","pm_psram_largest_free_block",
      "pm_sram_alloc","pm_sram_free","pm_free_heap",
      "pm_chip_info","pm_chip_mac_lower32",
      "pm_mutex_create","pm_mutex_destroy","pm_mutex_take","pm_mutex_give",
      "pm_random_u32","pm_random_range",
      "pm_crc32","pm_crc32_update",
      "pm_sd_mounted","pm_sd_mount","pm_sd_unmount",
      "pm_file_exists","pm_file_open","pm_file_close","pm_file_read",
      "pm_file_write","pm_file_printf","pm_file_seek","pm_file_tell",
      "pm_file_size","pm_file_eof","pm_file_flush","pm_file_mkdir",
      "pm_file_remove","pm_file_rename",
      "pm_dir_open","pm_dir_next","pm_dir_close",
      "pm_gpio_mode","pm_gpio_read","pm_gpio_write",
      "pm_hal_spi_sck_pin","pm_hal_spi_miso_pin","pm_hal_spi_mosi_pin",
      "pm_hal_init","pm_reboot",
    ];
    for (const n of halFns) ctx[n] = (...a) => hal[n](...a);

    // Real P4 firmware exposes pm_chip_info as `void pm_chip_info(pm_chip_info_t* out);`
    // — apps pass an out-param. JS HAL returns a fresh object. Bridge both
    // styles: if called with an arg, copy fields onto it AND return it.
    ctx.pm_chip_info = (out) => {
      const info = hal.pm_chip_info();
      if (out && typeof out === "object") Object.assign(out, info);
      return info;
    };

    // Same for pm_gps_state_get — overrides the basic peer-level binding
    // (which only assigns IF the out is an object). Make sure assigning
    // to a `let info;` declared as undefined works by returning the fix.
    const origGpsGet = ctx.pm_gps_state_get;
    ctx.pm_gps_state_get = (out) => {
      const g = window.jcPeer ? window.jcPeer.getGpsFix() : null;
      if (out && typeof out === "object") Object.assign(out, g);
      return g;
    };

    // pm_peer_* — exported by jencoder_peer.js
    ctx.pm_peer_init_auto    = (...a) => window.pm_peer_init_auto(...a);
    ctx.pm_peer_find         = (...a) => window.pm_peer_find(...a);
    ctx.pm_peer_release      = (...a) => window.pm_peer_release(...a);
    ctx.pm_peer_call         = (...a) => window.pm_peer_call(...a);
    ctx.pm_peer_count        = (...a) => window.pm_peer_count(...a);
    ctx.pm_peer_at           = (...a) => window.pm_peer_at(...a);
    ctx.pm_peer_kind         = (...a) => window.pm_peer_kind(...a);
    ctx.pm_peer_name         = (...a) => window.pm_peer_name(...a);
    ctx.pm_peer_capabilities = (...a) => window.pm_peer_capabilities(...a);
    ctx.pm_gps_state_get     = (out) => {
      const g = window.jcPeer.getGpsFix();
      if (out) Object.assign(out, g);
      return g;
    };
    // PM_PEER_*
    Object.assign(ctx, window.PM_PEER_ROLE && {
      PM_PEER_ROLE_ANY:       0,
      PM_PEER_ROLE_PRIMARY:   1,
      PM_PEER_ROLE_SECONDARY: 2,
      PM_PEER_ROLE_EXCLUSIVE: 3,
    });
    Object.assign(ctx, {
      PM_PEER_KIND_C6_GHOST:    0,
      PM_PEER_KIND_TBEAM_S3:    1,
      PM_PEER_KIND_SLOT_SX1262: 2,
      PM_PEER_KIND_SLOT_NRF24:  3,
      PM_PEER_KIND_SLOT_H2:     4,
      PM_PEER_KIND_SLOT_C6:     5,
      PM_PEER_KIND_SLOT_HALOW:  6,
      PM_PEER_KIND_NFC_PN532:   7,
      PM_PEER_KIND_CAMERA_CSI:  8,
      PM_PEER_KIND_BT_GAMEPAD:  9,
      PM_PEER_KIND_BT_KEYBOARD: 10,
      PM_PEER_KIND_CARDPUTER_I2C: 11,
    });

    // pm_nosql_* — light wrapper around hal VFS under /sd/data
    ctx.pm_nosql_init = (cat) => {
      hal.pm_file_mkdir(`/sd/data/${cat}`);
      return true;
    };
    ctx.pm_nosql_list = (cat) => {
      const d = hal.pm_dir_open(`/sd/data/${cat}`);
      const out = [];
      let n;
      while ((n = hal.pm_dir_next(d)) != null) out.push(n);
      hal.pm_dir_close(d);
      return out.length;
    };
    ctx.pm_nosql_read   = (cat, id) => {
      const f = hal.pm_file_open(`/sd/data/${cat}/${id}.json`, 1);
      if (!f) return 0;
      const sz = hal.pm_file_size(f);
      hal.pm_file_close(f);
      return sz;
    };
    ctx.pm_nosql_write  = (cat, id, json, len) => {
      const f = hal.pm_file_open(`/sd/data/${cat}/${id}.json`, 2 | 8 | 16);
      if (!f) return false;
      hal.pm_file_write(f, json, len || (json && json.length) || 0);
      hal.pm_file_close(f);
      return true;
    };
    ctx.pm_nosql_append = ctx.pm_nosql_write;
    ctx.pm_nosql_delete = (cat, id) => hal.pm_file_remove(`/sd/data/${cat}/${id}.json`);
    ctx.pm_nosql_exists = (cat, id) => hal.pm_file_exists(`/sd/data/${cat}/${id}.json`);
    ctx.pm_nosql_path   = (cat, id, out, cap) => `/sd/data/${cat}/${id}.json`;

    // pm_sqlite_* — preview stubs (writes a metadata-only stub)
    ctx.pm_db_open       = (path) => ({ _path: path, _rows: [] });
    ctx.pm_db_close      = (db) => {};
    ctx.pm_db_apply_schema = (db, sql) => true;
    ctx.pm_db_exec       = (db, sql) => true;
    ctx.pm_db_prepare    = (db, sql) => ({ _sql: sql, _params: [] });
    ctx.pm_db_export_csv = (db, sql, path) => 0;
    ctx.pm_db_last_error = (db) => "";
    ctx.pm_stmt_bind_text   = (st, idx, t) => {};
    ctx.pm_stmt_bind_int    = (st, idx, v) => {};
    ctx.pm_stmt_bind_int64  = (st, idx, v) => {};
    ctx.pm_stmt_bind_double = (st, idx, v) => {};
    ctx.pm_stmt_step        = (st) => false;
    ctx.pm_stmt_col_int     = (st, idx) => 0;
    ctx.pm_stmt_col_text    = (st, idx) => "";
    ctx.pm_stmt_finalize    = (st) => {};

    // pm_input — convenience accessors used by some apps
    ctx.pm_input_get_touch = () => emu._inputState.touch;
    ctx.pm_input_get_dpad  = () => emu._inputState.dpad;
    ctx.pm_input_get_key   = () => {
      const q = emu._inputState.keyboard;
      return q.length > 0 ? q.shift() : 0;
    };

    // String helpers / format helper
    ctx.__jc_sprintf = (fmt, ...args) => hal._fmt(fmt, args);

    // Math helpers Arduino-style
    ctx.min = Math.min;
    ctx.max = Math.max;
    ctx.abs = Math.abs;

    // WiFi mocks (used by wardrive)
    ctx.__jc_wifi_scan_start         = () => 0;
    ctx.__jc_wifi_scan_get_ap_num    = () => 0;
    ctx.__jc_wifi_scan_get_ap_records= () => 0;

    // ESP_OK
    ctx.ESP_OK = 0;

    // Firmware constants exposed by pm_hal.h
    ctx.PM_VERSION_STRING = "2.0.0-p4-dev";
    ctx.PM_VERSION_MAJOR  = 2;
    ctx.PM_VERSION_MINOR  = 0;
    ctx.PM_VERSION_PATCH  = 0;

    // pm_file_mode_t enum values
    ctx.PM_FILE_READ   = 1;
    ctx.PM_FILE_WRITE  = 2;
    ctx.PM_FILE_APPEND = 4;
    ctx.PM_FILE_CREATE = 8;
    ctx.PM_FILE_TRUNC  = 16;

    // ── Mock helpers exposed to templates ────────────────────
    // Templates call these via `extern` declarations because they
    // emulate things the real firmware does through peers.
    // In production, the real peer fills the buffer; here we
    // synthesize directly from jcPeer's mock state.
    const peer = window.jcPeer;

    ctx.__jc_mock_nfc_fill = (out) => {
      const tag = peer ? peer.getNfcTag() : null;
      if (!out || typeof out !== "object") return;
      if (!tag || !tag.valid) {
        out.valid = false;
        out.uid_len = 0;
        out.ndef_text = "";
        return;
      }
      out.valid = true;
      out.uid_len = tag.uid_len;
      out.uid = tag.uid;
      out.ndef_text = tag.ndef_text;
    };

    ctx.__jc_mock_wifi_count = () => peer ? peer.getWifiCount() : 0;
    ctx.__jc_mock_wifi_list_len = () => peer ? peer.getWifiCount() : 0;
    ctx.__jc_mock_wifi_ssid  = (i) => { const a = peer && peer.getWifiAp(i); return a ? a.ssid  : ""; };
    ctx.__jc_mock_wifi_bssid = (i) => { const a = peer && peer.getWifiAp(i); return a ? a.bssid : ""; };
    ctx.__jc_mock_wifi_rssi  = (i) => { const a = peer && peer.getWifiAp(i); return a ? a.rssi  : 0;  };
    ctx.__jc_mock_wifi_ch    = (i) => { const a = peer && peer.getWifiAp(i); return a ? a.ch    : 0;  };

    ctx.__jc_mock_ble_count   = () => peer ? peer.getBleCount() : 0;
    ctx.__jc_mock_ble_list_len = () => peer ? peer.getBleCount() : 0;
    ctx.__jc_mock_ble_name = (i) => { const d = peer && peer.getBleDev(i); return d ? d.name : ""; };
    ctx.__jc_mock_ble_mac  = (i) => { const d = peer && peer.getBleDev(i); return d ? d.mac  : ""; };
    ctx.__jc_mock_ble_rssi = (i) => { const d = peer && peer.getBleDev(i); return d ? d.rssi : 0;  };

    ctx.__jc_mock_gemini_reply = (prompt) => {
      return peer ? peer.geminiReply(prompt)
        : "Gemini peer unavailable — connect a C6 with HTTP proxy or set GEMINI_API_KEY in include/secrets.h.";
    };

    return ctx;
  }
}

if (typeof window !== "undefined") {
  window.PiscesP4Emulator = PiscesP4Emulator;
}
