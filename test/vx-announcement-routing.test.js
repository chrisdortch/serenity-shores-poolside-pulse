import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { preferredAnnouncementTransport } from '../src/vx/announcement-routing.js';

describe('Version X announcement receiver routing', () => {
  test('a live Browser Receiver wins even when Pushcut is configured', () => {
    assert.equal(preferredAnnouncementTransport({
      browserReceiverOnline: true,
      pushcutReady: true
    }), 'browser');
  });

  test('Pushcut is the compatibility fallback when legacy state has no receiver mode', () => {
    assert.equal(preferredAnnouncementTransport({
      browserReceiverOnline: false,
      pushcutReady: true
    }), 'pushcut');
  });

  test('legacy state without a saved receiver mode can still infer a ready Pushcut receiver', () => {
    const legacyConfig = {};
    assert.equal(Object.hasOwn(legacyConfig, 'receiverMode'), false);
    assert.equal(preferredAnnouncementTransport({
      receiverMode: legacyConfig.receiverMode,
      browserReceiverOnline: false,
      pushcutReady: true
    }), 'pushcut');
  });

  test('an explicit Pushcut handoff wins over the browser lease being released', () => {
    assert.equal(preferredAnnouncementTransport({
      receiverMode: 'pushcut',
      browserReceiverOnline: true,
      pushcutReady: true
    }), 'pushcut');
  });

  test('does not fall back to a stale browser while Pushcut mode is selected but unavailable', () => {
    assert.equal(preferredAnnouncementTransport({
      receiverMode: 'pushcut',
      browserReceiverOnline: true,
      pushcutReady: false
    }), 'unavailable');
  });

  test('does not reroute an explicit Browser selection through Pushcut while Browser is offline', () => {
    assert.equal(preferredAnnouncementTransport({
      receiverMode: 'browser',
      browserReceiverOnline: false,
      pushcutReady: true
    }), 'unavailable');
    assert.equal(preferredAnnouncementTransport({
      receiverMode: 'browser',
      browserReceiverOnline: true,
      pushcutReady: true
    }), 'browser');
  });

  test('the explicit Pushcut diagnostic bypasses the Browser Receiver', () => {
    assert.equal(preferredAnnouncementTransport({
      browserReceiverOnline: true,
      pushcutReady: true,
      forcePushcut: true
    }), 'pushcut');
  });

  test('reports unavailable when the requested receiver path is not ready', () => {
    assert.equal(preferredAnnouncementTransport(), 'unavailable');
    assert.equal(preferredAnnouncementTransport({
      browserReceiverOnline: true,
      pushcutReady: false,
      forcePushcut: true
    }), 'unavailable');
  });
});
