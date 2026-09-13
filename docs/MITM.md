# MITM plan — intercepting the TV's TLS traffic

Goal: full visibility into what the TV sends/receives (voice uploads, telemetry,
OTA, ThinQ, ads), decrypted. We own the device + root, so we can trust our own CA.

## Safety first (this must not touch SSH)
- **SSH is LAN-local** (Mac .99 ↔ TV .143, same /24) → goes direct via ARP, NOT via
  the default gateway. Rerouting the TV's *internet* through the Mac does not affect
  LAN SSH. dropbear ignores the CA store entirely.
- **CA injection is bind-mounts over copies** → reboot reverts. Cannot lock us out.
- **If the proxy dies:** with the DNS-redirect approach the TV just fails to reach the
  redirected hosts (no internet-wide outage). With the gateway approach, restore with
  one command: `ssh lgtv 'ip route replace default via 192.168.50.1'`.
- Telnet :23 failsafe remains throughout.

## Prereqs (DONE)
- mitmproxy via `uvx --from mitmproxy mitmdump` (v12.2.3). CA at `~/.mitmproxy/`.
- Augmented CA bundles staged on TV in `/var/lib/webosbrew/mitm/` (NOT yet bind-mounted):
  - `ca-certificates.crt` (system + mitm), `sdp-ca.pem` (nlp + mitm).

## Step A — trust our CA on the TV (apply the staged bundles)
```bash
ssh lgtv '
  # system store (general HTTPS / webOS services)
  mount --bind /var/lib/webosbrew/mitm/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
  # nlp voice store
  mount --bind /var/lib/webosbrew/mitm/sdp-ca.pem /usr/share/ca-certificates/sdp/sdp-ca.pem
  mount | grep -E "ca-certificates.crt|sdp-ca.pem"   # confirm 2 binds
'
```
Revert: `ssh lgtv 'umount /etc/ssl/certs/ca-certificates.crt /usr/share/ca-certificates/sdp/sdp-ca.pem'` (or reboot).
NOTE: services that already loaded the old CA into memory need a restart to pick this
up — restart the specific daemon (`restart nlp` via luna, or `kill` it) rather than
rebooting, or just reboot once with the binds active (won't persist — see Step D).

## Step B — capture strategy (pick one)

### B1. DNS-redirect (targeted, low-risk) — RECOMMENDED FIRST
Point the voice/telemetry hostnames at the Mac; run mitmproxy in reverse/transparent.
- On Pi-hole (192.168.50.100), add local DNS overrides → Mac IP (192.168.50.99):
  `he-us-ai.lgthinq.com`, `he-eu-ai.lgthinq.com`, and the ThinQ/ads/OTA hosts of interest.
- Run mitmproxy transparent listener on the Mac:
  ```bash
  uvx --from mitmproxy mitmweb --mode transparent --showhost -p 8080 --web-port 8081
  ```
- Pros: no routing change, TV internet unaffected if proxy stops. Catches the target
  cloud endpoints. Cons: misses hardcoded-IP traffic (rare) and hosts we didn't list.

### B2. Full transparent gateway (everything) — ESCALATION
Make the Mac the TV's router so ALL TCP is seen.
- Mac: enable IP forwarding + pf NAT + redirect 80/443 → mitmproxy transparent 8080.
- TV: `ip route replace default via 192.168.50.99` (instant revert to `.1`).
- Pros: total coverage. Cons: Mac must stay up; more macOS pf setup. Do after B1 works.

## Step C — trigger + observe
With capture live: press the remote mic button and speak; open the LG voice/search
overlay; leave it in standby; pull TV network then restore. Watch mitmweb for:
- POST to `/voice/stt/v1/dictation/upstream` (the PCM upload) + `x-api-key` header
- any upload NOT triggered by a button (the "always listening" test)
- ThinQ/ads/OTA/ACR beacons

Correlate with on-TV: `watch -n1 'ls -la /tmp/nlp/autorecord/ /dev/shm/libMRCU-shm*'`
and `lsof -p $(pidof nlp) | grep -E "TCP|shm|pcm"`.

## Step D — persistence (optional, later)
Nothing above survives reboot (by design). To make the CA trust + redirect persist,
add a script under `/var/lib/webosbrew/init.d/` (Homebrew run-parts) that re-applies
the two bind-mounts on boot. Only do this once the setup is proven and we're happy to
keep it; leaving it non-persistent is the safer default.

## Open questions the MITM answers
1. Does `nlp` ever upload audio without a button press (idle / standby)?
2. Does the offline-buffer (`autorecord`) ever fill and flush on reconnect?
3. What exactly is in the ThinQ/ACR/ads beacons (payloads, IDs)?
4. Does the remote mic path differ from the app/far-field path? (expected: same endpoint)
