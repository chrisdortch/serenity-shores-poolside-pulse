import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sendPushcutAnnouncement } from '../src/vx/pushcut-client.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => String(name).toLowerCase() === 'content-type' ? 'application/json' : '' },
    async json() { return body; }
  };
}

describe('Version X browser announcement source contract', () => {
  test('keeps Natural Voice as the default Pushcut mode', async () => {
    let payload;
    await sendPushcutAnnouncement({
      eventId: 'pushcut-natural-source-0001',
      text: 'Natural voice test.',
      fetchImpl: async (_url, options) => {
        payload = JSON.parse(options.body);
        return jsonResponse(202, { ok: true, accepted: true, eventId: payload.eventId });
      }
    });
    assert.equal(payload.announcementMode, 'natural-voice');
    assert.equal(Object.hasOwn(payload, 'announcementAudioUrl'), false);
  });

  test('sends only supported finite clip fields and the conservative duration', async () => {
    let payload;
    await sendPushcutAnnouncement({
      eventId: 'pushcut-finite-source-0001',
      text: 'Recorded closing message.',
      announcementMode: 'finite-audio',
      announcementProvider: 'suno',
      announcementAudioUrl: 'https://media.example/closing.mp3',
      announcementDurationSeconds: 21,
      fetchImpl: async (_url, options) => {
        payload = JSON.parse(options.body);
        return jsonResponse(202, { ok: true, accepted: true, eventId: payload.eventId });
      }
    });
    assert.equal(payload.announcementMode, 'finite-audio');
    assert.equal(payload.announcementProvider, 'suno');
    assert.equal(payload.announcementAudioUrl, 'https://media.example/closing.mp3');
    assert.equal(payload.announcementDurationSeconds, 21);
  });

  test('rejects catalog providers, insecure URLs, and clips over 45 seconds before dispatch', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; };
    const base = {
      eventId: 'pushcut-invalid-source-0001',
      text: 'Invalid source test.',
      announcementMode: 'finite-audio',
      announcementAudioUrl: 'https://media.example/test.mp3',
      announcementDurationSeconds: 10,
      fetchImpl
    };
    await assert.rejects(sendPushcutAnnouncement({ ...base, announcementProvider: 'spotify' }), /Direct or Suno/i);
    await assert.rejects(sendPushcutAnnouncement({ ...base, eventId: 'pushcut-invalid-source-0002', announcementProvider: 'direct', announcementAudioUrl: 'http://media.example/test.mp3' }), /HTTPS/i);
    await assert.rejects(sendPushcutAnnouncement({ ...base, eventId: 'pushcut-invalid-source-0003', announcementProvider: 'direct', announcementDurationSeconds: 46 }), /1 to 45 seconds/i);
    assert.equal(calls, 0);
  });
});
