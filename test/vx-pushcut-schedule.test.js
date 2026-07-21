import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { beforeEach, describe, test } from 'node:test';

import { createSessionToken } from '../api/_auth.js';
import {
  cancelPushcutXExecution,
  createLegacyPushcutScheduleManifestStore,
  createPushcutScheduleManifestStore,
  planPushcutXSchedule,
  PUSHCUT_X_LEGACY_SCHEDULE_MANIFEST_KEY,
  PushcutScheduleXError,
  readPushcutXScheduleStatus,
  retireLegacyPushcutXSchedule,
  schedulePushcutXExecution,
  synchronizePushcutXSchedule,
  verifyPushcutXDelayedScheduling,
  zonedOccurrenceTimestamp
} from '../api/_pushcut-schedule-x.js';
import {
  createPushcutXCapability,
  createSignedPushcutXUrl,
  verifyPushcutXCapability
} from '../api/_pushcut-security-x.js';
import {
  createPushcutXReceipt,
  readPushcutXReceipt
} from '../api/_pushcut-receipts-x.js';
import {
  PUSHCUT_X_DEFAULT_RECOVERY_SHORTCUT,
  PUSHCUT_X_DEFAULT_SHORTCUT,
  PUSHCUT_X_RECEIVER_CONTRACT
} from '../api/_pushcut-x.js';
import {
  createPushcutScheduleXHandler,
  PUSHCUT_X_LEGACY_RETIRE_CONFIRMATION
} from '../api/pushcut-schedule-x.js';
import {
  createPushcutRecoveryXHandler
} from '../api/pushcut-recovery-x.js';
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
  musicLevel = 30,
  source = null
} = {}) {
  const state = createDefaultState(NOW);
  state.config.musicLevel = musicLevel;
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

function legacyMemoryManifestStore(occurrences = {}) {
  let manifest = {
    version: 1,
    syncedAt: NOW - 60_000,
    horizonEnd: NOW + 24 * 60 * 60_000,
    stateRevision: 11,
    warnings: [],
    occurrences: structuredClone(occurrences)
  };
  const writes = [];
  let clearCount = 0;
  return {
    durable: true,
    async withLock(operation) { return await operation(); },
    async read() { return structuredClone(manifest); },
    async write(next) {
      manifest = structuredClone(next);
      writes.push(structuredClone(manifest));
      return structuredClone(manifest);
    },
    async clear() {
      clearCount += 1;
      manifest = { ...manifest, occurrences: {} };
      return true;
    },
    inspect() {
      return {
        manifest: structuredClone(manifest),
        writes: structuredClone(writes),
        clearCount
      };
    }
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
  test('plans a bounded rolling horizon for enabled Time-mode announcements only', () => {
    const plan = planPushcutXSchedule(scheduleState(), {
      now: NOW,
      horizonDays: 7
    });
    assert.equal(plan.timeZone, 'America/Chicago');
    assert.equal(plan.occurrences.length, 1);
    assert.equal(plan.occurrences[0].scheduledFor, Date.parse('2026-07-17T15:30:00.000Z'));
    assert.equal(plan.occurrences[0].voicePercent, 100);
    assert.equal(plan.occurrences[0].musicPercent, 30);
    assert.equal(plan.occurrences[0].announcementLevel, 1);
    assert.equal(plan.occurrences[0].musicLevel, 0.3);
    assert.equal(plan.occurrences[0].announcementMode, 'natural-voice');
    assert.equal(plan.occurrences[0].delaySeconds, 30 * 60);
    assert.ok(plan.horizonEnd >= NOW + 7 * 24 * 60 * 60 * 1000);

    const fullMusicPlan = planPushcutXSchedule(scheduleState({ musicLevel: 100 }), {
      now: NOW,
      horizonDays: 7
    });
    assert.equal(fullMusicPlan.occurrences[0].musicPercent, 100);
    assert.equal(fullMusicPlan.occurrences[0].musicLevel, 1);
    assert.notEqual(fullMusicPlan.occurrences[0].fingerprint, plan.occurrences[0].fingerprint);

    const orderState = scheduleState();
    orderState.schedules[0].mode = 'order';
    assert.equal(planPushcutXSchedule(orderState, { now: NOW }).occurrences.length, 0);
  });

  test('plans every enabled Time schedule together and honors cancel, skip, and restore targets', () => {
    const state = scheduleState();
    const sharedItem = {
      label: 'Party message',
      enabled: true,
      days: [5],
      action: {
        kind: 'announcement',
        announcementSource: 'saved',
        announcementId: 'scheduled-message',
        sourceId: 'natural-voice',
        restoreMusicPercent: 100
      },
      volume: { mode: 'global', percent: 100 },
      advance: { mode: 'complete', durationSeconds: 300 }
    };
    state.schedules.push({
      id: 'wednesday-party',
      name: 'Wednesday Party',
      mode: 'time',
      enabled: true,
      cancellable: true,
      items: [{
        ...sharedItem,
        id: 'party-message',
        position: { time: '10:35', order: 1 }
      }, {
        ...sharedItem,
        id: 'skipped-message',
        skippedDates: ['2026-07-17'],
        position: { time: '10:36', order: 2 }
      }]
    }, {
      id: 'cancelled-party',
      name: 'Cancelled Party',
      mode: 'time',
      enabled: true,
      cancellable: true,
      cancelledDates: ['2026-07-17'],
      items: [{
        ...sharedItem,
        id: 'cancelled-message',
        position: { time: '10:37', order: 1 }
      }]
    }, {
      id: 'selected-order-cue',
      name: 'Selected Order Cue',
      mode: 'order',
      enabled: true,
      items: []
    });
    state.activeScheduleId = 'selected-order-cue';

    const plan = planPushcutXSchedule(state, { now: NOW, horizonDays: 7 });
    assert.deepEqual(
      plan.occurrences.map(item => [item.scheduleId, item.itemId]),
      [
        ['active-time', 'scheduled-item'],
        ['wednesday-party', 'party-message']
      ]
    );
    const party = plan.occurrences[1];
    assert.equal(party.musicPercent, 100);
    assert.equal(party.musicLevel, 1);
    assert.equal(party.recoveryFor, party.scheduledFor + 65_000);
  });

  test('adds quiet-hours volume occurrences only for the Automatic Receiver planner', () => {
    const state = scheduleState();
    state.schedules[0].items.push({
      id: 'quiet-hours',
      label: 'Stop Music / Quiet Hours',
      enabled: true,
      days: [5],
      position: { time: '10:45', order: 2 },
      action: { kind: 'stop' },
      volume: { mode: 'global', percent: 0 },
      advance: { mode: 'complete', durationSeconds: 300 }
    });

    const pushcutPlan = planPushcutXSchedule(state, {
      now: NOW,
      horizonDays: 7
    });
    assert.equal(pushcutPlan.occurrences.length, 1);

    const automaticPlan = planPushcutXSchedule(state, {
      now: NOW,
      horizonDays: 7,
      includeStops: true
    });
    assert.equal(automaticPlan.occurrences.length, 2);
    const quiet = automaticPlan.occurrences.find(item => item.itemId === 'quiet-hours');
    assert.equal(quiet.action, 'volume');
    assert.equal(quiet.musicPercent, 0);
    assert.equal(quiet.musicLevel, 0);
    assert.equal(quiet.scheduledFor, Date.parse('2026-07-17T15:45:00.000Z'));
  });

  test('preserves stable provider identifiers and isolates each Version X namespace', () => {
    const state = scheduleState();
    const stable = planPushcutXSchedule(state, {
      now: NOW,
      horizonDays: 7,
      env: {}
    }).occurrences[0];
    const expectedStableLogicalId = createHash('sha256')
      .update(['vx', 'active-time', 'scheduled-item', '2026-07-17', '10:30'].join('\0'))
      .digest('hex')
      .slice(0, 32);
    assert.equal(stable.logicalId, expectedStableLogicalId);

    const candidateA = planPushcutXSchedule(state, {
      now: NOW,
      horizonDays: 7,
      env: { POOL_SIDE_X_NAMESPACE: 'candidate-a' }
    }).occurrences[0];
    const candidateARepeat = planPushcutXSchedule(state, {
      now: NOW,
      horizonDays: 7,
      env: { POOL_SIDE_X_NAMESPACE: 'candidate-a' }
    }).occurrences[0];
    const candidateB = planPushcutXSchedule(state, {
      now: NOW,
      horizonDays: 7,
      env: { POOL_SIDE_X_NAMESPACE: 'candidate-b' }
    }).occurrences[0];

    assert.equal(candidateA.logicalId, candidateARepeat.logicalId);
    assert.equal(candidateA.identifier, candidateARepeat.identifier);
    assert.notEqual(candidateA.logicalId, stable.logicalId);
    assert.notEqual(candidateA.logicalId, candidateB.logicalId);
    assert.notEqual(candidateA.identifier, candidateB.identifier);
    assert.notEqual(candidateA.recoveryIdentifier, candidateB.recoveryIdentifier);
    assert.notEqual(candidateA.eventId, candidateB.eventId);
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
        durationSeconds: 137
      }
    }), { now: NOW });
    assert.equal(finite.occurrences[0].announcementMode, 'finite-audio');
    assert.equal(finite.occurrences[0].announcementDurationSeconds, 137);
    assert.equal(finite.occurrences[0].recoveryFor, finite.occurrences[0].scheduledFor + 145_000);

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
  test('holds the distributed manifest lock beyond the route execution ceiling', async () => {
    const commands = [];
    const manifestStore = createPushcutScheduleManifestStore({
      env: {
        KV_REST_API_URL: 'https://kv.example.test',
        KV_REST_API_TOKEN: 'kv-token'
      },
      fetchImpl: async (_url, options) => {
        const command = JSON.parse(options.body);
        commands.push(command);
        return {
          ok: true,
          async json() {
            return {
              result: command[0] === 'SET' ? 'OK' : 1
            };
          }
        };
      }
    });

    const result = await manifestStore.withLock(async () => 'locked result');
    assert.equal(result, 'locked result');
    assert.equal(commands[0][0], 'SET');
    assert.equal(commands[0][4], 'EX');
    assert.ok(Number(commands[0][5]) > 300);
    assert.equal(commands[1][0], 'EVAL');
  });

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
      state: scheduleState({ musicLevel: 45 }),
      request: request('POST', '/api/pushcut-schedule-x?v=x')
    }, options);
    assert.equal(first.scheduled, 1);
    assert.equal(scheduled.length, 2);
    assert.equal(PUSHCUT_X_RECEIVER_CONTRACT, 'poolside-pulse-x-audio-v4');
    assert.equal(scheduled[0].shortcut, PUSHCUT_X_DEFAULT_RECOVERY_SHORTCUT);
    assert.equal(scheduled[1].shortcut, PUSHCUT_X_DEFAULT_SHORTCUT);
    assert.equal(scheduled[1].input.voicePercent, 100);
    assert.equal(scheduled[1].input.resumeMusic, true);
    assert.equal(scheduled[0].input.receiverContract, PUSHCUT_X_RECEIVER_CONTRACT);
    assert.equal(scheduled[0].input.musicPercent, 45);
    assert.equal(scheduled[0].input.musicLevel, 0.45);
    assert.equal(scheduled[0].input.announcementLevel, 1);
    assert.equal(scheduled[0].input.resumeMusic, true);
    assert.match(scheduled[0].input.recoveryUrl, /\/api\/pushcut-recovery-x\?v=x&/);
    assert.match(scheduled[0].input.recoveryUrl, /cv=2/);
    assert.equal(scheduled[1].input.receiverContract, PUSHCUT_X_RECEIVER_CONTRACT);
    assert.equal(scheduled[1].input.musicPercent, 45);
    assert.equal(scheduled[1].input.musicLevel, 0.45);
    assert.equal(scheduled[1].input.announcementLevel, 1);
    assert.match(scheduled[1].input.audioUrl, /cv=2/);
    assert.match(scheduled[1].input.audioUrl, /nbf=/);
    assert.match(scheduled[1].input.restoreUrl, /\/api\/pushcut-restore-x\?v=x&/);
    assert.match(scheduled[1].input.restoreUrl, /cv=2/);
    assert.match(scheduled[1].input.restoreUrl, /nbf=/);
    assert.equal(scheduled[1].input.scheduledFor, Date.parse('2026-07-17T15:30:00.000Z'));
    assert.equal(receipts[0].scheduledFor, scheduled[1].input.scheduledFor);
    assert.equal(receipts[0].resumeMusic, true);
    const firstIdentifier = scheduled[1].identifier;
    const firstEventId = scheduled[1].input.eventId;

    scheduled.length = 0;
    const second = await synchronizePushcutXSchedule({
      state: scheduleState({ musicLevel: 45 }),
      request: request('POST', '/api/pushcut-schedule-x?v=x')
    }, options);
    assert.equal(second.unchanged, 1);
    assert.equal(scheduled.length, 0);

    const changedState = scheduleState({ text: 'Changed scheduled message.', musicLevel: 45 });
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
      state: scheduleState({ enabled: false, musicLevel: 45 }),
      request: request('POST', '/api/pushcut-schedule-x?v=x')
    }, options);
    assert.equal(removed.cancelled, 1);
    assert.equal(cancelled.length, 2);
    assert.equal(manifestStore.inspect().occurrences && Object.keys(manifestStore.inspect().occurrences).length, 0);
  });

  test('scheduled watchdog skips completed speech and otherwise restores the latest canonical M and resumes', async () => {
    const eventId = 'pushcut-schedule-recovery-0001';
    const recoveryFor = NOW + 65_000;
    const signed = createSignedPushcutXUrl(
      request('GET', '/'),
      '/api/pushcut-recovery-x',
      eventId,
      'recovery',
      {
        env: {
          POOL_SIDE_SESSION_SECRET: SESSION_SECRET,
          POOL_SIDE_PIN: '7900'
        },
        now: () => NOW,
        notBeforeMs: recoveryFor,
        ttlSeconds: 30 * 60
      }
    );
    let receipt = {
      eventId,
      source: 'schedule',
      scheduledFor: NOW + 30 * 60_000,
      status: 'started',
      receiverContract: PUSHCUT_X_RECEIVER_CONTRACT,
      voicePercent: 100,
      musicPercent: 30,
      resumeMusic: true,
      volumeRestored: false,
      restoredMusicPercent: null,
      musicResumed: false
    };
    let manifestStatus = 'scheduled';
    const handler = createPushcutRecoveryXHandler({
      receiptReader: async () => receipt,
      manifestReader: async () => ({
        occurrences: {
          recovery: {
            eventId,
            status: manifestStatus
          }
        }
      }),
      stateReader: async () => ({
        durable: true,
        revision: 13,
        state: { config: { musicLevel: 67 } }
      }),
      now: () => recoveryFor
    });

    const incomplete = await invoke(handler, request('GET', signed.url));
    assert.equal(incomplete.statusCode, 200);
    assert.equal(incomplete.json().shouldRecover, 1);
    assert.equal(incomplete.json().shouldRecoverBoolean, true);
    assert.equal(incomplete.json().musicPercent, 67);
    assert.equal(incomplete.json().musicLevel, 0.67);
    assert.equal(incomplete.json().resumeMusic, 1);
    assert.equal(incomplete.json().resumeMusicBoolean, true);

    receipt = {
      ...receipt,
      status: 'completed',
      audioFetchedAt: NOW + 30 * 60_000 + 1_000,
      restoreTargetMusicPercent: 30,
      restoreTargetResolvedAt: NOW + 30 * 60_000 + 2_000,
      volumeRestored: true,
      restoredMusicPercent: 30,
      musicResumed: true
    };
    const completed = await invoke(handler, request('GET', signed.url));
    assert.equal(completed.statusCode, 200);
    assert.equal(completed.json().shouldRecover, 0);
    assert.equal(completed.json().shouldRecoverBoolean, false);
    assert.equal(completed.json().resumeMusic, 0);
    assert.equal(completed.json().resumeMusicBoolean, false);
    assert.equal(Object.hasOwn(completed.json(), 'musicLevel'), false);

    receipt = {
      ...receipt,
      restoreTargetMusicPercent: null,
      restoreTargetResolvedAt: 0,
      volumeRestored: false,
      restoredMusicPercent: null,
      musicResumed: false
    };
    const incompleteCompletedReceipt = await invoke(handler, request('GET', signed.url));
    assert.equal(incompleteCompletedReceipt.statusCode, 200);
    assert.equal(incompleteCompletedReceipt.json().shouldRecover, 1);
    assert.equal(incompleteCompletedReceipt.json().musicPercent, 67);
    assert.equal(incompleteCompletedReceipt.json().resumeMusic, 1);

    receipt = {
      ...receipt,
      status: 'accepted',
      volumeRestored: false,
      restoredMusicPercent: null,
      musicResumed: false
    };
    manifestStatus = 'cancel-pending';
    const cancelledButProviderStale = await invoke(handler, request('GET', signed.url));
    assert.equal(cancelledButProviderStale.statusCode, 200);
    assert.equal(cancelledButProviderStale.json().shouldRecover, 0);
    assert.equal(cancelledButProviderStale.json().resumeMusic, 0);
    assert.equal(cancelledButProviderStale.json().reason, 'scheduled-occurrence-is-no-longer-active');
    assert.equal(Object.hasOwn(cancelledButProviderStale.json(), 'musicLevel'), false);
    manifestStatus = 'scheduled';

    for (const staleStatus of ['queued', 'failed']) {
      receipt = {
        ...receipt,
        status: staleStatus,
        providerStatus: staleStatus === 'failed' ? 'schedule_replaced' : 'pending',
        failureCode: staleStatus === 'failed' ? 'schedule_replaced' : '',
        volumeRestored: false,
        restoredMusicPercent: null,
        musicResumed: false
      };
      const stale = await invoke(handler, request('GET', signed.url));
      assert.equal(stale.statusCode, 200);
      assert.equal(stale.json().shouldRecover, 0);
      assert.equal(stale.json().resumeMusic, 0);
      assert.equal(stale.json().reason, 'announcement-was-not-left-incomplete');
      assert.equal(Object.hasOwn(stale.json(), 'musicLevel'), false);
    }
  });

  test('Browser Receiver mode cancels delayed Pushcut copies instead of duplicating announcements', async () => {
    const manifestStore = memoryManifestStore();
    const scheduled = [];
    const cancelled = [];
    const options = {
      env: {
        PUSHCUT_API_KEY_X: 'pushcut-api-key',
        OPENAI_API_KEY: 'openai-key',
        POOL_SIDE_SESSION_SECRET: SESSION_SECRET,
        POOL_SIDE_PIN: '7900'
      },
      now: () => NOW,
      horizonDays: 7,
      manifestStore,
      scheduleExecution: async payload => {
        scheduled.push(payload);
        return { accepted: true, status: 202 };
      },
      cancelExecution: async identifier => {
        cancelled.push(identifier);
        return { cancelled: true, status: 200 };
      },
      createReceipt: async command => ({ receipt: command, created: true, durable: true }),
      updateReceipt: async () => ({})
    };
    await synchronizePushcutXSchedule({
      state: scheduleState(),
      request: request('POST', '/api/pushcut-schedule-x?v=x'),
      pushcutEnabled: true
    }, options);
    assert.equal(scheduled.length, 2);

    const paused = await synchronizePushcutXSchedule({
      state: scheduleState(),
      request: request('POST', '/api/pushcut-schedule-x?v=x'),
      pushcutEnabled: false
    }, options);
    assert.equal(paused.scheduledCount, 0);
    assert.equal(paused.cancelled, 1);
    assert.equal(cancelled.length, 2);
    assert.match(paused.warnings.join(' '), /Browser Receiver mode/i);
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

describe('Version X legacy Pushcut retirement', { concurrency: false }, () => {
  test('exposes the legacy manifest only to an explicitly namespaced deployment', async () => {
    assert.throws(
      () => createLegacyPushcutScheduleManifestStore({
        env: {
          KV_REST_API_URL: 'https://kv.example.test',
          KV_REST_API_TOKEN: 'kv-token'
        }
      }),
      error =>
        error instanceof PushcutScheduleXError
        && error.code === 'legacyRetirementUnavailable'
    );

    const commands = [];
    const store = createLegacyPushcutScheduleManifestStore({
      env: {
        POOL_SIDE_X_NAMESPACE: 'automatic-receiver-candidate',
        KV_REST_API_URL: 'https://kv.example.test',
        KV_REST_API_TOKEN: 'kv-token'
      },
      fetchImpl: async (_url, options) => {
        const command = JSON.parse(options.body);
        commands.push(command);
        return {
          ok: true,
          async json() {
            return { result: null };
          }
        };
      }
    });
    const manifest = await store.read();
    assert.deepEqual(manifest.occurrences, {});
    assert.deepEqual(commands[0], [
      'GET',
      PUSHCUT_X_LEGACY_SCHEDULE_MANIFEST_KEY
    ]);
    assert.equal(commands[0][1].includes(':namespace:'), false);
  });

  test('cancels both legacy identifiers, checkpoints progress, and is idempotent', async () => {
    const firstId = 'a'.repeat(32);
    const secondId = 'b'.repeat(32);
    const store = legacyMemoryManifestStore({
      [firstId]: {
        logicalId: firstId,
        identifier: 'ppx-a-legacy-first',
        recoveryIdentifier: 'ppx-r-legacy-first',
        eventId: 'pushcut-sched-legacy-first',
        scheduledFor: NOW + 30_000,
        status: 'scheduled'
      },
      [secondId]: {
        logicalId: secondId,
        identifier: 'ppx-a-legacy-second',
        recoveryIdentifier: 'ppx-r-legacy-second',
        eventId: 'pushcut-sched-legacy-second',
        scheduledFor: NOW + 60_000,
        status: 'scheduled'
      }
    });
    const cancelled = [];
    const options = {
      env: { POOL_SIDE_X_NAMESPACE: 'automatic-receiver-candidate' },
      now: () => NOW,
      manifestStore: store,
      cancelExecution: async identifier => {
        cancelled.push(identifier);
        return { cancelled: true, status: 200 };
      }
    };
    const retired = await retireLegacyPushcutXSchedule(options);
    assert.equal(retired.legacyRetired, true);
    assert.equal(retired.alreadyRetired, false);
    assert.equal(retired.cancelledOccurrences, 2);
    assert.equal(retired.cancelledExecutions, 4);
    assert.equal(retired.remainingOccurrences, 0);
    assert.deepEqual(cancelled, [
      'ppx-a-legacy-first',
      'ppx-r-legacy-first',
      'ppx-a-legacy-second',
      'ppx-r-legacy-second'
    ]);
    assert.equal(store.inspect().writes.length, 1);
    assert.deepEqual(
      Object.keys(store.inspect().writes[0].occurrences),
      [secondId]
    );
    assert.equal(store.inspect().clearCount, 1);

    const replay = await retireLegacyPushcutXSchedule(options);
    assert.equal(replay.legacyRetired, true);
    assert.equal(replay.alreadyRetired, true);
    assert.equal(replay.cancelledExecutions, 0);
    assert.equal(cancelled.length, 4);
    assert.equal(store.inspect().clearCount, 2);
  });

  test('retains the unconfirmed legacy occurrence when cancellation fails', async () => {
    const firstId = 'c'.repeat(32);
    const secondId = 'd'.repeat(32);
    const store = legacyMemoryManifestStore({
      [firstId]: {
        logicalId: firstId,
        identifier: 'ppx-a-checkpoint-first',
        recoveryIdentifier: 'ppx-r-checkpoint-first',
        eventId: 'pushcut-sched-checkpoint-first',
        scheduledFor: NOW + 30_000,
        status: 'scheduled'
      },
      [secondId]: {
        logicalId: secondId,
        identifier: 'ppx-a-checkpoint-second',
        recoveryIdentifier: 'ppx-r-checkpoint-second',
        eventId: 'pushcut-sched-checkpoint-second',
        scheduledFor: NOW + 60_000,
        status: 'scheduled'
      }
    });
    await assert.rejects(
      retireLegacyPushcutXSchedule({
        env: { POOL_SIDE_X_NAMESPACE: 'automatic-receiver-candidate' },
        now: () => NOW,
        manifestStore: store,
        cancelExecution: async identifier => {
          if (identifier === 'ppx-r-checkpoint-second') {
            throw new PushcutScheduleXError('cancellationUncertain');
          }
          return { cancelled: true, status: 200 };
        }
      }),
      error =>
        error instanceof PushcutScheduleXError
        && error.code === 'cancellationUncertain'
    );
    assert.deepEqual(
      Object.keys(store.inspect().manifest.occurrences),
      [secondId]
    );
    assert.equal(store.inspect().clearCount, 0);
  });
});

describe('Version X Pushcut delayed API and session route', { concurrency: false }, () => {
  test('proves Extended with a harmless far-future recovery and immediately cancels it', async () => {
    const calls = [];
    const result = await verifyPushcutXDelayedScheduling({
      env: {
        PUSHCUT_API_KEY_X: 'pushcut-secret',
        PUSHCUT_RECOVERY_SHORTCUT_X: 'Volume Down'
      },
      now: () => NOW,
      scheduleExecution: async payload => {
        calls.push({ type: 'schedule', payload });
        return { accepted: true };
      },
      cancelExecution: async identifier => {
        calls.push({ type: 'cancel', identifier });
        return { cancelled: true, status: 200 };
      }
    });

    assert.equal(result.extendedVerified, true);
    assert.equal(result.cancelled, true);
    assert.equal(result.checkedAt, NOW);
    assert.equal(result.delayedSeconds, 29 * 24 * 60 * 60);
    assert.equal(calls[0].payload.shortcut, 'Volume Down');
    assert.equal(calls[0].payload.delaySeconds, result.delayedSeconds);
    assert.match(calls[0].payload.identifier, /^ppx-extended-check-[a-f0-9]{24}$/);
    assert.equal(calls[0].payload.input.action, 'recover-volume');
    assert.equal(calls[0].payload.input.receiverContract, PUSHCUT_X_RECEIVER_CONTRACT);
    assert.equal(calls[0].payload.input.musicPercent, 30);
    assert.equal(calls[0].payload.input.musicLevel, 0.3);
    assert.equal(calls[0].payload.input.announcementLevel, 1);
    assert.equal(calls[0].payload.input.resumeMusic, false);
    assert.equal(calls[0].payload.input.scheduledFor, NOW + result.delayedSeconds * 1000);
    assert.equal(calls[1].identifier, calls[0].payload.identifier);
  });

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
    assert.equal(execute.searchParams.get('shortcut'), 'Poolside Pulse Announcement');
    assert.equal(execute.searchParams.get('timeout'), 'nowait');
    assert.equal(execute.searchParams.get('delay'), '600s');
    assert.equal(execute.searchParams.get('identifier'), 'ppx-a-1234567890abcdef');
    assert.equal(calls[0].options.headers['API-Key'], 'pushcut-secret');
    const executeBody = JSON.parse(calls[0].options.body);
    assert.equal(Object.hasOwn(executeBody, 'shortcut'), false);
    assert.deepEqual(executeBody.input, { eventId: 'scheduled-event' });
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

  test('runs an authenticated delayed-entitlement diagnostic without reading or changing schedule state', async () => {
    let delayedChecks = 0;
    const handler = createPushcutScheduleXHandler({
      manifestStoreFactory: () => memoryManifestStore(),
      delayedVerifier: async () => {
        delayedChecks += 1;
        return {
          extendedVerified: true,
          cancelled: true,
          checkedAt: NOW,
          delayedSeconds: 29 * 24 * 60 * 60
        };
      },
      stateReader: async () => {
        throw new Error('The diagnostic must not read schedule state.');
      },
      synchronizer: async () => {
        throw new Error('The diagnostic must not synchronize occurrences.');
      }
    });
    const verified = await invoke(
      handler,
      request('POST', '/api/pushcut-schedule-x?v=x', {
        cookie: xCookie(),
        body: { diagnostic: true }
      })
    );
    assert.equal(verified.statusCode, 200);
    assert.equal(verified.json().extendedVerified, true);
    assert.equal(verified.json().cancelled, true);
    assert.equal(delayedChecks, 1);

    const invalid = await invoke(
      handler,
      request('POST', '/api/pushcut-schedule-x?v=x', {
        cookie: xCookie(),
        body: { diagnostic: true, expectedRevision: 12 }
      })
    );
    assert.equal(invalid.statusCode, 400);
    assert.equal(delayedChecks, 1);
  });

  test('runs explicit legacy retirement without reading or mutating the namespaced schedule', async () => {
    const namespace = 'automatic-receiver-candidate';
    const previousNamespace = process.env.POOL_SIDE_X_NAMESPACE;
    process.env.POOL_SIDE_X_NAMESPACE = namespace;
    try {
      const token = createSessionToken(Date.now(), 'x');
      assert.ok(token);
      const cookie =
        `poolside_vx_${namespace}_session=${encodeURIComponent(token)}`;
      let retirements = 0;
      const handler = createPushcutScheduleXHandler({
        manifestStoreFactory: () => {
          throw new Error('Legacy retirement must not open the namespaced manifest.');
        },
        legacyRetirer: async () => {
          retirements += 1;
          return {
            version: 'x',
            legacyRetired: true,
            alreadyRetired: false,
            retiredAt: NOW,
            cancelledOccurrences: 2,
            cancelledExecutions: 4,
            remainingOccurrences: 0
          };
        },
        stateReader: async () => {
          throw new Error('Legacy retirement must not read canonical state.');
        },
        synchronizer: async () => {
          throw new Error('Legacy retirement must not synchronize preview occurrences.');
        }
      });
      const retired = await invoke(
        handler,
        request('POST', '/api/pushcut-schedule-x?v=x', {
          cookie,
          body: {
            retireLegacy: true,
            confirmation: PUSHCUT_X_LEGACY_RETIRE_CONFIRMATION
          }
        })
      );
      assert.equal(retired.statusCode, 200);
      assert.equal(retired.json().legacyRetired, true);
      assert.equal(retired.json().cancelledOccurrences, 2);
      assert.equal(retired.json().remainingOccurrences, 0);
      assert.equal(retirements, 1);

      const invalid = await invoke(
        handler,
        request('POST', '/api/pushcut-schedule-x?v=x', {
          cookie,
          body: {
            retireLegacy: true,
            confirmation: 'not-confirmed'
          }
        })
      );
      assert.equal(invalid.statusCode, 400);
      assert.equal(retirements, 1);
    } finally {
      if (previousNamespace === undefined) {
        delete process.env.POOL_SIDE_X_NAMESPACE;
      } else {
        process.env.POOL_SIDE_X_NAMESPACE = previousNamespace;
      }
    }
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
    assert.deepEqual(body, { expectedRevision: 12, pushcutEnabled: true });
    assert.equal(Object.hasOwn(body, 'state'), false);
  });

  test('browser client and route preserve the explicit Pushcut-mode switch', async () => {
    let browserBody;
    await syncPushcutSchedule(scheduleState(), {
      pushcutEnabled: false,
      fetchImpl: async (_url, options) => {
        browserBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          async json() {
            return { ok: true, scheduledCount: 0 };
          }
        };
      }
    });
    assert.equal(browserBody.pushcutEnabled, false);

    let synchronizedInput;
    const handler = createPushcutScheduleXHandler({
      manifestStoreFactory: () => memoryManifestStore(),
      stateReader: async () => ({
        durable: true,
        revision: 12,
        state: scheduleState()
      }),
      synchronizer: async input => {
        synchronizedInput = input;
        return { scheduledCount: 0 };
      }
    });
    const response = await invoke(
      handler,
      request('POST', '/api/pushcut-schedule-x?v=x', {
        cookie: xCookie(),
        body: { expectedRevision: 12, pushcutEnabled: false }
      })
    );
    assert.equal(response.statusCode, 200);
    assert.equal(synchronizedInput.pushcutEnabled, false);
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
