import { requireSession, sessionVariant } from './_auth.js';

const X_STATE_VERSION = 'x';
const X_STATE_KEY = 'serenity-shores-poolside-radio-vx-20260714';
const KV_REQUEST_TIMEOUT_MS = 8_000;
const MAX_REQUEST_BYTES = 1_100_000;
const MAX_STATE_BYTES = 1_000_000;
const MAX_ANNOUNCEMENT_SOURCES = 200;
const MAX_FINITE_ANNOUNCEMENT_SECONDS = 45;
const X_BED_PROVIDER_ALIASES = new Map([
  ['apple', 'apple'],
  ['audio', 'controlled'],
  ['controlled', 'controlled'],
  ['direct', 'controlled'],
  ['spotify', 'spotify'],
  ['suno', 'controlled']
]);
const X_ANNOUNCEMENT_MEDIA_PROVIDERS = new Set(['apple', 'direct', 'spotify', 'suno']);
const CONFIG_SECRET_KEYS = Object.freeze([
  'appleMusicPrivateKey',
  'applePrivateKey',
  'privateKey',
  'APPLE_MUSIC_PRIVATE_KEY',
  'spotifyAccessToken',
  'spotifyRefreshToken',
  'spotifyClientSecret',
  'SPOTIFY_ACCESS_TOKEN',
  'SPOTIFY_REFRESH_TOKEN',
  'SPOTIFY_CLIENT_SECRET',
  'openAIApiKey',
  'OPENAI_API_KEY',
  'pushcutApiKey',
  'PUSHCUT_API_KEY_X'
]);
const X_COMPARE_AND_SET_SCRIPT = `
local current = redis.call("GET", KEYS[1])
local currentRevision = 0
if current then
  local decodedOk, decoded = pcall(cjson.decode, current)
  if decodedOk and type(decoded) == "table" then
    local candidate = tonumber(decoded.revision)
    if candidate and candidate >= 0 and candidate == math.floor(candidate) then
      currentRevision = candidate
    end
  end
end
if currentRevision ~= tonumber(ARGV[1]) then
  return {0, currentRevision, current or ""}
end
redis.call("SET", KEYS[1], ARGV[2])
return {1, currentRevision + 1}
`;

let coreNormalizerPromise;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Cookie');
  res.end(JSON.stringify(body));
}

function stateRevision(state) {
  const revision = Number(state?.revision);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeClone(value, depth = 0) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 20_000);
  if (depth >= 12) return null;
  if (Array.isArray(value)) return value.slice(0, 500).map(item => safeClone(item, depth + 1));
  if (!isRecord(value)) return null;
  const clean = {};
  for (const [key, item] of Object.entries(value).slice(0, 400)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    clean[String(key).slice(0, 160)] = safeClone(item, depth + 1);
  }
  return clean;
}

function boundedString(value, maxLength, fallback = '') {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function normalizeBedProvider(value, fallback = 'controlled') {
  const requested = boundedString(value, 40).toLowerCase();
  if (X_BED_PROVIDER_ALIASES.has(requested)) return X_BED_PROVIDER_ALIASES.get(requested);
  const safeFallback = boundedString(fallback, 40).toLowerCase();
  return X_BED_PROVIDER_ALIASES.get(safeFallback) || 'controlled';
}

function safeHttpsUrl(value) {
  const text = boundedString(value, 2_000);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    return text;
  } catch {
    return '';
  }
}

function sanitizeConfig(value) {
  const source = isRecord(value) ? safeClone(value) : {};
  const hasReceiverMode = Object.prototype.hasOwnProperty.call(source, 'receiverMode');
  const requestedReceiverMode = boundedString(source.receiverMode, 40).toLowerCase();
  const clean = {
    ...source,
    // `controlled` remains the compatibility identifier for the existing
    // Suno/direct Web Audio bed. Apple and Spotify are separate provider beds.
    musicProvider: normalizeBedProvider(source.musicProvider),
    musicLevel: clamp(source.musicLevel, 0, 100, 30),
    voiceLevel: 100,
    voiceMode: 'ai',
    // Version X guarantees no music/voice overlap. A spoken announcement fully
    // silences the music path and always uses the fixed 100% announcement gain.
    duckLevel: 0
  };
  if (hasReceiverMode) {
    clean.receiverMode = ['browser', 'pushcut'].includes(requestedReceiverMode)
      ? requestedReceiverMode
      : 'browser';
  } else {
    // Preserve the absence of this newer field in legacy state. Treating an
    // old Pushcut-only installation as an explicit Browser selection makes
    // the client compatibility inference unreachable.
    delete clean.receiverMode;
  }
  for (const key of CONFIG_SECRET_KEYS) delete clean[key];
  return clean;
}

function sanitizePlayback(value, fallbackProvider = 'controlled') {
  const source = isRecord(value) ? safeClone(value) : {};
  const clean = {
    ...source,
    provider: normalizeBedProvider(source.provider, fallbackProvider)
  };
  for (const key of CONFIG_SECRET_KEYS) delete clean[key];
  return clean;
}

function normalizeAnnouncementProvider(value) {
  const requested = boundedString(value, 40).toLowerCase();
  if (['ai', 'natural-voice', 'openai', 'openai-tts'].includes(requested)) return 'openai-tts';
  return X_ANNOUNCEMENT_MEDIA_PROVIDERS.has(requested) ? requested : '';
}

function sanitizeAnnouncementSource(value) {
  if (!isRecord(value)) return null;
  const source = safeClone(value);
  const id = boundedString(source.id, 120);
  const provider = normalizeAnnouncementProvider(source.provider ?? source.type ?? source.kind);
  if (!id || !provider) return null;

  const naturalVoice = provider === 'openai-tts';
  const requestedKind = boundedString(source.kind ?? source.type, 40).toLowerCase();
  if (naturalVoice && requestedKind && !['ai', 'natural-voice', 'openai', 'openai-tts', 'speech', 'voice'].includes(requestedKind)) {
    return null;
  }
  if (!naturalVoice && requestedKind && !['apple', 'audio', 'direct', 'finite-audio', 'media', 'spotify', 'suno'].includes(requestedKind)) {
    return null;
  }

  const kind = naturalVoice ? 'natural-voice' : 'media';
  const url = naturalVoice ? '' : safeHttpsUrl(source.url ?? source.locator?.url);
  const finite = naturalVoice ? true : source.finite === true;
  const requestedDuration = Number(source.durationSeconds ?? source.expectedDurationSeconds);
  const durationSeconds = !naturalVoice && Number.isInteger(requestedDuration)
    && requestedDuration >= 1 && requestedDuration <= MAX_FINITE_ANNOUNCEMENT_SECONDS
    ? requestedDuration
    : 0;
  const providerTakeover = provider === 'apple' || provider === 'spotify';
  const finiteDirectMedia = (provider === 'direct' || provider === 'suno')
    && finite
    && Boolean(url)
    && durationSeconds > 0;
  const playbackSupport = naturalVoice || finiteDirectMedia
    ? 'supported'
    : providerTakeover
      ? 'experimental'
      : 'unsupported';
  const note = providerTakeover
    ? 'Catalog playback completion and prior queue restoration are unverified on iPhone.'
    : playbackSupport === 'unsupported'
      ? 'Only finite HTTPS direct or Suno media can be used as a supported announcement.'
      : '';

  // Capability and verification are deliberately server-derived. Persisting a
  // browser-supplied "verified" flag would turn a saved catalog URL into a
  // false playback receipt.
  return {
    id,
    label: boundedString(source.label, 100, naturalVoice ? 'Natural voice' : 'Announcement media')
      || (naturalVoice ? 'Natural voice' : 'Announcement media'),
    kind,
    provider,
    url,
    finite,
    durationSeconds,
    playbackSupport,
    verification: 'unverified',
    ...(naturalVoice ? {
      voice: boundedString(source.voice, 40, 'marin') || 'marin',
      instructions: boundedString(source.instructions, 700)
    } : {}),
    ...(note ? { note } : {})
  };
}

function sanitizeAnnouncementSources(value) {
  const sources = new Map();
  for (const item of Array.isArray(value) ? value.slice(0, MAX_ANNOUNCEMENT_SOURCES) : []) {
    const clean = sanitizeAnnouncementSource(item);
    if (clean) sources.set(clean.id, clean);
  }
  return [...sources.values()];
}

function sanitizeAnnouncements(value, original, validSourceIds) {
  const originalById = new Map((Array.isArray(original) ? original : [])
    .filter(isRecord)
    .map(item => [boundedString(item.id, 120), item]));
  return (Array.isArray(value) ? value : []).map(item => {
    const clean = isRecord(item) ? safeClone(item) : {};
    const source = originalById.get(boundedString(clean.id, 120));
    const sourceId = boundedString(source?.sourceId ?? source?.announcementSourceId, 120);
    if (!sourceId || !validSourceIds.has(sourceId)) return clean;
    return { ...clean, sourceId };
  });
}

function requestedScheduleBedProvider(value) {
  if (!isRecord(value)) return null;
  const action = isRecord(value.action) ? value.action : {};
  const requested = boundedString(action.kind ?? value.kind ?? value.type, 40).toLowerCase();
  return X_BED_PROVIDER_ALIASES.has(requested) ? X_BED_PROVIDER_ALIASES.get(requested) : null;
}

function sanitizeScheduleItem(value, original, validSourceIds) {
  const clean = isRecord(value) ? safeClone(value) : {};
  const source = isRecord(original) ? original : clean;
  const bedProvider = requestedScheduleBedProvider(source);
  const action = isRecord(clean.action) ? clean.action : {};
  const originalAction = isRecord(source.action) ? source.action : {};
  const sourceId = boundedString(originalAction.sourceId ?? source.sourceId, 120);
  const nextAction = {
    ...action,
    ...(bedProvider ? { kind: bedProvider } : {}),
    ...(!bedProvider && sourceId && validSourceIds.has(sourceId) ? { sourceId } : {})
  };
  if (bedProvider) {
    delete nextAction.announcementSource;
    delete nextAction.announcementId;
    delete nextAction.text;
    delete nextAction.sourceId;
  }
  const originalVolume = isRecord(source.volume) ? source.volume : {};
  const originalAdvance = isRecord(source.advance) ? source.advance : {};
  const requestedAdvanceMode = boundedString(originalAdvance.mode ?? source.advanceMode, 40).toLowerCase();
  const bedAdvanceMode = ['complete', 'track-end', 'duration', 'manual'].includes(requestedAdvanceMode)
    ? requestedAdvanceMode
    : 'manual';
  return {
    ...clean,
    action: nextAction,
    ...(bedProvider ? {
      type: bedProvider,
      volume: {
        mode: boundedString(originalVolume.mode ?? source.volumeMode, 40).toLowerCase() === 'custom'
          ? 'custom'
          : 'global',
        percent: clamp(originalVolume.percent ?? source.volumePercent, 0, 100, 30)
      },
      advance: {
        mode: bedAdvanceMode,
        durationSeconds: clamp(
          originalAdvance.durationSeconds ?? source.durationSeconds,
          1,
          24 * 60 * 60,
          5 * 60
        )
      }
    } : {})
  };
}

function sanitizeSchedules(value, original, validSourceIds) {
  const originalSchedules = Array.isArray(original) ? original : [];
  const originalById = new Map(originalSchedules
    .filter(isRecord)
    .map(schedule => [boundedString(schedule.id, 120), schedule]));
  return (Array.isArray(value) ? value : []).map((schedule, scheduleIndex) => {
    const clean = isRecord(schedule) ? safeClone(schedule) : {};
    const source = originalById.get(boundedString(clean.id, 120)) || originalSchedules[scheduleIndex] || {};
    const sourceItems = Array.isArray(source.items) ? source.items : Array.isArray(source.schedule) ? source.schedule : [];
    const sourceItemsById = new Map(sourceItems
      .filter(isRecord)
      .map(item => [boundedString(item.id, 120), item]));
    return {
      ...clean,
      items: (Array.isArray(clean.items) ? clean.items : []).map((item, itemIndex) => sanitizeScheduleItem(
        item,
        sourceItemsById.get(boundedString(item?.id, 120)) || sourceItems[itemIndex],
        validSourceIds
      ))
    };
  });
}

function sanitizeLegacySchedule(value, schedules, activeScheduleId) {
  const active = (Array.isArray(schedules) ? schedules : [])
    .find(schedule => boundedString(schedule?.id, 120) === boundedString(activeScheduleId, 120));
  const fullItemsById = new Map((Array.isArray(active?.items) ? active.items : [])
    .filter(isRecord)
    .map(item => [boundedString(item.id, 120), item]));
  return (Array.isArray(value) ? value : []).map(item => {
    const clean = isRecord(item) ? safeClone(item) : {};
    const full = fullItemsById.get(boundedString(clean.id, 120));
    if (!full) return clean;
    const sourceId = boundedString(full.action?.sourceId, 120);
    return {
      ...clean,
      type: boundedString(full.action?.kind ?? full.type, 40, clean.type),
      ...(sourceId ? { sourceId } : {})
    };
  });
}

function sanitizeReceiver(value, original) {
  if (!isRecord(value)) return null;
  const clean = safeClone(value);
  const source = isRecord(original) ? original : {};
  const textFields = {
    spotifyStatus: 40,
    spotifyDetail: 300,
    spotifyDeviceId: 160,
    spotifyDeviceName: 160,
    spotifyTransport: 60,
    spotifyVolumeCapability: 60
  };
  for (const [key, limit] of Object.entries(textFields)) {
    if (source[key] != null) clean[key] = boundedString(source[key], limit);
  }
  if (source.spotifyVerifiedAt != null) {
    clean.spotifyVerifiedAt = Math.max(0, Number(source.spotifyVerifiedAt) || 0);
  }
  if (source.spotifyNeedsTap != null) clean.spotifyNeedsTap = source.spotifyNeedsTap !== false;
  for (const key of CONFIG_SECRET_KEYS) delete clean[key];
  return clean;
}

function sanitizeStateSchema(value, original) {
  const clean = isRecord(value) ? safeClone(value) : {};
  const source = isRecord(original) ? original : {};
  const config = sanitizeConfig({
    ...(isRecord(clean.config) ? clean.config : {}),
    ...(isRecord(source.config) ? source.config : {})
  });
  const announcementSources = sanitizeAnnouncementSources(source.announcementSources ?? clean.announcementSources);
  const validSourceIds = new Set(announcementSources.map(item => item.id));
  const sourceSchedules = Array.isArray(source.schedules)
    ? source.schedules
    : Array.isArray(source.schedule)
      ? [{
          id: clean.schedules?.[0]?.id,
          items: source.schedule
        }]
      : [];
  const schedules = sanitizeSchedules(clean.schedules, sourceSchedules, validSourceIds);
  const schedule = sanitizeLegacySchedule(clean.schedule, schedules, clean.activeScheduleId);
  return {
    ...clean,
    config,
    playback: sanitizePlayback({
      ...(isRecord(clean.playback) ? clean.playback : {}),
      ...(isRecord(source.playback) ? source.playback : {})
    }, config.musicProvider),
    receiver: sanitizeReceiver(clean.receiver, source.receiver),
    announcementSources,
    announcements: sanitizeAnnouncements(clean.announcements, source.announcements, validSourceIds),
    schedules,
    schedule
  };
}

function fallbackNormalizeState(value, now = Date.now()) {
  const source = isRecord(value) ? safeClone(value) : {};
  return sanitizeStateSchema({
    ...source,
    version: X_STATE_VERSION,
    config: sanitizeConfig(source.config),
    events: (Array.isArray(source.events) ? source.events : [])
      .filter(event => isRecord(event) && String(event.id || '').trim())
      .slice(-120),
    activityLog: (Array.isArray(source.activityLog) ? source.activityLog : [])
      .filter(entry => isRecord(entry) && String(entry.id || '').trim())
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
      .slice(0, 180),
    savedAt: Math.max(0, Number(source.savedAt || now) || now),
    revision: stateRevision(source)
  }, source);
}

async function coreNormalizer() {
  coreNormalizerPromise ||= import('../src/vx/core.js')
    .then(module => typeof module.normalizeState === 'function' ? module.normalizeState : null)
    .catch(() => null);
  return await coreNormalizerPromise;
}

async function sanitizeXState(value, now = Date.now()) {
  const source = isRecord(value) ? safeClone(value) : {};
  const normalizeState = await coreNormalizer();
  if (normalizeState) {
    try {
      const normalized = normalizeState(source, now);
      if (isRecord(normalized)) {
        const clean = sanitizeStateSchema(normalized, source);
        return {
          ...clean,
          version: X_STATE_VERSION,
          savedAt: Math.max(0, Number(clean.savedAt || now) || now),
          revision: stateRevision(clean)
        };
      }
    } catch {}
  }
  return fallbackNormalizeState(source, now);
}

function mergeById(limit, newestFirst, ...lists) {
  const merged = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isRecord(item) || !String(item.id || '').trim()) continue;
      const id = String(item.id).slice(0, 160);
      merged.set(id, { ...(merged.get(id) || {}), ...safeClone(item), id });
    }
  }
  const sorted = [...merged.values()].sort((left, right) => {
    const leftAt = Number(left.createdAt || left.ts || 0);
    const rightAt = Number(right.createdAt || right.ts || 0);
    return newestFirst ? rightAt - leftAt : leftAt - rightAt;
  });
  return newestFirst ? sorted.slice(0, limit) : sorted.slice(-limit);
}

async function sanitizeStoredState(value, now = Date.now()) {
  if (!isRecord(value)) return null;
  const safe = await sanitizeXState(value, now);
  return {
    ...safe,
    version: X_STATE_VERSION,
    savedAt: Math.max(0, Number(value.savedAt || safe.savedAt || 0) || 0),
    revision: stateRevision(value)
  };
}

async function finalizeState(incoming, previous, now = Date.now()) {
  const previousRevision = stateRevision(previous);
  if (previousRevision >= Number.MAX_SAFE_INTEGER) {
    const error = new Error('State revision limit reached; the Version X state store must be repaired.');
    error.statusCode = 409;
    throw error;
  }
  const previousSafe = await sanitizeStoredState(previous, now);
  const source = isRecord(incoming) ? safeClone(incoming) : {};
  const merged = {
    ...(previousSafe || {}),
    ...source,
    version: X_STATE_VERSION,
    config: {
      ...(previousSafe?.config || {}),
      ...(isRecord(source.config) ? source.config : {})
    },
    events: mergeById(120, false, previousSafe?.events, source.events),
    activityLog: mergeById(180, true, previousSafe?.activityLog, source.activityLog)
  };
  const safe = await sanitizeXState(merged, now);
  return {
    ...safe,
    version: X_STATE_VERSION,
    savedAt: now,
    revision: previousRevision + 1
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    let raw;
    try { raw = JSON.stringify(req.body); }
    catch {
      const error = new Error('Invalid JSON body.');
      error.statusCode = 400;
      throw error;
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) {
      const error = new Error('Request exceeds the 1.1 MB limit.');
      error.statusCode = 413;
      throw error;
    }
    return req.body;
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_REQUEST_BYTES) {
      const error = new Error('Request exceeds the 1.1 MB limit.');
      error.statusCode = 413;
      throw error;
    }
    try { return JSON.parse(req.body || '{}'); }
    catch {
      const error = new Error('Invalid JSON body.');
      error.statusCode = 400;
      throw error;
    }
  }
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      received += buffer.byteLength;
      if (received > MAX_REQUEST_BYTES) {
        const error = new Error('Request exceeds the 1.1 MB limit.');
        error.statusCode = 413;
        return fail(error);
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks, received).toString('utf8')) : {}); }
      catch {
        const error = new Error('Invalid JSON body.');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', fail);
  });
}

function kvReady(env = process.env) {
  return Boolean(env?.KV_REST_API_URL && env?.KV_REST_API_TOKEN);
}

async function kv(command, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout
} = {}) {
  if (
    !kvReady(env)
    || typeof fetchImpl !== 'function'
    || typeof AbortControllerImpl !== 'function'
  ) {
    throw new Error('Version X state storage is unavailable.');
  }
  const controller = new AbortControllerImpl();
  const timer = setTimeoutImpl(() => controller.abort(), KV_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(env.KV_REST_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error('Version X state storage is unavailable.');
    return data.result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Version X state storage timed out.');
    throw new Error('Version X state storage is unavailable.');
  } finally {
    clearTimeoutImpl(timer);
  }
}

function memoryStates() {
  globalThis.__POOL_SIDE_X_MEMORY_STATES__ ||= Object.create(null);
  return globalThis.__POOL_SIDE_X_MEMORY_STATES__;
}

function memoryLocks() {
  globalThis.__POOL_SIDE_X_MEMORY_STATE_LOCKS__ ||= new Map();
  return globalThis.__POOL_SIDE_X_MEMORY_STATE_LOCKS__;
}

async function withMemoryLock(operation) {
  const locks = memoryLocks();
  const previous = locks.get(X_STATE_KEY) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  locks.set(X_STATE_KEY, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(X_STATE_KEY) === tail) locks.delete(X_STATE_KEY);
  }
}

/**
 * Returns the server's canonical Version X state. Schedule synchronization
 * uses this instead of trusting a potentially stale browser projection.
 */
export async function readCanonicalVersionXState({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  requireDurable = true
} = {}) {
  const durable = kvReady(env);
  if (requireDurable && !durable) {
    throw new Error('Durable Version X state storage is unavailable.');
  }
  const stored = durable
    ? parseState(await kv(['GET', X_STATE_KEY], { env, fetchImpl }))
    : memoryStates()[X_STATE_KEY] || null;
  const state = await sanitizeStoredState(stored, Number(now()));
  return Object.freeze({
    durable,
    revision: stateRevision(state),
    state
  });
}

/**
 * Releases only the exact Browser Receiver session named by the caller and
 * hands canonical receiver ownership to Pushcut mode. The durable path uses
 * the same compare-and-set revision gate as ordinary state saves. If another
 * writer replaces the receiver between GET and CAS, the replacement is read
 * and matched again before any retry, so a stale session cannot release a
 * newer receiver.
 */
export async function releaseVersionXReceiverSession({
  receiverId,
  sessionId,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  requireDurable = true,
  maxAttempts = 8
} = {}) {
  const expectedReceiverId = boundedString(receiverId, 160);
  const expectedSessionId = boundedString(sessionId, 160);
  if (!expectedReceiverId || !expectedSessionId) {
    const error = new Error('receiverId and sessionId are required.');
    error.statusCode = 400;
    throw error;
  }

  const durable = kvReady(env);
  if (requireDurable && !durable) {
    const error = new Error('Durable Version X state storage is unavailable.');
    error.statusCode = 503;
    throw error;
  }
  const releaseAt = Math.max(0, Math.floor(Number(now()) || Date.now()));

  const prepare = async stored => {
    const current = await sanitizeStoredState(stored, releaseAt);
    const receiver = current?.receiver;
    if (!receiver
      || receiver.id !== expectedReceiverId
      || receiver.sessionId !== expectedSessionId) {
      return {
        matched: false,
        released: false,
        changed: false,
        reason: 'session-mismatch',
        durable,
        revision: stateRevision(current),
        state: current
      };
    }

    const alreadyReleased = receiver.status === 'offline'
      && Number(receiver.leaseUntil || 0) <= releaseAt
      && current.config?.receiverMode === 'pushcut';
    if (alreadyReleased) {
      return {
        matched: true,
        released: true,
        changed: false,
        reason: 'already-released',
        durable,
        revision: stateRevision(current),
        state: current
      };
    }

    const next = await finalizeState({
      ...current,
      config: {
        ...(current?.config || {}),
        receiverMode: 'pushcut'
      },
      receiver: {
        ...receiver,
        status: 'offline',
        lastSeen: releaseAt,
        leaseUntil: releaseAt,
        detail: 'Browser Receiver released for Pushcut handoff.'
      }
    }, stored, releaseAt);
    const raw = JSON.stringify(next);
    if (Buffer.byteLength(raw, 'utf8') > MAX_STATE_BYTES) {
      const error = new Error('Saved Version X state exceeds the 1 MB state limit.');
      error.statusCode = 400;
      throw error;
    }
    return {
      matched: true,
      released: true,
      changed: true,
      reason: 'released',
      durable,
      revision: next.revision,
      state: next,
      raw,
      expectedRevision: stateRevision(stored)
    };
  };

  if (!durable) {
    return await withMemoryLock(async () => {
      const result = await prepare(memoryStates()[X_STATE_KEY] || null);
      if (result.changed) memoryStates()[X_STATE_KEY] = result.state;
      const { raw, expectedRevision, ...publicResult } = result;
      return publicResult;
    });
  }

  let stored = parseState(await kv(['GET', X_STATE_KEY], { env, fetchImpl }));
  const attempts = Math.max(1, Math.min(20, Math.floor(Number(maxAttempts) || 8)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await prepare(stored);
    if (!result.changed) return result;
    const cas = await kv([
      'EVAL',
      X_COMPARE_AND_SET_SCRIPT,
      '1',
      X_STATE_KEY,
      String(result.expectedRevision),
      result.raw
    ], { env, fetchImpl });
    if (!Array.isArray(cas) || cas.length < 2) {
      throw new Error('Version X state storage is unavailable.');
    }
    if (Number(cas[0]) === 1) {
      const { raw, expectedRevision, ...publicResult } = result;
      return publicResult;
    }
    stored = parseState(cas[2]);
  }

  const error = new Error('Version X state changed too often to release this receiver safely.');
  error.statusCode = 409;
  throw error;
}

function versionXRequired(req, res) {
  if (sessionVariant(req) === 'x') return true;
  json(res, 400, {
    ok: false,
    error: 'Version X requests must use ?v=x.',
    serverTime: Date.now()
  });
  return false;
}

export default async function handler(req, res) {
  try {
    if (!versionXRequired(req, res)) return;

    if (req.method === 'GET') {
      if (!requireSession(req, res)) return;
      const hasKv = kvReady();
      const stored = hasKv
        ? parseState(await kv(['GET', X_STATE_KEY]))
        : memoryStates()[X_STATE_KEY] || null;
      const state = await sanitizeStoredState(stored);
      return json(res, 200, {
        ok: true,
        cloudSync: hasKv,
        syncMode: hasKv ? 'kv' : 'memory',
        serverTime: Date.now(),
        state,
        note: hasKv
          ? 'Version X KV cloud sync active.'
          : 'Temporary Version X server memory is active on this instance only. Add Vercel KV/Upstash for durable cloud sync.'
      });
    }

    if (req.method === 'POST') {
      if (!requireSession(req, res)) return;
      const body = await readBody(req);
      if (body?.version != null && String(body.version).trim().toLowerCase() !== X_STATE_VERSION) {
        return json(res, 400, { ok: false, error: 'Version X state requires version "x".', serverTime: Date.now() });
      }
      const state = body?.state;
      if (!isRecord(state)) {
        return json(res, 400, { ok: false, error: 'state object required.', serverTime: Date.now() });
      }
      if (state.version != null && String(state.version).trim().toLowerCase() !== X_STATE_VERSION) {
        return json(res, 400, { ok: false, error: 'Version X state requires version "x".', serverTime: Date.now() });
      }
      const expectedRevision = body.expectedRevision;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return json(res, 400, {
          ok: false,
          error: 'expectedRevision must be a non-negative integer.',
          serverTime: Date.now()
        });
      }

      const hasKv = kvReady();
      const writeState = async () => {
        const previous = hasKv
          ? parseState(await kv(['GET', X_STATE_KEY]))
          : memoryStates()[X_STATE_KEY] || null;
        const previousRevision = stateRevision(previous);
        if (expectedRevision !== previousRevision) {
          return {
            conflict: true,
            currentRevision: previousRevision,
            currentState: await sanitizeStoredState(previous)
          };
        }

        const safe = await finalizeState(state, previous);
        const raw = JSON.stringify(safe);
        if (Buffer.byteLength(raw, 'utf8') > MAX_STATE_BYTES) return { tooLarge: true };

        if (hasKv) {
          const cas = await kv([
            'EVAL',
            X_COMPARE_AND_SET_SCRIPT,
            '1',
            X_STATE_KEY,
            String(expectedRevision),
            raw
          ]);
          if (!Array.isArray(cas) || cas.length < 2) throw new Error('Version X state storage is unavailable.');
          if (Number(cas[0]) !== 1) {
            const currentRevision = Number.isSafeInteger(Number(cas[1])) && Number(cas[1]) >= 0
              ? Number(cas[1])
              : 0;
            return {
              conflict: true,
              currentRevision,
              currentState: await sanitizeStoredState(parseState(cas[2]))
            };
          }
        } else {
          memoryStates()[X_STATE_KEY] = safe;
        }
        return { safe };
      };

      const result = hasKv ? await writeState() : await withMemoryLock(writeState);
      if (result.conflict) {
        return json(res, 409, {
          ok: false,
          cloudSync: hasKv,
          syncMode: hasKv ? 'kv' : 'memory',
          error: 'State revision conflict. Refresh and retry.',
          state: result.currentState,
          revision: result.currentRevision,
          currentRevision: result.currentRevision,
          serverTime: Date.now()
        });
      }
      if (result.tooLarge) {
        return json(res, 400, {
          ok: false,
          error: 'Saved Version X schedules exceed the 1 MB state limit.',
          serverTime: Date.now()
        });
      }
      return json(res, 200, {
        ok: true,
        cloudSync: hasKv,
        syncMode: hasKv ? 'kv' : 'memory',
        serverTime: Date.now(),
        state: result.safe,
        note: hasKv
          ? 'Version X KV cloud sync active.'
          : 'Temporary Version X server memory is active on this instance only. Add Vercel KV/Upstash for durable cloud sync.'
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'GET or POST required.', serverTime: Date.now() });
  } catch (error) {
    const status = [400, 409, 413].includes(Number(error?.statusCode)) ? Number(error.statusCode) : 500;
    const message = status < 500 ? String(error.message || 'Invalid Version X state request.') : 'Version X state sync failed.';
    return json(res, status, { ok: false, cloudSync: false, error: message, serverTime: Date.now() });
  }
}

function parseState(raw) {
  if (!raw) return null;
  if (isRecord(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
