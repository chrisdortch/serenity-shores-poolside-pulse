import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const APP_SOURCE = readFileSync(new URL('../src/vx/app.js', import.meta.url), 'utf8');

function sourceBetween(start, end) {
  const startIndex = APP_SOURCE.indexOf(start);
  const endIndex = APP_SOURCE.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return APP_SOURCE.slice(startIndex, endIndex);
}

describe('Version X Pushcut UI truthfulness', () => {
  test('never treats a stale Browser policy as verified in Pushcut mode', () => {
    const policySource = sourceBetween(
      'function displayAudioPolicy',
      'function appleSetupButton'
    );

    assert.ok(
      policySource.indexOf("receiverOperatingMode() === 'pushcut'") <
        policySource.indexOf("provider === 'apple' && cloudAppleMusicVerified()"),
      'Pushcut must override any stale provider verification before it is displayed'
    );
    assert.match(policySource, /exact:\s*false/);
    assert.match(policySource, /does not report the resulting physical speaker loudness/);
  });

  test('replaces Browser now-playing state with an explicit manual native-bed card', () => {
    const playbackSource = sourceBetween(
      'function playbackCard',
      'function renderReceiver'
    );

    assert.ok(
      playbackSource.indexOf("receiverOperatingMode() === 'pushcut'") <
        playbackSource.indexOf('const playback = store.state.playback'),
      'Pushcut must return before reading stale Browser playback state'
    );
    assert.match(playbackSource, /Native music bed status is manual/);
    assert.match(playbackSource, /Remote slider sets \$\{target\}%/);
    assert.match(playbackSource, /Physical speaker loudness is not measured/);
    assert.match(playbackSource, /Browser controls unavailable/);
  });

  test('labels header, receiver meter, and footer output as unmeasured', () => {
    const shellSource = sourceBetween('function shellStatus', 'function renderHeader');
    const receiverSource = sourceBetween('function renderReceiver', 'function providerSelector');
    const appSource = sourceBetween('function renderApp', 'function formIdentity');

    assert.match(shellSource, /mode === 'pushcut'[\s\S]*Shortcut \$\{audibleMusicTarget\(state\)\} → 0 → 100 → \$\{audibleMusicTarget\(state\)\} · output unmeasured/);
    assert.match(receiverSource, /Physical loudness is not measured/);
    assert.match(appSource, /receiverOperatingMode\(\) === 'pushcut'[\s\S]*Shortcut \$\{audibleMusicTarget\(\)\} → 0 → 100 → \$\{audibleMusicTarget\(\)\} · physical output unmeasured/);
  });

  test('shows and accepts the Pushcut volume action only in Pushcut Receiver mode', () => {
    const levelSource = sourceBetween('function musicLevelControl', 'function voiceLevelControl');
    const applySource = sourceBetween(
      'async function applyReceiverMusicTargetNow',
      'async function playScheduleItem'
    );

    assert.match(
      levelSource,
      /\$\{pushcutMode && pushcutMusicVolumeReady\(\) \? `<div class="managedVolumePrompt pushcutVolumePrompt"/
    );
    assert.match(applySource, /if \(receiverOperatingMode\(\) !== 'pushcut'\)/);
    assert.match(applySource, /Apply Music Now is available only while Pushcut Receiver mode is selected/);
    assert.match(applySource, /if \(!pushcutMusicVolumeReady\(\)\)/);
  });

  test('uses physical-volume language for Apple and Spotify in Browser Receiver mode', () => {
    const scheduleSource = sourceBetween('function renderScheduleRow', 'function renderSchedule');
    const appSource = sourceBetween('function renderApp', 'function formIdentity');
    const providerSource = sourceBetween('async function setProvider', 'async function saveManagedMusicLevel');

    assert.match(
      appSource,
      /activeReceiverIsIOS\(\) && \['apple', 'spotify'\]\.includes\(effectiveProvider\(\)\)[\s\S]*physical volume unverified · Voice/
    );
    assert.doesNotMatch(scheduleSource, /Poolside Pulse Shortcut/);
    assert.match(scheduleSource, /The active Browser Receiver is an iPhone/);
    assert.match(
      providerSource,
      /const iphoneExternal = selected !== 'controlled' && !pushcutMode && activeReceiverIsIOS\(\)/
    );
    assert.match(providerSource, /pushcutMode[\s\S]*receiver Shortcut requests/);
    assert.match(providerSource, /iphoneExternal[\s\S]*selected in Browser Receiver mode[\s\S]*physical volume/);
  });
});
