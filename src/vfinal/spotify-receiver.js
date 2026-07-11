import { DEFAULT_SPOTIFY_CLIENT_ID, MUSIC_LEVEL_PERCENT, clamp } from './core.js';
import { isIOSLike } from './audio-engine.js';

const TOKEN_KEY = 'poolside-pulse-vfinal-spotify-token';
const VERIFIER_KEY = 'poolside-pulse-vfinal-spotify-verifier';
const OAUTH_STATE_KEY = 'poolside-pulse-vfinal-spotify-state';
const RETURN_KEY = 'poolside-pulse-vfinal-spotify-return';
const PLAYER_NAME = 'Poolside Pulse vFinal Receiver';
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing'
].join(' ');

function storageGet(storage, key) {
  try { return storage.getItem(key) || ''; } catch { return ''; }
}

function storageSet(storage, key, value) {
  try { storage.setItem(key, String(value)); } catch {}
}

function storageRemove(storage, key) {
  try { storage.removeItem(key); } catch {}
}

function randomString(length = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map(value => chars[value % chars.length]).join('');
}

async function sha256base64url(input) {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

function assertOperation(assertCurrent) {
  if (typeof assertCurrent === 'function') assertCurrent();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Spotify request timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function spotifyUri(input) {
  const raw = String(input || '').trim();
  if (/^spotify:(track|playlist|album|artist):[a-zA-Z0-9]+$/i.test(raw)) return raw;
  const url = new URL(raw);
  if (!/(^|\.)spotify\.com$/i.test(url.hostname)) throw new Error('Paste a Spotify playlist, album, artist, or track link.');
  const parts = url.pathname.split('/').filter(Boolean);
  const offset = parts[0]?.startsWith('intl-') ? 1 : 0;
  const type = parts[offset];
  const id = parts[offset + 1];
  if (!['track', 'playlist', 'album', 'artist'].includes(type) || !id) throw new Error('Paste a Spotify playlist, album, artist, or track link.');
  return `spotify:${type}:${id}`;
}

function spotifyPlayBody(input) {
  const uri = spotifyUri(input);
  return uri.startsWith('spotify:track:') ? { uris: [uri] } : { context_uri: uri };
}

function redirectUri() {
  return new URL('/', location.origin).href;
}

function tokenFromStorage() {
  try { return JSON.parse(storageGet(localStorage, TOKEN_KEY) || 'null'); } catch { return null; }
}

function saveToken(data) {
  const previous = tokenFromStorage() || {};
  const token = {
    ...previous,
    ...data,
    refresh_token: data.refresh_token || previous.refresh_token || '',
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
  };
  storageSet(localStorage, TOKEN_KEY, JSON.stringify(token));
  return token;
}

export class SpotifyReceiver {
  constructor({ clientId = DEFAULT_SPOTIFY_CLIENT_ID, onStatus = () => {}, onState = () => {} } = {}) {
    this.clientId = String(clientId || DEFAULT_SPOTIFY_CLIENT_ID).trim();
    this.onStatus = onStatus;
    this.onState = onState;
    this.player = null;
    this.deviceId = '';
    this.ready = false;
    this.current = null;
    this.supportsVolume = false;
    this.volumeVerified = false;
    this.verifiedDeviceId = '';
    this.connectPromise = null;
    this.sdkPromise = null;
    this.playerPrepared = false;
    this.prepareError = '';
  }

  resetVolumeVerification() {
    this.volumeVerified = false;
    this.verifiedDeviceId = '';
  }

  report(message, ok = true, extra = {}) {
    this.onStatus({
      message,
      ok,
      ready: this.ready,
      deviceId: this.deviceId,
      supportsVolume: this.supportsVolume,
      volumeVerified: this.volumeVerified,
      ...extra
    });
  }

  loggedIn() {
    return !!tokenFromStorage()?.access_token;
  }

  clearLogin() {
    storageRemove(localStorage, TOKEN_KEY);
    this.disconnect();
    this.player = null;
    this.playerPrepared = false;
    this.prepareError = '';
    this.report('Spotify login removed from this receiver.', true);
  }

  async beginLogin(returnPath = '/?v=final#receiver') {
    if (!this.clientId) throw new Error('Spotify Client ID is missing.');
    const verifier = randomString(96);
    const state = randomString(32);
    storageSet(sessionStorage, VERIFIER_KEY, verifier);
    storageSet(sessionStorage, OAUTH_STATE_KEY, state);
    storageSet(sessionStorage, RETURN_KEY, returnPath);
    const url = new URL('https://accounts.spotify.com/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('redirect_uri', redirectUri());
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('code_challenge', await sha256base64url(verifier));
    location.assign(url.toString());
  }

  async completeLoginFromCallback() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const oauthError = params.get('error');
    if (oauthError) throw new Error(`Spotify login was not completed: ${oauthError}`);
    if (!code) return false;
    const state = params.get('state') || '';
    const expectedState = storageGet(sessionStorage, OAUTH_STATE_KEY);
    const verifier = storageGet(sessionStorage, VERIFIER_KEY);
    if (!expectedState || state !== expectedState) throw new Error('Spotify login state did not match. Start Spotify login again from this receiver.');
    if (!verifier) throw new Error('Spotify login verifier expired. Start Spotify login again from this receiver.');
    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier
    });
    const response = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }, 8_000);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error_description || data.error || `Spotify token HTTP ${response.status}`);
    saveToken(data);
    storageRemove(sessionStorage, VERIFIER_KEY);
    storageRemove(sessionStorage, OAUTH_STATE_KEY);
    const returnPath = storageGet(sessionStorage, RETURN_KEY) || '/?v=final#receiver';
    storageRemove(sessionStorage, RETURN_KEY);
    history.replaceState(null, '', returnPath);
    this.report('Spotify Premium login connected on this receiver.', true);
    return true;
  }

  async accessToken() {
    let token = tokenFromStorage();
    if (!token?.access_token) throw new Error('Spotify is not connected on this receiver.');
    if (Number(token.expiresAt || 0) > Date.now() + 90_000) return token.access_token;
    if (!token.refresh_token) throw new Error('Spotify login expired. Login again on the receiver.');
    const body = new URLSearchParams({
      client_id: this.clientId,
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token
    });
    const response = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }, 8_000);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error_description || data.error || `Spotify refresh HTTP ${response.status}`);
    token = saveToken(data);
    return token.access_token;
  }

  async api(method, path, body = null, query = {}) {
    const url = new URL(`https://api.spotify.com/v1${path}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    const run = async () => {
      const response = await fetchWithTimeout(url, {
        method,
        headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
        body: body === null ? undefined : JSON.stringify(body)
      }, 6_000);
      if (response.status === 204) return {};
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error?.message || data.error_description || `Spotify ${method} ${path} HTTP ${response.status}`);
        error.status = response.status;
        const retryAfter = Number(response.headers.get('Retry-After') || 0);
        error.retryAfter = retryAfter;
        throw error;
      }
      return data;
    };
    try {
      return await run();
    } catch (error) {
      this.resetVolumeVerification();
      if (error.status !== 429) throw error;
      await wait(clamp(error.retryAfter * 1000, 500, 4_000, 1_500));
      try {
        return await run();
      } catch (retryError) {
        this.resetVolumeVerification();
        throw retryError;
      }
    }
  }

  async ensureSdk() {
    if (window.Spotify) return window.Spotify;
    if (this.sdkPromise) return this.sdkPromise;
    this.sdkPromise = new Promise((resolve, reject) => {
      const previous = window.onSpotifyWebPlaybackSDKReady;
      window.onSpotifyWebPlaybackSDKReady = () => {
        if (typeof previous === 'function') previous();
        resolve(window.Spotify);
      };
      if (!document.querySelector('script[data-poolside-spotify-sdk]')) {
        const script = document.createElement('script');
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        script.dataset.poolsideSpotifySdk = 'true';
        script.onerror = () => reject(new Error('Spotify Web Playback SDK failed to load.'));
        document.head.appendChild(script);
      }
      setTimeout(() => window.Spotify ? resolve(window.Spotify) : reject(new Error('Spotify Web Playback SDK did not become ready.')), 15_000);
    });
    try {
      return await this.sdkPromise;
    } catch (error) {
      this.sdkPromise = null;
      document.querySelector('script[data-poolside-spotify-sdk]')?.remove();
      throw error;
    }
  }

  registerListeners() {
    this.player.addListener('ready', ({ device_id }) => {
      this.resetVolumeVerification();
      this.deviceId = device_id;
      this.ready = true;
      // The SDK ready event does not report the device volume capability. Keep
      // this false until /me/player/devices explicitly confirms it.
      this.supportsVolume = false;
      this.report('Spotify receiver is ready.', true);
    });
    this.player.addListener('not_ready', () => {
      this.ready = false;
      this.supportsVolume = false;
      this.resetVolumeVerification();
      this.report('Spotify receiver went offline. Tap Start Receiver again.', false);
    });
    this.player.addListener('autoplay_failed', () => {
      this.resetVolumeVerification();
      this.report('Spotify needs a fresh tap on Start Receiver before playback can begin.', false);
    });
    this.player.addListener('initialization_error', error => {
      this.resetVolumeVerification();
      this.report(`Spotify initialization failed: ${error.message}`, false);
    });
    this.player.addListener('authentication_error', error => {
      this.resetVolumeVerification();
      this.report(`Spotify login failed: ${error.message}`, false);
    });
    this.player.addListener('account_error', error => {
      this.resetVolumeVerification();
      this.report(`Spotify Premium is required: ${error.message}`, false);
    });
    this.player.addListener('playback_error', error => {
      this.resetVolumeVerification();
      this.report(`Spotify playback failed: ${error.message}`, false);
    });
    this.player.addListener('player_state_changed', state => {
      if (!state) return;
      const track = state.track_window?.current_track;
      this.current = {
        paused: !!state.paused,
        position: Number(state.position || 0),
        duration: Number(state.duration || 0),
        uri: track?.uri || '',
        name: track?.name || '',
        artists: (track?.artists || []).map(artist => artist.name).join(', ')
      };
      this.onState(this.current);
    });
  }

  async preparePlayer() {
    if (!this.loggedIn()) return false;
    try {
      const Spotify = await this.ensureSdk();
      if (!this.player) {
        this.player = new Spotify.Player({
          name: PLAYER_NAME,
          getOAuthToken: callback => this.accessToken().then(callback).catch(error => this.report(error.message, false)),
          volume: MUSIC_LEVEL_PERCENT / 100
        });
        this.registerListeners();
      }
      this.playerPrepared = true;
      this.prepareError = '';
      this.onState(this.current);
      return true;
    } catch (error) {
      this.playerPrepared = false;
      this.prepareError = error.message || String(error);
      this.report(`Spotify receiver setup is not ready: ${this.prepareError}`, false);
      throw error;
    }
  }

  async connectFromUserGesture() {
    if (!this.loggedIn()) throw new Error('Login Spotify on this receiver first.');
    if (!this.playerPrepared || !this.player) throw new Error('Spotify is still preparing. Wait for Connect Spotify Receiver, then tap it once.');
    if (this.ready && this.deviceId) {
      if (typeof this.player?.activateElement === 'function') {
        await withTimeout(this.player.activateElement(), 4_000, 'Spotify did not activate from this tap. Tap Connect Spotify Receiver again.');
      }
      await this.refreshCapabilities();
      return this.deviceId;
    }
    if (this.connectPromise) return await this.connectPromise;
    const activation = typeof this.player.activateElement === 'function'
      ? this.player.activateElement()
      : Promise.resolve();
    this.connectPromise = (async () => {
      await withTimeout(activation, 4_000, 'Spotify did not activate from this tap. Tap Connect Spotify Receiver again.');
      const connected = await withTimeout(this.player.connect(), 8_000, 'Spotify receiver connection timed out.');
      if (!connected) throw new Error('Spotify receiver did not connect.');
      const startedAt = Date.now();
      while ((!this.ready || !this.deviceId) && Date.now() - startedAt < 18_000) await wait(150);
      if (!this.deviceId) throw new Error('Spotify receiver did not report ready.');
      await this.api('PUT', '/me/player', { device_ids: [this.deviceId], play: false });
      await this.refreshCapabilities();
      return this.deviceId;
    })();
    try {
      return await this.connectPromise;
    } catch (error) {
      this.resetVolumeVerification();
      throw error;
    } finally {
      this.connectPromise = null;
    }
  }

  async refreshCapabilities() {
    if (!this.deviceId) {
      this.supportsVolume = false;
      this.resetVolumeVerification();
      return { supportsVolume: false, volumeVerified: false, device: null };
    }
    const requestedDeviceId = String(this.deviceId);
    try {
      const data = await this.api('GET', '/me/player/devices');
      if (requestedDeviceId !== String(this.deviceId || '')) {
        this.supportsVolume = false;
        this.resetVolumeVerification();
        return { supportsVolume: false, volumeVerified: false, device: null, error: 'Spotify receiver changed while its capability was checked.' };
      }
      const device = (data.devices || []).find(item => String(item.id || '') === requestedDeviceId);
      this.supportsVolume = !isIOSLike() && device?.is_restricted !== true && device?.supports_volume === true;
      if (!this.supportsVolume || this.verifiedDeviceId !== requestedDeviceId) this.resetVolumeVerification();
      return { supportsVolume: this.supportsVolume, volumeVerified: this.volumeVerified, device: device || null };
    } catch (error) {
      this.supportsVolume = false;
      this.resetVolumeVerification();
      return { supportsVolume: false, volumeVerified: false, error: error.message };
    }
  }

  async readLocalVolume(expected = MUSIC_LEVEL_PERCENT) {
    if (!this.player || typeof this.player.getVolume !== 'function' || isIOSLike()) {
      return { matches: false, actual: null, raw: null, reason: 'iOS/browser volume is under physical device control.' };
    }
    const raw = Number(await withTimeout(this.player.getVolume(), 4_000, 'Spotify volume read timed out.'));
    const actual = Number.isFinite(raw) ? Math.round(raw * 100) : null;
    const target = expected / 100;
    const matches = Number.isFinite(raw) && actual === expected && Math.abs(raw - target) <= 0.005;
    return {
      matches,
      actual,
      raw: Number.isFinite(raw) ? raw : null,
      reason: actual === null ? 'Spotify receiver did not report a valid volume.' : `Spotify receiver reports ${actual}%.`
    };
  }

  async enforceThirtyPercent() {
    if (!this.deviceId || !this.player) throw new Error('Spotify receiver is not connected.');
    this.resetVolumeVerification();
    if (isIOSLike()) {
      this.supportsVolume = false;
      return { supportsVolume: false, volumeVerified: false, verified: false, actual: null, reason: 'iPhone and iPad keep Spotify volume under physical control.' };
    }
    if (!this.supportsVolume || typeof this.player.setVolume !== 'function' || typeof this.player.getVolume !== 'function') {
      return { supportsVolume: this.supportsVolume, volumeVerified: false, verified: false, actual: null, reason: 'This Spotify receiver did not confirm software volume control.' };
    }
    const expectedDeviceId = String(this.deviceId);
    try {
      await withTimeout(this.player.setVolume(MUSIC_LEVEL_PERCENT / 100), 4_000, 'Spotify volume setting timed out.');
      await wait(400);
      const measurement = await this.readLocalVolume(MUSIC_LEVEL_PERCENT);
      const sameDevice = expectedDeviceId === String(this.deviceId || '') && this.ready;
      this.volumeVerified = sameDevice && measurement.matches;
      this.verifiedDeviceId = this.volumeVerified ? expectedDeviceId : '';
      const verification = {
        supportsVolume: this.supportsVolume,
        volumeVerified: this.volumeVerified,
        verified: this.volumeVerified,
        actual: measurement.actual,
        reason: sameDevice ? measurement.reason : 'Spotify receiver changed before volume could be verified.'
      };
      this.report(
        verification.verified ? 'Spotify volume verified at 30%.' : `Spotify volume was not verified: ${verification.reason}`,
        verification.verified,
        verification
      );
      return verification;
    } catch (error) {
      this.resetVolumeVerification();
      const verification = {
        supportsVolume: this.supportsVolume,
        volumeVerified: false,
        verified: false,
        actual: null,
        reason: 'Spotify volume control could not be verified.'
      };
      this.report(verification.reason, false, verification);
      return verification;
    }
  }

  async playbackState() {
    const state = await this.api('GET', '/me/player');
    const stateDeviceId = String(state?.device?.id || '');
    const localDevice = !!stateDeviceId && stateDeviceId === String(this.deviceId || '');
    if (stateDeviceId && !localDevice) this.resetVolumeVerification();
    const supportsVolume = !isIOSLike()
      && state?.device?.is_restricted !== true
      && state?.device?.supports_volume === true;
    if (localDevice) {
      this.supportsVolume = supportsVolume;
      if (!supportsVolume) this.resetVolumeVerification();
    }
    return {
      isPlaying: !!state?.is_playing,
      deviceId: stateDeviceId,
      volume: Number.isFinite(Number(state?.device?.volume_percent)) ? Number(state.device.volume_percent) : null,
      supportsVolume,
      volumeVerified: localDevice && this.volumeVerified && this.verifiedDeviceId === stateDeviceId,
      position: Number(state?.progress_ms || 0),
      uri: state?.item?.uri || '',
      name: String(state?.item?.name || ''),
      artists: (state?.item?.artists || []).map(artist => artist?.name).filter(Boolean).join(', '),
      contextUri: state?.context?.uri || ''
    };
  }

  async waitForPlayback(expectedPlaying, timeoutMs = 4_000) {
    const startedAt = Date.now();
    let last = null;
    while (Date.now() - startedAt < timeoutMs) {
      try {
        last = await this.playbackState();
        if (last.isPlaying === expectedPlaying && (!this.deviceId || !last.deviceId || String(last.deviceId) === String(this.deviceId))) return last;
      } catch {}
      await wait(250);
    }
    throw new Error(`Spotify did not confirm that playback was ${expectedPlaying ? 'playing' : 'paused'}.`);
  }

  async play(url, { assertCurrent = null } = {}) {
    assertOperation(assertCurrent);
    const deviceId = await this.connectFromUserGesture();
    assertOperation(assertCurrent);
    const body = spotifyPlayBody(url);
    await this.api('PUT', '/me/player', { device_ids: [deviceId], play: false });
    assertOperation(assertCurrent);
    await wait(250);
    // Calibrate while playback is still paused so a previously changed SDK
    // volume never leaks through during the audible startup transition.
    if (this.supportsVolume) await this.enforceThirtyPercent();
    assertOperation(assertCurrent);
    await this.api('PUT', '/me/player/play', body, { device_id: deviceId });
    assertOperation(assertCurrent);
    if (typeof this.player.activateElement === 'function') {
      await withTimeout(this.player.activateElement(), 4_000, 'Spotify did not activate for playback.');
    }
    const state = await this.waitForPlayback(true, 6_000);
    assertOperation(assertCurrent);
    const volume = await this.enforceThirtyPercent();
    assertOperation(assertCurrent);
    this.report(volume.verified ? 'Spotify is playing at verified 30%.' : 'Spotify is playing in pause-for-voice compatibility mode.', true, { playback: state, volume });
    return { state, volume };
  }

  async pause() {
    if (!this.deviceId) return false;
    let accepted = false;
    try {
      await this.api('PUT', '/me/player/pause', null, { device_id: this.deviceId });
      accepted = true;
    } catch {}
    if (this.player && typeof this.player.pause === 'function') {
      try { await withTimeout(this.player.pause(), 4_000, 'Spotify SDK pause timed out.'); accepted = true; } catch {}
    }
    if (!accepted) return false;
    await this.waitForPlayback(false, 4_000);
    return accepted;
  }

  async resume({ assertCurrent = null } = {}) {
    if (!this.deviceId) return false;
    assertOperation(assertCurrent);
    // Set and read the exact target before making the player audible. A second
    // verification below catches any device change during resume.
    if (this.supportsVolume) await this.enforceThirtyPercent();
    assertOperation(assertCurrent);
    let accepted = false;
    try {
      await this.api('PUT', '/me/player/play', null, { device_id: this.deviceId });
      accepted = true;
    } catch {}
    assertOperation(assertCurrent);
    if (this.player && typeof this.player.resume === 'function') {
      assertOperation(assertCurrent);
      try { await withTimeout(this.player.resume(), 4_000, 'Spotify SDK resume timed out.'); accepted = true; } catch {}
      assertOperation(assertCurrent);
    }
    if (accepted) {
      await this.waitForPlayback(true);
      assertOperation(assertCurrent);
      await this.enforceThirtyPercent().catch(() => {});
      assertOperation(assertCurrent);
    }
    return accepted;
  }

  async next({ assertCurrent = null } = {}) {
    if (!this.deviceId) throw new Error('Spotify receiver is not connected.');
    assertOperation(assertCurrent);
    const before = await this.playbackState().catch(() => null);
    assertOperation(assertCurrent);
    if (this.supportsVolume) await this.enforceThirtyPercent();
    assertOperation(assertCurrent);
    await this.api('POST', '/me/player/next', null, { device_id: this.deviceId });
    assertOperation(assertCurrent);
    const startedAt = Date.now();
    let state = null;
    while (Date.now() - startedAt < 4_000) {
      state = await this.playbackState().catch(() => null);
      assertOperation(assertCurrent);
      if (state?.uri && (!before?.uri || state.uri !== before.uri)) break;
      await wait(200);
    }
    if (!state?.isPlaying) {
      const playing = await this.resume({ assertCurrent });
      if (!playing) throw new Error('Spotify did not confirm playback after skipping the track.');
      state = await this.playbackState();
      assertOperation(assertCurrent);
    } else {
      await this.enforceThirtyPercent().catch(() => {});
    }
    if (state?.name) {
      this.current = {
        ...(this.current || {}),
        paused: !state.isPlaying,
        position: state.position,
        uri: state.uri,
        name: state.name,
        artists: state.artists
      };
      this.onState(this.current);
    }
    return state || { isPlaying: true };
  }

  async pauseForAnnouncement() {
    let stateKnown = false;
    let snapshot = { wasPlaying: false, position: 0, uri: '', deviceId: this.deviceId };
    try {
      const state = await this.playbackState();
      stateKnown = true;
      const localDevice = !!state.deviceId && String(state.deviceId) === String(this.deviceId || '');
      snapshot = { ...snapshot, wasPlaying: !!state.isPlaying && localDevice, position: state.position, uri: state.uri, deviceId: state.deviceId || this.deviceId };
    } catch {}
    // The Web API result is authoritative when it succeeds. SDK callbacks can
    // arrive late after a manual pause, so only use the local cache when the
    // fresh state read failed.
    const localCacheSaysPlaying = !!this.current && this.current.paused === false;
    const localPlayingFallback = !stateKnown && localCacheSaysPlaying;
    if (localPlayingFallback) snapshot.wasPlaying = true;
    // A failed state read is never treated as proof of silence. Request a pause
    // and require a positive paused-state confirmation before any other source
    // or announcement can proceed. We only resume when prior playback was
    // positively known, so an unknown state fails safely to silence.
    const mustPause = !stateKnown || snapshot.wasPlaying || localPlayingFallback;
    if (mustPause) {
      if (!this.deviceId) throw new Error('Spotify is not connected, so its paused state cannot be confirmed.');
      const paused = await this.pause();
      if (!paused) throw new Error('Spotify did not accept the required pause.');
      if (!stateKnown && !localPlayingFallback) snapshot.wasPlaying = false;
    }
    return snapshot;
  }

  async resumeAfterAnnouncement(snapshot, options = {}) {
    if (!snapshot?.wasPlaying) return false;
    const resumed = await this.resume(options);
    if (!resumed) throw new Error('Spotify did not resume after the announcement.');
    return true;
  }

  disconnect() {
    if (this.player && typeof this.player.disconnect === 'function') {
      try { this.player.disconnect(); } catch {}
    }
    this.player = null;
    this.ready = false;
    this.deviceId = '';
    this.supportsVolume = false;
    this.resetVolumeVerification();
    this.current = null;
  }
}
