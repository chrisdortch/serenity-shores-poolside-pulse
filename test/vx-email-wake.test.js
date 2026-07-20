import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, beforeEach, describe, test } from 'node:test';

import { createSessionToken } from '../api/_auth.js';
import {
  activateEmailWakeXCommand,
  authenticateEmailWakeXReceiver,
  cancelEmailWakeX,
  claimEmailWakeXCommand,
  createEmailWakeXPairingCode,
  createSignedEmailWakeXUrl,
  EmailWakeXError,
  emailWakeXExecutionStatus,
  emailWakeXHealth,
  emailWakeXResendIdempotencyKey,
  emailWakeXSetup,
  enqueueEmailWakeXCommand,
  exchangeEmailWakeXPairingCode,
  requeueEmailWakeXCommand,
  removeEmailWakeXCommand,
  sendEmailWakeX
} from '../api/_email-wake-x.js';
import {
  EMAIL_WAKE_X_MAINTENANCE_INTERVAL_DAYS,
  emailWakeXMaintenanceEventId,
  emailWakeXScheduleEventId,
  emailWakeXScheduleSourceFingerprint,
  renewEmailWakeXScheduleIfDue,
  synchronizeEmailWakeXSchedule
} from '../api/_email-wake-schedule-x.js';
import {
  createEmailWakeClaimXHandler,
  emailWakeXClaimRetryEventId,
  emailWakeXMaintenanceRetryWake,
  emailWakeXWatchdogEventId
} from '../api/email-wake-claim-x.js';
import {
  createEmailWakePairXHandler
} from '../api/email-wake-pair-x.js';
import {
  createEmailWakeRegisterXHandler
} from '../api/email-wake-register-x.js';
import {
  createEmailWakeReceiptXHandler,
  emailWakeXDrainEventId
} from '../api/email-wake-receipt-x.js';
import {
  createPushcutXReceipt,
  PushcutXReceiptError
} from '../api/_pushcut-receipts-x.js';
import {
  createEmailWakeXHandler
} from '../api/email-wake-x.js';
import {
  createEmailWakeScheduleXHandler
} from '../api/email-wake-schedule-x.js';
import {
  applyEmailWakeMusicVolume
} from '../src/vx/email-wake-client.js';

const SESSION_SECRET = 'version-x-email-wake-test-session-secret-long-enough';
const NOW = Date.parse('2026-07-19T15:00:00.000Z');
const MANAGED_ENV = [
  'POOL_SIDE_SESSION_SECRET',
  'POOL_SIDE_PIN',
  'POOL_SIDE_X_NAMESPACE',
  'PUSHCUT_PUBLIC_BASE_URL_X',
  'OPENAI_API_KEY',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'RESEND_API_KEY_X',
  'RECEIVER_WAKE_EMAIL_X',
  'RECEIVER_WAKE_FROM_X',
  'RECEIVER_WAKE_SUBJECT_X',
  'VERCEL',
  'VERCEL_URL'
];
const originalEnv = Object.fromEntries(MANAGED_ENV.map(name => [name, process.env[name]]));

function configuredEnv(overrides = {}) {
  return {
    POOL_SIDE_SESSION_SECRET: SESSION_SECRET,
    POOL_SIDE_PIN: '7900',
    OPENAI_API_KEY: 'openai-test-key',
    KV_REST_API_URL: 'https://kv.example.test',
    KV_REST_API_TOKEN: 'kv-test-token',
    RESEND_API_KEY_X: 're_test_key',
    RECEIVER_WAKE_EMAIL_X: 'receiver@example.com',
    RECEIVER_WAKE_FROM_X: 'Poolside Pulse <wake@example.com>',
    RECEIVER_WAKE_SUBJECT_X: 'Poolside Pulse X Wake',
    ...overrides
  };
}

function naturalCommand(eventId, overrides = {}) {
  return {
    schemaVersion: 1,
    version: 'x',
    action: 'announce',
    commandId: eventId,
    eventId,
    issuedAt: NOW,
    source: 'live',
    announcementMode: 'natural-voice',
    announcementProvider: '',
    announcementAudioUrl: '',
    announcementDurationSeconds: 0,
    text: 'Poolside announcement.',
    label: 'Speak Now',
    voice: 'marin',
    instructions: 'Warm and clear.',
    safety: false,
    voicePercent: 100,
    musicPercent: 30,
    resumeMusic: true,
    ...overrides
  };
}

function request(method, url, {
  body = undefined,
  cookie = '',
  token = '',
  origin = 'https://poolside.test',
  host = 'poolside.test'
} = {}) {
  return {
    method,
    url,
    body,
    headers: {
      host,
      origin,
      cookie,
      'x-forwarded-host': host,
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.80',
      'sec-fetch-site': 'same-origin',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    socket: {
      encrypted: true,
      remoteAddress: '203.0.113.80'
    }
  };
}

function response() {
  const chunks = [];
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    end(value = '') {
      chunks.push(Buffer.from(String(value)));
    },
    json() {
      const raw = Buffer.concat(chunks).toString('utf8');
      return raw ? JSON.parse(raw) : null;
    }
  };
}

async function invoke(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

function xCookie() {
  const token = createSessionToken(Date.now(), 'x');
  assert.ok(token);
  return `poolside_vx_session=${encodeURIComponent(token)}`;
}

function installProcessEnv(env = configuredEnv()) {
  for (const name of MANAGED_ENV) delete process.env[name];
  Object.assign(process.env, env);
}

beforeEach(() => {
  installProcessEnv();
  globalThis.__POOL_SIDE_API_RATE_LIMITS__ = new Map();
  globalThis.__POOL_SIDE_X_EMAIL_WAKE__ = undefined;
});

after(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('Version X email wake configuration and pairing', { concurrency: false }, () => {
  test('publishes the exact sender mailbox that iOS Email automation must match', () => {
    assert.deepEqual(emailWakeXSetup(configuredEnv()), {
      wakeSender: 'wake@example.com',
      wakeSubject: 'Poolside Pulse X Wake',
      wakeRecipient: 'receiver@example.com'
    });
  });

  test('reports each missing provider or durable setting without silently falling back', () => {
    const ready = emailWakeXHealth(configuredEnv());
    assert.equal(ready.ready, true);
    assert.equal(ready.transport, 'email-wake-x');
    assert.equal(ready.scheduleHorizonDays, 29);
    assert.deepEqual(ready.configurationIssues, []);

    for (const [name, expectedIssue] of [
      ['KV_REST_API_URL', 'KV_REST_API_URL'],
      ['KV_REST_API_TOKEN', 'KV_REST_API_TOKEN'],
      ['RESEND_API_KEY_X', 'RESEND_API_KEY_X'],
      ['RECEIVER_WAKE_EMAIL_X', 'RECEIVER_WAKE_EMAIL_X'],
      ['RECEIVER_WAKE_FROM_X', 'RECEIVER_WAKE_FROM_X'],
      ['RECEIVER_WAKE_SUBJECT_X', 'RECEIVER_WAKE_SUBJECT_X']
    ]) {
      const env = configuredEnv({ [name]: '' });
      const health = emailWakeXHealth(env);
      assert.equal(health.ready, false, name);
      assert.ok(
        health.configurationIssues.some(issue => issue.includes(expectedIssue)),
        `${name} did not produce an actionable issue`
      );
    }
  });

  test('authenticated status explains nonsecret server setup issues', async () => {
    installProcessEnv(configuredEnv({
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: '',
      RESEND_API_KEY_X: ''
    }));
    const result = await invoke(
      createEmailWakeXHandler(),
      request('GET', '/api/email-wake-x?v=x', { cookie: xCookie() })
    );
    assert.equal(result.statusCode, 200);
    const payload = result.json();
    assert.equal(payload.ready, false);
    assert.equal(payload.operational, false);
    assert.equal(payload.wakeSender, 'wake@example.com');
    assert.equal(payload.wakeRecipient, 'receiver@example.com');
    assert.ok(payload.configurationIssues.some(issue => issue.includes('RESEND_API_KEY_X')));
    assert.ok(payload.configurationIssues.some(issue => issue.includes('KV_REST_API_URL')));
    assert.match(payload.note, /Automatic Receiver setup needs attention/);
  });

  test('exchanges a one-time pairing code, rotates the active receiver, and never stores the raw token', async () => {
    const firstPair = await createEmailWakeXPairingCode({
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    assert.match(firstPair.pairingCode, /^\d{6}$/);
    const first = await exchangeEmailWakeXPairingCode(firstPair.pairingCode, {
      env: {},
      now: () => NOW + 1_000,
      requireDurable: false
    });
    assert.match(first.receiverToken, /^ppxrx_[A-Za-z0-9_-]{40,60}$/);
    assert.equal(await authenticateEmailWakeXReceiver(first.receiverToken, {
      env: {},
      requireDurable: false
    }), true);
    await assert.rejects(
      exchangeEmailWakeXPairingCode(firstPair.pairingCode, {
        env: {},
        now: () => NOW + 2_000,
        requireDurable: false
      }),
      error => error instanceof EmailWakeXError && error.code === 'pairingExpired'
    );

    const secondPair = await createEmailWakeXPairingCode({
      env: {},
      now: () => NOW + 3_000,
      requireDurable: false
    });
    const second = await exchangeEmailWakeXPairingCode(secondPair.pairingCode, {
      env: {},
      now: () => NOW + 4_000,
      requireDurable: false
    });
    assert.equal(await authenticateEmailWakeXReceiver(first.receiverToken, {
      env: {},
      requireDurable: false
    }), false);
    assert.equal(await authenticateEmailWakeXReceiver(second.receiverToken, {
      env: {},
      requireDurable: false
    }), true);
    assert.notEqual(
      globalThis.__POOL_SIDE_X_EMAIL_WAKE__.receiver.tokenHash,
      second.receiverToken
    );
  });

  test('accepts only the latest unexpired six-digit pairing code', async () => {
    const superseded = await createEmailWakeXPairingCode({
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    const latest = await createEmailWakeXPairingCode({
      env: {},
      now: () => NOW + 1,
      requireDurable: false
    });
    await assert.rejects(
      exchangeEmailWakeXPairingCode(superseded.pairingCode, {
        env: {},
        now: () => NOW + 2,
        requireDurable: false
      }),
      error => error instanceof EmailWakeXError && error.code === 'pairingExpired'
    );
    const result = await exchangeEmailWakeXPairingCode(latest.pairingCode, {
      env: {},
      now: () => NOW + 3,
      requireDurable: false
    });
    assert.match(result.receiverToken, /^ppxrx_/);
  });

  test('keeps pairing creation session-authenticated and registration token output one-time', async () => {
    const pairHandler = createEmailWakePairXHandler({
      pairingCodeCreator: async () => ({
        pairingCode: '123456',
        expiresAt: NOW + 600_000,
        durable: true
      })
    });
    const unauthenticated = await invoke(
      pairHandler,
      request('POST', '/api/email-wake-pair-x?v=x')
    );
    assert.equal(unauthenticated.statusCode, 401);
    const paired = await invoke(
      pairHandler,
      request('POST', '/api/email-wake-pair-x?v=x', { cookie: xCookie() })
    );
    assert.equal(paired.statusCode, 201);
    assert.equal(paired.json().code, '123456');

    const registerHandler = createEmailWakeRegisterXHandler({
      pairingAttemptConsumer: async () => ({ allowed: true, remaining: 9 }),
      pairingCodeExchanger: async code => {
        assert.equal(code, '123456');
        return {
          receiverToken: 'ppxrx_test_token_returned_only_in_this_response_123456',
          pairedAt: NOW,
          durable: true
        };
      }
    });
    const registered = await invoke(
      registerHandler,
      request('POST', '/api/email-wake-register-x', {
        body: { code: '123456' }
      })
    );
    assert.equal(registered.statusCode, 201);
    assert.match(registered.json().token, /^ppxrx_/);
  });
});

describe('Version X durable command queue semantics', { concurrency: false }, () => {
  test('keeps failed-send outbox items unclaimable until activation and preserves FIFO order', async () => {
    const first = naturalCommand('email-wake-x-fifo-z');
    const second = naturalCommand('email-wake-x-fifo-a');
    await enqueueEmailWakeXCommand(first, {
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    assert.equal(await claimEmailWakeXCommand({
      env: {},
      now: () => NOW,
      requireDurable: false
    }), null);
    await activateEmailWakeXCommand(first.eventId, {
      env: {},
      now: () => NOW + 10,
      requireDurable: false
    });
    await enqueueEmailWakeXCommand(second, {
      env: {},
      now: () => NOW + 20,
      requireDurable: false
    });
    await activateEmailWakeXCommand(second.eventId, {
      env: {},
      now: () => NOW + 30,
      requireDurable: false
    });
    const claimedFirst = await claimEmailWakeXCommand({
      env: {},
      now: () => NOW + 40,
      requireDurable: false
    });
    assert.equal(claimedFirst.item.eventId, first.eventId);
    const active = await emailWakeXExecutionStatus({
      env: {},
      now: () => NOW + 40,
      requireDurable: false
    });
    assert.equal(active.executionActive, true);
    assert.equal(active.executionEventId, first.eventId);
    const busy = await claimEmailWakeXCommand({
      env: {},
      now: () => NOW + 41,
      requireDurable: false
    });
    assert.equal(busy.busy, true);
    await removeEmailWakeXCommand(first.eventId, {
      env: {},
      requireDurable: false
    });
    assert.equal((await emailWakeXExecutionStatus({
      env: {},
      now: () => NOW + 42,
      requireDurable: false
    })).executionActive, false);
    const claimedSecond = await claimEmailWakeXCommand({
      env: {},
      now: () => NOW + 42,
      requireDurable: false
    });
    assert.equal(claimedSecond.item.eventId, second.eventId);
  });

  test('atomically rolls back only the exact unarmed claim attempt', async () => {
    const queuedCommand = naturalCommand('email-wake-x-watchdog-rollback-0001');
    await enqueueEmailWakeXCommand(queuedCommand, {
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    await activateEmailWakeXCommand(queuedCommand.eventId, {
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    const claimed = await claimEmailWakeXCommand({
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    assert.equal(claimed.item.claimAttempt, 1);

    const stale = await requeueEmailWakeXCommand(
      queuedCommand.eventId,
      2,
      {
        env: {},
        now: () => NOW + 1,
        requireDurable: false
      }
    );
    assert.equal(stale.requeued, false);
    assert.equal(stale.reason, 'stale');
    assert.equal((await emailWakeXExecutionStatus({
      env: {},
      now: () => NOW + 1,
      requireDurable: false
    })).executionActive, true);

    const rolledBack = await requeueEmailWakeXCommand(
      queuedCommand.eventId,
      1,
      {
        env: {},
        now: () => NOW + 2,
        requireDurable: false
      }
    );
    assert.equal(rolledBack.requeued, true);
    assert.equal(rolledBack.item.status, 'queued');
    assert.equal(rolledBack.item.claimAttempt, 0);
    assert.equal((await emailWakeXExecutionStatus({
      env: {},
      now: () => NOW + 2,
      requireDurable: false
    })).executionActive, false);

    const reclaimed = await claimEmailWakeXCommand({
      env: {},
      now: () => NOW + 3,
      requireDurable: false
    });
    assert.equal(reclaimed.item.eventId, queuedCommand.eventId);
    assert.equal(reclaimed.item.claimAttempt, 1);
  });

  test('uses a one-key atomic pending enqueue in the Upstash command-array REST shape', async () => {
    const calls = [];
    const command = naturalCommand('email-wake-x-upstash-shape');
    const fetchImpl = async (_url, options) => {
      const redisCommand = JSON.parse(options.body);
      calls.push(redisCommand);
      const queued = {
        schemaVersion: 1,
        version: 'x',
        transport: 'email-wake-x',
        eventId: command.eventId,
        notBefore: 0,
        status: 'pending',
        queuedAt: NOW,
        readyAt: 0,
        claimedAt: 0,
        claimAttempt: 0,
        leaseUntil: 0,
        expiresAt: NOW + 24 * 60 * 60 * 1000,
        command
      };
      return {
        ok: true,
        async json() {
          return { result: [1, JSON.stringify(queued)] };
        }
      };
    };
    const result = await enqueueEmailWakeXCommand(command, {
      env: configuredEnv(),
      fetchImpl,
      now: () => NOW,
      requireDurable: true
    });
    assert.equal(result.created, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'EVAL');
    assert.equal(calls[0][2], '1');
    assert.match(calls[0][3], /:command:email-wake-x-upstash-shape$/);
    assert.equal(JSON.parse(calls[0][4]).status, 'pending');
    assert.equal(Number(calls[0][5]), 24 * 60 * 60);
  });

  test('does not expose future commands and reclaims an uncompleted lease', async () => {
    const immediate = naturalCommand('email-wake-x-live-0001');
    const future = naturalCommand('email-wake-x-scheduled-0001', {
      source: 'schedule',
      scheduledFor: NOW + 60_000
    });
    await enqueueEmailWakeXCommand(immediate, {
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    await enqueueEmailWakeXCommand(future, {
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    await activateEmailWakeXCommand(immediate.eventId, {
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    await activateEmailWakeXCommand(future.eventId, {
      env: {},
      now: () => NOW,
      requireDurable: false
    });

    const first = await claimEmailWakeXCommand({
      env: {},
      now: () => NOW,
      leaseMs: 30_000,
      requireDurable: false
    });
    assert.equal(first.item.eventId, immediate.eventId);
    assert.equal(first.item.claimAttempt, 1);
    const busy = await claimEmailWakeXCommand({
      env: {},
      now: () => NOW + 10_000,
      leaseMs: 30_000,
      requireDurable: false
    });
    assert.equal(busy.busy, true);

    const reclaimed = await claimEmailWakeXCommand({
      env: {},
      now: () => NOW + 30_001,
      leaseMs: 30_000,
      requireDurable: false
    });
    assert.equal(reclaimed.item.eventId, immediate.eventId);
    assert.equal(reclaimed.item.claimAttempt, 2);
    await removeEmailWakeXCommand(immediate.eventId, {
      env: {},
      requireDurable: false
    });

    assert.equal(await claimEmailWakeXCommand({
      env: {},
      now: () => NOW + 59_999,
      requireDurable: false
    }), null);
    const scheduled = await claimEmailWakeXCommand({
      env: {},
      now: () => NOW + 60_000,
      requireDurable: false
    });
    assert.equal(scheduled.item.eventId, future.eventId);
  });

  test('rejects an event-id collision with different command content', async () => {
    const command = naturalCommand('email-wake-x-conflict-0001');
    const first = await enqueueEmailWakeXCommand(command, {
      env: {},
      now: () => NOW,
      requireDurable: false
    });
    const replay = await enqueueEmailWakeXCommand({
      ...command,
      issuedAt: NOW + 5_000
    }, {
      env: {},
      now: () => NOW + 5_000,
      requireDurable: false
    });
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    await assert.rejects(
      enqueueEmailWakeXCommand({
        ...command,
        text: 'Different content.'
      }, {
        env: {},
        now: () => NOW,
        requireDurable: false
      }),
      error => error instanceof EmailWakeXError && error.code === 'conflict'
    );
  });
});

describe('Version X email-wake namespace isolation', { concurrency: false }, () => {
  test('preserves stable identifiers while isolating every deterministic provider/event hash', async () => {
    const stableEnv = configuredEnv({ POOL_SIDE_X_NAMESPACE: '' });
    const candidateEnv = configuredEnv({
      POOL_SIDE_X_NAMESPACE: 'candidate-receiver'
    });
    const digest = (value, length) => createHash('sha256')
      .update(value)
      .digest('hex')
      .slice(0, length);
    const occurrence = {
      logicalId: 'logical-namespace-0001',
      fingerprint: 'fingerprint-namespace-0001'
    };
    const scheduleLegacyInput =
      `email-wake-x\0${occurrence.logicalId}\0${occurrence.fingerprint}`;
    const stableScheduleId = emailWakeXScheduleEventId(occurrence, stableEnv);
    assert.equal(
      stableScheduleId,
      `email-wake-x-sched-${occurrence.logicalId.slice(0, 20)}-${
        digest(scheduleLegacyInput, 28)
      }`
    );
    assert.notEqual(
      stableScheduleId,
      emailWakeXScheduleEventId(occurrence, candidateEnv)
    );

    const maintenanceFor = NOW + 21 * 24 * 60 * 60 * 1000;
    const stableMaintenanceId = emailWakeXMaintenanceEventId(
      maintenanceFor,
      stableEnv
    );
    assert.equal(
      stableMaintenanceId,
      `email-wake-x-maintenance-${
        digest(`email-wake-x-maintenance\0${maintenanceFor}`, 40)
      }`
    );
    assert.notEqual(
      stableMaintenanceId,
      emailWakeXMaintenanceEventId(maintenanceFor, candidateEnv)
    );

    const eventId = 'email-wake-x-namespace-event-0001';
    const stableWatchdogId = emailWakeXWatchdogEventId(
      eventId,
      1,
      NOW + 300_000,
      stableEnv
    );
    assert.equal(
      stableWatchdogId,
      `email-wake-x-watchdog-${
        digest(`${eventId}\0${1}\0${NOW + 300_000}`, 40)
      }`
    );
    assert.notEqual(
      stableWatchdogId,
      emailWakeXWatchdogEventId(
        eventId,
        1,
        NOW + 300_000,
        candidateEnv
      )
    );

    const stableDrainId = emailWakeXDrainEventId(
      eventId,
      'email-wake-x-next-0001',
      stableEnv
    );
    assert.equal(
      stableDrainId,
      `email-wake-x-drain-${
        digest(`${eventId}\0email-wake-x-next-0001`, 40)
      }`
    );
    assert.notEqual(
      stableDrainId,
      emailWakeXDrainEventId(
        eventId,
        'email-wake-x-next-0001',
        candidateEnv
      )
    );

    const stableRetry = emailWakeXMaintenanceRetryWake(NOW, stableEnv);
    const candidateRetry = emailWakeXMaintenanceRetryWake(NOW, candidateEnv);
    assert.notEqual(stableRetry.eventId, candidateRetry.eventId);
    assert.equal(stableRetry.scheduledFor, candidateRetry.scheduledFor);

    assert.equal(
      emailWakeXResendIdempotencyKey(eventId, stableEnv),
      `poolside-pulse-x-wake-${eventId}`
    );
    assert.equal(
      emailWakeXResendIdempotencyKey(eventId, candidateEnv),
      `poolside-pulse-x-wake-candidate-receiver-${eventId}`
    );

    const source = {
      activeScheduleId: 'schedule-1',
      config: { musicLevel: 30 },
      schedules: []
    };
    assert.notEqual(
      emailWakeXScheduleSourceFingerprint(source, true, stableEnv),
      emailWakeXScheduleSourceFingerprint(source, true, candidateEnv)
    );
    assert.equal(
      emailWakeXScheduleEventId(occurrence, candidateEnv),
      emailWakeXScheduleEventId(occurrence, candidateEnv)
    );

    const providerKeys = [];
    const fetchImpl = async (_url, options) => {
      providerKeys.push(options.headers['Idempotency-Key']);
      return {
        ok: true,
        status: 200,
        async json() {
          return { id: `namespace-email-id-${providerKeys.length}-12345678` };
        }
      };
    };
    await sendEmailWakeX({ eventId }, {
      env: stableEnv,
      fetchImpl,
      now: () => NOW
    });
    await sendEmailWakeX({ eventId }, {
      env: candidateEnv,
      fetchImpl,
      now: () => NOW
    });
    assert.deepEqual(providerKeys, [
      `poolside-pulse-x-wake-${eventId}`,
      `poolside-pulse-x-wake-candidate-receiver-${eventId}`
    ]);
  });
});

describe('Version X Resend transport', { concurrency: false }, () => {
  test('sends only a generic immediate wake and schedules with the documented ISO field', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { id: `email-id-${calls.length}-12345678` };
        }
      };
    };
    const env = configuredEnv();
    const immediate = await sendEmailWakeX({
      eventId: 'email-wake-x-resend-0001'
    }, {
      env,
      fetchImpl,
      now: () => NOW
    });
    assert.equal(immediate.provider, 'resend');
    const immediateBody = JSON.parse(calls[0].options.body);
    assert.deepEqual(immediateBody.to, ['receiver@example.com']);
    assert.equal(immediateBody.subject, 'Poolside Pulse X Wake');
    assert.equal(immediateBody.text, 'Poolside Pulse X receiver wake request.');
    assert.equal(Object.hasOwn(immediateBody, 'scheduled_at'), false);
    assert.doesNotMatch(calls[0].options.body, /Poolside announcement/);
    assert.equal(
      calls[0].options.headers['Idempotency-Key'],
      'poolside-pulse-x-wake-email-wake-x-resend-0001'
    );

    const scheduledFor = NOW + 60_000;
    await sendEmailWakeX({
      eventId: 'email-wake-x-resend-0002',
      scheduledFor
    }, {
      env,
      fetchImpl,
      now: () => NOW
    });
    assert.equal(
      JSON.parse(calls[1].options.body).scheduled_at,
      new Date(scheduledFor).toISOString()
    );

    await cancelEmailWakeX('email-id-2-12345678', {
      env,
      fetchImpl,
      now: () => NOW
    });
    assert.equal(
      calls[2].url,
      'https://api.resend.com/emails/email-id-2-12345678/cancel'
    );
    assert.equal(calls[2].options.method, 'POST');
  });

  test('returns an explicit configuration error and makes no provider call when env is incomplete', async () => {
    let calls = 0;
    await assert.rejects(
      sendEmailWakeX({ eventId: 'email-wake-x-unconfigured-0001' }, {
        env: configuredEnv({ RECEIVER_WAKE_SUBJECT_X: '' }),
        fetchImpl: async () => {
          calls += 1;
          throw new Error('must not run');
        },
        now: () => NOW
      }),
      error => error instanceof EmailWakeXError && error.code === 'notConfigured'
    );
    assert.equal(calls, 0);
  });

  test('classifies non-retryable provider failures and logs only redacted diagnostics', async () => {
    const scenarios = [
      {
        name: 'invalid or revoked API key',
        status: 401,
        payload: {
          message: 'Invalid API key re_live_super-secret for wake@example.com.'
        },
        errorCode: 'providerInvalidApiKey',
        message: /Replace RESEND_API_KEY_X with a valid key/,
        classification: 'invalid_api_key'
      },
      {
        name: 'resend.dev test-sender recipient restriction',
        status: 403,
        payload: {
          message: 'You can only send testing emails to your own email address, owner@example.com. To send to receiver@example.com, verify a domain and change wake@example.com.'
        },
        errorCode: 'providerTestSenderRestricted',
        message: /Use that address for RECEIVER_WAKE_EMAIL_X.*verify a sending domain/i,
        classification: 'test_sender_recipient_restricted'
      },
      {
        name: 'other permission or rejection',
        status: 422,
        payload: {
          message: 'The sender wake@example.com is not permitted to send to receiver@example.com.'
        },
        errorCode: 'providerRejected',
        message: /Verify the sender domain, receiver address, and Resend account permissions/,
        classification: 'permission_or_rejection'
      }
    ];

    for (const [index, scenario] of scenarios.entries()) {
      const diagnostics = [];
      let providerCalls = 0;
      await assert.rejects(
        sendEmailWakeX({
          eventId: `email-wake-x-provider-failure-${index + 1}-0001`
        }, {
          env: configuredEnv({
            RESEND_API_KEY_X: 're_live_super-secret',
            RECEIVER_WAKE_EMAIL_X: 'receiver@example.com',
            RECEIVER_WAKE_FROM_X: 'Poolside Pulse <wake@example.com>'
          }),
          fetchImpl: async () => {
            providerCalls += 1;
            return {
              ok: false,
              status: scenario.status,
              headers: { get: () => null },
              async json() {
                return scenario.payload;
              }
            };
          },
          consoleErrorImpl: entry => diagnostics.push(entry),
          now: () => NOW
        }),
        error =>
          error instanceof EmailWakeXError
          && error.code === scenario.errorCode
          && error.statusCode === 502
          && scenario.message.test(error.message),
        scenario.name
      );
      assert.equal(providerCalls, 1, `${scenario.name} must not be retried`);
      assert.deepEqual(diagnostics, [{
        route: '/emails',
        provider: 'resend',
        httpStatus: scenario.status,
        classification: scenario.classification
      }]);
      assert.deepEqual(
        Object.keys(diagnostics[0]).sort(),
        ['classification', 'httpStatus', 'provider', 'route']
      );
      const serialized = JSON.stringify(diagnostics);
      assert.doesNotMatch(serialized, /re_live_super-secret/);
      assert.doesNotMatch(serialized, /wake@example\.com|receiver@example\.com|owner@example\.com/);
      assert.doesNotMatch(serialized, /invalid api key|verify a domain|not permitted/i);
    }
  });
});

describe('Version X automatic schedule route revision safety', { concurrency: false }, () => {
  const canonicalState = {
    version: 'x',
    config: { musicLevel: 30 },
    announcements: [],
    announcementSources: [],
    schedules: [],
    activeScheduleId: ''
  };

  test('syncs the newest canonical schedule after receiver-only revisions advance', async () => {
    const synchronized = [];
    const handler = createEmailWakeScheduleXHandler({
      manifestStoreFactory: () => ({}),
      stateReader: async () => ({
        revision: 12,
        state: canonicalState,
        durable: true
      }),
      synchronizer: async input => {
        synchronized.push(input);
        return {
          transport: 'email-wake-x',
          enabled: true,
          scheduledCount: 0,
          announcementScheduledCount: 0,
          volumeScheduledCount: 0,
          musicBrowserCount: 0,
          maintenanceScheduled: false,
          warnings: []
        };
      }
    });

    const result = await invoke(
      handler,
      request('POST', '/api/email-wake-schedule-x?v=x', {
        cookie: xCookie(),
        body: { expectedRevision: 11, enabled: true }
      })
    );

    assert.equal(result.statusCode, 200);
    assert.equal(result.json().synchronized, true);
    assert.equal(result.json().stateRevision, 12);
    assert.equal(result.json().revisionAdvanced, true);
    assert.equal(synchronized.length, 1);
    assert.equal(synchronized[0].state, canonicalState);
    assert.equal(synchronized[0].enabled, true);
  });

  test('rejects a browser revision that is ahead of canonical state', async () => {
    let syncCalls = 0;
    const handler = createEmailWakeScheduleXHandler({
      manifestStoreFactory: () => ({}),
      stateReader: async () => ({
        revision: 12,
        state: canonicalState,
        durable: true
      }),
      synchronizer: async () => {
        syncCalls += 1;
        return {};
      }
    });

    const result = await invoke(
      handler,
      request('POST', '/api/email-wake-schedule-x?v=x', {
        cookie: xCookie(),
        body: { expectedRevision: 13, enabled: true }
      })
    );

    assert.equal(result.statusCode, 409);
    assert.equal(result.json().currentRevision, 12);
    assert.match(result.json().error, /ahead of the canonical/i);
    assert.equal(syncCalls, 0);
  });
});

describe('Version X receiver claim and protected command route', { concurrency: false }, () => {
  test('requires the receiver bearer token and returns fresh signed URLs without the private source URL', async () => {
    const command = naturalCommand('email-wake-x-claim-route-0001', {
      announcementMode: 'finite-audio',
      announcementProvider: 'direct',
      announcementAudioUrl: 'https://private.example.test/message.mp3?token=secret',
      announcementDurationSeconds: 12,
      musicPercent: 0
    });
    const updates = [];
    const watchdogs = [];
    let claimAttempt = 1;
    const handler = createEmailWakeClaimXHandler({
      receiverAuthenticator: async token => token === 'valid-token',
      commandClaimer: async () => ({
        item: {
          eventId: command.eventId,
          claimAttempt,
          leaseUntil: NOW + 120_000,
          command
        },
        durable: true
      }),
      receiptReader: async () => ({ status: 'queued' }),
      receiptUpdater: async (eventId, patch) => {
        updates.push({ eventId, patch });
        return { status: 'queued' };
      },
      watchdogWakeSender: async wake => {
        watchdogs.push(wake);
        return { emailId: 'watchdog-email-id-12345678', provider: 'resend' };
      },
      maintenanceRenewer: async () => ({ due: false, renewed: false }),
      maintenanceRetryWakeSender: async () => {
        throw new Error('maintenance retry must not run');
      },
      now: () => NOW
    });
    const unauthorized = await invoke(
      handler,
      request('POST', '/api/email-wake-claim-x')
    );
    assert.equal(unauthorized.statusCode, 401);

    globalThis.__POOL_SIDE_API_RATE_LIMITS__ = new Map();
    const claimed = await invoke(
      handler,
      request('POST', '/api/email-wake-claim-x', { token: 'valid-token' })
    );
    assert.equal(claimed.statusCode, 200);
    const body = claimed.json();
    assert.equal(body.pending, 1);
    assert.equal(body.pendingBoolean, true);
    assert.equal(body.reclaimed, 0);
    assert.equal(body.reclaimedBoolean, false);
    assert.equal(body.transport, 'email-wake-x');
    assert.equal(body.voicePercent, 100);
    assert.equal(body.musicPercent, 0);
    assert.equal(body.musicLevel, 0);
    assert.match(body.audioUrl, /^https:\/\/poolside\.test\/api\/pushcut-audio-x\?/);
    assert.equal(JSON.stringify(body).includes('private.example.test'), false);
    assert.equal(updates[0].patch.providerStatus, 'email_wake_claimed');
    assert.equal(body.watchdogScheduled, true);
    assert.equal(body.watchdogScheduledFor, NOW + 120_000);
    assert.equal(watchdogs.length, 1);
    assert.equal(watchdogs[0].scheduledFor, NOW + 120_000);
    assert.match(watchdogs[0].eventId, /^email-wake-x-watchdog-/);
    assert.notEqual(watchdogs[0].eventId, command.eventId);
    assert.equal(
      updates[1].patch.watchdogEmailId,
      'watchdog-email-id-12345678'
    );
    assert.equal(
      updates[1].patch.watchdogScheduledFor,
      NOW + 120_000
    );

    claimAttempt = 2;
    const reclaimed = await invoke(
      handler,
      request('POST', '/api/email-wake-claim-x', { token: 'valid-token' })
    );
    assert.equal(reclaimed.statusCode, 200);
    assert.equal(reclaimed.json().pending, 1);
    assert.equal(reclaimed.json().reclaimed, 1);
    assert.equal(reclaimed.json().reclaimedBoolean, true);
  });

  test('rolls back an unarmed claim and sends one deterministic retry wake', async () => {
    const command = naturalCommand('email-wake-x-unarmed-rollback-0001');
    const leaseUntil = NOW + 120_000;
    const rollbacks = [];
    const retryWakes = [];
    let receiptReads = 0;
    const handler = createEmailWakeClaimXHandler({
      receiverAuthenticator: async () => true,
      commandClaimer: async () => ({
        item: {
          eventId: command.eventId,
          claimAttempt: 1,
          leaseUntil,
          command
        },
        durable: true
      }),
      commandRequeuer: async (eventId, attempt) => {
        rollbacks.push({ eventId, attempt });
        return { requeued: true, durable: true };
      },
      receiptReader: async () => {
        receiptReads += 1;
        throw new Error('receipt must not be read without an armed watchdog');
      },
      watchdogWakeSender: async () => {
        throw new EmailWakeXError('providerUnavailable');
      },
      claimRetryWakeSender: async wake => {
        retryWakes.push(wake);
        return { emailId: 'claim-retry-email-id-12345678', provider: 'resend' };
      },
      maintenanceRenewer: async () => ({ due: false, renewed: false }),
      now: () => NOW
    });
    const result = await invoke(
      handler,
      request('POST', '/api/email-wake-claim-x', { token: 'receiver-token' })
    );
    assert.equal(result.statusCode, 503);
    assert.equal(result.json().retryPending, true);
    assert.equal(result.json().retryWakeScheduled, true);
    assert.equal(receiptReads, 0);
    assert.deepEqual(rollbacks, [{
      eventId: command.eventId,
      attempt: 1
    }]);
    assert.deepEqual(retryWakes, [{
      eventId: emailWakeXClaimRetryEventId(
        command.eventId,
        1,
        leaseUntil,
        process.env
      )
    }]);
  });

  test('preserves an accepted watchdog when post-claim receipt work fails', async () => {
    const command = naturalCommand('email-wake-x-watchdog-preserved-0001');
    const watchdogs = [];
    const cancelled = [];
    let rollbacks = 0;
    const handler = createEmailWakeClaimXHandler({
      receiverAuthenticator: async () => true,
      commandClaimer: async () => ({
        item: {
          eventId: command.eventId,
          claimAttempt: 1,
          leaseUntil: NOW + 120_000,
          command
        },
        durable: true
      }),
      commandRequeuer: async () => {
        rollbacks += 1;
        return { requeued: true };
      },
      receiptReader: async () => {
        throw new PushcutXReceiptError('unavailable');
      },
      watchdogWakeSender: async wake => {
        watchdogs.push(wake);
        return { emailId: 'watchdog-preserved-id-12345678', provider: 'resend' };
      },
      watchdogWakeCanceller: async emailId => {
        cancelled.push(emailId);
        return true;
      },
      maintenanceRenewer: async () => ({ due: false, renewed: false }),
      now: () => NOW
    });
    const result = await invoke(
      handler,
      request('POST', '/api/email-wake-claim-x', { token: 'receiver-token' })
    );
    assert.equal(result.statusCode, 503);
    assert.equal(watchdogs.length, 1);
    assert.equal(watchdogs[0].scheduledFor, NOW + 120_000);
    assert.equal(rollbacks, 0);
    assert.deepEqual(cancelled, []);
  });

  test('renews a due maintenance horizon through the normal no-command claim path', async () => {
    let stateReads = 0;
    const handler = createEmailWakeClaimXHandler({
      receiverAuthenticator: async token => token === 'valid-token',
      commandClaimer: async () => null,
      maintenanceStateReader: async () => {
        stateReads += 1;
        return { state: {}, revision: 1 };
      },
      maintenanceRenewer: async ({ stateReader }) => {
        await stateReader({ requireDurable: true });
        return { due: true, renewed: true };
      },
      maintenanceRetryWakeSender: async () => {
        throw new Error('retry must not run after successful renewal');
      },
      now: () => NOW
    });
    const result = await invoke(
      handler,
      request('POST', '/api/email-wake-claim-x', { token: 'valid-token' })
    );
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().pending, 0);
    assert.equal(result.json().pendingBoolean, false);
    assert.equal(result.json().maintenanceDue, true);
    assert.equal(result.json().maintenanceRenewed, true);
    assert.equal(result.json().maintenanceRetryScheduled, false);
    assert.equal(stateReads, 1);
  });

  test('schedules one generic idempotent retry wake when unattended renewal fails', async () => {
    const retries = [];
    const handler = createEmailWakeClaimXHandler({
      receiverAuthenticator: async () => true,
      commandClaimer: async () => null,
      maintenanceRenewer: async () => {
        throw new EmailWakeXError('durableUnavailable');
      },
      maintenanceRetryWakeSender: async wake => {
        retries.push(wake);
        return { emailId: 'maintenance-retry-email-id-12345678', provider: 'resend' };
      },
      now: () => NOW
    });
    const result = await invoke(
      handler,
      request('POST', '/api/email-wake-claim-x', { token: 'valid-token' })
    );
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().pending, 0);
    assert.equal(result.json().pendingBoolean, false);
    assert.equal(result.json().maintenanceRetryScheduled, true);
    assert.equal(retries.length, 1);
    assert.match(retries[0].eventId, /^email-wake-x-maintenance-retry-/);
    assert.ok(retries[0].scheduledFor >= NOW + 30 * 60_000);
    assert.ok(retries[0].scheduledFor <= NOW + 35 * 60_000);
    assert.deepEqual(Object.keys(retries[0]).sort(), ['eventId', 'scheduledFor']);
  });

  test('does not resolve or queue an admin command when wake configuration is missing', async () => {
    installProcessEnv(configuredEnv({ RESEND_API_KEY_X: '' }));
    let resolved = 0;
    const handler = createEmailWakeXHandler({
      commandResolver: async () => {
        resolved += 1;
        return naturalCommand('email-wake-x-noop-0001');
      }
    });
    const result = await invoke(
      handler,
      request('POST', '/api/email-wake-x?v=x', {
        cookie: xCookie(),
        body: { ignored: true }
      })
    );
    assert.equal(result.statusCode, 503);
    assert.equal(result.json().queued, false);
    assert.equal(result.json().wakeSent, false);
    assert.equal(resolved, 0);
  });

  test('accepts the exact browser volume envelope and activates its queued receiver command', async () => {
    const eventId = 'email-volume-browser-contract-0001';
    const calls = [];
    let receipt = null;
    const handler = createEmailWakeXHandler({
      commandResolver: async () => {
        throw new Error('A volume envelope must not use the announcement resolver.');
      },
      receiptCreator: async command => {
        calls.push({ type: 'receipt', command: structuredClone(command) });
        receipt = {
          ...command,
          status: 'queued',
          providerStatus: 'created'
        };
        return {
          created: true,
          receipt,
          durable: true
        };
      },
      commandEnqueuer: async command => {
        calls.push({ type: 'enqueue', command: structuredClone(command) });
        return {
          created: true,
          item: { status: 'pending', command },
          durable: true
        };
      },
      wakeSender: async wake => {
        calls.push({ type: 'wake', wake: structuredClone(wake) });
        return {
          emailId: 'volume-browser-email-id-12345678',
          provider: 'resend'
        };
      },
      commandActivator: async activatedEventId => {
        calls.push({ type: 'activate', eventId: activatedEventId });
        return { item: { status: 'queued' }, durable: true };
      },
      receiptUpdater: async (_eventId, patch) => {
        receipt = { ...receipt, ...patch };
        return receipt;
      }
    });
    let browserBody;
    const fetchImpl = async (url, options = {}) => {
      browserBody = JSON.parse(options.body);
      const req = request(options.method, url, {
        cookie: xCookie(),
        body: browserBody
      });
      req.headers['idempotency-key'] = options.headers['Idempotency-Key'];
      const result = await invoke(handler, req);
      return {
        ok: result.statusCode >= 200 && result.statusCode < 300,
        status: result.statusCode,
        headers: {
          get: name => result.getHeader(name)
        },
        async json() {
          return result.json();
        }
      };
    };

    const dispatched = await applyEmailWakeMusicVolume({
      eventId,
      musicPercent: 37,
      fetchImpl
    });

    assert.deepEqual(browserBody, {
      version: 'x',
      action: 'volume',
      eventId,
      source: 'live',
      musicPercent: 37
    });
    assert.equal(dispatched.accepted, true);
    assert.equal(dispatched.queued, true);
    assert.equal(dispatched.wakeSent, true);
    assert.equal(dispatched.eventId, eventId);
    assert.deepEqual(calls.map(call => call.type), [
      'receipt',
      'enqueue',
      'wake',
      'activate'
    ]);
    assert.equal(calls[0].command.version, 'x');
    assert.equal(calls[0].command.action, 'volume');
    assert.equal(calls[0].command.eventId, eventId);
    assert.equal(calls[0].command.source, 'live');
    assert.equal(calls[0].command.musicPercent, 37);
    assert.equal(calls[0].command.resumeMusic, false);
    assert.equal(
      calls[0].command.receiverContract,
      'poolside-pulse-x-wake-v1'
    );
    assert.deepEqual(calls[2].wake, { eventId });
    assert.equal(calls[3].eventId, eventId);

    for (const invalidBody of [
      {
        ...browserBody,
        eventId: 'email-volume-wrong-version-0001',
        version: 'final'
      },
      {
        ...browserBody,
        eventId: 'email-volume-extra-field-0001',
        unexpected: true
      }
    ]) {
      const before = calls.length;
      const rejected = await invoke(
        handler,
        request('POST', '/api/email-wake-x?v=x', {
          cookie: xCookie(),
          body: invalidBody
        })
      );
      assert.equal(rejected.statusCode, 400);
      assert.equal(rejected.json().ok, false);
      assert.equal(calls.length, before);
    }
  });

  test('returns an existing completed command without re-enqueueing or sending another wake', async () => {
    const eventId = 'email-wake-x-completed-replay-0001';
    const downstreamCalls = [];
    const completedReceipt = {
      ...naturalCommand(eventId),
      receiverContract: 'poolside-pulse-x-wake-v1',
      status: 'completed',
      providerMode: 'email-wake-x',
      providerStatus: 'email_wake_receiver_completed',
      completedAt: NOW,
      audioFetchedAt: NOW - 2_000,
      restoreTargetMusicPercent: 30,
      restoreTargetResolvedAt: NOW - 1_000,
      volumeRestored: true,
      restoredMusicPercent: 30,
      musicResumed: true
    };
    const handler = createEmailWakeXHandler({
      commandResolver: async () => naturalCommand(eventId),
      receiptCreator: async () => ({
        receipt: completedReceipt,
        created: false,
        durable: true
      }),
      commandEnqueuer: async () => {
        downstreamCalls.push('enqueue');
        throw new Error('A completed replay must not enqueue.');
      },
      commandActivator: async () => {
        downstreamCalls.push('activate');
        throw new Error('A completed replay must not activate.');
      },
      wakeSender: async () => {
        downstreamCalls.push('wake');
        throw new Error('A completed replay must not send email.');
      },
      receiptUpdater: async () => {
        downstreamCalls.push('update');
        throw new Error('A completed replay must not rewrite its receipt.');
      }
    });
    const result = await invoke(
      handler,
      request('POST', '/api/email-wake-x?v=x', {
        cookie: xCookie(),
        body: { eventId }
      })
    );
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().eventId, eventId);
    assert.equal(result.json().accepted, true);
    assert.equal(result.json().queued, false);
    assert.equal(result.json().wakeSent, false);
    assert.equal(result.json().completed, true);
    assert.equal(result.json().idempotentReplay, true);
    assert.equal(result.json().receipt.status, 'completed');
    assert.deepEqual(downstreamCalls, []);
  });

  test('returns the stable event id and leaves a failed wake send retry-pending without activation', async () => {
    const eventId = 'email-wake-x-retry-outbox-0001';
    let activated = 0;
    const handler = createEmailWakeXHandler({
      commandResolver: async () => naturalCommand(eventId),
      receiptCreator: async command => ({
        receipt: {
          ...command,
          status: 'queued',
          providerStatus: 'created'
        },
        durable: true
      }),
      receiptUpdater: async (_eventId, patch) => ({
        ...naturalCommand(eventId),
        status: 'queued',
        ...patch
      }),
      commandEnqueuer: async command => ({
        created: true,
        item: { status: 'pending', command },
        durable: true
      }),
      commandActivator: async () => {
        activated += 1;
      },
      wakeSender: async () => {
        throw new EmailWakeXError('providerUnavailable');
      }
    });
    const result = await invoke(
      handler,
      request('POST', '/api/email-wake-x?v=x', {
        cookie: xCookie(),
        body: { eventId }
      })
    );
    assert.equal(result.statusCode, 503);
    assert.equal(result.json().eventId, eventId);
    assert.equal(result.json().retryPending, true);
    assert.equal(result.json().wakeSent, false);
    assert.equal(activated, 0);
  });

  test('completion releases the receiver lock and sends one deterministic drain wake', async () => {
    const eventId = 'email-wake-x-volume-receipt-0001';
    const signed = createSignedEmailWakeXUrl(
      request('POST', '/'),
      '/api/email-wake-receipt-x',
      eventId,
      'receipt',
      {
        env: configuredEnv(),
        now: () => NOW,
        ttlSeconds: 30 * 60
      }
    );
    assert.ok(signed);
    const removed = [];
    const wakes = [];
    let stored = {
      ...naturalCommand(eventId, {
        action: 'volume',
        musicPercent: 30,
        resumeMusic: false
      }),
      receiverContract: 'poolside-pulse-x-wake-v1',
      status: 'accepted',
      providerMode: 'email-wake-x',
      providerStatus: 'email_wake_claimed',
      watchdogEmailId: 'watchdog-email-id-12345678'
    };
    const cancelledWatchdogs = [];
    const handler = createEmailWakeReceiptXHandler({
      receiptReader: async () => stored,
      receiptUpdater: async (_eventId, patch) => {
        stored = { ...stored, ...patch };
        return stored;
      },
      latestRepairer: async () => stored,
      commandRemover: async id => {
        removed.push(id);
        return true;
      },
      nextReadyReader: async () => 'email-wake-x-next-ready-0001',
      wakeSender: async wake => {
        wakes.push(wake);
        return { emailId: 'drain-email-id-12345678', provider: 'resend' };
      },
      watchdogWakeCanceller: async emailId => {
        cancelledWatchdogs.push(emailId);
        return true;
      },
      now: () => NOW + 1_000
    });
    const completed = await invoke(
      handler,
      request('POST', new URL(signed.url).pathname + new URL(signed.url).search, {
        body: {
          eventId,
          status: 'completed',
          receiverContract: 'poolside-pulse-x-wake-v1',
          volumeRestored: true,
          restoredMusicPercent: 30,
          musicResumed: false
        }
      })
    );
    assert.equal(completed.statusCode, 200);
    assert.deepEqual(removed, [eventId]);
    assert.equal(wakes.length, 1);
    assert.match(wakes[0].eventId, /^email-wake-x-drain-/);
    assert.deepEqual(
      cancelledWatchdogs,
      ['watchdog-email-id-12345678']
    );
  });

  test('signed verified GET completes an announcement only after audio and restore proof exist', async () => {
    const eventId = 'email-wake-x-verified-get-0001';
    const signed = createSignedEmailWakeXUrl(
      request('GET', '/'),
      '/api/email-wake-receipt-x',
      eventId,
      'receipt',
      {
        env: configuredEnv(),
        now: () => NOW,
        ttlSeconds: 30 * 60,
        executionAttempt: 1
      }
    );
    assert.ok(signed);
    const verifiedUrl = new URL(signed.url);
    const removed = [];
    let stored = {
      ...naturalCommand(eventId),
      receiverContract: 'poolside-pulse-x-wake-v1',
      status: 'timed_out',
      providerMode: 'email-wake-x',
      executionMode: 'announcement',
      executionAttempt: 1,
      audioFetchedAt: NOW + 100,
      restoreTargetMusicPercent: 30,
      restoreTargetResolvedAt: NOW + 200,
      volumeRestored: false,
      restoredMusicPercent: null,
      musicResumed: false
    };
    const handler = createEmailWakeReceiptXHandler({
      receiptReader: async () => stored,
      receiptUpdater: async (_eventId, patch) => {
        stored = { ...stored, ...patch };
        return stored;
      },
      latestRepairer: async () => stored,
      commandRemover: async id => {
        removed.push(id);
        return true;
      },
      nextReadyReader: async () => '',
      watchdogWakeCanceller: async () => true,
      now: () => NOW + 300
    });
    const completed = await invoke(
      handler,
      request('GET', verifiedUrl.pathname + verifiedUrl.search)
    );
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().receipt.status, 'completed');
    assert.equal(completed.json().receipt.volumeRestored, true);
    assert.equal(completed.json().receipt.restoredMusicPercent, 30);
    assert.equal(completed.json().receipt.musicResumed, true);
    assert.deepEqual(removed, [eventId]);

    const replay = await invoke(
      handler,
      request('GET', verifiedUrl.pathname + verifiedUrl.search)
    );
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().receipt.status, 'completed');
    assert.equal(replay.json().receipt.restoredMusicPercent, 30);
  });

  test('signed verified GET cannot complete before the restore target is resolved', async () => {
    const eventId = 'email-wake-x-verified-get-early-0001';
    const signed = createSignedEmailWakeXUrl(
      request('GET', '/'),
      '/api/email-wake-receipt-x',
      eventId,
      'receipt',
      {
        env: configuredEnv(),
        now: () => NOW,
        ttlSeconds: 30 * 60,
        executionAttempt: 1
      }
    );
    assert.ok(signed);
    const verifiedUrl = new URL(signed.url);
    const removed = [];
    const stored = {
      ...naturalCommand(eventId),
      receiverContract: 'poolside-pulse-x-wake-v1',
      status: 'started',
      providerMode: 'email-wake-x',
      executionMode: 'announcement',
      executionAttempt: 1,
      audioFetchedAt: NOW + 100,
      restoreTargetMusicPercent: 30,
      restoreTargetResolvedAt: 0
    };
    const handler = createEmailWakeReceiptXHandler({
      receiptReader: async () => stored,
      commandRemover: async id => {
        removed.push(id);
      },
      nextReadyReader: async () => '',
      watchdogWakeCanceller: async () => true,
      now: () => NOW + 300
    });
    const rejected = await invoke(
      handler,
      request('GET', verifiedUrl.pathname + verifiedUrl.search)
    );
    assert.equal(rejected.statusCode, 409);
    assert.match(
      rejected.json().error,
      /did not prove the requested volume and playback result/i
    );
    assert.deepEqual(removed, []);
  });

  test('signed verified GET derives a volume completion without resuming music', async () => {
    const eventId = 'email-wake-x-verified-volume-get-0001';
    const signed = createSignedEmailWakeXUrl(
      request('GET', '/'),
      '/api/email-wake-receipt-x',
      eventId,
      'receipt',
      {
        env: configuredEnv(),
        now: () => NOW,
        ttlSeconds: 30 * 60,
        executionAttempt: 1
      }
    );
    assert.ok(signed);
    let stored = {
      ...naturalCommand(eventId, {
        action: 'volume',
        musicPercent: 47,
        resumeMusic: false
      }),
      receiverContract: 'poolside-pulse-x-wake-v1',
      status: 'accepted',
      providerMode: 'email-wake-x',
      executionMode: 'volume',
      executionAttempt: 1,
      volumeRestored: false,
      restoredMusicPercent: null,
      musicResumed: false
    };
    const removed = [];
    const handler = createEmailWakeReceiptXHandler({
      receiptReader: async () => stored,
      receiptUpdater: async (_eventId, patch) => {
        stored = { ...stored, ...patch };
        return stored;
      },
      latestRepairer: async () => stored,
      commandRemover: async id => {
        removed.push(id);
      },
      nextReadyReader: async () => '',
      watchdogWakeCanceller: async () => true,
      now: () => NOW + 100
    });
    const verifiedUrl = new URL(signed.url);
    const completed = await invoke(
      handler,
      request('GET', verifiedUrl.pathname + verifiedUrl.search)
    );
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().receipt.status, 'completed');
    assert.equal(completed.json().receipt.volumeRestored, true);
    assert.equal(completed.json().receipt.restoredMusicPercent, 47);
    assert.equal(completed.json().receipt.musicResumed, false);
    assert.deepEqual(removed, [eventId]);
  });

  test('signed verified GET cannot overwrite a conflicting terminal result', async () => {
    const eventId = 'email-wake-x-verified-get-terminal-0001';
    const signed = createSignedEmailWakeXUrl(
      request('GET', '/'),
      '/api/email-wake-receipt-x',
      eventId,
      'receipt',
      {
        env: configuredEnv(),
        now: () => NOW,
        ttlSeconds: 30 * 60,
        executionAttempt: 1
      }
    );
    assert.ok(signed);
    let updates = 0;
    let removed = 0;
    const stored = {
      ...naturalCommand(eventId),
      receiverContract: 'poolside-pulse-x-wake-v1',
      status: 'failed',
      providerMode: 'email-wake-x',
      executionMode: 'announcement',
      executionAttempt: 1,
      audioFetchedAt: NOW + 100,
      restoreTargetMusicPercent: 30,
      restoreTargetResolvedAt: NOW + 200,
      volumeRestored: false,
      restoredMusicPercent: null,
      musicResumed: false
    };
    const handler = createEmailWakeReceiptXHandler({
      receiptReader: async () => stored,
      receiptUpdater: async () => {
        updates += 1;
        return stored;
      },
      commandRemover: async () => {
        removed += 1;
      },
      now: () => NOW + 300
    });
    const signedUrl = new URL(signed.url);
    const rejected = await invoke(
      handler,
      request('GET', signedUrl.pathname + signedUrl.search)
    );
    assert.equal(rejected.statusCode, 409);
    assert.match(rejected.json().error, /different terminal result/i);
    assert.equal(updates, 0);
    assert.equal(removed, 0);
  });

  test('signed verified GET does not drain when a concurrent update wins', async () => {
    const eventId = 'email-wake-x-verified-get-update-race-0001';
    const signed = createSignedEmailWakeXUrl(
      request('GET', '/'),
      '/api/email-wake-receipt-x',
      eventId,
      'receipt',
      {
        env: configuredEnv(),
        now: () => NOW,
        ttlSeconds: 30 * 60,
        executionAttempt: 1
      }
    );
    assert.ok(signed);
    let removed = 0;
    const stored = {
      ...naturalCommand(eventId),
      receiverContract: 'poolside-pulse-x-wake-v1',
      status: 'started',
      providerMode: 'email-wake-x',
      executionMode: 'announcement',
      executionAttempt: 1,
      audioFetchedAt: NOW + 100,
      restoreTargetMusicPercent: 30,
      restoreTargetResolvedAt: NOW + 200,
      volumeRestored: false,
      restoredMusicPercent: null,
      musicResumed: false
    };
    const handler = createEmailWakeReceiptXHandler({
      receiptReader: async () => stored,
      receiptUpdater: async () => ({
        ...stored,
        status: 'failed',
        providerStatus: 'concurrent_failure'
      }),
      commandRemover: async () => {
        removed += 1;
      },
      now: () => NOW + 300
    });
    const signedUrl = new URL(signed.url);
    const rejected = await invoke(
      handler,
      request('GET', signedUrl.pathname + signedUrl.search)
    );
    assert.equal(rejected.statusCode, 409);
    assert.match(rejected.json().error, /could not be recorded/i);
    assert.equal(removed, 0);
  });

  test('signed recovery GET records restoration proof on a prior failed receipt', async () => {
    const eventId = 'email-wake-x-verified-recovery-proof-0001';
    const signed = createSignedEmailWakeXUrl(
      request('GET', '/'),
      '/api/email-wake-receipt-x',
      eventId,
      'receipt',
      {
        env: configuredEnv(),
        now: () => NOW,
        ttlSeconds: 30 * 60,
        executionAttempt: 1
      }
    );
    assert.ok(signed);
    let stored = {
      ...naturalCommand(eventId),
      receiverContract: 'poolside-pulse-x-wake-v1',
      status: 'failed',
      providerMode: 'email-wake-x',
      providerStatus: 'email_wake_receiver_failed',
      executionMode: 'recovery',
      executionAttempt: 1,
      restoreTargetMusicPercent: 30,
      restoreTargetResolvedAt: NOW + 100,
      volumeRestored: false,
      restoredMusicPercent: null,
      musicResumed: false
    };
    const removed = [];
    const handler = createEmailWakeReceiptXHandler({
      receiptReader: async () => stored,
      receiptUpdater: async (_eventId, patch) => {
        stored = { ...stored, ...patch };
        return stored;
      },
      commandRemover: async id => {
        removed.push(id);
      },
      nextReadyReader: async () => '',
      watchdogWakeCanceller: async () => true,
      now: () => NOW + 200
    });
    const signedUrl = new URL(signed.url);
    const completed = await invoke(
      handler,
      request('GET', signedUrl.pathname + signedUrl.search)
    );
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().receipt.status, 'failed');
    assert.equal(completed.json().receipt.providerStatus, 'email_wake_recovery_completed');
    assert.equal(completed.json().receipt.volumeRestored, true);
    assert.equal(completed.json().receipt.restoredMusicPercent, 30);
    assert.equal(completed.json().receipt.musicResumed, true);
    assert.deepEqual(removed, [eventId]);
  });

  test('signed verified GET rejects null and out-of-range server volume targets', async () => {
    const cases = [
      {
        eventId: 'email-wake-x-verified-null-announcement-target-0001',
        stored: {
          ...naturalCommand('email-wake-x-verified-null-announcement-target-0001'),
          action: 'announce',
          executionMode: 'announcement',
          audioFetchedAt: NOW + 100,
          restoreTargetMusicPercent: null,
          restoreTargetResolvedAt: NOW + 200
        }
      },
      {
        eventId: 'email-wake-x-verified-null-volume-target-0001',
        stored: {
          ...naturalCommand('email-wake-x-verified-null-volume-target-0001'),
          action: 'volume',
          executionMode: 'volume',
          musicPercent: null
        }
      },
      {
        eventId: 'email-wake-x-verified-high-volume-target-0001',
        stored: {
          ...naturalCommand('email-wake-x-verified-high-volume-target-0001'),
          action: 'volume',
          executionMode: 'volume',
          musicPercent: 101
        }
      }
    ];
    for (const item of cases) {
      const signed = createSignedEmailWakeXUrl(
        request('GET', '/'),
        '/api/email-wake-receipt-x',
        item.eventId,
        'receipt',
        {
          env: configuredEnv(),
          now: () => NOW,
          ttlSeconds: 30 * 60,
          executionAttempt: 1
        }
      );
      assert.ok(signed);
      let removed = 0;
      const stored = {
        ...item.stored,
        receiverContract: 'poolside-pulse-x-wake-v1',
        status: 'started',
        providerMode: 'email-wake-x',
        executionAttempt: 1
      };
      const handler = createEmailWakeReceiptXHandler({
        receiptReader: async () => stored,
        commandRemover: async () => {
          removed += 1;
        },
        now: () => NOW + 300
      });
      const signedUrl = new URL(signed.url);
      const rejected = await invoke(
        handler,
        request('GET', signedUrl.pathname + signedUrl.search)
      );
      assert.equal(rejected.statusCode, 409, item.eventId);
      assert.match(rejected.json().error, /execution state/i, item.eventId);
      assert.equal(removed, 0, item.eventId);
    }
  });

  test('signed verified GET requires an attempt-bound capability and a known execution mode', async () => {
    const eventId = 'email-wake-x-verified-get-contract-0001';
    const legacy = createSignedEmailWakeXUrl(
      request('GET', '/'),
      '/api/email-wake-receipt-x',
      eventId,
      'receipt',
      {
        env: configuredEnv(),
        now: () => NOW,
        ttlSeconds: 30 * 60
      }
    );
    assert.ok(legacy);
    const stored = {
      ...naturalCommand(eventId),
      receiverContract: 'poolside-pulse-x-wake-v1',
      status: 'started',
      providerMode: 'email-wake-x',
      executionMode: 'unknown',
      executionAttempt: 1,
      audioFetchedAt: NOW + 100,
      restoreTargetMusicPercent: 30,
      restoreTargetResolvedAt: NOW + 200
    };
    const handler = createEmailWakeReceiptXHandler({
      receiptReader: async () => stored,
      now: () => NOW + 300
    });
    const legacyUrl = new URL(legacy.url);
    const unbound = await invoke(
      handler,
      request('GET', legacyUrl.pathname + legacyUrl.search)
    );
    assert.equal(unbound.statusCode, 403);
    assert.match(unbound.json().error, /attempt-bound/i);

    const attemptBound = createSignedEmailWakeXUrl(
      request('GET', '/'),
      '/api/email-wake-receipt-x',
      eventId,
      'receipt',
      {
        env: configuredEnv(),
        now: () => NOW,
        ttlSeconds: 30 * 60,
        executionAttempt: 1
      }
    );
    assert.ok(attemptBound);
    const attemptUrl = new URL(attemptBound.url);
    const invalidMode = await invoke(
      handler,
      request('GET', attemptUrl.pathname + attemptUrl.search)
    );
    assert.equal(invalidMode.statusCode, 409);
    assert.match(invalidMode.json().error, /execution state/i);
  });

  test('keeps the current watchdog when the next-command drain wake is rejected', async () => {
    const eventId = 'email-wake-x-drain-retry-safety-0001';
    const signed = createSignedEmailWakeXUrl(
      request('POST', '/'),
      '/api/email-wake-receipt-x',
      eventId,
      'receipt',
      {
        env: configuredEnv(),
        now: () => NOW,
        ttlSeconds: 30 * 60
      }
    );
    let stored = {
      ...naturalCommand(eventId, {
        action: 'volume',
        musicPercent: 30,
        resumeMusic: false
      }),
      receiverContract: 'poolside-pulse-x-wake-v1',
      status: 'accepted',
      providerMode: 'email-wake-x',
      providerStatus: 'email_wake_claimed',
      watchdogEmailId: 'watchdog-drain-retry-id-12345678'
    };
    const removed = [];
    const cancelled = [];
    const handler = createEmailWakeReceiptXHandler({
      receiptReader: async () => stored,
      receiptUpdater: async (_eventId, patch) => {
        stored = { ...stored, ...patch };
        return stored;
      },
      commandRemover: async id => {
        removed.push(id);
        return true;
      },
      nextReadyReader: async () => 'email-wake-x-drain-next-0001',
      wakeSender: async () => {
        throw new EmailWakeXError('providerUnavailable');
      },
      watchdogWakeCanceller: async emailId => {
        cancelled.push(emailId);
        return true;
      },
      now: () => NOW + 1_000
    });
    const completed = await invoke(
      handler,
      request('POST', new URL(signed.url).pathname + new URL(signed.url).search, {
        body: {
          eventId,
          status: 'completed',
          receiverContract: 'poolside-pulse-x-wake-v1',
          volumeRestored: true,
          restoredMusicPercent: 30,
          musicResumed: false
        }
      })
    );
    assert.equal(completed.statusCode, 503);
    assert.deepEqual(removed, [eventId]);
    assert.deepEqual(cancelled, []);
  });
});

describe('Version X email schedule manifest', { concurrency: false }, () => {
  test('uses a stable source fingerprint that ignores receiver heartbeats but changes schedule delivery inputs', () => {
    const state = {
      activeScheduleId: 'schedule-1',
      config: {
        musicLevel: 30,
        lightningRadiusMiles: 10,
        lightningHoldMinutes: 30
      },
      announcements: [{ id: 'welcome', text: 'Welcome.' }],
      announcementSources: [{ id: 'natural-voice', voice: 'marin' }],
      schedules: [{ id: 'schedule-1', mode: 'time', enabled: true, items: [] }],
      receiver: { status: 'online', lastSeen: NOW },
      revision: 10
    };
    const first = emailWakeXScheduleSourceFingerprint(state, true);
    const heartbeatOnly = emailWakeXScheduleSourceFingerprint({
      ...state,
      receiver: { status: 'online', lastSeen: NOW + 30_000 },
      revision: 11
    }, true);
    const changedVolume = emailWakeXScheduleSourceFingerprint({
      ...state,
      config: { ...state.config, musicLevel: 45 }
    }, true);
    const disabled = emailWakeXScheduleSourceFingerprint(state, false);

    assert.equal(first, heartbeatOnly);
    assert.notEqual(first, changedVolume);
    assert.notEqual(first, disabled);
  });

  test('only invokes canonical schedule renewal when the checkpointed maintenance wake is due', async () => {
    let maintenanceStatus = 'scheduled';
    let maintenanceScheduledFor = NOW + 60_000;
    const manifestStore = {
      durable: true,
      async read() {
        return {
          maintenance: {
            status: maintenanceStatus,
            scheduledFor: maintenanceScheduledFor,
            eventId: 'email-wake-x-maintenance-due-test',
            emailId: 'maintenance-due-email-id-12345678'
          },
          occurrences: {}
        };
      }
    };
    const calls = [];
    const stateReader = async options => {
      calls.push({ type: 'state', options });
      return { state: { schedules: [] }, revision: 8 };
    };
    const synchronizer = async (input, options) => {
      calls.push({ type: 'sync', input, options });
      return {
        maintenanceScheduled: 1,
        maintenanceScheduledFor:
          NOW + EMAIL_WAKE_X_MAINTENANCE_INTERVAL_DAYS * 24 * 60 * 60 * 1000
      };
    };
    const early = await renewEmailWakeXScheduleIfDue({
      env: configuredEnv(),
      now: () => NOW - 10 * 60_000,
      manifestStore,
      stateReader,
      synchronizer
    });
    assert.equal(early.due, false);
    assert.equal(calls.length, 0);

    const due = await renewEmailWakeXScheduleIfDue({
      env: configuredEnv(),
      now: () => NOW,
      manifestStore,
      stateReader,
      synchronizer
    });
    assert.equal(due.due, true);
    assert.equal(due.renewed, true);
    assert.equal(calls[0].type, 'state');
    assert.equal(calls[0].options.requireDurable, true);
    assert.equal(calls[1].type, 'sync');
    assert.equal(
      calls[1].options.maintenanceTriggerEventId,
      'email-wake-x-maintenance-due-test'
    );
    assert.equal(calls[1].input.enabled, true);

    calls.length = 0;
    maintenanceStatus = 'scheduling';
    maintenanceScheduledFor =
      NOW + EMAIL_WAKE_X_MAINTENANCE_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
    const checkpointRetry = await renewEmailWakeXScheduleIfDue({
      env: configuredEnv(),
      now: () => NOW,
      manifestStore,
      stateReader,
      synchronizer
    });
    assert.equal(checkpointRetry.due, true);
    assert.equal(checkpointRetry.renewed, true);
    assert.equal(calls[0].type, 'state');
    assert.equal(calls[1].type, 'sync');
  });

  test('serializes a due maintenance replacement and ignores a stale concurrent trigger', async () => {
    const logicalId = 'logical-maintenance-race-0001';
    const occurrence = {
      logicalId,
      fingerprint: 'fingerprint-maintenance-race-0001',
      scheduleId: 'schedule-1',
      itemId: 'item-1',
      scheduledFor: NOW + 60_000,
      announcementMode: 'natural-voice',
      announcementProvider: '',
      announcementAudioUrl: '',
      announcementDurationSeconds: 0,
      text: 'Maintenance race message.',
      label: 'Scheduled message',
      voice: 'marin',
      instructions: 'Warm and clear.',
      voicePercent: 100,
      musicPercent: 30
    };
    const oldEventId = 'email-wake-x-maintenance-old-race';
    let manifest = {
      schemaVersion: 1,
      version: 'x',
      transport: 'email-wake-x',
      syncedAt: NOW - 1,
      horizonEnd: NOW + 29 * 24 * 60 * 60 * 1000,
      stateRevision: 1,
      warnings: [],
      occurrences: {
        [logicalId]: {
          ...occurrence,
          eventId: `email-wake-x-sched-${logicalId.slice(0, 20)}-${
            '0'.repeat(28)
          }`,
          emailId: 'announcement-email-id-12345678',
          status: 'scheduled'
        }
      },
      maintenance: {
        eventId: oldEventId,
        emailId: 'old-maintenance-email-id-12345678',
        scheduledFor: NOW,
        status: 'scheduled',
        updatedAt: NOW - 1
      }
    };
    const manifestStore = {
      durable: true,
      async withLock(operation) { return await operation(); },
      async read() { return structuredClone(manifest); },
      async write(next) {
        manifest = structuredClone(next);
        return structuredClone(manifest);
      }
    };
    const maintenanceSent = [];
    const maintenanceCancelled = [];
    const options = {
      env: configuredEnv(),
      now: () => NOW,
      manifestStore,
      planner: () => ({
        horizonEnd: NOW + 29 * 24 * 60 * 60 * 1000,
        stateRevision: 2,
        warnings: [],
        occurrences: [occurrence]
      }),
      createReceipt: async command => ({
        receipt: { eventId: command.eventId },
        durable: true
      }),
      updateReceipt: async () => ({}),
      enqueueCommand: async command => ({
        created: true,
        item: { command },
        durable: true
      }),
      activateCommand: async () => ({ item: {}, durable: true }),
      removeCommand: async () => true,
      sendWake: async () => ({
        emailId: 'replacement-announcement-email-id-12345678',
        provider: 'resend'
      }),
      cancelWake: async () => true,
      sendMaintenanceWake: async wake => {
        maintenanceSent.push(wake);
        return { emailId: 'new-maintenance-email-id-12345678', provider: 'resend' };
      },
      cancelMaintenanceWake: async emailId => {
        maintenanceCancelled.push(emailId);
        return true;
      },
      wait: async () => {}
    };
    const renewed = await synchronizeEmailWakeXSchedule({ state: {} }, {
      ...options,
      maintenanceTriggerEventId: oldEventId
    });
    const newEventId = manifest.maintenance.eventId;
    assert.equal(renewed.maintenanceScheduled, 1);
    assert.equal(renewed.maintenanceCancelled, 1);
    assert.notEqual(newEventId, oldEventId);
    assert.deepEqual(
      maintenanceCancelled,
      ['old-maintenance-email-id-12345678']
    );
    assert.equal(maintenanceSent.length, 1);

    const staleReplay = await synchronizeEmailWakeXSchedule({ state: {} }, {
      ...options,
      maintenanceTriggerEventId: oldEventId
    });
    assert.equal(staleReplay.maintenanceScheduled, 0);
    assert.equal(staleReplay.maintenanceUnchanged, 1);
    assert.equal(manifest.maintenance.eventId, newEventId);
    assert.equal(maintenanceSent.length, 1);
    assert.equal(maintenanceCancelled.length, 1);
  });

  test('checkpoints a failed provider send and idempotently resumes the same scheduled event', async () => {
    let manifest = {
      schemaVersion: 1,
      version: 'x',
      transport: 'email-wake-x',
      syncedAt: 0,
      horizonEnd: 0,
      stateRevision: 0,
      warnings: [],
      occurrences: {}
    };
    const manifestStore = {
      durable: true,
      async withLock(operation) { return await operation(); },
      async read() { return structuredClone(manifest); },
      async write(next) {
        manifest = structuredClone(next);
        return structuredClone(manifest);
      }
    };
    const occurrence = {
      logicalId: 'logical-resume-0001',
      fingerprint: 'fingerprint-resume-0001',
      scheduleId: 'schedule-1',
      itemId: 'item-1',
      scheduledFor: NOW + 60_000,
      announcementMode: 'natural-voice',
      announcementProvider: '',
      announcementAudioUrl: '',
      announcementDurationSeconds: 0,
      text: 'Resume this scheduled message.',
      label: 'Scheduled message',
      voice: 'marin',
      instructions: 'Warm and clear.',
      voicePercent: 100,
      musicPercent: 30
    };
    const eventIds = [];
    let sendAttempts = 0;
    let activations = 0;
    const options = {
      env: configuredEnv(),
      now: () => NOW,
      manifestStore,
      planner: () => ({
        horizonEnd: NOW + 29 * 24 * 60 * 60 * 1000,
        stateRevision: 7,
        warnings: [],
        occurrences: [occurrence]
      }),
      createReceipt: async command => {
        eventIds.push(command.eventId);
        return { receipt: { eventId: command.eventId }, durable: true };
      },
      updateReceipt: async () => ({}),
      enqueueCommand: async command => ({
        created: sendAttempts === 0,
        item: { command },
        durable: true
      }),
      activateCommand: async () => {
        activations += 1;
        return { item: {}, durable: true };
      },
      sendWake: async () => {
        sendAttempts += 1;
        if (sendAttempts === 1) throw new EmailWakeXError('providerUnavailable');
        return { emailId: 'resumed-email-id-12345678', provider: 'resend' };
      },
      sendMaintenanceWake: async () => ({
        emailId: 'resumed-maintenance-email-id-12345678',
        provider: 'resend'
      }),
      cancelWake: async () => true,
      cancelMaintenanceWake: async () => true,
      removeCommand: async () => true
    };
    await assert.rejects(
      synchronizeEmailWakeXSchedule({ state: {} }, options),
      error => error instanceof EmailWakeXError && error.code === 'providerUnavailable'
    );
    assert.equal(Object.values(manifest.occurrences)[0].status, 'scheduling');
    assert.equal(activations, 0);
    const resumed = await synchronizeEmailWakeXSchedule({ state: {} }, options);
    assert.equal(resumed.scheduled, 1);
    assert.equal(resumed.scheduledCount, 1);
    assert.equal(activations, 1);
    assert.equal(eventIds.length, 2);
    assert.equal(eventIds[0], eventIds[1]);
    assert.equal(Object.values(manifest.occurrences)[0].status, 'scheduled');
    assert.equal(resumed.maintenanceScheduled, 1);
    assert.equal(manifest.maintenance.status, 'scheduled');
  });

  test('schedules, preserves, then cancels a 29-day occurrence without Pushcut identifiers', async () => {
    let manifest = {
      schemaVersion: 1,
      version: 'x',
      transport: 'email-wake-x',
      syncedAt: 0,
      horizonEnd: 0,
      stateRevision: 0,
      warnings: [],
      occurrences: {}
    };
    const manifestStore = {
      durable: true,
      async withLock(operation) { return await operation(); },
      async read() { return structuredClone(manifest); },
      async write(next) {
        manifest = structuredClone(next);
        return structuredClone(manifest);
      }
    };
    const occurrence = {
      logicalId: 'logical-email-wake-0001',
      fingerprint: 'fingerprint-email-wake-0001',
      scheduleId: 'schedule-1',
      itemId: 'item-1',
      scheduledFor: NOW + 60_000,
      announcementMode: 'natural-voice',
      announcementProvider: '',
      announcementAudioUrl: '',
      announcementDurationSeconds: 0,
      text: 'Scheduled pool message.',
      label: 'Scheduled message',
      voice: 'marin',
      instructions: 'Warm and clear.',
      voicePercent: 100,
      musicPercent: 30
    };
    let desired = [occurrence];
    const receipts = [];
    const queued = [];
    const sent = [];
    const cancelled = [];
    const maintenanceSent = [];
    const maintenanceCancelled = [];
    const removed = [];
    const planner = () => ({
      horizonEnd: NOW + 29 * 24 * 60 * 60 * 1000,
      stateRevision: 7,
      warnings: [],
      occurrences: desired
    });
    const options = {
      env: configuredEnv(),
      now: () => NOW,
      manifestStore,
      planner,
      createReceipt: async command => {
        receipts.push(command);
        return { receipt: { eventId: command.eventId }, durable: true };
      },
      updateReceipt: async () => ({}),
      enqueueCommand: async command => {
        queued.push(command);
        return { created: true, item: { command }, durable: true };
      },
      activateCommand: async () => ({ item: {}, durable: true }),
      removeCommand: async eventId => {
        removed.push(eventId);
        return true;
      },
      sendWake: async wake => {
        sent.push(wake);
        return { emailId: 'scheduled-email-id-12345678', provider: 'resend' };
      },
      sendMaintenanceWake: async wake => {
        maintenanceSent.push(wake);
        return { emailId: 'maintenance-email-id-12345678', provider: 'resend' };
      },
      cancelWake: async emailId => {
        cancelled.push(emailId);
        return true;
      },
      cancelMaintenanceWake: async emailId => {
        maintenanceCancelled.push(emailId);
        return true;
      }
    };

    const first = await synchronizeEmailWakeXSchedule({
      state: { schedules: [], activeScheduleId: 'ignored' }
    }, options);
    assert.equal(first.scheduled, 1);
    assert.equal(first.unchanged, 0);
    assert.equal(first.scheduledCount, 1);
    assert.equal(receipts.length, 1);
    assert.equal(queued.length, 1);
    assert.equal(sent.length, 1);
    assert.equal(first.maintenanceScheduled, 1);
    assert.equal(maintenanceSent.length, 1);
    assert.equal(
      maintenanceSent[0].scheduledFor,
      NOW + EMAIL_WAKE_X_MAINTENANCE_INTERVAL_DAYS * 24 * 60 * 60 * 1000
    );
    assert.match(maintenanceSent[0].eventId, /^email-wake-x-maintenance-/);
    assert.deepEqual(
      Object.keys(maintenanceSent[0]).sort(),
      ['eventId', 'scheduledFor']
    );
    assert.match(receipts[0].eventId, /^email-wake-x-sched-/);
    assert.doesNotMatch(receipts[0].eventId, /pushcut/);
    assert.equal(sent[0].scheduledFor, occurrence.scheduledFor);

    const second = await synchronizeEmailWakeXSchedule({
      state: { schedules: [], activeScheduleId: 'ignored' }
    }, options);
    assert.equal(second.scheduled, 0);
    assert.equal(second.unchanged, 1);
    assert.equal(second.maintenanceUnchanged, 1);
    assert.equal(sent.length, 1);
    assert.equal(maintenanceSent.length, 1);

    desired = [];
    const third = await synchronizeEmailWakeXSchedule({
      state: { schedules: [], activeScheduleId: 'ignored' }
    }, options);
    assert.equal(third.cancelled, 1);
    assert.equal(third.scheduledCount, 0);
    assert.equal(third.maintenanceCancelled, 1);
    assert.equal(third.maintenanceScheduledFor, 0);
    assert.deepEqual(cancelled, ['scheduled-email-id-12345678']);
    assert.deepEqual(maintenanceCancelled, ['maintenance-email-id-12345678']);
    assert.equal(removed.length, 1);
  });

  test('turns a planned quiet-hours occurrence into a zero-volume Shortcut command', async () => {
    let manifest = {
      schemaVersion: 1,
      version: 'x',
      transport: 'email-wake-x',
      syncedAt: 0,
      horizonEnd: 0,
      stateRevision: 0,
      warnings: [],
      occurrences: {}
    };
    const manifestStore = {
      durable: true,
      async withLock(operation) { return await operation(); },
      async read() { return structuredClone(manifest); },
      async write(next) {
        manifest = structuredClone(next);
        return structuredClone(manifest);
      }
    };
    const queued = [];
    const result = await synchronizeEmailWakeXSchedule({
      state: {
        activeScheduleId: 'daily',
        schedules: [{
          id: 'daily',
          mode: 'time',
          enabled: true,
          items: [{
            id: 'quiet-hours',
            enabled: true,
            action: { kind: 'stop' }
          }]
        }]
      }
    }, {
      env: configuredEnv(),
      now: () => NOW,
      manifestStore,
      planner: (_state, options) => {
        assert.equal(options.includeStops, true);
        return {
          horizonEnd: NOW + 29 * 24 * 60 * 60 * 1000,
          stateRevision: 8,
          warnings: [],
          occurrences: [{
            logicalId: 'logical-quiet-hours-0001',
            fingerprint: 'fingerprint-quiet-hours-0001',
            scheduleId: 'daily',
            itemId: 'quiet-hours',
            action: 'volume',
            scheduledFor: NOW + 60_000,
            label: 'Stop Music / Quiet Hours',
            musicPercent: 0
          }]
        };
      },
      createReceipt: async (command, options) => createPushcutXReceipt(command, {
        ...options,
        env: {},
        now: () => NOW,
        requireDurable: false
      }),
      updateReceipt: async () => ({}),
      enqueueCommand: async command => {
        queued.push(command);
        return { created: true, item: { command }, durable: true };
      },
      activateCommand: async () => ({ item: {}, durable: true }),
      removeCommand: async () => true,
      sendWake: async () => ({ emailId: 'quiet-hours-email-id-12345678', provider: 'resend' }),
      sendMaintenanceWake: async () => ({ emailId: 'quiet-hours-maintenance-id-12345678', provider: 'resend' }),
      cancelWake: async () => true,
      cancelMaintenanceWake: async () => true,
      wait: async () => {}
    });

    assert.equal(result.scheduled, 1);
    assert.equal(result.musicBrowserCount, 0);
    assert.equal(result.announcementScheduledCount, 0);
    assert.equal(result.volumeScheduledCount, 1);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].action, 'volume');
    assert.equal(queued[0].musicPercent, 0);
    assert.equal(queued[0].resumeMusic, false);
    assert.equal(queued[0].source, 'schedule');
    assert.equal(queued[0].label, 'Stop Music / Quiet Hours');
    assert.equal(queued[0].text, 'Version X scheduled quiet-hours volume update.');
  });

  test('drops an elapsed manifest entry without racing its queued receiver command', async () => {
    const elapsedEventId = 'email-wake-x-sched-elapsed-0001';
    let manifest = {
      schemaVersion: 1,
      version: 'x',
      transport: 'email-wake-x',
      syncedAt: NOW - 120_000,
      horizonEnd: NOW,
      stateRevision: 6,
      warnings: [],
      occurrences: {
        elapsed: {
          logicalId: 'elapsed',
          fingerprint: 'elapsed-fingerprint',
          eventId: elapsedEventId,
          emailId: 'elapsed-email-id-12345678',
          scheduledFor: NOW - 1_000,
          status: 'scheduled'
        }
      }
    };
    const calls = { cancel: 0, remove: 0, update: 0 };
    const manifestStore = {
      durable: true,
      async withLock(operation) { return await operation(); },
      async read() { return structuredClone(manifest); },
      async write(next) {
        manifest = structuredClone(next);
        return manifest;
      }
    };
    const result = await synchronizeEmailWakeXSchedule({
      state: { schedules: [], activeScheduleId: 'ignored' }
    }, {
      env: configuredEnv(),
      now: () => NOW,
      manifestStore,
      planner: () => ({
        horizonEnd: NOW + 29 * 24 * 60 * 60 * 1000,
        stateRevision: 7,
        warnings: [],
        occurrences: []
      }),
      cancelWake: async () => { calls.cancel += 1; },
      removeCommand: async () => { calls.remove += 1; },
      updateReceipt: async () => { calls.update += 1; }
    });
    assert.equal(result.scheduledCount, 0);
    assert.deepEqual(calls, { cancel: 0, remove: 0, update: 0 });
  });
});
