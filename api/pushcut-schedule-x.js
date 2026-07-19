import {
  clientIp,
  consumeRateLimit,
  readJsonBody,
  requireSession,
  sessionVariant
} from './_auth.js';
import {
  createPushcutScheduleManifestStore,
  PushcutScheduleXError,
  readPushcutXScheduleStatus,
  retireLegacyPushcutXSchedule,
  synchronizePushcutXSchedule,
  verifyPushcutXDelayedScheduling
} from './_pushcut-schedule-x.js';
import { readCanonicalVersionXState } from './state-x.js';

const MAX_REQUEST_BYTES = 4_000;
const SYNC_RATE_LIMIT = 8;
const STATUS_RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
export const PUSHCUT_X_LEGACY_RETIRE_CONFIRMATION =
  'RETIRE_LEGACY_PUSHCUT_SCHEDULE';

// A first 29-day sync can create many delayed Pushcut requests. Vercel applies
// the account's allowed maximum when this value exceeds the plan limit.
export const maxDuration = 300;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Origin, Cookie');
  res.end(JSON.stringify({ serverTime: Date.now(), ...body }));
}

function limited(req, res, session, purpose, limit) {
  const rate = consumeRateLimit(`pushcut:x:schedule:${purpose}:${session.sid}:${clientIp(req)}`, {
    limit,
    windowMs: RATE_WINDOW_MS
  });
  if (rate.allowed) return false;
  res.setHeader('Retry-After', String(rate.retryAfterSeconds));
  json(res, 429, {
    ok: false,
    error: 'Too many Pushcut schedule requests. Try again shortly.',
    requiresExtended: false
  });
  return true;
}

export function createPushcutScheduleXHandler({
  manifestStoreFactory = () => createPushcutScheduleManifestStore(),
  statusReader = readPushcutXScheduleStatus,
  synchronizer = synchronizePushcutXSchedule,
  delayedVerifier = verifyPushcutXDelayedScheduling,
  legacyRetirer = retireLegacyPushcutXSchedule,
  stateReader = readCanonicalVersionXState
} = {}) {
  return async function handler(req, res) {
    if (sessionVariant(req) !== 'x') {
      return json(res, 400, {
        ok: false,
        error: 'Version X requests must use ?v=x.',
        requiresExtended: false
      });
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, {
        ok: false,
        error: 'GET or POST required.',
        requiresExtended: false
      });
    }
    const session = requireSession(req, res);
    if (!session) return;
    if (req.method === 'GET') {
      if (limited(req, res, session, 'status', STATUS_RATE_LIMIT)) return;
      try {
        const manifestStore = manifestStoreFactory();
        const status = await statusReader({ manifestStore });
        return json(res, 200, {
          ok: true,
          service: 'pushcut-delayed-schedule',
          ...status,
          requiresExtended: false,
          serverExtendedRequired: true,
          note: 'Delayed automatic execution requires Pushcut Automation Server Extended.'
        });
      } catch (error) {
        const safe = error instanceof PushcutScheduleXError
          ? error
          : new PushcutScheduleXError('durableUnavailable');
        return json(res, safe.statusCode, {
          ok: false,
          error: safe.message,
          requiresExtended: safe.requiresExtended
        });
      }
    }

    if (limited(req, res, session, 'sync', SYNC_RATE_LIMIT)) return;
    let body;
    try {
      body = await readJsonBody(req, MAX_REQUEST_BYTES);
    } catch (error) {
      const tooLarge = error?.message === 'Request too large.';
      return json(res, tooLarge ? 413 : 400, {
        ok: false,
        error: tooLarge ? 'Pushcut schedule request is too large.' : 'Invalid JSON body.',
        requiresExtended: false
      });
    }
    if (body?.diagnostic === true) {
      if (Object.keys(body).some(key => key !== 'diagnostic')) {
        return json(res, 400, {
          ok: false,
          error: 'The Pushcut delayed-scheduling diagnostic request is invalid.',
          requiresExtended: false
        });
      }
      try {
        const result = await delayedVerifier();
        return json(res, 200, {
          ok: true,
          service: 'pushcut-delayed-schedule',
          ...result,
          requiresExtended: false,
          note: 'Pushcut Automation Server Extended accepted and cancelled a harmless delayed recovery check.'
        });
      } catch (error) {
        const safe = error instanceof PushcutScheduleXError
          ? error
          : new PushcutScheduleXError('providerUnavailable');
        return json(res, safe.statusCode, {
          ok: false,
          error: safe.message,
          requiresExtended: safe.requiresExtended
        });
      }
    }
    if (body?.retireLegacy === true) {
      if (
        Object.keys(body).some(key => ![
          'confirmation',
          'retireLegacy'
        ].includes(key))
        || body.confirmation !== PUSHCUT_X_LEGACY_RETIRE_CONFIRMATION
      ) {
        return json(res, 400, {
          ok: false,
          error: 'The legacy Pushcut retirement request is invalid.',
          requiresExtended: false
        });
      }
      try {
        const result = await legacyRetirer();
        return json(res, 200, {
          ok: true,
          service: 'pushcut-delayed-schedule',
          ...result,
          requiresExtended: false,
          note: 'Legacy unnamespaced Pushcut occurrences are retired. The isolated preview manifest was not changed.'
        });
      } catch (error) {
        const safe = error instanceof PushcutScheduleXError
          ? error
          : new PushcutScheduleXError('providerUnavailable');
        return json(res, safe.statusCode, {
          ok: false,
          error: safe.message,
          requiresExtended: safe.requiresExtended
        });
      }
    }
    const expectedRevision = Number(body?.expectedRevision ?? body?.state?.revision);
    const pushcutEnabled = body?.pushcutEnabled !== false;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return json(res, 400, {
        ok: false,
        error: 'The current Version X state revision is required for schedule sync.',
        requiresExtended: false
      });
    }
    let canonical;
    try {
      canonical = await stateReader({ requireDurable: true });
    } catch {
      return json(res, 503, {
        ok: false,
        error: 'Durable Version X state storage is unavailable.',
        requiresExtended: false
      });
    }
    if (!canonical?.state) {
      return json(res, 409, {
        ok: false,
        error: 'Save the Version X schedule once, then retry automatic schedule sync.',
        requiresExtended: false
      });
    }
    if (Number(canonical.revision) !== expectedRevision) {
      return json(res, 409, {
        ok: false,
        error: 'The schedule changed in another session. Refresh Poolside Pulse and retry.',
        requiresExtended: false,
        currentRevision: Number(canonical.revision || 0)
      });
    }
    try {
      const manifestStore = manifestStoreFactory();
      const result = await synchronizer({
        state: canonical.state,
        request: req,
        pushcutEnabled
      }, {
        manifestStore
      });
      return json(res, 200, {
        ok: true,
        service: 'pushcut-delayed-schedule',
        ...result,
        requiresExtended: false,
        note: 'Pushcut delayed occurrences are synchronized for the rolling Central Time horizon.'
      });
    } catch (error) {
      const safe = error instanceof PushcutScheduleXError
        ? error
        : new PushcutScheduleXError('providerUnavailable');
      return json(res, safe.statusCode, {
        ok: false,
        error: safe.message,
        requiresExtended: safe.requiresExtended
      });
    }
  };
}

export default createPushcutScheduleXHandler();
