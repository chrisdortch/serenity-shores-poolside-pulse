import { sessionVariant } from './_auth.js';
import {
  PushcutXReceiptError,
  readPushcutXReceipt,
  verifiedPushcutXCompletion
} from './_pushcut-receipts-x.js';
import {
  readPushcutXCapability,
  verifyPushcutXCapability
} from './_pushcut-security-x.js';
import {
  canonicalPushcutXMusicPercent,
  PUSHCUT_X_RECEIVER_CONTRACT,
  pushcutXVolumeLevels
} from './_pushcut-x.js';
import { createPushcutScheduleManifestStore } from './_pushcut-schedule-x.js';
import { readCanonicalVersionXState } from './state-x.js';

const RECOVERABLE_RECEIPT_STATUSES = new Set(['accepted', 'started', 'timed_out', 'completed']);

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(JSON.stringify({ serverTime: Date.now(), ...body }));
}

/**
 * Resolves a scheduled fail-safe only when it actually runs. This prevents an
 * already-completed announcement from being overwritten by its old watchdog
 * and makes an incomplete announcement recover to the latest shared slider M,
 * rather than the value captured days earlier when the schedule was synced.
 */
export function createPushcutRecoveryXHandler({
  receiptReader = readPushcutXReceipt,
  manifestReader = async () => await createPushcutScheduleManifestStore().read(),
  stateReader = readCanonicalVersionXState,
  now = Date.now
} = {}) {
  return async function handler(req, res) {
    if (sessionVariant(req) !== 'x') {
      return json(res, 400, { ok: false, error: 'Version X requests must use ?v=x.' });
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return json(res, 405, { ok: false, error: 'GET required.' });
    }

    const capability = readPushcutXCapability(req);
    if (!verifyPushcutXCapability(capability, 'recovery', { now })) {
      return json(res, 403, { ok: false, error: 'The scheduled recovery link is invalid or expired.' });
    }

    try {
      const receipt = await receiptReader(capability.eventId);
      if (!receipt) throw new PushcutXReceiptError('notFound');
      if (verifiedPushcutXCompletion(receipt)) {
        return json(res, 200, {
          ok: true,
          version: 'x',
          receiverContract: PUSHCUT_X_RECEIVER_CONTRACT,
          eventId: capability.eventId,
          shouldRecover: 0,
          shouldRecoverBoolean: false,
          resumeMusic: 0,
          resumeMusicBoolean: false,
          reason: 'announcement-already-completed'
        });
      }
      const receiptStatus = String(receipt.status || '').trim().toLowerCase();
      if (!RECOVERABLE_RECEIPT_STATUSES.has(receiptStatus)) {
        return json(res, 200, {
          ok: true,
          version: 'x',
          receiverContract: PUSHCUT_X_RECEIVER_CONTRACT,
          eventId: capability.eventId,
          shouldRecover: 0,
          shouldRecoverBoolean: false,
          resumeMusic: 0,
          resumeMusicBoolean: false,
          reason: 'announcement-was-not-left-incomplete'
        });
      }
      const manifest = await manifestReader();
      const trackedOccurrence = Object.values(manifest?.occurrences || {}).find(occurrence => (
        String(occurrence?.eventId || '') === capability.eventId
        && String(occurrence?.status || '') === 'scheduled'
      ));
      if (
        receipt.source !== 'schedule'
        || Number(receipt.scheduledFor || 0) <= 0
        || !trackedOccurrence
      ) {
        return json(res, 200, {
          ok: true,
          version: 'x',
          receiverContract: PUSHCUT_X_RECEIVER_CONTRACT,
          eventId: capability.eventId,
          shouldRecover: 0,
          shouldRecoverBoolean: false,
          resumeMusic: 0,
          resumeMusicBoolean: false,
          reason: 'scheduled-occurrence-is-no-longer-active'
        });
      }

      const snapshot = await stateReader({ requireDurable: true });
      const musicPercent = canonicalPushcutXMusicPercent(snapshot?.state, 30);
      const levels = pushcutXVolumeLevels(musicPercent);
      return json(res, 200, {
        ok: true,
        version: 'x',
        receiverContract: PUSHCUT_X_RECEIVER_CONTRACT,
        eventId: capability.eventId,
        shouldRecover: 1,
        shouldRecoverBoolean: true,
        musicPercent: levels.musicPercent,
        musicLevel: levels.musicLevel,
        resumeMusic: 1,
        resumeMusicBoolean: true,
        reason: 'incomplete-scheduled-announcement'
      });
    } catch (error) {
      if (error instanceof PushcutXReceiptError) {
        return json(res, error.statusCode, { ok: false, error: error.message });
      }
      return json(res, 503, {
        ok: false,
        error: 'The latest Version X music target is temporarily unavailable.'
      });
    }
  };
}

export default createPushcutRecoveryXHandler();
