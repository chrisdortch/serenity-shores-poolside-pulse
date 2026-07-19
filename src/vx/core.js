export const VERSION = 'X';
export const STATE_VERSION = 'x';
// Default music target. The persisted operating target is config.musicLevel
// and is intentionally adjustable from 0-100.
export const MUSIC_LEVEL_PERCENT = 30;
export const VOICE_LEVEL_PERCENT = 100;
export const DUCK_LEVEL_PERCENT = 0;
export const ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS = 45;
export const MAX_SCHEDULE_ITEMS = 100;
export const SCHEDULE_DURATION_MIN_SECONDS = 1;
export const SCHEDULE_DURATION_MAX_SECONDS = 24 * 60 * 60;
export const SCHEDULE_DURATION_DEFAULT_SECONDS = 5 * 60;
export const RECEIVER_LEASE_MS = 45_000;
export const EVENT_TTL_MS = 2 * 60_000;
export const SAFETY_EVENT_TTL_MS = 10 * 60_000;
export const SCHEDULE_CATCHUP_MS = 90_000;
export const SCHEDULE_CLAIM_MS = RECEIVER_LEASE_MS;
export const WEATHER_INTERVAL_MS = 2 * 60_000;
export const LIGHTNING_ANNOUNCEMENT_REPEAT_MS = 5 * 60_000;
export const WEATHER_TIME_ZONE = 'America/Chicago';

// Apple Music sources are intentionally user supplied. MusicKit configuration
// and its short-lived developer token come from the Version X server route.
export const DEFAULT_APPLE_MUSIC_PLAYLIST = '';
export const DEFAULT_SPOTIFY_CLIENT_ID = '7e086716aaea4ce98051287b552a676c';
export const DEFAULT_SPOTIFY_PLAYLIST = 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl';
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

export const DEFAULT_ANNOUNCEMENT_SOURCES = [
  {
    id: 'natural-voice',
    label: 'Natural Voice',
    kind: 'natural-voice',
    provider: 'openai-tts',
    voice: 'marin',
    finite: true,
    playbackSupport: 'supported',
    verification: 'unverified'
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

export const DEFAULT_SCHEDULE_ID = 'daily-schedule';

const SEQUENCE_RUN_VERSION = 1;
const SEQUENCE_RUN_STATUSES = new Set([
  'idle',
  'claiming',
  'waiting-manual',
  'waiting-duration',
  'waiting-track-end',
  'auto-pending',
  'complete',
  'failed',
  'cancelled'
]);
const SEQUENCE_RUN_OUTCOMES = new Set(['pending', 'armed', 'committed', 'failed', 'cancelled']);

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
  const defaultItems = normalizeScheduleItems(clone(DEFAULT_SCHEDULE));
  const defaultNamedSchedule = normalizeNamedSchedule({
    id: DEFAULT_SCHEDULE_ID,
    name: 'Daily Schedule',
    mode: 'time',
    enabled: true,
    items: defaultItems
  });
  return {
    version: STATE_VERSION,
    revision: 0,
    savedAt: now,
    receiver: null,
    config: {
      // The shared control plane uses an explicit receiver mode so Remote
      // devices never route commands to a browser lease that Safari left
      // behind while the speaker switched to Pushcut.
      receiverMode: 'browser',
      // Browser Receiver owns provider playback. The optional email-wake lane
      // runs native volume and announcement actions without taking Safari out
      // of the foreground.
      announcementTransport: 'browser',
      // Automatic Receiver is fail-closed until this exact pairing has
      // completed a signed, end-to-end announcement test.
      automaticReceiverVerifiedPairingAt: 0,
      musicProvider: 'controlled',
      musicUrl: DEFAULT_SUNO_SOURCE,
      musicLabel: 'Serenity Shores Suno playlist',
      appleUrl: DEFAULT_APPLE_MUSIC_PLAYLIST,
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
    announcementSources: clone(DEFAULT_ANNOUNCEMENT_SOURCES),
    announcements: clone(DEFAULT_ANNOUNCEMENTS).map(item => ({ ...item, sourceId: 'natural-voice' })),
    schedules: [clone(defaultNamedSchedule)],
    activeScheduleId: DEFAULT_SCHEDULE_ID,
    // Compatibility projection for older time-only clients and receivers.
    schedule: defaultNamedSchedule.items.map(legacyProjectionItem),
    scheduleProjectionSignature: scheduleProjectionSignature(defaultNamedSchedule.items),
    scheduleRuns: {},
    sequenceRuns: {},
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
    text: String(item?.text || '').slice(0, 900),
    sourceId: boundedString(item?.sourceId ?? item?.announcementSourceId, 120, 'natural-voice') || 'natural-voice'
  };
}

function boundedString(value, maxLength, fallback = '') {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

export function isHttpsUrl(value) {
  try {
    return new URL(String(value || '').trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

function announcementProvider(value) {
  const requested = boundedString(value, 40).toLowerCase();
  if (['ai', 'natural-voice', 'openai', 'openai-tts', 'voice'].includes(requested)) return 'openai-tts';
  return ['direct', 'suno', 'apple', 'spotify'].includes(requested) ? requested : '';
}

export function normalizeAnnouncementSource(item) {
  if (!item || typeof item !== 'object') return null;
  const id = boundedString(item.id, 120);
  const provider = announcementProvider(item.provider ?? item.type ?? item.kind);
  if (!id || !provider) return null;
  const naturalVoice = provider === 'openai-tts';
  const providerTakeover = provider === 'apple' || provider === 'spotify';
  const requestedDuration = Number(item.durationSeconds ?? item.expectedDurationSeconds);
  const durationSeconds = !naturalVoice && Number.isInteger(requestedDuration)
    && requestedDuration >= 1 && requestedDuration <= ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS
    ? requestedDuration
    : 0;
  const url = naturalVoice ? '' : boundedString(item.url ?? item.locator?.url, 2000);
  const finite = naturalVoice || item.finite === true;
  const finiteAudio = (provider === 'direct' || provider === 'suno')
    && finite
    && isHttpsUrl(url)
    && durationSeconds > 0;
  const playbackSupport = naturalVoice || finiteAudio
    ? 'supported'
    : providerTakeover
      ? 'experimental'
      : 'unsupported';
  const note = providerTakeover
    ? 'Apple Music and Spotify catalog playback cannot report reliable completion or restore the prior queue on one iPhone.'
    : playbackSupport === 'unsupported'
      ? `Use a finite HTTPS Suno/direct clip with an explicit expected duration of 1-${ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS} seconds.`
      : boundedString(item.note, 300);
  return {
    id,
    label: boundedString(item.label, 100, naturalVoice ? 'Natural Voice' : 'Announcement clip') || (naturalVoice ? 'Natural Voice' : 'Announcement clip'),
    kind: naturalVoice ? 'natural-voice' : 'finite-audio',
    provider,
    url,
    finite,
    durationSeconds,
    playbackSupport,
    verification: item.verification === 'verified' ? 'verified' : 'unverified',
    voice: naturalVoice ? (boundedString(item.voice, 40, 'marin') || 'marin') : '',
    instructions: naturalVoice ? boundedString(item.instructions, 700) : '',
    note
  };
}

export function announcementDeliveryForSource(source) {
  const normalized = normalizeAnnouncementSource(source);
  if (!normalized || normalized.playbackSupport !== 'supported') {
    throw new Error('Choose Natural Voice or a supported short Suno/direct announcement clip.');
  }
  if (normalized.kind === 'natural-voice') {
    return {
      announcementMode: 'natural-voice',
      announcementProvider: '',
      announcementAudioUrl: '',
      announcementDurationSeconds: 0
    };
  }
  return {
    announcementMode: 'finite-audio',
    announcementProvider: normalized.provider,
    announcementAudioUrl: normalized.url,
    announcementDurationSeconds: normalized.durationSeconds
  };
}

function normalizeTime(value, fallback = '12:00') {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function scheduleActionKind(item) {
  const requested = String(item?.action?.kind ?? item?.kind ?? item?.type ?? '').toLowerCase();
  if (requested === 'apple') return 'apple';
  if (requested === 'spotify') return 'spotify';
  if (['controlled', 'suno', 'direct', 'audio'].includes(requested)) return 'controlled';
  return 'announcement';
}

function scheduleItemOrder(item, index = 0) {
  return clamp(item?.position?.order ?? item?.order, 1, MAX_SCHEDULE_ITEMS, index + 1);
}

export function normalizeScheduleItem(item, index = 0) {
  const source = item && typeof item === 'object' ? item : {};
  const kind = scheduleActionKind(source);
  const actionSource = source.action && typeof source.action === 'object' ? source.action : {};
  const volumeSource = source.volume && typeof source.volume === 'object' ? source.volume : {};
  const advanceSource = source.advance && typeof source.advance === 'object' ? source.advance : {};
  const inferredInlineText = actionSource.text ?? actionSource.inlineText ?? source.inlineText ?? source.customText ?? source.text ?? '';
  const requestedAnnouncementSource = String(actionSource.announcementSource ?? source.announcementSource ?? '').toLowerCase();
  const announcementSource = requestedAnnouncementSource === 'inline' || (!requestedAnnouncementSource && boundedString(inferredInlineText, 900))
    ? 'inline'
    : 'saved';
  const requestedAdvanceMode = String(advanceSource.mode ?? source.advanceMode ?? '').toLowerCase();
  const defaultAdvanceMode = kind === 'announcement' ? 'complete' : 'manual';
  // Speech has one truthful completion gate: the announcement promise resolves
  // after spoken audio finishes. Persisted legacy values must not turn speech
  // into an unsupported timer, track-end, or manual gate.
  const advanceMode = kind === 'announcement'
    ? 'complete'
    : ['complete', 'track-end', 'duration', 'manual'].includes(requestedAdvanceMode)
      ? requestedAdvanceMode
      : defaultAdvanceMode;
  // Version X has one announcement level: 100%. Only music items may keep a
  // custom level. This prevents a legacy/custom schedule row from quietly
  // weakening a safety or manager announcement.
  const volumeMode = kind !== 'announcement'
    && String(volumeSource.mode ?? source.volumeMode ?? '').toLowerCase() === 'custom'
      ? 'custom'
      : 'global';
  const defaultPercent = kind === 'announcement' ? VOICE_LEVEL_PERCENT : MUSIC_LEVEL_PERCENT;
  const time = normalizeTime(source.position?.time ?? source.time);
  const order = scheduleItemOrder(source, index);
  const announcementId = boundedString(actionSource.announcementId ?? source.announcementId, 120);
  const sourceId = boundedString(actionSource.sourceId ?? source.sourceId, 120);
  const url = boundedString(actionSource.url ?? source.url, 2000);
  const normalized = {
    id: boundedString(source.id, 120) || makeId('schedule-item'),
    label: boundedString(source.label, 100, 'Scheduled item') || 'Scheduled item',
    enabled: source.enabled !== false,
    days: Array.isArray(source.days)
      ? [...new Set(source.days.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
      : [0, 1, 2, 3, 4, 5, 6],
    position: { time, order },
    action: {
      kind,
      announcementSource,
      announcementId,
      sourceId,
      text: boundedString(inferredInlineText, 900),
      url
    },
    volume: {
      mode: volumeMode,
      percent: kind === 'announcement'
        ? VOICE_LEVEL_PERCENT
        : clamp(volumeSource.percent ?? source.volumePercent, 0, 100, defaultPercent)
    },
    advance: {
      mode: advanceMode,
      durationSeconds: clamp(
        advanceSource.durationSeconds ?? source.durationSeconds,
        SCHEDULE_DURATION_MIN_SECONDS,
        SCHEDULE_DURATION_MAX_SECONDS,
        SCHEDULE_DURATION_DEFAULT_SECONDS
      )
    }
  };

  // Synchronized aliases keep the existing time-schedule UI/runtime operational
  // while named schedules roll out. New code should prefer the nested fields.
  return {
    ...normalized,
    type: kind,
    time,
    order,
    announcementId,
    url
  };
}

function normalizeScheduleItems(items) {
  return (Array.isArray(items) ? items : [])
    .slice(0, MAX_SCHEDULE_ITEMS)
    .map((item, index) => ({ item: normalizeScheduleItem(item, index), index, requestedOrder: scheduleItemOrder(item, index) }))
    .sort((a, b) => a.requestedOrder - b.requestedOrder || a.index - b.index)
    .map(({ item }, index) => ({
      ...item,
      position: { ...item.position, order: index + 1 },
      order: index + 1
    }));
}

function legacyProjectionItem(item) {
  const source = item && typeof item === 'object' ? item : {};
  return {
    id: boundedString(source.id, 120),
    label: boundedString(source.label, 100, 'Scheduled item') || 'Scheduled item',
    type: scheduleActionKind(source),
    time: normalizeTime(source.time ?? source.position?.time),
    announcementId: boundedString(source.announcementId ?? source.action?.announcementId, 120),
    url: boundedString(source.url ?? source.action?.url, 2000),
    enabled: source.enabled !== false,
    days: Array.isArray(source.days)
      ? [...new Set(source.days.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
      : [0, 1, 2, 3, 4, 5, 6]
  };
}

function reconcileLegacyProjectionItems(items, currentItems) {
  const currentById = new Map(normalizeScheduleItems(currentItems).map(item => [item.id, item]));
  const projected = (Array.isArray(items) ? items : []).slice(0, MAX_SCHEDULE_ITEMS);
  return normalizeScheduleItems(projected.map((item, index) => {
    const legacy = legacyProjectionItem(item);
    const current = currentById.get(legacy.id) || {};
    return {
      ...current,
      id: legacy.id || current.id,
      label: legacy.label,
      enabled: legacy.enabled,
      days: legacy.days,
      position: {
        ...(current.position || {}),
        time: legacy.time,
        order: index + 1
      },
      action: {
        ...(current.action || {}),
        kind: legacy.type,
        announcementId: legacy.announcementId,
        url: legacy.url
      },
      type: legacy.type,
      time: legacy.time,
      order: index + 1,
      announcementId: legacy.announcementId,
      url: legacy.url
    };
  }));
}

function scheduleProjectionSignature(items) {
  const serialized = JSON.stringify((Array.isArray(items) ? items : [])
    .slice(0, MAX_SCHEDULE_ITEMS)
    .map(legacyProjectionItem));
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-v1-${serialized.length}-${(hash >>> 0).toString(36)}`;
}

export function normalizeNamedSchedule(schedule, index = 0) {
  const source = schedule && typeof schedule === 'object' ? schedule : {};
  return {
    id: boundedString(source.id, 120) || makeId('schedule', Date.now() + index),
    name: boundedString(source.name ?? source.label, 80, `Schedule ${index + 1}`) || `Schedule ${index + 1}`,
    mode: String(source.mode || '').toLowerCase() === 'order' ? 'order' : 'time',
    enabled: source.enabled !== false,
    items: normalizeScheduleItems(Array.isArray(source.items) ? source.items : source.schedule)
  };
}

export function getActiveSchedule(state) {
  const schedules = Array.isArray(state?.schedules) ? state.schedules : [];
  if (schedules.length) {
    return schedules.find(schedule => String(schedule?.id || '') === String(state?.activeScheduleId || '')) || schedules[0];
  }
  if (Array.isArray(state?.schedule)) {
    return normalizeNamedSchedule({ id: 'legacy-schedule', name: 'Daily Schedule', mode: 'time', items: state.schedule });
  }
  return null;
}

export function effectiveScheduleItemVolume(item, config = {}) {
  const kind = scheduleActionKind(item);
  if (kind === 'announcement') return VOICE_LEVEL_PERCENT;
  const volume = item?.volume && typeof item.volume === 'object' ? item.volume : {};
  if (String(volume.mode ?? item?.volumeMode ?? '').toLowerCase() === 'custom') {
    return clamp(volume.percent ?? item?.volumePercent, 0, 100, MUSIC_LEVEL_PERCENT);
  }
  if (typeof config === 'number') return clamp(config, 0, 100, MUSIC_LEVEL_PERCENT);
  return clamp(config?.musicLevel, 0, 100, MUSIC_LEVEL_PERCENT);
}

export function inlineAnnouncementText(item) {
  const source = String(item?.action?.announcementSource ?? item?.announcementSource ?? '').toLowerCase();
  if (source !== 'inline') return '';
  return boundedString(item?.action?.text ?? item?.inlineText ?? item?.customText ?? item?.text, 900);
}

export function resolveScheduleAnnouncementText(item, announcements = []) {
  const source = String(item?.action?.announcementSource ?? item?.announcementSource ?? '').toLowerCase();
  if (source === 'inline') return inlineAnnouncementText(item);
  const announcementId = boundedString(item?.action?.announcementId ?? item?.announcementId, 120);
  const saved = (Array.isArray(announcements) ? announcements : [])
    .find(announcement => String(announcement?.id || '') === announcementId);
  return boundedString(saved?.text, 900);
}

export function reorderScheduleItems(items, itemId, targetOrder) {
  const normalized = normalizeScheduleItems(items);
  const fromIndex = normalized.findIndex(item => String(item.id) === String(itemId));
  if (fromIndex < 0 || normalized.length < 2) return normalized;
  const [moved] = normalized.splice(fromIndex, 1);
  const toIndex = clamp(targetOrder, 1, normalized.length + 1, fromIndex + 1) - 1;
  normalized.splice(toIndex, 0, moved);
  return normalized.map((item, index) => ({
    ...item,
    position: { ...item.position, order: index + 1 },
    order: index + 1
  }));
}

function boundedTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(number)));
}

function normalizeSequenceActive(active) {
  const source = active && typeof active === 'object' ? active : null;
  if (!source) return null;

  const token = boundedString(source.token, 160);
  const itemId = boundedString(source.itemId, 120);
  const requestedOrder = Number(source.order);
  const order = Number.isFinite(requestedOrder)
    ? clamp(requestedOrder, 1, MAX_SCHEDULE_ITEMS, 1)
    : 0;
  // A durable active gate without these three identifiers cannot be matched to
  // a schedule item or safely completed, so discard it instead of guessing.
  if (!token || !itemId || order < 1) return null;

  const kind = scheduleActionKind({ type: source.kind });
  const requestedAdvanceMode = String(source.advanceMode || '').toLowerCase();
  const advanceMode = kind === 'announcement'
    ? 'complete'
    : ['complete', 'track-end', 'duration', 'manual'].includes(requestedAdvanceMode)
      ? requestedAdvanceMode
      : 'manual';
  const requestedProvider = String(source.expectedProvider || '').toLowerCase();

  return {
    token,
    triggerId: boundedString(source.triggerId, 160),
    itemId,
    fingerprint: boundedString(source.fingerprint, 80),
    order,
    kind,
    advanceMode,
    receiverId: boundedString(source.receiverId, 160),
    sessionId: boundedString(source.sessionId, 160),
    claimedAt: boundedTimestamp(source.claimedAt),
    startedAt: boundedTimestamp(source.startedAt),
    dueAt: boundedTimestamp(source.dueAt),
    expectedProvider: ['controlled', 'apple', 'spotify'].includes(requestedProvider) ? requestedProvider : '',
    expectedUrl: boundedString(source.expectedUrl, 2000)
  };
}

export function normalizeSequenceRun(run) {
  const source = run && typeof run === 'object' ? run : {};
  const requestedStatus = String(source.status || '').toLowerCase();
  const active = normalizeSequenceActive(source.active);
  const status = SEQUENCE_RUN_STATUSES.has(requestedStatus)
    ? requestedStatus
    : active
      ? 'claiming'
      : 'idle';
  const requestedOutcome = String(source.lastOutcome || '').toLowerCase();

  return {
    version: SEQUENCE_RUN_VERSION,
    order: clamp(source.order, 0, MAX_SCHEDULE_ITEMS, 0),
    itemId: boundedString(source.itemId, 120),
    status,
    active,
    lastTriggerId: boundedString(source.lastTriggerId, 160),
    lastOutcome: SEQUENCE_RUN_OUTCOMES.has(requestedOutcome) ? requestedOutcome : '',
    lastError: boundedString(source.lastError, 300),
    updatedAt: boundedTimestamp(source.updatedAt)
  };
}

export function normalizeSequenceRuns(input, schedules = []) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const knownIds = new Set((Array.isArray(schedules) ? schedules : [])
    .map(schedule => boundedString(schedule?.id, 120))
    .filter(Boolean));
  const normalized = {};
  for (const [scheduleId, run] of Object.entries(source)) {
    const id = boundedString(scheduleId, 120);
    if (!id || !knownIds.has(id)) continue;
    normalized[id] = normalizeSequenceRun(run);
  }
  return normalized;
}

export function orderedEnabledScheduleItems(schedule) {
  if (!schedule || typeof schedule !== 'object' || schedule.enabled === false || String(schedule.mode || '').toLowerCase() !== 'order') return [];
  return normalizeScheduleItems(schedule.items)
    .filter(item => item.enabled !== false);
}

export function nextOrderScheduleItem(schedule, committedOrder = 0) {
  const order = clamp(committedOrder, 0, MAX_SCHEDULE_ITEMS, 0);
  return orderedEnabledScheduleItems(schedule)
    .find(item => Number(item.position?.order ?? item.order ?? 0) > order) || null;
}

export function cancelSequenceRun(run, now = Date.now(), reason = 'Order run cancelled.') {
  const normalized = normalizeSequenceRun(run);
  return {
    ...normalized,
    status: 'cancelled',
    active: null,
    lastTriggerId: normalized.active?.triggerId || normalized.lastTriggerId,
    lastOutcome: 'cancelled',
    lastError: boundedString(reason, 300),
    updatedAt: boundedTimestamp(now)
  };
}

function normalizeScheduleCollection(source, defaults) {
  let candidates;
  if (Array.isArray(source.schedules)) {
    candidates = source.schedules.length
      ? source.schedules
      : [{ id: 'schedule-1', name: 'Schedule 1', mode: 'time', items: [] }];
  } else if (Array.isArray(source.schedule)) {
    candidates = [{
      id: 'legacy-schedule',
      name: boundedString(source.scheduleName, 80, 'Daily Schedule') || 'Daily Schedule',
      mode: 'time',
      enabled: true,
      items: source.schedule
    }];
  } else {
    return clone(defaults.schedules);
  }

  const seenIds = new Set();
  return candidates.map((schedule, index) => {
    const normalized = normalizeNamedSchedule(schedule, index);
    let id = normalized.id;
    let suffix = 2;
    while (seenIds.has(id)) {
      const suffixText = `-${suffix++}`;
      id = `${normalized.id.slice(0, 120 - suffixText.length)}${suffixText}`;
    }
    seenIds.add(id);
    return { ...normalized, id };
  });
}

export function normalizeState(input, now = Date.now()) {
  const defaults = createDefaultState(now);
  const source = input && typeof input === 'object' ? input : {};
  const sourceConfig = source.config && typeof source.config === 'object' && !Array.isArray(source.config)
    ? source.config
    : {};
  const hasReceiverMode = Object.prototype.hasOwnProperty.call(sourceConfig, 'receiverMode');
  const config = { ...defaults.config, ...sourceConfig };
  if (hasReceiverMode) {
    config.receiverMode = config.receiverMode === 'pushcut' ? 'pushcut' : 'browser';
  } else {
    // State written before the shared receiver handoff existed must remain
    // distinguishable from an explicit Browser selection. The app can then
    // infer a ready Pushcut-only receiver until a user explicitly saves a
    // receiver mode. Fresh state still starts in Browser mode because
    // createDefaultState() includes receiverMode.
    delete config.receiverMode;
  }
  config.announcementTransport =
    config.announcementTransport === 'email-wake'
      ? 'email-wake'
      : 'browser';
  const automaticReceiverVerifiedPairingAt = Number(
    config.automaticReceiverVerifiedPairingAt
  );
  config.automaticReceiverVerifiedPairingAt =
    Number.isSafeInteger(automaticReceiverVerifiedPairingAt)
    && automaticReceiverVerifiedPairingAt > 0
      ? automaticReceiverVerifiedPairingAt
      : 0;
  config.musicProvider = ['apple', 'spotify'].includes(config.musicProvider) ? config.musicProvider : 'controlled';
  config.musicLevel = clamp(config.musicLevel, 0, 100, MUSIC_LEVEL_PERCENT);
  // Announcements are intentionally not user-adjustable in Version X.
  config.voiceLevel = VOICE_LEVEL_PERCENT;
  config.voiceMode = 'ai';
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
        detail: String(source.receiver.detail || '').slice(0, 300),
        appleStatus: String(source.receiver.appleStatus || 'login-required').slice(0, 40),
        appleDetail: String(source.receiver.appleDetail || '').slice(0, 300),
        appleVerifiedAt: Math.max(0, Number(source.receiver.appleVerifiedAt || 0) || 0),
        receiverKind: String(source.receiver.receiverKind || '').slice(0, 60),
        appleTransport: String(source.receiver.appleTransport || '').slice(0, 60),
        appleVolumeCapability: String(source.receiver.appleVolumeCapability || '').slice(0, 60),
        spotifyStatus: String(source.receiver.spotifyStatus || 'login-required').slice(0, 40),
        spotifyDetail: String(source.receiver.spotifyDetail || '').slice(0, 300),
        spotifyVerifiedAt: Math.max(0, Number(source.receiver.spotifyVerifiedAt || 0) || 0)
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
  const announcementSourceMap = new Map(defaults.announcementSources
    .map(normalizeAnnouncementSource)
    .filter(Boolean)
    .map(item => [item.id, item]));
  for (const item of (Array.isArray(source.announcementSources) ? source.announcementSources : []).slice(0, 40)) {
    const normalized = normalizeAnnouncementSource(item);
    if (normalized) announcementSourceMap.set(normalized.id, normalized);
  }
  const announcementSources = [...announcementSourceMap.values()].slice(0, 40);
  const validAnnouncementSourceIds = new Set(announcementSources.map(item => item.id));
  for (const [id, item] of announcementMap) {
    if (!item.sourceId || !validAnnouncementSourceIds.has(item.sourceId)) {
      announcementMap.set(id, { ...item, sourceId: 'natural-voice' });
    }
  }

  let schedules = normalizeScheduleCollection(source, defaults);
  const requestedActiveScheduleId = boundedString(source.activeScheduleId, 120);
  let activeSchedule = schedules.find(schedule => schedule.id === requestedActiveScheduleId) || schedules[0];
  const projectionWasEditedByLegacyClient = activeSchedule?.mode === 'time'
    && Array.isArray(source.schedule)
    && typeof source.scheduleProjectionSignature === 'string'
    && source.scheduleProjectionSignature !== scheduleProjectionSignature(source.schedule);
  if (projectionWasEditedByLegacyClient) {
    const activeIndex = schedules.findIndex(schedule => schedule.id === activeSchedule.id);
    schedules = schedules.map((schedule, index) => index === activeIndex
      ? { ...schedule, items: reconcileLegacyProjectionItems(source.schedule, activeSchedule.items) }
      : schedule);
    activeSchedule = schedules[activeIndex];
  }
  schedules = schedules.map(savedSchedule => ({
    ...savedSchedule,
    items: savedSchedule.items.map(item => scheduleActionKind(item) === 'announcement'
      ? {
          ...item,
          action: {
            ...item.action,
            sourceId: validAnnouncementSourceIds.has(item.action?.sourceId)
              ? item.action.sourceId
              : 'natural-voice'
          }
        }
      : item)
  }));
  activeSchedule = schedules.find(savedSchedule => savedSchedule.id === activeSchedule?.id) || schedules[0];
  const activeScheduleId = activeSchedule?.id || '';
  // Existing receivers only understand time-triggered items. An Order schedule
  // must never leak into that timer path and accidentally run at placeholder times.
  const schedule = activeSchedule?.enabled !== false && activeSchedule?.mode === 'time'
    ? activeSchedule.items.map(legacyProjectionItem)
    : [];
  const scheduleProjection = scheduleProjectionSignature(schedule);

  return {
    ...defaults,
    ...source,
    version: STATE_VERSION,
    config,
    receiver,
    playback: { ...defaults.playback, ...(source.playback || {}) },
    weather: { ...defaults.weather, ...(source.weather || {}) },
    announcementSources,
    announcements: [...announcementMap.values()],
    schedules,
    activeScheduleId,
    schedule,
    scheduleProjectionSignature: scheduleProjection,
    scheduleRuns: source.scheduleRuns && typeof source.scheduleRuns === 'object' ? source.scheduleRuns : {},
    sequenceRuns: normalizeSequenceRuns(source.sequenceRuns, schedules),
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

export function makeReceiverLease({
  deviceId,
  sessionId,
  name = 'Speaker Receiver',
  platform = '',
  audioMode = '',
  appleStatus = 'login-required',
  appleDetail = '',
  appleVerifiedAt = 0,
  receiverKind = '',
  appleTransport = '',
  appleVolumeCapability = '',
  spotifyStatus = 'login-required',
  spotifyDetail = '',
  spotifyVerifiedAt = 0
}, now = Date.now()) {
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
    detail: 'Receiver audio unlocked and command session active.',
    appleStatus: String(appleStatus || 'login-required').slice(0, 40),
    appleDetail: String(appleDetail || '').slice(0, 300),
    appleVerifiedAt: Math.max(0, Number(appleVerifiedAt || 0) || 0),
    receiverKind: String(receiverKind || '').slice(0, 60),
    appleTransport: String(appleTransport || '').slice(0, 60),
    appleVolumeCapability: String(appleVolumeCapability || '').slice(0, 60),
    spotifyStatus: String(spotifyStatus || 'login-required').slice(0, 40),
    spotifyDetail: String(spotifyDetail || '').slice(0, 300),
    spotifyVerifiedAt: Math.max(0, Number(spotifyVerifiedAt || 0) || 0)
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
  if (!receiverOnline(receiver, now)) throw new Error('The speaker receiver is offline. Open Version X on the speaker device and tap Start Receiver.');
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

export function audioPolicy({
  provider = 'controlled',
  isIOS = false,
  supportsVolume = false,
  volumeVerified = false,
  verifiedPercent = null,
  musicPercent = MUSIC_LEVEL_PERCENT,
  voicePercent = VOICE_LEVEL_PERCENT
} = {}) {
  const target = clamp(musicPercent, 0, 100, MUSIC_LEVEL_PERCENT);
  const voiceTarget = VOICE_LEVEL_PERCENT;
  const verifiedAtTarget = volumeVerified === true && Number(verifiedPercent) === target;
  if (provider === 'controlled') {
    return {
      id: 'controlled-adjustable-duck',
      exact: true,
      musicPercent: target,
      voicePercent: voiceTarget,
      duringVoicePercent: Math.min(DUCK_LEVEL_PERCENT, target),
      action: 'duck',
      label: `Exact ${target}/${voiceTarget} mix`,
      detail: `Receiver-owned Suno/direct audio is routed through one Web Audio mixer: music ${target}%, announcements ${voiceTarget}%, music ${Math.min(DUCK_LEVEL_PERCENT, target)}% during speech.`
    };
  }
  const externalName = provider === 'spotify' ? 'Spotify' : 'Apple Music';
  const providerId = provider === 'spotify' ? 'spotify' : 'apple';
  if (!isIOS && supportsVolume && verifiedAtTarget) {
    return {
      id: `${providerId}-verified-volume-pause`,
      exact: true,
      musicPercent: target,
      voicePercent: voiceTarget,
      duringVoicePercent: 0,
      action: 'pause',
      label: `Verified ${externalName} ${target}% + voice takeover`,
      detail: `This receiver reports ${externalName} volume support. ${externalName} is verified at ${target}%, paused for announcements, then resumed without restarting the track.`
    };
  }
  return {
    id: isIOS ? `${providerId}-ios-pause-only` : `${providerId}-unverified-pause-only`,
    exact: false,
    musicPercent: null,
    voicePercent: voiceTarget,
    duringVoicePercent: 0,
    action: 'pause',
    label: `${externalName} pause-for-voice compatibility`,
    detail: isIOS
      ? `iPhone/iPad browsers cannot set ${externalName} playback volume directly. Use the receiver iPhone or connected speaker controls; when Pushcut is configured, the Poolside Pulse Shortcut sets the shared device output to ${target}% for music and ${voiceTarget}% for announcements. ${externalName} pauses during speech and resumes afterward.`
      : `${externalName} volume has not been verified at ${target}% on this receiver. ${externalName} will pause for announcements and resume afterward.`
  };
}

export function managerVolumePlan({
  selectedProvider = 'controlled',
  receiverIsIOS = false,
  playbackProvider = '',
  playbackIntent = 'stopped',
  controlledSource = '',
  startControlled = false
} = {}) {
  const externalSelected = selectedProvider === 'apple' || selectedProvider === 'spotify';
  const externalPlayback = playbackProvider === 'apple' || playbackProvider === 'spotify';
  const switchToControlled = externalSelected && receiverIsIOS === true;
  const externalPlaybackPlaying = externalPlayback && playbackIntent === 'playing';
  const externalPlaybackActive = externalPlayback && playbackIntent !== 'stopped';
  const hasControlledSource = String(controlledSource || '').trim().length > 0;
  return {
    switchToControlled,
    nextProvider: switchToControlled ? 'controlled' : externalSelected ? selectedProvider : 'controlled',
    command: switchToControlled && hasControlledSource && (externalPlaybackPlaying || startControlled === true)
      ? 'play-controlled'
      : switchToControlled && externalPlaybackActive
        ? 'stop-music'
      : 'set-music-level'
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

export function isAppleMusicUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && (url.hostname === 'music.apple.com' || url.hostname.endsWith('.music.apple.com'));
  } catch {
    return false;
  }
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

export function dueTimeScheduleItems(scheduleOrItems, scheduleRuns, now = Date.now(), timeZone = WEATHER_TIME_ZONE, catchupMs = SCHEDULE_CATCHUP_MS) {
  if (!Array.isArray(scheduleOrItems) && (String(scheduleOrItems?.mode || 'time') !== 'time' || scheduleOrItems?.enabled === false)) return [];
  const items = Array.isArray(scheduleOrItems) ? scheduleOrItems : scheduleOrItems?.items;
  const parts = zonedParts(now, timeZone);
  const currentSeconds = parts.hour * 3600 + parts.minute * 60 + parts.second;
  return (Array.isArray(items) ? items : []).filter(item => {
    const time = String(item?.position?.time ?? item?.time ?? '');
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
    if (!item?.enabled || !timeMatch) return false;
    if (Array.isArray(item.days) && item.days.length && !item.days.map(Number).includes(parts.weekday)) return false;
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    if (hour > 23 || minute > 59) return false;
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

export function dueScheduleItems(schedule, scheduleRuns, now = Date.now(), timeZone = WEATHER_TIME_ZONE, catchupMs = SCHEDULE_CATCHUP_MS) {
  return dueTimeScheduleItems(schedule, scheduleRuns, now, timeZone, catchupMs);
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
    v: STATE_VERSION,
    lat: String(config?.latitude ?? 36.6337),
    lon: String(config?.longitude ?? -93.4166),
    radiusMiles: String(config?.lightningRadiusMiles ?? 10),
    lightningRadiusMiles: String(config?.lightningRadiusMiles ?? 10),
    windGustMph: String(config?.windGustMph ?? 35),
    ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  });
  return `/api/weather?${query.toString()}`;
}
