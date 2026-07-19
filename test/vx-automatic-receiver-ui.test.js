import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const APP_SOURCE = readFileSync(
  new URL('../src/vx/app.js', import.meta.url),
  'utf8'
);
const README_SOURCE = readFileSync(
  new URL('../README.md', import.meta.url),
  'utf8'
);

function sourceBetween(startMarker, endMarker) {
  const start = APP_SOURCE.indexOf(startMarker);
  const end = APP_SOURCE.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(end > start, `Missing source marker: ${endMarker}`);
  return APP_SOURCE.slice(start, end);
}

describe('Version X Automatic Receiver UI and routing contract', () => {
  test('keeps all one-time setup on the speaker Receiver and removes the Pushcut foreground requirement', () => {
    const panel = sourceBetween(
      'function iphoneReceiverModePanel',
      'function updateLiveStatus'
    );

    assert.match(panel, /Automatic Receiver · no Pushcut foreground/);
    assert.match(panel, /Install \$\{EMAIL_WAKE_X_SHORTCUT_NAME\}/);
    assert.match(panel, /Safari, tap the <strong>Downloads<\/strong> arrow/);
    assert.match(panel, /Create Pairing Code/);
    assert.match(panel, /Check Pairing/);
    assert.match(panel, /receives messages in Apple Mail/);
    assert.match(panel, /Shortcuts → Automation/);
    assert.match(panel, /Set Sender to <code>\$\{escapeHtml\(wakeSender\)/);
    assert.match(panel, /Subject Contains to <code>\$\{escapeHtml\(wakeSubject\)/);
    assert.match(panel, /Run Immediately/);
    assert.match(panel, /Add Action → Run Shortcut/);
    assert.match(panel, /automaticSetupIssues/);
    assert.match(panel, /Remote iPhones need no Shortcut or Pushcut setup/);
    assert.match(panel, /Paired · run the required Receiver Test/);
    assert.match(panel, /Test &amp; Turn On Automatic Receiver/);
    assert.match(
      panel,
      /stays on Browser announcements unless the iPhone returns a signed end-to-end completion/
    );
  });

  test('fails closed until the paired Receiver passes its signed end-to-end test', () => {
    const enabledGate = sourceBetween(
      'function automaticAnnouncementsEnabled',
      'function emailWakeOperational'
    );
    const enableAction = sourceBetween(
      "if (action === 'enable-automatic-announcements')",
      "if (action === 'disable-automatic-announcements')"
    );
    const selectTransport = sourceBetween(
      'async function selectAnnouncementTransport',
      'async function setProvider'
    );

    assert.match(enabledGate, /announcementTransport === 'email-wake'/);
    assert.match(enabledGate, /automaticReceiverVerifiedPairingAt/);
    assert.match(enabledGate, /> 0/);
    assert.match(enableAction, /Required Automatic Receiver Test/);
    assert.match(enableAction, /await dispatchAutomaticAnnouncement/);
    assert.match(
      enableAction,
      /await selectAnnouncementTransport\('email-wake', \{\s*verifiedPairingAt\s*\}\)/
    );
    assert.ok(
      enableAction.indexOf('await dispatchAutomaticAnnouncement') <
        enableAction.indexOf("await selectAnnouncementTransport('email-wake'"),
      'the signed device test must finish before Automatic Receiver is enabled'
    );
    assert.match(
      selectTransport,
      /Run the signed Automatic Receiver test before enabling background announcements/
    );
    assert.match(
      selectTransport,
      /draft\.config\.automaticReceiverVerifiedPairingAt =\s*transport === 'email-wake' \? requestedVerifiedPairingAt : 0/
    );
  });

  test('lets the Receiver explicitly refresh pairing and exposes actionable server issues', () => {
    const refresh = sourceBetween(
      'async function refreshEmailWakeStatus',
      'function receiverOperatingMode'
    );
    const actions = sourceBetween(
      "if (action === 'create-email-wake-pairing')",
      "if (action === 'enable-automatic-announcements')"
    );

    assert.match(refresh, /configurationIssues: Array\.isArray\(status\.configurationIssues\)/);
    assert.match(refresh, /wakeRecipient: String\(status\.wakeRecipient/);
    assert.match(actions, /check-email-wake-pairing/);
    assert.match(actions, /await refreshEmailWakeStatus\(\)/);
    assert.match(actions, /Receiver pairing confirmed/);
  });

  test('routes live, saved, order, and weather announcements through one signed completion path', () => {
    const dispatch = sourceBetween(
      'async function dispatchAutomaticAnnouncement',
      'async function sendLiveAnnouncement'
    );
    const live = sourceBetween(
      'async function sendLiveAnnouncement',
      'async function runImmediateWeatherCheck'
    );
    const weather = sourceBetween(
      'async function runImmediateWeatherCheck',
      'function requireOnlineBrowserReceiver'
    );

    assert.match(dispatch, /sendEmailWakeAnnouncement/);
    assert.match(dispatch, /waitForEmailWakeCompletion/);
    assert.match(dispatch, /music \$\{requestedMusicTarget\}% → 0% → announcement 100% → restore/);
    assert.match(live, /if \(automaticAnnouncementsEnabled\(\)\)/);
    assert.match(live, /dispatchAutomaticAnnouncement/);
    assert.match(weather, /automaticAnnouncementsEnabled\(\)/);
    assert.match(weather, /sendLiveAnnouncement/);
  });

  test('uses the background receiver for native volume while preserving Browser music ownership', () => {
    const applyVolume = sourceBetween(
      'async function applyReceiverMusicTargetNow',
      'async function playScheduleItem'
    );
    const pageHide = sourceBetween(
      "window.addEventListener('pagehide'",
      'bootstrap();'
    );

    assert.match(applyVolume, /applyEmailWakeMusicVolume/);
    assert.match(applyVolume, /waitForEmailWakeCompletion/);
    assert.match(APP_SOURCE, /&& !automaticAnnouncementsEnabled\(\)/);
    assert.match(APP_SOURCE, /controlledBrowserGainTarget/);
    assert.match(APP_SOURCE, /shouldDelegateScheduledAnnouncements/);
    assert.match(
      pageHide,
      /if \(automaticAnnouncementsEnabled\(\) && event\.persisted === true\)/
    );
    assert.match(pageHide, /Preserve the[\s\S]*browser music lease/);
    assert.match(pageHide, /true close or navigation still releases the Receiver/);
  });

  test('applies the saved physical music target whenever a verified Automatic Receiver starts', () => {
    const receiverActions = sourceBetween(
      "if (action === 'enable-automatic-announcements')",
      "if (action === 'stop-receiver')"
    );
    assert.equal(
      receiverActions.match(
        /applyReceiverMusicTargetNow\(audibleMusicTarget\(store\.state\)\)/g
      )?.length,
      1
    );
    assert.match(
      receiverActions,
      /did not confirm its music target/
    );
  });

  test('explains that every automatic scheduled music row applies its own target before starting', () => {
    const scheduleItem = sourceBetween(
      'function renderScheduleRow',
      'function renderSchedule'
    );

    assert.match(
      scheduleItem,
      /Before each music row starts, Automatic Receiver applies its/
    );
    assert.match(scheduleItem, /\$\{itemVolume\}% custom/);
    assert.match(scheduleItem, /\$\{store\.state\.config\.musicLevel\}% shared/);
  });

  test('does not label a stale or unrenewed automatic schedule as ready', () => {
    const schedule = sourceBetween(
      'function renderSchedule',
      'function renderSettings'
    );
    const scheduleStatus = sourceBetween(
      'function setEmailWakeScheduleStatus',
      'function automaticTimedAnnouncementsDelegated'
    );

    assert.match(scheduleStatus, /maintenanceScheduled: payload\.maintenanceScheduled === true/);
    assert.match(scheduleStatus, /maintenanceScheduledFor: Number\(payload\.maintenanceScheduledFor/);
    assert.match(schedule, /const automaticScheduleReady =/);
    assert.match(schedule, /emailWakeScheduleStatus\.enabled/);
    assert.match(schedule, /emailWakeScheduleStatus\.current/);
    assert.match(schedule, /emailWakeScheduleStatus\.maintenanceScheduled/);
    assert.match(
      schedule,
      /automaticScheduleReady \? 'Automatic mixed schedule is ready'/
    );
    assert.match(schedule, /saved schedule is newer than the durable automatic announcement plan/);
    assert.match(schedule, /Automatic renewal:/);
  });

  test('awaits durable schedule sync after a Remote save and reports saved-but-unsynced failures', () => {
    const helper = sourceBetween(
      'async function ensureAutomaticScheduleSyncAfterChange',
      'function liveReceiverIsNative'
    );
    const runAction = sourceBetween(
      'async function runAction',
      'async function restoreStoredAppleAuthorization'
    );
    const saveVolume = sourceBetween(
      'async function saveMusicLevel',
      'function queueMusicLevelSave'
    );

    assert.match(helper, /role !== 'command'/);
    assert.match(helper, /!automaticAnnouncementsEnabled\(\)/);
    assert.match(helper, /await syncCurrentEmailWakeSchedule/);
    assert.match(helper, /saved, but durable automatic announcement scheduling did not update/);
    assert.match(runAction, /await ensureAutomaticScheduleSyncAfterChange/);
    assert.match(saveVolume, /await ensureAutomaticScheduleSyncAfterChange/);
  });

  test('uses one Automatic Receiver volume explanation across the policy, meter, providers, and footer', () => {
    assert.match(APP_SOURCE, /automatic-receiver-dynamic-target/);
    assert.match(APP_SOURCE, /Automatic music target/);
    assert.match(APP_SOURCE, /Automatic Receiver runs \$\{audibleTarget\}% music → 0%/);
    assert.match(APP_SOURCE, /Automatic Receiver applies Music \$\{audibleMusicTarget\(\)\}%/);
    assert.match(APP_SOURCE, /const footerMix = automaticAnnouncementsEnabled\(\)/);
  });

  test('documents the same one-time Receiver setup and permanent aliases', () => {
    assert.match(README_SOURCE, /Automatic Receiver mode — recommended/);
    assert.match(README_SOURCE, /Downloads\*\* arrow → `Poolside Pulse X Automatic Receiver\.shortcut`/);
    assert.match(README_SOURCE, /tap \*\*Check Pairing\*\*/);
    assert.match(README_SOURCE, /Choose \*\*Run Immediately\*\*/);
    assert.match(README_SOURCE, /New Blank Automation → Add Action → Run Shortcut/);
    assert.match(
      README_SOURCE,
      /APPLE_MUSIC_ALLOWED_ORIGINS=https:\/\/poolside-pulse-x\.vercel\.app,https:\/\/poolside-pulse-x-receiver\.vercel\.app/
    );
    assert.match(
      README_SOURCE,
      /PUSHCUT_PUBLIC_BASE_URL_X=https:\/\/poolside-pulse-x-receiver\.vercel\.app/
    );
    assert.match(README_SOURCE, /RESEND_API_KEY_X=/);
    assert.match(README_SOURCE, /RECEIVER_WAKE_EMAIL_X=/);
  });
});
