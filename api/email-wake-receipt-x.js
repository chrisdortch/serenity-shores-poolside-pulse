import { createHash } from 'node:crypto';

import {
  readJsonBody,
  sessionVariant
} from './_auth.js';
import {
  EMAIL_WAKE_X_RECEIVER_CONTRACT,
  cancelEmailWakeX,
  EmailWakeXError,
  emailWakeXNamespacedHashInput,
  nextReadyEmailWakeXEventId,
  removeEmailWakeXCommand,
  sendEmailWakeX
} from './_email-wake-x.js';
import {
  publicPushcutXReceipt,
  PushcutXReceiptError,
  pushcutXReceiptExecutionAttemptMatches,
  pushcutXReceiptStorageHealth,
  readPushcutXReceipt,
  repairLatestCompletedPushcutXReceipt,
  updatePushcutXReceipt,
  verifiedPushcutXCompletion
} from './_pushcut-receipts-x.js';
import {
  readPushcutXCapability,
  verifyPushcutXCapability
} from './_pushcut-security-x.js';

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

function validMusicPercent(value) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 100;
}

function verifiedGetCompletion(existing) {
  const recoveryOnly = existing?.executionMode === 'recovery';
  const volumeOnly = existing?.action === 'volume';
  const restoredMusicPercent = volumeOnly
    ? existing?.musicPercent
    : existing?.restoreTargetMusicPercent;
  return {
    eventId: String(existing?.eventId || ''),
    status: recoveryOnly ? 'failed' : 'completed',
    receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
    ...(recoveryOnly
      ? { failureCode: 'retry_exhausted_recovered' }
      : {}),
    volumeRestored: true,
    restoredMusicPercent,
    musicResumed: !volumeOnly
  };
}

function validVerifiedGetState(existing) {
  const action = String(existing?.action || '');
  const executionMode = String(existing?.executionMode || '');
  if (String(existing?.providerMode || '') !== 'email-wake-x') return false;
  if (action === 'volume') {
    return executionMode === 'volume'
      && validMusicPercent(existing?.musicPercent);
  }
  if (action !== 'announce') return false;
  return (
    executionMode === 'announcement'
    || executionMode === 'recovery'
  ) && validMusicPercent(existing?.restoreTargetMusicPercent);
}

function validAnnouncementCompletion(existing, body) {
  const expectedMusicPercent = existing.restoreTargetMusicPercent;
  const restoredMusicPercent = body?.restoredMusicPercent;
  const restoreTargetResolvedAt = Number(existing.restoreTargetResolvedAt || 0);
  const audioFetchedAt = Number(existing.audioFetchedAt || 0);
  return Number.isSafeInteger(audioFetchedAt)
    && audioFetchedAt > 0
    && Number.isSafeInteger(restoreTargetResolvedAt)
    && restoreTargetResolvedAt >= audioFetchedAt
    && validMusicPercent(expectedMusicPercent)
    && typeof restoredMusicPercent === 'number'
    && Number.isFinite(restoredMusicPercent)
    && restoredMusicPercent === expectedMusicPercent
    && body?.volumeRestored === true
    && body?.musicResumed === true;
}

function validVolumeCompletion(existing, body) {
  return validMusicPercent(existing?.musicPercent)
    && typeof body?.restoredMusicPercent === 'number'
    && Number.isFinite(body.restoredMusicPercent)
    && body.restoredMusicPercent === existing.musicPercent
    && body?.volumeRestored === true
    && body?.musicResumed === false;
}

function validRecoveryCompletion(existing, body) {
  const expectedMusicPercent = existing.restoreTargetMusicPercent;
  const resolvedAt = Number(existing.restoreTargetResolvedAt || 0);
  return validMusicPercent(expectedMusicPercent)
    && Number.isSafeInteger(resolvedAt)
    && resolvedAt > 0
    && typeof body?.restoredMusicPercent === 'number'
    && Number.isFinite(body.restoredMusicPercent)
    && body.restoredMusicPercent === expectedMusicPercent
    && body?.volumeRestored === true
    && body?.musicResumed === true;
}

export function emailWakeXDrainEventId(
  completedEventId,
  nextEventId,
  env = process.env
) {
  const digest = createHash('sha256')
    .update(emailWakeXNamespacedHashInput(
      `${completedEventId}\0${nextEventId}`,
      env
    ))
    .digest('hex')
    .slice(0, 40);
  return `email-wake-x-drain-${digest}`;
}

export function createEmailWakeReceiptXHandler({
  receiptReader = readPushcutXReceipt,
  receiptUpdater = updatePushcutXReceipt,
  latestRepairer = repairLatestCompletedPushcutXReceipt,
  commandRemover = removeEmailWakeXCommand,
  nextReadyReader = nextReadyEmailWakeXEventId,
  wakeSender = sendEmailWakeX,
  watchdogWakeCanceller = cancelEmailWakeX,
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
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { ok: false, error: 'GET or POST required.' });
    }
    const capability = readPushcutXCapability(req);
    if (!verifyPushcutXCapability(capability, 'receipt', { env, now })) {
      return json(res, 403, {
        ok: false,
        error: 'The email-wake receipt link is invalid or expired.'
      });
    }
    const verifiedGet = req.method === 'GET';
    if (
      verifiedGet
      && (
        capability.version !== 3
        || !Number.isSafeInteger(capability.executionAttempt)
        || capability.executionAttempt < 1
      )
    ) {
      return json(res, 403, {
        ok: false,
        error: 'An attempt-bound completion link is required.'
      });
    }
    let body = null;
    if (req.method === 'POST') {
      try {
        body = await readJsonBody(req, MAX_RECEIPT_BYTES);
      } catch {
        return json(res, 400, { ok: false, error: 'Invalid receipt body.' });
      }
    }
    const eventId = String(
      verifiedGet
        ? capability.eventId
        : body?.eventId || capability.eventId
    ).trim();
    let status = String(body?.status || '').trim().toLowerCase();
    if (!verifiedGet) {
      if (
        eventId !== capability.eventId
        || !RECEIPT_STATUSES.has(status)
        || String(body?.receiverContract || '') !== EMAIL_WAKE_X_RECEIVER_CONTRACT
      ) {
        return json(res, 400, {
          ok: false,
          error: 'The email-wake receipt is invalid.'
        });
      }
    }
    try {
      const finishExecution = async () => {
        await commandRemover(eventId, { requireDurable: true });
        const nextEventId = await nextReadyReader({ requireDurable: true });
        if (nextEventId) {
          await wakeSender({
            eventId: emailWakeXDrainEventId(eventId, nextEventId, env)
          });
        }
        // Keep the already-accepted watchdog until the queue is either empty
        // or a deterministic drain wake for the next command is accepted. If
        // the provider call above fails, that watchdog is the durable retry.
        if (existing?.watchdogEmailId) {
          await watchdogWakeCanceller(existing.watchdogEmailId).catch(() => {});
        }
      };
      const existing = await receiptReader(eventId);
      if (!existing) throw new PushcutXReceiptError('notFound');
      if (existing.receiverContract !== EMAIL_WAKE_X_RECEIVER_CONTRACT) {
        return json(res, 409, {
          ok: false,
          error: 'This command was created for a different Receiver contract.'
        });
      }
      if (!pushcutXReceiptExecutionAttemptMatches(
        existing,
        capability.executionAttempt
      )) {
        return json(res, 409, {
          ok: false,
          error: 'This Receiver execution attempt is stale.'
        });
      }
      if (verifiedGet) {
        if (!validVerifiedGetState(existing)) {
          return json(res, 409, {
            ok: false,
            error: 'This Receiver execution state cannot be completed by GET.'
          });
        }
        body = verifiedGetCompletion(existing);
        status = body.status;
        if (
          ['completed', 'failed'].includes(existing.status)
          && existing.status !== status
        ) {
          return json(res, 409, {
            ok: false,
            error: 'This Receiver execution already has a different terminal result.'
          });
        }
      }
      const recoveryOnly = existing.executionMode === 'recovery';
      if (recoveryOnly && status !== 'failed') {
        return json(res, 409, {
          ok: false,
          error: 'A recovery-only claim must finish as a recovered failure.'
        });
      }
      if (status === 'completed') {
        const valid = existing.action === 'volume'
          ? validVolumeCompletion(existing, body)
          : validAnnouncementCompletion(existing, body);
        if (!valid) {
          return json(res, 409, {
            ok: false,
            error: 'The Receiver did not prove the requested volume and playback result.'
          });
        }
      }
      if (recoveryOnly && !validRecoveryCompletion(existing, body)) {
        return json(res, 409, {
          ok: false,
          error: 'The Receiver did not prove that recovery restored music playback.'
        });
      }
      if (
        existing.status === status
        && (
          (
            status === 'failed'
            && (
              !recoveryOnly
              || validRecoveryCompletion(existing, existing)
            )
          )
          || (status === 'completed' && verifiedPushcutXCompletion(existing))
        )
      ) {
        if (status === 'completed') await latestRepairer(eventId);
        if (status !== 'started') await finishExecution();
        return json(res, 200, {
          ok: true,
          version: 'x',
          receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
          receipt: publicPushcutXReceipt(existing, {
            durable: pushcutXReceiptStorageHealth().durable
          })
        });
      }

      const timestamp = Number(now());
      const patch = status === 'completed'
        ? {
            status: 'completed',
            providerMode: 'email-wake-x',
            providerStatus: 'email_wake_receiver_completed',
            completedAt: timestamp,
            volumeRestored: true,
            restoredMusicPercent: body.restoredMusicPercent,
            musicResumed: body.musicResumed
          }
        : status === 'started'
          ? {
              status: 'started',
              providerMode: 'email-wake-x',
              providerStatus: 'email_wake_receiver_started',
              startedAt: existing.startedAt || timestamp
            }
          : {
              status: 'failed',
              providerMode: 'email-wake-x',
              providerStatus: recoveryOnly
                ? 'email_wake_recovery_completed'
                : 'email_wake_receiver_failed',
              failedAt: timestamp,
              failureCode: recoveryOnly
                ? 'retry_exhausted_recovered'
                : String(body?.failureCode || 'receiver_shortcut_failed'),
              ...(recoveryOnly ? {
                volumeRestored: true,
                restoredMusicPercent: body.restoredMusicPercent,
                musicResumed: true
              } : {})
            };
      const updated = await receiptUpdater(eventId, patch, {
        executionAttempt: capability.executionAttempt,
        now: () => timestamp
      });
      const updatedResultValid = updated?.status === status
        && (
          status === 'started'
          || (
            status === 'completed'
            && verifiedPushcutXCompletion(updated)
          )
          || (
            status === 'failed'
            && (
              !recoveryOnly
              || validRecoveryCompletion(updated, updated)
            )
          )
        );
      if (!updatedResultValid) {
        return json(res, 409, {
          ok: false,
          error: 'The Receiver completion state could not be recorded.'
        });
      }
      if (status !== 'started') {
        // This removes the claimed queue item and atomically releases the
        // receiver-wide execution lease for the next wake.
        await finishExecution();
      }
      return json(res, 200, {
        ok: true,
        version: 'x',
        receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
        receipt: publicPushcutXReceipt(updated, {
          durable: pushcutXReceiptStorageHealth().durable
        })
      });
    } catch (error) {
      const safe = error instanceof PushcutXReceiptError
        || error instanceof EmailWakeXError
        ? error
        : new PushcutXReceiptError('unavailable');
      return json(res, safe.statusCode, { ok: false, error: safe.message });
    }
  };
}

export default createEmailWakeReceiptXHandler();
