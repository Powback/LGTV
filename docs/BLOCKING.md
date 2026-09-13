# LG webOS 4.4.3 — Low-Invasiveness Telemetry Blocking Plan

**Target:** one rooted LG Smart TV, webOS **4.4.3** (2018–2019-era model), DNS already
routed through Pi-hole. Goal: **maximum privacy for minimum fiddling** — lean on the
network layer (Pi-hole + a two-line router rule) and on-device toggles, and touch the
TV's root filesystem only if you opt into the "maximum" tier.

Primary source: **Level1Techs — "LG TV Block Mini-How-to"**, by `wendell`
<https://forum.level1techs.com/t/lg-tv-block-mini-how-to/255178> (recon target there was
an OLED65G5WUA on webOS 10.2.1; the *mechanisms* transfer, but the *domain names* differ
by webOS generation — this TV is much older and phones home to `lgtvsdp.com`, not the
newer `nextlgsdp.com`). Domain roles corroborated against community blocklists and ACR
research (see Sources at the end).

> This is privacy hardening of a device you own. Nothing here is applied automatically.

---

## 1. The three L1T approaches and their tradeoffs

The forum guide's core insight: **LG phones home over several independent channels, and no
single mechanism stops all of them.** It defines a layered model. The three that matter
for a low-invasiveness setup:

| Approach | What it is | Survives TV reboot? | Survives factory reset? | Invasiveness | Catches hardcoded IPs? |
|---|---|---|---|---|---|
| **A. DNS blocklist** (Pi-hole) | Resolver returns `0.0.0.0`/NXDOMAIN for LG/ad/ACR domains | Yes | **Yes** (it's off-TV) | **Very low** — no TV changes | **No** (DNS can't touch an IP) |
| **B. Router firewall / IP block** | Router drops outbound packets to specific IPs/ports | Yes | **Yes** (off-TV) | Low (one-time router config) | **Yes** — the only thing that can |
| **C. On-TV root layers** (init.d hosts bind-mount, consent-decline scripts, HBChannel block flags) | Root scripts on the TV block hosts and set every EULA/consent flag to *declined* | Yes | **No** — wiped by factory reset | **High** — SSH, scripts, run every boot | hosts can't, but consent-decline stops collection at the source |

**Key tradeoffs the guide calls out:**

- **DNS is the most robust layer** precisely because it lives outside the TV: it survives
  reboots, factory resets, and even a re-root, and it's the only layer that can stop the
  boot-time OTA check (which runs *before* any on-TV hosts mount exists). **For a TV whose
  DNS already flows through Pi-hole, this is 90% of the win for ~zero effort.**
- **DNS can never block an IP.** LG hardcodes fallback IPs in firmware (see §3). Only a
  **router firewall** stops those.
- **On-TV consent-decline (Layer C)** is the "we own the glass" move — it sets LG's
  `eula`/`option` flags to *declined* so services believe they have no permission to
  collect, independent of the network. It's the strongest ACR/voice kill, but it's the
  most invasive (root SSH + scripts) and it's **wiped by a factory reset**, so it must be
  re-applied if you ever reset. On webOS 4.4.3 the file *shapes* differ from the guide's
  webOS 25 target, so treat the exact `eula` writes as unverified for this firmware.
- **Don't block `.lge.com` wholesale** — it kills the Content Store and other legitimate
  services. Only block the specific subdomains listed below.
- On-TV `iptables` is a dead end: the guide found **no netfilter kernel modules** on
  webOS, so firewall rules silently fail on the TV itself. Firewall = **router only**.

**Recommendation for this TV:** do **A + B + on-device settings (§4)**. That is
low-invasiveness, fully survives factory reset, and needs no root work. Add the on-TV
consent-decline layer only if you want ACR/voice killed at the source (§5, "maximum").

---

## 2. Pi-hole blocklist tailored to THIS TV

All domains below were **observed contacting this TV** in its Pi-hole query log (counts in
parens) unless marked *(preemptive)*. Two ways to enter them in Pi-hole:

- **Exact domains** → *Domains → Add domain to blacklist* (exact). Precise, no collateral.
- **Regex** → *Domains → Add regex filter*. One line covers a whole zone incl. future
  subdomains. Pi-hole regex `(\.|^)zone\.tld$` matches the apex and every subdomain.

Below, each category gives the exact observed domains plus the equivalent whole-zone regex.

### 2a. ACR — Alphonso screen-content fingerprinting  ✅ SAFE TO BLOCK
Alphonso is LG's ACR partner ("Live Plus"); it fingerprints what's on screen. The whole
`alphonso.tv` zone is nothing but ACR — safe to nuke wholesale.

```
# Exact (observed):
prov-lg.alphonso.tv            # (2326 hits — the primary ACR beacon)
eu-acr110.alphonso.tv
eu-bl-server.alphonso.tv
eu-clockskew.alphonso.tv
# Regex (recommended — covers all of the above + any new eu-acrNNN endpoints):
(\.|^)alphonso\.tv$
```
**Breaks:** Live Plus / "what's on now" content-based recommendations. **Desired.**

### 2b. Ads  ✅ SAFE TO BLOCK
```
# Exact (observed):
ch.info.lgsmartad.com
ch.ad.lgsmartad.com
googleads.g.doubleclick.net
# Regex (recommended):
(\.|^)lgsmartad\.com$
(\.|^)doubleclick\.net$          # optional; blocks Google ad serving network-wide
```
`info.lgsmartad.com` is polled by `admanager` roughly every 60 s. **Breaks:** on-TV ads,
home-screen ad tiles. **Desired.**

### 2c. CDP / telemetry beacons  ✅ SAFE TO BLOCK
LG "Customer Data Platform" beacons + crash/analytics upload + Amazon app telemetry.
```
# Exact (observed):
eic.cdpsvc.lgtvcommon.com
cdpbeacon.lgtvcommon.com
service.lgtvcommon.com
ch.rdx2.lgtvsdp.com                       # rdx = crash/analytics upload; safe
global.telemetry.insights.video.a2z.com   # Amazon (Prime Video) telemetry
# Regex — whole lgtvcommon.com zone (L1T marks *.lgtvcommon.com wildcard-safe):
(\.|^)lgtvcommon\.com$
```
`lgtvcommon.com` also carries `nudge` (promos), `recommend`, home-provisioning and more —
all fine to lose. **Breaks:** telemetry, promo nudges, recommendations. **Desired.**
> Note: `ch.rdx2.lgtvsdp.com` (crash upload) is safe, but the **apex `lgtvsdp.com` is
> NOT** — see §2f tradeoff. Block the `rdx2` subdomain exactly; don't regex the zone in
> the minimal tier.

### 2d. OTA / firmware updates  ✅ SAFE (and desirable — never update a rooted TV)
The L1T guide is emphatic: **never accept an OS update once rooted** (an update can strip
root and re-arm every phone-home). Blocking these is a feature, not a cost.
```
# Exact (observed):
snu.lge.com                # OTA check (CheckSWAutoUpdate)
ngfts.lge.com              # firmware / content download (OTA on webOS 4.x)
eic-ngfts.lge.com          # regional firmware download
# Preemptive OTA siblings (block now; blocking OTA is desired):
su.lge.com
su-ssl.lge.com
nsu.lge.com
snu-dev.lge.com
su-dev.lge.com
```
**Breaks:** firmware auto-update. **Desired.** ⚠️ DNS-blocking OTA is *incomplete* on its
own — LG hardcodes an OTA fallback **IP** that bypasses DNS. See §3.

### 2e. Voice  ⚠️ OPTIONAL — blocking kills voice search
```
# Exact (observed):
he-eu-ai.lgthinq.com       # ThinQ voice speech-to-text backend
```
Wake word and local voice commands are on-device and survive; the **remote NLP/STT
backend** is what this domain serves. **Breaks:** voice search / assistant results.
The L1T author's take: *"I'd recommend not using local voice services"* and blocking the
voice backend — but this is your call. Leave it unblocked if you use voice.

### 2f. Content Store / app store  ⚠️ TRADEOFF — do NOT block in the minimal tier
```
ch.lgtvsdp.com             # (observed) LG Service Delivery Platform on webOS 4.x
(\.|^)lgtvsdp.com$         # whole zone
(\.|^)lgappstv.com$        # app store / LG Shop
```
On webOS 4.x, **`lgtvsdp.com` is the backbone for the Content Store, app updates and home
provisioning** (the newer firmware's `nextlgsdp.com` role). Blocking the apex **breaks the
Content Store and app installs.** Block these **only** if you accept losing the app store
(homebrew installs keep working — they use the local `com.webos.appInstallService/dev`
path). In the minimal tier, block just `ch.rdx2.lgtvsdp.com` (crash, §2c) and leave the
rest of the zone reachable.

`lgtvonline.lge.com` (observed) is an LG online-services/portal endpoint of uncertain
role — put it in the **maximum** tier and verify the home screen / EULA prompts still
behave after blocking.

---

## 3. What DNS can't stop: hardcoded IPs → router firewall

LG firmware contains **hardcoded IP fallbacks** that are used exactly when DNS fails —
i.e. the moment your Pi-hole blocks the domain. **Pi-hole cannot touch these; a firewall
must.** For this TV:

| IP | Role | Why it bypasses DNS |
|---|---|---|
| `156.147.69.32` | LG software-update server (`CheckSWAutoUpdate.laf`, port often `:8080`) | Hardcoded OTA fallback — used when `snu/su.lge.com` won't resolve |
| `165.244.62.249` | LG server (Korea `165.244.0.0/16` netblock) | Hardcoded LG endpoint that bypasses the resolver |

**Give the TV a DHCP reservation (fixed IP) first**, then add a router firewall rule. On
the ASUS GT-AX11000 (this LAN's router), stock firmware can't easily do per-source
outbound IP blocks; ASUS-Merlin (or any OpenWrt/pfSense box) can via a firewall script.
These IPs are LG-only, so blocking them for the whole LAN is safe:

```sh
# ASUS-Merlin: /jffs/scripts/firewall-start  (chmod +x), or OpenWrt firewall:
iptables -I FORWARD -d 156.147.69.32 -j REJECT
iptables -I FORWARD -d 165.244.62.249 -j REJECT
# (or scope to the TV only:)
#   iptables -I FORWARD -s <TV_IP> -d 156.147.69.32 -j REJECT
#   iptables -I FORWARD -s <TV_IP> -d 165.244.62.249 -j REJECT
```

**Optional hardening (L1T Layer 1.2):** force the TV to use *only* your Pi-hole by
rejecting outbound port 53 from the TV to anything except the resolver — some webOS builds
try to hardcode a public DNS (e.g. `8.8.8.8`), which would bypass Pi-hole entirely:
```sh
iptables -I FORWARD -s <TV_IP> -p udp --dport 53 ! -d <PIHOLE_IP> -j REJECT
iptables -I FORWARD -s <TV_IP> -p tcp --dport 53 ! -d <PIHOLE_IP> -j REJECT
# also redirect/block DoH (853) and known DoH hosts if you want to be thorough
```
Since Pi-hole is already seeing 2326 queries to `prov-lg.alphonso.tv`, **this TV is
currently honoring Pi-hole for DNS** — the anti-bypass rule is belt-and-suspenders, not
urgent.

---

## 4. On-device settings — the least-invasive first layer (do this first)

Toggling consents in the webOS UI is the lowest-effort, zero-risk layer, and it stops
collection at the source for ACR/ads/voice even before DNS. On **webOS 4.4.3** the menu
labels/paths differ from newer models and can move between point releases — if a path
below doesn't match, use the Settings **search** box and type the feature name.

- **ACR off (the big one):** `Settings → All Settings → General → Live Plus → Off`.
  ("Live Plus" *is* LG's ACR/Alphonso feature.)
- **Interest-based ads / viewing info:** `Settings → General → About This TV →
  User Agreements` → **un-tick** "Interest-Based Advertisement" and "Viewing Information"
  (a.k.a. Voice/Viewing information agreements). Some webOS 4.x builds also expose
  `Settings → General → Advertisement → Limit AD Tracking = On`.
- **Voice opt-out:** in the same **User Agreements** screen un-tick the **Voice
  Information** agreement; and disable voice recognition under `Settings → General →
  Voice Recognition` (or AI Service) if you don't use it.
- **Decline optional agreements generally:** in `User Agreements`, un-tick everything
  optional (Marketing/Promotions, Personalized Advertising, Voice, Viewing). Leaving only
  the mandatory service agreement keeps smart features; declining all pushes it toward a
  "dumb display."
- Re-check these after any settings change or (if one ever slips through) firmware update —
  LG has been known to silently re-enable them.

---

## 5. Recommended minimal vs maximum tiers

### ✅ Recommended minimal (low-invasiveness, no TV root work, survives factory reset)
1. **On-device toggles (§4):** Live Plus **off**, decline Interest-Based Ads + Viewing +
   Voice agreements.
2. **Pi-hole (§2):** add the ACR, Ads, CDP/telemetry, and OTA groups —
   `(\.|^)alphonso\.tv$`, `(\.|^)lgsmartad\.com$`, `(\.|^)lgtvcommon\.com$`,
   `ch.rdx2.lgtvsdp.com`, `googleads.g.doubleclick.net`,
   `global.telemetry.insights.video.a2z.com`, and the `*.lge.com` OTA subdomains
   (`snu/su/su-ssl/nsu/ngfts/eic-ngfts` + dev siblings).
   **Leave `lgtvsdp.com` apex, `lgappstv.com` reachable** (keeps the Content Store), and
   leave `he-eu-ai.lgthinq.com` unblocked if you use voice.
3. **Router firewall (§3):** REJECT `156.147.69.32` and `165.244.62.249`.

This kills ACR, ads, CDP beacons, crash/analytics, Amazon telemetry, and firmware
auto-update — the entire measured leak — while keeping the app store and voice.

### 🔒 Maximum blocking (accepts broken features)
Everything above, **plus**:
- Pi-hole: `(\.|^)lgtvsdp\.com$`, `(\.|^)lgappstv\.com$` (**loses Content Store /
  app installs** — homebrew still works), `he-eu-ai.lgthinq.com` and the whole
  `(\.|^)lgthinq\.com$` / `(\.|^)lgtviot\.com$` zones (**loses voice search + ThinQ/IoT**),
  `lgtvonline.lge.com`.
- Router: add the anti-bypass DNS rule (block outbound :53/:853 except Pi-hole).
- **On-TV consent-decline (L1T Layer 4)** via root SSH: set every `eula`/`option` consent
  flag to *declined* and drop the ACR opt-out marker so LG services have no *authorization*
  to collect, not just no *network*. Strongest ACR/voice kill; **wiped by factory reset**,
  so re-apply if you ever reset. On webOS 4.4.3 verify the `eula` file shape before writing
  (the guide's shapes are from webOS 25) and back up first.

---

## 6. Domains the L1T community flags that this TV hasn't hit yet — but likely will

Add these to Pi-hole preemptively (all safe unless noted); they're the rest of the LG
phone-home surface for TVs of this family:

- **Ad partners** flagged by ACR research/community lists: `smartclip.net`,
  `yumenetworks.com`.
- **Crash/analytics siblings:** `rdl.lgtvcommon.com` (covered if you regex the
  `lgtvcommon.com` zone), `ibs.nextlgsdp.com` / `ibsstat.nextlgsdp.com`,
  `rdx2.nextlgsdp.com`.
- **Newer SDP zone** (`nextlgsdp.com`): this TV uses the older `lgtvsdp.com`, but if
  firmware ever advances it'll switch to `nextlgsdp.com` — `(\.|^)nextlgsdp\.com$` is safe
  to pre-block for telemetry (mind the same Content-Store tradeoff the SDP apex carries).
- **ThinQ / IoT** beyond the one voice STT host: `api.lgtviot.com`,
  `commonpush.lgtviot.com`, `push.lgtviot.com`, `common.lgthinq.com`,
  `connect-client.lgthinq.com` (blocking loses ThinQ/IoT).
- **Voice web search backend:** `lgsmartweb.com` (blocking loses voice *results*).
- **SDX misc:** `lggalleryplus.com` (Gallery+ screensaver ads), `tv.wiselg.com`.
- **AWS IoT push:** push notifications use a **per-device** `*.amazonaws.com` MQTT broker
  cert — **not cleanly DNS-blockable**; only block `*.amazonaws.com` at the firewall if
  you accept broad collateral, or sniff the exact broker IP and REJECT it.

---

## Sources
- Level1Techs — LG TV Block Mini-How-to (primary): <https://forum.level1techs.com/t/lg-tv-block-mini-how-to/255178>
- Perflyst PiHoleBlocklist / SmartTV.txt: <https://perflyst.github.io/PiHoleBlocklist/SmartTV.txt>
- TheShawnMiranda/LG-TV-Ad-Block, hugobatista/lg-tv-ad-block, samsapti/LG-webOS-Blocklist, athimannil/webos-pihole-blocklists (community LG lists cited by the forum thread)
- webosbrew / RootMyTV (core OTA domains, root tooling): <https://www.webosbrew.org/>
- ACR / Alphonso "Live Plus" research: <https://arxiv.org/html/2409.06203v1> ; AppleInsider, Pocket-lint, Consumer Reports (Live Plus off + User Agreements opt-out paths)
