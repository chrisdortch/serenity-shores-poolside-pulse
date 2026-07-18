import {
  createHash,
  createHmac,
  timingSafeEqual
} from 'node:crypto';

const CAPABILITY_VERSION = 1;
const SCHEDULED_CAPABILITY_VERSION = 2;
const CAPABILITY_CLOCK_SKEW_SECONDS = 30;
const CAPABILITY_MAX_TTL_SECONDS = 30 * 60;
const DEFAULT_CAPABILITY_TTL_SECONDS = 15 * 60;
const CAPABILITY_MAX_FUTURE_SECONDS = 30 * 24 * 60 * 60;
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const PURPOSES = new Set(['audio', 'receipt', 'recovery', 'restore']);
const PURPOSE_PATHS = Object.freeze({
  audio: '/api/pushcut-audio-x',
  receipt: '/api/pushcut-receipt-x',
  recovery: '/api/pushcut-recovery-x',
  restore: '/api/pushcut-restore-x'
});

function header(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function secretSource(env) {
  const source = env && typeof env === 'object' ? env : {};
  const candidates = [
    source.POOL_SIDE_SESSION_SECRET,
    source.KV_REST_API_TOKEN,
    source.OPENAI_API_KEY,
    source.PUSHCUT_API_KEY_X
  ];
  return candidates
    .map(value => String(value || '').trim())
    .find(value => value.length >= 16) || '';
}

function signingKey(env) {
  const secret = secretSource(env);
  if (!secret) return null;
  const pinBinding = createHash('sha256')
    .update(String(env?.POOL_SIDE_PIN || '7900').trim())
    .digest('hex');
  return createHash('sha256')
    .update(`serenity-shores-poolside-pulse:vx:pushcut-capability:v1\0${secret}\0${pinBinding}`)
    .digest();
}

function validEventId(value) {
  return typeof value === 'string' && EVENT_ID_PATTERN.test(value.trim());
}

function validPurpose(value) {
  return typeof value === 'string' && PURPOSES.has(value);
}

function payload(eventId, purpose, expiresAt, version = CAPABILITY_VERSION, notBefore = 0) {
  return version === SCHEDULED_CAPABILITY_VERSION
    ? [
        String(SCHEDULED_CAPABILITY_VERSION),
        purpose,
        eventId,
        String(notBefore),
        String(expiresAt)
      ].join('\n')
    : [
        String(CAPABILITY_VERSION),
        purpose,
        eventId,
        String(expiresAt)
      ].join('\n');
}

function signature(eventId, purpose, expiresAt, key, version = CAPABILITY_VERSION, notBefore = 0) {
  return createHmac('sha256', key)
    .update(payload(eventId, purpose, expiresAt, version, notBefore))
    .digest('base64url');
}

function equalText(left, right) {
  const leftHash = createHash('sha256').update(String(left)).digest();
  const rightHash = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function cleanHost(value) {
  const host = String(value || '').split(',')[0].trim().toLowerCase();
  if (!host || host.length > 253 || !/^[a-z0-9.-]+(?::\d{1,5})?$/.test(host)) return '';
  return host;
}

export function pushcutXCapabilityReady(env = process.env) {
  return Boolean(signingKey(env));
}

export function createPushcutXCapability(eventId, purpose, {
  env = process.env,
  now = Date.now,
  ttlSeconds = DEFAULT_CAPABILITY_TTL_SECONDS,
  notBeforeMs = 0
} = {}) {
  const cleanEventId = String(eventId || '').trim();
  if (!validEventId(cleanEventId) || !validPurpose(purpose)) return null;
  const key = signingKey(env);
  if (!key) return null;
  const nowSeconds = Math.floor(Number(now()) / 1000);
  const requestedNotBefore = Math.floor(Number(notBeforeMs || 0) / 1000);
  const scheduled = requestedNotBefore > nowSeconds;
  const notBefore = scheduled ? requestedNotBefore : 0;
  if (scheduled && notBefore > nowSeconds + CAPABILITY_MAX_FUTURE_SECONDS) return null;
  const boundedTtl = Math.max(
    60,
    Math.min(CAPABILITY_MAX_TTL_SECONDS, Math.floor(Number(ttlSeconds) || DEFAULT_CAPABILITY_TTL_SECONDS))
  );
  const version = scheduled ? SCHEDULED_CAPABILITY_VERSION : CAPABILITY_VERSION;
  const expiresAt = (scheduled ? notBefore : nowSeconds) + boundedTtl;
  return Object.freeze({
    version,
    eventId: cleanEventId,
    purpose,
    notBefore,
    expiresAt,
    signature: signature(cleanEventId, purpose, expiresAt, key, version, notBefore)
  });
}

export function verifyPushcutXCapability(value, purpose, {
  env = process.env,
  now = Date.now
} = {}) {
  if (!value || typeof value !== 'object' || !validPurpose(purpose)) return false;
  const eventId = String(value.eventId || '').trim();
  const version = Number(value.version || CAPABILITY_VERSION);
  const notBefore = Number(value.notBefore || 0);
  const expiresAt = Number(value.expiresAt);
  const suppliedSignature = String(value.signature || '');
  if (
    !validEventId(eventId)
    || ![CAPABILITY_VERSION, SCHEDULED_CAPABILITY_VERSION].includes(version)
    || !Number.isSafeInteger(notBefore)
    || notBefore < 0
    || !Number.isSafeInteger(expiresAt)
    || expiresAt < 1
    || !/^[A-Za-z0-9_-]{40,60}$/.test(suppliedSignature)
  ) return false;
  const nowSeconds = Math.floor(Number(now()) / 1000);
  if (version === SCHEDULED_CAPABILITY_VERSION) {
    if (
      notBefore < 1
      || notBefore > nowSeconds + CAPABILITY_MAX_FUTURE_SECONDS + CAPABILITY_CLOCK_SKEW_SECONDS
      || nowSeconds < notBefore - CAPABILITY_CLOCK_SKEW_SECONDS
      || expiresAt < nowSeconds - CAPABILITY_CLOCK_SKEW_SECONDS
      || expiresAt > notBefore + CAPABILITY_MAX_TTL_SECONDS
    ) return false;
  } else if (
    notBefore !== 0
    || expiresAt < nowSeconds - CAPABILITY_CLOCK_SKEW_SECONDS
    || expiresAt > nowSeconds + CAPABILITY_MAX_TTL_SECONDS + CAPABILITY_CLOCK_SKEW_SECONDS
  ) return false;
  const key = signingKey(env);
  if (!key) return false;
  return equalText(
    suppliedSignature,
    signature(eventId, purpose, expiresAt, key, version, notBefore)
  );
}

export function pushcutXPublicBaseUrl(req, env = process.env) {
  const configured = String(env?.PUSHCUT_PUBLIC_BASE_URL_X || '').trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' && url.username === '' && url.password === '' && url.pathname === '/' && !url.search && !url.hash) {
        return url.origin;
      }
    } catch {}
  }

  const vercelHost = cleanHost(env?.VERCEL_URL);
  if (env?.VERCEL === '1') {
    return vercelHost ? `https://${vercelHost}` : '';
  }

  const host = cleanHost(header(req, 'x-forwarded-host') || header(req, 'host'));
  if (!host) return '';
  const forwardedProtocol = header(req, 'x-forwarded-proto').split(',')[0].trim().toLowerCase();
  const protocol = forwardedProtocol === 'http' && env?.VERCEL !== '1' ? 'http' : 'https';
  return `${protocol}://${host}`;
}

export function createSignedPushcutXUrl(req, pathname, eventId, purpose, options = {}) {
  const baseUrl = pushcutXPublicBaseUrl(req, options.env || process.env);
  const capability = createPushcutXCapability(eventId, purpose, options);
  if (
    !baseUrl
    || !capability
    || PURPOSE_PATHS[purpose] !== String(pathname || '')
  ) return null;
  const url = new URL(String(pathname), baseUrl);
  url.searchParams.set('v', 'x');
  url.searchParams.set('eventId', capability.eventId);
  if (capability.version === SCHEDULED_CAPABILITY_VERSION) {
    url.searchParams.set('cv', String(capability.version));
    url.searchParams.set('nbf', String(capability.notBefore));
  }
  url.searchParams.set('exp', String(capability.expiresAt));
  url.searchParams.set('sig', capability.signature);
  return Object.freeze({
    url: url.toString(),
    expiresAt: capability.expiresAt * 1000
  });
}

export function readPushcutXCapability(req) {
  try {
    const url = new URL(String(req?.url || ''), 'https://poolside.local');
    return {
      version: Number(url.searchParams.get('cv') || CAPABILITY_VERSION),
      eventId: String(url.searchParams.get('eventId') || '').trim(),
      notBefore: Number(url.searchParams.get('nbf') || 0),
      expiresAt: Number(url.searchParams.get('exp')),
      signature: String(url.searchParams.get('sig') || '')
    };
  } catch {
    return { version: 0, eventId: '', notBefore: 0, expiresAt: 0, signature: '' };
  }
}
