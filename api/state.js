function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const STATE_KEY = 'serenity-shores-poolside-radio-v32';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 250000) reject(new Error('Request too large.')); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function kvReady() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kv(command) {
  const response = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || `KV returned HTTP ${response.status}`);
  return data.result;
}

export default async function handler(req, res) {
  try {
    if (!kvReady()) {
      return json(res, 200, {
        ok: true,
        cloudSync: false,
        state: null,
        note: 'Cloud sync is not configured yet. Add Vercel KV / Upstash Redis environment variables KV_REST_API_URL and KV_REST_API_TOKEN to this project.'
      });
    }

    if (req.method === 'GET') {
      const raw = await kv(['GET', STATE_KEY]);
      return json(res, 200, { ok: true, cloudSync: true, state: raw ? JSON.parse(raw) : null });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const state = body.state || {};
      if (!state || typeof state !== 'object') return json(res, 400, { ok: false, error: 'state object required.' });
      const safe = {
        ...state,
        savedAt: Date.now(),
        revision: Number(state.revision || 0) + 1
      };
      const raw = JSON.stringify(safe);
      if (raw.length > 200000) return json(res, 400, { ok: false, error: 'State too large.' });
      await kv(['SET', STATE_KEY, raw]);
      return json(res, 200, { ok: true, cloudSync: true, state: safe });
    }

    return json(res, 405, { ok: false, error: 'GET or POST required.' });
  } catch (error) {
    return json(res, 500, { ok: false, cloudSync: false, error: error.message || 'State sync failed.' });
  }
}
