import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  manualWeatherStatusAnnouncement,
  prepareImmediateWeatherAnnouncement,
  preparePendingWeatherAnnouncement,
  sameWeatherConfig
} from '../src/vx/weather-command.js';

const config = {
  latitude: 36.6337,
  longitude: -93.4166,
  lightningRadiusMiles: 10,
  lightningHoldMinutes: 30,
  windGustMph: 35
};

const announcements = [
  { id: 'lightning', label: 'Lightning Hold', text: '' },
  { id: 'lightning-clear', label: 'Lightning All Clear', text: '' },
  { id: 'wind', label: 'Wind Warning', text: 'Please close all umbrellas now.' },
  { id: 'tornado', label: 'Tornado Warning', text: 'Take shelter now.' }
];

describe('Version X immediate Pushcut weather planning', () => {
  test('a new lightning strike creates one staged immediate safety announcement', () => {
    const now = 1_780_000_000_000;
    const plan = prepareImmediateWeatherAnnouncement({
      previousWeather: {},
      payload: {
        ok: true,
        threat: true,
        threatType: 'Lightning',
        summary: 'Lightning detected.',
        lightningRadiusMiles: 8,
        lightningCoverageKnown: true,
        tornadoCoverageKnown: true,
        windCoverageKnown: true,
        lightningHits: [{ id: 'strike-1', distanceMI: 4.2 }]
      },
      config,
      savedAnnouncements: announcements,
      now
    });

    assert.deepEqual(plan.announcementIds, ['lightning']);
    assert.match(plan.text, /8 miles/i);
    assert.equal(plan.stagedWeather.pendingAnnouncementIds[0], 'lightning');
    assert.equal(plan.stagedWeather.lastLightningAnnouncementAt, 0);
    assert.equal(plan.completedWeather.lastLightningAnnouncementAt, now);
  });

  test('a clear result updates weather without dispatching audio', () => {
    const plan = prepareImmediateWeatherAnnouncement({
      previousWeather: {},
      payload: {
        ok: true,
        threat: false,
        summary: 'Clear.',
        lightningCoverageKnown: true,
        tornadoCoverageKnown: true,
        windCoverageKnown: true,
        lightningHits: [],
        windHits: []
      },
      config,
      savedAnnouncements: announcements,
      now: 1_780_000_000_000
    });

    assert.deepEqual(plan.announcementIds, []);
    assert.equal(plan.text, '');
    assert.deepEqual(plan.completedWeather.pendingAnnouncementIds, []);
  });

  test('gives every manual check a concise spoken result while automatic clear scans stay silent', () => {
    const clearPayload = {
      ok: true,
      threat: false,
      lightningCoverageKnown: true,
      tornadoCoverageKnown: true,
      windCoverageKnown: true,
      providerErrors: []
    };
    const clearPlan = prepareImmediateWeatherAnnouncement({
      previousWeather: {},
      payload: clearPayload,
      config,
      savedAnnouncements: announcements,
      now: 1_780_000_000_000
    });

    assert.equal(clearPlan.text, '', 'the automatic/new-warning planner must remain quiet');
    assert.match(manualWeatherStatusAnnouncement({ payload: clearPayload }), /no lightning, tornado warning, or strong wind/i);
    assert.match(manualWeatherStatusAnnouncement({
      payload: { ...clearPayload, threat: true, threatType: 'Lightning' }
    }), /lightning is active/i);
    assert.match(manualWeatherStatusAnnouncement({
      payload: { ...clearPayload, lightningCoverageKnown: false, providerErrors: ['timeout'] }
    }), /part of the weather data is unavailable/i);
    assert.match(manualWeatherStatusAnnouncement({ payload: null }), /could not be completed/i);
  });

  test('staging preserves the old repeat marker so failed speech remains retryable', () => {
    const now = 1_780_000_000_000;
    const previousWeather = {
      windActive: false,
      lastWindAnnouncementAt: 0
    };
    const plan = prepareImmediateWeatherAnnouncement({
      previousWeather,
      payload: {
        ok: true,
        threat: true,
        threatType: 'Strong Wind',
        summary: 'Strong wind.',
        lightningCoverageKnown: true,
        tornadoCoverageKnown: true,
        windCoverageKnown: true,
        windHits: [{ gustMph: 45 }]
      },
      config,
      savedAnnouncements: announcements,
      now
    });

    assert.deepEqual(plan.announcementIds, ['wind']);
    assert.equal(plan.stagedWeather.lastWindAnnouncementAt, 0);
    assert.equal(plan.completedWeather.lastWindAnnouncementAt, now);
  });

  test('replays a fresh durable wind warning before a new weather scan', () => {
    const now = 1_780_000_000_000;
    const plan = preparePendingWeatherAnnouncement({
      weather: {
        pendingAnnouncementIds: ['wind'],
        pendingAnnouncementAt: now - 30_000,
        pendingAnnouncementConfig: config,
        pendingAnnouncementCommit: {
          status: 'Strong wind warning committed.',
          lastWindAnnouncementAt: now - 30_000
        }
      },
      savedAnnouncements: announcements,
      config,
      now
    });

    assert.deepEqual(plan.announcementIds, ['wind']);
    assert.match(plan.text, /close all umbrellas/i);
    assert.match(plan.label, /durable retry/i);
    assert.equal(plan.committedWeather.status, 'Strong wind warning committed.');
    assert.deepEqual(plan.committedWeather.pendingAnnouncementIds, []);
  });

  test('uses the lightning hold deadline and ignores an expired pending warning', () => {
    const now = 1_780_000_000_000;
    const pendingAt = now - 12 * 60_000;
    const fresh = preparePendingWeatherAnnouncement({
      weather: {
        pendingAnnouncementIds: ['lightning'],
        pendingAnnouncementAt: pendingAt,
        pendingAnnouncementConfig: { ...config, lightningRadiusMiles: 7, lightningHoldMinutes: 30 },
        pendingAnnouncementCommit: { lightningHoldUntil: now + 60_000 }
      },
      savedAnnouncements: announcements,
      config,
      now
    });
    assert.match(fresh.text, /7 miles/i);

    const expired = preparePendingWeatherAnnouncement({
      weather: {
        pendingAnnouncementIds: ['lightning'],
        pendingAnnouncementAt: pendingAt,
        pendingAnnouncementConfig: { ...config, lightningHoldMinutes: 5 },
        pendingAnnouncementCommit: { lightningHoldUntil: now - 1 }
      },
      savedAnnouncements: announcements,
      config,
      now
    });
    assert.equal(expired, null);
  });

  test('detects a location or threshold change during a remote scan', () => {
    assert.equal(sameWeatherConfig(config, { ...config }), true);
    assert.equal(sameWeatherConfig(config, { ...config, latitude: config.latitude + 0.1 }), false);
    assert.equal(sameWeatherConfig(config, { ...config, windGustMph: config.windGustMph + 1 }), false);
  });
});
