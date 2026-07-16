import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';

import { createSessionToken } from '../api/_auth.js';
import {
  PUSHCUT_X_API_URL,
  PUSHCUT_X_DEFAULT_SHORTCUT,
  PushcutXError,
  dispatchPushcutXCommand,
  normalizePushcutXCommand,
  pushcutXHealth
} from '../api/_pushcut-x.js';
import pushcutXHandler from '../api/pushcut-x.js';
import {
  PushcutDispatchUncertainError,
  getPushcutAnnouncementStatus,
  sendPushcutAnnouncement
} from '../src/vx/pushcut-client.js';

const SESSION_SECRET = 'version-x-pushcut-test-session-secret-long-enough';
const MANAGED_ENV = [
  'POOL_SIDE_SESSION_SECRET',
  'POOL_SIDE_PIN',
  'PUSHCUT_API_KEY_X',
  'PUSHCUT_SHORTCUT_X',
  'PUSHCUT_ANNOUNCE_SHORTCUT_X',
  'PUSHCUT_TEST_SHORTCUT_X',
  'PUSHCUT_SERVER_ID_X',
  'VERCEL'
];
const originalEnv = Object.fromEntries(MANAGED_ENV.map(name => [name, process.env[name]]));
const originalFetch = globalThis.fetch;

function request(method, url, {
  body = undefined,
  cookie = '',
  origin = 'https://poolside.test',
  host = 'poolside.test',
  ip = '203.0.113.44',
  headers: extraHeaders = {}
} = {}) {
  return {
    method,
    url,
    body,
    headers: {
      host,
      cookie,
      origin,
      'x-forwarded-host': host,
      'x-forwarded-proto': 'https',
      'x-forwarded-for': ip,
      'sec-fetch-site': 'same-origin',
      ...extraHeaders
    },
    socket: { encrypted: true, remoteAddress: ip }
  };
}

function response() {
  let raw = '';
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    end(value = '') { raw += Buffer.isBuffer(value) ? value.toString('utf8') : String(value); },
    json() { return raw ? JSON.parse(raw) : null; }
  };
}

async function invoke(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

function xCookie() {
  const token = createSessionToken(Date.now(), 'x');
  assert.ok(token);
  return `poolside_vx_session=${encodeURIComponent(token)}`;
}

function jsonFetchResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => String(name).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : '' },
    async json() { return body; }
  };
}

beforeEach(() => {
  for (const name of MANAGED_ENV) delete process.env[name];
  process.env.POOL_SIDE_SESSION_SECRET = SESSION_SECRET;
  process.env.POOL_SIDE_PIN = '7900';
  globalThis.fetch = originalFetch;
  globalThis.__POOL_SIDE_API_RATE_LIMITS__ = new Map();
});

after(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  globalThis.fetch = originalFetch;
});

describe('Version X Pushcut command validation', { concurrency: false }, () => {
  test('converts the live browser envelope into a narrow receiver command', () => {
    const command = normalizePushcutXCommand({
      version: 'x',
      eventId: 'pushcut-live-event-0001',
      source: 'live',
      text: 'Please clear the pool deck.',
      label: 'Pool Deck',
      safety: true,
      voicePercent: 92,
      musicPercent: 35
    }, { now: () => 1_234 });

    assert.deepEqual(command, {
      schemaVersion: 1,
      version: 'x',
      action: 'announce',
      commandId: 'pushcut-live-event-0001',
      eventId: 'pushcut-live-event-0001',
      issuedAt: 1_234,
      source: 'live',
      text: 'Please clear the pool deck.',
      label: 'Pool Deck',
      safety: true,
      voicePercent: 92,
      musicPercent: 35,
      resumeMusic: true
    });
  });

  test('rejects unknown fields, long speech, and music that is not quieter than voice', () => {
    const base = {
      version: 'x',
      eventId: 'pushcut-live-event-0002',
      source: 'live',
      text: 'Test',
      label: 'Test',
      safety: false,
      voicePercent: 100,
      musicPercent: 30
    };
    assert.throws(() => normalizePushcutXCommand({ ...base, secret: 'never-forward' }), PushcutXError);
    assert.throws(() => normalizePushcutXCommand({ ...base, text: 'a'.repeat(501) }), PushcutXError);
    assert.throws(() => normalizePushcutXCommand({ ...base, voicePercent: 30, musicPercent: 30 }), PushcutXError);
  });

  test('uses the fixed shortcut name by default and never exposes the API key in health', () => {
    const health = pushcutXHealth({ PUSHCUT_API_KEY_X: 'pushcut-test-secret' });
    assert.equal(health.ready, true);
    assert.deepEqual(health.actions, { announce: true, test: true });
    assert.equal(JSON.stringify(health).includes('pushcut-test-secret'), false);
  });
});

describe('Version X Pushcut provider transport', { concurrency: false }, () => {
  test('uses only the fixed Pushcut host, API-Key header, nowait, and validated shortcut input', async () => {
    const calls = [];
    const command = normalizePushcutXCommand({ action: 'test', commandId: 'pushcut-provider-test-0001' }, { now: () => 9_876 });
    const result = await dispatchPushcutXCommand(command, {
      env: { PUSHCUT_API_KEY_X: 'pushcut-test-secret' },
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        return { status: 202 };
      }
    });

    assert.equal(calls.length, 1);
    const sentUrl = new URL(calls[0].url);
    assert.equal(`${sentUrl.origin}${sentUrl.pathname}`, PUSHCUT_X_API_URL);
    assert.equal(sentUrl.searchParams.get('timeout'), 'nowait');
    assert.equal(calls[0].options.headers['API-Key'], 'pushcut-test-secret');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.shortcut, PUSHCUT_X_DEFAULT_SHORTCUT);
    assert.equal(JSON.parse(body.input).commandId, 'pushcut-provider-test-0001');
    assert.equal(JSON.stringify(result).includes('pushcut-test-secret'), false);
  });

  test('maps provider rejection to a generic safe error', async () => {
    const command = normalizePushcutXCommand({ action: 'test', commandId: 'pushcut-provider-test-0002' });
    await assert.rejects(
      dispatchPushcutXCommand(command, {
        env: { PUSHCUT_API_KEY_X: 'pushcut-test-secret' },
        fetchImpl: async () => ({ status: 401 })
      }),
      error => error instanceof PushcutXError && error.code === 'providerRejected' && !error.message.includes('secret')
    );
  });
});

describe('Version X Pushcut route and browser adapter', { concurrency: false }, () => {
  test('requires the isolated Version X session and reports readiness without secrets', async () => {
    process.env.PUSHCUT_API_KEY_X = 'pushcut-route-secret';
    const denied = await invoke(pushcutXHandler, request('GET', '/api/pushcut-x?v=x'));
    assert.equal(denied.statusCode, 401);

    const ready = await invoke(pushcutXHandler, request('GET', '/api/pushcut-x?v=x', { cookie: xCookie() }));
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().ready, true);
    assert.equal(JSON.stringify(ready.json()).includes('pushcut-route-secret'), false);
    assert.equal(JSON.stringify(ready.json()).includes(PUSHCUT_X_DEFAULT_SHORTCUT), false);
  });

  test('accepts one same-origin announcement and forwards no unvalidated browser fields', async () => {
    process.env.PUSHCUT_API_KEY_X = 'pushcut-route-secret';
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return { status: 202 };
    };
    const eventId = 'pushcut-route-event-0001';
    const result = await invoke(pushcutXHandler, request('POST', '/api/pushcut-x?v=x', {
      cookie: xCookie(),
      headers: { 'idempotency-key': eventId },
      body: {
        version: 'x',
        eventId,
        source: 'live',
        text: 'This is a live receiver test.',
        label: 'Live Test',
        safety: false,
        voicePercent: 100,
        musicPercent: 30
      }
    }));

    assert.equal(result.statusCode, 202);
    assert.equal(result.json().accepted, true);
    assert.equal(result.json().completed, false);
    assert.equal(result.json().eventId, eventId);
    assert.equal(calls.length, 1);
    const input = JSON.parse(JSON.parse(calls[0].options.body).input);
    assert.equal(input.eventId, eventId);
    assert.equal(input.text, 'This is a live receiver test.');
    assert.equal(Object.hasOwn(input, 'secret'), false);
  });

  test('browser adapter sends a stable event once and treats a lost response as uncertain', async () => {
    const eventId = 'pushcut-browser-event-0001';
    const calls = [];
    const accepted = await sendPushcutAnnouncement({
      eventId,
      text: 'Browser adapter test.',
      label: 'Browser Test',
      voicePercent: 95,
      musicPercent: 40,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return jsonFetchResponse(202, { ok: true, accepted: true, completed: false, status: 'accepted', eventId });
      }
    });
    assert.equal(accepted.eventId, eventId);
    assert.equal(accepted.accepted, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers['Idempotency-Key'], eventId);

    await assert.rejects(
      sendPushcutAnnouncement({
        eventId: 'pushcut-browser-event-0002',
        text: 'Ambiguous request test.',
        fetchImpl: async () => { throw new Error('connection reset'); }
      }),
      error => error instanceof PushcutDispatchUncertainError && error.uncertain === true
    );
  });

  test('status lookup never redispatches and preserves the server non-receipt truth', async () => {
    let calls = 0;
    const status = await getPushcutAnnouncementStatus('pushcut-status-event-0001', {
      fetchImpl: async (url, options) => {
        calls += 1;
        assert.equal(options.method, undefined);
        assert.match(String(url), /eventId=pushcut-status-event-0001/);
        return jsonFetchResponse(200, {
          ok: true,
          eventId: 'pushcut-status-event-0001',
          status: 'unknown',
          accepted: null,
          completed: false,
          durable: false
        });
      }
    });
    assert.equal(calls, 1);
    assert.equal(status.completed, false);
    assert.equal(status.durable, false);
  });
});
