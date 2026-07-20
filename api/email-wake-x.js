import {
  clientIp,
  consumeRateLimit,
  readJsonBody,
  requireSession,
  sessionVariant
} from './_auth.js';
import {
  activateEmailWakeXCommand,
  EmailWakeXError,
  EMAIL_WAKE_X_RECEIVER_CONTRACT,
  emailWakeXExecutionStatus,
  emailWakeXHealth,
  emailWakeXReceiverStatus,
  emailWakeXSetup,
  enqueueEmailWakeXCommand,
  sendEmailWakeX
} from './_email-wake-x.js';
import {
  publicPushcutXReceipt,
  createPushcutXReceipt,
  PushcutXReceiptError,
  readPushcutXReceipt,
  updatePushcutXReceipt
} from './_pushcut-receipts-x.js';
import {
  pushcutXCapabilityReady
} from './_pushcut-security-x.js';
import {
  PushcutXError,
  validPushcutXEventId
} from './_pushcut-x.js';
import {
  resolveCanonicalPushcutXCommand
} from './pushcut-x.js';

const RATE_WINDOW_MS = 60_000;
const MAX_REQUEST_BYTES = 12_000;

function header(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function queryValue(req, name) {
  try {
    const value = new URL(String(req?.url || ''), 'https://poolside.local')
      .searchParams
      .get(name);
    if (value != null) return value;
  } catch {}
  const value = req?.query?.[name];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function volumeCommand(body, now = Date.now()) {
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || body.version !== 'x'
    || body.action !== 'volume'
    || body.source !== 'live'
    || Object.keys(body).some(key => ![
      'action',
      'eventId',
      'musicPercent',
      'source',
      'version'
    ].includes(key))
    || !validPushcutXEventId(body.eventId)
    || !Number.isInteger(body.musicPercent)
    || body.musicPercent < 0
    || body.musicPercent > 100
  ) {
    throw new PushcutXError('invalid');
  }
  return Object.freeze({
    schemaVersion: 1,
    version: 'x',
    action: 'volume',
    commandId: body.eventId.trim(),
    eventId: body.eventId.trim(),
    issuedAt: now,
    source: 'live',
    announcementMode: 'natural-voice',
    announcementProvider: '',
    announcementAudioUrl: '',
    announcementDurationSeconds: 0,
    text: 'Version X receiver volume update.',
    label: 'Music volume',
    safety: false,
    voicePercent: 100,
    musicPercent: body.musicPercent,
    resumeMusic: false
  });
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

export function createEmailWakeXHandler({
  commandResolver = resolveCanonicalPushcutXCommand,
  receiptCreator = createPushcutXReceipt,
  receiptReader = readPushcutXReceipt,
  receiptUpdater = updatePushcutXReceipt,
  commandEnqueuer = enqueueEmailWakeXCommand,
  commandActivator = activateEmailWakeXCommand,
  wakeSender = sendEmailWakeX
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
      `email-wake:x:${req.method.toLowerCase()}:${session.sid}:${clientIp(req)}`,
      { limit: req.method === 'POST' ? 20 : 60, windowMs: RATE_WINDOW_MS }
    );
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      return json(res, 429, {
        ok: false,
        error: 'Too many Version X email receiver requests. Try again shortly.'
      });
    }
    const health = emailWakeXHealth();
    const naturalAudioReady = Boolean(String(process.env.OPENAI_API_KEY || '').trim());
    const signedDeliveryReady = pushcutXCapabilityReady();
    const configurationIssues = [
      ...(Array.isArray(health.configurationIssues)
        ? health.configurationIssues
        : []),
      ...(!naturalAudioReady
        ? ['Natural Voice is missing OPENAI_API_KEY.']
        : []),
      ...(!signedDeliveryReady
        ? ['Signed Receiver delivery is missing a Version X server signing secret.']
        : [])
    ];
    if (req.method === 'GET') {
      const eventId = queryValue(req, 'eventId').trim();
      if (eventId) {
        if (!validPushcutXEventId(eventId)) {
          return json(res, 400, {
            ok: false,
            error: 'The Version X email announcement identifier is invalid.'
          });
        }
        try {
          const receipt = await receiptReader(eventId, { requireDurable: true });
          return json(res, 200, {
            ok: true,
            version: 'x',
            service: 'email-wake-x',
            transport: 'email-wake-x',
            eventId,
            status: receipt?.status || 'unknown',
            accepted: receipt
              ? (
                  ['accepted', 'started', 'timed_out', 'completed'].includes(receipt.status)
                  || ['email_wake_sent', 'email_wake_claimed'].includes(receipt.providerStatus)
                )
              : null,
            queued: receipt?.status === 'queued',
            completed: receipt?.status === 'completed',
            failed: receipt?.status === 'failed',
            receipt: receipt
              ? publicPushcutXReceipt(receipt, { durable: true })
              : null
          });
        } catch (error) {
          const safe = error instanceof PushcutXReceiptError
            ? error
            : new PushcutXReceiptError('unavailable');
          return json(res, safe.statusCode, { ok: false, error: safe.message });
        }
      }
      const [receiver, execution] = health.pairingReady
        ? await Promise.all([
            emailWakeXReceiverStatus({ requireDurable: true }).catch(() => ({
              receiverPaired: false,
              pairedAt: 0
            })),
            emailWakeXExecutionStatus({ requireDurable: true }).catch(() => ({
              executionActive: false,
              executionEventId: '',
              executionLeaseUntil: 0
            }))
          ])
        : [
            { receiverPaired: false, pairedAt: 0 },
            {
              executionActive: false,
              executionEventId: '',
              executionLeaseUntil: 0
            }
          ];
      return json(res, 200, {
        ok: true,
        version: 'x',
        service: 'email-wake-x',
        ...health,
        ...emailWakeXSetup(),
        ...receiver,
        ...execution,
        naturalAudioReady,
        signedDeliveryReady,
        configurationIssues,
        note: configurationIssues.length
          ? `Automatic Receiver setup needs attention: ${configurationIssues.join(' ')}`
          : receiver.receiverPaired
            ? 'Automatic Receiver server setup and Receiver pairing are ready. Run the Receiver Test after creating the Email automation.'
            : 'Automatic Receiver server setup is ready. Install the Shortcut and pair this speaker iPhone.',
        operational: health.ready
          && receiver.receiverPaired
          && naturalAudioReady
          && signedDeliveryReady
      });
    }
    if (!health.ready) {
      return json(res, 503, {
        ok: false,
        error: 'The Version X email wake receiver is not configured.',
        configurationIssues,
        queued: false,
        wakeSent: false
      });
    }
    let body;
    let attemptedEventId = '';
    let retryPending = false;
    try {
      body = await readJsonBody(req, MAX_REQUEST_BYTES);
    } catch (error) {
      return json(res, error?.message === 'Request too large.' ? 413 : 400, {
        ok: false,
        error: 'Invalid Version X email receiver command.'
      });
    }
    try {
      const canonical = body?.action === 'volume'
        ? volumeCommand(body)
        : await commandResolver(body);
      const command = Object.freeze({
        ...canonical,
        receiverContract: EMAIL_WAKE_X_RECEIVER_CONTRACT
      });
      attemptedEventId = command.eventId;
      const idempotencyKey = header(req, 'idempotency-key').trim();
      if (
        idempotencyKey
        && (!validPushcutXEventId(idempotencyKey) || idempotencyKey !== command.eventId)
      ) {
        throw new PushcutXError('invalid');
      }
      if (
        (command.action !== 'volume'
          && command.announcementMode !== 'finite-audio'
          && !naturalAudioReady)
        || !signedDeliveryReady
      ) {
        throw new EmailWakeXError('notConfigured');
      }
      const created = await receiptCreator(command, { requireDurable: true });
      if (
        created?.created === false
        && created?.receipt?.status === 'completed'
      ) {
        return json(res, 200, {
          ok: true,
          version: 'x',
          service: 'email-wake-x',
          eventId: command.eventId,
          accepted: true,
          queued: false,
          wakeSent: false,
          completed: true,
          idempotentReplay: true,
          receipt: publicPushcutXReceipt(created.receipt, { durable: true })
        });
      }
      const queued = await commandEnqueuer(command, { requireDurable: true });
      retryPending = true;
      let wake;
      try {
        wake = await wakeSender({ eventId: command.eventId });
      } catch (error) {
        const failedAt = Date.now();
        await receiptUpdater(command.eventId, {
          providerMode: 'email-wake-x',
          providerStatus: 'email_wake_retry_pending',
          updatedAt: failedAt
        }, {
          requireDurable: true,
          now: () => failedAt
        }).catch(() => {});
        throw error;
      }
      await commandActivator(command.eventId, { requireDurable: true });
      retryPending = false;
      const now = Date.now();
      const receipt = await receiptUpdater(command.eventId, {
        providerMode: 'email-wake-x',
        providerStatus: 'email_wake_sent',
        updatedAt: now
      }, {
        requireDurable: true,
        now: () => now
      }).catch(() => created.receipt);
      return json(res, queued.created ? 202 : 200, {
        ok: true,
        version: 'x',
        service: 'email-wake-x',
        eventId: command.eventId,
        accepted: true,
        queued: true,
        wakeSent: true,
        idempotentReplay: !queued.created,
        wake: {
          provider: wake.provider,
          emailId: wake.emailId
        },
        receipt: publicPushcutXReceipt(receipt, { durable: true })
      });
    } catch (error) {
      const safe = error instanceof EmailWakeXError
        || error instanceof PushcutXError
        || error instanceof PushcutXReceiptError
        ? error
        : new EmailWakeXError('providerUnavailable');
      return json(res, safe.statusCode, {
        ok: false,
        error: safe.message,
        ...(attemptedEventId ? { eventId: attemptedEventId } : {}),
        retryPending,
        wakeSent: false
      });
    }
  };
}

export default createEmailWakeXHandler();
