import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  SPOTIFY_REDIRECT_URI,
  SpotifyReceiver,
  isCanonicalSpotifyLocation,
  safeSpotifyReturnPath
} from '../src/vx/spotify-receiver.js';

const VX_PKCE_KEY = 'poolside-pulse-vx-spotify-pkce';
const VX_TOKEN_KEY = 'poolside-pulse-vx-spotify-token';
const V30_PKCE_KEY = 'poolside-pulse-v30-spotify-pkce';
const V30_TOKEN_KEY = 'poolside-pulse-v30-spotify-token';
const VFINAL_TOKEN_KEY = 'poolside-pulse-vfinal-spotify-token';

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

function response(status, data = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    async json() { return data; }
  };
}

function seedOtherVersionStorage(env) {
  const values = {
    [V30_PKCE_KEY]: 'v30-pkce',
    [V30_TOKEN_KEY]: 'v30-token',
    [VFINAL_TOKEN_KEY]: 'vfinal-token'
  };
  for (const [key, value] of Object.entries(values)) {
    env.localStorage.setItem(key, value);
    env.sessionStorage.setItem(key, `${value}-session`);
  }
  return values;
}

function assertOtherVersionStorageUnchanged(env, values) {
  for (const [key, value] of Object.entries(values)) {
    assert.equal(env.localStorage.getItem(key), value);
    assert.equal(env.sessionStorage.getItem(key), `${value}-session`);
  }
}

describe('Version X Spotify receiver isolation', { concurrency: false }, () => {
  test('uses the stable X alias and writes only the X PKCE transaction', async () => {
    const env = browserEnvironment('https://poolside-pulse-x.vercel.app/#receiver');
    const otherVersions = seedOtherVersionStorage(env);
    try {
      const receiver = new SpotifyReceiver({
        clientId: 'client-id',
        now: () => 1_000,
        random: length => length === 96 ? 'v'.repeat(96) : 's'.repeat(32),
        pkceChallenge: async verifier => `challenge-${verifier.length}`
      });

      await receiver.beginLogin('/#receiver');

      const authorization = new URL(env.assigned);
      const pending = JSON.parse(env.localStorage.getItem(VX_PKCE_KEY));
      assert.equal(SPOTIFY_REDIRECT_URI, 'https://poolside-pulse-x.vercel.app/');
      assert.equal(authorization.origin, 'https://accounts.spotify.com');
      assert.equal(authorization.searchParams.get('redirect_uri'), SPOTIFY_REDIRECT_URI);
      assert.equal(authorization.searchParams.get('state'), pending.state);
      assert.equal(authorization.searchParams.get('code_challenge'), 'challenge-96');
      assert.equal(pending.returnPath, '/#receiver');
      assert.equal(pending.redirectUri, SPOTIFY_REDIRECT_URI);
      assert.equal(env.sessionStorage.getItem(VX_PKCE_KEY), null);
      assertOtherVersionStorageUnchanged(env, otherVersions);
    } finally {
      env.restore();
    }
  });

  test('canonicalizes login before creating PKCE data and rejects external return paths', async () => {
    const env = browserEnvironment('https://version-x-preview.vercel.app/#receiver');
    const otherVersions = seedOtherVersionStorage(env);
    try {
      const receiver = new SpotifyReceiver({ clientId: 'client-id' });
      await receiver.beginLogin('https://attacker.example/steal');

      assert.equal(env.assigned, 'https://poolside-pulse-x.vercel.app/#receiver');
      assert.equal(env.localStorage.getItem(VX_PKCE_KEY), null);
      assert.equal(isCanonicalSpotifyLocation(), false);
      assert.equal(safeSpotifyReturnPath('//attacker.example/steal'), '/#receiver');
      assertOtherVersionStorageUnchanged(env, otherVersions);
    } finally {
      env.restore();
    }
  });

  test('stores callback credentials under the X key without changing older versions', async () => {
    const state = 's'.repeat(32);
    const verifier = 'v'.repeat(96);
    const env = browserEnvironment(`${SPOTIFY_REDIRECT_URI}?code=spotify-code&state=${state}`);
    const otherVersions = seedOtherVersionStorage(env);
    const originalFetch = globalThis.fetch;
    env.localStorage.setItem(VX_PKCE_KEY, JSON.stringify({
      state,
      verifier,
      returnPath: '/#receiver',
      redirectUri: SPOTIFY_REDIRECT_URI,
      createdAt: 1_000
    }));
    globalThis.fetch = async url => {
      const href = String(url);
      if (href === 'https://accounts.spotify.com/api/token') {
        return response(200, {
          access_token: 'vx-access-token',
          refresh_token: 'vx-refresh-token',
          expires_in: 3_600
        });
      }
      if (href === 'https://api.spotify.com/v1/me') {
        return response(200, { display_name: 'Version X Receiver', product: 'premium', id: 'account-x' });
      }
      if (href === 'https://api.spotify.com/v1/me/player/devices') return response(200, { devices: [] });
      throw new Error(`Unexpected Spotify request: ${href}`);
    };
    try {
      const receiver = new SpotifyReceiver({ clientId: 'client-id', now: () => 2_000 });
      assert.equal(await receiver.completeLoginFromCallback(), true);

      assert.equal(env.localStorage.getItem(VX_PKCE_KEY), null);
      assert.equal(JSON.parse(env.localStorage.getItem(VX_TOKEN_KEY)).access_token, 'vx-access-token');
      assert.equal(receiver.accessVerified, true);
      assert.equal(env.replacements.at(-1), '/#receiver');
      assertOtherVersionStorageUnchanged(env, otherVersions);

      receiver.clearLogin();
      assert.equal(env.localStorage.getItem(VX_TOKEN_KEY), null);
      assertOtherVersionStorageUnchanged(env, otherVersions);
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });

  test('prepares an SDK player with the Version X receiver identity', async () => {
    const env = browserEnvironment();
    const otherVersions = seedOtherVersionStorage(env);
    env.localStorage.setItem(VX_TOKEN_KEY, JSON.stringify({
      access_token: 'vx-access-token',
      expiresAt: Date.now() + 3_600_000
    }));
    try {
      let playerOptions = null;
      class FakePlayer {
        constructor(options) {
          playerOptions = options;
        }

        addListener() {}
      }
      const receiver = new SpotifyReceiver({ clientId: 'client-id' });
      receiver.verifyAccess = async () => {
        receiver.accessVerified = true;
        return { verified: true };
      };
      receiver.ensureSdk = async () => ({ Player: FakePlayer });

      assert.equal(await receiver.preparePlayer(), true);
      assert.equal(playerOptions.name, 'Poolside Pulse X Spotify Receiver');
      assert.equal(playerOptions.volume, 0.3);
      assertOtherVersionStorageUnchanged(env, otherVersions);
    } finally {
      env.restore();
    }
  });
});
