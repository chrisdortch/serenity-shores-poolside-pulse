import {
  FINITE_AUDIO_X_MAX_SECONDS,
  normalizeFiniteAudioReference
} from './_finite-audio-x.js';
import { EMAIL_WAKE_X_RECEIVER_CONTRACT } from './_email-wake-x.js';
import { PUSHCUT_X_MAX_EXECUTION_ATTEMPT } from './_pushcut-security-x.js';
import { PUSHCUT_X_RECEIVER_CONTRACT } from './_pushcut-x.js';
import { versionXStorageKey } from './_version-x-namespace.js';

const RECEIPT_NAMESPACE = `${versionXStorageKey(
  'serenity-shores-poolside-pulse:vx:pushcut-receipt:v1'
)}:`;
const RECEIPT_KEY_PREFIX = `${RECEIPT_NAMESPACE}event:`;
const LATEST_RECEIPT_KEY = `${RECEIPT_NAMESPACE}meta:latest-completed`;
const RECEIVER_BUSY_KEY = `${RECEIPT_NAMESPACE}meta:receiver-busy`;
const RECEIPT_TTL_SECONDS = 24 * 60 * 60;
const RECEIPT_MAX_TTL_SECONDS = 31 * 24 * 60 * 60;
const RECEIPT_DEADLINE_MS = 90_000;
const FINITE_AUDIO_RECEIPT_OVERHEAD_MS = 60_000;
const MAX_RECEIPT_DEADLINE_MS =
  FINITE_AUDIO_X_MAX_SECONDS * 1000 + FINITE_AUDIO_RECEIPT_OVERHEAD_MS;
export const PUSHCUT_X_RECEIVER_BUSY_LEASE_MS =
  RECEIPT_DEADLINE_MS + 30_000;
const KV_REQUEST_TIMEOUT_MS = 8_000;
export const PUSHCUT_X_DISPATCH_LEASE_MS = 30_000;
export const PUSHCUT_X_AUDIO_LEASE_MS = 30_000;
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const TERMINAL_STATUSES = new Set(['completed', 'failed']);
const STATUSES = new Set(['queued', 'accepted', 'started', 'timed_out', 'completed', 'failed']);
const STATUS_RANK = Object.freeze({
  queued: 0,
  accepted: 1,
  started: 2,
  timed_out: 3,
  completed: 4,
  failed: 4
});
const RECEIVER_CONTRACTS = new Set([
  PUSHCUT_X_RECEIVER_CONTRACT,
  EMAIL_WAKE_X_RECEIVER_CONTRACT
]);
const PATCH_FIELDS = new Set([
  'acceptedAt',
  'audioClaimedAt',
  'audioContentType',
  'audioFetchedAt',
  'completedAt',
  'failedAt',
  'failureCode',
  'musicResumed',
  'providerMode',
  'providerStatus',
  'recoveryAcceptedAt',
  'recoveryQueued',
  'restoredMusicPercent',
  'startedAt',
  'status',
  'updatedAt',
  'volumeRestored',
  'watchdogEmailId',
  'watchdogScheduledFor'
]);
const KV_UPDATE_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return ""
end
local decodedOk, current = pcall(cjson.decode, raw)
if not decodedOk or type(current) ~= "table" then
  return ""
end
local expectedExecutionAttempt = tonumber(ARGV[3] or 0) or 0
if expectedExecutionAttempt > 0
  and (tonumber(current.executionAttempt or 0) or 0) ~= expectedExecutionAttempt
then
  return cjson.encode({ staleExecutionAttempt = true })
end
local patchOk, patch = pcall(cjson.decode, ARGV[1])
if not patchOk or type(patch) ~= "table" then
  return ""
end
local ranks = {
  queued = 0,
  accepted = 1,
  started = 2,
  timed_out = 3,
  completed = 4,
  failed = 4
}
local currentStatus = tostring(current.status or "queued")
local patchStatus = patch.status and tostring(patch.status) or nil
local currentTerminal = currentStatus == "completed" or currentStatus == "failed"
local statusRejected = false
if patchStatus then
  if currentTerminal and patchStatus ~= currentStatus then
    patch.status = nil
    statusRejected = true
  elseif ranks[patchStatus] == nil then
    patch.status = nil
    statusRejected = true
  elseif currentStatus ~= "timed_out" and ranks[currentStatus] and ranks[patchStatus] < ranks[currentStatus] then
    patch.status = nil
    statusRejected = true
  end
end
if statusRejected then
  local statusFields = {
    "acceptedAt",
    "completedAt",
    "failedAt",
    "failureCode",
    "musicResumed",
    "providerStatus",
    "restoredMusicPercent",
    "startedAt",
    "volumeRestored"
  }
  for _, field in ipairs(statusFields) do
    patch[field] = nil
  end
end
for key, value in pairs(patch) do
  current[key] = value
end
local encoded = cjson.encode(current)
local nextStatus = tostring(current.status or "")
local recoveryPending = tostring(current.executionMode or "") == "recovery"
  and nextStatus ~= "completed"
  and nextStatus ~= "failed"
if recoveryPending then
  redis.call("SET", KEYS[1], encoded)
  redis.call("PERSIST", KEYS[1])
else
  local receiptTtl = redis.call("TTL", KEYS[1])
  if receiptTtl == nil or receiptTtl < 1 then
    receiptTtl = tonumber(ARGV[2]) or 86400
  end
  redis.call("SET", KEYS[1], encoded, "EX", receiptTtl)
end
if nextStatus == "completed" or nextStatus == "failed" then
  if redis.call("GET", KEYS[3]) == KEYS[1] then
    redis.call("DEL", KEYS[3])
  end
end
if nextStatus == "completed" then
  local latest = {
    eventId = current.eventId,
    status = "completed",
    completedAt = current.completedAt or current.updatedAt or 0,
    updatedAt = current.updatedAt or 0,
    audioFetchedAt = current.audioFetchedAt or 0,
    receiverContract = current.receiverContract or "",
    voicePercent = current.voicePercent or 0,
    musicPercent = current.musicPercent or 0,
    resumeMusic = current.resumeMusic ~= false,
    volumeRestored = current.volumeRestored == true,
    restoreTargetMusicPercent = current.restoreTargetMusicPercent,
    restoreTargetResolvedAt = current.restoreTargetResolvedAt or 0,
    restoredMusicPercent = current.restoredMusicPercent,
    musicResumed = current.musicResumed == true
  }
  local latestEncoded = cjson.encode(latest)
  local latestRaw = redis.call("GET", KEYS[2])
  local shouldWriteLatest = true
  if latestRaw then
    local latestOk, latestCurrent = pcall(cjson.decode, latestRaw)
    if latestOk and type(latestCurrent) == "table" then
      local currentAt = tonumber(latestCurrent.completedAt or latestCurrent.updatedAt or 0) or 0
      local incomingAt = tonumber(latest.completedAt or latest.updatedAt or 0) or 0
      if currentAt > incomingAt then
        shouldWriteLatest = false
      end
    end
  end
  if shouldWriteLatest then
    redis.call("SET", KEYS[2], latestEncoded, "EX", ARGV[2])
  end
end
return encoded
`;
const KV_RESOLVE_RESTORE_TARGET_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return ""
end
local decodedOk, current = pcall(cjson.decode, raw)
if not decodedOk or type(current) ~= "table" then
  return ""
end
local status = tostring(current.status or "queued")
local receiverContract = tostring(current.receiverContract or "")
local executionAttempt = tonumber(current.executionAttempt or 0) or 0
local expectedExecutionAttempt = tonumber(ARGV[5] or 0) or 0
local executionMode = tostring(current.executionMode or "")
local allowRecovery = tostring(ARGV[6] or "") == "1"
local attemptMatches = receiverContract ~= tostring(ARGV[4] or "")
  or (executionAttempt <= 0 and expectedExecutionAttempt <= 0)
  or (executionAttempt > 0 and executionAttempt == expectedExecutionAttempt)
local recoveryResolution = allowRecovery
  and executionMode == "recovery"
  and executionAttempt > 0
  and executionAttempt == expectedExecutionAttempt
local audioFetchedAt = tonumber(current.audioFetchedAt or 0) or 0
local existingTarget = nil
if type(current.restoreTargetMusicPercent) == "number" then
  existingTarget = current.restoreTargetMusicPercent
end
local requestedTarget = tonumber(ARGV[1])
local now = tonumber(ARGV[2]) or 0
local resolvedAt = now
if audioFetchedAt > resolvedAt then
  resolvedAt = audioFetchedAt
end
if existingTarget == nil
  and requestedTarget ~= nil
  and requestedTarget >= 0
  and requestedTarget <= 100
  and receiverContract == tostring(ARGV[4] or "")
  and attemptMatches
  and (
    (audioFetchedAt > 0 and (status == "started" or status == "timed_out"))
    or recoveryResolution
  )
then
  current.restoreTargetMusicPercent = requestedTarget
  current.restoreTargetResolvedAt = resolvedAt
  current.updatedAt = resolvedAt
  if executionMode == "recovery" then
    redis.call("SET", KEYS[1], cjson.encode(current))
    redis.call("PERSIST", KEYS[1])
  else
    local receiptTtl = redis.call("TTL", KEYS[1])
    if receiptTtl == nil or receiptTtl < 1 then
      receiptTtl = tonumber(ARGV[3]) or 86400
    end
    redis.call("SET", KEYS[1], cjson.encode(current), "EX", receiptTtl)
  end
end
return cjson.encode(current)
`;
const KV_LATEST_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
local incomingOk, incoming = pcall(cjson.decode, ARGV[1])
if not incomingOk or type(incoming) ~= "table" then
  return ""
end
if raw then
  local currentOk, current = pcall(cjson.decode, raw)
  if currentOk and type(current) == "table" then
    local currentAt = tonumber(current.completedAt or current.updatedAt or 0) or 0
    local incomingAt = tonumber(incoming.completedAt or incoming.updatedAt or 0) or 0
    if currentAt > incomingAt then
      return raw
    end
  end
end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
return ARGV[1]
`;
const KV_DISPATCH_CLAIM_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return ""
end
local decodedOk, current = pcall(cjson.decode, raw)
if not decodedOk or type(current) ~= "table" then
  return ""
end
local now = tonumber(ARGV[1]) or 0
local lease = tonumber(ARGV[2]) or 0
local status = tostring(current.status or "queued")
local previousClaim = tonumber(current.dispatchClaimedAt or 0) or 0
local claimed = false
local reclaimed = false
local busy = false
if status == "queued" and (previousClaim <= 0 or previousClaim + lease <= now) then
  claimed = true
  reclaimed = previousClaim > 0
  current.dispatchClaimedAt = now
  current.dispatchAttempt = (tonumber(current.dispatchAttempt or 0) or 0) + 1
  current.providerStatus = "pushcut_dispatching"
  current.updatedAt = now
  local receiptTtl = redis.call("TTL", KEYS[1])
  if receiptTtl == nil or receiptTtl < 1 then
    receiptTtl = tonumber(ARGV[3]) or 86400
  end
  redis.call("SET", KEYS[1], cjson.encode(current), "EX", receiptTtl)
end
return cjson.encode({
  claimed = claimed,
  reclaimed = reclaimed,
  busy = busy,
  receipt = current
})
`;
const KV_PREPARE_EMAIL_WAKE_ATTEMPT_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return ""
end
local decodedOk, current = pcall(cjson.decode, raw)
if not decodedOk or type(current) ~= "table" then
  return ""
end
local requestedAttempt = tonumber(ARGV[1] or 0) or 0
local requestedMode = tostring(ARGV[2] or "")
local now = tonumber(ARGV[3] or 0) or 0
local deadlineAt = tonumber(ARGV[4] or 0) or 0
local receiverContract = tostring(ARGV[6] or "")
local executionLeaseUntil = tonumber(ARGV[7] or 0) or 0
local currentAttempt = tonumber(current.executionAttempt or 0) or 0
local currentStatus = tostring(current.status or "queued")
local currentMode = tostring(current.executionMode or "")
local reason = ""
local prepared = false
local changed = false
local finiteDurationSeconds = tonumber(current.announcementDurationSeconds or 0) or 0
if finiteDurationSeconds > 0 then
  deadlineAt = math.max(deadlineAt, now + finiteDurationSeconds * 1000 + 60000)
end
if tostring(current.receiverContract or "") ~= receiverContract then
  reason = "contract"
elseif currentStatus == "completed" or currentStatus == "failed" then
  reason = "terminal"
elseif requestedAttempt < currentAttempt then
  reason = "stale"
elseif requestedAttempt == currentAttempt and currentAttempt > 0 then
  if currentMode ~= "" and currentMode ~= requestedMode then
    reason = "mode"
  else
    prepared = true
  end
else
  current.executionAttempt = requestedAttempt
  current.executionMode = requestedMode
  current.executionLeaseUntil = executionLeaseUntil
  current.providerMode = "email-wake-x"
  current.updatedAt = now
  current.deadlineAt = deadlineAt
  current.watchdogEmailId = ""
  current.watchdogScheduledFor = 0
  current.restoreTargetMusicPercent = cjson.null
  current.restoreTargetResolvedAt = 0
  current.volumeRestored = false
  current.restoredMusicPercent = cjson.null
  current.musicResumed = false
  current.completedAt = 0
  current.failedAt = 0
  current.failureCode = ""
  if requestedMode == "recovery" then
    current.status = "timed_out"
    current.providerStatus = "email_wake_recovery_ready"
  else
    current.status = "queued"
    current.acceptedAt = 0
    current.startedAt = 0
    current.audioClaimedAt = 0
    current.audioFetchedAt = 0
    current.audioContentType = ""
    if requestedMode == "volume" then
      current.providerStatus = "email_wake_volume_attempt_ready"
    else
      current.providerStatus = "email_wake_announcement_attempt_ready"
    end
  end
  if redis.call("GET", KEYS[2]) == KEYS[1] then
    redis.call("DEL", KEYS[2])
  end
  local receiptTtl = redis.call("TTL", KEYS[1])
  if receiptTtl == nil or receiptTtl < tonumber(ARGV[5]) then
    receiptTtl = tonumber(ARGV[5]) or 86400
  end
  if requestedMode == "recovery" then
    redis.call("SET", KEYS[1], cjson.encode(current))
    redis.call("PERSIST", KEYS[1])
  else
    redis.call("SET", KEYS[1], cjson.encode(current), "EX", receiptTtl)
  end
  prepared = true
  changed = true
end
return cjson.encode({
  prepared = prepared,
  changed = changed,
  reason = reason,
  receipt = current
})
`;
const KV_AUDIO_CLAIM_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then
  return ""
end
local decodedOk, current = pcall(cjson.decode, raw)
if not decodedOk or type(current) ~= "table" then
  return ""
end
local now = tonumber(ARGV[1]) or 0
local lease = tonumber(ARGV[2]) or 0
local status = tostring(current.status or "queued")
local receiverContract = tostring(current.receiverContract or "")
local executionAttempt = tonumber(current.executionAttempt or 0) or 0
local executionLeaseUntil = tonumber(current.executionLeaseUntil or 0) or 0
local expectedExecutionAttempt = tonumber(ARGV[5] or 0) or 0
local executionMode = tostring(current.executionMode or "")
local emailReceiverContract = tostring(ARGV[6] or "")
local emailAttemptMatches = receiverContract ~= emailReceiverContract
  or (executionAttempt <= 0 and expectedExecutionAttempt <= 0)
  or (
    executionAttempt > 0
    and executionAttempt == expectedExecutionAttempt
    and executionLeaseUntil >= now
    and (executionMode == "" or executionMode == "announcement")
  )
local previousClaim = tonumber(current.audioClaimedAt or 0) or 0
local fetchedAt = tonumber(current.audioFetchedAt or 0) or 0
local terminal = status == "completed" or status == "failed"
local claimed = false
local reclaimed = false
local busy = false
local busyOwner = redis.call("GET", KEYS[2])
if busyOwner and busyOwner ~= KEYS[1] then
  local holderRaw = redis.call("GET", busyOwner)
  if not holderRaw then
    redis.call("DEL", KEYS[2])
    busyOwner = nil
  else
    local holderOk, holder = pcall(cjson.decode, holderRaw)
    local holderStatus = holderOk and type(holder) == "table"
      and tostring(holder.status or "queued") or ""
    if holderStatus == "completed" or holderStatus == "failed" or holderStatus == "" then
      redis.call("DEL", KEYS[2])
      busyOwner = nil
    else
      busy = true
    end
  end
end
if not busy and emailAttemptMatches and not terminal and fetchedAt <= 0 and (previousClaim <= 0 or previousClaim + lease <= now) then
  claimed = true
  reclaimed = previousClaim > 0
  current.audioClaimedAt = now
  current.audioAttempt = (tonumber(current.audioAttempt or 0) or 0) + 1
  current.status = "started"
  if (tonumber(current.startedAt or 0) or 0) <= 0 then
    current.startedAt = now
  end
  current.providerStatus = "receiver_fetching_audio"
  current.updatedAt = now
  local receiptTtl = redis.call("TTL", KEYS[1])
  if receiptTtl == nil or receiptTtl < 1 then
    receiptTtl = tonumber(ARGV[3]) or 86400
  end
  redis.call("SET", KEYS[2], KEYS[1], "EX", tonumber(ARGV[4]) or 120)
  redis.call("SET", KEYS[1], cjson.encode(current), "EX", receiptTtl)
end
return cjson.encode({
  claimed = claimed,
  reclaimed = reclaimed,
  busy = busy,
  stale = not emailAttemptMatches,
  receipt = current
})
`;

const SAFE_ERRORS = Object.freeze({
  invalid: Object.freeze({
    statusCode: 400,
    message: 'The Pushcut receipt is invalid.'
  }),
  conflict: Object.freeze({
    statusCode: 409,
    message: 'That announcement identifier is already in use.'
  }),
  staleExecution: Object.freeze({
    statusCode: 409,
    message: 'This Receiver execution attempt is stale.'
  }),
  notFound: Object.freeze({
    statusCode: 404,
    message: 'The Pushcut receipt was not found.'
  }),
  unavailable: Object.freeze({
    statusCode: 503,
    message: 'Durable Pushcut receipt storage is unavailable.'
  })
});

export class PushcutXReceiptError extends Error {
  constructor(code) {
    const safe = SAFE_ERRORS[code] || SAFE_ERRORS.unavailable;
    super(safe.message);
    this.name = 'PushcutXReceiptError';
    this.code = Object.hasOwn(SAFE_ERRORS, code) ? code : 'unavailable';
    this.statusCode = safe.statusCode;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validEventId(value) {
  return typeof value === 'string' && EVENT_ID_PATTERN.test(value.trim());
}

function receiptKey(eventId) {
  const clean = String(eventId || '').trim();
  if (!validEventId(clean)) throw new PushcutXReceiptError('invalid');
  return `${RECEIPT_KEY_PREFIX}${clean}`;
}

function kvReady(env) {
  return Boolean(env?.KV_REST_API_URL && env?.KV_REST_API_TOKEN);
}

async function kv(command, {
  env,
  fetchImpl,
  AbortControllerImpl,
  setTimeoutImpl,
  clearTimeoutImpl
}) {
  if (typeof fetchImpl !== 'function' || typeof AbortControllerImpl !== 'function') {
    throw new PushcutXReceiptError('unavailable');
  }
  const controller = new AbortControllerImpl();
  const timer = setTimeoutImpl(() => controller.abort(), KV_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(env.KV_REST_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new PushcutXReceiptError('unavailable');
    return data.result;
  } catch (error) {
    if (error instanceof PushcutXReceiptError) throw error;
    throw new PushcutXReceiptError('unavailable');
  } finally {
    clearTimeoutImpl(timer);
  }
}

function dependencies(options = {}) {
  return {
    env: options.env || process.env,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    AbortControllerImpl: options.AbortControllerImpl || globalThis.AbortController,
    setTimeoutImpl: options.setTimeoutImpl || globalThis.setTimeout,
    clearTimeoutImpl: options.clearTimeoutImpl || globalThis.clearTimeout
  };
}

function memoryReceipts() {
  globalThis.__POOL_SIDE_X_PUSHCUT_RECEIPTS__ ||= new Map();
  return globalThis.__POOL_SIDE_X_PUSHCUT_RECEIPTS__;
}

function memoryLocks() {
  globalThis.__POOL_SIDE_X_PUSHCUT_RECEIPT_LOCKS__ ||= new Map();
  return globalThis.__POOL_SIDE_X_PUSHCUT_RECEIPT_LOCKS__;
}

async function withMemoryLock(key, operation) {
  const locks = memoryLocks();
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  locks.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

function activeMemoryBusyOwner(now) {
  const receipts = memoryReceipts();
  const busy = receipts.get(RECEIVER_BUSY_KEY);
  const ownerKey = typeof busy === 'string' ? busy : String(busy?.ownerKey || '');
  if (typeof ownerKey !== 'string' || !ownerKey) {
    receipts.delete(RECEIVER_BUSY_KEY);
    return '';
  }
  if (Number(busy?.expiresAt || 0) > 0 && Number(busy.expiresAt) <= now) {
    receipts.delete(RECEIVER_BUSY_KEY);
    return '';
  }
  const owner = receipts.get(ownerKey);
  if (!owner || TERMINAL_STATUSES.has(owner.status)) {
    receipts.delete(RECEIVER_BUSY_KEY);
    return '';
  }
  return ownerKey;
}

function parseReceipt(raw) {
  if (!raw) return null;
  if (isRecord(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseClaimResult(raw) {
  const parsed = parseReceipt(raw);
  if (!parsed || !isRecord(parsed.receipt)) return null;
  return {
    claimed: parsed.claimed === true,
    reclaimed: parsed.reclaimed === true,
    busy: parsed.busy === true,
    stale: parsed.stale === true,
    receipt: parsed.receipt
  };
}

function parseAttemptResult(raw) {
  const parsed = parseReceipt(raw);
  if (!parsed || !isRecord(parsed.receipt)) return null;
  return {
    prepared: parsed.prepared === true,
    changed: parsed.changed === true,
    reason: String(parsed.reason || ''),
    receipt: parsed.receipt
  };
}

function claimTiming(options, defaultLeaseMs) {
  const now = Number((options.now || Date.now)());
  const leaseMs = Math.max(
    5_000,
    Math.min(5 * 60_000, Math.floor(Number(options.leaseMs) || defaultLeaseMs))
  );
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new PushcutXReceiptError('invalid');
  }
  return { now, leaseMs };
}

function cleanFailureCode(value) {
  const code = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(code) ? code : '';
}

function sanitizePatch(value, now) {
  if (!isRecord(value)) throw new PushcutXReceiptError('invalid');
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (!PATCH_FIELDS.has(key)) continue;
    if (key === 'status') {
      const status = String(item || '').trim().toLowerCase();
      if (!STATUSES.has(status)) throw new PushcutXReceiptError('invalid');
      clean.status = status;
      continue;
    }
    if (key === 'failureCode') {
      const failureCode = cleanFailureCode(item);
      if (item && !failureCode) throw new PushcutXReceiptError('invalid');
      clean.failureCode = failureCode;
      continue;
    }
    if ([
      'musicResumed',
      'recoveryQueued',
      'volumeRestored'
    ].includes(key)) {
      if (typeof item !== 'boolean') throw new PushcutXReceiptError('invalid');
      clean[key] = item;
      continue;
    }
    if ([
      'acceptedAt',
      'audioClaimedAt',
      'audioFetchedAt',
      'completedAt',
      'failedAt',
      'recoveryAcceptedAt',
      'startedAt',
      'updatedAt',
      'watchdogScheduledFor'
    ].includes(key)) {
      const timestamp = Number(item);
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new PushcutXReceiptError('invalid');
      clean[key] = timestamp;
      continue;
    }
    if (key === 'restoredMusicPercent') {
      if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 100) {
        throw new PushcutXReceiptError('invalid');
      }
      clean.restoredMusicPercent = item;
      continue;
    }
    const text = String(item || '').trim();
    if (text.length > 120) throw new PushcutXReceiptError('invalid');
    clean[key] = text;
  }
  clean.updatedAt = now;
  return clean;
}

function transition(current, patch) {
  const next = { ...current };
  const currentStatus = STATUSES.has(current.status) ? current.status : 'queued';
  const requestedStatus = patch.status;
  let acceptedStatus = requestedStatus;
  if (requestedStatus) {
    if (TERMINAL_STATUSES.has(currentStatus) && requestedStatus !== currentStatus) {
      acceptedStatus = '';
    } else if (
      currentStatus !== 'timed_out'
      && STATUS_RANK[requestedStatus] < STATUS_RANK[currentStatus]
    ) {
      acceptedStatus = '';
    }
  }
  const rejectedStatusFields = new Set([
    'acceptedAt',
    'completedAt',
    'failedAt',
    'failureCode',
    'musicResumed',
    'providerStatus',
    'restoredMusicPercent',
    'startedAt',
    'volumeRestored'
  ]);
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'status' && !acceptedStatus) continue;
    if (requestedStatus && !acceptedStatus && rejectedStatusFields.has(key)) continue;
    next[key] = value;
  }
  return next;
}

function baseReceipt(command, now, ttlSeconds) {
  if (!isRecord(command) || !validEventId(command.eventId)) {
    throw new PushcutXReceiptError('invalid');
  }
  const text = String(command.text || '').trim();
  if (!text || text.length > 900) throw new PushcutXReceiptError('invalid');
  const voice = String(command.voice || 'marin').trim().slice(0, 40) || 'marin';
  const instructions = String(command.instructions || '').trim().slice(0, 700);
  const receiverContract = String(
    command.receiverContract || PUSHCUT_X_RECEIVER_CONTRACT
  ).trim();
  if (!RECEIVER_CONTRACTS.has(receiverContract)) {
    throw new PushcutXReceiptError('invalid');
  }
  const requestedMusicPercent = Number(command.musicPercent);
  const scheduledFor = Number(command.scheduledFor || 0);
  if (
    scheduledFor
    && (
      !Number.isSafeInteger(scheduledFor)
      || scheduledFor < now
      || scheduledFor > now + 30 * 24 * 60 * 60 * 1000
    )
  ) throw new PushcutXReceiptError('invalid');
  const announcementMode = command.announcementMode === 'finite-audio'
    ? 'finite-audio'
    : 'natural-voice';
  let announcementProvider = '';
  let announcementAudioUrl = '';
  let announcementDurationSeconds = 0;
  if (announcementMode === 'finite-audio') {
    let reference;
    try {
      reference = normalizeFiniteAudioReference(
        command.announcementProvider,
        command.announcementAudioUrl
      );
    } catch {
      throw new PushcutXReceiptError('invalid');
    }
    announcementProvider = reference.provider;
    announcementAudioUrl = reference.sourceUrl;
    const duration = Number(command.announcementDurationSeconds || 0);
    if (
      !Number.isInteger(duration)
      || duration < 1
      || duration > FINITE_AUDIO_X_MAX_SECONDS
    ) {
      throw new PushcutXReceiptError('invalid');
    }
    announcementDurationSeconds = duration;
  }
  return {
    schemaVersion: 1,
    version: 'x',
    receiverContract,
    eventId: command.eventId,
    commandId: String(command.commandId || command.eventId),
    action: String(command.action || 'announce'),
    source: String(command.source || 'live'),
    scheduledFor,
    announcementMode,
    announcementProvider,
    // Kept private: signed media URLs and source query parameters never appear
    // in publicPushcutXReceipt or the receiver command.
    announcementAudioUrl,
    announcementDurationSeconds,
    label: String(command.label || 'Speak Now').slice(0, 80),
    text,
    voice,
    instructions,
    voicePercent: 100,
    musicPercent: Number.isFinite(requestedMusicPercent)
      ? Math.max(0, Math.min(100, requestedMusicPercent))
      : 30,
    // Announcement receipts always resume the bed. Version X email-wake
    // volume commands are the one narrow exception: they change the saved
    // physical music level without starting playback.
    resumeMusic: String(command.action || '') === 'volume' ? false : true,
    status: 'queued',
    providerStatus: 'pending',
    providerMode: '',
    queuedAt: now,
    updatedAt: now,
    deadlineAt: (scheduledFor || now) + receiptDeadlineMs(command),
    expiresAt: now + ttlSeconds * 1000,
    acceptedAt: 0,
    dispatchClaimedAt: 0,
    dispatchAttempt: 0,
    executionAttempt: 0,
    executionLeaseUntil: 0,
    executionMode: '',
    startedAt: 0,
    audioClaimedAt: 0,
    audioAttempt: 0,
    audioFetchedAt: 0,
    completedAt: 0,
    failedAt: 0,
    failureCode: '',
    audioContentType: '',
    recoveryQueued: false,
    recoveryAcceptedAt: 0,
    restoreTargetMusicPercent: null,
    restoreTargetResolvedAt: 0,
    volumeRestored: false,
    restoredMusicPercent: null,
    musicResumed: false,
    watchdogEmailId: '',
    watchdogScheduledFor: 0
  };
}

function receiptDeadlineMs(command) {
  const finiteDurationSeconds = Number(
    command?.announcementMode === 'finite-audio'
      ? command?.announcementDurationSeconds
      : 0
  );
  if (!Number.isFinite(finiteDurationSeconds) || finiteDurationSeconds <= 0) {
    return RECEIPT_DEADLINE_MS;
  }
  return Math.min(
    MAX_RECEIPT_DEADLINE_MS,
    Math.max(
      RECEIPT_DEADLINE_MS,
      finiteDurationSeconds * 1000 + FINITE_AUDIO_RECEIPT_OVERHEAD_MS
    )
  );
}

function ensureCompatible(existing, candidate) {
  if (
    existing.eventId !== candidate.eventId
    || existing.commandId !== candidate.commandId
    || existing.action !== candidate.action
    || existing.source !== candidate.source
    || Number(existing.scheduledFor || 0) !== candidate.scheduledFor
    || String(existing.announcementMode || 'natural-voice') !== candidate.announcementMode
    || String(existing.announcementProvider || '') !== candidate.announcementProvider
    || String(existing.announcementAudioUrl || '') !== candidate.announcementAudioUrl
    || Number(existing.announcementDurationSeconds || 0) !== candidate.announcementDurationSeconds
    || existing.text !== candidate.text
    || existing.voice !== candidate.voice
    || existing.instructions !== candidate.instructions
    || String(existing.receiverContract || '') !== candidate.receiverContract
    || existing.voicePercent !== candidate.voicePercent
    || existing.musicPercent !== candidate.musicPercent
    || (existing.resumeMusic !== false) !== candidate.resumeMusic
  ) throw new PushcutXReceiptError('conflict');
  return existing;
}

function storageRequired(options, env) {
  if (typeof options.requireDurable === 'boolean') return options.requireDurable;
  return env?.VERCEL === '1';
}

export function pushcutXReceiptStorageHealth(env = process.env) {
  const durable = kvReady(env);
  return Object.freeze({
    ready: durable || env?.VERCEL !== '1',
    durable,
    mode: durable ? 'kv' : 'memory'
  });
}

export async function createPushcutXReceipt(command, options = {}) {
  const deps = dependencies(options);
  const now = Number((options.now || Date.now)());
  const scheduledFor = Number(command?.scheduledFor || 0);
  const scheduledTtlSeconds = scheduledFor > now
    ? Math.ceil((scheduledFor - now) / 1000) + RECEIPT_TTL_SECONDS
    : RECEIPT_TTL_SECONDS;
  const ttlSeconds = Math.max(300, Math.min(
    RECEIPT_MAX_TTL_SECONDS,
    Math.floor(Number(options.ttlSeconds) || scheduledTtlSeconds)
  ));
  const candidate = baseReceipt(command, now, ttlSeconds);
  const key = receiptKey(candidate.eventId);
  const durable = kvReady(deps.env);
  if (!durable && storageRequired(options, deps.env)) {
    throw new PushcutXReceiptError('unavailable');
  }

  if (durable) {
    const inserted = await kv(
      ['SET', key, JSON.stringify(candidate), 'NX', 'EX', String(ttlSeconds)],
      deps
    );
    if (String(inserted || '').toUpperCase() === 'OK') {
      return { receipt: candidate, created: true, durable: true };
    }
    const existing = parseReceipt(await kv(['GET', key], deps));
    if (!existing) throw new PushcutXReceiptError('unavailable');
    return { receipt: ensureCompatible(existing, candidate), created: false, durable: true };
  }

  return await withMemoryLock(key, async () => {
    const existing = memoryReceipts().get(key);
    if (existing) {
      return { receipt: ensureCompatible(existing, candidate), created: false, durable: false };
    }
    memoryReceipts().set(key, candidate);
    return { receipt: candidate, created: true, durable: false };
  });
}

export async function claimPushcutXDispatch(eventId, options = {}) {
  const deps = dependencies(options);
  const { now, leaseMs } = claimTiming(options, PUSHCUT_X_DISPATCH_LEASE_MS);
  const key = receiptKey(eventId);
  const durable = kvReady(deps.env);
  if (!durable && storageRequired(options, deps.env)) {
    throw new PushcutXReceiptError('unavailable');
  }

  if (durable) {
    const claimed = parseClaimResult(await kv([
      'EVAL',
      KV_DISPATCH_CLAIM_SCRIPT,
      '1',
      key,
      String(now),
      String(leaseMs),
      String(RECEIPT_TTL_SECONDS)
    ], deps));
    if (!claimed) throw new PushcutXReceiptError('notFound');
    return { ...claimed, durable: true };
  }

  return await withMemoryLock(key, async () => {
    const receipts = memoryReceipts();
    const current = receipts.get(key);
    if (!current) throw new PushcutXReceiptError('notFound');
    const previousClaim = Number(current.dispatchClaimedAt || 0);
    const canClaim = current.status === 'queued'
      && (previousClaim <= 0 || previousClaim + leaseMs <= now);
    const receipt = canClaim
      ? {
          ...current,
          dispatchClaimedAt: now,
          dispatchAttempt: Number(current.dispatchAttempt || 0) + 1,
          providerStatus: 'pushcut_dispatching',
          updatedAt: now
        }
      : current;
    if (canClaim) receipts.set(key, receipt);
    return {
      claimed: canClaim,
      reclaimed: canClaim && previousClaim > 0,
      busy: false,
      receipt,
      durable: false
    };
  });
}

export async function prepareEmailWakeXReceiptAttempt(
  eventId,
  executionAttempt,
  options = {}
) {
  const deps = dependencies(options);
  const now = Number((options.now || Date.now)());
  const attempt = Number(executionAttempt);
  const mode = String(options.mode || 'announcement').trim();
  const executionLeaseUntil = Number(
    options.leaseUntil || now + 5 * 60_000
  );
  if (
    !Number.isSafeInteger(now)
    || now < 0
    || !Number.isSafeInteger(attempt)
    || attempt < 1
    || attempt > PUSHCUT_X_MAX_EXECUTION_ATTEMPT
    || !Number.isSafeInteger(executionLeaseUntil)
    || executionLeaseUntil <= now
    || !['announcement', 'recovery', 'volume'].includes(mode)
  ) {
    throw new PushcutXReceiptError('invalid');
  }
  const key = receiptKey(eventId);
  const durable = kvReady(deps.env);
  if (!durable && storageRequired(options, deps.env)) {
    throw new PushcutXReceiptError('unavailable');
  }

  const interpret = result => {
    if (!result) throw new PushcutXReceiptError('notFound');
    if (result.prepared) return result;
    if (result.reason === 'stale') {
      throw new PushcutXReceiptError('staleExecution');
    }
    throw new PushcutXReceiptError('conflict');
  };

  if (durable) {
    const prepared = parseAttemptResult(await kv([
      'EVAL',
      KV_PREPARE_EMAIL_WAKE_ATTEMPT_SCRIPT,
      '2',
      key,
      RECEIVER_BUSY_KEY,
      String(attempt),
      mode,
      String(now),
      String(now + RECEIPT_DEADLINE_MS),
      String(RECEIPT_TTL_SECONDS),
      EMAIL_WAKE_X_RECEIVER_CONTRACT,
      String(executionLeaseUntil)
    ], deps));
    return { ...interpret(prepared), durable: true };
  }

  return await withMemoryLock(RECEIVER_BUSY_KEY, async () => {
    return await withMemoryLock(key, async () => {
      const receipts = memoryReceipts();
      const current = receipts.get(key);
      if (!current) throw new PushcutXReceiptError('notFound');
      if (String(current.receiverContract || '') !== EMAIL_WAKE_X_RECEIVER_CONTRACT) {
        throw new PushcutXReceiptError('conflict');
      }
      if (TERMINAL_STATUSES.has(current.status)) {
        throw new PushcutXReceiptError('conflict');
      }
      const currentAttempt = Number(current.executionAttempt || 0);
      if (attempt < currentAttempt) {
        throw new PushcutXReceiptError('staleExecution');
      }
      if (attempt === currentAttempt && currentAttempt > 0) {
        if (current.executionMode && current.executionMode !== mode) {
          throw new PushcutXReceiptError('conflict');
        }
        return {
          prepared: true,
          changed: false,
          reason: '',
          receipt: current,
          durable: false
        };
      }
      const common = {
        ...current,
        executionAttempt: attempt,
        executionLeaseUntil,
        executionMode: mode,
        providerMode: 'email-wake-x',
        updatedAt: now,
        deadlineAt: now + receiptDeadlineMs(current),
        watchdogEmailId: '',
        watchdogScheduledFor: 0,
        restoreTargetMusicPercent: null,
        restoreTargetResolvedAt: 0,
        volumeRestored: false,
        restoredMusicPercent: null,
        musicResumed: false,
        completedAt: 0,
        failedAt: 0,
        failureCode: ''
      };
      const receipt = mode === 'recovery'
        ? {
            ...common,
            status: 'timed_out',
            providerStatus: 'email_wake_recovery_ready'
          }
        : {
            ...common,
            status: 'queued',
            acceptedAt: 0,
            startedAt: 0,
            audioClaimedAt: 0,
            audioFetchedAt: 0,
            audioContentType: '',
            providerStatus: mode === 'volume'
              ? 'email_wake_volume_attempt_ready'
              : 'email_wake_announcement_attempt_ready'
          };
      receipts.set(key, receipt);
      const busy = receipts.get(RECEIVER_BUSY_KEY);
      const busyOwnerKey = typeof busy === 'string'
        ? busy
        : String(busy?.ownerKey || '');
      if (busyOwnerKey === key) receipts.delete(RECEIVER_BUSY_KEY);
      return {
        prepared: true,
        changed: true,
        reason: '',
        receipt,
        durable: false
      };
    });
  });
}

export async function claimPushcutXAudioGeneration(eventId, options = {}) {
  const deps = dependencies(options);
  const { now, leaseMs } = claimTiming(options, PUSHCUT_X_AUDIO_LEASE_MS);
  const executionAttempt = Number(options.executionAttempt || 0);
  if (
    !Number.isSafeInteger(executionAttempt)
    || executionAttempt < 0
    || executionAttempt > PUSHCUT_X_MAX_EXECUTION_ATTEMPT
  ) {
    throw new PushcutXReceiptError('invalid');
  }
  const key = receiptKey(eventId);
  const durable = kvReady(deps.env);
  if (!durable && storageRequired(options, deps.env)) {
    throw new PushcutXReceiptError('unavailable');
  }

  if (durable) {
    const claimed = parseClaimResult(await kv([
      'EVAL',
      KV_AUDIO_CLAIM_SCRIPT,
      '2',
      key,
      RECEIVER_BUSY_KEY,
      String(now),
      String(leaseMs),
      String(RECEIPT_TTL_SECONDS),
      String(Math.ceil(PUSHCUT_X_RECEIVER_BUSY_LEASE_MS / 1000)),
      String(executionAttempt),
      EMAIL_WAKE_X_RECEIVER_CONTRACT
    ], deps));
    if (!claimed) throw new PushcutXReceiptError('notFound');
    return { ...claimed, durable: true };
  }

  return await withMemoryLock(RECEIVER_BUSY_KEY, async () => {
    return await withMemoryLock(key, async () => {
      const receipts = memoryReceipts();
      const current = receipts.get(key);
      if (!current) throw new PushcutXReceiptError('notFound');
      const ownerKey = activeMemoryBusyOwner(now);
      const busy = Boolean(ownerKey && ownerKey !== key);
      const previousClaim = Number(current.audioClaimedAt || 0);
      const terminal = TERMINAL_STATUSES.has(current.status);
      const currentExecutionAttempt = Number(current.executionAttempt || 0);
      const executionLeaseCurrent = Number(current.executionLeaseUntil || 0);
      const emailAttemptMatches =
        String(current.receiverContract || '') !== EMAIL_WAKE_X_RECEIVER_CONTRACT
        || (
          currentExecutionAttempt <= 0
          && executionAttempt <= 0
        )
        || (
          currentExecutionAttempt > 0
          && currentExecutionAttempt === executionAttempt
          && executionLeaseCurrent >= now
          && ['', 'announcement'].includes(String(current.executionMode || ''))
        );
      const canClaim = !busy
        && emailAttemptMatches
        && !terminal
        && Number(current.audioFetchedAt || 0) <= 0
        && (previousClaim <= 0 || previousClaim + leaseMs <= now);
      const receipt = canClaim
        ? {
            ...current,
            audioClaimedAt: now,
            audioAttempt: Number(current.audioAttempt || 0) + 1,
            status: 'started',
            startedAt: Number(current.startedAt || 0) || now,
            providerStatus: 'receiver_fetching_audio',
            updatedAt: now
          }
        : current;
      if (canClaim) {
        receipts.set(RECEIVER_BUSY_KEY, {
          ownerKey: key,
          expiresAt: now + PUSHCUT_X_RECEIVER_BUSY_LEASE_MS
        });
        receipts.set(key, receipt);
      }
      return {
        claimed: canClaim,
        reclaimed: canClaim && previousClaim > 0,
        busy,
        stale: !emailAttemptMatches,
        receipt,
        durable: false
      };
    });
  });
}

export async function readPushcutXReceipt(eventId, options = {}) {
  const deps = dependencies(options);
  const key = receiptKey(eventId);
  const durable = kvReady(deps.env);
  if (!durable && storageRequired(options, deps.env)) {
    throw new PushcutXReceiptError('unavailable');
  }
  const receipt = durable
    ? parseReceipt(await kv(['GET', key], deps))
    : memoryReceipts().get(key) || null;
  if (!receipt) return null;
  if (
    !TERMINAL_STATUSES.has(receipt.status)
    && receipt.status !== 'timed_out'
    && Number(receipt.deadlineAt || 0) > 0
    && Number(receipt.deadlineAt) <= Number((options.now || Date.now)())
  ) {
    return await updatePushcutXReceipt(eventId, {
      status: 'timed_out',
      providerStatus: 'completion_timeout'
    }, options);
  }
  return receipt;
}

/**
 * Binds an announcement to the first canonical music target requested after
 * its audio was fetched. The signed restore lookup and the signed completion
 * receipt then agree on one server-recorded value even if another Remote moves
 * the shared slider again while the Shortcut is finishing.
 */
export async function resolvePushcutXRestoreTarget(eventId, musicPercent, options = {}) {
  const deps = dependencies(options);
  const now = Number((options.now || Date.now)());
  const target = Number(musicPercent);
  const executionAttempt = Number(options.executionAttempt || 0);
  const allowRecovery = options.allowRecovery === true;
  const receiverContract = String(
    options.receiverContract || PUSHCUT_X_RECEIVER_CONTRACT
  ).trim();
  if (
    !Number.isSafeInteger(now)
    || now < 0
    || !Number.isSafeInteger(executionAttempt)
    || executionAttempt < 0
    || executionAttempt > PUSHCUT_X_MAX_EXECUTION_ATTEMPT
    || !Number.isFinite(target)
    || target < 0
    || target > 100
    || !RECEIVER_CONTRACTS.has(receiverContract)
  ) {
    throw new PushcutXReceiptError('invalid');
  }
  const key = receiptKey(eventId);
  const durable = kvReady(deps.env);
  if (!durable && storageRequired(options, deps.env)) {
    throw new PushcutXReceiptError('unavailable');
  }

  if (durable) {
    const resolved = parseReceipt(await kv([
      'EVAL',
      KV_RESOLVE_RESTORE_TARGET_SCRIPT,
      '1',
      key,
      String(target),
      String(now),
      String(RECEIPT_TTL_SECONDS),
      receiverContract,
      String(executionAttempt),
      allowRecovery ? '1' : '0'
    ], deps));
    if (!resolved) throw new PushcutXReceiptError('notFound');
    return resolved;
  }

  return await withMemoryLock(key, async () => {
    const receipts = memoryReceipts();
    const current = receipts.get(key);
    if (!current) throw new PushcutXReceiptError('notFound');
    const existingTarget = Number(current.restoreTargetMusicPercent);
    const targetAlreadyResolved = typeof current.restoreTargetMusicPercent === 'number'
      && Number.isFinite(existingTarget);
    const currentExecutionAttempt = Number(current.executionAttempt || 0);
    const attemptMatches =
      String(current.receiverContract || '') !== EMAIL_WAKE_X_RECEIVER_CONTRACT
      || (
        currentExecutionAttempt <= 0
        && executionAttempt <= 0
      )
      || (
        currentExecutionAttempt > 0
        && currentExecutionAttempt === executionAttempt
      );
    const recoveryResolution = allowRecovery
      && current.executionMode === 'recovery'
      && currentExecutionAttempt > 0
      && currentExecutionAttempt === executionAttempt;
    const canResolve = !targetAlreadyResolved
      && attemptMatches
      && String(current.receiverContract || '') === receiverContract
      && (
        (
          Number(current.audioFetchedAt || 0) > 0
          && ['started', 'timed_out'].includes(current.status)
        )
        || recoveryResolution
      );
    const resolved = canResolve
      ? {
          ...current,
          restoreTargetMusicPercent: target,
          restoreTargetResolvedAt: Math.max(now, Number(current.audioFetchedAt || 0)),
          updatedAt: Math.max(now, Number(current.audioFetchedAt || 0))
        }
      : current;
    if (canResolve) receipts.set(key, resolved);
    return resolved;
  });
}

export async function updatePushcutXReceipt(eventId, value, options = {}) {
  const deps = dependencies(options);
  const now = Number((options.now || Date.now)());
  const executionAttempt = Number(options.executionAttempt || 0);
  if (
    !Number.isSafeInteger(executionAttempt)
    || executionAttempt < 0
    || executionAttempt > PUSHCUT_X_MAX_EXECUTION_ATTEMPT
  ) {
    throw new PushcutXReceiptError('invalid');
  }
  const patch = sanitizePatch(value, now);
  const key = receiptKey(eventId);
  const durable = kvReady(deps.env);
  if (!durable && storageRequired(options, deps.env)) {
    throw new PushcutXReceiptError('unavailable');
  }

  let updated;
  if (durable) {
    const raw = await kv([
      'EVAL',
      KV_UPDATE_SCRIPT,
      '3',
      key,
      LATEST_RECEIPT_KEY,
      RECEIVER_BUSY_KEY,
      JSON.stringify(patch),
      String(RECEIPT_TTL_SECONDS),
      String(executionAttempt)
    ], deps);
    updated = parseReceipt(raw);
    if (updated?.staleExecutionAttempt === true) {
      throw new PushcutXReceiptError('staleExecution');
    }
    if (!updated) throw new PushcutXReceiptError('notFound');
  } else {
    updated = await withMemoryLock(RECEIVER_BUSY_KEY, async () => {
      return await withMemoryLock(key, async () => {
        const receipts = memoryReceipts();
        const current = receipts.get(key);
        if (!current) throw new PushcutXReceiptError('notFound');
        if (
          executionAttempt > 0
          && Number(current.executionAttempt || 0) !== executionAttempt
        ) {
          throw new PushcutXReceiptError('staleExecution');
        }
        const next = transition(current, patch);
        receipts.set(key, next);
        const busy = receipts.get(RECEIVER_BUSY_KEY);
        const busyOwnerKey = typeof busy === 'string' ? busy : String(busy?.ownerKey || '');
        if (TERMINAL_STATUSES.has(next.status) && busyOwnerKey === key) {
          receipts.delete(RECEIVER_BUSY_KEY);
        }
        return next;
      });
    });
  }

  if (updated.status === 'completed') {
    const latest = JSON.stringify({
      eventId: updated.eventId,
      status: 'completed',
      completedAt: updated.completedAt || updated.updatedAt,
      updatedAt: updated.updatedAt,
      audioFetchedAt: Number(updated.audioFetchedAt || 0),
      receiverContract: String(updated.receiverContract || ''),
      voicePercent: Number(updated.voicePercent || 0),
      musicPercent: Number(updated.musicPercent || 0),
      resumeMusic: updated.resumeMusic !== false,
      volumeRestored: updated.volumeRestored === true,
      restoreTargetMusicPercent: updated.restoreTargetMusicPercent,
      restoreTargetResolvedAt: Number(updated.restoreTargetResolvedAt || 0),
      restoredMusicPercent: updated.restoredMusicPercent,
      musicResumed: updated.musicResumed === true
    });
    if (!durable) {
      await withMemoryLock(LATEST_RECEIPT_KEY, async () => {
        const incoming = parseReceipt(latest);
        const current = memoryReceipts().get(LATEST_RECEIPT_KEY);
        const currentAt = Number(current?.completedAt || current?.updatedAt || 0);
        const incomingAt = Number(incoming?.completedAt || incoming?.updatedAt || 0);
        if (!current || incomingAt >= currentAt) {
          memoryReceipts().set(LATEST_RECEIPT_KEY, incoming);
        }
      });
    }
  }
  return updated;
}

export async function repairLatestCompletedPushcutXReceipt(eventId, options = {}) {
  const deps = dependencies(options);
  const receipt = await readPushcutXReceipt(eventId, options);
  if (!receipt) throw new PushcutXReceiptError('notFound');
  if (receipt.status !== 'completed') return false;
  const latest = JSON.stringify({
    eventId: receipt.eventId,
    status: 'completed',
    completedAt: receipt.completedAt || receipt.updatedAt,
    updatedAt: receipt.updatedAt,
    audioFetchedAt: Number(receipt.audioFetchedAt || 0),
    receiverContract: String(receipt.receiverContract || ''),
    voicePercent: Number(receipt.voicePercent || 0),
    musicPercent: Number(receipt.musicPercent || 0),
    resumeMusic: receipt.resumeMusic !== false,
    volumeRestored: receipt.volumeRestored === true,
    restoreTargetMusicPercent: receipt.restoreTargetMusicPercent,
    restoreTargetResolvedAt: Number(receipt.restoreTargetResolvedAt || 0),
    restoredMusicPercent: receipt.restoredMusicPercent,
    musicResumed: receipt.musicResumed === true
  });
  const durable = kvReady(deps.env);
  if (!durable && storageRequired(options, deps.env)) {
    throw new PushcutXReceiptError('unavailable');
  }
  if (durable) {
    const repaired = parseReceipt(await kv([
      'EVAL',
      KV_LATEST_SCRIPT,
      '1',
      LATEST_RECEIPT_KEY,
      latest,
      String(RECEIPT_TTL_SECONDS)
    ], deps));
    if (!repaired) throw new PushcutXReceiptError('unavailable');
    return true;
  }
  await withMemoryLock(LATEST_RECEIPT_KEY, async () => {
    const incoming = parseReceipt(latest);
    const current = memoryReceipts().get(LATEST_RECEIPT_KEY);
    const currentAt = Number(current?.completedAt || current?.updatedAt || 0);
    const incomingAt = Number(incoming?.completedAt || incoming?.updatedAt || 0);
    if (!current || incomingAt >= currentAt) {
      memoryReceipts().set(LATEST_RECEIPT_KEY, incoming);
    }
  });
  return true;
}

export async function readLatestCompletedPushcutXReceipt(options = {}) {
  const deps = dependencies(options);
  const durable = kvReady(deps.env);
  if (!durable && storageRequired(options, deps.env)) {
    throw new PushcutXReceiptError('unavailable');
  }
  return durable
    ? parseReceipt(await kv(['GET', LATEST_RECEIPT_KEY], deps))
    : memoryReceipts().get(LATEST_RECEIPT_KEY) || null;
}

export function pushcutXReceiptExecutionAttemptMatches(
  receipt,
  executionAttempt
) {
  if (!isRecord(receipt)) return false;
  const expected = Number(executionAttempt || 0);
  const current = Number(receipt.executionAttempt || 0);
  if (
    !Number.isSafeInteger(expected)
    || expected < 0
    || !Number.isSafeInteger(current)
    || current < 0
  ) return false;
  return current > 0 ? expected === current : expected === 0;
}

export function verifiedPushcutXCompletion(receipt) {
  if (!isRecord(receipt)) return false;
  if (receipt.action === 'volume') {
    return RECEIVER_CONTRACTS.has(String(receipt.receiverContract || ''))
      && receipt.status === 'completed'
      && receipt.volumeRestored === true
      && Number.isFinite(receipt.musicPercent)
      && receipt.restoredMusicPercent === receipt.musicPercent
      && receipt.resumeMusic === false
      && receipt.musicResumed === false;
  }
  const expectedMusicPercent = Number(receipt.restoreTargetMusicPercent);
  const restoreTargetResolvedAt = Number(receipt.restoreTargetResolvedAt || 0);
  const audioFetchedAt = Number(receipt.audioFetchedAt || 0);
  const hasRestoredMusicPercent = typeof receipt.restoredMusicPercent === 'number'
    && Number.isFinite(receipt.restoredMusicPercent);
  const restoredMusicPercent = hasRestoredMusicPercent
    ? receipt.restoredMusicPercent
    : NaN;
  return RECEIVER_CONTRACTS.has(String(receipt.receiverContract || ''))
    && receipt.status === 'completed'
    && Number(receipt.voicePercent) === 100
    && Number.isFinite(expectedMusicPercent)
    && expectedMusicPercent >= 0
    && expectedMusicPercent <= 100
    && Number.isSafeInteger(restoreTargetResolvedAt)
    && restoreTargetResolvedAt > 0
    && Number.isSafeInteger(audioFetchedAt)
    && audioFetchedAt > 0
    && restoreTargetResolvedAt >= audioFetchedAt
    && Number.isFinite(restoredMusicPercent)
    && restoredMusicPercent === expectedMusicPercent
    && receipt.volumeRestored === true
    && receipt.resumeMusic === true
    && receipt.musicResumed === true;
}

export function publicPushcutXReceipt(receipt, { durable = false } = {}) {
  if (!isRecord(receipt)) return null;
  const status = STATUSES.has(receipt.status) ? receipt.status : 'queued';
  return Object.freeze({
    version: 'x',
    receiverContract: String(receipt.receiverContract || ''),
    eventId: String(receipt.eventId || ''),
    action: String(receipt.action || ''),
    source: String(receipt.source || ''),
    scheduledFor: Number(receipt.scheduledFor || 0),
    announcementMode: receipt.announcementMode === 'finite-audio'
      ? 'finite-audio'
      : 'natural-voice',
    announcementProvider: receipt.announcementMode === 'finite-audio'
      ? String(receipt.announcementProvider || '')
      : '',
    announcementDurationSeconds: receipt.announcementMode === 'finite-audio'
      ? Number(receipt.announcementDurationSeconds || 0)
      : 0,
    status,
    accepted: ['accepted', 'started', 'timed_out', 'completed'].includes(status),
    started: ['started', 'timed_out', 'completed'].includes(status),
    completed: status === 'completed',
    failed: status === 'failed',
    durable,
    queuedAt: Number(receipt.queuedAt || 0),
    acceptedAt: Number(receipt.acceptedAt || 0),
    startedAt: Number(receipt.startedAt || 0),
    completedAt: Number(receipt.completedAt || 0),
    failedAt: Number(receipt.failedAt || 0),
    updatedAt: Number(receipt.updatedAt || 0),
    failureCode: String(receipt.failureCode || ''),
    providerStatus: String(receipt.providerStatus || ''),
    providerMode: String(receipt.providerMode || ''),
    executionAttempt: Number(receipt.executionAttempt || 0),
    recoveryOnly: receipt.executionMode === 'recovery',
    audioReady: Boolean(receipt.audioFetchedAt),
    naturalAudio: receipt.announcementMode !== 'finite-audio' && Boolean(receipt.audioFetchedAt),
    finiteAudio: receipt.announcementMode === 'finite-audio' && Boolean(receipt.audioFetchedAt),
    recoveryQueued: receipt.recoveryQueued === true,
    sequenceCompleted: status === 'completed' && verifiedPushcutXCompletion(receipt),
    physicalVolumeMeasured: false,
    volumeRestored: receipt.volumeRestored === true,
    dispatchedMusicPercent: Number(receipt.musicPercent || 0),
    expectedMusicPercent: typeof receipt.restoreTargetMusicPercent === 'number'
      && Number.isFinite(receipt.restoreTargetMusicPercent)
      ? receipt.restoreTargetMusicPercent
      : Number(receipt.musicPercent || 0),
    restoredMusicPercent: typeof receipt.restoredMusicPercent === 'number'
      && Number.isFinite(receipt.restoredMusicPercent)
      ? receipt.restoredMusicPercent
      : null,
    musicResumed: receipt.musicResumed === true
  });
}
