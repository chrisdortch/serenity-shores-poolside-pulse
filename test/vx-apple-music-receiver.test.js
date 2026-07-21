import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import {
  APPLE_MUSIC_OVERLAP_DUCKING_ENABLED,
  APPLE_MUSIC_TOKEN_URL,
  AppleMusicReceiver
} from '../src/vx/apple-music-receiver.js';

function installBrowser({ ios = false } = {}) {
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => values.get(String(key)) ?? null,
      setItem: (key, value) => values.set(String(key), String(value)),
      removeItem: key => values.delete(String(key))
    }
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: ios
      ? { userAgent: 'Mozilla/5.0 (iPhone)', platform: 'iPhone', maxTouchPoints: 5 }
      : { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }
  });
  return values;
}

function fakeMusicKit() {
  const calls = [];
  const listeners = new Map();
  const music = {
    isAuthorized: false,
    authorizationStatus: 0,
    playbackState: 'paused',
    volume: 1,
    currentPlaybackTime: 12,
    currentPlaybackDuration: 180,
    nowPlayingItem: null,
    api: {
      async music(path) {
        calls.push(['api.music', path]);
        return { data: [{ id: 'us' }] };
      }
    },
    tapActive: false,
    addEventListener(event, handler) {
      const handlers = listeners.get(event) || new Set();
      handlers.add(handler);
      listeners.set(event, handlers);
    },
    removeEventListener(event, handler) { listeners.get(event)?.delete(handler); },
    emit(event, detail = {}) { for (const handler of listeners.get(event) || []) handler(detail); },
    async authorize() {
      calls.push(['authorize', this.tapActive]);
      this.isAuthorized = true;
      this.authorizationStatus = 3;
      return 'music-user-token-that-must-not-be-stored';
    },
    async unauthorize() {
      calls.push(['unauthorize']);
      this.isAuthorized = false;
      this.authorizationStatus = 0;
    },
    deferPlayback() {
      calls.push(['deferPlayback', this.tapActive]);
      return Promise.resolve();
    },
    async setQueue(options) {
      calls.push(['setQueue', options]);
      this.nowPlayingItem = {
        id: '123',
        attributes: { name: 'Test Track', artistName: 'Test Artist', url: options.url }
      };
    },
    async play() {
      calls.push(['play']);
      this.playbackState = 'playing';
    },
    async pause() {
      calls.push(['pause']);
      this.playbackState = 'paused';
    },
    async skipToNextItem() {
      calls.push(['skipToNextItem']);
      this.playbackState = 'playing';
    },
    async skipToPreviousItem() {
      calls.push(['skipToPreviousItem']);
      this.playbackState = 'playing';
    }
  };
  const kit = {
    Events: {},
    PlaybackStates: { playing: 'playing', paused: 'paused', stopped: 'stopped' },
    configure(config) {
      calls.push(['configure', config]);
      return music;
    },
    getInstance: () => music
  };
  return { kit, music, calls };
}

function tokenFetch(calls) {
  return async (url, options) => {
    calls.push(['fetch', url, options]);
    return new Response(JSON.stringify({
      ok: true,
      token: 'header.payload.signature',
      expiresAt: Date.now() + 15 * 60_000
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

beforeEach(() => {
  delete globalThis.MusicKit;
  delete globalThis.window;
});

describe('Version X MusicKit adapter', { concurrency: false }, () => {
  test('authorizes, connects, plays a URL, verifies desktop volume, and safely pauses/resumes', async () => {
    const storage = installBrowser();
    const { kit, music, calls } = fakeMusicKit();
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });

    await receiver.prepareAuthorization();
    assert.equal(calls.some(call => call[0] === 'authorize'), false);
    music.tapActive = true;
    const authorization = receiver.authorizeFromUserGesture();
    music.tapActive = false;
    assert.equal(calls.find(call => call[0] === 'authorize')?.[1], true);
    await authorization;
    music.tapActive = true;
    const activation = receiver.activateFromUserGesture();
    music.tapActive = false;
    assert.equal(calls.find(call => call[0] === 'deferPlayback')?.[1], true);
    await activation;
    await receiver.connectFromUserGesture();
    receiver.setTargetVolumePercent(42);
    const played = await receiver.play('https://music.apple.com/us/album/example/123?i=456');

    assert.equal(APPLE_MUSIC_OVERLAP_DUCKING_ENABLED, false);
    assert.equal(receiver.ready, true);
    assert.equal(receiver.supportsVolume, true);
    assert.equal(played.volume.verified, true);
    assert.equal(receiver.verifiedPercent, 42);
    assert.equal(music.volume, 0.42);
    assert.deepEqual(calls.find(call => call[0] === 'setQueue')?.[1], {
      url: 'https://music.apple.com/us/album/example/123?i=456'
    });

    const snapshot = await receiver.pauseForAnnouncement();
    assert.equal(snapshot.wasPlaying, true);
    assert.equal(music.playbackState, 'paused');
    await receiver.resumeAfterAnnouncement(snapshot);
    assert.equal(music.playbackState, 'playing');
    assert.equal(music.volume, 0.42);

    const fetchCall = calls.find(call => call[0] === 'fetch');
    assert.equal(fetchCall[1], APPLE_MUSIC_TOKEN_URL);
    assert.equal(fetchCall[2].credentials, 'same-origin');
    assert.deepEqual([...storage.keys()], ['poolside-pulse-vx-apple-music-authorized-hint']);
    assert.equal([...storage.values()].some(value => value.includes('music-user-token')), false);
  });

  test('never claims exact Apple Music volume on an iPhone receiver', async () => {
    installBrowser({ ios: true });
    const { kit, calls } = fakeMusicKit();
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });

    await receiver.prepareAuthorization();
    await receiver.authorizeFromUserGesture();
    await receiver.activateFromUserGesture();
    await receiver.connectFromUserGesture();
    receiver.setTargetVolumePercent(35);
    const result = await receiver.enforceVolume(35);

    assert.equal(receiver.supportsVolume, false);
    assert.equal(receiver.volumeVerified, false);
    assert.equal(result.verified, false);
    assert.match(result.reason, /cannot verify/i);
  });

  test('restores a persisted MusicKit authorization after reload before the local Connect tap', async () => {
    const storage = installBrowser();
    storage.set('poolside-pulse-vx-apple-music-authorized-hint', '1');
    const { kit, music, calls } = fakeMusicKit();
    music.isAuthorized = true;
    music.authorizationStatus = 3;
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });

    assert.equal(receiver.loggedIn(), true);
    assert.equal(receiver.playerPrepared, false);
    assert.equal(await receiver.restoreAuthorization(), true);
    assert.equal(receiver.playerPrepared, true);

    await receiver.activateFromUserGesture();
    await receiver.connectFromUserGesture();
    assert.equal(receiver.ready, true);
    assert.equal(calls.some(call => call[0] === 'deferPlayback'), true);

    await receiver.authorizeFromUserGesture();
    assert.equal(calls.some(call => call[0] === 'authorize'), false);
    assert.equal(storage.get('poolside-pulse-vx-apple-music-authorized-hint'), '1');
  });

  test('does not let a stale persisted hint suppress a user-gesture reauthorization', async () => {
    const storage = installBrowser();
    storage.set('poolside-pulse-vx-apple-music-authorized-hint', '1');
    const { kit, music, calls } = fakeMusicKit();
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });

    await receiver.prepareAuthorization();
    music.tapActive = true;
    const authorization = receiver.authorizeFromUserGesture();
    music.tapActive = false;

    assert.equal(calls.filter(call => call[0] === 'authorize').length, 1);
    assert.equal(calls.find(call => call[0] === 'authorize')?.[1], true);
    await authorization;
    assert.equal(receiver.loggedIn(), true);
    assert.equal(storage.get('poolside-pulse-vx-apple-music-authorized-hint'), '1');
  });

  test('clears a stale persisted hint when MusicKit definitively reports no authorization', async () => {
    const storage = installBrowser();
    storage.set('poolside-pulse-vx-apple-music-authorized-hint', '1');
    const { kit, calls } = fakeMusicKit();
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });

    await assert.rejects(receiver.restoreAuthorization(), /not authorized/i);

    assert.equal(storage.has('poolside-pulse-vx-apple-music-authorized-hint'), false);
    assert.equal(receiver.authorizedThisSession, false);
    assert.equal(receiver.authorizationInvalidated, true);
    assert.equal(receiver.loggedIn(), false);
  });

  test('requires a new authorize tap after a definitive account-verification rejection', async () => {
    const storage = installBrowser();
    const { kit, music, calls } = fakeMusicKit();
    music.api.music = async path => {
      calls.push(['api.music', path]);
      throw Object.assign(new Error('Music user token unauthorized'), { status: 401 });
    };
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });

    await receiver.prepareAuthorization();
    await assert.rejects(receiver.authorizeFromUserGesture(), /could not be verified/i);

    assert.equal(storage.has('poolside-pulse-vx-apple-music-authorized-hint'), false);
    assert.equal(receiver.authorizedThisSession, false);
    assert.equal(receiver.authorizationInvalidated, true);
    assert.equal(receiver.loggedIn(), false);

    music.api.music = async path => {
      calls.push(['api.music', path]);
      return { data: [{ id: 'us' }] };
    };
    await receiver.authorizeFromUserGesture();

    assert.equal(calls.filter(call => call[0] === 'authorize').length, 2);
    assert.equal(receiver.authorizationInvalidated, false);
    assert.equal(receiver.loggedIn(), true);
    assert.equal(storage.get('poolside-pulse-vx-apple-music-authorized-hint'), '1');
  });

  test('keeps a valid restored authorization through a transient verification failure', async () => {
    const storage = installBrowser();
    storage.set('poolside-pulse-vx-apple-music-authorized-hint', '1');
    const { kit, music, calls } = fakeMusicKit();
    music.isAuthorized = true;
    music.authorizationStatus = 3;
    music.api.music = async path => {
      calls.push(['api.music', path]);
      throw new Error('temporary network interruption');
    };
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });

    await assert.rejects(receiver.restoreAuthorization(), /temporary network interruption/i);
    assert.equal(receiver.authorizationInvalidated, false);
    assert.equal(receiver.loggedIn(), true);
    assert.equal(storage.get('poolside-pulse-vx-apple-music-authorized-hint'), '1');

    music.api.music = async path => {
      calls.push(['api.music', path]);
      return { data: [{ id: 'us' }] };
    };
    assert.equal(await receiver.restoreAuthorization(), true);
    assert.equal(calls.some(call => call[0] === 'authorize'), false);
  });

  test('blocks speech safety if a playing Apple receiver cannot confirm pause', async () => {
    installBrowser();
    const { kit, music, calls } = fakeMusicKit();
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });
    await receiver.prepareAuthorization();
    await receiver.authorizeFromUserGesture();
    await receiver.activateFromUserGesture();
    await receiver.connectFromUserGesture();
    music.playbackState = 'playing';
    music.pause = async () => { throw new Error('pause transport failed'); };

    await assert.rejects(receiver.pauseForAnnouncement(), /pause transport failed/i);
    assert.equal(music.playbackState, 'playing');
  });

  test('skips to the previous MusicKit item and preserves playing state', async () => {
    installBrowser();
    const { kit, music, calls } = fakeMusicKit();
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });
    await receiver.prepareAuthorization();
    await receiver.authorizeFromUserGesture();
    await receiver.activateFromUserGesture();
    await receiver.connectFromUserGesture();
    music.playbackState = 'playing';

    const state = await receiver.previous();

    assert.equal(calls.some(call => call[0] === 'skipToPreviousItem'), true);
    assert.equal(state.isPlaying, true);
    assert.equal(music.playbackState, 'playing');
  });

  test('fails closed when MusicKit v3 deferPlayback is unavailable', async () => {
    installBrowser({ ios: true });
    const { kit, music, calls } = fakeMusicKit();
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });
    await receiver.prepareAuthorization();
    await receiver.authorizeFromUserGesture();
    delete music.deferPlayback;

    assert.throws(() => receiver.activateFromUserGesture(), /deferPlayback is unavailable/i);
    assert.equal(receiver.activationState, 'failed');
    assert.equal(receiver.ready, false);
    await assert.rejects(receiver.connectFromUserGesture(), /fresh tap/i);
  });

  test('playbackError revokes readiness until a fresh Connect tap calls deferPlayback again', async () => {
    installBrowser({ ios: true });
    const { kit, music, calls } = fakeMusicKit();
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });
    await receiver.prepareAuthorization();
    await receiver.authorizeFromUserGesture();
    await receiver.activateFromUserGesture();
    await receiver.connectFromUserGesture();
    assert.equal(receiver.ready, true);

    music.emit('playbackError', { error: new Error('decoder failed') });
    assert.equal(receiver.ready, false);
    assert.equal(receiver.activationState, 'failed');
    await assert.rejects(receiver.connectFromUserGesture(), /fresh tap/i);

    await receiver.activateFromUserGesture();
    await receiver.connectFromUserGesture();
    assert.equal(receiver.ready, true);
    assert.equal(calls.filter(call => call[0] === 'deferPlayback').length, 2);
  });

  test('playback confirmation failure revokes readiness and requires a fresh Connect tap', async () => {
    installBrowser({ ios: true });
    const { kit, music, calls } = fakeMusicKit();
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });
    await receiver.prepareAuthorization();
    await receiver.authorizeFromUserGesture();
    await receiver.activateFromUserGesture();
    await receiver.connectFromUserGesture();
    music.playbackState = 'paused';

    await assert.rejects(receiver.waitForPlayback(true, 1), /did not confirm.*playing/i);
    assert.equal(receiver.ready, false);
    assert.equal(receiver.activationState, 'failed');
    await assert.rejects(receiver.connectFromUserGesture(), /fresh tap/i);
  });

  test('invokes a direct lifecycle pause before its promise settles', async () => {
    installBrowser({ ios: true });
    const { kit, music, calls } = fakeMusicKit();
    const receiver = new AppleMusicReceiver({ musicKit: kit, fetchImpl: tokenFetch(calls) });
    await receiver.prepareAuthorization();
    music.playbackState = 'playing';

    const pausing = receiver.pauseImmediately();

    assert.equal(calls.at(-1)?.[0], 'pause');
    assert.equal(receiver.current?.paused, true);
    assert.equal(await pausing, true);
  });
});
