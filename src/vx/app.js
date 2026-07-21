import {
  ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS,
  DEFAULT_ANNOUNCEMENTS,
  DEFAULT_SPOTIFY_CLIENT_ID,
  DEFAULT_SPOTIFY_PLAYLIST,
  DUCK_LEVEL_PERCENT,
  VOICE_LEVEL_PERCENT,
  VERSION,
  announcementDeliveryForSource,
  audioPolicy,
  cancelSequenceRun,
  clamp,
  effectiveScheduleItemVolume,
  getActiveSchedule,
  isAppleMusicUrl,
  isSpotifyUrl,
  managerVolumePlan,
  makeId,
  makeLog,
  normalizeAnnouncementSource,
  normalizeSequenceRun,
  reorderScheduleItems,
  receiverOnline,
  resolveScheduleAnnouncementText,
  scheduleDateKey,
  safetyAnnouncementText,
  zonedScheduleParts,
  weatherRequestUrl
} from './core.js';
import { AudioEngine, isIOSLike } from './audio-engine.js';
import { CloudStore, loginSession, logoutSession, sessionStatus } from './cloud.js';
import { AppleMusicReceiver } from './apple-music-receiver.js';
import { SPOTIFY_REDIRECT_URI, SpotifyReceiver } from './spotify-receiver.js';
import {
  PUSHCUT_MAX_ANNOUNCEMENT_CHARACTERS,
  applyPushcutMusicVolume,
  getPushcutAnnouncementStatus,
  sendPushcutAnnouncement,
  waitForPushcutAnnouncementCompletion
} from './pushcut-client.js';
import {
  getPushcutScheduleStatus,
  PushcutScheduleSyncError,
  syncPushcutSchedule
} from './pushcut-schedule-client.js';
import {
  applyEmailWakeMusicVolume,
  createEmailWakePairingCode,
  EMAIL_WAKE_MAX_ANNOUNCEMENT_CHARACTERS,
  getEmailWakeStatus,
  sendEmailWakeAnnouncement,
  withEmailWakeBrowserAudioLease,
  waitForEmailWakeCompletion
} from './email-wake-client.js';
import {
  EmailWakeScheduleSyncError,
  getEmailWakeScheduleStatus,
  syncEmailWakeSchedule
} from './email-wake-schedule-client.js';
import {
  EMAIL_WAKE_X_SHORTCUT_INSTALL_URL,
  EMAIL_WAKE_X_SHORTCUT_NAME
} from './email-wake-shortcut.js';
import {
  PUSHCUT_X_ANNOUNCEMENT_INSTALL_URL,
  PUSHCUT_X_ANNOUNCEMENT_SHORTCUT_NAME,
  PUSHCUT_X_RECOVERY_INSTALL_URL,
  PUSHCUT_X_RECOVERY_SHORTCUT_NAME
} from './pushcut-shortcuts.js';
import { preferredAnnouncementTransport } from './announcement-routing.js';
import { ReceiverRuntime } from './receiver-runtime.js';
import {
  manualWeatherStatusAnnouncement,
  prepareImmediateWeatherAnnouncement,
  preparePendingWeatherAnnouncement,
  sameWeatherConfig,
  weatherConfigSnapshot
} from './weather-command.js';

const root = document.getElementById('app');
const ROLE_KEY = 'poolside-pulse-vx-role';
const TAB_KEY = 'poolside-pulse-vx-tab';
const PREVIOUS_TAB_KEY = 'poolside-pulse-vx-previous-tab';
const SCHEDULE_SELECTION_KEY = 'poolside-pulse-vx-schedule-selection';
const PUSHCUT_RUN_SERVER_URL = 'pushcut://open/runServer';
const RECEIVER_TEST_HOST = 'poolside-pulse-x-receiver.vercel.app';
const RECEIVER_TEST_RECEIVER_URL =
  `https://${RECEIVER_TEST_HOST}/#receiver`;
const RECEIVER_TEST_REMOTE_URL =
  `https://${RECEIVER_TEST_HOST}/#command`;
const SPOTIFY_CLIENT_ID = DEFAULT_SPOTIFY_CLIENT_ID;
const RESORT_DAILY_APPLE_PLAYLIST = 'https://music.apple.com/us/playlist/pool-music-openai/pl.u-WabZvbaFRrzK3z1';
const SPOTIFY_DEVELOPER_DASHBOARD_URL = 'https://developer.spotify.com/dashboard';
const SCHEDULE_STRUCTURAL_ACTIONS = new Set([
  'new-schedule-set',
  'duplicate-schedule-set',
  'delete-schedule-set',
  'confirm-delete-schedule-set',
  'activate-schedule-set',
  'add-schedule-item',
  'delete-schedule-item',
  'duplicate-schedule-item',
  'move-schedule-item',
  'play-next-schedule',
  'reset-order-schedule',
  'cancel-schedule-today',
  'restore-schedule-today',
  'skip-schedule-item-today',
  'restore-schedule-item-today'
]);
const SCHEDULE_NATIVE_CONTROL_LOCK_MS = 2 * 60_000;

let authenticated = false;
let authChecked = false;
let role = localStorage.getItem(ROLE_KEY) || '';
let activeTab = localStorage.getItem(TAB_KEY) || 'control';
let feedback = { message: 'Starting Poolside Pulse Version X...', ok: true };
let busy = false;
let takeoverTarget = null;
let renderQueued = false;
let renderQueuedForce = false;
let deferredRenderPending = false;
let deferredRenderForce = false;
let scheduleControlInteractionUntil = 0;
let scheduleControlInteractionTimer = null;
let actionSettled = Promise.resolve();
let settleCurrentAction = null;
let queuedMusicLevel = null;
let musicLevelDrain = null;
let musicLevelDraft = null;
let musicLevelSaveSequence = 0;
let musicLevelInputSaveTimer = null;
let activeMusicLevelSaveTarget = null;
let roleChangePending = false;
let pendingTab = '';
let previousTab = localStorage.getItem(PREVIOUS_TAB_KEY) || '';
let selectedScheduleId = localStorage.getItem(SCHEDULE_SELECTION_KEY) || '';
let scheduleDeletePending = '';
let pendingOpenScheduleItemId = '';
let draggedScheduleItemId = '';
let draggedScheduleTargetId = '';
let pushcutStatus = {
  checked: false,
  ready: false,
  readyActions: {},
  operational: false,
  connected: false,
  connectedReady: false,
  recoveryReady: false,
  latestVerifiedAt: 0,
  note: ''
};
let pushcutVolumeStatus = {
  state: 'idle',
  message: 'Not applied from this manager session yet.'
};
let pushcutScheduleStatus = {
  checked: false,
  syncing: false,
  syncedAt: 0,
  horizonEnd: 0,
  scheduledCount: 0,
  occurrenceCount: 0,
  nextScheduledFor: 0,
  warnings: [],
  requiresExtended: false,
  error: ''
};
let pushcutScheduleSyncTimer = null;
let pushcutScheduleSyncPromise = null;
let pushcutScheduleSyncFingerprint = '';
let pushcutScheduleSyncPending = false;
let observedPushcutScheduleFingerprint = '';
let emailWakeStatus = {
  checked: false,
  ready: false,
  operational: false,
  receiverPaired: false,
  pairedAt: 0,
  wakeReady: false,
  durable: false,
  executionActive: false,
  executionEventId: '',
  executionLeaseUntil: 0,
  wakeSender: '',
  wakeSubject: '',
  wakeRecipient: '',
  naturalAudioReady: false,
  signedDeliveryReady: false,
  configurationIssues: [],
  note: ''
};
let emailWakePairing = {
  code: '',
  expiresAt: 0
};
let emailWakeVolumeStatus = {
  state: 'idle',
  message: 'Not applied from this manager session yet.'
};
let emailWakeScheduleStatus = {
  checked: false,
  syncing: false,
  syncedAt: 0,
  horizonEnd: 0,
  stateRevision: 0,
  enabled: false,
  current: false,
  sourceFingerprint: '',
  scheduledCount: 0,
  announcementScheduledCount: 0,
  volumeScheduledCount: 0,
  musicBrowserCount: 0,
  occurrenceCount: 0,
  nextScheduledFor: 0,
  maintenanceScheduled: false,
  maintenanceScheduledFor: 0,
  warnings: [],
  error: ''
};
let emailWakeScheduleSyncTimer = null;
let emailWakeScheduleSyncPromise = null;
let emailWakeScheduleSyncFingerprint = '';
let emailWakeScheduleSyncPending = false;
let observedEmailWakeScheduleFingerprint = '';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function setFeedback(message, ok = true) {
  feedback = { message: String(message || ''), ok };
  renderWhenIdle();
}

async function fetchVersionXJson(url, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== 'object') {
      throw new Error(payload?.error || `Weather service returned HTTP ${response.status}.`);
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Weather check timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function formatClock(timestamp) {
  if (!timestamp) return 'Not yet';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  }).format(new Date(timestamp));
}

function relativeTime(timestamp) {
  const age = (typeof store?.now === 'function' ? store.now() : Date.now()) - Number(timestamp || 0);
  if (!timestamp) return 'never';
  if (age < 5_000) return 'just now';
  if (age < 60_000) return `${Math.floor(age / 1000)} sec ago`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} min ago`;
  return formatClock(timestamp);
}

function focusedEditor() {
  const active = document.activeElement;
  return !!active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
}

function scheduleNativeControl(target) {
  return target?.closest?.(
    'details[data-persist-open^="schedule-"] > summary, form[data-form="schedule-settings"] select, form[data-form="schedule-item"] select, form[data-form="schedule-item"] input[type="time"]'
  ) || null;
}

function scheduleControlInteractionActive() {
  return scheduleControlInteractionUntil > Date.now();
}

function flushDeferredRenderIfIdle() {
  if (focusedEditor() || scheduleControlInteractionActive() || !deferredRenderPending) return;
  const force = deferredRenderForce;
  deferredRenderPending = false;
  deferredRenderForce = false;
  renderWhenIdle(force);
}

function clearScheduleControlInteraction({ delayMs = 0 } = {}) {
  clearTimeout(scheduleControlInteractionTimer);
  scheduleControlInteractionTimer = null;
  if (delayMs > 0) {
    scheduleControlInteractionUntil = Date.now() + delayMs;
    scheduleControlInteractionTimer = setTimeout(() => {
      scheduleControlInteractionTimer = null;
      scheduleControlInteractionUntil = 0;
      flushDeferredRenderIfIdle();
    }, delayMs);
    return;
  }
  scheduleControlInteractionUntil = 0;
  queueMicrotask(flushDeferredRenderIfIdle);
}

function beginScheduleControlInteraction(target) {
  if (!scheduleNativeControl(target)) return false;
  clearTimeout(scheduleControlInteractionTimer);
  scheduleControlInteractionUntil = Date.now() + SCHEDULE_NATIVE_CONTROL_LOCK_MS;
  scheduleControlInteractionTimer = setTimeout(() => {
    scheduleControlInteractionTimer = null;
    scheduleControlInteractionUntil = 0;
    flushDeferredRenderIfIdle();
  }, SCHEDULE_NATIVE_CONTROL_LOCK_MS);
  return true;
}

function renderWhenIdle(force = false) {
  renderQueuedForce = renderQueuedForce || force;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    const shouldForce = renderQueuedForce;
    renderQueued = false;
    renderQueuedForce = false;
    if (draggedScheduleItemId) {
      updateLiveStatus();
      return;
    }
    if (focusedEditor() || scheduleControlInteractionActive()) {
      deferredRenderPending = true;
      deferredRenderForce = deferredRenderForce || shouldForce;
      updateLiveStatus();
      return;
    }
    deferredRenderPending = false;
    deferredRenderForce = false;
    render();
  });
}

function customPlaybackMusicTarget(state = store?.state) {
  const playback = state?.playback;
  const percent = Number(playback?.musicLevelPercent);
  if (playback?.intent === 'stopped' || playback?.volumeMode !== 'custom' || !Number.isFinite(percent)) return null;
  return clamp(percent, 0, 100, state?.config?.musicLevel ?? 30);
}

function audibleMusicTarget(state = store?.state, globalOverride = null) {
  const sharedTarget = globalOverride === null || globalOverride === undefined
    ? state?.config?.musicLevel
    : globalOverride;
  // Pushcut controls the native receiver output from the one shared slider.
  // A stale custom Browser-schedule target must never override that value.
  if (state?.config?.receiverMode === 'pushcut') {
    return clamp(sharedTarget, 0, 100, 30);
  }
  const customTarget = customPlaybackMusicTarget(state);
  if (customTarget !== null) return customTarget;
  return clamp(sharedTarget, 0, 100, 30);
}

function controlledBrowserGainTarget(
  state = store?.state,
  requestedPercent = audibleMusicTarget(state)
) {
  return automaticAnnouncementsEnabled(state)
    ? 100
    : clamp(requestedPercent, 0, 100, 30);
}

function audibleVoiceTarget() {
  return VOICE_LEVEL_PERCENT;
}

function platformIsIOS(userAgent = '') {
  return /iPhone|iPad|iPod|Macintosh[^\n]*Mobile/i.test(String(userAgent || ''));
}

function activeReceiverIsIOS(state = store?.state) {
  const receiver = state?.receiver;
  if (receiverOnline(receiver, store.now())) return platformIsIOS(receiver?.platform);
  return role === 'receiver' && isIOSLike();
}

function pushcutAnnouncementReady() {
  return pushcutStatus.ready === true && pushcutStatus.readyActions?.announce === true;
}

function pushcutAnnouncementOperational() {
  return pushcutAnnouncementReady() &&
    pushcutStatus.operational === true &&
    pushcutStatus.connectedReady === true;
}

function pushcutMusicVolumeReady() {
  return pushcutStatus.recoveryReady === true;
}

function automaticAnnouncementsEnabled(state = store?.state) {
  return state?.config?.announcementTransport === 'email-wake'
    && Number(state?.config?.automaticReceiverVerifiedPairingAt || 0) > 0;
}

function emailWakeOperational() {
  return emailWakeStatus.ready === true
    && emailWakeStatus.operational === true
    && emailWakeStatus.receiverPaired === true;
}

async function refreshEmailWakeStatus() {
  try {
    const status = await getEmailWakeStatus();
    emailWakeStatus = {
      checked: true,
      ready: status.ready === true,
      operational: status.operational === true,
      receiverPaired: status.receiverPaired === true,
      pairedAt: Number(status.pairedAt || 0),
      wakeReady: status.wakeReady === true,
      durable: status.durable === true,
      executionActive: status.executionActive === true,
      executionEventId: String(status.executionEventId || ''),
      executionLeaseUntil: Number(status.executionLeaseUntil || 0),
      wakeSender: String(status.wakeSender || ''),
      wakeSubject: String(status.wakeSubject || ''),
      wakeRecipient: String(status.wakeRecipient || ''),
      naturalAudioReady: status.naturalAudioReady === true,
      signedDeliveryReady: status.signedDeliveryReady === true,
      configurationIssues: Array.isArray(status.configurationIssues)
        ? status.configurationIssues
            .map(item => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 12)
        : [],
      note: String(status.note || '')
    };
  } catch (error) {
    emailWakeStatus = {
      checked: true,
      ready: false,
      operational: false,
      receiverPaired: false,
      pairedAt: 0,
      wakeReady: false,
      durable: false,
      executionActive: false,
      executionEventId: '',
      executionLeaseUntil: 0,
      wakeSender: '',
      wakeSubject: '',
      wakeRecipient: '',
      naturalAudioReady: false,
      signedDeliveryReady: false,
      configurationIssues: [
        `Automatic Receiver status could not be checked: ${
          error.message || String(error)
        }`
      ],
      note: error.message || String(error)
    };
  }
  return emailWakeStatus;
}

function receiverOperatingMode(state = store?.state) {
  // Automatic Receiver is the authoritative announcement lane. A stale
  // legacy Pushcut value must never hide browser music controls or stop a
  // working receiver lease.
  if (automaticAnnouncementsEnabled(state)) return 'browser';
  const configuredMode = String(state?.config?.receiverMode || '');
  if (configuredMode === 'browser' || configuredMode === 'pushcut') return configuredMode;
  // Compatibility only for state written before Version X stored an explicit
  // mode. New state always uses config.receiverMode so an expiring Safari
  // lease cannot steal a command intended for Pushcut.
  if (receiverOnline(state?.receiver, store.now())) return 'browser';
  if (pushcutAnnouncementReady()) return 'pushcut';
  return 'setup';
}

async function refreshPushcutStatus() {
  try {
    const status = await getPushcutAnnouncementStatus();
    pushcutStatus = {
      checked: true,
      ready: status.ready === true,
      readyActions: status.readyActions && typeof status.readyActions === 'object' ? status.readyActions : {},
      operational: status.operational === true,
      connected: status.connected === true,
      connectedReady: status.connectedReady === true,
      recoveryReady: status.recoveryReady === true,
      latestVerifiedAt: Number(status.latestVerifiedAt || 0),
      note: String(status.note || '')
    };
  } catch (error) {
    pushcutStatus = {
      checked: true,
      ready: false,
      readyActions: {},
      operational: false,
      connected: false,
      connectedReady: false,
      recoveryReady: false,
      latestVerifiedAt: 0,
      note: error.message || String(error)
    };
  }
  return pushcutStatus;
}

function pushcutScheduleFingerprint(state = store?.state) {
  const source = state && typeof state === 'object' ? state : {};
  const now = typeof store?.now === 'function' ? store.now() : Date.now();
  return JSON.stringify({
    activeScheduleId: source.activeScheduleId || '',
    browserReceiverOnline: receiverOnline(source.receiver, now),
    config: {
      receiverMode: source.config?.receiverMode,
      musicLevel: source.config?.musicLevel,
      lightningRadiusMiles: source.config?.lightningRadiusMiles,
      lightningHoldMinutes: source.config?.lightningHoldMinutes
    },
    announcements: source.announcements || [],
    announcementSources: source.announcementSources || [],
    schedules: source.schedules || []
  });
}

function setPushcutScheduleStatus(payload = {}, {
  error = '',
  requiresExtended = false,
  syncing = false
} = {}) {
  pushcutScheduleStatus = {
    checked: true,
    syncing,
    syncedAt: Number(payload.syncedAt || 0),
    horizonEnd: Number(payload.horizonEnd || 0),
    scheduledCount: Number(payload.scheduledCount || 0),
    announcementScheduledCount: Number(payload.announcementScheduledCount || 0),
    volumeScheduledCount: Number(payload.volumeScheduledCount || 0),
    musicBrowserCount: Number(payload.musicBrowserCount || 0),
    occurrenceCount: Number(payload.occurrenceCount || 0),
    nextScheduledFor: Number(payload.nextScheduledFor || 0),
    maintenanceScheduled: payload.maintenanceScheduled === true,
    maintenanceScheduledFor: Number(payload.maintenanceScheduledFor || 0),
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.map(item => String(item || '')).filter(Boolean).slice(0, 100)
      : [],
    requiresExtended: requiresExtended === true || payload.requiresExtended === true,
    error: String(error || '')
  };
  renderWhenIdle(true);
  return pushcutScheduleStatus;
}

async function refreshPushcutScheduleStatus() {
  if (!pushcutAnnouncementReady()) {
    return setPushcutScheduleStatus({}, {
      error: 'Configure the Pushcut announcement receiver before syncing timed announcements.'
    });
  }
  try {
    const status = await getPushcutScheduleStatus();
    return setPushcutScheduleStatus(status);
  } catch (error) {
    return setPushcutScheduleStatus({}, {
      error: error.message || String(error),
      requiresExtended: error.requiresExtended === true
    });
  }
}

async function syncCurrentPushcutSchedule({
  manual = false,
  retryStale = true,
  pushcutEnabledOverride = null
} = {}) {
  if (!pushcutAnnouncementReady()) {
    throw new Error('Configure the Pushcut announcement receiver before syncing timed announcements.');
  }
  const receiverModeTransition = role === 'receiver' && typeof pushcutEnabledOverride === 'boolean';
  if (role !== 'command' && !receiverModeTransition) {
    throw new Error('Open Schedule on the Remote Control device to sync timed announcements.');
  }
  if (pushcutScheduleSyncPromise) {
    if (pushcutScheduleFingerprint(store.state) !== pushcutScheduleSyncFingerprint) {
      pushcutScheduleSyncPending = true;
    }
    return await pushcutScheduleSyncPromise;
  }
  let requestedState = store.state;
  let requestedFingerprint = pushcutScheduleFingerprint(requestedState);
  let requestedRevision = Number(requestedState?.revision || 0);
  let requestedPushcutEnabled = typeof pushcutEnabledOverride === 'boolean'
    ? pushcutEnabledOverride
    : receiverOperatingMode(requestedState) === 'pushcut';
  pushcutScheduleSyncFingerprint = requestedFingerprint;
  pushcutScheduleStatus = { ...pushcutScheduleStatus, checked: true, syncing: true, error: '' };
  renderWhenIdle(true);
  pushcutScheduleSyncPromise = (async () => {
    try {
      let result;
      try {
        result = await syncPushcutSchedule(requestedState, {
          pushcutEnabled: requestedPushcutEnabled
        });
      } catch (error) {
        if (retryStale && Number(error?.status) === 409) {
          await store.load();
          requestedState = store.state;
          requestedFingerprint = pushcutScheduleFingerprint(requestedState);
          requestedRevision = Number(requestedState?.revision || 0);
          requestedPushcutEnabled = typeof pushcutEnabledOverride === 'boolean'
            ? pushcutEnabledOverride
            : receiverOperatingMode(requestedState) === 'pushcut';
          pushcutScheduleSyncFingerprint = requestedFingerprint;
          result = await syncPushcutSchedule(requestedState, {
            pushcutEnabled: requestedPushcutEnabled
          });
        } else {
          throw error;
        }
      }
      setPushcutScheduleStatus(result);
      if (
        Number(result?.stateRevision) !== requestedRevision
        || pushcutScheduleFingerprint(store.state) !== requestedFingerprint
      ) {
        // A save landed while the provider was still creating the old rolling
        // plan. Never mark that newer state as synchronized by the old request.
        pushcutScheduleSyncPending = true;
      }
      if (manual) {
        const message = !requestedPushcutEnabled
          ? 'Browser Receiver mode is active. Pending Pushcut timed copies were cancelled so each schedule item runs only once.'
          : result.scheduledCount
          ? `${result.scheduledCount} timed announcement ${result.scheduledCount === 1 ? 'occurrence is' : 'occurrences are'} synced through ${formatClock(result.horizonEnd)}.`
          : 'The live Time schedule has no enabled Pushcut announcement occurrences to sync.';
        setFeedback(message, true);
      }
      return result;
    } catch (error) {
      const extended = error instanceof PushcutScheduleSyncError
        ? error.requiresExtended === true
        : error?.requiresExtended === true;
      setPushcutScheduleStatus({}, {
        error: extended
          ? 'Pushcut Automation Server Extended is required for automatic timed announcements.'
          : error.message || String(error),
        requiresExtended: extended
      });
      if (manual || extended) {
        setFeedback(
          extended
            ? 'Pushcut Automation Server Extended is required for automatic timed announcements.'
            : error.message || String(error),
          false
        );
      }
      throw error;
    } finally {
      pushcutScheduleSyncPromise = null;
      pushcutScheduleSyncFingerprint = '';
      if (pushcutScheduleSyncPending) {
        pushcutScheduleSyncPending = false;
        queuePushcutScheduleSync(0);
      }
    }
  })();
  return await pushcutScheduleSyncPromise;
}

function queuePushcutScheduleSync(delayMs = 900) {
  if (
    !authenticated
    || role !== 'command'
    || !pushcutAnnouncementReady()
    || automaticAnnouncementsEnabled()
  ) return;
  clearTimeout(pushcutScheduleSyncTimer);
  pushcutScheduleSyncTimer = setTimeout(() => {
    pushcutScheduleSyncTimer = null;
    syncCurrentPushcutSchedule().catch(() => {});
  }, delayMs);
}

function emailWakeScheduleFingerprint(state = store?.state) {
  const source = state && typeof state === 'object' ? state : {};
  return JSON.stringify({
    announcementTransport:
      automaticAnnouncementsEnabled(source)
        ? 'email-wake'
        : 'browser',
    activeScheduleId: source.activeScheduleId || '',
    config: {
      musicLevel: source.config?.musicLevel,
      lightningRadiusMiles: source.config?.lightningRadiusMiles,
      lightningHoldMinutes: source.config?.lightningHoldMinutes
    },
    announcements: source.announcements || [],
    announcementSources: source.announcementSources || [],
    schedules: source.schedules || []
  });
}

function setEmailWakeScheduleStatus(payload = {}, {
  error = '',
  syncing = false
} = {}) {
  emailWakeScheduleStatus = {
    checked: true,
    syncing,
    syncedAt: Number(payload.syncedAt || 0),
    horizonEnd: Number(payload.horizonEnd || 0),
    stateRevision: Number(payload.stateRevision || 0),
    enabled: payload.enabled === true,
    current:
      payload.current === true
      || payload.synchronized === true,
    sourceFingerprint: String(payload.sourceFingerprint || ''),
    scheduledCount: Number(payload.scheduledCount || 0),
    occurrenceCount: Number(payload.occurrenceCount || 0),
    nextScheduledFor: Number(payload.nextScheduledFor || 0),
    maintenanceScheduled: payload.maintenanceScheduled === true,
    maintenanceScheduledFor: Number(payload.maintenanceScheduledFor || 0),
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.map(item => String(item || '')).filter(Boolean).slice(0, 100)
      : [],
    error: String(error || '')
  };
  renderWhenIdle(true);
  return emailWakeScheduleStatus;
}

function automaticTimedAnnouncementsDelegated() {
  return automaticAnnouncementsEnabled()
    && emailWakeOperational()
    && emailWakeScheduleStatus.checked === true
    && emailWakeScheduleStatus.enabled === true
    && emailWakeScheduleStatus.current === true
    && !emailWakeScheduleStatus.error;
}

async function refreshEmailWakeScheduleStatus() {
  if (!emailWakeStatus.ready) {
    return setEmailWakeScheduleStatus({}, {
      error: 'Configure the Automatic Receiver service before syncing timed announcements.'
    });
  }
  try {
    return setEmailWakeScheduleStatus(await getEmailWakeScheduleStatus());
  } catch (error) {
    return setEmailWakeScheduleStatus({}, {
      error: error.message || String(error)
    });
  }
}

async function syncCurrentEmailWakeSchedule({
  manual = false,
  retryStale = true,
  enabledOverride = null
} = {}) {
  if (!emailWakeStatus.ready) {
    throw new Error('Configure the Automatic Receiver service before syncing timed announcements.');
  }
  const receiverModeTransition =
    role === 'receiver'
    && typeof enabledOverride === 'boolean';
  if (role !== 'command' && !receiverModeTransition) {
    throw new Error('Open Schedule on a Remote Control device to sync timed announcements.');
  }
  if (emailWakeScheduleSyncPromise) {
    if (
      emailWakeScheduleFingerprint(store.state)
      !== emailWakeScheduleSyncFingerprint
    ) {
      emailWakeScheduleSyncPending = true;
    }
    return await emailWakeScheduleSyncPromise;
  }
  let requestedState = store.state;
  let requestedFingerprint = emailWakeScheduleFingerprint(requestedState);
  let requestedRevision = Number(requestedState?.revision || 0);
  let requestedEnabled =
    typeof enabledOverride === 'boolean'
      ? enabledOverride
      : automaticAnnouncementsEnabled(requestedState);
  emailWakeScheduleSyncFingerprint = requestedFingerprint;
  emailWakeScheduleStatus = {
    ...emailWakeScheduleStatus,
    checked: true,
    syncing: true,
    error: ''
  };
  renderWhenIdle(true);
  emailWakeScheduleSyncPromise = (async () => {
    try {
      let result;
      try {
        result = await syncEmailWakeSchedule(requestedState, {
          enabled: requestedEnabled
        });
      } catch (error) {
        if (retryStale && Number(error?.status) === 409) {
          await store.load();
          requestedState = store.state;
          requestedFingerprint = emailWakeScheduleFingerprint(requestedState);
          requestedRevision = Number(requestedState?.revision || 0);
          requestedEnabled =
            typeof enabledOverride === 'boolean'
              ? enabledOverride
              : automaticAnnouncementsEnabled(requestedState);
          emailWakeScheduleSyncFingerprint = requestedFingerprint;
          result = await syncEmailWakeSchedule(requestedState, {
            enabled: requestedEnabled
          });
        } else {
          throw error;
        }
      }
      setEmailWakeScheduleStatus(result);
      if (
        Number(result?.stateRevision) !== requestedRevision
        || emailWakeScheduleFingerprint(store.state) !== requestedFingerprint
      ) {
        emailWakeScheduleSyncPending = true;
      }
      if (manual) {
        const message = !requestedEnabled
          ? 'The background automatic schedule is paused; Browser music scheduling is unchanged.'
          : result.scheduledCount
            ? `${result.scheduledCount} background schedule ${
                result.scheduledCount === 1 ? 'occurrence is' : 'occurrences are'
              } synced through ${formatClock(result.horizonEnd)}.`
            : 'The live Time schedule has no enabled background announcement or quiet-hours occurrences.';
        setFeedback(message, true);
      }
      return result;
    } catch (error) {
      const safe =
        error instanceof EmailWakeScheduleSyncError
          ? error
          : new EmailWakeScheduleSyncError(error.message || String(error));
      setEmailWakeScheduleStatus({}, { error: safe.message });
      if (manual) setFeedback(safe.message, false);
      throw safe;
    } finally {
      emailWakeScheduleSyncPromise = null;
      emailWakeScheduleSyncFingerprint = '';
      if (emailWakeScheduleSyncPending) {
        emailWakeScheduleSyncPending = false;
        queueEmailWakeScheduleSync(0);
      }
    }
  })();
  return await emailWakeScheduleSyncPromise;
}

function queueEmailWakeScheduleSync(delayMs = 900) {
  if (!authenticated || role !== 'command' || !emailWakeStatus.ready) return;
  clearTimeout(emailWakeScheduleSyncTimer);
  emailWakeScheduleSyncTimer = setTimeout(() => {
    emailWakeScheduleSyncTimer = null;
    syncCurrentEmailWakeSchedule().catch(() => {});
  }, delayMs);
}

async function ensureAutomaticScheduleSyncAfterChange(
  previousFingerprint,
  savedLabel = 'Change'
) {
  const nextFingerprint = emailWakeScheduleFingerprint(store.state);
  if (
    role !== 'command'
    || !automaticAnnouncementsEnabled()
    || previousFingerprint === nextFingerprint
  ) {
    return null;
  }

  clearTimeout(emailWakeScheduleSyncTimer);
  emailWakeScheduleSyncTimer = null;
  if (automaticTimedAnnouncementsDelegated()) return emailWakeScheduleStatus;

  if (!emailWakeOperational()) {
    const detail =
      emailWakeStatus.note
      || emailWakeStatus.configurationIssues?.[0]
      || 'Automatic Receiver is not paired and operational.';
    const message =
      `${savedLabel} saved, but durable automatic announcement scheduling did not update: ${detail}`;
    setEmailWakeScheduleStatus({}, { error: message });
    throw new Error(message);
  }

  try {
    // A prior debounce may already be finishing an older revision. The sync
    // helper marks that result stale; one immediate follow-up then commits the
    // state that this user just saved before success is reported.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await syncCurrentEmailWakeSchedule({ retryStale: true });
      if (automaticTimedAnnouncementsDelegated()) {
        return emailWakeScheduleStatus;
      }
    }
    throw new Error(
      'The schedule service did not confirm the saved Version X revision.'
    );
  } catch (error) {
    const message =
      `${savedLabel} saved, but durable automatic announcement scheduling did not update: ${
        error.message || String(error)
      }`;
    setEmailWakeScheduleStatus({}, { error: message });
    throw new Error(message);
  }
}

function liveReceiverIsNative(state = store?.state) {
  const receiver = state?.receiver;
  return receiverOnline(receiver, store.now()) && receiver?.receiverKind === 'macos-music-helper';
}

function nativeMusicContext(state = store?.state) {
  return apple.nativeEnabled?.() || liveReceiverIsNative(state);
}

const store = new CloudStore({
  onState: state => {
    spotify.clientId = String(state.config.spotifyClientId || spotify.clientId);
    if (!automaticAnnouncementsEnabled(state)) {
      const nextScheduleFingerprint = pushcutScheduleFingerprint(state);
      if (!observedPushcutScheduleFingerprint) {
        observedPushcutScheduleFingerprint = nextScheduleFingerprint;
      } else if (nextScheduleFingerprint !== observedPushcutScheduleFingerprint) {
        observedPushcutScheduleFingerprint = nextScheduleFingerprint;
        queuePushcutScheduleSync();
      }
    }
    const nextEmailWakeFingerprint = emailWakeScheduleFingerprint(state);
    if (!observedEmailWakeScheduleFingerprint) {
      observedEmailWakeScheduleFingerprint = nextEmailWakeFingerprint;
    } else if (nextEmailWakeFingerprint !== observedEmailWakeScheduleFingerprint) {
      observedEmailWakeScheduleFingerprint = nextEmailWakeFingerprint;
      emailWakeScheduleStatus = {
        ...emailWakeScheduleStatus,
        current: false
      };
      queueEmailWakeScheduleSync();
    }
    if (!(state.schedules || []).some(schedule => schedule.id === selectedScheduleId)) {
      selectedScheduleId = state.activeScheduleId || state.schedules?.[0]?.id || '';
      if (selectedScheduleId) localStorage.setItem(SCHEDULE_SELECTION_KEY, selectedScheduleId);
    }
    const physicalCustomTarget = runtime?.currentPhysicalCustomTarget?.();
    const effectiveTarget = physicalCustomTarget === null || physicalCustomTarget === undefined
      ? audibleMusicTarget(state, musicLevelDraft === null ? state.config.musicLevel : musicLevelDraft)
      : physicalCustomTarget;
    audio.setMusicLevelPercent?.(
      controlledBrowserGainTarget(state, effectiveTarget),
      { report: false }
    );
    audio.setVoiceLevelPercent?.(VOICE_LEVEL_PERCENT, { report: false });
    apple.setTargetVolumePercent?.(effectiveTarget);
    spotify.setTargetVolumePercent?.(effectiveTarget);
    if (takeoverTarget && (!receiverOnline(state.receiver, store.now()) || state.receiver?.id !== takeoverTarget.id || state.receiver?.sessionId !== takeoverTarget.sessionId)) {
      takeoverTarget = null;
    }
    if (runtime?.active && !runtime.isOwner()) {
      runtime.failSafeStop('Another receiver session took ownership. Audio stopped on this device.').catch(() => {});
    }
    runtime?.reconcileScheduledPlaybackAuthorization?.().catch(error => setFeedback(`Scheduled playback cancellation failed: ${error.message}`, false));
    renderWhenIdle();
  },
  onStatus: status => {
    if (status.authRequired) {
      authenticated = false;
      runtime?.stop?.({ release: false }).catch(() => {});
    }
    setFeedback(status.message, status.ok);
  }
});

const audio = new AudioEngine({
  onStatus: status => setFeedback(status.message, status.ok),
  onPlayback: state => {
    if (state.type === 'error') setFeedback(`Music playback error: ${state.error}`, false);
    if ((state.type === 'paused' || state.type === 'error') && runtime?.isOwner?.()) {
      setTimeout(() => runtime.reconcileControlledPlayback(state).catch(error => setFeedback(`Playback state update failed: ${error.message}`, false)), 300);
    }
    if (state.type === 'ended' && runtime?.isOwner?.() && store.state.playback.provider === 'controlled' && store.state.playback.intent === 'playing') {
      runtime.handleControlledTrackEnded(state)
        .then(handled => handled || runtime.hasPendingControlledTrackEnd() || runtime.nextMusic({ automatic: true, expectedUrl: state.url }))
        .catch(error => setFeedback(`Next track failed: ${error.message}`, false));
    }
  }
});

const apple = new AppleMusicReceiver({
  onStatus: status => setFeedback(status.message, status.ok),
  onState: () => renderWhenIdle()
});

const spotify = new SpotifyReceiver({
  clientId: store.state.config.spotifyClientId,
  onStatus: status => setFeedback(status.message, status.ok),
  onState: () => renderWhenIdle()
});

audio.setMusicLevelPercent(
  controlledBrowserGainTarget(store.state),
  { report: false }
);
audio.setVoiceLevelPercent?.(audibleVoiceTarget(store.state), { report: false });
apple.setTargetVolumePercent(audibleMusicTarget(store.state));
spotify.setTargetVolumePercent(audibleMusicTarget(store.state));

const runtime = new ReceiverRuntime({
  store,
  audio,
  apple,
  spotify,
  onStatus: status => setFeedback(status.message, status.ok),
  onChange: () => renderWhenIdle(),
  shouldDelegateScheduledAnnouncements:
    () => automaticTimedAnnouncementsDelegated(),
  isExternalAutomationActive: async () => {
    const status = await refreshEmailWakeStatus();
    return status.executionActive === true;
  },
  withExternalAudioLease: work =>
    withEmailWakeBrowserAudioLease(work, {
      onLeaseWarning: message => setFeedback(message, false)
    }),
  onExternalAnnouncement: (text, options) =>
    dispatchAutomaticAnnouncement({ text, ...options }),
  onExternalMusicTarget: (percent, context) =>
    applyReceiverMusicTargetNow(percent, context)
});

function effectiveProvider() {
  return store.state.playback.intent === 'stopped'
    ? store.state.config.musicProvider
    : (store.state.playback.provider || store.state.config.musicProvider);
}

function cloudAppleMusicVerified() {
  const playback = store.state.playback;
  const target = audibleMusicTarget(store.state);
  const verifiedPercent = playback.volumeVerifiedPercent;
  return playback.provider === 'apple' &&
    playback.volumeVerified === true &&
    verifiedPercent !== null && verifiedPercent !== '' &&
    Number.isFinite(Number(verifiedPercent)) && Number(verifiedPercent) === target &&
    store.state.receiver?.audioMode === 'apple-verified-volume-pause' &&
    receiverOnline(store.state.receiver, store.now()) &&
    store.now() - Number(playback.volumeVerifiedAt || playback.updatedAt || 0) <= 25_000;
}

function cloudSpotifyVerified() {
  const playback = store.state.playback;
  const target = audibleMusicTarget(store.state);
  const verifiedPercent = playback.volumeVerifiedPercent;
  return playback.provider === 'spotify' &&
    playback.volumeVerified === true &&
    verifiedPercent !== null && verifiedPercent !== '' &&
    Number.isFinite(Number(verifiedPercent)) && Number(verifiedPercent) === target &&
    store.state.receiver?.audioMode === 'spotify-verified-volume-pause' &&
    receiverOnline(store.state.receiver, store.now()) &&
    store.now() - Number(playback.volumeVerifiedAt || playback.updatedAt || 0) <= 25_000;
}

function displayAudioPolicy(provider = effectiveProvider()) {
  const musicPercent = audibleMusicTarget(store.state);
  if (automaticAnnouncementsEnabled()) {
    return {
      id: 'automatic-receiver-dynamic-target',
      exact: false,
      musicPercent,
      voicePercent: VOICE_LEVEL_PERCENT,
      duringVoicePercent: DUCK_LEVEL_PERCENT,
      action: 'automatic-shortcut',
      label: `Automatic sequence ${musicPercent}% → 0% → 100% → ${musicPercent}%`,
      detail: `The background Receiver Shortcut sets the shared output to ${musicPercent}% for music, reaches 0% before playback changes, plays the announcement at 100%, then resumes and restores ${musicPercent}%. Physical speaker loudness is not measured.`
    };
  }
  if (receiverOperatingMode() === 'pushcut') {
    return {
      id: 'pushcut-shortcut-dynamic-target',
      exact: false,
      musicPercent,
      voicePercent: VOICE_LEVEL_PERCENT,
      duringVoicePercent: DUCK_LEVEL_PERCENT,
      action: 'shortcut',
      label: `Shortcut sequence ${musicPercent}% → 0% → 100% → ${musicPercent}%`,
      detail: `Pushcut pauses native music, sets the shared output to 100% for the announcement, waits for Play Sound to finish, restores ${musicPercent}%, and resumes music. iOS does not report the resulting physical speaker loudness back to Version X.`
    };
  }
  if (provider === 'apple' && cloudAppleMusicVerified()) {
    return audioPolicy({ provider: 'apple', isIOS: false, supportsVolume: true, volumeVerified: true, verifiedPercent: musicPercent, musicPercent, voicePercent: audibleVoiceTarget() });
  }
  if (provider === 'spotify' && cloudSpotifyVerified()) {
    return audioPolicy({ provider: 'spotify', isIOS: false, supportsVolume: true, volumeVerified: true, verifiedPercent: musicPercent, musicPercent, voicePercent: audibleVoiceTarget() });
  }
  const external = provider === 'spotify' ? spotify : apple;
  return audioPolicy({
    provider,
    isIOS: activeReceiverIsIOS(),
    supportsVolume: !!external.supportsVolume,
    volumeVerified: !!external.volumeVerified,
    verifiedPercent: external.verifiedPercent,
    musicPercent,
    voicePercent: audibleVoiceTarget()
  });
}

function appleSetupButton({ disabled = false } = {}) {
  const disabledAttribute = disabled ? ' disabled title="Start this speaker receiver first"' : '';
  if (apple.nativeEnabled?.()) {
    const label = apple.readiness().ready ? 'Reconnect Music.app Receiver' : apple.accessVerified ? 'Connect Music.app Receiver' : 'Allow Music.app Control';
    return `<button data-action="connect-apple" class="appleButton"${disabledAttribute}>${label}</button>`;
  }
  if (apple.loggedIn()) {
    const label = apple.playerPrepared
      ? (apple.readiness().ready ? 'Reactivate Apple Browser Playback' : 'Activate Apple Browser Playback')
      : (apple.prepareError ? 'Retry Authorized Session Restore' : 'Restore Authorized Apple Session');
    return `<button data-action="connect-apple" class="appleButton"${disabledAttribute}>${label}</button>`;
  }
  if (apple.authorizationPrepared) {
    return '<button data-action="apple-login" class="appleButton">Authorize Apple Music</button>';
  }
  const label = apple.authorizationPrepareError ? 'Retry Apple Music Preparation' : 'Prepare Apple Music';
  return `<button data-action="apple-prepare" class="appleButton">${label}</button>`;
}

function spotifySetupButton({ disabled = false } = {}) {
  const disabledAttribute = disabled ? ' disabled title="Start this speaker receiver first"' : '';
  if (!spotify.loggedIn()) {
    return `<button data-action="spotify-login" class="spotifyButton">Authorize Spotify Account</button>`;
  }
  if (!spotify.accessVerified) {
    return `<button data-action="verify-spotify-access" class="spotifyButton">Verify Saved Spotify Account</button>`;
  }
  if (!spotify.playerPrepared) {
    return `<button data-action="prepare-spotify" class="spotifyButton"${disabledAttribute}>${spotify.prepareError ? 'Retry Browser Playback Setup' : 'Prepare Spotify Browser Playback'}</button>`;
  }
  return `<button data-action="connect-spotify" class="spotifyButton"${disabledAttribute}>${spotify.readiness().ready ? 'Reactivate Spotify Browser Playback' : 'Activate Spotify Browser Playback'}</button>`;
}

function spotifyDeveloperSetupCard() {
  return `
    <div class="capabilityCard limited spotifyDeveloperSetup">
      <span>Spotify developer app · one-time setup</span>
      <strong>The callback must match exactly, including the trailing slash</strong>
      <p>Open the Spotify Developer Dashboard, choose the app with this Client ID, open Settings, and add the exact Redirect URI below. Keep every prior Poolside Pulse redirect URI; do not replace or remove it.</p>
      <dl class="diagnosticList">
        <div><dt>Client ID</dt><dd><code>${SPOTIFY_CLIENT_ID}</code> <button type="button" data-action="copy-spotify-client-id" class="secondary">Copy</button></dd></div>
        <div><dt>Redirect URI</dt><dd><code>${SPOTIFY_REDIRECT_URI}</code> <button type="button" data-action="copy-spotify-redirect-uri" class="secondary">Copy</button></dd></div>
      </dl>
      <a href="${SPOTIFY_DEVELOPER_DASHBOARD_URL}" target="_blank" rel="noopener noreferrer" class="shortcutLink">Open Spotify Developer Dashboard</a>
    </div>`;
}

function iphoneReceiverModePanel({ owned = false } = {}) {
  const mode = receiverOperatingMode();
  const musicTarget = audibleMusicTarget(store.state);
  const browserSelected = mode === 'browser';
  const browserActive = browserSelected && receiverOnline(store.state.receiver, store.now());
  const automaticEnabled = automaticAnnouncementsEnabled();
  const automaticReady = emailWakeOperational();
  const pairingVisible =
    emailWakePairing.code
    && Number(emailWakePairing.expiresAt || 0) > store.now();
  const automaticSetupIssues = emailWakeStatus.configurationIssues
    .map(message => `<li>${escapeHtml(message)}</li>`)
    .join('');
  const wakeSender = emailWakeStatus.wakeSender || 'shown after server setup';
  const wakeSubject = emailWakeStatus.wakeSubject || 'shown after server setup';
  const wakeRecipient =
    emailWakeStatus.wakeRecipient || 'the configured Receiver email';
  return `
    <section class="workspacePanel receiverModePanel automaticReceiverWizard" aria-labelledby="automaticReceiverSetupTitle" data-build-label="automatic-receiver">
      <div class="sectionHeading receiverTestHeading">
        <div><p class="kicker">Resort Media Hub · Version X</p><h2 id="automaticReceiverSetupTitle">Automatic Receiver setup</h2></div>
        <span class="fixedMix">Music ${musicTarget} · Announcement 100</span>
      </div>
      <div class="setupStatus ${automaticEnabled && automaticReady && browserActive ? 'verified' : 'limited'}" aria-live="polite">
        <strong>${automaticEnabled && automaticReady ? browserActive ? 'Automatic Receiver is verified and ready' : 'Automation verified · start Browser Receiver' : automaticReady ? 'Paired · complete the activation test' : automaticSetupIssues ? 'Automatic Receiver server setup needs attention' : emailWakeStatus.ready ? 'Finish the four one-time steps' : 'Checking Automatic Receiver service'}</strong>
        <span>Automatic Receiver · background Shortcut ready</span>
      </div>
      <p class="setupLead">Do these four steps once on the iPhone connected to the speakers. Keep this Resort Media Hub page visible for Suno, Apple Music, Spotify, and scheduled music; the background automation handles music ${musicTarget}% → 0% → announcement 100% → restore ${musicTarget}%.</p>
      <div class="roleAddressGuide">
        <strong>Use this Version X address on every phone</strong>
        <p>Speaker iPhone: <code>${RECEIVER_TEST_RECEIVER_URL}</code><br />Remote iPhones: <code>${RECEIVER_TEST_REMOTE_URL}</code></p>
        <small>The older <code>poolside-pulse-x.vercel.app</code> address is a separate saved version and cannot control this Receiver.</small>
      </div>
      ${automaticSetupIssues ? `<ul class="scheduleSyncWarnings automaticSetupIssues">${automaticSetupIssues}</ul>` : ''}
      <ol class="receiverSetupSteps automaticSetupSteps">
        <li class="setupStep">
          <div class="setupStepHeading"><span class="setupStepNumber" aria-hidden="true">1</span><div><strong>Install Shortcut</strong><small>Download and add the signed Receiver Shortcut.</small></div></div>
          <a href="${EMAIL_WAKE_X_SHORTCUT_INSTALL_URL}" class="shortcutLink setupAction">Install ${EMAIL_WAKE_X_SHORTCUT_NAME}</a>
          <small>In Safari, tap the <strong>Downloads</strong> arrow → <code>Poolside Pulse X Automatic Receiver.shortcut</code> → <strong>Add Shortcut</strong>, then return here.</small>
        </li>
        <li class="setupStep ${automaticReady ? 'complete' : ''}">
          <div class="setupStepHeading"><span class="setupStepNumber" aria-hidden="true">2</span><div><strong>Pair Receiver</strong><small>Link only this speaker iPhone.</small></div></div>
          <div class="setupStepActions">
            <button type="button" data-action="create-email-wake-pairing" class="secondary" ${emailWakeStatus.ready ? '' : 'disabled'}>Create Pairing Code</button>
            ${!automaticReady && emailWakeStatus.ready ? '<button type="button" data-action="check-email-wake-pairing" class="secondary">Check Pairing</button>' : '<span class="stepComplete">Paired</span>'}
          </div>
          <small>Run the installed Shortcut once, enter the six-digit code, return here, then tap <strong>Check Pairing</strong>.${pairingVisible ? ` <strong class="pairingCode">${escapeHtml(emailWakePairing.code)}</strong>` : ''}</small>
        </li>
        <li class="setupStep ${automaticEnabled ? 'complete' : ''}">
          <div class="setupStepHeading"><span class="setupStepNumber" aria-hidden="true">3</span><div><strong>Create Email Automation</strong><small>One background trigger on this Receiver.</small></div></div>
          <details class="setupInstructions" data-persist-open="automatic-email-automation">
            <summary>Create Email Automation</summary>
            <div class="setupInstructionBody">
              <p>Confirm <code>${escapeHtml(wakeRecipient)}</code> receives messages in Apple Mail on this Receiver iPhone.</p>
              <p>Shortcuts → Automation → <strong>+</strong> → <strong>Email</strong>. Set Sender to <code>${escapeHtml(wakeSender)}</code>${emailWakeStatus.wakeSender ? ` <button type="button" data-action="copy-email-wake-sender" class="secondary compactAction">Copy</button>` : ''}, Subject Contains to <code>${escapeHtml(wakeSubject)}</code>${emailWakeStatus.wakeSubject ? ` <button type="button" data-action="copy-email-wake-subject" class="secondary compactAction">Copy</button>` : ''}, choose <strong>Run Immediately</strong>, then tap Next.</p>
              <p>Choose <strong>${EMAIL_WAKE_X_SHORTCUT_NAME}</strong>. If it is not listed, choose New Blank Automation → Add Action → Run Shortcut → <strong>${EMAIL_WAKE_X_SHORTCUT_NAME}</strong>. Tap Done.</p>
            </div>
          </details>
        </li>
        <li class="setupStep ${automaticEnabled && automaticReady ? 'complete' : ''}">
          <div class="setupStepHeading"><span class="setupStepNumber" aria-hidden="true">4</span><div><strong>Verify &amp; Turn On</strong><small>Version X enables automation only after a signed completion.</small></div></div>
          ${automaticEnabled ? '<span class="stepComplete">Automatic Receiver is on</span>' : `<button type="button" data-action="enable-automatic-announcements" class="primary setupAction" ${automaticReady ? '' : 'disabled'}>Verify &amp; Turn On Automatic Receiver</button>`}
          ${automaticEnabled && automaticReady ? '<button type="button" data-action="email-wake-test" class="secondary setupAction">Run Automatic Receiver Check</button>' : ''}
          <small>Before testing, open <strong>Browser music receiver &amp; account controls</strong> below. Apple Music and Spotify each require their one-time authorization and activation taps on this speaker iPhone; a Remote cannot perform those account-security taps. Then start music and run this signed test.</small>
        </li>
      </ol>
      <small class="setupFootnote">${emailWakeStatus.note ? escapeHtml(emailWakeStatus.note) : automaticReady ? 'The Receiver token is revocable, the email carries no command or credential, and every action waits for a signed completion receipt.' : 'Pairing and the Email automation are required once on the speaker iPhone only. Remote iPhones need no setup.'}</small>
      <details class="receiverDetailDisclosure" data-persist-open="receiver-browser-accounts">
        <summary>Browser music receiver &amp; account controls · required once</summary>
        <div class="capabilityCard ${browserActive ? 'verified' : 'limited'}">
          <span>Mode 1 · remote music control · Receiver browser</span>
          <strong>${browserActive ? 'Browser Receiver is active' : browserSelected ? 'Browser Receiver selected · tap Start Receiver' : 'Browser Receiver is not selected'}</strong>
          <p>The Remote starts, changes, pauses, or stops Suno, Apple Music, or Spotify here. Keep Version X visible on this Receiver iPhone. With Automatic Receiver enabled, background Shortcuts—not browser speech—handles announcements.</p>
          <div class="stackedActions">
            ${appleSetupButton({ disabled: apple.loggedIn() && !owned })}
            ${spotifySetupButton({ disabled: spotify.loggedIn() && !owned })}
          </div>
          <small>Apple Music: Prepare → Authorize → Activate on this Receiver. Spotify: Authorize → Prepare if shown → Activate on this Receiver. After the provider reports ready, any Remote using the Version X Remote address can choose it and tap Play.</small>
        </div>
      </details>
    </section>`;
}

function updateLiveStatus() {
  const banner = document.querySelector('[data-live-feedback]');
  if (banner) {
    banner.className = `feedback ${feedback.ok ? 'good' : 'bad'}`;
    banner.textContent = feedback.message;
  }
  const receiverBadge = document.querySelector('[data-live-receiver]');
  if (receiverBadge) {
    const online = receiverOnline(store.state.receiver, store.now());
    const pushcutReady = pushcutAnnouncementReady();
    const mode = receiverOperatingMode();
    const browserOnline = mode === 'browser' && online;
    const pushcutOperational = mode === 'pushcut' && pushcutAnnouncementOperational();
    const automatic = automaticAnnouncementsEnabled();
    const automaticReady = automatic && emailWakeOperational();
    receiverBadge.textContent = automaticReady && browserOnline
      ? 'Automatic Receiver online'
      : automaticReady
        ? 'Automation ready · music offline'
        : browserOnline
          ? 'Browser Receiver online'
          : pushcutOperational
            ? 'Pushcut ready'
            : mode === 'pushcut' && pushcutReady
              ? 'Pushcut not verified'
              : 'Receiver offline';
    receiverBadge.className = `statusPill ${
      (automaticReady && browserOnline) || browserOnline || pushcutOperational
        ? 'online'
        : automaticReady || pushcutReady
          ? 'warn'
          : 'offline'
    }`;
  }
}

async function runAction(label, action) {
  if (busy) return;
  busy = true;
  const scheduleFingerprintBefore = emailWakeScheduleFingerprint(store.state);
  actionSettled = new Promise(resolve => { settleCurrentAction = resolve; });
  setFeedback(`${label}...`, true);
  renderWhenIdle(true);
  try {
    const result = await action();
    await ensureAutomaticScheduleSyncAfterChange(
      scheduleFingerprintBefore,
      label
    );
    if (feedback.message === `${label}...`) setFeedback(`${label} completed.`, true);
    return result;
  } catch (error) {
    if (error.takeoverRequired) takeoverTarget = error.takeoverTarget || null;
    setFeedback(error.message || String(error), false);
    throw error;
  } finally {
    busy = false;
    settleCurrentAction?.();
    settleCurrentAction = null;
    renderWhenIdle(true);
  }
}

async function restoreStoredAppleAuthorization({ reportSuccess = false } = {}) {
  if (role !== 'receiver' || !apple.loggedIn() || apple.playerPrepared) return apple.playerPrepared;
  try {
    const restored = await apple.restoreAuthorization();
    if (restored && reportSuccess) {
      setFeedback('Apple Music authorization restored. Start the receiver, then tap Connect Apple Music.', true);
    }
    return restored;
  } catch (error) {
    const nextStep = apple.loggedIn() ? 'Tap Retry Apple Music Setup.' : 'Tap Prepare Apple Music, then Authorize Apple Music.';
    setFeedback(`Apple Music setup needs attention: ${error.message || String(error)} ${nextStep}`, false);
    return false;
  }
}

async function bootstrapAuthenticatedApp() {
  await store.load();
  spotify.clientId = String(store.state.config.spotifyClientId || spotify.clientId);
  try {
    const oauthParams = new URLSearchParams(location.search);
    if (oauthParams.has('code') || oauthParams.has('error')) await spotify.completeLoginFromCallback();
  } catch (error) {
    setFeedback(error.message || String(error), false);
  }
  await refreshEmailWakeStatus();
  if (!automaticAnnouncementsEnabled()) {
    await refreshPushcutStatus();
    await refreshPushcutScheduleStatus();
  }
  await refreshEmailWakeScheduleStatus();
  const requestedRole = location.hash === '#receiver' ? 'receiver' : location.hash === '#command' ? 'command' : '';
  if (requestedRole) await setRole(requestedRole, { silent: true });
  if (role === 'command') {
    apple.disconnect();
    spotify.disconnect();
    if (!automaticAnnouncementsEnabled()) queuePushcutScheduleSync(0);
    queueEmailWakeScheduleSync(0);
  } else {
    if (!apple.nativeEnabled?.()) await restoreStoredAppleAuthorization();
    if (spotify.loggedIn()) spotify.preparePlayer().catch(() => {});
  }
  store.startPolling(2_500);
  render();
}

async function bootstrap() {
  document.documentElement.dataset.poolsideVersion = VERSION;
  document.title = 'Lake123 - Poolside Pulse - Resort Media Hub - Version X';
  render();
  try {
    const session = await sessionStatus();
    authenticated = session.authenticated !== false;
    authChecked = true;
    if (authenticated) await bootstrapAuthenticatedApp();
    else render();
  } catch (error) {
    authChecked = true;
    authenticated = false;
    setFeedback(`Poolside access check failed: ${error.message}`, false);
    render();
  }
}

function renderLoading() {
  return `
    <main class="centerStage">
      <section class="accessPanel" aria-live="polite">
        <div class="brandSeal">PP</div>
        <p class="kicker">Lake123</p>
        <h1>Poolside Pulse</h1>
        <p class="candidateBanner">${escapeHtml(receiverTestBuildLabel())}</p>
        <p>Starting the Version X receiver and command system...</p>
        <div class="loadingBar" aria-hidden="true"><span></span></div>
      </section>
    </main>`;
}

function renderLogin() {
  return `
    <main class="centerStage">
      <section class="accessPanel">
        <div class="brandSeal">PP</div>
        <p class="kicker">Lake123</p>
        <h1>Poolside Pulse</h1>
        <p class="candidateBanner">${escapeHtml(receiverTestBuildLabel())}</p>
        <p class="lead">Private pool audio control</p>
        <form data-form="login" class="accessForm">
          <label for="accessPin">Access code</label>
          <input id="accessPin" name="pin" type="password" inputmode="text" autocomplete="current-password" autocapitalize="none" spellcheck="false" maxlength="64" required autofocus />
          <button type="submit" class="primary wide" ${busy ? 'disabled' : ''}>Open Poolside Pulse</button>
        </form>
        <div class="feedback ${feedback.ok ? 'good' : 'bad'}" data-live-feedback>${escapeHtml(feedback.message)}</div>
      </section>
    </main>`;
}

function renderRolePicker() {
  const native = apple.nativeEnabled?.();
  return `
    <main class="centerStage roleStage">
      <section class="rolePanel">
        <div class="brandSeal">PP</div>
        <p class="kicker">Poolside Pulse · ${escapeHtml(receiverTestBuildLabel())}</p>
        <h1>What is this device?</h1>
        <p class="lead">${native ? 'This Mac app is the always-on Apple Music speaker receiver. Use any phone or tablet for commands.' : 'For iPhone operation, use two separate iPhones: one stays on the speakers and one sends commands.'}</p>
        <div class="roleChoices">
          <button class="roleChoice receiverChoice" data-action="choose-role" data-role="receiver">
            <span class="roleIcon" aria-hidden="true">◉</span>
            <strong>Speaker Receiver</strong>
            <small>${native ? 'This Mac, with its system audio output set to the pool speakers.' : 'The iPhone connected to the pool speakers. Keep it plugged in with this page visible.'}</small>
          </button>
          <button class="roleChoice commandChoice" data-action="choose-role" data-role="command">
            <span class="roleIcon" aria-hidden="true">⌁</span>
            <strong>Remote Control</strong>
            <small>The second iPhone for music, announcements, weather, and schedules.</small>
          </button>
        </div>
        <div class="truthNote"><strong>${native ? 'Mac receiver rule:' : 'Two-device rule:'}</strong> ${native ? 'Leave this app running and Music.app signed in. Open the same Version X URL on any other device in Remote Control mode.' : 'Leave the receiver iPhone on this page. Operate Poolside Pulse from the separate command iPhone; remote devices never become Apple Music players.'}</div>
      </section>
    </main>`;
}

function shellStatus() {
  const state = store.state;
  const online = receiverOnline(state.receiver, store.now());
  const pushcutReady = pushcutAnnouncementReady();
  const mode = receiverOperatingMode(state);
  const browserOnline = mode === 'browser' && online;
  const pushcutOperational = mode === 'pushcut' && pushcutAnnouncementOperational();
  const syncGood = store.syncMode === 'kv' || store.syncMode === 'local';
  const policy = displayAudioPolicy();
  const provider = effectiveProvider();
  const providerName = provider === 'spotify' ? 'Spotify' : provider === 'apple' ? 'Apple Music' : 'Suno';
  const automatic = automaticAnnouncementsEnabled(state);
  const automaticReady = automatic && emailWakeOperational();
  const mixStatus = automatic
    ? `Automatic ${audibleMusicTarget(state)} → 0 → 100 → ${audibleMusicTarget(state)}`
    : mode === 'pushcut'
    ? `Shortcut ${audibleMusicTarget(state)} → 0 → 100 → ${audibleMusicTarget(state)} · output unmeasured`
    : policy.exact
    ? `${policy.musicPercent}% music / ${audibleVoiceTarget()}% voice`
    : activeReceiverIsIOS() && ['apple', 'spotify'].includes(provider)
      ? `${providerName} · pauses for voice`
      : `${providerName} ${store.state.config.musicLevel}%?`;
  return `
    <div class="shellStatus">
      <span class="statusPill ${syncGood ? 'online' : 'warn'}">${store.syncMode === 'kv' ? 'Cloud synced' : store.syncMode === 'local' ? 'Local preview' : escapeHtml(store.syncMode)}</span>
      <span class="statusPill ${(automaticReady && browserOnline) || browserOnline || pushcutOperational ? 'online' : automaticReady || pushcutReady ? 'warn' : 'offline'}" data-live-receiver>${automaticReady && browserOnline ? 'Automatic Receiver online' : automaticReady ? 'Automation ready · music offline' : browserOnline ? 'Browser Receiver online' : pushcutOperational ? 'Pushcut ready' : mode === 'pushcut' && pushcutReady ? 'Pushcut not verified' : 'Receiver offline'}</span>
      <span class="statusPill mix">${escapeHtml(mixStatus)}</span>
    </div>`;
}

function receiverTestBuildLabel() {
  return 'Resort Media Hub · Version X';
}

function renderHeader() {
  return `
    <header class="appHeader" data-build-label="resort-media-hub">
      <div class="brandLockup">
        <div class="brandSeal small">PP</div>
        <div><span>Lake123</span><strong>Poolside Pulse</strong><small class="candidateBuild">${escapeHtml(receiverTestBuildLabel())}</small></div>
      </div>
      ${shellStatus()}
      <div class="deviceMode roleBadge" aria-label="Device role"><span>${role === 'receiver' ? 'Speaker Receiver' : 'Remote Control'}</span></div>
    </header>`;
}

function tabs() {
  const items = role === 'receiver'
    ? [['receiver', 'Receiver'], ['control', 'Music'], ['announce', 'Announce'], ['schedule', 'Schedule'], ['activity', 'Activity'], ['settings', 'Settings']]
    : [['control', 'Music'], ['announce', 'Announce'], ['schedule', 'Schedule'], ['activity', 'Activity'], ['settings', 'Settings']];
  if (!items.some(([id]) => id === activeTab)) activeTab = items[0][0];
  return `<nav class="tabs tabs-${items.length}" aria-label="Poolside controls">${items.map(([id, label]) => `<button data-action="tab" data-tab="${id}" data-focus-key="tab-${id}" class="${activeTab === id ? 'active' : ''}" ${activeTab === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`;
}

function allowedTabsForRole() {
  return role === 'receiver'
    ? ['receiver', 'control', 'announce', 'schedule', 'activity', 'settings']
    : ['control', 'announce', 'schedule', 'activity', 'settings'];
}

function feedbackBanner() {
  if (pendingTab) {
    return `<div class="feedback bad unsavedPrompt" role="alertdialog" aria-modal="false" aria-labelledby="unsavedPromptTitle"><strong id="unsavedPromptTitle">Unsaved edits will be discarded if you leave this page.</strong><span class="promptActions"><button data-action="confirm-tab" data-tab="${escapeAttr(pendingTab)}" class="danger">Discard & Leave</button><button data-action="cancel-tab" class="secondary">Keep Editing</button></span></div>`;
  }
  return `<div class="feedback ${feedback.ok ? 'good' : 'bad'}" data-live-feedback role="status">${escapeHtml(feedback.message)}</div>`;
}

function receiverSummary() {
  const receiver = store.state.receiver;
  const online = receiverOnline(receiver, store.now());
  const mode = receiverOperatingMode();
  if (mode === 'browser' && online) {
    return automaticAnnouncementsEnabled()
      ? `<strong>${escapeHtml(receiver.name || 'Automatic Receiver')}</strong><span>Browser music + background announcements · ${emailWakeOperational() ? 'automation paired' : 'automation setup incomplete'} · seen ${escapeHtml(relativeTime(receiver.lastSeen))}</span>`
      : `<strong>${escapeHtml(receiver.name || 'Browser Receiver')}</strong><span>Browser Receiver mode · ${escapeHtml(receiver.detail || 'Ready')} · seen ${escapeHtml(relativeTime(receiver.lastSeen))}</span>`;
  }
  if (mode === 'pushcut' && pushcutAnnouncementReady()) {
    return `<strong>Pushcut announcement path ${pushcutAnnouncementOperational() ? 'connected and recently verified' : pushcutStatus.connectedReady ? 'connected' : 'configured; live connection not yet confirmed'}</strong><span>Open Pushcut on the Receiver iPhone and keep Ready For Requests visible. Every command waits for its own signed completion receipt; native music is controlled on that iPhone, not from the Remote.</span>`;
  }
  return mode === 'browser'
    ? '<strong>Browser Receiver is selected but offline</strong><span>Open Version X on the speaker device and tap Start Receiver. Automatic announcements remain armed in the background.</span>'
    : '<strong>No receiver online</strong><span>Open Version X on the speaker device and tap Start Receiver.</span>';
}

function playbackCard() {
  if (receiverOperatingMode() === 'pushcut') {
    const target = audibleMusicTarget(store.state);
    return `
      <section class="nowPlaying manual" data-now-playing>
        <div class="nowMark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="nowText">
          <div class="nowMeta"><p class="kicker">Pushcut announcement mode</p></div>
          <h2>Native music bed status is manual</h2>
          <p>Choose the native music directly on the Receiver iPhone. The Remote slider sets ${target}%; each announcement pauses music, plays at 100%, restores ${target}%, and resumes. Physical speaker loudness is not measured.</p>
        </div>
        <div class="transport" aria-label="Native playback status">
          <span class="statusPill warn">Browser controls unavailable</span>
        </div>
      </section>`;
  }
  const playback = store.state.playback;
  const audibleTarget = audibleMusicTarget(store.state);
  const calibrationActive = !!audio.status().calibrationActive;
  const playing = calibrationActive || playback.intent === 'playing';
  const paused = !calibrationActive && playback.intent === 'paused';
  const provider = calibrationActive
    ? 'Receiver sound check'
    : playback.provider === 'apple'
      ? 'Apple Music'
      : playback.provider === 'spotify'
        ? 'Spotify'
        : 'Suno / Direct';
  const appleVerified = cloudAppleMusicVerified();
  const spotifyVerified = cloudSpotifyVerified();
  const localAppleMusicLabel = playback.provider === 'apple' && runtime.isOwner() && apple.current?.name
    ? `${apple.current.name}${apple.current.artists ? ` - ${apple.current.artists}` : ''}`
    : '';
  const localSpotifyLabel = playback.provider === 'spotify' && runtime.isOwner() && spotify.current?.name
    ? `${spotify.current.name}${spotify.current.artists ? ` - ${spotify.current.artists}` : ''}`
    : '';
  const displayLabel = calibrationActive
    ? `${Math.round(audio.status().musicLevelPercent)}% sound-check tone`
    : (localAppleMusicLabel || localSpotifyLabel || playback.label || 'Nothing playing');
  const displayDetail = calibrationActive
    ? `Temporary test tone · announcements silence it to ${DUCK_LEVEL_PERCENT}%`
    : `${provider} · ${playback.provider === 'apple' || playback.provider === 'spotify'
      ? ((playback.provider === 'apple' ? appleVerified : spotifyVerified)
          ? `receiver-verified at ${audibleTarget}%`
          : activeReceiverIsIOS()
            ? automaticAnnouncementsEnabled()
              ? `iPhone physical output · Automatic ${audibleTarget} → 0 → 100 → ${audibleTarget}`
              : receiverOperatingMode() === 'pushcut'
              ? `iPhone physical output · Pushcut ${audibleTarget} → 0 → 100 → ${audibleTarget}`
              : 'iPhone physical output · pauses completely for voice'
            : `pause-for-voice mode; ${audibleTarget}% target unverified`)
      : `music bus set to ${audibleTarget}%`}`;
  const allowedTabs = allowedTabsForRole();
  const safePreviousTab = allowedTabs.includes(previousTab) && previousTab !== activeTab ? previousTab : '';
  const safeFallbackTab = activeTab !== 'control'
    ? 'control'
    : role === 'receiver'
      ? 'receiver'
      : 'schedule';
  const backTarget = safePreviousTab
    ? previousTab
    : allowedTabs.includes(safeFallbackTab) && safeFallbackTab !== activeTab
      ? safeFallbackTab
      : 'control';
  return `
    <section class="nowPlaying ${playing ? 'playing' : ''} ${calibrationActive ? 'calibrating' : ''}" data-now-playing>
      <div class="nowMark" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="nowText">
        <div class="nowMeta"><p class="kicker">${calibrationActive ? 'Sound check playing' : playing ? 'Now playing' : playback.intent === 'paused' ? 'Paused' : 'Ready'}</p><button data-action="now-back" data-tab="${escapeAttr(backTarget)}" class="nowBack secondary" type="button">Back</button></div>
        <h2>${escapeHtml(displayLabel)}</h2>
        <p>${escapeHtml(displayDetail)}</p>
      </div>
      <div class="transport" aria-label="Playback controls">
        ${calibrationActive
          ? '<button data-action="stop-calibration" class="danger alwaysAvailable" type="button">Stop Sound Check</button>'
          : `<button data-action="transport" data-command="previous-music" class="secondary" title="Previous track" ${!playing && !paused ? 'disabled' : ''}>Previous</button>
             <button data-action="transport" data-command="${paused ? 'resume-music' : 'pause-music'}" class="secondary" title="${paused ? 'Resume' : 'Pause'}" ${!playing && !paused ? 'disabled' : ''}>${paused ? 'Resume' : 'Pause'}</button>
             <button data-action="transport" data-command="next-music" class="secondary" title="Next track" ${!playing && !paused ? 'disabled' : ''}>Next</button>
             <button data-action="transport" data-command="stop-music" class="danger" title="Stop" ${!playing && !paused ? 'disabled' : ''}>Stop</button>`}
      </div>
    </section>`;
}

function renderReceiver() {
  const receiver = store.state.receiver;
  const online = receiverOnline(receiver, store.now());
  const owned = runtime.isOwner();
  const other = online && (!runtime.active || receiver.id !== runtime.deviceId || receiver.sessionId !== runtime.sessionId);
  const activeProvider = effectiveProvider();
  const policy = displayAudioPolicy(activeProvider);
  const pushcutMode = receiverOperatingMode() === 'pushcut';
  const automaticMode = automaticAnnouncementsEnabled();
  const audioStatus = audio.status();
  const audibleTarget = audibleMusicTarget(store.state);
  const calibrationActive = !!audioStatus.calibrationActive;
  const native = apple.nativeEnabled?.();
  const readiness = [
    ['Cloud commands', store.syncMode === 'kv', store.syncMode === 'kv' ? 'Durable KV connected' : `Current mode: ${store.syncMode}`],
    ['Audio mixer', owned && audioStatus.unlocked, owned ? `${audibleTarget}/${audibleVoiceTarget()} mixer unlocked` : 'Tap Start Receiver'],
    ['Receiver lease', owned, owned ? 'This is the only active sound owner' : online ? `${receiver.name || 'Receiver'} owns sound` : 'No active receiver'],
    ['Weather scan', Number(store.state.weather.checkedAt || 0) > 0, store.state.weather.checkedAt ? `Last check ${relativeTime(store.state.weather.checkedAt)}` : 'Runs after receiver starts'],
    [native ? 'Mac awake' : 'Screen awake', native ? owned : !!runtime.wakeLock, native ? 'The receiver app prevents idle system sleep while it is running' : runtime.wakeLock ? 'Wake lock active' : 'Keep this page visible and device plugged in']
  ];
  const liveSchedule = getActiveSchedule(store.state);
  const scheduledAppleMusic = liveSchedule?.enabled !== false && (liveSchedule?.items || [])
    .some(item => item?.enabled !== false && scheduleItemKind(item) === 'apple');
  const scheduledSpotify = liveSchedule?.enabled !== false && (liveSchedule?.items || [])
    .some(item => item?.enabled !== false && scheduleItemKind(item) === 'spotify');
  const appleRelevant = activeProvider === 'apple' || apple.loggedIn() || scheduledAppleMusic;
  if (appleRelevant) {
    const localAppleMusicReadiness = apple.readiness();
    readiness.push(
      [native ? 'Music.app permission' : 'Apple account authorization', native ? apple.accessVerified : apple.loggedIn(), native ? (apple.accessVerified ? 'macOS Automation permission verified' : 'Tap Allow Music.app Control and approve the macOS prompt') : apple.loggedIn() ? 'Account authorization saved on this speaker receiver' : apple.authorizationPrepared ? 'Tap Authorize Apple Music now' : scheduledAppleMusic ? 'Tap Prepare Apple Music, then Authorize Apple Music' : 'First tap Prepare Apple Music, then tap Authorize Apple Music'],
      [native ? 'Apple Music receiver' : 'Apple browser playback', localAppleMusicReadiness.ready, localAppleMusicReadiness.detail]
    );
  }
  const spotifyRelevant = activeProvider === 'spotify' || spotify.loggedIn() || scheduledSpotify;
  if (spotifyRelevant) {
    const localSpotifyReadiness = spotify.readiness();
    readiness.push(
      ['Spotify account authorization', spotify.loggedIn(), spotify.loggedIn() ? spotify.accessVerified ? 'Saved account verified for Spotify Web API access' : 'Account saved; choose Verify Saved Spotify Account in Settings' : spotify.accessError || 'Choose Authorize Spotify Account in Settings'],
      ['Spotify browser playback', localSpotifyReadiness.ready, localSpotifyReadiness.detail]
    );
  }
  return `
    <section class="receiverHero ${owned ? 'ready' : ''}">
      <div class="receiverCopy">
        <p class="kicker">Speaker receiver</p>
        <h1>${owned ? 'Receiver is live' : other ? 'Another receiver is live' : 'Start the speaker'}</h1>
        <p>${escapeHtml(owned ? policy.detail : other ? `${receiver.name || 'Another device'} is currently controlling speaker audio.` : 'One tap unlocks audio, starts a fresh command session, and ignores every older queued command.')}</p>
        <div class="receiverActions">
          ${owned
              ? `<button data-action="stop-receiver" class="danger">Stop Receiver</button>${calibrationActive
                ? '<button data-action="stop-calibration" class="danger alwaysAvailable">Stop Sound Check</button>'
                : `<button data-action="calibration" class="secondary">Run ${audibleTarget}/${audibleVoiceTarget()} Sound Check</button>`}`
            : takeoverTarget
              ? `<button data-action="start-receiver" data-takeover="true" class="danger heroButton">Confirm Take Over Receiver</button>`
              : `<button data-action="start-receiver" class="primary heroButton">${other ? 'Review Receiver Takeover' : 'Start Receiver'}</button>`}
          ${isIOSLike() || other ? '' : activeProvider === 'spotify'
            ? spotifySetupButton({ disabled: spotify.loggedIn() && !owned })
            : activeProvider === 'apple'
              ? appleSetupButton({ disabled: apple.loggedIn() && !owned })
              : ''}
        </div>
      </div>
      <div class="mixMeter" aria-label="Audio levels">
        <div><span>${automaticMode ? 'Automatic music target' : pushcutMode ? 'Music Shortcut target' : activeReceiverIsIOS() && ['apple', 'spotify'].includes(activeProvider) ? 'Music output' : 'Music target'}</span><strong>${automaticMode ? `${audibleTarget}% target` : pushcutMode ? `${audibleTarget}%` : policy.exact ? `${policy.musicPercent}%` : activeReceiverIsIOS() && ['apple', 'spotify'].includes(activeProvider) ? 'Physical' : `${audibleTarget}%?`}</strong><i style="--level:${audibleTarget / 100}"></i></div>
        <div><span>Announcement target</span><strong>${VOICE_LEVEL_PERCENT}%</strong><i style="--level:1"></i></div>
        <small>${automaticMode ? `Automatic Receiver runs ${audibleTarget}% music → 0% → announcement 100% → 0% → resume → restore ${audibleTarget}%. Physical speaker loudness is not measured.` : pushcutMode ? `The Receiver Shortcut pauses music, sets 100% for speech, waits for playback completion, then restores ${audibleTarget}% and resumes. Physical loudness is not measured.` : policy.exact ? `The receiver has verified this music level. Announcements are fixed at ${VOICE_LEVEL_PERCENT}%.` : activeReceiverIsIOS() && ['apple', 'spotify'].includes(activeProvider) ? `${activeProvider === 'spotify' ? 'Spotify' : 'Apple Music'} uses physical iPhone/speaker loudness in Browser mode and pauses completely before voice.` : 'External music volume is not software-verified here. It pauses completely before voice or Suno plays.'}</small>
      </div>
    </section>
    ${iphoneReceiverModePanel({ owned })}
    ${native ? '<div class="callout"><strong>One shared speaker output</strong><p>Choose the pool speaker in macOS Control Center > Sound. Do not select a Music.app-only AirPlay destination: Music.app and spoken announcements must use the same Mac system output.</p></div>' : ''}
    ${other ? `<div class="callout warning"><strong>Takeover protection</strong><p>Starting here will stop commands from targeting ${escapeHtml(receiver.name || 'the other receiver')}. Only take over if that device is no longer connected to the speakers.</p></div>` : ''}
    <details class="readinessPanel receiverDiagnostics" data-persist-open="receiver-diagnostics">
      <summary><span><span class="kicker">Live readiness</span><strong>Receiver diagnostics</strong></span><span class="score">${readiness.filter(([, ok]) => ok).length}/${readiness.length}</span></summary>
      <div class="readinessGrid">${readiness.map(([label, ok, detail]) => `<div class="readinessItem ${ok ? 'pass' : 'todo'}"><span>${ok ? 'Ready' : 'Check'}</span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></div>`).join('')}</div>
    </details>
    ${playbackCard()}
    <section class="weatherStrip ${store.state.weather.tornadoActive || store.state.weather.lightningActive ? 'dangerState' : store.state.weather.windActive ? 'warningState' : ''}">
      <div><p class="kicker">Weather guard</p><h2>${store.state.weather.tornadoActive ? 'Tornado warning active' : store.state.weather.lightningActive ? 'Lightning hold active' : store.state.weather.windActive ? 'Strong wind active' : receiverOperatingMode() === 'browser' ? 'Monitoring every two minutes' : receiverOperatingMode() === 'pushcut' ? 'Immediate manual checks ready' : 'Start a receiver to monitor'}</h2><p>${escapeHtml(store.state.weather.status)}</p></div>
      <button data-action="weather-check" class="secondary">Check Now</button>
    </section>`;
}

function providerSelector() {
  const provider = store.state.config.musicProvider;
  const target = store.state.config.musicLevel;
  const iphoneExternal = activeReceiverIsIOS();
  const pushcutMode = receiverOperatingMode() === 'pushcut';
  const automatic = automaticAnnouncementsEnabled();
  const iphoneTarget = automatic
    ? `Automatic ${target}% bed`
    : pushcutMode
      ? `Shortcut ${target}% bed`
      : 'Physical volume · pauses for voice';
  return `
    <div class="providerSelector" role="group" aria-label="Music source">
      <button aria-pressed="${provider === 'controlled'}" data-action="provider" data-provider="controlled" class="${provider === 'controlled' ? 'active' : ''}"><strong>Manager Volume · Suno / Direct</strong><small>Exact ${target}% music / ${audibleVoiceTarget()}% announcements</small></button>
      <button aria-pressed="${provider === 'apple'}" data-action="provider" data-provider="apple" class="${provider === 'apple' ? 'active' : ''}"><strong>Apple Music</strong><small>${cloudAppleMusicVerified() ? `Verified ${target}%` : iphoneExternal ? iphoneTarget : liveReceiverIsNative() ? `Music.app ${target}% target` : `${target}% target`}</small></button>
      <button aria-pressed="${provider === 'spotify'}" data-action="provider" data-provider="spotify" class="${provider === 'spotify' ? 'active' : ''}"><strong>Spotify</strong><small>${cloudSpotifyVerified() ? `Verified ${target}%` : iphoneExternal ? iphoneTarget : `${target}% target`}</small></button>
    </div>`;
}

function musicLevelControl() {
  const pushcutMode = receiverOperatingMode() === 'pushcut';
  const automatic = automaticAnnouncementsEnabled();
  const receiverManaged = pushcutMode || automatic;
  const target = clamp(musicLevelDraft === null ? store.state.config.musicLevel : musicLevelDraft, 0, 100, 30);
  const customTarget = customPlaybackMusicTarget(store.state);
  const iphoneExternal = !receiverManaged && ['apple', 'spotify'].includes(store.state.config.musicProvider) && activeReceiverIsIOS();
  const externalProviderName = store.state.config.musicProvider === 'spotify' ? 'Spotify' : 'Apple Music';
  return `
    <section class="volumeControl" aria-labelledby="musicLevelLabel">
      <div class="volumeHeading"><div><p class="kicker">${receiverManaged ? 'Receiver music target' : iphoneExternal ? 'Remote volume available' : 'Shared music target'}</p><h2 id="musicLevelLabel">${iphoneExternal ? 'Manager-controlled music volume' : 'Music volume'}</h2></div><output for="musicLevel" data-music-level-output>${target}%</output></div>
      <input id="musicLevel" type="range" min="0" max="100" step="1" value="${target}" aria-labelledby="musicLevelLabel" aria-describedby="musicLevelHelp" aria-valuetext="${receiverManaged ? `${target}% native music; zero during announcements; announcements 100%` : iphoneExternal ? `${target}% manager-volume target; releasing switches music to Suno or Direct` : `${target}% music; announcements ${audibleVoiceTarget()}%`}" style="--level:${target / 100}" />
      <div class="volumeScale" aria-hidden="true"><span>0%</span><span>Default 30%</span><span>100%</span></div>
      ${pushcutMode && pushcutMusicVolumeReady() ? `<div class="managedVolumePrompt pushcutVolumePrompt"><div><strong>Apply ${target}% to the Receiver now</strong><span>Keep Pushcut on <em>Ready For Requests</em>. The dynamic recovery Shortcut sets the iPhone media output to this slider value; completion is confirmed, but physical speaker loudness is not measured.</span><small class="pushcutVolumeResult ${escapeAttr(pushcutVolumeStatus.state)}">${escapeHtml(pushcutVolumeStatus.message)}</small></div><button type="button" data-action="apply-pushcut-music-target" data-music-percent="${target}" class="primary">Apply Music ${target}% Now</button></div>` : ''}
      ${automatic ? `<div class="managedVolumePrompt pushcutVolumePrompt"><div><strong>Apply ${target}% to the Receiver now</strong><span>The background Automatic Receiver Shortcut sets this iPhone media target without opening Pushcut. Completion is signed; physical speaker loudness is not measured.</span><small class="pushcutVolumeResult ${escapeAttr(emailWakeVolumeStatus.state)}">${escapeHtml(emailWakeVolumeStatus.message)}</small></div><button type="button" data-action="apply-pushcut-music-target" data-music-percent="${target}" class="primary" ${emailWakeOperational() ? '' : 'disabled'}>Apply Music ${target}% Now</button></div>` : ''}
      ${iphoneExternal ? `<div class="managedVolumePrompt"><div><strong>Use a volume the manager can actually control</strong><span data-managed-volume-description>iPhone cannot lower protected ${externalProviderName} playback in a web page. This starts the saved Suno / Direct bed at ${target}%; ${externalProviderName} stays authorized for later.</span></div><button type="button" data-action="enable-managed-volume" data-managed-volume-button class="primary">Start Manager Volume · ${target}%</button></div>` : ''}
      <p id="musicLevelHelp">${receiverManaged
        ? `This slider is the single music target. Every announcement pauses the music, sets announcement output to 100%, waits for playback to finish, restores ${target}%, and resumes the same music.`
        : iphoneExternal
        ? `Move and release the slider to save the target without unexpectedly starting paused music. Tap Start Manager Volume to safely pause ${externalProviderName} and start the saved Suno source at ${target}%. Announcements then silence music to ${DUCK_LEVEL_PERCENT}% and play at ${audibleVoiceTarget()}%.`
        : `${customTarget === null ? 'Applies immediately' : `Saves the shared target for later; the current schedule item remains at its custom ${customTarget}%`} for Suno/direct on the receiver and to Apple Music only when that desktop receiver verifies volume control. Apple Music always pauses before Suno or speech; it never overlaps an announcement.`}</p>
    </section>`;
}

function voiceLevelControl() {
  return `
    <section class="volumeControl voiceVolumeControl" aria-labelledby="voiceLevelLabel">
      <div class="volumeHeading"><div><p class="kicker">Fixed announcement target</p><h2 id="voiceLevelLabel">Announcement volume</h2></div><output data-voice-level-output>${VOICE_LEVEL_PERCENT}%</output></div>
      <div class="fixedVoiceNote"><strong>Always ${VOICE_LEVEL_PERCENT}%</strong><span>Speak Now, saved messages, safety alerts, weather, and every scheduled announcement use the same fixed level. Music is fully silent before speech starts and restores only after playback finishes.</span></div>
      <p id="voiceLevelHelp">Natural generated audio is required. Version X reports a failure instead of silently falling back to computer speech or lowering an announcement.</p>
    </section>`;
}

function musicSourceForm() {
  const config = store.state.config;
  if (config.musicProvider === 'spotify') {
    const policy = displayAudioPolicy('spotify');
    const receiverSpotifyReady = receiverOnline(store.state.receiver, store.now()) && store.state.receiver?.spotifyStatus === 'ready';
    return `
      <form data-form="spotify-play" class="sourceForm">
        <label for="spotifyUrl">Spotify playlist, album, artist, or track</label>
        <div class="inputAction"><input id="spotifyUrl" name="url" type="url" value="${escapeAttr(config.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST)}" placeholder="https://open.spotify.com/..." required /><button type="submit" class="spotifyButton" ${receiverSpotifyReady ? '' : 'disabled'}>Play Spotify</button></div>
      </form>
      <div class="stackedActions"><button type="button" data-action="test-spotify-source" class="secondary" ${receiverSpotifyReady ? '' : 'disabled'}>Test with a public Spotify track</button></div>
      ${receiverSpotifyReady ? '' : `<div class="callout warning"><strong>Spotify is not ready on the speaker receiver.</strong><p>${escapeHtml(store.state.receiver?.spotifyDetail || 'On the receiver, log in to Spotify, check access, then tap Connect Spotify Receiver.')}</p></div>`}
      <div class="capabilityCard ${policy.exact ? 'verified' : 'limited'}"><span>${policy.exact ? 'Verified path' : 'Compatibility path'}</span><strong>${escapeHtml(policy.label)}</strong><p>${escapeHtml(policy.detail)}</p></div>
      <div class="policyNote"><strong>Same iPhone rule as Apple Music:</strong> Spotify uses the receiver’s shared physical output. ${automaticAnnouncementsEnabled() ? `Automatic Receiver runs Music ${audibleMusicTarget()}% → 0% → Announcement 100% → 0% → resume → restore ${audibleMusicTarget()}%. Physical loudness is not measured.` : receiverOperatingMode() === 'pushcut' ? `The Receiver Shortcut runs Pause → Announcement 100% → Play Sound to completion → Music ${audibleMusicTarget()}% → Play. Physical loudness is not measured.` : 'Browser Receiver pauses Spotify completely for each announcement, then resumes it; physical music loudness remains controlled by the iPhone or speaker.'} A Spotify Premium account and receiver login are required.</div>`;
  }
  if (config.musicProvider === 'apple') {
    const iphoneApple = activeReceiverIsIOS();
    const policy = displayAudioPolicy('apple');
    const receiverAppleMusicReady = receiverOnline(store.state.receiver, store.now()) && store.state.receiver?.appleStatus === 'ready';
    return `
      <form data-form="apple-play" class="sourceForm">
        <label for="appleUrl">Apple Music playlist, album, artist, or track</label>
        <div class="inputAction"><input id="appleUrl" name="url" type="url" value="${escapeAttr(config.appleUrl || '')}" placeholder="https://music.apple.com/us/album/..." required /><button type="submit" class="appleButton" ${receiverAppleMusicReady ? '' : 'disabled'}>${iphoneApple ? 'Play Apple Music · physical volume' : 'Play Apple Music'}</button></div>
      </form>
      ${receiverAppleMusicReady ? '' : `<div class="callout warning"><strong>Apple Music is not ready on the speaker receiver.</strong><p>${escapeHtml(store.state.receiver?.appleDetail || (liveReceiverIsNative() ? 'On the receiver Mac, allow Automation and connect Music.app.' : 'Open Settings on the receiver, authorize Apple Music, then tap Connect Apple Music.'))}</p></div>`}
      <div class="capabilityCard ${policy.exact ? 'verified' : 'limited'}">
        <span>${policy.exact ? 'Verified path' : 'Compatibility path'}</span>
        <strong>${escapeHtml(policy.label)}</strong>
        <p>${escapeHtml(policy.detail)}</p>
      </div>
      <div class="policyNote"><strong>Safe Apple behavior:</strong> Poolside Pulse pauses Apple Music completely before Suno or speech and resumes it only afterward; the sources never overlap. ${iphoneApple ? automaticAnnouncementsEnabled() ? `Automatic Receiver applies Music ${audibleMusicTarget()}% → 0% → Announcement 100% → 0% → resume → restore ${audibleMusicTarget()}%; physical loudness is not measured.` : 'The active receiver is an iPhone: Browser mode uses the iPhone or connected speaker controls; Pushcut mode applies the shared music slider. Suno music remains adjustable and announcements are fixed at 100%.' : 'Exact Apple Music volume is shown only after a desktop receiver verifies it.'} An active Apple Music subscription and an open, signed-in receiver are required.</div>`;
  }
  return `
    <form data-form="controlled-play" class="sourceForm">
      <label for="musicUrl">Suno playlist, Suno song, or direct HTTPS audio URL</label>
      <div class="inputAction"><input id="musicUrl" name="url" type="url" value="${escapeAttr(config.musicUrl || '')}" placeholder="https://suno.com/playlist/..." required /><button type="submit" class="primary">Play at ${config.musicLevel}%</button></div>
    </form>
    <div class="capabilityCard verified"><span>Guaranteed path</span><strong>One calibrated mixer</strong><p>Music stays at exactly ${config.musicLevel}%. During announcements it fades completely to ${DUCK_LEVEL_PERCENT}%, voice plays at ${audibleVoiceTarget()}%, and the same track continues afterward.</p></div>`;
}

function renderControl() {
  const online = receiverOnline(store.state.receiver, store.now());
  const policy = displayAudioPolicy(store.state.config.musicProvider);
  const operatingMode = receiverOperatingMode();
  const browserOnline = operatingMode === 'browser' && online;
  const automatic = automaticAnnouncementsEnabled();
  const pushcutOpenStep = role === 'receiver'
    ? `<a href="${PUSHCUT_RUN_SERVER_URL}">open Pushcut Server</a>`
    : 'return to Pushcut on the Receiver iPhone';
  const modeGuidance = automatic
    ? browserOnline && emailWakeOperational()
      ? `<div class="callout"><strong>Automatic Receiver · music and announcements are ready</strong><p>Keep Version X visible for Suno, Apple Music, Spotify, and music schedule rows. Background Shortcut actions apply music ${audibleMusicTarget()}%, silence it for each 100% announcement, then restore it.</p></div>`
      : '<div class="callout warning"><strong>Automatic Receiver needs attention</strong><p>Finish the one-time Receiver setup and start Browser Receiver before relying on music or announcements.</p></div>'
    : operatingMode === 'browser'
    ? browserOnline
      ? '<div class="callout"><strong>Browser Receiver mode · remote music control is available</strong><p>The speaker receiver must keep Version X visible. Choose Suno, Apple Music, or Spotify below; the Remote can start, change, pause, and stop that browser-owned music bed.</p></div>'
      : '<div class="callout warning"><strong>Browser Receiver mode is selected, but the speaker is offline</strong><p>On the Receiver iPhone, reopen Version X and tap Start Receiver before sending music or voice commands.</p></div>'
    : operatingMode === 'pushcut'
      ? `<div class="callout warning"><strong>Pushcut announcement mode · native music source is chosen on Receiver</strong><p>On the Receiver iPhone, start music in Apple Music, Spotify, or a background-capable Suno app, then ${pushcutOpenStep} and leave Ready For Requests visible. The Remote slider applies ${audibleMusicTarget()}%, and each announcement pauses, speaks at 100%, restores ${audibleMusicTarget()}%, and resumes. To restore browser transport controls, return the Receiver to Version X and tap Start Receiver.</p></div>`
      : '';
  return `
    <section class="pageHeading"><p class="kicker">Music control</p><h1>One source. One receiver.</h1><p>Suno, Apple Music, and Spotify are mutually exclusive. Every command targets the current receiver session; expired commands are never replayed.</p></section>
    <div class="receiverRibbon ${browserOnline || (operatingMode === 'pushcut' && pushcutAnnouncementOperational()) ? 'online' : 'offline'}">${receiverSummary()}</div>
    ${modeGuidance}
    ${playbackCard()}
    <section class="workspacePanel">
      ${musicLevelControl()}
      ${operatingMode === 'pushcut'
        ? `<div class="capabilityCard limited"><span>Native music bed</span><strong>Choose music on the Receiver iPhone</strong><p>Version X intentionally hides browser Play controls in Pushcut mode because Safari is not foreground and cannot own playback. Spotify uses the native Spotify app in this mode, so no Version X Spotify login is required.</p></div>`
        : `<div class="sectionHeading sourceHeading"><div><p class="kicker">Choose music</p><h2>Playback source</h2></div><span class="fixedMix">${policy.exact ? `${policy.musicPercent} / ${policy.voicePercent}` : activeReceiverIsIOS() && ['apple', 'spotify'].includes(store.state.config.musicProvider) ? 'Pauses for voice' : `Target ${store.state.config.musicLevel}%`}</span></div>
          ${providerSelector()}
          ${musicSourceForm()}`}
    </section>`;
}

function announcementSourceById(sourceId = '') {
  const sources = Array.isArray(store.state.announcementSources) ? store.state.announcementSources : [];
  return sources.find(source => source.id === sourceId)
    || sources.find(source => source.id === 'natural-voice')
    || normalizeAnnouncementSource({
      id: 'natural-voice',
      label: 'Natural Voice',
      kind: 'natural-voice',
      provider: 'openai-tts'
    });
}

function announcementSourceOptions(selected = 'natural-voice') {
  const selectedId = String(selected || 'natural-voice');
  const sources = Array.isArray(store.state.announcementSources) ? store.state.announcementSources : [];
  const supported = sources.filter(source => source.playbackSupport === 'supported');
  const experimental = sources.filter(source => source.playbackSupport === 'experimental');
  const providerNames = new Set(experimental.map(source => source.provider));
  const supportedOptions = supported.map(source => {
    const suffix = source.kind === 'natural-voice'
      ? 'Natural speech'
      : `${source.provider === 'suno' ? 'Suno' : 'Direct'} clip · ${source.durationSeconds}s`;
    return `<option value="${escapeAttr(source.id)}" ${source.id === selectedId ? 'selected' : ''}>${escapeHtml(source.label)} — ${escapeHtml(suffix)}</option>`;
  }).join('');
  const experimentalOptions = [
    ...experimental.map(source => ({ label: source.label, provider: source.provider })),
    ...(!providerNames.has('apple') ? [{ label: 'Apple Music catalog', provider: 'apple' }] : []),
    ...(!providerNames.has('spotify') ? [{ label: 'Spotify catalog', provider: 'spotify' }] : [])
  ].map(source => `<option disabled>${escapeHtml(source.label)} — experimental; unavailable for announcements</option>`).join('');
  return `${supportedOptions}<optgroup label="Not executable on one iPhone">${experimentalOptions}</optgroup>`;
}

function announcementSourceSummary(sourceId = '') {
  const source = announcementSourceById(sourceId);
  return source?.kind === 'finite-audio'
    ? `${source.provider === 'suno' ? 'Suno' : 'Direct'} clip · ${source.durationSeconds}s`
    : 'Natural Voice';
}

function finiteAnnouncementSourceFromForm(data, id) {
  const provider = String(data.get('provider') || '').trim().toLowerCase();
  const label = String(data.get('label') || '').trim();
  if (!label) throw new Error('Give the announcement clip a name.');
  const source = normalizeAnnouncementSource({
    id,
    label,
    kind: 'finite-audio',
    provider,
    url: String(data.get('url') || '').trim(),
    finite: true,
    durationSeconds: Number(data.get('durationSeconds'))
  });
  if (!['direct', 'suno'].includes(provider)) throw new Error('Choose Direct or Suno for this short clip.');
  if (source.playbackSupport !== 'supported') {
    throw new Error(`Use a valid HTTPS clip URL and an expected duration from 1 to ${ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS} seconds.`);
  }
  return source;
}

function renderAnnouncementSourceLibrary() {
  const sources = Array.isArray(store.state.announcementSources) ? store.state.announcementSources : [];
  const finiteSources = sources.filter(source => source.kind === 'finite-audio' && ['direct', 'suno'].includes(source.provider));
  return `
    <section class="workspacePanel announcementSourcesPanel">
      <div class="sectionHeading"><div><p class="kicker">Announcement audio</p><h2>Reliable sources</h2></div><span class="fixedMix">Music ${audibleMusicTarget()} · Announcement 100</span></div>
      <div class="announcementSourceStatus">
        <div class="sourceCapability verified"><strong>Natural Voice</strong><span>Default · natural generated speech</span><p>Use this for live typing, saved messages, safety alerts, and schedules.</p></div>
        <div class="sourceCapability"><strong>Short Suno / direct clip</strong><span>Supported · finite HTTPS audio</span><p>Use a directly downloadable clip and enter its expected duration. Maximum ${ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS} seconds.</p></div>
        <div class="sourceCapability unavailable"><strong>Apple Music / Spotify announcement</strong><span>Experimental · disabled</span><p>On one iPhone, catalog playback cannot reliably report when the item ends or restore the prior queue. They remain available as music beds, not executable announcement sources.</p></div>
      </div>
      <details class="savedEditor sourceEditor" data-persist-open="announcement-source-editor">
        <summary>Edit short announcement clips</summary>
        <div class="savedEditorList announcementSourceEditorList">
          ${finiteSources.map(source => `
            <form data-form="announcement-source-edit" data-id="${escapeAttr(source.id)}" class="savedEditorRow announcementSourceEditorRow">
              <label>Clip name<input name="label" value="${escapeAttr(source.label)}" maxlength="100" required /></label>
              <label>Provider<select name="provider"><option value="direct" ${source.provider === 'direct' ? 'selected' : ''}>Direct HTTPS audio</option><option value="suno" ${source.provider === 'suno' ? 'selected' : ''}>Suno finite clip</option></select></label>
              <label>HTTPS audio URL<input name="url" type="url" inputmode="url" value="${escapeAttr(source.url)}" placeholder="https://.../announcement.mp3" required /></label>
              <label>Expected seconds<input name="durationSeconds" type="number" min="1" max="${ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS}" step="1" value="${escapeAttr(source.durationSeconds)}" required /></label>
              <div class="rowActions"><button type="submit" class="secondary">Save Clip</button><button type="button" data-action="delete-announcement-source" data-id="${escapeAttr(source.id)}" class="textDanger">Delete</button></div>
            </form>`).join('')}
          <form data-form="announcement-source-add" class="savedEditorRow announcementSourceEditorRow addSourceRow">
            <label>New clip name<input name="label" maxlength="100" placeholder="Pool closing chime" required /></label>
            <label>Provider<select name="provider"><option value="direct">Direct HTTPS audio</option><option value="suno">Suno finite clip</option></select></label>
            <label>HTTPS audio URL<input name="url" type="url" inputmode="url" placeholder="https://.../announcement.mp3" required /></label>
            <label>Expected seconds<input name="durationSeconds" type="number" min="1" max="${ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS}" step="1" placeholder="15" required /></label>
            <button type="submit" class="primary">Add Clip</button>
          </form>
        </div>
        <p class="sourceEditorHelp">The expected duration is a safety limit, not a guess: confirm the clip is no longer than the value entered. Version X rejects anything over ${ANNOUNCEMENT_FINITE_AUDIO_MAX_SECONDS} seconds.</p>
      </details>
    </section>`;
}

function renderAnnounce() {
  const announcements = store.state.announcements;
  const renderedText = item => safetyAnnouncementText(item.id, item.text, store.state.config);
  const pushcutReady = pushcutAnnouncementReady();
  const operatingMode = receiverOperatingMode();
  const browserReady = operatingMode === 'browser' && receiverOnline(store.state.receiver, store.now());
  const pushcutSelectedReady = operatingMode === 'pushcut' && pushcutReady;
  const automatic = automaticAnnouncementsEnabled();
  const automaticReady = automatic && emailWakeOperational();
  const legacyAnnouncementReady = browserReady || pushcutSelectedReady;
  const announcementReady = automaticReady || legacyAnnouncementReady;
  const messageCharacterLimit = automaticAnnouncementsEnabled()
    ? EMAIL_WAKE_MAX_ANNOUNCEMENT_CHARACTERS
    : operatingMode === 'pushcut'
      ? PUSHCUT_MAX_ANNOUNCEMENT_CHARACTERS
    : 900;
  return `
    <section class="pageHeading"><p class="kicker">Announcements</p><h1>Clear voice, without music fighting it.</h1><p>Voice is prepared first, music is safely ducked or paused, and restoration waits until speech has ended.</p></section>
    ${automatic
      ? automaticReady
        ? `<div class="callout"><strong>Automatic Receiver is the live announcement path</strong><p>Keep Version X visible on the speaker iPhone for the music bed. Each command wakes the background Shortcut, downloads audio before touching playback, runs music ${audibleMusicTarget()}% → 0% → announcement 100% → 0% → resume → restore ${audibleMusicTarget()}%, and returns a signed receipt.</p><button type="button" data-action="email-wake-test" class="secondary">Run Automatic Receiver Test</button></div>`
        : '<div class="callout warning"><strong>Automatic Receiver is selected but not ready</strong><p>On the speaker iPhone, open Receiver and finish the one-time signed Shortcut, pairing, and Email automation setup.</p></div>'
      : browserReady
      ? '<div class="callout"><strong>Browser Receiver is the live announcement path</strong><p>Remote voice commands, saved announcements, immediate weather warnings, and mixed schedules now go to the visible Browser Receiver. Suno/direct beds duck in the mixer; Apple Music and Spotify pause completely for speech and resume afterward.</p></div>'
      : pushcutSelectedReady
        ? `<div class="callout"><strong>${pushcutStatus.operational ? 'Pushcut natural-voice receiver verified' : 'Pushcut natural-voice receiver configured'}</strong><p>Keep the receiver iPhone on <em>Ready For Requests</em>. Start any music bed directly in its native/background-capable player first. For each announcement, the signed Version X receipt confirms the Shortcut reached the end of Pause → Announcement 100% → Play Sound to completion → latest Music ${audibleMusicTarget()}% target → Play. It does not measure physical loudness or audibility.${pushcutStatus.operational ? '' : ' Run the receiver test below to verify the complete device path.'}</p><button type="button" data-action="pushcut-test" class="secondary">Run Verified Receiver Test</button></div>`
        : `<div class="callout warning"><strong>${operatingMode === 'browser' ? 'Browser Receiver is selected but offline' : operatingMode === 'pushcut' ? 'Pushcut Receiver is selected but unavailable' : 'No announcement receiver is online'}</strong><p>${operatingMode === 'browser' ? 'On the speaker iPhone, open Version X and tap Start Receiver. Commands stay disabled so they cannot be silently rerouted.' : 'Open Pushcut on the speaker iPhone and leave Ready For Requests visible, or return to Version X and start Browser Receiver.'}</p></div>`}
    ${pushcutSelectedReady ? `<div class="callout receiverShortcutSetup">
      <strong>${pushcutStatus.operational ? 'Version X Receiver Shortcuts' : 'Install the two signed Version X Receiver Shortcuts'}</strong>
      <p>These installers add <strong>${escapeHtml(PUSHCUT_X_ANNOUNCEMENT_SHORTCUT_NAME)}</strong> and <strong>${escapeHtml(PUSHCUT_X_RECOVERY_SHORTCUT_NAME)}</strong>. Their new names preserve your existing <strong>Poolside Pulse Announcement</strong>, <strong>Volume Up</strong>, and <strong>Volume Down</strong> shortcuts—do not delete or rename the originals.</p>
      <div class="stackedActions shortcutInstallerActions">
        <a class="shortcutLink loud" href="${escapeAttr(PUSHCUT_X_ANNOUNCEMENT_INSTALL_URL)}" download="${escapeAttr(`${PUSHCUT_X_ANNOUNCEMENT_SHORTCUT_NAME}.shortcut`)}">Download ${escapeHtml(PUSHCUT_X_ANNOUNCEMENT_SHORTCUT_NAME)}</a>
        <a class="shortcutLink" href="${escapeAttr(PUSHCUT_X_RECOVERY_INSTALL_URL)}" download="${escapeAttr(`${PUSHCUT_X_RECOVERY_SHORTCUT_NAME}.shortcut`)}">Download ${escapeHtml(PUSHCUT_X_RECOVERY_SHORTCUT_NAME)}</a>
      </div>
      <ol>
        <li>On the Receiver iPhone in Safari, tap each download button. After each one, tap Safari’s Downloads arrow → the <code>.shortcut</code> file → <strong>Add Shortcut</strong>.</li>
        <li>In Pushcut, open <strong>Server → Server Actions → Shortcuts</strong>, tap the import/refresh button at the upper right, and leave <strong>Enable all actions</strong> on.</li>
        <li>Return to <strong>Server → Ready For Requests</strong>, then tap <strong>Run Verified Receiver Test</strong> above.</li>
      </ol>
      <small>Keep both new shortcut names exactly as installed so Pushcut can match the Version X actions.</small>
    </div>` : ''}
    ${renderAnnouncementSourceLibrary()}
    <section class="announcementComposer">
      ${voiceLevelControl()}
      <form data-form="announce">
        <label for="liveAnnouncementSource">Announcement source<select id="liveAnnouncementSource" name="sourceId">${announcementSourceOptions('natural-voice')}</select><small>Natural Voice is the default. A saved short clip plays its recorded audio; the typed text remains the activity description.</small></label>
        <label for="announcementText">Speak now</label>
        <textarea id="announcementText" name="text" maxlength="${messageCharacterLimit}" placeholder="Type the announcement exactly as guests should hear it." required></textarea>
        <div class="composerFooter"><span>${automatic || operatingMode === 'pushcut' ? `Natural Voice · music ${audibleMusicTarget()}% → 0% · announcement 100% · restore ${audibleMusicTarget()}%` : `Natural Voice · announcement ${audibleVoiceTarget()}% · music pauses or ducks fully`}</span><button type="submit" class="primary" ${announcementReady ? '' : 'disabled'}>Speak Now</button></div>
      </form>
    </section>
    <section class="workspacePanel">
      <div class="sectionHeading"><div><p class="kicker">Saved messages</p><h2>One-tap announcements</h2></div></div>
      <div class="announcementGrid">${announcements.map(item => `<button class="announcementButton" data-action="saved-announcement" data-id="${escapeAttr(item.id)}" ${announcementReady ? '' : 'disabled'}><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(announcementSourceSummary(item.sourceId))}</span><small>${escapeHtml(renderedText(item))}</small></button>`).join('')}</div>
      <details class="savedEditor" data-persist-open="saved-editor">
        <summary>Edit saved messages</summary>
        <div class="savedEditorList">${announcements.map(item => ['lightning', 'lightning-clear'].includes(item.id) ? `
          <div class="savedEditorRow"><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(renderedText(item))}</p><small>Generated from Lightning miles and Hold minutes in Settings so safety wording cannot become stale.</small></div>` : `
          <form data-form="announcement-edit" data-id="${escapeAttr(item.id)}" class="savedEditorRow">
            <label>Button name<input name="label" value="${escapeAttr(item.label)}" maxlength="80" required /></label>
            <label>Spoken message<textarea name="text" maxlength="${messageCharacterLimit}" required>${escapeHtml(item.text)}</textarea><small>${pushcutReady || automaticAnnouncementsEnabled() ? `Maximum ${messageCharacterLimit} characters so the Receiver Shortcut completes reliably.` : ''}</small></label>
            <label>Announcement source<select name="sourceId">${announcementSourceOptions(item.sourceId)}</select></label>
            <button type="submit" class="secondary">Save Message</button>
          </form>`).join('')}</div>
      </details>
    </section>
    <section class="safetyPanel">
      <div><p class="kicker">Safety</p><h2>Weather actions</h2><p>Manual check uses the same free NWS, Open-Meteo, and NOAA GLM scan as the automatic two-minute monitor.</p></div>
      <div class="safetyActions"><button data-action="weather-check" class="weatherButton" ${announcementReady ? '' : 'disabled'}>Check Weather Now</button><button data-action="safety-announcement" data-id="lightning" class="danger" ${announcementReady ? '' : 'disabled'}>Announce Lightning Hold</button><button data-action="safety-announcement" data-id="wind" class="warningButton" ${announcementReady ? '' : 'disabled'}>Announce Close Umbrellas</button></div>
    </section>`;
}

function announcementOptions(selected = '') {
  return store.state.announcements.map(item => `<option value="${escapeAttr(item.id)}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
}

function activeSavedSchedule() {
  const schedules = Array.isArray(store.state.schedules) ? store.state.schedules : [];
  return schedules.find(schedule => schedule.id === selectedScheduleId) || getActiveSchedule(store.state) || { id: '', name: 'Schedule', mode: 'time', enabled: true, items: [] };
}

function selectSavedSchedule(scheduleId) {
  const id = String(scheduleId || '');
  if (!(store.state.schedules || []).some(schedule => schedule.id === id)) return false;
  selectedScheduleId = id;
  localStorage.setItem(SCHEDULE_SELECTION_KEY, id);
  scheduleDeletePending = '';
  renderWhenIdle(true);
  return true;
}

function dirtyScheduleForm() {
  return root.querySelector('form[data-form="schedule-settings"][data-dirty="true"], form[data-form="schedule-item"][data-dirty="true"]');
}

function resetScheduleSequence(draft, scheduleId) {
  const sequenceRuns = draft.sequenceRuns && typeof draft.sequenceRuns === 'object' ? { ...draft.sequenceRuns } : {};
  if (sequenceRuns[scheduleId]) {
    sequenceRuns[scheduleId] = {
      ...cancelSequenceRun(sequenceRuns[scheduleId], store.now(), 'Order position reset because the schedule structure changed.'),
      order: 0,
      itemId: ''
    };
  }
  draft.sequenceRuns = sequenceRuns;
  const scheduleRuns = draft.scheduleRuns && typeof draft.scheduleRuns === 'object' ? { ...draft.scheduleRuns } : {};
  for (const [itemId, run] of Object.entries(scheduleRuns)) {
    if (run?.scheduleId !== scheduleId || run?.status !== 'in-progress') continue;
    scheduleRuns[itemId] = {
      ...run,
      status: 'completed',
      completedAt: store.now(),
      outcome: 'cancelled-by-schedule-change'
    };
  }
  draft.scheduleRuns = scheduleRuns;
  const playback = draft.playback || {};
  if (draft.activeScheduleId === scheduleId && playback.scheduledRunToken) {
    draft.playback = {
      ...playback,
      intent: 'stopped',
      label: 'Nothing playing',
      cancelScheduledRunToken: String(playback.scheduledRunToken),
      unavailableReason: 'Scheduled playback stopped because its live schedule changed.',
      updatedAt: store.now()
    };
  }
}

function scheduleItemKind(item) {
  return item?.action?.kind || item?.type || 'announcement';
}

function formatScheduleTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return '12:00 PM';
  const hour = Number(match[1]);
  const minute = match[2];
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function scheduleKindLabel(item) {
  const kind = scheduleItemKind(item);
  if (kind === 'announcement') return item.action?.announcementSource === 'inline' ? 'Custom announcement' : 'Saved announcement';
  if (kind === 'stop') return 'Quiet hours · silence output';
  return kind === 'apple' ? 'Apple Music' : kind === 'spotify' ? 'Spotify' : 'Suno / Direct';
}

function scheduleVolumeLabel(item) {
  const percent = effectiveScheduleItemVolume(item, store.state.config);
  if (scheduleItemKind(item) === 'announcement') return `Announcement ${VOICE_LEVEL_PERCENT}%`;
  if (scheduleItemKind(item) === 'stop') return 'Quiet · output 0%';
  return ['apple', 'spotify'].includes(scheduleItemKind(item))
    ? (
        automaticAnnouncementsEnabled()
          ? `Music ${percent}% via Receiver`
          : activeReceiverIsIOS()
            ? 'Physical speaker level'
            : liveReceiverIsNative()
              ? `Music.app ${percent}%`
              : `Target ${percent}%`
      )
    : `Music ${percent}%`;
}

function scheduleAdvanceLabel(item) {
  if (scheduleItemKind(item) === 'announcement') return 'Completes after speech';
  if (scheduleItemKind(item) === 'stop') return 'Completes after silence';
  const mode = item.advance?.mode || 'manual';
  if (mode === 'duration') return `${Math.max(1, Math.round(Number(item.advance?.durationSeconds || 300) / 60))} min segment`;
  if (mode === 'track-end') return 'Advance at track end';
  if (mode === 'complete') return 'Advance after start';
  return 'Manual advance';
}

function renderWeekdayControls(days = []) {
  const selected = new Set(Array.isArray(days) ? days.map(Number) : [0, 1, 2, 3, 4, 5, 6]);
  return `<fieldset class="weekdayField"><legend>Days</legend><div class="weekdayGrid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, day) => `<label class="dayChoice"><input type="checkbox" name="days" value="${day}" ${selected.has(day) ? 'checked' : ''} /><span>${label}</span></label>`).join('')}</div></fieldset>`;
}

function scheduleCancelledToday(schedule, now = store.now()) {
  return Array.isArray(schedule?.cancelledDates)
    && schedule.cancelledDates.includes(scheduleDateKey(now));
}

function scheduleCancellationTarget(schedule, now = store.now()) {
  const items = (Array.isArray(schedule?.items) ? schedule.items : [])
    .filter(item => item?.enabled !== false);
  const weekdays = new Set(items.flatMap(item => (
    Array.isArray(item.days) && item.days.length
      ? item.days.map(Number)
      : [0, 1, 2, 3, 4, 5, 6]
  )));
  const current = zonedScheduleParts(now);
  const currentMinutes = current.hour * 60 + current.minute;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = now + offset * 24 * 60 * 60 * 1000;
    const parts = zonedScheduleParts(candidate);
    if (!weekdays.has(parts.weekday)) continue;
    if (offset === 0) {
      const hasRemainingItem = items.some(item => {
        const days = Array.isArray(item.days) && item.days.length
          ? item.days.map(Number)
          : [0, 1, 2, 3, 4, 5, 6];
        const match = /^(\d{2}):(\d{2})$/.exec(String(item.position?.time || item.time || ''));
        return days.includes(parts.weekday)
          && match
          && Number(match[1]) * 60 + Number(match[2]) >= currentMinutes;
      });
      if (!hasRemainingItem) continue;
    }
    return {
      dateKey: parts.dateKey,
      label: new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }).format(new Date(candidate))
    };
  }
  return { dateKey: scheduleDateKey(now), label: 'Today' };
}

function scheduleItemSkippedToday(item, now = store.now()) {
  return Array.isArray(item?.skippedDates)
    && item.skippedDates.includes(scheduleDateKey(now));
}

function renderScheduleRow(item, schedule, index) {
  const kind = scheduleItemKind(item);
  const stopItem = kind === 'stop';
  const pushcutOnly = receiverOperatingMode() === 'pushcut';
  const playNowDisabled = pushcutOnly && kind !== 'announcement';
  const iphoneAppleVolume =
    ['apple', 'spotify'].includes(kind)
    && activeReceiverIsIOS()
    && !automaticAnnouncementsEnabled();
  const fixedVolume = kind === 'announcement' || stopItem || iphoneAppleVolume;
  const announcementSource = item.action?.announcementSource || 'saved';
  const savedAnnouncement = store.state.announcements.find(entry => entry.id === (item.action?.announcementId || item.announcementId));
  const announcementSourceId = item.action?.sourceId || savedAnnouncement?.sourceId || 'natural-voice';
  const volumeMode = item.volume?.mode || 'global';
  const itemVolume = effectiveScheduleItemVolume(item, store.state.config);
  const advanceMode = item.advance?.mode || (kind === 'announcement' ? 'complete' : 'manual');
  const announcementTextLimit = automaticAnnouncementsEnabled() && schedule.mode === 'time'
    ? EMAIL_WAKE_MAX_ANNOUNCEMENT_CHARACTERS
    : pushcutAnnouncementReady() && schedule.mode === 'time'
      ? PUSHCUT_MAX_ANNOUNCEMENT_CHARACTERS
    : 900;
  const collapsedPosition = schedule.mode === 'order'
    ? String(clamp(item.position?.order ?? item.order ?? index + 1, 1, 100, index + 1))
    : formatScheduleTime(item.position?.time || item.time);
  const skippedToday = schedule.mode === 'time' && scheduleItemSkippedToday(item);
  const skipTarget = schedule.mode === 'time'
    ? scheduleCancellationTarget({ items: [item] })
    : null;
  const skipTargetIsSkipped = Boolean(
    skipTarget
    && Array.isArray(item.skippedDates)
    && item.skippedDates.includes(skipTarget.dateKey)
  );
  const skipTodayControl = schedule.mode !== 'time'
    ? ''
    : item.protected === true
      ? '<span class="protectedScheduleBadge">Protected closing item</span>'
      : `<button type="button" data-action="${skipTargetIsSkipped ? 'restore-schedule-item-today' : 'skip-schedule-item-today'}" data-id="${escapeAttr(item.id)}" data-schedule-id="${escapeAttr(schedule.id)}" data-date-key="${escapeAttr(skipTarget.dateKey)}" class="secondary">${skipTargetIsSkipped ? 'Restore' : 'Skip'} ${escapeHtml(skipTarget.label)}</button>`;
  return `
    <article class="scheduleItemShell" data-drop-schedule-item="${escapeAttr(item.id)}">
      <button type="button" class="dragHandle secondary" draggable="true" data-drag-schedule-item="${escapeAttr(item.id)}" data-focus-key="drag-${escapeAttr(item.id)}" aria-label="Drag ${escapeAttr(item.label)} to reorder" title="Drag to reorder; arrow keys also move this item">⋮⋮</button>
      <details class="scheduleItemCard" data-persist-open="schedule-${escapeAttr(item.id)}">
        <summary data-focus-key="summary-${escapeAttr(item.id)}">
          <span class="schedulePosition ${schedule.mode}">${escapeHtml(collapsedPosition)}</span>
          <span class="scheduleSummaryCopy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(scheduleKindLabel(item))} · ${escapeHtml(scheduleAdvanceLabel(item))}</small></span>
          <span class="scheduleVolumeBadge">${escapeHtml(scheduleVolumeLabel(item))}</span>
          <span class="scheduleEnabled ${item.enabled && !skippedToday ? 'on' : 'off'}">${skippedToday ? 'Skipped today' : item.enabled ? 'On' : 'Off'}</span>
        </summary>
        <form data-form="schedule-item" data-id="${escapeAttr(item.id)}" data-schedule-id="${escapeAttr(schedule.id)}" data-kind="${escapeAttr(kind)}" data-announcement-source="${escapeAttr(announcementSource)}" data-volume-mode="${escapeAttr(volumeMode)}" data-advance-mode="${escapeAttr(advanceMode)}" class="scheduleItemForm">
          <div class="scheduleFormGrid">
            <label>Item name<input name="label" value="${escapeAttr(item.label)}" maxlength="100" required /></label>
            <label class="checkLabel"><input name="enabled" type="checkbox" ${item.enabled ? 'checked' : ''} /> Item is active</label>
            ${schedule.mode === 'order'
              ? `<label>Order 1-100<input name="order" type="number" min="1" max="100" step="1" value="${escapeAttr(item.position?.order ?? item.order ?? index + 1)}" required /></label>`
              : `<label>Time<input name="time" type="time" value="${escapeAttr(item.position?.time || item.time || '12:00')}" required /></label>${renderWeekdayControls(item.days)}`}
            <label>Action<select name="kind" data-schedule-kind><option value="announcement" ${kind === 'announcement' ? 'selected' : ''}>Announcement</option><option value="controlled" ${kind === 'controlled' ? 'selected' : ''}>Suno / direct audio</option><option value="apple" ${kind === 'apple' ? 'selected' : ''}>Apple Music</option><option value="spotify" ${kind === 'spotify' ? 'selected' : ''}>Spotify</option><option value="stop" ${stopItem ? 'selected' : ''}>Quiet hours · silence output</option></select></label>
            <div class="conditionalFields announcementFields" data-show-schedule-kind="announcement" ${kind === 'announcement' ? '' : 'hidden'}>
              <label>Announcement source<select name="announcementSource" data-announcement-source><option value="saved" ${announcementSource === 'saved' ? 'selected' : ''}>Saved announcement</option><option value="inline" ${announcementSource === 'inline' ? 'selected' : ''}>Custom for this schedule only</option></select></label>
              <label data-show-announcement-source="saved" ${announcementSource === 'saved' ? '' : 'hidden'}>Saved message<select name="announcementId">${announcementOptions(item.action?.announcementId || item.announcementId)}</select></label>
              <label data-show-announcement-source="inline" ${announcementSource === 'inline' ? '' : 'hidden'}>Custom announcement<textarea name="text" maxlength="${announcementTextLimit}" placeholder="Type the announcement spoken only by this schedule item">${escapeHtml(item.action?.text || '')}</textarea><small>This text stays inside this schedule and is not added to Saved Messages.${announcementTextLimit < 900 ? ` Maximum ${announcementTextLimit} characters for reliable Receiver Shortcut playback.` : ''}</small></label>
              <label>Playback source<select name="sourceId">${announcementSourceOptions(announcementSourceId)}</select><small>Natural Voice or a saved finite clip. Apple Music and Spotify catalog items are disabled for announcement use on one iPhone.</small></label>
              <label>Resume music after announcement<input name="restoreMusicPercent" type="number" min="0" max="100" step="1" value="${escapeAttr(item.action?.restoreMusicPercent ?? store.state.config.musicLevel)}" /><small>Usually 30% for the Daily bed and 100% while the Wednesday Party bed is active.</small></label>
              <div class="fixedVoiceNote"><strong>Announcement ${VOICE_LEVEL_PERCENT}%</strong><span>Music reaches ${DUCK_LEVEL_PERCENT}% before speech starts. Playback resumes at the music slider target only after the announcement finishes.</span></div>
            </div>
            <div class="conditionalFields musicFields" data-show-schedule-kind="music" ${kind === 'announcement' || stopItem ? 'hidden' : ''}>
              <label>Music URL<input name="url" type="url" value="${escapeAttr(item.action?.url || item.url || '')}" placeholder="Apple Music, Spotify, Suno, or direct HTTPS audio URL" ${kind === 'announcement' || stopItem ? '' : 'required'} /></label>
              ${schedule.mode === 'order' ? `<label>Advance<select name="advanceMode" data-advance-mode><option value="manual" ${advanceMode === 'manual' ? 'selected' : ''}>Manually with Play Next</option><option value="track-end" ${advanceMode === 'track-end' ? 'selected' : ''} ${['apple', 'spotify'].includes(kind) ? 'disabled' : ''}>At direct track end (Suno/direct only)</option><option value="duration" ${advanceMode === 'duration' ? 'selected' : ''}>After a duration</option><option value="complete" ${advanceMode === 'complete' ? 'selected' : ''}>Immediately after playback starts</option></select></label><label data-show-advance-mode="duration" ${advanceMode === 'duration' ? '' : 'hidden'}>Duration seconds<input name="durationSeconds" type="number" min="1" max="86400" step="1" value="${escapeAttr(item.advance?.durationSeconds || 300)}" /></label>` : ''}
            </div>
            <div class="conditionalFields stopFields" data-show-schedule-kind="stop" ${stopItem ? '' : 'hidden'}>
              <div class="fixedVoiceNote"><strong>Quiet hours</strong><span>Browser Receiver stops playback. Automatic Receiver sets the iPhone media output to 0%. Either path leaves the connected speakers quiet until a later schedule item or Remote command starts audible playback.</span></div>
            </div>
            <div class="conditionalFields scheduleVolumeFields" data-standard-volume-fields ${fixedVolume ? 'hidden' : ''}>
              <label>Volume<select name="volumeMode" data-volume-mode ${fixedVolume ? 'disabled' : ''}><option value="global" ${volumeMode === 'global' ? 'selected' : ''}>Use shared volume</option><option value="custom" ${volumeMode === 'custom' ? 'selected' : ''}>Custom for this item</option></select><small>${automaticAnnouncementsEnabled() ? `Before each music row starts, Automatic Receiver applies its ${volumeMode === 'custom' ? `${itemVolume}% custom` : `${store.state.config.musicLevel}% shared`} iPhone media target.` : `Shared music is ${store.state.config.musicLevel}%.`}</small></label>
              <label data-show-volume-mode="custom" ${volumeMode === 'custom' && !fixedVolume ? '' : 'hidden'}>Item music volume<div class="itemVolumeControl"><input name="volumePercent" class="itemVolumeSlider" type="range" min="0" max="100" step="1" value="${itemVolume}" ${fixedVolume ? 'disabled' : ''} /><output>${itemVolume}%</output></div></label>
            </div>
            <div class="fixedVoiceNote" data-apple-ios-volume-note ${iphoneAppleVolume ? '' : 'hidden'}><strong>${kind === 'spotify' ? 'Spotify' : 'Apple Music'} volume: shared physical control</strong><span>The active Browser Receiver is an iPhone. Music uses the iPhone or connected speaker’s physical volume, so per-item external-provider percentages cannot be applied or verified. Music pauses completely before every ${audibleVoiceTarget()}% announcement.</span></div>
          </div>
          <div class="rowActions scheduleRowActions"><button type="submit" class="primary">Save Item</button><button type="submit" name="intent" value="play" class="secondary" ${playNowDisabled ? 'disabled title="Music schedule items require Browser Receiver mode"' : ''}>${playNowDisabled ? 'Browser Receiver Required' : 'Save & Play Now'}</button>${skipTodayControl}<button type="button" data-action="move-schedule-item" data-id="${escapeAttr(item.id)}" data-direction="-1" class="secondary" aria-label="Move ${escapeAttr(item.label)} up">Move Up</button><button type="button" data-action="move-schedule-item" data-id="${escapeAttr(item.id)}" data-direction="1" class="secondary" aria-label="Move ${escapeAttr(item.label)} down">Move Down</button><button type="button" data-action="duplicate-schedule-item" data-id="${escapeAttr(item.id)}" class="secondary">Duplicate</button><button type="button" data-action="delete-schedule-item" data-id="${escapeAttr(item.id)}" class="textDanger">Delete</button></div>
        </form>
      </details>
    </article>`;
}

function renderSchedule() {
  const schedules = Array.isArray(store.state.schedules) ? store.state.schedules : [];
  const pushcutReady = pushcutAnnouncementReady();
  const operatingMode = receiverOperatingMode();
  const browserReady = operatingMode === 'browser' && receiverOnline(store.state.receiver, store.now());
  const pushcutSelectedReady = operatingMode === 'pushcut' && pushcutReady;
  const automatic = automaticAnnouncementsEnabled();
  const automaticReady = automatic && emailWakeOperational();
  const schedule = activeSavedSchedule();
  const items = Array.isArray(schedule.items) ? schedule.items : [];
  const enabledItems = items.filter(item => item.enabled !== false);
  const scheduleHasApple = enabledItems.some(item => scheduleItemKind(item) === 'apple');
  const nativeScheduleReceiver = nativeMusicContext();
  const nativeAppleReady = store.state.receiver?.appleStatus === 'ready';
  const sequenceRun = normalizeSequenceRun(store.state.sequenceRuns?.[schedule.id]);
  const isLiveSchedule = schedule.enabled !== false && (
    schedule.mode === 'time'
    || store.state.activeScheduleId === schedule.id
  );
  const liveTimeSchedule = isLiveSchedule && schedule.mode === 'time';
  const cancelledToday = liveTimeSchedule && scheduleCancelledToday(schedule);
  const cancellationTarget = schedule.cancellable === true && schedule.mode === 'time'
    ? scheduleCancellationTarget(schedule)
    : null;
  const cancellationTargetIsCancelled = Boolean(
    cancellationTarget
    && Array.isArray(schedule.cancelledDates)
    && schedule.cancelledDates.includes(cancellationTarget.dateKey)
  );
  const pushcutScheduleNeedsAttention = pushcutScheduleStatus.requiresExtended
    || Boolean(pushcutScheduleStatus.error)
    || (pushcutScheduleStatus.horizonEnd > 0 && pushcutScheduleStatus.horizonEnd - store.now() < 3 * 24 * 60 * 60 * 1000);
  const pushcutScheduleSummary = pushcutScheduleStatus.syncing
    ? 'Syncing the rolling announcement window now...'
    : pushcutScheduleStatus.requiresExtended
      ? 'Pushcut Automation Server Extended is required for automatic timed announcements.'
      : pushcutScheduleStatus.error
        ? pushcutScheduleStatus.error
        : pushcutScheduleStatus.syncedAt
          ? `${pushcutScheduleStatus.scheduledCount} occurrence${pushcutScheduleStatus.scheduledCount === 1 ? '' : 's'} synced through ${formatClock(pushcutScheduleStatus.horizonEnd)}. Next: ${formatClock(pushcutScheduleStatus.nextScheduledFor)}.`
          : 'Timed announcements have not been synced from this Remote Control yet.';
  const pushcutScheduleWarnings = pushcutScheduleStatus.warnings
    .map(message => `<li>${escapeHtml(message)}</li>`)
    .join('');
  const automaticScheduleHorizonHealthy =
    emailWakeScheduleStatus.horizonEnd > store.now() + 3 * 24 * 60 * 60 * 1000;
  const automaticScheduleReady =
    automaticReady
    && browserReady
    && emailWakeScheduleStatus.checked
    && emailWakeScheduleStatus.enabled
    && emailWakeScheduleStatus.current
    && Number(emailWakeScheduleStatus.syncedAt || 0) > 0
    && automaticScheduleHorizonHealthy
    && !emailWakeScheduleStatus.error
    && (
      emailWakeScheduleStatus.scheduledCount === 0
      || emailWakeScheduleStatus.maintenanceScheduled
    );
  const automaticScheduleNeedsAttention = !automaticScheduleReady;
  const automaticScheduleSummary = emailWakeScheduleStatus.syncing
    ? 'Syncing the rolling background schedule now...'
    : emailWakeScheduleStatus.error
      ? emailWakeScheduleStatus.error
      : !emailWakeScheduleStatus.checked
        ? 'Automatic schedule status has not been checked yet.'
        : !emailWakeScheduleStatus.enabled
          ? 'Background announcements and quiet hours are paused on the server. Sync them now before relying on this schedule.'
          : !emailWakeScheduleStatus.current
            ? 'The saved schedule is newer than the durable automatic announcement plan. Sync it now.'
            : !emailWakeScheduleStatus.syncedAt
              ? 'The background automatic schedule has not been synced from this Remote yet.'
              : !automaticScheduleHorizonHealthy
                ? `The background automatic window expires soon at ${formatClock(emailWakeScheduleStatus.horizonEnd)}. Sync it now.`
                : emailWakeScheduleStatus.scheduledCount > 0
                  && !emailWakeScheduleStatus.maintenanceScheduled
                  ? 'Background occurrences are synced, but automatic renewal is not confirmed. Sync them now.'
                  : `${emailWakeScheduleStatus.scheduledCount} occurrence${
                      emailWakeScheduleStatus.scheduledCount === 1 ? '' : 's'
                    } synced through ${formatClock(emailWakeScheduleStatus.horizonEnd)}. Next: ${formatClock(emailWakeScheduleStatus.nextScheduledFor)}.${
                      emailWakeScheduleStatus.maintenanceScheduled
                        ? ` Automatic renewal: ${formatClock(emailWakeScheduleStatus.maintenanceScheduledFor)}.`
                        : ''
                    }`;
  const automaticScheduleWarnings = emailWakeScheduleStatus.warnings
    .map(message => `<li>${escapeHtml(message)}</li>`)
    .join('');
  const orderBusy = ['claiming', 'waiting-duration', 'waiting-track-end', 'auto-pending'].includes(sequenceRun.status);
  const orderStatus = sequenceRun.status === 'waiting-duration'
    ? `Playing ${sequenceRun.active?.order || '?'} · advances at ${formatClock(sequenceRun.active?.dueAt)}`
    : sequenceRun.status === 'waiting-track-end'
      ? `Playing ${sequenceRun.active?.order || '?'} · waiting for direct track end`
      : sequenceRun.status === 'claiming'
        ? `Receiver is starting item ${sequenceRun.active?.order || '?'}`
        : sequenceRun.status === 'auto-pending'
          ? 'Receiver is advancing automatically'
          : sequenceRun.status === 'failed'
            ? `Stopped after failure · ${sequenceRun.lastError || 'retry with Play Next'}`
            : sequenceRun.status === 'complete'
              ? `Complete · ${enabledItems.length} enabled ${enabledItems.length === 1 ? 'item' : 'items'}`
              : sequenceRun.order
                ? `Ready after item ${sequenceRun.order} · ${enabledItems.length} enabled`
                : enabledItems.length
                  ? `Ready · ${enabledItems.length} enabled ${enabledItems.length === 1 ? 'item' : 'items'}`
                  : 'Ready · No enabled items';
  const deleteArmed = scheduleDeletePending === schedule.id;
  return `
    <section class="pageHeading"><p class="kicker">Saved schedules</p><h1>Daily operations and party overlays.</h1><p>Every enabled Time schedule runs together in Central Time, so Daily opening, safety, and protected closing rows stay active while Wednesday Party cues run alongside them. ${automaticReady ? 'Announcements and quiet-hours 0% output rows use the background Automatic Receiver; Suno, Apple Music, and Spotify rows use the visible Browser Receiver.' : browserReady ? 'Music rows run while Browser Receiver remains visible.' : 'Start Browser Receiver for music; background Automatic Receiver can still run synced announcements.'} Use Wednesday Party Live Cues with Play Next for food readiness, game-finish timing, and immediate paired songs.</p></section>
    ${automatic ? `<div class="callout ${automaticScheduleNeedsAttention ? 'warning' : ''}">
      <strong>${automaticScheduleReady ? 'Automatic mixed schedule is ready' : 'Automatic schedule needs attention'}</strong>
      <p>${escapeHtml(automaticScheduleSummary)}</p>
      <p>Music rows run in this visible Receiver browser. Timed Natural Voice and finite Suno/direct announcement clips wake the background Receiver Shortcut; quiet-hours rows set the iPhone media output to 0%. These background rows do not also run in Safari.</p>
      ${automaticScheduleWarnings ? `<ul class="scheduleSyncWarnings">${automaticScheduleWarnings}</ul>` : ''}
      <button type="button" data-action="sync-email-wake-schedule" class="secondary" ${role !== 'command' || emailWakeScheduleStatus.syncing || !automaticReady ? 'disabled' : ''}>${emailWakeScheduleStatus.syncing ? 'Syncing…' : 'Sync Automatic Schedule Now'}</button>
    </div>` : pushcutReady && browserReady ? `<div class="callout">
      <strong>Browser Receiver owns this schedule</strong>
      <p>Mixed Suno, Apple Music, Spotify, and announcement items run here while the Receiver keeps Version X visible. Version X automatically cancels Pushcut timed copies in this mode so an announcement cannot play twice.</p>
    </div>` : pushcutSelectedReady ? `<div class="callout ${pushcutScheduleNeedsAttention ? 'warning' : ''}">
      <strong>${liveTimeSchedule ? 'Automatic Pushcut announcements' : 'Pushcut timed-announcement sync'}</strong>
      <p>${escapeHtml(pushcutScheduleSummary)}</p>
      <p>Version X renews a rolling window of up to 29 days whenever Remote Control opens or a saved announcement schedule changes. Pushcut schedules announcement actions only; music-provider changes still require the browser receiver to remain active.</p>
      ${pushcutScheduleWarnings ? `<ul class="scheduleSyncWarnings">${pushcutScheduleWarnings}</ul>` : ''}
      <button type="button" data-action="sync-pushcut-schedule" class="secondary" ${role !== 'command' || pushcutScheduleStatus.syncing ? 'disabled' : ''}>${pushcutScheduleStatus.syncing ? 'Syncing…' : 'Sync Timed Announcements Now'}</button>
    </div>` : operatingMode === 'browser' ? `<div class="callout warning"><strong>Browser Receiver is selected but offline</strong><p>Mixed and automatic Browser schedules are stopped. On the speaker iPhone, open Version X and tap Start Receiver before relying on scheduled playback.</p></div>` : `<div class="callout warning"><strong>Pushcut Receiver is selected but unavailable</strong><p>Open Pushcut on the speaker iPhone and leave Ready For Requests visible before syncing or relying on timed announcements.</p></div>`}
    <section class="scheduleWorkspace">
      <div class="schedulePickerBar">
        <label>Schedule to edit<select id="schedulePicker" aria-label="Schedule to edit">${schedules.map(candidate => `<option value="${escapeAttr(candidate.id)}" ${candidate.id === schedule.id ? 'selected' : ''}>${escapeHtml(candidate.name)}${candidate.enabled !== false && candidate.mode === 'time' ? ' (live overlay)' : candidate.id === store.state.activeScheduleId && candidate.enabled !== false ? ' (live order)' : candidate.enabled ? '' : ' (off)'}</option>`).join('')}</select></label>
        <button type="button" data-action="new-schedule-set" class="primary addScheduleButton" aria-label="Add a new saved schedule">+ New Schedule</button>
      </div>
      <form data-form="schedule-settings" data-id="${escapeAttr(schedule.id)}" class="scheduleSettings">
        <label>Schedule name<input name="name" value="${escapeAttr(schedule.name)}" maxlength="80" required /></label>
        <label>Run by<select name="mode" data-schedule-mode aria-describedby="scheduleModeHelp"><option value="time" ${schedule.mode === 'time' ? 'selected' : ''}>Time</option><option value="order" ${schedule.mode === 'order' ? 'selected' : ''}>Order 1-100</option></select><small id="scheduleModeHelp">Time runs automatically in Central Time. Choose Time, then expand each item to set its clock time and days.</small></label>
        <label class="checkLabel"><input name="enabled" type="checkbox" ${schedule.enabled ? 'checked' : ''} /> Schedule is enabled</label>
        <div class="scheduleSettingsActions"><button type="submit" class="primary">Save Schedule</button>${isLiveSchedule ? `<span class="liveScheduleBadge">${schedule.mode === 'time' ? cancelledToday ? 'Cancelled today' : 'Live overlay' : 'Live order'}</span>` : schedule.mode === 'time' ? '<span class="liveScheduleBadge inactive">Turn on and save to run this overlay</span>' : '<button type="button" data-action="activate-schedule-set" class="warningButton">Make This the Live Order Schedule</button>'}${cancellationTarget ? `<button type="button" data-action="${cancellationTargetIsCancelled ? 'restore-schedule-today' : 'cancel-schedule-today'}" data-schedule-id="${escapeAttr(schedule.id)}" data-date-key="${escapeAttr(cancellationTarget.dateKey)}" class="${cancellationTargetIsCancelled ? 'secondary' : 'warningButton'}">${cancellationTargetIsCancelled ? 'Restore' : 'Cancel'} ${escapeHtml(cancellationTarget.label)}</button>` : ''}<button type="button" data-action="duplicate-schedule-set" class="secondary">Duplicate</button>${deleteArmed ? `<button type="button" data-action="confirm-delete-schedule-set" class="danger">Confirm Delete</button><button type="button" data-action="cancel-delete-schedule-set" class="secondary">Cancel</button>` : '<button type="button" data-action="delete-schedule-set" class="textDanger">Delete Schedule</button>'}</div>
      </form>
      ${schedule.mode === 'order' ? `<div class="orderRunner ${isLiveSchedule ? 'live' : 'inactive'}"><div><span>${isLiveSchedule ? 'Live order position' : 'Order schedule is not live'}</span><strong>${escapeHtml(orderStatus)}</strong><small>${operatingMode === 'pushcut' ? 'Pushcut can play individual announcement rows, but a mixed Order schedule requires Browser Receiver mode.' : browserReady ? automaticReady ? 'Announcement steps use the background Receiver and advance after its signed completion. Music follows each item’s Advance setting.' : 'Announcements advance after speech. Music follows each item’s Advance setting; manual items wait for Play Next. The final item never loops back by itself.' : 'Start Browser Receiver before using Play Next.'}</small></div><div class="orderRunnerActions"><button type="button" data-action="play-next-schedule" class="primary" ${isLiveSchedule && enabledItems.length > 0 && !orderBusy && sequenceRun.status !== 'complete' && browserReady ? '' : 'disabled'}>${sequenceRun.status === 'failed' ? 'Retry Next' : browserReady ? 'Play Next' : 'Browser Receiver Required'}</button><button type="button" data-action="reset-order-schedule" class="secondary" ${isLiveSchedule && browserReady ? '' : 'disabled'}>Reset to 1</button></div></div>` : `<div class="timeRunner ${isLiveSchedule && !cancelledToday ? 'live' : 'inactive'}"><strong>${cancelledToday ? 'Cancelled for today only' : isLiveSchedule ? 'Live concurrent Time schedule' : 'Saved Time schedule · off'}</strong><span>${cancelledToday ? 'No remaining rows in this schedule will run today. Future scheduled days remain enabled.' : isLiveSchedule ? automaticReady ? browserReady ? 'This overlay runs alongside every other enabled Time schedule. Music runs in the visible Receiver browser; announcements and quiet-hours 0% output run once through the background Shortcut.' : 'This overlay runs alongside the Daily schedule. Background announcements and quiet-hours 0% output remain automatic; start Browser Receiver for music rows.' : browserReady ? 'All enabled rows run at or shortly after their scheduled Central Time alongside other Time schedules.' : 'Start Browser Receiver for music; synced background announcements remain available.' : 'Turn on Schedule is enabled, then Save Schedule, to run it alongside the other Time schedules.'}</span></div>`}
      <div class="scheduleList">${items.map((item, index) => renderScheduleRow(item, schedule, index)).join('')}</div>
      <button type="button" data-action="add-schedule-item" class="secondary addButton">+ Add Schedule Item</button>
    </section>
    ${nativeScheduleReceiver
      ? `<div class="callout ${scheduleHasApple && !nativeAppleReady ? 'warning' : ''}"><strong>${scheduleHasApple ? nativeAppleReady ? 'Mac Apple schedule receiver ready' : 'Apple schedule setup required' : 'Mac schedule receiver'}</strong><p>${scheduleHasApple && !nativeAppleReady ? escapeHtml(store.state.receiver?.appleDetail || 'On the receiver Mac, tap Start Receiver, allow Music.app control, then tap Connect Music.app Receiver before relying on Apple schedule items.') : 'Leave Poolside Pulse X Music Receiver running and the Mac connected to the pool speaker output. The app keeps the Mac awake; use any other device for commands.'}</p></div>`
      : operatingMode === 'pushcut'
        ? `<div class="callout warning"><strong>Pushcut schedule limitation</strong><p>Keep Pushcut visible on Ready For Requests. Timed Natural Voice and short Suno/direct announcement clips can run in this mode. Scheduled Apple Music, Spotify, and Suno music changes require Browser Receiver mode because Safari cannot control them while Pushcut is foreground.</p></div>`
        : `<div class="callout warning"><strong>iPhone schedule requirement</strong><p>Keep the authorized receiver iPhone plugged in and this page visible for Suno, Apple Music, Spotify, and their scheduled changes; use separate iPhones for commands. ${automatic ? 'The Email automation may briefly run in the background and returns control to the Receiver browser; do not leave another app open.' : 'If the receiver page is hidden or locked, Version X stops safely and requires fresh Start and Connect taps.'} Apple Music requires an active subscription.</p></div>`}`;
}

function renderActivity() {
  const clearedAt = Number(store.state.config.logClearedAt || 0);
  const entries = (store.state.activityLog || []).filter(entry => Number(entry.createdAt || 0) > clearedAt);
  return `
    <section class="pageHeading splitHeading"><div><p class="kicker">Activity</p><h1>What the receiver actually did.</h1><p>Completed, failed, and safety actions are recorded separately from button taps.</p></div><button data-action="clear-activity" class="secondary">Clear View</button></section>
    <section class="activityList">
      ${entries.length ? entries.map(entry => `<article class="activityItem ${escapeAttr(entry.kind || '')}"><time>${escapeHtml(formatClock(entry.createdAt))}</time><div><strong>${escapeHtml(entry.title)}</strong><p>${escapeHtml(entry.detail || '')}</p></div><span>${escapeHtml(entry.kind || 'system')}</span></article>`).join('') : '<div class="emptyState"><strong>No activity in this view</strong><p>New receiver actions will appear here.</p></div>'}
    </section>`;
}

function renderSettings() {
  const config = store.state.config;
  const iphoneApple = activeReceiverIsIOS();
  const nativeLocal = apple.nativeEnabled?.();
  const nativeLive = liveReceiverIsNative();
  const nativeContext = nativeLocal || nativeLive;
  const cloudAppleReady = receiverOnline(store.state.receiver, store.now()) && store.state.receiver?.appleStatus === 'ready';
  const applePolicy = audioPolicy({ provider: 'apple', isIOS: iphoneApple, supportsVolume: apple.supportsVolume, volumeVerified: apple.volumeVerified, verifiedPercent: apple.verifiedPercent, musicPercent: config.musicLevel, voicePercent: audibleVoiceTarget() });
  const appleReadiness = apple.readiness();
  const spotifyReadiness = spotify.readiness();
  const cloudSpotifyReady = receiverOnline(store.state.receiver, store.now()) && store.state.receiver?.spotifyStatus === 'ready';
  const spotifyPolicy = audioPolicy({ provider: 'spotify', isIOS: activeReceiverIsIOS(), supportsVolume: spotify.supportsVolume, volumeVerified: spotify.volumeVerified, verifiedPercent: spotify.verifiedPercent, musicPercent: config.musicLevel, voicePercent: audibleVoiceTarget() });
  const appleStage = nativeLocal
    ? appleReadiness.ready
      ? 'Music.app connected'
      : apple.accessVerified
        ? 'Connect Music.app receiver'
        : 'Allow Music.app control'
    : role === 'command' && nativeLive
      ? cloudAppleReady ? 'Mac Music.app receiver connected' : 'Mac receiver needs attention'
    : !apple.loggedIn()
    ? apple.authorizationPrepared
      ? 'Step 2 · authorize Apple Music'
      : 'Step 1 · prepare Apple Music'
    : appleReadiness.ready
      ? 'Apple account authorized · browser playback active'
      : 'Apple account authorized · activate browser playback';
  const roleControls = nativeLocal
    ? '<div class="callout"><strong>Dedicated Mac receiver</strong><p>This app stays in Speaker Receiver mode. Use the Version X URL on another device for Remote Control.</p></div>'
    : role === 'receiver' && runtime.active
    ? roleChangePending
      ? `<div class="callout warning"><strong>Stop the live receiver?</strong><p>Changing this device to Remote Control stops speaker audio and releases its receiver lease.</p><div class="stackedActions"><button data-action="set-role" data-role="command" class="danger">Confirm Stop & Change Role</button><button data-action="cancel-role-change" class="secondary">Keep Receiver Live</button></div></div>`
      : '<button data-action="request-role-change" class="secondary">Stop Receiver & Change to Remote Control</button>'
    : `<button data-action="set-role" data-role="${role === 'receiver' ? 'command' : 'receiver'}" class="secondary">Change to ${role === 'receiver' ? 'Remote Control' : 'Speaker Receiver'}</button>`;
  return `
    <section class="pageHeading"><p class="kicker">Settings & diagnostics</p><h1>Simple controls, honest status.</h1><p>${receiverOperatingMode() === 'pushcut' ? `Pushcut announcements use the shared iPhone output with the ${config.musicLevel}/${audibleVoiceTarget()} Shortcut sequence; the native music bed stays under direct control of the Receiver iPhone.` : 'Browser Receiver mode gives the Remote music controls while Version X remains visible on the speaker device.'}</p></section>
    <section class="settingsGrid">
      <form data-form="settings" class="workspacePanel">
        <div class="sectionHeading"><div><p class="kicker">Weather & voice</p><h2>Operating settings</h2></div></div>
        <label>Location label (informational)<input name="address" value="${escapeAttr(config.address)}" /><small>Weather monitoring uses the latitude and longitude below; changing this label does not move the monitored point.</small></label>
        <div class="twoCols"><label>Latitude (authoritative)<input name="latitude" type="number" step="0.0001" value="${escapeAttr(config.latitude)}" /></label><label>Longitude (authoritative)<input name="longitude" type="number" step="0.0001" value="${escapeAttr(config.longitude)}" /></label></div>
        <div class="threeCols"><label>Lightning miles<input name="lightningRadiusMiles" type="number" min="1" max="25" value="${escapeAttr(config.lightningRadiusMiles)}" /></label><label>Hold minutes<input name="lightningHoldMinutes" type="number" min="5" max="90" value="${escapeAttr(config.lightningHoldMinutes)}" /></label><label>Wind gust mph<input name="windGustMph" type="number" min="15" max="80" value="${escapeAttr(config.windGustMph)}" /></label></div>
        <label>AI voice<select name="aiVoice">${['marin', 'cedar', 'coral', 'sage', 'onyx', 'nova'].map(voice => `<option ${config.aiVoice === voice ? 'selected' : ''}>${voice}</option>`).join('')}</select><small>Routine messages use this voice. Safety messages are prewarmed; if one is not cached, the receiver prepares the same natural voice before playing it and records a real failure if generation is unavailable.</small></label>
        <label class="checkLabel"><input name="weatherAuto" type="checkbox" ${config.weatherAuto ? 'checked' : ''} /> Automatic weather scan every two minutes</label>
        <button type="submit" class="primary">Save Settings</button>
      </form>
      <section class="workspacePanel">
        <div class="sectionHeading"><div><p class="kicker">Apple Music receiver</p><h2>${escapeHtml(appleStage)}</h2></div></div>
        ${nativeContext
          ? `<div class="capabilityCard ${(nativeLocal ? apple.accessVerified : cloudAppleReady) ? 'verified' : 'limited'}"><span>macOS Music.app automation</span><strong>${escapeHtml(nativeLocal ? (apple.accessVerified ? 'Music.app control allowed' : 'Allow Music.app control on this Mac') : (cloudAppleReady ? `${store.state.receiver?.name || 'Mac receiver'} is ready` : `${store.state.receiver?.name || 'Mac receiver'} needs attention`))}</strong><p>${escapeHtml(nativeLocal ? (apple.accessVerified ? 'Poolside Pulse can play, pause, and read back Music.app volume from 0 through 100.' : 'Tap Allow Music.app Control, then approve the macOS Automation prompt. Music.app must be signed in to an active Apple Music subscription.') : (store.state.receiver?.appleDetail || 'The command device never controls Music.app directly; it sends commands to the Mac receiver.'))}</p></div>`
          : `<div class="capabilityCard ${apple.loggedIn() ? 'verified' : 'limited'}"><span>${apple.loggedIn() ? 'Apple account authorization saved' : apple.authorizationPrepared ? 'Preparation complete' : 'Apple Music subscription required'}</span><strong>${apple.loggedIn() ? appleReadiness.ready ? 'Account authorized and browser playback active' : 'Account authorized; browser playback is not active yet' : apple.authorizationPrepared ? 'Now tap Authorize Apple Music' : 'First tap Prepare Apple Music'}</strong><p>Account authorization and browser playback activation are separate. The saved account should not require a new Apple sign-in when switching sources; after Safari is hidden or reloaded, tap Activate Apple Browser Playback to restore only the player session.</p></div>`}
        ${nativeContext
          ? `<div class="capabilityCard ${(nativeLocal ? apple.accessVerified : store.state.receiver?.appleVolumeCapability === 'read-write-0-100') ? 'verified' : 'limited'}"><span>Manager volume path</span><strong>Music.app read/write 0–100</strong><p>${cloudAppleMusicVerified() ? `The receiver most recently read back the active ${config.musicLevel}% target.` : `The receiver applies ${config.musicLevel}% and reads it back whenever Apple Music playback starts or the manager moves the slider.`}</p></div>`
          : `<div class="capabilityCard ${applePolicy.exact ? 'verified' : 'limited'}"><span>${applePolicy.exact ? 'Supported receiver' : 'Compatibility only'}</span><strong>${escapeHtml(applePolicy.label)}</strong><p>${escapeHtml(applePolicy.detail)}</p></div>`}
        ${role === 'receiver'
          ? `<div class="stackedActions">${appleSetupButton({ disabled: apple.loggedIn() && !runtime.isOwner() })}${nativeLocal ? apple.ready ? '<button data-action="apple-logout" class="secondary">Disconnect Music.app</button>' : '' : apple.loggedIn() ? '<button data-action="apple-logout" class="secondary">Remove Apple Music Authorization</button>' : ''}</div>${apple.loggedIn() && !runtime.isOwner() ? '<div class="callout"><strong>Start Receiver before connecting Apple Music.</strong><p>Only the device holding the live receiver lease may become the Apple Music player.</p></div>' : ''}`
          : '<div class="callout"><strong>Apple Music controls live only on the speaker receiver.</strong><p>Remote devices send commands and never authorize or connect an Apple Music account.</p></div>'}
        <div class="policyNote"><strong>Required for live and scheduled playback:</strong> ${nativeContext ? 'Music.app signed in to an active Apple Music subscription, the Mac receiver app running, and its macOS Automation permission allowed.' : 'an active Apple Music subscription, an authorized MusicKit session, and this receiver page kept open on the speaker device.'} Apple pauses before Suno or speech; there is no overlap. ${iphoneApple ? 'This active iPhone receiver uses its physical speaker volume; Apple custom percentage targets are disabled in Browser mode. Suno music remains adjustable and every announcement is fixed at 100%.' : nativeContext ? 'The Mac receiver applies and reads back the requested 0–100 Music.app volume.' : 'Desktop receivers may verify exact Apple Music volume.'}</div>
      </section>
      <section class="workspacePanel">
        <div class="sectionHeading"><div><p class="kicker">Spotify receiver</p><h2>${spotifyReadiness.ready ? 'Spotify account saved · browser playback active' : spotify.accessVerified ? 'Spotify account verified · activate browser playback' : spotify.loggedIn() ? 'Spotify account saved · verify access' : 'Authorize Spotify account'}</h2></div></div>
        <div class="capabilityCard ${spotify.loggedIn() && (spotify.accessVerified || cloudSpotifyReady) ? 'verified' : 'limited'}"><span>${spotify.loggedIn() ? 'Spotify account authorization saved' : 'Spotify Premium required'}</span><strong>${spotify.loggedIn() ? spotifyReadiness.ready || cloudSpotifyReady ? 'Account authorized and browser playback active' : spotify.accessVerified ? 'Account verified; browser playback is not active yet' : 'Account saved; verify this receiver account' : 'Authorize once on the speaker receiver'}</strong><p>${escapeHtml(role === 'command' ? store.state.receiver?.spotifyDetail || 'Spotify authorization stays on the speaker receiver.' : spotify.accessError || spotifyReadiness.detail)}</p></div>
        ${spotifyDeveloperSetupCard()}
        <div class="capabilityCard ${spotifyPolicy.exact ? 'verified' : 'limited'}"><span>${spotifyPolicy.exact ? 'Verified path' : 'iPhone compatibility path'}</span><strong>${escapeHtml(spotifyPolicy.label)}</strong><p>${escapeHtml(spotifyPolicy.detail)}</p></div>
        ${role === 'receiver'
          ? `<div class="stackedActions">${spotifySetupButton({ disabled: spotify.loggedIn() && !runtime.isOwner() })}${spotify.loggedIn() ? '<button data-action="spotify-logout" class="secondary">Remove Spotify Login</button>' : ''}</div>${spotify.loggedIn() && !runtime.isOwner() ? '<div class="callout"><strong>Start Receiver before connecting Spotify.</strong><p>Only the device holding the live receiver lease may become the Spotify player.</p></div>' : ''}`
          : '<div class="callout"><strong>Spotify account authorization stays on the speaker phone.</strong><p>On that iPhone, open Receiver → Browser Receiver, then tap Authorize Spotify Account once. Remote devices never hold the Spotify login.</p></div>'}
        <div class="policyNote"><strong>Automatic Receiver mode:</strong> Spotify Premium, <code>${SPOTIFY_REDIRECT_URI}</code> registered exactly, and the receiver account authorized in this visible Browser Receiver. Account authorization persists separately from playback activation; the background Shortcut handles announcement ducking and restoration.</div>
      </section>
      <section class="workspacePanel">
        <div class="sectionHeading"><div><p class="kicker">Sound verification</p><h2>Suno / voice sound check</h2></div></div>
        <p>Plays a temporary ${config.musicLevel}% calibration bed, silences it to ${DUCK_LEVEL_PERCENT}% for a ${audibleVoiceTarget()}% spoken announcement, then stops the test and restores the prior source.</p>
        ${audio.status().calibrationActive
          ? '<button data-action="stop-calibration" class="danger alwaysAvailable">Stop Sound Check</button>'
          : `<button data-action="calibration" class="primary" ${role !== 'receiver' || !runtime.isOwner() ? 'disabled' : ''}>Run ${config.musicLevel}/${audibleVoiceTarget()} Sound Check</button>`}
        <dl class="diagnosticList"><div><dt>Audio context</dt><dd>${escapeHtml(audio.status().contextState)}</dd></div><div><dt>Cloud state</dt><dd>${escapeHtml(store.syncMode)}</dd></div><div><dt>Receiver</dt><dd>${receiverOnline(store.state.receiver, store.now()) ? 'online' : 'offline'}</dd></div><div><dt>Last weather</dt><dd>${escapeHtml(relativeTime(store.state.weather.checkedAt))}</dd></div></dl>
      </section>
      <section class="workspacePanel">
        <div class="sectionHeading"><div><p class="kicker">This device</p><h2>${role === 'receiver' ? 'Speaker Receiver' : 'Remote Control'}</h2></div></div>
        <p>Device ID: <code>${escapeHtml(runtime.deviceId)}</code></p>
        ${roleControls}
        <div class="stackedActions"><button data-action="logout" class="secondary">Lock Poolside Pulse</button><a href="/v23-backup.html" class="textLink">Open archived v23 backup</a></div>
      </section>
    </section>`;
}

function renderContent() {
  if (activeTab === 'receiver') return renderReceiver();
  if (activeTab === 'announce') return renderAnnounce();
  if (activeTab === 'schedule') return renderSchedule();
  if (activeTab === 'activity') return renderActivity();
  if (activeTab === 'settings') return renderSettings();
  return renderControl();
}

function renderApp() {
  const policy = displayAudioPolicy();
  const footerMix = automaticAnnouncementsEnabled()
    ? `Automatic ${audibleMusicTarget()} → 0 → 100 → ${audibleMusicTarget()} · physical output unmeasured`
    : receiverOperatingMode() === 'pushcut'
    ? `Shortcut ${audibleMusicTarget()} → 0 → 100 → ${audibleMusicTarget()} · physical output unmeasured`
    : policy.exact
    ? `Music ${policy.musicPercent}% · Voice ${audibleVoiceTarget()}%`
    : activeReceiverIsIOS() && ['apple', 'spotify'].includes(effectiveProvider())
      ? `${effectiveProvider() === 'spotify' ? 'Spotify' : 'Apple Music'} physical volume unverified · Voice ${audibleVoiceTarget()}%`
      : `${effectiveProvider() === 'spotify' ? 'Spotify' : 'Apple Music'} target ${store.state.config.musicLevel}% unverified · Voice ${audibleVoiceTarget()}%`;
  return `
    ${renderHeader()}
    <div class="appShell ${busy ? 'busy' : ''}" aria-busy="${busy}">
      ${tabs()}
      ${feedbackBanner()}
      <main class="content">${renderContent()}</main>
    </div>
    <footer class="appFooter"><span>Poolside Pulse · Resort Media Hub · Version X</span><span>${footerMix} · Weather every 2 minutes</span></footer>`;
}

function formIdentity(form) {
  if (!form?.dataset?.form || form.dataset.form === 'login') return '';
  return `${form.dataset.form}:${form.dataset.id || ''}`;
}

function captureDirtyFormDrafts() {
  return [...root.querySelectorAll('form[data-form][data-dirty="true"]')].map(form => {
    const key = formIdentity(form);
    if (!key) return null;
    const controls = [...form.elements].map(control => ({
      key: control.name ? `${control.name}:${control.type === 'checkbox' || control.type === 'radio' ? `${control.type}:${control.value}` : `${control.tagName}:${control.type || ''}`}` : '',
      name: control.name || '',
      tag: control.tagName,
      type: control.type || '',
      value: !['password', 'file'].includes(control.type) ? control.value : '',
      checked: !!control.checked,
      selected: control.tagName === 'SELECT' ? [...control.options].map(option => option.selected) : null
    }));
    const activeIndex = [...form.elements].indexOf(document.activeElement);
    const active = activeIndex >= 0 ? document.activeElement : null;
    return {
      key,
      controls,
      activeIndex,
      activeKey: controls[activeIndex]?.key || '',
      selectionStart: active && Number.isFinite(active.selectionStart) ? active.selectionStart : null,
      selectionEnd: active && Number.isFinite(active.selectionEnd) ? active.selectionEnd : null
    };
  }).filter(Boolean);
}

function restoreDirtyFormDrafts(drafts) {
  for (const draft of drafts) {
    const form = [...root.querySelectorAll('form[data-form]')].find(candidate => formIdentity(candidate) === draft.key);
    if (!form) continue;
    const controls = [...form.elements];
    const controlsByKey = new Map(controls.map(control => [control.name ? `${control.name}:${control.type === 'checkbox' || control.type === 'radio' ? `${control.type}:${control.value}` : `${control.tagName}:${control.type || ''}`}` : '', control]).filter(([key]) => key));
    draft.controls.forEach((saved, index) => {
      const control = controlsByKey.get(saved.key) || controls[index];
      if (!control || control.name !== saved.name || control.tagName !== saved.tag) return;
      if (saved.selected && control.tagName === 'SELECT') {
        [...control.options].forEach((option, optionIndex) => { option.selected = !!saved.selected[optionIndex]; });
      } else if (saved.type === 'checkbox' || saved.type === 'radio') {
        control.checked = saved.checked;
      } else if (!['password', 'file'].includes(saved.type)) {
        control.value = saved.value;
      }
    });
    form.dataset.dirty = 'true';
    if (form.dataset.form === 'schedule-item') updateScheduleFormVisibility(form);
    const active = controlsByKey.get(draft.activeKey) || controls[draft.activeIndex];
    if (active) {
      active.focus({ preventScroll: true });
      if (draft.selectionStart !== null && typeof active.setSelectionRange === 'function') {
        try { active.setSelectionRange(draft.selectionStart, draft.selectionEnd); } catch {}
      }
    }
  }
}

function clearDirtyForm(key) {
  if (!key) return;
  const form = [...root.querySelectorAll('form[data-form]')].find(candidate => formIdentity(candidate) === key);
  if (form) delete form.dataset.dirty;
}

function render({ preserveDetails = true, preserveForms = true } = {}) {
  const focusedKey = document.activeElement?.dataset?.focusKey || '';
  const openDetails = preserveDetails
    ? [...root.querySelectorAll('details[open][data-persist-open]')].map(item => item.dataset.persistOpen)
    : [];
  const dirtyDrafts = preserveForms ? captureDirtyFormDrafts() : [];
  if (!authChecked) root.innerHTML = renderLoading();
  else if (!authenticated) root.innerHTML = renderLogin();
  else if (!role) root.innerHTML = renderRolePicker();
  else root.innerHTML = renderApp();
  for (const key of openDetails) {
    const detail = root.querySelector(`details[data-persist-open="${CSS.escape(key)}"]`);
    if (detail) detail.open = true;
  }
  if (pendingOpenScheduleItemId) {
    const detail = root.querySelector(
      `details[data-persist-open="schedule-${CSS.escape(pendingOpenScheduleItemId)}"]`
    );
    if (detail) {
      detail.open = true;
      pendingOpenScheduleItemId = '';
      requestAnimationFrame(() => {
        detail.scrollIntoView({ block: 'center', behavior: 'smooth' });
        detail.querySelector('input[name="label"]')?.focus({ preventScroll: true });
      });
    }
  }
  restoreDirtyFormDrafts(dirtyDrafts);
  if (focusedKey) root.querySelector(`[data-focus-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
}

function selectTab(nextTab, { discardDirty = false } = {}) {
  const allowedTabs = allowedTabsForRole();
  const candidate = String(nextTab || 'control');
  const requested = allowedTabs.includes(candidate) ? candidate : allowedTabs[0];
  if (requested === activeTab) {
    pendingTab = '';
    return true;
  }
  if (!discardDirty && requested !== activeTab && root.querySelector('form[data-dirty="true"]')) {
    pendingTab = requested;
    feedback = { message: 'Choose whether to keep editing or discard the unsaved changes.', ok: false };
    renderWhenIdle(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const prompt = root.querySelector('.unsavedPrompt');
      prompt?.scrollIntoView({ block: 'start', behavior: 'auto' });
      prompt?.querySelector('[data-action="cancel-tab"]')?.focus({ preventScroll: true });
    }));
    return false;
  }
  pendingTab = '';
  if (requested !== activeTab) {
    previousTab = allowedTabs.includes(activeTab) ? activeTab : '';
    if (previousTab) localStorage.setItem(PREVIOUS_TAB_KEY, previousTab);
    else localStorage.removeItem(PREVIOUS_TAB_KEY);
  }
  activeTab = requested;
  localStorage.setItem(TAB_KEY, activeTab);
  roleChangePending = false;
  render({ preserveDetails: false, preserveForms: false });
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    const heading = root.querySelector('main.content h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  });
  return true;
}

async function setRole(nextRole, { silent = false } = {}) {
  if (!['receiver', 'command'].includes(nextRole)) return;
  if (apple.nativeEnabled?.() && nextRole !== 'receiver') {
    if (!silent) setFeedback('The Mac receiver app stays in Speaker Receiver mode. Use the Version X URL on another device for Remote Control.', false);
    return;
  }
  if (role === 'receiver' && nextRole === 'command' && runtime.active) await runtime.stop();
  role = nextRole;
  localStorage.setItem(ROLE_KEY, role);
  try {
    const cleanUrl = new URL(location.href);
    cleanUrl.hash = apple.nativeEnabled?.() && nextRole === 'receiver' ? 'receiver' : '';
    history.replaceState(null, '', cleanUrl);
  } catch {}
  activeTab = role === 'receiver' ? 'receiver' : 'control';
  localStorage.setItem(TAB_KEY, activeTab);
  previousTab = '';
  localStorage.removeItem(PREVIOUS_TAB_KEY);
  takeoverTarget = null;
  roleChangePending = false;
  if (role === 'command') {
    apple.disconnect();
    spotify.disconnect();
    if (!automaticAnnouncementsEnabled()) queuePushcutScheduleSync(0);
    if (!silent) setFeedback('Remote Control mode: this device will never produce receiver audio.', true);
  } else {
    if (!silent) setFeedback('Speaker Receiver mode selected. Tap Start Receiver while connected to the speakers.', true);
    if (apple.loggedIn() && !apple.nativeEnabled?.()) await restoreStoredAppleAuthorization({ reportSuccess: !silent });
    if (spotify.loggedIn()) spotify.preparePlayer().catch(() => {});
  }
  renderWhenIdle(true);
}

async function selectSharedReceiverMode(nextMode) {
  const mode = nextMode === 'pushcut' ? 'pushcut' : 'browser';
  if (store.state.config?.receiverMode === mode) return store.state;
  return await store.mutate(draft => {
    draft.config.receiverMode = mode;
    return draft;
  }, `${mode === 'pushcut' ? 'Pushcut' : 'Browser Receiver'} mode selected`, { requireDurable: true });
}

async function selectAnnouncementTransport(nextTransport, {
  verifiedPairingAt = 0
} = {}) {
  const transport =
    nextTransport === 'email-wake' ? 'email-wake' : 'browser';
  const previousTransport =
    store.state.config?.announcementTransport === 'email-wake'
      ? 'email-wake'
      : 'browser';
  const previousVerifiedPairingAt = Number(
    store.state.config?.automaticReceiverVerifiedPairingAt || 0
  );
  const requestedVerifiedPairingAt = Number(verifiedPairingAt || 0);
  if (
    transport === 'email-wake'
    && (
      !Number.isSafeInteger(requestedVerifiedPairingAt)
      || requestedVerifiedPairingAt <= 0
    )
  ) {
    throw new Error(
      'Run the signed Automatic Receiver test before enabling background announcements.'
    );
  }
  if (
    previousTransport === transport
    && (
      transport === 'email-wake'
        ? previousVerifiedPairingAt === requestedVerifiedPairingAt
        : previousVerifiedPairingAt === 0
    )
  ) {
    return store.state;
  }
  if (!emailWakeStatus.ready) {
    throw new Error(
      transport === 'email-wake'
        ? 'Configure the Automatic Receiver service before turning it on.'
        : 'Automatic timed announcements could not be cancelled because the service is unavailable. Leave Automatic Receiver on and retry when service returns.'
    );
  }
  const synchronized = await syncCurrentEmailWakeSchedule({
    enabledOverride: transport === 'email-wake'
  });
  let saved;
  try {
    saved = await store.mutate(draft => {
      draft.config.announcementTransport = transport;
      draft.config.automaticReceiverVerifiedPairingAt =
        transport === 'email-wake' ? requestedVerifiedPairingAt : 0;
      return draft;
    }, `${
      transport === 'email-wake'
        ? 'Automatic Receiver'
        : 'Browser announcement'
    } transport selected`, { requireDurable: true });
  } catch (saveError) {
    try {
      const rolledBack = await syncCurrentEmailWakeSchedule({
        enabledOverride:
          previousTransport === 'email-wake'
          && previousVerifiedPairingAt > 0,
        retryStale: true
      });
      setEmailWakeScheduleStatus({
        ...rolledBack,
        enabled:
          previousTransport === 'email-wake'
          && previousVerifiedPairingAt > 0,
        current: true,
        synchronized: true
      });
    } catch (rollbackError) {
      setEmailWakeScheduleStatus({}, {
        error:
          `Transport save failed and its schedule rollback also failed: ${
            rollbackError.message || String(rollbackError)
          }`
      });
      throw new Error(
        `${saveError.message || String(saveError)} Automatic schedule rollback also failed: ${
          rollbackError.message || String(rollbackError)
        }`
      );
    }
    throw saveError;
  }
  observedEmailWakeScheduleFingerprint =
    emailWakeScheduleFingerprint(saved);
  setEmailWakeScheduleStatus({
    ...synchronized,
    enabled: transport === 'email-wake',
    current: true,
    synchronized: true
  });
  return saved;
}

async function setProvider(provider) {
  const target = clamp(store.state.config.musicLevel, 0, 100, 30);
  const selected = ['apple', 'spotify'].includes(provider) ? provider : 'controlled';
  const pushcutMode = receiverOperatingMode() === 'pushcut';
  const automatic = automaticAnnouncementsEnabled();
  const iphoneExternal = selected !== 'controlled' && !pushcutMode && activeReceiverIsIOS();
  const providerLabel = selected === 'apple' ? 'Apple Music' : selected === 'spotify' ? 'Spotify' : 'Suno / direct';
  await store.mutate(draft => {
    draft.config.musicProvider = selected;
    draft.activityLog = [makeLog(
      'settings',
      'Music source selected',
      selected === 'controlled'
        ? `Manager Volume: Suno/direct exact ${target}/${VOICE_LEVEL_PERCENT} mode`
        : automatic
          ? `${providerLabel} with Automatic Receiver ${target}/${VOICE_LEVEL_PERCENT} physical output`
          : pushcutMode
          ? `${providerLabel} with Pushcut Shortcut ${target}/${VOICE_LEVEL_PERCENT} physical output`
          : iphoneExternal
            ? `${providerLabel} with Browser Receiver physical volume; announcement ${VOICE_LEVEL_PERCENT}%`
            : `${providerLabel} ${target}% target`
    ), ...(draft.activityLog || [])];
    return draft;
  }, 'Music source selected');
  setFeedback(selected !== 'controlled'
    ? automatic
      ? `${providerLabel} selected. Automatic Receiver applies ${target}% music, 0% during announcements, 100% announcement playback, then restores ${target}%.`
      : pushcutMode
      ? `${providerLabel} selected. The receiver Shortcut requests ${target}% music and ${audibleVoiceTarget()}% announcements, then runs its restore steps; physical loudness is not measured.`
      : iphoneExternal
        ? `${providerLabel} selected in Browser Receiver mode. Music uses the iPhone or connected speaker’s physical volume and pauses completely before ${audibleVoiceTarget()}% announcements.`
        : `${providerLabel} selected with a ${target}% target. It will pause for announcements.`
    : `Manager Volume selected for guaranteed ${target}% music / ${audibleVoiceTarget()}% announcements.`, true);
}

async function saveManagedMusicLevel(percent, { startSource = false } = {}) {
  const target = clamp(percent, 0, 100, 30);
  const stateBefore = store.state;
  const sourceUrl = String(stateBefore.config.musicUrl || '').trim();
  const online = receiverOnline(stateBefore.receiver, store.now());
  const plan = managerVolumePlan({
    selectedProvider: ['apple', 'spotify'].includes(stateBefore.config.musicProvider) ? stateBefore.config.musicProvider : 'apple',
    receiverIsIOS: true,
    playbackProvider: stateBefore.playback?.provider,
    playbackIntent: stateBefore.playback?.intent,
    controlledSource: sourceUrl,
    startControlled: startSource
  });
  audio.setMusicLevelPercent(
    controlledBrowserGainTarget(stateBefore, target),
    { report: false }
  );
  await store.mutate(draft => {
    draft.config.musicProvider = plan.nextProvider;
    draft.config.musicLevel = target;
    if (['apple', 'spotify'].includes(draft.playback?.provider)) {
      draft.playback.volumeVerified = false;
      draft.playback.volumeVerifiedPercent = null;
      draft.playback.volumeVerifiedAt = 0;
      if (!online) {
        draft.playback.intent = 'stopped';
        draft.playback.label = 'Ready for Manager Volume';
        draft.playback.updatedAt = store.now();
      }
    }
    draft.activityLog = [makeLog('settings', 'Manager Volume enabled', `${target}% Suno/direct music; ${audibleVoiceTarget(draft)}% announcements. Apple authorization preserved.`), ...(draft.activityLog || [])];
    return draft;
  }, `Manager Volume ${target}% saved`);
  if (!online) {
    setFeedback(`Manager Volume is saved at ${target}%. Start the speaker receiver, then play the saved Suno source. Apple authorization was not removed.`, true);
    return target;
  }
  if (plan.command === 'play-controlled') {
    await runtime.sendCommand('play-controlled', {
      url: sourceUrl,
      label: 'Manager Volume · Suno / Direct',
      volumePercent: target,
      volumeMode: 'global'
    }, `Switch to Manager Volume at ${target}% sent to receiver.`);
    setFeedback(`Manager Volume is active: music ${target}%, announcements ${audibleVoiceTarget()}%. Apple remains authorized.`, true);
    return target;
  }
  if (plan.command === 'stop-music') {
    await runtime.sendCommand('stop-music', { label: 'Switch to Manager Volume' }, 'Apple Music stop sent before Manager Volume setup.');
    setFeedback(`Apple Music stopped safely. Manager Volume is ${target}%; choose a Suno / Direct source and tap Play. Apple remains authorized.`, true);
    return target;
  }
  await runtime.sendCommand('set-music-level', { percent: target, label: `${target}% Manager Volume` }, `Manager Volume ${target}% sent to receiver.`);
  setFeedback(`Manager Volume is ready at ${target}% music / ${audibleVoiceTarget()}% announcements.`, true);
  return target;
}

async function saveMusicLevel(percent, { forceManaged = false, startManagedSource = false } = {}) {
  const scheduleFingerprintBefore = emailWakeScheduleFingerprint(store.state);
  const target = clamp(percent, 0, 100, 30);
  const switchToManaged = forceManaged || (
    ['apple', 'spotify'].includes(store.state.config.musicProvider)
    && activeReceiverIsIOS()
    && receiverOperatingMode() !== 'pushcut'
    && !automaticAnnouncementsEnabled()
  );
  if (switchToManaged) return await saveManagedMusicLevel(target, { startSource: startManagedSource });
  if (customPlaybackMusicTarget(store.state) === null) {
    audio.setMusicLevelPercent(
      controlledBrowserGainTarget(store.state, target),
      { report: false }
    );
    apple.setTargetVolumePercent(target);
    spotify.setTargetVolumePercent(target);
  }
  await store.mutate(draft => {
    draft.config.musicLevel = target;
    if (['apple', 'spotify'].includes(draft.playback?.provider)) {
      draft.playback.volumeVerified = false;
      draft.playback.volumeVerifiedPercent = null;
      draft.playback.volumeVerifiedAt = 0;
    }
    draft.activityLog = [makeLog('settings', 'Music target changed', `${target}% music; ${audibleVoiceTarget(draft)}% announcements.`), ...(draft.activityLog || [])];
    return draft;
  }, `Music target ${target}% saved`);
  if (automaticAnnouncementsEnabled()) {
    await applyReceiverMusicTargetNow(target);
    await ensureAutomaticScheduleSyncAfterChange(
      scheduleFingerprintBefore,
      `Music target ${target}%`
    );
    return target;
  }
  if (receiverOperatingMode(store.state) === 'pushcut') {
    if (pushcutMusicVolumeReady()) {
      await applyReceiverMusicTargetNow(target);
    } else {
      setFeedback(`Music target saved at ${target}%. It will be applied by the receiver Shortcut when Pushcut is ready.`, true);
    }
    return target;
  }
  if (receiverOnline(store.state.receiver, store.now())) {
    await runtime.sendCommand('set-music-level', { percent: target, label: `${target}% music target` }, `Music target ${target}% sent to receiver.`);
  } else {
    setFeedback(`Music target saved at ${target}%. It will apply when the speaker receiver starts.`, true);
  }
  return target;
}

function queueMusicLevelSave(percent) {
  queuedMusicLevel = clamp(percent, 0, 100, 30);
  musicLevelDraft = queuedMusicLevel;
  if (musicLevelDrain) return musicLevelDrain;
  musicLevelDrain = (async () => {
    while (queuedMusicLevel !== null) {
      await new Promise(resolve => setTimeout(resolve, 180));
      const target = queuedMusicLevel;
      queuedMusicLevel = null;
      if (busy) await actionSettled;
      const sequence = ++musicLevelSaveSequence;
      activeMusicLevelSaveTarget = target;
      setFeedback(`Saving music at ${target}%...`, true);
      try {
        await saveMusicLevel(target);
        if (sequence === musicLevelSaveSequence && queuedMusicLevel === null) {
          musicLevelDraft = null;
          setFeedback(store.state.config.musicProvider === 'controlled'
            ? `Manager Volume is active at ${target}% music / ${audibleVoiceTarget()}% announcements. Music silences to ${DUCK_LEVEL_PERCENT}% during speech.`
            : `Music target saved at ${target}%. Announcements silence music to ${DUCK_LEVEL_PERCENT}%.`, true);
          renderWhenIdle(true);
        }
      } catch (error) {
        if (sequence === musicLevelSaveSequence && queuedMusicLevel === null) {
          musicLevelDraft = null;
          const savedTarget = audibleMusicTarget(store.state);
          audio.setMusicLevelPercent(
            controlledBrowserGainTarget(store.state, savedTarget),
            { report: false }
          );
          apple.setTargetVolumePercent(savedTarget);
          spotify.setTargetVolumePercent(savedTarget);
          setFeedback(error.message || String(error), false);
          renderWhenIdle(true);
        }
      } finally {
        if (activeMusicLevelSaveTarget === target) activeMusicLevelSaveTarget = null;
      }
    }
  })().finally(() => {
    musicLevelDrain = null;
    if (queuedMusicLevel !== null) queueMusicLevelSave(queuedMusicLevel);
  });
  return musicLevelDrain;
}

function debounceMusicLevelSave(percent, delayMs = 320) {
  const target = clamp(percent, 0, 100, 30);
  musicLevelDraft = target;
  clearTimeout(musicLevelInputSaveTimer);
  musicLevelInputSaveTimer = setTimeout(() => {
    musicLevelInputSaveTimer = null;
    queueMusicLevelSave(target);
  }, delayMs);
}

function flushMusicLevelSave(percent) {
  const target = clamp(percent, 0, 100, 30);
  musicLevelDraft = target;
  clearTimeout(musicLevelInputSaveTimer);
  musicLevelInputSaveTimer = null;
  if (queuedMusicLevel === target || activeMusicLevelSaveTarget === target) return musicLevelDrain;
  if (Number(store.state.config.musicLevel) === target && queuedMusicLevel === null) {
    musicLevelDraft = null;
    return musicLevelDrain;
  }
  return queueMusicLevelSave(target);
}

async function dispatchAutomaticAnnouncement({
  text,
  label = 'Speak Now',
  safety = false,
  announcementMode = 'natural-voice',
  announcementProvider = '',
  announcementAudioUrl = '',
  announcementDurationSeconds = 0
} = {}) {
  if (!emailWakeOperational()) {
    throw new Error(
      emailWakeStatus.ready
        ? 'Automatic Receiver has not paired with this speaker iPhone. Finish the one-time Receiver setup first.'
        : emailWakeStatus.note
          || 'Automatic Receiver is not configured yet.'
    );
  }
  const requestedMusicTarget = audibleMusicTarget(store.state);
  const result = await sendEmailWakeAnnouncement({
    text,
    label,
    safety,
    musicPercent: requestedMusicTarget,
    announcementMode,
    announcementProvider,
    announcementAudioUrl,
    announcementDurationSeconds
  });
  await store.mutate(draft => {
    draft.activityLog = [
      makeLog(
        'command',
        `${label} queued for Automatic Receiver`,
        'Wake sent; waiting for the signed iPhone completion receipt.',
        store.now(),
        {
          eventId: result.eventId,
          commandType: safety ? 'announce-safety' : 'announce',
          automaticReceiverStatus: 'queued'
        }
      ),
      ...(draft.activityLog || [])
    ];
    return draft;
  }, 'Automatic Receiver acceptance recorded').catch(() => {});
  setFeedback(
    `${label} is queued. Waiting for music ${requestedMusicTarget}% → 0% → announcement 100% → restore ${requestedMusicTarget}%...`,
    true
  );
  const completed = await waitForEmailWakeCompletion(result.eventId, {
    onUpdate: status => {
      const stage = String(
        status.receipt?.providerStatus || status.status || ''
      );
      if (stage.includes('claimed')) {
        setFeedback(
          `${label}: the Receiver claimed the command and is preparing audio...`,
          true
        );
      } else if (stage.includes('audio') || stage === 'started') {
        setFeedback(
          `${label}: audio is ready; waiting for the Receiver to finish playback...`,
          true
        );
      }
    }
  });
  const restoredMusicTarget = clamp(
    completed.receipt?.restoredMusicPercent,
    0,
    100,
    requestedMusicTarget
  );
  await store.mutate(draft => {
    draft.activityLog = [
      makeLog(
        safety ? 'safety' : 'announcement',
        `${label} completed on Automatic Receiver`,
        `Signed receipt: announcement playback finished, music resumed, and the Receiver restored the ${restoredMusicTarget}% target. Physical loudness was not measured.`,
        store.now(),
        {
          eventId: result.eventId,
          commandType: safety ? 'announce-safety' : 'announce',
          automaticReceiverStatus: 'completed'
        }
      ),
      ...(draft.activityLog || [])
    ];
    return draft;
  }, 'Automatic Receiver completion recorded').catch(() => {});
  setFeedback(
    `${label} completed. The Receiver restored music to ${restoredMusicTarget}% after the 100% announcement.`,
    true
  );
  return {
    ...result,
    ...completed,
    musicPercent: restoredMusicTarget,
    completed: true
  };
}

async function sendLiveAnnouncement({
  text,
  label = 'Speak Now',
  safety = false,
  volumePercent = audibleVoiceTarget(store.state),
  sourceId = 'natural-voice',
  forcePushcut = false
} = {}) {
  const source = announcementSourceById(sourceId);
  const delivery = announcementDeliveryForSource(source);
  if (automaticAnnouncementsEnabled()) {
    return await dispatchAutomaticAnnouncement({
      text,
      label,
      safety,
      ...delivery
    });
  }
  const receiverMode = receiverOperatingMode();
  const pushcutReady = pushcutAnnouncementReady();
  const transport = preferredAnnouncementTransport({
    receiverMode,
    browserReceiverOnline: receiverMode === 'browser' && receiverOnline(store.state.receiver, store.now()),
    pushcutReady,
    forcePushcut
  });
  if (transport === 'browser') {
    return await runtime.sendCommand(safety ? 'announce-safety' : 'announce', {
      text,
      label,
      volumePercent: VOICE_LEVEL_PERCENT,
      ...delivery
    }, `${label} sent to receiver.`);
  }
  if (transport === 'unavailable') {
    throw new Error(forcePushcut
      ? 'Pushcut is not ready. On the Receiver iPhone, open Pushcut and leave Ready For Requests visible.'
      : receiverMode === 'pushcut'
        ? 'Pushcut mode is selected, but its announcement action is not configured. Open Pushcut on the Receiver iPhone and leave Ready For Requests visible.'
        : 'Browser Receiver mode is selected, but the speaker receiver is offline. Open Version X on that iPhone and tap Start Receiver.');
  }

  const requestedMusicTarget = audibleMusicTarget(store.state);
  const result = await sendPushcutAnnouncement({
    text,
    label,
    safety,
    voicePercent: VOICE_LEVEL_PERCENT,
    musicPercent: requestedMusicTarget,
    ...delivery
  });
  const expectedMusicTarget = clamp(
    result.receipt?.expectedMusicPercent ?? result.musicPercent,
    0,
    100,
    requestedMusicTarget
  );

  // Pushcut's nowait response proves acceptance only. Save that exact fact, but
  // never turn a later state-save problem into a retryable announcement error.
  await store.mutate(draft => {
    draft.activityLog = [
      makeLog(
        'command',
        `${label} queued for Pushcut`,
        `${source.label} · waiting for the signed receiver completion receipt.`,
        store.now(),
        { eventId: result.eventId, commandType: safety ? 'announce-safety' : 'announce', pushcutStatus: 'queued' }
      ),
      ...(draft.activityLog || [])
    ];
    return draft;
  }, 'Pushcut acceptance recorded').catch(() => {});

  setFeedback(`${label} is queued with ${source.label}. Waiting for music 0% → announcement 100% → restore ${expectedMusicTarget}%...`, true);
  const completed = await waitForPushcutAnnouncementCompletion(result.eventId, {
    onUpdate: status => {
      const stage = String(status.receipt?.providerStatus || status.status || '');
      if (stage.includes('audio')) setFeedback(`${label}: announcement audio prepared; waiting for the receiver to finish playback...`, true);
      else if (status.status === 'started') setFeedback(`${label}: receiver started; waiting for announcement audio to finish...`, true);
    }
  });
  await store.mutate(draft => {
    draft.activityLog = [
      makeLog(
        safety ? 'safety' : 'announcement',
        `${label} completed on receiver`,
        `Signed receipt: the Shortcut reached its final step after audio playback, restored music to ${clamp(completed.receipt?.restoredMusicPercent, 0, 100, expectedMusicTarget)}%, and resumed playback. Physical loudness was not measured.`,
        store.now(),
        { eventId: result.eventId, commandType: safety ? 'announce-safety' : 'announce', pushcutStatus: 'completed' }
      ),
      ...(draft.activityLog || [])
    ];
    return draft;
  }, 'Pushcut completion recorded').catch(() => {});
  const restoredMusicTarget = clamp(
    completed.receipt?.restoredMusicPercent,
    0,
    100,
    expectedMusicTarget
  );
  setFeedback(`${label} completed. Music was restored to ${restoredMusicTarget}% after the 100% announcement; physical loudness was not measured.`, true);
  return { ...result, ...completed, musicPercent: restoredMusicTarget, completed: true };
}

async function runImmediateWeatherCheck() {
  const mode = receiverOperatingMode();
  const automatic = automaticAnnouncementsEnabled();
  if (
    !automatic
    && mode === 'browser'
    && receiverOnline(store.state.receiver, store.now())
  ) {
    return await runtime.sendCommand(
      'weather-check',
      { announce: true, announceStatus: true, label: 'Manual weather check' },
      'Weather check queued for Browser Receiver.'
    );
  }
  if (
    (!automatic && (mode !== 'pushcut' || !pushcutAnnouncementReady()))
    || (automatic && !emailWakeOperational())
  ) {
    throw new Error(automatic
      ? 'Automatic Receiver is not paired and ready. Finish its one-time setup before running an immediate weather announcement.'
      : mode === 'pushcut'
      ? 'Pushcut mode is selected, but its announcement action is not configured. Open Pushcut on the Receiver iPhone and leave Ready For Requests visible.'
      : 'Browser Receiver mode is selected but offline. Start Browser Receiver before running an immediate weather announcement.');
  }

  const retryPlan = preparePendingWeatherAnnouncement({
    weather: store.state.weather,
    savedAnnouncements: store.state.announcements,
    config: store.state.config,
    now: store.now()
  });
  if (retryPlan?.text) {
    const retryResult = await sendLiveAnnouncement({
      text: retryPlan.text,
      label: retryPlan.label,
      safety: true,
      volumePercent: 100,
      sourceId: 'natural-voice'
    });
    await store.mutate(draft => {
      if (Number(draft.weather?.pendingAnnouncementAt || 0) === retryPlan.pendingAt) {
        draft.weather = retryPlan.committedWeather;
      }
      draft.activityLog = [
        makeLog(
          'safety',
          `Pending weather warning replayed through ${automatic ? 'Automatic Receiver' : 'Pushcut'}`,
          retryPlan.announcementIds.join(', '),
          store.now()
        ),
        ...(draft.activityLog || [])
      ];
      return draft;
    }, 'Pending weather warning confirmed');
    setFeedback('The pending safety warning was confirmed. Running the new weather scan now...', true);
    if (!retryResult?.completed) {
      throw new Error('The pending weather warning was accepted but did not return a completion receipt.');
    }
  }

  let requestNow = 0;
  let config = null;
  let payload = null;
  let plan = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    requestNow = store.now();
    config = weatherConfigSnapshot(store.state.config);
    payload = await fetchVersionXJson(weatherRequestUrl(config, {
      lightningLookbackMinutes: 8
    }));
    try {
      await store.mutate(draft => {
        if (!sameWeatherConfig(draft.config, config)) {
          const changed = new Error('Weather settings changed while the scan was running.');
          changed.code = 'WEATHER_CONFIG_CHANGED';
          throw changed;
        }
        plan = prepareImmediateWeatherAnnouncement({
          previousWeather: draft.weather,
          payload,
          config,
          savedAnnouncements: draft.announcements,
          now: requestNow
        });
        draft.weather = plan.stagedWeather;
        draft.activityLog = [
          makeLog(
            payload.providerErrors?.length ? 'warning' : 'weather',
            `Weather check: ${payload.threatType || 'clear'}`,
            `Remote check: ${plan.stagedWeather.status}`,
            requestNow
          ),
          ...(draft.activityLog || [])
        ];
        return draft;
      }, 'Remote weather check completed');
      break;
    } catch (error) {
      if (error?.code === 'WEATHER_CONFIG_CHANGED' && attempt < 2) continue;
      throw error;
    }
  }

  if (!plan?.text) {
    const result = await sendLiveAnnouncement({
      text: manualWeatherStatusAnnouncement({ payload }),
      label: 'Manual Weather Check',
      safety: payload?.threat === true,
      volumePercent: 100,
      sourceId: 'natural-voice'
    });
    setFeedback(`${plan?.completedWeather?.status || 'Weather check completed.'} The Receiver confirmed the spoken status.`, true);
    return { payload, announcementIds: [], completed: true, result };
  }

  try {
    const result = await sendLiveAnnouncement({
      text: plan.text,
      label: plan.label || 'Weather Safety Announcement',
      safety: true,
      volumePercent: 100,
      sourceId: 'natural-voice'
    });
    await store.mutate(draft => {
      if (Number(draft.weather?.pendingAnnouncementAt || 0) === requestNow) {
        draft.weather = plan.completedWeather;
      }
      draft.activityLog = [
        makeLog(
          'safety',
          'Weather safety announcement confirmed',
          plan.announcementIds.join(', '),
          store.now()
        ),
        ...(draft.activityLog || [])
      ];
      return draft;
    }, 'Remote weather announcement confirmed');
    return { payload, announcementIds: plan.announcementIds, completed: true, result };
  } catch (error) {
    await store.mutate(draft => {
      draft.activityLog = [
        makeLog(
          'error',
          'Weather safety announcement failed; retry remains eligible',
          `${plan.announcementIds.join(', ')}: ${error.message || String(error)}`,
          store.now()
        ),
        ...(draft.activityLog || [])
      ];
      return draft;
    }, 'Remote weather announcement retry recorded').catch(() => {});
    throw error;
  }
}

function requireOnlineBrowserReceiver(purpose = 'Remote music controls') {
  if (receiverOperatingMode() !== 'browser' || !receiverOnline(store.state.receiver, store.now())) {
    throw new Error(`${purpose} requires an online Browser Receiver. Return the speaker iPhone to Version X and tap Start Receiver.`);
  }
}

async function sendTransport(command) {
  requireOnlineBrowserReceiver();
  const labels = { 'previous-music': 'Previous sent to receiver.', 'pause-music': 'Pause sent to receiver.', 'resume-music': 'Resume sent to receiver.', 'next-music': 'Next sent to receiver.', 'stop-music': 'Stop sent to receiver.' };
  await runtime.sendCommand(command, { label: labels[command] || command }, labels[command] || 'Music command sent.');
}

async function applyReceiverMusicTargetNow(
  percent = audibleMusicTarget(store.state),
  {
    scheduledItemId = '',
    scheduledRunToken = ''
  } = {}
) {
  if (automaticAnnouncementsEnabled()) {
    if (!emailWakeOperational()) {
      throw new Error('Automatic Receiver is not paired and ready.');
    }
    const requestedTarget = clamp(percent, 0, 100, 30);
    const priorTarget = audibleMusicTarget(store.state);
    if (scheduledRunToken) {
      runtime.assertScheduledRunAuthorization(
        store.state,
        scheduledRunToken,
        scheduledItemId
      );
    }
    emailWakeVolumeStatus = {
      state: 'working',
      message: `Waiting for the Receiver to apply ${requestedTarget}%...`
    };
    renderWhenIdle(true);
    try {
      const queued = await applyEmailWakeMusicVolume({
        musicPercent: requestedTarget
      });
      const completed = await waitForEmailWakeCompletion(queued.eventId);
      const appliedTarget = clamp(
        completed.receipt?.restoredMusicPercent,
        0,
        100,
        requestedTarget
      );
      if (scheduledRunToken) {
        try {
          runtime.assertScheduledRunAuthorization(
            store.state,
            scheduledRunToken,
            scheduledItemId
          );
        } catch (authorizationError) {
          let recoveryDetail = '';
          if (priorTarget !== appliedTarget) {
            try {
              const recovery = await applyEmailWakeMusicVolume({
                musicPercent: priorTarget
              });
              await waitForEmailWakeCompletion(recovery.eventId);
              recoveryDetail = ` The Receiver restored the prior ${priorTarget}% music target.`;
            } catch (recoveryError) {
              recoveryDetail = ` The prior ${priorTarget}% target could not be restored automatically: ${recoveryError.message || String(recoveryError)}`;
            }
          }
          throw new Error(`${authorizationError.message || String(authorizationError)}${recoveryDetail}`);
        }
      }
      const message =
        `Receiver completed the ${appliedTarget}% music target. Physical output was not measured.`;
      emailWakeVolumeStatus = {
        state: 'completed',
        message
      };
      await store.mutate(draft => {
        draft.activityLog = [
          makeLog(
            'settings',
            `Music ${appliedTarget}% automatic action completed`,
            message,
            store.now(),
            {
              eventId: queued.eventId,
              automaticReceiverStatus: 'completed'
            }
          ),
          ...(draft.activityLog || [])
        ];
        return draft;
      }, 'Automatic music-volume action recorded').catch(() => {});
      setFeedback(message, true);
      return { ...queued, ...completed, musicPercent: appliedTarget };
    } catch (error) {
      emailWakeVolumeStatus = {
        state: 'failed',
        message: error.message || String(error)
      };
      throw error;
    }
  }
  if (receiverOperatingMode() !== 'pushcut') {
    throw new Error('Apply Music Now is available only while Pushcut Receiver mode is selected.');
  }
  if (!pushcutMusicVolumeReady()) {
    throw new Error('The Pushcut music-volume Shortcut is not ready.');
  }
  const requestedTarget = clamp(percent, 0, 100, 30);
  pushcutVolumeStatus = {
    state: 'working',
    message: `Waiting for the Receiver music Shortcut to apply ${requestedTarget}%...`
  };
  renderWhenIdle(true);
  try {
    const result = await applyPushcutMusicVolume({ musicPercent: requestedTarget });
    const appliedTarget = clamp(result.musicPercent, 0, 100, requestedTarget);
    const message = result.completed
      ? `Receiver music Shortcut completed at ${appliedTarget}%. Physical output was not measured.`
      : `Pushcut accepted the canonical ${appliedTarget}% music target, but completion was not confirmed.`;
    pushcutVolumeStatus = {
      state: result.completed ? 'completed' : 'accepted',
      message
    };
    await store.mutate(draft => {
      draft.activityLog = [
        makeLog(
          'settings',
          result.completed ? `Music ${appliedTarget}% Shortcut completed` : `Music ${appliedTarget}% Shortcut accepted`,
          `${message} Receiver must remain on Ready For Requests.`
        ),
        ...(draft.activityLog || [])
      ];
      return draft;
    }, 'Pushcut music-volume action recorded').catch(() => {});
    setFeedback(message, result.completed);
    return result;
  } catch (error) {
    pushcutVolumeStatus = {
      state: 'failed',
      message: error.message || String(error)
    };
    throw error;
  }
}

async function playScheduleItem(id, scheduleId = activeSavedSchedule().id) {
  const schedule = (store.state.schedules || []).find(entry => entry.id === scheduleId) || activeSavedSchedule();
  const item = (schedule.items || []).find(entry => entry.id === id);
  if (!item) return;
  const kind = scheduleItemKind(item);
  if (kind !== 'announcement') {
    requireOnlineBrowserReceiver('Scheduled music playback');
  }
  if (kind === 'announcement') {
    const rawText = resolveScheduleAnnouncementText(item, store.state.announcements);
    if (!rawText) throw new Error('Add announcement text or choose a saved announcement before playing this item.');
    const announcementId = item.action?.announcementId || item.announcementId || '';
    const savedAnnouncement = store.state.announcements.find(entry => entry.id === announcementId);
    const text = item.action?.announcementSource === 'inline'
      ? rawText
      : safetyAnnouncementText(announcementId, rawText, store.state.config);
    await sendLiveAnnouncement({
      text,
      label: item.label,
      volumePercent: effectiveScheduleItemVolume(item, store.state.config),
      sourceId: item.action?.sourceId || savedAnnouncement?.sourceId || 'natural-voice'
    });
  } else if (kind === 'stop') {
    await runtime.sendCommand('stop-music', {
      label: item.label || 'Quiet hours',
      scheduledItemId: item.id
    }, `Quiet-hours schedule item sent: ${item.label}.`);
  } else if (kind === 'apple') {
    await runtime.sendCommand('play-apple', {
      url: item.action?.url || item.url || store.state.config.appleUrl,
      label: item.label,
      volumePercent: effectiveScheduleItemVolume(item, store.state.config),
      volumeMode: item.volume?.mode,
      scheduledItemId: item.id
    }, `Apple Music schedule item sent: ${item.label}.`);
  } else if (kind === 'spotify') {
    await runtime.sendCommand('play-spotify', {
      url: item.action?.url || item.url || store.state.config.spotifyUrl,
      label: item.label,
      volumePercent: effectiveScheduleItemVolume(item, store.state.config),
      volumeMode: item.volume?.mode,
      scheduledItemId: item.id
    }, `Spotify schedule item sent: ${item.label}.`);
  } else {
    await runtime.sendCommand('play-controlled', {
      url: item.action?.url || item.url || store.state.config.musicUrl,
      label: item.label,
      volumePercent: effectiveScheduleItemVolume(item, store.state.config),
      volumeMode: item.volume?.mode,
      scheduledItemId: item.id
    }, `Music schedule item sent: ${item.label}.`);
  }
}

function updateScheduleFormVisibility(form) {
  if (!form) return;
  const kind = form.querySelector('[data-schedule-kind]')?.value || form.dataset.kind || 'announcement';
  const stopItem = kind === 'stop';
  const announcementSource = form.querySelector('[data-announcement-source]')?.value || form.dataset.announcementSource || 'saved';
  const volumeMode = form.querySelector('[data-volume-mode]')?.value || form.dataset.volumeMode || 'global';
  const iphoneAppleVolume =
    ['apple', 'spotify'].includes(kind)
    && activeReceiverIsIOS()
    && !automaticAnnouncementsEnabled();
  const fixedVolume = kind === 'announcement' || stopItem || iphoneAppleVolume;
  const advanceSelect = form.querySelector('[data-advance-mode]');
  const trackEndOption = advanceSelect?.querySelector('option[value="track-end"]');
  if (trackEndOption) trackEndOption.disabled = ['apple', 'spotify'].includes(kind);
  if (['apple', 'spotify'].includes(kind) && advanceSelect?.value === 'track-end') advanceSelect.value = 'manual';
  const advanceMode = advanceSelect?.value || form.dataset.advanceMode || 'manual';
  form.dataset.kind = kind;
  form.dataset.announcementSource = announcementSource;
  form.dataset.volumeMode = volumeMode;
  form.dataset.advanceMode = advanceMode;
  const musicUrl = form.querySelector('input[name="url"]');
  if (musicUrl) musicUrl.required = kind !== 'announcement' && !stopItem;
  for (const field of form.querySelectorAll('[data-show-schedule-kind]')) {
    const expected = field.dataset.showScheduleKind;
    field.hidden = expected === 'announcement'
      ? kind !== 'announcement'
      : expected === 'stop'
        ? !stopItem
        : kind === 'announcement' || stopItem;
  }
  for (const field of form.querySelectorAll('[data-show-announcement-source]')) {
    field.hidden = field.dataset.showAnnouncementSource !== announcementSource;
  }
  for (const field of form.querySelectorAll('[data-show-volume-mode]')) {
    field.hidden = fixedVolume || field.dataset.showVolumeMode !== volumeMode;
  }
  const standardVolumeFields = form.querySelector('[data-standard-volume-fields]');
  if (standardVolumeFields) standardVolumeFields.hidden = fixedVolume;
  const iphoneVolumeNote = form.querySelector('[data-apple-ios-volume-note]');
  if (iphoneVolumeNote) iphoneVolumeNote.hidden = !iphoneAppleVolume;
  for (const control of form.querySelectorAll('[data-standard-volume-fields] select, [data-standard-volume-fields] input')) {
    control.disabled = fixedVolume;
  }
  for (const field of form.querySelectorAll('[data-show-advance-mode]')) {
    field.hidden = field.dataset.showAdvanceMode !== advanceMode;
  }
}

function clearScheduleDragState() {
  draggedScheduleItemId = '';
  draggedScheduleTargetId = '';
  root.querySelectorAll('.scheduleItemShell.dragging, .scheduleItemShell.dragTarget').forEach(item => item.classList.remove('dragging', 'dragTarget'));
  renderWhenIdle();
}

function autoScrollScheduleDrag(clientY) {
  const edge = 72;
  if (clientY < edge) window.scrollBy({ top: -24, behavior: 'auto' });
  else if (clientY > window.innerHeight - edge) window.scrollBy({ top: 24, behavior: 'auto' });
}

function commitScheduleReorder(itemId, targetId) {
  if (!itemId || !targetId || itemId === targetId || busy || dirtyScheduleForm()) {
    if (dirtyScheduleForm()) setFeedback('Save the open schedule changes before reordering items.', false);
    clearScheduleDragState();
    return;
  }
  const scheduleId = activeSavedSchedule().id;
  const targetIndex = activeSavedSchedule().items?.findIndex(item => item.id === targetId) ?? -1;
  clearScheduleDragState();
  if (targetIndex < 0) return;
  runAction('Reordering schedule item', () => store.mutate(draft => {
    const schedule = (draft.schedules || []).find(entry => entry.id === scheduleId);
    if (!schedule) throw new Error('The selected schedule no longer exists.');
    schedule.items = reorderScheduleItems(schedule.items, itemId, targetIndex + 1);
    resetScheduleSequence(draft, scheduleId);
    return draft;
  }, 'Schedule item reordered')).catch(error => setFeedback(error.message || String(error), false));
}

async function copySpotifySetupValue(value, label) {
  if (!navigator.clipboard?.writeText) {
    throw new Error(`Copy is unavailable in this browser. Press and hold the ${label} shown in Settings to copy it.`);
  }
  await navigator.clipboard.writeText(value);
  setFeedback(`${label} copied exactly.`, true);
  return value;
}

root.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'stop-calibration') {
    runtime.stopCalibration?.();
    setFeedback('Sound check stopped. The temporary tone is off.', true);
    renderWhenIdle(true);
    return;
  }
  if (SCHEDULE_STRUCTURAL_ACTIONS.has(action) && dirtyScheduleForm()) {
    setFeedback('Save the open schedule changes before changing its structure or live status.', false);
    return;
  }
  if (
    (action === 'sync-pushcut-schedule'
      || action === 'sync-email-wake-schedule')
    && dirtyScheduleForm()
  ) {
    setFeedback('Save the open schedule changes before syncing timed announcements.', false);
    return;
  }
  if (busy) {
    setFeedback('Finish the current action before opening another page.', false);
    return;
  }
  const execute = async () => {
    if (action === 'copy-spotify-client-id') {
      return await copySpotifySetupValue(SPOTIFY_CLIENT_ID, 'Spotify Client ID');
    }
    if (action === 'copy-spotify-redirect-uri') {
      return await copySpotifySetupValue(SPOTIFY_REDIRECT_URI, 'Spotify Redirect URI');
    }
    if (action === 'copy-email-wake-sender') {
      return await copySpotifySetupValue(
        emailWakeStatus.wakeSender,
        'Email automation Sender'
      );
    }
    if (action === 'copy-email-wake-subject') {
      return await copySpotifySetupValue(
        emailWakeStatus.wakeSubject,
        'Email automation Subject'
      );
    }
    if (action === 'choose-role') return await setRole(button.dataset.role);
    if (action === 'set-role') return await runAction('Changing device role', () => setRole(button.dataset.role));
    if (action === 'request-role-change') {
      roleChangePending = true;
      setFeedback('Confirm whether to stop this live receiver.', false);
      return renderWhenIdle(true);
    }
    if (action === 'cancel-role-change') {
      roleChangePending = false;
      setFeedback('Speaker Receiver remains live.', true);
      return renderWhenIdle(true);
    }
    if (action === 'confirm-tab') return selectTab(button.dataset.tab, { discardDirty: true });
    if (action === 'cancel-tab') {
      pendingTab = '';
      setFeedback('Unsaved edits are still here.', true);
      return renderWhenIdle(true);
    }
    if (action === 'tab') {
      return selectTab(button.dataset.tab);
    }
    if (action === 'now-back') {
      return selectTab(button.dataset.tab || 'control');
    }
    if (action === 'create-email-wake-pairing') {
      return await runAction('Creating Receiver pairing code', async () => {
        const result = await createEmailWakePairingCode();
        emailWakePairing = {
          code: String(result.pairingCode || result.code || ''),
          expiresAt: Number(result.expiresAt || 0)
        };
        if (!emailWakePairing.code) {
          throw new Error('The pairing service did not return a one-time code.');
        }
        setFeedback(
          `Pairing code ${emailWakePairing.code} is ready for 10 minutes. Run ${EMAIL_WAKE_X_SHORTCUT_NAME} once on this Receiver and enter it.`,
          true
        );
        return result;
      });
    }
    if (action === 'check-email-wake-pairing') {
      return await runAction('Checking Receiver pairing', async () => {
        await refreshEmailWakeStatus();
        if (emailWakeOperational()) {
          emailWakePairing = { code: '', expiresAt: 0 };
          setFeedback(
            'Receiver pairing confirmed. Create the Email automation exactly as shown, then tap Turn On Automatic Receiver.',
            true
          );
          return true;
        }
        if (emailWakeStatus.receiverPaired) {
          throw new Error(
            emailWakeStatus.note
            || 'Pairing succeeded, but Automatic Receiver server setup still needs attention.'
          );
        }
        throw new Error(
          'Pairing is not confirmed yet. Run the installed Shortcut, enter the current six-digit code, then tap Check Pairing again.'
        );
      });
    }
    if (action === 'enable-automatic-announcements') {
      return await runAction('Testing and turning on Automatic Receiver', async () => {
        await refreshEmailWakeStatus();
        if (!emailWakeOperational()) {
          throw new Error(
            'The Receiver has not finished pairing. Run the installed Shortcut once with a fresh pairing code, then retry.'
          );
        }
        await selectSharedReceiverMode('browser');
        const verifiedPairingAt = Number(emailWakeStatus.pairedAt || 0);
        if (!Number.isSafeInteger(verifiedPairingAt) || verifiedPairingAt <= 0) {
          throw new Error(
            'The Receiver pairing timestamp is missing. Create a fresh pairing code, run the installed Shortcut, then retry.'
          );
        }
        await dispatchAutomaticAnnouncement({
          text: 'Poolside Pulse automatic receiver test. The music should be silent now, this announcement should be loud and clear, and the music should return quietly after I finish.',
          label: 'Required Automatic Receiver Test'
        });
        await selectAnnouncementTransport('email-wake', {
          verifiedPairingAt
        });
        setFeedback(
          `Automatic Receiver passed its signed device test and is on. Start Browser Receiver here for music, then use any Remote for announcements.`,
          true
        );
        return true;
      });
    }
    if (action === 'disable-automatic-announcements') {
      return await runAction('Turning off Automatic Receiver', async () => {
        await selectAnnouncementTransport('browser');
        setFeedback(
          'Automatic announcements are off. Browser Receiver will handle announcements while it stays visible.',
          true
        );
        return true;
      });
    }
    if (action === 'email-wake-test') {
      return await runAction('Running Automatic Receiver test', async () => {
        const result = await dispatchAutomaticAnnouncement({
          text: 'Poolside Pulse automatic receiver test. The music should be silent now, this announcement should be loud and clear, and the music should return quietly after I finish.',
          label: 'Automatic Receiver Test'
        });
        await refreshEmailWakeStatus();
        return result;
      });
    }
    if (action === 'start-receiver') {
      return await runAction('Starting receiver', async () => {
        const lease = await runtime.start({ takeover: button.dataset.takeover === 'true', takeoverTarget });
        takeoverTarget = null;
        try {
          await selectSharedReceiverMode('browser');
        } catch (error) {
          await runtime.stop().catch(() => {});
          throw new Error(`Browser Receiver stayed silent because its shared mode could not be saved: ${error.message || String(error)}`);
        }
        if (!automaticAnnouncementsEnabled() && pushcutAnnouncementReady()) {
          try {
            await syncCurrentPushcutSchedule({
              pushcutEnabledOverride: false
            });
          } catch (error) {
            await runtime.stop().catch(() => {});
            await selectSharedReceiverMode('pushcut').catch(() => {});
            let recoveryError = '';
            try {
              await syncCurrentPushcutSchedule({
                pushcutEnabledOverride: true
              });
            } catch (caught) {
              recoveryError = caught.message || String(caught);
            }
            throw new Error(`Browser Receiver was stopped because pending Pushcut schedule copies could not be cancelled safely: ${error.message || String(error)}${recoveryError ? ` Pushcut re-arm also failed: ${recoveryError}` : ' Pushcut timed announcements were re-armed.'}`);
          }
        }
        if (automaticAnnouncementsEnabled()) {
          try {
            await applyReceiverMusicTargetNow(audibleMusicTarget(store.state));
          } catch (error) {
            await runtime.stop().catch(() => {});
            throw new Error(
              `Browser Receiver was stopped because the speaker iPhone did not confirm its music target: ${
                error.message || String(error)
              }`
            );
          }
        }
        return lease;
      });
    }
    if (action === 'stop-receiver') {
      return await runAction('Stopping receiver', async () => {
        await runtime.stop();
        if (automaticAnnouncementsEnabled()) {
          await selectSharedReceiverMode('browser');
          setFeedback(
            'Browser music stopped. Automatic announcements remain armed in the background.',
            true
          );
          return true;
        }
        await selectSharedReceiverMode('pushcut');
        if (pushcutAnnouncementReady()) {
          await syncCurrentPushcutSchedule({
            pushcutEnabledOverride: true
          });
        }
        return true;
      });
    }
    if (action === 'prepare-pushcut-mode') {
      return await runAction('Preparing Pushcut mode', async () => {
        if (automaticAnnouncementsEnabled()) {
          throw new Error('Automatic Receiver is active. Pushcut is retired from normal Resort Media Hub operation.');
        }
        if (runtime.active) await runtime.stop();
        await selectSharedReceiverMode('pushcut');
        await syncCurrentPushcutSchedule({
          pushcutEnabledOverride: true
        });
        setFeedback('Pushcut timed announcements are prepared. You can now open Pushcut Server.', true);
        return true;
      });
    }
    if (action === 'enable-managed-volume') {
      const target = clamp(musicLevelDraft === null ? store.state.config.musicLevel : musicLevelDraft, 0, 100, 30);
      return await runAction('Starting Manager Volume', () => saveMusicLevel(target, { forceManaged: true, startManagedSource: true }));
    }
    if (action === 'provider') return await runAction('Changing music source', () => setProvider(button.dataset.provider));
    if (action === 'transport') return await runAction('Sending music command', () => sendTransport(button.dataset.command));
    if (action === 'apply-pushcut-music-target') {
      const target = clamp(button.dataset.musicPercent, 0, 100, audibleMusicTarget(store.state));
      return await runAction(`Applying Music ${target}% on Receiver`, () => applyReceiverMusicTargetNow(target));
    }
    if (action === 'sync-pushcut-schedule') {
      return await runAction('Syncing timed Pushcut announcements', () => syncCurrentPushcutSchedule({
        manual: true
      }));
    }
    if (action === 'sync-email-wake-schedule') {
      return await runAction(
        'Syncing automatic timed announcements',
        () => syncCurrentEmailWakeSchedule({ manual: true })
      );
    }
    if (action === 'delete-announcement-source') {
      const sourceId = String(button.dataset.id || '');
      if (!sourceId || sourceId === 'natural-voice') throw new Error('Natural Voice is the required default and cannot be deleted.');
      return await runAction('Deleting announcement clip', () => store.mutate(draft => {
        const source = (draft.announcementSources || []).find(item => item.id === sourceId);
        if (!source) throw new Error('That announcement clip no longer exists.');
        draft.announcementSources = (draft.announcementSources || []).filter(item => item.id !== sourceId);
        draft.announcements = (draft.announcements || []).map(item => item.sourceId === sourceId
          ? { ...item, sourceId: 'natural-voice' }
          : item);
        draft.schedules = (draft.schedules || []).map(schedule => ({
          ...schedule,
          items: (schedule.items || []).map(item => item.action?.sourceId === sourceId
            ? { ...item, action: { ...item.action, sourceId: 'natural-voice' } }
            : item)
        }));
        draft.activityLog = [makeLog('settings', 'Announcement clip deleted', `${source.label}; affected messages now use Natural Voice.`), ...(draft.activityLog || [])];
        return draft;
      }, 'Announcement clip deleted'));
    }
    if (action === 'pushcut-test') {
      return await runAction('Sending Pushcut receiver test', async () => {
        const result = await sendLiveAnnouncement({
          text: 'Poolside Pulse receiver test. The announcement is louder than the music, and the music should now return quietly.',
          label: 'Pushcut Receiver Test',
          volumePercent: audibleVoiceTarget(store.state),
          sourceId: 'natural-voice',
          forcePushcut: true
        });
        await refreshPushcutStatus();
        return result;
      });
    }
    if (action === 'saved-announcement' || action === 'safety-announcement') {
      const item = store.state.announcements.find(entry => entry.id === button.dataset.id);
      if (!item) throw new Error('Saved announcement was not found.');
      const text = safetyAnnouncementText(item.id, item.text, store.state.config);
      return await runAction('Sending announcement', () => sendLiveAnnouncement({
        text,
        label: item.label,
        safety: action === 'safety-announcement',
        volumePercent: audibleVoiceTarget(store.state),
        sourceId: item.sourceId || 'natural-voice'
      }));
    }
    if (action === 'weather-check') return await runAction('Checking weather now', () => runImmediateWeatherCheck());
    if (action === 'calibration') {
      return await runAction(`Running ${store.state.config.musicLevel}/${audibleVoiceTarget()} sound check`, () => runtime.runCalibration());
    }
    if (action === 'connect-apple') {
      if (role !== 'receiver' || !runtime.isOwner()) throw new Error('Start this device as the live Speaker Receiver before connecting Apple Music.');
      if (apple.nativeEnabled?.()) {
        return await runAction('Connecting Music.app receiver', async () => {
          try {
            await apple.preparePlayer();
            await apple.activateFromUserGesture();
            await apple.connectFromUserGesture();
          } finally {
            const policy = runtime.currentPolicy('apple');
            await runtime.updateReceiverDetail(policy.detail, policy.id).catch(() => {});
          }
        });
      }
      if (!apple.playerPrepared) {
        return await runAction('Restoring Apple Music session', async () => {
          const restored = await apple.restoreAuthorization();
          if (!restored) throw new Error('Apple Music authorization could not be restored. Authorize Apple Music again.');
          setFeedback('Apple Music session restored. Tap Connect Apple Music Receiver once more to activate audio.', true);
        });
      }
      const activation = apple.activateFromUserGesture?.();
      return await runAction('Connecting Apple Music receiver', async () => {
        try {
          await activation;
          await apple.connectFromUserGesture();
        } finally {
          const policy = runtime.currentPolicy('apple');
          await runtime.updateReceiverDetail(policy.detail, policy.id).catch(() => {});
        }
      });
    }
    if (action === 'apple-prepare') {
      if (role !== 'receiver') throw new Error('Prepare Apple Music only on the Speaker Receiver.');
      return await runAction('Preparing Apple Music', () => apple.prepareAuthorization());
    }
    if (action === 'apple-login') {
      if (role !== 'receiver') throw new Error('Authorize Apple Music only on the Speaker Receiver.');
      const authorization = apple.authorizeFromUserGesture();
      return await runAction('Authorizing Apple Music', () => authorization);
    }
    if (action === 'apple-logout') {
      return await runAction(apple.nativeEnabled?.() ? 'Disconnecting Music.app' : 'Removing Apple Music login', async () => {
        const appleCouldBeAudible = apple.ready || runtime.physicalProvider === 'apple' ||
          (store.state.playback.provider === 'apple' && store.state.playback.intent === 'playing');
        if (runtime.isOwner() && appleCouldBeAudible) await runtime.pauseMusic();
        else if (apple.ready) await apple.pauseForAnnouncement();
        await apple.clearLogin();
        if (runtime.isOwner()) {
          const policy = runtime.currentPolicy('apple');
          await runtime.updateReceiverDetail(policy.detail, policy.id).catch(() => {});
        }
      });
    }
    if (action === 'connect-spotify') {
      if (role !== 'receiver' || !runtime.isOwner()) throw new Error('Start this device as the live Speaker Receiver before connecting Spotify.');
      const activation = spotify.activateFromUserGesture?.();
      return await runAction('Connecting Spotify receiver', async () => {
        try {
          await activation;
          await spotify.connectFromUserGesture();
          await spotify.refreshCapabilities({ strict: true });
        } finally {
          const policy = runtime.currentPolicy('spotify');
          await runtime.updateReceiverDetail(policy.detail, policy.id).catch(() => {});
        }
      });
    }
    if (action === 'verify-spotify-access') {
      return await runAction('Checking Spotify account access', async () => {
        try {
          await spotify.verifyAccess({ force: true });
          await spotify.preparePlayer();
        } finally {
          if (runtime.isOwner()) {
            const policy = runtime.currentPolicy('spotify');
            await runtime.updateReceiverDetail(policy.detail, policy.id).catch(() => {});
          }
        }
      });
    }
    if (action === 'prepare-spotify') {
      return await runAction('Preparing Spotify receiver', async () => {
        try { return await spotify.preparePlayer(); }
        finally {
          if (runtime.isOwner()) {
            const policy = runtime.currentPolicy('spotify');
            await runtime.updateReceiverDetail(policy.detail, policy.id).catch(() => {});
          }
        }
      });
    }
    if (action === 'spotify-login') {
      if (role !== 'receiver') throw new Error('Log in to Spotify only on the Speaker Receiver.');
      return await spotify.beginLogin('/#receiver');
    }
    if (action === 'spotify-logout') {
      return await runAction('Removing Spotify login', async () => {
        const spotifyCouldBeAudible = spotify.ready || runtime.physicalProvider === 'spotify' ||
          (store.state.playback.provider === 'spotify' && store.state.playback.intent === 'playing');
        if (runtime.isOwner() && spotifyCouldBeAudible) await runtime.pauseMusic();
        else if (spotify.ready) await spotify.pauseForAnnouncement();
        spotify.clearLogin();
        if (runtime.isOwner()) {
          const policy = runtime.currentPolicy('spotify');
          await runtime.updateReceiverDetail(policy.detail, policy.id).catch(() => {});
        }
      });
    }
    if (action === 'test-spotify-source') {
      requireOnlineBrowserReceiver('Spotify browser playback');
      return await runAction('Testing Spotify playback', () => runtime.sendCommand('play-spotify', {
          url: DEFAULT_SPOTIFY_PLAYLIST,
          label: 'Spotify public test track',
          persistSource: false
        }, 'Spotify public-track test sent to receiver.'));
    }
    if (action === 'new-schedule-set') {
      const id = makeId('saved-schedule');
      return await runAction('Creating saved schedule', async () => {
        await store.mutate(draft => {
        draft.schedules = Array.isArray(draft.schedules) ? draft.schedules : [];
        draft.schedules.push({ id, name: `New Schedule ${draft.schedules.length + 1}`, mode: 'time', enabled: false, items: [] });
        return draft;
        }, 'Saved schedule created');
        selectedScheduleId = id;
        localStorage.setItem(SCHEDULE_SELECTION_KEY, id);
      });
    }
    if (action === 'duplicate-schedule-set') {
      const current = activeSavedSchedule();
      const id = makeId('saved-schedule');
      return await runAction('Duplicating saved schedule', async () => {
        await store.mutate(draft => {
        const source = (draft.schedules || []).find(item => item.id === current.id);
        if (!source) throw new Error('That saved schedule no longer exists.');
        const copy = structuredClone(source);
        copy.id = id;
        copy.name = `${source.name} Copy`.slice(0, 80);
        copy.enabled = false;
        copy.items = (copy.items || []).map((item, index) => ({ ...item, id: makeId('schedule-item'), position: { ...(item.position || {}), order: index + 1 } }));
        draft.schedules.push(copy);
        return draft;
        }, 'Saved schedule duplicated');
        selectedScheduleId = id;
        localStorage.setItem(SCHEDULE_SELECTION_KEY, id);
      });
    }
    if (action === 'activate-schedule-set') {
      const id = activeSavedSchedule().id;
      return await runAction('Making schedule live', () => store.mutate(draft => {
        const schedule = (draft.schedules || []).find(item => item.id === id);
        if (!schedule) throw new Error('That saved schedule no longer exists.');
        const previousScheduleId = String(draft.activeScheduleId || '');
        if (previousScheduleId && previousScheduleId !== id) resetScheduleSequence(draft, previousScheduleId);
        schedule.enabled = true;
        draft.activeScheduleId = id;
        resetScheduleSequence(draft, id);
        draft.activityLog = [makeLog('schedule', 'Live schedule changed', `${schedule.name} · ${schedule.mode === 'order' ? 'Order' : 'Time'} mode`), ...(draft.activityLog || [])];
        return draft;
      }, 'Live schedule changed'));
    }
    if (action === 'cancel-schedule-today' || action === 'restore-schedule-today') {
      const scheduleId = String(button.dataset.scheduleId || activeSavedSchedule().id || '');
      const restore = action === 'restore-schedule-today';
      const scheduleSnapshot = (store.state.schedules || []).find(item => item.id === scheduleId);
      const fallbackTarget = scheduleCancellationTarget(scheduleSnapshot, store.now());
      const requestedDateKey = String(button.dataset.dateKey || '');
      const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(requestedDateKey)
        ? requestedDateKey
        : fallbackTarget.dateKey;
      return await runAction(restore ? 'Restoring the selected party date' : 'Cancelling the selected party date', async () => {
        await store.mutate(draft => {
          const schedule = (draft.schedules || []).find(item => item.id === scheduleId);
          if (!schedule) throw new Error('That saved schedule no longer exists.');
          if (schedule.mode !== 'time' || schedule.cancellable !== true) {
            throw new Error('Only a cancellable Time overlay can be cancelled for one day.');
          }
          const cancelled = new Set(Array.isArray(schedule.cancelledDates) ? schedule.cancelledDates : []);
          if (restore) cancelled.delete(dateKey);
          else cancelled.add(dateKey);
          schedule.cancelledDates = [...cancelled].sort().slice(-120);
          draft.activityLog = [makeLog(
            'schedule',
            restore ? 'Schedule date restored' : 'Schedule date cancelled',
            `${schedule.name} · ${dateKey}`
          ), ...(draft.activityLog || [])];
          return draft;
        }, restore ? 'Selected schedule date restored' : 'Selected schedule date cancelled');
        if (automaticAnnouncementsEnabled()) {
          await syncCurrentEmailWakeSchedule({ retryStale: true });
        }
        if (
          !restore
          && dateKey === scheduleDateKey(store.now())
          && receiverOnline(store.state.receiver, store.now())
          && receiverOperatingMode() === 'browser'
        ) {
          await runtime.sendCommand('play-apple', {
            url: RESORT_DAILY_APPLE_PLAYLIST,
            label: 'Daily Pool Music',
            volumePercent: 30,
            volumeMode: 'custom'
          }, 'Party date cancelled. Daily Apple Music at 30% sent to the Receiver.');
        }
        return true;
      });
    }
    if (action === 'skip-schedule-item-today' || action === 'restore-schedule-item-today') {
      const scheduleId = String(button.dataset.scheduleId || activeSavedSchedule().id || '');
      const itemId = String(button.dataset.id || '');
      const restore = action === 'restore-schedule-item-today';
      const requestedDateKey = String(button.dataset.dateKey || '');
      const scheduleSnapshot = (store.state.schedules || []).find(item => item.id === scheduleId);
      const itemSnapshot = scheduleSnapshot?.items?.find(item => item.id === itemId);
      const fallbackTarget = scheduleCancellationTarget({ items: itemSnapshot ? [itemSnapshot] : [] }, store.now());
      const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(requestedDateKey)
        ? requestedDateKey
        : fallbackTarget.dateKey;
      return await runAction(restore ? 'Restoring today’s scheduled item' : 'Skipping today’s scheduled item', () => store.mutate(draft => {
        const schedule = (draft.schedules || []).find(item => item.id === scheduleId);
        const item = schedule?.items?.find(candidate => candidate.id === itemId);
        if (!schedule || !item) throw new Error('That schedule item no longer exists.');
        if (schedule.mode !== 'time') throw new Error('Skip Today applies only to Time schedule items.');
        if (item.protected === true) {
          throw new Error('This protected opening or closing item cannot be skipped from the quick control. Edit it deliberately if operations require a change.');
        }
        const skipped = new Set(Array.isArray(item.skippedDates) ? item.skippedDates : []);
        if (restore) skipped.delete(dateKey);
        else skipped.add(dateKey);
        item.skippedDates = [...skipped].sort().slice(-120);
        draft.activityLog = [makeLog(
          'schedule',
          restore ? 'Scheduled item restored for today' : 'Scheduled item skipped for today',
          `${schedule.name}: ${item.label} · ${dateKey}`
        ), ...(draft.activityLog || [])];
        return draft;
      }, restore ? 'Today’s item restored' : 'Today’s item skipped'));
    }
    if (action === 'delete-schedule-set') {
      scheduleDeletePending = activeSavedSchedule().id;
      setFeedback('Choose Confirm Delete to permanently remove this saved schedule.', false);
      return renderWhenIdle(true);
    }
    if (action === 'cancel-delete-schedule-set') {
      scheduleDeletePending = '';
      setFeedback('Schedule deletion cancelled.', true);
      return renderWhenIdle(true);
    }
    if (action === 'confirm-delete-schedule-set') {
      const id = activeSavedSchedule().id;
      return await runAction('Deleting saved schedule', async () => {
        await store.mutate(draft => {
        if ((draft.schedules || []).length <= 1) throw new Error('At least one saved schedule must remain.');
        resetScheduleSequence(draft, id);
        draft.schedules = draft.schedules.filter(schedule => schedule.id !== id);
        if (draft.activeScheduleId === id) draft.activeScheduleId = draft.schedules[0]?.id || '';
        scheduleDeletePending = '';
        return draft;
        }, 'Saved schedule deleted');
        selectedScheduleId = store.state.activeScheduleId || store.state.schedules?.[0]?.id || '';
        if (selectedScheduleId) localStorage.setItem(SCHEDULE_SELECTION_KEY, selectedScheduleId);
      });
    }
    if (action === 'add-schedule-item') {
      const scheduleId = activeSavedSchedule().id;
      const itemId = makeId('schedule-item');
      pendingOpenScheduleItemId = itemId;
      try {
        return await runAction('Adding schedule item', () => store.mutate(draft => {
          const schedule = (draft.schedules || []).find(entry => entry.id === scheduleId);
          if (!schedule) throw new Error('The selected schedule no longer exists.');
          if ((schedule.items || []).length >= 100) throw new Error('A schedule can contain up to 100 items.');
          const nextOrder = (schedule.items || []).length + 1;
          schedule.items ||= [];
          schedule.items.push({
            id: itemId,
            label: 'New Schedule Item',
            enabled: false,
            days: [0, 1, 2, 3, 4, 5, 6],
            position: { time: '12:00', order: nextOrder },
            action: { kind: 'announcement', announcementSource: 'inline', announcementId: '', text: '', url: '' },
            volume: { mode: 'global', percent: VOICE_LEVEL_PERCENT },
            advance: { mode: 'complete', durationSeconds: 300 }
          });
          resetScheduleSequence(draft, scheduleId);
          return draft;
        }, 'Schedule item added'));
      } catch (error) {
        if (pendingOpenScheduleItemId === itemId) pendingOpenScheduleItemId = '';
        throw error;
      }
    }
    if (action === 'delete-schedule-item') {
      const id = String(button.dataset.id || '');
      const scheduleId = activeSavedSchedule().id;
      return await runAction('Deleting schedule item', () => store.mutate(draft => {
        const schedule = (draft.schedules || []).find(entry => entry.id === scheduleId);
        const index = schedule?.items?.findIndex(item => item.id === id) ?? -1;
        if (index < 0) throw new Error('Schedule item no longer exists.');
        schedule.items.splice(index, 1);
        schedule.items = reorderScheduleItems(schedule.items, '', 1);
        resetScheduleSequence(draft, scheduleId);
        return draft;
      }, 'Schedule item deleted'));
    }
    if (action === 'duplicate-schedule-item') {
      const id = String(button.dataset.id || '');
      const scheduleId = activeSavedSchedule().id;
      return await runAction('Duplicating schedule item', () => store.mutate(draft => {
        const schedule = (draft.schedules || []).find(entry => entry.id === scheduleId);
        const index = schedule?.items?.findIndex(item => item.id === id) ?? -1;
        if (index < 0) throw new Error('Schedule item no longer exists.');
        if ((schedule.items || []).length >= 100) throw new Error('A schedule can contain up to 100 items.');
        const copy = structuredClone(schedule.items[index]);
        copy.id = makeId('schedule-item');
        copy.label = `${copy.label} Copy`.slice(0, 100);
        copy.enabled = false;
        schedule.items.splice(index + 1, 0, copy);
        schedule.items = reorderScheduleItems(schedule.items, copy.id, index + 2);
        resetScheduleSequence(draft, scheduleId);
        return draft;
      }, 'Schedule item duplicated'));
    }
    if (action === 'move-schedule-item') {
      const id = String(button.dataset.id || '');
      const direction = Number(button.dataset.direction || 0);
      const scheduleId = activeSavedSchedule().id;
      return await runAction('Reordering schedule item', () => store.mutate(draft => {
        const schedule = (draft.schedules || []).find(entry => entry.id === scheduleId);
        const index = schedule?.items?.findIndex(item => item.id === id) ?? -1;
        if (index < 0) throw new Error('Schedule item no longer exists.');
        schedule.items = reorderScheduleItems(schedule.items, id, clamp(index + 1 + direction, 1, schedule.items.length, index + 1));
        resetScheduleSequence(draft, scheduleId);
        return draft;
      }, 'Schedule item reordered'));
    }
    if (action === 'play-schedule') return await runAction('Playing scheduled item', () => playScheduleItem(String(button.dataset.id || '')));
    if (action === 'play-next-schedule') {
      const schedule = activeSavedSchedule();
      const enabled = [...(schedule.items || [])].filter(item => item.enabled !== false).sort((a, b) => Number(a.position?.order || 0) - Number(b.position?.order || 0));
      if (!enabled.length) throw new Error('Add and enable at least one item before using Play Next.');
      const run = normalizeSequenceRun(store.state.sequenceRuns?.[schedule.id]);
      return await runAction('Requesting the next Order item', () => runtime.sendCommand('order-next', {
        scheduleId: schedule.id,
        expectedOrder: run.order,
        expectedItemId: run.itemId,
        label: `Play next: ${schedule.name}`
      }, 'Play Next requested. The receiver will save the position only after the item succeeds.'));
    }
    if (action === 'reset-order-schedule') {
      const scheduleId = activeSavedSchedule().id;
      const run = normalizeSequenceRun(store.state.sequenceRuns?.[scheduleId]);
      return await runAction('Resetting order schedule', () => runtime.sendCommand('order-reset', {
        scheduleId,
        expectedOrder: run.order,
        expectedItemId: run.itemId,
        label: `Reset Order schedule: ${activeSavedSchedule().name}`
      }, 'Order reset requested. The receiver will invalidate any unfinished advance.'));
    }
    if (action === 'clear-activity') {
      return await runAction('Clearing activity view', () => store.mutate(draft => {
        draft.config.logClearedAt = store.now();
        return draft;
      }, 'Activity view cleared'));
    }
    if (action === 'logout') {
      if (runtime.active) await runtime.stop();
      await logoutSession();
      authenticated = false;
      store.stopPolling();
      renderWhenIdle(true);
    }
  };
  execute().catch(error => setFeedback(error.message || String(error), false));
});

root.addEventListener('dragstart', event => {
  const handle = event.target.closest?.('[data-drag-schedule-item]');
  if (!handle || busy || dirtyScheduleForm()) {
    if (dirtyScheduleForm()) setFeedback('Save the open schedule changes before reordering items.', false);
    event.preventDefault();
    return;
  }
  draggedScheduleItemId = String(handle.dataset.dragScheduleItem || '');
  draggedScheduleTargetId = draggedScheduleItemId;
  handle.closest('.scheduleItemShell')?.classList.add('dragging');
  event.dataTransfer?.setData('text/plain', draggedScheduleItemId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
});

root.addEventListener('dragover', event => {
  if (!draggedScheduleItemId) return;
  const target = event.target.closest?.('[data-drop-schedule-item]');
  if (!target) return;
  event.preventDefault();
  autoScrollScheduleDrag(event.clientY);
  draggedScheduleTargetId = String(target.dataset.dropScheduleItem || '');
  root.querySelectorAll('.scheduleItemShell.dragTarget').forEach(item => item.classList.remove('dragTarget'));
  if (draggedScheduleTargetId !== draggedScheduleItemId) target.classList.add('dragTarget');
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
});

root.addEventListener('drop', event => {
  if (!draggedScheduleItemId) return;
  event.preventDefault();
  const target = event.target.closest?.('[data-drop-schedule-item]');
  commitScheduleReorder(draggedScheduleItemId, String(target?.dataset.dropScheduleItem || draggedScheduleTargetId));
});

root.addEventListener('dragend', clearScheduleDragState);

root.addEventListener('pointerdown', event => {
  if (!beginScheduleControlInteraction(event.target) && scheduleControlInteractionActive()) {
    clearScheduleControlInteraction();
  }
  const handle = event.target.closest?.('[data-drag-schedule-item]');
  if (!handle || event.pointerType === 'mouse' || busy || dirtyScheduleForm()) return;
  draggedScheduleItemId = String(handle.dataset.dragScheduleItem || '');
  draggedScheduleTargetId = draggedScheduleItemId;
  handle.closest('.scheduleItemShell')?.classList.add('dragging');
  try { handle.setPointerCapture(event.pointerId); } catch {}
});

root.addEventListener('pointermove', event => {
  if (!draggedScheduleItemId || event.pointerType === 'mouse') return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-drop-schedule-item]');
  if (!target) return;
  event.preventDefault();
  autoScrollScheduleDrag(event.clientY);
  draggedScheduleTargetId = String(target.dataset.dropScheduleItem || '');
  root.querySelectorAll('.scheduleItemShell.dragTarget').forEach(item => item.classList.remove('dragTarget'));
  if (draggedScheduleTargetId !== draggedScheduleItemId) target.classList.add('dragTarget');
});

root.addEventListener('pointerup', event => {
  const musicSlider = event.target.closest?.('#musicLevel');
  if (musicSlider) flushMusicLevelSave(musicSlider.value);
  if (!draggedScheduleItemId || event.pointerType === 'mouse') return;
  commitScheduleReorder(draggedScheduleItemId, draggedScheduleTargetId);
});

root.addEventListener('pointercancel', clearScheduleDragState);

root.addEventListener('focusin', event => {
  beginScheduleControlInteraction(event.target);
});

root.addEventListener('focusout', () => {
  setTimeout(flushDeferredRenderIfIdle, 0);
});

root.addEventListener('touchend', event => {
  const musicSlider = event.target.closest?.('#musicLevel');
  if (musicSlider) flushMusicLevelSave(musicSlider.value);
}, { passive: true });

root.addEventListener('keydown', event => {
  const handle = event.target.closest?.('[data-drag-schedule-item]');
  if (!handle || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const schedule = activeSavedSchedule();
  const id = String(handle.dataset.dragScheduleItem || '');
  const index = schedule.items?.findIndex(item => item.id === id) ?? -1;
  if (index < 0) return;
  const target = schedule.items[clamp(index + (event.key === 'ArrowUp' ? -1 : 1), 0, schedule.items.length - 1, index)];
  if (target) commitScheduleReorder(id, target.id);
});

root.addEventListener('input', event => {
  const form = event.target.closest?.('form[data-form]');
  if (formIdentity(form) && !event.target.matches?.('[data-schedule-mode]')) {
    form.dataset.dirty = 'true';
  }
  const itemSlider = event.target.closest?.('.itemVolumeSlider');
  if (itemSlider) {
    const output = itemSlider.parentElement?.querySelector('output');
    if (output) {
      output.value = `${itemSlider.value}%`;
      output.textContent = `${itemSlider.value}%`;
    }
    return;
  }
  const slider = event.target.closest?.('#musicLevel');
  if (!slider) return;
  const target = clamp(slider.value, 0, 100, 30);
  musicLevelDraft = target;
  if (customPlaybackMusicTarget(store.state) === null) {
    audio.setMusicLevelPercent(
      controlledBrowserGainTarget(store.state, target),
      { report: false }
    );
    apple.setTargetVolumePercent(target);
    spotify.setTargetVolumePercent(target);
  }
  slider.style.setProperty('--level', target / 100);
  slider.setAttribute('aria-valuetext', `${target}% music; announcements ${audibleVoiceTarget()}%`);
  const output = root.querySelector('[data-music-level-output]');
  if (output) {
    output.value = `${target}%`;
    output.textContent = `${target}%`;
  }
  const managedButton = root.querySelector('[data-managed-volume-button]');
  if (managedButton) managedButton.textContent = `Start Manager Volume · ${target}%`;
  const managedDescription = root.querySelector('[data-managed-volume-description]');
  if (managedDescription) {
    const providerName = store.state.config.musicProvider === 'spotify' ? 'Spotify' : 'Apple Music';
    managedDescription.textContent = `iPhone cannot lower protected ${providerName} playback in a web page. This starts the saved Suno / Direct bed at ${target}%; ${providerName} stays authorized for later.`;
  }
  debounceMusicLevelSave(target);
});

root.addEventListener('change', event => {
  const form = event.target.closest?.('form[data-form]');
  const formWasDirty = form?.dataset?.dirty === 'true';
  if (formIdentity(form)) form.dataset.dirty = 'true';
  if (scheduleNativeControl(event.target)) {
    clearScheduleControlInteraction({ delayMs: 250 });
  }
  const schedulePicker = event.target.closest?.('#schedulePicker');
  if (schedulePicker) {
    if (busy) {
      setFeedback('Finish the current action before opening another schedule.', false);
      return renderWhenIdle(true);
    }
    if (dirtyScheduleForm()) {
      schedulePicker.value = activeSavedSchedule().id;
      setFeedback('Save the open schedule changes before switching schedules.', false);
      return;
    }
    const scheduleId = String(schedulePicker.value || '');
    if (!selectSavedSchedule(scheduleId)) setFeedback('That saved schedule no longer exists.', false);
    return;
  }
  const scheduleMode = event.target.closest?.('[data-schedule-mode]');
  if (scheduleMode) {
    const id = String(form?.dataset?.id || '');
    const existingSchedule = (store.state.schedules || []).find(item => item.id === id);
    const requestedMode = scheduleMode.value === 'order' ? 'order' : 'time';
    const dirtyItemDraft = root.querySelector(
      `form[data-form="schedule-item"][data-schedule-id="${CSS.escape(id)}"][data-dirty="true"]`
    );
    if (busy || dirtyItemDraft || formWasDirty) {
      scheduleMode.value = existingSchedule?.mode === 'order' ? 'order' : 'time';
      if (!formWasDirty && form) delete form.dataset.dirty;
      setFeedback(
        busy
          ? 'Finish the current action before changing Run by.'
          : dirtyItemDraft
            ? 'Save or discard the open item edit before changing Run by.'
            : 'Save the schedule name or enabled setting before changing Run by.',
        false
      );
      return;
    }
    if (!existingSchedule || existingSchedule.mode === requestedMode) {
      if (!formWasDirty && form) delete form.dataset.dirty;
      return;
    }
    const formKey = formIdentity(form);
    scheduleMode.blur();
    clearScheduleControlInteraction();
    runAction(`Switching schedule to ${requestedMode === 'time' ? 'Time' : 'Order'}`, () => store.mutate(draft => {
      const schedule = (draft.schedules || []).find(item => item.id === id);
      if (!schedule) throw new Error('Saved schedule no longer exists.');
      schedule.mode = requestedMode;
      resetScheduleSequence(draft, schedule.id);
      draft.activityLog = [
        makeLog('settings', 'Schedule run mode changed', `${schedule.name} · ${requestedMode === 'time' ? 'Time' : 'Order'} mode`),
        ...(draft.activityLog || [])
      ];
      return draft;
    }, 'Schedule run mode changed')).then(() => {
      if (!formWasDirty) clearDirtyForm(formKey);
      renderWhenIdle(true);
    }).catch(error => {
      setFeedback(error.message || String(error), false);
    });
    return;
  }
  if (event.target.matches?.('[data-schedule-kind], [data-announcement-source], [data-volume-mode], [data-advance-mode]')) {
    updateScheduleFormVisibility(form);
    return;
  }
  const slider = event.target.closest?.('#musicLevel');
  if (!slider) return;
  const target = clamp(slider.value, 0, 100, 30);
  flushMusicLevelSave(target);
});

root.addEventListener('submit', event => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (busy) {
    setFeedback('Finish the current action before submitting this form.', false);
    return;
  }
  const submittedFormKey = formIdentity(form);
  const data = new FormData(form);
  const submitIntent = event.submitter?.name === 'intent' ? String(event.submitter.value || '') : '';
  const kind = form.dataset.form;
  const execute = async () => {
    if (kind === 'login') {
      return await runAction('Opening Poolside Pulse', async () => {
        await loginSession(data.get('pin'));
        authenticated = true;
        await bootstrapAuthenticatedApp();
      });
    }
    if (kind === 'controlled-play') {
      const url = String(data.get('url') || '').trim();
      requireOnlineBrowserReceiver('Suno / Direct playback');
      return await runAction('Starting controlled music', async () => {
        await store.mutate(draft => {
          draft.config.musicProvider = 'controlled';
          draft.config.musicUrl = url;
          return draft;
        }, 'Controlled music source saved');
        const target = clamp(store.state.config.musicLevel, 0, 100, 30);
        await runtime.sendCommand('play-controlled', { url, label: 'Suno / Direct Audio', volumePercent: target, volumeMode: 'global' }, `Play at ${target}% sent to receiver.`);
      });
    }
    if (kind === 'apple-play') {
      const url = String(data.get('url') || '').trim();
      if (!isAppleMusicUrl(url)) throw new Error('Paste a valid Apple Music playlist, album, artist, or track URL.');
      requireOnlineBrowserReceiver('Apple Music browser playback');
      return await runAction('Starting Apple Music', async () => {
        await store.mutate(draft => {
          draft.config.musicProvider = 'apple';
          draft.config.appleUrl = url;
          return draft;
        }, 'Apple Music source saved');
        await runtime.sendCommand('play-apple', { url, label: 'Apple Music', volumePercent: store.state.config.musicLevel, volumeMode: 'global' }, 'Apple Music play sent to receiver.');
      });
    }
    if (kind === 'spotify-play') {
      const url = String(data.get('url') || '').trim();
      if (!isSpotifyUrl(url)) throw new Error('Paste a valid Spotify playlist, album, artist, or track URL.');
      requireOnlineBrowserReceiver('Spotify browser playback');
      return await runAction('Starting Spotify', async () => {
        await store.mutate(draft => {
          draft.config.musicProvider = 'spotify';
          draft.config.spotifyUrl = url;
          return draft;
        }, 'Spotify source saved');
        await runtime.sendCommand('play-spotify', { url, label: 'Spotify', volumePercent: store.state.config.musicLevel, volumeMode: 'global' }, 'Spotify play sent to receiver.');
      });
    }
    if (kind === 'announce') {
      const text = String(data.get('text') || '').trim();
      await runAction('Sending announcement', () => sendLiveAnnouncement({
        text,
        label: 'Speak Now',
        volumePercent: audibleVoiceTarget(store.state),
        sourceId: String(data.get('sourceId') || 'natural-voice')
      }));
      form.reset();
      return;
    }
    if (kind === 'announcement-source-add' || kind === 'announcement-source-edit') {
      const editing = kind === 'announcement-source-edit';
      const id = editing ? String(form.dataset.id || '') : makeId('announcement-source');
      const source = finiteAnnouncementSourceFromForm(data, id);
      return await runAction(editing ? 'Saving announcement clip' : 'Adding announcement clip', () => store.mutate(draft => {
        draft.announcementSources = Array.isArray(draft.announcementSources) ? draft.announcementSources : [];
        const index = draft.announcementSources.findIndex(item => item.id === id);
        if (editing && index < 0) throw new Error('That announcement clip no longer exists.');
        if (!editing && draft.announcementSources.length >= 40) throw new Error('Delete an old announcement clip before adding another.');
        if (editing) draft.announcementSources[index] = source;
        else draft.announcementSources.push(source);
        draft.activityLog = [makeLog('settings', editing ? 'Announcement clip updated' : 'Announcement clip added', `${source.label} · ${source.durationSeconds} seconds`), ...(draft.activityLog || [])];
        return draft;
      }, editing ? 'Announcement clip saved' : 'Announcement clip added'));
    }
    if (kind === 'settings') {
      return await runAction('Saving settings', async () => {
        await store.mutate(draft => {
          draft.config.address = String(data.get('address') || '').trim();
          draft.config.latitude = Number(data.get('latitude'));
          draft.config.longitude = Number(data.get('longitude'));
          draft.config.lightningRadiusMiles = Number(data.get('lightningRadiusMiles'));
          draft.config.lightningHoldMinutes = Number(data.get('lightningHoldMinutes'));
          draft.config.windGustMph = Number(data.get('windGustMph'));
          draft.config.aiVoice = String(data.get('aiVoice') || 'marin');
          draft.config.weatherAuto = data.get('weatherAuto') === 'on';
          draft.activityLog = [makeLog('settings', 'Operating settings updated', 'Weather and voice settings saved.'), ...(draft.activityLog || [])];
          return draft;
        }, 'Settings saved');
        if (runtime.isOwner()) runtime.prewarmSafetyVoices().catch(() => {});
      });
    }
    if (kind === 'announcement-edit') {
      const id = String(form.dataset.id || '');
      if (id === 'lightning' || id === 'lightning-clear') throw new Error('Lightning safety messages are generated from the current weather settings and cannot be edited independently.');
      const sourceId = String(data.get('sourceId') || 'natural-voice');
      announcementDeliveryForSource(announcementSourceById(sourceId));
      const announcementText = String(data.get('text') || '').trim();
      if (
        (pushcutAnnouncementReady() || automaticAnnouncementsEnabled())
        && announcementText.length > PUSHCUT_MAX_ANNOUNCEMENT_CHARACTERS
      ) {
        throw new Error(`Shorten this message to ${PUSHCUT_MAX_ANNOUNCEMENT_CHARACTERS} characters or fewer so the Receiver Shortcut can finish reliably.`);
      }
      return await runAction('Saving announcement', () => store.mutate(draft => {
        const index = draft.announcements.findIndex(item => item.id === id);
        if (index < 0) throw new Error('Saved announcement no longer exists.');
        draft.announcements[index] = {
          ...draft.announcements[index],
          label: String(data.get('label') || '').trim().slice(0, 80),
          text: announcementText.slice(0, 900),
          sourceId
        };
        draft.activityLog = [makeLog('settings', 'Saved announcement updated', draft.announcements[index].label), ...(draft.activityLog || [])];
        return draft;
      }, 'Saved announcement updated'));
    }
    if (kind === 'schedule-settings') {
      const id = String(form.dataset.id || '');
      const name = String(data.get('name') || '').trim();
      if (!name) throw new Error('Give this schedule a name before saving.');
      const existingSchedule = (store.state.schedules || []).find(item => item.id === id);
      const requestedMode = data.get('mode') === 'order' ? 'order' : 'time';
      const dirtyItemDraft = root.querySelector(`form[data-form="schedule-item"][data-schedule-id="${CSS.escape(id)}"][data-dirty="true"]`);
      if (existingSchedule?.mode !== requestedMode && dirtyItemDraft) {
        throw new Error('Save or discard every open item edit before changing this schedule between Time and Order.');
      }
      return await runAction('Saving schedule', () => store.mutate(draft => {
        const schedule = (draft.schedules || []).find(item => item.id === id);
        if (!schedule) throw new Error('Saved schedule no longer exists.');
        const requestedEnabled = data.get('enabled') === 'on';
        const sequenceChanged = schedule.mode !== requestedMode || schedule.enabled !== requestedEnabled;
        schedule.name = name.slice(0, 80);
        schedule.mode = requestedMode;
        schedule.enabled = requestedEnabled;
        if (sequenceChanged) resetScheduleSequence(draft, schedule.id);
        draft.activityLog = [makeLog('settings', 'Saved schedule updated', `${schedule.name} · ${schedule.mode === 'order' ? 'Order' : 'Time'} mode`), ...(draft.activityLog || [])];
        return draft;
      }, 'Saved schedule updated'));
    }
    if (kind === 'schedule-item') {
      const id = String(form.dataset.id || '');
      const scheduleId = String(form.dataset.scheduleId || '');
      const actionKind = ['announcement', 'controlled', 'apple', 'spotify', 'stop'].includes(String(data.get('kind'))) ? String(data.get('kind')) : 'announcement';
      const stopItem = actionKind === 'stop';
      const iphoneAppleVolume = ['apple', 'spotify'].includes(actionKind) && activeReceiverIsIOS();
      const announcementSource = data.get('announcementSource') === 'inline' ? 'inline' : 'saved';
      const announcementSourceId = String(data.get('sourceId') || 'natural-voice');
      const inlineText = String(data.get('text') || '').trim();
      const itemUrl = String(data.get('url') || '').trim();
      const label = String(data.get('label') || '').trim();
      const scheduleSnapshot = (store.state.schedules || []).find(item => item.id === scheduleId);
      const selectedDays = [...new Set(data.getAll('days').map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];
      const requestedTime = String(data.get('time') || '');
      if (!label) throw new Error('Give this schedule item a name before saving.');
      if (scheduleSnapshot?.mode === 'time' && selectedDays.length === 0) throw new Error('Choose at least one day for this Time schedule item. To stop it, turn off Item is active.');
      if (actionKind === 'announcement' && announcementSource === 'inline' && !inlineText) throw new Error('Type the custom announcement before saving this item.');
      if (actionKind === 'announcement') announcementDeliveryForSource(announcementSourceById(announcementSourceId));
      if (
        actionKind === 'announcement'
        && announcementSource === 'inline'
        && scheduleSnapshot?.mode === 'time'
        && (pushcutAnnouncementReady() || automaticAnnouncementsEnabled())
        && inlineText.length > PUSHCUT_MAX_ANNOUNCEMENT_CHARACTERS
      ) {
        throw new Error(`Shorten this timed announcement to ${PUSHCUT_MAX_ANNOUNCEMENT_CHARACTERS} characters or fewer for reliable Receiver Shortcut playback.`);
      }
      if (actionKind !== 'announcement' && !stopItem && !itemUrl) throw new Error('Add the Apple Music, Spotify, Suno, or direct audio URL for this music item.');
      if (actionKind === 'apple' && itemUrl && !isAppleMusicUrl(itemUrl)) throw new Error('Use a valid Apple Music playlist, album, artist, or track URL for this item.');
      if (actionKind === 'spotify' && itemUrl && !isSpotifyUrl(itemUrl)) throw new Error('Use a valid Spotify playlist, album, artist, or track URL for this item.');
      if (
        scheduleSnapshot?.mode === 'time'
        && scheduleSnapshot.enabled !== false
        && data.get('enabled') === 'on'
        && ['controlled', 'apple', 'spotify', 'stop'].includes(actionKind)
      ) {
        const selectedDaySet = new Set(selectedDays);
        const collision = (store.state.schedules || []).flatMap(candidate => (
          candidate?.enabled !== false && candidate?.mode === 'time'
            ? (candidate.items || []).map(item => ({ schedule: candidate, item }))
            : []
        )).find(({ schedule, item }) => {
          if (schedule.id === scheduleId && item.id === id) return false;
          if (item?.enabled === false || !['controlled', 'apple', 'spotify', 'stop'].includes(scheduleItemKind(item))) return false;
          if (String(item.position?.time || item.time || '') !== requestedTime) return false;
          const itemDays = Array.isArray(item.days) && item.days.length
            ? item.days.map(Number)
            : [0, 1, 2, 3, 4, 5, 6];
          return itemDays.some(day => selectedDaySet.has(day));
        });
        if (collision) {
          throw new Error(`Move this audio row to a different time. It conflicts with “${collision.item.label}” in ${collision.schedule.name}.`);
        }
      }
      const playAfterSave = submitIntent === 'play';
      return await runAction(playAfterSave ? 'Saving and playing schedule item' : 'Saving schedule item', async () => {
        await store.mutate(draft => {
        const schedule = (draft.schedules || []).find(item => item.id === scheduleId);
        const index = schedule?.items?.findIndex(item => item.id === id) ?? -1;
        if (index < 0) throw new Error('Schedule item no longer exists.');
        const existing = schedule.items[index];
        const targetOrder = clamp(data.get('order') || existing.position?.order || index + 1, 1, 100, index + 1);
        const volumeMode = actionKind !== 'announcement'
          && !stopItem
          && !iphoneAppleVolume
          && data.get('volumeMode') === 'custom'
            ? 'custom'
            : 'global';
      const advanceMode = ['complete', 'track-end', 'duration', 'manual'].includes(String(data.get('advanceMode')))
          ? String(data.get('advanceMode'))
          : (actionKind === 'announcement' ? 'complete' : 'manual');
        if (['apple', 'spotify'].includes(actionKind) && advanceMode === 'track-end') throw new Error(`${actionKind === 'spotify' ? 'Spotify' : 'Apple Music'} cannot provide a schedule-safe track-end event. Choose Manual, Duration, or Immediately after start.`);
        schedule.items[index] = {
          ...existing,
          label: label.slice(0, 100),
          type: actionKind,
          enabled: data.get('enabled') === 'on',
          days: schedule.mode === 'time' ? selectedDays : existing.days,
          position: {
            time: String(data.get('time') || existing.position?.time || '12:00'),
            order: targetOrder
          },
          action: {
            kind: actionKind,
            announcementSource: actionKind === 'announcement' ? announcementSource : '',
            announcementId: actionKind === 'announcement' ? String(data.get('announcementId') || '') : '',
            sourceId: actionKind === 'announcement' ? announcementSourceId : '',
            text: actionKind === 'announcement' && announcementSource === 'inline' ? inlineText.slice(0, 900) : '',
            url: actionKind === 'announcement' || stopItem ? '' : itemUrl.slice(0, 2000),
            restoreMusicPercent: actionKind === 'announcement'
              ? clamp(data.get('restoreMusicPercent'), 0, 100, draft.config.musicLevel)
              : null
          },
          volume: {
            mode: volumeMode,
            percent: stopItem
              ? 0
              : actionKind === 'announcement'
              ? VOICE_LEVEL_PERCENT
              : clamp(
                  iphoneAppleVolume ? existing.volume?.percent : data.get('volumePercent'),
                  0,
                  100,
                  draft.config.musicLevel
                )
          },
          advance: {
            mode: actionKind === 'announcement' || stopItem ? 'complete' : advanceMode,
            durationSeconds: clamp(data.get('durationSeconds'), 1, 86_400, 300)
          }
        };
        schedule.items = reorderScheduleItems(schedule.items, id, targetOrder);
        resetScheduleSequence(draft, scheduleId);
        draft.activityLog = [makeLog('settings', 'Schedule item updated', `${schedule.name}: ${label}`), ...(draft.activityLog || [])];
        return draft;
        }, 'Schedule item saved');
        if (playAfterSave) {
          try {
            await playScheduleItem(id, scheduleId);
          } catch (error) {
            clearDirtyForm(submittedFormKey);
            throw new Error(`Item saved, but playback could not start: ${error.message || String(error)}`);
          }
        }
      });
    }
  };
  execute().then(() => {
    clearDirtyForm(submittedFormKey);
    renderWhenIdle(true);
  }).catch(error => setFeedback(error.message || String(error), false));
});

window.addEventListener('pagehide', event => {
  if (role === 'command') {
    apple.disconnect();
  } else if (role === 'receiver' && runtime.active && isIOSLike()) {
    if (automaticAnnouncementsEnabled() && event.persisted === true) {
      // An Email personal automation may briefly background Safari while the
      // signed Shortcut owns volume and announcement playback. Preserve the
      // browser music lease only while iOS keeps this page in its back/forward
      // cache. A true close or navigation still releases the Receiver below.
      return;
    }
    // One idempotent stop synchronously queues the atomic beacon handoff before
    // Safari suspends, then tears down audio without a duplicate release path.
    runtime.failSafeStop(
      'The iPhone receiver page was hidden. Audio stopped and Browser Receiver routing was released so Remote commands cannot be sent to a stale Safari session. Reopen Poolside Pulse and tap Start Receiver to reactivate browser playback.',
      {
        releaseMode: automaticAnnouncementsEnabled() ? 'browser' : 'pushcut',
        beacon: true
      }
    ).catch(() => {});
  }
});

bootstrap();
