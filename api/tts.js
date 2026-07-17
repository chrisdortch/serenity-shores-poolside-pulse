import { clientIp, consumeRateLimit, requireSession } from './_auth.js';
import {
  generateNaturalSpeech,
  NATURAL_SPEECH_MAX_CHARACTERS,
  NaturalSpeechError
} from './_tts.js';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

const TTS_RATE_LIMIT = 12;
const TTS_RATE_WINDOW_MS = 60_000;

export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'POST required.' });
  }

  const rate = consumeRateLimit(`tts:${session.sid}:${clientIp(req)}`, {
    limit: TTS_RATE_LIMIT,
    windowMs: TTS_RATE_WINDOW_MS
  });
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return json(res, 429, { ok: false, error: 'Too many voice requests. Try again shortly.' });
  }

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(res, 400, { ok: false, error: 'Invalid JSON body.' });
  }

  const input = String(body.text || '').trim();
  if (!input) return json(res, 400, { ok: false, error: 'Text is required.' });
  if (input.length > NATURAL_SPEECH_MAX_CHARACTERS) {
    return json(res, 400, {
      ok: false,
      error: `Text is too long for one announcement. Keep it under ${NATURAL_SPEECH_MAX_CHARACTERS} characters.`
    });
  }

  try {
    const speech = await generateNaturalSpeech({
      text: input,
      voice: body.voice,
      instructions: body.instructions
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', speech.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(speech.buffer);
    return;
  } catch (error) {
    const safe = error instanceof NaturalSpeechError
      ? error
      : new NaturalSpeechError('unavailable');
    if (safe.statusCode === 429) res.setHeader('Retry-After', '30');
    return json(res, safe.statusCode, { ok: false, error: safe.message });
  }
}
