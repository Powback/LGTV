# LG webOS 4.4.3 — Root Capabilities Hunt ("what cool stuff can we turn on")

Device: rooted LG webOS 4.4.3-20 TV. Source: extracted rootfs `/private/tmp/lgtv-dump/rootfsA`.
Method: Luna service API surface (`/usr/share/luna-service2/api-permissions.d/tv.internal.api.json` etc.),
app/service manifests, and binary strings. Drive everything with `luna-send` as root.

**Confidence key:** ★★★ method + implementing binary both present, standard webOS API — very likely usable now;
★★ present and coherent but needs the right hardware/state (USB device, tuner, etc.); ★ string/hint only, verify on device.

---

## TIER 1 — Do these first (high coolness, high feasibility)

### 1. Full DVR / PVR / timeshift — record live TV *and HDMI/AV inputs* to USB  ★★★ (tuner/USB) 
Service `com.webos.service.tv.dvr` (+ `com.webos.service.nabs.dvr`). Cited: `tv.internal.api.json`.
- `record/startManualRecord`, `record/startProgramRecord`, `record/startScheduleRecord`, `record/stopRecord`
- **`record/startExternalInputRecord`** — record an **external input (HDMI/AV)**, i.e. capture a console/cable-box/Blu-ray feed to USB (subject to HDCP on protected sources).
- Timeshift: `record/startTimeshiftBuffering` / `pauseTimeshiftBuffering` / `openTimeshiftPlayInstance` — pause & rewind live TV.
- Playback/管理: `play/openRecordingPlayInstance`, `play/seek`, `play/setPlayRate` (trickplay), `private/getRecordFileList`, `private/getThumbnail`, `private/deleteRecordFile`.
- Storage: `device/checkStoragePerformance`, `device/isRecordableStorage` (validates the USB drive first).
- Series/scheduling: `record/changeToSeriesRecord`, `record/setRecordingEndTime`.
> Repurpose: scriptable scheduled recorder / network PVR. Feasibility high where a tuner signal + fast USB drive exist; HDMI recording works for non-HDCP sources.

### 2. Record TV **audio** to disk via one call  ★★★
Service `com.webos.service.tv.audiorecorder`: `startRecord`, `stopRecord`, `isRecording`, `getRecordingBufferedLength`. Cited: `tv.internal.api.json`.
Plus raw tools in `/usr/sbin`: `arecord`, `parecord`, `starfish-record-pipeline` (PulseAudio/ALSA capture straight to a file as root).
> Repurpose: capture whatever the TV is playing (tuner/HDMI/app audio) to a WAV.

### 3. Continuous screen / video capture (beyond the one-shot we use)  ★★
Service `com.webos.service.tv.capture`: besides `executeOneShot` there is **`execute`** (streaming), `createHandle`/`destroyHandle`, **`setOutput`**, `setClipRegions`, `setOptions`, `getProperties`, `lock`/`unlock`. Cited: `tv.internal.api.json`.
Also a ready example: app `com.webos.exampleapp.videocapture` (in rootfs) demonstrates the capture pipeline; `com.webos.service.capturetv` exists too.
> Repurpose: rolling framebuffer/video grabber for a screen-recorder or streaming the panel. Confidence ★★ because `setOutput` target semantics (memory vs. file/encoder) need on-device confirmation.

### 4. IR blaster — turn the TV into a universal remote for other gear  ★★★
Service `com.webos.service.irdbmanager` (daemon `/usr/sbin/irdbmanager`). Cited: `tv.internal.api.json`.
- `sendIrCommand` (blast an arbitrary IR code), `getManufacturerList`, `getKeyList`, `getIrData`/`getIrDb`, `addDevice`/`delDevice`, `setChannel`, **`requestSettopPowerIr`** (power a set-top box), `isSupported`.
> Repurpose: control a soundbar/AVR/set-top/AC from scripts. `isSupported` first — IR-out hardware varies by model.

### 5. HDMI-CEC / SIMPLINK — power & switch attached devices  ★★★
`com.webos.service.eim` (External Input Manager; daemon `/usr/sbin/eim`). Binary strings show SIMPLINK/CEC logic: ARC/eARC, Atmos device, `ArcDevicePower`, CEC device table (`GetUnknownCECPCount`), `adapter_eim_getSIMPLINK`.
Methods: `eim/setChosenDevice`, `addDevice`, `getTotalDeviceList`, `getDeviceInfo`, `getAllInputStatus`, `getCurrentInput`, `getLastInput`.
> Repurpose: switch inputs and power/route CEC devices (turn on the soundbar / console) from a script.

---

## TIER 2 — Very cool, standard, ready

### 6. Panel calibration / service-menu-grade controls (no service remote needed)  ★★★
`com.webos.service.tv.systemproperty` (cited: `tv.internal.api.json`):
- Gamma: `setPgamma`, `savePgamma`, `getPgamma`, `setPgammaMode`, `getPgammaCount`.
- White balance: `setWhiteBalance`/`getWhiteBalance`/`resetWhiteBalance`; **N-point WB**: `enableNpointWhiteBalance`, `setNpointWhiteBalance`, `resetNpointWhiteBalance`.
- `doFactoryDefault`.
`com.webos.service.tv.display/requestClearPanelNoise` — trigger the **OLED pixel-refresh / panel-noise clear** cycle on demand.
`com.webos.service.settings/setSystemSettingFactoryValue` (+ `getSystemSettingFactoryValue`, `setSystemSettingFactoryDesc`) — read/write **factory** settings normally hidden in EZ-Adjust/In-Start.
`com.webos.service.update/setExpertMode` / `getExpertMode` — expert-mode toggle.
> Repurpose: professional-grade calibration + panel maintenance via script. (Write factory values carefully.)

### 7. Bluetooth — pair anything; stream TV audio out  ★★★
`com.webos.service.bluetooth2` (cited: `tv.internal.api.json`):
- `adapter/startDiscovery`, `adapter/pair`, `adapter/awaitPairingRequests`, `adapter/cancelPairing` — pair arbitrary devices (HID keyboards/gamepads, phones).
- `a2dp/connect`, `a2dp/internal/startStreaming`/`stopStreaming`, `a2dp/internal/setSbcEncoderBitpool` — stream the TV's audio to BT speakers/headphones and tune the codec.
> Repurpose: BT keyboard for the shell, or route audio to arbitrary BT sinks.

### 8. Wake-on-LAN / Wake-on-WLAN + power automation  ★★★
- `com.webos.service.connectionmanager/tv/setWolWowlStatus` (+ `getWolWowlStatus`), `com.webos.service.tv.power/enableWol`.
- `com.webos.service.tvpower/power/{powerOn,powerOff,reboot,getPowerState,getPowerOnReason}` and the full prepare/response standby lifecycle (`registerPreparePowerOn`, `registerPrepareResume`, …).
> Repurpose: wake the TV from your LAN/scripts, then boot-to-app; log *why* it woke (`getPowerOnReason`) for automations. `quickStartMode`/`autoStart` settings control instant-on.

### 9. Launch arbitrary app / fullscreen web URL (ambient dashboard)  ★★★ (launch) / ★★ (kiosk)
`com.webos.service.applicationManager/launch` and `/open` (cited: `tv.internal.api.json`) — start any app with params.
Two fullscreen-URL routes:
- Launch `com.webos.app.browser` with a target URL (browser app present in overlay partition).
- The ACR overlay app `com.webos.app.acrcomponent` (`present_frm.html`) literally sets `window.location = params.contentTarget` and goes fullscreen — a ready-made "show this URL fullscreen, no chrome" shell you could repurpose, or clone into your own hidden web app.
> Repurpose: kiosk / ambient dashboard on the panel. Confidence ★★ for a clean always-on kiosk (needs a small custom web app + autostart); launching is ★★★.

---

## TIER 3 — Neat, situational

### 10. Camera service (USB webcam) + gesture  ★★ (needs USB camera)
`com.webos.service.camera/{getList,acquire,open,getInfo,getProperties,applyPhotoEffect,getFirmwareVersion,close}` and `com.webos.service.camera.gesture/finger/{getStatus,setMode}`. Cited: `tv.internal.api.json`.
> This model has no built-in camera, but the stack supports a **plugged-in USB webcam** — `getList` then `acquire`. Gesture/finger detection is there too.

### 11. Inject key codes / drive the pointer (macros, automation)  ★★
`com.webos.service.networkinput/test/sendKeyCode` (inject remote keys), `networkinput/getPointerInputSocket`, `com.webos.service.mrcu/activateMrcu` (Magic Remote), `networkinput/test/getTouchpanelInputSocket`.
> Repurpose: scripted remote macros / navigate the UI headless. Pairs with the **webosbrew `inputhook`** (installed in the writable partition) which binds physical remote keys to custom actions at the evdev layer — remap any button to launch an app or run a command.

### 12. Ambient light sensor read-out  ★★
`com.webos.service.tv.display/getLightSensorData` — read the room brightness sensor.
> Repurpose: feed home-automation (lights/backlight) with real lux-ish data from the TV.

### 13. Voice/mic gain + scenarios  ★★
`com.webos.service.audio/voiceCommand/{setMicGain,getMicGain,setCurrentScenario,enableScenario,setVolume,control}`.
> Direct control of the Magic-Remote mic gain and voice scenarios (mic is push-to-talk; see privacy report).

### 14. PIP / multi-view / input labels / screensaver  ★★
Apps present: `com.webos.app.multiview`, `com.webos.app.livezoom-in{hdmi1..4,tv,recordings}` (per-input zoom/PIP), `com.webos.app.externalinput.*` (custom input labels), `com.webos.app.screensaver`. Multi-view job `com.webos.app.miracast-overlay`, `com.webos.service.webos_sddp`.
> Repurpose: scripted PIP/multiview layouts, rename inputs, custom screensaver content.

---

## Fun / weird
- **`requestClearPanelNoise`** on demand — force the OLED "compensation" cycle whenever you want (panel care from cron).
- **`startExternalInputRecord`** = the TV records your *console/HDMI* to USB — a built-in capture card (non-HDCP content).
- The hidden **ACR "LivePlus" fullscreen web shell** can be repurposed as your own zero-chrome kiosk renderer.
- IR-out + CEC together = the TV becomes a whole-room universal controller you can script.
- `getPowerOnReason` — find out whether the TV woke from remote, CEC, WoL, or timer, and branch automations on it.

## How to drive it
All of the above are Luna calls; as root: `luna-send -n 1 luna://<service>/<method> '<json>'` (use `luna-send-pub` for public bus). `/usr/bin/luna-send` is present. Raw hardware also reachable directly as root: `irdbmanager`, `arecord`/`parecord`, `i2cget/i2cset`, `test_dile_gpio`, `nyx-cmd`, `flash_eraseall`.

## Caveats
- Method names are from the on-device permission manifest (`tv.internal.api.json`) — they are the real registered API, but a few need the right *state* (a tuner lock, a recordable USB, a connected BT/USB/CEC device) to succeed. Marked ★★ where that applies.
- Writing factory/`setSystemSettingFactoryValue` and gamma/WB values changes calibration — snapshot current values (`get*`) before changing.
