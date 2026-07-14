import { createPrivateKey, sign as cryptoSign } from 'node:crypto';

import {
  consumeRateLimit,
  requireSession,
  sessionVariant
} from './_auth.js';

const TOKEN_TTL_SECONDS = 15 * 60;
const TOKEN_ISSUED_AT_SKEW_SECONDS = 5;
const TOKEN_RATE_LIMIT = 30;
const TOKEN_RATE_WINDOW_MS = 60_000;

function header(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : String(value || '');
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Origin, Cookie');
  res.end(JSON.stringify(body));
}

function canonicalOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function requestOrigin(req) {
  const supplied = canonicalOrigin(header(req, 'origin'));
  if (supplied) return supplied;
  const host = (header(req, 'x-forwarded-host') || header(req, 'host')).split(',')[0].trim();
  const forwardedProtocol = header(req, 'x-forwarded-proto').split(',')[0].trim().toLowerCase();
  const protocol = forwardedProtocol === 'http' || forwardedProtocol === 'https'
    ? forwardedProtocol
    : (req?.socket?.encrypted || process.env.VERCEL === '1' ? 'https' : 'http');
  return canonicalOrigin(`${protocol}://${host}`);
}

function configuredAllowedOrigins() {
  const raw = String(process.env.APPLE_MUSIC_ALLOWED_ORIGINS || '').trim();
  if (!raw) return { configured: false, valid: true, values: new Set() };
  const entries = raw.split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
  const origins = entries.map(canonicalOrigin);
  return {
    configured: true,
    valid: entries.length > 0 && origins.every(Boolean),
    values: new Set(origins.filter(Boolean))
  };
}

function normalizePrivateKey(value) {
  let key = String(value || '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
}

function signingConfiguration() {
  const teamId = String(process.env.APPLE_MUSIC_TEAM_ID || '').trim();
  const keyId = String(process.env.APPLE_MUSIC_KEY_ID || '').trim();
  const privateKeyText = normalizePrivateKey(process.env.APPLE_MUSIC_PRIVATE_KEY);
  if (!/^[A-Za-z0-9]{6,32}$/.test(teamId) || !/^[A-Za-z0-9]{6,32}$/.test(keyId)) return null;
  if (!/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/.test(privateKeyText)) return null;
  try {
    const privateKey = createPrivateKey(privateKeyText);
    if (privateKey.asymmetricKeyType !== 'ec') return null;
    const curve = privateKey.asymmetricKeyDetails?.namedCurve;
    if (curve && curve !== 'prime256v1') return null;
    return { teamId, keyId, privateKey };
  } catch {
    return null;
  }
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function createDeveloperToken({ teamId, keyId, privateKey, origin }, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const issuedAt = now - TOKEN_ISSUED_AT_SKEW_SECONDS;
  const expiresAt = now + TOKEN_TTL_SECONDS;
  const encodedHeader = encodeJson({ alg: 'ES256', kid: keyId });
  const encodedPayload = encodeJson({
    iss: teamId,
    iat: issuedAt,
    exp: expiresAt,
    origin: [origin]
  });
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = cryptoSign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363'
  });
  if (signature.byteLength !== 64) throw new Error('Apple Music signing failed.');
  return {
    token: `${signingInput}.${signature.toString('base64url')}`,
    expiresAt: expiresAt * 1000
  };
}

export default function handler(req, res) {
  if (sessionVariant(req) !== 'x') {
    return json(res, 400, { ok: false, error: 'Version X requests must use ?v=x.' });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { ok: false, error: 'GET required.' });
  }

  const session = requireSession(req, res);
  if (!session) return;

  const rate = consumeRateLimit(`apple-music-token:x:${session.sid}`, {
    limit: TOKEN_RATE_LIMIT,
    windowMs: TOKEN_RATE_WINDOW_MS
  });
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return json(res, 429, { ok: false, error: 'Too many Apple Music token requests. Try again shortly.' });
  }

  const origin = requestOrigin(req);
  if (!origin) return json(res, 400, { ok: false, error: 'A valid same-origin request is required.' });

  const allowed = configuredAllowedOrigins();
  if (!allowed.valid) {
    return json(res, 503, { ok: false, error: 'Apple Music token service configuration is invalid.' });
  }
  if (allowed.configured && !allowed.values.has(origin)) {
    return json(res, 403, { ok: false, error: 'This origin is not allowed to request an Apple Music token.' });
  }

  const configuration = signingConfiguration();
  if (!configuration) {
    return json(res, 503, { ok: false, error: 'Apple Music token service is not configured.' });
  }

  try {
    const token = createDeveloperToken({ ...configuration, origin });
    return json(res, 200, {
      ok: true,
      token: token.token,
      expiresAt: token.expiresAt,
      origin
    });
  } catch {
    return json(res, 503, { ok: false, error: 'Apple Music token service is temporarily unavailable.' });
  }
}
