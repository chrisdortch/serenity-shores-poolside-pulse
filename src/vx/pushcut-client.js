const PUSHCUT_X_ENDPOINT = '/api/pushcut-x?v=x';
const REQUEST_TIMEOUT_MS = 20_000;
export const PUSHCUT_MAX_ANNOUNCEMENT_CHARACTERS = 500;

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
  eventId = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Announcement service is unavailable in this browser.');
  const stableEventId = validEventId(eventId || newEventId());
  const normalizedVoicePercent = clampPercent(voicePercent, 100);
  const normalizedMusicPercent = clampPercent(musicPercent, 30);
  if (normalizedVoicePercent <= normalizedMusicPercent) {
    throw new Error('For Pushcut announcements, Voice volume must be higher than Music volume. Lower Music or raise Voice, then try again.');
  }
  const payload = {
    version: 'x',
    eventId: stableEventId,
    source: 'live',
    text: cleanText(text, PUSHCUT_MAX_ANNOUNCEMENT_CHARACTERS, 'Announcement text'),
    label: cleanText(label, 80, 'Announcement label'),
    safety: safety === true,
    voicePercent: normalizedVoicePercent,
    musicPercent: normalizedMusicPercent
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
