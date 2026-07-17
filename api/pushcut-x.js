import {
  clientIp,
  consumeRateLimit,
  readJsonBody,
  requireSession,
  sessionVariant
} from './_auth.js';
import {
  dispatchPushcutXCommand,
  inspectPushcutXServerHealth,
  normalizePushcutXCommand,
  PUSHCUT_X_ACTIONS,
  PUSHCUT_X_DEFAULT_RECOVERY_SHORTCUT,
  PushcutXError,
  pushcutXHealth,
  validPushcutXEventId
} from './_pushcut-x.js';
import {
  claimPushcutXDispatch,
  createPushcutXReceipt,
  publicPushcutXReceipt,
  PushcutXReceiptError,
  pushcutXReceiptStorageHealth,
  readLatestCompletedPushcutXReceipt,
  readPushcutXReceipt,
  updatePushcutXReceipt
} from './_pushcut-receipts-x.js';
import {
  createSignedPushcutXUrl,
  pushcutXCapabilityReady
} from './_pushcut-security-x.js';

const HEALTH_RATE_LIMIT = 60;
const COMMAND_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_COMMAND_BYTES = 12_000;
const VERIFIED_RECEIVER_WINDOW_MS = 5 * 60_000;

function header(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function queryValue(req, name) {
  const rawUrl = String(req?.url || '');
  if (rawUrl) {
    try {
      const value = new URL(rawUrl, 'https://poolside.local').searchParams.get(name);
      if (value != null) return value;
    } catch {}
  }
  const value = req?.query?.[name];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

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
  const rate = consumeRateLimit(`pushcut:x:${purpose}:${session.sid}:${clientIp(req)}`, {
    limit,
    windowMs: RATE_WINDOW_MS
  });
  if (rate.allowed) return false;
  res.setHeader('Retry-After', String(rate.retryAfterSeconds));
  json(res, 429, { ok: false, error: 'Too many Pushcut requests. Try again shortly.' });
  return true;
}

export default async function handler(req, res) {
  if (sessionVariant(req) !== 'x') {
    return json(res, 400, { ok: false, error: 'Version X requests must use ?v=x.' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'GET or POST required.' });
  }

  // requireSession selects the isolated Version X cookie from ?v=x and also
  // rejects cross-origin requests before any provider configuration is read.
  const session = requireSession(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    if (limited(req, res, session, 'health', HEALTH_RATE_LIMIT)) return;
    const requestedEventId = queryValue(req, 'eventId').trim();
    if (requestedEventId) {
      if (!validPushcutXEventId(requestedEventId)) {
        return json(res, 400, { ok: false, error: 'The announcement identifier is invalid.' });
      }
      const receiptHealth = pushcutXReceiptStorageHealth();
      let receipt;
      try {
        receipt = await readPushcutXReceipt(requestedEventId);
      } catch (error) {
        const safe = error instanceof PushcutXReceiptError
          ? error
          : new PushcutXReceiptError('unavailable');
        return json(res, safe.statusCode, { ok: false, error: safe.message });
      }
      if (receipt) {
        return json(res, 200, {
          ok: true,
          ...publicPushcutXReceipt(receipt, { durable: receiptHealth.durable })
        });
      }
      return json(res, 200, {
        ok: true,
        version: 'x',
        eventId: requestedEventId,
        status: 'unknown',
        accepted: null,
        completed: false,
        durable: false,
        note: 'No verified Pushcut completion receipt is available for this announcement.'
      });
    }
    const health = pushcutXHealth();
    const receiptStorage = pushcutXReceiptStorageHealth();
    const [providerHealth, latestResult] = await Promise.all([
      inspectPushcutXServerHealth(),
      readLatestCompletedPushcutXReceipt()
        .then(value => ({ ok: true, value }))
        .catch(() => ({ ok: false, value: null }))
    ]);
    const latestReceipt = latestResult.value;
    const receiptStorageReady = receiptStorage.ready && latestResult.ok;
    const latestVerifiedAt = Number(latestReceipt?.completedAt || latestReceipt?.updatedAt || 0);
    const recentlyVerified = latestVerifiedAt > 0
      && Date.now() - latestVerifiedAt <= VERIFIED_RECEIVER_WINDOW_MS;
    const connected = providerHealth.connected == null
      ? recentlyVerified || null
      : providerHealth.connected;
    const naturalAudioReady = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
    const signedDeliveryReady = pushcutXCapabilityReady();
    const connectedReady = Boolean(
      health.ready
      && health.recoveryReady
      && providerHealth.providerReachable
      && connected === true
      && receiptStorageReady
      && naturalAudioReady
      && signedDeliveryReady
    );
    // A connected Pushcut device does not prove that it has the current
    // Poolside Pulse Shortcut. Only a recent signed end-of-Shortcut receipt
    // verifies the complete Receiver path.
    const operational = connectedReady && recentlyVerified;
    const note = operational
      ? 'Version X receiver recently completed the signed announcement sequence.'
      : !health.ready
        ? 'Version X Pushcut command service is not configured.'
        : !naturalAudioReady
          ? 'Natural announcement audio is not configured.'
          : !signedDeliveryReady
            ? 'Signed receiver delivery is not configured.'
            : !receiptStorageReady
              ? 'Durable receiver completion storage is unavailable.'
              : connected === false
                ? 'Pushcut reports that the Receiver automation server is disconnected.'
                : connectedReady
                  ? 'Pushcut is connected and configured. Run the Receiver test to verify the installed Shortcut and signed completion path.'
                  : 'Version X is configured, but a connected Receiver has not yet been verified.';
    return json(res, 200, {
      ok: true,
      version: 'x',
      service: 'pushcut',
      ready: health.ready,
      mode: health.mode,
      supportedActions: PUSHCUT_X_ACTIONS,
      readyActions: health.actions,
      connected,
      connectedReady,
      operational,
      providerReachable: providerHealth.providerReachable,
      serverMatched: providerHealth.serverMatched,
      recoveryReady: health.recoveryReady,
      naturalAudioReady,
      signedDeliveryReady,
      receiptStorageReady,
      durableReceipts: receiptStorage.durable,
      latestVerifiedAt,
      note
    });
  }

  if (limited(req, res, session, 'command', COMMAND_RATE_LIMIT)) return;

  let body;
  try {
    body = await readJsonBody(req, MAX_COMMAND_BYTES);
  } catch (error) {
    const tooLarge = error?.message === 'Request too large.';
    return json(res, tooLarge ? 413 : 400, {
      ok: false,
      error: tooLarge ? 'Pushcut command is too large.' : 'Invalid JSON body.'
    });
  }

  try {
    const command = normalizePushcutXCommand(body);
    const idempotencyKey = header(req, 'idempotency-key').trim();
    if (idempotencyKey && (!validPushcutXEventId(idempotencyKey) || idempotencyKey !== command.eventId)) {
      throw new PushcutXError('invalid');
    }
    const naturalAudioReady = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
    const selectedAudioReady = command.announcementMode === 'finite-audio'
      || naturalAudioReady;
    const signedDeliveryReady = pushcutXCapabilityReady();
    const audioCapability = createSignedPushcutXUrl(
      req,
      '/api/pushcut-audio-x',
      command.eventId,
      'audio'
    );
    const receiptCapability = createSignedPushcutXUrl(
      req,
      '/api/pushcut-receipt-x',
      command.eventId,
      'receipt'
    );
    if (!selectedAudioReady || !signedDeliveryReady || !audioCapability || !receiptCapability) {
      throw new PushcutXError('notConfigured');
    }

    const created = await createPushcutXReceipt(command);
    const dispatchClaim = await claimPushcutXDispatch(command.eventId);
    if (!dispatchClaim.claimed) {
      const existing = publicPushcutXReceipt(dispatchClaim.receipt, {
        durable: dispatchClaim.durable
      });
      if (existing.failed) {
        return json(res, 409, {
          ok: false,
          error: 'This announcement attempt already failed. Create a new announcement attempt.',
          version: 'x',
          eventId: command.eventId,
          receipt: existing,
          idempotentReplay: true
        });
      }
      const replayStatus = existing.completed
        ? 200
        : existing.status === 'queued'
          ? 200
          : 202;
      return json(res, replayStatus, {
        ok: true,
        version: 'x',
        accepted: existing.accepted,
        completed: existing.completed,
        status: existing.status,
        action: existing.action,
        commandId: command.commandId,
        eventId: command.eventId,
        receipt: existing,
        idempotentReplay: true
      });
    }

    const {
      announcementAudioUrl: _privateAnnouncementAudioUrl,
      ...safeReceiverCommand
    } = command;
    const receiverCommand = Object.freeze({
      ...safeReceiverCommand,
      speechMode: command.announcementMode === 'finite-audio'
        ? 'finite-audio'
        : 'natural-audio',
      audioUrl: audioCapability.url,
      audioExpiresAt: audioCapability.expiresAt,
      receiptUrl: receiptCapability.url,
      receiptExpiresAt: receiptCapability.expiresAt,
      recoveryShortcut: PUSHCUT_X_DEFAULT_RECOVERY_SHORTCUT
    });
    let accepted;
    try {
      accepted = await dispatchPushcutXCommand(receiverCommand);
    } catch (error) {
      if (error instanceof PushcutXError) {
        const timedOut = error.code === 'timeout';
        await updatePushcutXReceipt(command.eventId, {
          status: timedOut ? 'timed_out' : 'failed',
          providerStatus: timedOut ? 'pushcut_timeout' : `pushcut_${error.code}`,
          ...(timedOut ? {} : {
            failedAt: Date.now(),
            failureCode: `pushcut_${error.code}`
          }),
          recoveryQueued: error.recoveryQueued === true,
          ...(error.recoveryAcceptedAt ? {
            recoveryAcceptedAt: error.recoveryAcceptedAt
          } : {})
        }).catch(() => {});
      }
      throw error;
    }

    const now = Date.now();
    await updatePushcutXReceipt(command.eventId, {
      status: 'accepted',
      providerStatus: accepted.completed
        ? 'pushcut_completed_awaiting_receipt'
        : 'pushcut_accepted',
      providerMode: accepted.mode,
      acceptedAt: now,
      recoveryQueued: accepted.recoveryQueued,
      ...(accepted.recoveryAcceptedAt ? {
        recoveryAcceptedAt: accepted.recoveryAcceptedAt
      } : {})
    });
    const receipt = await readPushcutXReceipt(command.eventId);
    const publicReceipt = publicPushcutXReceipt(receipt, {
      durable: dispatchClaim.durable
    });
    return json(res, publicReceipt.completed ? 200 : 202, {
      ok: true,
      version: 'x',
      accepted: accepted.accepted,
      completed: publicReceipt.completed,
      status: publicReceipt.status,
      mode: accepted.mode,
      providerCompleted: accepted.completed,
      action: accepted.action,
      commandId: accepted.commandId,
      eventId: accepted.eventId,
      dispatchReclaimed: dispatchClaim.reclaimed,
      recoveryQueued: accepted.recoveryQueued,
      receipt: publicReceipt
    });
  } catch (error) {
    if (error instanceof PushcutXReceiptError) {
      return json(res, error.statusCode, { ok: false, error: error.message });
    }
    const safe = error instanceof PushcutXError
      ? error
      : new PushcutXError('providerRejected');
    return json(res, safe.statusCode, { ok: false, error: safe.message });
  }
}
