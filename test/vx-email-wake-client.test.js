import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applyEmailWakeMusicVolume,
  createEmailWakePairingCode,
  getEmailWakeStatus,
  sendEmailWakeAnnouncement,
  waitForEmailWakeCompletion
} from '../src/vx/email-wake-client.js';
import {
  getEmailWakeScheduleStatus,
  syncEmailWakeSchedule
} from '../src/vx/email-wake-schedule-client.js';
import { normalizePushcutXCommand } from '../api/_pushcut-x.js';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: name =>
        String(name).toLowerCase() === 'content-type'
          ? 'application/json; charset=utf-8'
          : ''
    },
    async json() {
      return body;
    }
  };
}

describe('Version X Automatic Receiver browser clients', () => {
  test('reads truthful service health and creates a one-time pairing code', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options });
      return calls.length === 1
        ? response({
            ok: true,
            ready: true,
            operational: true,
            receiverPaired: true
          })
        : response({
            ok: true,
            pairingCode: '123456',
            expiresAt: 2_000_000_000_000
          }, 201);
    };

    const health = await getEmailWakeStatus('', { fetchImpl });
    const pairing = await createEmailWakePairingCode({ fetchImpl });

    assert.equal(health.receiverPaired, true);
    assert.equal(pairing.pairingCode, '123456');
    assert.equal(calls[0].url, '/api/email-wake-x?v=x');
    assert.equal(calls[0].options.credentials, 'same-origin');
    assert.equal(calls[1].url, '/api/email-wake-pair-x?v=x');
    assert.equal(calls[1].options.method, 'POST');
  });

  test('queues a fixed-100% natural announcement with an idempotency key', async () => {
    let request;
    const fetchImpl = async (url, options) => {
      request = { url, options };
      return response({
        ok: true,
        queued: true,
        eventId: 'email-wake-test-event-123456'
      }, 202);
    };

    const result = await sendEmailWakeAnnouncement({
      eventId: 'email-wake-test-event-123456',
      text: 'Pool closes in fifteen minutes.',
      label: 'Closing',
      musicPercent: 30,
      fetchImpl
    });

    const body = JSON.parse(request.options.body);
    assert.equal(request.url, '/api/email-wake-x?v=x');
    assert.equal(request.options.headers['Idempotency-Key'], body.eventId);
    assert.equal(Object.hasOwn(body, 'action'), false);
    assert.equal(body.voicePercent, 100);
    assert.equal(body.musicPercent, 30);
    assert.equal(body.announcementMode, 'natural-voice');
    assert.equal(result.accepted, true);
  });

  test('sends an announcement envelope accepted by the real server validator', async () => {
    let canonical;
    const fetchImpl = async (_url, options) => {
      canonical = normalizePushcutXCommand(JSON.parse(options.body), {
        now: () => 1_234
      });
      return response({
        ok: true,
        queued: true,
        eventId: canonical.eventId
      }, 202);
    };

    await sendEmailWakeAnnouncement({
      eventId: 'email-wake-validator-event-123456',
      text: 'The pool closes in fifteen minutes.',
      label: 'Closing',
      musicPercent: 30,
      fetchImpl
    });

    assert.equal(canonical.action, 'announce');
    assert.equal(canonical.eventId, 'email-wake-validator-event-123456');
    assert.equal(canonical.voicePercent, 100);
    assert.equal(canonical.musicPercent, 30);
  });

  test('validates and queues finite Suno announcement audio', async () => {
    let body;
    const fetchImpl = async (_url, options) => {
      body = JSON.parse(options.body);
      return response({
        ok: true,
        queued: true,
        eventId: body.eventId
      }, 202);
    };

    await sendEmailWakeAnnouncement({
      eventId: 'email-wake-suno-event-123456',
      text: 'Recorded pool announcement',
      label: 'Suno Clip',
      musicPercent: 42,
      announcementMode: 'finite-audio',
      announcementProvider: 'suno',
      announcementAudioUrl: 'https://cdn.example.test/pool.mp3',
      announcementDurationSeconds: 15,
      fetchImpl
    });

    assert.equal(body.announcementMode, 'finite-audio');
    assert.equal(body.announcementProvider, 'suno');
    assert.equal(body.announcementDurationSeconds, 15);
    assert.equal(body.musicPercent, 42);
  });

  test('queues a receiver-volume action without announcement fields', async () => {
    let body;
    const fetchImpl = async (_url, options) => {
      body = JSON.parse(options.body);
      return response({
        ok: true,
        queued: true,
        eventId: body.eventId,
        musicPercent: body.musicPercent
      }, 202);
    };

    const result = await applyEmailWakeMusicVolume({
      eventId: 'email-volume-test-event-123456',
      musicPercent: 37,
      fetchImpl
    });

    assert.deepEqual(body, {
      version: 'x',
      action: 'volume',
      eventId: 'email-volume-test-event-123456',
      source: 'live',
      musicPercent: 37
    });
    assert.equal(result.musicPercent, 37);
  });

  test('polls a signed completion receipt without redispatching', async () => {
    let calls = 0;
    const fetchImpl = async url => {
      calls += 1;
      assert.match(
        url,
        /^\/api\/email-wake-x\?v=x&eventId=email-wake-complete-event-123456$/
      );
      return response({
        ok: true,
        receipt: {
          status: 'completed',
          completed: true,
          restoredMusicPercent: 30,
          musicResumed: true
        }
      });
    };

    const result = await waitForEmailWakeCompletion(
      'email-wake-complete-event-123456',
      { fetchImpl }
    );

    assert.equal(calls, 1);
    assert.equal(result.completed, true);
    assert.equal(result.receipt.restoredMusicPercent, 30);
  });

  test('syncs only the canonical durable state revision', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options });
      return response({
        ok: true,
        stateRevision: 44,
        scheduledCount: 3
      });
    };

    const status = await getEmailWakeScheduleStatus({ fetchImpl });
    const synced = await syncEmailWakeSchedule(
      { revision: 44, schedules: [{ id: 'not-sent-to-server' }] },
      { enabled: true, fetchImpl }
    );

    assert.equal(status.scheduledCount, 3);
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      expectedRevision: 44,
      enabled: true
    });
    assert.equal(synced.stateRevision, 44);
  });
});
