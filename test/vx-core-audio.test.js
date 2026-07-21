import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AudioEngine } from '../src/vx/audio-engine.js';
import {
  ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS,
  DEFAULT_APPLE_MUSIC_PLAYLIST,
  DUCK_LEVEL_PERCENT,
  STATE_VERSION,
  VERSION,
  announcementDeliveryForSource,
  audioPolicy,
  createDefaultState,
  dueTimeScheduleItems,
  enabledTimeSchedules,
  effectiveScheduleItemVolume,
  findScheduleItem,
  isAppleMusicUrl,
  isSpotifyUrl,
  managerVolumePlan,
  normalizeAnnouncementSource,
  normalizeNamedSchedule,
  normalizeScheduleItem,
  normalizeState,
  scheduleDateKey,
  weatherRequestUrl
} from '../src/vx/core.js';

describe('Poolside Pulse Version X state isolation and volume model', () => {
  test('uses the isolated X state namespace and never normalizes back to final', () => {
    assert.equal(VERSION, 'X');
    assert.equal(STATE_VERSION, 'x');
    assert.equal(createDefaultState(1).version, 'x');
    assert.equal(normalizeState({ version: 'final' }, 2).version, 'x');
    assert.match(weatherRequestUrl({ latitude: 1, longitude: 2 }), /[?&]v=x(?:&|$)/);
  });

  test('persists only the two explicit receiver handoff modes without rewriting legacy state', () => {
    assert.equal(createDefaultState(1).config.receiverMode, 'browser');
    assert.equal(normalizeState({ config: { receiverMode: 'browser' } }, 2).config.receiverMode, 'browser');
    assert.equal(normalizeState({ config: { receiverMode: 'pushcut' } }, 2).config.receiverMode, 'pushcut');
    assert.equal(normalizeState({ config: { receiverMode: 'stale-browser' } }, 2).config.receiverMode, 'browser');
    assert.equal(Object.hasOwn(normalizeState({ config: { musicLevel: 30 } }, 2).config, 'receiverMode'), false);
    assert.equal(Object.hasOwn(normalizeState({}, 2).config, 'receiverMode'), false);
  });

  test('forces every saved announcement level to 100 while keeping a full music mute', () => {
    assert.equal(normalizeState({ config: { voiceLevel: 37, duckLevel: 88 } }).config.voiceLevel, 100);
    assert.equal(normalizeState({ config: { voiceLevel: -1 } }).config.voiceLevel, 100);
    assert.equal(normalizeState({ config: { voiceLevel: 101 } }).config.voiceLevel, 100);
    assert.equal(DUCK_LEVEL_PERCENT, 0);
  });

  test('normalizes global and custom scheduled announcements to fixed 100%', () => {
    const globalItem = normalizeScheduleItem({
      type: 'announcement',
      volume: { mode: 'global', percent: 91 }
    });
    const customItem = normalizeScheduleItem({
      action: { kind: 'announcement', announcementSource: 'inline', text: 'Test' },
      volume: { mode: 'custom', percent: 42 }
    });

    assert.equal(globalItem.volume.mode, 'global');
    assert.equal(customItem.volume.mode, 'global');
    assert.equal(effectiveScheduleItemVolume(globalItem, { voiceLevel: 63 }), 100);
    assert.equal(effectiveScheduleItemVolume(customItem, { voiceLevel: 63 }), 100);
  });

  test('normalizes stop and quiet-hours aliases to a zero-volume terminal action', () => {
    for (const requestedKind of ['stop', 'quiet', 'quiet-hours']) {
      const item = normalizeScheduleItem({
        id: `test-${requestedKind}`,
        type: requestedKind,
        time: '22:00',
        announcementId: 'welcome',
        sourceId: 'natural-voice',
        url: 'https://media.example/should-not-survive.mp3',
        provider: 'spotify',
        action: {
          kind: requestedKind,
          announcementSource: 'inline',
          announcementId: 'welcome',
          sourceId: 'natural-voice',
          text: 'This must not play.',
          url: 'https://media.example/should-not-survive.mp3',
          provider: 'spotify'
        },
        volume: { mode: 'custom', percent: 88 },
        advance: { mode: 'manual', durationSeconds: 77 }
      });

      assert.equal(item.action.kind, 'stop');
      assert.equal(item.action.announcementSource, '');
      assert.equal(item.action.announcementId, '');
      assert.equal(item.action.sourceId, '');
      assert.equal(item.action.text, '');
      assert.equal(item.action.url, '');
      assert.equal(item.action.provider, undefined);
      assert.deepEqual(item.volume, { mode: 'global', percent: 0 });
      assert.deepEqual(item.advance, { mode: 'complete', durationSeconds: 300 });
      assert.equal(item.type, 'stop');
      assert.equal(item.time, '22:00');
      assert.equal(item.announcementId, '');
      assert.equal(item.url, '');
      assert.equal(effectiveScheduleItemVolume(item, { musicLevel: 100, voiceLevel: 100 }), 0);
    }
  });

  test('uses the complete Daily Operations default from 10 AM through quiet hours', () => {
    const state = createDefaultState(1);
    const schedule = state.schedules[0];

    assert.equal(schedule.mode, 'time');
    assert.equal(schedule.items.length, 9);
    assert.deepEqual(schedule.items.map(item => [item.time, item.type]), [
      ['10:00', 'announcement'],
      ['10:02', 'apple'],
      ['11:30', 'announcement'],
      ['12:30', 'announcement'],
      ['13:30', 'announcement'],
      ['14:30', 'announcement'],
      ['21:45', 'announcement'],
      ['21:55', 'announcement'],
      ['22:00', 'stop']
    ]);
    assert.equal(schedule.items[0].announcementId, 'welcome');
    assert.equal(schedule.items[1].action.url, DEFAULT_APPLE_MUSIC_PLAYLIST);
    assert.equal(schedule.items.at(-1).volume.percent, 0);
    assert.equal(schedule.items.at(-1).advance.mode, 'complete');
    assert.deepEqual(state.schedule.map(item => [item.time, item.type, item.url, item.announcementId]), [
      ['10:00', 'announcement', '', 'welcome'],
      ['10:02', 'apple', DEFAULT_APPLE_MUSIC_PLAYLIST, ''],
      ['11:30', 'announcement', '', 'no-glass'],
      ['12:30', 'announcement', '', 'owner'],
      ['13:30', 'announcement', '', 'hydrate'],
      ['14:30', 'announcement', '', 'manager'],
      ['21:45', 'announcement', '', 'closing-15'],
      ['21:55', 'announcement', '', 'closing-5'],
      ['22:00', 'stop', '', '']
    ]);
  });

  test('accepts Apple Music web URLs and rejects Spotify, open.apple.com, and arbitrary URLs', () => {
    assert.equal(isAppleMusicUrl('https://music.apple.com/us/album/example/123'), true);
    assert.equal(isAppleMusicUrl('https://music.apple.com/gb/song/example/456'), true);
    assert.equal(isAppleMusicUrl('https://open.apple.com/track/123'), false);
    assert.equal(isAppleMusicUrl('https://open.spotify.com/track/123'), false);
    assert.equal(isAppleMusicUrl('https://example.com/song'), false);
  });

  test('keeps Spotify isolated as a third bed provider with its own URL rules', () => {
    const state = normalizeState({
      config: {
        musicProvider: 'spotify',
        spotifyUrl: 'https://open.spotify.com/playlist/example'
      }
    });
    assert.equal(state.config.musicProvider, 'spotify');
    assert.equal(isSpotifyUrl('https://open.spotify.com/track/example'), true);
    assert.equal(isSpotifyUrl('spotify:playlist:example'), true);
    assert.equal(isSpotifyUrl('https://music.apple.com/us/album/example/123'), false);
    assert.equal(normalizeScheduleItem({ type: 'spotify' }).action.kind, 'spotify');
  });

  test('defaults saved and scheduled announcements to Natural Voice', () => {
    const state = createDefaultState(1);
    assert.equal(state.announcements.every(item => item.sourceId === 'natural-voice'), true);
    const normalized = normalizeState({
      announcements: [{ id: 'custom', label: 'Custom', text: 'Hello' }],
      schedules: [{ id: 'schedule', mode: 'time', items: [{ id: 'item', type: 'announcement', announcementId: 'custom' }] }]
    }, 2);
    assert.equal(normalized.announcements.find(item => item.id === 'custom').sourceId, 'natural-voice');
    assert.equal(normalized.schedules[0].items[0].action.sourceId, 'natural-voice');
  });

  test('preserves concurrent Time schedule controls and honors local cancel and skip dates', () => {
    const wednesdayAtTenChicago = Date.parse('2026-07-15T15:00:30.000Z');
    const daily = normalizeNamedSchedule({
      id: 'daily',
      name: 'Daily',
      mode: 'time',
      enabled: true,
      cancellable: false,
      cancelledDates: ['bad', '2026-07-14', '2026-02-30', '2026-07-14'],
      items: [{
        id: 'morning',
        time: '10:00',
        days: [3],
        protected: true,
        skippedDates: ['2026-07-13', 'nope', '2026-07-13'],
        action: {
          kind: 'announcement',
          announcementId: 'welcome',
          restoreMusicPercent: 37
        }
      }]
    });
    const party = normalizeNamedSchedule({
      id: 'party',
      name: 'Wednesday Party',
      mode: 'time',
      enabled: true,
      cancellable: true,
      cancelledDates: ['2026-07-15'],
      items: [{
        id: 'party-welcome',
        time: '10:00',
        days: [3],
        skippedDates: ['2026-07-15'],
        action: { kind: 'announcement', restoreMusicPercent: 125 }
      }]
    });
    const order = normalizeNamedSchedule({ id: 'manual', mode: 'order', enabled: true, items: [] });
    const disabled = normalizeNamedSchedule({ id: 'disabled', mode: 'time', enabled: false, items: [] });
    const state = { schedules: [daily, party, order, disabled] };

    assert.equal(scheduleDateKey(wednesdayAtTenChicago), '2026-07-15');
    assert.deepEqual(daily.cancelledDates, ['2026-07-14']);
    assert.equal(daily.cancellable, false);
    assert.equal(daily.items[0].protected, true);
    assert.deepEqual(daily.items[0].skippedDates, ['2026-07-13']);
    assert.equal(daily.items[0].action.restoreMusicPercent, 37);
    assert.equal(party.cancellable, true);
    assert.equal(party.items[0].action.restoreMusicPercent, 100);
    assert.deepEqual(enabledTimeSchedules(state).map(schedule => schedule.id), ['daily', 'party']);
    assert.equal(findScheduleItem(state, 'party-welcome')?.schedule.id, 'party');
    assert.equal(findScheduleItem(state, 'missing'), null);
    assert.deepEqual(
      dueTimeScheduleItems(daily, {}, wednesdayAtTenChicago).map(item => item.id),
      ['morning']
    );
    assert.deepEqual(dueTimeScheduleItems(party, {}, wednesdayAtTenChicago), []);
  });

  test('preserves a supported finite announcement clip and its source references', () => {
    const source = normalizeAnnouncementSource({
      id: 'pool-chime',
      label: 'Pool chime',
      kind: 'finite-audio',
      provider: 'suno',
      url: 'https://media.example/pool-chime.mp3',
      finite: true,
      durationSeconds: 18
    });
    assert.equal(source.playbackSupport, 'supported');
    assert.deepEqual(announcementDeliveryForSource(source), {
      announcementMode: 'finite-audio',
      announcementProvider: 'suno',
      announcementAudioUrl: 'https://media.example/pool-chime.mp3',
      announcementDurationSeconds: 18
    });

    const state = normalizeState({
      announcementSources: [source],
      announcements: [{ id: 'custom', label: 'Custom', text: 'Recorded message', sourceId: source.id }],
      schedules: [{
        id: 'schedule',
        mode: 'time',
        items: [{ id: 'item', action: { kind: 'announcement', announcementId: 'custom', sourceId: source.id } }]
      }]
    }, 2);
    assert.equal(state.announcements.find(item => item.id === 'custom').sourceId, source.id);
    assert.equal(state.schedules[0].items[0].action.sourceId, source.id);
  });

  test('rejects unsafe or overlong finite clips and keeps catalog announcement sources experimental', () => {
    assert.equal(ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS, 180);
    const tooLong = normalizeAnnouncementSource({
      id: 'too-long', provider: 'direct', kind: 'finite-audio', finite: true,
      url: 'https://media.example/long.mp3', durationSeconds: 181
    });
    const insecure = normalizeAnnouncementSource({
      id: 'insecure', provider: 'direct', kind: 'finite-audio', finite: true,
      url: 'http://media.example/clip.mp3', durationSeconds: 10
    });
    const apple = normalizeAnnouncementSource({
      id: 'apple-catalog', provider: 'apple', kind: 'media', finite: true,
      url: 'https://music.apple.com/us/song/example/123', durationSeconds: 10
    });
    assert.equal(tooLong.playbackSupport, 'unsupported');
    assert.equal(insecure.playbackSupport, 'unsupported');
    assert.equal(apple.playbackSupport, 'experimental');
    assert.throws(() => announcementDeliveryForSource(apple), /Natural Voice or a supported short/i);
  });

  test('reports fixed 100% announcements in every provider policy', () => {
    const controlled = audioPolicy({ provider: 'controlled', musicPercent: 30, voicePercent: 72 });
    const apple = audioPolicy({ provider: 'apple', musicPercent: 30, voicePercent: 72 });
    assert.equal(controlled.voicePercent, 100);
    assert.equal(apple.voicePercent, 100);
    assert.equal(controlled.duringVoicePercent, 0);
    assert.equal(apple.duringVoicePercent, 0);
    assert.equal(audioPolicy({ provider: 'spotify', musicPercent: 30, voicePercent: 72 }).voicePercent, 100);
  });

  test('labels iPhone Apple Music as physical-volume pause compatibility', () => {
    const policy = audioPolicy({ provider: 'apple', isIOS: true, musicPercent: 41, voicePercent: 68 });
    assert.equal(policy.id, 'apple-ios-pause-only');
    assert.equal(policy.exact, false);
    assert.equal(policy.musicPercent, null);
    assert.match(policy.detail, /receiver iPhone or connected speaker controls/i);
    assert.doesNotMatch(policy.detail, /41% slider/i);
  });

  test('routes an iPhone manager-volume change to the controlled Suno path', () => {
    assert.deepEqual(managerVolumePlan({
      selectedProvider: 'apple',
      receiverIsIOS: true,
      playbackProvider: 'apple',
      playbackIntent: 'playing',
      controlledSource: 'https://suno.com/s/example'
    }), {
      switchToControlled: true,
      nextProvider: 'controlled',
      command: 'play-controlled'
    });

    assert.equal(managerVolumePlan({
      selectedProvider: 'apple',
      receiverIsIOS: true,
      playbackProvider: 'apple',
      playbackIntent: 'playing'
    }).command, 'stop-music');

    assert.equal(managerVolumePlan({
      selectedProvider: 'apple',
      receiverIsIOS: true,
      playbackProvider: 'apple',
      playbackIntent: 'paused',
      controlledSource: 'https://suno.com/s/example'
    }).command, 'stop-music');

    assert.equal(managerVolumePlan({
      selectedProvider: 'apple',
      receiverIsIOS: true,
      playbackProvider: 'apple',
      playbackIntent: 'paused',
      controlledSource: 'https://suno.com/s/example',
      startControlled: true
    }).command, 'play-controlled');

    assert.equal(managerVolumePlan({
      selectedProvider: 'apple',
      receiverIsIOS: false,
      playbackProvider: 'apple',
      playbackIntent: 'playing',
      controlledSource: 'https://suno.com/s/example'
    }).command, 'set-music-level');
  });
});

describe('Version X announcement output level', () => {
  test('keeps the actual audio-engine voice target fixed without requiring a graph', () => {
    const engine = new AudioEngine();
    assert.equal(engine.status().voiceLevelPercent, 100);
    assert.equal(engine.setVoiceLevelPercent(48, { report: false }), 100);
    assert.equal(engine.status().voiceLevelPercent, 100);
    assert.equal(engine.setVoiceLevelPercent(500, { report: false }), 100);
    assert.equal(engine.status().voiceLevelPercent, 100);
  });

  test('clears a stale unlock after iPhone audio resume fails', async () => {
    const engine = new AudioEngine();
    const context = {
      state: 'suspended',
      async resume() { throw new Error('resume blocked'); }
    };
    engine.context = context;
    engine.unlocked = true;
    engine.ensureGraph = () => context;
    engine.primeMusicElement = async () => true;

    await assert.rejects(engine.unlock(), /resume blocked/i);
    assert.equal(engine.unlocked, false);
    assert.equal(engine.status().unlocked, false);
  });

  test('does not treat a fulfilled resume as unlocked while the context stays suspended', async () => {
    const engine = new AudioEngine();
    const context = {
      state: 'suspended',
      async resume() { return true; }
    };
    engine.context = context;
    engine.unlocked = true;
    engine.ensureGraph = () => context;
    engine.primeMusicElement = async () => true;

    await assert.rejects(engine.unlock(), /audio is suspended/i);
    assert.equal(engine.status().unlocked, false);
    assert.equal(engine.musicPlaying(), false);
  });
});
