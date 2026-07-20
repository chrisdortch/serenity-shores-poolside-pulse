import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  verify as cryptoVerify
} from 'node:crypto';
import { after, beforeEach, describe, test } from 'node:test';

import {
  createSessionToken,
  readSession,
  sessionSecurityReadiness
} from '../api/_auth.js';
import {
  versionXStorageKey,
  versionXStorageNamespace,
  versionXStorageNamespaceReadiness
} from '../api/_version-x-namespace.js';
import appleMusicTokenHandler from '../api/apple-music-token.js';
import sessionHandler from '../api/session.js';
import stateXHandler from '../api/state-x.js';

const SESSION_SECRET = 'version-x-test-session-secret-with-sufficient-length';
const MANAGED_ENV = [
  'POOL_SIDE_SESSION_SECRET',
  'POOL_SIDE_PIN',
  'POOL_SIDE_X_NAMESPACE',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'APPLE_MUSIC_TEAM_ID',
  'APPLE_MUSIC_KEY_ID',
  'APPLE_MUSIC_PRIVATE_KEY',
  'APPLE_MUSIC_ALLOWED_ORIGINS',
  'VERCEL',
  'VERCEL_ENV',
  'OPENAI_API_KEY',
  'XWEATHER_CLIENT_SECRET'
];
const originalEnv = Object.fromEntries(MANAGED_ENV.map(name => [name, process.env[name]]));
const originalFetch = globalThis.fetch;

function request(method, url, {
  body = undefined,
  cookie = '',
  origin = 'https://poolside.test',
  host = 'poolside.test',
  ip = '203.0.113.10'
} = {}) {
  const headers = {
    host,
    cookie,
    'x-forwarded-host': host,
    'x-forwarded-proto': 'https',
    'x-forwarded-for': ip,
    'sec-fetch-site': 'same-origin'
  };
  if (origin) headers.origin = origin;
  return {
    method,
    url,
    body,
    headers,
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
    json() { return raw ? JSON.parse(raw) : null; },
    raw() { return raw; }
  };
}

async function invoke(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

function cookieFor(variant) {
  const token = createSessionToken(Date.now(), variant);
  assert.ok(token);
  const name = variant === 'x' ? 'poolside_vx_session' : 'poolside_vfinal_session';
  return `${name}=${encodeURIComponent(token)}`;
}

function decodeJwtPart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

beforeEach(() => {
  for (const name of MANAGED_ENV) delete process.env[name];
  process.env.POOL_SIDE_SESSION_SECRET = SESSION_SECRET;
  process.env.POOL_SIDE_PIN = '7900';
  globalThis.fetch = originalFetch;
  globalThis.__POOL_SIDE_LOGIN_ATTEMPTS__ = new Map();
  globalThis.__POOL_SIDE_API_RATE_LIMITS__ = new Map();
  globalThis.__POOL_SIDE_X_MEMORY_STATES__ = Object.create(null);
  globalThis.__POOL_SIDE_X_MEMORY_STATE_LOCKS__ = new Map();
  globalThis.__POOL_SIDE_MEMORY_STATES__ = { untouchedFinalSentinel: { revision: 77 } };
});

after(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  globalThis.fetch = originalFetch;
});

describe('Version X API isolation', { concurrency: false }, () => {
  test('uses an isolated cookie and signing context while preserving vFinal defaults', async () => {
    const xLogin = await invoke(sessionHandler, request('POST', '/api/session?v=x', {
      body: { pin: '7900' }
    }));
    assert.equal(xLogin.statusCode, 200);
    assert.match(String(xLogin.getHeader('set-cookie')), /^poolside_vx_session=/);
    assert.doesNotMatch(String(xLogin.getHeader('set-cookie')), /poolside_vfinal_session/);

    const xCookie = String(xLogin.getHeader('set-cookie')).split(';')[0];
    const xStatus = await invoke(sessionHandler, request('GET', '/api/session?v=x', { cookie: xCookie }));
    assert.equal(xStatus.statusCode, 200);
    assert.equal(xStatus.json().authenticated, true);

    const finalStatusWithXCookie = await invoke(sessionHandler, request('GET', '/api/session', { cookie: xCookie }));
    assert.equal(finalStatusWithXCookie.statusCode, 200);
    assert.equal(finalStatusWithXCookie.json().authenticated, false);

    const finalCookie = cookieFor('final');
    const xStatusWithFinalCookie = await invoke(sessionHandler, request('GET', '/api/session?v=x', { cookie: finalCookie }));
    assert.equal(xStatusWithFinalCookie.statusCode, 200);
    assert.equal(xStatusWithFinalCookie.json().authenticated, false);

    const finalToken = createSessionToken();
    assert.ok(readSession(request('GET', '/api/session', {
      cookie: `poolside_vfinal_session=${finalToken}`
    })));
  });

  test('isolates Version X cookies and signatures across storage namespaces', () => {
    process.env.POOL_SIDE_X_NAMESPACE = 'candidate-a';
    const tokenA = createSessionToken(Date.now(), 'x');
    assert.ok(tokenA);
    assert.ok(readSession(request('GET', '/api/session?v=x', {
      cookie: `poolside_vx_candidate-a_session=${encodeURIComponent(tokenA)}`
    })));
    const finalToken = createSessionToken(Date.now(), 'final');
    assert.ok(finalToken);

    process.env.POOL_SIDE_X_NAMESPACE = 'candidate-b';
    assert.equal(readSession(request('GET', '/api/session?v=x', {
      cookie: `poolside_vx_candidate-b_session=${encodeURIComponent(tokenA)}`
    })), null);
    assert.ok(readSession(request('GET', '/api/session', {
      cookie: `poolside_vfinal_session=${encodeURIComponent(finalToken)}`
    })));
  });

  test('validates namespaces and requires one for branch Preview storage', async () => {
    assert.equal(versionXStorageNamespace({}), '');
    assert.equal(versionXStorageKey('stable-key', {}), 'stable-key');
    assert.equal(
      versionXStorageNamespace({ POOL_SIDE_X_NAMESPACE: 'Candidate_One' }),
      'candidate_one'
    );
    assert.throws(
      () => versionXStorageNamespace({ POOL_SIDE_X_NAMESPACE: 'candidate.one' }),
      /POOL_SIDE_X_NAMESPACE/
    );
    assert.throws(
      () => versionXStorageKey('preview-key', { VERCEL_ENV: 'preview' }),
      /required for a Vercel Preview/
    );
    assert.deepEqual(
      versionXStorageNamespaceReadiness({ VERCEL_ENV: 'preview' }),
      {
        ready: false,
        required: true,
        namespace: '',
        reason: 'missing'
      }
    );

    process.env.VERCEL = '1';
    process.env.VERCEL_ENV = 'preview';
    process.env.KV_REST_API_URL = 'https://kv.test.invalid';
    process.env.KV_REST_API_TOKEN = 'test-kv-token';
    assert.equal(sessionSecurityReadiness('x').ready, false);
    assert.equal(sessionSecurityReadiness('final').ready, true);
    const unavailable = await invoke(
      sessionHandler,
      request('GET', '/api/session?v=x')
    );
    assert.equal(unavailable.statusCode, 503);

    process.env.POOL_SIDE_X_NAMESPACE = 'candidate-ready';
    assert.equal(sessionSecurityReadiness('x').ready, true);
    const ready = await invoke(
      sessionHandler,
      request('GET', '/api/session?v=x')
    );
    assert.equal(ready.statusCode, 200);

    process.env.POOL_SIDE_X_NAMESPACE = 'not valid!';
    assert.equal(sessionSecurityReadiness('x').ready, false);
    const invalid = await invoke(
      sessionHandler,
      request('GET', '/api/session?v=x')
    );
    assert.equal(invalid.statusCode, 503);
  });

  test('uses distinct durable login limiter keys for every Version X namespace', async () => {
    process.env.KV_REST_API_URL = 'https://kv.test.invalid';
    process.env.KV_REST_API_TOKEN = 'test-kv-token';
    const commands = [];
    globalThis.fetch = async (_url, options) => {
      commands.push(JSON.parse(options.body));
      return {
        ok: true,
        async json() { return { result: [1, 900] }; }
      };
    };

    const finalAttempt = await invoke(sessionHandler, request('POST', '/api/session', {
      body: { pin: '0000' }
    }));
    const xAttempt = await invoke(sessionHandler, request('POST', '/api/session?v=x', {
      body: { pin: '0000' }
    }));
    process.env.POOL_SIDE_X_NAMESPACE = 'candidate-a';
    const candidateAAttempt = await invoke(sessionHandler, request('POST', '/api/session?v=x', {
      body: { pin: '0000' }
    }));
    process.env.POOL_SIDE_X_NAMESPACE = 'candidate-b';
    const candidateBAttempt = await invoke(sessionHandler, request('POST', '/api/session?v=x', {
      body: { pin: '0000' }
    }));
    assert.equal(finalAttempt.statusCode, 401);
    assert.equal(xAttempt.statusCode, 401);
    assert.equal(candidateAAttempt.statusCode, 401);
    assert.equal(candidateBAttempt.statusCode, 401);
    assert.equal(commands.length, 4);
    assert.match(commands[0][3], /^poolside:vfinal:login:/);
    assert.match(commands[1][3], /^poolside:vx:login:/);
    assert.notEqual(commands[0][3], commands[1][3]);
    assert.equal(commands[2][3], `${commands[1][3]}:namespace:candidate-a`);
    assert.equal(commands[3][3], `${commands[1][3]}:namespace:candidate-b`);
  });

  test('stores only Version X state, enforces CAS revisions, and fixes announcements at 100%', async () => {
    const xCookie = cookieFor('x');
    const finalCookie = cookieFor('final');
    const denied = await invoke(stateXHandler, request('GET', '/api/state-x?v=x', { cookie: finalCookie }));
    assert.equal(denied.statusCode, 401);

    const now = Date.now();
    const first = await invoke(stateXHandler, request('POST', '/api/state-x?v=x', {
      cookie: xCookie,
      body: {
        version: 'x',
        expectedRevision: 0,
        state: {
          version: 'x',
          marker: 'version-x-only',
          config: {
            musicProvider: 'apple',
            musicLevel: 130,
            voiceLevel: 42,
            duckLevel: 80,
            address: 'Preserve this setting',
            appleMusicPrivateKey: 'must-not-persist'
          },
          events: [{ id: 'event-x-1', createdAt: now, status: 'pending' }],
          activityLog: []
        }
      }
    }));

    assert.equal(first.statusCode, 200);
    assert.equal(first.json().syncMode, 'memory');
    assert.equal(first.json().state.version, 'x');
    assert.equal(first.json().state.revision, 1);
    assert.equal(first.json().state.config.musicLevel, 100);
    assert.equal(first.json().state.config.voiceLevel, 100);
    assert.equal(first.json().state.config.voiceMode, 'ai');
    assert.equal(first.json().state.config.duckLevel, 0);
    assert.equal(first.json().state.config.address, 'Preserve this setting');
    assert.equal('appleMusicPrivateKey' in first.json().state.config, false);
    assert.deepEqual(globalThis.__POOL_SIDE_MEMORY_STATES__, { untouchedFinalSentinel: { revision: 77 } });
    assert.equal(Object.keys(globalThis.__POOL_SIDE_X_MEMORY_STATES__).length, 1);

    const conflict = await invoke(stateXHandler, request('POST', '/api/state-x?v=x', {
      cookie: xCookie,
      body: {
        version: 'x',
        expectedRevision: 0,
        state: { version: 'x', marker: 'stale-write' }
      }
    }));
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().currentRevision, 1);
    assert.equal(conflict.json().state.marker, 'version-x-only');

    const second = await invoke(stateXHandler, request('POST', '/api/state-x?v=x', {
      cookie: xCookie,
      body: {
        version: 'x',
        expectedRevision: 1,
        state: { version: 'x', config: { voiceLevel: 17 } }
      }
    }));
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().state.revision, 2);
    assert.equal(second.json().state.config.musicLevel, 100);
    assert.equal(second.json().state.config.voiceLevel, 100);
    assert.equal(second.json().state.marker, 'version-x-only');

    const read = await invoke(stateXHandler, request('GET', '/api/state-x?v=x', { cookie: xCookie }));
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().state.version, 'x');
    assert.equal(read.json().state.revision, 2);
  });

  test('preserves a missing legacy receiver mode until an explicit handoff mode is saved', async () => {
    const xCookie = cookieFor('x');
    const legacy = await invoke(stateXHandler, request('POST', '/api/state-x?v=x', {
      cookie: xCookie,
      body: {
        version: 'x',
        expectedRevision: 0,
        state: {
          version: 'x',
          config: { musicProvider: 'controlled', musicLevel: 30 }
        }
      }
    }));

    assert.equal(legacy.statusCode, 200);
    assert.equal(Object.hasOwn(legacy.json().state.config, 'receiverMode'), false);

    const unrelatedSave = await invoke(stateXHandler, request('POST', '/api/state-x?v=x', {
      cookie: xCookie,
      body: {
        version: 'x',
        expectedRevision: 1,
        state: { version: 'x', config: { voiceLevel: 91 } }
      }
    }));
    assert.equal(unrelatedSave.statusCode, 200);
    assert.equal(Object.hasOwn(unrelatedSave.json().state.config, 'receiverMode'), false);

    const explicit = await invoke(stateXHandler, request('POST', '/api/state-x?v=x', {
      cookie: xCookie,
      body: {
        version: 'x',
        expectedRevision: 2,
        state: { version: 'x', config: { receiverMode: 'pushcut' } }
      }
    }));
    assert.equal(explicit.statusCode, 200);
    assert.equal(explicit.json().state.config.receiverMode, 'pushcut');

    const afterExplicitSave = await invoke(stateXHandler, request('POST', '/api/state-x?v=x', {
      cookie: xCookie,
      body: {
        version: 'x',
        expectedRevision: 3,
        state: { version: 'x', config: { voiceLevel: 92 } }
      }
    }));
    assert.equal(afterExplicitSave.statusCode, 200);
    assert.equal(afterExplicitSave.json().state.config.receiverMode, 'pushcut');
  });

  test('stores Spotify as a Version X bed and derives honest announcement-source capabilities', async () => {
    const result = await invoke(stateXHandler, request('POST', '/api/state-x?v=x', {
      cookie: cookieFor('x'),
      body: {
        version: 'x',
        expectedRevision: 0,
        state: {
          version: 'x',
          config: {
            musicProvider: 'spotify',
            spotifyUrl: 'https://open.spotify.com/playlist/example',
            spotifyAccessToken: 'must-not-persist',
            spotifyRefreshToken: 'must-not-persist',
            spotifyClientSecret: 'must-not-persist',
            appleMusicPrivateKey: 'must-not-persist'
          },
          playback: {
            provider: 'spotify',
            intent: 'playing',
            spotifyAccessToken: 'must-not-persist'
          },
          receiver: {
            id: 'receiver-x',
            sessionId: 'session-x',
            status: 'online',
            spotifyStatus: 'ready',
            spotifyDetail: 'Premium receiver is active.',
            spotifyDeviceId: 'device-x',
            spotifyDeviceName: 'Pool iPhone',
            spotifyVerifiedAt: 1_234,
            spotifyAccessToken: 'must-not-persist'
          },
          announcementSources: [
            {
              id: 'natural',
              label: 'Natural voice',
              kind: 'natural-voice',
              provider: 'openai-tts',
              voice: 'marin',
              instructions: 'Speak warmly.',
              playbackSupport: 'verified',
              verification: 'verified',
              privateKey: 'must-not-persist'
            },
            {
              id: 'direct-finite',
              label: 'Direct clip',
              kind: 'media',
              provider: 'direct',
              url: 'https://media.example/pool-message.mp3',
              finite: true,
              durationSeconds: 12,
              verification: 'verified'
            },
            {
              id: 'suno-finite',
              label: 'Suno clip',
              kind: 'media',
              provider: 'suno',
              url: 'https://suno.com/s/example',
              finite: true,
              durationSeconds: 30
            },
            {
              id: 'finite-kind-direct',
              label: 'Finite-kind direct clip',
              kind: 'finite-audio',
              provider: 'direct',
              url: 'https://media.example/finite-kind.mp3',
              finite: true,
              durationSeconds: 14
            },
            {
              id: 'apple-catalog',
              label: 'Apple catalog item',
              kind: 'media',
              provider: 'apple',
              url: 'https://music.apple.com/us/song/example/123',
              finite: true,
              playbackSupport: 'supported',
              verification: 'verified'
            },
            {
              id: 'spotify-catalog',
              label: 'Spotify catalog item',
              kind: 'media',
              provider: 'spotify',
              url: 'https://open.spotify.com/track/example',
              finite: true,
              playbackSupport: 'supported',
              verification: 'verified'
            },
            {
              id: 'direct-stream',
              label: 'Unbounded stream',
              kind: 'media',
              provider: 'direct',
              url: 'https://media.example/live',
              finite: false,
              durationSeconds: 20
            },
            {
              id: 'direct-too-long',
              label: 'Long clip',
              kind: 'media',
              provider: 'direct',
              url: 'https://media.example/long.mp3',
              finite: true,
              durationSeconds: 46
            },
            {
              id: 'unknown-source',
              kind: 'media',
              provider: 'unknown',
              url: 'https://media.example/unknown.mp3',
              finite: true
            }
          ],
          announcements: [{
            id: 'catalog-message',
            label: 'Catalog message',
            text: 'Fallback spoken text.',
            sourceId: 'spotify-catalog'
          }],
          schedules: [{
            id: 'provider-schedule',
            name: 'Provider schedule',
            mode: 'time',
            enabled: true,
            items: [
              {
                id: 'spotify-bed',
                label: 'Spotify bed',
                type: 'spotify',
                position: { time: '09:00', order: 1 },
                action: {
                  kind: 'spotify',
                  url: 'https://open.spotify.com/playlist/example'
                },
                volume: { mode: 'custom', percent: 30 },
                advance: { mode: 'track-end', durationSeconds: 300 }
              },
              {
                id: 'suno-bed',
                label: 'Suno bed',
                type: 'suno',
                position: { time: '09:30', order: 2 },
                action: {
                  kind: 'suno',
                  url: 'https://suno.com/s/example'
                },
                volume: { mode: 'global', percent: 30 },
                advance: { mode: 'manual', durationSeconds: 300 }
              },
              {
                id: 'quiet-hours',
                label: 'Quiet hours',
                type: 'quiet-hours',
                position: { time: '22:00', order: 3 },
                action: {
                  kind: 'quiet-hours',
                  url: 'https://must-not-survive.example/music',
                  announcementId: 'must-not-survive',
                  text: 'must not survive'
                },
                volume: { mode: 'custom', percent: 82 },
                advance: { mode: 'manual', durationSeconds: 999 }
              },
              {
                id: 'catalog-announcement',
                label: 'Experimental catalog announcement',
                type: 'announcement',
                position: { time: '10:00', order: 3 },
                action: {
                  kind: 'announcement',
                  announcementSource: 'saved',
                  announcementId: 'catalog-message',
                  sourceId: 'spotify-catalog'
                }
              }
            ]
          }],
          activeScheduleId: 'provider-schedule'
        }
      }
    }));

    assert.equal(result.statusCode, 200);
    const state = result.json().state;
    assert.equal(state.config.musicProvider, 'spotify');
    assert.equal(state.config.spotifyUrl, 'https://open.spotify.com/playlist/example');
    for (const key of ['spotifyAccessToken', 'spotifyRefreshToken', 'spotifyClientSecret', 'appleMusicPrivateKey']) {
      assert.equal(key in state.config, false);
    }
    assert.equal(state.playback.provider, 'spotify');
    assert.equal('spotifyAccessToken' in state.playback, false);
    assert.equal(state.receiver.spotifyStatus, 'ready');
    assert.equal(state.receiver.spotifyDeviceId, 'device-x');
    assert.equal(state.receiver.spotifyVerifiedAt, 1_234);
    assert.equal('spotifyAccessToken' in state.receiver, false);

    const sources = Object.fromEntries(state.announcementSources.map(source => [source.id, source]));
    assert.equal(Object.hasOwn(sources, 'unknown-source'), false);
    assert.deepEqual(
      ['natural', 'direct-finite', 'suno-finite', 'finite-kind-direct'].map(id => [
        sources[id].playbackSupport,
        sources[id].verification
      ]),
      [
        ['supported', 'unverified'],
        ['supported', 'unverified'],
        ['supported', 'unverified'],
        ['supported', 'unverified']
      ]
    );
    assert.equal(sources.natural.privateKey, undefined);
    assert.equal(sources['direct-finite'].durationSeconds, 12);
    assert.equal(sources['suno-finite'].durationSeconds, 30);
    assert.equal(sources['finite-kind-direct'].durationSeconds, 14);
    assert.equal(sources['apple-catalog'].playbackSupport, 'experimental');
    assert.equal(sources['apple-catalog'].verification, 'unverified');
    assert.match(sources['apple-catalog'].note, /unverified on iPhone/i);
    assert.equal(sources['spotify-catalog'].playbackSupport, 'experimental');
    assert.equal(sources['spotify-catalog'].verification, 'unverified');
    assert.equal(sources['direct-stream'].playbackSupport, 'unsupported');
    assert.equal(sources['direct-stream'].verification, 'unverified');
    assert.equal(sources['direct-too-long'].durationSeconds, 0);
    assert.equal(sources['direct-too-long'].playbackSupport, 'unsupported');

    const announcement = state.announcements.find(item => item.id === 'catalog-message');
    assert.equal(announcement.sourceId, 'spotify-catalog');
    const schedule = state.schedules.find(item => item.id === 'provider-schedule');
    const spotifyBed = schedule.items.find(item => item.id === 'spotify-bed');
    assert.equal(spotifyBed.type, 'spotify');
    assert.equal(spotifyBed.action.kind, 'spotify');
    assert.equal(spotifyBed.volume.percent, 30);
    assert.equal(spotifyBed.advance.mode, 'track-end');
    assert.equal('announcementSource' in spotifyBed.action, false);
    const sunoBed = schedule.items.find(item => item.id === 'suno-bed');
    assert.equal(sunoBed.type, 'controlled');
    assert.equal(sunoBed.action.kind, 'controlled');
    const quietHours = schedule.items.find(item => item.id === 'quiet-hours');
    assert.equal(quietHours.type, 'stop');
    assert.deepEqual(quietHours.action, { kind: 'stop' });
    assert.deepEqual(quietHours.volume, { mode: 'global', percent: 0 });
    assert.deepEqual(quietHours.advance, { mode: 'complete', durationSeconds: 300 });
    assert.equal(quietHours.url, '');
    assert.equal(quietHours.announcementId, '');
    const catalogAnnouncement = schedule.items.find(item => item.id === 'catalog-announcement');
    assert.equal(catalogAnnouncement.action.sourceId, 'spotify-catalog');
    assert.equal(state.schedule.find(item => item.id === 'spotify-bed').type, 'spotify');
    assert.deepEqual(globalThis.__POOL_SIDE_MEMORY_STATES__, { untouchedFinalSentinel: { revision: 77 } });
    assert.equal(Object.keys(globalThis.__POOL_SIDE_X_MEMORY_STATES__).length, 1);

    const reread = await invoke(stateXHandler, request('GET', '/api/state-x?v=x', {
      cookie: cookieFor('x')
    }));
    assert.equal(reread.statusCode, 200);
    assert.equal(reread.json().state.config.musicProvider, 'spotify');
    assert.equal(
      reread.json().state.announcementSources.find(source => source.id === 'spotify-catalog').verification,
      'unverified'
    );
    assert.equal(
      reread.json().state.schedules[0].items.find(item => item.id === 'spotify-bed').action.kind,
      'spotify'
    );
  });

  test('uses the isolated Version X KV key for GET and compare-and-set only', async () => {
    process.env.KV_REST_API_URL = 'https://kv.test.invalid';
    process.env.KV_REST_API_TOKEN = 'test-kv-token';
    const commands = [];
    globalThis.fetch = async (_url, options) => {
      const command = JSON.parse(options.body);
      commands.push(command);
      return {
        ok: true,
        async json() {
          if (command[0] === 'GET') return { result: null };
          return { result: [1, 1] };
        }
      };
    };

    const result = await invoke(stateXHandler, request('POST', '/api/state-x?v=x', {
      cookie: cookieFor('x'),
      body: {
        version: 'x',
        expectedRevision: 0,
        state: { version: 'x', config: { musicLevel: 31, voiceLevel: 67 } }
      }
    }));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(commands.map(command => command[0]), ['GET', 'EVAL']);
    const keys = commands.map(command => command[0] === 'GET' ? command[1] : command[3]);
    assert.equal(new Set(keys).size, 1);
    assert.match(keys[0], /vx-20260714$/);
    assert.doesNotMatch(keys[0], /vfinal|final/i);
    assert.equal(JSON.stringify(commands).includes('serenity-shores-poolside-radio-vfinal'), false);
  });

  test('issues a short-lived, origin-scoped ES256 Apple Music token without key leakage', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    process.env.APPLE_MUSIC_TEAM_ID = 'TEAMID1234';
    process.env.APPLE_MUSIC_KEY_ID = 'KEYID12345';
    process.env.APPLE_MUSIC_PRIVATE_KEY = privatePem.replace(/\n/g, '\\n');
    process.env.APPLE_MUSIC_ALLOWED_ORIGINS = 'https://poolside.test, https://preview.poolside.test';

    const result = await invoke(appleMusicTokenHandler, request('GET', '/api/apple-music-token?v=x', {
      cookie: cookieFor('x')
    }));
    assert.equal(result.statusCode, 200);
    assert.equal(result.getHeader('cache-control'), 'no-store, max-age=0');
    assert.equal(result.raw().includes('BEGIN PRIVATE KEY'), false);
    assert.equal(result.raw().includes(privatePem), false);

    const parts = result.json().token.split('.');
    assert.equal(parts.length, 3);
    const jwtHeader = decodeJwtPart(parts[0]);
    const payload = decodeJwtPart(parts[1]);
    assert.deepEqual(jwtHeader, { alg: 'ES256', kid: 'KEYID12345' });
    assert.equal(payload.iss, 'TEAMID1234');
    assert.deepEqual(payload.origin, ['https://poolside.test']);
    assert.ok(payload.exp > payload.iat);
    assert.ok(payload.exp - payload.iat <= (15 * 60) + 5);
    assert.ok(result.json().expiresAt > Date.now());

    const verified = cryptoVerify(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(parts[2], 'base64url')
    );
    assert.equal(verified, true);

    const finalCookieDenied = await invoke(appleMusicTokenHandler, request('GET', '/api/apple-music-token?v=x', {
      cookie: cookieFor('final')
    }));
    assert.equal(finalCookieDenied.statusCode, 401);
    assert.equal('token' in finalCookieDenied.json(), false);

    const disallowed = await invoke(appleMusicTokenHandler, request('GET', '/api/apple-music-token?v=x', {
      cookie: cookieFor('x'),
      origin: 'https://unapproved.test',
      host: 'unapproved.test'
    }));
    assert.equal(disallowed.statusCode, 403);
    assert.equal('token' in disallowed.json(), false);
  });
});
