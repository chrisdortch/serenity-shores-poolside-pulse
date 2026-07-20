import {
  createPushcutXCapability,
  pushcutXPublicBaseUrl
} from './_pushcut-security-x.js';
import {
  createHash,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';

import { validPushcutXEventId } from './_pushcut-x.js';
import {
  versionXStorageKey,
  versionXStorageNamespace,
  versionXStorageTag
} from './_version-x-namespace.js';

export const EMAIL_WAKE_X_PAIRING_TTL_SECONDS = 10 * 60;
export const EMAIL_WAKE_X_CLAIM_LEASE_MS = 5 * 60 * 1000;
export const EMAIL_WAKE_X_BROWSER_AUDIO_LEASE_MS = 2 * 60 * 1000;
export const EMAIL_WAKE_X_MAX_ANNOUNCEMENT_ATTEMPTS = 3;
export const EMAIL_WAKE_X_RECOVERY_ATTEMPT = 4;
export const EMAIL_WAKE_X_RECOVERY_FAST_RETRY_MS = 15 * 60 * 1000;
export const EMAIL_WAKE_X_RECOVERY_STEADY_RETRY_MS = 60 * 60 * 1000;
export const EMAIL_WAKE_X_SCHEDULE_HORIZON_DAYS = 29;
export const EMAIL_WAKE_X_RESEND_URL = 'https://api.resend.com/emails';
export const EMAIL_WAKE_X_MANIFEST_KEY = versionXStorageKey(
  'serenity-shores-poolside-pulse:vx:email-wake:v1:manifest'
);
export const EMAIL_WAKE_X_RECEIVER_CONTRACT = 'poolside-pulse-x-wake-v1';

const KEY_TAG = versionXStorageTag('poolside-pulse-vx-email-wake');
const STORAGE_NAMESPACE = versionXStorageNamespace();
const PAIRING_KEY_PREFIX = `${KEY_TAG}:pair:`;
const PAIRING_ACTIVE_KEY = `${KEY_TAG}:pair:active`;
const PAIRING_ATTEMPT_KEY_PREFIX = `${KEY_TAG}:pair-attempt:`;
const RECEIVER_KEY = `${KEY_TAG}:receiver:active`;
const RECEIVER_EXECUTION_KEY = `${KEY_TAG}:receiver:execution`;
const QUEUE_KEY = `${KEY_TAG}:queue`;
const COMMAND_KEY_PREFIX = `${KEY_TAG}:command:`;
const MANIFEST_LOCK_KEY = `${KEY_TAG}:manifest-lock`;
const COMMAND_MAX_TTL_SECONDS = 31 * 24 * 60 * 60;
const COMMAND_MIN_TTL_SECONDS = 24 * 60 * 60;
const KV_TIMEOUT_MS = 8_000;
const RESEND_TIMEOUT_MS = 12_000;
const MANIFEST_LOCK_SECONDS = 300;
const PAIRING_CODE_PATTERN = /^\d{6}$/;
const RECEIVER_TOKEN_PATTERN = /^ppxrx_[A-Za-z0-9_-]{40,60}$/;
const BROWSER_AUDIO_LEASE_PATTERN =
  /^browser-audio-[A-Za-z0-9][A-Za-z0-9._:-]{15,143}$/;

const ENQUEUE_SCRIPT = `
local existing = redis.call("GET", KEYS[1])
if existing then
  return {0, existing}
end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
return {1, ARGV[1]}
`;

const CLAIM_SCRIPT = `
local now = tonumber(ARGV[1]) or 0
local lease = tonumber(ARGV[2]) or 0
local prefix = ARGV[3]
local fallbackTtl = tonumber(ARGV[4]) or 86400
local executionLease = tonumber(ARGV[5]) or lease
local recoveryAttempt = tonumber(ARGV[6]) or 4
local recoveryFastLease = tonumber(ARGV[7]) or lease
local recoverySteadyLease = tonumber(ARGV[8]) or recoveryFastLease
if redis.call("GET", KEYS[2]) then
  return cjson.encode({busy = true})
end
local candidates = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", now, "LIMIT", 0, 20)
for _, eventId in ipairs(candidates) do
  local commandKey = prefix .. eventId
  local raw = redis.call("GET", commandKey)
  if not raw then
    redis.call("ZREM", KEYS[1], eventId)
  else
    local decodedOk, item = pcall(cjson.decode, raw)
    if not decodedOk or type(item) ~= "table" then
      redis.call("ZREM", KEYS[1], eventId)
      redis.call("DEL", commandKey)
    else
      local status = tostring(item.status or "queued")
      local leaseUntil = tonumber(item.leaseUntil or 0) or 0
      if status == "queued" or (status == "claimed" and leaseUntil <= now) then
        local claimAttempt = (tonumber(item.claimAttempt or 0) or 0) + 1
        local effectiveLease = executionLease
        local action = type(item.command) == "table"
          and tostring(item.command.action or "") or ""
        if action ~= "volume" and claimAttempt == recoveryAttempt + 1 then
          effectiveLease = math.max(effectiveLease, recoveryFastLease)
        elseif action ~= "volume" and claimAttempt >= recoveryAttempt + 2 then
          effectiveLease = math.max(effectiveLease, recoverySteadyLease)
        end
        item.status = "claimed"
        item.claimedAt = now
        item.leaseUntil = now + effectiveLease
        item.claimAttempt = claimAttempt
        local ttl = redis.call("TTL", commandKey)
        if not ttl or ttl < fallbackTtl then ttl = fallbackTtl end
        local encoded = cjson.encode(item)
        if action ~= "volume" and claimAttempt >= recoveryAttempt then
          redis.call("SET", commandKey, encoded)
          redis.call("PERSIST", commandKey)
        else
          redis.call("SET", commandKey, encoded, "EX", ttl)
        end
        redis.call("SET", KEYS[2], eventId, "PX", effectiveLease)
        return encoded
      end
    end
  end
end
return ""
`;

const DELETE_COMMAND_SCRIPT = `
redis.call("ZREM", KEYS[1], ARGV[1])
local removed = redis.call("DEL", KEYS[2])
if redis.call("GET", KEYS[3]) == ARGV[1] then
  redis.call("DEL", KEYS[3])
end
return removed
`;

const REQUEUE_COMMAND_SCRIPT = `
local raw = redis.call("GET", KEYS[2])
if not raw then
  return cjson.encode({requeued = false, reason = "missing"})
end
local decodedOk, item = pcall(cjson.decode, raw)
if not decodedOk or type(item) ~= "table" then
  return cjson.encode({requeued = false, reason = "invalid"})
end
local expectedAttempt = tonumber(ARGV[2] or 0) or 0
local currentAttempt = tonumber(item.claimAttempt or 0) or 0
local status = tostring(item.status or "")
if status ~= "claimed" then
  return cjson.encode({requeued = false, reason = "status", item = item})
end
if expectedAttempt <= 0 or currentAttempt ~= expectedAttempt then
  return cjson.encode({requeued = false, reason = "stale", item = item})
end
item.status = "queued"
item.claimedAt = 0
item.leaseUntil = 0
item.claimAttempt = math.max(expectedAttempt - 1, 0)
item.readyAt = tonumber(ARGV[3] or 0) or 0
local encoded = cjson.encode(item)
local ttl = redis.call("TTL", KEYS[2])
if ttl and ttl > 0 then
  redis.call("SET", KEYS[2], encoded, "EX", ttl)
elseif currentAttempt >= (tonumber(ARGV[5] or 4) or 4) then
  redis.call("SET", KEYS[2], encoded)
  redis.call("PERSIST", KEYS[2])
else
  redis.call("SET", KEYS[2], encoded, "EX", tonumber(ARGV[4] or 86400) or 86400)
end
local score = tonumber(item.notBefore or 0) or 0
if score <= 0 then score = tonumber(ARGV[3] or 0) or 0 end
redis.call("ZADD", KEYS[1], score, ARGV[1])
if redis.call("GET", KEYS[3]) == ARGV[1] then
  redis.call("DEL", KEYS[3])
end
return cjson.encode({requeued = true, reason = "", item = item})
`;

const ACTIVATE_COMMAND_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return ""
end
local decodedOk, item = pcall(cjson.decode, raw)
if not decodedOk or type(item) ~= "table" then
  return ""
end
local status = tostring(item.status or "pending")
if status == "pending" then
  item.status = "queued"
  item.readyAt = tonumber(ARGV[1]) or 0
  local ttl = redis.call("TTL", KEYS[1])
  if not ttl or ttl < 1 then ttl = tonumber(ARGV[2]) or 86400 end
  local encoded = cjson.encode(item)
  redis.call("SET", KEYS[1], encoded, "EX", ttl)
  local score = tonumber(item.notBefore or 0) or 0
  if score <= 0 then score = tonumber(ARGV[1]) or 0 end
  redis.call("ZADD", KEYS[2], score, ARGV[3])
  return encoded
end
return raw
`;

const RELEASE_EXECUTION_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const CLAIM_BROWSER_EXECUTION_SCRIPT = `
local current = tostring(redis.call("GET", KEYS[1]) or "")
local requested = tostring(ARGV[1] or "")
local lease = tonumber(ARGV[2]) or 0
if current ~= "" and current ~= requested then
  local remaining = tonumber(redis.call("PTTL", KEYS[1]) or 0) or 0
  return cjson.encode({
    acquired = false,
    busy = true,
    owner = current,
    remainingMs = math.max(remaining, 0)
  })
end
redis.call("SET", KEYS[1], requested, "PX", lease)
return cjson.encode({
  acquired = true,
  busy = false,
  owner = requested,
  remainingMs = lease
})
`;

const EXCHANGE_PAIRING_SCRIPT = `
if redis.call("GET", KEYS[2]) ~= KEYS[1] then
  return 0
end
local raw = redis.call("GET", KEYS[1])
if not raw then
  return 0
end
redis.call("DEL", KEYS[1])
redis.call("DEL", KEYS[2])
redis.call("SET", KEYS[3], ARGV[1])
return 1
`;

const CREATE_PAIRING_SCRIPT = `
local previous = redis.call("GET", KEYS[2])
if previous then redis.call("DEL", previous) end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], KEYS[1], "EX", ARGV[2])
return "OK"
`;

const PAIRING_ATTEMPT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return count
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const SAFE_ERRORS = Object.freeze({
  invalid: Object.freeze({
    statusCode: 400,
    message: 'The Version X email receiver request is invalid.'
  }),
  unauthorized: Object.freeze({
    statusCode: 401,
    message: 'The Version X receiver token is invalid.'
  }),
  pairingExpired: Object.freeze({
    statusCode: 401,
    message: 'That pairing code is invalid or has expired.'
  }),
  conflict: Object.freeze({
    statusCode: 409,
    message: 'That Version X announcement identifier is already in use.'
  }),
  locked: Object.freeze({
    statusCode: 409,
    message: 'Another Version X email schedule sync is already running.'
  }),
  notConfigured: Object.freeze({
    statusCode: 503,
    message: 'The Version X email wake receiver is not configured.'
  }),
  durableUnavailable: Object.freeze({
    statusCode: 503,
    message: 'Durable Version X email wake storage is unavailable.'
  }),
  providerRejected: Object.freeze({
    statusCode: 502,
    message: 'Resend rejected the receiver wake email. Verify the sender domain, receiver address, and Resend account permissions.'
  }),
  providerInvalidApiKey: Object.freeze({
    statusCode: 502,
    message: 'The Resend API key is invalid or revoked. Replace RESEND_API_KEY_X with a valid key.'
  }),
  providerTestSenderRestricted: Object.freeze({
    statusCode: 502,
    message: 'Resend test mode can deliver only to the Resend account email. Use that address for RECEIVER_WAKE_EMAIL_X, or verify a sending domain and update RECEIVER_WAKE_FROM_X.'
  }),
  providerUnavailable: Object.freeze({
    statusCode: 503,
    message: 'The receiver wake email service is temporarily unavailable.'
  })
});

export class EmailWakeXError extends Error {
  constructor(code) {
    const safe = SAFE_ERRORS[code] || SAFE_ERRORS.providerUnavailable;
    super(safe.message);
    this.name = 'EmailWakeXError';
    this.code = Object.hasOwn(SAFE_ERRORS, code) ? code : 'providerUnavailable';
    this.statusCode = safe.statusCode;
  }
}

function fail(code) {
  throw new EmailWakeXError(code);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function emailWakeXNamespacedHashInput(value, env = process.env) {
  const legacyInput = String(value);
  const namespace = versionXStorageNamespace(env);
  return namespace
    ? `${legacyInput}\0poolside-x-namespace:${namespace}`
    : legacyInput;
}

export function emailWakeXResendIdempotencyKey(eventId, env = process.env) {
  const namespace = versionXStorageNamespace(env);
  return namespace
    ? `poolside-pulse-x-wake-${namespace}-${eventId}`
    : `poolside-pulse-x-wake-${eventId}`;
}

function clean(value, maximum) {
  const text = String(value || '').trim();
  return !text || text.length > maximum || /[\r\n]/.test(text) ? '' : text;
}

function emailAddress(value) {
  const text = clean(value, 320);
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(text) ? text : '';
}

function senderAddress(value) {
  const text = clean(value, 320);
  if (!text) return '';
  return senderMailbox(text) ? text : '';
}

function senderMailbox(value) {
  const text = clean(value, 320);
  if (!text) return '';
  const bracketed = /<([^<>]+)>$/.exec(text);
  return emailAddress(bracketed ? bracketed[1] : text);
}

function configuration(env) {
  const source = env && typeof env === 'object' ? env : {};
  return Object.freeze({
    apiKey: clean(source.RESEND_API_KEY_X, 4_096),
    to: emailAddress(source.RECEIVER_WAKE_EMAIL_X),
    from: senderAddress(source.RECEIVER_WAKE_FROM_X),
    subject: clean(source.RECEIVER_WAKE_SUBJECT_X, 180),
    kvUrl: clean(source.KV_REST_API_URL, 2_048),
    kvToken: clean(source.KV_REST_API_TOKEN, 4_096)
  });
}

export function emailWakeXHealth(env = process.env) {
  const configured = configuration(env);
  const durable = Boolean(configured.kvUrl && configured.kvToken);
  const wakeReady = Boolean(
    configured.apiKey
    && configured.to
    && configured.from
    && configured.subject
  );
  const configurationIssues = [];
  if (!configured.kvUrl || !configured.kvToken) {
    configurationIssues.push(
      'Durable Receiver storage is missing KV_REST_API_URL or KV_REST_API_TOKEN.'
    );
  }
  if (!configured.apiKey) {
    configurationIssues.push(
      'Receiver wake email is missing RESEND_API_KEY_X.'
    );
  }
  if (!configured.to) {
    configurationIssues.push(
      'Receiver wake email is missing a valid RECEIVER_WAKE_EMAIL_X address.'
    );
  }
  if (!configured.from) {
    configurationIssues.push(
      'Receiver wake email is missing a valid RECEIVER_WAKE_FROM_X sender.'
    );
  }
  if (!configured.subject) {
    configurationIssues.push(
      'Receiver wake email is missing RECEIVER_WAKE_SUBJECT_X.'
    );
  }
  return Object.freeze({
    ready: durable && wakeReady,
    durable,
    queueReady: durable,
    pairingReady: durable,
    wakeReady,
    provider: 'resend',
    transport: 'email-wake-x',
    scheduleHorizonDays: EMAIL_WAKE_X_SCHEDULE_HORIZON_DAYS,
    configurationIssues: Object.freeze(configurationIssues)
  });
}

function dependencies(options = {}) {
  return {
    env: options.env || process.env,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    AbortControllerImpl: options.AbortControllerImpl || globalThis.AbortController,
    setTimeoutImpl: options.setTimeoutImpl || globalThis.setTimeout,
    clearTimeoutImpl: options.clearTimeoutImpl || globalThis.clearTimeout,
    consoleErrorImpl: typeof options.consoleErrorImpl === 'function'
      ? options.consoleErrorImpl
      : entry => console.error(JSON.stringify(entry)),
    now: options.now || Date.now
  };
}

async function kv(command, deps) {
  const configured = configuration(deps.env);
  if (
    !configured.kvUrl
    || !configured.kvToken
    || typeof deps.fetchImpl !== 'function'
    || typeof deps.AbortControllerImpl !== 'function'
  ) fail('durableUnavailable');
  const controller = new deps.AbortControllerImpl();
  const timer = deps.setTimeoutImpl(() => controller.abort(), KV_TIMEOUT_MS);
  try {
    const response = await deps.fetchImpl(configured.kvUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${configured.kvToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) fail('durableUnavailable');
    return body.result;
  } catch (error) {
    if (error instanceof EmailWakeXError) throw error;
    fail('durableUnavailable');
  } finally {
    deps.clearTimeoutImpl(timer);
  }
}

function durableRequired(options, env) {
  if (typeof options.requireDurable === 'boolean') return options.requireDurable;
  return String(env?.VERCEL || '') === '1';
}

function durableReady(env) {
  const configured = configuration(env);
  return Boolean(configured.kvUrl && configured.kvToken);
}

function memory() {
  globalThis.__POOL_SIDE_X_EMAIL_WAKE__ ||= {
    pairings: new Map(),
    activePairingKey: '',
    pairingAttempts: new Map(),
    receiver: null,
    receiverExecution: null,
    commands: new Map(),
    manifest: null,
    locks: new Map()
  };
  const store = globalThis.__POOL_SIDE_X_EMAIL_WAKE__;
  store.locks ||= new Map();
  return store;
}

async function withMemoryLock(scope, operation) {
  const store = memory();
  const previous = store.locks.get(scope) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  store.locks.set(scope, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (store.locks.get(scope) === tail) store.locks.delete(scope);
  }
}

function hashSecret(context, value) {
  return createHash('sha256')
    .update(`serenity-shores-poolside-pulse:vx:email-wake:v1:${STORAGE_NAMESPACE}:${context}\0${String(value)}`)
    .digest('hex');
}

function equalText(left, right) {
  const a = createHash('sha256').update(String(left)).digest();
  const b = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(a, b);
}

function pairingKey(code) {
  return `${PAIRING_KEY_PREFIX}${hashSecret('pairing', code)}`;
}

function receiverRecord(token, now) {
  return {
    schemaVersion: 1,
    version: 'x',
    transport: 'email-wake-x',
    tokenHash: hashSecret('receiver', token),
    pairedAt: now
  };
}

export async function createEmailWakeXPairingCode(options = {}) {
  const deps = dependencies(options);
  const now = Number(deps.now());
  const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
  const record = {
    schemaVersion: 1,
    createdAt: now,
    expiresAt: now + EMAIL_WAKE_X_PAIRING_TTL_SECONDS * 1000
  };
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) fail('durableUnavailable');
  if (durable) {
    await kv([
      'EVAL',
      CREATE_PAIRING_SCRIPT,
      '2',
      pairingKey(code),
      PAIRING_ACTIVE_KEY,
      JSON.stringify(record),
      String(EMAIL_WAKE_X_PAIRING_TTL_SECONDS)
    ], deps);
  } else {
    const store = memory();
    if (store.activePairingKey) store.pairings.delete(store.activePairingKey);
    store.activePairingKey = pairingKey(code);
    store.pairings.set(store.activePairingKey, record);
  }
  return Object.freeze({
    pairingCode: code,
    expiresAt: record.expiresAt,
    durable
  });
}

export async function exchangeEmailWakeXPairingCode(codeInput, options = {}) {
  const code = String(codeInput || '').trim();
  if (!PAIRING_CODE_PATTERN.test(code)) fail('pairingExpired');
  const deps = dependencies(options);
  const now = Number(deps.now());
  const token = `ppxrx_${randomBytes(32).toString('base64url')}`;
  const record = receiverRecord(token, now);
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) fail('durableUnavailable');
  let exchanged = false;
  if (durable) {
    exchanged = Number(await kv([
      'EVAL',
      EXCHANGE_PAIRING_SCRIPT,
      '3',
      pairingKey(code),
      PAIRING_ACTIVE_KEY,
      RECEIVER_KEY,
      JSON.stringify(record)
    ], deps)) === 1;
  } else {
    exchanged = await withMemoryLock('pairing', async () => {
      const store = memory();
      const key = pairingKey(code);
      const pairing = store.pairings.get(key);
      store.pairings.delete(key);
      if (
        store.activePairingKey !== key
        || !pairing
        || Number(pairing.expiresAt || 0) <= now
      ) return false;
      store.activePairingKey = '';
      store.receiver = record;
      return true;
    });
  }
  if (!exchanged) fail('pairingExpired');
  return Object.freeze({
    receiverToken: token,
    pairedAt: now,
    durable
  });
}

export async function consumeEmailWakeXPairingAttempt(
  identifier,
  {
    limit = 10,
    windowSeconds = 15 * 60,
    ...options
  } = {}
) {
  const cleanIdentifier = String(identifier || '').trim();
  if (!cleanIdentifier) fail('invalid');
  const deps = dependencies(options);
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) fail('durableUnavailable');
  const key = `${PAIRING_ATTEMPT_KEY_PREFIX}${hashSecret('attempt', cleanIdentifier)}`;
  let count;
  if (durable) {
    count = Number(await kv([
      'EVAL',
      PAIRING_ATTEMPT_SCRIPT,
      '1',
      key,
      String(Math.max(60, Math.floor(windowSeconds)))
    ], deps));
  } else {
    const now = Number(deps.now());
    const current = memory().pairingAttempts.get(key);
    const entry = !current || current.expiresAt <= now
      ? { count: 1, expiresAt: now + windowSeconds * 1000 }
      : { ...current, count: current.count + 1 };
    memory().pairingAttempts.set(key, entry);
    count = entry.count;
  }
  return Object.freeze({
    allowed: count <= limit,
    remaining: Math.max(0, limit - count)
  });
}

export async function emailWakeXReceiverStatus(options = {}) {
  const deps = dependencies(options);
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) fail('durableUnavailable');
  const record = durable
    ? parseRecord(await kv(['GET', RECEIVER_KEY], deps))
    : memory().receiver;
  return Object.freeze({
    receiverPaired: Boolean(record?.tokenHash),
    pairedAt: Number(record?.pairedAt || 0),
    durable
  });
}

export async function emailWakeXExecutionStatus(options = {}) {
  const deps = dependencies(options);
  const now = Number(deps.now());
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) {
    fail('durableUnavailable');
  }
  if (durable) {
    const [eventId, ttlMs] = await Promise.all([
      kv(['GET', RECEIVER_EXECUTION_KEY], deps),
      kv(['PTTL', RECEIVER_EXECUTION_KEY], deps)
    ]);
    const cleanEventId = String(eventId || '').trim();
    const remainingMs = Math.max(0, Number(ttlMs || 0));
    return Object.freeze({
      executionActive:
        validPushcutXEventId(cleanEventId)
        && remainingMs > 0,
      executionEventId:
        validPushcutXEventId(cleanEventId)
          ? cleanEventId
          : '',
      executionLeaseUntil:
        remainingMs > 0
          ? now + remainingMs
          : 0,
      durable: true
    });
  }
  const active = memory().receiverExecution;
  const activeUntil = Number(active?.expiresAt || 0);
  const activeEventId = String(active?.eventId || '');
  return Object.freeze({
    executionActive:
      validPushcutXEventId(activeEventId)
      && activeUntil > now,
    executionEventId:
      validPushcutXEventId(activeEventId)
        ? activeEventId
        : '',
    executionLeaseUntil:
      activeUntil > now
        ? activeUntil
        : 0,
    durable: false
  });
}

export function validEmailWakeXBrowserAudioLeaseId(value) {
  return BROWSER_AUDIO_LEASE_PATTERN.test(String(value || '').trim());
}

/**
 * Acquires the same short-lived execution key used by the background Receiver
 * Shortcut. Browser audio mutations hold this lease while they start, stop, or
 * switch a native music source; the Shortcut claim is therefore unable to
 * begin between a browser-side "is busy" check and the actual media command.
 *
 * Reclaiming the same lease id renews it. A different owner is never replaced.
 */
export async function claimEmailWakeXBrowserExecution(leaseId, options = {}) {
  const cleanLeaseId = String(leaseId || '').trim();
  if (!validEmailWakeXBrowserAudioLeaseId(cleanLeaseId)) fail('invalid');
  const deps = dependencies(options);
  const now = Number(deps.now());
  const leaseMs = Math.max(
    30_000,
    Math.min(
      EMAIL_WAKE_X_CLAIM_LEASE_MS,
      Number(options.leaseMs) || EMAIL_WAKE_X_BROWSER_AUDIO_LEASE_MS
    )
  );
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) {
    fail('durableUnavailable');
  }
  if (durable) {
    const result = parseRecord(await kv([
      'EVAL',
      CLAIM_BROWSER_EXECUTION_SCRIPT,
      '1',
      RECEIVER_EXECUTION_KEY,
      cleanLeaseId,
      String(leaseMs)
    ], deps));
    if (!result) fail('durableUnavailable');
    const remainingMs = Math.max(0, Number(result.remainingMs || 0));
    return Object.freeze({
      acquired: result.acquired === true,
      busy: result.busy === true,
      leaseId: cleanLeaseId,
      owner: String(result.owner || ''),
      leaseUntil: remainingMs > 0 ? now + remainingMs : 0,
      durable: true
    });
  }
  return await withMemoryLock('queue', async () => {
    const active = memory().receiverExecution;
    const activeUntil = Number(active?.expiresAt || 0);
    const activeOwner = String(active?.eventId || '');
    if (
      activeOwner
      && activeOwner !== cleanLeaseId
      && activeUntil > now
    ) {
      return Object.freeze({
        acquired: false,
        busy: true,
        leaseId: cleanLeaseId,
        owner: activeOwner,
        leaseUntil: activeUntil,
        durable: false
      });
    }
    memory().receiverExecution = {
      eventId: cleanLeaseId,
      expiresAt: now + leaseMs
    };
    return Object.freeze({
      acquired: true,
      busy: false,
      leaseId: cleanLeaseId,
      owner: cleanLeaseId,
      leaseUntil: now + leaseMs,
      durable: false
    });
  });
}

export function emailWakeXSetup(env = process.env) {
  const configured = configuration(env);
  return Object.freeze({
    // iOS Email automation's Sender field needs the mailbox, not a display
    // name such as "Poolside Pulse X <onboarding@resend.dev>".
    wakeSender: senderMailbox(configured.from),
    wakeSubject: configured.subject,
    // This is returned only through the authenticated Version X status route.
    // Showing it lets the Receiver owner confirm that this exact account is
    // actually present in Apple Mail before relying on the Email automation.
    wakeRecipient: configured.to
  });
}

export async function authenticateEmailWakeXReceiver(tokenInput, options = {}) {
  const token = String(tokenInput || '').trim();
  if (!RECEIVER_TOKEN_PATTERN.test(token)) return false;
  const deps = dependencies(options);
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) fail('durableUnavailable');
  const record = durable
    ? parseRecord(await kv(['GET', RECEIVER_KEY], deps))
    : memory().receiver;
  return Boolean(record?.tokenHash && equalText(record.tokenHash, hashSecret('receiver', token)));
}

function commandKey(eventId) {
  if (!validPushcutXEventId(eventId)) fail('invalid');
  return `${COMMAND_KEY_PREFIX}${String(eventId).trim()}`;
}

function parseRecord(value) {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseEnqueueResult(value) {
  if (!Array.isArray(value) || value.length < 2) fail('durableUnavailable');
  const item = parseRecord(value[1]);
  if (!item) fail('durableUnavailable');
  return {
    created: Number(value[0]) === 1,
    item
  };
}

function queueItem(command, now, ttlSeconds) {
  if (!isRecord(command) || !validPushcutXEventId(command.eventId)) fail('invalid');
  const scheduledFor = Number(command.scheduledFor || 0);
  const notBefore = scheduledFor || 0;
  if (
    !Number.isSafeInteger(notBefore)
    || notBefore < 0
    || (scheduledFor > 0 && scheduledFor < now)
    || notBefore > now + EMAIL_WAKE_X_SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000
  ) fail('invalid');
  return {
    schemaVersion: 1,
    version: 'x',
    transport: 'email-wake-x',
    eventId: command.eventId,
    notBefore,
    status: 'pending',
    queuedAt: now,
    readyAt: 0,
    claimedAt: 0,
    claimAttempt: 0,
    leaseUntil: 0,
    expiresAt: now + ttlSeconds * 1000,
    command
  };
}

function compatibleQueueItem(existing, candidate) {
  const {
    issuedAt: _existingIssuedAt,
    ...existingCommand
  } = existing?.command || {};
  const {
    issuedAt: _candidateIssuedAt,
    ...candidateCommand
  } = candidate.command;
  if (
    existing?.eventId !== candidate.eventId
    || Number(existing?.notBefore || 0) !== candidate.notBefore
    || JSON.stringify(existingCommand) !== JSON.stringify(candidateCommand)
  ) fail('conflict');
  return existing;
}

export async function enqueueEmailWakeXCommand(command, options = {}) {
  const deps = dependencies(options);
  const now = Number(deps.now());
  const scheduledFor = Number(command?.scheduledFor || now);
  const requestedTtl = scheduledFor > now
    ? Math.ceil((scheduledFor - now) / 1000) + COMMAND_MIN_TTL_SECONDS
    : COMMAND_MIN_TTL_SECONDS;
  const ttlSeconds = Math.max(
    COMMAND_MIN_TTL_SECONDS,
    Math.min(COMMAND_MAX_TTL_SECONDS, Math.floor(Number(options.ttlSeconds) || requestedTtl))
  );
  const candidate = queueItem(command, now, ttlSeconds);
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) fail('durableUnavailable');
  if (durable) {
    const result = parseEnqueueResult(await kv([
      'EVAL',
      ENQUEUE_SCRIPT,
      '1',
      commandKey(candidate.eventId),
      JSON.stringify(candidate),
      String(ttlSeconds)
    ], deps));
    return Object.freeze({
      created: result.created,
      item: compatibleQueueItem(result.item, candidate),
      durable: true
    });
  }
  return await withMemoryLock('queue', async () => {
    const store = memory();
    const existing = store.commands.get(candidate.eventId);
    if (existing) {
      return Object.freeze({
        created: false,
        item: compatibleQueueItem(existing, candidate),
        durable: false
      });
    }
    store.commands.set(candidate.eventId, candidate);
    return Object.freeze({ created: true, item: candidate, durable: false });
  });
}

export async function activateEmailWakeXCommand(eventId, options = {}) {
  const deps = dependencies(options);
  const now = Number(deps.now());
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) fail('durableUnavailable');
  if (durable) {
    const item = parseRecord(await kv([
      'EVAL',
      ACTIVATE_COMMAND_SCRIPT,
      '2',
      commandKey(eventId),
      QUEUE_KEY,
      String(now),
      String(COMMAND_MIN_TTL_SECONDS),
      String(eventId)
    ], deps));
    if (!item) fail('durableUnavailable');
    return Object.freeze({ item, durable: true });
  }
  return await withMemoryLock('queue', async () => {
    const current = memory().commands.get(String(eventId));
    if (!current) fail('durableUnavailable');
    const item = current.status === 'pending'
      ? { ...current, status: 'queued', readyAt: now }
      : current;
    memory().commands.set(String(eventId), item);
    return Object.freeze({ item, durable: false });
  });
}

export function emailWakeXClaimLeaseMs(
  claimAttempt,
  action,
  requestedLeaseMs = EMAIL_WAKE_X_CLAIM_LEASE_MS
) {
  const attempt = Number(claimAttempt);
  const baseLeaseMs = Math.max(
    30_000,
    Math.min(
      10 * 60 * 1000,
      Number(requestedLeaseMs) || EMAIL_WAKE_X_CLAIM_LEASE_MS
    )
  );
  if (!Number.isSafeInteger(attempt) || attempt < 1) return baseLeaseMs;
  if (String(action || '') === 'volume') return baseLeaseMs;
  if (attempt === EMAIL_WAKE_X_RECOVERY_ATTEMPT + 1) {
    return Math.max(baseLeaseMs, EMAIL_WAKE_X_RECOVERY_FAST_RETRY_MS);
  }
  if (attempt >= EMAIL_WAKE_X_RECOVERY_ATTEMPT + 2) {
    return Math.max(baseLeaseMs, EMAIL_WAKE_X_RECOVERY_STEADY_RETRY_MS);
  }
  return baseLeaseMs;
}

export async function claimEmailWakeXCommand(options = {}) {
  const deps = dependencies(options);
  const now = Number(deps.now());
  const leaseMs = Math.max(
    30_000,
    Math.min(10 * 60 * 1000, Number(options.leaseMs) || EMAIL_WAKE_X_CLAIM_LEASE_MS)
  );
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) fail('durableUnavailable');
  if (durable) {
    const item = parseRecord(await kv([
      'EVAL',
      CLAIM_SCRIPT,
      '2',
      QUEUE_KEY,
      RECEIVER_EXECUTION_KEY,
      String(now),
      String(leaseMs),
      COMMAND_KEY_PREFIX,
      String(COMMAND_MIN_TTL_SECONDS),
      String(leaseMs),
      String(EMAIL_WAKE_X_RECOVERY_ATTEMPT),
      String(EMAIL_WAKE_X_RECOVERY_FAST_RETRY_MS),
      String(EMAIL_WAKE_X_RECOVERY_STEADY_RETRY_MS)
    ], deps));
    return item?.busy
      ? Object.freeze({ item: null, busy: true, durable: true })
      : item
        ? Object.freeze({ item, busy: false, durable: true })
        : null;
  }
  return await withMemoryLock('queue', async () => {
    const active = memory().receiverExecution;
    if (active && Number(active.expiresAt || 0) > now) {
      return Object.freeze({ item: null, busy: true, durable: false });
    }
    memory().receiverExecution = null;
    const candidates = [...memory().commands.values()]
      .filter(item => Number(item.notBefore || 0) <= now)
      .sort((left, right) => {
        const leftScore = Number(left.notBefore || left.readyAt || left.queuedAt);
        const rightScore = Number(right.notBefore || right.readyAt || right.queuedAt);
        return leftScore - rightScore || left.queuedAt - right.queuedAt;
      });
    for (const current of candidates) {
      if (
        current.status !== 'queued'
        && !(current.status === 'claimed' && Number(current.leaseUntil || 0) <= now)
      ) continue;
      const claimAttempt = Number(current.claimAttempt || 0) + 1;
      const effectiveLeaseMs = emailWakeXClaimLeaseMs(
        claimAttempt,
        current.command?.action,
        leaseMs
      );
      const item = {
        ...current,
        status: 'claimed',
        claimedAt: now,
        claimAttempt,
        leaseUntil: now + effectiveLeaseMs
      };
      memory().commands.set(item.eventId, item);
      memory().receiverExecution = {
        eventId: item.eventId,
        expiresAt: now + effectiveLeaseMs
      };
      return Object.freeze({ item, busy: false, durable: false });
    }
    return null;
  });
}

export async function removeEmailWakeXCommand(eventId, options = {}) {
  const deps = dependencies(options);
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) fail('durableUnavailable');
  if (durable) {
    await kv([
      'EVAL',
      DELETE_COMMAND_SCRIPT,
      '3',
      QUEUE_KEY,
      commandKey(eventId),
      RECEIVER_EXECUTION_KEY,
      String(eventId)
    ], deps);
    return true;
  }
  memory().commands.delete(String(eventId));
  if (memory().receiverExecution?.eventId === String(eventId)) {
    memory().receiverExecution = null;
  }
  return true;
}

/**
 * Rolls back only the exact active claim attempt. This is used when the
 * receiver watchdog could not be armed, before any playback mutation is
 * authorized. A stale handler can never requeue a newer execution attempt.
 */
export async function requeueEmailWakeXCommand(
  eventId,
  claimAttempt,
  options = {}
) {
  if (!validPushcutXEventId(eventId)) fail('invalid');
  const expectedAttempt = Number(claimAttempt);
  if (!Number.isSafeInteger(expectedAttempt) || expectedAttempt < 1) fail('invalid');
  const deps = dependencies(options);
  const now = Number(deps.now());
  if (!Number.isSafeInteger(now) || now < 0) fail('invalid');
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) fail('durableUnavailable');
  if (durable) {
    const result = parseRecord(await kv([
      'EVAL',
      REQUEUE_COMMAND_SCRIPT,
      '3',
      QUEUE_KEY,
      commandKey(eventId),
      RECEIVER_EXECUTION_KEY,
      String(eventId),
      String(expectedAttempt),
      String(now),
      String(COMMAND_MIN_TTL_SECONDS),
      String(EMAIL_WAKE_X_RECOVERY_ATTEMPT)
    ], deps));
    if (!result) fail('durableUnavailable');
    return Object.freeze({
      requeued: result.requeued === true,
      reason: String(result.reason || ''),
      item: isRecord(result.item) ? result.item : null,
      durable: true
    });
  }
  return await withMemoryLock('queue', async () => {
    const store = memory();
    const current = store.commands.get(String(eventId));
    if (!current) {
      return Object.freeze({
        requeued: false,
        reason: 'missing',
        item: null,
        durable: false
      });
    }
    if (
      current.status !== 'claimed'
      || Number(current.claimAttempt || 0) !== expectedAttempt
    ) {
      return Object.freeze({
        requeued: false,
        reason: current.status !== 'claimed' ? 'status' : 'stale',
        item: current,
        durable: false
      });
    }
    const item = {
      ...current,
      status: 'queued',
      claimedAt: 0,
      claimAttempt: Math.max(expectedAttempt - 1, 0),
      leaseUntil: 0,
      readyAt: now
    };
    store.commands.set(String(eventId), item);
    if (store.receiverExecution?.eventId === String(eventId)) {
      store.receiverExecution = null;
    }
    return Object.freeze({
      requeued: true,
      reason: '',
      item,
      durable: false
    });
  });
}

export async function releaseEmailWakeXExecution(eventId, options = {}) {
  if (!validPushcutXEventId(eventId)) fail('invalid');
  const deps = dependencies(options);
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) fail('durableUnavailable');
  if (durable) {
    await kv([
      'EVAL',
      RELEASE_EXECUTION_SCRIPT,
      '1',
      RECEIVER_EXECUTION_KEY,
      String(eventId)
    ], deps);
    return true;
  }
  await withMemoryLock('queue', async () => {
    if (memory().receiverExecution?.eventId === String(eventId)) {
      memory().receiverExecution = null;
    }
  });
  return true;
}

export async function nextReadyEmailWakeXEventId(options = {}) {
  const deps = dependencies(options);
  const now = Number(deps.now());
  const durable = durableReady(deps.env);
  if (!durable && durableRequired(options, deps.env)) fail('durableUnavailable');
  if (durable) {
    const result = await kv([
      'ZRANGEBYSCORE',
      QUEUE_KEY,
      '-inf',
      String(now),
      'LIMIT',
      '0',
      '1'
    ], deps);
    return String(Array.isArray(result) ? result[0] || '' : '').trim();
  }
  const next = [...memory().commands.values()]
    .filter(item => item.status === 'queued' && Number(item.notBefore || 0) <= now)
    .sort((left, right) => {
      const leftScore = Number(left.notBefore || left.readyAt || left.queuedAt);
      const rightScore = Number(right.notBefore || right.readyAt || right.queuedAt);
      return leftScore - rightScore || left.queuedAt - right.queuedAt;
    })[0];
  return String(next?.eventId || '');
}

const EMAIL_WAKE_CAPABILITY_PATHS = Object.freeze({
  audio: '/api/pushcut-audio-x',
  execute: '/api/email-wake-execute-x',
  receipt: '/api/email-wake-receipt-x',
  restore: '/api/email-wake-restore-x'
});

export function createSignedEmailWakeXUrl(
  req,
  pathname,
  eventId,
  purpose,
  options = {}
) {
  if (EMAIL_WAKE_CAPABILITY_PATHS[purpose] !== String(pathname || '')) return null;
  const baseUrl = pushcutXPublicBaseUrl(req, options.env || process.env);
  const capability = createPushcutXCapability(eventId, purpose, options);
  if (!baseUrl || !capability) return null;
  const url = new URL(pathname, baseUrl);
  url.searchParams.set('v', 'x');
  url.searchParams.set('eventId', capability.eventId);
  if (capability.version === 2) {
    url.searchParams.set('cv', String(capability.version));
    url.searchParams.set('nbf', String(capability.notBefore));
  } else if (capability.version === 3) {
    url.searchParams.set('cv', String(capability.version));
    url.searchParams.set('a', String(capability.executionAttempt));
  }
  url.searchParams.set('exp', String(capability.expiresAt));
  url.searchParams.set('sig', capability.signature);
  return Object.freeze({
    url: url.toString(),
    expiresAt: capability.expiresAt * 1000
  });
}

function resendEmailId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9-]{8,100}$/.test(id) ? id : '';
}

function resendFailureText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return [
    payload.message,
    payload.name,
    payload.error?.message,
    typeof payload.error === 'string' ? payload.error : ''
  ]
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function classifyResendFailure(httpStatus, payload) {
  const message = resendFailureText(payload);
  if (
    httpStatus === 401
    || /invalid(?: or revoked)? api[-_ ]?key|api[-_ ]?key (?:is )?(?:invalid|revoked)|revoked api[-_ ]?key/.test(message)
  ) {
    return Object.freeze({
      classification: 'invalid_api_key',
      errorCode: 'providerInvalidApiKey'
    });
  }
  if (
    httpStatus === 403
    && (
      /only send (?:testing )?emails? to your own email/.test(message)
      || /verify (?:a|your) (?:sending )?domain/.test(message)
      || /resend\.dev/.test(message)
      || /test sender/.test(message)
    )
  ) {
    return Object.freeze({
      classification: 'test_sender_recipient_restricted',
      errorCode: 'providerTestSenderRestricted'
    });
  }
  return Object.freeze({
    classification: 'permission_or_rejection',
    errorCode: 'providerRejected'
  });
}

function resendDiagnosticRoute(url) {
  const value = String(url || '');
  if (value === EMAIL_WAKE_X_RESEND_URL) return '/emails';
  if (
    value.startsWith(`${EMAIL_WAKE_X_RESEND_URL}/`)
    && value.endsWith('/cancel')
  ) {
    return '/emails/:emailId/cancel';
  }
  return '/unknown';
}

function reportResendFailure(deps, url, httpStatus, classification) {
  deps.consoleErrorImpl({
    route: resendDiagnosticRoute(url),
    provider: 'resend',
    httpStatus,
    classification
  });
}

async function resendRequest(url, {
  acceptedStatuses = [],
  body,
  idempotencyKey = '',
  method = 'POST'
}, options = {}) {
  const deps = dependencies(options);
  const configured = configuration(deps.env);
  if (
    !configured.apiKey
    || typeof deps.fetchImpl !== 'function'
    || typeof deps.AbortControllerImpl !== 'function'
  ) fail('notConfigured');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new deps.AbortControllerImpl();
    const timer = deps.setTimeoutImpl(() => controller.abort(), RESEND_TIMEOUT_MS);
    try {
      const response = await deps.fetchImpl(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${configured.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey.slice(0, 256) } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok || acceptedStatuses.includes(response.status)) return payload;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) {
        const classified = classifyResendFailure(response.status, payload);
        reportResendFailure(
          deps,
          url,
          response.status,
          classified.classification
        );
        fail(classified.errorCode);
      }
      if (attempt >= 2) fail('providerUnavailable');
      const retryAfter = Number(response.headers?.get?.('retry-after'));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(2_000, Math.ceil(retryAfter * 1000))
        : 250 * (2 ** attempt);
      await new Promise(resolve => deps.setTimeoutImpl(resolve, delayMs));
    } catch (error) {
      if (error instanceof EmailWakeXError) throw error;
      if (attempt >= 2) fail('providerUnavailable');
      await new Promise(resolve => deps.setTimeoutImpl(resolve, 250 * (2 ** attempt)));
    } finally {
      deps.clearTimeoutImpl(timer);
    }
  }
  fail('providerUnavailable');
}

export async function sendEmailWakeX({
  eventId,
  scheduledFor = 0
}, options = {}) {
  if (!validPushcutXEventId(eventId)) fail('invalid');
  const deps = dependencies(options);
  const configured = configuration(deps.env);
  if (!emailWakeXHealth(deps.env).wakeReady) fail('notConfigured');
  const now = Number(deps.now());
  const scheduled = Number(scheduledFor || 0);
  if (
    scheduled
    && (
      !Number.isSafeInteger(scheduled)
      || scheduled < now + 5_000
      || scheduled > now + EMAIL_WAKE_X_SCHEDULE_HORIZON_DAYS * 24 * 60 * 60 * 1000
    )
  ) fail('invalid');
  const payload = await resendRequest(EMAIL_WAKE_X_RESEND_URL, {
    idempotencyKey: emailWakeXResendIdempotencyKey(eventId, deps.env),
    body: {
      from: configured.from,
      to: [configured.to],
      subject: configured.subject,
      text: 'Poolside Pulse X receiver wake request.',
      ...(scheduled ? { scheduled_at: new Date(scheduled).toISOString() } : {}),
      tags: [
        { name: 'service', value: 'poolside-pulse-x' },
        { name: 'transport', value: 'email-wake' }
      ]
    }
  }, options);
  const emailId = resendEmailId(payload?.id);
  if (!emailId) fail('providerRejected');
  return Object.freeze({
    emailId,
    scheduledFor: scheduled,
    provider: 'resend'
  });
}

export async function cancelEmailWakeX(emailIdInput, options = {}) {
  const emailId = resendEmailId(emailIdInput);
  if (!emailId) fail('invalid');
  await resendRequest(
    `${EMAIL_WAKE_X_RESEND_URL}/${encodeURIComponent(emailId)}/cancel`,
    {
      method: 'POST',
      // Cancellation is idempotent from Poolside Pulse's perspective: these
      // statuses all mean there is no future scheduled email left to execute.
      acceptedStatuses: [404, 409, 422]
    },
    options
  );
  return true;
}

function emptyManifest() {
  return {
    schemaVersion: 1,
    version: 'x',
    transport: 'email-wake-x',
    syncedAt: 0,
    horizonEnd: 0,
    stateRevision: 0,
    warnings: [],
    occurrences: {},
    maintenance: null
  };
}

export function createEmailWakeXManifestStore(options = {}) {
  const deps = dependencies(options);
  const durable = durableReady(deps.env);
  const required = durableRequired(options, deps.env);
  return Object.freeze({
    durable,
    async read() {
      if (!durable) {
        if (required) fail('durableUnavailable');
        return structuredClone(memory().manifest || emptyManifest());
      }
      return parseRecord(await kv(['GET', EMAIL_WAKE_X_MANIFEST_KEY], deps)) || emptyManifest();
    },
    async write(value) {
      if (!isRecord(value) || !isRecord(value.occurrences)) fail('invalid');
      if (!durable) {
        if (required) fail('durableUnavailable');
        memory().manifest = structuredClone(value);
        return structuredClone(value);
      }
      await kv(['SET', EMAIL_WAKE_X_MANIFEST_KEY, JSON.stringify(value)], deps);
      return value;
    },
    async withLock(operation) {
      if (typeof operation !== 'function') fail('invalid');
      if (!durable) {
        if (required) fail('durableUnavailable');
        return await withMemoryLock('manifest', operation);
      }
      const lockToken = randomBytes(24).toString('base64url');
      const acquired = await kv([
        'SET',
        MANIFEST_LOCK_KEY,
        lockToken,
        'NX',
        'EX',
        String(MANIFEST_LOCK_SECONDS)
      ], deps);
      if (String(acquired || '').toUpperCase() !== 'OK') fail('locked');
      try {
        return await operation();
      } finally {
        await kv([
          'EVAL',
          RELEASE_LOCK_SCRIPT,
          '1',
          MANIFEST_LOCK_KEY,
          lockToken
        ], deps).catch(() => {});
      }
    }
  });
}
