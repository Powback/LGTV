# Current live state (2026-09-09)  — what is running / changed RIGHT NOW

## Quick controls
- `bin/lgtv-capture {on|off|status}` — the MITM traffic capture toggle
- `bin/lgtv-revert-all`             — undo EVERYTHING (keeps SSH access); TV reboot also reverts RAM changes

## What is LIVE now
| Thing | State | Persistence | Revert |
|---|---|---|---|
| Root SSH (`ssh lgtv`, :22) | ON | flag file (persists) | rm webosbrew_sshd_enabled (ACCESS.md) |
| Telnet failsafe (:23) | ON | HBC default | touch webosbrew_telnet_disabled |
| TV DNS → Pi-hole | ON | connman setting persists; resolv bind-mount is RAM | revert-all / reboot+restore |
| Domain logging (Pi-hole) | ON | — | n/a (just logging) |
| MITM capture (route via Mac) | ON | RAM | lgtv-capture off / reboot |
| mitmproxy CA trusted on TV | ON | RAM bind-mounts | umount / reboot |
| on-TV voice watcher | ON | RAM | pkill nlp-watch.sh / reboot |

## Proven working (with evidence in capture/flows/_selftest_proof/ and CHANGES.md #7)
- TLS decryption of LG hosts: plaintext GET/POST captured to lgtvsdp/lgtvcommon/lgsmartad/lgthinq.
- `lgtvcommon` CDP beacon is a real telemetry API (`AUTH.ERR.106 No Authorization Header`).
- Voice endpoint reachable + decrypted: `POST he-eu-ai.lgthinq.com/voice/stt/v1/dictation/upstream`.
- Audio-upload save + transcription save: working (addon).
- "big brother" canary detection: working (fires on URL/headers/body).
- Idle behavior: on-TV watcher logged ZERO mic/upload events in 32 min idle (not always-listening at idle).

## To capture REAL data — use the TV (capture records automatically)
- Watch content → ACR fingerprint payloads → capture/flows/payloads/
- Press remote mic + speak → audio → capture/flows/audio/ + transcription
- Say "big brother is listening" (with, then without, the mic button) → capture/flows/CANARY-HITS.txt
  and cross-check /tmp/nlp-watch.log on the TV for unprompted activity.

## Keep the Mac up while capturing (TV internet routes through it while capture is ON).
