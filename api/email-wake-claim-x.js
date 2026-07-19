import { createHash } from 'node:crypto';

import {
  clientIp,
  consumeRateLimit
} from './_auth.js';
import {
  authenticateEmailWakeXReceiver,
  cancelEmailWakeX,
  claimEmailWakeXCommand,
  createSignedEmailWakeXUrl,
  EMAIL_WAKE_X_MAX_ANNOUNCEMENT_ATTEMPTS,
  EMAIL_WAKE_X_RECOVERY_ATTEMPT,
  EMAIL_WAKE_X_RECEIVER_CONTRACT,
  EmailWakeXError,
  emailWakeXNamespacedHashInput,
  emailWakeXHealth,
  requeueEmailWakeXCommand,
  removeEmailWakeXCommand,
  sendEmailWakeX
} from './_email-wake-x.js';
import {
  prepareEmailWakeXReceiptAttempt,
  readPushcutXReceipt,
  updatePushcutXReceipt
} from './_pushcut-receipts-x.js';
import {
  renewEmailWakeXScheduleIfDue
} from './_email-wake-schedule-x.js';
import {
  PUSHCUT_X_DEFAULT_RECOVERY_SHORTCUT
} from './_pushcut-x.js';
import {
  readCanonicalVersionXState
} from './state-x.js';

const RATE_WINDOW_MS = 60_000;
const CLAIM_LOOP_LIMIT = 5;
const SCHEDULE_MAX_LATENESS_MS = 10 * 60_000;
const MAINTENANCE_RETRY_BUCKET_MS = 5 * 60_000;
export {
  EMAIL_WAKE_X_MAX_ANNOUNCEMENT_ATTEMPTS,
  EMAIL_WAKE_X_RECOVERY_ATTEMPT
} from './_email-wake-x.js';

export const maxDuration = 300;

function header(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function bearerToken(req) {
  const authorization = header(req, 'authorization').trim();
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return String(match?.[1] || header(req, 'x-poolside-receiver-token')).trim();
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Authorization');
  res.end(JSON.stringify({ serverTime: Date.now(), ...body }));
}

export function emailWakeXWatchdogEventId(
  eventId,
  claimAttempt,
  leaseUntil,
  env = process.env
) {
  const digest = createHash('sha256')
    .update(emailWakeXNamespacedHashInput(
      `${eventId}\0${claimAttempt}\0${leaseUntil}`,
      env
    ))
    .digest('hex')
    .slice(0, 40);
  return `email-wake-x-watchdog-${digest}`;
}

export function emailWakeXClaimRetryEventId(
  eventId,
  claimAttempt,
  leaseUntil,
  env = process.env
) {
  const digest = createHash('sha256')
    .update(emailWakeXNamespacedHashInput(
      `email-wake-x-claim-retry\0${eventId}\0${claimAttempt}\0${leaseUntil}`,
      env
    ))
    .digest('hex')
    .slice(0, 40);
  return `email-wake-x-claim-retry-${digest}`;
}

export function emailWakeXMaintenanceRetryWake(
  now,
  env = process.env
) {
  const bucket = Math.floor(now / MAINTENANCE_RETRY_BUCKET_MS);
  const scheduledFor = (bucket + 7) * MAINTENANCE_RETRY_BUCKET_MS;
  const digest = createHash('sha256')
    .update(emailWakeXNamespacedHashInput(
      `email-wake-x-maintenance-retry\0${bucket}`,
      env
    ))
    .digest('hex')
    .slice(0, 40);
  return Object.freeze({
    eventId: `email-wake-x-maintenance-retry-${digest}`,
    scheduledFor
  });
}

function receiverCommand(req, command, {
  executionAttempt,
  recoveryOnly = false
} = {}) {
  const capabilityOptions = {
    ttlSeconds: 30 * 60,
    executionAttempt
  };
  const receipt = createSignedEmailWakeXUrl(
    req,
    '/api/email-wake-receipt-x',
    command.eventId,
    'receipt',
    capabilityOptions
  );
  if (!receipt) throw new EmailWakeXError('notConfigured');
  if (command.action === 'volume') {
    return Object.freeze({
      schemaVersion: 1,
      version: 'x',
      transport: 'email-wake-x',
      receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
      action: 'volume',
      commandId: command.commandId,
      eventId: command.eventId,
      source: command.source,
      executionAttempt,
      musicPercent: Number(command.musicPercent),
      musicLevel: Number((Number(command.musicPercent) / 100).toFixed(6)),
      receiptUrl: receipt.url,
      receiptExpiresAt: receipt.expiresAt,
      resumeMusic: false
    });
  }
  if (recoveryOnly) {
    const musicPercent = Number.isFinite(Number(command.musicPercent))
      ? Math.max(0, Math.min(100, Number(command.musicPercent)))
      : 30;
    const restore = createSignedEmailWakeXUrl(
      req,
      '/api/email-wake-restore-x',
      command.eventId,
      'restore',
      capabilityOptions
    );
    if (!restore) throw new EmailWakeXError('notConfigured');
    return Object.freeze({
      schemaVersion: 1,
      version: 'x',
      transport: 'email-wake-x',
      receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
      action: 'recover',
      originalAction: String(command.action || 'announce'),
      commandId: command.commandId,
      eventId: command.eventId,
      source: command.source,
      executionAttempt,
      recoveryOnly: true,
      musicPercent,
      musicLevel: Number((musicPercent / 100).toFixed(6)),
      restoreUrl: restore.url,
      restoreExpiresAt: restore.expiresAt,
      receiptUrl: receipt.url,
      receiptExpiresAt: receipt.expiresAt,
      completionStatus: 'failed',
      failureCode: 'retry_exhausted_recovery_required',
      resumeMusic: true
    });
  }
  const capabilities = {
    audio: createSignedEmailWakeXUrl(
      req,
      '/api/pushcut-audio-x',
      command.eventId,
      'audio',
      capabilityOptions
    ),
    execute: createSignedEmailWakeXUrl(
      req,
      '/api/email-wake-execute-x',
      command.eventId,
      'execute',
      capabilityOptions
    ),
    receipt,
    restore: createSignedEmailWakeXUrl(
      req,
      '/api/email-wake-restore-x',
      command.eventId,
      'restore',
      capabilityOptions
    )
  };
  if (
    !capabilities.audio
    || !capabilities.execute
    || !capabilities.receipt
    || !capabilities.restore
  ) {
    throw new EmailWakeXError('notConfigured');
  }
  const {
    announcementAudioUrl: _privateAnnouncementAudioUrl,
    ...safeCommand
  } = command;
  return Object.freeze({
    ...safeCommand,
    executionAttempt,
    transport: 'email-wake-x',
    receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
    speechMode: command.announcementMode === 'finite-audio'
      ? 'finite-audio'
      : 'natural-audio',
    audioUrl: capabilities.audio.url,
    audioExpiresAt: capabilities.audio.expiresAt,
    executeUrl: capabilities.execute.url,
    executeExpiresAt: capabilities.execute.expiresAt,
    receiptUrl: capabilities.receipt.url,
    receiptExpiresAt: capabilities.receipt.expiresAt,
    restoreUrl: capabilities.restore.url,
    restoreExpiresAt: capabilities.restore.expiresAt,
    recoveryShortcut: PUSHCUT_X_DEFAULT_RECOVERY_SHORTCUT,
    voicePercent: 100,
    announcementLevel: 1,
    musicLevel: Number((Number(command.musicPercent ?? 30) / 100).toFixed(6)),
    resumeMusic: true
  });
}

export function createEmailWakeClaimXHandler({
  receiverAuthenticator = authenticateEmailWakeXReceiver,
  commandClaimer = claimEmailWakeXCommand,
  commandRequeuer = requeueEmailWakeXCommand,
  commandRemover = removeEmailWakeXCommand,
  receiptReader = readPushcutXReceipt,
  receiptUpdater = updatePushcutXReceipt,
  receiptAttemptPreparer = prepareEmailWakeXReceiptAttempt,
  watchdogWakeSender = sendEmailWakeX,
  watchdogWakeCanceller = cancelEmailWakeX,
  claimRetryWakeSender = sendEmailWakeX,
  maintenanceRenewer = renewEmailWakeXScheduleIfDue,
  maintenanceStateReader = readCanonicalVersionXState,
  maintenanceRetryWakeSender = sendEmailWakeX,
  env = process.env,
  now = Date.now
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return json(res, 405, { ok: false, error: 'GET or POST required.' });
    }
    const rate = consumeRateLimit(`email-wake:x:claim:${clientIp(req)}`, {
      limit: 90,
      windowMs: RATE_WINDOW_MS
    });
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return json(res, 429, {
        ok: false,
        error: 'Too many receiver claim requests. Try again shortly.'
      });
    }
    if (!emailWakeXHealth(env).queueReady) {
      return json(res, 503, {
        ok: false,
        error: 'Durable Version X email wake storage is not configured.'
      });
    }
    try {
      const authenticated = await receiverAuthenticator(bearerToken(req), {
        requireDurable: true
      });
      if (!authenticated) throw new EmailWakeXError('unauthorized');
      let maintenanceDue = false;
      let maintenanceRenewed = false;
      let maintenanceRetryScheduled = false;
      try {
        const renewal = await maintenanceRenewer({
          env,
          stateReader: maintenanceStateReader,
          now
        });
        maintenanceDue = renewal?.due === true;
        maintenanceRenewed = renewal?.renewed === true;
      } catch {
        try {
          await maintenanceRetryWakeSender(
            emailWakeXMaintenanceRetryWake(Number(now()), env)
          );
          maintenanceRetryScheduled = true;
        } catch {}
      }
      for (let index = 0; index < CLAIM_LOOP_LIMIT; index += 1) {
        const claimed = await commandClaimer({ requireDurable: true });
        if (!claimed?.item) {
          return json(res, 200, {
            ok: true,
            version: 'x',
            service: 'email-wake-claim-x',
            pending: false,
            busy: claimed?.busy === true,
            maintenanceDue,
            maintenanceRenewed,
            maintenanceRetryScheduled
          });
        }
        const command = claimed.item.command;
        const claimAttempt = Number(claimed.item.claimAttempt || 0);
        const leaseUntil = Number(claimed.item.leaseUntil || 0);
        const claimNow = Number(now());
        const watchdogEventId = command?.eventId
          ? emailWakeXWatchdogEventId(
              command.eventId,
              claimAttempt,
              leaseUntil,
              env
            )
          : '';
        let watchdogEmailId = '';
        let watchdogScheduled = false;
        if (
          command
          && leaseUntil >= claimNow + 5_000
          && emailWakeXHealth(env).wakeReady
        ) {
          try {
            const watchdog = await watchdogWakeSender({
              eventId: watchdogEventId,
              scheduledFor: leaseUntil
            });
            watchdogEmailId = String(watchdog?.emailId || '').trim();
            if (!watchdogEmailId) {
              throw new Error('The recovery watchdog provider returned no identifier.');
            }
            watchdogScheduled = true;
          } catch {
            let requeued = false;
            let retryWakeScheduled = false;
            try {
              const rollback = await commandRequeuer(
                command.eventId,
                claimAttempt,
                {
                  requireDurable: true,
                  now: () => claimNow
                }
              );
              requeued = rollback?.requeued === true;
            } catch {}
            if (requeued) {
              try {
                const retryWake = await claimRetryWakeSender({
                  eventId: emailWakeXClaimRetryEventId(
                    command.eventId,
                    claimAttempt,
                    leaseUntil,
                    env
                  )
                });
                retryWakeScheduled = Boolean(String(retryWake?.emailId || '').trim());
              } catch {}
            }
            return json(res, 503, {
              ok: false,
              version: 'x',
              service: 'email-wake-claim-x',
              error: requeued
                ? 'The Receiver safety watchdog could not be armed. The command remains queued for a safe retry.'
                : 'The Receiver safety watchdog could not be armed and the active claim could not be rolled back.',
              pending: requeued,
              retryPending: requeued,
              retryWakeScheduled,
              maintenanceDue,
              maintenanceRenewed,
              maintenanceRetryScheduled
            });
          }
        } else {
          let requeued = false;
          if (command?.eventId) {
            try {
              const rollback = await commandRequeuer(
                command.eventId,
                claimAttempt,
                {
                  requireDurable: true,
                  now: () => claimNow
                }
              );
              requeued = rollback?.requeued === true;
            } catch {}
          }
          return json(res, 503, {
            ok: false,
            version: 'x',
            service: 'email-wake-claim-x',
            error: requeued
              ? 'The Receiver safety watchdog is unavailable. The command remains queued.'
              : 'The Receiver safety watchdog is unavailable and the active claim could not be rolled back.',
            pending: requeued,
            retryPending: requeued,
            retryWakeScheduled: false,
            maintenanceDue,
            maintenanceRenewed,
            maintenanceRetryScheduled
          });
        }
        const receipt = command?.eventId
          ? await receiptReader(command.eventId, { requireDurable: true })
          : null;
        if (!command || !receipt || receipt.status === 'completed' || receipt.status === 'failed') {
          if (command?.eventId) {
            await commandRemover(command.eventId, { requireDurable: true });
          }
          if (watchdogEmailId) {
            await watchdogWakeCanceller(watchdogEmailId).catch(() => {});
          }
          continue;
        }
        if (
          claimAttempt === 1
          &&
          Number(command.scheduledFor || 0) > 0
          && Number(command.scheduledFor) + SCHEDULE_MAX_LATENESS_MS < claimNow
        ) {
          await receiptUpdater(command.eventId, {
            status: 'failed',
            providerMode: 'email-wake-x',
            providerStatus: 'email_wake_schedule_missed',
            failedAt: claimNow,
            failureCode: 'schedule_missed',
            updatedAt: claimNow
          }, {
            requireDurable: true,
            now: () => claimNow
          });
          await commandRemover(command.eventId, { requireDurable: true });
          if (watchdogEmailId) {
            await watchdogWakeCanceller(watchdogEmailId).catch(() => {});
          }
          continue;
        }
        const announcementCommand = command.action !== 'volume';
        const recoveryOnly = announcementCommand
          && claimAttempt >= EMAIL_WAKE_X_RECOVERY_ATTEMPT;
        const executionMode = recoveryOnly
          ? 'recovery'
          : command.action === 'volume'
            ? 'volume'
            : 'announcement';
        if (receipt.receiverContract === EMAIL_WAKE_X_RECEIVER_CONTRACT) {
          await receiptAttemptPreparer(
            command.eventId,
            claimAttempt,
            {
              mode: executionMode,
              leaseUntil,
              requireDurable: true,
              now: () => claimNow
            }
          );
        }
        await receiptUpdater(command.eventId, {
          providerMode: 'email-wake-x',
          providerStatus: recoveryOnly
            ? 'email_wake_recovery_claimed'
            : 'email_wake_claimed',
          updatedAt: claimNow
        }, {
          executionAttempt: claimAttempt,
          requireDurable: true,
          now: () => claimNow
        });
        await receiptUpdater(command.eventId, {
          watchdogEmailId,
          watchdogScheduledFor: leaseUntil,
          updatedAt: claimNow
        }, {
          executionAttempt: claimAttempt,
          requireDurable: true,
          now: () => claimNow
        });
        return json(res, 200, {
          ok: true,
          service: 'email-wake-claim-x',
          pending: true,
          reclaimed: claimAttempt > 1,
          leaseUntil,
          watchdogScheduled,
          watchdogScheduledFor: watchdogScheduled ? leaseUntil : 0,
          maintenanceDue,
          maintenanceRenewed,
          maintenanceRetryScheduled,
          ...receiverCommand(req, command, {
            executionAttempt: claimAttempt,
            recoveryOnly
          })
        });
      }
      return json(res, 200, {
        ok: true,
        version: 'x',
        service: 'email-wake-claim-x',
        pending: false,
        busy: false,
        maintenanceDue,
        maintenanceRenewed,
        maintenanceRetryScheduled
      });
    } catch (error) {
      const safe = error instanceof EmailWakeXError
        ? error
        : new EmailWakeXError('durableUnavailable');
      if (safe.code === 'unauthorized') {
        res.setHeader('WWW-Authenticate', 'Bearer realm="Poolside Pulse X Receiver"');
      }
      return json(res, safe.statusCode, { ok: false, error: safe.message });
    }
  };
}

export default createEmailWakeClaimXHandler();
