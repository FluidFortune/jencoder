<!--
Pisces Moon OS — JenCoder Web Edition
Copyright (C) 2026 Eric Becker / Fluid Fortune
SPDX-License-Identifier: AGPL-3.0-or-later

fluidfortune.com
-->

# Contributor License Agreement

**JenCoder Web Edition**
**Pisces Moon OS · Fluid Fortune / Eric Becker**

Thank you for your interest in contributing to JenCoder Web Edition
and the broader Pisces Moon OS family of projects ("the Project"),
maintained by Eric Becker / Fluid Fortune ("we," "us," "our").

This Contributor License Agreement ("CLA") documents the rights you
grant to us when contributing to the Project. Please read it carefully
before submitting a pull request.

---

## 1. Definitions

**"Contribution"** means any original work of authorship, including
modifications or additions to existing work, that you submit to the
Project in any form — source code, templates, documentation, bug
reports, feature requests, app examples, or any other material.

**"Project"** includes all Fluid Fortune / Eric Becker repositories
related to Pisces Moon OS, including but not limited to:
- JenCoder Web Edition (this repository)
- JenCoder (desktop, inside Jennifer OS)
- Pisces Moon OS P4 firmware (`pisces-moon-os-p4`)
- Pisces Moon OS S3 firmware (`PiscesMoon`)
- Lety Web IDE (`lety`)
- Pisces Moon Web Emulator and demo apps
- KodeDot HAL and emulation layer
- Any associated tools, build backends, documentation, or
  build infrastructure

**"You"** means the individual or legal entity submitting a Contribution.

---

## 2. Grant of Copyright License

By submitting a Contribution, you grant Eric Becker / Fluid Fortune a
perpetual, worldwide, non-exclusive, royalty-free, irrevocable copyright
license to reproduce, prepare derivative works of, publicly display,
publicly perform, sublicense, and distribute your Contribution and
derivative works.

---

## 3. Grant of Patent License

By submitting a Contribution, you grant Eric Becker / Fluid Fortune a
perpetual, worldwide, non-exclusive, royalty-free, irrevocable patent
license to make, have made, use, offer to sell, sell, import, and
otherwise transfer the Project, where such license applies only to
those patent claims licensable by you that are necessarily infringed
by your Contribution alone or in combination with the Project.

---

## 4. You Represent That

- You are legally entitled to grant the above licenses.
- If your employer has rights to intellectual property you create, you
  have received permission to make this Contribution on behalf of your
  employer, or your employer has waived such rights.
- Your Contribution is your original creation, or you have sufficient
  rights to submit it under the terms of this CLA.
- Your Contribution does not, to the best of your knowledge, violate
  any third party's intellectual property rights.
- Your Contribution does not include proprietary hardware specifications,
  pinouts, schematics, or confidential technical information belonging
  to any hardware manufacturer or vendor.

---

## 5. Third-Party Hardware

Contributions related to third-party hardware targets (including but
not limited to Espressif, ELECROW, LilyGO, KodeDot, or any other
vendor) must be based solely on publicly available information such
as published datasheets, official block diagrams, open specifications,
or your own original reverse engineering of hardware you legally own.

Contributions must not incorporate confidential, proprietary, or
NDA-protected technical information from any hardware vendor without
explicit written permission from that vendor.

---

## 6. Build Backend & Third-Party Toolchains

JenCoder Web Edition's "Build & Flash" feature invokes the Espressif
IoT Development Framework (ESP-IDF) on a build server. Contributions
that touch the backend (in `backend/`) must:

- Not bundle, mirror, or redistribute the ESP-IDF binary toolchain.
  The backend installs ESP-IDF from Espressif's official distribution
  channels at deploy time.
- Not embed vendor API keys, paid service credentials, or any
  third-party secrets in committed source.
- Respect the rate-limiting, sandboxing, and resource-isolation
  patterns established by the existing backend.

---

## 7. App Templates & Examples

App templates contributed to `jencoder_templates.js` must:

- Be original works (yours or properly attributed permissive sources).
- Compile cleanly via `idf.py build` against the latest tagged
  `pisces-moon-os-p4` release.
- Follow the `pm_app_t` lifecycle contract and use the `pm_ui_*`
  widget kit where applicable.
- Not depend on private branches, unreleased components, or
  non-public Pisces Moon work.

---

## 8. No Obligation

We are under no obligation to accept, review, or merge any Contribution.
Submitting a Contribution does not guarantee it will be included in the
Project.

---

## 9. License of the Project

The Project is licensed under the GNU Affero General Public License
v3.0 or later (AGPL-3.0-or-later). Your Contributions will be
distributed under the same license.

We reserve the right to re-license the Project under other open source
licenses compatible with AGPL-3.0 in the future, or to enter into
commercial licensing arrangements. This CLA gives us the flexibility
to do so without requiring additional permission from you.

---

## 10. No Warranty

You provide your Contributions on an "as is" basis, without warranties
or conditions of any kind, either express or implied, including without
limitation any warranties of merchantability, fitness for a particular
purpose, or non-infringement.

---

## 11. How to Sign

By opening a pull request against any Fluid Fortune repository, you
confirm that you have read this CLA and agree to its terms.

You do not need to submit a separate document. Your pull request
description should include the following statement:

> I have read the CLA at `CLA.md` and agree to its terms.

---

## 12. Contact

Questions about this CLA: open an issue on the relevant GitHub
repository or contact us through [fluidfortune.com](https://fluidfortune.com).

---

*JenCoder Web Edition · Pisces Moon OS · Copyright (C) 2026 Eric Becker / Fluid Fortune · fluidfortune.com*
