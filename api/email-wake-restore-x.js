import { sessionVariant } from './_auth.js';
import {
  EMAIL_WAKE_X_RECEIVER_CONTRACT
} from './_email-wake-x.js';
import {
  PushcutXReceiptError,
  pushcutXReceiptExecutionAttemptMatches,
  readPushcutXReceipt,
  resolvePushcutXRestoreTarget
} from './_pushcut-receipts-x.js';
import {
  readPushcutXCapability,
  verifyPushcutXCapability
} from './_pushcut-security-x.js';
import {
  canonicalPushcutXMusicPercent,
  pushcutXVolumeLevels
} from './_pushcut-x.js';
import {
  readCanonicalVersionXState
} from './state-x.js';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(JSON.stringify({ serverTime: Date.now(), ...body }));
}

function resolvedTarget(receipt) {
  const musicPercent = receipt?.restoreTargetMusicPercent;
  const resolvedAt = Number(receipt?.restoreTargetResolvedAt || 0);
  const audioFetchedAt = Number(receipt?.audioFetchedAt || 0);
  const recoveryOnly = receipt?.executionMode === 'recovery';
  return typeof musicPercent === 'number'
    && Number.isFinite(musicPercent)
    && musicPercent >= 0
    && musicPercent <= 100
    && Number.isSafeInteger(resolvedAt)
    && resolvedAt > 0
    && (
      recoveryOnly
      || (
        Number.isSafeInteger(audioFetchedAt)
        && audioFetchedAt > 0
        && resolvedAt >= audioFetchedAt
      )
    )
    ? pushcutXVolumeLevels(musicPercent)
    : null;
}

export function createEmailWakeRestoreXHandler({
  receiptReader = readPushcutXReceipt,
  restoreResolver = resolvePushcutXRestoreTarget,
  stateReader = readCanonicalVersionXState,
  now = Date.now
} = {}) {
  return async function handler(req, res) {
    if (sessionVariant(req) !== 'x') {
      return json(res, 400, {
        ok: false,
        error: 'Version X requests must use ?v=x.'
      });
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return json(res, 405, { ok: false, error: 'GET required.' });
    }
    const capability = readPushcutXCapability(req);
    if (!verifyPushcutXCapability(capability, 'restore', { now })) {
      return json(res, 403, {
        ok: false,
        error: 'The email-wake restore link is invalid or expired.'
      });
    }
    try {
      const receipt = await receiptReader(capability.eventId);
      if (!receipt) throw new PushcutXReceiptError('notFound');
      if (receipt.receiverContract !== EMAIL_WAKE_X_RECEIVER_CONTRACT) {
        return json(res, 409, {
          ok: false,
          error: 'This command was created for a different Receiver contract.'
        });
      }
      if (!pushcutXReceiptExecutionAttemptMatches(
        receipt,
        capability.executionAttempt
      )) {
        return json(res, 409, {
          ok: false,
          error: 'This Receiver execution attempt is stale.'
        });
      }
      const recoveryOnly = receipt.executionMode === 'recovery';
      if (!recoveryOnly && !Number(receipt.audioFetchedAt || 0)) {
        return json(res, 409, {
          ok: false,
          error: 'The announcement audio has not been fetched by the Receiver.'
        });
      }
      if (receipt.status === 'failed') {
        return json(res, 409, {
          ok: false,
          error: 'This announcement has already failed.'
        });
      }
      let levels = resolvedTarget(receipt);
      if (!levels) {
        const snapshot = await stateReader({ requireDurable: true });
        const latestMusicPercent = canonicalPushcutXMusicPercent(snapshot?.state, 30);
        const resolved = await restoreResolver(
          capability.eventId,
          latestMusicPercent,
          {
            now,
            receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
            executionAttempt: capability.executionAttempt,
            allowRecovery: recoveryOnly
          }
        );
        levels = resolvedTarget(resolved);
      }
      if (!levels) {
        return json(res, 409, {
          ok: false,
          error: 'The latest music target could not be bound to this announcement.'
        });
      }
      return json(res, 200, {
        ok: true,
        version: 'x',
        receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
        eventId: capability.eventId,
        executionAttempt: capability.executionAttempt,
        recoveryOnly,
        musicPercent: levels.musicPercent,
        musicLevel: levels.musicLevel,
        resumeMusic: true
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

export default createEmailWakeRestoreXHandler();
