# LG webOS Smart TV — eMMC Image Security / Privacy Teardown

**Target:** `/Users/macback/Projects/LGTV/dump/mmcblk0.img` (7.3 GB raw eMMC, rooted owner device)
**Firmware:** Rockhopper release **4.4.3-20** (goldilocks-gorongosa), webOS 4.4.3, kernel 4.4.84, ARMv7l (32-bit ARM)
**Region/unit:** country `CHE` (Switzerland), countryGroup `EU`; unit shows retail store-demo config (`demoMode:on`, storedemo preload videos)
**Analysis date:** 2026-09-09
**Working extraction (scratch, not in project):** `/private/tmp/lgtv-dump/`

---

## 0. Top Concerns (ranked)

| # | Severity | Finding |
|---|----------|---------|
| 1 | **High** | **Two commercial ACR (Automatic Content Recognition) engines are baked in** — Alphonso (`libalphonsosolution.so`, `eulacheck.alphonso.tv`, `prov-lg.alphonso.tv`) **and** Samba TV (`libcid.so`, `cid.samba.tv`), both driven by the `/usr/sbin/acr2` daemon ("LivePlus"). acr2 captures **both audio (PCM) and video frames** from the panel *and* from HDMI source inputs, fingerprints them, and reports to an SDP server. **Observed Pi-hole DNS history shows the TV actually hammered Alphonso: `prov-lg.alphonso.tv` was the single most-queried host of all (2,326 hits)**, plus `eu-acr110/eu-bl-server/eu-clockskew.alphonso.tv` — even though the settings snapshot has `livePlus:"off"`. Either ACR ran heavily before opt-out, or the opt-out does not stop the Alphonso provisioning/beacon traffic. Consent gate on disk: `/mnt/lg/cmn_data/acr/data/eula_allowed`. |
| 2 | **High** | **Firmware update runs over plaintext HTTP** and to a hardcoded IP. `/usr/sbin/update` contacts `http://snu.lge.com`, `http://su-dev.lge.com` (a **dev** update server shipped in production), and hardcoded `http://156.147.69.32` (bypasses DNS). Image signatures are verified separately, but the transport is cleartext + DNS-bypassing. |
| 3 | **High** | **Plaintext EC private key on disk**: `/usr/share/nlpadapter/device_attestation_key.pem` (voice device-attestation key, unencrypted). Its paired `product_cert.pem` is the **OpenSSL default self-signed placeholder** ("Internet Widgits Pty Ltd", C=AU) — a test artifact shipped in production. |
| 4 | **Medium** | **Distrusted WoSign CA in the system trust store** (`WoSign.pem`, `WoSign_China.pem`, `Certification_Authority_of_WoSign_G2.pem`, `CA_WoSign_ECC_Root.pem`). WoSign was globally distrusted (2016–17) for mis-issuance; its presence weakens TLS validation for anything using `/etc/ssl/certs`. |
| 5 | **Medium** | **Broad LG telemetry stack** (`cdpbeacon/cdpsvc/cpv/nudge/recommend/wau.lgtvcommon.com`, `ibsstat.lgappstv.com`) + LG ad server (`info.lgsmartad.com`) via `admanager`, and remote-diagnostics upload (`rdxd`/`uploadd` → `rdx2.lgtvsdp.com`). Crash reports are **auto-filed to LG's Jira** (`com.palm.service.bugreport` uses a `jira` node module). `watchedListCollection:"on"` on this unit. |
| 6 | **Low/Info** | Plaintext local credential: `password_ipcontrol:"828"` (the network IP-control PIN) in the settings DB. IP control itself is `off`. |
| 7 | **Low/Info** | LAN control surface: SSAP remote-control WebSocket (`second-screen-gateway`, ports **3000/3001**), DIAL, SSDP/mDNS discovery, AirPlay, HomeKit, DLNA/DMR. All standard; SSAP requires on-screen pairing (`bypass-pairing:false`). |
| — | **Reassuring** | **No always-listening / hands-free wake-word engine** for the built-in mic; voice is push-to-talk via the Magic Remote mic button. **No default telnet/SSH/ADB/getty** — debug shell is gated behind factory/`debugMode` boot. `root` and `developer` accounts are **locked** in `/etc/shadow`. |

---

## 1. Persistence / Autorun

- **Init system:** Upstart (`/sbin/init` → `init.upstart`) + busybox `inittab` + SysV `rcS`/`rc5.d`. `inittab` has **no getty, no telnet, no serial-console shell** — only mounts, `rcS`, and reboot/shutdown handlers.
- **154 Upstart jobs** in `/etc/init/*.conf`. Nothing unexpected/injected in the read-only rootfs. Notable network-facing jobs catalogued below.
- **SysV boot (`rc5.d`):** networking, dbus, fuse, hwclock, syslog, avahi-daemon, kdump, smartd, **lighttpd**. `lighttpd` (`/etc/lighttpd.conf`) serves `/www/pages/` locally — stock, no CGI/PHP handlers of note.
- **Root/jailbreak persistence:** the rootfs squashfs is **stock LG** — no `webosbrew`/`rootmytv`/homebrew markers (grep clean). On a rooted webOS TV the persistence (Homebrew Channel `startup.sh`, elevated services) lives in the **writable** partition, not the read-only rootfs. The writable `cmn_data` partition was captured mid-write and only survives as orphaned inodes (see §Appendix); no shell-script/startup persistence text was recoverable from those fragments.
- **`devmode.conf`:** only installs the SDK SSH public key **on the qemu emulator** (`grep -qs qemux86 /etc/hostname`) — not on real hardware. A patch (`0001-Security-patch-to-verify-start-devmode.sh-before-exe`) hardens the devmode start path.

## 2. Telemetry / ACR / Ads

**Master endpoint map:** `/usr/palm/sdx/server_addr_version.conf` (parsed in full; see `dump-endpoints.txt`). SDP = LG "Smart Data Platform".

### ACR — "LivePlus" (`/usr/sbin/acr2`)
- **Binary:** `/usr/sbin/acr2` (ELF ARM, stripped). Loads **both** vendor libs:
  - `/usr/lib/libalphonsosolution.so.1.0.0` + `/usr/lib/libas.so.3.0.94` → **Alphonso** (`eulacheck.alphonso.tv`, `prov-lg.alphonso.tv`)
  - `/usr/lib/libcid.so.3.9.1` → **Samba TV** (`cid.samba.tv`, `fsui.cid.samba.tv`)
- **Capture:** strings show `AudioCapture`, `VideoCapture`, `DILE_AUDIO_PCM_StartUpload/StopUpload`, `CAPTURE_LOCATION_DISPLAY`, `CAPTURE_LOCATION_SOURCE`, `Capture::VideoCaptureStart`. i.e. it fingerprints **both audio and video**, from the **display** and from the **source** (so ACR covers HDMI-connected devices — consoles, cable/set-top boxes — not just the tuner). Dedicated hidden apps exist per input: `com.webos.app.acrhdmi1..4`, `acroverlay`, `acrcomponent` (title "LivePlus", `visible:false`).
- **State/consent (on disk, in `/mnt/lg/cmn_data/acr/data/`):** `eula_allowed`, `first_optout`, `sdp_server`, `service_country`, `config_file_path`, `firmware_version`, `power_off_info`. The active reporting host is read from `sdp_server` at runtime (not hardcoded); obtained via SDP service `sdp_check_acr` on `lgtvsdp.com`. Debug overrides: `/var/luna/preferences/debug_acr_config`, `debug_acr_libs`.
- **Overlay/ads mechanism:** `acrcomponent/present_frm.html` renders a **remotely-supplied `contentTarget` URL full-screen** (passed at launch by the ACR backend), and drives `luna://com.webos.service.acr/{setVideoPig,closedApplication,setForceAliveTime}` — this is how content-triggered interactive overlays/ads are shown.
- **On/off on THIS unit:** `livePlus:"off"` (see recovered settings DB, §Appendix). ACR is disabled here.

### Ads — `admanager` (`/etc/init/admanager.conf`, `/usr/sbin/admanager`)
- Reports to **`info.lgsmartad.com`** (LG Smart Ad). Related settings on this unit: `bannerPosition:"none"`, `miracastOverlayStatus:"off"`.

### Remote diagnostics — `rdxd` + `uploadd`
- `rdxd` ("Remote diagnostics daemon", `/usr/sbin/rdxd`, `librdx.so`) generates reports; `uploadd` ("Remote diagnostics upload daemon") uploads them to **`rdx2.lgtvsdp.com`** (SDP service `rdx`/`rdx_secure`). `collect_alllogs.sh` bundles logs. Client cert for this path: `/usr/share/remotediag/{device.pem,server.pem}`.
- **Crash → Jira:** `crashreportd` = "Crash report daemon for filing a bug to Jira on a crash"; `com.palm.service.bugreport` bundles a `jira` node module. Crash metadata is filed to an LG-internal Jira.

### IoT / ThinQ — `iot-client` (`/usr/sbin/iot-client`)
- Talks to `api.lgtviot.com` (control), `push.lgtviot.com` (push), `common.lgthinq.com`. This is the ThinQ/remote-app control channel.

### LG "CDP" beacon + recommendation/usage stack (`*.lgtvcommon.com`)
- `cdpbeacon` (tracking beacon), `cdpsvc`, `cpv` (content-play-view), `nudge` (behavioral push), `recommend`, `wau` (weekly-active-user analytics), `homeprv` (home-dashboard content). App-store usage stats to `ibsstat.lgappstv.com`.
- Relevant consent/tracking flags on this unit: `watchedListCollection:"on"` (viewing history collection **ON**), `hbbTvDnt:"off"` and `ibbDnt:"off"` (HbbTV Do-Not-Track **disabled → tracking not blocked**), `interactivity:"off"`, `hybridCast:"off"`.

## 3. Hardcoded Endpoints
Full deduped list: **`/Users/macback/Projects/LGTV/audit/dump-endpoints.txt`**. Highlights:
- **Concerning vendors:** `eulacheck.alphonso.tv`, `prov-lg.alphonso.tv` (Alphonso ACR); `cid.samba.tv`, `fsui.cid.samba.tv` (Samba TV ACR); `*.doubleclick.net`, `googlesyndication.com`, `scorecardresearch.com` (ads/analytics, mostly browser).
- **Contacted by raw IP (bypasses DNS):** `http://156.147.69.32` (LG range) in `/usr/sbin/update`.
- **Plaintext HTTP:** `http://snu.lge.com`, `http://su-dev.lge.com` (update).
- **Dev/QA hosts in production:** `su-dev.lge.com`, `he-kr-qa-ai.lgthinq.com`, `he-ru-qa-ai.lgthinq.com`.
- **LG telemetry/ad:** `info.lgsmartad.com`, `cdpbeacon/cdpsvc/cpv/nudge/recommend/wau.lgtvcommon.com`, `ibsstat.lgappstv.com`, `rdx2.lgtvsdp.com`.
- Raw unfiltered host dump (15k+ incl. ~150 preloaded 3rd-party apps): `/private/tmp/lgtv-dump/hosts_all.txt`.

## 4. Credentials / Keys / Certs
- **`/etc/shadow`:** `root:*` (locked), all system accounts `*`/`x`/`!` — **no login-able hashes**. `developer` (uid 504, `/bin/sh`) present but no valid hash. `sshd` account exists but no sshd binary in rootfs.
- **Plaintext private key:** `/usr/share/nlpadapter/device_attestation_key.pem` — **EC PRIVATE KEY, unencrypted** (voice/ASR device attestation). Paired `product_cert.pem` = OpenSSL default placeholder ("Internet Widgits Pty Ltd") → **test cert in production**. Also `roots.pem` (trust roots for voice backend).
- **Encrypted private keys (passphrase-protected):** `/mnt/lg/res/lgres/secumgr/dmost_prv.pem` (RSA, `ENCRYPTED`), `CDSPriv.pem` (RSA, `ENCRYPTED`). Public keys in the same dir: `pubkey_lgapps.pem`, `pubkey_smartdemo.pem`, `pubkey_smartdemo_dev.pem`, `storedemo_pub.pem`, `CDSPub.pem`, `dmost_pub.pem` — LG app/demo **code-signing** trust anchors.
- **TLS:** `/etc/ssl/certs` = 376 CA certs including the **distrusted WoSign** set (concern #4). Diagnostics client cert `/usr/share/remotediag/device.pem`. SDP CA `/usr/share/ca-certificates/sdp/sdp-ca.pem`. Second-screen signing certs (`svl-signing-cert.pem`, `test-signing-cert.pem`). Devmode pubkey `com.palm.service.devmode/pub.pem`.
- **Recovered from user-data (`cmn_data`):** ~11 OpenPGP public keys and **9 OpenPGP secret keys + 2 secret sub-keys** (binary packets, **no user IDs / emails** → anonymous, machine/app-generated; purpose undetermined — likely a per-device or per-app keypair). Present in the writable data partition.
- **Plaintext local secret:** settings DB `password_ipcontrol:"828"` (network IP-control PIN); `IPControlSecureKey:""` empty; `enableIpControl:"off"`.
- No AWS keys / bearer tokens / obvious API secrets surfaced in the core daemons on strings sweep.

## 5. Microphone / Audio / Voice
- **Model: push-to-talk via Magic Remote**, streamed to LG ThinQ cloud. `/usr/sbin/nlp` (NLP) endpoints: `he-{us,eu,kr,ru}-ai.lgthinq.com` (+ `-qa-` variants). Capture is via `nlp_mrcuinput_StartVoiceCapture` (MRCU = Magic Remote Control Unit) and gated by an internal `_gIsRecording` flag; start/stop are driven by the mic-button **shortkey** (`handler_nlp_stopRecord(shortkey=…)`). `nlp_mrcuinput_startSendingAudio(totalSpeechTimeout=…)` streams the buffer during a press.
- **Audio-to-disk paths (all volatile `/tmp`):** `/tmp/nlp/autorecord/`, `/tmp/nlp/nlp_dump.pcm`, `temp.pcm`, and **`amazon_logging_audio.pcm`** (Alexa integration logging). `nlp_autorecord_{init,record_file_to_local,remove_local_file,renaming}` — a diagnostic auto-record that writes then **removes** local files. These are debug dumps in tmpfs, not a persistent archive.
- **Standby hooks:** `nlp` registers `luna://com.webos.service.tvpower/power/{register,response}PrepareActiveStandby` (`_nlp_policy_prepareActiveStandbyCb`). This is standby-lifecycle *coordination* (prepare/stop on standby), not evidence of standby recording.
- **Always-listening / wake-word:** **NOT present for the built-in mic.** "always listen" appears only in the TV **user-guide help HTML**; "hotword" appears only inside Chromium (`libcbe.so`, Web Speech API). This unit's flags: `turnOnByVoice:"off"`, `speakToTv:"off"`, `wakeUpword:"LGTV"` (config value only), `voiceRecognitionLanguage:"eng"`.
- **Other voice paths / apps:** `com.webos.app.{voice,voiceagent,voiceview}`, `amazon-echo` (Alexa), `google-home`, `googleassistant`. Direct capture tools exist (`arecord`, `parecord`, `starfish-record-pipeline`) — usable from a root shell (see §7) but not wired to autorun.
- **Saved audio artifacts:** none found on disk (no persistent `.pcm/.wav/.raw` in rootfs, overlays, or recovered `cmn_data`).
- **Assessment (records without user action?):** **No evidence of covert/standby/always-on recording.** Capture is button-triggered push-to-talk; the on-disk PCM paths are transient tmpfs debug dumps that are deleted; there is no hands-free wake engine in this firmware; and voice-wake settings are off on this unit. The residual privacy exposure is normal: when the user *does* press-to-talk, raw audio is streamed to `*.lgthinq.com` (and, for Alexa, logged to a tmp PCM).

## 6. Anything Backdoor-like
- **No default remote shell:** no telnet/dropbear/sshd/adbd binaries autostarted; no getty in `inittab`. Busybox `telnetd`/`telnet` symlinks exist but are only invoked under **factory boot mode** / kernel `debugMode` (`SetInitEnv.conf` reads `debugMode` from `/proc/cmdline`; `bootd-mode.conf` branches on `BOOTMODE=factory`). On a release unit these are inactive — requires physical/service access.
- **LAN listeners (all standard, discoverable):** SSAP remote-control WS `second-screen-gateway` (**:3000 http / :3001 https**, pairing required, `bypass-pairing:false`); `unified_service_server` (node.js); DIAL (`com.webos.service.dial`); SSDP/mDNS (`ssdp-discovery-lgtv`, `mdnsd`, `avahi`); UPnP/DLNA `dmr`/`upnpd`; AirPlay (`airplay`, `airplay-adaptor`); **HomeKit** (`/usr/sbin/homekit`); Bluetooth (bsa/bluedroid); Miracast. These are broad but expected cloud/LAN control surfaces; none is a hidden shell.
- **Cloud over-reach:** the `iot-client` → `api.lgtviot.com` channel + ThinQ allow LG-cloud-initiated control of the TV (power/app launch/etc.), and ACR (when enabled) is remote-config-driven and can render arbitrary remote overlay URLs full-screen — the closest thing to "over-broad cloud control", but it is a documented product feature, gated by consent, and OFF here.
- No hidden accounts beyond the standard webOS set; no rogue cron; no unexpected respawning listeners.

## 7. Cool Root Capabilities (now that the owner has root)
- **`luna-send` / `luna-send-pub`** — issue any Luna bus call as root: toggle every setting, ACR, ads, telemetry cleanly (e.g. force `livePlus`, `watchedListCollection`, `hbbTvDnt`, `admanager` state).
- **Kill telemetry precisely:** set `eula_allowed`/`first_optout` under `/mnt/lg/cmn_data/acr/data/`, blank/redirect `sdp_server`, or firewall/hosts-block the endpoints in `dump-endpoints.txt` (Pi-hole is already on this LAN — drop `*.alphonso.tv`, `cid.samba.tv`, `*.lgsmartad.com`, `cdpbeacon/cpv/wau.lgtvcommon.com`, `rdx2.lgtvsdp.com`).
- **Redirect endpoints:** edit `/usr/palm/sdx/server_addr_version.conf` (or DNS) to point SDP/ACR/ad hosts wherever you like.
- **Hardware access:** `irdbmanager` (IR blaster), `i2cget/i2cset/i2cdetect/i2cdump`, `test_dile_gpio`, `test_dile_i2c` (panel/GPIO/I2C), `nyx-cmd` (LEDs, device info, keys), `flash_eraseall`/`emmcd`/`ubi*` (flash/MTD).
- **Mic/audio:** `arecord` / `parecord` / `starfish-record-pipeline` capture directly; `pulseaudio`/`audiod` routing.
- **Recording / tuner:** PVR/DVR stack (`rec-listmgr`, `rec-info-adapter`, `com.webos.app.recordings`, `dvrpopup`).
- **Custom apps / dev:** install unsigned apps (webosbrew), enable the web inspector, drop your own Upstart job or Homebrew `startup.sh` in the writable partition for boot persistence.

---

## Appendix A — Extraction method & partition layout
The image has **no valid GPT/MBR** (LG nonstandard layout), so partitions were located by filesystem magic and carved with `dd`, then `unsquashfs` / `e2fsck`+`debugfs`.

| What | Offset (bytes / sector) | Type | Notes |
|------|------------------------|------|-------|
| rootfs slot **A** | 0x6880000 / 214016 | squashfs (lzo), 621.7 MB, 78,693 inodes | **extracted** → `/private/tmp/lgtv-dump/rootfsA` |
| rootfs slot **B** | 0x46100000 / 2295808 | squashfs, 621.8 MB, 79,001 inodes | A/B mirror (near-identical), not separately extracted |
| overlay squashfs (A set) | 0x37800000, 0x3b100000, 0x3e000000, 0x41800000 | squashfs | `/var`, `usr/palm` overlays → `varA,p2A,p3A,p4A` |
| **cmn_data** (`/mnt/lg/cmn_data`) | ~0xad400000 / 5677056 | ext4, 512 MB | writable user data; **captured mid-write** |
| **appstore** (`/mnt/lg/appstore`) | ~0x145a00000 | ext4, 4.4 GB | see note below |

- **cmn_data** was live/mounted at dump time (journal `needs_recovery`; 322 mounts, 109 GB lifetime writes). `e2fsck` recovery reconnected **~1,680 files into `lost+found`** (names lost, contents intact) → `/private/tmp/lgtv-dump/cmn_data/lost+found`. This is why consent files show as orphaned blobs rather than clean `/var/luna/preferences/...` paths.
- **appstore (p54, 4.4 GB):** only stale/duplicated ext4 superblocks (all claim group-0 + 4.4 GB, at offsets whose size overruns the image) — consistent with an actively-mounted (or cryptofs) volume that cannot be cleanly reconstructed from this snapshot. It holds 3rd-party app installs/media (lowest security priority); ~150 preloaded 3rd-party apps were still enumerable from the overlay squashfs.

## Appendix C — OBSERVED network traffic (Pi-hole DNS history, this LAN)
This is what the TV **actually contacted** (query counts), not just what is on disk — the strongest behavioral evidence. Top telemetry/ACR/ad hosts observed:

| Queries | Host | What |
|--------:|------|------|
| **2326** | `prov-lg.alphonso.tv` | **Alphonso ACR provisioning — #1 host overall** |
| 329 | `eu-acr110.alphonso.tv` | Alphonso ACR (EU) |
| 210 | `ch.lgtvsdp.com` | LG SDP (CH region) |
| 148 | `ch.rdx2.lgtvsdp.com` | LG remote diagnostics upload |
| 83 | `eu-bl-server.alphonso.tv` | Alphonso ACR |
| 68 | `eic.cdpsvc.lgtvcommon.com` | LG CDP telemetry |
| 35 | `eic-ngfts.lge.com` | LG file transfer |
| 33 | `ch.info.lgsmartad.com` | **LG Smart Ad server (contacted)** |
| 29 | `ngfts.lge.com` | LG file transfer |
| 28 | `eu-clockskew.alphonso.tv` | Alphonso ACR |
| 24 | `snu.lge.com` | Software update |
| 24 | `eic.cdpbeacon.lgtvcommon.com` | **LG CDP tracking beacon** |
| 20 | `eic.service.lgtvcommon.com` | LG common service |
| 5 | `he-eu-ai.lgthinq.com` | Voice/ThinQ AI |
| 5 | `static.doubleclick.net`, `googleads.g.doubleclick.net` | Google ads |

(Netflix/YouTube/Amazon/Apple hosts also heavily present — normal app usage.) Full history: `/Users/macback/Projects/LGTV/audit/domains-pihole-history.txt`. **Takeaway: Alphonso ACR + LG's CDP beacon + LG ad server + rdx diagnostics are all live on this network**, which is the concrete real-world confirmation of the on-disk telemetry stack.

## Appendix B — Key recovered artifacts (from `cmn_data/lost+found`)
- **Live settings DB** (`com.webos.settingsservice`, files `#9057`/`#14577`): the authoritative consent/feature state quoted throughout — `livePlus:off`, `speakToTv:off`, `turnOnByVoice:off`, `watchedListCollection:on`, `hbbTvDnt:off`, `ibbDnt:off`, `irBlaster:off`, `password_ipcontrol:828`, `country:CHE`, `demoMode:on`, `storeMode2:on` (retail floor unit). Also cached promo/EPG content (funke.video CDN URLs, German).
- **Device identifiers:** MACs `00:51:ed:96:5f:51` (LG Innotek OUI) and `b0:4b:bf:08:6e:8f` (LG Electronics OUI).
- **Wi-Fi (connman):** SSIDs `bulletproof zest` (owner network), `LGE MR18`, `Wired`. No passphrases recovered in the surviving fragments.
- **9 OpenPGP secret keys + 2 sub-keys** (anonymous, purpose undetermined) and ~11 public keys; ~32 SQLite journals (db8/mojodb).
