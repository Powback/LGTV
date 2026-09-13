# LG webOS TV — root, analysis & tooling

**TV:** LG webOS TV, `192.168.50.143` on the PowStation LAN
**webOS:** 4.4.3-22 (Rockhopper / goldilocks-gorongosa), kernel 4.4.84-150.glacier.2
**Arch:** `armv7l` (32-bit ARM), interpreter `/lib/ld-linux.so.3`
**eMMC:** `/dev/mmcblk0`, 7.4 GB, dual rootfs slots (p28 / p38)
**Rooted:** via [faultmanager-autoroot](https://github.com/throwaway96/faultmanager-autoroot) (Homebrew Channel installed)

This project holds our reverse-engineering of the TV's voice/telemetry stack, a full
eMMC image, and the tooling to MITM its cloud traffic.

## Start here
- **[docs/ACCESS.md](docs/ACCESS.md)** — how to connect, the 3 access channels, recovery/failsafe. **Read this if anything ever seems broken.**
- **[docs/CHANGES.md](docs/CHANGES.md)** — every change we made to the TV, chronologically, each with an exact revert. Source of truth for "what did we touch."
- **[docs/VOICE-ANALYSIS.md](docs/VOICE-ANALYSIS.md)** — full writeup: what the voice stack does, endpoints, credentials, the "always listening" question answered with evidence.
- **[docs/MITM.md](docs/MITM.md)** — plan & safety for intercepting the TV's TLS traffic.

## Safety summary (why we can't brick it)
1. **Firmware is read-only** — rootfs is squashfs on a RO overlay; `touch /usr/sbin/x` → `Read-only file system`. We literally cannot modify firmware.
2. **Everything we add is RAM-backed** (bind-mounts over copies in `/tmp` and `/var/lib/webosbrew/`). **A reboot reverts every change** → clean stock-rooted state.
3. **Three independent ways in** (see ACCESS.md), one of which (telnet :23) is unauthenticated root — the ultimate failsafe.
4. **Full eMMC backup:** `dump/mmcblk0.img` (+ `.sha256`).

## Layout
```
README.md
docs/ACCESS.md          access channels + recovery
docs/CHANGES.md         changelog with reverts
docs/VOICE-ANALYSIS.md  the voice/telemetry teardown
docs/MITM.md            interception plan
dump/
  mmcblk0.img           full 7.4GB eMMC raw image (+ .sha256)
  voice-stack.tgz       nlp/nlpmanager/nlpadapter + voice apps
  tv/                   extracted voice-stack for grepping
review/                 downloaded 3rd-party scripts (QwQcustom, privacy scripts) — NOT applied
```
