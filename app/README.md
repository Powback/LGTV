# PowDash — TV overlay app + state service

A rooted-LG webOS overlay (`com.pow.dash`) that shows an ambient clock, live
messages, or a dashboard — driven in real time from the fleet. No refresh: the
app holds one SSE connection and re-renders the instant anything pushes new state.

## Parts
- `com.pow.dash/` — the webOS app (Chrome-53-safe HTML/JS). Subscribes to
  `http://powdash.pow/api/events`. Modes: **idle** (clock/date), **message**
  (big centered text), **dashboard** (fullscreen image auto-refresh, or iframe).
- `powdash-server/` — tiny Node SSE state service (no deps). Deployed on the fleet
  as `powdash.pow` (Docker + Traefik file-route `PowStation/config/traefik/dynamic/powdash.yml`).
  Visiting `http://powdash.pow/` in any browser shows the same live dashboard UI.

## Control (via the `lgtv` CLI)
```
lgtv say "Dune Part Two finished downloading"      # message
lgtv notify "Reboot in 30s" 10                     # message, auto-clears after 10s
lgtv dash http://sabnzbd.pow iframe                # embed a page
lgtv dash https://host/snapshot.png image 5000     # image, refresh every 5s
lgtv idle                                          # back to the ambient clock
lgtv launch com.pow.dash                           # (re)open the overlay
```
Or POST directly: `curl -X POST http://powdash.pow/api/state -d '{"mode":"message","message":"hi"}'`

State shape: `{mode:'idle'|'message'|'dashboard', message, src, srcType:'image'|'iframe', refresh, ttl}`.
`ttl>0` auto-reverts to idle after that many ms.

## Deploy / update
- **Server:** `cd powdash-server && docker compose up -d --build`
  (first time only: the Traefik file-route already exists; a Traefik restart may be
  needed for it to load — file-watch is unreliable over Colima virtiofs.)
- **App:** `ares-package com.pow.dash -o /tmp && scp /tmp/com.pow.dash_*.ipk lgtv:/tmp/pow.ipk`
  then `ssh lgtv 'luna-send -n 1 luna://com.webos.appInstallService/dev/install "{\"id\":\"com.pow.dash\",\"ipkUrl\":\"/tmp/pow.ipk\"}"'`

## Uninstall / revert
```
ssh lgtv 'luna-send -n 1 luna://com.webos.appInstallService/remove "{\"id\":\"com.pow.dash\"}"'
cd powdash-server && docker compose down
rm ~/Projects/PowStation/config/traefik/dynamic/powdash.yml && docker restart traefik
```

## Notes
- The app is dev-installed under `/media/developer/apps/` (persists on disk). It
  launches on a rooted TV via HBC elevation. Auto-launch on boot is not enabled
  (add a boot hook if you want the TV to power on into PowDash).
- Powflix integration: point dashboard mode at a Sonarr/Radarr/SAB page (iframe) or
  a rendered snapshot (image); a dedicated download-queue widget is the natural next step.

## Overlay / notification model (final, tested)
- **Home dashboard** (default): a fullscreen card — the Zurich household ambient screen
  (clock + MeteoSwiss weather + hourly graph). Launch it, or set as boot/screensaver app.
- **Notifications over live content** (`lgtv notify "..."`): a **webOS system toast**, which
  renders over ANY app (live TV/Netflix/YouTube). We had to clear a stale toast-block first
  (`com.webos.notification/enable`) — the screensaver had disabled toasts; `notify` re-enables.
- **Custom overlay banner** (`lgtv say`): PowDash's own message UI. A dev **web** app CAN run as
  a true `defaultWindowType:"overlay"` and float over content (verified by eye) — but note that
  `tv.capture` cannot screenshot the overlay plane, so verify overlays on the physical panel.
- Weather: MeteoSwiss ICON model via Open-Meteo (no key), refreshed every 15 min, cached in
  the powdash-server and exposed at `/api/weather`.
