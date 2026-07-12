import {
  RECEIVER_LEASE_MS,
  SAFETY_EVENT_TTL_MS,
  WEATHER_INTERVAL_MS,
  audioPolicy,
  clamp,
  completeEvent,
  createTargetedEvent,
  dueScheduleItems,
  evaluateWeather,
  isDirectAudioUrl,
  makeId,
  makeLog,
  makeReceiverLease,
  pendingEventsForReceiver,
  receiverOnline,
  renewReceiverLease,
  safetyAnnouncementText,
  weatherRequestUrl
} from './core.js';
import { isIOSLike } from './audio-engine.js';

const DEVICE_KEY = 'poolside-pulse-vfinal-device-id';
const HANDLED_KEY = 'poolside-pulse-vfinal-handled-events';
const SESSION_KEY = 'poolside-pulse-vfinal-receiver-session';
const HEARTBEAT_MS = 10_000;
const EVENT_POLL_MS = 1_250;
const SCHEDULE_TICK_MS = 15_000;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function localGet(key) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

function localSet(key, value) {
  try { localStorage.setItem(key, String(value)); } catch {}
}

function localRemove(key) {
  try { localStorage.removeItem(key); } catch {}
}

function getDeviceId() {
  const existing = localGet(DEVICE_KEY);
  if (existing) return existing;
  const id = makeId('device');
  localSet(DEVICE_KEY, id);
  return id;
}

function handledIds() {
  try { return new Set(JSON.parse(localGet(HANDLED_KEY) || '[]')); } catch { return new Set(); }
}

function saveHandled(ids) {
  localSet(HANDLED_KEY, JSON.stringify([...ids].slice(-240)));
}

function mergeById(items) {
  const map = new Map();
  for (const item of items || []) {
    if (item?.id) map.set(item.id, { ...(map.get(item.id) || {}), ...item });
  }
  return [...map.values()];
}

function responseError(data, status) {
  return new Error(data?.error || data?.message || `Request failed with HTTP ${status}`);
}

async function fetchJson(url, options = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw responseError(data, response.status);
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function safeTrack(track, index) {
  return {
    id: String(track?.id || `track-${index}`),
    title: String(track?.title || `Track ${index + 1}`).slice(0, 160),
    artist: String(track?.artist || 'Suno / Direct Audio').slice(0, 120),
    duration: String(track?.duration || '').slice(0, 20),
    audioUrl: String(track?.audioUrl || '').trim().slice(0, 3000),
    sourceUrl: String(track?.sourceUrl || '').trim().slice(0, 3000)
  };
}

function weatherConfigSnapshot(config = {}) {
  return {
    latitude: Number(config.latitude),
    longitude: Number(config.longitude),
    lightningRadiusMiles: Number(config.lightningRadiusMiles),
    lightningHoldMinutes: Number(config.lightningHoldMinutes),
    windGustMph: Number(config.windGustMph)
  };
}

function sameWeatherConfig(left, right) {
  return JSON.stringify(weatherConfigSnapshot(left)) === JSON.stringify(weatherConfigSnapshot(right));
}

function lightningLookbackMinutes(weather, now) {
  const lastComplete = Number(weather?.lastLightningCoverageAt || 0);
  if (!lastComplete || lastComplete > now) return 6;
  return Math.max(6, Math.min(8, Math.ceil((now - lastComplete) / 60_000) + 2));
}

function stageWeatherBeforeSpeech(previousWeather, evaluatedWeather, announcementIds, now, config) {
  const previous = previousWeather || {};
  const staged = {
    ...evaluatedWeather,
    pendingAnnouncementIds: [...announcementIds],
    pendingAnnouncementAt: announcementIds.length ? now : 0,
    pendingAnnouncementConfig: announcementIds.length ? weatherConfigSnapshot(config) : null,
    pendingAnnouncementCommit: announcementIds.length ? structuredClone(evaluatedWeather) : null
  };
  for (const id of announcementIds) {
    if (id === 'lightning') {
      staged.lastLightningKey = previous.lastLightningKey || '';
      staged.lastLightningAnnouncementAt = Number(previous.lastLightningAnnouncementAt || 0);
    } else if (id === 'lightning-clear') {
      staged.lightningActive = true;
      staged.lightningHoldUntil = Number(previous.lightningHoldUntil || 0);
    } else if (id === 'wind') {
      staged.lastWindAnnouncementAt = Number(previous.lastWindAnnouncementAt || 0);
    } else if (id === 'tornado') {
      staged.lastTornadoAnnouncementAt = Number(previous.lastTornadoAnnouncementAt || 0);
    }
  }
  return staged;
}

function pendingWeatherWarningFresh(weather, now) {
  const ids = (Array.isArray(weather?.pendingAnnouncementIds) ? weather.pendingAnnouncementIds : [])
    .filter(id => ['lightning', 'wind', 'tornado'].includes(id));
  if (!ids.length) return false;
  const pendingAt = Number(weather.pendingAnnouncementAt || 0);
  if (!pendingAt || pendingAt > now) return false;
  return ids.every(id => {
    if (id === 'lightning') {
      const committedHoldUntil = Number(weather.pendingAnnouncementCommit?.lightningHoldUntil || 0);
      const holdMinutes = Number(weather.pendingAnnouncementConfig?.lightningHoldMinutes || 30);
      const deadline = committedHoldUntil || (pendingAt + Math.max(5, Math.min(90, holdMinutes)) * 60_000);
      return now <= deadline;
    }
    return now - pendingAt <= SAFETY_EVENT_TTL_MS;
  });
}

function pendingWeatherCoverageKnown(ids, payload) {
  return ids.every(id => {
    if (id === 'lightning') return payload?.lightningCoverageKnown === true;
    if (id === 'wind') return payload?.windCoverageKnown === true;
    if (id === 'tornado') return payload?.tornadoCoverageKnown === true;
    return false;
  });
}

export class ReceiverRuntime {
  constructor({ store, audio, spotify, onStatus = () => {}, onChange = () => {} }) {
    this.store = store;
    this.audio = audio;
    this.spotify = spotify;
    this.onStatus = onStatus;
    this.onChange = onChange;
    this.deviceId = getDeviceId();
    this.sessionId = '';
    this.sessionStartedAt = 0;
    this.active = false;
    this.processing = false;
    this.inFlightEventIds = new Set();
    this.scheduleProcessing = false;
    this.weatherTail = Promise.resolve();
    this.audioTail = Promise.resolve();
    this.volumeTail = Promise.resolve();
    this.audioEpoch = 0;
    this.audioRequestId = 0;
    this.audioRequestKind = 'none';
    this.physicalRequestId = 0;
    this.physicalCommittedRequestId = 0;
    this.committedPlaybackSnapshot = null;
    this.committedSourceConfig = null;
    this.safetyPendingCount = 0;
    this.physicalProvider = '';
    this.temporarySpotifyPauseDepth = 0;
    this.spotifyPauseGeneration = 0;
    this.announcementQueue = [];
    this.announcementRunning = false;
    this.currentAnnouncement = null;
    this.preemptedSpotifySnapshot = null;
    this.safetyRestoreSnapshot = null;
    this.voiceCache = new Map();
    this.voicePrepareController = null;
    this.safetyVoiceWarmSignature = '';
    this.safetyVoiceWarmPromise = null;
    this.timers = new Set();
    this.loopInFlight = new Set();
    this.lastDurableHeartbeatAt = 0;
    this.leaseGuardTimer = null;
    this.scheduleCompletedLocal = new Set();
    this.wakeLock = null;
    this.visibilityHandler = () => this.onVisibilityChange();
  }

  get state() {
    return this.store.state;
  }

  status(message, ok = true, extra = {}) {
    this.onStatus({ message, ok, active: this.active, ...extra });
  }

  nextAudioRequest(kind = 'normal') {
    this.audioRequestId += 1;
    this.audioRequestKind = kind;
    return this.audioRequestId;
  }

  invalidateAudioRestores({ preservePreempted = false, preserveSafetyRestore = false } = {}) {
    this.audioEpoch += 1;
    if (!preservePreempted) this.preemptedSpotifySnapshot = null;
    if (!preserveSafetyRestore) this.safetyRestoreSnapshot = null;
    return this.audioEpoch;
  }

  carrySafetyRestore(snapshot) {
    if (!snapshot || this.safetyPendingCount < 1 || !this.active || !this.isOwner()) return false;
    this.safetyRestoreSnapshot = { ...snapshot, epoch: this.audioEpoch };
    if (snapshot.provider === 'spotify' && snapshot.spotifySnapshot?.wasPlaying) {
      this.preemptedSpotifySnapshot = snapshot.spotifySnapshot;
    }
    return true;
  }

  beginTemporarySpotifyPause() {
    this.temporarySpotifyPauseDepth += 1;
    this.spotifyPauseGeneration += 1;
  }

  endTemporarySpotifyPause() {
    this.temporarySpotifyPauseDepth = Math.max(0, this.temporarySpotifyPauseDepth - 1);
    this.spotifyPauseGeneration += 1;
  }

  assertNoSafetyPending() {
    if (this.safetyPendingCount > 0) {
      throw new Error('An urgent weather safety announcement has priority. Try the music control again after it finishes.');
    }
  }

  assertAudioRequest(requestId, epoch, message = 'A newer audio command replaced this action before it could start.') {
    if (requestId !== this.audioRequestId || epoch !== this.audioEpoch) throw new Error(message);
    if (!this.isOwner()) throw new Error('Receiver ownership changed before the audio action could start.');
  }

  assertTerminalRequest(requestId, message = 'A newer terminal audio command replaced this action.') {
    if (requestId !== this.audioRequestId) throw new Error(message);
    if (!this.isOwner()) throw new Error('Receiver ownership changed before the terminal audio action could complete.');
  }

  receiptCurrent(requestId, epoch) {
    return requestId === this.audioRequestId && epoch === this.audioEpoch && this.audioRequestKind !== 'safety' && this.isOwner();
  }

  assertReceiptCurrent(requestId, epoch, message = 'A newer audio action superseded this playback receipt.') {
    if (this.receiptCurrent(requestId, epoch)) return;
    const error = new Error(message);
    error.code = 'AUDIO_RECEIPT_SUPERSEDED';
    throw error;
  }

  async compensateSafetyReceipt(previousPlayback, previousSourceConfig = {}) {
    await this.store.mutate(draft => {
      if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
        throw new Error('Receiver ownership changed before the superseded playback receipt could be corrected.');
      }
      const prior = structuredClone(previousPlayback || {});
      draft.playback = {
        ...(draft.playback || {}),
        ...prior,
        intent: prior.intent === 'stopped' ? 'stopped' : 'paused',
        unavailableReason: 'Playback stayed quiet because an urgent safety announcement superseded its start.',
        updatedAt: this.now()
      };
      for (const key of ['musicProvider', 'musicUrl', 'musicLabel', 'spotifyUrl']) {
        if (Object.prototype.hasOwnProperty.call(previousSourceConfig, key)) draft.config[key] = previousSourceConfig[key];
      }
      draft.activityLog = [makeLog('safety', 'Superseded playback stayed quiet', 'A late playback receipt was corrected after an urgent safety announcement.'), ...(draft.activityLog || [])];
      return draft;
    }, 'Superseded playback corrected', { requireDurable: true });
  }

  rememberCommittedPlayback(requestId) {
    if (this.physicalRequestId !== requestId || this.physicalCommittedRequestId !== requestId) return;
    this.committedPlaybackSnapshot = structuredClone(this.state.playback || {});
    this.committedSourceConfig = Object.fromEntries(['musicProvider', 'musicUrl', 'musicLabel', 'spotifyUrl'].map(key => [key, this.state.config[key]]));
  }

  async repairCurrentCommittedReceipt() {
    const committedRequestId = this.physicalCommittedRequestId;
    const playback = this.committedPlaybackSnapshot && structuredClone(this.committedPlaybackSnapshot);
    const sourceConfig = this.committedSourceConfig && { ...this.committedSourceConfig };
    if (!committedRequestId || !playback || this.physicalRequestId !== committedRequestId) return false;
    await this.store.mutate(draft => {
      if (this.physicalRequestId !== committedRequestId || this.physicalCommittedRequestId !== committedRequestId) return draft;
      if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) return draft;
      draft.playback = { ...playback, updatedAt: this.now() };
      for (const [key, value] of Object.entries(sourceConfig || {})) draft.config[key] = value;
      draft.activityLog = [makeLog('playback', 'Current playback receipt repaired', 'A late older receipt was replaced with the currently audible committed source.'), ...(draft.activityLog || [])];
      return draft;
    }, 'Current playback receipt repaired', { requireDurable: true });
    return true;
  }

  serializeAudio(work) {
    const job = this.audioTail.then(work, work);
    this.audioTail = job.catch(() => {});
    return job;
  }

  async settleAudioOperations() {
    await withTimeout(
      this.audioTail,
      40_000,
      'The current audio action did not settle safely within 40 seconds.'
    );
  }

  now() {
    return typeof this.store.now === 'function' ? this.store.now() : Date.now();
  }

  isOwner(now = this.now()) {
    const receiver = this.state.receiver;
    return this.active && receiverOnline(receiver, now) && receiver.id === this.deviceId && receiver.sessionId === this.sessionId;
  }

  currentPolicy(provider = this.state.config.musicProvider) {
    const musicPercent = clamp(this.state.config.musicLevel, 0, 100, 30);
    return audioPolicy({
      provider,
      isIOS: isIOSLike(),
      supportsVolume: !!this.spotify.supportsVolume,
      volumeVerified: !!this.spotify.volumeVerified,
      verifiedPercent: this.spotify.verifiedPercent,
      musicPercent
    });
  }

  applyConfiguredMusicTarget({ report = false } = {}) {
    const target = clamp(this.state.config.musicLevel, 0, 100, 30);
    this.audio.setMusicLevelPercent?.(target, { report });
    this.spotify.setTargetVolumePercent?.(target);
    return target;
  }

  async setMusicLevel(percent) {
    const requested = clamp(percent, 0, 100, 30);
    const work = async () => {
      if (!this.isOwner()) throw new Error('This device is not the active speaker receiver.');
      const target = requested;
      this.audio.setMusicLevelPercent?.(target, { report: false });
      this.spotify.setTargetVolumePercent?.(target);
      let verification = null;
      const spotifyActive = this.physicalProvider === 'spotify' ||
        (this.state.playback.provider === 'spotify' && this.state.playback.intent === 'playing');
      if (spotifyActive && this.spotify.ready) verification = await this.spotify.enforceVolume(target);
      await this.store.mutate(draft => {
        if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
          throw new Error('Receiver ownership changed before the music level could be recorded.');
        }
        draft.config.musicLevel = target;
        if (draft.playback?.provider === 'spotify') {
          draft.playback = {
            ...draft.playback,
            volumeVerified: verification?.verified === true,
            volumeVerifiedPercent: verification?.verified === true ? target : null,
            volumeVerifiedAt: verification?.verified === true ? this.now() : 0,
            updatedAt: this.now()
          };
        }
        draft.activityLog = [makeLog('settings', 'Music level applied', `${target}% target; announcements remain 100%.`, this.now()), ...(draft.activityLog || [])];
        return draft;
      }, 'Music level applied', { requireDurable: true });
      const policy = this.currentPolicy(this.physicalProvider || this.state.playback.provider || this.state.config.musicProvider);
      await this.updateReceiverDetail(policy.detail, policy.id);
      this.status(
        spotifyActive && verification?.verified !== true
          ? `Music target is ${target}%. Spotify could not verify that level on this receiver; announcements will still pause Spotify.`
          : `Music level is ${target}%. Announcements remain fixed at 100%.`,
        !spotifyActive || verification?.verified === true,
        { policy, verification }
      );
      return target;
    };
    const job = this.volumeTail.then(work, work);
    this.volumeTail = job.catch(() => {});
    return await job;
  }

  async start({ takeover = false, takeoverTarget = null } = {}) {
    this.nextAudioRequest();
    this.invalidateAudioRestores();
    if (typeof this.store.durableReady === 'function' && !this.store.durableReady()) {
      throw new Error('Durable cloud sync is required before this device can become the speaker receiver. Check the Poolside Pulse KV connection and try again.');
    }
    const initialNow = this.now();
    const current = this.state.receiver;
    const currentIsThisSession = current?.id === this.deviceId && current?.sessionId === this.sessionId && this.active;
    const targetMatches = candidate => !!takeoverTarget &&
      candidate?.id === takeoverTarget.id && candidate?.sessionId === takeoverTarget.sessionId;
    if (takeover && receiverOnline(current, initialNow) && !targetMatches(current)) {
      const error = new Error(`${current.name || 'The active receiver'} changed after the takeover warning. Review the new receiver before confirming again.`);
      error.takeoverRequired = true;
      error.takeoverTarget = { id: current.id, sessionId: current.sessionId };
      throw error;
    }
    if (receiverOnline(current, initialNow) && !currentIsThisSession && !takeover) {
      const error = new Error(`${current.name || 'Another receiver'} is already online. Choose Take Over only if that speaker device is no longer in use.`);
      error.takeoverRequired = true;
      error.takeoverTarget = { id: current.id, sessionId: current.sessionId };
      throw error;
    }
    this.applyConfiguredMusicTarget({ report: false });
    await this.audio.unlock({ audibleTest: false });
    let spotifyCapability = null;
    const startupProvider = this.state.playback.intent === 'stopped'
      ? this.state.config.musicProvider
      : (this.state.playback.provider || this.state.config.musicProvider);
    if (startupProvider === 'spotify' && this.spotify.loggedIn()) {
      try {
        await this.spotify.connectFromUserGesture();
        spotifyCapability = await this.spotify.refreshCapabilities();
      } catch (error) {
        this.status(`Receiver audio is ready; Spotify still needs attention: ${error.message}`, false);
      }
    }
    const sessionId = makeId('session', this.now());
    const policy = this.currentPolicy(startupProvider);
    let lease = null;
    await this.store.mutate(draft => {
      const claimNow = this.now();
      const claimed = draft.receiver;
      const claimedByThisSession = claimed?.id === this.deviceId && claimed?.sessionId === sessionId;
      if (receiverOnline(claimed, claimNow) && !claimedByThisSession && (!takeover || !targetMatches(claimed))) {
        const error = new Error(`${claimed.name || 'Another receiver'} became active while this device was starting. Review the takeover warning before replacing it.`);
        error.takeoverRequired = true;
        error.takeoverTarget = { id: claimed.id, sessionId: claimed.sessionId };
        throw error;
      }
      lease = makeReceiverLease({
        deviceId: this.deviceId,
        sessionId,
        name: 'Poolside Speaker Receiver',
        platform: navigator.userAgent,
        audioMode: policy.id
      }, claimNow);
      draft.receiver = lease;
      draft.activityLog = [
        makeLog('receiver', takeover ? 'Receiver takeover started' : 'Fresh receiver session started', `${policy.label}. Commands older than this session are ignored.`, claimNow, { receiverId: this.deviceId, sessionId }),
        ...(draft.activityLog || [])
      ];
      return draft;
    }, 'Receiver started', { requireDurable: true });
    const savedLease = this.state.receiver?.id === this.deviceId && this.state.receiver?.sessionId === sessionId
      ? this.state.receiver
      : lease;
    if (!savedLease) throw new Error('Receiver ownership was not confirmed after the startup claim.');
    this.sessionStartedAt = Number(savedLease.startedAt || this.now());
    this.sessionId = sessionId;
    this.lastDurableHeartbeatAt = Number(savedLease.lastSeen || this.sessionStartedAt);
    localSet(SESSION_KEY, JSON.stringify({ sessionId, startedAt: this.sessionStartedAt }));
    saveHandled(new Set());
    this.active = true;
    await this.requestWakeLock();
    if (takeover) await wait(3_000);
    try {
      if (typeof this.store.fetchRemote === 'function') await this.store.fetchRemote();
    } catch (error) {
      await this.failSafeStop(`Receiver ownership could not be rechecked after startup: ${error.message}`);
      throw new Error(`Receiver stayed silent because ownership could not be rechecked: ${error.message}`);
    }
    if (!this.isOwner()) {
      await this.failSafeStop('Another receiver took ownership during startup. This device stayed silent.');
      throw new Error('Another receiver took ownership during startup. Nothing was played.');
    }
    await this.renewLeaseOnly();
    let restoreError = '';
    let startupRenewError = null;
    let startupRenewal = Promise.resolve();
    const startupRenewTimer = setInterval(() => {
      startupRenewal = startupRenewal.then(() => this.renewLeaseOnly()).catch(error => {
        startupRenewError = error;
      });
    }, HEARTBEAT_MS);
    try {
      if (this.isOwner()) await this.audio.playUnlockTone();
      if (this.isOwner() && this.state.playback.intent === 'playing') {
        try {
          const restored = await this.restorePlaybackIntent();
          if (!restored) throw new Error('The saved source did not contain a playable track.');
        } catch (error) {
          restoreError = error.message || String(error);
          this.audio.stopMusic();
          this.physicalProvider = '';
          this.physicalRequestId = 0;
          await this.spotify.pauseForAnnouncement().catch(() => {});
          await this.store.mutate(draft => {
            if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
              throw new Error('Receiver ownership changed while a failed playback restore was being recorded.');
            }
            draft.playback = {
              ...(draft.playback || {}),
              intent: 'paused',
              unavailableReason: `Saved playback could not be restored: ${restoreError}`,
              updatedAt: this.now()
            };
            return draft;
          }, 'Playback restore failed safely', { requireDurable: true });
        }
      }
      if (spotifyCapability) {
        const spotifyPolicy = this.currentPolicy('spotify');
        await this.updateReceiverDetail(spotifyPolicy.detail, spotifyPolicy.id);
      }
    } finally {
      clearInterval(startupRenewTimer);
      await startupRenewal;
    }
    if (startupRenewError) {
      await this.failSafeStop(`Receiver startup heartbeat failed: ${startupRenewError.message}`);
      throw new Error(`Receiver stayed silent because its startup heartbeat failed: ${startupRenewError.message}`);
    }
    if (!this.isOwner()) {
      await this.failSafeStop('Receiver ownership changed before startup completed. Audio stopped.');
      throw new Error('Receiver ownership changed before startup completed.');
    }
    this.startLoops();
    this.prewarmSafetyVoices().catch(() => {});
    const readyPolicy = this.currentPolicy(startupProvider);
    this.status(
      restoreError ? `Receiver is active, but saved playback is silent: ${restoreError}` : `Receiver ready. ${readyPolicy.detail}`,
      !restoreError,
      { policy: readyPolicy }
    );
    this.onChange();
    const pendingWeatherWarning = (this.state.weather.pendingAnnouncementIds || []).some(id => ['lightning', 'wind', 'tornado'].includes(id));
    if (pendingWeatherWarning || (this.state.config.weatherAuto && this.now() - Number(this.state.weather.checkedAt || 0) > WEATHER_INTERVAL_MS)) {
      this.checkWeather({ announce: true, reason: 'receiver start' }).catch(error => this.status(`Weather check will retry: ${error.message}`, false));
    }
    return savedLease;
  }

  async updateReceiverDetail(detail, audioMode = '') {
    if (!this.active) return;
    await this.store.mutate(draft => {
      if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) return draft;
      draft.receiver = renewReceiverLease(draft.receiver, this.now(), { detail, audioMode: audioMode || draft.receiver.audioMode });
      return draft;
    }, 'Receiver capability', { requireDurable: true });
    const savedReceiver = this.state.receiver;
    if (savedReceiver?.id !== this.deviceId || savedReceiver?.sessionId !== this.sessionId) {
      await this.failSafeStop('Another receiver session replaced this device while its capability was being saved. Audio stopped.');
      return;
    }
    this.lastDurableHeartbeatAt = Number(savedReceiver.lastSeen || this.now());
    this.armLeaseGuard();
  }

  async renewLeaseOnly() {
    if (!this.active) throw new Error('Receiver is no longer active.');
    await this.store.mutate(draft => {
      if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
        throw new Error('Receiver ownership changed during startup renewal.');
      }
      draft.receiver = renewReceiverLease(draft.receiver, this.now());
      return draft;
    }, 'Receiver heartbeat during startup', { requireDurable: true });
    const savedReceiver = this.state.receiver;
    if (savedReceiver?.id !== this.deviceId || savedReceiver?.sessionId !== this.sessionId) {
      throw new Error('Receiver ownership changed during startup renewal.');
    }
    this.lastDurableHeartbeatAt = Number(savedReceiver.lastSeen || this.now());
    this.armLeaseGuard();
    return savedReceiver;
  }

  startLoops() {
    this.stopLoops();
    const every = (key, fn, ms) => {
      const run = async () => {
        if (!this.active || this.loopInFlight.has(key)) return;
        this.loopInFlight.add(key);
        try { await fn(); }
        catch (error) { this.status(error.message || String(error), false); }
        finally { this.loopInFlight.delete(key); }
      };
      const timer = setInterval(run, ms);
      this.timers.add(timer);
    };
    every('heartbeat', () => this.heartbeat(), HEARTBEAT_MS);
    every('events', () => this.processPendingEvents(), EVENT_POLL_MS);
    every('schedule', () => this.tickSchedule(), SCHEDULE_TICK_MS);
    every('weather', () => this.state.config.weatherAuto
      ? this.checkWeather({ announce: true, reason: 'automatic two-minute scan' })
      : Promise.resolve(), WEATHER_INTERVAL_MS);
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.armLeaseGuard();
    this.processPendingEvents().catch(() => {});
    this.tickSchedule().catch(() => {});
  }

  stopLoops() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
    this.loopInFlight.clear();
    if (this.leaseGuardTimer) clearTimeout(this.leaseGuardTimer);
    this.leaseGuardTimer = null;
    document.removeEventListener('visibilitychange', this.visibilityHandler);
  }

  async stop({ release = true } = {}) {
    this.nextAudioRequest();
    this.invalidateAudioRestores();
    const stoppingProvider = this.physicalProvider;
    this.cancelPendingAnnouncements('Receiver stop requested.');
    this.audio.stopVoice();
    this.audio.stopMusic();
    this.physicalProvider = '';
    this.physicalRequestId = 0;
    try {
      await this.settleAudioOperations();
    } catch (error) {
      if (release) throw new Error(`Receiver stayed active because an older audio action could not be settled safely: ${error.message}`);
    }
    const spotifyCouldBePlaying = this.spotify.ready ||
      stoppingProvider === 'spotify' ||
      this.spotify.current?.paused === false ||
      (this.state.playback.provider === 'spotify' && this.state.playback.intent === 'playing');
    if (this.active && spotifyCouldBePlaying) {
      try {
        await this.spotify.pauseForAnnouncement();
      } catch (error) {
        if (release) {
          throw new Error(`Receiver was not stopped because Spotify could not be confirmed paused: ${error.message}`);
        }
        await this.failSafeStop(`Session ended, and Spotify pause could not be confirmed: ${error.message}`);
        return;
      }
    }
    this.stopLoops();
    this.active = false;
    this.cancelPendingAnnouncements('Receiver stopped before the announcement could play.');
    this.audio.stopVoice();
    this.audio.stopMusic();
    this.physicalProvider = '';
    this.physicalRequestId = 0;
    this.spotify.disconnect();
    if (this.wakeLock) {
      try { await this.wakeLock.release(); } catch {}
      this.wakeLock = null;
    }
    if (release) {
      const deviceId = this.deviceId;
      const sessionId = this.sessionId;
      await this.store.mutate(draft => {
        if (draft.receiver?.id === deviceId && draft.receiver?.sessionId === sessionId) {
          const now = this.now();
          draft.receiver = { ...draft.receiver, status: 'offline', lastSeen: now, leaseUntil: now };
          if (draft.playback?.intent === 'playing') {
            draft.playback = { ...draft.playback, intent: 'paused', updatedAt: now };
          }
        }
        draft.activityLog = [makeLog('receiver', 'Receiver stopped', 'Speaker receiver released by this device.'), ...(draft.activityLog || [])];
        return draft;
      }, 'Receiver stopped');
    }
    localRemove(SESSION_KEY);
    this.sessionId = '';
    this.sessionStartedAt = 0;
    this.lastDurableHeartbeatAt = 0;
    this.status('Receiver stopped.', true);
    this.onChange();
  }

  async requestWakeLock() {
    if (!this.active || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return false;
    try {
      this.wakeLock = await withTimeout(
        navigator.wakeLock.request('screen'),
        3_500,
        'Screen wake lock request timed out'
      );
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
        if (this.active && document.visibilityState === 'visible') this.requestWakeLock().catch(() => {});
      }, { once: true });
      return true;
    } catch (error) {
      this.status(`Screen wake lock was not granted: ${error.message}. Keep the receiver plugged in and this page visible.`, false);
      return false;
    }
  }

  async onVisibilityChange() {
    if (!this.active) return;
    if (document.visibilityState === 'visible') {
      await this.audio.unlock().catch(() => {});
      await this.requestWakeLock();
      await this.heartbeat();
      await this.processPendingEvents();
      await this.tickSchedule();
    }
  }

  armLeaseGuard() {
    if (this.leaseGuardTimer) clearTimeout(this.leaseGuardTimer);
    if (!this.active || !this.lastDurableHeartbeatAt) return;
    const remaining = Math.max(0, (this.lastDurableHeartbeatAt + RECEIVER_LEASE_MS) - this.now());
    this.leaseGuardTimer = setTimeout(() => {
      this.leaseGuardTimer = null;
      if (this.active) {
        this.failSafeStop('Durable cloud heartbeats stopped for a full receiver lease. Audio stopped before another receiver can take ownership.').catch(() => {});
      }
    }, remaining);
  }

  async heartbeat() {
    if (!this.active) return;
    const musicTarget = this.applyConfiguredMusicTarget({ report: false });
    let spotifyPlayback = null;
    let spotifyUnavailableReason = '';
    let spotifyCheckSuperseded = false;
    const spotifyCheckEpoch = this.audioEpoch;
    const spotifyCheckPauseGeneration = this.spotifyPauseGeneration;
    const cloudSpotifyExpected = this.state.playback.provider === 'spotify' && this.state.playback.intent === 'playing' && this.physicalProvider !== 'controlled';
    if (cloudSpotifyExpected && !this.spotify.ready) {
      this.spotify.resetVolumeVerification?.();
      spotifyUnavailableReason = 'The local Spotify receiver went offline and must be reconnected with a fresh tap.';
      if (this.physicalProvider === 'spotify') {
        this.physicalProvider = '';
        this.physicalRequestId = 0;
        this.physicalCommittedRequestId = 0;
      }
    }
    if (this.spotify.ready && this.temporarySpotifyPauseDepth === 0) {
      try {
        spotifyPlayback = await this.spotify.playbackState();
        if (this.temporarySpotifyPauseDepth > 0 || this.audioEpoch !== spotifyCheckEpoch || this.spotifyPauseGeneration !== spotifyCheckPauseGeneration) {
          spotifyCheckSuperseded = true;
          spotifyPlayback = null;
        } else {
          const localPlayback = spotifyPlayback.isPlaying && String(spotifyPlayback.deviceId || '') === String(this.spotify.deviceId || '');
          if (!cloudSpotifyExpected && localPlayback) {
            try {
              await this.spotify.pauseForAnnouncement();
              spotifyPlayback = null;
              this.status('Unexpected Spotify playback on the receiver was paused to preserve the single-source mix.', false);
            } catch (pauseError) {
            this.audio.stopMusic();
            this.physicalProvider = 'spotify';
            this.physicalRequestId = 0;
              throw new Error(`Unexpected Spotify playback overlapped the controlled source and could not be confirmed paused: ${pauseError.message}`);
            }
          } else if (cloudSpotifyExpected && !localPlayback) {
            this.spotify.resetVolumeVerification();
            spotifyUnavailableReason = spotifyPlayback.deviceId && spotifyPlayback.deviceId !== this.spotify.deviceId
              ? 'Spotify playback moved to another device.'
              : 'The local Spotify receiver is not reporting active playback.';
            this.physicalProvider = '';
            this.physicalRequestId = 0;
            throw new Error(spotifyUnavailableReason);
          } else if (cloudSpotifyExpected && localPlayback) {
            const measured = await this.spotify.readLocalVolume(musicTarget);
            if (!measured.matches || !this.spotify.volumeVerified || this.spotify.verifiedPercent !== musicTarget) {
              await this.spotify.enforceVolume(musicTarget);
            }
          }
        }
      } catch (error) {
        this.spotify.resetVolumeVerification();
        this.status(`Spotify ${musicTarget}% verification will retry: ${error.message}`, false);
      }
    }
    const policy = this.currentPolicy(this.state.playback.provider || this.state.config.musicProvider);
    try {
      await this.store.mutate(draft => {
        const heartbeatNow = this.now();
        const current = draft.receiver;
        if (current?.id !== this.deviceId || current?.sessionId !== this.sessionId) return draft;
        draft.receiver = renewReceiverLease(current, heartbeatNow, {
          detail: policy.detail,
          audioMode: policy.id
        });
        if (draft.playback?.provider === 'spotify' && !spotifyCheckSuperseded && this.temporarySpotifyPauseDepth === 0 && this.spotifyPauseGeneration === spotifyCheckPauseGeneration) {
          const spotifyLabel = !spotifyUnavailableReason && spotifyPlayback?.name
            ? `${spotifyPlayback.name}${spotifyPlayback.artists ? ` - ${spotifyPlayback.artists}` : ''}`
            : (this.spotify.current?.name
                ? `${this.spotify.current.name}${this.spotify.current.artists ? ` - ${this.spotify.current.artists}` : ''}`
                : draft.playback.label);
          draft.playback = {
            ...draft.playback,
            intent: spotifyUnavailableReason ? 'paused' : draft.playback.intent,
            label: spotifyLabel,
            positionMs: Number(spotifyPlayback?.position || draft.playback.positionMs || 0),
            unavailableReason: spotifyUnavailableReason,
            volumeVerified: !!this.spotify.volumeVerified,
            volumeVerifiedPercent: this.spotify.volumeVerified ? this.spotify.verifiedPercent : null,
            volumeVerifiedAt: this.spotify.volumeVerified ? heartbeatNow : 0,
            audioPolicy: policy.id,
            updatedAt: heartbeatNow
          };
        } else if (draft.playback?.provider === 'controlled' && draft.playback.intent === 'playing' && this.audio.musicElement) {
          const controlledAudible = this.physicalProvider === 'controlled' && !!this.audio.musicPlaying?.();
          draft.playback = {
            ...draft.playback,
            intent: controlledAudible ? 'playing' : 'paused',
            positionMs: Math.max(0, Math.round(Number(this.audio.musicElement.currentTime || 0) * 1000)),
            unavailableReason: controlledAudible ? '' : 'The controlled music element is not audibly playing on the receiver.',
            updatedAt: heartbeatNow
          };
          if (!controlledAudible && this.physicalProvider === 'controlled') this.physicalProvider = '';
        }
        return draft;
      }, 'Receiver heartbeat', { requireDurable: true });
      const savedReceiver = this.state.receiver;
      if (savedReceiver?.id !== this.deviceId || savedReceiver?.sessionId !== this.sessionId) {
        await this.failSafeStop('Another receiver session replaced this device during its heartbeat. Audio stopped.');
        return;
      }
      this.lastDurableHeartbeatAt = Number(savedReceiver.lastSeen || this.now());
      this.armLeaseGuard();
    } catch (error) {
      if (this.now() - Number(this.lastDurableHeartbeatAt || 0) >= RECEIVER_LEASE_MS) {
        await this.failSafeStop('Cloud heartbeat was lost for the full receiver lease. Audio stopped to prevent two speaker receivers from running.');
        return;
      }
      throw new Error(`Receiver heartbeat retrying: ${error.message}`);
    }
    if (!this.isOwner(this.now())) {
      await this.failSafeStop('This device is no longer the active speaker receiver. Audio stopped.');
    }
  }

  async failSafeStop(message) {
    this.nextAudioRequest();
    this.invalidateAudioRestores();
    this.active = false;
    this.stopLoops();
    this.cancelPendingAnnouncements(message);
    this.audio.stopVoice();
    this.audio.stopMusic();
    let settleError = '';
    await this.settleAudioOperations().catch(error => { settleError = error.message || String(error); });
    let spotifyPauseError = '';
    const spotifyCouldBePlaying = this.spotify.ready ||
      this.physicalProvider === 'spotify' ||
      (this.state.playback.provider === 'spotify' && this.state.playback.intent === 'playing');
    if (spotifyCouldBePlaying) {
      await this.spotify.pauseForAnnouncement().catch(error => {
        spotifyPauseError = error.message || String(error);
      });
    }
    if (!settleError) {
      this.spotify.disconnect();
    } else {
      this.audioTail.finally(async () => {
        await this.spotify.pauseForAnnouncement().catch(() => {});
        this.spotify.disconnect();
      });
    }
    if (this.wakeLock) {
      try { await this.wakeLock.release(); } catch {}
      this.wakeLock = null;
    }
    const stopDetail = [settleError ? `Older audio action still settling: ${settleError}` : '', spotifyPauseError ? `Spotify could not be confirmed paused: ${spotifyPauseError}` : ''].filter(Boolean).join(' ');
    this.status(stopDetail ? `${message} ${stopDetail}` : message, false);
    this.onChange();
  }

  async sendCommand(type, payload = {}, message = 'Command sent.') {
    let created = null;
    await this.store.mutate(draft => {
      const now = this.now();
      created = createTargetedEvent(type, payload, draft.receiver, now);
      draft.events = mergeById([...(draft.events || []), created]).slice(-120);
      draft.activityLog = [makeLog('command', message, payload.label || payload.text || payload.url || '', now, { eventId: created.id, commandType: type }), ...(draft.activityLog || [])];
      return draft;
    }, message, { requireDurable: true });
    this.status(message, true, { event: created });
    if (this.isOwner()) await this.processPendingEvents();
    return created;
  }

  async processPendingEvents() {
    if (!this.isOwner() || this.processing) return;
    this.processing = true;
    try {
      const handled = handledIds();
      const events = pendingEventsForReceiver(this.state.events, this.state.receiver, this.sessionStartedAt, handled, this.now());
      for (const event of events) {
        this.processEvent(event).catch(error => this.status(`Command completion failed: ${error.message}`, false, { event }));
      }
    } finally {
      this.processing = false;
      this.onChange();
    }
  }

  async processEvent(event) {
    if (!event?.id || this.inFlightEventIds.has(event.id) || handledIds().has(event.id)) return false;
    this.inFlightEventIds.add(event.id);
    let error = '';
    try {
      try {
        await this.handleEvent(event);
      } catch (caught) {
        error = caught.message || String(caught);
        this.status(`Command failed: ${error}`, false, { event });
      }
      const handled = handledIds();
      handled.add(event.id);
      saveHandled(handled);
      const completedAt = this.now();
      const completed = completeEvent(event, this.deviceId, completedAt, error);
      await this.store.mutate(draft => {
        draft.events = mergeById([...(draft.events || []), completed]).slice(-120);
        draft.activityLog = [
          makeLog(error ? 'error' : 'receiver', error ? 'Receiver command failed' : 'Receiver command completed', error || event.payload?.label || event.type, completedAt, { eventId: event.id, commandType: event.type }),
          ...(draft.activityLog || [])
        ];
        return draft;
      }, error ? 'Command failure recorded' : 'Command completed', { requireDurable: true });
      return !error;
    } finally {
      this.inFlightEventIds.delete(event.id);
      this.onChange();
    }
  }

  async handleEvent(event) {
    const payload = event.payload || {};
    switch (event.type) {
      case 'play-controlled':
        return await this.playControlled(payload.url, { label: payload.label, index: payload.index });
      case 'play-spotify':
        return await this.playSpotify(payload.url);
      case 'pause-music':
        return await this.pauseMusic();
      case 'resume-music':
        return await this.resumeMusic();
      case 'stop-music':
        return await this.stopMusic();
      case 'next-music':
        return await this.nextMusic();
      case 'set-music-level':
        return await this.setMusicLevel(payload.percent);
      case 'announce':
      case 'announce-safety':
        return await this.announce(payload.text, { safety: event.type === 'announce-safety', label: payload.label, eventId: event.id });
      case 'weather-check':
        return await this.checkWeather({ announce: payload.announce !== false, reason: 'remote command' });
      case 'calibration':
        return await this.runCalibration();
      default:
        throw new Error(`Unknown receiver command: ${event.type}`);
    }
  }

  async resolveControlledTracks(url) {
    const raw = String(url || '').trim();
    if (!raw) throw new Error('Paste a Suno playlist, Suno song, or direct audio URL first.');
    const data = await fetchJson(`/api/suno-playlist?url=${encodeURIComponent(raw)}`);
    const tracks = (data.tracks || []).map(safeTrack).filter(track => /^https:\/\//i.test(track.audioUrl));
    if (!tracks.length) throw new Error(data.audioWarning || 'That source did not expose a playable audio track. Use a public Suno link or direct HTTPS audio URL.');
    return { tracks, playlistName: data.playlistName || tracks[0].title, source: data.source || '' };
  }

  async playControlled(url, { label = '', index = 0 } = {}) {
    if (!this.isOwner()) throw new Error('This device is not the active speaker receiver.');
    this.assertNoSafetyPending();
    this.applyConfiguredMusicTarget({ report: false });
    const requestId = this.nextAudioRequest();
    const previousPlayback = structuredClone(this.state.playback || {});
    const previousSourceConfig = Object.fromEntries(['musicProvider', 'musicUrl', 'musicLabel', 'spotifyUrl'].map(key => [key, this.state.config[key]]));
    const resolved = await this.resolveControlledTracks(url);
    if (requestId !== this.audioRequestId) throw new Error('A newer audio command replaced this music request while its source was loading.');
    if (!this.isOwner()) throw new Error('Receiver ownership changed while the music source was loading. Nothing was played.');
    const epoch = this.invalidateAudioRestores();
    const physical = await this.serializeAudio(async () => {
      this.assertAudioRequest(requestId, epoch);
      const spotifyCouldBePlaying = this.physicalProvider === 'spotify' ||
        this.spotify.ready ||
        this.spotify.current?.paused === false ||
        (this.state.playback.provider === 'spotify' && this.state.playback.intent === 'playing');
      if (spotifyCouldBePlaying) this.beginTemporarySpotifyPause();
      let spotifySnapshot = null;
      try {
        if (spotifyCouldBePlaying) {
          try {
            spotifySnapshot = await this.spotify.pauseForAnnouncement();
          } catch (error) {
            throw new Error(`Controlled music was not started because Spotify could not be confirmed paused: ${error.message}`);
          }
        }
        try {
          this.assertAudioRequest(requestId, epoch, 'Controlled music was superseded while Spotify was pausing.');
        } catch (error) {
          if (spotifySnapshot?.wasPlaying) this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot });
          throw error;
        }
        if (spotifyCouldBePlaying) this.physicalProvider = '';
        const safeIndex = Math.max(0, Math.min(resolved.tracks.length - 1, Number(index) || 0));
        const track = resolved.tracks[safeIndex];
        this.assertAudioRequest(requestId, epoch, 'Controlled music was superseded before its media could start.');
        try {
          await this.audio.playMusicUrl(track.audioUrl, { label: track.title || label || resolved.playlistName, loop: resolved.tracks.length === 1 });
        } catch (error) {
          let restoreError = '';
          const carriedToSafety = spotifySnapshot?.wasPlaying && this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot });
          if (!carriedToSafety && spotifySnapshot?.wasPlaying && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
            await this.spotify.resumeAfterAnnouncement(spotifySnapshot, {
              assertCurrent: () => this.assertAudioRequest(requestId, epoch)
            }).then(() => { this.physicalProvider = 'spotify'; }).catch(caught => { restoreError = caught.message || String(caught); });
          }
          throw new Error(restoreError ? `${error.message} Spotify also could not be restored: ${restoreError}` : error.message);
        }
        if (requestId !== this.audioRequestId || epoch !== this.audioEpoch) {
          this.audio.stopMusic();
          if (spotifySnapshot?.wasPlaying) this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot });
          throw new Error('A newer audio command replaced this controlled-music start.');
        }
        if (!this.isOwner()) {
          this.audio.stopMusic();
          throw new Error('Receiver ownership changed while music was starting, so playback was stopped.');
        }
        this.physicalProvider = 'controlled';
        this.physicalRequestId = requestId;
        return { spotifySnapshot, safeIndex, track };
      } finally {
        if (spotifyCouldBePlaying) this.endTemporarySpotifyPause();
      }
    });
    try {
      await this.store.mutate(draft => {
        this.assertReceiptCurrent(requestId, epoch, 'Controlled playback was superseded before its cloud receipt could commit.');
        if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
          throw new Error('Receiver ownership changed before controlled playback could be recorded.');
        }
        draft.config.musicProvider = 'controlled';
        draft.config.musicUrl = String(url || '');
        draft.config.musicLabel = label || resolved.playlistName;
        draft.playback = {
          provider: 'controlled',
          intent: 'playing',
          label: `${physical.track.title}${physical.track.artist ? ` - ${physical.track.artist}` : ''}`,
          sourceUrl: String(url || ''),
          audioUrl: physical.track.audioUrl,
          trackIndex: physical.safeIndex,
          tracks: resolved.tracks,
          updatedAt: this.now()
        };
        draft.activityLog = [makeLog('play', `Controlled music playing at ${draft.config.musicLevel}%`, draft.playback.label, this.now(), { provider: 'controlled' }), ...(draft.activityLog || [])];
        return draft;
      }, 'Controlled music started', { requireDurable: true });
      this.assertReceiptCurrent(requestId, epoch, 'Controlled playback was superseded while its cloud receipt was committing.');
      this.physicalCommittedRequestId = requestId;
      this.rememberCommittedPlayback(requestId);
    } catch (error) {
      let restoreError = '';
      await this.serializeAudio(async () => {
        const mustQuiet = this.physicalRequestId === requestId || this.audioRequestKind === 'safety' || this.audioRequestKind === 'terminal' || !this.isOwner();
        if (!mustQuiet) return;
        this.audio.stopMusic();
        this.physicalProvider = '';
        this.physicalRequestId = 0;
        this.physicalCommittedRequestId = 0;
        const carriedToSafety = physical.spotifySnapshot?.wasPlaying && this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot: physical.spotifySnapshot });
        if (!carriedToSafety && physical.spotifySnapshot?.wasPlaying && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
          try {
            await this.spotify.resumeAfterAnnouncement(physical.spotifySnapshot, {
              assertCurrent: () => this.assertAudioRequest(requestId, epoch)
            });
            this.physicalProvider = 'spotify';
          } catch (caught) {
            restoreError = caught.message || String(caught);
          }
        }
      });
      if (error.code === 'AUDIO_RECEIPT_SUPERSEDED' && this.audioRequestKind === 'safety' && this.isOwner()) {
        await this.compensateSafetyReceipt(previousPlayback, previousSourceConfig);
      } else if (error.code === 'AUDIO_RECEIPT_SUPERSEDED' && this.audioRequestKind === 'normal' && this.isOwner()) {
        await this.repairCurrentCommittedReceipt();
      }
      throw new Error(restoreError
        ? `Controlled music was stopped because its cloud state could not be saved: ${error.message}. Spotify restore also failed: ${restoreError}`
        : `Controlled music was stopped because its cloud state could not be saved: ${error.message}`);
    }
    this.status(`${physical.track.title} is playing at exact ${this.state.config.musicLevel}%.`, true);
    return true;
  }

  async playSpotify(url) {
    if (!this.isOwner()) throw new Error('This device is not the active speaker receiver.');
    this.assertNoSafetyPending();
    if (!this.spotify.loggedIn()) throw new Error('Spotify is not logged in on the speaker receiver. Open Settings on that device and choose Login Spotify.');
    if (!this.spotify.ready) throw new Error('Spotify needs a local receiver tap. On the speaker device, open Receiver and choose Connect Spotify Receiver.');
    if (!this.isOwner()) throw new Error('Receiver ownership changed before Spotify could start.');
    this.applyConfiguredMusicTarget({ report: false });
    const requestId = this.nextAudioRequest();
    const epoch = this.invalidateAudioRestores();
    const previousPlayback = structuredClone(this.state.playback || {});
    const previousSourceConfig = Object.fromEntries(['musicProvider', 'musicUrl', 'musicLabel', 'spotifyUrl'].map(key => [key, this.state.config[key]]));
    const physical = await this.serializeAudio(async () => {
      this.assertAudioRequest(requestId, epoch);
      const controlledAudible = this.physicalProvider === 'controlled' || !!this.audio.musicPlaying?.();
      const controlledSnapshot = controlledAudible
        ? {
            audioUrl: String(this.audio.currentUrl || this.state.playback.audioUrl || ''),
            label: String(this.audio.currentLabel || this.state.playback.label || 'Suno / direct audio'),
            position: Number(this.audio.musicElement?.currentTime || 0)
          }
        : null;
      this.audio.pauseMusic();
      let result;
      try {
        result = await this.spotify.play(url || this.state.config.spotifyUrl, {
          assertCurrent: () => this.assertAudioRequest(requestId, epoch)
        });
      } catch (error) {
        const superseded = requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner();
        if (superseded) {
          try {
            await this.spotify.pauseForAnnouncement();
          } catch (pauseError) {
            throw new Error(`Superseded Spotify playback could not be confirmed paused: ${pauseError.message}`);
          }
          this.physicalProvider = '';
          if (controlledSnapshot) this.carrySafetyRestore({ provider: 'controlled', controlledSnapshot: { ...controlledSnapshot, wasPlaying: true } });
          throw new Error(`Spotify playback was superseded and stopped: ${error.message}`);
        }
        let restoreError = '';
        if (controlledSnapshot && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
          try {
            const resumed = await this.audio.resumeMusic();
            if (!resumed && controlledSnapshot.audioUrl) {
              await this.audio.playMusicUrl(controlledSnapshot.audioUrl, { label: controlledSnapshot.label, startAt: controlledSnapshot.position });
            }
          } catch (caught) {
            restoreError = caught.message || String(caught);
          }
        }
        throw new Error(restoreError ? `${error.message} Controlled music also could not be restored: ${restoreError}` : error.message);
      }
      if (requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner()) {
        try {
          await this.spotify.pauseForAnnouncement();
        } catch (error) {
          throw new Error(`Spotify was superseded while starting and could not be confirmed paused: ${error.message}`);
        }
        this.physicalProvider = '';
        if (controlledSnapshot) this.carrySafetyRestore({ provider: 'controlled', controlledSnapshot: { ...controlledSnapshot, wasPlaying: true } });
        throw new Error('Spotify was superseded while starting, so playback was stopped.');
      }
      this.audio.stopMusic();
      this.physicalProvider = 'spotify';
      this.physicalRequestId = requestId;
      return { controlledSnapshot, result };
    });
    const policy = this.currentPolicy('spotify');
    try {
      await this.store.mutate(draft => {
        this.assertReceiptCurrent(requestId, epoch, 'Spotify playback was superseded before its cloud receipt could commit.');
        if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
          throw new Error('Receiver ownership changed before Spotify playback could be recorded.');
        }
        draft.config.musicProvider = 'spotify';
        draft.config.spotifyUrl = String(url || draft.config.spotifyUrl || '');
        draft.playback = {
          provider: 'spotify',
          intent: 'playing',
          label: this.spotify.current?.name || 'Spotify playlist',
          sourceUrl: draft.config.spotifyUrl,
          trackIndex: 0,
          updatedAt: this.now(),
          volumeVerified: !!physical.result.volume?.verified,
          volumeVerifiedPercent: physical.result.volume?.verified ? physical.result.volume.verifiedPercent : null,
          volumeVerifiedAt: physical.result.volume?.verified ? this.now() : 0,
          audioPolicy: policy.id
        };
        draft.activityLog = [makeLog('play', physical.result.volume?.verified ? `Spotify playing at verified ${draft.config.musicLevel}%` : 'Spotify playing in compatibility mode', policy.detail, this.now(), { provider: 'spotify' }), ...(draft.activityLog || [])];
        return draft;
      }, 'Spotify playback started', { requireDurable: true });
      this.assertReceiptCurrent(requestId, epoch, 'Spotify playback was superseded while its cloud receipt was committing.');
      this.physicalCommittedRequestId = requestId;
      this.rememberCommittedPlayback(requestId);
    } catch (error) {
      let pauseError = '';
      let restoreError = '';
      await this.serializeAudio(async () => {
        const mustQuiet = this.physicalRequestId === requestId || this.audioRequestKind === 'safety' || this.audioRequestKind === 'terminal' || !this.isOwner();
        if (!mustQuiet) return;
        await this.spotify.pauseForAnnouncement().catch(caught => { pauseError = caught.message || String(caught); });
        this.physicalProvider = pauseError ? 'spotify' : '';
        if (!pauseError) {
          this.physicalRequestId = 0;
          this.physicalCommittedRequestId = 0;
        }
        const carriedToSafety = !pauseError && physical.controlledSnapshot && this.carrySafetyRestore({ provider: 'controlled', controlledSnapshot: { ...physical.controlledSnapshot, wasPlaying: true } });
        if (!pauseError && !carriedToSafety && physical.controlledSnapshot && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
          try {
            const resumed = await this.audio.resumeMusic();
            if (!resumed && physical.controlledSnapshot.audioUrl) {
              await this.audio.playMusicUrl(physical.controlledSnapshot.audioUrl, {
                label: physical.controlledSnapshot.label,
                startAt: physical.controlledSnapshot.position
              });
            }
            this.physicalProvider = 'controlled';
          } catch (caught) {
            restoreError = caught.message || String(caught);
          }
        }
      });
      if (error.code === 'AUDIO_RECEIPT_SUPERSEDED' && this.audioRequestKind === 'safety' && this.isOwner()) {
        await this.compensateSafetyReceipt(previousPlayback, previousSourceConfig);
      } else if (error.code === 'AUDIO_RECEIPT_SUPERSEDED' && this.audioRequestKind === 'normal' && this.isOwner()) {
        await this.repairCurrentCommittedReceipt();
      }
      throw new Error(`Spotify was stopped because its cloud state could not be saved: ${error.message}${pauseError ? ` Spotify pause confirmation failed: ${pauseError}` : ''}${restoreError ? ` Controlled music restore failed: ${restoreError}` : ''}`);
    }
    await this.updateReceiverDetail(policy.detail, policy.id).catch(error => this.status(`Spotify is playing, but receiver capability detail could not be saved: ${error.message}`, false));
    return true;
  }

  async pauseMusic() {
    const requestId = this.nextAudioRequest('terminal');
    this.invalidateAudioRestores();
    const physical = await this.serializeAudio(async () => {
      this.assertTerminalRequest(requestId);
      const provider = this.physicalProvider || this.state.playback.provider || this.state.config.musicProvider;
      const positionMs = provider === 'controlled' && this.audio.musicElement
        ? Math.max(0, Math.round(Number(this.audio.musicElement.currentTime || 0) * 1000))
        : Number(this.state.playback.positionMs || 0);
      const spotifyMayBeAudible = provider === 'spotify' || this.spotify.ready || this.spotify.current?.paused === false;
      if (spotifyMayBeAudible) await this.spotify.pauseForAnnouncement();
      this.audio.pauseMusic();
      this.physicalRequestId = 0;
      this.physicalCommittedRequestId = 0;
      this.preemptedSpotifySnapshot = null;
      this.safetyRestoreSnapshot = null;
      this.assertTerminalRequest(requestId, 'A newer audio command replaced this pause after the source became quiet.');
      return { provider, positionMs };
    });
    await this.updatePlayback({ provider: physical.provider, intent: 'paused', positionMs: physical.positionMs }, 'Music paused');
    return true;
  }

  async resumeMusic() {
    if (!this.isOwner()) throw new Error('This device is not the active speaker receiver.');
    this.assertNoSafetyPending();
    const requestId = this.nextAudioRequest();
    const epoch = this.invalidateAudioRestores();
    const previousPlayback = structuredClone(this.state.playback || {});
    const provider = await this.serializeAudio(async () => {
      this.assertAudioRequest(requestId, epoch);
      const activeProvider = this.physicalProvider || this.state.playback.provider || this.state.config.musicProvider;
      let resumed;
      if (activeProvider === 'spotify') {
        this.audio.pauseMusic();
        try {
          resumed = await this.spotify.resume({ assertCurrent: () => this.assertAudioRequest(requestId, epoch) });
        } catch (error) {
          if (requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner()) {
            try {
              await this.spotify.pauseForAnnouncement();
            } catch (pauseError) {
              throw new Error(`Superseded Spotify resume could not be confirmed paused: ${pauseError.message}`);
            }
          }
          throw error;
        }
      } else {
        if (this.spotify.ready || this.spotify.current?.paused === false) {
          await this.spotify.pauseForAnnouncement();
          this.assertAudioRequest(requestId, epoch, 'Controlled resume was superseded while Spotify was being silenced.');
        }
        this.applyConfiguredMusicTarget({ report: false });
        resumed = await this.audio.resumeMusic();
        if (!resumed && this.state.playback.audioUrl) {
          await this.audio.playMusicUrl(this.state.playback.audioUrl, {
            label: this.state.playback.label || 'Suno / direct audio',
            startAt: Number(this.state.playback.positionMs || 0) / 1000
          });
          resumed = true;
        }
      }
      if (!resumed) throw new Error('There is no paused track to resume.');
      if (requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner()) {
        if (activeProvider === 'spotify') {
          await this.spotify.pauseForAnnouncement().catch(error => {
            throw new Error(`Receiver ownership changed while Spotify was resuming, and Spotify could not be confirmed paused: ${error.message}`);
          });
        } else this.audio.stopMusic();
        throw new Error('Music resume was superseded, so playback was stopped.');
      }
      this.physicalProvider = activeProvider;
      this.physicalRequestId = requestId;
      return activeProvider;
    });
    try {
      await this.updatePlayback({ provider, intent: 'playing', unavailableReason: '' }, 'Music resumed', { requestId, epoch });
      this.physicalCommittedRequestId = requestId;
      this.rememberCommittedPlayback(requestId);
    } catch (error) {
      let pauseError = '';
      await this.serializeAudio(async () => {
        const rollback = !this.isOwner() || this.physicalRequestId === requestId || this.safetyPendingCount > 0 || this.audioRequestKind === 'safety' || this.audioRequestKind === 'terminal';
        if (!rollback) return;
        if (provider === 'spotify') await this.spotify.pauseForAnnouncement().catch(caught => { pauseError = caught.message || String(caught); });
        else this.audio.pauseMusic();
        if (!pauseError) {
          this.physicalProvider = provider;
          this.physicalRequestId = 0;
          this.physicalCommittedRequestId = 0;
        }
      });
      if (error.code === 'AUDIO_RECEIPT_SUPERSEDED' && this.audioRequestKind === 'safety' && this.isOwner()) {
        await this.compensateSafetyReceipt(previousPlayback);
      } else if (error.code === 'AUDIO_RECEIPT_SUPERSEDED' && this.audioRequestKind === 'normal' && this.isOwner()) {
        await this.repairCurrentCommittedReceipt();
      }
      throw new Error(`Music was paused because its resume receipt could not be saved: ${error.message}${pauseError ? ` Spotify pause confirmation failed: ${pauseError}` : ''}`);
    }
    return true;
  }

  async restorePlaybackIntent() {
    if (!this.isOwner() || this.state.playback.intent !== 'playing') return false;
    const playback = this.state.playback;
    if (playback.provider === 'spotify') {
      if (!this.spotify.ready) throw new Error('Spotify receiver is not connected.');
      await this.playSpotify(playback.sourceUrl || this.state.config.spotifyUrl);
      return true;
    }
    if (playback.audioUrl) {
      await this.resumeMusic();
      return true;
    }
    if (playback.sourceUrl || this.state.config.musicUrl) {
      await this.playControlled(playback.sourceUrl || this.state.config.musicUrl, {
        label: playback.label,
        index: Number(playback.trackIndex || 0)
      });
      return true;
    }
    return false;
  }

  async stopMusic() {
    const requestId = this.nextAudioRequest('terminal');
    this.invalidateAudioRestores();
    const provider = await this.serializeAudio(async () => {
      this.assertTerminalRequest(requestId);
      const activeProvider = this.physicalProvider || this.state.playback.provider || this.state.config.musicProvider;
      const spotifyMayBeAudible = activeProvider === 'spotify' || this.spotify.ready || this.spotify.current?.paused === false;
      if (spotifyMayBeAudible) await this.spotify.pauseForAnnouncement();
      this.audio.stopMusic();
      this.physicalProvider = '';
      this.physicalRequestId = 0;
      this.physicalCommittedRequestId = 0;
      this.preemptedSpotifySnapshot = null;
      this.safetyRestoreSnapshot = null;
      this.assertTerminalRequest(requestId, 'A newer audio command replaced this stop after the source became quiet.');
      return activeProvider;
    });
    await this.updatePlayback({ provider, intent: 'stopped', label: 'Nothing playing' }, 'Music stopped');
    return true;
  }

  async nextMusic({ automatic = false, expectedUrl = '' } = {}) {
    if (!automatic) this.assertNoSafetyPending();
    const requestId = automatic ? this.audioRequestId : this.nextAudioRequest();
    const epoch = automatic ? this.audioEpoch : this.invalidateAudioRestores();
    const previousPlayback = structuredClone(this.state.playback || {});
    const physical = await this.serializeAudio(async () => {
      this.assertAudioRequest(requestId, epoch);
      const playback = this.state.playback || {};
      const provider = this.physicalProvider || playback.provider || this.state.config.musicProvider;
      if (automatic && (provider !== 'controlled' || playback.intent !== 'playing' || (expectedUrl && playback.audioUrl !== expectedUrl))) return null;
      if (provider === 'spotify') {
      this.audio.pauseMusic();
      let state;
      try {
        state = await this.spotify.next({ assertCurrent: () => this.assertAudioRequest(requestId, epoch) });
      } catch (error) {
        if (requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner()) {
          try {
            await this.spotify.pauseForAnnouncement();
          } catch (pauseError) {
            throw new Error(`Superseded Spotify skip could not be confirmed paused: ${pauseError.message}`);
          }
        }
        throw error;
      }
      if (requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner()) {
        try {
          await this.spotify.pauseForAnnouncement();
        } catch (pauseError) {
          throw new Error(`Superseded Spotify skip could not be confirmed paused: ${pauseError.message}`);
        }
        throw new Error('A newer audio command replaced this Spotify skip.');
      }
      const label = state?.name
        ? `${state.name}${state.artists ? ` - ${state.artists}` : ''}`
        : (this.spotify.current?.name || 'Spotify next track');
      this.physicalProvider = 'spotify';
      this.physicalRequestId = requestId;
        return { provider, patch: { provider: 'spotify', intent: 'playing', label, positionMs: Number(state?.position || 0), unavailableReason: '' }, title: 'Spotify skipped' };
      }
      const tracks = Array.isArray(playback.tracks) ? playback.tracks : [];
      if (!tracks.length) throw new Error('No controlled playlist is loaded.');
      if (this.spotify.ready || this.spotify.current?.paused === false) {
        await this.spotify.pauseForAnnouncement();
        this.assertAudioRequest(requestId, epoch, 'Controlled skip was superseded while Spotify was being silenced.');
      }
      this.applyConfiguredMusicTarget({ report: false });
      const nextIndex = (Number(playback.trackIndex || 0) + 1) % tracks.length;
      const track = tracks[nextIndex];
      await this.audio.playMusicUrl(track.audioUrl, { label: track.title, loop: tracks.length === 1 });
      if (requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner()) {
        this.audio.stopMusic();
        throw new Error('A newer audio command replaced this controlled-track skip.');
      }
      this.physicalProvider = 'controlled';
      this.physicalRequestId = requestId;
      return { provider, patch: { provider: 'controlled', intent: 'playing', label: `${track.title}${track.artist ? ` - ${track.artist}` : ''}`, audioUrl: track.audioUrl, trackIndex: nextIndex, positionMs: 0 }, title: 'Controlled track skipped' };
    });
    if (!physical) return false;
    try {
      await this.updatePlayback(physical.patch, physical.title, { requestId, epoch });
      this.physicalCommittedRequestId = requestId;
      this.rememberCommittedPlayback(requestId);
    } catch (error) {
      let pauseError = '';
      await this.serializeAudio(async () => {
        const rollback = !this.isOwner() || this.physicalRequestId === requestId || this.safetyPendingCount > 0 || this.audioRequestKind === 'safety' || this.audioRequestKind === 'terminal';
        if (!rollback) return;
        if (physical.provider === 'spotify') await this.spotify.pauseForAnnouncement().catch(caught => { pauseError = caught.message || String(caught); });
        else this.audio.pauseMusic();
        if (!pauseError) {
          this.physicalRequestId = 0;
          this.physicalCommittedRequestId = 0;
        }
      });
      if (error.code === 'AUDIO_RECEIPT_SUPERSEDED' && this.audioRequestKind === 'safety' && this.isOwner()) {
        await this.compensateSafetyReceipt(previousPlayback);
      } else if (error.code === 'AUDIO_RECEIPT_SUPERSEDED' && this.audioRequestKind === 'normal' && this.isOwner()) {
        await this.repairCurrentCommittedReceipt();
      }
      throw new Error(`The skipped track was paused because its cloud receipt could not be saved: ${error.message}${pauseError ? ` Spotify pause confirmation failed: ${pauseError}` : ''}`);
    }
    return true;
  }

  async reconcileControlledPlayback(event = {}) {
    if (!this.isOwner() || this.audioRequestKind === 'terminal' || this.safetyPendingCount > 0 || this.currentAnnouncement) return false;
    if (this.physicalProvider !== 'controlled' || this.state.playback.provider !== 'controlled' || this.state.playback.intent !== 'playing') return false;
    if (this.audio.musicPlaying?.()) return false;
    this.physicalProvider = '';
    this.physicalRequestId = 0;
    const reason = event.type === 'error'
      ? `Controlled audio stopped with a media error: ${event.error || 'unknown media error'}`
      : 'Controlled audio was paused by the browser or device controls.';
    await this.updatePlayback({ intent: 'paused', unavailableReason: reason }, 'Controlled playback paused');
    this.status(reason, false);
    return true;
  }

  async updatePlayback(patch, logTitle = '', receipt = null) {
    await this.store.mutate(draft => {
      if (receipt) this.assertReceiptCurrent(receipt.requestId, receipt.epoch);
      if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
        throw new Error('Receiver ownership changed before playback could be recorded.');
      }
      draft.playback = { ...(draft.playback || {}), ...patch, updatedAt: this.now() };
      if (logTitle) draft.activityLog = [makeLog('playback', logTitle, draft.playback.label || ''), ...(draft.activityLog || [])];
      return draft;
    }, logTitle || 'Playback updated', { requireDurable: true });
    if (receipt) this.assertReceiptCurrent(receipt.requestId, receipt.epoch, 'Playback was superseded while its cloud receipt was committing.');
  }

  announcementText(id) {
    const item = this.state.announcements.find(entry => entry.id === id);
    return safetyAnnouncementText(id, item?.text, this.state.config);
  }

  async prepareVoice(text, { cacheOnly = false } = {}) {
    const message = String(text || '').trim().slice(0, 900);
    if (!message || this.state.config.voiceMode !== 'ai') return null;
    const voice = this.state.config.aiVoice || 'marin';
    const cacheKey = `${voice}\0${message}`;
    if (this.voiceCache.has(cacheKey)) return this.voiceCache.get(cacheKey);
    if (cacheOnly) return null;
    const controller = new AbortController();
    this.voicePrepareController = controller;
    const timer = setTimeout(() => controller.abort('timeout'), 13_000);
    try {
      const response = await fetch('/api/tts?v=final', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: message,
          voice,
          instructions: 'Speak as a calm, authoritative resort public-address announcer. Use clear diction, firm safety emphasis, steady loudness, and no background sound. Do not shout or distort.'
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw responseError(data, response.status);
      }
      const blob = await response.blob();
      this.voiceCache.set(cacheKey, blob);
      if (this.voiceCache.size > 12) this.voiceCache.delete(this.voiceCache.keys().next().value);
      return blob;
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason !== 'timeout') {
        throw new Error('Announcement preparation was cancelled for a higher-priority safety action.');
      }
      const detail = controller.signal.aborted ? 'the natural voice request timed out' : (error.message || String(error));
      this.status(`AI voice unavailable; device voice will be used: ${detail}`, false);
      return null;
    } finally {
      clearTimeout(timer);
      if (this.voicePrepareController === controller) this.voicePrepareController = null;
    }
  }

  async prewarmSafetyVoices() {
    if (!this.active || !this.isOwner() || this.state.config.voiceMode !== 'ai' || this.currentAnnouncement || this.safetyPendingCount > 0) return false;
    const ids = ['lightning', 'lightning-clear', 'wind', 'tornado'];
    const items = ids.map(id => {
      const item = this.state.announcements.find(entry => entry.id === id);
      return { id, text: safetyAnnouncementText(id, item?.text, this.state.config) };
    }).filter(item => item.text);
    const signature = JSON.stringify({ voice: this.state.config.aiVoice, items });
    if (signature === this.safetyVoiceWarmSignature) return true;
    if (this.safetyVoiceWarmPromise) return await this.safetyVoiceWarmPromise;
    this.safetyVoiceWarmPromise = (async () => {
      for (const item of items) {
        if (!this.active || !this.isOwner() || this.currentAnnouncement || this.safetyPendingCount > 0) return false;
        await this.prepareVoice(item.text).catch(() => null);
      }
      this.safetyVoiceWarmSignature = signature;
      return true;
    })();
    try {
      return await this.safetyVoiceWarmPromise;
    } finally {
      this.safetyVoiceWarmPromise = null;
    }
  }

  async announce(text, options = {}) {
    const message = String(text || '').trim().slice(0, 900);
    if (!message) throw new Error('Announcement text is empty.');
    return await new Promise((resolve, reject) => {
      const cancellation = { cancelled: false };
      const jobOptions = { ...options, cancellation };
      const job = { message, options: jobOptions, cancellation, safety: !!options.safety, resolve, reject };
      if (job.safety) {
        this.safetyPendingCount += 1;
        if (this.audioRequestKind !== 'terminal') this.nextAudioRequest('safety');
        const safetyEpoch = this.invalidateAudioRestores({ preservePreempted: true, preserveSafetyRestore: true });
        if (this.safetyRestoreSnapshot) this.safetyRestoreSnapshot.epoch = safetyEpoch;
        cancellation.safetyEpoch = safetyEpoch;
        const firstNormal = this.announcementQueue.findIndex(item => !item.safety);
        if (firstNormal < 0) this.announcementQueue.push(job);
        else this.announcementQueue.splice(firstNormal, 0, job);
        if (this.currentAnnouncement && !this.currentAnnouncement.safety) {
          this.currentAnnouncement.cancellation.cancelled = true;
          this.currentAnnouncement.cancellation.preemptedBySafety = true;
          this.currentAnnouncement.cancellation.safetyEpoch = safetyEpoch;
          this.voicePrepareController?.abort('preempt');
          this.audio.stopVoice('Announcement was preempted by an urgent weather safety message.');
        } else if (!this.currentAnnouncement) {
          this.voicePrepareController?.abort('preempt');
          this.audio.stopVoice('Sound check was preempted by an urgent weather safety message.');
        }
      } else {
        this.announcementQueue.push(job);
      }
      this.drainAnnouncements().catch(error => this.status(`Announcement queue failed: ${error.message}`, false));
    });
  }

  async drainAnnouncements() {
    if (this.announcementRunning) return;
    this.announcementRunning = true;
    try {
      while (this.announcementQueue.length) {
        const job = this.announcementQueue.shift();
        this.currentAnnouncement = job;
        try { job.resolve(await this.performAnnouncement(job.message, job.options)); }
        catch (error) { job.reject(error); }
        finally {
          if (job.safety) this.safetyPendingCount = Math.max(0, this.safetyPendingCount - 1);
          this.currentAnnouncement = null;
        }
      }
    } finally {
      this.announcementRunning = false;
    }
  }

  cancelPendingAnnouncements(reason = 'Announcement cancelled.') {
    this.voicePrepareController?.abort('cancel');
    this.preemptedSpotifySnapshot = null;
    this.safetyRestoreSnapshot = null;
    const error = new Error(reason);
    for (const job of this.announcementQueue.splice(0)) {
      job.cancellation.cancelled = true;
      if (job.safety) this.safetyPendingCount = Math.max(0, this.safetyPendingCount - 1);
      job.reject(error);
    }
    if (this.currentAnnouncement) {
      this.currentAnnouncement.cancellation.cancelled = true;
      this.currentAnnouncement.cancellation.preemptedBySafety = false;
    }
  }

  assertAnnouncementActive(options, message = 'Announcement was cancelled before completion.') {
    if (options?.cancellation?.cancelled) throw new Error(message);
    if (!this.isOwner()) throw new Error('Receiver ownership changed before the announcement completed.');
  }

  async performAnnouncement(message, options = {}) {
    this.assertAnnouncementActive(options, 'Announcement was cancelled before voice preparation.');
    const voiceBlob = await this.prepareVoice(message, { cacheOnly: !!options.safety });
    this.assertAnnouncementActive(options, 'Announcement was preempted while its voice was preparing.');
    const completed = await this.serializeAudio(async () => {
    this.assertAnnouncementActive(options, 'Announcement was cancelled while waiting for the audio mixer.');
    const announcementEpoch = options.safety && Number.isFinite(Number(options?.cancellation?.safetyEpoch))
      ? Number(options.cancellation.safetyEpoch)
      : this.audioEpoch;
    const provider = this.physicalProvider || this.state.playback.provider || this.state.config.musicProvider;
    const controlledWasPlaying = provider === 'controlled' && !!this.audio.musicPlaying?.();
    const bedCommitted = this.physicalRequestId === 0
      ? this.state.playback.intent === 'playing' && this.state.playback.provider === provider
      : this.physicalCommittedRequestId === this.physicalRequestId;
    let spotifySnapshot = null;
    let controlledDucked = false;
    const spotifyPauseHeld = provider === 'spotify' || !!this.spotify.ready;
    if (spotifyPauseHeld) this.beginTemporarySpotifyPause();
    try {
      if (provider === 'spotify') {
        try {
          spotifySnapshot = await this.spotify.pauseForAnnouncement();
        } catch (error) {
          await this.spotify.pause().catch(() => {});
          throw new Error(`Announcement was not played because Spotify could not be confirmed paused: ${error.message || String(error)}`);
        }
        this.assertAnnouncementActive(options, 'Announcement was preempted while Spotify was pausing.');
      } else {
        if (this.spotify.ready) {
          try {
            const unexpected = await this.spotify.pauseForAnnouncement();
            if (unexpected.wasPlaying) this.status('Unexpected local Spotify playback was paused before the announcement and will not be resumed.', false);
          } catch (error) {
            await this.spotify.pause().catch(() => {});
            throw new Error(`Announcement was not played because local Spotify silence could not be confirmed: ${error.message || String(error)}`);
          }
          this.assertAnnouncementActive(options, 'Announcement was preempted while checking the local Spotify receiver.');
        }
        await this.audio.beginAnnouncement();
        controlledDucked = true;
        this.assertAnnouncementActive(options, 'Announcement was preempted while music was ducking.');
      }
      this.assertAnnouncementActive(options, 'Announcement was cancelled before speech began.');
      if (voiceBlob) await this.audio.playVoiceBlob(voiceBlob);
      else await this.audio.playDeviceSpeech(message);
      this.assertAnnouncementActive(options, 'Announcement was cancelled before speech completed.');
      return true;
    } finally {
      const chainedSafety = !!options.safety && announcementEpoch !== this.audioEpoch && this.safetyPendingCount > 1;
      const carriedSafetyRestore = options.safety && this.safetyRestoreSnapshot?.epoch === announcementEpoch
        ? this.safetyRestoreSnapshot
        : null;
      if (provider === 'spotify') {
        const safetyPreemptionCurrent = options?.cancellation?.preemptedBySafety &&
          (announcementEpoch === this.audioEpoch || options.cancellation.safetyEpoch === this.audioEpoch);
        if (safetyPreemptionCurrent && this.active && this.isOwner() && spotifySnapshot?.wasPlaying) {
          this.preemptedSpotifySnapshot = spotifySnapshot;
        } else {
          if (chainedSafety && spotifySnapshot?.wasPlaying) this.preemptedSpotifySnapshot = spotifySnapshot;
          const currentSnapshot = (!options.safety || bedCommitted) && spotifySnapshot?.wasPlaying ? spotifySnapshot : null;
          const resumeSnapshot = currentSnapshot
            ? currentSnapshot
            : (options.safety
                ? (carriedSafetyRestore?.provider === 'spotify'
                    ? carriedSafetyRestore.spotifySnapshot
                    : this.preemptedSpotifySnapshot)
                : null);
          if (options.safety && !chainedSafety) this.preemptedSpotifySnapshot = null;
          const mayResume = announcementEpoch === this.audioEpoch && !options?.cancellation?.cancelled && this.active && this.isOwner();
          if (mayResume && resumeSnapshot?.wasPlaying) {
            await this.spotify.resumeAfterAnnouncement(resumeSnapshot, {
              assertCurrent: () => {
                if (announcementEpoch !== this.audioEpoch || !this.active || !this.isOwner()) {
                  throw new Error('Announcement restore was superseded.');
                }
              }
            }).then(() => { this.physicalProvider = 'spotify'; }).catch(error => this.status(`Announcement finished; Spotify resume failed: ${error.message}`, false));
          }
        }
      } else if (controlledDucked) {
        const restoreAllowed = announcementEpoch === this.audioEpoch && !options?.cancellation?.cancelled && this.active && this.isOwner();
        const restoreCurrentBed = restoreAllowed && (!options.safety || bedCommitted);
        await this.audio.endAnnouncement({ restore: restoreCurrentBed && controlledWasPlaying });
        if (restoreAllowed && carriedSafetyRestore?.provider === 'controlled' && carriedSafetyRestore.controlledSnapshot?.wasPlaying) {
          const snapshot = carriedSafetyRestore.controlledSnapshot;
          await this.audio.playMusicUrl(snapshot.audioUrl, {
            label: snapshot.label,
            startAt: snapshot.position
          }).then(() => { this.physicalProvider = 'controlled'; }).catch(error => this.status(`Safety announcement finished; controlled music restore failed: ${error.message}`, false));
        }
      }
      if (options.safety && !chainedSafety && this.safetyRestoreSnapshot?.epoch === announcementEpoch) this.safetyRestoreSnapshot = null;
      if (spotifyPauseHeld) this.endTemporarySpotifyPause();
    }
    });
    this.store.mutate(draft => {
        if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
          throw new Error('Receiver ownership changed before the announcement receipt could be saved.');
        }
        draft.activityLog = [makeLog(options.safety ? 'safety' : 'announcement', options.label || (options.safety ? 'Safety announcement played' : 'Announcement played'), message, this.now(), { eventId: options.eventId || '' }), ...(draft.activityLog || [])];
        return draft;
      }, 'Announcement completed', { requireDurable: true })
      .then(() => this.status('Announcement completed at the 100% voice setting.', true))
      .catch(error => this.status(`Announcement completed, but its cloud receipt could not be saved: ${error.message}`, false));
    return completed;
  }

  async checkWeather(options = {}) {
    const job = this.weatherTail.then(() => this.performWeatherCheck(options));
    this.weatherTail = job.catch(() => {});
    return await job;
  }

  async replayPendingWeatherWarning() {
    const weather = this.state.weather || {};
    const pendingIds = (Array.isArray(weather.pendingAnnouncementIds) ? weather.pendingAnnouncementIds : [])
      .filter(id => ['lightning', 'wind', 'tornado'].includes(id));
    if (!pendingIds.length) return false;
    if (!pendingWeatherWarningFresh(weather, this.now())) return false;
    const pendingAt = Number(weather.pendingAnnouncementAt || 0);
    const config = weather.pendingAnnouncementConfig || this.state.config;
    const items = pendingIds.map(id => {
      const item = this.state.announcements.find(entry => entry.id === id);
      const text = safetyAnnouncementText(id, item?.text, config);
      if (!text) throw new Error(`Pending weather safety message ${id} is empty or missing.`);
      return { label: item?.label || id, text };
    });
    await this.announce(items.map(item => item.text.trim()).join(' '), {
      safety: true,
      label: `${items.map(item => item.label).join(' + ')} (durable retry)`
    });
    await this.store.mutate(draft => {
      if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
        throw new Error('Receiver ownership changed before the retried weather warning could be confirmed.');
      }
      if (Number(draft.weather?.pendingAnnouncementAt || 0) !== pendingAt) return draft;
      const commit = draft.weather?.pendingAnnouncementCommit;
      draft.weather = {
        ...(draft.weather || {}),
        ...(commit && typeof commit === 'object' ? commit : {}),
        pendingAnnouncementIds: [],
        pendingAnnouncementAt: 0,
        pendingAnnouncementConfig: null,
        pendingAnnouncementCommit: null
      };
      draft.activityLog = [makeLog('safety', 'Pending weather warning replayed', pendingIds.join(', '), this.now()), ...(draft.activityLog || [])];
      return draft;
    }, 'Pending weather warning confirmed', { requireDurable: true });
    return true;
  }

  async performWeatherCheck({ announce = true, reason = 'manual check' } = {}) {
    if (!this.isOwner()) throw new Error('Weather scans run on the active speaker receiver.');
    if (announce) await this.replayPendingWeatherWarning();
    for (let configAttempt = 0; configAttempt < 3; configAttempt += 1) {
      const requestNow = this.now();
      const config = weatherConfigSnapshot(this.state.config);
      const lookback = lightningLookbackMinutes(this.state.weather, requestNow);
      let payload;
      try {
        payload = await fetchJson(weatherRequestUrl(config, { lightningLookbackMinutes: lookback }), {}, 14_000);
      } catch (error) {
        const status = `Weather status is unknown because the scan failed: ${error.message}`;
        await this.store.mutate(draft => {
          if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
            throw new Error('Receiver ownership changed before the weather failure could be saved.');
          }
          draft.weather = {
            ...(draft.weather || {}),
            status,
            checkedAt: requestNow,
            providerErrors: [String(error.message || error).slice(0, 300)]
          };
          draft.activityLog = [makeLog('warning', 'Weather check: unknown', `${reason}: ${status}`, requestNow), ...(draft.activityLog || [])];
          return draft;
        }, 'Weather failure recorded', { requireDurable: true });
        this.status(status, false, { weather: this.state.weather });
        return { payload: null, weather: this.state.weather, announcements: [] };
      }
      if (!this.isOwner()) throw new Error('Receiver ownership changed while weather data was loading.');

      const hasErrors = Array.isArray(payload.providerErrors) && payload.providerErrors.length > 0;
      const coverageIncomplete = payload.lightningCoverageKnown !== true || payload.tornadoCoverageKnown === false || payload.windCoverageKnown === false;
      const fallbackEvaluated = evaluateWeather(this.state.weather, payload, config, this.now());
      let previousWeather = {};
      let evaluated = null;
      try {
        await this.store.mutate(draft => {
          if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
            throw new Error('Receiver ownership changed before weather results could be saved.');
          }
          if (!sameWeatherConfig(draft.config, config)) {
            const changed = new Error('Weather settings changed while the scan was running. Retrying with the current location and thresholds.');
            changed.code = 'WEATHER_CONFIG_CHANGED';
            throw changed;
          }
          previousWeather = { ...(draft.weather || {}) };
          evaluated = evaluateWeather(previousWeather, payload, config, this.now());
          if (hasErrors && coverageIncomplete && !payload.threat) {
            evaluated.weather.status = `Weather status is unknown because part of the scan failed: ${payload.providerErrors.slice(0, 2).join(' | ')}`;
          }
          const existingPendingIds = (Array.isArray(previousWeather.pendingAnnouncementIds) ? previousWeather.pendingAnnouncementIds : [])
            .filter(id => ['lightning', 'wind', 'tornado'].includes(id));
          const preserveUnconfirmedPending = existingPendingIds.length > 0 &&
            (!announce || !pendingWeatherCoverageKnown(existingPendingIds, payload));
          draft.weather = evaluated.announcements.length
            ? stageWeatherBeforeSpeech(previousWeather, evaluated.weather, evaluated.announcements, this.now(), config)
            : preserveUnconfirmedPending
              ? {
                  ...evaluated.weather,
                  pendingAnnouncementIds: previousWeather.pendingAnnouncementIds,
                  pendingAnnouncementAt: previousWeather.pendingAnnouncementAt,
                  pendingAnnouncementConfig: previousWeather.pendingAnnouncementConfig,
                  pendingAnnouncementCommit: previousWeather.pendingAnnouncementCommit
                }
              : { ...evaluated.weather, pendingAnnouncementIds: [], pendingAnnouncementAt: 0, pendingAnnouncementConfig: null, pendingAnnouncementCommit: null };
          draft.activityLog = [makeLog(hasErrors ? 'warning' : 'weather', `Weather check: ${payload.threatType || (coverageIncomplete ? 'unknown' : 'clear')}`, `${reason}: ${evaluated.weather.status}`), ...(draft.activityLog || [])];
          return draft;
        }, 'Weather check completed', { requireDurable: true });
      } catch (error) {
        if (error.code === 'WEATHER_CONFIG_CHANGED' && configAttempt < 2) continue;
        const urgentIds = announce ? fallbackEvaluated.announcements.filter(id => ['lightning', 'wind', 'tornado'].includes(id)) : [];
        if (urgentIds.length && this.isOwner()) {
          try {
            const items = urgentIds.map(id => {
              const item = this.state.announcements.find(entry => entry.id === id);
              const text = safetyAnnouncementText(id, item?.text, { ...config, lightningRadiusMiles: payload.lightningRadiusMiles ?? config.lightningRadiusMiles });
              if (!text) throw new Error(`Weather safety message ${id} is empty or missing.`);
              return { label: item?.label || id, text };
            });
            await this.announce(items.map(item => item.text.trim()).join(' '), { safety: true, label: items.map(item => item.label).join(' + ') });
          } catch (speechError) {
            throw new Error(`Weather state could not be saved (${error.message}), and the urgent safety announcement also failed: ${speechError.message}`);
          }
          this.status(`Urgent weather warning played, but its cloud receipt failed and will retry: ${error.message}`, false, { weather: fallbackEvaluated.weather });
          return { payload, ...fallbackEvaluated, receiptError: error.message };
        }
        throw error;
      }

      const announcementIds = announce ? evaluated.announcements : [];
      if (announcementIds.length) {
        try {
          if (!this.isOwner()) throw new Error('Receiver ownership changed before the weather announcement.');
          const items = announcementIds.map(id => {
            const item = this.state.announcements.find(entry => entry.id === id);
            const text = safetyAnnouncementText(id, item?.text, { ...config, lightningRadiusMiles: payload.lightningRadiusMiles ?? config.lightningRadiusMiles });
            if (!text) throw new Error(`Weather safety message ${id} is empty or missing.`);
            return { label: item?.label || id, text };
          });
          await this.announce(items.map(item => item.text.trim()).join(' '), { safety: true, label: items.map(item => item.label).join(' + ') });
          await this.store.mutate(draft => {
            if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
              throw new Error('Receiver ownership changed before the weather announcement could be marked complete.');
            }
            draft.weather = { ...draft.weather, ...evaluated.weather, pendingAnnouncementIds: [], pendingAnnouncementAt: 0, pendingAnnouncementConfig: null, pendingAnnouncementCommit: null };
            draft.activityLog = [makeLog('safety', 'Weather safety announcement confirmed', announcementIds.join(', '), this.now()), ...(draft.activityLog || [])];
            return draft;
          }, 'Weather announcement confirmed', { requireDurable: true });
        } catch (error) {
          await this.store.mutate(draft => {
            if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) return draft;
            draft.activityLog = [makeLog('error', 'Weather safety announcement failed; retry remains eligible', `${announcementIds.join(', ')}: ${error.message}`, this.now()), ...(draft.activityLog || [])];
            return draft;
          }, 'Weather announcement retry recorded', { requireDurable: true });
          throw error;
        }
      }
      this.status(evaluated.weather.status, !coverageIncomplete || !!payload.threat, { weather: evaluated.weather });
      return { payload, ...evaluated };
    }
    throw new Error('Weather settings kept changing while the scan was running. Try again after saving Settings.');
  }

  async tickSchedule() {
    if (!this.isOwner() || this.scheduleProcessing) return;
    this.scheduleProcessing = true;
    try {
      const now = this.now();
      const due = dueScheduleItems(this.state.schedule, this.state.scheduleRuns, now);
      for (const dueItem of due) {
      const dateParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date(now));
      const dateValues = Object.fromEntries(dateParts.map(part => [part.type, part.value]));
      const dateKey = `${dateValues.year}-${dateValues.month}-${dateValues.day}`;
      const localKey = `${dueItem.id}:${dateKey}`;
      if (this.scheduleCompletedLocal.has(localKey)) continue;
      let item = null;
      await this.store.mutate(draft => {
        const latest = dueScheduleItems(draft.schedule, draft.scheduleRuns, now)
          .find(candidate => candidate.id === dueItem.id);
        if (!latest) return draft;
        const existing = draft.scheduleRuns?.[latest.id];
        const activeClaim = existing && typeof existing === 'object' &&
          existing.dateKey === dateKey && existing.status === 'in-progress' &&
          this.now() - Number(existing.claimedAt || 0) < RECEIVER_LEASE_MS;
        if (existing === dateKey || (existing?.dateKey === dateKey && existing?.status === 'completed') || activeClaim) return draft;
        item = structuredClone(latest);
        draft.scheduleRuns = {
          ...(draft.scheduleRuns || {}),
          [latest.id]: {
            dateKey,
            status: 'in-progress',
            claimedAt: this.now(),
            receiverId: this.deviceId,
            sessionId: this.sessionId
          }
        };
        return draft;
      }, 'Schedule run claimed', { requireDurable: true });
      if (!item) continue;
      const claim = this.state.scheduleRuns?.[item.id];
      if (!claim || claim.dateKey !== dateKey || claim.status !== 'in-progress' || claim.sessionId !== this.sessionId) continue;
      let playbackCompleted = false;
      try {
        if (item.type === 'announcement') {
          const text = this.announcementText(item.announcementId);
          if (!text) throw new Error(`Saved announcement ${item.announcementId || '(none)'} was not found.`);
          await this.announce(text, { label: item.label });
        } else if (item.type === 'spotify') {
          await this.playSpotify(item.url || this.state.config.spotifyUrl);
        } else {
          await this.playControlled(item.url || this.state.config.musicUrl, { label: item.label });
        }
        playbackCompleted = true;
        this.scheduleCompletedLocal.add(localKey);
        await this.store.mutate(draft => {
          draft.scheduleRuns = {
            ...(draft.scheduleRuns || {}),
            [item.id]: {
              dateKey,
              status: 'completed',
              completedAt: this.now(),
              receiverId: this.deviceId,
              sessionId: this.sessionId
            }
          };
          draft.activityLog = [makeLog('schedule', 'Scheduled item completed', `${item.time} - ${item.label}`, this.now(), { scheduleId: item.id }), ...(draft.activityLog || [])];
          return draft;
        }, 'Schedule run recorded', { requireDurable: true });
      } catch (error) {
        if (playbackCompleted) {
          this.status(`Scheduled item played, but its cloud receipt could not be saved: ${item.label}: ${error.message}. This receiver will not replay it today.`, false);
          continue;
        }
        await this.store.mutate(draft => {
          const run = draft.scheduleRuns?.[item.id];
          if (run?.dateKey === dateKey && run?.status === 'in-progress' && run?.sessionId === this.sessionId) {
            const scheduleRuns = { ...(draft.scheduleRuns || {}) };
            delete scheduleRuns[item.id];
            draft.scheduleRuns = scheduleRuns;
          }
          draft.activityLog = [makeLog('error', 'Scheduled item failed; retry remains eligible', `${item.label}: ${error.message}`, this.now(), { scheduleId: item.id }), ...(draft.activityLog || [])];
          return draft;
        }, 'Schedule failure recorded', { requireDurable: true });
        this.status(`Scheduled item failed: ${item.label}: ${error.message}`, false);
      }
      }
    } finally {
      this.scheduleProcessing = false;
    }
  }

  async runCalibration() {
    if (!this.isOwner()) throw new Error('Run calibration on the active speaker receiver.');
    this.assertNoSafetyPending();
    const requestId = this.nextAudioRequest();
    const epoch = this.invalidateAudioRestores();
    const completed = await this.serializeAudio(async () => {
    this.assertAudioRequest(requestId, epoch);
    this.applyConfiguredMusicTarget({ report: false });
    const provider = this.physicalProvider || this.state.playback.provider || this.state.config.musicProvider;
    const wasPlaying = this.state.playback.intent === 'playing';
    const controlledSnapshot = provider === 'controlled'
      ? {
          wasPlaying,
          audioUrl: String(this.state.playback.audioUrl || ''),
          label: String(this.state.playback.label || 'Suno / direct audio'),
          position: wasPlaying
            ? Number(this.audio.musicElement?.currentTime || 0)
            : Number(this.state.playback.positionMs || 0) / 1000
        }
      : null;
    let spotifySnapshot = null;
    const spotifyPauseHeld = provider === 'spotify' || this.spotify.ready || this.spotify.current?.paused === false;
    if (spotifyPauseHeld) {
      this.beginTemporarySpotifyPause();
      try {
        spotifySnapshot = await this.spotify.pauseForAnnouncement();
      } catch (error) {
        this.endTemporarySpotifyPause();
        throw error;
      }
    }
    this.physicalProvider = '';
    try {
      await this.audio.runCalibration({
        speak: async text => {
          this.assertAudioRequest(requestId, epoch, 'Sound check was replaced by a higher-priority audio action.');
          const blob = await this.prepareVoice(text);
          this.assertAudioRequest(requestId, epoch, 'Sound check was replaced by a higher-priority audio action.');
          if (blob) await this.audio.playVoiceBlob(blob);
          else await this.audio.playDeviceSpeech(text);
        }
      });
    } finally {
      const superseded = !this.isOwner() || requestId !== this.audioRequestId || epoch !== this.audioEpoch;
      if (superseded) {
        this.audio.stopMusic();
        const carried = spotifySnapshot?.wasPlaying
          ? this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot })
          : controlledSnapshot?.wasPlaying
            ? this.carrySafetyRestore({ provider: 'controlled', controlledSnapshot })
            : false;
        if (!carried) await this.spotify.pauseForAnnouncement().catch(() => {});
      } else if (provider === 'spotify' && spotifySnapshot?.wasPlaying) {
        await this.spotify.resumeAfterAnnouncement(spotifySnapshot, {
          assertCurrent: () => this.assertAudioRequest(requestId, epoch)
        }).then(() => { this.physicalProvider = 'spotify'; }).catch(error => this.status(`Sound check finished; Spotify resume failed: ${error.message}`, false));
      } else if (controlledSnapshot?.wasPlaying && controlledSnapshot.audioUrl) {
        await this.audio.playMusicUrl(controlledSnapshot.audioUrl, {
          label: controlledSnapshot.label,
          startAt: controlledSnapshot.position
        }).then(() => { this.physicalProvider = 'controlled'; }).catch(error => this.status(`Sound check finished; music restore failed: ${error.message}`, false));
      } else if (controlledSnapshot) {
        this.audio.stopMusic();
        this.physicalProvider = 'controlled';
      }
      if (spotifyPauseHeld) this.endTemporarySpotifyPause();
    }
    return true;
    });
    try {
      await this.store.mutate(draft => {
        if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
          throw new Error('Receiver ownership changed before the sound-check receipt could be saved.');
        }
        const target = clamp(draft.config.musicLevel, 0, 100, 30);
        draft.activityLog = [makeLog('diagnostic', `${target}/100 calibration completed`, `${target}% calibration bed, ${Math.min(6, target)}% duck, and 100% announcement path played on the receiver.`), ...(draft.activityLog || [])];
        return draft;
      }, 'Calibration completed', { requireDurable: true });
    } catch (error) {
      this.status(`Sound check completed, but its activity receipt could not be saved: ${error.message}`, false);
    }
    return completed;
  }
}
