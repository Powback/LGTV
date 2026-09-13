# LG TV — Data-Protection Complaint: Evidence Plan

**Not legal advice.** This organizes the technical facts and methodology for a possible
complaint to a data-protection authority. Pair with the DPA's complaint process / a lawyer.

## Jurisdiction
- Unit is configured **CHE (Switzerland)** → primary venue is the **FDPIC** (Federal Data
  Protection and Information Commissioner) under the **revised nFADP** (in force 2023-09-01).
  Note: FDPIC investigates and issues recommendations/rulings; direct fines are narrower than GDPR.
- If EU residents are affected / for stronger fining power → **GDPR**, filed with a local DPA;
  LG's EU establishment triggers one-stop-shop lead-authority handling.
- Separate controllers/processors to name: **LG Electronics**, **Alphonso** (US ACR), **Samba TV**
  (US ACR, `libcid.so`). US recipients → **Chapter V third-country transfer** questions.

## The legal elements we must evidence (map each to a proof)
| Element | GDPR/nFADP hook | What proves it |
|---|---|---|
| It's **personal data** | Art 4(1) | Persistent identifiers leaving the device: device ID, **IFA** (ad ID), LGUDID, tied to viewing data |
| **No valid consent / opt-out ignored** | Art 6, 7; Art 7(3) withdrawal | A/B test: data still uploaded with ACR/ads **declined** |
| **Consent not freely given/granular/informed** | Art 7, 4(11) | Video of the setup flow: bundled agreements? pre-ticked? forced? |
| **Transparency failure** | Art 12–14 | Is Alphonso/Samba TV disclosed by name? Is a policy reachable? |
| **Third-country transfer** | Ch. V | Decrypted uploads + IP geolocation showing US destinations |
| **Purpose limitation / minimisation** | Art 5(1)(b),(c) | Payload contents vs. what a TV needs to function |

## Evidence status (have vs. need)
HAVE:
- DNS history: `prov-lg.alphonso.tv` = #1 host (2,326 hits) while on-disk `livePlus:"off"`.
- Firmware proof two ACR engines are present (Alphonso + Samba TV) capturing audio+video, panel+HDMI.
- A working MITM that decrypts LG hosts; the device's persistent IDs (IFA, LGUDID, deviceId) identified.

NEED (the gap that turns "suspicious" into "provable"):
1. **Decrypted ACR upload payload** showing content fingerprints + a persistent identifier
   (not just provisioning/keepalive). NB: acr2 may pin its cert → may need the same CA step as nlp.
2. **A/B under a real consumer opt-out** (see demo-unit fix) — data flow with ACR/ads DECLINED vs ACCEPTED.
3. **Setup-flow capture** (video) showing how consent is actually requested.

## CRITICAL caveat — the demo-unit problem
This unit is a **retail store-demo** (`demoMode:on`). Its consent state is NOT a normal consumer's
and a demo set is not representative — an opponent/DPA will discount it immediately. **Before any
evidence run: factory reset, exit demo mode, complete initial setup as a normal user, DECLINING every
data agreement, on video.** Only evidence gathered in that state is credible.

## Methodology for defensible evidence (reproducible + chain of custody)
1. Factory reset → normal consumer setup, **decline all** ACR/ads/viewing-info agreements (record on video).
2. Note exact firmware, region, date/time, device IDs. Hash the capture files (sha256) as collected.
3. Play a **known reference clip** at a known timestamp; keep capture running.
4. Retain: raw pcap/flows + decrypted payloads + the DNS log + on-TV consent flag files
   (`/var/luna/preferences/eula`, `/mnt/lg/cmn_data/acr/data/eula_allowed`).
5. Repeat with ACR **accepted** → baseline showing the difference (or lack of one).
6. Everything timestamped, hashed, reproducible by a third party from the written method.

## Evidence package (annexes for the complaint)
- A. Executive summary (plain language: what data, to whom, despite what consent).
- B. Method (so the DPA's technical team can reproduce).
- C. Consent-flow video + screenshots.
- D. DNS log (destinations + volumes).
- E. Decrypted upload payloads (personal data + fingerprints), with hashes.
- F. Destination geolocation (US transfers).
- G. Firmware artefacts (ACR engines present, opt-out flag states).

## Realistic outcomes
- FDPIC/DPA can investigate, demand answers, order changes; GDPR route can fine. Individual
  monetary recovery is unlikely — value is enforcement + public record.
- Highest-impact parallel: contribute the reproducible capture to the ongoing
  Gamers Nexus / Level1Techs investigation (responsible disclosure).
