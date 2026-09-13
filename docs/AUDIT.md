# LG TV network audit — findings & live capture

## Status (2026-09-09)
- **Domain history:** `audit/domains-pihole-history.txt` (128 domains the TV contacted, ranked).
- **Static/firmware scan:** `audit/domains-static-raw.txt` (all URL/host strings), `audit/hardcoded-ips.txt`.
- **Live capture:** RUNNING. TV DNS now flows through Pi-hole (192.168.50.100). Verified.
- **Voice payload MITM + "big brother" canary:** planned, not yet armed (see below).

## Headline findings
The TV's #1 most-contacted domain is **`prov-lg.alphonso.tv` (2,326 queries)** — Alphonso
is the ACR (automatic content recognition) vendor that fingerprints on-screen content.
Full tracker set contacted:
- **Alphonso ACR:** prov-lg / eu-acr110 / eu-bl-server / eu-clockskew `.alphonso.tv`
- **LG SDP/tracking:** ch.lgtvsdp.com, ch.rdx2.lgtvsdp.com
- **LG customer-data-platform beacons:** eic.cdpsvc / cdpbeacon / service `.lgtvcommon.com`
- **LG Smart Ads:** ch.info / ch.ad `.lgsmartad.com`
- **LG services/OTA:** ngfts / snu / lgtvonline / eic-ngfts `.lge.com`; hardcoded OTA IP 156.147.69.32
- **Voice STT:** he-eu-ai.lgthinq.com — only 5 queries (session-based, NOT always-on)
- **3rd-party:** googleads.g.doubleclick.net, global.telemetry.insights.video.a2z.com (Amazon), Netflix telemetry

## Voice: what happens (see VOICE-ANALYSIS.md for full teardown)
- Transcription is 100% CLOUD (he-*-ai.lgthinq.com), 16 kHz PCM streamed up, text back.
- Remote mic and app/far-field mic use the SAME uploader (`nlp`) and SAME endpoint.
- At idle: `nlp` holds ZERO network sockets; whole TV had ZERO established connections.
  → not continuously listening/uploading (snapshot; MITM confirms over time).
- Standby-record capability exists in the binary (`nlp_autorecord_*` + prepareActiveStandby)
  but trigger conditions unproven — the MITM + on-TV watcher settle it.

## How to query the LIVE domain capture (ongoing)
```bash
# all TV domains in the last hour
docker exec pihole pihole-FTL sqlite3 /etc/pihole/pihole-FTL.db \
  "SELECT datetime(timestamp,'unixepoch','localtime'),domain FROM queries \
   WHERE client='192.168.50.143' AND timestamp>strftime('%s','now')-3600 ORDER BY timestamp DESC;"

# distinct new domains today, ranked
docker exec pihole pihole-FTL sqlite3 /etc/pihole/pihole-FTL.db \
  "SELECT domain,COUNT(*) c FROM queries WHERE client='192.168.50.143' \
   AND timestamp>strftime('%s','now','start of day') GROUP BY domain ORDER BY c DESC;"
```

## On-TV voice-activity watcher (running)
`/tmp/nlp-watch.sh` → logs to `/tmp/nlp-watch.log` on the TV every 2s: any nlp inet
socket, external connection, autorecord/pcm file, or mic-buffer open. Read it with:
`ssh lgtv 'cat /tmp/nlp-watch.log'`. This is the "is it listening when I didn't ask?" log.
(RAM; restart with `ssh lgtv 'setsid /tmp/nlp-watch.sh </dev/null >/dev/null 2>&1 &'`.)

## The "big brother" canary (planned)
User will randomly say "big brother is listening" near the TV/remote mic over 1-2 days.
To catch it we MITM the voice STT endpoint and search the returned transcription (plain
text) — and optionally re-transcribe the uploaded audio locally.
Setup (to arm):
1. Apply the staged mitmproxy CA on the TV (bind-mount the augmented bundles) + restart nlp.
2. Pi-hole local-DNS override: he-eu-ai.lgthinq.com / he-us-ai.lgthinq.com → 192.168.50.99 (Mac).
3. Mac: mitmdump reverse → real lgthinq (pinned IP), save flows to audit/mitm/.
4. Cron greps new flows for "big brother"; push notification on hit.
Tradeoff: while armed, LG voice STT depends on the Mac proxy being up. Fully revertible
(remove the Pi-hole override + CA bind-mount).
