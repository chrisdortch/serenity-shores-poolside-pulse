const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const icons = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m13 7-4 6h4l-2 4 5-7h-4l1-3Z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M17.5 19H8a6 6 0 1 1 1.1-11.9 7 7 0 0 1 13 3.9A4 4 0 0 1 17.5 19Z"/><path d="m13 12-3 4h4l-2 4 5-6h-4l2-2Z"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m3 11 18-5v12L3 13v-2Z"/><path d="M7 14v5a2 2 0 0 0 2 2h1"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m6 5 10 7-10 7V5Zm11 0h2v14h-2z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 5 8 12l10 7V5ZM5 5h2v14H5z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  wave: '<svg viewBox="0 0 120 70" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M25 39c12-13 24-13 35 0s24 13 35 0" stroke="#0789a5" stroke-width="7" stroke-linecap="round"/><path d="M18 52c16-13 30-13 42 0s28 13 42 0" stroke="#0ea5b7" stroke-width="7" stroke-linecap="round"/><path d="M42 29a18 18 0 0 1 36 0" stroke="#0789a5" stroke-width="7" stroke-linecap="round"/></svg>',
  lightning: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m13 2-8 12h6l-1 8 9-13h-6l0-7Z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m23 9-6 6M17 9l6 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>'
};

const defaultState = {
  page: 'home',
  adminTab: 'playlist',
  authenticated: false,
  adminCode: '2468',
  playlist: {
    name: 'Poolside Suno Mix',
    sourceUrl: 'https://suno.com/playlist/serenity-shores-poolside-suno-mix',
    startedAt: new Date().toISOString(),
    tracks: [
      { title: 'Good Life', artist: 'OneRepublic', duration: 222, audioUrl: '', note: 'Demo tone plays unless a direct audio URL is added.' },
      { title: 'Island In The Sun', artist: 'Weezer', duration: 200, audioUrl: '', note: '' },
      { title: 'Riptide', artist: 'Vance Joy', duration: 204, audioUrl: '', note: '' },
      { title: 'Here Comes The Sun', artist: 'The Beatles', duration: 185, audioUrl: '', note: '' },
      { title: 'Watermelon Sugar', artist: 'Harry Styles', duration: 174, audioUrl: '', note: '' }
    ]
  },
  announcements: {
    instantMessage: 'Please close umbrellas due to wind.',
    repeatCount: 2,
    repeatDelay: 10,
    emergencyMessage: 'Attention guests: lightning has been detected nearby. Please exit the pool area immediately.',
    lifeguardMessage: 'Ensure all guests exit the pool area. Close umbrellas, secure loose items, and take shelter indoors.',
    reopenMessage: 'The pool is now clear to reopen. Thank you.'
  },
  weather: {
    enabled: true,
    latitude: 36.6317,
    longitude: -93.4171,
    radiusMiles: 10,
    checkIntervalMinutes: 5,
    clearMinutes: 30,
    lastCheck: null,
    lastSummary: 'Waiting for first weather check.',
    strictMode: false
  },
  voice: {
    voiceURI: '',
    rate: 1,
    pitch: 1,
    volume: 1
  },
  safety: {
    active: false,
    reason: '',
    triggeredAt: null,
    clearCountdownEndsAt: null,
    countdownSeconds: 1800,
    musicPausedBySafety: false
  },
  player: {
    index: 0,
    isPlaying: false,
    elapsed: 0,
    volume: 0.8
  },
  eventLog: [
    { type: 'system', message: 'System initialized in isolated Poolside Pulse app.', at: new Date().toISOString() }
  ]
};

let state = loadState();
let audioEl = new Audio();
let tickHandle;
let weatherHandle;
let speechVoices = [];
let tone = { ctx: null, osc: null, gain: null, started: false };

function loadState() {
  try {
    const raw = localStorage.getItem('poolsidePulseState');
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return mergeDeep(structuredClone(defaultState), parsed);
  } catch {
    return structuredClone(defaultState);
  }
}
function saveState() { localStorage.setItem('poolsidePulseState', JSON.stringify(state)); }
function mergeDeep(target, source) {
  for (const key of Object.keys(source || {})) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      target[key] = mergeDeep(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
function logEvent(type, message) {
  state.eventLog.unshift({ type, message, at: new Date().toISOString() });
  state.eventLog = state.eventLog.slice(0, 80);
  saveState();
}
function formatDuration(seconds = 0) {
  const m = Math.floor(seconds / 60);
  const s = Math.max(0, Math.floor(seconds % 60)).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function formatClock(seconds = 0) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.max(0, Math.floor(seconds % 60)).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function nowTrack() { return state.playlist.tracks[state.player.index] || state.playlist.tracks[0]; }
function upcomingTracks() {
  return state.playlist.tracks.map((t, i) => ({...t, originalIndex: i})).filter(t => t.originalIndex !== state.player.index).slice(0, 5);
}
function recentlyPlayed() {
  const before = state.playlist.tracks.slice(Math.max(0, state.player.index - 4), state.player.index).reverse();
  return before.length ? before : state.playlist.tracks.slice(-4).reverse();
}
function totalDuration() { return state.playlist.tracks.reduce((a,t) => a + Number(t.duration || 0), 0); }

function render() {
  const app = $('#app');
  const nav = navButtons();
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="logo-mark">${icons.wave}</div><div><h1>Serenity Shores</h1><small>Poolside Pulse</small></div></div>
        <nav class="nav">${nav}</nav>
        <div class="sidebar-art"></div>
        <div class="pool-status-mini"><span class="dot ${state.safety.active ? 'danger' : ''}"></span><div><strong>${state.safety.active ? 'Pool is Closed' : 'Pool is Open'}</strong><div class="sub">${state.safety.active ? 'Safety alert active' : (state.player.isPlaying ? 'Music is playing' : 'Music paused')}</div></div></div>
      </aside>
      <main>${page()}</main>
      <nav class="mobile-nav">${nav}</nav>
    </div>`;
  bindGlobal();
}
function navButtons() {
  const pages = [
    ['home','Home',icons.home], ['music','Music',icons.music], ['safety','Safety',icons.shield], ['announcements','Announcements',icons.bell], ['admin','Admin',icons.menu]
  ];
  return pages.map(([id,label,icon]) => `<button data-page="${id}" class="${state.page===id?'active':''}">${icon}<span>${label}</span></button>`).join('');
}
function page() {
  const header = `<div class="topbar"><div><div class="kicker">Public app · isolated project</div><h2>${pageTitle()}</h2><p>${pageSubtitle()}</p></div><div class="system-pill"><span class="dot ${state.safety.active?'danger':''}"></span><div><strong>${state.safety.active?'Safety Alert Active':'System Healthy'}</strong><div class="sub">${state.weather.lastCheck ? `Last weather check ${new Date(state.weather.lastCheck).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}` : 'Weather check pending'}</div></div></div></div>`;
  if (state.page === 'home') return `${hero()}${alertBanner()}${dashboardGrid()}${announcementsStrip()}`;
  if (state.page === 'music') return `${header}${musicPage()}`;
  if (state.page === 'safety') return `${header}${alertBanner()}${safetyPage()}`;
  if (state.page === 'announcements') return `${header}${announcementsPage()}`;
  return `${header}${adminPage()}`;
}
function pageTitle() {
  return { home:'Poolside Pulse', music:'Music & Queue', safety:'Safety Automation', announcements:'Announcements', admin:'Admin Control' }[state.page];
}
function pageSubtitle() {
  return { home:'Music, updates, and pool safety.', music:'Review the current playlist and queue.', safety:'Weather monitoring, alert timer, and activity history.', announcements:'Speak immediate or scheduled pool updates.', admin:'Playlist, announcement, safety, and voice controls.' }[state.page];
}
function hero() {
  const safetyText = state.safety.active ? 'Pool Closed' : 'Pool Open';
  return `<section class="hero"><div class="hero-inner"><div class="wave-logo">${icons.wave}</div><h1>Serenity Shores<span>Poolside Pulse</span></h1><p>Music, updates, and pool safety.</p><div class="status-chips"><span class="chip ${state.safety.active?'danger':''}"><span class="dot ${state.safety.active?'danger':''}"></span>${safetyText}</span><span class="chip">${icons.shield}${state.safety.active?'Weather Alert':'Weather Safe'}</span><span class="chip">${icons.clock} Auto-check every ${state.weather.checkIntervalMinutes} min</span></div></div></section>`;
}
function alertBanner() {
  return `<section class="alert-banner ${state.safety.active?'active':''}"><div class="alert-icon">${icons.lightning}</div><div><h2>${state.safety.reason || 'Weather Alert'} — Exit the Pool</h2><p>${state.announcements.emergencyMessage}</p></div><button class="secondary" data-action="speakEmergency">Speak Again</button></section>`;
}
function dashboardGrid() {
  return `<section class="grid"><div>${playerCard()}<div class="grid" style="grid-template-columns:1fr 1fr">${recentCard()}${upNextCard()}</div></div><aside>${playlistSummary()}${safetyMini()}</aside></section>`;
}
function playerCard() {
  const t = nowTrack();
  const duration = Number(t?.duration || 180);
  const pct = Math.min(100, (state.player.elapsed / duration) * 100);
  return `<section class="card player-card"><div class="album" aria-label="Poolside Suno Mix album art"></div><div class="player-meta"><div class="row-head"><div><div class="kicker">Now playing</div><div class="song-title">${escapeHtml(t?.title || 'No Track')}</div><div class="artist">${escapeHtml(t?.artist || 'Unknown Artist')}</div><div class="playlist-name">${icons.music} ${escapeHtml(state.playlist.name)}</div></div><button class="icon-btn" data-action="toggleFavorite" title="Favorite">♡</button></div><div class="progress"><div style="width:${pct}%"></div></div><div class="time-row"><span>${formatDuration(state.player.elapsed)}</span><span>${formatDuration(duration)}</span></div><div class="controls"><button class="icon-btn" data-action="shuffle">${icons.shuffle}</button><button class="icon-btn" data-action="prev">${icons.prev}</button><button class="big-play" data-action="togglePlay">${state.player.isPlaying ? icons.pause : icons.play}</button><button class="icon-btn" data-action="next">${icons.next}</button><button class="icon-btn" data-action="repeat">${icons.repeat}</button></div></div></section>`;
}
function recentCard() {
  return `<section class="card"><div class="row-head"><h3>Recently Played</h3><button class="link-btn" data-page="music">View all</button></div><div class="list">${recentlyPlayed().slice(0,4).map(trackRow).join('')}</div></section>`;
}
function upNextCard() {
  return `<section class="card"><div class="row-head"><h3>Up Next</h3><button class="link-btn" data-page="music">View all</button></div><div class="list">${upcomingTracks().slice(0,5).map(trackRow).join('')}</div></section>`;
}
function trackRow(t, i) {
  return `<div class="list-row"><div class="thumb">${i+1}</div><div><div class="title">${escapeHtml(t.title)}</div><div class="sub">${escapeHtml(t.artist)}</div></div><div class="sub">${formatDuration(t.duration)}</div></div>`;
}
function playlistSummary() {
  const started = new Date(state.playlist.startedAt || Date.now());
  return `<section class="card metric-card"><h3>Today's Playlist</h3><p class="sub">Curated for Serenity Shores</p><div class="metrics"><div class="metric"><strong>${state.playlist.tracks.length}</strong><span>Songs</span></div><div class="metric"><strong>${formatDuration(totalDuration())}</strong><span>Duration</span></div><div class="metric"><strong>${started.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</strong><span>Started</span></div></div><button class="secondary" data-page="admin" data-admin-tab="playlist">Update Playlist</button></section>`;
}
function safetyMini() {
  return `<section class="card" style="margin-top:22px"><div class="row-head"><h3>Safety Automation</h3>${icons.shield}</div><h3>${state.safety.active ? 'Alert in progress.' : 'You’re protected.'}</h3><p>Lightning/thunderstorm and tornado conditions are checked using key-free public weather services. Radius: ${state.weather.radiusMiles} miles.</p><button class="secondary" data-page="safety">How it works</button></section>`;
}
function announcementsStrip() {
  const activeMsg = state.safety.active ? state.announcements.emergencyMessage : 'No active announcements.';
  return `<section class="card announce-strip"><div class="row-head"><div><h3>Live Announcements</h3><p>${escapeHtml(activeMsg)}</p></div><button class="primary" data-page="announcements">Speak Now</button></div><div class="announce-items"><div class="announce-item"><strong>Pool Opens</strong><div class="sub">Pool is open. Enjoy your day!</div></div><div class="announce-item"><strong>Hydration Reminder</strong><div class="sub">Drink water and stay hydrated.</div></div><div class="announce-item"><strong>Sun Safety</strong><div class="sub">Reapply sunscreen and take breaks in the shade.</div></div></div></section>`;
}
function musicPage() {
  return `${playerCard()}<section class="grid"><div class="card"><h3>Full Queue</h3><div class="list">${state.playlist.tracks.map((t,i) => `<div class="list-row"><div class="thumb">${i+1}</div><div><div class="title">${escapeHtml(t.title)}</div><div class="sub">${escapeHtml(t.artist)}${t.audioUrl ? ' · Direct audio URL' : ' · Demo tone'}</div></div><button class="secondary" data-action="playIndex" data-index="${i}">Play</button></div>`).join('')}</div></div>${playlistSummary()}</section>`;
}
function safetyPage() {
  const countdown = state.safety.active ? getRemainingCountdown() : state.weather.clearMinutes * 60;
  return `<section class="grid"><div><section class="card"><div class="kicker">Safety timer</div><div class="timer">${formatClock(countdown)}</div><p>${state.safety.active ? 'Exit the pool and seek shelter.' : 'Timer starts when a safety event is detected.'}</p><div class="button-row"><button class="danger-btn" data-action="simulateLightning">Simulate Lightning Alert</button><button class="secondary" data-action="clearSafety">Clear Alert / Resume</button><button class="secondary" data-action="checkWeatherNow">Check Weather Now</button></div></section><section class="card" style="margin-top:22px"><h3>Lifeguard Instructions</h3><p>${escapeHtml(state.announcements.lifeguardMessage)}</p><button class="primary" data-action="speakLifeguard">Speak Lifeguard Instructions</button></section></div><aside><section class="card"><h3>Weather Status</h3><p><strong>Last summary:</strong> ${escapeHtml(state.weather.lastSummary)}</p><p><strong>Location:</strong> ${state.weather.latitude}, ${state.weather.longitude}</p><p><strong>Check interval:</strong> ${state.weather.checkIntervalMinutes} minutes</p><div class="notice warning-note">Best estimate risk: free services may miss real lightning strikes. Use this as a supplemental alert system until a dedicated lightning data provider is connected.</div></section><section class="card" style="margin-top:22px"><h3>Activity Log</h3><div class="event-log">${eventsHtml()}</div></section></aside></section>`;
}
function announcementsPage() {
  return `<section class="grid"><div><section class="card"><h3>Speak Now</h3><div class="form-field"><label for="instantMessage">Message</label><textarea id="instantMessage">${escapeHtml(state.announcements.instantMessage)}</textarea></div><div class="form-grid" style="margin:14px 0"><div class="form-field"><label for="repeatCount">Repeat count</label><input id="repeatCount" type="number" min="1" max="20" value="${state.announcements.repeatCount}"></div><div class="form-field"><label for="repeatDelay">Delay between repeats, seconds</label><input id="repeatDelay" type="number" min="0" max="300" value="${state.announcements.repeatDelay}"></div></div><div class="button-row"><button class="primary" data-action="speakInstant">Speak Now</button><button class="secondary" data-action="previewInstant">Preview</button><button class="secondary" data-page="admin" data-admin-tab="announcements">Edit saved messages</button></div></section><section class="card" style="margin-top:22px"><h3>Active Announcement</h3><p>${state.safety.active ? escapeHtml(state.announcements.emergencyMessage) : 'No active announcements.'}</p></section></div><aside><section class="card"><h3>Recent Announcement History</h3><div class="event-log">${eventsHtml(['announcement','safety'])}</div></section></aside></section>`;
}
function adminPage() {
  if (!state.authenticated) return loginCard();
  const tabs = [['playlist','Playlist'],['announcements','Announcements'],['safety','Safety'],['voice','Voice']].map(([id,label]) => `<button data-admin-tab="${id}" class="${state.adminTab===id?'active':''}">${label}</button>`).join('');
  return `<div class="admin-tabs">${tabs}</div>${adminTabHtml()}`;
}
function loginCard() {
  return `<section class="card" style="max-width:620px"><h3>Admin Access</h3><p>This prototype protects admin controls with a local passcode so guests do not casually reach controls. For production, replace this with real Vercel/NextAuth authentication before public launch.</p><div class="notice warning-note">Security risk estimate: a front-end-only passcode has an 80–95% likelihood of being bypassable by a technical user if the app is public. It is acceptable for a private demo; it is not acceptable as final production admin security.</div><div class="form-field"><label for="adminCode">Admin passcode</label><input id="adminCode" type="password" placeholder="Enter passcode"></div><div class="button-row" style="margin-top:14px"><button class="primary" data-action="loginAdmin">Unlock Admin</button><span class="sub">Demo default: 2468. Change it in code before sharing publicly.</span></div></section>`;
}
function adminTabHtml() {
  if (state.adminTab === 'playlist') return playlistAdmin();
  if (state.adminTab === 'announcements') return announcementsAdmin();
  if (state.adminTab === 'safety') return safetyAdmin();
  return voiceAdmin();
}
function playlistAdmin() {
  return `<section class="card"><div class="row-head"><div><div class="kicker">Dedicated playlist section</div><h3>Add / Update Playlist</h3></div><button class="secondary" data-action="resetDemoPlaylist">Reset Demo</button></div><div class="notice">Suno playlist pages are not guaranteed to expose direct playable audio to a web app. Paste the Suno playlist link for reference, then add direct audio URLs for reliable playback when available. Tracks without audio URLs use the built-in demo tone so the player remains functional.</div><div class="form-grid"><div class="form-field"><label for="playlistName">Playlist name</label><input id="playlistName" value="${escapeAttr(state.playlist.name)}"></div><div class="form-field"><label for="playlistUrl">Suno playlist URL</label><input id="playlistUrl" value="${escapeAttr(state.playlist.sourceUrl)}" placeholder="https://suno.com/playlist/... "></div></div><div class="button-row" style="margin-top:14px"><button class="primary" data-action="savePlaylistSource">Save Playlist Source</button><button class="secondary" data-action="importPlaylistText">Import Tracks From Text</button></div><div id="importBox" class="hidden" style="margin-top:14px"><div class="form-field"><label for="bulkTracks">Paste tracks, one per line: Title - Artist - 3:42 - optional audio URL</label><textarea id="bulkTracks" placeholder="Good Life - OneRepublic - 3:42 - https://example.com/audio.mp3"></textarea></div><button class="primary" data-action="applyImport">Apply Import</button></div><div class="track-editor"><h3>Add track</h3><div class="form-grid"><div class="form-field"><label for="trackTitle">Title</label><input id="trackTitle"></div><div class="form-field"><label for="trackArtist">Artist</label><input id="trackArtist"></div><div class="form-field"><label for="trackDuration">Duration, seconds</label><input id="trackDuration" type="number" min="10" value="180"></div><div class="form-field"><label for="trackAudio">Direct audio URL, optional</label><input id="trackAudio" placeholder="https://...mp3, wav, m4a"></div></div><button class="primary" style="margin-top:14px" data-action="addTrack">Add Track</button></div><div class="track-list-admin"><h3>Current queue</h3>${state.playlist.tracks.map((t,i)=>adminTrackRow(t,i)).join('')}</div></section>`;
}
function adminTrackRow(t,i) {
  return `<div class="track-admin-row"><div class="thumb">${i+1}</div><div><strong>${escapeHtml(t.title)}</strong><div class="sub">${escapeHtml(t.artist)} · ${formatDuration(t.duration)}${t.audioUrl ? ' · audio URL saved' : ' · demo tone'}</div></div><div class="small-actions"><button data-action="moveTrack" data-index="${i}" data-dir="-1">↑</button><button data-action="moveTrack" data-index="${i}" data-dir="1">↓</button><button data-action="editTrack" data-index="${i}">Edit</button><button data-action="deleteTrack" data-index="${i}">Delete</button></div></div>`;
}
function announcementsAdmin() {
  return `<section class="card"><h3>Announcement Messages</h3><div class="form-grid"><div class="form-field"><label for="adminInstant">Instant notification default</label><textarea id="adminInstant">${escapeHtml(state.announcements.instantMessage)}</textarea></div><div class="form-field"><label for="adminEmergency">Emergency pool-exit announcement</label><textarea id="adminEmergency">${escapeHtml(state.announcements.emergencyMessage)}</textarea></div><div class="form-field"><label for="adminLifeguard">Lifeguard instructions</label><textarea id="adminLifeguard">${escapeHtml(state.announcements.lifeguardMessage)}</textarea></div><div class="form-field"><label for="adminReopen">Clear-to-reopen announcement</label><textarea id="adminReopen">${escapeHtml(state.announcements.reopenMessage)}</textarea></div></div><div class="button-row" style="margin-top:14px"><button class="primary" data-action="saveAnnouncements">Save Announcements</button><button class="secondary" data-action="speakEmergency">Preview Emergency</button><button class="secondary" data-action="speakReopen">Preview Reopen</button></div></section>`;
}
function safetyAdmin() {
  return `<section class="card"><h3>Weather Automation</h3><div class="form-grid"><div class="form-field"><label for="weatherEnabled">Weather checks</label><select id="weatherEnabled"><option value="true" ${state.weather.enabled?'selected':''}>Enabled</option><option value="false" ${!state.weather.enabled?'selected':''}>Disabled</option></select></div><div class="form-field"><label for="strictMode">Strict mode</label><select id="strictMode"><option value="false" ${!state.weather.strictMode?'selected':''}>Tornado + thunderstorm signals</option><option value="true" ${state.weather.strictMode?'selected':''}>Only official NWS warnings</option></select></div><div class="form-field"><label for="lat">Latitude</label><input id="lat" type="number" step="0.0001" value="${state.weather.latitude}"></div><div class="form-field"><label for="lon">Longitude</label><input id="lon" type="number" step="0.0001" value="${state.weather.longitude}"></div><div class="form-field"><label for="radius">Radius, miles</label><input id="radius" type="number" min="1" max="100" value="${state.weather.radiusMiles}"></div><div class="form-field"><label for="checkInterval">Check interval, minutes</label><input id="checkInterval" type="number" min="1" max="60" value="${state.weather.checkIntervalMinutes}"></div><div class="form-field"><label for="clearMinutes">Clear duration before reopen, minutes</label><input id="clearMinutes" type="number" min="1" max="120" value="${state.weather.clearMinutes}"></div></div><div class="notice warning-note">Production note: key-free weather can support tornado/thunderstorm warnings, but true strike-level lightning within 10 miles needs a provider such as a commercial lightning feed. I would connect that before relying on this for guest safety.</div><div class="button-row" style="margin-top:14px"><button class="primary" data-action="saveSafety">Save Safety Settings</button><button class="secondary" data-action="checkWeatherNow">Check Weather Now</button><button class="danger-btn" data-action="simulateLightning">Simulate Alert</button></div></section>`;
}
function voiceAdmin() {
  return `<section class="card"><h3>Voice / Text-to-Speech</h3><div class="notice">This uses the browser/device SpeechSynthesis engine, which is free. Realism depends on the installed voices on the device connected to the pool receiver.</div><div class="form-grid"><div class="form-field"><label for="voiceSelect">Voice</label><select id="voiceSelect">${voiceOptions()}</select></div><div class="form-field"><label for="voiceRate">Speed</label><input id="voiceRate" type="range" min="0.7" max="1.25" step="0.05" value="${state.voice.rate}"></div><div class="form-field"><label for="voicePitch">Pitch</label><input id="voicePitch" type="range" min="0.6" max="1.4" step="0.05" value="${state.voice.pitch}"></div><div class="form-field"><label for="voiceVolume">Volume</label><input id="voiceVolume" type="range" min="0.1" max="1" step="0.05" value="${state.voice.volume}"></div></div><div class="button-row" style="margin-top:14px"><button class="primary" data-action="saveVoice">Save Voice Settings</button><button class="secondary" data-action="previewVoice">Play Sample</button></div></section>`;
}
function eventsHtml(filter) {
  const list = filter ? state.eventLog.filter(e => filter.includes(e.type)) : state.eventLog;
  return (list.length ? list : [{type:'system', message:'No matching events yet.', at:new Date().toISOString()}]).slice(0,20).map(e => `<div class="event"><strong>${escapeHtml(e.message)}</strong><time>${new Date(e.at).toLocaleString()}</time></div>`).join('');
}
function voiceOptions() {
  const voices = speechVoices.length ? speechVoices : speechSynthesis.getVoices();
  if (!voices.length) return '<option value="">Default device voice</option>';
  return ['<option value="">Default device voice</option>', ...voices.map(v => `<option value="${escapeAttr(v.voiceURI)}" ${state.voice.voiceURI===v.voiceURI?'selected':''}>${escapeHtml(v.name)} — ${escapeHtml(v.lang)}</option>`)].join('');
}
function bindGlobal() {
  $$('[data-page]').forEach(btn => btn.addEventListener('click', () => {
    state.page = btn.dataset.page;
    if (btn.dataset.adminTab) state.adminTab = btn.dataset.adminTab;
    saveState(); render();
  }));
  $$('[data-admin-tab]').forEach(btn => btn.addEventListener('click', () => {
    state.adminTab = btn.dataset.adminTab;
    saveState(); render();
  }));
  $$('[data-action]').forEach(btn => btn.addEventListener('click', () => handleAction(btn)));
}
async function handleAction(el) {
  const action = el.dataset.action;
  if (action === 'togglePlay') return togglePlay();
  if (action === 'next') return nextTrack();
  if (action === 'prev') return prevTrack();
  if (action === 'shuffle') return shuffleTrack();
  if (action === 'repeat') { state.player.elapsed = 0; saveState(); return render(); }
  if (action === 'playIndex') return playIndex(Number(el.dataset.index));
  if (action === 'speakInstant' || action === 'previewInstant') return speakInstant();
  if (action === 'speakEmergency') return speak(state.announcements.emergencyMessage, 'safety');
  if (action === 'speakLifeguard') return speak(state.announcements.lifeguardMessage, 'safety');
  if (action === 'speakReopen') return speak(state.announcements.reopenMessage, 'safety');
  if (action === 'simulateLightning') return triggerSafety('Lightning Alert', 'Manual lightning simulation triggered for testing.');
  if (action === 'clearSafety') return clearSafety(true);
  if (action === 'checkWeatherNow') return checkWeatherNow(true);
  if (action === 'loginAdmin') return loginAdmin();
  if (action === 'savePlaylistSource') return savePlaylistSource();
  if (action === 'importPlaylistText') return $('#importBox')?.classList.toggle('hidden');
  if (action === 'applyImport') return applyImport();
  if (action === 'addTrack') return addTrack();
  if (action === 'moveTrack') return moveTrack(Number(el.dataset.index), Number(el.dataset.dir));
  if (action === 'deleteTrack') return deleteTrack(Number(el.dataset.index));
  if (action === 'editTrack') return editTrack(Number(el.dataset.index));
  if (action === 'resetDemoPlaylist') { state.playlist = structuredClone(defaultState.playlist); logEvent('system', 'Demo playlist restored.'); saveState(); return render(); }
  if (action === 'saveAnnouncements') return saveAnnouncements();
  if (action === 'saveSafety') return saveSafety();
  if (action === 'saveVoice') return saveVoice();
  if (action === 'previewVoice') return speak('Welcome to Serenity Shores. This is a test of the voice system.', 'announcement');
}
function loginAdmin() {
  const code = $('#adminCode')?.value || '';
  if (code === state.adminCode) {
    state.authenticated = true;
    logEvent('system', 'Admin unlocked.');
    saveState(); render();
  } else {
    alert('Incorrect passcode.');
  }
}
function savePlaylistSource() {
  state.playlist.name = $('#playlistName').value.trim() || 'Poolside Suno Mix';
  state.playlist.sourceUrl = $('#playlistUrl').value.trim();
  logEvent('system', `Playlist source updated: ${state.playlist.name}`);
  saveState(); render();
}
function addTrack() {
  const title = $('#trackTitle').value.trim();
  if (!title) return alert('Track title is required.');
  state.playlist.tracks.push({
    title,
    artist: $('#trackArtist').value.trim() || 'Unknown Artist',
    duration: Number($('#trackDuration').value || 180),
    audioUrl: $('#trackAudio').value.trim(),
    note: ''
  });
  logEvent('system', `Track added: ${title}`);
  saveState(); render();
}
function applyImport() {
  const text = $('#bulkTracks').value.trim();
  if (!text) return;
  const tracks = text.split('\n').map(line => {
    const parts = line.split(' - ').map(p => p.trim());
    const [title, artist, durationRaw, audioUrl=''] = parts;
    return { title: title || 'Untitled', artist: artist || 'Unknown Artist', duration: parseDuration(durationRaw || '3:00'), audioUrl, note: '' };
  });
  state.playlist.tracks = tracks.filter(t => t.title);
  state.player.index = 0;
  state.player.elapsed = 0;
  logEvent('system', `Imported ${state.playlist.tracks.length} playlist tracks.`);
  saveState(); render();
}
function parseDuration(raw) {
  if (!raw) return 180;
  if (/^\d+$/.test(raw)) return Number(raw);
  const [m,s] = raw.split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
}
function moveTrack(index, dir) {
  const next = index + dir;
  if (next < 0 || next >= state.playlist.tracks.length) return;
  [state.playlist.tracks[index], state.playlist.tracks[next]] = [state.playlist.tracks[next], state.playlist.tracks[index]];
  if (state.player.index === index) state.player.index = next;
  saveState(); render();
}
function deleteTrack(index) {
  if (state.playlist.tracks.length <= 1) return alert('At least one track is required.');
  const [deleted] = state.playlist.tracks.splice(index, 1);
  state.player.index = Math.min(state.player.index, state.playlist.tracks.length - 1);
  logEvent('system', `Track deleted: ${deleted.title}`);
  saveState(); render();
}
function editTrack(index) {
  const t = state.playlist.tracks[index];
  const title = prompt('Track title', t.title); if (title === null) return;
  const artist = prompt('Artist', t.artist); if (artist === null) return;
  const duration = prompt('Duration in seconds', t.duration); if (duration === null) return;
  const audioUrl = prompt('Direct audio URL (optional)', t.audioUrl || ''); if (audioUrl === null) return;
  state.playlist.tracks[index] = { ...t, title: title.trim() || t.title, artist: artist.trim() || t.artist, duration: Number(duration || t.duration), audioUrl: audioUrl.trim() };
  logEvent('system', `Track updated: ${state.playlist.tracks[index].title}`);
  saveState(); render();
}
function saveAnnouncements() {
  state.announcements.instantMessage = $('#adminInstant').value.trim();
  state.announcements.emergencyMessage = $('#adminEmergency').value.trim();
  state.announcements.lifeguardMessage = $('#adminLifeguard').value.trim();
  state.announcements.reopenMessage = $('#adminReopen').value.trim();
  logEvent('system', 'Announcement text updated.');
  saveState(); render();
}
function saveSafety() {
  state.weather.enabled = $('#weatherEnabled').value === 'true';
  state.weather.strictMode = $('#strictMode').value === 'true';
  state.weather.latitude = Number($('#lat').value);
  state.weather.longitude = Number($('#lon').value);
  state.weather.radiusMiles = Number($('#radius').value);
  state.weather.checkIntervalMinutes = Number($('#checkInterval').value);
  state.weather.clearMinutes = Number($('#clearMinutes').value);
  state.safety.countdownSeconds = state.weather.clearMinutes * 60;
  logEvent('system', 'Weather automation settings updated.');
  saveState(); scheduleWeatherChecks(); render();
}
function saveVoice() {
  state.voice.voiceURI = $('#voiceSelect').value;
  state.voice.rate = Number($('#voiceRate').value);
  state.voice.pitch = Number($('#voicePitch').value);
  state.voice.volume = Number($('#voiceVolume').value);
  logEvent('system', 'Voice settings updated.');
  saveState(); render();
}
async function speakInstant() {
  const message = $('#instantMessage')?.value?.trim() || state.announcements.instantMessage;
  state.announcements.instantMessage = message;
  state.announcements.repeatCount = Number($('#repeatCount')?.value || state.announcements.repeatCount);
  state.announcements.repeatDelay = Number($('#repeatDelay')?.value || state.announcements.repeatDelay);
  saveState();
  for (let i=0; i<state.announcements.repeatCount; i++) {
    await speak(message, 'announcement', false);
    if (i < state.announcements.repeatCount - 1) await delay(state.announcements.repeatDelay * 1000);
  }
  logEvent('announcement', `Announcement spoken: ${message}`);
  render();
}
function speak(text, type='announcement', shouldLog=true) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) { alert('SpeechSynthesis is not available in this browser.'); resolve(); return; }
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const selected = voices.find(v => v.voiceURI === state.voice.voiceURI);
    if (selected) utter.voice = selected;
    utter.rate = state.voice.rate; utter.pitch = state.voice.pitch; utter.volume = state.voice.volume;
    utter.onend = () => resolve(); utter.onerror = () => resolve();
    speechSynthesis.speak(utter);
    if (shouldLog) logEvent(type, `Spoken: ${text}`);
  });
}
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function togglePlay() {
  if (state.safety.active) return alert('Music is paused during an active safety alert. Clear the alert before resuming.');
  state.player.isPlaying ? pauseMusic() : playMusic();
}
function playMusic() {
  const t = nowTrack();
  state.player.isPlaying = true;
  if (t.audioUrl) {
    stopTone();
    if (audioEl.src !== t.audioUrl) audioEl.src = t.audioUrl;
    audioEl.volume = state.player.volume;
    audioEl.currentTime = Math.min(state.player.elapsed, Math.max(0, Number(t.duration || 0)-1));
    audioEl.play().catch(() => {
      logEvent('system', 'Direct audio URL could not play. Falling back to demo tone.');
      playTone();
    });
  } else {
    audioEl.pause();
    playTone();
  }
  logEvent('system', `Music started: ${t.title}`);
  saveState(); render();
}
function pauseMusic(log=true) {
  state.player.isPlaying = false;
  audioEl.pause();
  stopTone();
  if (log) logEvent('system', 'Music paused.');
  saveState(); render();
}
function nextTrack() {
  state.player.index = (state.player.index + 1) % state.playlist.tracks.length;
  state.player.elapsed = 0;
  const wasPlaying = state.player.isPlaying;
  audioEl.pause(); stopTone();
  saveState(); render();
  if (wasPlaying) playMusic();
}
function prevTrack() {
  state.player.index = (state.player.index - 1 + state.playlist.tracks.length) % state.playlist.tracks.length;
  state.player.elapsed = 0;
  const wasPlaying = state.player.isPlaying;
  audioEl.pause(); stopTone();
  saveState(); render();
  if (wasPlaying) playMusic();
}
function shuffleTrack() {
  state.player.index = Math.floor(Math.random() * state.playlist.tracks.length);
  state.player.elapsed = 0;
  saveState(); render();
}
function playIndex(index) {
  state.player.index = index;
  state.player.elapsed = 0;
  saveState();
  playMusic();
}
function playTone() {
  try {
    if (!tone.ctx) tone.ctx = new AudioContext();
    stopTone(false);
    const osc = tone.ctx.createOscillator();
    const gain = tone.ctx.createGain();
    const base = 175 + ((state.player.index * 41) % 160);
    osc.frequency.value = base;
    osc.type = 'sine';
    gain.gain.value = 0.045 * state.player.volume;
    osc.connect(gain).connect(tone.ctx.destination);
    osc.start();
    tone.osc = osc; tone.gain = gain; tone.started = true;
  } catch {}
}
function stopTone(close=false) {
  try { tone.osc?.stop(); } catch {}
  tone.osc = null; tone.gain = null; tone.started = false;
  if (close && tone.ctx) { tone.ctx.close(); tone.ctx = null; }
}
function startTicks() {
  clearInterval(tickHandle);
  tickHandle = setInterval(() => {
    if (state.player.isPlaying && !state.safety.active) {
      const t = nowTrack();
      state.player.elapsed += 1;
      if (state.player.elapsed >= Number(t.duration || 180)) nextTrack(); else { saveState(); updateLiveBits(); }
    }
    if (state.safety.active) updateSafetyTimer();
  }, 1000);
}
function updateLiveBits() {
  const t = nowTrack();
  const pct = Math.min(100, (state.player.elapsed / Number(t.duration || 180)) * 100);
  $('.progress > div')?.setAttribute('style', `width:${pct}%`);
  const times = $$('.time-row span');
  if (times[0]) times[0].textContent = formatDuration(state.player.elapsed);
}
function updateSafetyTimer() {
  const remaining = getRemainingCountdown();
  state.safety.countdownSeconds = remaining;
  if (remaining <= 0) clearSafety(true);
  else {
    const timer = $('.timer'); if (timer) timer.textContent = formatClock(remaining);
    saveState();
  }
}
function getRemainingCountdown() {
  if (!state.safety.clearCountdownEndsAt) return state.weather.clearMinutes * 60;
  return Math.max(0, Math.ceil((new Date(state.safety.clearCountdownEndsAt).getTime() - Date.now()) / 1000));
}
async function triggerSafety(reason='Weather Alert', detail='Weather conditions triggered the safety rule.') {
  const alreadyActive = state.safety.active;
  state.safety.active = true;
  state.safety.reason = reason;
  state.safety.triggeredAt = state.safety.triggeredAt || new Date().toISOString();
  state.safety.clearCountdownEndsAt = new Date(Date.now() + state.weather.clearMinutes * 60000).toISOString();
  if (state.player.isPlaying) {
    state.safety.musicPausedBySafety = true;
    pauseMusic(false);
  }
  logEvent('safety', `${reason}: ${detail}`);
  saveState(); render();
  if (!alreadyActive) {
    await speak(state.announcements.emergencyMessage, 'safety');
    await speak(state.announcements.lifeguardMessage, 'safety');
  }
}
async function clearSafety(announce=false) {
  const shouldResume = state.safety.musicPausedBySafety;
  state.safety.active = false;
  state.safety.reason = '';
  state.safety.triggeredAt = null;
  state.safety.clearCountdownEndsAt = null;
  state.safety.countdownSeconds = state.weather.clearMinutes * 60;
  state.safety.musicPausedBySafety = false;
  logEvent('safety', 'Safety alert cleared.');
  saveState(); render();
  if (announce) await speak(state.announcements.reopenMessage, 'safety');
  if (shouldResume) playMusic();
}
async function checkWeatherNow(manual=false) {
  if (!state.weather.enabled && !manual) return;
  state.weather.lastCheck = new Date().toISOString();
  try {
    const [nws, meteo] = await Promise.allSettled([fetchNwsAlerts(), fetchOpenMeteo()]);
    const risks = [];
    if (nws.status === 'fulfilled') risks.push(...nws.value);
    if (!state.weather.strictMode && meteo.status === 'fulfilled') risks.push(...meteo.value);
    if (risks.length) {
      state.weather.lastSummary = risks[0].summary;
      await triggerSafety(risks[0].label, risks[0].summary);
    } else {
      state.weather.lastSummary = 'No tornado warnings or thunderstorm signals detected by the configured free sources.';
      logEvent('system', manual ? 'Manual weather check: clear.' : 'Weather check: clear.');
      if (state.safety.active && !state.safety.clearCountdownEndsAt) {
        state.safety.clearCountdownEndsAt = new Date(Date.now() + state.weather.clearMinutes * 60000).toISOString();
      }
    }
  } catch (error) {
    state.weather.lastSummary = `Weather check failed: ${error.message}`;
    logEvent('system', state.weather.lastSummary);
  }
  saveState(); render();
}
async function fetchNwsAlerts() {
  const url = `https://api.weather.gov/alerts/active?point=${state.weather.latitude},${state.weather.longitude}`;
  const res = await fetch(url, { headers: { Accept: 'application/geo+json' } });
  if (!res.ok) throw new Error(`NWS ${res.status}`);
  const data = await res.json();
  const events = (data.features || []).map(f => f.properties || {});
  const matching = events.filter(e => /tornado warning|severe thunderstorm warning|extreme wind warning/i.test(e.event || ''));
  return matching.map(e => ({ label: /tornado/i.test(e.event) ? 'Tornado Warning' : 'Severe Weather Alert', summary: `${e.event}: ${e.headline || e.description || 'Official NWS alert active.'}` }));
}
async function fetchOpenMeteo() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${state.weather.latitude}&longitude=${state.weather.longitude}&current=weather_code,precipitation,wind_speed_10m&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  const code = Number(data.current?.weather_code);
  const thunderCodes = new Set([95, 96, 99]);
  if (thunderCodes.has(code)) return [{ label: 'Lightning Alert', summary: `Thunderstorm weather code ${code} detected by Open-Meteo near the resort.` }];
  return [];
}
function scheduleWeatherChecks() {
  clearInterval(weatherHandle);
  if (!state.weather.enabled) return;
  weatherHandle = setInterval(() => checkWeatherNow(false), Math.max(1, state.weather.checkIntervalMinutes) * 60000);
}
function escapeHtml(value='') {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function escapeAttr(value='') { return escapeHtml(value); }

if ('speechSynthesis' in window) {
  speechVoices = speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => { speechVoices = speechSynthesis.getVoices(); if (state.page === 'admin' && state.adminTab === 'voice') render(); };
}
audioEl.addEventListener('ended', nextTrack);
audioEl.addEventListener('timeupdate', () => {
  if (nowTrack()?.audioUrl) {
    state.player.elapsed = audioEl.currentTime;
    updateLiveBits();
  }
});
render();
startTicks();
scheduleWeatherChecks();
setTimeout(() => checkWeatherNow(false), 1200);
