import { requireSession } from './_auth.js';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (!requireSession(req, res)) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { ok: false, error: 'GET required.' });
  }
  const hasKey = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.startsWith('sk-'));
  return json(res, 200, {
    ok: true,
    version: 'final',
    voiceReady: hasKey,
    note: hasKey
      ? 'Natural voice service is ready.'
      : 'Natural voice service is not configured for this deployment.'
  });
}
