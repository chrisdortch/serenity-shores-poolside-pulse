const STORAGE_KEY = 'poolside-pulse-state-v1';
const ADMIN_CODE = '2468';

const defaultState = {
  admin: false,
  tab: 'dashboard',
  poolOpen: true,
  musicPaused: false,
  activeAlert: null,
  countdown: 0,
  lastWeatherCheck: null,
  playlistName: 'Poolside Suno Mix',
  playlistUrl: 'https://suno.com/playlist/serenity-shores-poolside-suno-mix',
  currentTrack: 0,
  volume: 80,
  voiceRate: 1,
  voicePitch: 1,
  repeatCount: 1,
  repeatDelay: 10,
  instantMessage: 'Please close umbrellas due to wind.',
  emergencyMessage: 'Attention guests: lightning has been detected nearby. Please exit the pool area immediately.',
  lifeguardMessage: 'Ensure all guests exit the pool area. Close umbrellas, secure loose items, and take shelter indoors.',
  clearMessage: 'The pool is now clear to reopen. Thank you.',
  tracks: [
    { title: 'Good Life', artist: 'OneRepublic', duration: '3:42', audioUrl: '' },
    { title: 'Island In The Sun', artist: 'Weezer', duration: '3:20', audioUrl: '' },
    { title: 'Riptide', artist: 'Vance Joy', duration: '3:24', audioUrl: '' },
    { title: 'Here Comes The Sun', artist: 'The Beatles', duration: '3:05', audioUrl: '' },
    { title: 'Watermelon Sugar', artist: 'Harry Styles', duration: '2:54', audioUrl: '' }
  ],
  events: [
    { type: 'music', text: 'System started', time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }
  ]
};

let state = loadState();
let timer = null;
let audio = new Audio();
audio.volume = state.volume / 100;

function loadState() {
  try {
    return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return { ...defaultState };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function event(text, type = 'info') {
  state.events = [{ type, text, time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }, ...state.events].slice(0, 25);
  saveState();
}

function speak(text, repeats = 1, delay = 0) {
  if (!('speechSynthesis' in window)) {
    alert('This browser does not support free built-in speech synthesis. Safari, Chrome, and Edge usually do.');
    return;
  }
  const clean = String(text || '').trim();
  if (!clean) return;
  window.speechSynthesis.cancel();
  let i = 0;
  const play = () => {
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = state.voiceRate;
    utterance.pitch = state.voicePitch;
    utterance.volume = state.volume / 100;
    utterance.onend = () => {
      i += 1;
      if (i < repeats) setTimeout(play, delay * 1000);
    };
    window.speechSynthesis.speak(utterance);
  };
  play();
  event(`Spoken announcement: ${clean.slice(0, 70)}${clean.length > 70 ? '…' : ''}`, 'announcement');
}

function startSafetyAlert(kind = 'Lightning') {
  state.poolOpen = false;
  state.musicPaused = true;
  state.activeAlert = kind;
  state.countdown = 30 * 60;
  pauseMusic();
  speak(state.emergencyMessage, 1, 0);
  event(`${kind} safety alert triggered`, 'alert');
  startTimer();
  saveState();
  render();
}

function clearSafetyAlert() {
  state.poolOpen = true;
  state.musicPaused = false;
  state.activeAlert = null;
  state.countdown = 0;
  speak(state.clearMessage, 1, 0);
  event('Safety alert cleared; music may resume', 'success');
  saveState();
  render();
}

function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (state.countdown > 0) {
      state.countdown -= 1;
      saveState();
      render();
    } else if (state.activeAlert) {
      clearInterval(timer);
      timer = null;
      clearSafetyAlert();
    }
  }, 1000);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function currentTrack() {
  return state.tracks[state.currentTrack] || state.tracks[0];
}

function playMusic() {
  const track = currentTrack();
  if (track?.audioUrl) {
    audio.src = track.audioUrl;
    audio.play().catch(() => alert('Browser blocked autoplay. Tap play again, or use a direct playable audio URL.'));
  }
  state.musicPaused = false;
  event(`Music playing: ${track?.title || 'Unknown track'}`, 'music');
  saveState();
  render();
}

function pauseMusic() {
  audio.pause();
  state.musicPaused = true;
  saveState();
}

function nextTrack() {
  state.currentTrack = (state.currentTrack + 1) % Math.max(state.tracks.length, 1);
  event(`Next track selected: ${currentTrack()?.title || 'Unknown track'}`, 'music');
  if (!state.musicPaused) playMusic();
  saveState();
  render();
}

async function checkWeather() {
  state.lastWeatherCheck = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  event('Weather check completed using free prototype mode', 'weather');
  saveState();
  render();
}

function importTracks(text) {
  const rows = text.split('\n').map(x => x.trim()).filter(Boolean);
  const tracks = rows.map(row => {
    const parts = row.split('|').map(x => x.trim());
    return { title: parts[0] || 'Untitled', artist: parts[1] || 'Unknown', duration: parts[2] || '3:00', audioUrl: parts[3] || '' };
  });
  if (tracks.length) {
    state.tracks = tracks;
    state.currentTrack = 0;
    event(`Imported ${tracks.length} playlist tracks`, 'music');
    saveState();
    render();
  }
}

function appShell(content) {
  const track = currentTrack();
  const alertClass = state.activeAlert ? 'danger' : 'safe';
  return `
    <div class="hero">
      <div class="heroOverlay">
        <div class="brandMark">≋◠≋</div>
        <h1>Serenity Shores</h1>
        <h2>Poolside Pulse</h2>
        <p>Music, updates, and pool safety.</p>
        <div class="chips">
          <span class="chip ${state.poolOpen ? 'good' : 'bad'}">${state.poolOpen ? '● Pool Open' : '● Pool Closed'}</span>
          <span class="chip ${alertClass}">${state.activeAlert ? '⚠ Music Paused' : '🛡 Weather Safe'}</span>
          <span class="chip">↻ Auto-check every 5 min</span>
        </div>
      </div>
    </div>
    <main class="app">
      ${content}
    </main>
    <nav class="bottomNav">
      ${navButton('dashboard', '⌂', 'Home')}
      ${navButton('music', '♫', 'Music')}
      ${navButton('safety', '🛡', 'Safety')}
      ${navButton('announcements', '🔔', 'Announcements')}
      ${navButton('admin', '☰', 'Admin')}
    </nav>
  `;
}

function navButton(tab, icon, label) {
  return `<button class="nav ${state.tab === tab ? 'active' : ''}" data-tab="${tab}"><b>${icon}</b><span>${label}</span></button>`;
}

function dashboard() {
  const track = currentTrack();
  if (state.activeAlert) return safetyScreen();
  return appShell(`
    <section class="player card">
      <div class="album">Poolside<br><span>Suno</span><small>Mix</small></div>
      <div class="playerInfo">
        <p class="eyebrow">NOW PLAYING</p>
        <h3>${track.title}</h3>
        <p>${track.artist}</p>
        <p class="playlist">▥ ${state.playlistName}</p>
      </div>
      <div class="progress"><span></span></div>
      <div class="controls">
        <button>⤨</button><button>◀</button><button class="big" id="playPause">${state.musicPaused ? '▶' : 'Ⅱ'}</button><button id="nextTrack">▶</button><button>↻</button>
      </div>
    </section>
    <section class="grid two">
      <div class="card"><h3>Recently Played</h3>${state.tracks.slice(1,4).map(t => row(t)).join('')}</div>
      <div class="card"><h3>Up Next</h3>${state.tracks.slice(1,4).map((t,i) => row(t, i+1)).join('')}</div>
    </section>
    <section class="notice card"><div class="icon">📣</div><div><h3>No active announcements</h3><p>You’ll see important updates here.</p></div></section>
    <section class="notice card blue"><div class="icon">🛡</div><div><p class="eyebrow">SAFETY AUTOMATION</p><h3>You’re protected.</h3><p>Lightning and tornado alerts within 10 miles are monitored in prototype mode.</p></div></section>
  `);
}

function safetyScreen() {
  return appShell(`
    <section class="alertBanner"><div>⚡</div><h3>${state.activeAlert} Alert — Exit the Pool</h3><p>${state.activeAlert} detected nearby. Your safety is our top priority.</p></section>
    <section class="card notice"><div class="icon">📣</div><div><p class="eyebrow">ANNOUNCEMENT</p><h3>${state.emergencyMessage}</h3></div></section>
    <section class="card timer"><div><p class="eyebrow">SAFETY TIMER</p><h2>${formatTime(state.countdown)}</h2><p>Exit the pool and seek shelter.</p></div><div class="timerCircle">${formatTime(state.countdown)}<small>remaining</small></div></section>
    <section class="card peach"><p class="eyebrow">LIFEGUARD INSTRUCTIONS</p><h3>${state.lifeguardMessage}</h3></section>
    <section class="card"><p class="eyebrow">ACTIVITY LOG</p><h3>${state.events[0]?.text || 'Weather check triggered'}</h3><p>${state.events[0]?.time || ''}</p></section>
    <section class="card miniPlayer"><div class="album small">Poolside<br><span>Suno</span></div><div><p class="eyebrow">NOW PLAYING</p><h3>${currentTrack().title}</h3><p>Ⅱ Music Paused</p></div><button>🔇</button></section>
    <button class="primary full" id="clearAlert">Clear Alert / Resume</button>
  `);
}

function musicScreen() {
  return appShell(`<section class="card"><h3>${state.playlistName}</h3><p>${state.playlistUrl}</p>${state.tracks.map((t,i) => row(t, i+1)).join('')}</section>`);
}

function announcementsScreen() {
  return appShell(`
    <section class="card"><h3>Speak Now</h3><textarea id="instantMessage">${state.instantMessage}</textarea><div class="grid two"><label>Repeat Count<input id="repeatCount" type="number" value="${state.repeatCount}" min="1"></label><label>Delay Seconds<input id="repeatDelay" type="number" value="${state.repeatDelay}" min="0"></label></div><button class="primary" id="speakNow">Speak Now</button></section>
    <section class="card"><h3>Event History</h3>${state.events.map(e => `<div class="event"><b>${e.text}</b><span>${e.time}</span></div>`).join('')}</section>
  `);
}

function safetyAdmin() {
  return appShell(`
    <section class="card"><h3>Weather Safety</h3><p>Prototype checks run every 5 minutes. Use a paid lightning provider before relying on this for real safety operations.</p><button class="dangerBtn" id="testLightning">Trigger Lightning Test</button><button class="primary" id="checkWeather">Check Weather Now</button><button class="ghost" id="clearAlert">Clear Alert</button></section>
    <section class="card"><h3>Emergency Message</h3><textarea id="emergencyMessage">${state.emergencyMessage}</textarea><h3>Lifeguard Instructions</h3><textarea id="lifeguardMessage">${state.lifeguardMessage}</textarea><h3>Clear-to-Reopen Message</h3><textarea id="clearMessage">${state.clearMessage}</textarea><button class="primary" id="saveSafety">Save Safety Text</button></section>
  `);
}

function adminScreen() {
  if (!state.admin) {
    return appShell(`<section class="card login"><h3>Admin Access</h3><p>Enter the prototype admin passcode.</p><input id="adminCode" placeholder="Passcode" type="password"><button class="primary" id="adminLogin">Enter Admin</button><p class="muted">Default prototype passcode: 2468. Replace with real authentication before public use.</p></section>`);
  }
  return appShell(`
    <section class="adminTabs card"><button data-admin="playlist" class="active">Playlist</button><button data-admin="announcements">Announcements</button><button data-admin="safety">Safety</button><button data-admin="voice">Voice</button></section>
    <section class="card"><p class="eyebrow">PLAYLIST</p><h3>Add / Update Playlist</h3><label>Playlist Name<input id="playlistName" value="${state.playlistName}"></label><label>Suno Playlist URL<input id="playlistUrl" value="${state.playlistUrl}"></label><div class="grid four"><input id="newTitle" placeholder="Song title"><input id="newArtist" placeholder="Artist"><input id="newDuration" placeholder="3:00"><input id="newAudio" placeholder="Direct audio URL optional"></div><button class="primary" id="addTrack">Add Track</button><h3>Bulk Import</h3><p class="muted">One song per line: Title | Artist | Duration | optional audio URL</p><textarea id="bulkImport">${state.tracks.map(t => `${t.title} | ${t.artist} | ${t.duration} | ${t.audioUrl || ''}`).join('\n')}</textarea><button class="primary" id="savePlaylist">Save Playlist</button></section>
    <section class="card"><h3>Current Queue</h3>${state.tracks.map((t,i) => `<div class="trackEdit"><div><b>${i+1}. ${t.title}</b><p>${t.artist} · ${t.duration}</p></div><button data-up="${i}">↑</button><button data-down="${i}">↓</button><button data-del="${i}">Delete</button></div>`).join('')}</section>
    <section class="card"><h3>Quick Admin Actions</h3><button class="dangerBtn" id="testLightning">Trigger Lightning Test</button><button class="primary" id="speakAdmin">Speak Instant Message</button><button class="ghost" id="adminLogout">Log Out</button></section>
  `);
}

function row(t, number = '') {
  return `<div class="songRow"><span>${number}</span><div class="thumb"></div><div><b>${t.title}</b><p>${t.artist}</p></div><em>${t.duration}</em></div>`;
}

function render() {
  const root = document.getElementById('app');
  const map = { dashboard, music: musicScreen, safety: safetyAdmin, announcements: announcementsScreen, admin: adminScreen };
  root.innerHTML = (map[state.tab] || dashboard)();
  bind();
}

function bind() {
  document.querySelectorAll('[data-tab]').forEach(btn => btn.onclick = () => { state.tab = btn.dataset.tab; saveState(); render(); });
  const byId = id => document.getElementById(id);
  if (byId('playPause')) byId('playPause').onclick = () => state.musicPaused ? playMusic() : (pauseMusic(), render());
  if (byId('nextTrack')) byId('nextTrack').onclick = nextTrack;
  if (byId('clearAlert')) byId('clearAlert').onclick = clearSafetyAlert;
  if (byId('testLightning')) byId('testLightning').onclick = () => startSafetyAlert('Lightning');
  if (byId('checkWeather')) byId('checkWeather').onclick = checkWeather;
  if (byId('adminLogin')) byId('adminLogin').onclick = () => { if (byId('adminCode').value === ADMIN_CODE) { state.admin = true; event('Admin logged in', 'admin'); saveState(); render(); } else alert('Wrong passcode'); };
  if (byId('adminLogout')) byId('adminLogout').onclick = () => { state.admin = false; saveState(); render(); };
  if (byId('speakNow')) byId('speakNow').onclick = () => { state.instantMessage = byId('instantMessage').value; state.repeatCount = +byId('repeatCount').value || 1; state.repeatDelay = +byId('repeatDelay').value || 0; saveState(); speak(state.instantMessage, state.repeatCount, state.repeatDelay); };
  if (byId('speakAdmin')) byId('speakAdmin').onclick = () => speak(state.instantMessage, state.repeatCount, state.repeatDelay);
  if (byId('saveSafety')) byId('saveSafety').onclick = () => { state.emergencyMessage = byId('emergencyMessage').value; state.lifeguardMessage = byId('lifeguardMessage').value; state.clearMessage = byId('clearMessage').value; event('Safety text updated', 'admin'); saveState(); render(); };
  if (byId('addTrack')) byId('addTrack').onclick = () => { const title = byId('newTitle').value.trim(); if (!title) return; state.tracks.push({ title, artist: byId('newArtist').value || 'Unknown', duration: byId('newDuration').value || '3:00', audioUrl: byId('newAudio').value || '' }); event(`Added track: ${title}`, 'music'); saveState(); render(); };
  if (byId('savePlaylist')) byId('savePlaylist').onclick = () => { state.playlistName = byId('playlistName').value; state.playlistUrl = byId('playlistUrl').value; importTracks(byId('bulkImport').value); event('Playlist updated', 'music'); saveState(); render(); };
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { state.tracks.splice(+b.dataset.del, 1); state.currentTrack = 0; saveState(); render(); });
  document.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; if (i > 0) { [state.tracks[i-1], state.tracks[i]] = [state.tracks[i], state.tracks[i-1]]; saveState(); render(); } });
  document.querySelectorAll('[data-down]').forEach(b => b.onclick = () => { const i = +b.dataset.down; if (i < state.tracks.length - 1) { [state.tracks[i+1], state.tracks[i]] = [state.tracks[i], state.tracks[i+1]]; saveState(); render(); } });
}

setInterval(() => checkWeather(), 5 * 60 * 1000);
if (state.countdown > 0) startTimer();
render();
