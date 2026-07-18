import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import {
  PUSHCUT_X_ANNOUNCEMENT_INSTALL_URL,
  PUSHCUT_X_ANNOUNCEMENT_SHORTCUT_NAME,
  PUSHCUT_X_RECEIVER_CONTRACT,
  PUSHCUT_X_RECOVERY_INSTALL_URL,
  PUSHCUT_X_RECOVERY_SHORTCUT_NAME
} from '../src/vx/pushcut-shortcuts.js';

const APP_SOURCE = readFileSync(new URL('../src/vx/app.js', import.meta.url), 'utf8');
const README_SOURCE = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const VERCEL_CONFIG = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const SHORTCUT_MANIFEST = JSON.parse(
  readFileSync(new URL('../tools/shortcuts-x/manifest.json', import.meta.url), 'utf8')
);
const PUBLIC_ORIGIN = 'https://poolside-pulse-x.vercel.app';

function headersFor(source) {
  const route = VERCEL_CONFIG.headers.find(candidate => candidate.source === source);
  assert.ok(route, `Missing Vercel headers for ${source}`);
  return Object.fromEntries(route.headers.map(header => [header.key.toLowerCase(), header.value]));
}

describe('Version X signed Shortcut installer presentation', () => {
  test('renders both canonical installer links without the old manual-edit recipe', () => {
    assert.match(APP_SOURCE, /from '\.\/pushcut-shortcuts\.js'/);
    assert.match(APP_SOURCE, /href="\$\{escapeAttr\(PUSHCUT_X_ANNOUNCEMENT_INSTALL_URL\)\}"/);
    assert.match(APP_SOURCE, /href="\$\{escapeAttr\(PUSHCUT_X_RECOVERY_INSTALL_URL\)\}"/);
    assert.match(APP_SOURCE, /Their new names preserve your existing/);
    assert.match(APP_SOURCE, /do not delete or rename the originals/);
    assert.match(APP_SOURCE, /\$\{pushcutSelectedReady \? `<div class="callout receiverShortcutSetup">/);
    assert.doesNotMatch(APP_SOURCE, /pushcutSelectedReady && !pushcutStatus\.operational/);
    assert.match(APP_SOURCE, /Safari’s Downloads arrow/);
    assert.match(APP_SOURCE, /Server → Server Actions → Shortcuts/);
    assert.match(APP_SOURCE, /import\/refresh button at the upper right/);
    assert.doesNotMatch(APP_SOURCE, /Get <code>audioUrl<\/code>/);
    assert.doesNotMatch(APP_SOURCE, /replace its fixed 30% action/);
  });

  test('documents the stable installers and explicitly preserves existing shortcuts', () => {
    for (const installUrl of [
      PUSHCUT_X_ANNOUNCEMENT_INSTALL_URL,
      PUSHCUT_X_RECOVERY_INSTALL_URL
    ]) {
      assert.ok(
        README_SOURCE.includes(`${PUBLIC_ORIGIN}${installUrl}`),
        `README must link to ${PUBLIC_ORIGIN}${installUrl}`
      );
      assert.equal(
        existsSync(new URL(`../public${installUrl}`, import.meta.url)),
        true,
        `Missing public Shortcut asset for ${installUrl}`
      );
    }
    assert.match(README_SOURCE, new RegExp(PUSHCUT_X_ANNOUNCEMENT_SHORTCUT_NAME));
    assert.match(README_SOURCE, new RegExp(PUSHCUT_X_RECOVERY_SHORTCUT_NAME));
    assert.match(README_SOURCE, /They do not overwrite \*\*Poolside Pulse Announcement\*\*, \*\*Volume Up\*\*, or \*\*Volume Down\*\*/);
    assert.match(README_SOURCE, /Keep the originals/);
  });

  test('serves each Shortcut as a non-cacheable attachment with its installed name', () => {
    for (const [installUrl, shortcutName] of [
      [PUSHCUT_X_ANNOUNCEMENT_INSTALL_URL, PUSHCUT_X_ANNOUNCEMENT_SHORTCUT_NAME],
      [PUSHCUT_X_RECOVERY_INSTALL_URL, PUSHCUT_X_RECOVERY_SHORTCUT_NAME]
    ]) {
      const headers = headersFor(installUrl);
      assert.equal(headers['content-type'], 'application/octet-stream');
      assert.equal(headers['content-disposition'], `attachment; filename="${shortcutName}.shortcut"`);
      assert.equal(headers['cache-control'], 'no-store, max-age=0, must-revalidate');
      assert.equal(headers['x-content-type-options'], 'nosniff');
    }
  });

  test('commits the exact Apple-signed, secret-free installer bytes', () => {
    assert.equal(PUSHCUT_X_RECEIVER_CONTRACT, 'poolside-pulse-x-audio-v4');
    assert.equal(SHORTCUT_MANIFEST.receiverContract, PUSHCUT_X_RECEIVER_CONTRACT);
    for (const [installUrl, expected] of [
      [PUSHCUT_X_ANNOUNCEMENT_INSTALL_URL, SHORTCUT_MANIFEST.signedFiles.announcement],
      [PUSHCUT_X_RECOVERY_INSTALL_URL, SHORTCUT_MANIFEST.signedFiles.recovery]
    ]) {
      const file = readFileSync(new URL(`../public${installUrl}`, import.meta.url));
      assert.ok(file.length > 10_000);
      assert.equal(file.subarray(0, 4).toString('ascii'), 'AEA1');
      assert.equal(createHash('sha256').update(file).digest('hex'), expected.sha256);
      const searchable = file.toString('latin1');
      for (const forbidden of [
        'api.pushcut.io',
        'PUSHCUT_API_KEY',
        'APPLE_MUSIC_PRIVATE_KEY',
        'BEGIN PRIVATE KEY'
      ]) {
        assert.equal(searchable.includes(forbidden), false, `Installer contains ${forbidden}`);
      }
    }
  });
});
