import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';

import { createSessionToken } from '../api/_auth.js';
import { createReceiverReleaseXHandler } from '../api/receiver-release-x.js';
import stateXHandler, {
  releaseVersionXReceiverSession
} from '../api/state-x.js';

const SESSION_SECRET = 'version-x-receiver-release-session-secret-long-enough';
const MANAGED_ENV = [
  'POOL_SIDE_PIN',
  'POOL_SIDE_SESSION_SECRET',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'VERCEL'
];
const originalEnv = Object.fromEntries(MANAGED_ENV.map(name => [name, process.env[name]]));

function request(method, url, { body, cookie = '' } = {}) {
  return {
    method,
    url,
    body,
    headers: {
      host: 'poolside.test',
      origin: 'https://poolside.test',
      cookie,
      'x-forwarded-host': 'poolside.test',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.91',
      'sec-fetch-site': 'same-origin'
    },
    socket: { encrypted: true, remoteAddress: '203.0.113.91' }
  };
}

function response() {
  const chunks = [];
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    end(value = '') { chunks.push(Buffer.from(String(value))); },
    json() { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
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

async function saveReceiver({ receiverId, sessionId, expectedRevision = 0, marker = 'preserved' }) {
  const saved = await invoke(stateXHandler, request('POST', '/api/state-x?v=x', {
    cookie: xCookie(),
    body: {
      version: 'x',
      expectedRevision,
      state: {
        version: 'x',
        marker,
        config: { receiverMode: 'browser', musicLevel: 37 },
        receiver: {
          id: receiverId,
          sessionId,
          name: 'Pool iPhone',
          status: 'online',
          startedAt: 10_000,
          lastSeen: 20_000,
          leaseUntil: 60_000
        }
      }
    }
  }));
  assert.equal(saved.statusCode, 200);
  return saved.json().state;
}

function memoryReleaseHandler(releaseAt = 50_000) {
  return createReceiverReleaseXHandler({
    releaseReceiver: options => releaseVersionXReceiverSession({
      ...options,
      requireDurable: false,
      now: () => releaseAt
    })
  });
}

beforeEach(() => {
  for (const name of MANAGED_ENV) delete process.env[name];
  process.env.POOL_SIDE_PIN = '7900';
  process.env.POOL_SIDE_SESSION_SECRET = SESSION_SECRET;
  globalThis.__POOL_SIDE_API_RATE_LIMITS__ = new Map();
  globalThis.__POOL_SIDE_X_MEMORY_STATES__ = Object.create(null);
  globalThis.__POOL_SIDE_X_MEMORY_STATE_LOCKS__ = new Map();
});

after(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value == null) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('Version X receiver release handoff', () => {
  test('requires a same-origin authenticated Version X pushcut release request', async () => {
    const handler = memoryReleaseHandler();
    const unauthenticated = await invoke(handler, request('POST', '/api/receiver-release-x?v=x', {
      body: { version: 'x', receiverId: 'receiver-a', sessionId: 'session-a', mode: 'pushcut' }
    }));
    assert.equal(unauthenticated.statusCode, 401);

    const wrongMode = await invoke(handler, request('POST', '/api/receiver-release-x?v=x', {
      cookie: xCookie(),
      body: { version: 'x', receiverId: 'receiver-a', sessionId: 'session-a', mode: 'browser' }
    }));
    assert.equal(wrongMode.statusCode, 400);
    assert.match(wrongMode.json().error, /pushcut/i);

    const wrongVersion = await invoke(handler, request('POST', '/api/receiver-release-x?v=x', {
      cookie: xCookie(),
      body: { version: 'final', receiverId: 'receiver-a', sessionId: 'session-a', mode: 'pushcut' }
    }));
    assert.equal(wrongVersion.statusCode, 400);
    assert.match(wrongVersion.json().error, /version x/i);
  });

  test('atomically expires the matching lease, selects pushcut mode, and returns canonical state', async () => {
    const initial = await saveReceiver({ receiverId: 'receiver-a', sessionId: 'session-a' });
    assert.equal(initial.revision, 1);
    assert.equal(initial.config.receiverMode, 'browser');

    const released = await invoke(memoryReleaseHandler(50_000), request('POST', '/api/receiver-release-x?v=x', {
      cookie: xCookie(),
      body: {
        version: 'x',
        receiverId: 'receiver-a',
        sessionId: 'session-a',
        mode: 'pushcut'
      }
    }));
    assert.equal(released.statusCode, 200);
    const body = released.json();
    assert.equal(body.ok, true);
    assert.equal(body.released, true);
    assert.equal(body.changed, true);
    assert.equal(body.receiverMode, 'pushcut');
    assert.equal(body.revision, 2);
    assert.equal(body.state.revision, 2);
    assert.equal(body.state.marker, 'preserved');
    assert.equal(body.state.config.musicLevel, 37);
    assert.equal(body.state.config.receiverMode, 'pushcut');
    assert.equal(body.state.receiver.id, 'receiver-a');
    assert.equal(body.state.receiver.sessionId, 'session-a');
    assert.equal(body.state.receiver.status, 'offline');
    assert.equal(body.state.receiver.lastSeen, 50_000);
    assert.equal(body.state.receiver.leaseUntil, 50_000);

    const read = await invoke(stateXHandler, request('GET', '/api/state-x?v=x', { cookie: xCookie() }));
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json().state, body.state);
  });

  test('is idempotent for the same released session without consuming another revision', async () => {
    await saveReceiver({ receiverId: 'receiver-a', sessionId: 'session-a' });
    const first = await releaseVersionXReceiverSession({
      receiverId: 'receiver-a',
      sessionId: 'session-a',
      requireDurable: false,
      now: () => 50_000
    });
    const second = await releaseVersionXReceiverSession({
      receiverId: 'receiver-a',
      sessionId: 'session-a',
      requireDurable: false,
      now: () => 50_000
    });
    assert.equal(first.changed, true);
    assert.equal(first.revision, 2);
    assert.equal(second.released, true);
    assert.equal(second.changed, false);
    assert.equal(second.reason, 'already-released');
    assert.equal(second.revision, 2);
  });

  test('rejects a stale session without changing a newer receiver lease or mode', async () => {
    await saveReceiver({ receiverId: 'receiver-a', sessionId: 'session-old' });
    const newer = await saveReceiver({
      receiverId: 'receiver-a',
      sessionId: 'session-new',
      expectedRevision: 1,
      marker: 'newer-session'
    });
    assert.equal(newer.revision, 2);

    const stale = await invoke(memoryReleaseHandler(50_000), request('POST', '/api/receiver-release-x?v=x', {
      cookie: xCookie(),
      body: {
        version: 'x',
        receiverId: 'receiver-a',
        sessionId: 'session-old',
        mode: 'pushcut'
      }
    }));
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().released, false);
    assert.equal(stale.json().currentRevision, 2);

    const read = await invoke(stateXHandler, request('GET', '/api/state-x?v=x', { cookie: xCookie() }));
    const state = read.json().state;
    assert.equal(state.revision, 2);
    assert.equal(state.marker, 'newer-session');
    assert.equal(state.config.receiverMode, 'browser');
    assert.equal(state.receiver.sessionId, 'session-new');
    assert.equal(state.receiver.status, 'online');
    assert.equal(state.receiver.leaseUntil, 60_000);
  });

  test('rechecks receiver ownership after a durable CAS conflict before retrying', async () => {
    const oldState = {
      version: 'x',
      revision: 7,
      savedAt: 40_000,
      config: { receiverMode: 'browser' },
      receiver: {
        id: 'receiver-a',
        sessionId: 'session-old',
        status: 'online',
        lastSeen: 40_000,
        leaseUntil: 80_000
      }
    };
    const newerState = {
      ...oldState,
      revision: 8,
      savedAt: 41_000,
      receiver: {
        ...oldState.receiver,
        sessionId: 'session-new',
        lastSeen: 41_000,
        leaseUntil: 81_000
      }
    };
    const commands = [];
    const fetchImpl = async (_url, options) => {
      const command = JSON.parse(options.body);
      commands.push(command);
      if (command[0] === 'GET') {
        return { ok: true, async json() { return { result: JSON.stringify(oldState) }; } };
      }
      assert.equal(command[0], 'EVAL');
      return {
        ok: true,
        async json() { return { result: [0, 8, JSON.stringify(newerState)] }; }
      };
    };

    const result = await releaseVersionXReceiverSession({
      receiverId: 'receiver-a',
      sessionId: 'session-old',
      env: {
        KV_REST_API_URL: 'https://kv.example.test',
        KV_REST_API_TOKEN: 'kv-test-token'
      },
      fetchImpl,
      now: () => 50_000
    });

    assert.equal(result.matched, false);
    assert.equal(result.released, false);
    assert.equal(result.reason, 'session-mismatch');
    assert.equal(result.revision, 8);
    assert.equal(result.state.receiver.sessionId, 'session-new');
    assert.equal(result.state.receiver.status, 'online');
    assert.equal(result.state.config.receiverMode, 'browser');
    assert.deepEqual(commands.map(command => command[0]), ['GET', 'EVAL']);
  });
});
