import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { createDefaultState, makeReceiverLease } from '../src/vx/core.js';
import { ReceiverRuntime } from '../src/vx/receiver-runtime.js';

const NOW = 1_800_000_000_000;
const DEVICE_ID = 'vx-dual-provider-receiver';
const SESSION_ID = 'vx-dual-provider-session';

beforeEach(() => {
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => values.get(String(key)) ?? null,
      setItem: (key, value) => values.set(String(key), String(value)),
      removeItem: key => values.delete(String(key))
    }
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'Version X dual-provider test', platform: 'MacIntel', maxTouchPoints: 0 }
  });
});

function externalPlayer(name, audibleState, otherAudible) {
  const player = {
    ready: true,
    current: null,
    deviceId: `${name}-device`,
    accessVerifiedAt: NOW,
    supportsVolume: false,
    volumeVerified: false,
    verifiedPercent: null,
    loggedIn: () => true,
    readiness: () => ({ status: 'ready', ready: true, detail: `${name} ready` }),
    setTargetVolumePercent() {},
    resetVolumeVerification() {
      player.volumeVerified = false;
      player.verifiedPercent = null;
    },
    async enforceVolume() {
      return { verified: false, volumeVerified: false, verifiedPercent: null };
    },
    async play(_url, { assertCurrent } = {}) {
      assertCurrent?.();
      assert.equal(otherAudible(), false, `${name} must not start while the other external provider is audible`);
      audibleState.value = true;
      player.current = { paused: false, name: `${name} track`, artists: 'Poolside Pulse' };
      return {
        state: { isPlaying: true, deviceId: player.deviceId },
        volume: { verified: false, volumeVerified: false, verifiedPercent: null }
      };
    },
    async pauseForAnnouncement() {
      const snapshot = {
        wasPlaying: audibleState.value,
        position: 0,
        uri: `${name}:track`,
        deviceId: player.deviceId
      };
      audibleState.value = false;
      if (player.current) player.current.paused = true;
      return snapshot;
    },
    async pause() {
      audibleState.value = false;
      if (player.current) player.current.paused = true;
      return true;
    },
    async resume({ assertCurrent } = {}) {
      assertCurrent?.();
      assert.equal(otherAudible(), false, `${name} must not resume while the other external provider is audible`);
      audibleState.value = true;
      if (player.current) player.current.paused = false;
      return true;
    },
    async resumeAfterAnnouncement(snapshot, { assertCurrent } = {}) {
      if (!snapshot?.wasPlaying) return false;
      assertCurrent?.();
      assert.equal(otherAudible(), false, `${name} announcement restore must keep the inactive provider silent`);
      audibleState.value = true;
      if (player.current) player.current.paused = false;
      return true;
    },
    async next({ assertCurrent } = {}) {
      assertCurrent?.();
      assert.equal(otherAudible(), false);
      audibleState.value = true;
      return { isPlaying: true, name: `${name} next`, artists: 'Poolside Pulse', position: 0 };
    },
    async playbackState() {
      return {
        isPlaying: audibleState.value,
        deviceId: player.deviceId,
        position: 0,
        name: player.current?.name || '',
        artists: player.current?.artists || ''
      };
    },
    async readLocalVolume() {
      return { matches: false, actual: null };
    },
    disconnect() {
      audibleState.value = false;
    }
  };
  return player;
}

function harness() {
  const state = createDefaultState(NOW);
  state.receiver = makeReceiverLease({
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID,
    appleStatus: 'ready',
    spotifyStatus: 'ready'
  }, NOW);
  state.playback = { ...state.playback, provider: 'controlled', intent: 'stopped' };
  const store = {
    state,
    now: () => NOW,
    durableReady: () => true,
    async mutate(mutator) {
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      this.state = result && typeof result === 'object' ? result : draft;
      return this.state;
    }
  };

  const appleAudible = { value: false };
  const spotifyAudible = { value: false };
  const apple = externalPlayer('Apple Music', appleAudible, () => spotifyAudible.value);
  apple.nativeEnabled = () => false;
  apple.prepareForReceiverStart = async () => true;
  apple.pauseImmediately = async () => apple.pause();
  const spotify = externalPlayer('Spotify', spotifyAudible, () => appleAudible.value);

  const audioState = { controlledAudible: false, voiceLevel: 100 };
  const audio = {
    currentUrl: '',
    currentLabel: '',
    currentRunToken: '',
    musicElement: null,
    status: () => ({ voiceLevelPercent: audioState.voiceLevel, calibrationActive: false, unlocked: true, contextState: 'running' }),
    musicPlaying: () => audioState.controlledAudible,
    setMusicLevelPercent() {},
    setVoiceLevelPercent(percent) { audioState.voiceLevel = Number(percent); },
    pauseMusic() { audioState.controlledAudible = false; },
    stopMusic() { audioState.controlledAudible = false; },
    stopVoice() {},
    stopCalibration() {},
    async resumeMusic() {
      if (!audio.currentUrl) return false;
      audioState.controlledAudible = true;
      return true;
    },
    async playMusicUrl(url, options = {}) {
      assert.equal(appleAudible.value, false);
      assert.equal(spotifyAudible.value, false);
      audio.currentUrl = String(url);
      audio.currentLabel = String(options.label || '');
      audio.currentRunToken = String(options.scheduledRunToken || '');
      audioState.controlledAudible = true;
      return true;
    },
    async beginAnnouncement() {
      audioState.controlledAudible = false;
    },
    async endAnnouncement() {},
    async playVoiceBlob() {
      assert.equal(appleAudible.value, false);
      assert.equal(spotifyAudible.value, false);
    },
    async playDeviceSpeech() {
      assert.equal(appleAudible.value, false);
      assert.equal(spotifyAudible.value, false);
    }
  };

  const runtime = new ReceiverRuntime({ store, audio, apple, spotify });
  runtime.deviceId = DEVICE_ID;
  runtime.sessionId = SESSION_ID;
  runtime.sessionStartedAt = NOW;
  runtime.lastDurableHeartbeatAt = NOW;
  runtime.active = true;
  runtime.updateReceiverDetail = async () => {};
  return { runtime, store, apple, spotify, appleAudible, spotifyAudible, audioState };
}

describe('Version X Apple and Spotify runtime integration', { concurrency: false }, () => {
  test('gates and dispatches play-spotify with the full live/scheduled payload', async () => {
    const { runtime, store } = harness();
    runtime.active = false;
    store.state.receiver.spotifyStatus = 'login-required';

    await assert.rejects(
      runtime.sendCommand('play-spotify', { url: 'spotify:track:one' }),
      /not Spotify-ready/i
    );

    store.state.receiver.spotifyStatus = 'ready';
    const event = await runtime.sendCommand('play-spotify', { url: 'spotify:track:one' });
    assert.equal(event.type, 'play-spotify');

    let received = null;
    runtime.playSpotify = async (url, options) => { received = { url, options }; };
    await runtime.handleEvent({
      id: 'spotify-event',
      type: 'play-spotify',
      payload: {
        url: 'spotify:playlist:pool',
        volumePercent: 34,
        volumeMode: 'custom',
        scheduledItemId: 'item-1',
        scheduledRunToken: 'run-1',
        persistSource: false
      }
    });
    assert.deepEqual(received, {
      url: 'spotify:playlist:pool',
      options: {
        volumePercent: 34,
        volumeMode: 'custom',
        scheduledItemId: 'item-1',
        scheduledRunToken: 'run-1',
        persistSource: false
      }
    });
  });

  test('keeps Apple and Spotify mutually exclusive through both handoff directions', async () => {
    const { runtime, store, appleAudible, spotifyAudible } = harness();

    await runtime.playAppleMusic('https://music.apple.com/us/album/example/1');
    assert.equal(appleAudible.value, true);
    assert.equal(spotifyAudible.value, false);

    await runtime.playSpotify('spotify:track:spotify-one');
    assert.equal(appleAudible.value, false);
    assert.equal(spotifyAudible.value, true);

    await runtime.playAppleMusic('https://music.apple.com/us/album/example/2');
    assert.equal(appleAudible.value, true);
    assert.equal(spotifyAudible.value, false);
    assert.equal(runtime.physicalProvider, 'apple');
    assert.equal(store.state.playback.provider, 'apple');
  });

  test('announcements silence both external players and resume only the selected bed', async () => {
    for (const provider of ['apple', 'spotify']) {
      const { runtime, store, appleAudible, spotifyAudible } = harness();
      runtime.prepareVoice = async () => null;
      runtime.physicalProvider = provider;
      store.state.config.musicProvider = provider;
      store.state.playback = { ...store.state.playback, provider, intent: 'playing' };
      appleAudible.value = true;
      spotifyAudible.value = true;

      await runtime.announce(`${provider} announcement test`);

      assert.equal(appleAudible.value, provider === 'apple', `Apple restore mismatch for ${provider}`);
      assert.equal(spotifyAudible.value, provider === 'spotify', `Spotify restore mismatch for ${provider}`);
      assert.equal(runtime.physicalProvider, provider);
    }
  });

  test('routes due Time schedule Spotify items with their custom volume and run token', async () => {
    const { runtime, store } = harness();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(NOW));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const time = `${values.hour}:${values.minute}`;
    store.state.schedules = [{
      id: 'time-spotify',
      name: 'Spotify Time',
      mode: 'time',
      enabled: true,
      items: [{
        id: 'spotify-time-item',
        label: 'Spotify at the pool',
        enabled: true,
        type: 'spotify',
        time,
        position: { time },
        action: { kind: 'spotify', url: 'spotify:playlist:scheduled' },
        volume: { mode: 'custom', percent: 41 }
      }]
    }];
    store.state.activeScheduleId = 'time-spotify';
    store.state.scheduleRuns = {};
    let received = null;
    runtime.playSpotify = async (url, options) => { received = { url, options }; };

    await runtime.tickSchedule();

    assert.equal(received.url, 'spotify:playlist:scheduled');
    assert.equal(received.options.volumePercent, 41);
    assert.equal(received.options.volumeMode, 'custom');
    assert.equal(received.options.scheduledItemId, 'spotify-time-item');
    assert.match(received.options.scheduledRunToken, /^time-run-/);
    assert.equal(store.state.scheduleRuns['spotify-time-item'].status, 'completed');
  });

  test('routes Order Spotify items and rejects unsupported track-end before playback', async () => {
    const { runtime } = harness();
    runtime.assertExternalAudioIntent = () => true;
    let received = null;
    runtime.playSpotify = async (url, options) => { received = { url, options }; };
    runtime.completeOrderGate = async () => 'waiting-manual';
    const baseClaim = {
      scheduleId: 'order-spotify',
      token: 'order-run-1',
      item: {
        id: 'spotify-order-item',
        label: 'Spotify order item',
        type: 'spotify',
        action: { kind: 'spotify', url: 'spotify:album:ordered' },
        volume: { mode: 'custom', percent: 29 },
        advance: { mode: 'manual' }
      }
    };

    const result = await runtime.executeOrderItem(baseClaim);
    assert.deepEqual(result, { continue: false, status: 'waiting-manual' });
    assert.equal(received.url, 'spotify:album:ordered');
    assert.equal(received.options.volumePercent, 29);
    assert.equal(received.options.scheduledItemId, 'spotify-order-item');
    assert.equal(received.options.scheduledRunToken, 'order-run-1');

    received = null;
    await assert.rejects(
      runtime.executeOrderItem({
        ...baseClaim,
        item: { ...baseClaim.item, advance: { mode: 'track-end' } }
      }),
      /does not provide a schedule-safe track-end event/i
    );
    assert.equal(received, null);
  });
});
