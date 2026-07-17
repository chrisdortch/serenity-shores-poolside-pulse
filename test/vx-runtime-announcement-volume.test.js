import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { createDefaultState, makeReceiverLease } from '../src/vx/core.js';
import { ReceiverRuntime } from '../src/vx/receiver-runtime.js';

const NOW = 1_800_000_000_000;
const DEVICE_ID = 'vx-receiver';
const SESSION_ID = 'vx-session';

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
    value: { userAgent: 'Version X desktop test', platform: 'MacIntel', maxTouchPoints: 0 }
  });
});

function harness({ voiceLevel = 37 } = {}) {
  const state = createDefaultState(NOW);
  state.config.voiceLevel = voiceLevel;
  state.receiver = makeReceiverLease({ deviceId: DEVICE_ID, sessionId: SESSION_ID }, NOW);
  state.playback = { ...state.playback, provider: 'controlled', intent: 'stopped' };
  const store = {
    state,
    now: () => NOW,
    durableReady: () => true,
    async mutate(mutator) {
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      this.state = result && typeof result === 'object' ? result : draft;
      return this.state;
    }
  };
  let currentVoice = 100;
  const calls = [];
  const audio = {
    status: () => ({ voiceLevelPercent: currentVoice, calibrationActive: false }),
    musicPlaying: () => false,
    beginAnnouncement: async () => calls.push('duck'),
    endAnnouncement: async () => calls.push('restore-music'),
    setVoiceLevelPercent(percent) {
      currentVoice = Number(percent);
      calls.push(`voice-${percent}`);
    },
    playVoiceBlob: async () => calls.push(`blob-at-${currentVoice}`),
    playDeviceSpeech: async () => calls.push(`speech-at-${currentVoice}`),
    stopVoice() {},
    stopMusic() {}
  };
  const apple = {
    ready: false,
    supportsVolume: false,
    volumeVerified: false,
    current: null,
    loggedIn: () => false,
    pause: async () => false,
    resume: async () => false,
    pauseForAnnouncement: async () => ({ wasPlaying: false }),
    resumeAfterAnnouncement: async () => false,
    disconnect() {}
  };
  const runtime = new ReceiverRuntime({ store, audio, apple });
  runtime.deviceId = DEVICE_ID;
  runtime.sessionId = SESSION_ID;
  runtime.sessionStartedAt = NOW;
  runtime.active = true;
  runtime.lastDurableHeartbeatAt = NOW;
  return { runtime, store, calls };
}

describe('Version X announcement-volume delivery', { concurrency: false }, () => {
  test('captures the shared voice level when the job is queued', async () => {
    const { runtime, store, calls } = harness({ voiceLevel: 37 });
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    runtime.prepareVoice = async () => {
      started.resolve();
      await release.promise;
      return null;
    };

    const announcement = runtime.announce('Pool update');
    await started.promise;
    store.state.config.voiceLevel = 88;
    release.resolve();
    await announcement;
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.deepEqual(calls, ['duck', 'voice-37', 'speech-at-37', 'voice-100', 'restore-music']);
    assert.equal(store.state.activityLog[0].voiceOutput, 'device-speech-fallback');
    assert.match(store.state.activityLog[0].detail, /device speech requested target 37%/i);
  });

  test('records generated speech as mixer-controlled output', async () => {
    const { runtime, store, calls } = harness({ voiceLevel: 64 });
    runtime.prepareVoice = async () => ({ arrayBuffer: async () => new ArrayBuffer(0) });

    await runtime.announce('Generated pool update');
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(calls.includes('blob-at-64'), true);
    assert.equal(store.state.activityLog[0].voiceOutput, 'ai-mixer');
    assert.match(store.state.activityLog[0].detail, /Version X mixer voice 64%/i);
  });

  test('plays a finite announcement clip through the voice mixer without synthesizing its text', async () => {
    const { runtime, store, calls } = harness({ voiceLevel: 72 });
    let requested = null;
    runtime.prepareVoice = async () => {
      throw new Error('Natural speech must not be requested for a finite clip.');
    };
    runtime.prepareFiniteAnnouncementAudio = async delivery => {
      requested = delivery;
      return new Blob(['finite'], { type: 'audio/mpeg' });
    };

    await runtime.announce('Recorded pool update', {
      announcementMode: 'finite-audio',
      announcementProvider: 'direct',
      announcementAudioUrl: 'https://audio.example.test/pool-update.mp3',
      announcementDurationSeconds: 12
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(requested.announcementMode, 'finite-audio');
    assert.equal(requested.announcementProvider, 'direct');
    assert.equal(requested.announcementAudioUrl, 'https://audio.example.test/pool-update.mp3');
    assert.equal(requested.announcementDurationSeconds, 12);
    assert.equal(calls.includes('blob-at-72'), true);
    assert.equal(calls.some(call => call.startsWith('speech-at-')), false);
    assert.equal(store.state.activityLog[0].voiceOutput, 'finite-audio-mixer');
    assert.match(store.state.activityLog[0].detail, /finite clip 72%/i);
  });

  test('passes a live command volume through event dispatch', async () => {
    const { runtime } = harness();
    let received = null;
    runtime.announce = async (text, options) => { received = { text, options }; };

    await runtime.handleEvent({
      id: 'event-1',
      type: 'announce',
      payload: { text: 'Testing', label: 'Test', volumePercent: 61 }
    });

    assert.equal(received.text, 'Testing');
    assert.equal(received.options.volumePercent, 61);
    assert.equal(received.options.eventId, 'event-1');
  });

  test('passes a validated finite source through live event dispatch', async () => {
    const { runtime } = harness();
    let received = null;
    runtime.announce = async (text, options) => { received = { text, options }; };

    await runtime.handleEvent({
      id: 'event-finite-1',
      type: 'announce',
      payload: {
        text: 'Recorded pool update',
        label: 'Recorded',
        volumePercent: 100,
        announcementMode: 'finite-audio',
        announcementProvider: 'suno',
        announcementAudioUrl: 'https://suno.com/s/AbCd1234',
        announcementDurationSeconds: 18
      }
    });

    assert.equal(received.options.announcementMode, 'finite-audio');
    assert.equal(received.options.announcementProvider, 'suno');
    assert.equal(received.options.announcementAudioUrl, 'https://suno.com/s/AbCd1234');
    assert.equal(received.options.announcementDurationSeconds, 18);
  });

  test('does not play voice when Apple Music cannot be confirmed paused', async () => {
    const { runtime, store, calls } = harness();
    store.state.config.musicProvider = 'apple';
    store.state.playback.provider = 'apple';
    store.state.playback.intent = 'playing';
    runtime.apple.ready = true;
    runtime.apple.pauseForAnnouncement = async () => { throw new Error('still playing'); };
    runtime.apple.pause = async () => calls.push('fallback-pause');
    runtime.prepareVoice = async () => null;

    await assert.rejects(runtime.announce('Do not overlap'), /could not be confirmed paused/i);
    assert.equal(calls.some(call => call.startsWith('speech-at-') || call.startsWith('blob-at-')), false);
  });
});
