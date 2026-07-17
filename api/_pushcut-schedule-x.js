import {
  createHash,
  randomUUID
} from 'node:crypto';

import {
  announcementDeliveryForSource,
  getActiveSchedule,
  inlineAnnouncementText,
  normalizeState,
  safetyAnnouncementText
} from '../src/vx/core.js';
import {
  createPushcutXReceipt,
  updatePushcutXReceipt
} from './_pushcut-receipts-x.js';
import {
  normalizeFiniteAudioReference
} from './_finite-audio-x.js';
import {
  createSignedPushcutXUrl
} from './_pushcut-security-x.js';

export const PUSHCUT_X_SCHEDULE_TIME_ZONE = 'America/Chicago';
// Pushcut delayed requests allow at most 30 days. Keep one day of headroom for
// clock drift and renew this rolling plan whenever Command opens or saves.
export const PUSHCUT_X_SCHEDULE_HORIZON_DAYS = 29;
export const PUSHCUT_X_SCHEDULE_MIN_DELAY_SECONDS = 5;
export const PUSHCUT_X_SCHEDULE_MAX_DELAY_SECONDS = 30 * 24 * 60 * 60;
export const PUSHCUT_X_CANCEL_URL = 'https://api.pushcut.io/v1/cancelExecution';
export const PUSHCUT_X_SCHEDULE_MANIFEST_KEY = 'serenity-shores-poolside-pulse:vx:pushcut-schedule:v1:manifest';
const PUSHCUT_X_SCHEDULE_LOCK_KEY = 'serenity-shores-poolside-pulse:vx:pushcut-schedule:v1:lock';
const PUSHCUT_X_EXECUTE_URL = 'https://api.pushcut.io/v1/execute';
const PUSHCUT_X_DEFAULT_SHORTCUT = 'Poolside Pulse Announcement';
const PUSHCUT_X_DEFAULT_RECOVERY_SHORTCUT = 'Volume Down';
const PUSHCUT_X_SCHEDULE_SCHEMA_VERSION = 1;
// Keep the distributed lock beyond the route's 300-second execution ceiling.
// Large rolling plans make sequential Pushcut and KV calls, so a shorter lock
// could expire while the original sync is still mutating the manifest.
const MANIFEST_LOCK_SECONDS = 360;
const KV_TIMEOUT_MS = 8_000;
const PROVIDER_TIMEOUT_MS = 12_000;
const MAX_PLAN_OCCURRENCES = 1_000;
const NATURAL_RECOVERY_SECONDS = 65;
// Pushcut recommends keeping Automation Server shortcuts under 60 seconds.
// This matches the live-command ceiling and leaves time for download, volume
// changes, playback, restoration, and the signed receipt callback.
const NATURAL_ANNOUNCEMENT_MAX_CHARACTERS = 500;

const SAFE_ERRORS = Object.freeze({
  invalid: Object.freeze({
    statusCode: 400,
    message: 'The Version X Pushcut schedule is invalid.'
  }),
  notConfigured: Object.freeze({
    statusCode: 503,
    message: 'Version X Pushcut scheduling is not configured.'
  }),
  durableUnavailable: Object.freeze({
    statusCode: 503,
    message: 'Durable Version X schedule storage is unavailable.'
  }),
  locked: Object.freeze({
    statusCode: 409,
    message: 'Another Version X schedule sync is already running.'
  }),
  providerRejected: Object.freeze({
    statusCode: 409,
    message: 'Pushcut rejected delayed scheduling. Confirm Automation Server Extended is active, then retry.'
  }),
  providerUnavailable: Object.freeze({
    statusCode: 502,
    message: 'Pushcut scheduling is temporarily unavailable.'
  }),
  cancellationUncertain: Object.freeze({
    statusCode: 502,
    message: 'A pending Pushcut occurrence could not be safely cancelled. Retry schedule sync.'
  })
});

export class PushcutScheduleXError extends Error {
  constructor(code, { requiresExtended = false } = {}) {
    const safe = SAFE_ERRORS[code] || SAFE_ERRORS.providerUnavailable;
    super(safe.message);
    this.name = 'PushcutScheduleXError';
    this.code = Object.hasOwn(SAFE_ERRORS, code) ? code : 'providerUnavailable';
    this.statusCode = safe.statusCode;
    this.requiresExtended = requiresExtended === true;
  }
}

function fail(code, options) {
  throw new PushcutScheduleXError(code, options);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value, maximum) {
  return String(value || '').trim().slice(0, maximum);
}

function sha(value, length = 32) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function configuration(env) {
  const apiKey = bounded(env?.PUSHCUT_API_KEY_X, 1_024);
  const sharedShortcut = bounded(env?.PUSHCUT_SHORTCUT_X, 160) || PUSHCUT_X_DEFAULT_SHORTCUT;
  return Object.freeze({
    apiKey,
    shortcut: bounded(env?.PUSHCUT_ANNOUNCE_SHORTCUT_X, 160) || sharedShortcut,
    recoveryShortcut: bounded(env?.PUSHCUT_RECOVERY_SHORTCUT_X, 160)
      || PUSHCUT_X_DEFAULT_RECOVERY_SHORTCUT
  });
}

function kvReady(env) {
  return Boolean(
    bounded(env?.KV_REST_API_URL, 2_048)
    && bounded(env?.KV_REST_API_TOKEN, 4_096)
  );
}

async function kv(command, {
  env,
  fetchImpl,
  timeoutMs = KV_TIMEOUT_MS
}) {
  if (!kvReady(env) || typeof fetchImpl !== 'function') fail('durableUnavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(env.KV_REST_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) fail('durableUnavailable');
    return data.result;
  } catch (error) {
    if (error instanceof PushcutScheduleXError) throw error;
    fail('durableUnavailable');
  } finally {
    clearTimeout(timer);
  }
}

function parseManifest(raw) {
  if (!raw) return null;
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || !isRecord(value.occurrences)) return null;
  const occurrences = {};
  for (const [logicalId, occurrence] of Object.entries(value.occurrences).slice(0, MAX_PLAN_OCCURRENCES * 2)) {
    if (!/^[a-f0-9]{32}$/.test(logicalId) || !isRecord(occurrence)) continue;
    const identifier = bounded(occurrence.identifier, 100);
    const recoveryIdentifier = bounded(occurrence.recoveryIdentifier, 100);
    const eventId = bounded(occurrence.eventId, 160);
    const scheduledFor = Number(occurrence.scheduledFor || 0);
    if (!identifier || !recoveryIdentifier || !eventId || !Number.isSafeInteger(scheduledFor)) continue;
    occurrences[logicalId] = {
      logicalId,
      identifier,
      recoveryIdentifier,
      eventId,
      scheduledFor,
      recoveryFor: Number(occurrence.recoveryFor || 0),
      fingerprint: bounded(occurrence.fingerprint, 64),
      scheduleId: bounded(occurrence.scheduleId, 120),
      itemId: bounded(occurrence.itemId, 120),
      status: bounded(occurrence.status, 40),
      updatedAt: Number(occurrence.updatedAt || 0)
    };
  }
  return {
    version: PUSHCUT_X_SCHEDULE_SCHEMA_VERSION,
    syncedAt: Number(value.syncedAt || 0),
    horizonEnd: Number(value.horizonEnd || 0),
    stateRevision: Number(value.stateRevision || 0),
    warnings: Array.isArray(value.warnings)
      ? value.warnings.map(item => bounded(item, 500)).filter(Boolean).slice(0, 100)
      : [],
    occurrences
  };
}

export function createPushcutScheduleManifestStore({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  return Object.freeze({
    durable: kvReady(env),
    async read() {
      if (!kvReady(env)) fail('durableUnavailable');
      return parseManifest(await kv(['GET', PUSHCUT_X_SCHEDULE_MANIFEST_KEY], {
        env,
        fetchImpl
      })) || {
        version: PUSHCUT_X_SCHEDULE_SCHEMA_VERSION,
        syncedAt: 0,
        horizonEnd: 0,
        stateRevision: 0,
        warnings: [],
        occurrences: {}
      };
    },
    async write(manifest) {
      if (!kvReady(env)) fail('durableUnavailable');
      const safe = parseManifest(manifest);
      if (!safe) fail('invalid');
      const stored = await kv([
        'SET',
        PUSHCUT_X_SCHEDULE_MANIFEST_KEY,
        JSON.stringify(safe)
      ], { env, fetchImpl });
      if (String(stored || '').toUpperCase() !== 'OK') fail('durableUnavailable');
      return safe;
    },
    async withLock(operation) {
      if (!kvReady(env)) fail('durableUnavailable');
      const token = randomUUID();
      const claimed = await kv([
        'SET',
        PUSHCUT_X_SCHEDULE_LOCK_KEY,
        token,
        'NX',
        'EX',
        String(MANIFEST_LOCK_SECONDS)
      ], { env, fetchImpl });
      if (String(claimed || '').toUpperCase() !== 'OK') fail('locked');
      try {
        return await operation();
      } finally {
        await kv([
          'EVAL',
          'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end',
          '1',
          PUSHCUT_X_SCHEDULE_LOCK_KEY,
          token
        ], { env, fetchImpl }).catch(() => {});
      }
    },
    now
  });
}

function partsAt(timestamp, timeZone = PUSHCUT_X_SCHEDULE_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function offsetAt(timestamp, timeZone) {
  const parts = partsAt(timestamp, timeZone);
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  ) - Math.floor(timestamp / 1000) * 1000;
}

function sameLocal(parts, desired) {
  return parts.year === desired.year
    && parts.month === desired.month
    && parts.day === desired.day
    && parts.hour === desired.hour
    && parts.minute === desired.minute;
}

/**
 * Converts a wall-clock occurrence to the earliest real instant in the
 * requested IANA timezone. Nonexistent spring-forward wall times return 0.
 */
export function zonedOccurrenceTimestamp({
  year,
  month,
  day,
  hour,
  minute
}, timeZone = PUSHCUT_X_SCHEDULE_TIME_ZONE) {
  const desired = { year, month, day, hour, minute };
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsets = new Set([
    offsetAt(naive - 18 * 60 * 60 * 1000, timeZone),
    offsetAt(naive, timeZone),
    offsetAt(naive + 18 * 60 * 60 * 1000, timeZone)
  ]);
  const matches = [...offsets]
    .map(offset => naive - offset)
    .filter(timestamp => sameLocal(partsAt(timestamp, timeZone), desired))
    .sort((left, right) => left - right);
  return matches[0] || 0;
}

function localDates(now, horizonDays, timeZone) {
  const local = partsAt(now, timeZone);
  const base = Date.UTC(local.year, local.month - 1, local.day);
  const dates = [];
  for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset += 1) {
    const date = new Date(base + dayOffset * 24 * 60 * 60 * 1000);
    dates.push({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      weekday: date.getUTCDay(),
      key: [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        String(date.getUTCDate()).padStart(2, '0')
      ].join('-')
    });
  }
  return dates;
}

function announcementForItem(item, state) {
  const announcementId = bounded(item?.action?.announcementId || item?.announcementId, 120);
  const saved = (state.announcements || []).find(entry => entry.id === announcementId);
  const inline = inlineAnnouncementText(item);
  const rawText = inline || bounded(saved?.text, 900);
  if (!rawText) return { warning: `${item.label}: no announcement text.` };
  const text = inline
    ? rawText
    : safetyAnnouncementText(announcementId, rawText, state.config);
  const sourceId = bounded(item?.action?.sourceId || saved?.sourceId || 'natural-voice', 120);
  const source = (state.announcementSources || []).find(entry => entry.id === sourceId);
  if (!source) return { warning: `${item.label}: announcement source is missing.` };
  let delivery;
  try {
    delivery = announcementDeliveryForSource(source);
  } catch {
    return { warning: `${item.label}: only Natural Voice or a finite Suno/direct clip can be scheduled through Pushcut.` };
  }
  if (
    delivery.announcementMode !== 'finite-audio'
    && text.length > NATURAL_ANNOUNCEMENT_MAX_CHARACTERS
  ) {
    return {
      warning: `${item.label}: Natural Voice text must be ${NATURAL_ANNOUNCEMENT_MAX_CHARACTERS} characters or fewer for reliable Pushcut playback.`
    };
  }
  if (delivery.announcementMode === 'finite-audio') {
    try {
      const reference = normalizeFiniteAudioReference(
        delivery.announcementProvider,
        delivery.announcementAudioUrl
      );
      delivery = {
        ...delivery,
        announcementProvider: reference.provider,
        announcementAudioUrl: reference.sourceUrl
      };
    } catch {
      return { warning: `${item.label}: the finite announcement must be one HTTPS audio file or an exact Suno song/share URL.` };
    }
  }
  return {
    text,
    label: bounded(item.label, 80) || 'Scheduled announcement',
    source,
    delivery
  };
}

function logicalOccurrenceId(scheduleId, itemId, dateKey, time) {
  return sha(`vx\0${scheduleId}\0${itemId}\0${dateKey}\0${time}`, 32);
}

function occurrenceIdentifiers(logicalId) {
  return {
    identifier: `ppx-a-${logicalId}`,
    recoveryIdentifier: `ppx-r-${logicalId}`
  };
}

function eventIdFor(logicalId, fingerprint) {
  return `pushcut-sched-${logicalId.slice(0, 16)}-${fingerprint.slice(0, 24)}`;
}

export function planPushcutXSchedule(stateInput, {
  now = Date.now(),
  horizonDays = PUSHCUT_X_SCHEDULE_HORIZON_DAYS,
  timeZone = PUSHCUT_X_SCHEDULE_TIME_ZONE
} = {}) {
  if (
    !isRecord(stateInput)
    || !Array.isArray(stateInput.schedules)
    || !bounded(stateInput.activeScheduleId, 120)
  ) fail('invalid');
  const safeNow = Number(now);
  if (!Number.isSafeInteger(safeNow) || safeNow < 0) fail('invalid');
  const boundedHorizonDays = Math.max(7, Math.min(29, Math.floor(Number(horizonDays) || PUSHCUT_X_SCHEDULE_HORIZON_DAYS)));
  let effectiveHorizonDays = boundedHorizonDays;
  let horizonEnd = safeNow + effectiveHorizonDays * 24 * 60 * 60 * 1000;
  const state = normalizeState(stateInput, safeNow);
  const active = getActiveSchedule(state);
  const warnings = [];
  if (!active || active.enabled === false || active.mode !== 'time') {
    return Object.freeze({
      timeZone,
      horizonEnd,
      stateRevision: Number(state.revision || 0),
      occurrences: Object.freeze([]),
      warnings: Object.freeze(warnings)
    });
  }
  const enabledAnnouncementCount = (active.items || [])
    .filter(item => item.enabled !== false && item.action?.kind === 'announcement')
    .length;
  if (enabledAnnouncementCount > 0) {
    const capacityHorizonDays = Math.max(
      7,
      Math.floor(MAX_PLAN_OCCURRENCES / enabledAnnouncementCount) - 1
    );
    effectiveHorizonDays = Math.min(effectiveHorizonDays, capacityHorizonDays);
    horizonEnd = safeNow + effectiveHorizonDays * 24 * 60 * 60 * 1000;
    if (effectiveHorizonDays < boundedHorizonDays) {
      warnings.push(`The rolling schedule window was limited to ${effectiveHorizonDays} days because this schedule contains ${enabledAnnouncementCount} active announcements.`);
    }
  }
  const dates = localDates(safeNow, effectiveHorizonDays, timeZone);
  const occurrences = [];
  for (const item of active.items || []) {
    if (item.enabled === false || item.action?.kind !== 'announcement') continue;
    const announcement = announcementForItem(item, state);
    if (announcement.warning) {
      warnings.push(announcement.warning);
      continue;
    }
    const time = bounded(item.position?.time || item.time, 5);
    const match = /^(\d{2}):(\d{2})$/.exec(time);
    if (!match) {
      warnings.push(`${item.label}: invalid time.`);
      continue;
    }
    const days = new Set(Array.isArray(item.days) ? item.days : [0, 1, 2, 3, 4, 5, 6]);
    for (const date of dates) {
      if (!days.has(date.weekday)) continue;
      const scheduledFor = zonedOccurrenceTimestamp({
        ...date,
        hour: Number(match[1]),
        minute: Number(match[2])
      }, timeZone);
      if (!scheduledFor) {
        warnings.push(`${item.label}: ${date.key} ${time} does not exist in ${timeZone} because of a clock change.`);
        continue;
      }
      const delaySeconds = Math.ceil((scheduledFor - safeNow) / 1000);
      if (
        delaySeconds < PUSHCUT_X_SCHEDULE_MIN_DELAY_SECONDS
        || delaySeconds > PUSHCUT_X_SCHEDULE_MAX_DELAY_SECONDS
        || scheduledFor > horizonEnd
      ) continue;
      const logicalId = logicalOccurrenceId(active.id, item.id, date.key, time);
      const fingerprint = sha(JSON.stringify({
        logicalId,
        scheduledFor,
        text: announcement.text,
        label: announcement.label,
        delivery: announcement.delivery,
        voice: announcement.source.voice || '',
        instructions: announcement.source.instructions || ''
      }), 48);
      const ids = occurrenceIdentifiers(logicalId);
      const finiteSeconds = Number(announcement.delivery.announcementDurationSeconds || 0);
      const recoverySeconds = announcement.delivery.announcementMode === 'finite-audio'
        ? Math.max(12, Math.min(60, finiteSeconds + 8))
        : NATURAL_RECOVERY_SECONDS;
      occurrences.push(Object.freeze({
        logicalId,
        ...ids,
        eventId: eventIdFor(logicalId, fingerprint),
        fingerprint,
        scheduleId: active.id,
        itemId: item.id,
        scheduledFor,
        recoveryFor: scheduledFor + recoverySeconds * 1000,
        delaySeconds,
        recoveryDelaySeconds: delaySeconds + recoverySeconds,
        text: announcement.text,
        label: announcement.label,
        voice: bounded(announcement.source.voice, 40) || 'marin',
        instructions: bounded(announcement.source.instructions, 700),
        ...announcement.delivery
      }));
      if (occurrences.length > MAX_PLAN_OCCURRENCES) fail('invalid');
    }
  }
  occurrences.sort((left, right) => left.scheduledFor - right.scheduledFor || left.logicalId.localeCompare(right.logicalId));
  return Object.freeze({
    timeZone,
    horizonEnd,
    stateRevision: Number(state.revision || 0),
    occurrences: Object.freeze(occurrences),
    warnings: Object.freeze([...new Set(warnings)].slice(0, 100))
  });
}

async function providerRequest(url, {
  apiKey,
  body,
  fetchImpl,
  timeoutMs = PROVIDER_TIMEOUT_MS
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'API-Key': apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8'
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    fail('providerUnavailable');
  } finally {
    clearTimeout(timer);
  }
}

export async function schedulePushcutXExecution({
  identifier,
  delaySeconds,
  shortcut,
  input
}, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  executeUrl = PUSHCUT_X_EXECUTE_URL
} = {}) {
  const configured = configuration(env);
  if (!configured.apiKey || !shortcut || typeof fetchImpl !== 'function') fail('notConfigured');
  const seconds = Math.ceil(Number(delaySeconds));
  if (
    !/^[A-Za-z0-9._:-]{1,100}$/.test(String(identifier || ''))
    || !Number.isInteger(seconds)
    || seconds < PUSHCUT_X_SCHEDULE_MIN_DELAY_SECONDS
    || seconds > PUSHCUT_X_SCHEDULE_MAX_DELAY_SECONDS
  ) fail('invalid');
  const endpoint = new URL(executeUrl);
  endpoint.search = '';
  endpoint.searchParams.set('shortcut', shortcut);
  endpoint.searchParams.set('timeout', 'nowait');
  endpoint.searchParams.set('delay', `${seconds}s`);
  endpoint.searchParams.set('identifier', identifier);
  const response = await providerRequest(endpoint, {
    apiKey: configured.apiKey,
    fetchImpl,
    body: {
      input
    }
  });
  if (!(response.status >= 200 && response.status < 300)) {
    fail('providerRejected', { requiresExtended: true });
  }
  return Object.freeze({ accepted: true, status: response.status });
}

export async function cancelPushcutXExecution(identifier, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  cancelUrl = PUSHCUT_X_CANCEL_URL
} = {}) {
  const configured = configuration(env);
  if (!configured.apiKey || typeof fetchImpl !== 'function') fail('notConfigured');
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(String(identifier || ''))) fail('invalid');
  const endpoint = new URL(cancelUrl);
  endpoint.search = '';
  endpoint.searchParams.set('identifier', identifier);
  const response = await providerRequest(endpoint, {
    apiKey: configured.apiKey,
    fetchImpl
  });
  if (
    !(response.status >= 200 && response.status < 300)
    && response.status !== 404
  ) fail('cancellationUncertain');
  return Object.freeze({ cancelled: true, status: response.status });
}

function manifestEntry(occurrence, status, now) {
  return {
    logicalId: occurrence.logicalId,
    identifier: occurrence.identifier,
    recoveryIdentifier: occurrence.recoveryIdentifier,
    eventId: occurrence.eventId,
    scheduledFor: occurrence.scheduledFor,
    recoveryFor: occurrence.recoveryFor,
    fingerprint: occurrence.fingerprint,
    scheduleId: occurrence.scheduleId,
    itemId: occurrence.itemId,
    status,
    updatedAt: now
  };
}

function publicManifest(manifest, warnings = manifest?.warnings || []) {
  const occurrences = Object.values(manifest?.occurrences || {});
  return Object.freeze({
    version: 'x',
    durable: true,
    syncedAt: Number(manifest?.syncedAt || 0),
    horizonEnd: Number(manifest?.horizonEnd || 0),
    stateRevision: Number(manifest?.stateRevision || 0),
    occurrenceCount: occurrences.length,
    scheduledCount: occurrences.filter(item => item.status === 'scheduled').length,
    nextScheduledFor: occurrences
      .filter(item => item.status === 'scheduled')
      .map(item => Number(item.scheduledFor || 0))
      .filter(Boolean)
      .sort((left, right) => left - right)[0] || 0,
    warnings: warnings.slice(0, 100)
  });
}

export async function readPushcutXScheduleStatus({
  manifestStore = createPushcutScheduleManifestStore()
} = {}) {
  if (!manifestStore?.durable) fail('durableUnavailable');
  return publicManifest(await manifestStore.read());
}

export async function synchronizePushcutXSchedule({
  state,
  request,
  pushcutEnabled = true
}, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  horizonDays = PUSHCUT_X_SCHEDULE_HORIZON_DAYS,
  manifestStore = createPushcutScheduleManifestStore({ env, fetchImpl, now }),
  scheduleExecution = (payload) => schedulePushcutXExecution(payload, { env, fetchImpl }),
  cancelExecution = (identifier) => cancelPushcutXExecution(identifier, { env, fetchImpl }),
  createReceipt = (command, options) => createPushcutXReceipt(command, options),
  updateReceipt = (eventId, patch, options) => updatePushcutXReceipt(eventId, patch, options)
} = {}) {
  const configured = configuration(env);
  if (!configured.apiKey || !configured.shortcut || !configured.recoveryShortcut) fail('notConfigured');
  if (!manifestStore?.durable || typeof manifestStore.withLock !== 'function') fail('durableUnavailable');
  return await manifestStore.withLock(async () => {
    const syncNow = Number(now());
    const requestedPlan = planPushcutXSchedule(state, {
      now: syncNow,
      horizonDays
    });
    const plan = pushcutEnabled === false
      ? Object.freeze({
          ...requestedPlan,
          occurrences: Object.freeze([]),
          warnings: Object.freeze([
            ...requestedPlan.warnings,
            'Pushcut timed announcements are paused while Browser Receiver mode owns the speaker.'
          ])
        })
      : requestedPlan;
    if (
      plan.occurrences.some(item => item.announcementMode === 'natural-voice')
      && !bounded(env?.OPENAI_API_KEY, 4_096)
    ) fail('notConfigured');
    const previous = await manifestStore.read();
    const desired = new Map(plan.occurrences.map(item => [item.logicalId, item]));
    const proposedOccurrences = {};
    for (const occurrence of plan.occurrences) {
      proposedOccurrences[occurrence.logicalId] = manifestEntry(occurrence, 'pending', syncNow);
    }
    for (const [logicalId, existing] of Object.entries(previous.occurrences || {})) {
      if (!desired.has(logicalId)) {
        proposedOccurrences[logicalId] = {
          ...existing,
          status: 'cancel-pending',
          updatedAt: syncNow
        };
      }
    }
    let manifest = {
      version: PUSHCUT_X_SCHEDULE_SCHEMA_VERSION,
      syncedAt: syncNow,
      horizonEnd: plan.horizonEnd,
      stateRevision: plan.stateRevision,
      warnings: plan.warnings,
      occurrences: proposedOccurrences
    };
    // Write-ahead intent means a crash cannot create an untracked Pushcut
    // identifier: the next sync can replace or cancel every attempted action.
    await manifestStore.write(manifest);

    let cancelled = 0;
    for (const [logicalId, existing] of Object.entries(previous.occurrences || {})) {
      if (desired.has(logicalId)) continue;
      await cancelExecution(existing.identifier);
      await cancelExecution(existing.recoveryIdentifier);
      await updateReceipt(existing.eventId, {
        status: 'failed',
        providerStatus: 'schedule_cancelled',
        failedAt: syncNow,
        failureCode: 'schedule_cancelled'
      }, {
        env,
        fetchImpl,
        requireDurable: true,
        now: () => syncNow
      }).catch(() => {});
      delete manifest.occurrences[logicalId];
      cancelled += 1;
      await manifestStore.write(manifest);
    }

    let scheduled = 0;
    let unchanged = 0;
    for (const occurrence of plan.occurrences) {
      const existing = previous.occurrences?.[occurrence.logicalId];
      if (
        existing?.status === 'scheduled'
        && existing.fingerprint === occurrence.fingerprint
        && existing.eventId === occurrence.eventId
      ) {
        manifest.occurrences[occurrence.logicalId] = manifestEntry(occurrence, 'scheduled', syncNow);
        unchanged += 1;
        continue;
      }

      const command = Object.freeze({
        schemaVersion: 1,
        version: 'x',
        action: 'announce',
        commandId: occurrence.eventId,
        eventId: occurrence.eventId,
        issuedAt: syncNow,
        scheduledFor: occurrence.scheduledFor,
        source: 'schedule',
        announcementMode: occurrence.announcementMode,
        announcementProvider: occurrence.announcementProvider,
        announcementAudioUrl: occurrence.announcementAudioUrl,
        announcementDurationSeconds: occurrence.announcementDurationSeconds,
        text: occurrence.text,
        label: occurrence.label,
        voice: occurrence.voice,
        instructions: occurrence.instructions,
        safety: false,
        voicePercent: 100,
        musicPercent: 30,
        resumeMusic: true
      });
      await createReceipt(command, {
        env,
        fetchImpl,
        requireDurable: true,
        now: () => syncNow
      });
      const audioCapability = createSignedPushcutXUrl(
        request,
        '/api/pushcut-audio-x',
        occurrence.eventId,
        'audio',
        {
          env,
          now: () => syncNow,
          notBeforeMs: occurrence.scheduledFor,
          ttlSeconds: 30 * 60
        }
      );
      const receiptCapability = createSignedPushcutXUrl(
        request,
        '/api/pushcut-receipt-x',
        occurrence.eventId,
        'receipt',
        {
          env,
          now: () => syncNow,
          notBeforeMs: occurrence.scheduledFor,
          ttlSeconds: 30 * 60
        }
      );
      if (!audioCapability || !receiptCapability) fail('notConfigured');
      const {
        announcementAudioUrl: _privateSourceUrl,
        ...receiverCommand
      } = command;
      const receiverInput = Object.freeze({
        ...receiverCommand,
        speechMode: occurrence.announcementMode === 'finite-audio'
          ? 'finite-audio'
          : 'natural-audio',
        audioUrl: audioCapability.url,
        audioExpiresAt: audioCapability.expiresAt,
        receiptUrl: receiptCapability.url,
        receiptExpiresAt: receiptCapability.expiresAt,
        recoveryShortcut: configured.recoveryShortcut
      });
      const recoveryInput = Object.freeze({
        schemaVersion: 1,
        version: 'x',
        action: 'recover-volume',
        commandId: `${occurrence.eventId}:recovery`,
        eventId: occurrence.eventId,
        issuedAt: syncNow,
        scheduledFor: occurrence.recoveryFor,
        musicPercent: 30,
        reason: 'scheduled-announcement-recovery'
      });

      // Arm the harmless Volume Down recovery first. If the announcement is
      // rejected, cancellation can only leave a safe volume reduction behind.
      await scheduleExecution({
        identifier: occurrence.recoveryIdentifier,
        delaySeconds: Math.ceil((occurrence.recoveryFor - Number(now())) / 1000),
        shortcut: configured.recoveryShortcut,
        input: recoveryInput
      });
      try {
        await scheduleExecution({
          identifier: occurrence.identifier,
          delaySeconds: Math.ceil((occurrence.scheduledFor - Number(now())) / 1000),
          shortcut: configured.shortcut,
          input: receiverInput
        });
      } catch (error) {
        await cancelExecution(occurrence.identifier).catch(() => {});
        await cancelExecution(occurrence.recoveryIdentifier).catch(() => {});
        throw error;
      }
      await updateReceipt(occurrence.eventId, {
        status: 'accepted',
        providerStatus: 'pushcut_scheduled',
        providerMode: 'delayed',
        acceptedAt: syncNow,
        recoveryQueued: true,
        recoveryAcceptedAt: syncNow
      }, {
        env,
        fetchImpl,
        requireDurable: true,
        now: () => syncNow
      });
      if (existing?.eventId && existing.eventId !== occurrence.eventId) {
        await updateReceipt(existing.eventId, {
          status: 'failed',
          providerStatus: 'schedule_replaced',
          failedAt: syncNow,
          failureCode: 'schedule_replaced'
        }, {
          env,
          fetchImpl,
          requireDurable: true,
          now: () => syncNow
        }).catch(() => {});
      }
      manifest.occurrences[occurrence.logicalId] = manifestEntry(occurrence, 'scheduled', syncNow);
      scheduled += 1;
      await manifestStore.write(manifest);
    }
    manifest = {
      ...manifest,
      syncedAt: Number(now()),
      occurrences: Object.fromEntries(Object.entries(manifest.occurrences)
        .filter(([logicalId]) => desired.has(logicalId)))
    };
    await manifestStore.write(manifest);
    return Object.freeze({
      ...publicManifest(manifest, plan.warnings),
      scheduled,
      unchanged,
      cancelled,
      requiresExtended: false
    });
  });
}
