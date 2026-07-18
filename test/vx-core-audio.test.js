import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AudioEngine } from '../src/vx/audio-engine.js';
import {
  ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS,
  DUCK_LEVEL_PERCENT,
  STATE_VERSION,
  VERSION,
  announcementDeliveryForSource,
  audioPolicy,
  createDefaultState,
  effectiveScheduleItemVolume,
  isAppleMusicUrl,
  isSpotifyUrl,
  managerVolumePlan,
  normalizeAnnouncementSource,
  normalizeScheduleItem,
  normalizeState,
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

  test('preserves and clamps the shared announcement level while keeping a full music mute', () => {
    assert.equal(normalizeState({ config: { voiceLevel: 37, duckLevel: 88 } }).config.voiceLevel, 37);
    assert.equal(normalizeState({ config: { voiceLevel: -1 } }).config.voiceLevel, 0);
    assert.equal(normalizeState({ config: { voiceLevel: 101 } }).config.voiceLevel, 100);
    assert.equal(DUCK_LEVEL_PERCENT, 0);
  });

  test('supports global and custom announcement volume in both schedule modes', () => {
    const globalItem = normalizeScheduleItem({
      type: 'announcement',
      volume: { mode: 'global', percent: 91 }
    });
    const customItem = normalizeScheduleItem({
      action: { kind: 'announcement', announcementSource: 'inline', text: 'Test' },
      volume: { mode: 'custom', percent: 42 }
    });

    assert.equal(effectiveScheduleItemVolume(globalItem, { voiceLevel: 63 }), 63);
    assert.equal(effectiveScheduleItemVolume(customItem, { voiceLevel: 63 }), 42);
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
    assert.equal(ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS, 45);
    const tooLong = normalizeAnnouncementSource({
      id: 'too-long', provider: 'direct', kind: 'finite-audio', finite: true,
      url: 'https://media.example/long.mp3', durationSeconds: 46
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

  test('reports the selected voice level in both controlled and Apple policies', () => {
    const controlled = audioPolicy({ provider: 'controlled', musicPercent: 30, voicePercent: 72 });
    const apple = audioPolicy({ provider: 'apple', musicPercent: 30, voicePercent: 72 });
    assert.equal(controlled.voicePercent, 72);
    assert.equal(apple.voicePercent, 72);
    assert.equal(controlled.duringVoicePercent, 0);
    assert.equal(apple.duringVoicePercent, 0);
    assert.equal(audioPolicy({ provider: 'spotify', musicPercent: 30, voicePercent: 72 }).voicePercent, 72);
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
  test('updates the actual audio-engine voice target without requiring a graph', () => {
    const engine = new AudioEngine();
    assert.equal(engine.status().voiceLevelPercent, 100);
    assert.equal(engine.setVoiceLevelPercent(48, { report: false }), 48);
    assert.equal(engine.status().voiceLevelPercent, 48);
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
