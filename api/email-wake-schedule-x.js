import {
  clientIp,
  consumeRateLimit,
  readJsonBody,
  requireSession,
  sessionVariant
} from './_auth.js';
import {
  createEmailWakeXManifestStore,
  EmailWakeXError,
  emailWakeXHealth
} from './_email-wake-x.js';
import {
  emailWakeXScheduleSourceFingerprint,
  readEmailWakeXScheduleStatus,
  synchronizeEmailWakeXSchedule
} from './_email-wake-schedule-x.js';
import {
  readCanonicalVersionXState
} from './state-x.js';

const MAX_REQUEST_BYTES = 2_000;
const RATE_WINDOW_MS = 60_000;

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

export function createEmailWakeScheduleXHandler({
  manifestStoreFactory = () => createEmailWakeXManifestStore({ requireDurable: true }),
  statusReader = readEmailWakeXScheduleStatus,
  synchronizer = synchronizeEmailWakeXSchedule,
  stateReader = readCanonicalVersionXState
} = {}) {
  return async function handler(req, res) {
    if (sessionVariant(req) !== 'x') {
      return json(res, 400, {
        ok: false,
        error: 'Version X requests must use ?v=x.'
      });
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { ok: false, error: 'GET or POST required.' });
    }
    const session = requireSession(req, res);
    if (!session) return;
    const rate = consumeRateLimit(
      `email-wake:x:schedule:${req.method.toLowerCase()}:${session.sid}:${clientIp(req)}`,
      { limit: req.method === 'POST' ? 8 : 60, windowMs: RATE_WINDOW_MS }
    );
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return json(res, 429, {
        ok: false,
        error: 'Too many Version X email schedule requests. Try again shortly.'
      });
    }
    const health = emailWakeXHealth();
    if (!health.ready) {
      return json(res, 503, {
        ok: false,
        error: 'The Version X email wake receiver is not configured.',
        synchronized: false
      });
    }
    const manifestStore = manifestStoreFactory();
    if (req.method === 'GET') {
      try {
        const [status, canonical] = await Promise.all([
          statusReader({ manifestStore }),
          stateReader({ requireDurable: true })
        ]);
        const current = !!canonical?.state
          && Number(status?.syncedAt || 0) > 0
          && String(status?.sourceFingerprint || '') ===
            emailWakeXScheduleSourceFingerprint(
              canonical.state,
              status?.enabled === true
            );
        return json(res, 200, {
          ok: true,
          service: 'email-wake-schedule-x',
          ...status,
          current
        });
      } catch (error) {
        const safe = error instanceof EmailWakeXError
          ? error
          : new EmailWakeXError('durableUnavailable');
        return json(res, safe.statusCode, { ok: false, error: safe.message });
      }
    }

    let body;
    try {
      body = await readJsonBody(req, MAX_REQUEST_BYTES);
    } catch (error) {
      return json(res, error?.message === 'Request too large.' ? 413 : 400, {
        ok: false,
        error: 'Invalid Version X email schedule request.'
      });
    }
    if (
      !body
      || typeof body !== 'object'
      || Array.isArray(body)
      || Object.keys(body).some(key => !['enabled', 'expectedRevision'].includes(key))
      || (body.enabled != null && typeof body.enabled !== 'boolean')
    ) {
      return json(res, 400, {
        ok: false,
        error: 'The Version X email schedule request is invalid.'
      });
    }
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      return json(res, 400, {
        ok: false,
        error: 'The current Version X state revision is required for schedule sync.'
      });
    }
    let canonical;
    try {
      canonical = await stateReader({ requireDurable: true });
    } catch {
      return json(res, 503, {
        ok: false,
        error: 'Durable Version X state storage is unavailable.'
      });
    }
    if (!canonical?.state) {
      return json(res, 409, {
        ok: false,
        error: 'Save the Version X schedule once, then retry email schedule sync.'
      });
    }
    const canonicalRevision = Number(canonical.revision || 0);
    if (expectedRevision > canonicalRevision) {
      return json(res, 409, {
        ok: false,
        error: 'The schedule revision is ahead of the canonical Version X state. Refresh Poolside Pulse and retry.',
        currentRevision: canonicalRevision
      });
    }
    // Receiver heartbeats and playback status share the same state revision as
    // schedules. They may advance between a Remote save and this request even
    // though no schedule input changed. Synchronizing the newest canonical
    // state is safe: this endpoint never writes state, and the manifest
    // fingerprint still makes any later schedule edit visibly out of date.
    const revisionAdvanced = canonicalRevision > expectedRevision;
    try {
      const result = await synchronizer({
        state: canonical.state,
        enabled: body.enabled !== false
      }, {
        manifestStore
      });
      return json(res, 200, {
        ok: true,
        service: 'email-wake-schedule-x',
        synchronized: true,
        stateRevision: canonicalRevision,
        revisionAdvanced,
        ...result,
        // The synchronizer exposes numeric mutation counters. On an
        // idempotent sync, maintenanceScheduled is 0 and
        // maintenanceUnchanged is 1 even though a durable renewal is still
        // scheduled. Normalize the public route response back to the boolean
        // status used by the browser UI so it never shows a false warning.
        maintenanceScheduled:
          result.maintenanceScheduled === true
          || Number(result.maintenanceScheduled || 0) > 0
          || Number(result.maintenanceUnchanged || 0) > 0,
        note: 'Wake emails are synchronized for the rolling 29-day Central Time horizon.'
      });
    } catch (error) {
      const safe = error instanceof EmailWakeXError
        ? error
        : new EmailWakeXError('providerUnavailable');
      return json(res, safe.statusCode, {
        ok: false,
        error: safe.message,
        synchronized: false
      });
    }
  };
}

export default createEmailWakeScheduleXHandler();
