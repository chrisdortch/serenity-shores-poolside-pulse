import { createHash } from 'node:crypto';

import {
  clearSessionCookie,
  clientIp,
  createSessionToken,
  isSameOriginMutation,
  pinMatches,
  readJsonBody,
  readSession,
  renewSessionIfNeeded,
  sessionSecurityReady,
  sessionVariant,
  setSessionCookie
} from './_auth.js';
import { versionXStorageKey } from './_version-x-namespace.js';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
const LOGIN_WINDOW_SECONDS = Math.ceil(LOGIN_WINDOW_MS / 1000);
const LOGIN_ATTEMPT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("TTL", KEYS[1])
if ttl < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

globalThis.__POOL_SIDE_LOGIN_ATTEMPTS__ ||= new Map();

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Cookie');
  res.end(JSON.stringify(body));
}

function attemptStoreKey(ip, req) {
  return sessionVariant(req) === 'x'
    ? versionXStorageKey(`x:${ip}`)
    : ip;
}

function attemptEntry(ip, req, now = Date.now()) {
  const store = globalThis.__POOL_SIDE_LOGIN_ATTEMPTS__;
  const key = attemptStoreKey(ip, req);
  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { failures: 0, resetAt: now + LOGIN_WINDOW_MS };
    store.set(key, entry);
  }
  if (store.size > 500) {
    for (const [key, value] of store) {
      if (value.resetAt <= now) store.delete(key);
    }
    while (store.size > 400) store.delete(store.keys().next().value);
  }
  return entry;
}

function limiterKvReady() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function limiterKey(ip, req) {
  const digest = createHash('sha256').update(String(ip)).digest('hex').slice(0, 32);
  if (sessionVariant(req) === 'x') {
    return versionXStorageKey(`poolside:vx:login:${digest}`);
  }
  return `poolside:vfinal:login:${digest}`;
}

async function limiterKv(command) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(process.env.KV_REST_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error('Login protection storage is unavailable.');
    return data.result;
  } catch {
    throw new Error('Login protection storage is unavailable.');
  } finally {
    clearTimeout(timer);
  }
}

async function reserveAttempt(ip, req) {
  if (!limiterKvReady()) {
    const entry = attemptEntry(ip, req);
    entry.failures += 1;
    return {
      blocked: entry.failures > LOGIN_MAX_FAILURES,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000))
    };
  }
  const result = await limiterKv([
    'EVAL',
    LOGIN_ATTEMPT_SCRIPT,
    '1',
    limiterKey(ip, req),
    String(LOGIN_WINDOW_SECONDS)
  ]);
  if (!Array.isArray(result) || result.length < 2) throw new Error('Login protection storage is unavailable.');
  return {
    blocked: Number(result[0]) > LOGIN_MAX_FAILURES,
    retryAfterSeconds: Math.max(1, Number(result[1]) || LOGIN_WINDOW_SECONDS)
  };
}

async function clearFailures(ip, req) {
  globalThis.__POOL_SIDE_LOGIN_ATTEMPTS__.delete(attemptStoreKey(ip, req));
  if (limiterKvReady()) await limiterKv(['DEL', limiterKey(ip, req)]);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!isSameOriginMutation(req)) return json(res, 403, { ok: false, authenticated: false, error: 'Same-origin request required.' });
    if (!sessionSecurityReady(req)) {
      return json(res, 503, { ok: false, authenticated: false, error: 'Secure session service is unavailable.' });
    }
    const currentSession = readSession(req);
    const session = currentSession
      ? renewSessionIfNeeded(req, res, currentSession).session
      : null;
    return json(res, 200, {
      ok: true,
      authenticated: Boolean(session),
      expiresAt: session ? session.exp * 1000 : null
    });
  }

  if (req.method === 'POST') {
    if (!isSameOriginMutation(req)) return json(res, 403, { ok: false, authenticated: false, error: 'Same-origin request required.' });
    if (!sessionSecurityReady(req)) return json(res, 503, { ok: false, authenticated: false, error: 'Secure session service is unavailable.' });

    let body;
    try { body = await readJsonBody(req, 2_000); }
    catch { return json(res, 400, { ok: false, authenticated: false, error: 'Invalid sign-in request.' }); }

    const ip = clientIp(req);
    let attempt;
    try { attempt = await reserveAttempt(ip, req); }
    catch { return json(res, 503, { ok: false, authenticated: false, error: 'Sign-in protection is temporarily unavailable.' }); }
    if (attempt.blocked) {
      res.setHeader('Retry-After', String(attempt.retryAfterSeconds));
      return json(res, 429, { ok: false, authenticated: false, error: 'Too many sign-in attempts. Try again later.' });
    }

    if (!pinMatches(body?.pin)) {
      return json(res, 401, { ok: false, authenticated: false, error: 'Incorrect PIN.' });
    }

    try { await clearFailures(ip, req); }
    catch { return json(res, 503, { ok: false, authenticated: false, error: 'Sign-in protection is temporarily unavailable.' }); }
    const token = createSessionToken(Date.now(), req);
    if (!token) return json(res, 503, { ok: false, authenticated: false, error: 'Secure session service is unavailable.' });
    setSessionCookie(res, req, token);
    return json(res, 200, { ok: true, authenticated: true });
  }

  if (req.method === 'DELETE') {
    if (!isSameOriginMutation(req)) return json(res, 403, { ok: false, authenticated: false, error: 'Same-origin request required.' });
    clearSessionCookie(res, req);
    return json(res, 200, { ok: true, authenticated: false });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return json(res, 405, { ok: false, error: 'GET, POST, or DELETE required.' });
}
