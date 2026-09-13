# LG TV traffic capture (transparent MITM)

Easy on/off decrypting capture of the TV's tracker/telemetry/voice traffic.

## Usage
```bash
~/Projects/LGTV/bin/lgtv-capture on       # arm: route TV via Mac, decrypt targets
~/Projects/LGTV/bin/lgtv-capture off      # disarm: TV routes direct, capture stops
~/Projects/LGTV/bin/lgtv-capture status   # show state, disk usage, CA status
```

## How it works
- TV default route → Mac (192.168.50.99). Mac: IP-forwarding + pf NAT + pf rdr 80/443 → mitmdump:8080.
- mitmdump transparent, `--allow-hosts` = only tracker/telemetry/voice hosts get DECRYPTED & SAVED.
  Everything else (Netflix/YouTube video, QUIC) PASSES THROUGH untouched → apps keep working, disk stays small.
- TV trusts our mitmproxy CA (bind-mounts on /etc/ssl + sdp-ca.pem). `--ssl-insecure` so mitmproxy
  accepts LG's own upstream certs.
- `capture_addon.py`: writes a readable per-flow log, saves voice audio + ACR/ad payloads as proof,
  and scans every request/response for the CANARY phrase ("big brother") → `flows/CANARY-HITS.txt`.

## Output (in capture/flows/)
- `YYYYMMDD.flows`  — raw mitmproxy flows (replay: `mitmdump -nr file`)
- `YYYYMMDD.log`    — readable: method, url, status, byte sizes, SAVED/CANARY markers
- `audio/`          — saved voice-STT uploads (PCM) + their responses (transcription)
- `payloads/`       — saved ACR / ad / CDP telemetry request+response bodies
- `CANARY-HITS.txt` — any flow containing "big brother"

## Safety / toggle
- SSH is unaffected (LAN-local, not via default route). If the Mac/proxy dies, `off` (or a TV reboot)
  restores direct routing. `on` auto-reverts if the TV loses internet.
- Disk guard: refuses to start if flows/ exceeds MAX_MB (3000). Only target hosts are saved (small).

## The canary test (proving always-listening, or not)
1. Capture ON. 2. Say "big brother is listening" AFTER pressing the remote mic button →
   expect a hit in CANARY-HITS.txt (proves cloud round-trip). 3. Say it WITHOUT pressing anything →
   a hit here would prove unprompted listening. The on-TV watcher (/tmp/nlp-watch.log) also logs any
   unprompted mic/upload activity.
