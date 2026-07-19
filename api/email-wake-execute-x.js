import { sessionVariant } from './_auth.js';
import {
  EMAIL_WAKE_X_RECEIVER_CONTRACT
} from './_email-wake-x.js';
import {
  PushcutXReceiptError,
  pushcutXReceiptExecutionAttemptMatches,
  readPushcutXReceipt,
  updatePushcutXReceipt
} from './_pushcut-receipts-x.js';
import {
  readPushcutXCapability,
  verifyPushcutXCapability
} from './_pushcut-security-x.js';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(JSON.stringify({ serverTime: Date.now(), ...body }));
}

export function createEmailWakeExecuteXHandler({
  receiptReader = readPushcutXReceipt,
  receiptUpdater = updatePushcutXReceipt,
  env = process.env,
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
    if (!verifyPushcutXCapability(capability, 'execute', { env, now })) {
      return json(res, 403, {
        ok: false,
        error: 'The email-wake execution link is invalid or expired.'
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
      if (receipt.executionMode !== 'announcement') {
        return json(res, 409, {
          ok: false,
          error: 'This claim is not authorized to execute an announcement.'
        });
      }
      const authorizedAt = Number(now());
      const executionLeaseUntil = Number(receipt.executionLeaseUntil || 0);
      if (
        !Number.isSafeInteger(authorizedAt)
        || authorizedAt < 0
        || !Number.isSafeInteger(executionLeaseUntil)
        || executionLeaseUntil < authorizedAt
      ) {
        return json(res, 409, {
          ok: false,
          error: 'This Receiver execution attempt has expired.'
        });
      }
      if (
        !Number(receipt.audioFetchedAt || 0)
        || !['started', 'timed_out'].includes(receipt.status)
      ) {
        return json(res, 409, {
          ok: false,
          error: 'The current announcement audio has not been downloaded.'
        });
      }
      const watchdogScheduledFor = Number(receipt.watchdogScheduledFor || 0);
      if (
        !String(receipt.watchdogEmailId || '').trim()
        || !Number.isSafeInteger(watchdogScheduledFor)
        || watchdogScheduledFor < executionLeaseUntil
      ) {
        return json(res, 409, {
          ok: false,
          error: 'The recovery watchdog is not armed for this Receiver execution attempt.'
        });
      }
      await receiptUpdater(capability.eventId, {
        providerMode: 'email-wake-x',
        providerStatus: 'email_wake_execution_authorized',
        updatedAt: authorizedAt
      }, {
        executionAttempt: capability.executionAttempt,
        now: () => authorizedAt
      });
      return json(res, 200, {
        ok: true,
        version: 'x',
        receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
        eventId: capability.eventId,
        executionAttempt: capability.executionAttempt,
        authorized: true,
        authorizedAt
      });
    } catch (error) {
      const safe = error instanceof PushcutXReceiptError
        ? error
        : new PushcutXReceiptError('unavailable');
      return json(res, safe.statusCode, {
        ok: false,
        error: safe.message
      });
    }
  };
}

export default createEmailWakeExecuteXHandler();
