import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';

import {
  activateEmailWakeXCommand,
  claimEmailWakeXCommand,
  createSignedEmailWakeXUrl,
  EMAIL_WAKE_X_CLAIM_LEASE_MS,
  EMAIL_WAKE_X_RECOVERY_FAST_RETRY_MS,
  EMAIL_WAKE_X_RECOVERY_STEADY_RETRY_MS,
  emailWakeXClaimLeaseMs,
  enqueueEmailWakeXCommand,
  EMAIL_WAKE_X_RECEIVER_CONTRACT
} from '../api/_email-wake-x.js';
import {
  claimPushcutXAudioGeneration,
  createPushcutXReceipt,
  prepareEmailWakeXReceiptAttempt,
  PushcutXReceiptError,
  readPushcutXReceipt,
  resolvePushcutXRestoreTarget,
  updatePushcutXReceipt
} from '../api/_pushcut-receipts-x.js';
import {
  createPushcutXCapability,
  PUSHCUT_X_MAX_EXECUTION_ATTEMPT,
  verifyPushcutXCapability
} from '../api/_pushcut-security-x.js';
import {
  createEmailWakeClaimXHandler,
  EMAIL_WAKE_X_MAX_ANNOUNCEMENT_ATTEMPTS,
  EMAIL_WAKE_X_RECOVERY_ATTEMPT
} from '../api/email-wake-claim-x.js';
import {
  createEmailWakeExecuteXHandler
} from '../api/email-wake-execute-x.js';
import {
  createEmailWakeReceiptXHandler
} from '../api/email-wake-receipt-x.js';
import {
  createEmailWakeRestoreXHandler
} from '../api/email-wake-restore-x.js';
import {
  createPushcutAudioXHandler
} from '../api/pushcut-audio-x.js';

const SESSION_SECRET = 'version-x-attempt-bound-test-secret-long-enough';
const NOW = Date.parse('2026-07-19T18:00:00.000Z');
const MANAGED_ENV = [
  'POOL_SIDE_SESSION_SECRET',
  'POOL_SIDE_PIN',
  'PUSHCUT_PUBLIC_BASE_URL_X',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'RESEND_API_KEY_X',
  'RECEIVER_WAKE_EMAIL_X',
  'RECEIVER_WAKE_FROM_X',
  'RECEIVER_WAKE_SUBJECT_X',
  'VERCEL',
  'VERCEL_URL'
];
const originalEnv = Object.fromEntries(
  MANAGED_ENV.map(name => [name, process.env[name]])
);

function configuredEnv(overrides = {}) {
  return {
    POOL_SIDE_SESSION_SECRET: SESSION_SECRET,
    POOL_SIDE_PIN: '7900',
    PUSHCUT_PUBLIC_BASE_URL_X: 'https://poolside.test/',
    KV_REST_API_URL: 'https://kv.example.test',
    KV_REST_API_TOKEN: 'kv-test-token',
    RESEND_API_KEY_X: 're_test_key',
    RECEIVER_WAKE_EMAIL_X: 'receiver@example.com',
    RECEIVER_WAKE_FROM_X: 'Poolside Pulse <wake@example.com>',
    RECEIVER_WAKE_SUBJECT_X: 'Poolside Pulse X Wake',
    ...overrides
  };
}

function command(eventId, overrides = {}) {
  return {
    schemaVersion: 1,
    version: 'x',
    receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
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
    instructions: 'Warm, natural, and clear.',
    voicePercent: 100,
    musicPercent: 30,
    resumeMusic: true,
    ...overrides
  };
}

function request(method, url, {
  body,
  token = ''
} = {}) {
  return {
    method,
    url,
    body,
    headers: {
      host: 'poolside.test',
      origin: 'https://poolside.test',
      'x-forwarded-host': 'poolside.test',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.91',
      'sec-fetch-site': 'same-origin',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    socket: {
      encrypted: true,
      remoteAddress: '203.0.113.91'
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
      chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
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

function installEnv(env = configuredEnv()) {
  for (const name of MANAGED_ENV) delete process.env[name];
  Object.assign(process.env, env);
}

async function createMemoryReceipt(eventId) {
  return await createPushcutXReceipt(command(eventId), {
    env: {},
    now: () => NOW,
    requireDurable: false
  });
}

async function markAttemptAudioFetched(eventId, executionAttempt, at) {
  const claimed = await claimPushcutXAudioGeneration(eventId, {
    env: {},
    executionAttempt,
    now: () => at,
    requireDurable: false
  });
  assert.equal(claimed.claimed, true);
  await updatePushcutXReceipt(eventId, {
    status: 'started',
    providerStatus: 'natural_audio_ready',
    audioClaimedAt: 0,
    audioFetchedAt: at + 1,
    audioContentType: 'audio/mpeg'
  }, {
    env: {},
    executionAttempt,
    now: () => at + 1,
    requireDurable: false
  });
}

beforeEach(() => {
  installEnv();
  globalThis.__POOL_SIDE_API_RATE_LIMITS__ = new Map();
  globalThis.__POOL_SIDE_X_EMAIL_WAKE__ = undefined;
  globalThis.__POOL_SIDE_X_PUSHCUT_RECEIPTS__ = new Map();
  globalThis.__POOL_SIDE_X_PUSHCUT_RECEIPT_LOCKS__ = new Map();
});

after(() => {
  for (const name of MANAGED_ENV) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

describe('Version X attempt-bound email-wake capabilities', {
  concurrency: false
}, () => {
  test('signs v3 execution attempts while preserving v1 and v2 compatibility', () => {
    const env = configuredEnv();
    const legacy = createPushcutXCapability(
      'email-wake-capability-legacy-0001',
      'audio',
      { env, now: () => NOW }
    );
    const scheduled = createPushcutXCapability(
      'email-wake-capability-scheduled-0001',
      'audio',
      {
        env,
        now: () => NOW,
        notBeforeMs: NOW + 60_000
      }
    );
    const attempt = createPushcutXCapability(
      'email-wake-capability-attempt-0001',
      'audio',
      {
        env,
        executionAttempt: 2,
        now: () => NOW
      }
    );

    assert.equal(legacy.version, 1);
    assert.equal(scheduled.version, 2);
    assert.equal(attempt.version, 3);
    assert.equal(attempt.executionAttempt, 2);
    assert.equal(verifyPushcutXCapability(legacy, 'audio', {
      env,
      now: () => NOW
    }), true);
    assert.equal(verifyPushcutXCapability(scheduled, 'audio', {
      env,
      now: () => NOW + 60_000
    }), true);
    assert.equal(verifyPushcutXCapability(attempt, 'audio', {
      env,
      now: () => NOW
    }), true);
    assert.equal(verifyPushcutXCapability({
      ...attempt,
      executionAttempt: 3
    }, 'audio', {
      env,
      now: () => NOW
    }), false);

    const signed = createSignedEmailWakeXUrl(
      request('GET', '/'),
      '/api/pushcut-audio-x',
      attempt.eventId,
      'audio',
      {
        env,
        executionAttempt: 2,
        now: () => NOW
      }
    );
    const url = new URL(signed.url);
    assert.equal(url.searchParams.get('cv'), '3');
    assert.equal(url.searchParams.get('a'), '2');
  });

  test('keeps signed recovery attempts valid well beyond one thousand hours', async () => {
    const eventId = 'email-wake-capability-long-recovery-0001';
    const executionAttempt = 1_001;
    assert.equal(PUSHCUT_X_MAX_EXECUTION_ATTEMPT, 1_000_000);
    const capability = createPushcutXCapability(
      eventId,
      'restore',
      {
        env: configuredEnv(),
        executionAttempt,
        now: () => NOW
      }
    );
    assert.equal(capability.executionAttempt, executionAttempt);
    assert.equal(verifyPushcutXCapability(capability, 'restore', {
      env: configuredEnv(),
      now: () => NOW
    }), true);

    await createMemoryReceipt(eventId);
    const prepared = await prepareEmailWakeXReceiptAttempt(
      eventId,
      executionAttempt,
      {
        env: {},
        mode: 'recovery',
        now: () => NOW,
        requireDurable: false
      }
    );
    assert.equal(prepared.receipt.executionAttempt, executionAttempt);
    assert.equal(prepared.receipt.executionMode, 'recovery');
    assert.equal(createPushcutXCapability(eventId, 'restore', {
      env: configuredEnv(),
      executionAttempt: PUSHCUT_X_MAX_EXECUTION_ATTEMPT + 1,
      now: () => NOW
    }), null);
  });
});

describe('Version X post-download receipt retry preparation', {
  concurrency: false
}, () => {
  test('atomically resets replay fields and rejects stale attempt mutations', async () => {
    const eventId = 'email-wake-retry-reset-0001';
    await createMemoryReceipt(eventId);
    const first = await prepareEmailWakeXReceiptAttempt(eventId, 1, {
      env: {},
      mode: 'announcement',
      now: () => NOW,
      requireDurable: false
    });
    assert.equal(first.changed, true);
    await markAttemptAudioFetched(eventId, 1, NOW + 10);
    await resolvePushcutXRestoreTarget(eventId, 30, {
      env: {},
      executionAttempt: 1,
      now: () => NOW + 20,
      receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
      requireDurable: false
    });
    await updatePushcutXReceipt(eventId, {
      watchdogEmailId: 'watchdog-email-id-12345678',
      watchdogScheduledFor: NOW + 300_000,
      volumeRestored: true,
      restoredMusicPercent: 30,
      musicResumed: true
    }, {
      env: {},
      executionAttempt: 1,
      now: () => NOW + 21,
      requireDurable: false
    });

    const retried = await prepareEmailWakeXReceiptAttempt(eventId, 2, {
      env: {},
      mode: 'announcement',
      now: () => NOW + 300_001,
      requireDurable: false
    });
    const receipt = retried.receipt;
    assert.equal(retried.changed, true);
    assert.equal(receipt.eventId, eventId);
    assert.equal(receipt.text, 'Poolside announcement.');
    assert.equal(receipt.executionAttempt, 2);
    assert.equal(receipt.executionMode, 'announcement');
    assert.equal(receipt.status, 'queued');
    assert.equal(receipt.deadlineAt, NOW + 390_001);
    assert.equal(receipt.audioAttempt, 1);
    assert.equal(receipt.audioClaimedAt, 0);
    assert.equal(receipt.audioFetchedAt, 0);
    assert.equal(receipt.audioContentType, '');
    assert.equal(receipt.restoreTargetMusicPercent, null);
    assert.equal(receipt.restoreTargetResolvedAt, 0);
    assert.equal(receipt.watchdogEmailId, '');
    assert.equal(receipt.watchdogScheduledFor, 0);
    assert.equal(receipt.volumeRestored, false);
    assert.equal(receipt.restoredMusicPercent, null);
    assert.equal(receipt.musicResumed, false);

    const idempotent = await prepareEmailWakeXReceiptAttempt(eventId, 2, {
      env: {},
      mode: 'announcement',
      now: () => NOW + 300_002,
      requireDurable: false
    });
    assert.equal(idempotent.changed, false);

    await assert.rejects(
      updatePushcutXReceipt(eventId, {
        providerStatus: 'stale_attempt_must_not_write'
      }, {
        env: {},
        executionAttempt: 1,
        now: () => NOW + 300_003,
        requireDurable: false
      }),
      error => error instanceof PushcutXReceiptError
        && error.code === 'staleExecution'
    );
    const staleClaim = await claimPushcutXAudioGeneration(eventId, {
      env: {},
      executionAttempt: 1,
      now: () => NOW + 300_004,
      requireDurable: false
    });
    assert.equal(staleClaim.claimed, false);
    assert.equal(staleClaim.stale, true);
    const currentClaim = await claimPushcutXAudioGeneration(eventId, {
      env: {},
      executionAttempt: 2,
      now: () => NOW + 300_005,
      requireDurable: false
    });
    assert.equal(currentClaim.claimed, true);
  });

  test('rejects old audio, restore, and receipt URLs after a retry begins', async () => {
    const eventId = 'email-wake-stale-routes-0001';
    await createMemoryReceipt(eventId);
    await prepareEmailWakeXReceiptAttempt(eventId, 1, {
      env: {},
      mode: 'announcement',
      now: () => NOW,
      requireDurable: false
    });
    await markAttemptAudioFetched(eventId, 1, NOW + 10);
    const staleUrls = {
      audio: createSignedEmailWakeXUrl(
        request('GET', '/'),
        '/api/pushcut-audio-x',
        eventId,
        'audio',
        { executionAttempt: 1 }
      ),
      execute: createSignedEmailWakeXUrl(
        request('GET', '/'),
        '/api/email-wake-execute-x',
        eventId,
        'execute',
        { executionAttempt: 1 }
      ),
      restore: createSignedEmailWakeXUrl(
        request('GET', '/'),
        '/api/email-wake-restore-x',
        eventId,
        'restore',
        { executionAttempt: 1 }
      ),
      receipt: createSignedEmailWakeXUrl(
        request('POST', '/'),
        '/api/email-wake-receipt-x',
        eventId,
        'receipt',
        { executionAttempt: 1 }
      )
    };
    await prepareEmailWakeXReceiptAttempt(eventId, 2, {
      env: {},
      mode: 'announcement',
      now: Date.now,
      requireDurable: false
    });
    installEnv(configuredEnv({
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: ''
    }));

    let generated = 0;
    const audioHandler = createPushcutAudioXHandler({
      naturalSpeechGenerator: async () => {
        generated += 1;
        throw new Error('stale execution must not generate audio');
      }
    });
    const audio = await invoke(
      audioHandler,
      request('GET', new URL(staleUrls.audio.url).pathname
        + new URL(staleUrls.audio.url).search)
    );
    assert.equal(audio.statusCode, 409);
    assert.match(audio.json().error, /stale/i);
    assert.equal(generated, 0);

    const executeHandler = createEmailWakeExecuteXHandler();
    const execute = await invoke(
      executeHandler,
      request('GET', new URL(staleUrls.execute.url).pathname
        + new URL(staleUrls.execute.url).search)
    );
    assert.equal(execute.statusCode, 409);
    assert.match(execute.json().error, /stale/i);

    let stateReads = 0;
    const restoreHandler = createEmailWakeRestoreXHandler({
      stateReader: async () => {
        stateReads += 1;
        return { state: { config: { musicLevel: 30 } } };
      }
    });
    const restore = await invoke(
      restoreHandler,
      request('GET', new URL(staleUrls.restore.url).pathname
        + new URL(staleUrls.restore.url).search)
    );
    assert.equal(restore.statusCode, 409);
    assert.match(restore.json().error, /stale/i);
    assert.equal(stateReads, 0);

    let removed = 0;
    const receiptHandler = createEmailWakeReceiptXHandler({
      commandRemover: async () => {
        removed += 1;
      },
      nextReadyReader: async () => '',
      wakeSender: async () => {
        throw new Error('stale execution must not drain');
      }
    });
    const staleReceipt = await invoke(
      receiptHandler,
      request('POST', new URL(staleUrls.receipt.url).pathname
        + new URL(staleUrls.receipt.url).search, {
        body: {
          eventId,
          status: 'failed',
          receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
          failureCode: 'stale_attempt'
        }
      })
    );
    assert.equal(staleReceipt.statusCode, 409);
    assert.match(staleReceipt.json().error, /stale/i);
    assert.equal(removed, 0);

    await markAttemptAudioFetched(eventId, 2, Date.now());
    const currentExecuteUrl = createSignedEmailWakeXUrl(
      request('GET', '/'),
      '/api/email-wake-execute-x',
      eventId,
      'execute',
      { executionAttempt: 2 }
    );
    let currentExecute = await invoke(
      executeHandler,
      request('GET', new URL(currentExecuteUrl.url).pathname
        + new URL(currentExecuteUrl.url).search)
    );
    assert.equal(currentExecute.statusCode, 409);
    assert.match(currentExecute.json().error, /watchdog/i);

    const currentReceipt = await readPushcutXReceipt(eventId, {
      env: {},
      requireDurable: false
    });
    await updatePushcutXReceipt(eventId, {
      watchdogEmailId: 'watchdog-attempt-2-12345678',
      watchdogScheduledFor: currentReceipt.executionLeaseUntil - 1
    }, {
      env: {},
      executionAttempt: 2,
      requireDurable: false
    });
    currentExecute = await invoke(
      executeHandler,
      request('GET', new URL(currentExecuteUrl.url).pathname
        + new URL(currentExecuteUrl.url).search)
    );
    assert.equal(currentExecute.statusCode, 409);
    assert.match(currentExecute.json().error, /watchdog/i);

    await updatePushcutXReceipt(eventId, {
      watchdogEmailId: 'watchdog-attempt-2-12345678',
      watchdogScheduledFor: currentReceipt.executionLeaseUntil
    }, {
      env: {},
      executionAttempt: 2,
      requireDurable: false
    });
    currentExecute = await invoke(
      executeHandler,
      request('GET', new URL(currentExecuteUrl.url).pathname
        + new URL(currentExecuteUrl.url).search)
    );
    assert.equal(currentExecute.statusCode, 200);
    assert.equal(currentExecute.json().authorized, 1);
    assert.equal(currentExecute.json().authorizedBoolean, true);
    assert.equal(currentExecute.json().executionAttempt, 2);
  });

  test('denies a downloaded attempt once its receiver lease expires', async () => {
    const eventId = 'email-wake-expired-preflight-0001';
    await createMemoryReceipt(eventId);
    await prepareEmailWakeXReceiptAttempt(eventId, 1, {
      env: {},
      mode: 'announcement',
      leaseUntil: NOW + 1_000,
      now: () => NOW,
      requireDurable: false
    });
    await markAttemptAudioFetched(eventId, 1, NOW + 10);
    const executeUrl = createSignedEmailWakeXUrl(
      request('GET', '/'),
      '/api/email-wake-execute-x',
      eventId,
      'execute',
      {
        executionAttempt: 1,
        now: () => NOW
      }
    );
    installEnv(configuredEnv({
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: ''
    }));
    const handler = createEmailWakeExecuteXHandler({
      now: () => NOW + 1_001
    });
    const result = await invoke(
      handler,
      request('GET', new URL(executeUrl.url).pathname
        + new URL(executeUrl.url).search)
    );
    assert.equal(result.statusCode, 409);
    assert.match(result.json().error, /expired/i);
  });

  test('regenerates natural audio after a post-download retry reset', async () => {
    const eventId = 'email-wake-regenerate-audio-0001';
    const wallNow = Date.now();
    await createMemoryReceipt(eventId);
    let generations = 0;
    const handler = createPushcutAudioXHandler({
      naturalSpeechGenerator: async () => {
        generations += 1;
        return {
          buffer: Buffer.from([generations, 2, 3, 4]),
          contentType: 'audio/mpeg',
          format: 'mp3'
        };
      }
    });
    installEnv(configuredEnv({
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: ''
    }));

    for (const attempt of [1, 2]) {
      const preparedAt = wallNow + attempt * 100;
      await prepareEmailWakeXReceiptAttempt(eventId, attempt, {
        env: {},
        mode: 'announcement',
        now: () => preparedAt,
        requireDurable: false
      });
      const audioUrl = createSignedEmailWakeXUrl(
        request('GET', '/'),
        '/api/pushcut-audio-x',
        eventId,
        'audio',
        {
          executionAttempt: attempt,
          now: () => wallNow
        }
      );
      const served = await invoke(
        handler,
        request('GET', new URL(audioUrl.url).pathname
          + new URL(audioUrl.url).search)
      );
      assert.equal(served.statusCode, 200);
    }
    assert.equal(generations, 2);
    const receipt = await readPushcutXReceipt(eventId, {
      env: {},
      requireDurable: false
    });
    assert.equal(receipt.executionAttempt, 2);
    assert.equal(receipt.audioAttempt, 2);
    assert.equal(receipt.audioFetchedAt > 0, true);
  });
});

describe('Version X bounded receiver claim retry contract', {
  concurrency: false
}, () => {
  test('returns three announcement attempts followed by persistent recovery-only claims', async () => {
    assert.equal(EMAIL_WAKE_X_MAX_ANNOUNCEMENT_ATTEMPTS, 3);
    assert.equal(EMAIL_WAKE_X_RECOVERY_ATTEMPT, 4);
    const eventId = 'email-wake-bounded-claim-0001';
    for (const attempt of [1, 2, 3, 4, 5, 6]) {
      const queuedCommand = command(eventId, {
        musicPercent: 47,
        ...(attempt >= EMAIL_WAKE_X_RECOVERY_ATTEMPT
          ? {
              source: 'schedule',
              scheduledFor: NOW - 60 * 60_000
            }
          : {})
      });
      const leaseUntil = NOW + emailWakeXClaimLeaseMs(
        attempt,
        queuedCommand.action
      );
      const prepared = [];
      const watchdogs = [];
      const handler = createEmailWakeClaimXHandler({
        receiverAuthenticator: async token => token === 'receiver-token',
        commandClaimer: async () => ({
          item: {
            eventId,
            claimAttempt: attempt,
            leaseUntil,
            command: queuedCommand
          },
          durable: true
        }),
        receiptReader: async () => ({
          ...queuedCommand,
          status: 'timed_out',
          executionAttempt: Math.max(0, attempt - 1)
        }),
        receiptAttemptPreparer: async (_eventId, executionAttempt, options) => {
          prepared.push({ executionAttempt, mode: options.mode });
          return { prepared: true, changed: true, receipt: {} };
        },
        receiptUpdater: async () => ({}),
        commandRemover: async () => {
          throw new Error('an unproved recovery must remain safety-blocking');
        },
        watchdogWakeSender: async wake => {
          watchdogs.push(wake);
          return {
            emailId: `watchdog-attempt-${attempt}-12345678`,
            provider: 'resend'
          };
        },
        maintenanceRenewer: async () => ({ due: false, renewed: false }),
        now: () => NOW
      });
      const claimed = await invoke(
        handler,
        request('POST', '/api/email-wake-claim-x', {
          token: 'receiver-token'
        })
      );
      assert.equal(claimed.statusCode, 200);
      const body = claimed.json();
      assert.equal(body.executionAttempt, attempt);
      assert.deepEqual(prepared, [{
        executionAttempt: attempt,
        mode: attempt >= EMAIL_WAKE_X_RECOVERY_ATTEMPT
          ? 'recovery'
          : 'announcement'
      }]);
      assert.equal(body.watchdogScheduled, true);
      assert.equal(body.watchdogScheduledFor, leaseUntil);
      assert.equal(watchdogs.length, 1);
      assert.equal(watchdogs[0].scheduledFor, leaseUntil);
      const receiptUrl = new URL(body.receiptUrl);
      assert.equal(receiptUrl.searchParams.get('cv'), '3');
      assert.equal(receiptUrl.searchParams.get('a'), String(attempt));
      if (attempt <= EMAIL_WAKE_X_MAX_ANNOUNCEMENT_ATTEMPTS) {
        assert.equal(body.action, 'announce');
        assert.equal(body.recoveryOnly, undefined);
        assert.match(body.audioUrl, /\/api\/pushcut-audio-x\?/);
        const executeUrl = new URL(body.executeUrl);
        assert.equal(executeUrl.pathname, '/api/email-wake-execute-x');
        assert.equal(executeUrl.searchParams.get('a'), String(attempt));
      } else {
        assert.equal(body.action, 'recover');
        assert.equal(body.recoveryOnly, true);
        assert.equal(body.completionStatus, 'failed');
        assert.equal(body.failureCode, 'retry_exhausted_recovery_required');
        assert.equal(body.audioUrl, undefined);
        assert.equal(body.executeUrl, undefined);
        assert.equal(body.musicPercent, 47);
        assert.equal(body.musicLevel, 0.47);
        assert.match(body.restoreUrl, /\/api\/email-wake-restore-x\?/);
      }
    }
  });

  test('enforces five-minute, fifteen-minute, then hourly queue leases', async () => {
    const blocked = command('email-wake-bounded-backoff-0001');
    const waiting = command('email-wake-bounded-backoff-0002');
    for (const queuedCommand of [blocked, waiting]) {
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
    }

    let claimAt = NOW;
    for (const attempt of [1, 2, 3, 4, 5, 6]) {
      const claimed = await claimEmailWakeXCommand({
        env: {},
        now: () => claimAt,
        requireDurable: false
      });
      assert.equal(claimed.item.eventId, blocked.eventId);
      assert.equal(claimed.item.claimAttempt, attempt);
      const expectedLeaseMs = attempt <= EMAIL_WAKE_X_RECOVERY_ATTEMPT
        ? EMAIL_WAKE_X_CLAIM_LEASE_MS
        : attempt === EMAIL_WAKE_X_RECOVERY_ATTEMPT + 1
          ? EMAIL_WAKE_X_RECOVERY_FAST_RETRY_MS
          : EMAIL_WAKE_X_RECOVERY_STEADY_RETRY_MS;
      assert.equal(claimed.item.leaseUntil - claimAt, expectedLeaseMs);

      if (attempt >= EMAIL_WAKE_X_RECOVERY_ATTEMPT + 1) {
        const early = await claimEmailWakeXCommand({
          env: {},
          now: () => claimAt + EMAIL_WAKE_X_CLAIM_LEASE_MS,
          requireDurable: false
        });
        assert.equal(early.busy, true);
        assert.equal(early.item, null);
      }
      claimAt = claimed.item.leaseUntil;
    }
  });

  test('passes bounded backoff and persistent recovery policy to durable storage', async () => {
    const eventId = 'email-wake-durable-recovery-policy-0001';
    const queuedCommand = command(eventId);
    const queueCalls = [];
    const claimed = await claimEmailWakeXCommand({
      env: configuredEnv(),
      fetchImpl: async (_url, options) => {
        queueCalls.push(JSON.parse(options.body));
        return {
          ok: true,
          async json() {
            return {
              result: JSON.stringify({
                eventId,
                status: 'claimed',
                claimAttempt: 6,
                claimedAt: NOW,
                leaseUntil: NOW + EMAIL_WAKE_X_RECOVERY_STEADY_RETRY_MS,
                command: queuedCommand
              })
            };
          }
        };
      },
      now: () => NOW,
      requireDurable: true
    });
    assert.equal(claimed.item.claimAttempt, 6);
    assert.equal(queueCalls.length, 1);
    assert.match(queueCalls[0][1], /PERSIST/);
    assert.equal(Number(queueCalls[0][10]), EMAIL_WAKE_X_RECOVERY_ATTEMPT);
    assert.equal(
      Number(queueCalls[0][11]),
      EMAIL_WAKE_X_RECOVERY_FAST_RETRY_MS
    );
    assert.equal(
      Number(queueCalls[0][12]),
      EMAIL_WAKE_X_RECOVERY_STEADY_RETRY_MS
    );

    const receiptCalls = [];
    const prepared = await prepareEmailWakeXReceiptAttempt(eventId, 6, {
      env: configuredEnv(),
      fetchImpl: async (_url, options) => {
        receiptCalls.push(JSON.parse(options.body));
        return {
          ok: true,
          async json() {
            return {
              result: JSON.stringify({
                prepared: true,
                changed: true,
                reason: '',
                receipt: {
                  ...queuedCommand,
                  status: 'timed_out',
                  executionAttempt: 6,
                  executionMode: 'recovery'
                }
              })
            };
          }
        };
      },
      mode: 'recovery',
      leaseUntil: NOW + EMAIL_WAKE_X_RECOVERY_STEADY_RETRY_MS,
      now: () => NOW,
      requireDurable: true
    });
    assert.equal(prepared.receipt.executionMode, 'recovery');
    assert.equal(receiptCalls.length, 1);
    assert.match(receiptCalls[0][1], /requestedMode == "recovery"/);
    assert.match(receiptCalls[0][1], /PERSIST/);
  });
});

describe('Version X recovery-only restore and receipt', {
  concurrency: false
}, () => {
  test('binds the latest music target and records a truthful recovered failure', async () => {
    const eventId = 'email-wake-recovery-only-0001';
    await createMemoryReceipt(eventId);
    for (const attempt of [1, 2, 3]) {
      const at = NOW + (attempt - 1) * 300_000;
      await prepareEmailWakeXReceiptAttempt(eventId, attempt, {
        env: {},
        mode: 'announcement',
        now: () => at,
        requireDurable: false
      });
      await markAttemptAudioFetched(eventId, attempt, at + 10);
    }
    let prepared;
    for (const attempt of [4, 5, 6]) {
      prepared = await prepareEmailWakeXReceiptAttempt(eventId, attempt, {
        env: {},
        mode: 'recovery',
        now: () => NOW + attempt * 300_000,
        requireDurable: false
      });
    }
    assert.equal(prepared.receipt.executionMode, 'recovery');
    assert.equal(prepared.receipt.executionAttempt, 6);
    assert.equal(prepared.receipt.audioFetchedAt > 0, true);

    const restoreUrl = createSignedEmailWakeXUrl(
      request('GET', '/'),
      '/api/email-wake-restore-x',
      eventId,
      'restore',
      {
        executionAttempt: 6,
        now: () => NOW + 1_800_000
      }
    );
    const receiptUrl = createSignedEmailWakeXUrl(
      request('POST', '/'),
      '/api/email-wake-receipt-x',
      eventId,
      'receipt',
      {
        executionAttempt: 6,
        now: () => NOW + 1_800_000
      }
    );
    installEnv(configuredEnv({
      KV_REST_API_URL: '',
      KV_REST_API_TOKEN: ''
    }));
    const restoreHandler = createEmailWakeRestoreXHandler({
      stateReader: async () => ({
        state: { config: { musicLevel: 42 } }
      }),
      now: () => NOW + 1_800_100
    });
    const restored = await invoke(
      restoreHandler,
      request('GET', new URL(restoreUrl.url).pathname
        + new URL(restoreUrl.url).search)
    );
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().recoveryOnly, true);
    assert.equal(restored.json().musicPercent, 42);

    const removed = [];
    const receiptHandler = createEmailWakeReceiptXHandler({
      commandRemover: async id => {
        removed.push(id);
      },
      nextReadyReader: async () => '',
      watchdogWakeCanceller: async () => true,
      now: () => NOW + 1_800_200
    });
    const completedRecovery = await invoke(
      receiptHandler,
      request('POST', new URL(receiptUrl.url).pathname
        + new URL(receiptUrl.url).search, {
        body: {
          eventId,
          status: 'failed',
          receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
          failureCode: 'retry_exhausted_recovery_required',
          volumeRestored: true,
          restoredMusicPercent: 42,
          musicResumed: true
        }
      })
    );
    assert.equal(completedRecovery.statusCode, 200);
    assert.deepEqual(removed, [eventId]);
    const receipt = await readPushcutXReceipt(eventId, {
      env: {},
      requireDurable: false
    });
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.providerStatus, 'email_wake_recovery_completed');
    assert.equal(receipt.failureCode, 'retry_exhausted_recovered');
    assert.equal(receipt.volumeRestored, true);
    assert.equal(receipt.restoredMusicPercent, 42);
    assert.equal(receipt.musicResumed, true);
  });
});
