# eMMC dump — deep analysis findings (2026-09-09)

From the background analysis of `dump/mmcblk0.img` (rootfs squashfs + data partitions).
Report agent completed but did not persist its full markdown; key cross-checked findings:

## Credentials / keys found in firmware (plaintext private keys)
- `nlpadapter/device_attestation_key.pem` — voice/assistant device attestation private key.
- `secumgr/dmost_prv.pem`, `secumgr/CDSPriv.pem` — LG signing / CDS private keys.
- `remotediag/device.pem` — diagnostics **mTLS client cert** (LG can pull remote diagnostics).
- Trust store contains the **distrusted WoSign CA** (browsers removed it years ago; still trusted here).

## Other
- Crash/bug reports are filed to LG **Jira** (the `bugreport` path uses a `jira` node module) —
  i.e. device crash data (and whatever context it bundles) flows into LG's internal tracker.
- Rootfs squashfs is stock LG with **no webosbrew markers** — the jailbreak persistence lives in
  the writable partition (`/var/lib/webosbrew/`), consistent with what we see live.
- lighttpd runs at boot.

## Notes / caveats
- `remotediag` mTLS client cert = a channel for LG-initiated remote diagnostics. Worth watching in
  the MITM (add `remotediag`/diagnostic hosts to capture TARGETS if they appear in DNS).
- The attestation/signing keys explain why full impersonation of LG's cloud is possible with root
  but is also why the device can prove its identity to LG — relevant if spoofing identity later.
- To regenerate the full report: re-run the dump-analysis agent (it extracts squashfs to scratch).

## Cross-check adds (from dump agent, 2026-09-09) — not yet seen on wire
Add to MITM capture / Pi-hole blocklist:
- ACR: cid.samba.tv, fsui.cid.samba.tv, eulacheck.alphonso.tv
- ThinQ IoT (REMOTE CONTROL channel — highest MITM value): api.lgtviot.com, push.lgtviot.com, sports.lgtviot.com
- CDP/telemetry: nudge/recommend/wau/homeprv/netflixvoice.lgtvcommon.com
- App-store stats: ibs/ibsstat/lgrecommends.lgappstv.com, smartshare.lgtvsdp.com
- Voice STT variants: he-us-ai/he-kr-ai/*-qa-*.lgthinq.com
- Dev OTA server shipped in production (flag if it ever resolves): su-dev.lge.com

Hardcoded IPs (bypass DNS): 156.147.69.32:8080 (OTA .laf), 165.244.62.249:6120/6230/6240 (LG KR).
Diagnostic/remote channels: rdxd/uploadd -> ch.rdx2.lgtvsdp.com (log bundles), remotediag mTLS
(client+server certs are in dump at /usr/share/remotediag/ -> we can decrypt/impersonate if needed),
ThinQ IoT (remote commands), SSAP ws :3000/:3001.

NOTE: capture TARGETS regex updated to add lgtviot|samba\.tv|lgappstv (2026-09-09).
Also: unit is a CHE (Switzerland) RETAIL STORE-DEMO unit (demoMode:on); IP-control PIN "828" in plaintext (IP control off).
