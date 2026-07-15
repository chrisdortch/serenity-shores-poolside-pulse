import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { AppleMusicReceiver } from '../src/vx/apple-music-receiver.js';
import { ReceiverRuntime } from '../src/vx/receiver-runtime.js';
import { createDefaultState } from '../src/vx/core.js';
import {
  nativeMusicRequest,
  nativePlaybackState
} from '../src/vx/native-music-bridge.js';

function installNativeBridge() {
  const calls = [];
  const state = {
    deviceId: 'music-app@receiver-mac',
    deviceName: 'macOS Music.app',
    volume: 30,
    verifiedPercent: 30,
    supportsVolume: true,
    volumeVerified: true,
    playerState: 'paused',
    isPlaying: false,
    position: 12,
    name: 'Pool Test',
    artists: 'Serenity Shores',
    persistentId: 'TRACK-1',
    sourceUrl: ''
  };
  const result = () => ({ ...state });
  const postMessage = payload => {
    calls.push(structuredClone(payload));
    switch (payload.method) {
      case 'capabilities':
      case 'activate':
      case 'state':
        return Promise.resolve({ ok: true, result: result() });
      case 'setVolume':
        state.volume = payload.params.percent;
        state.verifiedPercent = payload.params.percent;
        return Promise.resolve({ ok: true, result: result() });
      case 'play':
        state.sourceUrl = payload.params.url;
        state.volume = payload.params.volumePercent;
        state.verifiedPercent = payload.params.volumePercent;
        state.playerState = 'playing';
        state.isPlaying = true;
        return Promise.resolve({ ok: true, result: result() });
      case 'pause':
      case 'stop':
        state.playerState = 'paused';
        state.isPlaying = false;
        return Promise.resolve({ ok: true, result: result() });
      case 'pauseImmediate':
        state.volume = 0;
        state.verifiedPercent = 0;
        state.playerState = 'paused';
        state.isPlaying = false;
        return Promise.resolve({ ok: true, result: result() });
      case 'pauseForAnnouncement': {
        const before = { ...state };
        if (before.isPlaying) {
          state.volume = 0;
          state.verifiedPercent = 0;
          state.playerState = 'paused';
          state.isPlaying = false;
        }
        return Promise.resolve({
          ok: true,
          result: {
            ...result(),
            state: result(),
            wasPlaying: before.isPlaying,
            position: before.position,
            persistentId: before.persistentId,
            sourceUrl: before.sourceUrl,
            volumeLowered: before.isPlaying,
            previousVolume: before.volume
          }
        });
      }
      case 'resume':
      case 'resumeAfterAnnouncement':
      case 'next':
        state.volume = payload.params.volumePercent;
        state.verifiedPercent = payload.params.volumePercent;
        state.playerState = 'playing';
        state.isPlaying = true;
        return Promise.resolve({ ok: true, result: result() });
      case 'failSafePause':
        state.volume = 0;
        state.verifiedPercent = 0;
        state.playerState = 'paused';
        state.isPlaying = false;
        return Promise.resolve({ ok: true, result: result() });
      default:
        return Promise.resolve({ ok: false, error: `Unsupported ${payload.method}` });
    }
  };

  Object.defineProperty(globalThis, '__POOL_SIDE_NATIVE_MUSIC__', {
    configurable: true,
    value: { version: 1, platform: 'macos-music-app', deviceName: 'Poolside Pulse X Music Receiver' }
  });
  Object.defineProperty(globalThis, 'webkit', {
    configurable: true,
    value: { messageHandlers: { poolsideMusic: { postMessage } } }
  });
  return { calls, state, postMessage };
}

function installBrowser() {
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
    value: { userAgent: 'PoolsidePulseNativeMusicReceiver/1.0', platform: 'MacIntel', maxTouchPoints: 0 }
  });
}

async function connectedReceiver() {
  const receiver = new AppleMusicReceiver({ fetchImpl: async () => { throw new Error('MusicKit token must not be requested by the native receiver.'); } });
  await receiver.preparePlayer();
  await receiver.activateFromUserGesture();
  await receiver.connectFromUserGesture();
  return receiver;
}

beforeEach(() => {
  installBrowser();
});

afterEach(() => {
  for (const key of ['__POOL_SIDE_NATIVE_MUSIC__', 'webkit', 'localStorage', 'navigator', 'window', 'document']) {
    try { delete globalThis[key]; } catch {}
  }
});

describe('Version X native macOS Music.app bridge', { concurrency: false }, () => {
  test('plays at a manager target, reports milliseconds, pauses for voice, and restores the same target', async () => {
    const fake = installNativeBridge();
    const receiver = await connectedReceiver();
    receiver.setTargetVolumePercent(42);

    const played = await receiver.play('https://music.apple.com/us/album/example/123?i=456');
    assert.equal(played.volume.verified, true);
    assert.equal(fake.state.volume, 42);
    assert.equal((await receiver.playbackState()).position, 12_000);
    assert.equal(fake.calls.some(call => call.method === 'setVolume'), true);

    const snapshot = await receiver.pauseForAnnouncement();
    assert.equal(snapshot.wasPlaying, true);
    assert.equal(fake.state.isPlaying, false);
    assert.equal(fake.state.volume, 0);

    await receiver.resumeAfterAnnouncement(snapshot);
    assert.equal(fake.state.isPlaying, true);
    assert.equal(fake.state.volume, 42);
    assert.equal(receiver.volumeVerified, true);
  });

  test('does not mute Music.app when an announcement checks an already-paused player', async () => {
    const fake = installNativeBridge();
    fake.state.volume = 55;
    fake.state.verifiedPercent = 55;
    const receiver = await connectedReceiver();

    const snapshot = await receiver.pauseForAnnouncement();

    assert.equal(snapshot.wasPlaying, false);
    assert.equal(fake.state.volume, 55);
    assert.equal(fake.calls.some(call => call.method === 'setVolume'), false);
  });

  test('dispatches the lifecycle pause through WebKit before returning its promise', async () => {
    const fake = installNativeBridge();
    const receiver = await connectedReceiver();
    receiver.ready = true;
    receiver.deviceId = 'music-app@receiver-mac';

    const pausing = receiver.pauseImmediately();
    assert.equal(fake.calls.at(-1).method, 'pauseImmediate');
    assert.equal(await pausing, true);
    assert.equal(fake.state.volume, 0);
  });

  test('fails closed on missing native volume readback fields', () => {
    const parsed = nativePlaybackState({});
    assert.equal(parsed.supportsVolume, false);
    assert.equal(parsed.volumeVerified, false);
    assert.equal(parsed.volume, null);
    assert.equal(parsed.verifiedPercent, null);
    assert.equal(parsed.playbackStateVerified, false);
    assert.equal(parsed.isPlaying, true);
  });

  test('queues a fail-safe native pause after an ambiguous mutating timeout', async () => {
    const calls = [];
    installNativeBridge();
    globalThis.webkit.messageHandlers.poolsideMusic.postMessage = payload => {
      calls.push(payload);
      if (payload.method === 'play') return new Promise(() => {});
      return new Promise(resolve => setTimeout(() => resolve({
          ok: true,
          result: {
            playerState: 'paused', isPlaying: false,
            volume: 0, verifiedPercent: 0,
            supportsVolume: true, volumeVerified: true
          }
        }), 12));
    };

    const startedAt = Date.now();
    await assert.rejects(
      nativeMusicRequest('play', { url: 'https://music.apple.com/us/album/example/1', volumePercent: 30 }, { timeoutMs: 5 }),
      /timed out/i
    );
    assert.equal(Date.now() - startedAt >= 12, true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls.map(call => call.method), ['play', 'failSafePause']);
  });

  test('rejects a malformed pause response instead of treating missing state as silence', async () => {
    const fake = installNativeBridge();
    const original = fake.postMessage;
    globalThis.webkit.messageHandlers.poolsideMusic.postMessage = payload => payload.method === 'pauseForAnnouncement'
      ? Promise.resolve({ ok: true, result: {} })
      : original(payload);
    const receiver = await connectedReceiver();

    await assert.rejects(receiver.pauseForAnnouncement(), /explicitly confirmed paused/i);
  });

  test('does not claim a receiver when native start silence cannot be confirmed', async () => {
    let unlocked = false;
    let mutated = false;
    const state = createDefaultState(1_000);
    const runtime = new ReceiverRuntime({
      store: {
        state,
        now: () => 1_000,
        durableReady: () => true,
        async mutate() { mutated = true; }
      },
      audio: {
        async unlock() { unlocked = true; },
        status: () => ({ unlocked: false })
      },
      apple: {
        nativeEnabled: () => true,
        async prepareForReceiverStart() { throw new Error('Music.app silence denied'); }
      }
    });

    await assert.rejects(runtime.start(), /silence denied/i);
    assert.equal(unlocked, false);
    assert.equal(mutated, false);
    assert.equal(state.receiver, null);
  });

  test('native receiver start silences a manually playing Music.app before setup can continue', async () => {
    const fake = installNativeBridge();
    fake.state.playerState = 'playing';
    fake.state.isPlaying = true;
    fake.state.volume = 63;
    fake.state.verifiedPercent = 63;
    const receiver = new AppleMusicReceiver();

    await receiver.prepareForReceiverStart();

    assert.equal(fake.calls[0].method, 'failSafePause');
    assert.equal(fake.state.isPlaying, false);
    assert.equal(fake.state.volume, 0);
    assert.equal(receiver.playerPrepared, true);
    assert.equal(receiver.accessVerified, true);
  });

  test('silences Music.app before disconnecting the native receiver', async () => {
    const fake = installNativeBridge();
    const receiver = await connectedReceiver();
    fake.state.playerState = 'playing';
    fake.state.isPlaying = true;
    fake.state.volume = 63;
    fake.state.verifiedPercent = 63;

    await receiver.clearLogin();

    assert.equal(fake.calls.at(-1).method, 'failSafePause');
    assert.equal(fake.state.isPlaying, false);
    assert.equal(fake.state.volume, 0);
    assert.equal(receiver.ready, false);
  });
});
