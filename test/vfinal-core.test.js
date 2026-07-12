import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_SCHEDULE_ID,
  DUCK_LEVEL_PERCENT,
  EVENT_TTL_MS,
  LIGHTNING_ANNOUNCEMENT_REPEAT_MS,
  MAX_SCHEDULE_ITEMS,
  MUSIC_LEVEL_PERCENT,
  RECEIVER_LEASE_MS,
  SAFETY_EVENT_TTL_MS,
  SCHEDULE_CATCHUP_MS,
  SCHEDULE_CLAIM_MS,
  SCHEDULE_DURATION_DEFAULT_SECONDS,
  SCHEDULE_DURATION_MAX_SECONDS,
  SCHEDULE_DURATION_MIN_SECONDS,
  VOICE_LEVEL_PERCENT,
  WEATHER_INTERVAL_MS,
  audioPolicy,
  cancelSequenceRun,
  clamp,
  completeEvent,
  createDefaultState,
  createTargetedEvent,
  dueScheduleItems,
  dueTimeScheduleItems,
  effectiveScheduleItemVolume,
  evaluateWeather,
  eventBelongsToReceiver,
  getActiveSchedule,
  inlineAnnouncementText,
  isDirectAudioUrl,
  isSpotifyUrl,
  isSunoUrl,
  makeId,
  makeLog,
  makeReceiverLease,
  normalizeNamedSchedule,
  normalizeScheduleItem,
  normalizeSequenceRun,
  normalizeSequenceRuns,
  normalizeState,
  nextOrderScheduleItem,
  orderedEnabledScheduleItems,
  pendingEventsForReceiver,
  receiverOnline,
  reorderScheduleItems,
  resolveScheduleAnnouncementText,
  renewReceiverLease,
  weatherRequestUrl
} from '../src/vfinal/core.js';

const T0 = 1_800_000_000_000;

describe('adjustable mix state and foundational helpers', () => {
  test('publishes a 30% music default with fixed 100% voice and a full music mute during speech', () => {
    assert.equal(MUSIC_LEVEL_PERCENT, 30);
    assert.equal(VOICE_LEVEL_PERCENT, 100);
    assert.equal(DUCK_LEVEL_PERCENT, 0);
  });

  test('normalization preserves adjustable music while overriding hostile voice and duck values', () => {
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
    assert.equal(normalized.config.musicLevel, 99);
    assert.equal(normalized.config.voiceLevel, 100);
    assert.equal(normalized.config.duckLevel, 0);
    assert.equal(normalized.config.weatherIntervalMinutes, 2);

    const renormalized = normalizeState(normalized, T0 + 1);
    assert.equal(renormalized.config.musicLevel, 99);
    assert.equal(renormalized.config.voiceLevel, 100);
    assert.equal(renormalized.config.duckLevel, 0);
  });

  test('normalization clamps music to 0-100 and falls back to the 30% default', () => {
    const cases = [
      { value: -1, expected: 0 },
      { value: 0, expected: 0 },
      { value: 42, expected: 42 },
      { value: 100, expected: 100 },
      { value: 101, expected: 100 },
      { value: 'not-a-level', expected: 30 }
    ];

    for (const { value, expected } of cases) {
      const normalized = normalizeState({
        config: { musicLevel: value, voiceLevel: value, duckLevel: value }
      }, T0);
      assert.equal(normalized.config.musicLevel, expected);
      assert.equal(normalized.config.voiceLevel, 100);
      assert.equal(normalized.config.duckLevel, 0);
    }
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
    first.schedules[0].items[0].label = 'named mutation';

    assert.notEqual(second.announcements[0].label, 'mutated');
    assert.equal(second.schedule[0].days.length, 7);
    assert.notEqual(second.schedules[0].items[0].label, 'named mutation');
    assert.notStrictEqual(first.schedule, first.schedules[0].items);
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

describe('named schedule model and migration', () => {
  const allDays = [0, 1, 2, 3, 4, 5, 6];

  test('default state exposes one active named time schedule and a separate legacy projection', () => {
    const state = createDefaultState(T0);
    const active = getActiveSchedule(state);

    assert.equal(state.activeScheduleId, DEFAULT_SCHEDULE_ID);
    assert.equal(active.id, DEFAULT_SCHEDULE_ID);
    assert.equal(active.name, 'Daily Schedule');
    assert.equal(active.mode, 'time');
    assert.deepEqual(state.schedule.map(item => item.id), active.items.map(item => item.id));
    assert.notStrictEqual(state.schedule, active.items);
    assert.deepEqual(active.items.map(item => item.position.order), [1, 2, 3, 4, 5, 6]);
  });

  test('migrates a legacy schedule once without changing item IDs or run receipts', () => {
    const receipts = {
      'legacy-welcome': '2027-01-14',
      'legacy-song': { dateKey: '2027-01-14', status: 'completed', completedAt: T0 - 1 }
    };
    const migrated = normalizeState({
      schedule: [
        { id: 'legacy-welcome', label: 'Welcome', type: 'announcement', time: '09:00', announcementId: 'welcome', enabled: true, days: allDays },
        { id: 'legacy-song', label: 'Song', type: 'controlled', time: '09:10', url: 'https://cdn.example.test/song.mp3', enabled: true, days: [1] }
      ],
      scheduleRuns: receipts
    }, T0);

    assert.equal(migrated.activeScheduleId, 'legacy-schedule');
    assert.equal(migrated.schedules.length, 1);
    assert.equal(migrated.schedules[0].id, 'legacy-schedule');
    assert.deepEqual(migrated.schedules[0].items.map(item => item.id), ['legacy-welcome', 'legacy-song']);
    assert.deepEqual(migrated.schedule.map(item => item.id), ['legacy-welcome', 'legacy-song']);
    assert.deepEqual(migrated.scheduleRuns, receipts);
    assert.deepEqual(normalizeState(migrated, T0), migrated, 'normalizing the migrated state again must not drift');
  });

  test('selects the requested named schedule and keeps the legacy timer inert for Order mode', () => {
    const state = normalizeState({
      activeScheduleId: 'playlist',
      schedules: [
        { id: 'clock', name: 'Clock day', mode: 'time', items: [{ id: 'clock-item', time: '12:30', enabled: true }] },
        { id: 'playlist', name: 'Pool rotation', mode: 'order', items: [{ id: 'order-item', order: 1, enabled: true }] }
      ]
    }, T0);

    assert.equal(getActiveSchedule(state).id, 'playlist');
    assert.equal(getActiveSchedule(state).mode, 'order');
    assert.deepEqual(state.schedule, []);

    const switched = normalizeState({ ...state, activeScheduleId: 'clock' }, T0);
    assert.equal(getActiveSchedule(switched).id, 'clock');
    assert.deepEqual(switched.schedule.map(item => item.id), ['clock-item']);
  });

  test('reconciles edits from a legacy time-schedule client without overriding newer named edits', () => {
    const initial = normalizeState(createDefaultState(T0), T0);
    initial.schedule[0].time = '08:15';
    initial.schedule[0].label = 'Legacy edit';
    const legacyEdited = normalizeState(initial, T0);

    assert.equal(legacyEdited.schedules[0].items[0].position.time, '08:15');
    assert.equal(legacyEdited.schedules[0].items[0].label, 'Legacy edit');

    legacyEdited.schedules[0].items[0].position.time = '08:45';
    legacyEdited.schedules[0].items[0].label = 'Named edit';
    const namedEdited = normalizeState(legacyEdited, T0);
    assert.equal(namedEdited.schedule[0].time, '08:45');
    assert.equal(namedEdited.schedule[0].label, 'Named edit');
  });

  test('preserves rich schedule fields through a legacy-client round trip while normalizing the speech gate', () => {
    const rich = normalizeState({
      activeScheduleId: 'rich-time',
      schedules: [{
        id: 'rich-time',
        name: 'Rich Time',
        mode: 'time',
        items: [{
          id: 'inline-rich',
          label: 'Inline rich announcement',
          time: '10:15',
          action: { kind: 'announcement', announcementSource: 'inline', text: 'Do not lose me.' },
          volume: { mode: 'custom', percent: 77 },
          advance: { mode: 'duration', durationSeconds: 42 }
        }]
      }]
    }, T0);
    const legacyProjection = rich.schedule.map(item => ({
      id: item.id,
      label: item.label,
      type: item.type,
      time: item.time,
      announcementId: item.announcementId,
      url: item.url,
      enabled: item.enabled,
      days: item.days
    }));
    const roundTripped = normalizeState({ ...rich, schedule: legacyProjection }, T0 + 1);
    const item = getActiveSchedule(roundTripped).items[0];

    assert.equal(item.action.announcementSource, 'inline');
    assert.equal(item.action.text, 'Do not lose me.');
    assert.deepEqual(item.volume, { mode: 'custom', percent: 77 });
    assert.deepEqual(item.advance, { mode: 'complete', durationSeconds: 42 });
    assert.deepEqual(normalizeState(roundTripped, T0 + 2), roundTripped);
  });

  test('merges legacy edits, deletion, reorder, and addition without erasing rich-only fields', () => {
    const initial = normalizeState({
      activeScheduleId: 'legacy-editable',
      schedules: [{
        id: 'legacy-editable',
        name: 'Legacy Editable',
        mode: 'time',
        items: [
          { id: 'a', label: 'A', type: 'announcement', time: '09:00', action: { announcementSource: 'inline', text: 'Keep A text' }, volume: { mode: 'custom', percent: 61 }, advance: { mode: 'duration', durationSeconds: 11 } },
          { id: 'b', label: 'B', type: 'controlled', time: '09:10', url: 'https://audio.test/b.mp3', volume: { mode: 'custom', percent: 22 } },
          { id: 'c', label: 'C', type: 'controlled', time: '09:20', url: 'https://audio.test/c.mp3', action: { text: 'Keep C metadata' }, volume: { mode: 'custom', percent: 44 }, advance: { mode: 'duration', durationSeconds: 33 } }
        ]
      }]
    }, T0);
    const originalA = structuredClone(getActiveSchedule(initial).items.find(item => item.id === 'a'));
    const originalC = structuredClone(getActiveSchedule(initial).items.find(item => item.id === 'c'));
    const legacyEditedProjection = [
      { id: 'c', label: 'C edited', type: 'spotify', time: '08:45', announcementId: '', url: 'https://open.spotify.com/track/c', enabled: true, days: [1, 3] },
      { id: 'a', label: 'A', type: 'announcement', time: '09:00', announcementId: '', url: '', enabled: false, days: [2] },
      { id: 'd', label: 'D added', type: 'controlled', time: '09:30', announcementId: '', url: 'https://audio.test/d.mp3', enabled: true, days: allDays }
    ];
    const reconciled = normalizeState({ ...initial, schedule: legacyEditedProjection }, T0 + 1);
    const items = getActiveSchedule(reconciled).items;

    assert.deepEqual(items.map(item => item.id), ['c', 'a', 'd']);
    assert.deepEqual(items.map(item => item.position.order), [1, 2, 3]);
    assert.equal(items[0].label, 'C edited');
    assert.equal(items[0].action.kind, 'spotify');
    assert.equal(items[0].action.url, 'https://open.spotify.com/track/c');
    assert.equal(items[0].position.time, '08:45');
    assert.deepEqual(items[0].days, [1, 3]);
    assert.equal(items[0].action.text, originalC.action.text);
    assert.deepEqual(items[0].volume, originalC.volume);
    assert.deepEqual(items[0].advance, originalC.advance);
    assert.equal(items[1].enabled, false);
    assert.deepEqual(items[1].days, [2]);
    assert.equal(items[1].action.text, originalA.action.text);
    assert.deepEqual(items[1].volume, originalA.volume);
    assert.deepEqual(items[1].advance, originalA.advance);
    assert.equal(items[2].action.kind, 'controlled');
    assert.deepEqual(items[2].volume, { mode: 'global', percent: 30 });
    assert.equal(items[2].advance.mode, 'manual');
  });

  test('normalizes bounded item fields, aliases, days, volume, and duration', () => {
    const url = `https://cdn.example.test/${'u'.repeat(2200)}.mp3`;
    const item = normalizeScheduleItem({
      id: `  ${'i'.repeat(140)}  `,
      label: `  ${'L'.repeat(130)}  `,
      days: [6, '1', 6, -1, 2.5, 9],
      position: { time: '9:07', order: 999 },
      action: {
        kind: 'suno',
        announcementSource: 'inline',
        announcementId: 'a'.repeat(140),
        text: `  ${'T'.repeat(1_000)}  `,
        url: `  ${url}  `
      },
      volume: { mode: 'custom', percent: 500 },
      advance: { mode: 'duration', durationSeconds: 0 }
    }, 3);

    assert.equal(item.id.length, 120);
    assert.equal(item.label.length, 100);
    assert.deepEqual(item.days, [1, 6]);
    assert.deepEqual(item.position, { time: '09:07', order: 100 });
    assert.equal(item.action.kind, 'controlled');
    assert.equal(item.action.announcementSource, 'inline');
    assert.equal(item.action.announcementId.length, 120);
    assert.equal(item.action.text.length, 900);
    assert.equal(item.action.url.length, 2000);
    assert.deepEqual(item.volume, { mode: 'custom', percent: 100 });
    assert.deepEqual(item.advance, { mode: 'duration', durationSeconds: SCHEDULE_DURATION_MIN_SECONDS });
    assert.equal(item.type, item.action.kind);
    assert.equal(item.time, item.position.time);
    assert.equal(item.order, item.position.order);
    assert.equal(item.announcementId, item.action.announcementId);
    assert.equal(item.url, item.action.url);
  });

  test('bounds duration at one day and chooses practical action defaults', () => {
    const announcement = normalizeScheduleItem({ id: 'announcement' });
    const track = normalizeScheduleItem({ id: 'track', type: 'spotify' });
    const tooLong = normalizeScheduleItem({
      id: 'duration',
      type: 'controlled',
      advance: { mode: 'duration', durationSeconds: SCHEDULE_DURATION_MAX_SECONDS + 10 }
    });

    assert.equal(SCHEDULE_DURATION_DEFAULT_SECONDS, 300);
    assert.equal(announcement.advance.mode, 'complete');
    assert.equal(announcement.advance.durationSeconds, SCHEDULE_DURATION_DEFAULT_SECONDS);
    assert.equal(track.advance.mode, 'manual');
    assert.equal(tooLong.advance.durationSeconds, SCHEDULE_DURATION_MAX_SECONDS);
    for (const mode of ['complete', 'track-end', 'duration', 'manual']) {
      assert.equal(normalizeScheduleItem({ id: mode, type: 'controlled', advance: { mode } }).advance.mode, mode);
    }
  });

  test('forces announcements to complete and defaults all music to a manual gate', () => {
    for (const mode of ['manual', 'duration', 'track-end', 'complete', 'malformed']) {
      assert.equal(
        normalizeScheduleItem({ id: `voice-${mode}`, type: 'announcement', advance: { mode } }).advance.mode,
        'complete'
      );
    }
    assert.equal(normalizeScheduleItem({ id: 'direct', type: 'controlled' }).advance.mode, 'manual');
    assert.equal(normalizeScheduleItem({ id: 'spotify', type: 'spotify' }).advance.mode, 'manual');
  });

  test('caps each schedule at 100 items and produces stable contiguous order values', () => {
    const capped = normalizeNamedSchedule({
      id: 'large',
      name: 'Large schedule',
      mode: 'order',
      items: Array.from({ length: MAX_SCHEDULE_ITEMS + 5 }, (_, index) => ({ id: `item-${index}` }))
    });
    const sorted = normalizeNamedSchedule({
      id: 'sorted',
      items: [
        { id: 'third', order: 3 },
        { id: 'first-a', order: 1 },
        { id: 'first-b', order: 1 }
      ]
    });

    assert.equal(capped.items.length, MAX_SCHEDULE_ITEMS);
    assert.deepEqual(capped.items.map(item => item.order), Array.from({ length: MAX_SCHEDULE_ITEMS }, (_, index) => index + 1));
    assert.deepEqual(sorted.items.map(item => item.id), ['first-a', 'first-b', 'third']);
    assert.deepEqual(sorted.items.map(item => item.position.order), [1, 2, 3]);
  });

  test('keeps a valid 100-item inline schedule below the persisted state limit', () => {
    const state = normalizeState({
      activeScheduleId: 'capacity',
      schedules: [{
        id: 'capacity',
        name: 'Capacity schedule',
        mode: 'time',
        items: Array.from({ length: MAX_SCHEDULE_ITEMS }, (_, index) => ({
          id: `capacity-${index}`,
          label: `Item ${index} ${'L'.repeat(90)}`,
          time: `${String(Math.floor(index / 5) % 24).padStart(2, '0')}:${String((index % 5) * 10).padStart(2, '0')}`,
          action: { kind: 'announcement', announcementSource: 'inline', text: `Message ${index} ${'T'.repeat(880)}` }
        }))
      }]
    }, T0);

    assert.equal(getActiveSchedule(state).items.length, MAX_SCHEDULE_ITEMS);
    assert.ok(JSON.stringify(state).length < 200_000, 'maximum valid schedule must fit the API persistence limit');
    assert.equal(Object.hasOwn(state.schedule[0], 'action'), false, 'legacy projection must not duplicate rich fields');
  });

  test('reorders immutably and keeps nested and legacy order fields synchronized', () => {
    const original = normalizeNamedSchedule({
      id: 'rotation',
      mode: 'order',
      items: [{ id: 'one' }, { id: 'two' }, { id: 'three' }]
    }).items;
    const reordered = reorderScheduleItems(original, 'three', 1);

    assert.deepEqual(original.map(item => item.id), ['one', 'two', 'three']);
    assert.deepEqual(reordered.map(item => item.id), ['three', 'one', 'two']);
    assert.deepEqual(reordered.map(item => item.order), [1, 2, 3]);
    assert.deepEqual(reordered.map(item => item.position.order), [1, 2, 3]);
    assert.deepEqual(reorderScheduleItems(reordered, 'missing', 2), reordered);
  });

  test('resolves global and custom item volumes by action kind', () => {
    const announcement = normalizeScheduleItem({ id: 'voice', type: 'announcement' });
    const music = normalizeScheduleItem({ id: 'music', type: 'controlled' });
    const custom = normalizeScheduleItem({ id: 'custom', type: 'spotify', volume: { mode: 'custom', percent: 47 } });

    assert.equal(effectiveScheduleItemVolume(announcement, { voiceLevel: 100, musicLevel: 22 }), 100);
    assert.equal(effectiveScheduleItemVolume(music, { voiceLevel: 100, musicLevel: 22 }), 22);
    assert.equal(effectiveScheduleItemVolume(custom, { musicLevel: 22 }), 47);
    assert.equal(effectiveScheduleItemVolume(music, 19), 19);
  });

  test('keeps custom inline speech separate from saved announcements', () => {
    const saved = normalizeScheduleItem({
      id: 'saved',
      action: { kind: 'announcement', announcementSource: 'saved', announcementId: 'welcome' }
    });
    const inline = normalizeScheduleItem({
      id: 'inline',
      action: { kind: 'announcement', announcementSource: 'inline', announcementId: 'welcome', text: '  Custom pool message  ' }
    });
    const emptyInline = normalizeScheduleItem({
      id: 'empty-inline',
      action: { kind: 'announcement', announcementSource: 'inline', announcementId: 'welcome', text: '' }
    });
    const announcements = [{ id: 'welcome', text: 'Saved welcome' }];

    assert.equal(inlineAnnouncementText(saved), '');
    assert.equal(inlineAnnouncementText(inline), 'Custom pool message');
    assert.equal(resolveScheduleAnnouncementText(saved, announcements), 'Saved welcome');
    assert.equal(resolveScheduleAnnouncementText(inline, announcements), 'Custom pool message');
    assert.equal(resolveScheduleAnnouncementText(emptyInline, announcements), '');
  });

  test('migrates the legacy order cursor into a stable durable run record', () => {
    const legacy = { order: 2, itemId: 'second', updatedAt: T0 };
    const normalized = normalizeSequenceRun(legacy);

    assert.deepEqual(normalized, {
      version: 1,
      order: 2,
      itemId: 'second',
      status: 'idle',
      active: null,
      lastTriggerId: '',
      lastOutcome: '',
      lastError: '',
      updatedAt: T0
    });
    assert.deepEqual(normalizeSequenceRun(normalized), normalized);
  });

  test('bounds rich run fields and drops unsafe or unknown persisted values', () => {
    const schedules = [{ id: 'known-order', mode: 'order', items: [] }];
    const runs = normalizeSequenceRuns({
      'known-order': {
        version: 999,
        order: 500,
        itemId: ` ${'i'.repeat(150)} `,
        status: 'waiting-duration',
        active: {
          token: ` ${'t'.repeat(200)} `,
          triggerId: ` ${'g'.repeat(200)} `,
          itemId: 'active-item',
          order: 999,
          kind: 'spotify',
          advanceMode: 'duration',
          receiverId: ` ${'r'.repeat(200)} `,
          sessionId: ` ${'s'.repeat(200)} `,
          claimedAt: -1,
          startedAt: T0 + 1,
          dueAt: Number.POSITIVE_INFINITY,
          expectedProvider: 'SPOTIFY',
          expectedUrl: ` https://example.test/${'u'.repeat(2200)} `
        },
        lastTriggerId: 'x'.repeat(300),
        lastOutcome: 'armed',
        lastError: ` ${'e'.repeat(400)} `,
        updatedAt: Number.MAX_SAFE_INTEGER + 1_000
      },
      unknown: { order: 1, itemId: 'never-keep-me' }
    }, schedules);

    assert.deepEqual(Object.keys(runs), ['known-order']);
    const run = runs['known-order'];
    assert.equal(run.version, 1);
    assert.equal(run.order, MAX_SCHEDULE_ITEMS);
    assert.equal(run.itemId.length, 120);
    assert.equal(run.active.token.length, 160);
    assert.equal(run.active.triggerId.length, 160);
    assert.equal(run.active.order, MAX_SCHEDULE_ITEMS);
    assert.equal(run.active.kind, 'spotify');
    assert.equal(run.active.advanceMode, 'duration');
    assert.equal(run.active.receiverId.length, 160);
    assert.equal(run.active.sessionId.length, 160);
    assert.equal(run.active.claimedAt, 0);
    assert.equal(run.active.startedAt, T0 + 1);
    assert.equal(run.active.dueAt, 0);
    assert.equal(run.active.expectedProvider, 'spotify');
    assert.equal(run.active.expectedUrl.length, 2000);
    assert.equal(run.lastTriggerId.length, 160);
    assert.equal(run.lastOutcome, 'armed');
    assert.equal(run.lastError.length, 300);
    assert.equal(run.updatedAt, Number.MAX_SAFE_INTEGER);

    const invalid = normalizeSequenceRun({
      status: 'hostile',
      active: { token: '', itemId: 'item', order: 1 },
      lastOutcome: 'invented'
    });
    assert.equal(invalid.status, 'idle');
    assert.equal(invalid.active, null);
    assert.equal(invalid.lastOutcome, '');
  });

  test('normalizes sequence runs in state and keeps only known schedule IDs', () => {
    const state = normalizeState({
      activeScheduleId: 'rotation',
      schedules: [{
        id: 'rotation',
        name: 'Rotation',
        mode: 'order',
        items: [{ id: 'one', type: 'controlled' }]
      }],
      sequenceRuns: {
        rotation: { order: 1, itemId: 'one', updatedAt: T0 },
        removed: { order: 99, itemId: 'old' }
      }
    }, T0);

    assert.equal(createDefaultState(T0).sequenceRuns && Object.keys(createDefaultState(T0).sequenceRuns).length, 0);
    assert.deepEqual(Object.keys(state.sequenceRuns), ['rotation']);
    assert.equal(state.sequenceRuns.rotation.order, 1);
    assert.equal(state.sequenceRuns.rotation.itemId, 'one');
    assert.equal(state.sequenceRuns.rotation.status, 'idle');
    assert.deepEqual(normalizeState(state, T0), state);
  });

  test('skips disabled Order items and never wraps after the final committed order', () => {
    const schedule = normalizeNamedSchedule({
      id: 'rotation',
      mode: 'order',
      items: [
        { id: 'one', order: 1, enabled: true },
        { id: 'two-disabled', order: 2, enabled: false },
        { id: 'three', order: 3, enabled: true }
      ]
    });

    assert.deepEqual(orderedEnabledScheduleItems(schedule).map(item => item.id), ['one', 'three']);
    assert.equal(nextOrderScheduleItem(schedule, 0)?.id, 'one');
    assert.equal(nextOrderScheduleItem(schedule, 1)?.id, 'three');
    assert.equal(nextOrderScheduleItem(schedule, 2)?.id, 'three');
    assert.equal(nextOrderScheduleItem(schedule, 3), null);
    assert.equal(nextOrderScheduleItem(schedule, 100), null);
    assert.deepEqual(orderedEnabledScheduleItems({ ...schedule, mode: 'time' }), []);
    assert.equal(nextOrderScheduleItem({ ...schedule, enabled: false }, 0), null);
  });

  test('cancellation preserves the committed cursor and active trigger replay guard', () => {
    const cancelled = cancelSequenceRun({
      order: 2,
      itemId: 'two',
      status: 'waiting-duration',
      active: {
        token: 'step-token',
        triggerId: 'event-123',
        itemId: 'three',
        order: 3,
        kind: 'controlled',
        advanceMode: 'duration'
      },
      lastTriggerId: 'event-old',
      lastOutcome: 'armed',
      updatedAt: T0 - 1
    }, T0, ` Reset requested ${'x'.repeat(400)} `);

    assert.equal(cancelled.order, 2);
    assert.equal(cancelled.itemId, 'two');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.active, null);
    assert.equal(cancelled.lastTriggerId, 'event-123');
    assert.equal(cancelled.lastOutcome, 'cancelled');
    assert.equal(cancelled.lastError.length, 300);
    assert.equal(cancelled.updatedAt, T0);
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

  test('accepts a named Time schedule with nested positions and rejects Order schedules', () => {
    const timeSchedule = normalizeNamedSchedule({
      id: 'clock',
      mode: 'time',
      items: [{ id: 'nested-time', enabled: true, days: [1], position: { time: '12:30', order: 1 } }]
    });
    const orderSchedule = { ...timeSchedule, mode: 'order' };

    assert.deepEqual(
      dueTimeScheduleItems(timeSchedule, {}, mondayAt123045Chicago, 'America/Chicago').map(item => item.id),
      ['nested-time']
    );
    assert.deepEqual(dueTimeScheduleItems(orderSchedule, {}, mondayAt123045Chicago, 'America/Chicago'), []);
    assert.deepEqual(dueTimeScheduleItems({ ...timeSchedule, enabled: false }, {}, mondayAt123045Chicago, 'America/Chicago'), []);
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
  test('controlled Suno/direct playback uses the adjustable target with voice fixed at 100%', () => {
    const policy = audioPolicy({ provider: 'controlled', isIOS: true, supportsVolume: false, musicPercent: 42 });

    assert.deepEqual({
      id: policy.id,
      exact: policy.exact,
      musicPercent: policy.musicPercent,
      voicePercent: policy.voicePercent,
      duringVoicePercent: policy.duringVoicePercent,
      action: policy.action
    }, {
      id: 'controlled-adjustable-duck',
      exact: true,
      musicPercent: 42,
      voicePercent: 100,
      duringVoicePercent: 0,
      action: 'duck'
    });

    const quietTarget = audioPolicy({ provider: 'controlled', musicPercent: 4 });
    assert.equal(quietTarget.duringVoicePercent, 0, 'every controlled music target must mute fully during speech');
  });

  test('desktop Spotify with verified volume support uses 30% and pauses for voice', () => {
    const policy = audioPolicy({
      provider: 'spotify',
      isIOS: false,
      supportsVolume: true,
      volumeVerified: true,
      verifiedPercent: 30,
      musicPercent: 30
    });

    assert.equal(policy.id, 'spotify-verified-volume-pause');
    assert.equal(policy.exact, true);
    assert.equal(policy.musicPercent, 30);
    assert.equal(policy.voicePercent, 100);
    assert.equal(policy.duringVoicePercent, 0);
    assert.equal(policy.action, 'pause');
  });

  test('Spotify exactness requires verifiedPercent to match a non-30 target', () => {
    const verified = audioPolicy({
      provider: 'spotify',
      isIOS: false,
      supportsVolume: true,
      volumeVerified: true,
      verifiedPercent: 42,
      musicPercent: 42
    });
    const staleVerification = audioPolicy({
      provider: 'spotify',
      isIOS: false,
      supportsVolume: true,
      volumeVerified: true,
      verifiedPercent: 30,
      musicPercent: 42
    });

    assert.equal(verified.id, 'spotify-verified-volume-pause');
    assert.equal(verified.exact, true);
    assert.equal(verified.musicPercent, 42);
    assert.equal(staleVerification.id, 'spotify-unverified-pause-only');
    assert.equal(staleVerification.exact, false);
    assert.equal(staleVerification.musicPercent, null);
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
