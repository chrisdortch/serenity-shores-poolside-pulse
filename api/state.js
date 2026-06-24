function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const DEFAULT_STATE_KEY = 'serenity-shores-poolside-radio-v9';
const VERSIONED_STATE_KEYS = {
  '14': 'serenity-shores-poolside-radio-v14'
};

// Safe fallback: lets preview/admin/Home sync work even before Vercel KV/Upstash is configured.
// For production/life-safety reliability, add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel.
globalThis.__POOL_SIDE_MEMORY_STATES__ ||= {};

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

function parseState(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function queryParams(req) {
  const rawUrl = String(req.url || '');
  if (rawUrl) {
    try {
      return Object.fromEntries(new URL(rawUrl, 'https://poolside.local').searchParams.entries());
    } catch {}
  }
  return req.query || {};
}

function requestVersion(req, body = {}) {
  const query = queryParams(req);
  const queryVersion = query.v || query.version;
  const bodyVersion = body.version || body.state?.version;
  return String(queryVersion || bodyVersion || '').trim();
}

function stateKeyFor(req, body = {}) {
  return VERSIONED_STATE_KEYS[requestVersion(req, body)] || DEFAULT_STATE_KEY;
}

function mergeById(limit, sortNewestFirst, ...lists) {
  const map = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || !item.id) continue;
      map.set(item.id, { ...map.get(item.id), ...item });
    }
  }
  const sorted = [...map.values()].sort((a, b) => {
    const at = Number(a.ts || a.createdAt || 0);
    const bt = Number(b.ts || b.createdAt || 0);
    return sortNewestFirst ? bt - at : at - bt;
  });
  return sortNewestFirst ? sorted.slice(0, limit) : sorted.slice(-limit);
}

function recentEvents(events) {
  const cutoff = Date.now() - 45 * 60 * 1000;
  return (Array.isArray(events) ? events : [])
    .filter(event => event && event.id && Number(event.createdAt || 0) >= cutoff);
}

function finalizeState(state, previous = null) {
  const merged = { ...(previous || {}), ...state };
  merged.events = mergeById(80, false, recentEvents(previous?.events), recentEvents(state.events));
  merged.activityLog = mergeById(160, true, previous?.activityLog, state.activityLog);
  return {
    ...merged,
    savedAt: Date.now(),
    revision: Math.max(Number(previous?.revision || 0), Number(state.revision || 0)) + 1
  };
}

export default async function handler(req, res) {
  try {
    const hasKv = kvReady();

    if (req.method === 'GET') {
      const stateKey = stateKeyFor(req);
      if (hasKv) {
        const raw = await kv(['GET', stateKey]);
        return json(res, 200, { ok: true, cloudSync: true, syncMode: 'kv', state: raw ? JSON.parse(raw) : null, note: 'KV cloud sync active.' });
      }
      return json(res, 200, {
        ok: true,
        cloudSync: true,
        syncMode: 'memory',
        state: globalThis.__POOL_SIDE_MEMORY_STATES__[stateKey] || null,
        note: 'Preview sync active using temporary server memory. Add Vercel KV/Upstash for production-grade persistence.'
      });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const state = body.state || {};
      if (!state || typeof state !== 'object') return json(res, 400, { ok: false, error: 'state object required.' });
      const stateKey = stateKeyFor(req, body);

      let previous = null;
      if (hasKv) previous = parseState(await kv(['GET', stateKey]));
      else previous = globalThis.__POOL_SIDE_MEMORY_STATES__[stateKey] || null;

      const safe = finalizeState(state, previous);
      const raw = JSON.stringify(safe);
      if (raw.length > 200000) return json(res, 400, { ok: false, error: 'State too large.' });

      if (hasKv) {
        await kv(['SET', stateKey, raw]);
        return json(res, 200, { ok: true, cloudSync: true, syncMode: 'kv', state: safe, note: 'KV cloud sync active.' });
      }

      globalThis.__POOL_SIDE_MEMORY_STATES__[stateKey] = safe;
      return json(res, 200, {
        ok: true,
        cloudSync: true,
        syncMode: 'memory',
        state: safe,
        note: 'Preview sync active using temporary server memory. Add Vercel KV/Upstash for production-grade persistence.'
      });
    }

    return json(res, 405, { ok: false, error: 'GET or POST required.' });
  } catch (error) {
    return json(res, 500, { ok: false, cloudSync: false, error: error.message || 'State sync failed.' });
  }
}
