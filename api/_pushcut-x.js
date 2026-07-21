import { randomUUID } from 'node:crypto';
import {
  FINITE_AUDIO_X_MAX_SECONDS,
  normalizeFiniteAudioReference
} from './_finite-audio-x.js';
import {
  PUSHCUT_X_ANNOUNCEMENT_SHORTCUT_NAME,
  PUSHCUT_X_RECEIVER_CONTRACT,
  PUSHCUT_X_RECOVERY_SHORTCUT_NAME
} from '../src/vx/pushcut-shortcuts.js';

export const PUSHCUT_X_ACTIONS = Object.freeze(['announce', 'test']);
export const PUSHCUT_X_API_URL = 'https://api.pushcut.io/v1/execute';
export const PUSHCUT_X_DEVICES_URL = 'https://api.pushcut.io/v1/devices';
export const PUSHCUT_X_UPSTREAM_TIMEOUT_MS = 12_000;
export const PUSHCUT_X_HEALTH_TIMEOUT_MS = 5_000;
export const PUSHCUT_X_DEFAULT_SHORTCUT = PUSHCUT_X_ANNOUNCEMENT_SHORTCUT_NAME;
export const PUSHCUT_X_DEFAULT_RECOVERY_SHORTCUT = PUSHCUT_X_RECOVERY_SHORTCUT_NAME;
export const PUSHCUT_X_TEST_WAIT_SECONDS = 10;
export { PUSHCUT_X_RECEIVER_CONTRACT };

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
    'announcementAudioUrl',
    'announcementDurationSeconds',
    'announcementMode',
    'announcementProvider',
    'announcementVolume',
    'commandId',
    'musicVolume',
    'resumeMusic',
    'text'
  ]),
  test: new Set(['action', 'commandId'])
});
const LIVE_ANNOUNCEMENT_FIELDS = new Set([
  'announcementAudioUrl',
  'announcementDurationSeconds',
  'announcementMode',
  'announcementProvider',
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
  }),
  receiverContract: Object.freeze({
    statusCode: 502,
    message: 'The Receiver Shortcut is outdated or incomplete. Install the current Poolside Pulse X receiver Shortcut.'
  }),
  stateUnavailable: Object.freeze({
    statusCode: 503,
    message: 'The saved Version X music level is temporarily unavailable.'
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
  const recoveryShortcut = cleanConfigurationValue(source.PUSHCUT_RECOVERY_SHORTCUT_X, 160)
    || PUSHCUT_X_DEFAULT_RECOVERY_SHORTCUT;
  const serverId = cleanConfigurationValue(source.PUSHCUT_SERVER_ID_X, 160);
  return { apiKey, recoveryShortcut, serverId, shortcuts };
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
    actionModes: Object.freeze({
      announce: 'wait',
      test: 'wait'
    }),
    recoveryReady: Boolean(configured.apiKey && configured.recoveryShortcut),
    mode: 'hybrid'
  });
}

/**
 * Emits only allow-listed operational metadata. Announcement text, signed
 * URLs, API keys, Shortcut names, and device identifiers are never logged.
 */
export function logPushcutXEvent(event, details = {}, env = process.env) {
  if (!String(env?.VERCEL || '').trim()) return;
  const safe = {
    service: 'pushcut-x',
    event: String(event || '').slice(0, 80)
  };
  for (const key of [
    'action',
    'eventId',
    'mode',
    'providerCategory',
    'providerStatus',
    'receiptStatus',
    'speechMode'
  ]) {
    const value = details?.[key];
    if (value == null || value === '') continue;
    safe[key] = typeof value === 'number'
      ? value
      : String(value).slice(0, 180);
  }
  for (const key of [
    'audioFetched',
    'completed',
    'recoveryQueued'
  ]) {
    if (typeof details?.[key] === 'boolean') safe[key] = details[key];
  }
  console.info(JSON.stringify(safe));
}

function responseOk(response) {
  const status = Number(response?.status);
  return status >= 200 && status < 300;
}

function deviceRecords(value) {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ['devices', 'items', 'results', 'data']) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  return [];
}

function firstString(record, fields) {
  for (const field of fields) {
    const value = cleanConfigurationValue(record?.[field], 200);
    if (value) return value;
  }
  return '';
}

function explicitBoolean(record, fields) {
  for (const field of fields) {
    if (!Object.hasOwn(record || {}, field)) continue;
    const value = record[field];
    if (typeof value === 'boolean') return value;
    if (value === 1 || String(value).trim().toLowerCase() === 'true') return true;
    if (value === 0 || String(value).trim().toLowerCase() === 'false') return false;
  }
  return null;
}

function summarizeDevices(payload, configuredServerId) {
  const devices = deviceRecords(payload);
  let relevant = [];
  if (configuredServerId) {
    relevant = devices.filter(device => firstString(device, [
      'id',
      'deviceId',
      'deviceID',
      'uuid'
    ]) === configuredServerId);
  } else {
    relevant = devices.filter(device => {
      const connected = explicitBoolean(device, [
        'isConnectedAutomationServer',
        'is_connected_automation_server',
        'connectedAutomationServer',
        'automationServerConnected',
        'automation_server_connected',
        'serverConnected',
        'isConnectedServer'
      ]);
      const server = explicitBoolean(device, [
        'isAutomationServer',
        'is_automation_server',
        'automationServer',
        'isServer'
      ]);
      return connected === true || server === true;
    });
  }

  const connectionValues = relevant
    .map(device => explicitBoolean(device, [
      'isConnectedAutomationServer',
      'is_connected_automation_server',
      'connectedAutomationServer',
      'automationServerConnected',
      'automation_server_connected',
      'serverConnected',
      'isConnectedServer'
    ]))
    .filter(value => value !== null);
  const connected = connectionValues.includes(true)
    ? true
    : connectionValues.length > 0
      ? false
      : null;
  return Object.freeze({
    connected,
    deviceCount: devices.length,
    serverMatched: relevant.length > 0
  });
}

/**
 * Queries Pushcut's authenticated device list without returning device names,
 * identifiers, or any account metadata to the browser.
 */
export async function inspectPushcutXServerHealth({
  env = process.env,
  fetchImpl = globalThis.fetch,
  devicesUrl = PUSHCUT_X_DEVICES_URL,
  upstreamTimeoutMs = PUSHCUT_X_HEALTH_TIMEOUT_MS,
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout
} = {}) {
  const configured = configuration(env);
  if (!configured.apiKey) {
    return Object.freeze({
      configured: false,
      providerReachable: false,
      serverMatched: false,
      connected: false,
      deviceCount: 0
    });
  }
  if (typeof fetchImpl !== 'function' || typeof AbortControllerImpl !== 'function') {
    return Object.freeze({
      configured: true,
      providerReachable: false,
      serverMatched: false,
      connected: null,
      deviceCount: 0
    });
  }

  const controller = new AbortControllerImpl();
  const timer = setTimeoutImpl(() => controller.abort(), upstreamTimeoutMs);
  try {
    const endpoint = new URL(String(devicesUrl));
    endpoint.search = '';
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'API-Key': configured.apiKey,
        'Accept': 'application/json'
      }
    });
    if (!responseOk(response)) {
      return Object.freeze({
        configured: true,
        providerReachable: false,
        serverMatched: false,
        connected: null,
        deviceCount: 0
      });
    }
    const payload = await response.json().catch(() => null);
    const summary = summarizeDevices(payload, configured.serverId);
    return Object.freeze({
      configured: true,
      providerReachable: true,
      ...summary
    });
  } catch {
    return Object.freeze({
      configured: true,
      providerReachable: false,
      serverMatched: false,
      connected: null,
      deviceCount: 0
    });
  } finally {
    clearTimeoutImpl(timer);
  }
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

/**
 * Resolves the one authoritative music target used by every Pushcut path.
 * Version X's saved state is already sanitized, but this boundary remains
 * defensive because its output is forwarded to an iPhone Shortcut.
 */
export function canonicalPushcutXMusicPercent(state, fallback = 30) {
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber)
    ? Math.max(0, Math.min(100, fallbackNumber))
    : 30;
  const raw = state?.config?.musicLevel;
  if (raw == null || raw === '') return safeFallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return safeFallback;
  return Math.max(0, Math.min(100, value));
}

export function pushcutXVolumeLevels(musicPercent) {
  const safeMusicPercent = canonicalPushcutXMusicPercent({
    config: { musicLevel: musicPercent }
  });
  return Object.freeze({
    voicePercent: 100,
    musicPercent: safeMusicPercent,
    announcementLevel: 1,
    musicLevel: Number((safeMusicPercent / 100).toFixed(6))
  });
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

function announcementSource(body) {
  const mode = body.announcementMode == null || body.announcementMode === ''
    ? 'natural-voice'
    : String(body.announcementMode).trim().toLowerCase();
  const provider = String(body.announcementProvider || '').trim().toLowerCase();
  const sourceUrl = String(body.announcementAudioUrl || '').trim();
  const rawDuration = body.announcementDurationSeconds;

  if (mode === 'natural-voice') {
    if (provider || sourceUrl || (rawDuration != null && rawDuration !== '')) invalid();
    return Object.freeze({
      announcementMode: 'natural-voice',
      announcementProvider: '',
      announcementAudioUrl: '',
      announcementDurationSeconds: 0
    });
  }
  if (mode !== 'finite-audio') invalid();
  if (
    !Number.isInteger(rawDuration)
    || rawDuration < 1
    || rawDuration > FINITE_AUDIO_X_MAX_SECONDS
  ) invalid();
  let reference;
  try {
    reference = normalizeFiniteAudioReference(provider, sourceUrl);
  } catch {
    invalid();
  }
  return Object.freeze({
    announcementMode: 'finite-audio',
    announcementProvider: reference.provider,
    announcementAudioUrl: reference.sourceUrl,
    announcementDurationSeconds: rawDuration
  });
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
  percent(body.voicePercent, 100);
  const musicPercent = percent(body.musicPercent, 30);
  const source = announcementSource(body);
  return Object.freeze({
    ...commandBase('announce', eventId, issuedAt),
    source: 'live',
    ...source,
    text: announcementText(body.text),
    label: announcementLabel(body.label),
    safety: body.safety,
    voicePercent: 100,
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
  // The first Automatic Receiver browser build tagged the otherwise-valid
  // live envelope with action=announce. Accept that exact transitional shape
  // so an already-open Receiver page keeps working while its new bundle loads.
  if (
    body.action === 'announce'
    && Object.hasOwn(body, 'eventId')
    && Object.keys(body).every(
      key => key === 'action' || LIVE_ANNOUNCEMENT_FIELDS.has(key)
    )
  ) {
    const liveBody = { ...body };
    delete liveBody.action;
    return normalizeLiveAnnouncement(liveBody, { idFactory, issuedAt });
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
      announcementMode: 'natural-voice',
      announcementProvider: '',
      announcementAudioUrl: '',
      announcementDurationSeconds: 0,
      text: 'Poolside Pulse X receiver test.',
      label: 'Receiver Test',
      safety: false,
      voicePercent: 100,
      musicPercent: 30,
      resumeMusic: true
    });
  }

  percent(body.announcementVolume, 100);
  const musicPercent = percent(body.musicVolume, 30);
  const requestedResumeMusic = body.resumeMusic == null ? true : body.resumeMusic;
  if (typeof requestedResumeMusic !== 'boolean') invalid();
  const source = announcementSource(body);

  return Object.freeze({
    ...base,
    source: 'live',
    ...source,
    text: announcementText(body.text),
    label: 'Speak Now',
    safety: false,
    voicePercent: 100,
    musicPercent,
    // Version X has one universal contract: every announcement restores and
    // resumes the music bed. Accept the legacy field shape, but never allow an
    // older client to opt out of the final resume step.
    resumeMusic: true
  });
}

function shortcutFor(command, configured) {
  const action = String(command?.action || '');
  if (!ACTION_SET.has(action)) throw new PushcutXError('invalid');
  const shortcut = configured.shortcuts[action];
  if (!configured.apiKey || !shortcut) throw new PushcutXError('notConfigured');
  return shortcut;
}

async function executeShortcut({
  apiKey,
  apiUrl,
  fetchImpl,
  input,
  shortcut,
  timeout,
  upstreamTimeoutMs,
  AbortControllerImpl,
  setTimeoutImpl,
  clearTimeoutImpl
}) {
  const endpoint = new URL(String(apiUrl));
  endpoint.search = '';
  endpoint.searchParams.set('shortcut', shortcut);
  endpoint.searchParams.set('timeout', String(timeout));
  const controller = new AbortControllerImpl();
  const timer = setTimeoutImpl(() => controller.abort(), upstreamTimeoutMs);
  try {
    return await fetchImpl(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'API-Key': apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({
        input
      })
    });
  } catch (error) {
    if (controller.signal?.aborted && error?.name !== 'AbortError') {
      const timeoutError = new Error('Pushcut request timed out.');
      timeoutError.name = 'AbortError';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeoutImpl(timer);
  }
}

function dispatchError(code, recovery, providerStatus = 0) {
  const error = new PushcutXError(code);
  error.recoveryQueued = recovery?.queued === true;
  error.recoveryAcceptedAt = Number(recovery?.acceptedAt || 0);
  error.providerStatus = Number(providerStatus || 0);
  return error;
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
  clearTimeoutImpl = globalThis.clearTimeout,
  now = Date.now
} = {}) {
  if (!isRecord(command) || !ACTION_SET.has(command.action)) throw new PushcutXError('invalid');
  const configured = configuration(env);
  const shortcut = shortcutFor(command, configured);
  if (typeof fetchImpl !== 'function' || typeof AbortControllerImpl !== 'function') {
    throw new PushcutXError('providerRejected');
  }

  // A nowait response is always 202, even when the Shortcut later fails.
  // Waiting the standard ten seconds makes Pushcut expose missing/disabled
  // Shortcuts and disconnected receivers while remaining plan-compatible.
  const waitForResult = true;
  let response;
  logPushcutXEvent('provider_dispatch_started', {
    action: command.action,
    eventId: command.eventId,
    mode: 'wait'
  }, env);
  try {
    response = await executeShortcut({
      apiKey: configured.apiKey,
      apiUrl,
      fetchImpl,
      input: command,
      shortcut,
      timeout: String(PUSHCUT_X_TEST_WAIT_SECONDS),
      upstreamTimeoutMs,
      AbortControllerImpl,
      setTimeoutImpl,
      clearTimeoutImpl
    });
  } catch (error) {
    // A transport timeout does not prove the announcement Shortcut stopped.
    // Do not enqueue a restore that could run before voice completion. The v4
    // receiver Shortcut owns the exact post-playback restore and proves it in
    // its signed receipt.
    const recovery = Object.freeze({ queued: false, acceptedAt: 0 });
    logPushcutXEvent('provider_dispatch_transport_failed', {
      action: command.action,
      eventId: command.eventId,
      mode: 'wait',
      providerCategory: error?.name === 'AbortError' ? 'timeout' : 'transport',
      recoveryQueued: recovery.queued
    }, env);
    throw dispatchError(
      error?.name === 'AbortError' ? 'timeout' : 'providerRejected',
      recovery
    );
  }

  const status = Number(response?.status);
  logPushcutXEvent('provider_dispatch_response', {
    action: command.action,
    eventId: command.eventId,
    mode: 'wait',
    providerStatus: status
  }, env);
  if (responseOk(response)) {
    const recovery = Object.freeze({ queued: false, acceptedAt: 0 });
    return Object.freeze({
      accepted: true,
      completed: waitForResult && status === 200,
      action: command.action,
      commandId: command.commandId,
      eventId: command.eventId,
      mode: 'wait',
      providerStatus: status,
      recoveryQueued: recovery.queued,
      recoveryAcceptedAt: recovery.acceptedAt
    });
  }
  if (status === 504) {
    // Pushcut may still be running or may have queued the Shortcut. Restoring
    // here would violate M -> 0 -> voice -> M if the provider is merely late.
    const recovery = Object.freeze({ queued: false, acceptedAt: 0 });
    throw dispatchError('timeout', recovery, status);
  }
  if (status === 429) throw dispatchError('providerBusy', null, status);
  if (status === 401 || status === 403) {
    throw dispatchError('providerRejected', null, status);
  }
  const recovery = Object.freeze({ queued: false, acceptedAt: 0 });
  throw dispatchError('providerRejected', recovery, status);
}
