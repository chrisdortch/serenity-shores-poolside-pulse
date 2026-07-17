export const PUSHCUT_VOLUME_X_API_URL = 'https://api.pushcut.io/v1/execute';
export const PUSHCUT_VOLUME_X_DEFAULT_SHORTCUT = 'Volume Down';
export const PUSHCUT_VOLUME_X_PERCENT = 30;
export const PUSHCUT_VOLUME_X_WAIT_SECONDS = 10;
export const PUSHCUT_VOLUME_X_TIMEOUT_MS = 12_000;

const SAFE_ERRORS = Object.freeze({
  notConfigured: Object.freeze({ statusCode: 503, message: 'The Version X Pushcut music-volume action is not configured.' }),
  providerBusy: Object.freeze({ statusCode: 503, message: 'The Pushcut receiver is busy. Try again shortly.' }),
  providerRejected: Object.freeze({ statusCode: 502, message: 'Pushcut could not run the music-volume Shortcut.' }),
  timeout: Object.freeze({ statusCode: 504, message: 'The music-volume Shortcut did not confirm completion in time.' })
});

export class PushcutVolumeXError extends Error {
  constructor(code) {
    const safe = SAFE_ERRORS[code] || SAFE_ERRORS.providerRejected;
    super(safe.message);
    this.name = 'PushcutVolumeXError';
    this.code = Object.hasOwn(SAFE_ERRORS, code) ? code : 'providerRejected';
    this.statusCode = safe.statusCode;
  }
}

function cleanConfigurationValue(value, maximum) {
  const text = String(value || '').trim();
  if (!text || text.length > maximum || /[\r\n]/.test(text)) return '';
  return text;
}

function configuration(env) {
  const source = env && typeof env === 'object' ? env : {};
  return {
    apiKey: cleanConfigurationValue(source.PUSHCUT_API_KEY_X, 1_024),
    shortcut: cleanConfigurationValue(source.PUSHCUT_RECOVERY_SHORTCUT_X, 160)
      || PUSHCUT_VOLUME_X_DEFAULT_SHORTCUT
  };
}

function successfulStatus(status) {
  return Number(status) >= 200 && Number(status) < 300;
}

export function pushcutVolumeXHealth(env = process.env) {
  const configured = configuration(env);
  return Object.freeze({
    ready: Boolean(configured.apiKey && configured.shortcut),
    mode: 'wait',
    musicPercent: PUSHCUT_VOLUME_X_PERCENT
  });
}

/**
 * Runs only the existing Version X recovery Shortcut and deliberately returns
 * no provider body, Shortcut name, server identifier, or API-key metadata.
 */
export async function applyPushcutXMusicVolume({
  env = process.env,
  fetchImpl = globalThis.fetch,
  apiUrl = PUSHCUT_VOLUME_X_API_URL,
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  now = Date.now
} = {}) {
  const configured = configuration(env);
  if (!configured.apiKey || !configured.shortcut) throw new PushcutVolumeXError('notConfigured');
  if (typeof fetchImpl !== 'function' || typeof AbortControllerImpl !== 'function') {
    throw new PushcutVolumeXError('providerRejected');
  }

  const controller = new AbortControllerImpl();
  const timer = setTimeoutImpl(() => controller.abort(), PUSHCUT_VOLUME_X_TIMEOUT_MS);
  const issuedAt = Number(now());
  const commandId = `manual-volume-${Number.isSafeInteger(issuedAt) && issuedAt >= 0 ? issuedAt : Date.now()}`;
  try {
    const endpoint = new URL(String(apiUrl));
    endpoint.search = '';
    endpoint.searchParams.set('shortcut', configured.shortcut);
    endpoint.searchParams.set('timeout', String(PUSHCUT_VOLUME_X_WAIT_SECONDS));
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'API-Key': configured.apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        input: {
          schemaVersion: 1,
          version: 'x',
          action: 'recover-volume',
          commandId,
          eventId: commandId,
          issuedAt,
          musicPercent: PUSHCUT_VOLUME_X_PERCENT,
          reason: 'manual-manager-volume'
        }
      })
    });
    const status = Number(response?.status);
    if (status === 200) {
      return Object.freeze({
        accepted: true,
        completed: true,
        status: 'completed',
        musicPercent: PUSHCUT_VOLUME_X_PERCENT
      });
    }
    if (successfulStatus(status)) {
      return Object.freeze({
        accepted: true,
        completed: false,
        status: 'accepted',
        musicPercent: PUSHCUT_VOLUME_X_PERCENT
      });
    }
    if (status === 429) throw new PushcutVolumeXError('providerBusy');
    if (status === 504) throw new PushcutVolumeXError('timeout');
    throw new PushcutVolumeXError('providerRejected');
  } catch (error) {
    if (error instanceof PushcutVolumeXError) throw error;
    if (controller.signal?.aborted || error?.name === 'AbortError') {
      throw new PushcutVolumeXError('timeout');
    }
    throw new PushcutVolumeXError('providerRejected');
  } finally {
    clearTimeoutImpl(timer);
  }
}
