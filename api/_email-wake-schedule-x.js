import { createHash } from 'node:crypto';

import {
  createPushcutXReceipt,
  updatePushcutXReceipt
} from './_pushcut-receipts-x.js';
import {
  planPushcutXSchedule
} from './_pushcut-schedule-x.js';
import {
  activateEmailWakeXCommand,
  cancelEmailWakeX,
  createEmailWakeXManifestStore,
  EMAIL_WAKE_X_RECEIVER_CONTRACT,
  EMAIL_WAKE_X_SCHEDULE_HORIZON_DAYS,
  EmailWakeXError,
  emailWakeXNamespacedHashInput,
  emailWakeXHealth,
  enqueueEmailWakeXCommand,
  removeEmailWakeXCommand,
  sendEmailWakeX
} from './_email-wake-x.js';

const SCHEDULE_STALE_GRACE_MS = 10 * 60_000;
const RESEND_PACING_MS = 225;
const MAINTENANCE_TRIGGER_EARLY_MS = 5 * 60_000;
export const EMAIL_WAKE_X_MAINTENANCE_INTERVAL_DAYS = 21;

function fail(code) {
  throw new EmailWakeXError(code);
}

export function emailWakeXScheduleSourceFingerprint(
  stateInput,
  enabled = true,
  env = process.env
) {
  const state = stateInput && typeof stateInput === 'object' ? stateInput : {};
  const config = state.config && typeof state.config === 'object'
    ? state.config
    : {};
  return createHash('sha256')
    .update(emailWakeXNamespacedHashInput(JSON.stringify({
      enabled: enabled !== false,
      activeScheduleId: String(state.activeScheduleId || ''),
      config: {
        musicLevel: Number(config.musicLevel ?? 30),
        lightningRadiusMiles: Number(config.lightningRadiusMiles ?? 10),
        lightningHoldMinutes: Number(config.lightningHoldMinutes ?? 30)
      },
      announcements: Array.isArray(state.announcements)
        ? state.announcements
        : [],
      announcementSources: Array.isArray(state.announcementSources)
        ? state.announcementSources
        : [],
      schedules: Array.isArray(state.schedules)
        ? state.schedules
        : []
    }), env))
    .digest('hex')
    .slice(0, 48);
}

export function emailWakeXScheduleEventId(occurrence, env = process.env) {
  const digest = createHash('sha256')
    .update(emailWakeXNamespacedHashInput(
      `email-wake-x\0${occurrence.logicalId}\0${occurrence.fingerprint}`,
      env
    ))
    .digest('hex')
    .slice(0, 28);
  return `email-wake-x-sched-${occurrence.logicalId.slice(0, 20)}-${digest}`;
}

export function emailWakeXMaintenanceEventId(
  scheduledFor,
  env = process.env
) {
  const digest = createHash('sha256')
    .update(emailWakeXNamespacedHashInput(
      `email-wake-x-maintenance\0${scheduledFor}`,
      env
    ))
    .digest('hex')
    .slice(0, 40);
  return `email-wake-x-maintenance-${digest}`;
}

function commandFor(occurrence, now, env = process.env) {
  const eventId = emailWakeXScheduleEventId(occurrence, env);
  if (occurrence.action === 'volume') {
    return Object.freeze({
      schemaVersion: 1,
      version: 'x',
      action: 'volume',
      commandId: eventId,
      eventId,
      issuedAt: now,
      scheduledFor: occurrence.scheduledFor,
      source: 'schedule',
      receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
      musicPercent: 0,
      resumeMusic: false
    });
  }
  return Object.freeze({
    schemaVersion: 1,
    version: 'x',
    action: 'announce',
    commandId: eventId,
    eventId,
    issuedAt: now,
    scheduledFor: occurrence.scheduledFor,
    source: 'schedule',
    announcementMode: occurrence.announcementMode,
    announcementProvider: occurrence.announcementProvider,
    announcementAudioUrl: occurrence.announcementAudioUrl,
    announcementDurationSeconds: occurrence.announcementDurationSeconds,
    text: occurrence.text,
    label: occurrence.label,
    voice: occurrence.voice,
    instructions: occurrence.instructions,
    safety: false,
    receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT,
    voicePercent: 100,
    musicPercent: occurrence.musicPercent,
    resumeMusic: true
  });
}

function manifestEntry(occurrence, command, emailId, now) {
  return {
    logicalId: occurrence.logicalId,
    fingerprint: occurrence.fingerprint,
    eventId: command.eventId,
    emailId,
    scheduleId: occurrence.scheduleId,
    itemId: occurrence.itemId,
    action: command.action,
    scheduledFor: occurrence.scheduledFor,
    status: 'scheduled',
    updatedAt: now
  };
}

function publicManifest(manifest) {
  const occurrences = Object.values(manifest?.occurrences || {});
  const scheduled = occurrences
    .filter(item => item.status === 'scheduled' && Number(item.scheduledFor || 0) > 0)
    .sort((left, right) => left.scheduledFor - right.scheduledFor);
  const scheduledVolume = scheduled.filter(item => item.action === 'volume');
  const scheduledAnnouncements = scheduled.filter(item => item.action !== 'volume');
  return Object.freeze({
    version: 'x',
    transport: 'email-wake-x',
    durable: true,
    syncedAt: Number(manifest?.syncedAt || 0),
    horizonEnd: Number(manifest?.horizonEnd || 0),
    stateRevision: Number(manifest?.stateRevision || 0),
    enabled: manifest?.enabled === true,
    sourceFingerprint: String(manifest?.sourceFingerprint || ''),
    occurrenceCount: occurrences.length,
    scheduledCount: scheduled.length,
    announcementScheduledCount: scheduledAnnouncements.length,
    volumeScheduledCount: scheduledVolume.length,
    musicBrowserCount: Number(manifest?.musicBrowserCount || 0),
    maintenanceScheduled: manifest?.maintenance?.status === 'scheduled',
    maintenanceScheduledFor: Number(manifest?.maintenance?.scheduledFor || 0),
    nextScheduledFor: Number(scheduled[0]?.scheduledFor || 0),
    warnings: Array.isArray(manifest?.warnings)
      ? manifest.warnings.slice(0, 100)
      : []
  });
}

export async function renewEmailWakeXScheduleIfDue({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  manifestStore = createEmailWakeXManifestStore({
    env,
    fetchImpl,
    now,
    requireDurable: true
  }),
  stateReader,
  synchronizer = synchronizeEmailWakeXSchedule
} = {}) {
  if (!manifestStore?.durable || typeof stateReader !== 'function') {
    fail('durableUnavailable');
  }
  const renewalNow = Number(now());
  const manifest = await manifestStore.read();
  const maintenance = manifest?.maintenance;
  const maintenanceStatus = String(maintenance?.status || '');
  const scheduledFor = Number(maintenance?.scheduledFor || 0);
  const due = manifest?.enabled !== false
    && Boolean(maintenance?.eventId)
    && scheduledFor > 0
    && (
      maintenanceStatus === 'scheduling'
      || maintenanceStatus === 'cancel-pending'
      || (
        maintenanceStatus === 'scheduled'
        && scheduledFor <= renewalNow + MAINTENANCE_TRIGGER_EARLY_MS
      )
    );
  if (!due) {
    return Object.freeze({
      due: false,
      renewed: false,
      maintenanceScheduledFor: scheduledFor
    });
  }
  const canonical = await stateReader({ requireDurable: true });
  if (!canonical?.state) fail('durableUnavailable');
  const result = await synchronizer({
    state: canonical.state,
    enabled: true
  }, {
    env,
    fetchImpl,
    now,
    manifestStore,
    maintenanceTriggerEventId: String(maintenance.eventId || '')
  });
  return Object.freeze({
    due: true,
    renewed: result.maintenanceScheduled === 1
      || result.maintenanceUnchanged === 1,
    maintenanceScheduledFor: Number(result.maintenanceScheduledFor || 0)
  });
}

function browserMusicItemCount(state) {
  const activeId = String(state?.activeScheduleId || '');
  const active = Array.isArray(state?.schedules)
    ? state.schedules.find(schedule => String(schedule?.id || '') === activeId)
    : null;
  if (!active || active.enabled === false || active.mode !== 'time') return 0;
  return (Array.isArray(active.items) ? active.items : [])
    .filter(item => (
      item?.enabled !== false
      && ['controlled', 'apple', 'spotify'].includes(String(item?.action?.kind || ''))
    ))
    .length;
}

export async function readEmailWakeXScheduleStatus({
  manifestStore = createEmailWakeXManifestStore({ requireDurable: true })
} = {}) {
  if (!manifestStore?.durable) fail('durableUnavailable');
  return publicManifest(await manifestStore.read());
}

export async function synchronizeEmailWakeXSchedule({
  state,
  enabled = true
}, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  horizonDays = EMAIL_WAKE_X_SCHEDULE_HORIZON_DAYS,
  manifestStore = createEmailWakeXManifestStore({
    env,
    fetchImpl,
    now,
    requireDurable: true
  }),
  planner = planPushcutXSchedule,
  createReceipt = (command, options) => createPushcutXReceipt(command, options),
  updateReceipt = (eventId, patch, options) => updatePushcutXReceipt(eventId, patch, options),
  enqueueCommand = (command, options) => enqueueEmailWakeXCommand(command, options),
  activateCommand = (eventId, options) => activateEmailWakeXCommand(eventId, options),
  removeCommand = (eventId, options) => removeEmailWakeXCommand(eventId, options),
  sendWake = (wake, options) => sendEmailWakeX(wake, options),
  sendMaintenanceWake = (wake, options) => sendEmailWakeX(wake, options),
  cancelWake = (emailId, options) => cancelEmailWakeX(emailId, options),
  cancelMaintenanceWake = (emailId, options) => cancelEmailWakeX(emailId, options),
  maintenanceTriggerEventId = '',
  wait = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  const health = emailWakeXHealth(env);
  if (!health.ready) fail('notConfigured');
  if (!manifestStore?.durable || typeof manifestStore.withLock !== 'function') {
    fail('durableUnavailable');
  }
  return await manifestStore.withLock(async () => {
    const syncNow = Number(now());
    const requestedPlan = planner(state, {
      now: syncNow,
      horizonDays,
      includeStops: true
    });
    const plan = enabled === false
      ? {
          ...requestedPlan,
          occurrences: [],
          warnings: [
            ...requestedPlan.warnings,
            'Version X email-wake timed announcements are paused.'
          ]
        }
      : requestedPlan;
    if (
      plan.occurrences.some(item => item.announcementMode === 'natural-voice')
      && !String(env?.OPENAI_API_KEY || '').trim()
    ) fail('notConfigured');

    const previous = await manifestStore.read();
    const desired = new Map(plan.occurrences.map(item => [item.logicalId, item]));
    const musicBrowserCount = browserMusicItemCount(state);
    const sourceFingerprint = emailWakeXScheduleSourceFingerprint(
      state,
      enabled,
      env
    );
    let manifest = {
      schemaVersion: 1,
      version: 'x',
      transport: 'email-wake-x',
      syncedAt: syncNow,
      horizonEnd: Number(plan.horizonEnd || 0),
      stateRevision: Number(plan.stateRevision || 0),
      enabled: enabled !== false,
      sourceFingerprint,
      musicBrowserCount,
      warnings: Array.isArray(plan.warnings) ? plan.warnings.slice(0, 100) : [],
      occurrences: structuredClone(previous.occurrences || {}),
      maintenance: previous.maintenance
        ? structuredClone(previous.maintenance)
        : null
    };
    await manifestStore.write(manifest);
    let cancelled = 0;
    let scheduled = 0;
    let unchanged = 0;
    let maintenanceScheduled = 0;
    let maintenanceUnchanged = 0;
    let maintenanceCancelled = 0;
    let providerCalls = 0;
    const paceProvider = async () => {
      if (providerCalls > 0) await wait(RESEND_PACING_MS);
      providerCalls += 1;
    };

    for (const [logicalId, existing] of Object.entries(previous.occurrences || {})) {
      const occurrence = desired.get(logicalId);
      const same = occurrence
        && existing.status === 'scheduled'
        && existing.fingerprint === occurrence.fingerprint
        && existing.eventId === emailWakeXScheduleEventId(occurrence, env);
      if (same) {
        manifest.occurrences[logicalId] = {
          ...existing,
          updatedAt: syncNow
        };
        desired.delete(logicalId);
        unchanged += 1;
        continue;
      }
      const resumable = occurrence
        && existing.status === 'scheduling'
        && existing.fingerprint === occurrence.fingerprint
        && existing.eventId === emailWakeXScheduleEventId(occurrence, env);
      if (resumable) continue;

      manifest.occurrences[logicalId] = {
        ...existing,
        status: 'cancel-pending',
        updatedAt: syncNow
      };
      await manifestStore.write(manifest);
      const stillFuture = Number(existing.scheduledFor || 0) > syncNow;
      if (stillFuture) {
        if (existing.emailId) {
          await paceProvider();
          await cancelWake(existing.emailId, {
            env,
            fetchImpl,
            now: () => syncNow
          });
        }
        if (existing.eventId) {
          await removeCommand(existing.eventId, {
            env,
            fetchImpl,
            now: () => syncNow,
            requireDurable: true
          });
          await updateReceipt(existing.eventId, {
            status: 'failed',
            providerStatus: 'email_wake_schedule_cancelled',
            failedAt: syncNow,
            failureCode: 'schedule_cancelled'
          }, {
            env,
            fetchImpl,
            now: () => syncNow,
            requireDurable: true
          }).catch(() => {});
        }
      } else if (
        Number(existing.scheduledFor || 0) > 0
        && Number(existing.scheduledFor) + SCHEDULE_STALE_GRACE_MS < syncNow
        && existing.eventId
      ) {
        await removeCommand(existing.eventId, {
          env,
          fetchImpl,
          now: () => syncNow,
          requireDurable: true
        });
        await updateReceipt(existing.eventId, {
          status: 'failed',
          providerStatus: 'email_wake_schedule_missed',
          failedAt: syncNow,
          failureCode: 'schedule_missed'
        }, {
          env,
          fetchImpl,
          now: () => syncNow,
          requireDurable: true
        }).catch(() => {});
      }
      delete manifest.occurrences[logicalId];
      await manifestStore.write(manifest);
      cancelled += 1;
    }

    for (const [logicalId, occurrence] of desired) {
      const command = commandFor(occurrence, syncNow, env);
      manifest.occurrences[logicalId] = {
        logicalId,
        fingerprint: occurrence.fingerprint,
        eventId: command.eventId,
        emailId: '',
        scheduleId: occurrence.scheduleId,
        itemId: occurrence.itemId,
        scheduledFor: occurrence.scheduledFor,
        status: 'scheduling',
        updatedAt: syncNow
      };
      await manifestStore.write(manifest);
      await createReceipt(command, {
        env,
        fetchImpl,
        now: () => syncNow,
        requireDurable: true
      });
      await enqueueCommand(command, {
        env,
        fetchImpl,
        now: () => syncNow,
        requireDurable: true
      });
      await paceProvider();
      const wake = await sendWake({
        eventId: command.eventId,
        scheduledFor: occurrence.scheduledFor
      }, {
        env,
        fetchImpl,
        now: () => syncNow
      });
      await activateCommand(command.eventId, {
        env,
        fetchImpl,
        now: () => syncNow,
        requireDurable: true
      });
      manifest.occurrences[logicalId] = manifestEntry(
        occurrence,
        command,
        wake.emailId,
        syncNow
      );
      await manifestStore.write(manifest);
      scheduled += 1;
    }

    const maintenanceWanted = enabled !== false && plan.occurrences.length > 0;
    const existingMaintenance = manifest.maintenance;
    const existingMaintenanceFuture = Number(existingMaintenance?.scheduledFor || 0) > syncNow;
    const maintenanceRenewalRequested = Boolean(maintenanceTriggerEventId)
      && String(existingMaintenance?.eventId || '') === String(maintenanceTriggerEventId)
      && Number(existingMaintenance?.scheduledFor || 0)
        <= syncNow + MAINTENANCE_TRIGGER_EARLY_MS;
    const preserveMaintenance = maintenanceWanted
      && !maintenanceRenewalRequested
      && existingMaintenance?.status === 'scheduled'
      && existingMaintenanceFuture
      && Boolean(existingMaintenance.emailId);

    if (preserveMaintenance) {
      maintenanceUnchanged = 1;
    } else {
      if (
        existingMaintenance?.emailId
        && (
          existingMaintenanceFuture
          || existingMaintenance.status === 'cancel-pending'
          || maintenanceRenewalRequested
        )
      ) {
        manifest.maintenance = {
          ...existingMaintenance,
          status: 'cancel-pending',
          updatedAt: syncNow
        };
        await manifestStore.write(manifest);
        await paceProvider();
        await cancelMaintenanceWake(existingMaintenance.emailId, {
          env,
          fetchImpl,
          now: () => syncNow
        });
        maintenanceCancelled = 1;
      }

      if (!maintenanceWanted) {
        manifest.maintenance = null;
        await manifestStore.write(manifest);
      } else {
        const resumableMaintenance = existingMaintenance?.status === 'scheduling'
          && Number(existingMaintenance.scheduledFor || 0) >= syncNow + 5_000
          && Boolean(existingMaintenance.eventId);
        const maintenanceScheduledFor = resumableMaintenance
          ? Number(existingMaintenance.scheduledFor)
          : syncNow
            + EMAIL_WAKE_X_MAINTENANCE_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
        const eventId = resumableMaintenance
          ? existingMaintenance.eventId
          : emailWakeXMaintenanceEventId(maintenanceScheduledFor, env);
        manifest.maintenance = {
          eventId,
          emailId: resumableMaintenance ? String(existingMaintenance.emailId || '') : '',
          scheduledFor: maintenanceScheduledFor,
          status: 'scheduling',
          updatedAt: syncNow
        };
        await manifestStore.write(manifest);
        await paceProvider();
        const maintenanceWake = await sendMaintenanceWake({
          eventId,
          scheduledFor: maintenanceScheduledFor
        }, {
          env,
          fetchImpl,
          now: () => syncNow
        });
        manifest.maintenance = {
          eventId,
          emailId: maintenanceWake.emailId,
          scheduledFor: maintenanceScheduledFor,
          status: 'scheduled',
          updatedAt: syncNow
        };
        await manifestStore.write(manifest);
        maintenanceScheduled = 1;
      }
    }

    manifest = {
      ...manifest,
      syncedAt: syncNow,
      occurrences: manifest.occurrences
    };
    await manifestStore.write(manifest);
    return Object.freeze({
      ...publicManifest(manifest),
      scheduled,
      unchanged,
      cancelled,
      maintenanceScheduled,
      maintenanceUnchanged,
      maintenanceCancelled
    });
  });
}
