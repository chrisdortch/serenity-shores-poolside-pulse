const ENDPOINT = '/api/pushcut-schedule-x?v=x';
const REQUEST_TIMEOUT_MS = 240_000;

export class PushcutScheduleSyncError extends Error {
  constructor(message, {
    requiresExtended = false,
    status = 0
  } = {}) {
    super(message);
    this.name = 'PushcutScheduleSyncError';
    this.requiresExtended = requiresExtended === true;
    this.status = Number(status || 0);
  }
}

async function requestJson(method, {
  state,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new PushcutScheduleSyncError('Schedule sync is unavailable in this browser.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json; charset=utf-8' } : {})
      },
      ...(method === 'POST' ? {
        // The server reads the canonical state from durable Version X storage.
        // The browser supplies only its expected revision to detect a stale tab.
        body: JSON.stringify({
          expectedRevision: Number.isSafeInteger(Number(state?.revision))
            ? Number(state.revision)
            : 0
        })
      } : {})
    });
  } catch (error) {
    throw new PushcutScheduleSyncError(
      error?.name === 'AbortError'
        ? 'Pushcut schedule sync timed out.'
        : 'Pushcut schedule sync could not reach Version X.'
    );
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new PushcutScheduleSyncError(
      payload?.error || `Pushcut schedule sync returned HTTP ${response.status}.`,
      {
        status: response.status,
        requiresExtended: payload?.requiresExtended === true
      }
    );
  }
  return payload;
}

export function getPushcutScheduleStatus(options = {}) {
  return requestJson('GET', options);
}

export function syncPushcutSchedule(state, options = {}) {
  return requestJson('POST', { ...options, state });
}
