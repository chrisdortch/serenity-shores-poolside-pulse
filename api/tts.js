import { clientIp, consumeRateLimit, requireSession } from './_auth.js';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

const ALLOWED_VOICES = new Set(['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse','marin','cedar']);
const TTS_RATE_LIMIT = 12;
const TTS_RATE_WINDOW_MS = 60_000;
const TTS_UPSTREAM_TIMEOUT_MS = 12_000;

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

  const key = process.env.OPENAI_API_KEY;
  if (!key) return json(res, 503, { ok: false, error: 'Natural voice service is not configured.' });

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(res, 400, { ok: false, error: 'Invalid JSON body.' });
  }

  const input = String(body.text || '').trim();
  if (!input) return json(res, 400, { ok: false, error: 'Text is required.' });
  if (input.length > 900) return json(res, 400, { ok: false, error: 'Text is too long for one announcement. Keep it under 900 characters.' });

  const voice = ALLOWED_VOICES.has(body.voice) ? body.voice : 'marin';
  const instructions = String(body.instructions || 'Speak clearly, naturally, warmly, and calmly like a professional resort announcement. For safety messages, sound authoritative without sounding panicked.').slice(0, 700);

  const controller = new AbortController();
  const upstreamTimer = setTimeout(() => controller.abort(), TTS_UPSTREAM_TIMEOUT_MS);
  try {
    let lastError = null;
    for (const format of ['wav', 'mp3']) {
      const r = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          voice,
          input,
          instructions,
          response_format: format
        })
      });

      if (r.ok) {
        const buffer = Buffer.from(await r.arrayBuffer());
        res.statusCode = 200;
        res.setHeader('Content-Type', format === 'wav' ? 'audio/wav' : 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.end(buffer);
        return;
      }

      // Consume the upstream body so the connection can be reused, but never
      // relay provider diagnostics or configuration details to the browser.
      try { await r.arrayBuffer(); } catch {}
      lastError = { status: r.status };
      if (format !== 'wav') break;
    }

    const status = lastError?.status === 429 ? 429 : 502;
    if (status === 429) res.setHeader('Retry-After', '30');
    return json(res, status, {
      ok: false,
      error: status === 429
        ? 'Natural voice service is busy. Try again shortly.'
        : 'Natural voice service could not generate this announcement.'
    });
  } catch (error) {
    const timedOut = controller.signal.aborted || error?.name === 'AbortError';
    return json(res, timedOut ? 504 : 502, {
      ok: false,
      error: timedOut
        ? 'Natural voice service timed out. Try again shortly.'
        : 'Natural voice service is temporarily unavailable.'
    });
  } finally {
    clearTimeout(upstreamTimer);
  }
}
