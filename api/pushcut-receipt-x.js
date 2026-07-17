import {
  readJsonBody,
  sessionVariant
} from './_auth.js';
import {
  publicPushcutXReceipt,
  PushcutXReceiptError,
  readPushcutXReceipt,
  repairLatestCompletedPushcutXReceipt,
  pushcutXReceiptStorageHealth,
  updatePushcutXReceipt
} from './_pushcut-receipts-x.js';
import {
  readPushcutXCapability,
  verifyPushcutXCapability
} from './_pushcut-security-x.js';
import { logPushcutXEvent } from './_pushcut-x.js';

const MAX_RECEIPT_BYTES = 4_000;
const RECEIPT_STATUSES = new Set(['started', 'completed', 'failed']);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(JSON.stringify({ serverTime: Date.now(), ...body }));
}

export default async function handler(req, res) {
  if (sessionVariant(req) !== 'x') {
    return json(res, 400, { ok: false, error: 'Version X requests must use ?v=x.' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'GET or POST required.' });
  }

  const capability = readPushcutXCapability(req);
  if (!verifyPushcutXCapability(capability, 'receipt')) {
    return json(res, 403, { ok: false, error: 'The announcement receipt link is invalid or expired.' });
  }

  let body = {};
  if (req.method === 'POST') {
    try {
      body = await readJsonBody(req, MAX_RECEIPT_BYTES);
    } catch {
      return json(res, 400, { ok: false, error: 'Invalid receipt body.' });
    }
  }
  const requestedEventId = String(body?.eventId || capability.eventId).trim();
  const status = String(body?.status || 'completed').trim().toLowerCase();
  if (requestedEventId !== capability.eventId || !RECEIPT_STATUSES.has(status)) {
    return json(res, 400, { ok: false, error: 'The announcement receipt is invalid.' });
  }
  logPushcutXEvent('receiver_receipt_requested', {
    eventId: capability.eventId,
    receiptStatus: status
  });

  try {
    const existing = await readPushcutXReceipt(capability.eventId);
    if (!existing) throw new PushcutXReceiptError('notFound');
    if (status === 'completed' && !Number(existing.audioFetchedAt || 0)) {
      return json(res, 409, {
        ok: false,
        error: 'The natural announcement audio has not been fetched by the Receiver.'
      });
    }
    if (existing.status === status && (status === 'completed' || status === 'failed')) {
      if (status === 'completed') {
        await repairLatestCompletedPushcutXReceipt(capability.eventId);
      }
      const health = pushcutXReceiptStorageHealth();
      logPushcutXEvent('receiver_receipt_replayed', {
        eventId: capability.eventId,
        completed: status === 'completed',
        receiptStatus: status
      });
      return json(res, 200, {
        ok: true,
        version: 'x',
        receipt: publicPushcutXReceipt(existing, { durable: health.durable })
      });
    }
    const now = Date.now();
    const patch = status === 'completed'
      ? {
          status,
          providerStatus: 'receiver_completed',
          completedAt: now,
          volumeRestored: body?.volumeRestored !== false,
          musicResumed: req.method === 'GET'
            ? existing.resumeMusic !== false
            : body?.musicResumed !== false
        }
      : status === 'started'
        ? {
            status,
            providerStatus: 'receiver_started',
            startedAt: existing.startedAt || now
          }
        : {
            status,
            providerStatus: 'receiver_failed',
            failedAt: now,
            failureCode: String(body?.failureCode || 'receiver_shortcut_failed')
          };
    const updated = await updatePushcutXReceipt(capability.eventId, patch);
    const health = pushcutXReceiptStorageHealth();
    logPushcutXEvent('receiver_receipt_updated', {
      eventId: capability.eventId,
      completed: status === 'completed',
      receiptStatus: updated.status
    });
    return json(res, 200, {
      ok: true,
      version: 'x',
      receipt: publicPushcutXReceipt(updated, { durable: health.durable })
    });
  } catch (error) {
    const safe = error instanceof PushcutXReceiptError
      ? error
      : new PushcutXReceiptError('unavailable');
    logPushcutXEvent('receiver_receipt_failed', {
      eventId: capability.eventId,
      providerCategory: safe.code,
      receiptStatus: status
    });
    return json(res, safe.statusCode, { ok: false, error: safe.message });
  }
}
