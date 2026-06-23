import { DEFAULT_PARTY_SCHEDULE } from './v11-party-defaults.js';

const VERSION = '11';
const PIN = '7900';
const KEY = 'poolside-pulse-v11';
const DEVICE_KEY = 'poolside-pulse-v11-device-id';
const HANDLED_KEY = 'poolside-pulse-v11-handled-events';
const LOG_CLEAR_KEY = 'poolside-pulse-v11-log-cleared-at';
const RECEIVER_SESSION_KEY = 'poolside-pulse-v11-receiver-session-started-at';
const SPOTIFY_TOKEN_KEY = 'poolside-pulse-v11-spotify-token';
const APP_QUERY = '?v=11-weekly-party-command';
const LEGACY_STATE_KEYS = [
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
  state: '/api/state',
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
const DEFAULT_SUNO_PLAYLIST = 'https://suno.com/playlist/cf4b536e-9005-4c98-9ea5-a7f01eca116f';
const DEFAULT_ADDRESS = '615 Serenity Shores Ln, Kimberling City, MO 65686';
const EVENT_TTL_MS = 90 * 60 * 1000;
const EVENT_LIMIT = 120;
const LOG_LIMIT = 180;
const EVENT_RETRY_MS = 9000;
const RECEIVER_EVENT_GRACE_MS = 3000;
const OLD_AUDIO_BLOCK_PATTERN = /play\(\) failed|goo\.gl\/xX8pDD|play method is not allowed|user did(?:n't| not) interact|user agent or the platform/i;

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

const PARTY_CUE_TYPES = {
  spoken: 'Spoken Word',
  spotify: 'Spotify',
  suno: 'Suno',
  customAudio: 'Custom Audio URL',
  manual: 'Manual Pause',
  game: 'Game Segment',
  prize: 'Prize / Interview',
  safety: 'Safety',
  weather: 'Weather'
};
const PARTY_ADVANCE_MODES = {
  speechEnd: 'Speech ends',
  fullTrack: 'Full track',
  timed: 'Timed',
  manual: 'Manual'
};
const PARTY_SPEAKERS = {
  gabe: 'Gabe',
  callie: 'Callie',
  manager: 'Manager',
  safety: 'Safety',
  custom: 'Custom Speaker'
};

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
  quickMusicUrl: DEFAULT_SUNO_PLAYLIST,
  spotifyUrl: DEFAULT_SPOTIFY_PLAYLIST,
  spotifyClientId: DEFAULT_SPOTIFY_CLIENT_ID,
  spotifyRedirectUri: '',
  spotifyVolume: 92,
  spotifyDuckedVolume: 0,
  announcementGain: 2.65,
  sunoVolume: 95,
  sunoDuckedVolume: 2,
  audioControlUpdatedAt: 0,
  tracks: [{ title: 'Import the Serenity Shores playlist', artist: 'Poolside Pulse', duration: '3:00', audioUrl: '' }],
  current: 0,
  intent: 'stopped',
  activeMusicLabel: 'Nothing has been sent to receivers yet.',
  activeMusicProvider: 'spotify',
  activeMusicUrl: DEFAULT_SPOTIFY_PLAYLIST,
  manualMusicHoldUntil: 0,
  manualMusicHoldReason: '',
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
  schedule: DEFAULT_SCHEDULE,
  editId: 'new',
  lastRun: {},
  poolOpen: '09:00',
  poolClose: '22:00',
  playbackMode: 'hours',
  autoStart: true,
  autoStop: true,
  v9DefaultsApplied: true,
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
  audioStatus: 'Receiver audio has not been activated yet.',
  poolMode: 'normalPool',
  partySchedule: DEFAULT_PARTY_SCHEDULE,
  partyState: 'idle',
  partyCurrentCueId: '',
  partySelectedCueId: 'party-01',
  partyStartedAt: 0,
  partyCueStartedAt: 0,
  partyElapsedMs: 0,
  partyPausedAt: 0,
  partyLog: [],
  partyManualWait: false,
  partyWeatherHold: false,
  partyEditing: false,
  partyImportText: '',
  partyExportText: ''
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
let statePulling = false;
let pendingRender = false;
let spotifyVolumeApplyTimer = null;
let audioSettingsApplyTimer = null;
let partyAdvanceTimer = null;
let partyPausedCue = null;
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
music.volume = Math.max(.01, Math.min(1, Number(S.sunoVolume || 95) / 100));
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

function normalizeVoiceProfile(profile, fallback = {}) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const id = String(source.id || fallback.id || uid());
  const speaker = PARTY_SPEAKERS[source.speaker] ? source.speaker : (PARTY_SPEAKERS[fallback.speaker] ? fallback.speaker : 'custom');
  return {
    id,
    label: String(source.label || fallback.label || PARTY_SPEAKERS[speaker] || 'Voice Profile'),
    speaker,
    preferredGender: ['male', 'female', 'neutral'].includes(source.preferredGender) ? source.preferredGender : (fallback.preferredGender || 'neutral'),
    voiceURI: String(source.voiceURI || fallback.voiceURI || ''),
    rate: clampNumber(source.rate, .65, 1.35, fallback.rate ?? 1),
    pitch: clampNumber(source.pitch, .65, 1.35, fallback.pitch ?? 1),
    volume: clampNumber(source.volume, .1, 1, fallback.volume ?? 1)
  };
}

function normalizePartyCue(cue, index = 0) {
  const source = cue && typeof cue === 'object' ? cue : {};
  const type = PARTY_CUE_TYPES[source.type] ? source.type : 'spoken';
  const durationMode = PARTY_ADVANCE_MODES[source.durationMode] ? source.durationMode : (type === 'spoken' || type === 'game' || type === 'prize' || type === 'safety' ? 'speechEnd' : 'manual');
  const speaker = PARTY_SPEAKERS[source.speaker] ? source.speaker : (type === 'safety' || type === 'weather' ? 'safety' : 'manager');
  return {
    id: String(source.id || `party-${uid()}`),
    order: Number.isFinite(Number(source.order)) ? Number(source.order) : index + 1,
    enabled: bool(source.enabled, true),
    type,
    title: String(source.title || `${PARTY_CUE_TYPES[type]} Cue`),
    speaker,
    voiceProfileId: String(source.voiceProfileId || speaker),
    text: String(source.text || ''),
    trackTitle: String(source.trackTitle || ''),
    artist: String(source.artist || ''),
    url: String(source.url || ''),
    spotifyUri: String(source.spotifyUri || ''),
    sourceLabel: String(source.sourceLabel || ''),
    durationMode,
    durationSeconds: Math.max(0, Math.round(Number(source.durationSeconds || 0) || 0)),
    volume: clampNumber(source.volume, 0, 100, ['spoken', 'game', 'prize', 'safety', 'weather'].includes(type) ? 100 : 92),
    fadeInSeconds: clampNumber(source.fadeInSeconds, 0, 12, 1),
    fadeOutSeconds: clampNumber(source.fadeOutSeconds, 0, 12, 1),
    duckOtherAudio: bool(source.duckOtherAudio, ['spoken', 'game', 'prize', 'safety', 'weather'].includes(type)),
    requiresManualAdvance: bool(source.requiresManualAdvance, durationMode === 'manual'),
    notes: String(source.notes || ''),
    createdAt: String(source.createdAt || new Date().toISOString()),
    updatedAt: String(source.updatedAt || new Date().toISOString())
  };
}

function normalizePartySchedule(schedule) {
  const fallback = clone(DEFAULT_PARTY_SCHEDULE);
  const source = schedule && typeof schedule === 'object' ? schedule : {};
  const fallbackProfiles = list(fallback.voiceProfiles);
  const profiles = list(source.voiceProfiles).length
    ? list(source.voiceProfiles).map((profile, index) => normalizeVoiceProfile(profile, fallbackProfiles[index]))
    : fallbackProfiles.map(profile => normalizeVoiceProfile(profile));
  const profileIds = new Set(profiles.map(profile => profile.id));
  for (const profile of fallbackProfiles) {
    if (!profileIds.has(profile.id)) profiles.push(normalizeVoiceProfile(profile));
  }
  const cues = (list(source.cues).length ? list(source.cues) : list(fallback.cues))
    .map(normalizePartyCue)
    .sort((a, b) => a.order - b.order)
    .map((cue, index) => ({ ...cue, order: index + 1 }));
  const settings = {
    ...clone(fallback.settings),
    ...(source.settings && typeof source.settings === 'object' ? source.settings : {})
  };
  settings.defaultMode = ['normalPool', 'weeklyParty'].includes(settings.defaultMode) ? settings.defaultMode : 'normalPool';
  settings.weatherMonitoringEnabled = true;
  settings.pausePartyForWeatherAlerts = bool(settings.pausePartyForWeatherAlerts, true);
  settings.duckMusicDuringSpeech = bool(settings.duckMusicDuringSpeech, true);
  settings.spotifySupportMode = ['urlOnly', 'embed', 'sdk'].includes(settings.spotifySupportMode) ? settings.spotifySupportMode : 'sdk';
  settings.sunoSupportMode = ['urlOnly', 'embed', 'directAudio'].includes(settings.sunoSupportMode) ? settings.sunoSupportMode : 'directAudio';
  return {
    id: String(source.id || fallback.id),
    name: String(source.name || fallback.name),
    version: 11,
    description: String(source.description || fallback.description),
    cues,
    voiceProfiles: profiles,
    settings
  };
}

function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const s = { ...clone(BASE), ...clone(source), version: VERSION };
  const importedFromV9 = ['9', VERSION].includes(String(source.version || '')) || source.v9DefaultsApplied;

  s.musicProvider = PROVIDERS[s.musicProvider] ? s.musicProvider : 'spotify';
  s.spotifyUrl = String(s.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST);
  s.playlistUrl = String(s.playlistUrl || DEFAULT_SUNO_PLAYLIST);
  s.quickMusicUrl = String(s.quickMusicUrl || (s.musicProvider === 'suno' ? s.playlistUrl : s.spotifyUrl) || DEFAULT_SUNO_PLAYLIST);
  s.spotifyClientId = String(s.spotifyClientId || DEFAULT_SPOTIFY_CLIENT_ID);
  s.spotifyRedirectUri = normalizeRedirectUri(s.spotifyRedirectUri || appRedirectDefault());
  s.spotifyVolume = clampNumber(s.spotifyVolume, 0, 100, 92);
  s.spotifyDuckedVolume = clampNumber(s.spotifyDuckedVolume, 0, 20, 0);
  s.announcementGain = clampNumber(s.announcementGain, 1, 3.4, 2.65);
  s.sunoVolume = clampNumber(s.sunoVolume, 20, 100, 95);
  s.sunoDuckedVolume = clampNumber(s.sunoDuckedVolume, 0, 20, 2);
  s.audioControlUpdatedAt = Math.max(0, Number(s.audioControlUpdatedAt || 0) || 0);
  s.manualMusicHoldUntil = Math.max(0, Number(s.manualMusicHoldUntil || 0) || 0);
  s.manualMusicHoldReason = String(s.manualMusicHoldReason || '');
  s.spotifyReceiverReadyAt = Math.max(0, Number(s.spotifyReceiverReadyAt || 0) || 0);
  s.radius = clampNumber(s.radius, 1, 25, 10);
  s.lightningRadiusMiles = clampNumber(s.lightningRadiusMiles || s.radius, 1, 25, 10);
  s.lightningHoldMinutes = clampNumber(s.lightningHoldMinutes, 5, 90, 30);
  s.windGustMph = clampNumber(s.windGustMph, 15, 80, 35);
  s.weatherAuto = bool(s.weatherAuto, true);
  s.autoStart = bool(s.autoStart, true);
  s.autoStop = bool(s.autoStop, true);
  s.playbackMode = ['always', 'hours'].includes(s.playbackMode) ? s.playbackMode : 'hours';
  if (!importedFromV9) {
    if (!source.playbackMode || source.playbackMode === 'always') s.playbackMode = 'hours';
    if (source.autoStop === undefined || source.autoStop === false) s.autoStop = true;
  }
  s.v9DefaultsApplied = true;
  s.anns = list(s.anns).length ? list(s.anns).map(normalizeAnnItem) : clone(DEFAULT_ANNS).map(normalizeAnnItem);
  const annIds = new Set(s.anns.map(item => item.id));
  for (const item of DEFAULT_ANNS) {
    if (!annIds.has(item.id)) s.anns.push(normalizeAnnItem(item));
  }
  s.schedule = list(s.schedule).length ? list(s.schedule) : clone(DEFAULT_SCHEDULE);
  s.tracks = list(s.tracks).length ? list(s.tracks).slice(0, 300) : clone(BASE.tracks);
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
  s.poolMode = s.poolMode === 'weeklyParty' ? 'weeklyParty' : 'normalPool';
  s.partySchedule = normalizePartySchedule(s.partySchedule);
  s.partyState = ['idle', 'running', 'paused', 'stopped', 'waiting', 'complete', 'weatherHold'].includes(s.partyState) ? s.partyState : 'idle';
  s.partySelectedCueId = s.partySchedule.cues.find(cue => cue.id === s.partySelectedCueId)?.id || s.partySchedule.cues[0]?.id || '';
  s.partyCurrentCueId = s.partySchedule.cues.find(cue => cue.id === s.partyCurrentCueId)?.id || '';
  s.partyStartedAt = Math.max(0, Number(s.partyStartedAt || 0) || 0);
  s.partyCueStartedAt = Math.max(0, Number(s.partyCueStartedAt || 0) || 0);
  s.partyElapsedMs = Math.max(0, Number(s.partyElapsedMs || 0) || 0);
  s.partyPausedAt = Math.max(0, Number(s.partyPausedAt || 0) || 0);
  s.partyLog = mergeById(80, true, s.partyLog);
  s.partyManualWait = bool(s.partyManualWait, false);
  s.partyWeatherHold = bool(s.partyWeatherHold, false);
  s.partyEditing = bool(s.partyEditing, false);
  s.partyImportText = String(s.partyImportText || '');
  s.partyExportText = String(s.partyExportText || '');
  if (OLD_AUDIO_BLOCK_PATTERN.test(String(s.audioStatus || ''))) s.audioStatus = BASE.audioStatus;
  if (OLD_AUDIO_BLOCK_PATTERN.test(String(s.setupNotice || ''))) s.setupNotice = '';
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
    ['spotifyVolumeCommand', 'spotifyVolume', 0, 100, 92],
    ['spotifyVolume', 'spotifyVolume', 0, 100, 92],
    ['spotifyDuckedVolume', 'spotifyDuckedVolume', 0, 20, 0],
    ['sunoVolume', 'sunoVolume', 20, 100, 95],
    ['announcementGain', 'announcementGain', 1, 3.4, 2.65],
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
      'manualMusicHoldReason'
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
    spotifyVolume: S.spotifyVolume,
    spotifyDuckedVolume: S.spotifyDuckedVolume,
    sunoVolume: S.sunoVolume,
    announcementGain: S.announcementGain,
    rate: S.rate,
    pitch: S.pitch,
    audioControlUpdatedAt: S.audioControlUpdatedAt,
    partySelectedCueId: S.partySelectedCueId,
    partyEditing: S.partyEditing,
    partyImportText: S.partyImportText,
    partyExportText: S.partyExportText
  };
}

function restoreLocalAfterMerge(local) {
  S.screen = local.screen;
  S.admin = local.admin;
  S.tab = local.tab;
  S.selected = local.selected;
  S.quickText = local.quickText;
  S.guestName = local.guestName;
  S.editId = local.editId;
  restoreAudioDrafts(local.audioDrafts);
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
      'manualMusicHoldReason'
    ].forEach(key => { S[key] = local[key]; });
  }
  if (local.audioControlUpdatedAt > Number(S.audioControlUpdatedAt || 0)) {
    ['spotifyVolume', 'spotifyDuckedVolume', 'sunoVolume', 'announcementGain', 'rate', 'pitch', 'audioControlUpdatedAt'].forEach(key => { S[key] = local[key]; });
  }
  if (S.screen !== 'home') {
    ['partySelectedCueId', 'partyEditing', 'partyImportText', 'partyExportText'].forEach(key => { S[key] = local[key]; });
  }
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
        ...S,
        ...data.state,
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
  return S.screen === 'home' && receiverActive && receiverAudioReady() && receiverSessionStartedAt() > 0;
}

function markOlderEventsHandled(startAt) {
  const now = Date.now();
  const map = handledMap();
  for (const event of recentEvents(S.events)) {
    if (event?.id && eventTime(event) < startAt - RECEIVER_EVENT_GRACE_MS) {
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
  logEvent('receiver', 'Fresh receiver session', `${reason}; older commands ignored on this receiver.`);
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
    if (ts < startedAt - RECEIVER_EVENT_GRACE_MS) return false;
  }
  if (Date.now() < Number(retryAfter[event.id] || 0)) return false;
  return true;
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
    song: 'Play Suno song',
    suno: 'Play Suno playlist',
    'party-control': 'Weekly party control',
    'party-safety': 'Party safety interruption',
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
      markHandled(event.id);
      delete retryAfter[event.id];
      const next = /send the command again/i.test(message) ? message : `${message} After this receiver is ready, send the command again.`;
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
  if (command.provider && command.type !== 'spotify-volume') S.musicProvider = command.provider;
  if (command.type === 'spotify-volume') {
    S.spotifyVolume = clampNumber(command.volume, 0, 100, S.spotifyVolume);
    S.audioControlUpdatedAt = Math.max(Number(S.audioControlUpdatedAt || 0), Number(command.audioControlUpdatedAt || command.createdAt || Date.now()));
  } else if (command.type === 'audio-settings') {
    if (Number.isFinite(Number(command.spotifyDuckedVolume))) S.spotifyDuckedVolume = clampNumber(command.spotifyDuckedVolume, 0, 20, S.spotifyDuckedVolume);
    if (Number.isFinite(Number(command.sunoVolume))) S.sunoVolume = clampNumber(command.sunoVolume, 20, 100, S.sunoVolume);
    if (Number.isFinite(Number(command.announcementGain))) S.announcementGain = clampNumber(command.announcementGain, 1, 3.4, S.announcementGain);
    if (Number.isFinite(Number(command.rate))) S.rate = clampNumber(command.rate, .75, 1.15, S.rate);
    if (Number.isFinite(Number(command.pitch))) S.pitch = clampNumber(command.pitch, .85, 1.15, S.pitch);
    S.audioControlUpdatedAt = Math.max(Number(S.audioControlUpdatedAt || 0), Number(command.audioControlUpdatedAt || command.createdAt || Date.now()));
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
    if (S.musicProvider === 'spotify') await playSpotifyUrl(S.spotifyUrl, false, { fromRemote: true });
    else await playSuno(false);
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
    S.musicProvider = 'suno';
    await playSuno(false);
  } else if (command.type === 'suno') {
    S.musicProvider = 'suno';
    S.playlistUrl = command.url || S.playlistUrl;
    await importSuno('Remote Suno URL imported.');
    await playSuno(false);
  } else if (command.type === 'party-control') {
    await runPartyControl(command.action || 'start', command);
  } else if (command.type === 'party-safety') {
    await partySafetyInterrupt(command.cueId || 'party-61', false);
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
  if (!event.text) return;
  logEvent('receiver', 'Announcement received', String(event.text).slice(0, 190), { eventId: event.id });
  await announce(event.text, { hold: !!event.hold, eventId: event.id });
}

function readMusicSettings() {
  if ($('musicProvider')) S.musicProvider = val('musicProvider') || S.musicProvider;
  if (!PROVIDERS[S.musicProvider]) S.musicProvider = 'spotify';
  if ($('playlistName')) S.playlistName = val('playlistName') || S.playlistName;
  if ($('playlistUrl')) S.playlistUrl = val('playlistUrl') || S.playlistUrl;
  if ($('quickMusicUrl')) S.quickMusicUrl = val('quickMusicUrl') || S.quickMusicUrl;
  if ($('spotifyUrl')) S.spotifyUrl = val('spotifyUrl') || S.spotifyUrl;
  if ($('spotifyClientId')) S.spotifyClientId = val('spotifyClientId') || S.spotifyClientId || DEFAULT_SPOTIFY_CLIENT_ID;
  if ($('spotifyRedirectUri')) S.spotifyRedirectUri = normalizeRedirectUri(val('spotifyRedirectUri') || S.spotifyRedirectUri || appRedirectDefault());
  S.spotifyVolume = clampNumber($('spotifyVolume') ? val('spotifyVolume') : S.spotifyVolume, 0, 100, 92);
  S.spotifyDuckedVolume = clampNumber($('spotifyDuckedVolume') ? val('spotifyDuckedVolume') : S.spotifyDuckedVolume, 0, 20, 0);
  S.announcementGain = clampNumber($('announcementGain') ? val('announcementGain') : S.announcementGain, 1, 3.4, 2.65);
  S.sunoVolume = clampNumber($('sunoVolume') ? val('sunoVolume') : S.sunoVolume, 20, 100, 95);
  S.sunoDuckedVolume = clampNumber($('sunoDuckedVolume') ? val('sunoDuckedVolume') : S.sunoDuckedVolume, 0, 20, 2);
  S.activeMusicProvider = S.musicProvider;
  S.activeMusicUrl = activeProviderUrl();
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

async function importSuno(message = 'Suno playlist imported.') {
  readMusicSettings();
  S.musicProvider = 'suno';
  setFeedback('Importing Suno playlist...', true);
  renderWhenIdle();
  const response = await fetch(API.suno + encodeURIComponent(S.playlistUrl));
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.tracks?.length) throw Error(data.error || `Suno import HTTP ${response.status}`);
  S.tracks = data.tracks.map(item => ({
    title: item.title || 'Untitled',
    artist: item.artist || 'Suno',
    duration: item.duration || '3:00',
    audioUrl: item.audioUrl || '',
    sourceUrl: item.sourceUrl || S.playlistUrl,
    imageUrl: item.imageUrl || ''
  }));
  const first = S.tracks.findIndex(item => item.audioUrl);
  S.current = first >= 0 ? first : 0;
  S.playlistName = data.playlistName || S.playlistName;
  S.lastError = data.audioWarning || '';
  logEvent('music', 'Suno imported', `${S.tracks.length} track(s). ${data.audioWarning || ''}`.trim());
  await pushState(`${message} ${S.tracks.length} track(s) loaded.`);
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

function helperAudioReady(status) {
  return !!(status?.unlocked || status?.webAudioPrimed || status?.mediaElementPrimed);
}

function helperAudioStatus() {
  const fn = window.__poolsideV11AudioStatus || window.__poolsideV9AudioStatus;
  return typeof fn === 'function' ? fn() : null;
}

function helperUnlockAudio(reason, options) {
  const fn = window.__poolsideV11UnlockAudio || window.__poolsideV9UnlockAudio;
  return typeof fn === 'function' ? fn(reason, options) : null;
}

function helperPlayAnnouncementBlob(blob, options) {
  const fn = window.__poolsideV11PlayAnnouncementBlob || window.__poolsideV9PlayAnnouncementBlob;
  return typeof fn === 'function' ? fn(blob, options) : null;
}

function receiverAudioReady() {
  const status = helperAudioStatus();
  if (fallbackAudioUnlocked || helperAudioReady(status)) return true;
  const text = String(status?.status || S.audioStatus || '').toLowerCase();
  if (/not been activated|blocked|failed|unavailable|denied/.test(text)) return false;
  if (/activated by|audio unlocked|test tone played|started through/.test(text)) return true;
  return false;
}

async function ensureReceiverAudio(reason = 'receiver action', options = {}) {
  let unlocked = receiverAudioReady();
  const unlockOptions = {
    ...options,
    audible: !!options.userGesture && !!(options.testTone || options.audible || (!unlocked && options.startSession))
  };
  const attempts = [];
  const helperAttempt = helperUnlockAudio(reason, unlockOptions);
  if (helperAttempt) attempts.push(helperAttempt);
  if (unlockOptions.audible || !helperAttempt) attempts.push(fallbackUnlockReceiverAudio(reason, unlockOptions));
  if (attempts.length) {
    const results = await Promise.allSettled(attempts);
    unlocked = results.some(result => result.status === 'fulfilled' && result.value);
  }
  const status = helperAudioStatus();
  const helperReady = helperAudioReady(status);
  if (status?.status && (helperReady || (!fallbackAudioUnlocked && !/not been activated yet/i.test(status.status)))) S.audioStatus = status.status;
  unlocked = unlocked || fallbackAudioUnlocked || helperReady;
  receiverActive = unlocked;
  S.receiverStatus = unlocked ? 'Receiver audio ready.' : 'Receiver online; tap Start Receiver once for sound.';
  S.receiverActiveAt = unlocked ? Date.now() : 0;
  S.receiverLastSeen = stamp();
  if (unlocked && options.startSession) beginReceiverSession(reason);
  if (!unlocked) {
    const detail = String(S.audioStatus || '');
    S.setupNotice = detail && !/not been activated yet/i.test(detail)
      ? detail
      : 'Tap Start Receiver on this speaker-connected phone once. iPhone browsers require that tap before music or announcements can be heard.';
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
    if (!ok) throw actionNeededError(S.setupNotice || 'Tap Start Receiver on this iPhone before sending sound.');
    setFeedback('Receiver audio test completed on this phone.', true);
    logEvent('receiver', 'Receiver audio test', 'Start Receiver test tone completed on this Home device.');
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

async function playSuno(push = true) {
  readMusicSettings();
  if (S.screen !== 'home' && push) {
    S.musicProvider = 'suno';
    await issueCommand('play', { provider: 'suno', trackIndex: S.current, label: 'Play Suno', detail: `${sourceLabel('suno', S.playlistUrl)} · track ${Number(S.current || 0) + 1}` }, 'Play command sent to all active receivers.');
    return;
  }
  clearManualMusicHold();
  await ensureReceiverAudio('Suno play', { required: true });
  await pauseSpotifyForSunoPlayback();
  S.musicProvider = 'suno';
  if (!hasPlayableSuno()) {
    await importSuno('Playlist auto-imported for receiver.');
    if (!hasPlayableSuno()) throw Error('No playable Suno/direct audio URLs are available from this playlist. Use Spotify for continuous playback.');
  }
  if (!track().audioUrl) {
    const next = nextPlayableIndex(S.current - 1);
    if (next >= 0) S.current = next;
  }
  const url = track().audioUrl;
  if (!url) throw Error('This Suno item has no playable audio URL.');
  if (!sameUrl(music.src, url)) music.src = url;
  music.muted = false;
  music.volume = Math.max(.01, Number(S.sunoVolume || 95) / 100);
  await music.play();
  await fade(music, Number(S.sunoVolume || 95) / 100, 450);
  S.intent = 'playing';
  rememberActiveSource('suno', S.playlistUrl, `playing: ${track().title || 'Suno track'}`);
  logEvent('play', 'Suno playing on receiver', `${track().title || 'Suno track'} · ${track().artist || ''}`);
  setFeedback(`Suno playing on receiver: ${track().title || 'track'}.`, true);
  await pushState('Receiver Suno playback logged.', { render: false });
  renderWhenIdle();
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
  music.volume = Number(S.sunoVolume || 95) / 100;
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
  music.volume = Number(S.sunoVolume || 95) / 100;
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
  if (S.musicProvider === 'spotify') await playSpotifyUrl(S.spotifyUrl, push);
  else await playSuno(push);
}

async function pauseSelected(push = true) {
  if (S.musicProvider === 'spotify') await spotifyPause(push);
  else await pauseSuno(push);
}

async function stopSelected(push = true) {
  if (S.musicProvider === 'spotify') await spotifyStop(push);
  else await stopSuno(push);
}

async function skipSelected(push = true) {
  if (S.musicProvider === 'spotify') await spotifyNext(push);
  else await nextSuno(push);
}

function activeProviderUrl() {
  return S.musicProvider === 'spotify' ? S.spotifyUrl : S.playlistUrl;
}

function providerFromUrl(url) {
  const raw = String(url || '').trim();
  if (/suno\.com\/playlist\//i.test(raw)) return 'suno';
  if (/spotify:|open\.spotify\.com\//i.test(raw)) return 'spotify';
  return '';
}

function sourceKind(url) {
  const raw = String(url || '');
  if (/spotify:track:|open\.spotify\.com\/track\//i.test(raw)) return 'Spotify song';
  if (/spotify:album:|open\.spotify\.com\/album\//i.test(raw)) return 'Spotify album';
  if (/spotify:artist:|open\.spotify\.com\/artist\//i.test(raw)) return 'Spotify artist';
  if (/spotify:playlist:|open\.spotify\.com\/playlist\//i.test(raw)) return 'Spotify playlist';
  if (/suno\.com\/playlist\//i.test(raw)) return 'Suno playlist';
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
  if (provider === 'suno') return `Suno playlist${id ? ` ${id.slice(0, 14)}` : ''}`;
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
  if (!provider) throw Error('Paste a Suno playlist URL or Spotify playlist, album, artist, or track URL.');
  S.quickMusicUrl = raw;
  if (provider === 'spotify') {
    S.musicProvider = 'spotify';
    S.spotifyUrl = raw;
    await playSpotifyUrl(raw, push);
    return;
  }
  S.musicProvider = 'suno';
  S.playlistUrl = raw;
  rememberActiveSource('suno', raw, push ? 'sent to receivers' : 'playing on receiver');
  if (S.screen !== 'home' && push) {
    await issueCommand('suno', { label: 'Play Suno playlist', provider: 'suno', url: raw, detail: sourceLabel('suno', raw) }, `Suno playlist command sent to all active receivers: ${sourceLabel('suno', raw)}.`);
    return;
  }
  await importSuno('Suno playlist imported for receiver.');
  await playSuno(false);
}

function readSpotifyVolumeControl() {
  const el = $('spotifyVolumeCommand') || $('spotifyVolume');
  S.spotifyVolume = clampNumber(el ? el.value : S.spotifyVolume, 0, 100, 92);
  S.audioControlUpdatedAt = Date.now();
  localSave();
  return S.spotifyVolume;
}

function updateSpotifyVolumeDraft(value) {
  S.spotifyVolume = clampNumber(value, 0, 100, 92);
  S.audioControlUpdatedAt = Date.now();
  localSave();
  syncVolumeReadouts();
  return S.spotifyVolume;
}

function syncVolumeReadouts() {
  const volume = String(clampNumber(S.spotifyVolume, 0, 100, 92));
  ['spotifyVolumeOut', 'spotifyVolumeCommandOut'].forEach(id => {
    const out = $(id);
    if (out) out.textContent = `${volume}%`;
  });
  const ducked = $('spotifyDuckedVolumeOut');
  if (ducked) ducked.textContent = `${clampNumber(S.spotifyDuckedVolume, 0, 20, 0)}%`;
  const suno = $('sunoVolumeOut');
  if (suno) suno.textContent = `${clampNumber(S.sunoVolume, 20, 100, 95)}%`;
  const gain = $('announcementGainOut');
  if (gain) gain.textContent = `${Math.round(clampNumber(S.announcementGain, 1, 3.4, 2.65) * 100)}%`;
  const rate = $('rateOut');
  if (rate) rate.textContent = String(clampNumber(S.rate, .75, 1.15, .94));
  const pitch = $('pitchOut');
  if (pitch) pitch.textContent = String(clampNumber(S.pitch, .85, 1.15, 1));
}

function updateRangeDraft(key, value) {
  if (key === 'spotifyVolume') S.spotifyVolume = clampNumber(value, 0, 100, 92);
  else if (key === 'spotifyDuckedVolume') S.spotifyDuckedVolume = clampNumber(value, 0, 20, 0);
  else if (key === 'sunoVolume') S.sunoVolume = clampNumber(value, 20, 100, 95);
  else if (key === 'announcementGain') S.announcementGain = clampNumber(value, 1, 3.4, 2.65);
  else if (key === 'rate') S.rate = clampNumber(value, .75, 1.15, .94);
  else if (key === 'pitch') S.pitch = clampNumber(value, .85, 1.15, 1);
  S.audioControlUpdatedAt = Date.now();
  localSave();
  syncVolumeReadouts();
}

function audioSettingsPayload() {
  return {
    spotifyDuckedVolume: clampNumber(S.spotifyDuckedVolume, 0, 20, 0),
    sunoVolume: clampNumber(S.sunoVolume, 20, 100, 95),
    announcementGain: clampNumber(S.announcementGain, 1, 3.4, 2.65),
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
  S.audioControlUpdatedAt = Date.now();
  music.volume = music.paused ? music.volume : Math.max(.01, audio.sunoVolume / 100);
  if (!announcementMusic.paused) announcementMusic.volume = Math.max(.01, audio.sunoVolume / 100);
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
      audioControlUpdatedAt: S.audioControlUpdatedAt || Date.now(),
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
      audioControlUpdatedAt: S.audioControlUpdatedAt || Date.now(),
      label: `Set Spotify volume to ${volume}%`,
      detail: `Spotify music volume ${volume}%; announcements stay at full announcement volume.`
    }, `Spotify volume ${volume}% sent to all active receivers. Announcements stay loud.`);
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
    setFeedback(S.screen === 'home' ? 'Spotify connected on this receiver. Tap Activate + Play Spotify.' : 'Spotify connected on this browser. Command mode will send playback to all active receivers.', true);
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
        reject(Error('Spotify receiver did not report ready. Tap Activate + Play Spotify on the speaker-connected receiver.'));
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
    S.spotifyDeviceName = 'Poolside Pulse V11 Receiver';
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
    setSpotifyStatus('Spotify receiver went offline. Leave Home open and tap Activate + Play again.', false);
    localSave();
    renderWhenIdle();
  });
  spotifyPlayer.addListener('autoplay_failed', () => {
    setSpotifyStatus('Spotify is ready, but this browser blocked autoplay. Tap Activate + Play Spotify on the receiver.', false);
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
      name: 'Poolside Pulse V11 Receiver',
      getOAuthToken: callback => spotifyAccessToken().then(callback).catch(error => setSpotifyStatus(`Spotify token failed: ${error.message}`, false)),
      volume: (Number(S.spotifyVolume) || 92) / 100
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

async function activateSpotifyElement() {
  try {
    if (spotifyPlayer && typeof spotifyPlayer.activateElement === 'function') await spotifyPlayer.activateElement();
  } catch {}
}

function warmSpotifyReceiver() {
  if (S.screen !== 'home' || !receiverSessionStartedAt() || !receiverAudioReady() || S.musicProvider !== 'spotify' || !spotifyLoggedIn()) return;
  if (spotifyPlayer || spotifyPrimePromise || spotifyWarmPromise) return;
  spotifyWarmPromise = primeSpotifyPlayer()
    .then(() => checkSpotifyHealth(false).catch(() => {}))
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
  if (fromTap) await activateSpotifyElement();
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
      setSpotifyStatus(`Spotify did not start on this iPhone browser: ${error.message || error}. Keep Home open and tap Start Receiver + Spotify again.`, false);
      localSave();
      throw error;
    }
  }
  S.spotifyDeviceId = deviceId;
  S.spotifyDeviceName = S.spotifyDeviceName || 'Poolside Pulse V11 Receiver';
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
      volume: Number.isFinite(Number(device.volume_percent)) ? Number(device.volume_percent) : null
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
        throw actionNeededError(`Spotify receiver is not ready on this phone yet. Tap Start Receiver + Play on the speaker-connected Home phone. ${error.message || ''}`.trim());
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
    await spotifyPlayer.setVolume(clampNumber(percent, 0, 100, 92) / 100);
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

async function sendSpotifyPlayback(playUrl, deviceId) {
  await spotifyApi('PUT', '/me/player', { device_ids: [deviceId], play: false });
  await spotifyApi('PUT', '/me/player/play', spotifyBody(playUrl), { device_id: deviceId });
  await spotifySetVolume(S.spotifyVolume, deviceId, { preferKnown: true });
  return await spotifyActuallyPlaying(deviceId);
}

function markSpotifyPlaybackAccepted(playUrl) {
  S.intent = 'playing';
  S.spotifyNowPlaying = sourceLabel('spotify', playUrl);
  S.spotifyStatus = `Spotify play accepted on receiver: ${sourceLabel('spotify', playUrl)}.`;
  S.spotifyNeedsTap = false;
  receiverActive = true;
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
  const audible = await sendSpotifyPlayback(playUrl, deviceId);
  if (audible) {
    markSpotifyPlaybackAccepted(playUrl);
  } else {
    const message = 'Spotify accepted the command, but this Home receiver is not the audible Spotify device yet. Tap Start Receiver + Play on the speaker-connected phone once.';
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
  const state = await spotifyPlaybackState().catch(() => null);
  const deviceId = state?.deviceId || spotifyWebDeviceId || S.spotifyDeviceId || await spotifyTargetDevice({ preferActive: true, preferPoolside: true, allowStart: false }).catch(() => '');
  const method = await pauseSpotifyForAnnouncement(deviceId);
  if (!method) throw actionNeededError('Spotify is playing, but this receiver could not pause the active Spotify device. Tap Start Receiver + Spotify once, then press Stop again.');
  S.intent = 'paused';
  setManualMusicHold('Spotify paused manually');
  setSpotifyStatus(`Spotify paused on receiver via ${method}.`, true);
  logEvent('pause', 'Spotify paused', method);
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
    volume: current?.volume ?? clampNumber(S.spotifyVolume, 0, 100, 92),
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
    const restoreVolume = clampNumber(S.spotifyVolume, 0, 100, snapshot.volume ?? 92);
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
  const snapshot = { volume: Number.isFinite(music.volume) ? music.volume : Number(S.sunoVolume || 95) / 100, wasPlaying: !music.paused };
  await fade(music, Number(S.sunoDuckedVolume || 2) / 100, 500);
  return snapshot;
}

async function restoreSunoAfterAnnouncement(snapshot) {
  if (!snapshot) return;
  try {
    if (snapshot.wasPlaying && music.paused) await music.play();
    await fade(music, snapshot.volume || Number(S.sunoVolume || 95) / 100, 700);
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
      announcementMusic.volume = Math.max(.01, Number(S.sunoVolume || 95) / 100);
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
    throw actionNeededError(`Receiver could not start the Suno announcement: ${error.message}. Tap Start Receiver on the speaker-connected phone, then send it again.`);
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
  const helperPlayback = helperPlayAnnouncementBlob(blob, { gain: S.announcementGain });
  if (helperPlayback) {
    return await helperPlayback;
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
        reject(Error('Announcement audio did not start. Tap Start Receiver on this speaker-connected device.'));
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
        reject(Error('Device speech did not start. Tap Activate Receiver once, then send Speak Now again.'));
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
    throw actionNeededError(`Receiver could not start voice audio: ${error.message}. Tap Start Receiver on the speaker-connected phone, then send Speak Now again.`);
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

function setManualMusicHold(reason = 'Manual stop') {
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

function itemBody(item) {
  if (!item) return '';
  if (item.type === 'suno' || item.type === 'spotify') return item.url || '';
  if (item.type === 'sunoAnnouncement') {
    const itemTrack = S.tracks[Number(item.trackIndex) || 0];
    return itemTrack ? `Suno announcement: ${itemTrack.title}` : 'Suno announcement track';
  }
  if (item.type === 'song') {
    const itemTrack = S.tracks[Number(item.trackIndex) || 0];
    return itemTrack ? `Specific song: ${itemTrack.title}` : 'Specific Suno song';
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
    await sendSunoAnnouncement(Number(item.trackIndex) || 0, !!item.hold, item.label || 'Scheduled Suno announcement');
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
    const index = Math.max(0, Math.min(Number(item.trackIndex) || 0, Math.max(0, S.tracks.length - 1)));
    S.current = index;
    S.musicProvider = 'suno';
    if (S.screen !== 'home') await issueCommand('song', { label: item.label, trackIndex: index, provider: 'suno', detail: `Scheduled Suno song: ${(S.tracks[index] || {}).title || 'track'}` }, `Suno song sent to receivers: ${(S.tracks[index] || {}).title || item.label}`);
    else await playSuno(false);
    return;
  }
  if (item.type === 'suno') {
    if (!item.url) throw Error('This schedule item has no Suno URL.');
    S.musicProvider = 'suno';
    S.playlistUrl = item.url;
    if (S.screen !== 'home') await issueCommand('suno', { label: item.label, url: item.url, detail: `Scheduled Suno URL: ${compactUrl(item.url)}` }, `Suno item sent to receivers: ${item.label}`);
    else {
      await importSuno('Scheduled Suno URL imported.');
      await playSuno(false);
    }
    return;
  }
  await sendAnnouncement(itemBody(item), !!item.hold, item.label || 'Scheduled announcement');
}

function createScheduleItem() {
  const item = { id: `sched-${uid()}`, label: 'New Schedule Item', type: 'announcement', time: '10:00', announcementId: S.selected, enabled: true };
  S.schedule.push(item);
  S.editId = item.id;
  save('New schedule item added.');
}

function addSongSchedule(index) {
  const itemTrack = S.tracks[Math.max(0, Math.min(Number(index) || 0, Math.max(0, S.tracks.length - 1)))] || {};
  const item = { id: `sched-${uid()}`, label: `Play ${itemTrack.title || 'Suno song'}`, type: 'song', time: '10:00', trackIndex: Number(index) || 0, enabled: true };
  S.schedule.push(item);
  S.editId = item.id;
  S.tab = 'schedule';
  save(`Added ${item.label} to the daily schedule.`);
}

function saveRow(index) {
  const row = S.schedule[index];
  if (!row) {
    setFeedback('Schedule item not found.', false);
    return;
  }
  const kind = document.querySelector(`[data-kind="${index}"]`)?.value || 'announcement';
  const body = document.querySelector(`[data-body="${index}"]`)?.value.trim() || '';
  row.label = document.querySelector(`[data-label="${index}"]`)?.value || row.label;
  row.time = document.querySelector(`[data-row-time="${index}"]`)?.value || row.time || '10:00';
  delete row.offsetToClose;
  delete row.announcementId;
  delete row.url;
  delete row.text;
  delete row.trackIndex;
  if (kind === 'song') {
    row.type = 'song';
    row.trackIndex = Math.max(0, Math.min(Number(document.querySelector(`[data-track="${index}"]`)?.value) || 0, Math.max(0, S.tracks.length - 1)));
  } else if (kind === 'sunoAnnouncement') {
    row.type = 'sunoAnnouncement';
    row.trackIndex = Math.max(0, Math.min(Number(document.querySelector(`[data-track="${index}"]`)?.value) || 0, Math.max(0, S.tracks.length - 1)));
  } else if (kind === 'suno') {
    row.type = 'suno';
    row.url = body || S.playlistUrl;
    if (!row.url) {
      setFeedback('Paste a Suno URL before saving.', false);
      return;
    }
  } else if (kind === 'spotify') {
    row.type = 'spotify';
    row.url = body || S.spotifyUrl;
    if (!row.url) {
      setFeedback('Paste a Spotify URL before saving.', false);
      return;
    }
  } else if (kind === 'text') {
    row.type = 'text';
    row.text = body || 'Type announcement text here.';
  } else {
    row.type = 'announcement';
    row.announcementId = document.querySelector(`[data-selann="${index}"]`)?.value || S.selected;
  }
  save(`Schedule item saved: ${row.label}.`);
}

function partyCues({ includeDisabled = false } = {}) {
  return list(S.partySchedule?.cues)
    .filter(cue => includeDisabled || cue.enabled)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
}

function partyCueById(id) {
  return partyCues({ includeDisabled: true }).find(cue => cue.id === id) || null;
}

function partySelectedCue() {
  return partyCueById(S.partySelectedCueId) || partyCues()[0] || partyCues({ includeDisabled: true })[0] || null;
}

function partyCueIndex(id, enabledOnly = true) {
  return partyCues({ includeDisabled: !enabledOnly }).findIndex(cue => cue.id === id);
}

function partyActive() {
  return S.poolMode === 'weeklyParty' && ['running', 'paused', 'waiting', 'weatherHold'].includes(S.partyState);
}

function partyNormalPoolSuspended() {
  return S.poolMode === 'weeklyParty' && ['running', 'paused', 'waiting', 'weatherHold'].includes(S.partyState);
}

function logParty(title, detail = '') {
  const item = { id: uid(), ts: Date.now(), time: stamp(), title, detail };
  S.partyLog = mergeById(80, true, [item], S.partyLog);
  logEvent('party', title, detail);
  localSave();
  return item;
}

function partyProgress() {
  const cues = partyCues();
  const index = Math.max(0, partyCueIndex(S.partyCurrentCueId));
  return { cues, index, total: cues.length, done: S.partyState === 'complete' ? cues.length : Math.min(index + 1, cues.length) };
}

function partyCueLabel(cue) {
  if (!cue) return 'No cue selected';
  const type = PARTY_CUE_TYPES[cue.type] || cue.type;
  const source = cue.trackTitle || cue.sourceLabel || cue.speaker || '';
  return `${type}: ${cue.title}${source ? ` - ${source}` : ''}`;
}

function clearPartyTimer() {
  clearTimeout(partyAdvanceTimer);
  partyAdvanceTimer = null;
}

function directAudioUrl(url) {
  return /^https?:\/\//i.test(String(url || '')) && /\.(mp3|m4a|aac|wav|ogg|oga|webm)(\?|#|$)/i.test(String(url || ''));
}

function choosePartyVoice(profile = {}) {
  const preferred = String(profile.voiceURI || '').toLowerCase();
  if (preferred) {
    const exact = voices.find(voice => String(voice.voiceURI || voice.name || '').toLowerCase() === preferred || String(voice.name || '').toLowerCase() === preferred);
    if (exact) return exact;
  }
  const english = voices.filter(voice => /^en/i.test(voice.lang || ''));
  const gender = profile.preferredGender || 'neutral';
  const maleTerms = ['male', 'daniel', 'alex', 'fred', 'tom', 'david', 'aaron', 'nathan', 'guy', 'mark'];
  const femaleTerms = ['female', 'samantha', 'victoria', 'allison', 'ava', 'susan', 'karen', 'zoe', 'jenny', 'aria', 'serena'];
  const terms = gender === 'male' ? maleTerms : gender === 'female' ? femaleTerms : [];
  return english.find(voice => terms.some(term => String(voice.name || '').toLowerCase().includes(term))) || bestVoices()[0] || voices[0] || null;
}

function partyVoiceProfile(cue) {
  const profiles = list(S.partySchedule?.voiceProfiles);
  const id = cue?.voiceProfileId || cue?.speaker || 'manager';
  return profiles.find(profile => profile.id === id) || profiles.find(profile => profile.speaker === cue?.speaker) || profiles.find(profile => profile.id === 'manager') || normalizeVoiceProfile({});
}

function speakPartyText(text, profile) {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      reject(Error('No device speech engine is available on this receiver.'));
      return;
    }
    let settled = false;
    const utterance = new SpeechSynthesisUtterance(tokens(text));
    const voice = choosePartyVoice(profile);
    if (voice) utterance.voice = voice;
    utterance.rate = clampNumber(profile.rate, .65, 1.35, 1);
    utterance.pitch = clampNumber(profile.pitch, .65, 1.35, 1);
    utterance.volume = clampNumber(profile.volume, .1, 1, 1);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(Error('Party speech did not start. Tap Start Receiver on the speaker-connected Home phone.'));
    }, 5000);
    utterance.onstart = () => clearTimeout(timeout);
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
      reject(Error(event?.error || 'Party speech failed.'));
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  });
}

async function playPartySpeech(cue) {
  const profile = partyVoiceProfile(cue);
  await ensureReceiverAudio('party spoken cue', { required: true });
  const spotifySnapshot = S.partySchedule.settings.duckMusicDuringSpeech && cue.duckOtherAudio ? await duckSpotifyForAnnouncement() : null;
  const sunoSnapshot = S.partySchedule.settings.duckMusicDuringSpeech && cue.duckOtherAudio ? await duckSunoForAnnouncement() : null;
  try {
    await speakPartyText(cue.text || cue.title, profile);
  } finally {
    await restoreSpotifyAfterAnnouncement(spotifySnapshot);
    await restoreSunoAfterAnnouncement(sunoSnapshot);
  }
}

async function playPartyAudioUrl(cue) {
  if (!cue.url) throw Error('This cue has no audio URL.');
  await ensureReceiverAudio('party audio cue', { required: true });
  await pauseSpotifyForSunoPlayback();
  await pauseSunoForSpotifyPlayback();
  announcementMusic.pause();
  announcementMusic.src = cue.url;
  announcementMusic.muted = false;
  announcementMusic.volume = clampNumber(cue.volume, 0, 100, 95) / 100;
  await announcementMusic.play();
  await fade(announcementMusic, clampNumber(cue.volume, 0, 100, 95) / 100, Math.max(0, Number(cue.fadeInSeconds || 0)) * 1000);
}

function waitForPartyManual(cue, reason = 'Manual advance required.') {
  clearPartyTimer();
  S.partyState = 'waiting';
  S.partyManualWait = true;
  setFeedback(`${cue.title}: ${reason}`, true);
  logParty('Party waiting', `${cue.title}: ${reason}`);
  localSave();
  renderWhenIdle();
}

function schedulePartyAdvance(cue, seconds = 0) {
  clearPartyTimer();
  const ms = Math.max(1, Number(seconds || cue.durationSeconds || 0)) * 1000;
  partyAdvanceTimer = setTimeout(() => {
    partyAdvanceTimer = null;
    if (S.partyState === 'running' && S.partyCurrentCueId === cue.id) advancePartyCue(1, false).catch(error => setFeedback(error.message || String(error), false));
  }, ms);
}

async function finishPartyCue(cue) {
  if (S.partyState !== 'running' || S.partyCurrentCueId !== cue.id) return;
  if (cue.requiresManualAdvance || cue.durationMode === 'manual') {
    waitForPartyManual(cue, 'Press Skip/Continue when ready.');
    return;
  }
  if (cue.durationMode === 'timed' && Number(cue.durationSeconds || 0) > 0) {
    schedulePartyAdvance(cue, cue.durationSeconds);
    return;
  }
  await advancePartyCue(1, false);
}

async function runPartyCue(cueId, { test = false } = {}) {
  if (S.screen !== 'home') return;
  const cue = partyCueById(cueId);
  if (!cue) throw Error('Party cue not found.');
  if (!cue.enabled && !test) {
    await advancePartyCue(1, false);
    return;
  }
  clearPartyTimer();
  S.poolMode = 'weeklyParty';
  S.partyState = 'running';
  S.partyManualWait = false;
  S.partyCurrentCueId = cue.id;
  S.partySelectedCueId = cue.id;
  S.partyCueStartedAt = Date.now();
  if (!S.partyStartedAt) S.partyStartedAt = Date.now();
  logParty(test ? 'Testing party cue' : 'Party cue started', partyCueLabel(cue));
  localSave();
  renderWhenIdle();

  try {
    if (['spoken', 'game', 'prize', 'safety', 'weather'].includes(cue.type)) {
      await playPartySpeech(cue);
      await finishPartyCue(cue);
    } else if (cue.type === 'spotify') {
      S.musicProvider = 'spotify';
      if (cue.url) S.spotifyUrl = cue.url;
      S.spotifyVolume = clampNumber(cue.volume, 0, 100, S.spotifyVolume);
      try {
        if (cue.url) await playSpotifyUrl(cue.url, false, { fromRemote: true });
      } catch (error) {
        logParty('Spotify cue fallback', `${cue.title}: ${error.message || String(error)}. Use Spotify manually, then continue.`);
      }
      await finishPartyCue(cue);
    } else if (cue.type === 'suno') {
      S.musicProvider = 'suno';
      S.sunoVolume = clampNumber(cue.volume, 20, 100, S.sunoVolume);
      if (directAudioUrl(cue.url)) {
        await playPartyAudioUrl(cue);
      } else if (/suno\.com\/playlist\//i.test(cue.url || '')) {
        S.playlistUrl = cue.url;
        await importSuno('Party Suno playlist imported.');
        await playSuno(false);
      } else {
        logParty('Suno cue fallback', `${cue.title}: paste a direct audio URL or imported Suno playlist for automatic playback.`);
      }
      await finishPartyCue(cue);
    } else if (cue.type === 'customAudio') {
      if (directAudioUrl(cue.url)) await playPartyAudioUrl(cue);
      else logParty('Custom audio fallback', `${cue.title}: URL is not a direct playable audio file.`);
      await finishPartyCue(cue);
    } else {
      waitForPartyManual(cue, cue.text || cue.notes || 'Manual checkpoint.');
    }
    if (test) {
      S.partyState = 'paused';
      setFeedback(`Test completed: ${cue.title}.`, true);
      localSave();
      renderWhenIdle();
    }
  } catch (error) {
    S.partyState = 'waiting';
    S.partyManualWait = true;
    logParty('Party cue needs attention', `${cue.title}: ${error.message || String(error)}`);
    setActionNeeded(`${cue.title}: ${error.message || String(error)} Press Skip to continue the party schedule.`);
    localSave();
    renderWhenIdle();
  }
}

async function startPartySchedule(push = true, cueId = '') {
  const startCue = cueId ? partyCueById(cueId) : partySelectedCue();
  const cue = startCue?.enabled ? startCue : partyCues()[0];
  if (!cue) throw Error('No enabled party cues are available.');
  if (S.screen !== 'home' && push) {
    S.poolMode = 'weeklyParty';
    S.partyState = 'running';
    S.partySelectedCueId = cue.id;
    await issueCommand('party-control', { action: 'start', cueId: cue.id, label: 'Play Party Schedule', detail: cue.title }, 'Weekly Party schedule command sent to all active receivers.');
    return;
  }
  S.poolMode = 'weeklyParty';
  S.partyStartedAt = Date.now();
  S.partyElapsedMs = 0;
  S.partyWeatherHold = false;
  S.partyManualWait = false;
  logParty('Weekly Party Mode started', cue.title);
  await runPartyCue(cue.id);
  await pushState('Weekly Party Mode started on receiver.', { render: false });
}

async function advancePartyCue(delta = 1, push = true) {
  if (S.screen !== 'home' && push) {
    await issueCommand('party-control', { action: delta < 0 ? 'back' : 'skip', label: delta < 0 ? 'Back party cue' : 'Skip party cue' }, delta < 0 ? 'Party back command sent.' : 'Party skip command sent.');
    return;
  }
  const cues = partyCues();
  if (!cues.length) return;
  const currentId = S.partyCurrentCueId || S.partySelectedCueId;
  const currentIndex = Math.max(0, cues.findIndex(cue => cue.id === currentId));
  const next = cues[currentIndex + delta];
  if (!next) {
    clearPartyTimer();
    S.partyState = 'complete';
    S.partyManualWait = false;
    S.partyCurrentCueId = '';
    logParty('Weekly Party schedule complete', 'All enabled cues have finished.');
    await pushState('Weekly Party schedule complete.', { render: false });
    renderWhenIdle();
    return;
  }
  await runPartyCue(next.id);
  await pushState('Party cue advanced.', { render: false });
}

async function pausePartySchedule(push = true, reason = 'Party paused') {
  if (S.screen !== 'home' && push) {
    await issueCommand('party-control', { action: 'pause', label: 'Pause Party Schedule', detail: reason }, 'Party pause command sent.');
    return;
  }
  clearPartyTimer();
  partyPausedCue = S.partyCurrentCueId;
  S.partyState = reason === 'weather' ? 'weatherHold' : 'paused';
  S.partyPausedAt = Date.now();
  S.partyManualWait = false;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  try { announcementMusic.pause(); } catch {}
  try { music.pause(); } catch {}
  await pauseSpotifyForAnnouncement(S.spotifyDeviceId || spotifyWebDeviceId || '').catch(() => '');
  logParty(reason === 'weather' ? 'Party paused for weather' : 'Party paused', partyCueById(S.partyCurrentCueId)?.title || '');
  await pushState(reason === 'weather' ? 'Party paused for weather alert.' : 'Party paused.', { render: false });
  renderWhenIdle();
}

async function resumePartySchedule(push = true) {
  if (S.screen !== 'home' && push) {
    await issueCommand('party-control', { action: 'resume', label: 'Resume Party Schedule' }, 'Party resume command sent.');
    return;
  }
  const cue = partyCueById(partyPausedCue || S.partyCurrentCueId || S.partySelectedCueId) || partySelectedCue();
  if (!cue) throw Error('No party cue is available to resume.');
  S.partyWeatherHold = false;
  logParty('Party resumed', cue.title);
  await runPartyCue(cue.id);
  await pushState('Party resumed.', { render: false });
}

async function stopPartySchedule(push = true) {
  if (S.screen !== 'home' && push) {
    await issueCommand('party-control', { action: 'stop', label: 'Stop Party Schedule' }, 'Party stop command sent.');
    return;
  }
  clearPartyTimer();
  S.partyState = 'stopped';
  S.partyManualWait = false;
  S.partyCurrentCueId = '';
  S.partyStartedAt = 0;
  S.partyCueStartedAt = 0;
  S.poolMode = 'normalPool';
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  try { announcementMusic.pause(); } catch {}
  logParty('Weekly Party Mode stopped', 'Returned to Normal Pool Mode.');
  await pushState('Weekly Party Mode stopped.', { render: false });
  renderWhenIdle();
}

async function testPartyCue(cueId = S.partySelectedCueId, push = true) {
  const cue = partyCueById(cueId);
  if (!cue) throw Error('Select a party cue first.');
  if (S.screen !== 'home' && push) {
    await issueCommand('party-control', { action: 'test', cueId: cue.id, label: 'Test Party Cue', detail: cue.title }, `Test cue command sent: ${cue.title}.`);
    return;
  }
  await runPartyCue(cue.id, { test: true });
}

async function partySafetyInterrupt(cueId = 'party-61', push = true) {
  const cue = partyCueById(cueId) || partyCues({ includeDisabled: true }).find(item => item.type === 'safety');
  if (!cue) throw Error('No safety cue is configured.');
  if (S.screen !== 'home' && push) {
    await issueCommand('party-safety', { cueId: cue.id, label: 'Party Safety Interruption', detail: cue.title }, 'Party safety interruption sent.');
    return;
  }
  await pausePartySchedule(false, 'weather');
  await runPartyCue(cue.id, { test: true });
}

async function runPartyControl(action, payload = {}) {
  if (action === 'start') return await startPartySchedule(false, payload.cueId || '');
  if (action === 'pause') return await pausePartySchedule(false);
  if (action === 'resume') return await resumePartySchedule(false);
  if (action === 'stop') return await stopPartySchedule(false);
  if (action === 'skip') return await advancePartyCue(1, false);
  if (action === 'back') return await advancePartyCue(-1, false);
  if (action === 'restart') return await startPartySchedule(false, partyCues()[0]?.id || '');
  if (action === 'test') return await testPartyCue(payload.cueId || S.partySelectedCueId, false);
  throw Error(`Unknown party action: ${action}`);
}

async function tick() {
  if (!receiverCanProcessEvents() || speaking) return;
  if (S.lightningClearAt && Date.now() >= Number(S.lightningClearAt) && !S.lightningAllClearSent) {
    S.lightningAllClearSent = true;
    S.lightningClearAt = 0;
    await sendAnnouncement(tokens(S.lightningClearText), false, 'Lightning all clear');
  }
  if (!partyNormalPoolSuspended() && S.autoStart && shouldPlayContinuously() && S.intent !== 'playing' && !manualMusicHoldActive()) {
    try { await playSelected(false); } catch {}
  }
  if (!partyNormalPoolSuspended() && S.autoStop && S.playbackMode === 'hours' && !openNow() && S.intent === 'playing') await stopSelected(false);
  if (partyNormalPoolSuspended()) return;
  const now = hm(new Date().getHours() * 60 + new Date().getMinutes());
  for (const item of S.schedule) {
    if (!item.enabled || schedTime(item) !== now) continue;
    const key = `${today()}:${item.id}:${schedTime(item)}`;
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
      if (partyActive()) await pausePartySchedule(false, 'weather');
      await sendAnnouncement(weatherAnnouncement(data), true, 'Lightning hold');
    } else {
      setFeedback(`Lightning threat still present; ${lightningRemainingText()}`, true);
    }
  } else if (data.threat) {
    const threatKey = `${today()}:${data.threatType}:${String(data.summary || '').slice(0, 140)}`;
    if (S.weatherLastThreatKey !== threatKey) {
      S.weatherLastThreatKey = threatKey;
      if (partyActive()) await pausePartySchedule(false, 'weather');
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
  if (!receiverSessionStartedAt()) return 'Tap Start Receiver to begin a fresh receiver session.';
  if (!receiverAudioReady()) return 'Tap Start Receiver on this speaker-connected phone.';
  if (S.musicProvider === 'spotify') {
    if (!spotifyLoggedIn()) return 'Spotify login needed on receiver.';
    if (S.spotifyAccountProduct && S.spotifyAccountProduct !== 'premium') return `Spotify Premium needed: ${S.spotifyAccountProduct}.`;
    if (!spotifyDeviceReady()) return 'Tap Start Spotify Receiver on this phone.';
    if (spotifyPlayerReady && spotifyWebDeviceId) return `Ready: ${S.spotifyDeviceName || 'Poolside Pulse receiver'}.`;
    return `Ready: ${S.spotifyDeviceName || 'active Spotify device'}.`;
  }
  return hasPlayableSuno() ? 'Suno queue ready.' : 'Import Suno queue.';
}

function spotifyDeviceReady() {
  if (S.musicProvider !== 'spotify') return true;
  if (S.screen === 'home') {
    const recentlyReady = !!S.spotifyDeviceId && Date.now() - Number(S.spotifyReceiverReadyAt || 0) < 10 * 60 * 1000;
    return ((spotifyPlayerReady && !!spotifyWebDeviceId) || recentlyReady) && !S.spotifyNeedsTap;
  }
  return (((spotifyPlayerReady && !!spotifyWebDeviceId) || !!S.spotifyDeviceId) && !S.spotifyNeedsTap);
}

function receiverCanPause() {
  if (S.intent !== 'playing' || !receiverAudioReady()) return false;
  if (S.musicProvider === 'spotify') return spotifyDeviceReady();
  return true;
}

function header() {
  return `<header class="top"><div class="brand"><div class="brandMark">SS</div><div class="brandText"><b>Serenity Shores</b><small>Poolside Pulse · Version 11</small></div></div><nav class="modeSwitch"><button id="home" class="${S.screen === 'home' ? 'on' : ''}" aria-pressed="${S.screen === 'home'}">Home</button><button id="cmd" class="${S.screen !== 'home' ? 'on' : ''}" aria-pressed="${S.screen !== 'home'}">Command</button></nav></header>`;
}

function nav() {
  const tabs = [
    ['command', 'Command'],
    ['party', 'Party'],
    ['music', 'Music'],
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
  return `${header()}<main class="wrap commandWrap"><div class="topStatus">Poolside Pulse · Version 11 · Weekly Party Command Page · <span class="pill ${syncClass}">${esc(S.sync ? 'Sync active' : 'Preview sync')}</span> · ${esc(S.syncMode || '')} · ${esc(deviceLabel())}</div>${nav()}<div id="feedbackBox" class="statusBar"><b>Status:</b> ${esc(S.feedback || 'Ready.')}</div>${notice}${error ? `<div class="alert warn"><b>Last Error:</b> ${esc(error)}</div>` : ''}${body}</main>`;
}

function login() {
  return `${header()}<main class="wrap"><section class="login"><p class="eyebrow">Command Login</p><h1>Command</h1><p>Enter the shared command PIN to control active receivers.</p><label>PIN<input id="pin" inputmode="numeric" type="password" autocomplete="one-time-code"></label><button id="login">Unlock Command</button><p class="muted">${esc(S.feedback || '')}</p></section></main>`;
}

function statusCards() {
  const startedAt = receiverSessionStartedAt() || Number(S.receiverActiveAt || 0) || Date.now();
  const inbox = S.screen === 'home'
    ? recentEvents(S.events).filter(shouldProcessEvent).length
    : recentEvents(S.events).filter(event => eventTime(event) >= startedAt - RECEIVER_EVENT_GRACE_MS).length;
  return `<div class="stats"><div class="stat"><b>Selected</b><strong>${esc(sourceLabel(S.musicProvider, activeProviderUrl()))}</strong></div><div class="stat"><b>Receiver</b><strong>${esc(S.screen === 'home' ? receiverReadiness() : (S.receiverStatus || 'No receiver report yet.'))}</strong></div><div class="stat"><b>Remote</b><strong>Event inbox ${inbox}</strong></div><div class="stat"><b>Announcements</b><strong>${Math.round(Number(S.announcementGain || 1) * 100)}% / music ${esc(S.spotifyDuckedVolume)}%</strong></div></div>`;
}

function readinessSteps() {
  const audioOk = receiverAudioReady();
  const sessionOk = receiverSessionStartedAt() > 0;
  const spotifyOk = S.musicProvider !== 'spotify' || spotifyLoggedIn();
  const deviceOk = spotifyDeviceReady();
  const steps = [
    { label: 'Home screen open', ok: true, action: '', help: 'This screen is open.' },
    { label: 'Fresh session', ok: sessionOk, action: 'audio', help: 'Tap to ignore old commands and start clean.' },
    { label: 'Audio unlocked', ok: audioOk, action: 'audio', help: 'Tap to unlock iPhone speaker audio.' },
    { label: 'Spotify logged in', ok: spotifyOk, action: 'login', help: 'Tap to connect Spotify on this receiver.' },
    { label: 'Spotify device ready', ok: deviceOk, action: 'spotify', help: 'Tap to make this phone the Spotify speaker device.' },
    { label: 'KV sync', ok: !!S.sync, action: 'sync', help: 'Tap to refresh cloud sync.' }
  ];
  return `<div class="steps">${steps.map(step => {
    const inner = `<span>${step.ok ? 'OK' : 'TODO'}</span><strong>${esc(step.label)}</strong>${step.ok ? '' : `<small>${esc(step.help)}</small>`}`;
    return step.ok || !step.action
      ? `<div class="step done">${inner}</div>`
      : `<button type="button" class="step todo stepButton" data-ready-action="${esc(step.action)}">${inner}</button>`;
  }).join('')}</div>`;
}

function receiverActionButtons() {
  const spotifyMode = S.musicProvider === 'spotify';
  const audioOk = receiverAudioReady();
  const needsLogin = spotifyMode && !spotifyLoggedIn();
  const needsStart = !audioOk || (spotifyMode && !spotifyDeviceReady());
  const label = receiverCanPause()
    ? 'Pause Music'
    : needsStart
      ? (spotifyMode ? 'Start Receiver + Spotify' : 'Start Receiver')
      : 'Play / Resume Music';
  const primary = audioOk && needsLogin
    ? '<button id="spotifyLoginHome" class="primaryWide">Login Spotify on This Receiver</button>'
    : `<button id="playHome" class="primaryWide">${esc(label)}</button>`;
  return `<div class="receiverActions">${primary}<button id="testToneHome" class="secondary">Test Tone</button><button id="checkWeatherHome" class="secondary">Check Weather</button><button id="skipHome" class="secondary">Skip</button><button id="stopHome" class="secondary">Stop</button></div>`;
}

function receiverNotice() {
  let message = '';
  if (!receiverSessionStartedAt() || !receiverAudioReady()) message = 'Tap the big Start Receiver button. That one tap starts a fresh receiver session, ignores old commands, and unlocks iPhone audio.';
  else if (S.musicProvider === 'spotify' && !spotifyLoggedIn()) message = 'Tap Login Spotify on This Receiver. Spotify must be connected on the speaker phone, not on a Command laptop.';
  else if (S.musicProvider === 'spotify' && !spotifyDeviceReady()) message = 'Tap Start Receiver + Spotify or the Spotify device ready TODO row to make this phone the speaker device.';
  else if (manualMusicHoldActive()) message = `${S.manualMusicHoldReason || 'Music stopped manually'}. Auto-start will stay off until the next Play command or pool opening cycle.`;
  else message = S.setupNotice || '';
  return message ? `<div class="actionNotice"><b>Next step:</b> ${esc(message)}</div>` : '';
}

function homePage() {
  const current = track();
  const next = S.schedule.filter(item => item.enabled).sort((a, b) => mins(schedTime(a)) - mins(schedTime(b))).slice(0, 5)
    .map(item => `<p class="line"><b>${pretty(schedTime(item))}</b><span>${esc(item.label)}</span></p>`).join('');
  const label = sourceLabel(S.musicProvider, activeProviderUrl());
  const error = visibleLastError();
  const live = receiverCanPause();
  return `${header()}<main class="home console"><section class="receiverConsole"><div class="receiverLead"><p class="eyebrow">Home Receiver · Version 11</p><h1>Sound Station</h1><p>This phone must stay on Home because it is the only device that plays Spotify, Suno, voice announcements, weekly party cues, scheduled audio, and weather safety messages through the speakers.</p>${receiverActionButtons()}${receiverNotice()}${error ? `<div class="alert warn">${esc(error)}</div>` : ''}</div><aside class="setupPanel"><h2>Receiver Readiness</h2>${readinessSteps()}<div class="miniFacts"><b>Selected:</b> ${esc(label)}<br><b>Mode:</b> ${S.poolMode === 'weeklyParty' ? 'Weekly Party Mode' : 'Normal Pool Mode'}<br><b>Status:</b> ${esc(receiverReadiness())}<br><b>Audio:</b> ${esc(S.audioStatus)}</div></aside></section><section class="nowCompact"><div><p class="eyebrow">${S.poolMode === 'weeklyParty' ? 'Weekly Party Mode' : live ? 'Now Playing' : S.intent === 'paused' ? 'Paused' : 'Ready'}</p><h2>${esc(S.partyCurrentCueId ? partyCueById(S.partyCurrentCueId)?.title || 'Party Cue' : S.musicProvider === 'spotify' ? (S.spotifyNowPlaying || 'Spotify Receiver') : current.title)}</h2><p>${esc(S.partyCurrentCueId ? partyCueLabel(partyCueById(S.partyCurrentCueId)) : S.musicProvider === 'spotify' ? compactUrl(S.spotifyUrl) : `${current.artist || 'Suno'} · ${current.duration || ''}`)}</p><p class="muted">${esc(S.activeMusicLabel || label)}</p></div><div class="signal ${live || S.partyState === 'running' ? 'live' : ''}"><span></span><span></span><span></span></div></section><section class="cards"><div class="card"><h3>Next Scheduled</h3>${partyNormalPoolSuspended() ? '<p class="muted">Normal pool schedule is suspended while Weekly Party Mode is active.</p>' : next || '<p class="muted">No enabled schedule items.</p>'}</div><div class="card"><h3>Recent Receiver Log</h3>${logRows(5)}</div></section></main>`;
}

function commandPage() {
  const selected = ann();
  return shell(`<section class="commandConsole"><div><p class="eyebrow">Live Control</p><h1>Command</h1><p>Command devices send instructions to every active receiver. Speaker phones stay on Home and play all sound.</p></div>${statusCards()}</section><section class="panel controlDeck"><div class="sectionHead"><h2>Receiver Controls</h2><span class="pill ${S.receiverStatus && !receiverActionNeeded(S.receiverStatus) ? 'good' : 'warn'}">${esc(S.receiverStatus || 'No receiver report yet')}</span></div><div class="bigControls"><button id="playCmd">Play / Resume</button><button id="pauseCmd" class="secondary">Pause</button><button id="skipCmd" class="secondary">Skip</button><button id="stopCmd" class="danger">Stop</button><button id="checkWeatherCmd" class="secondary">Check Weather</button></div><div class="volumeStrip"><label><span>Spotify Volume <output id="spotifyVolumeCommandOut">${esc(S.spotifyVolume)}%</output></span><input id="spotifyVolumeCommand" type="range" min="0" max="100" step="1" value="${esc(S.spotifyVolume)}"></label><button id="spotifyVolumeApply" class="secondary">Set Volume on Receivers</button><small>Announcements keep their separate loud boost.</small></div><div class="quickMusic"><label>Play Spotify or Suno URL<input id="quickMusicUrl" value="${esc(S.quickMusicUrl || activeProviderUrl())}" placeholder="Paste Spotify or Suno playlist URL"></label><div class="buttonStack"><button id="playAnyUrl">Play Pasted URL</button><button id="playDefaultSpotify" class="secondary">Default Spotify</button><button id="playDefaultSuno" class="secondary">Default Suno</button></div></div><div class="splitControls"><label>Announcement<textarea id="quickText">${esc(S.quickText || selected.text)}</textarea></label><div><label>Saved Announcement<select id="quickTemplate">${S.anns.map(item => `<option value="${item.id}" ${item.id === S.selected ? 'selected' : ''}>${esc(item.label)} · ${item.mode === 'suno' ? 'Suno' : 'Voice'}</option>`).join('')}</select></label><div class="buttonStack"><button id="quickPlay">${selected.mode === 'suno' ? 'Play Announcement Track' : 'Speak Now'}</button><button id="quickHold" class="secondary">${selected.mode === 'suno' ? 'Track as Safety Hold' : 'Speak as Safety Hold'}</button><button id="lightningNow" class="secondary">Lightning Hold</button><button id="windNow" class="secondary">Wind Umbrellas</button></div></div></div></section><section class="panel compactLog"><div class="sectionHead"><h2>Receiver Activity</h2><button id="clearLog" class="secondary">Clear Local Log</button></div>${logRows()}</section>`);
}

function partyWarnings(cue) {
  const warnings = [];
  if (!cue) return ['No cue selected.'];
  if (['spoken', 'game', 'prize', 'safety', 'weather'].includes(cue.type) && !String(cue.text || '').trim()) warnings.push('Missing spoken text.');
  if (['spotify', 'suno', 'customAudio'].includes(cue.type) && !String(cue.url || '').trim()) warnings.push('Missing URL for music/audio cue.');
  if (cue.type === 'spotify' && !spotifyLoggedIn()) warnings.push('Spotify URL saved; Spotify playback requires Login Spotify on the Home receiver and a Premium account.');
  if (cue.type === 'suno' && cue.url && !directAudioUrl(cue.url) && !/suno\.com\/playlist\//i.test(cue.url)) warnings.push('Suno URL is not a direct audio URL or imported playlist; cue will use manual/timed fallback.');
  if (cue.durationMode === 'timed' && !Number(cue.durationSeconds)) warnings.push('Timed cues need a duration in seconds.');
  if (!S.weatherAuto || S.partySchedule.settings.weatherMonitoringEnabled !== true) warnings.push('Weather monitoring should remain enabled while pool is open.');
  const profile = partyVoiceProfile(cue);
  if (profile.voiceURI && !voices.find(voice => voice.voiceURI === profile.voiceURI || voice.name === profile.voiceURI)) warnings.push(`Voice not found on this device: ${profile.voiceURI}.`);
  return warnings;
}

function partyCueCards() {
  return partyCues({ includeDisabled: true }).map(cue => {
    const current = cue.id === S.partyCurrentCueId;
    const selected = cue.id === S.partySelectedCueId;
    return `<article class="partyCue ${current ? 'current' : ''} ${selected ? 'selected' : ''} ${cue.enabled ? '' : 'off'}" tabindex="0" data-select-cue="${esc(cue.id)}">
      <div class="partyCueMain">
        <span class="cueBadge ${esc(cue.type)}">${esc(PARTY_CUE_TYPES[cue.type] || cue.type)}</span>
        <b>${cue.order}. ${esc(cue.title)}</b>
        <p>${esc(cue.text || cue.sourceLabel || cue.url || cue.notes || 'No cue details yet.').slice(0, 150)}</p>
        <small>${esc(PARTY_SPEAKERS[cue.speaker] || cue.trackTitle || cue.artist || 'Source')} · ${esc(PARTY_ADVANCE_MODES[cue.durationMode] || cue.durationMode)}${cue.durationSeconds ? ` · ${cue.durationSeconds}s` : ''}</small>
      </div>
      <div class="partyCueActions">
        <button class="slim" data-test-cue="${esc(cue.id)}" aria-label="Test ${esc(cue.title)}">Test</button>
        <button class="secondary slim" data-move-cue="${esc(cue.id)}" data-dir="-1" aria-label="Move ${esc(cue.title)} up">Up</button>
        <button class="secondary slim" data-move-cue="${esc(cue.id)}" data-dir="1" aria-label="Move ${esc(cue.title)} down">Down</button>
        <button class="secondary slim" data-dup-cue="${esc(cue.id)}" aria-label="Duplicate ${esc(cue.title)}">Duplicate</button>
        <button class="secondary slim" data-toggle-cue="${esc(cue.id)}">${cue.enabled ? 'Off' : 'On'}</button>
        <button class="secondary slim" data-delete-cue="${esc(cue.id)}" aria-label="Delete ${esc(cue.title)}">Delete</button>
      </div>
    </article>`;
  }).join('');
}

function partyCueEditor(cue) {
  if (!cue) return '<section class="panel"><h2>Selected Cue</h2><p class="muted">No cue selected.</p></section>';
  const typeOptions = Object.entries(PARTY_CUE_TYPES).map(([id, label]) => `<option value="${id}" ${cue.type === id ? 'selected' : ''}>${esc(label)}</option>`).join('');
  const speakerOptions = Object.entries(PARTY_SPEAKERS).map(([id, label]) => `<option value="${id}" ${cue.speaker === id ? 'selected' : ''}>${esc(label)}</option>`).join('');
  const advanceOptions = Object.entries(PARTY_ADVANCE_MODES).map(([id, label]) => `<option value="${id}" ${cue.durationMode === id ? 'selected' : ''}>${esc(label)}</option>`).join('');
  const warnings = partyWarnings(cue);
  return `<section class="panel partyEditor"><div class="sectionHead"><h2>Selected Cue</h2><button id="savePartyCue">Save Changes</button></div>
    <div class="grid2"><label>Title<input id="partyCueTitle" value="${esc(cue.title)}"></label><label>Type<select id="partyCueType">${typeOptions}</select></label></div>
    <div class="grid3"><label>Speaker<select id="partyCueSpeaker">${speakerOptions}</select></label><label>Advance<select id="partyCueAdvance">${advanceOptions}</select></label><label>Duration Seconds<input id="partyCueDuration" inputmode="numeric" value="${esc(cue.durationSeconds || '')}"></label></div>
    <label>Spoken Text / Game Instructions<textarea id="partyCueText">${esc(cue.text || '')}</textarea></label>
    <div class="grid2"><label>Track Title<input id="partyCueTrack" value="${esc(cue.trackTitle || '')}"></label><label>Artist / Creator<input id="partyCueArtist" value="${esc(cue.artist || '')}"></label></div>
    <label>Spotify, Suno, or Direct Audio URL<input id="partyCueUrl" value="${esc(cue.url || '')}" placeholder="https://open.spotify.com/track/... or https://suno.com/..."></label>
    <div class="grid3"><label>Volume<input id="partyCueVolume" type="range" min="0" max="100" value="${esc(cue.volume)}"></label><label>Fade In Seconds<input id="partyCueFadeIn" inputmode="decimal" value="${esc(cue.fadeInSeconds)}"></label><label>Fade Out Seconds<input id="partyCueFadeOut" inputmode="decimal" value="${esc(cue.fadeOutSeconds)}"></label></div>
    <div class="grid2"><label>Enabled<select id="partyCueEnabled"><option value="true" ${cue.enabled ? 'selected' : ''}>Enabled</option><option value="false" ${!cue.enabled ? 'selected' : ''}>Disabled</option></select></label><label>Manual Confirmation<select id="partyCueManual"><option value="false" ${!cue.requiresManualAdvance ? 'selected' : ''}>Auto advance</option><option value="true" ${cue.requiresManualAdvance ? 'selected' : ''}>Require manual Continue</option></select></label></div>
    <label>Notes<textarea id="partyCueNotes">${esc(cue.notes || '')}</textarea></label>
    <div class="warningList">${warnings.map(item => `<p>${esc(item)}</p>`).join('') || '<p>No validation warnings for this cue.</p>'}</div>
  </section>`;
}

function partyVoiceEditor() {
  const options = ['<option value="">Best matching voice</option>'].concat(bestVoices().map(voice => `<option value="${esc(voice.voiceURI || voice.name)}">${esc(voice.name)} · ${esc(voice.lang)}</option>`)).join('');
  return `<section class="panel partyVoices"><div class="sectionHead"><h2>Gabe / Callie Voices</h2><button id="savePartyVoices" class="secondary">Save Voices</button></div>${S.partySchedule.voiceProfiles.map(profile => `<div class="voiceProfile"><b>${esc(profile.label)}</b><div class="grid4"><label>Voice<select data-party-voice="${esc(profile.id)}">${options}</select></label><label>Rate<input data-party-rate="${esc(profile.id)}" inputmode="decimal" value="${esc(profile.rate)}"></label><label>Pitch<input data-party-pitch="${esc(profile.id)}" inputmode="decimal" value="${esc(profile.pitch)}"></label><label>Volume<input data-party-volume="${esc(profile.id)}" inputmode="decimal" value="${esc(profile.volume)}"></label></div></div>`).join('')}</section>`;
}

function partyPage() {
  const cue = partySelectedCue();
  const current = partyCueById(S.partyCurrentCueId);
  const cues = partyCues();
  const progress = partyProgress();
  const next = cues[Math.max(0, progress.index) + 1] || null;
  const elapsed = S.partyCueStartedAt ? Math.max(0, Math.floor((Date.now() - S.partyCueStartedAt) / 1000)) : 0;
  return shell(`<section class="partyHero"><div><p class="eyebrow">Poolside Pulse - Version 11</p><h1>Weekly Poolside Party Command</h1><p>Run a complete guest party schedule while weather monitoring stays active. Normal pool automation pauses only while Weekly Party Mode is running.</p></div><div class="partyModeBox"><label>Mode<select id="poolMode"><option value="normalPool" ${S.poolMode === 'normalPool' ? 'selected' : ''}>Normal Pool Mode</option><option value="weeklyParty" ${S.poolMode === 'weeklyParty' ? 'selected' : ''}>Weekly Party Mode</option></select></label><span class="pill ${S.poolMode === 'weeklyParty' ? 'warn' : 'good'}">${S.poolMode === 'weeklyParty' ? 'Weekly Party Mode' : 'Normal Pool Mode'}</span></div></section>
    <section class="partyControls"><button id="partyPlay">Play Party Schedule</button><button id="partyPause" class="secondary">Pause</button><button id="partyResume" class="secondary">Resume</button><button id="partyStop" class="danger">Stop</button><button id="partySkip" class="secondary">Skip / Continue</button><button id="partyBack" class="secondary">Back</button><button id="partyRestart" class="secondary">Restart Party</button><button id="partyTest" class="secondary">Test Current Cue</button><button id="partySafety" class="secondary">Safety Cue</button></section>
    <section class="partyStatusGrid"><div><b>Current cue</b><strong>${esc(current?.title || 'None')}</strong></div><div><b>Next cue</b><strong>${esc(next?.title || 'None')}</strong></div><div><b>Elapsed</b><strong>${elapsed}s</strong></div><div><b>Schedule progress</b><strong>${progress.done}/${progress.total}</strong></div><div><b>Weather status</b><strong>${esc(S.weather || 'Standing by')}</strong></div><div><b>Audio/TTS</b><strong>${esc(S.audioStatus || S.voiceHealth)}</strong></div><div><b>Spotify</b><strong>${esc(spotifyLoggedIn() ? 'Connected' : 'Needs receiver login')}</strong></div><div><b>Suno</b><strong>${esc(hasPlayableSuno() ? 'Playable queue ready' : 'Import or paste URL')}</strong></div></section>
    <section class="partyLayout"><div class="panel partyList"><div class="sectionHead"><h2>Party Schedule</h2><button id="addPartyCue" class="secondary">Add Cue</button></div>${partyCueCards()}</div>${partyCueEditor(cue)}</section>
    ${partyVoiceEditor()}
    <section class="panel partyData"><div class="sectionHead"><h2>Import / Export JSON</h2><div class="rowBtns"><button id="restorePartyDefaults" class="secondary">Restore Default Version 11 Party Schedule</button><button id="exportPartyJson" class="secondary">Export JSON</button><button id="importPartyJson" class="secondary">Import JSON</button></div></div><textarea id="partyJsonBox" placeholder="Exported or imported party schedule JSON">${esc(S.partyExportText || S.partyImportText || '')}</textarea></section>
    <section class="panel compactLog"><div class="sectionHead"><h2>Live Playback Log</h2><button id="clearPartyLog" class="secondary">Clear Log</button></div>${S.partyLog.length ? S.partyLog.map(item => `<div class="logRow"><div><b>${esc(item.title)}</b><p>${esc(item.detail)}</p></div><small>${esc(item.time || stamp(item.ts))}</small></div>`).join('') : '<p class="muted">No party playback yet.</p>'}</section>`);
}

function spotifyDiagnostics() {
  const login = spotifyLoggedIn() ? 'Logged in on this browser' : 'Not logged in on this browser';
  const product = S.spotifyAccountProduct ? `Account: ${S.spotifyAccountProduct}` : 'Account: not checked';
  return `<div class="statusBar"><b>Spotify:</b> ${esc(login)}<br><b>Status:</b> ${esc(S.spotifyStatus || 'Not checked yet.')}<br><b>${esc(product)}</b><br><b>${esc(S.spotifyDevicesSummary || 'Devices: not checked')}</b><br><b>Redirect URI:</b> <code>${esc(spotifyRedirectUri())}</code>${S.spotifyLastError ? `<br><b>Last Spotify issue:</b> ${esc(S.spotifyLastError)}` : ''}</div>`;
}

function musicPage() {
  const providers = Object.entries(PROVIDERS).map(([id, label]) => `<option value="${id}" ${S.musicProvider === id ? 'selected' : ''}>${label}</option>`).join('');
  const rows = S.tracks.map((item, index) => `<div class="trackRow ${index === S.current ? 'cur' : ''}"><div><b>${index + 1}. ${esc(item.title)}</b><span>${esc(item.artist || 'Suno')} · ${esc(item.duration || '')} · ${item.audioUrl ? 'ready' : 'title only'}</span></div><div class="rowBtns"><button data-song="${index}" class="slim">Play</button><button data-schedule-song="${index}" class="secondary slim">Schedule</button></div></div>`).join('');
  return shell(`<section class="panel"><div class="panelHeader"><div><p class="eyebrow">Music Control</p><h1>Music</h1></div><button id="saveMusic">Save</button></div><div class="sourceBoard"><div class="sourceTile"><b>Selected</b><strong>${esc(sourceLabel(S.musicProvider, activeProviderUrl()))}</strong><span>${esc(activeProviderUrl())}</span></div><div class="sourceTile"><b>Receiver</b><strong>${esc(S.receiverStatus || receiverReadiness())}</strong><span>${esc(S.spotifyNowPlaying || S.activeMusicLabel || '')}</span></div><div class="sourceTile"><b>Voice Ducking</b><strong>${esc(S.spotifyDuckedVolume)}% Spotify</strong><span>${Math.round(Number(S.announcementGain || 1) * 100)}% announcement boost</span></div></div><div class="buttonStack"><button id="useSpotify" class="${S.musicProvider === 'spotify' ? '' : 'secondary'}">Use Spotify</button><button id="useSuno" class="${S.musicProvider === 'suno' ? '' : 'secondary'}">Use Suno</button><button id="spotifyPlayNow">Play Spotify on Receivers</button><button id="sunoPlayNow" class="secondary">Play Suno on Receivers</button></div><div class="quickMusic"><label>Play Spotify or Suno URL<input id="quickMusicUrl" value="${esc(S.quickMusicUrl || activeProviderUrl())}" placeholder="Paste Spotify or Suno playlist URL"></label><div class="buttonStack"><button id="playAnyUrl">Play Pasted URL</button><button id="savePastedUrl" class="secondary">Save as Default</button></div></div><div class="grid2"><label>Provider<select id="musicProvider">${providers}</select></label><label>Station Name<input id="playlistName" value="${esc(S.playlistName)}"></label></div><div class="grid2"><label>Suno Playlist URL<input id="playlistUrl" value="${esc(S.playlistUrl)}"></label><label>Spotify Playlist or Song URL<input id="spotifyUrl" value="${esc(S.spotifyUrl)}" placeholder="https://open.spotify.com/playlist/..."></label></div><div class="grid2"><label>Spotify Client ID<input id="spotifyClientId" value="${esc(S.spotifyClientId)}"></label><label>Spotify Redirect URI<input id="spotifyRedirectUri" value="${esc(spotifyRedirectUri())}"></label></div><div class="grid4"><label><span>Spotify Volume <output id="spotifyVolumeOut">${esc(S.spotifyVolume)}%</output></span><input id="spotifyVolume" type="range" min="0" max="100" step="1" value="${esc(S.spotifyVolume)}"></label><label><span>Music During Announcements <output id="spotifyDuckedVolumeOut">${esc(S.spotifyDuckedVolume)}%</output></span><input id="spotifyDuckedVolume" type="range" min="0" max="20" step="1" value="${esc(S.spotifyDuckedVolume)}"></label><label><span>Suno Volume <output id="sunoVolumeOut">${esc(S.sunoVolume)}%</output></span><input id="sunoVolume" type="range" min="20" max="100" step="1" value="${esc(S.sunoVolume)}"></label><label><span>Announcement Boost <output id="announcementGainOut">${Math.round(Number(S.announcementGain || 1) * 100)}%</output></span><input id="announcementGain" type="range" min="1" max="3.4" step=".05" value="${esc(S.announcementGain)}"></label></div>${spotifyDiagnostics()}<div class="actions"><button id="spotifyLogin" class="secondary">Login with Spotify</button><button id="spotifyCheck" class="secondary">Check Spotify</button><button id="spotifyReceiver">Activate + Play on This Receiver</button><button id="makeReceiver" class="secondary">Show Receiver Screen</button><button id="spotifyClear" class="secondary">Clear Spotify</button><button id="import" class="secondary">Import Suno</button></div></section><section class="panel"><div class="sectionHead"><h2>Suno Queue</h2><button id="playCmd" class="secondary">Play Selected on Receivers</button></div>${rows || '<p class="muted">No Suno queue imported yet.</p>'}</section>`);
}

function schedulePage() {
  const annOptions = S.anns.map(item => `<option value="${item.id}">${esc(item.label)}</option>`).join('');
  const rows = S.schedule.map((item, index) => ({ item, index }))
    .sort((a, b) => mins(schedTime(a.item)) - mins(schedTime(b.item)))
    .map(({ item, index }) => {
      const active = S.editId === item.id;
      const mode = item.type || 'announcement';
      const edit = active ? `<div class="editBox"><div class="grid3"><label>Time<input data-row-time="${index}" type="time" value="${schedTime(item)}"></label><label>Type<select data-kind="${index}"><option value="announcement" ${mode === 'announcement' ? 'selected' : ''}>Saved announcement</option><option value="text" ${mode === 'text' ? 'selected' : ''}>Custom announcement</option><option value="sunoAnnouncement" ${mode === 'sunoAnnouncement' ? 'selected' : ''}>Suno announcement track</option><option value="song" ${mode === 'song' ? 'selected' : ''}>Suno music song</option><option value="suno" ${mode === 'suno' ? 'selected' : ''}>Suno playlist URL</option><option value="spotify" ${mode === 'spotify' ? 'selected' : ''}>Spotify URL</option></select></label><label>Label<input data-label="${index}" value="${esc(item.label)}"></label></div><label>Text or URL<textarea data-body="${index}">${esc(item.url || item.text || '')}</textarea></label><div class="grid2"><label>Suno Track<select data-track="${index}">${trackOptions(item.trackIndex)}</select></label><label>Saved Announcement<select data-selann="${index}">${annOptions}</select></label></div><button data-save-row="${index}">Save Item</button></div>` : '';
      return `<div class="scheduleRow ${item.enabled ? '' : 'off'} ${active ? 'editing' : ''}"><div><b>${pretty(schedTime(item))} · ${esc(item.label)}</b><span>${item.enabled ? 'enabled' : 'off'} · ${esc(mode)}</span><p>${esc(tokens(itemBody(item)))}</p>${edit}</div><div class="rowBtns"><button data-play-row="${index}" class="slim">Play</button><button data-edit="${index}" class="secondary slim">${active ? 'Close' : 'Edit'}</button><button data-toggle="${index}" class="secondary slim">${item.enabled ? 'Off' : 'On'}</button><button data-delete="${index}" class="secondary slim">Delete</button></div></div>`;
    }).join('');
  return shell(`<section class="panel"><div class="panelHeader"><div><p class="eyebrow">Daily Automation</p><h1>Schedule</h1></div><button id="addSched">Add Item</button></div><p>Schedule saved announcements, custom announcements, Suno announcement tracks, Suno music, or Spotify URLs. Active receivers execute the schedule.</p>${rows}</section>`);
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
    document.title = `Serenity Shores Poolside Pulse V${VERSION}`;
    const app = $('app');
    app.dataset.version = VERSION;
    app.innerHTML = S.screen === 'home'
      ? homePage()
      : !S.admin
        ? login()
        : ({ command: commandPage, party: partyPage, music: musicPage, schedule: schedulePage, weather: weatherPage, voice: voicePage, hours: hoursPage }[S.tab] || commandPage)();
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
    await playSpotifyUrl(S.spotifyUrl, false, { fromTap: true });
  }
}

function resequencePartyCues() {
  S.partySchedule.cues = partyCues({ includeDisabled: true }).map((cue, index) => ({ ...cue, order: index + 1, updatedAt: new Date().toISOString() }));
}

async function savePoolMode() {
  S.poolMode = val('poolMode') === 'weeklyParty' ? 'weeklyParty' : 'normalPool';
  if (S.poolMode === 'normalPool' && partyActive()) {
    await stopPartySchedule(S.screen !== 'home');
    return;
  }
  await save(`${S.poolMode === 'weeklyParty' ? 'Weekly Party Mode' : 'Normal Pool Mode'} selected.`);
}

async function savePartyCue() {
  const cue = partySelectedCue();
  if (!cue) return;
  cue.title = val('partyCueTitle') || cue.title;
  cue.type = PARTY_CUE_TYPES[val('partyCueType')] ? val('partyCueType') : cue.type;
  cue.speaker = PARTY_SPEAKERS[val('partyCueSpeaker')] ? val('partyCueSpeaker') : cue.speaker;
  cue.voiceProfileId = cue.speaker;
  cue.durationMode = PARTY_ADVANCE_MODES[val('partyCueAdvance')] ? val('partyCueAdvance') : cue.durationMode;
  cue.durationSeconds = Math.max(0, Math.round(Number(val('partyCueDuration')) || 0));
  cue.text = val('partyCueText');
  cue.trackTitle = val('partyCueTrack');
  cue.artist = val('partyCueArtist');
  cue.url = val('partyCueUrl');
  cue.volume = clampNumber(val('partyCueVolume'), 0, 100, cue.volume);
  cue.fadeInSeconds = clampNumber(val('partyCueFadeIn'), 0, 12, cue.fadeInSeconds);
  cue.fadeOutSeconds = clampNumber(val('partyCueFadeOut'), 0, 12, cue.fadeOutSeconds);
  cue.enabled = val('partyCueEnabled') !== 'false';
  cue.requiresManualAdvance = val('partyCueManual') === 'true' || cue.durationMode === 'manual';
  cue.notes = val('partyCueNotes');
  cue.updatedAt = new Date().toISOString();
  S.partySchedule = normalizePartySchedule(S.partySchedule);
  await save(`Party cue saved: ${cue.title}.`);
}

async function addPartyCue() {
  const nextOrder = partyCues({ includeDisabled: true }).length + 1;
  const cue = normalizePartyCue({ id: `party-custom-${uid()}`, order: nextOrder, type: 'spoken', title: 'New Party Cue', speaker: 'manager', voiceProfileId: 'manager', text: 'Type the announcement, game instruction, URL, or manual checkpoint details here.', durationMode: 'speechEnd', enabled: true }, nextOrder - 1);
  S.partySchedule.cues.push(cue);
  S.partySelectedCueId = cue.id;
  resequencePartyCues();
  await save('New party cue added.');
}

async function movePartyCue(id, dir) {
  const cues = partyCues({ includeDisabled: true });
  const index = cues.findIndex(cue => cue.id === id);
  const target = index + Number(dir || 0);
  if (index < 0 || target < 0 || target >= cues.length) return;
  [cues[index], cues[target]] = [cues[target], cues[index]];
  S.partySchedule.cues = cues.map((cue, order) => ({ ...cue, order: order + 1, updatedAt: new Date().toISOString() }));
  S.partySelectedCueId = id;
  await save('Party cue reordered.');
}

async function duplicatePartyCue(id) {
  const cue = partyCueById(id);
  if (!cue) return;
  const copy = normalizePartyCue({ ...clone(cue), id: `party-copy-${uid()}`, title: `${cue.title} Copy`, order: cue.order + .5, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  S.partySchedule.cues.push(copy);
  S.partySelectedCueId = copy.id;
  resequencePartyCues();
  await save(`Party cue duplicated: ${copy.title}.`);
}

async function deletePartyCue(id) {
  const cue = partyCueById(id);
  if (!cue || !confirm(`Delete party cue "${cue.title}"?`)) return;
  S.partySchedule.cues = partyCues({ includeDisabled: true }).filter(item => item.id !== id);
  resequencePartyCues();
  S.partySelectedCueId = partyCues({ includeDisabled: true })[0]?.id || '';
  await save(`Party cue deleted: ${cue.title}.`);
}

async function togglePartyCue(id) {
  const cue = partyCueById(id);
  if (!cue) return;
  cue.enabled = !cue.enabled;
  cue.updatedAt = new Date().toISOString();
  await save(`${cue.title} turned ${cue.enabled ? 'on' : 'off'}.`);
}

async function restorePartyDefaults() {
  if (!confirm('Restore the default Version 11 party schedule? This replaces the editable party cue list on this app.')) return;
  S.partySchedule = normalizePartySchedule(clone(DEFAULT_PARTY_SCHEDULE));
  S.partySelectedCueId = S.partySchedule.cues[0]?.id || '';
  S.partyImportText = '';
  S.partyExportText = '';
  await save('Default Version 11 party schedule restored.');
}

async function exportPartyJson() {
  S.partyExportText = JSON.stringify(S.partySchedule, null, 2);
  S.partyImportText = '';
  localSave();
  render();
  setFeedback('Party schedule JSON exported.', true);
}

async function importPartyJson() {
  const raw = val('partyJsonBox').trim();
  if (!raw) {
    setFeedback('Paste party schedule JSON before importing.', false);
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    S.partySchedule = normalizePartySchedule(parsed);
    S.partySelectedCueId = S.partySchedule.cues[0]?.id || '';
    S.partyImportText = '';
    S.partyExportText = raw;
    await save('Party schedule JSON imported and validated.');
  } catch (error) {
    setFeedback(`Import failed: ${error.message}`, false);
  }
}

async function savePartyVoices() {
  for (const profile of S.partySchedule.voiceProfiles) {
    const voice = document.querySelector(`[data-party-voice="${profile.id}"]`)?.value || '';
    profile.voiceURI = voice;
    profile.rate = clampNumber(document.querySelector(`[data-party-rate="${profile.id}"]`)?.value, .65, 1.35, profile.rate);
    profile.pitch = clampNumber(document.querySelector(`[data-party-pitch="${profile.id}"]`)?.value, .65, 1.35, profile.pitch);
    profile.volume = clampNumber(document.querySelector(`[data-party-volume="${profile.id}"]`)?.value, .1, 1, profile.volume);
  }
  await save('Party voice profiles saved.');
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

  const runBoundAction = (el, fn) => {
    el.classList.add('busy');
    el.setAttribute('aria-busy', 'true');
    return Promise.resolve(fn()).catch(error => {
      if (isActionNeeded(error)) setActionNeeded(error.message || String(error));
      else setFeedback(error.message || String(error), false);
      renderWhenIdle();
    }).finally(() => {
      el.classList.remove('busy');
      el.removeAttribute('aria-busy');
    });
  };
  const poolMode = $('poolMode');
  if (poolMode) poolMode.onchange = () => runBoundAction(poolMode, savePoolMode);
  wire('partyPlay', () => startPartySchedule(true, S.partySelectedCueId));
  wire('partyPause', () => pausePartySchedule(true));
  wire('partyResume', () => resumePartySchedule(true));
  wire('partyStop', async () => {
    if (!confirm('Stop Weekly Party Mode and return to Normal Pool Mode?')) return;
    await stopPartySchedule(true);
  });
  wire('partySkip', () => advancePartyCue(1, true));
  wire('partyBack', () => advancePartyCue(-1, true));
  wire('partyRestart', async () => {
    if (!confirm('Restart the Version 11 party schedule from the first enabled cue?')) return;
    const first = partyCues()[0];
    if (!first) throw Error('No enabled party cues are available.');
    if (S.screen !== 'home') {
      await issueCommand('party-control', { action: 'restart', cueId: first.id, label: 'Restart Party Schedule', detail: first.title }, 'Party restart command sent.');
      return;
    }
    await startPartySchedule(false, first.id);
  });
  wire('partyTest', () => testPartyCue(S.partySelectedCueId, true));
  wire('partySafety', () => partySafetyInterrupt('party-61', true));
  wire('addPartyCue', addPartyCue);
  wire('savePartyCue', savePartyCue);
  wire('restorePartyDefaults', restorePartyDefaults);
  wire('exportPartyJson', exportPartyJson);
  wire('importPartyJson', importPartyJson);
  wire('clearPartyLog', async () => {
    S.partyLog = [];
    await save('Party playback log cleared.');
  });
  wire('savePartyVoices', savePartyVoices);
  const partyJsonBox = $('partyJsonBox');
  if (partyJsonBox) partyJsonBox.oninput = () => {
    S.partyImportText = partyJsonBox.value;
    S.partyExportText = '';
    localSave();
  };
  document.querySelectorAll('[data-party-voice]').forEach(select => {
    const profile = S.partySchedule.voiceProfiles.find(item => item.id === select.dataset.partyVoice);
    if (profile) select.value = profile.voiceURI || '';
  });
  document.querySelectorAll('[data-select-cue]').forEach(card => {
    const selectCue = () => {
      S.partySelectedCueId = card.dataset.selectCue || S.partySelectedCueId;
      localSave();
      render();
    };
    card.onclick = event => {
      if (event.target.closest('button,input,textarea,select,label')) return;
      selectCue();
    };
    card.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      selectCue();
    };
  });
  const bindPartyButton = (selector, fn) => {
    document.querySelectorAll(selector).forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        return runBoundAction(button, () => fn(button));
      };
    });
  };
  bindPartyButton('[data-test-cue]', button => testPartyCue(button.dataset.testCue, true));
  bindPartyButton('[data-move-cue]', button => movePartyCue(button.dataset.moveCue, button.dataset.dir));
  bindPartyButton('[data-dup-cue]', button => duplicatePartyCue(button.dataset.dupCue));
  bindPartyButton('[data-toggle-cue]', button => togglePartyCue(button.dataset.toggleCue));
  bindPartyButton('[data-delete-cue]', button => deletePartyCue(button.dataset.deleteCue));

  wire('playHome', async () => {
    const needsAudioUnlock = !receiverSessionStartedAt() || !receiverAudioReady();
    if (S.musicProvider === 'spotify') await activateSpotifyElement();
    await ensureReceiverAudio('Home play button', { startSession: true, userGesture: true, testTone: needsAudioUnlock });
    if (S.musicProvider === 'spotify') {
      if (!spotifyLoggedIn()) {
        setActionNeeded('Receiver audio is unlocked. Now tap Login Spotify on This Receiver.');
        renderWhenIdle();
        return;
      }
      if (receiverCanPause()) await spotifyPause(false);
      else await playSpotifyUrl(S.spotifyUrl, false, { fromTap: true });
    } else {
      if (receiverCanPause()) await pauseSuno(false);
      else await playSuno(false);
    }
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
    let applying = false;
    const applyOnce = () => {
      if (applying) return;
      applying = true;
      Promise.resolve(applySpotifyVolume(true)).catch(error => {
        if (isActionNeeded(error)) setActionNeeded(error.message || String(error));
        else setFeedback(error.message || String(error), false);
        renderWhenIdle();
      }).finally(() => { applying = false; });
    };
    input.oninput = () => {
      updateSpotifyVolumeDraft(input.value);
    };
    input.onchange = applyOnce;
    input.onpointerup = applyOnce;
    input.ontouchend = applyOnce;
  });
  document.querySelectorAll('#spotifyDuckedVolume, #sunoVolume, #announcementGain, #rate, #pitch').forEach(input => {
    let applying = false;
    const applyOnce = () => {
      if (applying) return;
      applying = true;
      Promise.resolve((async () => {
        updateRangeDraft(input.id, input.value);
        await applyAudioSettings(true);
      })()).catch(error => {
        if (isActionNeeded(error)) setActionNeeded(error.message || String(error));
        else setFeedback(error.message || String(error), false);
        renderWhenIdle();
      }).finally(() => { applying = false; });
    };
    input.oninput = () => {
      updateRangeDraft(input.id, input.value);
    };
    input.onchange = applyOnce;
    input.onpointerup = applyOnce;
    input.ontouchend = applyOnce;
  });
  wire('playAnyUrl', () => playAnyMusicUrl(val('quickMusicUrl'), true));
  wire('playDefaultSpotify', async () => {
    S.quickMusicUrl = S.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST;
    await playAnyMusicUrl(S.quickMusicUrl, true);
  });
  wire('playDefaultSuno', async () => {
    S.quickMusicUrl = S.playlistUrl || DEFAULT_SUNO_PLAYLIST;
    await playAnyMusicUrl(S.quickMusicUrl, true);
  });
  wire('savePastedUrl', async () => {
    const raw = val('quickMusicUrl').trim();
    const provider = providerFromUrl(raw);
    if (!provider) throw Error('Paste a Suno or Spotify URL before saving it as a default.');
    S.quickMusicUrl = raw;
    if (provider === 'suno') {
      S.musicProvider = 'suno';
      S.playlistUrl = raw;
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
    S.musicProvider = 'suno';
    rememberActiveSource('suno', S.playlistUrl, 'selected');
    await save(`Suno selected: ${sourceLabel('suno', S.playlistUrl)}.`);
  });
  wire('spotifyPlayNow', async () => {
    readMusicSettings();
    S.musicProvider = 'spotify';
    await playSpotifyUrl(S.spotifyUrl, true);
  });
  wire('sunoPlayNow', async () => {
    readMusicSettings();
    S.musicProvider = 'suno';
    await playSuno(true);
  });
  wire('spotifyLogin', spotifyLogin);
  wire('spotifyCheck', () => checkSpotifyHealth(true));
  wire('spotifyReceiver', async () => {
    readMusicSettings();
    S.screen = 'home';
    S.musicProvider = 'spotify';
    localSave();
    render();
    await activateSpotifyElement();
    await playSpotifyUrl(S.spotifyUrl, false, { fromTap: true });
  });
  wire('makeReceiver', async () => {
    readMusicSettings();
    S.screen = 'home';
    localSave();
    render();
    setFeedback('Receiver screen is active on this device. Leave it open on the speaker-connected phone.', true);
  });
  wire('spotifyClear', clearSpotifyToken);
  wire('import', () => importSuno());
  document.querySelectorAll('[data-song]').forEach(button => {
    button.onclick = () => Promise.resolve((async () => {
      S.current = Number(button.dataset.song) || 0;
      S.musicProvider = 'suno';
      await playSuno(true);
    })()).catch(error => isActionNeeded(error) ? setActionNeeded(error.message) : setFeedback(error.message, false));
  });
  document.querySelectorAll('[data-schedule-song]').forEach(button => {
    button.onclick = () => addSongSchedule(Number(button.dataset.scheduleSong));
  });

  wire('addSched', createScheduleItem);
  document.querySelectorAll('[data-play-row]').forEach(button => {
    button.onclick = () => Promise.resolve(playScheduleItem(S.schedule[Number(button.dataset.playRow)])).catch(error => isActionNeeded(error) ? setActionNeeded(error.message) : setFeedback(error.message, false));
  });
  document.querySelectorAll('[data-edit]').forEach(button => {
    button.onclick = () => {
      const row = S.schedule[Number(button.dataset.edit)];
      S.editId = S.editId === row.id ? 'new' : row.id;
      localSave();
      render();
    };
  });
  document.querySelectorAll('[data-toggle]').forEach(button => {
    button.onclick = () => {
      const row = S.schedule[Number(button.dataset.toggle)];
      row.enabled = !row.enabled;
      save(`${row.label} turned ${row.enabled ? 'on' : 'off'}.`);
    };
  });
  document.querySelectorAll('[data-delete]').forEach(button => {
    button.onclick = () => {
      const row = S.schedule[Number(button.dataset.delete)];
      S.schedule.splice(Number(button.dataset.delete), 1);
      S.editId = 'new';
      save(`${row.label} deleted from schedule.`);
    };
  });
  document.querySelectorAll('[data-save-row]').forEach(button => {
    button.onclick = () => saveRow(Number(button.dataset.saveRow));
  });
  document.querySelectorAll('[data-selann]').forEach(select => {
    const row = S.schedule[Number(select.dataset.selann)];
    if (row?.announcementId) select.value = row.announcementId;
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
    S.announcementGain = clampNumber(val('announcementGain') || S.announcementGain, 1, 3.4, 2.65);
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

function handleHelperAudioStatus(event) {
  if (event.detail?.status) {
    S.audioStatus = event.detail.status;
    if (helperAudioReady(event.detail)) {
      S.receiverStatus = 'Receiver audio ready.';
      S.receiverActiveAt = Date.now();
      S.receiverLastSeen = stamp();
    } else if (/not been activated|blocked|failed|unavailable|denied/i.test(event.detail.status)) {
      receiverActive = false;
      S.receiverStatus = 'Receiver online; tap Start Receiver once for sound.';
      S.receiverActiveAt = 0;
    }
    localSave();
  }
}

window.addEventListener('poolside-v11-audio-status', handleHelperAudioStatus);
window.addEventListener('poolside-v9-audio-status', handleHelperAudioStatus);

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}

function normalizeCurrentUrl() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.has('code') || params.has('state')) return;
    if (params.get('v') === APP_QUERY.replace('?v=', '')) return;
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
