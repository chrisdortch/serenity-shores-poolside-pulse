import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  SPOTIFY_PKCE_TTL_MS,
  SPOTIFY_REDIRECT_URI,
  SpotifyReceiver,
  isCanonicalSpotifyLocation,
  safeSpotifyReturnPath
} from '../src/vfinal/spotify-receiver.js';

const PKCE_KEY = 'poolside-pulse-vfinal-spotify-pkce';
const TOKEN_KEY = 'poolside-pulse-vfinal-spotify-token';

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
    returnPath: '/?v=final#receiver',
    redirectUri: SPOTIFY_REDIRECT_URI,
    createdAt: 1_000,
    ...overrides
  };
}

describe('Spotify canonical PKCE login', { concurrency: false }, () => {
  test('uses the exact production redirect and stores verifier only in an expiring local transaction', async () => {
    const env = browserEnvironment('https://serenity-shores-poolside-pulse.vercel.app/?v=final#receiver');
    try {
      const receiver = new SpotifyReceiver({
        clientId: 'client-id',
        now: () => 1_000,
        random: length => length === 96 ? 'v'.repeat(96) : 's'.repeat(32),
        pkceChallenge: async verifier => `challenge-${verifier.length}`
      });

      await receiver.beginLogin('/?v=final#receiver');

      const authorization = new URL(env.assigned);
      const pending = JSON.parse(env.localStorage.getItem(PKCE_KEY));
      assert.equal(authorization.origin, 'https://accounts.spotify.com');
      assert.equal(authorization.searchParams.get('redirect_uri'), SPOTIFY_REDIRECT_URI);
      assert.equal(authorization.searchParams.get('state'), pending.state);
      assert.equal(authorization.searchParams.get('code_challenge'), 'challenge-96');
      assert.equal(pending.verifier, 'v'.repeat(96));
      assert.notEqual(pending.state, pending.verifier, 'the PKCE verifier must never be embedded in OAuth state');
      assert.equal(pending.createdAt, 1_000);
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

      assert.equal(env.assigned, 'https://serenity-shores-poolside-pulse.vercel.app/?v=final#receiver');
      assert.equal(env.localStorage.getItem(PKCE_KEY), null);
      assert.equal(isCanonicalSpotifyLocation(), false);
      assert.equal(safeSpotifyReturnPath('//attacker.example/steal'), '/?v=final#receiver');
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
      tokenRequest = { url: String(url), options };
      return response(200, {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3_600
      });
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
      assert.equal(env.replacements.at(-1), '/?v=final#receiver');
      assert.equal(env.location.search, '?v=final');
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
      assert.equal(env.replacements.at(-1), '/?v=final#receiver');

      env.location.setHref(`${SPOTIFY_REDIRECT_URI}?code=late-code&state=${'s'.repeat(32)}`);
      env.localStorage.setItem(PKCE_KEY, JSON.stringify(pendingTransaction()));
      const expired = new SpotifyReceiver({ clientId: 'client-id', now: () => 1_000 + SPOTIFY_PKCE_TTL_MS + 1 });
      await assert.rejects(expired.completeLoginFromCallback(), /took too long and expired/i);
      assert.equal(env.localStorage.getItem(PKCE_KEY), null);
      assert.equal(env.replacements.at(-1), '/?v=final#receiver');

      env.location.setHref(`${SPOTIFY_REDIRECT_URI}?code=wrong-state&state=${'x'.repeat(32)}`);
      env.localStorage.setItem(PKCE_KEY, JSON.stringify(pendingTransaction()));
      const mismatched = new SpotifyReceiver({ clientId: 'client-id', now: () => 2_000 });
      await assert.rejects(mismatched.completeLoginFromCallback(), /state did not match/i);
      assert.equal(env.localStorage.getItem(PKCE_KEY), null);
      assert.equal(env.replacements.at(-1), '/?v=final#receiver');
    } finally {
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
      receiver.api = async method => method === 'GET'
        ? { devices: [{ id: 'receiver-a', is_restricted: false, supports_volume: false }] }
        : {};
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

      globalThis.fetch = async () => response(403, { error: { message: 'forbidden' } });
      await assert.rejects(
        receiver.api('PUT', '/me/player/play'),
        error => /Premium/i.test(error.message) && /allowlist/i.test(error.message)
      );
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });
});
