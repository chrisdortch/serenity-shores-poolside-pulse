import { sessionVariant } from './_auth.js';
import {
  claimPushcutXAudioGeneration,
  publicPushcutXReceipt,
  PushcutXReceiptError,
  pushcutXReceiptStorageHealth,
  updatePushcutXReceipt
} from './_pushcut-receipts-x.js';
import {
  readPushcutXCapability,
  verifyPushcutXCapability
} from './_pushcut-security-x.js';
import {
  generateNaturalSpeech,
  NaturalSpeechError
} from './_tts.js';
import {
  FiniteAudioXError,
  loadFiniteAnnouncementAudio
} from './_finite-audio-x.js';
import { logPushcutXEvent } from './_pushcut-x.js';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(JSON.stringify({ serverTime: Date.now(), ...body }));
}

export function createPushcutAudioXHandler({
  finiteAudioLoader = loadFiniteAnnouncementAudio,
  naturalSpeechGenerator = generateNaturalSpeech
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
    if (!verifyPushcutXCapability(capability, 'audio')) {
      return json(res, 403, { ok: false, error: 'The announcement audio link is invalid or expired.' });
    }
    logPushcutXEvent('receiver_audio_requested', {
      eventId: capability.eventId
    });

    let receipt;
    try {
      const claim = await claimPushcutXAudioGeneration(capability.eventId);
      receipt = claim.receipt;
      if (!claim.claimed) {
        if (receipt.status === 'completed') {
          return json(res, 410, { ok: false, error: 'This announcement has already completed.' });
        }
        if (receipt.status === 'failed') {
          return json(res, 409, { ok: false, error: 'This announcement can no longer play.' });
        }
        if (Number(receipt.audioFetchedAt || 0) > 0) {
          return json(res, 410, {
            ok: false,
            error: 'This one-time announcement audio link has already been used.'
          });
        }
        res.setHeader('Retry-After', '3');
        return json(res, 409, {
          ok: false,
          error: 'This announcement audio is already being prepared. Try again shortly.'
        });
      }
    } catch (error) {
      const safe = error instanceof PushcutXReceiptError
        ? error
        : new PushcutXReceiptError('unavailable');
      return json(res, safe.statusCode, { ok: false, error: safe.message });
    }

    try {
      const finite = receipt.announcementMode === 'finite-audio';
      const audio = finite
        ? await finiteAudioLoader({
            provider: receipt.announcementProvider,
            sourceUrl: receipt.announcementAudioUrl,
            maxDurationSeconds: receipt.announcementDurationSeconds
          })
        : await naturalSpeechGenerator({
            text: receipt.text,
            voice: receipt.voice,
            instructions: receipt.instructions
          });
      const extension = finite
        ? audio.extension
        : audio.format === 'mp3'
          ? 'mp3'
          : 'wav';
      receipt = await updatePushcutXReceipt(receipt.eventId, {
        status: 'started',
        providerStatus: finite
          ? `${receipt.announcementProvider}_finite_audio_ready`
          : 'natural_audio_ready',
        audioClaimedAt: 0,
        audioFetchedAt: Date.now(),
        audioContentType: audio.contentType
      });

      res.statusCode = 200;
      res.setHeader('Content-Type', audio.contentType);
      res.setHeader('Content-Length', String(audio.buffer.byteLength));
      res.setHeader('Content-Disposition', `inline; filename="poolside-pulse-announcement.${extension}"`);
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      logPushcutXEvent('receiver_audio_served', {
        eventId: receipt.eventId,
        speechMode: finite ? 'finite-audio' : 'natural-audio',
        audioFetched: true,
        receiptStatus: receipt.status
      });
      res.end(audio.buffer);
    } catch (error) {
      const naturalError = error instanceof NaturalSpeechError ? error : null;
      const finiteError = error instanceof FiniteAudioXError ? error : null;
      const receiptError = error instanceof PushcutXReceiptError ? error : null;
      const finite = receipt?.announcementMode === 'finite-audio';
      const failureCode = naturalError
        ? `natural_audio_${naturalError.code}`
        : finiteError
          ? `finite_audio_${finiteError.code}`
          : receiptError
            ? 'receipt_storage_unavailable'
            : finite
              ? 'finite_audio_unavailable'
              : 'natural_audio_unavailable';
      receipt = await updatePushcutXReceipt(capability.eventId, {
        status: 'failed',
        providerStatus: 'audio_failed',
        audioClaimedAt: 0,
        failedAt: Date.now(),
        failureCode
      }).catch(() => receipt);
      const statusCode = naturalError?.statusCode
        || finiteError?.statusCode
        || receiptError?.statusCode
        || 502;
      const message = naturalError?.message
        || finiteError?.message
        || receiptError?.message
        || (finite
          ? 'Finite announcement audio is temporarily unavailable.'
          : 'Natural announcement audio is temporarily unavailable.');
      logPushcutXEvent('receiver_audio_failed', {
        eventId: capability.eventId,
        providerCategory: failureCode,
        audioFetched: false,
        receiptStatus: receipt?.status
      });
      return json(res, statusCode, {
        ok: false,
        error: message,
        receipt: publicPushcutXReceipt(receipt, {
          durable: pushcutXReceiptStorageHealth().durable
        })
      });
    }
  };
}

export default createPushcutAudioXHandler();
