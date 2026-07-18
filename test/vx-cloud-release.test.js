import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CloudStore } from '../src/vx/cloud.js';
import { createDefaultState, makeReceiverLease } from '../src/vx/core.js';

test('CloudStore uses an authenticated pagehide beacon and immediately drops the stale local lease', async () => {
  const now = Date.now();
  const state = createDefaultState(now);
  state.receiver = makeReceiverLease({
    deviceId: 'speaker-device',
    sessionId: 'speaker-session'
  }, now);
  const storage = new Map();
  let beacon = null;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => storage.get(String(key)) ?? null,
      setItem: (key, value) => storage.set(String(key), String(value)),
      removeItem: key => storage.delete(String(key))
    }
  });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { hostname: 'poolside-pulse-x.vercel.app' }
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      sendBeacon(url, body) {
        beacon = { url, body };
        return true;
      }
    }
  });

  const store = new CloudStore();
  store.state = state;
  const result = await store.releaseReceiverSession(state.receiver, { beacon: true });

  assert.equal(result.queued, true);
  assert.equal(beacon.url, '/api/receiver-release-x?v=x');
  assert.deepEqual(JSON.parse(await beacon.body.text()), {
    version: 'x',
    receiverId: 'speaker-device',
    sessionId: 'speaker-session',
    mode: 'pushcut'
  });
  assert.equal(store.state.config.receiverMode, 'pushcut');
  assert.equal(store.state.receiver.status, 'offline');
  assert.equal(store.state.receiver.leaseUntil, 0);
});
