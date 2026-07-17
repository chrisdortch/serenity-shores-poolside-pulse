import { isIOSLike } from './audio-engine.js';
import {
  DEFAULT_SPOTIFY_CLIENT_ID,
  MUSIC_LEVEL_PERCENT,
  clamp
} from './core.js';

const TOKEN_KEY = 'poolside-pulse-vx-spotify-token';
const PKCE_TRANSACTION_KEY = 'poolside-pulse-vx-spotify-pkce';
const PLAYER_NAME = 'Poolside Pulse X Spotify Receiver';
const DEFAULT_RETURN_PATH = '/#receiver';
export const SPOTIFY_REDIRECT_URI = 'https://poolside-pulse-x.vercel.app/';
export const SPOTIFY_PKCE_TTL_MS = 15 * 60 * 1000;
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative'
].join(' ');
const ACCESS_CACHE_MS = 5 * 60 * 1000;
const SOURCE_CACHE_MS = 3 * 60 * 1000;

function storageGet(storage, key) {
  try { return storage.getItem(key) || ''; } catch { return ''; }
}

function storageSet(storage, key, value) {
  try { storage.setItem(key, String(value)); } catch {}
}

function storageRemove(storage, key) {
  try { storage.removeItem(key); } catch {}
}

function canonicalOrigin() {
  return new URL(SPOTIFY_REDIRECT_URI).origin;
}

export function isCanonicalSpotifyLocation(candidate = globalThis.location) {
  try {
    const current = new URL(candidate?.href || `${candidate?.origin || ''}${candidate?.pathname || '/'}${candidate?.search || ''}${candidate?.hash || ''}`);
    return current.origin === canonicalOrigin();
  } catch {
    return false;
  }
}

export function safeSpotifyReturnPath(input, fallback = DEFAULT_RETURN_PATH) {
  const raw = String(input || '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const parsed = new URL(raw, SPOTIFY_REDIRECT_URI);
    if (parsed.origin !== canonicalOrigin()) return fallback;
    for (const key of ['code', 'state', 'error', 'error_description']) parsed.searchParams.delete(key);
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || fallback;
  } catch {
    return fallback;
  }
}

function canonicalAppUrl(returnPath = DEFAULT_RETURN_PATH) {
  return new URL(safeSpotifyReturnPath(returnPath), SPOTIFY_REDIRECT_URI).href;
}

function clearPendingPkce() {
  storageRemove(globalThis.localStorage, PKCE_TRANSACTION_KEY);
}

function savePendingPkce(transaction) {
  const serialized = JSON.stringify(transaction);
  storageSet(globalThis.localStorage, PKCE_TRANSACTION_KEY, serialized);
  if (storageGet(globalThis.localStorage, PKCE_TRANSACTION_KEY) !== serialized) {
    throw new Error('Spotify login could not be saved on this device. Allow website storage, then try again.');
  }
}

function readPendingPkce(now = Date.now()) {
  const raw = storageGet(globalThis.localStorage, PKCE_TRANSACTION_KEY);
  if (!raw) return { transaction: null, reason: 'missing' };
  try {
    const transaction = JSON.parse(raw);
    const createdAt = Number(transaction?.createdAt || 0);
    const age = Number(now) - createdAt;
    const structurallyValid = typeof transaction?.state === 'string' && transaction.state.length >= 16
      && typeof transaction?.verifier === 'string' && transaction.verifier.length >= 43
      && transaction.redirectUri === SPOTIFY_REDIRECT_URI
      && Number.isFinite(createdAt) && createdAt > 0;
    if (!structurallyValid) return { transaction: null, reason: 'invalid' };
    if (age < -60_000 || age > SPOTIFY_PKCE_TTL_MS) return { transaction, reason: 'expired' };
    return { transaction, reason: '' };
  } catch {
    return { transaction: null, reason: 'invalid' };
  }
}

function cleanCallbackUrl(returnPath = '') {
  let replacement = returnPath ? safeSpotifyReturnPath(returnPath) : '';
  if (!replacement) {
    try {
      const current = new URL(globalThis.location.href);
      for (const key of ['code', 'state', 'error', 'error_description']) current.searchParams.delete(key);
      replacement = `${current.pathname}${current.search}${current.hash}`;
    } catch {
      replacement = DEFAULT_RETURN_PATH;
    }
  }
  try { globalThis.history?.replaceState?.(null, '', replacement || DEFAULT_RETURN_PATH); } catch {}
  return replacement || DEFAULT_RETURN_PATH;
}

function callbackErrorMessage(code) {
  switch (String(code || '').toLowerCase()) {
    case 'access_denied':
      return 'Spotify login was cancelled or permission was not granted. Tap Login Spotify to try again.';
    case 'invalid_client':
      return 'Spotify rejected this app Client ID. Confirm the Spotify app and its production redirect URI, then try again.';
    case 'invalid_request':
      return 'Spotify rejected the login request. Confirm the exact production redirect URI is registered in the Spotify app dashboard.';
    case 'invalid_scope':
      return 'Spotify rejected a required playback permission. Confirm Web Playback SDK access in the Spotify app dashboard.';
    case 'temporarily_unavailable':
      return 'Spotify login is temporarily unavailable. Wait a moment, then try again.';
    default:
      return 'Spotify could not complete login. Tap Login Spotify to start a fresh connection.';
  }
}

function tokenErrorMessage(data, status, phase = 'login') {
  const code = String(data?.error || '').toLowerCase();
  if (status === 401 || code === 'invalid_client') {
    return 'Spotify rejected this app Client ID. Confirm the Spotify app configuration and the exact production redirect URI.';
  }
  if (status === 403) {
    return 'Spotify blocked this account. Choose a Premium account authorized for this app. If the app uses Development Mode, add that exact account in Users Management.';
  }
  if (code === 'invalid_grant') {
    return phase === 'refresh'
      ? 'Spotify authorization expired or was revoked. Log in to Spotify again on this receiver.'
      : 'Spotify login code expired or was already used. Tap Login Spotify and try again.';
  }
  return phase === 'refresh'
    ? 'Spotify could not refresh this receiver login. Log in again on the receiver.'
    : 'Spotify could not exchange the login code. Tap Login Spotify and try again.';
}

function boundedSpotifyReason(data) {
  const raw = String(
    data?.error?.message ||
    data?.error?.reason ||
    data?.error_description ||
    data?.message ||
    ''
  ).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  const lower = raw.toLowerCase();
  if (!raw) return '';
  if (lower.includes('restriction violated')) return 'Restriction violated';
  if (lower === 'forbidden' || lower.includes('forbidden')) return 'Forbidden';
  if (lower.includes('premium')) return 'Premium account required';
  if (lower.includes('not found')) return 'Resource not found';
  if (lower.includes('rate') || lower.includes('too many requests')) return 'Rate limited';
  if (lower.includes('expired')) return 'Authorization expired';
  if (lower.includes('token') || lower.includes('auth')) return 'Authorization rejected';
  if (lower.includes('autoplay')) return 'Autoplay blocked';
  if (lower.includes('playback')) return 'Playback command rejected';
  return '';
}

function apiErrorMessage(status, data, operation) {
  const reason = boundedSpotifyReason(data);
  const detail = reason ? ` Spotify said: ${reason}.` : '';
  if (status === 401) return `Spotify authorization expired or was revoked during ${operation}. Log in again on this receiver.${detail}`;
  if (status === 403) {
    return `Spotify denied ${operation} with HTTP 403.${detail} Possible causes include account or app access, a missing permission, a Premium playback restriction, or an unavailable source. For a Development Mode app, confirm the exact receiver account is in Users Management.`;
  }
  if (status === 404) return `Spotify could not find the requested resource or receiver during ${operation}.${detail}`;
  if (status === 429) return `Spotify rate-limited ${operation}.${detail}`;
  return '';
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

function spotifyResource(input) {
  const raw = String(input || '').trim();
  const uriMatch = /^spotify:(track|playlist|album|artist):([a-zA-Z0-9]+)$/i.exec(raw);
  if (uriMatch) return { type: uriMatch[1].toLowerCase(), id: uriMatch[2], uri: raw };
  const url = new URL(raw);
  if (!/(^|\.)spotify\.com$/i.test(url.hostname)) throw new Error('Paste a Spotify playlist, album, artist, or track link.');
  const parts = url.pathname.split('/').filter(Boolean);
  const offset = parts[0]?.startsWith('intl-') ? 1 : 0;
  const type = parts[offset];
  const id = parts[offset + 1];
  if (!['track', 'playlist', 'album', 'artist'].includes(type) || !id) throw new Error('Paste a Spotify playlist, album, artist, or track link.');
  return { type, id, uri: `spotify:${type}:${id}` };
}

function spotifyUri(input) {
  return spotifyResource(input).uri;
}

function spotifyPlayBody(input) {
  const uri = spotifyUri(input);
  return uri.startsWith('spotify:track:') ? { uris: [uri] } : { context_uri: uri };
}

function tokenFromStorage() {
  try { return JSON.parse(storageGet(globalThis.localStorage, TOKEN_KEY) || 'null'); } catch { return null; }
}

function saveToken(data) {
  const previous = tokenFromStorage() || {};
  const token = {
    ...previous,
    ...data,
    refresh_token: data.refresh_token || previous.refresh_token || '',
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
  };
  storageSet(globalThis.localStorage, TOKEN_KEY, JSON.stringify(token));
  return token;
}

export class SpotifyReceiver {
  constructor({
    clientId = DEFAULT_SPOTIFY_CLIENT_ID,
    onStatus = () => {},
    onState = () => {},
    now = () => Date.now(),
    random = randomString,
    pkceChallenge = sha256base64url
  } = {}) {
    this.clientId = String(clientId || DEFAULT_SPOTIFY_CLIENT_ID).trim();
    this.onStatus = onStatus;
    this.onState = onState;
    this.now = now;
    this.random = random;
    this.pkceChallenge = pkceChallenge;
    this.player = null;
    this.deviceId = '';
    this.ready = false;
    this.deviceUsable = false;
    this.current = null;
    this.supportsVolume = false;
    this.targetVolumePercent = MUSIC_LEVEL_PERCENT;
    this.volumeVerified = false;
    this.verifiedPercent = null;
    this.verifiedDeviceId = '';
    this.volumeGeneration = 0;
    this.volumeOperationTail = Promise.resolve();
    this.connectPromise = null;
    this.sdkPromise = null;
    this.playerPrepared = false;
    this.prepareError = '';
    this.loginPromise = null;
    this.activationState = 'idle';
    this.activationPromise = null;
    this.activationError = '';
    this.accessState = 'unchecked';
    this.accessVerified = false;
    this.accessVerifiedAt = 0;
    this.accessError = '';
    this.accountProfile = null;
    this.sourceValidationCache = new Map();
  }

  readiness() {
    if (!this.loggedIn()) return { status: 'login-required', ready: false, detail: 'Login Spotify on the speaker receiver.' };
    if (this.accessState === 'checking') return { status: 'checking-access', ready: false, detail: 'Spotify account access is being checked.' };
    if (!this.accessVerified) return { status: 'access-blocked', ready: false, detail: this.accessError || 'Spotify account access has not been verified.' };
    if (!this.playerPrepared) return { status: 'preparing-sdk', ready: false, detail: this.prepareError || 'Spotify Web Playback SDK is preparing.' };
    if (this.activationState !== 'active') return { status: 'needs-local-tap', ready: false, detail: this.activationError || 'Tap Connect Spotify Receiver on the speaker device.' };
    if (!this.ready || !this.deviceId) return { status: 'connecting-device', ready: false, detail: 'Spotify is waiting for its browser playback device.' };
    if (!this.deviceUsable) return { status: 'checking-device', ready: false, detail: 'Spotify has not confirmed that Web API commands can target this receiver device.' };
    return { status: 'ready', ready: true, detail: 'Spotify account, SDK, local activation, and receiver device are verified.' };
  }

  resetAccessVerification(message = '') {
    this.accessVerified = false;
    this.accessVerifiedAt = 0;
    this.accessState = message ? 'blocked' : 'unchecked';
    this.accessError = String(message || '').slice(0, 700);
    this.accountProfile = null;
    this.sourceValidationCache.clear();
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
      ...extra
    });
  }

  resetActivation() {
    this.activationState = 'idle';
    this.activationPromise = null;
    this.activationError = '';
  }

  failActivation(message) {
    this.activationState = 'failed';
    this.activationPromise = null;
    this.activationError = String(message || 'Spotify audio activation failed.');
  }

  // Intentionally not async: activateElement must be invoked directly in the
  // synchronous click path on iPhone/Safari before any awaited work begins.
  activateFromUserGesture() {
    if (!this.loggedIn()) throw new Error('Log in to Spotify on this receiver first.');
    if (!this.playerPrepared || !this.player) {
      throw new Error('Spotify is still preparing. Wait for Connect Spotify Receiver, then tap it once.');
    }
    if (this.activationState === 'active') return Promise.resolve(true);
    if (this.activationState === 'activating' && this.activationPromise) return this.activationPromise;

    this.activationState = 'activating';
    this.activationError = '';
    let activation;
    try {
      if (typeof this.player.activateElement !== 'function') {
        this.activationState = 'active';
        return Promise.resolve(true);
      }
      activation = this.player.activateElement();
    } catch {
      const message = 'Spotify could not activate from this tap. Tap Connect Spotify Receiver again.';
      this.failActivation(message);
      throw new Error(message);
    }

    const tracked = withTimeout(
      Promise.resolve(activation),
      4_000,
      'Spotify did not activate from this tap. Tap Connect Spotify Receiver again.'
    ).then(() => {
      this.activationState = 'active';
      this.activationPromise = null;
      this.activationError = '';
      this.report('Spotify audio activation is ready.', true);
      return true;
    }).catch(() => {
      const message = 'Spotify could not activate from this tap. Tap Connect Spotify Receiver again.';
      this.failActivation(message);
      this.report(message, false);
      throw new Error(message);
    });
    this.activationPromise = tracked;
    return tracked;
  }

  async requireActivation() {
    if (this.activationState === 'activating' && this.activationPromise) await this.activationPromise;
    if (this.activationState === 'active') return true;
    if (this.activationState === 'failed') {
      throw new Error(this.activationError || 'Spotify audio activation failed. Tap Connect Spotify Receiver again.');
    }
    throw new Error('Spotify needs a fresh local tap on Connect Spotify Receiver before it can play scheduled or remote music.');
  }

  loggedIn() {
    return !!tokenFromStorage()?.access_token;
  }

  clearLogin() {
    storageRemove(globalThis.localStorage, TOKEN_KEY);
    clearPendingPkce();
    this.resetAccessVerification();
    this.disconnect();
    this.player = null;
    this.playerPrepared = false;
    this.prepareError = '';
    this.report('Spotify login removed from this receiver.', true);
  }

  async beginLogin(returnPath = DEFAULT_RETURN_PATH) {
    if (this.loginPromise) return await this.loginPromise;
    const request = this.startLoginRedirect(returnPath);
    this.loginPromise = request;
    try {
      return await request;
    } finally {
      if (this.loginPromise === request) this.loginPromise = null;
    }
  }

  async startLoginRedirect(returnPath = DEFAULT_RETURN_PATH) {
    if (!this.clientId) throw new Error('Spotify Client ID is missing.');
    const safeReturnPath = safeSpotifyReturnPath(returnPath);
    clearPendingPkce();
    if (!isCanonicalSpotifyLocation()) {
      const canonicalUrl = canonicalAppUrl(safeReturnPath);
      globalThis.location.assign(canonicalUrl);
      return canonicalUrl;
    }
    const verifier = this.random(96);
    const state = this.random(32);
    savePendingPkce({
      state,
      verifier,
      returnPath: safeReturnPath,
      redirectUri: SPOTIFY_REDIRECT_URI,
      createdAt: Number(this.now())
    });
    const url = new URL('https://accounts.spotify.com/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('scope', SCOPES);
    url.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge_method', 'S256');
    // A stale browser session can silently select the wrong Spotify account.
    // Always show the account/consent screen so the receiver can deliberately
    // choose the Premium account authorized for this Client ID (and listed in
    // Users Management when this is a Development Mode app).
    url.searchParams.set('show_dialog', 'true');
    try {
      url.searchParams.set('code_challenge', await this.pkceChallenge(verifier));
    } catch {
      clearPendingPkce();
      throw new Error('Spotify could not create a secure login request on this device. Reload Poolside Pulse and try again.');
    }
    globalThis.location.assign(url.toString());
    return url.toString();
  }

  async completeLoginFromCallback() {
    const params = new URLSearchParams(globalThis.location.search);
    if (!params.has('code') && !params.has('error') && !params.has('error_description')) return false;
    const code = params.get('code');
    const oauthError = params.get('error');
    const pending = readPendingPkce(this.now());
    const returnPath = safeSpotifyReturnPath(pending.transaction?.returnPath || DEFAULT_RETURN_PATH);
    try {
      if (!isCanonicalSpotifyLocation()) {
        throw new Error('Spotify returned to an unrecognized app address. Open the production Poolside Pulse link and start Spotify login again.');
      }
      if (pending.reason === 'expired') {
        throw new Error('Spotify login took too long and expired. Tap Login Spotify to start again.');
      }
      if (!pending.transaction || pending.reason) {
        throw new Error('Spotify login could not be matched to this device. Tap Login Spotify again from this receiver.');
      }
      const state = params.get('state') || '';
      if (!state || state !== pending.transaction.state) {
        throw new Error('Spotify login state did not match. Start Spotify login again from this receiver.');
      }
      if (oauthError) throw new Error(callbackErrorMessage(oauthError));
      if (!code) throw new Error('Spotify returned without a login code. Tap Login Spotify to try again.');
      const body = new URLSearchParams({
        client_id: this.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        code_verifier: pending.transaction.verifier
      });
      const response = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      }, 8_000);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(tokenErrorMessage(data, response.status, 'login'));
        error.status = response.status;
        throw error;
      }
      if (!data.access_token) throw new Error('Spotify did not return an access token. Tap Login Spotify and try again.');
      saveToken(data);
      this.resetAccessVerification();
      await this.verifyAccess({ force: true });
      this.report('Spotify login and Web API access passed on this receiver. Connect the playback device to finish verification.', true);
      return true;
    } finally {
      clearPendingPkce();
      cleanCallbackUrl(returnPath);
    }
  }

  async accessToken({ forceRefresh = false } = {}) {
    let token = tokenFromStorage();
    if (!token?.access_token) throw new Error('Spotify is not connected on this receiver.');
    if (!forceRefresh && Number(token.expiresAt || 0) > Date.now() + 90_000) return token.access_token;
    if (!token.refresh_token) {
      storageRemove(globalThis.localStorage, TOKEN_KEY);
      throw new Error('Spotify login expired. Log in again on the receiver.');
    }
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
    if (!response.ok) {
      const error = new Error(tokenErrorMessage(data, response.status, 'refresh'));
      error.status = response.status;
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        storageRemove(globalThis.localStorage, TOKEN_KEY);
        this.resetAccessVerification('Spotify authorization was rejected. Log in again with a Premium account authorized for this app; Development Mode accounts must also be in Users Management.');
      }
      throw error;
    }
    if (!data.access_token) throw new Error('Spotify did not return a refreshed access token. Log in again on the receiver.');
    token = saveToken(data);
    return token.access_token;
  }

  async api(method, path, body = null, query = {}) {
    const url = new URL(`https://api.spotify.com/v1${path}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    const run = async (forceRefresh = false) => {
      const response = await fetchWithTimeout(url, {
        method,
        headers: { Authorization: `Bearer ${await this.accessToken({ forceRefresh })}`, 'Content-Type': 'application/json' },
        body: body === null ? undefined : JSON.stringify(body)
      }, 6_000);
      if (response.status === 204) return {};
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const operation = `${String(method || 'GET').toUpperCase()} ${path}`;
        const spotifyReason = boundedSpotifyReason(data);
        const error = new Error(apiErrorMessage(response.status, data, operation) || spotifyReason || `Spotify ${operation} failed with HTTP ${response.status}.`);
        error.status = response.status;
        error.code = response.status === 403 ? 'SPOTIFY_ACCESS_RESTRICTED' : `SPOTIFY_HTTP_${response.status}`;
        error.spotifyOperation = operation;
        error.spotifyReason = spotifyReason;
        const retryAfter = Number(response.headers.get('Retry-After') || 0);
        error.retryAfter = retryAfter;
        throw error;
      }
      return data;
    };
    const finalizeFailure = error => {
      this.resetVolumeVerification();
      const sourceMetadataOperation = /^\/(playlists|tracks|albums|artists)\//.test(path);
      if (error?.status === 403 && !sourceMetadataOperation) {
        this.deviceUsable = false;
        this.resetAccessVerification(error.message || 'Spotify denied account or playback access.');
        this.report(error.message || 'Spotify denied account or playback access.', false, {
          accessVerified: false,
          errorCode: error?.code || 'SPOTIFY_ACCESS_RESTRICTED',
          errorStatus: 403,
          errorOperation: error?.spotifyOperation || '',
          spotifyReason: error?.spotifyReason || ''
        });
        this.onState(this.current);
      } else if (error?.status === 404 && path.startsWith('/me/player')) {
        this.deviceUsable = false;
        this.report(error.message || 'Spotify could not find the receiver playback device.', false, {
          errorCode: error?.code || 'SPOTIFY_HTTP_404',
          errorStatus: 404,
          errorOperation: error?.spotifyOperation || '',
          spotifyReason: error?.spotifyReason || 'Receiver device not found'
        });
        this.onState(this.current);
      } else if (error?.status === 401 || !tokenFromStorage()?.access_token) {
        storageRemove(globalThis.localStorage, TOKEN_KEY);
        this.resetAccessVerification('Spotify authorization expired or was revoked. Log in again.');
        this.disconnect();
      }
      return error;
    };
    try {
      return await run();
    } catch (error) {
      this.resetVolumeVerification();
      if (error.status === 401) {
        try {
          return await run(true);
        } catch (retryError) {
          throw finalizeFailure(retryError);
        }
      }
      if (error.status !== 429) throw finalizeFailure(error);
      await wait(clamp(error.retryAfter * 1000, 500, 4_000, 1_500));
      try {
        return await run();
      } catch (retryError) {
        throw finalizeFailure(retryError);
      }
    }
  }

  async verifyAccess({ force = false } = {}) {
    if (!this.loggedIn()) throw new Error('Spotify is not connected on this receiver.');
    if (!force && this.accessVerified && Date.now() - this.accessVerifiedAt <= ACCESS_CACHE_MS) {
      return { verified: true, profile: this.accountProfile };
    }
    this.accessState = 'checking';
    this.accessError = '';
    try {
      const profile = await this.api('GET', '/me');
      const product = String(profile?.product || '').toLowerCase();
      if (product && product !== 'premium') {
        const error = new Error('This Spotify account is not Premium. Spotify playback control and the Web Playback SDK require a Premium account.');
        error.code = 'SPOTIFY_PREMIUM_REQUIRED';
        error.spotifyOperation = 'GET /me';
        error.spotifyReason = `account product is ${product}`;
        throw error;
      }
      // An unallowlisted Development Mode user can receive a token and may even
      // reach the consent screen, but Spotify returns 403 to API calls. Checking
      // devices now prevents a false-green Receiver before any schedule runs.
      await this.api('GET', '/me/player/devices');
      this.accountProfile = {
        displayName: String(profile?.display_name || '').slice(0, 120),
        accountId: String(profile?.account_id || profile?.id || '').slice(0, 120)
      };
      this.accessVerified = true;
      this.accessVerifiedAt = Date.now();
      this.accessState = 'verified';
      this.accessError = '';
      this.report('Spotify Web API account access passed. Playback access is verified when the receiver device connects.', true, { accessVerified: true });
      return { verified: true, profile: this.accountProfile };
    } catch (error) {
      const message = error?.message || String(error);
      this.resetAccessVerification(message);
      this.report(message, false, {
        accessVerified: false,
        errorCode: error?.code || '',
        errorStatus: Number(error?.status || 0) || null,
        errorOperation: error?.spotifyOperation || '',
        spotifyReason: error?.spotifyReason || ''
      });
      throw error;
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
      this.invalidateVolumeOperations();
      this.deviceId = device_id;
      this.ready = true;
      this.deviceUsable = false;
      // The SDK ready event does not report the device volume capability. Keep
      // this false until /me/player/devices explicitly confirms it.
      this.supportsVolume = false;
      this.report(this.accessVerified ? 'Spotify SDK device is ready and account access is verified.' : 'Spotify SDK device is ready; account access still needs verification.', this.accessVerified);
    });
    this.player.addListener('not_ready', () => {
      this.ready = false;
      this.deviceUsable = false;
      this.supportsVolume = false;
      this.invalidateVolumeOperations();
      this.report('Spotify receiver went offline. Tap Connect Spotify Receiver again.', false);
    });
    this.player.addListener('autoplay_failed', () => {
      this.resetVolumeVerification();
      const message = 'Spotify autoplay was blocked. Tap Connect Spotify Receiver once on this speaker device.';
      this.failActivation(message);
      this.report(message, false);
    });
    this.player.addListener('initialization_error', ({ message } = {}) => {
      this.resetVolumeVerification();
      const reason = boundedSpotifyReason({ message }) || 'SDK initialization rejected';
      this.report(`Spotify cannot initialize in this browser: ${reason}. Update Safari or Chrome, disable content blockers for this site, and try again.`, false, { errorCode: 'SPOTIFY_SDK_INITIALIZATION', spotifyReason: reason });
    });
    this.player.addListener('authentication_error', ({ message } = {}) => {
      this.resetVolumeVerification();
      const reason = boundedSpotifyReason({ message }) || 'SDK authorization rejected';
      const detail = `Spotify receiver authentication failed: ${reason}. Log out, then choose a Premium account authorized for this app; Development Mode accounts must also be in Users Management.`;
      this.resetAccessVerification(detail);
      this.failActivation(detail);
      this.report(detail, false, { errorCode: 'SPOTIFY_SDK_AUTHENTICATION', spotifyReason: reason });
    });
    this.player.addListener('account_error', ({ message } = {}) => {
      this.resetVolumeVerification();
      const reason = boundedSpotifyReason({ message }) || 'Account restriction';
      const detail = `Spotify rejected this account: ${reason}. Use a Premium account authorized for this app; if the app uses Development Mode, add that exact account in Users Management.`;
      this.resetAccessVerification(detail);
      this.report(detail, false, { errorCode: 'SPOTIFY_SDK_ACCOUNT', spotifyReason: reason });
    });
    this.player.addListener('playback_error', ({ message } = {}) => {
      this.resetVolumeVerification();
      const reason = boundedSpotifyReason({ message }) || 'Playback command rejected';
      this.report(`Spotify playback failed: ${reason}. Check the selected Spotify link and reconnect the receiver.`, false, { errorCode: 'SPOTIFY_SDK_PLAYBACK', spotifyReason: reason });
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
      await this.verifyAccess();
      const Spotify = await this.ensureSdk();
      if (!this.player) {
        this.player = new Spotify.Player({
          name: PLAYER_NAME,
          getOAuthToken: callback => this.accessToken().then(callback).catch(error => this.report(error.message, false)),
          volume: this.targetVolumePercent / 100
        });
        this.resetActivation();
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
    await this.requireActivation();
    await this.verifyAccess();
    if (this.ready && this.deviceId) {
      await this.api('PUT', '/me/player', { device_ids: [this.deviceId], play: false });
      await this.refreshCapabilities({ strict: true });
      return this.deviceId;
    }
    if (this.connectPromise) return await this.connectPromise;
    this.connectPromise = (async () => {
      const connected = await withTimeout(this.player.connect(), 8_000, 'Spotify receiver connection timed out.');
      if (!connected) throw new Error('Spotify receiver did not connect.');
      const startedAt = Date.now();
      while ((!this.ready || !this.deviceId) && Date.now() - startedAt < 18_000) await wait(150);
      if (!this.deviceId) throw new Error('Spotify receiver did not report ready.');
      await this.api('PUT', '/me/player', { device_ids: [this.deviceId], play: false });
      await this.refreshCapabilities({ strict: true });
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

  async refreshCapabilities({ strict = false } = {}) {
    if (!this.deviceId) {
      this.deviceUsable = false;
      this.supportsVolume = false;
      this.resetVolumeVerification();
      return { supportsVolume: false, volumeVerified: false, verifiedPercent: null, device: null };
    }
    const requestedDeviceId = String(this.deviceId);
    try {
      const data = await this.api('GET', '/me/player/devices');
      if (requestedDeviceId !== String(this.deviceId || '')) {
        this.deviceUsable = false;
        this.supportsVolume = false;
        this.invalidateVolumeOperations();
        return { supportsVolume: false, volumeVerified: false, verifiedPercent: null, device: null, error: 'Spotify receiver changed while its capability was checked.' };
      }
      const device = (data.devices || []).find(item => String(item.id || '') === requestedDeviceId);
      if (!device) {
        this.deviceUsable = false;
        const error = new Error('Spotify connected the SDK, but the account device list did not include this receiver. Tap Connect Spotify Receiver again.');
        error.code = 'SPOTIFY_DEVICE_MISSING';
        error.spotifyOperation = 'GET /me/player/devices';
        if (strict) throw error;
        return { supportsVolume: false, volumeVerified: false, verifiedPercent: null, device: null, error: error.message };
      }
      if (device.is_restricted === true) {
        this.deviceUsable = false;
        const error = new Error('Spotify marked this browser playback device as restricted, so Web API play commands cannot target it. Try an updated desktop Safari or Chrome receiver.');
        error.code = 'SPOTIFY_DEVICE_RESTRICTED';
        error.spotifyOperation = 'GET /me/player/devices';
        if (strict) throw error;
        return { supportsVolume: false, volumeVerified: false, verifiedPercent: null, device, error: error.message };
      }
      this.supportsVolume = !isIOSLike() && device?.is_restricted !== true && device?.supports_volume === true;
      this.deviceUsable = true;
      if (!this.supportsVolume || this.verifiedDeviceId !== requestedDeviceId) this.resetVolumeVerification();
      return { supportsVolume: this.supportsVolume, volumeVerified: this.volumeVerified, verifiedPercent: this.verifiedPercent, device: device || null };
    } catch (error) {
      this.deviceUsable = false;
      this.supportsVolume = false;
      this.resetVolumeVerification();
      if (error?.status === 403) this.resetAccessVerification(error.message || 'Spotify denied receiver device access.');
      if (strict) throw error;
      return { supportsVolume: false, volumeVerified: false, verifiedPercent: null, error: error.message };
    }
  }

  async readLocalVolume(expected = this.targetVolumePercent) {
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

  async enforceVolume(percent = this.targetVolumePercent) {
    if (!this.deviceId || !this.player) throw new Error('Spotify receiver is not connected.');
    const targetPercent = clamp(percent, 0, 100, MUSIC_LEVEL_PERCENT);
    const staleResult = reason => ({
      supportsVolume: this.supportsVolume,
      volumeVerified: false,
      verifiedPercent: null,
      verified: false,
      actual: null,
      stale: true,
      reason
    });
    if (targetPercent !== this.targetVolumePercent) {
      return staleResult(`A newer ${this.targetVolumePercent}% Spotify target replaced the stale ${targetPercent}% request.`);
    }
    const generation = this.volumeGeneration;
    const expectedDeviceId = String(this.deviceId);
    const operationCurrent = () => generation === this.volumeGeneration &&
      targetPercent === this.targetVolumePercent &&
      expectedDeviceId === String(this.deviceId || '') && this.ready;
    const work = async () => {
      if (!operationCurrent()) return staleResult('A newer Spotify target or receiver replaced this volume request.');
      this.resetVolumeVerification();
      if (isIOSLike()) {
        this.supportsVolume = false;
        return { supportsVolume: false, volumeVerified: false, verifiedPercent: null, verified: false, actual: null, reason: `iPhone and iPad keep Spotify volume under physical control; ${targetPercent}% is only the requested target.` };
      }
      if (!this.supportsVolume || typeof this.player.setVolume !== 'function' || typeof this.player.getVolume !== 'function') {
        return { supportsVolume: this.supportsVolume, volumeVerified: false, verifiedPercent: null, verified: false, actual: null, reason: 'This Spotify receiver did not confirm software volume control.' };
      }
      try {
        await withTimeout(this.player.setVolume(targetPercent / 100), 4_000, 'Spotify volume setting timed out.');
        if (!operationCurrent()) return staleResult('A newer Spotify target replaced this request while volume was changing.');
        for (let elapsed = 0; elapsed < 400; elapsed += 50) {
          await wait(50);
          if (!operationCurrent()) return staleResult('A newer Spotify target replaced this request before verification.');
        }
        const measurement = await this.readLocalVolume(targetPercent);
        if (!operationCurrent()) return staleResult('A newer Spotify target replaced this request while volume was being verified.');
        this.volumeVerified = measurement.matches;
        this.verifiedPercent = this.volumeVerified ? targetPercent : null;
        this.verifiedDeviceId = this.volumeVerified ? expectedDeviceId : '';
        const verification = {
          supportsVolume: this.supportsVolume,
          volumeVerified: this.volumeVerified,
          verifiedPercent: this.verifiedPercent,
          verified: this.volumeVerified,
          actual: measurement.actual,
          reason: measurement.reason
        };
        this.report(
          verification.verified ? `Spotify volume verified at ${targetPercent}%.` : `Spotify volume was not verified at ${targetPercent}%: ${verification.reason}`,
          verification.verified,
          verification
        );
        return verification;
      } catch {
        if (!operationCurrent()) return staleResult('A newer Spotify target or receiver replaced the failed volume request.');
        this.resetVolumeVerification();
        const verification = {
          supportsVolume: this.supportsVolume,
          volumeVerified: false,
          verifiedPercent: null,
          verified: false,
          actual: null,
          reason: 'Spotify volume control could not be verified.'
        };
        this.report(verification.reason, false, verification);
        return verification;
      }
    };
    const job = this.volumeOperationTail.then(work, work);
    this.volumeOperationTail = job.catch(() => {});
    return await job;
  }

  async enforceThirtyPercent() {
    return await this.enforceVolume(this.targetVolumePercent);
  }

  async validatePlaybackSource(input, { force = false } = {}) {
    const resource = spotifyResource(input);
    const cached = this.sourceValidationCache.get(resource.uri);
    if (!force && cached && Date.now() - cached.checkedAt <= SOURCE_CACHE_MS) return cached;
    await this.verifyAccess();
    try {
      let data = null;
      if (resource.type === 'playlist') {
        // Development Mode renamed tracks to items while Extended Quota keeps
        // the legacy shape. An unrestricted metadata read is compatible with
        // both, and public playlists may legitimately omit their contents.
        data = await this.api('GET', `/playlists/${resource.id}`);
      } else if (resource.type === 'track') {
        data = await this.api('GET', `/tracks/${resource.id}`);
      } else if (resource.type === 'album') {
        data = await this.api('GET', `/albums/${resource.id}`);
      } else if (resource.type === 'artist') {
        data = await this.api('GET', `/artists/${resource.id}`);
      }
      const result = {
        ...resource,
        checkedAt: Date.now(),
        name: String(data?.name || '').slice(0, 180),
        public: typeof data?.public === 'boolean' ? data.public : null,
        trackCount: Number(data?.items?.total ?? data?.tracks?.total ?? 0) || null
      };
      this.sourceValidationCache.set(resource.uri, result);
      this.report(`Spotify source verified${result.name ? `: ${result.name}` : '.'}`, true, { source: result });
      return result;
    } catch (error) {
      if (error?.status === 403 && ['playlist', 'track', 'album', 'artist'].includes(resource.type)) {
        // A source can be forbidden while the account and receiver remain
        // healthy. Re-run the account/device preflight to distinguish those
        // cases before disabling unrelated public-source diagnostics.
        await this.verifyAccess({ force: true });
        const unavailable = new Error(`Spotify cannot access this ${resource.type} with the signed-in account. It may be private, unavailable to this account, or missing a required source permission.`);
        unavailable.code = 'SPOTIFY_SOURCE_UNAVAILABLE';
        unavailable.status = 403;
        unavailable.spotifyOperation = error.spotifyOperation || `GET /${resource.type}s/${resource.id}`;
        unavailable.spotifyReason = error.spotifyReason || 'Source access forbidden';
        throw unavailable;
      }
      if (resource.type === 'playlist' && error?.status === 404) {
        const unavailable = new Error('Spotify cannot access this playlist. It may be deleted, private to another account, or mistyped. Paste a playlist owned by this receiver account or use a valid public track.');
        unavailable.code = 'SPOTIFY_SOURCE_UNAVAILABLE';
        unavailable.status = 404;
        unavailable.spotifyOperation = error.spotifyOperation || `GET /playlists/${resource.id}`;
        unavailable.spotifyReason = error.spotifyReason || 'playlist not found';
        throw unavailable;
      }
      if (error?.status === 404) {
        const unavailable = new Error(`Spotify cannot access this ${resource.type}. It may be deleted, unavailable in this account's market, or mistyped.`);
        unavailable.code = 'SPOTIFY_SOURCE_UNAVAILABLE';
        unavailable.status = 404;
        unavailable.spotifyOperation = error.spotifyOperation || `GET /${resource.type}s/${resource.id}`;
        unavailable.spotifyReason = error.spotifyReason || `${resource.type} not found`;
        throw unavailable;
      }
      throw error;
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
      volumeVerified: localDevice && this.volumeVerified && this.verifiedDeviceId === stateDeviceId && this.verifiedPercent === this.targetVolumePercent,
      verifiedPercent: localDevice && this.volumeVerified && this.verifiedDeviceId === stateDeviceId ? this.verifiedPercent : null,
      position: Number(state?.progress_ms || 0),
      uri: state?.item?.uri || '',
      name: String(state?.item?.name || ''),
      artists: (state?.item?.artists || []).map(artist => artist?.name).filter(Boolean).join(', '),
      contextUri: state?.context?.uri || ''
    };
  }

  async waitForPlayback(expectedPlaying, timeoutMs = 4_000, expectedResource = null) {
    const startedAt = Date.now();
    let last = null;
    let lastError = null;
    while (Date.now() - startedAt < timeoutMs) {
      try {
        last = await this.playbackState();
        const exactDevice = !this.deviceId || (!!last.deviceId && String(last.deviceId) === String(this.deviceId));
        const sourceMatches = !expectedPlaying || !expectedResource
          ? true
          : expectedResource.type === 'track'
            ? String(last.uri || '') === String(expectedResource.uri || '')
            : String(last.contextUri || '') === String(expectedResource.uri || '');
        if (last.isPlaying === expectedPlaying && exactDevice && sourceMatches) return last;
      } catch (error) {
        lastError = error;
        if (error?.status || String(error?.code || '').startsWith('SPOTIFY_')) throw error;
      }
      await wait(250);
    }
    const sourceDetail = expectedPlaying && expectedResource
      ? ` on this receiver for the requested ${expectedResource.type}`
      : '';
    const error = new Error(`Spotify did not confirm that playback was ${expectedPlaying ? 'playing' : 'paused'}${sourceDetail}.${lastError ? ` Last check: ${lastError.message}` : ''}`);
    error.code = 'SPOTIFY_PLAYBACK_NOT_CONFIRMED';
    error.spotifyOperation = 'GET /me/player';
    error.spotifyReason = expectedPlaying && expectedResource ? 'Requested source was not confirmed' : 'Playback state was not confirmed';
    throw error;
  }

  async play(url, { assertCurrent = null } = {}) {
    assertOperation(assertCurrent);
    await this.verifyAccess();
    assertOperation(assertCurrent);
    const source = await this.validatePlaybackSource(url);
    assertOperation(assertCurrent);
    const deviceId = await this.connectFromUserGesture();
    assertOperation(assertCurrent);
    const body = spotifyPlayBody(url);
    await this.api('PUT', '/me/player', { device_ids: [deviceId], play: false });
    assertOperation(assertCurrent);
    await wait(250);
    // Calibrate while playback is still paused so a previously changed SDK
    // volume never leaks through during the audible startup transition.
    if (this.supportsVolume) await this.enforceVolume();
    assertOperation(assertCurrent);
    await this.api('PUT', '/me/player/play', body, { device_id: deviceId });
    assertOperation(assertCurrent);
    const state = await this.waitForPlayback(true, 6_000, source);
    assertOperation(assertCurrent);
    const volume = await this.enforceVolume();
    assertOperation(assertCurrent);
    this.report(volume.verified ? `Spotify is playing at verified ${this.targetVolumePercent}%.` : 'Spotify is playing in pause-for-voice compatibility mode.', true, { playback: state, volume });
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
    if (this.supportsVolume) await this.enforceVolume();
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
      await this.enforceVolume().catch(() => {});
      assertOperation(assertCurrent);
    }
    return accepted;
  }

  async next({ assertCurrent = null } = {}) {
    if (!this.deviceId) throw new Error('Spotify receiver is not connected.');
    assertOperation(assertCurrent);
    const before = await this.playbackState().catch(() => null);
    assertOperation(assertCurrent);
    if (this.supportsVolume) await this.enforceVolume();
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
      await this.enforceVolume().catch(() => {});
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
    this.deviceUsable = false;
    this.deviceId = '';
    this.supportsVolume = false;
    this.invalidateVolumeOperations();
    this.current = null;
    this.resetActivation();
  }
}
