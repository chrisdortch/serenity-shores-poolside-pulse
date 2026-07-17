import {
  clientIp,
  consumeRateLimit,
  readJsonBody,
  requireSession,
  sessionVariant
} from './_auth.js';
import {
  FiniteAudioXError,
  loadFiniteAnnouncementAudio
} from './_finite-audio-x.js';

const FINITE_AUDIO_RATE_LIMIT = 18;
const FINITE_AUDIO_RATE_WINDOW_MS = 60_000;
const FINITE_AUDIO_REQUEST_MAX_BYTES = 4_000;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(JSON.stringify({ serverTime: Date.now(), ...body }));
}

export function createFiniteAudioXHandler({
  finiteAudioLoader = loadFiniteAnnouncementAudio
} = {}) {
  return async function handler(req, res) {
    if (sessionVariant(req) !== 'x') {
      return json(res, 400, { ok: false, error: 'Version X requests must use ?v=x.' });
    }
    const session = requireSession(req, res);
    if (!session) return;
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, { ok: false, error: 'POST required.' });
    }

    const rate = consumeRateLimit(`finite-audio-x:${session.sid}:${clientIp(req)}`, {
      limit: FINITE_AUDIO_RATE_LIMIT,
      windowMs: FINITE_AUDIO_RATE_WINDOW_MS
    });
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return json(res, 429, {
        ok: false,
        error: 'Too many finite announcement requests. Try again shortly.'
      });
    }

    let body = {};
    try {
      body = await readJsonBody(req, FINITE_AUDIO_REQUEST_MAX_BYTES);
    } catch (error) {
      return json(res, 400, {
        ok: false,
        error: /too large/i.test(String(error?.message || ''))
          ? 'Request too large.'
          : 'Invalid JSON body.'
      });
    }

    try {
      const audio = await finiteAudioLoader({
        provider: body.provider,
        sourceUrl: body.sourceUrl,
        maxDurationSeconds: body.maxDurationSeconds
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', audio.contentType);
      res.setHeader('Content-Length', String(audio.buffer.byteLength));
      res.setHeader('Content-Disposition', `inline; filename="poolside-pulse-finite-announcement.${audio.extension}"`);
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.end(audio.buffer);
    } catch (error) {
      const safe = error instanceof FiniteAudioXError
        ? error
        : new FiniteAudioXError('unavailable');
      return json(res, safe.statusCode, { ok: false, error: safe.message });
    }
  };
}

export default createFiniteAudioXHandler();
