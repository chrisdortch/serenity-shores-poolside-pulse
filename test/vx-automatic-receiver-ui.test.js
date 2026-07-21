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
const CSS_SOURCE = readFileSync(
  new URL('../src/vx.css', import.meta.url),
  'utf8'
);
const HTML_SOURCE = readFileSync(
  new URL('../index.html', import.meta.url),
  'utf8'
);

function sourceBetween(startMarker, endMarker, source = APP_SOURCE) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(end > start, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

describe('Version X Automatic Receiver UI and routing contract', () => {
  test('keeps all one-time setup on the speaker Receiver and removes the Pushcut foreground requirement', () => {
    const panel = sourceBetween(
      'function iphoneReceiverModePanel',
      'function updateLiveStatus'
    );

    assert.match(panel, /Automatic Receiver · background Shortcut ready/);
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
    assert.match(panel, /Remote iPhones need no setup/);
    assert.match(panel, /Use this Version X address on every phone/);
    assert.match(panel, /RECEIVER_TEST_RECEIVER_URL/);
    assert.match(panel, /RECEIVER_TEST_REMOTE_URL/);
    assert.match(panel, /separate saved version and cannot control this Receiver/);
    assert.match(panel, /Paired · complete the activation test/);
    assert.match(panel, /Verify &amp; Turn On Automatic Receiver/);
    assert.match(panel, /a Remote cannot perform those account-security taps/);
    assert.match(panel, /Apple Music: Prepare → Authorize → Activate/);
    assert.match(panel, /Spotify: Authorize → Prepare if shown → Activate/);
    assert.match(
      panel,
      /enables automation only after a signed completion/
    );
  });

  test('puts the four-action Automatic Receiver wizard first and removes legacy Pushcut controls', () => {
    const panel = sourceBetween(
      'function iphoneReceiverModePanel',
      'function updateLiveStatus'
    );
    const expectedOrder = [
      'automaticReceiverWizard',
      '<strong>Install Shortcut</strong>',
      '<strong>Pair Receiver</strong>',
      '<strong>Create Email Automation</strong>',
      '<strong>Verify &amp; Turn On</strong>'
    ];
    let previous = -1;
    for (const marker of expectedOrder) {
      const next = panel.indexOf(marker);
      assert.ok(next > previous, `${marker} must appear in wizard order`);
      previous = next;
    }

    assert.match(panel, /Resort Media Hub · Version X/);
    assert.match(panel, /Finish the four one-time steps/);
    assert.match(panel, /class="shortcutLink setupAction"/);
    assert.match(panel, /class="setupInstructions" data-persist-open="automatic-email-automation"/);
    assert.match(panel, /class="receiverDetailDisclosure" data-persist-open="receiver-browser-accounts"/);
    assert.doesNotMatch(panel, /Legacy fallback · Pushcut/);
    assert.doesNotMatch(panel, /prepare-pushcut-mode/);
  });

  test('keeps every Receiver disclosure open or closed through live polling renders', () => {
    const panel = sourceBetween(
      'function iphoneReceiverModePanel',
      'function updateLiveStatus'
    );
    const receiver = sourceBetween(
      'function renderReceiver',
      'function providerSelector'
    );
    const render = sourceBetween(
      'function render(',
      'function selectTab'
    );

    assert.match(
      panel,
      /<details class="setupInstructions" data-persist-open="automatic-email-automation">/
    );
    assert.match(
      panel,
      /<details class="receiverDetailDisclosure" data-persist-open="receiver-browser-accounts">/
    );
    assert.match(
      receiver,
      /<details class="readinessPanel receiverDiagnostics" data-persist-open="receiver-diagnostics">/
    );
    assert.match(
      render,
      /details\[open\]\[data-persist-open\]/
    );
    assert.match(
      render,
      /details\[data-persist-open="\$\{CSS\.escape\(key\)\}"\]/
    );
  });

  test('labels every Speaker Receiver as the final Resort Media Hub build', () => {
    const buildLabel = sourceBetween(
      'function receiverTestBuildLabel',
      'function renderHeader'
    );
    const header = sourceBetween('function renderHeader', 'function tabs');
    const receiver = sourceBetween('function renderReceiver', 'function providerSelector');

    assert.match(APP_SOURCE, /const RECEIVER_TEST_HOST = 'poolside-pulse-x-receiver\.vercel\.app'/);
    assert.match(APP_SOURCE, /Poolside Pulse - Resort Media Hub - Version X/);
    assert.match(buildLabel, /return 'Resort Media Hub · Version X'/);
    assert.doesNotMatch(buildLabel, /location\.hostname/);
    assert.match(header, /data-build-label="resort-media-hub"/);
    assert.match(header, /receiverTestBuildLabel\(\)/);
    assert.match(
      HTML_SOURCE,
      /<title>Lake123 - Poolside Pulse - Resort Media Hub - Version X<\/title>/
    );
    assert.match(receiver, /\$\{iphoneReceiverModePanel\(\{ owned \}\)\}/);
    assert.doesNotMatch(
      receiver,
      /isIOSLike\(\) \? iphoneReceiverModePanel/
    );
  });

  test('uses an opaque sticky nav and narrow-screen controls that cannot bleed or overflow', () => {
    const tabsRule = sourceBetween('.tabs {', '.tabs::-webkit-scrollbar', CSS_SOURCE);
    const mobileRule = sourceBetween(
      '@media (max-width: 600px) {',
      '@media (prefers-contrast: more)',
      CSS_SOURCE
    );

    assert.match(tabsRule, /position:\s*sticky/);
    assert.match(tabsRule, /top:\s*calc\(var\(--header-height\)/);
    assert.match(tabsRule, /background:\s*var\(--paper\)/);
    assert.match(tabsRule, /isolation:\s*isolate/);
    assert.doesNotMatch(tabsRule, /background:\s*rgba/);
    assert.match(mobileRule, /\.receiverModePanel \.sectionHeading/);
    assert.match(mobileRule, /grid-template-columns:\s*1fr/);
    assert.match(
      mobileRule,
      /\.receiverModePanel :is\(button, \.shortcutLink, summary\)/
    );
    assert.match(mobileRule, /min-width:\s*0/);
    assert.match(mobileRule, /max-width:\s*100%/);
    assert.match(mobileRule, /white-space:\s*normal/);
    assert.match(mobileRule, /overflow-wrap:\s*anywhere/);
  });

  test('collapses secondary diagnostics to keep the Receiver page short', () => {
    const receiver = sourceBetween('function renderReceiver', 'function providerSelector');

    assert.match(
      receiver,
      /<details class="readinessPanel receiverDiagnostics" data-persist-open="receiver-diagnostics">/
    );
    assert.match(receiver, /<strong>Receiver diagnostics<\/strong>/);
    assert.doesNotMatch(
      receiver,
      /<details class="readinessPanel receiverDiagnostics"[^>]*\sopen/
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

  test('makes Time scheduling discoverable and applies Run by changes immediately', () => {
    const schedule = sourceBetween(
      'function renderSchedule',
      'function renderSettings'
    );
    const changeHandler = sourceBetween(
      "root.addEventListener('change'",
      "root.addEventListener('submit'"
    );

    assert.match(schedule, /data-schedule-mode/);
    assert.match(schedule, /Time runs automatically in Central Time/);
    assert.match(schedule, /expand each item to set its clock time and days/i);
    assert.match(changeHandler, /const scheduleMode = event\.target\.closest\?\.\('\[data-schedule-mode\]'\)/);
    assert.match(changeHandler, /schedule\.mode = requestedMode/);
    assert.match(changeHandler, /resetScheduleSequence\(draft, schedule\.id\)/);
    assert.match(changeHandler, /Switching schedule to/);
  });

  test('offers a first-class quiet-hours Stop item without music URL or volume fields', () => {
    const scheduleItem = sourceBetween(
      'function renderScheduleRow',
      'function renderSchedule'
    );
    const visibility = sourceBetween(
      'function updateScheduleFormVisibility',
      'function clearScheduleDragState'
    );
    const submit = sourceBetween(
      "if (kind === 'schedule-item')",
      'window.addEventListener(\'pagehide\''
    );

    assert.match(scheduleItem, /option value="stop"/);
    assert.match(scheduleItem, /Quiet hours · silence output/);
    assert.match(scheduleItem, /data-show-schedule-kind="stop"/);
    assert.match(scheduleItem, /leaves the connected speakers quiet/);
    assert.match(visibility, /const stopItem = kind === 'stop'/);
    assert.match(visibility, /musicUrl\.required = kind !== 'announcement' && !stopItem/);
    assert.match(submit, /'announcement', 'controlled', 'apple', 'spotify', 'stop'/);
    assert.match(submit, /actionKind !== 'announcement' && !stopItem && !itemUrl/);
    assert.match(submit, /percent: stopItem\s*\? 0/);
    assert.match(submit, /actionKind === 'announcement' \|\| stopItem \? 'complete'/);
  });

  test('defers polling renders during native iPhone schedule controls and opens new items', () => {
    const renderGuard = sourceBetween(
      'function focusedEditor',
      'function customPlaybackMusicTarget'
    );
    const render = sourceBetween(
      'function render(',
      'function selectTab'
    );
    const addItem = sourceBetween(
      "if (action === 'add-schedule-item')",
      "if (action === 'delete-schedule-item')"
    );

    assert.match(renderGuard, /SCHEDULE_NATIVE_CONTROL_LOCK_MS/);
    assert.match(renderGuard, /details\[data-persist-open\^="schedule-"\] > summary/);
    assert.match(renderGuard, /scheduleControlInteractionActive\(\)/);
    assert.match(renderGuard, /deferredRenderPending = true/);
    assert.match(renderGuard, /focusedEditor\(\) \|\| scheduleControlInteractionActive\(\)/);
    assert.match(render, /pendingOpenScheduleItemId/);
    assert.match(render, /detail\.open = true/);
    assert.match(addItem, /const itemId = makeId\('schedule-item'\)/);
    assert.match(addItem, /pendingOpenScheduleItemId = itemId/);
    assert.match(addItem, /id: itemId/);
  });

  test('cancels or skips the next scheduled Party date and syncs before changing live music', () => {
    const target = sourceBetween(
      'function scheduleCancellationTarget',
      'function scheduleItemSkippedToday'
    );
    const row = sourceBetween(
      'function renderScheduleRow',
      'function renderSchedule'
    );
    const cancelAction = sourceBetween(
      "if (action === 'cancel-schedule-today' || action === 'restore-schedule-today')",
      "if (action === 'skip-schedule-item-today' || action === 'restore-schedule-item-today')"
    );

    assert.match(target, /offset <= 7/);
    assert.match(target, /hasRemainingItem/);
    assert.match(row, /data-date-key="\$\{escapeAttr\(skipTarget\.dateKey\)\}"/);
    assert.match(row, /\$\{skipTargetIsSkipped \? 'Restore' : 'Skip'\} \$\{escapeHtml\(skipTarget\.label\)\}/);
    assert.match(cancelAction, /dataKey|dateKey/);
    assert.match(cancelAction, /await syncCurrentEmailWakeSchedule/);
    assert.doesNotMatch(
      cancelAction,
      /automaticAnnouncementsEnabled\(\) && emailWakeOperational\(\)/,
      'an Automatic cancellation must fail closed if the durable schedule service is temporarily unhealthy'
    );
    assert.ok(
      cancelAction.indexOf('await syncCurrentEmailWakeSchedule') <
        cancelAction.indexOf("await runtime.sendCommand('play-apple'"),
      'durable cancellation must sync before any live music reset'
    );
  });

  test('describes automatic quiet-hours 0% output as background Receiver work', () => {
    const schedule = sourceBetween(
      'function renderSchedule',
      'function renderSettings'
    );

    assert.match(schedule, /quiet-hours 0% output rows use the background Automatic Receiver/);
    assert.match(schedule, /quiet-hours rows set the iPhone media output to 0%/);
    assert.match(schedule, /announcements and quiet-hours 0% output run once through the background Shortcut/);
    assert.match(schedule, /Background announcements and quiet-hours 0% output remain automatic/);
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
