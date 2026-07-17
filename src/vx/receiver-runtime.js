import {
  DUCK_LEVEL_PERCENT,
  RECEIVER_LEASE_MS,
  SAFETY_EVENT_TTL_MS,
  VOICE_LEVEL_PERCENT,
  WEATHER_INTERVAL_MS,
  audioPolicy,
  clamp,
  completeEvent,
  createTargetedEvent,
  dueTimeScheduleItems,
  effectiveScheduleItemVolume,
  evaluateWeather,
  getActiveSchedule,
  isDirectAudioUrl,
  makeId,
  makeLog,
  makeReceiverLease,
  nextOrderScheduleItem,
  normalizeSequenceRun,
  pendingEventsForReceiver,
  receiverOnline,
  resolveScheduleAnnouncementText,
  renewReceiverLease,
  safetyAnnouncementText,
  weatherRequestUrl
} from './core.js';
import { isIOSLike } from './audio-engine.js';

const DEVICE_KEY = 'poolside-pulse-vx-device-id';
const HANDLED_KEY = 'poolside-pulse-vx-handled-events';
const SESSION_KEY = 'poolside-pulse-vx-receiver-session';
const HEARTBEAT_MS = 10_000;
const EVENT_POLL_MS = 1_250;
const SCHEDULE_TICK_MS = 15_000;
const EXTERNAL_AUDIO_INTENT_TYPES = new Map([
  ['play-controlled', 'play'],
  ['play-apple', 'play'],
  ['play-spotify', 'play'],
  ['pause-music', 'terminal'],
  ['resume-music', 'play'],
  ['stop-music', 'terminal'],
  ['next-music', 'play'],
  ['calibration', 'play'],
  ['order-next', 'schedule'],
  ['order-reset', 'terminal']
]);

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

function appleErrorWithContext(error, message) {
  const contextual = new Error(String(message || error?.message || error || 'Apple Music playback failed.'));
  for (const key of ['code', 'status', 'appleOperation', 'appleReason', 'retryAfter']) {
    if (error?.[key] !== undefined && error?.[key] !== null && error?.[key] !== '') contextual[key] = error[key];
  }
  return contextual;
}

function spotifyErrorWithContext(error, message) {
  const contextual = new Error(String(message || error?.message || error || 'Spotify playback failed.'));
  for (const key of ['code', 'status', 'spotifyOperation', 'spotifyReason', 'retryAfter']) {
    if (error?.[key] !== undefined && error?.[key] !== null && error?.[key] !== '') contextual[key] = error[key];
  }
  return contextual;
}

function inactiveSpotifyReceiver() {
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
      detail: 'Spotify is not configured on this Version X receiver.'
    }),
    setTargetVolumePercent() {},
    resetVolumeVerification() {},
    async pauseForAnnouncement() { return { wasPlaying: false }; },
    async pause() { return false; },
    async resume() { return false; },
    async resumeAfterAnnouncement() { return false; },
    disconnect() {}
  };
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

function scheduleItemFingerprint(item) {
  const source = JSON.stringify({
    id: String(item?.id || ''),
    label: String(item?.label || ''),
    enabled: item?.enabled !== false,
    days: Array.isArray(item?.days) ? item.days.map(Number) : [],
    position: item?.position || null,
    action: item?.action || null,
    volume: item?.volume || null,
    advance: item?.advance || null,
    type: String(item?.type || ''),
    time: String(item?.time || ''),
    url: String(item?.url || ''),
    announcementId: String(item?.announcementId || '')
  });
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
  }
  return `v1-${left.toString(16).padStart(8, '0')}-${right.toString(16).padStart(8, '0')}`;
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
  constructor({ store, audio, apple, spotify = null, onStatus = () => {}, onChange = () => {} }) {
    this.store = store;
    this.audio = audio;
    this.apple = apple;
    this.spotify = spotify || inactiveSpotifyReceiver();
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
    this.orderTail = Promise.resolve();
    this.orderWakeTimers = new Map();
    this.deferredAutomaticNext = null;
    this.deferredControlledTrackEnd = null;
    this.audioEpoch = 0;
    this.audioRequestId = 0;
    this.audioRequestKind = 'none';
    this.externalAudioIntentGeneration = 0;
    this.externalAudioIntentKind = 'none';
    this.orderIntentGenerations = new Map();
    this.orderCancellationQueued = false;
    this.physicalRequestId = 0;
    this.physicalCommittedRequestId = 0;
    this.committedPlaybackSnapshot = null;
    this.committedSourceConfig = null;
    this.physicalMusicTarget = null;
    this.safetyPendingCount = 0;
    this.physicalProvider = '';
    this.temporaryAppleMusicPauseDepth = 0;
    this.applePauseGeneration = 0;
    this.temporarySpotifyPauseDepth = 0;
    this.spotifyPauseGeneration = 0;
    this.announcementQueue = [];
    this.announcementRunning = false;
    this.currentAnnouncement = null;
    this.preemptedAppleMusicSnapshot = null;
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
    this.scheduleCancellationInFlight = null;
    this.pendingScheduleCancellationInFlight = null;
    this.pendingScheduledPlayback = null;
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
    if (this.audio.status?.()?.calibrationActive) {
      this.audio.stopCalibration?.('Sound check stopped because a newer audio action arrived.', { ok: true, report: false });
    }
    this.audioRequestId += 1;
    this.audioRequestKind = kind;
    return this.audioRequestId;
  }

  beginExternalAudioIntent(kind = 'normal') {
    this.externalAudioIntentGeneration += 1;
    this.externalAudioIntentKind = String(kind || 'normal');
    this.queueSupersededOrderCancellation();
    return this.externalAudioIntentGeneration;
  }

  queueSupersededOrderCancellation() {
    if (this.orderCancellationQueued) return;
    this.orderCancellationQueued = true;
    queueMicrotask(() => {
      this.orderCancellationQueued = false;
      if (!this.active || !this.isOwner()) return;
      const schedule = getActiveSchedule(this.state);
      const run = schedule?.mode === 'order' ? normalizeSequenceRun(this.state.sequenceRuns?.[schedule.id]) : null;
      const token = String(run?.active?.token || '');
      if (!token && run?.status === 'auto-pending' && this.externalAudioIntentKind !== 'safety') {
        this.serializeOrder(() => this.cancelAutoPendingOrder(schedule.id, 'A newer audio command cancelled the pending Order continuation.'))
          .catch(error => this.status(`Pending Order cancellation failed: ${error.message}`, false));
        return;
      }
      if (!token || this.orderIntentGenerations.get(token) === this.externalAudioIntentGeneration) return;
      this.serializeOrder(async () => {
        const latestSchedule = getActiveSchedule(this.state);
        const latest = latestSchedule?.id === schedule.id ? normalizeSequenceRun(this.state.sequenceRuns?.[schedule.id]) : null;
        if (!latest?.active?.token || latest.active.token !== token || this.orderIntentGenerations.get(token) === this.externalAudioIntentGeneration) return false;
        return await this.failOrderStep(schedule.id, token, new Error('A newer audio command cancelled the pending Order advance.'));
      }).catch(error => this.status(`Pending Order cancellation failed: ${error.message}`, false));
    });
  }

  assertExternalAudioIntent(generation, message = 'A newer audio command replaced this scheduled action before it could start.') {
    if (generation === null || generation === undefined) return true;
    if (Number(generation) !== this.externalAudioIntentGeneration) {
      const error = new Error(message);
      error.code = 'AUDIO_INTENT_SUPERSEDED';
      throw error;
    }
    if (!this.isOwner()) throw new Error('Receiver ownership changed before the scheduled audio action could start.');
    return true;
  }

  assertScheduledRunAuthorization(state, scheduledRunToken, scheduledItemId) {
    const token = String(scheduledRunToken || '');
    if (!token) return true;
    if (String(state.playback?.cancelScheduledRunToken || '') === token) {
      const error = new Error('The scheduled playback token was explicitly cancelled.');
      error.code = 'SCHEDULE_RUN_CANCELLED';
      throw error;
    }
    const schedule = getActiveSchedule(state);
    const itemId = String(scheduledItemId || '');
    if (schedule?.enabled !== false && schedule?.mode === 'time') {
      const claim = state.scheduleRuns?.[itemId];
      const item = (schedule.items || []).find(candidate => String(candidate.id || '') === itemId);
      const successfulStatus = claim?.status === 'in-progress' ||
        (claim?.status === 'completed' && !String(claim?.outcome || '').startsWith('cancelled-'));
      if (item?.enabled !== false && claim?.scheduleId === schedule.id && claim?.token === token &&
          claim?.sessionId === this.sessionId && successfulStatus &&
          claim?.fingerprint === scheduleItemFingerprint(item)) return true;
    }
    const run = schedule?.mode === 'order' ? normalizeSequenceRun(state.sequenceRuns?.[schedule.id]) : null;
    const orderItem = schedule?.mode === 'order'
      ? (schedule.items || []).find(candidate => String(candidate.id || '') === itemId)
      : null;
    const orderFingerprint = orderItem?.enabled !== false ? scheduleItemFingerprint(orderItem) : '';
    if (schedule?.enabled !== false && orderFingerprint && run?.active?.token === token &&
        run.active.itemId === itemId && run.active.sessionId === this.sessionId &&
        run.active.fingerprint === orderFingerprint) return true;
    const playback = state.playback || {};
    if (schedule?.enabled !== false && orderFingerprint && String(playback.scheduledRunToken || '') === token &&
        String(playback.scheduledItemId || '') === itemId && playback.scheduledFingerprint === orderFingerprint) return true;
    const error = new Error('The scheduled playback claim was cancelled before its cloud receipt could commit.');
    error.code = 'SCHEDULE_RUN_CANCELLED';
    throw error;
  }

  scheduledRunAuthorized(state, scheduledRunToken, scheduledItemId) {
    try {
      this.assertScheduledRunAuthorization(state, scheduledRunToken, scheduledItemId);
      return true;
    } catch {
      return false;
    }
  }

  async confirmAppleMusicPaused(context = 'Apple Music silence is required.') {
    let primaryError = null;
    try {
      await this.apple.pauseForAnnouncement();
      return true;
    } catch (error) {
      primaryError = error;
    }
    let fallbackError = null;
    try {
      const paused = await this.apple.pause?.();
      if (paused === true) return true;
      fallbackError = new Error('Apple Music did not positively confirm the fallback pause.');
    } catch (error) {
      fallbackError = error;
    }
    const source = fallbackError || primaryError;
    const failure = appleErrorWithContext(
      source,
      `${context} Apple Music may still be audible because neither pause path confirmed silence. ${source?.message || ''}`.trim()
    );
    failure.code = failure.code || 'APPLE_MUSIC_PAUSE_UNCONFIRMED';
    failure.appleOperation = failure.appleOperation || 'PUT /me/player/pause + paused-state confirmation';
    failure.appleReason = failure.appleReason || 'Apple Music silence was not confirmed';
    failure.applePauseUnconfirmed = true;
    throw failure;
  }

  async confirmSpotifyPaused(context = 'Spotify silence is required.') {
    let primaryError = null;
    try {
      await this.spotify.pauseForAnnouncement();
      return true;
    } catch (error) {
      primaryError = error;
    }
    let fallbackError = null;
    try {
      const paused = await this.spotify.pause?.();
      if (paused === true) return true;
      fallbackError = new Error('Spotify did not positively confirm the fallback pause.');
    } catch (error) {
      fallbackError = error;
    }
    const source = fallbackError || primaryError;
    const failure = spotifyErrorWithContext(
      source,
      `${context} Spotify may still be audible because neither pause path confirmed silence. ${source?.message || ''}`.trim()
    );
    failure.code = failure.code || 'SPOTIFY_PAUSE_UNCONFIRMED';
    failure.spotifyOperation = failure.spotifyOperation || 'PUT /me/player/pause + paused-state confirmation';
    failure.spotifyReason = failure.spotifyReason || 'Spotify silence was not confirmed';
    failure.spotifyPauseUnconfirmed = true;
    throw failure;
  }

  currentPhysicalCustomTarget() {
    const target = this.physicalMusicTarget;
    if (!target || target.mode !== 'custom' || target.requestId !== this.audioRequestId) return null;
    return clamp(target.percent, 0, 100, this.state.config.musicLevel);
  }

  invalidateAudioRestores({ preservePreempted = false, preserveSafetyRestore = false } = {}) {
    this.audioEpoch += 1;
    if (!preservePreempted) {
      this.preemptedAppleMusicSnapshot = null;
      this.preemptedSpotifySnapshot = null;
    }
    if (!preserveSafetyRestore) this.safetyRestoreSnapshot = null;
    return this.audioEpoch;
  }

  carrySafetyRestore(snapshot) {
    if (!snapshot || this.safetyPendingCount < 1 || !this.active || !this.isOwner()) return false;
    this.safetyRestoreSnapshot = { ...snapshot, epoch: this.audioEpoch };
    if (snapshot.provider === 'apple' && snapshot.appleSnapshot?.wasPlaying) {
      this.preemptedAppleMusicSnapshot = snapshot.appleSnapshot;
    }
    if (snapshot.provider === 'spotify' && snapshot.spotifySnapshot?.wasPlaying) {
      this.preemptedSpotifySnapshot = snapshot.spotifySnapshot;
    }
    return true;
  }

  beginTemporaryAppleMusicPause() {
    this.temporaryAppleMusicPauseDepth += 1;
    this.applePauseGeneration += 1;
  }

  endTemporaryAppleMusicPause() {
    this.temporaryAppleMusicPauseDepth = Math.max(0, this.temporaryAppleMusicPauseDepth - 1);
    this.applePauseGeneration += 1;
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
      for (const key of ['musicProvider', 'musicUrl', 'musicLabel', 'appleUrl', 'spotifyUrl']) {
        if (Object.prototype.hasOwnProperty.call(previousSourceConfig, key)) draft.config[key] = previousSourceConfig[key];
      }
      draft.activityLog = [makeLog('safety', 'Superseded playback stayed quiet', 'A late playback receipt was corrected after an urgent safety announcement.'), ...(draft.activityLog || [])];
      return draft;
    }, 'Superseded playback corrected', { requireDurable: true });
  }

  rememberCommittedPlayback(requestId) {
    if (this.physicalRequestId !== requestId || this.physicalCommittedRequestId !== requestId) return;
    this.committedPlaybackSnapshot = structuredClone(this.state.playback || {});
    this.committedSourceConfig = Object.fromEntries(['musicProvider', 'musicUrl', 'musicLabel', 'appleUrl', 'spotifyUrl'].map(key => [key, this.state.config[key]]));
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

  serializeOrder(work) {
    const job = this.orderTail.then(work, work);
    this.orderTail = job.catch(() => {});
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

  currentPolicy(provider = this.state.config.musicProvider, requestedPercent = null) {
    const musicPercent = requestedPercent === null || requestedPercent === undefined
      ? this.currentMusicTarget()
      : clamp(requestedPercent, 0, 100, this.state.config.musicLevel);
    const external = provider === 'spotify' ? this.spotify : this.apple;
    return audioPolicy({
      provider,
      isIOS: isIOSLike(),
      supportsVolume: provider === 'controlled' ? false : !!external.supportsVolume,
      volumeVerified: provider === 'controlled' ? false : !!external.volumeVerified,
      verifiedPercent: provider === 'controlled' ? null : external.verifiedPercent,
      musicPercent,
      voicePercent: this.state.config.voiceLevel
    });
  }

  appleLeasePatch() {
    const readiness = this.apple.readiness?.() || {
      status: this.apple.ready ? 'ready' : 'login-required',
      ready: !!this.apple.ready,
      detail: this.apple.ready ? 'Apple Music receiver connected.' : 'Apple Music receiver is not connected.'
    };
    return {
      appleStatus: String(readiness.status || 'login-required').slice(0, 40),
      appleDetail: String(readiness.detail || '').slice(0, 300),
      appleVerifiedAt: readiness.ready ? Number(this.apple.accessVerifiedAt || this.now()) : Number(this.apple.accessVerifiedAt || 0),
      receiverKind: this.apple.nativeEnabled?.() ? 'macos-music-helper' : isIOSLike() ? 'iphone-browser' : 'desktop-browser',
      appleTransport: this.apple.nativeEnabled?.() ? 'music-app-automation' : 'musickit-js',
      appleVolumeCapability: this.apple.nativeEnabled?.() ? 'read-write-0-100' : this.apple.supportsVolume ? 'in-page-conditional' : 'physical-only'
    };
  }

  spotifyLeasePatch() {
    const readiness = this.spotify.readiness?.() || {
      status: this.spotify.ready ? 'ready' : 'login-required',
      ready: !!this.spotify.ready,
      detail: this.spotify.ready ? 'Spotify receiver connected.' : 'Spotify receiver is not connected.'
    };
    return {
      spotifyStatus: String(readiness.status || 'login-required').slice(0, 40),
      spotifyDetail: String(readiness.detail || '').slice(0, 300),
      spotifyVerifiedAt: readiness.ready ? Number(this.spotify.accessVerifiedAt || this.now()) : Number(this.spotify.accessVerifiedAt || 0)
    };
  }

  receiverLeasePatch() {
    return {
      ...this.appleLeasePatch(),
      ...this.spotifyLeasePatch()
    };
  }

  currentMusicTarget(playback = this.state.playback) {
    const physicalTarget = this.currentPhysicalCustomTarget();
    if (physicalTarget !== null) return physicalTarget;
    const playbackTarget = Number(playback?.musicLevelPercent);
    const hasPlaybackTarget = playback?.intent !== 'stopped' && playback?.volumeMode === 'custom' && Number.isFinite(playbackTarget);
    return clamp(hasPlaybackTarget ? playbackTarget : this.state.config.musicLevel, 0, 100, 30);
  }

  applyConfiguredMusicTarget({ report = false, percent = null } = {}) {
    const target = percent === null || percent === undefined
      ? this.currentMusicTarget()
      : clamp(percent, 0, 100, this.state.config.musicLevel);
    this.audio.setMusicLevelPercent?.(target, { report });
    this.apple.setTargetVolumePercent?.(target);
    this.spotify.setTargetVolumePercent?.(target);
    return target;
  }

  async setMusicLevel(percent) {
    const requested = clamp(percent, 0, 100, 30);
    const work = async () => {
      if (!this.isOwner()) throw new Error('This device is not the active speaker receiver.');
      const target = requested;
      const pendingPhysicalTarget = this.currentPhysicalCustomTarget();
      const customPlaybackTarget = pendingPhysicalTarget !== null
        ? pendingPhysicalTarget
        : this.state.playback?.intent === 'playing' &&
        this.state.playback?.volumeMode === 'custom' &&
        Number.isFinite(Number(this.state.playback?.musicLevelPercent))
          ? clamp(this.state.playback.musicLevelPercent, 0, 100, target)
          : null;
      const audibleTarget = customPlaybackTarget === null ? target : customPlaybackTarget;
      this.audio.setMusicLevelPercent?.(audibleTarget, { report: false });
      this.apple.setTargetVolumePercent?.(audibleTarget);
      this.spotify.setTargetVolumePercent?.(audibleTarget);
      let verification = null;
      const externalProvider = ['apple', 'spotify'].includes(this.physicalProvider)
        ? this.physicalProvider
        : ['apple', 'spotify'].includes(this.state.playback.provider) && this.state.playback.intent === 'playing'
          ? this.state.playback.provider
          : '';
      const external = externalProvider === 'spotify' ? this.spotify : this.apple;
      const externalActive = !!externalProvider;
      if (externalActive && external.ready) verification = await external.enforceVolume(audibleTarget);
      await this.store.mutate(draft => {
        if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
          throw new Error('Receiver ownership changed before the music level could be recorded.');
        }
        draft.config.musicLevel = target;
        if (draft.playback?.intent !== 'stopped' && draft.playback?.volumeMode !== 'custom') {
          draft.playback.musicLevelPercent = target;
        }
        if (['apple', 'spotify'].includes(draft.playback?.provider)) {
          draft.playback = {
            ...draft.playback,
            volumeVerified: verification?.verified === true,
            volumeVerifiedPercent: verification?.verified === true ? audibleTarget : null,
            volumeVerifiedAt: verification?.verified === true ? this.now() : 0,
            updatedAt: this.now()
          };
        }
        draft.activityLog = [makeLog('settings', 'Music level applied', `${target}% target; announcements ${draft.config.voiceLevel}%.`, this.now()), ...(draft.activityLog || [])];
        return draft;
      }, 'Music level applied', { requireDurable: true });
      const policy = this.currentPolicy(this.physicalProvider || this.state.playback.provider || this.state.config.musicProvider);
      await this.updateReceiverDetail(policy.detail, policy.id);
      this.status(
        customPlaybackTarget !== null
          ? `Global music target saved at ${target}%. The current scheduled item remains at its custom ${customPlaybackTarget}% level.`
          : externalActive && verification?.verified !== true
            ? `Music target is ${target}%. ${externalProvider === 'spotify' ? 'Spotify' : 'Apple Music'} could not verify that level on this receiver; announcements will still pause it.`
            : `Music level is ${target}%. Announcements are ${this.state.config.voiceLevel}%.`,
        !externalActive || verification?.verified === true,
        { policy, verification }
      );
      return target;
    };
    const job = this.volumeTail.then(work, work);
    this.volumeTail = job.catch(() => {});
    return await job;
  }

  async start({ takeover = false, takeoverTarget = null } = {}) {
    this.beginExternalAudioIntent('receiver-start');
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
    await this.apple.prepareForReceiverStart?.();
    this.applyConfiguredMusicTarget({ report: false });
    await this.audio.unlock({ audibleTest: false });
    const startupProvider = this.state.playback.intent === 'stopped'
      ? this.state.config.musicProvider
      : (this.state.playback.provider || this.state.config.musicProvider);
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
        name: this.apple.nativeEnabled?.() ? 'Poolside Pulse X Music Receiver (Mac)' : 'Poolside Speaker Receiver',
        platform: navigator.userAgent,
        audioMode: policy.id,
        ...this.receiverLeasePatch()
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
          await this.apple.pauseForAnnouncement().catch(() => {});
          await this.spotify.pauseForAnnouncement?.().catch(() => {});
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
      draft.receiver = renewReceiverLease(draft.receiver, this.now(), { detail, audioMode: audioMode || draft.receiver.audioMode, ...this.receiverLeasePatch() });
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
        try {
          if (isIOSLike() && !this.receiverAudioOperational()) {
            await this.failSafeStop('The iPhone receiver audio session is no longer running. Audio and cloud ownership stopped; keep this page visible and tap Start Receiver again.');
            return;
          }
          await fn();
        }
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
    for (const timer of this.orderWakeTimers.values()) clearTimeout(timer);
    this.orderWakeTimers.clear();
    if (this.leaseGuardTimer) clearTimeout(this.leaseGuardTimer);
    this.leaseGuardTimer = null;
    document.removeEventListener('visibilitychange', this.visibilityHandler);
  }

  async stop({ release = true } = {}) {
    this.beginExternalAudioIntent('terminal');
    this.nextAudioRequest();
    this.invalidateAudioRestores();
    const stoppingProvider = this.physicalProvider;
    this.cancelPendingAnnouncements('Receiver stop requested.');
    this.audio.stopCalibration?.('Sound check stopped because the receiver is stopping.', { ok: true, report: false });
    this.audio.stopVoice();
    this.audio.stopMusic();
    this.physicalMusicTarget = null;
    this.physicalProvider = '';
    this.physicalRequestId = 0;
    try {
      await this.settleAudioOperations();
    } catch (error) {
      if (release) throw new Error(`Receiver stayed active because an older audio action could not be settled safely: ${error.message}`);
    }
    const appleCouldBePlaying = this.apple.ready ||
      stoppingProvider === 'apple' ||
      this.apple.current?.paused === false ||
      (this.state.playback.provider === 'apple' && this.state.playback.intent === 'playing');
    if (this.active && appleCouldBePlaying) {
      try {
        await this.apple.pauseForAnnouncement();
      } catch (error) {
        if (release) {
          throw new Error(`Receiver was not stopped because Apple Music could not be confirmed paused: ${error.message}`);
        }
        await this.failSafeStop(`Session ended, and Apple Music pause could not be confirmed: ${error.message}`);
        return;
      }
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
    this.physicalMusicTarget = null;
    this.physicalProvider = '';
    this.physicalRequestId = 0;
    this.apple.disconnect();
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

  receiverAudioOperational() {
    const status = this.audio.status?.() || {};
    return status.unlocked === true && status.contextState === 'running';
  }

  async onVisibilityChange() {
    if (!this.active) return;
    if (isIOSLike() && document.visibilityState !== 'visible') {
      await this.failSafeStop('The iPhone receiver left the foreground. Audio and cloud ownership stopped before Safari could suspend; keep this page visible and tap Start Receiver again.');
      return;
    }
    if (document.visibilityState === 'visible') {
      try {
        await this.audio.unlock();
        if (isIOSLike() && !this.receiverAudioOperational()) {
          throw new Error('the iPhone audio context did not return to the running state');
        }
      } catch (error) {
        await this.failSafeStop(`Receiver audio could not resume after the page returned: ${error.message || String(error)}. Tap Start Receiver again.`);
        return;
      }
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
    let applePlayback = null;
    let appleUnavailableReason = '';
    let appleCheckSuperseded = false;
    const appleCheckEpoch = this.audioEpoch;
    const appleCheckPauseGeneration = this.applePauseGeneration;
    const cloudAppleMusicExpected = this.state.playback.provider === 'apple' && this.state.playback.intent === 'playing' && this.physicalProvider !== 'controlled';
    if (cloudAppleMusicExpected && !this.apple.ready) {
      this.apple.resetVolumeVerification?.();
      appleUnavailableReason = 'The local Apple Music receiver went offline and must be reconnected with a fresh tap.';
      if (this.physicalProvider === 'apple') {
        this.physicalProvider = '';
        this.physicalRequestId = 0;
        this.physicalCommittedRequestId = 0;
      }
    }
    if (this.apple.ready && this.temporaryAppleMusicPauseDepth === 0) {
      try {
        applePlayback = await this.apple.playbackState();
        if (this.temporaryAppleMusicPauseDepth > 0 || this.audioEpoch !== appleCheckEpoch || this.applePauseGeneration !== appleCheckPauseGeneration) {
          appleCheckSuperseded = true;
          applePlayback = null;
        } else {
          const localPlayback = applePlayback.isPlaying && String(applePlayback.deviceId || '') === String(this.apple.deviceId || '');
          if (!cloudAppleMusicExpected && localPlayback) {
            try {
              await this.apple.pauseForAnnouncement();
              applePlayback = null;
              this.status('Unexpected Apple Music playback on the receiver was paused to preserve the single-source mix.', false);
            } catch (pauseError) {
            this.audio.stopMusic();
            this.physicalProvider = 'apple';
            this.physicalRequestId = 0;
              throw new Error(`Unexpected Apple Music playback overlapped the controlled source and could not be confirmed paused: ${pauseError.message}`);
            }
          } else if (cloudAppleMusicExpected && !localPlayback) {
            this.apple.resetVolumeVerification();
            appleUnavailableReason = applePlayback.deviceId && applePlayback.deviceId !== this.apple.deviceId
              ? 'Apple Music playback moved to another device.'
              : 'The local Apple Music receiver is not reporting active playback.';
            this.physicalProvider = '';
            this.physicalRequestId = 0;
            throw new Error(appleUnavailableReason);
          } else if (cloudAppleMusicExpected && localPlayback) {
            const measured = await this.apple.readLocalVolume(musicTarget);
            if (!measured.matches || !this.apple.volumeVerified || this.apple.verifiedPercent !== musicTarget) {
              await this.apple.enforceVolume(musicTarget);
            }
          }
        }
      } catch (error) {
        this.apple.resetVolumeVerification();
        this.status(`Apple Music ${musicTarget}% verification will retry: ${error.message}`, false);
      }
    }
    let spotifyPlayback = null;
    let spotifyUnavailableReason = '';
    let spotifyCheckSuperseded = false;
    const spotifyCheckEpoch = this.audioEpoch;
    const spotifyCheckPauseGeneration = this.spotifyPauseGeneration;
    const cloudSpotifyExpected = this.state.playback.provider === 'spotify' &&
      this.state.playback.intent === 'playing' &&
      this.physicalProvider !== 'controlled' &&
      this.physicalProvider !== 'apple';
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
              throw new Error(`Unexpected Spotify playback overlapped the selected source and could not be confirmed paused: ${pauseError.message}`);
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
          audioMode: policy.id,
          ...this.receiverLeasePatch()
        });
        if (draft.playback?.provider === 'apple' && !appleCheckSuperseded && this.temporaryAppleMusicPauseDepth === 0 && this.applePauseGeneration === appleCheckPauseGeneration) {
          const appleLabel = !appleUnavailableReason && applePlayback?.name
            ? `${applePlayback.name}${applePlayback.artists ? ` - ${applePlayback.artists}` : ''}`
            : (this.apple.current?.name
                ? `${this.apple.current.name}${this.apple.current.artists ? ` - ${this.apple.current.artists}` : ''}`
                : draft.playback.label);
          draft.playback = {
            ...draft.playback,
            intent: appleUnavailableReason ? 'paused' : draft.playback.intent,
            label: appleLabel,
            positionMs: Number(applePlayback?.position || draft.playback.positionMs || 0),
            unavailableReason: appleUnavailableReason,
            volumeVerified: !!this.apple.volumeVerified,
            volumeVerifiedPercent: this.apple.volumeVerified ? this.apple.verifiedPercent : null,
            volumeVerifiedAt: this.apple.volumeVerified ? heartbeatNow : 0,
            audioPolicy: policy.id,
            updatedAt: heartbeatNow
          };
        } else if (draft.playback?.provider === 'spotify' && !spotifyCheckSuperseded && this.temporarySpotifyPauseDepth === 0 && this.spotifyPauseGeneration === spotifyCheckPauseGeneration) {
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
    this.beginExternalAudioIntent('terminal');
    this.nextAudioRequest();
    this.invalidateAudioRestores();
    this.active = false;
    this.stopLoops();
    this.cancelPendingAnnouncements(message);
    this.audio.stopCalibration?.('Sound check stopped because the receiver session ended.', { ok: true, report: false });
    this.audio.stopVoice();
    this.audio.stopMusic();
    this.physicalMusicTarget = null;
    let immediateApplePauseError = '';
    let immediateApplePause = Promise.resolve(false);
    try {
      // Invoke MusicKit pause synchronously before Safari can suspend this
      // lifecycle handler. Async confirmation still runs after older work settles.
      immediateApplePause = Promise.resolve(this.apple.pauseImmediately?.()).catch(error => {
        immediateApplePauseError = error.message || String(error);
        return false;
      });
    } catch (error) {
      immediateApplePauseError = error.message || String(error);
    }
    let settleError = '';
    await this.settleAudioOperations().catch(error => { settleError = error.message || String(error); });
    await immediateApplePause;
    let applePauseError = '';
    const appleCouldBePlaying = this.apple.ready ||
      this.physicalProvider === 'apple' ||
      (this.state.playback.provider === 'apple' && this.state.playback.intent === 'playing');
    if (appleCouldBePlaying) {
      await this.apple.pauseForAnnouncement().catch(error => {
        applePauseError = error.message || String(error);
      });
    }
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
      this.apple.disconnect();
      this.spotify.disconnect();
    } else {
      this.audioTail.finally(async () => {
        await this.apple.pauseForAnnouncement().catch(() => {});
        this.apple.disconnect();
        await this.spotify.pauseForAnnouncement?.().catch(() => {});
        this.spotify.disconnect();
      });
    }
    if (this.wakeLock) {
      try { await this.wakeLock.release(); } catch {}
      this.wakeLock = null;
    }
    const stopDetail = [
      settleError ? `Older audio action still settling: ${settleError}` : '',
      immediateApplePauseError ? `Immediate Apple Music pause failed: ${immediateApplePauseError}` : '',
      applePauseError ? `Apple Music could not be confirmed paused: ${applePauseError}` : '',
      spotifyPauseError ? `Spotify could not be confirmed paused: ${spotifyPauseError}` : ''
    ].filter(Boolean).join(' ');
    this.status(stopDetail ? `${message} ${stopDetail}` : message, false);
    this.onChange();
  }

  async sendCommand(type, payload = {}, message = 'Command sent.') {
    let created = null;
    await this.store.mutate(draft => {
      const now = this.now();
      if (type === 'play-apple' && draft.receiver?.appleStatus !== 'ready') {
        const detail = draft.receiver?.appleDetail || 'Open Version X on the speaker device, authorize Apple Music, and tap Connect Apple Music Receiver.';
        throw new Error(`Apple Music command was not sent because the live receiver is not Apple Music-ready: ${detail}`);
      }
      if (type === 'play-spotify' && draft.receiver?.spotifyStatus !== 'ready') {
        const detail = draft.receiver?.spotifyDetail || 'Open Version X on the speaker device, log in to Spotify, and tap Connect Spotify Receiver.';
        throw new Error(`Spotify command was not sent because the live receiver is not Spotify-ready: ${detail}`);
      }
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
    const intentKind = EXTERNAL_AUDIO_INTENT_TYPES.get(event.type) || '';
    const externalIntentGeneration = intentKind ? this.beginExternalAudioIntent(intentKind) : null;
    let error = '';
    let failureMeta = {};
    try {
      try {
        if (externalIntentGeneration !== null) {
          const schedule = getActiveSchedule(this.state);
          const run = schedule?.mode === 'order' ? normalizeSequenceRun(this.state.sequenceRuns?.[schedule.id]) : null;
          if (run?.status === 'auto-pending' && !run.active) {
            await this.cancelAutoPendingOrder(schedule.id, 'A newer audio command cancelled the pending Order continuation.');
          }
          this.assertExternalAudioIntent(externalIntentGeneration, 'A newer receiver command replaced this pending audio event.');
        }
        await this.handleEvent(event, { externalIntentGeneration });
      } catch (caught) {
        error = caught.message || String(caught);
        failureMeta = {
          errorCode: String(caught?.code || '').slice(0, 80),
          errorStatus: Number(caught?.status || 0) || null,
          errorOperation: String(caught?.appleOperation || caught?.spotifyOperation || '').slice(0, 120),
          appleReason: String(caught?.appleReason || '').slice(0, 180),
          spotifyReason: String(caught?.spotifyReason || '').slice(0, 180),
          receiverAppleMusicStatus: String(this.apple.readiness?.().status || '').slice(0, 40),
          receiverSpotifyStatus: String(this.spotify.readiness?.().status || '').slice(0, 40)
        };
        this.status(`Command failed: ${error}`, false, { event });
      }
      const handled = handledIds();
      handled.add(event.id);
      saveHandled(handled);
      const completedAt = this.now();
      const completed = { ...completeEvent(event, this.deviceId, completedAt, error), ...failureMeta };
      await this.store.mutate(draft => {
        draft.events = mergeById([...(draft.events || []), completed]).slice(-120);
        if (['play-apple', 'play-spotify'].includes(event.type) && draft.receiver?.id === this.deviceId && draft.receiver?.sessionId === this.sessionId) {
          draft.receiver = renewReceiverLease(draft.receiver, completedAt, this.receiverLeasePatch());
        }
        draft.activityLog = [
          makeLog(error ? 'error' : 'receiver', error ? 'Receiver command failed' : 'Receiver command completed', error || event.payload?.label || event.type, completedAt, { eventId: event.id, commandType: event.type, ...failureMeta }),
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

  async handleEvent(event, { externalIntentGeneration = null } = {}) {
    const payload = event.payload || {};
    switch (event.type) {
      case 'play-controlled':
        return await this.playControlled(payload.url, {
          label: payload.label,
          index: payload.index,
          volumePercent: payload.volumePercent,
          volumeMode: payload.volumeMode,
          scheduledItemId: payload.scheduledItemId,
          scheduledRunToken: payload.scheduledRunToken,
          loop: payload.loop
        });
      case 'play-apple':
        return await this.playAppleMusic(payload.url, {
          volumePercent: payload.volumePercent,
          volumeMode: payload.volumeMode,
          scheduledItemId: payload.scheduledItemId,
          scheduledRunToken: payload.scheduledRunToken,
          persistSource: payload.persistSource !== false
        });
      case 'play-spotify':
        return await this.playSpotify(payload.url, {
          volumePercent: payload.volumePercent,
          volumeMode: payload.volumeMode,
          scheduledItemId: payload.scheduledItemId,
          scheduledRunToken: payload.scheduledRunToken,
          persistSource: payload.persistSource !== false
        });
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
        return await this.announce(payload.text, {
          safety: event.type === 'announce-safety',
          label: payload.label,
          eventId: event.id,
          volumePercent: payload.volumePercent
        });
      case 'weather-check':
        return await this.checkWeather({ announce: payload.announce !== false, reason: 'remote command' });
      case 'calibration':
        return await this.runCalibration(externalIntentGeneration);
      case 'order-next':
        return await this.requestOrderNext(event, externalIntentGeneration);
      case 'order-reset':
        return await this.resetOrderSchedule(event, externalIntentGeneration);
      default:
        throw new Error(`Unknown receiver command: ${event.type}`);
    }
  }

  async resolveControlledTracks(url) {
    const raw = String(url || '').trim();
    if (!raw) throw new Error('Paste a Suno playlist, Suno song, or direct audio URL first.');
    const data = await fetchJson(`/api/suno-playlist?v=x&url=${encodeURIComponent(raw)}`);
    const tracks = (data.tracks || []).map(safeTrack).filter(track => /^https:\/\//i.test(track.audioUrl));
    if (!tracks.length) throw new Error(data.audioWarning || 'That source did not expose a playable audio track. Use a public Suno link or direct HTTPS audio URL.');
    return { tracks, playlistName: data.playlistName || tracks[0].title, source: data.source || '' };
  }

  async playControlled(url, { label = '', index = 0, volumePercent = null, volumeMode = 'global', scheduledItemId = '', scheduledRunToken = '', loop = null } = {}) {
    if (!this.isOwner()) throw new Error('This device is not the active speaker receiver.');
    this.assertNoSafetyPending();
    this.assertScheduledRunAuthorization(this.state, scheduledRunToken, scheduledItemId);
    const targetPercent = clamp(
      volumePercent === null || volumePercent === undefined ? this.state.config.musicLevel : volumePercent,
      0,
      100,
      this.state.config.musicLevel
    );
    const targetMode = volumeMode === 'custom' ? 'custom' : 'global';
    const previousPlayback = structuredClone(this.state.playback || {});
    const previousTarget = this.currentMusicTarget(previousPlayback);
    const previousPhysicalTarget = this.physicalMusicTarget ? { ...this.physicalMusicTarget } : null;
    const requestId = this.nextAudioRequest();
    const previousSourceConfig = Object.fromEntries(['musicProvider', 'musicUrl', 'musicLabel', 'appleUrl', 'spotifyUrl'].map(key => [key, this.state.config[key]]));
    const resolved = await this.resolveControlledTracks(url);
    if (requestId !== this.audioRequestId) throw new Error('A newer audio command replaced this music request while its source was loading.');
    if (!this.isOwner()) throw new Error('Receiver ownership changed while the music source was loading. Nothing was played.');
    this.assertScheduledRunAuthorization(this.state, scheduledRunToken, scheduledItemId);
    if (scheduledRunToken) {
      this.pendingScheduledPlayback = {
        token: String(scheduledRunToken),
        itemId: String(scheduledItemId || ''),
        provider: 'controlled',
        requestId
      };
    }
    const epoch = this.invalidateAudioRestores();
    const physical = await this.serializeAudio(async () => {
      this.assertAudioRequest(requestId, epoch);
      this.assertScheduledRunAuthorization(this.state, scheduledRunToken, scheduledItemId);
      const controlledAudible = this.physicalProvider === 'controlled' || !!this.audio.musicPlaying?.();
      const controlledSnapshot = controlledAudible
        ? {
            audioUrl: String(this.audio.currentUrl || previousPlayback.audioUrl || ''),
            label: String(this.audio.currentLabel || previousPlayback.label || 'Suno / direct audio'),
            position: Number(this.audio.musicElement?.currentTime || 0),
            loop: !!this.audio.musicElement?.loop,
            scheduledRunToken: String(this.audio.currentRunToken || previousPlayback.scheduledRunToken || ''),
            scheduledItemId: String(previousPlayback.scheduledItemId || ''),
            volumeMode: previousPlayback.volumeMode === 'custom' || previousPhysicalTarget?.mode === 'custom' ? 'custom' : 'global',
            musicLevelPercent: previousTarget
          }
        : null;
      const appleCouldBePlaying = this.physicalProvider === 'apple' ||
        this.apple.ready ||
        this.apple.current?.paused === false ||
        (this.state.playback.provider === 'apple' && this.state.playback.intent === 'playing');
      const spotifyCouldBePlaying = this.physicalProvider === 'spotify' ||
        this.spotify.ready ||
        this.spotify.current?.paused === false ||
        (this.state.playback.provider === 'spotify' && this.state.playback.intent === 'playing');
      if (appleCouldBePlaying) this.beginTemporaryAppleMusicPause();
      if (spotifyCouldBePlaying) this.beginTemporarySpotifyPause();
      let appleSnapshot = null;
      let spotifySnapshot = null;
      try {
        if (appleCouldBePlaying) {
          try {
            appleSnapshot = await this.apple.pauseForAnnouncement();
          } catch (error) {
            throw new Error(`Controlled music was not started because Apple Music could not be confirmed paused: ${error.message}`);
          }
        }
        if (spotifyCouldBePlaying) {
          try {
            spotifySnapshot = await this.spotify.pauseForAnnouncement();
          } catch (error) {
            if (appleSnapshot?.wasPlaying && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
              await this.apple.resumeAfterAnnouncement(appleSnapshot, {
                assertCurrent: () => this.assertAudioRequest(requestId, epoch)
              }).catch(() => {});
            }
            throw new Error(`Controlled music was not started because Spotify could not be confirmed paused: ${error.message}`);
          }
        }
        try {
          this.assertAudioRequest(requestId, epoch, 'Controlled music was superseded while external music was pausing.');
        } catch (error) {
          this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
          if (appleSnapshot?.wasPlaying) this.carrySafetyRestore({ provider: 'apple', appleSnapshot, musicLevelPercent: previousTarget });
          if (spotifySnapshot?.wasPlaying) this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot, musicLevelPercent: previousTarget });
          throw error;
        }
        if (appleCouldBePlaying || spotifyCouldBePlaying) this.physicalProvider = '';
        const safeIndex = Math.max(0, Math.min(resolved.tracks.length - 1, Number(index) || 0));
        const track = resolved.tracks[safeIndex];
        this.assertAudioRequest(requestId, epoch, 'Controlled music was superseded before its media could start.');
        this.assertScheduledRunAuthorization(this.state, scheduledRunToken, scheduledItemId);
        this.physicalMusicTarget = { requestId, mode: targetMode, percent: targetPercent, provider: 'controlled' };
        this.applyConfiguredMusicTarget({ report: false, percent: targetPercent });
        try {
          await this.audio.playMusicUrl(track.audioUrl, {
            label: track.title || label || resolved.playlistName,
            loop: loop === null || loop === undefined ? resolved.tracks.length === 1 : !!loop,
            scheduledRunToken
          });
          this.assertScheduledRunAuthorization(this.state, scheduledRunToken, scheduledItemId);
        } catch (error) {
          let restoreError = '';
          this.audio.stopMusic();
          if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
          this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
          const carriedControlledToSafety = controlledSnapshot && this.carrySafetyRestore({
            provider: 'controlled',
            controlledSnapshot: { ...controlledSnapshot, wasPlaying: true },
            musicLevelPercent: previousTarget
          });
          if (!carriedControlledToSafety && controlledSnapshot?.audioUrl && this.scheduledRunAuthorized(this.state, controlledSnapshot.scheduledRunToken, controlledSnapshot.scheduledItemId) && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
            try {
              await this.audio.playMusicUrl(controlledSnapshot.audioUrl, {
                label: controlledSnapshot.label,
                startAt: controlledSnapshot.position,
                loop: controlledSnapshot.loop,
                scheduledRunToken: controlledSnapshot.scheduledRunToken
              });
              this.physicalProvider = 'controlled';
              this.physicalRequestId = requestId;
              this.physicalCommittedRequestId = requestId;
              this.physicalMusicTarget = {
                requestId,
                mode: controlledSnapshot.volumeMode,
                percent: previousTarget,
                provider: 'controlled'
              };
              this.rememberCommittedPlayback(requestId);
            } catch (caught) {
              restoreError = caught.message || String(caught);
            }
          }
          const carriedToSafety = appleSnapshot?.wasPlaying && this.carrySafetyRestore({ provider: 'apple', appleSnapshot, musicLevelPercent: previousTarget });
          if (!carriedToSafety && appleSnapshot?.wasPlaying && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
            await this.apple.resumeAfterAnnouncement(appleSnapshot, {
              assertCurrent: () => this.assertAudioRequest(requestId, epoch)
            }).then(() => { this.physicalProvider = 'apple'; }).catch(caught => { restoreError = caught.message || String(caught); });
          }
          const carriedSpotifyToSafety = spotifySnapshot?.wasPlaying && this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot, musicLevelPercent: previousTarget });
          if (!this.physicalProvider && !carriedSpotifyToSafety && spotifySnapshot?.wasPlaying && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
            await this.spotify.resumeAfterAnnouncement(spotifySnapshot, {
              assertCurrent: () => this.assertAudioRequest(requestId, epoch)
            }).then(() => { this.physicalProvider = 'spotify'; }).catch(caught => { restoreError = caught.message || String(caught); });
          }
          throw new Error(restoreError ? `${error.message} The prior controlled track also could not be restored: ${restoreError}` : error.message);
        }
        if (requestId !== this.audioRequestId || epoch !== this.audioEpoch) {
          this.audio.stopMusic();
          if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
          this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
          if (appleSnapshot?.wasPlaying) this.carrySafetyRestore({ provider: 'apple', appleSnapshot, musicLevelPercent: previousTarget });
          if (spotifySnapshot?.wasPlaying) this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot, musicLevelPercent: previousTarget });
          throw new Error('A newer audio command replaced this controlled-music start.');
        }
        if (!this.isOwner()) {
          this.audio.stopMusic();
          if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
          this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
          throw new Error('Receiver ownership changed while music was starting, so playback was stopped.');
        }
        this.physicalProvider = 'controlled';
        this.physicalRequestId = requestId;
        return { appleSnapshot, spotifySnapshot, controlledSnapshot, safeIndex, track };
      } finally {
        if (appleCouldBePlaying) this.endTemporaryAppleMusicPause();
        if (spotifyCouldBePlaying) this.endTemporarySpotifyPause();
      }
    }).catch(error => {
      if (this.pendingScheduledPlayback?.requestId === requestId) this.pendingScheduledPlayback = null;
      throw error;
    });
    try {
      await this.store.mutate(draft => {
        this.assertReceiptCurrent(requestId, epoch, 'Controlled playback was superseded before its cloud receipt could commit.');
        this.assertScheduledRunAuthorization(draft, scheduledRunToken, scheduledItemId);
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
          musicLevelPercent: targetPercent,
          volumeMode: targetMode,
          scheduledItemId: String(scheduledItemId || ''),
          scheduledRunToken: String(scheduledRunToken || ''),
          scheduledFingerprint: scheduledRunToken
            ? scheduleItemFingerprint((getActiveSchedule(draft)?.items || []).find(item => String(item.id || '') === String(scheduledItemId || '')))
            : '',
          updatedAt: this.now()
        };
        draft.activityLog = [makeLog('play', `Controlled music playing at ${targetPercent}%`, draft.playback.label, this.now(), { provider: 'controlled', scheduledItemId: String(scheduledItemId || '') }), ...(draft.activityLog || [])];
        return draft;
      }, 'Controlled music started', { requireDurable: true });
      this.assertReceiptCurrent(requestId, epoch, 'Controlled playback was superseded while its cloud receipt was committing.');
      this.physicalCommittedRequestId = requestId;
      this.rememberCommittedPlayback(requestId);
    } catch (error) {
      if (this.pendingScheduledPlayback?.requestId === requestId) this.pendingScheduledPlayback = null;
      let restoreError = '';
      await this.serializeAudio(async () => {
        const mustQuiet = this.physicalRequestId === requestId || this.audioRequestKind === 'safety' || this.audioRequestKind === 'terminal' || !this.isOwner();
        if (!mustQuiet) return;
        this.audio.stopMusic();
        if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
        this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
        this.physicalProvider = '';
        this.physicalRequestId = 0;
        this.physicalCommittedRequestId = 0;
        const carriedControlledToSafety = physical.controlledSnapshot && this.carrySafetyRestore({
          provider: 'controlled',
          controlledSnapshot: { ...physical.controlledSnapshot, wasPlaying: true },
          musicLevelPercent: previousTarget
        });
        if (!carriedControlledToSafety && physical.controlledSnapshot?.audioUrl && this.scheduledRunAuthorized(this.state, physical.controlledSnapshot.scheduledRunToken, physical.controlledSnapshot.scheduledItemId) && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
          try {
            await this.audio.playMusicUrl(physical.controlledSnapshot.audioUrl, {
              label: physical.controlledSnapshot.label,
              startAt: physical.controlledSnapshot.position,
              loop: physical.controlledSnapshot.loop,
              scheduledRunToken: physical.controlledSnapshot.scheduledRunToken
            });
            this.physicalProvider = 'controlled';
            this.physicalRequestId = requestId;
            this.physicalCommittedRequestId = requestId;
            this.physicalMusicTarget = {
              requestId,
              mode: physical.controlledSnapshot.volumeMode,
              percent: previousTarget,
              provider: 'controlled'
            };
            this.rememberCommittedPlayback(requestId);
          } catch (caught) {
            restoreError = caught.message || String(caught);
          }
        }
        const carriedToSafety = physical.appleSnapshot?.wasPlaying && this.carrySafetyRestore({ provider: 'apple', appleSnapshot: physical.appleSnapshot, musicLevelPercent: previousTarget });
        if (!this.physicalProvider && !carriedToSafety && physical.appleSnapshot?.wasPlaying && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
          try {
            await this.apple.resumeAfterAnnouncement(physical.appleSnapshot, {
              assertCurrent: () => this.assertAudioRequest(requestId, epoch)
            });
            this.physicalProvider = 'apple';
          } catch (caught) {
            restoreError = caught.message || String(caught);
          }
        }
        const carriedSpotifyToSafety = physical.spotifySnapshot?.wasPlaying && this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot: physical.spotifySnapshot, musicLevelPercent: previousTarget });
        if (!this.physicalProvider && !carriedSpotifyToSafety && physical.spotifySnapshot?.wasPlaying && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
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
        ? `Controlled music was stopped because its cloud state could not be saved: ${error.message}. Prior external music restore also failed: ${restoreError}`
        : `Controlled music was stopped because its cloud state could not be saved: ${error.message}`);
    }
    if (this.pendingScheduledPlayback?.requestId === requestId) this.pendingScheduledPlayback = null;
    this.status(`${physical.track.title} is playing at exact ${targetPercent}%.`, true);
    return true;
  }

  async playAppleMusic(url, { volumePercent = null, volumeMode = 'global', scheduledItemId = '', scheduledRunToken = '', persistSource = true } = {}) {
    if (!this.isOwner()) throw new Error('This device is not the active speaker receiver.');
    this.assertNoSafetyPending();
    this.assertScheduledRunAuthorization(this.state, scheduledRunToken, scheduledItemId);
    if (!this.apple.loggedIn()) throw new Error('Apple Music is not authorized on the speaker receiver. Open Settings on that device and choose Authorize Apple Music.');
    if (!this.apple.ready) throw new Error('Apple Music needs a local receiver tap. On the speaker device, open Receiver and choose Connect Apple Music Receiver.');
    if (!this.isOwner()) throw new Error('Receiver ownership changed before Apple Music could start.');
    const targetPercent = clamp(
      volumePercent === null || volumePercent === undefined ? this.state.config.musicLevel : volumePercent,
      0,
      100,
      this.state.config.musicLevel
    );
    const targetMode = volumeMode === 'custom' ? 'custom' : 'global';
    const requestId = this.nextAudioRequest();
    const epoch = this.invalidateAudioRestores();
    const previousPlayback = structuredClone(this.state.playback || {});
    const previousTarget = this.currentMusicTarget(previousPlayback);
    const previousSourceConfig = Object.fromEntries(['musicProvider', 'musicUrl', 'musicLabel', 'appleUrl', 'spotifyUrl'].map(key => [key, this.state.config[key]]));
    if (scheduledRunToken) {
      this.pendingScheduledPlayback = {
        token: String(scheduledRunToken),
        itemId: String(scheduledItemId || ''),
        provider: 'apple',
        requestId
      };
    }
    const physical = await this.serializeAudio(async () => {
      this.assertAudioRequest(requestId, epoch);
      this.assertScheduledRunAuthorization(this.state, scheduledRunToken, scheduledItemId);
      const controlledAudible = this.physicalProvider === 'controlled' || !!this.audio.musicPlaying?.();
      const controlledSnapshot = controlledAudible
        ? {
            audioUrl: String(this.audio.currentUrl || this.state.playback.audioUrl || ''),
            label: String(this.audio.currentLabel || this.state.playback.label || 'Suno / direct audio'),
            position: Number(this.audio.musicElement?.currentTime || 0),
            scheduledRunToken: String(this.audio.currentRunToken || this.state.playback.scheduledRunToken || '')
          }
        : null;
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
            throw new Error(`Apple Music was not started because Spotify could not be confirmed paused: ${error.message}`);
          }
          this.assertAudioRequest(requestId, epoch, 'Apple Music was superseded while Spotify was pausing.');
        }
        this.audio.pauseMusic();
        this.physicalMusicTarget = { requestId, mode: targetMode, percent: targetPercent, provider: 'apple' };
        this.applyConfiguredMusicTarget({ report: false, percent: targetPercent });
        let result;
        try {
          result = await this.apple.play(url || this.state.config.appleUrl, {
          assertCurrent: () => {
            this.assertAudioRequest(requestId, epoch);
            this.assertScheduledRunAuthorization(this.state, scheduledRunToken, scheduledItemId);
          }
        });
        } catch (error) {
        const superseded = requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner();
        if (superseded) {
          try {
            await this.confirmAppleMusicPaused('The superseded Apple Music start could not be declared stopped.');
          } catch (pauseError) {
            this.physicalProvider = 'apple';
            this.physicalRequestId = requestId;
            const failure = appleErrorWithContext(
              error,
              `Superseded Apple Music playback may still be audible, so no other source was restored: ${pauseError.message}`
            );
            failure.appleOperation = pauseError.appleOperation || failure.appleOperation;
            failure.appleReason = pauseError.appleReason || failure.appleReason;
            failure.applePauseUnconfirmed = true;
            throw failure;
          }
          this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
          if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
          this.physicalProvider = '';
          if (controlledSnapshot) this.carrySafetyRestore({ provider: 'controlled', controlledSnapshot: { ...controlledSnapshot, wasPlaying: true }, musicLevelPercent: previousTarget });
          if (spotifySnapshot?.wasPlaying) this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot, musicLevelPercent: previousTarget });
          throw new Error(`Apple Music playback was superseded and stopped: ${error.message}`);
        }
        if (error?.applePauseUnconfirmed || error?.code === 'APPLE_MUSIC_NATIVE_PAUSE_UNCONFIRMED') {
          this.physicalProvider = 'apple';
          this.physicalRequestId = requestId;
          const failure = appleErrorWithContext(error, `Apple Music silence could not be confirmed, so no other source was restored: ${error.message}`);
          failure.applePauseUnconfirmed = true;
          throw failure;
        }
        let restoreError = '';
        if (error?.code === 'SCHEDULE_RUN_CANCELLED') {
          try {
            await this.confirmAppleMusicPaused('The cancelled scheduled Apple Music start could not be declared stopped.');
          } catch (pauseError) {
            this.physicalProvider = 'apple';
            this.physicalRequestId = requestId;
            const failure = appleErrorWithContext(
              error,
              `${error.message} Another music source was not restored because Apple Music silence could not be confirmed: ${pauseError.message}`
            );
            failure.appleOperation = pauseError.appleOperation || failure.appleOperation;
            failure.appleReason = pauseError.appleReason || failure.appleReason;
            failure.applePauseUnconfirmed = true;
            this.status(failure.message, false, {
              errorCode: failure.code || 'SCHEDULE_RUN_CANCELLED',
              errorOperation: failure.appleOperation || '',
              appleReason: failure.appleReason || ''
            });
            throw failure;
          }
        }
        this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
        if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
        if (controlledSnapshot && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
          try {
            const resumed = await this.audio.resumeMusic();
            if (!resumed && controlledSnapshot.audioUrl) {
              await this.audio.playMusicUrl(controlledSnapshot.audioUrl, { label: controlledSnapshot.label, startAt: controlledSnapshot.position, scheduledRunToken: controlledSnapshot.scheduledRunToken });
            }
          } catch (caught) {
            restoreError = caught.message || String(caught);
          }
        }
        if (!restoreError && spotifySnapshot?.wasPlaying && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
          try {
            await this.spotify.resumeAfterAnnouncement(spotifySnapshot, {
              assertCurrent: () => this.assertAudioRequest(requestId, epoch)
            });
            this.physicalProvider = 'spotify';
          } catch (caught) {
            restoreError = caught.message || String(caught);
          }
        }
        if (restoreError) {
          throw appleErrorWithContext(error, `${error.message} Prior music also could not be restored: ${restoreError}`);
        }
        throw error;
        }
        if (requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner()) {
        try {
          await this.confirmAppleMusicPaused('Apple Music was superseded after its start command completed.');
        } catch (pauseError) {
          this.physicalProvider = 'apple';
          this.physicalRequestId = requestId;
          const failure = appleErrorWithContext(
            pauseError,
            `Apple Music was superseded while starting but may still be audible, so no other source was restored: ${pauseError.message}`
          );
          failure.applePauseUnconfirmed = true;
          throw failure;
        }
        this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
        if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
        this.physicalProvider = '';
        if (controlledSnapshot) this.carrySafetyRestore({ provider: 'controlled', controlledSnapshot: { ...controlledSnapshot, wasPlaying: true }, musicLevelPercent: previousTarget });
        if (spotifySnapshot?.wasPlaying) this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot, musicLevelPercent: previousTarget });
        throw new Error('Apple Music was superseded while starting, so playback was stopped.');
        }
        this.audio.stopMusic();
        this.physicalProvider = 'apple';
        this.physicalRequestId = requestId;
        return { controlledSnapshot, spotifySnapshot, result };
      } finally {
        if (spotifyCouldBePlaying) this.endTemporarySpotifyPause();
      }
    }).catch(error => {
      if (!error?.applePauseUnconfirmed && this.pendingScheduledPlayback?.requestId === requestId) this.pendingScheduledPlayback = null;
      throw error;
    });
    const policy = this.currentPolicy('apple', targetPercent);
    try {
      await this.store.mutate(draft => {
        this.assertReceiptCurrent(requestId, epoch, 'Apple Music playback was superseded before its cloud receipt could commit.');
        this.assertScheduledRunAuthorization(draft, scheduledRunToken, scheduledItemId);
        if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
          throw new Error('Receiver ownership changed before Apple Music playback could be recorded.');
        }
        if (persistSource) {
          draft.config.musicProvider = 'apple';
          draft.config.appleUrl = String(url || draft.config.appleUrl || '');
        }
        const playedSourceUrl = String(url || draft.config.appleUrl || '');
        draft.playback = {
          provider: 'apple',
          intent: 'playing',
          label: this.apple.current?.name || 'Apple Music playlist',
          sourceUrl: playedSourceUrl,
          trackIndex: 0,
          musicLevelPercent: targetPercent,
          volumeMode: targetMode,
          scheduledItemId: String(scheduledItemId || ''),
          scheduledRunToken: String(scheduledRunToken || ''),
          scheduledFingerprint: scheduledRunToken
            ? scheduleItemFingerprint((getActiveSchedule(draft)?.items || []).find(item => String(item.id || '') === String(scheduledItemId || '')))
            : '',
          updatedAt: this.now(),
          volumeVerified: !!physical.result.volume?.verified,
          volumeVerifiedPercent: physical.result.volume?.verified ? physical.result.volume.verifiedPercent : null,
          volumeVerifiedAt: physical.result.volume?.verified ? this.now() : 0,
          audioPolicy: policy.id
        };
        draft.activityLog = [makeLog('play', physical.result.volume?.verified ? `Apple Music playing at verified ${targetPercent}%` : 'Apple Music playing in compatibility mode', policy.detail, this.now(), { provider: 'apple', scheduledItemId: String(scheduledItemId || '') }), ...(draft.activityLog || [])];
        return draft;
      }, 'Apple Music playback started', { requireDurable: true });
      this.assertReceiptCurrent(requestId, epoch, 'Apple Music playback was superseded while its cloud receipt was committing.');
      this.physicalCommittedRequestId = requestId;
      this.rememberCommittedPlayback(requestId);
    } catch (error) {
      if (this.pendingScheduledPlayback?.requestId === requestId) this.pendingScheduledPlayback = null;
      let pauseError = '';
      let restoreError = '';
      await this.serializeAudio(async () => {
        const mustQuiet = this.physicalRequestId === requestId || this.audioRequestKind === 'safety' || this.audioRequestKind === 'terminal' || !this.isOwner();
        if (!mustQuiet) return;
        await this.apple.pauseForAnnouncement().catch(caught => { pauseError = caught.message || String(caught); });
        this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
        if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
        this.physicalProvider = pauseError ? 'apple' : '';
        if (!pauseError) {
          this.physicalRequestId = 0;
          this.physicalCommittedRequestId = 0;
        }
        const carriedToSafety = !pauseError && physical.controlledSnapshot && this.carrySafetyRestore({ provider: 'controlled', controlledSnapshot: { ...physical.controlledSnapshot, wasPlaying: true }, musicLevelPercent: previousTarget });
        if (!pauseError && !carriedToSafety && physical.controlledSnapshot && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
          try {
            const resumed = await this.audio.resumeMusic();
            if (!resumed && physical.controlledSnapshot.audioUrl) {
              await this.audio.playMusicUrl(physical.controlledSnapshot.audioUrl, {
                label: physical.controlledSnapshot.label,
                startAt: physical.controlledSnapshot.position,
                scheduledRunToken: physical.controlledSnapshot.scheduledRunToken
              });
            }
            this.physicalProvider = 'controlled';
          } catch (caught) {
            restoreError = caught.message || String(caught);
          }
        }
        const carriedSpotifyToSafety = !pauseError && physical.spotifySnapshot?.wasPlaying && this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot: physical.spotifySnapshot, musicLevelPercent: previousTarget });
        if (!pauseError && !this.physicalProvider && !carriedSpotifyToSafety && physical.spotifySnapshot?.wasPlaying && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
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
      throw new Error(`Apple Music was stopped because its cloud state could not be saved: ${error.message}${pauseError ? ` Apple Music pause confirmation failed: ${pauseError}` : ''}${restoreError ? ` Prior music restore failed: ${restoreError}` : ''}`);
    }
    if (this.pendingScheduledPlayback?.requestId === requestId) this.pendingScheduledPlayback = null;
    await this.updateReceiverDetail(policy.detail, policy.id).catch(error => this.status(`Apple Music is playing, but receiver capability detail could not be saved: ${error.message}`, false));
    return true;
  }

  async playSpotify(url, { volumePercent = null, volumeMode = 'global', scheduledItemId = '', scheduledRunToken = '', persistSource = true } = {}) {
    if (!this.isOwner()) throw new Error('This device is not the active speaker receiver.');
    this.assertNoSafetyPending();
    this.assertScheduledRunAuthorization(this.state, scheduledRunToken, scheduledItemId);
    if (!this.spotify.loggedIn()) throw new Error('Spotify is not logged in on the speaker receiver. Open Settings on that device and choose Login Spotify.');
    if (!this.spotify.ready) throw new Error('Spotify needs a local receiver tap. On the speaker device, open Receiver and choose Connect Spotify Receiver.');
    if (!this.isOwner()) throw new Error('Receiver ownership changed before Spotify could start.');
    const targetPercent = clamp(
      volumePercent === null || volumePercent === undefined ? this.state.config.musicLevel : volumePercent,
      0,
      100,
      this.state.config.musicLevel
    );
    const targetMode = volumeMode === 'custom' ? 'custom' : 'global';
    const requestId = this.nextAudioRequest();
    const epoch = this.invalidateAudioRestores();
    const previousPlayback = structuredClone(this.state.playback || {});
    const previousTarget = this.currentMusicTarget(previousPlayback);
    const previousSourceConfig = Object.fromEntries(['musicProvider', 'musicUrl', 'musicLabel', 'appleUrl', 'spotifyUrl'].map(key => [key, this.state.config[key]]));
    if (scheduledRunToken) {
      this.pendingScheduledPlayback = {
        token: String(scheduledRunToken),
        itemId: String(scheduledItemId || ''),
        provider: 'spotify',
        requestId
      };
    }
    const physical = await this.serializeAudio(async () => {
      this.assertAudioRequest(requestId, epoch);
      this.assertScheduledRunAuthorization(this.state, scheduledRunToken, scheduledItemId);
      const controlledAudible = this.physicalProvider === 'controlled' || !!this.audio.musicPlaying?.();
      const controlledSnapshot = controlledAudible
        ? {
            audioUrl: String(this.audio.currentUrl || this.state.playback.audioUrl || ''),
            label: String(this.audio.currentLabel || this.state.playback.label || 'Suno / direct audio'),
            position: Number(this.audio.musicElement?.currentTime || 0),
            scheduledRunToken: String(this.audio.currentRunToken || this.state.playback.scheduledRunToken || '')
          }
        : null;
      const appleCouldBePlaying = this.physicalProvider === 'apple' ||
        this.apple.ready ||
        this.apple.current?.paused === false ||
        (this.state.playback.provider === 'apple' && this.state.playback.intent === 'playing');
      if (appleCouldBePlaying) this.beginTemporaryAppleMusicPause();
      let appleSnapshot = null;
      try {
        if (appleCouldBePlaying) {
          try {
            appleSnapshot = await this.apple.pauseForAnnouncement();
          } catch (error) {
            throw new Error(`Spotify was not started because Apple Music could not be confirmed paused: ${error.message}`);
          }
          this.assertAudioRequest(requestId, epoch, 'Spotify was superseded while Apple Music was pausing.');
        }
        this.audio.pauseMusic();
        this.physicalMusicTarget = { requestId, mode: targetMode, percent: targetPercent, provider: 'spotify' };
        this.applyConfiguredMusicTarget({ report: false, percent: targetPercent });
        let result;
        try {
          result = await this.spotify.play(url || this.state.config.spotifyUrl, {
          assertCurrent: () => {
            this.assertAudioRequest(requestId, epoch);
            this.assertScheduledRunAuthorization(this.state, scheduledRunToken, scheduledItemId);
          }
        });
        } catch (error) {
        const superseded = requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner();
        if (superseded) {
          try {
            await this.confirmSpotifyPaused('The superseded Spotify start could not be declared stopped.');
          } catch (pauseError) {
            this.physicalProvider = 'spotify';
            this.physicalRequestId = requestId;
            const failure = spotifyErrorWithContext(
              error,
              `Superseded Spotify playback may still be audible, so no other source was restored: ${pauseError.message}`
            );
            failure.spotifyOperation = pauseError.spotifyOperation || failure.spotifyOperation;
            failure.spotifyReason = pauseError.spotifyReason || failure.spotifyReason;
            failure.spotifyPauseUnconfirmed = true;
            throw failure;
          }
          this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
          if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
          this.physicalProvider = '';
          if (controlledSnapshot) this.carrySafetyRestore({ provider: 'controlled', controlledSnapshot: { ...controlledSnapshot, wasPlaying: true }, musicLevelPercent: previousTarget });
          if (appleSnapshot?.wasPlaying) this.carrySafetyRestore({ provider: 'apple', appleSnapshot, musicLevelPercent: previousTarget });
          throw new Error(`Spotify playback was superseded and stopped: ${error.message}`);
        }
        let restoreError = '';
        if (error?.code === 'SCHEDULE_RUN_CANCELLED') {
          try {
            await this.confirmSpotifyPaused('The cancelled scheduled Spotify start could not be declared stopped.');
          } catch (pauseError) {
            this.physicalProvider = 'spotify';
            this.physicalRequestId = requestId;
            const failure = spotifyErrorWithContext(
              error,
              `${error.message} Another music source was not restored because Spotify silence could not be confirmed: ${pauseError.message}`
            );
            failure.spotifyOperation = pauseError.spotifyOperation || failure.spotifyOperation;
            failure.spotifyReason = pauseError.spotifyReason || failure.spotifyReason;
            failure.spotifyPauseUnconfirmed = true;
            this.status(failure.message, false, {
              errorCode: failure.code || 'SCHEDULE_RUN_CANCELLED',
              errorOperation: failure.spotifyOperation || '',
              spotifyReason: failure.spotifyReason || ''
            });
            throw failure;
          }
        }
        this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
        if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
        if (controlledSnapshot && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
          try {
            const resumed = await this.audio.resumeMusic();
            if (!resumed && controlledSnapshot.audioUrl) {
              await this.audio.playMusicUrl(controlledSnapshot.audioUrl, { label: controlledSnapshot.label, startAt: controlledSnapshot.position, scheduledRunToken: controlledSnapshot.scheduledRunToken });
            }
          } catch (caught) {
            restoreError = caught.message || String(caught);
          }
        }
        if (!restoreError && appleSnapshot?.wasPlaying && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
          try {
            await this.apple.resumeAfterAnnouncement(appleSnapshot, {
              assertCurrent: () => this.assertAudioRequest(requestId, epoch)
            });
            this.physicalProvider = 'apple';
          } catch (caught) {
            restoreError = caught.message || String(caught);
          }
        }
        if (restoreError) {
          throw spotifyErrorWithContext(error, `${error.message} Prior music also could not be restored: ${restoreError}`);
        }
        throw error;
        }
        if (requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner()) {
        try {
          await this.confirmSpotifyPaused('Spotify was superseded after its start command completed.');
        } catch (pauseError) {
          this.physicalProvider = 'spotify';
          this.physicalRequestId = requestId;
          const failure = spotifyErrorWithContext(
            pauseError,
            `Spotify was superseded while starting but may still be audible, so no other source was restored: ${pauseError.message}`
          );
          failure.spotifyPauseUnconfirmed = true;
          throw failure;
        }
        this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
        if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
        this.physicalProvider = '';
        if (controlledSnapshot) this.carrySafetyRestore({ provider: 'controlled', controlledSnapshot: { ...controlledSnapshot, wasPlaying: true }, musicLevelPercent: previousTarget });
        if (appleSnapshot?.wasPlaying) this.carrySafetyRestore({ provider: 'apple', appleSnapshot, musicLevelPercent: previousTarget });
        throw new Error('Spotify was superseded while starting, so playback was stopped.');
        }
        this.audio.stopMusic();
        this.physicalProvider = 'spotify';
        this.physicalRequestId = requestId;
        return { controlledSnapshot, appleSnapshot, result };
      } finally {
        if (appleCouldBePlaying) this.endTemporaryAppleMusicPause();
      }
    }).catch(error => {
      if (!error?.spotifyPauseUnconfirmed && this.pendingScheduledPlayback?.requestId === requestId) this.pendingScheduledPlayback = null;
      throw error;
    });
    const policy = this.currentPolicy('spotify', targetPercent);
    try {
      await this.store.mutate(draft => {
        this.assertReceiptCurrent(requestId, epoch, 'Spotify playback was superseded before its cloud receipt could commit.');
        this.assertScheduledRunAuthorization(draft, scheduledRunToken, scheduledItemId);
        if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
          throw new Error('Receiver ownership changed before Spotify playback could be recorded.');
        }
        if (persistSource) {
          draft.config.musicProvider = 'spotify';
          draft.config.spotifyUrl = String(url || draft.config.spotifyUrl || '');
        }
        const playedSourceUrl = String(url || draft.config.spotifyUrl || '');
        draft.playback = {
          provider: 'spotify',
          intent: 'playing',
          label: this.spotify.current?.name || 'Spotify playlist',
          sourceUrl: playedSourceUrl,
          trackIndex: 0,
          musicLevelPercent: targetPercent,
          volumeMode: targetMode,
          scheduledItemId: String(scheduledItemId || ''),
          scheduledRunToken: String(scheduledRunToken || ''),
          scheduledFingerprint: scheduledRunToken
            ? scheduleItemFingerprint((getActiveSchedule(draft)?.items || []).find(item => String(item.id || '') === String(scheduledItemId || '')))
            : '',
          updatedAt: this.now(),
          volumeVerified: !!physical.result.volume?.verified,
          volumeVerifiedPercent: physical.result.volume?.verified ? physical.result.volume.verifiedPercent : null,
          volumeVerifiedAt: physical.result.volume?.verified ? this.now() : 0,
          audioPolicy: policy.id
        };
        draft.activityLog = [makeLog('play', physical.result.volume?.verified ? `Spotify playing at verified ${targetPercent}%` : 'Spotify playing in compatibility mode', policy.detail, this.now(), { provider: 'spotify', scheduledItemId: String(scheduledItemId || '') }), ...(draft.activityLog || [])];
        return draft;
      }, 'Spotify playback started', { requireDurable: true });
      this.assertReceiptCurrent(requestId, epoch, 'Spotify playback was superseded while its cloud receipt was committing.');
      this.physicalCommittedRequestId = requestId;
      this.rememberCommittedPlayback(requestId);
    } catch (error) {
      if (this.pendingScheduledPlayback?.requestId === requestId) this.pendingScheduledPlayback = null;
      let pauseError = '';
      let restoreError = '';
      await this.serializeAudio(async () => {
        const mustQuiet = this.physicalRequestId === requestId || this.audioRequestKind === 'safety' || this.audioRequestKind === 'terminal' || !this.isOwner();
        if (!mustQuiet) return;
        await this.spotify.pauseForAnnouncement().catch(caught => { pauseError = caught.message || String(caught); });
        this.applyConfiguredMusicTarget({ report: false, percent: previousTarget });
        if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
        this.physicalProvider = pauseError ? 'spotify' : '';
        if (!pauseError) {
          this.physicalRequestId = 0;
          this.physicalCommittedRequestId = 0;
        }
        const carriedToSafety = !pauseError && physical.controlledSnapshot && this.carrySafetyRestore({ provider: 'controlled', controlledSnapshot: { ...physical.controlledSnapshot, wasPlaying: true }, musicLevelPercent: previousTarget });
        if (!pauseError && !carriedToSafety && physical.controlledSnapshot && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
          try {
            const resumed = await this.audio.resumeMusic();
            if (!resumed && physical.controlledSnapshot.audioUrl) {
              await this.audio.playMusicUrl(physical.controlledSnapshot.audioUrl, {
                label: physical.controlledSnapshot.label,
                startAt: physical.controlledSnapshot.position,
                scheduledRunToken: physical.controlledSnapshot.scheduledRunToken
              });
            }
            this.physicalProvider = 'controlled';
          } catch (caught) {
            restoreError = caught.message || String(caught);
          }
        }
        const carriedAppleToSafety = !pauseError && physical.appleSnapshot?.wasPlaying && this.carrySafetyRestore({ provider: 'apple', appleSnapshot: physical.appleSnapshot, musicLevelPercent: previousTarget });
        if (!pauseError && !this.physicalProvider && !carriedAppleToSafety && physical.appleSnapshot?.wasPlaying && this.isOwner() && requestId === this.audioRequestId && epoch === this.audioEpoch) {
          try {
            await this.apple.resumeAfterAnnouncement(physical.appleSnapshot, {
              assertCurrent: () => this.assertAudioRequest(requestId, epoch)
            });
            this.physicalProvider = 'apple';
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
      throw new Error(`Spotify was stopped because its cloud state could not be saved: ${error.message}${pauseError ? ` Spotify pause confirmation failed: ${pauseError}` : ''}${restoreError ? ` Prior music restore failed: ${restoreError}` : ''}`);
    }
    if (this.pendingScheduledPlayback?.requestId === requestId) this.pendingScheduledPlayback = null;
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
      const appleMayBeAudible = provider === 'apple' || this.apple.ready || this.apple.current?.paused === false;
      if (appleMayBeAudible) await this.apple.pauseForAnnouncement();
      const spotifyMayBeAudible = provider === 'spotify' || this.spotify.ready || this.spotify.current?.paused === false;
      if (spotifyMayBeAudible) await this.spotify.pauseForAnnouncement();
      this.audio.pauseMusic();
      this.physicalMusicTarget = null;
      this.physicalRequestId = 0;
      this.physicalCommittedRequestId = 0;
      this.preemptedAppleMusicSnapshot = null;
      this.preemptedSpotifySnapshot = null;
      this.safetyRestoreSnapshot = null;
      this.assertTerminalRequest(requestId, 'A newer audio command replaced this pause after the source became quiet.');
      return { provider, positionMs };
    });
    await this.updatePlayback({ provider: physical.provider, intent: 'paused', positionMs: physical.positionMs }, 'Music paused');
    await this.failActiveOrderPlayback('The scheduled music was paused before its advance gate completed.');
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
      if (activeProvider === 'apple') {
        if (this.spotify.ready || this.spotify.current?.paused === false) {
          await this.spotify.pauseForAnnouncement();
          this.assertAudioRequest(requestId, epoch, 'Apple Music resume was superseded while Spotify was being silenced.');
        }
        this.audio.pauseMusic();
        try {
          resumed = await this.apple.resume({ assertCurrent: () => this.assertAudioRequest(requestId, epoch) });
        } catch (error) {
          if (requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner()) {
            try {
              await this.apple.pauseForAnnouncement();
            } catch (pauseError) {
              throw new Error(`Superseded Apple Music resume could not be confirmed paused: ${pauseError.message}`);
            }
          }
          throw error;
        }
      } else if (activeProvider === 'spotify') {
        if (this.apple.ready || this.apple.current?.paused === false) {
          await this.apple.pauseForAnnouncement();
          this.assertAudioRequest(requestId, epoch, 'Spotify resume was superseded while Apple Music was being silenced.');
        }
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
        if (this.apple.ready || this.apple.current?.paused === false) {
          await this.apple.pauseForAnnouncement();
          this.assertAudioRequest(requestId, epoch, 'Controlled resume was superseded while Apple Music was being silenced.');
        }
        if (this.spotify.ready || this.spotify.current?.paused === false) {
          await this.spotify.pauseForAnnouncement();
          this.assertAudioRequest(requestId, epoch, 'Controlled resume was superseded while Spotify was being silenced.');
        }
        this.applyConfiguredMusicTarget({ report: false });
        resumed = await this.audio.resumeMusic();
        if (!resumed && this.state.playback.audioUrl) {
          await this.audio.playMusicUrl(this.state.playback.audioUrl, {
            label: this.state.playback.label || 'Suno / direct audio',
            startAt: Number(this.state.playback.positionMs || 0) / 1000,
            scheduledRunToken: this.state.playback.scheduledRunToken
          });
          resumed = true;
        }
      }
      if (!resumed) throw new Error('There is no paused track to resume.');
      if (requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner()) {
        if (['apple', 'spotify'].includes(activeProvider)) {
          const player = activeProvider === 'spotify' ? this.spotify : this.apple;
          const name = activeProvider === 'spotify' ? 'Spotify' : 'Apple Music';
          await player.pauseForAnnouncement().catch(error => {
            throw new Error(`Receiver ownership changed while ${name} was resuming, and ${name} could not be confirmed paused: ${error.message}`);
          });
        } else this.audio.stopMusic();
        throw new Error('Music resume was superseded, so playback was stopped.');
      }
      this.physicalProvider = activeProvider;
      this.physicalRequestId = requestId;
      this.physicalMusicTarget = {
        requestId,
        mode: this.state.playback.volumeMode === 'custom' ? 'custom' : 'global',
        percent: this.currentMusicTarget(this.state.playback),
        provider: activeProvider
      };
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
        if (['apple', 'spotify'].includes(provider)) {
          const player = provider === 'spotify' ? this.spotify : this.apple;
          await player.pauseForAnnouncement().catch(caught => { pauseError = caught.message || String(caught); });
        } else this.audio.pauseMusic();
        if (!pauseError) {
          this.physicalProvider = provider;
          this.physicalRequestId = 0;
          this.physicalCommittedRequestId = 0;
          if (this.physicalMusicTarget?.requestId === requestId) this.physicalMusicTarget = null;
        }
      });
      if (error.code === 'AUDIO_RECEIPT_SUPERSEDED' && this.audioRequestKind === 'safety' && this.isOwner()) {
        await this.compensateSafetyReceipt(previousPlayback);
      } else if (error.code === 'AUDIO_RECEIPT_SUPERSEDED' && this.audioRequestKind === 'normal' && this.isOwner()) {
        await this.repairCurrentCommittedReceipt();
      }
      throw new Error(`Music was paused because its resume receipt could not be saved: ${error.message}${pauseError ? ` External-player pause confirmation failed: ${pauseError}` : ''}`);
    }
    return true;
  }

  async restorePlaybackIntent() {
    if (!this.isOwner() || this.state.playback.intent !== 'playing') return false;
    const playback = this.state.playback;
    if (playback.provider === 'apple') {
      if (!this.apple.ready) throw new Error('Apple Music receiver is not connected.');
      await this.playAppleMusic(playback.sourceUrl || this.state.config.appleUrl, {
        volumePercent: playback.musicLevelPercent,
        volumeMode: playback.volumeMode,
        scheduledItemId: playback.scheduledItemId,
        scheduledRunToken: playback.scheduledRunToken
      });
      return true;
    }
    if (playback.provider === 'spotify') {
      if (!this.spotify.ready) throw new Error('Spotify receiver is not connected.');
      await this.playSpotify(playback.sourceUrl || this.state.config.spotifyUrl, {
        volumePercent: playback.musicLevelPercent,
        volumeMode: playback.volumeMode,
        scheduledItemId: playback.scheduledItemId,
        scheduledRunToken: playback.scheduledRunToken
      });
      return true;
    }
    if (playback.audioUrl) {
      await this.resumeMusic();
      return true;
    }
    if (playback.sourceUrl || this.state.config.musicUrl) {
      await this.playControlled(playback.sourceUrl || this.state.config.musicUrl, {
        label: playback.label,
        index: Number(playback.trackIndex || 0),
        volumePercent: playback.musicLevelPercent,
        volumeMode: playback.volumeMode,
        scheduledItemId: playback.scheduledItemId,
        scheduledRunToken: playback.scheduledRunToken
      });
      return true;
    }
    return false;
  }

  async stopMusic({ skipOrderFailure = false } = {}) {
    const requestId = this.nextAudioRequest('terminal');
    this.invalidateAudioRestores();
    const provider = await this.serializeAudio(async () => {
      this.assertTerminalRequest(requestId);
      const activeProvider = this.physicalProvider || this.state.playback.provider || this.state.config.musicProvider;
      const appleMayBeAudible = activeProvider === 'apple' || this.apple.ready || this.apple.current?.paused === false;
      if (appleMayBeAudible) await this.apple.pauseForAnnouncement();
      const spotifyMayBeAudible = activeProvider === 'spotify' || this.spotify.ready || this.spotify.current?.paused === false;
      if (spotifyMayBeAudible) await this.spotify.pauseForAnnouncement();
      this.audio.stopMusic();
      this.physicalMusicTarget = null;
      this.physicalProvider = '';
      this.physicalRequestId = 0;
      this.physicalCommittedRequestId = 0;
      this.preemptedAppleMusicSnapshot = null;
      this.preemptedSpotifySnapshot = null;
      this.safetyRestoreSnapshot = null;
      this.assertTerminalRequest(requestId, 'A newer audio command replaced this stop after the source became quiet.');
      return activeProvider;
    });
    await this.updatePlayback({
      provider,
      intent: 'stopped',
      label: 'Nothing playing',
      scheduledItemId: '',
      scheduledRunToken: '',
      scheduledFingerprint: '',
      cancelScheduledRunToken: '',
      unavailableReason: ''
    }, 'Music stopped');
    if (!skipOrderFailure) await this.failActiveOrderPlayback('The scheduled music was stopped before its advance gate completed.');
    return true;
  }

  async reconcileScheduledPlaybackAuthorization() {
    if (!this.active || !this.isOwner()) return false;
    let reconciled = false;
    const currentScheduledAnnouncement = this.currentAnnouncement;
    if (currentScheduledAnnouncement?.options?.scheduledRunToken && !this.scheduledRunAuthorized(
      this.state,
      currentScheduledAnnouncement.options.scheduledRunToken,
      currentScheduledAnnouncement.options.scheduledItemId
    )) {
      currentScheduledAnnouncement.cancellation.cancelled = true;
      this.voicePrepareController?.abort('cancel');
      this.audio.stopVoice('Scheduled announcement stopped because its live schedule changed.');
      reconciled = true;
    }
    for (const job of this.announcementQueue) {
      if (job?.options?.scheduledRunToken && !this.scheduledRunAuthorized(this.state, job.options.scheduledRunToken, job.options.scheduledItemId)) {
        job.cancellation.cancelled = true;
        reconciled = true;
      }
    }
    const pending = this.pendingScheduledPlayback;
    if (pending?.token && !this.scheduledRunAuthorized(this.state, pending.token, pending.itemId)) {
      if (this.pendingScheduleCancellationInFlight === pending.token) return reconciled;
      this.pendingScheduleCancellationInFlight = pending.token;
      this.nextAudioRequest('terminal');
      this.invalidateAudioRestores();
      this.audio.stopMusic();
      try {
        if (pending.provider === 'apple') {
          try {
            await this.confirmAppleMusicPaused('The invalid scheduled Apple Music start could not be declared stopped.');
          } catch (error) {
            this.physicalProvider = 'apple';
            this.physicalRequestId = pending.requestId;
            const detail = String(error?.message || error || 'Apple Music silence was not confirmed.').slice(0, 700);
            await this.store.mutate(draft => {
              if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) return draft;
              draft.activityLog = [makeLog(
                'error',
                'Scheduled Apple Music cancellation could not confirm silence',
                detail,
                this.now(),
                {
                  scheduledItemId: pending.itemId,
                  errorCode: error?.code || 'APPLE_MUSIC_PAUSE_UNCONFIRMED',
                  errorOperation: error?.appleOperation || '',
                  appleReason: error?.appleReason || 'Apple Music silence was not confirmed'
                }
              ), ...(draft.activityLog || [])];
              return draft;
            }, 'Scheduled Apple Music pause failure recorded', { requireDurable: true }).catch(recordError => {
              this.status(`Apple Music silence was not confirmed, and the failure receipt could not be saved: ${recordError.message}`, false);
            });
            this.status(detail, false, {
              errorCode: error?.code || 'APPLE_MUSIC_PAUSE_UNCONFIRMED',
              errorOperation: error?.appleOperation || '',
              appleReason: error?.appleReason || ''
            });
            throw error;
          }
          this.physicalProvider = '';
          this.physicalRequestId = 0;
          this.physicalCommittedRequestId = 0;
          this.physicalMusicTarget = null;
        }
        if (pending.provider === 'spotify') {
          try {
            await this.confirmSpotifyPaused('The invalid scheduled Spotify start could not be declared stopped.');
          } catch (error) {
            this.physicalProvider = 'spotify';
            this.physicalRequestId = pending.requestId;
            const detail = String(error?.message || error || 'Spotify silence was not confirmed.').slice(0, 700);
            await this.store.mutate(draft => {
              if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) return draft;
              draft.activityLog = [makeLog(
                'error',
                'Scheduled Spotify cancellation could not confirm silence',
                detail,
                this.now(),
                {
                  scheduledItemId: pending.itemId,
                  errorCode: error?.code || 'SPOTIFY_PAUSE_UNCONFIRMED',
                  errorOperation: error?.spotifyOperation || '',
                  spotifyReason: error?.spotifyReason || 'Spotify silence was not confirmed'
                }
              ), ...(draft.activityLog || [])];
              return draft;
            }, 'Scheduled Spotify pause failure recorded', { requireDurable: true }).catch(recordError => {
              this.status(`Spotify silence was not confirmed, and the failure receipt could not be saved: ${recordError.message}`, false);
            });
            this.status(detail, false, {
              errorCode: error?.code || 'SPOTIFY_PAUSE_UNCONFIRMED',
              errorOperation: error?.spotifyOperation || '',
              spotifyReason: error?.spotifyReason || ''
            });
            throw error;
          }
          this.physicalProvider = '';
          this.physicalRequestId = 0;
          this.physicalCommittedRequestId = 0;
          this.physicalMusicTarget = null;
        }
        this.pendingScheduledPlayback = null;
        this.status('A pending scheduled start was stopped because its live schedule changed.', true);
        reconciled = true;
      } finally {
        if (this.pendingScheduleCancellationInFlight === pending.token) this.pendingScheduleCancellationInFlight = null;
      }
    }
    const playback = this.state.playback || {};
    const playbackToken = String(playback.scheduledRunToken || '');
    const explicitCancellation = String(playback.cancelScheduledRunToken || '') === playbackToken;
    const authorizationLost = !!playbackToken && !this.scheduledRunAuthorized(this.state, playbackToken, playback.scheduledItemId);
    if (!playbackToken || (!explicitCancellation && !authorizationLost)) return reconciled;
    if (this.scheduleCancellationInFlight === playbackToken) return reconciled;
    this.scheduleCancellationInFlight = playbackToken;
    this.beginExternalAudioIntent('terminal');
    try {
      await this.stopMusic({ skipOrderFailure: true });
      this.status('Scheduled playback stopped because its live schedule changed.', true);
      return true;
    } finally {
      if (this.scheduleCancellationInFlight === playbackToken) this.scheduleCancellationInFlight = null;
    }
  }

  async nextMusic({ automatic = false, expectedUrl = '', postSafety = false, externalIntentGeneration = null } = {}) {
    this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command replaced this deferred next-track action.');
    if (automatic && (this.safetyPendingCount > 0 || this.currentAnnouncement?.safety || this.announcementQueue.some(job => job.safety))) {
      this.deferredAutomaticNext = {
        expectedUrl: String(expectedUrl || ''),
        externalIntentGeneration: this.externalAudioIntentGeneration
      };
      return false;
    }
    if (!automatic) this.assertNoSafetyPending();
    if (!automatic) await this.failActiveOrderPlayback('The scheduled music was manually skipped before its advance gate completed.');
    const requestId = automatic && !postSafety ? this.audioRequestId : this.nextAudioRequest();
    const epoch = automatic && !postSafety ? this.audioEpoch : this.invalidateAudioRestores();
    const previousPlayback = structuredClone(this.state.playback || {});
    const physical = await this.serializeAudio(async () => {
      this.assertAudioRequest(requestId, epoch);
      const playback = this.state.playback || {};
      const provider = this.physicalProvider || playback.provider || this.state.config.musicProvider;
      if (automatic && (provider !== 'controlled' || playback.intent !== 'playing' || (expectedUrl && playback.audioUrl !== expectedUrl))) return null;
      if (provider === 'apple') {
      if (this.spotify.ready || this.spotify.current?.paused === false) {
        await this.spotify.pauseForAnnouncement();
        this.assertAudioRequest(requestId, epoch, 'Apple Music skip was superseded while Spotify was being silenced.');
      }
      this.audio.pauseMusic();
      let state;
      try {
        state = await this.apple.next({ assertCurrent: () => this.assertAudioRequest(requestId, epoch) });
      } catch (error) {
        if (requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner()) {
          try {
            await this.apple.pauseForAnnouncement();
          } catch (pauseError) {
            throw new Error(`Superseded Apple Music skip could not be confirmed paused: ${pauseError.message}`);
          }
        }
        throw error;
      }
      if (requestId !== this.audioRequestId || epoch !== this.audioEpoch || !this.isOwner()) {
        try {
          await this.apple.pauseForAnnouncement();
        } catch (pauseError) {
          throw new Error(`Superseded Apple Music skip could not be confirmed paused: ${pauseError.message}`);
        }
        throw new Error('A newer audio command replaced this Apple Music skip.');
      }
      const label = state?.name
        ? `${state.name}${state.artists ? ` - ${state.artists}` : ''}`
        : (this.apple.current?.name || 'Apple Music next track');
      this.physicalProvider = 'apple';
      this.physicalRequestId = requestId;
        return { provider, patch: { provider: 'apple', intent: 'playing', label, positionMs: Number(state?.position || 0), unavailableReason: '' }, title: 'Apple Music skipped' };
      }
      if (provider === 'spotify') {
      if (this.apple.ready || this.apple.current?.paused === false) {
        await this.apple.pauseForAnnouncement();
        this.assertAudioRequest(requestId, epoch, 'Spotify skip was superseded while Apple Music was being silenced.');
      }
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
      if (this.apple.ready || this.apple.current?.paused === false) {
        await this.apple.pauseForAnnouncement();
        this.assertAudioRequest(requestId, epoch, 'Controlled skip was superseded while Apple Music was being silenced.');
      }
      if (this.spotify.ready || this.spotify.current?.paused === false) {
        await this.spotify.pauseForAnnouncement();
        this.assertAudioRequest(requestId, epoch, 'Controlled skip was superseded while Spotify was being silenced.');
      }
      this.applyConfiguredMusicTarget({ report: false });
      const nextIndex = (Number(playback.trackIndex || 0) + 1) % tracks.length;
      const track = tracks[nextIndex];
      await this.audio.playMusicUrl(track.audioUrl, { label: track.title, loop: tracks.length === 1, scheduledRunToken: playback.scheduledRunToken });
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
        if (['apple', 'spotify'].includes(physical.provider)) {
          const player = physical.provider === 'spotify' ? this.spotify : this.apple;
          await player.pauseForAnnouncement().catch(caught => { pauseError = caught.message || String(caught); });
        } else this.audio.pauseMusic();
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
      throw new Error(`The skipped track was paused because its cloud receipt could not be saved: ${error.message}${pauseError ? ` External-player pause confirmation failed: ${pauseError}` : ''}`);
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
    const schedule = getActiveSchedule(this.state);
    const run = schedule?.mode === 'order' ? normalizeSequenceRun(this.state.sequenceRuns?.[schedule.id]) : null;
    const orderToken = ['waiting-track-end', 'waiting-duration'].includes(run?.status) && run.active?.token === this.state.playback.scheduledRunToken
      ? run.active.token
      : '';
    await this.updatePlayback({ intent: 'paused', unavailableReason: reason }, 'Controlled playback paused');
    if (orderToken) {
      await this.serializeOrder(() => this.failOrderStep(schedule.id, orderToken, new Error(reason)));
    }
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

  async prepareVoice(text, { cacheOnly = false, signal = null } = {}) {
    const message = String(text || '').trim().slice(0, 900);
    if (!message || this.state.config.voiceMode !== 'ai') return null;
    const voice = this.state.config.aiVoice || 'marin';
    const cacheKey = `${voice}\0${message}`;
    if (this.voiceCache.has(cacheKey)) return this.voiceCache.get(cacheKey);
    if (cacheOnly) return null;
    const controller = new AbortController();
    const abortFromSignal = () => {
      if (!controller.signal.aborted) controller.abort(signal?.reason || 'cancel');
    };
    if (signal?.aborted) abortFromSignal();
    else signal?.addEventListener?.('abort', abortFromSignal, { once: true });
    this.voicePrepareController = controller;
    const timer = setTimeout(() => controller.abort('timeout'), 13_000);
    try {
      const response = await fetch('/api/tts?v=x', {
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
      signal?.removeEventListener?.('abort', abortFromSignal);
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
    const volumePercent = clamp(
      options.volumePercent === null || options.volumePercent === undefined
        ? this.state.config.voiceLevel
        : options.volumePercent,
      0,
      100,
      VOICE_LEVEL_PERCENT
    );
    return await new Promise((resolve, reject) => {
      const cancellation = { cancelled: false };
      const jobOptions = { ...options, volumePercent, cancellation };
      const job = { message, options: jobOptions, cancellation, safety: !!options.safety, resolve, reject };
      if (job.safety) {
        const safetyIntentGeneration = this.beginExternalAudioIntent('safety');
        const activeSchedule = getActiveSchedule(this.state);
        const activeRun = activeSchedule?.mode === 'order'
          ? normalizeSequenceRun(this.state.sequenceRuns?.[activeSchedule.id])
          : null;
        if (['waiting-duration', 'waiting-track-end'].includes(activeRun?.status) && activeRun?.active?.token && this.state.playback?.scheduledRunToken === activeRun.active.token) {
          this.orderIntentGenerations.set(activeRun.active.token, safetyIntentGeneration);
        }
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
      if (this.safetyPendingCount === 0 && !this.currentAnnouncement && this.active && this.isOwner()) {
        const deferredEnd = this.deferredControlledTrackEnd;
        const deferredNext = this.deferredAutomaticNext;
        this.deferredControlledTrackEnd = null;
        this.deferredAutomaticNext = null;
        if (deferredEnd) {
          queueMicrotask(() => this.handleControlledTrackEnded(deferredEnd)
            .catch(error => this.status(`Deferred scheduled track completion failed: ${error.message}`, false)));
        } else if (deferredNext && deferredNext.externalIntentGeneration === this.externalAudioIntentGeneration) {
          queueMicrotask(() => this.nextMusic({
            automatic: true,
            expectedUrl: deferredNext.expectedUrl,
            postSafety: true,
            externalIntentGeneration: deferredNext.externalIntentGeneration
          })
            .catch(error => this.status(`Deferred next track failed: ${error.message}`, false)));
        }
      }
    }
  }

  cancelPendingAnnouncements(reason = 'Announcement cancelled.') {
    this.voicePrepareController?.abort('cancel');
    this.preemptedAppleMusicSnapshot = null;
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
    this.assertScheduledRunAuthorization(this.state, options?.scheduledRunToken, options?.scheduledItemId);
  }

  async performAnnouncement(message, options = {}) {
    this.assertAnnouncementActive(options, 'Announcement was cancelled before voice preparation.');
    const voiceBlob = await this.prepareVoice(message, { cacheOnly: !!options.safety });
    const voiceOutput = voiceBlob ? 'ai-mixer' : 'device-speech-fallback';
    const voicePercent = clamp(options.volumePercent, 0, 100, this.state.config.voiceLevel);
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
    let appleSnapshot = null;
    let spotifySnapshot = null;
    let controlledDucked = false;
    const previousVoicePercent = clamp(this.audio.status?.().voiceLevelPercent, 0, 100, this.state.config.voiceLevel);
    let voiceTargetApplied = false;
    const applePauseHeld = provider === 'apple' || !!this.apple.ready;
    const spotifyPauseHeld = provider === 'spotify' || !!this.spotify.ready;
    if (applePauseHeld) this.beginTemporaryAppleMusicPause();
    if (spotifyPauseHeld) this.beginTemporarySpotifyPause();
    try {
      if (provider === 'apple') {
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
        try {
          appleSnapshot = await this.apple.pauseForAnnouncement();
        } catch (error) {
          await this.apple.pause().catch(() => {});
          throw new Error(`Announcement was not played because Apple Music could not be confirmed paused: ${error.message || String(error)}`);
        }
        this.assertAnnouncementActive(options, 'Announcement was preempted while Apple Music was pausing.');
      } else if (provider === 'spotify') {
        if (this.apple.ready) {
          try {
            const unexpected = await this.apple.pauseForAnnouncement();
            if (unexpected.wasPlaying) this.status('Unexpected local Apple Music playback was paused before the announcement and will not be resumed.', false);
          } catch (error) {
            await this.apple.pause().catch(() => {});
            throw new Error(`Announcement was not played because local Apple Music silence could not be confirmed: ${error.message || String(error)}`);
          }
          this.assertAnnouncementActive(options, 'Announcement was preempted while checking the local Apple Music receiver.');
        }
        try {
          spotifySnapshot = await this.spotify.pauseForAnnouncement();
        } catch (error) {
          await this.spotify.pause().catch(() => {});
          throw new Error(`Announcement was not played because Spotify could not be confirmed paused: ${error.message || String(error)}`);
        }
        this.assertAnnouncementActive(options, 'Announcement was preempted while Spotify was pausing.');
      } else {
        if (this.apple.ready) {
          try {
            const unexpected = await this.apple.pauseForAnnouncement();
            if (unexpected.wasPlaying) this.status('Unexpected local Apple Music playback was paused before the announcement and will not be resumed.', false);
          } catch (error) {
            await this.apple.pause().catch(() => {});
            throw new Error(`Announcement was not played because local Apple Music silence could not be confirmed: ${error.message || String(error)}`);
          }
          this.assertAnnouncementActive(options, 'Announcement was preempted while checking the local Apple Music receiver.');
        }
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
      this.audio.setVoiceLevelPercent?.(voicePercent, { report: false });
      voiceTargetApplied = true;
      if (voiceBlob) await this.audio.playVoiceBlob(voiceBlob);
      else await this.audio.playDeviceSpeech(message);
      this.assertAnnouncementActive(options, 'Announcement was cancelled before speech completed.');
      return true;
    } finally {
      if (voiceTargetApplied) this.audio.setVoiceLevelPercent?.(previousVoicePercent, { report: false });
      const chainedSafety = !!options.safety && announcementEpoch !== this.audioEpoch && this.safetyPendingCount > 1;
      const carriedSafetyRestore = options.safety && this.safetyRestoreSnapshot?.epoch === announcementEpoch
        ? this.safetyRestoreSnapshot
        : null;
      if (provider === 'apple') {
        const safetyPreemptionCurrent = options?.cancellation?.preemptedBySafety &&
          (announcementEpoch === this.audioEpoch || options.cancellation.safetyEpoch === this.audioEpoch);
        if (safetyPreemptionCurrent && this.active && this.isOwner() && appleSnapshot?.wasPlaying) {
          this.preemptedAppleMusicSnapshot = appleSnapshot;
        } else {
          if (chainedSafety && appleSnapshot?.wasPlaying) this.preemptedAppleMusicSnapshot = appleSnapshot;
          const currentSnapshot = (!options.safety || bedCommitted) && appleSnapshot?.wasPlaying ? appleSnapshot : null;
          const resumeSnapshot = currentSnapshot
            ? currentSnapshot
            : (options.safety
                ? (carriedSafetyRestore?.provider === 'apple'
                    ? carriedSafetyRestore.appleSnapshot
                    : this.preemptedAppleMusicSnapshot)
                : null);
          if (options.safety && !chainedSafety) this.preemptedAppleMusicSnapshot = null;
          const mayResume = announcementEpoch === this.audioEpoch && !options?.cancellation?.cancelled && this.active && this.isOwner();
          if (mayResume && resumeSnapshot?.wasPlaying) {
            if (Number.isFinite(Number(carriedSafetyRestore?.musicLevelPercent))) {
              this.applyConfiguredMusicTarget({ report: false, percent: carriedSafetyRestore.musicLevelPercent });
            }
            await this.apple.resumeAfterAnnouncement(resumeSnapshot, {
              assertCurrent: () => {
                if (announcementEpoch !== this.audioEpoch || !this.active || !this.isOwner()) {
                  throw new Error('Announcement restore was superseded.');
                }
              }
            }).then(() => { this.physicalProvider = 'apple'; }).catch(error => this.status(`Announcement finished; Apple Music resume failed: ${error.message}`, false));
          }
        }
      } else if (provider === 'spotify') {
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
            if (Number.isFinite(Number(carriedSafetyRestore?.musicLevelPercent))) {
              this.applyConfiguredMusicTarget({ report: false, percent: carriedSafetyRestore.musicLevelPercent });
            }
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
          if (Number.isFinite(Number(carriedSafetyRestore.musicLevelPercent))) {
            this.applyConfiguredMusicTarget({ report: false, percent: carriedSafetyRestore.musicLevelPercent });
          }
          await this.audio.playMusicUrl(snapshot.audioUrl, {
            label: snapshot.label,
            startAt: snapshot.position,
            scheduledRunToken: snapshot.scheduledRunToken
          }).then(() => { this.physicalProvider = 'controlled'; }).catch(error => this.status(`Safety announcement finished; controlled music restore failed: ${error.message}`, false));
        }
      }
      if (options.safety && !chainedSafety && this.safetyRestoreSnapshot?.epoch === announcementEpoch) this.safetyRestoreSnapshot = null;
      if (applePauseHeld) this.endTemporaryAppleMusicPause();
      if (spotifyPauseHeld) this.endTemporarySpotifyPause();
    }
    });
    this.store.mutate(draft => {
        if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
          throw new Error('Receiver ownership changed before the announcement receipt could be saved.');
        }
        const voiceReceipt = voiceOutput === 'ai-mixer'
          ? `Version X mixer voice ${voicePercent}%`
          : `device speech requested target ${voicePercent}%`;
        draft.activityLog = [makeLog(options.safety ? 'safety' : 'announcement', options.label || (options.safety ? 'Safety announcement played' : 'Announcement played'), `${message} [${voiceReceipt}]`, this.now(), { eventId: options.eventId || '', voicePercent, voiceOutput }), ...(draft.activityLog || [])];
        return draft;
      }, 'Announcement completed', { requireDurable: true })
      .then(() => this.status(
        voiceOutput === 'ai-mixer'
          ? `Announcement completed through the Version X mixer at the ${voicePercent}% voice setting.`
          : `Announcement completed through device speech with a requested ${voicePercent}% target; iPhone speaker loudness cannot be verified in browser code.`,
        true
      ))
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

  clearOrderWake(scheduleId) {
    const timer = this.orderWakeTimers.get(scheduleId);
    if (timer) clearTimeout(timer);
    this.orderWakeTimers.delete(scheduleId);
  }

  armOrderWake(scheduleId, dueAt) {
    this.clearOrderWake(scheduleId);
    const delay = Math.max(0, Number(dueAt || 0) - this.now());
    if (!Number.isFinite(delay)) return;
    const timer = setTimeout(() => {
      this.orderWakeTimers.delete(scheduleId);
      this.tickOrderSchedule().catch(error => this.status(`Order schedule could not advance: ${error.message}`, false));
    }, Math.min(delay, 2_147_000_000));
    this.orderWakeTimers.set(scheduleId, timer);
  }

  async claimOrderItem(scheduleId, trigger = {}, externalIntentGeneration = null) {
    this.assertExternalAudioIntent(externalIntentGeneration);
    let claim = null;
    await this.store.mutate(draft => {
      claim = null;
      this.assertExternalAudioIntent(externalIntentGeneration);
      if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
        throw new Error('Receiver ownership changed before the Order item could be claimed.');
      }
      const schedule = getActiveSchedule(draft);
      if (!schedule || schedule.id !== scheduleId || schedule.mode !== 'order' || schedule.enabled === false) {
        throw new Error('That Order schedule is not the live enabled schedule.');
      }
      const run = normalizeSequenceRun(draft.sequenceRuns?.[scheduleId]);
      if (run.lastTriggerId && run.lastTriggerId === trigger.id) {
        if (run.lastOutcome === 'failed') throw new Error(run.lastError || 'This Order request already failed and was not replayed.');
        claim = { duplicate: true, status: run.status };
        return draft;
      }
      if (run.active) throw new Error('The receiver is already completing an Order item.');
      if (trigger.kind === 'manual') {
        if (run.status === 'complete') throw new Error('This Order schedule is complete. Reset it before starting again.');
        if (['waiting-duration', 'waiting-track-end', 'auto-pending', 'claiming'].includes(run.status)) {
          throw new Error('This Order schedule is already waiting to advance automatically.');
        }
        const expectedOrder = Number(trigger.expectedOrder ?? run.order);
        const expectedItemId = String(trigger.expectedItemId ?? run.itemId);
        if (expectedOrder !== Number(run.order) || expectedItemId !== String(run.itemId || '')) {
          throw new Error('The Order position changed before this request arrived. Refresh and tap Play Next again.');
        }
      } else if (run.status !== 'auto-pending') {
        claim = { duplicate: true, status: run.status };
        return draft;
      }
      const item = nextOrderScheduleItem(schedule, run.order);
      const now = this.now();
      if (!item) {
        draft.sequenceRuns = {
          ...(draft.sequenceRuns || {}),
          [scheduleId]: {
            ...run,
            status: 'complete',
            active: null,
            lastTriggerId: String(trigger.id || ''),
            lastOutcome: 'committed',
            lastError: '',
            updatedAt: now
          }
        };
        claim = { complete: true, status: 'complete' };
        return draft;
      }
      const token = String(trigger.id || makeId('order-step', now));
      const kind = item.action?.kind || item.type || 'announcement';
      const advanceMode = kind === 'announcement' ? 'complete' : (item.advance?.mode || 'manual');
      const active = {
        token,
        triggerId: String(trigger.id || token),
        itemId: item.id,
        fingerprint: scheduleItemFingerprint(item),
        order: Number(item.position?.order || item.order || 0),
        kind,
        advanceMode,
        receiverId: this.deviceId,
        sessionId: this.sessionId,
        claimedAt: now,
        startedAt: 0,
        dueAt: 0,
        expectedProvider: '',
        expectedUrl: ''
      };
      draft.sequenceRuns = {
        ...(draft.sequenceRuns || {}),
        [scheduleId]: {
          ...run,
          status: 'claiming',
          active,
          lastTriggerId: active.triggerId,
          lastOutcome: 'pending',
          lastError: '',
          updatedAt: now
        }
      };
      claim = { scheduleId, scheduleName: schedule.name, item: structuredClone(item), token, active, externalIntentGeneration };
      return draft;
    }, 'Order item claimed', { requireDurable: true });
    if (claim?.item) {
      this.orderIntentGenerations.set(claim.token, externalIntentGeneration);
      try {
        this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command replaced this Order claim before it could start.');
      } catch (error) {
        await this.failOrderStep(scheduleId, claim.token, error).catch(() => {});
        throw error;
      }
      const saved = normalizeSequenceRun(this.state.sequenceRuns?.[scheduleId]);
      if (saved.active?.token !== claim.token || saved.active?.sessionId !== this.sessionId) {
        throw new Error('The Order claim changed before audio could start.');
      }
    } else {
      this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command replaced this Order request.');
    }
    return claim;
  }

  async setOrderWaiting(scheduleId, token, { status, dueAt = 0, expectedProvider = '', expectedUrl = '', externalIntentGeneration = this.orderIntentGenerations.get(token) } = {}) {
    this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command cancelled this Order advance gate.');
    let saved = false;
    await this.store.mutate(draft => {
      saved = false;
      this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command cancelled this Order advance gate.');
      const run = normalizeSequenceRun(draft.sequenceRuns?.[scheduleId]);
      if (run.active?.token !== token || run.active?.sessionId !== this.sessionId) return draft;
      const now = this.now();
      draft.sequenceRuns = {
        ...(draft.sequenceRuns || {}),
        [scheduleId]: {
          ...run,
          status,
          active: {
            ...run.active,
            startedAt: run.active.startedAt || now,
            dueAt: Math.max(0, Number(dueAt || 0)),
            expectedProvider: String(expectedProvider || ''),
            expectedUrl: String(expectedUrl || '')
          },
          lastOutcome: 'armed',
          updatedAt: now
        }
      };
      saved = true;
      return draft;
    }, 'Order advance gate armed', { requireDurable: true });
    this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command cancelled this Order advance gate.');
    const authoritative = normalizeSequenceRun(this.state.sequenceRuns?.[scheduleId]);
    if (!saved || authoritative.active?.token !== token || authoritative.active?.sessionId !== this.sessionId || authoritative.status !== status) {
      throw new Error('The Order item was replaced before its advance gate could be saved.');
    }
    if (status === 'waiting-duration') this.armOrderWake(scheduleId, dueAt);
    return true;
  }

  async completeOrderGate(scheduleId, token, nextStatus, outcome, externalIntentGeneration = this.orderIntentGenerations.get(token)) {
    this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command cancelled this Order item before its position could advance.');
    let status = '';
    let committedOrder = 0;
    let committedItemId = '';
    await this.store.mutate(draft => {
      status = '';
      committedOrder = 0;
      committedItemId = '';
      this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command cancelled this Order item before its position could advance.');
      const schedule = getActiveSchedule(draft);
      const run = normalizeSequenceRun(draft.sequenceRuns?.[scheduleId]);
      if (!schedule || schedule.id !== scheduleId || run.active?.token !== token || run.active?.sessionId !== this.sessionId) return draft;
      const active = run.active;
      const hasNext = !!nextOrderScheduleItem(schedule, active.order);
      status = hasNext ? nextStatus : 'complete';
      committedOrder = active.order;
      committedItemId = active.itemId;
      draft.sequenceRuns = {
        ...(draft.sequenceRuns || {}),
        [scheduleId]: {
          ...run,
          order: active.order,
          itemId: active.itemId,
          status,
          active: null,
          lastOutcome: 'committed',
          lastError: '',
          updatedAt: this.now()
        }
      };
      draft.activityLog = [makeLog('schedule', 'Order item confirmed', `${active.order}. ${active.itemId} · ${outcome}`, this.now(), { scheduleId, itemId: active.itemId, orderToken: token }), ...(draft.activityLog || [])];
      return draft;
    }, 'Order item confirmed', { requireDurable: true });
    this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command cancelled this Order item before its position could advance.');
    const authoritative = normalizeSequenceRun(this.state.sequenceRuns?.[scheduleId]);
    if (!status || authoritative.active || authoritative.status !== status || authoritative.order !== committedOrder || authoritative.itemId !== committedItemId || authoritative.lastOutcome !== 'committed') {
      throw new Error('The Order item was cancelled before its completion could be recorded.');
    }
    this.orderIntentGenerations.delete(token);
    this.clearOrderWake(scheduleId);
    return status;
  }

  async failOrderStep(scheduleId, token, error) {
    this.clearOrderWake(scheduleId);
    let failed = false;
    await this.store.mutate(draft => {
      failed = false;
      const run = normalizeSequenceRun(draft.sequenceRuns?.[scheduleId]);
      if (run.active?.token !== token) return draft;
      const message = String(error?.message || error || 'Order item failed.').slice(0, 300);
      draft.sequenceRuns = {
        ...(draft.sequenceRuns || {}),
        [scheduleId]: {
          ...run,
          status: 'failed',
          active: null,
          lastOutcome: 'failed',
          lastError: message,
          updatedAt: this.now()
        }
      };
      draft.activityLog = [makeLog('error', 'Order item failed', message, this.now(), { scheduleId, orderToken: token }), ...(draft.activityLog || [])];
      failed = true;
      return draft;
    }, 'Order item failure recorded', { requireDurable: true });
    this.orderIntentGenerations.delete(token);
    return failed;
  }

  async cancelAutoPendingOrder(scheduleId, reason) {
    let cancelled = false;
    await this.store.mutate(draft => {
      cancelled = false;
      const run = normalizeSequenceRun(draft.sequenceRuns?.[scheduleId]);
      if (run.status !== 'auto-pending' || run.active) return draft;
      const message = String(reason || 'The pending Order continuation was cancelled.').slice(0, 300);
      draft.sequenceRuns = {
        ...(draft.sequenceRuns || {}),
        [scheduleId]: {
          ...run,
          status: 'failed',
          active: null,
          lastOutcome: 'failed',
          lastError: message,
          updatedAt: this.now()
        }
      };
      draft.activityLog = [makeLog('schedule', 'Pending Order continuation cancelled', message, this.now(), { scheduleId }), ...(draft.activityLog || [])];
      cancelled = true;
      return draft;
    }, 'Pending Order continuation cancelled', { requireDurable: true });
    return cancelled;
  }

  async failActiveOrderPlayback(reason) {
    const schedule = getActiveSchedule(this.state);
    if (!schedule || schedule.mode !== 'order') return false;
    const run = normalizeSequenceRun(this.state.sequenceRuns?.[schedule.id]);
    if (!['waiting-duration', 'waiting-track-end'].includes(run.status) || !run.active?.token) return false;
    return await this.serializeOrder(() => this.failOrderStep(schedule.id, run.active.token, new Error(reason)));
  }

  async executeOrderItem(claim) {
    const { scheduleId, item, token } = claim;
    const externalIntentGeneration = claim.externalIntentGeneration ?? this.orderIntentGenerations.get(token);
    this.assertExternalAudioIntent(externalIntentGeneration);
    const kind = item.action?.kind || item.type || 'announcement';
    const advanceMode = kind === 'announcement' ? 'complete' : (item.advance?.mode || 'manual');
    if (kind === 'announcement') {
      const resolved = resolveScheduleAnnouncementText(item, this.state.announcements);
      const announcementId = item.action?.announcementId || item.announcementId || '';
      const text = item.action?.announcementSource === 'inline'
        ? resolved
        : safetyAnnouncementText(announcementId, resolved, this.state.config);
      if (!text) throw new Error('This Order announcement has no text.');
      this.assertExternalAudioIntent(externalIntentGeneration);
      await this.announce(text, {
        label: item.label,
        scheduledItemId: item.id,
        scheduledRunToken: token,
        volumePercent: effectiveScheduleItemVolume(item, this.state.config)
      });
      this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command cancelled this Order announcement before its position could advance.');
      const status = await this.completeOrderGate(scheduleId, token, 'auto-pending', 'announcement completed', externalIntentGeneration);
      return { continue: status === 'auto-pending', status };
    }

    const url = String(item.action?.url || item.url || '').trim();
    if (!url) throw new Error('This Order music item has no source URL.');
    if (['apple', 'spotify'].includes(kind) && advanceMode === 'track-end') {
      throw new Error(`${kind === 'spotify' ? 'Spotify' : 'Apple Music'} does not provide a schedule-safe track-end event. Choose Manual, Duration, or Immediately after start.`);
    }
    const volumePercent = effectiveScheduleItemVolume(item, this.state.config);
    this.assertExternalAudioIntent(externalIntentGeneration);
    if (kind === 'apple') {
      await this.playAppleMusic(url, {
        volumePercent,
        volumeMode: item.volume?.mode,
        scheduledItemId: item.id,
        scheduledRunToken: token
      });
    } else if (kind === 'spotify') {
      await this.playSpotify(url, {
        volumePercent,
        volumeMode: item.volume?.mode,
        scheduledItemId: item.id,
        scheduledRunToken: token
      });
    } else {
      await this.playControlled(url, {
        label: item.label,
        volumePercent,
        volumeMode: item.volume?.mode,
        scheduledItemId: item.id,
        scheduledRunToken: token,
        loop: advanceMode === 'track-end' ? false : null
      });
    }
    this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command replaced this Order item while playback was starting.');

    if (advanceMode === 'duration') {
      const durationSeconds = clamp(item.advance?.durationSeconds, 1, 86_400, 300);
      const dueAt = this.now() + durationSeconds * 1000;
      await this.setOrderWaiting(scheduleId, token, {
        status: 'waiting-duration',
        dueAt,
        expectedProvider: kind,
        expectedUrl: kind === 'controlled' ? String(this.state.playback.audioUrl || '') : url,
        externalIntentGeneration
      });
      return { continue: false, status: 'waiting-duration' };
    }
    if (advanceMode === 'track-end') {
      await this.setOrderWaiting(scheduleId, token, {
        status: 'waiting-track-end',
        expectedProvider: 'controlled',
        expectedUrl: String(this.state.playback.audioUrl || ''),
        externalIntentGeneration
      });
      return { continue: false, status: 'waiting-track-end' };
    }
    const nextStatus = advanceMode === 'complete' ? 'auto-pending' : 'waiting-manual';
    const status = await this.completeOrderGate(scheduleId, token, nextStatus, 'playback start confirmed', externalIntentGeneration);
    return { continue: status === 'auto-pending', status };
  }

  async runOrderChain(scheduleId, trigger, externalIntentGeneration = null) {
    let currentTrigger = trigger;
    for (let steps = 0; steps < 100; steps += 1) {
      this.assertExternalAudioIntent(externalIntentGeneration);
      const claim = await this.claimOrderItem(scheduleId, currentTrigger, externalIntentGeneration);
      if (!claim?.item) return claim?.status !== 'failed';
      try {
        const result = await this.executeOrderItem(claim);
        this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command stopped this Order chain before the next item.');
        if (!result.continue) return true;
      } catch (error) {
        if (this.state.playback?.scheduledRunToken === claim.token) {
          await this.stopMusic({ skipOrderFailure: true }).catch(() => {});
        }
        const failedActive = await this.failOrderStep(scheduleId, claim.token, error).catch(() => false);
        if (!failedActive) await this.cancelAutoPendingOrder(scheduleId, error.message || String(error)).catch(() => {});
        throw error;
      }
      currentTrigger = { id: makeId('order-auto', this.now()), kind: 'automatic' };
    }
    throw new Error('Order schedule stopped at its 100-item safety limit.');
  }

  async requestOrderNext(event, externalIntentGeneration = null) {
    const payload = event?.payload || {};
    const scheduleId = String(payload.scheduleId || '');
    if (!scheduleId) throw new Error('Order schedule ID is missing.');
    const intentGeneration = externalIntentGeneration ?? this.beginExternalAudioIntent('schedule');
    return await this.serializeOrder(() => this.runOrderChain(scheduleId, {
      id: String(event.id || makeId('order-manual', this.now())),
      kind: 'manual',
      expectedOrder: Number(payload.expectedOrder || 0),
      expectedItemId: String(payload.expectedItemId || '')
    }, intentGeneration));
  }

  async resetOrderSchedule(event, externalIntentGeneration = null) {
    const scheduleId = String(event?.payload?.scheduleId || '');
    if (!scheduleId) throw new Error('Order schedule ID is missing.');
    const intentGeneration = externalIntentGeneration ?? this.beginExternalAudioIntent('terminal');
    this.assertExternalAudioIntent(intentGeneration, 'A newer command replaced this Order reset.');
    const selectedSchedule = (this.state.schedules || []).find(schedule => schedule.id === scheduleId);
    const scheduledItemIds = new Set((selectedSchedule?.items || []).map(item => String(item.id || '')));
    const scheduledPlayback = this.state.playback || {};
    if (scheduledPlayback.scheduledRunToken && scheduledItemIds.has(String(scheduledPlayback.scheduledItemId || ''))) {
      await this.stopMusic({ skipOrderFailure: true });
    }
    return await this.serializeOrder(async () => {
      this.clearOrderWake(scheduleId);
      let cancelledToken = '';
      await this.store.mutate(draft => {
        cancelledToken = '';
        if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
          throw new Error('Receiver ownership changed before the Order schedule could reset.');
        }
        const schedule = getActiveSchedule(draft);
        if (!schedule || schedule.id !== scheduleId || schedule.mode !== 'order') throw new Error('That Order schedule is not live.');
        const previous = normalizeSequenceRun(draft.sequenceRuns?.[scheduleId]);
        cancelledToken = String(previous.active?.token || '');
        draft.sequenceRuns = {
          ...(draft.sequenceRuns || {}),
          [scheduleId]: {
            ...normalizeSequenceRun(null),
            status: 'idle',
            lastTriggerId: String(event.id || ''),
            lastOutcome: 'cancelled',
            lastError: previous.active ? 'The prior Order advance was cancelled by Reset.' : '',
            updatedAt: this.now()
          }
        };
        return draft;
      }, 'Order schedule reset', { requireDurable: true });
      if (cancelledToken) this.orderIntentGenerations.delete(cancelledToken);
      return true;
    });
  }

  async finishPendingOrderGate(scheduleId, token, outcome, { endedEvent = false } = {}) {
    const run = normalizeSequenceRun(this.state.sequenceRuns?.[scheduleId]);
    if (run.active?.token !== token) return false;
    const externalIntentGeneration = this.orderIntentGenerations.get(token);
    try {
      this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command cancelled this pending Order advance.');
    } catch (error) {
      await this.failOrderStep(scheduleId, token, error);
      throw error;
    }
    const playback = this.state.playback || {};
    const providerMatches = !run.active.expectedProvider || playback.provider === run.active.expectedProvider;
    const urlMatches = run.active.expectedProvider !== 'controlled' || !run.active.expectedUrl || playback.audioUrl === run.active.expectedUrl;
    const intentMatches = playback.intent === 'playing' || (endedEvent && playback.intent === 'paused');
    if (!intentMatches || playback.scheduledRunToken !== token || playback.scheduledItemId !== run.active.itemId || !providerMatches || !urlMatches) {
      const error = new Error('The scheduled music was stopped or replaced before its advance gate completed.');
      await this.failOrderStep(scheduleId, token, error);
      throw error;
    }
    const status = await this.completeOrderGate(scheduleId, token, 'auto-pending', outcome, externalIntentGeneration);
    if (status === 'auto-pending') {
      await this.runOrderChain(scheduleId, { id: makeId('order-auto', this.now()), kind: 'automatic' }, externalIntentGeneration);
    }
    return true;
  }

  async tickOrderSchedule() {
    if (!this.isOwner()) return false;
    const schedule = getActiveSchedule(this.state);
    if (!schedule || schedule.mode !== 'order' || schedule.enabled === false) return false;
    const run = normalizeSequenceRun(this.state.sequenceRuns?.[schedule.id]);
    if (run.active && run.active.sessionId !== this.sessionId && this.now() - Number(run.active.claimedAt || 0) >= RECEIVER_LEASE_MS) {
      return await this.serializeOrder(() => this.failOrderStep(schedule.id, run.active.token, new Error('An unfinished Order item belonged to an expired receiver session and was not replayed.')));
    }
    if (run.active?.token && this.orderIntentGenerations.get(run.active.token) !== this.externalAudioIntentGeneration) {
      return await this.serializeOrder(() => this.failOrderStep(schedule.id, run.active.token, new Error('A newer audio command cancelled the pending Order advance.')));
    }
    if (run.status === 'waiting-duration' && run.active?.token) {
      if (this.currentAnnouncement || this.safetyPendingCount > 0) {
        this.armOrderWake(schedule.id, this.now() + 1_000);
        return false;
      }
      if (Number(run.active.dueAt || 0) > this.now()) {
        this.armOrderWake(schedule.id, run.active.dueAt);
        return false;
      }
      return await this.serializeOrder(() => this.finishPendingOrderGate(schedule.id, run.active.token, 'duration completed'));
    }
    if (run.status === 'auto-pending') {
      if (this.currentAnnouncement || this.safetyPendingCount > 0 || this.announcementQueue.some(job => job.safety)) {
        this.armOrderWake(schedule.id, this.now() + 1_000);
        return false;
      }
      const intentGeneration = this.beginExternalAudioIntent('schedule');
      return await this.serializeOrder(() => this.runOrderChain(schedule.id, { id: makeId('order-auto', this.now()), kind: 'automatic' }, intentGeneration));
    }
    return false;
  }

  async handleControlledTrackEnded(event = {}) {
    const schedule = getActiveSchedule(this.state);
    if (!schedule || schedule.mode !== 'order') return false;
    const run = normalizeSequenceRun(this.state.sequenceRuns?.[schedule.id]);
    if (run.status !== 'waiting-track-end' || run.active?.expectedProvider !== 'controlled') return false;
    if (!run.active?.token || run.active.token !== String(event.scheduledRunToken || '') || run.active.expectedUrl !== String(event.url || '')) return false;
    if (this.safetyPendingCount > 0 || this.currentAnnouncement?.safety || this.announcementQueue.some(job => job.safety)) {
      this.deferredControlledTrackEnd = { ...event };
      return true;
    }
    return await this.serializeOrder(() => this.finishPendingOrderGate(schedule.id, run.active.token, 'direct track ended', { endedEvent: true }));
  }

  hasPendingControlledTrackEnd() {
    const schedule = getActiveSchedule(this.state);
    if (!schedule || schedule.mode !== 'order') return false;
    const run = normalizeSequenceRun(this.state.sequenceRuns?.[schedule.id]);
    return run.status === 'waiting-track-end' && run.active?.expectedProvider === 'controlled';
  }

  async tickSchedule() {
    if (!this.isOwner() || this.scheduleProcessing) return;
    this.scheduleProcessing = true;
    try {
      const activeSchedule = getActiveSchedule(this.state);
      if (activeSchedule?.mode === 'order') {
        await this.tickOrderSchedule();
        return;
      }
      const now = this.now();
      const due = dueTimeScheduleItems(getActiveSchedule(this.state), this.state.scheduleRuns, now);
      for (const dueItem of due) {
      const dateParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date(now));
      const dateValues = Object.fromEntries(dateParts.map(part => [part.type, part.value]));
      const dateKey = `${dateValues.year}-${dateValues.month}-${dateValues.day}`;
      const localKey = `${dueItem.id}:${dateKey}`;
      if (this.scheduleCompletedLocal.has(localKey)) continue;
      const externalIntentGeneration = this.beginExternalAudioIntent('time-schedule');
      const timeRunToken = makeId('time-run', now);
      let item = null;
      await this.store.mutate(draft => {
        item = null;
        this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command cancelled this Time schedule claim.');
        const latest = dueTimeScheduleItems(getActiveSchedule(draft), draft.scheduleRuns, now)
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
            token: timeRunToken,
            scheduleId: getActiveSchedule(draft)?.id || '',
            fingerprint: scheduleItemFingerprint(latest),
            claimedAt: this.now(),
            receiverId: this.deviceId,
            sessionId: this.sessionId
          }
        };
        return draft;
      }, 'Schedule run claimed', { requireDurable: true });
      if (!item) continue;
      const claim = this.state.scheduleRuns?.[item.id];
      if (!claim || claim.dateKey !== dateKey || claim.status !== 'in-progress' || claim.sessionId !== this.sessionId || claim.token !== timeRunToken) continue;
      try {
        this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command cancelled this Time schedule item before it could start.');
      } catch (error) {
        await this.store.mutate(draft => {
          const run = draft.scheduleRuns?.[item.id];
          if (run?.dateKey === dateKey && run?.status === 'in-progress' && run?.sessionId === this.sessionId && run?.token === timeRunToken) {
            draft.scheduleRuns = {
              ...(draft.scheduleRuns || {}),
              [item.id]: {
                dateKey,
                status: 'completed',
                token: timeRunToken,
                scheduleId: claim.scheduleId,
                fingerprint: claim.fingerprint,
                completedAt: this.now(),
                receiverId: this.deviceId,
                sessionId: this.sessionId,
                outcome: 'cancelled-by-newer-audio-intent'
              }
            };
          }
          draft.activityLog = [makeLog('schedule', 'Scheduled item cancelled by newer audio command', `${item.label}: ${error.message}`, this.now(), { scheduleId: item.id }), ...(draft.activityLog || [])];
          return draft;
        }, 'Schedule cancellation recorded', { requireDurable: true });
        this.scheduleCompletedLocal.add(localKey);
        continue;
      }
      let playbackCompleted = false;
      try {
        if (item.type === 'announcement') {
          const resolved = resolveScheduleAnnouncementText(item, this.state.announcements);
          const announcementId = item.action?.announcementId || item.announcementId || '';
          const text = item.action?.announcementSource === 'inline'
            ? resolved
            : safetyAnnouncementText(announcementId, resolved, this.state.config);
          if (!text) throw new Error('The scheduled announcement has no text. Add custom text or choose a saved announcement.');
          await this.announce(text, {
            label: item.label,
            scheduledItemId: item.id,
            scheduledRunToken: timeRunToken,
            volumePercent: effectiveScheduleItemVolume(item, this.state.config)
          });
        } else if (item.type === 'apple') {
          await this.playAppleMusic(item.url || item.action?.url || this.state.config.appleUrl, {
            volumePercent: effectiveScheduleItemVolume(item, this.state.config),
            volumeMode: item.volume?.mode,
            scheduledItemId: item.id,
            scheduledRunToken: timeRunToken
          });
        } else if (item.type === 'spotify') {
          await this.playSpotify(item.url || item.action?.url || this.state.config.spotifyUrl, {
            volumePercent: effectiveScheduleItemVolume(item, this.state.config),
            volumeMode: item.volume?.mode,
            scheduledItemId: item.id,
            scheduledRunToken: timeRunToken
          });
        } else {
          await this.playControlled(item.url || item.action?.url || this.state.config.musicUrl, {
            label: item.label,
            volumePercent: effectiveScheduleItemVolume(item, this.state.config),
            volumeMode: item.volume?.mode,
            scheduledItemId: item.id,
            scheduledRunToken: timeRunToken
          });
        }
        this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command replaced this Time schedule item while it was starting.');
        playbackCompleted = true;
        this.scheduleCompletedLocal.add(localKey);
        await this.store.mutate(draft => {
          this.assertExternalAudioIntent(externalIntentGeneration, 'A newer audio command cancelled this Time schedule receipt.');
          const existing = draft.scheduleRuns?.[item.id];
          if (!existing || existing.dateKey !== dateKey || existing.status !== 'in-progress' || existing.sessionId !== this.sessionId || existing.token !== timeRunToken) {
            throw new Error('The Time schedule claim changed before completion could be recorded.');
          }
          draft.scheduleRuns = {
            ...(draft.scheduleRuns || {}),
            [item.id]: {
              dateKey,
              status: 'completed',
              token: timeRunToken,
              scheduleId: claim.scheduleId,
              fingerprint: claim.fingerprint,
              completedAt: this.now(),
              receiverId: this.deviceId,
              sessionId: this.sessionId
            }
          };
          draft.activityLog = [makeLog('schedule', 'Scheduled item completed', `${item.time} - ${item.label}`, this.now(), { scheduleId: item.id }), ...(draft.activityLog || [])];
          return draft;
        }, 'Schedule run recorded', { requireDurable: true });
      } catch (error) {
        const scheduleChanged = error?.code === 'SCHEDULE_RUN_CANCELLED';
        const superseded = error?.code === 'AUDIO_INTENT_SUPERSEDED' || scheduleChanged ||
          externalIntentGeneration !== this.externalAudioIntentGeneration;
        if (playbackCompleted && !superseded) {
          this.status(`Scheduled item played, but its cloud receipt could not be saved: ${item.label}: ${error.message}. This receiver will not replay it today.`, false);
          continue;
        }
        await this.store.mutate(draft => {
          const run = draft.scheduleRuns?.[item.id];
          if (run?.dateKey === dateKey && run?.status === 'in-progress' && run?.sessionId === this.sessionId && run?.token === timeRunToken) {
            if (superseded) {
              draft.scheduleRuns = {
                ...(draft.scheduleRuns || {}),
                [item.id]: {
                  dateKey,
                  status: 'completed',
                  token: timeRunToken,
                  scheduleId: claim.scheduleId,
                  fingerprint: claim.fingerprint,
                  completedAt: this.now(),
                  receiverId: this.deviceId,
                  sessionId: this.sessionId,
                  outcome: scheduleChanged ? 'cancelled-by-schedule-change' : 'cancelled-by-newer-audio-intent'
                }
              };
            } else {
              const scheduleRuns = { ...(draft.scheduleRuns || {}) };
              delete scheduleRuns[item.id];
              draft.scheduleRuns = scheduleRuns;
            }
          }
          draft.activityLog = [makeLog(
            superseded ? 'schedule' : 'error',
            scheduleChanged
              ? 'Scheduled item cancelled by schedule change'
              : superseded
                ? 'Scheduled item cancelled by newer audio command'
                : 'Scheduled item failed; retry remains eligible',
            `${item.label}: ${error.message}`,
            this.now(),
            { scheduleId: item.id }
          ), ...(draft.activityLog || [])];
          return draft;
        }, 'Schedule failure recorded', { requireDurable: true });
        if (superseded) this.scheduleCompletedLocal.add(localKey);
        this.status(`Scheduled item failed: ${item.label}: ${error.message}`, false);
      }
      }
    } finally {
      this.scheduleProcessing = false;
    }
  }

  stopCalibration(reason = 'Sound check stopped. The temporary tone is off.') {
    const stopped = this.audio.stopCalibration?.(reason, { ok: true, report: true }) || false;
    if (stopped) this.onChange();
    return stopped;
  }

  async runCalibration(externalIntentGeneration = null) {
    if (!this.isOwner()) throw new Error('Run calibration on the active speaker receiver.');
    this.assertNoSafetyPending();
    const intentGeneration = externalIntentGeneration ?? this.beginExternalAudioIntent('calibration');
    const activeSchedule = getActiveSchedule(this.state);
    const activeRun = activeSchedule?.mode === 'order'
      ? normalizeSequenceRun(this.state.sequenceRuns?.[activeSchedule.id])
      : null;
    if (['waiting-duration', 'waiting-track-end'].includes(activeRun?.status) && activeRun?.active?.token && this.state.playback?.scheduledRunToken === activeRun.active.token) {
      this.orderIntentGenerations.set(activeRun.active.token, intentGeneration);
    }
    this.assertExternalAudioIntent(intentGeneration, 'A newer audio command replaced the sound check.');
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
          scheduledRunToken: String(this.state.playback.scheduledRunToken || ''),
          scheduledItemId: String(this.state.playback.scheduledItemId || ''),
          volumeMode: this.state.playback.volumeMode === 'custom' ? 'custom' : 'global',
          musicLevelPercent: this.currentMusicTarget(),
          loop: !!this.audio.musicElement?.loop,
          position: wasPlaying
            ? Number(this.audio.musicElement?.currentTime || 0)
            : Number(this.state.playback.positionMs || 0) / 1000
        }
      : null;
    let appleSnapshot = null;
    let spotifySnapshot = null;
    const applePauseHeld = provider === 'apple' || this.apple.ready || this.apple.current?.paused === false;
    const spotifyPauseHeld = provider === 'spotify' || this.spotify.ready || this.spotify.current?.paused === false;
    if (applePauseHeld) {
      this.beginTemporaryAppleMusicPause();
      try {
        appleSnapshot = await this.apple.pauseForAnnouncement();
      } catch (error) {
        this.endTemporaryAppleMusicPause();
        throw error;
      }
    }
    if (spotifyPauseHeld) {
      this.beginTemporarySpotifyPause();
      try {
        spotifySnapshot = await this.spotify.pauseForAnnouncement();
      } catch (error) {
        if (applePauseHeld) this.endTemporaryAppleMusicPause();
        this.endTemporarySpotifyPause();
        throw error;
      }
    }
    this.physicalProvider = '';
    let soundCheckCompleted = false;
    try {
      await this.audio.runCalibration({
        speak: async (text, { signal } = {}) => {
          this.assertAudioRequest(requestId, epoch, 'Sound check was replaced by a higher-priority audio action.');
          const blob = await this.prepareVoice(text, { signal });
          this.assertAudioRequest(requestId, epoch, 'Sound check was replaced by a higher-priority audio action.');
          if (blob) await this.audio.playVoiceBlob(blob);
          else await this.audio.playDeviceSpeech(text);
        }
      });
      soundCheckCompleted = true;
    } catch (error) {
      if (error?.name !== 'AbortError') throw error;
    } finally {
      const superseded = !this.isOwner() || requestId !== this.audioRequestId || epoch !== this.audioEpoch;
      if (superseded) {
        this.audio.stopMusic();
        const carried = appleSnapshot?.wasPlaying
          ? this.carrySafetyRestore({ provider: 'apple', appleSnapshot })
          : spotifySnapshot?.wasPlaying
            ? this.carrySafetyRestore({ provider: 'spotify', spotifySnapshot })
          : controlledSnapshot?.wasPlaying
            ? this.carrySafetyRestore({ provider: 'controlled', controlledSnapshot })
            : false;
        if (!carried) {
          await this.apple.pauseForAnnouncement().catch(() => {});
          await this.spotify.pauseForAnnouncement().catch(() => {});
        }
      } else if (provider === 'apple' && appleSnapshot?.wasPlaying) {
        await this.apple.resumeAfterAnnouncement(appleSnapshot, {
          assertCurrent: () => this.assertAudioRequest(requestId, epoch)
        }).then(() => {
          this.physicalProvider = 'apple';
          this.physicalRequestId = requestId;
          this.physicalCommittedRequestId = requestId;
          this.physicalMusicTarget = {
            requestId,
            mode: this.state.playback.volumeMode === 'custom' ? 'custom' : 'global',
            percent: this.currentMusicTarget(),
            provider: 'apple'
          };
          this.rememberCommittedPlayback(requestId);
        }).catch(error => this.status(`Sound check finished; Apple Music resume failed: ${error.message}`, false));
      } else if (provider === 'spotify' && spotifySnapshot?.wasPlaying) {
        await this.spotify.resumeAfterAnnouncement(spotifySnapshot, {
          assertCurrent: () => this.assertAudioRequest(requestId, epoch)
        }).then(() => {
          this.physicalProvider = 'spotify';
          this.physicalRequestId = requestId;
          this.physicalCommittedRequestId = requestId;
          this.physicalMusicTarget = {
            requestId,
            mode: this.state.playback.volumeMode === 'custom' ? 'custom' : 'global',
            percent: this.currentMusicTarget(),
            provider: 'spotify'
          };
          this.rememberCommittedPlayback(requestId);
        }).catch(error => this.status(`Sound check finished; Spotify resume failed: ${error.message}`, false));
      } else if (controlledSnapshot?.wasPlaying && controlledSnapshot.audioUrl && this.scheduledRunAuthorized(this.state, controlledSnapshot.scheduledRunToken, controlledSnapshot.scheduledItemId)) {
        await this.audio.playMusicUrl(controlledSnapshot.audioUrl, {
          label: controlledSnapshot.label,
          startAt: controlledSnapshot.position,
          loop: controlledSnapshot.loop,
          scheduledRunToken: controlledSnapshot.scheduledRunToken
        }).then(() => {
          this.physicalProvider = 'controlled';
          this.physicalRequestId = requestId;
          this.physicalCommittedRequestId = requestId;
          this.physicalMusicTarget = {
            requestId,
            mode: controlledSnapshot.volumeMode,
            percent: controlledSnapshot.musicLevelPercent,
            provider: 'controlled'
          };
          this.rememberCommittedPlayback(requestId);
        }).catch(error => this.status(`Sound check finished; music restore failed: ${error.message}`, false));
      } else if (controlledSnapshot) {
        this.audio.stopMusic();
        this.physicalProvider = controlledSnapshot.wasPlaying ? '' : 'controlled';
        this.physicalMusicTarget = null;
      }
      if (applePauseHeld) this.endTemporaryAppleMusicPause();
      if (spotifyPauseHeld) this.endTemporarySpotifyPause();
    }
    return soundCheckCompleted;
    });
    if (!completed) return false;
    try {
      await this.store.mutate(draft => {
        if (draft.receiver?.id !== this.deviceId || draft.receiver?.sessionId !== this.sessionId) {
          throw new Error('Receiver ownership changed before the sound-check receipt could be saved.');
        }
        const target = clamp(draft.config.musicLevel, 0, 100, 30);
        const voiceTarget = clamp(draft.config.voiceLevel, 0, 100, VOICE_LEVEL_PERCENT);
        draft.activityLog = [makeLog('diagnostic', `${target}/${voiceTarget} calibration completed`, `${target}% calibration bed, ${Math.min(DUCK_LEVEL_PERCENT, target)}% duck, and ${voiceTarget}% announcement path played on the receiver.`), ...(draft.activityLog || [])];
        return draft;
      }, 'Calibration completed', { requireDurable: true });
    } catch (error) {
      this.status(`Sound check completed, but its activity receipt could not be saved: ${error.message}`, false);
    }
    return completed;
  }
}
