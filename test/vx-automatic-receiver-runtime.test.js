import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import {
  createDefaultState,
  makeReceiverLease
} from '../src/vx/core.js';
import { ReceiverRuntime } from '../src/vx/receiver-runtime.js';

const NOW = 1_800_000_000_000;
const DEVICE_ID = 'automatic-receiver';
const SESSION_ID = 'automatic-receiver-session';

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
    value: {
      userAgent: 'Version X automatic Receiver test',
      platform: 'MacIntel',
      maxTouchPoints: 0
    }
  });
});

function dueTime(now = NOW) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

function pendingEvent(id, receiver, type = 'play-controlled') {
  return {
    id,
    type,
    payload: {
      url: 'https://audio.example.test/pool-bed.mp3',
      label: 'Pool bed'
    },
    targetReceiverId: receiver.id,
    targetSessionId: receiver.sessionId,
    createdAt: NOW,
    expiresAt: NOW + 60_000,
    status: 'pending'
  };
}

function dueAnnouncementSchedule() {
  const time = dueTime();
  return {
    id: 'automatic-time-schedule',
    name: 'Automatic Time Schedule',
    mode: 'time',
    enabled: true,
    items: [{
      id: 'automatic-announcement',
      label: 'Pool update',
      enabled: true,
      type: 'announcement',
      time,
      position: { time },
      action: {
        kind: 'announcement',
        announcementSource: 'inline',
        text: 'The pool will close in fifteen minutes.'
      },
      volume: { mode: 'global', percent: 100 }
    }]
  };
}

function dueMusicSchedule() {
  const time = dueTime();
  return {
    id: 'automatic-music-schedule',
    name: 'Automatic Music Schedule',
    mode: 'time',
    enabled: true,
    items: [{
      id: 'automatic-music',
      label: 'Pool bed',
      enabled: true,
      type: 'controlled',
      time,
      position: { time },
      action: {
        kind: 'controlled',
        url: 'https://audio.example.test/pool-bed.mp3'
      },
      volume: { mode: 'global', percent: 30 }
    }]
  };
}

function harness({
  automatic = true,
  owner = false,
  audio: audioOverrides = {},
  apple: appleOverrides = {},
  spotify: spotifyOverrides = {},
  delegationStatus = null,
  externalAutomation = null,
  externalMusicTarget = null
} = {}) {
  const state = createDefaultState(NOW);
  state.config.announcementTransport = automatic ? 'email-wake' : 'browser';
  state.config.automaticReceiverVerifiedPairingAt =
    automatic ? NOW - 1_000 : 0;
  const automation = externalAutomation || { active: false };
  const durableSchedule = delegationStatus || {
    operational: automatic,
    enabled: automatic,
    current: automatic,
    error: ''
  };
  const musicTargets = [];
  const appleTargets = [];
  const spotifyTargets = [];
  const audio = {
    setMusicLevelPercent(percent) {
      musicTargets.push(Number(percent));
    },
    ...audioOverrides
  };
  const apple = {
    ready: false,
    setTargetVolumePercent(percent) {
      appleTargets.push(Number(percent));
    },
    ...appleOverrides
  };
  const spotify = {
    ready: false,
    setTargetVolumePercent(percent) {
      spotifyTargets.push(Number(percent));
    },
    ...spotifyOverrides
  };
  const store = {
    state,
    now: () => NOW,
    async mutate(mutator) {
      const draft = structuredClone(this.state);
      const result = await mutator(draft);
      this.state = result && typeof result === 'object' ? result : draft;
      return this.state;
    }
  };
  const external = [];
  const runtime = new ReceiverRuntime({
    store,
    audio,
    apple,
    spotify,
    shouldDelegateScheduledAnnouncements: () => (
      durableSchedule.operational === true
      && durableSchedule.enabled === true
      && durableSchedule.current === true
      && !durableSchedule.error
    ),
    isExternalAutomationActive: async () => automation.active === true,
    onExternalAnnouncement: async (text, options) => {
      external.push({ text, options });
      return { completed: true, transport: 'email-wake-x' };
    },
    onExternalMusicTarget: externalMusicTarget
  });
  if (owner) {
    store.state.receiver = makeReceiverLease({
      deviceId: DEVICE_ID,
      sessionId: SESSION_ID
    }, NOW);
    runtime.deviceId = DEVICE_ID;
    runtime.sessionId = SESSION_ID;
    runtime.sessionStartedAt = NOW;
    runtime.lastDurableHeartbeatAt = NOW;
    runtime.active = true;
  }
  return {
    runtime,
    store,
    external,
    automation,
    durableSchedule,
    musicTargets,
    appleTargets,
    spotifyTargets
  };
}

describe('Version X Automatic Receiver runtime routing', { concurrency: false }, () => {
  test('routes runtime announcements to the background lane at fixed 100%', async () => {
    const { runtime, store, external } = harness();

    assert.ok(
      store.state.config.automaticReceiverVerifiedPairingAt > 0,
      'the automatic fixture must represent a positively verified Receiver'
    );

    const result = await runtime.announce('Pool update', {
      label: 'Pool Update',
      volumePercent: 12
    });

    assert.equal(result.transport, 'email-wake-x');
    assert.equal(external.length, 1);
    assert.equal(external[0].text, 'Pool update');
    assert.equal(external[0].options.volumePercent, 100);
  });

  test('keeps legacy browser announcements local when automation is off', async () => {
    const { runtime, external } = harness({ automatic: false });
    let performed = 0;
    runtime.performAnnouncement = async () => {
      performed += 1;
      return { completed: true };
    };

    await runtime.announce('Browser pool update');

    assert.equal(external.length, 0);
    assert.equal(performed, 1);
  });

  test('fails closed to Browser mode when email-wake lacks a positive verification marker', async () => {
    const {
      runtime,
      store,
      external,
      musicTargets
    } = harness();
    store.state.config.automaticReceiverVerifiedPairingAt = 0;
    store.state.config.musicLevel = 37;
    let performed = 0;
    runtime.performAnnouncement = async () => {
      performed += 1;
      return { completed: true };
    };

    assert.equal(runtime.automaticReceiverEnabled(), false);
    await runtime.announce('Unverified automatic request');
    runtime.applyConfiguredMusicTarget();

    assert.equal(external.length, 0);
    assert.equal(performed, 1);
    assert.deepEqual(musicTargets, [37]);
  });

  test('scheduled Suno, Apple Music, and Spotify await the external target and fail closed when it fails', async () => {
    const scenarios = [
      {
        name: 'Suno',
        itemId: 'scheduled-suno',
        audio: starts => ({
          async playMusicUrl() {
            starts.push('Suno');
          }
        }),
        apple: {},
        spotify: {},
        prepare(runtime) {
          runtime.resolveControlledTracks = async () => ({
            tracks: [{
              audioUrl: 'https://audio.example.test/suno-bed.mp3',
              title: 'Suno bed',
              artist: ''
            }],
            playlistName: 'Suno bed',
            source: 'test'
          });
        },
        play(runtime, itemId) {
          return runtime.playControlled(
            'https://suno.com/playlist/test',
            {
              volumePercent: 47,
              volumeMode: 'custom',
              scheduledItemId: itemId
            }
          );
        }
      },
      {
        name: 'Apple Music',
        itemId: 'scheduled-apple',
        audio: () => ({}),
        apple: starts => ({
          ready: true,
          loggedIn: () => true,
          async play() {
            starts.push('Apple Music');
            return { volume: { verified: false } };
          }
        }),
        spotify: {},
        prepare() {},
        play(runtime, itemId) {
          return runtime.playAppleMusic(
            'https://music.apple.com/us/playlist/test',
            {
              volumePercent: 47,
              volumeMode: 'custom',
              scheduledItemId: itemId
            }
          );
        }
      },
      {
        name: 'Spotify',
        itemId: 'scheduled-spotify',
        audio: () => ({}),
        apple: {},
        spotify: starts => ({
          ready: true,
          loggedIn: () => true,
          async play() {
            starts.push('Spotify');
            return { volume: { verified: false } };
          }
        }),
        prepare() {},
        play(runtime, itemId) {
          return runtime.playSpotify(
            'https://open.spotify.com/playlist/test',
            {
              volumePercent: 47,
              volumeMode: 'custom',
              scheduledItemId: itemId
            }
          );
        }
      }
    ];

    for (const scenario of scenarios) {
      const starts = [];
      const targetCalls = [];
      let rejectTarget;
      const targetGate = new Promise((resolve, reject) => {
        rejectTarget = reject;
      });
      const {
        runtime
      } = harness({
        automatic: true,
        owner: true,
        audio: scenario.audio(starts),
        apple:
          typeof scenario.apple === 'function'
            ? scenario.apple(starts)
            : scenario.apple,
        spotify:
          typeof scenario.spotify === 'function'
            ? scenario.spotify(starts)
            : scenario.spotify,
        externalMusicTarget: async (percent, options) => {
          targetCalls.push({ percent, options });
          return await targetGate;
        }
      });
      scenario.prepare(runtime);

      const pending = scenario.play(runtime, scenario.itemId);
      const rejected = assert.rejects(
        pending,
        new RegExp(`${scenario.name} scheduled target failed`)
      );
      for (let attempt = 0; attempt < 10 && !targetCalls.length; attempt += 1) {
        await Promise.resolve();
      }

      assert.deepEqual(
        targetCalls,
        [{
          percent: 47,
          options: {
            scheduledItemId: scenario.itemId,
            scheduledRunToken: ''
          }
        }],
        `${scenario.name} must invoke the physical-volume callback with its custom row target`
      );
      assert.deepEqual(
        starts,
        [],
        `${scenario.name} must not start while the physical-volume callback is pending`
      );

      rejectTarget(new Error(`${scenario.name} scheduled target failed`));
      await rejected;
      assert.deepEqual(
        starts,
        [],
        `${scenario.name} must remain stopped when the physical-volume callback fails`
      );
    }
  });

  test('keeps controlled/Suno browser gain at unity across automatic target state updates', () => {
    const {
      runtime,
      store,
      musicTargets,
      appleTargets,
      spotifyTargets
    } = harness();

    store.state.config.musicLevel = 30;
    assert.equal(runtime.applyConfiguredMusicTarget(), 30);

    store.state.config.musicLevel = 64;
    assert.equal(runtime.applyConfiguredMusicTarget(), 64);

    store.state.playback = {
      ...store.state.playback,
      intent: 'playing',
      volumeMode: 'custom',
      musicLevelPercent: 18
    };
    assert.equal(runtime.applyConfiguredMusicTarget(), 18);

    assert.equal(runtime.applyConfiguredMusicTarget({ percent: 7 }), 7);
    assert.deepEqual(musicTargets, [100, 100, 100, 100]);
    assert.deepEqual(appleTargets, [30, 64, 18, 7]);
    assert.deepEqual(spotifyTargets, [30, 64, 18, 7]);
  });

  test('keeps legacy browser gain tied to the selected target when automation is off', () => {
    const { runtime, store, musicTargets } = harness({ automatic: false });

    store.state.config.musicLevel = 30;
    runtime.applyConfiguredMusicTarget();
    store.state.config.musicLevel = 64;
    runtime.applyConfiguredMusicTarget();

    assert.deepEqual(musicTargets, [30, 64]);
  });

  test('active backend execution blocks due browser playback and automatic heartbeat provider reconciliation', async () => {
    let applePlaybackChecks = 0;
    let spotifyPlaybackChecks = 0;
    const {
      runtime,
      store,
      automation,
      musicTargets
    } = harness({
      owner: true,
      externalAutomation: { active: true },
      apple: {
        ready: true,
        setTargetVolumePercent() {},
        async playbackState() {
          applePlaybackChecks += 1;
          return { isPlaying: true, deviceId: 'apple-device' };
        }
      },
      spotify: {
        ready: true,
        setTargetVolumePercent() {},
        async playbackState() {
          spotifyPlaybackChecks += 1;
          return { isPlaying: true, deviceId: 'spotify-device' };
        }
      }
    });
    store.state.schedules = [dueMusicSchedule()];
    store.state.activeScheduleId = 'automatic-music-schedule';
    store.state.scheduleRuns = {};
    const browserStarts = [];
    runtime.playControlled = async (...args) => {
      browserStarts.push(args);
    };
    let leaseRenewals = 0;
    runtime.renewLeaseOnly = async () => {
      leaseRenewals += 1;
      return store.state.receiver;
    };

    assert.equal(await runtime.externalAutomationBusy(), true);
    await runtime.tickSchedule();
    await runtime.heartbeat();

    assert.equal(browserStarts.length, 0);
    assert.equal(store.state.scheduleRuns['automatic-music'], undefined);
    assert.equal(applePlaybackChecks, 0);
    assert.equal(spotifyPlaybackChecks, 0);
    assert.equal(leaseRenewals, 1);
    assert.deepEqual(musicTargets, [100]);

    automation.active = false;
    await runtime.tickSchedule();
    assert.equal(browserStarts.length, 1);
    assert.equal(store.state.scheduleRuns['automatic-music'].status, 'completed');
  });

  test('never browser-replays automatic timed announcements, including while durable status is stale or unavailable', async () => {
    const cases = [
      {
        name: 'fully current durable status',
        status: { operational: true, enabled: true, current: true, error: '' },
        expectedRuntimeFallbacks: 0
      },
      {
        name: 'service not operational',
        status: { operational: false, enabled: true, current: true, error: '' },
        expectedRuntimeFallbacks: 0
      },
      {
        name: 'durable schedule disabled',
        status: { operational: true, enabled: false, current: true, error: '' },
        expectedRuntimeFallbacks: 0
      },
      {
        name: 'durable schedule stale',
        status: { operational: true, enabled: true, current: false, error: '' },
        expectedRuntimeFallbacks: 0
      },
      {
        name: 'durable schedule status error',
        status: {
          operational: true,
          enabled: true,
          current: true,
          error: 'schedule status unavailable'
        },
        expectedRuntimeFallbacks: 0
      }
    ];

    for (const scenario of cases) {
      const { runtime, store, external } = harness({
        owner: true,
        delegationStatus: scenario.status
      });
      store.state.schedules = [dueAnnouncementSchedule()];
      store.state.activeScheduleId = 'automatic-time-schedule';
      store.state.scheduleRuns = {};

      await runtime.tickSchedule();

      assert.equal(
        external.length,
        scenario.expectedRuntimeFallbacks,
        scenario.name
      );
      assert.equal(
        store.state.scheduleRuns['automatic-announcement'],
        undefined,
        `${scenario.name} must leave the occurrence exclusively to durable automation`
      );
    }
  });

  test('delegates a timed quiet-hours stop exclusively to the Automatic Receiver', async () => {
    const { runtime, store } = harness({
      owner: true,
      delegationStatus: { operational: true, enabled: true, current: true, error: '' }
    });
    const time = dueTime();
    store.state.schedules = [{
      id: 'automatic-quiet-hours',
      name: 'Automatic Quiet Hours',
      mode: 'time',
      enabled: true,
      items: [{
        id: 'automatic-stop',
        label: 'Stop Music / Quiet Hours',
        enabled: true,
        type: 'stop',
        time,
        position: { time },
        action: { kind: 'stop' },
        volume: { mode: 'global', percent: 0 }
      }]
    }];
    store.state.activeScheduleId = 'automatic-quiet-hours';
    store.state.scheduleRuns = {};
    let browserStops = 0;
    runtime.stopMusic = async () => {
      browserStops += 1;
      return true;
    };

    await runtime.tickSchedule();

    assert.equal(browserStops, 0);
    assert.equal(store.state.scheduleRuns['automatic-stop'], undefined);
  });

  test('does not process pending browser events while the Receiver Shortcut owns audio', async () => {
    const { runtime, store, automation } = harness({
      owner: true,
      externalAutomation: { active: true }
    });
    store.state.events = [
      pendingEvent('pending-browser-playback', store.state.receiver)
    ];
    const processed = [];
    runtime.processEvent = async event => {
      processed.push(event.id);
      return true;
    };

    await runtime.processPendingEvents();
    assert.deepEqual(processed, []);

    automation.active = false;
    await runtime.processPendingEvents();
    assert.deepEqual(processed, ['pending-browser-playback']);
  });

  test('restores the shared 30% target after a live scheduled Party item is skipped', async () => {
    const appliedTargets = [];
    const { runtime, store } = harness({
      owner: true,
      externalMusicTarget: async percent => {
        appliedTargets.push(percent);
        return { completed: true, musicPercent: percent };
      }
    });
    store.state.config.musicLevel = 30;
    store.state.playback = {
      ...store.state.playback,
      provider: 'apple',
      intent: 'playing',
      musicLevelPercent: 100,
      volumeMode: 'custom',
      scheduledItemId: 'cancelled-party-track',
      scheduledRunToken: 'cancelled-party-token'
    };
    const stops = [];
    runtime.stopMusic = async options => {
      stops.push(options);
      return true;
    };

    assert.equal(await runtime.reconcileScheduledPlaybackAuthorization(), true);
    assert.deepEqual(stops, [{ skipOrderFailure: true }]);
    assert.deepEqual(appliedTargets, [30]);
  });

  test('fails closed when backend execution status cannot be confirmed', async () => {
    const { runtime, store } = harness({
      owner: true,
      externalAutomation: { active: false }
    });
    store.state.events = [
      pendingEvent('pending-status-error', store.state.receiver)
    ];
    const processed = [];
    runtime.isExternalAutomationActive = async () => {
      throw new Error('temporary status outage');
    };
    runtime.processEvent = async event => {
      processed.push(event.id);
      return true;
    };

    await runtime.processPendingEvents();

    assert.deepEqual(processed, []);
  });
});
