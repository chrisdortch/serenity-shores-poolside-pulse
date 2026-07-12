import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';

const SESSION_COOKIE = 'poolside_vfinal_session';
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const SESSION_RENEW_AFTER_SECONDS = 12 * 60 * 60;
const SESSION_CLOCK_SKEW_SECONDS = 5 * 60;
const PRODUCTION_PASSPHRASE_MIN_LENGTH = 8;
const SECRET_CONTEXT = 'serenity-shores-poolside-pulse:vfinal:session:v2:pin-bound';

globalThis.__POOL_SIDE_API_RATE_LIMITS__ ||= new Map();

function validProductionPin(value) {
  const pin = String(value || '').trim();
  return /^\d{4}$/.test(pin) || (pin.length >= PRODUCTION_PASSPHRASE_MIN_LENGTH && pin.length <= 64);
}

function header(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : String(value || '');
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify({ serverTime: Date.now(), ...body }));
}

function sessionSecretSource() {
  const candidates = [
    process.env.POOL_SIDE_SESSION_SECRET,
    process.env.KV_REST_API_TOKEN,
    process.env.OPENAI_API_KEY,
    process.env.XWEATHER_CLIENT_SECRET
  ];
  return candidates.map(value => String(value || '').trim()).find(value => value.length >= 16) || '';
}

function sessionSigningKey() {
  const source = sessionSecretSource();
  if (!source) return null;
  const pinBinding = createHash('sha256').update(expectedPin()).digest('hex');
  return createHash('sha256').update(`${SECRET_CONTEXT}\0${source}\0${pinBinding}`).digest();
}

function sign(encodedPayload, key) {
  return createHmac('sha256', key).update(encodedPayload).digest('base64url');
}

function equalText(left, right) {
  const a = createHash('sha256').update(String(left)).digest();
  const b = createHash('sha256').update(String(right)).digest();
  return timingSafeEqual(a, b);
}

function cookieValues(req) {
  const cookies = {};
  for (const part of header(req, 'cookie').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { cookies[name] = decodeURIComponent(value); }
    catch { cookies[name] = value; }
  }
  return cookies;
}

function secureRequest(req) {
  const forwarded = header(req, 'x-forwarded-proto').split(',')[0].trim().toLowerCase();
  return forwarded === 'https' || Boolean(req?.socket?.encrypted) || process.env.VERCEL === '1';
}

function sessionCookie(token, req, maxAge = SESSION_TTL_SECONDS) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    'Priority=High'
  ];
  if (maxAge <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (secureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

function trimRateLimits(now) {
  const store = globalThis.__POOL_SIDE_API_RATE_LIMITS__;
  if (store.size <= 500) return;
  for (const [key, entry] of store) {
    if (!entry || entry.resetAt <= now) store.delete(key);
  }
  while (store.size > 400) store.delete(store.keys().next().value);
}

export function sessionSecurityReadiness() {
  const configuredPin = String(process.env.POOL_SIDE_PIN || '').trim();
  const production = process.env.VERCEL === '1';
  const pinReady = production
    ? validProductionPin(configuredPin)
    : (!configuredPin || configuredPin.length <= 64);
  const signingReady = Boolean(sessionSigningKey());
  const limiterReady = !production || Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  return {
    ready: signingReady && pinReady && limiterReady,
    signingReady,
    pinReady,
    limiterReady,
    production
  };
}

export function sessionSecurityReady() {
  return sessionSecurityReadiness().ready;
}

export function expectedPin() {
  const configured = String(process.env.POOL_SIDE_PIN || '').trim();
  if (process.env.VERCEL === '1') {
    return validProductionPin(configured) ? configured : '';
  }
  return configured || '7900';
}

export function pinMatches(candidate) {
  const supplied = String(candidate || '').trim();
  if (!supplied || supplied.length > 64) return false;
  return equalText(supplied, expectedPin());
}

export function createSessionToken(nowMs = Date.now()) {
  const key = sessionSigningKey();
  if (!key) return '';
  const issuedAt = Math.floor(nowMs / 1000);
  const payload = {
    v: 1,
    sid: randomBytes(18).toString('base64url'),
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, key)}`;
}

function readSessionToken(token, nowMs = Date.now()) {
  const key = sessionSigningKey();
  if (!key) return null;
  if (!token || token.length > 2048) return null;
  const separator = token.indexOf('.');
  if (separator < 1 || separator !== token.lastIndexOf('.')) return null;
  const encoded = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  const expectedSignature = sign(encoded, key);
  if (!equalText(suppliedSignature, expectedSignature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const now = Math.floor(nowMs / 1000);
    if (payload?.v !== 1 || !/^[A-Za-z0-9_-]{20,80}$/.test(String(payload.sid || ''))) return null;
    if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null;
    if (payload.iat > now + SESSION_CLOCK_SKEW_SECONDS || payload.exp <= now) return null;
    if (payload.exp - payload.iat !== SESSION_TTL_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readSession(req, nowMs = Date.now()) {
  return readSessionToken(cookieValues(req)[SESSION_COOKIE], nowMs);
}

export function renewSessionIfNeeded(req, res, session, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  if (!session || now - session.iat < SESSION_RENEW_AFTER_SECONDS) {
    return { session, renewed: false };
  }
  const token = createSessionToken(nowMs);
  const renewedSession = token ? readSessionToken(token, nowMs) : null;
  if (!renewedSession) return { session, renewed: false };
  setSessionCookie(res, req, token);
  return { session: renewedSession, renewed: true };
}

export function requireSession(req, res) {
  if (!sessionSecurityReady()) {
    json(res, 503, { ok: false, error: 'Secure session service is unavailable.' });
    return null;
  }
  if (!isSameOriginMutation(req)) {
    json(res, 403, { ok: false, error: 'Same-origin request required.' });
    return null;
  }
  const session = readSession(req);
  if (!session) {
    res.setHeader('WWW-Authenticate', 'Session');
    json(res, 401, { ok: false, error: 'Sign in is required.' });
    return null;
  }
  return renewSessionIfNeeded(req, res, session).session;
}

export function setSessionCookie(res, req, token) {
  res.setHeader('Set-Cookie', sessionCookie(token, req));
}

export function clearSessionCookie(res, req) {
  res.setHeader('Set-Cookie', sessionCookie('', req, 0));
}

export function clientIp(req) {
  const forwarded = header(req, 'x-forwarded-for').split(',')[0].trim();
  const value = forwarded || header(req, 'x-real-ip').trim() || String(req?.socket?.remoteAddress || 'unknown');
  return value.replace(/[^0-9A-Fa-f:.]/g, '').slice(0, 80) || 'unknown';
}

export function isSameOriginMutation(req) {
  const fetchSite = header(req, 'sec-fetch-site').trim().toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  const origin = header(req, 'origin').trim();
  if (!origin) return true;
  const host = (header(req, 'x-forwarded-host') || header(req, 'host')).split(',')[0].trim().toLowerCase();
  if (!host) return false;
  const protocol = (header(req, 'x-forwarded-proto').split(',')[0].trim().toLowerCase() || (secureRequest(req) ? 'https' : 'http'));
  try {
    const actual = new URL(origin);
    return actual.protocol === `${protocol}:` && actual.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

export function consumeRateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  const store = globalThis.__POOL_SIDE_API_RATE_LIMITS__;
  trimRateLimits(now);
  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + windowMs };
  entry.count += 1;
  store.set(key, entry);
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
  };
}

export async function readJsonBody(req, maxBytes = 16_000) {
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > maxBytes) throw new Error('Request too large.');
    return req.body;
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body) > maxBytes) throw new Error('Request too large.');
    return JSON.parse(req.body || '{}');
  }
  return await new Promise((resolve, reject) => {
    let raw = '';
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', chunk => {
      if (settled) return;
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) fail(new Error('Request too large.'));
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Invalid JSON body.')); }
    });
    req.on('error', fail);
  });
}

// This module is shared by the protected API handlers. If the file is invoked as
// a route by a filesystem router, it deliberately exposes no diagnostic data.
export default function handler(_req, res) {
  return json(res, 404, { ok: false, error: 'Not found.' });
}
