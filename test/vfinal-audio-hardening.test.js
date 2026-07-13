import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSessionToken } from '../api/_auth.js';
import ttsHandler from '../api/tts.js';
import { AudioEngine, estimateDeviceSpeechTimeoutMs } from '../src/v30/audio-engine.js';
import { DUCK_LEVEL_PERCENT } from '../src/v30/core.js';
import { SpotifyReceiver } from '../src/v30/spotify-receiver.js';

function installControlledAudioHarness({ signal = 0.24 } = {}) {
  const originalDocument = globalThis.document;
  const originalAudioContext = globalThis.AudioContext;
  const originalWebkitAudioContext = globalThis.webkitAudioContext;
  const state = { signal, playCalls: 0 };

  const amplitudeAt = (node, visited = new Set()) => {
    if (!node || visited.has(node)) return 0;
    visited.add(node);
    if (node.kind === 'media-source') return state.signal;
    const upstream = amplitudeAt(node.upstream, visited);
    return node.kind === 'gain' ? upstream * Number(node.gain.value || 0) : upstream;
  };
  const connectable = (kind, properties = {}) => ({
    kind,
    connections: [],
    ...properties,
    connect(target) {
      this.connections.push(target);
      target.upstream = this;
      return target;
    },
    disconnect() {}
  });
  const audio = {
    src: '',
    paused: true,
    ended: false,
    currentTime: 0,
    duration: 180,
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
    load() { this.ended = false; },
    play() {
      state.playCalls += 1;
      this.paused = false;
      this.ended = false;
      this.dispatch('playing');
      return Promise.resolve();
    },
    pause() {
      if (this.paused) return;
      this.paused = true;
      this.dispatch('pause');
    }
  };

  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = connectable('destination');
    }

    createGain() {
      return connectable('gain', {
        gain: {
          value: 1,
          cancelScheduledValues() {},
          setValueAtTime(value) { this.value = value; },
          linearRampToValueAtTime(value) { this.value = value; }
        }
      });
    }

    createAnalyser() {
      const analyser = connectable('analyser', {
        fftSize: 0,
        smoothingTimeConstant: 0,
        getFloatTimeDomainData(samples) {
          samples.fill(amplitudeAt(analyser));
        }
      });
      return analyser;
    }

    createDynamicsCompressor() {
      return connectable('compressor', {
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 }
      });
    }

    createBiquadFilter() {
      return connectable('filter', { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 } });
    }

    createMediaElementSource() { return connectable('media-source'); }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }

  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'audio');
      return audio;
    },
    body: { appendChild() {} }
  };
  globalThis.AudioContext = FakeAudioContext;
  delete globalThis.webkitAudioContext;

  return {
    audio,
    state,
    setSignal(value) { state.signal = value; },
    restore() {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
      if (originalAudioContext === undefined) delete globalThis.AudioContext;
      else globalThis.AudioContext = originalAudioContext;
      if (originalWebkitAudioContext === undefined) delete globalThis.webkitAudioContext;
      else globalThis.webkitAudioContext = originalWebkitAudioContext;
    }
  };
}

describe('Spotify volume truthfulness', () => {
  test('keeps device capability separate from exact verification at a non-30 target', async () => {
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
      async getVolume() { return 0.42; }
    };
    receiver.setTargetVolumePercent(42);
    const verification = await receiver.enforceVolume(42);
    assert.equal(setValue, 0.42);
    assert.equal(verification.verified, true);
    assert.equal(verification.verifiedPercent, 42);
    assert.equal(receiver.supportsVolume, true);
    assert.equal(receiver.targetVolumePercent, 42);
    assert.equal(receiver.volumeVerified, true);
    assert.equal(receiver.verifiedPercent, 42);
    assert.equal(statuses.at(-1).supportsVolume, true);
    assert.equal(statuses.at(-1).targetVolumePercent, 42);
    assert.equal(statuses.at(-1).volumeVerified, true);
    assert.equal(statuses.at(-1).verifiedPercent, 42);
  });

  test('does not verify a non-30 target when the measured level differs', async () => {
    const receiver = new SpotifyReceiver();
    receiver.deviceId = 'receiver-a';
    receiver.ready = true;
    receiver.supportsVolume = true;
    receiver.player = {
      async setVolume() {},
      async getVolume() { return 0.66; }
    };

    receiver.setTargetVolumePercent(67);
    const verification = await receiver.enforceVolume(67);
    assert.equal(verification.verified, false);
    assert.equal(verification.actual, 66);
    assert.equal(verification.verifiedPercent, null);
    assert.equal(receiver.targetVolumePercent, 67);
    assert.equal(receiver.supportsVolume, true);
    assert.equal(receiver.volumeVerified, false);
    assert.equal(receiver.verifiedPercent, null);
  });

  test('resets target-bound verification on target change, capability error, and disconnect', async () => {
    const receiver = new SpotifyReceiver();
    receiver.deviceId = 'receiver-a';
    receiver.ready = true;
    receiver.supportsVolume = true;
    receiver.setTargetVolumePercent(42);
    receiver.volumeVerified = true;
    receiver.verifiedPercent = 42;
    receiver.verifiedDeviceId = 'receiver-a';

    receiver.setTargetVolumePercent(55);
    assert.equal(receiver.targetVolumePercent, 55);
    assert.equal(receiver.volumeVerified, false);
    assert.equal(receiver.verifiedPercent, null);
    assert.equal(receiver.verifiedDeviceId, '');

    receiver.volumeVerified = true;
    receiver.verifiedPercent = 55;
    receiver.verifiedDeviceId = 'receiver-a';
    receiver.api = async () => { throw new Error('temporary failure'); };

    const capability = await receiver.refreshCapabilities();
    assert.equal(capability.supportsVolume, false);
    assert.equal(capability.volumeVerified, false);
    assert.equal(capability.verifiedPercent, null);
    assert.equal(receiver.volumeVerified, false);
    assert.equal(receiver.verifiedPercent, null);

    receiver.volumeVerified = true;
    receiver.verifiedPercent = 55;
    receiver.verifiedDeviceId = 'receiver-a';
    receiver.disconnect();
    assert.equal(receiver.supportsVolume, false);
    assert.equal(receiver.volumeVerified, false);
    assert.equal(receiver.verifiedPercent, null);
    assert.equal(receiver.deviceId, '');
  });

  test('serializes target changes so an older volume operation cannot finish last', async () => {
    const firstSet = Promise.withResolvers();
    const firstStarted = Promise.withResolvers();
    const calls = [];
    let actual = 0.3;
    const receiver = new SpotifyReceiver();
    receiver.deviceId = 'receiver-a';
    receiver.ready = true;
    receiver.supportsVolume = true;
    receiver.player = {
      async setVolume(value) {
        calls.push(value);
        if (calls.length === 1) {
          firstStarted.resolve();
          await firstSet.promise;
        }
        actual = value;
      },
      async getVolume() { return actual; }
    };

    receiver.setTargetVolumePercent(42);
    const older = receiver.enforceVolume(42);
    await firstStarted.promise;
    receiver.setTargetVolumePercent(55);
    const newer = receiver.enforceVolume(55);
    firstSet.resolve();

    const [oldResult, newResult] = await Promise.all([older, newer]);
    assert.equal(oldResult.stale, true);
    assert.equal(newResult.verified, true);
    assert.equal(newResult.verifiedPercent, 55);
    assert.deepEqual(calls, [0.42, 0.55]);
    assert.equal(actual, 0.55);
    assert.equal(receiver.targetVolumePercent, 55);
    assert.equal(receiver.verifiedPercent, 55);
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

describe('controlled music source-signal verification', { concurrency: false }, () => {
  test('plays and resumes at a 0% target when nonzero PCM is present before the music gain', async () => {
    const harness = installControlledAudioHarness({ signal: 0.24 });
    try {
      const engine = new AudioEngine();
      engine.unlocked = true;
      engine.setMusicLevelPercent(0, { report: false });
      const verifyMusicSignal = engine.verifyMusicSignal.bind(engine);
      engine.verifyMusicSignal = () => verifyMusicSignal(10);

      assert.equal(await engine.playMusicUrl('https://audio.example/zero-target.mp3', { label: 'Zero target' }), true);
      assert.equal(engine.musicBus.gain.value, 0, 'the destination-facing music gain remains fully silent');
      assert.equal(engine.musicElementSource.connections[0], engine.musicAnalyser, 'source PCM reaches the verifier before volume is applied');
      assert.equal(engine.musicAnalyser.connections[0], engine.musicBus);

      engine.pauseMusic();
      assert.equal(await engine.resumeMusic(), true, 'a valid zero-volume track can resume without a false no-signal failure');
      assert.equal(harness.state.playCalls, 2);
      assert.equal(engine.musicBus.gain.value, 0);
    } finally {
      harness.restore();
    }
  });

  test('still rejects a truly silent source at a 0% target', async () => {
    const harness = installControlledAudioHarness({ signal: 0 });
    try {
      const engine = new AudioEngine();
      engine.unlocked = true;
      engine.setMusicLevelPercent(0, { report: false });
      const verifyMusicSignal = engine.verifyMusicSignal.bind(engine);
      engine.verifyMusicSignal = () => verifyMusicSignal(10);

      await assert.rejects(
        engine.playMusicUrl('https://audio.example/silent.mp3', { label: 'Silent source' }),
        /no audio entered the calibrated mixer/i
      );
      assert.equal(harness.audio.paused, true, 'failed verification pauses the silent source');
      assert.equal(engine.musicBus.gain.value, 0);
    } finally {
      harness.restore();
    }
  });

  test('keeps ordinary 30% controlled playback on the same gain and limiter path', async () => {
    const harness = installControlledAudioHarness({ signal: 0.24 });
    try {
      const engine = new AudioEngine();
      engine.unlocked = true;
      const verifyMusicSignal = engine.verifyMusicSignal.bind(engine);
      engine.verifyMusicSignal = () => verifyMusicSignal(10);

      assert.equal(await engine.playMusicUrl('https://audio.example/thirty.mp3', { label: 'Thirty percent' }), true);
      assert.equal(engine.status().musicLevelPercent, 30);
      assert.equal(engine.musicBus.gain.value, 0.3);
      assert.equal(engine.musicElementSource.connections[0], engine.musicAnalyser);
      assert.equal(engine.musicAnalyser.connections[0], engine.musicBus);
      assert.equal(engine.musicBus.connections[0].kind, 'compressor', 'the audible output remains limited after its 30% gain');
    } finally {
      harness.restore();
    }
  });
});

describe('adjustable controlled-audio mixer', () => {
  test('applies a live non-30 target and follows the zero-duck core policy while an announcement is active', () => {
    const engine = new AudioEngine();
    const ramps = [];
    engine.musicBus = {};
    engine.setMusicBus = (level, rampMs) => ramps.push({ level, rampMs });

    assert.equal(DUCK_LEVEL_PERCENT, 0, 'the shared mixer policy must fully silence music under speech');
    assert.equal(engine.setMusicLevelPercent(42, { report: false }), 42);
    assert.equal(engine.status().musicLevelPercent, 42);
    assert.equal(engine.status().duckLevelPercent, DUCK_LEVEL_PERCENT);
    assert.deepEqual(ramps.at(-1), { level: 0.42, rampMs: 140 });

    engine.announcementDepth = 1;
    assert.equal(engine.setMusicLevelPercent(4, { rampMs: 25, report: false }), 4);
    assert.equal(engine.status().duckLevelPercent, DUCK_LEVEL_PERCENT);
    assert.deepEqual(ramps.at(-1), { level: DUCK_LEVEL_PERCENT / 100, rampMs: 25 });

    assert.equal(engine.setMusicLevelPercent(140, { report: false }), 100);
    assert.equal(engine.status().musicLevelPercent, 100);
    assert.deepEqual(ramps.at(-1), { level: DUCK_LEVEL_PERCENT / 100, rampMs: 140 }, 'an active announcement keeps the bus silent even when the target rises');
  });

  test('ramps the controlled music bus all the way to the shared duck target before speech', async () => {
    const engine = new AudioEngine();
    const ramps = [];
    engine.musicBus = {};
    engine.setMusicBus = (level, rampMs) => ramps.push({ level, rampMs });

    await engine.beginAnnouncement();

    assert.deepEqual(ramps, [{ level: DUCK_LEVEL_PERCENT / 100, rampMs: 320 }]);
    assert.equal(engine.announcementDepth, 1);
    await engine.endAnnouncement({ restore: false });
  });

  test('holds an interrupted gain ramp at its instantaneous value before scheduling the new target', () => {
    const calls = [];
    const gain = {
      value: 0.8,
      cancelScheduledValues(time) { calls.push(['cancel', time]); },
      setValueAtTime(value, time) { calls.push(['set', value, time]); },
      linearRampToValueAtTime(value, time) { calls.push(['ramp', value, time]); }
    };
    const engine = new AudioEngine();
    engine.context = { currentTime: 5 };
    engine.musicBus = { gain };
    engine.musicRamp = { startValue: 0.2, targetValue: 0.8, startTime: 0, endTime: 10 };

    engine.setMusicBus(0.1, 200);

    assert.deepEqual(calls, [
      ['cancel', 5],
      ['set', 0.5, 5],
      ['ramp', 0.1, 5.2]
    ]);
  });

  test('uses native cancel-and-hold when the browser provides it', () => {
    const calls = [];
    const gain = {
      value: 0.8,
      cancelAndHoldAtTime(time) { calls.push(['hold', time]); },
      cancelScheduledValues(time) { calls.push(['cancel', time]); },
      setValueAtTime(value, time) { calls.push(['set', value, time]); },
      linearRampToValueAtTime(value, time) { calls.push(['ramp', value, time]); }
    };
    const engine = new AudioEngine();
    engine.context = { currentTime: 5 };
    engine.musicBus = { gain };
    engine.musicRamp = { startValue: 0.2, targetValue: 0.8, startTime: 0, endTime: 10 };

    engine.setMusicBus(0.1, 200);

    assert.deepEqual(calls, [
      ['hold', 5],
      ['ramp', 0.1, 5.2]
    ]);
  });
});

describe('abortable calibration lifecycle', { concurrency: false }, () => {
  test('reports active state truthfully and stops the calibration bed immediately and idempotently', async () => {
    const engine = new AudioEngine();
    let bedStops = 0;
    engine.unlock = async () => true;
    engine.playBuiltInBed = () => {
      engine.builtInBed = {
        stop() {
          bedStops += 1;
          return bedStops === 1;
        }
      };
      engine.currentLabel = '30% calibration bed';
      engine.currentUrl = 'poolside://calibration-bed';
      return true;
    };

    const pending = engine.runCalibration({ speak: async () => true });
    for (let turn = 0; turn < 5 && !engine.builtInBed; turn += 1) await Promise.resolve();

    assert.equal(engine.status().calibrationActive, true);
    assert.ok(engine.builtInBed, 'calibration bed should be running before it is stopped');
    assert.equal(engine.stopCalibration(), true);
    assert.equal(engine.status().calibrationActive, false, 'status must turn off synchronously');
    assert.equal(engine.builtInBed, null, 'oscillators must be detached synchronously');
    assert.equal(engine.currentUrl, '', 'stopped calibration must not remain in Now Playing');
    assert.equal(engine.stopCalibration(), false, 'repeated stops are harmless no-ops');
    await assert.rejects(pending, /sound check stopped/i);
    assert.equal(bedStops, 1);
  });

  test('makes the calibration oscillator teardown repeat-safe', () => {
    let oscillatorStops = 0;
    const gainParam = {
      value: 0.3,
      cancelScheduledValues() {},
      setValueAtTime(value) { this.value = value; },
      linearRampToValueAtTime(value) { this.value = value; }
    };
    const connectable = extra => ({
      ...extra,
      connect(target) { return target; },
      disconnect() {}
    });
    const context = {
      currentTime: 0,
      createGain() { return connectable({ gain: { ...gainParam } }); },
      createOscillator() {
        return connectable({
          type: 'sine',
          frequency: { value: 0 },
          start() {},
          stop() { oscillatorStops += 1; }
        });
      }
    };
    const engine = new AudioEngine();
    engine.unlocked = true;
    engine.context = context;
    engine.musicBus = connectable({ gain: gainParam });

    engine.playBuiltInBed();
    const playback = engine.builtInBed;
    assert.equal(engine.stopBuiltInBed(), true);
    assert.equal(engine.stopBuiltInBed(), false);
    assert.equal(playback.stop(), false);
    assert.equal(oscillatorStops, 4, 'each oscillator is stopped exactly once');
  });

  test('hard-stops a sound check whose speech promise never settles', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timers = [];
    globalThis.setTimeout = (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    };
    globalThis.clearTimeout = timer => { if (timer) timer.cleared = true; };

    try {
      const engine = new AudioEngine();
      let bedStops = 0;
      let speechStarted = false;
      let speechSignal = null;
      engine.unlock = async () => true;
      engine.playBuiltInBed = () => {
        engine.builtInBed = { stop() { bedStops += 1; return true; } };
        return true;
      };
      engine.beginAnnouncement = async () => { engine.announcementDepth = 1; };
      const pending = engine.runCalibration({
        speak: (_message, { signal }) => {
          speechStarted = true;
          speechSignal = signal;
          return new Promise(() => {});
        }
      });

      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
      const leadIn = timers.find(timer => timer.delay === 1_100 && !timer.cleared);
      assert.ok(leadIn);
      leadIn.callback();
      for (let turn = 0; turn < 5 && !speechStarted; turn += 1) await Promise.resolve();
      assert.equal(speechStarted, true);

      const watchdog = timers.find(timer => timer.delay === 30_000 && !timer.cleared);
      assert.ok(watchdog, 'calibration must always have a hard watchdog');
      watchdog.callback();

      await assert.rejects(pending, /30-second safety limit/i);
      assert.equal(speechSignal?.aborted, true, 'the TTS callback receives the same cancellation signal');
      assert.equal(engine.status().calibrationActive, false);
      assert.equal(engine.announcementDepth, 0);
      assert.equal(engine.builtInBed, null);
      assert.equal(bedStops, 1);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
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
