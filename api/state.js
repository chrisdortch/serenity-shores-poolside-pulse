function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const DEFAULT_STATE_KEY = 'serenity-shores-poolside-radio-v9';
const VERSIONED_STATE_KEYS = {
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
const V18_STALE_SUNO_COMMAND_CUTOFF = 1782483347041;
const V18_AUDIO_DEFAULTS_ID = '2026-06-26-v18e-spotify2-suno85-duck0-ann500';
const V20_AUDIO_DEFAULTS_ID = '2026-07-01-v20-14-clear-pa-state-cleanup';
const V21_AUDIO_DEFAULTS_ID = '2026-07-10-v21-manager-gain-gap';
const V22_AUDIO_DEFAULTS_ID = '2026-07-10-v22-max-gap-takeover';
const V23_AUDIO_DEFAULTS_ID = '2026-07-11-v23-guaranteed-gap';
const V20_STALE_SPOTIFY_COMMAND_CUTOFF = 1782499126000;
const V18_STALE_SUNO_TYPES = new Set(['suno-cue', 'suno', 'song']);
const V20_STALE_SPOTIFY_TYPES = new Set(['spotify-play', 'play']);

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

function sanitizeState(state) {
  if (!state || typeof state !== 'object') return state;
  const version = String(state.version || '');
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
    if (staleV20IOSVolumeNotice(clean.spotifyStatus)) clean.spotifyStatus = '';
    if (staleV20IOSVolumeNotice(clean.spotifyDevicesSummary)) {
      clean.spotifyDevicesSummary = version === '23'
        ? 'V23 Guaranteed Gap mode active: quiet bed uses controllable Suno/direct audio at 10%; spoken word defaults to +800/max PA+; Spotify is paused for voice because iOS cannot make local Spotify quiet.'
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
  const defaultsKey = version === '23' ? 'v23VolumeDefaultsApplied' : version === '22' ? 'v22VolumeDefaultsApplied' : version === '21' ? 'v21VolumeDefaultsApplied' : version === '20' ? 'v20VolumeDefaultsApplied' : 'v18VolumeDefaultsApplied';
  const defaultsId = version === '23' ? V23_AUDIO_DEFAULTS_ID : version === '22' ? V22_AUDIO_DEFAULTS_ID : version === '21' ? V21_AUDIO_DEFAULTS_ID : version === '20' ? V20_AUDIO_DEFAULTS_ID : V18_AUDIO_DEFAULTS_ID;
  if (clean[defaultsKey] !== defaultsId) {
    clean.musicProvider = version === '23' ? 'suno' : clean.musicProvider;
    clean.spotifyVolume = (version === '23' || version === '22') ? 0 : version === '21' ? 1 : version === '20' ? 15 : 2;
    clean.spotifyGain = (version === '23' || version === '22') ? -800 : version === '21' ? -500 : clean.spotifyGain;
    clean.spokenGain = (version === '23' || version === '22') ? 800 : version === '21' ? 500 : clean.spokenGain;
    clean.sunoVolume = (version === '23' || version === '22') ? 10 : modern ? 15 : 85;
    clean.announcementGain = (version === '23' || version === '22') ? 64 : version === '21' ? 40 : version === '20' ? 24 : 5;
    clean.spotifyDuckedVolume = 0;
    if (modern) {
      clean.spotifyDeviceId = '';
      clean.spotifyDeviceName = '';
      clean.spotifyReceiverReadyAt = 0;
      clean.spotifyNeedsTap = true;
      clean.iosVolumeBridgeStatus = version === '23'
        ? 'V23 Guaranteed Gap mode: use Suno/direct audio for the quiet bed at 10%; spoken word defaults to +800/max PA+; Spotify remains available but is not the guaranteed low-volume path on iOS.'
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
  clean.spotifyVolume = clampNumber(clean.spotifyVolume, modern ? 0 : 0, modern ? 33 : 20, (version === '23' || version === '22') ? 0 : version === '21' ? 1 : version === '20' ? 15 : 2);
  clean.sunoVolume = clampNumber(clean.sunoVolume, modern ? 0 : 0, modern ? 33 : 100, (version === '23' || version === '22') ? 10 : modern ? 15 : 85);
  clean.spotifyDuckedVolume = modern ? clampNumber(clean.spotifyDuckedVolume, 0, 33, 0) : 0;
  clean.announcementGain = clampNumber(clean.announcementGain, 1, (version === '23' || version === '22') ? 64 : version === '21' ? 40 : version === '20' ? 24 : 6, (version === '23' || version === '22') ? 64 : version === '21' ? 40 : version === '20' ? 24 : 5);
  if (version === '23' || version === '22') {
    clean.spotifyGain = clampNumber(clean.spotifyGain, -800, 0, -800);
    clean.spokenGain = clampNumber(clean.spokenGain, 0, 800, 800);
  } else if (version === '21') {
    clean.spotifyGain = clampNumber(clean.spotifyGain, -500, 0, -500);
    clean.spokenGain = clampNumber(clean.spokenGain, 0, 500, 500);
  }
  return clean;
}

function finalizeState(state, previous = null) {
  const previousSafe = sanitizeState(previous);
  const stateSafe = sanitizeState(state);
  const merged = { ...(previousSafe || {}), ...stateSafe };
  merged.events = mergeById(80, false, recentEvents(previousSafe?.events), recentEvents(stateSafe.events));
  merged.activityLog = mergeById(160, true, previousSafe?.activityLog, stateSafe.activityLog);
  return sanitizeState({
    ...merged,
    savedAt: Date.now(),
    revision: Math.max(Number(previous?.revision || 0), Number(state.revision || 0)) + 1
  });
}

export default async function handler(req, res) {
  try {
    const hasKv = kvReady();

    if (req.method === 'GET') {
      const stateKey = stateKeyFor(req);
      if (hasKv) {
        const raw = await kv(['GET', stateKey]);
        return json(res, 200, { ok: true, cloudSync: true, syncMode: 'kv', state: sanitizeState(raw ? JSON.parse(raw) : null), note: 'KV cloud sync active.' });
      }
      return json(res, 200, {
        ok: true,
        cloudSync: true,
        syncMode: 'memory',
        state: sanitizeState(globalThis.__POOL_SIDE_MEMORY_STATES__[stateKey] || null),
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
