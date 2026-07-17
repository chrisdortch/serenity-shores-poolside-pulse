import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { after, beforeEach, describe, test } from 'node:test';

import { createSessionToken } from '../api/_auth.js';
import {
  PUSHCUT_X_API_URL,
  PUSHCUT_X_DEFAULT_SHORTCUT,
  PUSHCUT_X_DEVICES_URL,
  PushcutXError,
  dispatchPushcutXCommand,
  inspectPushcutXServerHealth,
  normalizePushcutXCommand,
  pushcutXHealth
} from '../api/_pushcut-x.js';
import {
  claimPushcutXDispatch,
  createPushcutXReceipt,
  PushcutXReceiptError,
  readPushcutXReceipt,
  updatePushcutXReceipt
} from '../api/_pushcut-receipts-x.js';
import {
  FiniteAudioXError,
  loadFiniteAnnouncementAudio,
  normalizeFiniteAudioReference,
  resolveFiniteAudioReference
} from '../api/_finite-audio-x.js';
import {
  createPushcutXCapability,
  createSignedPushcutXUrl,
  verifyPushcutXCapability
} from '../api/_pushcut-security-x.js';
import {
  generateNaturalSpeech,
  NATURAL_SPEECH_MAX_AUDIO_BYTES,
  NaturalSpeechError
} from '../api/_tts.js';
import pushcutAudioXHandler, { createPushcutAudioXHandler } from '../api/pushcut-audio-x.js';
import pushcutReceiptXHandler from '../api/pushcut-receipt-x.js';
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
  'OPENAI_API_KEY',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'PUSHCUT_API_KEY_X',
  'PUSHCUT_SHORTCUT_X',
  'PUSHCUT_ANNOUNCE_SHORTCUT_X',
  'PUSHCUT_TEST_SHORTCUT_X',
  'PUSHCUT_RECOVERY_SHORTCUT_X',
  'PUSHCUT_SERVER_ID_X',
  'PUSHCUT_PUBLIC_BASE_URL_X',
  'VERCEL',
  'VERCEL_URL'
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

function jsonFetchResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => String(name).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : '' },
    async json() { return body; }
  };
}

function pcmWav(seconds = 1, sampleRate = 8_000) {
  const dataBytes = Math.max(1, Math.round(seconds * sampleRate));
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  buffer.fill(128, 44);
  return buffer;
}

beforeEach(() => {
  for (const name of MANAGED_ENV) delete process.env[name];
  process.env.POOL_SIDE_SESSION_SECRET = SESSION_SECRET;
  process.env.POOL_SIDE_PIN = '7900';
  globalThis.fetch = originalFetch;
  globalThis.__POOL_SIDE_API_RATE_LIMITS__ = new Map();
  globalThis.__POOL_SIDE_X_PUSHCUT_RECEIPTS__ = new Map();
  globalThis.__POOL_SIDE_X_PUSHCUT_RECEIPT_LOCKS__ = new Map();
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
      announcementMode: 'natural-voice',
      announcementProvider: '',
      announcementAudioUrl: '',
      announcementDurationSeconds: 0,
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

  test('accepts only finite direct files or exact Suno song/share references', () => {
    const base = {
      version: 'x',
      eventId: 'pushcut-finite-validation-0001',
      source: 'live',
      text: 'Finite pool announcement.',
      label: 'Finite',
      safety: false,
      voicePercent: 100,
      musicPercent: 30,
      announcementMode: 'finite-audio',
      announcementDurationSeconds: 12
    };
    const direct = normalizePushcutXCommand({
      ...base,
      announcementProvider: 'direct',
      announcementAudioUrl: 'https://media.example/audio/pool-message.mp3?token=private'
    });
    assert.equal(direct.announcementMode, 'finite-audio');
    assert.equal(direct.announcementProvider, 'direct');
    assert.equal(direct.announcementDurationSeconds, 12);
    assert.equal(direct.announcementAudioUrl, 'https://media.example/audio/pool-message.mp3?token=private');

    const suno = normalizePushcutXCommand({
      ...base,
      eventId: 'pushcut-finite-validation-0002',
      announcementProvider: 'suno',
      announcementAudioUrl: 'https://suno.com/song/exact-song-id'
    });
    assert.equal(suno.announcementProvider, 'suno');

    for (const invalidSource of [
      { announcementProvider: 'direct', announcementAudioUrl: 'http://media.example/message.mp3' },
      { announcementProvider: 'direct', announcementAudioUrl: 'https://media.example/message.html' },
      { announcementProvider: 'direct', announcementAudioUrl: 'https://[::ffff:7f00:1]/message.mp3' },
      { announcementProvider: 'suno', announcementAudioUrl: 'https://suno.com/playlist/ambiguous-list' },
      { announcementProvider: 'spotify', announcementAudioUrl: 'https://open.spotify.com/track/example' },
      { announcementProvider: 'apple', announcementAudioUrl: 'https://music.apple.com/us/song/example' }
    ]) {
      assert.throws(() => normalizePushcutXCommand({
        ...base,
        eventId: `pushcut-invalid-${invalidSource.announcementProvider}`,
        ...invalidSource
      }), PushcutXError);
    }
    assert.throws(() => normalizePushcutXCommand({
      ...base,
      announcementProvider: 'direct',
      announcementAudioUrl: 'https://media.example/message.mp3',
      announcementDurationSeconds: 46
    }), PushcutXError);
    const { announcementDurationSeconds: _missingDuration, ...missingDuration } = base;
    assert.throws(() => normalizePushcutXCommand({
      ...missingDuration,
      announcementProvider: 'direct',
      announcementAudioUrl: 'https://media.example/message.mp3'
    }), PushcutXError);
  });

  test('uses the fixed shortcut name by default and never exposes the API key in health', () => {
    const health = pushcutXHealth({ PUSHCUT_API_KEY_X: 'pushcut-test-secret' });
    assert.equal(health.ready, true);
    assert.deepEqual(health.actions, { announce: true, test: true });
    assert.equal(JSON.stringify(health).includes('pushcut-test-secret'), false);
  });
});

describe('Version X Pushcut provider transport', { concurrency: false }, () => {
  test('waits for the receiver test and queues a sequential volume recovery', async () => {
    const calls = [];
    const command = normalizePushcutXCommand({ action: 'test', commandId: 'pushcut-provider-test-0001' }, { now: () => 9_876 });
    const result = await dispatchPushcutXCommand(command, {
      env: { PUSHCUT_API_KEY_X: 'pushcut-test-secret' },
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        return { status: calls.length === 1 ? 200 : 202 };
      },
      now: () => 10_000
    });

    assert.equal(calls.length, 2);
    const sentUrl = new URL(calls[0].url);
    assert.equal(`${sentUrl.origin}${sentUrl.pathname}`, PUSHCUT_X_API_URL);
    assert.equal(sentUrl.searchParams.get('timeout'), '10');
    assert.equal(calls[0].options.headers['API-Key'], 'pushcut-test-secret');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.shortcut, PUSHCUT_X_DEFAULT_SHORTCUT);
    assert.equal(JSON.parse(body.input).commandId, 'pushcut-provider-test-0001');
    const recoveryUrl = new URL(calls[1].url);
    assert.equal(recoveryUrl.searchParams.get('timeout'), 'nowait');
    const recoveryBody = JSON.parse(calls[1].options.body);
    assert.equal(recoveryBody.shortcut, 'Volume Down');
    assert.equal(JSON.parse(recoveryBody.input).action, 'recover-volume');
    assert.equal(result.completed, true);
    assert.equal(result.recoveryQueued, true);
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

  test('reports connected automation-server state without exposing device metadata', async () => {
    const health = await inspectPushcutXServerHealth({
      env: {
        PUSHCUT_API_KEY_X: 'pushcut-test-secret',
        PUSHCUT_SERVER_ID_X: 'receiver-device-id'
      },
      fetchImpl: async (url, options) => {
        assert.equal(String(url), PUSHCUT_X_DEVICES_URL);
        assert.equal(options.headers['API-Key'], 'pushcut-test-secret');
        return jsonFetchResponse(200, {
          devices: [{
            id: 'receiver-device-id',
            deviceName: 'Private Receiver Name',
            isAutomationServer: true,
            isConnectedAutomationServer: true
          }]
        });
      }
    });
    assert.deepEqual(health, {
      configured: true,
      providerReachable: true,
      connected: true,
      deviceCount: 1,
      serverMatched: true
    });
    assert.equal(JSON.stringify(health).includes('receiver-device-id'), false);
    assert.equal(JSON.stringify(health).includes('Private Receiver Name'), false);
  });
});

describe('Version X signed natural-audio delivery receipts', { concurrency: false }, () => {
  test('capabilities reject tampering and expiry', () => {
    const now = 1_700_000_000_000;
    const capability = createPushcutXCapability('pushcut-capability-event-0001', 'receipt', {
      env: { POOL_SIDE_SESSION_SECRET: SESSION_SECRET },
      now: () => now,
      ttlSeconds: 60
    });
    assert.ok(capability);
    assert.equal(verifyPushcutXCapability(capability, 'receipt', {
      env: { POOL_SIDE_SESSION_SECRET: SESSION_SECRET },
      now: () => now
    }), true);
    assert.equal(verifyPushcutXCapability({
      ...capability,
      signature: `${capability.signature.slice(0, -1)}x`
    }, 'receipt', {
      env: { POOL_SIDE_SESSION_SECRET: SESSION_SECRET },
      now: () => now
    }), false);
    assert.equal(verifyPushcutXCapability(capability, 'receipt', {
      env: { POOL_SIDE_SESSION_SECRET: SESSION_SECRET },
      now: () => now + 91_000
    }), false);

    const deployedUrl = createSignedPushcutXUrl(
      request('GET', '/', { host: 'attacker.example' }),
      '/api/pushcut-receipt-x',
      'pushcut-capability-event-0002',
      'receipt',
      {
        env: {
          VERCEL: '1',
          VERCEL_URL: 'trusted-version-x.vercel.app',
          POOL_SIDE_SESSION_SECRET: SESSION_SECRET
        },
        now: () => now
      }
    );
    assert.match(deployedUrl.url, /^https:\/\/trusted-version-x\.vercel\.app\//);
    assert.equal(deployedUrl.url.includes('attacker.example'), false);
  });

  test('atomically leases dispatch and reclaims only a stale queued attempt', async () => {
    const eventId = 'pushcut-dispatch-lease-0001';
    const command = normalizePushcutXCommand({
      action: 'test',
      commandId: eventId
    });
    await createPushcutXReceipt(command, { now: () => 10_000 });

    const first = await claimPushcutXDispatch(eventId, {
      now: () => 10_000,
      leaseMs: 5_000
    });
    const overlapping = await claimPushcutXDispatch(eventId, {
      now: () => 14_999,
      leaseMs: 5_000
    });
    const reclaimed = await claimPushcutXDispatch(eventId, {
      now: () => 15_000,
      leaseMs: 5_000
    });

    assert.equal(first.claimed, true);
    assert.equal(first.reclaimed, false);
    assert.equal(overlapping.claimed, false);
    assert.equal(reclaimed.claimed, true);
    assert.equal(reclaimed.reclaimed, true);
    assert.equal(reclaimed.receipt.dispatchAttempt, 2);
  });

  test('serves natural voice only through a valid signed audio URL', async () => {
    process.env.OPENAI_API_KEY = 'openai-audio-secret';
    const eventId = 'pushcut-audio-event-0001';
    const command = normalizePushcutXCommand({
      action: 'announce',
      commandId: eventId,
      text: 'Welcome to the pool. Please enjoy the afternoon.',
      announcementVolume: 100,
      musicVolume: 30
    });
    await createPushcutXReceipt(command);
    const signed = createSignedPushcutXUrl(
      request('GET', '/'),
      '/api/pushcut-audio-x',
      eventId,
      'audio'
    );
    assert.ok(signed);

    const audioBytes = Uint8Array.from([82, 73, 70, 70, 1, 2, 3, 4]);
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), 'https://api.openai.com/v1/audio/speech');
      assert.equal(options.headers.Authorization, 'Bearer openai-audio-secret');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-4o-mini-tts');
      assert.equal(body.voice, 'marin');
      assert.match(body.instructions, /naturally/i);
      return {
        ok: true,
        status: 200,
        async arrayBuffer() { return audioBytes.buffer; }
      };
    };

    const audio = await invoke(
      pushcutAudioXHandler,
      request('GET', signed.url)
    );
    assert.equal(audio.statusCode, 200);
    assert.equal(audio.getHeader('content-type'), 'audio/wav');
    assert.equal(audio.getHeader('cache-control'), 'private, no-store, max-age=0');
    assert.deepEqual(audio.raw(), Buffer.from(audioBytes));
    const receipt = await readPushcutXReceipt(eventId);
    assert.equal(receipt.status, 'started');
    assert.equal(receipt.providerStatus, 'natural_audio_ready');
    assert.equal(receipt.audioContentType, 'audio/wav');
  });

  test('bounds provider audio and retries an oversized WAV as MP3', async () => {
    const formats = [];
    let cancelled = false;
    const result = await generateNaturalSpeech({
      text: 'Bounded natural voice test.'
    }, {
      env: { OPENAI_API_KEY: 'openai-audio-secret' },
      fetchImpl: async (_url, options) => {
        const format = JSON.parse(options.body).response_format;
        formats.push(format);
        if (format === 'wav') {
          return {
            ok: true,
            status: 200,
            headers: {
              get(name) {
                return String(name).toLowerCase() === 'content-length'
                  ? String(NATURAL_SPEECH_MAX_AUDIO_BYTES + 1)
                  : '';
              }
            },
            body: {
              async cancel() { cancelled = true; }
            }
          };
        }
        const bytes = Uint8Array.from([0x49, 0x44, 0x33, 1, 2, 3]);
        return {
          ok: true,
          status: 200,
          headers: { get: () => '' },
          async arrayBuffer() { return bytes.buffer; }
        };
      }
    });
    assert.deepEqual(formats, ['wav', 'mp3']);
    assert.equal(cancelled, true);
    assert.equal(result.format, 'mp3');
    assert.equal(result.contentType, 'audio/mpeg');
  });

  test('returns the updated failed receipt immediately when audio generation fails', async () => {
    const eventId = 'pushcut-audio-failure-receipt-0001';
    await createPushcutXReceipt(normalizePushcutXCommand({
      action: 'announce',
      commandId: eventId,
      text: 'This generation will fail safely.'
    }));
    const signed = createSignedPushcutXUrl(
      request('GET', '/'),
      '/api/pushcut-audio-x',
      eventId,
      'audio'
    );
    const handler = createPushcutAudioXHandler({
      naturalSpeechGenerator: async () => {
        throw new NaturalSpeechError('provider');
      }
    });
    const failed = await invoke(handler, request('GET', signed.url));
    assert.equal(failed.statusCode, 502);
    assert.equal(failed.json().receipt.status, 'failed');
    assert.equal(failed.json().receipt.providerStatus, 'audio_failed');
  });

  test('allows only one concurrent natural-audio generation claim', async () => {
    process.env.OPENAI_API_KEY = 'openai-audio-secret';
    const eventId = 'pushcut-audio-race-0001';
    const command = normalizePushcutXCommand({
      action: 'announce',
      commandId: eventId,
      text: 'Concurrent signed audio test.'
    });
    await createPushcutXReceipt(command);
    const signed = createSignedPushcutXUrl(
      request('GET', '/'),
      '/api/pushcut-audio-x',
      eventId,
      'audio'
    );

    let releaseProvider;
    let markProviderStarted;
    const providerGate = new Promise(resolve => { releaseProvider = resolve; });
    const providerStarted = new Promise(resolve => { markProviderStarted = resolve; });
    let providerCalls = 0;
    globalThis.fetch = async () => {
      providerCalls += 1;
      markProviderStarted();
      await providerGate;
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Uint8Array.from([82, 73, 70, 70, 9, 8, 7, 6]).buffer;
        }
      };
    };

    const firstPromise = invoke(
      pushcutAudioXHandler,
      request('GET', signed.url)
    );
    await providerStarted;
    const overlapping = await invoke(
      pushcutAudioXHandler,
      request('GET', signed.url)
    );
    assert.equal(overlapping.statusCode, 409);
    assert.equal(overlapping.getHeader('retry-after'), '3');
    assert.equal(providerCalls, 1);

    releaseProvider();
    const first = await firstPromise;
    assert.equal(first.statusCode, 200);
    const receipt = await readPushcutXReceipt(eventId);
    assert.equal(receipt.status, 'started');
    assert.equal(receipt.providerStatus, 'natural_audio_ready');
    assert.ok(receipt.audioFetchedAt);
    assert.equal(receipt.failureCode, '');
    const sequentialReplay = await invoke(
      pushcutAudioXHandler,
      request('GET', signed.url)
    );
    assert.equal(sequentialReplay.statusCode, 410);
    assert.match(sequentialReplay.json().error, /already been used/i);
    assert.equal(providerCalls, 1);
  });

  test('plain signed GET marks completion once and the manager status sees it', async () => {
    const eventId = 'pushcut-receipt-event-0001';
    const command = normalizePushcutXCommand({
      action: 'announce',
      commandId: eventId,
      text: 'Signed completion receipt test.'
    });
    await createPushcutXReceipt(command);
    await updatePushcutXReceipt(eventId, {
      status: 'accepted',
      providerStatus: 'pushcut_accepted',
      acceptedAt: 1_700_000_000_000
    });
    const signed = createSignedPushcutXUrl(
      request('GET', '/'),
      '/api/pushcut-receipt-x',
      eventId,
      'receipt'
    );
    assert.ok(signed);

    const premature = await invoke(
      pushcutReceiptXHandler,
      request('GET', signed.url)
    );
    assert.equal(premature.statusCode, 409);
    assert.equal((await readPushcutXReceipt(eventId)).status, 'accepted');

    await updatePushcutXReceipt(eventId, {
      status: 'started',
      providerStatus: 'natural_audio_ready',
      startedAt: 1_700_000_001_000,
      audioFetchedAt: 1_700_000_001_500,
      audioContentType: 'audio/wav'
    });
    const first = await invoke(
      pushcutReceiptXHandler,
      request('GET', signed.url)
    );
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().receipt.completed, true);
    assert.equal(first.json().receipt.volumeRestored, true);
    assert.equal(first.json().receipt.musicResumed, true);
    const completedAt = first.json().receipt.completedAt;

    const replay = await invoke(
      pushcutReceiptXHandler,
      request('GET', signed.url)
    );
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().receipt.completedAt, completedAt);

    const status = await invoke(
      pushcutXHandler,
      request('GET', `/api/pushcut-x?v=x&eventId=${eventId}`, { cookie: xCookie() })
    );
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().status, 'completed');
    assert.equal(status.json().completed, true);

    const tampered = new URL(signed.url);
    tampered.searchParams.set('sig', `${tampered.searchParams.get('sig')}x`);
    const denied = await invoke(
      pushcutReceiptXHandler,
      request('GET', tampered.toString())
    );
    assert.equal(denied.statusCode, 403);
  });

  test('commits a durable completion and latest pointer in one KV operation', async () => {
    const env = {
      VERCEL: '1',
      KV_REST_API_URL: 'https://kv.example.test',
      KV_REST_API_TOKEN: 'kv-test-token'
    };
    const commands = [];
    let stored = null;
    const fetchImpl = async (_url, options) => {
      const command = JSON.parse(options.body);
      commands.push(command);
      if (command[0] === 'SET') {
        stored = JSON.parse(command[2]);
        return jsonFetchResponse(200, { result: 'OK' });
      }
      if (command[0] === 'EVAL') {
        assert.equal(command[2], '2');
        assert.match(command[3], /:event:pushcut-atomic-completion-0001$/);
        assert.match(command[4], /:meta:latest-completed$/);
        const patch = JSON.parse(command[5]);
        stored = { ...stored, ...patch };
        return jsonFetchResponse(200, { result: JSON.stringify(stored) });
      }
      throw new Error(`Unexpected KV command: ${command[0]}`);
    };
    const command = normalizePushcutXCommand({
      action: 'test',
      commandId: 'pushcut-atomic-completion-0001'
    });
    await createPushcutXReceipt(command, { env, fetchImpl });
    const completed = await updatePushcutXReceipt(command.eventId, {
      status: 'completed',
      providerStatus: 'receiver_completed',
      completedAt: 20_000,
      volumeRestored: true,
      musicResumed: true
    }, {
      env,
      fetchImpl,
      now: () => 20_000
    });

    assert.equal(completed.status, 'completed');
    assert.equal(commands.length, 2);
    assert.equal(commands.filter(commandItem => commandItem[0] === 'EVAL').length, 1);
  });

  test('a repeated durable completion callback repairs the latest pointer', async () => {
    process.env.KV_REST_API_URL = 'https://kv.example.test';
    process.env.KV_REST_API_TOKEN = 'kv-test-token';
    const eventId = 'pushcut-pointer-repair-0001';
    const completedReceipt = {
      schemaVersion: 1,
      version: 'x',
      eventId,
      commandId: eventId,
      action: 'announce',
      source: 'live',
      status: 'completed',
      queuedAt: 10_000,
      updatedAt: 20_000,
      acceptedAt: 11_000,
      startedAt: 12_000,
      audioFetchedAt: 13_000,
      completedAt: 20_000,
      volumeRestored: true,
      musicResumed: true
    };
    const kvCommands = [];
    globalThis.fetch = async (_url, options) => {
      const command = JSON.parse(options.body);
      kvCommands.push(command);
      if (command[0] === 'GET') {
        return jsonFetchResponse(200, { result: JSON.stringify(completedReceipt) });
      }
      if (command[0] === 'EVAL') {
        assert.equal(command[2], '1');
        assert.match(command[3], /:meta:latest-completed$/);
        return jsonFetchResponse(200, {
          result: JSON.stringify({
            eventId,
            completedAt: completedReceipt.completedAt,
            updatedAt: completedReceipt.updatedAt
          })
        });
      }
      throw new Error(`Unexpected KV command: ${command[0]}`);
    };
    const signed = createSignedPushcutXUrl(
      request('GET', '/'),
      '/api/pushcut-receipt-x',
      eventId,
      'receipt'
    );
    const replay = await invoke(
      pushcutReceiptXHandler,
      request('GET', signed.url)
    );

    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().receipt.completed, true);
    assert.equal(kvCommands.filter(command => command[0] === 'GET').length, 2);
    assert.equal(kvCommands.filter(command => command[0] === 'EVAL').length, 1);
  });

  test('production receipt creation fails closed without durable KV', async () => {
    const command = normalizePushcutXCommand({
      action: 'test',
      commandId: 'pushcut-durable-event-0001'
    });
    await assert.rejects(
      createPushcutXReceipt(command, {
        env: {
          VERCEL: '1',
          POOL_SIDE_SESSION_SECRET: SESSION_SECRET
        }
      }),
      error => error instanceof PushcutXReceiptError && error.code === 'unavailable'
    );
  });
});

describe('Version X finite downloadable announcement audio', { concurrency: false }, () => {
  test('resolves only the exact Suno song and ignores embedded recommendations', async () => {
    const source = normalizeFiniteAudioReference(
      'suno',
      'https://suno.com/song/requested-song-id'
    );
    const resolved = await resolveFiniteAudioReference(source, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => '' },
        async text() {
          return `<!doctype html>
            <link rel="canonical" href="https://suno.com/song/requested-song-id">
            <script type="application/json">{
              "recommendations":[{"id":"wrong-song","audio_url":"https://cdn.suno.ai/wrong-song.mp3"}],
              "clip":{"id":"requested-song-id","audio_url":"https://cdn.suno.ai/requested-song-id.mp3"}
            }</script>`;
        }
      })
    });
    assert.equal(resolved.resolvedUrl, 'https://cdn.suno.ai/requested-song-id.mp3');
    assert.equal(resolved.evidence, 'exact-suno-song-id');

    await assert.rejects(
      resolveFiniteAudioReference(source, {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: { get: () => '' },
          async text() {
            return `<!doctype html>
              <link rel="canonical" href="https://suno.com/song/requested-song-id">
              <script type="application/json">{
                "recommendations":[{"id":"wrong-song","audio_url":"https://cdn.suno.ai/wrong-song.mp3"}]
              }</script>`;
          }
        })
      }),
      error => error instanceof FiniteAudioXError && error.code === 'ambiguous'
    );
  });

  test('downloads bounded public HTTPS audio and enforces type and declared size', async () => {
    const wav = pcmWav(1);
    const requestImpl = (_url, _options, callback) => {
      const req = new EventEmitter();
      req.setTimeout = () => req;
      req.destroy = error => queueMicrotask(() => req.emit('error', error));
      req.end = () => queueMicrotask(() => {
        const incoming = new PassThrough();
        incoming.statusCode = 200;
        incoming.headers = {
          'content-type': 'audio/wav',
          'content-length': String(wav.byteLength)
        };
        callback(incoming);
        incoming.end(wav);
      });
      return req;
    };
    const audio = await loadFiniteAnnouncementAudio({
      provider: 'direct',
      sourceUrl: 'https://media.example/pool-message.wav',
      maxDurationSeconds: 2
    }, {
      lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
      requestImpl
    });
    assert.equal(audio.contentType, 'audio/wav');
    assert.equal(audio.extension, 'wav');
    assert.equal(audio.durationSeconds, 1);
    assert.deepEqual(audio.buffer, wav);

    const oversizedRequest = (_url, _options, callback) => {
      const req = new EventEmitter();
      req.setTimeout = () => req;
      req.destroy = error => queueMicrotask(() => req.emit('error', error));
      req.end = () => queueMicrotask(() => {
        const incoming = new PassThrough();
        incoming.statusCode = 200;
        incoming.headers = {
          'content-type': 'audio/wav',
          'content-length': '1000'
        };
        callback(incoming);
        incoming.end(wav);
      });
      return req;
    };
    await assert.rejects(
      loadFiniteAnnouncementAudio({
        provider: 'direct',
        sourceUrl: 'https://media.example/pool-message.wav',
        maxDurationSeconds: 2
      }, {
        lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
        requestImpl: oversizedRequest,
        maxBytes: 64
      }),
      error => error instanceof FiniteAudioXError && error.code === 'tooLarge'
    );

    await assert.rejects(
      loadFiniteAnnouncementAudio({
        provider: 'direct',
        sourceUrl: 'https://media.example/pool-message.wav',
        maxDurationSeconds: 1
      }, {
        lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
        requestImpl: (_url, _options, callback) => {
          const req = new EventEmitter();
          req.setTimeout = () => req;
          req.destroy = error => queueMicrotask(() => req.emit('error', error));
          req.end = () => queueMicrotask(() => {
            const longWav = pcmWav(2);
            const incoming = new PassThrough();
            incoming.statusCode = 200;
            incoming.headers = {
              'content-type': 'audio/wav',
              'content-length': String(longWav.byteLength)
            };
            callback(incoming);
            incoming.end(longWav);
          });
          return req;
        }
      }),
      error => error instanceof FiniteAudioXError && error.code === 'tooLong'
    );
  });

  test('serves a finite source through the same signed URL without exposing its token', async () => {
    const eventId = 'pushcut-finite-audio-event-0001';
    const privateUrl = 'https://media.example/pool-message.mp3?token=do-not-leak';
    const command = normalizePushcutXCommand({
      action: 'announce',
      commandId: eventId,
      text: 'Finite audio announcement.',
      announcementMode: 'finite-audio',
      announcementProvider: 'direct',
      announcementAudioUrl: privateUrl,
      announcementDurationSeconds: 9,
      announcementVolume: 100,
      musicVolume: 30
    });
    await createPushcutXReceipt(command);
    const signed = createSignedPushcutXUrl(
      request('GET', '/'),
      '/api/pushcut-audio-x',
      eventId,
      'audio'
    );
    const bytes = Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0]);
    const finiteHandler = createPushcutAudioXHandler({
      finiteAudioLoader: async input => {
        assert.deepEqual(input, {
          provider: 'direct',
          sourceUrl: privateUrl,
          maxDurationSeconds: 9
        });
        return {
          buffer: bytes,
          contentType: 'audio/mpeg',
          extension: 'mp3'
        };
      }
    });
    const result = await invoke(finiteHandler, request('GET', signed.url));
    assert.equal(result.statusCode, 200);
    assert.equal(result.getHeader('content-type'), 'audio/mpeg');
    assert.deepEqual(result.raw(), bytes);
    const receipt = await readPushcutXReceipt(eventId);
    assert.equal(receipt.providerStatus, 'direct_finite_audio_ready');
    const publicStatus = await invoke(
      pushcutXHandler,
      request('GET', `/api/pushcut-x?v=x&eventId=${eventId}`, { cookie: xCookie() })
    );
    assert.equal(publicStatus.json().announcementMode, 'finite-audio');
    assert.equal(publicStatus.json().announcementProvider, 'direct');
    assert.equal(publicStatus.json().finiteAudio, true);
    assert.equal(JSON.stringify(publicStatus.json()).includes('do-not-leak'), false);
    assert.equal(JSON.stringify(publicStatus.json()).includes(privateUrl), false);
  });
});

describe('Version X Pushcut route and browser adapter', { concurrency: false }, () => {
  test('requires the isolated Version X session and reports connected readiness without secrets', async () => {
    process.env.PUSHCUT_API_KEY_X = 'pushcut-route-secret';
    process.env.OPENAI_API_KEY = 'openai-route-secret';
    process.env.PUSHCUT_SERVER_ID_X = 'receiver-device-id';
    const denied = await invoke(pushcutXHandler, request('GET', '/api/pushcut-x?v=x'));
    assert.equal(denied.statusCode, 401);

    globalThis.fetch = async url => {
      assert.equal(String(url), PUSHCUT_X_DEVICES_URL);
      return jsonFetchResponse(200, {
        devices: [{
          id: 'receiver-device-id',
          isAutomationServer: true,
          isConnectedAutomationServer: true
        }]
      });
    };
    const ready = await invoke(pushcutXHandler, request('GET', '/api/pushcut-x?v=x', { cookie: xCookie() }));
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().ready, true);
    assert.equal(ready.json().connected, true);
    assert.equal(ready.json().connectedReady, true);
    assert.equal(ready.json().operational, false);
    assert.match(ready.json().note, /run the Receiver test/i);
    assert.equal(ready.json().durableReceipts, false);
    assert.equal(JSON.stringify(ready.json()).includes('pushcut-route-secret'), false);
    assert.equal(JSON.stringify(ready.json()).includes(PUSHCUT_X_DEFAULT_SHORTCUT), false);
  });

  test('marks Pushcut verified only after a recent signed completion receipt', async () => {
    process.env.PUSHCUT_API_KEY_X = 'pushcut-route-secret';
    process.env.OPENAI_API_KEY = 'openai-route-secret';
    process.env.PUSHCUT_SERVER_ID_X = 'receiver-device-id';
    const eventId = 'pushcut-health-verified-0001';
    const command = normalizePushcutXCommand({
      action: 'test',
      commandId: eventId
    });
    await createPushcutXReceipt(command);
    await updatePushcutXReceipt(eventId, {
      status: 'started',
      audioFetchedAt: Date.now(),
      providerStatus: 'natural_audio_ready'
    });
    await updatePushcutXReceipt(eventId, {
      status: 'completed',
      completedAt: Date.now(),
      providerStatus: 'receiver_completed',
      volumeRestored: true,
      musicResumed: true
    });
    globalThis.fetch = async () => jsonFetchResponse(200, {
      devices: [{
        id: 'receiver-device-id',
        isAutomationServer: true,
        isConnectedAutomationServer: true
      }]
    });

    const ready = await invoke(
      pushcutXHandler,
      request('GET', '/api/pushcut-x?v=x', { cookie: xCookie() })
    );
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().connectedReady, true);
    assert.equal(ready.json().operational, true);
    assert.ok(ready.json().latestVerifiedAt);
  });

  test('accepts one idempotent announcement with signed audio and completion URLs', async () => {
    process.env.PUSHCUT_API_KEY_X = 'pushcut-route-secret';
    process.env.OPENAI_API_KEY = 'openai-route-secret';
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
    assert.equal(result.json().receipt.status, 'accepted');
    assert.equal(result.json().receipt.recoveryQueued, true);
    assert.equal(calls.length, 2);
    const input = JSON.parse(JSON.parse(calls[0].options.body).input);
    assert.equal(input.eventId, eventId);
    assert.equal(input.text, 'This is a live receiver test.');
    assert.equal(input.speechMode, 'natural-audio');
    assert.match(input.audioUrl, /^https:\/\/poolside\.test\/api\/pushcut-audio-x\?v=x&/);
    assert.match(input.receiptUrl, /^https:\/\/poolside\.test\/api\/pushcut-receipt-x\?v=x&/);
    assert.equal(input.audioUrl.includes('openai-route-secret'), false);
    assert.equal(input.receiptUrl.includes('pushcut-route-secret'), false);
    assert.equal(Object.hasOwn(input, 'secret'), false);

    const replay = await invoke(pushcutXHandler, request('POST', '/api/pushcut-x?v=x', {
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
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().idempotentReplay, true);
    assert.equal(calls.length, 2);
  });

  test('queues finite audio without OpenAI and forwards only the signed proxy URL', async () => {
    process.env.PUSHCUT_API_KEY_X = 'pushcut-route-secret';
    delete process.env.OPENAI_API_KEY;
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return { status: 202 };
    };
    const eventId = 'pushcut-route-finite-0001';
    const privateUrl = 'https://media.example/pool-message.mp3?token=private-source-token';
    const result = await invoke(pushcutXHandler, request('POST', '/api/pushcut-x?v=x', {
      cookie: xCookie(),
      headers: { 'idempotency-key': eventId },
      body: {
        version: 'x',
        eventId,
        source: 'live',
        text: 'Finite source.',
        label: 'Finite Source',
        safety: false,
        voicePercent: 100,
        musicPercent: 30,
        announcementMode: 'finite-audio',
        announcementProvider: 'direct',
        announcementAudioUrl: privateUrl,
        announcementDurationSeconds: 8
      }
    }));
    assert.equal(result.statusCode, 202);
    const input = JSON.parse(JSON.parse(calls[0].options.body).input);
    assert.equal(input.speechMode, 'finite-audio');
    assert.equal(input.announcementMode, 'finite-audio');
    assert.equal(input.announcementProvider, 'direct');
    assert.equal(input.announcementDurationSeconds, 8);
    assert.match(input.audioUrl, /\/api\/pushcut-audio-x\?/);
    assert.equal(Object.hasOwn(input, 'announcementAudioUrl'), false);
    assert.equal(JSON.stringify(input).includes('private-source-token'), false);
    assert.equal(JSON.stringify(result.json()).includes('private-source-token'), false);
  });

  test('a synchronous Pushcut test is not called complete without the signed receiver receipt', async () => {
    process.env.PUSHCUT_API_KEY_X = 'pushcut-route-secret';
    process.env.OPENAI_API_KEY = 'openai-route-secret';
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return { status: calls.length === 1 ? 200 : 202 };
    };
    const eventId = 'pushcut-route-test-0001';
    const result = await invoke(pushcutXHandler, request('POST', '/api/pushcut-x?v=x', {
      cookie: xCookie(),
      headers: { 'idempotency-key': eventId },
      body: { action: 'test', commandId: eventId }
    }));

    assert.equal(result.statusCode, 202);
    assert.equal(result.json().providerCompleted, true);
    assert.equal(result.json().completed, false);
    assert.equal(result.json().receipt.status, 'accepted');
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
