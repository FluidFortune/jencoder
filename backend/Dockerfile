# Pisces Moon OS — JenCoder Build Service
# Copyright (C) 2026 Eric Becker / Fluid Fortune
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Builds an ESP-IDF v5.5.3 toolchain image targeting esp32p4,
# pre-clones the Pisces Moon P4 firmware tree, and serves the
# JenCoder build backend on port 3000.

FROM ubuntu:24.04

ARG IDF_VERSION=v5.5.3
ARG PISCES_P4_REPO=https://github.com/FluidFortune/pisces-moon-os-p4.git
ARG PISCES_P4_REF=main

ENV DEBIAN_FRONTEND=noninteractive

# ── System dependencies ─────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git wget \
        build-essential pkg-config cmake ninja-build \
        python3 python3-pip python3-venv \
        flex bison gperf \
        libusb-1.0-0 libssl-dev libffi-dev \
        dfu-util \
    && rm -rf /var/lib/apt/lists/*

# ── Node 20 (NodeSource) ────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── ESP-IDF v5.5.3 ──────────────────────────────────────────
ENV IDF_PATH=/opt/esp-idf
ENV IDF_TOOLS_PATH=/root/.espressif

RUN git clone --depth 1 --branch ${IDF_VERSION} --recursive \
        https://github.com/espressif/esp-idf.git ${IDF_PATH}

RUN ${IDF_PATH}/install.sh esp32p4

# ── Clone Pisces Moon P4 firmware tree (template repo) ──────
ENV PISCES_P4_REPO_PATH=/opt/pisces-moon-p4
RUN git clone --depth 1 --branch ${PISCES_P4_REF} ${PISCES_P4_REPO} ${PISCES_P4_REPO_PATH} || true

# ── Warm the build cache: do a baseline build so subsequent ─
# ── per-request builds are incremental (saves ~60 seconds). ─
RUN bash -lc '. ${IDF_PATH}/export.sh && \
              cd ${PISCES_P4_REPO_PATH} && \
              idf.py set-target esp32p4 && \
              idf.py build' \
    || echo "Warm build skipped (firmware tree may not exist yet)"

# ── Backend service ─────────────────────────────────────────
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.js ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
