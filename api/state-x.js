import { requireSession, sessionVariant } from './_auth.js';

const X_STATE_VERSION = 'x';
const X_STATE_KEY = 'serenity-shores-poolside-radio-vx-20260714';
const KV_REQUEST_TIMEOUT_MS = 8_000;
const MAX_REQUEST_BYTES = 1_100_000;
const MAX_STATE_BYTES = 1_000_000;
const X_COMPARE_AND_SET_SCRIPT = `
local current = redis.call("GET", KEYS[1])
local currentRevision = 0
if current then
  local decodedOk, decoded = pcall(cjson.decode, current)
  if decodedOk and type(decoded) == "table" then
    local candidate = tonumber(decoded.revision)
    if candidate and candidate >= 0 and candidate == math.floor(candidate) then
      currentRevision = candidate
    end
  end
end
if currentRevision ~= tonumber(ARGV[1]) then
  return {0, currentRevision, current or ""}
end
redis.call("SET", KEYS[1], ARGV[2])
return {1, currentRevision + 1}
`;

let coreNormalizerPromise;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Cookie');
  res.end(JSON.stringify(body));
}

function stateRevision(state) {
  const revision = Number(state?.revision);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeClone(value, depth = 0) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 20_000);
  if (depth >= 12) return null;
  if (Array.isArray(value)) return value.slice(0, 500).map(item => safeClone(item, depth + 1));
  if (!isRecord(value)) return null;
  const clean = {};
  for (const [key, item] of Object.entries(value).slice(0, 400)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
    clean[String(key).slice(0, 160)] = safeClone(item, depth + 1);
  }
  return clean;
}

function sanitizeConfig(value) {
  const source = isRecord(value) ? safeClone(value) : {};
  const clean = {
    ...source,
    musicProvider: source.musicProvider === 'apple' ? 'apple' : 'controlled',
    musicLevel: clamp(source.musicLevel, 0, 100, 30),
    voiceLevel: clamp(source.voiceLevel, 0, 100, 100),
    // Version X guarantees no music/voice overlap. A spoken announcement fully
    // silences the music path, while music and voice levels remain adjustable.
    duckLevel: 0
  };
  for (const key of [
    'appleMusicPrivateKey',
    'applePrivateKey',
    'privateKey',
    'APPLE_MUSIC_PRIVATE_KEY'
  ]) delete clean[key];
  return clean;
}

function fallbackNormalizeState(value, now = Date.now()) {
  const source = isRecord(value) ? safeClone(value) : {};
  return {
    ...source,
    version: X_STATE_VERSION,
    config: sanitizeConfig(source.config),
    events: (Array.isArray(source.events) ? source.events : [])
      .filter(event => isRecord(event) && String(event.id || '').trim())
      .slice(-120),
    activityLog: (Array.isArray(source.activityLog) ? source.activityLog : [])
      .filter(entry => isRecord(entry) && String(entry.id || '').trim())
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
      .slice(0, 180),
    savedAt: Math.max(0, Number(source.savedAt || now) || now),
    revision: stateRevision(source)
  };
}

async function coreNormalizer() {
  coreNormalizerPromise ||= import('../src/vx/core.js')
    .then(module => typeof module.normalizeState === 'function' ? module.normalizeState : null)
    .catch(() => null);
  return await coreNormalizerPromise;
}

async function sanitizeXState(value, now = Date.now()) {
  const source = isRecord(value) ? safeClone(value) : {};
  const normalizeState = await coreNormalizer();
  if (normalizeState) {
    try {
      const normalized = normalizeState(source, now);
      if (isRecord(normalized)) {
        const clean = safeClone(normalized);
        return {
          ...clean,
          version: X_STATE_VERSION,
          config: sanitizeConfig({
            ...(isRecord(clean.config) ? clean.config : {}),
            ...(isRecord(source.config) ? source.config : {})
          }),
          savedAt: Math.max(0, Number(clean.savedAt || now) || now),
          revision: stateRevision(clean)
        };
      }
    } catch {}
  }
  return fallbackNormalizeState(source, now);
}

function mergeById(limit, newestFirst, ...lists) {
  const merged = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isRecord(item) || !String(item.id || '').trim()) continue;
      const id = String(item.id).slice(0, 160);
      merged.set(id, { ...(merged.get(id) || {}), ...safeClone(item), id });
    }
  }
  const sorted = [...merged.values()].sort((left, right) => {
    const leftAt = Number(left.createdAt || left.ts || 0);
    const rightAt = Number(right.createdAt || right.ts || 0);
    return newestFirst ? rightAt - leftAt : leftAt - rightAt;
  });
  return newestFirst ? sorted.slice(0, limit) : sorted.slice(-limit);
}

async function sanitizeStoredState(value, now = Date.now()) {
  if (!isRecord(value)) return null;
  const safe = await sanitizeXState(value, now);
  return {
    ...safe,
    version: X_STATE_VERSION,
    savedAt: Math.max(0, Number(value.savedAt || safe.savedAt || 0) || 0),
    revision: stateRevision(value)
  };
}

async function finalizeState(incoming, previous, now = Date.now()) {
  const previousRevision = stateRevision(previous);
  if (previousRevision >= Number.MAX_SAFE_INTEGER) {
    const error = new Error('State revision limit reached; the Version X state store must be repaired.');
    error.statusCode = 409;
    throw error;
  }
  const previousSafe = await sanitizeStoredState(previous, now);
  const source = isRecord(incoming) ? safeClone(incoming) : {};
  const merged = {
    ...(previousSafe || {}),
    ...source,
    version: X_STATE_VERSION,
    config: {
      ...(previousSafe?.config || {}),
      ...(isRecord(source.config) ? source.config : {})
    },
    events: mergeById(120, false, previousSafe?.events, source.events),
    activityLog: mergeById(180, true, previousSafe?.activityLog, source.activityLog)
  };
  const safe = await sanitizeXState(merged, now);
  return {
    ...safe,
    version: X_STATE_VERSION,
    savedAt: now,
    revision: previousRevision + 1
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    let raw;
    try { raw = JSON.stringify(req.body); }
    catch {
      const error = new Error('Invalid JSON body.');
      error.statusCode = 400;
      throw error;
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) {
      const error = new Error('Request exceeds the 1.1 MB limit.');
      error.statusCode = 413;
      throw error;
    }
    return req.body;
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > MAX_REQUEST_BYTES) {
      const error = new Error('Request exceeds the 1.1 MB limit.');
      error.statusCode = 413;
      throw error;
    }
    try { return JSON.parse(req.body || '{}'); }
    catch {
      const error = new Error('Invalid JSON body.');
      error.statusCode = 400;
      throw error;
    }
  }
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      received += buffer.byteLength;
      if (received > MAX_REQUEST_BYTES) {
        const error = new Error('Request exceeds the 1.1 MB limit.');
        error.statusCode = 413;
        return fail(error);
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks, received).toString('utf8')) : {}); }
      catch {
        const error = new Error('Invalid JSON body.');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', fail);
  });
}

function kvReady() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kv(command) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KV_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(process.env.KV_REST_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error('Version X state storage is unavailable.');
    return data.result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Version X state storage timed out.');
    throw new Error('Version X state storage is unavailable.');
  } finally {
    clearTimeout(timer);
  }
}

function memoryStates() {
  globalThis.__POOL_SIDE_X_MEMORY_STATES__ ||= Object.create(null);
  return globalThis.__POOL_SIDE_X_MEMORY_STATES__;
}

function memoryLocks() {
  globalThis.__POOL_SIDE_X_MEMORY_STATE_LOCKS__ ||= new Map();
  return globalThis.__POOL_SIDE_X_MEMORY_STATE_LOCKS__;
}

async function withMemoryLock(operation) {
  const locks = memoryLocks();
  const previous = locks.get(X_STATE_KEY) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  locks.set(X_STATE_KEY, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(X_STATE_KEY) === tail) locks.delete(X_STATE_KEY);
  }
}

function versionXRequired(req, res) {
  if (sessionVariant(req) === 'x') return true;
  json(res, 400, {
    ok: false,
    error: 'Version X requests must use ?v=x.',
    serverTime: Date.now()
  });
  return false;
}

export default async function handler(req, res) {
  try {
    if (!versionXRequired(req, res)) return;

    if (req.method === 'GET') {
      if (!requireSession(req, res)) return;
      const hasKv = kvReady();
      const stored = hasKv
        ? parseState(await kv(['GET', X_STATE_KEY]))
        : memoryStates()[X_STATE_KEY] || null;
      const state = await sanitizeStoredState(stored);
      return json(res, 200, {
        ok: true,
        cloudSync: hasKv,
        syncMode: hasKv ? 'kv' : 'memory',
        serverTime: Date.now(),
        state,
        note: hasKv
          ? 'Version X KV cloud sync active.'
          : 'Temporary Version X server memory is active on this instance only. Add Vercel KV/Upstash for durable cloud sync.'
      });
    }

    if (req.method === 'POST') {
      if (!requireSession(req, res)) return;
      const body = await readBody(req);
      if (body?.version != null && String(body.version).trim().toLowerCase() !== X_STATE_VERSION) {
        return json(res, 400, { ok: false, error: 'Version X state requires version "x".', serverTime: Date.now() });
      }
      const state = body?.state;
      if (!isRecord(state)) {
        return json(res, 400, { ok: false, error: 'state object required.', serverTime: Date.now() });
      }
      if (state.version != null && String(state.version).trim().toLowerCase() !== X_STATE_VERSION) {
        return json(res, 400, { ok: false, error: 'Version X state requires version "x".', serverTime: Date.now() });
      }
      const expectedRevision = body.expectedRevision;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return json(res, 400, {
          ok: false,
          error: 'expectedRevision must be a non-negative integer.',
          serverTime: Date.now()
        });
      }

      const hasKv = kvReady();
      const writeState = async () => {
        const previous = hasKv
          ? parseState(await kv(['GET', X_STATE_KEY]))
          : memoryStates()[X_STATE_KEY] || null;
        const previousRevision = stateRevision(previous);
        if (expectedRevision !== previousRevision) {
          return {
            conflict: true,
            currentRevision: previousRevision,
            currentState: await sanitizeStoredState(previous)
          };
        }

        const safe = await finalizeState(state, previous);
        const raw = JSON.stringify(safe);
        if (Buffer.byteLength(raw, 'utf8') > MAX_STATE_BYTES) return { tooLarge: true };

        if (hasKv) {
          const cas = await kv([
            'EVAL',
            X_COMPARE_AND_SET_SCRIPT,
            '1',
            X_STATE_KEY,
            String(expectedRevision),
            raw
          ]);
          if (!Array.isArray(cas) || cas.length < 2) throw new Error('Version X state storage is unavailable.');
          if (Number(cas[0]) !== 1) {
            const currentRevision = Number.isSafeInteger(Number(cas[1])) && Number(cas[1]) >= 0
              ? Number(cas[1])
              : 0;
            return {
              conflict: true,
              currentRevision,
              currentState: await sanitizeStoredState(parseState(cas[2]))
            };
          }
        } else {
          memoryStates()[X_STATE_KEY] = safe;
        }
        return { safe };
      };

      const result = hasKv ? await writeState() : await withMemoryLock(writeState);
      if (result.conflict) {
        return json(res, 409, {
          ok: false,
          cloudSync: hasKv,
          syncMode: hasKv ? 'kv' : 'memory',
          error: 'State revision conflict. Refresh and retry.',
          state: result.currentState,
          revision: result.currentRevision,
          currentRevision: result.currentRevision,
          serverTime: Date.now()
        });
      }
      if (result.tooLarge) {
        return json(res, 400, {
          ok: false,
          error: 'Saved Version X schedules exceed the 1 MB state limit.',
          serverTime: Date.now()
        });
      }
      return json(res, 200, {
        ok: true,
        cloudSync: hasKv,
        syncMode: hasKv ? 'kv' : 'memory',
        serverTime: Date.now(),
        state: result.safe,
        note: hasKv
          ? 'Version X KV cloud sync active.'
          : 'Temporary Version X server memory is active on this instance only. Add Vercel KV/Upstash for durable cloud sync.'
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'GET or POST required.', serverTime: Date.now() });
  } catch (error) {
    const status = [400, 409, 413].includes(Number(error?.statusCode)) ? Number(error.statusCode) : 500;
    const message = status < 500 ? String(error.message || 'Invalid Version X state request.') : 'Version X state sync failed.';
    return json(res, status, { ok: false, cloudSync: false, error: message, serverTime: Date.now() });
  }
}

function parseState(raw) {
  if (!raw) return null;
  if (isRecord(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
