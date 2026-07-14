import {
  DEFAULT_ANNOUNCEMENTS,
  DUCK_LEVEL_PERCENT,
  VOICE_LEVEL_PERCENT,
  VERSION,
  audioPolicy,
  cancelSequenceRun,
  clamp,
  effectiveScheduleItemVolume,
  getActiveSchedule,
  isAppleMusicUrl,
  makeId,
  makeLog,
  normalizeSequenceRun,
  reorderScheduleItems,
  receiverOnline,
  resolveScheduleAnnouncementText,
  safetyAnnouncementText
} from './core.js';
import { AudioEngine, isIOSLike } from './audio-engine.js';
import { CloudStore, loginSession, logoutSession, sessionStatus } from './cloud.js';
import { AppleMusicReceiver } from './apple-music-receiver.js';
import { ReceiverRuntime } from './receiver-runtime.js';

const root = document.getElementById('app');
const ROLE_KEY = 'poolside-pulse-vx-role';
const TAB_KEY = 'poolside-pulse-vx-tab';
const PREVIOUS_TAB_KEY = 'poolside-pulse-vx-previous-tab';
const SCHEDULE_SELECTION_KEY = 'poolside-pulse-vx-schedule-selection';
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
  'reset-order-schedule'
]);

let authenticated = false;
let authChecked = false;
let role = localStorage.getItem(ROLE_KEY) || '';
let activeTab = localStorage.getItem(TAB_KEY) || 'control';
let feedback = { message: 'Starting Poolside Pulse Version X...', ok: true };
let busy = false;
let takeoverTarget = null;
let renderQueued = false;
let renderQueuedForce = false;
let actionSettled = Promise.resolve();
let settleCurrentAction = null;
let queuedMusicLevel = null;
let musicLevelDrain = null;
let musicLevelDraft = null;
let musicLevelSaveSequence = 0;
let queuedVoiceLevel = null;
let voiceLevelDrain = null;
let voiceLevelDraft = null;
let voiceLevelSaveSequence = 0;
let roleChangePending = false;
let pendingTab = '';
let previousTab = localStorage.getItem(PREVIOUS_TAB_KEY) || '';
let selectedScheduleId = localStorage.getItem(SCHEDULE_SELECTION_KEY) || '';
let scheduleDeletePending = '';
let draggedScheduleItemId = '';
let draggedScheduleTargetId = '';

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
    if (!shouldForce && focusedEditor()) {
      updateLiveStatus();
      return;
    }
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
  const customTarget = customPlaybackMusicTarget(state);
  if (customTarget !== null) return customTarget;
  const sharedTarget = globalOverride === null || globalOverride === undefined
    ? state?.config?.musicLevel
    : globalOverride;
  return clamp(sharedTarget, 0, 100, 30);
}

function audibleVoiceTarget(state = store?.state, globalOverride = null) {
  const sharedTarget = globalOverride === null || globalOverride === undefined
    ? state?.config?.voiceLevel
    : globalOverride;
  return clamp(sharedTarget, 0, 100, VOICE_LEVEL_PERCENT);
}

const store = new CloudStore({
  onState: state => {
    if (!(state.schedules || []).some(schedule => schedule.id === selectedScheduleId)) {
      selectedScheduleId = state.activeScheduleId || state.schedules?.[0]?.id || '';
      if (selectedScheduleId) localStorage.setItem(SCHEDULE_SELECTION_KEY, selectedScheduleId);
    }
    const physicalCustomTarget = runtime?.currentPhysicalCustomTarget?.();
    const effectiveTarget = physicalCustomTarget === null || physicalCustomTarget === undefined
      ? audibleMusicTarget(state, musicLevelDraft === null ? state.config.musicLevel : musicLevelDraft)
      : physicalCustomTarget;
    audio.setMusicLevelPercent?.(effectiveTarget, { report: false });
    audio.setVoiceLevelPercent?.(audibleVoiceTarget(state, voiceLevelDraft === null ? state.config.voiceLevel : voiceLevelDraft), { report: false });
    apple.setTargetVolumePercent?.(effectiveTarget);
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
        .then(handled => handled || !!state.scheduledRunToken || runtime.hasPendingControlledTrackEnd() || runtime.nextMusic({ automatic: true, expectedUrl: state.url }))
        .catch(error => setFeedback(`Next track failed: ${error.message}`, false));
    }
  }
});

const apple = new AppleMusicReceiver({
  onStatus: status => setFeedback(status.message, status.ok),
  onState: () => renderWhenIdle()
});

audio.setMusicLevelPercent(audibleMusicTarget(store.state), { report: false });
audio.setVoiceLevelPercent?.(audibleVoiceTarget(store.state), { report: false });
apple.setTargetVolumePercent(audibleMusicTarget(store.state));

const runtime = new ReceiverRuntime({
  store,
  audio,
  apple,
  onStatus: status => setFeedback(status.message, status.ok),
  onChange: () => renderWhenIdle()
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

function displayAudioPolicy(provider = effectiveProvider()) {
  const musicPercent = audibleMusicTarget(store.state);
  if (provider === 'apple' && cloudAppleMusicVerified()) {
    return audioPolicy({ provider: 'apple', isIOS: false, supportsVolume: true, volumeVerified: true, verifiedPercent: musicPercent, musicPercent, voicePercent: audibleVoiceTarget() });
  }
  return audioPolicy({
    provider,
    isIOS: isIOSLike(),
    supportsVolume: !!apple.supportsVolume,
    volumeVerified: !!apple.volumeVerified,
    verifiedPercent: apple.verifiedPercent,
    musicPercent,
    voicePercent: audibleVoiceTarget()
  });
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
    receiverBadge.textContent = online ? 'Receiver online' : 'Receiver offline';
    receiverBadge.className = `statusPill ${online ? 'online' : 'offline'}`;
  }
}

async function runAction(label, action) {
  if (busy) return;
  busy = true;
  actionSettled = new Promise(resolve => { settleCurrentAction = resolve; });
  setFeedback(`${label}...`, true);
  renderWhenIdle(true);
  try {
    const result = await action();
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
    const nextStep = apple.loggedIn() ? 'Tap Retry Apple Music Setup.' : 'Tap Authorize Apple Music.';
    setFeedback(`Apple Music setup needs attention: ${error.message || String(error)} ${nextStep}`, false);
    return false;
  }
}

async function bootstrapAuthenticatedApp() {
  await store.load();
  const requestedRole = location.hash === '#receiver' ? 'receiver' : location.hash === '#command' ? 'command' : '';
  if (requestedRole) await setRole(requestedRole, { silent: true });
  if (role === 'command') apple.disconnect();
  else await restoreStoredAppleAuthorization();
  store.startPolling(2_500);
  render();
}

async function bootstrap() {
  document.documentElement.dataset.poolsideVersion = VERSION;
  document.title = 'Lake123 - Poolside Pulse - Version X';
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
  return `
    <main class="centerStage roleStage">
      <section class="rolePanel">
        <div class="brandSeal">PP</div>
        <p class="kicker">Poolside Pulse Version X</p>
        <h1>What is this device?</h1>
        <p class="lead">Choose once. You can change it later in Settings.</p>
        <div class="roleChoices">
          <button class="roleChoice receiverChoice" data-action="choose-role" data-role="receiver">
            <span class="roleIcon" aria-hidden="true">◉</span>
            <strong>Speaker Receiver</strong>
            <small>The one device connected to the pool speakers. Keep it plugged in and open.</small>
          </button>
          <button class="roleChoice commandChoice" data-action="choose-role" data-role="command">
            <span class="roleIcon" aria-hidden="true">⌁</span>
            <strong>Remote Control</strong>
            <small>Your phone or laptop for music, announcements, weather, and schedules.</small>
          </button>
        </div>
        <div class="truthNote"><strong>Version X rule:</strong> only the Speaker Receiver can produce sound. Remote devices never become Apple Music players.</div>
      </section>
    </main>`;
}

function shellStatus() {
  const state = store.state;
  const online = receiverOnline(state.receiver, store.now());
  const syncGood = store.syncMode === 'kv' || store.syncMode === 'local';
  const policy = displayAudioPolicy();
  return `
    <div class="shellStatus">
      <span class="statusPill ${syncGood ? 'online' : 'warn'}">${store.syncMode === 'kv' ? 'Cloud synced' : store.syncMode === 'local' ? 'Local preview' : escapeHtml(store.syncMode)}</span>
      <span class="statusPill ${online ? 'online' : 'offline'}" data-live-receiver>${online ? 'Receiver online' : 'Receiver offline'}</span>
      <span class="statusPill mix">${policy.exact ? `${policy.musicPercent}% music / ${audibleVoiceTarget()}% voice` : `Apple Music ${store.state.config.musicLevel}%?`}</span>
    </div>`;
}

function renderHeader() {
  return `
    <header class="appHeader">
      <div class="brandLockup">
        <div class="brandSeal small">PP</div>
        <div><span>Lake123</span><strong>Poolside Pulse</strong><small>Version X</small></div>
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
  if (!online) return '<strong>No receiver online</strong><span>Open Version X on the speaker device and tap Start Receiver.</span>';
  return `<strong>${escapeHtml(receiver.name || 'Speaker Receiver')}</strong><span>${escapeHtml(receiver.detail || 'Ready')} · seen ${escapeHtml(relativeTime(receiver.lastSeen))}</span>`;
}

function playbackCard() {
  const playback = store.state.playback;
  const audibleTarget = audibleMusicTarget(store.state);
  const calibrationActive = !!audio.status().calibrationActive;
  const playing = calibrationActive || playback.intent === 'playing';
  const paused = !calibrationActive && playback.intent === 'paused';
  const provider = calibrationActive ? 'Receiver sound check' : playback.provider === 'apple' ? 'Apple Music' : 'Suno / Direct';
  const appleVerified = cloudAppleMusicVerified();
  const localAppleMusicLabel = playback.provider === 'apple' && runtime.isOwner() && apple.current?.name
    ? `${apple.current.name}${apple.current.artists ? ` - ${apple.current.artists}` : ''}`
    : '';
  const displayLabel = calibrationActive
    ? `${Math.round(audio.status().musicLevelPercent)}% sound-check tone`
    : (localAppleMusicLabel || playback.label || 'Nothing playing');
  const displayDetail = calibrationActive
    ? `Temporary test tone · announcements silence it to ${DUCK_LEVEL_PERCENT}%`
    : `${provider} · ${playback.provider === 'apple' ? (appleVerified ? `receiver-verified at ${audibleTarget}%` : `pause-for-voice mode; ${audibleTarget}% target unverified`) : `music bus set to ${audibleTarget}%`}`;
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
          : `<button data-action="transport" data-command="${paused ? 'resume-music' : 'pause-music'}" class="secondary" title="${paused ? 'Resume' : 'Pause'}" ${!playing && !paused ? 'disabled' : ''}>${paused ? 'Resume' : 'Pause'}</button>
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
  const audioStatus = audio.status();
  const audibleTarget = audibleMusicTarget(store.state);
  const calibrationActive = !!audioStatus.calibrationActive;
  const readiness = [
    ['Cloud commands', store.syncMode === 'kv', store.syncMode === 'kv' ? 'Durable KV connected' : `Current mode: ${store.syncMode}`],
    ['Audio mixer', owned && audioStatus.unlocked, owned ? `${audibleTarget}/${audibleVoiceTarget()} mixer unlocked` : 'Tap Start Receiver'],
    ['Receiver lease', owned, owned ? 'This is the only active sound owner' : online ? `${receiver.name || 'Receiver'} owns sound` : 'No active receiver'],
    ['Weather scan', Number(store.state.weather.checkedAt || 0) > 0, store.state.weather.checkedAt ? `Last check ${relativeTime(store.state.weather.checkedAt)}` : 'Runs after receiver starts'],
    ['Screen awake', !!runtime.wakeLock, runtime.wakeLock ? 'Wake lock active' : 'Keep this page visible and device plugged in']
  ];
  const liveSchedule = getActiveSchedule(store.state);
  const scheduledAppleMusic = liveSchedule?.enabled !== false && (liveSchedule?.items || [])
    .some(item => item?.enabled !== false && scheduleItemKind(item) === 'apple');
  const appleRelevant = activeProvider === 'apple' || apple.loggedIn() || scheduledAppleMusic;
  if (appleRelevant) {
    const localAppleMusicReadiness = apple.readiness();
    readiness.push(
      ['Apple Music authorization', apple.loggedIn(), apple.loggedIn() ? 'Authorized on this speaker receiver' : scheduledAppleMusic ? 'Required by an enabled item in the live schedule' : 'Tap Authorize Apple Music on this receiver'],
      ['Apple Music receiver', localAppleMusicReadiness.ready, localAppleMusicReadiness.detail]
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
          ${owned
            ? apple.loggedIn()
              ? `<button data-action="connect-apple" class="appleButton">${apple.playerPrepared ? (apple.readiness().ready ? 'Reconnect Apple Music' : 'Connect Apple Music') : (apple.prepareError ? 'Retry Apple Music Setup' : 'Prepare Apple Music')}</button>`
              : '<button data-action="apple-login" class="appleButton">Authorize Apple Music</button>'
            : ''}
        </div>
      </div>
      <div class="mixMeter" aria-label="Audio levels">
        <div><span>Music target</span><strong>${policy.exact ? `${policy.musicPercent}%` : `${audibleTarget}%?`}</strong><i style="--level:${policy.exact ? policy.musicPercent / 100 : audibleTarget / 100}"></i></div>
        <div><span>Voice</span><strong>${audibleVoiceTarget()}%</strong><i style="--level:${audibleVoiceTarget() / 100}"></i></div>
        <small>${policy.exact ? `The receiver has verified this music level. Voice is set to ${audibleVoiceTarget()}%.` : 'Apple Music volume is not software-verified here. It pauses completely before voice or Suno plays.'}</small>
      </div>
    </section>
    ${isIOSLike() ? `<div class="callout ${owned ? 'warning' : ''}"><strong>iPhone receiver level setup</strong><p>${owned
      ? 'Keep this page visible while the receiver is live. Apple Music pauses fully before Suno or speech. On iPhone, Poolside Pulse cannot verify an exact Apple Music volume, so this is pause-only compatibility.'
      : 'For reliable schedules, use an always-on desktop receiver. An iPhone may suspend the page and cannot provide verified Apple Music volume control.'}</p></div>` : ''}
    ${other ? `<div class="callout warning"><strong>Takeover protection</strong><p>Starting here will stop commands from targeting ${escapeHtml(receiver.name || 'the other receiver')}. Only take over if that device is no longer connected to the speakers.</p></div>` : ''}
    <section class="readinessPanel">
      <div class="sectionHeading"><div><p class="kicker">Live readiness</p><h2>Everything that must stay healthy</h2></div><span class="score">${readiness.filter(([, ok]) => ok).length}/${readiness.length}</span></div>
      <div class="readinessGrid">${readiness.map(([label, ok, detail]) => `<div class="readinessItem ${ok ? 'pass' : 'todo'}"><span>${ok ? 'Ready' : 'Check'}</span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(detail)}</small></div>`).join('')}</div>
    </section>
    ${playbackCard()}
    <section class="weatherStrip ${store.state.weather.tornadoActive || store.state.weather.lightningActive ? 'dangerState' : store.state.weather.windActive ? 'warningState' : ''}">
      <div><p class="kicker">Weather guard</p><h2>${store.state.weather.tornadoActive ? 'Tornado warning active' : store.state.weather.lightningActive ? 'Lightning hold active' : store.state.weather.windActive ? 'Strong wind active' : 'Monitoring every two minutes'}</h2><p>${escapeHtml(store.state.weather.status)}</p></div>
      <button data-action="weather-check" class="secondary">Check Now</button>
    </section>`;
}

function providerSelector() {
  const provider = store.state.config.musicProvider;
  const target = store.state.config.musicLevel;
  return `
    <div class="providerSelector" role="group" aria-label="Music source">
      <button aria-pressed="${provider === 'controlled'}" data-action="provider" data-provider="controlled" class="${provider === 'controlled' ? 'active' : ''}"><strong>Suno / Direct</strong><small>Exact ${target}/${audibleVoiceTarget()} mix</small></button>
      <button aria-pressed="${provider === 'apple'}" data-action="provider" data-provider="apple" class="${provider === 'apple' ? 'active' : ''}"><strong>Apple Music</strong><small>${cloudAppleMusicVerified() ? `Verified ${target}%` : `${target}% target`}</small></button>
    </div>`;
}

function musicLevelControl() {
  const target = clamp(musicLevelDraft === null ? store.state.config.musicLevel : musicLevelDraft, 0, 100, 30);
  const customTarget = customPlaybackMusicTarget(store.state);
  return `
    <section class="volumeControl" aria-labelledby="musicLevelLabel">
      <div class="volumeHeading"><div><p class="kicker">Shared music target</p><h2 id="musicLevelLabel">Music volume</h2></div><output for="musicLevel" data-music-level-output>${target}%</output></div>
      <input id="musicLevel" type="range" min="0" max="100" step="1" value="${target}" aria-labelledby="musicLevelLabel" aria-describedby="musicLevelHelp" aria-valuetext="${target}% music; announcements ${audibleVoiceTarget()}%" style="--level:${target / 100}" />
      <div class="volumeScale" aria-hidden="true"><span>0%</span><span>Default 30%</span><span>100%</span></div>
      <p id="musicLevelHelp">${customTarget === null ? 'Applies immediately' : `Saves the shared target for later; the current schedule item remains at its custom ${customTarget}%`} for Suno/direct on the receiver and to Apple Music only when that desktop receiver verifies volume control. Apple Music always pauses before Suno or speech; it never overlaps an announcement.</p>
    </section>`;
}

function voiceLevelControl() {
  const target = audibleVoiceTarget(store.state, voiceLevelDraft === null ? store.state.config.voiceLevel : voiceLevelDraft);
  return `
    <section class="volumeControl voiceVolumeControl" aria-labelledby="voiceLevelLabel">
      <div class="volumeHeading"><div><p class="kicker">Shared announcement target</p><h2 id="voiceLevelLabel">Voice volume</h2></div><output for="voiceLevel" data-voice-level-output>${target}%</output></div>
      <input id="voiceLevel" type="range" min="0" max="100" step="1" value="${target}" aria-labelledby="voiceLevelLabel" aria-describedby="voiceLevelHelp" aria-valuetext="${target}% announcement voice" style="--level:${target / 100}" />
      <div class="volumeScale" aria-hidden="true"><span>0%</span><span style="left:${target}%">Shared ${target}%</span><span>100%</span></div>
      <p id="voiceLevelHelp">Applies to Speak Now, saved messages, safety announcements, and schedule items using the shared voice level. A scheduled announcement can override it with its own custom volume.</p>
    </section>`;
}

function musicSourceForm() {
  const config = store.state.config;
  if (config.musicProvider === 'apple') {
    const policy = audioPolicy({ provider: 'apple', isIOS: isIOSLike(), supportsVolume: apple.supportsVolume, volumeVerified: apple.volumeVerified, verifiedPercent: apple.verifiedPercent, musicPercent: config.musicLevel, voicePercent: audibleVoiceTarget() });
    const receiverAppleMusicReady = receiverOnline(store.state.receiver, store.now()) && store.state.receiver?.appleStatus === 'ready';
    return `
      <form data-form="apple-play" class="sourceForm">
        <label for="appleUrl">Apple Music playlist, album, artist, or track</label>
        <div class="inputAction"><input id="appleUrl" name="url" type="url" value="${escapeAttr(config.appleUrl || '')}" placeholder="https://music.apple.com/us/album/..." required /><button type="submit" class="appleButton" ${receiverAppleMusicReady ? '' : 'disabled'}>Play Apple Music</button></div>
      </form>
      ${receiverAppleMusicReady ? '' : `<div class="callout warning"><strong>Apple Music is not ready on the speaker receiver.</strong><p>${escapeHtml(store.state.receiver?.appleDetail || 'Open Settings on the receiver, authorize Apple Music, then tap Connect Apple Music.')}</p></div>`}
      <div class="capabilityCard ${policy.exact ? 'verified' : 'limited'}">
        <span>${policy.exact ? 'Verified path' : 'Compatibility path'}</span>
        <strong>${escapeHtml(policy.label)}</strong>
        <p>${escapeHtml(policy.detail)}</p>
      </div>
      <div class="policyNote"><strong>Safe Apple behavior:</strong> Poolside Pulse pauses Apple Music completely before Suno or speech and resumes it only afterward; the sources never overlap. Exact Apple Music volume is shown only after a desktop receiver verifies it. iPhone is pause-only. An active Apple Music subscription and an open, signed-in receiver are required.</div>`;
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
  return `
    <section class="pageHeading"><p class="kicker">Music control</p><h1>One source. One receiver.</h1><p>Suno and Apple Music are mutually exclusive. Every command targets the current receiver session; expired commands are never replayed.</p></section>
    <div class="receiverRibbon ${online ? 'online' : 'offline'}">${receiverSummary()}</div>
    ${playbackCard()}
    <section class="workspacePanel">
      ${musicLevelControl()}
      <div class="sectionHeading sourceHeading"><div><p class="kicker">Choose music</p><h2>Playback source</h2></div><span class="fixedMix">${policy.exact ? `${policy.musicPercent} / ${policy.voicePercent}` : `Target ${store.state.config.musicLevel}%`}</span></div>
      ${providerSelector()}
      ${musicSourceForm()}
    </section>`;
}

function renderAnnounce() {
  const announcements = store.state.announcements;
  const renderedText = item => safetyAnnouncementText(item.id, item.text, store.state.config);
  return `
    <section class="pageHeading"><p class="kicker">Announcements</p><h1>Clear voice, without music fighting it.</h1><p>Voice is prepared first, music is safely ducked or paused, and restoration waits until speech has ended.</p></section>
    <section class="announcementComposer">
      ${voiceLevelControl()}
      <form data-form="announce">
        <label for="announcementText">Speak now</label>
        <textarea id="announcementText" name="text" maxlength="900" placeholder="Type the announcement exactly as guests should hear it." required></textarea>
        <div class="composerFooter"><span>AI voice with device-voice fallback · ${audibleVoiceTarget()}% shared voice</span><button type="submit" class="primary">Speak Now</button></div>
      </form>
    </section>
    <section class="workspacePanel">
      <div class="sectionHeading"><div><p class="kicker">Saved messages</p><h2>One-tap announcements</h2></div></div>
      <div class="announcementGrid">${announcements.map(item => `<button class="announcementButton" data-action="saved-announcement" data-id="${escapeAttr(item.id)}"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(renderedText(item))}</small></button>`).join('')}</div>
      <details class="savedEditor" data-persist-open="saved-editor">
        <summary>Edit saved messages</summary>
        <div class="savedEditorList">${announcements.map(item => ['lightning', 'lightning-clear'].includes(item.id) ? `
          <div class="savedEditorRow"><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(renderedText(item))}</p><small>Generated from Lightning miles and Hold minutes in Settings so safety wording cannot become stale.</small></div>` : `
          <form data-form="announcement-edit" data-id="${escapeAttr(item.id)}" class="savedEditorRow">
            <label>Button name<input name="label" value="${escapeAttr(item.label)}" maxlength="80" required /></label>
            <label>Spoken message<textarea name="text" maxlength="900" required>${escapeHtml(item.text)}</textarea></label>
            <button type="submit" class="secondary">Save Message</button>
          </form>`).join('')}</div>
      </details>
    </section>
    <section class="safetyPanel">
      <div><p class="kicker">Safety</p><h2>Weather actions</h2><p>Manual check uses the same free NWS, Open-Meteo, and NOAA GLM scan as the automatic two-minute monitor.</p></div>
      <div class="safetyActions"><button data-action="weather-check" class="weatherButton">Check Weather Now</button><button data-action="safety-announcement" data-id="lightning" class="danger">Announce Lightning Hold</button><button data-action="safety-announcement" data-id="wind" class="warningButton">Announce Close Umbrellas</button></div>
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
  return kind === 'apple' ? 'Apple Music' : 'Suno / Direct';
}

function scheduleVolumeLabel(item) {
  const percent = effectiveScheduleItemVolume(item, store.state.config);
  if (scheduleItemKind(item) === 'announcement') return `Voice ${percent}%`;
  return scheduleItemKind(item) === 'apple' ? `Target ${percent}%` : `Music ${percent}%`;
}

function scheduleAdvanceLabel(item) {
  if (scheduleItemKind(item) === 'announcement') return 'Completes after speech';
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

function renderScheduleRow(item, schedule, index) {
  const kind = scheduleItemKind(item);
  const announcementSource = item.action?.announcementSource || 'saved';
  const volumeMode = item.volume?.mode || 'global';
  const itemVolume = effectiveScheduleItemVolume(item, store.state.config);
  const advanceMode = item.advance?.mode || (kind === 'announcement' ? 'complete' : 'manual');
  const collapsedPosition = schedule.mode === 'order'
    ? String(clamp(item.position?.order ?? item.order ?? index + 1, 1, 100, index + 1))
    : formatScheduleTime(item.position?.time || item.time);
  return `
    <article class="scheduleItemShell" data-drop-schedule-item="${escapeAttr(item.id)}">
      <button type="button" class="dragHandle secondary" draggable="true" data-drag-schedule-item="${escapeAttr(item.id)}" data-focus-key="drag-${escapeAttr(item.id)}" aria-label="Drag ${escapeAttr(item.label)} to reorder" title="Drag to reorder; arrow keys also move this item">⋮⋮</button>
      <details class="scheduleItemCard" data-persist-open="schedule-${escapeAttr(item.id)}">
        <summary data-focus-key="summary-${escapeAttr(item.id)}">
          <span class="schedulePosition ${schedule.mode}">${escapeHtml(collapsedPosition)}</span>
          <span class="scheduleSummaryCopy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(scheduleKindLabel(item))} · ${escapeHtml(scheduleAdvanceLabel(item))}</small></span>
          <span class="scheduleVolumeBadge">${escapeHtml(scheduleVolumeLabel(item))}</span>
          <span class="scheduleEnabled ${item.enabled ? 'on' : 'off'}">${item.enabled ? 'On' : 'Off'}</span>
        </summary>
        <form data-form="schedule-item" data-id="${escapeAttr(item.id)}" data-schedule-id="${escapeAttr(schedule.id)}" data-kind="${escapeAttr(kind)}" data-announcement-source="${escapeAttr(announcementSource)}" data-volume-mode="${escapeAttr(volumeMode)}" data-advance-mode="${escapeAttr(advanceMode)}" class="scheduleItemForm">
          <div class="scheduleFormGrid">
            <label>Item name<input name="label" value="${escapeAttr(item.label)}" maxlength="100" required /></label>
            <label class="checkLabel"><input name="enabled" type="checkbox" ${item.enabled ? 'checked' : ''} /> Item is active</label>
            ${schedule.mode === 'order'
              ? `<label>Order 1-100<input name="order" type="number" min="1" max="100" step="1" value="${escapeAttr(item.position?.order ?? item.order ?? index + 1)}" required /></label>`
              : `<label>Time<input name="time" type="time" value="${escapeAttr(item.position?.time || item.time || '12:00')}" required /></label>${renderWeekdayControls(item.days)}`}
            <label>Action<select name="kind" data-schedule-kind><option value="announcement" ${kind === 'announcement' ? 'selected' : ''}>Announcement</option><option value="controlled" ${kind === 'controlled' ? 'selected' : ''}>Suno / direct audio</option><option value="apple" ${kind === 'apple' ? 'selected' : ''}>Apple Music</option></select></label>
            <div class="conditionalFields announcementFields" data-show-schedule-kind="announcement" ${kind === 'announcement' ? '' : 'hidden'}>
              <label>Announcement source<select name="announcementSource" data-announcement-source><option value="saved" ${announcementSource === 'saved' ? 'selected' : ''}>Saved announcement</option><option value="inline" ${announcementSource === 'inline' ? 'selected' : ''}>Custom for this schedule only</option></select></label>
              <label data-show-announcement-source="saved" ${announcementSource === 'saved' ? '' : 'hidden'}>Saved message<select name="announcementId">${announcementOptions(item.action?.announcementId || item.announcementId)}</select></label>
              <label data-show-announcement-source="inline" ${announcementSource === 'inline' ? '' : 'hidden'}>Custom announcement<textarea name="text" maxlength="900" placeholder="Type the announcement spoken only by this schedule item">${escapeHtml(item.action?.text || '')}</textarea><small>This text stays inside this schedule and is not added to Saved Messages.</small></label>
              <div class="fixedVoiceNote"><strong>Voice ${itemVolume}%</strong><span>Suno fades fully to ${DUCK_LEVEL_PERCENT}%. Apple Music pauses completely before this announcement.</span></div>
            </div>
            <div class="conditionalFields musicFields" data-show-schedule-kind="music" ${kind === 'announcement' ? 'hidden' : ''}>
              <label>Music URL<input name="url" type="url" value="${escapeAttr(item.action?.url || item.url || '')}" placeholder="Apple Music, Suno, or direct HTTPS audio URL" ${kind === 'announcement' ? '' : 'required'} /></label>
              ${schedule.mode === 'order' ? `<label>Advance<select name="advanceMode" data-advance-mode><option value="manual" ${advanceMode === 'manual' ? 'selected' : ''}>Manually with Play Next</option><option value="track-end" ${advanceMode === 'track-end' ? 'selected' : ''} ${kind === 'apple' ? 'disabled' : ''}>At direct track end (Suno/direct only)</option><option value="duration" ${advanceMode === 'duration' ? 'selected' : ''}>After a duration</option><option value="complete" ${advanceMode === 'complete' ? 'selected' : ''}>Immediately after playback starts</option></select></label><label data-show-advance-mode="duration" ${advanceMode === 'duration' ? '' : 'hidden'}>Duration seconds<input name="durationSeconds" type="number" min="1" max="86400" step="1" value="${escapeAttr(item.advance?.durationSeconds || 300)}" /></label>` : ''}
            </div>
            <div class="conditionalFields scheduleVolumeFields">
              <label>Volume<select name="volumeMode" data-volume-mode><option value="global" ${volumeMode === 'global' ? 'selected' : ''}>Use shared volume</option><option value="custom" ${volumeMode === 'custom' ? 'selected' : ''}>Custom for this item</option></select><small>${kind === 'announcement' ? `Shared voice is ${audibleVoiceTarget()}%.` : `Shared music is ${store.state.config.musicLevel}%.`}</small></label>
              <label data-show-volume-mode="custom" ${volumeMode === 'custom' ? '' : 'hidden'}>Item ${kind === 'announcement' ? 'voice' : 'music'} volume<div class="itemVolumeControl"><input name="volumePercent" class="itemVolumeSlider" type="range" min="0" max="100" step="1" value="${itemVolume}" /><output>${itemVolume}%</output></div></label>
            </div>
          </div>
          <div class="rowActions scheduleRowActions"><button type="submit" class="primary">Save Item</button><button type="submit" name="intent" value="play" class="secondary">Save & Play Now</button><button type="button" data-action="move-schedule-item" data-id="${escapeAttr(item.id)}" data-direction="-1" class="secondary" aria-label="Move ${escapeAttr(item.label)} up">Move Up</button><button type="button" data-action="move-schedule-item" data-id="${escapeAttr(item.id)}" data-direction="1" class="secondary" aria-label="Move ${escapeAttr(item.label)} down">Move Down</button><button type="button" data-action="duplicate-schedule-item" data-id="${escapeAttr(item.id)}" class="secondary">Duplicate</button><button type="button" data-action="delete-schedule-item" data-id="${escapeAttr(item.id)}" class="textDanger">Delete</button></div>
        </form>
      </details>
    </article>`;
}

function renderSchedule() {
  const schedules = Array.isArray(store.state.schedules) ? store.state.schedules : [];
  const schedule = activeSavedSchedule();
  const items = Array.isArray(schedule.items) ? schedule.items : [];
  const enabledItems = items.filter(item => item.enabled !== false);
  const sequenceRun = normalizeSequenceRun(store.state.sequenceRuns?.[schedule.id]);
  const isLiveSchedule = store.state.activeScheduleId === schedule.id && schedule.enabled !== false;
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
    <section class="pageHeading"><p class="kicker">Saved schedules</p><h1>Build the day in seconds.</h1><p>Create as many schedules as you need. Time schedules run automatically; Order schedules are fast, numbered cue lists controlled with Play Next.</p></section>
    <section class="scheduleWorkspace">
      <div class="schedulePickerBar">
        <label>Schedule to edit<select id="schedulePicker" aria-label="Schedule to edit">${schedules.map(candidate => `<option value="${escapeAttr(candidate.id)}" ${candidate.id === schedule.id ? 'selected' : ''}>${escapeHtml(candidate.name)}${candidate.id === store.state.activeScheduleId && candidate.enabled !== false ? ' (live)' : candidate.enabled ? '' : ' (off)'}</option>`).join('')}</select></label>
        <button type="button" data-action="new-schedule-set" class="primary addScheduleButton" aria-label="Add a new saved schedule">+ New Schedule</button>
      </div>
      <form data-form="schedule-settings" data-id="${escapeAttr(schedule.id)}" class="scheduleSettings">
        <label>Schedule name<input name="name" value="${escapeAttr(schedule.name)}" maxlength="80" required /></label>
        <label>Run by<select name="mode"><option value="time" ${schedule.mode === 'time' ? 'selected' : ''}>Time</option><option value="order" ${schedule.mode === 'order' ? 'selected' : ''}>Order 1-100</option></select></label>
        <label class="checkLabel"><input name="enabled" type="checkbox" ${schedule.enabled ? 'checked' : ''} /> Schedule is enabled</label>
        <div class="scheduleSettingsActions"><button type="submit" class="primary">Save Schedule</button>${isLiveSchedule ? '<span class="liveScheduleBadge">Live schedule</span>' : '<button type="button" data-action="activate-schedule-set" class="warningButton">Make This the Live Schedule</button>'}<button type="button" data-action="duplicate-schedule-set" class="secondary">Duplicate</button>${deleteArmed ? `<button type="button" data-action="confirm-delete-schedule-set" class="danger">Confirm Delete</button><button type="button" data-action="cancel-delete-schedule-set" class="secondary">Cancel</button>` : '<button type="button" data-action="delete-schedule-set" class="textDanger">Delete Schedule</button>'}</div>
      </form>
      ${schedule.mode === 'order' ? `<div class="orderRunner ${isLiveSchedule ? 'live' : 'inactive'}"><div><span>${isLiveSchedule ? 'Live order position' : 'Order schedule is not live'}</span><strong>${escapeHtml(orderStatus)}</strong><small>Announcements advance after speech. Music follows each item’s Advance setting; manual items wait for Play Next. The final item never loops back by itself.</small></div><div class="orderRunnerActions"><button type="button" data-action="play-next-schedule" class="primary" ${isLiveSchedule && enabledItems.length > 0 && !orderBusy && sequenceRun.status !== 'complete' ? '' : 'disabled'}>${sequenceRun.status === 'failed' ? 'Retry Next' : 'Play Next'}</button><button type="button" data-action="reset-order-schedule" class="secondary" ${isLiveSchedule ? '' : 'disabled'}>Reset to 1</button></div></div>` : `<div class="timeRunner ${isLiveSchedule ? 'live' : 'inactive'}"><strong>${isLiveSchedule ? 'Live automatic Time schedule' : 'Saved Time schedule · not live'}</strong><span>${isLiveSchedule ? 'Enabled items run at or shortly after their scheduled Central Time while the speaker receiver is online.' : 'Editing this schedule does not interrupt the current live schedule. Choose Make This the Live Schedule when it is ready.'}</span></div>`}
      <div class="scheduleList">${items.map((item, index) => renderScheduleRow(item, schedule, index)).join('')}</div>
      <button type="button" data-action="add-schedule-item" class="secondary addButton">+ Add Schedule Item</button>
    </section>
    <div class="callout warning"><strong>Receiver requirement</strong><p>Keep an authorized, signed-in receiver page open for scheduled playback. Apple Music also requires an active subscription. For unattended schedules, use an always-on Mac mini, Windows mini PC, or supported desktop receiver; an iPhone can suspend the tab and is pause-only for Apple volume.</p></div>`;
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
  const applePolicy = audioPolicy({ provider: 'apple', isIOS: isIOSLike(), supportsVolume: apple.supportsVolume, volumeVerified: apple.volumeVerified, verifiedPercent: apple.verifiedPercent, musicPercent: config.musicLevel, voicePercent: audibleVoiceTarget() });
  const appleReadiness = apple.readiness();
  const appleStage = !apple.loggedIn()
    ? 'Authorization required'
    : appleReadiness.ready
      ? 'Apple Music connected'
      : 'Authorized · connect this receiver';
  const roleControls = role === 'receiver' && runtime.active
    ? roleChangePending
      ? `<div class="callout warning"><strong>Stop the live receiver?</strong><p>Changing this device to Remote Control stops speaker audio and releases its receiver lease.</p><div class="stackedActions"><button data-action="set-role" data-role="command" class="danger">Confirm Stop & Change Role</button><button data-action="cancel-role-change" class="secondary">Keep Receiver Live</button></div></div>`
      : '<button data-action="request-role-change" class="secondary">Stop Receiver & Change to Remote Control</button>'
    : `<button data-action="set-role" data-role="${role === 'receiver' ? 'command' : 'receiver'}" class="secondary">Change to ${role === 'receiver' ? 'Remote Control' : 'Speaker Receiver'}</button>`;
  return `
    <section class="pageHeading"><p class="kicker">Settings & diagnostics</p><h1>Simple controls, honest status.</h1><p>Music and announcement voice each have an adjustable shared target. Apple Music volume is labeled exact only when this desktop receiver verifies it.</p></section>
    <section class="settingsGrid">
      <form data-form="settings" class="workspacePanel">
        <div class="sectionHeading"><div><p class="kicker">Weather & voice</p><h2>Operating settings</h2></div></div>
        <label>Location label (informational)<input name="address" value="${escapeAttr(config.address)}" /><small>Weather monitoring uses the latitude and longitude below; changing this label does not move the monitored point.</small></label>
        <div class="twoCols"><label>Latitude (authoritative)<input name="latitude" type="number" step="0.0001" value="${escapeAttr(config.latitude)}" /></label><label>Longitude (authoritative)<input name="longitude" type="number" step="0.0001" value="${escapeAttr(config.longitude)}" /></label></div>
        <div class="threeCols"><label>Lightning miles<input name="lightningRadiusMiles" type="number" min="1" max="25" value="${escapeAttr(config.lightningRadiusMiles)}" /></label><label>Hold minutes<input name="lightningHoldMinutes" type="number" min="5" max="90" value="${escapeAttr(config.lightningHoldMinutes)}" /></label><label>Wind gust mph<input name="windGustMph" type="number" min="15" max="80" value="${escapeAttr(config.windGustMph)}" /></label></div>
        <label>AI voice<select name="aiVoice">${['marin', 'cedar', 'coral', 'sage', 'onyx', 'nova'].map(voice => `<option ${config.aiVoice === voice ? 'selected' : ''}>${voice}</option>`).join('')}</select><small>Routine messages use this voice. Safety messages are prewarmed; if one is not ready, the receiver uses immediate device speech rather than delaying the warning.</small></label>
        <label class="checkLabel"><input name="weatherAuto" type="checkbox" ${config.weatherAuto ? 'checked' : ''} /> Automatic weather scan every two minutes</label>
        <button type="submit" class="primary">Save Settings</button>
      </form>
      <section class="workspacePanel">
        <div class="sectionHeading"><div><p class="kicker">Apple Music receiver</p><h2>${escapeHtml(appleStage)}</h2></div></div>
        <div class="capabilityCard ${apple.loggedIn() ? 'verified' : 'limited'}"><span>${apple.loggedIn() ? 'MusicKit authorized' : 'Apple Music subscription required'}</span><strong>${apple.loggedIn() ? 'This receiver is authorized' : 'Authorize on the speaker receiver'}</strong><p>Authorization is handled by Apple Music in this browser. Poolside Pulse does not ask a remote-control device to sign in.</p></div>
        <div class="capabilityCard ${applePolicy.exact ? 'verified' : 'limited'}"><span>${applePolicy.exact ? 'Supported receiver' : 'Compatibility only'}</span><strong>${escapeHtml(applePolicy.label)}</strong><p>${escapeHtml(applePolicy.detail)}</p></div>
        ${role === 'receiver'
          ? `<div class="stackedActions">${apple.loggedIn()
              ? `<button data-action="connect-apple" class="appleButton" ${runtime.isOwner() ? '' : 'disabled title="Start this speaker receiver first"'}>${apple.playerPrepared ? (appleReadiness.ready ? 'Reconnect Apple Music' : 'Connect Apple Music') : (apple.prepareError ? 'Retry Apple Music Setup' : 'Prepare Apple Music')}</button><button data-action="apple-logout" class="secondary">Remove Apple Music Authorization</button>`
              : '<button data-action="apple-login" class="appleButton">Authorize Apple Music</button>'}</div>${apple.loggedIn() && !runtime.isOwner() ? '<div class="callout"><strong>Start Receiver before connecting Apple Music.</strong><p>Only the device holding the live receiver lease may become the Apple Music player.</p></div>' : ''}`
          : '<div class="callout"><strong>Apple Music controls live only on the speaker receiver.</strong><p>Remote devices send commands and never authorize or connect an Apple Music account.</p></div>'}
        <div class="policyNote"><strong>Required for live and scheduled playback:</strong> an active Apple Music subscription, an authorized MusicKit session, and this receiver page kept open on the speaker device. Apple pauses before Suno or speech; there is no overlap. Desktop receivers may verify exact volume. iPhone uses pause-only compatibility.</div>
      </section>
      <section class="workspacePanel">
        <div class="sectionHeading"><div><p class="kicker">Sound verification</p><h2>Receiver sound check</h2></div></div>
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
  return `
    ${renderHeader()}
    <div class="appShell ${busy ? 'busy' : ''}" aria-busy="${busy}">
      ${tabs()}
      ${feedbackBanner()}
      <main class="content">${renderContent()}</main>
    </div>
    <footer class="appFooter"><span>Poolside Pulse Version X</span><span>${policy.exact ? `Music ${policy.musicPercent}% · Voice ${audibleVoiceTarget()}%` : `Apple Music target ${store.state.config.musicLevel}% unverified · Voice ${audibleVoiceTarget()}%`} · Weather every 2 minutes</span></footer>`;
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
  if (role === 'receiver' && nextRole === 'command' && runtime.active) await runtime.stop();
  role = nextRole;
  localStorage.setItem(ROLE_KEY, role);
  try {
    const cleanUrl = new URL(location.href);
    cleanUrl.hash = '';
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
    if (!silent) setFeedback('Remote Control mode: this device will never produce receiver audio.', true);
  } else {
    if (!silent) setFeedback('Speaker Receiver mode selected. Tap Start Receiver while connected to the speakers.', true);
    if (apple.loggedIn()) await restoreStoredAppleAuthorization({ reportSuccess: !silent });
  }
  renderWhenIdle(true);
}

async function setProvider(provider) {
  const target = clamp(store.state.config.musicLevel, 0, 100, 30);
  await store.mutate(draft => {
    draft.config.musicProvider = provider === 'apple' ? 'apple' : 'controlled';
    draft.activityLog = [makeLog('settings', 'Music source selected', draft.config.musicProvider === 'apple' ? `Apple Music ${target}% target` : `Suno/direct exact ${target}/${draft.config.voiceLevel} mode`), ...(draft.activityLog || [])];
    return draft;
  }, 'Music source selected');
  setFeedback(provider === 'apple' ? `Apple Music selected with a ${target}% target. It will pause for announcements.` : `Suno/direct selected for guaranteed ${target}/${audibleVoiceTarget()} mixing.`, true);
}

async function saveMusicLevel(percent) {
  const target = clamp(percent, 0, 100, 30);
  if (customPlaybackMusicTarget(store.state) === null) {
    audio.setMusicLevelPercent(target, { report: false });
    apple.setTargetVolumePercent(target);
  }
  await store.mutate(draft => {
    draft.config.musicLevel = target;
    if (draft.playback?.provider === 'apple') {
      draft.playback.volumeVerified = false;
      draft.playback.volumeVerifiedPercent = null;
      draft.playback.volumeVerifiedAt = 0;
    }
    draft.activityLog = [makeLog('settings', 'Music target changed', `${target}% music; ${audibleVoiceTarget(draft)}% announcements.`), ...(draft.activityLog || [])];
    return draft;
  }, `Music target ${target}% saved`);
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
      setFeedback(`Saving music at ${target}%...`, true);
      try {
        await saveMusicLevel(target);
        if (sequence === musicLevelSaveSequence && queuedMusicLevel === null) {
          musicLevelDraft = null;
          setFeedback(`Music target saved at ${target}%. Announcements silence music to ${DUCK_LEVEL_PERCENT}%.`, true);
          renderWhenIdle(true);
        }
      } catch (error) {
        if (sequence === musicLevelSaveSequence && queuedMusicLevel === null) {
          musicLevelDraft = null;
          const savedTarget = audibleMusicTarget(store.state);
          audio.setMusicLevelPercent(savedTarget, { report: false });
          apple.setTargetVolumePercent(savedTarget);
          setFeedback(error.message || String(error), false);
          renderWhenIdle(true);
        }
      }
    }
  })().finally(() => {
    musicLevelDrain = null;
    if (queuedMusicLevel !== null) queueMusicLevelSave(queuedMusicLevel);
  });
  return musicLevelDrain;
}

async function saveVoiceLevel(percent) {
  const target = clamp(percent, 0, 100, VOICE_LEVEL_PERCENT);
  audio.setVoiceLevelPercent?.(target, { report: false });
  await store.mutate(draft => {
    draft.config.voiceLevel = target;
    draft.activityLog = [makeLog('settings', 'Voice target changed', `${target}% shared announcement volume.`), ...(draft.activityLog || [])];
    return draft;
  }, `Voice target ${target}% saved`);
  setFeedback(`Voice target saved at ${target}%. It applies to live, saved, and shared-volume scheduled announcements.`, true);
  return target;
}

function queueVoiceLevelSave(percent) {
  queuedVoiceLevel = clamp(percent, 0, 100, VOICE_LEVEL_PERCENT);
  voiceLevelDraft = queuedVoiceLevel;
  if (voiceLevelDrain) return voiceLevelDrain;
  voiceLevelDrain = (async () => {
    while (queuedVoiceLevel !== null) {
      await new Promise(resolve => setTimeout(resolve, 180));
      const target = queuedVoiceLevel;
      queuedVoiceLevel = null;
      if (busy) await actionSettled;
      const sequence = ++voiceLevelSaveSequence;
      setFeedback(`Saving voice at ${target}%...`, true);
      try {
        await saveVoiceLevel(target);
        if (sequence === voiceLevelSaveSequence && queuedVoiceLevel === null) {
          voiceLevelDraft = null;
          renderWhenIdle(true);
        }
      } catch (error) {
        if (sequence === voiceLevelSaveSequence && queuedVoiceLevel === null) {
          voiceLevelDraft = null;
          audio.setVoiceLevelPercent?.(audibleVoiceTarget(store.state), { report: false });
          setFeedback(error.message || String(error), false);
          renderWhenIdle(true);
        }
      }
    }
  })().finally(() => {
    voiceLevelDrain = null;
    if (queuedVoiceLevel !== null) queueVoiceLevelSave(queuedVoiceLevel);
  });
  return voiceLevelDrain;
}

async function sendTransport(command) {
  const labels = { 'pause-music': 'Pause sent to receiver.', 'resume-music': 'Resume sent to receiver.', 'next-music': 'Next sent to receiver.', 'stop-music': 'Stop sent to receiver.' };
  await runtime.sendCommand(command, { label: labels[command] || command }, labels[command] || 'Music command sent.');
}

async function playScheduleItem(id, scheduleId = activeSavedSchedule().id) {
  const schedule = (store.state.schedules || []).find(entry => entry.id === scheduleId) || activeSavedSchedule();
  const item = (schedule.items || []).find(entry => entry.id === id);
  if (!item) return;
  const kind = scheduleItemKind(item);
  if (kind === 'announcement') {
    const rawText = resolveScheduleAnnouncementText(item, store.state.announcements);
    if (!rawText) throw new Error('Add announcement text or choose a saved announcement before playing this item.');
    const announcementId = item.action?.announcementId || item.announcementId || '';
    const text = item.action?.announcementSource === 'inline'
      ? rawText
      : safetyAnnouncementText(announcementId, rawText, store.state.config);
    await runtime.sendCommand('announce', {
      text,
      label: item.label,
      volumePercent: effectiveScheduleItemVolume(item, store.state.config),
      volumeMode: item.volume?.mode,
      scheduledItemId: item.id
    }, `Play Now sent: ${item.label}.`);
  } else if (kind === 'apple') {
    await runtime.sendCommand('play-apple', {
      url: item.action?.url || item.url || store.state.config.appleUrl,
      label: item.label,
      volumePercent: effectiveScheduleItemVolume(item, store.state.config),
      volumeMode: item.volume?.mode,
      scheduledItemId: item.id
    }, `Apple Music schedule item sent: ${item.label}.`);
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
  const announcementSource = form.querySelector('[data-announcement-source]')?.value || form.dataset.announcementSource || 'saved';
  const volumeMode = form.querySelector('[data-volume-mode]')?.value || form.dataset.volumeMode || 'global';
  const advanceSelect = form.querySelector('[data-advance-mode]');
  const trackEndOption = advanceSelect?.querySelector('option[value="track-end"]');
  if (trackEndOption) trackEndOption.disabled = kind === 'apple';
  if (kind === 'apple' && advanceSelect?.value === 'track-end') advanceSelect.value = 'manual';
  const advanceMode = advanceSelect?.value || form.dataset.advanceMode || 'manual';
  form.dataset.kind = kind;
  form.dataset.announcementSource = announcementSource;
  form.dataset.volumeMode = volumeMode;
  form.dataset.advanceMode = advanceMode;
  const musicUrl = form.querySelector('input[name="url"]');
  if (musicUrl) musicUrl.required = kind !== 'announcement';
  for (const field of form.querySelectorAll('[data-show-schedule-kind]')) {
    const expected = field.dataset.showScheduleKind;
    field.hidden = expected === 'announcement' ? kind !== 'announcement' : kind === 'announcement';
  }
  for (const field of form.querySelectorAll('[data-show-announcement-source]')) {
    field.hidden = field.dataset.showAnnouncementSource !== announcementSource;
  }
  for (const field of form.querySelectorAll('[data-show-volume-mode]')) {
    field.hidden = field.dataset.showVolumeMode !== volumeMode;
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
  if (busy) {
    setFeedback('Finish the current action before opening another page.', false);
    return;
  }
  const execute = async () => {
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
    if (action === 'start-receiver') {
      return await runAction('Starting receiver', async () => {
        const lease = await runtime.start({ takeover: button.dataset.takeover === 'true', takeoverTarget });
        takeoverTarget = null;
        return lease;
      });
    }
    if (action === 'stop-receiver') return await runAction('Stopping receiver', () => runtime.stop());
    if (action === 'provider') return await runAction('Changing music source', () => setProvider(button.dataset.provider));
    if (action === 'transport') return await runAction('Sending music command', () => sendTransport(button.dataset.command));
    if (action === 'saved-announcement' || action === 'safety-announcement') {
      const item = store.state.announcements.find(entry => entry.id === button.dataset.id);
      if (!item) throw new Error('Saved announcement was not found.');
      const text = safetyAnnouncementText(item.id, item.text, store.state.config);
      return await runAction('Sending announcement', () => runtime.sendCommand(action === 'safety-announcement' ? 'announce-safety' : 'announce', {
        text,
        label: item.label,
        volumePercent: audibleVoiceTarget(store.state)
      }, `${item.label} sent to receiver.`));
    }
    if (action === 'weather-check') return await runAction('Sending weather check', () => runtime.sendCommand('weather-check', { announce: true, label: 'Manual weather check' }, 'Weather check sent to receiver.'));
    if (action === 'calibration') {
      return await runAction(`Running ${store.state.config.musicLevel}/${audibleVoiceTarget()} sound check`, () => runtime.runCalibration());
    }
    if (action === 'connect-apple') {
      if (role !== 'receiver' || !runtime.isOwner()) throw new Error('Start this device as the live Speaker Receiver before connecting Apple Music.');
      if (!apple.playerPrepared) {
        return await runAction('Preparing Apple Music', async () => {
          const restored = await apple.restoreAuthorization();
          if (!restored) throw new Error('Apple Music authorization could not be restored. Authorize Apple Music again.');
          setFeedback('Apple Music is prepared. Tap Connect Apple Music Receiver once more to activate audio.', true);
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
    if (action === 'apple-login') {
      if (role !== 'receiver') throw new Error('Authorize Apple Music only on the Speaker Receiver.');
      return await runAction('Authorizing Apple Music', () => apple.beginLogin());
    }
    if (action === 'apple-logout') {
      return await runAction('Removing Apple Music login', async () => {
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
      return await runAction('Adding schedule item', () => store.mutate(draft => {
        const schedule = (draft.schedules || []).find(entry => entry.id === scheduleId);
        if (!schedule) throw new Error('The selected schedule no longer exists.');
        if ((schedule.items || []).length >= 100) throw new Error('A schedule can contain up to 100 items.');
        const nextOrder = (schedule.items || []).length + 1;
        schedule.items ||= [];
        schedule.items.push({
          id: makeId('schedule-item'),
          label: 'New Schedule Item',
          enabled: false,
          days: [0, 1, 2, 3, 4, 5, 6],
          position: { time: '12:00', order: nextOrder },
          action: { kind: 'announcement', announcementSource: 'inline', announcementId: '', text: '', url: '' },
          volume: { mode: 'global', percent: clamp(draft.config.voiceLevel, 0, 100, VOICE_LEVEL_PERCENT) },
          advance: { mode: 'complete', durationSeconds: 300 }
        });
        resetScheduleSequence(draft, scheduleId);
        return draft;
      }, 'Schedule item added'));
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
  if (!draggedScheduleItemId || event.pointerType === 'mouse') return;
  commitScheduleReorder(draggedScheduleItemId, draggedScheduleTargetId);
});

root.addEventListener('pointercancel', clearScheduleDragState);

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
  if (formIdentity(form)) form.dataset.dirty = 'true';
  const itemSlider = event.target.closest?.('.itemVolumeSlider');
  if (itemSlider) {
    const output = itemSlider.parentElement?.querySelector('output');
    if (output) {
      output.value = `${itemSlider.value}%`;
      output.textContent = `${itemSlider.value}%`;
    }
    return;
  }
  const voiceSlider = event.target.closest?.('#voiceLevel');
  if (voiceSlider) {
    const target = clamp(voiceSlider.value, 0, 100, VOICE_LEVEL_PERCENT);
    voiceLevelDraft = target;
    audio.setVoiceLevelPercent?.(target, { report: false });
    voiceSlider.style.setProperty('--level', target / 100);
    voiceSlider.setAttribute('aria-valuetext', `${target}% announcement voice`);
    const output = root.querySelector('[data-voice-level-output]');
    if (output) {
      output.value = `${target}%`;
      output.textContent = `${target}%`;
    }
    return;
  }
  const slider = event.target.closest?.('#musicLevel');
  if (!slider) return;
  const target = clamp(slider.value, 0, 100, 30);
  musicLevelDraft = target;
  if (customPlaybackMusicTarget(store.state) === null) {
    audio.setMusicLevelPercent(target, { report: false });
    apple.setTargetVolumePercent(target);
  }
  slider.style.setProperty('--level', target / 100);
  slider.setAttribute('aria-valuetext', `${target}% music; announcements ${audibleVoiceTarget()}%`);
  const output = root.querySelector('[data-music-level-output]');
  if (output) {
    output.value = `${target}%`;
    output.textContent = `${target}%`;
  }
});

root.addEventListener('change', event => {
  const form = event.target.closest?.('form[data-form]');
  if (formIdentity(form)) form.dataset.dirty = 'true';
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
  if (event.target.matches?.('[data-schedule-kind], [data-announcement-source], [data-volume-mode], [data-advance-mode]')) {
    updateScheduleFormVisibility(form);
    return;
  }
  const voiceSlider = event.target.closest?.('#voiceLevel');
  if (voiceSlider) {
    const target = clamp(voiceSlider.value, 0, 100, VOICE_LEVEL_PERCENT);
    voiceLevelDraft = target;
    queueVoiceLevelSave(target);
    return;
  }
  const slider = event.target.closest?.('#musicLevel');
  if (!slider) return;
  const target = clamp(slider.value, 0, 100, 30);
  musicLevelDraft = target;
  queueMusicLevelSave(target);
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
      return await runAction('Starting Apple Music', async () => {
        await store.mutate(draft => {
          draft.config.musicProvider = 'apple';
          draft.config.appleUrl = url;
          return draft;
        }, 'Apple Music source saved');
        await runtime.sendCommand('play-apple', { url, label: 'Apple Music', volumePercent: store.state.config.musicLevel, volumeMode: 'global' }, 'Apple Music play sent to receiver.');
      });
    }
    if (kind === 'announce') {
      const text = String(data.get('text') || '').trim();
      await runAction('Sending announcement', () => runtime.sendCommand('announce', {
        text,
        label: 'Speak Now',
        volumePercent: audibleVoiceTarget(store.state)
      }, 'Speak Now sent to receiver.'));
      form.reset();
      return;
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
      return await runAction('Saving announcement', () => store.mutate(draft => {
        const index = draft.announcements.findIndex(item => item.id === id);
        if (index < 0) throw new Error('Saved announcement no longer exists.');
        draft.announcements[index] = {
          ...draft.announcements[index],
          label: String(data.get('label') || '').trim().slice(0, 80),
          text: String(data.get('text') || '').trim().slice(0, 900)
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
      const actionKind = ['announcement', 'controlled', 'apple'].includes(String(data.get('kind'))) ? String(data.get('kind')) : 'announcement';
      const announcementSource = data.get('announcementSource') === 'inline' ? 'inline' : 'saved';
      const inlineText = String(data.get('text') || '').trim();
      const itemUrl = String(data.get('url') || '').trim();
      const label = String(data.get('label') || '').trim();
      const scheduleSnapshot = (store.state.schedules || []).find(item => item.id === scheduleId);
      const selectedDays = [...new Set(data.getAll('days').map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];
      if (!label) throw new Error('Give this schedule item a name before saving.');
      if (scheduleSnapshot?.mode === 'time' && selectedDays.length === 0) throw new Error('Choose at least one day for this Time schedule item. To stop it, turn off Item is active.');
      if (actionKind === 'announcement' && announcementSource === 'inline' && !inlineText) throw new Error('Type the custom announcement before saving this item.');
      if (actionKind !== 'announcement' && !itemUrl) throw new Error('Add the Apple Music, Suno, or direct audio URL for this music item.');
      if (actionKind === 'apple' && itemUrl && !isAppleMusicUrl(itemUrl)) throw new Error('Use a valid Apple Music playlist, album, artist, or track URL for this item.');
      const playAfterSave = submitIntent === 'play';
      return await runAction(playAfterSave ? 'Saving and playing schedule item' : 'Saving schedule item', async () => {
        await store.mutate(draft => {
        const schedule = (draft.schedules || []).find(item => item.id === scheduleId);
        const index = schedule?.items?.findIndex(item => item.id === id) ?? -1;
        if (index < 0) throw new Error('Schedule item no longer exists.');
        const existing = schedule.items[index];
        const targetOrder = clamp(data.get('order') || existing.position?.order || index + 1, 1, 100, index + 1);
        const volumeMode = data.get('volumeMode') === 'custom' ? 'custom' : 'global';
      const advanceMode = ['complete', 'track-end', 'duration', 'manual'].includes(String(data.get('advanceMode')))
          ? String(data.get('advanceMode'))
          : (actionKind === 'announcement' ? 'complete' : 'manual');
        if (actionKind === 'apple' && advanceMode === 'track-end') throw new Error('Apple Music cannot provide a schedule-safe track-end event. Choose Manual, Duration, or Immediately after start.');
        schedule.items[index] = {
          ...existing,
          label: label.slice(0, 100),
          enabled: data.get('enabled') === 'on',
          days: schedule.mode === 'time' ? selectedDays : existing.days,
          position: {
            time: String(data.get('time') || existing.position?.time || '12:00'),
            order: targetOrder
          },
          action: {
            kind: actionKind,
            announcementSource,
            announcementId: String(data.get('announcementId') || ''),
            text: announcementSource === 'inline' ? inlineText.slice(0, 900) : '',
            url: itemUrl.slice(0, 2000)
          },
          volume: {
            mode: volumeMode,
            percent: clamp(
              data.get('volumePercent'),
              0,
              100,
              actionKind === 'announcement' ? draft.config.voiceLevel : draft.config.musicLevel
            )
          },
          advance: {
            mode: actionKind === 'announcement' ? 'complete' : advanceMode,
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

window.addEventListener('pagehide', () => {
  if (role === 'command') apple.disconnect();
});

bootstrap();
