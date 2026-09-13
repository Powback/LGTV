# Changelog — everything we changed on the TV

Chronological. Each entry lists exactly what changed and how to revert.
**Golden rule: a reboot reverts every runtime change below (all are bind-mounts / tmpfs / RAM).**
Only the *local Mac-side* changes (SSH keys/config) and the *persistent flag files* survive a reboot — those are called out explicitly.

---

## 1. Enable root SSH  (2026-09-09)  — PERSISTENT (survives reboot)
**On the TV:**
- Created flag `/var/luna/preferences/webosbrew_sshd_enabled` (empty file). Homebrew `startup.sh` starts dropbear on :22 each boot because of it.
- Wrote `/home/root/.ssh/authorized_keys` (0600 root:root) with 2 keys:
  - `lgtv_root` (ed25519, new, `~/.ssh/lgtv_root`)
  - `lgtv_webos_plain` (RSA, pre-existing, fallback)
- Started dropbear immediately: `hbchannel.service/bin/dropbear -R`.

**On the Mac:**
- Generated `~/.ssh/lgtv_root` keypair.
- Rewrote `~/.ssh/config`: `Host lgtv` → root@:22 key lgtv_root; added `Host lgtv-dev` → prisoner@:9922 (old dev-mode entry preserved). Backup: `~/.ssh/config.bak.*`.

**Revert:**
```bash
# TV: disable root SSH persistence
ssh lgtv 'rm -f /var/luna/preferences/webosbrew_sshd_enabled; pkill -x dropbear'   # (kills current session)
# or just remove the flag and reboot. authorized_keys can stay (harmless) or:
ssh lgtv 'rm -f /home/root/.ssh/authorized_keys'
# Mac: restore config
cp ~/.ssh/config.bak.<timestamp> ~/.ssh/config   # optional
```
Telnet :23 remains as failsafe regardless.

---

## 2. Voice-stack extraction (read-only, no TV change)  (2026-09-09)
- `tar czf -` of `/usr/sbin/nlp{,manager,adapter}` and `/usr/palm/applications/com.webos.app.{voice,voiceagent,voiceview}` → `dump/voice-stack.tgz`, extracted to `dump/tv/`.
- **No change to the TV.** Read-only.

## 3. Full eMMC image (read-only, no TV change)  (2026-09-09)
- `dd if=/dev/mmcblk0 bs=1M` over SSH → `dump/mmcblk0.img` (7.4 GB) + `.sha256`.
- **No change to the TV.** Read-only block copy.

## 4. Runtime observation (read-only)  (2026-09-09)
- Read `/proc/<pid>/fd`, `netstat`, `mount`, `/proc/net/*`. No change.

## 5. MITM CA — PREPARED but NOT APPLIED  (2026-09-09)
Pushed our mitmproxy CA to the TV and built augmented CA bundles, but did **NOT** bind-mount them yet.
- `scp ~/.mitmproxy/mitmproxy-ca-cert.pem` → `/tmp/mitm-ca.pem` (tmpfs, gone on reboot)
- Built copies in `/var/lib/webosbrew/mitm/`:
  - `ca-certificates.crt` = system bundle + mitm CA (188 certs)
  - `sdp-ca.pem` = nlp bundle + mitm CA (601 certs)
- **These files are inert** — nothing consults them until we bind-mount over the originals (see MITM.md). Not applied.

**Revert (if we never apply):** `ssh lgtv 'rm -rf /var/lib/webosbrew/mitm /tmp/mitm-ca.pem'` (or reboot).

mitmproxy CA (Mac): `~/.mitmproxy/`, SHA256 `DA:F8:75:5C:8B:32:CC:DF:1E:A6:81:DE:A1:21:9D:3C:85:CD:6F:D0:63:7A:88:D1:9D:8B:BB:BA:19:A8:81:27`

---

## Things we deliberately did NOT do
- Did NOT create `/var/luna/preferences/webosbrew_telnet_disabled` (telnet failsafe kept).
- Did NOT apply any `iptables` rules (the 3rd-party privacy scripts' firewall would have DROP'd :22 — avoided).
- Did NOT lock the root password / `/etc/shadow` (HBC's own tmpfs shadow is present, unchanged by us).
- Did NOT run any of the 3rd-party scripts in `review/` (QwQcustom is wrong-arch/wrong-webOS; privacy scripts need python3 the TV lacks + had a lockout bug).
- Did NOT touch MACs, NDUID, IFA, micom, OTP, or firmware.

---

## 6. DNS routed through Pi-hole for audit  (2026-09-09)
Goal: log every domain the TV contacts (ongoing) via Pi-hole at 192.168.50.100.

**Changes on the TV:**
- **connman Nameservers** `192.168.50.1` → `192.168.50.100` in
  `/var/lib/connman/ethernet_a823fe5daf58_cable/settings`. **PERSISTENT** (real fs,
  survives reboot). Backup: `/var/lib/webosbrew/connman-settings.bak`. Restarted connman.
- **resolv.conf bind-mount** → `/var/lib/webosbrew/resolv.conf` (`nameserver 192.168.50.100`).
  RAM (reverts on reboot). Belt-and-suspenders because connman's dnsproxy didn't reliably
  forward to the new upstream without it.
- Briefly tried an iptables nat OUTPUT DNS-redirect — **flushed/removed** (dnsproxy
  forwarding bypassed the nat OUTPUT chain; superseded by the resolv.conf approach).
  Current TV `iptables -t nat -L OUTPUT` is empty.

**Verified:** `nslookup google.com` on TV → Server 192.168.50.100; Pi-hole logged 76 TV
queries in 10 min including `ch.lgtvsdp.com`.

**Revert:**
```bash
ssh lgtv '
  umount /etc/resolv.conf 2>/dev/null            # drop resolv bind-mount
  cp /var/lib/webosbrew/connman-settings.bak /var/lib/connman/ethernet_a823fe5daf58_cable/settings
  ( restart connman || systemctl restart connman ) 2>/dev/null
'
```
Or just reboot to drop the resolv bind-mount; then also restore the connman file (persistent).

**Reboot note:** the connman setting persists but the dnsproxy quirk means after a reboot
DNS may fall back off Pi-hole until the resolv.conf bind-mount is re-applied. To make the
audit survive TV reboots, add an init.d script re-applying the bind-mount (not done yet).

## Hardcoded IPs that BYPASS DNS capture (from firmware static scan)
These won't appear in Pi-hole (contacted by IP, not name):
- `156.147.69.32:8080` — LG software-update server (`Check/Download SW*.laf`)
- `165.244.62.249:6120/6230/6240` — LG service
To catch these, a packet/gateway capture is needed (see MITM.md B2).

---

## 7. Transparent MITM capture system  (2026-09-09)  — TOGGLEABLE
- CA trust APPLIED on TV (bind-mounts): `/etc/ssl/certs/ca-certificates.crt` and
  `/usr/share/ca-certificates/sdp/sdp-ca.pem` → augmented bundles in /var/lib/webosbrew/mitm/. RAM.
- `bin/lgtv-capture on|off|status` — see capture/README.md. When ON:
  - TV default route → Mac (192.168.50.99); Mac IP-forwarding + pf (capture/pf.conf).
  - mitmdump transparent :8080, decrypts only tracker/telemetry/voice hosts.
- mitmproxy installed as uv tool: `~/.local/bin/mitmdump`.
- **PROOF captured:** decrypted plaintext GETs to ch.lgtvsdp.com (200), eic.cdp*.lgtvcommon.com
  (401 {"code":"AUTH.ERR.106"} — real telemetry API), ch.*.lgsmartad.com (200), he-eu-ai.lgthinq.com.

**Revert (full):**
```bash
~/Projects/LGTV/bin/lgtv-capture off                 # route back to router, stop proxy
ssh lgtv 'umount /etc/ssl/certs/ca-certificates.crt /usr/share/ca-certificates/sdp/sdp-ca.pem' 2>/dev/null
# Mac: sudo pfctl -d ; sudo sysctl -w net.inet.ip.forwarding=0   (off already does this)
```
Or reboot the TV (drops route + CA bind-mounts; connman DNS setting persists — see #6).

---

## 8. PowDash overlay app + state service  (2026-09-09)  — release build
- **webOS app** `com.pow.dash` (dev-installed) — ambient clock / live message / dashboard
  modes, subscribes to `powdash.pow` over SSE, real icon. Source: `app/com.pow.dash/`.
- **State service** `powdash-server` (Docker on PowStation) at `powdash.pow` via a Traefik
  **file-route** `PowStation/config/traefik/dynamic/powdash.yml` (docker-label discovery misses
  CREATE events on this fleet — see powpanion.yml; needed a `docker restart traefik` to load).
- **`lgtv` CLI** gained `say` / `notify` / `dash` / `idle` (POST powdash.pow/api/state); `toast`
  now routes to the overlay too.
- Verified on the TV: idle, message (live push), and dashboard-image all render correctly.

**Revert:** see `app/README.md` → Uninstall (remove app + `docker compose down` + delete the
Traefik route + restart Traefik).

---

## 9. PowDash weather household dashboard  (2026-09-09)  — release
- App `com.pow.dash` is now the **Zurich household home screen**: clock + date + live MeteoSwiss
  weather (ICON model via Open-Meteo) with current conditions, H/L, rain%, feels, humidity, wind,
  sunrise/sunset, and an **hourly temperature graph + precip bars** (SVG, Chrome-53-safe).
- `powdash-server` fetches Zurich weather every 15 min → `/api/weather`; also serves the UI at
  `http://powdash.pow/`. App fetches weather + subscribes to SSE for message/dashboard modes.
- CLI: `lgtv notify "..."` = **system toast over any app** (unblock via notification/enable then
  createToast — screensaver had left a stale toast-block). `lgtv say` = in-app message.
- **Deploy method:** direct file sync to `/media/developer/apps/.../com.pow.dash/` + rebuild the
  server container. NOTE: `appInstallService/dev/install` did NOT reliably overwrite files — direct
  scp is the reliable path.
- Verified after a **full reboot**: app persists on disk, foreground launches clean, powdash.pow
  reachable, weather renders. (Reboot was needed once — killing a foreground app process out from
  under SAM wedged the window manager; a reboot fixed it.)

**Revert:** `docker compose down` in powdash-server; delete the Traefik route + restart Traefik;
`luna-send luna://com.webos.appInstallService/remove '{"id":"com.pow.dash"}'` (or rm the app dir).

---

## 10. PowDash → Zurich household weather dashboard  (2026-09-09)
- Home screen is now a full weather dashboard: clock/date, current conditions (MeteoSwiss ICON via
  Open-Meteo), H/L, feels, rain%, humidity, wind, sunrise/sunset; a **"next 2h" precipitation nowcast**
  (15-min steps, windowed to the TV's local clock); and a big **hourly forecast graph** (temp curve +
  weather icons + precip bars + NOW marker), all SVG (Chrome-53-safe).
- `powdash-server` fetches Zurich weather every 15 min → `/api/weather` (current/today/hourly/nowcast).
- **Radar tile-map was attempted and dropped**: RainViewer rate-limits (429) + Esri "Zoom Level Not
  Supported" edge tiles (cached as 200s) + an unexplained tile-render artifact on the TV's 2016 Chrome
  that couldn't be diagnosed without the on-TV inspector. A caching tile-proxy (`/api/tile`) remains in
  the server (dormant) for a future retry with the webOS inspector. Data-driven viz is reliable instead.
- Deploy = direct scp of index.html to the app dir + `docker compose up -d --build` for the server.
