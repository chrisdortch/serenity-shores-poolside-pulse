import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';

import { createSessionToken } from '../api/_auth.js';
import { FiniteAudioXError } from '../api/_finite-audio-x.js';
import finiteAudioXHandler, {
  createFiniteAudioXHandler
} from '../api/finite-audio-x.js';

const SESSION_SECRET = 'version-x-finite-audio-route-test-secret';
const originalEnv = {
  POOL_SIDE_SESSION_SECRET: process.env.POOL_SIDE_SESSION_SECRET,
  POOL_SIDE_PIN: process.env.POOL_SIDE_PIN,
  VERCEL: process.env.VERCEL
};

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
      'x-forwarded-for': '203.0.113.75',
      'sec-fetch-site': 'same-origin'
    },
    socket: { encrypted: true, remoteAddress: '203.0.113.75' }
  };
}

function response() {
  const chunks = [];
  const headers = new Map();
  return {
    statusCode: 200,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    end(value = '') {
      chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
    },
    raw() { return Buffer.concat(chunks); },
    json() {
      const raw = Buffer.concat(chunks).toString('utf8');
      return raw ? JSON.parse(raw) : null;
    }
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

beforeEach(() => {
  process.env.POOL_SIDE_SESSION_SECRET = SESSION_SECRET;
  process.env.POOL_SIDE_PIN = '7900';
  delete process.env.VERCEL;
  globalThis.__POOL_SIDE_API_RATE_LIMITS__ = new Map();
});

after(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('Version X Browser finite-audio route', { concurrency: false }, () => {
  test('requires Version X, an authenticated same-origin session, and POST', async () => {
    const wrongVariant = await invoke(
      finiteAudioXHandler,
      request('POST', '/api/finite-audio-x', { body: {} })
    );
    assert.equal(wrongVariant.statusCode, 400);

    const unauthenticated = await invoke(
      finiteAudioXHandler,
      request('POST', '/api/finite-audio-x?v=x', { body: {} })
    );
    assert.equal(unauthenticated.statusCode, 401);

    const wrongMethod = await invoke(
      finiteAudioXHandler,
      request('GET', '/api/finite-audio-x?v=x', { cookie: xCookie() })
    );
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(wrongMethod.getHeader('allow'), 'POST');
  });

  test('returns only the bounded loader bytes with the exact validated arguments', async () => {
    let received = null;
    const audio = Buffer.from('finite-audio-bytes');
    const handler = createFiniteAudioXHandler({
      finiteAudioLoader: async options => {
        received = options;
        return {
          buffer: audio,
          contentType: 'audio/mpeg',
          extension: 'mp3'
        };
      }
    });
    const result = await invoke(handler, request('POST', '/api/finite-audio-x?v=x', {
      cookie: xCookie(),
      body: {
        provider: 'suno',
        sourceUrl: 'https://suno.com/s/AbCd1234',
        maxDurationSeconds: 19
      }
    }));

    assert.equal(result.statusCode, 200);
    assert.deepEqual(received, {
      provider: 'suno',
      sourceUrl: 'https://suno.com/s/AbCd1234',
      maxDurationSeconds: 19
    });
    assert.deepEqual(result.raw(), audio);
    assert.equal(result.getHeader('content-type'), 'audio/mpeg');
    assert.equal(result.getHeader('content-length'), String(audio.byteLength));
    assert.equal(result.getHeader('cache-control'), 'private, no-store, max-age=0');
  });

  test('bounds request bodies and maps loader failures without leaking the source URL', async () => {
    const oversized = await invoke(
      finiteAudioXHandler,
      request('POST', '/api/finite-audio-x?v=x', {
        cookie: xCookie(),
        body: { sourceUrl: `https://audio.example/${'x'.repeat(5_000)}` }
      })
    );
    assert.equal(oversized.statusCode, 400);
    assert.match(oversized.json().error, /too large/i);

    const secretUrl = 'https://private.example.test/should-not-leak.mp3';
    const handler = createFiniteAudioXHandler({
      finiteAudioLoader: async () => {
        throw new FiniteAudioXError('invalid');
      }
    });
    const failed = await invoke(handler, request('POST', '/api/finite-audio-x?v=x', {
      cookie: xCookie(),
      body: {
        provider: 'direct',
        sourceUrl: secretUrl,
        maxDurationSeconds: 10
      }
    }));
    assert.equal(failed.statusCode, 400);
    assert.equal(failed.raw().includes(secretUrl), false);
    assert.match(failed.json().error, /source is invalid/i);
  });
});
