const EMAIL_WAKE_X_ENDPOINT = '/api/email-wake-x?v=x';
const EMAIL_WAKE_PAIR_X_ENDPOINT = '/api/email-wake-pair-x?v=x';
const EMAIL_WAKE_BROWSER_LEASE_X_ENDPOINT =
  '/api/email-wake-browser-lease-x?v=x';
const REQUEST_TIMEOUT_MS = 20_000;
const COMPLETION_TIMEOUT_MS = 240_000;
const BROWSER_AUDIO_LEASE_WAIT_MS = 150_000;
const BROWSER_AUDIO_LEASE_RENEW_MS = 30_000;

export const EMAIL_WAKE_MAX_ANNOUNCEMENT_CHARACTERS = 500;
export const EMAIL_WAKE_MAX_FINITE_AUDIO_SECONDS = 180;

function cleanText(value, maximum, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required.`);
  if (text.length > maximum) {
    throw new Error(`${field} must be ${maximum} characters or fewer.`);
  }
  return text;
}

function clampPercent(value, fallback) {
  const number = Number(value);
  return Math.max(
    0,
    Math.min(100, Number.isFinite(number) ? Math.round(number) : fallback)
  );
}

function finiteAnnouncementFields(mode, provider, audioUrl, durationSeconds) {
  const requestedMode = String(mode || 'natural-voice').trim().toLowerCase();
  if (requestedMode === 'natural-voice') {
    return { announcementMode: 'natural-voice' };
  }
  if (requestedMode !== 'finite-audio') {
    throw new Error('The announcement source type is invalid.');
  }
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
  if (normalizedUrl.protocol !== 'https:') {
    throw new Error('Announcement clips require an HTTPS URL.');
  }
  const duration = Number(durationSeconds);
  if (
    !Number.isInteger(duration)
    || duration < 1
    || duration > EMAIL_WAKE_MAX_FINITE_AUDIO_SECONDS
  ) {
    throw new Error(
      `Announcement clips must have an expected duration from 1 to ${EMAIL_WAKE_MAX_FINITE_AUDIO_SECONDS} seconds.`
    );
  }
  return {
    announcementMode: 'finite-audio',
    announcementProvider: normalizedProvider,
    announcementAudioUrl: normalizedUrl.toString(),
    announcementDurationSeconds: duration
  };
}

function newEventId(prefix = 'email-wake') {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return `${prefix}-${[...bytes]
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  throw new Error('This browser cannot create a secure announcement identifier.');
}

function validEventId(value) {
  const eventId = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/.test(eventId)) {
    throw new Error('The automatic Receiver command identifier is invalid.');
  }
  return eventId;
}

async function jsonResponse(response, fallback = 'Automatic Receiver request failed.') {
  const contentType = String(
    response.headers?.get?.('content-type') || ''
  ).toLowerCase();
  if (!contentType.includes('application/json')) {
    const error = new Error(
      response.ok
        ? 'Automatic Receiver returned an invalid response.'
        : `Automatic Receiver returned HTTP ${response.status}.`
    );
    error.status = response.status;
    throw error;
  }
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('Automatic Receiver returned an invalid response.');
    error.status = response.status;
    throw error;
  }
  if (!response.ok || payload.ok === false) {
    const error = new Error(
      String(payload.error || payload.message || fallback).slice(0, 500)
    );
    error.status = response.status;
    error.eventId = String(payload.eventId || '');
    error.data = payload;
    throw error;
  }
  return payload;
}

async function requestJson(url, {
  method = 'GET',
  body = null,
  eventId = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Automatic Receiver is unavailable in this browser.');
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1_000, Number(timeoutMs) || REQUEST_TIMEOUT_MS)
  );
  try {
    const response = await fetchImpl(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
        ...(eventId ? { 'Idempotency-Key': eventId } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal
    });
    return await jsonResponse(response);
  } catch (error) {
    if (error?.status) throw error;
    if (error?.name === 'AbortError') {
      throw new Error('Automatic Receiver request timed out.');
    }
    throw new Error(`Automatic Receiver could not be reached: ${error.message || String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

export function getEmailWakeStatus(eventId = '', options = {}) {
  const query = eventId
    ? `&eventId=${encodeURIComponent(validEventId(eventId))}`
    : '';
  return requestJson(`${EMAIL_WAKE_X_ENDPOINT}${query}`, options);
}

export function claimEmailWakeBrowserAudioLease(leaseId, options = {}) {
  return requestJson(EMAIL_WAKE_BROWSER_LEASE_X_ENDPOINT, {
    ...options,
    method: 'POST',
    body: {
      action: 'claim',
      leaseId: validEventId(leaseId)
    }
  });
}

export function releaseEmailWakeBrowserAudioLease(leaseId, options = {}) {
  return requestJson(EMAIL_WAKE_BROWSER_LEASE_X_ENDPOINT, {
    ...options,
    method: 'POST',
    body: {
      action: 'release',
      leaseId: validEventId(leaseId)
    }
  });
}

export function createEmailWakePairingCode(options = {}) {
  return requestJson(EMAIL_WAKE_PAIR_X_ENDPOINT, {
    ...options,
    method: 'POST',
    body: {}
  });
}

export async function sendEmailWakeAnnouncement({
  text,
  label = 'Speak Now',
  safety = false,
  musicPercent = 30,
  announcementMode = 'natural-voice',
  announcementProvider = '',
  announcementAudioUrl = '',
  announcementDurationSeconds = 0,
  eventId = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  const stableEventId = validEventId(eventId || newEventId());
  const payload = {
    version: 'x',
    eventId: stableEventId,
    source: 'live',
    text: cleanText(
      text,
      EMAIL_WAKE_MAX_ANNOUNCEMENT_CHARACTERS,
      'Announcement text'
    ),
    label: cleanText(label, 80, 'Announcement label'),
    safety: safety === true,
    voicePercent: 100,
    musicPercent: clampPercent(musicPercent, 30),
    ...finiteAnnouncementFields(
      announcementMode,
      announcementProvider,
      announcementAudioUrl,
      announcementDurationSeconds
    )
  };
  const result = await requestJson(EMAIL_WAKE_X_ENDPOINT, {
    method: 'POST',
    body: payload,
    eventId: stableEventId,
    fetchImpl,
    timeoutMs
  });
  return {
    ...result,
    eventId: String(result.eventId || stableEventId),
    accepted: result.accepted === true || result.queued === true
  };
}

export async function applyEmailWakeMusicVolume({
  musicPercent = 30,
  eventId = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  const stableEventId = validEventId(eventId || newEventId('email-volume'));
  const target = clampPercent(musicPercent, 30);
  const result = await requestJson(EMAIL_WAKE_X_ENDPOINT, {
    method: 'POST',
    body: {
      version: 'x',
      action: 'volume',
      eventId: stableEventId,
      source: 'live',
      musicPercent: target
    },
    eventId: stableEventId,
    fetchImpl,
    timeoutMs
  });
  return {
    ...result,
    eventId: String(result.eventId || stableEventId),
    musicPercent: clampPercent(result.musicPercent, target),
    accepted: result.accepted === true || result.queued === true
  };
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Runs one browser-side physical audio mutation while holding the same durable
 * lease that gates the background Receiver Shortcut. This closes the race
 * between a browser "not busy" poll and a Shortcut claim.
 */
export async function withEmailWakeBrowserAudioLease(work, {
  fetchImpl = globalThis.fetch,
  timeoutMs = BROWSER_AUDIO_LEASE_WAIT_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  waitImpl = wait,
  now = Date.now,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
  onLeaseWarning = () => {}
} = {}) {
  if (typeof work !== 'function') {
    throw new Error('A browser audio operation is required.');
  }
  const leaseId = newEventId('browser-audio');
  const deadline =
    Number(now()) + Math.max(10_000, Number(timeoutMs) || BROWSER_AUDIO_LEASE_WAIT_MS);
  let claimed = null;
  while (Number(now()) < deadline) {
    claimed = await claimEmailWakeBrowserAudioLease(leaseId, {
      fetchImpl,
      timeoutMs: requestTimeoutMs
    });
    if (claimed.acquired === true) break;
    await waitImpl(Math.min(
      1_000,
      Math.max(100, deadline - Number(now()))
    ));
  }
  if (claimed?.acquired !== true) {
    throw new Error(
      'The background announcement is still using the speaker. The browser audio command stayed quiet instead of overlapping it.'
    );
  }

  let renewalError = null;
  let renewalTail = Promise.resolve();
  const renewalTimer = typeof setIntervalImpl === 'function'
    ? setIntervalImpl(() => {
        renewalTail = renewalTail.then(async () => {
          if (renewalError) return;
          const renewed = await claimEmailWakeBrowserAudioLease(leaseId, {
            fetchImpl,
            timeoutMs: requestTimeoutMs
          });
          if (renewed.acquired !== true) {
            throw new Error(
              'The browser lost its speaker audio lease before the operation completed.'
            );
          }
        }).catch(error => {
          renewalError = error;
        });
      }, BROWSER_AUDIO_LEASE_RENEW_MS)
    : null;

  try {
    const result = await work();
    await renewalTail;
    if (renewalError) throw renewalError;
    return result;
  } finally {
    if (renewalTimer !== null && typeof clearIntervalImpl === 'function') {
      clearIntervalImpl(renewalTimer);
    }
    await renewalTail.catch(() => {});
    try {
      await releaseEmailWakeBrowserAudioLease(leaseId, {
        fetchImpl,
        timeoutMs: requestTimeoutMs
      });
    } catch (error) {
      onLeaseWarning(
        `Browser audio finished, but its coordination lease will clear automatically: ${
          error.message || String(error)
        }`
      );
    }
  }
}

export async function waitForEmailWakeCompletion(eventId, {
  fetchImpl = globalThis.fetch,
  timeoutMs = COMPLETION_TIMEOUT_MS,
  pollMs = 1_500,
  onUpdate = () => {}
} = {}) {
  const stableEventId = validEventId(eventId);
  const deadline =
    Date.now() + Math.max(10_000, Number(timeoutMs) || COMPLETION_TIMEOUT_MS);
  let latest = null;
  while (Date.now() < deadline) {
    latest = await getEmailWakeStatus(stableEventId, {
      fetchImpl,
      timeoutMs: Math.min(
        12_000,
        Math.max(2_000, deadline - Date.now())
      )
    });
    const receipt =
      latest?.receipt && typeof latest.receipt === 'object'
        ? latest.receipt
        : latest;
    const status = String(
      receipt?.status || latest?.status || ''
    ).toLowerCase();
    onUpdate({ ...latest, receipt, status });
    if (status === 'completed' && receipt?.completed === false) {
      throw new Error('Automatic Receiver returned an inconsistent completion receipt.');
    }
    if (status === 'completed') {
      return { ...latest, receipt, status, completed: true };
    }
    if (status === 'failed' || status === 'expired') {
      const error = new Error(
        String(
          receipt?.message
          || latest?.error
          || 'Automatic Receiver reported that playback failed.'
        ).slice(0, 500)
      );
      error.eventId = stableEventId;
      error.status = status;
      error.receipt = receipt;
      throw error;
    }
    await wait(
      Math.min(
        Math.max(500, Number(pollMs) || 1_500),
        Math.max(0, deadline - Date.now())
      )
    );
  }
  const error = new Error(
    'The Receiver has not reported completion yet. Do not resend; keep the Receiver online and review Activity.'
  );
  error.name = 'EmailWakeCompletionUncertainError';
  error.eventId = stableEventId;
  error.uncertain = true;
  error.receipt = latest?.receipt || latest;
  throw error;
}
