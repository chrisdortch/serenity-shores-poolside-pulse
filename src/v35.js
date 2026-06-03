const VERSION = '3.5';
const PIN = '7900';
const KEY = 'poolside-pulse-v35-local';
const DEFAULT_PLAYLIST = 'https://suno.com/playlist/cf4b536e-9005-4c98-9ea5-a7f01eca116f';
const DEFAULT_ADDRESS = '615 Serenity Shores Ln, Kimberling City, MO 65686';
const DEFAULT_TRACKS = [
  { title: 'Load or import the Serenity Shores playlist', artist: 'Poolside Pulse', duration: '3:00', audioUrl: '', sourceUrl: '' }
];
const DEFAULT_CANNED = [
  { id: 'standard', label: 'General Notice', text: 'Attention guests, this is a Serenity Shores pool announcement.' },
  { id: 'umbrellas', label: 'Close Umbrellas', text: 'Attention guests, please close all umbrellas and secure loose items. Thank you.' },
  { id: 'poolclose15', label: 'Closing 15', text: 'Attention guests, the pool will close in 15 minutes. Please begin gathering your belongings.' },
  { id: 'poolclose5', label: 'Closing 5', text: 'Attention guests, the pool will close in 5 minutes. Thank you for spending the day at Serenity Shores.' },
  { id: 'adultswim', label: 'Safety Break', text: 'Attention guests, we are taking a short safety break. Please clear the pool and follow lifeguard instructions.' },
  { id: 'lostchild', label: 'Lost Child', text: 'Attention guests, we need everyone to pause and help reunite a child with their family. Please listen for staff instructions.' },
  { id: 'weatherwatch', label: 'Weather Watch', text: 'Attention guests, weather is being monitored near Serenity Shores. Please stay alert for instructions from lifeguards.' },
  { id: 'glass', label: 'No Glass', text: 'Friendly reminder: glass is not permitted in the pool area. Thank you for helping us keep the pool safe for everyone.' },
  { id: 'birthday', label: 'Birthday', text: 'Happy birthday from Serenity Shores. We hope your day is absolutely wonderful.' }
];
const BASE = {
  admin: false,
  screen: 'home',
  tab: 'station',
  sync: false,
  syncMode: 'starting',
  syncNote: 'Connecting station control...',
  revision: 0,
  updatedAt: 0,
  platform: 'suno',
  playlistName: 'Serenity Shores Poolside Pulse',
  playlistUrl: DEFAULT_PLAYLIST,
  tracks: DEFAULT_TRACKS,
  current: 0,
  stationIntent: 'stopped',
  command: null,
  announcement: null,
  lastError: '',
  selectedCannedId: 'standard',
  canned: DEFAULT_CANNED,
  voiceMode: 'ai',
  aiVoice: 'marin',
  deviceVoice: '',
  voiceRate: 0.94,
  voicePitch: 1,
  poolOpen: '09:00',
  poolClose: '21:00',
  autoStart: true,
  autoStop: true,
  address: DEFAULT_ADDRESS,
  lat: '',
  lon: '',
  radius: 10,
  locationNote: 'Serenity Shores address is ready to verify. Device GPS at the resort is best.',
  weather: 'Weather monitor is standing by.',
  owner: 'Welcome to Serenity Shores. We hope your family has an unforgettable day at the lake and pool.',
  manager: 'Pool reminder: children must be supervised, glass is not permitted, and safety comes first.',
  birthdayName: '',
  regular: [
    { id: 'close15', label: 'Closing in 15 minutes', type: 'announcement', time: '20:45', enabled: true, text: 'Attention guests, the pool will close in 15 minutes. Please begin gathering your belongings.' },
    { id: 'close5', label: 'Closing in 5 minutes', type: 'announcement', time: '20:55', enabled: true, text: 'Attention guests, the pool will close in 5 minutes. Thank you for spending the day at Serenity Shores.' }
  ],
  log: []
};

let S = load();
let voices = [];
let music = new Audio();
let announcing = false;
let lastCommandId = '';
let lastAnnouncementId = '';
let lastScheduleKey = '';
let armReady = false;
let importing = false;
let fading = null;

music.preload = 'auto';
music.volume = 0.95;
music.onended = () => advance(1, false);
music.onerror = () => {
  S.lastError = 'Audio failed for this track. Skipping.';
  advance(1, true);
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function clean(x) {
  const s = { ...clone(BASE), ...(x || {}) };
  s.tracks = Array.isArray(s.tracks) && s.tracks.length ? s.tracks : clone(DEFAULT_TRACKS);
  s.canned = Array.isArray(s.canned) && s.canned.length ? mergeCanned(s.canned) : clone(DEFAULT_CANNED);
  s.regular = Array.isArray(s.regular) ? s.regular : clone(BASE.regular);
  s.log = Array.isArray(s.log) ? s.log : [];
  s.current = Math.min(Math.max(Number(s.current) || 0, 0), Math.max(s.tracks.length - 1, 0));
  return s;
}
function mergeCanned(existing) {
  const map = new Map();
  DEFAULT_CANNED.forEach(item => map.set(item.id, clone(item)));
  existing.forEach(item => map.set(item.id || String(Date.now() + Math.random()), { ...clone(item), id: item.id || String(Date.now() + Math.random()) }));
  return [...map.values()];
}
function load() {
  try { return clean(JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { return clean({}); }
}
function local() { localStorage.setItem(KEY, JSON.stringify(S)); }
function publicState() {
  const keep = clone(S);
  keep.admin = false;
  keep.screen = 'home';
  keep.tab = 'station';
  return keep;
}
function now() { return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function log(msg) { S.log = [[msg, now()], ...(S.log || [])].slice(0, 80); local(); }
function esc(x) { return String(x ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function $(id) { return document.getElementById(id); }
function val(id) { return $(id)?.value || ''; }
function track() { return S.tracks[S.current] || DEFAULT_TRACKS[0]; }
function audioTracks() { return (S.tracks || []).filter(t => t.audioUrl); }
function minutes(hhmm) { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function inPoolHours() {
  const n = new Date();
  const m = n.getHours() * 60 + n.getMinutes();
  const a = minutes(S.poolOpen);
  const b = minutes(S.poolClose);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}
function syncText() { return S.sync ? `Sync Active · ${S.syncMode}` : 'Preview sync'; }
function updateSyncPill() { const el = $('syncPill'); if (el) el.textContent = `V${VERSION} · ${syncText()}`; }
function showStatus(message) { S.lastError = message; local(); render(); }

async function save(push = true) {
  local();
  if (push) await pushState();
  render();
}
async function pushState() {
  try {
    const r = await fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: publicState() }) });
    const d = await r.json();
    S.sync = !!d.cloudSync;
    S.syncMode = d.syncMode || 'server';
    S.syncNote = d.note || 'Shared station control active.';
    if (d.state) {
      S.revision = d.state.revision || S.revision;
      S.updatedAt = d.state.savedAt || S.updatedAt;
    }
    local();
    return d;
  } catch (e) {
    S.sync = false;
    S.syncMode = 'local';
    S.syncNote = 'Shared control unavailable: ' + e.message;
    local();
    return null;
  }
}
async function pullState() {
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    const d = await r.json();
    S.sync = !!d.cloudSync;
    S.syncMode = d.syncMode || 'server';
    S.syncNote = d.note || 'Shared station control active.';
    if (d.state && Number(d.state.revision || 0) > Number(S.revision || 0)) {
      const keep = { admin: S.admin, screen: S.screen, tab: S.tab, lastError: S.lastError, selectedCannedId: S.selectedCannedId };
      S = clean({ ...S, ...d.state, ...keep });
      local();
      await applyRemote();
      render();
    } else {
      local();
      updateSyncPill();
    }
  } catch {
    S.sync = false;
    S.syncMode = 'local';
    S.syncNote = 'Shared control temporarily unavailable.';
    updateSyncPill();
  }
}

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw Error(d.error || `HTTP ${r.status}`);
  return d;
}
async function importFromSunoUrl(url, replaceQueue = true) {
  if (!url) throw Error('Missing Suno URL.');
  const d = await fetchJson('/api/suno-playlist?url=' + encodeURIComponent(url));
  const tracks = (d.tracks || []).map(t => ({
    title: t.title || 'Untitled',
    artist: t.artist || 'Suno',
    duration: t.duration || '3:00',
    audioUrl: t.audioUrl || '',
    sourceUrl: t.sourceUrl || url,
    imageUrl: t.imageUrl || ''
  }));
  if (!tracks.length) throw Error(d.error || 'No tracks found.');
  if (replaceQueue) {
    S.tracks = tracks;
    if (d.playlistName) S.playlistName = d.playlistName;
    S.playlistUrl = url;
    S.current = 0;
  }
  S.lastError = d.audioWarning || d.warning || '';
  log(`Imported ${tracks.length} Suno track${tracks.length === 1 ? '' : 's'}`);
  return tracks;
}
async function ensurePlaylistLoaded() {
  if (importing) return false;
  if (audioTracks().length) return true;
  if (!S.playlistUrl) return false;
  importing = true;
  S.lastError = 'Importing playlist audio...';
  render();
  try {
    await importFromSunoUrl(S.playlistUrl, true);
    importing = false;
    await save(true);
    return audioTracks().length > 0;
  } catch (e) {
    S.lastError = 'Playlist import failed: ' + e.message;
    importing = false;
    local();
    render();
    return false;
  }
}

function setMusicSource(t, keepIfSame = true) {
  if (!t?.audioUrl) return false;
  if (!keepIfSame || music.src !== t.audioUrl) music.src = t.audioUrl;
  return true;
}
async function fadeTo(target = 1, ms = 600) {
  if (fading) clearInterval(fading);
  const start = music.volume || 0;
  const steps = Math.max(8, Math.round(ms / 40));
  let i = 0;
  return new Promise(resolve => {
    fading = setInterval(() => {
      i += 1;
      music.volume = Math.max(0, Math.min(1, start + (target - start) * (i / steps)));
      if (i >= steps) {
        clearInterval(fading);
        fading = null;
        music.volume = target;
        resolve();
      }
    }, ms / steps);
  });
}
async function startCurrentTrack(push = true, reset = false) {
  armReady = true;
  const ok = await ensurePlaylistLoaded();
  if (!ok) {
    S.stationIntent = 'stopped';
    S.lastError = 'No playable audio is loaded yet. Import the Suno playlist in Command Center.';
    await save(push);
    return;
  }
  let t = track();
  if (!t.audioUrl) {
    const idx = S.tracks.findIndex(x => x.audioUrl);
    if (idx >= 0) { S.current = idx; t = track(); }
  }
  if (!setMusicSource(t, !reset)) return;
  if (reset) music.currentTime = 0;
  try {
    music.volume = music.volume || 0.01;
    await music.play();
    await fadeTo(0.95, 700);
    S.stationIntent = 'playing';
    S.lastError = '';
    log('Playing ' + t.title);
  } catch {
    S.stationIntent = 'stopped';
    S.lastError = 'This browser blocked playback. Tap Arm / Play Station once on the sound-system device.';
    log('Playback blocked');
  }
  if (push) {
    S.command = { id: Date.now() + ':play', type: 'play' };
    await save(true);
  } else {
    local();
    render();
  }
}
async function play(push = true) { return startCurrentTrack(push, false); }
async function pause(push = true) {
  await fadeTo(0, 350);
  music.pause();
  music.volume = 0.95;
  S.stationIntent = 'paused';
  if (push) { S.command = { id: Date.now() + ':pause', type: 'pause' }; await save(true); }
  else { local(); render(); }
}
async function stop(push = true) {
  await fadeTo(0, 450);
  music.pause();
  music.currentTime = 0;
  music.volume = 0.95;
  S.stationIntent = 'stopped';
  if (push) { S.command = { id: Date.now() + ':stop', type: 'stop' }; await save(true); }
  else { local(); render(); }
}
async function advance(n = 1, push = true) {
  S.current = (S.current + n + S.tracks.length) % S.tracks.length;
  if (S.stationIntent === 'playing') {
    if (push) S.command = { id: Date.now() + ':skip', type: 'skip', n };
    await save(push);
    await startCurrentTrack(false, true);
  } else if (push) {
    S.command = { id: Date.now() + ':skip', type: 'skip', n };
    await save(true);
  } else {
    local();
    render();
  }
}
async function playSunoUrlAtReceiver(url, label = 'Scheduled Suno') {
  try {
    const tracks = await importFromSunoUrl(url, true);
    S.playlistName = label || S.playlistName;
    S.current = 0;
    await save(false);
    await startCurrentTrack(false, true);
  } catch (e) {
    S.lastError = 'Scheduled Suno failed: ' + e.message;
    local(); render();
  }
}

async function prepAnnouncement() {
  announcing = true;
  const resume = S.stationIntent === 'playing' && !music.paused;
  const position = music.currentTime || 0;
  const src = music.src;
  if (resume) {
    await fadeTo(0, 700);
    music.pause();
  }
  return { resume, position, src };
}
async function finishAnnouncement(info, hold) {
  announcing = false;
  if (info.resume && !hold && inPoolHours()) {
    try {
      if (info.src && music.src !== info.src) music.src = info.src;
      if (Number.isFinite(info.position)) music.currentTime = info.position;
      music.volume = 0.01;
      await music.play();
      await fadeTo(0.95, 1200);
      S.stationIntent = 'playing';
    } catch {
      S.lastError = 'Music could not resume automatically. Tap Play on receiver.';
    }
  }
  local();
  render();
}
async function speak(text, opts = {}) {
  const msg = String(text || '').trim();
  if (!msg) return;
  const info = await prepAnnouncement();
  const hold = !!opts.hold;
  let usedAi = false;
  if (S.voiceMode === 'ai') {
    try {
      const r = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: msg,
          voice: S.aiVoice || 'marin',
          instructions: 'Speak like a calm, polished, realistic resort public-address announcer at Serenity Shores. Use clear diction. For safety, sound firm without panic.'
        })
      });
      if (r.ok) {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        a.volume = 1;
        a.onended = () => { URL.revokeObjectURL(url); finishAnnouncement(info, hold); };
        await a.play();
        usedAi = true;
        log('AI voice announcement played');
        return;
      }
      const d = await r.json().catch(() => ({}));
      S.lastError = `AI voice unavailable (${r.status}). Device voice fallback used.` + (d.detail ? ' Check billing/limits.' : '');
      local();
    } catch {
      S.lastError = 'AI voice failed. Device voice fallback used.';
      local();
    }
  }
  if (!usedAi) {
    if (!('speechSynthesis' in window)) { await finishAnnouncement(info, hold); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(msg);
    const v = voices.find(x => x.name === S.deviceVoice) || bestDeviceVoices()[0];
    if (v) u.voice = v;
    u.rate = Number(S.voiceRate) || 0.94;
    u.pitch = Number(S.voicePitch) || 1;
    u.onend = () => finishAnnouncement(info, hold);
    speechSynthesis.speak(u);
    log('Device voice announcement played');
  }
}
async function sendAnnouncement(text, hold = false) {
  const msg = String(text || '').trim();
  if (!msg) return;
  S.announcement = { id: Date.now() + ':' + Math.random().toString(36).slice(2), text: msg, hold, createdAt: Date.now() };
  log('Announcement sent');
  await save(true);
  if (S.screen === 'home') speak(msg, { hold });
}
async function applyRemote() {
  const cmd = S.command;
  if (cmd?.id && cmd.id !== lastCommandId && !announcing) {
    lastCommandId = cmd.id;
    if (cmd.type === 'play') await play(false);
    if (cmd.type === 'pause') await pause(false);
    if (cmd.type === 'stop') await stop(false);
    if (cmd.type === 'skip') await advance(cmd.n || 1, false);
    if (cmd.type === 'suno') await playSunoUrlAtReceiver(cmd.url, cmd.label);
  }
  const a = S.announcement;
  if (a?.id && a.id !== lastAnnouncementId) {
    lastAnnouncementId = a.id;
    await speak(a.text, { hold: a.hold });
  }
}

function bestDeviceVoices() {
  return voices.filter(v => /^en/i.test(v.lang || '')).sort((a, b) => voiceScore(b) - voiceScore(a)).slice(0, 20);
}
function voiceScore(v) {
  const n = (v.name + ' ' + v.lang).toLowerCase();
  let s = 0;
  ['samantha', 'ava', 'allison', 'siri', 'premium', 'enhanced', 'natural', 'google', 'microsoft', 'aria', 'jenny', 'serena'].forEach((p, i) => { if (n.includes(p)) s += 50 - i; });
  if (n.includes('en-us')) s += 10;
  return s;
}
async function importPlaylist() {
  S.platform = val('platform');
  S.playlistName = val('playlistName') || S.playlistName;
  S.playlistUrl = val('playlistUrl') || S.playlistUrl;
  if (S.platform !== 'suno') {
    S.lastError = 'Saved as a reference. Automatic playable import currently works for Suno. Use Bulk Import for direct audio URLs from other platforms.';
    await save(true);
    return;
  }
  await ensurePlaylistLoaded();
  await save(true);
}
async function bulkImport() {
  const rows = val('bulk').split('\n').map(x => x.trim()).filter(Boolean);
  if (!rows.length) return;
  S.tracks = rows.map(r => {
    const p = r.split('|').map(x => x.trim());
    return { title: p[0] || 'Untitled', artist: p[1] || 'Unknown', duration: p[2] || '3:00', audioUrl: p[3] || '', sourceUrl: p[4] || '' };
  });
  S.current = 0;
  S.lastError = 'Bulk import saved and published.';
  await save(true);
}
async function verify() {
  S.address = val('address') || S.address;
  try {
    const d = await fetchJson('/api/geocode?address=' + encodeURIComponent(S.address));
    S.lat = String(d.latitude);
    S.lon = String(d.longitude);
    S.locationNote = (d.fallback ? 'Best available match. ' : 'Verified: ') + (d.matchedAddress || S.address);
    S.weather = 'Location ready. Weather monitoring can run.';
    await save(true);
  } catch (e) {
    S.locationNote = 'Address lookup failed. Use Device GPS while physically at Serenity Shores, or enter coordinates manually.';
    S.lastError = e.message;
    await save(true);
  }
}
function deviceLoc() {
  navigator.geolocation?.getCurrentPosition(async p => {
    S.lat = p.coords.latitude.toFixed(6);
    S.lon = p.coords.longitude.toFixed(6);
    S.locationNote = 'Device GPS captured with about ' + Math.round(p.coords.accuracy || 0) + 'm accuracy.';
    await save(true);
  }, async () => {
    S.locationNote = 'Device GPS permission failed.';
    await save(true);
  }, { enableHighAccuracy: true, timeout: 12000 });
}
async function weatherCheck() {
  if (!S.lat || !S.lon) { S.weather = 'Verify location first.'; render(); return; }
  try {
    const d = await fetchJson(`/api/weather?lat=${S.lat}&lon=${S.lon}&radiusMiles=${Number(S.radius) || 10}`);
    S.weather = d.summary || 'Weather checked.';
    if (d.threat) {
      await sendAnnouncement('Attention guests. Weather activity has been detected nearby. Please exit the pool area and move indoors immediately.', true);
      S.stationIntent = 'paused';
    }
    await save(true);
  } catch (e) {
    S.weather = 'Weather check failed: ' + e.message;
    await save(true);
  }
}
function scheduleKey(id) {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}:${id}`;
}
async function scheduleTick() {
  const within = inPoolHours();
  if (S.screen === 'home' && armReady && !announcing) {
    if (S.autoStart && within && S.stationIntent !== 'playing') await play(false);
    if (S.autoStop && !within && S.stationIntent === 'playing') await stop(false);
  }
  const n = new Date();
  const hm = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  for (const r of S.regular || []) {
    if (r.enabled && r.time === hm) {
      const key = scheduleKey(r.id || r.label || r.time);
      if (key !== lastScheduleKey) {
        lastScheduleKey = key;
        if ((r.type || 'announcement') === 'suno') {
          S.command = { id: Date.now() + ':suno', type: 'suno', url: r.url, label: r.label };
          await save(true);
          if (S.screen === 'home') await playSunoUrlAtReceiver(r.url, r.label);
        } else {
          await sendAnnouncement(r.text, false);
        }
      }
    }
  }
}

function head() {
  return `<header class="top"><div class="brand"><b>SS</b><span>Serenity Shores<small>Poolside Pulse · V${VERSION}</small></span></div><div class="tog"><button id="homeBtn" class="${S.screen === 'home' ? 'active' : ''}">Home</button><button id="cmdBtn" class="${S.screen !== 'home' ? 'active' : ''}">Command</button></div></header>`;
}
function home() {
  const t = track();
  const armed = armReady ? 'Receiver armed' : 'Tap once to arm receiver';
  return `${head()}<main class="home"><section class="hero compact"><div><p class="tag">PRIVATE RESORT STATION · V${VERSION}</p><h1>Poolside Pulse</h1><p class="sub">Command-controlled resort music, announcements, birthdays, daily messages, and weather-aware pool safety.</p><div class="actions"><button id="playHome">${S.stationIntent === 'playing' ? 'Pause' : 'Arm / Play Station'}</button><button id="skipHome" class="secondary">Skip</button><button id="stopHome" class="secondary">Stop</button></div><p class="mini">${armed} · ${syncText()}</p></div><aside><b>Pool Hours</b><p>${esc(S.poolOpen)} – ${esc(S.poolClose)}</p><b>Weather</b><p>${esc(S.weather)}</p></aside></section><section class="now"><div class="art">SS<span>Pulse</span></div><div><p class="tag teal">${S.stationIntent === 'playing' ? 'NOW PLAYING' : 'STATION READY'}</p><h2>${esc(t.title)}</h2><p>${esc(t.artist)} · ${esc(t.duration)}</p><div class="bar"><i></i></div><p>${esc(S.playlistName)}</p>${S.lastError ? `<p class="warn">${esc(S.lastError)}</p>` : ''}</div></section><section class="cards"><div class="card"><h3>Up Next</h3>${S.tracks.slice(S.current + 1, S.current + 5).map(x => `<p class="line"><b>${esc(x.title)}</b><span>${esc(x.artist)}</span></p>`).join('') || '<p>Import or bulk-load a queue.</p>'}</div><div class="card"><h3>Daily Messages</h3><p>${esc(S.owner)}</p><p>${esc(S.manager)}</p></div></section></main>`;
}
function login() {
  return `${head()}<main class="wrap"><section class="card login"><h1>Command Center</h1><p>PIN protected station controls.</p><input id="pin" inputmode="numeric" type="password" placeholder="PIN"><button id="login">Enter</button><p class="mini">V${VERSION}</p></section></main>`;
}
function tabs() {
  const a = [['station', 'Station'], ['announce', 'Announce'], ['daily', 'Schedule'], ['hours', 'Hours'], ['weather', 'Weather'], ['voice', 'Voice']];
  return `<nav class="tabs stickyTabs">${a.map(x => `<button data-tab="${x[0]}" class="${S.tab === x[0] ? 'on' : ''}">${x[1]}</button>`).join('')}</nav>`;
}
function command(body) {
  return `${head()}<main class="wrap"><div class="version" id="syncPill">V${VERSION} · ${syncText()}</div>${tabs()}${S.lastError ? `<div class="status"><b>Status:</b> ${esc(S.lastError)}</div>` : ''}${body}</main>`;
}
function station() {
  const q = S.tracks.map((t, i) => `<div class="q ${i === S.current ? 'cur' : ''}"><div><b>${i + 1}. ${esc(t.title)}</b><span>${esc(t.artist)} · ${esc(t.duration)} ${t.audioUrl ? '· playable' : '· title only'}</span></div><button data-song="${i}">Play</button></div>`).join('');
  return command(`<section class="panel tight"><h1>Station Source</h1><p>The last published playlist is what every armed Home receiver plays.</p><label>Platform<select id="platform"><option value="suno">Suno automatic playable import</option><option value="youtube">YouTube reference/manual</option><option value="spotify">Spotify reference/manual</option><option value="amazon">Amazon reference/manual</option><option value="google">Google/YouTube Music reference/manual</option></select></label><label>Playlist or Song URL<input id="playlistUrl" value="${esc(S.playlistUrl)}"></label><label>Playlist Name<input id="playlistName" value="${esc(S.playlistName)}"></label><div class="actions"><button id="import">Import & Publish</button><button id="playCmd" class="secondary">Play Receivers</button><button id="pauseCmd" class="secondary">Pause</button><button id="skipCmd" class="secondary">Skip</button><button id="stopCmd" class="secondary">Stop</button></div></section><section class="panel tight"><h2>Published Queue</h2>${q}</section><section class="panel tight"><h2>Universal Bulk Import</h2><p>One song per line: Title | Artist | Duration | direct audio URL | optional source URL</p><textarea id="bulk">${S.tracks.map(t => `${t.title} | ${t.artist} | ${t.duration} | ${t.audioUrl || ''} | ${t.sourceUrl || ''}`).join('\n')}</textarea><button id="bulkBtn">Save & Publish Bulk Import</button></section>`);
}
function selectedCanned() {
  return S.canned.find(x => x.id === S.selectedCannedId) || S.canned[0] || DEFAULT_CANNED[0];
}
function announcePage() {
  const selected = selectedCanned();
  const chips = S.canned.map(c => `<button class="chip ${c.id === selected.id ? 'on' : ''}" data-canned="${esc(c.id)}">${esc(c.label)}</button>`).join('');
  return command(`<section class="panel tight"><h1>Instant Announcements</h1><p>Tap a saved button, edit the name/text if needed, then Play Now. Music fades down, pauses, speaks, then fades back in.</p><div class="chipgrid">${chips}<button id="newCanned" class="chip add">+ Add</button></div><label>Button Name<input id="cannedLabel" value="${esc(selected.label)}"></label><label>Announcement Text<textarea id="cannedText">${esc(selected.text)}</textarea></label><div class="actions"><button id="playCanned">Play Now</button><button id="saveCanned" class="secondary">Save Button</button><button id="deleteCanned" class="secondary">Delete</button><button id="holdCanned" class="secondary">Play as Safety Hold</button></div></section><section class="panel tight"><h2>Birthday</h2><input id="birthdayName" placeholder="Guest name" value="${esc(S.birthdayName)}"><textarea id="birthdayText">${esc(DEFAULT_CANNED.find(x => x.id === 'birthday')?.text || '')}</textarea><button id="birthday">Speak Birthday</button></section><section class="panel tight"><h2>Owner / Manager Daily Messages</h2><textarea id="owner">${esc(S.owner)}</textarea><textarea id="manager">${esc(S.manager)}</textarea><button id="saveMsg">Save Daily Messages</button></section>`);
}
function dailyPage() {
  const regs = S.regular.map((r, i) => `<div class="q"><div><b>${esc(r.label || 'Scheduled Item')}</b><span>${esc(r.time)} · ${r.enabled ? 'enabled' : 'off'} · ${esc(r.type || 'announcement')}</span><p>${esc(r.type === 'suno' ? (r.url || '') : (r.text || ''))}</p></div><button data-reg="${i}">Delete</button></div>`).join('');
  return command(`<section class="panel tight"><h1>Daily Schedule</h1><p>Add regular announcements or a Suno song/playlist URL to run at a specific time.</p><label>Type<select id="regType"><option value="announcement">Announcement</option><option value="suno">Suno URL</option></select></label><label>Button / Schedule Name<input id="regLabel" placeholder="Pool closing in 15 minutes"></label><label>Time<input id="regTime" type="time" value="20:45"></label><label>Announcement Text<textarea id="regText" placeholder="Message to play every day at this time"></textarea></label><label>Suno Song or Playlist URL<input id="regUrl" placeholder="https://suno.com/song/... or https://suno.com/playlist/..."></label><button id="addReg">Add Scheduled Item</button></section><section class="panel tight"><h2>Active Schedule</h2>${regs || '<p>No scheduled items yet.</p>'}</section>`);
}
function hoursPage() {
  return command(`<section class="panel tight"><h1>Pool Hours Automation</h1><div class="grid2"><label>Pool Opens<input id="poolOpen" type="time" value="${esc(S.poolOpen)}"></label><label>Pool Closes<input id="poolClose" type="time" value="${esc(S.poolClose)}"></label></div><label>Auto-start<select id="autoStart"><option value="true">Auto-start music during open hours</option><option value="false">Do not auto-start</option></select></label><label>Auto-stop<select id="autoStop"><option value="true">Auto-stop music when closed</option><option value="false">Do not auto-stop</option></select></label><button id="saveHours">Save Pool Hours</button><p class="status">Browser rule: the sound-system browser must be opened and armed once. After that, admin commands and pool-hour automation can control it during the session.</p></section>`);
}
function weatherPage() {
  return command(`<section class="panel tight"><h1>Location & Weather Safety</h1><label>Resort Address<input id="address" value="${esc(S.address)}"></label><div class="actions"><button id="verify">Verify Address</button><button id="device" class="secondary">Use Device GPS</button><button id="weatherCheck" class="secondary">Run Weather Check</button></div><div class="grid3"><label>Latitude<input id="lat" value="${esc(S.lat)}"></label><label>Longitude<input id="lon" value="${esc(S.lon)}"></label><label>Radius Miles<input id="radius" value="${esc(S.radius)}"></label></div><button id="saveLoc">Save Location</button><div class="status"><b>${esc(S.locationNote)}</b><p>${esc(S.weather)}</p></div></section>`);
}
function voicePage() {
  const device = bestDeviceVoices().map(v => `<option value="${esc(v.name)}" ${v.name === S.deviceVoice ? 'selected' : ''}>${esc(v.name)} · ${esc(v.lang)}</option>`).join('');
  return command(`<section class="panel tight"><h1>Voice Studio</h1><p>AI voice uses OpenAI gpt-4o-mini-tts with Marin/Cedar quality voices when billing/quota allows it. 429 means billing, quota, project limit, or rate limit.</p><label>Voice Mode<select id="voiceMode"><option value="ai">Natural AI Voice first</option><option value="device">Free Device Voice only</option></select></label><label>AI Voice<select id="aiVoice"><option value="marin">Marin - recommended</option><option value="cedar">Cedar - recommended</option><option value="coral">Coral</option><option value="nova">Nova</option><option value="sage">Sage</option><option value="shimmer">Shimmer</option><option value="onyx">Onyx</option></select></label><label>Best Device Voice<select id="deviceVoice"><option value="">Best available</option>${device}</select></label><div class="grid2"><label>Speed<input id="rate" type="range" min="0.75" max="1.15" step=".01" value="${S.voiceRate}"></label><label>Pitch<input id="pitch" type="range" min=".85" max="1.15" step=".01" value="${S.voicePitch}"></label></div><div class="actions"><button id="saveVoice">Save Voice</button><button id="testVoice" class="secondary">Test Voice</button></div></section>`);
}
function render() {
  const pages = { station, announce: announcePage, daily: dailyPage, hours: hoursPage, weather: weatherPage, voice: voicePage };
  document.getElementById('app').innerHTML = S.screen === 'home' ? home() : !S.admin ? login() : (pages[S.tab] || station)();
  bind();
}
function bind() {
  if ($('homeBtn')) $('homeBtn').onclick = () => { S.screen = 'home'; local(); render(); };
  if ($('cmdBtn')) $('cmdBtn').onclick = () => { S.screen = 'command'; local(); render(); };
  if ($('login')) $('login').onclick = () => { if (val('pin') === PIN) { S.admin = true; S.screen = 'command'; S.tab = 'station'; local(); render(); } else alert('Wrong PIN'); };
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; local(); render(); });
  if ($('playHome')) $('playHome').onclick = () => S.stationIntent === 'playing' ? pause(true) : play(true);
  if ($('skipHome')) $('skipHome').onclick = () => advance(1, true);
  if ($('stopHome')) $('stopHome').onclick = () => stop(true);
  if ($('platform')) $('platform').value = S.platform;
  if ($('import')) $('import').onclick = importPlaylist;
  if ($('playCmd')) $('playCmd').onclick = () => play(true);
  if ($('pauseCmd')) $('pauseCmd').onclick = () => pause(true);
  if ($('skipCmd')) $('skipCmd').onclick = () => advance(1, true);
  if ($('stopCmd')) $('stopCmd').onclick = () => stop(true);
  document.querySelectorAll('[data-song]').forEach(b => b.onclick = () => { S.current = Number(b.dataset.song) || 0; startCurrentTrack(true, true); });
  if ($('bulkBtn')) $('bulkBtn').onclick = bulkImport;
  document.querySelectorAll('[data-canned]').forEach(b => b.onclick = () => { S.selectedCannedId = b.dataset.canned; local(); render(); });
  if ($('newCanned')) $('newCanned').onclick = () => { const id = 'custom-' + Date.now(); S.canned.push({ id, label: 'New Button', text: 'Type announcement text here.' }); S.selectedCannedId = id; save(true); };
  if ($('saveCanned')) $('saveCanned').onclick = () => { const c = selectedCanned(); c.label = val('cannedLabel') || c.label; c.text = val('cannedText') || c.text; save(true); };
  if ($('deleteCanned')) $('deleteCanned').onclick = () => { if (S.canned.length <= 1) return; S.canned = S.canned.filter(c => c.id !== S.selectedCannedId); S.selectedCannedId = S.canned[0]?.id || 'standard'; save(true); };
  if ($('playCanned')) $('playCanned').onclick = () => { const c = selectedCanned(); c.label = val('cannedLabel') || c.label; c.text = val('cannedText') || c.text; sendAnnouncement(c.text, false); };
  if ($('holdCanned')) $('holdCanned').onclick = () => { const c = selectedCanned(); c.label = val('cannedLabel') || c.label; c.text = val('cannedText') || c.text; sendAnnouncement(c.text, true); };
  if ($('birthday')) $('birthday').onclick = () => { S.birthdayName = val('birthdayName'); sendAnnouncement(`Happy birthday ${S.birthdayName}. ${val('birthdayText')}`, false); };
  if ($('saveMsg')) $('saveMsg').onclick = () => { S.owner = val('owner'); S.manager = val('manager'); save(true); };
  if ($('addReg')) $('addReg').onclick = () => {
    const type = val('regType') || 'announcement';
    const label = val('regLabel') || (type === 'suno' ? 'Scheduled Suno' : 'Daily Reminder');
    const time = val('regTime') || '12:00';
    const text = val('regText');
    const url = val('regUrl');
    if (type === 'announcement' && !text) return showStatus('Add announcement text first.');
    if (type === 'suno' && !url) return showStatus('Add a Suno URL first.');
    S.regular.push({ id: Date.now() + '', label, type, time, text, url, enabled: true });
    save(true);
  };
  document.querySelectorAll('[data-reg]').forEach(b => b.onclick = () => { S.regular.splice(Number(b.dataset.reg), 1); save(true); });
  if ($('poolOpen')) $('poolOpen').value = S.poolOpen;
  if ($('poolClose')) $('poolClose').value = S.poolClose;
  if ($('autoStart')) $('autoStart').value = String(!!S.autoStart);
  if ($('autoStop')) $('autoStop').value = String(!!S.autoStop);
  if ($('saveHours')) $('saveHours').onclick = () => { S.poolOpen = val('poolOpen'); S.poolClose = val('poolClose'); S.autoStart = val('autoStart') === 'true'; S.autoStop = val('autoStop') === 'true'; save(true); };
  if ($('verify')) $('verify').onclick = verify;
  if ($('device')) $('device').onclick = deviceLoc;
  if ($('weatherCheck')) $('weatherCheck').onclick = weatherCheck;
  if ($('saveLoc')) $('saveLoc').onclick = () => { S.address = val('address'); S.lat = val('lat'); S.lon = val('lon'); S.radius = Number(val('radius')) || 10; save(true); };
  if ($('voiceMode')) $('voiceMode').value = S.voiceMode;
  if ($('aiVoice')) $('aiVoice').value = S.aiVoice;
  if ($('saveVoice')) $('saveVoice').onclick = () => { S.voiceMode = val('voiceMode'); S.aiVoice = val('aiVoice'); S.deviceVoice = val('deviceVoice'); S.voiceRate = Number(val('rate')) || 0.94; S.voicePitch = Number(val('pitch')) || 1; save(true); };
  if ($('testVoice')) $('testVoice').onclick = () => speak('This is Serenity Shores Poolside Pulse version ' + VERSION + '. This is a natural voice test for resort announcements.', {});
}
function loadVoices() { voices = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : []; render(); }
if ('speechSynthesis' in window) { speechSynthesis.onvoiceschanged = loadVoices; voices = speechSynthesis.getVoices(); }
render();
pullState();
setInterval(pullState, 2000);
setInterval(scheduleTick, 15000);
setInterval(weatherCheck, 5 * 60 * 1000);
