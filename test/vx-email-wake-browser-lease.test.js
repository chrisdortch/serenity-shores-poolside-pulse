import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import {
  activateEmailWakeXCommand,
  claimEmailWakeXBrowserExecution,
  claimEmailWakeXCommand,
  emailWakeXExecutionStatus,
  enqueueEmailWakeXCommand,
  releaseEmailWakeXExecution
} from '../api/_email-wake-x.js';
import {
  withEmailWakeBrowserAudioLease
} from '../src/vx/email-wake-client.js';

const NOW = 1_800_000_000_000;
const BROWSER_LEASE_ID =
  'browser-audio-12345678901234567890123456789012';
const COMMAND_ID = 'email-wake-x-browser-lease-command-0001';

function command() {
  return {
    eventId: COMMAND_ID,
    issuedAt: NOW,
    scheduledFor: 0,
    action: 'announce',
    text: 'Pool update'
  };
}

beforeEach(() => {
  delete globalThis.__POOL_SIDE_X_EMAIL_WAKE__;
});

describe('Version X browser and Shortcut audio lease', () => {
  test('browser lease atomically blocks a Shortcut claim until the browser releases it', async () => {
    await enqueueEmailWakeXCommand(command(), {
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    await activateEmailWakeXCommand(COMMAND_ID, {
      env: {},
      now: () => NOW,
      requireDurable: false
    });

    const browser = await claimEmailWakeXBrowserExecution(BROWSER_LEASE_ID, {
      env: {},
      now: () => NOW,
      leaseMs: 120_000,
      requireDurable: false
    });
    assert.equal(browser.acquired, true);
    assert.equal((await emailWakeXExecutionStatus({
      env: {},
      now: () => NOW,
      requireDurable: false
    })).executionEventId, BROWSER_LEASE_ID);

    const blocked = await claimEmailWakeXCommand({
      env: {},
      now: () => NOW + 1,
      requireDurable: false
    });
    assert.equal(blocked.busy, true);
    assert.equal(blocked.item, null);

    await releaseEmailWakeXExecution(BROWSER_LEASE_ID, {
      env: {},
      requireDurable: false
    });
    const claimed = await claimEmailWakeXCommand({
      env: {},
      now: () => NOW + 2,
      requireDurable: false
    });
    assert.equal(claimed.item.eventId, COMMAND_ID);
  });

  test('browser cannot replace an active Shortcut execution and can renew only its own lease', async () => {
    await enqueueEmailWakeXCommand(command(), {
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    await activateEmailWakeXCommand(COMMAND_ID, {
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    const shortcut = await claimEmailWakeXCommand({
      env: {},
      now: () => NOW,
      leaseMs: 60_000,
      requireDurable: false
    });
    assert.equal(shortcut.item.eventId, COMMAND_ID);

    const browser = await claimEmailWakeXBrowserExecution(BROWSER_LEASE_ID, {
      env: {},
      now: () => NOW + 1,
      requireDurable: false
    });
    assert.equal(browser.acquired, false);
    assert.equal(browser.busy, true);
    assert.equal(browser.owner, COMMAND_ID);

    await releaseEmailWakeXExecution(COMMAND_ID, {
      env: {},
      requireDurable: false
    });
    const first = await claimEmailWakeXBrowserExecution(BROWSER_LEASE_ID, {
      env: {},
      now: () => NOW + 2,
      leaseMs: 60_000,
      requireDurable: false
    });
    const renewed = await claimEmailWakeXBrowserExecution(BROWSER_LEASE_ID, {
      env: {},
      now: () => NOW + 10_000,
      leaseMs: 120_000,
      requireDurable: false
    });
    assert.equal(first.acquired, true);
    assert.equal(renewed.acquired, true);
    assert.equal(renewed.leaseUntil, NOW + 130_000);
  });

  test('client wrapper waits for the Shortcut, performs one mutation, and releases its browser lease', async () => {
    const requests = [];
    let claimCount = 0;
    let mutated = false;
    const fetchImpl = async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      const payload = body.action === 'release'
        ? { ok: true, released: true, leaseId: body.leaseId }
        : ++claimCount === 1
          ? { ok: true, acquired: false, busy: true, leaseUntil: NOW + 1_000 }
          : { ok: true, acquired: true, busy: false, leaseId: body.leaseId };
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            return String(name).toLowerCase() === 'content-type'
              ? 'application/json'
              : '';
          }
        },
        async json() {
          return payload;
        }
      };
    };
    let clock = NOW;

    const result = await withEmailWakeBrowserAudioLease(async () => {
      mutated = true;
      return 'done';
    }, {
      fetchImpl,
      now: () => clock,
      waitImpl: async milliseconds => {
        assert.equal(mutated, false);
        clock += milliseconds;
      },
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => {}
    });

    assert.equal(result, 'done');
    assert.equal(mutated, true);
    assert.equal(requests[0].action, 'claim');
    assert.equal(requests[1].action, 'claim');
    assert.equal(requests.at(-1).action, 'release');
    assert.equal(
      requests.every(request => request.leaseId === requests[0].leaseId),
      true
    );
  });
});
