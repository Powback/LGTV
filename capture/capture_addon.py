"""
LG TV capture addon for mitmproxy.
- Streams the voice-STT endpoint (lgthinq) chunk-by-chunk with a tee → voice works in
  real time (no 6022) AND we save the raw audio upload + the returned transcription.
- Buffers + records every other tracker/telemetry flow (small), scans for the CANARY phrase,
  and saves ACR/ad/CDP payloads as proof.
"""
import os, time, datetime
from mitmproxy import http

BASE = os.path.expanduser("~/Projects/LGTV/capture/flows")
CANARY = os.environ.get("LGTV_CANARY", "big brother").lower()
os.makedirs(os.path.join(BASE, "audio"), exist_ok=True)
os.makedirs(os.path.join(BASE, "payloads"), exist_ok=True)

def _day():
    return datetime.date.today().strftime("%Y%m%d")

def _log(line):
    with open(os.path.join(BASE, f"{_day()}.log"), "a") as f:
        f.write(line + "\n")

def _canary(where, blob, flow):
    if not blob:
        return
    try:
        text = blob.decode("utf-8", "ignore").lower()
    except Exception:
        return
    if CANARY in text:
        ts = datetime.datetime.now().isoformat(timespec="seconds")
        idx = text.find(CANARY)
        ctx = text[max(0, idx-80):idx+80].replace("\n", " ")
        hit = f"[{ts}] CANARY '{CANARY}' in {where} of {flow.request.method} {flow.request.pretty_url}"
        _log("!!! " + hit)
        with open(os.path.join(BASE, "CANARY-HITS.txt"), "a") as f:
            f.write(hit + "\n    ...context: ..." + ctx + "...\n")

def _is_voice(flow):
    return "lgthinq" in flow.request.pretty_host

# ---- streaming path for voice (no buffering → no 6022, still captured) ----
def requestheaders(flow: http.HTTPFlow):
    if _is_voice(flow):
        ts = int(time.time())
        path = os.path.join(BASE, "audio", f"{_day()}_{ts}_{flow.request.pretty_host}_up.bin")
        f = open(path, "ab")
        f.write(("# %s %s\n" % (flow.request.method, flow.request.pretty_url)).encode())
        def tee(chunk: bytes) -> bytes:
            if chunk:
                f.write(chunk); f.flush()
                _canary("voice-upload", chunk, flow)
            else:
                f.close()
                _log(f"[{datetime.datetime.now().isoformat(timespec='seconds')}] "
                     f"SAVED voice upload (streamed) -> {path}")
            return chunk
        flow.request.stream = tee

def responseheaders(flow: http.HTTPFlow):
    if _is_voice(flow):
        ts = int(time.time())
        path = os.path.join(BASE, "audio", f"{_day()}_{ts}_{flow.request.pretty_host}_down.txt")
        f = open(path, "ab")
        def tee(chunk: bytes) -> bytes:
            if chunk:
                f.write(chunk); f.flush()
                _canary("voice-transcription", chunk, flow)   # returned text
            else:
                f.close()
            return chunk
        flow.response.stream = tee

# ---- buffered path for everything else (trackers/telemetry/ACR/ads) ----
def response(flow: http.HTTPFlow):
    if _is_voice(flow):
        # already handled via streaming tee; just log the line
        _log(f"[{datetime.datetime.now().isoformat(timespec='seconds')}] "
             f"{flow.request.method} {flow.request.pretty_url} -> "
             f"{flow.response.status_code if flow.response else '-'} (streamed)")
        return

    host = flow.request.pretty_host
    ts = datetime.datetime.now().isoformat(timespec="seconds")
    req_body = flow.request.raw_content or b""
    res_body = flow.response.raw_content if flow.response else b""
    _log(f"[{ts}] {flow.request.method} {flow.request.pretty_url} -> "
         f"{flow.response.status_code if flow.response else '-'} "
         f"req={len(req_body)}B res={len(res_body)}B")

    hdrs = ("\n".join(f"{k}: {v}" for k, v in flow.request.headers.items())).encode()
    _canary("url", flow.request.pretty_url.encode(), flow)
    _canary("req-headers", hdrs, flow)
    _canary("request", req_body, flow)
    _canary("response", res_body, flow)

    # save ACR / ad / CDP telemetry payloads as proof
    if any(k in host for k in ("alphonso", "samba", "lgsmartad", "lgtvcommon", "lgtviot",
                               "lgappstv", "doubleclick", "a2z")):
        blob = req_body or res_body
        if blob:
            fn = os.path.join(BASE, "payloads", f"{_day()}_{int(time.time())}_{host}.bin")
            with open(fn, "wb") as f:
                f.write((flow.request.method + " " + flow.request.pretty_url + "\n\n").encode()
                        + req_body + b"\n\n--- RESPONSE ---\n\n" + res_body)
