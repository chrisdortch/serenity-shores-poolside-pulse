import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSessionToken } from '../api/_auth.js';
import ttsHandler from '../api/tts.js';
import { AudioEngine, estimateDeviceSpeechTimeoutMs } from '../src/vfinal/audio-engine.js';
import { SpotifyReceiver } from '../src/vfinal/spotify-receiver.js';

describe('Spotify volume truthfulness', () => {
  test('keeps device capability separate from exact volume verification', async () => {
    const statuses = [];
    const receiver = new SpotifyReceiver({ onStatus: status => statuses.push(status) });
    receiver.deviceId = 'receiver-a';
    receiver.ready = true;
    receiver.api = async () => ({
      devices: [{ id: 'receiver-a', is_restricted: false, supports_volume: true }]
    });

    const capability = await receiver.refreshCapabilities();
    assert.equal(capability.supportsVolume, true);
    assert.equal(capability.volumeVerified, false);
    assert.equal(receiver.supportsVolume, true);
    assert.equal(receiver.volumeVerified, false);

    let setValue = null;
    receiver.player = {
      async setVolume(value) { setValue = value; },
      async getVolume() { return 0.3; }
    };
    const verification = await receiver.enforceThirtyPercent();
    assert.equal(setValue, 0.3);
    assert.equal(verification.verified, true);
    assert.equal(receiver.supportsVolume, true);
    assert.equal(receiver.volumeVerified, true);
    assert.equal(statuses.at(-1).supportsVolume, true);
    assert.equal(statuses.at(-1).volumeVerified, true);
  });

  test('does not turn support into verification when the measured level differs', async () => {
    const receiver = new SpotifyReceiver();
    receiver.deviceId = 'receiver-a';
    receiver.ready = true;
    receiver.supportsVolume = true;
    receiver.player = {
      async setVolume() {},
      async getVolume() { return 0.31; }
    };

    const verification = await receiver.enforceThirtyPercent();
    assert.equal(verification.verified, false);
    assert.equal(verification.actual, 31);
    assert.equal(receiver.supportsVolume, true);
    assert.equal(receiver.volumeVerified, false);
  });

  test('resets exact verification on a capability error and disconnect', async () => {
    const receiver = new SpotifyReceiver();
    receiver.deviceId = 'receiver-a';
    receiver.ready = true;
    receiver.supportsVolume = true;
    receiver.volumeVerified = true;
    receiver.verifiedDeviceId = 'receiver-a';
    receiver.api = async () => { throw new Error('temporary failure'); };

    const capability = await receiver.refreshCapabilities();
    assert.equal(capability.supportsVolume, false);
    assert.equal(capability.volumeVerified, false);
    assert.equal(receiver.volumeVerified, false);

    receiver.volumeVerified = true;
    receiver.verifiedDeviceId = 'receiver-a';
    receiver.disconnect();
    assert.equal(receiver.supportsVolume, false);
    assert.equal(receiver.volumeVerified, false);
    assert.equal(receiver.deviceId, '');
  });

  test('treats unknown playback as potentially audible, confirms pause, and does not resume it', async () => {
    const receiver = new SpotifyReceiver();
    receiver.deviceId = 'receiver-a';
    receiver.current = null;
    let pauseCalls = 0;
    let resumeCalls = 0;
    receiver.playbackState = async () => { throw new Error('state temporarily unavailable'); };
    receiver.pause = async () => {
      pauseCalls += 1;
      return true;
    };
    receiver.resume = async () => {
      resumeCalls += 1;
      return true;
    };

    const snapshot = await receiver.pauseForAnnouncement();
    const resumed = await receiver.resumeAfterAnnouncement(snapshot);

    assert.equal(pauseCalls, 1, 'unknown playback must still be silenced before an announcement');
    assert.equal(snapshot.wasPlaying, false, 'an unknown prior state must not become a resume instruction');
    assert.equal(resumed, false);
    assert.equal(resumeCalls, 0);
  });

  test('rejects an announcement pause when unknown Spotify playback is not confirmed paused', async () => {
    const receiver = new SpotifyReceiver();
    receiver.deviceId = 'receiver-a';
    receiver.current = null;
    receiver.playbackState = async () => { throw new Error('state temporarily unavailable'); };
    receiver.pause = async () => false;

    await assert.rejects(receiver.pauseForAnnouncement(), /did not accept the required pause/i);
  });
});

describe('receiver media-element priming', { concurrency: false }, () => {
  test('does not treat the silent prime as a resumable music track', async () => {
    const engine = new AudioEngine();
    let playCalls = 0;
    engine.musicPrimeUrl = 'blob:poolside-silent-prime';
    engine.musicPrimed = true;
    engine.currentUrl = '';
    engine.musicElement = {
      src: engine.musicPrimeUrl,
      async play() { playCalls += 1; }
    };

    assert.equal(await engine.resumeMusic(), false);
    assert.equal(playCalls, 0, 'runtime must be allowed to rehydrate the persisted real track URL');
  });

  test('starts the silent media prime in the unlock call and suppresses prime playback callbacks', async () => {
    const originalDocument = globalThis.document;
    const originalAudioContext = globalThis.AudioContext;
    const originalCreateObjectURL = globalThis.URL.createObjectURL;
    const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
    const actions = [];
    const playbackEvents = [];

    const connectable = properties => ({
      ...properties,
      connect(target) { return target; },
      disconnect() {}
    });
    const audio = {
      src: '',
      paused: true,
      ended: false,
      currentTime: 0,
      duration: 0.1,
      readyState: 4,
      style: {},
      listeners: new Map(),
      setAttribute() {},
      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      },
      removeEventListener() {},
      dispatch(type) {
        for (const listener of this.listeners.get(type) || []) listener({ type });
      },
      load() {},
      play() {
        actions.push('media-play');
        this.paused = false;
        this.dispatch('playing');
        return Promise.resolve();
      },
      pause() {
        if (this.paused) return;
        actions.push('media-pause');
        this.paused = true;
        this.dispatch('pause');
      },
      remove() {}
    };

    class FakeAudioContext {
      constructor() {
        this.state = 'suspended';
        this.currentTime = 0;
        this.destination = {};
      }

      createGain() {
        return connectable({
          gain: {
            value: 1,
            cancelScheduledValues() {},
            setValueAtTime(value) { this.value = value; },
            linearRampToValueAtTime(value) { this.value = value; }
          }
        });
      }

      createAnalyser() { return connectable({ fftSize: 0, smoothingTimeConstant: 0 }); }

      createDynamicsCompressor() {
        return connectable({
          threshold: { value: 0 },
          knee: { value: 0 },
          ratio: { value: 0 },
          attack: { value: 0 },
          release: { value: 0 }
        });
      }

      createBiquadFilter() {
        return connectable({ type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 } });
      }

      createMediaElementSource() { return connectable({}); }

      resume() {
        actions.push('context-resume');
        this.state = 'running';
        return Promise.resolve();
      }
    }

    globalThis.document = {
      createElement(tag) {
        assert.equal(tag, 'audio');
        return audio;
      },
      body: { appendChild() {} }
    };
    globalThis.AudioContext = FakeAudioContext;
    globalThis.URL.createObjectURL = () => 'blob:poolside-silent-prime';
    globalThis.URL.revokeObjectURL = () => {};

    try {
      const engine = new AudioEngine({ onPlayback: event => playbackEvents.push(event) });
      const unlocking = engine.unlock();

      assert.deepEqual(actions.slice(0, 2), ['media-play', 'context-resume']);
      assert.deepEqual(playbackEvents, []);
      await unlocking;

      assert.equal(engine.musicPrimed, true);
      assert.deepEqual(actions, ['media-play', 'context-resume', 'media-pause']);
      assert.deepEqual(playbackEvents, [], 'silent priming must not look like user music playback');
    } finally {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      if (originalAudioContext === undefined) delete globalThis.AudioContext;
      else globalThis.AudioContext = originalAudioContext;
      globalThis.URL.createObjectURL = originalCreateObjectURL;
      globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});

describe('device speech completion watchdog', () => {
  test('uses bounded speech-time estimates', () => {
    assert.equal(estimateDeviceSpeechTimeoutMs('Hello.', 1), 7_000);
    const long = estimateDeviceSpeechTimeoutMs('word '.repeat(1_000), 0.7);
    assert.equal(long, 90_000);
  });

  test('cancels and rejects when speech starts but never completes', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalUtterance = globalThis.SpeechSynthesisUtterance;
    const originalSynthesis = globalThis.speechSynthesis;
    const timers = [];
    let cancelCount = 0;

    globalThis.setTimeout = (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    };
    globalThis.clearTimeout = timer => { if (timer) timer.cleared = true; };
    globalThis.SpeechSynthesisUtterance = class {
      constructor(text) { this.text = text; }
    };
    globalThis.speechSynthesis = {
      cancel() { cancelCount += 1; },
      speak(utterance) { utterance.onstart(); }
    };

    try {
      const pending = new AudioEngine().playDeviceSpeech('This announcement never ends.');
      const completion = timers.find(timer => timer.delay >= 7_000 && !timer.cleared);
      assert.ok(completion, 'completion watchdog should remain armed after onstart');
      completion.callback();
      await assert.rejects(pending, /did not complete/i);
      assert.equal(cancelCount, 2);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      if (originalUtterance === undefined) delete globalThis.SpeechSynthesisUtterance;
      else globalThis.SpeechSynthesisUtterance = originalUtterance;
      if (originalSynthesis === undefined) delete globalThis.speechSynthesis;
      else globalThis.speechSynthesis = originalSynthesis;
    }
  });
});

describe('server TTS timeout', () => {
  test('aborts a stalled provider call and returns a generic 504', async () => {
    const originalFetch = globalThis.fetch;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const originalSecret = process.env.POOL_SIDE_SESSION_SECRET;
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.POOL_SIDE_SESSION_SECRET = 'vfinal-audio-hardening-test-secret-long-enough';
    process.env.OPENAI_API_KEY = 'test-key';
    globalThis.setTimeout = callback => {
      queueMicrotask(callback);
      return 1;
    };
    globalThis.clearTimeout = () => {};
    globalThis.fetch = async (_url, { signal }) => {
      if (signal.aborted) {
        const error = new Error('provider detail must not escape');
        error.name = 'AbortError';
        throw error;
      }
      return await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('provider detail must not escape');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    };

    const req = {
      method: 'POST',
      url: '/api/tts',
      body: { text: 'test' },
      headers: {
        host: 'poolside.test',
        origin: 'https://poolside.test',
        cookie: `poolside_vfinal_session=${encodeURIComponent(createSessionToken())}`,
        'x-forwarded-host': 'poolside.test',
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '203.0.113.20',
        'sec-fetch-site': 'same-origin'
      },
      socket: { encrypted: true, remoteAddress: '203.0.113.20' }
    };
    let raw = '';
    const res = {
      statusCode: 200,
      setHeader() {},
      end(value = '') { raw += String(value); }
    };

    try {
      await ttsHandler(req, res);
      assert.equal(res.statusCode, 504);
      const body = JSON.parse(raw);
      assert.equal(body.error, 'Natural voice service timed out. Try again shortly.');
      assert.doesNotMatch(raw, /provider detail/i);
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
      if (originalSecret === undefined) delete process.env.POOL_SIDE_SESSION_SECRET;
      else process.env.POOL_SIDE_SESSION_SECRET = originalSecret;
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });
});
