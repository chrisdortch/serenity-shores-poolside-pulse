import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DUCK_LEVEL_PERCENT,
  EVENT_TTL_MS,
  LIGHTNING_ANNOUNCEMENT_REPEAT_MS,
  MUSIC_LEVEL_PERCENT,
  RECEIVER_LEASE_MS,
  SAFETY_EVENT_TTL_MS,
  SCHEDULE_CATCHUP_MS,
  SCHEDULE_CLAIM_MS,
  VOICE_LEVEL_PERCENT,
  WEATHER_INTERVAL_MS,
  audioPolicy,
  clamp,
  completeEvent,
  createDefaultState,
  createTargetedEvent,
  dueScheduleItems,
  evaluateWeather,
  eventBelongsToReceiver,
  isDirectAudioUrl,
  isSpotifyUrl,
  isSunoUrl,
  makeId,
  makeLog,
  makeReceiverLease,
  normalizeState,
  pendingEventsForReceiver,
  receiverOnline,
  renewReceiverLease,
  weatherRequestUrl
} from '../src/vfinal/core.js';

const T0 = 1_800_000_000_000;

describe('fixed mix state and foundational helpers', () => {
  test('publishes the immutable 30/100/6 mix contract', () => {
    assert.equal(MUSIC_LEVEL_PERCENT, 30);
    assert.equal(VOICE_LEVEL_PERCENT, 100);
    assert.equal(DUCK_LEVEL_PERCENT, 6);
  });

  test('normalization overrides persisted or hostile mix values every time', () => {
    const normalized = normalizeState({
      version: 'old',
      config: {
        musicProvider: 'spotify',
        musicLevel: 99,
        voiceLevel: -5,
        duckLevel: 88,
        weatherIntervalMinutes: 60
      }
    }, T0);

    assert.equal(normalized.version, 'final');
    assert.equal(normalized.config.musicProvider, 'spotify');
    assert.equal(normalized.config.musicLevel, 30);
    assert.equal(normalized.config.voiceLevel, 100);
    assert.equal(normalized.config.duckLevel, 6);
    assert.equal(normalized.config.weatherIntervalMinutes, 2);

    const renormalized = normalizeState(normalized, T0 + 1);
    assert.equal(renormalized.config.musicLevel, 30);
    assert.equal(renormalized.config.voiceLevel, 100);
    assert.equal(renormalized.config.duckLevel, 6);
  });

  test('normalization clamps weather controls and sanitizes provider choice', () => {
    const normalized = normalizeState({
      config: {
        musicProvider: 'unknown',
        latitude: 1000,
        longitude: -1000,
        lightningRadiusMiles: 0,
        lightningHoldMinutes: 500,
        windGustMph: 'not-a-number',
        weatherAuto: false
      }
    }, T0);

    assert.equal(normalized.config.musicProvider, 'controlled');
    assert.equal(normalized.config.latitude, 90);
    assert.equal(normalized.config.longitude, -180);
    assert.equal(normalized.config.lightningRadiusMiles, 1);
    assert.equal(normalized.config.lightningHoldMinutes, 90);
    assert.equal(normalized.config.windGustMph, 35);
    assert.equal(normalized.config.weatherAuto, false);
  });

  test('default state owns independent announcement and schedule copies', () => {
    const first = createDefaultState(T0);
    const second = createDefaultState(T0 + 1);

    first.announcements[0].label = 'mutated';
    first.schedule[0].days.pop();

    assert.notEqual(second.announcements[0].label, 'mutated');
    assert.equal(second.schedule[0].days.length, 7);
    assert.equal(first.savedAt, T0);
    assert.equal(second.savedAt, T0 + 1);
  });

  test('clamp and deterministic makeId handle numeric and fallback inputs', () => {
    assert.equal(clamp('12', 1, 20, 4), 12);
    assert.equal(clamp(99, 1, 20, 4), 20);
    assert.equal(clamp('bad', 1, 20, 4), 4);
    assert.equal(makeId('event', 36, 0), 'event-10-000000');
  });
});

describe('receiver lease lifecycle', () => {
  test('creates a bounded online lease with session identity', () => {
    const receiver = makeReceiverLease({
      deviceId: 'speaker-1',
      sessionId: 'session-a',
      name: 'Pool Speaker',
      platform: 'Safari on iPad',
      audioMode: 'unlocked'
    }, T0);

    assert.deepEqual(receiver, {
      id: 'speaker-1',
      sessionId: 'session-a',
      name: 'Pool Speaker',
      status: 'online',
      startedAt: T0,
      lastSeen: T0,
      leaseUntil: T0 + RECEIVER_LEASE_MS,
      platform: 'Safari on iPad',
      audioMode: 'unlocked',
      detail: 'Receiver audio unlocked and command session active.'
    });
  });

  test('treats both freshness and lease boundaries as inclusive, then expires', () => {
    const receiver = makeReceiverLease({ deviceId: 'speaker-1', sessionId: 'session-a' }, T0);

    assert.equal(receiverOnline(receiver, T0), true);
    assert.equal(receiverOnline(receiver, T0 + RECEIVER_LEASE_MS), true);
    assert.equal(receiverOnline(receiver, T0 + RECEIVER_LEASE_MS + 1), false);

    assert.equal(receiverOnline({ ...receiver, leaseUntil: T0 + RECEIVER_LEASE_MS * 10 }, T0 + RECEIVER_LEASE_MS + 1), false, 'stale heartbeat must expire even with a long lease');
    assert.equal(receiverOnline({ ...receiver, lastSeen: T0 + 10_000, leaseUntil: T0 - 1 }, T0), false, 'expired lease must fail even with a recent heartbeat');
  });

  test('requires an online status plus both device and session IDs', () => {
    const receiver = makeReceiverLease({ deviceId: 'speaker-1', sessionId: 'session-a' }, T0);

    assert.equal(receiverOnline({ ...receiver, status: 'offline' }, T0), false);
    assert.equal(receiverOnline({ ...receiver, id: '' }, T0), false);
    assert.equal(receiverOnline({ ...receiver, sessionId: '' }, T0), false);
    assert.equal(receiverOnline(null, T0), false);
  });

  test('renewal revives an expired lease without replacing its session start', () => {
    const receiver = makeReceiverLease({ deviceId: 'speaker-1', sessionId: 'session-a' }, T0);
    const renewedAt = T0 + RECEIVER_LEASE_MS + 5_000;
    const renewed = renewReceiverLease({ ...receiver, status: 'offline' }, renewedAt, { audioMode: 'spotify-ready' });

    assert.equal(renewed.startedAt, T0);
    assert.equal(renewed.lastSeen, renewedAt);
    assert.equal(renewed.leaseUntil, renewedAt + RECEIVER_LEASE_MS);
    assert.equal(renewed.status, 'online');
    assert.equal(renewed.audioMode, 'spotify-ready');
    assert.equal(receiverOnline(renewed, renewedAt), true);
  });
});

describe('session-targeted events', () => {
  test('refuses to create commands when the receiver lease is not active', () => {
    const expired = makeReceiverLease({ deviceId: 'speaker-1', sessionId: 'session-a' }, T0);

    assert.throws(
      () => createTargetedEvent('play', {}, expired, T0 + RECEIVER_LEASE_MS + 1),
      /speaker receiver is offline/i
    );
  });

  test('targets the active receiver session and applies normal versus safety TTLs', () => {
    const receiver = makeReceiverLease({ deviceId: 'speaker-1', sessionId: 'session-a' }, T0);
    const createdAt = T0 + 100;
    const normal = createTargetedEvent('play', { url: 'track.mp3' }, receiver, createdAt);
    const weather = createTargetedEvent('weather-check', null, receiver, createdAt);
    const safety = createTargetedEvent('announce-safety', { announcementId: 'lightning' }, receiver, createdAt);

    assert.equal(normal.targetReceiverId, receiver.id);
    assert.equal(normal.targetSessionId, receiver.sessionId);
    assert.equal(normal.createdAt, createdAt);
    assert.equal(normal.expiresAt, createdAt + EVENT_TTL_MS);
    assert.equal(normal.status, 'pending');
    assert.deepEqual(weather.payload, {});
    assert.equal(weather.expiresAt, createdAt + SAFETY_EVENT_TTL_MS);
    assert.equal(safety.expiresAt, createdAt + SAFETY_EVENT_TTL_MS);
  });

  test('accepts only live, pending commands for the exact device and session', () => {
    const receiver = makeReceiverLease({ deviceId: 'speaker-1', sessionId: 'session-new' }, T0);
    const event = {
      id: 'event-1',
      type: 'play',
      targetReceiverId: receiver.id,
      targetSessionId: receiver.sessionId,
      createdAt: T0,
      expiresAt: T0 + EVENT_TTL_MS,
      status: 'pending'
    };
    const at = T0 + 1_000;

    assert.equal(eventBelongsToReceiver(event, receiver, T0, new Set(), at), true);
    assert.equal(eventBelongsToReceiver({ ...event, targetReceiverId: 'speaker-2' }, receiver, T0, new Set(), at), false);
    assert.equal(eventBelongsToReceiver({ ...event, targetSessionId: 'session-old' }, receiver, T0, new Set(), at), false);
    assert.equal(eventBelongsToReceiver({ ...event, status: 'completed' }, receiver, T0, new Set(), at), false);
    assert.equal(eventBelongsToReceiver({ ...event, status: 'failed' }, receiver, T0, new Set(), at), false);
    assert.equal(eventBelongsToReceiver(event, receiver, T0, new Set([event.id]), at), false);
    assert.equal(eventBelongsToReceiver(event, { ...receiver, status: 'offline' }, T0, new Set(), at), false);
  });

  test('rejects stale-session events and expired events at precise boundaries', () => {
    const receiver = makeReceiverLease({ deviceId: 'speaker-1', sessionId: 'session-new' }, T0);
    const base = {
      id: 'event-1',
      targetReceiverId: receiver.id,
      targetSessionId: receiver.sessionId,
      status: 'pending',
      expiresAt: T0 + 10_000
    };

    assert.equal(eventBelongsToReceiver({ ...base, createdAt: T0 - 60_000 }, receiver, T0, new Set(), T0), true, 'the exact session target is authoritative across device clock skew');
    assert.equal(eventBelongsToReceiver({ ...base, createdAt: T0, expiresAt: T0 }, receiver, T0, new Set(), T0), true, 'event remains valid at its exact expiry instant');
    assert.equal(eventBelongsToReceiver({ ...base, createdAt: T0, expiresAt: T0 - 1 }, receiver, T0, new Set(), T0), false);
  });

  test('orders pending events oldest-first and deduplicates command keys', () => {
    const receiver = makeReceiverLease({ deviceId: 'speaker-1', sessionId: 'session-a' }, T0);
    const makeEvent = (id, createdAt, dedupeKey = '') => ({
      id,
      dedupeKey,
      targetReceiverId: receiver.id,
      targetSessionId: receiver.sessionId,
      createdAt,
      expiresAt: T0 + 30_000,
      status: 'pending'
    });
    const events = [
      makeEvent('newer-duplicate', T0 + 2_000, 'same-play'),
      makeEvent('newest', T0 + 3_000),
      makeEvent('oldest', T0 + 1_000, 'same-play'),
      { ...makeEvent('wrong-session', T0 + 500), targetSessionId: 'session-old' }
    ];

    const pending = pendingEventsForReceiver(events, receiver, T0, new Set(), T0 + 4_000);
    assert.deepEqual(pending.map(event => event.id), ['oldest', 'newest']);
  });

  test('completes or fails events with bounded receiver metadata', () => {
    const event = { id: 'event-1', status: 'pending' };
    const completed = completeEvent(event, 'speaker-1', T0);
    const failed = completeEvent(event, 'speaker-1', T0, 'x'.repeat(600));

    assert.equal(completed.status, 'completed');
    assert.equal(completed.completedBy, 'speaker-1');
    assert.equal(completed.error, '');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.length, 500);
  });
});

describe('schedule due-time policy', () => {
  const mondayAt123045Chicago = Date.UTC(2026, 6, 6, 17, 30, 45);
  const allDays = [0, 1, 2, 3, 4, 5, 6];

  test('selects only enabled items on the current local weekday inside catch-up', () => {
    const schedule = [
      { id: 'due', enabled: true, time: '12:30', days: [1] },
      { id: 'disabled', enabled: false, time: '12:30', days: [1] },
      { id: 'wrong-day', enabled: true, time: '12:30', days: [2] },
      { id: 'future', enabled: true, time: '12:31', days: [1] },
      { id: 'too-old', enabled: true, time: '12:28', days: [1] },
      { id: 'invalid', enabled: true, time: 'noon', days: [1] },
      { id: 'empty-days-means-every-day', enabled: true, time: '12:30', days: [] }
    ];

    const due = dueScheduleItems(schedule, {}, mondayAt123045Chicago, 'America/Chicago');
    assert.deepEqual(due.map(item => item.id), ['due', 'empty-days-means-every-day']);
  });

  test('includes the exact catch-up boundary and excludes the next second', () => {
    const schedule = [{ id: 'boundary', enabled: true, time: '12:30', days: allDays }];
    const exactBoundary = Date.UTC(2026, 6, 6, 17, 31, 30);
    const outsideBoundary = Date.UTC(2026, 6, 6, 17, 31, 31);

    assert.equal(SCHEDULE_CATCHUP_MS, 90_000);
    assert.equal(dueScheduleItems(schedule, {}, exactBoundary, 'America/Chicago').length, 1);
    assert.equal(dueScheduleItems(schedule, {}, outsideBoundary, 'America/Chicago').length, 0);
  });

  test('is idempotent per local date but allows the same item next day', () => {
    const schedule = [{ id: 'daily', enabled: true, time: '12:30', days: allDays }];
    const runs = { daily: '2026-07-06' };
    const tuesdayAt123045Chicago = Date.UTC(2026, 6, 7, 17, 30, 45);

    assert.equal(dueScheduleItems(schedule, runs, mondayAt123045Chicago, 'America/Chicago').length, 0);
    assert.equal(dueScheduleItems(schedule, runs, tuesdayAt123045Chicago, 'America/Chicago').length, 1);
  });

  test('honors an explicit custom catch-up window', () => {
    const schedule = [{ id: 'short-window', enabled: true, time: '12:30', days: allDays }];
    assert.equal(dueScheduleItems(schedule, {}, mondayAt123045Chicago, 'America/Chicago', 44_000).length, 0);
    assert.equal(dueScheduleItems(schedule, {}, mondayAt123045Chicago, 'America/Chicago', 45_000).length, 1);
  });

  test('skips a fresh in-progress claim but retries it once the receiver lease is stale', () => {
    const schedule = [{ id: 'claimed', enabled: true, time: '12:30', days: allDays }];
    const freshRuns = {
      claimed: {
        dateKey: '2026-07-06',
        status: 'in-progress',
        claimedAt: mondayAt123045Chicago - SCHEDULE_CLAIM_MS + 1
      }
    };
    const staleRuns = {
      claimed: {
        ...freshRuns.claimed,
        claimedAt: mondayAt123045Chicago - SCHEDULE_CLAIM_MS
      }
    };

    assert.equal(dueScheduleItems(schedule, freshRuns, mondayAt123045Chicago, 'America/Chicago').length, 0);
    assert.deepEqual(
      dueScheduleItems(schedule, staleRuns, mondayAt123045Chicago, 'America/Chicago').map(item => item.id),
      ['claimed']
    );
  });

  test('a completed receipt from a prior local date permits today\'s scheduled run', () => {
    const schedule = [{ id: 'daily-receipt', enabled: true, time: '12:30', days: allDays }];
    const runs = {
      'daily-receipt': {
        dateKey: '2026-07-05',
        status: 'completed',
        completedAt: mondayAt123045Chicago - 24 * 60 * 60_000
      }
    };

    assert.deepEqual(
      dueScheduleItems(schedule, runs, mondayAt123045Chicago, 'America/Chicago').map(item => item.id),
      ['daily-receipt']
    );
  });
});

describe('audio policy', () => {
  test('controlled Suno/direct playback guarantees an exact 30/100 mix and 6% duck', () => {
    const policy = audioPolicy({ provider: 'controlled', isIOS: true, supportsVolume: false });

    assert.deepEqual({
      id: policy.id,
      exact: policy.exact,
      musicPercent: policy.musicPercent,
      voicePercent: policy.voicePercent,
      duringVoicePercent: policy.duringVoicePercent,
      action: policy.action
    }, {
      id: 'exact-30-100',
      exact: true,
      musicPercent: 30,
      voicePercent: 100,
      duringVoicePercent: 6,
      action: 'duck'
    });
  });

  test('desktop Spotify with verified volume support uses 30% and pauses for voice', () => {
    const policy = audioPolicy({ provider: 'spotify', isIOS: false, supportsVolume: true, volumeVerified: true });

    assert.equal(policy.id, 'spotify-verified-30-pause');
    assert.equal(policy.exact, true);
    assert.equal(policy.musicPercent, 30);
    assert.equal(policy.voicePercent, 100);
    assert.equal(policy.duringVoicePercent, 0);
    assert.equal(policy.action, 'pause');
  });

  test('iOS Spotify never claims controllable volume even if support is reported', () => {
    const policy = audioPolicy({ provider: 'spotify', isIOS: true, supportsVolume: true });

    assert.equal(policy.id, 'spotify-ios-pause-only');
    assert.equal(policy.exact, false);
    assert.equal(policy.musicPercent, null);
    assert.equal(policy.voicePercent, 100);
    assert.equal(policy.duringVoicePercent, 0);
    assert.equal(policy.action, 'pause');
  });

  test('desktop Spotify without volume support uses the same truthful fallback', () => {
    const policy = audioPolicy({ provider: 'spotify', isIOS: false, supportsVolume: false });
    assert.equal(policy.id, 'spotify-unverified-pause-only');
    assert.equal(policy.exact, false);
    assert.equal(policy.musicPercent, null);
  });

  test('desktop Spotify capability is not presented as 30% verification', () => {
    const policy = audioPolicy({ provider: 'spotify', isIOS: false, supportsVolume: true, volumeVerified: false });
    assert.equal(policy.exact, false);
    assert.equal(policy.musicPercent, null);
    assert.equal(policy.id, 'spotify-unverified-pause-only');
  });
});

describe('weather safety state machine', () => {
  const config = { lightningHoldMinutes: 30 };
  const lightningPayload = id => ({
    summary: 'Lightning nearby',
    threatType: 'lightning',
    lightningHits: [{ id, distanceMI: 7.2, timestamp: T0 }]
  });

  test('starts the lightning hold and records the first safety announcement', () => {
    const result = evaluateWeather(null, lightningPayload('strike-a'), config, T0);

    assert.equal(result.weather.lightningActive, true);
    assert.equal(result.weather.lightningHoldUntil, T0 + 30 * 60_000);
    assert.equal(result.weather.lastLightningKey, 'strike-a');
    assert.equal(result.weather.lastLightningAnnouncementAt, T0);
    assert.deepEqual(result.announcements, ['lightning']);
  });

  test('resets the hold on each observed strike while deduplicating rapid alerts', () => {
    const first = evaluateWeather(null, lightningPayload('strike-a'), config, T0);
    const repeatedAt = T0 + 60_000;
    const repeated = evaluateWeather(first.weather, lightningPayload('strike-a'), config, repeatedAt);
    const newStrikeAt = T0 + 2 * 60_000;
    const newStrike = evaluateWeather(repeated.weather, lightningPayload('strike-b'), config, newStrikeAt);

    assert.deepEqual(repeated.announcements, []);
    assert.equal(repeated.weather.lightningHoldUntil, repeatedAt + 30 * 60_000);
    assert.deepEqual(newStrike.announcements, []);
    assert.equal(newStrike.weather.lastLightningKey, 'strike-b');
    assert.equal(newStrike.weather.lightningHoldUntil, newStrikeAt + 30 * 60_000);
    assert.equal(newStrike.weather.lastLightningAnnouncementAt, T0);
  });

  test('allows a new-strike alert after the separate five-minute repeat interval', () => {
    const first = evaluateWeather(null, lightningPayload('strike-a'), config, T0);
    const next = evaluateWeather(first.weather, lightningPayload('strike-b'), config, T0 + LIGHTNING_ANNOUNCEMENT_REPEAT_MS);

    assert.deepEqual(next.announcements, ['lightning']);
    assert.equal(next.weather.lastLightningAnnouncementAt, T0 + LIGHTNING_ANNOUNCEMENT_REPEAT_MS);
  });

  test('holds until the deadline, emits one all-clear, and then stays clear', () => {
    const active = evaluateWeather(null, lightningPayload('strike-a'), config, T0);
    const clearPayload = { summary: 'No current strikes', lightningCoverageKnown: true };
    const beforeDeadline = evaluateWeather(active.weather, clearPayload, config, active.weather.lightningHoldUntil - 1);
    const atDeadline = evaluateWeather(beforeDeadline.weather, clearPayload, config, active.weather.lightningHoldUntil);
    const afterClear = evaluateWeather(atDeadline.weather, { summary: 'Still clear', lightningCoverageKnown: true }, config, active.weather.lightningHoldUntil + 1);

    assert.equal(beforeDeadline.weather.lightningActive, true);
    assert.deepEqual(beforeDeadline.announcements, []);
    assert.equal(atDeadline.weather.lightningActive, false);
    assert.equal(atDeadline.weather.lightningHoldUntil, 0);
    assert.deepEqual(atDeadline.announcements, ['lightning-clear']);
    assert.deepEqual(afterClear.announcements, []);
  });

  test('never emits a lightning all-clear when provider status is unknown', () => {
    const previous = {
      ...createDefaultState(T0).weather,
      lightningActive: true,
      lightningHoldUntil: T0 - 1,
      lastLightningKey: 'strike-a'
    };
    const result = evaluateWeather(previous, {
      ok: true,
      threat: false,
      threatType: '',
      summary: 'No closure trigger detected, but providers failed.',
      providerErrors: ['NOAA GLM timed out'],
      lightningHits: [],
      windHits: []
    }, createDefaultState(T0).config, T0);

    assert.equal(result.weather.lightningActive, true);
    assert.deepEqual(result.announcements, []);
  });

  test('preserves an active wind warning when provider status is unknown', () => {
    const previous = {
      ...createDefaultState(T0).weather,
      windActive: true,
      lastWindAnnouncementAt: T0 - 5_000
    };
    const result = evaluateWeather(previous, { ok: false, providerErrors: ['provider timeout'], threatType: '' }, createDefaultState(T0).config, T0 + 1_000);
    assert.equal(result.weather.windActive, true);
    assert.deepEqual(result.announcements, []);
  });

  test('turns a confirmed tornado warning into an immediate safety announcement', () => {
    const result = evaluateWeather(null, { ok: true, threat: true, threatType: 'Tornado', summary: 'Tornado warning nearby' }, createDefaultState(T0).config, T0);
    assert.equal(result.weather.tornadoActive, true);
    assert.deepEqual(result.announcements, ['tornado']);
  });

  test('deduplicates continuous wind alerts for 30 minutes', () => {
    const wind = { summary: 'Strong gusts', threatType: 'strong wind', windHits: [{ gustMph: 42 }] };
    const first = evaluateWeather(null, wind, config, T0);
    const tooSoon = evaluateWeather(first.weather, wind, config, T0 + 30 * 60_000 - 1);
    const dueAgain = evaluateWeather(tooSoon.weather, wind, config, T0 + 30 * 60_000);

    assert.deepEqual(first.announcements, ['wind']);
    assert.deepEqual(tooSoon.announcements, []);
    assert.deepEqual(dueAgain.announcements, ['wind']);
    assert.equal(dueAgain.weather.lastWindAnnouncementAt, T0 + 30 * 60_000);
  });

  test('clears wind state and announces immediately if wind later returns', () => {
    const wind = { windHits: [{ gustMph: 42 }] };
    const first = evaluateWeather(null, wind, config, T0);
    const clear = evaluateWeather(first.weather, { summary: 'Calm' }, config, T0 + 60_000);
    const returned = evaluateWeather(clear.weather, wind, config, T0 + 2 * 60_000);

    assert.equal(clear.weather.windActive, false);
    assert.deepEqual(returned.announcements, ['wind']);
  });
});

describe('URL, request, and log helpers', () => {
  test('classifies Spotify, Suno, and direct audio URLs without overlap assumptions', () => {
    assert.equal(isSpotifyUrl('spotify:playlist:abc'), true);
    assert.equal(isSpotifyUrl(' https://open.spotify.com/track/abc '), true);
    assert.equal(isSpotifyUrl('https://example.com/track.mp3'), false);

    assert.equal(isSunoUrl('https://suno.com/playlist/abc'), true);
    assert.equal(isSunoUrl('https://www.suno.com/song/abc'), true);
    assert.equal(isSunoUrl('https://suno.com/@artist'), false);

    assert.equal(isDirectAudioUrl('https://cdn.example.com/MUSIC.MP3?token=abc'), true);
    assert.equal(isDirectAudioUrl('https://example.com/listen'), false);
  });

  test('builds weather requests from configured safety thresholds and extras', () => {
    const url = weatherRequestUrl({
      latitude: 36.6,
      longitude: -93.4,
      lightningRadiusMiles: 8,
      windGustMph: 40
    }, { source: 'manual check', ignored: '' });
    const parsed = new URL(url, 'https://example.test');

    assert.equal(parsed.pathname, '/api/weather');
    assert.equal(parsed.searchParams.get('lat'), '36.6');
    assert.equal(parsed.searchParams.get('lon'), '-93.4');
    assert.equal(parsed.searchParams.get('radiusMiles'), '8');
    assert.equal(parsed.searchParams.get('lightningRadiusMiles'), '8');
    assert.equal(parsed.searchParams.get('windGustMph'), '40');
    assert.equal(parsed.searchParams.get('source'), 'manual check');
    assert.equal(parsed.searchParams.has('ignored'), false);
  });

  test('bounds activity log fields while retaining explicit metadata', () => {
    const log = makeLog('announcement'.repeat(10), 't'.repeat(140), 'd'.repeat(800), T0, { eventId: 'event-1' });

    assert.equal(log.kind.length, 40);
    assert.equal(log.title.length, 120);
    assert.equal(log.detail.length, 700);
    assert.equal(log.createdAt, T0);
    assert.equal(log.eventId, 'event-1');
  });
});
