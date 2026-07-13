import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { createSessionToken } from '../api/_auth.js';
import sunoHandler from '../api/suno-playlist.js';
import { CloudStore } from '../src/v30/cloud.js';
import {
  RECEIVER_LEASE_MS,
  createDefaultState,
  makeReceiverLease
} from '../src/v30/core.js';
import { ReceiverRuntime } from '../src/v30/receiver-runtime.js';
import { SpotifyReceiver } from '../src/v30/spotify-receiver.js';

const NOW = Date.UTC(2026, 6, 6, 17, 30, 30);
const OWNER_ID = 'vfinal-concurrency-receiver';
const SESSION_ID = 'vfinal-concurrency-session';

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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function ownerState(now = NOW) {
  const state = createDefaultState(now);
  state.receiver = makeReceiverLease({
    deviceId: OWNER_ID,
    sessionId: SESSION_ID,
    name: 'Concurrency receiver'
  }, now);
  state.config.weatherAuto = false;
  return state;
}

function targetedEvent(id, type, createdAt, payload = {}) {
  return {
    id,
    type,
    payload,
    targetReceiverId: OWNER_ID,
    targetSessionId: SESSION_ID,
    createdAt,
    expiresAt: createdAt + 10 * 60_000,
    status: 'pending',
    completedAt: 0,
    completedBy: '',
    error: ''
  };
}

function runtimeHarness({
  state = ownerState(),
  now = NOW,
  audio = {},
  spotify = {},
  mutateHook = null
} = {}) {
  const mutations = [];
  const statuses = [];
  const defaultAudio = {
    musicElement: null,
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
    deviceId: 'spotify-local-device',
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
    enforceThirtyPercent: async () => ({ verified: true, actual: 30 }),
    resetVolumeVerification: () => {},
    disconnect: () => {}
  };
  const store = {
    state,
    now: () => typeof now === 'function' ? Number(now()) : Number(now),
    durableReady: () => true,
    mutate: null
  };
  const apply = async mutator => {
    const draft = structuredClone(store.state);
    const result = await mutator(draft);
    store.state = result && typeof result === 'object' ? result : draft;
    return store.state;
  };
  store.mutate = async (mutator, reason, options) => {
    mutations.push({ reason, options });
    if (mutateHook) {
      const hookResult = await mutateHook({ store, mutator, reason, options, apply });
      if (hookResult?.handled) return hookResult.value;
    }
    return await apply(mutator);
  };
  const runtime = new ReceiverRuntime({
    store,
    audio: { ...defaultAudio, ...audio },
    spotify: { ...defaultSpotify, ...spotify },
    onStatus: status => statuses.push(status)
  });
  runtime.deviceId = OWNER_ID;
  runtime.sessionId = SESSION_ID;
  runtime.sessionStartedAt = store.now();
  runtime.active = true;
  runtime.lastDurableHeartbeatAt = store.now();
  return { runtime, store, mutations, statuses };
}

function responseRecorder() {
  let raw = '';
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    end(value = '') { raw += Buffer.isBuffer(value) ? value.toString('utf8') : String(value); },
    json() { return raw ? JSON.parse(raw) : null; },
    headers
  };
}

function authedApiRequest(url) {
  const token = createSessionToken();
  assert.ok(token);
  return {
    method: 'GET',
    url,
    headers: {
      host: 'poolside.test',
      origin: 'https://poolside.test',
      cookie: `poolside_vfinal_session=${encodeURIComponent(token)}`,
      'x-forwarded-host': 'poolside.test',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin'
    },
    socket: { encrypted: true, remoteAddress: '203.0.113.20' }
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Node vFinal concurrency regression', platform: 'test', maxTouchPoints: 0 },
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

describe('adjustable levels and exclusive source handoffs', { concurrency: false }, () => {
  test('setMusicLevel applies a non-30 target to active controlled playback and preserves 100% voice', async () => {
    const state = ownerState();
    state.config.musicLevel = 30;
    state.playback = { ...state.playback, provider: 'controlled', intent: 'playing' };
    const applied = [];
    const targets = [];
    const { runtime, store, mutations } = runtimeHarness({
      state,
      audio: {
        setMusicLevelPercent: (percent, options) => applied.push({ percent, options })
      },
      spotify: {
        setTargetVolumePercent: percent => targets.push(percent)
      }
    });
    runtime.physicalProvider = 'controlled';

    const result = await runtime.setMusicLevel(42);

    assert.equal(result, 42);
    assert.deepEqual(applied, [{ percent: 42, options: { report: false } }]);
    assert.deepEqual(targets, [42]);
    assert.equal(store.state.config.musicLevel, 42);
    assert.equal(store.state.config.voiceLevel, 100);
    assert.equal(store.state.config.duckLevel, 0);
    assert.equal(store.state.playback.provider, 'controlled');
    assert.equal(store.state.playback.intent, 'playing');
    assert.deepEqual(mutations.map(entry => entry.reason), ['Music level applied', 'Receiver capability']);
    assert.match(store.state.activityLog[0].detail, /42% target; announcements remain 100%/i);
  });

  test('setMusicLevel enforces and records the selected target on active Spotify', async () => {
    const state = ownerState();
    state.config.musicProvider = 'spotify';
    state.playback = { ...state.playback, provider: 'spotify', intent: 'playing' };
    const enforced = [];
    const audioTargets = [];
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        setMusicLevelPercent: percent => audioTargets.push(percent)
      },
      spotify: {
        ready: true,
        supportsVolume: true,
        setTargetVolumePercent: percent => percent
      }
    });
    runtime.physicalProvider = 'spotify';
    runtime.spotify.enforceVolume = async percent => {
      enforced.push(percent);
      runtime.spotify.volumeVerified = true;
      runtime.spotify.verifiedPercent = percent;
      return { verified: true, volumeVerified: true, verifiedPercent: percent, actual: percent };
    };

    await runtime.setMusicLevel(42);

    assert.deepEqual(audioTargets, [42]);
    assert.deepEqual(enforced, [42]);
    assert.equal(store.state.config.musicLevel, 42);
    assert.equal(store.state.config.voiceLevel, 100);
    assert.equal(store.state.playback.volumeVerified, true);
    assert.equal(store.state.playback.volumeVerifiedPercent, 42);
    assert.equal(store.state.playback.volumeVerifiedAt, NOW);
    assert.equal(store.state.receiver.audioMode, 'spotify-verified-volume-pause');
  });

  test('controlled to Spotify to controlled handoffs never leave both local sources audible', async () => {
    const state = ownerState();
    state.config.musicLevel = 42;
    state.playback.intent = 'stopped';
    let controlledAudible = false;
    let spotifyAudible = false;
    const calls = [];
    const assertExclusive = stage => {
      assert.equal(controlledAudible && spotifyAudible, false, `sources overlapped during ${stage}`);
    };
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        musicElement: { currentTime: 7 },
        musicPlaying: () => controlledAudible,
        playMusicUrl: async url => {
          assert.equal(spotifyAudible, false, 'Spotify must be silent before controlled audio starts');
          controlledAudible = true;
          calls.push(`controlled-play:${url}`);
          assertExclusive('controlled start');
          return true;
        },
        pauseMusic: () => {
          calls.push('controlled-pause');
          controlledAudible = false;
          return true;
        },
        stopMusic: () => {
          calls.push('controlled-stop');
          controlledAudible = false;
          return true;
        }
      },
      spotify: {
        ready: true,
        supportsVolume: true,
        volumeVerified: true,
        verifiedPercent: 42,
        loggedIn: () => true,
        play: async (_url, { assertCurrent }) => {
          assertCurrent();
          assert.equal(controlledAudible, false, 'controlled audio must be paused before Spotify starts');
          spotifyAudible = true;
          calls.push('spotify-play');
          assertExclusive('Spotify start');
          return { volume: { verified: true, verifiedPercent: 42, actual: 42 } };
        },
        pauseForAnnouncement: async () => {
          const wasPlaying = spotifyAudible;
          spotifyAudible = false;
          calls.push(`spotify-pause:${wasPlaying}`);
          assertExclusive('Spotify pause');
          return { wasPlaying };
        }
      }
    });
    runtime.resolveControlledTracks = async url => ({
      playlistName: url.includes('second') ? 'Second controlled' : 'First controlled',
      tracks: [{
        id: url.includes('second') ? 'second' : 'first',
        title: url.includes('second') ? 'Second controlled' : 'First controlled',
        artist: 'Test',
        audioUrl: url
      }]
    });

    await runtime.playControlled('https://audio.test/first.mp3');
    assert.equal(runtime.physicalProvider, 'controlled');
    assert.deepEqual({ controlledAudible, spotifyAudible }, { controlledAudible: true, spotifyAudible: false });

    await runtime.playSpotify('https://open.spotify.com/playlist/exclusive-test');
    assert.equal(runtime.physicalProvider, 'spotify');
    assert.deepEqual({ controlledAudible, spotifyAudible }, { controlledAudible: false, spotifyAudible: true });

    // Deliberately stale cloud truth: the physical provider must still win and
    // force a confirmed local Spotify pause before controlled audio can start.
    store.state.playback = { ...store.state.playback, provider: 'controlled', intent: 'playing' };
    await runtime.playControlled('https://audio.test/second.mp3');

    assert.equal(runtime.physicalProvider, 'controlled');
    assert.deepEqual({ controlledAudible, spotifyAudible }, { controlledAudible: true, spotifyAudible: false });
    assert.deepEqual(calls, [
      'spotify-pause:false',
      'controlled-play:https://audio.test/first.mp3',
      'controlled-pause',
      'spotify-play',
      'controlled-stop',
      'spotify-pause:true',
      'controlled-play:https://audio.test/second.mp3'
    ]);
  });
});

describe('urgent event and source-switch concurrency', { concurrency: false }, () => {
  test('a safety event speaks while an older Play command is blocked on its cloud receipt', async () => {
    const state = ownerState();
    state.playback.intent = 'stopped';
    const playEvent = targetedEvent('play-with-slow-receipt', 'play-controlled', NOW + 1, {
      url: 'https://audio.test/track.mp3',
      label: 'Slow receipt track'
    });
    const safetyEvent = targetedEvent('urgent-during-play-receipt', 'announce-safety', NOW + 2, {
      text: 'Clear the pool now.',
      label: 'Urgent pool safety'
    });
    state.events = [playEvent, safetyEvent];
    const receiptStarted = Promise.withResolvers();
    const releaseReceipt = Promise.withResolvers();
    const voicePlayed = Promise.withResolvers();
    const calls = [];
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        playMusicUrl: async () => calls.push('controlled-started'),
        beginAnnouncement: async () => calls.push('duck'),
        playDeviceSpeech: async () => {
          calls.push('safety-voice');
          voicePlayed.resolve();
        },
        endAnnouncement: async ({ restore }) => calls.push(`end:${restore}`),
        stopMusic: () => calls.push('controlled-stopped')
      },
      mutateHook: async ({ reason }) => {
        if (reason !== 'Controlled music started') return null;
        receiptStarted.resolve();
        await releaseReceipt.promise;
        throw new Error('cloud receipt unavailable');
      }
    });
    runtime.resolveControlledTracks = async () => ({
      playlistName: 'Slow receipt track',
      tracks: [{ id: 'track', title: 'Slow receipt track', artist: 'Test', audioUrl: 'https://audio.test/track.mp3' }]
    });
    runtime.prepareVoice = async () => null;
    runtime.armLeaseGuard = () => {};

    const playing = runtime.processEvent(playEvent);
    await receiptStarted.promise;
    const safety = runtime.processEvent(safetyEvent);
    await voicePlayed.promise;

    assert.equal(runtime.audioRequestKind, 'safety');
    assert.equal(store.state.events.find(event => event.id === safetyEvent.id)?.status, 'pending');
    assert.deepEqual(calls.slice(0, 3), ['controlled-started', 'duck', 'safety-voice']);

    await safety;
    assert.equal(store.state.events.find(event => event.id === safetyEvent.id)?.status, 'completed');
    releaseReceipt.resolve();
    assert.equal(await playing, false);
    assert.equal(store.state.events.find(event => event.id === playEvent.id)?.status, 'failed');
    assert.equal(calls.includes('controlled-stopped'), true);
  });

  test('a safety event prevents a delayed successful Play receipt from resurrecting music intent', async () => {
    const state = ownerState();
    state.playback.intent = 'stopped';
    const playEvent = targetedEvent('play-with-late-success', 'play-controlled', NOW + 1, {
      url: 'https://audio.test/late-success.mp3',
      label: 'Late success track'
    });
    const safetyEvent = targetedEvent('safety-before-late-success', 'announce-safety', NOW + 2, {
      text: 'Clear the pool immediately.',
      label: 'Immediate safety warning'
    });
    state.events = [playEvent, safetyEvent];
    const receiptStarted = Promise.withResolvers();
    const releaseReceipt = Promise.withResolvers();
    const voicePlayed = Promise.withResolvers();
    const calls = [];
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        playMusicUrl: async () => calls.push('controlled-started'),
        beginAnnouncement: async () => calls.push('duck'),
        playDeviceSpeech: async () => {
          calls.push('safety-voice');
          voicePlayed.resolve();
        },
        endAnnouncement: async ({ restore }) => calls.push(`end:${restore}`),
        stopMusic: () => calls.push('controlled-stopped')
      },
      mutateHook: async ({ mutator, reason, apply }) => {
        if (reason !== 'Controlled music started') return null;
        receiptStarted.resolve();
        await releaseReceipt.promise;
        return { handled: true, value: await apply(mutator) };
      }
    });
    runtime.resolveControlledTracks = async () => ({
      playlistName: 'Late success track',
      tracks: [{ id: 'late', title: 'Late success track', artist: 'Test', audioUrl: 'https://audio.test/late-success.mp3' }]
    });
    runtime.prepareVoice = async () => null;
    runtime.armLeaseGuard = () => {};

    const playing = runtime.processEvent(playEvent);
    await receiptStarted.promise;
    const safety = runtime.processEvent(safetyEvent);
    await voicePlayed.promise;
    await safety;
    releaseReceipt.resolve();

    assert.equal(await playing, false, 'the superseded Play command must be failed, not acknowledged as completed');
    assert.equal(store.state.playback.intent, 'stopped');
    assert.equal(store.state.events.find(event => event.id === playEvent.id)?.status, 'failed');
    assert.equal(calls.includes('controlled-stopped'), true);
  });

  test('a safety event prevents a delayed successful Spotify Play receipt from resurrecting music intent', async () => {
    const state = ownerState();
    state.config.musicProvider = 'spotify';
    state.playback.intent = 'stopped';
    const playEvent = targetedEvent('spotify-play-with-late-success', 'play-spotify', NOW + 1, {
      url: 'https://open.spotify.com/playlist/late-success'
    });
    const safetyEvent = targetedEvent('safety-before-late-spotify-success', 'announce-safety', NOW + 2, {
      text: 'Clear the pool immediately.',
      label: 'Immediate safety warning'
    });
    state.events = [playEvent, safetyEvent];
    const receiptStarted = Promise.withResolvers();
    const releaseReceipt = Promise.withResolvers();
    const voicePlayed = Promise.withResolvers();
    const calls = [];
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        stopMusic: () => calls.push('controlled-stop'),
        playDeviceSpeech: async () => {
          calls.push('safety-voice');
          voicePlayed.resolve();
        }
      },
      spotify: {
        ready: true,
        loggedIn: () => true,
        play: async (_url, { assertCurrent }) => {
          assertCurrent();
          calls.push('spotify-started');
          return { volume: { verified: true } };
        },
        pauseForAnnouncement: async () => {
          calls.push('spotify-paused');
          return { wasPlaying: true, position: 3_000 };
        },
        resumeAfterAnnouncement: async () => {
          calls.push('unexpected-spotify-resume');
          return true;
        }
      },
      mutateHook: async ({ mutator, reason, apply }) => {
        if (reason !== 'Spotify playback started') return null;
        receiptStarted.resolve();
        await releaseReceipt.promise;
        return { handled: true, value: await apply(mutator) };
      }
    });
    runtime.prepareVoice = async () => null;
    runtime.armLeaseGuard = () => {};

    const playing = runtime.processEvent(playEvent);
    await receiptStarted.promise;
    const safety = runtime.processEvent(safetyEvent);
    await voicePlayed.promise;
    await safety;
    releaseReceipt.resolve();

    assert.equal(await playing, false, 'the superseded Spotify Play command must be failed, not acknowledged as completed');
    assert.equal(store.state.playback.intent, 'stopped');
    assert.equal(store.state.events.find(event => event.id === playEvent.id)?.status, 'failed');
    assert.equal(calls.includes('unexpected-spotify-resume'), false);
  });

  test('Spotify-to-controlled receipt failure hands the original Spotify bed to pending safety', async () => {
    const state = ownerState();
    state.config.musicProvider = 'spotify';
    state.playback = { ...state.playback, provider: 'spotify', intent: 'playing', label: 'Original Spotify bed' };
    const receiptStarted = Promise.withResolvers();
    const rejectReceipt = Promise.withResolvers();
    const prepareStarted = Promise.withResolvers();
    const releasePrepare = Promise.withResolvers();
    const calls = [];
    const { runtime } = runtimeHarness({
      state,
      audio: {
        playMusicUrl: async () => calls.push('controlled-start'),
        stopMusic: () => calls.push('controlled-stop'),
        playDeviceSpeech: async () => calls.push('safety-voice')
      },
      spotify: {
        ready: true,
        pauseForAnnouncement: async () => {
          calls.push('spotify-pause');
          return { wasPlaying: true, position: 12_000 };
        },
        resumeAfterAnnouncement: async snapshot => {
          assert.equal(snapshot.wasPlaying, true);
          calls.push('spotify-resume');
          return true;
        }
      },
      mutateHook: async ({ reason }) => {
        if (reason !== 'Controlled music started') return null;
        receiptStarted.resolve();
        await rejectReceipt.promise;
        throw new Error('controlled receipt failed');
      }
    });
    runtime.physicalProvider = 'spotify';
    runtime.resolveControlledTracks = async () => ({
      playlistName: 'Candidate controlled bed',
      tracks: [{ id: 'candidate', title: 'Candidate', artist: 'Test', audioUrl: 'https://audio.test/candidate.mp3' }]
    });
    runtime.prepareVoice = async () => {
      prepareStarted.resolve();
      return await releasePrepare.promise;
    };

    const switching = runtime.playControlled('https://audio.test/candidate.mp3');
    await receiptStarted.promise;
    const safety = runtime.announce('Urgent lightning warning.', { safety: true });
    await prepareStarted.promise;
    rejectReceipt.resolve();
    await assert.rejects(switching, /cloud state could not be saved/i);

    assert.equal(runtime.safetyRestoreSnapshot?.provider, 'spotify');
    releasePrepare.resolve(null);
    await safety;

    assert.deepEqual(calls, [
      'spotify-pause',
      'controlled-start',
      'controlled-stop',
      'spotify-pause',
      'safety-voice',
      'spotify-resume'
    ]);
    assert.equal(runtime.physicalProvider, 'spotify');
    assert.equal(runtime.safetyRestoreSnapshot, null);
  });

  test('controlled-to-Spotify receipt failure restores the original controlled bed after pending safety', async () => {
    const state = ownerState();
    state.config.musicProvider = 'controlled';
    state.playback = {
      ...state.playback,
      provider: 'controlled',
      intent: 'playing',
      label: 'Original controlled bed',
      audioUrl: 'https://audio.test/original.mp3',
      positionMs: 7_000
    };
    const receiptStarted = Promise.withResolvers();
    const rejectReceipt = Promise.withResolvers();
    const prepareStarted = Promise.withResolvers();
    const releasePrepare = Promise.withResolvers();
    const calls = [];
    const musicElement = { currentTime: 7 };
    const { runtime } = runtimeHarness({
      state,
      audio: {
        musicElement,
        musicPlaying: () => true,
        pauseMusic: () => calls.push('controlled-pause'),
        stopMusic: () => calls.push('controlled-stop'),
        resumeMusic: async () => false,
        beginAnnouncement: async () => calls.push('duck'),
        endAnnouncement: async ({ restore }) => calls.push(`end:${restore}`),
        playMusicUrl: async (url, options) => calls.push(`controlled-restore:${url}:${options.startAt}`),
        playDeviceSpeech: async () => calls.push('safety-voice')
      },
      spotify: {
        ready: true,
        loggedIn: () => true,
        play: async () => {
          calls.push('spotify-start');
          return { volume: { verified: true } };
        },
        pauseForAnnouncement: async () => {
          calls.push('spotify-pause');
          return { wasPlaying: true };
        }
      },
      mutateHook: async ({ reason }) => {
        if (reason !== 'Spotify playback started') return null;
        receiptStarted.resolve();
        await rejectReceipt.promise;
        throw new Error('Spotify receipt failed');
      }
    });
    runtime.physicalProvider = 'controlled';
    runtime.prepareVoice = async () => {
      prepareStarted.resolve();
      return await releasePrepare.promise;
    };

    const switching = runtime.playSpotify('https://open.spotify.com/playlist/test');
    await receiptStarted.promise;
    const safety = runtime.announce('Urgent wind warning.', { safety: true });
    await prepareStarted.promise;
    rejectReceipt.resolve();
    await assert.rejects(switching, /cloud state could not be saved/i);

    assert.equal(runtime.safetyRestoreSnapshot?.provider, 'controlled');
    releasePrepare.resolve(null);
    await safety;

    assert.deepEqual(calls, [
      'controlled-pause',
      'spotify-start',
      'controlled-stop',
      'spotify-pause',
      'spotify-pause',
      'duck',
      'safety-voice',
      'end:true',
      'controlled-restore:https://audio.test/original.mp3:7'
    ]);
    assert.equal(runtime.physicalProvider, 'controlled');
    assert.equal(runtime.safetyRestoreSnapshot, null);
  });
});

describe('late normal receipts never roll back a newer physical command', { concurrency: false }, () => {
  test('delayed controlled Play A cannot stop or overwrite newer controlled Play B', async () => {
    const state = ownerState();
    state.config.musicProvider = 'controlled';
    state.playback.intent = 'stopped';
    const receiptAStarted = Promise.withResolvers();
    const releaseReceiptA = Promise.withResolvers();
    const calls = [];
    let controlledReceipt = 0;
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        playMusicUrl: async url => calls.push(`play:${url}`),
        stopMusic: () => calls.push('stop')
      },
      mutateHook: async ({ store: currentStore, mutator, reason }) => {
        if (reason !== 'Controlled music started') return null;
        controlledReceipt += 1;
        if (controlledReceipt !== 1) return null;
        const staleDraft = structuredClone(currentStore.state);
        const result = await mutator(staleDraft);
        const staleSavedState = result && typeof result === 'object' ? result : staleDraft;
        receiptAStarted.resolve();
        await releaseReceiptA.promise;
        currentStore.state = staleSavedState;
        return { handled: true, value: currentStore.state };
      }
    });
    runtime.resolveControlledTracks = async url => {
      const id = url.includes('/a.') ? 'a' : 'b';
      return {
        playlistName: `Controlled ${id.toUpperCase()}`,
        tracks: [{
          id,
          title: `Controlled ${id.toUpperCase()}`,
          artist: 'Test',
          audioUrl: `https://audio.test/${id}.mp3`
        }]
      };
    };

    const playA = runtime.playControlled('https://audio.test/a.mp3', { label: 'Controlled A' });
    await receiptAStarted.promise;
    const playB = runtime.playControlled('https://audio.test/b.mp3', { label: 'Controlled B' });
    await playB;

    const requestB = runtime.physicalRequestId;
    assert.equal(store.state.playback.audioUrl, 'https://audio.test/b.mp3');
    assert.equal(runtime.physicalCommittedRequestId, requestB);
    releaseReceiptA.resolve();
    await assert.rejects(playA, /superseded|cloud state could not be saved/i);

    assert.deepEqual(calls, [
      'play:https://audio.test/a.mp3',
      'play:https://audio.test/b.mp3'
    ], 'A rollback must never stop the newer physical B bed');
    assert.equal(runtime.physicalRequestId, requestB);
    assert.equal(runtime.physicalCommittedRequestId, requestB);
    assert.equal(runtime.physicalProvider, 'controlled');
    assert.equal(store.state.playback.audioUrl, 'https://audio.test/b.mp3');
    assert.equal(store.state.playback.label, 'Controlled B - Test');
    assert.equal(store.state.config.musicUrl, 'https://audio.test/b.mp3');
  });

  test('delayed Spotify Play A cannot pause or overwrite newer Spotify Play B', async () => {
    const state = ownerState();
    state.config.musicProvider = 'spotify';
    state.playback.intent = 'stopped';
    const urlA = 'https://open.spotify.com/playlist/spotify-a';
    const urlB = 'https://open.spotify.com/playlist/spotify-b';
    const receiptAStarted = Promise.withResolvers();
    const releaseReceiptA = Promise.withResolvers();
    const calls = [];
    let spotifyReceipt = 0;
    let spotifyRef = null;
    const { runtime, store } = runtimeHarness({
      state,
      audio: { stopMusic: () => calls.push('stop-controlled-element') },
      spotify: {
        ready: true,
        loggedIn: () => true,
        play: async (url, { assertCurrent }) => {
          assertCurrent();
          const id = url === urlA ? 'A' : 'B';
          spotifyRef.current = { name: `Spotify ${id}`, artists: 'Test', paused: false };
          calls.push(`spotify-play:${id}`);
          return { volume: { verified: true } };
        },
        pauseForAnnouncement: async () => {
          calls.push('spotify-pause');
          return { wasPlaying: true };
        }
      },
      mutateHook: async ({ store: currentStore, mutator, reason }) => {
        if (reason !== 'Spotify playback started') return null;
        spotifyReceipt += 1;
        if (spotifyReceipt !== 1) return null;
        const staleDraft = structuredClone(currentStore.state);
        const result = await mutator(staleDraft);
        const staleSavedState = result && typeof result === 'object' ? result : staleDraft;
        receiptAStarted.resolve();
        await releaseReceiptA.promise;
        currentStore.state = staleSavedState;
        return { handled: true, value: currentStore.state };
      }
    });
    spotifyRef = runtime.spotify;
    runtime.armLeaseGuard = () => {};

    const playA = runtime.playSpotify(urlA);
    await receiptAStarted.promise;
    const playB = runtime.playSpotify(urlB);
    await playB;

    const requestB = runtime.physicalRequestId;
    assert.equal(store.state.playback.sourceUrl, urlB);
    assert.equal(runtime.physicalCommittedRequestId, requestB);
    releaseReceiptA.resolve();
    await assert.rejects(playA, /superseded|cloud state could not be saved/i);

    assert.equal(calls.includes('spotify-pause'), false, 'A rollback must never pause newer Spotify B');
    assert.equal(runtime.physicalRequestId, requestB);
    assert.equal(runtime.physicalCommittedRequestId, requestB);
    assert.equal(runtime.physicalProvider, 'spotify');
    assert.equal(store.state.playback.sourceUrl, urlB);
    assert.equal(store.state.playback.label, 'Spotify B');
    assert.equal(store.state.config.spotifyUrl, urlB);
  });

  test('a delayed successful Resume receipt preempted by safety stays paused', async () => {
    const state = ownerState();
    state.config.musicProvider = 'controlled';
    state.playback = {
      ...state.playback,
      provider: 'controlled',
      intent: 'paused',
      label: 'Paused bed',
      audioUrl: 'https://audio.test/paused-bed.mp3',
      positionMs: 8_000
    };
    const receiptStarted = Promise.withResolvers();
    const releaseReceipt = Promise.withResolvers();
    const voicePlayed = Promise.withResolvers();
    const calls = [];
    let audible = false;
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        musicPlaying: () => audible,
        resumeMusic: async () => {
          audible = true;
          calls.push('resume');
          return true;
        },
        pauseMusic: () => {
          audible = false;
          calls.push('pause');
        },
        beginAnnouncement: async () => calls.push('duck'),
        endAnnouncement: async ({ restore }) => {
          calls.push(`end:${restore}`);
          audible = restore;
        },
        playDeviceSpeech: async () => {
          calls.push('voice');
          voicePlayed.resolve();
        }
      },
      mutateHook: async ({ store: currentStore, mutator, reason }) => {
        if (reason !== 'Music resumed') return null;
        const staleDraft = structuredClone(currentStore.state);
        const result = await mutator(staleDraft);
        const staleSavedState = result && typeof result === 'object' ? result : staleDraft;
        receiptStarted.resolve();
        await releaseReceipt.promise;
        currentStore.state = staleSavedState;
        return { handled: true, value: currentStore.state };
      }
    });
    runtime.physicalProvider = 'controlled';
    runtime.prepareVoice = async () => null;

    const resuming = runtime.resumeMusic();
    await receiptStarted.promise;
    const safety = runtime.announce('Urgent safety warning.', { safety: true });
    await voicePlayed.promise;
    await safety;
    releaseReceipt.resolve();
    await assert.rejects(resuming, /resume receipt could not be saved|superseded/i);

    assert.equal(audible, false);
    assert.equal(calls.includes('end:true'), false);
    assert.equal(store.state.playback.intent, 'paused');
    assert.equal(store.state.playback.audioUrl, 'https://audio.test/paused-bed.mp3');
    assert.match(store.state.playback.unavailableReason, /urgent safety announcement superseded/i);
  });

  test('a delayed successful Next receipt preempted by safety restores prior metadata but stays paused', async () => {
    const state = ownerState();
    state.config.musicProvider = 'controlled';
    state.playback = {
      ...state.playback,
      provider: 'controlled',
      intent: 'playing',
      label: 'Track A - Test',
      audioUrl: 'https://audio.test/track-a.mp3',
      trackIndex: 0,
      tracks: [
        { id: 'a', title: 'Track A', artist: 'Test', audioUrl: 'https://audio.test/track-a.mp3' },
        { id: 'b', title: 'Track B', artist: 'Test', audioUrl: 'https://audio.test/track-b.mp3' }
      ]
    };
    const receiptStarted = Promise.withResolvers();
    const releaseReceipt = Promise.withResolvers();
    const voicePlayed = Promise.withResolvers();
    const calls = [];
    let audible = true;
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        musicPlaying: () => audible,
        playMusicUrl: async url => {
          audible = true;
          calls.push(`play:${url}`);
        },
        pauseMusic: () => {
          audible = false;
          calls.push('pause');
        },
        beginAnnouncement: async () => calls.push('duck'),
        endAnnouncement: async ({ restore }) => {
          calls.push(`end:${restore}`);
          audible = restore;
        },
        playDeviceSpeech: async () => {
          calls.push('voice');
          voicePlayed.resolve();
        }
      },
      mutateHook: async ({ store: currentStore, mutator, reason }) => {
        if (reason !== 'Controlled track skipped') return null;
        const staleDraft = structuredClone(currentStore.state);
        const result = await mutator(staleDraft);
        const staleSavedState = result && typeof result === 'object' ? result : staleDraft;
        receiptStarted.resolve();
        await releaseReceipt.promise;
        currentStore.state = staleSavedState;
        return { handled: true, value: currentStore.state };
      }
    });
    runtime.physicalProvider = 'controlled';
    runtime.prepareVoice = async () => null;

    const skipping = runtime.nextMusic();
    await receiptStarted.promise;
    const safety = runtime.announce('Urgent safety warning.', { safety: true });
    await voicePlayed.promise;
    await safety;
    releaseReceipt.resolve();
    await assert.rejects(skipping, /cloud receipt could not be saved|superseded/i);

    assert.equal(audible, false);
    assert.equal(calls.includes('end:true'), false);
    assert.equal(store.state.playback.intent, 'paused');
    assert.equal(store.state.playback.trackIndex, 0);
    assert.equal(store.state.playback.audioUrl, 'https://audio.test/track-a.mp3');
    assert.equal(store.state.playback.label, 'Track A - Test');
    assert.match(store.state.playback.unavailableReason, /urgent safety announcement superseded/i);
  });
});

describe('announcements silence only the local Spotify receiver', { concurrency: false }, () => {
  function controlledAnnouncementState() {
    const state = ownerState();
    state.config.musicProvider = 'controlled';
    state.playback = {
      ...state.playback,
      provider: 'controlled',
      intent: 'playing',
      label: 'Controlled bed',
      audioUrl: 'https://audio.test/controlled-bed.mp3'
    };
    return state;
  }

  test('unexpected local Spotify playback is confirmed paused before controlled-bed voice', async () => {
    const calls = [];
    const receiver = new SpotifyReceiver();
    receiver.ready = true;
    receiver.deviceId = 'spotify-local-device';
    receiver.playbackState = async () => {
      calls.push('spotify-state');
      return { isPlaying: true, deviceId: 'spotify-local-device', position: 5_000, uri: 'spotify:track:unexpected' };
    };
    receiver.pause = async () => {
      calls.push('spotify-pause');
      return true;
    };
    const { runtime, statuses } = runtimeHarness({
      state: controlledAnnouncementState(),
      audio: {
        musicPlaying: () => true,
        beginAnnouncement: async () => calls.push('duck'),
        playDeviceSpeech: async () => calls.push('voice'),
        endAnnouncement: async ({ restore }) => calls.push(`end:${restore}`)
      },
      spotify: {
        ready: true,
        pauseForAnnouncement: receiver.pauseForAnnouncement.bind(receiver)
      }
    });
    runtime.physicalProvider = 'controlled';
    runtime.prepareVoice = async () => null;

    await runtime.announce('Controlled-bed announcement.');

    assert.deepEqual(calls, ['spotify-state', 'spotify-pause', 'duck', 'voice', 'end:true']);
    assert.equal(statuses.some(status => /unexpected local Spotify playback was paused/i.test(status.message)), true);
  });

  test('Spotify playing on another device is left alone and does not block controlled-bed voice', async () => {
    const calls = [];
    const receiver = new SpotifyReceiver();
    receiver.ready = true;
    receiver.deviceId = 'spotify-local-device';
    receiver.playbackState = async () => {
      calls.push('spotify-state-other-device');
      return { isPlaying: true, deviceId: 'family-room-speaker', position: 9_000, uri: 'spotify:track:elsewhere' };
    };
    receiver.pause = async () => {
      calls.push('unexpected-pause-other-device');
      return true;
    };
    const { runtime } = runtimeHarness({
      state: controlledAnnouncementState(),
      audio: {
        musicPlaying: () => true,
        beginAnnouncement: async () => calls.push('duck'),
        playDeviceSpeech: async () => calls.push('voice'),
        endAnnouncement: async ({ restore }) => calls.push(`end:${restore}`)
      },
      spotify: {
        ready: true,
        pauseForAnnouncement: receiver.pauseForAnnouncement.bind(receiver)
      }
    });
    runtime.physicalProvider = 'controlled';
    runtime.prepareVoice = async () => null;

    await runtime.announce('Announcement while another device uses Spotify.');

    assert.deepEqual(calls, ['spotify-state-other-device', 'duck', 'voice', 'end:true']);
    assert.equal(calls.includes('unexpected-pause-other-device'), false);
  });
});

describe('terminal commands and physical-provider truth', { concurrency: false }, () => {
  for (const command of ['pauseMusic', 'stopMusic']) {
    test(`${command === 'pauseMusic' ? 'Pause' : 'Stop'} during safety prevents any post-announcement music restore`, async () => {
      const state = ownerState();
      state.playback = {
        ...state.playback,
        provider: 'controlled',
        intent: 'playing',
        label: 'Controlled bed',
        audioUrl: 'https://audio.test/bed.mp3'
      };
      const speechStarted = Promise.withResolvers();
      const finishSpeech = Promise.withResolvers();
      const endRestores = [];
      const calls = [];
      const { runtime, store } = runtimeHarness({
        state,
        audio: {
          beginAnnouncement: async () => calls.push('duck'),
          playDeviceSpeech: async () => {
            calls.push('voice');
            speechStarted.resolve();
            await finishSpeech.promise;
          },
          endAnnouncement: async ({ restore }) => endRestores.push(restore),
          playMusicUrl: async () => calls.push('unexpected-restore'),
          pauseMusic: () => calls.push('terminal-pause'),
          stopMusic: () => calls.push('terminal-stop')
        }
      });
      runtime.physicalProvider = 'controlled';
      runtime.prepareVoice = async () => null;

      const safety = runtime.announce('Safety warning.', { safety: true });
      await speechStarted.promise;
      const terminal = runtime[command]();
      finishSpeech.resolve();
      await Promise.all([safety, terminal]);

      assert.deepEqual(endRestores, [false]);
      assert.equal(calls.includes('unexpected-restore'), false);
      assert.equal(store.state.playback.intent, command === 'pauseMusic' ? 'paused' : 'stopped');
      assert.equal(runtime.safetyRestoreSnapshot, null);
      assert.equal(runtime.preemptedSpotifySnapshot, null);
    });
  }

  test('a heartbeat read spanning a complete temporary Spotify pause cannot persist a false paused state', async () => {
    const state = ownerState();
    state.config.musicProvider = 'spotify';
    state.playback = {
      ...state.playback,
      provider: 'spotify',
      intent: 'playing',
      label: 'Verified Spotify bed',
      unavailableReason: ''
    };
    const readStarted = Promise.withResolvers();
    const finishRead = Promise.withResolvers();
    let volumeReads = 0;
    const { runtime, store } = runtimeHarness({
      state,
      spotify: {
        ready: true,
        supportsVolume: true,
        volumeVerified: true,
        playbackState: async () => {
          readStarted.resolve();
          return await finishRead.promise;
        },
        readLocalVolume: async () => {
          volumeReads += 1;
          return { matches: true, actual: 30 };
        }
      }
    });
    runtime.physicalProvider = 'spotify';
    runtime.armLeaseGuard = () => {};

    const heartbeat = runtime.heartbeat();
    await readStarted.promise;
    runtime.beginTemporarySpotifyPause();
    runtime.endTemporarySpotifyPause();
    finishRead.resolve({
      isPlaying: false,
      deviceId: 'spotify-local-device',
      name: 'Transient paused sample',
      position: 4_000
    });
    await heartbeat;

    assert.equal(store.state.playback.intent, 'playing');
    assert.equal(store.state.playback.label, 'Verified Spotify bed');
    assert.equal(store.state.playback.unavailableReason, '');
    assert.equal(runtime.physicalProvider, 'spotify');
    assert.equal(volumeReads, 0);
  });

  test('Stop silences the physical Spotify provider even when cloud state still says controlled', async () => {
    const state = ownerState();
    state.config.musicProvider = 'controlled';
    state.playback = { ...state.playback, provider: 'controlled', intent: 'playing' };
    const calls = [];
    const { runtime, store } = runtimeHarness({
      state,
      audio: { stopMusic: () => calls.push('stop-controlled-path') },
      spotify: {
        pauseForAnnouncement: async () => {
          calls.push('pause-physical-spotify');
          return { wasPlaying: true };
        }
      }
    });
    runtime.physicalProvider = 'spotify';

    await runtime.stopMusic();

    assert.deepEqual(calls, ['pause-physical-spotify', 'stop-controlled-path']);
    assert.equal(store.state.playback.provider, 'spotify');
    assert.equal(store.state.playback.intent, 'stopped');
    assert.equal(runtime.physicalProvider, '');
  });

  test('Next follows the physical Spotify provider instead of a stale controlled cloud provider', async () => {
    const state = ownerState();
    state.config.musicProvider = 'controlled';
    state.playback = {
      ...state.playback,
      provider: 'controlled',
      intent: 'playing',
      trackIndex: 0,
      tracks: [
        { title: 'Wrong controlled path', audioUrl: 'https://audio.test/wrong.mp3' },
        { title: 'Also wrong', audioUrl: 'https://audio.test/wrong-2.mp3' }
      ]
    };
    const calls = [];
    const { runtime, store } = runtimeHarness({
      state,
      audio: { playMusicUrl: async () => calls.push('controlled-next') },
      spotify: {
        next: async ({ assertCurrent }) => {
          assertCurrent();
          calls.push('spotify-next');
          return { name: 'Physical next', artists: 'Spotify', position: 25 };
        }
      }
    });
    runtime.physicalProvider = 'spotify';

    await runtime.nextMusic();

    assert.deepEqual(calls, ['spotify-next']);
    assert.equal(store.state.playback.provider, 'spotify');
    assert.equal(store.state.playback.label, 'Physical next - Spotify');
    assert.equal(runtime.physicalProvider, 'spotify');
  });
});

describe('schedule and weather compare-before-commit behavior', { concurrency: false }, () => {
  function durablePendingLightningState(pendingAt = NOW - 1_000) {
    const state = ownerState();
    const committedWeather = {
      ...state.weather,
      status: 'Lightning detected within the safety radius.',
      checkedAt: pendingAt,
      providerErrors: [],
      lightningActive: true,
      lightningHoldUntil: pendingAt + 30 * 60_000,
      lastLightningKey: 'durable-pending-strike',
      lastLightningAnnouncementAt: pendingAt,
      lastLightningCoverageAt: pendingAt,
      lastThreatType: 'lightning'
    };
    state.weather = {
      ...committedWeather,
      lastLightningKey: '',
      lastLightningAnnouncementAt: 0,
      pendingAnnouncementIds: ['lightning'],
      pendingAnnouncementAt: pendingAt,
      pendingAnnouncementConfig: {
        latitude: state.config.latitude,
        longitude: state.config.longitude,
        lightningRadiusMiles: state.config.lightningRadiusMiles,
        lightningHoldMinutes: state.config.lightningHoldMinutes,
        windGustMph: state.config.windGustMph
      },
      pendingAnnouncementCommit: committedWeather
    };
    return state;
  }

  function clearWeatherPayload() {
    return {
      ok: true,
      summary: 'No current lightning, wind, or tornado threat.',
      threat: false,
      threatType: '',
      lightningCoverageKnown: true,
      tornadoCoverageKnown: true,
      windCoverageKnown: true,
      lightningHits: [],
      windHits: [],
      providerErrors: []
    };
  }

  for (const staleChange of ['disabled', 'rescheduled']) {
    test(`does not claim a due schedule item that was ${staleChange} in the latest cloud state`, async () => {
      const state = ownerState();
      state.announcements = [{ id: 'safety', label: 'Safety', text: 'Safety message' }];
      state.schedule = [{
        id: 'stale-schedule',
        label: 'Stale schedule',
        type: 'announcement',
        time: '12:30',
        announcementId: 'safety',
        enabled: true,
        days: [1]
      }];
      state.scheduleRuns = {};
      let playbackCalls = 0;
      let cloudChangeApplied = false;
      const { runtime, store } = runtimeHarness({
        state,
        mutateHook: async ({ store: currentStore, mutator, reason, apply }) => {
          if (reason !== 'Schedule run claimed' || cloudChangeApplied) return null;
          cloudChangeApplied = true;
          const latest = structuredClone(currentStore.state);
          if (staleChange === 'disabled') latest.schedule[0].enabled = false;
          else latest.schedule[0].time = '12:45';
          currentStore.state = latest;
          return { handled: true, value: await apply(mutator) };
        }
      });
      runtime.announce = async () => { playbackCalls += 1; };

      await runtime.tickSchedule();

      assert.equal(cloudChangeApplied, true);
      assert.equal(playbackCalls, 0);
      assert.deepEqual(store.state.scheduleRuns, {});
      assert.equal(store.state.schedule[0].enabled, staleChange !== 'disabled');
      assert.equal(store.state.schedule[0].time, staleChange === 'rescheduled' ? '12:45' : '12:30');
    });
  }

  test('retries a weather scan against changed config and announces only the committed result', async () => {
    const state = ownerState();
    state.config.latitude = 36.6337;
    state.config.longitude = -93.4166;
    state.config.lightningRadiusMiles = 10;
    const requestUrls = [];
    const announced = [];
    let forcedConfigRace = false;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async url => {
      requestUrls.push(String(url));
      return jsonResponse({
        ok: true,
        summary: 'Lightning detected.',
        threat: true,
        threatType: 'lightning',
        lightningCoverageKnown: true,
        tornadoCoverageKnown: true,
        windCoverageKnown: true,
        lightningHits: [{ id: 'config-race-strike', distanceMI: 2, timestamp: NOW }],
        windHits: [],
        providerErrors: []
      });
    };
    try {
      const { runtime, store } = runtimeHarness({
        state,
        mutateHook: async ({ store: currentStore, mutator, reason, apply }) => {
          if (reason !== 'Weather check completed' || forcedConfigRace) return null;
          forcedConfigRace = true;
          const latest = structuredClone(currentStore.state);
          latest.config.latitude = 40.1234;
          latest.config.longitude = -90.4321;
          latest.config.lightningRadiusMiles = 4;
          currentStore.state = latest;
          return { handled: true, value: await apply(mutator) };
        }
      });
      runtime.announce = async (message, options) => {
        announced.push({ message, options });
        return true;
      };

      const result = await runtime.checkWeather({ announce: true, reason: 'config race test' });

      assert.equal(forcedConfigRace, true);
      assert.equal(requestUrls.length, 2);
      assert.match(requestUrls[0], /lat=36\.6337/);
      assert.match(requestUrls[0], /lightningRadiusMiles=10/);
      assert.match(requestUrls[1], /lat=40\.1234/);
      assert.match(requestUrls[1], /lightningRadiusMiles=4/);
      assert.deepEqual(result.announcements, ['lightning']);
      assert.equal(announced.length, 1);
      assert.match(announced[0].message, /within 4 miles/i);
      assert.equal(announced[0].options.safety, true);
      assert.equal(store.state.weather.lastLightningKey, 'config-race-strike');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('plays an urgent weather warning even when its state receipt cannot be committed', async () => {
    const state = ownerState();
    const announced = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse({
      ok: true,
      summary: 'Lightning detected.',
      threat: true,
      threatType: 'lightning',
      lightningCoverageKnown: true,
      tornadoCoverageKnown: true,
      windCoverageKnown: true,
      lightningHits: [{ id: 'receipt-failure-strike', distanceMI: 3, timestamp: NOW }],
      windHits: [],
      providerErrors: []
    });
    try {
      const { runtime } = runtimeHarness({
        state,
        mutateHook: async ({ reason }) => {
          if (reason === 'Weather check completed') throw new Error('durable weather receipt unavailable');
          return null;
        }
      });
      runtime.announce = async (message, options) => {
        announced.push({ message, options });
        return true;
      };

      const result = await runtime.checkWeather({ announce: true, reason: 'receipt failure test' });

      assert.equal(announced.length, 1);
      assert.equal(announced[0].options.safety, true);
      assert.match(announced[0].message, /clear the water now/i);
      assert.match(result.receiptError, /durable weather receipt unavailable/i);
      assert.deepEqual(result.announcements, ['lightning']);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('a new runtime replays a crash-staged lightning warning once before accepting a later clear scan', async () => {
    const threatPayload = {
      ok: true,
      summary: 'Lightning detected within the safety radius.',
      threat: true,
      threatType: 'lightning',
      lightningCoverageKnown: true,
      tornadoCoverageKnown: true,
      windCoverageKnown: true,
      lightningHits: [{ id: 'crash-staged-strike', distanceMI: 2.4, timestamp: NOW - 1_000 }],
      windHits: [],
      providerErrors: []
    };
    const previousFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse(fetchCalls === 1 ? threatPayload : clearWeatherPayload());
    };
    try {
      const first = runtimeHarness({ state: ownerState() });
      first.runtime.announce = async () => {
        throw new Error('simulated receiver crash before lightning speech');
      };

      await assert.rejects(
        first.runtime.checkWeather({ announce: true, reason: 'stage before crash' }),
        /simulated receiver crash/i
      );
      assert.deepEqual(first.store.state.weather.pendingAnnouncementIds, ['lightning']);
      assert.ok(first.store.state.weather.pendingAnnouncementCommit);
      assert.equal(first.store.state.weather.lastLightningKey, '');
      assert.equal(first.store.state.weather.pendingAnnouncementCommit.lastLightningKey, 'crash-staged-strike');

      const durableStateAfterCrash = structuredClone(first.store.state);
      const order = [];
      const replayed = [];
      const second = runtimeHarness({
        state: durableStateAfterCrash,
        mutateHook: async ({ store, reason }) => {
          if (reason === 'Pending weather warning confirmed') {
            assert.deepEqual(store.state.weather.pendingAnnouncementIds, ['lightning']);
            assert.ok(store.state.weather.pendingAnnouncementCommit);
            order.push('pending-confirmed');
          }
          return null;
        }
      });
      second.runtime.announce = async (message, options) => {
        order.push('pending-spoken');
        replayed.push({ message, options });
        return true;
      };
      const fetchBeforeRecovery = fetchCalls;

      const recovered = await second.runtime.checkWeather({ announce: true, reason: 'fresh runtime recovery' });

      assert.equal(fetchCalls, fetchBeforeRecovery + 1);
      assert.deepEqual(order, ['pending-spoken', 'pending-confirmed']);
      assert.equal(replayed.length, 1);
      assert.equal(replayed[0].options.safety, true);
      assert.match(replayed[0].options.label, /durable retry/i);
      assert.match(replayed[0].message, /lightning has been detected/i);
      assert.deepEqual(recovered.announcements, []);
      assert.deepEqual(second.store.state.weather.pendingAnnouncementIds, []);
      assert.equal(second.store.state.weather.pendingAnnouncementAt, 0);
      assert.equal(second.store.state.weather.pendingAnnouncementConfig, null);
      assert.equal(second.store.state.weather.pendingAnnouncementCommit, null);
      assert.equal(second.store.state.weather.lastLightningKey, 'crash-staged-strike');
      assert.equal(second.store.state.weather.lastLightningAnnouncementAt, NOW);

      await second.runtime.checkWeather({ announce: true, reason: 'repeat after recovery' });
      assert.equal(replayed.length, 1, 'the confirmed durable warning must never replay a second time');
      assert.equal(fetchCalls, fetchBeforeRecovery + 2);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('pending lightning remains durable when replay speech fails', async () => {
    const state = durablePendingLightningState();
    const originalPending = structuredClone(state.weather);
    const previousFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse(clearWeatherPayload());
    };
    try {
      const { runtime, store, mutations } = runtimeHarness({ state });
      runtime.announce = async () => {
        throw new Error('speaker unavailable during durable replay');
      };

      await assert.rejects(
        runtime.checkWeather({ announce: true, reason: 'speech failure recovery' }),
        /speaker unavailable during durable replay/i
      );

      assert.equal(fetchCalls, 0, 'fresh weather must not bypass an unspoken recent durable warning');
      assert.deepEqual(store.state.weather.pendingAnnouncementIds, ['lightning']);
      assert.equal(store.state.weather.pendingAnnouncementAt, originalPending.pendingAnnouncementAt);
      assert.deepEqual(store.state.weather.pendingAnnouncementConfig, originalPending.pendingAnnouncementConfig);
      assert.deepEqual(store.state.weather.pendingAnnouncementCommit, originalPending.pendingAnnouncementCommit);
      assert.equal(mutations.some(entry => entry.reason === 'Pending weather warning confirmed'), false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('pending lightning remains durable when post-speech confirmation fails', async () => {
    const state = durablePendingLightningState();
    const originalPending = structuredClone(state.weather);
    const previousFetch = globalThis.fetch;
    let fetchCalls = 0;
    let speechCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse(clearWeatherPayload());
    };
    try {
      const { runtime, store } = runtimeHarness({
        state,
        mutateHook: async ({ reason }) => {
          if (reason === 'Pending weather warning confirmed') {
            throw new Error('durable warning confirmation unavailable');
          }
          return null;
        }
      });
      runtime.announce = async () => {
        speechCalls += 1;
        return true;
      };

      await assert.rejects(
        runtime.checkWeather({ announce: true, reason: 'confirmation failure recovery' }),
        /durable warning confirmation unavailable/i
      );

      assert.equal(speechCalls, 1);
      assert.equal(fetchCalls, 0, 'a failed confirmation must stop before a newer scan can erase the retry marker');
      assert.deepEqual(store.state.weather.pendingAnnouncementIds, ['lightning']);
      assert.equal(store.state.weather.pendingAnnouncementAt, originalPending.pendingAnnouncementAt);
      assert.deepEqual(store.state.weather.pendingAnnouncementConfig, originalPending.pendingAnnouncementConfig);
      assert.deepEqual(store.state.weather.pendingAnnouncementCommit, originalPending.pendingAnnouncementCommit);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('an overnight pending lightning warning is replaced by authoritative clear coverage without stale speech', async () => {
    const overnightAt = NOW - 12 * 60 * 60_000;
    const state = durablePendingLightningState(overnightAt);
    const previousFetch = globalThis.fetch;
    let fetchCalls = 0;
    const announced = [];
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse(clearWeatherPayload());
    };
    try {
      const { runtime, store } = runtimeHarness({ state });
      runtime.announce = async (message, options) => {
        announced.push({ message, options });
        return true;
      };

      const result = await runtime.checkWeather({ announce: true, reason: 'overnight authoritative clear' });

      assert.equal(fetchCalls, 1);
      assert.equal(
        announced.some(entry => /lightning has been detected/i.test(entry.message) || /durable retry/i.test(entry.options.label)),
        false,
        'overnight-old lightning must not be spoken blindly'
      );
      assert.deepEqual(result.announcements, ['lightning-clear']);
      assert.equal(announced.length, 1, 'authoritative clear coverage may replace the stale warning with a current all-clear');
      assert.match(announced[0].options.label, /lightning all clear/i);
      assert.deepEqual(store.state.weather.pendingAnnouncementIds, []);
      assert.equal(store.state.weather.pendingAnnouncementAt, 0);
      assert.equal(store.state.weather.pendingAnnouncementConfig, null);
      assert.equal(store.state.weather.pendingAnnouncementCommit, null);
      assert.equal(store.state.weather.lightningActive, false);
      assert.equal(store.state.weather.lastLightningKey, '');
      assert.equal(store.state.weather.status, 'No current lightning, wind, or tornado threat.');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('incomplete lightning coverage preserves an overnight pending warning for authoritative retry without stale speech', async () => {
    const overnightAt = NOW - 12 * 60 * 60_000;
    const state = durablePendingLightningState(overnightAt);
    const originalPending = structuredClone(state.weather);
    const previousFetch = globalThis.fetch;
    let fetchCalls = 0;
    const announced = [];
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return jsonResponse({
        ok: true,
        summary: 'Lightning coverage is temporarily incomplete.',
        threat: false,
        threatType: '',
        lightningCoverageKnown: false,
        tornadoCoverageKnown: true,
        windCoverageKnown: true,
        lightningHits: [],
        windHits: [],
        providerErrors: ['Lightning feed did not provide complete coverage.']
      });
    };
    try {
      const { runtime, store } = runtimeHarness({ state });
      runtime.announce = async (message, options) => {
        announced.push({ message, options });
        return true;
      };

      await runtime.checkWeather({ announce: true, reason: 'overnight incomplete coverage' });

      assert.equal(fetchCalls, 1);
      assert.deepEqual(announced, [], 'stale pending lightning must wait for authoritative coverage, not speak blindly');
      assert.deepEqual(store.state.weather.pendingAnnouncementIds, ['lightning']);
      assert.equal(store.state.weather.pendingAnnouncementAt, originalPending.pendingAnnouncementAt);
      assert.deepEqual(store.state.weather.pendingAnnouncementConfig, originalPending.pendingAnnouncementConfig);
      assert.deepEqual(store.state.weather.pendingAnnouncementCommit, originalPending.pendingAnnouncementCommit);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

describe('production fallback and explicit Suno identity', { concurrency: false }, () => {
  test('a nonlocal 404 state service rejects reads and writes instead of entering local mode', async () => {
    const previousFetch = globalThis.fetch;
    const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {
      value: { hostname: 'poolside.example.com' },
      configurable: true,
      writable: true
    });
    globalThis.fetch = async () => new Response('<!doctype html><title>Not found</title>', {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
    try {
      const store = new CloudStore();
      store.state.marker = 'must-not-be-saved-locally';

      await assert.rejects(store.fetchRemote(), /stopped instead of using an unsynchronized local copy/i);
      await assert.rejects(store.postRemote(store.state, 0), /stopped instead of using an unsynchronized local copy/i);
      await assert.rejects(
        store.mutate(draft => {
          draft.marker = 'forbidden-local-write';
          return draft;
        }, 'Production write', { requireDurable: true }),
        /stopped instead of using an unsynchronized local copy/i
      );

      assert.notEqual(store.syncMode, 'local');
      assert.equal(store.durableReady(), false);
      assert.equal(localStorage.getItem('poolside-pulse-vfinal-local-state'), null);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
      else delete globalThis.location;
    }
  });

  test('an explicit Suno song refuses unrelated playlist recommendations embedded on its page', async () => {
    const previousFetch = globalThis.fetch;
    const previousSecret = process.env.POOL_SIDE_SESSION_SECRET;
    process.env.POOL_SIDE_SESSION_SECRET = 'vfinal-concurrency-session-secret-long-enough';
    const requestedId = 'requested-song-id';
    const requestedUrl = `https://suno.com/song/${requestedId}`;
    globalThis.fetch = async () => new Response(`<!doctype html>
      <html><head><link rel="canonical" href="${requestedUrl}"></head>
      <body><script type="application/json">{
        "playlist": {"name": "Recommendations", "clips": [{
          "id": "unrelated-recommendation",
          "title": "Unrelated Recommendation",
          "audio_url": "https://cdn.suno.ai/unrelated-recommendation.mp3"
        }]}
      }</script></body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
    try {
      const req = authedApiRequest(`/api/suno-playlist?url=${encodeURIComponent(requestedUrl)}`);
      const res = responseRecorder();
      await sunoHandler(req, res);

      assert.equal(res.statusCode, 500);
      assert.equal(res.json().ok, false);
      assert.match(res.json().error, /returned no playable track data/i);
      assert.doesNotMatch(JSON.stringify(res.json()), /Unrelated Recommendation/);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousSecret === undefined) delete process.env.POOL_SIDE_SESSION_SECRET;
      else process.env.POOL_SIDE_SESSION_SECRET = previousSecret;
    }
  });
});
