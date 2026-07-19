#!/usr/bin/env node

/**
 * Copies the user-visible Version X configuration from one Poolside Pulse
 * deployment into an isolated Version X namespace. It deliberately does not
 * copy a live Receiver lease, pending Remote commands, or pending weather
 * announcements, so opening the candidate cannot seize or replay production
 * audio.
 *
 * Required environment variables:
 *   POOL_SIDE_SOURCE_URL
 *   POOL_SIDE_TARGET_URL
 *   POOL_SIDE_ACCESS_CODE
 */

function normalizedBaseUrl(value, name) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTPS.`);
  }
  return url.origin;
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values
    .map(value => String(value).split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
}

async function jsonResponse(response, context) {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== 'object') {
    throw new Error(
      `${context} failed with HTTP ${response.status}${
        data?.error ? `: ${String(data.error).slice(0, 300)}` : ''
      }`
    );
  }
  return data;
}

async function authenticatedDeployment(baseUrl, accessCode, fetchImpl) {
  const response = await fetchImpl(`${baseUrl}/api/session?v=x`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      Origin: baseUrl,
      Referer: `${baseUrl}/`
    },
    body: JSON.stringify({ pin: String(accessCode || '').trim() })
  });
  await jsonResponse(response, `Login to ${baseUrl}`);
  const cookie = cookieHeader(response);
  if (!cookie) throw new Error(`Login to ${baseUrl} did not return a session cookie.`);
  return Object.freeze({
    baseUrl,
    async state() {
      const read = await fetchImpl(`${baseUrl}/api/state-x?v=x`, {
        headers: {
          Accept: 'application/json',
          Cookie: cookie,
          Origin: baseUrl,
          Referer: `${baseUrl}/`
        },
        cache: 'no-store'
      });
      return await jsonResponse(read, `Read state from ${baseUrl}`);
    },
    async write(state, expectedRevision) {
      const write = await fetchImpl(`${baseUrl}/api/state-x?v=x`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
          Cookie: cookie,
          Origin: baseUrl,
          Referer: `${baseUrl}/`
        },
        body: JSON.stringify({
          version: 'x',
          expectedRevision,
          state
        })
      });
      return await jsonResponse(write, `Write state to ${baseUrl}`);
    }
  });
}

export function prepareVersionXStateMigration(sourceState, now = Date.now()) {
  if (!sourceState || typeof sourceState !== 'object' || Array.isArray(sourceState)) {
    throw new Error('Source Version X state is invalid.');
  }
  const receiver = sourceState.receiver && typeof sourceState.receiver === 'object'
    ? sourceState.receiver
    : {};
  const playback = sourceState.playback && typeof sourceState.playback === 'object'
    ? sourceState.playback
    : {};
  const weather = sourceState.weather && typeof sourceState.weather === 'object'
    ? sourceState.weather
    : {};
  return structuredClone({
    ...sourceState,
    config: {
      ...(sourceState.config || {}),
      receiverMode: 'browser',
      announcementTransport: 'browser',
      automaticReceiverVerifiedPairingAt: 0
    },
    receiver: {
      ...receiver,
      id: '',
      sessionId: '',
      status: 'offline',
      startedAt: 0,
      lastSeen: now,
      leaseUntil: now,
      detail: 'Copied safely into the isolated Version X candidate.'
    },
    playback: {
      ...playback,
      intent: playback.intent === 'stopped' ? 'stopped' : 'paused',
      updatedAt: now,
      unavailableReason:
        'Start this device as Receiver to resume the copied music source.'
    },
    events: [],
    weather: {
      ...weather,
      pendingAnnouncementIds: []
    },
    savedAt: now
  });
}

export async function migrateVersionXState({
  sourceUrl,
  targetUrl,
  accessCode,
  fetchImpl = globalThis.fetch,
  now = Date.now
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required.');
  }
  const sourceBase = normalizedBaseUrl(sourceUrl, 'POOL_SIDE_SOURCE_URL');
  const targetBase = normalizedBaseUrl(targetUrl, 'POOL_SIDE_TARGET_URL');
  if (sourceBase === targetBase) {
    throw new Error('Source and target deployments must be different origins.');
  }
  const [source, target] = await Promise.all([
    authenticatedDeployment(sourceBase, accessCode, fetchImpl),
    authenticatedDeployment(targetBase, accessCode, fetchImpl)
  ]);
  const [sourcePayload, targetPayload] = await Promise.all([
    source.state(),
    target.state()
  ]);
  const migrated = prepareVersionXStateMigration(
    sourcePayload.state,
    Number(now())
  );
  const targetRevision = Number(targetPayload.state?.revision || 0);
  const saved = await target.write(migrated, targetRevision);
  return Object.freeze({
    sourceRevision: Number(sourcePayload.state?.revision || 0),
    targetPreviousRevision: targetRevision,
    targetRevision: Number(saved.state?.revision || 0),
    schedules: Array.isArray(saved.state?.schedules)
      ? saved.state.schedules.length
      : 0,
    announcements: Array.isArray(saved.state?.announcements)
      ? saved.state.announcements.length
      : 0,
    receiverOffline: saved.state?.receiver?.status === 'offline',
    pendingEvents: Array.isArray(saved.state?.events)
      ? saved.state.events.length
      : 0
  });
}

const invokedDirectly =
  process.argv[1]
  && new URL(import.meta.url).pathname === process.argv[1];

if (invokedDirectly) {
  migrateVersionXState({
    sourceUrl: process.env.POOL_SIDE_SOURCE_URL,
    targetUrl: process.env.POOL_SIDE_TARGET_URL,
    accessCode: process.env.POOL_SIDE_ACCESS_CODE
  }).then(result => {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  }).catch(error => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}
