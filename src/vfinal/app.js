import {
  DEFAULT_ANNOUNCEMENTS,
  DEFAULT_SPOTIFY_PLAYLIST,
  VOICE_LEVEL_PERCENT,
  VERSION,
  audioPolicy,
  clamp,
  isSpotifyUrl,
  makeId,
  makeLog,
  receiverOnline,
  safetyAnnouncementText
} from './core.js';
import { AudioEngine, isIOSLike } from './audio-engine.js';
import { CloudStore, loginSession, logoutSession, sessionStatus } from './cloud.js';
import { SpotifyReceiver } from './spotify-receiver.js';
import { ReceiverRuntime } from './receiver-runtime.js';

const root = document.getElementById('app');
const ROLE_KEY = 'poolside-pulse-vfinal-role';
const TAB_KEY = 'poolside-pulse-vfinal-tab';

let authenticated = false;
let authChecked = false;
let role = localStorage.getItem(ROLE_KEY) || '';
let activeTab = localStorage.getItem(TAB_KEY) || 'control';
let feedback = { message: 'Starting Poolside Pulse vFinal...', ok: true };
let busy = false;
let takeoverTarget = null;
let renderQueued = false;
let renderQueuedForce = false;
let actionSettled = Promise.resolve();
let settleCurrentAction = null;
let queuedMusicLevel = null;
let musicLevelDrain = null;
let roleChangePending = false;
let pendingTab = '';

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

function shortcutRunUrl(name) {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(String(name || ''))}`;
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
    if (!shouldForce && focusedEditor()) {
      updateLiveStatus();
      return;
    }
    render();
  });
}

const store = new CloudStore({
  onState: state => {
    spotify.clientId = String(state.config.spotifyClientId || spotify.clientId);
    audio.setMusicLevelPercent?.(state.config.musicLevel, { report: false });
    spotify.setTargetVolumePercent?.(state.config.musicLevel);
    if (takeoverTarget && (!receiverOnline(state.receiver, store.now()) || state.receiver?.id !== takeoverTarget.id || state.receiver?.sessionId !== takeoverTarget.sessionId)) {
      takeoverTarget = null;
    }
    if (runtime?.active && !runtime.isOwner()) {
      runtime.failSafeStop('Another receiver session took ownership. Audio stopped on this device.').catch(() => {});
    }
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
      runtime.nextMusic({ automatic: true, expectedUrl: state.url }).catch(error => setFeedback(`Next track failed: ${error.message}`, false));
    }
  }
});

const spotify = new SpotifyReceiver({
  clientId: store.state.config.spotifyClientId,
  onStatus: status => setFeedback(status.message, status.ok),
  onState: () => renderWhenIdle()
});

audio.setMusicLevelPercent(store.state.config.musicLevel, { report: false });
spotify.setTargetVolumePercent(store.state.config.musicLevel);

const runtime = new ReceiverRuntime({
  store,
  audio,
  spotify,
  onStatus: status => setFeedback(status.message, status.ok),
  onChange: () => renderWhenIdle()
});

function effectiveProvider() {
  return store.state.playback.intent === 'stopped'
    ? store.state.config.musicProvider
    : (store.state.playback.provider || store.state.config.musicProvider);
}

function cloudSpotifyVerified() {
  const playback = store.state.playback;
  const target = clamp(store.state.config.musicLevel, 0, 100, 30);
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
  const musicPercent = clamp(store.state.config.musicLevel, 0, 100, 30);
  if (provider === 'spotify' && cloudSpotifyVerified()) {
    return audioPolicy({ provider: 'spotify', isIOS: false, supportsVolume: true, volumeVerified: true, verifiedPercent: musicPercent, musicPercent });
  }
  return audioPolicy({
    provider,
    isIOS: isIOSLike(),
    supportsVolume: !!spotify.supportsVolume,
    volumeVerified: !!spotify.volumeVerified,
    verifiedPercent: spotify.verifiedPercent,
    musicPercent
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

async function bootstrapAuthenticatedApp() {
  await store.load();
  spotify.clientId = String(store.state.config.spotifyClientId || spotify.clientId);
  try {
    if (new URLSearchParams(location.search).has('code')) await spotify.completeLoginFromCallback();
  } catch (error) {
    setFeedback(error.message, false);
  }
  const requestedRole = location.hash === '#receiver' ? 'receiver' : location.hash === '#command' ? 'command' : '';
  if (requestedRole) await setRole(requestedRole, { silent: true });
  if (role === 'command') spotify.disconnect();
  if (spotify.loggedIn()) spotify.preparePlayer().catch(() => {});
  store.startPolling(2_500);
  render();
}

async function bootstrap() {
  document.documentElement.dataset.poolsideVersion = VERSION;
  document.title = 'Lake123 - Poolside Pulse - vFinal';
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
        <p>Starting the vFinal receiver and command system...</p>
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
        <p class="kicker">Poolside Pulse vFinal</p>
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
        <div class="truthNote"><strong>vFinal rule:</strong> only the Speaker Receiver can produce sound. Remote devices never become Spotify players.</div>
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
      <span class="statusPill mix">${policy.exact ? `${policy.musicPercent}% / 100%` : `Spotify ${store.state.config.musicLevel}%?`}</span>
    </div>`;
}

function renderHeader() {
  return `
    <header class="appHeader">
      <div class="brandLockup">
        <div class="brandSeal small">PP</div>
        <div><span>Lake123</span><strong>Poolside Pulse</strong><small>vFinal</small></div>
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
  return `<nav class="tabs tabs-${items.length}" aria-label="Poolside controls">${items.map(([id, label]) => `<button data-action="tab" data-tab="${id}" class="${activeTab === id ? 'active' : ''}" ${activeTab === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`;
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
  if (!online) return '<strong>No receiver online</strong><span>Open vFinal on the speaker device and tap Start Receiver.</span>';
  return `<strong>${escapeHtml(receiver.name || 'Speaker Receiver')}</strong><span>${escapeHtml(receiver.detail || 'Ready')} · seen ${escapeHtml(relativeTime(receiver.lastSeen))}</span>`;
}

function playbackCard() {
  const playback = store.state.playback;
  const playing = playback.intent === 'playing';
  const paused = playback.intent === 'paused';
  const provider = playback.provider === 'spotify' ? 'Spotify' : 'Suno / Direct';
  const spotifyVerified = cloudSpotifyVerified();
  const localSpotifyLabel = playback.provider === 'spotify' && runtime.isOwner() && spotify.current?.name
    ? `${spotify.current.name}${spotify.current.artists ? ` - ${spotify.current.artists}` : ''}`
    : '';
  return `
    <section class="nowPlaying ${playing ? 'playing' : ''}">
      <div class="nowMark" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="nowText">
        <p class="kicker">${playing ? 'Now playing' : playback.intent === 'paused' ? 'Paused' : 'Ready'}</p>
        <h2>${escapeHtml(localSpotifyLabel || playback.label || 'Nothing playing')}</h2>
        <p>${escapeHtml(provider)} · ${playback.provider === 'spotify' ? (spotifyVerified ? `receiver-verified at ${store.state.config.musicLevel}%` : `pause-for-voice mode; ${store.state.config.musicLevel}% target unverified`) : `music bus set to ${store.state.config.musicLevel}%`}</p>
      </div>
      <div class="transport" aria-label="Playback controls">
        <button data-action="transport" data-command="${paused ? 'resume-music' : 'pause-music'}" class="secondary" title="${paused ? 'Resume' : 'Pause'}" ${!playing && !paused ? 'disabled' : ''}>${paused ? 'Resume' : 'Pause'}</button>
        <button data-action="transport" data-command="next-music" class="secondary" title="Next track">Next</button>
        <button data-action="transport" data-command="stop-music" class="danger" title="Stop">Stop</button>
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
  const readiness = [
    ['Cloud commands', store.syncMode === 'kv', store.syncMode === 'kv' ? 'Durable KV connected' : `Current mode: ${store.syncMode}`],
    ['Audio mixer', owned && audioStatus.unlocked, owned ? `${store.state.config.musicLevel}/100 mixer unlocked` : 'Tap Start Receiver'],
    ['Receiver lease', owned, owned ? 'This is the only active sound owner' : online ? `${receiver.name || 'Receiver'} owns sound` : 'No active receiver'],
    ['Weather scan', Number(store.state.weather.checkedAt || 0) > 0, store.state.weather.checkedAt ? `Last check ${relativeTime(store.state.weather.checkedAt)}` : 'Runs after receiver starts'],
    ['Screen awake', !!runtime.wakeLock, runtime.wakeLock ? 'Wake lock active' : 'Keep this page visible and device plugged in']
  ];
  return `
    <section class="receiverHero ${owned ? 'ready' : ''}">
      <div class="receiverCopy">
        <p class="kicker">Speaker receiver</p>
        <h1>${owned ? 'Receiver is live' : other ? 'Another receiver is live' : 'Start the speaker'}</h1>
        <p>${escapeHtml(owned ? policy.detail : other ? `${receiver.name || 'Another device'} is currently controlling speaker audio.` : 'One tap unlocks audio, starts a fresh command session, and ignores every older queued command.')}</p>
        <div class="receiverActions">
          ${owned
              ? `<button data-action="stop-receiver" class="danger">Stop Receiver</button><button data-action="calibration" class="secondary">Run ${store.state.config.musicLevel}/100 Sound Check</button>`
            : takeoverTarget
              ? `<button data-action="start-receiver" data-takeover="true" class="danger heroButton">Confirm Take Over Receiver</button>`
              : `<button data-action="start-receiver" class="primary heroButton">${other ? 'Review Receiver Takeover' : 'Start Receiver'}</button>`}
          ${owned && spotify.loggedIn()
            ? spotify.playerPrepared
              ? `<button data-action="connect-spotify" class="spotifyButton">${spotify.ready ? 'Spotify Receiver Connected' : 'Connect Spotify Receiver'}</button>`
              : `<button data-action="prepare-spotify" class="spotifyButton" ${spotify.prepareError ? '' : 'disabled'}>${spotify.prepareError ? 'Retry Spotify Setup' : 'Preparing Spotify...'}</button>`
            : ''}
        </div>
      </div>
      <div class="mixMeter" aria-label="Audio levels">
        <div><span>Music target</span><strong>${policy.exact ? `${policy.musicPercent}%` : `${store.state.config.musicLevel}%?`}</strong><i style="--level:${policy.exact ? policy.musicPercent / 100 : store.state.config.musicLevel / 100}"></i></div>
        <div><span>Voice</span><strong>100%</strong><i style="--level:1"></i></div>
        <small>${policy.exact ? 'The receiver has verified this level. Voice remains fixed at 100%.' : 'Spotify volume is not software-verified here. It is paused before voice.'}</small>
      </div>
    </section>
    ${isIOSLike() ? `<div class="callout ${owned ? 'warning' : ''}"><strong>iPhone receiver level setup</strong><p>${owned
      ? 'Keep this page visible while the receiver is live. For the exact unattended adjustable-music/100%-voice mix, use Suno/direct; iPhone Spotify cannot switch physical volume around announcements by itself.'
      : 'For exact Suno/direct scheduling, run Volume Up, return here, then tap Start Receiver. Apple Shortcuts are manual app switches, so alternating iPhone Spotify and 100% announcements cannot be automated reliably.'}</p>${owned ? '' : `<div class="stackedActions"><a class="shortcutLink loud" href="${escapeAttr(shortcutRunUrl('Volume Up'))}">Run Volume Up · 100%</a><a class="shortcutLink" href="${escapeAttr(shortcutRunUrl('Volume Down'))}">Run Volume Down · 30%</a></div>`}</div>` : ''}
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
      <button aria-pressed="${provider === 'controlled'}" data-action="provider" data-provider="controlled" class="${provider === 'controlled' ? 'active' : ''}"><strong>Suno / Direct</strong><small>Exact ${target}/100 mix</small></button>
      <button aria-pressed="${provider === 'spotify'}" data-action="provider" data-provider="spotify" class="${provider === 'spotify' ? 'active' : ''}"><strong>Spotify</strong><small>${cloudSpotifyVerified() ? `Verified ${target}%` : `${target}% target`}</small></button>
    </div>`;
}

function musicLevelControl() {
  const target = clamp(store.state.config.musicLevel, 0, 100, 30);
  return `
    <section class="volumeControl" aria-labelledby="musicLevelLabel">
      <div class="volumeHeading"><div><p class="kicker">Shared music target</p><h2 id="musicLevelLabel">Music volume</h2></div><output for="musicLevel" data-music-level-output>${target}%</output></div>
      <input id="musicLevel" type="range" min="0" max="100" step="1" value="${target}" aria-labelledby="musicLevelLabel" aria-describedby="musicLevelHelp" aria-valuetext="${target}% music; announcements 100%" style="--level:${target / 100}" ${busy ? 'disabled' : ''} />
      <div class="volumeScale" aria-hidden="true"><span>0%</span><span>Default 30%</span><span>100%</span></div>
      <p id="musicLevelHelp">Applies immediately to Suno/direct on the receiver and to Spotify only when that exact Spotify receiver verifies volume control. Announcements stay fixed at 100%.</p>
    </section>`;
}

function musicSourceForm() {
  const config = store.state.config;
  if (config.musicProvider === 'spotify') {
    const policy = audioPolicy({ provider: 'spotify', isIOS: isIOSLike(), supportsVolume: spotify.supportsVolume, volumeVerified: spotify.volumeVerified, verifiedPercent: spotify.verifiedPercent, musicPercent: config.musicLevel });
    return `
      <form data-form="spotify-play" class="sourceForm">
        <label for="spotifyUrl">Spotify playlist, album, artist, or track</label>
        <div class="inputAction"><input id="spotifyUrl" name="url" type="url" value="${escapeAttr(config.spotifyUrl || DEFAULT_SPOTIFY_PLAYLIST)}" required /><button type="submit" class="spotifyButton">Play Spotify</button></div>
      </form>
      <div class="capabilityCard ${policy.exact ? 'verified' : 'limited'}">
        <span>${policy.exact ? 'Verified path' : 'Compatibility path'}</span>
        <strong>${escapeHtml(policy.label)}</strong>
        <p>${escapeHtml(policy.detail)}</p>
      </div>
      <div class="policyNote"><strong>Important:</strong> Poolside Pulse stops Suno before Spotify starts and pauses Spotify before every announcement. On iPhone, Spotify volume remains physical and the slider target cannot be verified. Confirm that your Spotify use has the prior written approval required for commercial streaming.</div>`;
  }
  return `
    <form data-form="controlled-play" class="sourceForm">
      <label for="musicUrl">Suno playlist, Suno song, or direct HTTPS audio URL</label>
      <div class="inputAction"><input id="musicUrl" name="url" type="url" value="${escapeAttr(config.musicUrl || '')}" placeholder="https://suno.com/playlist/..." required /><button type="submit" class="primary">Play at ${config.musicLevel}%</button></div>
    </form>
    <div class="capabilityCard verified"><span>Guaranteed path</span><strong>One calibrated mixer</strong><p>Music stays at exactly ${config.musicLevel}%. During announcements it fades to ${Math.min(6, config.musicLevel)}%, voice plays at 100%, and the same track continues afterward.</p></div>`;
}

function renderControl() {
  const online = receiverOnline(store.state.receiver, store.now());
  const policy = displayAudioPolicy(store.state.config.musicProvider);
  return `
    <section class="pageHeading"><p class="kicker">Music control</p><h1>One source. One receiver.</h1><p>Suno and Spotify are mutually exclusive. Every command targets the current receiver session; expired commands are never replayed.</p></section>
    <div class="receiverRibbon ${online ? 'online' : 'offline'}">${receiverSummary()}</div>
    ${playbackCard()}
    <section class="workspacePanel">
      ${musicLevelControl()}
      <div class="sectionHeading sourceHeading"><div><p class="kicker">Choose music</p><h2>Playback source</h2></div><span class="fixedMix">${policy.exact ? `${policy.musicPercent} / 100` : `Target ${store.state.config.musicLevel}%`}</span></div>
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
      <form data-form="announce">
        <label for="announcementText">Speak now</label>
        <textarea id="announcementText" name="text" maxlength="900" placeholder="Type the announcement exactly as guests should hear it." required></textarea>
        <div class="composerFooter"><span>AI voice with device-voice fallback · 100% voice path</span><button type="submit" class="primary">Speak Now</button></div>
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

function renderScheduleRow(item) {
  return `
    <form data-form="schedule" data-id="${escapeAttr(item.id)}" class="scheduleRow">
      <div class="scheduleTime"><label>Time<input name="time" type="time" value="${escapeAttr(item.time)}" required /></label><label class="checkLabel"><input name="enabled" type="checkbox" ${item.enabled ? 'checked' : ''} /> Active</label></div>
      <label>Label<input name="label" value="${escapeAttr(item.label)}" maxlength="100" required /></label>
      <label>Action<select name="type"><option value="announcement" ${item.type === 'announcement' ? 'selected' : ''}>Saved announcement</option><option value="controlled" ${item.type === 'controlled' ? 'selected' : ''}>Suno / direct audio</option><option value="spotify" ${item.type === 'spotify' ? 'selected' : ''}>Spotify</option></select></label>
      <label>Saved message<select name="announcementId">${announcementOptions(item.announcementId)}</select></label>
      <label>Music URL<input name="url" type="url" value="${escapeAttr(item.url || '')}" placeholder="Only needed for music actions" /></label>
      <div class="rowActions"><button type="submit" class="primary">Save</button><button type="button" data-action="play-schedule" data-id="${escapeAttr(item.id)}" class="secondary">Play Now</button><button type="button" data-action="delete-schedule" data-id="${escapeAttr(item.id)}" class="textDanger">Delete</button></div>
    </form>`;
}

function renderSchedule() {
  return `
    <section class="pageHeading"><p class="kicker">Daily schedule</p><h1>Make the day run itself.</h1><p>Announcements, Suno/direct tracks, and Spotify tracks use the same exclusive source handoff. Schedule execution belongs to the active receiver.</p></section>
    <div class="scheduleList">${store.state.schedule.map(renderScheduleRow).join('')}</div>
    <button data-action="add-schedule" class="secondary addButton">Add Scheduled Item</button>
    <div class="callout warning"><strong>Receiver requirement</strong><p>Web browsers cannot run reliably after an iPhone suspends the tab. For unattended scheduling, use an always-on Mac mini, Windows mini PC, or supported desktop receiver.</p></div>`;
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
  const spotifyPolicy = audioPolicy({ provider: 'spotify', isIOS: isIOSLike(), supportsVolume: spotify.supportsVolume, volumeVerified: spotify.volumeVerified, verifiedPercent: spotify.verifiedPercent, musicPercent: config.musicLevel });
  const roleControls = role === 'receiver' && runtime.active
    ? roleChangePending
      ? `<div class="callout warning"><strong>Stop the live receiver?</strong><p>Changing this device to Remote Control stops speaker audio and releases its receiver lease.</p><div class="stackedActions"><button data-action="set-role" data-role="command" class="danger">Confirm Stop & Change Role</button><button data-action="cancel-role-change" class="secondary">Keep Receiver Live</button></div></div>`
      : '<button data-action="request-role-change" class="secondary">Stop Receiver & Change to Remote Control</button>'
    : `<button data-action="set-role" data-role="${role === 'receiver' ? 'command' : 'receiver'}" class="secondary">Change to ${role === 'receiver' ? 'Remote Control' : 'Speaker Receiver'}</button>`;
  return `
    <section class="pageHeading"><p class="kicker">Settings & diagnostics</p><h1>Simple controls, honest status.</h1><p>Music has one shared adjustable target. Announcement voice remains fixed at 100%, and unsupported Spotify receivers are never presented as verified.</p></section>
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
        <div class="sectionHeading"><div><p class="kicker">Spotify receiver</p><h2>${spotify.loggedIn() ? 'Spotify connected' : 'Spotify not connected'}</h2></div></div>
        <div class="capabilityCard ${spotifyPolicy.exact ? 'verified' : 'limited'}"><span>${spotifyPolicy.exact ? 'Supported receiver' : 'Compatibility only'}</span><strong>${escapeHtml(spotifyPolicy.label)}</strong><p>${escapeHtml(spotifyPolicy.detail)}</p></div>
        ${role === 'receiver'
          ? `<div class="stackedActions">${spotify.loggedIn() ? `${spotify.playerPrepared ? `<button data-action="connect-spotify" class="spotifyButton">${spotify.ready ? 'Reconnect Spotify Receiver' : 'Connect Spotify Receiver'}</button>` : `<button data-action="prepare-spotify" class="spotifyButton" ${spotify.prepareError ? '' : 'disabled'}>${spotify.prepareError ? 'Retry Spotify Setup' : 'Preparing Spotify...'}</button>`}<button data-action="spotify-logout" class="secondary">Remove Spotify Login</button>` : '<button data-action="spotify-login" class="spotifyButton">Login Spotify on Receiver</button>'}</div>`
          : '<div class="callout"><strong>Login only on the speaker receiver.</strong><p>Remote devices send commands and never need Spotify credentials.</p></div>'}
      </section>
      ${isIOSLike() && role === 'receiver' ? `<section class="workspacePanel">
        <div class="sectionHeading"><div><p class="kicker">iPhone helpers</p><h2>Your Apple Shortcuts</h2></div></div>
        <p>These are manual device-volume tools. Apple opens the Shortcuts app, so Poolside Pulse does not silently call them during unattended schedule items.</p>
        <div class="stackedActions"><a class="shortcutLink" href="${escapeAttr(shortcutRunUrl('Volume Down'))}">Run Volume Down · 30%</a><a class="shortcutLink loud" href="${escapeAttr(shortcutRunUrl('Volume Up'))}">Run Volume Up · 100%</a></div>
        <div class="callout warning"><strong>Spotify on this iPhone</strong><p>Volume Down matches the slider only when its target is 30%. Suno/direct uses the slider exactly without leaving this app; iPhone Spotify remains a physical-volume compatibility path.</p></div>
      </section>` : ''}
      <section class="workspacePanel">
        <div class="sectionHeading"><div><p class="kicker">Sound verification</p><h2>Receiver sound check</h2></div></div>
        <p>Plays a ${config.musicLevel}% calibration bed, ducks it to ${Math.min(6, config.musicLevel)}%, speaks a 100% announcement, then restores the same bed.</p>
        <button data-action="calibration" class="primary" ${role !== 'receiver' || !runtime.isOwner() ? 'disabled' : ''}>Run ${config.musicLevel}/100 Sound Check</button>
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
    <footer class="appFooter"><span>Poolside Pulse vFinal</span><span>${policy.exact ? `Music ${policy.musicPercent}% · Voice 100%` : `Spotify target ${store.state.config.musicLevel}% unverified · Voice 100%`} · Weather every 2 minutes</span></footer>`;
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
    draft.controls.forEach((saved, index) => {
      const control = controls[index];
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
    const active = controls[draft.activeIndex];
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
}

function selectTab(nextTab, { discardDirty = false } = {}) {
  const requested = String(nextTab || 'control');
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
  takeoverTarget = null;
  roleChangePending = false;
  if (role === 'command') {
    spotify.disconnect();
    if (!silent) setFeedback('Remote Control mode: this device will never produce receiver audio.', true);
  } else if (!silent) {
    setFeedback('Speaker Receiver mode selected. Tap Start Receiver while connected to the speakers.', true);
  }
  renderWhenIdle(true);
}

async function setProvider(provider) {
  const target = clamp(store.state.config.musicLevel, 0, 100, 30);
  await store.mutate(draft => {
    draft.config.musicProvider = provider === 'spotify' ? 'spotify' : 'controlled';
    draft.activityLog = [makeLog('settings', 'Music source selected', draft.config.musicProvider === 'spotify' ? `Spotify ${target}% target` : `Suno/direct exact ${target}/100 mode`), ...(draft.activityLog || [])];
    return draft;
  }, 'Music source selected');
  setFeedback(provider === 'spotify' ? `Spotify selected with a ${target}% target. It will pause for announcements.` : `Suno/direct selected for guaranteed ${target}/100 mixing.`, true);
}

async function saveMusicLevel(percent) {
  const target = clamp(percent, 0, 100, 30);
  audio.setMusicLevelPercent(target, { report: false });
  spotify.setTargetVolumePercent(target);
  await store.mutate(draft => {
    draft.config.musicLevel = target;
    if (draft.playback?.provider === 'spotify') {
      draft.playback.volumeVerified = false;
      draft.playback.volumeVerifiedPercent = null;
      draft.playback.volumeVerifiedAt = 0;
    }
    draft.activityLog = [makeLog('settings', 'Music target changed', `${target}% music; 100% announcements.`), ...(draft.activityLog || [])];
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
  if (musicLevelDrain) return musicLevelDrain;
  musicLevelDrain = (async () => {
    while (queuedMusicLevel !== null) {
      const target = queuedMusicLevel;
      queuedMusicLevel = null;
      if (busy) await actionSettled;
      try {
        await runAction(`Setting music to ${target}%`, () => saveMusicLevel(target));
      } catch (error) {
        setFeedback(error.message || String(error), false);
      }
    }
  })().finally(() => {
    musicLevelDrain = null;
    if (queuedMusicLevel !== null) queueMusicLevelSave(queuedMusicLevel);
  });
  return musicLevelDrain;
}

async function sendTransport(command) {
  const labels = { 'pause-music': 'Pause sent to receiver.', 'resume-music': 'Resume sent to receiver.', 'next-music': 'Next sent to receiver.', 'stop-music': 'Stop sent to receiver.' };
  await runtime.sendCommand(command, { label: labels[command] || command }, labels[command] || 'Music command sent.');
}

async function playScheduleItem(id) {
  const item = store.state.schedule.find(entry => entry.id === id);
  if (!item) return;
  if (item.type === 'announcement') {
    const announcement = store.state.announcements.find(entry => entry.id === item.announcementId);
    if (!announcement) throw new Error('The saved announcement was not found.');
    const text = safetyAnnouncementText(announcement.id, announcement.text, store.state.config);
    await runtime.sendCommand('announce', { text, label: item.label }, `Play Now sent: ${item.label}.`);
  } else if (item.type === 'spotify') {
    await runtime.sendCommand('play-spotify', { url: item.url || store.state.config.spotifyUrl, label: item.label }, `Spotify schedule item sent: ${item.label}.`);
  } else {
    await runtime.sendCommand('play-controlled', { url: item.url || store.state.config.musicUrl, label: item.label }, `Music schedule item sent: ${item.label}.`);
  }
}

root.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
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
      return await runAction('Sending announcement', () => runtime.sendCommand(action === 'safety-announcement' ? 'announce-safety' : 'announce', { text, label: item.label }, `${item.label} sent to receiver.`));
    }
    if (action === 'weather-check') return await runAction('Sending weather check', () => runtime.sendCommand('weather-check', { announce: true, label: 'Manual weather check' }, 'Weather check sent to receiver.'));
    if (action === 'calibration') {
      return await runAction(`Running ${store.state.config.musicLevel}/100 sound check`, () => runtime.runCalibration());
    }
    if (action === 'connect-spotify') {
      return await runAction('Connecting Spotify receiver', async () => {
        await spotify.connectFromUserGesture();
        const capability = await spotify.refreshCapabilities();
        const policy = runtime.currentPolicy('spotify');
        await runtime.updateReceiverDetail(policy.detail, policy.id);
      });
    }
    if (action === 'prepare-spotify') return await runAction('Preparing Spotify receiver', () => spotify.preparePlayer());
    if (action === 'spotify-login') return await spotify.beginLogin('/?v=final#receiver');
    if (action === 'spotify-logout') {
      return await runAction('Removing Spotify login', async () => {
        const spotifyCouldBeAudible = spotify.ready || runtime.physicalProvider === 'spotify' ||
          (store.state.playback.provider === 'spotify' && store.state.playback.intent === 'playing');
        if (runtime.isOwner() && spotifyCouldBeAudible) await runtime.pauseMusic();
        else if (spotify.ready) await spotify.pauseForAnnouncement();
        spotify.clearLogin();
      });
    }
    if (action === 'add-schedule') {
      return await runAction('Adding schedule item', () => store.mutate(draft => {
        draft.schedule.push({ id: makeId('schedule'), label: 'New Scheduled Item', type: 'announcement', time: '12:00', announcementId: draft.announcements[0]?.id || 'welcome', url: '', enabled: true, days: [0, 1, 2, 3, 4, 5, 6] });
        return draft;
      }, 'Schedule item added'));
    }
    if (action === 'delete-schedule') {
      const id = String(button.dataset.id || '');
      return await runAction('Deleting schedule item', () => store.mutate(draft => {
        const index = draft.schedule.findIndex(item => item.id === id);
        if (index < 0) throw new Error('Schedule item no longer exists.');
        draft.schedule.splice(index, 1);
        return draft;
      }, 'Schedule item deleted'));
    }
    if (action === 'play-schedule') return await runAction('Playing scheduled item', () => playScheduleItem(String(button.dataset.id || '')));
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

root.addEventListener('input', event => {
  const form = event.target.closest?.('form[data-form]');
  if (formIdentity(form)) form.dataset.dirty = 'true';
  const slider = event.target.closest?.('#musicLevel');
  if (!slider) return;
  const target = clamp(slider.value, 0, 100, 30);
  slider.style.setProperty('--level', target / 100);
  slider.setAttribute('aria-valuetext', `${target}% music; announcements 100%`);
  const output = root.querySelector('[data-music-level-output]');
  if (output) {
    output.value = `${target}%`;
    output.textContent = `${target}%`;
  }
});

root.addEventListener('change', event => {
  const form = event.target.closest?.('form[data-form]');
  if (formIdentity(form)) form.dataset.dirty = 'true';
  const slider = event.target.closest?.('#musicLevel');
  if (!slider) return;
  const target = clamp(slider.value, 0, 100, 30);
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
        await runtime.sendCommand('play-controlled', { url, label: 'Suno / Direct Audio' }, `Play at ${target}% sent to receiver.`);
      });
    }
    if (kind === 'spotify-play') {
      const url = String(data.get('url') || '').trim();
      if (!isSpotifyUrl(url)) throw new Error('Paste a valid Spotify playlist, album, artist, or track URL.');
      return await runAction('Starting Spotify', async () => {
        await store.mutate(draft => {
          draft.config.musicProvider = 'spotify';
          draft.config.spotifyUrl = url;
          return draft;
        }, 'Spotify source saved');
        await runtime.sendCommand('play-spotify', { url, label: 'Spotify' }, 'Spotify play sent to receiver.');
      });
    }
    if (kind === 'announce') {
      const text = String(data.get('text') || '').trim();
      await runAction('Sending announcement', () => runtime.sendCommand('announce', { text, label: 'Speak Now' }, 'Speak Now sent to receiver.'));
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
    if (kind === 'schedule') {
      const id = String(form.dataset.id || '');
      return await runAction('Saving schedule item', () => store.mutate(draft => {
        const index = draft.schedule.findIndex(item => item.id === id);
        if (index < 0) throw new Error('Schedule item no longer exists.');
        draft.schedule[index] = {
          ...draft.schedule[index],
          label: String(data.get('label') || '').trim(),
          time: String(data.get('time') || '12:00'),
          type: String(data.get('type') || 'announcement'),
          announcementId: String(data.get('announcementId') || ''),
          url: String(data.get('url') || '').trim(),
          enabled: data.get('enabled') === 'on'
        };
        return draft;
      }, 'Schedule item saved'));
    }
  };
  execute().then(() => {
    clearDirtyForm(submittedFormKey);
    renderWhenIdle(true);
  }).catch(error => setFeedback(error.message || String(error), false));
});

window.addEventListener('pagehide', () => {
  if (role === 'command') spotify.disconnect();
});

bootstrap();
