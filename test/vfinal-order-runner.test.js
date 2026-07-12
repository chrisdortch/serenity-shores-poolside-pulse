import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import {
  createDefaultState,
  makeReceiverLease,
  normalizeNamedSchedule
} from '../src/vfinal/core.js';
import { ReceiverRuntime } from '../src/vfinal/receiver-runtime.js';

const NOW = Date.UTC(2026, 6, 6, 17, 30, 30);
const OWNER_ID = 'order-runner-receiver';
const SESSION_ID = 'order-runner-session';
const SCHEDULE_ID = 'order-rotation';

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

function announcement(id, order, text = `${id} spoken text`) {
  return {
    id,
    label: id,
    enabled: true,
    position: { order },
    action: {
      kind: 'announcement',
      announcementSource: 'inline',
      text
    }
  };
}

function controlled(id, order, advanceMode = 'manual', durationSeconds = 1) {
  return {
    id,
    label: id,
    enabled: true,
    position: { order },
    action: {
      kind: 'controlled',
      url: `https://audio.test/${id}.mp3`
    },
    advance: { mode: advanceMode, durationSeconds }
  };
}

function spotify(id, order, advanceMode = 'manual') {
  return {
    id,
    label: id,
    enabled: true,
    position: { order },
    action: {
      kind: 'spotify',
      url: `https://open.spotify.com/track/${id}`
    },
    advance: { mode: advanceMode }
  };
}

function orderState(items, now = NOW) {
  const state = createDefaultState(now);
  const schedule = normalizeNamedSchedule({
    id: SCHEDULE_ID,
    name: 'Order runner test rotation',
    mode: 'order',
    enabled: true,
    items
  });
  state.receiver = makeReceiverLease({
    deviceId: OWNER_ID,
    sessionId: SESSION_ID,
    name: 'Order runner receiver'
  }, now);
  state.config.weatherAuto = false;
  state.schedules = [schedule];
  state.activeScheduleId = schedule.id;
  state.schedule = [];
  state.sequenceRuns = {};
  return state;
}

function runtimeHarness({ state, now = () => NOW } = {}) {
  const mutations = [];
  const wakeRequests = [];
  const store = {
    state: state || orderState([]),
    now,
    durableReady: () => true,
    async mutate(mutator, reason, options) {
      mutations.push({ reason, options });
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      this.state = result && typeof result === 'object' ? result : draft;
      return this.state;
    }
  };
  const runtime = new ReceiverRuntime({
    store,
    audio: {
      status: () => ({ calibrationActive: false }),
      stopCalibration: () => false,
      stopVoice: () => {},
      stopMusic: () => {},
      pauseMusic: () => false,
      musicPlaying: () => false,
      setMusicLevelPercent: () => 30
    },
    spotify: {
      ready: false,
      loggedIn: () => false,
      pause: async () => false,
      disconnect: () => {},
      setTargetVolumePercent: percent => percent
    }
  });
  runtime.deviceId = OWNER_ID;
  runtime.sessionId = SESSION_ID;
  runtime.sessionStartedAt = NOW;
  runtime.active = true;
  runtime.lastDurableHeartbeatAt = NOW;
  runtime.armLeaseGuard = () => {};
  runtime.armOrderWake = (scheduleId, dueAt) => wakeRequests.push({ scheduleId, dueAt });
  runtime.clearOrderWake = () => {};
  return { runtime, store, mutations, wakeRequests };
}

function request(id, expectedOrder = 0, expectedItemId = '') {
  return {
    id,
    payload: {
      scheduleId: SCHEDULE_ID,
      expectedOrder,
      expectedItemId
    }
  };
}

function setControlledPlayback(store, url, options) {
  store.state.playback = {
    ...store.state.playback,
    provider: 'controlled',
    intent: 'playing',
    audioUrl: url,
    scheduledItemId: String(options.scheduledItemId || ''),
    scheduledRunToken: String(options.scheduledRunToken || ''),
    updatedAt: store.now()
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Node vFinal Order runner', platform: 'test', maxTouchPoints: 0 },
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

describe('receiver-owned Order schedule runner', { concurrency: false }, () => {
  test('keeps the announcement cursor uncommitted until speech resolves, then starts the next item automatically', async () => {
    const firstSpeech = deferred();
    const secondSpeech = deferred();
    const { runtime, store } = runtimeHarness({
      state: orderState([
        announcement('first-announcement', 1),
        announcement('second-announcement', 2)
      ])
    });
    const spoken = [];
    runtime.announce = async text => {
      spoken.push(text);
      return spoken.length === 1 ? firstSpeech.promise : secondSpeech.promise;
    };

    const running = runtime.requestOrderNext(request('announcement-chain'));
    await waitFor(() => spoken.length === 1, 'the first announcement never started');

    let run = store.state.sequenceRuns[SCHEDULE_ID];
    assert.equal(run.order, 0);
    assert.equal(run.status, 'claiming');
    assert.equal(run.active.itemId, 'first-announcement');
    assert.deepEqual(spoken, ['first-announcement spoken text']);

    firstSpeech.resolve(true);
    await waitFor(() => spoken.length === 2, 'the next announcement did not start automatically');

    run = store.state.sequenceRuns[SCHEDULE_ID];
    assert.equal(run.order, 1);
    assert.equal(run.itemId, 'first-announcement');
    assert.equal(run.status, 'claiming');
    assert.equal(run.active.itemId, 'second-announcement');

    secondSpeech.resolve(true);
    await running;

    run = store.state.sequenceRuns[SCHEDULE_ID];
    assert.equal(run.order, 2);
    assert.equal(run.itemId, 'second-announcement');
    assert.equal(run.status, 'complete');
    assert.equal(run.active, null);
  });

  test('records a failed item without moving the committed cursor', async () => {
    const { runtime, store } = runtimeHarness({
      state: orderState([announcement('broken-announcement', 1)])
    });
    runtime.announce = async () => {
      throw new Error('speech engine failed');
    };

    await assert.rejects(
      runtime.requestOrderNext(request('failed-announcement')),
      /speech engine failed/i
    );

    const run = store.state.sequenceRuns[SCHEDULE_ID];
    assert.equal(run.order, 0);
    assert.equal(run.itemId, '');
    assert.equal(run.status, 'failed');
    assert.equal(run.active, null);
    assert.equal(run.lastOutcome, 'failed');
    assert.match(run.lastError, /speech engine failed/i);
  });

  test('commits manual music only after playback start succeeds and then waits', async () => {
    const playbackStart = deferred();
    const { runtime, store } = runtimeHarness({
      state: orderState([
        controlled('manual-one', 1, 'manual'),
        controlled('manual-two', 2, 'manual')
      ])
    });
    const starts = [];
    runtime.playControlled = async (url, options) => {
      starts.push({ url, options });
      await playbackStart.promise;
      setControlledPlayback(store, url, options);
      return true;
    };

    const running = runtime.requestOrderNext(request('manual-start'));
    await waitFor(() => starts.length === 1, 'manual music never reached playback start');

    let run = store.state.sequenceRuns[SCHEDULE_ID];
    assert.equal(run.order, 0);
    assert.equal(run.status, 'claiming');
    assert.equal(run.active.itemId, 'manual-one');

    playbackStart.resolve(true);
    await running;

    run = store.state.sequenceRuns[SCHEDULE_ID];
    assert.equal(run.order, 1);
    assert.equal(run.itemId, 'manual-one');
    assert.equal(run.status, 'waiting-manual');
    assert.equal(run.active, null);
    assert.equal(starts.length, 1, 'manual mode must not start the next item automatically');
  });

  test('an Immediately-after-start item advances, reaches complete, and never wraps', async () => {
    const { runtime, store } = runtimeHarness({
      state: orderState([
        controlled('complete-one', 1, 'complete'),
        controlled('complete-two', 2, 'complete')
      ])
    });
    const starts = [];
    runtime.playControlled = async (url, options) => {
      starts.push({ url, options });
      setControlledPlayback(store, url, options);
      return true;
    };

    await runtime.requestOrderNext(request('complete-chain'));

    const run = store.state.sequenceRuns[SCHEDULE_ID];
    assert.equal(run.order, 2);
    assert.equal(run.itemId, 'complete-two');
    assert.equal(run.status, 'complete');
    assert.deepEqual(starts.map(entry => entry.options.scheduledItemId), ['complete-one', 'complete-two']);

    await assert.rejects(
      runtime.requestOrderNext(request('try-to-wrap', 2, 'complete-two')),
      /schedule is complete/i
    );
    assert.equal(starts.length, 2);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 2);
  });

  test('duration keeps the prior cursor until due, then commits and starts the next item', async () => {
    let clock = NOW;
    const { runtime, store, wakeRequests } = runtimeHarness({
      state: orderState([
        controlled('duration-one', 1, 'duration', 1),
        controlled('after-duration', 2, 'manual')
      ]),
      now: () => clock
    });
    const starts = [];
    runtime.playControlled = async (url, options) => {
      starts.push({ url, options });
      setControlledPlayback(store, url, options);
      return true;
    };

    await runtime.requestOrderNext(request('duration-start'));

    let run = store.state.sequenceRuns[SCHEDULE_ID];
    const dueAt = run.active.dueAt;
    assert.equal(run.order, 0);
    assert.equal(run.status, 'waiting-duration');
    assert.equal(run.active.itemId, 'duration-one');
    assert.equal(dueAt, NOW + 1_000);

    clock = dueAt - 1;
    assert.equal(await runtime.tickOrderSchedule(), false);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 0);
    assert.equal(wakeRequests.at(-1).dueAt, dueAt);

    clock = dueAt;
    assert.equal(await runtime.tickOrderSchedule(), true);

    run = store.state.sequenceRuns[SCHEDULE_ID];
    assert.equal(run.order, 2);
    assert.equal(run.itemId, 'after-duration');
    assert.equal(run.status, 'complete');
    assert.deepEqual(starts.map(entry => entry.options.scheduledItemId), ['duration-one', 'after-duration']);
  });

  test('duration refuses a replaced playback token and leaves its cursor uncommitted', async () => {
    let clock = NOW;
    const { runtime, store } = runtimeHarness({
      state: orderState([controlled('duration-replaced', 1, 'duration', 1)]),
      now: () => clock
    });
    runtime.playControlled = async (url, options) => {
      setControlledPlayback(store, url, options);
      return true;
    };

    await runtime.requestOrderNext(request('duration-replaced-start'));
    const dueAt = store.state.sequenceRuns[SCHEDULE_ID].active.dueAt;
    store.state.playback.scheduledRunToken = 'replacement-token';
    clock = dueAt;

    await assert.rejects(
      runtime.tickOrderSchedule(),
      /stopped or replaced/i
    );

    const run = store.state.sequenceRuns[SCHEDULE_ID];
    assert.equal(run.order, 0);
    assert.equal(run.status, 'failed');
    assert.equal(run.active, null);
    assert.match(run.lastError, /stopped or replaced/i);
  });

  test('direct track-end requires the exact run token and URL, commits once, and ignores mismatches', async () => {
    const { runtime, store } = runtimeHarness({
      state: orderState([controlled('track-end-one', 1, 'track-end')])
    });
    runtime.playControlled = async (url, options) => {
      setControlledPlayback(store, url, options);
      return true;
    };

    await runtime.requestOrderNext(request('track-end-start'));
    const waiting = store.state.sequenceRuns[SCHEDULE_ID];
    const token = waiting.active.token;
    const url = waiting.active.expectedUrl;
    assert.equal(waiting.order, 0);
    assert.equal(waiting.status, 'waiting-track-end');

    assert.equal(await runtime.handleControlledTrackEnded({
      url,
      scheduledRunToken: 'stale-track-token'
    }), false);
    assert.equal(await runtime.handleControlledTrackEnded({
      url: 'https://audio.test/a-different-track.mp3',
      scheduledRunToken: token
    }), false);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 0);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'waiting-track-end');

    assert.equal(await runtime.handleControlledTrackEnded({ url, scheduledRunToken: token }), true);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 1);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'complete');

    assert.equal(await runtime.handleControlledTrackEnded({ url, scheduledRunToken: token }), false);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 1);
  });

  test('rejects Spotify track-end before attempting playback', async () => {
    const { runtime, store } = runtimeHarness({
      state: orderState([spotify('spotify-track-end', 1, 'track-end')])
    });
    let playCalls = 0;
    runtime.playSpotify = async () => {
      playCalls += 1;
      return true;
    };

    await assert.rejects(
      runtime.requestOrderNext(request('spotify-track-end-start')),
      /Spotify does not provide a schedule-safe track-end event/i
    );

    assert.equal(playCalls, 0);
    const run = store.state.sequenceRuns[SCHEDULE_ID];
    assert.equal(run.order, 0);
    assert.equal(run.status, 'failed');
    assert.equal(run.active, null);
  });

  test('duplicate triggers and stale expected cursors cannot double-start an item', async () => {
    const { runtime, store } = runtimeHarness({
      state: orderState([
        controlled('dedupe-one', 1, 'manual'),
        controlled('dedupe-two', 2, 'manual')
      ])
    });
    const starts = [];
    runtime.playControlled = async (url, options) => {
      starts.push({ url, options });
      setControlledPlayback(store, url, options);
      return true;
    };

    await runtime.requestOrderNext(request('dedupe-event'));
    assert.equal(starts.length, 1);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 1);

    assert.equal(await runtime.requestOrderNext(request('dedupe-event')), true);
    assert.equal(starts.length, 1, 'replaying the same event ID must not start the next item');

    await assert.rejects(
      runtime.requestOrderNext(request('stale-cursor-event', 0, '')),
      /Order position changed/i
    );
    assert.equal(starts.length, 1, 'a stale cursor must not start the next item');

    await runtime.requestOrderNext(request('fresh-cursor-event', 1, 'dedupe-one'));
    assert.equal(starts.length, 2);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 2);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'complete');
  });

  test('reset invalidates an active advance gate so its late completion is ignored', async () => {
    const { runtime, store } = runtimeHarness({
      state: orderState([controlled('reset-track-end', 1, 'track-end')])
    });
    runtime.playControlled = async (url, options) => {
      setControlledPlayback(store, url, options);
      return true;
    };

    await runtime.requestOrderNext(request('reset-start'));
    const prior = structuredClone(store.state.sequenceRuns[SCHEDULE_ID].active);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'waiting-track-end');

    await runtime.resetOrderSchedule({
      id: 'reset-event',
      payload: { scheduleId: SCHEDULE_ID }
    });

    const reset = store.state.sequenceRuns[SCHEDULE_ID];
    assert.equal(reset.order, 0);
    assert.equal(reset.itemId, '');
    assert.equal(reset.status, 'idle');
    assert.equal(reset.active, null);
    assert.equal(reset.lastOutcome, 'cancelled');

    assert.equal(await runtime.handleControlledTrackEnded({
      url: prior.expectedUrl,
      scheduledRunToken: prior.token
    }), false);
    assert.equal(await runtime.finishPendingOrderGate(SCHEDULE_ID, prior.token, 'late gate'), false);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 0);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'idle');
  });
});
