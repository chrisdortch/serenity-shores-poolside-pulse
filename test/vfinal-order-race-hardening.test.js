import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import {
  createDefaultState,
  makeReceiverLease,
  normalizeNamedSchedule
} from '../src/v30/core.js';
import { ReceiverRuntime } from '../src/v30/receiver-runtime.js';

const NOW = Date.UTC(2026, 6, 12, 18, 0, 0);
const OWNER_ID = 'order-race-receiver';
const SESSION_ID = 'order-race-session';
const SCHEDULE_ID = 'order-race-schedule';

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

function announcement(id, order) {
  return {
    id,
    label: id,
    enabled: true,
    position: { order },
    action: {
      kind: 'announcement',
      announcementSource: 'inline',
      text: `${id} spoken text`
    }
  };
}

function controlled(id, order, advanceMode = 'manual', durationSeconds = 30) {
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

function orderState(items) {
  const state = createDefaultState(NOW);
  const schedule = normalizeNamedSchedule({
    id: SCHEDULE_ID,
    name: 'Order race hardening',
    mode: 'order',
    enabled: true,
    items
  });
  state.receiver = makeReceiverLease({
    deviceId: OWNER_ID,
    sessionId: SESSION_ID,
    name: 'Order race receiver'
  }, NOW);
  state.config.weatherAuto = false;
  state.schedules = [schedule];
  state.activeScheduleId = schedule.id;
  state.schedule = [];
  state.sequenceRuns = {};
  return state;
}

function timeState(item) {
  const state = createDefaultState(NOW);
  const schedule = normalizeNamedSchedule({
    id: 'time-race-schedule',
    name: 'Time race hardening',
    mode: 'time',
    enabled: true,
    items: [item]
  });
  state.receiver = makeReceiverLease({
    deviceId: OWNER_ID,
    sessionId: SESSION_ID,
    name: 'Time race receiver'
  }, NOW);
  state.config.weatherAuto = false;
  state.schedules = [schedule];
  state.activeScheduleId = schedule.id;
  state.schedule = [];
  state.scheduleRuns = {};
  return state;
}

function runtimeHarness({ state = orderState([]), now = () => NOW } = {}) {
  const mutations = [];
  const audioCalls = [];
  const store = {
    state,
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
      currentUrl: '',
      currentRunToken: '',
      status: () => ({ calibrationActive: false }),
      stopCalibration: () => false,
      stopVoice: () => {},
      stopMusic: () => audioCalls.push('stopMusic'),
      pauseMusic: () => false,
      musicPlaying: () => false,
      setMusicLevelPercent: () => 30
    },
    spotify: {
      ready: false,
      loggedIn: () => false,
      pause: async () => false,
      pauseForAnnouncement: async () => ({ wasPlaying: false }),
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
  runtime.armOrderWake = () => {};
  runtime.clearOrderWake = () => {};
  return { runtime, store, mutations, audioCalls };
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

function blockMutationAfterDurableInstall(store, blockedReason) {
  const installed = deferred();
  const release = deferred();
  const baseMutate = store.mutate.bind(store);
  let shouldBlock = true;
  store.mutate = async (mutator, reason, options) => {
    if (!shouldBlock || reason !== blockedReason) return await baseMutate(mutator, reason, options);
    shouldBlock = false;
    const draft = structuredClone(store.state);
    const result = await mutator(draft);
    store.state = result && typeof result === 'object' ? result : draft;
    installed.resolve();
    await release.promise;
    return store.state;
  };
  return { installed, release };
}

async function queueTwoSafetyAnnouncements(runtime) {
  const gates = [deferred(), deferred()];
  const started = [];
  runtime.performAnnouncement = async message => {
    const index = started.length;
    started.push(message);
    return await gates[index].promise;
  };
  const first = runtime.announce('First safety message', { safety: true, label: 'First safety' });
  await waitFor(() => started.length === 1, 'the first safety announcement never started');
  const second = runtime.announce('Second safety message', { safety: true, label: 'Second safety' });
  assert.equal(runtime.safetyPendingCount, 2);
  return { gates, started, first, second };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Node vFinal Order race hardening', platform: 'test', maxTouchPoints: 0 },
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

describe('vFinal Order race hardening', { concurrency: false }, () => {
  test('a newer Reset during the first delayed announcement prevents the second announcement', async () => {
    const firstSpeech = deferred();
    const spoken = [];
    const { runtime, store } = runtimeHarness({
      state: orderState([
        announcement('delayed-first', 1),
        announcement('must-not-start', 2)
      ])
    });
    runtime.announce = async text => {
      spoken.push(text);
      if (spoken.length === 1) return await firstSpeech.promise;
      return true;
    };

    const running = runtime.requestOrderNext(request('delayed-announcement-run'));
    await waitFor(() => spoken.length === 1, 'the first Order announcement never started');

    const resetting = runtime.resetOrderSchedule({
      id: 'reset-during-announcement',
      payload: { scheduleId: SCHEDULE_ID }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(spoken, ['delayed-first spoken text']);

    firstSpeech.resolve(true);
    await assert.rejects(running, /newer audio command|cancelled/i);
    await resetting;

    assert.deepEqual(spoken, ['delayed-first spoken text']);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'idle');
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 0);
  });

  test('a delayed Order music claim cannot start after a newer Stop or Play intent', async t => {
    for (const intent of ['stop', 'play']) {
      await t.test(intent, async () => {
        const claimReached = deferred();
        const releaseClaim = deferred();
        const { runtime, store } = runtimeHarness({
          state: orderState([controlled(`scheduled-after-${intent}`, 1)])
        });
        const baseMutate = store.mutate.bind(store);
        let holdClaim = true;
        store.mutate = async (mutator, reason, options) => {
          if (holdClaim && reason === 'Order item claimed') {
            holdClaim = false;
            claimReached.resolve();
            await releaseClaim.promise;
          }
          return await baseMutate(mutator, reason, options);
        };
        const starts = [];
        runtime.playControlled = async (url, options = {}) => {
          starts.push({ url, options });
          return true;
        };
        runtime.stopMusic = async () => true;

        const running = runtime.requestOrderNext(request(`delayed-${intent}-claim`));
        await claimReached.promise;

        if (intent === 'stop') {
          assert.equal(await runtime.processEvent({ id: 'newer-stop', type: 'stop-music', payload: {} }), true);
        } else {
          assert.equal(await runtime.processEvent({
            id: 'newer-play',
            type: 'play-controlled',
            payload: { url: 'https://audio.test/newer-manual-play.mp3' }
          }), true);
        }

        releaseClaim.resolve();
        await assert.rejects(running, /newer audio command|replaced/i);

        const scheduledUrl = `https://audio.test/scheduled-after-${intent}.mp3`;
        assert.equal(starts.some(entry => entry.url === scheduledUrl), false, 'the superseded scheduled source must never start');
        assert.deepEqual(
          starts.map(entry => entry.url),
          intent === 'play' ? ['https://audio.test/newer-manual-play.mp3'] : []
        );
      });
    }
  });

  test('advance-gate mutations are retry-safe when a second callback sees cancellation', async t => {
    for (const method of ['setOrderWaiting', 'completeOrderGate']) {
      await t.test(method, async () => {
        const { runtime, store } = runtimeHarness({
          state: orderState([
            controlled(`retry-${method}`, 1, method === 'setOrderWaiting' ? 'track-end' : 'manual'),
            announcement(`after-${method}`, 2)
          ])
        });
        const generation = runtime.beginExternalAudioIntent('schedule');
        const claim = await runtime.claimOrderItem(SCHEDULE_ID, {
          id: `retry-${method}-token`,
          kind: 'manual',
          expectedOrder: 0,
          expectedItemId: ''
        }, generation);
        assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'claiming');
        runtime.queueSupersededOrderCancellation = () => {};

        let callbackCount = 0;
        store.mutate = async mutator => {
          const firstDraft = structuredClone(store.state);
          await mutator(firstDraft);
          callbackCount += 1;
          runtime.beginExternalAudioIntent('terminal');
          const retryDraft = structuredClone(store.state);
          await mutator(retryDraft);
          callbackCount += 1;
          store.state = retryDraft;
          return store.state;
        };

        const operation = method === 'setOrderWaiting'
          ? runtime.setOrderWaiting(SCHEDULE_ID, claim.token, {
              status: 'waiting-track-end',
              expectedProvider: 'controlled',
              expectedUrl: `https://audio.test/retry-${method}.mp3`,
              externalIntentGeneration: generation
            })
          : runtime.completeOrderGate(
              SCHEDULE_ID,
              claim.token,
              'waiting-manual',
              'retry cancellation test',
              generation
            );

        await assert.rejects(operation, /newer audio command/i);
        assert.equal(callbackCount, 1, 'the second callback must abort before it can commit');
        assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'claiming');
        assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 0);
        assert.equal(store.state.sequenceRuns[SCHEDULE_ID].active.token, claim.token);
      });
    }
  });

  test('an exact Order track-end still commits after a heartbeat records paused intent', async () => {
    const { runtime, store } = runtimeHarness({
      state: orderState([controlled('paused-at-exact-end', 1, 'track-end')])
    });
    runtime.playControlled = async (url, options) => {
      setControlledPlayback(store, url, options);
      return true;
    };

    await runtime.requestOrderNext(request('paused-end-start'));
    const waiting = store.state.sequenceRuns[SCHEDULE_ID];
    store.state.playback.intent = 'paused';

    assert.equal(await runtime.handleControlledTrackEnded({
      url: waiting.active.expectedUrl,
      scheduledRunToken: waiting.active.token
    }), true);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 1);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'complete');
  });

  test('automatic playlist next defers until both queued safety announcements finish', async () => {
    const state = orderState([]);
    state.playback = {
      ...state.playback,
      provider: 'controlled',
      intent: 'playing',
      audioUrl: 'https://audio.test/current.mp3',
      tracks: [
        { audioUrl: 'https://audio.test/current.mp3', title: 'Current' },
        { audioUrl: 'https://audio.test/next.mp3', title: 'Next' }
      ],
      trackIndex: 0
    };
    const { runtime, store } = runtimeHarness({ state });
    const physicalStarts = [];
    runtime.physicalProvider = 'controlled';
    runtime.audio.playMusicUrl = async (url, options) => {
      physicalStarts.push({ url, options });
      return true;
    };
    const originalNextMusic = runtime.nextMusic.bind(runtime);
    const safety = await queueTwoSafetyAnnouncements(runtime);

    assert.equal(await originalNextMusic({
      automatic: true,
      expectedUrl: 'https://audio.test/current.mp3'
    }), false);
    assert.ok(runtime.deferredAutomaticNext);

    safety.gates[0].resolve(true);
    await safety.first;
    await waitFor(() => safety.started.length === 2, 'the second safety announcement never started');
    assert.equal(physicalStarts.length, 0, 'automatic next must remain deferred between safety announcements');
    assert.equal(store.state.playback.audioUrl, 'https://audio.test/current.mp3');

    safety.gates[1].resolve(true);
    await safety.second;
    await waitFor(
      () => store.state.playback.audioUrl === 'https://audio.test/next.mp3',
      'automatic next did not commit its cloud playback receipt after the final safety announcement'
    );
    assert.equal(physicalStarts.length, 1, 'the deferred physical next track must start exactly once');
    assert.equal(physicalStarts[0].url, 'https://audio.test/next.mp3');
    assert.equal(store.state.playback.intent, 'playing');
    assert.equal(store.state.playback.trackIndex, 1);
    assert.equal(runtime.physicalProvider, 'controlled');
    assert.equal(runtime.physicalCommittedRequestId, runtime.physicalRequestId);
  });

  test('an exact Order track-end defers until both queued safety announcements finish', async () => {
    const { runtime, store } = runtimeHarness({
      state: orderState([controlled('safety-deferred-end', 1, 'track-end')])
    });
    runtime.playControlled = async (url, options) => {
      setControlledPlayback(store, url, options);
      return true;
    };
    await runtime.requestOrderNext(request('safety-deferred-start'));
    const waiting = structuredClone(store.state.sequenceRuns[SCHEDULE_ID]);
    const safety = await queueTwoSafetyAnnouncements(runtime);

    assert.equal(await runtime.handleControlledTrackEnded({
      url: waiting.active.expectedUrl,
      scheduledRunToken: waiting.active.token
    }), true);
    assert.ok(runtime.deferredControlledTrackEnd);

    safety.gates[0].resolve(true);
    await safety.first;
    await waitFor(() => safety.started.length === 2, 'the second safety announcement never started');
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 0);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'waiting-track-end');

    safety.gates[1].resolve(true);
    await safety.second;
    await waitFor(
      () => store.state.sequenceRuns[SCHEDULE_ID].status === 'complete',
      'the exact deferred track-end did not commit after the final safety announcement'
    );
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 1);
  });

  test('Reset stops matching scheduled playback before clearing its Order cursor', async () => {
    const { runtime, store } = runtimeHarness({
      state: orderState([controlled('matching-reset-playback', 1, 'track-end')])
    });
    runtime.playControlled = async (url, options) => {
      setControlledPlayback(store, url, options);
      return true;
    };
    await runtime.requestOrderNext(request('matching-reset-start'));
    const prior = structuredClone(store.state.sequenceRuns[SCHEDULE_ID]);
    const stopCalls = [];
    runtime.stopMusic = async options => {
      stopCalls.push(options);
      store.state.playback = {
        ...store.state.playback,
        intent: 'stopped',
        scheduledItemId: '',
        scheduledRunToken: ''
      };
      return true;
    };

    await runtime.resetOrderSchedule({
      id: 'matching-reset',
      payload: { scheduleId: SCHEDULE_ID }
    });

    assert.deepEqual(stopCalls, [{ skipOrderFailure: true }]);
    assert.equal(prior.active.itemId, 'matching-reset-playback');
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'idle');
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 0);
    assert.equal(store.state.playback.intent, 'stopped');
  });

  test('durably installed Order and Time claims are cleaned up when a newer terminal intent arrives before the mutation returns', async t => {
    await t.test('Order claim clears and permits an explicit fresh retry', async () => {
      const { runtime, store } = runtimeHarness({
        state: orderState([controlled('durable-order-claim', 1)])
      });
      const block = blockMutationAfterDurableInstall(store, 'Order item claimed');
      const scheduledStarts = [];
      runtime.playControlled = async (url, options = {}) => {
        scheduledStarts.push({ url, options });
        setControlledPlayback(store, url, options);
        return true;
      };
      runtime.stopMusic = async () => true;

      const running = runtime.requestOrderNext(request('durable-order-event'));
      await block.installed.promise;
      assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'claiming');
      assert.equal(store.state.sequenceRuns[SCHEDULE_ID].active.token, 'durable-order-event');

      assert.equal(await runtime.processEvent({
        id: 'terminal-during-durable-order-claim',
        type: 'stop-music',
        payload: {}
      }), true);
      block.release.resolve();
      await assert.rejects(running, /newer audio command|cancelled|replaced/i);
      await runtime.orderTail;

      const cancelled = store.state.sequenceRuns[SCHEDULE_ID];
      assert.equal(cancelled.status, 'failed');
      assert.equal(cancelled.active, null, 'the durable claim must not remain stuck after supersession');
      assert.equal(cancelled.order, 0);
      assert.equal(scheduledStarts.length, 0, 'the cancelled durable claim must never start playback');

      await runtime.requestOrderNext(request('fresh-order-retry'));
      assert.equal(scheduledStarts.length, 1, 'a fresh explicit request must be able to retry the cleared item');
      assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'complete');
      assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 1);
    });

    await t.test('Time claim records cancellation and cannot replay on a later tick', async () => {
      const item = {
        id: 'durable-time-claim',
        label: 'Durable Time claim',
        enabled: true,
        days: [0],
        position: { time: '13:00', order: 1 },
        action: {
          kind: 'announcement',
          announcementSource: 'inline',
          text: 'This Time item must not speak after a newer stop intent.'
        }
      };
      const { runtime, store } = runtimeHarness({ state: timeState(item) });
      const block = blockMutationAfterDurableInstall(store, 'Schedule run claimed');
      const spoken = [];
      runtime.announce = async text => {
        spoken.push(text);
        return true;
      };
      runtime.stopMusic = async () => true;

      const ticking = runtime.tickSchedule();
      await block.installed.promise;
      assert.equal(store.state.scheduleRuns[item.id].status, 'in-progress');

      assert.equal(await runtime.processEvent({
        id: 'terminal-during-durable-time-claim',
        type: 'stop-music',
        payload: {}
      }), true);
      block.release.resolve();
      await ticking;

      assert.equal(spoken.length, 0);
      assert.equal(store.state.scheduleRuns[item.id].status, 'completed');
      assert.equal(store.state.scheduleRuns[item.id].outcome, 'cancelled-by-newer-audio-intent');

      await runtime.tickSchedule();
      assert.equal(spoken.length, 0, 'a cancelled durable Time claim must not retry later that day');
      assert.equal(store.state.scheduleRuns[item.id].status, 'completed');
    });
  });

  test('Stop Sound Check restores a waiting-duration Order track and leaves its exact gate valid', async () => {
    let clock = NOW;
    const { runtime, store } = runtimeHarness({
      state: orderState([controlled('calibration-duration-bed', 1, 'duration', 1)]),
      now: () => clock
    });
    const runHistory = [];
    const baseMutate = store.mutate.bind(store);
    store.mutate = async (mutator, reason, options) => {
      const result = await baseMutate(mutator, reason, options);
      if (store.state.sequenceRuns[SCHEDULE_ID]) {
        runHistory.push(structuredClone(store.state.sequenceRuns[SCHEDULE_ID]));
      }
      return result;
    };
    runtime.playControlled = async (url, options) => {
      setControlledPlayback(store, url, options);
      runtime.physicalProvider = 'controlled';
      runtime.audio.currentUrl = url;
      runtime.audio.currentRunToken = options.scheduledRunToken;
      return true;
    };

    await runtime.requestOrderNext(request('calibration-duration-start'));
    const armed = structuredClone(store.state.sequenceRuns[SCHEDULE_ID]);
    assert.equal(armed.status, 'waiting-duration');
    assert.equal(store.state.playback.scheduledRunToken, armed.active.token);

    const calibrationStarted = deferred();
    const calibrationGate = deferred();
    const restores = [];
    runtime.audio.musicElement = { currentTime: 12.5 };
    runtime.audio.runCalibration = async () => {
      calibrationStarted.resolve();
      return await calibrationGate.promise;
    };
    runtime.audio.stopCalibration = () => {
      const error = new Error('Sound check stopped by operator.');
      error.name = 'AbortError';
      calibrationGate.reject(error);
      return true;
    };
    runtime.audio.playMusicUrl = async (url, options) => {
      restores.push({ url, options });
      runtime.audio.currentUrl = url;
      runtime.audio.currentRunToken = options.scheduledRunToken;
      return true;
    };

    const calibration = runtime.runCalibration();
    await calibrationStarted.promise;
    assert.equal(runtime.stopCalibration('Operator tapped Stop Sound Check.'), true);
    assert.equal(await calibration, false);
    await runtime.orderTail;

    const restoredGate = store.state.sequenceRuns[SCHEDULE_ID];
    assert.equal(restores.length, 1);
    assert.equal(restores[0].url, store.state.playback.audioUrl);
    assert.equal(restores[0].options.scheduledRunToken, armed.active.token);
    assert.equal(restores[0].options.startAt, 12.5);
    assert.equal(runtime.physicalProvider, 'controlled');
    assert.equal(restoredGate.status, 'waiting-duration');
    assert.equal(restoredGate.active.token, armed.active.token);
    assert.equal(restoredGate.active.itemId, 'calibration-duration-bed');
    assert.equal(store.state.playback.intent, 'playing');
    assert.equal(store.state.playback.scheduledRunToken, armed.active.token);
    assert.equal(runHistory.some(run => run.status === 'failed'), false, 'sound check must never fail the armed Order gate');
    assert.equal(
      runHistory.some(run => run.status === 'waiting-duration' && !run.active),
      false,
      'sound check must never orphan the armed Order gate'
    );

    clock = restoredGate.active.dueAt;
    assert.equal(await runtime.tickOrderSchedule(), true);
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'complete');
    assert.equal(store.state.sequenceRuns[SCHEDULE_ID].order, 1);
  });

  test('a newer Play or Stop cancels active-null auto-pending before tick can claim the next item', async t => {
    for (const intent of ['play', 'stop']) {
      await t.test(intent, async () => {
        const state = orderState([
          announcement('already-committed', 1),
          controlled(`must-not-auto-start-after-${intent}`, 2, 'manual')
        ]);
        state.sequenceRuns[SCHEDULE_ID] = {
          order: 1,
          itemId: 'already-committed',
          status: 'auto-pending',
          active: null,
          lastTriggerId: 'prior-completion',
          lastOutcome: 'committed',
          lastError: '',
          updatedAt: NOW
        };
        const { runtime, store } = runtimeHarness({ state });
        const starts = [];
        runtime.playControlled = async (url, options = {}) => {
          starts.push({ url, options });
          return true;
        };
        runtime.stopMusic = async () => true;

        runtime.beginExternalAudioIntent(intent === 'play' ? 'play' : 'terminal');
        await waitFor(
          () => store.state.sequenceRuns[SCHEDULE_ID].status === 'failed',
          'the newer intent did not durably cancel the active-null continuation'
        );
        await runtime.orderTail;

        assert.equal(store.state.sequenceRuns[SCHEDULE_ID].status, 'failed');
        assert.equal(store.state.sequenceRuns[SCHEDULE_ID].active, null);
        assert.match(store.state.sequenceRuns[SCHEDULE_ID].lastError, /newer audio command/i);
        assert.equal(await runtime.tickOrderSchedule(), false);

        const scheduledUrl = `https://audio.test/must-not-auto-start-after-${intent}.mp3`;
        assert.equal(starts.some(entry => entry.url === scheduledUrl), false);
        assert.equal(
          starts.filter(entry => entry.options.scheduledItemId === `must-not-auto-start-after-${intent}`).length,
          0,
          'the cancelled continuation must produce zero scheduled starts'
        );
      });
    }
  });

  test('an Order claim fingerprint rejects a source edit before playback can start', async () => {
    const { runtime, store } = runtimeHarness({
      state: orderState([controlled('fingerprinted-claim', 1)])
    });
    const generation = runtime.beginExternalAudioIntent('schedule');
    const claim = await runtime.claimOrderItem(SCHEDULE_ID, {
      id: 'fingerprinted-claim-event',
      kind: 'manual',
      expectedOrder: 0,
      expectedItemId: ''
    }, generation);

    assert.match(claim.active.fingerprint, /^v1-[a-f0-9]{8}-[a-f0-9]{8}$/);
    store.state.schedules[0].items[0].action.url = 'https://audio.test/edited-after-claim.mp3';
    assert.throws(
      () => runtime.assertScheduledRunAuthorization(store.state, claim.token, claim.item.id),
      error => error.code === 'SCHEDULE_RUN_CANCELLED'
    );
  });

  test('a post-commit Order bed is stopped when an older client edits its live item', async () => {
    const { runtime, store } = runtimeHarness({
      state: orderState([
        controlled('committed-fingerprint-bed', 1),
        announcement('later-announcement', 2)
      ])
    });
    const generation = runtime.beginExternalAudioIntent('schedule');
    const claim = await runtime.claimOrderItem(SCHEDULE_ID, {
      id: 'committed-fingerprint-event',
      kind: 'manual',
      expectedOrder: 0,
      expectedItemId: ''
    }, generation);
    store.state.playback = {
      ...store.state.playback,
      provider: 'controlled',
      intent: 'playing',
      scheduledItemId: claim.item.id,
      scheduledRunToken: claim.token,
      scheduledFingerprint: claim.active.fingerprint
    };
    await runtime.completeOrderGate(SCHEDULE_ID, claim.token, 'waiting-manual', 'playback start confirmed', generation);
    assert.equal(runtime.scheduledRunAuthorized(store.state, claim.token, claim.item.id), true);
    store.state.sequenceRuns[SCHEDULE_ID] = {
      ...store.state.sequenceRuns[SCHEDULE_ID],
      order: 2,
      itemId: 'later-announcement',
      status: 'complete'
    };
    assert.equal(
      runtime.scheduledRunAuthorized(store.state, claim.token, claim.item.id),
      true,
      'a later announcement receipt must not invalidate the exact prior music bed restored after ducking'
    );

    store.state.schedules[0].items[0].label = 'Edited by stale open schedule tab';
    const stops = [];
    runtime.stopMusic = async options => {
      stops.push(options);
      return true;
    };
    assert.equal(await runtime.reconcileScheduledPlaybackAuthorization(), true);

    assert.deepEqual(stops, [{ skipOrderFailure: true }]);
  });
});
