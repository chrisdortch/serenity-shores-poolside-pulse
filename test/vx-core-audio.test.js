import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AudioEngine } from '../src/vx/audio-engine.js';
import {
  DUCK_LEVEL_PERCENT,
  STATE_VERSION,
  VERSION,
  audioPolicy,
  createDefaultState,
  effectiveScheduleItemVolume,
  isAppleMusicUrl,
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

  test('reports the selected voice level in both controlled and Apple policies', () => {
    const controlled = audioPolicy({ provider: 'controlled', musicPercent: 30, voicePercent: 72 });
    const apple = audioPolicy({ provider: 'apple', musicPercent: 30, voicePercent: 72 });
    assert.equal(controlled.voicePercent, 72);
    assert.equal(apple.voicePercent, 72);
    assert.equal(controlled.duringVoicePercent, 0);
    assert.equal(apple.duringVoicePercent, 0);
  });

  test('labels iPhone Apple Music as physical-volume pause compatibility', () => {
    const policy = audioPolicy({ provider: 'apple', isIOS: true, musicPercent: 41, voicePercent: 68 });
    assert.equal(policy.id, 'apple-ios-pause-only');
    assert.equal(policy.exact, false);
    assert.equal(policy.musicPercent, null);
    assert.match(policy.detail, /receiver iPhone or connected speaker controls/i);
    assert.doesNotMatch(policy.detail, /41% slider/i);
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
