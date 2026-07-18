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
import { canonicalPushcutXMusicPercent } from './_pushcut-x.js';
import { readCanonicalVersionXState } from './state-x.js';

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
  applyVolume = applyPushcutXMusicVolume,
  stateReader = readCanonicalVersionXState
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
      let snapshot;
      try {
        snapshot = await stateReader({
          requireDurable: String(process.env.VERCEL || '') === '1'
        });
      } catch {
        throw new PushcutVolumeXError('stateUnavailable');
      }
      const musicPercent = canonicalPushcutXMusicPercent(snapshot?.state, 30);
      const result = await applyVolume({ musicPercent });
      const appliedMusicPercent = typeof result.musicPercent === 'number'
        ? result.musicPercent
        : musicPercent;
      return json(res, result.completed ? 200 : 202, {
        ok: true,
        version: 'x',
        action: 'music-volume',
        musicPercent: appliedMusicPercent,
        accepted: result.accepted === true,
        completed: result.completed === true,
        status: result.completed === true ? 'completed' : 'accepted-uncertain',
        uncertain: result.completed !== true,
        note: result.completed === true
          ? `The Receiver Shortcut completed and restored the saved ${appliedMusicPercent}% music target. Poolside Pulse did not measure the physical output volume.`
          : `Pushcut accepted the saved ${appliedMusicPercent}% music target, but completion was not confirmed because it may be queued behind an announcement.`
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
