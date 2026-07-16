import {
  clientIp,
  consumeRateLimit,
  readJsonBody,
  requireSession,
  sessionVariant
} from './_auth.js';
import {
  dispatchPushcutXCommand,
  normalizePushcutXCommand,
  PUSHCUT_X_ACTIONS,
  PushcutXError,
  pushcutXHealth,
  validPushcutXEventId
} from './_pushcut-x.js';

const HEALTH_RATE_LIMIT = 60;
const COMMAND_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_COMMAND_BYTES = 12_000;

function header(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function queryValue(req, name) {
  const rawUrl = String(req?.url || '');
  if (rawUrl) {
    try {
      const value = new URL(rawUrl, 'https://poolside.local').searchParams.get(name);
      if (value != null) return value;
    } catch {}
  }
  const value = req?.query?.[name];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Origin, Cookie');
  res.end(JSON.stringify({ serverTime: Date.now(), ...body }));
}

function limited(req, res, session, purpose, limit) {
  const rate = consumeRateLimit(`pushcut:x:${purpose}:${session.sid}:${clientIp(req)}`, {
    limit,
    windowMs: RATE_WINDOW_MS
  });
  if (rate.allowed) return false;
  res.setHeader('Retry-After', String(rate.retryAfterSeconds));
  json(res, 429, { ok: false, error: 'Too many Pushcut requests. Try again shortly.' });
  return true;
}

export default async function handler(req, res) {
  if (sessionVariant(req) !== 'x') {
    return json(res, 400, { ok: false, error: 'Version X requests must use ?v=x.' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'GET or POST required.' });
  }

  // requireSession selects the isolated Version X cookie from ?v=x and also
  // rejects cross-origin requests before any provider configuration is read.
  const session = requireSession(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    if (limited(req, res, session, 'health', HEALTH_RATE_LIMIT)) return;
    const requestedEventId = queryValue(req, 'eventId').trim();
    if (requestedEventId) {
      if (!validPushcutXEventId(requestedEventId)) {
        return json(res, 400, { ok: false, error: 'The announcement identifier is invalid.' });
      }
      // A 202 nowait response confirms submission only. Until a signed
      // receiver callback is added, do not manufacture a completion receipt.
      return json(res, 200, {
        ok: true,
        version: 'x',
        eventId: requestedEventId,
        status: 'unknown',
        accepted: null,
        completed: false,
        durable: false,
        note: 'No verified Pushcut completion receipt is available for this announcement.'
      });
    }
    const health = pushcutXHealth();
    return json(res, 200, {
      ok: true,
      version: 'x',
      service: 'pushcut',
      ready: health.ready,
      mode: health.mode,
      supportedActions: PUSHCUT_X_ACTIONS,
      readyActions: health.actions,
      note: health.ready
        ? 'Version X Pushcut command service is ready.'
        : 'Version X Pushcut command service is not configured.'
    });
  }

  if (limited(req, res, session, 'command', COMMAND_RATE_LIMIT)) return;

  let body;
  try {
    body = await readJsonBody(req, MAX_COMMAND_BYTES);
  } catch (error) {
    const tooLarge = error?.message === 'Request too large.';
    return json(res, tooLarge ? 413 : 400, {
      ok: false,
      error: tooLarge ? 'Pushcut command is too large.' : 'Invalid JSON body.'
    });
  }

  try {
    const command = normalizePushcutXCommand(body);
    const idempotencyKey = header(req, 'idempotency-key').trim();
    if (idempotencyKey && (!validPushcutXEventId(idempotencyKey) || idempotencyKey !== command.eventId)) {
      throw new PushcutXError('invalid');
    }
    const accepted = await dispatchPushcutXCommand(command);
    return json(res, 202, {
      ok: true,
      version: 'x',
      accepted: accepted.accepted,
      completed: false,
      status: 'accepted',
      mode: accepted.mode,
      action: accepted.action,
      commandId: accepted.commandId,
      eventId: accepted.eventId
    });
  } catch (error) {
    const safe = error instanceof PushcutXError
      ? error
      : new PushcutXError('providerRejected');
    return json(res, safe.statusCode, { ok: false, error: safe.message });
  }
}
