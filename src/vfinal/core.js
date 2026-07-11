export const VERSION = 'final';
export const STATE_VERSION = 'final';
export const MUSIC_LEVEL_PERCENT = 30;
export const VOICE_LEVEL_PERCENT = 100;
export const DUCK_LEVEL_PERCENT = 6;
export const RECEIVER_LEASE_MS = 45_000;
export const EVENT_TTL_MS = 2 * 60_000;
export const SAFETY_EVENT_TTL_MS = 10 * 60_000;
export const SCHEDULE_CATCHUP_MS = 90_000;
export const SCHEDULE_CLAIM_MS = RECEIVER_LEASE_MS;
export const WEATHER_INTERVAL_MS = 2 * 60_000;
export const LIGHTNING_ANNOUNCEMENT_REPEAT_MS = 5 * 60_000;
export const WEATHER_TIME_ZONE = 'America/Chicago';

export const DEFAULT_SPOTIFY_CLIENT_ID = '7e086716aaea4ce98051287b552a676c';
export const DEFAULT_SPOTIFY_PLAYLIST = 'https://open.spotify.com/playlist/0WPOOzy3puLNwxukYt9pTw';
export const DEFAULT_SUNO_SOURCE = 'https://suno.com/s/mmRHZLjTTkACvgBW';
export const DEFAULT_ADDRESS = '615 Serenity Shores Ln, Kimberling City, MO 65686';

export const DEFAULT_ANNOUNCEMENTS = [
  {
    id: 'welcome',
    label: 'Welcome',
    text: 'Good morning and welcome to Serenity Shores. Please supervise children, keep glass out of the pool area, and follow lifeguard instructions so everyone can enjoy a safe day by the water.'
  },
  {
    id: 'lightning',
    label: 'Lightning Safety Hold',
    text: 'Attention guests and lifeguards. Lightning has been detected within {radius} of Serenity Shores. Please exit the pool and clear the water now. The pool must remain clear for at least {hold} after the most recent strike. Each additional strike resets that safety clock. Lifeguards will announce when the pool may reopen.'
  },
  {
    id: 'lightning-clear',
    label: 'Lightning All Clear',
    text: 'Attention guests and lifeguards. {hold} {holdVerb} since the most recent lightning strike, and the latest complete weather check found no new strike within {radius}. Lifeguards may reopen the pool when the area is ready and conditions remain safe.'
  },
  {
    id: 'wind',
    label: 'Strong Wind',
    text: 'Attention guests and lifeguards. Strong wind has been detected near Serenity Shores. Please close all umbrellas, secure loose items, and follow staff instructions.'
  },
  {
    id: 'tornado',
    label: 'Tornado Warning',
    text: 'Attention guests and lifeguards. A tornado warning is active near Serenity Shores. Exit the pool, clear the water immediately, and move to the designated shelter area away from windows. Follow staff and emergency instructions now.'
  },
  {
    id: 'hydrate',
    label: 'Hydration Reminder',
    text: 'Friendly reminder from Serenity Shores: take a water break, reapply sunscreen, and keep an eye on younger swimmers.'
  },
  {
    id: 'no-glass',
    label: 'No Glass',
    text: 'Friendly reminder: glass is not permitted in the pool area. Thank you for helping us keep the pool safe for everyone.'
  },
  {
    id: 'owner',
    label: 'Owner Message',
    text: 'From all of us at Serenity Shores, thank you for spending part of your vacation with us. We hope this place feels peaceful, fun, and memorable for your family.'
  },
  {
    id: 'manager',
    label: 'Manager Message',
    text: 'Friendly Serenity Shores reminder: safety comes first, children must be supervised, and lifeguard instructions should be followed right away.'
  },
  {
    id: 'birthday',
    label: 'Birthday',
    text: 'Happy birthday from Serenity Shores. We hope your day is absolutely wonderful.'
  },
  {
    id: 'umbrellas',
    label: 'Close Umbrellas',
    text: 'Attention guests, please close all umbrellas and secure loose items. Thank you.'
  },
  {
    id: 'safety-hold',
    label: 'Safety Hold',
    text: 'Attention guests, we are taking a safety hold. Please clear the pool and follow lifeguard instructions.'
  },
  {
    id: 'weather-watch',
    label: 'Weather Watch',
    text: 'Attention guests, weather is being monitored near Serenity Shores. Please stay alert for instructions from lifeguards.'
  },
  {
    id: 'closing-15',
    label: 'Closing in 15 Minutes',
    text: 'Attention guests, the pool will close in 15 minutes. Please begin gathering your belongings.'
  },
  {
    id: 'closing-5',
    label: 'Closing in 5 Minutes',
    text: 'Attention guests, the pool will close in 5 minutes. Thank you for spending the day at Serenity Shores.'
  }
];

export const DEFAULT_SCHEDULE = [
  { id: 'open-welcome', label: 'Pool Open Welcome', type: 'announcement', time: '09:05', announcementId: 'welcome', enabled: true, days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'ten-welcome', label: '10am Welcome', type: 'announcement', time: '10:00', announcementId: 'welcome', enabled: true, days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'midday-safety', label: 'Midday Safety', type: 'announcement', time: '12:30', announcementId: 'no-glass', enabled: true, days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'afternoon-hydration', label: 'Afternoon Hydration', type: 'announcement', time: '15:00', announcementId: 'hydrate', enabled: true, days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'closing-15', label: 'Closing in 15', type: 'announcement', time: '21:45', announcementId: 'closing-15', enabled: true, days: [0, 1, 2, 3, 4, 5, 6] },
  { id: 'closing-5', label: 'Closing in 5', type: 'announcement', time: '21:55', announcementId: 'closing-5', enabled: true, days: [0, 1, 2, 3, 4, 5, 6] }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

export function makeId(prefix = 'event', now = Date.now(), random = Math.random()) {
  return `${prefix}-${now.toString(36)}-${Math.floor(random * 0x100000000).toString(36).padStart(6, '0')}`;
}

export function createDefaultState(now = Date.now()) {
  return {
    version: VERSION,
    revision: 0,
    savedAt: now,
    receiver: null,
    config: {
      musicProvider: 'controlled',
      musicUrl: DEFAULT_SUNO_SOURCE,
      musicLabel: 'Serenity Shores Suno playlist',
      spotifyUrl: DEFAULT_SPOTIFY_PLAYLIST,
      spotifyClientId: DEFAULT_SPOTIFY_CLIENT_ID,
      musicLevel: MUSIC_LEVEL_PERCENT,
      voiceLevel: VOICE_LEVEL_PERCENT,
      duckLevel: DUCK_LEVEL_PERCENT,
      voiceMode: 'ai',
      aiVoice: 'marin',
      address: DEFAULT_ADDRESS,
      latitude: 36.6337,
      longitude: -93.4166,
      lightningRadiusMiles: 10,
      lightningHoldMinutes: 30,
      windGustMph: 35,
      weatherAuto: true,
      weatherIntervalMinutes: 2
    },
    playback: {
      provider: 'controlled',
      intent: 'stopped',
      label: 'Nothing playing',
      sourceUrl: '',
      trackIndex: 0,
      updatedAt: now
    },
    announcements: clone(DEFAULT_ANNOUNCEMENTS),
    schedule: clone(DEFAULT_SCHEDULE),
    scheduleRuns: {},
    weather: {
      status: 'Weather monitoring is ready.',
      checkedAt: 0,
      providerErrors: [],
      lightningActive: false,
      lightningHoldUntil: 0,
      lastLightningKey: '',
      lastLightningAnnouncementAt: 0,
      lastLightningCoverageAt: 0,
      pendingAnnouncementIds: [],
      pendingAnnouncementAt: 0,
      pendingAnnouncementConfig: null,
      pendingAnnouncementCommit: null,
      windActive: false,
      lastWindAnnouncementAt: 0,
      tornadoActive: false,
      lastTornadoAnnouncementAt: 0,
      lastThreatType: ''
    },
    events: [],
    activityLog: []
  };
}

function normalizeAnnouncement(item) {
  return {
    id: String(item?.id || makeId('announcement')),
    label: String(item?.label || 'Announcement').slice(0, 80),
    text: String(item?.text || '').slice(0, 900)
  };
}

function normalizeScheduleItem(item) {
  return {
    id: String(item?.id || makeId('schedule')),
    label: String(item?.label || 'Scheduled item').slice(0, 100),
    type: ['announcement', 'controlled', 'spotify'].includes(item?.type) ? item.type : 'announcement',
    time: /^\d{2}:\d{2}$/.test(String(item?.time || '')) ? String(item.time) : '12:00',
    announcementId: String(item?.announcementId || ''),
    url: String(item?.url || '').trim().slice(0, 2000),
    enabled: item?.enabled !== false,
    days: Array.isArray(item?.days)
      ? [...new Set(item.days.map(Number).filter(day => day >= 0 && day <= 6))]
      : [0, 1, 2, 3, 4, 5, 6]
  };
}

export function normalizeState(input, now = Date.now()) {
  const defaults = createDefaultState(now);
  const source = input && typeof input === 'object' ? input : {};
  const config = { ...defaults.config, ...(source.config || {}) };
  config.musicProvider = config.musicProvider === 'spotify' ? 'spotify' : 'controlled';
  config.musicLevel = MUSIC_LEVEL_PERCENT;
  config.voiceLevel = VOICE_LEVEL_PERCENT;
  config.duckLevel = DUCK_LEVEL_PERCENT;
  config.latitude = clamp(config.latitude, -90, 90, defaults.config.latitude);
  config.longitude = clamp(config.longitude, -180, 180, defaults.config.longitude);
  config.lightningRadiusMiles = clamp(config.lightningRadiusMiles, 1, 25, 10);
  config.lightningHoldMinutes = clamp(config.lightningHoldMinutes, 5, 90, 30);
  config.windGustMph = clamp(config.windGustMph, 15, 80, 35);
  config.weatherIntervalMinutes = 2;
  config.weatherAuto = config.weatherAuto !== false;

  const receiver = source.receiver && typeof source.receiver === 'object'
    ? {
        id: String(source.receiver.id || ''),
        sessionId: String(source.receiver.sessionId || ''),
        name: String(source.receiver.name || 'Speaker Receiver').slice(0, 80),
        status: String(source.receiver.status || 'offline').slice(0, 40),
        lastSeen: Math.max(0, Number(source.receiver.lastSeen || 0) || 0),
        startedAt: Math.max(0, Number(source.receiver.startedAt || 0) || 0),
        leaseUntil: Math.max(0, Number(source.receiver.leaseUntil || 0) || 0),
        platform: String(source.receiver.platform || '').slice(0, 160),
        audioMode: String(source.receiver.audioMode || '').slice(0, 60),
        detail: String(source.receiver.detail || '').slice(0, 300)
      }
    : null;

  const eventCutoff = now - SAFETY_EVENT_TTL_MS;
  const events = (Array.isArray(source.events) ? source.events : [])
    .filter(event => event?.id && Number(event.createdAt || 0) >= eventCutoff)
    .slice(-120);
  const activityLog = (Array.isArray(source.activityLog) ? source.activityLog : [])
    .filter(entry => entry?.id)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 180);
  const announcementMap = new Map(defaults.announcements.map(item => [item.id, normalizeAnnouncement(item)]));
  for (const item of Array.isArray(source.announcements) ? source.announcements : []) {
    const normalized = normalizeAnnouncement(item);
    announcementMap.set(normalized.id, normalized);
  }
  for (const fixedId of ['lightning', 'lightning-clear']) {
    const fixed = defaults.announcements.find(item => item.id === fixedId);
    announcementMap.set(fixedId, normalizeAnnouncement(fixed));
  }

  return {
    ...defaults,
    ...source,
    version: VERSION,
    config,
    receiver,
    playback: { ...defaults.playback, ...(source.playback || {}) },
    weather: { ...defaults.weather, ...(source.weather || {}) },
    announcements: [...announcementMap.values()],
    schedule: (Array.isArray(source.schedule) ? source.schedule : defaults.schedule).map(normalizeScheduleItem),
    scheduleRuns: source.scheduleRuns && typeof source.scheduleRuns === 'object' ? source.scheduleRuns : {},
    events,
    activityLog
  };
}

export function receiverOnline(receiver, now = Date.now()) {
  if (!receiver?.id || !receiver?.sessionId) return false;
  const lastSeen = Number(receiver.lastSeen || 0);
  const leaseUntil = Number(receiver.leaseUntil || 0);
  return receiver.status === 'online' && lastSeen > 0 && now - lastSeen <= RECEIVER_LEASE_MS && leaseUntil >= now;
}

export function makeReceiverLease({ deviceId, sessionId, name = 'Speaker Receiver', platform = '', audioMode = '' }, now = Date.now()) {
  return {
    id: String(deviceId || ''),
    sessionId: String(sessionId || ''),
    name: String(name || 'Speaker Receiver').slice(0, 80),
    status: 'online',
    startedAt: now,
    lastSeen: now,
    leaseUntil: now + RECEIVER_LEASE_MS,
    platform: String(platform || '').slice(0, 160),
    audioMode: String(audioMode || '').slice(0, 60),
    detail: 'Receiver audio unlocked and command session active.'
  };
}

export function renewReceiverLease(receiver, now = Date.now(), patch = {}) {
  return {
    ...(receiver || {}),
    ...patch,
    status: 'online',
    lastSeen: now,
    leaseUntil: now + RECEIVER_LEASE_MS
  };
}

export function createTargetedEvent(type, payload, receiver, now = Date.now()) {
  if (!receiverOnline(receiver, now)) throw new Error('The speaker receiver is offline. Open vFinal on the speaker device and tap Start Receiver.');
  const safety = type === 'weather-check' || type === 'announce-safety';
  return {
    id: makeId(type, now),
    type,
    payload: payload && typeof payload === 'object' ? payload : {},
    targetReceiverId: receiver.id,
    targetSessionId: receiver.sessionId,
    createdAt: now,
    expiresAt: now + (safety ? SAFETY_EVENT_TTL_MS : EVENT_TTL_MS),
    status: 'pending',
    completedAt: 0,
    completedBy: '',
    error: ''
  };
}

export function eventBelongsToReceiver(event, receiver, sessionStartedAt, handledIds = new Set(), now = Date.now()) {
  if (!event?.id || handledIds.has(event.id)) return false;
  if (!receiverOnline(receiver, now)) return false;
  if (event.status === 'completed' || event.status === 'failed') return false;
  if (String(event.targetReceiverId || '') !== String(receiver.id || '')) return false;
  if (String(event.targetSessionId || '') !== String(receiver.sessionId || '')) return false;
  if (Number(event.expiresAt || 0) < now) return false;
  return true;
}

export function pendingEventsForReceiver(events, receiver, sessionStartedAt, handledIds = new Set(), now = Date.now()) {
  const seen = new Set();
  return (Array.isArray(events) ? events : [])
    .filter(event => eventBelongsToReceiver(event, receiver, sessionStartedAt, handledIds, now))
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .filter(event => {
      const key = String(event.dedupeKey || event.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function completeEvent(event, deviceId, now = Date.now(), error = '') {
  return {
    ...event,
    status: error ? 'failed' : 'completed',
    completedAt: now,
    completedBy: String(deviceId || ''),
    error: String(error || '').slice(0, 500)
  };
}

export function makeLog(kind, title, detail = '', now = Date.now(), meta = {}) {
  return {
    id: makeId('log', now),
    kind: String(kind || 'system').slice(0, 40),
    title: String(title || 'Activity').slice(0, 120),
    detail: String(detail || '').slice(0, 700),
    createdAt: now,
    ...meta
  };
}

export function audioPolicy({ provider = 'controlled', isIOS = false, supportsVolume = false, volumeVerified = false } = {}) {
  if (provider !== 'spotify') {
    return {
      id: 'exact-30-100',
      exact: true,
      musicPercent: MUSIC_LEVEL_PERCENT,
      voicePercent: VOICE_LEVEL_PERCENT,
      duringVoicePercent: DUCK_LEVEL_PERCENT,
      action: 'duck',
      label: 'Exact 30/100 mix',
      detail: 'Receiver-owned Suno/direct audio is routed through one Web Audio mixer: music 30%, announcements 100%, music 6% during speech.'
    };
  }
  if (!isIOS && supportsVolume && volumeVerified) {
    return {
      id: 'spotify-verified-30-pause',
      exact: true,
      musicPercent: MUSIC_LEVEL_PERCENT,
      voicePercent: VOICE_LEVEL_PERCENT,
      duringVoicePercent: 0,
      action: 'pause',
      label: 'Verified Spotify 30% + voice takeover',
      detail: 'This receiver reports Spotify volume support. Spotify is verified at 30%, paused for announcements, then resumed without restarting the track.'
    };
  }
  return {
    id: isIOS ? 'spotify-ios-pause-only' : 'spotify-unverified-pause-only',
    exact: false,
    musicPercent: null,
    voicePercent: VOICE_LEVEL_PERCENT,
    duringVoicePercent: 0,
    action: 'pause',
    label: 'Spotify pause-for-voice compatibility',
    detail: isIOS
      ? 'iPhone/iPad browsers cannot set Spotify playback volume. Spotify will pause for announcements and resume afterward; use Suno/direct audio for guaranteed 30/100 levels.'
      : 'Spotify volume has not been verified at 30% on this receiver. Spotify will pause for announcements and resume afterward; use Suno/direct audio for guaranteed 30/100 levels.'
  };
}

export function safetyAnnouncementText(id, fallbackText, config = {}) {
  const radius = clamp(config.lightningRadiusMiles, 1, 25, 10);
  const hold = clamp(config.lightningHoldMinutes, 5, 90, 30);
  const radiusLabel = `${radius} ${radius === 1 ? 'mile' : 'miles'}`;
  const holdLabel = `${hold} ${hold === 1 ? 'minute' : 'minutes'}`;
  if (id === 'lightning' || id === 'lightning-clear') {
    return String(fallbackText || '')
      .replaceAll('{radius}', radiusLabel)
      .replaceAll('{hold}', holdLabel)
      .replaceAll('{holdVerb}', hold === 1 ? 'has passed' : 'have passed')
      .trim()
      .slice(0, 900);
  }
  return String(fallbackText || '').trim().slice(0, 900);
}

export function isSpotifyUrl(value) {
  return /^(?:spotify:|https?:\/\/(?:open\.)?spotify\.com\/)/i.test(String(value || '').trim());
}

export function isSunoUrl(value) {
  return /^https?:\/\/(?:www\.)?suno\.com\/(?:playlist|playlists|song|songs|s)\//i.test(String(value || '').trim());
}

export function isDirectAudioUrl(value) {
  return /^https?:\/\/.+\.(?:mp3|m4a|aac|wav|ogg|oga|webm)(?:[?#].*)?$/i.test(String(value || '').trim());
}

function zonedParts(now, timeZone = WEATHER_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    weekday,
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

export function dueScheduleItems(schedule, scheduleRuns, now = Date.now(), timeZone = WEATHER_TIME_ZONE, catchupMs = SCHEDULE_CATCHUP_MS) {
  const parts = zonedParts(now, timeZone);
  const currentSeconds = parts.hour * 3600 + parts.minute * 60 + parts.second;
  return (Array.isArray(schedule) ? schedule : []).filter(item => {
    if (!item?.enabled || !/^\d{2}:\d{2}$/.test(String(item.time || ''))) return false;
    if (Array.isArray(item.days) && item.days.length && !item.days.map(Number).includes(parts.weekday)) return false;
    const [hour, minute] = item.time.split(':').map(Number);
    const scheduledSeconds = hour * 3600 + minute * 60;
    const ageMs = (currentSeconds - scheduledSeconds) * 1000;
    if (ageMs < 0 || ageMs > catchupMs) return false;
    const run = scheduleRuns?.[item.id];
    if (run === parts.dateKey) return false;
    if (run && typeof run === 'object' && run.dateKey === parts.dateKey) {
      if (run.status === 'completed') return false;
      if (run.status === 'in-progress' && now - Number(run.claimedAt || 0) < SCHEDULE_CLAIM_MS) return false;
    }
    return true;
  });
}

function closestLightning(payload) {
  const hits = Array.isArray(payload?.lightningHits) ? payload.lightningHits : [];
  return hits.reduce((best, hit) => {
    if (!best) return hit;
    return Number(hit?.distanceMI ?? 999) < Number(best?.distanceMI ?? 999) ? hit : best;
  }, null);
}

export function evaluateWeather(previousWeather, payload, config, now = Date.now()) {
  const previous = { ...createDefaultState(now).weather, ...(previousWeather || {}) };
  const next = {
    ...previous,
    status: String(payload?.summary || payload?.error || 'Weather check completed.'),
    checkedAt: now,
    providerErrors: Array.isArray(payload?.providerErrors) ? payload.providerErrors.slice(0, 8) : [],
    lastThreatType: String(payload?.threatType || '')
  };
  const announcements = [];
  const responseKnown = payload?.ok !== false;
  const hasProviderErrors = Array.isArray(payload?.providerErrors) && payload.providerErrors.length > 0;
  const legacyWeatherKnown = responseKnown && !hasProviderErrors;
  const tornadoKnown = responseKnown && (payload?.tornadoCoverageKnown === true || (!Object.prototype.hasOwnProperty.call(payload || {}, 'tornadoCoverageKnown') && legacyWeatherKnown));
  const windKnown = responseKnown && (payload?.windCoverageKnown === true || (!Object.prototype.hasOwnProperty.call(payload || {}, 'windCoverageKnown') && legacyWeatherKnown));
  const lightningKnown = responseKnown && payload?.lightningCoverageKnown === true;
  const lightning = closestLightning(payload);
  const threatType = String(payload?.threatType || '').toLowerCase();
  const lightningThreat = !!lightning || threatType.includes('lightning');
  const windThreat = threatType.includes('wind') || (Array.isArray(payload?.windHits) && payload.windHits.length > 0);
  const tornadoThreat = threatType.includes('tornado');

  if (tornadoThreat) {
    next.tornadoActive = true;
    if (!previous.tornadoActive || now - Number(previous.lastTornadoAnnouncementAt || 0) >= 30 * 60_000) {
      announcements.push('tornado');
      next.lastTornadoAnnouncementAt = now;
    }
  } else if (tornadoKnown) {
    next.tornadoActive = false;
  }

  if (lightningThreat) {
    const key = String(lightning?.id || `${lightning?.timestamp || now}:${Math.round(Number(lightning?.distanceMI || 0) * 10)}`);
    const isNew = key !== previous.lastLightningKey;
    next.lightningActive = true;
    next.lightningHoldUntil = now + clamp(config?.lightningHoldMinutes, 5, 90, 30) * 60_000;
    next.lastLightningKey = key;
    if (isNew && (!previous.lightningActive || now - Number(previous.lastLightningAnnouncementAt || 0) >= LIGHTNING_ANNOUNCEMENT_REPEAT_MS)) {
      announcements.push('lightning');
      next.lastLightningAnnouncementAt = now;
    }
  } else if (lightningKnown && previous.lightningActive && now >= Number(previous.lightningHoldUntil || 0)) {
    next.lightningActive = false;
    next.lightningHoldUntil = 0;
    announcements.push('lightning-clear');
  }
  if (lightningKnown) next.lastLightningCoverageAt = now;

  if (windThreat) {
    next.windActive = true;
    if (!previous.windActive || now - Number(previous.lastWindAnnouncementAt || 0) >= 30 * 60_000) {
      announcements.push('wind');
      next.lastWindAnnouncementAt = now;
    }
  } else if (windKnown) {
    next.windActive = false;
  }

  return { weather: next, announcements };
}

export function weatherRequestUrl(config, extra = {}) {
  const query = new URLSearchParams({
    lat: String(config?.latitude ?? 36.6337),
    lon: String(config?.longitude ?? -93.4166),
    radiusMiles: String(config?.lightningRadiusMiles ?? 10),
    lightningRadiusMiles: String(config?.lightningRadiusMiles ?? 10),
    windGustMph: String(config?.windGustMph ?? 35),
    ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  });
  return `/api/weather?${query.toString()}`;
}
