// Pisces Moon OS — JenCoder Web Edition
// Copyright (C) 2026 Eric Becker / Fluid Fortune
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// ide.js — IDE orchestration
//
// Wires together everything:
//   - Monaco editor with a custom Pisces-Moon C language config
//   - Template modal pulling from JENCODER_TEMPLATES
//   - API reference sidebar with search/filter
//   - Live preview viewport scaled to fit the right pane
//   - Build & Flash modal + Export ZIP
//   - Console output + FPS/PSRAM/heap stats
//   - App metadata (id, display, category) parsed from source

(function() {
  // ─────────────────────────────────────────────────────────────
  //  Globals
  // ─────────────────────────────────────────────────────────────
  let editor       = null;
  let emulator     = null;
  let builder      = null;
  let currentSource = "";
  let currentFile   = "pm_app_myapp.c";

  // ─────────────────────────────────────────────────────────────
  //  Logging — IDE console panel
  // ─────────────────────────────────────────────────────────────
  function consoleLog(msg, type) {
    const c = document.getElementById("console");
    if (!c) return;
    const line = document.createElement("div");
    line.className = "log-" + (type || "info");
    const ts = new Date().toLocaleTimeString();
    line.textContent = `[${ts}] ${msg}`;
    c.appendChild(line);
    c.scrollTop = c.scrollHeight;
    while (c.children.length > 400) c.removeChild(c.firstChild);
  }

  function buildConsoleLog(msg, type) {
    const c = document.getElementById("build-console");
    if (!c) return;
    const line = document.createElement("div");
    line.className = "log-" + (type || "info");
    line.textContent = msg;
    c.appendChild(line);
    c.scrollTop = c.scrollHeight;
    consoleLog(msg, type);
  }

  // ─────────────────────────────────────────────────────────────
  //  Status bar
  // ─────────────────────────────────────────────────────────────
  function setStatus(msg) {
    const el = document.getElementById("status-msg");
    if (el) el.textContent = msg;
  }

  // ─────────────────────────────────────────────────────────────
  //  Monaco editor
  // ─────────────────────────────────────────────────────────────
  function initMonaco() {
    require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs" } });
    require(["vs/editor/editor.main"], function() {

      // Define a Pisces-Moon C theme
      monaco.editor.defineTheme("pisces-moon", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment",                foreground: "8FA8C2", fontStyle: "italic" },
          { token: "keyword",                foreground: "B4A0FF" },
          { token: "string",                 foreground: "4ADE80" },
          { token: "number",                 foreground: "FBBF24" },
          { token: "identifier",             foreground: "E6F0FA" },
          { token: "type.identifier",        foreground: "4FD1C5" },
          { token: "type",                   foreground: "4FD1C5" },
          { token: "delimiter",              foreground: "8FA8C2" },
          { token: "function",               foreground: "4FD1C5" },
        ],
        colors: {
          "editor.background":              "#050D17",
          "editor.foreground":              "#E6F0FA",
          "editor.lineHighlightBackground": "#0F1F33",
          "editorLineNumber.foreground":    "#3A5A7C",
          "editorLineNumber.activeForeground": "#4FD1C5",
          "editorCursor.foreground":        "#4FD1C5",
          "editor.selectionBackground":     "#1A3A5C",
          "editorIndentGuide.background":   "#2A4A6C",
        }
      });

      // Pisces Moon C language tokens — boost highlight for pm_* identifiers
      monaco.languages.setLanguageConfiguration("c", {
        comments: { lineComment: "//", blockComment: ["/*","*/"] },
        brackets: [["{","}"],["[","]"],["(",")"]],
        autoClosingPairs: [
          { open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" },
          { open: "\"", close: "\"" }
        ]
      });

      editor = monaco.editor.create(document.getElementById("editor"), {
        value: currentSource,
        language: "c",
        theme: "pisces-moon",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        lineNumbers: "on",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        insertSpaces: true,
        wordWrap: "off",
        renderLineHighlight: "line",
      });

      editor.onDidChangeCursorPosition((e) => {
        const el = document.getElementById("status-line");
        if (el) el.textContent = `Line ${e.position.lineNumber}, Col ${e.position.column}`;
      });

      editor.onDidChangeModelContent(() => {
        currentSource = editor.getValue();
        refreshAppMeta();
      });

      // Register completion provider for the pm_* API
      monaco.languages.registerCompletionItemProvider("c", {
        provideCompletionItems: () => {
          const items = (window.PISCES_P4_API_FLAT || []).map((it) => ({
            label: it.name.replace(/\(.*$/, ""),
            kind:  monaco.languages.CompletionItemKind.Function,
            insertText: it.name.replace(/\(.*$/, ""),
            detail: it.category,
            documentation: it.desc,
          }));
          return { suggestions: items };
        }
      });

      consoleLog("Editor ready", "info");
      refreshAppMeta();
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  App metadata (sidebar)
  // ─────────────────────────────────────────────────────────────
  function refreshAppMeta() {
    if (!builder) return;
    const meta = builder.parseAppMetadata(currentSource);
    document.getElementById("meta-id").textContent       = meta.app_id;
    document.getElementById("meta-display").textContent  = meta.display_name;
    document.getElementById("meta-category").textContent = meta.category;

    // Update file name + tab
    currentFile = `pm_app_${meta.app_name}.c`;
    document.getElementById("file-name").textContent = currentFile;
    document.getElementById("active-tab").textContent = currentFile;
  }

  // ─────────────────────────────────────────────────────────────
  //  Template modal
  // ─────────────────────────────────────────────────────────────
  function initTemplateModal() {
    const grid  = document.getElementById("template-grid");
    const modal = document.getElementById("modal-template");
    if (!grid || !modal) return;

    grid.innerHTML = "";
    const templates = window.JENCODER_TEMPLATES || {};
    for (const key of Object.keys(templates)) {
      const t = templates[key];
      const card = document.createElement("div");
      card.className = "template-card";
      card.innerHTML = `
        <div class="tpl-cat">${t.category}</div>
        <div class="tpl-name">${t.name}</div>
        <div class="tpl-desc">${t.desc}</div>
      `;
      card.addEventListener("click", () => {
        loadSource(t.code);
        modal.style.display = "none";
        consoleLog(`Loaded template: ${t.name}`, "info");
      });
      grid.appendChild(card);
    }
  }

  function loadSource(src) {
    currentSource = src;
    if (editor) editor.setValue(src);
    refreshAppMeta();
  }

  // ─────────────────────────────────────────────────────────────
  //  API reference sidebar
  // ─────────────────────────────────────────────────────────────
  function initApiTree() {
    const root = document.getElementById("api-tree");
    if (!root) return;
    const api = window.PISCES_P4_API || {};

    function render(filter) {
      root.innerHTML = "";
      const f = (filter || "").toLowerCase().trim();
      for (const [cat, items] of Object.entries(api)) {
        const filtered = items.filter((it) =>
          !f || it.name.toLowerCase().includes(f) || it.desc.toLowerCase().includes(f)
        );
        if (filtered.length === 0) continue;
        const h = document.createElement("div");
        h.className = "api-category";
        h.textContent = cat;
        root.appendChild(h);
        for (const it of filtered) {
          const e = document.createElement("div");
          e.className = "api-entry";
          e.innerHTML = `<div>${it.name}</div><div class="api-entry-desc">${it.desc}</div>`;
          e.title = it.desc;
          e.addEventListener("click", () => {
            if (editor) {
              const insert = it.name.replace(/\(.*$/, "");
              const sel = editor.getSelection();
              editor.executeEdits("api-insert", [{
                range: sel,
                text:  insert,
                forceMoveMarkers: true,
              }]);
              editor.focus();
            }
          });
          root.appendChild(e);
        }
      }
    }

    render("");

    const search = document.getElementById("api-filter");
    if (search) {
      search.addEventListener("input", (e) => render(e.target.value));
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Preview viewport — scale 1024×600 to fit pane
  // ─────────────────────────────────────────────────────────────
  function setupViewportScale() {
    const wrap = document.querySelector(".preview-viewport");
    const vp   = document.getElementById("preview-viewport");
    if (!wrap || !vp) return;

    const fit = () => {
      const r = wrap.getBoundingClientRect();
      const sx = r.width  / 1024;
      const sy = r.height / 600;
      const s = Math.min(sx, sy);
      vp.style.transform = `scale(${s})`;
      vp.style.transformOrigin = "top left";
      vp.style.width  = "1024px";
      vp.style.height = "600px";
    };
    fit();
    window.addEventListener("resize", fit);
    new ResizeObserver(fit).observe(wrap);
  }

  // ─────────────────────────────────────────────────────────────
  //  Emulator hookup
  // ─────────────────────────────────────────────────────────────
  function initEmulator() {
    const viewport = document.getElementById("preview-viewport");
    emulator = new PiscesP4Emulator(viewport);
    emulator.consoleLog = consoleLog;
    emulator.fpsHook    = (fps) => {
      const el = document.getElementById("hw-fps");
      if (el) el.textContent = String(fps);
    };
    emulator.stoppedHook = () => {
      document.getElementById("btn-run").style.display  = "inline-block";
      document.getElementById("btn-stop").style.display = "none";
      setStatus("Stopped");
    };

    // Wire HAL console hook
    if (window.jcHal) {
      window.jcHal.consoleLog = (msg, type) => consoleLog(msg, type || "info");
    }

    // Initialize peer registry (registers C6 + GPS + NFC etc. mocks)
    if (window.pm_peer_init_auto) {
      const n = window.pm_peer_init_auto();
      consoleLog(`Peer registry initialized (${n} peers)`, "info");
    }

    setupViewportScale();
    refreshHardwareStats();
    setInterval(refreshHardwareStats, 1000);
  }

  function refreshHardwareStats() {
    if (!window.jcHal) return;
    const fmtBytes = (b) => {
      if (b >= 1024 * 1024) return (b / 1048576).toFixed(1) + " MB";
      if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
      return b + " B";
    };
    const ps = window.jcHal.pm_psram_free_bytes
      ? window.jcHal.pm_psram_free_bytes() : 20 * 1024 * 1024;
    const heap = window.jcHal.pm_free_heap
      ? window.jcHal.pm_free_heap() : 280 * 1024;
    document.getElementById("hw-psram").textContent = fmtBytes(ps);
    document.getElementById("hw-heap").textContent  = fmtBytes(heap);
  }

  // ─────────────────────────────────────────────────────────────
  //  Run / Stop preview
  // ─────────────────────────────────────────────────────────────
  function runPreview() {
    if (!emulator) return;
    if (!currentSource || currentSource.length < 50) {
      consoleLog("No source to run — load a template or write your app first", "warn");
      return;
    }
    const meta = builder.parseAppMetadata(currentSource);
    setStatus(`Loading ${meta.app_name}...`);
    if (!emulator.load(currentSource, meta.app_name)) {
      setStatus("Load failed");
      return;
    }
    if (!emulator.run()) {
      setStatus("Run failed");
      return;
    }
    document.getElementById("btn-run").style.display  = "none";
    document.getElementById("btn-stop").style.display = "inline-block";
    setStatus(`Running ${meta.display_name}`);
  }

  function stopPreview() {
    if (!emulator) return;
    emulator.stop();
  }

  // ─────────────────────────────────────────────────────────────
  //  Build & Flash modal
  // ─────────────────────────────────────────────────────────────
  function initBuilder() {
    builder = new JenCoderBuilder();
    builder.consoleLog = buildConsoleLog;
    builder.statusHook = (state, msg) => {
      const el = document.getElementById("build-msg");
      if (el) el.textContent = msg;
    };
    builder.progressHook = (pct) => {
      const fill = document.getElementById("build-progress");
      if (fill) fill.style.width = pct + "%";
    };
    builder.stageHook = (stage, status) => {
      const el = document.getElementById("stage-" + stage);
      if (!el) return;
      el.classList.remove("active", "done", "err");
      if (status === "active") {
        el.classList.add("active");
        el.querySelector(".stage-icon").textContent = "◌";
      } else if (status === "done") {
        el.classList.add("done");
        el.querySelector(".stage-icon").textContent = "✓";
      } else if (status === "err") {
        el.classList.add("err");
        el.querySelector(".stage-icon").textContent = "✕";
      } else {
        el.querySelector(".stage-icon").textContent = "○";
      }
    };
  }

  function openBuildModal() {
    document.getElementById("modal-build").style.display = "flex";
    document.getElementById("build-console").innerHTML = "";
    builder.progressHook(0);
    builder.statusHook(null, "Ready");
    for (const s of ["compile","connect","flash","run"]) {
      builder.stageHook(s, "pending");
    }
  }

  function startBuildFlash() {
    builder.useLocalBackend = document.getElementById("opt-local-backend").checked;
    builder.buildAndFlash(currentSource);
  }

  // ─────────────────────────────────────────────────────────────
  //  Wire buttons
  // ─────────────────────────────────────────────────────────────
  function wireButtons() {
    document.getElementById("btn-new").addEventListener("click", () => {
      if (window.JENCODER_TEMPLATES && window.JENCODER_TEMPLATES.basic_app) {
        loadSource(window.JENCODER_TEMPLATES.basic_app.code);
        consoleLog("New app from Basic template", "info");
      }
    });

    document.getElementById("btn-template").addEventListener("click", () => {
      document.getElementById("modal-template").style.display = "flex";
    });

    document.getElementById("btn-run").addEventListener("click",  runPreview);
    document.getElementById("btn-stop").addEventListener("click", stopPreview);

    document.getElementById("btn-build").addEventListener("click", openBuildModal);
    document.getElementById("btn-build-start").addEventListener("click", startBuildFlash);
    document.getElementById("btn-build-cancel").addEventListener("click", () => {
      document.getElementById("modal-build").style.display = "none";
    });

    document.getElementById("btn-export").addEventListener("click", async () => {
      const meta = builder.parseAppMetadata(currentSource);
      try {
        await builder.export(currentSource, meta);
      } catch (err) {
        consoleLog(`Export failed: ${err.message}`, "err");
      }
    });

    document.getElementById("btn-copy").addEventListener("click", () => {
      builder.copyToClipboard(currentSource);
    });

    document.getElementById("btn-help").addEventListener("click", () => {
      document.getElementById("modal-help").style.display = "flex";
    });

    // Close modals on backdrop click
    for (const id of ["modal-help","modal-template","modal-build"]) {
      const m = document.getElementById(id);
      if (!m) continue;
      m.addEventListener("click", (e) => {
        if (e.target === m) m.style.display = "none";
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Boot sequence
  // ─────────────────────────────────────────────────────────────
  function boot() {
    consoleLog("JenCoder Web Edition v1.0 \"Origin\" booting...", "info");

    initBuilder();
    initApiTree();
    initTemplateModal();
    initEmulator();
    wireButtons();

    // Start with the Basic App template
    if (window.JENCODER_TEMPLATES && window.JENCODER_TEMPLATES.basic_app) {
      currentSource = window.JENCODER_TEMPLATES.basic_app.code;
    }

    initMonaco();
    consoleLog("Ready. Click ▶ Run Preview to launch the loaded app.", "info");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
