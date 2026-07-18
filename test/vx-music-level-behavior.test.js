import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { AudioEngine } from '../src/vx/audio-engine.js';
import { createDefaultState, makeReceiverLease } from '../src/vx/core.js';
import { ReceiverRuntime } from '../src/vx/receiver-runtime.js';

const NOW = 1_800_000_000_000;
const DEVICE_ID = 'vx-gain-receiver';
const SESSION_ID = 'vx-gain-session';

beforeEach(() => {
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
    value: { userAgent: 'Mozilla/5.0 (iPhone)', platform: 'iPhone', maxTouchPoints: 5 }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener() {},
      removeEventListener() {}
    }
  });
});

test('a remote Suno level command persists 47% and moves the live mixer bus to 0.47', async () => {
  const state = createDefaultState(NOW);
  state.receiver = makeReceiverLease({ deviceId: DEVICE_ID, sessionId: SESSION_ID }, NOW);
  state.playback = {
    ...state.playback,
    provider: 'controlled',
    intent: 'playing',
    volumeMode: 'global',
    musicLevelPercent: 30
  };
  const store = {
    state,
    now: () => NOW,
    async mutate(mutator) {
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      this.state = result && typeof result === 'object' ? result : draft;
      return this.state;
    }
  };
  const busTargets = [];
  const audio = new AudioEngine();
  audio.musicBus = {};
  audio.setMusicBus = (level, rampMs) => busTargets.push({ level, rampMs });
  const external = {
    ready: false,
    current: null,
    supportsVolume: false,
    volumeVerified: false,
    verifiedPercent: null,
    setTargetVolumePercent() {},
    readiness: () => ({ status: 'login-required', ready: false, detail: 'Not active.' })
  };
  const runtime = new ReceiverRuntime({
    store,
    audio,
    apple: { ...external },
    spotify: { ...external }
  });
  runtime.deviceId = DEVICE_ID;
  runtime.sessionId = SESSION_ID;
  runtime.sessionStartedAt = NOW;
  runtime.active = true;

  assert.equal(await runtime.setMusicLevel(47), 47);
  assert.equal(store.state.config.musicLevel, 47);
  assert.equal(store.state.playback.musicLevelPercent, 47);
  assert.equal(audio.status().musicLevelPercent, 47);
  assert.deepEqual(busTargets.at(-1), { level: 0.47, rampMs: 140 });
  runtime.stopLoops();
});
