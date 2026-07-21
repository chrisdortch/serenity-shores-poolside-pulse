import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultState } from '../src/vx/core.js';
import {
  DAILY_APPLE_PLAYLIST,
  dailyResortSchedule,
  prepareResortHubState,
  resortHubAnnouncementSources,
  wednesdayPartyLiveCuesSchedule,
  wednesdayPartySchedule
} from '../tools/version-x-resort-hub-state.mjs';

test('Daily Operations opens at 10, stays clear for Party, and protects closing', () => {
  const daily = dailyResortSchedule();
  assert.equal(daily.mode, 'time');
  assert.equal(daily.enabled, true);
  assert.equal(daily.cancellable, false);
  assert.deepEqual(
    daily.items.map(item => item.position.time),
    ['10:00', '10:02', '11:30', '12:30', '13:30', '14:30', '21:45', '21:55', '22:00']
  );
  assert.equal(daily.items[0].action.announcementId, 'welcome');
  assert.equal(daily.items[1].action.url, DAILY_APPLE_PLAYLIST);
  assert.equal(daily.items[1].volume.percent, 30);
  assert.equal(daily.items.at(-3).protected, true);
  assert.equal(daily.items.at(-2).protected, true);
  assert.equal(daily.items.at(-1).protected, true);
  const routineInPartyWindow = daily.items.filter(item => {
    const time = item.position.time;
    return item.action.kind === 'announcement' && time >= '17:30' && time < '21:45';
  });
  assert.deepEqual(routineInPartyWindow, []);
});

test('Wednesday Party is a cancellable timed overlay without readiness-gated guesses', () => {
  const party = wednesdayPartySchedule();
  assert.equal(party.mode, 'time');
  assert.equal(party.enabled, true);
  assert.equal(party.cancellable, true);
  assert.equal(party.items.length, 17);
  assert.ok(party.items.every(item => JSON.stringify(item.days) === '[3]'));
  const music = party.items.filter(item => item.action.kind === 'apple');
  assert.equal(music.length, 8);
  assert.ok(music.slice(0, -1).every(item => item.volume.percent === 100));
  assert.equal(music.at(-1).action.url, DAILY_APPLE_PLAYLIST);
  assert.equal(music.at(-1).volume.percent, 30);
  assert.equal(party.items.some(item => ['party-suno-02-x', 'party-suno-07-x', 'party-suno-08-x', 'party-suno-09-x'].includes(item.id)), false);
});

test('Wednesday Party live queue gates staff-dependent cues and chains each game announcement to its song', () => {
  const live = wednesdayPartyLiveCuesSchedule();
  assert.equal(live.mode, 'order');
  assert.equal(live.enabled, true);
  assert.equal(live.items.length, 7);
  assert.deepEqual(live.items.map(item => item.position.order), [1, 2, 3, 4, 5, 6, 7]);
  assert.match(live.items[0].label, /HOLD until food line is ready/);
  assert.equal(live.items[0].advance.mode, 'manual');
  assert.equal(live.items[1].id, 'party-suno-07-x');
  assert.equal(live.items[1].advance.mode, 'complete');
  assert.equal(live.items[2].id, 'party-apple-limbo-x');
  assert.equal(live.items[2].advance.mode, 'manual');
  assert.equal(live.items[3].id, 'party-suno-08-x');
  assert.equal(live.items[3].advance.mode, 'complete');
  assert.equal(live.items[4].id, 'party-apple-wipeout-x');
  assert.match(live.items[5].label, /HOLD until lifeguard shack is ready/);
  assert.equal(live.items[5].advance.mode, 'complete');
  assert.equal(live.items[6].id, 'party-apple-icecream-x');
  assert.ok(live.items.every(item => item.volume.percent === 100 || item.id === 'party-suno-02-x'));
});

test('all thirteen Party Suno clips are finite, verified, and under 180 seconds', () => {
  const sources = resortHubAnnouncementSources();
  assert.equal(sources.length, 13);
  assert.ok(sources.every(source => source.provider === 'suno'));
  assert.ok(sources.every(source => source.finite && source.verification === 'verified'));
  assert.ok(sources.every(source => source.durationSeconds >= 1 && source.durationSeconds <= 180));
  assert.equal(sources.find(source => source.id === 'party-suno-02').durationSeconds, 138);
});

test('resort hub migration preserves paired Automatic Receiver and weather state', () => {
  const now = Date.UTC(2026, 6, 20, 12, 0, 0);
  const source = createDefaultState(now - 1000);
  source.config.receiverMode = 'pushcut';
  source.config.announcementTransport = 'email-wake';
  source.config.automaticReceiverVerifiedPairingAt = 123456;
  source.weather.lightningHoldUntil = 987654;
  source.receiver = { id: 'speaker', sessionId: 'session', status: 'offline' };
  source.schedules.push({
    id: 'old-extra-time',
    name: 'Old Extra Time Schedule',
    mode: 'time',
    enabled: true,
    items: []
  }, {
    id: 'manual-order-cues',
    name: 'Manual Order Cues',
    mode: 'order',
    enabled: true,
    items: []
  });
  const migrated = prepareResortHubState(source, now);
  assert.equal(migrated.config.receiverMode, 'browser');
  assert.equal(migrated.config.announcementTransport, 'email-wake');
  assert.equal(migrated.config.automaticReceiverVerifiedPairingAt, 123456);
  assert.equal(migrated.weather.lightningHoldUntil, 987654);
  assert.equal(migrated.config.appleUrl, DAILY_APPLE_PLAYLIST);
  assert.equal(migrated.config.musicLevel, 30);
  assert.equal(migrated.schedules[0].id, 'daily-schedule');
  assert.equal(migrated.schedules[1].id, 'wednesday-party-schedule');
  assert.equal(migrated.schedules[2].id, 'wednesday-party-live-cues');
  assert.equal(migrated.activeScheduleId, 'wednesday-party-live-cues');
  assert.equal(migrated.schedules[2].items[0].advance.mode, 'manual');
  assert.equal(migrated.schedules[2].items[1].advance.mode, 'complete');
  assert.equal(migrated.schedules.find(schedule => schedule.id === 'old-extra-time').enabled, false);
  assert.equal(migrated.schedules.find(schedule => schedule.id === 'manual-order-cues').enabled, true);
  assert.equal(migrated.announcementSources.length, 14);
});
