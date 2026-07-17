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

  test('Pushcut is the fallback when the Browser Receiver is offline', () => {
    assert.equal(preferredAnnouncementTransport({
      browserReceiverOnline: false,
      pushcutReady: true
    }), 'pushcut');
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
