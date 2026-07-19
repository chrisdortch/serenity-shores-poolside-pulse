import {
  clientIp,
  consumeRateLimit,
  readJsonBody
} from './_auth.js';
import {
  EmailWakeXError,
  consumeEmailWakeXPairingAttempt,
  emailWakeXHealth,
  exchangeEmailWakeXPairingCode
} from './_email-wake-x.js';

const RATE_WINDOW_MS = 15 * 60_000;
const MAX_REQUEST_BYTES = 1_000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(JSON.stringify({ serverTime: Date.now(), ...body }));
}

export function createEmailWakeRegisterXHandler({
  pairingCodeExchanger = exchangeEmailWakeXPairingCode,
  pairingAttemptConsumer = consumeEmailWakeXPairingAttempt
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { ok: false, error: 'POST required.' });
    }
    const rate = consumeRateLimit(`email-wake:x:register:${clientIp(req)}`, {
      limit: 10,
      windowMs: RATE_WINDOW_MS
    });
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return json(res, 429, {
        ok: false,
        error: 'Too many receiver pairing attempts. Try again later.'
      });
    }
    if (!emailWakeXHealth().pairingReady) {
      return json(res, 503, {
        ok: false,
        error: 'Durable Version X receiver pairing is not configured.'
      });
    }
    try {
      const durableAttempt = await pairingAttemptConsumer(clientIp(req), {
        requireDurable: true
      });
      if (!durableAttempt.allowed) {
        return json(res, 429, {
          ok: false,
          error: 'Too many receiver pairing attempts. Try again later.'
        });
      }
    } catch (error) {
      const safe = error instanceof EmailWakeXError
        ? error
        : new EmailWakeXError('durableUnavailable');
      return json(res, safe.statusCode, { ok: false, error: safe.message });
    }
    let body;
    try {
      body = await readJsonBody(req, MAX_REQUEST_BYTES);
    } catch (error) {
      return json(res, error?.message === 'Request too large.' ? 413 : 400, {
        ok: false,
        error: 'Invalid receiver pairing request.'
      });
    }
    if (
      !body
      || typeof body !== 'object'
      || Array.isArray(body)
      || Object.keys(body).some(key => key !== 'code')
    ) {
      return json(res, 400, {
        ok: false,
        error: 'The one-time pairing code is required.'
      });
    }
    try {
      const result = await pairingCodeExchanger(body.code, {
        requireDurable: true
      });
      return json(res, 201, {
        ok: true,
        version: 'x',
        service: 'email-wake-register-x',
        token: result.receiverToken,
        pairedAt: result.pairedAt,
        durable: result.durable,
        claimPath: '/api/email-wake-claim-x',
        note: 'Store this receiver token in the Receiver Shortcut. It is shown only once.'
      });
    } catch (error) {
      const safe = error instanceof EmailWakeXError
        ? error
        : new EmailWakeXError('durableUnavailable');
      return json(res, safe.statusCode, { ok: false, error: safe.message });
    }
  };
}

export default createEmailWakeRegisterXHandler();
