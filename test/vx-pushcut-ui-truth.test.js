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
    assert.match(policySource, /physical output unmeasured/);
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
    assert.match(playbackSource, /Shortcut target 30\/100 · physical output unmeasured/);
    assert.match(playbackSource, /Browser controls unavailable/);
  });

  test('labels header, receiver meter, and footer output as unmeasured', () => {
    const shellSource = sourceBetween('function shellStatus', 'function renderHeader');
    const receiverSource = sourceBetween('function renderReceiver', 'function providerSelector');
    const appSource = sourceBetween('function renderApp', 'function formIdentity');

    assert.match(shellSource, /mode === 'pushcut'[\s\S]*Shortcut target 30\/100 · output unmeasured/);
    assert.match(receiverSource, /physical loudness and native playback status are not measured/);
    assert.match(appSource, /receiverOperatingMode\(\) === 'pushcut'[\s\S]*Shortcut target 30\/100 · physical output unmeasured/);
  });
});
