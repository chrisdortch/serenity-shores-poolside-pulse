function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

const ALLOWED_VOICES = new Set(['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse','marin','cedar']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST required.' });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return json(res, 501, { ok: false, error: 'Natural AI voice is ready in code but needs OPENAI_API_KEY added in Vercel Environment Variables.' });

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

  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice,
        input,
        instructions,
        response_format: 'mp3'
      })
    });

    if (!r.ok) {
      let detail = '';
      try { detail = await r.text(); } catch {}
      return json(res, r.status, { ok: false, error: `OpenAI TTS failed: ${r.status}`, detail: detail.slice(0, 600) });
    }

    const buffer = Buffer.from(await r.arrayBuffer());
    res.statusCode = 200;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buffer);
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message || 'TTS request failed.' });
  }
}
