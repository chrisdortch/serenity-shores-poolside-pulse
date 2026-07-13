import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  SPOTIFY_PKCE_TTL_MS,
  SPOTIFY_REDIRECT_URI,
  SpotifyReceiver,
  isCanonicalSpotifyLocation,
  safeSpotifyReturnPath
} from '../src/v30/spotify-receiver.js';

const PKCE_KEY = 'poolside-pulse-v30-spotify-pkce';
const TOKEN_KEY = 'poolside-pulse-v30-spotify-token';

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }
}

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

function browserEnvironment(initialUrl = SPOTIFY_REDIRECT_URI) {
  let current = new URL(initialUrl);
  let assigned = '';
  const replacements = [];
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const location = {
    get href() { return current.href; },
    get origin() { return current.origin; },
    get hostname() { return current.hostname; },
    get pathname() { return current.pathname; },
    get search() { return current.search; },
    get hash() { return current.hash; },
    assign(value) { assigned = String(value); },
    setHref(value) { current = new URL(value, current); }
  };
  const history = {
    replaceState(_state, _unused, value) {
      replacements.push(String(value));
      current = new URL(String(value), current);
    }
  };
  const restores = [
    replaceGlobal('location', location),
    replaceGlobal('history', history),
    replaceGlobal('localStorage', localStorage),
    replaceGlobal('sessionStorage', sessionStorage)
  ];
  return {
    location,
    localStorage,
    sessionStorage,
    replacements,
    get assigned() { return assigned; },
    restore() { restores.reverse().forEach(restore => restore()); }
  };
}

function response(status, data = {}, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => headers[String(name).toLowerCase()] || null },
    async json() { return data; }
  };
}

function pendingTransaction(overrides = {}) {
  return {
    state: 's'.repeat(32),
    verifier: 'v'.repeat(96),
    returnPath: '/?v=30#receiver',
    redirectUri: SPOTIFY_REDIRECT_URI,
    createdAt: 1_000,
    ...overrides
  };
}

describe('Spotify canonical PKCE login', { concurrency: false }, () => {
  test('uses the exact production redirect and stores verifier only in an expiring local transaction', async () => {
    const env = browserEnvironment('https://serenity-shores-poolside-pulse.vercel.app/?v=30#receiver');
    try {
      env.localStorage.setItem('poolside-pulse-vfinal-spotify-token', JSON.stringify({ access_token: 'obsolete' }));
      const receiver = new SpotifyReceiver({
        clientId: 'client-id',
        now: () => 1_000,
        random: length => length === 96 ? 'v'.repeat(96) : 's'.repeat(32),
        pkceChallenge: async verifier => `challenge-${verifier.length}`
      });

      await receiver.beginLogin('/?v=30#receiver');

      const authorization = new URL(env.assigned);
      const pending = JSON.parse(env.localStorage.getItem(PKCE_KEY));
      assert.equal(authorization.origin, 'https://accounts.spotify.com');
      assert.equal(authorization.searchParams.get('redirect_uri'), SPOTIFY_REDIRECT_URI);
      assert.equal(authorization.searchParams.get('state'), pending.state);
      assert.equal(authorization.searchParams.get('code_challenge'), 'challenge-96');
      assert.equal(authorization.searchParams.get('show_dialog'), 'true');
      assert.match(authorization.searchParams.get('scope'), /playlist-read-private/);
      assert.equal(pending.verifier, 'v'.repeat(96));
      assert.notEqual(pending.state, pending.verifier, 'the PKCE verifier must never be embedded in OAuth state');
      assert.equal(pending.createdAt, 1_000);
      assert.equal(env.localStorage.getItem('poolside-pulse-vfinal-spotify-token'), null);
      assert.equal(env.sessionStorage.values.size, 0, 'the transaction survives a new tab/PWA context through localStorage');
    } finally {
      env.restore();
    }
  });

  test('moves a noncanonical login start to production before creating PKCE material', async () => {
    const env = browserEnvironment('https://preview-poolside-pulse.vercel.app/?v=final#receiver');
    try {
      const receiver = new SpotifyReceiver({ clientId: 'client-id' });
      await receiver.beginLogin('https://attacker.example/steal');

      assert.equal(env.assigned, 'https://serenity-shores-poolside-pulse.vercel.app/?v=30#receiver');
      assert.equal(env.localStorage.getItem(PKCE_KEY), null);
      assert.equal(isCanonicalSpotifyLocation(), false);
      assert.equal(safeSpotifyReturnPath('//attacker.example/steal'), '/?v=30#receiver');
    } finally {
      env.restore();
    }
  });

  test('exchanges a matching callback and removes code, state, and PKCE data', async () => {
    const env = browserEnvironment(`${SPOTIFY_REDIRECT_URI}?code=spotify-code&state=${'s'.repeat(32)}`);
    const originalFetch = globalThis.fetch;
    let tokenRequest = null;
    env.localStorage.setItem(PKCE_KEY, JSON.stringify(pendingTransaction()));
    globalThis.fetch = async (url, options) => {
      const href = String(url);
      if (href === 'https://accounts.spotify.com/api/token') {
        tokenRequest = { url: href, options };
        return response(200, {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3_600
        });
      }
      if (href === 'https://api.spotify.com/v1/me') {
        return response(200, { display_name: 'Pool Receiver', email: 'receiver@example.com', product: 'premium', account_id: 'account-a' });
      }
      if (href === 'https://api.spotify.com/v1/me/player/devices') return response(200, { devices: [] });
      throw new Error(`Unexpected Spotify request: ${href}`);
    };
    try {
      const receiver = new SpotifyReceiver({ clientId: 'client-id', now: () => 2_000 });
      assert.equal(await receiver.completeLoginFromCallback(), true);

      const body = new URLSearchParams(tokenRequest.options.body);
      assert.equal(tokenRequest.url, 'https://accounts.spotify.com/api/token');
      assert.equal(body.get('redirect_uri'), SPOTIFY_REDIRECT_URI);
      assert.equal(body.get('code_verifier'), 'v'.repeat(96));
      assert.equal(env.localStorage.getItem(PKCE_KEY), null);
      assert.equal(JSON.parse(env.localStorage.getItem(TOKEN_KEY)).access_token, 'access-token');
      assert.equal(receiver.accessVerified, true);
      assert.deepEqual(receiver.accountProfile, { displayName: 'Pool Receiver', accountId: 'account-a' });
      assert.equal(env.replacements.at(-1), '/?v=30#receiver');
      assert.equal(env.location.search, '?v=30');
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });

  test('cleans denied and expired callbacks and gives an actionable fresh-login error', async () => {
    const env = browserEnvironment(`${SPOTIFY_REDIRECT_URI}?error=access_denied&state=${'s'.repeat(32)}`);
    try {
      env.localStorage.setItem(PKCE_KEY, JSON.stringify(pendingTransaction()));
      const denied = new SpotifyReceiver({ clientId: 'client-id', now: () => 2_000 });
      await assert.rejects(denied.completeLoginFromCallback(), /cancelled or permission was not granted/i);
      assert.equal(env.localStorage.getItem(PKCE_KEY), null);
      assert.equal(env.replacements.at(-1), '/?v=30#receiver');

      env.location.setHref(`${SPOTIFY_REDIRECT_URI}?code=late-code&state=${'s'.repeat(32)}`);
      env.localStorage.setItem(PKCE_KEY, JSON.stringify(pendingTransaction()));
      const expired = new SpotifyReceiver({ clientId: 'client-id', now: () => 1_000 + SPOTIFY_PKCE_TTL_MS + 1 });
      await assert.rejects(expired.completeLoginFromCallback(), /took too long and expired/i);
      assert.equal(env.localStorage.getItem(PKCE_KEY), null);
      assert.equal(env.replacements.at(-1), '/?v=30#receiver');

      env.location.setHref(`${SPOTIFY_REDIRECT_URI}?code=wrong-state&state=${'x'.repeat(32)}`);
      env.localStorage.setItem(PKCE_KEY, JSON.stringify(pendingTransaction()));
      const mismatched = new SpotifyReceiver({ clientId: 'client-id', now: () => 2_000 });
      await assert.rejects(mismatched.completeLoginFromCallback(), /state did not match/i);
      assert.equal(env.localStorage.getItem(PKCE_KEY), null);
      assert.equal(env.replacements.at(-1), '/?v=30#receiver');
    } finally {
      env.restore();
    }
  });

  test('rejects a false-green login when Spotify accepts OAuth but denies Development Mode API access', async () => {
    const env = browserEnvironment(`${SPOTIFY_REDIRECT_URI}?code=spotify-code&state=${'s'.repeat(32)}`);
    const originalFetch = globalThis.fetch;
    env.localStorage.setItem(PKCE_KEY, JSON.stringify(pendingTransaction()));
    globalThis.fetch = async url => String(url) === 'https://accounts.spotify.com/api/token'
      ? response(200, { access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3_600 })
      : response(403, { error: { message: 'Restriction violated' } });
    try {
      const receiver = new SpotifyReceiver({ clientId: 'client-id', now: () => 2_000 });
      await assert.rejects(
        receiver.completeLoginFromCallback(),
        error => error.code === 'SPOTIFY_ACCESS_RESTRICTED' &&
          error.status === 403 &&
          error.spotifyOperation === 'GET /me' &&
          error.spotifyReason === 'Restriction violated' &&
          /Development Mode|Users Management/i.test(error.message)
      );
      assert.equal(receiver.loggedIn(), true, 'the token remains available so the UI can offer Remove Login and a deliberate account change');
      assert.equal(receiver.accessVerified, false);
      assert.equal(receiver.accessState, 'blocked');
      assert.match(receiver.accessError, /Restriction violated/i);
      assert.equal(env.replacements.at(-1), '/?v=30#receiver');
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });
});

describe('Spotify activation and authorization recovery', { concurrency: false }, () => {
  test('calls activateElement synchronously once and never repeats it during connect or scheduled play', async () => {
    const env = browserEnvironment();
    env.localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: 'access-token', expiresAt: Date.now() + 3_600_000 }));
    try {
      const activation = Promise.withResolvers();
      let activationCalls = 0;
      const receiver = new SpotifyReceiver({ clientId: 'client-id' });
      receiver.playerPrepared = true;
      receiver.player = {
        activateElement() {
          activationCalls += 1;
          return activation.promise;
        }
      };

      const activated = receiver.activateFromUserGesture();
      assert.equal(activationCalls, 1, 'SDK activation must happen in the original synchronous click stack');
      assert.equal(receiver.activationState, 'activating');
      activation.resolve();
      await activated;
      assert.equal(receiver.activationState, 'active');

      receiver.ready = true;
      receiver.deviceId = 'receiver-a';
      receiver.accessVerified = true;
      receiver.accessVerifiedAt = Date.now();
      receiver.accessState = 'verified';
      receiver.api = async (method, path) => method === 'GET' && path === '/me/player/devices'
        ? { devices: [{ id: 'receiver-a', is_restricted: false, supports_volume: false }] }
        : {};
      receiver.validatePlaybackSource = async () => ({ type: 'track', id: 'abc123', uri: 'spotify:track:abc123' });
      receiver.waitForPlayback = async () => ({ isPlaying: true, deviceId: 'receiver-a' });

      await receiver.connectFromUserGesture();
      await receiver.play('spotify:track:abc123');
      assert.equal(activationCalls, 1, 'remote and scheduled paths must reuse the explicit activation');
    } finally {
      env.restore();
    }
  });

  test('blocks connect until the receiver has a fresh explicit activation tap', async () => {
    const env = browserEnvironment();
    env.localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: 'access-token', expiresAt: Date.now() + 3_600_000 }));
    try {
      let connectCalls = 0;
      const receiver = new SpotifyReceiver({ clientId: 'client-id' });
      receiver.playerPrepared = true;
      receiver.player = { async connect() { connectCalls += 1; return true; } };
      await assert.rejects(receiver.connectFromUserGesture(), /fresh local tap/i);
      assert.equal(connectCalls, 0);
    } finally {
      env.restore();
    }
  });

  test('refreshes once after a 401 and explains Premium or allowlist failures on 403', async () => {
    const env = browserEnvironment();
    const originalFetch = globalThis.fetch;
    env.localStorage.setItem(TOKEN_KEY, JSON.stringify({
      access_token: 'old-access',
      refresh_token: 'refresh-token',
      expiresAt: Date.now() + 3_600_000
    }));
    const apiTokens = [];
    let apiCalls = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url) === 'https://accounts.spotify.com/api/token') {
        return response(200, { access_token: 'new-access', expires_in: 3_600 });
      }
      apiCalls += 1;
      apiTokens.push(options.headers.Authorization);
      return apiCalls === 1 ? response(401, { error: { message: 'expired' } }) : response(204);
    };
    try {
      const receiver = new SpotifyReceiver({ clientId: 'client-id' });
      await receiver.api('PUT', '/me/player/pause');
      assert.deepEqual(apiTokens, ['Bearer old-access', 'Bearer new-access']);

      receiver.accessVerified = true;
      receiver.accessVerifiedAt = Date.now();
      receiver.accessState = 'verified';
      receiver.playerPrepared = true;
      receiver.activationState = 'active';
      receiver.ready = true;
      receiver.deviceUsable = true;
      receiver.deviceId = 'receiver-a';

      globalThis.fetch = async () => response(403, { error: { message: 'forbidden' } });
      await assert.rejects(
        receiver.api('PUT', '/me/player/play'),
        error => /Premium/i.test(error.message) && /Users Management/i.test(error.message) &&
          error.code === 'SPOTIFY_ACCESS_RESTRICTED' && error.spotifyOperation === 'PUT /me/player/play' && error.spotifyReason === 'Forbidden'
      );
      assert.equal(receiver.readiness().ready, false, 'a real API 403 must revoke previously green readiness');
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });

  test('fails closed when capability access is denied instead of marking an SDK-ready device usable', async () => {
    const env = browserEnvironment();
    env.localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: 'access-token', expiresAt: Date.now() + 3_600_000 }));
    try {
      const receiver = new SpotifyReceiver({ clientId: 'client-id' });
      receiver.accessVerified = true;
      receiver.accessVerifiedAt = Date.now();
      receiver.accessState = 'verified';
      receiver.playerPrepared = true;
      receiver.player = {};
      receiver.ready = true;
      receiver.deviceId = 'receiver-a';
      const restricted = new Error('Spotify denied GET /me/player/devices with HTTP 403.');
      restricted.code = 'SPOTIFY_ACCESS_RESTRICTED';
      restricted.status = 403;
      restricted.spotifyOperation = 'GET /me/player/devices';
      receiver.api = async () => { throw restricted; };

      await assert.rejects(receiver.refreshCapabilities({ strict: true }), error => error === restricted);
      assert.equal(receiver.supportsVolume, false);
      assert.equal(receiver.accessVerified, false);
      assert.equal(receiver.readiness().ready, false, 'a capability 403 must revoke false-green receiver readiness');
    } finally {
      env.restore();
    }
  });

  test('revokes readiness when an expired-token retry ends in a Spotify 403', async () => {
    const env = browserEnvironment();
    const originalFetch = globalThis.fetch;
    env.localStorage.setItem(TOKEN_KEY, JSON.stringify({
      access_token: 'old-access',
      refresh_token: 'refresh-token',
      expiresAt: Date.now() + 3_600_000
    }));
    let apiCalls = 0;
    globalThis.fetch = async url => {
      if (String(url) === 'https://accounts.spotify.com/api/token') {
        return response(200, { access_token: 'new-access', expires_in: 3_600 });
      }
      apiCalls += 1;
      return apiCalls === 1
        ? response(401, { error: { message: 'expired' } })
        : response(403, { error: { message: 'Restriction violated' } });
    };
    try {
      const receiver = new SpotifyReceiver({ clientId: 'client-id' });
      receiver.accessVerified = true;
      receiver.accessVerifiedAt = Date.now();
      receiver.accessState = 'verified';
      receiver.playerPrepared = true;
      receiver.activationState = 'active';
      receiver.ready = true;
      receiver.deviceUsable = true;
      receiver.deviceId = 'receiver-a';

      await assert.rejects(receiver.api('PUT', '/me/player/play'), error => error.status === 403);
      assert.equal(receiver.accessVerified, false);
      assert.equal(receiver.deviceUsable, false);
      assert.equal(receiver.readiness().ready, false);
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });

  test('distinguishes an inaccessible playlist and requires the exact receiver and requested source', async () => {
    const env = browserEnvironment();
    env.localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: 'access-token', expiresAt: Date.now() + 3_600_000 }));
    try {
      const receiver = new SpotifyReceiver({ clientId: 'client-id' });
      receiver.accessVerified = true;
      receiver.accessVerifiedAt = Date.now();
      receiver.accessState = 'verified';
      receiver.deviceId = 'receiver-a';
      const missing = new Error('not found');
      missing.status = 404;
      missing.spotifyOperation = 'GET /playlists/missing';
      missing.spotifyReason = 'Resource not found';
      receiver.api = async () => { throw missing; };
      await assert.rejects(
        receiver.validatePlaybackSource('spotify:playlist:missing'),
        error => error.code === 'SPOTIFY_SOURCE_UNAVAILABLE' && /deleted, private/i.test(error.message)
      );

      receiver.playbackState = async () => ({ isPlaying: true, deviceId: '' });
      await assert.rejects(receiver.waitForPlayback(true, 10), /did not confirm/i);
      receiver.playbackState = async () => ({ isPlaying: true, deviceId: 'receiver-a', uri: 'spotify:track:wrong' });
      await assert.rejects(
        receiver.waitForPlayback(true, 10, { type: 'track', uri: 'spotify:track:requested' }),
        error => error.code === 'SPOTIFY_PLAYBACK_NOT_CONFIRMED' && /requested track/i.test(error.message)
      );
      receiver.playbackState = async () => ({ isPlaying: true, deviceId: 'receiver-a', uri: 'spotify:track:requested' });
      assert.equal((await receiver.waitForPlayback(true, 10, { type: 'track', uri: 'spotify:track:requested' })).deviceId, 'receiver-a');
    } finally {
      env.restore();
    }
  });

  test('keeps a healthy receiver usable after a source-only 403 and still validates a public track', async () => {
    const env = browserEnvironment();
    const originalFetch = globalThis.fetch;
    env.localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: 'access-token', expiresAt: Date.now() + 3_600_000 }));
    globalThis.fetch = async url => {
      const href = String(url);
      if (href.endsWith('/playlists/privateSource')) {
        return response(403, { error: { message: 'Insufficient client scope' } });
      }
      if (href.endsWith('/me')) return response(200, { display_name: 'Pool Receiver', id: 'account-a' });
      if (href.endsWith('/me/player/devices')) {
        return response(200, { devices: [{ id: 'receiver-a', is_restricted: false, supports_volume: true }] });
      }
      if (href.endsWith('/tracks/publicTrack')) {
        return response(200, { id: 'publicTrack', name: 'Public diagnostic track' });
      }
      throw new Error(`Unexpected Spotify request: ${href}`);
    };
    try {
      const receiver = new SpotifyReceiver({ clientId: 'client-id' });
      receiver.accessVerified = true;
      receiver.accessVerifiedAt = Date.now();
      receiver.accessState = 'verified';
      receiver.playerPrepared = true;
      receiver.activationState = 'active';
      receiver.ready = true;
      receiver.deviceUsable = true;
      receiver.deviceId = 'receiver-a';

      await assert.rejects(
        receiver.validatePlaybackSource('spotify:playlist:privateSource'),
        error => error.code === 'SPOTIFY_SOURCE_UNAVAILABLE' && error.status === 403
      );
      assert.equal(receiver.readiness().ready, true, 'a private source must not falsely revoke healthy account/device readiness');

      const publicSource = await receiver.validatePlaybackSource('spotify:track:publicTrack');
      assert.equal(publicSource.uri, 'spotify:track:publicTrack');
      assert.equal(receiver.readiness().ready, true);
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });

  test('revokes device usability when Spotify returns player 404 to a formerly green receiver', async () => {
    const env = browserEnvironment();
    const originalFetch = globalThis.fetch;
    env.localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: 'access-token', expiresAt: Date.now() + 3_600_000 }));
    globalThis.fetch = async () => response(404, { error: { message: 'Player command failed: No active device found' } });
    try {
      const receiver = new SpotifyReceiver({ clientId: 'client-id' });
      receiver.accessVerified = true;
      receiver.accessVerifiedAt = Date.now();
      receiver.accessState = 'verified';
      receiver.playerPrepared = true;
      receiver.activationState = 'active';
      receiver.ready = true;
      receiver.deviceUsable = true;
      receiver.deviceId = 'receiver-a';

      await assert.rejects(receiver.api('PUT', '/me/player/play'), error => error.status === 404);
      assert.equal(receiver.accessVerified, true, 'a missing active device is not an account-access denial');
      assert.equal(receiver.deviceUsable, false);
      assert.equal(receiver.readiness().ready, false);
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });

  test('preserves structured polling failures and accepts current playlist response shapes without claiming Premium', async () => {
    const env = browserEnvironment();
    env.localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: 'access-token', expiresAt: Date.now() + 3_600_000 }));
    try {
      const statuses = [];
      const receiver = new SpotifyReceiver({ clientId: 'client-id', onStatus: status => statuses.push(status) });
      receiver.api = async (method, path, _body, query) => {
        assert.equal(method, 'GET');
        if (path === '/me') return { display_name: 'Pool Receiver', account_id: 'account-a' };
        if (path === '/me/player/devices') return { devices: [] };
        if (path === '/playlists/current') {
          assert.equal(query, undefined);
          return { id: 'current', name: 'Current playlist', items: { total: 12 } };
        }
        throw new Error(`Unexpected API path: ${path}`);
      };
      await receiver.verifyAccess({ force: true });
      assert.equal(receiver.accountProfile.product, undefined);
      assert.equal(receiver.accountProfile.email, undefined);
      assert.doesNotMatch(statuses.at(-1).message, /Premium.*verified/i);
      const source = await receiver.validatePlaybackSource('spotify:playlist:current', { force: true });
      assert.equal(source.trackCount, 12);

      const restricted = new Error('Spotify denied GET /me/player with HTTP 403.');
      restricted.code = 'SPOTIFY_ACCESS_RESTRICTED';
      restricted.status = 403;
      restricted.spotifyOperation = 'GET /me/player';
      restricted.spotifyReason = 'Restriction violated';
      receiver.playbackState = async () => { throw restricted; };
      await assert.rejects(receiver.waitForPlayback(true, 50), error => error === restricted);
    } finally {
      env.restore();
    }
  });
});
