import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, test } from 'node:test';

import {
  dispatchPushcutXCommand,
  normalizePushcutXCommand
} from '../api/_pushcut-x.js';
import {
  planPushcutXSchedule,
  synchronizePushcutXSchedule
} from '../api/_pushcut-schedule-x.js';
import {
  applyPushcutMusic30Now,
  sendPushcutAnnouncement,
  waitForPushcutAnnouncementCompletion
} from '../src/vx/pushcut-client.js';
import {
  createDefaultState,
  makeReceiverLease
} from '../src/vx/core.js';
import { ReceiverRuntime } from '../src/vx/receiver-runtime.js';

const NOW = Date.parse('2026-07-17T15:00:00.000Z');
const DEVICE_ID = 'vx-exact-ducking-receiver';
const SESSION_ID = 'vx-exact-ducking-session';
const MUSIC_LEVELS = [0, 30, 67, 100];
const APP_SOURCE = readFileSync(new URL('../src/vx/app.js', import.meta.url), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function inactiveExternalReceiver() {
  return {
    ready: false,
    current: null,
    supportsVolume: false,
    volumeVerified: false,
    verifiedPercent: null,
    accessVerifiedAt: 0,
    loggedIn: () => false,
    readiness: () => ({
      status: 'login-required',
      ready: false,
      detail: 'Not active.'
    }),
    setTargetVolumePercent() {},
    enforceVolume: async percent => ({
      supported: false,
      verified: false,
      requestedPercent: percent,
      appliedPercent: null
    }),
    pause: async () => false,
    resume: async () => false,
    pauseForAnnouncement: async () => ({ wasPlaying: false }),
    resumeAfterAnnouncement: async () => false,
    disconnect() {}
  };
}

function browserReceiverHarness({
  initialMusicPercent = 30,
  staleVoicePercent = 61,
  playbackVolumeMode = 'global',
  playbackMusicPercent = initialMusicPercent
} = {}) {
  const state = createDefaultState(NOW);
  state.config.musicLevel = initialMusicPercent;
  state.config.voiceLevel = staleVoicePercent;
  state.receiver = makeReceiverLease({
    deviceId: DEVICE_ID,
    sessionId: SESSION_ID
  }, NOW);
  state.playback = {
    ...state.playback,
    provider: 'controlled',
    intent: 'playing',
    volumeMode: playbackVolumeMode,
    musicLevelPercent: playbackMusicPercent
  };
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

  const voiceStarted = deferred();
  const finishVoice = deferred();
  const calls = [];
  let selectedMusicPercent = playbackMusicPercent;
  let audibleMusicPercent = playbackMusicPercent;
  let currentVoicePercent = staleVoicePercent;
  let announcementActive = false;
  let voicePercentAtStart = null;

  const audio = {
    status: () => ({
      voiceLevelPercent: currentVoicePercent,
      musicLevelPercent: selectedMusicPercent,
      calibrationActive: false
    }),
    musicPlaying: () => true,
    setMusicLevelPercent(percent) {
      selectedMusicPercent = Number(percent);
      calls.push(`music-target-${selectedMusicPercent}`);
      if (!announcementActive) {
        audibleMusicPercent = selectedMusicPercent;
        calls.push(`music-audible-${audibleMusicPercent}`);
      }
      return selectedMusicPercent;
    },
    async beginAnnouncement() {
      announcementActive = true;
      audibleMusicPercent = 0;
      calls.push('music-audible-0');
    },
    async endAnnouncement({ restore = true } = {}) {
      calls.push('restore-requested');
      announcementActive = false;
      if (restore) {
        audibleMusicPercent = selectedMusicPercent;
        calls.push(`music-audible-${audibleMusicPercent}`);
      }
    },
    setVoiceLevelPercent(percent) {
      currentVoicePercent = Number(percent);
      calls.push(`voice-target-${currentVoicePercent}`);
      return currentVoicePercent;
    },
    async playVoiceBlob() {
      voicePercentAtStart = currentVoicePercent;
      calls.push(`voice-start-${voicePercentAtStart}`);
      voiceStarted.resolve();
      await finishVoice.promise;
      calls.push('voice-complete');
      return true;
    },
    async playMusicUrl(url, options = {}) {
      calls.push(`music-resume-${url}-${options.startAt ?? 0}`);
      audibleMusicPercent = selectedMusicPercent;
      calls.push(`music-audible-${audibleMusicPercent}`);
      return true;
    },
    stopVoice() {},
    stopMusic() {}
  };
  const runtime = new ReceiverRuntime({
    store,
    audio,
    apple: inactiveExternalReceiver(),
    spotify: inactiveExternalReceiver()
  });
  runtime.deviceId = DEVICE_ID;
  runtime.sessionId = SESSION_ID;
  runtime.sessionStartedAt = NOW;
  runtime.active = true;
  runtime.lastDurableHeartbeatAt = NOW;
  runtime.prepareVoice = async () => new Blob(['natural voice'], { type: 'audio/mpeg' });

  return {
    runtime,
    store,
    calls,
    voiceStarted,
    finishVoice,
    audibleMusicPercent: () => audibleMusicPercent,
    voicePercentAtStart: () => voicePercentAtStart
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: name => String(name).toLowerCase() === 'content-type'
        ? 'application/json; charset=utf-8'
        : ''
    },
    async json() {
      return body;
    }
  };
}

function timedScheduleState(musicPercent) {
  const state = createDefaultState(NOW);
  const weekday = new Date(Date.UTC(2026, 6, 17)).getUTCDay();
  state.revision = 42;
  state.config.musicLevel = musicPercent;
  state.announcements = [{
    id: 'exact-level-announcement',
    label: 'Exact Level Announcement',
    text: 'This announcement must fully mute and then restore the music.',
    sourceId: 'natural-voice'
  }];
  state.schedules = [{
    id: 'exact-level-schedule',
    name: 'Exact Level Schedule',
    mode: 'time',
    enabled: true,
    items: [{
      id: 'exact-level-item',
      label: 'Exact Level Announcement',
      enabled: true,
      days: [weekday],
      position: { time: '10:30', order: 1 },
      action: {
        kind: 'announcement',
        announcementSource: 'saved',
        announcementId: 'exact-level-announcement',
        sourceId: 'natural-voice',
        text: ''
      },
      volume: { mode: 'global', percent: 100 },
      advance: { mode: 'complete', durationSeconds: 300 }
    }]
  }];
  state.activeScheduleId = 'exact-level-schedule';
  return state;
}

function memoryManifestStore() {
  let manifest = {
    version: 1,
    syncedAt: 0,
    horizonEnd: 0,
    stateRevision: 0,
    occurrences: {}
  };
  return {
    durable: true,
    async withLock(operation) {
      return await operation();
    },
    async read() {
      return structuredClone(manifest);
    },
    async write(next) {
      manifest = structuredClone(next);
      return structuredClone(manifest);
    }
  };
}

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
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5
    }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener() {},
      removeEventListener() {}
    }
  });
});

describe('Version X exact 0/100 browser announcement contract', { concurrency: false }, () => {
  test('Suno goes M -> 0 before voice, stays at 0 through completion, then restores the latest M', async () => {
    const harness = browserReceiverHarness({
      initialMusicPercent: 30,
      staleVoicePercent: 61
    });

    const announcement = harness.runtime.announce('Exact ducking acceptance test.', {
      // Old saved/custom voice settings must not reduce an announcement.
      volumePercent: 61
    });
    await harness.voiceStarted.promise;

    assert.equal(harness.audibleMusicPercent(), 0);
    const musicZeroIndex = harness.calls.indexOf('music-audible-0');
    const voiceStartIndex = harness.calls.findIndex(call => call.startsWith('voice-start-'));
    assert.ok(musicZeroIndex >= 0 && musicZeroIndex < voiceStartIndex);

    await harness.runtime.setMusicLevel(67);
    assert.equal(harness.store.state.config.musicLevel, 67);
    assert.equal(harness.audibleMusicPercent(), 0);
    assert.equal(harness.calls.includes('music-audible-67'), false);

    const callsBeforeCompletion = [...harness.calls];
    assert.equal(callsBeforeCompletion.includes('restore-requested'), false);

    harness.finishVoice.resolve();
    await announcement;
    harness.runtime.stopLoops();

    const voiceCompleteIndex = harness.calls.indexOf('voice-complete');
    const restoreIndex = harness.calls.indexOf('restore-requested');
    assert.ok(voiceCompleteIndex >= 0 && restoreIndex > voiceCompleteIndex);
    assert.equal(harness.audibleMusicPercent(), 67);
    assert.equal(harness.voicePercentAtStart(), 100);
  });

  test('weather safety restores the latest global M instead of a carried pre-safety M', async () => {
    const harness = browserReceiverHarness({ initialMusicPercent: 30 });
    harness.runtime.physicalRequestId = 1;
    harness.runtime.physicalCommittedRequestId = 0;
    harness.runtime.safetyRestoreSnapshot = {
      epoch: harness.runtime.audioEpoch,
      provider: 'controlled',
      musicLevelPercent: 30,
      controlledSnapshot: {
        wasPlaying: true,
        audioUrl: 'https://cdn.example.test/weather-bed.mp3',
        label: 'Weather bed',
        position: 12,
        scheduledRunToken: ''
      }
    };

    const announcement = harness.runtime.announce('Immediate weather safety warning.', {
      safety: true,
      label: 'Weather safety',
      // A carried event may contain an old schedule or Remote value.
      volumePercent: 64
    });
    await harness.voiceStarted.promise;

    assert.equal(harness.audibleMusicPercent(), 0);
    await harness.runtime.setMusicLevel(67);
    assert.equal(harness.store.state.config.musicLevel, 67);
    assert.equal(harness.audibleMusicPercent(), 0);
    assert.equal(harness.calls.includes('music-audible-67'), false);

    harness.finishVoice.resolve();
    await announcement;
    harness.runtime.stopLoops();

    const voiceCompleteIndex = harness.calls.indexOf('voice-complete');
    const restoredLevelIndex = harness.calls.lastIndexOf('music-audible-67');
    assert.ok(restoredLevelIndex > voiceCompleteIndex);
    assert.equal(harness.audibleMusicPercent(), 67);
    assert.equal(harness.calls.includes('music-audible-30'), false);
    assert.equal(harness.voicePercentAtStart(), 100);
  });

  test('a custom scheduled music bed keeps its explicit level when global M changes during safety speech', async () => {
    const harness = browserReceiverHarness({
      initialMusicPercent: 30,
      playbackVolumeMode: 'custom',
      playbackMusicPercent: 42
    });

    const announcement = harness.runtime.announce('Safety interruption over a custom scheduled bed.', {
      safety: true,
      label: 'Scheduled safety'
    });
    await harness.voiceStarted.promise;

    assert.equal(harness.audibleMusicPercent(), 0);
    await harness.runtime.setMusicLevel(67);
    assert.equal(harness.store.state.config.musicLevel, 67);
    assert.equal(harness.store.state.playback.volumeMode, 'custom');
    assert.equal(harness.store.state.playback.musicLevelPercent, 42);
    assert.equal(harness.audibleMusicPercent(), 0);

    harness.finishVoice.resolve();
    await announcement;
    harness.runtime.stopLoops();

    const voiceCompleteIndex = harness.calls.indexOf('voice-complete');
    const restoredCustomIndex = harness.calls.lastIndexOf('music-audible-42');
    assert.ok(restoredCustomIndex > voiceCompleteIndex);
    assert.equal(harness.audibleMusicPercent(), 42);
    assert.equal(harness.calls.includes('music-audible-67'), false);
  });
});

describe('Version X exact Pushcut live/manual volume contract', { concurrency: false }, () => {
  for (const musicPercent of MUSIC_LEVELS) {
    test(`live announcement carries M=${musicPercent} and forces voice to 100`, async () => {
      let payload = null;
      const eventId = `pushcut-exact-live-${String(musicPercent).padStart(3, '0')}`;
      await sendPushcutAnnouncement({
        eventId,
        text: `Exact music target ${musicPercent}.`,
        voicePercent: 64,
        musicPercent,
        fetchImpl: async (_url, options) => {
          payload = JSON.parse(options.body);
          return jsonResponse(202, {
            ok: true,
            accepted: true,
            completed: false,
            status: 'accepted',
            eventId
          });
        }
      });
      assert.equal(payload.musicPercent, musicPercent);
      assert.equal(payload.voicePercent, 100);
    });

    test(`manual Pushcut volume action carries M=${musicPercent}`, async () => {
      let payload = null;
      const result = await applyPushcutMusic30Now({
        musicPercent,
        fetchImpl: async (_url, options) => {
          payload = JSON.parse(options.body);
          return jsonResponse(200, {
            ok: true,
            accepted: true,
            completed: true,
            status: 'completed',
            musicPercent
          });
        }
      });
      assert.equal(payload.musicPercent, musicPercent);
      assert.equal(result.musicPercent, musicPercent);
    });
  }

  test('server normalization accepts a 100% music target because music is muted before 100% voice', () => {
    const command = normalizePushcutXCommand({
      version: 'x',
      eventId: 'pushcut-exact-server-100',
      source: 'live',
      text: 'Music was selected at one hundred percent.',
      label: 'Exact 100',
      safety: false,
      voicePercent: 100,
      musicPercent: 100
    }, { now: () => NOW });

    assert.equal(command.musicPercent, 100);
    assert.equal(command.voicePercent, 100);
    assert.equal(command.resumeMusic, true);
  });

  test('an uncertain Pushcut timeout never runs the music restore before receiver completion', async () => {
    const command = normalizePushcutXCommand({
      version: 'x',
      eventId: 'pushcut-exact-no-early-restore',
      source: 'live',
      text: 'This deliberately long announcement is still playing.',
      label: 'No Early Restore',
      safety: false,
      voicePercent: 100,
      musicPercent: 67
    }, { now: () => NOW });
    const inputs = [];

    await dispatchPushcutXCommand(command, {
      env: {
        PUSHCUT_API_KEY_X: 'pushcut-exact-test-key'
      },
      fetchImpl: async (_url, options) => {
        const input = JSON.parse(options.body).input;
        inputs.push(input);
        return {
          status: input.action === 'announce' ? 504 : 202
        };
      },
      now: () => NOW
    }).catch(() => {});

    assert.deepEqual(
      inputs.map(input => input.action),
      ['announce'],
      'A timeout is not proof that voice completed, so recovery must wait for a terminal receipt.'
    );
  });

  test('a stale Remote receives and reports the server canonical M from acceptance through completion', async () => {
    const eventId = 'pushcut-canonical-client-response-0001';
    let staleRemotePayload = null;
    const accepted = await sendPushcutAnnouncement({
      eventId,
      text: 'Concurrent Remote canonical level test.',
      musicPercent: 30,
      fetchImpl: async (_url, options) => {
        staleRemotePayload = JSON.parse(options.body);
        return jsonResponse(202, {
          ok: true,
          accepted: true,
          completed: false,
          status: 'accepted',
          eventId,
          receipt: {
            eventId,
            status: 'accepted',
            expectedMusicPercent: 67,
            restoredMusicPercent: null
          }
        });
      }
    });

    assert.equal(staleRemotePayload.musicPercent, 30);
    assert.equal(accepted.receipt.expectedMusicPercent, 67);

    const completed = await waitForPushcutAnnouncementCompletion(eventId, {
      timeoutMs: 10_000,
      pollMs: 500,
      fetchImpl: async () => jsonResponse(200, {
        ok: true,
        completed: true,
        status: 'completed',
        eventId,
        receipt: {
          eventId,
          status: 'completed',
          completed: true,
          expectedMusicPercent: 67,
          restoredMusicPercent: 67
        }
      })
    });

    assert.equal(completed.receipt.expectedMusicPercent, 67);
    assert.equal(completed.receipt.restoredMusicPercent, 67);
    assert.match(
      APP_SOURCE,
      /result\.receipt\?\.expectedMusicPercent\s*\?\?\s*result\.musicPercent/,
      'The app must prefer the canonical server expectation over a stale Remote slider value.'
    );
    assert.match(
      APP_SOURCE,
      /completed\.receipt\?\.restoredMusicPercent/,
      'The app must report the receiver-confirmed restored level after completion.'
    );
  });
});

describe('Version X exact scheduled volume contract', { concurrency: false }, () => {
  test('the occurrence carries M and changing only M changes its fingerprint', () => {
    const plan30 = planPushcutXSchedule(timedScheduleState(30), {
      now: NOW,
      horizonDays: 7
    });
    const plan67 = planPushcutXSchedule(timedScheduleState(67), {
      now: NOW,
      horizonDays: 7
    });

    assert.equal(plan30.occurrences.length, 1);
    assert.equal(plan67.occurrences.length, 1);
    assert.equal(plan30.occurrences[0].musicPercent, 30);
    assert.equal(plan67.occurrences[0].musicPercent, 67);
    assert.notEqual(plan30.occurrences[0].fingerprint, plan67.occurrences[0].fingerprint);
  });

  test('scheduled receiver and recovery inputs both carry the selected M with voice fixed at 100', async () => {
    const scheduled = [];
    const musicPercent = 67;
    const request = {
      method: 'POST',
      url: '/api/pushcut-schedule-x?v=x',
      headers: {
        host: 'poolside.test',
        origin: 'https://poolside.test',
        'x-forwarded-host': 'poolside.test',
        'x-forwarded-proto': 'https'
      },
      socket: {
        encrypted: true,
        remoteAddress: '203.0.113.167'
      }
    };
    await synchronizePushcutXSchedule({
      state: timedScheduleState(musicPercent),
      request
    }, {
      env: {
        PUSHCUT_API_KEY_X: 'pushcut-exact-test-key',
        OPENAI_API_KEY: 'natural-voice-test-key',
        POOL_SIDE_SESSION_SECRET: 'exact-ducking-session-secret-long-enough',
        POOL_SIDE_PIN: '7900'
      },
      now: () => NOW,
      horizonDays: 7,
      manifestStore: memoryManifestStore(),
      scheduleExecution: async payload => {
        scheduled.push(structuredClone(payload));
        return { accepted: true, status: 202 };
      },
      cancelExecution: async () => ({ cancelled: true, status: 200 }),
      createReceipt: async command => ({
        created: true,
        durable: true,
        receipt: command
      }),
      updateReceipt: async (eventId, patch) => ({ eventId, ...patch })
    });

    assert.equal(scheduled.length, 2);
    assert.equal(scheduled[0].input.action, 'recover-volume');
    assert.equal(scheduled[0].input.musicPercent, musicPercent);
    assert.equal(scheduled[0].input.resumeMusic, true);
    assert.match(scheduled[0].input.recoveryUrl, /\/api\/pushcut-recovery-x\?v=x&/);
    assert.equal(scheduled[1].input.action, 'announce');
    assert.equal(scheduled[1].input.musicPercent, musicPercent);
    assert.equal(scheduled[1].input.voicePercent, 100);
    assert.equal(scheduled[1].input.resumeMusic, true);
    assert.match(scheduled[1].input.restoreUrl, /\/api\/pushcut-restore-x\?v=x&/);
  });
});
