import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { createDefaultState, makeReceiverLease } from '../src/vx/core.js';
import { ReceiverRuntime } from '../src/vx/receiver-runtime.js';

const NOW = 1_800_000_000_000;
const DEVICE_ID = 'vx-iphone-receiver';
const SESSION_ID = 'vx-iphone-session';

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
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {}
    }
  });
});

function harness() {
  const state = createDefaultState(NOW);
  state.receiver = makeReceiverLease({ deviceId: DEVICE_ID, sessionId: SESSION_ID }, NOW);
  state.playback = { ...state.playback, provider: 'controlled', intent: 'stopped' };
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
  const calls = [];
  const audioState = { unlocked: true, contextState: 'running', calibrationActive: false };
  const audio = {
    status: () => ({ ...audioState }),
    async unlock() { return true; },
    stopCalibration() { calls.push('stop-calibration'); },
    stopVoice() { calls.push('stop-voice'); },
    stopMusic() { calls.push('stop-music'); }
  };
  const apple = {
    ready: false,
    current: null,
    pauseImmediately() { calls.push('pause-apple-immediate'); return Promise.resolve(true); },
    async pauseForAnnouncement() { calls.push('pause-apple'); return { wasPlaying: false }; },
    disconnect() { calls.push('disconnect-apple'); }
  };
  const runtime = new ReceiverRuntime({ store, audio, apple });
  runtime.deviceId = DEVICE_ID;
  runtime.sessionId = SESSION_ID;
  runtime.sessionStartedAt = NOW;
  runtime.lastDurableHeartbeatAt = NOW;
  runtime.active = true;
  runtime.settleAudioOperations = async () => {};
  return { runtime, audio, audioState, calls };
}

describe('Version X iPhone receiver foreground safety', { concurrency: false }, () => {
  test('fails closed immediately when the receiver page leaves the foreground', async () => {
    const { runtime, calls } = harness();
    document.visibilityState = 'hidden';

    const stopping = runtime.onVisibilityChange();
    assert.equal(runtime.active, false, 'ownership must be invalidated before Safari can suspend');
    await stopping;

    assert.equal(calls.includes('stop-music'), true);
    assert.equal(calls.includes('stop-voice'), true);
    assert.equal(calls.includes('pause-apple-immediate'), true);
    assert.equal(calls.includes('disconnect-apple'), true);
    assert.equal(runtime.state.config.receiverMode, 'pushcut');
    assert.equal(runtime.state.receiver.status, 'offline');
    assert.equal(runtime.state.receiver.leaseUntil, 0);
  });

  test('requests a direct Apple pause before waiting for older audio work', async () => {
    const { runtime, calls } = harness();
    const settle = Promise.withResolvers();
    runtime.settleAudioOperations = () => settle.promise;
    document.visibilityState = 'hidden';

    const stopping = runtime.onVisibilityChange();

    assert.equal(calls.includes('pause-apple-immediate'), true);
    assert.equal(runtime.active, false);
    settle.resolve();
    await stopping;
  });

  test('coalesces re-entrant handoff stops and releases the browser session once', async () => {
    const { runtime, calls } = harness();
    let releases = 0;
    const settle = Promise.withResolvers();
    runtime.store.releaseReceiverSession = async () => {
      releases += 1;
      return { released: true };
    };
    runtime.settleAudioOperations = () => settle.promise;

    const first = runtime.failSafeStop('First stop.', { releaseToPushcut: true, beacon: true });
    const second = runtime.failSafeStop('Observer stop.', { releaseToPushcut: true, beacon: true });

    assert.equal(runtime.active, false);
    assert.equal(releases, 1);
    assert.equal(calls.filter(call => call === 'stop-music').length, 1);
    settle.resolve();
    await Promise.all([first, second]);
    assert.equal(releases, 1);
    assert.equal(calls.filter(call => call === 'disconnect-apple').length, 1);
  });

  test('does not renew or process work when iPhone audio cannot resume', async () => {
    const { runtime, audio } = harness();
    const work = [];
    audio.unlock = async () => { throw new Error('resume blocked'); };
    runtime.heartbeat = async () => work.push('heartbeat');
    runtime.processPendingEvents = async () => work.push('events');
    runtime.tickSchedule = async () => work.push('schedule');

    await runtime.onVisibilityChange();

    assert.equal(runtime.active, false);
    assert.deepEqual(work, []);
  });

  test('requires a running context before treating resumed iPhone audio as operational', async () => {
    const { runtime, audioState } = harness();
    const work = [];
    audioState.contextState = 'suspended';
    runtime.heartbeat = async () => work.push('heartbeat');
    runtime.processPendingEvents = async () => work.push('events');
    runtime.tickSchedule = async () => work.push('schedule');

    await runtime.onVisibilityChange();

    assert.equal(runtime.active, false);
    assert.deepEqual(work, []);
  });

  test('preserves desktop hidden-page behavior', async () => {
    const { runtime } = harness();
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }
    });
    document.visibilityState = 'hidden';

    await runtime.onVisibilityChange();

    assert.equal(runtime.active, true);
  });
});
