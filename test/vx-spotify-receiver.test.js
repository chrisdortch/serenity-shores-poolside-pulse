import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const VX_APP_SOURCE = readFileSync(new URL('../src/vx/app.js', import.meta.url), 'utf8');
const VX_CORE_SOURCE = readFileSync(new URL('../src/vx/core.js', import.meta.url), 'utf8');

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
  test('shows Spotify login in the iPhone Receiver setup before receiver ownership', () => {
    const panelStart = VX_APP_SOURCE.indexOf('function iphoneReceiverModePanel');
    const panelEnd = VX_APP_SOURCE.indexOf('function updateLiveStatus', panelStart);
    const panelSource = VX_APP_SOURCE.slice(panelStart, panelEnd);

    assert.ok(panelStart > 0 && panelEnd > panelStart);
    assert.match(panelSource, /spotifySetupButton\(\{ disabled: spotify\.loggedIn\(\) && !owned \}\)/);
    assert.match(panelSource, /Spotify login is available before Start Receiver/);
    assert.match(panelSource, /Mode 1 · remote music control/);
    assert.match(panelSource, /Mode 2 · remote Pushcut announcements/);
  });

  test('uses the shared receiver mode ahead of a stale lease and exposes the official mode switch', () => {
    const modeStart = VX_APP_SOURCE.indexOf('function receiverOperatingMode');
    const modeEnd = VX_APP_SOURCE.indexOf('async function refreshPushcutStatus', modeStart);
    const modeSource = VX_APP_SOURCE.slice(modeStart, modeEnd);

    assert.ok(modeStart > 0 && modeEnd > modeStart);
    assert.match(modeSource, /state\?\.config\?\.receiverMode/);
    assert.match(modeSource, /configuredMode === 'browser' \|\| configuredMode === 'pushcut'/);
    assert.match(VX_APP_SOURCE, /const PUSHCUT_RUN_SERVER_URL = 'pushcut:\/\/open\/runServer'/);
    assert.match(VX_APP_SOURCE, /The Remote applies the music slider, pauses music for speech, plays the announcement at 100%, restores \$\{musicTarget\}%, and resumes/);
    assert.match(VX_APP_SOURCE, /operatingMode === 'pushcut'[\s\S]*Version X intentionally hides browser Play controls in Pushcut mode/);
  });

  test('routes live voice by shared mode and keeps Browser-mode sliders usable', () => {
    const sendStart = VX_APP_SOURCE.indexOf('async function sendLiveAnnouncement');
    const sendEnd = VX_APP_SOURCE.indexOf('async function runImmediateWeatherCheck', sendStart);
    const sendSource = VX_APP_SOURCE.slice(sendStart, sendEnd);
    const musicStart = VX_APP_SOURCE.indexOf('function musicLevelControl');
    const musicEnd = VX_APP_SOURCE.indexOf('function voiceLevelControl', musicStart);
    const voiceStart = musicEnd;
    const voiceEnd = VX_APP_SOURCE.indexOf('function musicSourceForm', voiceStart);

    assert.match(sendSource, /preferredAnnouncementTransport/);
    assert.match(sendSource, /receiverMode,/);
    assert.match(sendSource, /browserReceiverOnline: receiverMode === 'browser' && receiverOnline/);
    assert.match(sendSource, /const pushcutReady = pushcutAnnouncementReady\(\)/);
    assert.ok(sendSource.indexOf("transport === 'browser'") < sendSource.indexOf('sendPushcutAnnouncement'));
    assert.match(sendSource, /volumePercent: VOICE_LEVEL_PERCENT,[\s\S]*\.\.\.delivery/);
    assert.doesNotMatch(sendSource, /Short Suno\/direct announcement clips use Pushcut mode/);
    assert.match(sendSource, /forcePushcut = false/);
    assert.match(VX_APP_SOURCE, /label: 'Pushcut Receiver Test'[\s\S]*forcePushcut: true/);
    assert.match(VX_APP_SOURCE.slice(musicStart, musicEnd), /receiverOperatingMode\(\) === 'pushcut'/);
    assert.match(VX_APP_SOURCE.slice(voiceStart, voiceEnd), /Fixed announcement target/);
    assert.doesNotMatch(VX_APP_SOURCE.slice(voiceStart, voiceEnd), /id="voiceLevel" type="range"/);
  });

  test('keeps Pushcut timed copies separate from the live Browser schedule', () => {
    assert.match(VX_APP_SOURCE, /pushcutEnabled: requestedPushcutEnabled/);
    assert.match(VX_APP_SOURCE, /browserReceiverOnline: receiverMode === 'browser' && receiverOnline/);
    assert.match(VX_APP_SOURCE, /Pending Pushcut timed copies were cancelled/);
    assert.match(VX_APP_SOURCE, /Version X automatically cancels Pushcut timed copies/);
    assert.match(VX_APP_SOURCE, /runtime\.start[\s\S]*pushcutEnabledOverride: false/);
    assert.match(VX_APP_SOURCE, /runtime\.stop\(\)[\s\S]*pushcutEnabledOverride: true/);
    assert.match(VX_APP_SOURCE, /Stop Receiver &amp; Prepare Pushcut/);
    assert.match(VX_APP_SOURCE, /browserActive[\s\S]*data-action="stop-receiver"[\s\S]*PUSHCUT_RUN_SERVER_URL/);
  });

  test('continues scheduled controlled playlists without bypassing track-end schedule gates', () => {
    const callbackStart = VX_APP_SOURCE.indexOf('onPlayback: state =>');
    const callbackEnd = VX_APP_SOURCE.indexOf('const apple = new AppleMusicReceiver', callbackStart);
    const callbackSource = VX_APP_SOURCE.slice(callbackStart, callbackEnd);

    assert.match(callbackSource, /handleControlledTrackEnded\(state\)/);
    assert.match(callbackSource, /hasPendingControlledTrackEnd\(\)/);
    assert.match(callbackSource, /nextMusic\(\{ automatic: true, expectedUrl: state\.url \}\)/);
    assert.doesNotMatch(callbackSource, /!!state\.scheduledRunToken/);
  });

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

  test('refreshes an expired saved login after reload without redirecting or losing its refresh token', async () => {
    const env = browserEnvironment('https://poolside-pulse-x.vercel.app/#receiver');
    const otherVersions = seedOtherVersionStorage(env);
    const originalFetch = globalThis.fetch;
    const requests = [];
    env.localStorage.setItem(VX_TOKEN_KEY, JSON.stringify({
      access_token: 'expired-vx-access-token',
      refresh_token: 'saved-vx-refresh-token',
      expiresAt: Date.now() - 60_000
    }));
    globalThis.fetch = async (url, options = {}) => {
      const href = String(url);
      requests.push({
        href,
        method: options.method || 'GET',
        authorization: options.headers?.Authorization || '',
        body: String(options.body || '')
      });
      if (href === 'https://accounts.spotify.com/api/token') {
        return response(200, {
          access_token: 'refreshed-vx-access-token',
          expires_in: 3_600
        });
      }
      if (href === 'https://api.spotify.com/v1/me') {
        return response(200, { display_name: 'Reloaded Receiver', product: 'premium', id: 'account-x' });
      }
      if (href === 'https://api.spotify.com/v1/me/player/devices') return response(200, { devices: [] });
      throw new Error(`Unexpected Spotify request: ${href}`);
    };
    try {
      class FakePlayer {
        addListener() {}
      }

      // This fresh adapter instance represents a page reload. It must recover
      // from local storage instead of sending the receiver through OAuth again.
      const receiver = new SpotifyReceiver({ clientId: 'client-id' });
      receiver.ensureSdk = async () => ({ Player: FakePlayer });

      assert.equal(await receiver.preparePlayer(), true);
      assert.equal((await receiver.verifyAccess()).verified, true);

      const tokenRequest = requests.find(request => request.href === 'https://accounts.spotify.com/api/token');
      assert.ok(tokenRequest);
      assert.equal(tokenRequest.method, 'POST');
      assert.match(tokenRequest.body, /grant_type=refresh_token/);
      assert.match(tokenRequest.body, /refresh_token=saved-vx-refresh-token/);
      assert.equal(requests.filter(request => request.href === 'https://accounts.spotify.com/api/token').length, 1);
      assert.equal(
        requests.find(request => request.href === 'https://api.spotify.com/v1/me')?.authorization,
        'Bearer refreshed-vx-access-token'
      );

      const savedToken = JSON.parse(env.localStorage.getItem(VX_TOKEN_KEY));
      assert.equal(savedToken.access_token, 'refreshed-vx-access-token');
      assert.equal(savedToken.refresh_token, 'saved-vx-refresh-token');
      assert.ok(savedToken.expiresAt > Date.now());
      assert.equal(env.assigned, '');
      assert.equal(env.localStorage.getItem(VX_PKCE_KEY), null);
      assertOtherVersionStorageUnchanged(env, otherVersions);
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });
});

describe('Version X receiver-mode and setup UI hardening', () => {
  test('shows the exact Spotify developer values and keeps prior redirect instructions', () => {
    assert.match(VX_CORE_SOURCE, /export const DEFAULT_SPOTIFY_CLIENT_ID = '7e086716aaea4ce98051287b552a676c'/);
    assert.match(VX_APP_SOURCE, /const SPOTIFY_CLIENT_ID = DEFAULT_SPOTIFY_CLIENT_ID/);
    assert.equal(SPOTIFY_REDIRECT_URI, 'https://poolside-pulse-x.vercel.app/');
    assert.match(VX_APP_SOURCE, /import \{ SPOTIFY_REDIRECT_URI, SpotifyReceiver \} from '\.\/spotify-receiver\.js'/);
    assert.match(VX_APP_SOURCE, /const SPOTIFY_DEVELOPER_DASHBOARD_URL = 'https:\/\/developer\.spotify\.com\/dashboard'/);
    assert.match(VX_APP_SOURCE, /including the trailing slash/);
    assert.match(VX_APP_SOURCE, /Keep every prior Poolside Pulse redirect URI; do not replace or remove it/);
    assert.match(VX_APP_SOURCE, /data-action="copy-spotify-client-id"/);
    assert.match(VX_APP_SOURCE, /data-action="copy-spotify-redirect-uri"/);
  });

  test('separates saved account authorization from browser playback activation', () => {
    assert.match(VX_APP_SOURCE, /Apple account authorization saved/);
    assert.match(VX_APP_SOURCE, /Activate Apple Browser Playback/);
    assert.match(VX_APP_SOURCE, /Spotify account authorization saved/);
    assert.match(VX_APP_SOURCE, /Activate Spotify Browser Playback/);
    assert.match(VX_APP_SOURCE, /Account authorization persists separately from playback activation/);
  });

  test('shows verified Pushcut status without gating idle one-click commands and records mode transitions', () => {
    assert.match(VX_APP_SOURCE, /function pushcutAnnouncementOperational\(\)/);
    assert.match(VX_APP_SOURCE, /pushcutStatus\.operational === true/);
    assert.match(VX_APP_SOURCE, /pushcutStatus\.connectedReady === true/);
    assert.match(VX_APP_SOURCE, /const pushcutReady = pushcutAnnouncementReady\(\)/);
    assert.match(VX_APP_SOURCE, /Every command waits for its own signed completion receipt/);
    assert.match(VX_APP_SOURCE, /await selectSharedReceiverMode\('browser'\)/);
    assert.match(VX_APP_SOURCE, /await selectSharedReceiverMode\('pushcut'\)/);
    assert.match(VX_APP_SOURCE, /releaseToPushcut: true,[\s\S]*beacon: true/);
    assert.doesNotMatch(VX_APP_SOURCE, /pagehide[\s\S]{0,800}store\.releaseReceiverSession/);
  });

  test('saves mobile slider input after a debounce and flushes every release event', () => {
    assert.match(VX_APP_SOURCE, /function debounceMusicLevelSave/);
    assert.match(VX_APP_SOURCE, /debounceMusicLevelSave\(target\)/);
    assert.match(VX_APP_SOURCE, /function flushMusicLevelSave/);
    assert.match(VX_APP_SOURCE, /addEventListener\('change'[\s\S]*flushMusicLevelSave\(target\)/);
    assert.match(VX_APP_SOURCE, /addEventListener\('pointerup'[\s\S]*flushMusicLevelSave\(musicSlider\.value\)/);
    assert.match(VX_APP_SOURCE, /addEventListener\('touchend'[\s\S]*flushMusicLevelSave\(musicSlider\.value\)/);
  });

  test('keeps Browser-mode announcement and schedule controls disabled while its lease is offline', () => {
    const announceStart = VX_APP_SOURCE.indexOf('function renderAnnounce');
    const announceEnd = VX_APP_SOURCE.indexOf('function scheduleItemSource', announceStart);
    const announceSource = VX_APP_SOURCE.slice(announceStart, announceEnd);
    const scheduleStart = VX_APP_SOURCE.indexOf('function renderSchedule()');
    const scheduleEnd = VX_APP_SOURCE.indexOf('function renderActivity', scheduleStart);
    const scheduleSource = VX_APP_SOURCE.slice(scheduleStart, scheduleEnd);

    assert.match(announceSource, /const browserReady = operatingMode === 'browser' && receiverOnline/);
    assert.match(announceSource, /const announcementReady = browserReady \|\| pushcutSelectedReady/);
    assert.match(announceSource, /Browser Receiver is selected but offline/);
    assert.match(announceSource, /type="submit" class="primary" \$\{announcementReady \? '' : 'disabled'\}>Speak Now/);
    assert.match(announceSource, /data-action="saved-announcement"[\s\S]*announcementReady \? '' : 'disabled'/);
    assert.match(scheduleSource, /const browserReady = operatingMode === 'browser' && receiverOnline/);
    assert.match(scheduleSource, /Mixed and automatic Browser schedules are stopped/);
    assert.match(scheduleSource, /sequenceRun\.status !== 'complete' && browserReady/);
    assert.match(scheduleSource, /The selected receiver is offline; no scheduled item can run/);
  });
});
