import {
  clientIp,
  consumeRateLimit,
  readJsonBody,
  requireSession,
  sessionVariant
} from './_auth.js';
import {
  claimEmailWakeXBrowserExecution,
  EmailWakeXError,
  emailWakeXHealth,
  releaseEmailWakeXExecution,
  validEmailWakeXBrowserAudioLeaseId
} from './_email-wake-x.js';

const RATE_WINDOW_MS = 60_000;
const MAX_REQUEST_BYTES = 2_000;

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

export function createEmailWakeBrowserLeaseXHandler({
  leaseClaimer = claimEmailWakeXBrowserExecution,
  leaseReleaser = releaseEmailWakeXExecution
} = {}) {
  return async function handler(req, res) {
    if (sessionVariant(req) !== 'x') {
      return json(res, 400, {
        ok: false,
        error: 'Version X requests must use ?v=x.'
      });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { ok: false, error: 'POST required.' });
    }
    const session = requireSession(req, res);
    if (!session) return;
    const rate = consumeRateLimit(
      `email-wake:x:browser-lease:${session.sid}:${clientIp(req)}`,
      { limit: 120, windowMs: RATE_WINDOW_MS }
    );
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return json(res, 429, {
        ok: false,
        error: 'Too many browser audio lease requests. Try again shortly.'
      });
    }
    if (!emailWakeXHealth().queueReady) {
      return json(res, 503, {
        ok: false,
        error: 'Durable Version X browser audio coordination is not configured.'
      });
    }
    let body;
    try {
      body = await readJsonBody(req, MAX_REQUEST_BYTES);
    } catch {
      return json(res, 400, {
        ok: false,
        error: 'Invalid browser audio lease request.'
      });
    }
    const action = String(body?.action || '').trim().toLowerCase();
    const leaseId = String(body?.leaseId || '').trim();
    if (
      !['claim', 'release'].includes(action)
      || !validEmailWakeXBrowserAudioLeaseId(leaseId)
    ) {
      return json(res, 400, {
        ok: false,
        error: 'Invalid browser audio lease request.'
      });
    }
    try {
      if (action === 'release') {
        await leaseReleaser(leaseId, { requireDurable: true });
        return json(res, 200, {
          ok: true,
          version: 'x',
          service: 'email-wake-browser-lease-x',
          released: true,
          leaseId
        });
      }
      const result = await leaseClaimer(leaseId, { requireDurable: true });
      return json(res, 200, {
        ok: true,
        version: 'x',
        service: 'email-wake-browser-lease-x',
        ...result
      });
    } catch (error) {
      const safe = error instanceof EmailWakeXError
        ? error
        : new EmailWakeXError('durableUnavailable');
      return json(res, safe.statusCode, {
        ok: false,
        error: safe.message
      });
    }
  };
}

export default createEmailWakeBrowserLeaseXHandler();
