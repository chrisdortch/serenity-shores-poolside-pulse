import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import {
  createDefaultState,
  makeReceiverLease,
  normalizeNamedSchedule
} from '../src/vfinal/core.js';
import { ReceiverRuntime } from '../src/vfinal/receiver-runtime.js';

const NOW = Date.UTC(2026, 6, 6, 17, 30, 30); // Monday 12:30:30 America/Chicago.
const OWNER_ID = 'runtime-refinement-receiver';
const SESSION_ID = 'runtime-refinement-session';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(message);
}

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

function ownerState(now = NOW) {
  const state = createDefaultState(now);
  state.receiver = makeReceiverLease({
    deviceId: OWNER_ID,
    sessionId: SESSION_ID,
    name: 'Runtime refinement receiver'
  }, now);
  state.config.weatherAuto = false;
  return state;
}

function runtimeHarness({ state = ownerState(), audio = {}, spotify = {} } = {}) {
  const defaultAudio = {
    musicElement: null,
    currentUrl: '',
    currentLabel: '',
    status: () => ({ calibrationActive: false }),
    stopCalibration: () => false,
    unlock: async () => true,
    setMusicLevelPercent: () => 30,
    stopVoice: () => {},
    stopMusic: () => {},
    pauseMusic: () => false,
    resumeMusic: async () => false,
    musicPlaying: () => false,
    playMusicUrl: async () => true,
    beginAnnouncement: async () => {},
    endAnnouncement: async () => {},
    playVoiceBlob: async () => {},
    playDeviceSpeech: async () => {}
  };
  const defaultSpotify = {
    ready: false,
    supportsVolume: false,
    volumeVerified: false,
    verifiedPercent: null,
    deviceId: 'spotify-refinement-device',
    current: null,
    loggedIn: () => false,
    pause: async () => false,
    pauseForAnnouncement: async () => ({ wasPlaying: false }),
    resumeAfterAnnouncement: async () => false,
    resume: async () => false,
    next: async () => null,
    playbackState: async () => null,
    readLocalVolume: async () => ({ matches: true, actual: 30 }),
    setTargetVolumePercent: percent => Number(percent),
    enforceVolume: async percent => ({ verified: true, verifiedPercent: Number(percent), actual: Number(percent) }),
    resetVolumeVerification: () => {},
    disconnect: () => {}
  };
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
  const runtime = new ReceiverRuntime({
    store,
    audio: { ...defaultAudio, ...audio },
    spotify: { ...defaultSpotify, ...spotify }
  });
  runtime.deviceId = OWNER_ID;
  runtime.sessionId = SESSION_ID;
  runtime.sessionStartedAt = NOW;
  runtime.active = true;
  runtime.lastDurableHeartbeatAt = NOW;
  runtime.armLeaseGuard = () => {};
  return { runtime, store };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Node vFinal runtime refinement', platform: 'test', maxTouchPoints: 0 },
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'document', {
    value: {
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {}
    },
    configurable: true,
    writable: true
  });
});

describe('runtime refinement regressions', { concurrency: false }, () => {
  test('heartbeat follows the changed global target while paused but preserves a paused custom target', async () => {
    const globalState = ownerState();
    globalState.config.musicLevel = 46;
    globalState.playback = {
      ...globalState.playback,
      provider: 'controlled',
      intent: 'paused',
      volumeMode: 'global',
      musicLevelPercent: 30
    };
    const globalTargets = [];
    const { runtime: globalRuntime } = runtimeHarness({
      state: globalState,
      audio: { setMusicLevelPercent: percent => globalTargets.push(percent) }
    });

    await globalRuntime.heartbeat();

    const customState = ownerState();
    customState.config.musicLevel = 46;
    customState.playback = {
      ...customState.playback,
      provider: 'controlled',
      intent: 'paused',
      volumeMode: 'custom',
      musicLevelPercent: 17
    };
    const customTargets = [];
    const { runtime: customRuntime } = runtimeHarness({
      state: customState,
      audio: { setMusicLevelPercent: percent => customTargets.push(percent) }
    });

    await customRuntime.heartbeat();

    assert.deepEqual(globalTargets, [46]);
    assert.deepEqual(customTargets, [17]);
    assert.equal(globalRuntime.currentMusicTarget(), 46);
    assert.equal(customRuntime.currentMusicTarget(), 17);
  });

  test('controlled source resolution failure does not disturb the existing audible target', async () => {
    const state = ownerState();
    state.config.musicLevel = 46;
    state.playback = {
      ...state.playback,
      provider: 'controlled',
      intent: 'playing',
      volumeMode: 'custom',
      musicLevelPercent: 18,
      audioUrl: 'https://audio.test/existing.mp3'
    };
    let audibleTarget = 18;
    const applied = [];
    const { runtime } = runtimeHarness({
      state,
      audio: {
        setMusicLevelPercent: percent => {
          audibleTarget = percent;
          applied.push(percent);
        }
      }
    });
    runtime.physicalProvider = 'controlled';
    runtime.resolveControlledTracks = async () => {
      throw new Error('source resolution failed');
    };

    await assert.rejects(
      runtime.playControlled('https://suno.com/playlist/unavailable', {
        volumeMode: 'custom',
        volumePercent: 79
      }),
      /source resolution failed/i
    );

    assert.equal(audibleTarget, 18);
    assert.deepEqual(applied, []);
    assert.equal(runtime.currentMusicTarget(), 18);
    assert.equal(runtime.physicalProvider, 'controlled');
  });

  test('failed controlled-to-Spotify start restores the controlled custom target', async () => {
    const state = ownerState();
    state.config.musicProvider = 'controlled';
    state.config.musicLevel = 46;
    state.playback = {
      ...state.playback,
      provider: 'controlled',
      intent: 'playing',
      volumeMode: 'custom',
      musicLevelPercent: 21,
      label: 'Existing controlled bed',
      audioUrl: 'https://audio.test/existing.mp3'
    };
    const targets = [];
    const calls = [];
    const { runtime } = runtimeHarness({
      state,
      audio: {
        musicElement: { currentTime: 8 },
        currentUrl: 'https://audio.test/existing.mp3',
        currentLabel: 'Existing controlled bed',
        musicPlaying: () => true,
        pauseMusic: () => calls.push('controlled-pause'),
        resumeMusic: async () => {
          calls.push('controlled-resume');
          return true;
        },
        setMusicLevelPercent: percent => targets.push(percent)
      },
      spotify: {
        ready: true,
        loggedIn: () => true,
        play: async () => {
          calls.push('spotify-start');
          throw new Error('Spotify start failed');
        }
      }
    });
    runtime.physicalProvider = 'controlled';

    await assert.rejects(
      runtime.playSpotify('https://open.spotify.com/playlist/unavailable', {
        volumeMode: 'custom',
        volumePercent: 77
      }),
      /Spotify start failed/i
    );

    assert.deepEqual(targets, [77, 21]);
    assert.deepEqual(calls, ['controlled-pause', 'spotify-start', 'controlled-resume']);
    assert.equal(runtime.physicalProvider, 'controlled');
    assert.equal(runtime.currentMusicTarget(), 21);
  });

  test('failed Spotify-to-controlled start restores the Spotify custom target', async () => {
    const state = ownerState();
    state.config.musicProvider = 'spotify';
    state.config.musicLevel = 46;
    state.playback = {
      ...state.playback,
      provider: 'spotify',
      intent: 'playing',
      volumeMode: 'custom',
      musicLevelPercent: 23,
      label: 'Existing Spotify bed'
    };
    const targets = [];
    const calls = [];
    const { runtime } = runtimeHarness({
      state,
      audio: {
        setMusicLevelPercent: percent => targets.push(percent),
        playMusicUrl: async () => {
          calls.push('controlled-start');
          throw new Error('Controlled start failed');
        }
      },
      spotify: {
        ready: true,
        pauseForAnnouncement: async () => {
          calls.push('spotify-pause');
          return { wasPlaying: true, position: 6_000 };
        },
        resumeAfterAnnouncement: async () => {
          calls.push('spotify-resume');
          return true;
        }
      }
    });
    runtime.physicalProvider = 'spotify';
    runtime.resolveControlledTracks = async () => ({
      playlistName: 'Candidate controlled bed',
      tracks: [{
        id: 'candidate',
        title: 'Candidate controlled bed',
        artist: 'Test',
        audioUrl: 'https://audio.test/candidate.mp3'
      }]
    });

    await assert.rejects(
      runtime.playControlled('https://audio.test/candidate.mp3', {
        volumeMode: 'custom',
        volumePercent: 64
      }),
      /Controlled start failed/i
    );

    assert.deepEqual(targets, [64, 23]);
    assert.deepEqual(calls, ['spotify-pause', 'controlled-start', 'spotify-resume']);
    assert.equal(runtime.physicalProvider, 'spotify');
    assert.equal(runtime.currentMusicTarget(), 23);
  });

  test('a newer request and a terminal action both stop active calibration synchronously', async () => {
    const state = ownerState();
    state.playback = {
      ...state.playback,
      provider: 'controlled',
      intent: 'playing'
    };
    let calibrationActive = true;
    const calibrationStops = [];
    const { runtime } = runtimeHarness({
      state,
      audio: {
        status: () => ({ calibrationActive }),
        stopCalibration: (reason, options) => {
          calibrationStops.push({ reason, options });
          calibrationActive = false;
          return true;
        }
      }
    });

    runtime.nextAudioRequest();
    assert.equal(calibrationStops.length, 1, 'normal request must stop the tone before nextAudioRequest returns');

    calibrationActive = true;
    const stopping = runtime.stopMusic();
    assert.equal(calibrationStops.length, 2, 'terminal action must stop the tone before its first await');
    assert.equal(runtime.audioRequestKind, 'terminal');
    await stopping;

    assert.match(calibrationStops[0].reason, /newer audio action/i);
    assert.match(calibrationStops[1].reason, /newer audio action/i);
    assert.deepEqual(calibrationStops.map(entry => entry.options), [
      { ok: true, report: false },
      { ok: true, report: false }
    ]);
  });

  test('nested Time schedule speaks inline text exactly and passes a custom music percentage', async () => {
    const state = ownerState();
    const schedule = normalizeNamedSchedule({
      id: 'nested-time-schedule',
      name: 'Nested Time Schedule',
      mode: 'time',
      enabled: true,
      items: [
        {
          id: 'inline-announcement',
          label: 'One-off notice',
          enabled: true,
          days: [1],
          position: { time: '12:30', order: 1 },
          action: {
            kind: 'announcement',
            announcementSource: 'inline',
            text: 'Custom one-off notice. Swim lessons begin in ten minutes.'
          }
        },
        {
          id: 'custom-music',
          label: 'Quiet custom music',
          enabled: true,
          days: [1],
          position: { time: '12:30', order: 2 },
          action: {
            kind: 'controlled',
            url: 'https://audio.test/quiet-track.mp3'
          },
          volume: { mode: 'custom', percent: 17 }
        }
      ]
    });
    state.schedules = [schedule];
    state.activeScheduleId = schedule.id;
    state.schedule = [];
    state.scheduleRuns = {};
    const calls = [];
    const { runtime, store } = runtimeHarness({ state });
    runtime.announce = async (text, options) => {
      calls.push({ kind: 'announcement', text, options });
      return true;
    };
    runtime.playControlled = async (url, options) => {
      calls.push({ kind: 'controlled', url, options });
      return true;
    };

    await runtime.tickSchedule();

    assert.deepEqual(calls, [
      {
        kind: 'announcement',
        text: 'Custom one-off notice. Swim lessons begin in ten minutes.',
        options: { label: 'One-off notice' }
      },
      {
        kind: 'controlled',
        url: 'https://audio.test/quiet-track.mp3',
        options: {
          label: 'Quiet custom music',
          volumePercent: 17,
          volumeMode: 'custom',
          scheduledItemId: 'custom-music'
        }
      }
    ]);
    assert.equal(store.state.scheduleRuns['inline-announcement']?.status, 'completed');
    assert.equal(store.state.scheduleRuns['custom-music']?.status, 'completed');
  });

  test('a pending custom playback receipt keeps its physical target through global saves and cloud refreshes', async () => {
    const state = ownerState();
    state.config.musicLevel = 30;
    const receiptGate = deferred();
    const physicalStarted = deferred();
    const targets = [];
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        playMusicUrl: async () => {
          physicalStarted.resolve();
          return true;
        },
        setMusicLevelPercent: percent => targets.push(Number(percent)),
        musicPlaying: () => true
      }
    });
    runtime.resolveControlledTracks = async () => ({
      tracks: [{ title: 'Custom pending track', artist: '', audioUrl: 'https://audio.test/custom-pending.mp3' }],
      playlistName: 'Custom pending track'
    });
    const baseMutate = store.mutate.bind(store);
    store.mutate = async (mutator, reason) => {
      if (reason === 'Controlled music started') await receiptGate.promise;
      return await baseMutate(mutator);
    };

    const starting = runtime.playControlled('https://audio.test/source', {
      volumeMode: 'custom',
      volumePercent: 17
    });
    await physicalStarted.promise;
    await waitFor(() => runtime.currentPhysicalCustomTarget() === 17, 'the pending custom target was not made authoritative');

    await runtime.setMusicLevel(62);
    store.state = { ...store.state, marker: 'unrelated cloud refresh' };
    assert.equal(runtime.applyConfiguredMusicTarget({ report: false }), 17);
    assert.equal(targets.at(-1), 17);
    assert.equal(store.state.config.musicLevel, 62);

    receiptGate.resolve();
    await starting;
    assert.equal(store.state.playback.volumeMode, 'custom');
    assert.equal(store.state.playback.musicLevelPercent, 17);
    assert.equal(runtime.currentMusicTarget(), 17);
  });

  test('a failed controlled replacement restores the prior controlled bed and custom target', async () => {
    const state = ownerState();
    state.config.musicLevel = 30;
    state.playback = {
      ...state.playback,
      provider: 'controlled',
      intent: 'playing',
      label: 'Prior bed',
      audioUrl: 'https://audio.test/prior.mp3',
      volumeMode: 'custom',
      musicLevelPercent: 21,
      scheduledItemId: '',
      scheduledRunToken: ''
    };
    const played = [];
    const targets = [];
    let stopped = 0;
    const musicElement = { currentTime: 12, loop: true };
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        musicElement,
        currentUrl: 'https://audio.test/prior.mp3',
        currentLabel: 'Prior bed',
        currentRunToken: '',
        musicPlaying: () => true,
        playMusicUrl: async (url, options) => {
          played.push({ url, options });
          return true;
        },
        stopMusic: () => { stopped += 1; },
        setMusicLevelPercent: percent => targets.push(Number(percent))
      }
    });
    runtime.physicalProvider = 'controlled';
    runtime.resolveControlledTracks = async () => ({
      tracks: [{ title: 'Replacement', artist: '', audioUrl: 'https://audio.test/replacement.mp3' }],
      playlistName: 'Replacement'
    });
    const baseMutate = store.mutate.bind(store);
    store.mutate = async (mutator, reason) => {
      if (reason === 'Controlled music started') throw new Error('receipt storage failed');
      return await baseMutate(mutator);
    };

    await assert.rejects(
      runtime.playControlled('https://audio.test/replacement-source', {
        volumeMode: 'custom',
        volumePercent: 74
      }),
      /cloud state could not be saved/i
    );

    assert.deepEqual(played.map(entry => entry.url), [
      'https://audio.test/replacement.mp3',
      'https://audio.test/prior.mp3'
    ]);
    assert.equal(played[1].options.startAt, 12);
    assert.equal(stopped, 1);
    assert.equal(targets.at(-1), 21);
    assert.equal(runtime.physicalProvider, 'controlled');
    assert.equal(runtime.currentPhysicalCustomTarget(), 21);
    assert.equal(store.state.playback.audioUrl, 'https://audio.test/prior.mp3');
  });
});
