import { randomUUID } from 'node:crypto';

export const PUSHCUT_X_ACTIONS = Object.freeze(['announce', 'test']);
export const PUSHCUT_X_API_URL = 'https://api.pushcut.io/v1/execute';
export const PUSHCUT_X_UPSTREAM_TIMEOUT_MS = 8_000;
export const PUSHCUT_X_DEFAULT_SHORTCUT = 'Poolside Pulse Announcement';

// Pushcut recommends that server shortcuts finish within 60 seconds. Keeping
// live speech below 500 characters leaves time for voice rendering, the pause,
// volume changes, playback, and restoration on the receiver iPhone.
const ANNOUNCEMENT_MAX_CHARACTERS = 500;
const COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ACTION_SET = new Set(PUSHCUT_X_ACTIONS);
const ACTION_FIELDS = Object.freeze({
  announce: new Set([
    'action',
    'announcementVolume',
    'commandId',
    'musicVolume',
    'resumeMusic',
    'text'
  ]),
  test: new Set(['action', 'commandId'])
});
const LIVE_ANNOUNCEMENT_FIELDS = new Set([
  'eventId',
  'label',
  'musicPercent',
  'safety',
  'source',
  'text',
  'version',
  'voicePercent'
]);

const SAFE_ERRORS = Object.freeze({
  invalid: Object.freeze({
    statusCode: 400,
    message: 'The Pushcut command is invalid.'
  }),
  notConfigured: Object.freeze({
    statusCode: 503,
    message: 'The Version X Pushcut receiver is not configured.'
  }),
  providerBusy: Object.freeze({
    statusCode: 503,
    message: 'The Pushcut receiver is busy. Try again shortly.'
  }),
  providerRejected: Object.freeze({
    statusCode: 502,
    message: 'The Pushcut receiver could not accept the command.'
  }),
  timeout: Object.freeze({
    statusCode: 504,
    message: 'The Pushcut receiver did not accept the command in time.'
  })
});

export class PushcutXError extends Error {
  constructor(code) {
    const safe = SAFE_ERRORS[code] || SAFE_ERRORS.providerRejected;
    super(safe.message);
    this.name = 'PushcutXError';
    this.code = Object.hasOwn(SAFE_ERRORS, code) ? code : 'providerRejected';
    this.statusCode = safe.statusCode;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanConfigurationValue(value, maxLength) {
  const text = String(value || '').trim();
  if (!text || text.length > maxLength || /[\r\n]/.test(text)) return '';
  return text;
}

function configuration(env) {
  const source = env && typeof env === 'object' ? env : {};
  const apiKey = cleanConfigurationValue(source.PUSHCUT_API_KEY_X, 1_024);
  const sharedShortcut = cleanConfigurationValue(source.PUSHCUT_SHORTCUT_X, 160) || PUSHCUT_X_DEFAULT_SHORTCUT;
  const shortcuts = Object.freeze({
    announce: cleanConfigurationValue(source.PUSHCUT_ANNOUNCE_SHORTCUT_X, 160) || sharedShortcut,
    test: cleanConfigurationValue(source.PUSHCUT_TEST_SHORTCUT_X, 160) || sharedShortcut
  });
  const serverId = cleanConfigurationValue(source.PUSHCUT_SERVER_ID_X, 160);
  return { apiKey, serverId, shortcuts };
}

export function pushcutXHealth(env = process.env) {
  const configured = configuration(env);
  const actions = Object.fromEntries(PUSHCUT_X_ACTIONS.map(action => [
    action,
    Boolean(configured.apiKey && configured.shortcuts[action])
  ]));
  return Object.freeze({
    ready: PUSHCUT_X_ACTIONS.every(action => actions[action]),
    actions: Object.freeze(actions),
    mode: 'nowait'
  });
}

function invalid() {
  throw new PushcutXError('invalid');
}

function normalizedCommandId(value, idFactory) {
  if (value == null || value === '') {
    const generated = String(idFactory()).trim();
    if (!COMMAND_ID_PATTERN.test(generated)) invalid();
    return generated;
  }
  if (typeof value !== 'string') invalid();
  const commandId = value.trim();
  if (!COMMAND_ID_PATTERN.test(commandId)) invalid();
  return commandId;
}

export function validPushcutXEventId(value) {
  return typeof value === 'string' && COMMAND_ID_PATTERN.test(value.trim());
}

function percent(value, fallback) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < 0 || value > 100) invalid();
  return value;
}

function validateFields(body, action) {
  const allowed = ACTION_FIELDS[action];
  if (!allowed || Object.keys(body).some(key => !allowed.has(key))) invalid();
}

function announcementText(value) {
  if (typeof value !== 'string') invalid();
  const text = value.trim();
  if (!text || text.length > ANNOUNCEMENT_MAX_CHARACTERS || CONTROL_CHARACTER_PATTERN.test(text)) invalid();
  return text;
}

function announcementLabel(value, fallback = 'Speak Now') {
  if (value == null) return fallback;
  if (typeof value !== 'string') invalid();
  const label = value.trim();
  if (!label || label.length > 80 || CONTROL_CHARACTER_PATTERN.test(label)) invalid();
  return label;
}

function commandBase(action, commandId, issuedAt) {
  return {
    schemaVersion: 1,
    version: 'x',
    action,
    commandId,
    eventId: commandId,
    issuedAt
  };
}

function normalizeLiveAnnouncement(body, { idFactory, issuedAt }) {
  if (Object.keys(body).some(key => !LIVE_ANNOUNCEMENT_FIELDS.has(key))) invalid();
  if (body.version !== 'x' || body.source !== 'live') invalid();
  if (typeof body.safety !== 'boolean') invalid();
  const eventId = normalizedCommandId(body.eventId, idFactory);
  const voicePercent = percent(body.voicePercent, 100);
  const musicPercent = percent(body.musicPercent, 30);
  if (voicePercent <= musicPercent) invalid();
  return Object.freeze({
    ...commandBase('announce', eventId, issuedAt),
    source: 'live',
    text: announcementText(body.text),
    label: announcementLabel(body.label),
    safety: body.safety,
    voicePercent,
    musicPercent,
    resumeMusic: true
  });
}

/**
 * Converts browser input into the only command shapes that may reach the
 * receiver Shortcut. The returned object is newly constructed so untrusted
 * fields and prototypes are never forwarded to Pushcut.
 */
export function normalizePushcutXCommand(body, {
  idFactory = randomUUID,
  now = Date.now
} = {}) {
  if (!isRecord(body)) invalid();
  const issuedAt = Number(now());
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) invalid();

  // This is the live Version X browser envelope. It is converted to the same
  // narrow receiver command used by the explicit action API below.
  if (!Object.hasOwn(body, 'action')) {
    return normalizeLiveAnnouncement(body, { idFactory, issuedAt });
  }
  if (typeof body.action !== 'string') invalid();
  const action = body.action.trim().toLowerCase();
  if (!ACTION_SET.has(action)) invalid();
  validateFields(body, action);

  const commandId = normalizedCommandId(body.commandId, idFactory);
  const base = commandBase(action, commandId, issuedAt);

  if (action === 'test') {
    return Object.freeze({
      ...base,
      source: 'test',
      text: 'Poolside Pulse X receiver test.',
      label: 'Receiver Test',
      safety: false,
      voicePercent: 100,
      musicPercent: 30,
      resumeMusic: true
    });
  }

  const voicePercent = percent(body.announcementVolume, 100);
  const musicPercent = percent(body.musicVolume, 30);
  if (voicePercent <= musicPercent) invalid();
  const resumeMusic = body.resumeMusic == null ? true : body.resumeMusic;
  if (typeof resumeMusic !== 'boolean') invalid();

  return Object.freeze({
    ...base,
    source: 'live',
    text: announcementText(body.text),
    label: 'Speak Now',
    safety: false,
    voicePercent,
    musicPercent,
    resumeMusic
  });
}

function shortcutFor(command, configured) {
  const action = String(command?.action || '');
  if (!ACTION_SET.has(action)) throw new PushcutXError('invalid');
  const shortcut = configured.shortcuts[action];
  if (!configured.apiKey || !shortcut) throw new PushcutXError('notConfigured');
  return shortcut;
}

/**
 * Submits a validated Version X command. The public route always uses the
 * fixed Pushcut host; injectable dependencies exist only for deterministic
 * unit tests.
 */
export async function dispatchPushcutXCommand(command, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  apiUrl = PUSHCUT_X_API_URL,
  upstreamTimeoutMs = PUSHCUT_X_UPSTREAM_TIMEOUT_MS,
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout
} = {}) {
  if (!isRecord(command) || !ACTION_SET.has(command.action)) throw new PushcutXError('invalid');
  const configured = configuration(env);
  const shortcut = shortcutFor(command, configured);
  if (typeof fetchImpl !== 'function' || typeof AbortControllerImpl !== 'function') {
    throw new PushcutXError('providerRejected');
  }

  const endpoint = new URL(String(apiUrl));
  endpoint.search = '';
  endpoint.searchParams.set('timeout', 'nowait');
  const controller = new AbortControllerImpl();
  const timer = setTimeoutImpl(() => controller.abort(), upstreamTimeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'API-Key': configured.apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        shortcut,
        input: JSON.stringify(command),
        ...(configured.serverId ? { serverId: configured.serverId } : {})
      })
    });
    const status = Number(response?.status);
    if (status >= 200 && status < 300) {
      return Object.freeze({
        accepted: true,
        action: command.action,
        commandId: command.commandId,
        eventId: command.eventId,
        mode: 'nowait'
      });
    }
    if (status === 429) throw new PushcutXError('providerBusy');
    throw new PushcutXError('providerRejected');
  } catch (error) {
    if (error instanceof PushcutXError) throw error;
    if (controller.signal?.aborted || error?.name === 'AbortError') {
      throw new PushcutXError('timeout');
    }
    throw new PushcutXError('providerRejected');
  } finally {
    clearTimeoutImpl(timer);
  }
}
