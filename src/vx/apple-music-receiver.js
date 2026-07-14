import { MUSIC_LEVEL_PERCENT, clamp } from './core.js';
import { isIOSLike } from './audio-engine.js';

export const APPLE_MUSIC_SDK_URL = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
export const APPLE_MUSIC_TOKEN_URL = '/api/apple-music-token?v=x';
export const APPLE_MUSIC_OVERLAP_DUCKING_ENABLED = false;

const AUTHORIZATION_HINT_KEY = 'poolside-pulse-vx-apple-music-authorized-hint';
const RECEIVER_DEVICE_ID = 'poolside-pulse-vx-musickit-web';
const ACCESS_CACHE_MS = 5 * 60 * 1000;
const SDK_TIMEOUT_MS = 15_000;
const COMMAND_TIMEOUT_MS = 12_000;
const VOLUME_TOLERANCE = 0.006;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function storageGet(key) {
  try { return globalThis.localStorage?.getItem(key) || ''; } catch { return ''; }
}

function storageSet(key, value) {
  try { globalThis.localStorage?.setItem(key, String(value)); } catch {}
}

function storageRemove(key) {
  try { globalThis.localStorage?.removeItem(key); } catch {}
}

function assertOperation(assertCurrent) {
  if (typeof assertCurrent === 'function') assertCurrent();
}

function musicKitGlobal() {
  return globalThis.MusicKit || globalThis.window?.MusicKit || null;
}

function cleanErrorMessage(error, fallback) {
  const text = String(error?.message || error || fallback || 'Apple Music request failed.')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 500) || fallback || 'Apple Music request failed.';
}

function appleError(message, code, operation = '') {
  const error = new Error(message);
  error.code = code;
  error.appleOperation = operation;
  error.appleReason = message;
  return error;
}

function normalizedExpiresAt(value, token = '') {
  const supplied = Number(value || 0);
  if (Number.isFinite(supplied) && supplied > 0) {
    return supplied < 10_000_000_000 ? supplied * 1000 : supplied;
  }
  try {
    const encoded = String(token).split('.')[1] || '';
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4);
    const payload = JSON.parse(globalThis.atob(padded));
    return Number(payload?.exp || 0) * 1000;
  } catch {
    return Date.now() + 10 * 60 * 1000;
  }
}

function authorizedBySdk(music) {
  if (!music) return false;
  if (music.isAuthorized === true) return true;
  if (music.authorizationStatus === 3 || String(music.authorizationStatus || '').toLowerCase() === 'authorized') return true;
  return false;
}

function rawPlaybackState(music) {
  return music?.playbackState ?? music?.player?.playbackState ?? null;
}

function stateIsPlaying(state) {
  const expected = musicKitGlobal()?.PlaybackStates?.playing;
  if (expected !== undefined && state === expected) return true;
  if (Number(state) === 2) return true;
  return String(state ?? '').toLowerCase() === 'playing';
}

function stateIsPaused(state) {
  const kit = musicKitGlobal();
  const paused = kit?.PlaybackStates?.paused;
  const stopped = kit?.PlaybackStates?.stopped;
  const ended = kit?.PlaybackStates?.ended;
  const completed = kit?.PlaybackStates?.completed;
  if ([paused, stopped, ended, completed].some(value => value !== undefined && state === value)) return true;
  if ([0, 3, 4, 5, 9].includes(Number(state))) return true;
  return ['none', 'paused', 'stopped', 'ended', 'completed'].includes(String(state ?? '').toLowerCase());
}

function mediaDetails(item) {
  const attributes = item?.attributes || item || {};
  const playParams = attributes.playParams || item?.playParams || {};
  return {
    uri: String(attributes.url || playParams.catalogId || playParams.id || item?.id || ''),
    name: String(attributes.name || attributes.title || ''),
    artists: String(attributes.artistName || attributes.artist || '')
  };
}

export function isAppleMusicUrl(input) {
  try {
    const url = new URL(String(input || '').trim());
    return url.protocol === 'https:' && (url.hostname === 'music.apple.com' || url.hostname.endsWith('.music.apple.com'));
  } catch {
    return false;
  }
}

function appleMusicSource(input) {
  const raw = String(input || '').trim();
  if (!isAppleMusicUrl(raw)) {
    throw appleError(
      'Paste a full https://music.apple.com song, album, playlist, artist, station, or music-video link.',
      'APPLE_MUSIC_SOURCE_INVALID',
      'setQueue'
    );
  }
  const url = new URL(raw);
  url.hash = '';
  const parts = url.pathname.split('/').filter(Boolean);
  const knownTypes = new Set(['album', 'artist', 'music-video', 'playlist', 'song', 'station']);
  const type = parts.find(part => knownTypes.has(part)) || 'catalog';
  const last = parts.at(-1) || '';
  const id = String(url.searchParams.get('i') || (/^pl\./i.test(last) || /^\d+$/.test(last) ? last : ''));
  return { type, id, uri: url.href, url: url.href, checkedAt: Date.now(), name: '' };
}

export class AppleMusicReceiver {
  constructor({
    onStatus = () => {},
    onState = () => {},
    now = () => Date.now(),
    fetchImpl = globalThis.fetch?.bind(globalThis),
    musicKit = null
  } = {}) {
    this.onStatus = onStatus;
    this.onState = onState;
    this.now = now;
    this.fetchImpl = fetchImpl;
    this.musicKitOverride = musicKit;
    this.music = null;
    this.sdkPromise = null;
    this.configurePromise = null;
    this.developerTokenPromise = null;
    this.cachedDeveloperToken = '';
    this.developerTokenExpiresAt = 0;
    this.configuredToken = '';
    this.listenersFor = null;
    this.listenerRemovers = [];

    this.deviceId = '';
    this.ready = false;
    this.deviceUsable = false;
    this.current = null;
    this.sourceUrl = '';
    this.supportsVolume = false;
    this.targetVolumePercent = MUSIC_LEVEL_PERCENT;
    this.volumeVerified = false;
    this.verifiedPercent = null;
    this.verifiedDeviceId = '';
    this.volumeGeneration = 0;
    this.volumeOperationTail = Promise.resolve();

    this.playerPrepared = false;
    this.prepareError = '';
    this.connectPromise = null;
    this.loginPromise = null;
    this.activationState = 'idle';
    this.activationPromise = null;
    this.activationError = '';
    this.authorizedThisSession = false;
    this.accessState = 'unchecked';
    this.accessVerified = false;
    this.accessVerifiedAt = 0;
    this.accessError = '';
    this.accountProfile = null;

    // Preload only Apple's public SDK. The protected developer-token endpoint
    // is not called until setup or login, after the Poolside session exists.
    if (!this.musicKitOverride && globalThis.document) this.ensureSdk().catch(() => {});
  }

  readiness() {
    if (!this.loggedIn()) return { status: 'login-required', ready: false, detail: 'Authorize Apple Music on the speaker receiver.' };
    if (this.accessState === 'checking') return { status: 'checking-access', ready: false, detail: 'Apple Music authorization is being checked.' };
    if (!this.accessVerified) return { status: 'access-blocked', ready: false, detail: this.accessError || 'Apple Music authorization has not been verified.' };
    if (!this.playerPrepared) return { status: 'preparing-sdk', ready: false, detail: this.prepareError || 'MusicKit is preparing.' };
    if (this.activationState !== 'active') return { status: 'needs-local-tap', ready: false, detail: this.activationError || 'Tap Connect Apple Music Receiver on this speaker device.' };
    if (!this.ready || !this.deviceId) return { status: 'connecting-device', ready: false, detail: 'MusicKit is waiting for this browser receiver to connect.' };
    if (!this.deviceUsable) return { status: 'checking-device', ready: false, detail: 'MusicKit playback is not yet ready.' };
    return {
      status: 'ready',
      ready: true,
      detail: this.supportsVolume && this.volumeVerified
        ? `Apple Music is ready with in-page volume verified at ${this.verifiedPercent}%.`
        : 'Apple Music is ready in pause-for-announcement compatibility mode.'
    };
  }

  report(message, ok = true, extra = {}) {
    this.onStatus({
      message,
      ok,
      ready: this.ready,
      deviceId: this.deviceId,
      supportsVolume: this.supportsVolume,
      targetVolumePercent: this.targetVolumePercent,
      volumeVerified: this.volumeVerified,
      verifiedPercent: this.verifiedPercent,
      activationState: this.activationState,
      accessVerified: this.accessVerified,
      ...extra
    });
  }

  resetAccessVerification(message = '') {
    this.accessVerified = false;
    this.accessVerifiedAt = 0;
    this.accessState = message ? 'blocked' : 'unchecked';
    this.accessError = String(message || '').slice(0, 700);
    this.accountProfile = null;
  }

  resetVolumeVerification() {
    this.volumeVerified = false;
    this.verifiedPercent = null;
    this.verifiedDeviceId = '';
  }

  invalidateVolumeOperations() {
    this.volumeGeneration += 1;
    this.resetVolumeVerification();
  }

  setTargetVolumePercent(percent) {
    const target = clamp(percent, 0, 100, MUSIC_LEVEL_PERCENT);
    if (target !== this.targetVolumePercent) this.invalidateVolumeOperations();
    this.targetVolumePercent = target;
    return target;
  }

  resetActivation() {
    this.activationState = 'idle';
    this.activationPromise = null;
    this.activationError = '';
  }

  failActivation(message) {
    this.activationState = 'failed';
    this.activationPromise = null;
    this.activationError = String(message || 'Apple Music audio activation failed.');
  }

  loggedIn() {
    return this.authorizedThisSession || authorizedBySdk(this.music) || storageGet(AUTHORIZATION_HINT_KEY) === '1';
  }

  async ensureSdk() {
    if (this.musicKitOverride) return this.musicKitOverride;
    if (musicKitGlobal()) return musicKitGlobal();
    if (this.sdkPromise) return await this.sdkPromise;
    if (!globalThis.document) throw new Error('MusicKit requires a browser receiver.');

    this.sdkPromise = new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (error = null) => {
        if (settled) return;
        const kit = musicKitGlobal();
        if (!error && !kit) return;
        settled = true;
        clearTimeout(timer);
        globalThis.document.removeEventListener?.('musickitloaded', onLoaded);
        if (error) reject(error);
        else resolve(kit);
      };
      const onLoaded = () => finish();
      globalThis.document.addEventListener?.('musickitloaded', onLoaded, { once: true });
      let script = globalThis.document.querySelector?.('script[data-poolside-vx-musickit]');
      if (!script) {
        script = globalThis.document.createElement('script');
        script.src = APPLE_MUSIC_SDK_URL;
        script.async = true;
        script.dataset.poolsideVxMusickit = 'true';
        script.onerror = () => finish(new Error('Apple Music MusicKit failed to load. Check this receiver connection and content blockers.'));
        globalThis.document.head.appendChild(script);
      }
      script.addEventListener?.('load', () => {
        if (musicKitGlobal()) finish();
      }, { once: true });
      timer = setTimeout(() => finish(new Error('Apple Music MusicKit did not become ready. Reload this receiver and try again.')), SDK_TIMEOUT_MS);
      if (musicKitGlobal()) finish();
    });

    try {
      return await this.sdkPromise;
    } catch (error) {
      this.sdkPromise = null;
      throw error;
    }
  }

  async fetchDeveloperToken({ force = false } = {}) {
    if (!force && this.cachedDeveloperToken && this.developerTokenExpiresAt > this.now() + 90_000) {
      return this.cachedDeveloperToken;
    }
    if (this.developerTokenPromise) return await this.developerTokenPromise;
    if (typeof this.fetchImpl !== 'function') throw new Error('This browser cannot request the Apple Music developer token.');

    this.developerTokenPromise = (async () => {
      const response = await withTimeout(this.fetchImpl(APPLE_MUSIC_TOKEN_URL, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      }), 8_000, 'Apple Music developer-token request timed out.');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = cleanErrorMessage(data?.error || data?.message, 'The Version X Apple Music server setup is incomplete.');
        throw appleError(detail, `APPLE_MUSIC_TOKEN_HTTP_${response.status}`, 'GET /api/apple-music-token?v=x');
      }
      const token = String(data?.token || data?.developerToken || '').trim();
      if (!token) throw appleError('The Version X server did not return an Apple Music developer token.', 'APPLE_MUSIC_TOKEN_MISSING', 'GET /api/apple-music-token?v=x');
      this.cachedDeveloperToken = token;
      this.developerTokenExpiresAt = normalizedExpiresAt(data?.expiresAt, token);
      return token;
    })();

    try {
      return await this.developerTokenPromise;
    } finally {
      this.developerTokenPromise = null;
    }
  }

  async ensureMusicKit({ forceToken = false } = {}) {
    if (this.configurePromise) return await this.configurePromise;
    this.configurePromise = (async () => {
      const MusicKit = await this.ensureSdk();
      const developerToken = await this.fetchDeveloperToken({ force: forceToken });
      const config = {
        developerToken,
        declarativeMarkup: false,
        app: { name: 'Poolside Pulse Version X', build: 'x' }
      };

      if (!this.music) {
        let configured = null;
        try {
          configured = await Promise.resolve(MusicKit.configure(config));
        } catch (error) {
          try { configured = MusicKit.getInstance?.(); } catch {}
          if (!configured) throw error;
        }
        this.music = configured && typeof configured === 'object'
          ? configured
          : MusicKit.getInstance?.();
        if (!this.music) throw new Error('MusicKit configured but did not provide a player instance.');
        this.configuredToken = developerToken;
        this.registerListeners();
      } else if (this.configuredToken !== developerToken) {
        let refreshed = false;
        try {
          this.music.developerToken = developerToken;
          refreshed = this.music.developerToken === developerToken;
        } catch {}
        if (!refreshed) {
          try { await Promise.resolve(MusicKit.configure(config)); } catch {}
        }
        this.configuredToken = developerToken;
      }
      return this.music;
    })();

    try {
      return await this.configurePromise;
    } finally {
      this.configurePromise = null;
    }
  }

  registerListeners() {
    if (!this.music || this.listenersFor === this.music || typeof this.music.addEventListener !== 'function') return;
    this.listenersFor = this.music;
    const Events = (this.musicKitOverride || musicKitGlobal())?.Events || {};
    const listen = (key, handler) => {
      const event = Events[key] || key;
      this.music.addEventListener(event, handler);
      this.listenerRemovers.push(() => {
        try { this.music?.removeEventListener?.(event, handler); } catch {}
      });
    };
    const update = () => this.syncCurrent();
    listen('playbackStateDidChange', update);
    listen('nowPlayingItemDidChange', update);
    listen('playbackTimeDidChange', update);
    listen('authorizationStatusDidChange', () => {
      if (authorizedBySdk(this.music)) {
        this.authorizedThisSession = true;
        storageSet(AUTHORIZATION_HINT_KEY, '1');
      } else if (this.music?.isAuthorized === false) {
        this.authorizedThisSession = false;
        storageRemove(AUTHORIZATION_HINT_KEY);
        this.resetAccessVerification('Apple Music authorization ended. Authorize this receiver again.');
      }
      this.onState(this.current);
    });
    listen('playbackError', event => {
      const message = cleanErrorMessage(event?.error || event, 'Apple Music playback failed.');
      this.report(`Apple Music playback failed: ${message}`, false, { errorCode: 'APPLE_MUSIC_PLAYBACK' });
    });
  }

  syncCurrent(forcePaused = null) {
    const details = mediaDetails(this.music?.nowPlayingItem || this.music?.player?.nowPlayingItem);
    const state = rawPlaybackState(this.music);
    const paused = forcePaused === null
      ? (state === null || state === undefined ? (this.current?.paused ?? true) : !stateIsPlaying(state))
      : !!forcePaused;
    const positionSeconds = Number(this.music?.currentPlaybackTime ?? this.music?.player?.currentPlaybackTime ?? 0);
    const durationSeconds = Number(this.music?.currentPlaybackDuration ?? this.music?.player?.currentPlaybackDuration ?? 0);
    this.current = {
      paused,
      position: Number.isFinite(positionSeconds) ? Math.max(0, Math.round(positionSeconds * 1000)) : 0,
      duration: Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds * 1000)) : 0,
      uri: details.uri || this.sourceUrl || this.current?.uri || '',
      name: details.name || this.current?.name || '',
      artists: details.artists || this.current?.artists || ''
    };
    this.onState(this.current);
    return this.current;
  }

  async callPlayer(method, ...args) {
    const music = await this.ensureMusicKit();
    const target = typeof music?.[method] === 'function' ? music : music?.player;
    if (!target || typeof target[method] !== 'function') {
      throw appleError(`MusicKit does not provide ${method} on this receiver.`, 'APPLE_MUSIC_METHOD_UNAVAILABLE', method);
    }
    return await withTimeout(Promise.resolve(target[method](...args)), COMMAND_TIMEOUT_MS, `Apple Music ${method} timed out.`);
  }

  async beginLogin() {
    if (this.loginPromise) return await this.loginPromise;
    this.loginPromise = (async () => {
      const music = await this.ensureMusicKit();
      if (typeof music.authorize !== 'function') throw new Error('MusicKit authorization is unavailable in this browser.');
      // MusicKit owns the user token. Poolside Pulse never receives it from a
      // callback and never writes it to local or cloud storage.
      await withTimeout(Promise.resolve(music.authorize()), 2 * 60_000, 'Apple Music authorization timed out. Tap Login Apple Music and try again.');
      this.authorizedThisSession = true;
      storageSet(AUTHORIZATION_HINT_KEY, '1');
      this.resetAccessVerification();
      await this.verifyAccess({ force: true });
      await this.preparePlayer();
      this.report('Apple Music authorization passed. Tap Connect Apple Music Receiver on this speaker device.', true);
      return true;
    })();
    try {
      return await this.loginPromise;
    } catch (error) {
      const message = cleanErrorMessage(error, 'Apple Music authorization failed.');
      this.resetAccessVerification(message);
      this.report(message, false);
      throw error;
    } finally {
      this.loginPromise = null;
    }
  }

  async completeLoginFromCallback() {
    // MusicKit handles its own Apple authorization sheet; Version X has no
    // OAuth callback and stores no Apple user token.
    return false;
  }

  clearLogin() {
    storageRemove(AUTHORIZATION_HINT_KEY);
    this.authorizedThisSession = false;
    try { Promise.resolve(this.music?.unauthorize?.()).catch(() => {}); } catch {}
    this.resetAccessVerification();
    this.disconnect();
    this.playerPrepared = false;
    this.prepareError = '';
    this.report('Apple Music authorization was removed from this receiver.', true);
  }

  async verifyAccess({ force = false } = {}) {
    if (!force && this.accessVerified && this.now() - this.accessVerifiedAt <= ACCESS_CACHE_MS) {
      return { verified: true, profile: this.accountProfile };
    }
    this.accessState = 'checking';
    this.accessError = '';
    try {
      const music = await this.ensureMusicKit();
      if (!this.authorizedThisSession && music?.isAuthorized === false) {
        storageRemove(AUTHORIZATION_HINT_KEY);
        throw appleError('Apple Music is not authorized on this receiver. Tap Login Apple Music.', 'APPLE_MUSIC_AUTH_REQUIRED', 'MusicKit authorize');
      }
      if (!this.authorizedThisSession && !authorizedBySdk(music) && storageGet(AUTHORIZATION_HINT_KEY) !== '1') {
        throw appleError('Apple Music is not authorized on this receiver. Tap Login Apple Music.', 'APPLE_MUSIC_AUTH_REQUIRED', 'MusicKit authorize');
      }

      let storefrontId = String(music?.storefrontId || '');
      if (typeof music?.api?.music === 'function') {
        try {
          const result = await withTimeout(
            Promise.resolve(music.api.music('/v1/me/storefront')),
            8_000,
            'Apple Music account check timed out.'
          );
          storefrontId = String(result?.data?.[0]?.id || result?.data?.data?.[0]?.id || storefrontId);
        } catch (error) {
          throw appleError(
            `Apple Music authorization could not be verified: ${cleanErrorMessage(error, 'account request failed')}`,
            'APPLE_MUSIC_ACCESS_BLOCKED',
            'GET /v1/me/storefront'
          );
        }
      }

      this.authorizedThisSession = true;
      storageSet(AUTHORIZATION_HINT_KEY, '1');
      this.accountProfile = {
        displayName: 'Authorized Apple Music account',
        accountId: storefrontId,
        storefrontId
      };
      this.accessVerified = true;
      this.accessVerifiedAt = this.now();
      this.accessState = 'verified';
      this.accessError = '';
      this.report('Apple Music account authorization passed. Full-track entitlement is confirmed when playback succeeds.', true);
      return { verified: true, profile: this.accountProfile };
    } catch (error) {
      const message = cleanErrorMessage(error, 'Apple Music account access failed.');
      this.resetAccessVerification(message);
      this.report(message, false, {
        errorCode: error?.code || 'APPLE_MUSIC_ACCESS_BLOCKED',
        errorOperation: error?.appleOperation || ''
      });
      throw error;
    }
  }

  async preparePlayer() {
    if (!this.loggedIn()) return false;
    try {
      await this.ensureMusicKit();
      await this.verifyAccess();
      this.playerPrepared = true;
      this.prepareError = '';
      this.registerListeners();
      this.onState(this.current);
      return true;
    } catch (error) {
      this.playerPrepared = false;
      this.prepareError = cleanErrorMessage(error, 'MusicKit setup failed.');
      this.report(`Apple Music receiver setup is not ready: ${this.prepareError}`, false);
      throw error;
    }
  }

  async restoreAuthorization() {
    if (!this.loggedIn()) return false;
    const restored = await this.preparePlayer();
    if (restored) {
      this.report('Previous Apple Music authorization restored. Tap Connect Apple Music Receiver on this speaker device.', true);
    }
    return restored;
  }

  // Intentionally not async. When MusicKit exposes prepareToPlay, invoking it
  // here keeps that call directly inside the receiver's click handler.
  activateFromUserGesture() {
    if (!this.loggedIn()) throw new Error('Authorize Apple Music on this receiver first.');
    if (!this.playerPrepared || !this.music) throw new Error('Apple Music is still preparing. Wait, then tap Connect Apple Music Receiver.');
    if (this.activationState === 'active') return Promise.resolve(true);
    if (this.activationState === 'activating' && this.activationPromise) return this.activationPromise;
    this.activationState = 'activating';
    this.activationError = '';
    let activation;
    try {
      const player = this.music?.player || this.music;
      activation = typeof player?.prepareToPlay === 'function' ? player.prepareToPlay() : true;
    } catch {
      const message = 'Apple Music could not activate from this tap. Tap Connect Apple Music Receiver again.';
      this.failActivation(message);
      throw new Error(message);
    }
    this.activationPromise = withTimeout(
      Promise.resolve(activation),
      6_000,
      'Apple Music did not activate from this tap. Tap Connect Apple Music Receiver again.'
    ).then(() => {
      this.activationState = 'active';
      this.activationPromise = null;
      this.activationError = '';
      this.report('Apple Music browser activation is ready.', true);
      return true;
    }).catch(error => {
      const message = cleanErrorMessage(error, 'Apple Music could not activate from this tap.');
      this.failActivation(message);
      this.report(message, false);
      throw error;
    });
    return this.activationPromise;
  }

  async connectFromUserGesture() {
    if (!this.loggedIn()) throw new Error('Authorize Apple Music on this receiver first.');
    if (!this.playerPrepared || !this.music) throw new Error('Apple Music is still preparing.');
    if (this.activationState === 'activating' && this.activationPromise) await this.activationPromise;
    if (this.activationState !== 'active') throw new Error('Apple Music needs a fresh tap on Connect Apple Music Receiver.');
    if (this.connectPromise) return await this.connectPromise;
    this.connectPromise = (async () => {
      await this.verifyAccess();
      this.deviceId = RECEIVER_DEVICE_ID;
      this.ready = true;
      this.deviceUsable = true;
      const capability = await this.refreshCapabilities();
      this.report(
        capability.supportsVolume
          ? 'Apple Music receiver connected. In-page volume is available and will be verified at each target.'
          : 'Apple Music receiver connected in pause-for-announcement compatibility mode.',
        true,
        capability
      );
      return this.deviceId;
    })();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async refreshCapabilities({ strict = false } = {}) {
    if (!this.music || !this.ready || !this.deviceId) {
      this.deviceUsable = false;
      this.supportsVolume = false;
      this.resetVolumeVerification();
      const result = { supportsVolume: false, volumeVerified: false, verifiedPercent: null, device: null };
      if (strict && !this.music) throw new Error('Apple Music receiver is not connected.');
      return result;
    }
    this.deviceUsable = true;
    this.resetVolumeVerification();
    if (isIOSLike()) {
      this.supportsVolume = false;
      return {
        supportsVolume: false,
        volumeVerified: false,
        verifiedPercent: null,
        device: { id: this.deviceId, name: 'MusicKit browser receiver' },
        reason: 'iPhone and iPad keep media volume under physical device control; announcements use pause and resume.'
      };
    }
    try {
      const before = Number(this.music.volume);
      if (!Number.isFinite(before)) throw new Error('MusicKit did not expose readable in-page volume.');
      const probe = before >= 0.99 ? 0.98 : Math.min(1, before + 0.01);
      this.music.volume = probe;
      await wait(40);
      const measuredProbe = Number(this.music.volume);
      this.music.volume = before;
      await wait(40);
      const restored = Number(this.music.volume);
      this.supportsVolume = Number.isFinite(measuredProbe) && Number.isFinite(restored)
        && Math.abs(measuredProbe - probe) <= VOLUME_TOLERANCE
        && Math.abs(restored - before) <= VOLUME_TOLERANCE;
    } catch {
      this.supportsVolume = false;
    }
    return {
      supportsVolume: this.supportsVolume,
      volumeVerified: false,
      verifiedPercent: null,
      device: { id: this.deviceId, name: 'MusicKit browser receiver' },
      reason: this.supportsVolume
        ? 'MusicKit in-page volume accepted a reversible write and readback.'
        : 'This browser did not verify MusicKit in-page volume; announcements use pause and resume.'
    };
  }

  async readLocalVolume(expected = this.targetVolumePercent) {
    if (!this.music || !this.supportsVolume || isIOSLike()) {
      return { matches: false, actual: null, raw: null, reason: 'In-page Apple Music volume is not software-controllable on this receiver.' };
    }
    const raw = Number(this.music.volume);
    const targetPercent = clamp(expected, 0, 100, this.targetVolumePercent);
    const actual = Number.isFinite(raw) ? Math.round(raw * 100) : null;
    const matches = Number.isFinite(raw) && actual === targetPercent && Math.abs(raw - targetPercent / 100) <= VOLUME_TOLERANCE;
    return {
      matches,
      actual,
      raw: Number.isFinite(raw) ? raw : null,
      reason: actual === null ? 'MusicKit did not report a valid in-page volume.' : `MusicKit reports ${actual}% in-page volume.`
    };
  }

  async enforceVolume(percent = this.targetVolumePercent) {
    const targetPercent = clamp(percent, 0, 100, MUSIC_LEVEL_PERCENT);
    const stale = reason => ({
      supportsVolume: this.supportsVolume,
      volumeVerified: false,
      verifiedPercent: null,
      verified: false,
      actual: null,
      stale: true,
      reason
    });
    if (targetPercent !== this.targetVolumePercent) {
      return stale(`A newer ${this.targetVolumePercent}% Apple Music target replaced this request.`);
    }
    if (!this.music || !this.ready || !this.deviceId) throw new Error('Apple Music receiver is not connected.');
    const generation = this.volumeGeneration;
    const deviceId = this.deviceId;
    const operationCurrent = () => generation === this.volumeGeneration
      && targetPercent === this.targetVolumePercent
      && deviceId === this.deviceId
      && this.ready;
    const work = async () => {
      if (!operationCurrent()) return stale('A newer Apple Music target or receiver replaced this volume request.');
      this.resetVolumeVerification();
      if (isIOSLike() || !this.supportsVolume) {
        return {
          supportsVolume: false,
          volumeVerified: false,
          verifiedPercent: null,
          verified: false,
          actual: null,
          reason: `This receiver cannot verify Apple Music in-page volume at ${targetPercent}%; announcements use pause and resume.`
        };
      }
      try {
        this.music.volume = targetPercent / 100;
        await wait(100);
        if (!operationCurrent()) return stale('A newer Apple Music target replaced this request during verification.');
        const measurement = await this.readLocalVolume(targetPercent);
        this.volumeVerified = measurement.matches;
        this.verifiedPercent = measurement.matches ? targetPercent : null;
        this.verifiedDeviceId = measurement.matches ? deviceId : '';
        const result = {
          supportsVolume: this.supportsVolume,
          volumeVerified: this.volumeVerified,
          verifiedPercent: this.verifiedPercent,
          verified: this.volumeVerified,
          actual: measurement.actual,
          reason: measurement.reason
        };
        this.report(
          result.verified
            ? `Apple Music in-page volume verified at ${targetPercent}%.`
            : `Apple Music volume was not verified at ${targetPercent}%: ${result.reason}`,
          result.verified,
          result
        );
        return result;
      } catch {
        this.supportsVolume = false;
        this.resetVolumeVerification();
        const result = {
          supportsVolume: false,
          volumeVerified: false,
          verifiedPercent: null,
          verified: false,
          actual: null,
          reason: 'MusicKit in-page volume control failed; announcements will pause Apple Music.'
        };
        this.report(result.reason, false, result);
        return result;
      }
    };
    const job = this.volumeOperationTail.then(work, work);
    this.volumeOperationTail = job.catch(() => {});
    return await job;
  }

  async enforceThirtyPercent() {
    return await this.enforceVolume(this.targetVolumePercent);
  }

  async validatePlaybackSource(input) {
    const source = appleMusicSource(input);
    await this.verifyAccess();
    this.report('Apple Music link accepted. Catalog availability and subscription entitlement are confirmed when playback starts.', true, { source });
    return source;
  }

  async playbackState() {
    if (!this.music) throw new Error('Apple Music receiver is not prepared.');
    const raw = rawPlaybackState(this.music);
    const current = this.syncCurrent();
    const isPlaying = raw === null || raw === undefined ? current.paused === false : stateIsPlaying(raw);
    const actualVolume = Number(this.music.volume);
    return {
      isPlaying,
      deviceId: this.deviceId,
      volume: Number.isFinite(actualVolume) ? Math.round(actualVolume * 100) : null,
      supportsVolume: this.supportsVolume,
      volumeVerified: this.volumeVerified && this.verifiedDeviceId === this.deviceId && this.verifiedPercent === this.targetVolumePercent,
      verifiedPercent: this.volumeVerified && this.verifiedDeviceId === this.deviceId ? this.verifiedPercent : null,
      position: current.position,
      uri: current.uri,
      name: current.name,
      artists: current.artists,
      contextUri: this.sourceUrl
    };
  }

  async waitForPlayback(expectedPlaying, timeoutMs = 5_000) {
    const startedAt = this.now();
    let last = null;
    while (this.now() - startedAt < timeoutMs) {
      last = await this.playbackState();
      if (last.isPlaying === expectedPlaying) return last;
      await wait(150);
    }
    throw appleError(
      `Apple Music did not confirm that playback was ${expectedPlaying ? 'playing' : 'paused'} on this receiver.`,
      'APPLE_MUSIC_PLAYBACK_NOT_CONFIRMED',
      'MusicKit playbackState'
    );
  }

  async play(url, { assertCurrent = null } = {}) {
    assertOperation(assertCurrent);
    await this.verifyAccess();
    assertOperation(assertCurrent);
    const source = await this.validatePlaybackSource(url);
    assertOperation(assertCurrent);
    if (!this.ready || !this.deviceId) throw new Error('Apple Music needs a local tap on Connect Apple Music Receiver before playback.');
    if (this.activationState !== 'active') throw new Error('Apple Music needs a fresh local receiver tap before scheduled or remote playback.');
    await this.fetchDeveloperToken();
    assertOperation(assertCurrent);
    if (this.supportsVolume) await this.enforceVolume();
    assertOperation(assertCurrent);
    await this.callPlayer('setQueue', { url: source.url });
    this.sourceUrl = source.url;
    this.current = { ...(this.current || {}), paused: true, uri: source.url };
    assertOperation(assertCurrent);
    try {
      await this.callPlayer('play');
    } catch (error) {
      if (/not.?allowed|gesture|autoplay/i.test(cleanErrorMessage(error))) {
        this.failActivation('Apple Music autoplay was blocked. Tap Connect Apple Music Receiver once on this speaker device.');
      }
      throw error;
    }
    this.syncCurrent(false);
    assertOperation(assertCurrent);
    const state = await this.waitForPlayback(true, 8_000);
    assertOperation(assertCurrent);
    const volume = await this.enforceVolume();
    assertOperation(assertCurrent);
    this.report(
      volume.verified
        ? `Apple Music is playing at verified ${this.targetVolumePercent}% in-page volume.`
        : 'Apple Music is playing in pause-for-announcement compatibility mode.',
      true,
      { playback: state, volume }
    );
    return { state, volume };
  }

  async pause() {
    if (!this.music || !this.ready || !this.deviceId) return false;
    await this.callPlayer('pause');
    this.syncCurrent(true);
    await this.waitForPlayback(false, 5_000);
    return true;
  }

  async resume({ assertCurrent = null } = {}) {
    if (!this.music || !this.ready || !this.deviceId) return false;
    assertOperation(assertCurrent);
    if (this.supportsVolume) await this.enforceVolume();
    assertOperation(assertCurrent);
    try {
      await this.callPlayer('play');
    } catch (error) {
      if (/not.?allowed|gesture|autoplay/i.test(cleanErrorMessage(error))) {
        this.failActivation('Apple Music autoplay was blocked. Tap Connect Apple Music Receiver again.');
      }
      throw error;
    }
    this.syncCurrent(false);
    assertOperation(assertCurrent);
    await this.waitForPlayback(true);
    assertOperation(assertCurrent);
    if (this.supportsVolume) await this.enforceVolume();
    return true;
  }

  async next({ assertCurrent = null } = {}) {
    if (!this.music || !this.ready || !this.deviceId) throw new Error('Apple Music receiver is not connected.');
    assertOperation(assertCurrent);
    await this.callPlayer('skipToNextItem');
    assertOperation(assertCurrent);
    await wait(200);
    let state = await this.playbackState();
    if (!state.isPlaying) {
      const resumed = await this.resume({ assertCurrent });
      if (!resumed) throw new Error('Apple Music did not resume after skipping.');
      state = await this.playbackState();
    } else if (this.supportsVolume) {
      await this.enforceVolume().catch(() => {});
    }
    this.syncCurrent(false);
    return state;
  }

  async fadeRawVolume(toPercent, durationMs = 240) {
    if (!this.music || !this.supportsVolume || isIOSLike()) return false;
    const to = clamp(toPercent, 0, 100, 0) / 100;
    const measured = Number(this.music.volume);
    const from = Number.isFinite(measured) ? measured : this.targetVolumePercent / 100;
    const steps = Math.max(1, Math.min(8, Math.round(durationMs / 40)));
    for (let step = 1; step <= steps; step += 1) {
      this.music.volume = from + (to - from) * (step / steps);
      await wait(Math.max(10, Math.round(durationMs / steps)));
    }
    const actual = Number(this.music.volume);
    if (!Number.isFinite(actual) || Math.abs(actual - to) > VOLUME_TOLERANCE) {
      throw new Error('MusicKit did not confirm the temporary announcement fade.');
    }
    this.resetVolumeVerification();
    return true;
  }

  async pauseForAnnouncement() {
    let stateKnown = false;
    let state = null;
    try {
      state = await this.playbackState();
      stateKnown = true;
    } catch {}
    const localPlayingFallback = !stateKnown && this.current?.paused === false;
    const snapshot = {
      wasPlaying: stateKnown ? !!state?.isPlaying : !!localPlayingFallback,
      position: Number(state?.position || this.current?.position || 0),
      uri: String(state?.uri || this.current?.uri || ''),
      sourceUrl: this.sourceUrl,
      deviceId: this.deviceId,
      targetPercent: this.targetVolumePercent,
      volumeLowered: false
    };
    const mustPause = !stateKnown || snapshot.wasPlaying || localPlayingFallback;
    if (!mustPause) return snapshot;
    if (!this.music || !this.ready || !this.deviceId) {
      throw appleError('Apple Music is not connected, so its paused state cannot be confirmed.', 'APPLE_MUSIC_PAUSE_UNCONFIRMED', 'MusicKit pause');
    }
    if (this.supportsVolume) {
      try {
        snapshot.volumeLowered = await this.fadeRawVolume(0);
      } catch {
        snapshot.volumeLowered = false;
      }
    }
    const paused = await this.pause();
    if (!paused) throw appleError('Apple Music did not accept the required pause.', 'APPLE_MUSIC_PAUSE_UNCONFIRMED', 'MusicKit pause');
    const confirmed = await this.playbackState();
    if (confirmed.isPlaying) throw appleError('Apple Music could not be confirmed paused.', 'APPLE_MUSIC_PAUSE_UNCONFIRMED', 'MusicKit playbackState');
    return snapshot;
  }

  async resumeAfterAnnouncement(snapshot, { assertCurrent = null } = {}) {
    if (!snapshot?.wasPlaying) return false;
    if (!this.music || !this.ready || !this.deviceId) throw new Error('Apple Music receiver is not connected.');
    assertOperation(assertCurrent);
    if (this.supportsVolume) {
      try { this.music.volume = 0; } catch {}
      this.resetVolumeVerification();
    }
    assertOperation(assertCurrent);
    await this.callPlayer('play');
    this.syncCurrent(false);
    assertOperation(assertCurrent);
    await this.waitForPlayback(true);
    assertOperation(assertCurrent);
    if (this.supportsVolume) {
      try {
        await this.fadeRawVolume(this.targetVolumePercent);
        await this.enforceVolume(this.targetVolumePercent);
      } catch {
        this.supportsVolume = false;
        this.resetVolumeVerification();
      }
    }
    assertOperation(assertCurrent);
    this.report('Apple Music resumed after the announcement.', true);
    return true;
  }

  disconnect() {
    this.ready = false;
    this.deviceUsable = false;
    this.deviceId = '';
    this.supportsVolume = false;
    this.invalidateVolumeOperations();
    this.current = null;
    this.sourceUrl = '';
    this.resetActivation();
    this.onState(this.current);
  }
}
