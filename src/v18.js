const VERSION = '18';
const PIN = '7900';
const KEY = 'poolside-pulse-v18';
const DEVICE_KEY = 'poolside-pulse-v18-device-id';
const HANDLED_KEY = 'poolside-pulse-v18-handled-events';
const LOG_CLEAR_KEY = 'poolside-pulse-v18-log-cleared-at';
const RECEIVER_SESSION_KEY = 'poolside-pulse-v18-receiver-session-started-at';
const SPOTIFY_TOKEN_KEY = 'poolside-pulse-v18-spotify-token';
const APP_QUERY = '?v=18';
const LEGACY_STATE_KEYS = [
  'poolside-pulse-v17',
  'poolside-pulse-v9',
  'poolside-pulse-v8',
  'poolside-pulse-v7',
  'poolside-pulse-v6',
  'poolside-pulse-v59',
  'poolside-pulse-v58',
  'poolside-pulse-v57',
  'poolside-pulse-v56',
  'poolside-pulse-v55',
  'poolside-pulse-v5',
  'poolside-pulse-v49'
];
const LEGACY_TOKEN_KEYS = [
  'poolside-pulse-v17-spotify-token',
  'poolside-pulse-v16-spotify-token',
  'poolside-pulse-v15-spotify-token',
  'poolside-pulse-v14-spotify-token',
  'poolside-pulse-v13-spotify-token',
  'poolside-pulse-v12-spotify-token',
  'poolside-pulse-v11-spotify-token',
  'poolside-pulse-v9-spotify-token',
  'poolside-pulse-v8-spotify-token',
  'poolside-pulse-v7-spotify-token',
  'poolside-pulse-v59-spotify-token',
  'poolside-pulse-v510-spotify-token',
  'poolside-pulse-v6-spotify-token',
  'poolside-pulse-v58-spotify-token',
  'poolside-pulse-v57-spotify-token',
  'poolside-pulse-v56-spotify-token'
];
const API = {
  state: '/api/state?v=18',
  suno: '/api/suno-playlist?url=',
  tts: '/api/tts',
  voiceHealth: '/api/voice-health',
  weather: '/api/weather',
  geo: '/api/geocode?address='
};
const PROVIDERS = { spotify: 'Spotify', suno: 'Suno' };
const DEFAULT_PUBLIC_APP_URL = 'https://serenity-shores-poolside-pulse.vercel.app/';
const DEFAULT_SPOTIFY_CLIENT_ID = '7e086716aaea4ce98051287b552a676c';
const DEFAULT_SPOTIFY_PLAYLIST = 'https://open.spotify.com/playlist/0WPOOzy3puLNwxukYt9pTw';
const DEFAULT_SUNO_PLAYLIST = '';
const LEGACY_DELETED_SUNO_PLAYLIST = 'https://suno.com/playlist/cf4b536e-9005-4c98-9ea5-a7f01eca116f';
const LEGACY_DELETED_SUNO_ID_PATTERN = /cf4b536e-9005/i;
const DEFAULT_ADDRESS = '615 Serenity Shores Ln, Kimberling City, MO 65686';
const DEFAULT_MUSIC_VOLUME = 15;
const V18_VOLUME_DEFAULTS_ID = '2026-06-24-final-v18b-music15-duck0-ann300-clean';
const EVENT_TTL_MS = 90 * 60 * 1000;
const EVENT_LIMIT = 120;
const LOG_LIMIT = 180;
const EVENT_RETRY_MS = 9000;
const RECEIVER_EVENT_GRACE_MS = 3000;
const PENDING_MUSIC_COMMAND_GRACE_MS = 3 * 60 * 1000;
const RETRYABLE_MUSIC_COMMANDS = new Set(['spotify-play', 'play', 'suno', 'suno-cue', 'song']);
const OLD_AUDIO_BLOCK_PATTERN = /play\(\) failed|goo\.gl\/xX8pDD|play method is not allowed|user did(?:n't| not) interact|user agent or the platform/i;
const STALE_RECEIVER_FAILURE_PATTERN = /restriction violated|player command failed|device not found|HTTP 429|HTTP 404|receiver will retry|Suno page returned HTTP 404|transfer is not active|not the audible Spotify device|Start Speaker Phone/i;

const DEFAULT_ANNS = [
  ['welcome', 'Welcome', 'Good morning and welcome to Serenity Shores. We are glad your family is here. Please supervise children, keep glass out of the pool area, and follow lifeguard instructions so everyone can enjoy a safe day by the water.'],
  ['owner', 'Owner Message', 'From all of us at Serenity Shores, thank you for spending part of your vacation with us. We hope this place feels peaceful, fun, and memorable for your family.'],
  ['manager', 'Manager Message', 'Friendly Serenity Shores reminder: safety comes first, children must be supervised, and lifeguard instructions should be followed right away.'],
  ['birthday', 'Birthday', 'Happy birthday, {name}, from Serenity Shores. We hope your day is absolutely wonderful.'],
  ['close15', 'Closing 15', 'Attention guests, the pool will close in 15 minutes. Please begin gathering your belongings.'],
  ['close5', 'Closing 5', 'Attention guests, the pool will close in 5 minutes. Thank you for spending the day at Serenity Shores.'],
  ['umbrellas', 'Close Umbrellas', 'Attention guests, please close all umbrellas and secure loose items. Thank you.'],
  ['lightning', 'Lightning Hold', 'Attention guests and lifeguards. Lightning has been detected within ten miles of Serenity Shores. Please exit the pool and clear the water now. The pool must remain clear for 30 minutes. If another strike is detected, that 30 minute safety clock resets. Lifeguards will announce when the pool may reopen.'],
  ['wind', 'Strong Wind', 'Attention guests and lifeguards. Strong wind has been detected near Serenity Shores. Please close umbrellas, secure loose items, and follow staff instructions.'],
  ['lightningclear', 'Lightning All Clear', 'Attention guests and lifeguards. The lightning safety hold has ended. Lifeguards may reopen the pool when the area is ready and conditions remain safe.'],
  ['hydrate', 'Hydration', 'Friendly reminder from Serenity Shores: take a water break, reapply sunscreen, and keep an eye on younger swimmers.'],
  ['noglass', 'No Glass', 'Friendly reminder: glass is not permitted in the pool area. Thank you for helping us keep the pool safe for everyone.'],
  ['safety', 'Safety Hold', 'Attention guests, we are taking a safety hold. Please clear the pool and follow lifeguard instructions.'],
  ['weatherwatch', 'Weather Watch', 'Attention guests, weather is being monitored near Serenity Shores. Please stay alert for instructions from lifeguards.']
].map(([id, label, text]) => ({ id, label, text, mode: 'voice', trackIndex: 0 }));

const DEFAULT_SCHEDULE = [
  { id: 'open', label: 'Pool Open Welcome', type: 'announcement', time: '09:05', announcementId: 'welcome', enabled: true },
  { id: 'ten', label: '10am Welcome', type: 'announcement', time: '10:00', announcementId: 'welcome', enabled: true },
  { id: 'lunch', label: 'Lunch Safety Reminder', type: 'announcement', time: '12:30', announcementId: 'noglass', enabled: true },
  { id: 'hydrate', label: 'Afternoon Hydration', type: 'announcement', time: '15:00', announcementId: 'hydrate', enabled: true },
  { id: 'close15', label: 'Closing 15', type: 'announcement', offsetToClose: 15, announcementId: 'close15', enabled: true },
  { id: 'close5', label: 'Closing 5', type: 'announcement', offsetToClose: 5, announcementId: 'close5', enabled: true }
];

const DEFAULT_PARTY_SCHEDULE = [
  { id: 'party-welcome', label: 'Party Welcome', type: 'text', time: '18:00', text: 'Welcome to the Serenity Shores poolside party. Music is starting now. Please keep glass away from the pool, supervise children, and enjoy the evening.', enabled: true },
  { id: 'party-music', label: 'Party Music', type: 'spotify', time: '18:05', url: DEFAULT_SPOTIFY_PLAYLIST, enabled: true },
  { id: 'party-hydrate', label: 'Party Hydration', type: 'announcement', time: '19:30', announcementId: 'hydrate', enabled: true },
  { id: 'party-close', label: 'Party Closing', type: 'announcement', offsetToClose: 15, announcementId: 'close15', enabled: true }
];

const BASE = {
  version: VERSION,
  screen: 'home',
  admin: false,
  tab: 'command',
  revision: 0,
  sync: false,
  syncMode: 'starting',
  feedback: 'Ready.',
  lastError: '',
  setupNotice: '',
  musicProvider: 'spotify',
  playlistName: 'Serenity Shores Poolside Pulse',
  playlistUrl: DEFAULT_SUNO_PLAYLIST,
  quickMusicUrl: DEFAULT_SPOTIFY_PLAYLIST,
  spotifyUrl: DEFAULT_SPOTIFY_PLAYLIST,
  spotifyClientId: DEFAULT_SPOTIFY_CLIENT_ID,
  spotifyRedirectUri: '',
  spotifyVolume: DEFAULT_MUSIC_VOLUME,
  spotifyDuckedVolume: 0,
  announcementGain: 3,
  sunoVolume: DEFAULT_MUSIC_VOLUME,
  sunoDuckedVolume: 2,
  tracks: [{ title: 'Import the Serenity Shores playlist', artist: 'Poolside Pulse', duration: '3:00', audioUrl: '' }],
  current: 0,
  intent: 'stopped',
  activeMusicLabel: 'Nothing has been sent to receivers yet.',
  activeMusicProvider: 'spotify',
  activeMusicUrl: DEFAULT_SPOTIFY_PLAYLIST,
  manualMusicHoldUntil: 0,
  manualMusicHoldReason: '',
  manualMusicStartUntil: 0,
  manualMusicStartReason: '',
  command: null,
  announcement: null,
  events: [],
  activityLog: [],
  receiverStatus: 'Receiver has not reported yet.',
  receiverLastSeen: '',
  receiverActiveAt: 0,
  spotifyStatus: 'Spotify has not been checked yet.',
  spotifyNowPlaying: '',
  spotifyDeviceId: '',
  spotifyDeviceName: '',
  spotifyReceiverReadyAt: 0,
  spotifyAccountProduct: '',
  spotifyDevicesSummary: '',
  spotifyNeedsTap: false,
  spotifyLastError: '',
  anns: DEFAULT_ANNS,
  selected: 'welcome',
  quickText: '',
  guestName: '',
  activeSchedule: 'daily',
  schedule: DEFAULT_SCHEDULE,
  partySchedule: DEFAULT_PARTY_SCHEDULE,
  editId: 'new',
  lastRun: {},
  poolOpen: '09:00',
  poolClose: '22:00',
  playbackMode: 'hours',
  autoStart: true,
  autoStop: true,
  v18DefaultsApplied: true,
  v18VolumeDefaultsApplied: V18_VOLUME_DEFAULTS_ID,
  address: DEFAULT_ADDRESS,
  lat: '36.6337',
  lon: '-93.4166',
  radius: 10,
  lightningRadiusMiles: 10,
  lightningHoldMinutes: 30,
  windGustMph: 35,
  weatherAuto: true,
  weather: 'Weather monitor is standing by.',
  weatherCheckedAt: '',
  weatherLastThreatKey: '',
  lightningText: '',
  windText: '',
  lightningClearText: '',
  lightningClearAt: 0,
  lightningLastStrikeKey: '',
  lightningLastStrikeAt: 0,
  lightningAllClearSent: false,
  voiceMode: 'ai',
  aiVoice: 'marin',
  deviceVoice: '',
  rate: .94,
  pitch: 1,
  voiceHealth: 'Not checked yet.',
  audioStatus: 'Receiver audio has not been activated yet.'
};

const memoryStore = {};
let S = loadState();
let receiverActive = false;
let speaking = false;
let voices = [];
let spotifyPlayer = null;
let spotifyPlayerReady = false;
let spotifyWebDeviceId = '';
let spotifyPrimePromise = null;
let spotifyWarmPromise = null;
let spotifyFreshTapActivatedPlayer = false;
let statePulling = false;
let pendingRender = false;
let spotifyVolumeApplyTimer = null;
let audioSettingsApplyTimer = null;
let weatherRunning = false;
let announcementTail = Promise.resolve();
let fallbackAudioUnlocked = false;
let fallbackAudioContext = null;
let fallbackUnlockAudio = null;
let fallbackUnlockToneUrl = '';
const retryAfter = {};
const inFlightEvents = new Set();

const music = new Audio();
music.preload = 'auto';
music.playsInline = true;
music.setAttribute('playsinline', '');
music.setAttribute('webkit-playsinline', '');
music.volume = musicGain();
music.addEventListener('ended', () => nextSuno(false, 'Suno track ended; advancing.').catch(error => setFeedback(error.message, false)));
music.addEventListener('error', () => nextSuno(false, 'Suno track failed; trying the next playable track.').catch(error => setFeedback(error.message, false)));

const announcementMusic = new Audio();
announcementMusic.preload = 'auto';
announcementMusic.playsInline = true;
announcementMusic.setAttribute('playsinline', '');
announcementMusic.setAttribute('webkit-playsinline', '');
announcementMusic.volume = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function $(id) {
  return document.getElementById(id);
}

function val(id) {
  return $(id)?.value || '';
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function stamp(ts = Date.now()) {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function storageGet(key) {
  try {
    return localStorage.getItem(key) ?? memoryStore[key] ?? '';
  } catch {
    return memoryStore[key] || '';
  }
}

function storageSet(key, value) {
  memoryStore[key] = String(value);
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key) {
  delete memoryStore[key];
  try { localStorage.removeItem(key); } catch {}
}

function sessionGet(key) {
  try {
    return sessionStorage.getItem(key) ?? memoryStore[`session:${key}`] ?? '';
  } catch {
    return memoryStore[`session:${key}`] || '';
  }
}

function sessionSet(key, value) {
  memoryStore[`session:${key}`] = String(value);
  try { sessionStorage.setItem(key, String(value)); } catch {}
}

function appRedirectDefault() {
  try {
    return new URL('/', location.origin).href;
  } catch {
    return DEFAULT_PUBLIC_APP_URL;
  }
}

function normalizeRedirectUri(raw) {
  try {
    const fallback = appRedirectDefault();
    const url = new URL(String(raw || fallback).trim() || fallback, location.href);
    url.search = '';
    url.hash = '';
    return url.href.endsWith('/') ? url.href : `${url.href}/`;
  } catch {
    return DEFAULT_PUBLIC_APP_URL;
  }
}

function spotifyRedirectUri() {
  return normalizeRedirectUri(S.spotifyRedirectUri || appRedirectDefault());
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}

function musicVolumePercent(value = S?.sunoVolume) {
  return clampNumber(value, 0, 100, DEFAULT_MUSIC_VOLUME);
}

function musicGain(value = S?.sunoVolume) {
  return musicVolumePercent(value) / 100;
}

function bool(value, fallback = false) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

function parseCoord(value) {
  const n = Number(String(value ?? '').trim().replace(/[−–—]/g, '-'));
  return Number.isFinite(n) ? n : null;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function mergeById(limit, newestFirst, ...lists) {
  const map = new Map();
  for (const source of lists) {
    for (const item of list(source)) {
      if (item?.id) map.set(item.id, { ...map.get(item.id), ...item });
    }
  }
  const sorted = [...map.values()].sort((a, b) => {
    const at = Number(a.ts || a.createdAt || 0);
    const bt = Number(b.ts || b.createdAt || 0);
    return newestFirst ? bt - at : at - bt;
  });
  return newestFirst ? sorted.slice(0, limit) : sorted.slice(-limit);
}

function eventTime(event) {
  return Number(event?.createdAt || event?.ts || 0) || 0;
}

function recentEvents(events) {
  const cutoff = Date.now() - EVENT_TTL_MS;
  return list(events)
    .filter(event => event?.id && eventTime(event) >= cutoff)
    .sort((a, b) => eventTime(a) - eventTime(b))
    .slice(-EVENT_LIMIT);
}

function defaultAnn(id) {
  return DEFAULT_ANNS.find(item => item.id === id) || DEFAULT_ANNS[0];
}

function normalizeAnnItem(item) {
  const source = item && typeof item === 'object' ? item : {};
  return {
    id: String(source.id || uid()),
    label: String(source.label || 'Announcement'),
    text: String(source.text || ''),
    mode: source.mode === 'suno' ? 'suno' : 'voice',
    trackIndex: Math.max(0, Number(source.trackIndex) || 0)
  };
}

function normalizedUrlKey(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return `${parsed.hostname}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return String(url || '').trim().replace(/\/+$/, '').toLowerCase();
  }
}

function isDeletedDefaultSunoUrl(url) {
  return !!url && normalizedUrlKey(url) === normalizedUrlKey(LEGACY_DELETED_SUNO_PLAYLIST);
}

function hasDeletedSunoReference(value) {
  return isDeletedDefaultSunoUrl(value) || LEGACY_DELETED_SUNO_ID_PATTERN.test(String(value || ''));
}

function hasStaleReceiverFailure(value) {
  return STALE_RECEIVER_FAILURE_PATTERN.test(String(value || ''));
}

function clearStaleReceiverFailures(state) {
  if (!state || typeof state !== 'object') return state;
  if (hasStaleReceiverFailure(state.setupNotice)) state.setupNotice = '';
  if (hasStaleReceiverFailure(state.lastError)) state.lastError = '';
  if (hasStaleReceiverFailure(state.spotifyLastError)) state.spotifyLastError = '';
  if (hasStaleReceiverFailure(state.spotifyStatus)) {
    state.spotifyStatus = String(state.spotifyStatus || '')
      .replace(/\n?Last Spotify issue:.*$/s, '')
      .trim() || BASE.spotifyStatus;
  }
  if (hasStaleReceiverFailure(state.feedback)) state.feedback = 'Ready.';
  state.activityLog = list(state.activityLog).filter(entry => !hasStaleReceiverFailure(`${entry?.title || ''} ${entry?.detail || ''}`));
  return state;
}

function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const s = { ...clone(BASE), ...clone(source), version: VERSION };
  const importedFromV18 = String(source.version || '') === VERSION || source.v18DefaultsApplied;

  // V18 uses Spotify as the continuous bed. Suno is a cue/announcement source,
  // not a persistent receiver mode, so stale Suno provider state cannot hijack startup.
  s.musicProvider = 'spotify';
  s.spotifyUrl = String(s.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST);
  const migratedDeletedSuno = [
    s.playlistUrl,
    s.quickMusicUrl,
    s.activeMusicUrl,
    s.activeMusicLabel,
    s.receiverStatus,
    s.spotifyNowPlaying
  ].some(hasDeletedSunoReference) || list(s.tracks).some(item => hasDeletedSunoReference(item?.sourceUrl) || hasDeletedSunoReference(item?.playlistUrl));
  s.playlistUrl = hasDeletedSunoReference(s.playlistUrl) ? '' : String(s.playlistUrl || DEFAULT_SUNO_PLAYLIST);
  s.quickMusicUrl = hasDeletedSunoReference(s.quickMusicUrl)
    ? s.spotifyUrl
    : String(s.quickMusicUrl || s.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST);
  s.spotifyClientId = String(s.spotifyClientId || DEFAULT_SPOTIFY_CLIENT_ID);
  s.spotifyRedirectUri = normalizeRedirectUri(s.spotifyRedirectUri || appRedirectDefault());
  s.spotifyVolume = clampNumber(s.spotifyVolume, 0, 100, DEFAULT_MUSIC_VOLUME);
  s.spotifyDuckedVolume = clampNumber(s.spotifyDuckedVolume, 0, 20, 0);
  s.announcementGain = clampNumber(s.announcementGain, 1, 3.4, 3);
  s.sunoVolume = clampNumber(s.sunoVolume, 0, 100, DEFAULT_MUSIC_VOLUME);
  s.sunoDuckedVolume = clampNumber(s.sunoDuckedVolume, 0, 20, 2);
  if (source.v18VolumeDefaultsApplied !== V18_VOLUME_DEFAULTS_ID) {
    s.spotifyVolume = DEFAULT_MUSIC_VOLUME;
    s.spotifyDuckedVolume = 0;
    s.sunoVolume = DEFAULT_MUSIC_VOLUME;
    s.announcementGain = 3;
    s.feedback = 'Ready.';
    s.lastError = '';
    s.setupNotice = '';
    s.spotifyLastError = '';
    s.v18VolumeDefaultsApplied = V18_VOLUME_DEFAULTS_ID;
  }
  s.manualMusicHoldUntil = Math.max(0, Number(s.manualMusicHoldUntil || 0) || 0);
  s.manualMusicHoldReason = String(s.manualMusicHoldReason || '');
  s.manualMusicStartUntil = Math.max(0, Number(s.manualMusicStartUntil || 0) || 0);
  s.manualMusicStartReason = String(s.manualMusicStartReason || '');
  s.spotifyReceiverReadyAt = Math.max(0, Number(s.spotifyReceiverReadyAt || 0) || 0);
  s.radius = clampNumber(s.radius, 1, 25, 10);
  s.lightningRadiusMiles = clampNumber(s.lightningRadiusMiles || s.radius, 1, 25, 10);
  s.lightningHoldMinutes = clampNumber(s.lightningHoldMinutes, 5, 90, 30);
  s.windGustMph = clampNumber(s.windGustMph, 15, 80, 35);
  s.weatherAuto = bool(s.weatherAuto, true);
  s.autoStart = bool(s.autoStart, true);
  s.autoStop = bool(s.autoStop, true);
  s.playbackMode = ['always', 'hours'].includes(s.playbackMode) ? s.playbackMode : 'hours';
  if (!importedFromV18) {
    if (!source.playbackMode || source.playbackMode === 'always') s.playbackMode = 'hours';
    if (source.autoStop === undefined || source.autoStop === false) s.autoStop = true;
  }
  s.v18DefaultsApplied = true;
  s.anns = list(s.anns).length ? list(s.anns).map(normalizeAnnItem) : clone(DEFAULT_ANNS).map(normalizeAnnItem);
  const annIds = new Set(s.anns.map(item => item.id));
  for (const item of DEFAULT_ANNS) {
    if (!annIds.has(item.id)) s.anns.push(normalizeAnnItem(item));
  }
  s.activeSchedule = s.activeSchedule === 'party' ? 'party' : 'daily';
  s.schedule = list(s.schedule).length ? list(s.schedule) : clone(DEFAULT_SCHEDULE);
  s.partySchedule = list(s.partySchedule).length ? list(s.partySchedule) : clone(DEFAULT_PARTY_SCHEDULE);
  s.tracks = list(s.tracks).length ? list(s.tracks).slice(0, 300) : clone(BASE.tracks);
  if (migratedDeletedSuno) {
    s.tracks = clone(BASE.tracks);
    s.current = 0;
    s.lastError = '';
    s.activeMusicLabel = BASE.activeMusicLabel;
    s.activeMusicProvider = 'spotify';
    s.activeMusicUrl = s.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST;
    s.spotifyNowPlaying = '';
    s.musicProvider = 'spotify';
  }
  s.current = Math.max(0, Math.min(Number(s.current) || 0, Math.max(0, s.tracks.length - 1)));
  s.anns = s.anns.map(item => ({
    ...item,
    trackIndex: Math.max(0, Math.min(Number(item.trackIndex) || 0, Math.max(0, s.tracks.length - 1)))
  }));
  if (!s.selected || !s.anns.find(item => item.id === s.selected)) s.selected = s.anns[0]?.id || 'welcome';
  if (!s.quickText) s.quickText = (s.anns.find(item => item.id === s.selected) || defaultAnn('welcome')).text;
  s.lightningText = s.lightningText || defaultAnn('lightning').text;
  s.windText = s.windText || defaultAnn('wind').text;
  s.lightningClearText = s.lightningClearText || defaultAnn('lightningclear').text;
  s.lastRun = s.lastRun && typeof s.lastRun === 'object' ? s.lastRun : {};
  s.events = recentEvents(s.events);
  s.activityLog = mergeById(LOG_LIMIT, true, s.activityLog);
  s.editId = s.editId || 'new';
  if (OLD_AUDIO_BLOCK_PATTERN.test(String(s.audioStatus || ''))) s.audioStatus = BASE.audioStatus;
  if (OLD_AUDIO_BLOCK_PATTERN.test(String(s.setupNotice || ''))) s.setupNotice = '';
  clearStaleReceiverFailures(s);
  if (source.rev && !source.revision) s.revision = Number(source.rev) || 0;
  if (source.cmd && !source.command) s.command = source.cmd;
  if (source.announce && !source.announcement) s.announcement = source.announce;
  return s;
}

function loadState() {
  for (const key of [KEY, ...LEGACY_STATE_KEYS]) {
    try {
      const raw = storageGet(key);
      if (raw) return normalize(JSON.parse(raw));
    } catch {}
  }
  return normalize({});
}

function localSave() {
  storageSet(KEY, JSON.stringify(S));
}

function deviceId() {
  let id = storageGet(DEVICE_KEY);
  if (!id) {
    id = `dev-${Math.random().toString(36).slice(2, 8)}`;
    storageSet(DEVICE_KEY, id);
  }
  return id;
}

function deviceRole() {
  return S.screen === 'home' ? 'receiver' : 'command';
}

function deviceLabel() {
  return `${deviceRole()} ${deviceId().slice(-4)}`;
}

function logEvent(kind, title, detail = '', extra = {}) {
  const entry = { id: uid(), ts: Date.now(), time: stamp(), kind, title, detail, device: deviceLabel(), ...extra };
  S.activityLog = mergeById(LOG_LIMIT, true, [entry], S.activityLog);
  localSave();
  return entry;
}

function receiverActionNeeded(message) {
  return /tap|activate|receiver|speaker-connected|spotify is not connected|login on the.*receiver|audio did not start|autoplay|playback yet|not started audible/i.test(String(message || ''));
}

function actionNeededError(message) {
  const error = Error(message);
  error.receiverActionNeeded = true;
  return error;
}

function isActionNeeded(error) {
  return !!error?.receiverActionNeeded || receiverActionNeeded(error?.message || error);
}

function setActionNeeded(message) {
  S.setupNotice = String(message || '').trim();
  S.lastError = '';
  S.feedback = `Action needed: ${S.setupNotice} · ${stamp()}`;
  localSave();
  const box = $('feedbackBox');
  if (box) box.innerHTML = `<b>Status:</b> ${esc(S.feedback)}`;
}

function setFeedback(message, ok = true) {
  const prefix = ok ? 'OK' : 'Needs attention';
  S.feedback = `${prefix}: ${message} · ${stamp()}`;
  if (!ok && receiverActionNeeded(message)) {
    S.setupNotice = String(message || '').trim();
    S.lastError = '';
  } else if (!ok) {
    S.lastError = message;
  } else {
    S.lastError = '';
    if (!/sent|queued|waiting/i.test(String(message || ''))) S.setupNotice = '';
  }
  localSave();
  const box = $('feedbackBox');
  if (box) box.innerHTML = `<b>Status:</b> ${esc(S.feedback)}`;
}

function receiverOnlyError(message) {
  return /autoplay|audio|tap|activate|receiver|spotify|play method|speaker-connected/i.test(String(message || ''));
}

function visibleLastError() {
  if (!S.lastError) return '';
  if (receiverActionNeeded(S.lastError)) return '';
  if (S.screen !== 'home' && receiverOnlyError(S.lastError)) return '';
  return S.lastError;
}

function uiIsEditing() {
  const el = document.activeElement;
  return !!(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ''));
}

function audioDraftControls() {
  return [
    ['spotifyVolumeCommand', 'spotifyVolume', 0, 100, DEFAULT_MUSIC_VOLUME],
    ['spotifyVolume', 'spotifyVolume', 0, 100, DEFAULT_MUSIC_VOLUME],
    ['spotifyDuckedVolume', 'spotifyDuckedVolume', 0, 20, 0],
    ['sunoVolume', 'sunoVolume', 0, 100, DEFAULT_MUSIC_VOLUME],
    ['announcementGain', 'announcementGain', 1, 3.4, 3],
    ['rate', 'rate', .75, 1.15, .94],
    ['pitch', 'pitch', .85, 1.15, 1]
  ];
}

function captureActiveAudioDrafts() {
  if (!uiIsEditing()) return null;
  const draft = {};
  for (const [id, key, min, max, fallback] of audioDraftControls()) {
    const el = $(id);
    if (el) draft[key] = clampNumber(el.value, min, max, fallback);
  }
  return Object.keys(draft).length ? draft : null;
}

function restoreAudioDrafts(draft) {
  if (!draft) return;
  for (const [key, value] of Object.entries(draft)) S[key] = value;
}

function formDraftIds() {
  return [
    'playlistName',
    'playlistUrl',
    'quickMusicUrl',
    'spotifyUrl',
    'spotifyClientId',
    'spotifyRedirectUri',
    'quickTemplate',
    'quickText',
    'annSelect',
    'annMode',
    'annLabel',
    'annText',
    'annTrack',
    'address',
    'lat',
    'lon',
    'radius',
    'lightningRadiusMiles',
    'lightningHoldMinutes',
    'windGustMph',
    'weatherAuto',
    'lightningText',
    'windText',
    'lightningClearText',
    'playbackMode',
    'autoStart',
    'poolOpen',
    'poolClose',
    'autoStop',
    'voiceMode',
    'aiVoice',
    'deviceVoice'
  ];
}

function applyFormFieldDraft(id, value) {
  const text = String(value ?? '');
  if (id === 'playlistName') S.playlistName = text || S.playlistName;
  else if (id === 'playlistUrl') S.playlistUrl = text.trim();
  else if (id === 'quickMusicUrl') S.quickMusicUrl = text.trim();
  else if (id === 'spotifyUrl') S.spotifyUrl = text.trim() || S.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST;
  else if (id === 'spotifyClientId') S.spotifyClientId = text.trim() || S.spotifyClientId || DEFAULT_SPOTIFY_CLIENT_ID;
  else if (id === 'spotifyRedirectUri') S.spotifyRedirectUri = text.trim() || S.spotifyRedirectUri || appRedirectDefault();
  else if (id === 'quickTemplate' || id === 'annSelect') S.selected = text || S.selected;
  else if (id === 'quickText') S.quickText = text;
  else if (id === 'annMode') ann().mode = text === 'suno' ? 'suno' : 'voice';
  else if (id === 'annLabel') ann().label = text || ann().label;
  else if (id === 'annText') {
    ann().text = text;
    S.quickText = text;
  } else if (id === 'annTrack') ann().trackIndex = clampTrackIndex(text);
  else if (id === 'address') S.address = text || S.address;
  else if (id === 'lat') S.lat = text;
  else if (id === 'lon') S.lon = text;
  else if (id === 'radius') S.radius = clampNumber(text, 1, 25, S.radius);
  else if (id === 'lightningRadiusMiles') S.lightningRadiusMiles = clampNumber(text, 1, 25, S.lightningRadiusMiles);
  else if (id === 'lightningHoldMinutes') S.lightningHoldMinutes = clampNumber(text, 5, 90, S.lightningHoldMinutes);
  else if (id === 'windGustMph') S.windGustMph = clampNumber(text, 15, 80, S.windGustMph);
  else if (id === 'weatherAuto') S.weatherAuto = text === 'true';
  else if (id === 'lightningText') S.lightningText = text;
  else if (id === 'windText') S.windText = text;
  else if (id === 'lightningClearText') S.lightningClearText = text;
  else if (id === 'playbackMode') S.playbackMode = text === 'always' ? 'always' : 'hours';
  else if (id === 'autoStart') S.autoStart = text !== 'false';
  else if (id === 'poolOpen') S.poolOpen = text || S.poolOpen;
  else if (id === 'poolClose') S.poolClose = text || S.poolClose;
  else if (id === 'autoStop') S.autoStop = text !== 'false';
  else if (id === 'voiceMode') S.voiceMode = text === 'device' ? 'device' : 'ai';
  else if (id === 'aiVoice') S.aiVoice = text || S.aiVoice;
  else if (id === 'deviceVoice') S.deviceVoice = text;
}

function updateScheduleRowDraft(index, mode = 'daily') {
  const activeMode = scheduleMode(mode);
  const key = scheduleFieldKey(activeMode, index);
  const row = scheduleItems(activeMode)[index];
  if (!row) return;
  const kind = scheduleField('kind', key)?.value || row.type || 'text';
  const labelEl = scheduleField('label', key);
  const timeEl = scheduleField('row-time', key);
  const bodyEl = scheduleField('body', key);
  const annEl = scheduleField('selann', key);
  row.type = kind;
  row.label = labelEl ? labelEl.value : row.label;
  if (timeEl?.value) {
    row.time = timeEl.value;
    delete row.offsetToClose;
  }
  if (kind === 'announcement') {
    row.announcementId = annEl?.value || row.announcementId || S.selected;
    delete row.text;
    delete row.url;
    delete row.trackIndex;
  } else if (kind === 'text') {
    row.text = bodyEl ? bodyEl.value : (row.text || '');
    delete row.announcementId;
    delete row.url;
    delete row.trackIndex;
  } else if (['suno', 'spotify', 'sunoAnnouncement', 'song'].includes(kind)) {
    row.url = bodyEl ? bodyEl.value.trim() : (row.url || '');
    delete row.announcementId;
    delete row.text;
    delete row.trackIndex;
  }
  localSave();
}

function captureActiveFormDrafts() {
  const hasDraftableControls = formDraftIds().some(id => !!$(id)) || !!document.querySelector('[data-kind-row]');
  if (!uiIsEditing() && !(S.screen !== 'home' && hasDraftableControls)) return null;
  const draft = { fields: {}, schedule: [] };
  for (const id of formDraftIds()) {
    const el = $(id);
    if (el) draft.fields[id] = el.value ?? '';
  }
  document.querySelectorAll('[data-kind-row]').forEach(select => {
    const mode = scheduleMode(select.dataset.scheduleMode);
    const index = Number(select.dataset.kindRow);
    if (!Number.isFinite(index)) return;
    const key = scheduleFieldKey(mode, index);
    draft.schedule.push({
      mode,
      index,
      type: select.value || scheduleItems(mode)[index]?.type || 'text',
      time: scheduleField('row-time', key)?.value || '',
      label: scheduleField('label', key)?.value ?? '',
      body: scheduleField('body', key)?.value ?? '',
      announcementId: scheduleField('selann', key)?.value || ''
    });
  });
  return Object.keys(draft.fields).length || draft.schedule.length ? draft : null;
}

function restoreFormDrafts(draft) {
  if (!draft) return;
  Object.entries(draft.fields || {}).forEach(([id, value]) => applyFormFieldDraft(id, value));
  for (const item of draft.schedule || []) {
    const row = scheduleItems(item.mode)[item.index];
    if (!row) continue;
    row.type = item.type || row.type || 'text';
    row.label = item.label || row.label;
    if (item.time) {
      row.time = item.time;
      delete row.offsetToClose;
    }
    if (row.type === 'announcement') {
      row.announcementId = item.announcementId || row.announcementId || S.selected;
      delete row.text;
      delete row.url;
      delete row.trackIndex;
    } else if (row.type === 'text') {
      row.text = item.body ?? row.text ?? '';
      delete row.announcementId;
      delete row.url;
      delete row.trackIndex;
    } else if (['suno', 'spotify', 'sunoAnnouncement', 'song'].includes(row.type)) {
      row.url = String(item.body ?? row.url ?? '').trim();
      delete row.announcementId;
      delete row.text;
      delete row.trackIndex;
    }
  }
}

function updateFormDraftField(id, value) {
  applyFormFieldDraft(id, value);
  localSave();
}

function renderWhenIdle() {
  if (S.screen !== 'home' && uiIsEditing()) {
    pendingRender = true;
    return;
  }
  render();
}

document.addEventListener('focusout', () => {
  if (!pendingRender) return;
  pendingRender = false;
  setTimeout(render, 70);
}, true);

function cloudState() {
  const c = clone(S);
  c.version = VERSION;
  c.screen = 'home';
  c.admin = false;
  c.tab = 'command';
  c.editId = 'new';
  c.events = recentEvents(S.events);
  c.activityLog = mergeById(LOG_LIMIT, true, S.activityLog);
  delete c.spotifyAccessToken;
  delete c.spotifyRefreshToken;
  delete c.spotifyTokenExpiresAt;
  if (S.screen !== 'home') {
    [
      'intent',
      'current',
      'receiverStatus',
      'receiverLastSeen',
      'receiverActiveAt',
      'audioStatus',
      'setupNotice',
      'spotifyStatus',
      'spotifyNowPlaying',
      'spotifyDeviceId',
      'spotifyDeviceName',
      'spotifyReceiverReadyAt',
      'spotifyAccountProduct',
      'spotifyDevicesSummary',
      'spotifyNeedsTap',
      'spotifyLastError',
      'manualMusicHoldUntil',
      'manualMusicHoldReason',
      'manualMusicStartUntil',
      'manualMusicStartReason'
    ].forEach(key => delete c[key]);
  }
  return c;
}

async function pushState(message = '', options = {}) {
  try {
    const response = await fetch(API.state, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: cloudState() })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw Error(data.error || `State HTTP ${response.status}`);
    S.sync = !!data.cloudSync;
    S.syncMode = data.syncMode || 'server';
    if (data.state?.revision) S.revision = Math.max(Number(S.revision || 0), Number(data.state.revision || 0));
    localSave();
    if (message) setFeedback(message, true);
    if (options.render !== false) renderWhenIdle();
    return true;
  } catch (error) {
    S.sync = false;
    setFeedback(`State sync failed: ${error.message}`, false);
    if (options.render !== false) renderWhenIdle();
    return false;
  }
}

function preserveLocalBeforeMerge() {
  return {
    screen: S.screen,
    admin: S.admin,
    tab: S.tab,
    audioDrafts: captureActiveAudioDrafts(),
    formDrafts: captureActiveFormDrafts(),
    selected: S.selected,
    quickText: S.quickText,
    guestName: S.guestName,
    editId: S.editId,
    feedback: S.feedback,
    lastError: S.lastError,
    setupNotice: S.setupNotice,
    intent: S.intent,
    current: S.current,
    receiverStatus: S.receiverStatus,
    receiverLastSeen: S.receiverLastSeen,
    receiverActiveAt: S.receiverActiveAt,
    audioStatus: S.audioStatus,
    spotifyStatus: S.spotifyStatus,
    spotifyNowPlaying: S.spotifyNowPlaying,
    spotifyDeviceId: S.spotifyDeviceId,
    spotifyDeviceName: S.spotifyDeviceName,
    spotifyReceiverReadyAt: S.spotifyReceiverReadyAt,
    spotifyAccountProduct: S.spotifyAccountProduct,
    spotifyDevicesSummary: S.spotifyDevicesSummary,
    spotifyNeedsTap: S.spotifyNeedsTap,
    spotifyLastError: S.spotifyLastError,
    manualMusicHoldUntil: S.manualMusicHoldUntil,
    manualMusicHoldReason: S.manualMusicHoldReason,
    manualMusicStartUntil: S.manualMusicStartUntil,
    manualMusicStartReason: S.manualMusicStartReason
  };
}

function restoreLocalAfterMerge(local) {
  clearStaleReceiverFailures(local);
  S.screen = local.screen;
  S.admin = local.admin;
  S.tab = local.tab;
  S.selected = local.selected;
  S.quickText = local.quickText;
  S.guestName = local.guestName;
  S.editId = local.editId;
  restoreAudioDrafts(local.audioDrafts);
  restoreFormDrafts(local.formDrafts);
  S.feedback = local.feedback;
  S.lastError = S.screen !== 'home' && receiverOnlyError(S.lastError) ? local.lastError : S.lastError;
  if (S.screen !== 'home' && receiverActionNeeded(S.lastError)) S.lastError = '';
  if (S.screen !== 'home') S.setupNotice = S.setupNotice || local.setupNotice;
  if (S.screen === 'home') {
    [
      'intent',
      'current',
      'receiverStatus',
      'receiverLastSeen',
      'receiverActiveAt',
      'audioStatus',
      'setupNotice',
      'spotifyStatus',
      'spotifyNowPlaying',
      'spotifyDeviceId',
      'spotifyDeviceName',
      'spotifyReceiverReadyAt',
      'spotifyAccountProduct',
      'spotifyDevicesSummary',
      'spotifyNeedsTap',
      'spotifyLastError',
      'manualMusicHoldUntil',
      'manualMusicHoldReason',
      'manualMusicStartUntil',
      'manualMusicStartReason'
    ].forEach(key => { S[key] = local[key]; });
  }
  clearStaleReceiverFailures(S);
}

async function pullState() {
  if (statePulling) return;
  statePulling = true;
  try {
    const response = await fetch(API.state, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    S.sync = !!data.cloudSync;
    S.syncMode = data.syncMode || 'server';
    if (data.state) {
      const local = preserveLocalBeforeMerge();
      S = normalize({
        ...data.state,
        sync: S.sync,
        syncMode: S.syncMode,
        events: mergeById(EVENT_LIMIT, false, S.events, data.state.events),
        activityLog: mergeById(LOG_LIMIT, true, S.activityLog, data.state.activityLog),
        revision: Math.max(Number(S.revision || 0), Number(data.state.revision || 0))
      });
      restoreLocalAfterMerge(local);
      localSave();
    }
    if (S.screen === 'home') await processEvents();
    renderWhenIdle();
  } catch {
    S.sync = false;
    localSave();
  } finally {
    statePulling = false;
  }
}

function handledMap() {
  try {
    return JSON.parse(storageGet(HANDLED_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveHandledMap(map) {
  const cutoff = Date.now() - 30 * 60 * 60 * 1000;
  Object.keys(map).forEach(id => { if (Number(map[id] || 0) < cutoff) delete map[id]; });
  storageSet(HANDLED_KEY, JSON.stringify(map));
}

function wasHandled(id) {
  return !!handledMap()[id];
}

function markHandled(id) {
  if (!id) return;
  const map = handledMap();
  map[id] = Date.now();
  saveHandledMap(map);
}

function unmarkHandled(id) {
  if (!id) return;
  const map = handledMap();
  delete map[id];
  saveHandledMap(map);
}

function receiverSessionStartedAt() {
  return Number(storageGet(RECEIVER_SESSION_KEY) || 0) || 0;
}

function receiverCanProcessEvents() {
  return S.screen === 'home' && receiverAudioReady() && receiverSessionStartedAt() > 0;
}

function isRetryableMusicCommand(event) {
  return event?.kind === 'command' && RETRYABLE_MUSIC_COMMANDS.has(event.type);
}

function markOlderEventsHandled(startAt) {
  const now = Date.now();
  const map = handledMap();
  for (const event of recentEvents(S.events)) {
    if (event?.id && eventTime(event) < startAt - RECEIVER_EVENT_GRACE_MS) {
      if (isRetryableMusicCommand(event) && eventTime(event) >= startAt - PENDING_MUSIC_COMMAND_GRACE_MS) {
        delete map[event.id];
        continue;
      }
      map[event.id] = now;
      delete retryAfter[event.id];
    }
  }
  saveHandledMap(map);
}

function beginReceiverSession(reason = 'receiver start') {
  const startedAt = Date.now();
  storageSet(RECEIVER_SESSION_KEY, String(startedAt));
  markOlderEventsHandled(startedAt);
  if (Number(S.lightningClearAt || 0) && Number(S.lightningClearAt) < startedAt) {
    S.lightningClearAt = 0;
    S.lightningAllClearSent = true;
  }
  S.setupNotice = '';
  S.receiverActiveAt = startedAt;
  S.receiverLastSeen = stamp(startedAt);
  logEvent('receiver', 'Fresh receiver session', `${reason}; stale commands ignored, recent music commands kept for retry.`);
  localSave();
  return startedAt;
}

function shouldProcessEvent(event) {
  if (!event?.id || wasHandled(event.id) || inFlightEvents.has(event.id)) return false;
  const ts = eventTime(event);
  if (ts < Date.now() - EVENT_TTL_MS) return false;
  const target = Array.isArray(event.target) ? event.target.join(' ') : String(event.target || 'receivers');
  if (event.target && !/home|receiver|receivers|all|any/i.test(target)) return false;
  if (S.screen === 'home') {
    const startedAt = receiverSessionStartedAt();
    if (!receiverCanProcessEvents()) return false;
    if (ts < startedAt - RECEIVER_EVENT_GRACE_MS) {
      if (!isRetryableMusicCommand(event) || ts < startedAt - PENDING_MUSIC_COMMAND_GRACE_MS) return false;
    }
  }
  if (Date.now() < Number(retryAfter[event.id] || 0)) return false;
  return true;
}

function markMatchingSpotifyPlayEventsHandled(playUrl) {
  const map = handledMap();
  const now = Date.now();
  for (const event of recentEvents(S.events)) {
    if (!event?.id || event.kind !== 'command' || !['spotify-play', 'play'].includes(event.type)) continue;
    if (event.url && !sameSpotifySource(event.url, playUrl)) continue;
    map[event.id] = now;
    delete retryAfter[event.id];
  }
  saveHandledMap(map);
}

function appendEvent(kind, payload = {}) {
  const event = {
    id: payload.id || uid(),
    kind,
    createdAt: Date.now(),
    source: deviceLabel(),
    target: 'receivers',
    ...payload
  };
  S.events = recentEvents(mergeById(EVENT_LIMIT, false, S.events, [event]));
  if (kind === 'command') {
    const { kind: _kind, ...rest } = event;
    S.command = rest;
  }
  if (kind === 'announcement') {
    const { kind: _kind, ...rest } = event;
    S.announcement = rest;
  }
  return event;
}

async function issueCommand(type, payload = {}, message = 'Command sent to receivers.') {
  const event = appendEvent('command', { type, ...payload });
  logEvent('command', payload.label || commandTitle(type), payload.detail || '', { commandType: type, eventId: event.id });
  await pushState(message);
  if (S.screen === 'home') await processEvent(event);
  renderWhenIdle();
}

async function sendAnnouncement(text, hold = false, label = '') {
  const msg = tokens(text).trim();
  if (!msg) {
    setFeedback('Nothing to announce. Type or choose announcement text first.', false);
    return;
  }
  const event = appendEvent('announcement', { mode: 'voice', text: msg, hold: !!hold, label: label || (hold ? 'Safety announcement' : 'Announcement') });
  logEvent('announcement', hold ? 'Safety announcement sent' : 'Announcement sent', msg.slice(0, 190), { eventId: event.id });
  await pushState('Announcement command sent to all active receivers.');
  if (S.screen === 'home') await processEvent(event);
  renderWhenIdle();
}

async function sendSunoAnnouncement(trackIndex, hold = false, label = '') {
  const chosen = playableTrackAt(trackIndex);
  const event = appendEvent('announcement', {
    mode: 'suno',
    trackIndex: chosen?.index || 0,
    hold: !!hold,
    label: label || (hold ? 'Safety Suno announcement' : 'Suno announcement')
  });
  logEvent('announcement', hold ? 'Safety Suno announcement sent' : 'Suno announcement sent', chosen?.item?.title || 'Selected Suno track', { eventId: event.id, trackIndex: event.trackIndex });
  await pushState('Suno announcement command sent to all active receivers.');
  if (S.screen === 'home') await processEvent(event);
  renderWhenIdle();
}

async function sendSunoUrlAnnouncement(url, hold = false, label = '') {
  const raw = String(url || '').trim();
  if (!raw) throw Error('Paste a Suno song, playlist, or direct audio URL before sending this announcement.');
  const event = appendEvent('announcement', {
    mode: 'suno-url',
    url: raw,
    hold: !!hold,
    label: label || (hold ? 'Safety Suno URL announcement' : 'Suno URL announcement')
  });
  logEvent('announcement', hold ? 'Safety Suno URL announcement sent' : 'Suno URL announcement sent', compactUrl(raw), { eventId: event.id, url: raw });
  await pushState('Suno URL announcement command sent to all active receivers.');
  if (S.screen === 'home') await processEvent(event);
  renderWhenIdle();
}

async function playSavedAnnouncement(item, hold = false, label = '') {
  const saved = item || ann();
  if (saved?.mode === 'suno') {
    await sendSunoAnnouncement(Number(saved.trackIndex) || 0, hold, label || saved.label || 'Suno announcement');
    return;
  }
  await sendAnnouncement(saved?.text || '', hold, label || saved?.label || 'Announcement');
}

function commandTitle(type) {
  return ({
    'spotify-play': 'Play Spotify',
    play: 'Play music',
    pause: 'Pause music',
    stop: 'Stop music',
    skip: 'Skip track',
    'spotify-volume': 'Set Spotify volume',
    'audio-settings': 'Update audio settings',
    song: 'Play Suno cue',
    suno: 'Play Suno Cue',
    'weather-check': 'Weather check'
  })[type] || type || 'Command';
}

async function processEvents() {
  if (!receiverCanProcessEvents()) return;
  const events = recentEvents(S.events).filter(shouldProcessEvent);
  for (const event of events) {
    await processEvent(event);
  }
}

async function processEvent(event) {
  if (!shouldProcessEvent(event)) return;
  inFlightEvents.add(event.id);
  try {
    if (event.kind === 'command') await runCommand(event);
    else if (event.kind === 'announcement') await runAnnouncement(event);
    markHandled(event.id);
    await pushState('', { render: false });
  } catch (error) {
    const message = error.message || String(error);
    if (isActionNeeded(error)) {
      const retryableMusicCommand = event.kind === 'command' && ['spotify-play', 'play', 'suno', 'suno-cue', 'song'].includes(event.type);
      if (retryableMusicCommand) {
        unmarkHandled(event.id);
        retryAfter[event.id] = Date.now() + EVENT_RETRY_MS;
      } else {
        markHandled(event.id);
        delete retryAfter[event.id];
      }
      const next = retryableMusicCommand
        ? `${message} The receiver will retry this music command after it is ready.`
        : (/send the command again/i.test(message) ? message : `${message} After this receiver is ready, send the command again.`);
      logEvent('receiver', 'Event needs receiver action', next, { eventId: event.id });
      setActionNeeded(next);
    } else {
      unmarkHandled(event.id);
      retryAfter[event.id] = Date.now() + EVENT_RETRY_MS;
      logEvent('receiver', 'Event waiting on receiver', message, { eventId: event.id });
      setFeedback(`Receiver will retry ${event.kind || 'event'}: ${message}`, false);
    }
    await pushState('', { render: false });
  } finally {
    inFlightEvents.delete(event.id);
  }
}

async function runCommand(command) {
  if (!command?.type) return;
  S.musicProvider = 'spotify';
  if (command.type === 'spotify-volume') {
    S.spotifyVolume = clampNumber(command.volume, 0, 100, S.spotifyVolume);
  } else if (command.type === 'audio-settings') {
    if (Number.isFinite(Number(command.spotifyDuckedVolume))) S.spotifyDuckedVolume = clampNumber(command.spotifyDuckedVolume, 0, 20, S.spotifyDuckedVolume);
    if (Number.isFinite(Number(command.sunoVolume))) S.sunoVolume = clampNumber(command.sunoVolume, 0, 100, S.sunoVolume);
    if (Number.isFinite(Number(command.announcementGain))) S.announcementGain = clampNumber(command.announcementGain, 1, 3.4, S.announcementGain);
    if (Number.isFinite(Number(command.rate))) S.rate = clampNumber(command.rate, .75, 1.15, S.rate);
    if (Number.isFinite(Number(command.pitch))) S.pitch = clampNumber(command.pitch, .85, 1.15, S.pitch);
  }
  if (command.url) {
    if (command.type === 'spotify-play') S.spotifyUrl = command.url;
    else S.playlistUrl = command.url;
  }
  if (Number.isFinite(Number(command.trackIndex))) S.current = Math.max(0, Math.min(Number(command.trackIndex) || 0, Math.max(0, S.tracks.length - 1)));
  logEvent('receiver', 'Command received', `${command.type}${command.label ? `: ${command.label}` : ''}`, { eventId: command.id, commandType: command.type });

  if (command.type === 'spotify-play') {
    S.musicProvider = 'spotify';
    S.spotifyUrl = command.url || S.spotifyUrl;
    await playSpotifyUrl(S.spotifyUrl, false, { fromRemote: true });
  } else if (command.type === 'play') {
    await playSpotifyUrl(S.spotifyUrl, false, { fromRemote: true });
  } else if (command.type === 'pause') {
    await pauseSelected(false);
  } else if (command.type === 'stop') {
    await stopSelected(false);
  } else if (command.type === 'skip') {
    await skipSelected(false);
  } else if (command.type === 'spotify-volume') {
    const result = await spotifySetVolume(S.spotifyVolume, '', { preferKnown: true, preferActive: true, preferPoolside: true, allowStart: false });
    S.intent = S.intent || 'playing';
    setSpotifyStatus(`Spotify volume set to ${S.spotifyVolume}% on this receiver.`, true);
    logEvent('spotify', 'Spotify volume set on receiver', `${S.spotifyVolume}% via ${result.method || 'receiver'}`, { eventId: command.id, commandType: command.type });
    await pushState('Receiver Spotify volume logged.', { render: false });
  } else if (command.type === 'audio-settings') {
    applyReceiverAudioSettings('remote command');
    logEvent('settings', 'Audio settings updated on receiver', audioSettingsDetail(), { eventId: command.id, commandType: command.type });
    await pushState('Receiver audio settings logged.', { render: false });
  } else if (command.type === 'song') {
    if (command.url) await playSunoUrl(command.url, false);
    else throw Error('V18 Suno cues require a pasted Suno or direct audio URL.');
  } else if (command.type === 'suno' || command.type === 'suno-cue') {
    await playSunoUrl(command.url || S.playlistUrl, false);
  } else if (command.type === 'weather-check') {
    await weather({ announce: true, reason: 'remote command' });
  }
}

async function runAnnouncement(event) {
  if (!event) return;
  if (event.mode === 'suno') {
    const chosen = playableTrackAt(event.trackIndex);
    logEvent('receiver', 'Suno announcement received', chosen?.item?.title || event.label || 'Selected Suno track', { eventId: event.id, trackIndex: event.trackIndex });
    await announceSunoTrack(Number(event.trackIndex) || 0, { hold: !!event.hold, eventId: event.id });
    return;
  }
  if (event.mode === 'suno-url') {
    logEvent('receiver', 'Suno URL announcement received', event.label || compactUrl(event.url), { eventId: event.id, url: event.url });
    await announceSunoUrl(event.url, { hold: !!event.hold, eventId: event.id, label: event.label });
    return;
  }
  if (!event.text) return;
  logEvent('receiver', 'Announcement received', String(event.text).slice(0, 190), { eventId: event.id });
  await announce(event.text, { hold: !!event.hold, eventId: event.id });
}

function readMusicSettings() {
  S.musicProvider = 'spotify';
  if ($('playlistName')) S.playlistName = val('playlistName').trim() || S.playlistName;
  if ($('playlistUrl')) S.playlistUrl = val('playlistUrl').trim();
  if ($('quickMusicUrl')) S.quickMusicUrl = val('quickMusicUrl').trim();
  if ($('spotifyUrl')) S.spotifyUrl = val('spotifyUrl').trim() || S.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST;
  if ($('spotifyClientId')) S.spotifyClientId = val('spotifyClientId').trim() || S.spotifyClientId || DEFAULT_SPOTIFY_CLIENT_ID;
  if ($('spotifyRedirectUri')) S.spotifyRedirectUri = normalizeRedirectUri(val('spotifyRedirectUri').trim() || S.spotifyRedirectUri || appRedirectDefault());
  S.spotifyVolume = clampNumber($('spotifyVolume') ? val('spotifyVolume') : S.spotifyVolume, 0, 100, DEFAULT_MUSIC_VOLUME);
  S.spotifyDuckedVolume = clampNumber($('spotifyDuckedVolume') ? val('spotifyDuckedVolume') : S.spotifyDuckedVolume, 0, 20, 0);
  S.announcementGain = clampNumber($('announcementGain') ? val('announcementGain') : S.announcementGain, 1, 3.4, 3);
  S.sunoVolume = clampNumber($('sunoVolume') ? val('sunoVolume') : S.sunoVolume, 0, 100, DEFAULT_MUSIC_VOLUME);
  S.sunoDuckedVolume = clampNumber($('sunoDuckedVolume') ? val('sunoDuckedVolume') : S.sunoDuckedVolume, 0, 20, 2);
  S.activeMusicProvider = 'spotify';
  S.activeMusicUrl = S.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST;
  localSave();
}

function track() {
  return S.tracks[S.current] || S.tracks[0] || BASE.tracks[0];
}

function hasPlayableSuno() {
  return S.tracks.some(item => item.audioUrl);
}

function nextPlayableIndex(from = S.current) {
  if (!S.tracks.length) return -1;
  for (let i = 1; i <= S.tracks.length; i += 1) {
    const n = (Number(from) + i + S.tracks.length) % S.tracks.length;
    if (S.tracks[n]?.audioUrl) return n;
  }
  return -1;
}

async function fetchSunoTracksForUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) throw Error('Paste a Suno song, playlist, or direct audio URL first.');
  const response = await fetch(API.suno + encodeURIComponent(raw));
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.tracks?.length) throw Error(data.error || `Suno URL HTTP ${response.status}`);
  const tracks = data.tracks.map(item => ({
    title: item.title || 'Untitled',
    artist: item.artist || 'Suno',
    duration: item.duration || '3:00',
    audioUrl: item.audioUrl || '',
    sourceUrl: item.sourceUrl || raw,
    imageUrl: item.imageUrl || ''
  }));
  return { tracks, data, url: raw };
}

async function loadSunoTracksFromUrl(url, message = 'Suno URL loaded.') {
  const { tracks, data, url: raw } = await fetchSunoTracksForUrl(url);
  S.tracks = tracks;
  const first = S.tracks.findIndex(item => item.audioUrl);
  S.current = first >= 0 ? first : 0;
  S.playlistUrl = raw;
  S.playlistName = data.playlistName || S.playlistName;
  S.lastError = data.audioWarning || data.warning || '';
  logEvent('music', 'Suno loaded', `${S.tracks.length} track(s) from ${compactUrl(raw)}. ${S.lastError || ''}`.trim());
  await pushState(`${message} ${S.tracks.length} track(s) loaded.`, { render: false });
}

async function importSuno(message = 'Suno playlist imported.') {
  readMusicSettings();
  if (!String(S.playlistUrl || '').trim()) throw Error('Paste a Suno song, playlist, or direct audio URL first.');
  S.musicProvider = 'spotify';
  setFeedback('Loading Suno URL...', true);
  renderWhenIdle();
  await loadSunoTracksFromUrl(S.playlistUrl, message);
  renderWhenIdle();
}

async function fade(media, target, ms = 550) {
  const start = Number.isFinite(media.volume) ? media.volume : .95;
  const steps = 14;
  for (let i = 1; i <= steps; i += 1) {
    media.volume = Math.max(0, Math.min(1, start + (target - start) * (i / steps)));
    await new Promise(resolve => setTimeout(resolve, Math.max(16, ms / steps)));
  }
}

function sameUrl(a, b) {
  try {
    return new URL(a, location.href).href === new URL(b, location.href).href;
  } catch {
    return String(a || '') === String(b || '');
  }
}

function promiseTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(message)), ms);
    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeWaveAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

function fallbackToneUrl() {
  if (fallbackUnlockToneUrl) return fallbackUnlockToneUrl;
  const sampleRate = 22050;
  const samples = Math.floor(sampleRate * 0.45);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  writeWaveAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeWaveAscii(view, 8, 'WAVE');
  writeWaveAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeWaveAscii(view, 36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) {
    const attack = Math.min(1, i / (sampleRate * 0.02));
    const release = Math.min(1, (samples - i) / (sampleRate * 0.04));
    const envelope = Math.max(0, Math.min(attack, release));
    const tone = Math.sin((2 * Math.PI * 660 * i) / sampleRate);
    view.setInt16(44 + i * 2, Math.round(tone * 32767 * 0.5 * envelope), true);
  }
  fallbackUnlockToneUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  return fallbackUnlockToneUrl;
}

function getFallbackAudio() {
  if (fallbackUnlockAudio) return fallbackUnlockAudio;
  fallbackUnlockAudio = new Audio();
  fallbackUnlockAudio.preload = 'auto';
  fallbackUnlockAudio.playsInline = true;
  fallbackUnlockAudio.setAttribute('playsinline', '');
  fallbackUnlockAudio.setAttribute('webkit-playsinline', '');
  return fallbackUnlockAudio;
}

async function fallbackWebAudioTone(reason, audible) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return false;
  fallbackAudioContext ||= new AudioContext();
  const ctx = fallbackAudioContext;
  const resume = ctx.state !== 'running' ? ctx.resume() : Promise.resolve();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime || 0;
  const duration = audible ? 0.45 : 0.04;
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(660, start);
  gain.gain.setValueAtTime(audible ? 0.14 : 0.0001, start);
  gain.gain.linearRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
  await promiseTimeout(resume, 900, 'Web Audio resume timed out.');
  await new Promise(resolve => setTimeout(resolve, audible ? 480 : 55));
  if (ctx.state !== 'running') return false;
  fallbackAudioUnlocked = true;
  S.audioStatus = audible ? `Receiver test tone played by ${reason}.` : `Receiver audio unlocked by ${reason}.`;
  return true;
}

async function fallbackMediaTone(reason, audible) {
  const audio = getFallbackAudio();
  audio.muted = false;
  audio.volume = audible ? 0.75 : 0.03;
  audio.src = fallbackToneUrl();
  audio.load();
  await promiseTimeout(audio.play(), 1000, 'Media element play timed out.');
  await new Promise(resolve => setTimeout(resolve, audible ? 480 : 55));
  audio.pause();
  try { audio.currentTime = 0; } catch {}
  fallbackAudioUnlocked = true;
  S.audioStatus = audible ? `Receiver test tone played by ${reason}.` : `Receiver media audio unlocked by ${reason}.`;
  return true;
}

async function fallbackUnlockReceiverAudio(reason, options = {}) {
  if (fallbackAudioUnlocked && !(options.audible || options.testTone)) return true;
  const audible = !!options.audible || !!options.testTone;
  const attempts = await Promise.allSettled([
    fallbackWebAudioTone(reason, audible),
    fallbackMediaTone(reason, audible)
  ]);
  const ok = attempts.some(result => result.status === 'fulfilled' && result.value);
  if (!ok) {
    const details = attempts.map(result => result.status === 'rejected' ? result.reason?.message || String(result.reason) : 'not unlocked').join('; ');
    S.audioStatus = `Receiver audio is still blocked: ${details}`;
  }
  return ok;
}

function receiverAudioReady() {
  const status = typeof window.__poolsideV18AudioStatus === 'function' ? window.__poolsideV18AudioStatus() : null;
  if (fallbackAudioUnlocked || helperAudioReady(status)) return true;
  const text = String(status?.status || S.audioStatus || '').toLowerCase();
  if (/not been activated|blocked|failed|unavailable|denied/.test(text)) return false;
  if (/activated by|audio unlocked|test tone played|started through/.test(text)) return true;
  return false;
}

function helperAudioReady(status) {
  return !!(status?.unlocked || status?.webAudioPrimed || status?.mediaElementPrimed);
}

async function ensureReceiverAudio(reason = 'receiver action', options = {}) {
  let unlocked = receiverAudioReady();
  const unlockOptions = {
    ...options,
    audible: !!options.userGesture && !!(options.testTone || options.audible || (!unlocked && options.startSession))
  };
  const attempts = [];
  if (typeof window.__poolsideV18UnlockAudio === 'function') attempts.push(window.__poolsideV18UnlockAudio(reason, unlockOptions));
  if (unlockOptions.audible || typeof window.__poolsideV18UnlockAudio !== 'function') attempts.push(fallbackUnlockReceiverAudio(reason, unlockOptions));
  if (attempts.length) {
    const results = await Promise.allSettled(attempts);
    unlocked = results.some(result => result.status === 'fulfilled' && result.value);
  }
  const status = typeof window.__poolsideV18AudioStatus === 'function' ? window.__poolsideV18AudioStatus() : null;
  const helperReady = helperAudioReady(status);
  if (status?.status && (helperReady || (!fallbackAudioUnlocked && !/not been activated yet/i.test(status.status)))) S.audioStatus = status.status;
  unlocked = unlocked || fallbackAudioUnlocked || helperReady;
  receiverActive = unlocked;
  S.receiverStatus = unlocked ? 'Receiver audio ready.' : 'Receiver online; tap Start Receiver + Play Spotify once for sound.';
  S.receiverActiveAt = unlocked ? Date.now() : 0;
  S.receiverLastSeen = stamp();
  if (unlocked && options.startSession) beginReceiverSession(reason);
  if (!unlocked) {
    const detail = String(S.audioStatus || '');
    S.setupNotice = detail && !/not been activated yet/i.test(detail)
      ? detail
      : 'Tap Start Receiver + Play Spotify on this speaker-connected phone once. iPhone browsers require that tap before music or announcements can be heard.';
  }
  localSave();
  if (!unlocked && options.required) throw actionNeededError(S.setupNotice);
  return unlocked;
}

async function testReceiverTone(reason = 'iPhone receiver test tone') {
  S.audioStatus = 'Receiver audio test starting. Listen for a short tone.';
  localSave();
  try {
    const ok = await ensureReceiverAudio(reason, {
      required: true,
      startSession: true,
      userGesture: true,
      testTone: true
    });
    if (!ok) throw actionNeededError(S.setupNotice || 'Tap Start Receiver + Play Spotify on this iPhone before sending sound.');
    setFeedback('Receiver audio test completed on this phone.', true);
    logEvent('receiver', 'Receiver audio test', 'Start Receiver + Play Spotify test tone completed on this Home device.');
    await pushState('Receiver audio test logged.', { render: false });
    renderWhenIdle();
  } catch (error) {
    const detail = String(S.audioStatus || error.message || error || 'Receiver audio test did not start.');
    S.receiverStatus = 'Receiver audio still blocked.';
    S.setupNotice = detail;
    localSave();
    renderWhenIdle();
    throw actionNeededError(detail);
  }
}

async function playSunoUrl(url, push = true) {
  readMusicSettings();
  const raw = String(url || S.playlistUrl || '').trim();
  if (!raw) throw Error('Paste a Suno song, playlist, or direct audio URL first.');
  S.quickMusicUrl = raw;
  S.playlistUrl = raw;
  S.musicProvider = 'spotify';
  if (S.screen !== 'home' && push) {
    await issueCommand('suno-cue', {
      label: 'Play Suno Cue',
      provider: 'suno',
      url: raw,
      detail: sourceLabel('suno', raw)
    }, `Suno cue sent to all active receivers: ${sourceLabel('suno', raw)}.`);
    return;
  }
  await playSunoCue(raw, { label: 'Suno cue' });
}

async function playSuno(push = true) {
  readMusicSettings();
  const raw = String(S.playlistUrl || DEFAULT_SUNO_PLAYLIST || '').trim();
  if (!raw) throw Error('Paste and save a Suno URL before playing a Suno cue.');
  await playSunoUrl(raw, push);
}

async function pauseSpotifyForSunoPlayback() {
  if (S.activeMusicProvider !== 'spotify' && S.musicProvider !== 'spotify' && !S.spotifyDeviceId && !spotifyPlayer) return;
  let state = null;
  try { state = await spotifyPlaybackState(); } catch {}
  const deviceId = state?.deviceId || spotifyWebDeviceId || S.spotifyDeviceId || '';
  if (!state?.isPlaying && !spotifyPlayer && !deviceId) return;
  const method = await pauseSpotifyForAnnouncement(deviceId);
  if (method) {
    S.spotifyStatus = `Spotify paused while Suno plays.`;
    logEvent('spotify', 'Spotify paused for Suno playback', method);
  }
}

async function pauseSunoForSpotifyPlayback() {
  if (music.paused) return;
  await fade(music, 0, 220).catch(() => {});
  music.pause();
  logEvent('music', 'Suno paused for Spotify playback', track().title || 'Suno track');
}

async function pauseSuno(push = true) {
  if (S.screen !== 'home' && push) {
    await issueCommand('pause', { label: 'Pause music' }, 'Pause command sent to all active receivers.');
    return;
  }
  await fade(music, 0, 260).catch(() => {});
  music.pause();
  music.volume = musicGain();
  S.intent = 'paused';
  setManualMusicHold('Suno paused manually');
  logEvent('pause', 'Suno paused', '');
  setFeedback('Suno paused on receiver.', true);
  await pushState('Receiver pause logged.', { render: false });
  renderWhenIdle();
}

async function stopSuno(push = true) {
  if (S.screen !== 'home' && push) {
    await issueCommand('stop', { label: 'Stop music' }, 'Stop command sent to all active receivers.');
    return;
  }
  await fade(music, 0, 260).catch(() => {});
  music.pause();
  try { music.currentTime = 0; } catch {}
  music.volume = musicGain();
  S.intent = 'stopped';
  setManualMusicHold('Suno stopped manually');
  logEvent('stop', 'Suno stopped', '');
  setFeedback('Suno stopped on receiver.', true);
  await pushState('Receiver stop logged.', { render: false });
  renderWhenIdle();
}

async function nextSuno(push = true, message = 'Skipped to next Suno track.') {
  if (S.screen !== 'home' && push) {
    await issueCommand('skip', { label: 'Skip track' }, 'Skip command sent to all active receivers.');
    return;
  }
  const next = nextPlayableIndex(S.current);
  if (next < 0) throw Error('No next playable Suno track found.');
  S.current = next;
  if (S.intent === 'playing' || receiverActive) await playSuno(false);
  setFeedback(message, true);
}

async function playSelected(push = true) {
  readMusicSettings();
  S.musicProvider = 'spotify';
  await playSpotifyUrl(S.spotifyUrl, push);
}

async function pauseSelected(push = true) {
  S.musicProvider = 'spotify';
  await spotifyPause(push);
}

async function stopSelected(push = true) {
  S.musicProvider = 'spotify';
  await spotifyStop(push);
}

async function skipSelected(push = true) {
  S.musicProvider = 'spotify';
  await spotifyNext(push);
}

function activeProviderUrl() {
  return S.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST;
}

function providerFromUrl(url) {
  const raw = String(url || '').trim();
  if (/suno\.com\/(?:playlist|playlists|song|songs|s)\//i.test(raw)) return 'suno';
  if (/\.(mp3|m4a|aac|wav|ogg|oga|webm)(\?|#|$)/i.test(raw)) return 'suno';
  if (/spotify:|open\.spotify\.com\//i.test(raw)) return 'spotify';
  return '';
}

function sourceKind(url) {
  const raw = String(url || '');
  if (/spotify:track:|open\.spotify\.com\/track\//i.test(raw)) return 'Spotify song';
  if (/spotify:album:|open\.spotify\.com\/album\//i.test(raw)) return 'Spotify album';
  if (/spotify:artist:|open\.spotify\.com\/artist\//i.test(raw)) return 'Spotify artist';
  if (/spotify:playlist:|open\.spotify\.com\/playlist\//i.test(raw)) return 'Spotify playlist';
  if (/suno\.com\/(?:song|songs)\//i.test(raw)) return 'Suno song';
  if (/suno\.com\/s\//i.test(raw)) return 'Suno song';
  if (/suno\.com\/(?:playlist|playlists)\//i.test(raw)) return 'Suno playlist';
  if (/\.(mp3|m4a|aac|wav|ogg|oga|webm)(\?|#|$)/i.test(raw)) return 'Direct audio';
  return raw ? 'Music source' : 'No source selected';
}

function sourceId(url) {
  try {
    const raw = String(url || '').trim();
    if (/^spotify:/i.test(raw)) return raw.split(':').pop();
    const parsed = new URL(raw);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[1] || parts[0] || '';
  } catch {
    return '';
  }
}

function compactUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return String(url || '');
  }
}

function sourceLabel(provider = S.musicProvider, url = activeProviderUrl()) {
  const id = sourceId(url);
  if (provider === 'spotify') return `${sourceKind(url)}${id ? ` ${id.slice(0, 14)}` : ''}`;
  if (provider === 'suno') return `${sourceKind(url)}${id ? ` ${id.slice(0, 14)}` : ''}`;
  return PROVIDERS[provider] || 'Music';
}

function rememberActiveSource(provider, url, status = 'selected') {
  S.activeMusicProvider = provider;
  S.activeMusicUrl = url || '';
  S.activeMusicLabel = `${status}: ${sourceLabel(provider, url)}`;
  localSave();
}

async function playAnyMusicUrl(url = S.quickMusicUrl || activeProviderUrl(), push = true) {
  readMusicSettings();
  const raw = String(url || S.quickMusicUrl || activeProviderUrl() || '').trim();
  if (!raw) throw Error('Paste a Spotify or Suno playlist URL first.');
  const provider = providerFromUrl(raw);
  if (!provider) throw Error('Paste a Suno song, Suno playlist, direct audio URL, or Spotify playlist, album, artist, or track URL.');
  S.quickMusicUrl = raw;
  if (provider === 'spotify') {
    S.musicProvider = 'spotify';
    S.spotifyUrl = raw;
    await playSpotifyUrl(raw, push);
    return;
  }
  await playSunoUrl(raw, push);
}

function readSpotifyVolumeControl() {
  const el = $('spotifyVolumeCommand') || $('spotifyVolume');
  S.spotifyVolume = clampNumber(el ? el.value : S.spotifyVolume, 0, 100, DEFAULT_MUSIC_VOLUME);
  localSave();
  return S.spotifyVolume;
}

function updateSpotifyVolumeDraft(value) {
  S.spotifyVolume = clampNumber(value, 0, 100, DEFAULT_MUSIC_VOLUME);
  localSave();
  syncVolumeReadouts();
  return S.spotifyVolume;
}

function syncVolumeReadouts() {
  const volume = String(clampNumber(S.spotifyVolume, 0, 100, DEFAULT_MUSIC_VOLUME));
  ['spotifyVolumeOut', 'spotifyVolumeCommandOut'].forEach(id => {
    const out = $(id);
    if (out) out.textContent = `${volume}%`;
  });
  const ducked = $('spotifyDuckedVolumeOut');
  if (ducked) ducked.textContent = `${clampNumber(S.spotifyDuckedVolume, 0, 20, 0)}%`;
  const suno = $('sunoVolumeOut');
  if (suno) suno.textContent = `${clampNumber(S.sunoVolume, 0, 100, DEFAULT_MUSIC_VOLUME)}%`;
  const gain = $('announcementGainOut');
  if (gain) gain.textContent = `${Math.round(clampNumber(S.announcementGain, 1, 3.4, 3) * 100)}%`;
  const rate = $('rateOut');
  if (rate) rate.textContent = String(clampNumber(S.rate, .75, 1.15, .94));
  const pitch = $('pitchOut');
  if (pitch) pitch.textContent = String(clampNumber(S.pitch, .85, 1.15, 1));
}

function updateRangeDraft(key, value) {
  if (key === 'spotifyVolume') S.spotifyVolume = clampNumber(value, 0, 100, DEFAULT_MUSIC_VOLUME);
  else if (key === 'spotifyDuckedVolume') S.spotifyDuckedVolume = clampNumber(value, 0, 20, 0);
  else if (key === 'sunoVolume') S.sunoVolume = clampNumber(value, 0, 100, DEFAULT_MUSIC_VOLUME);
  else if (key === 'announcementGain') S.announcementGain = clampNumber(value, 1, 3.4, 3);
  else if (key === 'rate') S.rate = clampNumber(value, .75, 1.15, .94);
  else if (key === 'pitch') S.pitch = clampNumber(value, .85, 1.15, 1);
  localSave();
  syncVolumeReadouts();
}

function audioSettingsPayload() {
  return {
    spotifyDuckedVolume: clampNumber(S.spotifyDuckedVolume, 0, 20, 0),
    sunoVolume: clampNumber(S.sunoVolume, 0, 100, DEFAULT_MUSIC_VOLUME),
    announcementGain: clampNumber(S.announcementGain, 1, 3.4, 3),
    rate: clampNumber(S.rate, .75, 1.15, .94),
    pitch: clampNumber(S.pitch, .85, 1.15, 1)
  };
}

function audioSettingsDetail() {
  const audio = audioSettingsPayload();
  return `music during announcements ${audio.spotifyDuckedVolume}%; Suno ${audio.sunoVolume}%; announcements ${Math.round(audio.announcementGain * 100)}%; speed ${audio.rate}; pitch ${audio.pitch}`;
}

function applyReceiverAudioSettings(reason = 'local setting') {
  const audio = audioSettingsPayload();
  S.spotifyDuckedVolume = audio.spotifyDuckedVolume;
  S.sunoVolume = audio.sunoVolume;
  S.announcementGain = audio.announcementGain;
  S.rate = audio.rate;
  S.pitch = audio.pitch;
  music.volume = music.paused ? music.volume : audio.sunoVolume / 100;
  if (!announcementMusic.paused) announcementMusic.volume = 1;
  logEvent('settings', 'Audio settings applied', `${reason}: ${audioSettingsDetail()}`);
  localSave();
}

async function applyAudioSettings(push = true) {
  clearTimeout(audioSettingsApplyTimer);
  audioSettingsApplyTimer = null;
  syncVolumeReadouts();
  applyReceiverAudioSettings(S.screen === 'home' ? 'local slider' : 'command slider');
  if (S.screen !== 'home' && push) {
    await issueCommand('audio-settings', {
      ...audioSettingsPayload(),
      label: 'Update audio settings',
      detail: audioSettingsDetail()
    }, 'Audio slider settings sent to all active receivers.');
    return;
  }
  await pushState('Audio slider settings saved on receiver.', { render: false });
  setFeedback('Audio slider settings saved for receiver playback.', true);
  renderWhenIdle();
}

function scheduleSpotifyVolumeApply() {
  clearTimeout(spotifyVolumeApplyTimer);
  spotifyVolumeApplyTimer = setTimeout(() => {
    spotifyVolumeApplyTimer = null;
    applySpotifyVolume(true).catch(error => {
      if (isActionNeeded(error)) setActionNeeded(error.message || String(error));
      else setFeedback(error.message || String(error), false);
      renderWhenIdle();
    });
  }, 450);
}

function scheduleAudioSettingsApply() {
  clearTimeout(audioSettingsApplyTimer);
  audioSettingsApplyTimer = setTimeout(() => {
    audioSettingsApplyTimer = null;
    applyAudioSettings(true).catch(error => {
      if (isActionNeeded(error)) setActionNeeded(error.message || String(error));
      else setFeedback(error.message || String(error), false);
      renderWhenIdle();
    });
  }, 450);
}

async function applySpotifyVolume(push = true) {
  clearTimeout(spotifyVolumeApplyTimer);
  spotifyVolumeApplyTimer = null;
  const volume = readSpotifyVolumeControl();
  syncVolumeReadouts();
  if (S.screen !== 'home' && push) {
    await issueCommand('spotify-volume', {
      volume,
      label: `Set Spotify volume to ${volume}%`,
      detail: `Spotify music volume ${volume}%; announcements stay at full announcement volume.`
    }, `Spotify volume ${volume}% sent to all active receivers. Announcements stay loud.`);
    setSpotifyStatus(`Spotify volume ${volume}% sent to receivers. The Home receiver applies it to the speaker phone.`, true);
    renderWhenIdle();
    return;
  }
  const result = await spotifySetVolume(volume, '', { preferKnown: true, preferActive: true, preferPoolside: true, allowStart: false });
  logEvent('spotify', 'Spotify volume set locally', `${volume}% via ${result.method || 'receiver'}`);
  await pushState(`Spotify volume set to ${volume}% on receiver.`, { render: false });
  setSpotifyStatus(`Spotify volume set to ${volume}% on this receiver. Announcements stay loud.`, true);
  renderWhenIdle();
}

function randString(length = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(value => chars[value % chars.length]).join('');
}

async function sha256base64url(input) {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function spotifyConfigured() {
  return !!String(S.spotifyClientId || '').trim();
}

function spotifyToken() {
  try {
    let raw = storageGet(SPOTIFY_TOKEN_KEY);
    if (!raw) {
      for (const key of LEGACY_TOKEN_KEYS) {
        raw = storageGet(key);
        if (raw) {
          storageSet(SPOTIFY_TOKEN_KEY, raw);
          break;
        }
      }
    }
    return JSON.parse(raw || 'null') || null;
  } catch {
    return null;
  }
}

function saveSpotifyToken(data) {
  const previous = spotifyToken() || {};
  const token = {
    ...previous,
    ...data,
    refresh_token: data.refresh_token || previous.refresh_token || '',
    expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000)
  };
  storageSet(SPOTIFY_TOKEN_KEY, JSON.stringify(token));
  return token;
}

function spotifyLoggedIn() {
  const token = spotifyToken();
  return !!token?.access_token;
}

function clearSpotifyToken() {
  storageRemove(SPOTIFY_TOKEN_KEY);
  S.spotifyStatus = 'Spotify login cleared on this browser.';
  setFeedback('Spotify login cleared on this browser.', true);
  renderWhenIdle();
}

async function spotifyLogin() {
  readMusicSettings();
  if (!spotifyConfigured()) {
    setFeedback('Paste and save the Spotify Client ID first.', false);
    return;
  }
  const verifier = randString(96);
  const state = randString(24);
  sessionSet('ppSpotifyVerifier', verifier);
  sessionSet('ppSpotifyState', state);
  sessionSet('ppSpotifyReturn', `/${APP_QUERY}`);
  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', S.spotifyClientId.trim());
  url.searchParams.set('scope', 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing');
  url.searchParams.set('redirect_uri', spotifyRedirectUri());
  url.searchParams.set('state', `${state}.${verifier}`);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', await sha256base64url(verifier));
  location.href = url.toString();
}

async function completeSpotifyLogin() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return;
  const returned = String(params.get('state') || '');
  const parts = returned.split('.');
  const state = parts[0] || '';
  const verifier = sessionGet('ppSpotifyVerifier') || parts.slice(1).join('.');
  const expected = sessionGet('ppSpotifyState');
  if (expected && state !== expected) {
    setFeedback('Spotify login state did not match. Try Login again from the receiver.', false);
    return;
  }
  if (!verifier || !spotifyConfigured()) {
    setFeedback('Spotify login cannot finish because the Client ID or verifier is missing.', false);
    return;
  }
  try {
    const body = new URLSearchParams({
      client_id: S.spotifyClientId.trim(),
      grant_type: 'authorization_code',
      code,
      redirect_uri: spotifyRedirectUri(),
      code_verifier: verifier
    });
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error_description || data.error || `Spotify token HTTP ${response.status}`);
    saveSpotifyToken(data);
    history.replaceState(null, '', sessionGet('ppSpotifyReturn') || `/${APP_QUERY}`);
    setFeedback(S.screen === 'home' ? 'Spotify connected on this receiver. Tap Start Receiver + Play Spotify.' : 'Spotify connected on this browser. Command mode will send playback to all active receivers.', true);
  } catch (error) {
    setFeedback(`Spotify login failed: ${error.message}`, false);
  }
}

async function spotifyAccessToken() {
  let token = spotifyToken();
  if (!token?.access_token) throw actionNeededError('Spotify is not connected on this receiver. Tap Login Spotify on the speaker-connected Home phone.');
  if (Number(token.expiresAt || 0) > Date.now() + 90000) return token.access_token;
  if (!token.refresh_token) throw actionNeededError('Spotify session expired. Tap Login Spotify again on the speaker-connected Home phone.');
  const body = new URLSearchParams({
    client_id: S.spotifyClientId.trim(),
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token
  });
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error_description || data.error || `Spotify refresh HTTP ${response.status}`);
  token = saveSpotifyToken(data);
  return token.access_token;
}

async function spotifyApi(method, path, body = null, query = {}) {
  const token = await spotifyAccessToken();
  const url = new URL(`https://api.spotify.com/v1${path}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const response = await fetch(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (response.status === 204) return {};
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error?.message || data.error_description || `Spotify ${method} ${path} HTTP ${response.status}`);
  return data;
}

function spotifyUri(input) {
  const raw = String(input || '').trim();
  if (/^spotify:(track|playlist|album|artist):/i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/').filter(Boolean);
    const type = parts[0];
    const id = parts[1];
    if (['track', 'playlist', 'album', 'artist'].includes(type) && id) return `spotify:${type}:${id}`;
  } catch {}
  throw Error('Paste a Spotify playlist, album, artist, or track URL.');
}

function spotifyBody(input) {
  const uri = spotifyUri(input || S.spotifyUrl);
  if (/^spotify:track:/i.test(uri)) return { uris: [uri] };
  if (/^spotify:(playlist|album|artist):/i.test(uri)) return { context_uri: uri };
  throw Error('Paste a Spotify playlist, album, artist, or track URL.');
}

function safeSpotifyUri(input) {
  try {
    return spotifyUri(input).toLowerCase();
  } catch {
    return '';
  }
}

function sameSpotifySource(a, b) {
  const left = safeSpotifyUri(a);
  const right = safeSpotifyUri(b);
  if (left && right) return left === right;
  return normalizedUrlKey(a) === normalizedUrlKey(b);
}

function spotifyStateMatchesUrl(state, url) {
  const wanted = safeSpotifyUri(url);
  if (!wanted) return false;
  return [state?.contextUri, state?.itemUri].some(uri => String(uri || '').toLowerCase() === wanted);
}

function isIOSLikeBrowser() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function spotifyDevices() {
  const data = await spotifyApi('GET', '/me/player/devices');
  return Array.isArray(data.devices) ? data.devices : [];
}

async function ensureSpotifySdk() {
  if (window.Spotify) return window.Spotify;
  return await new Promise((resolve, reject) => {
    const prior = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (typeof prior === 'function') prior();
      resolve(window.Spotify);
    };
    if (!document.querySelector('script[data-spotify-sdk]')) {
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      script.dataset.spotifySdk = 'true';
      script.onerror = () => reject(Error('Spotify SDK script failed to load.'));
      document.head.appendChild(script);
    }
    setTimeout(() => window.Spotify ? resolve(window.Spotify) : reject(Error('Spotify SDK did not become ready.')), 12000);
  });
}

async function waitForSpotifyReady(ms = 18000) {
  if (spotifyPlayerReady && spotifyWebDeviceId) return spotifyWebDeviceId;
  return await new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (spotifyPlayerReady && spotifyWebDeviceId) {
        clearInterval(timer);
        resolve(spotifyWebDeviceId);
      } else if (Date.now() - started > ms) {
        clearInterval(timer);
        reject(Error('Spotify receiver did not report ready. Tap Start Receiver + Play Spotify on the speaker-connected receiver.'));
      }
    }, 140);
  });
}

function setSpotifyStatus(message, ok = true) {
  S.spotifyStatus = message;
  if (!ok) {
    S.spotifyLastError = message;
    S.spotifyNeedsTap = /tap|activate|autoplay|iOS|receiver/i.test(message);
  } else {
    S.spotifyNeedsTap = false;
  }
  setFeedback(message, ok);
}

function registerSpotifyListeners() {
  spotifyPlayer.addListener('ready', ({ device_id }) => {
    spotifyPlayerReady = true;
    spotifyWebDeviceId = device_id;
    S.spotifyDeviceId = device_id;
    S.spotifyDeviceName = 'Poolside Pulse V18 Receiver';
    S.spotifyReceiverReadyAt = Date.now();
    S.receiverStatus = 'Spotify receiver ready.';
    S.receiverLastSeen = stamp();
    setSpotifyStatus('Spotify receiver is ready on this device.', true);
    localSave();
    pushState('Spotify receiver ready.', { render: false }).catch(() => {});
    renderWhenIdle();
  });
  spotifyPlayer.addListener('not_ready', () => {
    spotifyPlayerReady = false;
    S.receiverStatus = 'Spotify receiver went offline.';
    setSpotifyStatus('Spotify receiver went offline. Leave Home open and tap Start Receiver + Play Spotify again.', false);
    localSave();
    renderWhenIdle();
  });
  spotifyPlayer.addListener('autoplay_failed', () => {
    setSpotifyStatus('Spotify is ready, but this browser blocked autoplay. Tap Start Receiver + Play Spotify on the receiver.', false);
  });
  spotifyPlayer.addListener('player_state_changed', state => {
    if (!state) return;
    if (state.track_window?.current_track) {
      const current = state.track_window.current_track;
      S.spotifyNowPlaying = `${current.name || 'Spotify'}${current.artists?.length ? ` - ${current.artists.map(artist => artist.name).join(', ')}` : ''}`;
    }
    S.intent = state.paused ? 'paused' : 'playing';
    S.spotifyStatus = state.paused ? 'Spotify receiver is paused.' : 'Spotify receiver is playing.';
    S.receiverLastSeen = stamp();
    localSave();
  });
  spotifyPlayer.addListener('initialization_error', error => setSpotifyStatus(`Spotify player init error: ${error.message}`, false));
  spotifyPlayer.addListener('authentication_error', error => setSpotifyStatus(`Spotify auth error: ${error.message}`, false));
  spotifyPlayer.addListener('account_error', error => setSpotifyStatus(`Spotify account error: ${error.message}. Premium is required.`, false));
  spotifyPlayer.addListener('playback_error', error => setSpotifyStatus(`Spotify playback error: ${error.message}`, false));
}

async function primeSpotifyPlayer() {
  if (S.screen !== 'home') throw Error('This browser is in Command mode. Switch the speaker-connected phone to Home before starting a Spotify receiver.');
  if (!spotifyConfigured()) throw Error('Spotify Client ID is required.');
  await spotifyAccessToken();
  if (spotifyPlayer) return spotifyPlayer;
  if (spotifyPrimePromise) return spotifyPrimePromise;
  spotifyPrimePromise = (async () => {
    const Spotify = await ensureSpotifySdk();
    spotifyPlayer = new Spotify.Player({
      name: 'Poolside Pulse V18 Receiver',
      getOAuthToken: callback => spotifyAccessToken().then(callback).catch(error => setSpotifyStatus(`Spotify token failed: ${error.message}`, false)),
      volume: clampNumber(S.spotifyVolume, 0, 100, DEFAULT_MUSIC_VOLUME) / 100
    });
    registerSpotifyListeners();
    const connected = await spotifyPlayer.connect();
    if (!connected) throw Error('Spotify receiver did not connect.');
    return spotifyPlayer;
  })();
  try {
    return await spotifyPrimePromise;
  } catch (error) {
    spotifyPrimePromise = null;
    spotifyPlayer = null;
    throw error;
  }
}

async function activateSpotifyElement(options = {}) {
  try {
    if (!spotifyPlayer || typeof spotifyPlayer.activateElement !== 'function') return false;
    await spotifyPlayer.activateElement();
    if (options.freshTap) spotifyFreshTapActivatedPlayer = true;
    return true;
  } catch {}
  return false;
}

async function beginSpotifyTapActivation() {
  spotifyFreshTapActivatedPlayer = false;
  return await activateSpotifyElement({ freshTap: true });
}

function warmSpotifyReceiver() {
  if (S.screen !== 'home' || S.musicProvider !== 'spotify' || !spotifyLoggedIn()) return;
  if (spotifyPlayer || spotifyPrimePromise || spotifyWarmPromise) return;
  spotifyWarmPromise = primeSpotifyPlayer()
    .then(() => {
      if (!receiverSessionStartedAt() || !receiverAudioReady()) {
        S.spotifyStatus = 'Spotify receiver is prepared. Tap Start Receiver + Play Spotify once on this phone to unlock playback.';
        localSave();
        return null;
      }
      return checkSpotifyHealth(false).catch(() => {});
    })
    .catch(error => {
      S.spotifyStatus = `Spotify receiver warm-up waiting: ${error.message || error}`;
      localSave();
    })
    .finally(() => {
      spotifyWarmPromise = null;
      renderWhenIdle();
    });
}

async function startSpotifyReceiver({ fromTap = false } = {}) {
  if (S.screen !== 'home') throw Error('Command devices do not play sound. Open Home on the speaker-connected receiver.');
  if (fromTap) {
    if (!spotifyFreshTapActivatedPlayer) await activateSpotifyElement({ freshTap: true });
  }
  await ensureReceiverAudio('Spotify receiver activation', {
    required: true,
    startSession: fromTap || !receiverSessionStartedAt(),
    userGesture: fromTap,
    testTone: fromTap && !receiverAudioReady()
  });
  let deviceId = '';
  try {
    const player = await primeSpotifyPlayer();
    if (fromTap) await activateSpotifyElement();
    const ok = spotifyPlayerReady || await player.connect();
    if (!ok) throw Error('Spotify receiver did not connect.');
    deviceId = await waitForSpotifyReady();
  } catch (error) {
    const current = await spotifyCurrentPlaybackDevice();
    if (current?.deviceId) {
      deviceId = current.deviceId;
      S.spotifyNeedsTap = false;
      S.receiverStatus = 'Spotify receiver active.';
      setSpotifyStatus(`Using active Spotify device: ${current.name}.`, true);
      logEvent('spotify', 'Using active Spotify playback device', `${current.name}; ${error.message || error}`);
    } else {
      spotifyPlayerReady = false;
      spotifyWebDeviceId = '';
      S.spotifyDeviceId = '';
      S.spotifyNeedsTap = true;
      S.receiverStatus = 'Spotify receiver not ready on this phone.';
      setSpotifyStatus(`Spotify did not start on this iPhone browser: ${error.message || error}. Keep Home open and tap Start Receiver + Play Spotify again.`, false);
      localSave();
      throw error;
    }
  }
  S.spotifyDeviceId = deviceId;
  S.spotifyDeviceName = S.spotifyDeviceName || 'Poolside Pulse V18 Receiver';
  S.spotifyReceiverReadyAt = Date.now();
  S.receiverStatus = 'Spotify receiver active.';
  S.receiverLastSeen = stamp();
  receiverActive = true;
  localSave();
  try {
    await spotifyApi('PUT', '/me/player', { device_ids: [deviceId], play: false });
  } catch (error) {
    setSpotifyStatus(`Spotify receiver is ready, but transfer is not active yet: ${error.message}`, false);
  }
  return deviceId;
}

function setSpotifyDevice(device, status = '') {
  if (!device?.id) return '';
  S.spotifyDeviceId = device.id;
  S.spotifyDeviceName = device.name || S.spotifyDeviceName || 'Spotify device';
  S.spotifyReceiverReadyAt = Date.now();
  if (status) S.spotifyStatus = status;
  S.receiverLastSeen = stamp();
  localSave();
  return device.id;
}

async function spotifyPreferredDeviceId(options = {}) {
  if (!spotifyLoggedIn()) return '';
  try {
    const devices = await spotifyDevices();
    S.spotifyDevicesSummary = devices.length ? `Devices: ${devices.map(device => `${device.name || 'Unnamed'}${device.is_active ? ' active' : ''}`).join(', ')}` : 'Devices: none returned yet';
    const usable = devices.filter(device => device?.id && !device.is_restricted);
    const known = options.preferKnown && S.spotifyDeviceId
      ? usable.find(device => String(device.id) === String(S.spotifyDeviceId))
      : null;
    const active = options.preferActive !== false
      ? usable.find(device => device.is_active)
      : null;
    const poolside = options.preferPoolside !== false
      ? usable.find(device => /poolside pulse|serenity shores/i.test(device.name || ''))
      : null;
    const selected = known || active || poolside || null;
    if (!selected) return '';
    const label = selected.is_active ? 'active Spotify device' : 'known Spotify device';
    return setSpotifyDevice(selected, `Using ${label}: ${selected.name || 'Spotify device'}.`);
  } catch (error) {
    logEvent('spotify', 'Spotify device lookup failed', error.message || String(error));
    return '';
  }
}

async function spotifyCurrentPlaybackDevice(options = {}) {
  if (!spotifyLoggedIn()) return null;
  try {
    const player = await spotifyApi('GET', '/me/player');
    const device = player?.device;
    if (!device?.id || device.is_restricted) return null;
    if (options.requirePlaying && !player?.is_playing) return null;
    S.spotifyDeviceId = device.id;
    S.spotifyDeviceName = device.name || S.spotifyDeviceName || 'Spotify device';
    S.spotifyReceiverReadyAt = Date.now();
    if (Number.isFinite(Number(device.volume_percent))) {
      S.spotifyDevicesSummary = `Active device: ${device.name || 'Spotify device'} at ${device.volume_percent}%`;
    }
    S.receiverLastSeen = stamp();
    localSave();
    return {
      deviceId: device.id,
      name: device.name || 'Spotify device',
      isPlaying: !!player?.is_playing,
      volume: Number.isFinite(Number(device.volume_percent)) ? Number(device.volume_percent) : null,
      contextUri: player?.context?.uri || '',
      itemUri: player?.item?.uri || '',
      hasPlayback: !!(player?.context?.uri || player?.item?.uri)
    };
  } catch (error) {
    logEvent('spotify', 'Spotify current playback lookup failed', error.message || String(error));
    return null;
  }
}

async function spotifyTargetDevice(options = {}) {
  if (S.screen === 'home') {
    if (spotifyPlayerReady && spotifyWebDeviceId) return spotifyWebDeviceId;
    const current = await spotifyCurrentPlaybackDevice({ requirePlaying: !!options.requirePlaying });
    if (current?.deviceId) return current.deviceId;
    if (options.allowStart === false) return '';
    if (spotifyLoggedIn()) {
      try {
        return await startSpotifyReceiver();
      } catch (error) {
        throw actionNeededError(`Spotify receiver is not ready on this phone yet. Tap Start Receiver + Play Spotify on the speaker-connected Home phone. ${error.message || ''}`.trim());
      }
    }
    throw actionNeededError('Spotify is not connected on this receiver. Tap Login Spotify on the speaker-connected Home phone.');
  }
  if (options.preferKnown && S.spotifyDeviceId) return S.spotifyDeviceId;
  if (options.preferActive || options.preferPoolside) {
    const preferred = await spotifyPreferredDeviceId(options);
    if (preferred) return preferred;
  }
  if (options.allowStart === false) return '';
  return '';
}

async function spotifySetLocalPlayerVolume(percent, label = 'Spotify local volume failed') {
  if (S.screen !== 'home' || !spotifyPlayer || typeof spotifyPlayer.setVolume !== 'function') return false;
  try {
    await spotifyPlayer.setVolume(clampNumber(percent, 0, 100, DEFAULT_MUSIC_VOLUME) / 100);
    return true;
  } catch (error) {
    logEvent('spotify', label, error.message || String(error));
    return false;
  }
}

async function spotifyPlaybackState() {
  if (!spotifyLoggedIn()) return null;
  const player = await spotifyApi('GET', '/me/player');
  const device = player?.device;
  if (!device?.id || device.is_restricted) return null;
  return {
    deviceId: device.id,
    name: device.name || 'Spotify device',
    isPlaying: !!player?.is_playing,
    volume: Number.isFinite(Number(device.volume_percent)) ? Number(device.volume_percent) : null
  };
}

async function pauseSpotifyForAnnouncement(deviceId) {
  let lastError = '';
  if (spotifyLoggedIn()) {
    try {
      await spotifyApi('PUT', '/me/player/pause', null, deviceId ? { device_id: deviceId } : {});
      return 'Spotify API';
    } catch (error) {
      lastError = error.message || String(error);
    }
  }
  if (spotifyPlayer && typeof spotifyPlayer.pause === 'function') {
    try {
      await spotifyPlayer.pause();
      return 'receiver SDK';
    } catch (error) {
      lastError = lastError || error.message || String(error);
    }
  }
  if (lastError) logEvent('spotify', 'Spotify pause fallback failed', lastError);
  return '';
}

async function resumeSpotifyAfterAnnouncement(deviceId) {
  let lastError = '';
  if (spotifyLoggedIn()) {
    try {
      await spotifyApi('PUT', '/me/player/play', null, deviceId ? { device_id: deviceId } : {});
      return 'Spotify API';
    } catch (error) {
      lastError = error.message || String(error);
    }
  }
  if (spotifyPlayer && typeof spotifyPlayer.resume === 'function') {
    try {
      await spotifyPlayer.resume();
      return 'receiver SDK';
    } catch (error) {
      lastError = lastError || error.message || String(error);
    }
  }
  if (lastError) logEvent('spotify', 'Spotify resume after announcement failed', lastError);
  return '';
}

async function spotifySetVolume(percent, targetDeviceId = '', options = {}) {
  const volume = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  if (options.persist !== false) {
    S.spotifyVolume = volume;
    localSave();
  }
  const localSet = await spotifySetLocalPlayerVolume(volume);
  let lastError = '';
  let remoteSet = false;
  let method = localSet ? 'receiver SDK' : '';
  const candidates = [];
  const addCandidate = id => {
    const value = String(id || '').trim();
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  addCandidate(targetDeviceId);
  addCandidate(spotifyWebDeviceId);
  addCandidate(S.spotifyDeviceId);
  try { addCandidate((await spotifyPlaybackState())?.deviceId); } catch (error) { lastError = error.message || String(error); }
  try { addCandidate(await spotifyTargetDevice({ ...options, allowStart: false })); } catch (error) { lastError = error.message || String(error); }
  if (spotifyLoggedIn()) {
    for (const deviceId of candidates) {
      try {
        await spotifyApi('PUT', '/me/player/volume', null, { volume_percent: volume, device_id: deviceId });
        remoteSet = true;
        method = method ? `${method} + Spotify API` : 'Spotify API';
        S.spotifyDeviceId = deviceId;
        S.spotifyReceiverReadyAt = Date.now();
        break;
      } catch (error) {
        lastError = error.message || String(error);
      }
    }
    if (!remoteSet) {
      try {
        await spotifyApi('PUT', '/me/player/volume', null, { volume_percent: volume });
        remoteSet = true;
        method = method ? `${method} + active Spotify API` : 'active Spotify API';
      } catch (error) {
        lastError = error.message || String(error);
      }
    }
  }
  if (!localSet && !remoteSet) throw Error(lastError || 'Spotify volume was not accepted by the receiver or Spotify.');
  return { localSet, remoteSet, method };
}

async function spotifyActuallyPlaying(targetDeviceId = '') {
  await new Promise(resolve => setTimeout(resolve, 850));
  try {
    const state = spotifyPlayer && typeof spotifyPlayer.getCurrentState === 'function' ? await spotifyPlayer.getCurrentState() : null;
    if (state && state.paused === false) return true;
  } catch {}
  try {
    const data = await spotifyApi('GET', '/me/player');
    if (!data?.is_playing) return false;
    if (!targetDeviceId) return true;
    return String(data.device?.id || '') === String(targetDeviceId);
  } catch {
    return false;
  }
}

function spotifyErrorMessage(error) {
  return error?.message || String(error || 'Spotify command failed.');
}

function spotifyRestrictionLike(message) {
  return /restriction violated|not allowed|not active|no active device|autoplay|platform|denied|rate|HTTP 429/i.test(String(message || ''));
}

async function spotifyAttempt(label, fn, errors) {
  try {
    await fn();
    return true;
  } catch (error) {
    const first = spotifyErrorMessage(error);
    errors.push(`${label}: ${first}`);
    if (/HTTP 429|rate/i.test(first)) {
      await wait(1800);
      try {
        await fn();
        return true;
      } catch (retryError) {
        errors.push(`${label} retry: ${spotifyErrorMessage(retryError)}`);
      }
    }
    return false;
  }
}

async function sendSpotifyPlayback(playUrl, deviceId) {
  const target = String(deviceId || '').trim();
  if (!target) throw actionNeededError('Spotify receiver is not ready yet. Tap Start Receiver + Play Spotify on the speaker-connected Home phone.');
  const body = spotifyBody(playUrl);
  const errors = [];
  const before = await spotifyPlaybackState().catch(error => {
    errors.push(`read current playback: ${spotifyErrorMessage(error)}`);
    return null;
  });

  await spotifySetVolume(S.spotifyVolume, target, { preferKnown: true, allowStart: false }).catch(error => {
    errors.push(`set volume before play: ${spotifyErrorMessage(error)}`);
  });

  if (before?.isPlaying && before.deviceId && String(before.deviceId) !== target) {
    const moved = await spotifyAttempt('transfer active playback to receiver', () => spotifyApi('PUT', '/me/player', { device_ids: [target], play: true }), errors);
    if (moved && await spotifyActuallyPlaying(target)) return true;
  }

  if (before?.deviceId && String(before.deviceId) === target && !before.isPlaying && before.hasPlayback && spotifyStateMatchesUrl(before, playUrl)) {
    let resumed = await spotifyAttempt('resume receiver current playback', () => spotifyApi('PUT', '/me/player/play', null, { device_id: target }), errors);
    if (!resumed && spotifyPlayer && typeof spotifyPlayer.resume === 'function' && (target === spotifyWebDeviceId || target === S.spotifyDeviceId)) {
      if (spotifyFreshTapActivatedPlayer) await activateSpotifyElement();
      resumed = await spotifyAttempt('resume receiver SDK current playback', () => spotifyPlayer.resume(), errors);
    }
    if (resumed && await spotifyActuallyPlaying(target)) return true;
  }

  const transferred = await spotifyAttempt('transfer to receiver', () => spotifyApi('PUT', '/me/player', { device_ids: [target], play: false }), errors);
  if (transferred) await wait(450);

  let played = await spotifyAttempt('play on receiver', () => spotifyApi('PUT', '/me/player/play', body, { device_id: target }), errors);
  if (!played && spotifyRestrictionLike(errors.join(' ')) && spotifyPlayer && typeof spotifyPlayer.resume === 'function') {
    if (target === spotifyWebDeviceId || target === S.spotifyDeviceId) {
      await activateSpotifyElement();
      played = await spotifyAttempt('resume receiver SDK', () => spotifyPlayer.resume(), errors);
    }
  }
  if (!played && spotifyRestrictionLike(errors.join(' '))) {
    played = await spotifyAttempt('play on active Spotify device', () => spotifyApi('PUT', '/me/player/play', body), errors);
  }

  await spotifySetVolume(S.spotifyVolume, target, { preferKnown: true, allowStart: false }).catch(error => {
    errors.push(`set volume after play: ${spotifyErrorMessage(error)}`);
  });
  if (await spotifyActuallyPlaying(target)) return true;

  if (played && spotifyRestrictionLike(errors.join(' '))) {
    const active = await spotifyPlaybackState().catch(() => null);
    if (active?.isPlaying && active.deviceId) {
      S.spotifyDeviceId = active.deviceId;
      S.spotifyDeviceName = active.name || S.spotifyDeviceName || 'Spotify device';
      S.receiverLastSeen = stamp();
      localSave();
      return true;
    }
  }

  throw Error(errors.join(' · ') || 'Spotify did not report active playback on the receiver.');
}

function markSpotifyPlaybackAccepted(playUrl) {
  S.intent = 'playing';
  S.spotifyNowPlaying = sourceLabel('spotify', playUrl);
  S.spotifyStatus = `Spotify play accepted on receiver: ${sourceLabel('spotify', playUrl)}.`;
  S.spotifyNeedsTap = false;
  receiverActive = true;
  setManualMusicStart('Spotify started manually');
  markMatchingSpotifyPlayEventsHandled(playUrl);
  logEvent('play', 'Spotify playing on receiver', sourceLabel('spotify', playUrl), { provider: 'spotify', url: playUrl });
  setSpotifyStatus(`Spotify is playing on this receiver: ${sourceLabel('spotify', playUrl)}.`, true);
}

async function playSpotifyUrl(url = S.spotifyUrl, push = true, options = {}) {
  readMusicSettings();
  const playUrl = url || S.spotifyUrl;
  if (!playUrl) throw Error('Paste a Spotify playlist or song URL first.');
  S.musicProvider = 'spotify';
  S.spotifyUrl = playUrl;
  rememberActiveSource('spotify', playUrl, push ? 'sent to receivers' : 'playing on receiver');
  if (S.screen !== 'home' && push) {
    await issueCommand('spotify-play', { label: 'Play Spotify', provider: 'spotify', url: playUrl, detail: sourceLabel('spotify', playUrl) }, `Spotify play command sent: ${sourceLabel('spotify', playUrl)}.`);
    return;
  }
  clearManualMusicHold();
  await pauseSunoForSpotifyPlayback();
  if (!spotifyLoggedIn()) throw actionNeededError('Spotify is not connected on this receiver. Tap Login Spotify on the speaker-connected Home phone.');
  const remotePreferredId = options.fromRemote
    ? await spotifyTargetDevice({ preferKnown: true, preferActive: true, preferPoolside: true, allowStart: false }).catch(() => '')
    : '';
  if (remotePreferredId) {
    try {
      const audible = await sendSpotifyPlayback(playUrl, remotePreferredId);
      if (audible) {
        markSpotifyPlaybackAccepted(playUrl);
        await pushState('Receiver Spotify playback logged.', { render: false });
        renderWhenIdle();
        return;
      }
      logEvent('spotify', 'Known Spotify device did not become audible', S.spotifyDeviceName || remotePreferredId, { provider: 'spotify', url: playUrl });
    } catch (error) {
      logEvent('spotify', 'Known Spotify device command failed', error.message || String(error), { provider: 'spotify', url: playUrl });
    }
  }
  const deviceId = await startSpotifyReceiver({ fromTap: !!options.fromTap });
  if (options.fromTap) await activateSpotifyElement();
  let audible = false;
  try {
    audible = await sendSpotifyPlayback(playUrl, deviceId);
  } catch (error) {
    if (options.fromTap && isIOSLikeBrowser() && !spotifyFreshTapActivatedPlayer && spotifyRestrictionLike(error.message)) {
      const message = 'Spotify receiver is prepared on this iPhone. Tap Start Receiver + Play Spotify one more time so iOS can activate Spotify playback.';
      S.spotifyNeedsTap = true;
      S.receiverStatus = 'Spotify receiver prepared; needs one more tap.';
      setActionNeeded(message);
      warmSpotifyReceiver();
      throw actionNeededError(message);
    }
    throw error;
  }
  if (audible) {
    markSpotifyPlaybackAccepted(playUrl);
  } else {
    const message = 'Spotify accepted the command, but this Home receiver is not the audible Spotify device yet. Tap Start Receiver + Play Spotify on the speaker-connected phone once.';
    S.intent = 'stopped';
    S.spotifyNeedsTap = true;
    S.setupNotice = message;
    S.receiverStatus = 'Spotify needs one receiver tap.';
    rememberActiveSource('spotify', playUrl, 'waiting for receiver tap');
    logEvent('receiver', 'Spotify waiting for receiver tap', message, { provider: 'spotify', url: playUrl });
    localSave();
    throw actionNeededError(message);
  }
  await pushState('Receiver Spotify playback logged.', { render: false });
  renderWhenIdle();
}

async function spotifyPause(push = true) {
  if (S.screen !== 'home' && push) {
    await issueCommand('pause', { label: 'Pause music' }, 'Pause command sent to all active receivers.');
    return;
  }
  const deviceId = await spotifyTargetDevice({ preferActive: true, preferPoolside: true, allowStart: false });
  if (!deviceId) throw actionNeededError('Spotify is playing, but this receiver could not identify the active Spotify device. Tap Start Receiver + Play Spotify once, then press Stop again.');
  await spotifyApi('PUT', '/me/player/pause', null, { device_id: deviceId });
  S.intent = 'paused';
  setManualMusicHold('Spotify paused manually');
  setSpotifyStatus('Spotify paused on receiver.', true);
  logEvent('pause', 'Spotify paused', '');
  await pushState('Receiver Spotify pause logged.', { render: false });
  renderWhenIdle();
}

async function spotifyStop(push = true) {
  if (S.screen !== 'home' && push) {
    await issueCommand('stop', { label: 'Stop music' }, 'Stop command sent to all active receivers.');
    return;
  }
  await spotifyPause(false);
  S.intent = 'stopped';
  setManualMusicHold('Spotify stopped manually');
  setSpotifyStatus('Spotify stopped on receiver.', true);
  logEvent('stop', 'Spotify stopped', '');
  await pushState('Receiver Spotify stop logged.', { render: false });
  renderWhenIdle();
}

async function spotifyNext(push = true) {
  if (S.screen !== 'home' && push) {
    await issueCommand('skip', { label: 'Skip track' }, 'Skip command sent to all active receivers.');
    return;
  }
  await spotifyApi('POST', '/me/player/next', null, { device_id: await spotifyTargetDevice({ preferKnown: true, preferActive: true, preferPoolside: true }) });
  S.intent = 'playing';
  setSpotifyStatus('Spotify skipped to next track.', true);
  logEvent('skip', 'Spotify skipped', '');
  await pushState('Receiver Spotify skip logged.', { render: false });
  renderWhenIdle();
}

async function checkSpotifyHealth(renderAfter = true) {
  readMusicSettings();
  if (!spotifyConfigured()) throw Error('Spotify Client ID is missing.');
  if (!spotifyLoggedIn()) throw Error('Spotify is not logged in on this browser. Log in on the speaker-connected receiver.');
  const me = await spotifyApi('GET', '/me');
  const devices = await spotifyDevices();
  S.spotifyAccountProduct = String(me.product || 'unknown');
  S.spotifyDevicesSummary = devices.length ? `Devices: ${devices.map(device => `${device.name || 'Unnamed'}${device.is_active ? ' active' : ''}`).join(', ')}` : 'Devices: none returned yet';
  const active = devices.find(device => device?.id && !device.is_restricted && device.is_active);
  const known = S.spotifyDeviceId ? devices.find(device => String(device.id) === String(S.spotifyDeviceId)) : null;
  if (known || active) setSpotifyDevice(known || active, `Spotify device available: ${(known || active).name || 'Spotify device'}.`);
  if (S.spotifyAccountProduct !== 'premium') setSpotifyStatus(`Spotify account is ${S.spotifyAccountProduct}. Web Playback requires Premium.`, false);
  else setSpotifyStatus(`Spotify Premium confirmed. ${S.spotifyDevicesSummary}.`, true);
  logEvent('spotify', 'Spotify health check', `${S.spotifyAccountProduct}; ${S.spotifyDevicesSummary}`);
  await pushState('Spotify health logged.', { render: false });
  if (renderAfter) renderWhenIdle();
}

function releaseCommandReceiver(reason = 'command mode') {
  if (S.screen === 'home') return;
  receiverActive = false;
  storageRemove(RECEIVER_SESSION_KEY);
  if (spotifyPlayer && typeof spotifyPlayer.disconnect === 'function') {
    try { spotifyPlayer.disconnect(); } catch {}
  }
  spotifyPlayer = null;
  spotifyPlayerReady = false;
  spotifyWebDeviceId = '';
  S.spotifyStatus = `Command mode only. This browser will not become a receiver (${reason}).`;
  localSave();
}

async function duckSpotifyForAnnouncement() {
  if (S.musicProvider !== 'spotify') return null;
  const targetVolume = clampNumber(S.spotifyDuckedVolume, 0, 20, 0);
  const current = await spotifyCurrentPlaybackDevice({ requirePlaying: true });
  const snapshot = {
    volume: current?.volume ?? clampNumber(S.spotifyVolume, 0, 100, DEFAULT_MUSIC_VOLUME),
    wasPlaying: !!current?.isPlaying || S.intent === 'playing',
    deviceId: current?.deviceId || (S.screen === 'home' ? (spotifyWebDeviceId || S.spotifyDeviceId || '') : (S.spotifyDeviceId || '')),
    targetVolume,
    pausedForDuck: false,
    duckMethod: ''
  };
  try {
    if (S.screen !== 'home') return null;
    if (!spotifyLoggedIn() && !S.spotifyDeviceId && !spotifyPlayer) {
      logEvent('spotify', 'Spotify duck skipped', 'Receiver has no Spotify token, device, or local Spotify player.');
      return null;
    }
    const deviceId = snapshot.deviceId || await spotifyTargetDevice({ preferActive: true, preferPoolside: true, allowStart: false, requirePlaying: true });
    if (!deviceId && !spotifyPlayer) {
      logEvent('spotify', 'Spotify duck skipped', 'No active Spotify playback device was reported for this receiver.');
      return null;
    }
    snapshot.deviceId = deviceId;
    let localSet = false;
    let remoteSet = false;
    let remoteError = '';
    let appliedMethod = '';
    try {
      const result = await spotifySetVolume(targetVolume, deviceId, { persist: false, preferKnown: true, preferActive: true, preferPoolside: true, allowStart: false });
      localSet = !!result.localSet;
      remoteSet = !!result.remoteSet;
      appliedMethod = result.method || '';
    } catch (error) {
      remoteError = error.message || String(error);
    }
    await wait(450);
    let verified = false;
    let after = null;
    try {
      after = await spotifyPlaybackState();
    } catch (error) {
      logEvent('spotify', 'Spotify duck verification failed', error.message || String(error));
    }
    if (after?.deviceId) {
      if (!snapshot.deviceId) snapshot.deviceId = after.deviceId;
      snapshot.wasPlaying = snapshot.wasPlaying || after.isPlaying;
      verified = Number.isFinite(after.volume) && after.volume <= targetVolume + 2;
    }
    if (!verified && snapshot.wasPlaying) {
      const pauseMethod = await pauseSpotifyForAnnouncement(snapshot.deviceId);
      if (pauseMethod) {
        snapshot.pausedForDuck = true;
        snapshot.duckMethod = `pause via ${pauseMethod}`;
        logEvent('spotify', 'Spotify paused for announcement', `Volume duck to ${targetVolume}% was not confirmed${remoteError ? ` (${remoteError})` : ''}; music will resume after the announcement.`);
        setFeedback('Spotify volume did not confirm, so music paused for the announcement and will resume after.', true);
        return snapshot;
      }
    }
    if (!verified && !localSet && !remoteSet) {
      throw Error(remoteError || 'Spotify did not accept a local or remote duck command.');
    }
    snapshot.duckMethod = verified
      ? appliedMethod || `${remoteSet ? 'Spotify API' : ''}${remoteSet && localSet ? ' + ' : ''}${localSet ? 'receiver SDK' : ''}` || 'verified'
      : appliedMethod || `${remoteSet ? 'Spotify API' : ''}${remoteSet && localSet ? ' + ' : ''}${localSet ? 'receiver SDK' : ''}` || 'unverified';
    logEvent(verified ? 'spotify' : 'receiver', verified ? 'Spotify ducked for announcement' : 'Spotify duck sent but unverified', `${targetVolume}% via ${snapshot.duckMethod}.`);
    setFeedback(`Spotify lowered to ${targetVolume}% for announcement. The current song is not restarted.`, true);
    return snapshot;
  } catch (error) {
    logEvent('spotify', 'Spotify duck failed', error.message || String(error));
    setFeedback(`Spotify ducking failed, but voice will still play: ${error.message}`, false);
    return null;
  }
}

async function restoreSpotifyAfterAnnouncement(snapshot) {
  if (!snapshot) return;
  try {
    const restoreVolume = clampNumber(S.spotifyVolume, 0, 100, snapshot.volume ?? DEFAULT_MUSIC_VOLUME);
    let restoreError = '';
    try {
      await spotifySetVolume(restoreVolume, snapshot.deviceId || '', { persist: false, preferKnown: true, preferActive: true, preferPoolside: true, allowStart: false });
    } catch (error) {
      restoreError = error.message || String(error);
      logEvent('spotify', 'Spotify restore volume failed', restoreError);
    }
    if (snapshot.wasPlaying && !manualMusicHoldActive()) {
      if (snapshot.pausedForDuck) {
        const resumeMethod = await resumeSpotifyAfterAnnouncement(snapshot.deviceId);
        if (resumeMethod) {
          S.intent = 'playing';
          logEvent('spotify', 'Spotify resumed after announcement', resumeMethod);
        }
      } else {
        try {
          const player = await spotifyApi('GET', '/me/player');
          if (player && player.is_playing === false && snapshot.deviceId) await spotifyApi('PUT', '/me/player/play', null, { device_id: snapshot.deviceId });
        } catch {}
        S.intent = 'playing';
      }
    }
    setFeedback(restoreError ? `Announcement finished; Spotify restore needs review: ${restoreError}` : 'Announcement finished; Spotify volume restored without restarting the song.', !restoreError);
  } catch (error) {
    setFeedback(`Spotify restore failed: ${error.message}`, false);
  }
}

function sunoAudible() {
  return S.musicProvider === 'suno' && receiverActive && !music.paused && !!music.src;
}

async function duckSunoForAnnouncement() {
  if (!sunoAudible()) return null;
  const snapshot = { volume: Number.isFinite(music.volume) ? music.volume : musicGain(), wasPlaying: !music.paused };
  await fade(music, Number(S.sunoDuckedVolume || 2) / 100, 500);
  return snapshot;
}

async function restoreSunoAfterAnnouncement(snapshot) {
  if (!snapshot) return;
  try {
    if (snapshot.wasPlaying && music.paused) await music.play();
    await fade(music, Number.isFinite(snapshot.volume) ? snapshot.volume : musicGain(), 700);
    S.intent = 'playing';
    setFeedback('Announcement finished; Suno volume restored without restarting the track.', true);
  } catch (error) {
    setFeedback(`Suno restore failed: ${error.message}`, false);
  }
}

function playableTrackAt(index) {
  if (!S.tracks.length) return null;
  const safeIndex = Math.max(0, Math.min(Number(index) || 0, S.tracks.length - 1));
  return { item: S.tracks[safeIndex], index: safeIndex };
}

function playAudioElementToEnd(audio, timeoutMs = 8 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    let started = false;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onPlaying = () => { started = true; };
    const onEnded = () => finish(resolve, true);
    const onError = () => finish(reject, Error(started ? 'Suno announcement ended with an audio error.' : 'Suno announcement audio did not start.'));
    const timer = setTimeout(() => finish(reject, Error('Suno announcement timed out before the track ended.')), timeoutMs);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    Promise.resolve(audio.play()).then(onPlaying).catch(error => finish(reject, error instanceof Error ? error : Error(String(error || 'Audio play blocked.'))));
  });
}

async function announceSunoTrack(trackIndex, options = {}) {
  const job = announcementTail.then(() => performSunoAnnouncement(trackIndex, options));
  announcementTail = job.catch(() => {});
  return await job;
}

async function announceSunoUrl(url, options = {}) {
  const job = announcementTail.then(() => performSunoUrlAnnouncement(url, options));
  announcementTail = job.catch(() => {});
  return await job;
}

async function playSunoCue(url, options = {}) {
  const job = announcementTail.then(() => performSunoUrlCue(url, options));
  announcementTail = job.catch(() => {});
  return await job;
}

async function performSunoUrlCue(url, options = {}) {
  if (S.screen !== 'home') throw Error('Suno cues play only on receiver screens.');
  const raw = String(url || '').trim();
  if (!raw) throw Error('Paste a Suno song, playlist, or direct audio URL first.');
  speaking = true;
  let title = sourceLabel('suno', raw);
  try {
    S.musicProvider = 'spotify';
    await ensureReceiverAudio('Suno cue', { required: true });
    const { tracks } = await fetchSunoTracksForUrl(raw);
    const chosen = tracks.find(item => item.audioUrl) || null;
    if (!chosen?.audioUrl) throw Error('That Suno URL did not expose playable audio. Paste a direct audio URL or a public Suno URL that includes playable audio.');
    title = chosen.title || compactUrl(raw);
    const spotifySnapshot = await duckSpotifyForAnnouncement();
    try {
      announcementMusic.pause();
      announcementMusic.src = chosen.audioUrl;
      announcementMusic.muted = false;
      announcementMusic.volume = musicGain(S.sunoVolume);
      await playAudioElementToEnd(announcementMusic);
    } finally {
      await restoreSpotifyAfterAnnouncement(spotifySnapshot);
      announcementMusic.pause();
      try { announcementMusic.currentTime = 0; } catch {}
      announcementMusic.volume = 1;
    }
    S.musicProvider = 'spotify';
    S.intent = 'playing';
    setManualMusicStart('Suno cue restored Spotify');
    S.activeMusicProvider = 'spotify';
    S.activeMusicUrl = S.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST;
    S.activeMusicLabel = `Spotify bed restored after Suno cue: ${title}`;
    logEvent('play', 'Suno cue played', `${title} · ${compactUrl(raw)}`, { url: raw, eventId: options.eventId || '' });
    setFeedback(`Suno cue finished; Spotify bed restored: ${title}.`, true);
    await pushState('Receiver Suno cue logged.', { render: false });
    renderWhenIdle();
    return true;
  } catch (error) {
    throw actionNeededError(`Receiver could not start the Suno cue: ${error.message}. Keep the speaker phone on Home, then send the cue again.`);
  } finally {
    speaking = false;
    localSave();
  }
}

async function performSunoUrlAnnouncement(url, options = {}) {
  if (S.screen !== 'home') throw Error('Suno announcements play only on receiver screens.');
  const raw = String(url || '').trim();
  if (!raw) throw Error('Paste a Suno song, playlist, or direct audio URL first.');
  speaking = true;
  try {
    await ensureReceiverAudio('Suno URL announcement', { required: true });
    const { tracks } = await fetchSunoTracksForUrl(raw);
    const chosen = tracks.find(item => item.audioUrl) || null;
    if (!chosen?.audioUrl) throw Error('That Suno URL did not expose playable audio. Paste a direct audio URL or a public Suno URL that includes playable audio.');
    const spotifySnapshot = await duckSpotifyForAnnouncement();
    const sunoSnapshot = await duckSunoForAnnouncement();
    try {
      announcementMusic.pause();
      announcementMusic.src = chosen.audioUrl;
      announcementMusic.muted = false;
      announcementMusic.volume = 1;
      await playAudioElementToEnd(announcementMusic);
      logEvent('announcement', options.hold ? 'Safety Suno URL announcement played' : 'Suno URL announcement played', `${chosen.title || options.label || 'Suno track'} · ${compactUrl(raw)}`, { eventId: options.eventId || '', url: raw });
      setFeedback(`Suno announcement completed: ${chosen.title || compactUrl(raw)}.`, true);
      return true;
    } finally {
      await restoreSpotifyAfterAnnouncement(spotifySnapshot);
      await restoreSunoAfterAnnouncement(sunoSnapshot);
      announcementMusic.pause();
      try { announcementMusic.currentTime = 0; } catch {}
    }
  } catch (error) {
    throw actionNeededError(`Receiver could not start the Suno URL announcement: ${error.message}. Tap Start Receiver + Play Spotify on the speaker-connected phone, then send it again.`);
  } finally {
    speaking = false;
    localSave();
    renderWhenIdle();
  }
}

async function performSunoAnnouncement(trackIndex, options = {}) {
  if (S.screen !== 'home') throw Error('Suno announcements play only on receiver screens.');
  speaking = true;
  try {
    await ensureReceiverAudio('Suno announcement', { required: true });
    if (!hasPlayableSuno()) await importSuno('Suno playlist imported for announcement.');
    const chosen = playableTrackAt(trackIndex);
    if (!chosen?.item?.audioUrl) throw Error('The selected Suno announcement track has no playable audio URL. Import a Suno playlist with playable tracks or choose a different track.');
    const spotifySnapshot = await duckSpotifyForAnnouncement();
    const sunoSnapshot = await duckSunoForAnnouncement();
    try {
      announcementMusic.pause();
      announcementMusic.src = chosen.item.audioUrl;
      announcementMusic.muted = false;
      announcementMusic.volume = 1;
      await playAudioElementToEnd(announcementMusic);
      logEvent('announcement', options.hold ? 'Safety Suno announcement played' : 'Suno announcement played', `${chosen.item.title || 'Suno track'} · ${chosen.item.artist || ''}`, { eventId: options.eventId || '', trackIndex: chosen.index });
      setFeedback(`Suno announcement completed: ${chosen.item.title || 'track'}.`, true);
      return true;
    } finally {
      await restoreSpotifyAfterAnnouncement(spotifySnapshot);
      await restoreSunoAfterAnnouncement(sunoSnapshot);
      announcementMusic.pause();
      try { announcementMusic.currentTime = 0; } catch {}
    }
  } catch (error) {
    throw actionNeededError(`Receiver could not start the Suno announcement: ${error.message}. Tap Start Receiver + Play Spotify on the speaker-connected phone, then send it again.`);
  } finally {
    speaking = false;
    localSave();
    renderWhenIdle();
  }
}

async function fetchAiVoiceBlob(message) {
  const response = await fetch(API.tts, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: message,
      voice: S.aiVoice || 'marin',
      instructions: 'Speak like a calm, polished, natural resort public-address announcer at Serenity Shores. Be clear, warm, firm, projected, and loud enough to cut through pool music.'
    })
  });
  if (response.ok) return await response.blob();
  const data = await response.json().catch(() => ({}));
  throw Error(data.error || data.detail || `OpenAI TTS HTTP ${response.status}`);
}

async function playAnnouncementBlob(blob) {
  if (typeof window.__poolsideV18PlayAnnouncementBlob === 'function') {
    return await window.__poolsideV18PlayAnnouncementBlob(blob, { gain: S.announcementGain });
  }
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = 'auto';
  audio.playsInline = true;
  audio.setAttribute('playsinline', '');
  audio.setAttribute('webkit-playsinline', '');
  audio.muted = false;
  audio.volume = 1;
  return await new Promise((resolve, reject) => {
    let started = false;
    const cleanup = () => { try { URL.revokeObjectURL(url); } catch {} };
    const timer = setTimeout(() => {
      if (!started) {
        cleanup();
        reject(Error('Announcement audio did not start. Tap Start Receiver + Play Spotify on this speaker-connected device.'));
      }
    }, 6500);
    audio.onplaying = () => { started = true; };
    audio.onended = () => { clearTimeout(timer); cleanup(); resolve(true); };
    audio.onerror = () => { clearTimeout(timer); cleanup(); reject(Error('Announcement audio failed.')); };
    Promise.resolve(audio.play()).then(() => { started = true; }).catch(error => {
      clearTimeout(timer);
      cleanup();
      reject(error instanceof Error ? error : Error(String(error || 'Audio play blocked.')));
    });
  });
}

function playDeviceSpeech(message) {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(Error('No device speech engine is available in this browser.'));
      return;
    }
    let started = false;
    let settled = false;
    const timeout = setTimeout(() => {
      if (!started && !settled) {
        settled = true;
        reject(Error('Device speech did not start. Tap Start Receiver + Play Spotify once, then send Speak Now again.'));
      }
    }, 4200);
    const utterance = new SpeechSynthesisUtterance(message);
    const voice = voices.find(item => item.name === S.deviceVoice) || bestVoices()[0];
    if (voice) utterance.voice = voice;
    utterance.rate = Number(S.rate) || .94;
    utterance.pitch = Number(S.pitch) || 1;
    utterance.volume = 1;
    utterance.onstart = () => {
      started = true;
      clearTimeout(timeout);
    };
    utterance.onend = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(true);
    };
    utterance.onerror = event => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(Error(event?.error || 'Device speech failed.'));
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  });
}

async function announce(text, options = {}) {
  const job = announcementTail.then(() => performAnnouncement(text, options));
  announcementTail = job.catch(() => {});
  return await job;
}

async function performAnnouncement(text, options = {}) {
  const message = tokens(text).trim();
  if (!message) throw Error('Announcement text is empty.');
  if (S.screen !== 'home') throw Error('Announcements play only on receiver screens.');
  speaking = true;
  let voiceBlob = null;
  let aiError = '';
  if (S.voiceMode === 'ai') {
    try {
      await ensureReceiverAudio('announcement', { required: true });
      voiceBlob = await fetchAiVoiceBlob(message);
    } catch (error) {
      aiError = error.message || String(error);
    }
  }
  const spotifySnapshot = await duckSpotifyForAnnouncement();
  const sunoSnapshot = await duckSunoForAnnouncement();
  try {
    await ensureReceiverAudio('announcement', { required: true });
    if (voiceBlob) {
      await playAnnouncementBlob(voiceBlob);
      setFeedback(`AI voice announcement completed at ${Math.round(Number(S.announcementGain || 1) * 100)}% boost.`, true);
    } else {
      if (aiError) logEvent('voice', 'AI voice fallback', aiError);
      await playDeviceSpeech(message);
      setFeedback('Device voice announcement completed at max browser volume.', true);
    }
    logEvent('announcement', options.hold ? 'Safety announcement played' : 'Announcement played', message.slice(0, 190), { eventId: options.eventId || '', gain: S.announcementGain });
    return true;
  } catch (error) {
    throw actionNeededError(`Receiver could not start voice audio: ${error.message}. Tap Start Receiver + Play Spotify on the speaker-connected phone, then send Speak Now again.`);
  } finally {
    await restoreSpotifyAfterAnnouncement(spotifySnapshot);
    await restoreSunoAfterAnnouncement(sunoSnapshot);
    speaking = false;
    localSave();
    renderWhenIdle();
  }
}

function scoreVoice(voice) {
  const name = `${voice.name || ''} ${voice.lang || ''}`.toLowerCase();
  let score = 0;
  ['samantha', 'ava', 'allison', 'siri', 'google', 'microsoft', 'aria', 'jenny', 'natural', 'premium', 'enhanced', 'serena'].forEach((term, index) => {
    if (name.includes(term)) score += 70 - index;
  });
  if (name.includes('en-us')) score += 12;
  return score;
}

function bestVoices() {
  return voices.filter(voice => /^en/i.test(voice.lang || '')).sort((a, b) => scoreVoice(b) - scoreVoice(a)).slice(0, 40);
}

function mins(value) {
  const [h, m] = String(value || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function hm(value) {
  const n = ((Number(value) || 0) % 1440 + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

function pretty(value) {
  const [h, m] = String(value || '00:00').split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function schedTime(item) {
  return Number.isFinite(Number(item.offsetToClose)) ? hm(mins(S.poolClose) - Number(item.offsetToClose)) : (item.time || '12:00');
}

function openNow() {
  const current = new Date().getHours() * 60 + new Date().getMinutes();
  const open = mins(S.poolOpen);
  const close = mins(S.poolClose);
  return open <= close ? current >= open && current < close : current >= open || current < close;
}

function nextPoolCloseMs() {
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const open = mins(S.poolOpen);
  const close = mins(S.poolClose);
  const result = new Date(now);
  result.setHours(Math.floor(close / 60), close % 60, 0, 0);
  if (open <= close) {
    if (current >= close) result.setDate(result.getDate() + 1);
  } else if (current >= open) {
    result.setDate(result.getDate() + 1);
  }
  return result.getTime();
}

function manualMusicHoldActive() {
  const until = Number(S.manualMusicHoldUntil || 0);
  if (!until) return false;
  if (until > Date.now()) return true;
  S.manualMusicHoldUntil = 0;
  S.manualMusicHoldReason = '';
  localSave();
  return false;
}

function manualMusicStartActive() {
  const until = Number(S.manualMusicStartUntil || 0);
  if (!until) return false;
  if (until > Date.now()) return true;
  S.manualMusicStartUntil = 0;
  S.manualMusicStartReason = '';
  localSave();
  return false;
}

function setManualMusicStart(reason = 'Manual play') {
  if (S.playbackMode === 'hours') S.manualMusicStartUntil = nextPoolCloseMs() + 60000;
  else if (S.playbackMode === 'always') S.manualMusicStartUntil = Date.now() + 24 * 60 * 60 * 1000;
  else S.manualMusicStartUntil = 0;
  S.manualMusicStartReason = S.manualMusicStartUntil ? reason : '';
  localSave();
}

function clearManualMusicStart() {
  if (!S.manualMusicStartUntil && !S.manualMusicStartReason) return;
  S.manualMusicStartUntil = 0;
  S.manualMusicStartReason = '';
  localSave();
}

function setManualMusicHold(reason = 'Manual stop') {
  clearManualMusicStart();
  if (S.playbackMode === 'hours' && openNow()) S.manualMusicHoldUntil = nextPoolCloseMs() + 60000;
  else if (S.playbackMode === 'always') S.manualMusicHoldUntil = Date.now() + 24 * 60 * 60 * 1000;
  else S.manualMusicHoldUntil = 0;
  S.manualMusicHoldReason = S.manualMusicHoldUntil ? reason : '';
  localSave();
}

function clearManualMusicHold() {
  if (!S.manualMusicHoldUntil && !S.manualMusicHoldReason) return;
  S.manualMusicHoldUntil = 0;
  S.manualMusicHoldReason = '';
  localSave();
}

function shouldPlayContinuously() {
  return S.playbackMode === 'always' || openNow();
}

function ann() {
  return S.anns.find(item => item.id === S.selected) || S.anns[0] || defaultAnn('welcome');
}

function annText(id) {
  return (S.anns.find(item => item.id === id) || {}).text || '';
}

function tokens(text) {
  return String(text || '')
    .replaceAll('{name}', S.guestName || 'friend')
    .replaceAll('{close}', pretty(S.poolClose))
    .replaceAll('{open}', pretty(S.poolOpen))
    .replaceAll('{resort}', 'Serenity Shores');
}

function scheduleMode(mode = S.activeSchedule) {
  return mode === 'party' ? 'party' : 'daily';
}

function scheduleItems(mode = S.activeSchedule) {
  return scheduleMode(mode) === 'party' ? S.partySchedule : S.schedule;
}

function scheduleTitle(mode = S.activeSchedule) {
  return scheduleMode(mode) === 'party' ? 'Party Schedule' : 'Daily Schedule';
}

function scheduleTab(mode = S.activeSchedule) {
  return scheduleMode(mode) === 'party' ? 'party' : 'schedule';
}

function scheduleFieldKey(mode, index) {
  return `${scheduleMode(mode)}-${index}`;
}

function scheduleField(name, key) {
  return document.querySelector(`[data-${name}="${key}"]`);
}

function hasTrackIndex(item) {
  return item && item.trackIndex !== undefined && item.trackIndex !== null && item.trackIndex !== '' && Number.isFinite(Number(item.trackIndex));
}

function clampTrackIndex(value) {
  return Math.max(0, Math.min(Number(value) || 0, Math.max(0, S.tracks.length - 1)));
}

function trackForItem(item) {
  return hasTrackIndex(item) ? S.tracks[clampTrackIndex(item.trackIndex)] || null : null;
}

function itemBody(item) {
  if (!item) return '';
  if (item.type === 'suno' || item.type === 'spotify') return item.url || '';
  if (item.type === 'sunoAnnouncement') {
    if (item.url) return `Suno announcement URL: ${compactUrl(item.url)}`;
    const itemTrack = trackForItem(item);
    return itemTrack ? `Suno announcement: ${itemTrack.title}` : 'Paste a Suno song URL or direct audio URL.';
  }
  if (item.type === 'song') {
    if (item.url) return `Suno music URL: ${compactUrl(item.url)}`;
    const itemTrack = trackForItem(item);
    return itemTrack ? `Specific song: ${itemTrack.title}` : 'Paste a Suno song, playlist, or direct audio URL.';
  }
  if (item.type === 'text') return item.text || '';
  return item.announcementId ? annText(item.announcementId) : (item.text || '');
}

function trackOptions(selected) {
  return S.tracks.map((item, index) => `<option value="${index}" ${Number(selected) === index ? 'selected' : ''}>${index + 1}. ${esc(item.title || 'Untitled')} - ${esc(item.artist || '')}</option>`).join('') || '<option value="0">Import Suno first</option>';
}

async function playScheduleItem(item) {
  if (!item) {
    setFeedback('No schedule item selected.', false);
    return;
  }
  if (item.type === 'announcement') {
    const saved = S.anns.find(annItem => annItem.id === item.announcementId) || ann();
    await playSavedAnnouncement(saved, !!item.hold, item.label || saved.label || 'Scheduled announcement');
    return;
  }
  if (item.type === 'sunoAnnouncement') {
    if (item.url) await sendSunoUrlAnnouncement(item.url, !!item.hold, item.label || 'Scheduled Suno announcement');
    else if (hasTrackIndex(item)) await sendSunoAnnouncement(clampTrackIndex(item.trackIndex), !!item.hold, item.label || 'Scheduled Suno announcement');
    else throw Error('This schedule item needs a Suno song URL or direct audio URL.');
    return;
  }
  if (item.type === 'spotify') {
    if (!item.url) throw Error('This schedule item has no Spotify URL.');
    S.musicProvider = 'spotify';
    S.spotifyUrl = item.url;
    await playSpotifyUrl(item.url, S.screen !== 'home');
    return;
  }
  if (item.type === 'song') {
    if (item.url) {
      await playSunoUrl(item.url, S.screen !== 'home');
      return;
    }
    throw Error('This schedule item needs a pasted Suno song, playlist, or direct audio URL.');
    return;
  }
  if (item.type === 'suno') {
    if (!item.url) throw Error('This schedule item has no Suno URL.');
    await playSunoUrl(item.url, S.screen !== 'home');
    return;
  }
  await sendAnnouncement(itemBody(item), !!item.hold, item.label || 'Scheduled announcement');
}

function createScheduleItem(mode = 'daily') {
  const item = { id: `sched-${uid()}`, label: 'New Schedule Item', type: 'text', time: '10:00', text: '', enabled: true };
  scheduleItems(mode).push(item);
  S.editId = item.id;
  save(`New ${scheduleTitle(mode).toLowerCase()} item added.`);
}

function addSongSchedule(index, mode = S.activeSchedule) {
  const itemTrack = S.tracks[Math.max(0, Math.min(Number(index) || 0, Math.max(0, S.tracks.length - 1)))] || {};
  const item = { id: `sched-${uid()}`, label: `Play ${itemTrack.title || 'Suno song'}`, type: 'song', time: '10:00', trackIndex: Number(index) || 0, enabled: true };
  scheduleItems(mode).push(item);
  S.editId = item.id;
  S.tab = scheduleTab(mode);
  save(`Added ${item.label} to the ${scheduleTitle(mode).toLowerCase()}.`);
}

function saveRow(index, mode = 'daily') {
  const key = scheduleFieldKey(mode, index);
  const row = scheduleItems(mode)[index];
  if (!row) {
    setFeedback('Schedule item not found.', false);
    return;
  }
  const priorHasTrackIndex = hasTrackIndex(row);
  const priorTrackIndex = row.trackIndex;
  const kind = scheduleField('kind', key)?.value || row.type || 'text';
  const body = scheduleField('body', key)?.value.trim() || '';
  const next = { ...row };
  next.label = scheduleField('label', key)?.value || row.label;
  next.time = scheduleField('row-time', key)?.value || row.time || '10:00';
  delete next.offsetToClose;
  delete next.announcementId;
  delete next.url;
  delete next.text;
  delete next.trackIndex;
  if (kind === 'song') {
    next.type = 'song';
    if (body) next.url = body;
    else {
      setFeedback('Paste a Suno song, playlist, or direct audio URL before saving.', false);
      return;
    }
  } else if (kind === 'sunoAnnouncement') {
    next.type = 'sunoAnnouncement';
    if (body) next.url = body;
    else {
      setFeedback('Paste a Suno song URL or direct audio URL before saving.', false);
      return;
    }
  } else if (kind === 'suno') {
    next.type = 'suno';
    next.url = body;
    if (!next.url) {
      setFeedback('Paste a Suno song, playlist, or direct audio URL before saving.', false);
      return;
    }
  } else if (kind === 'spotify') {
    next.type = 'spotify';
    next.url = body;
    if (!next.url) {
      setFeedback('Paste a Spotify URL before saving.', false);
      return;
    }
  } else if (kind === 'text') {
    next.type = 'text';
    next.text = body || 'Type announcement text here.';
  } else {
    next.type = 'announcement';
    next.announcementId = scheduleField('selann', key)?.value || S.selected;
  }
  Object.assign(row, next);
  save(`${scheduleTitle(mode)} item saved: ${row.label}.`);
}

function updateScheduleTypeDraft(index, mode, nextKind) {
  const key = scheduleFieldKey(mode, index);
  const row = scheduleItems(mode)[index];
  if (!row) return;
  const body = scheduleField('body', key)?.value || '';
  row.label = scheduleField('label', key)?.value || row.label;
  row.time = scheduleField('row-time', key)?.value || row.time || '10:00';
  if (row.type === 'text') row.text = body;
  else if (['suno', 'spotify', 'sunoAnnouncement', 'song'].includes(row.type)) row.url = body.trim();
  row.type = nextKind || 'text';
  if (row.type === 'announcement') row.announcementId ||= S.selected;
  if (row.type === 'text') row.text ||= '';
  if (['suno', 'spotify', 'sunoAnnouncement', 'song'].includes(row.type)) row.url ||= '';
  localSave();
  render();
}

async function tick() {
  if (!receiverCanProcessEvents() || speaking) return;
  if (S.lightningClearAt && Date.now() >= Number(S.lightningClearAt) && !S.lightningAllClearSent) {
    S.lightningAllClearSent = true;
    S.lightningClearAt = 0;
    await sendAnnouncement(tokens(S.lightningClearText), false, 'Lightning all clear');
  }
  if (S.autoStart && shouldPlayContinuously() && S.intent !== 'playing' && !manualMusicHoldActive()) {
    try { await playSelected(false); } catch {}
  }
  if (S.autoStop && S.playbackMode === 'hours' && !openNow() && S.intent === 'playing' && !manualMusicStartActive()) await stopSelected(false);
  const now = hm(new Date().getHours() * 60 + new Date().getMinutes());
  const mode = scheduleMode(S.activeSchedule);
  for (const item of scheduleItems(mode)) {
    if (!item.enabled || schedTime(item) !== now) continue;
    const key = `${today()}:${mode}:${item.id}:${schedTime(item)}`;
    if (S.lastRun[item.id] === key) continue;
    S.lastRun[item.id] = key;
    localSave();
    await playScheduleItem(item);
  }
}

function lightningThreat(data) {
  return /lightning|thunder/i.test(data.threatType || '');
}

function lightningStrikeKey(data) {
  const hit = data.lightning || data.lightningHits?.[0] || {};
  return String(hit.id || hit.dateTimeISO || data.summary || Date.now()).slice(0, 120);
}

function lightningRemainingText() {
  const clearAt = Number(S.lightningClearAt || 0);
  if (!clearAt || clearAt <= Date.now()) return 'No active lightning hold.';
  const minutes = Math.ceil((clearAt - Date.now()) / 60000);
  return `Lightning hold active. About ${minutes} minute(s) remain.`;
}

function weatherAnnouncement(data) {
  if (/wind/i.test(data.threatType || '')) return tokens(S.windText);
  if (/tornado/i.test(data.threatType || '')) return 'Attention guests and lifeguards. A tornado warning has been detected near Serenity Shores. Exit the pool area and move indoors immediately.';
  const hit = data.lightning || data.lightningHits?.[0] || {};
  const dist = Number.isFinite(Number(hit.distanceMI)) ? ` The closest detected strike was about ${Math.round(Number(hit.distanceMI) * 10) / 10} miles away.` : '';
  const reset = S.lightningClearAt > Date.now() ? ' Another strike has been detected, so the 30 minute safety clock has reset.' : '';
  return `${tokens(S.lightningText)}${dist}${reset}`;
}

function readWeatherSettings() {
  const dom = (id, fallback) => $(id) ? val(id) : fallback;
  S.address = dom('address', S.address);
  S.lat = dom('lat', S.lat);
  S.lon = dom('lon', S.lon);
  S.radius = clampNumber(dom('radius', S.radius), 1, 25, 10);
  S.lightningRadiusMiles = clampNumber(dom('lightningRadiusMiles', S.lightningRadiusMiles), 1, 25, 10);
  S.lightningHoldMinutes = clampNumber(dom('lightningHoldMinutes', S.lightningHoldMinutes), 5, 90, 30);
  S.windGustMph = clampNumber(dom('windGustMph', S.windGustMph), 15, 80, 35);
  S.weatherAuto = dom('weatherAuto', String(S.weatherAuto)) !== 'false';
  S.lightningText = dom('lightningText', S.lightningText) || S.lightningText;
  S.windText = dom('windText', S.windText) || S.windText;
  S.lightningClearText = dom('lightningClearText', S.lightningClearText) || S.lightningClearText;
  const lat = parseCoord(S.lat);
  const lon = parseCoord(S.lon);
  if (lat === null || lon === null) throw Error('Enter valid latitude and longitude, or tap Use Device GPS.');
  return { lat, lon, radius: S.radius, lightningRadiusMiles: S.lightningRadiusMiles, windGustMph: S.windGustMph };
}

async function fetchWeatherResult() {
  const settings = readWeatherSettings();
  const params = new URLSearchParams({
    lat: String(settings.lat),
    lon: String(settings.lon),
    radiusMiles: String(settings.radius),
    lightningRadiusMiles: String(settings.lightningRadiusMiles),
    windGustMph: String(settings.windGustMph),
    thunderstormCodesClose: 'false',
    lightningBudgetMs: '6200'
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API.weather}?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw Error(data.error || `Weather HTTP ${response.status}`);
    return { settings, data };
  } catch (error) {
    if (error?.name === 'AbortError') throw Error('Weather request timed out after 15 seconds. Try again; free lightning data can be slow.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function applyWeatherResult(data, settings, { announce = true } = {}) {
  S.weather = data.summary || 'Weather checked.';
  S.weatherCheckedAt = stamp();
  S.lat = String(settings.lat);
  S.lon = String(settings.lon);
  S.radius = settings.radius;
  S.lightningRadiusMiles = settings.lightningRadiusMiles;
  S.windGustMph = settings.windGustMph;

  if (!announce) {
    const detail = data.threat ? `${data.threatType || 'Weather'} detected: ${data.summary}` : data.summary || 'No closure trigger detected.';
    logEvent('weather', 'Weather checked on command', detail);
    setFeedback(`Weather checked on this Command screen. ${data.threat ? 'Receiver command was also sent.' : 'No closure trigger detected.'}`, true);
    return;
  }

  if (data.threat && lightningThreat(data)) {
    const strikeKey = lightningStrikeKey(data);
    if (S.lightningLastStrikeKey !== strikeKey) {
      S.lightningLastStrikeKey = strikeKey;
      S.lightningLastStrikeAt = Date.now();
      S.lightningClearAt = Date.now() + Math.max(5, Number(S.lightningHoldMinutes) || 30) * 60000;
      S.lightningAllClearSent = false;
      S.weatherLastThreatKey = `${today()}:lightning:${strikeKey}`;
      await sendAnnouncement(weatherAnnouncement(data), true, 'Lightning hold');
    } else {
      setFeedback(`Lightning threat still present; ${lightningRemainingText()}`, true);
    }
  } else if (data.threat) {
    const threatKey = `${today()}:${data.threatType}:${String(data.summary || '').slice(0, 140)}`;
    if (S.weatherLastThreatKey !== threatKey) {
      S.weatherLastThreatKey = threatKey;
      await sendAnnouncement(weatherAnnouncement(data), /tornado/i.test(data.threatType || ''), data.threatType || 'Weather alert');
    } else {
      setFeedback('Weather threat still present; duplicate announcement suppressed for this matching alert.', true);
    }
  } else if (S.lightningClearAt && Date.now() >= Number(S.lightningClearAt) && !S.lightningAllClearSent) {
    S.lightningAllClearSent = true;
    S.lightningClearAt = 0;
    await sendAnnouncement(tokens(S.lightningClearText), false, 'Lightning all clear');
  } else {
    setFeedback(`Weather checked and clear. ${data.lightningFilesChecked !== undefined ? `NOAA lightning files checked: ${data.lightningFilesChecked}.` : ''}`, true);
  }
  logEvent('weather', 'Weather checked', data.summary || 'Weather checked.', { threat: !!data.threat, threatType: data.threatType || '' });
}

async function weather(options = {}) {
  if (weatherRunning) return;
  weatherRunning = true;
  try {
    logEvent('weather', S.screen === 'home' ? 'Weather check running' : 'Weather command preview running', options.reason || '');
    const { settings, data } = await fetchWeatherResult();
    await applyWeatherResult(data, settings, { announce: options.announce !== false });
    if (S.screen === 'home') await pushState(`Receiver weather check logged. ${S.lightningClearAt > Date.now() ? lightningRemainingText() : ''}`, { render: false });
    else localSave();
  } catch (error) {
    S.weather = `Weather check failed: ${error.message}`;
    S.weatherCheckedAt = stamp();
    setFeedback(`Weather check failed: ${error.message}`, false);
    if (S.screen === 'home') await pushState('Receiver weather failure logged.', { render: false });
    else localSave();
  } finally {
    weatherRunning = false;
    renderWhenIdle();
  }
}

async function triggerWeatherCheck() {
  if (S.screen !== 'home') {
    await issueCommand('weather-check', { label: 'Weather check', detail: 'Manual weather check requested from command.' }, 'Weather check command sent to all active receivers.');
    await weather({ announce: false, reason: 'command preview' });
    return;
  }
  await weather({ announce: true, reason: 'manual receiver check' });
}

function weatherMonitor() {
  if (S.weatherAuto && S.screen === 'home' && !speaking) weather({ announce: true, reason: '5 minute auto scan' });
}

async function geocode() {
  S.address = val('address') || S.address;
  try {
    const response = await fetch(API.geo + encodeURIComponent(S.address));
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw Error(data.error || `Geocode HTTP ${response.status}`);
    S.lat = String(data.latitude);
    S.lon = String(data.longitude);
    await save(`Location verified: ${data.matchedAddress || S.address}`);
  } catch (error) {
    setFeedback(`Could not verify address: ${error.message}. Use Device GPS or enter coordinates.`, false);
    renderWhenIdle();
  }
}

function useGps() {
  if (!navigator.geolocation) {
    setFeedback('Device GPS is not available in this browser.', false);
    return;
  }
  setFeedback('Requesting device GPS permission...', true);
  navigator.geolocation.getCurrentPosition(async position => {
    S.lat = position.coords.latitude.toFixed(6);
    S.lon = position.coords.longitude.toFixed(6);
    await save(`Device GPS filled: ${S.lat}, ${S.lon} (accuracy about ${Math.round(position.coords.accuracy || 0)}m).`);
  }, error => setFeedback(`Device GPS failed: ${error.message}`, false), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

async function checkVoiceHealth() {
  try {
    const response = await fetch(API.voiceHealth, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw Error(data.error || `Voice health HTTP ${response.status}`);
    S.voiceHealth = data.note || 'Voice health checked.';
    setFeedback(S.voiceHealth, true);
    logEvent('voice', 'Voice health check', S.voiceHealth);
  } catch (error) {
    S.voiceHealth = `Voice health check failed: ${error.message}`;
    setFeedback(S.voiceHealth, false);
  }
  await save('Voice health saved.');
}

async function save(message = 'Saved.') {
  localSave();
  await pushState(message);
}

function logRows(limit = 60) {
  const clearedAt = Number(storageGet(LOG_CLEAR_KEY) || 0);
  const rows = mergeById(LOG_LIMIT, true, S.activityLog).filter(row => Number(row.ts || 0) > clearedAt).slice(0, limit);
  return rows.map(row => `<div class="logRow ${esc(row.kind || '')}"><div><b>${esc(row.title || row.kind || 'Event')}</b><span>${esc(row.detail || '')}</span></div><small>${esc(row.time || '')}<br>${esc(row.device || '')}</small></div>`).join('') || '<p class="muted">No receiver activity is shown on this device.</p>';
}

function receiverReadiness() {
  if (S.screen !== 'home') return 'Command only; receiver screens play sound.';
  if (!receiverSessionStartedAt()) return 'Tap Start Receiver + Play Spotify.';
  if (!receiverAudioReady()) return 'Tap Start Receiver + Play Spotify on this speaker phone.';
  if (!spotifyLoggedIn()) return 'Spotify login needed on receiver.';
  if (S.spotifyAccountProduct && S.spotifyAccountProduct !== 'premium') return `Spotify Premium needed: ${S.spotifyAccountProduct}.`;
  if (!spotifyDeviceReady()) return 'Tap Start Receiver + Play Spotify on this phone.';
  if (spotifyPlayerReady && spotifyWebDeviceId) return `Ready: ${S.spotifyDeviceName || 'Poolside Pulse receiver'}.`;
  return `Ready: ${S.spotifyDeviceName || 'active Spotify device'}.`;
}

function spotifyDeviceReady() {
  if (S.screen === 'home') {
    const recentlyReady = !!S.spotifyDeviceId && Date.now() - Number(S.spotifyReceiverReadyAt || 0) < 10 * 60 * 1000;
    return ((spotifyPlayerReady && !!spotifyWebDeviceId) || recentlyReady) && !S.spotifyNeedsTap;
  }
  return (((spotifyPlayerReady && !!spotifyWebDeviceId) || !!S.spotifyDeviceId) && !S.spotifyNeedsTap);
}

function receiverCanPause() {
  if (S.intent !== 'playing' || !receiverAudioReady()) return false;
  return spotifyDeviceReady();
}

function header() {
  return `<header class="top"><div class="brand"><div class="brandMark">L123</div><div class="brandText"><b>Lake123</b><small>Poolside Pulse · V18</small></div></div><nav class="modeSwitch"><button id="home" class="${S.screen === 'home' ? 'on' : ''}" aria-pressed="${S.screen === 'home'}">Home</button><button id="cmd" class="${S.screen !== 'home' ? 'on' : ''}" aria-pressed="${S.screen !== 'home'}">Command</button></nav></header>`;
}

function nav() {
  const tabs = [
    ['command', 'Command'],
    ['music', 'Music'],
    ['party', 'Party'],
    ['schedule', 'Schedule'],
    ['weather', 'Weather'],
    ['voice', 'Voice'],
    ['hours', 'Hours']
  ];
  return `<nav class="tabs">${tabs.map(([id, label]) => `<button data-tab="${id}" class="${S.tab === id ? 'on' : ''}" aria-pressed="${S.tab === id}">${label}</button>`).join('')}</nav>`;
}

function shell(body) {
  const error = visibleLastError();
  const syncClass = S.sync ? 'good' : 'warn';
  const notice = S.setupNotice ? `<div class="actionNotice"><b>Receiver action:</b> ${esc(S.setupNotice)}</div>` : '';
  return `${header()}<main class="wrap commandWrap"><div class="topStatus">Command Center · Version ${VERSION} · <span class="pill ${syncClass}">${esc(S.sync ? 'Sync active' : 'Preview sync')}</span> · ${esc(S.syncMode || '')} · ${esc(deviceLabel())}</div>${nav()}<div id="feedbackBox" class="statusBar"><b>Status:</b> ${esc(S.feedback || 'Ready.')}</div>${notice}${error ? `<div class="alert warn"><b>Last Error:</b> ${esc(error)}</div>` : ''}${body}</main>`;
}

function login() {
  return `${header()}<main class="wrap"><section class="login"><p class="eyebrow">Command Login</p><h1>Command</h1><p>Enter the shared command PIN to control active receivers.</p><label>PIN<input id="pin" inputmode="numeric" type="password" autocomplete="one-time-code"></label><button id="login">Unlock Command</button><p class="muted">${esc(S.feedback || '')}</p></section></main>`;
}

function statusCards() {
  const startedAt = receiverSessionStartedAt() || Number(S.receiverActiveAt || 0) || Date.now();
  const inbox = S.screen === 'home'
    ? recentEvents(S.events).filter(shouldProcessEvent).length
    : recentEvents(S.events).filter(event => eventTime(event) >= startedAt - RECEIVER_EVENT_GRACE_MS).length;
  return `<div class="stats"><div class="stat"><b>Spotify Bed</b><strong>${esc(sourceLabel('spotify', activeProviderUrl()))}</strong></div><div class="stat"><b>Receiver</b><strong>${esc(S.screen === 'home' ? receiverReadiness() : (S.receiverStatus || 'No receiver report yet.'))}</strong></div><div class="stat"><b>Remote</b><strong>Event inbox ${inbox}</strong></div><div class="stat"><b>Announcements</b><strong>${Math.round(Number(S.announcementGain || 1) * 100)}% / music ${esc(S.spotifyDuckedVolume)}%</strong></div></div>`;
}

function readinessSteps() {
  const audioOk = receiverAudioReady();
  const sessionOk = receiverSessionStartedAt() > 0;
  const receiverOk = audioOk && sessionOk;
  const spotifyOk = spotifyLoggedIn();
  const musicOk = spotifyDeviceReady() && S.intent === 'playing';
  const steps = [
    { label: 'Activate Receiver', ok: receiverOk, action: 'audio', help: 'Tap once on the speaker phone to unlock iPhone audio.' },
    { label: 'Connect Spotify', ok: spotifyOk, action: 'login', help: 'Tap to connect Spotify on this receiver.' },
    { label: 'Play Spotify', ok: musicOk, action: 'spotify', help: 'Tap to start the Spotify bed music.' }
  ];
  return `<div class="steps numbered">${steps.map((step, index) => {
    const inner = `<span>${step.ok ? 'OK' : 'TODO'}</span><strong>${esc(step.label)}</strong>${step.ok ? '' : `<small>${esc(step.help)}</small>`}`;
    return step.ok || !step.action
      ? `<div class="step done"><em>${index + 1}</em>${inner}</div>`
      : `<button type="button" class="step todo stepButton" data-ready-action="${esc(step.action)}"><em>${index + 1}</em>${inner}</button>`;
  }).join('')}</div>`;
}

function receiverActionButtons() {
  const audioOk = receiverAudioReady();
  const needsLogin = !spotifyLoggedIn();
  const needsStart = !audioOk || !receiverSessionStartedAt() || !spotifyDeviceReady();
  const label = needsStart ? 'Start Receiver + Play Spotify' : 'Play / Resume Spotify';
  const primary = audioOk && needsLogin
    ? '<button id="spotifyLoginHome" class="primaryWide">Login Spotify on This Receiver</button>'
    : `<button id="playHome" class="primaryWide">${esc(label)}</button>`;
  return `<div class="receiverActions">${primary}<button id="testToneHome" class="secondary">Test Tone</button><button id="checkWeatherHome" class="secondary">Check Weather</button><button id="skipHome" class="secondary">Skip</button><button id="stopHome" class="secondary">Stop</button></div>`;
}

function receiverNotice() {
  let message = '';
  if (!receiverSessionStartedAt() || !receiverAudioReady()) message = 'Tap the big Start Receiver + Play Spotify button. That one tap starts a fresh receiver session, ignores old commands, and unlocks iPhone audio.';
  else if (!spotifyLoggedIn()) message = 'Tap Login Spotify on This Receiver. Spotify must be connected on the speaker phone.';
  else if (!spotifyDeviceReady() || S.intent !== 'playing') message = 'Tap Start Receiver + Play Spotify. The Home phone should begin the quieter Spotify bed music.';
  else if (manualMusicHoldActive()) message = `${S.manualMusicHoldReason || 'Music stopped manually'}. Auto-start will stay off until the next Play command or pool opening cycle.`;
  else message = S.setupNotice || '';
  return message ? `<div class="actionNotice"><b>Next step:</b> ${esc(message)}</div>` : '';
}

function homePage() {
  const current = track();
  const activeMode = scheduleMode(S.activeSchedule);
  const next = scheduleItems(activeMode).filter(item => item.enabled).sort((a, b) => mins(schedTime(a)) - mins(schedTime(b))).slice(0, 5)
    .map(item => `<p class="line"><b>${pretty(schedTime(item))}</b><span>${esc(item.label)}</span></p>`).join('');
  const label = sourceLabel('spotify', activeProviderUrl());
  const error = visibleLastError();
  const live = receiverCanPause();
  return `${header()}<main class="home console"><section class="receiverConsole"><div class="receiverLead"><p class="eyebrow">Home Receiver · V18</p><h1>Sound Station</h1><p>This phone stays on Home and plays the quiet Spotify bed music, voice announcements, Suno cues, scheduled audio, and weather safety messages through the speakers.</p>${receiverActionButtons()}${receiverNotice()}${error ? `<div class="alert warn">${esc(error)}</div>` : ''}</div><aside class="setupPanel"><h2>Receiver Readiness</h2>${readinessSteps()}<div class="miniFacts"><b>Spotify:</b> ${esc(label)}<br><b>Schedule:</b> ${esc(scheduleTitle(activeMode))}<br><b>Status:</b> ${esc(receiverReadiness())}<br><b>Audio:</b> ${esc(S.audioStatus)}</div></aside></section><section class="nowCompact"><div><p class="eyebrow">${live ? 'Now Playing' : S.intent === 'paused' ? 'Paused' : 'Ready'}</p><h2>${esc(S.spotifyNowPlaying || 'Spotify Receiver')}</h2><p>${esc(compactUrl(S.spotifyUrl))}</p><p class="muted">${esc(S.activeMusicLabel || label)}</p></div><div class="signal ${live ? 'live' : ''}"><span></span><span></span><span></span></div></section><section class="cards"><div class="card"><h3>Next Scheduled · ${esc(scheduleTitle(activeMode))}</h3>${next || '<p class="muted">No enabled schedule items.</p>'}</div><div class="card"><h3>Recent Receiver Log</h3>${logRows(5)}</div></section></main>`;
}

function commandPage() {
  const selected = ann();
  return shell(`<section class="commandConsole"><div><p class="eyebrow">Live Control</p><h1>Command</h1><p>Command devices send instructions to every active receiver. Speaker phones stay on Home and play all sound.</p></div>${statusCards()}</section><section class="panel controlDeck"><div class="sectionHead"><h2>Receiver Controls</h2><span class="pill ${S.receiverStatus && !receiverActionNeeded(S.receiverStatus) ? 'good' : 'warn'}">${esc(S.receiverStatus || 'No receiver report yet')}</span></div><div class="bigControls"><button id="playCmd">Play / Resume</button><button id="pauseCmd" class="secondary">Pause</button><button id="skipCmd" class="secondary">Skip</button><button id="stopCmd" class="danger">Stop</button><button id="checkWeatherCmd" class="secondary">Check Weather</button></div><div class="volumeStrip"><label><span>Spotify Volume <output id="spotifyVolumeCommandOut">${esc(S.spotifyVolume)}%</output></span><input id="spotifyVolumeCommand" type="range" min="0" max="100" step="1" value="${esc(S.spotifyVolume)}"></label><button id="spotifyVolumeApply" class="secondary">Set Volume on Receivers</button><small>Announcements keep their separate loud boost.</small></div><div class="quickMusic"><label>Play Spotify or Suno Cue URL<input id="quickMusicUrl" value="${esc(S.quickMusicUrl || activeProviderUrl())}" placeholder="Paste Spotify, Suno, or direct audio URL"></label><div class="buttonStack"><button id="playAnyUrl">Play Pasted URL</button><button id="playDefaultSpotify" class="secondary">Default Spotify</button><button id="playDefaultSuno" class="secondary">Saved Suno Cue</button></div></div><div class="splitControls"><label>Announcement<textarea id="quickText">${esc(S.quickText || selected.text)}</textarea></label><div><label>Saved Announcement<select id="quickTemplate">${S.anns.map(item => `<option value="${item.id}" ${item.id === S.selected ? 'selected' : ''}>${esc(item.label)} · ${item.mode === 'suno' ? 'Suno' : 'Voice'}</option>`).join('')}</select></label><div class="buttonStack"><button id="quickPlay">${selected.mode === 'suno' ? 'Play Announcement Track' : 'Speak Now'}</button><button id="quickHold" class="secondary">${selected.mode === 'suno' ? 'Track as Safety Hold' : 'Speak as Safety Hold'}</button><button id="lightningNow" class="secondary">Lightning Hold</button><button id="windNow" class="secondary">Wind Umbrellas</button></div></div></div></section><section class="panel compactLog"><div class="sectionHead"><h2>Receiver Activity</h2><button id="clearLog" class="secondary">Clear Local Log</button></div>${logRows()}</section>`);
}

function spotifyDiagnostics() {
  const login = spotifyLoggedIn() ? 'Logged in on this browser' : 'Not logged in on this browser';
  const product = S.spotifyAccountProduct ? `Account: ${S.spotifyAccountProduct}` : 'Account: not checked';
  return `<div class="statusBar"><b>Spotify:</b> ${esc(login)}<br><b>Status:</b> ${esc(S.spotifyStatus || 'Not checked yet.')}<br><b>${esc(product)}</b><br><b>${esc(S.spotifyDevicesSummary || 'Devices: not checked')}</b><br><b>Redirect URI:</b> <code>${esc(spotifyRedirectUri())}</code>${S.spotifyLastError ? `<br><b>Last Spotify issue:</b> ${esc(S.spotifyLastError)}` : ''}</div>`;
}

function musicPage() {
  const providers = Object.entries(PROVIDERS).map(([id, label]) => `<option value="${id}" ${S.musicProvider === id ? 'selected' : ''}>${label}</option>`).join('');
  const rows = S.tracks.map((item, index) => `<div class="trackRow ${index === S.current ? 'cur' : ''}"><div><b>${index + 1}. ${esc(item.title)}</b><span>${esc(item.artist || 'Suno')} · ${esc(item.duration || '')} · ${item.audioUrl ? 'ready' : 'title only'}</span></div><div class="rowBtns"><button data-song="${index}" class="slim">Play</button><button data-schedule-song="${index}" class="secondary slim">Schedule</button></div></div>`).join('');
  return shell(`<section class="panel"><div class="panelHeader"><div><p class="eyebrow">Music Control</p><h1>Music</h1></div><button id="saveMusic">Save</button></div><div class="sourceBoard"><div class="sourceTile"><b>Selected</b><strong>${esc(sourceLabel(S.musicProvider, activeProviderUrl()))}</strong><span>${esc(activeProviderUrl())}</span></div><div class="sourceTile"><b>Receiver</b><strong>${esc(S.receiverStatus || receiverReadiness())}</strong><span>${esc(S.spotifyNowPlaying || S.activeMusicLabel || '')}</span></div><div class="sourceTile"><b>Voice Ducking</b><strong>${esc(S.spotifyDuckedVolume)}% Spotify</strong><span>${Math.round(Number(S.announcementGain || 1) * 100)}% announcement boost</span></div></div><div class="buttonStack"><button id="useSpotify" class="${S.musicProvider === 'spotify' ? '' : 'secondary'}">Use Spotify</button><button id="useSuno" class="${S.musicProvider === 'suno' ? '' : 'secondary'}">Use Suno</button><button id="spotifyPlayNow">Play Spotify on Receivers</button><button id="sunoPlayNow" class="secondary">Play Suno on Receivers</button></div><div class="quickMusic"><label>Play Spotify or Suno Cue URL<input id="quickMusicUrl" value="${esc(S.quickMusicUrl || activeProviderUrl())}" placeholder="Paste Spotify, Suno, or direct audio URL"></label><div class="buttonStack"><button id="playAnyUrl">Play Pasted URL</button><button id="savePastedUrl" class="secondary">Save as Default</button></div></div><div class="grid2"><label>Provider<select id="musicProvider">${providers}</select></label><label>Station Name<input id="playlistName" value="${esc(S.playlistName)}"></label></div><div class="grid2"><label>Suno Track, Playlist, or Audio URL<input id="playlistUrl" value="${esc(S.playlistUrl)}"></label><label>Spotify Playlist or Song URL<input id="spotifyUrl" value="${esc(S.spotifyUrl)}" placeholder="https://open.spotify.com/playlist/..."></label></div><div class="grid2"><label>Spotify Client ID<input id="spotifyClientId" value="${esc(S.spotifyClientId)}"></label><label>Spotify Redirect URI<input id="spotifyRedirectUri" value="${esc(spotifyRedirectUri())}"></label></div><div class="grid4"><label><span>Spotify Volume <output id="spotifyVolumeOut">${esc(S.spotifyVolume)}%</output></span><input id="spotifyVolume" type="range" min="0" max="100" step="1" value="${esc(S.spotifyVolume)}"></label><label><span>Music During Announcements <output id="spotifyDuckedVolumeOut">${esc(S.spotifyDuckedVolume)}%</output></span><input id="spotifyDuckedVolume" type="range" min="0" max="20" step="1" value="${esc(S.spotifyDuckedVolume)}"></label><label><span>Suno Volume <output id="sunoVolumeOut">${esc(S.sunoVolume)}%</output></span><input id="sunoVolume" type="range" min="0" max="100" step="1" value="${esc(S.sunoVolume)}"></label><label><span>Announcement Boost <output id="announcementGainOut">${Math.round(Number(S.announcementGain || 1) * 100)}%</output></span><input id="announcementGain" type="range" min="1" max="3.4" step=".05" value="${esc(S.announcementGain)}"></label></div>${spotifyDiagnostics()}<div class="actions"><button id="spotifyLogin" class="secondary">Login with Spotify</button><button id="spotifyCheck" class="secondary">Check Spotify</button><button id="spotifyReceiver">Start Receiver + Play Spotify</button><button id="makeReceiver" class="secondary">Show Receiver Screen</button><button id="spotifyClear" class="secondary">Clear Spotify</button><button id="import" class="secondary">Load Suno URL</button></div></section><section class="panel"><div class="sectionHead"><h2>Suno Queue</h2><button id="playCmd" class="secondary">Play Selected on Receivers</button></div>${rows || '<p class="muted">No Suno queue imported yet.</p>'}</section>`);
}

function musicPageV18() {
  const sunoReady = String(S.playlistUrl || '').trim();
  return shell(`<section class="panel"><div class="panelHeader"><div><p class="eyebrow">Music Control</p><h1>Music</h1></div><button id="saveMusic">Save</button></div><div class="sourceBoard"><div class="sourceTile"><b>Spotify Bed</b><strong>${esc(sourceLabel('spotify', activeProviderUrl()))}</strong><span>${esc(S.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST)}</span></div><div class="sourceTile"><b>Suno Cue</b><strong>${esc(sunoReady ? sourceLabel('suno', S.playlistUrl) : 'No saved cue')}</strong><span>${esc(sunoReady ? S.playlistUrl : 'Paste a Suno song, playlist, or direct audio URL below.')}</span></div><div class="sourceTile"><b>Ducking</b><strong>${esc(S.spotifyDuckedVolume)}% Spotify during cues</strong><span>${Math.round(Number(S.announcementGain || 1) * 100)}% voice announcements</span></div></div><div class="buttonStack"><button id="spotifyPlayNow">Play Spotify on Receivers</button><button id="sunoPlayNow" class="secondary">Play Saved Suno Cue</button></div><div class="quickMusic"><label>Play Spotify or Suno Cue URL<input id="quickMusicUrl" value="${esc(S.quickMusicUrl || S.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST)}" placeholder="Paste Spotify, Suno, or direct audio URL"></label><div class="buttonStack"><button id="playAnyUrl">Play Pasted URL</button><button id="savePastedUrl" class="secondary">Save URL</button></div></div><div class="grid2"><label>Station Name<input id="playlistName" value="${esc(S.playlistName)}"></label><label>Spotify Playlist or Track URL<input id="spotifyUrl" value="${esc(S.spotifyUrl)}" placeholder="https://open.spotify.com/playlist/..."></label></div><label>Saved Suno Cue URL<input id="playlistUrl" value="${esc(S.playlistUrl)}" placeholder="Paste a Suno song, playlist, or direct audio URL"></label><div class="grid2"><label>Spotify Client ID<input id="spotifyClientId" value="${esc(S.spotifyClientId)}"></label><label>Spotify Redirect URI<input id="spotifyRedirectUri" value="${esc(spotifyRedirectUri())}"></label></div><div class="grid4"><label><span>Spotify Volume <output id="spotifyVolumeOut">${esc(S.spotifyVolume)}%</output></span><input id="spotifyVolume" type="range" min="0" max="100" step="1" value="${esc(S.spotifyVolume)}"></label><label><span>Music During Announcements <output id="spotifyDuckedVolumeOut">${esc(S.spotifyDuckedVolume)}%</output></span><input id="spotifyDuckedVolume" type="range" min="0" max="20" step="1" value="${esc(S.spotifyDuckedVolume)}"></label><label><span>Suno Cue Volume <output id="sunoVolumeOut">${esc(S.sunoVolume)}%</output></span><input id="sunoVolume" type="range" min="0" max="100" step="1" value="${esc(S.sunoVolume)}"></label><label><span>Announcement Boost <output id="announcementGainOut">${Math.round(Number(S.announcementGain || 1) * 100)}%</output></span><input id="announcementGain" type="range" min="1" max="3.4" step=".05" value="${esc(S.announcementGain)}"></label></div>${spotifyDiagnostics()}<div class="actions"><button id="spotifyLogin" class="secondary">Login with Spotify</button><button id="spotifyCheck" class="secondary">Check Spotify</button><button id="spotifyClear" class="secondary">Clear Spotify</button><button id="import" class="secondary">Check Suno URL</button></div></section>`);
}

function scheduleBodyLabel(kind) {
  return ({
    text: 'Spoken Text',
    sunoAnnouncement: 'Suno Announcement URL',
    song: 'Suno Music URL',
    suno: 'Suno Track or Playlist URL',
    spotify: 'Spotify Track, Playlist, Album, or Artist URL'
  })[kind] || 'Text or URL';
}

function scheduleBodyPlaceholder(kind) {
  return ({
    text: 'Type the announcement to speak on all active receivers.',
    sunoAnnouncement: 'Paste a Suno song URL or direct audio URL to play loudly as an announcement.',
    song: 'Paste a Suno song, playlist, or direct audio URL to play as music.',
    suno: 'Paste a Suno song, playlist, or direct audio URL.',
    spotify: 'Paste a Spotify track, playlist, album, or artist URL.'
  })[kind] || '';
}

function scheduleBodyValue(item) {
  if (!item) return '';
  if (item.type === 'text') return item.text || '';
  if (['sunoAnnouncement', 'song', 'suno', 'spotify'].includes(item.type)) return item.url || '';
  return '';
}

function scheduleEditor(item, index, mode, annOptions) {
  const key = scheduleFieldKey(mode, index);
  const kind = item.type || 'text';
  const typeOptions = [
    ['announcement', 'Saved announcement'],
    ['text', 'Spoken text'],
    ['sunoAnnouncement', 'Suno announcement URL'],
    ['song', 'Suno music URL'],
    ['suno', 'Suno URL'],
    ['spotify', 'Spotify URL']
  ].map(([value, label]) => `<option value="${value}" ${kind === value ? 'selected' : ''}>${esc(label)}</option>`).join('');
  const body = ['text', 'sunoAnnouncement', 'song', 'suno', 'spotify'].includes(kind)
    ? `<label>${scheduleBodyLabel(kind)}<textarea data-body="${key}" data-row-index="${index}" data-schedule-mode="${scheduleMode(mode)}" placeholder="${esc(scheduleBodyPlaceholder(kind))}">${esc(scheduleBodyValue(item))}</textarea></label>`
    : '';
  const saved = kind === 'announcement'
    ? `<label>Saved Announcement<select data-selann="${key}" data-row-index="${index}" data-schedule-mode="${scheduleMode(mode)}">${annOptions}</select></label>`
    : '';
  return `<div class="editBox"><div class="grid3"><label>Time<input data-row-time="${key}" data-row-index="${index}" data-schedule-mode="${scheduleMode(mode)}" type="time" value="${schedTime(item)}"></label><label>Type<select data-kind="${key}" data-kind-row="${index}" data-schedule-mode="${scheduleMode(mode)}">${typeOptions}</select></label><label>Label<input data-label="${key}" data-row-index="${index}" data-schedule-mode="${scheduleMode(mode)}" value="${esc(item.label)}"></label></div>${body}${saved}<button data-save-row="${index}" data-schedule-mode="${scheduleMode(mode)}">Save Item</button></div>`;
}

function schedulePage(mode = 'daily') {
  const activeMode = scheduleMode(mode);
  const items = scheduleItems(activeMode);
  const annOptionsFor = selected => S.anns.map(item => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${esc(item.label)}</option>`).join('');
  const rows = items.map((item, index) => ({ item, index }))
    .sort((a, b) => mins(schedTime(a.item)) - mins(schedTime(b.item)))
    .map(({ item, index }) => {
      const active = S.editId === item.id;
      const kind = item.type || 'text';
      const edit = active ? scheduleEditor(item, index, activeMode, annOptionsFor(item.announcementId || S.selected)) : '';
      return `<div class="scheduleRow ${item.enabled ? '' : 'off'} ${active ? 'editing' : ''}"><div><b>${pretty(schedTime(item))} · ${esc(item.label)}</b><span>${item.enabled ? 'enabled' : 'off'} · ${esc(kind)}</span><p>${esc(tokens(itemBody(item)))}</p>${edit}</div><div class="rowBtns"><button data-play-row="${index}" data-schedule-mode="${activeMode}" class="slim">Play</button><button data-edit="${index}" data-schedule-mode="${activeMode}" class="secondary slim">${active ? 'Close' : 'Edit'}</button><button data-toggle="${index}" data-schedule-mode="${activeMode}" class="secondary slim">${item.enabled ? 'Off' : 'On'}</button><button data-delete="${index}" data-schedule-mode="${activeMode}" class="secondary slim">Delete</button></div></div>`;
    }).join('');
  const active = S.activeSchedule === activeMode;
  const eyebrow = activeMode === 'party' ? 'Party Automation' : 'Daily Automation';
  const copy = activeMode === 'party'
    ? 'Party schedule uses the same controls as the daily schedule. Turn it on when you want party cues to replace the normal pool schedule.'
    : 'Daily schedule runs by default during pool hours unless the party schedule is active.';
  return shell(`<section class="panel"><div class="panelHeader"><div><p class="eyebrow">${eyebrow}</p><h1>${scheduleTitle(activeMode)}</h1></div><div class="actions tight"><button data-activate-schedule="${activeMode}" class="${active ? '' : 'secondary'}">${active ? 'Using This Schedule' : 'Use This Schedule'}</button><button data-add-sched="${activeMode}" class="secondary">Add Item</button></div></div><p>${copy}</p><div class="statusBar"><b>Active schedule:</b> ${esc(scheduleTitle(S.activeSchedule))}</div>${rows || '<p class="muted">No enabled schedule items.</p>'}</section>`);
}

function weatherPage() {
  return shell(`<section class="panel"><div class="panelHeader"><div><p class="eyebrow">Safety Automation</p><h1>Weather</h1></div><button id="checkWeather">Check Weather</button></div><label>Address<input id="address" value="${esc(S.address)}"></label><div class="actions"><button id="verify" class="secondary">Verify Address</button><button id="gps" class="secondary">Use Device GPS</button></div><div class="grid3"><label>Latitude<input id="lat" value="${esc(S.lat)}"></label><label>Longitude<input id="lon" value="${esc(S.lon)}"></label><label>Weather Radius Miles<input id="radius" value="${esc(S.radius)}"></label></div><div class="grid3"><label>Lightning Radius Miles<input id="lightningRadiusMiles" value="${esc(S.lightningRadiusMiles)}"></label><label>Lightning Hold Minutes<input id="lightningHoldMinutes" value="${esc(S.lightningHoldMinutes)}"></label><label>Strong Wind Alert MPH<input id="windGustMph" inputmode="numeric" value="${esc(S.windGustMph)}"></label></div><label>Auto Scan<select id="weatherAuto"><option value="true" ${S.weatherAuto ? 'selected' : ''}>Every 5 minutes on active receivers</option><option value="false" ${!S.weatherAuto ? 'selected' : ''}>Manual only</option></select></label><label>Lightning Announcement<textarea id="lightningText">${esc(S.lightningText)}</textarea></label><label>Strong Wind Announcement<textarea id="windText">${esc(S.windText)}</textarea></label><label>Lightning All Clear Announcement<textarea id="lightningClearText">${esc(S.lightningClearText)}</textarea></label><div class="actions"><button id="saveLoc">Save Weather Settings</button></div><div class="statusBar"><b>Weather:</b> ${esc(S.weather)}<br><b>${esc(S.weatherCheckedAt ? `Last checked ${S.weatherCheckedAt}` : 'Not checked yet')}</b><br><b>Lightning:</b> ${esc(lightningRemainingText())}</div></section>`);
}

function announcementEditor() {
  const selected = ann();
  return `<section class="panel announcementEditor"><div class="panelHeader"><div><p class="eyebrow">Saved Announcements</p><h2>Announcement Library</h2></div><button id="testSavedAnnouncement" class="secondary">Test Selected</button></div><div class="grid2"><label>Template<select id="annSelect">${S.anns.map(item => `<option value="${item.id}" ${item.id === selected.id ? 'selected' : ''}>${esc(item.label)} · ${item.mode === 'suno' ? 'Suno' : 'Voice'}</option>`).join('')}</select></label><label>Delivery<select id="annMode"><option value="voice" ${selected.mode !== 'suno' ? 'selected' : ''}>Voice announcement</option><option value="suno" ${selected.mode === 'suno' ? 'selected' : ''}>Suno track announcement</option></select></label></div><label>Label<input id="annLabel" value="${esc(selected.label)}"></label><label>Voice Text<textarea id="annText">${esc(selected.text)}</textarea></label><label>Suno Track<select id="annTrack">${trackOptions(selected.trackIndex)}</select></label><div class="actions"><button id="saveAnnouncement">Save Announcement</button></div></section>`;
}

function voicePage() {
  const voiceOptions = bestVoices().map(voice => `<option value="${esc(voice.name)}" ${voice.name === S.deviceVoice ? 'selected' : ''}>${esc(voice.name)} · ${esc(voice.lang)}</option>`).join('');
  const receiverAudio = S.screen === 'home'
    ? S.audioStatus
    : (S.receiverStatus || 'Command devices send voice events; the Home receiver plays them.');
  return shell(`<section class="panel"><div class="panelHeader"><div><p class="eyebrow">Announcement Audio</p><h1>Voice</h1></div><button id="voiceHealth" class="secondary">Check Voice</button></div><div class="statusBar"><b>Voice health:</b> ${esc(S.voiceHealth)}<br><b>Receiver audio:</b> ${esc(receiverAudio)}<br><b>Current boost:</b> ${Math.round(Number(S.announcementGain || 1) * 100)}%</div><div class="grid2"><label>Voice Mode<select id="voiceMode"><option value="ai" ${S.voiceMode === 'ai' ? 'selected' : ''}>AI first, device fallback</option><option value="device" ${S.voiceMode === 'device' ? 'selected' : ''}>Device only</option></select></label><label>AI Voice<select id="aiVoice"><option value="marin" ${S.aiVoice === 'marin' ? 'selected' : ''}>Marin</option><option value="cedar" ${S.aiVoice === 'cedar' ? 'selected' : ''}>Cedar</option><option value="coral" ${S.aiVoice === 'coral' ? 'selected' : ''}>Coral</option><option value="nova" ${S.aiVoice === 'nova' ? 'selected' : ''}>Nova</option><option value="sage" ${S.aiVoice === 'sage' ? 'selected' : ''}>Sage</option><option value="shimmer" ${S.aiVoice === 'shimmer' ? 'selected' : ''}>Shimmer</option><option value="onyx" ${S.aiVoice === 'onyx' ? 'selected' : ''}>Onyx</option></select></label></div><label>Device Voice<select id="deviceVoice"><option value="">Best available</option>${voiceOptions}</select></label><div class="grid3"><label><span>AI Announcement Boost <output id="announcementGainOut">${Math.round(Number(S.announcementGain || 1) * 100)}%</output></span><input id="announcementGain" type="range" min="1" max="3.4" step=".05" value="${esc(S.announcementGain)}"></label><label><span>Speed <output id="rateOut">${esc(S.rate)}</output></span><input id="rate" type="range" min=".75" max="1.15" step=".01" value="${esc(S.rate)}"></label><label><span>Pitch <output id="pitchOut">${esc(S.pitch)}</output></span><input id="pitch" type="range" min=".85" max="1.15" step=".01" value="${esc(S.pitch)}"></label></div><div class="actions"><button id="saveVoice">Save Voice</button><button id="testVoice" class="secondary">Send Voice Test</button><button id="testDevice" class="secondary">Send Device Voice Test</button></div></section>${announcementEditor()}`);
}

function hoursPage() {
  return shell(`<section class="panel"><div class="panelHeader"><div><p class="eyebrow">Station Rules</p><h1>Hours</h1></div><button id="saveHours">Save</button></div><div class="grid2"><label>Music Mode<select id="playbackMode"><option value="always" ${S.playbackMode === 'always' ? 'selected' : ''}>Always play unless paused</option><option value="hours" ${S.playbackMode === 'hours' ? 'selected' : ''}>Follow pool hours</option></select></label><label>Auto Start<select id="autoStart"><option value="true" ${S.autoStart ? 'selected' : ''}>Yes</option><option value="false" ${!S.autoStart ? 'selected' : ''}>No</option></select></label></div><div class="grid2"><label>Pool Opens<input id="poolOpen" type="time" value="${esc(S.poolOpen)}"></label><label>Pool Closes<input id="poolClose" type="time" value="${esc(S.poolClose)}"></label></div><label>Auto Stop<select id="autoStop"><option value="true" ${S.autoStop ? 'selected' : ''}>Yes, stop at closing when following pool hours</option><option value="false" ${!S.autoStop ? 'selected' : ''}>No</option></select></label></section>`);
}

function render() {
  try {
    document.title = `Lake123 - Poolside Pulse - Version ${VERSION}`;
    const app = $('app');
    app.dataset.version = VERSION;
    app.innerHTML = S.screen === 'home'
      ? homePage()
      : !S.admin
        ? login()
        : ({ command: commandPage, music: musicPageV18, party: () => schedulePage('party'), schedule: () => schedulePage('daily'), weather: weatherPage, voice: voicePage, hours: hoursPage }[S.tab] || commandPage)();
    bind();
  } catch (error) {
    $('app').innerHTML = `<main class="wrap"><section class="panel"><h1>Poolside Pulse V${VERSION}</h1><div class="alert bad"><b>Recovered from runtime error:</b> ${esc(error.message)}</div><button onclick="location.reload()">Reload app</button></section></main>`;
  }
}

function wire(id, fn) {
  const el = $(id);
  if (!el) return;
  el.onclick = () => {
    el.classList.add('busy');
    el.setAttribute('aria-busy', 'true');
    el.setAttribute('data-clicked-at', String(Date.now()));
    return Promise.resolve(fn()).catch(error => {
      if (isActionNeeded(error)) setActionNeeded(error.message || String(error));
      else setFeedback(error.message || String(error), false);
      renderWhenIdle();
    }).finally(() => {
      el.classList.remove('busy');
      el.removeAttribute('aria-busy');
    });
  };
}

function applyQuickTemplate() {
  const selectedId = val('quickTemplate') || S.selected;
  const item = S.anns.find(annItem => annItem.id === selectedId);
  if (!item) return;
  S.selected = item.id;
  S.quickText = item.text;
  const box = $('quickText');
  if (box) box.value = item.text;
  localSave();
}

async function handleReadinessAction(action) {
  if (action === 'login') {
    await spotifyLogin();
    return;
  }
  if (action === 'sync') {
    await pushState('KV sync refreshed from receiver.');
    await pullState();
    return;
  }
  if (action === 'audio') {
    await ensureReceiverAudio('readiness audio tap', { required: true, startSession: true, userGesture: true, testTone: true });
    setFeedback('Receiver audio is unlocked on this phone.', true);
    await pushState('Receiver audio activation logged.', { render: false });
    renderWhenIdle();
    return;
  }
  if (action === 'spotify') {
    await beginSpotifyTapActivation();
    await playSpotifyUrl(S.spotifyUrl, false, { fromTap: true });
  }
}

function bindDraftControls() {
  for (const id of formDraftIds()) {
    const el = $(id);
    if (!el) continue;
    const update = () => updateFormDraftField(id, el.value);
    el.addEventListener('input', update);
    el.addEventListener('change', update);
  }
  document.querySelectorAll('[data-row-index][data-schedule-mode]').forEach(el => {
    const update = () => updateScheduleRowDraft(Number(el.dataset.rowIndex), el.dataset.scheduleMode);
    el.addEventListener('input', update);
    el.addEventListener('change', update);
  });
}

function bind() {
  wire('home', async () => {
    S.screen = 'home';
    localSave();
    render();
    setTimeout(warmSpotifyReceiver, 250);
  });
  wire('cmd', async () => {
    S.screen = 'command';
    localSave();
    releaseCommandReceiver('Command button');
    render();
  });
  wire('login', async () => {
    if (val('pin') === PIN) {
      S.admin = true;
      S.screen = 'command';
      S.tab = 'command';
      setFeedback('Command unlocked.', true);
      render();
    } else {
      setFeedback('Wrong PIN.', false);
    }
  });
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.onclick = () => {
      S.tab = button.dataset.tab;
      localSave();
      render();
    };
  });

  wire('playHome', async () => {
    S.musicProvider = 'spotify';
    const needsAudioUnlock = !receiverSessionStartedAt() || !receiverAudioReady();
    await beginSpotifyTapActivation();
    await ensureReceiverAudio('Home play button', { startSession: true, userGesture: true, testTone: needsAudioUnlock });
    if (!spotifyLoggedIn()) {
      setActionNeeded('Receiver audio is unlocked. Now tap Login Spotify on This Receiver.');
      renderWhenIdle();
      return;
    }
    await playSpotifyUrl(S.spotifyUrl, false, { fromTap: true });
  });
  wire('testToneHome', () => testReceiverTone('Home test tone button'));
  wire('skipHome', () => skipSelected(false));
  wire('stopHome', () => stopSelected(false));
  wire('checkWeatherHome', () => triggerWeatherCheck());
  wire('spotifyLoginHome', spotifyLogin);
  document.querySelectorAll('[data-ready-action]').forEach(button => {
    button.onclick = () => Promise.resolve(handleReadinessAction(button.dataset.readyAction)).catch(error => {
      if (isActionNeeded(error)) setActionNeeded(error.message || String(error));
      else setFeedback(error.message || String(error), false);
      renderWhenIdle();
    });
  });

  wire('playCmd', () => playSelected(true));
  wire('pauseCmd', () => pauseSelected(true));
  wire('skipCmd', () => skipSelected(true));
  wire('stopCmd', () => stopSelected(true));
  wire('checkWeatherCmd', () => triggerWeatherCheck());
  wire('spotifyVolumeApply', () => applySpotifyVolume(true));
  document.querySelectorAll('#spotifyVolumeCommand, #spotifyVolume').forEach(input => {
    input.oninput = () => {
      updateSpotifyVolumeDraft(input.value);
      scheduleSpotifyVolumeApply();
    };
    input.onchange = () => Promise.resolve(applySpotifyVolume(true)).catch(error => {
      if (isActionNeeded(error)) setActionNeeded(error.message || String(error));
      else setFeedback(error.message || String(error), false);
      renderWhenIdle();
    });
  });
  document.querySelectorAll('#spotifyDuckedVolume, #sunoVolume, #announcementGain, #rate, #pitch').forEach(input => {
    input.oninput = () => {
      updateRangeDraft(input.id, input.value);
      scheduleAudioSettingsApply();
    };
    input.onchange = () => Promise.resolve((async () => {
      updateRangeDraft(input.id, input.value);
      await applyAudioSettings(true);
    })()).catch(error => {
      if (isActionNeeded(error)) setActionNeeded(error.message || String(error));
      else setFeedback(error.message || String(error), false);
      renderWhenIdle();
    });
  });
  bindDraftControls();
  wire('playAnyUrl', () => playAnyMusicUrl(val('quickMusicUrl'), true));
  wire('playDefaultSpotify', async () => {
    S.quickMusicUrl = S.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST;
    await playAnyMusicUrl(S.quickMusicUrl, true);
  });
  wire('playDefaultSuno', async () => {
    if (!String(S.playlistUrl || DEFAULT_SUNO_PLAYLIST || '').trim()) throw Error('Paste and save a Suno URL before using Saved Suno Cue.');
    S.quickMusicUrl = S.playlistUrl || DEFAULT_SUNO_PLAYLIST;
    await playAnyMusicUrl(S.quickMusicUrl, true);
  });
  wire('savePastedUrl', async () => {
    const raw = val('quickMusicUrl').trim();
    const provider = providerFromUrl(raw);
    if (!provider) throw Error('Paste a Suno or Spotify URL before saving it as a default.');
    S.quickMusicUrl = raw;
    if (provider === 'suno') {
      S.musicProvider = 'spotify';
      S.playlistUrl = raw;
      rememberActiveSource('suno', raw, 'saved cue');
      await save('Suno cue URL saved. Spotify remains the bed music.');
      return;
    } else {
      S.musicProvider = 'spotify';
      S.spotifyUrl = raw;
    }
    rememberActiveSource(provider, raw, 'selected');
    await save(`${PROVIDERS[provider]} default saved.`);
  });

  const quickTemplate = $('quickTemplate');
  if (quickTemplate) quickTemplate.onchange = applyQuickTemplate;
  const quickText = $('quickText');
  if (quickText) quickText.oninput = () => {
    S.quickText = val('quickText');
    localSave();
  };
  wire('quickPlay', async () => {
    S.quickText = val('quickText');
    const selected = ann();
    if (selected.mode === 'suno') await playSavedAnnouncement(selected, false, selected.label || 'Suno announcement');
    else await sendAnnouncement(S.quickText, false, selected.label || 'Speak Now');
  });
  wire('quickHold', async () => {
    S.quickText = val('quickText');
    const selected = ann();
    if (selected.mode === 'suno') await playSavedAnnouncement(selected, true, selected.label || 'Safety Suno announcement');
    else await sendAnnouncement(S.quickText, true, 'Safety hold');
  });
  wire('lightningNow', () => sendAnnouncement(S.lightningText, true, 'Lightning hold'));
  wire('windNow', () => sendAnnouncement(S.windText, false, 'Wind umbrellas'));
  wire('clearLog', async () => {
    storageSet(LOG_CLEAR_KEY, String(Date.now()));
    setFeedback('Local log cleared on this device.', true);
    render();
  });

  if ($('musicProvider')) $('musicProvider').value = S.musicProvider;
  wire('saveMusic', async () => {
    readMusicSettings();
    rememberActiveSource(S.musicProvider, activeProviderUrl(), 'selected');
    await save('Music settings saved.');
    if (S.musicProvider === 'spotify') await applySpotifyVolume(true);
    await applyAudioSettings(true);
  });
  wire('useSpotify', async () => {
    readMusicSettings();
    S.musicProvider = 'spotify';
    rememberActiveSource('spotify', S.spotifyUrl, 'selected');
    await save(`Spotify selected: ${sourceLabel('spotify', S.spotifyUrl)}.`);
  });
  wire('useSuno', async () => {
    readMusicSettings();
    S.musicProvider = 'spotify';
    rememberActiveSource('spotify', S.spotifyUrl, 'selected');
    await save('V18 keeps Spotify as the bed music. Paste a Suno URL and use Play Saved Suno Cue for Suno.');
  });
  wire('spotifyPlayNow', async () => {
    readMusicSettings();
    S.musicProvider = 'spotify';
    await playSpotifyUrl(S.spotifyUrl, true);
  });
  wire('sunoPlayNow', async () => {
    readMusicSettings();
    S.musicProvider = 'spotify';
    await playSuno(true);
  });
  wire('spotifyLogin', spotifyLogin);
  wire('spotifyCheck', () => checkSpotifyHealth(true));
  wire('spotifyReceiver', async () => {
    readMusicSettings();
    S.musicProvider = 'spotify';
    if (S.screen === 'home') {
      await beginSpotifyTapActivation();
      await playSpotifyUrl(S.spotifyUrl, false, { fromTap: true });
      return;
    }
    await playSpotifyUrl(S.spotifyUrl, true);
  });
  wire('makeReceiver', async () => {
    readMusicSettings();
    setFeedback('Command stays Command in V18. Open Home on the speaker-connected phone, then tap Start Receiver + Play Spotify there.', true);
  });
  wire('spotifyClear', clearSpotifyToken);
  wire('import', () => importSuno());
  document.querySelectorAll('[data-song]').forEach(button => {
    button.onclick = () => Promise.resolve((async () => {
      S.current = Number(button.dataset.song) || 0;
      S.musicProvider = 'spotify';
      await playSuno(true);
    })()).catch(error => isActionNeeded(error) ? setActionNeeded(error.message) : setFeedback(error.message, false));
  });
  document.querySelectorAll('[data-schedule-song]').forEach(button => {
    button.onclick = () => addSongSchedule(Number(button.dataset.scheduleSong));
  });

  document.querySelectorAll('[data-activate-schedule]').forEach(button => {
    button.onclick = () => {
      S.activeSchedule = scheduleMode(button.dataset.activateSchedule);
      save(`${scheduleTitle(S.activeSchedule)} is now active.`);
    };
  });
  document.querySelectorAll('[data-add-sched]').forEach(button => {
    button.onclick = () => createScheduleItem(button.dataset.addSched);
  });
  document.querySelectorAll('[data-play-row]').forEach(button => {
    button.onclick = () => {
      const mode = scheduleMode(button.dataset.scheduleMode);
      return Promise.resolve(playScheduleItem(scheduleItems(mode)[Number(button.dataset.playRow)])).catch(error => isActionNeeded(error) ? setActionNeeded(error.message) : setFeedback(error.message, false));
    };
  });
  document.querySelectorAll('[data-edit]').forEach(button => {
    button.onclick = () => {
      const row = scheduleItems(button.dataset.scheduleMode)[Number(button.dataset.edit)];
      S.editId = S.editId === row.id ? 'new' : row.id;
      localSave();
      render();
    };
  });
  document.querySelectorAll('[data-toggle]').forEach(button => {
    button.onclick = () => {
      const row = scheduleItems(button.dataset.scheduleMode)[Number(button.dataset.toggle)];
      row.enabled = !row.enabled;
      save(`${row.label} turned ${row.enabled ? 'on' : 'off'}.`);
    };
  });
  document.querySelectorAll('[data-delete]').forEach(button => {
    button.onclick = () => {
      const items = scheduleItems(button.dataset.scheduleMode);
      const row = items[Number(button.dataset.delete)];
      items.splice(Number(button.dataset.delete), 1);
      S.editId = 'new';
      save(`${row.label} deleted from ${scheduleTitle(button.dataset.scheduleMode).toLowerCase()}.`);
    };
  });
  document.querySelectorAll('[data-save-row]').forEach(button => {
    button.onclick = () => saveRow(Number(button.dataset.saveRow), button.dataset.scheduleMode);
  });
  document.querySelectorAll('[data-kind-row]').forEach(select => {
    select.onchange = () => updateScheduleTypeDraft(Number(select.dataset.kindRow), select.dataset.scheduleMode, select.value);
  });

  wire('checkWeather', triggerWeatherCheck);
  wire('verify', geocode);
  wire('gps', useGps);
  wire('saveLoc', async () => {
    readWeatherSettings();
    await save('Weather settings saved.');
  });

  if ($('voiceMode')) $('voiceMode').value = S.voiceMode;
  if ($('aiVoice')) $('aiVoice').value = S.aiVoice;
  if ($('deviceVoice')) $('deviceVoice').value = S.deviceVoice;
  wire('voiceHealth', checkVoiceHealth);
  wire('saveVoice', async () => {
    S.voiceMode = val('voiceMode') || S.voiceMode;
    S.aiVoice = val('aiVoice') || S.aiVoice;
    S.deviceVoice = val('deviceVoice');
    S.announcementGain = clampNumber(val('announcementGain') || S.announcementGain, 1, 3.4, 3);
    S.rate = Number(val('rate')) || .94;
    S.pitch = Number(val('pitch')) || 1;
    await save('Voice settings saved.');
  });
  const annSelect = $('annSelect');
  if (annSelect) annSelect.onchange = () => {
    S.selected = val('annSelect') || S.selected;
    S.quickText = ann().text;
    localSave();
    render();
  };
  if ($('annMode')) $('annMode').value = ann().mode || 'voice';
  if ($('annTrack')) $('annTrack').value = String(ann().trackIndex || 0);
  wire('saveAnnouncement', async () => {
    const selected = ann();
    selected.label = val('annLabel') || selected.label;
    selected.mode = val('annMode') === 'suno' ? 'suno' : 'voice';
    selected.text = val('annText') || selected.text;
    selected.trackIndex = Math.max(0, Math.min(Number(val('annTrack')) || 0, Math.max(0, S.tracks.length - 1)));
    S.quickText = selected.text;
    await save(`Saved announcement updated: ${selected.label}.`);
  });
  wire('testSavedAnnouncement', async () => {
    const selected = ann();
    selected.label = val('annLabel') || selected.label;
    selected.mode = val('annMode') === 'suno' ? 'suno' : 'voice';
    selected.text = val('annText') || selected.text;
    selected.trackIndex = Math.max(0, Math.min(Number(val('annTrack')) || 0, Math.max(0, S.tracks.length - 1)));
    await playSavedAnnouncement(selected, false, `Test ${selected.label}`);
  });
  wire('testVoice', async () => {
    S.voiceMode = val('voiceMode') || S.voiceMode;
    S.aiVoice = val('aiVoice') || S.aiVoice;
    S.deviceVoice = val('deviceVoice');
    await sendAnnouncement(`This is Serenity Shores Poolside Pulse version ${VERSION}. The selected voice is being tested on the Home receiver.`, false, 'Voice test');
  });
  wire('testDevice', async () => {
    const oldMode = S.voiceMode;
    S.voiceMode = 'device';
    S.deviceVoice = val('deviceVoice');
    await sendAnnouncement(`This is the device voice fallback test for Poolside Pulse version ${VERSION}.`, false, 'Device voice test');
    S.voiceMode = oldMode;
    localSave();
  });

  wire('saveHours', async () => {
    S.poolOpen = val('poolOpen') || S.poolOpen;
    S.poolClose = val('poolClose') || S.poolClose;
    S.playbackMode = val('playbackMode') || 'always';
    S.autoStart = val('autoStart') !== 'false';
    S.autoStop = val('autoStop') === 'true';
    await save('Playback automation saved.');
  });
}

function loadVoices() {
  voices = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
}

window.addEventListener('poolside-v18-audio-status', event => {
  if (event.detail?.status) {
    S.audioStatus = event.detail.status;
    if (helperAudioReady(event.detail)) {
      S.receiverStatus = 'Receiver audio ready.';
      S.receiverActiveAt = Date.now();
      S.receiverLastSeen = stamp();
    } else if (/not been activated|blocked|failed|unavailable|denied/i.test(event.detail.status)) {
      receiverActive = false;
      S.receiverStatus = 'Receiver online; tap Start Receiver + Play Spotify once for sound.';
      S.receiverActiveAt = 0;
    }
    localSave();
  }
});

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}

function normalizeCurrentUrl() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.has('code') || params.has('state')) return;
    if (params.get('v') === '9-volume-suno-control') return;
    history.replaceState(null, '', `/${APP_QUERY}`);
  } catch {}
}

completeSpotifyLogin().finally(() => {
  normalizeCurrentUrl();
  if (S.screen !== 'home') releaseCommandReceiver('startup');
  render();
  warmSpotifyReceiver();
  pullState();
  setInterval(pullState, 1500);
  setInterval(tick, 10000);
  setInterval(weatherMonitor, 300000);
  setTimeout(weatherMonitor, 15000);
});
