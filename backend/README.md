# JenCoder Build Service

Cloud compile backend for **JenCoder Web Edition**. Receives Pisces
Moon OS P4 app source code via POST, compiles via `idf.py build` for
`esp32p4`, returns a flash-ready `.bin` file.

**Service:** `jencoder-build.fluidfortune.com`
**License:** AGPL-3.0-or-later

---

## Why Not Vercel / Cloudflare Workers?

ESP-IDF builds for the ESP32-P4 take 30–90 seconds (longer than
PlatformIO/S3 builds because the full LVGL graphics stack is in the
default partition). Serverless platforms time out at 10–30 seconds on
free tiers. This needs a long-running container with a warm ESP-IDF
toolchain.

Recommended hosts:

| Host | Why |
|---|---|
| **Fly.io** | Machines auto-suspend when idle. Free tier covers low traffic. |
| **Railway.app** | Similar suspend model; slightly higher base cost. |
| **Hetzner Cloud** | $6/mo VPS. Always-on. Best $/build at scale. |
| **DigitalOcean** | $6/mo droplet. Same idea as Hetzner. |
| **Self-hosted** | Free if you have a Linux box that stays on. |

P4 toolchain images are ~3 GB after warm-build. Make sure your host
plan has the disk room (Fly's free tier does; some Railway plans cap
image size).

---

## Quick Start (Fly.io — recommended)

```bash
# 1. Install flyctl
curl -L https://fly.io/install.sh | sh

# 2. Auth
fly auth signup    # or: fly auth login

# 3. Deploy
cd backend
fly launch --name jencoder-build --region sjc
# Accept defaults. Fly reads the Dockerfile and builds.
# (First build is slow — pulls ESP-IDF v5.5.3 and warms the cache.)

# 4. Set custom domain
fly certs add jencoder-build.fluidfortune.com
# Add a CNAME at your DNS:
#   jencoder-build → jencoder-build.fly.dev
```

Suggested machine size for P4 builds: **shared-cpu-2x, 2 GB RAM**.
Smaller machines OOM during LVGL link.

Total cost at low traffic: ~$0/month (Fly's free tier covers it for
<500 builds/day).

---

## Quick Start (Hetzner / DigitalOcean / your own VPS)

```bash
# On the server (Ubuntu 24+):
git clone https://github.com/FluidFortune/jencoder.git
cd jencoder/backend

# Build the Docker image (this takes ~10-15 min the first time
# because it installs ESP-IDF v5.5.3 and warms the build cache):
docker build -t jencoder-build .

# Run
docker run -d \
  --name jencoder-build \
  --restart unless-stopped \
  -p 3000:3000 \
  jencoder-build

# Put nginx in front for HTTPS via Let's Encrypt
# (or use Caddy which auto-handles certs)
```

Recommended VPS spec: **2 vCPU, 4 GB RAM, 40 GB SSD**.

---

## Local Setup (no Docker)

For development or self-hosting on an existing Linux machine:

```bash
# 1. Install Node 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Install ESP-IDF v5.5.3
sudo apt-get install -y git wget flex bison gperf python3 python3-pip \
                        python3-venv cmake ninja-build ccache libffi-dev \
                        libssl-dev dfu-util libusb-1.0-0
mkdir -p ~/esp
cd ~/esp
git clone -b v5.5.3 --recursive https://github.com/espressif/esp-idf.git
cd esp-idf
./install.sh esp32p4

# 3. Clone the Pisces Moon P4 firmware tree
sudo git clone https://github.com/FluidFortune/pisces-moon-os-p4.git \
                /opt/pisces-moon-p4

# 4. Install backend deps
cd /path/to/jencoder/backend
npm install

# 5. Run with env vars pointing at your installs
export IDF_PATH=$HOME/esp/esp-idf
export PISCES_P4_REPO_PATH=/opt/pisces-moon-p4
node server.js
```

Now point JenCoder's IDE at `http://localhost:3000` by checking
**"Use local backend"** in the Build & Flash modal.

---

## API

### `POST /api/build`

**Request:**
```json
{
  "source":       "/* full pm_app_t source */",
  "app_name":     "mygps",
  "app_id":       "mygps",
  "display_name": "GPS",
  "category":     "COMMS",
  "target":       "esp32p4",
  "api_version":  "1.0"
}
```

`category` is one of: `COMMS`, `CYBER`, `TOOLS`, `GAMES`, `INTEL`,
`MEDIA`, `SYSTEM`.

**Response (success):**
```json
{
  "ok":            true,
  "binary":        "<base64 .bin>",
  "binary_size":   1234567,
  "flash_address": 65536,
  "partition":     "factory",
  "build_id":      "a1b2c3d4..."
}
```

**Response (failure):**
```json
{
  "ok":     false,
  "errors": ["main/.../pm_app_mygps.c:42: error: 'pm_log_x' undeclared"],
  "stage":  "compile"
}
```

Possible `stage` values: `validate`, `set-target`, `compile`, `post-build`,
`internal`.

### `GET /api/health`

Returns service status, version, ESP-IDF path, repo path.

---

## Source Validation

The backend rejects source containing any of these patterns before
spending CPU on compile:

- Host filesystem probes: `/etc/passwd`, `/proc/`, `/sys/`, `/dev/`
- Linker tricks: `LD_PRELOAD`, `#pragma GCC poison` games
- Shell escapes: `system(`, `execve(`, `fork(`, `popen(`
- Inline asm at file scope: `__asm__`, `asm volatile`

Source must also:

- Contain a `pm_app_t` struct literal
- Define a `const pm_app_t* pm_app_<name>(void)` accessor
- Use a valid lowercase `app_name` (≤32 chars, starts with letter)

---

## Rate Limiting

30 builds per IP per hour, in-memory:

```js
const limiter = new RateLimiterMemory({ points: 30, duration: 3600 });
```

For production with auth tokens, swap `RateLimiterMemory` for
`RateLimiterRedis` and key on user ID.

---

## Security

- Source is validated before compile (size limit, forbidden patterns)
- Each build runs in an isolated temp directory
- Temp directory is force-removed after every build (success or failure)
- Source is never logged
- Compiled binaries are returned and discarded — not persisted server-side
- CORS restricted to `jencoder.fluidfortune.com` + `fluidfortune.com`

For higher security, run the IDF build inside a per-request Docker
container (gVisor or Firecracker for stronger isolation):

```js
// In buildSource, replace the spawn(...) idf.py call with:
await exec("docker", ["run", "--rm", "--network=none",
  "-v", `${buildDir}:/build`, "jencoder-builder",
  "idf.py", "-C", "/build", "build"]);
```

---

## Updating the Pisces Moon P4 Repo Template

The backend keeps a clone of the P4 firmware repo as the build
template. When the main repo updates, refresh the backend:

```bash
# On the server
cd /opt/pisces-moon-p4
git pull

# In the warm-build cache:
. $IDF_PATH/export.sh
idf.py fullclean
idf.py set-target esp32p4
idf.py build

# Restart the service
docker restart jencoder-build
```

Or rebuild the Docker image to pick up the latest at image build time.

---

## Monitoring

Tail logs:

```bash
docker logs -f jencoder-build
# or on Fly:
fly logs -a jencoder-build
```

The service logs each build with IP, app name, byte count, and
result. No source content is logged.

---

## Cost Estimate

P4 builds are heavier than Lety's S3 builds (larger artifacts, slower
link), so the per-build cost is higher. Approximate numbers:

| Traffic | Fly.io | Hetzner CPX21 |
|---|---|---|
| 50 builds/day | $0 (free tier) | $6/mo |
| 500 builds/day | ~$8/mo | $6/mo |
| 5,000 builds/day | ~$25/mo | $6/mo (CPU saturated, add a node) |

Scaling beyond ~5K builds/day means horizontal scaling. Cloudflare in
front + multiple build nodes is the path. Add Redis-backed rate
limiting at that point.

---

## Troubleshooting

**"main/pm_apps_register.c not found"** — the cloned P4 repo doesn't
match the expected layout. Check `PISCES_P4_REPO_PATH` points at a
fresh clone of `github.com/FluidFortune/pisces-moon-os-p4`.

**"set-target failed"** — usually means ESP-IDF v5.5.3 wasn't fully
installed for the `esp32p4` chip. Re-run `${IDF_PATH}/install.sh esp32p4`.

**Builds time out at 3 minutes** — the host is under-provisioned for
the P4's link time. Move to a 2 vCPU / 4 GB machine, or warm the
ESP-IDF ccache by running an initial successful build inside the
container.

**Builds succeed but no `.bin` is found** — your firmware tree
produces a non-standard output filename. The backend looks for
`pisces_moon.bin`, `pisces-moon.bin`, `pisces_moon_p4.bin`, and
falls back to the first non-bootloader/partition `.bin`. Add your
expected name to the `candidates` list in `server.js`.

---

*Pisces Moon OS · JenCoder Build Service · fluidfortune.com · AGPL-3.0-or-later*
