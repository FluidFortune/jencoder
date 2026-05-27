// Pisces Moon OS — JenCoder Build Backend
// Copyright (C) 2026 Eric Becker / Fluid Fortune
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// fluidfortune.com
//
// Cloud compile service for JenCoder Web Edition.
// Receives C source via POST, runs idf.py build for esp32p4,
// returns compiled binary as base64.
//
// DEPLOYMENT:
//   This is designed for a long-running Linux host with ESP-IDF v5.5.3
//   pre-installed. NOT suitable for serverless (Vercel/Netlify functions)
//   because ESP-IDF builds take 30-90 seconds. Recommended:
//     - Fly.io (machines run only when needed, sleep when idle)
//     - Railway.app (similar)
//     - Self-hosted VPS (DigitalOcean, Hetzner, etc.)
//     - Docker container behind your own reverse proxy
//
// SETUP (manual):
//   1. Install Node 20+, Python 3.10+, ESP-IDF v5.5.3:
//        git clone -b v5.5.3 https://github.com/espressif/esp-idf.git ~/esp/esp-idf
//        ~/esp/esp-idf/install.sh esp32p4
//        . ~/esp/esp-idf/export.sh
//   2. Clone the Pisces Moon P4 firmware tree:
//        git clone https://github.com/FluidFortune/pisces-moon-os-p4 /opt/pisces-moon-p4
//   3. npm install
//   4. PISCES_P4_REPO_PATH=/opt/pisces-moon-p4 IDF_TOOLS_PATH=~/.espressif node server.js
//
// SETUP (Docker):
//   docker build -t jencoder-build .
//   docker run -p 3000:3000 jencoder-build
//
// ENDPOINTS:
//   POST /api/build
//     Body: { source, app_name, app_id, display_name, category,
//             target: "esp32p4", api_version: "1.0" }
//     Response (success):
//       { ok: true, binary: "<base64>", binary_size: N,
//         flash_address: 0x10000, partition: "factory" }
//     Response (failure):
//       { ok: false, errors: ["...", "..."], stage: "compile" }
//
//   GET /api/health
//     Returns service + ESP-IDF version + repo path.

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { execFile, spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { promisify } from "util";

const exec = promisify(execFile);
const app = express();

// ── Config ──────────────────────────────────────────────────
const PORT                = process.env.PORT || 3000;
const PISCES_P4_REPO_PATH = process.env.PISCES_P4_REPO_PATH || "/opt/pisces-moon-p4";
const IDF_PATH            = process.env.IDF_PATH || "/opt/esp-idf";
const MAX_SOURCE_SIZE     = 512 * 1024;     // 512 KB cap on app source
const BUILD_TIMEOUT_MS    = 180 * 1000;     // 3 min per build (P4 is heavier than S3)
const VERSION             = "1.0.0-origin";

// ── Middleware ──────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    "https://jencoder.fluidfortune.com",
    "https://fluidfortune.com",
    "http://localhost:8080",
    "http://localhost:5173",
    "http://localhost:3000",
  ],
}));
app.use(express.json({ limit: "1mb" }));

// Rate limit: 30 builds per IP per hour
const limiter = new RateLimiterMemory({
  points:   30,
  duration: 3600,
});

app.use(async (req, res, next) => {
  if (req.path !== "/api/build") return next();
  try {
    await limiter.consume(req.ip);
    next();
  } catch (rej) {
    res.status(429).json({
      ok: false,
      errors: [`Rate limit exceeded. Try again in ${Math.ceil(rej.msBeforeNext / 1000)}s.`],
    });
  }
});

// ─────────────────────────────────────────────────────────────
//  SOURCE VALIDATION
//  Reject obviously malicious source before spending CPU on compile.
// ─────────────────────────────────────────────────────────────
const FORBIDDEN_PATTERNS = [
  // Block attempts to access host filesystem from build
  "/etc/passwd", "/etc/shadow", "/proc/", "/sys/", "/dev/",
  // Block shell escape attempts in macros / pragma poison
  "#pragma GCC", "__asm__", "asm volatile",
  "system(", "execve(", "fork(", "popen(",
  // Block linker tricks
  "ld_preload", "LD_PRELOAD",
];

function validateSource(src, meta) {
  if (typeof src !== "string") return "Source must be a string";
  if (src.length > MAX_SOURCE_SIZE) return `Source exceeds ${MAX_SOURCE_SIZE} bytes`;
  if (src.length < 100) return "Source too short — please write actual code";

  const lower = src.toLowerCase();
  for (const term of FORBIDDEN_PATTERNS) {
    if (lower.includes(term.toLowerCase())) {
      return `Source contains forbidden pattern: ${term}`;
    }
  }

  // Must contain a pm_app_t literal (the contract)
  if (!/\bpm_app_t\s+\w+\s*=\s*\{/.test(src)) {
    return "Source must contain a pm_app_t struct literal";
  }

  // Must define the accessor function
  if (!/\bconst\s+pm_app_t\s*\*\s*pm_app_\w+\s*\(/.test(src)) {
    return "Source must define const pm_app_t* pm_app_<name>(void)";
  }

  // App name sanity
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(meta.app_name || "")) {
    return "app_name must be lowercase, start with a letter, max 32 chars";
  }
  if (!/^[a-z0-9_]{1,32}$/.test(meta.app_id || "")) {
    return "app_id must be lowercase alphanumeric (or underscore), max 32 chars";
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
//  RUN A COMMAND WITH STREAMED OUTPUT
//  Captures stdout+stderr together so we can grep for IDF errors.
// ─────────────────────────────────────────────────────────────
function runShell(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      shell: false,
      ...opts,
    });

    let output = "";
    let killed = false;
    const timeoutHandle = opts && opts.timeout
      ? setTimeout(() => {
          killed = true;
          try { child.kill("SIGKILL"); } catch (_) {}
        }, opts.timeout)
      : null;

    child.stdout.on("data", (d) => { output += d.toString(); });
    child.stderr.on("data", (d) => { output += d.toString(); });

    child.on("close", (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve({ code: killed ? -1 : code, output, killed });
    });
    child.on("error", (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve({ code: -1, output: output + "\n" + err.message, killed: false, err });
    });
  });
}

// ─────────────────────────────────────────────────────────────
//  BUILD ORCHESTRATION
// ─────────────────────────────────────────────────────────────
async function buildSource({ source, app_name, app_id, display_name, category }) {
  const buildId  = crypto.randomBytes(8).toString("hex");
  const buildDir = path.join(os.tmpdir(), `jencoder-${buildId}`);

  console.log(`[BUILD ${buildId}] start — app=${app_name} id=${app_id} cat=${category}`);

  try {
    // 1. Copy the P4 firmware repo into the build dir
    await exec("cp", ["-r", PISCES_P4_REPO_PATH, buildDir], {
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });

    // 2. Drop user source as a stand-alone app source file
    const appCFilename = `pm_app_${app_name}.c`;
    const appHFilename = `pm_app_${app_name}.h`;
    const categoryLower = (category || "TOOLS").toLowerCase();
    const targetCategoryDir = path.join(
      buildDir, "components", "pm_apps", `pm_apps_${categoryLower}`
    );

    // Ensure the category directory exists (firmware tree should always have it)
    await fs.mkdir(targetCategoryDir, { recursive: true });
    await fs.mkdir(path.join(targetCategoryDir, "include"), { recursive: true });

    // Write the .c source the user uploaded
    await fs.writeFile(path.join(targetCategoryDir, appCFilename), source, "utf8");

    // Write a matching .h header
    const headerText = generateHeader(app_name);
    await fs.writeFile(
      path.join(targetCategoryDir, "include", appHFilename),
      headerText, "utf8"
    );

    // 3. Wire into main/pm_apps_register.c
    await wireIntoRegister(buildDir, app_name, category);

    // 4. Add to the category's CMakeLists.txt
    await wireIntoCMakeLists(targetCategoryDir, appCFilename);

    // 5. idf.py set-target esp32p4
    const setTargetResult = await runShell("bash", [
      "-lc",
      `cd "${buildDir}" && . "${IDF_PATH}/export.sh" >/dev/null 2>&1 && idf.py set-target esp32p4`,
    ], { timeout: 60_000 });

    if (setTargetResult.code !== 0) {
      return {
        ok: false,
        errors: extractIdfErrors(setTargetResult.output, "set-target failed"),
        stage: "set-target",
      };
    }

    // 6. idf.py build
    const buildResult = await runShell("bash", [
      "-lc",
      `cd "${buildDir}" && . "${IDF_PATH}/export.sh" >/dev/null 2>&1 && idf.py build`,
    ], { timeout: BUILD_TIMEOUT_MS });

    if (buildResult.code !== 0) {
      return {
        ok: false,
        errors: extractIdfErrors(buildResult.output, "compile failed"),
        stage: "compile",
        log_tail: buildResult.output.split("\n").slice(-40).join("\n"),
      };
    }

    // 7. Read the resulting .bin file
    const candidates = [
      path.join(buildDir, "build", "pisces_moon.bin"),
      path.join(buildDir, "build", "pisces-moon.bin"),
      path.join(buildDir, "build", "pisces_moon_p4.bin"),
    ];
    let binPath = null;
    for (const c of candidates) {
      try { await fs.access(c); binPath = c; break; } catch (_) {}
    }
    // Fallback: find first .bin in build/ that isn't bootloader/partition_table
    if (!binPath) {
      const built = await fs.readdir(path.join(buildDir, "build"));
      for (const f of built) {
        if (f.endsWith(".bin") &&
            !f.startsWith("bootloader") &&
            !f.startsWith("partition") &&
            !f.includes("ota_data")) {
          binPath = path.join(buildDir, "build", f);
          break;
        }
      }
    }
    if (!binPath) {
      return { ok: false, errors: ["Build succeeded but no output .bin found"], stage: "post-build" };
    }

    const binData = await fs.readFile(binPath);

    console.log(`[BUILD ${buildId}] ✓ ${binData.length}b → ${path.basename(binPath)}`);

    return {
      ok: true,
      binary: binData.toString("base64"),
      binary_size: binData.length,
      flash_address: 0x10000,
      partition: "factory",
      build_id: buildId,
    };
  } catch (err) {
    console.error(`[BUILD ${buildId}] internal error:`, err);
    return {
      ok: false,
      errors: ["Internal build error: " + (err.message || String(err))],
      stage: "internal",
    };
  } finally {
    // Cleanup temp dir
    try { await exec("rm", ["-rf", buildDir]); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────
//  WIRE INTO main/pm_apps_register.c
//  Adds #include "pm_app_<name>.h" and REGISTER_IF(pm_app_<name>())
// ─────────────────────────────────────────────────────────────
async function wireIntoRegister(buildDir, appName, category) {
  const regPath = path.join(buildDir, "main", "pm_apps_register.c");
  let content;
  try {
    content = await fs.readFile(regPath, "utf8");
  } catch (err) {
    throw new Error(`main/pm_apps_register.c not found: ${err.message}`);
  }

  // Add include if not already present
  const includeLine = `#include "pm_app_${appName}.h"`;
  if (!content.includes(includeLine)) {
    // Insert near the last #include
    content = content.replace(
      /((?:#include\s+["<][^">]+[">]\s*\n)+)/,
      `$1${includeLine}\n`
    );
  }

  // Add REGISTER_IF inside main_register_apps()
  const registerLine = `    REGISTER_IF(pm_app_${appName}());`;
  if (!content.includes(`pm_app_${appName}()`)) {
    // Inject before the closing brace of main_register_apps()
    content = content.replace(
      /(void\s+main_register_apps\s*\([^)]*\)\s*\{[\s\S]*?)(\n\s*\}\s*$)/m,
      `$1\n    // JenCoder-injected app\n${registerLine}\n$2`
    );
  }

  await fs.writeFile(regPath, content, "utf8");
}

// ─────────────────────────────────────────────────────────────
//  WIRE INTO components/pm_apps/pm_apps_<cat>/CMakeLists.txt
// ─────────────────────────────────────────────────────────────
async function wireIntoCMakeLists(categoryDir, appCFilename) {
  const cmakePath = path.join(categoryDir, "CMakeLists.txt");
  let content;
  try {
    content = await fs.readFile(cmakePath, "utf8");
  } catch (err) {
    // Some category dirs may not have one yet — synthesize minimal
    content = `idf_component_register(SRCS "${appCFilename}"\n` +
              `                       INCLUDE_DIRS "include"\n` +
              `                       REQUIRES pm_app_iface pm_ui pm_hal pm_peer lvgl)\n`;
    await fs.writeFile(cmakePath, content, "utf8");
    return;
  }

  if (!content.includes(appCFilename)) {
    // Find the SRCS list and append
    content = content.replace(
      /(SRCS\s+(?:"[^"]+"\s*)+)/,
      (m) => m.trimEnd() + ` "${appCFilename}"\n          `
    );
    // If we didn't match (SRCS lives across lines), append a safe addition
    if (!content.includes(appCFilename)) {
      content = content.replace(
        /idf_component_register\s*\(/,
        `idf_component_register(SRCS "${appCFilename}"\n                       `
      );
    }
    await fs.writeFile(cmakePath, content, "utf8");
  }
}

// ─────────────────────────────────────────────────────────────
//  GENERATED HEADER
// ─────────────────────────────────────────────────────────────
function generateHeader(appName) {
  const upper = appName.toUpperCase();
  return `// Pisces Moon OS — Generated by JenCoder Web Edition
// Copyright (C) 2026 Eric Becker / Fluid Fortune
// SPDX-License-Identifier: AGPL-3.0-or-later
// fluidfortune.com

#ifndef PM_APP_${upper}_H
#define PM_APP_${upper}_H

#include "pm_app.h"

#ifdef __cplusplus
extern "C" {
#endif

const pm_app_t* pm_app_${appName}(void);

#ifdef __cplusplus
}
#endif

#endif  // PM_APP_${upper}_H
`;
}

// ─────────────────────────────────────────────────────────────
//  EXTRACT IDF/GCC ERRORS FROM BUILD OUTPUT
// ─────────────────────────────────────────────────────────────
function extractIdfErrors(output, fallback) {
  if (!output) return [fallback || "Unknown error"];

  const lines = output.split("\n");
  const errors = [];
  const seen = new Set();

  const errorPatterns = [
    /:\s*error:\s+/,        // gcc-style:  path:line:col: error: msg
    /^error:\s+/i,           // bare error: msg
    /\berror in\b/i,         // idf.py "Error in ..." messages
    /undefined reference/i,
    /\bfatal\b/i,
    /CMake Error/,
    /ninja: error/,
  ];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!errorPatterns.some(p => p.test(line))) continue;

    // Strip absolute paths to keep messages clean
    const cleaned = line
      .replace(/^[^:]*\/(main|components|src|include)\//, "$1/")
      .replace(/\/tmp\/jencoder-[^\/]+\//, "");

    if (!seen.has(cleaned)) {
      errors.push(cleaned);
      seen.add(cleaned);
      if (errors.length >= 25) break;
    }
  }

  if (errors.length === 0) {
    // Couldn't parse — fall back to last 12 non-empty lines
    return lines.filter(l => l.trim()).slice(-12).map(l => l.trim());
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────────────────────────
app.post("/api/build", async (req, res) => {
  const body = req.body || {};
  const source = body.source;
  const meta = {
    app_name:     body.app_name     || "myapp",
    app_id:       body.app_id       || body.app_name || "myapp",
    display_name: body.display_name || (body.app_name || "MY APP").toUpperCase(),
    category:     body.category     || "TOOLS",
    target:       body.target       || "esp32p4",
  };

  if (meta.target !== "esp32p4") {
    return res.status(400).json({
      ok: false,
      errors: [`target must be "esp32p4" (got "${meta.target}")`],
      stage: "validate",
    });
  }

  const validationError = validateSource(source, meta);
  if (validationError) {
    return res.status(400).json({
      ok: false,
      errors: [validationError],
      stage: "validate",
    });
  }

  console.log(`[BUILD] ${req.ip} → ${meta.app_name} (${source.length}b, ${meta.category})`);

  try {
    const result = await buildSource({ source, ...meta });
    if (result.ok) {
      console.log(`[BUILD] ✓ ${result.binary_size}b for ${meta.app_name}`);
    } else {
      console.log(`[BUILD] ✗ ${(result.errors || []).length} errors @ stage ${result.stage}`);
    }
    res.json(result);
  } catch (err) {
    console.error("[BUILD] Internal error:", err);
    res.status(500).json({
      ok: false,
      errors: ["Internal build error: " + (err.message || String(err))],
      stage: "internal",
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    ok:        true,
    service:   "jencoder-build",
    version:   VERSION,
    target:    "esp32p4",
    repo_path: PISCES_P4_REPO_PATH,
    idf_path:  IDF_PATH,
  });
});

app.get("/", (req, res) => {
  res.json({
    service: "JenCoder Build Backend",
    version: VERSION,
    docs:    "https://jencoder.fluidfortune.com",
    endpoints: ["/api/build (POST)", "/api/health (GET)"],
  });
});

// ─────────────────────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`JenCoder Build Service v${VERSION} listening on port ${PORT}`);
  console.log(`  Target:        esp32p4`);
  console.log(`  Pisces P4:     ${PISCES_P4_REPO_PATH}`);
  console.log(`  ESP-IDF:       ${IDF_PATH}`);
});
