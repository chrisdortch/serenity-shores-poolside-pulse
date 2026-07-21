const PUSHCUT_X_ENDPOINT = '/api/pushcut-x?v=x';
const PUSHCUT_VOLUME_X_ENDPOINT = '/api/pushcut-volume-x?v=x';
const REQUEST_TIMEOUT_MS = 20_000;
const COMPLETION_TIMEOUT_MS = 240_000;
export const PUSHCUT_MAX_ANNOUNCEMENT_CHARACTERS = 500;
export const PUSHCUT_MAX_FINITE_AUDIO_SECONDS = 180;

function cleanText(value, maximum, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required.`);
  if (text.length > maximum) throw new Error(`${field} must be ${maximum} characters or fewer.`);
  return text;
}

function clampPercent(value, fallback) {
  const number = Number(value);
  return Math.max(0, Math.min(100, Number.isFinite(number) ? Math.round(number) : fallback));
}

function finiteAnnouncementFields(mode, provider, audioUrl, durationSeconds) {
  const requestedMode = String(mode || 'natural-voice').trim().toLowerCase();
  if (requestedMode === 'natural-voice') return { announcementMode: 'natural-voice' };
  if (requestedMode !== 'finite-audio') throw new Error('The announcement source type is invalid.');
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (!['direct', 'suno'].includes(normalizedProvider)) {
    throw new Error('Short announcement clips must use the Direct or Suno provider.');
  }
  let normalizedUrl;
  try {
    normalizedUrl = new URL(String(audioUrl || '').trim());
  } catch {
    throw new Error('Paste a valid HTTPS URL for the announcement clip.');
  }
  if (normalizedUrl.protocol !== 'https:') throw new Error('Announcement clips require an HTTPS URL.');
  const duration = Number(durationSeconds);
  if (!Number.isInteger(duration) || duration < 1 || duration > PUSHCUT_MAX_FINITE_AUDIO_SECONDS) {
    throw new Error(`Announcement clips must have an expected duration from 1 to ${PUSHCUT_MAX_FINITE_AUDIO_SECONDS} seconds.`);
  }
  return {
    announcementMode: 'finite-audio',
    announcementProvider: normalizedProvider,
    announcementAudioUrl: normalizedUrl.toString(),
    announcementDurationSeconds: duration
  };
}

function newEventId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `pushcut-${globalThis.crypto.randomUUID()}`;
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return `pushcut-${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  throw new Error('This browser cannot create a secure announcement identifier.');
}

function validEventId(value) {
  const eventId = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/.test(eventId)) {
    throw new Error('The announcement identifier is invalid.');
  }
  return eventId;
}

async function jsonResponse(response) {
  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw Object.assign(new Error(`Announcement service returned HTTP ${response.status}.`), { status: response.status });
    throw new Error('Announcement service returned an invalid response.');
  }
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const error = new Error('Announcement service returned an invalid response.');
    if (!response.ok) error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(String(data.error || data.message || `Announcement request failed with HTTP ${response.status}.`).slice(0, 500));
    error.status = response.status;
    error.eventId = String(data.eventId || '');
    error.data = data;
    throw error;
  }
  return data;
}

export class PushcutDispatchUncertainError extends Error {
  constructor(eventId, cause) {
    super('The announcement request may have reached the receiver, but confirmation was lost. Do not press Speak Now again; check Pushcut > Automation Server > Monitor Requests before retrying.');
    this.name = 'PushcutDispatchUncertainError';
    this.eventId = eventId;
    this.uncertain = true;
    this.cause = cause;
  }
}

/**
 * Dispatches one Version X live announcement through the server-side Pushcut
 * bridge. A stable event ID ties the browser request to the receiver input.
 * This function never retries: a lost response is ambiguous because Pushcut
 * may still execute the shortcut after the browser stops waiting.
 */
export async function sendPushcutAnnouncement({
  text,
  label = 'Speak Now',
  safety = false,
  voicePercent = 100,
  musicPercent = 30,
  announcementMode = 'natural-voice',
  announcementProvider = '',
  announcementAudioUrl = '',
  announcementDurationSeconds = 0,
  eventId = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Announcement service is unavailable in this browser.');
  const stableEventId = validEventId(eventId || newEventId());
  // Version X deliberately has no quiet-announcement mode. Keep accepting the
  // legacy argument so older callers do not break, but never forward anything
  // other than the fixed 100% announcement target.
  const normalizedVoicePercent = 100;
  const normalizedMusicPercent = clampPercent(musicPercent, 30);
  const payload = {
    version: 'x',
    eventId: stableEventId,
    source: 'live',
    text: cleanText(text, PUSHCUT_MAX_ANNOUNCEMENT_CHARACTERS, 'Announcement text'),
    label: cleanText(label, 80, 'Announcement label'),
    safety: safety === true,
    voicePercent: normalizedVoicePercent,
    musicPercent: normalizedMusicPercent,
    ...finiteAnnouncementFields(
      announcementMode,
      announcementProvider,
      announcementAudioUrl,
      announcementDurationSeconds
    )
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || REQUEST_TIMEOUT_MS));
  try {
    const response = await fetchImpl(PUSHCUT_X_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': stableEventId
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await jsonResponse(response);
    return {
      ...data,
      eventId: String(data.eventId || stableEventId),
      accepted: response.status === 202 || data.accepted === true,
      completed: data.status === 'completed'
    };
  } catch (error) {
    if (error?.status) throw error;
    throw new PushcutDispatchUncertainError(stableEventId, error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads bridge readiness, or the honest non-receipt status for one prior event.
 * This is the safe recovery path after PushcutDispatchUncertainError; it never
 * redispatches and never invents completion for a nowait request.
 */
export async function getPushcutAnnouncementStatus(eventId = '', {
  fetchImpl = globalThis.fetch,
  timeoutMs = 12_000
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Announcement service is unavailable in this browser.');
  const query = eventId ? `&eventId=${encodeURIComponent(validEventId(eventId))}` : '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || 12_000));
  try {
    const response = await fetchImpl(`${PUSHCUT_X_ENDPOINT}${query}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal
    });
    return await jsonResponse(response);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Announcement status check timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Waits for the signed receiver receipt without ever redispatching the
 * announcement. A timeout is deliberately reported as uncertain rather than
 * as a playback failure because the receiver may still be finishing speech.
 */
export async function waitForPushcutAnnouncementCompletion(eventId, {
  fetchImpl = globalThis.fetch,
  timeoutMs = COMPLETION_TIMEOUT_MS,
  pollMs = 1_500,
  onUpdate = () => {}
} = {}) {
  const stableEventId = validEventId(eventId);
  const deadline = Date.now() + Math.max(10_000, Number(timeoutMs) || COMPLETION_TIMEOUT_MS);
  let latest = null;
  while (Date.now() < deadline) {
    latest = await getPushcutAnnouncementStatus(stableEventId, {
      fetchImpl,
      timeoutMs: Math.min(12_000, Math.max(2_000, deadline - Date.now()))
    });
    const receipt = latest?.receipt && typeof latest.receipt === 'object' ? latest.receipt : latest;
    const status = String(receipt?.status || latest?.status || '').toLowerCase();
    onUpdate({ ...latest, receipt, status });
    if (status === 'completed' && receipt?.completed === false) {
      throw new Error('The receiver returned an inconsistent completion receipt.');
    }
    if (status === 'completed') return { ...latest, receipt, status, completed: true };
    if (status === 'failed' || status === 'expired') {
      const error = new Error(String(receipt?.message || latest?.error || 'The receiver reported that the announcement failed.').slice(0, 500));
      error.eventId = stableEventId;
      error.status = status;
      error.receipt = receipt;
      throw error;
    }
    await wait(Math.min(Math.max(500, Number(pollMs) || 1_500), Math.max(0, deadline - Date.now())));
  }
  const error = new Error('The receiver has not reported completion yet. Do not send the announcement again; keep Pushcut on Ready For Requests and check Monitor Requests.');
  error.name = 'PushcutCompletionUncertainError';
  error.eventId = stableEventId;
  error.uncertain = true;
  error.receipt = latest?.receipt || latest;
  throw error;
}

/**
 * Applies the current music-only slider target through the receiver's dynamic
 * recovery Shortcut. A completed result confirms Shortcut completion only; it
 * is not a physical-volume measurement.
 */
export async function applyPushcutMusicVolume({
  musicPercent = 30,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Pushcut volume control is unavailable in this browser.');
  const target = clampPercent(musicPercent, 30);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || REQUEST_TIMEOUT_MS));
  try {
    const response = await fetchImpl(PUSHCUT_VOLUME_X_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 'x', musicPercent: target }),
      signal: controller.signal
    });
    const data = await jsonResponse(response);
    return {
      ...data,
      accepted: data.accepted === true,
      completed: data.completed === true,
      musicPercent: clampPercent(data.musicPercent, target)
    };
  } catch (error) {
    if (error?.status) throw error;
    const uncertain = new Error('The volume request may have reached Pushcut, but completion could not be confirmed. Check that the Receiver is on Ready For Requests before trying again.');
    uncertain.name = 'PushcutVolumeUncertainError';
    uncertain.uncertain = true;
    uncertain.cause = error;
    throw uncertain;
  } finally {
    clearTimeout(timer);
  }
}

// Compatibility export for tests and old cached modules. New Version X UI
// always calls applyPushcutMusicVolume with the persisted slider target.
export async function applyPushcutMusic30Now(options = {}) {
  const musicPercent = options.musicPercent === null || options.musicPercent === undefined
    ? 30
    : options.musicPercent;
  return await applyPushcutMusicVolume({ ...options, musicPercent });
}
