// PowDash state service — tiny SSE state plane for the TV overlay app.
// The webOS app subscribes to /api/events; the `lgtv` CLI POSTs /api/state.
// No framework, no deps. Node 18+ / Bun.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = process.env.PORT || 4321;
// The dashboard UI (same HTML the TV app runs) — served at / so it's viewable in any browser.
let INDEX_HTML = '';
try { INDEX_HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8'); } catch {}

/** @type {{mode:string,message:string,src:string,srcType:string,refresh:number,ttl:number,updatedAt:string}} */
let state = {
  mode: 'idle',      // 'idle' | 'message' | 'dashboard'
  message: '',
  src: '',
  srcType: 'image',  // 'image' | 'iframe'
  refresh: 5000,
  ttl: 0,
  updatedAt: new Date().toISOString(),
};

const clients = new Set();
let ttlTimer = null;
const tileCache = new Map(); // url -> {buf, ct, at}
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// ---- Zurich weather (MeteoSwiss ICON model via Open-Meteo; no API key) ----
let weather = null;      // parsed, app-friendly
let weatherAt = 0;
const ZURICH = 'latitude=47.3769&longitude=8.5417&timezone=Europe%2FZurich';
async function fetchWeather() {
  const url = 'https://api.open-meteo.com/v1/forecast?' + ZURICH +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day' +
    '&hourly=temperature_2m,precipitation_probability,weather_code' +
    '&minutely_15=precipitation&forecast_hours=24' +
    '&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,weather_code' +
    '&forecast_days=1&models=meteoswiss_icon_ch2';
  try {
    let r = await fetch(url);
    if (!r.ok) { // fall back to auto best model if the CH model isn't available
      r = await fetch(url.replace('&models=meteoswiss_icon_ch2', ''));
    }
    const d = await r.json();
    const nowHour = new Date().toISOString().slice(0, 13);
    // slice hourly to remaining hours of today (from current hour)
    const hrs = (d.hourly?.time || []).map((t, i) => ({
      t, temp: d.hourly.temperature_2m[i], pop: d.hourly.precipitation_probability?.[i] ?? 0,
      code: d.hourly.weather_code?.[i],
    }));
    weather = {
      current: {
        temp: Math.round(d.current?.temperature_2m),
        feels: Math.round(d.current?.apparent_temperature),
        humidity: d.current?.relative_humidity_2m,
        wind: Math.round(d.current?.wind_speed_10m),
        code: d.current?.weather_code,
        isDay: d.current?.is_day === 1,
      },
      today: {
        max: Math.round(d.daily?.temperature_2m_max?.[0]),
        min: Math.round(d.daily?.temperature_2m_min?.[0]),
        pop: d.daily?.precipitation_probability_max?.[0] ?? 0,
        code: d.daily?.weather_code?.[0],
        sunrise: d.daily?.sunrise?.[0],
        sunset: d.daily?.sunset?.[0],
      },
      hourly: hrs,
      // full 15-min precip series (Zurich-local time strings); the client windows it to "now"
      nowcast: (function(){
        var out=[]; var mt=d.minutely_15?.time||[]; var mp=d.minutely_15?.precipitation||[];
        for(var i=0;i<mt.length;i++) out.push({t:mt[i], mm: mp[i]||0});
        return out;
      })(),
      model: d.model_id || 'meteoswiss_icon',
    };
    weatherAt = Date.now();
    console.log('weather updated:', weather.current.temp + '°C, today', weather.today.min + '/' + weather.today.max);
  } catch (e) { console.log('weather fetch failed:', e.message); }
}
fetchWeather();
setInterval(fetchWeather, 15 * 60 * 1000);

// gently pre-warm radar tiles (central Zurich region) so the TV always gets cache hits
async function warmTile(u) {
  const h = tileCache.get(u); if (h && Date.now() - h.at < 10 * 60 * 1000) return;
  try { const r = await fetch(u, { headers: { 'User-Agent': 'PowDash/1.0 (LG TV household dashboard)' } }); if (!r.ok) return;
    tileCache.set(u, { buf: Buffer.from(await r.arrayBuffer()), ct: r.headers.get('content-type') || 'image/png', at: Date.now() });
  } catch (e) {}
}
async function prefetchRadar() {
  try {
    const j = await (await fetch('https://api.rainviewer.com/public/weather-maps.json')).json();
    const host = j.host, fr = (j.radar.past || []).slice(-8).concat(j.radar.nowcast || []);
    const Z = 8, xs = [131,132,133,134,135,136,137], ys = [84,85,86,87,88];
    for (const f of fr) for (const x of xs) for (const y of ys) {
      await warmTile(host + f.path + '/256/' + Z + '/' + x + '/' + y + '/4/1_1.png');
      await new Promise(r => setTimeout(r, 110));
    }
    console.log('radar prefetch: cache=' + tileCache.size);
  } catch (e) { console.log('radar prefetch fail:', e.message); }
}
// setTimeout(prefetchRadar, 4000); // disabled: tiled radar map dropped
// setInterval(prefetchRadar, 4 * 60 * 1000);

function broadcast() {
  const line = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) { try { res.write(line); } catch {} }
}

function setState(patch) {
  state = { ...state, ...patch, updatedAt: new Date().toISOString() };
  broadcast();
  if (ttlTimer) { clearTimeout(ttlTimer); ttlTimer = null; }
  if (state.ttl && state.ttl > 0) {
    const ms = state.ttl;
    ttlTimer = setTimeout(() => setState({ mode: 'idle', message: '', ttl: 0 }), ms);
  }
  return state;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  if (url.pathname === '/health') {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(INDEX_HTML || '<!doctype html><h1>PowDash</h1><p>UI not bundled.</p>');
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(state));
  }

  if (url.pathname === '/api/weather' && req.method === 'GET') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ weather, updatedAt: weatherAt }));
  }

  // caching map-tile proxy — the TV hits only us; we fetch each tile once (no rate limits)
  if (url.pathname === '/api/tile' && req.method === 'GET') {
    const u = url.searchParams.get('u') || '';
    const okHost = /^https:\/\/(tilecache\.rainviewer\.com|server\.arcgisonline\.com|[abc]\.tile\.openstreetmap\.org|tile\.openstreetmap\.org)\//.test(u);
    if (!okHost) { res.writeHead(400, cors); return res.end('bad host'); }
    const hit = tileCache.get(u);
    if (hit && Date.now() - hit.at < 12 * 60 * 1000) {
      res.writeHead(200, { ...cors, 'Content-Type': hit.ct, 'Cache-Control': 'public, max-age=90' });
      return res.end(hit.buf);
    }
    const serveClean = () => { // never break the tile: stale cache if we have it, else transparent
      if (hit) { res.writeHead(200, { ...cors, 'Content-Type': hit.ct }); return res.end(hit.buf); }
      res.writeHead(200, { ...cors, 'Content-Type': 'image/png' }); res.end(BLANK_PNG);
    };
    fetch(u, { headers: { 'User-Agent': 'PowDash/1.0 (LG TV household dashboard)' } }).then(async (r) => {
      if (!r.ok) return serveClean();
      const ct = r.headers.get('content-type') || 'image/png';
      const buf = Buffer.from(await r.arrayBuffer());
      tileCache.set(u, { buf, ct, at: Date.now() });
      if (tileCache.size > 6000) { const k = tileCache.keys().next().value; tileCache.delete(k); }
      res.writeHead(200, { ...cors, 'Content-Type': ct, 'Cache-Control': 'public, max-age=90' });
      res.end(buf);
    }).catch(serveClean);
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let patch;
      try { patch = JSON.parse(body || '{}'); }
      catch { res.writeHead(400, { ...cors, 'Content-Type': 'application/json' }); return res.end('{"error":"bad json"}'); }
      const allowed = ['mode', 'message', 'src', 'srcType', 'refresh', 'ttl'];
      const clean = {};
      for (const k of allowed) if (k in patch) clean[k] = patch[k];
      setState(clean);
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
    });
    return;
  }

  if (url.pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      ...cors,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\n\n`);
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch {} }, 20000);
    req.on('close', () => { clearInterval(hb); clients.delete(res); });
    return;
  }

  res.writeHead(404, { ...cors, 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => console.log(`powdash-server on :${PORT} (${clients.size} clients)`));
