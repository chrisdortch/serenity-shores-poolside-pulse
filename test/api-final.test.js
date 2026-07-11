import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import {
  createSessionToken,
  readSession,
  sessionSecurityReadiness
} from '../api/_auth.js';
import sessionHandler from '../api/session.js';
import stateHandler from '../api/state.js';
import sunoHandler from '../api/suno-playlist.js';
import ttsHandler from '../api/tts.js';
import voiceHealthHandler from '../api/voice-health.js';

const SECRET = 'vfinal-test-session-secret-with-sufficient-length';

function request(method, url, { body = undefined, cookie = '', origin = 'https://poolside.test' } = {}) {
  return {
    method,
    url,
    body,
    headers: {
      host: 'poolside.test',
      origin,
      cookie,
      'x-forwarded-host': 'poolside.test',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.10',
      'sec-fetch-site': 'same-origin'
    },
    socket: { encrypted: true, remoteAddress: '203.0.113.10' }
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
    json() { return raw ? JSON.parse(raw) : null; },
    raw() { return raw; },
    headers
  };
}

async function invoke(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

function sessionCookie() {
  const token = createSessionToken();
  assert.ok(token);
  return `poolside_vfinal_session=${encodeURIComponent(token)}`;
}

before(() => {
  process.env.POOL_SIDE_SESSION_SECRET = SECRET;
  process.env.POOL_SIDE_PIN = '7900';
  delete process.env.VERCEL;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.OPENAI_API_KEY;
  globalThis.__POOL_SIDE_MEMORY_STATES__ = {};
  globalThis.__POOL_SIDE_MEMORY_STATE_LOCKS__ = new Map();
  globalThis.__POOL_SIDE_LOGIN_ATTEMPTS__ = new Map();
  globalThis.__POOL_SIDE_API_RATE_LIMITS__ = new Map();
});

describe('vFinal signed session', () => {
  test('creates a signed cookie token and rejects tampering', () => {
    const token = createSessionToken(1_800_000_000_000);
    const req = request('GET', '/api/session', { cookie: `poolside_vfinal_session=${token}` });
    assert.ok(readSession(req, 1_800_000_001_000));
    assert.ok(readSession(req, 1_800_000_000_000 + (23 * 60 * 60 * 1000)));
    assert.equal(readSession(req, 1_800_000_000_000 + (24 * 60 * 60 * 1000)), null);
    const tampered = request('GET', '/api/session', { cookie: `poolside_vfinal_session=${token.slice(0, -1)}x` });
    assert.equal(readSession(tampered, 1_800_000_001_000), null);
  });

  test('renews a session after 12 hours on status and protected API requests', async () => {
    const oldToken = createSessionToken(Date.now() - (13 * 60 * 60 * 1000));
    const cookie = `poolside_vfinal_session=${encodeURIComponent(oldToken)}`;
    const status = await invoke(sessionHandler, request('GET', '/api/session', { cookie }));
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().authenticated, true);
    assert.match(String(status.getHeader('set-cookie')), /Max-Age=86400/);
    assert.ok(status.json().expiresAt > Date.now() + (23 * 60 * 60 * 1000));

    const protectedApi = await invoke(stateHandler, request('GET', '/api/state?v=final', { cookie }));
    assert.equal(protectedApi.statusCode, 200);
    assert.match(String(protectedApi.getHeader('set-cookie')), /Max-Age=86400/);
  });

  test('requires an explicit strong PIN in production readiness', async () => {
    const originalPin = process.env.POOL_SIDE_PIN;
    const originalVercel = process.env.VERCEL;
    try {
      process.env.VERCEL = '1';
      delete process.env.POOL_SIDE_PIN;
      assert.deepEqual(sessionSecurityReadiness(), {
        ready: false,
        signingReady: true,
        pinReady: false,
        limiterReady: false,
        production: true
      });

      process.env.POOL_SIDE_PIN = 'short';
      assert.equal(sessionSecurityReadiness().ready, false);
      const unavailable = await invoke(sessionHandler, request('GET', '/api/session'));
      assert.equal(unavailable.statusCode, 503);

      process.env.POOL_SIDE_PIN = 'eight888';
      process.env.KV_REST_API_URL = 'https://kv.example.invalid';
      process.env.KV_REST_API_TOKEN = 'test-token';
      assert.equal(sessionSecurityReadiness().ready, true);
    } finally {
      if (originalPin === undefined) delete process.env.POOL_SIDE_PIN;
      else process.env.POOL_SIDE_PIN = originalPin;
      if (originalVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = originalVercel;
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
    }
  });

  test('logs in, reports status, rejects a wrong PIN, and logs out', async () => {
    const wrong = await invoke(sessionHandler, request('POST', '/api/session', { body: { pin: '0000' } }));
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.json().authenticated, false);

    const login = await invoke(sessionHandler, request('POST', '/api/session', { body: { pin: '7900' } }));
    assert.equal(login.statusCode, 200);
    const setCookie = login.getHeader('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);

    const cookie = String(setCookie).split(';')[0];
    const status = await invoke(sessionHandler, request('GET', '/api/session', { cookie }));
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().authenticated, true);

    const logout = await invoke(sessionHandler, request('DELETE', '/api/session', { cookie }));
    assert.equal(logout.statusCode, 200);
    assert.match(logout.getHeader('set-cookie'), /Max-Age=0/);
  });
});

describe('vFinal state isolation and command preservation', () => {
  test('requires auth for final state and closes the archived v23 namespace', async () => {
    const denied = await invoke(stateHandler, request('GET', '/api/state?v=final'));
    assert.equal(denied.statusCode, 401);

    const legacy = await invoke(stateHandler, request('GET', '/api/state?v=23'));
    assert.equal(legacy.statusCode, 410);
  });

  test('serializes memory writes and merges independent command events', async () => {
    globalThis.__POOL_SIDE_MEMORY_STATES__ = {};
    globalThis.__POOL_SIDE_MEMORY_STATE_LOCKS__ = new Map();
    const cookie = sessionCookie();
    const event1 = { id: 'event-1', createdAt: Date.now(), status: 'pending' };
    const first = await invoke(stateHandler, request('POST', '/api/state?v=final', {
      cookie,
      body: { version: 'final', expectedRevision: 0, state: { version: 'final', events: [event1], activityLog: [] } }
    }));
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().cloudSync, false);
    assert.equal(first.json().syncMode, 'memory');
    assert.ok(Number.isFinite(first.json().serverTime));
    assert.equal(first.json().state.revision, 1);

    const event2 = { id: 'event-2', createdAt: Date.now() + 1, status: 'pending' };
    const second = await invoke(stateHandler, request('POST', '/api/state?v=final', {
      cookie,
      body: { version: 'final', expectedRevision: 1, state: { version: 'final', events: [event2], activityLog: [] } }
    }));
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().state.revision, 2);
    assert.deepEqual(second.json().state.events.map(event => event.id), ['event-1', 'event-2']);

    const read = await invoke(stateHandler, request('GET', '/api/state?v=final', { cookie }));
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().cloudSync, false);
    assert.equal(read.json().syncMode, 'memory');
    assert.ok(Number.isFinite(read.json().serverTime));
    assert.equal(read.json().state.events.length, 2);
  });

  test('requires an expected revision for every final write', async () => {
    globalThis.__POOL_SIDE_MEMORY_STATES__ = {};
    globalThis.__POOL_SIDE_MEMORY_STATE_LOCKS__ = new Map();
    const res = await invoke(stateHandler, request('POST', '/api/state?v=final', {
      cookie: sessionCookie(),
      body: { version: 'final', state: { version: 'final', events: [], activityLog: [] } }
    }));
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /expectedRevision/);
    assert.ok(Number.isFinite(res.json().serverTime));
  });

  test('rejects stale revisions under memory serialization and supports a safe retry', async () => {
    globalThis.__POOL_SIDE_MEMORY_STATES__ = {};
    globalThis.__POOL_SIDE_MEMORY_STATE_LOCKS__ = new Map();
    const cookie = sessionCookie();
    const now = Date.now();
    const eventA = { id: 'concurrent-a', createdAt: now, status: 'pending' };
    const eventB = { id: 'concurrent-b', createdAt: now + 1, status: 'pending' };
    const post = event => invoke(stateHandler, request('POST', '/api/state?v=final', {
      cookie,
      body: {
        version: 'final',
        expectedRevision: 0,
        state: { version: 'final', events: [event], activityLog: [] }
      }
    }));

    const results = await Promise.all([post(eventA), post(eventB)]);
    assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
    const winner = results.find(result => result.statusCode === 200).json();
    const conflict = results.find(result => result.statusCode === 409).json();
    assert.equal(winner.state.revision, 1);
    assert.equal(conflict.revision, 1);
    assert.equal(conflict.currentRevision, 1);
    assert.equal(conflict.state.revision, 1);
    assert.ok(Number.isFinite(conflict.serverTime));

    const winningId = winner.state.events[0].id;
    const losingEvent = winningId === eventA.id ? eventB : eventA;
    const retry = await invoke(stateHandler, request('POST', '/api/state?v=final', {
      cookie,
      body: {
        version: 'final',
        expectedRevision: conflict.currentRevision,
        state: { version: 'final', events: [losingEvent], activityLog: [] }
      }
    }));
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.json().state.revision, 2);
    assert.deepEqual(retry.json().state.events.map(event => event.id), ['concurrent-a', 'concurrent-b']);
  });

  test('uses an atomic Redis compare-and-set and returns the authoritative winner on conflict', async () => {
    const previousFetch = globalThis.fetch;
    const previousUrl = process.env.KV_REST_API_URL;
    const previousToken = process.env.KV_REST_API_TOKEN;
    let storedRaw = null;
    const waitingGets = [];
    const commands = [];
    const kvResponse = result => new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });

    process.env.KV_REST_API_URL = 'https://kv.test.invalid';
    process.env.KV_REST_API_TOKEN = 'kv-test-token';
    globalThis.fetch = async (_url, options = {}) => {
      assert.ok(options.signal instanceof AbortSignal, 'every KV request must carry a timeout signal');
      const command = JSON.parse(options.body);
      commands.push(command);
      if (command[0] === 'GET') {
        return await new Promise(resolve => {
          waitingGets.push(resolve);
          if (waitingGets.length === 2) {
            const snapshot = storedRaw;
            for (const release of waitingGets.splice(0)) release(kvResponse(snapshot));
          }
        });
      }
      if (command[0] === 'EVAL') {
        const expectedRevision = Number(command[4]);
        const current = storedRaw ? JSON.parse(storedRaw) : null;
        const currentRevision = Number(current?.revision || 0);
        if (currentRevision !== expectedRevision) {
          return kvResponse([0, currentRevision, storedRaw || '']);
        }
        storedRaw = command[5];
        return kvResponse([1, expectedRevision + 1, storedRaw]);
      }
      throw new Error(`Unexpected KV command ${command[0]}`);
    };

    try {
      const cookie = sessionCookie();
      const now = Date.now();
      const post = id => invoke(stateHandler, request('POST', '/api/state?v=final', {
        cookie,
        body: {
          version: 'final',
          expectedRevision: 0,
          state: {
            version: 'final',
            events: [{ id, createdAt: now, status: 'pending' }],
            activityLog: []
          }
        }
      }));

      const results = await Promise.all([post('redis-a'), post('redis-b')]);
      assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
      const winner = results.find(result => result.statusCode === 200).json();
      const conflict = results.find(result => result.statusCode === 409).json();
      assert.equal(conflict.currentRevision, 1);
      assert.deepEqual(conflict.state, winner.state, 'the conflict response must contain the Redis value that won');
      assert.equal(commands.filter(command => command[0] === 'EVAL').length, 2);
      assert.equal(commands.some(command => command[0] === 'SET'), false, 'final writes must not use a separate SET');
    } finally {
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = previousUrl;
      if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = previousToken;
    }
  });
});

describe('protected media services', () => {
  test('returns direct-audio metadata without making an outbound request', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network must not be used'); };
    try {
      const res = await invoke(sunoHandler, request('GET', '/api/suno-playlist?url=https%3A%2F%2Fmedia.example%2Fpool-song.mp3', { cookie: sessionCookie() }));
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().source, 'direct-audio');
      assert.equal(res.json().tracks[0].audioUrl, 'https://media.example/pool-song.mp3');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects SSRF-shaped non-Suno page URLs before any fetch', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network must not be used'); };
    try {
      const res = await invoke(sunoHandler, request('GET', '/api/suno-playlist?url=https%3A%2F%2F127.0.0.1%2Fplaylist%2Fabcdef', { cookie: sessionCookie() }));
      assert.equal(res.statusCode, 400);
      assert.match(res.json().error, /HTTPS Suno/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('protects TTS and reports non-sensitive voice readiness', async () => {
    const denied = await invoke(ttsHandler, request('POST', '/api/tts', { body: { text: 'test' } }));
    assert.equal(denied.statusCode, 401);

    const cookie = sessionCookie();
    const missingVoice = await invoke(ttsHandler, request('POST', '/api/tts', { cookie, body: { text: 'test' } }));
    assert.equal(missingVoice.statusCode, 503);
    assert.equal(missingVoice.json().error, 'Natural voice service is not configured.');

    const health = await invoke(voiceHealthHandler, request('GET', '/api/voice-health', { cookie }));
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().version, 'final');
    assert.equal(health.json().voiceReady, false);
    assert.equal('openaiApiKeyVisibleToDeployment' in health.json(), false);
  });
});
