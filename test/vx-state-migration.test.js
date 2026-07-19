import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  prepareVersionXStateMigration
} from '../tools/migrate-version-x-state.mjs';

const NOW = 1_800_000_000_000;

describe('Version X isolated state migration', () => {
  test('preserves user content while removing every live audio ownership input', () => {
    const source = {
      version: 'x',
      revision: 42,
      config: {
        musicLevel: 30,
        musicProvider: 'apple',
        appleUrl: 'https://music.apple.com/us/playlist/example/pl.u-example',
        announcementTransport: 'email-wake',
        automaticReceiverVerifiedPairingAt: NOW - 5_000
      },
      receiver: {
        id: 'production-phone',
        sessionId: 'production-session',
        status: 'online',
        startedAt: NOW - 10_000,
        lastSeen: NOW - 1_000,
        leaseUntil: NOW + 20_000
      },
      playback: {
        provider: 'apple',
        intent: 'playing',
        sourceUrl: 'https://music.apple.com/us/playlist/example/pl.u-example'
      },
      announcements: [{ id: 'closing', text: 'The pool is closing.' }],
      schedules: [{ id: 'daily', name: 'Daily', items: [] }],
      scheduleRuns: {
        closing: { dateKey: '2027-01-14', status: 'completed' }
      },
      sequenceRuns: {
        daily: { order: 4, status: 'idle' }
      },
      events: [{ id: 'pending-production-command', status: 'pending' }],
      weather: {
        pendingAnnouncementIds: ['lightning'],
        checkedAt: NOW - 5_000
      }
    };

    const migrated = prepareVersionXStateMigration(source, NOW);

    assert.equal(migrated.config.musicLevel, 30);
    assert.equal(migrated.config.musicProvider, 'apple');
    assert.equal(migrated.config.announcementTransport, 'browser');
    assert.equal(migrated.config.automaticReceiverVerifiedPairingAt, 0);
    assert.equal(migrated.announcements.length, 1);
    assert.equal(migrated.schedules.length, 1);
    assert.deepEqual(migrated.scheduleRuns, source.scheduleRuns);
    assert.deepEqual(migrated.sequenceRuns, source.sequenceRuns);
    assert.equal(migrated.receiver.id, '');
    assert.equal(migrated.receiver.sessionId, '');
    assert.equal(migrated.receiver.status, 'offline');
    assert.equal(migrated.receiver.leaseUntil, NOW);
    assert.equal(migrated.playback.provider, 'apple');
    assert.equal(migrated.playback.intent, 'paused');
    assert.deepEqual(migrated.events, []);
    assert.deepEqual(migrated.weather.pendingAnnouncementIds, []);
    assert.notEqual(migrated, source);
    assert.equal(source.receiver.status, 'online');
    assert.equal(source.config.announcementTransport, 'email-wake');
    assert.equal(
      source.config.automaticReceiverVerifiedPairingAt,
      NOW - 5_000
    );
  });

  test('keeps an intentionally stopped music source stopped', () => {
    const migrated = prepareVersionXStateMigration({
      receiver: {},
      playback: { intent: 'stopped' },
      events: [],
      weather: {}
    }, NOW);
    assert.equal(migrated.playback.intent, 'stopped');
  });
});
