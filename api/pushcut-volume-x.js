import {
  clientIp,
  consumeRateLimit,
  requireSession,
  sessionVariant
} from './_auth.js';
import {
  applyPushcutXMusicVolume,
  PushcutVolumeXError
} from './_pushcut-volume-x.js';

const RATE_LIMIT = 20;
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

export function createPushcutVolumeXHandler({
  applyVolume = applyPushcutXMusicVolume
} = {}) {
  return async function handler(req, res) {
    if (sessionVariant(req) !== 'x') {
      return json(res, 400, { ok: false, error: 'Version X requests must use ?v=x.' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { ok: false, error: 'POST required.' });
    }
    const session = requireSession(req, res);
    if (!session) return;
    const rate = consumeRateLimit(`pushcut:x:volume:${session.sid}:${clientIp(req)}`, {
      limit: RATE_LIMIT,
      windowMs: RATE_WINDOW_MS
    });
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return json(res, 429, { ok: false, error: 'Too many volume requests. Try again shortly.' });
    }

    try {
      const result = await applyVolume();
      return json(res, result.completed ? 200 : 202, {
        ok: true,
        version: 'x',
        action: 'music-volume',
        musicPercent: 30,
        accepted: result.accepted === true,
        completed: result.completed === true,
        status: result.completed === true ? 'completed' : 'accepted',
        note: result.completed === true
          ? 'The Receiver Volume Down Shortcut completed. Poolside Pulse did not measure the physical output volume.'
          : 'Pushcut accepted the Volume Down Shortcut request, but completion was not confirmed.'
      });
    } catch (error) {
      const safe = error instanceof PushcutVolumeXError
        ? error
        : new PushcutVolumeXError('providerRejected');
      return json(res, safe.statusCode, { ok: false, error: safe.message });
    }
  };
}

export default createPushcutVolumeXHandler();
