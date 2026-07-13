import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { CloudStore } from '../src/v30/cloud.js';
import {
  RECEIVER_LEASE_MS,
  createDefaultState,
  makeReceiverLease
} from '../src/v30/core.js';
import { ReceiverRuntime } from '../src/v30/receiver-runtime.js';

const OWNER_ID = 'receiver-test-device';
const SESSION_ID = 'receiver-test-session';
const MONDAY_1230_CHICAGO = Date.UTC(2026, 6, 6, 17, 30, 30);

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.setCalls = 0;
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.setCalls += 1;
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }

  clear() {
    this.values.clear();
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function ownerState(now = MONDAY_1230_CHICAGO) {
  const state = createDefaultState(now);
  state.receiver = makeReceiverLease({
    deviceId: OWNER_ID,
    sessionId: SESSION_ID,
    name: 'Test receiver'
  }, now);
  return state;
}

function runtimeHarness({
  state = ownerState(),
  now = MONDAY_1230_CHICAGO,
  audio = {},
  spotify = {},
  mutate = null
} = {}) {
  const mutations = [];
  const statuses = [];
  const changes = [];
  const currentTime = () => typeof now === 'function' ? Number(now()) : Number(now);
  const defaultAudio = {
    unlock: async () => true,
    stopVoice: () => {},
    stopMusic: () => {},
    pauseMusic: () => false,
    resumeMusic: async () => false,
    beginAnnouncement: async () => {},
    endAnnouncement: async () => {},
    playVoiceBlob: async () => {},
    playDeviceSpeech: async () => {}
  };
  const defaultSpotify = {
    ready: false,
    supportsVolume: false,
    volumeVerified: false,
    loggedIn: () => false,
    pause: async () => false,
    resume: async () => false,
    pauseForAnnouncement: async () => ({ wasPlaying: false }),
    resumeAfterAnnouncement: async () => {},
    disconnect: () => {}
  };
  const store = {
    state,
    now: currentTime,
    durableReady: () => true,
    mutate: async (mutator, reason, options) => {
      mutations.push({ reason, options });
      if (mutate) return await mutate({ store, mutator, reason, options });
      const draft = structuredClone(store.state);
      const result = await mutator(draft);
      store.state = result && typeof result === 'object' ? result : draft;
      return store.state;
    }
  };
  const runtime = new ReceiverRuntime({
    store,
    audio: { ...defaultAudio, ...audio },
    spotify: { ...defaultSpotify, ...spotify },
    onStatus: status => statuses.push(status),
    onChange: () => changes.push(true)
  });
  runtime.deviceId = OWNER_ID;
  runtime.sessionId = SESSION_ID;
  runtime.sessionStartedAt = currentTime();
  runtime.active = true;
  runtime.lastDurableHeartbeatAt = currentTime();
  return { runtime, store, mutations, statuses, changes };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Node vFinal test receiver', platform: 'test', maxTouchPoints: 0 },
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

describe('receiver startup lease freshness', { concurrency: false }, () => {
  test('claims its lease after audio unlock without attempting asynchronous Spotify activation', async () => {
    const initialNow = MONDAY_1230_CHICAGO;
    let clock = initialNow;
    const state = createDefaultState(initialNow);
    state.config.musicProvider = 'spotify';
    state.config.weatherAuto = false;
    state.playback.intent = 'stopped';
    const setupAdvanceMs = RECEIVER_LEASE_MS * 2;
    let spotifyConnectCalls = 0;
    let spotifyCapabilityCalls = 0;
    const { runtime, store } = runtimeHarness({
      state,
      now: () => clock,
      audio: {
        unlock: async () => { clock += setupAdvanceMs; },
        playUnlockTone: async () => true
      },
      spotify: {
        loggedIn: () => true,
        supportsVolume: true,
        volumeVerified: true,
        connectFromUserGesture: async () => { spotifyConnectCalls += 1; clock += setupAdvanceMs; },
        refreshCapabilities: async () => {
          spotifyCapabilityCalls += 1;
          clock += setupAdvanceMs;
          return { supportsVolume: true, volumeVerified: true };
        }
      }
    });
    runtime.active = false;
    runtime.sessionId = '';
    runtime.sessionStartedAt = 0;
    runtime.lastDurableHeartbeatAt = 0;
    runtime.startLoops = () => {};
    runtime.requestWakeLock = async () => {};
    runtime.armLeaseGuard = () => {};

    const expectedClaimTime = initialNow + setupAdvanceMs;
    const lease = await runtime.start();

    assert.equal(clock, expectedClaimTime);
    assert.equal(spotifyConnectCalls, 0, 'Spotify activation must wait for its own explicit receiver tap');
    assert.equal(spotifyCapabilityCalls, 0);
    assert.equal(lease.startedAt, expectedClaimTime);
    assert.equal(lease.lastSeen, expectedClaimTime);
    assert.equal(lease.leaseUntil, expectedClaimTime + RECEIVER_LEASE_MS);
    assert.equal(store.state.receiver.startedAt, expectedClaimTime);
    assert.equal(store.state.receiver.lastSeen, expectedClaimTime);
    assert.equal(store.state.receiver.leaseUntil, expectedClaimTime + RECEIVER_LEASE_MS);
    assert.equal(runtime.sessionStartedAt, expectedClaimTime);
    assert.equal(runtime.lastDurableHeartbeatAt, store.state.receiver.lastSeen);
  });
});

describe('receiver announcement safety and restoration', { concurrency: false }, () => {
  test('Spotify pause verification failure prevents every voice playback path', async () => {
    const state = ownerState();
    state.config.musicProvider = 'spotify';
    state.playback.provider = 'spotify';
    state.playback.intent = 'playing';
    const calls = [];
    const { runtime, mutations } = runtimeHarness({
      state,
      audio: {
        playVoiceBlob: async () => calls.push('voice-blob'),
        playDeviceSpeech: async () => calls.push('device-speech')
      },
      spotify: {
        ready: true,
        pauseForAnnouncement: async () => {
          calls.push('pause-verify');
          throw new Error('Spotify still reports playing');
        },
        pause: async () => {
          calls.push('fallback-pause');
          return true;
        },
        resumeAfterAnnouncement: async () => calls.push('resume')
      }
    });
    runtime.prepareVoice = async () => ({ type: 'audio/mpeg' });

    await assert.rejects(
      runtime.performAnnouncement('Safety test'),
      /not played because Spotify could not be confirmed paused/i
    );

    assert.deepEqual(calls, ['pause-verify', 'fallback-pause']);
    assert.equal(mutations.length, 0, 'an announcement receipt must not be written when no voice played');
  });

  test('controlled music restoration runs even when voice playback fails', async () => {
    const state = ownerState();
    state.config.musicProvider = 'controlled';
    state.playback.provider = 'controlled';
    state.playback.intent = 'playing';
    const calls = [];
    const { runtime, mutations } = runtimeHarness({
      state,
      audio: {
        beginAnnouncement: async () => calls.push('duck'),
        playDeviceSpeech: async () => {
          calls.push('voice');
          throw new Error('speech synthesis failed');
        },
        endAnnouncement: async () => calls.push('restore-30-percent-music')
      }
    });
    runtime.prepareVoice = async () => null;

    await assert.rejects(runtime.performAnnouncement('Test announcement'), /speech synthesis failed/);

    assert.deepEqual(calls, ['duck', 'voice', 'restore-30-percent-music']);
    assert.equal(mutations.length, 0, 'failed voice must not be recorded as completed');
  });

  test('stopping during an in-flight Spotify pause never resumes through announcement cleanup', async () => {
    const state = ownerState();
    state.config.musicProvider = 'spotify';
    state.playback.provider = 'spotify';
    state.playback.intent = 'playing';
    const firstPauseStarted = Promise.withResolvers();
    const releaseFirstPause = Promise.withResolvers();
    const calls = [];
    let pauseCalls = 0;
    const { runtime } = runtimeHarness({
      state,
      audio: {
        stopVoice: () => calls.push('stop-voice'),
        stopMusic: () => calls.push('stop-music'),
        playDeviceSpeech: async () => calls.push('voice')
      },
      spotify: {
        ready: true,
        pauseForAnnouncement: async () => {
          pauseCalls += 1;
          calls.push(`pause-${pauseCalls}`);
          if (pauseCalls === 1) {
            firstPauseStarted.resolve();
            return await releaseFirstPause.promise;
          }
          return { wasPlaying: true };
        },
        resumeAfterAnnouncement: async () => calls.push('resume'),
        disconnect: () => calls.push('disconnect')
      }
    });
    runtime.prepareVoice = async () => null;

    const announcement = runtime.announce('Pool safety update');
    const announcementRejected = assert.rejects(announcement, /preempted while Spotify was pausing/i);
    await firstPauseStarted.promise;

    const stopping = runtime.stop({ release: false });
    releaseFirstPause.resolve({ wasPlaying: true });
    await stopping;
    await announcementRejected;

    assert.equal(runtime.active, false);
    assert.equal(pauseCalls, 2, 'stop must independently confirm Spotify is paused');
    assert.equal(calls.includes('voice'), false);
    assert.equal(calls.includes('resume'), false, 'the in-flight announcement finally block must respect cancellation');
    assert.deepEqual(calls, ['pause-1', 'stop-voice', 'stop-music', 'pause-2', 'stop-voice', 'stop-music', 'disconnect']);
  });
});

describe('receiver fail-safe and command dispatch', { concurrency: false }, () => {
  test('a full lease of durable heartbeat failure fail-safe stops all audio', async () => {
    const now = MONDAY_1230_CHICAGO;
    const state = ownerState(now);
    state.playback.provider = 'spotify';
    state.playback.intent = 'playing';
    const calls = [];
    const { runtime, statuses, changes } = runtimeHarness({
      state,
      now,
      audio: {
        stopVoice: () => calls.push('stop-voice'),
        stopMusic: () => calls.push('stop-music')
      },
      spotify: {
        pauseForAnnouncement: async () => {
          calls.push('pause-spotify');
          return { wasPlaying: true };
        },
        disconnect: () => calls.push('disconnect-spotify')
      },
      mutate: async () => {
        throw new Error('durable KV unavailable');
      }
    });
    runtime.lastDurableHeartbeatAt = now - RECEIVER_LEASE_MS;

    await runtime.heartbeat();

    assert.equal(runtime.active, false);
    assert.deepEqual(calls, ['stop-voice', 'stop-music', 'pause-spotify', 'disconnect-spotify']);
    assert.equal(changes.length, 1);
    assert.match(statuses.at(-1).message, /heartbeat was lost for the full receiver lease/i);
    assert.equal(statuses.at(-1).ok, false);
  });

  test('resume-music events dispatch through the single runtime resume path', async () => {
    const { runtime } = runtimeHarness();
    const events = [];
    runtime.resumeMusic = async () => {
      events.push('resume');
      return true;
    };

    const result = await runtime.handleEvent({ type: 'resume-music', payload: {} });

    assert.equal(result, true);
    assert.deepEqual(events, ['resume']);
  });

  test('does not enqueue a remote Spotify command until the receiver publishes verified readiness', async () => {
    const state = ownerState();
    state.receiver.spotifyStatus = 'access-blocked';
    state.receiver.spotifyDetail = 'Spotify denied GET /me with HTTP 403.';
    const { runtime, store } = runtimeHarness({ state });
    runtime.active = false;

    await assert.rejects(
      runtime.sendCommand('play-spotify', { url: 'spotify:track:abc', label: 'Spotify' }),
      /not Spotify-ready.*HTTP 403/i
    );
    assert.equal(store.state.events.length, 0);

    store.state.receiver.spotifyStatus = 'ready';
    await runtime.sendCommand('play-spotify', { url: 'spotify:track:abc', label: 'Spotify' });
    assert.equal(store.state.events.length, 1);
    assert.equal(store.state.events[0].type, 'play-spotify');
  });

  test('records safe Spotify failure phase metadata with the durable failed command', async () => {
    const state = ownerState();
    state.receiver.spotifyStatus = 'ready';
    const failure = new Error('Spotify denied PUT /me/player/play with HTTP 403. Spotify said: Restriction violated.');
    failure.code = 'SPOTIFY_ACCESS_RESTRICTED';
    failure.status = 403;
    failure.spotifyOperation = 'PUT /me/player/play';
    failure.spotifyReason = 'Restriction violated';
    const { runtime, store } = runtimeHarness({
      state,
      spotify: {
        ready: true,
        loggedIn: () => true,
        readiness: () => ({ status: 'ready', ready: true, detail: 'Spotify ready.' }),
        play: async () => { throw failure; }
      }
    });
    const event = {
      id: 'spotify-failure-event',
      type: 'play-spotify',
      payload: { label: 'Spotify' },
      targetReceiverId: OWNER_ID,
      targetSessionId: SESSION_ID,
      createdAt: MONDAY_1230_CHICAGO,
      expiresAt: MONDAY_1230_CHICAGO + 60_000,
      status: 'pending'
    };

    assert.equal(await runtime.processEvent(event), false);
    const saved = store.state.events.find(item => item.id === event.id);
    assert.equal(saved.status, 'failed');
    assert.equal(saved.errorCode, 'SPOTIFY_ACCESS_RESTRICTED');
    assert.equal(saved.errorStatus, 403);
    assert.equal(saved.errorOperation, 'PUT /me/player/play');
    assert.equal(saved.spotifyReason, 'Restriction violated');
    const log = store.state.activityLog.find(item => item.eventId === event.id);
    assert.equal(log.errorOperation, 'PUT /me/player/play');
  });

  test('public Spotify diagnostic plays without replacing the saved source', async () => {
    const state = ownerState();
    state.config.musicProvider = 'controlled';
    state.config.spotifyUrl = 'spotify:playlist:saved-source';
    state.receiver.spotifyStatus = 'ready';
    const { runtime, store } = runtimeHarness({
      state,
      spotify: {
        ready: true,
        loggedIn: () => true,
        readiness: () => ({ status: 'ready', ready: true, detail: 'Spotify ready.' }),
        play: async () => ({
          state: { isPlaying: true, deviceId: 'receiver-a', uri: 'spotify:track:public-test' },
          volume: { verified: false }
        })
      }
    });
    const event = {
      id: 'spotify-public-diagnostic',
      type: 'play-spotify',
      payload: {
        url: 'spotify:track:public-test',
        label: 'Public test track',
        persistSource: false
      },
      targetReceiverId: OWNER_ID,
      targetSessionId: SESSION_ID,
      createdAt: MONDAY_1230_CHICAGO,
      expiresAt: MONDAY_1230_CHICAGO + 60_000,
      status: 'pending'
    };

    assert.equal(await runtime.processEvent(event), true);
    assert.equal(store.state.config.musicProvider, 'controlled');
    assert.equal(store.state.config.spotifyUrl, 'spotify:playlist:saved-source');
    assert.equal(store.state.playback.provider, 'spotify');
    assert.equal(store.state.playback.sourceUrl, 'spotify:track:public-test');
  });
});

describe('receiver schedule receipts', { concurrency: false }, () => {
  function scheduledState() {
    const state = ownerState(MONDAY_1230_CHICAGO);
    state.announcements = [{ id: 'safety', label: 'Safety', text: 'Safety message' }];
    const item = {
      id: 'midday-safety',
      label: 'Midday Safety',
      type: 'announcement',
      time: '12:30',
      announcementId: 'safety',
      position: { time: '12:30', order: 1 },
      action: { kind: 'announcement', announcementSource: 'saved', announcementId: 'safety', text: '', url: '' },
      volume: { mode: 'custom', percent: 100 },
      advance: { mode: 'complete', durationSeconds: 300 },
      enabled: true,
      days: [1]
    };
    state.schedules = [{ id: 'receipt-test', name: 'Receipt Test', mode: 'time', enabled: true, items: [structuredClone(item)] }];
    state.activeScheduleId = 'receipt-test';
    state.schedule = [item];
    state.scheduleRuns = {};
    return state;
  }

  test('marks a schedule run only after playback resolves successfully', async () => {
    const order = [];
    const { runtime, store, mutations } = runtimeHarness({ state: scheduledState() });
    runtime.announce = async () => {
      order.push('playback-completed');
      return true;
    };
    const originalMutate = store.mutate;
    store.mutate = async (...args) => {
      order.push(`mutation:${args[1]}`);
      return await originalMutate(...args);
    };

    await runtime.tickSchedule();

    assert.deepEqual(order, ['mutation:Schedule run claimed', 'playback-completed', 'mutation:Schedule run recorded']);
    const completed = store.state.scheduleRuns['midday-safety'];
    assert.deepEqual(completed, {
      dateKey: '2026-07-06',
      status: 'completed',
      token: completed.token,
      scheduleId: 'receipt-test',
      fingerprint: completed.fingerprint,
      completedAt: MONDAY_1230_CHICAGO,
      receiverId: OWNER_ID,
      sessionId: SESSION_ID
    });
    assert.match(completed.token, /^time-run-/);
    assert.match(completed.fingerprint, /^v1-[a-f0-9]{8}-[a-f0-9]{8}$/);
    assert.equal(runtime.scheduleCompletedLocal.has('midday-safety:2026-07-06'), true);
    assert.equal(mutations.at(-1).options.requireDurable, true);
  });

  test('a Time schedule edit during controlled-source resolution prevents any physical start', async () => {
    const state = scheduledState();
    state.schedules[0].items[0] = {
      ...state.schedules[0].items[0],
      type: 'controlled',
      url: 'https://audio.test/time-controlled.mp3',
      action: { kind: 'controlled', url: 'https://audio.test/time-controlled.mp3' },
      volume: { mode: 'custom', percent: 30 }
    };
    const sourceReached = Promise.withResolvers();
    const releaseSource = Promise.withResolvers();
    const starts = [];
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        musicPlaying: () => false,
        setMusicLevelPercent: () => 30,
        playMusicUrl: async url => starts.push(url)
      }
    });
    runtime.resolveControlledTracks = async () => {
      sourceReached.resolve();
      await releaseSource.promise;
      return {
        tracks: [{ id: 'one', title: 'One', artist: 'Test', audioUrl: 'https://audio.test/resolved.mp3' }],
        playlistName: 'Resolved test source'
      };
    };

    const ticking = runtime.tickSchedule();
    await sourceReached.promise;
    const claim = structuredClone(store.state.scheduleRuns['midday-safety']);
    store.state.scheduleRuns['midday-safety'] = {
      ...claim,
      status: 'completed',
      completedAt: MONDAY_1230_CHICAGO,
      outcome: 'cancelled-by-schedule-change'
    };
    store.state.schedules[0].items[0].label = 'Edited after claim';
    releaseSource.resolve();
    await ticking;

    assert.deepEqual(starts, [], 'a cancelled Time source must never reach the physical audio element');
    assert.equal(store.state.playback.intent, 'stopped');
    assert.equal(store.state.scheduleRuns['midday-safety'].outcome, 'cancelled-by-schedule-change');
  });

  test('a Time schedule edit while Spotify is preparing forces pause and prevents a playback receipt', async () => {
    const state = scheduledState();
    state.schedules[0].items[0] = {
      ...state.schedules[0].items[0],
      type: 'spotify',
      url: 'spotify:track:public-test',
      action: { kind: 'spotify', url: 'spotify:track:public-test' },
      volume: { mode: 'custom', percent: 30 }
    };
    const playReached = Promise.withResolvers();
    const releasePlay = Promise.withResolvers();
    let pauseCalls = 0;
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        musicPlaying: () => false,
        setMusicLevelPercent: () => 30
      },
      spotify: {
        ready: true,
        current: { paused: true },
        loggedIn: () => true,
        play: async (_url, options) => {
          playReached.resolve();
          await releasePlay.promise;
          options.assertCurrent();
          return { state: { isPlaying: true }, volume: { verified: false } };
        },
        pauseForAnnouncement: async () => {
          pauseCalls += 1;
          return { wasPlaying: false };
        }
      }
    });

    const ticking = runtime.tickSchedule();
    await playReached.promise;
    const claim = structuredClone(store.state.scheduleRuns['midday-safety']);
    store.state.scheduleRuns['midday-safety'] = {
      ...claim,
      status: 'completed',
      completedAt: MONDAY_1230_CHICAGO,
      outcome: 'cancelled-by-schedule-change'
    };
    store.state.schedules[0].items[0].url = 'spotify:track:edited-after-claim';
    store.state.schedules[0].items[0].action.url = 'spotify:track:edited-after-claim';
    releasePlay.resolve();
    await ticking;

    assert.ok(pauseCalls >= 1, 'a possibly started Spotify command must be explicitly paused after cancellation');
    assert.notEqual(store.state.playback.intent, 'playing');
    assert.equal(store.state.scheduleRuns['midday-safety'].outcome, 'cancelled-by-schedule-change');
  });

  test('dual Spotify pause failure never restores controlled audio after a cancelled scheduled start', async () => {
    const state = scheduledState();
    state.schedules[0].items[0] = {
      ...state.schedules[0].items[0],
      type: 'spotify',
      url: 'spotify:track:publicTest',
      action: { kind: 'spotify', url: 'spotify:track:publicTest' },
      volume: { mode: 'custom', percent: 30 }
    };
    state.config.musicProvider = 'controlled';
    state.playback = {
      ...state.playback,
      provider: 'controlled',
      intent: 'playing',
      audioUrl: 'https://audio.test/prior-controlled.mp3',
      label: 'Prior controlled bed'
    };
    const playReached = Promise.withResolvers();
    const releasePlay = Promise.withResolvers();
    const calls = [];
    const { runtime, store } = runtimeHarness({
      state,
      audio: {
        currentUrl: 'https://audio.test/prior-controlled.mp3',
        currentLabel: 'Prior controlled bed',
        musicPlaying: () => true,
        setMusicLevelPercent: () => 30,
        pauseMusic: () => { calls.push('controlled-pause'); return true; },
        stopMusic: () => calls.push('controlled-stop'),
        resumeMusic: async () => { calls.push('controlled-resume'); return true; },
        playMusicUrl: async () => calls.push('controlled-play')
      },
      spotify: {
        ready: true,
        current: { paused: false },
        loggedIn: () => true,
        play: async (_url, options) => {
          playReached.resolve();
          await releasePlay.promise;
          options.assertCurrent();
          return { state: { isPlaying: true }, volume: { verified: false } };
        },
        pauseForAnnouncement: async () => {
          calls.push('spotify-confirmed-pause');
          throw new Error('Spotify paused state was not confirmed.');
        },
        pause: async () => {
          calls.push('spotify-fallback-pause');
          throw new Error('Spotify fallback pause also failed.');
        }
      }
    });
    runtime.physicalProvider = 'controlled';

    const ticking = runtime.tickSchedule();
    await playReached.promise;
    const claim = structuredClone(store.state.scheduleRuns['midday-safety']);
    store.state.scheduleRuns['midday-safety'] = {
      ...claim,
      status: 'completed',
      completedAt: MONDAY_1230_CHICAGO,
      outcome: 'cancelled-by-schedule-change'
    };
    store.state.schedules[0].items[0].label = 'Edited after Spotify might have started';
    await assert.rejects(
      runtime.reconcileScheduledPlaybackAuthorization(),
      error => error.code === 'SPOTIFY_PAUSE_UNCONFIRMED' && error.spotifyPauseUnconfirmed === true
    );
    releasePlay.resolve();
    await ticking;

    assert.deepEqual(calls, [
      'controlled-pause',
      'controlled-stop',
      'spotify-confirmed-pause',
      'spotify-fallback-pause',
      'spotify-confirmed-pause',
      'spotify-fallback-pause'
    ]);
    assert.ok(runtime.pendingScheduledPlayback, 'the unresolved cancellation must remain pending for a later retry');
    assert.equal(runtime.physicalProvider, 'spotify', 'the uncertain provider must remain Spotify until silence is confirmed');
    assert.match(store.state.activityLog[0].detail, /no (?:other|another) source was restored.*pause path confirmed silence/i);
  });

  test('live reconciliation durably reports an unconfirmed scheduled Spotify pause', async () => {
    const state = scheduledState();
    state.schedules[0].items[0] = {
      ...state.schedules[0].items[0],
      type: 'spotify',
      url: 'spotify:track:publicTest',
      action: { kind: 'spotify', url: 'spotify:track:publicTest' }
    };
    state.scheduleRuns['midday-safety'] = {
      dateKey: '2026-07-06',
      status: 'completed',
      token: 'cancelled-time-token',
      scheduleId: 'receipt-test',
      fingerprint: 'v1-stale-stale',
      completedAt: MONDAY_1230_CHICAGO,
      receiverId: OWNER_ID,
      sessionId: SESSION_ID,
      outcome: 'cancelled-by-schedule-change'
    };
    const calls = [];
    const { runtime, store, mutations, statuses } = runtimeHarness({
      state,
      audio: { stopMusic: () => calls.push('controlled-stop') },
      spotify: {
        pauseForAnnouncement: async () => {
          calls.push('spotify-confirmed-pause');
          throw new Error('Spotify paused state was not confirmed.');
        },
        pause: async () => {
          calls.push('spotify-fallback-pause');
          return false;
        }
      }
    });
    runtime.pendingScheduledPlayback = {
      token: 'cancelled-time-token',
      itemId: 'midday-safety',
      provider: 'spotify',
      requestId: 41
    };

    await assert.rejects(
      runtime.reconcileScheduledPlaybackAuthorization(),
      error => error.code === 'SPOTIFY_PAUSE_UNCONFIRMED' && error.spotifyPauseUnconfirmed === true
    );

    assert.deepEqual(calls, ['controlled-stop', 'spotify-confirmed-pause', 'spotify-fallback-pause']);
    assert.equal(runtime.pendingScheduledPlayback.requestId, 41);
    assert.equal(runtime.physicalProvider, 'spotify');
    assert.equal(store.state.activityLog[0].title, 'Scheduled Spotify cancellation could not confirm silence');
    assert.equal(mutations.at(-1).reason, 'Scheduled Spotify pause failure recorded');
    assert.equal(mutations.at(-1).options.requireDurable, true);
    assert.equal(statuses.at(-1).ok, false);
  });

  test('a Time schedule edit during voice preparation cancels speech before it begins', async () => {
    const voiceReached = Promise.withResolvers();
    const releaseVoice = Promise.withResolvers();
    const spoken = [];
    let stopVoiceCalls = 0;
    const { runtime, store } = runtimeHarness({
      state: scheduledState(),
      audio: {
        stopVoice: () => { stopVoiceCalls += 1; },
        playVoiceBlob: async () => spoken.push('blob'),
        playDeviceSpeech: async () => spoken.push('device')
      }
    });
    runtime.prepareVoice = async () => {
      voiceReached.resolve();
      await releaseVoice.promise;
      return null;
    };

    const ticking = runtime.tickSchedule();
    await voiceReached.promise;
    const claim = structuredClone(store.state.scheduleRuns['midday-safety']);
    store.state.scheduleRuns['midday-safety'] = {
      ...claim,
      status: 'completed',
      completedAt: MONDAY_1230_CHICAGO,
      outcome: 'cancelled-by-schedule-change'
    };
    store.state.schedules[0].items[0].label = 'Edited while voice prepared';
    await runtime.reconcileScheduledPlaybackAuthorization();
    releaseVoice.resolve();
    await ticking;

    assert.deepEqual(spoken, [], 'cancelled scheduled speech must never reach either voice path');
    assert.ok(stopVoiceCalls >= 1);
    assert.equal(store.state.scheduleRuns['midday-safety'].outcome, 'cancelled-by-schedule-change');
  });

  test('failed playback does not mark scheduleRuns and remains retry eligible', async () => {
    const { runtime, store, mutations, statuses } = runtimeHarness({ state: scheduledState() });
    runtime.announce = async () => {
      throw new Error('speaker unavailable');
    };

    await runtime.tickSchedule();

    assert.deepEqual(store.state.scheduleRuns, {});
    assert.equal(runtime.scheduleCompletedLocal.size, 0);
    assert.deepEqual(mutations.map(entry => entry.reason), ['Schedule run claimed', 'Schedule failure recorded']);
    assert.match(statuses.at(-1).message, /scheduled item failed.*speaker unavailable/i);
  });
});

describe('receiver weather failure state', { concurrency: false }, () => {
  test('failed scans persist unknown status while preserving active lightning and wind', async () => {
    const now = MONDAY_1230_CHICAGO;
    const state = ownerState(now);
    state.weather = {
      ...state.weather,
      status: 'Lightning and wind active',
      checkedAt: now - 60_000,
      lightningActive: true,
      lightningHoldUntil: now + 29 * 60_000,
      lastLightningKey: 'strike-1',
      lastLightningAnnouncementAt: now - 60_000,
      windActive: true,
      lastWindAnnouncementAt: now - 60_000
    };
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse({ error: 'weather providers unavailable' }, 503);
    try {
      const { runtime, store, mutations, statuses } = runtimeHarness({ state, now });

      const result = await runtime.checkWeather({ announce: false, reason: 'test scan' });

      assert.equal(result.payload, null);
      assert.equal(store.state.weather.checkedAt, now);
      assert.match(store.state.weather.status, /weather status is unknown.*weather providers unavailable/i);
      assert.deepEqual(store.state.weather.providerErrors, ['weather providers unavailable']);
      assert.equal(store.state.weather.lightningActive, true);
      assert.equal(store.state.weather.lightningHoldUntil, now + 29 * 60_000);
      assert.equal(store.state.weather.lastLightningKey, 'strike-1');
      assert.equal(store.state.weather.windActive, true);
      assert.deepEqual(result.announcements, []);
      assert.equal(mutations.at(-1).options.requireDurable, true);
      assert.equal(statuses.at(-1).ok, false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('serializes concurrent scans while leaving unspoken lightning retry eligible', async () => {
    const state = ownerState(MONDAY_1230_CHICAGO);
    const firstFetchStarted = Promise.withResolvers();
    const secondFetchStarted = Promise.withResolvers();
    const releaseFirstFetch = Promise.withResolvers();
    const releaseSecondFetch = Promise.withResolvers();
    const payload = {
      ok: true,
      summary: 'Lightning detected within the safety radius.',
      threat: true,
      threatType: 'lightning',
      lightningCoverageKnown: true,
      lightningHits: [{ id: 'same-strike', distanceMI: 3.2, timestamp: MONDAY_1230_CHICAGO }],
      windHits: [],
      providerErrors: []
    };
    const previousFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        firstFetchStarted.resolve();
        await releaseFirstFetch.promise;
      } else if (fetchCalls === 2) {
        secondFetchStarted.resolve();
        await releaseSecondFetch.promise;
      } else {
        throw new Error(`Unexpected weather fetch ${fetchCalls}`);
      }
      return jsonResponse(payload);
    };

    try {
      const { runtime, store } = runtimeHarness({ state, now: MONDAY_1230_CHICAGO });
      const first = runtime.checkWeather({ announce: false, reason: 'first concurrent scan' });
      await firstFetchStarted.promise;

      const second = runtime.checkWeather({ announce: false, reason: 'second concurrent scan' });
      assert.equal(fetchCalls, 1, 'the queued scan must not fetch until the active scan finishes');

      releaseFirstFetch.resolve();
      await secondFetchStarted.promise;
      assert.equal(store.state.weather.lastLightningKey, '', 'an unspoken strike must not be marked announced');
      assert.deepEqual(store.state.weather.pendingAnnouncementIds, ['lightning']);
      releaseSecondFetch.resolve();

      const [firstResult, secondResult] = await Promise.all([first, second]);
      assert.deepEqual(firstResult.announcements, ['lightning']);
      assert.deepEqual(secondResult.announcements, ['lightning'], 'an announce:false scan must not suppress the next eligible warning');
      assert.equal(fetchCalls, 2);
      assert.equal(store.state.weather.lastLightningKey, '');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

describe('CloudStore optimistic concurrency and durability', { concurrency: false }, () => {
  test('an unchanged authoritative poll updates sync metadata without emitting or rewriting local state', async () => {
    const now = Date.now();
    const authoritativeState = { ...createDefaultState(now), revision: 4, marker: 'unchanged' };
    let responseMetadata = { syncMode: 'kv', cloudSync: true };
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse({ state: authoritativeState, ...responseMetadata });
    try {
      const emitted = [];
      const store = new CloudStore({ onState: (state, metadata) => emitted.push({ state, metadata }) });

      await store.fetchRemote();
      assert.equal(emitted.length, 1);
      assert.equal(globalThis.localStorage.setCalls, 1);

      responseMetadata = { syncMode: 'memory', cloudSync: false };
      const fetched = await store.fetchRemote();

      assert.equal(fetched.marker, 'unchanged');
      assert.equal(store.syncMode, 'memory');
      assert.equal(store.cloudSync, false);
      assert.equal(emitted.length, 1, 'unchanged polling must not notify state listeners');
      assert.equal(globalThis.localStorage.setCalls, 1, 'unchanged polling must not rewrite localStorage');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('retries an HTTP 409 from the latest state and advances revision monotonically', async () => {
    const now = Date.now();
    const revisionZero = { ...createDefaultState(now), revision: 0, marker: 0 };
    const conflictState = { ...createDefaultState(now + 1), revision: 1, marker: 10 };
    const savedState = { ...createDefaultState(now + 2), revision: 2, marker: 11 };
    const requests = [];
    let fetchNumber = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const method = options.method || 'GET';
      requests.push({ method, body: options.body ? JSON.parse(options.body) : null });
      fetchNumber += 1;
      if (fetchNumber === 1) return jsonResponse({ state: revisionZero, syncMode: 'kv', cloudSync: true });
      if (fetchNumber === 2) {
        return jsonResponse({
          error: 'revision conflict',
          currentRevision: 1,
          revision: 1,
          state: conflictState
        }, 409);
      }
      if (fetchNumber === 3) return jsonResponse({ state: conflictState, syncMode: 'kv', cloudSync: true });
      if (fetchNumber === 4) return jsonResponse({ state: savedState, syncMode: 'kv', cloudSync: true });
      throw new Error(`Unexpected request ${method} ${url}`);
    };
    try {
      const store = new CloudStore();
      let mutatorCalls = 0;

      const saved = await store.mutate(draft => {
        mutatorCalls += 1;
        draft.marker = Number(draft.marker || 0) + 1;
        return draft;
      }, 'Optimistic test', { requireDurable: true });

      assert.equal(mutatorCalls, 2, 'the mutator must be replayed against the conflict state');
      assert.equal(saved.revision, 2);
      assert.equal(saved.marker, 11);
      assert.equal(store.state.revision, 2);
      assert.deepEqual(
        requests.filter(entry => entry.method === 'POST').map(entry => entry.body.expectedRevision),
        [0, 1]
      );
      assert.deepEqual(
        requests.filter(entry => entry.method === 'POST').map(entry => entry.body.state.marker),
        [1, 11]
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('an older remote read completing last cannot overwrite a newer revision', async () => {
    const now = Date.now();
    const pending = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
    try {
      const store = new CloudStore();
      const older = store.fetchRemote();
      const newer = store.fetchRemote();
      assert.equal(pending.length, 2);

      pending[1](jsonResponse({
        state: { ...createDefaultState(now), revision: 8, marker: 'newer' },
        syncMode: 'kv',
        cloudSync: true
      }));
      await newer;
      pending[0](jsonResponse({
        state: { ...createDefaultState(now - 1), revision: 7, marker: 'older' },
        syncMode: 'kv',
        cloudSync: true
      }));
      await older;

      assert.equal(store.state.revision, 8);
      assert.equal(store.state.marker, 'newer');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('a latest authoritative lower revision replaces a cached higher revision after a KV reset', async () => {
    const now = Date.now();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => jsonResponse({
      state: { ...createDefaultState(now), revision: 0, marker: 'reset' },
      syncMode: 'kv',
      cloudSync: true
    });
    try {
      const store = new CloudStore();
      store.state = { ...createDefaultState(now - 1), revision: 12, marker: 'stale-cache' };

      await store.fetchRemote();

      assert.equal(store.state.revision, 0);
      assert.equal(store.state.marker, 'reset');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('a latest null KV state installs a fresh default and blocks an older in-flight response', async () => {
    const now = Date.now();
    const pending = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
    try {
      const store = new CloudStore();
      store.state = { ...createDefaultState(now - 1), revision: 12, marker: 'stale-cache' };
      const older = store.fetchRemote();
      const reset = store.fetchRemote();

      pending[1](jsonResponse({ state: null, syncMode: 'kv', cloudSync: true }));
      await reset;
      pending[0](jsonResponse({
        state: { ...createDefaultState(now), revision: 12, marker: 'late-old-state' },
        syncMode: 'kv',
        cloudSync: true
      }));
      await older;

      assert.equal(store.state.revision, 0);
      assert.equal(Object.prototype.hasOwnProperty.call(store.state, 'marker'), false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test('requireDurable rejects temporary server memory mode before writing', async () => {
    const requests = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options = {}) => {
      requests.push(options.method || 'GET');
      return jsonResponse({
        state: { ...createDefaultState(Date.now()), revision: 0 },
        syncMode: 'memory',
        cloudSync: false
      });
    };
    try {
      const store = new CloudStore();

      await assert.rejects(
        store.mutate(draft => draft, 'Receiver heartbeat', { requireDurable: true }),
        /durable KV cloud sync is required/i
      );

      assert.deepEqual(requests, ['GET']);
      assert.equal(store.syncMode, 'memory');
      assert.equal(store.durableReady(), false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
