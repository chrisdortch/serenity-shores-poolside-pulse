import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { createSessionToken } from '../api/_auth.js';
import {
  cancelPushcutXExecution,
  planPushcutXSchedule,
  PushcutScheduleXError,
  readPushcutXScheduleStatus,
  schedulePushcutXExecution,
  synchronizePushcutXSchedule,
  zonedOccurrenceTimestamp
} from '../api/_pushcut-schedule-x.js';
import {
  createPushcutXCapability,
  verifyPushcutXCapability
} from '../api/_pushcut-security-x.js';
import {
  createPushcutXReceipt,
  readPushcutXReceipt
} from '../api/_pushcut-receipts-x.js';
import {
  createPushcutScheduleXHandler
} from '../api/pushcut-schedule-x.js';
import {
  createDefaultState
} from '../src/vx/core.js';
import {
  PushcutScheduleSyncError,
  syncPushcutSchedule
} from '../src/vx/pushcut-schedule-client.js';

const SESSION_SECRET = 'version-x-pushcut-schedule-session-secret';
const NOW = Date.parse('2026-07-17T15:00:00.000Z'); // 10:00 AM Central

function request(method, url, {
  body,
  cookie = '',
  host = 'poolside.test'
} = {}) {
  return {
    method,
    url,
    body,
    headers: {
      host,
      cookie,
      origin: `https://${host}`,
      'x-forwarded-host': host,
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.92',
      'sec-fetch-site': 'same-origin'
    },
    socket: { encrypted: true, remoteAddress: '203.0.113.92' }
  };
}

function response() {
  const chunks = [];
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    end(value = '') { chunks.push(Buffer.from(String(value))); },
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

function scheduleState({
  text = 'Scheduled pool message.',
  enabled = true,
  source = null
} = {}) {
  const state = createDefaultState(NOW);
  const weekday = new Date(Date.UTC(2026, 6, 17)).getUTCDay();
  state.revision = 12;
  state.announcements = [{
    id: 'scheduled-message',
    label: 'Scheduled Message',
    text,
    sourceId: source?.id || 'natural-voice'
  }];
  if (source) state.announcementSources.push(source);
  state.schedules = [{
    id: 'active-time',
    name: 'Active Time',
    mode: 'time',
    enabled,
    items: [{
      id: 'scheduled-item',
      label: 'Scheduled Message',
      enabled: true,
      days: [weekday],
      position: { time: '10:30', order: 1 },
      action: {
        kind: 'announcement',
        announcementSource: 'saved',
        announcementId: 'scheduled-message',
        sourceId: source?.id || 'natural-voice',
        text: ''
      },
      volume: { mode: 'global', percent: 100 },
      advance: { mode: 'complete', durationSeconds: 300 }
    }]
  }];
  state.activeScheduleId = 'active-time';
  return state;
}

function memoryManifestStore() {
  let manifest = {
    version: 1,
    syncedAt: 0,
    horizonEnd: 0,
    stateRevision: 0,
    occurrences: {}
  };
  return {
    durable: true,
    async withLock(operation) { return await operation(); },
    async read() { return structuredClone(manifest); },
    async write(next) {
      manifest = structuredClone(next);
      return structuredClone(manifest);
    },
    inspect() { return structuredClone(manifest); }
  };
}

beforeEach(() => {
  process.env.POOL_SIDE_SESSION_SECRET = SESSION_SECRET;
  process.env.POOL_SIDE_PIN = '7900';
  globalThis.__POOL_SIDE_API_RATE_LIMITS__ = new Map();
  globalThis.__POOL_SIDE_X_PUSHCUT_RECEIPTS__ = new Map();
  globalThis.__POOL_SIDE_X_PUSHCUT_RECEIPT_LOCKS__ = new Map();
});

describe('Version X Central Time occurrence planner', { concurrency: false }, () => {
  test('plans a bounded rolling horizon for active Time-mode announcements only', () => {
    const plan = planPushcutXSchedule(scheduleState(), {
      now: NOW,
      horizonDays: 7
    });
    assert.equal(plan.timeZone, 'America/Chicago');
    assert.equal(plan.occurrences.length, 1);
    assert.equal(plan.occurrences[0].scheduledFor, Date.parse('2026-07-17T15:30:00.000Z'));
    assert.equal(plan.occurrences[0].voicePercent, undefined);
    assert.equal(plan.occurrences[0].announcementMode, 'natural-voice');
    assert.equal(plan.occurrences[0].delaySeconds, 30 * 60);
    assert.ok(plan.horizonEnd >= NOW + 7 * 24 * 60 * 60 * 1000);

    const orderState = scheduleState();
    orderState.schedules[0].mode = 'order';
    assert.equal(planPushcutXSchedule(orderState, { now: NOW }).occurrences.length, 0);
  });

  test('handles Central Time DST gaps and chooses the first repeated wall time', () => {
    assert.equal(zonedOccurrenceTimestamp({
      year: 2026,
      month: 3,
      day: 8,
      hour: 2,
      minute: 30
    }), 0);
    assert.equal(zonedOccurrenceTimestamp({
      year: 2026,
      month: 11,
      day: 1,
      hour: 1,
      minute: 30
    }), Date.parse('2026-11-01T06:30:00.000Z'));
  });

  test('supports finite direct/Suno sources and excludes unsupported catalog sources', () => {
    const finite = planPushcutXSchedule(scheduleState({
      source: {
        id: 'finite-direct',
        label: 'Finite Direct',
        provider: 'direct',
        kind: 'finite-audio',
        url: 'https://media.example/message.mp3',
        finite: true,
        durationSeconds: 12
      }
    }), { now: NOW });
    assert.equal(finite.occurrences[0].announcementMode, 'finite-audio');
    assert.equal(finite.occurrences[0].announcementDurationSeconds, 12);
    assert.equal(finite.occurrences[0].recoveryFor, finite.occurrences[0].scheduledFor + 20_000);

    const catalog = planPushcutXSchedule(scheduleState({
      source: {
        id: 'spotify-catalog',
        label: 'Spotify',
        provider: 'spotify',
        kind: 'media',
        url: 'https://open.spotify.com/track/example',
        finite: false
      }
    }), { now: NOW });
    assert.equal(catalog.occurrences.length, 0);
    assert.match(catalog.warnings[0], /only Natural Voice or a finite/i);

    const overlongNatural = planPushcutXSchedule(scheduleState({
      text: 'a'.repeat(501)
    }), { now: NOW });
    assert.equal(overlongNatural.occurrences.length, 0);
    assert.match(overlongNatural.warnings[0], /500 characters or fewer/i);
  });
});

describe('Version X future signed capabilities', { concurrency: false }, () => {
  test('cannot be used materially before the scheduled occurrence', () => {
    const scheduledFor = NOW + 24 * 60 * 60 * 1000;
    const capability = createPushcutXCapability('pushcut-scheduled-capability-0001', 'audio', {
      env: { POOL_SIDE_SESSION_SECRET: SESSION_SECRET, POOL_SIDE_PIN: '7900' },
      now: () => NOW,
      notBeforeMs: scheduledFor,
      ttlSeconds: 30 * 60
    });
    assert.equal(capability.version, 2);
    assert.equal(verifyPushcutXCapability(capability, 'audio', {
      env: { POOL_SIDE_SESSION_SECRET: SESSION_SECRET, POOL_SIDE_PIN: '7900' },
      now: () => NOW
    }), false);
    assert.equal(verifyPushcutXCapability(capability, 'audio', {
      env: { POOL_SIDE_SESSION_SECRET: SESSION_SECRET, POOL_SIDE_PIN: '7900' },
      now: () => scheduledFor
    }), true);
  });

  test('scheduled receipts do not time out before their occurrence', async () => {
    const scheduledFor = NOW + 24 * 60 * 60 * 1000;
    const eventId = 'pushcut-scheduled-receipt-0001';
    await createPushcutXReceipt({
      eventId,
      commandId: eventId,
      action: 'announce',
      source: 'schedule',
      scheduledFor,
      announcementMode: 'natural-voice',
      text: 'Future scheduled receipt.',
      voicePercent: 100,
      musicPercent: 30
    }, {
      env: {},
      requireDurable: false,
      now: () => NOW
    });
    const beforeRun = await readPushcutXReceipt(eventId, {
      env: {},
      requireDurable: false,
      now: () => NOW + 10 * 60 * 1000
    });
    assert.equal(beforeRun.status, 'queued');
    assert.equal(beforeRun.deadlineAt, scheduledFor + 90_000);
    const afterDeadline = await readPushcutXReceipt(eventId, {
      env: {},
      requireDurable: false,
      now: () => scheduledFor + 90_001
    });
    assert.equal(afterDeadline.status, 'timed_out');
  });
});

describe('Version X Pushcut schedule synchronization', { concurrency: false }, () => {
  test('writes intent, arms recovery first, replaces changes, and cancels removals', async () => {
    const manifestStore = memoryManifestStore();
    const scheduled = [];
    const cancelled = [];
    const receipts = [];
    const updates = [];
    const env = {
      PUSHCUT_API_KEY_X: 'pushcut-api-key',
      OPENAI_API_KEY: 'openai-key',
      POOL_SIDE_SESSION_SECRET: SESSION_SECRET,
      POOL_SIDE_PIN: '7900'
    };
    const options = {
      env,
      now: () => NOW,
      horizonDays: 7,
      manifestStore,
      scheduleExecution: async payload => {
        scheduled.push(structuredClone(payload));
        return { accepted: true, status: 202 };
      },
      cancelExecution: async identifier => {
        cancelled.push(identifier);
        return { cancelled: true, status: 200 };
      },
      createReceipt: async command => {
        receipts.push(structuredClone(command));
        return { created: true, durable: true, receipt: command };
      },
      updateReceipt: async (eventId, patch) => {
        updates.push({ eventId, patch: structuredClone(patch) });
        return { eventId, ...patch };
      }
    };
    const first = await synchronizePushcutXSchedule({
      state: scheduleState(),
      request: request('POST', '/api/pushcut-schedule-x?v=x')
    }, options);
    assert.equal(first.scheduled, 1);
    assert.equal(scheduled.length, 2);
    assert.equal(scheduled[0].shortcut, 'Volume Down');
    assert.equal(scheduled[1].shortcut, 'Poolside Pulse Announcement');
    assert.equal(scheduled[1].input.voicePercent, 100);
    assert.equal(scheduled[1].input.musicPercent, 30);
    assert.match(scheduled[1].input.audioUrl, /cv=2/);
    assert.match(scheduled[1].input.audioUrl, /nbf=/);
    assert.equal(scheduled[1].input.scheduledFor, Date.parse('2026-07-17T15:30:00.000Z'));
    assert.equal(receipts[0].scheduledFor, scheduled[1].input.scheduledFor);
    const firstIdentifier = scheduled[1].identifier;
    const firstEventId = scheduled[1].input.eventId;

    scheduled.length = 0;
    const second = await synchronizePushcutXSchedule({
      state: scheduleState(),
      request: request('POST', '/api/pushcut-schedule-x?v=x')
    }, options);
    assert.equal(second.unchanged, 1);
    assert.equal(scheduled.length, 0);

    const changedState = scheduleState({ text: 'Changed scheduled message.' });
    const changed = await synchronizePushcutXSchedule({
      state: changedState,
      request: request('POST', '/api/pushcut-schedule-x?v=x')
    }, options);
    assert.equal(changed.scheduled, 1);
    assert.equal(scheduled[1].identifier, firstIdentifier);
    assert.notEqual(scheduled[1].input.eventId, firstEventId);
    assert.ok(updates.some(entry => entry.eventId === firstEventId && entry.patch.failureCode === 'schedule_replaced'));

    scheduled.length = 0;
    const removed = await synchronizePushcutXSchedule({
      state: scheduleState({ enabled: false }),
      request: request('POST', '/api/pushcut-schedule-x?v=x')
    }, options);
    assert.equal(removed.cancelled, 1);
    assert.equal(cancelled.length, 2);
    assert.equal(manifestStore.inspect().occurrences && Object.keys(manifestStore.inspect().occurrences).length, 0);
  });

  test('surfaces an explicit Extended requirement when Pushcut rejects a delayed plan', async () => {
    const manifestStore = memoryManifestStore();
    await assert.rejects(
      synchronizePushcutXSchedule({
        state: scheduleState(),
        request: request('POST', '/api/pushcut-schedule-x?v=x')
      }, {
        env: {
          PUSHCUT_API_KEY_X: 'pushcut-api-key',
          OPENAI_API_KEY: 'openai-key',
          POOL_SIDE_SESSION_SECRET: SESSION_SECRET,
          POOL_SIDE_PIN: '7900'
        },
        now: () => NOW,
        horizonDays: 7,
        manifestStore,
        scheduleExecution: async () => {
          throw new PushcutScheduleXError('providerRejected', { requiresExtended: true });
        },
        cancelExecution: async () => ({ cancelled: true }),
        createReceipt: async command => ({ receipt: command, created: true, durable: true }),
        updateReceipt: async () => ({})
      }),
      error => error instanceof PushcutScheduleXError && error.requiresExtended === true
    );
  });

  test('persists skipped-occurrence warnings for later status reads', async () => {
    const manifestStore = memoryManifestStore();
    const result = await synchronizePushcutXSchedule({
      state: scheduleState({ text: 'a'.repeat(501) }),
      request: request('POST', '/api/pushcut-schedule-x?v=x')
    }, {
      env: {
        PUSHCUT_API_KEY_X: 'pushcut-api-key',
        POOL_SIDE_SESSION_SECRET: SESSION_SECRET,
        POOL_SIDE_PIN: '7900'
      },
      now: () => NOW,
      horizonDays: 7,
      manifestStore,
      scheduleExecution: async () => {
        throw new Error('No skipped occurrence should be scheduled.');
      },
      cancelExecution: async () => ({ cancelled: true }),
      createReceipt: async command => ({ receipt: command, created: true, durable: true }),
      updateReceipt: async () => ({})
    });
    assert.equal(result.scheduledCount, 0);
    assert.match(result.warnings[0], /500 characters or fewer/i);
    const later = await readPushcutXScheduleStatus({ manifestStore });
    assert.equal(later.scheduledCount, 0);
    assert.match(later.warnings[0], /500 characters or fewer/i);
  });
});

describe('Version X Pushcut delayed API and session route', { concurrency: false }, () => {
  test('uses API-Key, deterministic delay/identifier, and the v1 cancellation endpoint', async () => {
    const calls = [];
    const env = { PUSHCUT_API_KEY_X: 'pushcut-secret' };
    const fetchImpl = async (url, options) => {
      calls.push({ url: String(url), options });
      return { status: 202 };
    };
    await schedulePushcutXExecution({
      identifier: 'ppx-a-1234567890abcdef',
      delaySeconds: 600,
      shortcut: 'Poolside Pulse Announcement',
      input: { eventId: 'scheduled-event' }
    }, { env, fetchImpl });
    await cancelPushcutXExecution('ppx-a-1234567890abcdef', { env, fetchImpl });
    const execute = new URL(calls[0].url);
    assert.equal(`${execute.origin}${execute.pathname}`, 'https://api.pushcut.io/v1/execute');
    assert.equal(execute.searchParams.get('delay'), '600s');
    assert.equal(execute.searchParams.get('identifier'), 'ppx-a-1234567890abcdef');
    assert.equal(calls[0].options.headers['API-Key'], 'pushcut-secret');
    assert.equal(JSON.parse(calls[0].options.body).shortcut, 'Poolside Pulse Announcement');
    assert.equal(calls[1].url, 'https://api.pushcut.io/v1/cancelExecution?identifier=ppx-a-1234567890abcdef');
  });

  test('requires the Version X session and returns requiresExtended on provider rejection', async () => {
    const manifestStore = memoryManifestStore();
    const handler = createPushcutScheduleXHandler({
      manifestStoreFactory: () => manifestStore,
      stateReader: async () => ({
        durable: true,
        revision: 12,
        state: scheduleState()
      }),
      synchronizer: async () => {
        throw new PushcutScheduleXError('providerRejected', { requiresExtended: true });
      }
    });
    const denied = await invoke(
      handler,
      request('POST', '/api/pushcut-schedule-x?v=x', {
        body: { state: scheduleState() }
      })
    );
    assert.equal(denied.statusCode, 401);
    const rejected = await invoke(
      handler,
      request('POST', '/api/pushcut-schedule-x?v=x', {
        cookie: xCookie(),
        body: { state: scheduleState() }
      })
    );
    assert.equal(rejected.statusCode, 409);
    assert.equal(rejected.json().requiresExtended, true);
    assert.match(rejected.json().error, /Extended/i);
  });

  test('browser client sends only the expected revision and preserves Extended errors', async () => {
    let sent;
    await assert.rejects(
      syncPushcutSchedule(scheduleState(), {
        fetchImpl: async (url, options) => {
          sent = { url, options };
          return {
            ok: false,
            status: 409,
            async json() {
              return {
                ok: false,
                error: 'Automation Server Extended is required.',
                requiresExtended: true
              };
            }
          };
        }
      }),
      error => error instanceof PushcutScheduleSyncError && error.requiresExtended === true
    );
    assert.equal(sent.url, '/api/pushcut-schedule-x?v=x');
    const body = JSON.parse(sent.options.body);
    assert.deepEqual(body, { expectedRevision: 12 });
    assert.equal(Object.hasOwn(body, 'state'), false);
  });

  test('rejects a stale browser revision before canonical schedule synchronization', async () => {
    const manifestStore = memoryManifestStore();
    let synchronized = false;
    const handler = createPushcutScheduleXHandler({
      manifestStoreFactory: () => manifestStore,
      stateReader: async () => ({
        durable: true,
        revision: 13,
        state: { ...scheduleState(), revision: 13 }
      }),
      synchronizer: async () => {
        synchronized = true;
        return {};
      }
    });
    const stale = await invoke(
      handler,
      request('POST', '/api/pushcut-schedule-x?v=x', {
        cookie: xCookie(),
        body: { expectedRevision: 12 }
      })
    );
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().currentRevision, 13);
    assert.equal(synchronized, false);
  });
});
