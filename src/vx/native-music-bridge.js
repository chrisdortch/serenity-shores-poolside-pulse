import { clamp } from './core.js';

export const NATIVE_MUSIC_BRIDGE_VERSION = 1;
export const NATIVE_MUSIC_BRIDGE_NAME = 'poolsideMusic';

const REQUEST_TIMEOUT_MS = 15_000;
const FAIL_SAFE_TIMEOUT_MS = 20_000;
const MUTATING_METHODS = new Set([
  'play', 'pause', 'pauseImmediate', 'resume', 'next', 'stop', 'setVolume',
  'pauseForAnnouncement', 'resumeAfterAnnouncement'
]);
let requestSequence = 0;

function marker() {
  const value = globalThis.__POOL_SIDE_NATIVE_MUSIC__ || globalThis.window?.__POOL_SIDE_NATIVE_MUSIC__;
  if (!value || Number(value.version) !== NATIVE_MUSIC_BRIDGE_VERSION) return null;
  return value;
}

function handler() {
  return globalThis.webkit?.messageHandlers?.[NATIVE_MUSIC_BRIDGE_NAME]
    || globalThis.window?.webkit?.messageHandlers?.[NATIVE_MUSIC_BRIDGE_NAME]
    || null;
}

function cleanBridgeError(error, fallback = 'The native Apple Music receiver did not complete the request.') {
  return String(error?.message || error || fallback)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || fallback;
}

export function nativeMusicBridgeAvailable() {
  return Boolean(marker() && typeof handler()?.postMessage === 'function');
}

export function nativeMusicBridgeInfo() {
  const value = marker();
  if (!value || !nativeMusicBridgeAvailable()) return null;
  return {
    version: NATIVE_MUSIC_BRIDGE_VERSION,
    platform: String(value.platform || 'macos-music-app').slice(0, 80),
    deviceName: String(value.deviceName || 'Poolside Pulse X Music Receiver').slice(0, 120)
  };
}

function bridgeError(error, fallback, extra = {}) {
  return Object.assign(new Error(cleanBridgeError(error, fallback)), extra);
}

async function confirmFailSafePause(timeoutMs = FAIL_SAFE_TIMEOUT_MS) {
  let posted;
  try {
    posted = handler()?.postMessage?.({
      v: NATIVE_MUSIC_BRIDGE_VERSION,
      requestId: `failsafe-${Date.now().toString(36)}-${(++requestSequence).toString(36)}`,
      method: 'failSafePause',
      params: {}
    });
  } catch (error) {
    throw bridgeError(error, 'The native Music.app fail-safe pause could not be dispatched.');
  }
  let timer = null;
  try {
    const response = await Promise.race([
      Promise.resolve(posted),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('The native Music.app fail-safe pause timed out.')), timeoutMs);
      })
    ]);
    if (!response || response.ok !== true) {
      throw new Error(cleanBridgeError(response?.error, 'The native Music.app fail-safe pause failed.'));
    }
    const state = nativePlaybackState(response.result);
    if (!state.playbackStateVerified || state.isPlaying || !state.volumeVerified || state.volume !== 0) {
      throw new Error('Music.app did not explicitly confirm both paused playback and 0% volume.');
    }
    return state;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function nativeMusicRequest(method, params = {}, {
  timeoutMs = REQUEST_TIMEOUT_MS,
  failSafeTimeoutMs = timeoutMs < 1_000 ? Math.max(50, timeoutMs * 4) : FAIL_SAFE_TIMEOUT_MS
} = {}) {
  if (!nativeMusicBridgeAvailable()) throw new Error('The native Apple Music receiver bridge is unavailable.');
  const safeMethod = String(method || '').trim();
  if (!/^[a-z][A-Za-z]{0,39}$/.test(safeMethod)) throw new Error('Invalid native Apple Music request.');
  const payload = {
    v: NATIVE_MUSIC_BRIDGE_VERSION,
    requestId: `web-${Date.now().toString(36)}-${(++requestSequence).toString(36)}`,
    method: safeMethod,
    params: params && typeof params === 'object' && !Array.isArray(params) ? params : {}
  };
  let posted;
  try {
    // Keep lifecycle pause calls synchronous through the WebKit boundary. The
    // returned native result is still awaited below, but dispatch is immediate.
    posted = handler().postMessage(payload);
  } catch (error) {
    throw new Error(cleanBridgeError(error, `Native Apple Music ${safeMethod} failed.`));
  }
  const operation = Promise.resolve(posted);
  let timer = null;
  try {
    const response = await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Native Apple Music ${safeMethod} timed out.`)), timeoutMs);
      })
    ]);
    if (!response || response.ok !== true) {
      throw new Error(cleanBridgeError(response?.error, `Native Apple Music ${safeMethod} failed.`));
    }
    return response.result && typeof response.result === 'object' ? response.result : {};
  } catch (error) {
    // A WebKit reply timeout cannot cancel an Apple event that has already
    // entered Music.app. Queue a native pause behind it so a late play/resume
    // cannot become audible after the web runtime has failed the command.
    if (MUTATING_METHODS.has(safeMethod)) {
      try {
        await confirmFailSafePause(failSafeTimeoutMs);
      } catch (pauseError) {
        throw bridgeError(
          `${cleanBridgeError(error)} ${cleanBridgeError(pauseError)}`,
          `Native Apple Music ${safeMethod} failed and silence could not be confirmed.`,
          {
            code: 'APPLE_MUSIC_NATIVE_PAUSE_UNCONFIRMED',
            applePauseUnconfirmed: true,
            appleOperation: 'Music.app fail-safe pause'
          }
        );
      }
    }
    throw bridgeError(error, `Native Apple Music ${safeMethod} failed.`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function nativeVolumePercent(value, fallback = 30) {
  const number = Number(value);
  if (!Number.isFinite(number)) return clamp(fallback, 0, 100, 30);
  return clamp(Math.round(number), 0, 100, fallback);
}

export function nativePlaybackState(value = {}) {
  const rawState = String(value.playerState || value.state || '').toLowerCase();
  const knownState = ['playing', 'paused', 'stopped'].includes(rawState);
  const explicitBoolean = typeof value.isPlaying === 'boolean';
  const statePlaying = rawState === 'playing';
  const booleanPlaying = value.isPlaying === true;
  const playbackStateVerified = knownState && explicitBoolean && statePlaying === booleanPlaying;
  const isPlaying = playbackStateVerified ? statePlaying : true;
  const measuredVolume = Number(value.volume);
  const measuredVerifiedPercent = Number(value.verifiedPercent);
  const volume = Number.isFinite(measuredVolume) ? nativeVolumePercent(measuredVolume, 0) : null;
  const verifiedPercent = Number.isFinite(measuredVerifiedPercent)
    ? nativeVolumePercent(measuredVerifiedPercent, 0)
    : null;
  const supportsVolume = value.supportsVolume === true;
  const volumeVerified = supportsVolume && value.volumeVerified === true && volume !== null && verifiedPercent === volume;
  return {
    isPlaying,
    playerState: rawState,
    playbackStateVerified,
    deviceId: String(value.deviceId || 'music-app@receiver-mac'),
    volume,
    supportsVolume,
    volumeVerified,
    verifiedPercent: volumeVerified ? verifiedPercent : null,
    position: Math.max(0, Number(value.position || 0) || 0),
    uri: String(value.uri || value.sourceUrl || ''),
    name: String(value.name || ''),
    artists: String(value.artists || ''),
    persistentId: String(value.persistentId || '')
  };
}
