const ENDPOINT = '/api/email-wake-schedule-x?v=x';
const REQUEST_TIMEOUT_MS = 240_000;

export class EmailWakeScheduleSyncError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = 'EmailWakeScheduleSyncError';
    this.status = Number(status || 0);
  }
}

async function requestJson(method, {
  state,
  enabled = true,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new EmailWakeScheduleSyncError(
      'Automatic announcement schedule sync is unavailable in this browser.'
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1_000, Number(timeoutMs) || REQUEST_TIMEOUT_MS)
  );
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(method === 'POST'
          ? { 'Content-Type': 'application/json; charset=utf-8' }
          : {})
      },
      ...(method === 'POST'
        ? {
            body: JSON.stringify({
              expectedRevision: Number.isSafeInteger(Number(state?.revision))
                ? Number(state.revision)
                : 0,
              enabled: enabled !== false
            })
          }
        : {})
    });
  } catch (error) {
    throw new EmailWakeScheduleSyncError(
      error?.name === 'AbortError'
        ? 'Automatic announcement schedule sync timed out.'
        : 'Automatic announcement schedule sync could not reach Version X.'
    );
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new EmailWakeScheduleSyncError(
      payload?.error
      || `Automatic announcement schedule sync returned HTTP ${response.status}.`,
      { status: response.status }
    );
  }
  return payload;
}

export function getEmailWakeScheduleStatus(options = {}) {
  return requestJson('GET', options);
}

export function syncEmailWakeSchedule(state, options = {}) {
  return requestJson('POST', { ...options, state });
}
