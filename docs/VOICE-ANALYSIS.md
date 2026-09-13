# LG webOS Voice / Telemetry Stack — teardown

webOS 4.4.3, armv7l. Based on static analysis of `nlp`, `nlpmanager`, `nlpadapter`
(`/usr/sbin/`) + the voice apps, plus live runtime observation on 2026-09-09.

## TL;DR
- **Transcription is NOT on-device.** Voice audio is streamed as 16 kHz PCM to LG's
  cloud (`he-*-ai.lgthinq.com`) over chunked HTTPS; text comes back. A separate path
  (`nlpadapter`) does Google Assistant via gRPC to `embeddedassistant.googleapis.com`.
- **It is NOT always listening/uploading (at least not at idle).** With no voice
  session active, `nlp` holds **zero network sockets** and the whole TV had **zero
  established connections**. The mic buffer and upload only open on a session.
- **The remote mic and the far-field/app mic use the SAME uploader** (`nlp`) and the
  SAME endpoint. There is one voice pipeline, one cloud target.
- The GN/Malwarebytes "records in standby / buffers offline, uploads on reconnect"
  **capability exists in the binary** (`nlp_autorecord_*` + a `prepareActiveStandby`
  hook) — but whether it fires unprompted is not proven by strings alone. The MITM +
  strace will settle it empirically.

## Architecture

```
  Magic Remote mic (LGE M-RCU, RF/BT)          built-in / app audio
            │                                          │
            ▼                                          ▼
   /dev/shm/libMRCU-shm-0  ◄── kernel writes 16kHz PCM ring buffer
            │
            │  nlp shm_open()s it; state machine:
            │  MRCUINPUT_STATE_READY→START→SENDING→END
            ▼
   ┌───────────────────────────────────────────────┐
   │  /usr/sbin/nlp   (the ONLY uploader)           │
   │  libcurl, chunked POST                          │
   │  headers: x-api-key, X-DeviceId, X-Device-*     │
   └───────────────────────────────────────────────┘
            │                                   │
            ▼ (LG STT)                          ▼ (Google Assistant)
  https://he-{us,eu,kr,ru}-ai.lgthinq.com:443    nlpadapter → gRPC
    /voice/stt/v1/dictation/upstream   (audio up)   embeddedassistant.googleapis.com
    /voice/stt/v1/dictation/downstream (text down)  (only if user linked Google)
```

`com.webos.app.voice` (the on-screen "Search" overlay) is just UI — it calls
`luna://com.webos.service.nlp` / `nlpmanager`. The heavy lifting is in `nlp`.

## Endpoints (extracted from `nlp`)
| Host | Purpose |
|------|---------|
| `https://he-us-ai.lgthinq.com:443` | US STT/NLP |
| `https://he-eu-ai.lgthinq.com:443` | EU STT/NLP |
| `https://he-kr-ai.lgthinq.com:443` | KR STT/NLP |
| `https://he-kr-qa-ai.lgthinq.com:443` | KR QA/staging |
| `https://he-ru-ai.lgthinq.com:443` , `:8443` | RU STT/NLP |
| `lgs2{us,gb,kr,mx,au}.lpoong.com` | SDP/service-discovery region hosts |

Region chosen at runtime: `getCurrentCountryGroup` / `nlp_policy_convertCountryType`
(`isRussiaRegion` special-cased). REST paths: `/rest/sdp/v13.0/nlp/service`,
`/rest/sdp/v7.0/nlp/withdraw`.

From `nlpadapter` (Google Assistant path):
- `embeddedassistant.googleapis.com` (gRPC), `www.googleapis.com/oauth2/v3/token`,
  `accounts.google.com`. Google project `83514302522`, client-id family
  `lge-assistant-syndication-2018-*`.

## Credentials — what's actually baked in
- **LG STT app key (HARDCODED, plaintext in `nlp`):**
  `x-api-key: MTtiOWI1NTMzYmJkYjI0MGRlODIzOTNlMzE4MDE3OGZkYTsxNjIzMTI5MTM0Mzc3`
  → base64-decodes to `1;b9b5533bbdb240de82393e3180178fda;1623129134377`
  (`version;appkey-uuid;epoch-ms`; ts = 2021-06-08). Static, same across TVs of this build.
- **LG per-device voice secret:** NOT plaintext. Read at runtime via
  `DILE_CRYPTO_ReadNLPSecret` from `libdile_crypto.so.0` (secure store / TEE).
- **Google client_secret / refresh_token:** NOT hardcoded. OAuth `authorized_user`
  flow with runtime values (`client_id=%s&client_secret=%s&refresh_token=%s`),
  logged as `<redacted>`. Present only after a user links a Google account.

Implication for interception: to **replace** LG's STT with our own server we need
NONE of these (we own the client; we just answer the request + trust our own CA).
To **impersonate the TV to LG's real cloud** we'd need the x-api-key (have it) PLUS
the crypto device secret (hard) — so full LG-cloud replay is not free.

## "Is it always listening?" — evidence
Runtime snapshot, TV idle, no button pressed (2026-09-09):
- `nlp` (pid 3215) open fds: all `luna-service2` **unix/IPC** sockets + pmloglib lock.
  **Cross-referenced against `/proc/net/tcp|udp`: ZERO inet sockets.** → no cloud connection.
- No `/dev/shm/libMRCU-shm*` handle open, no `/tmp/nlp/autorecord/*`, no `nlp_dump.pcm`.
- Whole-TV `netstat ESTABLISHED`: **empty.** Nothing phoning home at that moment.

Conclusion: at idle it is **not** streaming or buffering audio. Audio capture +
upload are session-scoped (mic button / assistant invocation). This is a *snapshot*;
the MITM gives the continuous picture and catches any periodic/standby activity.

## The standby / autorecord capability (the GN claim)
These symbols exist in `nlp` and are what the researchers likely referenced:
- `luna://com.webos.service.tvpower/power/registerPrepareActiveStandby` +
  `_nlp_policy_prepareActiveStandbyCb` + `responsePrepareActiveStandby` — the voice
  daemon registers a callback around the transition into "active standby" (a low-power
  state where some subsystems stay powered). This is the "even when off" surface.
- `nlp_autorecord_record_file_to_local` / `_renaming` / `_remove_local_file`,
  buffer dir `/tmp/nlp/autorecord/`, plus `rm -rf /tmp/nlp/nlp_dump.pcm`,
  `temp.pcm`, and an Alexa leftover `amazon_logging_audio.pcm` / `nlp_amazon_removePcmFile`.
  → the code CAN write captured PCM to local disk and rename/upload later.

What strings do NOT tell us: the *trigger conditions*. `autorecord` may be gated on a
mic-button/retry path, not unprompted capture. **Open test (do with MITM/strace):**
watch `/tmp/nlp/autorecord/` and `nlp`'s shm/inet fds across (a) idle, (b) mic press,
(c) entering standby, (d) network-down→up — and see if audio is ever captured or
queued without user action.

## Interception points (for reroute / own-assistant goals)
1. **Endpoint swap (easiest):** DNS-redirect `he-*-ai.lgthinq.com` → our STT server;
   trust our CA via `/usr/share/ca-certificates/sdp/sdp-ca.pem` (nlp's CA dir). Same
   protocol (chunked PCM up, text down). Gives "same UI, better STT."
2. **Mic tap:** read `/dev/shm/libMRCU-shm-0` (16 kHz PCM) + MRCU luna events to get
   the same audio nlp gets, on button press — pipe to our own assistant.
3. **Far-field/always-on:** depends whether THIS panel has a built-in mic array
   ("Always Ready"; note the `Trigger word exception` string). TBD from dump/audiod.

## Tooling present on the TV
`curl`, `openssl`, `lsof`, `netstat`, `iptables`, `node`, `python2.7`, `connmanctl`.
Missing: `strace`, `ltrace`, `tcpdump`, `ss`, `socat`, `python3`.
(For strace/tcpdump we'd push static armv7 builds, or capture from the network side.)
