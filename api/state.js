import { requireSession } from './_auth.js';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const DEFAULT_STATE_KEY = 'serenity-shores-poolside-radio-v9';
const VERSIONED_STATE_KEYS = {
  'final': 'serenity-shores-poolside-radio-vfinal-20260711',
  '23': 'serenity-shores-poolside-radio-v23',
  '22': 'serenity-shores-poolside-radio-v22',
  '21': 'serenity-shores-poolside-radio-v21',
  '20': 'serenity-shores-poolside-radio-v20',
  '18': 'serenity-shores-poolside-radio-v18',
  '17': 'serenity-shores-poolside-radio-v17',
  '16': 'serenity-shores-poolside-radio-v16',
  '15': 'serenity-shores-poolside-radio-v15',
  '14': 'serenity-shores-poolside-radio-v14'
};
const FINAL_STATE_VERSION = 'final';
const KV_REQUEST_TIMEOUT_MS = 8_000;
const FINAL_MAX_REQUEST_BYTES = 1_100_000;
const FINAL_MAX_STATE_BYTES = 1_000_000;
const FINAL_COMPARE_AND_SET_SCRIPT = `
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
const V18_STALE_SUNO_COMMAND_CUTOFF = 1782483347041;
const V18_AUDIO_DEFAULTS_ID = '2026-06-26-v18e-spotify2-suno85-duck0-ann500';
const V20_AUDIO_DEFAULTS_ID = '2026-07-01-v20-14-clear-pa-state-cleanup';
const V21_AUDIO_DEFAULTS_ID = '2026-07-10-v21-manager-gain-gap';
const V22_AUDIO_DEFAULTS_ID = '2026-07-10-v22-max-gap-takeover';
const V23_AUDIO_DEFAULTS_ID = '2026-07-11-v23-audible-bed';
const BUILT_IN_QUIET_BED_URL = 'poolside://quiet-bed/ambient';
const V20_STALE_SPOTIFY_COMMAND_CUTOFF = 1782499126000;
const V18_STALE_SUNO_TYPES = new Set(['suno-cue', 'suno', 'song']);
const V20_STALE_SPOTIFY_TYPES = new Set(['spotify-play', 'play']);

// Safe fallback: lets preview/admin/Home sync work even before Vercel KV/Upstash is configured.
// For production/life-safety reliability, add KV_REST_API_URL and KV_REST_API_TOKEN in Vercel.
globalThis.__POOL_SIDE_MEMORY_STATES__ ||= {};
globalThis.__POOL_SIDE_MEMORY_STATE_LOCKS__ ||= new Map();

async function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > FINAL_MAX_REQUEST_BYTES) {
      const error = new Error('Request exceeds the 1.1 MB limit.');
      error.statusCode = 413;
      throw error;
    }
    return req.body;
  }
  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > FINAL_MAX_REQUEST_BYTES) {
      const error = new Error('Request exceeds the 1.1 MB limit.');
      error.statusCode = 413;
      throw error;
    }
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      const error = new Error('Invalid JSON body.');
      error.statusCode = 400;
      throw error;
    }
  }
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      receivedBytes += buffer.byteLength;
      if (receivedBytes > FINAL_MAX_REQUEST_BYTES) {
        settled = true;
        const error = new Error('Request exceeds the 1.1 MB limit.');
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const raw = chunks.length ? Buffer.concat(chunks, receivedBytes).toString('utf8') : '';
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        const invalid = new Error('Invalid JSON body.');
        invalid.statusCode = 400;
        reject(invalid);
      }
    });
    req.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
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
        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `KV returned HTTP ${response.status}`);
    return data.result;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('KV request timed out after 8 seconds.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function withMemoryStateLock(stateKey, operation) {
  const locks = globalThis.__POOL_SIDE_MEMORY_STATE_LOCKS__;
  const previous = locks.get(stateKey) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  locks.set(stateKey, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(stateKey) === tail) locks.delete(stateKey);
  }
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
  return String(queryVersion || bodyVersion || '').trim().toLowerCase();
}

function stateKeyFor(req, body = {}) {
  return VERSIONED_STATE_KEYS[requestVersion(req, body)] || DEFAULT_STATE_KEY;
}

function isFinalRequest(req, body = {}) {
  return requestVersion(req, body) === FINAL_STATE_VERSION;
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

function staleV18SunoCommand(event) {
  return event &&
    V18_STALE_SUNO_TYPES.has(event.type) &&
    Number(event.createdAt || 0) > 0 &&
    Number(event.createdAt || 0) < V18_STALE_SUNO_COMMAND_CUTOFF;
}

function staleV20SpotifyCommand(event) {
  return event &&
    V20_STALE_SPOTIFY_TYPES.has(event.type) &&
    Number(event.createdAt || 0) > 0 &&
    Number(event.createdAt || 0) < V20_STALE_SPOTIFY_COMMAND_CUTOFF;
}

function staleV18SunoNotice(value) {
  return /Receiver could not start the Suno cue|will retry this music command|not allowed by the user agent/i.test(String(value || ''));
}

function staleV20SpotifyDeviceNotice(value) {
  return /device not found|receiver will retry command|receiver will retry event|transfer is not active|not the audible Spotify device/i.test(String(value || ''));
}

function staleV20IOSVolumeNotice(value) {
  return /iPhone output remains physical|cannot be audibly lowered by JavaScript; .*uses Spotify Connect|Shortcut final action|Shortcut Input bridge|fixed 50%|If branches|fixed Shortcut volume branches|V20\.1[0-3].*(?:pauses music|receiver boost|loud voice|max receiver)|voice 2400%|2400% receiver boost|max receiver boost|plays voice at max receiver boost/i.test(String(value || ''));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

function isSpotifyUrl(value) {
  return /spotify:|open\.spotify\.com\//i.test(String(value || ''));
}

function isSunoOrDirectAudioUrl(value) {
  const raw = String(value || '').trim();
  return /suno\.com\/(?:playlist|playlists|song|songs|s)\//i.test(raw) ||
    /\.(mp3|m4a|aac|wav|ogg|oga|webm)(\?|#|$)/i.test(raw);
}

function quietBedSourceUrl(...candidates) {
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    if (/^poolside:\/\/quiet-bed\//i.test(raw) || isSunoOrDirectAudioUrl(raw)) return raw;
  }
  return BUILT_IN_QUIET_BED_URL;
}

function sanitizeV23QuietBed(clean) {
  if (!clean || typeof clean !== 'object') return clean;
  if (isSpotifyUrl(clean.playlistUrl)) {
    clean.spotifyUrl = clean.spotifyUrl || clean.playlistUrl;
    clean.playlistUrl = '';
  }
  if ((clean.musicProvider === 'suno' || clean.activeMusicProvider === 'suno') && isSpotifyUrl(clean.quickMusicUrl)) {
    clean.spotifyUrl = clean.spotifyUrl || clean.quickMusicUrl;
    clean.quickMusicUrl = '';
  }
  if (clean.activeMusicProvider === 'suno' && (isSpotifyUrl(clean.activeMusicUrl) || !String(clean.activeMusicUrl || '').trim())) {
    clean.activeMusicUrl = quietBedSourceUrl(clean.playlistUrl, clean.quickMusicUrl);
    clean.activeMusicLabel = 'Built-in ambient quiet bed ready. Save a Suno/direct audio URL when you want custom music.';
  }
  if (clean.command?.type === 'quiet-bed-play' && isSpotifyUrl(clean.command.url)) clean.command = null;
  if (Array.isArray(clean.events)) {
    clean.events = clean.events.filter(event => !(event?.kind === 'command' && event.type === 'quiet-bed-play' && isSpotifyUrl(event.url)));
  }
  return clean;
}

function sanitizeFinalState(state) {
  const clean = { ...state, version: FINAL_STATE_VERSION };
  const sourceConfig = state.config && typeof state.config === 'object' && !Array.isArray(state.config)
    ? state.config
    : {};
  clean.config = {
    ...sourceConfig,
    musicLevel: clampNumber(sourceConfig.musicLevel, 0, 100, 30),
    voiceLevel: 100,
    duckLevel: 0
  };
  return clean;
}

function sanitizeFinalNamespaceState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  return sanitizeFinalState({ ...state, version: FINAL_STATE_VERSION });
}

function sanitizeState(state) {
  if (!state || typeof state !== 'object') return state;
  const version = String(state.version || '');
  if (version === FINAL_STATE_VERSION) return sanitizeFinalState(state);
  if (!['18', '20', '21', '22', '23'].includes(version)) return state;
  const modern = version === '20' || version === '21' || version === '22' || version === '23';
  const clean = { ...state };
  if (version === '18' && Array.isArray(clean.events)) clean.events = clean.events.filter(event => !staleV18SunoCommand(event));
  if (version === '18' && staleV18SunoCommand(clean.command)) clean.command = null;
  if (modern && Array.isArray(clean.events)) clean.events = clean.events.filter(event => !staleV20SpotifyCommand(event));
  if (modern && staleV20SpotifyCommand(clean.command)) clean.command = null;
  if (modern && staleV20IOSVolumeNotice(`${clean.command?.label || ''} ${clean.command?.detail || ''} ${clean.command?.text || ''}`)) clean.command = null;
  if (staleV18SunoNotice(clean.setupNotice)) clean.setupNotice = '';
  if (staleV18SunoNotice(clean.feedback)) clean.feedback = 'Ready.';
  if (staleV18SunoNotice(clean.lastError)) clean.lastError = '';
  if (modern) {
    if (Array.isArray(clean.events)) {
      clean.events = clean.events.filter(event => !staleV20IOSVolumeNotice(`${event?.label || ''} ${event?.detail || ''} ${event?.text || ''}`));
    }
    const staleSpotifyDevice = [
      clean.setupNotice,
      clean.feedback,
      clean.lastError,
      clean.spotifyLastError,
      clean.spotifyStatus
    ].some(staleV20SpotifyDeviceNotice);
    if (staleSpotifyDevice) {
      clean.setupNotice = '';
      clean.feedback = 'Ready.';
      clean.lastError = '';
      clean.spotifyLastError = '';
      clean.spotifyStatus = '';
      clean.spotifyDeviceId = '';
      clean.spotifyDeviceName = '';
      clean.spotifyReceiverReadyAt = 0;
      clean.spotifyNeedsTap = true;
    }
    if (staleV20IOSVolumeNotice(clean.spotifyLastError)) clean.spotifyLastError = '';
    if (/(autoplay.*blocked|blocked.*autoplay)/i.test(String(clean.spotifyLastError || '')) && /ready|playing|paused while quiet bed/i.test(String(clean.spotifyStatus || ''))) clean.spotifyLastError = '';
    if (staleV20IOSVolumeNotice(clean.spotifyStatus)) clean.spotifyStatus = '';
    if (staleV20IOSVolumeNotice(clean.spotifyDevicesSummary)) {
      clean.spotifyDevicesSummary = version === '23'
        ? 'V23 Audible Gap mode active: quiet bed uses controllable receiver Web Audio/Suno at 25% by default; spoken word defaults to +800/max PA+; Spotify is paused for voice because iOS cannot make local Spotify quiet.'
        : version === '22'
        ? 'V22 Max Gap mode active: Spotify defaults to -800/0%, spoken word defaults to +800/max PA+, music is silenced and paused during voice.'
        : version === '21'
        ? 'V21 Manager gain mode active: Spotify defaults to -500/1%, spoken word defaults to +500/max PA, music pauses during voice.'
        : 'V20.14 clear PA voice mode active: music pauses during spoken commands, voice plays through the clear voice path, then music restores.';
    }
    if (Array.isArray(clean.activityLog)) {
      clean.activityLog = clean.activityLog.filter(entry => !staleV20IOSVolumeNotice(`${entry?.title || ''} ${entry?.detail || ''}`));
    }
  }
  if (version === '23') sanitizeV23QuietBed(clean);
  const defaultsKey = version === '23' ? 'v23VolumeDefaultsApplied' : version === '22' ? 'v22VolumeDefaultsApplied' : version === '21' ? 'v21VolumeDefaultsApplied' : version === '20' ? 'v20VolumeDefaultsApplied' : 'v18VolumeDefaultsApplied';
  const defaultsId = version === '23' ? V23_AUDIO_DEFAULTS_ID : version === '22' ? V22_AUDIO_DEFAULTS_ID : version === '21' ? V21_AUDIO_DEFAULTS_ID : version === '20' ? V20_AUDIO_DEFAULTS_ID : V18_AUDIO_DEFAULTS_ID;
  if (clean[defaultsKey] !== defaultsId) {
    clean.musicProvider = version === '23' ? 'suno' : clean.musicProvider;
    clean.spotifyVolume = version === '23' ? 25 : version === '22' ? 0 : version === '21' ? 1 : version === '20' ? 15 : 2;
    clean.spotifyGain = (version === '23' || version === '22') ? -800 : version === '21' ? -500 : clean.spotifyGain;
    clean.spokenGain = (version === '23' || version === '22') ? 800 : version === '21' ? 500 : clean.spokenGain;
    clean.sunoVolume = version === '23' ? 25 : version === '22' ? 10 : modern ? 15 : 85;
    clean.announcementGain = (version === '23' || version === '22') ? 64 : version === '21' ? 40 : version === '20' ? 24 : 5;
    clean.spotifyDuckedVolume = 0;
    if (modern) {
      clean.spotifyDeviceId = '';
      clean.spotifyDeviceName = '';
      clean.spotifyReceiverReadyAt = 0;
      clean.spotifyNeedsTap = true;
      clean.iosVolumeBridgeStatus = version === '23'
        ? 'V23 Audible Gap mode: use receiver Web Audio/Suno for the quiet bed at 25% by default; spoken word defaults to +800/max PA+; Spotify remains available but is not the guaranteed low-volume path on iOS.'
        : version === '22'
        ? 'V22 Max Gap mode: Spotify defaults to -800/0%; spoken word defaults to +800/max PA+; music is silenced and paused during announcements, then restores after a hold.'
        : version === '21'
        ? 'V21 Manager gain mode: Spotify defaults to -500/1%; spoken word defaults to +500/max PA; music pauses during announcements, then restores.'
        : 'V20.14 clear PA voice mode: Shortcut is optional. Loud Voice Setup pauses music during spoken commands, plays clean PA-normalized voice, then restores music.';
      clean.iosVolumeBridgeLastTarget = '';
      clean.iosVolumeBridgeLastAt = 0;
    }
    clean[defaultsKey] = defaultsId;
  }
  if (version === '23') sanitizeV23QuietBed(clean);
  clean.spotifyVolume = clampNumber(clean.spotifyVolume, modern ? 0 : 0, modern ? 33 : 20, version === '23' ? 25 : version === '22' ? 0 : version === '21' ? 1 : version === '20' ? 15 : 2);
  clean.sunoVolume = clampNumber(clean.sunoVolume, modern ? 0 : 0, modern ? 33 : 100, version === '23' ? 25 : version === '22' ? 10 : modern ? 15 : 85);
  clean.spotifyDuckedVolume = modern ? clampNumber(clean.spotifyDuckedVolume, 0, 33, 0) : 0;
  clean.announcementGain = clampNumber(clean.announcementGain, 1, (version === '23' || version === '22') ? 64 : version === '21' ? 40 : version === '20' ? 24 : 6, (version === '23' || version === '22') ? 64 : version === '21' ? 40 : version === '20' ? 24 : 5);
  if (version === '23' || version === '22') {
    clean.spotifyGain = clampNumber(clean.spotifyGain, -800, 0, -800);
    clean.spokenGain = clampNumber(clean.spokenGain, 0, 800, 800);
  } else if (version === '21') {
    clean.spotifyGain = clampNumber(clean.spotifyGain, -500, 0, -500);
    clean.spokenGain = clampNumber(clean.spokenGain, 0, 500, 500);
  }
  if (version === '23') sanitizeV23QuietBed(clean);
  return clean;
}

function finalizeState(state, previous = null) {
  const previousRevision = stateRevision(previous);
  if (previousRevision >= Number.MAX_SAFE_INTEGER) throw new Error('State revision limit reached; the state store must be repaired before another write.');
  const previousSafe = sanitizeFinalNamespaceState(previous);
  const incomingConfig = state?.config && typeof state.config === 'object' && !Array.isArray(state.config)
    ? state.config
    : {};
  const merged = {
    ...(previousSafe || {}),
    ...(state || {}),
    version: FINAL_STATE_VERSION,
    config: {
      ...(previousSafe?.config || {}),
      ...incomingConfig
    }
  };
  merged.events = mergeById(80, false, recentEvents(previousSafe?.events), recentEvents(state?.events));
  merged.activityLog = mergeById(160, true, previousSafe?.activityLog, state?.activityLog);
  return sanitizeFinalNamespaceState({
    ...merged,
    savedAt: Date.now(),
    revision: Math.max(previousRevision, stateRevision(state)) + 1
  });
}

function stateRevision(state) {
  const revision = Number(state?.revision);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

export default async function handler(req, res) {
  try {
    const hasKv = kvReady();

    if (req.method === 'GET') {
      if (!isFinalRequest(req)) {
        return json(res, 410, {
          ok: false,
          error: 'Legacy Poolside Pulse state is archived. Use vFinal for active control.',
          serverTime: Date.now()
        });
      }
      if (!requireSession(req, res)) return;
      const stateKey = stateKeyFor(req);
      if (hasKv) {
        const raw = await kv(['GET', stateKey]);
        return json(res, 200, { ok: true, cloudSync: true, syncMode: 'kv', serverTime: Date.now(), state: sanitizeFinalNamespaceState(parseState(raw)), note: 'KV cloud sync active.' });
      }
      return json(res, 200, {
        ok: true,
        cloudSync: false,
        syncMode: 'memory',
        serverTime: Date.now(),
        state: sanitizeFinalNamespaceState(globalThis.__POOL_SIDE_MEMORY_STATES__[stateKey] || null),
        note: 'Temporary server memory is active on this instance only. Add Vercel KV/Upstash for cloud sync.'
      });
    }

    if (req.method === 'POST') {
      if (!isFinalRequest(req)) {
        return json(res, 410, {
          ok: false,
          error: 'Legacy Poolside Pulse state is archived and read-only. Use vFinal for active control.',
          serverTime: Date.now()
        });
      }
      let session = null;
      if (isFinalRequest(req)) {
        session = requireSession(req, res);
        if (!session) return;
      }
      const body = await readBody(req);
      const finalRequest = isFinalRequest(req, body);
      const state = body.state;
      if (!state || typeof state !== 'object' || Array.isArray(state)) return json(res, 400, { ok: false, error: 'state object required.', serverTime: Date.now() });
      if (finalRequest && !session && !requireSession(req, res)) return;
      const expectedRevision = body.expectedRevision;
      if (finalRequest && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
        return json(res, 400, {
          ok: false,
          error: 'expectedRevision must be a non-negative integer.',
          serverTime: Date.now()
        });
      }
      const stateKey = stateKeyFor(req, body);

      const writeState = async () => {
        let previous = null;
        if (hasKv) previous = parseState(await kv(['GET', stateKey]));
        else previous = globalThis.__POOL_SIDE_MEMORY_STATES__[stateKey] || null;
        const previousRevision = stateRevision(previous);
        if (finalRequest && expectedRevision !== previousRevision) {
          return {
            conflict: true,
            currentRevision: previousRevision,
            currentState: sanitizeFinalNamespaceState(previous)
          };
        }
        const safe = finalizeState({ ...state, version: FINAL_STATE_VERSION, revision: previousRevision }, previous);
        const raw = JSON.stringify(safe);
        if (Buffer.byteLength(raw, 'utf8') > FINAL_MAX_STATE_BYTES) return { tooLarge: true, safe: null };
        if (hasKv && finalRequest) {
          const cas = await kv([
            'EVAL',
            FINAL_COMPARE_AND_SET_SCRIPT,
            '1',
            stateKey,
            String(expectedRevision),
            raw
          ]);
          if (!Array.isArray(cas) || cas.length < 2) throw new Error('KV compare-and-set returned an invalid response.');
          if (Number(cas[0]) !== 1) {
            const currentState = sanitizeFinalNamespaceState(parseState(cas[2]));
            return {
              conflict: true,
              currentRevision: stateRevision(currentState),
              currentState
            };
          }
        } else if (hasKv) {
          await kv(['SET', stateKey, raw]);
        } else {
          globalThis.__POOL_SIDE_MEMORY_STATES__[stateKey] = safe;
        }
        return { tooLarge: false, safe };
      };

      let result;
      if (finalRequest && !hasKv) {
        result = await withMemoryStateLock(stateKey, writeState);
      } else {
        result = await writeState();
      }

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
      if (result.tooLarge) return json(res, 400, { ok: false, error: 'Saved schedules exceed the 1 MB state limit. Shorten large custom announcements or remove unused schedules.', serverTime: Date.now() });
      if (hasKv) {
        return json(res, 200, { ok: true, cloudSync: true, syncMode: 'kv', serverTime: Date.now(), state: result.safe, note: 'KV cloud sync active.' });
      }
      return json(res, 200, {
        ok: true,
        cloudSync: false,
        syncMode: 'memory',
        serverTime: Date.now(),
        state: result.safe,
        note: 'Temporary server memory is active on this instance only. Add Vercel KV/Upstash for cloud sync.'
      });
    }

    return json(res, 405, { ok: false, error: 'GET or POST required.', serverTime: Date.now() });
  } catch (error) {
    const status = [400, 413].includes(Number(error?.statusCode)) ? Number(error.statusCode) : 500;
    return json(res, status, { ok: false, cloudSync: false, error: error.message || 'State sync failed.', serverTime: Date.now() });
  }
}
