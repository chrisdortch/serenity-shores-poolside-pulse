import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import {
  completeEvent,
  createTargetedEvent,
  createDefaultState,
  makeReceiverLease
} from '../src/vx/core.js';
import { ReceiverRuntime } from '../src/vx/receiver-runtime.js';

const NOW = 1_800_000_000_000;
const DEVICE_ID = 'receipt-receiver';
const SESSION_ID = 'receipt-session';

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
    value: { userAgent: 'Version X receipt test', platform: 'MacIntel', maxTouchPoints: 0 }
  });
});

function makeHarness({ completeWithError = '' } = {}) {
  const state = createDefaultState(NOW);
  state.receiver = makeReceiverLease({ deviceId: DEVICE_ID, sessionId: SESSION_ID }, NOW);
  const store = {
    state,
    now: () => NOW,
    async mutate(mutator) {
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      this.state = result && typeof result === 'object' ? result : draft;
      const pending = this.state.events.find(event => event.status === 'pending');
      if (pending) {
        this.state.events = this.state.events.map(event => event.id === pending.id
          ? completeEvent(event, DEVICE_ID, NOW + 1, completeWithError)
          : event);
      }
      return this.state;
    },
    async fetchRemote() {
      return this.state;
    }
  };
  const statuses = [];
  const runtime = new ReceiverRuntime({
    store,
    audio: {},
    apple: {},
    onStatus: status => statuses.push(status)
  });
  runtime.deviceId = 'remote-command-device';
  runtime.active = false;
  return { runtime, store, statuses };
}

function pendingEvent(id, type, receiver, createdAt, payload = {}) {
  return {
    id,
    type,
    payload,
    targetReceiverId: receiver.id,
    targetSessionId: receiver.sessionId,
    createdAt,
    expiresAt: createdAt + 60_000,
    status: 'pending'
  };
}

describe('Version X command receipts and ordering', { concurrency: false }, () => {
  test('returns only after the speaker Receiver confirms completion', async () => {
    const { runtime, statuses } = makeHarness();

    const event = await runtime.sendCommand('announce', {
      text: 'Pool update',
      label: 'Pool update'
    }, 'Pool update queued.');

    assert.equal(event.status, 'completed');
    assert.equal(event.completedBy, DEVICE_ID);
    assert.equal(statuses.some(entry => /confirmed completion/i.test(entry.message)), true);
  });

  test('surfaces the Receiver failure instead of reporting a false success', async () => {
    const { runtime } = makeHarness({ completeWithError: 'speaker audio was unavailable' });

    await assert.rejects(
      runtime.sendCommand('announce', { text: 'Pool update' }, 'Pool update queued.'),
      /speaker audio was unavailable/i
    );
  });

  test('tolerates a transient receipt refresh failure without inviting a duplicate command', async () => {
    const { runtime, store } = makeHarness();
    let refreshes = 0;
    store.mutate = async function mutate(mutator) {
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      this.state = result && typeof result === 'object' ? result : draft;
      return this.state;
    };
    store.fetchRemote = async function fetchRemote() {
      refreshes += 1;
      if (refreshes === 1) throw new Error('temporary network loss');
      this.state.events = this.state.events.map(event => event.status === 'pending'
        ? completeEvent(event, DEVICE_ID, NOW + 1)
        : event);
      return this.state;
    };

    const event = await runtime.sendCommand('announce', {
      text: 'Pool update',
      label: 'Pool update'
    }, 'Pool update queued.');

    assert.equal(refreshes, 2);
    assert.equal(event.status, 'completed');
  });

  test('forwards manual weather status speech without enabling it for automatic scans', async () => {
    const { runtime } = makeHarness();
    const calls = [];
    runtime.checkWeather = async options => {
      calls.push(options);
      return options;
    };

    await runtime.handleEvent({
      type: 'weather-check',
      payload: { announce: true, announceStatus: true }
    });
    await runtime.handleEvent({
      type: 'weather-check',
      payload: { announce: true }
    });

    assert.equal(calls[0].announceStatus, true);
    assert.equal(calls[1].announceStatus, false);
  });

  test('fails clearly when the targeted Receiver goes offline before its receipt', async () => {
    const { runtime, store } = makeHarness();
    const event = createTargetedEvent('announce', { text: 'Pool update' }, store.state.receiver, NOW + 1);
    store.state.events = [event];
    store.state.receiver = { ...store.state.receiver, status: 'offline', leaseUntil: 0 };

    await assert.rejects(
      runtime.waitForCommandCompletion(event, { timeoutMs: 1, message: 'Pool update' }),
      /went offline before it confirmed/i
    );
  });

  test('rejects a receipt wait when another Receiver replaces the target session', async () => {
    const { runtime, store } = makeHarness();
    const event = createTargetedEvent('announce', { text: 'Pool update' }, store.state.receiver, NOW + 1);
    store.state.events = [event];
    store.state.receiver = makeReceiverLease({
      deviceId: 'replacement-receiver',
      sessionId: 'replacement-session'
    }, NOW);

    await assert.rejects(
      runtime.waitForCommandCompletion(event, { timeoutMs: 1, message: 'Pool update' }),
      /Receiver changed before this command/i
    );
  });

  test('persistent receipt polling failure stays uncertain and warns against repeating', async () => {
    const { runtime, store } = makeHarness();
    const event = createTargetedEvent('announce', { text: 'Pool update' }, store.state.receiver, NOW + 1);
    store.state.events = [event];
    store.fetchRemote = async () => {
      throw new Error('cloud status unavailable');
    };

    await assert.rejects(
      runtime.waitForCommandCompletion(event, { timeoutMs: 1, message: 'Pool update' }),
      /Do not repeat the command/i
    );
  });

  for (const urgentType of ['announce-safety', 'weather-check']) {
    test(`${urgentType} reaches safety preemption while a normal Remote announcement is blocked`, async () => {
      const { runtime, store } = makeHarness();
      runtime.deviceId = DEVICE_ID;
      runtime.sessionId = SESSION_ID;
      runtime.sessionStartedAt = NOW;
      runtime.active = true;
      store.mutate = async function mutate(mutator) {
        const draft = structuredClone(this.state);
        const result = await mutator(draft);
        this.state = result && typeof result === 'object' ? result : draft;
        return this.state;
      };

      const receiver = store.state.receiver;
      const normal = pendingEvent('normal-a', 'announce', receiver, NOW + 1, { text: 'Normal A' });
      store.state.events = [normal];

      const normalStarted = Promise.withResolvers();
      const releaseNormal = Promise.withResolvers();
      const normalCancellation = { cancelled: false };
      const order = [];
      const processEvent = runtime.processEvent.bind(runtime);
      runtime.audio.stopVoice = () => order.push('preempt-normal-a');
      runtime.performAnnouncement = async (message, options) => {
        assert.equal(options.safety, true);
        order.push(`start-${message}`);
        order.push(`end-${message}`);
        return true;
      };
      if (urgentType === 'weather-check') {
        runtime.checkWeather = async () => await runtime.announce('Urgent B', {
          safety: true,
          label: 'Weather safety'
        });
      }
      runtime.processEvent = async event => {
        if (event.id !== normal.id) return await processEvent(event);
        runtime.currentAnnouncement = {
          safety: false,
          cancellation: normalCancellation
        };
        order.push('start-normal-a');
        normalStarted.resolve();
        await releaseNormal.promise;
        order.push('end-normal-a');
        runtime.currentAnnouncement = null;
        return true;
      };

      const normalProcessing = runtime.processPendingEvents();
      await normalStarted.promise;
      const urgent = pendingEvent(
        'urgent-b',
        urgentType,
        receiver,
        NOW + 2,
        urgentType === 'announce-safety' ? { text: 'Urgent B' } : { announce: true }
      );
      store.state.events = [...store.state.events, urgent];

      await runtime.processPendingEvents();

      assert.equal(normalCancellation.cancelled, true);
      assert.equal(normalCancellation.preemptedBySafety, true);
      assert.equal(store.state.events.find(event => event.id === urgent.id)?.status, 'completed');
      assert.deepEqual(order, [
        'start-normal-a',
        'preempt-normal-a',
        'start-Urgent B',
        'end-Urgent B'
      ]);

      releaseNormal.resolve();
      await normalProcessing;
      assert.deepEqual(order, [
        'start-normal-a',
        'preempt-normal-a',
        'start-Urgent B',
        'end-Urgent B',
        'end-normal-a'
      ]);
    });
  }

  test('processes commands from multiple Remotes strictly in order', async () => {
    const { runtime, store } = makeHarness();
    runtime.deviceId = DEVICE_ID;
    runtime.sessionId = SESSION_ID;
    runtime.sessionStartedAt = NOW;
    runtime.active = true;
    const receiver = store.state.receiver;
    store.state.events = [
      pendingEvent('remote-a', 'announce', receiver, NOW + 1, { text: 'First' }),
      pendingEvent('remote-b', 'announce', receiver, NOW + 2, { text: 'Second' })
    ];
    const first = Promise.withResolvers();
    const order = [];
    runtime.processEvent = async event => {
      order.push(`start-${event.id}`);
      if (event.id === 'remote-a') await first.promise;
      order.push(`end-${event.id}`);
      return true;
    };

    const processing = runtime.processPendingEvents();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(order, ['start-remote-a']);
    first.resolve();
    await processing;

    assert.deepEqual(order, [
      'start-remote-a',
      'end-remote-a',
      'start-remote-b',
      'end-remote-b'
    ]);
  });
});
