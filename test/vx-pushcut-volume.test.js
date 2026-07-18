import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';

import { createSessionToken } from '../api/_auth.js';
import {
  PUSHCUT_VOLUME_X_API_URL,
  PushcutVolumeXError,
  applyPushcutXMusicVolume
} from '../api/_pushcut-volume-x.js';
import { PUSHCUT_X_RECEIVER_CONTRACT } from '../api/_pushcut-x.js';
import { createPushcutVolumeXHandler } from '../api/pushcut-volume-x.js';
import { applyPushcutMusic30Now } from '../src/vx/pushcut-client.js';

const MANAGED_ENV = [
  'POOL_SIDE_PIN',
  'POOL_SIDE_SESSION_SECRET',
  'PUSHCUT_API_KEY_X',
  'PUSHCUT_RECOVERY_SHORTCUT_X',
  'PUSHCUT_SERVER_ID_X'
];
const originalEnv = Object.fromEntries(MANAGED_ENV.map(name => [name, process.env[name]]));

function request(url, cookie = '') {
  return {
    method: 'POST',
    url,
    headers: {
      host: 'poolside.test',
      origin: 'https://poolside.test',
      cookie,
      'x-forwarded-host': 'poolside.test',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.90',
      'sec-fetch-site': 'same-origin'
    },
    socket: { encrypted: true, remoteAddress: '203.0.113.90' }
  };
}

function response() {
  const chunks = [];
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    end(value = '') { chunks.push(Buffer.from(String(value))); },
    json() { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  };
}

async function invoke(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

function jsonFetchResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => String(name).toLowerCase() === 'content-type' ? 'application/json' : '' },
    async json() { return body; }
  };
}

beforeEach(() => {
  process.env.POOL_SIDE_PIN = '7900';
  process.env.POOL_SIDE_SESSION_SECRET = 'version-x-volume-session-secret-long-enough';
  process.env.PUSHCUT_API_KEY_X = 'pushcut-api-key-test';
  delete process.env.PUSHCUT_RECOVERY_SHORTCUT_X;
  delete process.env.PUSHCUT_SERVER_ID_X;
});

after(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value == null) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('Version X manual Pushcut music-volume action', () => {
  test('waits for the existing Volume Down Shortcut and returns completion without secrets', async () => {
    let sent;
    const result = await applyPushcutXMusicVolume({
      musicPercent: 100,
      now: () => 12_345,
      fetchImpl: async (url, options) => {
        sent = { url: new URL(String(url)), options, body: JSON.parse(options.body) };
        return { status: 200 };
      }
    });

    assert.equal(sent.url.origin + sent.url.pathname, PUSHCUT_VOLUME_X_API_URL);
    assert.equal(sent.url.searchParams.get('shortcut'), 'Volume Down');
    assert.equal(sent.url.searchParams.get('timeout'), '10');
    assert.equal(Object.hasOwn(sent.body, 'shortcut'), false);
    assert.equal(sent.options.headers['API-Key'], 'pushcut-api-key-test');
    const input = sent.body.input;
    assert.equal(input.version, 'x');
    assert.equal(input.action, 'recover-volume');
    assert.equal(input.receiverContract, PUSHCUT_X_RECEIVER_CONTRACT);
    assert.equal(input.musicPercent, 100);
    assert.equal(input.musicLevel, 1);
    assert.equal(input.announcementLevel, 1);
    assert.equal(input.resumeMusic, false);
    assert.deepEqual(result, {
      accepted: true,
      completed: true,
      status: 'completed',
      musicPercent: 100,
      uncertain: false
    });
    assert.equal(JSON.stringify(result).includes('pushcut-api-key-test'), false);
  });

  test('honors the recovery Shortcut override and does not invent completion for 202', async () => {
    process.env.PUSHCUT_RECOVERY_SHORTCUT_X = 'Pool Music Quiet';
    let shortcut;
    const result = await applyPushcutXMusicVolume({
      fetchImpl: async (url) => {
        shortcut = new URL(String(url)).searchParams.get('shortcut');
        return { status: 202 };
      }
    });
    assert.equal(shortcut, 'Pool Music Quiet');
    assert.equal(result.accepted, true);
    assert.equal(result.completed, false);
    assert.equal(result.status, 'accepted-uncertain');
    assert.equal(result.uncertain, true);
  });

  test('treats a provider 504 as accepted-uncertain because Pushcut may have queued it', async () => {
    const result = await applyPushcutXMusicVolume({
      musicPercent: 45,
      fetchImpl: async () => ({ status: 504 })
    });
    assert.equal(result.accepted, true);
    assert.equal(result.completed, false);
    assert.equal(result.status, 'accepted-uncertain');
    assert.equal(result.musicPercent, 45);
    assert.equal(result.uncertain, true);
  });

  test('fails closed when the Version X Pushcut key is absent', async () => {
    delete process.env.PUSHCUT_API_KEY_X;
    await assert.rejects(
      applyPushcutXMusicVolume({ fetchImpl: async () => ({ status: 200 }) }),
      error => error instanceof PushcutVolumeXError && error.code === 'notConfigured'
    );
  });

  test('endpoint requires an authenticated Version X session and returns only honest status', async () => {
    let requestedTarget;
    const handler = createPushcutVolumeXHandler({
      stateReader: async () => ({ state: { config: { musicLevel: 45 } } }),
      applyVolume: async ({ musicPercent }) => {
        requestedTarget = musicPercent;
        return { accepted: true, completed: true, status: 'completed', musicPercent };
      }
    });
    const unauthenticated = await invoke(handler, request('/api/pushcut-volume-x?v=x'));
    assert.equal(unauthenticated.statusCode, 401);

    const token = createSessionToken(Date.now(), 'x');
    const authenticated = await invoke(
      handler,
      request('/api/pushcut-volume-x?v=x', `poolside_vx_session=${encodeURIComponent(token)}`)
    );
    assert.equal(authenticated.statusCode, 200);
    const body = authenticated.json();
    assert.equal(body.accepted, true);
    assert.equal(body.completed, true);
    assert.equal(requestedTarget, 45);
    assert.equal(body.musicPercent, 45);
    assert.match(body.note, /Shortcut completed/i);
    assert.match(body.note, /did not measure/i);
    assert.equal('shortcut' in body, false);
    assert.equal('apiKey' in body, false);
  });

  test('browser client calls only the isolated endpoint and preserves accepted versus completed', async () => {
    let call;
    const result = await applyPushcutMusic30Now({
      fetchImpl: async (url, options) => {
        call = { url, options };
        return jsonFetchResponse(202, {
          ok: true,
          version: 'x',
          accepted: true,
          completed: false,
          status: 'accepted',
          musicPercent: 30
        });
      }
    });
    assert.equal(call.url, '/api/pushcut-volume-x?v=x');
    assert.equal(call.options.method, 'POST');
    assert.equal(result.accepted, true);
    assert.equal(result.completed, false);
  });
});
