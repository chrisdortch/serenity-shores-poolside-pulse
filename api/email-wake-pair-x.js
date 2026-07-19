import {
  clientIp,
  consumeRateLimit,
  requireSession,
  sessionVariant
} from './_auth.js';
import {
  createEmailWakeXPairingCode,
  EmailWakeXError,
  emailWakeXHealth,
  emailWakeXReceiverStatus
} from './_email-wake-x.js';

const RATE_WINDOW_MS = 60_000;

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

export function createEmailWakePairXHandler({
  pairingCodeCreator = createEmailWakeXPairingCode
} = {}) {
  return async function handler(req, res) {
    if (sessionVariant(req) !== 'x') {
      return json(res, 400, {
        ok: false,
        error: 'Version X requests must use ?v=x.'
      });
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { ok: false, error: 'GET or POST required.' });
    }
    const session = requireSession(req, res);
    if (!session) return;
    const rate = consumeRateLimit(
      `email-wake:x:pair:${req.method}:${session.sid}:${clientIp(req)}`,
      { limit: req.method === 'POST' ? 5 : 30, windowMs: RATE_WINDOW_MS }
    );
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return json(res, 429, {
        ok: false,
        error: 'Too many receiver pairing requests. Try again shortly.'
      });
    }
    const health = emailWakeXHealth();
    if (req.method === 'GET') {
      const receiver = health.pairingReady
        ? await emailWakeXReceiverStatus({ requireDurable: true }).catch(() => ({
            receiverPaired: false,
            pairedAt: 0
          }))
        : { receiverPaired: false, pairedAt: 0 };
      return json(res, 200, {
        ok: true,
        version: 'x',
        service: 'email-wake-pair-x',
        ready: health.pairingReady,
        durable: health.durable,
        ...receiver
      });
    }
    if (!health.pairingReady) {
      return json(res, 503, {
        ok: false,
        error: 'Durable Version X receiver pairing is not configured.'
      });
    }
    try {
      const result = await pairingCodeCreator({ requireDurable: true });
      return json(res, 201, {
        ok: true,
        version: 'x',
        service: 'email-wake-pair-x',
        code: result.pairingCode,
        expiresAt: result.expiresAt,
        durable: result.durable,
        exchangePath: '/api/email-wake-register-x',
        note: 'This one-time pairing code expires in 10 minutes.'
      });
    } catch (error) {
      const safe = error instanceof EmailWakeXError
        ? error
        : new EmailWakeXError('durableUnavailable');
      return json(res, safe.statusCode, { ok: false, error: safe.message });
    }
  };
}

export default createEmailWakePairXHandler();
